"use client";
/**
 * Editor visual de creatividades. Compone fondo (foto real o generada) + textos
 * con tipografía real + logo, respetando las zonas seguras de cada formato.
 * La composición se adapta al formato (no es un recorte de otra pieza).
 * Exporta un PNG en la resolución exacta y el servidor lo verifica.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Layout = {
  template: "banda-inferior" | "banda-superior" | "tarjeta" | "degradado" | "sin-texto";
  headline: string; subline: string; cta: string;
  textColor: string; bandColor: string; ctaColor: string; ctaTextColor: string;
  focusX: number; focusY: number; zoom: number; fontScale: number;
  showLogo: boolean; logoAssetId: string | null; showSafeZones: boolean; backgroundAssetId?: string | null;
};
type Check = { ok: boolean; level: "error" | "aviso"; label: string; detail: string };
type Box = { x: number; y: number; w: number; h: number };
type LayerInfo = { text: string; fontPx: number; box: Box; contrast: number | null };

const FONT = `"Helvetica Neue", Helvetica, Arial, sans-serif`;

function luminance(r: number, g: number, b: number) {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function hexLum(hex: string) {
  return luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}
function ratio(a: number, b: number) {
  const [h, l] = a > b ? [a, b] : [b, a];
  return (h + 0.05) / (l + 0.05);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Ajusta el tamaño de fuente para que el texto quepa en maxLines dentro de maxW. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, start: number, min: number, maxLines: number, weight = "800") {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  ctx.font = `${weight} ${min}px ${FONT}`;
  return { size: min, lines: wrap(ctx, text, maxW) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function CreativeEditor(props: {
  creativeId: string;
  width: number; height: number;
  safe: { top: number; bottom: number; side: number };
  initial: Layout;
  backgrounds: { id: string; label: string; source: string }[];
  logos: { id: string; label: string }[];
  palette: string[];
  checks: Check[] | null;
  readOnly: boolean;
}) {
  const { width: W, height: H, safe } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<Layout>({ ...props.initial, backgroundAssetId: props.initial.backgroundAssetId ?? props.backgrounds[0]?.id ?? null });
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(props.checks);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const layersRef = useRef<LayerInfo[]>([]);
  const router = useRouter();

  const set = <K extends keyof Layout>(k: K, v: Layout[K]) => setLayout((l) => ({ ...l, [k]: v }));

  useEffect(() => {
    if (!layout.backgroundAssetId) { setBg(null); return; }
    const img = new Image();
    img.onload = () => setBg(img);
    img.onerror = () => setMsg({ tone: "bad", text: "No se pudo cargar la imagen de fondo." });
    img.src = `/api/assets/${layout.backgroundAssetId}`;
  }, [layout.backgroundAssetId]);
  useEffect(() => {
    if (!layout.logoAssetId) { setLogo(null); return; }
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = `/api/assets/${layout.logoAssetId}`;
  }, [layout.logoAssetId]);

  const draw = useCallback((forExport: boolean) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    // Fondo: "cover" con punto focal y zoom (la composición se recalcula por formato)
    if (bg) {
      const scale = Math.max(W / bg.width, H / bg.height) * layout.zoom;
      const dw = bg.width * scale, dh = bg.height * scale;
      const dx = (W - dw) * layout.focusX, dy = (H - dh) * layout.focusY;
      ctx.drawImage(bg, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = layout.bandColor;
      ctx.fillRect(0, 0, W, H);
    }

    const layers: LayerInfo[] = [];
    const sx = W * safe.side, top = H * safe.top, bottom = H * (1 - safe.bottom);
    const innerW = W - sx * 2;
    const pad = Math.round(W * 0.045);
    const fs = layout.fontScale;

    if (layout.template !== "sin-texto") {
      const hl = layout.headline.trim();
      const sl = layout.subline.trim();
      const cta = layout.cta.trim();
      const maxTextW = innerW - pad * 2;
      const head = hl ? fit(ctx, hl, maxTextW, Math.round(W * 0.085 * fs), Math.round(W * 0.04), 3) : null;
      const sub = sl ? fit(ctx, sl, maxTextW, Math.round(W * 0.045 * fs), Math.round(W * 0.03), 3, "500") : null;
      const ctaSize = Math.round(W * 0.038 * fs);
      const lh = 1.12;
      const headH = head ? head.lines.length * head.size * lh : 0;
      const subH = sub ? sub.lines.length * sub.size * 1.3 : 0;
      const ctaH = cta ? ctaSize * 2.3 : 0;
      const gap = Math.round(W * 0.025);
      const blockH = pad * 2 + headH + (sub ? gap + subH : 0) + (cta ? gap + ctaH : 0);

      let bx = sx, by = 0, bw = innerW, bh = blockH;
      if (layout.template === "banda-inferior") by = bottom - bh;
      else if (layout.template === "banda-superior") by = top + (logo && layout.showLogo ? W * 0.14 : 0);
      else if (layout.template === "tarjeta") { by = top + (bottom - top - bh) / 2; }
      else { by = bottom - bh; }

      // Fondo del bloque de texto
      let backLum: number;
      if (layout.template === "degradado") {
        const g = ctx.createLinearGradient(0, by - H * 0.15, 0, H);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.35, "rgba(0,0,0,0.55)");
        g.addColorStop(1, "rgba(0,0,0,0.85)");
        ctx.fillStyle = g;
        ctx.fillRect(0, by - H * 0.15, W, H - by + H * 0.15);
        const data = ctx.getImageData(Math.round(bx), Math.round(by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh))).data;
        let sum = 0, n = 0;
        for (let i = 0; i < data.length; i += 4 * 16) { sum += luminance(data[i], data[i + 1], data[i + 2]); n++; }
        backLum = n ? sum / n : 0;
      } else {
        ctx.fillStyle = layout.bandColor;
        ctx.globalAlpha = layout.template === "tarjeta" ? 0.94 : 1;
        roundRect(ctx, bx, by, bw, bh, Math.round(W * 0.03));
        ctx.fill();
        ctx.globalAlpha = 1;
        backLum = hexLum(layout.bandColor);
      }
      const textContrast = ratio(hexLum(layout.textColor), backLum);

      let y = by + pad;
      ctx.fillStyle = layout.textColor;
      ctx.textBaseline = "top";
      if (head) {
        ctx.font = `800 ${head.size}px ${FONT}`;
        head.lines.forEach((l, i) => ctx.fillText(l, bx + pad, y + i * head.size * lh));
        layers.push({ text: hl, fontPx: head.size, box: { x: bx + pad, y, w: maxTextW, h: headH }, contrast: textContrast });
        y += headH + gap;
      }
      if (sub) {
        ctx.font = `500 ${sub.size}px ${FONT}`;
        sub.lines.forEach((l, i) => ctx.fillText(l, bx + pad, y + i * sub.size * 1.3));
        layers.push({ text: sl, fontPx: sub.size, box: { x: bx + pad, y, w: maxTextW, h: subH }, contrast: textContrast });
        y += subH + gap;
      }
      if (cta) {
        ctx.font = `800 ${ctaSize}px ${FONT}`;
        const tw = Math.min(ctx.measureText(cta).width + ctaSize * 2, maxTextW);
        ctx.fillStyle = layout.ctaColor;
        roundRect(ctx, bx + pad, y, tw, ctaH, ctaH / 2);
        ctx.fill();
        ctx.fillStyle = layout.ctaTextColor;
        ctx.textBaseline = "middle";
        ctx.fillText(cta, bx + pad + ctaSize, y + ctaH / 2, tw - ctaSize * 2);
        ctx.textBaseline = "top";
        layers.push({ text: cta, fontPx: ctaSize, box: { x: bx + pad, y, w: tw, h: ctaH }, contrast: ratio(hexLum(layout.ctaTextColor), hexLum(layout.ctaColor)) });
      }
    }

    if (logo && layout.showLogo) {
      const lw = W * 0.16;
      const lh2 = (logo.height / logo.width) * lw;
      ctx.drawImage(logo, sx, top, lw, lh2);
      layers.push({ text: "Logo", fontPx: 999, box: { x: sx, y: top, w: lw, h: lh2 }, contrast: null });
    }
    layersRef.current = layers;

    if (!forExport && layout.showSafeZones) {
      ctx.fillStyle = "rgba(255,0,80,0.18)";
      ctx.fillRect(0, 0, W, top);
      ctx.fillRect(0, bottom, W, H - bottom);
      ctx.fillRect(0, top, sx, bottom - top);
      ctx.fillRect(W - sx, top, sx, bottom - top);
      ctx.setLineDash([12, 10]);
      ctx.strokeStyle = "rgba(255,0,80,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, top, W - sx * 2, bottom - top);
      ctx.setLineDash([]);
    }
  }, [W, H, safe, layout, bg, logo]);

  useEffect(() => { draw(false); }, [draw]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      draw(true);
      let blob: Blob | null = await new Promise((r) => canvasRef.current!.toBlob(r, "image/png"));
      // Las fotos pesan mucho en PNG: sobre ~3,5 MB se exporta como JPEG de alta calidad (Meta lo admite).
      if (blob && blob.size > 3.5 * 1024 * 1024) blob = await new Promise((r) => canvasRef.current!.toBlob(r, "image/jpeg", 0.92));
      draw(false);
      if (!blob) throw new Error("No se pudo exportar la imagen.");
      const fd = new FormData();
      fd.set("file", blob, blob.type === "image/jpeg" ? "pieza.jpg" : "pieza.png");
      fd.set("layout", JSON.stringify(layout));
      fd.set("withText", String(layout.template !== "sin-texto"));
      fd.set("layers", JSON.stringify(layersRef.current.filter((l) => l.text !== "Logo")));
      const res = await fetch(`/api/creatives/${props.creativeId}/render`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar.");
      setChecks(json.checks);
      const blocking = (json.checks as Check[]).filter((c) => !c.ok && c.level === "error").length;
      setMsg(blocking ? { tone: "bad", text: `Pieza guardada con ${blocking} problema(s) que impiden aprobarla.` } : { tone: "ok", text: json.reapprovalNeeded ? "Pieza guardada y verificada. Como cambió, debe aprobarse de nuevo." : "Pieza guardada y verificada." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const ro = props.readOnly;
  return (
    <div className="editor">
      <div>
        <div className="canvas-wrap"><canvas ref={canvasRef} width={W} height={H} aria-label="Vista previa de la pieza" /></div>
        <p className="hint" style={{ textAlign: "center" }}>{W}×{H} px · las zonas rojas quedan tapadas por la interfaz o los bordes (no se exportan).</p>
      </div>
      <div className="card" style={{ position: "sticky", top: 80 }}>
        {msg && <div className={`notice ${msg.tone}`}>{msg.text}</div>}
        <div className="field">
          <label>Fondo</label>
          <select value={layout.backgroundAssetId ?? ""} onChange={(e) => set("backgroundAssetId", e.target.value || null)} disabled={ro}>
            <option value="">Color de marca</option>
            {props.backgrounds.map((b) => <option key={b.id} value={b.id}>{b.source === "ai" ? "IA · " : ""}{b.label}</option>)}
          </select>
        </div>
        <div className="grid g2">
          <div className="field"><label>Encuadre horizontal</label><input type="range" min={0} max={1} step={0.01} value={layout.focusX} onChange={(e) => set("focusX", Number(e.target.value))} disabled={ro} /></div>
          <div className="field"><label>Encuadre vertical</label><input type="range" min={0} max={1} step={0.01} value={layout.focusY} onChange={(e) => set("focusY", Number(e.target.value))} disabled={ro} /></div>
        </div>
        <div className="field"><label>Zoom</label><input type="range" min={1} max={2.5} step={0.01} value={layout.zoom} onChange={(e) => set("zoom", Number(e.target.value))} disabled={ro} /></div>
        <div className="field">
          <label>Diseño</label>
          <select value={layout.template} onChange={(e) => set("template", e.target.value as Layout["template"])} disabled={ro}>
            <option value="banda-inferior">Banda inferior</option>
            <option value="banda-superior">Banda superior</option>
            <option value="tarjeta">Tarjeta central</option>
            <option value="degradado">Degradado sobre la foto</option>
            <option value="sin-texto">Sin texto (solo imagen)</option>
          </select>
        </div>
        {layout.template !== "sin-texto" && (
          <>
            <div className="field"><label>Titular <span className="hint">· máx. 7 palabras</span></label><input type="text" value={layout.headline} onChange={(e) => set("headline", e.target.value)} disabled={ro} /></div>
            <div className="field"><label>Texto secundario</label><input type="text" value={layout.subline} onChange={(e) => set("subline", e.target.value)} disabled={ro} /></div>
            <div className="field"><label>Botón</label><input type="text" value={layout.cta} onChange={(e) => set("cta", e.target.value)} disabled={ro} /></div>
            <div className="field"><label>Tamaño del texto</label><input type="range" min={0.7} max={1.4} step={0.01} value={layout.fontScale} onChange={(e) => set("fontScale", Number(e.target.value))} disabled={ro} /></div>
            <div className="grid g2">
              {(["textColor", "bandColor", "ctaColor", "ctaTextColor"] as const).map((k) => (
                <div className="field" key={k}>
                  <label>{{ textColor: "Texto", bandColor: "Fondo del texto", ctaColor: "Botón", ctaTextColor: "Texto del botón" }[k]}</label>
                  <div className="row">
                    <input type="color" value={layout[k]} onChange={(e) => set(k, e.target.value.toUpperCase())} disabled={ro} style={{ width: 44, height: 34, padding: 0, border: "none" }} />
                    {props.palette.slice(0, 4).map((p) => <button type="button" key={p} title={p} onClick={() => set(k, p)} disabled={ro} style={{ width: 20, height: 20, borderRadius: 5, background: p, border: "1px solid var(--border)", cursor: "pointer" }} />)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="field">
          <label>Logo</label>
          <select value={layout.logoAssetId ?? ""} onChange={(e) => { set("logoAssetId", e.target.value || null); set("showLogo", !!e.target.value); }} disabled={ro}>
            <option value="">Sin logo</option>
            {props.logos.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <label className="checkbox"><input type="checkbox" checked={layout.showSafeZones} onChange={(e) => set("showSafeZones", e.target.checked)} /> Mostrar zonas seguras</label>
        {!ro && <button className="btn primary" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} onClick={save} disabled={saving}>{saving ? "Guardando y verificando…" : "Guardar pieza"}</button>}
        {checks && (
          <div style={{ marginTop: 14 }}>
            <b>Verificación técnica</b>
            <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
              {checks.map((c, i) => <li key={i} style={{ color: c.ok ? "var(--ok)" : c.level === "error" ? "var(--bad)" : "var(--warn)" }}>{c.ok ? "✓" : c.level === "error" ? "✗" : "!"} {c.label} <small style={{ color: "var(--muted)" }}>— {c.detail}</small></li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
