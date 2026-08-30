/**
 * Publicador automático: toma las piezas APROBADAS cuya fecha ya llegó y las publica
 * en Instagram vía Graph API. Nunca toca piezas en otro estado.
 *
 * Variables de entorno:
 *   DATABASE_URL, IG_USER_ID, IG_ACCESS_TOKEN
 *   GRAPH_HOST (opcional: graph.instagram.com por defecto), GRAPH_VERSION (v23.0)
 *   DRY_RUN=1 → muestra qué publicaría sin llamar a la API ni escribir en la BD
 */
import pg from 'pg';

const HOST = process.env.GRAPH_HOST || 'graph.instagram.com';
const VER = process.env.GRAPH_VERSION || 'v23.0';
const SECO = process.env.DRY_RUN === '1';
const MAX_INTENTOS = 3;

function requerido(n) {
  const v = process.env[n];
  if (!v && !SECO) { console.error(`Falta ${n}`); process.exit(1); }
  return v;
}
const IG_USER = requerido('IG_USER_ID');
const TOKEN = requerido('IG_ACCESS_TOKEN');

async function api(metodo, ruta, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const url = `https://${HOST}/${VER}/${ruta}`;
  const res = metodo === 'GET' ? await fetch(`${url}?${body}`) : await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Graph API ${ruta}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
  }
  return json;
}

async function esperarContenedor(id, maxMin = 8) {
  const limite = Date.now() + maxMin * 60_000;
  for (;;) {
    const r = await api('GET', id, { fields: 'status_code,status' });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new Error(`Contenedor en estado ${r.status_code}: ${r.status || ''}`);
    }
    if (Date.now() > limite) throw new Error('Tiempo de espera agotado procesando el video');
    await new Promise(r2 => setTimeout(r2, 6000));
  }
}

async function publicarPieza(p) {
  if (!p.imagen_url) throw new Error('La pieza no tiene archivo generado');
  let contenedor;
  if (p.formato === 'reel') {
    contenedor = (await api('POST', `${IG_USER}/media`, {
      video_url: p.imagen_url, media_type: 'REELS', caption: p.caption
    })).id;
    await esperarContenedor(contenedor);
  } else {
    if (/\.png(\?|$)/i.test(p.imagen_url)) throw new Error('Instagram solo acepta JPEG: regenerar la imagen en .jpg');
    contenedor = (await api('POST', `${IG_USER}/media`, { image_url: p.imagen_url, caption: p.caption })).id;
  }
  const pub = await api('POST', `${IG_USER}/media_publish`, { creation_id: contenedor });
  return pub.id;
}

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();
try {
  const { rows } = await cliente.query(
    `SELECT * FROM rrss_piezas
      WHERE estado = 'aprobada'
        AND fecha_programada IS NOT NULL
        AND fecha_programada <= now()
        AND intentos_publicacion < $1
      ORDER BY fecha_programada
      LIMIT 5`, [MAX_INTENTOS]);

  if (!rows.length) { console.log('No hay piezas aprobadas con fecha vencida.'); process.exit(0); }
  console.log(`${rows.length} pieza(s) por publicar${SECO ? ' (simulación)' : ''}.`);

  for (const p of rows) {
    console.log(`— Pieza ${p.id} (${p.tipo}/${p.formato}) programada ${p.fecha_programada.toISOString()}`);
    if (SECO) { console.log(`  Simulación: se publicaría ${p.imagen_url}`); continue; }
    try {
      const mediaId = await publicarPieza(p);
      await cliente.query(
        `UPDATE rrss_piezas SET estado = 'publicada', publicado_en = now(), ig_media_id = $2, error_publicacion = NULL WHERE id = $1`,
        [p.id, mediaId]);
      console.log(`  Publicada ✓ media ${mediaId}`);
    } catch (e) {
      const intentos = p.intentos_publicacion + 1;
      const agotado = intentos >= MAX_INTENTOS;
      await cliente.query(
        `UPDATE rrss_piezas SET intentos_publicacion = $2, error_publicacion = $3, estado = $4 WHERE id = $1`,
        [p.id, intentos, e.message.slice(0, 500), agotado ? 'fallida' : 'aprobada']);
      console.error(`  Error (intento ${intentos}/${MAX_INTENTOS}): ${e.message}`);
      if (agotado) console.error('  Marcada como fallida; queda visible en el panel.');
    }
  }
} finally {
  await cliente.end();
}
