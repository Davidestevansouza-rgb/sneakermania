-- =====================================================================
-- SneakerMania — Migración 021
-- Responsable FIJO por cada servicio registrado en un artículo/par.
-- Antes, orden_items.responsable se sobrescribía cada vez que alguien
-- registraba un servicio en Producción (Lavado, Secado y detallado,
-- Pintado y personalizado): solo quedaba visible el último. Ahora se
-- guarda, además, un registro por servicio { responsable, fecha } que
-- ya no se pisa entre sí, para que en el Detalle de la orden se vea
-- quién hizo cada paso, uno debajo del otro.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS registro_servicios JSONB NOT NULL DEFAULT '{}'::jsonb;

SELECT 'LISTO: registro_servicios (responsable fijo por servicio) agregado a orden_items.' AS estado;
