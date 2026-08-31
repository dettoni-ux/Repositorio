/**
 * Cortometraje animado SIN IA de video: anima los personajes vectoriales de
 * animacion/corto.html cuadro a cuadro y arma un MP4 con H.264.
 * Gratis, ilimitado y con los personajes siempre idénticos entre escenas.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { abrirNavegador } from './render.mjs';

const ejecutar = promisify(execFile);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = () => process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const FPS = 25;

export async function animarCorto({ historia, marca, salida, alAvanzar }) {
  const navegador = await abrirNavegador();
  const tmp = mkdtempSync(path.join(tmpdir(), 'corto-'));
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 } });
    await pagina.addInitScript(([h, m]) => { window.HISTORIA = h; window.MARCA = m; }, [historia, marca]);
    await pagina.goto(pathToFileURL(path.join(AQUI, 'animacion', 'corto.html')).href, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready).catch(() => {});

    const total = await pagina.evaluate(() => window.DURACION_TOTAL);
    const cuadros = Math.ceil(total * FPS);
    for (let i = 0; i < cuadros; i++) {
      await pagina.evaluate(t => window.dibujar(t), i / FPS);
      await pagina.locator('#c').screenshot({ path: path.join(tmp, String(i).padStart(5, '0') + '.png') });
      if (alAvanzar && i % 25 === 0) alAvanzar(i / cuadros);
    }
    await pagina.close();

    mkdirSync(path.dirname(salida), { recursive: true });
    await ejecutar(ffmpeg(), ['-y', '-framerate', String(FPS), '-i', path.join(tmp, '%05d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
      '-movflags', '+faststart', salida]);
    return { salida, duracion: total };
  } finally {
    await navegador.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
