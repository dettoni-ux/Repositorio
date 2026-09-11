#!/usr/bin/env python3
"""Deja una foto lista para usarse de fondo del individual.

    python3 individuales/preparar-foto.py entrada.jpg playa
    python3 individuales/preparar-foto.py entrada.jpg playa --expandir

La escala y recorta al tamaño exacto de la hoja con sangrado a 300 ppp.
Con --expandir, en vez de recortar para llenar el ancho, estira la foto
espejando y difuminando los bordes: sirve cuando la foto es más angosta que
la pieza y no se quiere perder nada del motivo.

Avisa si la foto no alcanza los 300 ppp reales, que es lo que pide la imprenta.
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

AQUI = Path(__file__).parent

# Hoja con sangrado, en milímetros (tiene que coincidir con datos.mjs).
ANCHO_MM, ALTO_MM, SANGRADO_MM = 420, 300, 3
PPP = 300

HOJA_ANCHO_MM = ANCHO_MM + SANGRADO_MM * 2
HOJA_ALTO_MM = ALTO_MM + SANGRADO_MM * 2
DESTINO_ANCHO = round(HOJA_ANCHO_MM / 25.4 * PPP)
DESTINO_ALTO = round(HOJA_ALTO_MM / 25.4 * PPP)


def recortar(foto: Image.Image) -> Image.Image:
    """Escala hasta llenar la hoja y recorta lo que sobra, centrado."""
    escala = max(DESTINO_ANCHO / foto.width, DESTINO_ALTO / foto.height)
    ancho, alto = round(foto.width * escala), round(foto.height * escala)
    foto = foto.resize((ancho, alto), Image.LANCZOS)
    izq, arriba = (ancho - DESTINO_ANCHO) // 2, (alto - DESTINO_ALTO) // 2
    return foto.crop((izq, arriba, izq + DESTINO_ANCHO, arriba + DESTINO_ALTO))


def expandir(foto: Image.Image) -> Image.Image:
    """Entra la foto completa y rellena los costados espejándola y difuminándola."""
    escala = min(DESTINO_ANCHO / foto.width, DESTINO_ALTO / foto.height)
    ancho, alto = round(foto.width * escala), round(foto.height * escala)
    centro = foto.resize((ancho, alto), Image.LANCZOS)

    # Base: la misma foto estirada a pantalla completa y muy difuminada, para
    # que el relleno tenga los colores de la escena y no un borde plano.
    radio = max(DESTINO_ANCHO, DESTINO_ALTO) // 28
    fondo = recortar(foto).filter(ImageFilter.GaussianBlur(radio))

    # Encima, espejos de la foto pegados a cada borde libre.
    sobra_x, sobra_y = DESTINO_ANCHO - ancho, DESTINO_ALTO - alto
    if sobra_x > 0:
        espejo = centro.transpose(Image.FLIP_LEFT_RIGHT).filter(ImageFilter.GaussianBlur(radio // 3))
        fondo.paste(espejo, (sobra_x // 2 - ancho, sobra_y // 2))
        fondo.paste(espejo, (sobra_x // 2 + ancho, sobra_y // 2))
    if sobra_y > 0:
        espejo = centro.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(radio // 3))
        fondo.paste(espejo, (sobra_x // 2, sobra_y // 2 - alto))
        fondo.paste(espejo, (sobra_x // 2, sobra_y // 2 + alto))

    fondo.paste(centro, (sobra_x // 2, sobra_y // 2))
    return fondo


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    entrada, version = Path(sys.argv[1]), sys.argv[2]
    modo_expandir = '--expandir' in sys.argv

    foto = Image.open(entrada)
    foto = foto.convert('RGB')

    # ¿Alcanza la resolución? Se mide contra el lado que más tiene que estirarse.
    ppp_real = min(foto.width / HOJA_ANCHO_MM, foto.height / HOJA_ALTO_MM) * 25.4
    salida = expandir(foto) if modo_expandir else recortar(foto)

    destino = AQUI / 'fondos' / f'{version}.jpg'
    destino.parent.mkdir(parents=True, exist_ok=True)
    salida.save(destino, quality=94, subsampling=0, dpi=(PPP, PPP))

    print(f'{entrada.name}  {foto.width} x {foto.height} px')
    print(f'→ {destino.relative_to(AQUI.parent)}  {DESTINO_ANCHO} x {DESTINO_ALTO} px '
          f'({"expandida" if modo_expandir else "recortada"})')
    if ppp_real < 240:
        print(f'⚠ La foto original rinde {ppp_real:.0f} ppp a {HOJA_ANCHO_MM/10:.1f} x '
              f'{HOJA_ALTO_MM/10:.1f} cm. La imprenta pide 300; conviene una foto más grande.')
    elif ppp_real < 300:
        print(f'· La foto rinde {ppp_real:.0f} ppp. Se imprime bien, pero con 300 quedaría más nítida.')
    else:
        print(f'✓ Resolución de sobra: {ppp_real:.0f} ppp.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
