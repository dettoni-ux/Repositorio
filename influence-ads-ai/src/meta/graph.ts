/**
 * Cliente mínimo de la Graph API / Marketing API de Meta.
 * - Versión configurable (META_GRAPH_VERSION, por defecto v26.0).
 * - Envía appsecret_proof en cada llamada (recomendado por Meta).
 * - Traduce los errores de Meta a mensajes comprensibles y distingue
 *   token vencido, falta de permisos, límites de uso y errores de parámetros.
 * - Respeta los encabezados de uso (x-business-use-case-usage / x-ad-account-usage).
 * El token nunca se registra: los mensajes pasan por redactString().
 */
import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { redactString } from "@/lib/redact";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MetaErrorKind = "token" | "permission" | "rate_limit" | "invalid" | "policy" | "temporary" | "unknown";

export class MetaApiError extends Error {
  constructor(
    public readonly kind: MetaErrorKind,
    public readonly userMessage: string,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly fbtraceId?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(userMessage);
  }
}

export function classifyMetaError(err: { code?: number; error_subcode?: number; message?: string; type?: string; is_transient?: boolean }): MetaErrorKind {
  const c = err.code ?? 0;
  if (c === 190 || c === 102 || c === 463 || c === 467) return "token";
  if (c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014)) return "rate_limit";
  if (c === 10 || (c >= 200 && c <= 299) || c === 3) return "permission";
  if (c === 368 || c === 1487390) return "policy";
  if (c === 1 || c === 2 || err.is_transient) return "temporary";
  if (c === 100) return "invalid";
  return "unknown";
}

const MESSAGES: Record<MetaErrorKind, string> = {
  token: "La conexión con Meta venció o fue revocada. Vuelve a conectar la cuenta desde «Cuentas publicitarias».",
  permission: "Meta no otorgó el permiso necesario para esta acción. Revisa que tu usuario tenga acceso a la cuenta y que la app tenga los permisos aprobados.",
  rate_limit: "Meta limitó temporalmente las solicitudes. El sistema reintentará automáticamente más tarde.",
  invalid: "Meta rechazó la solicitud por un dato inválido.",
  policy: "Meta bloqueó la acción por sus políticas publicitarias. Revisa el detalle y ajusta el anuncio.",
  temporary: "Meta respondió con un error temporal. Se reintentará en unos minutos.",
  unknown: "Meta respondió con un error inesperado.",
};

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

/** Lee los encabezados de uso de Meta y devuelve cuánto esperar si se está cerca del límite. */
export function throttleFromHeaders(h: Headers): { pct: number; waitMs: number } {
  let pct = 0;
  let waitMs = 0;
  for (const name of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const raw = h.get(name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const entries: Record<string, unknown>[] = name === "x-business-use-case-usage"
        ? Object.values(parsed as Record<string, Record<string, unknown>[]>).flat()
        : [parsed as Record<string, unknown>];
      for (const e of entries) {
        for (const k of ["call_count", "total_cputime", "total_time", "acc_id_util_pct"]) {
          const v = Number(e[k] ?? 0);
          if (Number.isFinite(v)) pct = Math.max(pct, v);
        }
        const mins = Number(e["estimated_time_to_regain_access"] ?? 0);
        if (mins > 0) waitMs = Math.max(waitMs, mins * 60_000);
        const resetSecs = Number(e["reset_time_duration"] ?? 0);
        if (pct >= 100 && resetSecs > 0) waitMs = Math.max(waitMs, resetSecs * 1000);
      }
    } catch {
      /* encabezado no parseable: se ignora */
    }
  }
  return { pct, waitMs };
}

export type GraphOptions = {
  token: string;
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean | object | undefined>;
  fetchImpl?: FetchLike;
  version?: string;
  appSecret?: string;
};

export function graphUrl(path: string, version = env.metaGraphVersion()): string {
  if (path.startsWith("https://")) return path;
  return `https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`;
}

function encodeParams(params: GraphOptions["params"]): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    sp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return sp;
}

export async function graph<T = Record<string, unknown>>(path: string, opts: GraphOptions): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const method = opts.method ?? "GET";
  const secret = opts.appSecret ?? env.metaAppSecret();
  const params = encodeParams(opts.params);
  const url = new URL(graphUrl(path, opts.version));
  if (opts.token && !url.searchParams.has("access_token")) params.set("access_token", opts.token);
  if (opts.token && secret && !url.searchParams.has("appsecret_proof")) params.set("appsecret_proof", appSecretProof(opts.token, secret));

  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      if (method === "GET" || method === "DELETE") {
        for (const [k, v] of params) url.searchParams.set(k, v);
        res = await doFetch(url.toString(), { method });
      } else {
        res = await doFetch(url.toString(), {
          method,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
      }
    } catch (e) {
      if (attempt < 3) { await sleep(500 * attempt); continue; }
      throw new MetaApiError("temporary", "No fue posible comunicarse con Meta. Revisa la conexión del servidor.", undefined, undefined, undefined);
    }

    const usage = throttleFromHeaders(res.headers);
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* respuesta no JSON */ }

    if (res.ok && !json.error) {
      if (usage.pct >= 90) await sleep(Math.min(usage.waitMs || 2000, 10_000));
      return json as T;
    }

    const err = (json.error ?? {}) as { code?: number; error_subcode?: number; message?: string; type?: string; is_transient?: boolean; fbtrace_id?: string; error_user_msg?: string; error_user_title?: string };
    const kind = classifyMetaError(err);
    if ((kind === "temporary" || (kind === "rate_limit" && usage.waitMs > 0 && usage.waitMs <= 30_000)) && attempt < 3) {
      await sleep(kind === "rate_limit" ? usage.waitMs : 1000 * attempt);
      continue;
    }
    const detail = err.error_user_msg || err.message;
    const msg = detail ? `${MESSAGES[kind]} Detalle de Meta: ${redactString(detail)}` : MESSAGES[kind];
    throw new MetaApiError(kind, msg, err.code, err.error_subcode, err.fbtrace_id, usage.waitMs || undefined);
  }
}

/** Recorre todas las páginas de un listado (con tope de seguridad). */
export async function graphAll<T>(path: string, opts: GraphOptions, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data?: T[]; paging?: { next?: string } }>(path, opts);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    // La URL "next" ya incluye access_token y appsecret_proof.
    page = await graph<{ data?: T[]; paging?: { next?: string } }>(page.paging.next, { ...opts, params: {} });
    out.push(...(page.data ?? []));
  }
  return out;
}

/**
 * Meta expresa los presupuestos en la unidad mínima de la moneda. La mayoría
 * usa factor 100 (centavos); algunas monedas sin decimales usan factor 1.
 * Referencia: tabla de monedas de la Marketing API ("offset").
 */
const OFFSET_1 = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export function currencyOffset(currency: string | null | undefined): number {
  return currency && OFFSET_1.has(currency.toUpperCase()) ? 1 : 100;
}
export function fromMinorUnits(v: string | number | null | undefined, currency: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / currencyOffset(currency) : null;
}
export function toMinorUnits(v: number, currency: string | null | undefined): number {
  return Math.round(v * currencyOffset(currency));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
