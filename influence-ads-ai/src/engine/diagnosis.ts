/**
 * Diagnóstico automático de campañas (módulo puro, sin BD ni red).
 *
 * Principios:
 *  - No atribuye todo al anuncio: separa creatividad, audiencia, oferta,
 *    presupuesto, medición, sitio web y proceso comercial.
 *  - Exige volumen mínimo y pruebas estadísticas antes de concluir.
 *  - Cada hallazgo dice qué pasa, qué datos lo respaldan, qué causa es probable,
 *    qué NO se puede confirmar, qué hacer, qué evaluar, confianza y cuándo revisar.
 */
import { derive, pctChange, safeDiv, type Totals } from "@/lib/metrics";
import { poissonRateP, twoProportionP, confidenceFromP } from "@/lib/stats";
import type { Guardrails, ActionType } from "@/lib/schemas";

export type Area = "creatividad" | "audiencia" | "oferta" | "presupuesto" | "medicion" | "sitio" | "comercial" | "datos";
export const AREA_LABELS: Record<Area, string> = {
  creatividad: "Creatividad", audiencia: "Audiencia", oferta: "Oferta", presupuesto: "Presupuesto",
  medicion: "Medición", sitio: "Sitio web", comercial: "Proceso comercial", datos: "Datos",
};

export type Confidence = "baja" | "media" | "alta";

export type Finding = {
  key: string;
  area: Area;
  severity: "alta" | "media" | "baja" | "positiva" | "info";
  title: string;
  what: string;
  evidence: string[];
  probableCause: string;
  cannotConfirm: string[];
  recommendation: string;
  expected: string;
  confidence: Confidence;
  reviewInDays: number;
  target?: { level: "campaign" | "adset" | "ad"; metaId: string; name: string; adAccountId: string };
  suggestedAction?: ActionType;
};

export type PerfInput = {
  level: "campaign" | "adset" | "ad";
  ad_account_id: string;
  meta_id: string;
  name: string;
  objective: string | null;
  effective_status: string | null;
  daily_budget: number | null;
  campaign_meta_id: string | null;
  created_time: string | null;
  totals: Totals;
  prev: Totals;
  frequency: number | null;
  prevFrequency: number | null;
};

export type RealData = { lead: number; qualified_lead: number; sale: number; revenue: number; byCampaign: { campaign_meta_id: string; kind: string; n: number; revenue: number }[] };

export type DiagnosisInput = {
  currency: string;
  periodDays: number;
  account: { totals: Totals; prev: Totals };
  campaigns: PerfInput[];
  ads: PerfInput[];
  real: RealData | null;
  guardrails: Guardrails;
  /** Valor de un lead o CPA objetivo según la ficha del cliente, si existe. */
  targetCpa?: number;
  now?: Date;
};

const MIN_IMPRESSIONS = 2000;

export function money(v: number | null, currency: string): string {
  if (v === null) return "sin datos suficientes";
  const decimals = ["CLP", "COP", "JPY", "KRW", "PYG"].includes(currency) ? 0 : 2;
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(v);
}
export function pct(v: number | null, digits = 2): string {
  return v === null ? "sin datos suficientes" : `${(v * 100).toFixed(digits).replace(".", ",")} %`;
}

function conversionsOf(objective: string | null, t: Totals): { n: number; label: string } {
  if (objective === "OUTCOME_SALES") return { n: t.purchases, label: "compras" };
  if (objective === "OUTCOME_LEADS") return { n: t.leads, label: "leads" };
  if (objective === "OUTCOME_ENGAGEMENT") return { n: t.messaging_conversations, label: "conversaciones" };
  if (t.purchases > 0) return { n: t.purchases, label: "compras" };
  if (t.leads > 0) return { n: t.leads, label: "leads" };
  return { n: t.messaging_conversations, label: "conversaciones" };
}

function isActive(p: PerfInput) {
  return !p.effective_status || ["ACTIVE", "IN_PROCESS", "WITH_ISSUES"].includes(p.effective_status);
}

export function daysLive(created: string | null, now = new Date()): number | null {
  if (!created) return null;
  return Math.floor((now.getTime() - Date.parse(created)) / 86400000);
}

export function diagnose(input: DiagnosisInput): Finding[] {
  const f: Finding[] = [];
  const cur = input.currency;
  const g = input.guardrails;
  const target = g.targetCpa ?? input.targetCpa;
  const acc = input.account.totals;

  if (acc.spend <= 0 || acc.impressions === 0) {
    f.push({
      key: "sin-datos", area: "datos", severity: "info", title: "Sin datos suficientes",
      what: "No hay inversión ni impresiones registradas en el periodo para las cuentas de este cliente.",
      evidence: [`Inversión del periodo: ${money(acc.spend, cur)}`, `Impresiones: ${acc.impressions}`],
      probableCause: "Las campañas están pausadas, la cuenta no se ha sincronizado o no hay cuentas publicitarias asignadas.",
      cannotConfirm: [],
      recommendation: "Verifica que la cuenta esté asignada y sincronizada en «Cuentas publicitarias».",
      expected: "Contar con datos reales antes de evaluar.", confidence: "alta", reviewInDays: 1,
    });
    return f;
  }

  // ── Medición: diferencias entre Meta y ventas reales ──────────────────────
  const real = input.real;
  if (real && real.sale > 0) {
    const metaSales = acc.purchases;
    if (metaSales === 0) {
      f.push({
        key: "medicion-sin-compras-meta", area: "medicion", severity: "alta", title: "Meta no registra ventas que sí ocurrieron",
        what: `Registraste ${real.sale} ventas reales en el periodo, pero Meta reporta 0 compras.`,
        evidence: [`Ventas reales: ${real.sale} (${money(real.revenue, cur)})`, "Compras reportadas por Meta: 0"],
        probableCause: "El píxel o la API de Conversiones no envían el evento de compra, o las ventas se cierran fuera del sitio (WhatsApp, tienda física).",
        cannotConfirm: ["Si esas ventas provienen de los anuncios: sin seguimiento no es posible atribuirlas."],
        recommendation: "Revisa la configuración del evento Purchase (píxel y API de Conversiones) o registra en el sistema la campaña de origen de cada venta.",
        expected: "Que las compras reportadas por Meta se acerquen a las ventas reales atribuibles.", confidence: "media", reviewInDays: 7,
        suggestedAction: "review_tracking",
      });
    } else {
      const diff = Math.abs(metaSales - real.sale) / Math.max(metaSales, real.sale);
      if (diff >= 0.3) {
        f.push({
          key: "medicion-discrepancia", area: "medicion", severity: "media", title: "Las ventas de Meta no coinciden con las ventas reales",
          what: `Meta reporta ${metaSales} compras y el registro real indica ${real.sale} (${Math.round(diff * 100)} % de diferencia).`,
          evidence: [`Compras Meta: ${metaSales} · valor ${money(acc.purchase_value, cur)}`, `Ventas reales: ${real.sale} · ${money(real.revenue, cur)}`],
          probableCause: "Diferencias de ventana de atribución, conversiones modeladas, duplicación de eventos o ventas no registradas.",
          cannotConfirm: ["Cuál de las fuentes está incompleta sin revisar eventos duplicados y el registro comercial."],
          recommendation: "Evalúa las campañas con las ventas reales cuando sea posible y revisa la deduplicación de eventos (event_id) entre píxel y API de Conversiones.",
          expected: "Diferencia menor al 20 % o, al menos, explicada.", confidence: "media", reviewInDays: 14,
          suggestedAction: "review_tracking",
        });
      }
    }
  }

  // ── Calidad de leads (proceso comercial) ──────────────────────────────────
  if (real) {
    const leadsReal = real.lead + real.qualified_lead;
    if (leadsReal >= 20) {
      const qualRate = real.qualified_lead / leadsReal;
      if (qualRate < 0.2) {
        f.push({
          key: "calidad-leads", area: "comercial", severity: "media", title: "Pocos leads calificados",
          what: `Solo ${Math.round(qualRate * 100)} % de los leads registrados quedó como calificado.`,
          evidence: [`Leads registrados: ${leadsReal}`, `Calificados: ${real.qualified_lead}`],
          probableCause: "El anuncio o formulario atrae personas fuera del público objetivo, o el seguimiento comercial es lento.",
          cannotConfirm: ["Si el problema es la segmentación, el mensaje o la velocidad de respuesta: se necesita comparar por campaña y tiempo de respuesta."],
          recommendation: "Agrega una pregunta de calificación al formulario o un mensaje que filtre (precio, zona), y mide el tiempo de respuesta del equipo comercial.",
          expected: "Mayor proporción de leads calificados aunque el costo por lead suba.", confidence: leadsReal >= 50 ? "media" : "baja", reviewInDays: 14,
          suggestedAction: "review_offer",
        });
      }
    }
  }

  // ── Por campaña ───────────────────────────────────────────────────────────
  const active = input.campaigns.filter((c) => c.totals.spend > 0);
  for (const c of active) {
    const d = derive(c.totals);
    const pd = derive(c.prev);
    const conv = conversionsOf(c.objective, c.totals);
    const tgt = { level: c.level, metaId: c.meta_id, name: c.name, adAccountId: c.ad_account_id } as const;

    // Medición: clics sin conversiones en objetivos de conversión
    if ((c.objective === "OUTCOME_SALES" || c.objective === "OUTCOME_LEADS") && conv.n === 0 && c.totals.link_clicks >= 100 && (!target || c.totals.spend >= target * 2)) {
      f.push({
        key: `medicion-${c.meta_id}`, area: "medicion", severity: "alta", title: "Hay clics pero no se registran conversiones",
        what: `«${c.name}» recibió ${c.totals.link_clicks} clics en el enlace y 0 ${conv.label}.`,
        evidence: [`Inversión: ${money(c.totals.spend, cur)}`, `Clics en el enlace: ${c.totals.link_clicks}`, `CTR del enlace: ${pct(d.linkCtr)}`],
        probableCause: "El evento de conversión no se está registrando (píxel, API de Conversiones o formulario) o la página de destino falla.",
        cannotConfirm: ["Si la oferta o la página convencen: mientras la medición no funcione, no se puede evaluar."],
        recommendation: "Haz una conversión de prueba y verifica que aparezca en el Administrador de eventos. Revisa que la página cargue bien en celulares.",
        expected: "Ver conversiones registradas en las próximas 48 horas tras corregir.", confidence: "media", reviewInDays: 3, target: tgt,
        suggestedAction: "review_tracking",
      });
      continue;
    }

    // CTR en caída respecto del periodo anterior comparable
    if (c.totals.impressions >= MIN_IMPRESSIONS && c.prev.impressions >= MIN_IMPRESSIONS && d.linkCtr !== null && pd.linkCtr !== null) {
      const change = pctChange(d.linkCtr, pd.linkCtr)!;
      const p = twoProportionP(c.totals.link_clicks, c.totals.impressions, c.prev.link_clicks, c.prev.impressions);
      if (change <= -0.25 && p !== null && p < 0.05) {
        const freqUp = c.frequency !== null && c.prevFrequency !== null && c.frequency >= 2.5 && c.frequency > c.prevFrequency * 1.2;
        f.push({
          key: `ctr-${c.meta_id}`, area: "creatividad", severity: "media",
          title: freqUp ? "Probable fatiga creativa" : "El CTR bajó frente al periodo anterior",
          what: `El CTR del enlace de «${c.name}» bajó ${Math.round(-change * 100)} % (de ${pct(pd.linkCtr)} a ${pct(d.linkCtr)}).`,
          evidence: [
            `Impresiones: ${c.totals.impressions} vs ${c.prev.impressions}`,
            `Clics en el enlace: ${c.totals.link_clicks} vs ${c.prev.link_clicks}`,
            `Diferencia estadísticamente significativa (p = ${p.toFixed(3)})`,
            ...(c.frequency !== null ? [`Frecuencia: ${c.frequency.toFixed(2)}${c.prevFrequency !== null ? ` (antes ${c.prevFrequency.toFixed(2)})` : ""}`] : []),
          ],
          probableCause: freqUp ? "La misma audiencia ve los anuncios más veces y responde menos." : "Los anuncios perdieron atractivo o cambió la audiencia/ubicación donde se entregan.",
          cannotConfirm: freqUp ? ["Si también influyó la competencia en la subasta."] : ["Si la causa es la creatividad o un cambio en la entrega (ubicaciones, audiencia): revisa el desglose por ubicación."],
          recommendation: "Prueba 2 o 3 conceptos creativos nuevos (no variaciones mínimas) manteniendo la audiencia para aislar el efecto.",
          expected: "Recuperar el CTR del enlace a niveles del periodo anterior.", confidence: confidenceFromP(p, c.totals.link_clicks, 30), reviewInDays: 7, target: tgt,
          suggestedAction: "new_creative",
        });
      }
    }

    // CPM en alza con CTR estable → subasta/audiencia
    if (c.totals.impressions >= MIN_IMPRESSIONS && c.prev.impressions >= MIN_IMPRESSIONS && d.cpm !== null && pd.cpm !== null) {
      const cpmChange = pctChange(d.cpm, pd.cpm)!;
      const ctrChange = pctChange(d.linkCtr, pd.linkCtr);
      if (cpmChange >= 0.3 && (ctrChange === null || Math.abs(ctrChange) < 0.1)) {
        f.push({
          key: `cpm-${c.meta_id}`, area: "audiencia", severity: "baja", title: "El costo por mil impresiones subió",
          what: `El CPM de «${c.name}» subió ${Math.round(cpmChange * 100)} % (de ${money(pd.cpm, cur)} a ${money(d.cpm, cur)}) mientras el CTR se mantuvo.`,
          evidence: [`CPM actual: ${money(d.cpm, cur)}`, `CPM anterior: ${money(pd.cpm, cur)}`, `CTR del enlace: ${pct(d.linkCtr)} vs ${pct(pd.linkCtr)}`],
          probableCause: "Mayor competencia en la subasta o una audiencia más pequeña/saturada.",
          cannotConfirm: ["Si se debe a estacionalidad (fechas comerciales) o a cambios de segmentación: Meta no entrega datos de la competencia."],
          recommendation: "Si el costo por resultado sigue dentro de la meta, no actúes. Si no, prueba ampliar la audiencia (Advantage+) o ubicaciones.",
          expected: "CPM estable o costo por resultado dentro de la meta.", confidence: "baja", reviewInDays: 7, target: tgt,
          suggestedAction: "review_audience",
        });
      }
    }

    // Frecuencia alta (solo con ventana de 7 días)
    if (input.periodDays <= 7 && c.frequency !== null && c.frequency >= 4) {
      f.push({
        key: `frecuencia-${c.meta_id}`, area: "audiencia", severity: "media", title: "Frecuencia alta",
        what: `Las personas alcanzadas por «${c.name}» vieron sus anuncios ${c.frequency.toFixed(1)} veces en promedio en 7 días.`,
        evidence: [`Frecuencia 7 días: ${c.frequency.toFixed(2)}`, ...(c.prevFrequency !== null ? [`Semana anterior: ${c.prevFrequency.toFixed(2)}`] : [])],
        probableCause: "Audiencia pequeña para el presupuesto, o pocas creatividades rotando.",
        cannotConfirm: ["Si ya está afectando los resultados: compáralo con la evolución del costo por resultado."],
        recommendation: "Agrega creatividades nuevas o amplía la audiencia antes de subir presupuesto.",
        expected: "Frecuencia semanal bajo 3 sin perder resultados.", confidence: "media", reviewInDays: 7, target: tgt,
        suggestedAction: "new_creative",
      });
    }

    // Clics sin conversión (sitio u oferta) cuando la medición sí funciona
    if (conv.n > 0 && c.totals.link_clicks >= 150 && d.linkCtr !== null && d.linkCtr >= 0.008) {
      const cr = safeDiv(conv.n, c.totals.link_clicks)!;
      if (cr < 0.01 && (c.objective === "OUTCOME_LEADS" || c.objective === "OUTCOME_SALES")) {
        f.push({
          key: `sitio-${c.meta_id}`, area: "sitio", severity: "media", title: "Muchos clics, pocas conversiones",
          what: `En «${c.name}» solo ${pct(cr)} de los clics termina en ${conv.label}, aunque el anuncio genera interés (CTR ${pct(d.linkCtr)}).`,
          evidence: [`Clics en el enlace: ${c.totals.link_clicks}`, `${conv.label}: ${conv.n}`, `CTR del enlace: ${pct(d.linkCtr)}`],
          probableCause: "La página de destino o la oferta no cumplen lo que promete el anuncio (precio, velocidad, formulario largo).",
          cannotConfirm: ["Si el problema es la página o la oferta: revisa la velocidad móvil y la coherencia del mensaje antes de cambiar el anuncio."],
          recommendation: "Revisa la página en un celular: velocidad, que el precio/oferta coincida con el anuncio y un formulario corto.",
          expected: `Subir la tasa de conversión por clic sobre 1 %.`, confidence: c.totals.link_clicks >= 400 ? "media" : "baja", reviewInDays: 7, target: tgt,
          suggestedAction: "review_landing",
        });
      }
    }

    // Costo por resultado sobre la meta, con evidencia suficiente
    if (target && conv.n >= g.minConversions) {
      const cpa = c.totals.spend / conv.n;
      const expected = c.totals.spend / target;
      const p = poissonTailBelow(conv.n, expected);
      if (cpa > target * 1.3 && p < 0.05) {
        f.push({
          key: `costo-${c.meta_id}`, area: stageArea(d, pd), severity: "alta", title: "Costo por resultado sobre la meta",
          what: `«${c.name}» consigue ${conv.label} a ${money(cpa, cur)}, sobre la meta de ${money(target, cur)}.`,
          evidence: [`${conv.label}: ${conv.n}`, `Inversión: ${money(c.totals.spend, cur)}`, `Con la meta se esperarían ≈${expected.toFixed(1)} ${conv.label}`, ...stageEvidence(d, pd, cur)],
          probableCause: stageCause(d, pd),
          cannotConfirm: ["Si el problema es estructural o temporal: compara con al menos otro periodo antes de pausar."],
          recommendation: "Corrige primero la etapa del embudo indicada; si tras la revisión sigue sobre la meta, reduce el presupuesto o pausa.",
          expected: `Costo por resultado bajo ${money(target, cur)}.`, confidence: confidenceFromP(p, conv.n, g.minConversions), reviewInDays: 7, target: tgt,
        });
      } else if (cpa < target * 0.8 && poissonTailAbove(conv.n, expected) < 0.1) {
        f.push({
          key: `bueno-${c.meta_id}`, area: "presupuesto", severity: "positiva", title: "Rinde mejor que la meta",
          what: `«${c.name}» consigue ${conv.label} a ${money(cpa, cur)}, bajo la meta de ${money(target, cur)}.`,
          evidence: [`${conv.label}: ${conv.n}`, `Inversión: ${money(c.totals.spend, cur)}`],
          probableCause: "La combinación de oferta, creatividad y audiencia funciona en este periodo.",
          cannotConfirm: ["Si el rendimiento se mantiene al subir presupuesto: escalar de a poco y medir."],
          recommendation: `Considera subir el presupuesto como máximo ${g.maxBudgetChangePct} % y replicar el concepto en nuevas piezas.`,
          expected: "Más resultados manteniendo el costo bajo la meta.", confidence: "media", reviewInDays: 4, target: tgt,
          suggestedAction: "budget_change",
        });
      }
    }
  }

  // ── Distribución de presupuesto entre campañas comparables ────────────────
  const byObjective = new Map<string, PerfInput[]>();
  for (const c of active.filter(isActive)) {
    const k = c.objective ?? "?";
    byObjective.set(k, [...(byObjective.get(k) ?? []), c]);
  }
  for (const [, group] of byObjective) {
    const eligible = group.filter((c) => conversionsOf(c.objective, c.totals).n >= g.minConversions);
    if (eligible.length < 2) continue;
    const totalSpend = group.reduce((s, c) => s + c.totals.spend, 0);
    const withCpa = eligible.map((c) => ({ c, n: conversionsOf(c.objective, c.totals).n, cpa: c.totals.spend / conversionsOf(c.objective, c.totals).n }));
    withCpa.sort((a, b) => a.cpa - b.cpa);
    const best = withCpa[0];
    const worst = withCpa[withCpa.length - 1];
    const p = poissonRateP(best.n, best.c.totals.spend, worst.n, worst.c.totals.spend);
    if (worst.cpa >= best.cpa * 1.5 && worst.c.totals.spend / totalSpend >= 0.3 && p !== null && p < 0.05) {
      f.push({
        key: `presupuesto-${worst.c.meta_id}`, area: "presupuesto", severity: "media", title: "Presupuesto concentrado en la campaña menos eficiente",
        what: `«${worst.c.name}» usa ${Math.round((worst.c.totals.spend / totalSpend) * 100)} % de la inversión con un costo ${(worst.cpa / best.cpa).toFixed(1)} veces mayor que «${best.c.name}».`,
        evidence: [`${worst.c.name}: ${money(worst.cpa, cur)} por resultado (${worst.n})`, `${best.c.name}: ${money(best.cpa, cur)} por resultado (${best.n})`, `Diferencia significativa (p = ${p.toFixed(3)})`],
        probableCause: "El presupuesto no se ha redistribuido según los resultados recientes.",
        cannotConfirm: ["Si la campaña eficiente puede absorber más presupuesto sin encarecerse."],
        recommendation: `Mueve presupuesto gradualmente (máximo ${g.maxBudgetChangePct} % por cambio) hacia la campaña más eficiente y mide 4-7 días.`,
        expected: "Menor costo por resultado total de la cuenta.", confidence: confidenceFromP(p, best.n + worst.n, g.minConversions * 2), reviewInDays: 7,
        target: { level: worst.c.level, metaId: worst.c.meta_id, name: worst.c.name, adAccountId: worst.c.ad_account_id },
        suggestedAction: "budget_change",
      });
    }
  }

  // ── Anuncios: ganadores y deficientes ─────────────────────────────────────
  if (target) {
    for (const a of input.ads.filter((x) => x.totals.spend > 0)) {
      const conv = conversionsOf(a.objective, a.totals);
      const live = daysLive(a.created_time, input.now);
      const expected = a.totals.spend / target;
      if (live !== null && live < g.minDaysLive) continue;
      if (conv.n === 0 && a.totals.spend >= target * g.minSpendCpaMultiple) {
        const p = Math.exp(-expected);
        f.push({
          key: `anuncio-sin-resultados-${a.meta_id}`, area: "creatividad", severity: "media", title: "Anuncio sin resultados tras gasto suficiente",
          what: `«${a.name}» invirtió ${money(a.totals.spend, cur)} (${(a.totals.spend / target).toFixed(1)} veces la meta) sin ${conv.label}.`,
          evidence: [`Probabilidad de 0 resultados si cumpliera la meta: ${(p * 100).toFixed(1)} %`, `Clics en el enlace: ${a.totals.link_clicks}`],
          probableCause: "La pieza no logra la acción buscada para este público.",
          cannotConfirm: ["Si otros anuncios del mismo conjunto tienen el mismo problema, la causa puede ser la medición o la oferta."],
          recommendation: "Pausar este anuncio y mantener los que sí convierten.", expected: "Reasignar el gasto a anuncios con resultados.",
          confidence: p < 0.01 ? "alta" : p < 0.05 ? "media" : "baja", reviewInDays: 3,
          target: { level: "ad", metaId: a.meta_id, name: a.name, adAccountId: a.ad_account_id }, suggestedAction: "pause",
        });
      }
    }
  }

  return f;
}

/** P(X ≤ x) con X ~ Poisson(λ). */
export function poissonTailBelow(x: number, lambda: number): number {
  if (lambda <= 0) return 1;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let k = 1; k <= Math.floor(x); k++) {
    term *= lambda / k;
    sum += term;
    if (k > 10000) break;
  }
  return Math.min(1, sum);
}
/** P(X ≥ x) con X ~ Poisson(λ). */
export function poissonTailAbove(x: number, lambda: number): number {
  if (x <= 0) return 1;
  return Math.max(0, 1 - poissonTailBelow(x - 1, lambda));
}

function stageArea(d: ReturnType<typeof derive>, pd: ReturnType<typeof derive>): Area {
  const ctr = pctChange(d.linkCtr, pd.linkCtr);
  const cpm = pctChange(d.cpm, pd.cpm);
  if (ctr !== null && ctr <= -0.2) return "creatividad";
  if (cpm !== null && cpm >= 0.3) return "audiencia";
  if (d.convRate !== null && d.convRate < 0.01) return "sitio";
  return "oferta";
}
function stageCause(d: ReturnType<typeof derive>, pd: ReturnType<typeof derive>): string {
  switch (stageArea(d, pd)) {
    case "creatividad": return "El CTR cayó: el anuncio atrae menos clics que antes.";
    case "audiencia": return "El CPM subió: llegar a la audiencia está saliendo más caro.";
    case "sitio": return "Los clics no se convierten: posible problema en la página de destino.";
    default: return "Ni el CTR ni el CPM explican el aumento: revisar la oferta, el precio o el seguimiento comercial.";
  }
}
function stageEvidence(d: ReturnType<typeof derive>, pd: ReturnType<typeof derive>, cur: string): string[] {
  return [
    `CTR del enlace: ${pct(d.linkCtr)} (antes ${pct(pd.linkCtr)})`,
    `CPM: ${money(d.cpm, cur)} (antes ${money(pd.cpm, cur)})`,
    `Conversión por clic: ${pct(d.convRate)}`,
  ];
}
