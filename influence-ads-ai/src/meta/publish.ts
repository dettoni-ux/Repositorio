/**
 * Publicación controlada en Meta. Todo se crea en estado PAUSED: nada gasta
 * dinero hasta que un usuario autorizado pulse «Activar» (activateDraft).
 * El proceso es reanudable: los IDs creados se guardan paso a paso, así un
 * reintento continúa sin duplicar objetos.
 */
import "server-only";
import { q } from "@/lib/db";
import type { BusinessObjective } from "@/lib/schemas";
import { graph, toMinorUnits, type FetchLike } from "./graph";
import { optimizationFor, type DraftStructure } from "@/engine/drafts";

export type MetaIds = {
  campaignId?: string;
  adsets?: { feed?: string; vertical?: string; all?: string };
  images?: Record<string, string>; // creativeId -> image_hash
  creatives?: Record<string, string>; // `${adIndex}:${slot}` -> creative id
  ads?: Record<string, string>; // `${adIndex}:${slot}` -> ad id
};

export type PublishInput = {
  draftId: string;
  name: string;
  objective: BusinessObjective;
  metaObjective: string;
  actId: string;
  currency: string | null;
  token: string;
  structure: DraftStructure;
  /** creativeId -> bytes del archivo verificado */
  files: Map<string, Buffer>;
  existing: MetaIds;
  fetchImpl?: FetchLike;
};

async function save(draftId: string, ids: MetaIds) {
  await q(`UPDATE campaign_drafts SET meta_ids = $2, updated_at = now() WHERE id = $1`, [draftId, JSON.stringify(ids)]);
}

export async function publishPaused(p: PublishInput): Promise<MetaIds> {
  const ids: MetaIds = { ...p.existing, adsets: { ...p.existing.adsets }, images: { ...p.existing.images }, creatives: { ...p.existing.creatives }, ads: { ...p.existing.ads } };
  const d = p.structure;
  const opt = { token: p.token, fetchImpl: p.fetchImpl };

  // 1) Imágenes
  for (const [creativeId, buf] of p.files) {
    if (ids.images![creativeId]) continue;
    const r = await graph<{ images: Record<string, { hash: string }> }>(`${p.actId}/adimages`, { ...opt, method: "POST", params: { bytes: buf.toString("base64") } });
    const first = Object.values(r.images ?? {})[0];
    if (!first?.hash) throw new Error("Meta no devolvió el identificador de la imagen.");
    ids.images![creativeId] = first.hash;
    await save(p.draftId, ids);
  }

  // 2) Campaña (presupuesto de campaña / Advantage+ campaign budget)
  if (!ids.campaignId) {
    const r = await graph<{ id: string }>(`${p.actId}/campaigns`, {
      ...opt, method: "POST",
      params: {
        name: p.name,
        objective: p.metaObjective,
        status: "PAUSED",
        buying_type: "AUCTION",
        special_ad_categories: d.specialAdCategory === "NONE" ? [] : [d.specialAdCategory],
        daily_budget: toMinorUnits(d.dailyBudget!, p.currency),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      },
    });
    ids.campaignId = r.id;
    await save(p.draftId, ids);
  }

  // 3) Conjuntos de anuncios
  const o = optimizationFor(p.objective, d);
  const baseTargeting: Record<string, unknown> = {
    geo_locations: { countries: d.countries },
    age_min: d.ageMin,
    age_max: d.ageMax,
    targeting_automation: { advantage_audience: d.advantageAudience ? 1 : 0 },
  };
  const slots: { key: "all" | "feed" | "vertical"; targeting: Record<string, unknown> }[] =
    d.placements === "split"
      ? [
          { key: "feed", targeting: { ...baseTargeting, publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream", "explore_home"] } },
          { key: "vertical", targeting: { ...baseTargeting, publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] } },
        ]
      : [{ key: "all", targeting: baseTargeting }];
  for (const s of slots) {
    if (ids.adsets![s.key]) continue;
    const r = await graph<{ id: string }>(`${p.actId}/adsets`, {
      ...opt, method: "POST",
      params: {
        name: `${p.name} · ${s.key === "all" ? "Advantage+ ubicaciones" : s.key === "feed" ? "Feed" : "Stories y Reels"}`,
        campaign_id: ids.campaignId,
        billing_event: "IMPRESSIONS",
        optimization_goal: o.optimization_goal,
        destination_type: o.destination_type,
        promoted_object: o.promoted_object,
        targeting: s.targeting,
        status: "PAUSED",
        start_time: d.startTime,
        end_time: d.endTime,
      },
    });
    ids.adsets![s.key] = r.id;
    await save(p.draftId, ids);
  }

  // 4) Creatividades y anuncios
  for (const [i, ad] of d.ads.entries()) {
    const pieces: { slot: "all" | "feed" | "vertical"; creativeId: string }[] =
      d.placements === "split"
        ? [{ slot: "feed", creativeId: ad.feedCreativeId! }, { slot: "vertical", creativeId: ad.verticalCreativeId! }]
        : [{ slot: "all", creativeId: (ad.feedCreativeId ?? ad.verticalCreativeId)! }];
    for (const piece of pieces) {
      const k = `${i}:${piece.slot}`;
      if (!ids.creatives![k]) {
        const link = d.destination === "whatsapp" ? "https://api.whatsapp.com/send" : d.url;
        const callToAction: Record<string, unknown> = { type: ad.cta, value: {} as Record<string, string> };
        if (d.destination === "instant_form") (callToAction.value as Record<string, string>).lead_gen_form_id = d.leadFormId!;
        else if (d.destination === "whatsapp") { callToAction.type = "WHATSAPP_MESSAGE"; (callToAction.value as Record<string, string>).app_destination = "WHATSAPP"; }
        else (callToAction.value as Record<string, string>).link = d.url!;
        const r = await graph<{ id: string }>(`${p.actId}/adcreatives`, {
          ...opt, method: "POST",
          params: {
            name: `${ad.name} · ${piece.slot}`,
            object_story_spec: {
              page_id: d.pageId,
              ...(d.instagramUserId ? { instagram_user_id: d.instagramUserId } : {}),
              link_data: {
                image_hash: ids.images![piece.creativeId],
                link,
                message: ad.primaryText,
                name: ad.headline,
                description: ad.description || undefined,
                call_to_action: callToAction,
              },
            },
          },
        });
        ids.creatives![k] = r.id;
        await save(p.draftId, ids);
      }
      if (!ids.ads![k]) {
        const r = await graph<{ id: string }>(`${p.actId}/ads`, {
          ...opt, method: "POST",
          params: { name: `${ad.name} · ${piece.slot}`, adset_id: ids.adsets![piece.slot], creative: { creative_id: ids.creatives![k] }, status: "PAUSED" },
        });
        ids.ads![k] = r.id;
        await save(p.draftId, ids);
      }
    }
  }
  return ids;
}

/** Activa campaña, conjuntos y anuncios creados. Solo tras confirmación explícita. */
export async function activate(ids: MetaIds, token: string, fetchImpl?: FetchLike) {
  const all = [...Object.values(ids.ads ?? {}), ...Object.values(ids.adsets ?? {}).filter(Boolean) as string[], ids.campaignId].filter(Boolean) as string[];
  for (const id of all) await graph(id, { token, fetchImpl, method: "POST", params: { status: "ACTIVE" } });
}
