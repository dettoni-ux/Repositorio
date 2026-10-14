/**
 * Aislamiento entre clientes. TODA lectura o escritura de datos de un cliente
 * debe pasar por requireClient(): comprueba que el cliente pertenece a la
 * organización de la sesión y que el usuario tiene acceso a ese cliente.
 * Si no, responde "no existe" (no revela si existe en otra organización).
 */
import "server-only";
import { q, q1, type Queryable, pool } from "./db";
import { can, type Permission, type Role } from "./permissions";
import { AppError, forbidden, notFound } from "./errors";

export type Ctx = {
  userId: string;
  orgId: string;
  role: Role;
  allClients: boolean;
  userName: string;
  email: string;
};

export type ClientRow = {
  id: string;
  org_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  country: string;
  currency: string;
  status: string;
  profile: Record<string, unknown>;
  brand_summary: Record<string, unknown> | null;
  automation_level: "observe" | "approve" | "auto";
  automation_paused: boolean;
  guardrails: Record<string, unknown>;
  wizard_memory: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function requirePerm(ctx: Ctx, perm: Permission) {
  if (!can(ctx.role, perm)) throw forbidden();
}

/** Fragmento SQL reutilizable: clientes visibles para el usuario ($1=org, $2=user, $3=allClients). */
const VISIBLE = `c.org_id = $1 AND ($3::boolean OR EXISTS (SELECT 1 FROM client_access a WHERE a.client_id = c.id AND a.user_id = $2))`;

export async function listClients(ctx: Ctx, opts: { includeArchived?: boolean } = {}, db: Queryable = pool()): Promise<ClientRow[]> {
  return q<ClientRow>(
    `SELECT c.* FROM clients c WHERE ${VISIBLE} ${opts.includeArchived ? "" : "AND c.status = 'active'"} ORDER BY c.name`,
    [ctx.orgId, ctx.userId, ctx.allClients],
    db,
  );
}

export async function visibleClientIds(ctx: Ctx, db: Queryable = pool()): Promise<string[]> {
  const rows = await q<{ id: string }>(`SELECT c.id FROM clients c WHERE ${VISIBLE}`, [ctx.orgId, ctx.userId, ctx.allClients], db);
  return rows.map((r) => r.id);
}

export async function requireClient(ctx: Ctx, clientId: string | null | undefined, perm: Permission = "clients.read", db: Queryable = pool()): Promise<ClientRow> {
  requirePerm(ctx, perm);
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) throw notFound("El cliente");
  const row = await q1<ClientRow>(`SELECT c.* FROM clients c WHERE c.id = $4 AND ${VISIBLE}`, [ctx.orgId, ctx.userId, ctx.allClients, clientId], db);
  if (!row) throw notFound("El cliente");
  return row;
}

/** Verifica que una cuenta publicitaria pertenece a la organización y (si se indica) al cliente. */
export async function requireAdAccount(ctx: Ctx, adAccountId: string, clientId?: string, db: Queryable = pool()) {
  const row = await q1<{ id: string; client_id: string | null; meta_account_id: string; connection_id: string | null; currency: string | null; name: string }>(
    `SELECT id, client_id, meta_account_id, connection_id, currency, name FROM ad_accounts WHERE id = $1 AND org_id = $2`,
    [adAccountId, ctx.orgId],
    db,
  );
  if (!row) throw notFound("La cuenta publicitaria");
  if (clientId !== undefined && row.client_id !== clientId) throw notFound("La cuenta publicitaria");
  if (row.client_id) await requireClient(ctx, row.client_id, "clients.read", db);
  else if (!can(ctx.role, "meta.assign")) throw notFound("La cuenta publicitaria");
  return row;
}

export function assertUuid(id: unknown, what = "El recurso"): string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound(what);
  return id;
}

export { AppError };
