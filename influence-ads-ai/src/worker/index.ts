/**
 * Proceso en segundo plano: sincroniza cuentas, diagnostica y (solo en nivel 3)
 * ejecuta acciones autorizadas. Ejecutar con: npm run worker
 *
 * Cola en PostgreSQL (tabla jobs) con SELECT … FOR UPDATE SKIP LOCKED, de modo
 * que se pueden correr varias instancias sin duplicar trabajo.
 */
import { loadEnvFile } from "../../scripts/load-env";
loadEnvFile();

const { q, q1 } = await import("@/lib/db");
const { syncAdAccount } = await import("@/meta/sync");
const { runDiagnosis, autoOptimizeClient, systemCtx, expireOldProposals } = await import("@/engine/run");
const { parseGuardrails } = await import("@/lib/schemas");
const { redactString } = await import("@/lib/redact");
const { enqueue } = await import("@/lib/jobs");

type Job = { id: number; org_id: string; type: string; payload: Record<string, string>; attempts: number; max_attempts: number };

async function pick(): Promise<Job | null> {
  return q1<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
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

/** Programa los trabajos periódicos. */
async function schedule() {
  // Sincronizar cuentas administradas cada 6 horas
  const stale = await q<{ id: string; org_id: string }>(
    `SELECT a.id, a.org_id FROM ad_accounts a JOIN meta_connections c ON c.id = a.connection_id
      WHERE a.managed AND c.status = 'active' AND (a.last_synced_at IS NULL OR a.last_synced_at < now() - interval '6 hours')`);
  for (const a of stale) await enqueue(a.org_id, "sync_account", { adAccountId: a.id }, `sync:${a.id}`);

  // Diagnóstico diario a la hora configurada (hora de Chile por defecto) y optimización si corresponde
  const hourCl = Number(new Intl.DateTimeFormat("es-CL", { hour: "numeric", hour12: false, timeZone: "America/Santiago" }).format(new Date()));
  const today = new Date().toISOString().slice(0, 10);
  const clients = await q<{ id: string; org_id: string; guardrails: unknown; automation_level: string; automation_paused: boolean; kill: boolean }>(
    `SELECT c.id, c.org_id, c.guardrails, c.automation_level, c.automation_paused, o.automation_kill_switch kill
       FROM clients c JOIN organizations o ON o.id = c.org_id
      WHERE c.status = 'active' AND EXISTS (SELECT 1 FROM ad_accounts a WHERE a.client_id = c.id AND a.managed)`);
  for (const c of clients) {
    const g = parseGuardrails(c.guardrails);
    if (hourCl !== g.evaluationHourLocal) continue;
    await enqueue(c.org_id, "diagnose_client", { clientId: c.id }, `diag:${c.id}:${today}`);
    if (c.automation_level === "auto" && !c.automation_paused && !c.kill) {
      await enqueue(c.org_id, "auto_optimize_client", { clientId: c.id }, `auto:${c.id}:${today}`, new Date(Date.now() + 10 * 60_000));
    }
  }
  await expireOldProposals();
}

async function loop() {
  let lastSchedule = 0;
  console.log("Worker de Influence Ads AI iniciado.");
  for (;;) {
    if (Date.now() - lastSchedule > 5 * 60_000) {
      await schedule().catch((e) => console.error("Error al programar:", redactString(String(e?.message ?? e))));
      lastSchedule = Date.now();
    }
    const job = await pick();
    if (!job) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    try {
      const out = await handle(job);
      await q(`UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
      console.log(`✓ ${job.type} #${job.id}`, JSON.stringify(out ?? {}).slice(0, 300));
    } catch (e) {
      const msg = redactString(String((e as Error)?.message ?? e)).slice(0, 2000);
      const retry = job.attempts < job.max_attempts;
      await q(`UPDATE jobs SET status = $2, last_error = $3, run_after = now() + ($4 || ' minutes')::interval, finished_at = CASE WHEN $2 = 'failed' THEN now() END WHERE id = $1`,
        [job.id, retry ? "queued" : "failed", msg, String(5 * job.attempts * job.attempts)]);
      console.error(`✗ ${job.type} #${job.id}: ${msg}`);
    }
  }
}

if (process.env.WORKER_NO_LOOP !== "1") loop();
