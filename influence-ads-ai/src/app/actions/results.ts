"use server";
import { q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireClient, assertUuid } from "@/lib/tenancy";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/action";
import { encrypt, randomToken } from "@/lib/crypto";
import { parseGuardrails, parseLocaleNumber } from "@/lib/schemas";
import { computeExperiment } from "@/engine/learning";
import { runDiagnosis, executeAction } from "@/engine/run";
import { enforceRateLimit } from "@/lib/ratelimit";

const KINDS = ["conversation", "lead", "qualified_lead", "sale"] as const;
const SOURCES = ["manual", "whatsapp", "crm", "ecommerce", "web"] as const;

/** Registro manual: p. ej. "esta conversación de WhatsApp terminó en venta". */
export async function addConversion(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=ventas&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "conversions.write");
    const kind = str(fd, "kind") as (typeof KINDS)[number];
    const source = (str(fd, "source") || "manual") as (typeof SOURCES)[number];
    if (!KINDS.includes(kind) || !SOURCES.includes(source)) throw new AppError("invalid", "Tipo u origen inválido.");
    const date = str(fd, "date") || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("invalid", "Fecha inválida.");
    const value = parseLocaleNumber(str(fd, "value"));
    const margin = parseLocaleNumber(str(fd, "margin"));
    if ((value !== undefined && !(value >= 0)) || (margin !== undefined && !Number.isFinite(margin))) throw new AppError("invalid", "Monto inválido.");
    const externalId = str(fd, "externalId") || `manual-${randomToken(9)}`;
    const campaign = str(fd, "campaignMetaId") || null;
    if (campaign) {
      const ok = await q1(`SELECT 1 FROM meta_objects o JOIN ad_accounts a ON a.id = o.ad_account_id WHERE o.meta_id = $1 AND o.level = 'campaign' AND a.client_id = $2 AND a.org_id = $3`, [campaign, clientId, ctx.orgId]);
      if (!ok) throw new AppError("invalid", "La campaña no pertenece a este cliente.");
    }
    const row = await q1<{ id: string }>(
      `INSERT INTO conversions (org_id, client_id, source, kind, external_id, occurred_at, value, margin, currency, campaign_meta_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (client_id, source, external_id, kind) DO NOTHING RETURNING id`,
      [ctx.orgId, clientId, source, kind, externalId.slice(0, 200), `${date}T12:00:00Z`, value ?? null, margin ?? null, str(fd, "currency") || null, campaign, str(fd, "notes").slice(0, 500) || null, ctx.userId]);
    if (!row) throw new AppError("conflict", "Ese registro ya existía (mismo identificador): no se duplicó.");
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "conversion.added", entity: "conversion", entityId: row.id, details: { kind, source } });
    return "Registro guardado.";
  });
}

export async function deleteConversion(clientId: string, id: string) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=ventas&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "conversions.write");
    await q(`DELETE FROM conversions WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assertUuid(id), clientId, ctx.orgId]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "conversion.deleted", entity: "conversion", entityId: id });
    return "Registro eliminado.";
  });
}

export async function createWebhook(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=ventas&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "automation.configure");
    const source = str(fd, "source");
    if (!["crm", "ecommerce", "web", "whatsapp"].includes(source)) throw new AppError("invalid", "Origen inválido.");
    const secret = randomToken(32);
    const row = await q1<{ id: string }>(`INSERT INTO inbound_webhooks (org_id, client_id, name, source, secret_enc) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ctx.orgId, clientId, str(fd, "name") || source, source, encrypt(secret)]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "webhook.created", entity: "inbound_webhook", entityId: row!.id });
    return "Integración creada. Abre «Ver clave y URL» para configurarla en tu CRM o tienda.";
  });
}

export async function revokeWebhook(clientId: string, id: string) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=ventas&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "automation.configure");
    await q(`UPDATE inbound_webhooks SET revoked_at = now() WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assertUuid(id), clientId, ctx.orgId]);
    return "Integración revocada.";
  });
}

export async function evaluateExperiment(clientId: string, id: string) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=experimentos&cliente=${clientId}`, async () => {
    const c = await requireClient(ctx, clientId);
    const exp = await q1(`SELECT 1 FROM experiments WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assertUuid(id), clientId, ctx.orgId]);
    if (!exp) throw new AppError("not_found", "El experimento no existe.");
    const r = await computeExperiment(ctx.orgId, id, parseGuardrails(c.guardrails).minConversions);
    if (!r) throw new AppError("conflict", "El experimento aún no tiene campaña en Meta o datos sincronizados.");
    await q(`UPDATE experiments SET result = $2 WHERE id = $1`, [id, JSON.stringify(r)]);
    return r.explanation;
  });
}

export async function concludeExperiment(clientId: string, id: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=experimentos&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "campaign.draft");
    const decision = str(fd, "decision");
    if (!decision) throw new AppError("invalid", "Escribe la decisión tomada.");
    await q(`UPDATE experiments SET status = 'concluded', decision = $4, outcome = NULLIF($5,''), concluded_at = now() WHERE id = $1 AND client_id = $2 AND org_id = $3`,
      [assertUuid(id), clientId, ctx.orgId, decision.slice(0, 2000), str(fd, "outcome").slice(0, 2000)]);
    const learning = str(fd, "learning");
    if (learning) {
      const kind = ["observado", "hipotesis", "conclusion"].includes(str(fd, "kind")) ? str(fd, "kind") : "hipotesis";
      await q(`INSERT INTO learnings (org_id, client_id, kind, statement, confidence, experiment_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.orgId, clientId, kind, learning.slice(0, 1000), str(fd, "confidence") || "baja", id, ctx.userId]);
    }
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "experiment.concluded", entity: "experiment", entityId: id });
    return "Experimento cerrado y aprendizaje registrado.";
  });
}

export async function updateOutcome(clientId: string, id: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=experimentos&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "campaign.draft");
    await q(`UPDATE experiments SET outcome = $4 WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assertUuid(id), clientId, ctx.orgId, str(fd, "outcome").slice(0, 2000)]);
    return "Resultado posterior registrado.";
  });
}

export async function addLearning(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=experimentos&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "campaign.draft");
    const statement = str(fd, "statement");
    const kind = str(fd, "kind");
    if (!statement || !["observado", "hipotesis", "conclusion"].includes(kind)) throw new AppError("invalid", "Escribe el aprendizaje y su tipo.");
    if (kind === "conclusion" && !str(fd, "evidence")) throw new AppError("invalid", "Una conclusión necesita evidencia (datos que la respaldan).");
    await q(`INSERT INTO learnings (org_id, client_id, kind, statement, evidence, confidence, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.orgId, clientId, kind, statement.slice(0, 1000), JSON.stringify({ text: str(fd, "evidence").slice(0, 2000) }), str(fd, "confidence") || "baja", ctx.userId]);
    return "Aprendizaje guardado. La IA lo usará en las próximas propuestas de este cliente.";
  });
}

export async function toggleLearning(clientId: string, id: string, active: boolean) {
  const ctx = await requireSession();
  await runAction(`/resultados?tab=experimentos&cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "campaign.draft");
    await q(`UPDATE learnings SET active = $4 WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assertUuid(id), clientId, ctx.orgId, active]);
    return active ? "Aprendizaje reactivado." : "Aprendizaje archivado (la IA ya no lo usará).";
  });
}

// ── Diagnóstico y acciones ──────────────────────────────────────────────────
export async function diagnoseNow(clientId: string) {
  const ctx = await requireSession();
  await runAction(`/recomendaciones?cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId);
    enforceRateLimit(`diag:${clientId}`, 10, 60 * 60_000);
    const r = await runDiagnosis(ctx, clientId, { trigger: "manual" });
    return `Diagnóstico listo: ${r.findings.length} hallazgo(s) y ${r.proposals.length} acción(es) nueva(s) propuesta(s).`;
  });
}

export async function decideAction(id: string, decision: "approve" | "reject") {
  const ctx = await requireSession();
  const a = await q1<{ client_id: string }>(`SELECT client_id FROM proposed_actions WHERE id = $1 AND org_id = $2`, [assertUuid(id, "La acción"), ctx.orgId]);
  const back = a ? `/recomendaciones?cliente=${a.client_id}` : "/recomendaciones";
  await runAction(back, async () => {
    if (!a) throw new AppError("not_found", "La acción no existe.");
    await requireClient(ctx, a.client_id, "actions.approve");
    if (decision === "reject") {
      await q(`UPDATE proposed_actions SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'proposed'`, [id, ctx.userId]);
      await audit({ orgId: ctx.orgId, clientId: a.client_id, userId: ctx.userId, actor: "user", action: "action.rejected", entity: "proposed_action", entityId: id });
      return "Recomendación descartada.";
    }
    const r = await executeAction(ctx, id, "manual");
    if (!r.executed) throw new AppError("conflict", r.verdict.reasons.join(" "));
    return "Acción aprobada y ejecutada en Meta. Quedó registrada en el historial.";
  });
}

export async function markTaskDone(id: string) {
  const ctx = await requireSession();
  const a = await q1<{ client_id: string; executable: boolean }>(`SELECT client_id, executable FROM proposed_actions WHERE id = $1 AND org_id = $2`, [assertUuid(id, "La acción"), ctx.orgId]);
  await runAction(a ? `/recomendaciones?cliente=${a.client_id}` : "/recomendaciones", async () => {
    if (!a) throw new AppError("not_found", "La acción no existe.");
    await requireClient(ctx, a.client_id, "actions.approve");
    if (a.executable) throw new AppError("conflict", "Esta acción se ejecuta desde el botón «Aprobar y ejecutar».");
    await q(`UPDATE proposed_actions SET status = 'executed', executed_at = now(), executed_by = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'proposed'`, [id, `user:${ctx.userId}`, ctx.userId]);
    await audit({ orgId: ctx.orgId, clientId: a.client_id, userId: ctx.userId, actor: "user", action: "action.task_done", entity: "proposed_action", entityId: id });
    return "Tarea marcada como realizada.";
  });
}
