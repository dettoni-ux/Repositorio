/**
 * Render de piezas: plantilla HTML + contenido → PNG 1080×1350 (Playwright/Chromium).
 * El diseño nunca lo decide la IA: solo se llenan plantillas fijas.
 * Devuelve los campos que desbordaron su caja para que el generador pida textos más cortos.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_PLANTILLAS = path.join(AQUI, 'plantillas');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PATITA_SVG = '<svg class="patita" viewBox="0 0 100 100"><g fill="#FFD84D"><ellipse cx="50" cy="62" rx="26" ry="20"/><circle cx="24" cy="36" r="11"/><circle cx="50" cy="28" r="11"/><circle cx="76" cy="36" r="11"/></g></svg>';

function htmlLogo() {
  if (existsSync(path.join(DIR_PLANTILLAS, 'logo.png'))) {
    return '<div class="marca-wordmark"><img src="logo.png" alt="EncuentraVet"></div>';
  }
  return `<div class="marca-wordmark">${PATITA_SVG}Encuentra<span class="vet">Vet</span></div>`;
}

function llenarPlantilla(pieza) {
  let html = readFileSync(path.join(DIR_PLANTILLAS, `${pieza.tipo}.html`), 'utf8');
  const v = pieza.visual;
  for (const campo of ['etiqueta', 'titulo', 'destacado', 'cierre']) {
    html = html.replaceAll(`{{${campo}}}`, esc(v[campo] ?? ''));
  }
  const conPatita = pieza.tipo === 'tip';
  const lineas = v.lineas.map(l =>
    `<div class="linea">${conPatita ? PATITA_SVG : ''}<span>${esc(l)}</span></div>`).join('\n');
  html = html.replace('<!--LINEAS-->', lineas).replace('<!--LOGO-->', htmlLogo());
  return html;
}

export async function abrirNavegador() {
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch(executablePath ? { executablePath } : {});
}

export async function renderPieza(navegador, pieza, rutaSalida) {
  const tmp = path.join(DIR_PLANTILLAS, `.tmp-${process.pid}-${Date.now()}.html`);
  writeFileSync(tmp, llenarPlantilla(pieza));
  const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1350 } });
  try {
    await pagina.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready).catch(() => {});
    // Campos cuyo texto no cupo en su caja (el CSS ya recorta, pero preferimos texto que quepa)
    const desbordes = await pagina.evaluate(() =>
      Array.from(document.querySelectorAll('[data-ajuste]'))
        .filter(el => el.scrollHeight > el.clientHeight + 10 || el.scrollWidth > el.clientWidth + 10)
        .map(el => el.dataset.ajuste)
    );
    await pagina.screenshot({ path: rutaSalida });
    return { desbordes };
  } finally {
    await pagina.close();
    unlinkSync(tmp);
  }
}
