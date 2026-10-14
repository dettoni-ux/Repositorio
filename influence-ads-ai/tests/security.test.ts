import { describe, it, expect } from "vitest";
import { encrypt, decrypt, hashPassword, verifyPassword, hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { redact, redactString } from "@/lib/redact";
import { checkRateLimit, resetRateLimits } from "@/lib/ratelimit";
import { can } from "@/lib/permissions";

describe("cifrado y contraseñas", () => {
  it("cifra y descifra; detecta manipulación", () => {
    const enc = encrypt("EAAtoken-secreto");
    expect(enc).not.toContain("EAAtoken");
    expect(decrypt(enc)).toBe("EAAtoken-secreto");
    const parts = enc.split(".");
    parts[3] = Buffer.from("otro").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("cada cifrado usa un IV distinto", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  it("contraseñas con scrypt", async () => {
    const h = await hashPassword("una clave larga 123");
    expect(await verifyPassword("una clave larga 123", h)).toBe(true);
    expect(await verifyPassword("otra", h)).toBe(false);
  });
  it("firma HMAC y comparación en tiempo constante", () => {
    const s = hmacSha256Hex("k", "cuerpo");
    expect(safeEqual(s, hmacSha256Hex("k", "cuerpo"))).toBe(true);
    expect(safeEqual(s, hmacSha256Hex("k", "cuerpo2"))).toBe(false);
  });
});

describe("secretos fuera de los registros", () => {
  it("oculta tokens en objetos y textos", () => {
    const r = redact({ access_token: "EAAabc", nested: { appSecret: "s", ok: "visible" }, list: [{ password: "p" }] });
    expect(JSON.stringify(r)).not.toMatch(/EAAabc|"s"|"p"/);
    expect(r.nested.ok).toBe("visible");
    expect(redactString("https://graph.facebook.com/me?access_token=EAAB123&x=1")).not.toContain("EAAB123");
    expect(redactString("token EAABwzLixnjYBO1234567890abcdefXYZ")).not.toContain("EAABwz");
  });
});

describe("límites de solicitudes", () => {
  it("bloquea tras superar el límite", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 1000, 0).ok).toBe(true);
    expect(checkRateLimit("k", 3, 1000, 10).ok).toBe(false);
    expect(checkRateLimit("k", 3, 1000, 2000).ok).toBe(true);
  });
});

describe("permisos por rol", () => {
  it("solo lectura no puede publicar ni aprobar", () => {
    expect(can("viewer", "campaign.publish")).toBe(false);
    expect(can("viewer", "actions.approve")).toBe(false);
    expect(can("analyst", "campaign.publish")).toBe(false);
    expect(can("media_buyer", "campaign.publish")).toBe(true);
    expect(can("media_buyer", "users.manage")).toBe(false);
    expect(can("admin", "users.manage")).toBe(true);
  });
});
