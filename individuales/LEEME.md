# Individuales Domos

Manteles individuales para las mesas de Domos El Tabo, en dos versiones:
**Playa Bonita** y **Bosque**.
Mismo diseño y misma forma; cambian la foto de fondo y los textos de cada lugar.

## La forma

Arco de medio punto arriba, base recta y esquinas inferiores redondeadas —
igual que el individual de referencia. La curva se controla con un solo valor
(`medidas.curva` en `datos.mjs`): más alto, más curvo.

- Pieza troquelada: **42 × 30 cm**
- Hoja con sangrado: 42,6 × 30,6 cm (3 mm por lado)
- El PDF de imprenta lleva la línea de troquel marcada en rosa

Si la imprenta pide otra medida, se cambia en `medidas` y todo el contenido se
reacomoda solo, porque las posiciones están calculadas en proporción.

## Cómo generarlos

```bash
node individuales/generar.mjs              # las dos versiones
node individuales/generar.mjs playa        # sólo una
node individuales/generar.mjs --alta       # PNG a 300 ppp
```

En `individuales/salida/` quedan, por versión:

| Archivo | Para qué es |
|---|---|
| `.html` | El diseño autocontenido; se abre en cualquier navegador |
| `-impresion.pdf` | Hoja con sangrado y línea de troquel, para la imprenta |
| `-vista.png` | La pieza ya recortada, para revisar y mostrar |

El `.html` acepta dos variantes por URL: `?vista` (pieza troquelada, sin
sangrado) y `?sin-troquel` (hoja completa sin la línea rosada).

## Qué falta antes de imprimir

1. **Fotos de fondo** → `individuales/fondos/playa.jpg` y `individuales/fondos/bosque.jpg`
   Horizontales y grandes (ideal 5000 × 3600 px o más). Ojo: el centro de la
   pieza queda despejado a propósito, que es donde va el plato, así que conviene
   una foto con el motivo principal al centro.
2. **Logo** → `individuales/marca/logo-domos.png` (o `.svg`)
   Si no está, el diseño escribe "DOMOS" con tipografía mientras tanto.
3. **Datos** → ya están cargados en `individuales/datos.mjs`: Instagram
   @domoseltabo, los dos teléfonos, cabañaseneltabo.cl y los servicios de cada
   sector. Si quieres sumar horarios o la clave del Wi-Fi, se agregan ahí.

Mientras falte alguno, la pieza sale con una marca de "Borrador" abajo, que
desaparece sola al completar los datos.

## Archivos

| Archivo | Para qué es |
|---|---|
| `datos.mjs` | Medidas, colores y todos los textos |
| `plantilla.html` | El diseño (forma, estructura y estilos) |
| `generar.mjs` | Arma el HTML, el PDF y el PNG |
| `qr.py` | Genera el QR de Instagram en vectorial |
| `fuentes.css` | Tipografías Fraunces y Jost embebidas (no necesita internet) |
