/** Esquemas de validación compartidos (entradas de formularios, fichas, límites). */
import { z } from "zod";

/** Interpreta números escritos al estilo chileno ("1.500.000", "12,5") o internacional ("12.5"). */
export function parseLocaleNumber(v: unknown): number | undefined {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const optNum = z.preprocess(parseLocaleNumber, z.number().finite().nonnegative().optional());
const bool = (def: boolean) => z.preprocess((v) => (v === undefined ? def : v === true || v === "on" || v === "true" || v === "1"), z.boolean());
const strList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/\n|;/).map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.string().trim().min(1).max(500)).max(50),
).default([]);

export const SPECIAL_AD_CATEGORIES = ["NONE", "HOUSING", "EMPLOYMENT", "FINANCIAL_PRODUCTS_SERVICES", "ISSUES_ELECTIONS_POLITICS"] as const;

export const BUSINESS_OBJECTIVES = {
  leads: "Conseguir contactos (leads)",
  sales: "Vender en línea",
  messages: "Recibir mensajes por WhatsApp/Messenger",
  traffic: "Llevar visitas al sitio",
  awareness: "Dar a conocer la marca",
} as const;
export type BusinessObjective = keyof typeof BUSINESS_OBJECTIVES;

export const clientProfileSchema = z.object({
  products: z.string().trim().max(4000).default(""),
  landingPages: strList,
  locations: strList,
  audience: z.string().trim().max(2000).default(""),
  offers: z.string().trim().max(2000).default(""),
  prices: z.string().trim().max(2000).default(""),
  differentiators: strList,
  businessObjective: z.enum(Object.keys(BUSINESS_OBJECTIVES) as [BusinessObjective, ...BusinessObjective[]]).optional(),
  monthlyBudget: optNum,
  targetCpa: optNum,
  leadValue: optNum,
  marginPct: optNum.refine((v) => v === undefined || v <= 100, "El margen debe estar entre 0 y 100"),
  colors: z.preprocess(
    (v) => (typeof v === "string" ? v.split(/[\s,;]+/).filter(Boolean) : v),
    z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa colores en formato #RRGGBB")).max(8),
  ).default([]),
  tone: z.string().trim().max(500).default(""),
  prohibited: strList,
  restrictions: z.string().trim().max(2000).default(""),
  proofs: strList, // pruebas verificables: premios, cifras con fuente, certificaciones
  testimonials: strList, // solo testimonios reales y autorizados
  whatsapp: z.string().trim().max(30).default(""),
  specialAdCategory: z.enum(SPECIAL_AD_CATEGORIES).default("NONE"),
  logoAssetId: z.string().uuid().optional(),
});
export type ClientProfile = z.infer<typeof clientProfileSchema>;

export const ACTION_TYPES = ["pause", "resume", "budget_change", "new_creative", "review_tracking", "review_landing", "review_offer", "review_audience"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_LABELS: Record<ActionType, string> = {
  pause: "Pausar",
  resume: "Reactivar",
  budget_change: "Cambiar presupuesto",
  new_creative: "Crear nuevas creatividades",
  review_tracking: "Revisar medición",
  review_landing: "Revisar página de destino",
  review_offer: "Revisar oferta",
  review_audience: "Revisar audiencia",
};
/** Acciones que la API puede ejecutar automáticamente (el resto siempre son tareas humanas). */
export const API_EXECUTABLE: ActionType[] = ["pause", "resume", "budget_change"];

export const guardrailsSchema = z.object({
  maxDailyBudget: optNum,
  maxMonthlyBudget: optNum,
  maxBudgetChangePct: z.coerce.number().min(1).max(100).default(20),
  targetCpa: optNum,
  minRoas: optNum,
  /** Mínimo de conversiones para considerar una decisión basada en costo por resultado. */
  minConversions: z.coerce.number().int().min(1).max(1000).default(10),
  /** Gasto mínimo, como múltiplo del CPA objetivo, antes de pausar por falta de resultados. */
  minSpendCpaMultiple: z.coerce.number().min(1).max(20).default(3),
  /** Días recientes excluidos de decisiones por retraso de atribución. */
  attributionLagDays: z.coerce.number().int().min(0).max(7).default(1),
  /** Horas mínimas entre dos cambios sobre el mismo objeto. */
  cooldownHours: z.coerce.number().int().min(12).max(720).default(72),
  /** Días mínimos desde el lanzamiento antes de juzgar (fase de aprendizaje). */
  minDaysLive: z.coerce.number().int().min(0).max(30).default(4),
  evaluationHourLocal: z.coerce.number().int().min(0).max(23).default(9),
  pauseEnabled: bool(true),
  scaleEnabled: bool(true),
  /** Acciones que el nivel 3 puede ejecutar sin aprobación. Vacío = ninguna. */
  autoActions: z.array(z.enum(ACTION_TYPES)).default([]),
});
export type Guardrails = z.infer<typeof guardrailsSchema>;

export function parseGuardrails(raw: unknown): Guardrails {
  const r = guardrailsSchema.safeParse(raw ?? {});
  return r.success ? r.data : guardrailsSchema.parse({});
}

export function parseProfile(raw: unknown): ClientProfile {
  const r = clientProfileSchema.safeParse(raw ?? {});
  return r.success ? r.data : clientProfileSchema.parse({});
}

/** Mapea el objetivo comercial al objetivo de campaña de Meta (ODAX). */
export const META_OBJECTIVE: Record<BusinessObjective, string> = {
  leads: "OUTCOME_LEADS",
  sales: "OUTCOME_SALES",
  messages: "OUTCOME_ENGAGEMENT",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
};
