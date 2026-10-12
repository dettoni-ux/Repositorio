"use server";
import { q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireClient, requirePerm, assertUuid } from "@/lib/tenancy";
import { clientProfileSchema, parseProfile, guardrailsSchema, ACTION_TYPES } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/action";
import { saveAsset, readAssetFile } from "@/lib/storage";
import { analyzeBrand, clientBrief } from "@/ai/marketing";
import { enforceRateLimit } from "@/lib/ratelimit";

const PROFILE_KEYS = Object.keys(clientProfileSchema.shape);

function profileFromForm(fd: FormData, previous: unknown) {
  const raw: Record<string, unknown> = { ...(previous as object) };
  for (const k of PROFILE_KEYS) {
    if (fd.has(k)) raw[k] = fd.get(k);
  }
  for (const k of ["monthlyBudget", "targetCpa", "leadValue", "marginPct"]) if (raw[k] === "") delete raw[k];
  if (raw.businessObjective === "") delete raw.businessObjective;
  const r = clientProfileSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError("invalid", `Revisa el campo «${String(first.path[0] ?? "")}»: ${first.message}`);
  }
  return r.data;
}

function basics(fd: FormData) {
  const name = str(fd, "name");
  if (!name) throw new AppError("invalid", "El nombre de la empresa es obligatorio.");
  const website = str(fd, "website");
  if (website && !/^https?:\/\//.test(website)) throw new AppError("invalid", "El sitio web debe comenzar con https://");
  const country = (str(fd, "country") || "CL").toUpperCase();
  const currency = (str(fd, "currency") || "CLP").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency)) throw new AppError("invalid", "País (2 letras) o moneda (3 letras) inválidos.");
  return { name: name.slice(0, 200), industry: str(fd, "industry").slice(0, 200) || null, website: website || null, country, currency };
}

export async function createClient(fd: FormData) {
  const ctx = await requireSession();
  await runAction("/clientes/nuevo", async () => {
    requirePerm(ctx, "clients.write");
    const b = basics(fd);
    const profile = profileFromForm(fd, {});
    const g = guardrailsSchema.parse({ targetCpa: profile.targetCpa, maxMonthlyBudget: profile.monthlyBudget });
    const row = await q1<{ id: string }>(
      `INSERT INTO clients (org_id, name, industry, website, country, currency, profile, guardrails) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ctx.orgId, b.name, b.industry, b.website, b.country, b.currency, JSON.stringify(profile), JSON.stringify(g)],
    );
    const id = row!.id;
    if (!ctx.allClients) await q(`INSERT INTO client_access (org_id, client_id, user_id) VALUES ($1,$2,$3)`, [ctx.orgId, id, ctx.userId]);
    await audit({ orgId: ctx.orgId, clientId: id, userId: ctx.userId, actor: "user", action: "client.created", entity: "client", entityId: id });
    return { to: `/clientes/${id}`, msg: "Cliente creado. Sube fotos, logo y materiales para que la IA cree su ficha de marca." };
  });
}

export async function updateClient(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/clientes/${clientId}`, async () => {
    const c = await requireClient(ctx, clientId, "clients.write");
    const b = basics(fd);
    const profile = profileFromForm(fd, c.profile);
    await q(`UPDATE clients SET name=$3, industry=$4, website=$5, country=$6, currency=$7, profile=$8, updated_at=now() WHERE id=$1 AND org_id=$2`,
      [clientId, ctx.orgId, b.name, b.industry, b.website, b.country, b.currency, JSON.stringify(profile)]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "client.updated", entity: "client", entityId: clientId });
    return "Ficha del cliente guardada.";
  });
}

export async function archiveClient(clientId: string) {
  const ctx = await requireSession();
  await runAction(`/clientes`, async () => {
    await requireClient(ctx, clientId, "clients.delete");
    await q(`UPDATE clients SET status = 'archived', automation_paused = true, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId]);
    await q(`UPDATE ad_accounts SET managed = false WHERE client_id = $1 AND org_id = $2`, [clientId, ctx.orgId]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "client.archived", entity: "client", entityId: clientId });
    return "Cliente archivado. Sus cuentas dejaron de administrarse y la automatización quedó en pausa.";
  });
}

export async function uploadMaterials(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/clientes/${clientId}`, async () => {
    await requireClient(ctx, clientId, "creative.write");
    const kind = str(fd, "kind") === "logo" ? "logo" : undefined;
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new AppError("invalid", "Selecciona al menos un archivo.");
    let n = 0;
    for (const f of files.slice(0, 20)) {
      const asset = await saveAsset({ orgId: ctx.orgId, clientId, userId: ctx.userId, buf: Buffer.from(await f.arrayBuffer()), filename: f.name, kind, source: "upload", notes: str(fd, "notes") || undefined });
      if (kind === "logo") {
        const c = await requireClient(ctx, clientId);
        const profile = { ...parseProfile(c.profile), logoAssetId: asset.id };
        await q(`UPDATE clients SET profile = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId, JSON.stringify(profile)]);
      }
      n++;
    }
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "assets.uploaded", details: { count: n } });
    return `${n} archivo(s) subido(s).`;
  });
}

export async function deleteAsset(clientId: string, assetId: string) {
  const ctx = await requireSession();
  await runAction(`/clientes/${clientId}`, async () => {
    await requireClient(ctx, clientId, "creative.write");
    assertUuid(assetId, "El archivo");
    const used = await q1(`SELECT 1 FROM creatives WHERE (background_asset_id = $1 OR output_asset_id = $1) AND status = 'approved'`, [assetId]);
    if (used) throw new AppError("conflict", "Este archivo se usa en una creatividad aprobada; no se puede borrar.");
    await q(`DELETE FROM assets WHERE id = $1 AND client_id = $2 AND org_id = $3`, [assetId, clientId, ctx.orgId]);
    return "Archivo eliminado.";
  });
}

/** La IA analiza fotos y documentos del cliente y crea la ficha de marca. */
export async function buildBrandSummary(clientId: string) {
  const ctx = await requireSession();
  await runAction(`/clientes/${clientId}`, async () => {
    const c = await requireClient(ctx, clientId, "clients.write");
    enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
    const assets = await q<{ id: string; mime: string; filename: string; storage_key: string; sha256: string; size_bytes: number; kind: string }>(
      `SELECT id, mime, filename, storage_key, sha256, size_bytes, kind FROM assets WHERE client_id = $1 AND org_id = $2 AND kind IN ('image','logo') AND source = 'upload' AND mime IN ('image/jpeg','image/png','image/webp','image/gif') AND size_bytes <= 5000000 ORDER BY created_at DESC LIMIT 8`,
      [clientId, ctx.orgId]);
    const images = [];
    for (const a of assets) {
      try { images.push({ mime: a.mime, name: a.filename, base64: (await readAssetFile(a)).toString("base64") }); } catch { /* archivo faltante: se omite */ }
    }
    const summary = await analyzeBrand({ brief: clientBrief({ ...c, profile: parseProfile(c.profile), brandSummary: null }), images, documentsText: "" });
    await q(`UPDATE clients SET brand_summary = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId, JSON.stringify({ ...summary, generatedAt: new Date().toISOString(), imagesUsed: images.length })]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "brand.summary_generated", details: { images: images.length } });
    return "Ficha de marca creada con IA. Revísala y corrige lo que no corresponda.";
  });
}

export async function updateGuardrails(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/automatizaciones?cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, "automation.configure");
    const raw: Record<string, unknown> = {};
    for (const k of Object.keys(guardrailsSchema.shape)) {
      if (k === "autoActions") continue;
      const v = fd.get(k);
      if (k === "pauseEnabled" || k === "scaleEnabled") raw[k] = v === "on";
      else if (v !== null && v !== "") raw[k] = v;
    }
    raw.autoActions = fd.getAll("autoActions").filter((a) => ACTION_TYPES.includes(a as never));
    const r = guardrailsSchema.safeParse(raw);
    if (!r.success) throw new AppError("invalid", `Revisa «${String(r.error.issues[0].path[0])}»: ${r.error.issues[0].message}`);
    const level = str(fd, "automation_level");
    if (!["observe", "approve", "auto"].includes(level)) throw new AppError("invalid", "Nivel de automatización inválido.");
    if (level === "auto" && r.data.autoActions.length === 0) throw new AppError("invalid", "Para el nivel 3 elige al menos una acción automática autorizada.");
    if (level === "auto" && r.data.autoActions.includes("budget_change") && r.data.maxDailyBudget === undefined) {
      throw new AppError("invalid", "Para cambiar presupuestos automáticamente define un presupuesto diario máximo.");
    }
    await q(`UPDATE clients SET guardrails = $3, automation_level = $4, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId, JSON.stringify(r.data), level]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "automation.configured", details: { level, guardrails: r.data } });
    return "Límites y nivel de automatización guardados.";
  });
}

export async function setClientAutomationPaused(clientId: string, paused: boolean) {
  const ctx = await requireSession();
  await runAction(`/automatizaciones?cliente=${clientId}`, async () => {
    await requireClient(ctx, clientId, paused ? "automation.killswitch" : "automation.configure");
    await q(`UPDATE clients SET automation_paused = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId, paused]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: paused ? "automation.client_paused" : "automation.client_resumed" });
    return paused ? "Automatización del cliente detenida." : "Automatización del cliente reanudada.";
  });
}
