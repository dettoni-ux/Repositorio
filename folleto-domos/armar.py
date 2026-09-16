# -*- coding: utf-8 -*-
"""Agrega al folleto de Domos El Tabo - El Bosque una pagina dedicada al
interior de los domos: living, habitacion matrimonial, cocina y bano.

    python3 armar.py folleto.pdf salida.pdf living.jpg pieza.jpg cocina.jpg bano.jpg

Las fotos van en ese orden y se pueden dar menos de cuatro: los huecos que
queden sin foto salen marcados como pendientes, para ver como va quedando la
pagina. Las tres miniaturas que hoy van apretadas al pie de la pagina
"EQUIPAMIENTO:" se sacan de ahi en cualquier caso.
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
OLIVA_CLARO = (0.3098, 0.2745, 0.0902)
CREMA = (0.9961, 0.9961, 0.9961)      # blanco de los textos

EQUIPAMIENTO = 4                      # indice de la pagina "EQUIPAMIENTO:"
TITULO = "EL INTERIOR:"
BAJADA = ["Tres dormitorios, bano y cocina equipada:",
          "solo hay que llegar con las sabanas."]
BAJADA = [t.replace("bano", "ba\u00f1o").replace("sabanas", "s\u00e1banas")
          for t in BAJADA]

# Las tres miniaturas del pie de EQUIPAMIENTO: xref y marco que ocupan.
MINIATURAS = [(59, (98.4, 175.7, 144.0, 225.6)),
              (58, (50.5, 175.7, 93.5, 225.6)),
              (57, (0, 175.7, 44.2, 225.6))]

# Huecos de la pagina nueva, en puntos: dos filas de dos, con su etiqueta.
HUECOS = [(12, 50, 69.5, 93), (74.5, 50, 132, 93),
          (12, 107, 69.5, 150), (74.5, 107, 132, 150)]
ETIQUETAS = ["Living", "Habitaci\u00f3n matrimonial", "Cocina equipada",
             "Ba\u00f1o"]

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


def pendiente(pagina, hueco):
    """Marca un hueco todavia sin foto, para ir viendo como queda la pagina."""
    r = pymupdf.Rect(*hueco)
    pagina.draw_rect(r, color=CREMA, fill=OLIVA_CLARO, width=0.5,
                     dashes="[2 2] 0", stroke_opacity=0.55)
    pagina.insert_textbox(r + (0, r.height / 2 - 6, 0, 0), "foto pendiente",
                          fontname="poppins", fontsize=5, color=CREMA,
                          align=pymupdf.TEXT_ALIGN_CENTER, fill_opacity=0.55)


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
        # Las rayitas del cuerpo de EQUIPAMIENTO (el subrayado de OBLIGACION)
        # no son parte del fondo: solo sirven a ese texto.
        if r.height < 2 and r.y0 > 40:
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

    fotos = [open(f, "rb").read() for f in nuevas[:len(HUECOS)]]
    fotos += [None] * (len(HUECOS) - len(fotos))

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

    for foto, hueco, etiqueta in zip(fotos, HUECOS, ETIQUETAS):
        x0, y0, x1, y1 = hueco
        if foto:
            pag.insert_image(pymupdf.Rect(*hueco), stream=preparar(foto, hueco),
                             keep_proportion=False)
        else:
            pendiente(pag, hueco)
        pag.insert_text((x0, y1 + 7), etiqueta, fontname="poppins",
                        fontsize=5, color=CREMA)

    for i, linea in enumerate(BAJADA):
        pag.insert_text((12, 172 + i * 9), linea, fontname="poppins",
                        fontsize=6, color=CREMA)

    for letra, x in zip(PIE, PIE_X):
        pag.insert_text((x, PIE_Y), letra, fontname="poppins", fontsize=4.2,
                        color=CREMA)

    doc.save(salida, garbage=3, deflate=True)
    print("listo:", salida, "-", doc.page_count, "paginas")


main()
