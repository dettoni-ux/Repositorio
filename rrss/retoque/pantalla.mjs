/**
 * Dibuja la pantalla de la app que se compondrá sobre el teléfono del video.
 *
 * El video original traía una interfaz con palabras inventadas («Pacetas»,
 * «Peceihas») y en morado, que no es el color de la marca. Esta se dibuja en
 * blanco y rosado, con textos reales, y respeta la MISMA distribución que la
 * original para que el dedo de la veterinaria siga apuntando a una tarjeta.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROSA = '#FA2778';
const TINTA = '#241A1F';

function pagina(logoDataUri) {
  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:660px;height:1540px;background:#fff;overflow:hidden;
       font:400 16px/1.35 system-ui,-apple-system,"DejaVu Sans",sans-serif;color:${TINTA}}
  .estado{display:flex;justify-content:space-between;align-items:center;
          padding:22px 34px 10px;font-size:26px;font-weight:600}
  .estado .der{display:flex;gap:10px;align-items:center}
  .barra{background:#fff;padding:14px 28px 20px;display:flex;align-items:center;gap:18px;
         border-bottom:2px solid #F3EDF0}
  .barra img{height:62px}
  .flecha,.lupa{color:${TINTA};font-size:34px;line-height:1;opacity:.75}
  .buscar{margin:26px 28px 0;background:#F5F1F3;border-radius:999px;
          padding:20px 26px;color:#8A7F86;font-size:25px;display:flex;gap:14px;align-items:center}
  h2{margin:40px 28px 18px;font-size:34px;font-weight:800;letter-spacing:-.5px}
  .tarjetas{display:flex;gap:18px;margin:0 28px}
  .t{flex:1;background:#FDF0F5;border-radius:26px;padding:26px 20px 24px;text-align:center}
  .t.act{background:#FCE0EC;outline:3px solid ${ROSA}}
  .t .ico{margin:0 auto 14px;width:76px;height:76px;display:grid;place-items:center}
  .t .ico svg{width:76px;height:76px}
  .t .n{font-size:26px;font-weight:700;line-height:1.2}
  .fila{margin:0 28px 14px;background:#F7F5F6;border-radius:22px;
        padding:22px 24px;display:flex;align-items:center;gap:20px}
  .fila .pt{width:62px;height:62px;border-radius:50%;background:${ROSA};
            display:grid;place-items:center;flex:0 0 auto}
  .fila .pt svg{width:34px;height:34px}
  .fila .tx b{display:block;font-size:27px;font-weight:700}
  .fila .tx s{display:block;font-size:22px;color:#8A7F86;text-decoration:none;margin-top:3px}
  .fila .fl{margin-left:auto;color:#B9AEB5;font-size:30px}
  .cta{margin:36px 28px 0;background:${ROSA};color:#fff;border-radius:999px;
       text-align:center;padding:26px;font-size:30px;font-weight:800}
  .tabs{position:absolute;bottom:0;left:0;right:0;border-top:2px solid #EFEAED;
        display:flex;padding:20px 0 34px;background:#fff}
  .tab{flex:1;text-align:center;font-size:20px;color:#B0A5AC}
  .tab .i{font-size:34px;display:block;margin-bottom:6px}
  .tab.on{color:${ROSA};font-weight:700}
  .home{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);
        width:200px;height:8px;border-radius:4px;background:#1a1a1a;opacity:.85}
</style>
<div class="estado"><span>9:41</span><span class="der">▮▮▮ ᯤ ▰</span></div>
<div class="barra"><span class="flecha">‹</span><img src="${logoDataUri}" alt=""><span class="lupa">⌕</span></div>
<div class="buscar"><span>⌕</span><span>Buscar veterinario cerca de ti</span></div>

<h2>Servicios</h2>
<div class="tarjetas">
  <div class="t act"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#FA2778" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.3" fill="#FA2778" stroke="none"/><circle cx="12" cy="14.5" r="1.3" fill="#FA2778" stroke="none"/></svg></div><div class="n">Agendar<br>hora</div></div>
  <div class="t"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#C2708F" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 2.5h6v3H9zM8 11h8M8 15h5"/></svg></div><div class="n">Ficha del<br>paciente</div></div>
</div>

<h2>Recetas</h2>
<div class="fila">
  <div class="pt"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M7 20V6h4a3 3 0 0 1 0 6H7M12 12l6 8M14 16l4-4"/></svg></div>
  <div class="tx"><b>Receta digital</b><s>Descárgala cuando quieras</s></div>
  <div class="fl">›</div>
</div>

<h2>Recordatorios</h2>
<div class="fila">
  <div class="pt"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a2 2 0 0 0 3 0"/></svg></div>
  <div class="tx"><b>Vacunas al día</b><s>Te avisamos antes de cada dosis</s></div>
  <div class="fl">›</div>
</div>

<div class="cta">Reservar hora</div>

<h2>Cerca de ti</h2>
<div class="fila">
  <div class="pt"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg></div>
  <div class="tx"><b>Veterinarios verificados</b><s>En tu comuna, con hora disponible</s></div>
  <div class="fl">›</div>
</div>

<div class="tabs">
  <div class="tab on"><span class="i">⌂</span>Inicio</div>
  <div class="tab"><span class="i">▤</span>Fichas</div>
  <div class="tab"><span class="i">♡</span>Favoritos</div>
  <div class="tab"><span class="i">◍</span>Perfil</div>
</div>
<div class="home"></div>`;
}

const logo = readFileSync(path.join(AQUI, 'logo-claro.png')).toString('base64');
const salida = process.argv[2] || path.join(AQUI, 'pantalla.png');
mkdirSync(path.dirname(salida), { recursive: true });

const ruta = process.env.CHROMIUM_PATH || undefined;
const nav = await chromium.launch({ ...(ruta ? { executablePath: ruta } : {}), args: ['--no-sandbox'] });
try {
  const pag = await nav.newPage({ viewport: { width: 660, height: 1540 }, deviceScaleFactor: 1 });
  await pag.setContent(pagina(`data:image/png;base64,${logo}`), { waitUntil: 'load' });
  await pag.screenshot({ path: salida });
} finally {
  await nav.close();
}
console.log(`Pantalla lista: ${salida}`);
