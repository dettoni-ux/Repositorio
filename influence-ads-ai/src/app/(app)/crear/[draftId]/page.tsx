import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { integrationStatus } from "@/lib/env";
import { BUSINESS_OBJECTIVES, META_OBJECTIVE } from "@/lib/schemas";
import { loadDraft, validationFor } from "@/engine/draft-service";
import { canPublish, CTA_TYPES } from "@/engine/drafts";
import { money } from "@/lib/format";
import { PageHead, Card, Flash, Badge, Notice, Empty } from "@/components/ui";
import { ConceptCard, type ConceptView, type CreativeView } from "@/components/concept-card";
import { SubmitButton } from "@/components/submit-button";
import { moreConcepts, regenerateStrategy, saveStructure, publishDraft, activateDraft, discardDraft } from "@/app/actions/drafts";

const STATUS: Record<string, [string, "ok" | "warn" | "bad" | "primary" | undefined]> = {
  draft: ["Borrador", undefined], ready: ["Lista", "primary"], publishing: ["Publicando…", "warn"], published_paused: ["Creada en Meta (en pausa)", "warn"],
  active: ["Activa", "ok"], failed: ["Falló la publicación", "bad"], discarded: ["Descartada", undefined],
};

export default async function DraftPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const { draftId } = await params;
  const sp = await searchParams;
  const { draft, client } = await loadDraft(ctx, draftId);
  const back = `/crear/${draftId}`;
  const ai = integrationStatus().ai;
  const concepts = await q<ConceptView>(`SELECT * FROM creative_concepts WHERE draft_id = $1 AND org_id = $2 ORDER BY status = 'discarded', created_at`, [draftId, ctx.orgId]);
  const creatives = await q<CreativeView>(`SELECT id, concept_id, format, status, output_asset_id FROM creatives WHERE concept_id = ANY($1::uuid[]) ORDER BY created_at`, [concepts.map((k) => k.id)]);
  const accounts = await q<{ id: string; name: string; currency: string | null; meta_account_id: string }>(`SELECT id, name, currency, meta_account_id FROM ad_accounts WHERE client_id = $1 AND org_id = $2 AND managed ORDER BY name`, [client.id, ctx.orgId]);
  const pages = await q<{ page_id: string; name: string }>(`SELECT page_id, name FROM meta_pages WHERE client_id = $1 AND org_id = $2 ORDER BY name`, [client.id, ctx.orgId]);
  const igs = await q<{ ig_user_id: string; username: string | null }>(`SELECT ig_user_id, username FROM meta_instagram_accounts WHERE client_id = $1 AND org_id = $2`, [client.id, ctx.orgId]);
  const checks = await validationFor(ctx, draft, client);
  const ready = canPublish(checks);
  const s = draft.structure;
  const st = STATUS[draft.status] ?? [draft.status, undefined];
  const editable = ["draft", "ready", "failed"].includes(draft.status);
  const strategy = draft.strategy;
  const currency = accounts.find((a) => a.id === s.adAccountId)?.currency ?? client.currency;
  const approved = concepts.filter((k) => k.status === "approved");
  const pendingClaims = approved.flatMap((k) => k.needs_verification);
  const mem = client.wizard_memory as { lastPixelId?: string };

  return (
    <>
      <PageHead title={draft.name} subtitle={<>{client.name} · {BUSINESS_OBJECTIVES[draft.objective]} ({META_OBJECTIVE[draft.objective]}) · <Badge tone={st[1]}>{st[0]}</Badge></>}
        actions={editable && <form action={discardDraft.bind(null, draftId)}><button className="btn small">Descartar borrador</button></form>} />
      <Flash sp={sp} />
      <div className="steps">
        <span className={strategy ? "done" : "on"}>1. Estrategia</span>
        <span className={approved.length ? "done" : strategy ? "on" : ""}>2. Conceptos y piezas</span>
        <span className={s.ads.length ? "done" : approved.length ? "on" : ""}>3. Configuración</span>
        <span className={draft.status === "published_paused" || draft.status === "active" ? "done" : ready ? "on" : ""}>4. Revisión y publicación</span>
      </div>

      <Card title="1. Estrategia" actions={ai.ok && editable && <form action={regenerateStrategy.bind(null, draftId)}><SubmitButton className="btn small" pendingText="Regenerando…">Regenerar</SubmitButton></form>}>
        {!strategy ? <p className="muted">Sin estrategia generada{ai.ok ? "." : ": la IA no está configurada."}</p> : (
          <>
            <dl className="kv">
              <dt>Producto</dt><dd>{strategy.product}</dd>
              <dt>Problema que resuelve</dt><dd>{strategy.problem}</dd>
              <dt>Público con más afinidad</dt><dd>{strategy.audience}</dd>
              <dt>Objeciones</dt><dd>{strategy.objections.join(" · ")}</dd>
              <dt>Propuesta de valor</dt><dd>{strategy.valueProposition}</dd>
              <dt>Enfoque creativo</dt><dd>{strategy.creativeApproach}</dd>
              <dt>Prueba / respaldo</dt><dd>{strategy.proof}</dd>
              <dt>Llamada a la acción</dt><dd>{strategy.cta}</dd>
              <dt>Destino</dt><dd>{strategy.destination}</dd>
              <dt>Métrica de éxito</dt><dd>{strategy.successMetric}</dd>
              <dt>Presupuesto</dt><dd>{strategy.budgetAdvice}</dd>
              <dt>Hipótesis a probar</dt><dd>{strategy.hypotheses.join(" · ")}</dd>
              <dt>Riesgos</dt><dd>{strategy.risks.join(" · ")}</dd>
            </dl>
            <p className="hint" style={{ marginTop: 8 }}><b>Por qué:</b> {strategy.rationale}</p>
            {strategy.missingInfo.length > 0 && <Notice tone="warn"><b>Para mejorar la propuesta, completa en la ficha:</b> {strategy.missingInfo.join(" · ")} — <Link href={`/clientes/${client.id}`}>editar ficha</Link></Notice>}
          </>
        )}
      </Card>

      <Card title={`2. Conceptos creativos (${concepts.filter((k) => k.status !== "discarded").length})`} actions={ai.ok && editable && (
        <form action={moreConcepts.bind(null, draftId)} className="row">
          <input type="number" name="count" min={1} max={6} defaultValue={3} style={{ width: 70 }} />
          <SubmitButton className="btn small" pendingText="Generando…">Generar más</SubmitButton>
        </form>
      )}>
        <p className="hint">Ningún concepto está garantizado: son hipótesis distintas para probar. Aprueba los que quieras testear y crea sus piezas (feed 4:5 y Stories/Reels 9:16).</p>
        {concepts.length === 0 ? <Empty title="Sin conceptos">{ai.ok ? "Pulsa «Generar más»." : "Configura la IA para generarlos automáticamente."}</Empty> : (
          <div className="grid g2">{concepts.map((k) => (
            <ConceptCard key={k.id} k={k} creatives={creatives.filter((c) => c.concept_id === k.id)} back={back} canApprove={can(ctx.role, "creative.approve")} canWrite={can(ctx.role, "creative.write") && editable} aiOk={ai.ok} />
          ))}</div>
        )}
      </Card>

      <Card title="3. Configuración de la campaña">
        {editable ? (
          <form action={saveStructure.bind(null, draftId)}>
            <div className="grid g3">
              <div className="field"><label>Cuenta publicitaria</label>
                <select name="adAccountId" defaultValue={s.adAccountId ?? ""}><option value="">Elegir…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.meta_account_id})</option>)}</select>
                {accounts.length === 0 && <small>Asigna una cuenta en <Link href="/cuentas">Cuentas publicitarias</Link>.</small>}
              </div>
              <div className="field"><label>Página de Facebook</label>
                <select name="pageId" defaultValue={s.pageId ?? ""}><option value="">Elegir…</option>{pages.map((p) => <option key={p.page_id} value={p.page_id}>{p.name}</option>)}</select>
              </div>
              <div className="field"><label>Perfil de Instagram <span className="hint">· opcional</span></label>
                <select name="instagramUserId" defaultValue={s.instagramUserId ?? ""}><option value="">Usar la página</option>{igs.map((p) => <option key={p.ig_user_id} value={p.ig_user_id}>@{p.username ?? p.ig_user_id}</option>)}</select>
              </div>
            </div>
            <div className="grid g3">
              <div className="field"><label>Presupuesto diario ({currency})</label><input type="text" name="dailyBudget" inputMode="decimal" defaultValue={s.dailyBudget ?? ""} required /></div>
              <div className="field"><label>Destino</label>
                <select name="destination" defaultValue={s.destination}>
                  <option value="website">Sitio web</option><option value="whatsapp">WhatsApp</option><option value="instant_form">Formulario instantáneo de Meta</option>
                </select>
              </div>
              <div className="field"><label>Fecha de inicio <span className="hint">· opcional</span></label><input type="date" name="startTime" defaultValue={s.startTime?.slice(0, 10) ?? ""} /></div>
            </div>
            <div className="grid g3">
              <div className="field"><label>Página de destino (https)</label><input type="url" name="url" defaultValue={s.url ?? ""} /></div>
              <div className="field"><label>ID del píxel / conjunto de datos <span className="hint">· ventas o leads en sitio</span></label><input type="text" name="pixelId" defaultValue={s.pixelId ?? mem.lastPixelId ?? ""} /></div>
              <div className="field"><label>ID del formulario instantáneo</label><input type="text" name="leadFormId" defaultValue={s.leadFormId ?? ""} /></div>
            </div>
            <details style={{ marginBottom: 14 }} open={!s.advantageAudience}>
              <summary>Audiencia y ubicaciones (modo avanzado)</summary>
              <div className="grid g4" style={{ marginTop: 10 }}>
                <div className="field"><label>Países</label><input type="text" name="countries" defaultValue={s.countries.join(", ")} /></div>
                <div className="field"><label>Edad mínima</label><input type="number" name="ageMin" min={18} max={65} defaultValue={s.ageMin} /></div>
                <div className="field"><label>Edad máxima</label><input type="number" name="ageMax" min={18} max={65} defaultValue={s.ageMax} /></div>
                <div className="field"><label>Ubicaciones</label>
                  <select name="placements" defaultValue={s.placements}><option value="advantage">Advantage+ (recomendado)</option><option value="split">Feed 4:5 y Stories/Reels 9:16 por separado</option></select>
                </div>
              </div>
              <label className="checkbox"><input type="checkbox" name="advantageAudience" defaultChecked={s.advantageAudience} /> Dejar que Meta amplíe la audiencia (Advantage+ audiencia)</label>
            </details>
            <div className="field"><label>Texto principal a usar</label>
              <select name="copyLength" defaultValue="primaryMedium" style={{ maxWidth: 300 }}><option value="primaryShort">Corto</option><option value="primaryMedium">Medio</option><option value="primaryLong">Largo</option></select>
            </div>
            {approved.length > 0 && (
              <div className="field"><label>Botón (CTA) por concepto</label>
                {approved.map((k) => (
                  <div key={k.id} className="row" style={{ marginBottom: 6 }}><span style={{ minWidth: 260 }}>{k.title}</span>
                    <select name={`cta_${k.id}`} defaultValue={s.ads.find((a) => a.conceptId === k.id)?.cta ?? "LEARN_MORE"} style={{ maxWidth: 260 }}>{Object.entries(CTA_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </div>
                ))}
              </div>
            )}
            {pendingClaims.length > 0 && <label className="checkbox" style={{ marginBottom: 12 }}><input type="checkbox" name="claimsConfirmed" defaultChecked={s.claimsConfirmed} /> Confirmo que estas afirmaciones son verdaderas y verificables: {pendingClaims.join(" · ")}</label>}
            <button className="btn primary">Guardar configuración y armar anuncios</button>
            <p className="hint">Se arma un anuncio por cada concepto aprobado que tenga al menos una pieza aprobada.</p>
          </form>
        ) : (
          <dl className="kv">
            <dt>Presupuesto diario</dt><dd>{money(s.dailyBudget ?? null, currency)}</dd>
            <dt>Destino</dt><dd>{s.destination} {s.url}</dd>
            <dt>Audiencia</dt><dd>{s.countries.join(", ")} · {s.ageMin}-{s.ageMax}</dd>
            <dt>Anuncios</dt><dd>{s.ads.map((a) => a.name).join(" · ")}</dd>
          </dl>
        )}
      </Card>

      <Card title="4. Verificación y publicación">
        <div className="table-wrap"><table><tbody>
          {checks.map((c) => (
            <tr key={c.key}><td style={{ width: 28 }}>{c.ok ? "✅" : c.blocking ? "⛔" : "⚠️"}</td><td><b>{c.label}</b><br /><small>{c.detail}</small></td></tr>
          ))}
        </tbody></table></div>
        {draft.status === "failed" && <Notice tone="bad"><b>La publicación anterior falló.</b> {draft.publish_error ?? ""}</Notice>}
        {editable && can(ctx.role, "campaign.publish") && (
          <form action={publishDraft.bind(null, draftId)} style={{ marginTop: 12 }}>
            <label className="checkbox"><input type="checkbox" name="confirm" /> Entiendo que se creará la campaña en Meta <b>en pausa</b> (no gasta dinero hasta activarla).</label>
            <div style={{ marginTop: 10 }}><SubmitButton disabled={!ready} pendingText="Creando en Meta…">Crear en Meta (en pausa)</SubmitButton></div>
            {!ready && <p className="hint">Resuelve los puntos marcados con ⛔ para habilitar la publicación.</p>}
          </form>
        )}
        {draft.status === "published_paused" && can(ctx.role, "campaign.publish") && (
          <form action={activateDraft.bind(null, draftId)} style={{ marginTop: 12 }}>
            <Notice tone="warn">La campaña está creada en Meta y <b>en pausa</b>. Revísala en el Administrador de anuncios si quieres. Al activarla empezará a gastar hasta <b>{money(s.dailyBudget ?? null, currency)}</b> diarios.</Notice>
            <label className="checkbox"><input type="checkbox" name="confirmSpend" /> Autorizo gastar hasta {money(s.dailyBudget ?? null, currency)} por día en esta campaña.</label>
            <div style={{ marginTop: 10 }}><SubmitButton className="btn danger" pendingText="Activando…">Activar campaña</SubmitButton></div>
          </form>
        )}
        {draft.status === "active" && <Notice tone="ok">Campaña activa. El seguimiento y las recomendaciones aparecen en «Resultados» y «Recomendaciones».</Notice>}
        {draft.meta_ids?.campaignId && <p className="hint">ID de campaña en Meta: <code>{draft.meta_ids.campaignId}</code></p>}
      </Card>
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
