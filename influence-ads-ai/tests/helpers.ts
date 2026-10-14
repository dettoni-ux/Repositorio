import { q1, q } from "@/lib/db";
import type { Ctx } from "@/lib/tenancy";
import type { Role } from "@/lib/permissions";
import { randomUUID } from "node:crypto";

export async function makeOrg(name = "Agencia") {
  return (await q1<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [name]))!.id;
}

export async function makeUser(orgId: string, role: Role = "owner", allClients = true): Promise<Ctx> {
  const email = `${randomUUID()}@test.cl`;
  const u = (await q1<{ id: string }>(`INSERT INTO users (email, name, password_hash) VALUES ($1,'Test','x') RETURNING id`, [email]))!;
  await q(`INSERT INTO memberships (org_id, user_id, role, all_clients) VALUES ($1,$2,$3,$4)`, [orgId, u.id, role, allClients]);
  return { userId: u.id, orgId, role, allClients, userName: "Test", email };
}

export async function makeClient(orgId: string, name = "Cliente", extra: { guardrails?: object; profile?: object; level?: string } = {}) {
  return (await q1<{ id: string }>(
    `INSERT INTO clients (org_id, name, guardrails, profile, automation_level) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, name, JSON.stringify(extra.guardrails ?? {}), JSON.stringify(extra.profile ?? {}), extra.level ?? "observe"],
  ))!.id;
}

/** Simulador de la Graph API para pruebas: enruta por método + ruta. */
export type Route = { method?: string; match: RegExp; reply: (url: URL, body: URLSearchParams | null) => unknown; status?: number; headers?: Record<string, string> };
export function metaMock(routes: Route[]) {
  const calls: { method: string; url: URL; body: URLSearchParams | null }[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? new URLSearchParams(init.body) : null;
    calls.push({ method, url, body });
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    const r = routes.find((x) => (x.method ?? "GET") === method && x.match.test(path));
    if (!r) return new Response(JSON.stringify({ error: { message: `sin ruta simulada ${method} ${path}`, code: 100 } }), { status: 400 });
    return new Response(JSON.stringify(r.reply(url, body)), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}
