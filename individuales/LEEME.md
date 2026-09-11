# Individuales Domos

Manteles individuales para las mesas, en dos versiones: **Playa Bonita** y **Bosque**.
Mismo diseño, cambian la foto de fondo, la paleta y los textos de cada lugar.

- Medida final: **42 × 29,7 cm** (A3 apaisado)
- Con sangrado: 42,6 × 30,3 cm (3 mm por lado)
- Margen de seguridad: 1,3 cm desde el borde de corte

## Cómo generarlos

```bash
node individuales/generar.mjs              # las dos versiones
node individuales/generar.mjs playa        # sólo una
node individuales/generar.mjs --alta       # PNG a 300 ppp (además del PDF)
```

Todo queda en `individuales/salida/`: `.html` (autocontenido), `.pdf` (para la
imprenta) y `.png` (para revisar en pantalla).

## Qué hay que poner antes de imprimir

1. **Fotos de fondo** → `individuales/fondos/playa.jpg` y `individuales/fondos/bosque.jpg`
   Horizontales, lo más grandes posible (ideal 5000 × 3600 px o más).
2. **Logo** → `individuales/marca/logo-domos.png` (o `.svg`)
   Si no está, el diseño escribe "DOMOS" con tipografía mientras tanto.
3. **Datos** → `individuales/datos.mjs`: cuenta de Instagram, WhatsApp, web,
   correo, clave del Wi-Fi, horarios y servicios reales.

Mientras falte alguno de esos datos, la pieza sale con una marca de
"Borrador" abajo a la izquierda, que desaparece sola al completarlos.

## Archivos

| Archivo | Para qué es |
|---|---|
| `datos.mjs` | Todos los textos y colores editables |
| `plantilla.html` | El diseño (estructura y estilos) |
| `generar.mjs` | Arma el HTML, el PDF y el PNG |
| `qr.py` | Genera el QR de Instagram en vectorial |
| `fuentes.css` | Tipografías Fraunces y Jost embebidas (no necesita internet) |
