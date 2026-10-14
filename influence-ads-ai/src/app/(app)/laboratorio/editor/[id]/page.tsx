import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { requireClient, assertUuid } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { integrationStatus } from "@/lib/env";
import { parseProfile } from "@/lib/schemas";
import { FORMATS, SAFE_ZONES, type FormatKey } from "@/engine/creative-checks";
import { PageHead, Card, Flash, Badge, Notice } from "@/components/ui";
import { CreativeEditor } from "@/components/creative-editor";
import { SubmitButton } from "@/components/submit-button";
import { generateBackground, setCreativeStatus, proofreadCreative } from "@/app/actions/creatives";
import { notFound } from "@/lib/errors";

export default async function EditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const c = await q1<{ id: string; client_id: string; concept_id: string | null; format: FormatKey; layout: Record<string, unknown>; checks: { items?: unknown[]; proofread?: { ok: boolean; issues: { text: string; problem: string; suggestion: string }[] } } | null; status: string; output_asset_id: string | null }>(
    `SELECT id, client_id, concept_id, format, layout, checks, status, output_asset_id FROM creatives WHERE id = $1 AND org_id = $2`, [assertUuid(id, "La creatividad"), ctx.orgId]);
  if (!c) throw notFound("La creatividad");
  const client = await requireClient(ctx, c.client_id);
  const profile = parseProfile(client.profile);
  const concept = c.concept_id ? await q1<{ id: string; title: string; draft_id: string | null; visual_idea: string; visual_source: string; copy: { imagePrompt?: string } }>(`SELECT id, title, draft_id, visual_idea, visual_source, copy FROM creative_concepts WHERE id = $1`, [c.concept_id]) : null;
  const images = await q<{ id: string; filename: string; source: string; kind: string }>(
    `SELECT id, filename, source, kind FROM assets WHERE client_id = $1 AND org_id = $2 AND kind IN ('image','logo') AND mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 80`, [client.id, ctx.orgId]);
  const f = FORMATS[c.format];
  const canWrite = can(ctx.role, "creative.write");
  const status = integrationStatus().images;
  const back = concept?.draft_id ? `/crear/${concept.draft_id}` : "/laboratorio";
  const proof = c.checks?.proofread;
  return (
    <>
      <PageHead title={`Editor · ${f.label}`} subtitle={<>{client.name}{concept ? <> · {concept.title}</> : null} · <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "bad" : undefined}>{c.status === "approved" ? "Aprobada" : c.status === "rejected" ? "Rechazada" : "Borrador"}</Badge></>}
        actions={<Link className="btn" href={back}>← Volver</Link>} />
      <Flash sp={sp} />
      {concept && <Notice tone="info"><b>Idea visual:</b> {concept.visual_idea}{concept.visual_source === "foto_real" && <> · <b>Este concepto debe mostrar el producto real:</b> usa fotos del cliente.</>}</Notice>}
      {images.filter((i) => i.kind === "image").length === 0 && <Notice tone="warn">El cliente no tiene fotos. <Link href={`/clientes/${client.id}`}>Sube fotos reales</Link> o genera un fondo con IA.</Notice>}
      <CreativeEditor
        creativeId={c.id} width={f.width} height={f.height} safe={SAFE_ZONES[c.format]}
        initial={c.layout as never}
        backgrounds={images.filter((i) => i.kind === "image").map((i) => ({ id: i.id, label: i.filename, source: i.source }))}
        logos={images.filter((i) => i.kind === "logo").map((i) => ({ id: i.id, label: i.filename }))}
        palette={[...profile.colors, "#FFFFFF", "#111111"]}
        checks={(c.checks?.items as never) ?? null}
        readOnly={!canWrite}
      />
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Fondo con IA">
          {!status.ok ? <p className="muted">{status.help}</p> : canWrite && (
            <form action={generateBackground.bind(null, c.id)}>
              <div className="field"><label>Escena a generar <span className="hint">· sin texto; el texto se agrega en el editor</span></label>
                <textarea name="prompt" defaultValue={concept?.copy.imagePrompt ?? ""} /></div>
              <SubmitButton pendingText="Generando imagen (hasta 1 minuto)…">Generar fondo {f.aspect}</SubmitButton>
            </form>
          )}
        </Card>
        <Card title="Revisión y aprobación">
          <p className="hint">Antes de aprobar revisa: ortografía, que el producto sea reconocible y real, que no haya manos u objetos deformes, y que la pieza se entienda en 2-3 segundos.</p>
          {proof && (proof.ok ? <Notice tone="ok">Revisión de textos con IA: sin observaciones.</Notice> : (
            <Notice tone="warn"><b>Observaciones de la revisión de textos:</b><ul style={{ margin: "6px 0 0" }}>{proof.issues.map((i, n) => <li key={n}>«{i.text}»: {i.problem} → <i>{i.suggestion}</i></li>)}</ul></Notice>
          ))}
          <div className="row">
            {integrationStatus().ai.ok && canWrite && <form action={proofreadCreative.bind(null, c.id)}><SubmitButton className="btn" pendingText="Revisando…">Revisar textos con IA</SubmitButton></form>}
            {can(ctx.role, "creative.approve") && c.status !== "approved" && <form action={setCreativeStatus.bind(null, c.id, "approved")}><button className="btn primary" disabled={!c.output_asset_id}>Aprobar pieza</button></form>}
            {canWrite && c.status !== "rejected" && <form action={setCreativeStatus.bind(null, c.id, "rejected")}><button className="btn">Rechazar</button></form>}
            {canWrite && c.status !== "draft" && <form action={setCreativeStatus.bind(null, c.id, "draft")}><button className="btn ghost">Volver a borrador</button></form>}
          </div>
          {c.output_asset_id && <p style={{ marginTop: 10 }}><a href={`/api/assets/${c.output_asset_id}`} target="_blank" rel="noreferrer">Ver archivo final guardado</a></p>}
        </Card>
      </div>
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
