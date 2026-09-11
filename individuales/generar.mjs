// ---------------------------------------------------------------------------
// Arma los individuales de Domos (HTML autocontenido + PDF listo para imprenta
// + PNG de vista previa) a partir de plantilla.html y datos.mjs.
//
//   node individuales/generar.mjs            → genera todas las versiones
//   node individuales/generar.mjs playa      → sólo una versión
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { marca, versiones } from './datos.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(AQUI, 'salida');

// Medidas del lienzo con sangrado (corte final 420 x 297 mm).
const ANCHO_PX = Math.round((426 / 25.4) * 96);
const ALTO_PX = Math.round((303 / 25.4) * 96);

const CHROME =
  process.env.CHROME_BIN ||
  ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome']
    .find((p) => fs.existsSync(p));

const MIMES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const aDataUri = (rel) => {
  const abs = path.join(AQUI, rel);
  if (!fs.existsSync(abs)) return null;
  const mime = MIMES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
};

const buscar = (carpeta, nombres) => {
  for (const n of nombres) {
    const encontrado = fs.existsSync(path.join(AQUI, carpeta, n)) ? `${carpeta}/${n}` : null;
    if (encontrado) return encontrado;
  }
  return null;
};

// --------------------------------- iconos ---------------------------------
const trazo = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const ICONOS = {
  wifi: `<svg viewBox="0 0 24 24" ${trazo}><path d="M2.5 8.5a15 15 0 0 1 19 0"/><path d="M5.5 12.2a10.5 10.5 0 0 1 13 0"/><path d="M8.6 15.9a6 6 0 0 1 6.8 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  reloj: `<svg viewBox="0 0 24 24" ${trazo}><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/></svg>`,
  servicios: `<svg viewBox="0 0 24 24" ${trazo}><path d="M4 20V9.6L12 4l8 5.6V20"/><path d="M9.5 20v-5.4h5V20"/></svg>`,
  mapa: `<svg viewBox="0 0 24 24" ${trazo}><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>`,
  corazon: `<svg viewBox="0 0 24 24" ${trazo}><path d="M12 20.5s-7.5-4.6-7.5-9.8A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.7c0 5.2-7.5 9.8-7.5 9.8Z"/></svg>`,
  cafe: `<svg viewBox="0 0 24 24" ${trazo}><path d="M4 9h12v5.5A4.5 4.5 0 0 1 11.5 19h-3A4.5 4.5 0 0 1 4 14.5Z"/><path d="M16 10.5h1.8a2.6 2.6 0 0 1 0 5.2H16"/><path d="M7.5 3.5v2.2M11 3.5v2.2"/></svg>`,
  telefono: `<svg viewBox="0 0 24 24" ${trazo}><path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 5.1 5.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>`,
  web: `<svg viewBox="0 0 24 24" ${trazo}><circle cx="12" cy="12" r="9"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/></svg>`,
  sobre: `<svg viewBox="0 0 24 24" ${trazo}><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.8 7 8.2 6 8.2-6"/></svg>`,
};

// --------------------------------- piezas ---------------------------------
const bloqueHtml = (b) => `
        <article class="bloque">
          <div class="cabecera">${ICONOS[b.icono] || ICONOS.corazon}<h2>${b.titulo}</h2></div>
          <ul>${b.lineas.map((l) => `<li>${l}</li>`).join('')}</ul>
        </article>`;

const filaContacto = (icono, texto) =>
  `<div class="fila">${ICONOS[icono]}<span>${texto}</span></div>`;

const logoHtml = () => {
  const archivo = buscar('marca', ['logo-domos.svg', 'logo-domos.png', 'logo-domos.jpg', 'logo.png', 'logo.svg']);
  const uri = archivo && aDataUri(archivo);
  if (uri) return `<img class="logo" src="${uri}" alt="${marca.nombre}">`;
  // Sin archivo de logo todavía: se dibuja la marca con tipografía.
  return `<div class="marca-texto">
        <div class="nombre">${marca.nombre}</div>
        <div class="lema">${marca.lema}</div>
      </div>`;
};

const qrHtml = () => {
  const url = `https://www.instagram.com/${marca.instagram}/`;
  const destino = path.join(SALIDA, 'qr-instagram.svg');
  execFileSync('python3', [path.join(AQUI, 'qr.py'), url, destino], { stdio: 'pipe' });
  return fs
    .readFileSync(destino, 'utf8')
    .replace(/<\?xml[^>]*\?>\s*/, '')
    .replace(/<svg([^>]*?)width="(\d+)"\s+height="(\d+)"/, '<svg$1viewBox="0 0 $2 $3" width="100%" height="100%"');
};

// -------------------------------- armado ----------------------------------
const plantilla = fs.readFileSync(path.join(AQUI, 'plantilla.html'), 'utf8');
const fuentes = fs.readFileSync(path.join(AQUI, 'fuentes.css'), 'utf8');
const qr = qrHtml();

const pedidas = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const aGenerar = pedidas.length ? pedidas : Object.keys(versiones);
const faltantes = [];

for (const clave of aGenerar) {
  const v = versiones[clave];
  if (!v) {
    console.error(`✗ No existe la versión "${clave}". Disponibles: ${Object.keys(versiones).join(', ')}`);
    process.exitCode = 1;
    continue;
  }

  const foto = aDataUri(v.fondo);
  if (!foto) faltantes.push(`${clave}: falta la foto de fondo en individuales/${v.fondo}`);

  const pendientes = [];
  if (marca.instagram === 'PENDIENTE') pendientes.push('cuenta de Instagram');
  if (!foto) pendientes.push('foto de fondo');
  if (!buscar('marca', ['logo-domos.svg', 'logo-domos.png', 'logo-domos.jpg'])) pendientes.push('logo');

  const html = plantilla
    .replace('{{FUENTES}}', fuentes)
    .replace('{{TITULO}}', `${marca.nombre} ${v.lugar} — individual 42 x 29,7 cm`)
    .replace('{{TINTA}}', v.paleta.tinta)
    .replace('{{ACENTO}}', v.paleta.acento)
    .replace('{{SUAVE}}', v.paleta.suave)
    .replace('{{PANEL}}', v.paleta.panel)
    .replace('{{VELO}}', v.paleta.velo)
    .replace(
      '{{FONDO}}',
      foto
        ? `url("${foto}")`
        : `linear-gradient(135deg, ${v.paleta.tinta} 0%, ${v.paleta.suave} 55%, ${v.paleta.acento} 100%)`,
    )
    .replace('{{LOGO}}', logoHtml())
    .replace('{{LUGAR}}', v.lugar)
    .replace('{{BIENVENIDA}}', v.bienvenida)
    .replace(
      '{{CONTACTO}}',
      [
        filaContacto('telefono', marca.whatsapp),
        filaContacto('web', marca.web),
        filaContacto('sobre', marca.correo),
      ].join('\n        '),
    )
    .replace('{{BLOQUES}}', v.bloques.map(bloqueHtml).join(''))
    .replace('{{QR}}', qr)
    .replace('{{INSTAGRAM}}', marca.instagram)
    .replace(
      '{{AVISO}}',
      pendientes.length ? `<div class="aviso">Borrador · falta ${pendientes.join(' · ')}</div>` : '',
    );

  const base = path.join(SALIDA, v.archivo);
  fs.writeFileSync(`${base}.html`, html);

  if (CHROME) {
    const comunes = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=8000'];
    if (!/headless_shell$/.test(CHROME)) comunes.unshift('--headless');
    // --alta: PNG a 300 ppp (listo para imprenta); por defecto, vista previa a 96 ppp.
    const escala = process.argv.includes('--alta') ? 3.125 : 1;
    execFileSync(CHROME, [...comunes, '--no-pdf-header-footer', `--print-to-pdf=${base}.pdf`, `file://${base}.html`], { stdio: 'pipe' });
    execFileSync(CHROME, [...comunes, `--window-size=${ANCHO_PX},${ALTO_PX}`, `--force-device-scale-factor=${escala}`, `--screenshot=${base}.png`, `file://${base}.html`], { stdio: 'pipe' });
    console.log(`✓ ${v.archivo}  ·  .html .pdf .png`);
  } else {
    console.log(`✓ ${v.archivo}.html  (sin Chrome no se generan PDF ni PNG)`);
  }
}

if (faltantes.length) {
  console.log('\nPendiente:');
  for (const f of faltantes) console.log(`  · ${f}`);
}
