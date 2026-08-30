/**
 * API de la cola de aprobación — función serverless de Vercel.
 * Copiar a sitio/api/rrss-piezas.js en el proyecto de la plataforma.
 *
 * Requiere la variable de entorno DATABASE_URL (la misma de la plataforma).
 * Protegida por la sesión de admin existente: ajustar `verificarAdmin`.
 *
 * GET  ?estado=pendiente      → lista de piezas
 * POST { id, accion, ... }    → aprobar | rechazar | reprogramar | editar
 */
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs' };

// TODO (sesión local): reemplazar por la verificación de sesión de admin del /panel.
async function verificarAdmin(req) {
  return Boolean(req.headers.cookie && req.headers.cookie.includes('sesion_admin='));
}

export default async function handler(req, res) {
  if (!(await verificarAdmin(req))) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const estado = req.query.estado || 'pendiente';
    // El driver HTTP de Neon no compone consultas anidadas: una consulta plana por rama.
    const filas = estado === 'todas'
      ? await sql`SELECT * FROM rrss_piezas ORDER BY fecha_programada NULLS LAST, creado_en DESC LIMIT 100`
      : await sql`SELECT * FROM rrss_piezas WHERE estado = ${estado} ORDER BY fecha_programada NULLS LAST, creado_en DESC LIMIT 100`;
    return res.status(200).json({ piezas: filas });
  }

  if (req.method === 'POST') {
    const { id, accion, caption, fecha, nota } = req.body || {};
    if (!id || !accion) return res.status(400).json({ error: 'Faltan id o accion' });

    if (accion === 'aprobar') {
      await sql`UPDATE rrss_piezas SET estado = 'aprobada' WHERE id = ${id} AND estado = 'pendiente'`;
    } else if (accion === 'rechazar') {
      await sql`UPDATE rrss_piezas SET estado = 'rechazada', nota_rechazo = ${nota || null} WHERE id = ${id}`;
    } else if (accion === 'reprogramar') {
      await sql`UPDATE rrss_piezas SET fecha_programada = ${fecha}, editado_en = now() WHERE id = ${id}`;
    } else if (accion === 'editar') {
      await sql`UPDATE rrss_piezas SET caption = ${caption}, editado_en = now() WHERE id = ${id}`;
    } else {
      return res.status(400).json({ error: 'Acción desconocida' });
    }
    const [pieza] = await sql`SELECT * FROM rrss_piezas WHERE id = ${id}`;
    return res.status(200).json({ pieza });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Método no permitido' });
}
