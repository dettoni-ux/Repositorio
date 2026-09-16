# -*- coding: utf-8 -*-
"""Agrega al folleto de Domos El Tabo - El Bosque una pagina dedicada al
interior de los domos, con las fotos en grande.

    python3 armar.py folleto.pdf salida.pdf
    python3 armar.py folleto.pdf salida.pdf cocina.jpg living.jpg bano.jpg

Sin fotos nuevas reutiliza las tres miniaturas que hoy van apretadas al pie de
la pagina "EQUIPAMIENTO:" (las saca de ahi y las muestra en grande).
Con tres fotos nuevas, esas entran en la pagina y las miniaturas desaparecen.
"""
import io
import os
import sys

import numpy as np
import pymupdf
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
ANTON = os.path.join(AQUI, "fuentes", "anton.ttf")
POPPINS = os.path.join(AQUI, "fuentes", "poppins.ttf")

OLIVA = (0.2706, 0.2392, 0.0902)      # verde oliva del folleto
CREMA = (0.9961, 0.9961, 0.9961)      # blanco de los textos

EQUIPAMIENTO = 4                      # indice de la pagina "EQUIPAMIENTO:"
TITULO = "EL INTERIOR:"
BAJADA = ["Cocina equipada, vajilla y utensilios:",
          "solo hay que llegar con las sábanas."]

# Las tres miniaturas del pie de EQUIPAMIENTO: xref y marco que ocupan.
MINIATURAS = [(59, (98.4, 175.7, 144.0, 225.6)),
              (58, (50.5, 175.7, 93.5, 225.6)),
              (57, (0, 175.7, 44.2, 225.6))]

# Huecos de la pagina nueva: (x0, y0, x1, y1) en puntos.
HUECOS = [(12, 52, 96, 162),          # foto grande, a la izquierda
          (100, 52, 132, 106),        # arriba a la derecha
          (100, 110, 132, 162)]       # abajo a la derecha

# El arroba del pie va letra por letra; estas son las posiciones exactas que
# usa el resto del folleto, para que la pagina nueva calce con las demas.
PIE = "@DOMOSELTABO"
PIE_X = [36, 44, 50, 57, 64, 70, 76, 82, 87, 92, 99, 104]
PIE_Y = 237


def sin_bordes(im, umbral=40):
    """Saca los bordes negros que dejan las capturas de pantalla."""
    a = np.asarray(im.convert("L"), dtype=float)
    filas = np.where(a.mean(axis=1) > umbral)[0]
    cols = np.where(a.mean(axis=0) > umbral)[0]
    if len(filas) == 0 or len(cols) == 0:
        return im
    return im.crop((cols[0], filas[0], cols[-1] + 1, filas[-1] + 1))


def preparar(datos, hueco, recorte=(0, 0)):
    """Deja la foto recortada al centro y en la medida exacta del hueco.

    `recorte` saca de arriba y de abajo la fraccion indicada: sirve para la
    barra de botones que queda en las capturas de pantalla.
    """
    x0, y0, x1, y1 = hueco
    objetivo = (x1 - x0) / (y1 - y0)
    im = sin_bordes(Image.open(io.BytesIO(datos)).convert("RGB"))
    arriba, abajo = (round(im.height * f) for f in recorte)
    if arriba or abajo:
        im = im.crop((0, arriba, im.width, im.height - abajo))
    if im.width / im.height > objetivo:
        ancho = round(im.height * objetivo)
        izq = (im.width - ancho) // 2
        im = im.crop((izq, 0, izq + ancho, im.height))
    else:
        alto = round(im.width / objetivo)
        borde = (im.height - alto) // 2
        im = im.crop((0, borde, im.width, borde + alto))
    ideal = round((x1 - x0) / 72 * 300)           # 300 ppp en el tamano final
    if im.width < ideal:
        im = im.resize((ideal, round(ideal / objetivo)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, subsampling=0)
    return buf.getvalue()


def copiar_adornos(adornos, pagina, saltar):
    """Repite en la pagina nueva los adornos vectoriales del folleto."""
    forma = pagina.new_shape()
    for dibujo in adornos:
        # Las manchas negras del original son sombras recortadas por la figura
        # que llevan encima; sueltas saldrian como cuadrados negros.
        if dibujo.get("fill") == (0.0, 0.0, 0.0):
            continue
        r = dibujo["rect"]
        if any(abs(r.x0 - m[0]) < 1 and abs(r.y0 - m[1]) < 1 for m in saltar):
            continue
        for tipo, *datos in dibujo["items"]:
            if tipo == "l":
                forma.draw_line(*datos)
            elif tipo == "c":
                forma.draw_bezier(*datos)
            elif tipo == "re":
                forma.draw_rect(datos[0])
            elif tipo == "qu":
                forma.draw_quad(datos[0])
        forma.finish(color=dibujo.get("color"), fill=dibujo.get("fill"),
                     width=dibujo.get("width") or 0,
                     closePath=dibujo.get("closePath", False),
                     even_odd=dibujo.get("even_odd", False),
                     fill_opacity=dibujo.get("fill_opacity") or 1,
                     stroke_opacity=dibujo.get("stroke_opacity") or 1)
    forma.commit()


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    base, salida, nuevas = sys.argv[1], sys.argv[2], sys.argv[3:]

    doc = pymupdf.open(base)
    equipamiento = doc[EQUIPAMIENTO]

    fotos = ([open(f, "rb").read() for f in nuevas] if nuevas
             else [doc.extract_image(x)["image"] for x, _ in MINIATURAS])
    if len(fotos) < 3:
        sys.exit("Hacen falta 3 fotos del interior.")
    # Las miniaturas del folleto son capturas de pantalla y hay que sacarles la
    # barra de botones; las fotos nuevas entran tal cual.
    recortes = [(0, 0)] * 3 if nuevas else [(0.09, 0.015), (0, 0), (0, 0)]

    # Los adornos se leen antes de tocar el documento: al insertar la pagina
    # nueva las paginas se renumeran y el objeto anterior queda invalido.
    adornos = equipamiento.get_drawings()
    marcos = [m[1] for m in MINIATURAS]

    # 1. Sacar las miniaturas de EQUIPAMIENTO y tapar los marcos que dejan.
    for xref, (x0, y0, x1, y1) in MINIATURAS:
        equipamiento.delete_image(xref)
        equipamiento.draw_rect(pymupdf.Rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1),
                               color=OLIVA, fill=OLIVA, width=0)

    # 2. Pagina nueva del interior, justo despues de EQUIPAMIENTO.
    pag = doc.new_page(EQUIPAMIENTO + 1, width=144, height=252)
    pag.draw_rect(pag.rect, color=OLIVA, fill=OLIVA, width=0)
    copiar_adornos(adornos, pag, marcos)

    pag.insert_font(fontname="anton", fontfile=ANTON)
    pag.insert_font(fontname="poppins", fontfile=POPPINS)
    pag.insert_text((22.1, 30), TITULO, fontname="anton", fontsize=11.7,
                    color=CREMA)

    for foto, hueco, recorte in zip(fotos[:3], HUECOS, recortes):
        pag.insert_image(pymupdf.Rect(*hueco),
                         stream=preparar(foto, hueco, recorte),
                         keep_proportion=False)

    for i, linea in enumerate(BAJADA):
        pag.insert_text((15, 180 + i * 9), linea, fontname="poppins",
                        fontsize=6, color=CREMA)

    for letra, x in zip(PIE, PIE_X):
        pag.insert_text((x, PIE_Y), letra, fontname="poppins", fontsize=4.2,
                        color=CREMA)

    doc.save(salida, garbage=3, deflate=True)
    print("listo:", salida, "-", doc.page_count, "paginas")


main()
