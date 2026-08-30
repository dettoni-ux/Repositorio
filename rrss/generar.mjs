/**
 * Generador de lotes de piezas para @encuentravet.
 *
 * Flujo: datos reales (Neon) → Claude (salidas estructuradas) → validación de largos
 * → render a PNG (plantillas fijas) → cola de aprobación (tabla rrss_piezas o cola-local.json).
 * Nada de lo que sale de aquí se publica: queda SIEMPRE en estado 'pendiente'.
 *
 * Uso:
 *   node generar.mjs [--demo] [--sin-api] [--tipos tip,hito] [--cantidad 4]
 *
 * --demo    no toca la BD (cifras de ejemplo, cola local)
 * --sin-api no llama a Claude (piezas fijas de ejemplo; para probar plantillas/render)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { obtenerDatos, insertarPieza } from './datos.mjs';
import { abrirNavegador, renderPieza } from './render.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_PIEZAS = path.join(AQUI, '..', 'piezas');

/* ---------- argumentos ---------- */
const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const valor = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const DEMO = flag('demo');
const SIN_API = flag('sin-api');
const TIPOS = valor('tipos', 'tip,hito').split(',').map(s => s.trim()).filter(t => ['tip', 'hito'].includes(t));
const CANTIDAD = Math.min(8, Math.max(1, parseInt(valor('cantidad', '4'), 10) || 4));

/* ---------- esquema de pieza (validación local estricta, incl. largos) ---------- */
const VisualSchema = z.object({
  etiqueta: z.string().max(30),
  titulo: z.string().max(90),
  destacado: z.string().max(12),
  lineas: z.array(z.string().max(110)).min(2).max(4),
  cierre: z.string().max(70)
});
const PiezaSchema = z.object({
  tipo: z.enum(['tip', 'hito']),
  formato: z.literal('post'),
  fecha_propuesta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora_propuesta: z.string().regex(/^\d{2}:\d{2}$/),
  caption: z.string().max(1800),
  visual: VisualSchema
});
const LoteSchema = z.object({ piezas: z.array(PiezaSchema).min(1).max(8) });

/* ---------- generación con Claude ---------- */
const cliente = SIN_API ? null : new Anthropic();
const IDENTIDAD = readFileSync(path.join(AQUI, 'identidad.md'), 'utf8');

async function llamarClaude(mensaje) {
  const respuesta = await cliente.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    system: IDENTIDAD,
    output_config: { format: zodOutputFormat(LoteSchema) },
    messages: [{ role: 'user', content: mensaje }]
  });
  if (respuesta.stop_reason === 'refusal') {
    throw new Error(`La API rechazó la solicitud: ${respuesta.stop_details?.explanation || 'sin detalle'}`);
  }
  if (respuesta.stop_reason === 'max_tokens') {
    throw new Error('Respuesta truncada por max_tokens; reintentar con menos piezas.');
  }
  const texto = respuesta.content.find(b => b.type === 'text')?.text;
  if (!texto) throw new Error('La respuesta no trajo contenido de texto.');
  return LoteSchema.parse(JSON.parse(texto));
}

function bloqueDatos(datos) {
  return [
    'DATOS REALES (únicas cifras que puedes usar):',
    `- Veterinarios verificados: ${datos.total_vets}`,
    `- Comunas con vets verificados: ${datos.total_comunas}`,
    `- Reservas este mes: ${datos.reservas_mes}`,
    datos.esDemo ? '- (OJO: cifras de ambiente de prueba)' : '',
    `- Fecha de hoy: ${new Date().toISOString().slice(0, 10)}`
  ].filter(Boolean).join('\n');
}

async function generarLote(datos) {
  const porTipo = TIPOS.map(t => `«${t}»`).join(' y ');
  const feedback = datos.feedback.length
    ? '\n\nFEEDBACK DE PIEZAS RECHAZADAS (no repetir estos errores):\n' + datos.feedback.map(f => `- ${f}`).join('\n')
    : '';
  const mensaje = `${bloqueDatos(datos)}${feedback}\n\nGenera un lote de ${CANTIDAD} piezas variadas de los tipos ${porTipo} (mezcla ambos tipos). Temas distintos entre sí y distintos de lo obvio. Distribuye las fechas propuestas en días distintos de la próxima semana.`;
  return (await llamarClaude(mensaje)).piezas.filter(p => TIPOS.includes(p.tipo));
}

async function acortarPieza(pieza, desbordes) {
  const mensaje = `${JSON.stringify({ piezas: [pieza] })}\n\nEn la pieza anterior, estos campos del visual quedaron demasiado largos para la plantilla: ${desbordes.join(', ')}. Reescríbelos más cortos (mismo mensaje, menos caracteres; usa como máximo el 70% del largo actual en esos campos). Devuelve el lote con esa única pieza corregida, sin cambiar nada más.`;
  return (await llamarClaude(mensaje)).piezas[0];
}

/* ---------- piezas fijas para --sin-api ---------- */
function piezasEjemplo(datos) {
  return [
    {
      tipo: 'tip', formato: 'post', fecha_propuesta: '2026-09-02', hora_propuesta: '11:30',
      caption: '¿Sabías que la mayoría de las urgencias de fin de semana se pueden evitar con un control a tiempo? 🐾\n\nGuarda estas señales y compártelas con otro tutor.\n\nRegístrate gratis en encuentravet.cl\n\n#EncuentraVet #MascotasChile #TutorResponsable #VeterinariosVerificados #SaludAnimal',
      visual: {
        etiqueta: 'Tip EncuentraVet',
        titulo: '3 señales de que tu gato necesita un vet (y no son obvias)',
        destacado: '3',
        lineas: ['Duerme más de lo normal y evita su lugar favorito', 'Dejó de acicalarse o se limpia en exceso', 'Cambios en el arenero: siempre son una señal'],
        cierre: 'Ante la duda, tu vet verificado responde'
      }
    },
    {
      tipo: 'hito', formato: 'post', fecha_propuesta: '2026-09-04', hora_propuesta: '18:30',
      caption: `Esto no lo logramos nosotros: lo lograron ustedes 💜\n\nYa somos ${datos.total_vets}+ veterinarios verificados en ${datos.total_comunas} comunas de Chile, todos validados uno a uno con Registro Civil y COLMEVET.\n\nRegístrate gratis en encuentravet.cl\n\n#EncuentraVet #MascotasChile #TutorResponsable #VeterinariosVerificados`,
      visual: {
        etiqueta: 'Hito de la comunidad',
        titulo: 'veterinarios verificados uno a uno, y contando',
        destacado: `${datos.total_vets}+`,
        lineas: [`${datos.total_comunas} comunas de Chile`, 'Verificación Registro Civil + COLMEVET', '0% comisión, siempre'],
        cierre: 'Gracias por confiar en la insignia azul'
      }
    }
  ].filter(p => TIPOS.includes(p.tipo));
}

/* ---------- principal ---------- */
const lote = `lote-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
const datos = await obtenerDatos({ demo: DEMO });
console.log(`Lote ${lote} · datos: vets=${datos.total_vets} comunas=${datos.total_comunas} reservas_mes=${datos.reservas_mes}${datos.esDemo ? ' (demo)' : ''}`);

let piezas = SIN_API ? piezasEjemplo(datos) : await generarLote(datos);
console.log(`${piezas.length} piezas generadas.`);

mkdirSync(DIR_PIEZAS, { recursive: true });
const navegador = await abrirNavegador();
const colaLocal = [];
try {
  for (let i = 0; i < piezas.length; i++) {
    let pieza = piezas[i];
    const archivo = `${lote}-${i + 1}-${pieza.tipo}.png`;
    const ruta = path.join(DIR_PIEZAS, archivo);
    let { desbordes } = await renderPieza(navegador, pieza, ruta);
    if (desbordes.length && !SIN_API) {
      console.log(`  Pieza ${i + 1}: texto largo en [${desbordes}], pidiendo versión corta…`);
      try {
        pieza = await acortarPieza(pieza, desbordes);
        ({ desbordes } = await renderPieza(navegador, pieza, ruta));
      } catch (e) { console.warn(`  No se pudo acortar (${e.message}); la plantilla recorta con seguridad.`); }
    }
    if (desbordes.length) console.warn(`  Pieza ${i + 1}: aún larga en [${desbordes}] (recortada por CSS).`);

    const rama = process.env.RAMA || 'main';
    const repo = process.env.GITHUB_REPOSITORY || 'dettoni-ux/Repositorio';
    const imagenUrl = `https://raw.githubusercontent.com/${repo}/${rama}/piezas/${archivo}`;
    if (process.env.DATABASE_URL && !DEMO) {
      const id = await insertarPieza(pieza, { lote, imagenUrl });
      console.log(`  Pieza ${i + 1} (${pieza.tipo}) → rrss_piezas id=${id} · ${archivo}`);
    } else {
      colaLocal.push({ ...pieza, estado: 'pendiente', lote, imagen: archivo, imagen_url: imagenUrl });
      console.log(`  Pieza ${i + 1} (${pieza.tipo}) → cola local · ${archivo}`);
    }
  }
} finally {
  await navegador.close();
}

if (colaLocal.length) {
  const rutaCola = path.join(DIR_PIEZAS, 'cola-local.json');
  const previa = existsSync(rutaCola) ? JSON.parse(readFileSync(rutaCola, 'utf8')) : [];
  writeFileSync(rutaCola, JSON.stringify([...previa, ...colaLocal], null, 2));
  console.log(`Cola local actualizada: ${rutaCola}`);
}
console.log('Lote terminado. Nada se publica sin aprobación en el panel.');
