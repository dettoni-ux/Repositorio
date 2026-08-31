/**
 * Rehace SOLO el audio de un cortometraje ya generado.
 *
 *   node remontar.mjs ../piezas/lote-....mp4
 *
 * La imagen es lo caro: cada escena se paga en Replicate. El audio no. Si lo
 * único que hay que corregir son los niveles, el guion o la voz, no tiene
 * sentido volver a pagar el video: se reusa el que ya está y se le cambia la
 * pista. Sale un archivo nuevo, el original queda intacto.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { leerGuion } from './guion.mjs';
import { generarVozPorTramos, vozDisponible } from './voz.mjs';

const ejecutar = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

async function duracionDe(archivo) {
  try {
    await ejecutar(ffmpeg(), ['-i', archivo]);
  } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(e.stderr || '');
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return null;
}

const entrada = process.argv[2];
if (!entrada || !existsSync(entrada)) {
  console.error('Uso: node remontar.mjs <video.mp4>   (el archivo debe existir)');
  process.exit(1);
}
if (!vozDisponible()) {
  console.error('Falta ELEVENLABS_API_KEY: sin ella no se puede rehacer la voz.');
  process.exit(1);
}
const guion = leerGuion();
if (!guion) {
  console.error('No hay guion propio activo en guion.json.');
  process.exit(1);
}

const salida = entrada.replace(/\.mp4$/, '-audio2.mp4');
const pista = path.join(path.dirname(entrada), '.remonte.mp3');

console.log(`Rehaciendo el audio de ${path.basename(entrada)} (la imagen no se toca, no cuesta créditos de video).`);
try {
  await generarVozPorTramos({ tramos: guion.tramos, total: guion.total, salida: pista });
  // La imagen se copia tal cual: no se recodifica, así no pierde calidad.
  // Nada de «-shortest»: si el audio queda corto recorta el video y se pierde
  // el final del cierre. Se rellena el audio con silencio hasta el largo real.
  await ejecutar(ffmpeg(), ['-y', '-i', entrada, '-i', pista,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'apad',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k',
    '-t', String(await duracionDe(entrada) ?? guion.total),
    '-movflags', '+faststart', salida]);
  console.log(`Listo: ${salida}`);
} finally {
  if (existsSync(pista)) { try { unlinkSync(pista); } catch (e) {} }
}
