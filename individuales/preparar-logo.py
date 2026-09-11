#!/usr/bin/env python3
"""Deja el logo listo para ir sobre la foto: le saca el fondo blanco.

    python3 individuales/preparar-logo.py logo.jpg

Guarda individuales/marca/logo-domos.png con transparencia y recortado al
contenido, para que sobre la foto no aparezca el recuadro blanco.

Si tenés el logo en vector (.svg, .ai, .pdf, .eps), usá ese en vez de esto:
imprime perfecto a cualquier tamaño. Este script es para cuando sólo hay un
JPG o un PNG con fondo blanco.
"""
import sys
from pathlib import Path

from PIL import Image

AQUI = Path(__file__).parent

# Un pixel a menos de UMBRAL_FUERA del blanco se borra del todo; pasando
# UMBRAL_DENTRO queda opaco. En el medio, transparencia gradual: así los
# bordes quedan suaves y no dentados.
UMBRAL_FUERA, UMBRAL_DENTRO = 8, 30


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    entrada = Path(sys.argv[1])
    logo = Image.open(entrada).convert('RGB')
    ancho, alto = logo.size

    pixeles = logo.load()
    alfa = Image.new('L', logo.size)
    ap = alfa.load()
    for y in range(alto):
        for x in range(ancho):
            r, g, b = pixeles[x, y]
            distancia = 255 - min(r, g, b)          # qué tan lejos está del blanco
            if distancia <= UMBRAL_FUERA:
                ap[x, y] = 0
            elif distancia >= UMBRAL_DENTRO:
                ap[x, y] = 255
            else:
                ap[x, y] = round(255 * (distancia - UMBRAL_FUERA) / (UMBRAL_DENTRO - UMBRAL_FUERA))

    salida = logo.convert('RGBA')
    salida.putalpha(alfa)

    recorte = salida.getbbox()                       # saca el aire blanco de alrededor
    if recorte:
        salida = salida.crop(recorte)

    destino = AQUI / 'marca' / 'logo-domos.png'
    destino.parent.mkdir(parents=True, exist_ok=True)
    salida.save(destino)

    print(f'{entrada.name}  {ancho} x {alto} px')
    print(f'→ {destino.relative_to(AQUI.parent)}  {salida.width} x {salida.height} px, fondo transparente')
    if salida.width < 1200:
        print(f'⚠ Con {salida.width} px de ancho el logo se va a ver blando impreso. '
              f'Conviene el vector o una copia de 2000 px o más.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
