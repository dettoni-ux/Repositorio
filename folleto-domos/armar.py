# -*- coding: utf-8 -*-
"""Agrega paginas del interior a los folletos de Domos El Tabo.

    python3 armar.py            # los dos folletos
    python3 armar.py playa      # solo uno (bosque | playa)

Cada folleto se describe en FOLLETOS: de donde sale, a donde va, en que
carpeta estan sus fotos y que paginas hay que agregar despues de la de
equipamiento. Una pagina lleva una foto a sangre o dos lado a lado, nunca
mas de dos. El color, los adornos y las miniaturas que hay que sacar se leen
del propio folleto, asi que el del Bosque sale verde y el de Playa Bonita
azul sin tener que configurar nada.
"""
import io
import os
import sys

import pymupdf
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
ANTON = os.path.join(AQUI, "fuentes", "anton.ttf")
POPPINS = os.path.join(AQUI, "fuentes", "poppins.ttf")

ANCHO, ALTO = 144, 252                 # medida de las paginas del folleto
CREMA = (0.9961, 0.9961, 0.9961)       # blanco de los textos
MARCA = "DOMOS EL TABO  ·  GLAMPING CHILE"

FOLLETOS = {
    "bosque": {
        "base": "original/DOMOS_EL_TABO_BOSQUE.pdf",
        "salida": "DOMOS_EL_TABO_BOSQUE-con-interior.pdf",
        "fotos": "fotos",
        "equipamiento": 4,
        # Fotos de fondo que se reemplazan en paginas que ya existen: la
        # portada y la pagina siguiente. El logo, la franja y los textos se
        # quedan donde estaban.
        "fondos": [
            {"pagina": 0, "foto": "recinto-jardin.jpg"},
            {"pagina": 1, "foto": "domo-noche.jpg"},
        ],
        "paginas": [
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
            # De aqui para abajo son las diapos del recinto. Las fotos todavia
            # no llegan: mientras falten, el script salta la diapo y avisa.
            # Basta dejar los archivos en fotos/ con estos nombres.
            {"fotos": ["juegos-infantiles-1.jpg", "juegos-infantiles-2.jpg"],
             "titulo": "PARQUE INFANTIL",
             "texto": "Juegos al aire libre para los mas chicos."},
            {"fotos": ["sala-juegos-1.jpg", "sala-juegos-2.jpg"],
             "titulo": "SALA DE JUEGOS",
             "texto": "Entretencion bajo techo para toda la familia."},
            {"fotos": ["gimnasio-1.jpg", "gimnasio-2.jpg"],
             "titulo": "EL GIMNASIO",
             "texto": "Maquinas, mancuernas y bicicletas, para no perder el "
                      "ritmo en vacaciones."},
            {"foto": "terraza-quitasol.jpg",
             "titulo": "TERRAZA CON QUITASOL",
             "texto": "Sombra y mesa para el almuerzo al aire libre."},
            # Provisoria: la foto sale del propio folleto (es el fondo de la
            # pagina "IDEAL PARA"), asi que por ahora aparece dos veces.
            # Cuando lleguen las fotos buenas, esto pasa a ser una diapo de
            # dos: {"fotos": ["piscina-1.jpg", "piscina-2.jpg"], ...}.
            {"foto": "piscina.jpg", "hasta_franja": True, "ancla": 1,
             "titulo": "LA PISCINA",
             "texto": "Piscina al aire libre, rodeada de arboles."},
            {"foto": "asadera-1.jpg",
             "titulo": "ASADERAS Y TERRAZA",
             "texto": "Parrilla, horno de barro y mesa a la sombra del "
                      "quitasol."},
        ],
    },
    "playa": {
        "base": "original/DOMOS_EL_TABO_PLAYA_BONITA.pdf",
        "salida": "DOMOS_EL_TABO_PLAYA_BONITA-con-interior.pdf",
        "fotos": "fotos-playa",
        "equipamiento": 4,
        "paginas": [
            {"foto": "exterior-atardecer.jpg",
             "titulo": "A PASOS DEL MAR",
             "texto": "El pasillo del recinto termina en la playa."},
            {"fotos": ["living-comedor.jpg", "living-escalera.jpg"],
             "titulo": "EL LIVING",
             "texto": "Sofá, comedor y escalera de caracol al segundo piso."},
            {"fotos": ["matrimonial-cupula.jpg", "matrimonial-tv.jpg"],
             "titulo": "PIEZA MATRIMONIAL",
             "texto": "Cama de dos plazas, veladores y televisor."},
            {"foto": "dormitorio-arriba.jpg",
             "titulo": "DORMITORIO DE ARRIBA",
             "texto": "Tres camas de una plaza bajo la cúpula."},
            {"foto": "cocina-amplia.jpg",
             "titulo": "LA COCINA",
             "texto": "Refrigerador, cocina a gas y agua caliente."},
            {"fotos": ["cocina-muebles.jpg", "copas.jpg"],
             "titulo": "TODO PUESTO",
             "texto": "Loza, copas, ollas y utensilios en los muebles."},
            {"foto": "bano.jpg",
             "titulo": "EL BAÑO",
             "texto": "Espejo iluminado, agua caliente y madera en los muros."},
            {"fotos": ["terraza-quincho.jpg", "exterior-palmera.jpg"],
             "titulo": "TERRAZA Y QUINCHO",
             "texto": "Mesa al aire libre, sombrilla y quincho propio."},
        ],
    },
}

# Huecos de la pagina de dos fotos: (x0, y0, x1, y1) en puntos.
HUECOS = [(12, 54, 69.5, 176), (74.5, 54, 132, 176)]
TEXTO_2F = 194                         # bajada de la pagina de dos fotos
TITULO_2F = 40

FRANJA = 190                           # donde empieza la franja de abajo
TITULO_Y, TEXTO_Y = 209, 220           # lineas de la franja
MARCA_Y = 245                          # la marca, al pie de la pagina

# El arroba del pie va letra por letra; estas son las posiciones exactas que
# usa el resto del folleto, para que las paginas nuevas calcen con las demas.
PIE = "@DOMOSELTABO"
PIE_X = [36, 44, 50, 57, 64, 70, 76, 82, 87, 92, 99, 104]
PIE_Y = 237


def preparar(ruta, hueco, ancla=0.5, ancla_x=0.5, girar=0):
    """Deja la foto recortada y en la medida exacta del hueco.

    `ancla` dice de que parte de la foto se toma cuando hay que recortarla a
    lo alto: 0 el borde de arriba, 0.5 el centro, 1 el de abajo. `ancla_x`
    hace lo mismo a lo ancho: 0 la izquierda, 1 la derecha. `girar` deja la
    foto acostada, para las que el PDF guarda de lado y muestra rotadas.
    """
    x0, y0, x1, y1 = hueco
    objetivo = (x1 - x0) / (y1 - y0)
    im = Image.open(ruta).convert("RGB")
    if im.width / im.height > objetivo:
        ancho = round(im.height * objetivo)
        izq = round((im.width - ancho) * ancla_x)
        im = im.crop((izq, 0, izq + ancho, im.height))
    else:
        alto = round(im.width / objetivo)
        borde = round((im.height - alto) * ancla)
        im = im.crop((0, borde, im.width, borde + alto))
    ideal = round((x1 - x0) / 72 * 300)             # 300 ppp en el tamano final
    if im.width > ideal * 1.4:                      # no cargar el PDF de mas
        im = im.resize((ideal, round(ideal / objetivo)), Image.LANCZOS)
    if girar:
        im = im.transpose(Image.ROTATE_90 if girar == 90 else Image.ROTATE_270)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, subsampling=0)
    return buf.getvalue()


def fuentes(pagina):
    pagina.insert_font(fontname="anton", fontfile=ANTON)
    pagina.insert_font(fontname="poppins", fontfile=POPPINS)


def espaciado(pagina, texto, y, cuerpo=4.2, separacion=1.5):
    """Escribe centrado y con las letras separadas, como el pie del folleto."""
    letra = pymupdf.Font(fontfile=POPPINS)
    largo = (letra.text_length(texto, cuerpo)
             + separacion * max(len(texto) - 1, 0))
    x = (ANCHO - largo) / 2
    for caracter in texto:
        pagina.insert_text((x, y), caracter, fontname="poppins",
                           fontsize=cuerpo, color=CREMA)
        x += letra.text_length(caracter, cuerpo) + separacion


def bajada(pagina, texto, x, y, ancho, cuerpo=5.4, salto=7):
    """Escribe la bajada cortandola en lineas para que no se salga."""
    letra = pymupdf.Font(fontfile=POPPINS)
    lineas, actual = [], ""
    for palabra in texto.split():
        prueba = f"{actual} {palabra}".strip()
        if letra.text_length(prueba, cuerpo) > ancho and actual:
            lineas.append(actual)
            actual = palabra
        else:
            actual = prueba
    lineas.append(actual)
    for i, linea in enumerate(lineas):
        pagina.insert_text((x, y + i * salto), linea, fontname="poppins",
                           fontsize=cuerpo, color=CREMA)


def titular(pagina, texto, x, y, ancho_max=118, cuerpo=11.7):
    """Escribe el titulo en Anton, achicandolo si no cabe a lo ancho."""
    letra = pymupdf.Font(fontfile=ANTON)
    while cuerpo > 6 and letra.text_length(texto, cuerpo) > ancho_max:
        cuerpo -= 0.3
    pagina.insert_text((x, y), texto, fontname="anton", fontsize=cuerpo,
                       color=CREMA)
    pagina.draw_line(pymupdf.Point(x, y + 2.6),
                     pymupdf.Point(x + letra.text_length(texto, cuerpo), y + 2.6),
                     color=CREMA, width=0.75)


def pie(pagina):
    for letra, x in zip(PIE, PIE_X):
        pagina.insert_text((x, PIE_Y), letra, fontname="poppins", fontsize=4.2,
                           color=CREMA)


def velo(pagina, color, desde, hasta, pasos=256):
    """Degradado del color del folleto, para que la foto no corte en seco.

    Va como imagen con transparencia: pintarlo con rectangulos deja bandas.
    """
    rgb = tuple(round(c * 255) for c in color)
    tira = Image.new("RGBA", (2, pasos))
    for y in range(pasos):
        alfa = round(255 * (y / (pasos - 1)) ** 1.7)
        for x in (0, 1):
            tira.putpixel((x, y), rgb + (alfa,))
    buf = io.BytesIO()
    tira.save(buf, "PNG")
    pagina.insert_image(pymupdf.Rect(0, desde, ANCHO, hasta),
                        stream=buf.getvalue(), keep_proportion=False)


def pagina_a_sangre(doc, indice, datos, color, fotos):
    """Una foto ocupando toda la pagina, con el rotulo sobre la franja.

    Con "hasta_franja" la foto llega solo hasta donde empieza la franja, en
    vez de correr por debajo: sirve cuando lo que hay que mostrar esta en el
    borde de abajo y la franja se lo comeria.
    """
    pag = doc.new_page(indice, width=ANCHO, height=ALTO)
    hueco = (0, 0, ANCHO, FRANJA if datos.get("hasta_franja") else ALTO)
    pag.insert_image(pymupdf.Rect(*hueco), keep_proportion=False,
                     stream=preparar(os.path.join(fotos, datos["foto"]), hueco,
                                     datos.get("ancla", 0.5)))
    velo(pag, color, FRANJA - 30, FRANJA)
    pag.draw_rect(pymupdf.Rect(0, FRANJA, ANCHO, ALTO), color=color, fill=color,
                  width=0)
    fuentes(pag)
    titular(pag, datos["titulo"], 15, TITULO_Y)
    bajada(pag, datos["texto"], 15, TEXTO_Y, 114)
    pie(pag)
    espaciado(pag, MARCA, MARCA_Y, cuerpo=3.8, separacion=1.1)


def pagina_dos_fotos(doc, indice, datos, color, fotos, adornos, saltar):
    """Dos fotos lado a lado sobre el fondo del folleto."""
    pag = doc.new_page(indice, width=ANCHO, height=ALTO)
    pag.draw_rect(pag.rect, color=color, fill=color, width=0)
    copiar_adornos(adornos, pag, saltar)
    fuentes(pag)
    titular(pag, datos["titulo"], 15, TITULO_2F)
    for nombre, hueco in zip(datos["fotos"], HUECOS):
        pag.insert_image(pymupdf.Rect(*hueco), keep_proportion=False,
                         stream=preparar(os.path.join(fotos, nombre), hueco))
    bajada(pag, datos["texto"], 12, TEXTO_2F, 120)
    pie(pag)
    espaciado(pag, MARCA, MARCA_Y, cuerpo=3.8, separacion=1.1)


def copiar_adornos(adornos, pagina, saltar=(), solo=None):
    """Repite en la pagina los adornos vectoriales del folleto.

    Con `solo` se redibujan nada mas los que tocan esos rectangulos: sirve
    para devolver las rayas de la esquina que tapan los parches.
    """
    forma = pagina.new_shape()
    for dibujo in adornos:
        r = dibujo["rect"]
        if solo is not None:
            if r.width >= ANCHO - 1 and r.height >= ALTO - 1:
                continue                      # el fondo, que ya esta puesto
            if not any(r.intersects(q) for q in solo):
                continue
        # Lo negro del original son sombras recortadas por la figura que
        # llevan encima y los recuadros de las miniaturas; sueltos saldrian
        # como manchas y marcos en medio de la pagina.
        if (0.0, 0.0, 0.0) in (dibujo.get("fill"), dibujo.get("color")):
            continue
        if any(r.intersects(q) for q in saltar):
            continue
        # Las rayitas del cuerpo de la pagina (vinetas y subrayados) no son
        # fondo: solo sirven al texto que acompanan.
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


def cambiar_fondos(doc, folleto, fotos):
    """Cambia fotos de fondo de paginas que ya existen.

    `replace_image` cambia la imagen en su lugar, asi que el logo, la franja
    y los textos que van arriba quedan igual que estaban.
    """
    puestas = []
    for datos in folleto.get("fondos", []):
        if cambiar_fondo(doc, datos, fotos):
            puestas.append(f"pagina {datos.get('pagina', 0) + 1}: {datos['foto']}")
    return puestas


def cambiar_fondo(doc, datos, fotos):
    if not os.path.exists(os.path.join(fotos, datos["foto"])):
        return False
    pagina = doc[datos.get("pagina", 0)]
    # La foto de fondo es la imagen mas grande de la pagina; la otra es el logo.
    fondo = max(((r, imagen[0]) for imagen in pagina.get_images(full=True)
                 for r in pagina.get_image_rects(imagen[0])),
                key=lambda par: abs(par[0]))
    marco, xref = fondo
    # El folleto guarda esa foto acostada y la muestra rotada; como
    # `replace_image` conserva la colocacion, hay que entregarla igual de
    # acostada o sale de lado.
    a, b, c, _ = next(i["transform"][:4] for i in pagina.get_image_info(xrefs=True)
                      if i["xref"] == xref)
    girar = 0 if abs(a) >= abs(b) else (90 if b > 0 else 270)
    pagina.replace_image(xref, stream=preparar(
        os.path.join(fotos, datos["foto"]), tuple(marco),
        datos.get("ancla", 0.5), datos.get("ancla_x", 0.5), girar))
    return True


def color_del_folleto(adornos):
    """El color de fondo: el ultimo relleno que cubre la pagina entera."""
    color = None
    for dibujo in adornos:
        r = dibujo["rect"]
        if dibujo.get("fill") and r.width >= ANCHO - 1 and r.height >= ALTO - 1:
            color = dibujo["fill"]
    return color


def miniaturas(pagina):
    """Las fotitas al pie de la pagina de equipamiento: xrefs y donde se ven.

    Los recuadros salen del texto de la pagina y no de `get_image_rects`,
    porque ese devuelve la caja sin recortar, bastante mas grande que la
    parte que de verdad se ve.
    """
    xrefs = [imagen[0] for imagen in pagina.get_images(full=True)]
    marcos = [pymupdf.Rect(b["bbox"])
              for b in pagina.get_text("dict")["blocks"] if b["type"] == 1]
    return xrefs, marcos


def armar(clave, folleto):
    base = os.path.join(AQUI, folleto["base"])
    salida = os.path.join(AQUI, folleto["salida"])
    fotos = os.path.join(AQUI, folleto["fotos"])

    doc = pymupdf.open(base)
    fondos = cambiar_fondos(doc, folleto, fotos)
    equipamiento = doc[folleto["equipamiento"]]

    # Todo lo que se lee de la pagina hay que leerlo antes de tocar el
    # documento: al insertar paginas se renumera y el objeto queda invalido.
    adornos = equipamiento.get_drawings()
    color = color_del_folleto(adornos)
    xrefs, marcos = miniaturas(equipamiento)

    # Sacar las miniaturas apretadas del pie y tapar los recuadros que dejan.
    for xref in xrefs:
        equipamiento.delete_image(xref)
    pisa_el_pie, parches = False, []
    for marco in marcos:
        parche = marco + (-1.5, -1.5, 1.5, 1.5)
        parches.append(parche)
        equipamiento.draw_rect(parche, color=color, fill=color, width=0)
        # En Playa Bonita las fotitos llegan hasta abajo y el arroba va encima
        # de ellas: al taparlas se tapa tambien, asi que hay que reescribirlo.
        if marco.y1 > PIE_Y - 6:
            pisa_el_pie = True
    if pisa_el_pie:
        # Se tapa la franja entera del arroba y se vuelve a escribir: si no,
        # las letras que caian en los huecos entre fotitos quedan dobles.
        equipamiento.draw_rect(pymupdf.Rect(28, PIE_Y - 8, 116, PIE_Y + 3),
                               color=color, fill=color, width=0)
        parches.append(pymupdf.Rect(28, PIE_Y - 8, 116, PIE_Y + 3))
        fuentes(equipamiento)
        pie(equipamiento)

    # Los parches tapan parte de los adornos de la esquina: se redibujan.
    copiar_adornos(adornos, equipamiento, solo=parches)

    indice, faltan = folleto["equipamiento"] + 1, []
    for datos in folleto["paginas"]:
        pendientes = [n for n in datos.get("fotos", [datos.get("foto")])
                      if not os.path.exists(os.path.join(fotos, n))]
        if pendientes:                 # la diapo espera a que lleguen sus fotos
            faltan.append(f"{datos['titulo']} ({', '.join(pendientes)})")
            continue
        if "fotos" in datos:
            pagina_dos_fotos(doc, indice, datos, color, fotos, adornos, marcos)
        else:
            pagina_a_sangre(doc, indice, datos, color, fotos)
        indice += 1

    doc.save(salida, garbage=3, deflate=True)
    print(f"{clave}: {os.path.basename(salida)} - {doc.page_count} paginas")
    for puesta in fondos:
        print(f"  fondo {puesta}")
    for pendiente in faltan:
        print(f"  falta: {pendiente}")


def main():
    pedidos = sys.argv[1:] or list(FOLLETOS)
    for clave in pedidos:
        if clave not in FOLLETOS:
            sys.exit(f"No conozco el folleto '{clave}'. Hay: {', '.join(FOLLETOS)}")
        armar(clave, FOLLETOS[clave])


main()
