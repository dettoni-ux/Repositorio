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
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFileSync, existsSync as hay } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/** ¿Esta voz sirve para español (idealmente latino/chileno)? */
function puntajeEspanol(v) {
  const txt = JSON.stringify([v.labels || {}, v.verified_languages || [], v.description || '']).toLowerCase();
  let p = 0;
  if (/chile/.test(txt)) p += 100;
  if (/latin|mexic|colomb|argentin|peru/.test(txt)) p += 40;
  if (/"es"|spanish|español|espanol|castilian/.test(txt)) p += 30;
  if (/spain|castell/.test(txt)) p -= 10;   // el acento de España suena ajeno en Chile
  return p;
}

export async function listarVoces(clave) {
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': clave || process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`No se pudo listar voces (${res.status}).`);
  const { voices } = await res.json();
  return (voices || []).map(v => ({
    id: v.voice_id, nombre: v.name, puntaje: puntajeEspanol(v),
    etiquetas: Object.values(v.labels || {}).join(', ')
  })).sort((a, b) => b.puntaje - a.puntaje);
}

/** Voz elegida en voz.json (lo que se selecciona en la página del estudio). */
function vozConfigurada() {
  try {
    const ruta = path.join(path.dirname(fileURLToPath(import.meta.url)), 'voz.json');
    if (!hay(ruta)) return null;
    const cfg = JSON.parse(readFileSync(ruta, 'utf8'));
    if (!cfg.elegida) return null;
    const v = (cfg.disponibles || []).find(d => d.id === cfg.elegida);
    console.log(`  Voz configurada: ${v ? `«${v.nombre}» (${v.acento})` : cfg.elegida}.`);
    return cfg.elegida;
  } catch (e) { return null; }
}

async function elegirVoz(clave) {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID.trim();
  const dePreferencia = vozConfigurada();
  if (dePreferencia) return dePreferencia;
  const voces = await listarVoces(clave);
  if (!voces.length) throw new Error('La cuenta de ElevenLabs no tiene voces disponibles.');
  const v = voces[0];
  console.log(`  Voz elegida para español: «${v.nombre}» (${v.id})${v.etiquetas ? ' — ' + v.etiquetas : ''}.`);
  if (v.puntaje <= 0) console.log('  Aviso: ninguna voz de la cuenta declara español. Elige una en elevenlabs.io → Voices y fíjala en la variable ELEVENLABS_VOICE_ID.');
  else console.log('  Para fijarla, guarda ese id en la variable ELEVENLABS_VOICE_ID.');
  return v.id;
}

/** Genera el audio de la narración y lo guarda como mp3. */
export async function generarVoz({ texto, salida }) {
  const clave = process.env.ELEVENLABS_API_KEY;
  if (!clave) throw new Error('Falta ELEVENLABS_API_KEY');
  const voz = await elegirVoz(clave);
  const modelo = (process.env.ELEVENLABS_MODEL || 'eleven_v3').trim();

  const ajustes = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };

  /* Un corte de red deja el video mudo, así que se reintenta antes de rendirse.
     Los errores de la propia API (4xx/5xx) se devuelven tal cual: reintentarlos
     no cambiaría nada y el detalle sirve para saber qué pasó. */
  async function pedir(cuerpo) {
    let ultimo;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        return await fetch(`${API}/text-to-speech/${voz}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': clave, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo)
        });
      } catch (e) {
        ultimo = e;
        const causa = e.cause?.code || e.cause?.message || e.message;
        console.log(`  Falló la conexión con ElevenLabs (${causa}); intento ${intento} de 3.`);
        if (intento < 3) await new Promise(r => setTimeout(r, intento * 3000));
      }
    }
    throw ultimo;
  }

  const idioma = process.env.ELEVENLABS_LANG || 'es';
  let res = await pedir({ text: texto, model_id: modelo, language_code: idioma, voice_settings: ajustes });
  if (res.status === 400) {
    // Algunos modelos no aceptan language_code (lo detectan solo): reintentar sin él.
    console.log('  El modelo no acepta el código de idioma; se reintenta dejando que lo detecte.');
    res = await pedir({ text: texto, model_id: modelo, voice_settings: ajustes });
  }
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${detalle.slice(0, 300)}`);
  }
  mkdirSync(path.dirname(salida), { recursive: true });
  writeFileSync(salida, Buffer.from(await res.arrayBuffer()));
  return salida;
}

/**
 * Voz por tramos: cada frase se genera aparte y se coloca EXACTO en su segundo
 * de inicio. Es la única forma de que la voz calce con lo que se ve; una sola
 * pista corrida se desfasa apenas una frase dura más de lo previsto.
 *
 * Si un tramo se pasa de su ventana, se acelera solo ese tramo (hasta 18%) para
 * que no pise al siguiente.
 */
export async function generarVozPorTramos({ tramos, total, salida }) {
  const dir = path.dirname(salida);
  mkdirSync(dir, { recursive: true });
  const piezas = [];
  try {
    for (let i = 0; i < tramos.length; i++) {
      const t = tramos[i];
      if (!t.voz) continue;
      const bruto = path.join(dir, `tramo${i + 1}.mp3`);
      await generarVoz({ texto: t.voz, salida: bruto });
      piezas.push({ archivo: bruto, desde: t.desde, ventana: t.hasta - t.desde, i: i + 1 });
    }
    if (!piezas.length) throw new Error('El guion no trae texto de voz.');

    // Efectos de sonido, por debajo de la voz para no taparla.
    for (let i = 0; i < tramos.length; i++) {
      const t = tramos[i];
      if (!t.sfx) continue;
      const archivo = path.join(dir, `sfx${i + 1}.mp3`);
      try {
        await generarEfecto({ texto: t.sfx, duracion: t.hasta - t.desde, salida: archivo });
        piezas.push({ archivo, desde: t.desde, ventana: t.hasta - t.desde, i: i + 1, efecto: true });
      } catch (e) {
        console.log(`  Sin efecto de sonido en el tramo ${i + 1} (${e.message.slice(0, 90)}).`);
      }
    }

    const entradas = [];
    const cadVoz = [], cadEfx = [];
    for (let k = 0; k < piezas.length; k++) {
      const p = piezas[k];
      const d = await duracion(p.archivo);
      entradas.push('-i', p.archivo);
      const pasos = [];
      if (p.efecto) {
        // Cada efecto llega con su propio volumen; se nivelan todos al mismo
        // antes de mezclar, si no unos se pierden y otros gritan.
        pasos.push('loudnorm=I=-20:TP=-3:LRA=11',
          `atrim=0:${p.ventana.toFixed(2)}`,
          'afade=t=out:st=' + Math.max(0.1, p.ventana - 0.5).toFixed(2) + ':d=0.5');
      } else if (d != null && d > p.ventana + 0.05) {
        const factor = Math.min(d / p.ventana, APURO_MAX);
        pasos.push(filtroTempo(factor));
        const sobra = d / factor - p.ventana;
        console.log(`  Tramo ${p.i}: ${d.toFixed(1)} s en una ventana de ${p.ventana.toFixed(1)} s; `
          + `se acelera un ${((factor - 1) * 100).toFixed(0)}%`
          + (sobra > 0.15 ? ` y aun así sobra ${sobra.toFixed(1)} s: conviene acortar esa frase.` : '.'));
      }
      pasos.push('aresample=48000', `adelay=${Math.round(p.desde * 1000)}:all=1`);
      (p.efecto ? cadEfx : cadVoz).push(`[${k}:a]${pasos.join(',')}[t${k}]`);
    }

    const idx = c => c.match(/\[t(\d+)\]$/)[1];
    const unir = (cads, etq) => cads.length === 1
      ? `${cads[0].replace(/\[t\d+\]$/, `[${etq}]`)}`
      : `${cads.join(';')};${cads.map(c => `[t${idx(c)}]`).join('')}amix=inputs=${cads.length}:normalize=0:dropout_transition=0[${etq}]`;

    let mezcla, salidaFinal;
    if (cadEfx.length) {
      // Como en un comercial: los efectos suenan de verdad, pero se agachan
      // solos cuando entra la voz. Eso es el «ducking».
      mezcla = `${unir(cadVoz, 'vz')};[vz]asplit=2[vzMix][vzLado];`
        + `${unir(cadEfx, 'ef')};`
        + `[ef][vzLado]sidechaincompress=threshold=0.02:ratio=12:attack=8:release=320:makeup=1[efDuck];`
        + `[vzMix][efDuck]amix=inputs=2:normalize=0:dropout_transition=0,${NIVEL_FINAL}[out]`;
      salidaFinal = '[out]';
      console.log(`  ${cadEfx.length} efectos de sonido mezclados bajo la voz (se agachan cuando ella habla).`);
    } else {
      mezcla = `${unir(cadVoz, 'vz')};[vz]${NIVEL_FINAL}[out]`;
      salidaFinal = '[out]';
    }
    await ejecutar(ffmpegBin(), ['-y', ...entradas, '-filter_complex', mezcla,
      '-map', salidaFinal, '-t', String(total), '-c:a', 'libmp3lame', '-q:a', '2', salida]);
    return salida;
  } finally {
    piezas.forEach(p => { try { unlinkSync(p.archivo); } catch (e) {} });
  }
}

/**
 * Efecto de sonido a partir de su descripción en inglés (ElevenLabs).
 * Si falla, no es motivo para perder el video: se sigue sin ese efecto.
 */
export async function generarEfecto({ texto, duracion, salida }) {
  const clave = process.env.ELEVENLABS_API_KEY;
  if (!clave) throw new Error('Falta ELEVENLABS_API_KEY');
  const res = await fetch(`${API}/sound-generation`, {
    method: 'POST',
    headers: { 'xi-api-key': clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: texto,
      duration_seconds: Math.min(22, Math.max(0.5, Number(duracion) || 3)),
      prompt_influence: 0.5
    })
  });
  if (!res.ok) throw new Error(`ElevenLabs efectos ${res.status}: ${(await res.text()).slice(0, 200)}`);
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

/* Hasta aquí se puede acelerar el habla sin que se note ni suene apurada. */
const APURO_MAX = 1.18;

/* Nivel de salida parejo, en el rango que usan los comerciales: sin esto el
   video suena más bajo que todo lo demás del feed y hay que subir el volumen. */
const NIVEL_FINAL = 'loudnorm=I=-16:TP=-1.5:LRA=11';

/** Cadena de filtros atempo: cada uno admite como máximo 2x. */
function filtroTempo(factor) {
  const partes = [];
  let f = factor;
  while (f > 2) { partes.push('atempo=2.0'); f /= 2; }
  partes.push(`atempo=${f.toFixed(4)}`);
  return partes.join(',');
}

/**
 * Une video y voz en off en un solo mp4, haciendo que la narración TERMINE
 * CON EL CORTO. Si el audio se pasa, se acelera lo justo (hasta un 18%, que no
 * se nota) para que calce. Solo si aun así no alcanza se congela el último
 * cuadro: una imagen pegada mientras la voz sigue hablando se ve como un error.
 * Si el audio es más corto, se completa con silencio.
 */
export async function mezclarVideoYVoz({ video, audio, salida }) {
  const [dv, da] = await Promise.all([duracion(video), duracion(audio)]);
  const args = ['-y', '-i', video, '-i', audio];
  let filtroAudio = 'apad';

  if (dv != null && da != null && da > dv + 0.1) {
    const factor = da / dv;
    const aplicado = Math.min(factor, APURO_MAX);
    filtroAudio = `${filtroTempo(aplicado)},apad`;
    const restante = da / aplicado - dv;
    if (restante > 0.1) {
      // La narración es demasiado larga para las escenas: se avisa y se estira
      // el video lo mínimo, en vez de cortar la frase a la mitad.
      console.log(`  La narración excede el video en ${(da - dv).toFixed(1)} s. `
        + `Se acelera un ${((aplicado - 1) * 100).toFixed(0)}% y se extiende el cierre ${restante.toFixed(1)} s. `
        + 'Conviene acortar el guion o alargar las escenas.');
      args.push('-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${restante.toFixed(2)}[v]`, '-map', '[v]');
    } else {
      console.log(`  Voz ${(da - dv).toFixed(1)} s más larga que el video: se acelera un ${((aplicado - 1) * 100).toFixed(0)}% para que termine con el corto.`);
      args.push('-map', '0:v');
    }
  } else {
    args.push('-map', '0:v');
  }
  // Estéreo a 48 kHz y el índice (moov) al principio: sin faststart hay
  // reproductores que muestran el video y se saltan la pista de audio.
  args.push('-map', '1:a', '-af', filtroAudio, '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k',
    '-movflags', '+faststart', salida);
  await ejecutar(ffmpegBin(), args);
  return salida;
}
