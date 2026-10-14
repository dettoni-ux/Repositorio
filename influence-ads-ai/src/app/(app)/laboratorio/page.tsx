import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { integrationStatus } from "@/lib/env";
import { ANGLES } from "@/ai/marketing";
import { PageHead, Card, Flash, Notice, Empty } from "@/components/ui";
import { ConceptCard, type ConceptView, type CreativeView } from "@/components/concept-card";
import { SubmitButton } from "@/components/submit-button";
import { labConcepts } from "@/app/actions/creatives";

export default async function Laboratorio({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  if (!client) {
    return (<><PageHead title="Laboratorio creativo" subtitle="Elige un cliente en el selector superior para ver y crear sus creatividades." /><Flash sp={sp} /></>);
  }
  const ai = integrationStatus().ai;
  const filter = sp.estado ?? "activos";
  const concepts = await q<ConceptView>(
    `SELECT * FROM creative_concepts WHERE client_id = $1 AND org_id = $2 ${filter === "activos" ? "AND status <> 'discarded'" : filter === "aprobados" ? "AND status = 'approved'" : ""} ORDER BY created_at DESC LIMIT 60`,
    [client.id, ctx.orgId]);
  const creatives = await q<CreativeView>(`SELECT id, concept_id, format, status, output_asset_id FROM creatives WHERE client_id = $1 AND org_id = $2 ORDER BY created_at`, [client.id, ctx.orgId]);
  const back = `/laboratorio?cliente=${client.id}`;
  return (
    <>
      <PageHead title="Laboratorio creativo" subtitle={`${client.name} · conceptos, copies y piezas`} actions={<Link className="btn" href={`/clientes/${client.id}`}>Materiales del cliente</Link>} />
      <Flash sp={sp} />
      {!ai.ok && <Notice tone="warn">{ai.help}</Notice>}
      {ai.ok && can(ctx.role, "creative.write") && (
        <Card title="Generar conceptos nuevos">
          <form action={labConcepts.bind(null, client.id)}>
            <div className="grid g3">
              <div className="field"><label>Objetivo o producto</label><input type="text" name="objective" placeholder="Ej.: vender kit de joyas DIY" /></div>
              <div className="field"><label>Cantidad</label><input type="number" name="count" min={1} max={10} defaultValue={4} /></div>
              <div className="field"><label>Indicaciones</label><input type="text" name="extra" placeholder="Opcional" /></div>
            </div>
            <details style={{ marginBottom: 12 }}><summary>Ángulos</summary>
              <div className="grid g3" style={{ marginTop: 8 }}>{Object.entries(ANGLES).map(([k, v]) => <label key={k} className="checkbox"><input type="checkbox" name="angles" value={k} /> {v}</label>)}</div>
            </details>
            <SubmitButton pendingText="Generando conceptos…">✦ Generar</SubmitButton>
          </form>
        </Card>
      )}
      <div className="tabs" style={{ marginTop: 16 }}>
        {[["activos", "Activos"], ["aprobados", "Aprobados"], ["todos", "Todos"]].map(([k, l]) => <Link key={k} href={`/laboratorio?cliente=${client.id}&estado=${k}`} className={filter === k ? "active" : ""}>{l}</Link>)}
      </div>
      {concepts.length === 0 ? <Card><Empty title="Sin conceptos">Usa «Crear campaña con IA» o genera conceptos aquí.</Empty></Card> : (
        <div className="grid g2">{concepts.map((k) => <ConceptCard key={k.id} k={k} creatives={creatives.filter((c) => c.concept_id === k.id)} back={back} canApprove={can(ctx.role, "creative.approve")} canWrite={can(ctx.role, "creative.write")} aiOk={ai.ok} />)}</div>
      )}
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
