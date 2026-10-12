/**
 * Consultas de resultados. Todas reciben un contexto de sesión y filtran por
 * organización + clientes visibles. Las métricas derivadas se calculan aquí
 * (backend) con denominadores validados.
 */
import "server-only";
import { q, q1 } from "./db";
import { derive, sumRows, primaryResult, type Totals, type Derived, emptyTotals } from "./metrics";
import { visibleClientIds, type Ctx } from "./tenancy";

export type Period = { since: string; until: string; label: string; prevSince: string; prevUntil: string; days: number };

export const PERIOD_PRESETS = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 } as const;

export function resolvePeriod(preset: string | undefined, custom?: { since?: string; until?: string }, today = new Date()): Period {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (base: string, n: number) => { const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  let since: string;
  let until: string;
  let label: string;
  if (custom?.since && custom?.until && /^\d{4}-\d{2}-\d{2}$/.test(custom.since) && /^\d{4}-\d{2}-\d{2}$/.test(custom.until) && custom.since <= custom.until) {
    since = custom.since;
    until = custom.until;
    label = `${since} a ${until}`;
  } else {
    const n = PERIOD_PRESETS[(preset as keyof typeof PERIOD_PRESETS) ?? "7d"] ?? 7;
    until = iso(today);
    since = shift(until, -(n - 1));
    label = `Últimos ${n} días`;
  }
  const days = Math.round((Date.parse(until) - Date.parse(since)) / 86400000) + 1;
  return { since, until, label, days, prevUntil: shift(since, -1), prevSince: shift(since, -days) };
}

/** Cuentas publicitarias administradas visibles, opcionalmente de un solo cliente. */
export async function scopeAccounts(ctx: Ctx, clientId: string | null): Promise<{ id: string; client_id: string; name: string; currency: string | null; last_synced_at: string | null; sync_error: string | null; meta_account_id: string }[]> {
  const visible = await visibleClientIds(ctx);
  const ids = clientId ? visible.filter((v) => v === clientId) : visible;
  if (!ids.length) return [];
  return q(
    `SELECT id, client_id, name, currency, last_synced_at, sync_error, meta_account_id FROM ad_accounts
      WHERE org_id = $1 AND managed AND client_id = ANY($2::uuid[]) ORDER BY name`,
    [ctx.orgId, ids],
  );
}

const SUMS = `COALESCE(SUM(spend),0) spend, COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks,
  COALESCE(SUM(link_clicks),0) link_clicks, COALESCE(SUM(leads),0) leads, COALESCE(SUM(purchases),0) purchases,
  COALESCE(SUM(purchase_value),0) purchase_value, COALESCE(SUM(messaging_conversations),0) messaging_conversations, COUNT(DISTINCT date) days`;

export async function totalsFor(accountIds: string[], since: string, until: string): Promise<Totals> {
  if (!accountIds.length) return emptyTotals();
  const row = await q1<Totals>(`SELECT ${SUMS} FROM insights_daily WHERE ad_account_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3`, [accountIds, since, until]);
  return row ?? emptyTotals();
}

export async function dailySeries(accountIds: string[], since: string, until: string) {
  if (!accountIds.length) return [];
  return q<Totals & { date: string }>(
    `SELECT date, ${SUMS} FROM insights_daily WHERE ad_account_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3 GROUP BY date ORDER BY date`,
    [accountIds, since, until],
  );
}

export type ClientSummary = { clientId: string; name: string; currency: string; accounts: number; totals: Totals; derived: Derived; prev: Totals; lastSync: string | null; syncErrors: number };

export async function summaryByClient(ctx: Ctx, period: Period): Promise<ClientSummary[]> {
  const visible = await visibleClientIds(ctx);
  if (!visible.length) return [];
  const clients = await q<{ id: string; name: string; currency: string }>(`SELECT id, name, currency FROM clients WHERE id = ANY($1::uuid[]) AND status = 'active' ORDER BY name`, [visible]);
  const accounts = await q<{ id: string; client_id: string; last_synced_at: string | null; sync_error: string | null }>(
    `SELECT id, client_id, last_synced_at, sync_error FROM ad_accounts WHERE org_id = $1 AND managed AND client_id = ANY($2::uuid[])`, [ctx.orgId, visible]);
  const out: ClientSummary[] = [];
  for (const c of clients) {
    const accs = accounts.filter((a) => a.client_id === c.id);
    const ids = accs.map((a) => a.id);
    const totals = await totalsFor(ids, period.since, period.until);
    const prev = await totalsFor(ids, period.prevSince, period.prevUntil);
    const syncs = accs.map((a) => a.last_synced_at).filter(Boolean) as string[];
    out.push({
      clientId: c.id, name: c.name, currency: c.currency, accounts: accs.length, totals, prev, derived: derive(totals),
      lastSync: syncs.length ? syncs.sort()[0] : null, syncErrors: accs.filter((a) => a.sync_error).length,
    });
  }
  return out;
}

export type ObjectPerf = {
  ad_account_id: string;
  meta_id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  objective: string | null;
  status: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  campaign_meta_id: string | null;
  campaign_name?: string | null;
  created_time: string | null;
  creative: { title?: string; body?: string; thumbnail_url?: string } | null;
  client_id: string;
  client_name: string;
  account_name: string;
  currency: string | null;
  totals: Totals;
  prev: Totals;
  derived: Derived;
  prevDerived: Derived;
  result: ReturnType<typeof primaryResult>;
  prevResult: ReturnType<typeof primaryResult>;
  frequency: number | null;
  prevFrequency: number | null;
};

/** Rendimiento por campaña / conjunto / anuncio, periodo actual vs anterior. */
export async function performance(ctx: Ctx, clientId: string | null, level: "campaign" | "adset" | "ad", period: Period): Promise<ObjectPerf[]> {
  const accs = await scopeAccounts(ctx, clientId);
  if (!accs.length) return [];
  const ids = accs.map((a) => a.id);
  const key = level === "campaign" ? "campaign_meta_id" : level === "adset" ? "adset_meta_id" : "object_id";
  const agg = (since: string, until: string) => q<Totals & { ad_account_id: string; k: string }>(
    `SELECT ad_account_id, ${key} k, ${SUMS} FROM insights_daily WHERE ad_account_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3 GROUP BY ad_account_id, ${key}`,
    [ids, since, until],
  );
  const [cur, prev, objects, freq] = await Promise.all([
    agg(period.since, period.until),
    agg(period.prevSince, period.prevUntil),
    q<{ ad_account_id: string; meta_id: string; name: string; objective: string | null; status: string | null; effective_status: string | null; daily_budget: number | null; campaign_meta_id: string | null; created_time: string | null; creative: ObjectPerf["creative"]; campaign_name: string | null }>(
      `SELECT o.ad_account_id, o.meta_id, o.name, o.objective, o.status, o.effective_status, o.daily_budget, o.campaign_meta_id, o.created_time, o.creative,
              (SELECT c.name FROM meta_objects c WHERE c.ad_account_id = o.ad_account_id AND c.level = 'campaign' AND c.meta_id = o.campaign_meta_id) campaign_name
         FROM meta_objects o WHERE o.ad_account_id = ANY($1::uuid[]) AND o.level = $2`,
      [ids, level],
    ),
    level === "campaign"
      ? q<{ object_id: string; date_start: string; date_stop: string; frequency: number | null }>(
          `SELECT object_id, date_start, date_stop, frequency FROM insights_period WHERE ad_account_id = ANY($1::uuid[]) AND level = 'campaign' AND ((date_start = $2 AND date_stop = $3) OR (date_start = $4 AND date_stop = $5))`,
          [ids, period.since, period.until, period.prevSince, period.prevUntil])
      : Promise.resolve([]),
  ]);
  const clientNames = new Map((await q<{ id: string; name: string }>(`SELECT id, name FROM clients WHERE id = ANY($1::uuid[])`, [accs.map((a) => a.client_id)])).map((c) => [c.id, c.name]));
  const accById = new Map(accs.map((a) => [a.id, a]));
  const k = (acc: string, id: string) => `${acc}:${id}`;
  const curMap = new Map(cur.map((r) => [k(r.ad_account_id, r.k), r]));
  const prevMap = new Map(prev.map((r) => [k(r.ad_account_id, r.k), r]));
  const out: ObjectPerf[] = [];
  for (const o of objects) {
    const acc = accById.get(o.ad_account_id)!;
    const t = curMap.get(k(o.ad_account_id, o.meta_id)) ?? emptyTotals();
    const p = prevMap.get(k(o.ad_account_id, o.meta_id)) ?? emptyTotals();
    const f = freq.find((x) => x.object_id === o.meta_id && x.date_start === period.since && x.date_stop === period.until);
    const pf = freq.find((x) => x.object_id === o.meta_id && x.date_start === period.prevSince && x.date_stop === period.prevUntil);
    out.push({
      ...o, level, client_id: acc.client_id, client_name: clientNames.get(acc.client_id) ?? "", account_name: acc.name, currency: acc.currency,
      totals: sumRows([t]), prev: sumRows([p]), derived: derive(t), prevDerived: derive(p),
      result: primaryResult(o.objective, t), prevResult: primaryResult(o.objective, p),
      frequency: f?.frequency ?? null, prevFrequency: pf?.frequency ?? null,
    });
  }
  return out.sort((a, b) => b.totals.spend - a.totals.spend);
}

/** Ventas y leads reales registrados (CRM, WhatsApp, tienda) en el periodo. */
export async function realConversions(ctx: Ctx, clientId: string | null, since: string, until: string) {
  const visible = await visibleClientIds(ctx);
  const ids = clientId ? visible.filter((v) => v === clientId) : visible;
  if (!ids.length) return { conversation: 0, lead: 0, qualified_lead: 0, sale: 0, revenue: 0, margin: 0, byCampaign: [] as { campaign_meta_id: string; kind: string; n: number; revenue: number }[] };
  const rows = await q<{ kind: string; n: number; revenue: number; margin: number }>(
    `SELECT kind, COUNT(*)::int n, COALESCE(SUM(value),0) revenue, COALESCE(SUM(margin),0) margin FROM conversions
      WHERE org_id = $1 AND client_id = ANY($2::uuid[]) AND occurred_at::date BETWEEN $3 AND $4 GROUP BY kind`,
    [ctx.orgId, ids, since, until],
  );
  const byCampaign = await q<{ campaign_meta_id: string; kind: string; n: number; revenue: number }>(
    `SELECT campaign_meta_id, kind, COUNT(*)::int n, COALESCE(SUM(value),0) revenue FROM conversions
      WHERE org_id = $1 AND client_id = ANY($2::uuid[]) AND campaign_meta_id IS NOT NULL AND occurred_at::date BETWEEN $3 AND $4 GROUP BY campaign_meta_id, kind`,
    [ctx.orgId, ids, since, until],
  );
  const get = (k: string) => rows.find((r) => r.kind === k);
  return {
    conversation: get("conversation")?.n ?? 0,
    lead: get("lead")?.n ?? 0,
    qualified_lead: get("qualified_lead")?.n ?? 0,
    sale: get("sale")?.n ?? 0,
    revenue: rows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.revenue, 0),
    margin: rows.filter((r) => r.kind === "sale").reduce((s, r) => s + r.margin, 0),
    byCampaign,
  };
}
