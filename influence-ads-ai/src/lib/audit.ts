import "server-only";
import { q, type Queryable, pool } from "./db";
import { redact } from "./redact";

export type AuditEntry = {
  orgId: string;
  clientId?: string | null;
  userId?: string | null;
  actor: "user" | "system" | "automation";
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
};

export async function audit(e: AuditEntry, db: Queryable = pool()) {
  await q(
    `INSERT INTO audit_log (org_id, client_id, user_id, actor, action, entity, entity_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.orgId, e.clientId ?? null, e.userId ?? null, e.actor, e.action, e.entity ?? null, e.entityId ?? null,
     e.details === undefined ? null : JSON.stringify(redact(e.details))],
    db,
  );
}
