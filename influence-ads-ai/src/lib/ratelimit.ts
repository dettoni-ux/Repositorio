/**
 * Límite de solicitudes en memoria (ventana deslizante). Suficiente para una
 * instancia; con varias instancias reemplazar por un almacén compartido.
 */
import { AppError } from "./errors";

const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfterMs: windowMs - (now - arr[0]) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterMs: 0 };
}

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const r = checkRateLimit(key, limit, windowMs);
  if (!r.ok) {
    const s = Math.ceil(r.retryAfterMs / 1000);
    throw new AppError("rate_limited", `Demasiados intentos seguidos. Espera ${s} segundos e intenta otra vez.`);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
