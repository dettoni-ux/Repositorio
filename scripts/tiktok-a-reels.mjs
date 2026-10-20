#!/usr/bin/env node
/**
 * Republica como reels de Instagram los videos de TU PROPIA cuenta de TikTok,
 * descargados sin la marca de agua que TikTok agrega al guardar.
 *
 * Solo procesa videos cuyo autor sea TIKTOK_USUARIO: no sirve para resubir
 * contenido de terceros (eso infringe sus derechos y las normas de Instagram).
 *
 * Flujo: yt-dlp lista los videos recientes del perfil → descarga los que aún
 * no están en tiktok/publicados.json (versión sin marca de agua) → los sube
 * a Instagram con la API oficial (subida reanudable, sin URL pública) →
 * anota el ID publicado para no repetirlo.
 *
 * Requiere yt-dlp y ffmpeg en el PATH.
 *
 * Variables de entorno:
 *   TIKTOK_USUARIO       tu usuario de TikTok, sin @ (obligatorio)
 *   IG_USER_ID           ID numérico de la cuenta profesional de Instagram
 *   IG_ACCESS_TOKEN      token de larga duración con permiso de publicación
 * Opcionales:
 *   GRAPH_HOST           graph.instagram.com (por defecto) o graph.facebook.com
 *   GRAPH_VERSION        por defecto v23.0
 *   URLS                 enlaces de videos concretos separados por comas
 *                        (en vez de revisar el perfil)
 *   MAX_POR_EJECUCION    reels a publicar como máximo por corrida (por defecto 3)
 *   REVISAR_ULTIMOS      cuántos videos recientes del perfil mirar (por defecto 10)
 *   INCLUIR_ANTERIORES   1 = en la primera corrida publica también lo que ya
 *                        existía; si no, solo lo marca como visto
 *   CAPTION_EXTRA        texto que se agrega al final de cada descripción
 *   TIKTOK_COOKIES_FILE  archivo de cookies (formato Netscape) si TikTok bloquea
 *   DRY_RUN              1 = descarga y muestra qué publicaría, sin publicar
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ESTADO = 'tiktok/publicados.json';
const TMP = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'tiktok') : 'tiktok/tmp';
const HOST = process.env.GRAPH_HOST || 'graph.instagram.com';
const VER = process.env.GRAPH_VERSION || 'v23.0';
const DRY = process.env.DRY_RUN === '1';
const MAX = parseInt(process.env.MAX_POR_EJECUCION || '3', 10);
const REVISAR = parseInt(process.env.REVISAR_ULTIMOS || '10', 10);
const USUARIO = (process.env.TIKTOK_USUARIO || '').trim().replace(/^@/, '').toLowerCase();

if (!USUARIO) {
  console.log('Sin TIKTOK_USUARIO configurado: no hay nada que revisar.');
  process.exit(0);
}
const IG_USER = (process.env.IG_USER_ID || '').trim();
const TOKEN = (process.env.IG_ACCESS_TOKEN || '').trim();
if (!DRY && (!IG_USER || !TOKEN)) {
  console.log('Faltan IG_USER_ID / IG_ACCESS_TOKEN: no se puede publicar todavía.');
  process.exit(0);
}

function ytdlp(args) {
  const cookies = process.env.TIKTOK_COOKIES_FILE;
  const extra = cookies && existsSync(cookies) ? ['--cookies', cookies] : [];
  return execFileSync('yt-dlp', [...extra, '--no-warnings', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
}

function leerEstado() {
  if (!existsSync(ESTADO)) return null;
  return JSON.parse(readFileSync(ESTADO, 'utf8'));
}

function guardarEstado(estado) {
  mkdirSync('tiktok', { recursive: true });
  writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + '\n');
}

function videosRecientes() {
  const out = ytdlp(['--flat-playlist', '--playlist-end', String(REVISAR), '-J',
    `https://www.tiktok.com/@${USUARIO}`]);
  return (JSON.parse(out).entries || [])
    .map(e => ({ id: String(e.id), url: e.url || `https://www.tiktok.com/@${USUARIO}/video/${e.id}` }));
}

// Descarga la mejor versión que NO sea la marcada con agua; si TikTok solo
// ofrece la versión con marca, falla en vez de publicarla así.
function descargar(url) {
  mkdirSync(TMP, { recursive: true });
  const salida = join(TMP, '%(id)s.%(ext)s');
  const id = ytdlp([
    '-f', 'b[format_note!*=watermark][vcodec!=none][acodec!=none]/bv*[format_note!*=watermark]+ba',
    '-S', 'vcodec:h264,res,ext:mp4:m4a',
    '--merge-output-format', 'mp4',
    '--write-info-json', '--no-simulate', '-O', 'after_move:%(id)s',
    '-o', salida, url
  ]).trim().split('\n').pop();
  const info = JSON.parse(readFileSync(join(TMP, `${id}.info.json`), 'utf8'));
  const archivo = join(TMP, `${id}.mp4`);
  if (!existsSync(archivo)) throw new Error(`No se encontró ${archivo} tras la descarga`);
  return { info, archivo };
}

function esMio(info) {
  const autores = [info.uploader, info.uploader_id, info.channel]
    .filter(Boolean).map(s => String(s).replace(/^@/, '').toLowerCase());
  return autores.includes(USUARIO);
}

function armarCaption(info) {
  const extra = (process.env.CAPTION_EXTRA || '').trim();
  const texto = [(info.description || info.title || '').trim(), extra].filter(Boolean).join('\n\n');
  return texto.slice(0, 2200); // límite de Instagram
}

async function api(metodo, ruta, params = {}) {
  const url = new URL(`https://${HOST}/${VER}/${ruta}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = metodo === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Graph API en ${ruta}: ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

async function esperarContenedor(id, maxMin = 10) {
  const limite = Date.now() + maxMin * 60_000;
  for (;;) {
    const r = await api('GET', id, { fields: 'status_code,status' });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new Error(`El contenedor terminó en ${r.status_code}: ${r.status || ''}`);
    }
    if (Date.now() > limite) throw new Error('Tiempo de espera agotado procesando el video.');
    console.log(`    procesando (${r.status_code})…`);
    await new Promise(ok => setTimeout(ok, 8000));
  }
}

// Subida reanudable: el archivo va directo a Meta, sin necesidad de URL pública.
async function publicarReel(archivo, caption) {
  const cont = await api('POST', `${IG_USER}/media`, {
    media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true'
  });
  const tam = statSync(archivo).size;
  const subida = await fetch(cont.uri || `https://rupload.facebook.com/ig-api-upload/${VER}/${cont.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${TOKEN}`, offset: '0', file_size: String(tam) },
    body: readFileSync(archivo)
  });
  if (!subida.ok) throw new Error(`Subida del video falló: ${subida.status} ${await subida.text()}`);
  await esperarContenedor(cont.id);
  const pub = await api('POST', `${IG_USER}/media_publish`, { creation_id: cont.id });
  let enlace = '';
  try { enlace = (await api('GET', pub.id, { fields: 'permalink' })).permalink || ''; } catch { /* informativo */ }
  return { id: pub.id, enlace };
}

// ---------------------------------------------------------------------------

let estado = leerEstado();
const primeraVez = estado === null;
estado ??= {};

const urlsManuales = (process.env.URLS || '').split(',').map(s => s.trim()).filter(Boolean);
let candidatos;
if (urlsManuales.length) {
  candidatos = urlsManuales.map(url => ({ id: url.match(/video\/(\d+)/)?.[1] || url, url }));
} else {
  console.log(`Revisando los últimos ${REVISAR} videos de @${USUARIO}…`);
  candidatos = videosRecientes();
  if (primeraVez && process.env.INCLUIR_ANTERIORES !== '1') {
    for (const c of candidatos) estado[c.id] = { omitido: 'ya existía al activar la automatización' };
    guardarEstado(estado);
    console.log(`Primera corrida: ${candidatos.length} videos existentes marcados como vistos.`);
    console.log('Desde ahora se publicará cada video nuevo que subas a TikTok.');
    process.exit(0);
  }
}

// Del más antiguo al más nuevo, para que el orden en Instagram sea el mismo.
const pendientes = candidatos.filter(c => !estado[c.id]).reverse().slice(0, MAX);
if (!pendientes.length) { console.log('No hay videos nuevos.'); process.exit(0); }

let fallos = 0;
for (const c of pendientes) {
  console.log(`\n▶ ${c.url}`);
  try {
    const { info, archivo } = descargar(c.url);
    if (!esMio(info)) {
      console.log(`  Omitido: el autor es @${info.uploader || info.uploader_id}, no @${USUARIO}.`);
      continue;
    }
    const caption = armarCaption(info);
    console.log(`  Descargado sin marca de agua (${(statSync(archivo).size / 1e6).toFixed(1)} MB)`);
    if (DRY) {
      console.log(`  [simulación] publicaría con caption:\n${caption.replace(/^/gm, '    ')}`);
      continue;
    }
    const pub = await publicarReel(archivo, caption);
    console.log(`  Publicado: ${pub.enlace || pub.id}`);
    estado[info.id] = { ig_media: pub.id, enlace: pub.enlace, fecha: new Date().toISOString() };
    guardarEstado(estado);
    rmSync(archivo, { force: true });
  } catch (err) {
    fallos++;
    console.error(`  Error: ${err.message}`);
  }
}
if (primeraVez) guardarEstado(estado);
process.exit(fallos ? 1 : 0);
