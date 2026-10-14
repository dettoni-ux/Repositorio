/**
 * Verificación técnica de creatividades (módulo puro).
 * Formatos de referencia para Meta: feed vertical 4:5 (1080×1350), cuadrado
 * 1:1 (1080×1080), horizontal 4:3 (1080×810) y Stories/Reels 9:16 (1080×1920).
 */
export const FORMATS = {
  feed_4x5: { label: "Feed vertical 4:5", width: 1080, height: 1350, aspect: "4:5" as const, placements: "Feed de Facebook e Instagram" },
  feed_1x1: { label: "Feed cuadrado 1:1", width: 1080, height: 1080, aspect: "1:1" as const, placements: "Feed, columna derecha, Marketplace" },
  feed_4x3: { label: "Feed horizontal 4:3", width: 1080, height: 810, aspect: "4:3" as const, placements: "Feed (cuando la ubicación lo admite)" },
  vertical_9x16: { label: "Stories y Reels 9:16", width: 1080, height: 1920, aspect: "9:16" as const, placements: "Stories y Reels de Facebook e Instagram" },
};
export type FormatKey = keyof typeof FORMATS;

/** Zonas seguras (fracción del alto/ancho a mantener libre de texto y logos). */
export const SAFE_ZONES: Record<FormatKey, { top: number; bottom: number; side: number }> = {
  feed_4x5: { top: 0.04, bottom: 0.04, side: 0.05 },
  feed_1x1: { top: 0.04, bottom: 0.04, side: 0.05 },
  feed_4x3: { top: 0.05, bottom: 0.05, side: 0.05 },
  // Stories/Reels: la interfaz cubre la parte superior (~14 %) y la inferior (hasta ~35 % en Reels).
  vertical_9x16: { top: 0.14, bottom: 0.35, side: 0.06 },
};

export type TextLayer = { text: string; fontPx: number; box: { x: number; y: number; w: number; h: number }; contrast: number | null };

export type CheckInput = {
  format: FormatKey;
  width: number | null;
  height: number | null;
  mime: string;
  sizeBytes: number;
  withText: boolean;
  layers: TextLayer[];
  fileReadable: boolean;
};

export type Check = { ok: boolean; level: "error" | "aviso"; label: string; detail: string };

export function checkCreative(c: CheckInput): Check[] {
  const f = FORMATS[c.format];
  const out: Check[] = [];
  out.push({ ok: c.fileReadable, level: "error", label: "El archivo existe y se puede abrir", detail: c.fileReadable ? "Verificado en el almacenamiento." : "No se encontró o está dañado." });
  out.push({ ok: ["image/jpeg", "image/png"].includes(c.mime), level: "error", label: "Formato de imagen admitido por Meta", detail: `Tipo: ${c.mime}` });
  out.push({ ok: c.sizeBytes > 0 && c.sizeBytes <= 30 * 1024 * 1024, level: "error", label: "Peso del archivo (máx. 30 MB)", detail: `${(c.sizeBytes / 1024 / 1024).toFixed(2)} MB` });
  const dimsOk = c.width === f.width && c.height === f.height;
  out.push({ ok: dimsOk, level: "error", label: `Dimensiones ${f.width}×${f.height}`, detail: c.width && c.height ? `Archivo: ${c.width}×${c.height}` : "No se pudieron leer las dimensiones" });

  if (c.withText) {
    const W = f.width, H = f.height, z = SAFE_ZONES[c.format];
    const totalTextArea = c.layers.reduce((s, l) => s + l.box.w * l.box.h, 0);
    for (const l of c.layers.filter((x) => x.text.trim())) {
      const inSafe = l.box.y >= z.top * H - 1 && l.box.y + l.box.h <= H * (1 - z.bottom) + 1 && l.box.x >= z.side * W - 1 && l.box.x + l.box.w <= W * (1 - z.side) + 1;
      out.push({ ok: inSafe, level: "error", label: `«${short(l.text)}» dentro de la zona segura`, detail: inSafe ? "No queda tapado por la interfaz." : "Parte del texto puede quedar tapado por la interfaz de la app." });
      const minPx = Math.round(W * 0.03);
      out.push({ ok: l.fontPx >= minPx, level: "aviso", label: `«${short(l.text)}» legible en celular`, detail: `Tamaño ${Math.round(l.fontPx)} px (mínimo recomendado ${minPx} px).` });
      if (l.contrast !== null) {
        out.push({ ok: l.contrast >= 4.5, level: "aviso", label: `Contraste de «${short(l.text)}»`, detail: `Relación ${l.contrast.toFixed(1)}:1 (recomendado ≥ 4,5:1).` });
      }
    }
    const ratio = totalTextArea / (W * H);
    out.push({ ok: ratio <= 0.25, level: "aviso", label: "Texto en proporción razonable", detail: `El texto ocupa ≈${Math.round(ratio * 100)} % de la imagen; menos texto suele leerse mejor.` });
  }
  return out;
}

export function blockingIssues(checks: Check[]): Check[] {
  return checks.filter((c) => !c.ok && c.level === "error");
}

/** Contraste WCAG entre dos colores #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const L = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [L(a), L(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function short(t: string) {
  return t.length > 28 ? `${t.slice(0, 27)}…` : t;
}
