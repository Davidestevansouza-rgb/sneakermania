-- =====================================================================
-- Sistema SeS — Migración 013
-- Seguimiento en tiempo real INDIVIDUAL por par (orden_items).
-- Antes el "Seguimiento en tiempo real" (las 9 etapas: Recibido,
-- Lavado, Secado, Detallado, Pintura, Personalización, Control de
-- calidad, Biblioteca, Listo) vivía a nivel de toda la orden, así que
-- si una orden tenía pares con distinta fecha de entrega (ej. 2 pares
-- Exprés a 3 días y otros a 7 días) no se podía distinguir el avance
-- de cada uno. Ahora cada par guarda su propio avance.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS timeline_index INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeline_dates JSONB NOT NULL DEFAULT '{}'::jsonb;

SELECT 'LISTO: seguimiento en tiempo real por par (timeline_index, timeline_dates) agregado a orden_items.' AS estado;
