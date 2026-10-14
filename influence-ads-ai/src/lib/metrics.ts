/**
 * Métricas derivadas. Se calculan SIEMPRE en el backend a partir de sumas de
 * componentes (nunca promediando ratios). Si el denominador no alcanza el
 * mínimo, el resultado es null y la UI muestra "Sin datos suficientes".
 */

export type MetricRow = {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  leads: number;
  purchases: number;
  purchase_value: number;
  messaging_conversations: number;
};

export type Totals = MetricRow & { days: number };

export type Derived = {
  ctr: number | null;          // clics (todos) / impresiones
  linkCtr: number | null;      // clics en el enlace / impresiones
  cpm: number | null;
  cpc: number | null;          // costo por clic en el enlace
  cpl: number | null;          // costo por lead
  cpa: number | null;          // costo por compra
  costPerMessage: number | null;
  roas: number | null;
  convRate: number | null;     // leads o compras / clics en el enlace
};

export const MIN_DENOMINATORS = {
  impressionsForRates: 500,
  clicksForCpc: 10,
  conversionsForCost: 1,
  spendForRoas: 1,
};

export function emptyTotals(): Totals {
  return { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, leads: 0, purchases: 0, purchase_value: 0, messaging_conversations: 0, days: 0 };
}

export function sumRows(rows: Partial<MetricRow>[]): Totals {
  const t = emptyTotals();
  const dates = new Set<string>();
  for (const r of rows) {
    t.spend += num(r.spend);
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.link_clicks += num(r.link_clicks);
    t.leads += num(r.leads);
    t.purchases += num(r.purchases);
    t.purchase_value += num(r.purchase_value);
    t.messaging_conversations += num(r.messaging_conversations);
    const d = (r as { date?: string }).date;
    if (d) dates.add(d);
  }
  t.days = dates.size;
  t.spend = round2(t.spend);
  t.purchase_value = round2(t.purchase_value);
  return t;
}

export function safeDiv(n: number, d: number, minDenominator = Number.EPSILON): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d < minDenominator || d <= 0) return null;
  return n / d;
}

export function derive(t: MetricRow): Derived {
  const conv = t.purchases > 0 ? t.purchases : t.leads;
  return {
    ctr: safeDiv(t.clicks, t.impressions, MIN_DENOMINATORS.impressionsForRates),
    linkCtr: safeDiv(t.link_clicks, t.impressions, MIN_DENOMINATORS.impressionsForRates),
    cpm: mul(safeDiv(t.spend, t.impressions, MIN_DENOMINATORS.impressionsForRates), 1000),
    cpc: safeDiv(t.spend, t.link_clicks, MIN_DENOMINATORS.clicksForCpc),
    cpl: safeDiv(t.spend, t.leads, MIN_DENOMINATORS.conversionsForCost),
    cpa: safeDiv(t.spend, t.purchases, MIN_DENOMINATORS.conversionsForCost),
    costPerMessage: safeDiv(t.spend, t.messaging_conversations, MIN_DENOMINATORS.conversionsForCost),
    roas: t.purchase_value > 0 ? safeDiv(t.purchase_value, t.spend, MIN_DENOMINATORS.spendForRoas) : null,
    convRate: safeDiv(conv, t.link_clicks, MIN_DENOMINATORS.clicksForCpc),
  };
}

/** Resultado principal según el objetivo de la campaña de Meta. */
export function primaryResult(objective: string | null | undefined, t: MetricRow): { label: string; value: number; cost: number | null } {
  switch (objective) {
    case "OUTCOME_SALES":
      return { label: "Compras", value: t.purchases, cost: safeDiv(t.spend, t.purchases) };
    case "OUTCOME_LEADS":
      return { label: "Leads", value: t.leads, cost: safeDiv(t.spend, t.leads) };
    case "OUTCOME_ENGAGEMENT":
      return { label: "Conversaciones", value: t.messaging_conversations, cost: safeDiv(t.spend, t.messaging_conversations) };
    case "OUTCOME_TRAFFIC":
      return { label: "Clics en el enlace", value: t.link_clicks, cost: safeDiv(t.spend, t.link_clicks) };
    default: {
      if (t.purchases > 0) return { label: "Compras", value: t.purchases, cost: safeDiv(t.spend, t.purchases) };
      if (t.leads > 0) return { label: "Leads", value: t.leads, cost: safeDiv(t.spend, t.leads) };
      if (t.messaging_conversations > 0) return { label: "Conversaciones", value: t.messaging_conversations, cost: safeDiv(t.spend, t.messaging_conversations) };
      return { label: "Clics en el enlace", value: t.link_clicks, cost: safeDiv(t.spend, t.link_clicks, MIN_DENOMINATORS.clicksForCpc) };
    }
  }
}

/** Variación relativa entre periodos; null si el periodo base no tiene datos. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Extrae conversiones del arreglo `actions` de Meta. Toma UN solo tipo de acción
 * por prioridad (los tipos agregados ya incluyen a los específicos), para no
 * contar dos veces la misma conversión.
 */
export const ACTION_PRIORITY = {
  leads: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
  purchases: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"],
  messaging: ["onsite_conversion.messaging_conversation_started_7d"],
  linkClicks: ["link_click"],
} as const;

export type MetaAction = { action_type: string; value: string | number };

export function pickAction(actions: MetaAction[] | undefined | null, priority: readonly string[]): number {
  if (!actions?.length) return 0;
  for (const type of priority) {
    const a = actions.find((x) => x.action_type === type);
    if (a) return num(a.value);
  }
  return 0;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function mul(v: number | null, k: number) {
  return v === null ? null : v * k;
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}
