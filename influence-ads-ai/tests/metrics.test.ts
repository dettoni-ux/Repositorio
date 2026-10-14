import { describe, it, expect } from "vitest";
import { derive, safeDiv, sumRows, pickAction, primaryResult, pctChange, ACTION_PRIORITY, emptyTotals } from "@/lib/metrics";
import { wilson, twoProportionP, poissonRateP, normCdf } from "@/lib/stats";
import { parseLocaleNumber, parseGuardrails } from "@/lib/schemas";

describe("métricas derivadas", () => {
  it("no divide por cero ni por denominadores insuficientes", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(10, 5, 10)).toBeNull();
    expect(safeDiv(10, 20, 10)).toBe(0.5);
  });

  it("calcula ratios desde sumas, no promediando ratios", () => {
    const t = sumRows([
      { spend: 100, impressions: 1000, link_clicks: 10, clicks: 20, leads: 1 },
      { spend: 300, impressions: 9000, link_clicks: 90, clicks: 100, leads: 3 },
    ]);
    const d = derive(t);
    expect(d.linkCtr).toBeCloseTo(100 / 10000);
    expect(d.cpm).toBeCloseTo((400 / 10000) * 1000);
    expect(d.cpl).toBe(100);
    expect(d.cpc).toBe(4);
  });

  it("devuelve null (Sin datos suficientes) con poco volumen", () => {
    const d = derive({ ...emptyTotals(), spend: 50, impressions: 100, link_clicks: 2 });
    expect(d.ctr).toBeNull();
    expect(d.cpm).toBeNull();
    expect(d.cpc).toBeNull();
    expect(d.cpl).toBeNull();
    expect(d.roas).toBeNull();
  });

  it("ROAS solo con valor de compras medido", () => {
    expect(derive({ ...emptyTotals(), spend: 100, purchases: 2, purchase_value: 0 }).roas).toBeNull();
    expect(derive({ ...emptyTotals(), spend: 100, purchases: 2, purchase_value: 350 }).roas).toBe(3.5);
  });

  it("toma un solo tipo de acción por prioridad (sin duplicar conversiones)", () => {
    const actions = [
      { action_type: "offsite_conversion.fb_pixel_lead", value: "4" },
      { action_type: "lead", value: "5" },
      { action_type: "onsite_conversion.lead_grouped", value: "1" },
    ];
    expect(pickAction(actions, ACTION_PRIORITY.leads)).toBe(5);
    expect(pickAction([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }], ACTION_PRIORITY.purchases)).toBe(2);
    expect(pickAction(undefined, ACTION_PRIORITY.leads)).toBe(0);
  });

  it("resultado principal según objetivo", () => {
    const t = { ...emptyTotals(), spend: 1000, leads: 4, purchases: 1, link_clicks: 50, messaging_conversations: 10 };
    expect(primaryResult("OUTCOME_LEADS", t)).toMatchObject({ label: "Leads", value: 4, cost: 250 });
    expect(primaryResult("OUTCOME_SALES", t)).toMatchObject({ value: 1, cost: 1000 });
    expect(primaryResult("OUTCOME_ENGAGEMENT", t).value).toBe(10);
  });

  it("variación entre periodos", () => {
    expect(pctChange(120, 100)).toBeCloseTo(0.2);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(null, 1)).toBeNull();
  });
});

describe("estadística", () => {
  it("normal estándar", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 5);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("Wilson acota la proporción", () => {
    const w = wilson(5, 100)!;
    expect(w.low).toBeLessThan(0.05);
    expect(w.high).toBeGreaterThan(0.05);
    expect(wilson(0, 0)).toBeNull();
  });
  it("dos proporciones: diferencia grande es significativa; pocas muestras no", () => {
    expect(twoProportionP(200, 10000, 100, 10000)!).toBeLessThan(0.001);
    expect(twoProportionP(3, 100, 1, 100)!).toBeGreaterThan(0.05);
  });
  it("tasas de Poisson por gasto", () => {
    expect(poissonRateP(50, 1000, 20, 1000)!).toBeLessThan(0.01);
    expect(poissonRateP(3, 1000, 2, 1000)!).toBeGreaterThan(0.3);
  });
});

describe("entradas", () => {
  it("números en formato chileno e internacional", () => {
    expect(parseLocaleNumber("1.500.000")).toBe(1500000);
    expect(parseLocaleNumber("12,5")).toBe(12.5);
    expect(parseLocaleNumber("12.5")).toBe(12.5);
    expect(parseLocaleNumber("$ 8.000")).toBe(8000);
    expect(parseLocaleNumber("")).toBeUndefined();
  });
  it("límites por defecto conservadores (automático desactivado)", () => {
    const g = parseGuardrails({});
    expect(g.autoActions).toEqual([]);
    expect(g.maxBudgetChangePct).toBe(20);
    expect(g.cooldownHours).toBeGreaterThanOrEqual(12);
  });
});
