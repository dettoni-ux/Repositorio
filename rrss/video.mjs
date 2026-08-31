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
    const esquemas = info?.latest_version?.openapi_schema?.components?.schemas;
    const props = esquemas?.Input?.properties;
    if (!props) return null;
    // Las opciones válidas viven detrás de un $ref; sin resolverlo, ajustar()
    // no ve ningún enum y deja pasar valores que el modelo no acepta.
    for (const d of Object.values(props)) {
      const ref = d.allOf?.[0]?.$ref || d.$ref;
      const nombre = typeof ref === 'string' ? ref.split('/').pop() : null;
      if (nombre && esquemas[nombre]?.enum) d.enum = esquemas[nombre].enum;
    }
    return { props, version: info.latest_version?.id };
  } catch (e) { return null; }
}

/** Elige el primer nombre de parámetro que el modelo realmente acepta. */
function ponerSiExiste(entrada, props, candidatos, valor, haciaArriba) {
  if (!props) { entrada[candidatos[0]] = valor; return; }
  const n = candidatos.find(c => c in props);
  if (n) entrada[n] = ajustar(props[n], valor, haciaArriba);
}

/**
 * Encaja el valor en lo que el parámetro admite: si declara una lista cerrada,
 * toma la opción más parecida; si declara mínimo/máximo, lo recorta. Así una
 * duración de 8 s no rompe un modelo que solo acepta 5 o 10.
 */
function ajustar(prop, valor, haciaArriba) {
  if (!prop) return valor;
  const lista = prop.enum || prop.allOf?.[0]?.enum || prop['x-enum'];
  if (Array.isArray(lista) && lista.length) {
    if (lista.includes(valor)) return valor;
    if (typeof valor === 'number') {
      const nums = lista.filter(v => typeof v === 'number');
      // Para la duración conviene pasarse y recortar: quedarse corto obliga a
      // estirar la imagen, y eso se nota.
      if (haciaArriba && nums.length) {
        const mayores = nums.filter(n => n >= valor);
        if (mayores.length) return Math.min(...mayores);
      }
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

/**
 * Sube una imagen a Replicate y devuelve su URL.
 *
 * El cuadro inicial acepta un data URI, pero reference_images no: el modelo lo
 * rechaza con «input was invalid» sin más detalle, porque necesita una URL que
 * pueda descargar. Subir el archivo primero es lo que lo destraba.
 */
async function subirImagen(dataUri, token) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!m) return dataUri;               // ya es una URL
  const cuerpo = new FormData();
  cuerpo.append('content', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'referencia.jpg');
  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: cuerpo
  });
  if (!res.ok) throw new Error(`No se pudo subir la referencia (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const datos = await res.json();
  const url = datos?.urls?.get;
  if (!url) throw new Error('La subida no devolvió URL de la referencia.');
  return url;
}

export async function generarVideo({ prompt, duracion = 10, salida, imagenInicial, referencias }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Falta REPLICATE_API_TOKEN');
  const modelo = (process.env.SEEDANCE_MODEL || MODELO_DEF).trim();
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const esquema = await esquemaModelo(modelo, cab);
  const entrada = { prompt };
  ponerSiExiste(entrada, esquema?.props, ['duration', 'duration_seconds', 'num_frames'], Math.ceil(duracion), true);
  const modo = (process.env.SEEDANCE_IDENTIDAD || 'encadenado').trim();
  const usaReferencia = modo === 'referencia' && referencias?.length;
  // «Reference images cannot be used with 1080p resolution»: lo dice el propio
  // esquema del modelo. Si se piden referencias, la resolución baja a 720p.
  let resolucion = (process.env.SEEDANCE_RES || RESOLUCION_DEF).trim();
  if (usaReferencia && resolucion === '1080p') {
    resolucion = '720p';
    console.log('    (las referencias no admiten 1080p: se genera en 720p)');
  }
  ponerSiExiste(entrada, esquema?.props, ['resolution', 'video_size', 'size'], resolucion);
  ponerSiExiste(entrada, esquema?.props, ['aspect_ratio', 'aspect'], '9:16');
  // Cómo se mantiene el mismo personaje entre escenas. Son excluyentes: el
  // modelo rechaza referencia y cuadro inicial juntos.
  //   encadenado (por defecto) — cada escena parte del cuadro anterior. Probado.
  //   referencia — ancla todas a la escena 1; en el papel es mejor, pero este
  //     modelo devuelve «input was invalid» sin explicar, así que no se usa
  //     salvo que se pida a propósito con SEEDANCE_IDENTIDAD=referencia.
  //   ninguna — solo el texto del prompt.
  let comoSeAncla = 'solo el texto del prompt';
  if (usaReferencia) {
    const campo = ['reference_images', 'reference_image'].find(c => !esquema?.props || c in esquema.props);
    if (campo) {
      const urls = await Promise.all(referencias.map(r => subirImagen(r, token)));
      entrada[campo] = campo === 'reference_image' ? urls[0] : urls;
      comoSeAncla = `referencia fija de la escena 1 (subida a Replicate)`;
    }
  } else if (modo !== 'ninguna' && imagenInicial) {
    ponerSiExiste(entrada, esquema?.props, ['image', 'first_frame_image', 'start_image', 'input_image'], imagenInicial);
    comoSeAncla = 'cuadro anterior encadenado';
  }
  if (esquema) {
    console.log(`    parámetros aceptados por el modelo: ${Object.keys(esquema.props).join(', ')}`);
    const resumen = { ...entrada };
    delete resumen.prompt;
    if (resumen.image) resumen.image = `«cuadro anterior» (${Math.round(imagenInicial.length / 1024)} KB)`;
    // Las URLs de referencia sí se muestran: son cortas y sirven para diagnosticar.
    console.log(`    identidad: ${comoSeAncla} · parámetros: ${JSON.stringify(resumen)}`);
    console.log(`    enviando: ${JSON.stringify(resumen).slice(0, 260)}`);
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
  const puentes = [];
  try {
    let imagenInicial = null;
    let referencias = null;
    for (let i = 0; i < escenas.length; i++) {
      if (alAvanzar) alAvanzar(i, escenas.length);
      const parcial = salida.replace(/\.mp4$/, `.escena${i + 1}.mp4`);
      await generarVideo({
        prompt: escenas[i].prompt_ia, duracion: escenas[i].duracion_s,
        salida: parcial, imagenInicial, referencias
      });
      await recortarA(parcial, escenas[i].duracion_s);
      clips.push(parcial);
      if (i + 1 < escenas.length) {
        const puente = salida.replace(/\.mp4$/, `.puente${i + 1}.jpg`);
        imagenInicial = await cuadroDeAnclaje(parcial, puente, escenas[i].duracion_s);
        if (imagenInicial) {
          puentes.push(puente);
          // La escena 1 fija cómo se ven los personajes para todo el corto.
          if (i === 0) referencias = [imagenInicial];
        } else {
          console.log('    (no se pudo extraer el cuadro de anclaje: la escena siguiente parte de cero)');
        }
      }
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
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
      '-movflags', '+faststart', salida]);
    return salida;
  } finally {
    [...clips, ...puentes].forEach(c => { if (existsSync(c)) { try { unlinkSync(c); } catch (e) {} } });
  }
}

/**
 * Cuadro de anclaje de un clip, como data URI, para que la escena siguiente
 * conserve los personajes. No se toma el último cuadro: suele caer en mitad de
 * un movimiento o de una transición y sirve de pésima referencia. Se toma uno
 * poco antes del final, ya con la acción resuelta.
 */
async function cuadroDeAnclaje(clip, destino, duracion) {
  const dur = Number(duracion) || 8;
  const momento = Math.max(0.5, dur * 0.8).toFixed(2);
  try {
    await ejecutar(ffmpeg(), ['-y', '-ss', momento, '-i', clip, '-frames:v', '1', '-q:v', '2', destino]);
    if (!existsSync(destino)) return null;
    const { readFileSync } = await import('node:fs');
    return `data:image/jpeg;base64,${readFileSync(destino).toString('base64')}`;
  } catch (e) {
    return null;
  }
}

/** Recorta un clip a la duración exacta que pide el guion. */
async function recortarA(clip, segundos) {
  const objetivo = Number(segundos);
  if (!Number.isFinite(objetivo) || objetivo <= 0) return clip;
  const actual = await duracionDe(clip);
  if (actual == null || actual <= objetivo + 0.08) return clip;
  const tmp = clip.replace(/\.mp4$/, '.recortado.mp4');
  await ejecutar(ffmpeg(), ['-y', '-i', clip, '-t', objetivo.toFixed(2), '-c', 'copy', tmp]);
  const { renameSync } = await import('node:fs');
  renameSync(tmp, clip);
  console.log(`    escena recortada de ${actual.toFixed(1)} s a ${objetivo.toFixed(1)} s (lo que pide el guion)`);
  return clip;
}

async function duracionDe(archivo) {
  try {
    await ejecutar(ffmpeg(), ['-i', archivo]);
  } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(e.stderr || '');
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return null;
}

/**
 * Cierre de marca: fondo morado con el degradado de la casa. El texto lo pone
 * el subtitulado, así que aquí solo va el lienzo. No pasa por la IA: es
 * gratis, sale idéntico siempre y la marca queda exacta.
 */
export async function cierreDeMarca({ duracion = 5, salida, morado = '#5B2E7E', ancho = 1080, alto = 1920, fps = 24 }) {
  mkdirSync(path.dirname(salida), { recursive: true });
  const fondo = `color=c=${morado}:s=${ancho}x${alto}:d=${duracion}:r=${fps}`;
  await ejecutar(ffmpeg(), ['-y', '-f', 'lavfi', '-i', fondo,
    '-vf', `vignette=PI/5,fade=t=in:st=0:d=0.4`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', salida]);
  return salida;
}

/** Une clips ya normalizados (mismo tamaño) en uno solo. */
export async function unirClips({ clips, salida, ancho = 1080, alto = 1920 }) {
  if (clips.length === 1) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(clips[0], salida);
    return salida;
  }
  const entradas = clips.flatMap(c => ['-i', c]);
  const filtro = clips.map((_, i) => `[${i}:v]scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto},setsar=1,fps=24[v${i}]`).join(';')
    + ';' + clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[v]`;
  await ejecutar(ffmpeg(), ['-y', ...entradas, '-filter_complex', filtro, '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
    '-movflags', '+faststart', salida]);
  return salida;
}

/**
 * Quema los subtítulos en la imagen. En Instagram la mayoría mira sin sonido:
 * si el texto no está en el video, el mensaje no llega.
 */
export async function quemarSubtitulos({ video, ass, salida }) {
  const escapada = ass.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  await ejecutar(ffmpeg(), ['-y', '-i', video, '-vf', `subtitles='${escapada}'`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
    '-movflags', '+faststart', salida]);
  return salida;
}
