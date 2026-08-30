/**
 * Fuente de datos del generador: consultas de SOLO LECTURA a la BD de la plataforma (Neon).
 * Sin DATABASE_URL (o con --demo) usa cifras de ejemplo marcadas como demo, para poder
 * probar el flujo completo sin tocar la BD.
 *
 * ⚠️ TODO (sesión local): ajustar los nombres de tablas/columnas de CONSULTAS cuando
 * llegue el esquema real (pg_dump --schema-only). Cada consulta cae a su valor demo
 * si falla, con aviso en el log, así el lote nunca se cae por un nombre desactualizado.
 */
import pg from 'pg';

const CONSULTAS = {
  total_vets: "SELECT count(*)::int AS n FROM veterinarios WHERE verificado = true",
  total_comunas: "SELECT count(DISTINCT comuna)::int AS n FROM veterinarios WHERE verificado = true",
  reservas_mes: "SELECT count(*)::int AS n FROM reservas WHERE creado_en >= date_trunc('month', now())",
  feedback: "SELECT nota_rechazo FROM rrss_piezas WHERE estado = 'rechazada' AND nota_rechazo IS NOT NULL ORDER BY creado_en DESC LIMIT 5"
};

const DEMO = { total_vets: 100, total_comunas: 32, reservas_mes: 180 };

export async function obtenerDatos({ demo = false } = {}) {
  if (demo || !process.env.DATABASE_URL) {
    return { ...DEMO, feedback: [], esDemo: true };
  }
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  const datos = { esDemo: false, feedback: [] };
  try {
    for (const [clave, sql] of Object.entries(CONSULTAS)) {
      try {
        const r = await cliente.query(sql);
        if (clave === 'feedback') datos.feedback = r.rows.map(f => f.nota_rechazo);
        else datos[clave] = r.rows[0].n;
      } catch (e) {
        console.warn(`Consulta «${clave}» falló (${e.message}); usando valor demo. Ajustar en rrss/datos.mjs.`);
        if (clave !== 'feedback') { datos[clave] = DEMO[clave]; datos.esDemo = true; }
      }
    }
  } finally {
    await cliente.end();
  }
  return datos;
}

export async function insertarPieza(pieza, { lote, imagenUrl }) {
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  try {
    const r = await cliente.query(
      `INSERT INTO rrss_piezas (lote, tipo, formato, caption, visual, fecha_programada, imagen_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [lote, pieza.tipo, pieza.formato, pieza.caption, JSON.stringify(pieza.visual),
       `${pieza.fecha_propuesta}T${pieza.hora_propuesta}:00-04:00`, imagenUrl]
    );
    return r.rows[0].id;
  } finally {
    await cliente.end();
  }
}
