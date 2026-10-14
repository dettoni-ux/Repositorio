import { describe, it, expect } from "vitest";
import { diagnose, poissonTailBelow, type PerfInput, type DiagnosisInput } from "@/engine/diagnosis";
import { emptyTotals, type Totals } from "@/lib/metrics";
import { parseGuardrails } from "@/lib/schemas";

const T = (x: Partial<Totals>): Totals => ({ ...emptyTotals(), ...x });
const camp = (x: Partial<PerfInput> & { totals: Totals; prev?: Totals }): PerfInput => ({
  level: "campaign", ad_account_id: "acc", meta_id: x.meta_id ?? "c1", name: x.name ?? "Campaña", objective: x.objective ?? "OUTCOME_LEADS",
  effective_status: "ACTIVE", daily_budget: x.daily_budget ?? 10000, campaign_meta_id: x.meta_id ?? "c1", created_time: "2026-01-01T00:00:00Z",
  frequency: x.frequency ?? null, prevFrequency: x.prevFrequency ?? null, totals: x.totals, prev: x.prev ?? emptyTotals(),
});
const base = (over: Partial<DiagnosisInput>): DiagnosisInput => ({
  currency: "CLP", periodDays: 7, account: { totals: T({ spend: 100000, impressions: 50000 }), prev: emptyTotals() },
  campaigns: [], ads: [], real: null, guardrails: parseGuardrails({ targetCpa: 5000 }), now: new Date("2026-10-10"), ...over,
});

describe("diagnóstico", () => {
  it("sin inversión → Sin datos suficientes, sin inventar problemas", () => {
    const f = diagnose(base({ account: { totals: emptyTotals(), prev: emptyTotals() } }));
    expect(f).toHaveLength(1);
    expect(f[0].title).toBe("Sin datos suficientes");
  });

  it("clics sin conversiones se diagnostica como MEDICIÓN, no como anuncio", () => {
    const c = camp({ totals: T({ spend: 60000, impressions: 30000, link_clicks: 400, clicks: 500 }) });
    const f = diagnose(base({ campaigns: [c] }));
    const m = f.find((x) => x.key.startsWith("medicion-"))!;
    expect(m.area).toBe("medicion");
    expect(m.suggestedAction).toBe("review_tracking");
    expect(f.some((x) => x.area === "creatividad")).toBe(false);
  });

  it("caída de CTR significativa con frecuencia en alza → fatiga creativa", () => {
    const c = camp({
      totals: T({ spend: 50000, impressions: 40000, link_clicks: 200, clicks: 300, leads: 20 }),
      prev: T({ spend: 50000, impressions: 40000, link_clicks: 480, clicks: 600, leads: 22 }),
      frequency: 3.4, prevFrequency: 2.1,
    });
    const f = diagnose(base({ campaigns: [c] }));
    const x = f.find((y) => y.key === "ctr-c1")!;
    expect(x.title).toBe("Probable fatiga creativa");
    expect(x.confidence).not.toBe("baja");
    expect(x.cannotConfirm.length).toBeGreaterThan(0);
  });

  it("no concluye con muestras pequeñas", () => {
    const c = camp({ totals: T({ spend: 3000, impressions: 900, link_clicks: 3, leads: 0 }), prev: T({ spend: 3000, impressions: 900, link_clicks: 9 }) });
    const f = diagnose(base({ campaigns: [c] }));
    expect(f.filter((x) => x.target?.metaId === "c1")).toHaveLength(0);
  });

  it("costo sobre la meta solo con volumen y evidencia", () => {
    const c = camp({ totals: T({ spend: 150000, impressions: 60000, link_clicks: 900, leads: 12 }), prev: T({ spend: 150000, impressions: 60000, link_clicks: 950, leads: 25 }) });
    const f = diagnose(base({ campaigns: [c] }));
    const x = f.find((y) => y.key === "costo-c1")!;
    expect(x).toBeTruthy();
    expect(x.severity).toBe("alta");
    expect(x.evidence.join(" ")).toContain("CTR");
  });

  it("detecta campañas que rinden mejor que la meta", () => {
    const c = camp({ totals: T({ spend: 100000, impressions: 60000, link_clicks: 900, leads: 40 }) });
    const f = diagnose(base({ campaigns: [c] }));
    expect(f.find((y) => y.key === "bueno-c1")?.suggestedAction).toBe("budget_change");
  });

  it("presupuesto concentrado en la campaña menos eficiente", () => {
    const good = camp({ meta_id: "a", name: "A", totals: T({ spend: 50000, impressions: 30000, link_clicks: 500, leads: 25 }) });
    const bad = camp({ meta_id: "b", name: "B", totals: T({ spend: 150000, impressions: 80000, link_clicks: 900, leads: 15 }) });
    const f = diagnose(base({ campaigns: [good, bad], guardrails: parseGuardrails({}) }));
    expect(f.find((y) => y.key === "presupuesto-b")).toBeTruthy();
  });

  it("muchos leads baratos pero poco calificados → proceso comercial", () => {
    const f = diagnose(base({ real: { lead: 45, qualified_lead: 5, sale: 0, revenue: 0, byCampaign: [] } }));
    expect(f.find((y) => y.key === "calidad-leads")?.area).toBe("comercial");
  });

  it("ventas reales sin compras en Meta → medición", () => {
    const f = diagnose(base({ real: { lead: 0, qualified_lead: 0, sale: 8, revenue: 400000, byCampaign: [] } }));
    expect(f.find((y) => y.key === "medicion-sin-compras-meta")?.severity).toBe("alta");
  });

  it("Poisson acumulada", () => {
    expect(poissonTailBelow(0, 3)).toBeCloseTo(Math.exp(-3));
    expect(poissonTailBelow(100, 3)).toBeCloseTo(1);
  });
});
