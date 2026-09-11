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
  marcaArriba: medidas.alto * 0.067,     // aire sobre el logo
  logoAlto: medidas.alto * 0.113,
  columnasArriba: medidas.alto * 0.107,  // bajada hasta las pastillas
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

// --------------------------------- iconos ---------------------------------
const trazo = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONOS = {
  telefono: `<svg viewBox="0 0 24 24" ${trazo}><path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 5.1 5.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>`,
  web: `<svg viewBox="0 0 24 24" ${trazo}><circle cx="12" cy="12" r="9"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/></svg>`,
};

// --------------------------------- piezas ---------------------------------
const grupoHtml = (g) => `
          <div class="grupo">
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
  if (marca.instagram === 'PENDIENTE') pendientes.push('cuenta de Instagram');
  if (!archivoLogo()) pendientes.push('logo');

  const reemplazos = {
    FUENTES: fuentes,
    TITULO: `${marca.nombre} ${v.lugar} — individual ${medidas.ancho / 10} x ${medidas.alto / 10} cm`,
    ACENTO: v.acento || marca.acento,
    ACENTO_TEXTO: v.acentoTexto || marca.acentoTexto,
    CURVA: medidas.curva,
    PAGINA_ANCHO: mm(PAGINA_ANCHO),
    PAGINA_ALTO: mm(PAGINA_ALTO),
    SANGRADO: mm(medidas.sangrado),
    MARCA_ARRIBA: mm(caja.marcaArriba),
    LOGO_ALTO: mm(caja.logoAlto),
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
    CONTACTO: [
      `<div class="fila">${ICONOS.telefono}<span>${marca.whatsapp}</span></div>`,
      `<div class="fila">${ICONOS.web}<span>${marca.web}</span></div>`,
    ].join('\n        '),
    QR: qr,
    INSTAGRAM: marca.instagram,
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
