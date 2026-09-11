#!/usr/bin/env python3
"""Genera el QR de Instagram como SVG vectorial (nítido a cualquier tamaño)."""
import sys

import segno

url, destino = sys.argv[1], sys.argv[2]
qr = segno.make(url, error="h")          # corrección alta: aguanta manchas y dobleces
qr.save(destino, kind="svg", scale=10, border=0, dark="#0B0B0B", svgclass=None, lineclass=None)
print(f"QR generado: {destino}  ->  {url}")
