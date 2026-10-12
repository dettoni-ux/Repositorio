"use server";
import { q, q1 } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireClient, requirePerm, assertUuid, type Ctx, type ClientRow } from "@/lib/tenancy";
import { BUSINESS_OBJECTIVES, META_OBJECTIVE, parseGuardrails, parseProfile, parseLocaleNumber, type BusinessObjective } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/action";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ANGLES, clientBrief, generateConcepts, generateStrategy, regenerateCopy, type Angle, type Concept, type Strategy } from "@/ai/marketing";
import { clientHistory } from "@/engine/learning";
import { draftStructureSchema, canPublish, CTA_TYPES, type DraftStructure, type CtaType } from "@/engine/drafts";
import { loadDraft, validationFor } from "@/engine/draft-service";
import { FORMATS, contrastRatio, type FormatKey } from "@/engine/creative-checks";
import { readAssetFile } from "@/lib/storage";
import { connectionToken } from "@/meta/connections";
import { publishPaused, activate } from "@/meta/publish";
import { MetaApiError } from "@/meta/graph";

function briefOf(c: ClientRow) {
  return clientBrief({ name: c.name, industry: c.industry, website: c.website, country: c.country, currency: c.currency, profile: parseProfile(c.profile), brandSummary: c.brand_summary });
}

async function insertConcepts(ctx: Ctx, clientId: string, draftId: string | null, concepts: Concept[]) {
  for (const k of concepts) {
    await q(
      `INSERT INTO creative_concepts (org_id, client_id, draft_id, angle, title, hypothesis, hook, value_prop, visual_idea, visual_source, cta, audience, objection, copy, needs_verification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [ctx.orgId, clientId, draftId, k.angle, k.title, k.hypothesis, k.hook, k.valueProp, k.visualIdea, k.visualSource, k.cta, k.audience, k.objection,
       JSON.stringify({ ...k.copy, imagePrompt: k.imagePrompt, conversionHypothesis: k.conversionHypothesis }), k.needsVerification],
    );
  }
}

/** Paso 1 del asistente: guarda respuestas, recuerda la configuración y genera estrategia + conceptos. */
export async function startCampaign(clientId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/crear?cliente=${clientId}`, async () => {
    const c = await requireClient(ctx, clientId, "campaign.draft");
    const objective = str(fd, "objective") as BusinessObjective;
    if (!(objective in BUSINESS_OBJECTIVES)) throw new AppError("invalid", "Elige qué quieres lograr con la campaña.");
    const product = str(fd, "product");
    if (!product) throw new AppError("invalid", "Cuéntanos qué quieres promocionar.");
    const dailyBudget = parseLocaleNumber(str(fd, "dailyBudget"));
    if (dailyBudget !== undefined && !(dailyBudget > 0)) throw new AppError("invalid", "El presupuesto diario debe ser un número mayor que cero.");
    const count = Math.min(10, Math.max(1, Number(str(fd, "count") || 4)));
    const angles = fd.getAll("angles").filter((a): a is Angle => typeof a === "string" && a in ANGLES);

    // Completa la ficha con lo que faltaba y recuerda las respuestas para la próxima vez.
    const profile = parseProfile(c.profile);
    const url = str(fd, "url");
    if (url && !/^https:\/\//.test(url)) throw new AppError("invalid", "La página de destino debe comenzar con https://");
    if (!profile.products && product) profile.products = product;
    if (!profile.audience && str(fd, "audience")) profile.audience = str(fd, "audience");
    if (url && !profile.landingPages.includes(url)) profile.landingPages = [...profile.landingPages, url];
    if (!profile.businessObjective) profile.businessObjective = objective;
    const memory = { ...c.wizard_memory, lastObjective: objective, lastProduct: product, lastUrl: url || undefined, lastDailyBudget: dailyBudget, lastCount: count, lastDestination: str(fd, "destination") || undefined };
    await q(`UPDATE clients SET profile = $3, wizard_memory = $4, updated_at = now() WHERE id = $1 AND org_id = $2`, [clientId, ctx.orgId, JSON.stringify(profile), JSON.stringify(memory)]);

    const accounts = await q<{ id: string }>(`SELECT id FROM ad_accounts WHERE client_id = $1 AND org_id = $2 AND managed ORDER BY name`, [clientId, ctx.orgId]);
    const pages = await q<{ page_id: string }>(`SELECT page_id FROM meta_pages WHERE client_id = $1 AND org_id = $2 ORDER BY name`, [clientId, ctx.orgId]);
    const igs = await q<{ ig_user_id: string; page_id: string | null }>(`SELECT ig_user_id, page_id FROM meta_instagram_accounts WHERE client_id = $1 AND org_id = $2`, [clientId, ctx.orgId]);
    const destination = (["website", "whatsapp", "instant_form"].includes(str(fd, "destination")) ? str(fd, "destination") : objective === "messages" ? "whatsapp" : "website") as DraftStructure["destination"];
    const structure = draftStructureSchema.parse({
      adAccountId: accounts.length === 1 ? accounts[0].id : undefined,
      pageId: pages.length === 1 ? pages[0].page_id : undefined,
      instagramUserId: pages.length === 1 ? igs.find((i) => i.page_id === pages[0].page_id)?.ig_user_id : undefined,
      destination, url: url || profile.landingPages[0] || c.website || undefined,
      dailyBudget: dailyBudget ?? (profile.monthlyBudget ? Math.round(profile.monthlyBudget / 30) : undefined),
      countries: [c.country], specialAdCategory: profile.specialAdCategory,
    });
    const name = `${BUSINESS_OBJECTIVES[objective]} · ${product.slice(0, 60)} · ${new Date().toLocaleDateString("es-CL")}`;
    const draft = await q1<{ id: string }>(
      `INSERT INTO campaign_drafts (org_id, client_id, ad_account_id, name, objective, input, structure, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ctx.orgId, clientId, structure.adAccountId ?? null, name, objective, JSON.stringify({ product, extra: str(fd, "extra"), count, angles }), JSON.stringify(structure), ctx.userId]);
    await audit({ orgId: ctx.orgId, clientId, userId: ctx.userId, actor: "user", action: "draft.created", entity: "campaign_draft", entityId: draft!.id });

    // IA: estrategia y conceptos (si no está configurada, el borrador queda listo para completarse a mano)
    try {
      enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
      const fresh = await requireClient(ctx, clientId);
      const brief = briefOf(fresh);
      const history = await clientHistory(ctx.orgId, clientId);
      const objectiveText = `${BUSINESS_OBJECTIVES[objective]} — promocionar: ${product}`;
      const strategy = await generateStrategy({ brief, objective: objectiveText, extra: str(fd, "extra"), history });
      await q(`UPDATE campaign_drafts SET strategy = $2, updated_at = now() WHERE id = $1`, [draft!.id, JSON.stringify(strategy)]);
      const concepts = await generateConcepts({ brief, strategy, objective: objectiveText, count, angles, history, extra: str(fd, "extra") });
      await insertConcepts(ctx, clientId, draft!.id, concepts);
      return { to: `/crear/${draft!.id}`, msg: `La IA preparó la estrategia y ${concepts.length} conceptos. Revísalos, aprueba los que te gusten y crea sus piezas.` };
    } catch (e) {
      const msg = e instanceof AppError ? e.userMessage : "La IA no pudo completar la propuesta.";
      return { to: `/crear/${draft!.id}`, msg: `Borrador creado, pero sin propuesta de IA: ${msg}` };
    }
  });
}

export async function moreConcepts(draftId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/crear/${draftId}`, async () => {
    const { draft, client } = await loadDraft(ctx, draftId);
    requirePerm(ctx, "creative.write");
    enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
    const count = Math.min(6, Math.max(1, Number(str(fd, "count") || 3)));
    const existing = await q<{ title: string; angle: string }>(`SELECT title, angle FROM creative_concepts WHERE draft_id = $1`, [draftId]);
    const concepts = await generateConcepts({
      brief: briefOf(client), strategy: draft.strategy, count, angles: [], history: await clientHistory(ctx.orgId, client.id),
      objective: `${BUSINESS_OBJECTIVES[draft.objective]} — ${String(draft.input.product ?? "")}`,
      extra: `${str(fd, "extra")}\nEvita repetir estos conceptos ya propuestos: ${existing.map((e) => `${e.title} (${e.angle})`).join("; ")}`,
    });
    await insertConcepts(ctx, client.id, draftId, concepts);
    return `Se agregaron ${concepts.length} conceptos nuevos.`;
  });
}

export async function regenerateStrategy(draftId: string) {
  const ctx = await requireSession();
  await runAction(`/crear/${draftId}`, async () => {
    const { draft, client } = await loadDraft(ctx, draftId);
    requirePerm(ctx, "campaign.draft");
    enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
    const strategy = await generateStrategy({ brief: briefOf(client), objective: `${BUSINESS_OBJECTIVES[draft.objective]} — ${String(draft.input.product ?? "")}`, extra: String(draft.input.extra ?? ""), history: await clientHistory(ctx.orgId, client.id) });
    await q(`UPDATE campaign_drafts SET strategy = $2, updated_at = now() WHERE id = $1`, [draftId, JSON.stringify(strategy)]);
    return "Estrategia regenerada.";
  });
}

type ConceptRow = { id: string; client_id: string; draft_id: string | null; angle: Angle; title: string; hypothesis: string; hook: string; value_prop: string; visual_idea: string; visual_source: "foto_real" | "ia_permitida"; cta: string; audience: string; objection: string | null; copy: Concept["copy"] & { imagePrompt?: string; conversionHypothesis?: string }; needs_verification: string[]; status: string };

async function loadConcept(ctx: Ctx, id: string) {
  const k = await q1<ConceptRow>(`SELECT * FROM creative_concepts WHERE id = $1 AND org_id = $2`, [assertUuid(id, "El concepto"), ctx.orgId]);
  if (!k) throw new AppError("not_found", "El concepto no existe.");
  const client = await requireClient(ctx, k.client_id, "creative.write");
  return { k, client };
}

export async function setConceptStatus(conceptId: string, status: "approved" | "discarded" | "proposed", back: string) {
  const ctx = await requireSession();
  await runAction(back, async () => {
    const { k } = await loadConcept(ctx, conceptId);
    if (status === "approved") requirePerm(ctx, "creative.approve");
    await q(`UPDATE creative_concepts SET status = $2, updated_at = now() WHERE id = $1`, [conceptId, status]);
    await audit({ orgId: ctx.orgId, clientId: k.client_id, userId: ctx.userId, actor: "user", action: `concept.${status}`, entity: "creative_concept", entityId: conceptId });
    return status === "approved" ? "Concepto aprobado." : status === "discarded" ? "Concepto descartado." : "Concepto restaurado.";
  });
}

export async function editConceptCopy(conceptId: string, back: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(back, async () => {
    const { k } = await loadConcept(ctx, conceptId);
    const copy = { ...k.copy };
    for (const key of ["primaryShort", "primaryMedium", "primaryLong", "headline", "description", "overlayHeadline", "overlaySubline", "videoScript"] as const) {
      if (fd.has(key)) copy[key] = str(fd, key).slice(0, 3000);
    }
    await q(`UPDATE creative_concepts SET copy = $2, updated_at = now() WHERE id = $1`, [conceptId, JSON.stringify(copy)]);
    return "Textos actualizados.";
  });
}

export async function regenerateConceptCopy(conceptId: string, back: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(back, async () => {
    const { k, client } = await loadConcept(ctx, conceptId);
    enforceRateLimit(`ai:${ctx.userId}`, 20, 60 * 60_000);
    const concept = { angle: k.angle, title: k.title, hypothesis: k.hypothesis, hook: k.hook, valueProp: k.value_prop, visualIdea: k.visual_idea, visualSource: k.visual_source, imagePrompt: k.copy.imagePrompt ?? "", cta: k.cta, audience: k.audience, objection: k.objection ?? "", conversionHypothesis: k.copy.conversionHypothesis ?? "", needsVerification: k.needs_verification, copy: k.copy };
    const copy = await regenerateCopy({ brief: briefOf(client), concept, instruction: str(fd, "instruction") });
    await q(`UPDATE creative_concepts SET copy = $2, updated_at = now() WHERE id = $1`, [conceptId, JSON.stringify({ ...copy, imagePrompt: k.copy.imagePrompt, conversionHypothesis: k.copy.conversionHypothesis })]);
    return "Copy regenerado.";
  });
}

/** Crea una pieza (creatividad) para un concepto y formato y abre el editor. */
export async function createCreative(conceptId: string, format: FormatKey) {
  const ctx = await requireSession();
  await runAction(`/laboratorio`, async () => {
    const { k, client } = await loadConcept(ctx, conceptId);
    if (!(format in FORMATS)) throw new AppError("invalid", "Formato inválido.");
    const profile = parseProfile(client.profile);
    const primary = profile.colors[0] ?? "#5B3DF5";
    // Elige el color de texto más legible sobre el color de marca (contraste WCAG).
    const readable = (bg: string) => (contrastRatio("#FFFFFF", bg) >= contrastRatio("#111111", bg) ? "#FFFFFF" : "#111111");
    const ctaBg = readable(primary);
    const layout = {
      template: format === "vertical_9x16" ? "banda-inferior" : "banda-inferior",
      headline: k.copy.overlayHeadline || k.hook, subline: k.copy.overlaySubline ?? "", cta: k.cta,
      textColor: readable(primary), bandColor: primary, ctaColor: ctaBg, ctaTextColor: readable(ctaBg),
      focusX: 0.5, focusY: 0.5, zoom: 1, fontScale: 1, showLogo: !!profile.logoAssetId, logoAssetId: profile.logoAssetId ?? null, showSafeZones: true,
    };
    const row = await q1<{ id: string }>(
      `INSERT INTO creatives (org_id, client_id, concept_id, format, with_text, layout) VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
      [ctx.orgId, client.id, conceptId, format, JSON.stringify(layout)]);
    return { to: `/laboratorio/editor/${row!.id}` };
  });
}

/** Guarda la configuración de la campaña y arma los anuncios desde los conceptos aprobados. */
export async function saveStructure(draftId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/crear/${draftId}`, async () => {
    const { draft, client } = await loadDraft(ctx, draftId);
    requirePerm(ctx, "campaign.draft");
    if (!["draft", "ready", "failed"].includes(draft.status)) throw new AppError("conflict", "El borrador ya fue publicado; los cambios se hacen desde Meta o creando otro borrador.");
    const adAccountId = str(fd, "adAccountId") || undefined;
    if (adAccountId) {
      const acc = await q1(`SELECT 1 FROM ad_accounts WHERE id = $1 AND org_id = $2 AND client_id = $3 AND managed`, [adAccountId, ctx.orgId, client.id]);
      if (!acc) throw new AppError("invalid", "La cuenta publicitaria no pertenece a este cliente.");
    }
    const pageId = str(fd, "pageId") || undefined;
    if (pageId && !(await q1(`SELECT 1 FROM meta_pages WHERE page_id = $1 AND org_id = $2 AND client_id = $3`, [pageId, ctx.orgId, client.id]))) throw new AppError("invalid", "La página no pertenece a este cliente.");
    const igId = str(fd, "instagramUserId") || undefined;
    if (igId && !(await q1(`SELECT 1 FROM meta_instagram_accounts WHERE ig_user_id = $1 AND org_id = $2 AND client_id = $3`, [igId, ctx.orgId, client.id]))) throw new AppError("invalid", "El perfil de Instagram no pertenece a este cliente.");

    // Anuncios: conceptos aprobados con al menos una pieza aprobada
    const variant = str(fd, "copyLength") || "primaryMedium";
    const concepts = await q<ConceptRow>(`SELECT * FROM creative_concepts WHERE draft_id = $1 AND status = 'approved' ORDER BY created_at`, [draftId]);
    const creatives = await q<{ id: string; concept_id: string; format: FormatKey }>(`SELECT id, concept_id, format FROM creatives WHERE concept_id = ANY($1::uuid[]) AND status = 'approved' ORDER BY updated_at DESC`, [concepts.map((c) => c.id)]);
    const ads = concepts.map((k) => {
      const mine = creatives.filter((c) => c.concept_id === k.id);
      const feed = mine.find((c) => c.format === "feed_4x5") ?? mine.find((c) => c.format === "feed_1x1") ?? mine.find((c) => c.format === "feed_4x3");
      const vertical = mine.find((c) => c.format === "vertical_9x16");
      const cta = (str(fd, `cta_${k.id}`) || "LEARN_MORE") as CtaType;
      return {
        conceptId: k.id, name: k.title.slice(0, 120), feedCreativeId: feed?.id, verticalCreativeId: vertical?.id,
        primaryText: (["primaryShort", "primaryMedium", "primaryLong"].includes(variant) ? k.copy[variant as "primaryMedium"] : k.copy.primaryMedium) || k.copy.primaryMedium, headline: k.copy.headline, description: k.copy.description ?? "",
        cta: cta in CTA_TYPES ? cta : "LEARN_MORE",
      };
    }).filter((a) => a.feedCreativeId || a.verticalCreativeId);

    const parsed = draftStructureSchema.safeParse({
      adAccountId, pageId, instagramUserId: igId,
      destination: str(fd, "destination") || "website",
      url: str(fd, "url") || undefined, leadFormId: str(fd, "leadFormId") || undefined, pixelId: str(fd, "pixelId") || undefined,
      dailyBudget: parseLocaleNumber(str(fd, "dailyBudget")),
      startTime: str(fd, "startTime") ? new Date(`${str(fd, "startTime")}T00:00:00`).toISOString() : undefined,
      countries: str(fd, "countries").split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()),
      ageMin: Number(str(fd, "ageMin") || 18), ageMax: Number(str(fd, "ageMax") || 65),
      advantageAudience: fd.get("advantageAudience") === "on",
      placements: str(fd, "placements") === "split" ? "split" : "advantage",
      specialAdCategory: parseProfile(client.profile).specialAdCategory,
      ads, claimsConfirmed: fd.get("claimsConfirmed") === "on",
    });
    if (!parsed.success) throw new AppError("invalid", `Revisa «${String(parsed.error.issues[0].path.join("."))}»: ${parsed.error.issues[0].message}`);
    await q(`UPDATE campaign_drafts SET structure = $2, ad_account_id = $3, status = 'draft', updated_at = now() WHERE id = $1`, [draftId, JSON.stringify(parsed.data), adAccountId ?? null]);
    await q(`UPDATE clients SET wizard_memory = wizard_memory || $3::jsonb WHERE id = $1 AND org_id = $2`, [client.id, ctx.orgId, JSON.stringify({ lastPageId: pageId, lastAdAccountId: adAccountId, lastPixelId: parsed.data.pixelId, lastCountries: parsed.data.countries })]);
    return `Configuración guardada con ${ads.length} anuncio(s).`;
  });
}

/** Crea la campaña en Meta EN PAUSA (no gasta dinero). Requiere confirmación explícita. */
export async function publishDraft(draftId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/crear/${draftId}`, async () => {
    requirePerm(ctx, "campaign.publish");
    if (fd.get("confirm") !== "on") throw new AppError("invalid", "Marca la casilla de confirmación para crear la campaña en Meta.");
    enforceRateLimit(`publish:${ctx.userId}`, 10, 60 * 60_000);
    const { draft, client } = await loadDraft(ctx, draftId);
    if (!["draft", "ready", "failed"].includes(draft.status)) throw new AppError("conflict", "Este borrador ya fue publicado.");
    const checks = await validationFor(ctx, draft, client);
    if (!canPublish(checks)) throw new AppError("invalid", "Hay validaciones pendientes. Revisa la lista de verificación antes de publicar.");
    const s = draft.structure;
    const acc = (await q1<{ meta_account_id: string; currency: string | null; connection_id: string | null }>(`SELECT meta_account_id, currency, connection_id FROM ad_accounts WHERE id = $1 AND org_id = $2 AND client_id = $3`, [s.adAccountId, ctx.orgId, client.id]))!;
    const { token } = await connectionToken(ctx.orgId, acc.connection_id);
    const files = new Map<string, Buffer>();
    for (const ad of s.ads) {
      for (const id of [ad.feedCreativeId, ad.verticalCreativeId].filter(Boolean) as string[]) {
        const a = await q1<{ storage_key: string; sha256: string }>(`SELECT a.storage_key, a.sha256 FROM creatives c JOIN assets a ON a.id = c.output_asset_id WHERE c.id = $1 AND c.client_id = $2 AND c.status = 'approved'`, [id, client.id]);
        if (!a) throw new AppError("invalid", "Una creatividad no tiene archivo final aprobado.");
        files.set(id, await readAssetFile(a));
      }
    }
    await q(`UPDATE campaign_drafts SET status = 'publishing', publish_error = NULL, updated_at = now() WHERE id = $1`, [draftId]);
    try {
      const ids = await publishPaused({
        draftId, name: draft.name, objective: draft.objective, metaObjective: META_OBJECTIVE[draft.objective], actId: acc.meta_account_id, currency: acc.currency,
        token, structure: s, files, existing: draft.meta_ids ?? {},
      });
      await q(`UPDATE campaign_drafts SET status = 'published_paused', meta_ids = $2, published_by = $3, published_at = now(), updated_at = now() WHERE id = $1`, [draftId, JSON.stringify(ids), ctx.userId]);
      // Registra el experimento para aprender de los resultados
      await q(
        `INSERT INTO experiments (org_id, client_id, ad_account_id, draft_id, name, objective, hypothesis, primary_metric, audience, creative_ref, meta_refs, budget, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'planned',$13)`,
        [ctx.orgId, client.id, s.adAccountId, draftId, draft.name, draft.objective, draft.strategy?.hypotheses?.join(" · ") || "Comparar conceptos creativos", draft.objective === "sales" ? "cpa" : draft.objective === "leads" ? "cpl" : draft.objective === "messages" ? "costo_por_conversacion" : "cpc",
         JSON.stringify({ countries: s.countries, ageMin: s.ageMin, ageMax: s.ageMax, advantage: s.advantageAudience, placements: s.placements }),
         JSON.stringify(s.ads.map((a) => ({ conceptId: a.conceptId, headline: a.headline }))), JSON.stringify(ids), s.dailyBudget, ctx.userId]);
      await audit({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, actor: "user", action: "draft.published_paused", entity: "campaign_draft", entityId: draftId, details: { ids, dailyBudget: s.dailyBudget } });
      return "Campaña creada en Meta EN PAUSA. Revísala y pulsa «Activar» cuando quieras que empiece a gastar.";
    } catch (e) {
      const msg = e instanceof MetaApiError || e instanceof AppError ? e.userMessage : (e as Error).message;
      await q(`UPDATE campaign_drafts SET status = 'failed', publish_error = $2, updated_at = now() WHERE id = $1`, [draftId, msg]);
      await audit({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, actor: "user", action: "draft.publish_failed", entity: "campaign_draft", entityId: draftId, details: { error: msg } });
      throw new AppError("upstream", `${msg} Lo creado hasta ahora quedó en pausa; al reintentar se continúa sin duplicar.`);
    }
  });
}

/** Activa la campaña publicada (empieza a gastar). Requiere confirmación del presupuesto. */
export async function activateDraft(draftId: string, fd: FormData) {
  const ctx = await requireSession();
  await runAction(`/crear/${draftId}`, async () => {
    requirePerm(ctx, "campaign.publish");
    const { draft, client } = await loadDraft(ctx, draftId);
    if (draft.status !== "published_paused" || !draft.meta_ids?.campaignId) throw new AppError("conflict", "Primero crea la campaña en Meta (en pausa).");
    if (fd.get("confirmSpend") !== "on") throw new AppError("invalid", "Confirma que autorizas el gasto diario indicado.");
    const org = await q1<{ automation_kill_switch: boolean }>(`SELECT automation_kill_switch FROM organizations WHERE id = $1`, [ctx.orgId]);
    if (org?.automation_kill_switch) throw new AppError("conflict", "El botón de detención de la agencia está activo. Desactívalo antes de activar campañas.");
    const acc = (await q1<{ connection_id: string | null }>(`SELECT connection_id FROM ad_accounts WHERE id = $1 AND org_id = $2`, [draft.structure.adAccountId, ctx.orgId]))!;
    const { token } = await connectionToken(ctx.orgId, acc.connection_id);
    try {
      await activate(draft.meta_ids, token);
    } catch (e) {
      throw new AppError("upstream", e instanceof MetaApiError ? e.userMessage : "No se pudo activar la campaña en Meta.");
    }
    await q(`UPDATE campaign_drafts SET status = 'active', updated_at = now() WHERE id = $1`, [draftId]);
    await q(`UPDATE experiments SET status = 'running', launched_at = now(), review_at = now() + interval '7 days' WHERE draft_id = $1 AND org_id = $2`, [draftId, ctx.orgId]);
    await audit({ orgId: ctx.orgId, clientId: client.id, userId: ctx.userId, actor: "user", action: "draft.activated", entity: "campaign_draft", entityId: draftId, details: { dailyBudget: draft.structure.dailyBudget } });
    return "Campaña activada. La primera evaluación se hará cuando haya datos suficientes (normalmente 4-7 días).";
  });
}

export async function discardDraft(draftId: string) {
  const ctx = await requireSession();
  await runAction(`/campanas`, async () => {
    requirePerm(ctx, "campaign.draft");
    const { draft } = await loadDraft(ctx, draftId);
    if (["publishing", "active"].includes(draft.status)) throw new AppError("conflict", "No se puede descartar una campaña activa o en publicación.");
    await q(`UPDATE campaign_drafts SET status = 'discarded', updated_at = now() WHERE id = $1`, [draftId]);
    return "Borrador descartado.";
  });
}
