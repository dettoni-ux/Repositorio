import Link from "next/link";
import { ANGLES, type Angle } from "@/ai/marketing";
import { FORMATS, type FormatKey } from "@/engine/creative-checks";
import { Badge } from "./ui";
import { setConceptStatus, editConceptCopy, regenerateConceptCopy, createCreative } from "@/app/actions/drafts";

export type ConceptView = {
  id: string; angle: Angle; title: string; hypothesis: string; hook: string; value_prop: string; visual_idea: string; visual_source: string;
  cta: string; audience: string; objection: string | null; status: string; needs_verification: string[];
  copy: { primaryShort: string; primaryMedium: string; primaryLong: string; headline: string; description: string; primaryVariants: string[]; headlineVariants: string[]; overlayHeadline: string; overlaySubline: string; videoScript: string; onScreenText: string[]; conversionHypothesis?: string };
};
export type CreativeView = { id: string; concept_id: string; format: FormatKey; status: string; output_asset_id: string | null };

export function ConceptCard({ k, creatives, back, canApprove, canWrite, aiOk }: { k: ConceptView; creatives: CreativeView[]; back: string; canApprove: boolean; canWrite: boolean; aiOk: boolean }) {
  return (
    <article className={`concept ${k.status}`}>
      <div className="row between">
        <div><Badge tone="primary">{ANGLES[k.angle] ?? k.angle}</Badge> {k.status === "approved" && <Badge tone="ok">Aprobado</Badge>}{k.status === "discarded" && <Badge>Descartado</Badge>}</div>
        <small>{k.visual_source === "foto_real" ? "Requiere fotos reales" : "Admite imagen con IA"}</small>
      </div>
      <h3 style={{ marginTop: 8 }}>{k.title}</h3>
      <dl className="kv">
        <dt>Hipótesis</dt><dd>{k.hypothesis}</dd>
        <dt>Gancho</dt><dd><b>{k.hook}</b></dd>
        <dt>Propuesta de valor</dt><dd>{k.value_prop}</dd>
        <dt>Idea visual</dt><dd>{k.visual_idea}</dd>
        <dt>Público</dt><dd>{k.audience}</dd>
        {k.objection && <><dt>Objeción que resuelve</dt><dd>{k.objection}</dd></>}
        <dt>CTA</dt><dd>{k.cta}</dd>
        {k.copy.conversionHypothesis && <><dt>Hipótesis de conversión</dt><dd>{k.copy.conversionHypothesis}</dd></>}
      </dl>
      {k.needs_verification.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}><b>Confirma antes de publicar:</b> {k.needs_verification.join(" · ")}</div>}
      <details style={{ marginTop: 10 }}>
        <summary>Textos del anuncio</summary>
        <div style={{ marginTop: 8 }}>
          <p><b>Titular:</b> {k.copy.headline} <small>· Descripción: {k.copy.description}</small></p>
          <p><b>Corto:</b> {k.copy.primaryShort}</p>
          <p><b>Medio:</b> {k.copy.primaryMedium}</p>
          <p style={{ whiteSpace: "pre-wrap" }}><b>Largo:</b> {k.copy.primaryLong}</p>
          {k.copy.primaryVariants.length > 0 && <p><b>Variantes:</b> {k.copy.primaryVariants.join(" | ")}</p>}
          {k.copy.headlineVariants.length > 0 && <p><b>Titulares alternativos:</b> {k.copy.headlineVariants.join(" | ")}</p>}
          <p><b>Texto en imagen:</b> {k.copy.overlayHeadline} {k.copy.overlaySubline && `· ${k.copy.overlaySubline}`}</p>
          <p style={{ whiteSpace: "pre-wrap" }}><b>Guion de video:</b> {k.copy.videoScript}</p>
          {k.copy.onScreenText.length > 0 && <p><b>Texto en pantalla:</b> {k.copy.onScreenText.join(" → ")}</p>}
        </div>
      </details>
      {canWrite && (
        <details style={{ marginTop: 8 }}>
          <summary>Editar o regenerar textos</summary>
          <form action={editConceptCopy.bind(null, k.id, back)} style={{ marginTop: 8 }}>
            <div className="field"><label>Titular</label><input type="text" name="headline" defaultValue={k.copy.headline} /></div>
            <div className="field"><label>Descripción</label><input type="text" name="description" defaultValue={k.copy.description} /></div>
            <div className="field"><label>Texto principal (medio)</label><textarea name="primaryMedium" defaultValue={k.copy.primaryMedium} /></div>
            <div className="field"><label>Texto principal (corto)</label><textarea name="primaryShort" defaultValue={k.copy.primaryShort} /></div>
            <div className="field"><label>Texto principal (largo)</label><textarea name="primaryLong" defaultValue={k.copy.primaryLong} /></div>
            <div className="grid g2">
              <div className="field"><label>Texto en imagen</label><input type="text" name="overlayHeadline" defaultValue={k.copy.overlayHeadline} /></div>
              <div className="field"><label>Texto secundario en imagen</label><input type="text" name="overlaySubline" defaultValue={k.copy.overlaySubline} /></div>
            </div>
            <button className="btn small">Guardar textos</button>
          </form>
          {aiOk && (
            <form action={regenerateConceptCopy.bind(null, k.id, back)} className="row" style={{ marginTop: 8 }}>
              <input type="text" name="instruction" placeholder="Ej.: más directo, menos emojis, mencionar despacho" style={{ flex: 1 }} />
              <button className="btn small">Regenerar con IA</button>
            </form>
          )}
        </details>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        {canApprove && k.status !== "approved" && <form action={setConceptStatus.bind(null, k.id, "approved", back)}><button className="btn small primary">Aprobar concepto</button></form>}
        {canWrite && k.status !== "discarded" && <form action={setConceptStatus.bind(null, k.id, "discarded", back)}><button className="btn small">Descartar</button></form>}
        {canWrite && k.status === "discarded" && <form action={setConceptStatus.bind(null, k.id, "proposed", back)}><button className="btn small">Restaurar</button></form>}
      </div>
      {k.status !== "discarded" && (
        <div style={{ marginTop: 12 }}>
          <b style={{ fontSize: ".85rem" }}>Piezas</b>
          <div className="row" style={{ marginTop: 6 }}>
            {creatives.map((c) => (
              <Link key={c.id} href={`/laboratorio/editor/${c.id}`} className="card" style={{ padding: 6, width: 104, textAlign: "center", color: "inherit" }}>
                {c.output_asset_id ? <img src={`/api/assets/${c.output_asset_id}`} alt="" style={{ width: "100%", height: 90, objectFit: "contain" }} /> : <div className="thumb" style={{ width: "100%", height: 90 }} />}
                <small>{FORMATS[c.format].label.split(" ").slice(-1)[0]}</small><br />
                <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "bad" : undefined}>{c.status === "approved" ? "Aprobada" : c.status === "rejected" ? "Rechazada" : "Borrador"}</Badge>
              </Link>
            ))}
            {canWrite && (Object.keys(FORMATS) as FormatKey[]).map((f) => (
              <form key={f} action={createCreative.bind(null, k.id, f)}><button className="btn small">+ {FORMATS[f].label}</button></form>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
