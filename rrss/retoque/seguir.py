"""
Sigue la pantalla del teléfono a lo largo del video.

Se parte de un cuadrilátero marcado a mano en un fotograma de referencia y se
propaga hacia adelante y hacia atrás con flujo óptico: en cada paso se calcula
la homografía entre un fotograma y el siguiente usando puntos que están DENTRO
de la pantalla, y se acumula. Los puntos se vuelven a sembrar en cada paso para
que el seguimiento no se quede sin qué seguir cuando la mano tapa una parte.

Escribe cuadro.json con las cuatro esquinas por fotograma y, si se le pide,
un video de control con el cuadrilátero dibujado para revisarlo a ojo.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

AQUI = Path(__file__).parent

# Esquinas de la pantalla en el fotograma de referencia (arriba-izq, arriba-der,
# abajo-der, abajo-izq), medidas sobre el video original de 720x1280.
REF_T = 4.6
QUAD_REF = np.float32([[184, 266], [516, 259], [523, 1038], [190, 1046]])

PARAMS_LK = dict(winSize=(21, 21), maxLevel=4,
                 criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))


def puntos_dentro(gris, quad, maximo=600):
    """Puntos rastreables dentro del cuadrilátero, con un margen hacia adentro."""
    mascara = np.zeros(gris.shape, np.uint8)
    centro = quad.mean(axis=0)
    encogido = (centro + (quad - centro) * 0.94).astype(np.int32)
    cv2.fillConvexPoly(mascara, encogido, 255)
    p = cv2.goodFeaturesToTrack(gris, maxCorners=maximo, qualityLevel=0.01,
                                minDistance=7, mask=mascara, blockSize=7)
    return p


def homografia(gris_a, gris_b, quad_a):
    """Homografía que lleva el fotograma A al B, usando solo la pantalla."""
    p0 = puntos_dentro(gris_a, quad_a)
    if p0 is None or len(p0) < 12:
        return None
    p1, ok, _ = cv2.calcOpticalFlowPyrLK(gris_a, gris_b, p0, None, **PARAMS_LK)
    if p1 is None:
        return None
    # Comprobación de ida y vuelta: descarta los puntos que no vuelven a su sitio.
    p0r, ok2, _ = cv2.calcOpticalFlowPyrLK(gris_b, gris_a, p1, None, **PARAMS_LK)
    if p0r is None:
        return None
    bueno = (abs(p0 - p0r).reshape(-1, 2).max(1) < 1.5) & ok.ravel().astype(bool) & ok2.ravel().astype(bool)
    if bueno.sum() < 12:
        return None
    H, _ = cv2.findHomography(p0[bueno], p1[bueno], cv2.RANSAC, 3.0)
    return H


def seguir(ruta_video, salida_json, salida_control=None):
    cap = cv2.VideoCapture(str(ruta_video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    grises = []
    cuadros = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        cuadros.append(f)
        grises.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
    cap.release()
    n = len(grises)
    ref = min(n - 1, int(round(REF_T * fps)))
    print(f'{n} fotogramas a {fps:g} fps · referencia en el {ref} ({ref/fps:.2f}s)')

    quads = [None] * n
    quads[ref] = QUAD_REF.copy()

    for rango, paso in ((range(ref, n - 1), 1), (range(ref, 0, -1), -1)):
        for i in rango:
            j = i + paso
            H = homografia(grises[i], grises[j], quads[i])
            if H is None:
                quads[j] = quads[i].copy()
                print(f'  fotograma {j}: sin puntos suficientes, se mantiene el anterior')
                continue
            quads[j] = cv2.perspectiveTransform(quads[i].reshape(-1, 1, 2), H).reshape(4, 2)

    datos = {'fps': fps, 'ancho': cuadros[0].shape[1], 'alto': cuadros[0].shape[0],
             'quads': [q.tolist() for q in quads]}
    Path(salida_json).write_text(json.dumps(datos))
    print(f'Seguimiento guardado en {salida_json}')

    if salida_control:
        vw = cv2.VideoWriter(str(salida_control), cv2.VideoWriter_fourcc(*'mp4v'),
                             fps, (cuadros[0].shape[1], cuadros[0].shape[0]))
        for f, q in zip(cuadros, quads):
            vis = f.copy()
            cv2.polylines(vis, [q.astype(int)], True, (0, 0, 255), 3)
            vw.write(vis)
        vw.release()
        print(f'Video de control en {salida_control}')


if __name__ == '__main__':
    video = sys.argv[1]
    seguir(video, AQUI / 'cuadro.json',
           AQUI / 'control.mp4' if '--control' in sys.argv else None)
