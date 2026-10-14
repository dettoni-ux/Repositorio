/**
 * OAuth con Meta (Inicio de sesión con Facebook / Facebook Login for Business).
 * Nunca se piden contraseñas: el usuario autoriza en facebook.com y Meta
 * devuelve un código que se canjea en el servidor por un token.
 */
import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { graph, type FetchLike } from "./graph";

/** Permisos solicitados. Cada uno requiere Revisión de la app para uso con terceros. */
export const META_SCOPES = [
  "ads_read",            // leer campañas y métricas
  "ads_management",      // crear borradores, pausar, cambiar presupuestos
  "business_management", // cuentas publicitarias de portafolios comerciales
  "pages_show_list",     // listar páginas
  "pages_read_engagement",
  "instagram_basic",     // perfiles profesionales de Instagram vinculados
];

export function callbackUrl(): string {
  return `${env.appUrl().replace(/\/$/, "")}/api/meta/oauth/callback`;
}

export function requireMetaConfig() {
  const appId = env.metaAppId();
  const secret = env.metaAppSecret();
  if (!appId || !secret) {
    throw new AppError("missing_config", "Falta configurar la app de Meta en el servidor (META_APP_ID y META_APP_SECRET). Ve a Configuración para ver los pasos.");
  }
  return { appId, secret };
}

export function buildAuthUrl(state: string): string {
  const { appId } = requireMetaConfig();
  const u = new URL(`https://www.facebook.com/${env.metaGraphVersion()}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", callbackUrl());
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  const configId = env.metaLoginConfigId();
  if (configId) u.searchParams.set("config_id", configId);
  else u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

export type TokenInfo = { accessToken: string; expiresAt: Date | null; scopes: string[]; metaUserId: string; metaUserName: string | null };

export async function exchangeCode(code: string, fetchImpl?: FetchLike): Promise<TokenInfo> {
  const { appId, secret } = requireMetaConfig();
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    token: "", fetchImpl, appSecret: "",
    params: { client_id: appId, redirect_uri: callbackUrl(), client_secret: secret, code },
  });
  // Token de larga duración (~60 días)
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    token: "", fetchImpl, appSecret: "",
    params: { grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: short.access_token },
  });
  return inspectToken(long.access_token, fetchImpl, long.expires_in);
}

export async function inspectToken(accessToken: string, fetchImpl?: FetchLike, expiresIn?: number): Promise<TokenInfo> {
  const { appId, secret } = requireMetaConfig();
  const dbg = await graph<{ data: { is_valid: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; user_id?: string } }>("debug_token", {
    token: `${appId}|${secret}`, fetchImpl, appSecret: "",
    params: { input_token: accessToken },
  });
  if (!dbg.data?.is_valid) throw new AppError("upstream", "Meta indicó que el token no es válido. Intenta conectar nuevamente.");
  const me = await graph<{ id: string; name?: string }>("me", { token: accessToken, fetchImpl, params: { fields: "id,name" } });
  const expSec = dbg.data.expires_at && dbg.data.expires_at > 0 ? dbg.data.expires_at : expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;
  return {
    accessToken,
    expiresAt: expSec ? new Date(expSec * 1000) : null,
    scopes: dbg.data.scopes ?? [],
    metaUserId: me.id,
    metaUserName: me.name ?? null,
  };
}

/** Revoca en Meta todos los permisos concedidos a la app por ese usuario. */
export async function revokePermissions(accessToken: string, fetchImpl?: FetchLike): Promise<void> {
  await graph("me/permissions", { token: accessToken, method: "DELETE", fetchImpl });
}

export function missingScopes(granted: string[]): string[] {
  return META_SCOPES.filter((s) => !granted.includes(s));
}
