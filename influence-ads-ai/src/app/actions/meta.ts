"use server";
import { q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireClient, requirePerm, assertUuid } from "@/lib/tenancy";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/action";
import { enforceRateLimit } from "@/lib/ratelimit";
import { disconnect } from "@/meta/connections";
import { discoverAssets, syncAdAccount } from "@/meta/sync";
import { MetaApiError } from "@/meta/graph";

function metaMsg(e: unknown): never {
  if (e instanceof MetaApiError) throw new AppError("upstream", e.userMessage);
  throw e;
}

/** Asigna una cuenta publicitaria / página / perfil de Instagram a un cliente (o la libera). */
export async function assignAsset(kind: "ad_account" | "page" | "instagram", id: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction("/cuentas", async () => {
    requirePerm(ctx, "meta.assign");
    assertUuid(id, "El recurso");
    const clientId = str(fd, "clientId");
    if (clientId) await requireClient(ctx, clientId, "meta.assign");
    const table = kind === "ad_account" ? "ad_accounts" : kind === "page" ? "meta_pages" : "meta_instagram_accounts";
    const managed = kind === "ad_account" ? fd.get("managed") === "on" && !!clientId : null;
    const row = kind === "ad_account"
      ? await q1(`UPDATE ad_accounts SET client_id = $3, managed = $4 WHERE id = $1 AND org_id = $2 RETURNING id`, [id, ctx.orgId, clientId || null, managed])
      : await q1(`UPDATE ${table} SET client_id = $3 WHERE id = $1 AND org_id = $2 RETURNING id`, [id, ctx.orgId, clientId || null]);
    if (!row) throw new AppError("not_found", "No existe o no pertenece a tu organización.");
    await audit({ orgId: ctx.orgId, clientId: clientId || null, userId: ctx.userId, actor: "user", action: `meta.${kind}.assigned`, entity: table, entityId: id, details: { managed } });
    return clientId ? "Asignación guardada." : "Quedó sin cliente asignado.";
  });
}

export async function syncNow(adAccountId: string) {
  const ctx = await requireSession();
  await runAction("/cuentas", async () => {
    requirePerm(ctx, "clients.read");
    const acc = await q1<{ client_id: string | null; managed: boolean }>(`SELECT client_id, managed FROM ad_accounts WHERE id = $1 AND org_id = $2`, [assertUuid(adAccountId), ctx.orgId]);
    if (!acc) throw new AppError("not_found", "La cuenta no existe.");
    if (!acc.managed || !acc.client_id) throw new AppError("conflict", "Asigna la cuenta a un cliente y márcala como administrada antes de sincronizar.");
    await requireClient(ctx, acc.client_id);
    enforceRateLimit(`sync:${adAccountId}`, 4, 10 * 60_000);
    const r = await syncAdAccount(ctx.orgId, adAccountId, { days: 35 }).catch(metaMsg);
    await audit({ orgId: ctx.orgId, clientId: acc.client_id, userId: ctx.userId, actor: "user", action: "meta.sync", entity: "ad_account", entityId: adAccountId, details: r });
    return `Sincronizado: ${r.campaigns} campañas, ${r.ads} anuncios y ${r.insightRows} filas de métricas (${r.since} a ${r.until}).`;
  });
}

export async function rediscover(connectionId: string) {
  const ctx = await requireSession();
  await runAction("/cuentas", async () => {
    requirePerm(ctx, "meta.connect");
    const r = await discoverAssets(ctx.orgId, assertUuid(connectionId)).catch(metaMsg);
    return `Actualizado: ${r.accounts} cuentas, ${r.pages} páginas, ${r.instagram} perfiles de Instagram.`;
  });
}

export async function disconnectMeta(connectionId: string) {
  const ctx = await requireSession();
  await runAction("/cuentas", async () => {
    requirePerm(ctx, "meta.connect");
    const r = await disconnect(ctx.orgId, assertUuid(connectionId), ctx.userId);
    return r.revokedInMeta
      ? "Conexión eliminada: se revocaron los permisos en Meta y se borró el token cifrado."
      : "Conexión eliminada localmente (token borrado). No se pudo confirmar la revocación en Meta: revísala en Facebook → Configuración → Integraciones comerciales.";
  });
}

export async function purgeAccountData(adAccountId: string) {
  const ctx = await requireSession();
  await runAction("/cuentas", async () => {
    requirePerm(ctx, "meta.connect");
    const id = assertUuid(adAccountId);
    await q(`DELETE FROM ad_accounts WHERE id = $1 AND org_id = $2`, [id, ctx.orgId]);
    await audit({ orgId: ctx.orgId, userId: ctx.userId, actor: "user", action: "meta.ad_account.purged", entity: "ad_account", entityId: id });
    return "Se eliminaron la cuenta y todos sus datos sincronizados.";
  });
}
