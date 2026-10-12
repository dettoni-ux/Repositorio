import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { exchangeCode, missingScopes } from "@/meta/oauth";
import { saveConnection } from "@/meta/connections";
import { discoverAssets } from "@/meta/sync";
import { MetaApiError } from "@/meta/graph";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { redactString } from "@/lib/redact";

export async function GET(req: NextRequest) {
  const base = env.appUrl();
  const back = (kind: "ok" | "error", msg: string) => NextResponse.redirect(new URL(`/cuentas?${kind}=${encodeURIComponent(msg)}`, base));
  const ctx = await getSession();
  if (!ctx) return NextResponse.redirect(new URL("/ingresar", base));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("error", "La conexión con Meta fue cancelada o rechazada. Puedes intentarlo de nuevo cuando quieras.");
  const state = sp.get("state") ?? "";
  const code = sp.get("code") ?? "";
  const st = await q1<{ org_id: string; user_id: string }>(`DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING org_id, user_id`, [state]);
  if (!st || st.user_id !== ctx.userId || st.org_id !== ctx.orgId || !code) {
    return back("error", "La solicitud de conexión no es válida o venció. Vuelve a pulsar «Conectar con Meta».");
  }
  try {
    const token = await exchangeCode(code);
    const conn = await saveConnection(ctx.orgId, ctx.userId, token);
    const found = await discoverAssets(ctx.orgId, conn.id);
    const missing = missingScopes(token.scopes);
    await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: "meta.connected", entity: "meta_connection", entityId: conn.id, details: { metaUser: token.metaUserName, scopes: token.scopes, found } });
    const extra = missing.length ? ` Atención: faltan permisos (${missing.join(", ")}); algunas funciones no estarán disponibles.` : "";
    return back("ok", `Conectado como ${token.metaUserName ?? "usuario de Meta"}: ${found.accounts} cuenta(s) publicitaria(s), ${found.pages} página(s) y ${found.instagram} perfil(es) de Instagram. Elige cuáles administrar.${extra}`);
  } catch (e) {
    const msg = e instanceof MetaApiError || e instanceof AppError ? e.userMessage : "No se pudo completar la conexión con Meta.";
    console.error("[meta.oauth]", redactString(String((e as Error)?.message ?? e)));
    return back("error", msg);
  }
}
