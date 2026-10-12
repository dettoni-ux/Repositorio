import { describe, it, expect } from "vitest";
import { validateDraft, canPublish, draftStructureSchema, optimizationFor, type ValidationContext } from "@/engine/drafts";

const ctx = (x: Partial<ValidationContext> = {}): ValidationContext => ({
  objective: "sales", clientId: "c1",
  account: { id: "a", client_id: "c1", managed: true, account_status: 1, currency: "CLP", name: "Cuenta" },
  connection: { status: "active", scopes: ["ads_management", "ads_read"], expiresAt: null },
  page: { page_id: "p", client_id: "c1", name: "Página" },
  guardrails: { maxDailyBudget: 50000 },
  creatives: new Map([["cr1", { status: "approved", blocking: 0, format: "4:5", exists: true }]]),
  prohibited: ["gratis"], pendingVerification: [], landingPages: ["https://tienda.cl"], ...x,
});
const draft = (x: object = {}) => draftStructureSchema.parse({
  adAccountId: "3f1c2a9e-1b2c-4d3e-8f40-123456789abc", pageId: "p", destination: "website", url: "https://tienda.cl/kit", pixelId: "999", dailyBudget: 20000,
  ads: [{ name: "A", feedCreativeId: "7a1c2a9e-1b2c-4d3e-8f40-123456789abc", primaryText: "Texto", headline: "Titular", cta: "SHOP_NOW" }], ...x,
});

describe("validación previa a publicar", () => {
  it("borrador completo se puede publicar", () => {
    const d = draft();
    d.ads[0].feedCreativeId = "cr1";
    expect(canPublish(validateDraft(d, ctx()))).toBe(true);
  });
  it("bloquea cuenta de otro cliente, presupuesto excedido y permisos faltantes", () => {
    const d = draft(); d.ads[0].feedCreativeId = "cr1";
    expect(canPublish(validateDraft(d, ctx({ account: { id: "a", client_id: "otro", managed: true, account_status: 1, currency: "CLP", name: "X" } })))).toBe(false);
    expect(canPublish(validateDraft({ ...d, dailyBudget: 90000 }, ctx()))).toBe(false);
    expect(canPublish(validateDraft(d, ctx({ connection: { status: "active", scopes: ["ads_read"], expiresAt: null } })))).toBe(false);
    expect(canPublish(validateDraft(d, ctx({ connection: { status: "expired", scopes: ["ads_management"], expiresAt: null } })))).toBe(false);
  });
  it("bloquea creatividades no aprobadas, inexistentes o con errores", () => {
    const d = draft(); d.ads[0].feedCreativeId = "cr1";
    expect(canPublish(validateDraft(d, ctx({ creatives: new Map([["cr1", { status: "draft", blocking: 0, format: "", exists: true }]]) })))).toBe(false);
    expect(canPublish(validateDraft(d, ctx({ creatives: new Map([["cr1", { status: "approved", blocking: 0, format: "", exists: false }]]) })))).toBe(false);
    expect(canPublish(validateDraft(d, ctx({ creatives: new Map([["cr1", { status: "approved", blocking: 2, format: "", exists: true }]]) })))).toBe(false);
  });
  it("bloquea mensajes prohibidos y afirmaciones sin confirmar; ventas en sitio requieren píxel", () => {
    const d = draft(); d.ads[0].feedCreativeId = "cr1"; d.ads[0].primaryText = "Envío GRATIS hoy";
    expect(canPublish(validateDraft(d, ctx()))).toBe(false);
    const d2 = draft(); d2.ads[0].feedCreativeId = "cr1";
    expect(canPublish(validateDraft(d2, ctx({ pendingVerification: ["Más de 500 clientas"] })))).toBe(false);
    expect(canPublish(validateDraft({ ...d2, claimsConfirmed: true }, ctx({ pendingVerification: ["Más de 500 clientas"] })))).toBe(true);
    expect(canPublish(validateDraft({ ...d2, pixelId: undefined }, ctx()))).toBe(false);
  });
  it("optimización según objetivo y destino", () => {
    expect(optimizationFor("leads", draft({ destination: "instant_form", leadFormId: "f" })).optimization_goal).toBe("LEAD_GENERATION");
    expect(optimizationFor("messages", draft({ destination: "whatsapp" })).destination_type).toBe("WHATSAPP");
    expect(optimizationFor("sales", draft()).promoted_object).toEqual({ pixel_id: "999", custom_event_type: "PURCHASE" });
  });
});
