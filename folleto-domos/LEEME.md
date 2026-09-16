# Folleto Domos El Tabo — El Bosque

El folleto original (`original/DOMOS_EL_TABO_BOSQUE.pdf`) traía las fotos del
interior como tres miniaturas apretadas al pie de la página **EQUIPAMIENTO:**.
`armar.py` las saca de ahí y arma con ellas una página nueva, **EL INTERIOR:**,
que queda justo después de EQUIPAMIENTO.

Resultado: `DOMOS_EL_TABO_BOSQUE-con-interior.pdf` (11 páginas).

## Cambiar las fotos por otras

```bash
python3 armar.py original/DOMOS_EL_TABO_BOSQUE.pdf salida.pdf \
    cocina.jpg living.jpg dormitorio.jpg
```

Las tres fotos entran en este orden: la grande de la izquierda, la de arriba a
la derecha y la de abajo a la derecha. Cada una se recorta sola al centro para
calzar en su hueco, así que conviene que el motivo principal esté centrado.
Verticales u horizontales da lo mismo; el recorte se encarga.

Tamaño recomendado: el hueco grande son 84 × 110 puntos, o sea **350 × 458 px**
para que quede a 300 ppp. Menos que eso igual funciona, pero se nota blando al
imprimir. En pantalla (que es para lo que está pensado este folleto, formato
historia de 144 × 252 pt) casi cualquier foto de celular sobra.

Sin fotos al final del comando, el script rehace la página con las mismas
miniaturas del PDF original.

## Cambiar los textos

En `armar.py`, arriba del todo: `TITULO` y `BAJADA`.

## Detalles

- Fondo, adornos y pie se copian de la página EQUIPAMIENTO, así que la página
  nueva queda igual al resto del folleto sin tener que redibujar nada.
- El título va en Anton y la bajada en Poppins (`fuentes/`, ambas SIL OFL).
  El folleto original usa Codec Pro para el cuerpo, que es de pago; Poppins es
  lo más parecido que se puede embeber sin licencia.
- Dependencias: `pip install pymupdf pillow numpy`.
