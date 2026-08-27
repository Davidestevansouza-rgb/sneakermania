-- =====================================================================
-- Sistema SeS — Migración 011
-- 1) Cada par (orden_items) ahora guarda su propia fecha de ingreso y
--    fecha estimada de entrega (antes esas fechas solo existían a
--    nivel de toda la orden).
-- 2) Se agrega el estado "Pintado" al flujo de la orden.
-- 3) El estado de cada par pasa a un set reducido: Lavado, Secado,
--    "Detallado y Pintado", Entregado (antes: Recibido/En Lavado/
--    En Detallado/Listo/Entregado).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS fecha_ingreso DATE,
  ADD COLUMN IF NOT EXISTS fecha_entrega_estimada DATE;

-- Migra los estados viejos de cada par al nuevo set reducido.
UPDATE orden_items SET estado = 'Lavado'  WHERE estado IN ('Recibido', 'En Lavado');
UPDATE orden_items SET estado = 'Detallado y Pintado' WHERE estado IN ('En Detallado', 'Listo');
-- 'Entregado' se mantiene igual.

ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;
ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Lavado','Secado','Detallado y Pintado','Entregado'));
ALTER TABLE orden_items ALTER COLUMN estado SET DEFAULT 'Lavado';

ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;
ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido','Lavado','Secado','Pintado','Reparación','Finalizado','Entregado'));

SELECT 'LISTO: fechas por par, estado "Pintado" y nuevos estados de par aplicados.' AS estado;
