"""
Compone la pantalla nueva sobre el teléfono, fotograma a fotograma.

Tres cuidados para que no se vea como una calcomanía pegada encima:

  · Los dedos van por delante. Se detecta la piel dentro de la pantalla y esos
    píxeles se dejan como estaban; si no, la mano desaparecería tras la imagen.
  · Se conserva el brillo del original. La pantalla real tiene reflejos y un
    degradado de luz; se multiplican sobre la imagen nueva.
  · El borde va difuminado un par de píxeles, porque un canto perfecto delata
    el montaje.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

AQUI = Path(__file__).parent


def mascara_dedos(bgr, quad):
    """
    Dedos que tapan la pantalla.

    No basta con buscar piel: los botones dorados de la app original caen en el
    mismo rango de color y se colaban por encima de la interfaz nueva. La
    diferencia es geométrica, no de color: una mano ENTRA desde fuera de la
    pantalla, y un botón está entero dentro. Así que solo se conservan las
    manchas de piel que además tienen píxeles fuera del cuadrilátero.
    """
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    piel = cv2.inRange(ycrcb, np.array([50, 136, 80]), np.array([255, 178, 126]))

    # Los botones dorados de la app vieja caen en el rango de la piel, pero son
    # mucho más saturados: la piel nunca llega a ese amarillo. Se descartan
    # antes de agrupar, si no arrastran a la mano entera.
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    dorado = cv2.inRange(hsv, np.array([14, 105, 110]), np.array([38, 255, 255]))
    piel = cv2.bitwise_and(piel, cv2.bitwise_not(dorado))

    piel = cv2.morphologyEx(piel, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    piel = cv2.morphologyEx(piel, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))

    h, w = piel.shape
    dentro = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(dentro, quad.astype(np.int32), 255)
    dentro = cv2.erode(dentro, np.ones((9, 9), np.uint8))

    n, etiquetas = cv2.connectedComponents(piel)
    fuera = piel & (dentro == 0)
    validas = set(np.unique(etiquetas[fuera > 0])) - {0}
    dedos = np.isin(etiquetas, list(validas)).astype(np.uint8) * 255
    return cv2.GaussianBlur(dedos, (9, 9), 0)


def componer(ruta_video, ruta_pantalla, ruta_quads, salida):
    datos = json.loads(Path(ruta_quads).read_text())
    quads = [np.float32(q) for q in datos['quads']]
    ui = cv2.imread(str(ruta_pantalla), cv2.IMREAD_COLOR)
    hu, wu = ui.shape[:2]
    esquinas_ui = np.float32([[0, 0], [wu, 0], [wu, hu], [0, hu]])

    cap = cv2.VideoCapture(str(ruta_video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vw = cv2.VideoWriter(str(salida), cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))

    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        q = quads[i] if i < len(quads) else quads[-1]
        H = cv2.getPerspectiveTransform(esquinas_ui, q)
        ui_warp = cv2.warpPerspective(ui, H, (w, h), flags=cv2.INTER_AREA)

        # Zona de la pantalla, con el borde suavizado.
        base = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(base, q.astype(np.int32), 255)
        base = cv2.erode(base, np.ones((3, 3), np.uint8))
        base = cv2.GaussianBlur(base, (5, 5), 0)

        # Los dedos se quedan delante.
        piel = mascara_dedos(f, q)
        alfa = np.clip(base.astype(int) - piel.astype(int), 0, 255).astype(np.uint8)
        alfa = cv2.GaussianBlur(alfa, (5, 5), 0)

        # El brillo del original le devuelve los reflejos a la pantalla nueva.
        luma = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        luz = cv2.GaussianBlur(luma, (0, 0), 12)
        luz = np.clip(0.80 + 0.42 * (luz - luz[base > 128].mean() if (base > 128).any() else 0), 0.72, 1.22)
        ui_luz = np.clip(ui_warp.astype(np.float32) * luz[..., None], 0, 255)

        a = (alfa.astype(np.float32) / 255.0)[..., None]
        f[:] = np.clip(f.astype(np.float32) * (1 - a) + ui_luz * a, 0, 255).astype(np.uint8)
        vw.write(f)
        i += 1

    cap.release()
    vw.release()
    print(f'Compuesto {i} fotogramas → {salida}')


if __name__ == '__main__':
    componer(sys.argv[1], AQUI / 'pantalla.png', AQUI / 'cuadro.json',
             sys.argv[2] if len(sys.argv) > 2 else AQUI / 'con-pantalla.mp4')
