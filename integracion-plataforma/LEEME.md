# Integración con la plataforma — instrucciones para la sesión local

Archivos que la **sesión local** (la que trabaja en `/Users/imacsophie/claude code/encuentravet`)
debe aplicar. Esta carpeta es la única interfaz entre ambos entornos: la sesión en la nube
**nunca** toca `construir.py` ni despliega a producción.

## Módulo 2 — Base de datos (aplicar ahora)

1. **`001-rrss.sql`**: ejecutarlo en la BD Neon. Antes de correrlo, **ajustar el nombre de la
   tabla de veterinarios** en el `ALTER TABLE` si no se llama `veterinarios`.
2. **Checkbox `autoriza_rrss`** en el panel del veterinario (y en la vista admin):
   - Etiqueta sugerida: «Autorizo aparecer en las redes sociales de EncuentraVet
     (por ejemplo, como “vet de la semana”)».
   - Solo escribe `true/false` en la columna nueva; ningún otro cambio.
3. **Rol de BD para el generador (recomendado)**: crear un rol con permisos limitados y
   entregar su connection string como secret `DATABASE_URL` en
   `github.com/dettoni-ux/Repositorio → Settings → Secrets and variables → Actions`:

   ```sql
   CREATE ROLE rrss_bot LOGIN PASSWORD '<generar una>';
   GRANT SELECT ON <tabla_vets>, <tabla_resenas>, <tabla_reservas> TO rrss_bot; -- ajustar nombres
   GRANT SELECT, INSERT, UPDATE ON rrss_piezas TO rrss_bot;
   GRANT USAGE ON SEQUENCE rrss_piezas_id_seq TO rrss_bot;
   ```

## Datos que la sesión en la nube todavía necesita

Súbelos a este repo (carpeta `integracion-plataforma/entrada/`) o pégalos en el chat de esa sesión:

- `marca.css` completo (para calcar variables exactas en las plantillas).
- Esquema de tablas de vets, reseñas y reservas: `pg_dump "$DATABASE_URL" --schema-only` basta.
  Con eso se reemplazan las consultas de ejemplo en `rrss/datos.mjs` (están marcadas con TODO).
- El logo oficial en PNG fondo transparente → guardarlo como `rrss/plantillas/logo.png`
  (las plantillas lo usan automáticamente; mientras no exista usan un wordmark de respaldo).
- Más adelante (módulo 5): cómo está estructurada una sección del `/panel` para calcar el estilo.

## Coordinación

- La sesión en la nube trabaja solo en `github.com/dettoni-ux/Repositorio`.
- Los PNG renderizados viven en `piezas/` de ese repo (público: es contenido destinado a Instagram).
- El estado de cada pieza vive en la tabla `rrss_piezas` de Neon: esa tabla es el contrato.
  Estados: `pendiente → aprobada|rechazada → publicada|fallida`. El publicador solo toca `aprobada`.
