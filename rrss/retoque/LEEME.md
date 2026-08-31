# Retoque de video

Herramientas para corregir un video ya hecho sin volver a generarlo. Nada de
esto usa ElevenLabs ni Replicate: todo se resuelve con OpenCV y ffmpeg, así
que **no consume créditos**.

## Qué resuelve

Los generadores de video escriben mal: inventan palabras («Tu cusulta»,
«encuentavet.cc», «Pacetas») y usan colores que no son los de la marca. En vez
de rehacer el video y pagarlo de nuevo, se corrige encima.

## Cómo se usa

```
node retoque/pantalla.mjs                  # dibuja la pantalla de la app
node retoque/cartel.mjs                    # dibuja el cartel final y el logo
python3 retoque/seguir.py <video> --control  # sigue el teléfono; deja control.mp4 para revisar
python3 retoque/componer.py <video>        # compone la pantalla nueva
```

Y el montaje final con ffmpeg superpone `cartel.png` y `marca.png`.

## Lo que hay que saber

- **`seguir.py` parte de un cuadrilátero marcado a mano** (`QUAD_REF`) en un
  fotograma de referencia. Si cambias de video, hay que volver a medirlo: se
  dibuja con `--control` y se revisa a ojo.
- **Los dedos van por delante de la pantalla.** No basta con buscar piel,
  porque los botones dorados de la app original caen en el mismo rango de
  color; la diferencia es geométrica: la mano entra desde fuera del
  cuadrilátero y un botón está entero dentro.
- **Una imagen fija en ffmpeg solo existe en el instante cero.** Para
  superponerla durante todo el video hay que darle `-loop 1 -framerate 24`, y
  acotar la salida con `-t`, si no la codificación no termina nunca.
- **OpenCV escribe video sin audio.** La pista se toma del original en el
  montaje final.
