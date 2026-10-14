import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { detectFile } from "@/lib/filetype";
import { checkCreative, blockingIssues, contrastRatio, FORMATS } from "@/engine/creative-checks";

/** PNG mínimo válido de W×H (escala de grises). */
export function png(w: number, h: number): Buffer {
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("detección de archivos por contenido", () => {
  it("lee dimensiones de PNG", () => {
    expect(detectFile(png(1080, 1350))).toMatchObject({ mime: "image/png", width: 1080, height: 1350 });
  });
  it("rechaza contenido desconocido aunque tenga extensión de imagen", () => {
    expect(detectFile(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
  it("reconoce PDF y MP4", () => {
    expect(detectFile(Buffer.from("%PDF-1.7 xxxxxxxx"))?.kind).toBe("document");
    const mp4 = Buffer.alloc(16); mp4.write("ftypisom", 4); expect(detectFile(mp4)?.mime).toBe("video/mp4");
  });
});

describe("verificación técnica de creatividades", () => {
  const ok = { format: "feed_4x5" as const, width: 1080, height: 1350, mime: "image/png", sizeBytes: 500_000, withText: true, fileReadable: true,
    layers: [{ text: "Hazlo tú misma", fontPx: 80, box: { x: 100, y: 1000, w: 800, h: 100 }, contrast: 7 }] };
  it("pieza correcta sin bloqueos", () => {
    expect(blockingIssues(checkCreative(ok))).toHaveLength(0);
  });
  it("dimensiones incorrectas bloquean", () => {
    expect(blockingIssues(checkCreative({ ...ok, width: 1080, height: 1080 })).length).toBeGreaterThan(0);
  });
  it("archivo inexistente bloquea", () => {
    expect(blockingIssues(checkCreative({ ...ok, fileReadable: false })).some((c) => c.label.includes("existe"))).toBe(true);
  });
  it("texto fuera de la zona segura en Stories/Reels bloquea", () => {
    const f = FORMATS.vertical_9x16;
    const r = checkCreative({ ...ok, format: "vertical_9x16", width: f.width, height: f.height, layers: [{ text: "CTA", fontPx: 60, box: { x: 100, y: 1700, w: 400, h: 100 }, contrast: 7 }] });
    expect(blockingIssues(r).some((c) => c.label.includes("zona segura"))).toBe(true);
  });
  it("avisa contraste y tamaño insuficientes", () => {
    const r = checkCreative({ ...ok, layers: [{ text: "x", fontPx: 12, box: { x: 100, y: 1000, w: 100, h: 20 }, contrast: 1.5 }] });
    expect(r.filter((c) => !c.ok && c.level === "aviso").length).toBeGreaterThanOrEqual(2);
  });
  it("contraste WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
  });
});
