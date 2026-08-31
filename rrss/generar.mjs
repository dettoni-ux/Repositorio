/**
 * Generador de lotes de piezas para @encuentravet.
 *
 * Estrategia: dar a conocer las herramientas de la plataforma, 80% dirigido a
 * veterinarios y 20% a tutores. Tipos: tip (imagen), hito (imagen) y video
 * (cortometraje). El video tiene dos motores: «animacion» (personajes vectoriales
 * propios: gratis, ilimitado y con personajes idénticos entre escenas) e «ia»
 * (Seedance vía Replicate, requiere saldo).
 *
 * Flujo: datos reales (Neon) → Claude (salidas estructuradas) → validación de largos
 * → render PNG / generación de video → cola de aprobación (rrss_piezas o cola-local.json).
 * Nada de lo que sale de aquí se publica: queda SIEMPRE en estado 'pendiente'.
 *
 * Uso:
 *   node generar.mjs [--demo] [--sin-api] [--tipos tip,hito,video] [--cantidad 5]
 *                     [--motor animacion|ia]
 *
 * --demo    no toca la BD (cifras de ejemplo, cola local)
 * --sin-api no llama a Claude (piezas fijas de ejemplo; para probar plantillas/render)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { obtenerDatos, insertarPieza } from './datos.mjs';
import { abrirNavegador, renderPieza } from './render.mjs';
import { generarCortometraje, videoDisponible } from './video.mjs';
import { animarCorto } from './animar.mjs';
import { generarVoz, mezclarVideoYVoz, vozDisponible } from './voz.mjs';

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
// Motor de video: 'animacion' (propio, gratis) o 'ia' (Seedance vía Replicate).
const MOTOR = valor('motor', 'animacion') === 'ia' ? 'ia' : 'animacion';
// Tope de escenas del cortometraje: cada escena con IA cuesta USD 2-3.
const MAX_ESCENAS = Math.min(3, Math.max(1, parseInt(valor('max-escenas', '2'), 10) || 2));

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
    // Cortometraje animado por el propio sistema: gratis, personajes siempre idénticos.
    actos: z.array(z.object({
      escena: z.enum(['espera', 'impostor', 'verificada']),
      dur: z.number().int().min(4).max(9),
      texto: z.string().max(90)
    })).min(2).max(3),
    cierre: z.string().max(60),
    // Alternativa con IA de video (requiere saldo en Replicate).
    escenas_ia: z.array(z.object({
      prompt_ia: z.string().max(1600),
      duracion_s: z.number().int().min(5).max(10)
    })).min(1).max(3),
    narracion: z.string().max(700),
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

/**
 * Los topes de largo de las listas no los garantiza la decodificación, así que
 * una escena de más botaba el lote entero. Se recortan antes de validar: sobrar
 * ideas no es un error, es material que no cabe.
 */
const TOPES = { actos: 3, escenas_ia: 3, escenas: 4 };
function podar(lote) {
  if (Array.isArray(lote?.piezas)) {
    if (lote.piezas.length > 8) lote.piezas = lote.piezas.slice(0, 8);
    for (const pieza of lote.piezas) {
      for (const [campo, tope] of Object.entries(TOPES)) {
        const lista = pieza?.video?.[campo];
        if (Array.isArray(lista) && lista.length > tope) {
          console.log(`  Se recortan ${lista.length} → ${tope} en «${campo}» (el guion trajo de más).`);
          pieza.video[campo] = lista.slice(0, tope);
        }
      }
    }
  }
  return lote;
}

async function llamarClaude(mensaje, correccion) {
  const contenido = correccion ? `${mensaje}\n\nCORRIGE ESTO DEL INTENTO ANTERIOR:\n${correccion}` : mensaje;
  const respuesta = await cliente.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    system: IDENTIDAD,
    output_config: { format: zodOutputFormat(LoteSchema) },
    messages: [{ role: 'user', content: contenido }]
  });
  if (respuesta.stop_reason === 'refusal') {
    throw new Error(`La API rechazó la solicitud: ${respuesta.stop_details?.explanation || 'sin detalle'}`);
  }
  if (respuesta.stop_reason === 'max_tokens') {
    throw new Error('Respuesta truncada por max_tokens; reintentar con menos piezas.');
  }
  const texto = respuesta.content.find(b => b.type === 'text')?.text;
  if (!texto) throw new Error('La respuesta no trajo contenido de texto.');

  const crudo = podar(JSON.parse(texto));
  const r = LoteSchema.safeParse(crudo);
  if (r.success) return r.data;

  // Un solo reintento diciendo exactamente qué campo quedó fuera de norma.
  const detalle = r.error.issues.map(i => `- ${i.path.join('.')}: ${i.message}`).join('\n');
  if (correccion) throw new Error(`El lote no cumple el formato tras reintentar:\n${detalle}`);
  console.log(`  El lote no cumplió el formato; se reintenta indicando el problema:\n${detalle}`);
  return llamarClaude(mensaje, detalle);
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
        actos: [
          { escena:'espera', dur:6, texto:'Tu mascota no puede preguntar por el título.' },
          { escena:'impostor', dur:8, texto:'Cualquiera puede ponerse una bata blanca.' },
          { escena:'verificada', dur:7, texto:'La insignia azul se verifica: Registro Civil y COLMEVET.' }
        ],
        cierre: 'Busca la insignia azul',
        escenas_ia: [
          { prompt_ia: 'High-quality 3D cartoon animation, soft rounded characters, big expressive eyes, warm cinematic lighting, family-friendly, vertical 9:16. A fluffy grey cartoon cat with round amber eyes and a small red collar sits patiently on a waiting room chair, holding a tiny purse. The waiting room has purple (#5B2E7E) walls and yellow (#FFD84D) chairs. No text overlays, no logos, no watermarks.', duracion_s: 8 },
          { prompt_ia: 'High-quality 3D cartoon animation, soft rounded characters, big expressive eyes, warm cinematic lighting, family-friendly, vertical 9:16. A scruffy rooster wearing a white coat three sizes too big proudly opens a plastic toy doctor kit; behind him a diploma drawn in crayon is taped crookedly to the purple (#5B2E7E) wall and slowly peels off. The same fluffy grey cartoon cat with round amber eyes and a small red collar raises one eyebrow, unimpressed. No text overlays, no logos, no watermarks.', duracion_s: 8 },
          { prompt_ia: 'High-quality 3D cartoon animation, soft rounded characters, big expressive eyes, warm cinematic lighting, family-friendly, vertical 9:16. A friendly capybara veterinarian in a clean fitted white coat, with a glowing blue verification badge on the chest, opens a door and waves warmly. The same fluffy grey cartoon cat with round amber eyes and a small red collar trots over happily. Purple (#5B2E7E) and yellow (#FFD84D) accents in the clinic decor. No text overlays, no logos, no watermarks.', duracion_s: 8 }
        ],
        narracion: 'Cualquiera puede ponerse una bata. Pero el título no se improvisa. En EncuentraVet verificamos a cada veterinario, uno por uno. Búscalo en encuentravet punto cl.',
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
      const conIA = MOTOR === 'ia' && videoDisponible();
      if (conIA || MOTOR === 'animacion') {
        const mudo = path.join(DIR_PIEZAS, `.mudo-${i + 1}.mp4`);
        try {
          if (conIA) {
            const escenasIA = pieza.video.escenas_ia.slice(0, MAX_ESCENAS);
            const n = escenasIA.length;
            console.log(`  Pieza ${i + 1} (cortometraje de ${n} escena${n>1?'s':''}): generando con IA…`);
            await generarCortometraje({
              escenas: escenasIA, salida: mudo,
              alAvanzar: (k, t) => console.log(`    escena ${k + 1} de ${t}…`)
            });
          } else {
            console.log(`  Pieza ${i + 1} (cortometraje animado, sin costo): dibujando…`);
            await animarCorto({
              historia: { actos: pieza.video.actos, cierre: pieza.video.cierre },
              marca: { c1: '#5B2E7E', c2: '#FFD84D', azul: '#1E9BE0', nombre: 'EncuentraVet', web: 'encuentravet.cl' },
              salida: mudo,
              alAvanzar: p => { if (Math.round(p*100) % 25 === 0) console.log(`    ${(p*100).toFixed(0)}%`); }
            });
          }
          if (vozDisponible()) {
            console.log('  Generando voz en off con ElevenLabs y montándola sobre el video…');
            const voz = path.join(DIR_PIEZAS, `.voz-${i + 1}.mp3`);
            try {
              await generarVoz({ texto: pieza.video.narracion, salida: voz });
              await mezclarVideoYVoz({ video: mudo, audio: voz, salida: path.join(DIR_PIEZAS, archivo) });
            } catch (e) {
              nota = `Video generado sin voz en off (${e.message}).`;
              console.warn(`  ${nota}`);
              renameSync(mudo, path.join(DIR_PIEZAS, archivo));
            } finally {
              if (existsSync(voz)) unlinkSync(voz);
            }
          } else {
            nota = 'Video sin voz en off: falta el secret ELEVENLABS_API_KEY. La narración está en la pieza.';
            console.warn(`  ${nota}`);
            renameSync(mudo, path.join(DIR_PIEZAS, archivo));
          }
        } catch (e) {
          nota = `Video no generado: ${e.message}. El prompt queda en la pieza para regenerar.`;
          console.warn(`  ${nota}`);
          archivo = null;
        } finally {
          if (existsSync(mudo)) unlinkSync(mudo);
        }
      } else {
        nota = 'Video pendiente: el motor «ia» necesita saldo en Replicate. Usa el motor «animacion» para generarlo sin costo.';
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
