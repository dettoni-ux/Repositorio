"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { q, q1, tx } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { createSession, destroySession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { str, withParam } from "@/lib/action";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function login(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const ip = await clientIp();
  if (!checkRateLimit(`login:${ip}`, 10, 15 * 60_000).ok || !checkRateLimit(`login:${email}`, 5, 15 * 60_000).ok) {
    redirect(withParam("/ingresar", "error", "Demasiados intentos. Espera 15 minutos e intenta otra vez."));
  }
  const user = await q1<{ id: string; password_hash: string; disabled: boolean }>(`SELECT id, password_hash, disabled FROM users WHERE email = $1`, [email]);
  const ok = user && !user.disabled && (await verifyPassword(password, user.password_hash));
  if (!ok) redirect(withParam("/ingresar", "error", "Correo o contraseña incorrectos."));
  const m = await q1<{ org_id: string }>(`SELECT org_id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [user!.id]);
  if (!m) redirect(withParam("/ingresar", "error", "Tu usuario no pertenece a ninguna organización."));
  await createSession(user!.id, m!.org_id);
  await audit({ orgId: m!.org_id, userId: user!.id, actor: "user", action: "auth.login", details: { ip } });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/ingresar");
}

/** Configuración inicial: solo disponible mientras no exista ningún usuario. */
export async function setup(fd: FormData) {
  const existing = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM users`);
  if ((existing?.n ?? 0) > 0) redirect("/ingresar");
  const org = str(fd, "org") || "Influence Chile SpA";
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(withParam("/configurar", "error", "Ingresa tu nombre y un correo válido."));
  if (password.length < 12) redirect(withParam("/configurar", "error", "La contraseña debe tener al menos 12 caracteres."));
  const hash = await hashPassword(password);
  const ids = await tx(async (db) => {
    const o = await q1<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [org], db);
    const u = await q1<{ id: string }>(`INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`, [email, name, hash], db);
    await q(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')`, [o!.id, u!.id], db);
    return { orgId: o!.id, userId: u!.id };
  });
  await createSession(ids.userId, ids.orgId);
  await audit({ orgId: ids.orgId, userId: ids.userId, actor: "user", action: "org.created", details: { org } });
  redirect("/?ok=" + encodeURIComponent("¡Listo! Ahora conecta tus cuentas de Meta o crea tu primer cliente."));
}
