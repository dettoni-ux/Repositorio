// ---------------------------------------------------------------------------
// Arma los individuales de Domos a partir de plantilla.html y datos.mjs.
//
//   node individuales/generar.mjs            → todas las versiones
//   node individuales/generar.mjs playa      → sólo una
//   node individuales/generar.mjs --alta     → PNG a 300 ppp
//
// De cada versión salen tres archivos en individuales/salida/:
//   ·  .html            el diseño, autocontenido (se abre en cualquier navegador)
//   ·  -impresion.pdf   hoja con sangrado + línea de troquel, para la imprenta
//   ·  -vista.png       la pieza ya recortada, para revisar y mostrar
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { marca, medidas, versiones } from './datos.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(AQUI, 'salida');
fs.mkdirSync(SALIDA, { recursive: true });

// ------------------------------- geometría --------------------------------
const mm = (n) => `${+n.toFixed(2)}mm`;
const PAGINA_ANCHO = medidas.ancho + medidas.sangrado * 2;
const PAGINA_ALTO = medidas.alto + medidas.sangrado * 2;
const px = (n) => Math.round((n / 25.4) * 96);

// Proporciones del contenido, calculadas sobre el alto de la pieza para que
// todo se reacomode solo si cambian las medidas.
const caja = {
  marcaArriba: medidas.alto * 0.047,     // aire sobre el logo
  logoAlto: medidas.alto * 0.173,        // topes del logo: entra como entre
  logoAncho: medidas.ancho * 0.255,      // sin deformarse, sea cual sea su forma
  columnasArriba: medidas.alto * 0.055,  // bajada hasta las pastillas
  columnasLado: medidas.ancho * 0.105,   // margen lateral de las columnas
  columnaAncho: medidas.ancho * 0.281,
  pieLado: medidas.ancho * 0.105,
  pieAbajo: medidas.alto * 0.073,
};

const CHROME =
  process.env.CHROME_BIN ||
  ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const MIMES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const aDataUri = (rel) => {
  const abs = path.join(AQUI, rel);
  if (!fs.existsSync(abs)) return null;
  const mime = MIMES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
};

const archivoLogo = () =>
  ['logo-domos.svg', 'logo-domos.png', 'logo-domos.jpg', 'logo.svg', 'logo.png']
    .map((n) => `marca/${n}`)
    .find((rel) => fs.existsSync(path.join(AQUI, rel))) || null;

// ---------------------------- iconos de las redes ----------------------------
// Dibujados a mano en un lienzo de 24 x 24 para que impriman nítidos a
// cualquier tamaño y no dependan de ninguna descarga.
const REDES = {
  facebook: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M13.9 22v-8.1h2.7l.41-3.14H13.9V8.75c0-.91.25-1.53 1.56-1.53h1.67V4.41A22 22 0 0 0 14.7 4.3c-2.41 0-4.06 1.47-4.06 4.17v2.29H7.92v3.14h2.72V22z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1"><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.2" cy="6.8" r=".2" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M16.3 2.4h-3.06v13.11a2.43 2.43 0 1 1-2.43-2.43c.25 0 .5.04.73.11v-3.12a5.6 5.6 0 0 0-.73-.05 5.54 5.54 0 1 0 5.54 5.54V8.9a6.7 6.7 0 0 0 3.92 1.26V7.07A3.9 3.9 0 0 1 16.3 3.4z"/></svg>`,
};

// --------------------------------- piezas ---------------------------------
const grupoHtml = (g) => `
          <div class="grupo${g.recto ? ' recto' : ''}">
            <span class="pastilla">${g.titulo}</span>
            <ul>${g.items
              .map((i) => {
                const it = typeof i === 'string' ? { texto: i } : i;
                return `<li>${it.texto}${it.nota ? `<small>${it.nota}</small>` : ''}</li>`;
              })
              .join('')}</ul>
          </div>`;

const columnaHtml = (grupos) => grupos.map(grupoHtml).join('');

const logoHtml = () => {
  const uri = archivoLogo() && aDataUri(archivoLogo());
  if (uri) return `<img src="${uri}" alt="${marca.nombre}">`;
  // Sin archivo de logo todavía: se escribe la marca con tipografía.
  return `<div class="marca-texto">
          <div class="nombre">${marca.nombre}</div>
          <div class="lema">${marca.lema}</div>
        </div>`;
};

const qrHtml = () => {
  const url = `https://www.instagram.com/${marca.usuario}/`;
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
const escala = process.argv.includes('--alta') ? 3.125 : 1; // 300 ppp vs 96 ppp
const faltantes = [];

for (const clave of aGenerar) {
  const v = versiones[clave];
  if (!v) {
    console.error(`✗ No existe la versión "${clave}". Disponibles: ${Object.keys(versiones).join(', ')}`);
    process.exitCode = 1;
    continue;
  }

  const foto = aDataUri(v.fondo);
  const pendientes = [];
  if (!foto) {
    pendientes.push('foto de fondo');
    faltantes.push(`${clave}: falta la foto en individuales/${v.fondo}`);
  }
  if (!marca.usuario || marca.usuario === 'PENDIENTE') pendientes.push('cuenta de Instagram');
  if (!archivoLogo()) pendientes.push('logo');

  const reemplazos = {
    FUENTES: fuentes,
    TITULO: `${marca.nombre} ${v.sector} — individual ${medidas.ancho / 10} x ${medidas.alto / 10} cm`,
    ACENTO: v.acento || marca.acento,
    ACENTO_TEXTO: v.acentoTexto || marca.acentoTexto,
    CURVA: medidas.curva,
    PAGINA_ANCHO: mm(PAGINA_ANCHO),
    PAGINA_ALTO: mm(PAGINA_ALTO),
    SANGRADO: mm(medidas.sangrado),
    MARCA_ARRIBA: mm(caja.marcaArriba),
    LOGO_ALTO: mm(caja.logoAlto),
    LOGO_ANCHO: mm(caja.logoAncho),
    COLUMNAS_ARRIBA: mm(caja.columnasArriba),
    COLUMNAS_LADO: mm(caja.columnasLado),
    COLUMNA_ANCHO: mm(caja.columnaAncho),
    PIE_LADO: mm(caja.pieLado),
    PIE_ABAJO: mm(caja.pieAbajo),
    FONDO: foto
      ? `url("${foto}")`
      : 'linear-gradient(150deg, #4E6B62 0%, #8FA08C 45%, #D8CBB4 100%)',
    VELO: v.velo,
    LOGO: logoHtml(),
    COLUMNA_IZQ: columnaHtml(v.columnaIzq),
    COLUMNA_DER: columnaHtml(v.columnaDer),
    SECTOR: v.sector,
    REDES: marca.redes
      .map((r) => `<span class="icono">${REDES[r]}</span>`)
      .join(''),
    USUARIO: marca.usuario,
    WEB: marca.web,
    QR: qr,
    AVISO: pendientes.length ? `<div class="aviso">Borrador · falta ${pendientes.join(' · ')}</div>` : '',
  };

  const html = Object.entries(reemplazos).reduce(
    (acc, [clave, valor]) => acc.replaceAll(`{{${clave}}}`, () => valor),
    plantilla,
  );

  const base = path.join(SALIDA, v.archivo);
  fs.writeFileSync(`${base}.html`, html);

  if (CHROME) {
    const comunes = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=8000'];
    if (!/headless_shell$/.test(CHROME)) comunes.unshift('--headless');

    execFileSync(CHROME, [...comunes, '--no-pdf-header-footer',
      `--print-to-pdf=${base}-impresion.pdf`, `file://${base}.html`], { stdio: 'pipe' });

    execFileSync(CHROME, [...comunes,
      `--window-size=${px(PAGINA_ANCHO)},${px(PAGINA_ALTO)}`,
      `--force-device-scale-factor=${escala}`,
      '--default-background-color=00000000',
      `--screenshot=${base}-vista.png`, `file://${base}.html?vista`], { stdio: 'pipe' });

    console.log(`✓ ${v.archivo}  ·  .html  -impresion.pdf  -vista.png`);
  } else {
    console.log(`✓ ${v.archivo}.html  (sin Chrome no se generan PDF ni PNG)`);
  }
}

console.log(`\nPieza: ${medidas.ancho / 10} x ${medidas.alto / 10} cm + ${medidas.sangrado} mm de sangrado`);
if (faltantes.length) {
  console.log('Pendiente:');
  for (const f of faltantes) console.log(`  · ${f}`);
}
