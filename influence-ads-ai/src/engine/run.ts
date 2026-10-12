/**
 * Orquestación con base de datos: diagnóstico de un cliente, creación de
 * acciones propuestas, ejecución (manual o automática) con auditoría.
 */
import "server-only";
import { q, q1 } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseGuardrails, parseProfile } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { performance, realConversions, resolvePeriod, scopeAccounts, totalsFor } from "@/lib/reporting";
import type { Ctx } from "@/lib/tenancy";
import { connectionToken, handleMetaError } from "@/meta/connections";
import { readLive, setDailyBudget, setStatus } from "@/meta/actions";
import { MetaApiError } from "@/meta/graph";
import { diagnose, type Finding } from "./diagnosis";
import { evaluateAction, proposalsFromFindings, type GuardState, type ProposedAction } from "./decisions";

/** Contexto de sistema para procesos en segundo plano (ve todos los clientes de la organización). */
export function systemCtx(orgId: string): Ctx {
  return { userId: "00000000-0000-0000-0000-000000000000", orgId, role: "admin", allClients: true, userName: "Sistema", email: "" };
}

export async function runDiagnosis(ctx: Ctx, clientId: string, opts: { trigger: "manual" | "scheduled"; preset?: string }) {
  const client = await q1<{ id: string; currency: string; profile: unknown; guardrails: unknown; automation_level: "observe" | "approve" | "auto"; automation_paused: boolean }>(
    `SELECT id, currency, profile, guardrails, automation_level, automation_paused FROM clients WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId]);
  if (!client) throw new AppError("not_found", "El cliente no existe.");
  const guardrails = parseGuardrails(client.guardrails);
  const profile = parseProfile(client.profile);

  // Excluye los días más recientes por retraso de atribución.
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - guardrails.attributionLagDays);
  const period = resolvePeriod(opts.preset ?? "7d", undefined, today);

  const accounts = await scopeAccounts(ctx, clientId);
  const ids = accounts.map((a) => a.id);
  const [campaigns, ads, account, prev, real] = await Promise.all([
    performance(ctx, clientId, "campaign", period),
    performance(ctx, clientId, "ad", period),
    totalsFor(ids, period.since, period.until),
    totalsFor(ids, period.prevSince, period.prevUntil),
    realConversions(ctx, clientId, period.since, period.until),
  ]);
  const hasReal = real.lead + real.qualified_lead + real.sale + real.conversation > 0;
  const findings = diagnose({
    currency: accounts[0]?.currency ?? client.currency,
    periodDays: period.days,
    account: { totals: account, prev },
    campaigns, ads,
    real: hasReal ? real : null,
    guardrails,
    targetCpa: guardrails.targetCpa ?? profile.targetCpa,
  });

  const diag = await q1<{ id: string }>(
    `INSERT INTO diagnoses (org_id, client_id, trigger, period_start, period_end, findings, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ctx.orgId, clientId, opts.trigger, period.since, period.until, JSON.stringify(findings), opts.trigger === "manual" ? ctx.userId : null],
  );

  // Presupuestos actuales para proponer cambios concretos
  const budgets = new Map<string, number | null>();
  for (const c of campaigns) budgets.set(c.meta_id, c.daily_budget);
  const proposals = proposalsFromFindings(findings, { clientId, guardrails, budgets, periodKey: period.until });
  const created: string[] = [];
  for (const p of proposals) {
    const id = await insertProposal(ctx.orgId, clientId, p);
    if (id) created.push(id);
  }
  await audit({ orgId: ctx.orgId, clientId, userId: opts.trigger === "manual" ? ctx.userId : null, actor: opts.trigger === "manual" ? "user" : "system", action: "diagnosis.run", entity: "diagnosis", entityId: diag!.id, details: { findings: findings.length, proposals: created.length, period } });
  return { diagnosisId: diag!.id, findings, proposals: created, period };
}

async function insertProposal(orgId: string, clientId: string, p: ProposedAction): Promise<string | null> {
  const review = new Date(Date.now() + p.reviewInDays * 86400000);
  const row = await q1<{ id: string }>(
    `INSERT INTO proposed_actions (org_id, client_id, ad_account_id, type, target_level, target_meta_id, target_name, params, title, rationale, evidence, confidence, expected_effect, review_after, executable, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (dedupe_key) WHERE status IN ('proposed','approved','executing') DO NOTHING RETURNING id`,
    [orgId, clientId, p.adAccountId ?? null, p.type, p.targetLevel ?? null, p.targetMetaId ?? null, p.targetName ?? null, JSON.stringify(p.params), p.title, p.rationale,
     JSON.stringify({ items: p.evidence }), p.confidence, p.expected, review, ["pause", "resume", "budget_change"].includes(p.type), p.dedupeKey],
  );
  return row?.id ?? null;
}

type ActionRow = {
  id: string; org_id: string; client_id: string; ad_account_id: string | null; type: ProposedAction["type"]; target_level: "campaign" | "adset" | "ad" | null;
  target_meta_id: string | null; target_name: string | null; params: ProposedAction["params"]; title: string; rationale: string; evidence: { items: string[] };
  confidence: "baja" | "media" | "alta"; expected_effect: string | null; status: string; dedupe_key: string;
};

export async function guardStateFor(orgId: string, a: ActionRow): Promise<GuardState> {
  const client = await q1<{ guardrails: unknown; automation_level: GuardState["level"]; automation_paused: boolean; kill: boolean }>(
    `SELECT c.guardrails, c.automation_level, c.automation_paused, o.automation_kill_switch kill FROM clients c JOIN organizations o ON o.id = c.org_id WHERE c.id = $1 AND c.org_id = $2`,
    [a.client_id, orgId]);
  if (!client) throw new AppError("not_found", "El cliente no existe.");
  const last = await q1<{ executed_at: string }>(
    `SELECT executed_at FROM proposed_actions WHERE client_id = $1 AND target_meta_id = $2 AND status = 'executed' AND type IN ('pause','resume','budget_change') ORDER BY executed_at DESC LIMIT 1`,
    [a.client_id, a.target_meta_id]);
  const acc = a.ad_account_id ? await q1<{ last_synced_at: string | null }>(`SELECT last_synced_at FROM ad_accounts WHERE id = $1 AND org_id = $2`, [a.ad_account_id, orgId]) : null;
  const autoToday = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM proposed_actions WHERE client_id = $1 AND executed_by = 'automation' AND executed_at > now() - interval '24 hours'`, [a.client_id]);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const accIds = (await q<{ id: string }>(`SELECT id FROM ad_accounts WHERE client_id = $1 AND org_id = $2 AND managed`, [a.client_id, orgId])).map((r) => r.id);
  const month = await totalsFor(accIds, monthStart, now.toISOString().slice(0, 10));
  const other = await q1<{ s: number }>(
    `SELECT COALESCE(SUM(daily_budget),0) s FROM meta_objects WHERE ad_account_id = ANY($1::uuid[]) AND level IN ('campaign','adset') AND effective_status = 'ACTIVE' AND meta_id <> $2 AND daily_budget IS NOT NULL`,
    [accIds, a.target_meta_id ?? ""]);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    level: client.automation_level,
    orgKillSwitch: client.kill,
    clientPaused: client.automation_paused,
    guardrails: parseGuardrails(client.guardrails),
    lastChangeAt: last?.executed_at ? new Date(last.executed_at).toISOString() : null,
    dataAgeHours: acc?.last_synced_at ? (Date.now() - Date.parse(acc.last_synced_at)) / 3600000 : null,
    autoActionsToday: autoToday?.n ?? 0,
    monthSpend: month.spend,
    otherDailyBudgets: other?.s ?? 0,
    daysLeftInMonth: daysInMonth - now.getUTCDate() + 1,
  };
}

function toProposed(a: ActionRow): ProposedAction {
  return {
    type: a.type, targetLevel: a.target_level ?? undefined, targetMetaId: a.target_meta_id ?? undefined, targetName: a.target_name ?? undefined,
    adAccountId: a.ad_account_id ?? undefined, params: a.params, title: a.title, rationale: a.rationale, evidence: a.evidence?.items ?? [],
    confidence: a.confidence, expected: a.expected_effect ?? "", reviewInDays: 7, dedupeKey: a.dedupe_key,
  };
}

/**
 * Ejecuta una acción. mode=manual exige que la llame un usuario con permiso
 * (verificado por quien llama). Re-evalúa límites con datos frescos, lee el
 * estado real en Meta antes de cambiar y verifica después.
 */
export async function executeAction(ctx: Ctx, actionId: string, mode: "auto" | "manual") {
  const a = await q1<ActionRow>(`SELECT * FROM proposed_actions WHERE id = $1 AND org_id = $2`, [actionId, ctx.orgId]);
  if (!a) throw new AppError("not_found", "La acción no existe.");
  if (!["proposed", "approved"].includes(a.status)) throw new AppError("conflict", "Esta acción ya fue procesada.");
  const state = await guardStateFor(ctx.orgId, a);
  const verdict = evaluateAction(toProposed(a), state, mode);
  const actor = mode === "auto" ? "automation" : "user";

  if (verdict.decision !== "execute") {
    // Se guarda el motivo pero la acción sigue abierta: si cambian los límites o el nivel, puede ejecutarse.
    await q(`UPDATE proposed_actions SET blocked_reason = $2 WHERE id = $1`, [a.id, verdict.reasons.join(" ") || null]);
    await audit({ orgId: ctx.orgId, clientId: a.client_id, userId: mode === "manual" ? ctx.userId : null, actor, action: `action.${verdict.decision}`, entity: "proposed_action", entityId: a.id, details: { reasons: verdict.reasons } });
    return { executed: false, verdict };
  }

  // Marca en ejecución (evita dobles ejecuciones concurrentes)
  const locked = await q1(`UPDATE proposed_actions SET status = 'executing', decided_by = COALESCE(decided_by, $2), decided_at = COALESCE(decided_at, now()) WHERE id = $1 AND status IN ('proposed','approved') RETURNING id`,
    [a.id, mode === "manual" ? ctx.userId : null]);
  if (!locked) throw new AppError("conflict", "Esta acción ya está siendo procesada.");

  const acc = await q1<{ connection_id: string | null; currency: string | null }>(`SELECT connection_id, currency FROM ad_accounts WHERE id = $1 AND org_id = $2`, [a.ad_account_id, ctx.orgId]);
  try {
    if (!acc) throw new AppError("not_found", "La cuenta publicitaria ya no está disponible.");
    const { token } = await connectionToken(ctx.orgId, acc.connection_id);
    const before = await readLive(a.target_meta_id!, token, acc.currency);
    if (a.type === "budget_change") {
      if (before.daily_budget === null) throw new AppError("conflict", "El objeto no tiene presupuesto diario propio en Meta.");
      if (Math.abs(before.daily_budget - (a.params.fromBudget ?? -1)) > 0.01) {
        throw new AppError("conflict", `El presupuesto cambió en Meta desde la propuesta (ahora ${before.daily_budget}). Se canceló para no pisar un cambio reciente.`);
      }
      await setDailyBudget(a.target_meta_id!, a.params.toBudget!, acc.currency, token);
    } else {
      const status = a.type === "pause" ? "PAUSED" : "ACTIVE";
      if (before.status === status) throw new AppError("conflict", `El objeto ya está ${status === "PAUSED" ? "pausado" : "activo"} en Meta.`);
      await setStatus(a.target_meta_id!, status, token);
    }
    const after = await readLive(a.target_meta_id!, token, acc.currency);
    await q(`UPDATE proposed_actions SET status = 'executed', executed_at = now(), executed_by = $2, result = $3 WHERE id = $1`,
      [a.id, mode === "auto" ? "automation" : `user:${ctx.userId}`, JSON.stringify({ before, after })]);
    await q(`UPDATE meta_objects SET status = $2, daily_budget = $3, updated_at = now() WHERE ad_account_id = $1 AND meta_id = $4`, [a.ad_account_id, after.status, after.daily_budget, a.target_meta_id]);
    await audit({ orgId: ctx.orgId, clientId: a.client_id, userId: mode === "manual" ? ctx.userId : null, actor, action: `action.executed.${a.type}`, entity: "proposed_action", entityId: a.id, details: { target: a.target_meta_id, before, after } });
    return { executed: true, verdict, before, after };
  } catch (e) {
    await handleMetaError(ctx.orgId, acc?.connection_id ?? null, e);
    const msg = e instanceof AppError || e instanceof MetaApiError ? e.userMessage : "Error inesperado al ejecutar.";
    await q(`UPDATE proposed_actions SET status = 'failed', result = $2 WHERE id = $1`, [a.id, JSON.stringify({ error: msg })]);
    await audit({ orgId: ctx.orgId, clientId: a.client_id, userId: mode === "manual" ? ctx.userId : null, actor, action: "action.failed", entity: "proposed_action", entityId: a.id, details: { error: msg } });
    throw e instanceof AppError ? e : new AppError("upstream", msg);
  }
}

/** Nivel 3: intenta ejecutar las acciones abiertas autorizadas de un cliente. */
export async function autoOptimizeClient(orgId: string, clientId: string) {
  const ctx = systemCtx(orgId);
  const open = await q<{ id: string }>(`SELECT id FROM proposed_actions WHERE org_id = $1 AND client_id = $2 AND status = 'proposed' AND executable ORDER BY created_at`, [orgId, clientId]);
  const results: { id: string; executed: boolean; reasons: string[] }[] = [];
  for (const { id } of open) {
    try {
      const r = await executeAction(ctx, id, "auto");
      results.push({ id, executed: r.executed, reasons: r.verdict.reasons });
    } catch (e) {
      results.push({ id, executed: false, reasons: [(e as Error).message] });
    }
  }
  return results;
}

export async function expireOldProposals() {
  await q(`UPDATE proposed_actions SET status = 'expired' WHERE status = 'proposed' AND created_at < now() - interval '7 days'`);
}

export type { Finding };
