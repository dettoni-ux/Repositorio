#!/usr/bin/env node
/**
 * Publica contenido en Instagram vía Graph API (cuenta profesional Business).
 * Flujo oficial de dos pasos: crear contenedor de media → media_publish.
 *
 * Variables de entorno requeridas (definir como GitHub Secrets):
 *   IG_USER_ID       ID numérico de la cuenta profesional de Instagram
 *   IG_ACCESS_TOKEN  Token de acceso de larga duración con permisos de publicación
 * Opcionales:
 *   GRAPH_HOST       graph.instagram.com (API con login de Instagram, por defecto)
 *                    o graph.facebook.com (vía página de Facebook vinculada)
 *   GRAPH_VERSION    versión de la API (por defecto v23.0)
 *
 * Parámetros (variables de entorno definidas por el workflow):
 *   TIPO             imagen | carrusel | reel | historia_imagen | historia_video
 *   MEDIA            URLs públicas separadas por comas, o rutas dentro del repo
 *                    (las rutas se convierten a URL raw de GitHub automáticamente)
 *   CAPTION          texto del post (ignorado en historias)
 *   CAPTION_ARCHIVO  ruta a un .txt en el repo con el caption (tiene prioridad)
 */
import { readFileSync } from 'node:fs';

const HOST = process.env.GRAPH_HOST || 'graph.instagram.com';
const VER = process.env.GRAPH_VERSION || 'v23.0';
const IG_USER = requerido('IG_USER_ID');
const TOKEN = requerido('IG_ACCESS_TOKEN');
const TIPO = (process.env.TIPO || 'imagen').trim();

function requerido(nombre) {
  const v = process.env[nombre];
  if (!v || !v.trim()) {
    console.error(`Falta la variable ${nombre}. Defínela como secret del repositorio.`);
    process.exit(1);
  }
  return v.trim();
}

function urlPublica(entrada) {
  const m = entrada.trim();
  if (/^https?:\/\//i.test(m)) return m;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA || 'main';
  if (!repo) {
    console.error(`"${m}" no es una URL y no estamos en GitHub Actions para convertirla en URL raw.`);
    process.exit(1);
  }
  return `https://raw.githubusercontent.com/${repo}/${sha}/${m.split('/').map(encodeURIComponent).join('/')}`;
}

async function api(metodo, ruta, params) {
  const url = new URL(`https://${HOST}/${VER}/${ruta}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = metodo === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    console.error(`Error de la Graph API en ${ruta}:`);
    console.error(JSON.stringify(json.error || json, null, 2));
    process.exit(1);
  }
  return json;
}

async function esperarContenedor(id, maxMin = 8) {
  const limite = Date.now() + maxMin * 60_000;
  for (;;) {
    const r = await api('GET', id, { fields: 'status_code,status' });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      console.error(`El contenedor terminó en estado ${r.status_code}: ${r.status || ''}`);
      process.exit(1);
    }
    if (Date.now() > limite) {
      console.error('Tiempo de espera agotado procesando el video.');
      process.exit(1);
    }
    console.log(`  Procesando (${r.status_code})…`);
    await new Promise(r2 => setTimeout(r2, 6000));
  }
}

function avisoJpeg(url) {
  if (/\.png(\?|$)/i.test(url)) {
    console.warn(`AVISO: ${url} parece PNG. La API de Instagram solo acepta imágenes JPEG.`);
    console.warn('Usa el botón «Descargar JPG» del Estudio de Contenido.');
  }
}

const medios = (process.env.MEDIA || '').split(',').map(s => s.trim()).filter(Boolean).map(urlPublica);
let caption = process.env.CAPTION || '';
if (process.env.CAPTION_ARCHIVO && process.env.CAPTION_ARCHIVO.trim()) {
  caption = readFileSync(process.env.CAPTION_ARCHIVO.trim(), 'utf8');
}

if (!medios.length) { console.error('Falta MEDIA: al menos una URL o ruta.'); process.exit(1); }

console.log(`Publicando tipo=${TIPO} en la cuenta ${IG_USER} vía ${HOST} ${VER}`);
medios.forEach(m => console.log('  media: ' + m));

let contenedor;
if (TIPO === 'imagen') {
  avisoJpeg(medios[0]);
  contenedor = (await api('POST', `${IG_USER}/media`, { image_url: medios[0], caption })).id;
} else if (TIPO === 'historia_imagen') {
  avisoJpeg(medios[0]);
  contenedor = (await api('POST', `${IG_USER}/media`, { image_url: medios[0], media_type: 'STORIES' })).id;
} else if (TIPO === 'historia_video') {
  contenedor = (await api('POST', `${IG_USER}/media`, { video_url: medios[0], media_type: 'STORIES' })).id;
  await esperarContenedor(contenedor);
} else if (TIPO === 'reel') {
  contenedor = (await api('POST', `${IG_USER}/media`, { video_url: medios[0], media_type: 'REELS', caption })).id;
  await esperarContenedor(contenedor);
} else if (TIPO === 'carrusel') {
  if (medios.length < 2 || medios.length > 10) {
    console.error('Un carrusel necesita entre 2 y 10 imágenes.');
    process.exit(1);
  }
  const hijos = [];
  for (const m of medios) {
    avisoJpeg(m);
    hijos.push((await api('POST', `${IG_USER}/media`, { image_url: m, is_carousel_item: 'true' })).id);
    console.log(`  contenedor hijo creado (${hijos.length}/${medios.length})`);
  }
  contenedor = (await api('POST', `${IG_USER}/media`, {
    media_type: 'CAROUSEL', children: hijos.join(','), caption
  })).id;
} else {
  console.error(`Tipo desconocido: ${TIPO}`);
  process.exit(1);
}

console.log('Contenedor listo: ' + contenedor);
const pub = await api('POST', `${IG_USER}/media_publish`, { creation_id: contenedor });
console.log('Publicado. ID del media: ' + pub.id);
try {
  const det = await api('GET', pub.id, { fields: 'permalink' });
  console.log('Enlace: ' + (det.permalink || '(no disponible)'));
} catch { /* el permalink es informativo */ }
