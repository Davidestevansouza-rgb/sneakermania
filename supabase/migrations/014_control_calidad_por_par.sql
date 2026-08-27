-- =====================================================================
-- Sistema SeS — Migración 014
-- Control de calidad INDIVIDUAL por par (orden_items).
-- El checklist de control de calidad (limpieza, costuras, cordones,
-- pintura, pegado, suela, plantillas, fotos) vivía solo a nivel de
-- toda la orden. Como el "Seguimiento en tiempo real" pasó a ser por
-- par (migración 013), el botón "Abrir control de calidad" del paso
-- calidad necesita su propio checklist por par también.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS control_calidad JSONB NOT NULL DEFAULT '{}'::jsonb;

SELECT 'LISTO: control de calidad por par (control_calidad) agregado a orden_items.' AS estado;
