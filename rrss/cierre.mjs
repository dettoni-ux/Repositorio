/**
 * Tarjeta de cierre del cortometraje: la insignia azul apareciendo y la marca.
 *
 * No pasa por la IA de video: sale idéntica cada vez, la marca queda exacta y
 * no cuesta créditos. El texto lo pone el subtitulado, así que aquí solo va lo
 * gráfico.
 */
import { chromium } from 'playwright';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

const ejecutar = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

const MARCA = { morado: '#5B2E7E', amarillo: '#FFD84D', azul: '#1E9BE0', nombre: 'EncuentraVet' };

function paginaCierre({ morado, azul, nombre }) {
  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;overflow:hidden;
       background:radial-gradient(120% 80% at 50% 32%, ${morado} 0%, #2E1440 100%);
       font:400 16px system-ui,-apple-system,"DejaVu Sans",sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:70px}
  .huella{position:absolute;opacity:.06}
  .insignia{width:420px;height:420px;position:relative;display:grid;place-items:center}
  .halo{position:absolute;inset:-40px;border-radius:50%;
        background:radial-gradient(circle, ${azul}55 0%, transparent 68%)}
  .disco{width:100%;height:100%;border-radius:50%;background:${azul};
         box-shadow:0 30px 90px rgba(30,155,224,.45), inset 0 -14px 34px rgba(0,0,0,.18);
         display:grid;place-items:center}
  .disco svg{width:230px;height:230px}
  .nombre{color:#fff;font-size:96px;font-weight:800;letter-spacing:-2px}
  .nombre b{color:${MARCA.amarillo}}
</style>
<div class="insignia">
  <div class="halo"></div>
  <div class="disco">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2"
         stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5"/></svg>
  </div>
</div>
<div class="nombre">Encuentra<b>Vet</b></div>`;
}

/**
 * Genera la tarjeta como video. La insignia entra con un golpe de zoom y luego
 * se asienta: un cierre estático se siente como que el video se colgó.
 */
export async function tarjetaDeCierre({ duracion = 5, salida, fps = 24, ancho = 1080, alto = 1920 }) {
  mkdirSync(path.dirname(salida), { recursive: true });
  const png = salida.replace(/\.mp4$/, '.png');
  // Misma convención que el resto: CHROMIUM_PATH si está definido.
  const ruta = process.env.CHROMIUM_PATH || undefined;
  const nav = await chromium.launch({ ...(ruta ? { executablePath: ruta } : {}), args: ['--no-sandbox'] });
  try {
    const pag = await nav.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    await pag.setContent(paginaCierre(MARCA), { waitUntil: 'load' });
    await pag.screenshot({ path: png });
  } finally {
    await nav.close();
  }
  try {
    const cuadros = Math.round(duracion * fps);
    // Entra un poco grande y se asienta en el primer medio segundo.
    const zoom = `zoompan=z='if(lte(on,${Math.round(fps * 0.5)}),1.12-0.12*on/${Math.round(fps * 0.5)},1)':`
      + `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${ancho}x${alto}:fps=${fps}`;
    await ejecutar(ffmpeg(), ['-y', '-loop', '1', '-t', String(duracion), '-i', png,
      '-vf', `${zoom},fade=t=in:st=0:d=0.35`, '-frames:v', String(cuadros),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', salida]);
  } finally {
    if (existsSync(png)) { try { unlinkSync(png); } catch (e) {} }
  }
  return salida;
}
