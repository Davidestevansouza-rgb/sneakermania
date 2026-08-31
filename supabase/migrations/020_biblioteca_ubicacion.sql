-- =====================================================================
-- Sistema SeS — Migración 020
-- Ubicación en estantería de Biblioteca, por par (orden_items).
-- Guarda dónde quedó guardado cada artículo (letra + número de
-- estante), cuándo se registró (fecha y hora) y quién lo registró.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS biblioteca JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Estructura esperada del campo "biblioteca" (JSON, todo opcional):
--   { "ubicacion": "H1", "fecha": "2026-08-29", "hora": "14:32", "usuario": "Juan" }

SELECT 'LISTO: ubicación de estantería (biblioteca) agregada a orden_items.' AS estado;
