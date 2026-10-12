"use server";
import { q, q1, tx } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requirePerm, requireClient, assertUuid } from "@/lib/tenancy";
import { ROLES, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/crypto";
import { runAction, str } from "@/lib/action";

export async function setKillSwitch(on: boolean) {
  const ctx = await requireSession();
  await runAction("/automatizaciones", async () => {
    requirePerm(ctx, on ? "automation.killswitch" : "automation.configure");
    await q(`UPDATE organizations SET automation_kill_switch = $2 WHERE id = $1`, [ctx.orgId, on]);
    if (on) await q(`UPDATE jobs SET status = 'failed', last_error = 'Cancelado por botón de detención' WHERE org_id = $1 AND type = 'auto_optimize_client' AND status = 'queued'`, [ctx.orgId]);
    await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: on ? "automation.kill_switch_on" : "automation.kill_switch_off" });
    return on ? "Toda la automatización quedó DETENIDA. Ninguna acción automática se ejecutará." : "Automatización reanudada según el nivel de cada cliente.";
  });
}

export async function inviteUser(fd: FormData) {
  const ctx = await requireSession();
  await runAction("/configuracion", async () => {
    requirePerm(ctx, "users.manage");
    const email = str(fd, "email").toLowerCase();
    const name = str(fd, "name");
    const role = str(fd, "role") as Role;
    const password = str(fd, "password");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new AppError("invalid", "Nombre y correo válidos son obligatorios.");
    if (!ROLES.includes(role) || role === "owner") throw new AppError("invalid", "Rol inválido.");
    if (password.length < 12) throw new AppError("invalid", "La contraseña temporal debe tener al menos 12 caracteres.");
    const allClients = fd.get("allClients") === "on";
    const clientIds = fd.getAll("clients").map(String);
    for (const id of clientIds) await requireClient(ctx, id);
    await tx(async (db) => {
      let user = await q1<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email], db);
      if (!user) user = await q1<{ id: string }>(`INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`, [email, name, await hashPassword(password)], db);
      const exists = await q1(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, user!.id], db);
      if (exists) throw new AppError("conflict", "Ese usuario ya pertenece a la agencia.");
      await q(`INSERT INTO memberships (org_id, user_id, role, all_clients) VALUES ($1,$2,$3,$4)`, [ctx.orgId, user!.id, role, allClients], db);
      for (const id of allClients ? [] : clientIds) await q(`INSERT INTO client_access (org_id, client_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.orgId, id, user!.id], db);
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: "user.added", details: { email, role, allClients, clients: clientIds.length } });
    return `Usuario ${email} agregado. Entrégale la contraseña temporal por un canal seguro.`;
  });
}

export async function updateMember(userId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction("/configuracion", async () => {
    requirePerm(ctx, "users.manage");
    assertUuid(userId, "El usuario");
    if (userId === ctx.userId) throw new AppError("conflict", "No puedes cambiar tu propio rol.");
    const m = await q1<{ role: Role }>(`SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId]);
    if (!m) throw new AppError("not_found", "El usuario no pertenece a la agencia.");
    if (m.role === "owner") throw new AppError("conflict", "El rol de propietario no se puede modificar desde aquí.");
    if (fd.get("remove") === "1") {
      await q(`DELETE FROM memberships WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId]);
      await q(`DELETE FROM client_access WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId]);
      await q(`DELETE FROM sessions WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId]);
      await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: "user.removed", entityId: userId });
      return "Usuario quitado de la agencia y sus sesiones cerradas.";
    }
    const role = str(fd, "role") as Role;
    if (!ROLES.includes(role) || role === "owner") throw new AppError("invalid", "Rol inválido.");
    const allClients = fd.get("allClients") === "on";
    const clientIds = fd.getAll("clients").map(String);
    for (const id of clientIds) await requireClient(ctx, id);
    await tx(async (db) => {
      await q(`UPDATE memberships SET role = $3, all_clients = $4 WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId, role, allClients], db);
      await q(`DELETE FROM client_access WHERE org_id = $1 AND user_id = $2`, [ctx.orgId, userId], db);
      for (const id of allClients ? [] : clientIds) await q(`INSERT INTO client_access (org_id, client_id, user_id) VALUES ($1,$2,$3)`, [ctx.orgId, id, userId], db);
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: "user.updated", entityId: userId, details: { role, allClients, clients: clientIds.length } });
    return "Permisos actualizados.";
  });
}
