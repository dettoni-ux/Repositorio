-- ============================================================
-- Migración RRSS 001 — sistema de publicación automática
-- Ejecutar en la BD Neon de la plataforma (una sola vez).
-- Reversible: ver 001-rrss-revertir.sql
-- ============================================================

-- Cola de piezas de contenido. Es el punto de encuentro entre:
--   · el generador (GitHub Actions) que INSERTA piezas 'pendiente'
--   · el panel de aprobación (Vercel) que las pasa a 'aprobada'/'rechazada'
--   · el publicador (GitHub Actions) que pasa 'aprobada' → 'publicada'/'fallida'
CREATE TABLE IF NOT EXISTS rrss_piezas (
  id               serial PRIMARY KEY,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  lote             text,                          -- identificador del lote de generación
  tipo             text NOT NULL,                 -- tip | hito | vet_semana | resena | dolor_solucion | nueva_comuna
  formato          text NOT NULL DEFAULT 'post',  -- post | carrusel | historia
  estado           text NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','aprobada','rechazada','publicada','fallida')),
  fecha_programada timestamptz,                   -- cuándo debe publicarse (editable en el panel)
  caption          text NOT NULL,
  visual           jsonb NOT NULL,                -- contenido estructurado para la plantilla
  imagen_url       text,                          -- URL pública del PNG renderizado
  nota_rechazo     text,                          -- feedback: se inyecta al siguiente lote
  editado_en       timestamptz,                   -- última edición desde el panel
  publicado_en     timestamptz,
  ig_media_id      text,                          -- id devuelto por la Graph API
  error_publicacion text,                         -- último error del publicador (visible en panel)
  intentos_publicacion int NOT NULL DEFAULT 0,
  metricas         jsonb                          -- alcance/likes/comentarios/guardados a las 48 h
);

CREATE INDEX IF NOT EXISTS rrss_piezas_estado_fecha
  ON rrss_piezas (estado, fecha_programada);

-- Flag de autorización de aparición en redes sociales.
-- ⚠️ AJUSTAR el nombre de la tabla de veterinarios si difiere
-- (la sesión local conoce el esquema real; 'veterinarios' es el supuesto).
ALTER TABLE veterinarios
  ADD COLUMN IF NOT EXISTS autoriza_rrss boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN veterinarios.autoriza_rrss IS
  'El profesional autoriza aparecer en las redes sociales de EncuentraVet (editable por el vet en su panel o por admin). Nada con datos de un vet se genera si esto es false.';
