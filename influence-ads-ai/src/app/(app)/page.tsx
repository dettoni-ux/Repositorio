import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { visibleClientIds } from "@/lib/tenancy";
import { integrationStatus } from "@/lib/env";
import { resolvePeriod, summaryByClient, performance, realConversions, scopeAccounts, totalsFor } from "@/lib/reporting";
import { derive, pctChange } from "@/lib/metrics";
import { money, int, pct, relative, dateTime } from "@/lib/format";
import { PageHead, Card, Stat, Flash, Badge, Notice, Empty } from "@/components/ui";
import type { Finding } from "@/engine/diagnosis";

export default async function Inicio({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const period = resolvePeriod(sp.periodo ?? "7d");
  const ids = client ? [client.id] : await visibleClientIds(ctx);
  const status = integrationStatus();

  const accounts = await scopeAccounts(ctx, client?.id ?? null);
  const accIds = accounts.map((a) => a.id);
  const currencies = [...new Set(accounts.map((a) => a.currency ?? "CLP"))];
  const cur = currencies.length === 1 ? currencies[0] : null;
  const [totals, prev, perClient, ads, real] = await Promise.all([
    totalsFor(accIds, period.since, period.until),
    totalsFor(accIds, period.prevSince, period.prevUntil),
    client ? Promise.resolve([]) : summaryByClient(ctx, period),
    performance(ctx, client?.id ?? null, "ad", period),
    realConversions(ctx, client?.id ?? null, period.since, period.until),
  ]);
  const d = derive(totals);
  const pd = derive(prev);
  const results = totals.leads + totals.purchases + totals.messaging_conversations;
  const prevResults = prev.leads + prev.purchases + prev.messaging_conversations;
  const cpr = results > 0 ? totals.spend / results : null;
  const prevCpr = prevResults > 0 ? prev.spend / prevResults : null;

  const withResults = ads.filter((a) => a.result.value >= 3 && a.result.cost !== null);
  const good = [...withResults].sort((a, b) => a.result.cost! - b.result.cost!).slice(0, 5);
  const medianCost = withResults.length ? [...withResults].map((a) => a.result.cost!).sort((a, b) => a - b)[Math.floor(withResults.length / 2)] : null;
  const poor = ads
    .filter((a) => a.totals.spend > 0 && medianCost !== null && ((a.result.value === 0 && a.totals.spend >= medianCost * 2) || (a.result.cost !== null && a.result.cost >= medianCost * 1.8 && a.result.value >= 3)))
    .sort((a, b) => b.totals.spend - a.totals.spend).slice(0, 5);

  const diagnoses = ids.length ? await q<{ client_id: string; name: string; findings: Finding[]; created_at: string }>(
    `SELECT DISTINCT ON (d.client_id) d.client_id, c.name, d.findings, d.created_at FROM diagnoses d JOIN clients c ON c.id = d.client_id
      WHERE d.org_id = $1 AND d.client_id = ANY($2::uuid[]) ORDER BY d.client_id, d.created_at DESC`, [ctx.orgId, ids]) : [];
  const attention = diagnoses.flatMap((x) => x.findings.filter((f) => f.severity === "alta" || f.severity === "media").map((f) => ({ ...f, clientName: x.name, clientId: x.client_id }))).slice(0, 6);
  const proposals = ids.length ? await q<{ id: string; title: string; type: string; confidence: string; client_name: string }>(
    `SELECT a.id, a.title, a.type, a.confidence, c.name client_name FROM proposed_actions a JOIN clients c ON c.id = a.client_id
      WHERE a.org_id = $1 AND a.client_id = ANY($2::uuid[]) AND a.status = 'proposed' ORDER BY a.created_at DESC LIMIT 5`, [ctx.orgId, ids]) : [];
  const autoDone = ids.length ? await q<{ title: string; executed_at: string; client_name: string }>(
    `SELECT a.title, a.executed_at, c.name client_name FROM proposed_actions a JOIN clients c ON c.id = a.client_id
      WHERE a.org_id = $1 AND a.client_id = ANY($2::uuid[]) AND a.status = 'executed' ORDER BY a.executed_at DESC LIMIT 5`, [ctx.orgId, ids]) : [];
  const toReview = ids.length ? await q<{ n: number; kind: string }>(
    `SELECT 'conceptos' kind, COUNT(*)::int n FROM creative_concepts WHERE org_id = $1 AND client_id = ANY($2::uuid[]) AND status = 'proposed'
     UNION ALL SELECT 'piezas', COUNT(*)::int FROM creatives WHERE org_id = $1 AND client_id = ANY($2::uuid[]) AND status = 'draft' AND output_asset_id IS NOT NULL`, [ctx.orgId, ids]) : [];
  const alerts = await q<{ kind: string; text: string }>(
    `SELECT 'conexion' kind, 'La conexión de Meta de ' || COALESCE(meta_user_name, meta_user_id) || ' está ' || CASE status WHEN 'expired' THEN 'vencida' ELSE 'con error' END text FROM meta_connections WHERE org_id = $1 AND status IN ('expired','error')
     UNION ALL SELECT 'conexion', 'La conexión de Meta de ' || COALESCE(meta_user_name, meta_user_id) || ' vence pronto (' || to_char(token_expires_at, 'DD-MM-YYYY') || ')' FROM meta_connections WHERE org_id = $1 AND status = 'active' AND token_expires_at < now() + interval '7 days'
     UNION ALL SELECT 'sync', 'Error al sincronizar ' || name || ': ' || sync_error FROM ad_accounts WHERE org_id = $1 AND managed AND sync_error IS NOT NULL AND client_id = ANY($2::uuid[])
     UNION ALL SELECT 'cuenta', 'La cuenta ' || name || ' no está activa en Meta' FROM ad_accounts WHERE org_id = $1 AND managed AND account_status IS NOT NULL AND account_status <> 1 AND client_id = ANY($2::uuid[])
     UNION ALL SELECT 'publicacion', 'Falló la publicación del borrador «' || name || '»' FROM campaign_drafts WHERE org_id = $1 AND status = 'failed' AND client_id = ANY($2::uuid[])`,
    [ctx.orgId, ids]);
  const lastSync = accounts.map((a) => a.last_synced_at).filter(Boolean).sort()[0] ?? null;
  const reviewCount = toReview.reduce((s, r) => s + r.n, 0);

  return (
    <>
      <PageHead title={client ? client.name : "Panel de la agencia"} subtitle={<>{period.label} · {accounts.length} cuenta(s) administrada(s) · datos de Meta actualizados {relative(lastSync)}{lastSync ? ` (${dateTime(lastSync)})` : ""}</>}
        actions={<div className="row">{(["7d", "14d", "30d"] as const).map((p) => <Link key={p} className={`btn small ${(sp.periodo ?? "7d") === p ? "primary" : ""}`} href={`/?periodo=${p}${client ? `&cliente=${client.id}` : ""}`}>{p.replace("d", " días")}</Link>)}</div>} />
      <Flash sp={sp} />
      {(!status.meta.ok || !status.ai.ok || !status.crypto.ok) && (
        <Notice tone="warn"><b>Configuración pendiente:</b> {[status.meta, status.ai, status.crypto].filter((s) => !s.ok).map((s) => s.label).join(" · ")}. <Link href="/configuracion">Ver cómo completarla</Link>. El sistema no muestra datos ficticios: verás «Sin datos suficientes» hasta conectar fuentes reales.</Notice>
      )}

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "linear-gradient(120deg,#ffffff 0%,#f1edff 100%)", marginBottom: 16 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>¿Qué quieres lograr hoy?</h2>
          <p className="muted" style={{ margin: 0 }}>Elige el cliente y el objetivo: la IA prepara estrategia, creatividades y la campaña para que solo revises y apruebes.</p>
        </div>
        <Link href={`/crear${client ? `?cliente=${client.id}` : ""}`} className="btn primary btn-hero">✦ CREAR CAMPAÑA CON IA</Link>
      </div>

      {alerts.length > 0 && <Notice tone="bad"><b>Alertas importantes</b><ul style={{ margin: "6px 0 0" }}>{alerts.slice(0, 6).map((a, i) => <li key={i}>{a.text}</li>)}</ul></Notice>}

      <div className="grid g4">
        <Stat label="Inversión" value={cur ? money(totals.spend, cur) : currencies.length ? "Varias monedas: ver por cliente" : money(totals.spend)} delta={pctChange(totals.spend, prev.spend)} goodWhen="up" />
        <Stat label="Resultados (leads, compras, conversaciones)" value={int(results)} delta={pctChange(results, prevResults)} />
        <Stat label="Costo por resultado" value={cur ? money(cpr, cur) : "—"} delta={pctChange(cpr, prevCpr)} goodWhen="down" />
        <Stat label="CTR del enlace" value={pct(d.linkCtr)} delta={pctChange(d.linkCtr, pd.linkCtr)} />
      </div>
      <div className="grid g4" style={{ marginTop: 16 }}>
        <Stat label="Ventas reales registradas" value={int(real.sale)} hint={real.sale ? `Ingresos ${cur ? money(real.revenue, cur) : int(real.revenue)}` : "Registra ventas en Resultados → Ventas y leads"} />
        <Stat label="Leads calificados (reales)" value={int(real.qualified_lead)} hint={`${int(real.lead + real.qualified_lead)} leads registrados`} />
        <Stat label="ROAS (Meta)" value={d.roas === null ? "Sin datos suficientes" : `${d.roas.toFixed(2).replace(".", ",")}x`} hint="Solo con compras y valor medidos" />
        <Stat label="Pendiente de revisión" value={int(reviewCount)} hint={toReview.map((t) => `${t.n} ${t.kind}`).join(" · ")} />
      </div>

      {!client && (
        <Card title="Clientes administrados" className="" actions={<Link className="btn small" href="/clientes">Ver todos</Link>}>
          {perClient.length === 0 ? <Empty title="Sin clientes" action={<Link className="btn primary" href="/clientes/nuevo">Crear cliente</Link>} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Cliente</th><th className="num">Cuentas</th><th className="num">Inversión</th><th className="num">Leads</th><th className="num">Compras</th><th className="num">Costo por lead</th><th className="num">Costo por compra</th><th>Datos</th></tr></thead>
              <tbody>{perClient.map((c) => (
                <tr key={c.clientId}>
                  <td><Link href={`/?cliente=${c.clientId}`}><b>{c.name}</b></Link></td>
                  <td className="num">{c.accounts}</td>
                  <td className="num">{c.accounts ? money(c.totals.spend, c.currency) : "—"}</td>
                  <td className="num">{c.accounts ? int(c.totals.leads) : "—"}</td>
                  <td className="num">{c.accounts ? int(c.totals.purchases) : "—"}</td>
                  <td className="num">{c.accounts ? money(c.derived.cpl, c.currency) : "—"}</td>
                  <td className="num">{c.accounts ? money(c.derived.cpa, c.currency) : "—"}</td>
                  <td>{c.accounts === 0 ? <Badge tone="warn">Sin cuentas</Badge> : c.syncErrors ? <Badge tone="bad">Error de sincronización</Badge> : <small>{relative(c.lastSync)}</small>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Campañas que necesitan atención" actions={<Link className="btn small" href="/recomendaciones">Diagnóstico</Link>}>
          {attention.length === 0 ? <p className="muted">Sin alertas en el último diagnóstico. Ejecuta uno en «Recomendaciones».</p> : attention.map((f) => (
            <div key={`${f.clientId}-${f.key}`} className={`finding ${f.severity}`}>
              <b>{f.title}</b> <Badge>{f.clientName}</Badge><br /><small>{f.what}</small>
            </div>
          ))}
        </Card>
        <Card title="Recomendaciones de la IA" actions={<Link className="btn small" href="/recomendaciones">Ver todas</Link>}>
          {proposals.length === 0 ? <p className="muted">No hay recomendaciones pendientes.</p> : <ul>{proposals.map((p) => <li key={p.id}>{p.title} <Badge>{p.client_name}</Badge> <Badge tone={p.confidence === "alta" ? "ok" : p.confidence === "media" ? "warn" : undefined}>confianza {p.confidence}</Badge></li>)}</ul>}
        </Card>
        <Card title="Anuncios con buenos resultados">
          {good.length === 0 ? <p className="muted">Sin datos suficientes (se necesitan al menos 3 resultados por anuncio).</p> : <AdList ads={good} />}
        </Card>
        <Card title="Anuncios con resultados deficientes">
          {poor.length === 0 ? <p className="muted">Sin anuncios deficientes con evidencia suficiente.</p> : <AdList ads={poor} />}
        </Card>
        <Card title="Acciones ejecutadas" actions={<Link className="btn small" href="/automatizaciones">Historial</Link>}>
          {autoDone.length === 0 ? <p className="muted">Todavía no se han ejecutado acciones.</p> : <ul>{autoDone.map((a, i) => <li key={i}>{a.title} <Badge>{a.client_name}</Badge> <small>{relative(a.executed_at)}</small></li>)}</ul>}
        </Card>
        <Card title="Creatividades listas para revisar" actions={<Link className="btn small" href="/laboratorio">Laboratorio</Link>}>
          {reviewCount === 0 ? <p className="muted">Nada pendiente.</p> : <ul>{toReview.filter((t) => t.n).map((t) => <li key={t.kind}>{t.n} {t.kind} por revisar</li>)}</ul>}
        </Card>
      </div>
    </>
  );
}

function AdList({ ads }: { ads: Awaited<ReturnType<typeof performance>> }) {
  return (
    <table><tbody>{ads.map((a) => (
      <tr key={`${a.ad_account_id}-${a.meta_id}`}>
        <td style={{ width: 64 }}>{a.creative?.thumbnail_url ? <img className="thumb" src={a.creative.thumbnail_url} alt="" referrerPolicy="no-referrer" /> : <div className="thumb" />}</td>
        <td><b>{a.name}</b><br /><small>{a.client_name} · {a.campaign_name}</small></td>
        <td className="num">{int(a.result.value)} {a.result.label.toLowerCase()}<br /><small>{money(a.result.cost, a.currency ?? "CLP")} c/u</small></td>
      </tr>
    ))}</tbody></table>
  );
}
