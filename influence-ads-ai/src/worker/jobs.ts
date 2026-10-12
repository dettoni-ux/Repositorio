/**
 * Lógica de trabajos en segundo plano, compartida por el worker (servidor
 * propio) y por la tarea programada de Vercel (/api/cron).
 */
import "server-only";
import { q, q1 } from "@/lib/db";
import { syncAdAccount } from "@/meta/sync";
import { runDiagnosis, autoOptimizeClient, systemCtx, expireOldProposals } from "@/engine/run";
import { parseGuardrails } from "@/lib/schemas";
import { redactString } from "@/lib/redact";
import { enqueue } from "@/lib/jobs";

type Job = { id: number; org_id: string; type: string; payload: Record<string, string>; attempts: number; max_attempts: number };

export async function pickJob(): Promise<Job | null> {
  return q1<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, org_id, type, payload, attempts, max_attempts`,
  );
}

async function handle(job: Job) {
  switch (job.type) {
    case "sync_account":
      return syncAdAccount(job.org_id, job.payload.adAccountId, { days: Number(job.payload.days ?? 28) });
    case "diagnose_client": {
      const r = await runDiagnosis(systemCtx(job.org_id), job.payload.clientId, { trigger: "scheduled" });
      return { findings: r.findings.length, proposals: r.proposals.length };
    }
    case "auto_optimize_client":
      return autoOptimizeClient(job.org_id, job.payload.clientId);
    default:
      throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
  }
}

/** Ejecuta un trabajo y registra el resultado (con reintentos escalonados). */
export async function runJob(job: Job, log = console) {
  try {
    const out = await handle(job);
    await q(`UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
    log.log(`✓ ${job.type} #${job.id}`, JSON.stringify(out ?? {}).slice(0, 300));
    return true;
  } catch (e) {
    const msg = redactString(String((e as Error)?.message ?? e)).slice(0, 2000);
    const retry = job.attempts < job.max_attempts;
    await q(`UPDATE jobs SET status = $2, last_error = $3, run_after = now() + ($4 || ' minutes')::interval, finished_at = CASE WHEN $2 = 'failed' THEN now() END WHERE id = $1`,
      [job.id, retry ? "queued" : "failed", msg, String(5 * job.attempts * job.attempts)]);
    log.error(`✗ ${job.type} #${job.id}: ${msg}`);
    return false;
  }
}

/** Fecha y hora actuales en Chile. */
export function chileNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/**
 * Programa los trabajos periódicos. Es idempotente: se puede llamar cada
 * 5 minutos (worker) o una vez al día (Cron de Vercel).
 * - Sincroniza cuentas administradas sin datos de las últimas 6 horas.
 * - Diagnostica una vez por día por cliente, desde su hora de evaluación.
 * - En nivel 3, encola la optimización después del diagnóstico.
 */
export async function scheduleJobs(now = new Date()) {
  const stale = await q<{ id: string; org_id: string }>(
    `SELECT a.id, a.org_id FROM ad_accounts a JOIN meta_connections c ON c.id = a.connection_id
      WHERE a.managed AND c.status = 'active' AND (a.last_synced_at IS NULL OR a.last_synced_at < now() - interval '6 hours')`);
  for (const a of stale) await enqueue(a.org_id, "sync_account", { adAccountId: a.id }, `sync:${a.id}`);

  const cl = chileNow(now);
  const clients = await q<{ id: string; org_id: string; guardrails: unknown; automation_level: string; automation_paused: boolean; kill: boolean }>(
    `SELECT c.id, c.org_id, c.guardrails, c.automation_level, c.automation_paused, o.automation_kill_switch kill
       FROM clients c JOIN organizations o ON o.id = c.org_id
      WHERE c.status = 'active' AND EXISTS (SELECT 1 FROM ad_accounts a WHERE a.client_id = c.id AND a.managed)`);
  let scheduled = 0;
  for (const c of clients) {
    const g = parseGuardrails(c.guardrails);
    if (cl.hour < g.evaluationHourLocal) continue;
    const key = `diag:${c.id}:${cl.date}`;
    const done = await q1(`SELECT 1 FROM jobs WHERE dedupe_key = $1 OR (type = 'diagnose_client' AND payload->>'clientId' = $2 AND created_at > now() - interval '20 hours')`, [key, c.id]);
    if (done) continue;
    await enqueue(c.org_id, "diagnose_client", { clientId: c.id }, key);
    scheduled++;
    if (c.automation_level === "auto" && !c.automation_paused && !c.kill) {
      await enqueue(c.org_id, "auto_optimize_client", { clientId: c.id }, `auto:${c.id}:${cl.date}`);
    }
  }
  await expireOldProposals();
  return { syncs: stale.length, diagnoses: scheduled };
}

/** Procesa trabajos hasta agotar la cola o el tiempo disponible. */
export async function drainJobs(budgetMs: number, log = console) {
  const until = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < until) {
    const job = await pickJob();
    if (!job) break;
    await runJob(job, log);
    processed++;
  }
  // Libera trabajos que quedaron "en ejecución" por un corte (p. ej. tiempo máximo agotado).
  await q(`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND locked_at < now() - interval '15 minutes'`);
  return processed;
}
