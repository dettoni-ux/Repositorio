/** Almacenamiento seguro de conexiones con Meta (tokens cifrados, solo en servidor). */
import "server-only";
import { q, q1, type Queryable, pool } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { MetaApiError } from "./graph";
import { revokePermissions, type TokenInfo } from "./oauth";

export type ConnectionRow = {
  id: string;
  org_id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  token_expires_at: string | null;
  scopes: string[];
  status: "active" | "expired" | "revoked" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const PUBLIC_COLS = `id, org_id, meta_user_id, meta_user_name, token_expires_at, scopes, status, last_error, created_at, updated_at`;

export async function saveConnection(orgId: string, userId: string, t: TokenInfo, db: Queryable = pool()): Promise<ConnectionRow> {
  const row = await q1<ConnectionRow>(
    `INSERT INTO meta_connections (org_id, created_by, meta_user_id, meta_user_name, token_enc, token_expires_at, scopes, status, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NULL)
     ON CONFLICT (org_id, meta_user_id) DO UPDATE SET
       token_enc = EXCLUDED.token_enc, token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes,
       meta_user_name = EXCLUDED.meta_user_name, status = 'active', last_error = NULL, updated_at = now()
     RETURNING ${PUBLIC_COLS}`,
    [orgId, userId, t.metaUserId, t.metaUserName, encrypt(t.accessToken), t.expiresAt, t.scopes],
    db,
  );
  return row!;
}

export async function listConnections(orgId: string): Promise<ConnectionRow[]> {
  return q<ConnectionRow>(`SELECT ${PUBLIC_COLS} FROM meta_connections WHERE org_id = $1 ORDER BY created_at`, [orgId]);
}

/** Devuelve el token descifrado. Solo para uso interno del servidor. */
export async function connectionToken(orgId: string, connectionId: string | null): Promise<{ token: string; connectionId: string }> {
  if (!connectionId) throw new AppError("conflict", "Esta cuenta publicitaria no tiene una conexión activa con Meta. Vuelve a conectarla.");
  const row = await q1<{ token_enc: string | null; status: string; token_expires_at: Date | null }>(
    `SELECT token_enc, status, token_expires_at FROM meta_connections WHERE id = $1 AND org_id = $2`,
    [connectionId, orgId],
  );
  if (!row || !row.token_enc || row.status === "revoked") throw new AppError("conflict", "La conexión con Meta fue desconectada. Vuelve a conectar la cuenta.");
  if (row.status === "expired" || (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now())) {
    await markConnection(orgId, connectionId, "expired", "El token venció");
    throw new AppError("conflict", "La conexión con Meta venció. Vuelve a conectar la cuenta desde «Cuentas publicitarias».");
  }
  return { token: decrypt(row.token_enc), connectionId };
}

export async function markConnection(orgId: string, connectionId: string, status: ConnectionRow["status"], error: string | null) {
  await q(`UPDATE meta_connections SET status = $3, last_error = $4, updated_at = now() WHERE id = $1 AND org_id = $2`, [connectionId, orgId, status, error]);
}

/** Si Meta indica token inválido, marca la conexión para que la UI pida reconectar. */
export async function handleMetaError(orgId: string, connectionId: string | null, e: unknown) {
  if (connectionId && e instanceof MetaApiError && e.kind === "token") {
    await markConnection(orgId, connectionId, "expired", e.userMessage);
  }
}

/**
 * Desconecta: revoca permisos en Meta (si es posible), elimina el token cifrado
 * y desvincula las cuentas, páginas y perfiles asociados.
 */
export async function disconnect(orgId: string, connectionId: string, userId: string): Promise<{ revokedInMeta: boolean }> {
  const row = await q1<{ token_enc: string | null }>(`SELECT token_enc FROM meta_connections WHERE id = $1 AND org_id = $2`, [connectionId, orgId]);
  if (!row) throw new AppError("not_found", "La conexión no existe.");
  let revokedInMeta = false;
  if (row.token_enc) {
    try {
      await revokePermissions(decrypt(row.token_enc));
      revokedInMeta = true;
    } catch {
      revokedInMeta = false; // igual se borra localmente
    }
  }
  await q(`UPDATE meta_connections SET token_enc = NULL, status = 'revoked', updated_at = now() WHERE id = $1 AND org_id = $2`, [connectionId, orgId]);
  await q(`UPDATE ad_accounts SET managed = false, connection_id = NULL WHERE connection_id = $1 AND org_id = $2`, [connectionId, orgId]);
  await q(`UPDATE meta_pages SET connection_id = NULL WHERE connection_id = $1 AND org_id = $2`, [connectionId, orgId]);
  await q(`UPDATE meta_instagram_accounts SET connection_id = NULL WHERE connection_id = $1 AND org_id = $2`, [connectionId, orgId]);
  await audit({ orgId, userId, actor: "user", action: "meta.disconnect", entity: "meta_connection", entityId: connectionId, details: { revokedInMeta } });
  return { revokedInMeta };
}
