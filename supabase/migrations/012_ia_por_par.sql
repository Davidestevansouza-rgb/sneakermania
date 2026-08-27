-- =====================================================================
-- Sistema SeS — Migración 012
-- El análisis con IA ahora se puede aplicar a un PAR específico
-- (precinto) de una orden, no solo a la orden en general. Cada par
-- guarda su propio resultado de análisis.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS modelo TEXT,
  ADD COLUMN IF NOT EXISTS tipo_calzado TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS material TEXT,
  ADD COLUMN IF NOT EXISTS estado_calzado TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento_sugerido TEXT;

SELECT 'LISTO: análisis de IA por par agregado a orden_items.' AS estado;
