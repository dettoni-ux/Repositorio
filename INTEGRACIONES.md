# Integraciones: Instagram y video con IA (Seedance)

El Estudio de Contenido genera las piezas; estas dos integraciones las publican y les dan video.
Ambas corren en **GitHub Actions** de este repositorio, con tus credenciales guardadas como
**Secrets** (cifradas, nunca visibles en el código ni en el chat).

> ⚠️ **Nunca pegues tokens o claves en un chat ni en un archivo del repo** (el repo es público).
> Guárdalos así: GitHub → este repositorio → **Settings → Secrets and variables → Actions →
> New repository secret**. Solo necesitas decirme «ya están cargados» con el nombre de cada secret.

---

## 1) Publicar en Instagram con tu aprobación

Así lo hacen todas las plataformas (Metricool, Buffer, etc.): con la **API oficial de Meta**.
Publicación en dos pasos (crear contenedor → publicar), hasta 100 publicaciones por 24 h.

### Requisitos de la cuenta
1. Cuenta de Instagram **profesional tipo Empresa** (Instagram → Configuración → Herramientas
   y recursos para empresas → Cambiar a cuenta profesional → **Empresa**).
2. Una app en [developers.facebook.com](https://developers.facebook.com) (tipo Empresa) con el
   producto **API de Instagram**. Hay dos caminos:
   - **Con inicio de sesión de Instagram** (más simple, sin página de Facebook): host
     `graph.instagram.com` (valor por defecto de estos scripts).
   - **Con inicio de sesión de Facebook** (cuenta vinculada a una página): host
     `graph.facebook.com` → guarda además el secret `GRAPH_HOST` con ese valor.
3. Genera un **token de acceso de larga duración** (≈60 días, renovable) con los permisos de
   publicación de contenido, y obtén el **ID numérico** de la cuenta de Instagram.

### Secrets que debes crear
| Secret | Contenido |
|---|---|
| `IG_USER_ID` | ID numérico de la cuenta profesional de Instagram |
| `IG_ACCESS_TOKEN` | Token de acceso de larga duración |
| `GRAPH_HOST` | *(opcional)* `graph.facebook.com` solo si usas la vía con página de Facebook |

### Cómo se publica (tu aprobación = ejecutar el workflow)
1. En el Estudio de Contenido: diseña el post y usa **«Descargar JPG»** (la API solo acepta JPEG)
   y **«Copiar descripción»**.
2. Sube la imagen a la carpeta `publicar/` del repo y el caption a un `.txt` (opcional).
3. GitHub → **Actions → Publicar en Instagram → Run workflow**, completa:
   - `tipo`: imagen · carrusel · reel · historia_imagen · historia_video
   - `media`: ruta del repo (ej. `publicar/post-1.jpg`) o URL pública; para carrusel, varias separadas por comas
   - `caption` o `caption_archivo`
4. Ejecutar = aprobar. El log muestra el enlace del post publicado. **Nada se publica solo.**

Notas: imágenes solo JPEG; videos MP4 en URL pública; los archivos en `publicar/` son públicos
(igual que el post que vas a subir). El token de larga duración caduca ~60 días: renuévalo.

---

## 2) Generar los videos de los reels con Seedance

Seedance (ByteDance) se usa por API a través de varios proveedores: Replicate, fal.ai,
BytePlus (oficial internacional), Atlas Cloud, WaveSpeed, entre otros. Este repo usa
**Replicate** por ser el más simple y de los más baratos (~USD 0,23 por segundo en 720p;
un clip de 10 s ≈ USD 2–3). BytePlus no está disponible en todos los países.

### Secret que debes crear
| Secret | Contenido |
|---|---|
| `REPLICATE_API_TOKEN` | Token de [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) |

### Cómo se genera
1. En el Estudio de Contenido, genera un **reel** y presiona **«Copiar prompt de video»**.
2. GitHub → **Actions → Generar video con IA (Seedance) → Run workflow**, pega el prompt.
   - `modelo`: por defecto `bytedance/seedance-1-pro` (puedes cambiarlo por otro de Replicate).
   - `parametros`: JSON con duración/resolución/aspecto — verifica los nombres exactos de los
     parámetros en la página del modelo en Replicate, pueden variar entre versiones.
3. El MP4 queda como artefacto descargable del workflow y (opcional) en la carpeta `videos/`
   del repo — con lo cual ya tiene URL pública y puedes publicarlo como reel con el workflow
   de Instagram, usando `tipo: reel` y `media: videos/<archivo>.mp4`.

Flujo completo: **Estudio (guion + prompt) → Generar video → revisar → Publicar en Instagram**.
Tú apruebas dos veces: al generar y al publicar.
