# -*- coding: utf-8 -*-
"""Agrega al folleto de Domos El Tabo - El Bosque las paginas del interior:
cocina, habitacion matrimonial, dormitorio de arriba y bano.

    python3 armar.py original/DOMOS_EL_TABO_BOSQUE.pdf salida.pdf

Las fotos salen de `fotos/` y las paginas se describen en PAGINAS, mas abajo:
cada una es una foto a sangre con su rotulo, o dos fotos lado a lado. Las tres
miniaturas que venian apretadas al pie de la pagina "EQUIPAMIENTO:" se sacan
de ahi, porque ahora el interior tiene paginas propias.
"""
import io
import os
import sys

import pymupdf
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
ANTON = os.path.join(AQUI, "fuentes", "anton.ttf")
POPPINS = os.path.join(AQUI, "fuentes", "poppins.ttf")
FOTOS = os.path.join(AQUI, "fotos")

ANCHO, ALTO = 144, 252                # medida de las paginas del folleto
OLIVA = (0.2706, 0.2392, 0.0902)      # verde oliva del folleto
CREMA = (0.9961, 0.9961, 0.9961)      # blanco de los textos

EQUIPAMIENTO = 4                      # indice de la pagina "EQUIPAMIENTO:"

# Las paginas nuevas, en orden. Con "foto" la imagen va a sangre y el rotulo
# encima de la franja de abajo; con "fotos" van dos lado a lado sobre el fondo
# verde, igual que el resto del folleto.
PAGINAS = [
    {"foto": "cocina.jpg",
     "titulo": "LA COCINA",
     "texto": "Refrigerador, cocina a gas, loza y utensilios."},
    {"foto": "matrimonial.jpg",
     "titulo": "PIEZA MATRIMONIAL",
     "texto": "Cama de dos plazas, veladores y televisor."},
    {"foto": "dormitorio-cupula.jpg",
     "titulo": "DORMITORIO DE ARRIBA",
     "texto": "Camas de una plaza bajo la cúpula del domo."},
    {"fotos": ["bano-ducha.jpg", "bano-wc.jpg"],
     "titulo": "EL BAÑO",
     "texto": "Ducha con agua caliente, lavamanos y ventana."},
]

# Las tres miniaturas del pie de EQUIPAMIENTO: xref y marco que ocupan.
MINIATURAS = [(59, (98.4, 175.7, 144.0, 225.6)),
              (58, (50.5, 175.7, 93.5, 225.6)),
              (57, (0, 175.7, 44.2, 225.6))]

# Huecos de la pagina de dos fotos: altos, para que el bano se vea completo.
HUECOS = [(12, 58, 69.5, 178), (74.5, 58, 132, 178)]

FRANJA = 196                          # donde empieza la franja verde de abajo
TITULO_Y, TEXTO_Y = 216, 227          # lineas de la franja

# El arroba del pie va letra por letra; estas son las posiciones exactas que
# usa el resto del folleto, para que las paginas nuevas calcen con las demas.
PIE = "@DOMOSELTABO"
PIE_X = [36, 44, 50, 57, 64, 70, 76, 82, 87, 92, 99, 104]
PIE_Y = 237


def preparar(nombre, hueco):
    """Deja la foto recortada al centro y en la medida exacta del hueco."""
    x0, y0, x1, y1 = hueco
    objetivo = (x1 - x0) / (y1 - y0)
    im = Image.open(os.path.join(FOTOS, nombre)).convert("RGB")
    if im.width / im.height > objetivo:
        ancho = round(im.height * objetivo)
        izq = (im.width - ancho) // 2
        im = im.crop((izq, 0, izq + ancho, im.height))
    else:
        alto = round(im.width / objetivo)
        borde = (im.height - alto) // 2
        im = im.crop((0, borde, im.width, borde + alto))
    ideal = round((x1 - x0) / 72 * 300)            # 300 ppp en el tamano final
    if im.width > ideal * 1.4:                     # no cargar el PDF de mas
        im = im.resize((ideal, round(ideal / objetivo)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, subsampling=0)
    return buf.getvalue()


def fuentes(pagina):
    pagina.insert_font(fontname="anton", fontfile=ANTON)
    pagina.insert_font(fontname="poppins", fontfile=POPPINS)


def titular(pagina, texto, x, y, ancho_max=118, cuerpo=11.7):
    """Escribe el titulo en Anton, achicandolo si no cabe a lo ancho."""
    letra = pymupdf.Font(fontfile=ANTON)
    while cuerpo > 6 and letra.text_length(texto, cuerpo) > ancho_max:
        cuerpo -= 0.3
    pagina.insert_text((x, y), texto, fontname="anton", fontsize=cuerpo,
                       color=CREMA)
    largo = letra.text_length(texto, cuerpo)
    pagina.draw_line(pymupdf.Point(x, y + 2.6),
                     pymupdf.Point(x + largo, y + 2.6),
                     color=CREMA, width=0.75)


def pie(pagina):
    for letra, x in zip(PIE, PIE_X):
        pagina.insert_text((x, PIE_Y), letra, fontname="poppins", fontsize=4.2,
                           color=CREMA)


def franja(pagina, desde, alto_degradado=26):
    """La franja verde de abajo, con un degradado para que la foto no corte."""
    for i in range(alto_degradado):
        y = desde - alto_degradado + i
        pagina.draw_rect(pymupdf.Rect(0, y, ANCHO, y + 1.2), color=None,
                         fill=OLIVA, width=0,
                         fill_opacity=(i / alto_degradado) ** 1.6)
    pagina.draw_rect(pymupdf.Rect(0, desde, ANCHO, ALTO), color=OLIVA,
                     fill=OLIVA, width=0)


def pagina_a_sangre(doc, indice, datos):
    """Una foto ocupando toda la pagina, con el rotulo sobre la franja."""
    pag = doc.new_page(indice, width=ANCHO, height=ALTO)
    pag.insert_image(pag.rect, stream=preparar(datos["foto"], (0, 0, ANCHO, ALTO)),
                     keep_proportion=False)
    franja(pag, FRANJA)
    fuentes(pag)
    titular(pag, datos["titulo"], 15, TITULO_Y)
    pag.insert_text((15, TEXTO_Y), datos["texto"], fontname="poppins",
                    fontsize=5.4, color=CREMA)
    pie(pag)


def pagina_dos_fotos(doc, indice, datos, adornos):
    """Dos fotos lado a lado sobre el fondo verde del folleto."""
    pag = doc.new_page(indice, width=ANCHO, height=ALTO)
    pag.draw_rect(pag.rect, color=OLIVA, fill=OLIVA, width=0)
    copiar_adornos(adornos, pag)
    fuentes(pag)
    titular(pag, datos["titulo"], 22.1, 30)
    for nombre, hueco in zip(datos["fotos"], HUECOS):
        pag.insert_image(pymupdf.Rect(*hueco), stream=preparar(nombre, hueco),
                         keep_proportion=False)
    pag.insert_text((12, 194), datos["texto"], fontname="poppins", fontsize=5.4,
                    color=CREMA)
    pie(pag)


def copiar_adornos(adornos, pagina):
    """Repite en la pagina nueva los adornos vectoriales del folleto."""
    forma = pagina.new_shape()
    for dibujo in adornos:
        # Las manchas negras del original son sombras recortadas por la figura
        # que llevan encima; sueltas saldrian como cuadrados negros.
        if dibujo.get("fill") == (0.0, 0.0, 0.0):
            continue
        r = dibujo["rect"]
        if any(abs(r.x0 - m[0]) < 1 and abs(r.y0 - m[1]) < 1
               for _, m in MINIATURAS):
            continue
        # Las rayitas del cuerpo de EQUIPAMIENTO (el subrayado de OBLIGACION y
        # el del titulo) no son fondo: solo sirven a ese texto.
        if r.height < 2:
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
    base, salida = sys.argv[1], sys.argv[2]

    doc = pymupdf.open(base)
    equipamiento = doc[EQUIPAMIENTO]

    # Los adornos se leen antes de tocar el documento: al insertar las paginas
    # nuevas las paginas se renumeran y el objeto anterior queda invalido.
    adornos = equipamiento.get_drawings()

    # Sacar las miniaturas de EQUIPAMIENTO y tapar los marcos que dejan.
    for xref, (x0, y0, x1, y1) in MINIATURAS:
        equipamiento.delete_image(xref)
        equipamiento.draw_rect(pymupdf.Rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1),
                               color=OLIVA, fill=OLIVA, width=0)

    for i, datos in enumerate(PAGINAS):
        indice = EQUIPAMIENTO + 1 + i
        if "fotos" in datos:
            pagina_dos_fotos(doc, indice, datos, adornos)
        else:
            pagina_a_sangre(doc, indice, datos)

    doc.save(salida, garbage=3, deflate=True)
    print("listo:", salida, "-", doc.page_count, "paginas")


main()
