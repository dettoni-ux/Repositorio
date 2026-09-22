# Folletos Domos El Tabo

Los folletos originales (`original/`) mostraban el interior en tres miniaturas
apretadas al pie de la página **EQUIPAMIENTO:**. `armar.py` las saca de ahí y
agrega, justo después de esa página, una diapo por ambiente: nunca más de dos
fotos por diapo, para que se vean grandes.

```bash
python3 armar.py            # los dos folletos
python3 armar.py playa      # solo uno (bosque | playa)
```

| Folleto | Sale | Páginas nuevas | Total |
|---|---|---|---|
| Bosque | `DOMOS_EL_TABO_BOSQUE-con-interior.pdf` | cocina, pieza matrimonial, dormitorio de arriba, baño, parque infantil, sala de juegos, gimnasio, piscina (dos planas), asaderas, hamacas | 21 |
| Playa Bonita | `DOMOS_EL_TABO_PLAYA_BONITA-con-interior.pdf` | a pasos del mar, living, pieza matrimonial, dormitorio de arriba, cocina, todo puesto, baño, terraza y quincho | 17 |

Las fotos están en `fotos/` (Bosque) y `fotos-playa/` (Playa Bonita).

## Cambiar fotos de páginas que ya existen

En la entrada del folleto, la lista `fondos`:

```python
"fondos": [
    {"pagina": 0, "foto": "recinto-jardin.jpg"},   # la portada
    {"pagina": 1, "foto": "domo-noche.jpg"},
],
```

Cambia la foto de fondo de esas páginas dejando el logo, la franja y los textos
donde estaban (la página se cuenta desde 0). Acepta `ancla` y `ancla_x` igual que las diapos. Ojo: algunos
folletos guardan la foto de portada acostada y la muestran rotada; el script lo
detecta y entrega la foto en la misma orientación, si no saldría de lado.

Si a una diapo le falta una de sus dos fotos, se arma igual y el hueco vacío
queda marcado como "foto pendiente", para no perder el lugar. Solo cuando le
faltan todas la diapo se salta entera.

**Diapos en espera.** El folleto del Bosque tiene seis diapos más ya escritas
en `FOLLETOS` —parque infantil, sala de juegos, gimnasio, terraza con quitasol,
piscina y asaderas— pero sin fotos todavía. Mientras falten, el script las
salta y avisa cuáles son; basta dejar los archivos en `fotos/` con el nombre
que dice el aviso y volver a correrlo para que aparezcan.

## Cambiar o agregar diapos

Todo se edita en la lista `FOLLETOS`, arriba de `armar.py`. Una diapo es una
foto a sangre:

```python
{"foto": "living.jpg", "titulo": "EL LIVING", "texto": "Sofá, comedor y..."}
```

o dos lado a lado:

```python
{"fotos": ["bano-1.jpg", "bano-2.jpg"], "titulo": "EL BAÑO", "texto": "..."}
```

Cada foto se recorta sola al centro para llenar su hueco, así que conviene que
el motivo principal esté al medio. Si lo bueno de la foto está justo abajo y la
franja se lo come, la diapo acepta `"hasta_franja": True` (la foto llega hasta
donde empieza la franja en vez de correr por debajo) y `"ancla": 1` (recorta
desde el borde de abajo; 0 es desde arriba y 0.5 el centro). El título se achica solo si no cabe a lo
ancho y la bajada se corta sola en dos líneas.

Resolución: el folleto se mira en el teléfono, así que las fotos se guardan a
600 ppp (`PPP` en `armar.py`): una página entera son **1200 × 2100 px**, más
que Full HD. Conviene que las fotos lleguen de la cámara y no por WhatsApp,
que las achica a 1000–1600 px; una de 1024 px de ancho a página completa queda
justo bajo Full HD.

Para sumar un tercer folleto basta agregarle una entrada a `FOLLETOS` con su
PDF, su carpeta de fotos y el número de la página de equipamiento (contando
desde 0).

## Detalles

- **Nada de colores a mano:** el color de fondo, los adornos de las esquinas y
  las miniaturas que hay que sacar se leen del propio folleto. Por eso el del
  Bosque sale verde oliva y el de Playa Bonita azul.
- En las diapos a sangre la foto ocupa todo y abajo va una franja con el
  rótulo. El degradado que une foto y franja va como imagen con transparencia:
  pintado con rectángulos deja bandas visibles.
- Al pie de cada diapo nueva va **DOMOS EL TABO · GLAMPING CHILE**, bajo el
  arroba de Instagram.
- En Playa Bonita las miniaturas llegaban hasta el borde de abajo y el arroba
  iba encima de ellas; al taparlas se tapa también, así que el script lo
  vuelve a escribir y repone las rayas de la esquina.
- Títulos en Anton y textos en Poppins (`fuentes/`, ambas SIL OFL). Los
  folletos originales usan Codec Pro para el cuerpo, que es de pago; Poppins es
  lo más parecido que se puede embeber sin licencia.
- Dependencias: `pip install pymupdf pillow`.
