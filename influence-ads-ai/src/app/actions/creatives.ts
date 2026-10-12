"use server";
import { q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireClient, requirePerm, assertUuid } from "@/lib/tenancy";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/action";
import { enforceRateLimit } from "@/lib/ratelimit";
import { saveAsset } from "@/lib/storage";
import { parseProfile } from "@/lib/schemas";
import { FORMATS, type FormatKey } from "@/engine/creative-checks";
import { generateImage } from "@/ai/images";
import { proofread, clientBrief, generateConcepts, ANGLES, type Angle } from "@/ai/marketing";
import { clientHistory } from "@/engine/learning";

async function loadCreative(id: string) {
  const ctx = await requireSession();
  const c = await q1<{ id: string; client_id: string; concept_id: string | null; format: FormatKey; layout: Record<string, unknown>; checks: { items?: { ok: boolean; level: string }[] } | null; output_asset_id: string | null; status: string }>(
    `SELECT id, client_id, concept_id, format, layout, checks, output_asset_id, status FROM creatives WHERE id = $1 AND org_id = $2`, [assertUuid(id, "La creatividad"), ctx.orgId]);
  if (!c) throw new AppError("not_found", "La creatividad no existe.");
  const client = await requireClient(ctx, c.client_id, "creative.write");
  return { ctx, c, client };
}

/** Genera un fondo con IA (sin texto) para la pieza, según el formato. */
export async function generateBackground(creativeId: string, fd: FormData) {
  await runAction(`/laboratorio/editor/${creativeId}`, async () => {
    const { ctx, c, client } = await loadCreative(creativeId);
    enforceRateLimit(`img:${ctx.userId}`, 15, 60 * 60_000);
    const concept = c.concept_id ? await q1<{ copy: { imagePrompt?: string }; visual_idea: string; visual_source: string }>(`SELECT copy, visual_idea, visual_source FROM creative_concepts WHERE id = $1`, [c.concept_id]) : null;
    const prompt = str(fd, "prompt") || concept?.copy.imagePrompt || concept?.visual_idea;
    if (!prompt) throw new AppError("invalid", "Escribe una descripción de la escena a generar.");
    const buf = await generateImage(prompt, FORMATS[c.format].aspect);
    const asset = await saveAsset({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, buf, filename: `fondo-ia-${c.format}.png`, kind: "image", source: "ai", aiPrompt: prompt });
    await q(`UPDATE creatives SET background_asset_id = $2, layout = layout || $3::jsonb, updated_at = now() WHERE id = $1`, [c.id, asset.id, JSON.stringify({ backgroundAssetId: asset.id })]);
    await audit({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, actor: "user", action: "creative.ai_background", entity: "creative", entityId: c.id, details: { prompt } });
    return concept?.visual_source === "foto_real"
      ? "Fondo generado. Ojo: este concepto pide mostrar el producto real; úsalo solo como ambientación, no como foto del producto."
      : "Fondo generado con IA. Revisa que no tenga defectos (manos, objetos irreales) antes de aprobar.";
  });
}

export async function setCreativeStatus(creativeId: string, status: "approved" | "rejected" | "draft") {
  await runAction(`/laboratorio/editor/${creativeId}`, async () => {
    const { ctx, c, client } = await loadCreative(creativeId);
    if (status === "approved") {
      requirePerm(ctx, "creative.approve");
      if (!c.output_asset_id) throw new AppError("invalid", "Primero guarda la pieza final (botón «Guardar pieza»).");
      const blocking = (c.checks?.items ?? []).filter((i) => !i.ok && i.level === "error").length;
      if (blocking) throw new AppError("invalid", `La pieza tiene ${blocking} problema(s) técnico(s) que impiden aprobarla.`);
    }
    await q(`UPDATE creatives SET status = $2, updated_at = now() WHERE id = $1`, [c.id, status]);
    await audit({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, actor: "user", action: `creative.${status}`, entity: "creative", entityId: c.id });
    return status === "approved" ? "Pieza aprobada." : status === "rejected" ? "Pieza rechazada." : "Pieza vuelta a borrador.";
  });
}

export async function proofreadCreative(creativeId: string) {
  await runAction(`/laboratorio/editor/${creativeId}`, async () => {
    const { ctx, c, client } = await loadCreative(creativeId);
    enforceRateLimit(`ai:${ctx.userId}`, 30, 60 * 60_000);
    const l = c.layout as { headline?: string; subline?: string; cta?: string };
    const texts = [l.headline, l.subline, l.cta].filter((t): t is string => !!t && !!t.trim());
    if (!texts.length) return "La pieza no tiene textos para revisar.";
    const brief = clientBrief({ name: client.name, industry: client.industry, website: client.website, country: client.country, currency: client.currency, profile: parseProfile(client.profile), brandSummary: null });
    const r = await proofread(texts, brief);
    await q(`UPDATE creatives SET checks = COALESCE(checks, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [c.id, JSON.stringify({ proofread: { ...r, at: new Date().toISOString() } })]);
    return r.ok ? "Revisión de textos: sin observaciones." : `Revisión de textos: ${r.issues.length} observación(es). Míralas en el panel de verificación.`;
  });
}

/** Conceptos sueltos desde el laboratorio (sin borrador de campaña). */
export async function labConcepts(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/laboratorio?cliente=${clientId}`, async () => {
    const client = await requireClient(ctx, clientId, "creative.write");
    enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
    const angles = fd.getAll("angles").filter((a): a is Angle => typeof a === "string" && a in ANGLES);
    const count = Math.min(10, Math.max(1, Number(str(fd, "count") || 4)));
    const brief = clientBrief({ name: client.name, industry: client.industry, website: client.website, country: client.country, currency: client.currency, profile: parseProfile(client.profile), brandSummary: client.brand_summary });
    const concepts = await generateConcepts({ brief, strategy: null, objective: str(fd, "objective") || "Según la ficha del cliente", count, angles, history: await clientHistory(ctx.orgId, clientId), extra: str(fd, "extra") });
    for (const k of concepts) {
      await q(
        `INSERT INTO creative_concepts (org_id, client_id, angle, title, hypothesis, hook, value_prop, visual_idea, visual_source, cta, audience, objection, copy, needs_verification)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [ctx.orgId, clientId, k.angle, k.title, k.hypothesis, k.hook, k.valueProp, k.visualIdea, k.visualSource, k.cta, k.audience, k.objection,
         JSON.stringify({ ...k.copy, imagePrompt: k.imagePrompt, conversionHypothesis: k.conversionHypothesis }), k.needsVerification]);
    }
    return `Se generaron ${concepts.length} conceptos.`;
  });
}
