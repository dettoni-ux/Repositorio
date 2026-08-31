# Prompts para generar la pantalla de la app

La pantalla del teléfono se puede resolver de tres formas. En orden de qué tan
seguro es que el texto se lea:

1. **Dibujarla con código** (`pantalla.mjs`) — legibilidad garantizada, el texto
   es texto de verdad. Es lo que hace este directorio.
2. **Generarla con un modelo de imagen** y componerla con `componer.py` — los
   modelos de imagen nuevos escriben bastante bien si el texto va entre comillas
   y es poco. Los prompts de abajo son para esto.
3. **Regenerar el video entero** con un modelo de video — es lo peor para el
   texto: los modelos de video escriben palabras inventadas («Pacetas»,
   «Peceihas»). Por eso el video original venía mal.

ElevenLabs no entra en ninguna: hace voz y efectos de sonido, no imagen.

---

## 1. Prompt para modelo de imagen (recomendado) — inglés

> A clean mobile app UI screenshot, vertical 9:19.5 aspect ratio, for a
> Chilean veterinary booking app called "EncuentraVet".
>
> Flat modern iOS design. White background. Deep purple accent (#5B2E7E) and
> warm yellow accent (#FFD84D). Rounded cards with soft shadows. Generous
> spacing. Crisp, perfectly legible sans-serif Spanish text — every word
> spelled exactly as written below, no invented words.
>
> Layout top to bottom:
> - Status bar: "9:41"
> - Header title: "EncuentraVet"
> - Search field, placeholder: "Buscar veterinario"
> - Section heading: "Reservas"
> - Two cards side by side: "Agendar hora" and "Mis mascotas"
> - Section heading: "Reseñas"
> - One wide row: "Veterinarios verificados", small grey line under it:
>   "4,9 estrellas"
> - Large purple pill button, white text: "Reservar hora"
> - Bottom tab bar, four labels: "Inicio", "Reservas", "Reseñas", "Perfil"
>
> Straight-on, no perspective, no hands, no phone frame, no glare. The screen
> content only, edge to edge. Sharp, high resolution, UI design mockup.
>
> Negative: blurry text, misspelled words, gibberish, lorem ipsum, English
> text, watermark, phone bezel, fingers, reflections.

## 2. El mismo prompt en español

> Captura de pantalla de una app móvil chilena de veterinarios llamada
> "EncuentraVet", vertical 9:19.5.
>
> Diseño iOS plano y moderno. Fondo blanco. Morado #5B2E7E y amarillo #FFD84D
> como colores de marca. Tarjetas redondeadas con sombra suave. Tipografía sans
> serif nítida, perfectamente legible, en español, con las palabras escritas
> EXACTAMENTE así, sin inventar ninguna:
>
> "9:41" · "EncuentraVet" · "Buscar veterinario" · "Reservas" ·
> "Agendar hora" · "Mis mascotas" · "Reseñas" · "Veterinarios verificados" ·
> "4,9 estrellas" · "Reservar hora" · "Inicio" · "Reservas" · "Reseñas" ·
> "Perfil"
>
> De frente, sin perspectiva, sin manos, sin marco de teléfono, sin reflejos.
> Solo el contenido de la pantalla, de borde a borde. Alta resolución.
>
> Negativo: texto borroso, palabras mal escritas, texto inventado, inglés,
> marca de agua, dedos, reflejos.

## 3. Si de todas formas se regenera el video entero

Añadir al prompt del video, y aun así asumir que el texto saldrá mal:

> The phone screen is out of focus / showing only colored blocks with no
> readable text.

Es a propósito: si el modelo no intenta escribir, no escribe mal, y el texto
se compone después encima con `componer.py`, que sí es legible.

---

## Cómo se usa la imagen generada

Guardarla como `pantalla.png` en este directorio (660x1540 px o proporcional) y
correr:

```
python3 retoque/componer.py <video-original.mp4>
```
