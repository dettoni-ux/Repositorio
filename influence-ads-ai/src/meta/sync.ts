/**
 * Sincronización de datos reales desde Meta:
 *  1. discoverAssets: cuentas publicitarias, páginas y perfiles de Instagram autorizados.
 *  2. syncAdAccount: estructura (campañas, conjuntos, anuncios) + métricas diarias
 *     a nivel de anuncio + alcance/frecuencia por periodo.
 * Nada aquí genera datos de ejemplo: si Meta no responde, se registra el error.
 */
import "server-only";
import { q, q1, tx } from "@/lib/db";
import { ACTION_PRIORITY, pickAction, type MetaAction } from "@/lib/metrics";
import { audit } from "@/lib/audit";
import { graphAll, fromMinorUnits, type FetchLike, MetaApiError } from "./graph";
import { connectionToken, handleMetaError } from "./connections";

type RawAdAccount = { id: string; account_id: string; name: string; currency?: string; timezone_name?: string; account_status?: number; business?: { name?: string } };
type RawPage = { id: string; name: string; tasks?: string[]; instagram_business_account?: { id: string; username?: string } };

export async function discoverAssets(orgId: string, connectionId: string, fetchImpl?: FetchLike) {
  const { token } = await connectionToken(orgId, connectionId);
  try {
    const accounts = await graphAll<RawAdAccount>("me/adaccounts", {
      token, fetchImpl,
      params: { fields: "id,account_id,name,currency,timezone_name,account_status,business{name}", limit: 200 },
    });
    const pages = await graphAll<RawPage>("me/accounts", {
      token, fetchImpl,
      params: { fields: "id,name,tasks,instagram_business_account{id,username}", limit: 200 },
    });
    await tx(async (db) => {
      for (const a of accounts) {
        await q(
          `INSERT INTO ad_accounts (org_id, connection_id, meta_account_id, name, currency, timezone_name, account_status, business_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (org_id, meta_account_id) DO UPDATE SET connection_id = EXCLUDED.connection_id, name = EXCLUDED.name,
             currency = EXCLUDED.currency, timezone_name = EXCLUDED.timezone_name, account_status = EXCLUDED.account_status,
             business_name = EXCLUDED.business_name`,
          [orgId, connectionId, a.id, a.name, a.currency ?? null, a.timezone_name ?? null, a.account_status ?? null, a.business?.name ?? null],
          db,
        );
      }
      for (const p of pages) {
        await q(
          `INSERT INTO meta_pages (org_id, connection_id, page_id, name, tasks) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (org_id, page_id) DO UPDATE SET connection_id = EXCLUDED.connection_id, name = EXCLUDED.name, tasks = EXCLUDED.tasks`,
          [orgId, connectionId, p.id, p.name, p.tasks ?? []],
          db,
        );
        const ig = p.instagram_business_account;
        if (ig) {
          await q(
            `INSERT INTO meta_instagram_accounts (org_id, connection_id, ig_user_id, username, page_id) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (org_id, ig_user_id) DO UPDATE SET connection_id = EXCLUDED.connection_id, username = EXCLUDED.username, page_id = EXCLUDED.page_id`,
            [orgId, connectionId, ig.id, ig.username ?? null, p.id],
            db,
          );
        }
      }
    });
    return { accounts: accounts.length, pages: pages.length, instagram: pages.filter((p) => p.instagram_business_account).length };
  } catch (e) {
    await handleMetaError(orgId, connectionId, e);
    throw e;
  }
}

type RawCampaign = { id: string; name: string; objective?: string; status?: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; bid_strategy?: string; created_time?: string };
type RawAdSet = RawCampaign & { campaign_id: string; optimization_goal?: string };
type RawAd = { id: string; name: string; adset_id: string; campaign_id: string; status?: string; effective_status?: string; created_time?: string; creative?: { id: string; title?: string; body?: string; thumbnail_url?: string; call_to_action_type?: string } };
type RawInsight = {
  ad_id: string; adset_id: string; campaign_id: string; date_start: string; date_stop: string;
  spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string;
  actions?: MetaAction[]; action_values?: MetaAction[]; attribution_setting?: string;
};
type RawPeriod = { campaign_id?: string; reach?: string; frequency?: string; impressions?: string; date_start: string; date_stop: string };

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Divide un rango en tramos de N días para no pedir respuestas gigantes. */
export function dateChunks(since: string, until: string, size = 7): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  let start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(start);
    stop.setUTCDate(stop.getUTCDate() + size - 1);
    out.push({ since: isoDate(start), until: isoDate(stop > end ? end : stop) });
    start = new Date(stop);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return out;
}

export function parseInsight(r: RawInsight) {
  return {
    ad_id: r.ad_id,
    adset_id: r.adset_id,
    campaign_id: r.campaign_id,
    date: r.date_start,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    link_clicks: Number(r.inline_link_clicks ?? 0),
    leads: pickAction(r.actions, ACTION_PRIORITY.leads),
    purchases: pickAction(r.actions, ACTION_PRIORITY.purchases),
    purchase_value: pickAction(r.action_values, ACTION_PRIORITY.purchases),
    messaging_conversations: pickAction(r.actions, ACTION_PRIORITY.messaging),
    actions: r.actions ?? null,
    attribution_setting: r.attribution_setting ?? null,
  };
}

export async function syncAdAccount(orgId: string, adAccountId: string, opts: { days?: number; fetchImpl?: FetchLike } = {}) {
  const acc = await q1<{ id: string; meta_account_id: string; connection_id: string | null; currency: string | null }>(
    `SELECT id, meta_account_id, connection_id, currency FROM ad_accounts WHERE id = $1 AND org_id = $2`,
    [adAccountId, orgId],
  );
  if (!acc) throw new Error("Cuenta publicitaria no encontrada");
  const { token } = await connectionToken(orgId, acc.connection_id);
  const fetchImpl = opts.fetchImpl;
  const act = acc.meta_account_id;
  const days = opts.days ?? 28;
  const until = isoDate(new Date());
  const sinceD = new Date();
  sinceD.setUTCDate(sinceD.getUTCDate() - (days - 1));
  const since = isoDate(sinceD);

  try {
    const campaigns = await graphAll<RawCampaign>(`${act}/campaigns`, {
      token, fetchImpl,
      params: { fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,created_time", limit: 200 },
    });
    const adsets = await graphAll<RawAdSet>(`${act}/adsets`, {
      token, fetchImpl,
      params: { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,bid_strategy,created_time", limit: 200 },
    });
    const ads = await graphAll<RawAd>(`${act}/ads`, {
      token, fetchImpl,
      params: { fields: "id,name,adset_id,campaign_id,status,effective_status,created_time,creative{id,title,body,thumbnail_url,call_to_action_type}", limit: 200 },
    });

    const insights: RawInsight[] = [];
    for (const chunk of dateChunks(since, until, 7)) {
      insights.push(...(await graphAll<RawInsight>(`${act}/insights`, {
        token, fetchImpl,
        params: {
          level: "ad", time_increment: 1, time_range: chunk, limit: 500,
          fields: "ad_id,adset_id,campaign_id,spend,impressions,clicks,inline_link_clicks,actions,action_values,attribution_setting,date_start,date_stop",
        },
      })));
    }

    // Alcance y frecuencia no se pueden sumar entre días: se piden por periodo.
    const periods = periodWindows();
    const periodRows: { level: string; object_id: string; p: RawPeriod }[] = [];
    for (const w of periods) {
      const accRows = await graphAll<RawPeriod>(`${act}/insights`, { token, fetchImpl, params: { level: "account", time_range: w, fields: "reach,frequency,impressions,date_start,date_stop" } });
      for (const p of accRows) periodRows.push({ level: "account", object_id: act, p });
      const campRows = await graphAll<RawPeriod>(`${act}/insights`, { token, fetchImpl, params: { level: "campaign", time_range: w, limit: 500, fields: "campaign_id,reach,frequency,impressions,date_start,date_stop" } });
      for (const p of campRows) if (p.campaign_id) periodRows.push({ level: "campaign", object_id: p.campaign_id, p });
    }

    const cur = acc.currency;
    await tx(async (db) => {
      const upsertObj = `INSERT INTO meta_objects (org_id, ad_account_id, level, meta_id, parent_meta_id, campaign_meta_id, name, objective, status, effective_status, daily_budget, lifetime_budget, optimization_goal, bid_strategy, creative, created_time, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
        ON CONFLICT (ad_account_id, level, meta_id) DO UPDATE SET parent_meta_id = EXCLUDED.parent_meta_id, campaign_meta_id = EXCLUDED.campaign_meta_id,
          name = EXCLUDED.name, objective = EXCLUDED.objective, status = EXCLUDED.status, effective_status = EXCLUDED.effective_status,
          daily_budget = EXCLUDED.daily_budget, lifetime_budget = EXCLUDED.lifetime_budget, optimization_goal = EXCLUDED.optimization_goal,
          bid_strategy = EXCLUDED.bid_strategy, creative = EXCLUDED.creative, created_time = EXCLUDED.created_time, updated_at = now()`;
      const objectiveByCampaign = new Map(campaigns.map((c) => [c.id, c.objective ?? null]));
      for (const c of campaigns) {
        await q(upsertObj, [orgId, adAccountId, "campaign", c.id, null, c.id, c.name, c.objective ?? null, c.status ?? null, c.effective_status ?? null,
          fromMinorUnits(c.daily_budget, cur), fromMinorUnits(c.lifetime_budget, cur), null, c.bid_strategy ?? null, null, c.created_time ?? null], db);
      }
      for (const s of adsets) {
        await q(upsertObj, [orgId, adAccountId, "adset", s.id, s.campaign_id, s.campaign_id, s.name, objectiveByCampaign.get(s.campaign_id) ?? null, s.status ?? null, s.effective_status ?? null,
          fromMinorUnits(s.daily_budget, cur), fromMinorUnits(s.lifetime_budget, cur), s.optimization_goal ?? null, s.bid_strategy ?? null, null, s.created_time ?? null], db);
      }
      for (const a of ads) {
        await q(upsertObj, [orgId, adAccountId, "ad", a.id, a.adset_id, a.campaign_id, a.name, objectiveByCampaign.get(a.campaign_id) ?? null, a.status ?? null, a.effective_status ?? null,
          null, null, null, null, a.creative ? JSON.stringify(a.creative) : null, a.created_time ?? null], db);
      }
      // Reemplaza las métricas del rango sincronizado (Meta reprocesa atribución hacia atrás).
      await q(`DELETE FROM insights_daily WHERE ad_account_id = $1 AND date BETWEEN $2 AND $3`, [adAccountId, since, until], db);
      for (const raw of insights) {
        const r = parseInsight(raw);
        await q(
          `INSERT INTO insights_daily (org_id, ad_account_id, level, object_id, campaign_meta_id, adset_meta_id, date, spend, impressions, clicks, link_clicks, leads, purchases, purchase_value, messaging_conversations, actions, attribution_setting)
           VALUES ($1,$2,'ad',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (ad_account_id, level, object_id, date) DO UPDATE SET spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
             link_clicks = EXCLUDED.link_clicks, leads = EXCLUDED.leads, purchases = EXCLUDED.purchases, purchase_value = EXCLUDED.purchase_value,
             messaging_conversations = EXCLUDED.messaging_conversations, actions = EXCLUDED.actions, attribution_setting = EXCLUDED.attribution_setting, synced_at = now()`,
          [orgId, adAccountId, r.ad_id, r.campaign_id, r.adset_id, r.date, r.spend, r.impressions, r.clicks, r.link_clicks, r.leads, r.purchases, r.purchase_value, r.messaging_conversations,
           r.actions ? JSON.stringify(r.actions) : null, r.attribution_setting],
          db,
        );
      }
      for (const { level, object_id, p } of periodRows) {
        await q(
          `INSERT INTO insights_period (org_id, ad_account_id, level, object_id, date_start, date_stop, reach, frequency, impressions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (ad_account_id, level, object_id, date_start, date_stop) DO UPDATE SET reach = EXCLUDED.reach, frequency = EXCLUDED.frequency, impressions = EXCLUDED.impressions, synced_at = now()`,
          [orgId, adAccountId, level, object_id, p.date_start, p.date_stop, p.reach ? Number(p.reach) : null, p.frequency ? Number(p.frequency) : null, p.impressions ? Number(p.impressions) : null],
          db,
        );
      }
      await q(`UPDATE ad_accounts SET last_synced_at = now(), sync_error = NULL WHERE id = $1`, [adAccountId], db);
    });
    return { campaigns: campaigns.length, adsets: adsets.length, ads: ads.length, insightRows: insights.length, since, until };
  } catch (e) {
    await handleMetaError(orgId, acc.connection_id, e);
    const msg = e instanceof MetaApiError ? e.userMessage : (e as Error).message;
    await q(`UPDATE ad_accounts SET sync_error = $2 WHERE id = $1`, [adAccountId, msg.slice(0, 1000)]);
    await audit({ orgId, actor: "system", action: "meta.sync_failed", entity: "ad_account", entityId: adAccountId, details: { error: msg } });
    throw e;
  }
}

/** Ventanas para alcance/frecuencia: últimos 7 y 30 días, y los periodos anteriores equivalentes. */
export function periodWindows(today = new Date()): { since: string; until: string }[] {
  const d = (offset: number) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - offset); return isoDate(x); };
  return [
    { since: d(6), until: d(0) },
    { since: d(13), until: d(7) },
    { since: d(29), until: d(0) },
    { since: d(59), until: d(30) },
  ];
}
