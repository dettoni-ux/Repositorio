-- Revierte 001-rrss.sql (elimina la cola y el flag). Usar solo si se desmonta el sistema.
DROP TABLE IF EXISTS rrss_piezas;
ALTER TABLE veterinarios DROP COLUMN IF EXISTS autoriza_rrss; -- ajustar nombre de tabla igual que en 001
