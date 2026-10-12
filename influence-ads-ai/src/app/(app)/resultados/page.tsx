import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { dailySeries, performance, realConversions, resolvePeriod, scopeAccounts, summaryByClient, totalsFor } from "@/lib/reporting";
import { derive, pctChange, safeDiv } from "@/lib/metrics";
import { money, int, pct, dec, relative, dateTime } from "@/lib/format";
import { PageHead, Card, Stat, Flash, Badge, Notice, Empty } from "@/components/ui";
import { PerfTable } from "@/components/perf-table";
import { PeriodFilter } from "@/components/period-filter";
import type { ExperimentResult } from "@/engine/learning";
import { addConversion, deleteConversion, createWebhook, revokeWebhook, evaluateExperiment, concludeExperiment, updateOutcome, addLearning, toggleLearning } from "@/app/actions/results";

const KIND_LABEL: Record<string, string> = { conversation: "Conversación", lead: "Lead", qualified_lead: "Lead calificado", sale: "Venta" };
const SOURCE_LABEL: Record<string, string> = { manual: "Manual", whatsapp: "WhatsApp", crm: "CRM", ecommerce: "Tienda online", web: "Sitio web" };

export default async function Resultados({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const tab = sp.tab ?? "resumen";
  const period = resolvePeriod(sp.periodo, sp.periodo === "custom" ? { since: sp.desde, until: sp.hasta } : undefined);
  const qs = (t: string) => `/resultados?${new URLSearchParams({ ...sp, tab: t, ...(client ? { cliente: client.id } : {}) }).toString()}`;

  return (
    <>
      <PageHead title="Resultados" subtitle={client ? client.name : "Vista agregada de la agencia"} />
      <Flash sp={sp} />
      <div className="tabs">
        <Link href={qs("resumen")} className={tab === "resumen" ? "active" : ""}>Resumen</Link>
        <Link href={qs("experimentos")} className={tab === "experimentos" ? "active" : ""}>Experimentos y aprendizajes</Link>
        <Link href={qs("ventas")} className={tab === "ventas" ? "active" : ""}>Ventas y leads reales</Link>
      </div>
      {tab === "resumen" && <Resumen ctx={ctx} client={client} period={period} sp={sp} />}
      {tab !== "resumen" && !client && <Notice tone="info">Elige un cliente en el selector superior: los experimentos, aprendizajes y ventas se gestionan por cliente y no se mezclan entre clientes.</Notice>}
      {tab === "experimentos" && client && <Experimentos ctx={ctx} clientId={client.id} />}
      {tab === "ventas" && client && <Ventas ctx={ctx} clientId={client.id} currency={client.currency} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireSession>>;

async function Resumen({ ctx, client, period, sp }: { ctx: Ctx; client: Awaited<ReturnType<typeof activeClient>>; period: ReturnType<typeof resolvePeriod>; sp: Record<string, string> }) {
  const accounts = await scopeAccounts(ctx, client?.id ?? null);
  const ids = accounts.map((a) => a.id);
  const currencies = [...new Set(accounts.map((a) => a.currency ?? "CLP"))];
  const cur = currencies.length === 1 ? currencies[0] : null;
  const [t, p, series, campaigns, real, perClient] = await Promise.all([
    totalsFor(ids, period.since, period.until), totalsFor(ids, period.prevSince, period.prevUntil), dailySeries(ids, period.since, period.until),
    performance(ctx, client?.id ?? null, "campaign", period), realConversions(ctx, client?.id ?? null, period.since, period.until),
    client ? Promise.resolve([]) : summaryByClient(ctx, period),
  ]);
  const d = derive(t), pd = derive(p);
  const lastSync = accounts.map((a) => a.last_synced_at).filter(Boolean).sort()[0] ?? null;
  const m = (v: number | null) => (cur ? money(v, cur) : v === null ? "Sin datos suficientes" : "Varias monedas");
  const realRoas = safeDiv(real.revenue, t.spend);
  const metaLeads = t.leads, realLeads = real.lead + real.qualified_lead;

  return (
    <>
      <PeriodFilter sp={sp} />
      <p className="hint">Periodo {period.since} a {period.until}, comparado con {period.prevSince} a {period.prevUntil}. Última actualización desde Meta: {dateTime(lastSync)} ({relative(lastSync)}). Las métricas se calculan en el servidor sumando componentes; si el volumen es bajo se muestra «Sin datos suficientes».</p>
      {accounts.length === 0 ? <Card><Empty title="Sin cuentas administradas">Conecta Meta y asigna cuentas a este cliente para ver resultados reales.</Empty></Card> : (
        <>
          <div className="grid g4">
            <Stat label="Importe gastado" value={m(t.spend)} delta={pctChange(t.spend, p.spend)} />
            <Stat label="Impresiones" value={int(t.impressions)} delta={pctChange(t.impressions, p.impressions)} hint="El alcance y la frecuencia se muestran por campaña (no son sumables por día)" />
            <Stat label="CPM" value={m(d.cpm)} delta={pctChange(d.cpm, pd.cpm)} goodWhen="down" />
            <Stat label="Clics (todos) · CTR" value={<>{int(t.clicks)} · {pct(d.ctr)}</>} delta={pctChange(d.ctr, pd.ctr)} />
            <Stat label="Clics en el enlace · CPC" value={<>{int(t.link_clicks)} · {m(d.cpc)}</>} delta={pctChange(d.cpc, pd.cpc)} goodWhen="down" />
            <Stat label="Leads (Meta) · costo por lead" value={<>{int(t.leads)} · {m(d.cpl)}</>} delta={pctChange(d.cpl, pd.cpl)} goodWhen="down" />
            <Stat label="Compras (Meta) · costo por compra" value={<>{int(t.purchases)} · {m(d.cpa)}</>} delta={pctChange(d.cpa, pd.cpa)} goodWhen="down" />
            <Stat label="ROAS (Meta)" value={d.roas === null ? "Sin datos suficientes" : `${dec(d.roas)}x`} delta={pctChange(d.roas, pd.roas)} hint={t.purchase_value ? `Valor de compras ${m(t.purchase_value)}` : undefined} />
          </div>

          <Card title="Meta vs. resultados reales del negocio">
            <p className="hint">Meta atribuye según su ventana de atribución y puede modelar conversiones; el registro real proviene de tu CRM, tienda o registros manuales. No se suman entre sí para evitar duplicados.</p>
            <div className="table-wrap"><table>
              <thead><tr><th></th><th className="num">Meta</th><th className="num">Registro real</th><th>Lectura</th></tr></thead>
              <tbody>
                <tr><td>Conversaciones</td><td className="num">{int(t.messaging_conversations)}</td><td className="num">{int(real.conversation)}</td><td><small>Una conversación no es un lead ni una venta.</small></td></tr>
                <tr><td>Leads</td><td className="num">{int(metaLeads)}</td><td className="num">{int(realLeads)} <small>({int(real.qualified_lead)} calificados)</small></td><td><small>{realLeads ? `Tasa de calificación: ${pct(safeDiv(real.qualified_lead, realLeads))}` : "Registra la calidad de los leads para evaluar mejor."}</small></td></tr>
                <tr><td>Ventas</td><td className="num">{int(t.purchases)}</td><td className="num">{int(real.sale)}</td><td><small>{real.sale ? `Costo por venta real: ${m(safeDiv(t.spend, real.sale))}` : "Sin ventas registradas en el periodo."}</small></td></tr>
                <tr><td>Ingresos</td><td className="num">{m(t.purchase_value || null)}</td><td className="num">{real.revenue ? m(real.revenue) : "—"}</td><td><small>{realRoas !== null && real.revenue ? `Retorno real sobre inversión: ${dec(realRoas)}x${real.margin ? ` · margen ${m(real.margin)}` : ""}` : "—"}</small></td></tr>
              </tbody>
            </table></div>
          </Card>

          {!client && perClient.length > 0 && (
            <Card title="Por cliente">
              <div className="table-wrap"><table>
                <thead><tr><th>Cliente</th><th className="num">Inversión</th><th className="num">Variación</th><th className="num">CTR enlace</th><th className="num">Leads</th><th className="num">Compras</th><th className="num">Costo por lead</th><th className="num">ROAS</th></tr></thead>
                <tbody>{perClient.filter((c) => c.accounts).map((c) => {
                  const ch = pctChange(c.totals.spend, c.prev.spend);
                  return (
                    <tr key={c.clientId}><td><Link href={`/resultados?cliente=${c.clientId}`}>{c.name}</Link></td><td className="num">{money(c.totals.spend, c.currency)}</td>
                      <td className="num">{ch === null ? "—" : `${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(0)} %`}</td><td className="num">{pct(c.derived.linkCtr)}</td>
                      <td className="num">{int(c.totals.leads)}</td><td className="num">{int(c.totals.purchases)}</td><td className="num">{money(c.derived.cpl, c.currency)}</td>
                      <td className="num">{c.derived.roas === null ? "—" : `${dec(c.derived.roas)}x`}</td></tr>
                  );
                })}</tbody>
              </table></div>
            </Card>
          )}

          <Card title="Campañas">
            {campaigns.length === 0 ? <Empty title="Sin datos suficientes" /> : <PerfTable rows={campaigns.filter((c) => c.totals.spend > 0 || c.effective_status === "ACTIVE")} showClient={!client} />}
          </Card>

          <Card title="Evolución diaria">
            {series.length === 0 ? <p className="muted">Sin datos suficientes en el periodo.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Fecha</th><th className="num">Inversión</th><th className="num">Impresiones</th><th className="num">Clics enlace</th><th className="num">CTR enlace</th><th className="num">Leads</th><th className="num">Compras</th><th className="num">Conversaciones</th></tr></thead>
                <tbody>{series.map((r) => { const dd = derive(r); return (
                  <tr key={r.date}><td>{r.date}</td><td className="num">{m(r.spend)}</td><td className="num">{int(r.impressions)}</td><td className="num">{int(r.link_clicks)}</td><td className="num">{pct(dd.linkCtr)}</td><td className="num">{int(r.leads)}</td><td className="num">{int(r.purchases)}</td><td className="num">{int(r.messaging_conversations)}</td></tr>
                ); })}</tbody>
              </table></div>
            )}
            <p className="hint">Los últimos días pueden seguir cambiando por el retraso de atribución de Meta (hasta 7 días para clics y 1 día para visualizaciones, según la configuración de la cuenta).</p>
          </Card>
        </>
      )}
    </>
  );
}

async function Experimentos({ ctx, clientId }: { ctx: Ctx; clientId: string }) {
  const exps = await q<{ id: string; name: string; objective: string; hypothesis: string; primary_metric: string; status: string; launched_at: string | null; review_at: string | null; budget: number | null; result: ExperimentResult | null; decision: string | null; outcome: string | null; created_at: string; attribution_setting: string | null }>(
    `SELECT * FROM experiments WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 50`, [clientId, ctx.orgId]);
  const learnings = await q<{ id: string; kind: string; statement: string; confidence: string | null; active: boolean; evidence: { text?: string } | null; created_at: string }>(
    `SELECT id, kind, statement, confidence, active, evidence, created_at FROM learnings WHERE client_id = $1 AND org_id = $2 ORDER BY active DESC, created_at DESC LIMIT 100`, [clientId, ctx.orgId]);
  const canW = can(ctx.role, "campaign.draft");
  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <Card title="Experimentos">
        <p className="hint">Cada campaña publicada desde aquí queda registrada como experimento con su hipótesis. Un ganador solo se declara con volumen suficiente y diferencia estadísticamente significativa.</p>
        {exps.length === 0 ? <Empty title="Sin experimentos">Se crean automáticamente al publicar campañas.</Empty> : exps.map((e) => (
          <div key={e.id} className="finding info" style={{ marginBottom: 12 }}>
            <div className="row between"><b>{e.name}</b><Badge tone={e.status === "running" ? "primary" : e.status === "concluded" ? "ok" : undefined}>{{ planned: "Planificado", running: "En curso", concluded: "Concluido", cancelled: "Cancelado" }[e.status]}</Badge></div>
            <small>Hipótesis: {e.hypothesis} · Métrica: {e.primary_metric} · Lanzado: {e.launched_at ? dateTime(e.launched_at) : "—"} · Revisar: {e.review_at ? dateTime(e.review_at) : "—"}</small>
            {e.result && (
              <div style={{ marginTop: 8 }}>
                <Badge tone={e.result.verdict === "ganador" ? "ok" : "warn"}>{e.result.verdict === "ganador" ? "Ganador con evidencia" : e.result.verdict === "sin_datos" ? "Sin datos suficientes" : "Sin evidencia suficiente"}</Badge> <small>{e.result.explanation}</small>
                <table style={{ marginTop: 6 }}><tbody>{e.result.variants.map((v) => <tr key={v.adId}><td>{v.name}{e.result?.winner === v.adId && " 🏆"}</td><td className="num">{int(v.results)} res.</td><td className="num">{v.costPerResult === null ? "—" : dec(v.costPerResult, 0)} c/u</td><td className="num">{pct(v.ctr)}</td></tr>)}</tbody></table>
              </div>
            )}
            {e.decision && <p style={{ marginTop: 6 }}><b>Decisión:</b> {e.decision}{e.outcome && <><br /><b>Resultado posterior:</b> {e.outcome}</>}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              {e.status !== "planned" && <form action={evaluateExperiment.bind(null, clientId, e.id)}><button className="btn small">Evaluar con datos actuales</button></form>}
            </div>
            {canW && e.status !== "concluded" && (
              <details style={{ marginTop: 8 }}><summary>Cerrar experimento</summary>
                <form action={concludeExperiment.bind(null, clientId, e.id)} style={{ marginTop: 8 }}>
                  <div className="field"><label>Decisión tomada</label><input type="text" name="decision" required /></div>
                  <div className="field"><label>Resultado posterior (si ya se conoce)</label><input type="text" name="outcome" /></div>
                  <div className="field"><label>Aprendizaje</label><input type="text" name="learning" /></div>
                  <div className="row"><select name="kind" style={{ width: "auto" }}><option value="observado">Dato observado</option><option value="hipotesis">Hipótesis</option><option value="conclusion">Conclusión</option></select>
                    <select name="confidence" style={{ width: "auto" }}><option value="baja">Confianza baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
                    <button className="btn small primary">Cerrar</button></div>
                </form>
              </details>
            )}
            {canW && e.status === "concluded" && (
              <form action={updateOutcome.bind(null, clientId, e.id)} className="row" style={{ marginTop: 8 }}>
                <input type="text" name="outcome" defaultValue={e.outcome ?? ""} placeholder="¿Qué pasó después de la decisión?" style={{ flex: 1 }} /><button className="btn small">Guardar</button>
              </form>
            )}
          </div>
        ))}
      </Card>
      <Card title="Base de conocimiento del cliente">
        <p className="hint">Solo se usa para este cliente. Distingue datos observados, hipótesis y conclusiones (las conclusiones requieren evidencia).</p>
        {canW && (
          <form action={addLearning.bind(null, clientId)} style={{ marginBottom: 14 }}>
            <div className="field"><label>Aprendizaje</label><input type="text" name="statement" placeholder="Ej.: los videos con demostración tienen mejor CTR que las fotos de catálogo" required /></div>
            <div className="field"><label>Evidencia</label><input type="text" name="evidence" placeholder="Datos que lo respaldan (obligatorio para conclusiones)" /></div>
            <div className="row">
              <select name="kind" style={{ width: "auto" }}><option value="observado">Dato observado</option><option value="hipotesis">Hipótesis</option><option value="conclusion">Conclusión</option></select>
              <select name="confidence" style={{ width: "auto" }}><option value="baja">Confianza baja</option><option value="media">Media</option><option value="alta">Alta</option></select>
              <button className="btn small primary">Agregar</button>
            </div>
          </form>
        )}
        {learnings.length === 0 ? <p className="muted">Aún no hay aprendizajes.</p> : (
          <table><tbody>{learnings.map((l) => (
            <tr key={l.id} style={{ opacity: l.active ? 1 : 0.5 }}>
              <td><Badge tone={l.kind === "conclusion" ? "ok" : l.kind === "hipotesis" ? "warn" : undefined}>{{ observado: "Observado", hipotesis: "Hipótesis", conclusion: "Conclusión" }[l.kind]}</Badge></td>
              <td>{l.statement}{l.evidence?.text && <><br /><small>Evidencia: {l.evidence.text}</small></>}<br /><small>Confianza {l.confidence ?? "—"} · {dateTime(l.created_at)}</small></td>
              <td>{canW && <form action={toggleLearning.bind(null, clientId, l.id, !l.active)}><button className="btn ghost small">{l.active ? "Archivar" : "Reactivar"}</button></form>}</td>
            </tr>
          ))}</tbody></table>
        )}
      </Card>
    </div>
  );
}

async function Ventas({ ctx, clientId, currency }: { ctx: Ctx; clientId: string; currency: string }) {
  const rows = await q<{ id: string; kind: string; source: string; external_id: string; occurred_at: string; value: number | null; margin: number | null; campaign_meta_id: string | null; notes: string | null }>(
    `SELECT id, kind, source, external_id, occurred_at, value, margin, campaign_meta_id, notes FROM conversions WHERE client_id = $1 AND org_id = $2 ORDER BY occurred_at DESC LIMIT 100`, [clientId, ctx.orgId]);
  const campaigns = await q<{ meta_id: string; name: string }>(`SELECT o.meta_id, o.name FROM meta_objects o JOIN ad_accounts a ON a.id = o.ad_account_id WHERE a.client_id = $1 AND a.org_id = $2 AND o.level = 'campaign' ORDER BY o.name`, [clientId, ctx.orgId]);
  const hooks = await q<{ id: string; name: string; source: string; secret_enc: string; revoked_at: string | null; last_used_at: string | null }>(`SELECT id, name, source, secret_enc, revoked_at, last_used_at FROM inbound_webhooks WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`, [clientId, ctx.orgId]);
  const campName = new Map(campaigns.map((c) => [c.meta_id, c.name]));
  const canAdmin = can(ctx.role, "automation.configure");
  return (
    <>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <Card title="Registrar resultado comercial">
          <p className="hint">Ej.: una conversación de WhatsApp que terminó en lead calificado o venta. Distingue clics, conversaciones, leads, ventas, ingresos y margen.</p>
          {can(ctx.role, "conversions.write") && (
            <form action={addConversion.bind(null, clientId)}>
              <div className="grid g2">
                <div className="field"><label>Tipo</label><select name="kind">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="field"><label>Origen</label><select name="source">{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="field"><label>Fecha</label><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                <div className="field"><label>Campaña de origen</label><select name="campaignMetaId"><option value="">No se sabe</option>{campaigns.map((c) => <option key={c.meta_id} value={c.meta_id}>{c.name}</option>)}</select></div>
                <div className="field"><label>Monto de la venta ({currency})</label><input type="text" name="value" inputMode="decimal" /></div>
                <div className="field"><label>Margen ({currency})</label><input type="text" name="margin" inputMode="decimal" /></div>
              </div>
              <div className="field"><label>Identificador <span className="hint">· nº de pedido o teléfono; evita registrar dos veces lo mismo</span></label><input type="text" name="externalId" /></div>
              <div className="field"><label>Nota</label><input type="text" name="notes" /></div>
              <input type="hidden" name="currency" value={currency} />
              <button className="btn primary">Registrar</button>
            </form>
          )}
        </Card>
        <Card title="Integraciones automáticas (CRM, tienda, sitio)">
          <p className="hint">Tu CRM o tienda puede enviar eventos firmados a la URL de la integración. Formato: <code>{`{"events":[{"external_id":"pedido-123","kind":"sale","occurred_at":"2026-10-01T15:00:00-03:00","value":49990,"campaign_id":"…"}]}`}</code> con el encabezado <code>X-Signature</code> = HMAC-SHA256 del cuerpo usando la clave. Los duplicados se ignoran.</p>
          {canAdmin && (
            <form action={createWebhook.bind(null, clientId)} className="row" style={{ marginBottom: 12 }}>
              <input type="text" name="name" placeholder="Nombre (ej.: Shopify)" style={{ maxWidth: 200 }} />
              <select name="source" style={{ width: "auto" }}><option value="crm">CRM</option><option value="ecommerce">Tienda online</option><option value="web">Sitio web</option><option value="whatsapp">WhatsApp</option></select>
              <button className="btn small primary">Crear integración</button>
            </form>
          )}
          {hooks.length === 0 ? <p className="muted">Sin integraciones.</p> : <table><tbody>{hooks.map((h) => (
            <tr key={h.id}><td><b>{h.name}</b> <Badge>{SOURCE_LABEL[h.source]}</Badge> {h.revoked_at && <Badge tone="bad">Revocada</Badge>}<br /><small>Último uso: {relative(h.last_used_at)}</small>
              {canAdmin && !h.revoked_at && <details><summary>Ver clave y URL</summary><p><small>URL: <code>{env.appUrl()}/api/webhooks/conversions/{h.id}</code></small><br /><small>Clave: <code>{decrypt(h.secret_enc)}</code></small></p></details>}
            </td><td>{canAdmin && !h.revoked_at && <form action={revokeWebhook.bind(null, clientId, h.id)}><button className="btn small">Revocar</button></form>}</td></tr>
          ))}</tbody></table>}
        </Card>
      </div>
      <Card title="Registros recientes">
        {rows.length === 0 ? <Empty title="Sin registros">Registra ventas y la calidad de los leads para que el sistema no premie anuncios que solo generan mensajes baratos.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Origen</th><th>Campaña</th><th className="num">Monto</th><th className="num">Margen</th><th>Identificador</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{dateTime(r.occurred_at)}</td><td>{KIND_LABEL[r.kind]}</td><td>{SOURCE_LABEL[r.source]}</td><td>{r.campaign_meta_id ? campName.get(r.campaign_meta_id) ?? r.campaign_meta_id : <small>—</small>}</td>
                <td className="num">{r.value !== null ? money(r.value, currency) : "—"}</td><td className="num">{r.margin !== null ? money(r.margin, currency) : "—"}</td><td><small>{r.external_id}</small></td>
                <td>{can(ctx.role, "conversions.write") && <form action={deleteConversion.bind(null, clientId, r.id)}><button className="btn ghost small">Eliminar</button></form>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
