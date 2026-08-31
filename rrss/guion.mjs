/**
 * Guion escrito a mano (guion.json): tiempos, voz y texto en pantalla.
 *
 * Cuando existe y tiene «usar»: true, manda por sobre lo que escriba el
 * generador. Cada tramo produce su propio audio y se coloca exacto en su
 * segundo de inicio, de modo que la voz calce con lo que se ve.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Devuelve el guion propio, o null si no hay o está desactivado. */
export function leerGuion() {
  const ruta = path.join(AQUI, 'guion.json');
  if (!existsSync(ruta)) return null;
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    console.log(`  Aviso: guion.json no se pudo leer (${e.message}). Se usa el guion automático.`);
    return null;
  }
  if (cfg.usar === false) return null;
  const tramos = (cfg.tramos || []).filter(t => Number.isFinite(t.desde) && Number.isFinite(t.hasta) && t.hasta > t.desde);
  if (!tramos.length) return null;
  tramos.sort((a, b) => a.desde - b.desde);
  const guion = { ...cfg, tramos, total: tramos[tramos.length - 1].hasta };
  revisarTiempos(guion);
  return guion;
}

/* Se habla a unas 2,1 palabras por segundo dejando aire; más rápido suena apurado. */
const PALABRAS_POR_SEG = 2.1;

/**
 * Avisa ANTES de gastar créditos si una frase no cabe en su ventana. Antes esto
 * se descubría al final, con el video ya pagado y la voz atropellada.
 */
export function revisarTiempos(guion) {
  const problemas = [];
  for (const [i, t] of guion.tramos.entries()) {
    if (!t.voz) continue;
    const ventana = t.hasta - t.desde;
    const palabras = t.voz.trim().split(/\s+/).length;
    const caben = Math.floor(ventana * PALABRAS_POR_SEG);
    if (palabras > caben) {
      problemas.push(`  Tramo ${i + 1} (${ventana}s): ${palabras} palabras, caben ${caben}. `
        + `Sobran ${palabras - caben}: la voz va a sonar apurada.`);
    }
  }
  if (problemas.length) {
    console.log('AVISO del guion — la locución no cabe en su tramo:');
    problemas.forEach(p => console.log(p));
  } else {
    console.log('Guion revisado: la locución cabe en todos los tramos.');
  }
  return problemas;
}

/** Reemplaza {mascota}, {impostor}, … por su descripción del reparto. */
function conReparto(texto, reparto) {
  if (!texto || !reparto) return texto;
  return texto.replace(/\{(\w+)\}/g, (todo, clave) => reparto[clave] || todo);
}

/**
 * Escenas para la IA de video, con la duración EXACTA que pide el guion.
 * Si el tramo trae su propio «prompt», ese manda: el guion lo escribió una
 * persona y sabe qué quiere ver. Se le antepone el estilo y se le agrega la
 * cola común para que todas las escenas se vean del mismo mundo.
 */
export function escenasSegunGuion(guion, escenasIA) {
  const conEscena = guion.tramos.filter(t => !t.cierre);
  return conEscena.map((t, i) => {
    const propio = t.prompt && t.prompt.trim();
    const fuente = escenasIA?.[Math.min(i, (escenasIA?.length || 1) - 1)];
    const prompt_ia = propio
      ? [guion.estilo, conReparto(t.prompt.trim(), guion.reparto), guion.cola].filter(Boolean).join(' ')
      : fuente?.prompt_ia;
    // Una escena que estrena personaje no debe partir del cuadro anterior: la
    // composición queda amarrada y el personaje nuevo nunca entra en cuadro.
    return {
      prompt_ia,
      duracion_s: +(t.hasta - t.desde).toFixed(2),
      anclar: t.anclar !== false
    };
  });
}

/** Tramo de cierre de marca, si el guion lo define. */
export function tramoDeCierre(guion) {
  return guion.tramos.find(t => t.cierre) || null;
}

/* ---------- subtítulos ---------- */

function aTiempoAss(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${seg.toFixed(2).padStart(5, '0')}`;
}

/** &HAABBGGRR — ASS usa BGR y alfa invertido (00 = opaco). */
function aColorAss(hex, alfa = 0) {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alfa.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

/**
 * Subtítulos ASS con los textos del guion, en caja de marca sobre el tercio
 * inferior. Se queman en el video porque en Instagram la mayoría mira sin
 * sonido: sin texto en pantalla el mensaje no llega.
 */
export function subtitulosAss(guion, { ancho = 1080, alto = 1920, morado = '#5B2E7E' } = {}) {
  const cab = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${ancho}`,
    `PlayResY: ${alto}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // BorderStyle 3 = caja opaca detrás del texto, con el morado de la marca.
    `Style: Marca,DejaVu Sans,64,${aColorAss('#FFFFFF')},${aColorAss(morado)},${aColorAss(morado, 26)},1,3,18,0,2,90,90,190,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const lineas = guion.tramos
    .filter(t => t.pantalla)
    .map(t => {
      // Un respiro al entrar y al salir para que no parpadee sobre el corte.
      const desde = t.desde + 0.25;
      const hasta = Math.max(desde + 0.5, t.hasta - 0.25);
      // Los emoji se quitan del texto quemado: la fuente del video no los tiene
      // en color y salen como un monigote gris. En el caption sí van.
      const texto = String(t.pantalla)
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
        .replace(/[ \t]+/g, ' ')
        .split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\\N')
        .replace(/\{|\}/g, '');
      return `Dialogue: 0,${aTiempoAss(desde)},${aTiempoAss(hasta)},Marca,,0,0,0,,${texto}`;
    });
  return [...cab, ...lineas].join('\n') + '\n';
}
