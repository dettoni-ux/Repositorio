/**
 * Generación de video con IA (Seedance vía Replicate) para las piezas tipo «video».
 * Requiere REPLICATE_API_TOKEN; el modelo se cambia con SEEDANCE_MODEL.
 */
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

const ejecutar = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

// «lite» genera en minutos y cuesta una fracción; «pro» es más lento y a 1080p
// se queda en cola tanto rato que agotaba la espera. SEEDANCE_MODEL lo cambia.
const MODELO_DEF = 'bytedance/seedance-1-lite';
const RESOLUCION_DEF = '720p';           // 720×1280 vertical: Instagram lo acepta sin recomprimir
const ESPERA_MAX_MIN = 45;

export function videoDisponible() {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

/** Lee el esquema del modelo para enviar exactamente los parámetros que acepta. */
async function esquemaModelo(modelo, cab) {
  try {
    const res = await fetch(`https://api.replicate.com/v1/models/${modelo}`, { headers: cab });
    if (!res.ok) return null;
    const info = await res.json();
    const props = info?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
    return props ? { props, version: info.latest_version?.id } : null;
  } catch (e) { return null; }
}

/** Elige el primer nombre de parámetro que el modelo realmente acepta. */
function ponerSiExiste(entrada, props, candidatos, valor) {
  if (!props) { entrada[candidatos[0]] = valor; return; }
  const n = candidatos.find(c => c in props);
  if (n) entrada[n] = ajustar(props[n], valor);
}

/**
 * Encaja el valor en lo que el parámetro admite: si declara una lista cerrada,
 * toma la opción más parecida; si declara mínimo/máximo, lo recorta. Así una
 * duración de 8 s no rompe un modelo que solo acepta 5 o 10.
 */
function ajustar(prop, valor) {
  if (!prop) return valor;
  const lista = prop.enum || prop.allOf?.[0]?.enum || prop['x-enum'];
  if (Array.isArray(lista) && lista.length) {
    if (lista.includes(valor)) return valor;
    if (typeof valor === 'number') {
      const nums = lista.filter(v => typeof v === 'number');
      if (nums.length) return nums.reduce((a, b) => Math.abs(b - valor) < Math.abs(a - valor) ? b : a);
    }
    const txt = String(valor);
    return lista.find(v => String(v) === txt) ?? lista[0];
  }
  if (typeof valor === 'number') {
    if (typeof prop.minimum === 'number' && valor < prop.minimum) return prop.minimum;
    if (typeof prop.maximum === 'number' && valor > prop.maximum) return prop.maximum;
  }
  return valor;
}

export async function generarVideo({ prompt, duracion = 10, salida }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Falta REPLICATE_API_TOKEN');
  const modelo = (process.env.SEEDANCE_MODEL || MODELO_DEF).trim();
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const esquema = await esquemaModelo(modelo, cab);
  const entrada = { prompt };
  ponerSiExiste(entrada, esquema?.props, ['duration', 'duration_seconds', 'num_frames'], duracion);
  ponerSiExiste(entrada, esquema?.props, ['resolution', 'video_size', 'size'], (process.env.SEEDANCE_RES || RESOLUCION_DEF).trim());
  ponerSiExiste(entrada, esquema?.props, ['aspect_ratio', 'aspect'], '9:16');
  if (esquema) {
    console.log(`    parámetros aceptados por el modelo: ${Object.keys(esquema.props).join(', ')}`);
    console.log(`    enviando: ${JSON.stringify(entrada).slice(0, 200)}`);
  }

  let res = await fetch(`https://api.replicate.com/v1/models/${modelo}/predictions`, {
    method: 'POST', headers: { ...cab, Prefer: 'wait=60' }, body: JSON.stringify({ input: entrada })
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${JSON.stringify(pred).slice(0, 400)}`);

  const espera = Number(process.env.SEEDANCE_ESPERA_MIN || ESPERA_MAX_MIN);
  const limite = Date.now() + espera * 60_000;
  const t0 = Date.now();
  console.log(`    predicción ${pred.id} (${pred.status}) — seguimiento en https://replicate.com/p/${pred.id}`);
  let ultimo = pred.status, avisado = 0;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > limite) {
      throw new Error(`Tiempo de espera agotado (${espera} min) en estado «${pred.status}». `
        + `La predicción ${pred.id} sigue viva en https://replicate.com/p/${pred.id}: `
        + 'si suele quedarse en cola, usa un modelo más liviano (variable SEEDANCE_MODEL) '
        + 'o baja la resolución (SEEDANCE_RES).');
    }
    await new Promise(r => setTimeout(r, 8000));
    res = await fetch(pred.urls.get, { headers: cab });
    pred = await res.json();
    const min = Math.floor((Date.now() - t0) / 60_000);
    if (pred.status !== ultimo) { console.log(`    estado: ${ultimo} → ${pred.status} (${min} min)`); ultimo = pred.status; }
    else if (min >= avisado + 5) { avisado = min; console.log(`    sigue en «${pred.status}» (${min} min)…`); }
  }
  if (pred.status !== 'succeeded') {
    // El campo error suele venir vacío; los logs del modelo dicen la causa real.
    const detalle = [pred.error, (pred.logs || '').trim().split('\n').slice(-6).join(' | ')]
      .filter(Boolean).join(' — ') || 'sin detalle del modelo';
    throw new Error(`Generación en estado ${pred.status}: ${detalle}`);
  }
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url || typeof url !== 'string') throw new Error('La predicción no trajo URL de salida');

  mkdirSync(path.dirname(salida), { recursive: true });
  const bin = await fetch(url);
  writeFileSync(salida, Buffer.from(await bin.arrayBuffer()));
  return salida;
}

/**
 * Cortometraje: genera un clip por escena y los une en un solo video.
 * Con una sola escena devuelve ese clip tal cual.
 */
export async function generarCortometraje({ escenas, salida, alAvanzar }) {
  const clips = [];
  try {
    for (let i = 0; i < escenas.length; i++) {
      if (alAvanzar) alAvanzar(i, escenas.length);
      const parcial = salida.replace(/\.mp4$/, `.escena${i + 1}.mp4`);
      await generarVideo({ prompt: escenas[i].prompt_ia, duracion: escenas[i].duracion_s, salida: parcial });
      clips.push(parcial);
    }
    if (clips.length === 1) {
      const { renameSync } = await import('node:fs');
      renameSync(clips[0], salida);
      return salida;
    }
    // Unir re-codificando: los clips pueden venir con parámetros distintos.
    const entradas = clips.flatMap(c => ['-i', c]);
    const filtro = clips.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}]`).join(';')
      + ';' + clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[v]`;
    await ejecutar(ffmpeg(), ['-y', ...entradas, '-filter_complex', filtro, '-map', '[v]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', salida]);
    return salida;
  } finally {
    clips.forEach(c => { if (existsSync(c)) { try { unlinkSync(c); } catch (e) {} } });
  }
}
