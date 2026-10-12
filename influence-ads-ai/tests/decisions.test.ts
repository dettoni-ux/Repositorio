import { describe, it, expect } from "vitest";
import { evaluateAction, proposalsFromFindings, roundBudget, MAX_AUTO_ACTIONS_PER_DAY, type GuardState, type ProposedAction } from "@/engine/decisions";
import { parseGuardrails } from "@/lib/schemas";
import type { Finding } from "@/engine/diagnosis";

const action = (x: Partial<ProposedAction> = {}): ProposedAction => ({
  type: "budget_change", targetLevel: "campaign", targetMetaId: "123", targetName: "C", adAccountId: "acc",
  params: { fromBudget: 10000, toBudget: 12000 }, title: "t", rationale: "r", evidence: [], confidence: "media", expected: "", reviewInDays: 7, dedupeKey: "k", ...x,
});
const state = (x: Partial<GuardState> = {}): GuardState => ({
  level: "auto", orgKillSwitch: false, clientPaused: false,
  guardrails: parseGuardrails({ maxDailyBudget: 50000, maxMonthlyBudget: 2000000, autoActions: ["budget_change", "pause"] }),
  lastChangeAt: null, dataAgeHours: 2, autoActionsToday: 0, monthSpend: 100000, otherDailyBudgets: 0, daysLeftInMonth: 20, now: new Date("2026-10-12T12:00:00Z"), ...x,
});

describe("motor de decisiones y límites", () => {
  it("ejecuta en nivel 3 solo si todo está en regla", () => {
    expect(evaluateAction(action(), state(), "auto").decision).toBe("execute");
  });
  it("el botón de detención bloquea la automatización", () => {
    expect(evaluateAction(action(), state({ orgKillSwitch: true }), "auto").decision).toBe("blocked");
    expect(evaluateAction(action(), state({ clientPaused: true }), "auto").decision).toBe("blocked");
  });
  it("nivel 1 nunca ejecuta", () => {
    expect(evaluateAction(action(), state({ level: "observe" }), "auto").decision).toBe("blocked");
    expect(evaluateAction(action(), state({ level: "observe" }), "manual").decision).toBe("blocked");
  });
  it("nivel 2 requiere aprobación; aprobado manualmente se ejecuta", () => {
    expect(evaluateAction(action(), state({ level: "approve" }), "auto").decision).toBe("needs_approval");
    expect(evaluateAction(action(), state({ level: "approve" }), "manual").decision).toBe("execute");
  });
  it("bloquea cambios bruscos de presupuesto", () => {
    const v = evaluateAction(action({ params: { fromBudget: 10000, toBudget: 15000 } }), state(), "manual");
    expect(v.decision).toBe("blocked");
    expect(v.reasons[0]).toContain("variación máxima");
  });
  it("respeta presupuesto diario y mensual máximos", () => {
    expect(evaluateAction(action({ params: { fromBudget: 45000, toBudget: 54000 } }), state(), "manual").decision).toBe("blocked");
    expect(evaluateAction(action(), state({ otherDailyBudgets: 45000 }), "manual").decision).toBe("blocked");
    expect(evaluateAction(action(), state({ monthSpend: 1800000 }), "manual").decision).toBe("blocked");
  });
  it("enfriamiento evita decisiones repetitivas", () => {
    expect(evaluateAction(action(), state({ lastChangeAt: "2026-10-12T00:00:00Z" }), "auto").decision).toBe("blocked");
  });
  it("solo acciones autorizadas, datos frescos, confianza suficiente y tope diario", () => {
    expect(evaluateAction(action({ type: "resume", params: {} }), state(), "auto").decision).toBe("needs_approval");
    expect(evaluateAction(action(), state({ dataAgeHours: 30 }), "auto").decision).toBe("needs_approval");
    expect(evaluateAction(action(), state({ dataAgeHours: null }), "auto").decision).toBe("needs_approval");
    expect(evaluateAction(action({ confidence: "baja" }), state(), "auto").decision).toBe("needs_approval");
    expect(evaluateAction(action(), state({ autoActionsToday: MAX_AUTO_ACTIONS_PER_DAY }), "auto").decision).toBe("needs_approval");
  });
  it("las tareas humanas nunca se ejecutan por API", () => {
    expect(evaluateAction(action({ type: "review_landing" }), state(), "auto").decision).toBe("task");
  });
  it("escalado desactivado bloquea subidas", () => {
    const g = parseGuardrails({ maxDailyBudget: 50000, scaleEnabled: false, autoActions: ["budget_change"] });
    expect(evaluateAction(action(), state({ guardrails: g }), "manual").decision).toBe("blocked");
  });

  it("convierte hallazgos en acciones concretas dentro del límite de variación", () => {
    const f: Finding = { key: "bueno-1", area: "presupuesto", severity: "positiva", title: "Rinde mejor", what: "", evidence: [], probableCause: "", cannotConfirm: [], recommendation: "", expected: "", confidence: "media", reviewInDays: 4, target: { level: "campaign", metaId: "1", name: "C", adAccountId: "acc" }, suggestedAction: "budget_change" };
    const [p] = proposalsFromFindings([f], { clientId: "cl", guardrails: parseGuardrails({ maxBudgetChangePct: 20 }), budgets: new Map([["1", 10000]]), periodKey: "x" });
    expect(p.params).toEqual({ fromBudget: 10000, toBudget: 12000 });
    const [q] = proposalsFromFindings([f], { clientId: "cl", guardrails: parseGuardrails({}), budgets: new Map([["1", null]]), periodKey: "x" });
    expect(q.type).not.toBe("budget_change");
  });
  it("redondeo de presupuestos", () => {
    expect(roundBudget(12345)).toBe(12300);
    expect(roundBudget(12.345)).toBe(12.35);
  });
});
