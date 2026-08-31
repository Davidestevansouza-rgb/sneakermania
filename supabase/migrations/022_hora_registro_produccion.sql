-- =====================================================================
-- SneakerMania — Migración 022
-- Guarda la hora (HH:MM) en que se registró cada servicio en
-- Producción, además de la fecha, para mostrarla debajo de la fecha
-- en la tarjeta de cada registro.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE registro_pares
  ADD COLUMN IF NOT EXISTS hora TEXT;

SELECT 'LISTO: columna hora agregada a registro_pares.' AS estado;
