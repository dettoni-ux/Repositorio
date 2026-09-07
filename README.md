# Estudio de Contenido — EncuentraVet

Aplicación autocontenida (`estudio-encuentravet.html`) para generar contenido de redes sociales
y estrategias de marketing mensual para **EncuentraVet** ([encuentravet.cl](https://www.encuentravet.cl)),
el directorio de veterinarios verificados de Chile.

## Qué incluye

- **Generador de contenido**: historias (frame a frame, con stickers interactivos sugeridos),
  reels (guion con tiempos, texto en pantalla, audio, caption y prompt listo para IA de video —
  Seedance, Kling, Runway o Pika) y carruseles (card a card con caption y hashtags). Cada clic
  entrega una variante nueva y cada pieza incluye su descripción para Instagram.
- **Estudio visual**: subida de logo y biblioteca de fotos propias (comprimidas en el navegador),
  seis plantillas de post en morado y amarillo (número gigante, foto protagonista, tarjeta central,
  checklist, anuncio y portada de carrusel), exportación PNG 1080×1350 y vista previa del feed.
- **Estrategia de marketing mensual**: plan por mes con tema central, focos semanales, calendario
  de publicaciones (día, formato, pilar e idea), fechas clave del calendario mascotero chileno y KPIs
  según el objetivo elegido. Desde cada fila del calendario se puede saltar directo al generador.
- **Centro de marca**: toda la información recopilada de encuentravet.cl (propuesta de valor,
  verificación con insignia azul, cobertura en 346 comunas, videoconsulta, urgencias 24 h, oferta a
  profesionales fundadores) más los datos de Instagram, editable y persistente en el navegador.
- **Biblioteca de guardados**: el contenido y los planes que marcas como guardados quedan
  disponibles para copiar o exportar.

## Generador de textos (`generador-encuentravet.html`)

Página aparte, más simple y enfocada solo en **escribir**: no dibuja imágenes ni videos,
entrega el texto listo para pegar. Cada pieza nace de una herramienta concreta de la
plataforma (insignia azul, agenda online, ficha clínica, recordatorios, 0% comisión,
búsqueda por comuna, y del lado de los tutores buscar y reservar, ficha gratis e insignia azul),
siguiendo la estrategia de `rrss/identidad.md`.

- **Cuatro formatos**: post (con el texto sugerido para la imagen), carrusel card por card,
  historia frame a frame con stickers, y reel con guion por tiempos y voz en off calculada
  a 2,5 palabras por segundo.
- **Siete ángulos**: tip, mito vs realidad, error común, pregunta, historia de ficción,
  antes/ahora y checklist. Cada clic entrega una variante distinta.
- **Mezcla 80/20** entre veterinarios y tutores, como pide la estrategia. «Generar semana»
  arma cinco piezas (cuatro para veterinarios, una para tutores) con fecha y hora sugeridas.
- **Chequeo de reglas** en cada pieza: que el caption cierre con el CTA del público y después
  los hashtags, que estén los hashtags base, el largo, la cantidad de emoji, que el texto quepa
  en las plantillas de imagen y —lo más importante— que **ninguna cifra salga de los datos
  reales de la marca**. Si aparece un número que no está en esa lista, lo marca para revisión.
- **Guardados** en el navegador, con copiar caption, copiar la pieza completa y exportar todo a `.md`.

Abrir el archivo en cualquier navegador. Funciona sin servidor, sin dependencias y sin conexión.

## Pilares de contenido

Educación y bienestar · Confianza y verificación · Cómo funciona · Comunidad y comunas ·
Para veterinarios (B2B) · Humor y tendencias.

## Uso

Abrir `estudio-encuentravet.html` en cualquier navegador. No requiere servidor, dependencias
ni conexión a servicios externos (las tipografías de Google Fonts son opcionales: hay respaldo del sistema).
Los datos de marca y los guardados se almacenan en `localStorage` del navegador.
