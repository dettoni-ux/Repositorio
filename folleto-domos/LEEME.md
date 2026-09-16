# Folleto Domos El Tabo — El Bosque

El folleto original (`original/DOMOS_EL_TABO_BOSQUE.pdf`) traía las fotos del
interior como tres miniaturas apretadas al pie de la página **EQUIPAMIENTO:**.
`armar.py` las saca de ahí y arma una página nueva, **EL INTERIOR:**, que queda
justo después de EQUIPAMIENTO, con cuatro fotos rotuladas: living, habitación
matrimonial, cocina y baño.

```bash
python3 armar.py original/DOMOS_EL_TABO_BOSQUE.pdf salida.pdf \
    living.jpg matrimonial.jpg cocina.jpg bano.jpg
```

Las fotos van en ese orden. Se pueden entregar menos de cuatro: los huecos sin
foto salen marcados como "foto pendiente", que sirve para ir viendo cómo queda
la página mientras llegan las que faltan.

Cada foto se recorta sola al centro para calzar en su hueco (apaisado, 4:3),
así que conviene que el motivo principal esté al medio. Verticales u
horizontales da lo mismo; el recorte se encarga.

Tamaño recomendado: cada hueco son 57,5 × 43 puntos, o sea **240 × 180 px**
para que quede a 300 ppp. Cualquier foto de celular sobra.

**Ojo:** `DOMOS_EL_TABO_BOSQUE-con-interior.pdf` es la versión hecha con las
tres miniaturas que ya venían en el folleto (capturas de pantalla de la cocina).
Queda pendiente rehacerla con las cuatro fotos reales del domo del Bosque.

## Cambiar los textos

En `armar.py`, arriba del todo: `TITULO`, `ETIQUETAS` y `BAJADA`.

## Detalles

- Fondo, adornos y pie se copian de la página EQUIPAMIENTO, así que la página
  nueva queda igual al resto del folleto sin tener que redibujar nada.
- El título va en Anton y los textos en Poppins (`fuentes/`, ambas SIL OFL).
  El folleto original usa Codec Pro para el cuerpo, que es de pago; Poppins es
  lo más parecido que se puede embeber sin licencia.
- Dependencias: `pip install pymupdf pillow numpy`.
