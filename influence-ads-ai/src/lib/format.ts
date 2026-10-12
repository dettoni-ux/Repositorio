/** Formatos de presentación (es-CL). Los valores null se muestran como "Sin datos suficientes". */
export const NO_DATA = "Sin datos suficientes";

const ZERO_DECIMALS = new Set(["CLP", "COP", "JPY", "KRW", "PYG", "CRC", "HUF", "ISK", "IDR", "TWD", "VND"]);

export function money(v: number | null | undefined, currency = "CLP"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_DATA;
  const d = ZERO_DECIMALS.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat("es-CL", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  } catch {
    return `${v.toFixed(d)} ${currency}`;
  }
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_DATA;
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(v);
}

export function dec(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_DATA;
  return new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_DATA;
  return `${dec(v * 100, digits)} %`;
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "nunca";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(v));
}

export function relative(v: string | Date | null | undefined): string {
  if (!v) return "nunca";
  const mins = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activa", PAUSED: "Pausada", DELETED: "Eliminada", ARCHIVED: "Archivada", IN_PROCESS: "En proceso", WITH_ISSUES: "Con problemas",
  CAMPAIGN_PAUSED: "Campaña pausada", ADSET_PAUSED: "Conjunto pausado", DISAPPROVED: "Rechazado", PENDING_REVIEW: "En revisión", PREAPPROVED: "Preaprobado",
  PENDING_BILLING_INFO: "Falta facturación",
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Clientes potenciales", OUTCOME_SALES: "Ventas", OUTCOME_TRAFFIC: "Tráfico", OUTCOME_ENGAGEMENT: "Interacción / mensajes",
  OUTCOME_AWARENESS: "Reconocimiento", OUTCOME_APP_PROMOTION: "Promoción de app",
};
