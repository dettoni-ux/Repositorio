import { getSession } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { requireClient, assertUuid } from "@/lib/tenancy";
import { saveAsset, readAssetFile } from "@/lib/storage";
import { detectFile } from "@/lib/filetype";
import { checkCreative, FORMATS, type FormatKey, type TextLayer } from "@/engine/creative-checks";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ratelimit";

/**
 * Recibe el PNG exportado por el editor, lo guarda y verifica que el archivo
 * existe, se puede leer y cumple dimensiones, peso, zonas seguras y legibilidad.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx) return Response.json({ error: "No autenticado" }, { status: 401 });
  try {
    if (!checkRateLimit(`render:${ctx.userId}`, 60, 10 * 60_000).ok) throw new AppError("rate_limited", "Demasiados guardados seguidos. Espera un momento.");
    const id = assertUuid((await params).id, "La creatividad");
    const c = await q1<{ id: string; client_id: string; format: FormatKey; status: string }>(`SELECT id, client_id, format, status FROM creatives WHERE id = $1 AND org_id = $2`, [id, ctx.orgId]);
    if (!c) throw new AppError("not_found", "La creatividad no existe.");
    await requireClient(ctx, c.client_id, "creative.write");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new AppError("invalid", "Falta el archivo.");
    const layout = JSON.parse(String(fd.get("layout") ?? "{}"));
    const layers = JSON.parse(String(fd.get("layers") ?? "[]")) as TextLayer[];
    const withText = String(fd.get("withText")) === "true";
    const buf = Buffer.from(await file.arrayBuffer());
    const det = detectFile(buf);
    if (!det || det.kind !== "image") throw new AppError("invalid", "El archivo exportado no es una imagen válida.");
    const asset = await saveAsset({ orgId: ctx.orgId, clientId: c.client_id, userId: ctx.userId, buf, filename: `pieza-${c.format}.${det.ext}`, kind: "creative", source: "editor" });
    // Verificación posterior: se vuelve a leer desde el almacenamiento.
    let readable = false;
    let meta = { width: asset.width, height: asset.height };
    try {
      const back = await readAssetFile(asset);
      const d2 = detectFile(back);
      readable = !!d2 && d2.width === asset.width && d2.height === asset.height;
      meta = { width: d2?.width ?? null, height: d2?.height ?? null };
    } catch { readable = false; }
    const items = checkCreative({ format: c.format, width: meta.width, height: meta.height, mime: asset.mime, sizeBytes: asset.size_bytes, withText, layers, fileReadable: readable });
    await q(`UPDATE creatives SET output_asset_id = $2, layout = $3, with_text = $4, checks = $5, status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END, updated_at = now() WHERE id = $1`,
      [c.id, asset.id, JSON.stringify(layout), withText, JSON.stringify({ items, at: new Date().toISOString(), format: FORMATS[c.format].label })]);
    await audit({ orgId: ctx.orgId, clientId: c.client_id, userId: ctx.userId, actor: "user", action: "creative.rendered", entity: "creative", entityId: c.id, details: { assetId: asset.id, blocking: items.filter((i) => !i.ok && i.level === "error").length } });
    return Response.json({ ok: true, assetId: asset.id, checks: items, reapprovalNeeded: c.status === "approved" });
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError("upstream", "No se pudo guardar la pieza.");
    if (!(e instanceof AppError)) console.error("[render]", (e as Error)?.message);
    return Response.json({ error: err.userMessage }, { status: err.status });
  }
}
