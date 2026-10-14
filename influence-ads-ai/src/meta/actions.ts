/** Cambios sobre objetos de Meta: pausa, reactivación y presupuesto, con verificación previa y posterior. */
import "server-only";
import { graph, fromMinorUnits, toMinorUnits, type FetchLike } from "./graph";

export type LiveState = { id: string; status: string | null; effective_status: string | null; daily_budget: number | null };

export async function readLive(metaId: string, token: string, currency: string | null, fetchImpl?: FetchLike): Promise<LiveState> {
  const r = await graph<{ id: string; status?: string; effective_status?: string; daily_budget?: string }>(metaId, {
    token, fetchImpl, params: { fields: "id,status,effective_status,daily_budget" },
  });
  return { id: r.id, status: r.status ?? null, effective_status: r.effective_status ?? null, daily_budget: fromMinorUnits(r.daily_budget, currency) };
}

export async function setStatus(metaId: string, status: "PAUSED" | "ACTIVE", token: string, fetchImpl?: FetchLike) {
  await graph(metaId, { token, fetchImpl, method: "POST", params: { status } });
}

export async function setDailyBudget(metaId: string, amount: number, currency: string | null, token: string, fetchImpl?: FetchLike) {
  await graph(metaId, { token, fetchImpl, method: "POST", params: { daily_budget: toMinorUnits(amount, currency) } });
}
