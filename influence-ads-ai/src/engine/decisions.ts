/**
 * Motor de decisiones (módulo puro).
 *
 * Niveles:
 *   observe (1): solo recomienda.
 *   approve (2): prepara acciones; cada una requiere aprobación humana.
 *   auto    (3): ejecuta SOLO las acciones de la lista autorizada del cliente,
 *                dentro de sus límites; el resto pasa a aprobación.
 *
 * Protecciones: botón de detención global y por cliente, enfriamiento entre
 * cambios al mismo objeto, límite de variación de presupuesto, tope diario y
 * mensual, datos frescos, volumen mínimo y tope de acciones automáticas por día.
 */
import { API_EXECUTABLE, type ActionType, type Guardrails } from "@/lib/schemas";
import type { Finding } from "./diagnosis";

export type AutomationLevel = "observe" | "approve" | "auto";

export type ProposedAction = {
  type: ActionType;
  targetLevel?: "campaign" | "adset" | "ad";
  targetMetaId?: string;
  targetName?: string;
  adAccountId?: string;
  params: { fromBudget?: number; toBudget?: number; status?: "PAUSED" | "ACTIVE" };
  title: string;
  rationale: string;
  evidence: string[];
  confidence: "baja" | "media" | "alta";
  expected: string;
  reviewInDays: number;
  dedupeKey: string;
};

export type GuardState = {
  level: AutomationLevel;
  orgKillSwitch: boolean;
  clientPaused: boolean;
  guardrails: Guardrails;
  /** Último cambio ejecutado sobre el mismo objetivo (ISO), si existe. */
  lastChangeAt: string | null;
  /** Horas desde la última sincronización exitosa de la cuenta. */
  dataAgeHours: number | null;
  /** Acciones automáticas ya ejecutadas hoy para este cliente. */
  autoActionsToday: number;
  /** Gasto del mes en curso y presupuesto diario comprometido del resto de campañas activas. */
  monthSpend: number;
  otherDailyBudgets: number;
  daysLeftInMonth: number;
  now?: Date;
};

export type Verdict = { decision: "execute" | "needs_approval" | "blocked" | "task"; reasons: string[] };

export const MAX_AUTO_ACTIONS_PER_DAY = 5;
export const MAX_DATA_AGE_HOURS_AUTO = 12;

export function evaluateAction(a: ProposedAction, s: GuardState, mode: "auto" | "manual"): Verdict {
  const reasons: string[] = [];
  const g = s.guardrails;

  if (!API_EXECUTABLE.includes(a.type)) {
    return { decision: "task", reasons: ["Esta recomendación requiere una revisión humana; no se ejecuta por API."] };
  }
  if (!a.targetMetaId || !a.adAccountId) return { decision: "blocked", reasons: ["La acción no tiene un objetivo válido."] };

  if (mode === "auto") {
    if (s.orgKillSwitch) return { decision: "blocked", reasons: ["La automatización de la agencia está detenida (botón de detención activo)."] };
    if (s.clientPaused) return { decision: "blocked", reasons: ["La automatización de este cliente está en pausa."] };
  }
  if (s.level === "observe") {
    return { decision: "blocked", reasons: ["El cliente está en nivel 1 (solo observar). Cambia al nivel 2 para aprobar y ejecutar acciones desde aquí."] };
  }

  // Enfriamiento: evita decisiones repetitivas sobre el mismo objeto.
  if (s.lastChangeAt) {
    const hours = ((s.now ?? new Date()).getTime() - Date.parse(s.lastChangeAt)) / 3600000;
    if (hours < g.cooldownHours) {
      reasons.push(`Hubo un cambio sobre este objeto hace ${Math.floor(hours)} h; el mínimo entre cambios es ${g.cooldownHours} h.`);
      if (mode === "auto") return { decision: "blocked", reasons };
    }
  }

  if (a.type === "budget_change") {
    const from = a.params.fromBudget;
    const to = a.params.toBudget;
    if (from === undefined || to === undefined || !(from > 0) || !(to > 0)) {
      return { decision: "blocked", reasons: ["Falta el presupuesto actual o el nuevo presupuesto."] };
    }
    const change = Math.abs(to - from) / from;
    if (change > g.maxBudgetChangePct / 100 + 1e-9) {
      return { decision: "blocked", reasons: [`El cambio (${Math.round(change * 100)} %) supera la variación máxima permitida de ${g.maxBudgetChangePct} %.`] };
    }
    if (g.maxDailyBudget !== undefined && to > g.maxDailyBudget) {
      return { decision: "blocked", reasons: [`El nuevo presupuesto diario supera el máximo del cliente (${g.maxDailyBudget}).`] };
    }
    if (g.maxDailyBudget !== undefined && to + s.otherDailyBudgets > g.maxDailyBudget && to > from) {
      return { decision: "blocked", reasons: ["La suma de presupuestos diarios activos superaría el máximo diario del cliente."] };
    }
    if (g.maxMonthlyBudget !== undefined && to > from) {
      const projected = s.monthSpend + (to + s.otherDailyBudgets) * s.daysLeftInMonth;
      if (projected > g.maxMonthlyBudget) {
        return { decision: "blocked", reasons: [`La proyección del mes (${Math.round(projected)}) superaría el presupuesto mensual máximo (${g.maxMonthlyBudget}).`] };
      }
    }
    if (to > from && !g.scaleEnabled) return { decision: "blocked", reasons: ["El escalado de presupuesto está desactivado para este cliente."] };
  }
  if (a.type === "pause" && !g.pauseEnabled && mode === "auto") {
    return { decision: "blocked", reasons: ["Las pausas automáticas están desactivadas para este cliente."] };
  }

  if (mode === "manual") return { decision: "execute", reasons };

  // Automático: solo nivel 3, acciones autorizadas, datos frescos, tope diario.
  if (s.level !== "auto") return { decision: "needs_approval", reasons: ["El cliente está en nivel 2: cada acción requiere aprobación."] };
  if (!g.autoActions.includes(a.type)) return { decision: "needs_approval", reasons: ["Este tipo de acción no está en la lista de acciones automáticas autorizadas."] };
  if (s.dataAgeHours === null || s.dataAgeHours > MAX_DATA_AGE_HOURS_AUTO) {
    return { decision: "needs_approval", reasons: ["Los datos no están actualizados (más de 12 h); se requiere aprobación."] };
  }
  if (s.autoActionsToday >= MAX_AUTO_ACTIONS_PER_DAY) {
    return { decision: "needs_approval", reasons: [`Se alcanzó el máximo de ${MAX_AUTO_ACTIONS_PER_DAY} acciones automáticas por día.`] };
  }
  if (a.confidence === "baja") return { decision: "needs_approval", reasons: ["La confianza es baja: se requiere aprobación."] };
  return { decision: "execute", reasons };
}

/** Convierte hallazgos del diagnóstico en acciones propuestas concretas. */
export function proposalsFromFindings(findings: Finding[], ctx: { clientId: string; guardrails: Guardrails; budgets: Map<string, number | null>; periodKey: string }): ProposedAction[] {
  const out: ProposedAction[] = [];
  const g = ctx.guardrails;
  for (const f of findings) {
    if (!f.suggestedAction) continue;
    const t = f.target;
    const base = {
      title: f.title,
      rationale: `${f.what} ${f.probableCause}`,
      evidence: f.evidence,
      confidence: f.confidence,
      expected: f.expected,
      reviewInDays: f.reviewInDays,
      targetLevel: t?.level,
      targetMetaId: t?.metaId,
      targetName: t?.name,
      adAccountId: t?.adAccountId,
    };
    if (f.suggestedAction === "budget_change") {
      if (!t) continue;
      const current = ctx.budgets.get(t.metaId) ?? null;
      if (current === null || !(current > 0)) {
        out.push({ ...base, type: "review_offer", params: {}, title: `${f.title}: revisar presupuesto`, rationale: `${base.rationale} El presupuesto está definido en otro nivel (campaña o conjunto), ajústalo allí.`, dedupeKey: `${ctx.clientId}:review_budget:${t.metaId}:${ctx.periodKey}` });
        continue;
      }
      const up = f.severity === "positiva";
      const factor = up ? 1 + g.maxBudgetChangePct / 100 : 1 - g.maxBudgetChangePct / 100;
      let to = roundBudget(current * factor);
      if (up && g.maxDailyBudget !== undefined) to = Math.min(to, g.maxDailyBudget);
      if (to === current) continue;
      out.push({
        ...base, type: "budget_change",
        params: { fromBudget: current, toBudget: to },
        title: `${up ? "Subir" : "Bajar"} presupuesto de «${t.name}» de ${current} a ${to}`,
        dedupeKey: `${ctx.clientId}:budget:${t.metaId}`,
      });
    } else if (f.suggestedAction === "pause") {
      if (!t) continue;
      out.push({ ...base, type: "pause", params: { status: "PAUSED" }, title: `Pausar «${t.name}»`, dedupeKey: `${ctx.clientId}:pause:${t.metaId}` });
    } else {
      out.push({ ...base, type: f.suggestedAction, params: {}, dedupeKey: `${ctx.clientId}:${f.suggestedAction}:${t?.metaId ?? "cuenta"}:${ctx.periodKey}` });
    }
  }
  return out;
}

export function roundBudget(v: number): number {
  if (v >= 10000) return Math.round(v / 100) * 100;
  if (v >= 100) return Math.round(v);
  return Math.round(v * 100) / 100;
}
