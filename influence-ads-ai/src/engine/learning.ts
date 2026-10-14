/**
 * Base de conocimiento por cliente: experimentos, aprendizajes y resultados
 * observados. Nunca mezcla datos entre clientes.
 */
import "server-only";
import { q } from "@/lib/db";
import { derive, primaryResult, sumRows, type Totals } from "@/lib/metrics";
import { poissonRateP, twoProportionP } from "@/lib/stats";

export type ExperimentResult = {
  computedAt: string;
  since: string;
  variants: { adId: string; name: string; spend: number; impressions: number; linkClicks: number; results: number; costPerResult: number | null; ctr: number | null }[];
  verdict: "sin_datos" | "sin_evidencia" | "ganador";
  winner?: string;
  explanation: string;
};

/** Evalúa un experimento comparando sus anuncios con pruebas estadísticas. */
export function evaluateVariants(objective: string | null, rows: { adId: string; name: string; t: Totals }[], minConversions: number): Omit<ExperimentResult, "computedAt" | "since"> {
  const variants = rows.map((r) => {
    const res = primaryResult(objective, r.t);
    const d = derive(r.t);
    return { adId: r.adId, name: r.name, spend: r.t.spend, impressions: r.t.impressions, linkClicks: r.t.link_clicks, results: res.value, costPerResult: res.cost, ctr: d.linkCtr };
  });
  if (variants.length < 2 || variants.every((v) => v.spend === 0)) {
    return { variants, verdict: "sin_datos", explanation: "Sin datos suficientes: se necesitan al menos dos anuncios con inversión." };
  }
  const ranked = [...variants].filter((v) => v.results > 0).sort((a, b) => (a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity));
  if (ranked.length < 2 || ranked.some((v) => v.results < minConversions)) {
    const ctrP = variants.length >= 2 ? twoProportionP(variants[0].linkClicks, variants[0].impressions, variants[1].linkClicks, variants[1].impressions) : null;
    return {
      variants, verdict: "sin_evidencia",
      explanation: `Aún no hay suficientes resultados (mínimo ${minConversions} por anuncio) para declarar un ganador. ${ctrP !== null && ctrP < 0.05 ? "Hay diferencias de CTR significativas, pero el CTR no garantiza mejores resultados de negocio." : ""}`.trim(),
    };
  }
  const best = ranked[0];
  const second = ranked[1];
  const p = poissonRateP(best.results, best.spend, second.results, second.spend);
  if (p !== null && p < 0.05) {
    return { variants, verdict: "ganador", winner: best.adId, explanation: `«${best.name}» obtiene resultados a menor costo con diferencia estadísticamente significativa (p = ${p.toFixed(3)}).` };
  }
  return { variants, verdict: "sin_evidencia", explanation: `La diferencia entre «${best.name}» y «${second.name}» todavía puede deberse al azar (p = ${p?.toFixed(2) ?? "n/d"}). Continúa la prueba.` };
}

export async function computeExperiment(orgId: string, experimentId: string, minConversions: number): Promise<ExperimentResult | null> {
  const [e] = await q<{ ad_account_id: string | null; meta_refs: { ads?: Record<string, string>; campaignId?: string } | null; launched_at: string | null; objective: string }>(
    `SELECT ad_account_id, meta_refs, launched_at, objective FROM experiments WHERE id = $1 AND org_id = $2`, [experimentId, orgId]);
  if (!e?.ad_account_id || !e.meta_refs?.campaignId) return null;
  const since = (e.launched_at ? new Date(e.launched_at) : new Date(Date.now() - 30 * 86400000)).toISOString().slice(0, 10);
  const rows = await q<Totals & { object_id: string; date: string }>(
    `SELECT object_id, date, spend, impressions, clicks, link_clicks, leads, purchases, purchase_value, messaging_conversations FROM insights_daily
      WHERE ad_account_id = $1 AND campaign_meta_id = $2 AND date >= $3`, [e.ad_account_id, e.meta_refs.campaignId, since]);
  const names = await q<{ meta_id: string; name: string; objective: string | null }>(`SELECT meta_id, name, objective FROM meta_objects WHERE ad_account_id = $1 AND level = 'ad' AND campaign_meta_id = $2`, [e.ad_account_id, e.meta_refs.campaignId]);
  const byAd = new Map<string, (Totals & { date: string })[]>();
  for (const r of rows) byAd.set(r.object_id, [...(byAd.get(r.object_id) ?? []), r]);
  const objective = names[0]?.objective ?? null;
  const evaluated = evaluateVariants(objective, names.map((n) => ({ adId: n.meta_id, name: n.name, t: sumRows(byAd.get(n.meta_id) ?? []) })), minConversions);
  return { ...evaluated, computedAt: new Date().toISOString(), since };
}

/** Resumen del historial de UN cliente para alimentar a la IA. */
export async function clientHistory(orgId: string, clientId: string): Promise<string> {
  const learnings = await q<{ kind: string; statement: string; confidence: string | null }>(
    `SELECT kind, statement, confidence FROM learnings WHERE org_id = $1 AND client_id = $2 AND active ORDER BY created_at DESC LIMIT 30`, [orgId, clientId]);
  const exps = await q<{ name: string; hypothesis: string; status: string; decision: string | null; outcome: string | null; result: ExperimentResult | null }>(
    `SELECT name, hypothesis, status, decision, outcome, result FROM experiments WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 15`, [orgId, clientId]);
  const top = await q<{ name: string; title: string | null; body: string | null; spend: number; leads: number; purchases: number; link_clicks: number; impressions: number }>(
    `SELECT o.name, o.creative->>'title' title, o.creative->>'body' body, SUM(i.spend) spend, SUM(i.leads) leads, SUM(i.purchases) purchases, SUM(i.link_clicks) link_clicks, SUM(i.impressions) impressions
       FROM insights_daily i JOIN ad_accounts a ON a.id = i.ad_account_id
       JOIN meta_objects o ON o.ad_account_id = i.ad_account_id AND o.level = 'ad' AND o.meta_id = i.object_id
      WHERE a.org_id = $1 AND a.client_id = $2 AND i.date >= current_date - 90
      GROUP BY o.name, o.creative HAVING SUM(i.spend) > 0 ORDER BY SUM(i.spend) DESC LIMIT 12`, [orgId, clientId]);
  const parts: string[] = [];
  if (learnings.length) parts.push("Aprendizajes registrados:\n" + learnings.map((l) => `- [${l.kind}${l.confidence ? `, confianza ${l.confidence}` : ""}] ${l.statement}`).join("\n"));
  if (exps.length) parts.push("Experimentos:\n" + exps.map((e) => `- ${e.name} (${e.status}). Hipótesis: ${e.hypothesis}.${e.result ? ` Resultado: ${e.result.explanation}` : ""}${e.decision ? ` Decisión: ${e.decision}.` : ""}${e.outcome ? ` Después: ${e.outcome}.` : ""}`).join("\n"));
  if (top.length) {
    parts.push("Anuncios con más inversión en los últimos 90 días (datos observados en Meta):\n" + top.map((t) => {
      const conv = t.purchases > 0 ? `${t.purchases} compras` : `${t.leads} leads`;
      const ctr = t.impressions >= 500 ? `${((t.link_clicks / t.impressions) * 100).toFixed(2)} % CTR` : "CTR sin datos suficientes";
      return `- «${t.name}»: gasto ${Math.round(t.spend)}, ${conv}, ${ctr}${t.title ? `. Titular: ${t.title}` : ""}${t.body ? `. Texto: ${t.body.slice(0, 160)}` : ""}`;
    }).join("\n"));
  }
  return parts.join("\n\n");
}
