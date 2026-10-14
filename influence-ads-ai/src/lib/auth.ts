import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q, q1 } from "./db";
import { randomToken, sha256 } from "./crypto";
import type { Ctx } from "./tenancy";
import type { Role } from "./permissions";
import { env } from "./env";

export const SESSION_COOKIE = "ia_session";
export const CLIENT_COOKIE = "ia_cliente";
const SESSION_DAYS = 14;

export async function createSession(userId: string, orgId: string) {
  const token = randomToken(32);
  await q(`INSERT INTO sessions (token_hash, user_id, org_id, expires_at) VALUES ($1,$2,$3, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId, orgId]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  jar.delete(SESSION_COOKIE);
  jar.delete(CLIENT_COOKIE);
}

export const getSession = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await q1<{ user_id: string; org_id: string; role: Role; all_clients: boolean; name: string; email: string }>(
    `SELECT s.user_id, s.org_id, m.role, m.all_clients, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND NOT u.disabled
       JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  return { userId: row.user_id, orgId: row.org_id, role: row.role, allClients: row.all_clients, userName: row.name, email: row.email };
});

export async function requireSession(): Promise<Ctx> {
  const s = await getSession();
  if (!s) redirect("/ingresar");
  return s;
}

/** Cliente seleccionado en el selector global (o null = vista de agencia). */
export async function selectedClientId(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(CLIENT_COOKIE)?.value;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
