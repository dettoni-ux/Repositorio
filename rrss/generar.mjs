/**
 * Generador de lotes de piezas para @encuentravet.
 *
 * Estrategia: dar a conocer las herramientas de la plataforma, 80% dirigido a
 * veterinarios y 20% a tutores. Tipos: tip (imagen), hito (imagen) y video
 * (reel animado generado con IA — Seedance vía Replicate — en el mismo lote).
 *
 * Flujo: datos reales (Neon) → Claude (salidas estructuradas) → validación de largos
 * → render PNG / generación de video → cola de aprobación (rrss_piezas o cola-local.json).
 * Nada de lo que sale de aquí se publica: queda SIEMPRE en estado 'pendiente'.
 *
 * Uso:
 *   node generar.mjs [--demo] [--sin-api] [--tipos tip,hito,video] [--cantidad 5]
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
import { generarVideo, videoDisponible } from './video.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_PIEZAS = path.join(AQUI, '..', 'piezas');
const TIPOS_VALIDOS = ['tip', 'hito', 'video'];

/* ---------- argumentos ---------- */
const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const valor = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const DEMO = flag('demo');
const SIN_API = flag('sin-api');
const TIPOS = valor('tipos', 'tip,hito,video').split(',').map(s => s.trim()).filter(t => TIPOS_VALIDOS.includes(t));
const CANTIDAD = Math.min(8, Math.max(1, parseInt(valor('cantidad', '5'), 10) || 5));

/* ---------- esquema de pieza (validación local estricta, incl. largos) ---------- */
const Base = {
  fecha_propuesta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora_propuesta: z.string().regex(/^\d{2}:\d{2}$/),
  publico: z.enum(['veterinarios', 'tutores']),
  caption: z.string().max(1800)
};
const VisualSchema = z.object({
  etiqueta: z.string().max(30),
  titulo: z.string().max(90),
  destacado: z.string().max(12),
  lineas: z.array(z.string().max(110)).min(2).max(4),
  cierre: z.string().max(70)
});
const TipSchema = z.object({ ...Base, tipo: z.literal('tip'), formato: z.literal('post'), visual: VisualSchema });
const HitoSchema = z.object({ ...Base, tipo: z.literal('hito'), formato: z.literal('post'), visual: VisualSchema });
const VideoSchema = z.object({
  ...Base,
  tipo: z.literal('video'),
  formato: z.literal('reel'),
  video: z.object({
    prompt_ia: z.string().max(1600),
    duracion_s: z.number().int().min(5).max(10),
    escenas: z.array(z.object({
      tiempo: z.string().max(20),
      descripcion: z.string().max(220),
      texto_pantalla: z.string().max(90)
    })).min(1).max(4)
  })
});
const PiezaSchema = z.discriminatedUnion('tipo', [TipSchema, HitoSchema, VideoSchema]);
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

function repartoLote() {
  // 80% veterinarios / 20% tutores, y cuántas piezas de video van en el lote
  let paraVets = Math.max(1, Math.round(CANTIDAD * 0.8));
  if (CANTIDAD >= 2) paraVets = Math.min(paraVets, CANTIDAD - 1); // siempre al menos 1 para tutores
  const paraTutores = CANTIDAD - paraVets;
  const videos = TIPOS.includes('video') ? Math.min(CANTIDAD, Math.max(1, Math.round(CANTIDAD * 0.25))) : 0;
  return { paraVets, paraTutores, videos };
}

async function generarLote(datos) {
  const { paraVets, paraTutores, videos } = repartoLote();
  const feedback = datos.feedback.length
    ? '\n\nFEEDBACK DE PIEZAS RECHAZADAS (no repetir estos errores):\n' + datos.feedback.map(f => `- ${f}`).join('\n')
    : '';
  const mensaje = `${bloqueDatos(datos)}${feedback}

Genera un lote de ${CANTIDAD} piezas de los tipos permitidos: ${TIPOS.join(', ')}.
Reparto obligatorio del lote:
- ${paraVets} piezas con publico "veterinarios" y ${paraTutores} con publico "tutores".
${videos ? `- ${videos} de las piezas deben ser tipo "video" (el corto animado del falso veterinario, cada uno con una historia distinta).` : ''}
- El resto reparte entre los demás tipos permitidos, cada pieza sobre una herramienta distinta de la plataforma.
Distribuye las fechas propuestas en días distintos de la próxima semana.`;
  const piezas = (await llamarClaude(mensaje)).piezas.filter(p => TIPOS.includes(p.tipo));
  const vets = piezas.filter(p => p.publico === 'veterinarios').length;
  console.log(`Mezcla del lote: ${vets}/${piezas.length} para veterinarios.`);
  return piezas;
}

async function acortarPieza(pieza, desbordes) {
  const mensaje = `${JSON.stringify({ piezas: [pieza] })}\n\nEn la pieza anterior, estos campos del visual quedaron demasiado largos para la plantilla: ${desbordes.join(', ')}. Reescríbelos más cortos (mismo mensaje, menos caracteres; usa como máximo el 70% del largo actual en esos campos). Devuelve el lote con esa única pieza corregida, sin cambiar nada más.`;
  return (await llamarClaude(mensaje)).piezas[0];
}

/* ---------- piezas fijas para --sin-api ---------- */
function piezasEjemplo(datos) {
  return [
    {
      tipo: 'tip', formato: 'post', publico: 'veterinarios', fecha_propuesta: '2026-09-02', hora_propuesta: '09:30',
      caption: 'Colega: ¿cuántas horas de consulta perdiste esta semana contestando WhatsApp para agendar? 📵\n\nCon la agenda online de EncuentraVet los tutores reservan solos sobre tu disponibilidad real.\n\nCrea tu perfil gratis en encuentravet.cl\n\n#EncuentraVet #VeterinariosVerificados #MédicoVeterinario #VeterinariosChile',
      visual: {
        etiqueta: 'Para veterinarios',
        titulo: 'Tu agenda llena, tu teléfono en silencio',
        destacado: '0%',
        lineas: ['Los tutores reservan solos sobre tu disponibilidad real', 'Recordatorios automáticos: menos horas perdidas', '0% comisión: lo que cobras es tuyo'],
        cierre: 'Menos teléfono, más pacientes'
      }
    },
    {
      tipo: 'hito', formato: 'post', publico: 'veterinarios', fecha_propuesta: '2026-09-04', hora_propuesta: '18:30',
      caption: `Ya somos ${datos.total_vets}+ colegas con la insignia azul 💙\n\nVerificados uno a uno con Registro Civil y COLMEVET, atendiendo con agenda online en ${datos.total_comunas} comunas.\n\nCrea tu perfil gratis en encuentravet.cl\n\n#EncuentraVet #VeterinariosVerificados #VeterinariosChile`,
      visual: {
        etiqueta: 'Hito de la comunidad',
        titulo: 'colegas verificados con la insignia azul',
        destacado: `${datos.total_vets}+`,
        lineas: [`${datos.total_comunas} comunas de Chile`, 'Verificación Registro Civil + COLMEVET', '0% comisión, siempre'],
        cierre: 'Tu título vale: que nadie dude de ti'
      }
    },
    {
      tipo: 'video', formato: 'reel', publico: 'tutores', fecha_propuesta: '2026-09-06', hora_propuesta: '12:00',
      caption: 'Cualquiera puede ponerse una bata. 🥼\n\nLa insignia azul de EncuentraVet no se compra: se verifica con Registro Civil y COLMEVET, uno a uno.\n\nRegístrate gratis en encuentravet.cl\n\n#EncuentraVet #VeterinariosVerificados #MascotasChile #TutorResponsable',
      video: {
        prompt_ia: 'High-quality 3D cartoon animation, soft rounded characters, big expressive eyes, warm cinematic lighting, family-friendly, vertical 9:16. A fluffy cartoon cat sits in a waiting room chair holding a tiny purse. Scene 1 (0-4s): a suspicious rooster wearing an oversized white coat and a crayon-drawn diploma taped to the wall proudly opens a toy doctor kit; the cat raises one eyebrow. Scene 2 (4-7s): the cat looks at the wall, the crayon diploma slowly peels off and falls. Scene 3 (7-10s): a friendly capybara veterinarian with a glowing blue verification badge on the chest opens the next door and waves warmly; the cat walks over happily. Purple (#5B2E7E) and yellow (#FFD84D) accents in the room decor. No text overlays, no logos, no watermarks, realistic smooth animation.',
        duracion_s: 10,
        escenas: [
          { tiempo: '0-4 s', descripcion: 'El “doctor” gallo con bata gigante y diploma a crayón abre un maletín de juguete', texto_pantalla: '¿Tu “veterinario”… es veterinario?' },
          { tiempo: '4-7 s', descripcion: 'El diploma de crayón se despega de la pared', texto_pantalla: 'Cualquiera puede ponerse una bata' },
          { tiempo: '7-10 s', descripcion: 'Aparece la vet capibara con insignia azul brillante y recibe al gato', texto_pantalla: 'La insignia azul se verifica: Registro Civil + COLMEVET' }
        ]
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
const necesitaNavegador = piezas.some(p => p.tipo !== 'video');
const navegador = necesitaNavegador ? await abrirNavegador() : null;
const colaLocal = [];
try {
  for (let i = 0; i < piezas.length; i++) {
    let pieza = piezas[i];
    let archivo, nota = null;

    if (pieza.tipo === 'video') {
      archivo = `${lote}-${i + 1}-video.mp4`;
      if (videoDisponible()) {
        console.log(`  Pieza ${i + 1} (video): generando con IA (~1-3 min)…`);
        try {
          await generarVideo({ prompt: pieza.video.prompt_ia, duracion: pieza.video.duracion_s, salida: path.join(DIR_PIEZAS, archivo) });
        } catch (e) {
          nota = `Video no generado: ${e.message}. El prompt queda en la pieza para regenerar.`;
          console.warn(`  ${nota}`);
          archivo = null;
        }
      } else {
        nota = 'Video pendiente de generación: falta el secret REPLICATE_API_TOKEN. El prompt de IA está en la pieza.';
        console.warn(`  Pieza ${i + 1} (video): ${nota}`);
        archivo = null;
      }
    } else {
      archivo = `${lote}-${i + 1}-${pieza.tipo}.png`;
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
    }

    const rama = process.env.RAMA || 'main';
    const repo = process.env.GITHUB_REPOSITORY || 'dettoni-ux/Repositorio';
    const mediaUrl = archivo ? `https://raw.githubusercontent.com/${repo}/${rama}/piezas/${archivo}` : null;
    const visual = pieza.tipo === 'video' ? { ...pieza.video, nota } : pieza.visual;

    if (process.env.DATABASE_URL && !DEMO) {
      const id = await insertarPieza({ ...pieza, visual }, { lote, imagenUrl: mediaUrl });
      console.log(`  Pieza ${i + 1} (${pieza.tipo}/${pieza.publico}) → rrss_piezas id=${id}${archivo ? ' · ' + archivo : ''}`);
    } else {
      colaLocal.push({ ...pieza, visual, estado: 'pendiente', lote, imagen: archivo, imagen_url: mediaUrl, nota });
      console.log(`  Pieza ${i + 1} (${pieza.tipo}/${pieza.publico}) → cola local${archivo ? ' · ' + archivo : ''}`);
    }
  }
} finally {
  if (navegador) await navegador.close();
}

if (colaLocal.length) {
  const rutaCola = path.join(DIR_PIEZAS, 'cola-local.json');
  const previa = existsSync(rutaCola) ? JSON.parse(readFileSync(rutaCola, 'utf8')) : [];
  writeFileSync(rutaCola, JSON.stringify([...previa, ...colaLocal], null, 2));
  console.log(`Cola local actualizada: ${rutaCola}`);
}
console.log('Lote terminado. Nada se publica sin aprobación en el panel.');
