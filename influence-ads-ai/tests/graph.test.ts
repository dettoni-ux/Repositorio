import { describe, it, expect } from "vitest";
import { graph, graphAll, classifyMetaError, MetaApiError, throttleFromHeaders, appSecretProof, currencyOffset, fromMinorUnits, toMinorUnits } from "@/meta/graph";
import { buildAuthUrl, META_SCOPES, missingScopes } from "@/meta/oauth";
import { metaMock } from "./helpers";

describe("cliente de la Graph API", () => {
  it("agrega appsecret_proof y usa la versión configurada", async () => {
    const m = metaMock([{ match: /^me$/, reply: () => ({ id: "1", name: "Ana" }) }]);
    await graph("me", { token: "TOK", fetchImpl: m.impl, params: { fields: "id,name" } });
    const u = m.calls[0].url;
    expect(u.pathname).toBe("/v26.0/me");
    expect(u.searchParams.get("appsecret_proof")).toBe(appSecretProof("TOK", "secreto-de-prueba"));
  });
  it("traduce token vencido a un mensaje comprensible sin filtrar el token", async () => {
    const m = metaMock([{ match: /^me$/, status: 400, reply: () => ({ error: { code: 190, message: "Error validating access token: EAABsecret123456789012345678901234" } }) }]);
    const e = await graph("me", { token: "EAABsecret", fetchImpl: m.impl }).catch((x) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect(e.kind).toBe("token");
    expect(e.userMessage).toContain("Vuelve a conectar");
    expect(e.userMessage).not.toContain("EAABsecret123");
  });
  it("clasifica errores de Meta", () => {
    expect(classifyMetaError({ code: 17 })).toBe("rate_limit");
    expect(classifyMetaError({ code: 80004 })).toBe("rate_limit");
    expect(classifyMetaError({ code: 200 })).toBe("permission");
    expect(classifyMetaError({ code: 100 })).toBe("invalid");
    expect(classifyMetaError({ code: 368 })).toBe("policy");
  });
  it("recorre la paginación", async () => {
    const m = metaMock([
      { match: /^act_1\/campaigns$/, reply: (u) => u.searchParams.get("after") ? { data: [{ id: "3" }] } : { data: [{ id: "1" }, { id: "2" }], paging: { next: "https://graph.facebook.com/v26.0/act_1/campaigns?after=xyz&access_token=T" } } },
    ]);
    const all = await graphAll<{ id: string }>("act_1/campaigns", { token: "T", fetchImpl: m.impl });
    expect(all.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
  it("lee encabezados de uso", () => {
    const h = new Headers({ "x-business-use-case-usage": JSON.stringify({ "123": [{ type: "ads_management", call_count: 95, total_cputime: 10, total_time: 20, estimated_time_to_regain_access: 2 }] }) });
    expect(throttleFromHeaders(h)).toEqual({ pct: 95, waitMs: 120000 });
  });
  it("monedas sin decimales (CLP) usan factor 1", () => {
    expect(currencyOffset("CLP")).toBe(1);
    expect(currencyOffset("USD")).toBe(100);
    expect(fromMinorUnits("500000", "CLP")).toBe(500000);
    expect(fromMinorUnits("1050", "USD")).toBe(10.5);
    expect(toMinorUnits(10.5, "USD")).toBe(1050);
  });
});

describe("OAuth", () => {
  it("URL oficial con state y permisos, sin pedir contraseñas", () => {
    const u = new URL(buildAuthUrl("estado123"));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.searchParams.get("state")).toBe("estado123");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/meta/oauth/callback");
    expect(u.searchParams.get("scope")?.split(",")).toEqual(META_SCOPES);
  });
  it("detecta permisos faltantes", () => {
    expect(missingScopes(["ads_read"])).toContain("ads_management");
  });
});
