# Folleto Domos El Tabo — El Bosque

El folleto original (`original/DOMOS_EL_TABO_BOSQUE.pdf`) mostraba el interior
en tres miniaturas apretadas al pie de la página **EQUIPAMIENTO:**. `armar.py`
las saca de ahí y agrega cuatro páginas nuevas, justo después de EQUIPAMIENTO:

| Página | Qué muestra |
|---|---|
| LA COCINA | foto a sangre |
| PIEZA MATRIMONIAL | foto a sangre |
| DORMITORIO DE ARRIBA | foto a sangre |
| EL BAÑO | las dos fotos lado a lado |

Resultado: `DOMOS_EL_TABO_BOSQUE-con-interior.pdf`, 14 páginas.

```bash
python3 armar.py original/DOMOS_EL_TABO_BOSQUE.pdf DOMOS_EL_TABO_BOSQUE-con-interior.pdf
```

## Cambiar o agregar fotos

Las fotos viven en `fotos/` y las páginas se describen en la lista `PAGINAS`,
arriba de `armar.py`. Para sumar una página basta agregarle una entrada:

```python
{"foto": "living.jpg", "titulo": "EL LIVING", "texto": "Sofá, mesa y..."}
```

o, para dos fotos lado a lado:

```python
{"fotos": ["terraza-1.jpg", "terraza-2.jpg"], "titulo": "LA TERRAZA", ...}
```

Cada foto se recorta sola al centro para llenar su hueco, así que conviene que
el motivo principal esté al medio. El título se achica solo si no cabe a lo
ancho de la página.

Tamaño: la página son 144 × 252 puntos, o sea **600 × 1050 px** a 300 ppp para
una foto a sangre. Las fotos del celular (1333 × 2000) sobran.

## Detalles

- En las páginas a sangre la foto ocupa todo y abajo va una franja verde con el
  rótulo; el degradado evita el corte seco entre foto y franja.
- En la página de dos fotos el fondo y los adornos se copian de la página
  EQUIPAMIENTO, así que queda igual al resto del folleto.
- Títulos en Anton y textos en Poppins (`fuentes/`, ambas SIL OFL). El folleto
  original usa Codec Pro para el cuerpo, que es de pago; Poppins es lo más
  parecido que se puede embeber sin licencia.
- Dependencias: `pip install pymupdf pillow`.
