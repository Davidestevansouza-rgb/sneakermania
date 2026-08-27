-- =====================================================================
-- Sistema SeS — Migración 016
-- Unifica el vocabulario de estados entre los 3 lugares que antes lo
-- manejaban por separado y podían desincronizarse:
--   1) Estado de cada par individual (orden_items.estado)
--   2) Seguimiento en tiempo real (orden_items.timeline_index / ordenes.timeline_index)
--   3) Estado de la orden completa (ordenes.estado)
--
-- Flujo nuevo (el mismo para pares y para la orden):
--   Recibido y registrado → Lavado → Secado y detallado →
--   Pintado y personalizado → Finalizado → Entregado
--
-- Cambios de vocabulario:
--   - "Secado" + "Detallado" se fusionan en "Secado y detallado".
--   - "Pintado" + "Personalización" se fusionan en "Pintado y personalizado".
--   - "Reparación" se QUITA del flujo (ya no es un estado seleccionable).
--
-- Nota: el CHECK constraint de orden_items que dejó la migración 011
-- ('Lavado','Secado','Detallado y Pintado','Entregado') ya estaba
-- desactualizado frente a lo que realmente guardaba la app (Lavado,
-- Secado, Detallado, Pintado, Reparación, Finalizado, Entregado), así
-- que esta migración también corrige esa mezcla, además de sumar los
-- valores más viejos aún (de la migración 009) por si quedan filas sin
-- tocar desde entonces.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) Migrar los datos existentes de ordenes.estado al vocabulario nuevo.
-- --------------------------------------------------------------------
UPDATE ordenes SET estado = 'Recibido y registrado' WHERE estado = 'Recibido';
UPDATE ordenes SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado');
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado = 'Pintado';
-- "Reparación" ya no existe como estado: se deja en el último paso de
-- trabajo confirmado (Pintado y personalizado) para que el taller la
-- revise y la avance manualmente al estado real que le corresponda.
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado = 'Reparación';
-- 'Finalizado' y 'Entregado' se mantienen igual.

ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;
ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Finalizado','Entregado'));
ALTER TABLE ordenes ALTER COLUMN estado SET DEFAULT 'Recibido y registrado';

-- --------------------------------------------------------------------
-- 2) Migrar los datos existentes de orden_items.estado (pares
--    individuales) al mismo vocabulario nuevo. Cubre tanto los valores
--    que realmente usaba la app (Lavado/Secado/Detallado/Pintado/
--    Reparación/Finalizado/Entregado) como los más viejos que pudieran
--    haber quedado sin migrar de versiones anteriores.
-- --------------------------------------------------------------------
UPDATE orden_items SET estado = 'Recibido y registrado' WHERE estado = 'Recibido';
UPDATE orden_items SET estado = 'Lavado'                WHERE estado = 'En Lavado';
UPDATE orden_items SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado', 'En Detallado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Detallado y Pintado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado = 'Reparación';
UPDATE orden_items SET estado = 'Finalizado'            WHERE estado = 'Listo';
-- 'Finalizado' y 'Entregado' se mantienen igual.

ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;
ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Finalizado','Entregado'));
ALTER TABLE orden_items ALTER COLUMN estado SET DEFAULT 'Recibido y registrado';

SELECT 'LISTO: estados de orden y de pares unificados (Recibido y registrado → Lavado → Secado y detallado → Pintado y personalizado → Finalizado → Entregado).' AS estado;
