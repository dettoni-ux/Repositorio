/**
 * Voz en off con ElevenLabs (texto a voz) y mezcla con el video vía ffmpeg.
 *
 * Variables de entorno:
 *   ELEVENLABS_API_KEY   (secret) clave de https://elevenlabs.io → Profile → API Keys
 *   ELEVENLABS_VOICE_ID  (opcional) id de la voz a usar; si no está, toma la primera
 *                        voz disponible de la cuenta y la informa en el log
 *   ELEVENLABS_MODEL     (opcional) por defecto eleven_v3 (multilingüe, expresivo)
 *   FFMPEG_PATH          (opcional) ruta a ffmpeg si no está en el PATH
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

const ejecutar = promisify(execFile);
const API = 'https://api.elevenlabs.io/v1';

export function vozDisponible() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function ffmpegBin() {
  // ffmpeg-static trae una compilación completa (x264 + aac); FFMPEG_PATH la sobrescribe.
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
}

async function elegirVoz(clave) {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID.trim();
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': clave } });
  if (!res.ok) throw new Error(`No se pudo listar voces (${res.status}). Define ELEVENLABS_VOICE_ID.`);
  const { voices } = await res.json();
  if (!voices?.length) throw new Error('La cuenta de ElevenLabs no tiene voces disponibles.');
  console.log(`  Voz: «${voices[0].name}» (${voices[0].voice_id}). Fíjala con ELEVENLABS_VOICE_ID.`);
  return voices[0].voice_id;
}

/** Genera el audio de la narración y lo guarda como mp3. */
export async function generarVoz({ texto, salida }) {
  const clave = process.env.ELEVENLABS_API_KEY;
  if (!clave) throw new Error('Falta ELEVENLABS_API_KEY');
  const voz = await elegirVoz(clave);
  const modelo = (process.env.ELEVENLABS_MODEL || 'eleven_v3').trim();

  const res = await fetch(`${API}/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: texto,
      model_id: modelo,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true }
    })
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${detalle.slice(0, 300)}`);
  }
  mkdirSync(path.dirname(salida), { recursive: true });
  writeFileSync(salida, Buffer.from(await res.arrayBuffer()));
  return salida;
}

/** Duración en segundos de un archivo multimedia, leyendo la salida de ffmpeg. */
async function duracion(archivo) {
  try {
    await ejecutar(ffmpegBin(), ['-i', archivo]);
  } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(e.stderr || '');
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return null;
}

/**
 * Une video y voz en off en un solo mp4. Si el audio es más largo que el video,
 * congela el último cuadro para que no se corte la frase; si es más corto,
 * completa con silencio. Nunca recorta la narración a mitad de camino.
 */
export async function mezclarVideoYVoz({ video, audio, salida }) {
  const [dv, da] = await Promise.all([duracion(video), duracion(audio)]);
  const args = ['-y', '-i', video, '-i', audio];
  if (dv != null && da != null && da > dv + 0.1) {
    args.push('-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${(da - dv).toFixed(2)}[v]`, '-map', '[v]');
  } else {
    args.push('-map', '0:v');
  }
  args.push('-map', '1:a', '-af', 'apad', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', salida);
  await ejecutar(ffmpegBin(), args);
  return salida;
}
