/**
 * Borradores de campaña: estructura y validación previa a la publicación
 * (módulo puro). Ninguna publicación ocurre si hay errores bloqueantes.
 */
import { z } from "zod";
import { SPECIAL_AD_CATEGORIES, type BusinessObjective, META_OBJECTIVE } from "@/lib/schemas";

export const CTA_TYPES = {
  LEARN_MORE: "Más información",
  SHOP_NOW: "Comprar",
  SIGN_UP: "Registrarte",
  CONTACT_US: "Contactarnos",
  GET_QUOTE: "Solicitar cotización",
  WHATSAPP_MESSAGE: "Enviar mensaje de WhatsApp",
  BOOK_TRAVEL: "Reservar",
  ORDER_NOW: "Pedir ahora",
} as const;
export type CtaType = keyof typeof CTA_TYPES;

export const draftAdSchema = z.object({
  conceptId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  feedCreativeId: z.string().uuid().optional(),
  verticalCreativeId: z.string().uuid().optional(),
  primaryText: z.string().trim().max(3000),
  headline: z.string().trim().max(255),
  description: z.string().trim().max(255).default(""),
  cta: z.enum(Object.keys(CTA_TYPES) as [CtaType, ...CtaType[]]).default("LEARN_MORE"),
});
export type DraftAd = z.infer<typeof draftAdSchema>;

export const draftStructureSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  pageId: z.string().optional(),
  instagramUserId: z.string().optional(),
  destination: z.enum(["website", "whatsapp", "instant_form"]).default("website"),
  url: z.string().trim().optional(),
  leadFormId: z.string().trim().optional(),
  pixelId: z.string().trim().optional(),
  dailyBudget: z.number().positive().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  countries: z.array(z.string().length(2)).default(["CL"]),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  advantageAudience: z.boolean().default(true),
  placements: z.enum(["advantage", "split"]).default("advantage"),
  specialAdCategory: z.enum(SPECIAL_AD_CATEGORIES).default("NONE"),
  ads: z.array(draftAdSchema).default([]),
  /** El usuario confirmó las afirmaciones marcadas para verificar. */
  claimsConfirmed: z.boolean().default(false),
});
export type DraftStructure = z.infer<typeof draftStructureSchema>;

export type ValidationCheck = { key: string; ok: boolean; blocking: boolean; label: string; detail: string };

export type ValidationContext = {
  objective: BusinessObjective;
  clientId: string;
  account: { id: string; client_id: string | null; managed: boolean; account_status: number | null; currency: string | null; name: string } | null;
  connection: { status: string; scopes: string[]; expiresAt: string | null } | null;
  page: { page_id: string; client_id: string | null; name: string } | null;
  guardrails: { maxDailyBudget?: number; maxMonthlyBudget?: number };
  creatives: Map<string, { status: string; blocking: number; format: string; exists: boolean }>;
  prohibited: string[];
  pendingVerification: string[];
  landingPages: string[];
};

const RISKY_CLAIMS = [/garantizad[oa]s?/i, /\b100\s?%/i, /\bcura(r|n)?\b/i, /sin riesgo/i, /gana(r|s)? dinero/i, /baj(a|ar) de peso/i, /el mejor del mundo/i, /\bmilagro/i];

export function validateDraft(d: DraftStructure, v: ValidationContext): ValidationCheck[] {
  const c: ValidationCheck[] = [];
  const add = (key: string, ok: boolean, label: string, detail: string, blocking = true) => c.push({ key, ok, blocking, label, detail });

  // Cuenta publicitaria
  const acc = v.account;
  add("cuenta", !!acc && acc.client_id === v.clientId && acc.managed, "Cuenta publicitaria del cliente", acc ? `${acc.name}${acc.client_id !== v.clientId ? " (no pertenece a este cliente)" : ""}` : "No seleccionada");
  if (acc) add("cuenta-activa", acc.account_status === 1, "Cuenta publicitaria activa en Meta", acc.account_status === 1 ? "Activa" : `Estado de la cuenta en Meta: ${acc.account_status ?? "desconocido"} (debe estar activa, sin deudas ni restricciones).`);

  // Permisos
  const conn = v.connection;
  const connOk = !!conn && conn.status === "active" && (!conn.expiresAt || Date.parse(conn.expiresAt) > Date.now());
  add("permisos", connOk && !!conn?.scopes.includes("ads_management"), "Permisos de Meta vigentes", !conn ? "Sin conexión" : !connOk ? "La conexión venció o fue revocada" : conn.scopes.includes("ads_management") ? "Incluye ads_management" : "Falta el permiso ads_management");

  // Objetivo
  add("objetivo", !!META_OBJECTIVE[v.objective], "Objetivo de campaña", META_OBJECTIVE[v.objective] ?? "Sin objetivo");

  // Presupuesto
  const b = d.dailyBudget;
  add("presupuesto", !!b && b > 0, "Presupuesto diario definido", b ? `${b} ${acc?.currency ?? ""}` : "Falta el presupuesto diario");
  if (b && v.guardrails.maxDailyBudget !== undefined) add("presupuesto-max", b <= v.guardrails.maxDailyBudget, "Dentro del máximo diario del cliente", `Máximo: ${v.guardrails.maxDailyBudget}`);
  if (b && v.guardrails.maxMonthlyBudget !== undefined) add("presupuesto-mes", b * 30 <= v.guardrails.maxMonthlyBudget, "Proyección mensual dentro del máximo", `≈${Math.round(b * 30)} de ${v.guardrails.maxMonthlyBudget} al mes`, false);

  // Audiencia
  add("audiencia", d.countries.length > 0 && d.ageMin <= d.ageMax, "Audiencia definida", `${d.countries.join(", ")} · ${d.ageMin}-${d.ageMax} años${d.advantageAudience ? " · Advantage+ audiencia" : ""}`);
  if (d.specialAdCategory !== "NONE") add("categoria", d.ageMin === 18 && d.ageMax === 65, "Categoría especial: edad sin restricción", "Las categorías especiales (vivienda, empleo, crédito) no permiten limitar la edad.", true);

  // Página / identidad
  add("pagina", !!v.page && v.page.client_id === v.clientId, "Página de Facebook del cliente", v.page ? v.page.name : "Selecciona la página que publicará el anuncio");

  // Destino
  if (d.destination === "website") {
    const url = d.url ?? "";
    const valid = /^https:\/\/[^\s]+\.[^\s]+/.test(url);
    add("destino", valid, "Página de destino válida (https)", url || "Falta la URL");
    if (valid && v.landingPages.length && !v.landingPages.some((l) => url.startsWith(l.replace(/\/$/, "")))) {
      add("destino-ficha", false, "Destino registrado en la ficha del cliente", "La URL no coincide con las páginas de destino de la ficha. Confirma que sea correcta.", false);
    }
    if (v.objective === "sales" || v.objective === "leads") {
      add("pixel", !!d.pixelId, "Píxel / conjunto de datos para medir conversiones", d.pixelId ? d.pixelId : "Para optimizar ventas o leads en el sitio se necesita el ID del píxel.");
    }
  } else if (d.destination === "whatsapp") {
    add("destino", v.objective === "messages", "WhatsApp como destino", v.objective === "messages" ? "La página debe tener un número de WhatsApp Business vinculado." : "WhatsApp se usa con el objetivo «Recibir mensajes».");
  } else {
    add("destino", !!d.leadFormId && v.objective === "leads", "Formulario instantáneo", d.leadFormId ? `Formulario ${d.leadFormId}` : "Indica el ID del formulario instantáneo de la página.");
  }

  // Anuncios, creatividades y copy
  add("anuncios", d.ads.length > 0, "Al menos un anuncio", `${d.ads.length} anuncio(s)`);
  for (const [i, ad] of d.ads.entries()) {
    const n = `Anuncio ${i + 1}`;
    const ids = [ad.feedCreativeId, ad.verticalCreativeId].filter(Boolean) as string[];
    add(`ad${i}-pieza`, ids.length > 0, `${n}: creatividad`, ids.length ? `${ids.length} formato(s)` : "Sin creatividad");
    for (const id of ids) {
      const cr = v.creatives.get(id);
      add(`ad${i}-pieza-${id}`, !!cr && cr.exists && cr.blocking === 0, `${n}: archivo verificado`, !cr ? "No encontrada" : !cr.exists ? "El archivo no existe" : cr.blocking ? `${cr.blocking} problema(s) técnico(s)` : `${cr.format} OK`);
      add(`ad${i}-aprob-${id}`, cr?.status === "approved", `${n}: creatividad aprobada`, cr?.status === "approved" ? "Aprobada" : "Apruébala en el laboratorio creativo");
    }
    if (d.placements === "split") add(`ad${i}-vertical`, !!ad.verticalCreativeId && !!ad.feedCreativeId, `${n}: versiones feed y 9:16`, "La ubicación dividida necesita ambas versiones.");
    add(`ad${i}-texto`, ad.primaryText.length > 0, `${n}: texto principal`, ad.primaryText ? `${ad.primaryText.length} caracteres` : "Falta");
    add(`ad${i}-titular`, ad.headline.length > 0, `${n}: titular`, ad.headline || "Falta");
    if (ad.headline.length > 40) add(`ad${i}-titular-largo`, false, `${n}: titular corto`, "Más de 40 caracteres puede cortarse en celulares.", false);
    const all = `${ad.primaryText} ${ad.headline} ${ad.description}`;
    const hits = v.prohibited.filter((p) => p && all.toLowerCase().includes(p.toLowerCase()));
    add(`ad${i}-prohibidos`, hits.length === 0, `${n}: sin mensajes prohibidos`, hits.length ? `Contiene: ${hits.join(", ")}` : "OK");
    const risky = RISKY_CLAIMS.filter((r) => r.test(all)).map((r) => all.match(r)?.[0]);
    add(`ad${i}-politicas`, risky.length === 0, `${n}: afirmaciones de riesgo según políticas`, risky.length ? `Revisa: ${risky.join(", ")}` : "Sin expresiones de riesgo detectadas", false);
  }
  if (v.pendingVerification.length) {
    add("verificacion", d.claimsConfirmed, "Afirmaciones confirmadas por el usuario", d.claimsConfirmed ? "Confirmadas" : `Confirma: ${v.pendingVerification.slice(0, 5).join(" · ")}`);
  }
  return c;
}

export function canPublish(checks: ValidationCheck[]): boolean {
  return checks.every((c) => c.ok || !c.blocking);
}

/** Configuración de optimización según objetivo y destino. */
export function optimizationFor(objective: BusinessObjective, d: DraftStructure): { optimization_goal: string; destination_type?: string; promoted_object?: Record<string, string> } {
  switch (objective) {
    case "leads":
      return d.destination === "instant_form"
        ? { optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: d.pageId! } }
        : { optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE", promoted_object: { pixel_id: d.pixelId!, custom_event_type: "LEAD" } };
    case "sales":
      return { optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE", promoted_object: { pixel_id: d.pixelId!, custom_event_type: "PURCHASE" } };
    case "messages":
      return { optimization_goal: "CONVERSATIONS", destination_type: "WHATSAPP", promoted_object: { page_id: d.pageId! } };
    case "traffic":
      return { optimization_goal: "LINK_CLICKS", destination_type: "WEBSITE" };
    case "awareness":
      return { optimization_goal: "REACH" };
  }
}
