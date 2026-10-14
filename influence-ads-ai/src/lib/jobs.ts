import "server-only";
import { q } from "./db";

/** Encola un trabajo en segundo plano (idempotente si se indica dedupeKey). */
export async function enqueue(orgId: string, type: "sync_account" | "diagnose_client" | "auto_optimize_client", payload: Record<string, unknown>, dedupeKey?: string, runAfter?: Date) {
  await q(
    `INSERT INTO jobs (org_id, type, payload, dedupe_key, run_after) VALUES ($1,$2,$3,$4,COALESCE($5, now())) ON CONFLICT DO NOTHING`,
    [orgId, type, JSON.stringify(payload), dedupeKey ?? null, runAfter ?? null],
  );
}
