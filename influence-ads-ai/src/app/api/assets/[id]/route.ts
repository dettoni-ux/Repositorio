import { getSession } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { requireClient, assertUuid } from "@/lib/tenancy";
import { readAssetFile, type AssetRow } from "@/lib/storage";
import { AppError } from "@/lib/errors";

/** Sirve un archivo privado solo a usuarios con acceso al cliente dueño. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx) return new Response("No autenticado", { status: 401 });
  try {
    const id = assertUuid((await params).id, "El archivo");
    const a = await q1<AssetRow>(`SELECT * FROM assets WHERE id = $1 AND org_id = $2`, [id, ctx.orgId]);
    if (!a) return new Response("No encontrado", { status: 404 });
    await requireClient(ctx, a.client_id);
    const buf = await readAssetFile(a);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": a.mime,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(a.filename)}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return new Response(e instanceof AppError ? e.userMessage : "Error", { status });
  }
}
