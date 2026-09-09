# Landing — Sitios en venta, Armando Celis (El Tabo)

Landing de una sola página para la venta de los 16 sitios del catálogo de
Dettoni Propiedades. Todo el contenido (textos, valores, condiciones legales)
sale del catálogo PDF; las fotos y planos también.

- `index.html` — la página completa (HTML + CSS + JS en un solo archivo, sin dependencias).
- `img/` — fotos reales, plano de loteo y simulaciones, optimizadas para web.

**Vista previa mientras no hay dominio:** https://www.mresin.cl/el-tabo/

---

## 1. Cuando compres el dominio

GitHub Pages solo admite **un** dominio propio por repositorio, y este ya está
tomado por `www.mresin.cl` (archivo `CNAME` en la raíz). Para publicar la landing
en su propio dominio hay dos caminos:

**Opción A — repositorio nuevo (recomendado)**
1. Crea un repo nuevo, por ejemplo `sitioseltabo`.
2. Mueve dentro el contenido de esta carpeta (`index.html` + `img/`) a la raíz.
3. Agrega un archivo `CNAME` en la raíz con el dominio, sin `https://`:
   `www.sitioseltabo.cl`
4. En Settings → Pages: Source = `main` / carpeta raíz.
5. NIC Chile **no permite crear registros DNS**: solo acepta servidores de nombres.
   Hay que tener el dominio en un servicio DNS (Cloudflare gratis, o el hosting que
   ya uses para mresin.cl) y declarar esos nameservers en NIC → Mis dominios →
   sitioseltabo.cl → Configuración técnica → Servidores DNS. Ahí dentro se crean:
   - `CNAME` para `www` → `<tu-usuario>.github.io`
   - y cuatro registros `A` para el dominio sin www → `185.199.108.153`,
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
6. Espera la propagación (de minutos a 24 h) y activa "Enforce HTTPS".

**Opción B — hosting propio**: subir `index.html` y `img/` por FTP a cualquier
hosting. No requiere nada más: la página es estática.

### Dominio
El dominio es **www.sitioseltabo.cl** (registrado en NIC Chile) y ya está escrito
en el `canonical`, el `og:url` y el `og:image` de `index.html`.

---

## 2. Mantención habitual

**Marcar un sitio como vendido** (por ejemplo, el 7):
1. En el plano interactivo, cambia el botón:
   ```html
   <button class="sitio vendido" data-n="7" disabled aria-label="Sitio 7, vendido">7</button>
   ```
   (se le quita el `<small>283 m²</small>` y se le agrega `vendido` + `disabled`).
2. En la tabla de precios, mueve el número a la fila "Vendidos" y sácalo de la
   fila de disponibles.
3. Actualiza el contador en dos lugares: el hero (`14 de 16 sitios disponibles`)
   y la sección de contacto (`Quedan 14 sitios disponibles`).

**Cambiar valores:** los precios están en la tabla HTML y en el bloque `datos()`
del script (`22900000` y `27900000`). El corretaje del 2% y los totales se
calculan solos en el panel del plano, pero la tabla y la caja de totales son
texto: hay que editarlos a mano.

**Teléfono / correo:** el número aparece como `56975571978` en los enlaces de
WhatsApp y como texto legible en contacto y pie de página.
