/**
 * Proceso en segundo plano para servidores propios: npm run worker
 * (En Vercel no se usa: lo reemplaza la tarea programada /api/cron.)
 *
 * Cola en PostgreSQL (tabla jobs) con SELECT … FOR UPDATE SKIP LOCKED, de modo
 * que se pueden correr varias instancias sin duplicar trabajo.
 */
import { loadEnvFile } from "../../scripts/load-env";
loadEnvFile();

const { scheduleJobs, pickJob, runJob } = await import("./jobs");
const { redactString } = await import("@/lib/redact");

async function loop() {
  let lastSchedule = 0;
  console.log("Worker de Influence Ads AI iniciado.");
  for (;;) {
    if (Date.now() - lastSchedule > 5 * 60_000) {
      await scheduleJobs().catch((e) => console.error("Error al programar:", redactString(String(e?.message ?? e))));
      lastSchedule = Date.now();
    }
    const job = await pickJob();
    if (!job) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    await runJob(job);
  }
}

if (process.env.WORKER_NO_LOOP !== "1") loop();
