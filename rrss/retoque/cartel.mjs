/**
 * Dibuja el cartel final y el logo de esquina como PNG con transparencia.
 *
 * El video traía el cierre escrito con palabras rotas («Tu cusulta»,
 * «encuentavet.cc»). Ese texto se tapa con un velo y encima va el texto bueno.
 * El velo es un degradado, no un bloque: un rectángulo sólido se ve como un
 * parche, un degradado se lee como parte del aviso.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROSA = '#FA2778';
const ANCHO = 720, ALTO = 1280;

function cartel(logo) {
  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${ANCHO}px;height:${ALTO}px;background:transparent;overflow:hidden;
       font:400 16px system-ui,-apple-system,"DejaVu Sans",sans-serif}
  /* El velo tiene que tapar del todo el texto viejo (y 900-1060), no solo
     oscurecerlo: por eso llega a opaco antes de esa altura. */
  .velo{position:absolute;left:0;right:0;top:760px;bottom:0;
        background:linear-gradient(to bottom,
          rgba(18,10,16,0) 0%, rgba(18,10,16,.55) 14%,
          rgba(18,10,16,.93) 26%, rgba(18,10,16,.985) 38%,
          rgba(18,10,16,.99) 100%)}
  .texto{position:absolute;left:0;right:0;bottom:104px;text-align:center;padding:0 44px}
  .l1{color:#fff;font-size:52px;font-weight:800;letter-spacing:-1px;line-height:1.16;
      text-shadow:0 3px 18px rgba(0,0,0,.55)}
  .l2{margin-top:22px;display:inline-block;background:${ROSA};color:#fff;
      font-size:34px;font-weight:800;letter-spacing:.3px;
      padding:15px 34px;border-radius:999px;box-shadow:0 8px 26px rgba(250,39,120,.4)}
</style>
<div class="velo"></div>
<div class="texto">
  <div class="l1">Tu consulta<br>en un solo lugar.</div>
  <div class="l2">www.encuentravet.cl</div>
</div>`;
}

/* El logo va sobre el video, que arriba es claro: se usa la versión de tinta
   oscura con un halo suave, así se lee tanto sobre el techo blanco como sobre
   el uniforme azul. */
function marca(logo) {
  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0}
  html,body{width:${ANCHO}px;height:${ALTO}px;background:transparent;overflow:hidden}
  img{position:absolute;top:34px;left:32px;width:250px;
      filter:drop-shadow(0 0 10px rgba(255,255,255,.95))
             drop-shadow(0 2px 6px rgba(255,255,255,.9))}
</style>
<img src="${logo}">`;
}

const logo = `data:image/png;base64,${readFileSync(path.join(AQUI, 'logo-claro.png')).toString('base64')}`;
mkdirSync(AQUI, { recursive: true });

const ruta = process.env.CHROMIUM_PATH || undefined;
const nav = await chromium.launch({ ...(ruta ? { executablePath: ruta } : {}), args: ['--no-sandbox'] });
try {
  for (const [nombre, html] of [['cartel.png', cartel(logo)], ['marca.png', marca(logo)]]) {
    const pag = await nav.newPage({ viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: 1 });
    await pag.setContent(html, { waitUntil: 'load' });
    await pag.screenshot({ path: path.join(AQUI, nombre), omitBackground: true });
    await pag.close();
    console.log(`Listo: ${nombre}`);
  }
} finally {
  await nav.close();
}
