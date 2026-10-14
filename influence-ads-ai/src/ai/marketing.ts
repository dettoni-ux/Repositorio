/**
 * Motor de marketing: estrategia, conceptos creativos, copy, ficha de marca y
 * revisión de textos. Usa SOLO la información del cliente y su propio historial
 * (nunca datos de otros clientes).
 */
import "server-only";
import { z } from "zod";
import { generateStructured, type UserContent } from "./claude";
import { BUSINESS_OBJECTIVES, type ClientProfile } from "@/lib/schemas";

export const ANGLES = {
  problema_solucion: "Problema y solución",
  beneficio: "Beneficio principal",
  demostracion: "Demostración del producto",
  antes_despues: "Antes y después (solo si es legítimo y comprobable)",
  objeciones: "Preguntas frecuentes y objeciones",
  testimonio: "Testimonio real autorizado",
  oferta: "Oferta comercial",
  prueba_social: "Prueba social verificable",
  educativo: "Contenido educativo",
  ugc: "Estilo creador / UGC",
  inesperado: "Concepto visual inesperado",
} as const;
export type Angle = keyof typeof ANGLES;
const angleEnum = z.enum(Object.keys(ANGLES) as [Angle, ...Angle[]]);

const BASE_RULES = `Eres el equipo de estrategia de Influence Ads AI: media buyer senior, director creativo de respuesta directa, copywriter y analista de datos.

Reglas obligatorias:
- Usa exclusivamente la información entregada sobre el cliente y su historial. No inventes precios, cifras, premios, testimonios, garantías ni características.
- Toda afirmación que no esté respaldada en los datos entregados debe ir en "needsVerification" o "missingInfo", nunca presentada como hecho.
- Testimonios: solo los textos que aparecen en la lista de testimonios autorizados, sin modificar su sentido.
- "Antes y después" solo si el cliente entregó evidencia real y la categoría lo permite; si no, no uses ese ángulo.
- Urgencia solo si existe una oferta real con fecha o stock; nada de urgencia falsa.
- No prometas resultados garantizados ni digas que un anuncio "será ganador": son hipótesis a probar.
- Respeta los mensajes prohibidos y restricciones del cliente y las políticas publicitarias de Meta (no aludir a atributos personales del usuario como "¿Tienes sobrepeso?", no afirmaciones de salud o finanzas engañosas).
- Escribe en español natural del país del cliente, adaptado a su industria y tono; evita frases genéricas y clichés publicitarios.
- Diferencia datos observados, hipótesis y conclusiones.`;

export function clientBrief(c: { name: string; industry: string | null; website: string | null; country: string; currency: string; profile: ClientProfile; brandSummary: unknown }) {
  const p = c.profile;
  const lines = [
    `Cliente: ${c.name}`,
    `Industria: ${c.industry || "no indicada"}`,
    `País: ${c.country} · Moneda: ${c.currency}`,
    `Sitio web: ${c.website || "no indicado"}`,
    `Páginas de destino: ${p.landingPages.join(", ") || "no indicadas"}`,
    `Productos o servicios: ${p.products || "no indicados"}`,
    `Precios: ${p.prices || "no indicados"}`,
    `Ofertas vigentes: ${p.offers || "ninguna indicada"}`,
    `Ubicaciones: ${p.locations.join(", ") || "no indicadas"}`,
    `Público objetivo: ${p.audience || "no indicado"}`,
    `Diferenciadores reales: ${p.differentiators.join("; ") || "no indicados"}`,
    `Pruebas verificables: ${p.proofs.join("; ") || "ninguna"}`,
    `Testimonios autorizados: ${p.testimonials.length ? p.testimonials.map((t) => `«${t}»`).join(" | ") : "ninguno"}`,
    `Objetivo comercial: ${p.businessObjective ? BUSINESS_OBJECTIVES[p.businessObjective] : "no indicado"}`,
    `CPA objetivo: ${p.targetCpa ?? "no indicado"} · Valor de un lead: ${p.leadValue ?? "no indicado"} · Margen: ${p.marginPct !== undefined ? `${p.marginPct} %` : "no indicado"}`,
    `Tono: ${p.tone || "no indicado"}`,
    `Colores de marca: ${p.colors.join(", ") || "no indicados"}`,
    `Mensajes prohibidos: ${p.prohibited.join("; ") || "ninguno"}`,
    `Restricciones: ${p.restrictions || "ninguna"}`,
    `Categoría especial de anuncios: ${p.specialAdCategory}`,
  ];
  if (c.brandSummary) lines.push(`Ficha de marca (sintetizada previamente): ${JSON.stringify(c.brandSummary)}`);
  return lines.join("\n");
}

// ── Estrategia ───────────────────────────────────────────────────────────────
export const strategySchema = z.object({
  product: z.string().describe("Qué producto o servicio se promociona"),
  problem: z.string().describe("Qué problema o necesidad resuelve"),
  audience: z.string().describe("Público con mayor afinidad y por qué"),
  objections: z.array(z.string()).describe("Objeciones que podrían impedir la compra"),
  valueProposition: z.string(),
  creativeApproach: z.string().describe("Qué tipo de creatividad podría captar la atención"),
  proof: z.string().describe("Qué prueba respalda la promesa; si no hay, decirlo"),
  cta: z.string(),
  destination: z.string().describe("Destino recomendado (sitio, WhatsApp, formulario) y por qué"),
  successMetric: z.string().describe("Métrica que determinará el éxito y umbral sugerido"),
  budgetAdvice: z.string().describe("Recomendación de presupuesto y duración mínima de la prueba"),
  hypotheses: z.array(z.string()).describe("Hipótesis a probar"),
  risks: z.array(z.string()),
  missingInfo: z.array(z.string()).describe("Datos que faltan y conviene pedir al usuario"),
  rationale: z.string().describe("Explicación breve con los datos que la respaldan"),
});
export type Strategy = z.infer<typeof strategySchema>;

export async function generateStrategy(input: { brief: string; objective: string; extra: string; history: string }) {
  return generateStructured({
    schema: strategySchema,
    effort: "high",
    system: BASE_RULES,
    content: `Prepara la estrategia de una campaña en Meta Ads.

${input.brief}

Objetivo de esta campaña: ${input.objective}
Indicaciones adicionales del usuario: ${input.extra || "ninguna"}

Historial y aprendizajes de ESTE cliente (datos observados, hipótesis y conclusiones):
${input.history || "Sin historial todavía: trata todo como hipótesis inicial."}

Antes de proponer, determina: producto, problema, público, objeciones, propuesta de valor, tipo de creatividad, prueba, CTA, destino y métrica de éxito. Adapta la estrategia a la industria y a los datos; no apliques una fórmula fija.`,
  });
}

// ── Conceptos creativos + copy ───────────────────────────────────────────────
export const conceptSchema = z.object({
  angle: angleEnum,
  title: z.string(),
  hypothesis: z.string().describe("Hipótesis creativa: por qué este concepto podría funcionar con este público"),
  hook: z.string().describe("Gancho de los primeros 2 segundos o primera línea"),
  valueProp: z.string(),
  visualIdea: z.string().describe("Desarrollo visual: escena, encuadre, qué se ve, jerarquía"),
  visualSource: z.enum(["foto_real", "ia_permitida"]).describe("foto_real si el producto/servicio debe mostrarse con fotos reales del cliente"),
  imagePrompt: z.string().describe("Prompt en inglés para generar un FONDO sin texto, sin logos, sin manos en primer plano; vacío si visualSource=foto_real"),
  cta: z.string(),
  audience: z.string().describe("Público al que se dirige"),
  objection: z.string().describe("Objeción que busca resolver"),
  conversionHypothesis: z.string(),
  needsVerification: z.array(z.string()).describe("Afirmaciones del copy que el usuario debe confirmar antes de publicar"),
  copy: z.object({
    primaryShort: z.string(),
    primaryMedium: z.string(),
    primaryLong: z.string(),
    headline: z.string().describe("Máximo ~40 caracteres"),
    description: z.string().describe("Máximo ~30 caracteres"),
    primaryVariants: z.array(z.string()),
    headlineVariants: z.array(z.string()),
    overlayHeadline: z.string().describe("Texto para integrar en la imagen: máximo 7 palabras"),
    overlaySubline: z.string().describe("Texto secundario en imagen: máximo 10 palabras, puede ir vacío"),
    videoScript: z.string().describe("Guion de 15-30 s con tiempos (0-3 s gancho, etc.)"),
    onScreenText: z.array(z.string()),
  }),
});
export type Concept = z.infer<typeof conceptSchema>;

export async function generateConcepts(input: { brief: string; strategy: Strategy | null; objective: string; count: number; angles: Angle[]; history: string; extra?: string }) {
  const count = Math.max(1, Math.min(input.count, 10));
  const out = await generateStructured({
    schema: z.object({ concepts: z.array(conceptSchema) }),
    effort: "high",
    system: BASE_RULES,
    content: `Crea ${count} conceptos publicitarios REALMENTE distintos entre sí (ángulo, gancho, escena visual y argumento diferentes; no variaciones de la misma idea).

${input.brief}

Objetivo: ${input.objective}
Estrategia acordada: ${input.strategy ? JSON.stringify(input.strategy) : "no definida aún"}
Ángulos preferidos (usa los pertinentes, descarta los que no apliquen honestamente): ${input.angles.length ? input.angles.map((a) => ANGLES[a]).join(", ") : "elige los más adecuados"}
Indicaciones del usuario: ${input.extra || "ninguna"}

Historial de este cliente:
${input.history || "Sin historial."}

Para cada concepto entrega hipótesis, gancho, propuesta de valor, desarrollo visual, CTA y el copy completo (variantes corta, media y larga, titular, descripción, variantes, guion de video y texto en pantalla).
El texto en imagen debe ser breve y legible en un celular. El prompt de imagen debe describir solo el fondo/escena (sin texto), coherente con la marca y realista.`,
  });
  return out.concepts.slice(0, count);
}

export async function regenerateCopy(input: { brief: string; concept: Concept; instruction: string }) {
  return generateStructured({
    schema: conceptSchema.shape.copy,
    effort: "medium",
    system: BASE_RULES,
    content: `${input.brief}\n\nConcepto actual: ${JSON.stringify(input.concept)}\n\nReescribe el copy siguiendo esta indicación del usuario: ${input.instruction || "propón una versión mejor y más clara"}. Mantén las reglas.`,
  });
}

// ── Ficha de marca a partir de materiales ────────────────────────────────────
export const brandSummarySchema = z.object({
  summary: z.string(),
  voice: z.string(),
  visualStyle: z.string(),
  palette: z.array(z.string()).describe("Colores observados en formato #RRGGBB"),
  keyMessages: z.array(z.string()),
  doList: z.array(z.string()),
  dontList: z.array(z.string()),
  productObservations: z.array(z.string()).describe("Lo que se observa en las fotos del producto"),
  gaps: z.array(z.string()).describe("Información que falta para crear buenas campañas"),
  sources: z.array(z.string()).describe("Materiales usados para cada conclusión"),
});

export async function analyzeBrand(input: { brief: string; images: { mime: string; base64: string; name: string }[]; documentsText: string }) {
  const content: UserContent = [];
  for (const img of input.images.slice(0, 8)) {
    content.push({ type: "text", text: `Imagen: ${img.name}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mime as "image/jpeg", data: img.base64 } });
  }
  content.push({
    type: "text",
    text: `${input.brief}\n\nTextos de documentos subidos:\n${input.documentsText || "ninguno"}\n\nCrea la ficha de marca. Basa cada punto en los materiales; lo que no se pueda deducir va en "gaps".`,
  });
  return generateStructured({ schema: brandSummarySchema, effort: "medium", system: BASE_RULES, content });
}

// ── Revisión de textos de la pieza ───────────────────────────────────────────
export const proofreadSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.object({ text: z.string(), problem: z.string(), suggestion: z.string() })),
});

export async function proofread(texts: string[], brief: string) {
  return generateStructured({
    schema: proofreadSchema,
    effort: "low",
    system: BASE_RULES,
    content: `Revisa ortografía, gramática, claridad y cumplimiento de las reglas en estos textos de un anuncio:\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nContexto del cliente:\n${brief}\n\nMarca ok=false si hay errores, afirmaciones no respaldadas o mensajes prohibidos.`,
  });
}
