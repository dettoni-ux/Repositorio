import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { requireClient } from "@/lib/tenancy";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseProfile } from "@/lib/schemas";
import { integrationStatus } from "@/lib/env";
import { storageDriver } from "@/lib/storage";
import { dateTime } from "@/lib/format";
import { PageHead, Card, Flash, Badge, Notice, Empty } from "@/components/ui";
import { ClientForm } from "@/components/client-form";
import { updateClient, uploadMaterials, deleteAsset, buildBrandSummary, archiveClient } from "@/app/actions/clients";

type Brand = { summary: string; voice: string; visualStyle: string; palette: string[]; keyMessages: string[]; doList: string[]; dontList: string[]; productObservations: string[]; gaps: string[]; generatedAt: string; imagesUsed: number };

export default async function ClienteDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const c = await requireClient(ctx, id);
  const profile = parseProfile(c.profile);
  const assets = await q<{ id: string; kind: string; filename: string; mime: string; width: number | null; height: number | null; source: string; created_at: string }>(
    `SELECT id, kind, filename, mime, width, height, source, created_at FROM assets WHERE client_id = $1 AND org_id = $2 AND kind <> 'creative' ORDER BY created_at DESC LIMIT 60`, [id, ctx.orgId]);
  const accounts = await q<{ id: string; name: string; meta_account_id: string; last_synced_at: string | null }>(`SELECT id, name, meta_account_id, last_synced_at FROM ad_accounts WHERE client_id = $1 AND org_id = $2 AND managed`, [id, ctx.orgId]);
  const pages = await q<{ page_id: string; name: string }>(`SELECT page_id, name FROM meta_pages WHERE client_id = $1 AND org_id = $2`, [id, ctx.orgId]);
  const ig = await q<{ ig_user_id: string; username: string | null }>(`SELECT ig_user_id, username FROM meta_instagram_accounts WHERE client_id = $1 AND org_id = $2`, [id, ctx.orgId]);
  const brand = c.brand_summary as Brand | null;
  const ai = integrationStatus().ai;
  const canWrite = can(ctx.role, "clients.write");
  return (
    <>
      <PageHead title={c.name} subtitle={c.industry ?? "Ficha del cliente"} actions={<>
        <Link className="btn" href={`/resultados?cliente=${id}`}>Ver resultados</Link>
        <Link className="btn primary" href={`/crear?cliente=${id}`}>✦ Crear campaña con IA</Link>
      </>} />
      <Flash sp={sp} />
      <div className="grid g2">
        <Card title="Cuentas y perfiles de Meta" actions={<Link className="btn small" href="/cuentas">Administrar</Link>}>
          {accounts.length === 0 ? <p className="muted">Sin cuentas publicitarias asignadas. Asígnalas en «Cuentas publicitarias».</p> : (
            <ul>{accounts.map((a) => <li key={a.id}>{a.name} <small>({a.meta_account_id}) · sincronizada {dateTime(a.last_synced_at)}</small></li>)}</ul>
          )}
          <p style={{ margin: "8px 0 4px" }}><b>Páginas de Facebook:</b> {pages.length ? pages.map((p) => p.name).join(", ") : <small>ninguna asignada</small>}</p>
          <p style={{ margin: 0 }}><b>Perfiles de Instagram:</b> {ig.length ? ig.map((p) => `@${p.username ?? p.ig_user_id}`).join(", ") : <small>ninguno asignado</small>}</p>
        </Card>
        <Card title="Ficha de marca (IA)" actions={canWrite && <form action={buildBrandSummary.bind(null, id)}><button className="btn small primary" disabled={!ai.ok}>{brand ? "Regenerar" : "Crear con IA"}</button></form>}>
          {!ai.ok && <Notice tone="warn">{ai.help}</Notice>}
          {brand ? (
            <>
              <p>{brand.summary}</p>
              <dl className="kv">
                <dt>Voz</dt><dd>{brand.voice}</dd>
                <dt>Estilo visual</dt><dd>{brand.visualStyle}</dd>
                <dt>Paleta</dt><dd className="row">{brand.palette.map((p) => <span key={p} title={p} style={{ width: 22, height: 22, borderRadius: 6, background: p, border: "1px solid var(--border)", display: "inline-block" }} />)}</dd>
                <dt>Mensajes clave</dt><dd>{brand.keyMessages.join(" · ")}</dd>
                <dt>Hacer</dt><dd>{brand.doList.join(" · ")}</dd>
                <dt>Evitar</dt><dd>{brand.dontList.join(" · ")}</dd>
              </dl>
              {brand.gaps.length > 0 && <Notice tone="warn"><b>Información que falta:</b> {brand.gaps.join(" · ")}</Notice>}
              <small>Generada {dateTime(brand.generatedAt)} con {brand.imagesUsed} imagen(es).</small>
            </>
          ) : <p className="muted">Sube fotos del producto, logo y creatividades anteriores; la IA creará una ficha de marca basada solo en esos materiales y en la ficha.</p>}
        </Card>
      </div>

      <Card title="Materiales" className="" actions={null}>
        {can(ctx.role, "creative.write") && (
          <form action={uploadMaterials.bind(null, id)} className="row" style={{ marginBottom: 14 }}>
            <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf" />
            <select name="kind" defaultValue="" style={{ width: "auto" }}>
              <option value="">Foto, video o documento</option>
              <option value="logo">Logotipo</option>
            </select>
            <input type="text" name="notes" placeholder="Nota (opcional): ej. creatividad anterior con buen resultado" style={{ maxWidth: 340 }} />
            <button className="btn primary">Subir</button>
          </form>
        )}
        {can(ctx.role, "creative.write") && storageDriver() === "db" && (
          <p className="hint" style={{ marginTop: -6 }}>Máximo ~4 MB por envío en este servidor: sube las fotos de a una si son pesadas.</p>
        )}
        {assets.length === 0 ? <Empty title="Sin materiales">Sube fotografías reales del producto o servicio: las creatividades con fotos auténticas suelen ser más creíbles.</Empty> : (
          <div className="grid g4">
            {assets.map((a) => (
              <div key={a.id} className="card" style={{ padding: 10 }}>
                {a.mime.startsWith("image/") ? <img src={`/api/assets/${a.id}`} alt={a.filename} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} /> : <div className="empty" style={{ padding: 20 }}>{a.mime.includes("pdf") ? "PDF" : "Video"}</div>}
                <div className="row between" style={{ marginTop: 6 }}>
                  <small title={a.filename}>{a.filename.slice(0, 22)}</small>
                  {a.kind === "logo" && <Badge tone="primary">Logo</Badge>}
                  {a.source === "ai" && <Badge>IA</Badge>}
                </div>
                <small>{a.width ? `${a.width}×${a.height}` : ""}</small>
                {can(ctx.role, "creative.write") && <form action={deleteAsset.bind(null, id, a.id)}><button className="btn ghost small">Eliminar</button></form>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Ficha del cliente">
        {canWrite ? <ClientForm mode="edit" action={updateClient.bind(null, id)} defaults={{ name: c.name, industry: c.industry, website: c.website, country: c.country, currency: c.currency, profile }} /> : <p className="muted">Solo lectura.</p>}
      </Card>
      {can(ctx.role, "clients.delete") && (
        <Card title="Zona de cuidado">
          <form action={archiveClient.bind(null, id)} className="row">
            <p style={{ margin: 0 }} className="muted">Archivar deja de administrar sus cuentas y pausa su automatización. No borra el historial.</p>
            <button className="btn danger small right">Archivar cliente</button>
          </form>
        </Card>
      )}
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
