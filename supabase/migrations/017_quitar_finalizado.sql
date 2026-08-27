-- =====================================================================
-- Sistema SeS — Migración 017
-- Deja de colapsar "Control de calidad" y "Biblioteca" en un único valor
-- 'Finalizado' para ordenes.estado / orden_items.estado. Ahora la base
-- acepta esos dos nombres reales, y el paso "Listo para retirar" ya no
-- existe: el seguimiento en tiempo real (y el flujo de trabajo) termina
-- en "Biblioteca".
--
-- Flujo nuevo (el mismo para pares y para la orden):
--   Recibido y registrado → Lavado → Secado y detallado →
--   Pintado y personalizado → Control de calidad → Biblioteca → Entregado
--
-- IMPORTANTE sobre el orden de los pasos: primero se QUITA el constraint
-- viejo (que todavía no permite 'Biblioteca'), recién ahí se normalizan
-- los datos, y al final se agrega el constraint nuevo.
--
-- Esta versión además NORMALIZA cualquier valor viejo/heredado que haya
-- podido quedar sin migrar (de versiones anteriores a la 016, o algún
-- NULL), no solo 'Finalizado' — por eso la primera vez pudo fallar con
-- "check constraint ... is violated by some row": había filas con un
-- valor de estado que ni la migración 016 ni esta contemplaban todavía.
-- Es seguro correrla varias veces (todas las UPDATE son idempotentes).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) ordenes.estado
-- --------------------------------------------------------------------
ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;

UPDATE ordenes SET estado = 'Recibido y registrado' WHERE estado = 'Recibido' OR estado IS NULL;
UPDATE ordenes SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado');
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Reparación');
UPDATE ordenes SET estado = 'Biblioteca'             WHERE estado IN ('Finalizado', 'Listo', 'Listo para retirar');
-- Catch-all: cualquier otro valor que no encaje en el vocabulario nuevo
-- (dato corrupto o de una versión aún más vieja) se deja en el estado
-- inicial para no romper el constraint; se puede corregir a mano después.
UPDATE ordenes SET estado = 'Recibido y registrado'
  WHERE estado NOT IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado');

ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado'));

-- --------------------------------------------------------------------
-- 2) orden_items.estado (pares individuales)
-- --------------------------------------------------------------------
ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;

UPDATE orden_items SET estado = 'Recibido y registrado' WHERE estado = 'Recibido' OR estado IS NULL;
UPDATE orden_items SET estado = 'Lavado'                WHERE estado = 'En Lavado';
UPDATE orden_items SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado', 'En Detallado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Detallado y Pintado', 'Reparación');
UPDATE orden_items SET estado = 'Biblioteca'            WHERE estado IN ('Finalizado', 'Listo', 'Listo para retirar');
-- Catch-all: mismo criterio que arriba, por si queda algún valor viejo
-- que ninguna migración anterior contempló.
UPDATE orden_items SET estado = 'Recibido y registrado'
  WHERE estado NOT IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado');

ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado'));

SELECT 'LISTO: se quitó "Finalizado" — ahora la base acepta Control de calidad y Biblioteca por separado, y el flujo termina en Biblioteca (sin Listo para retirar).' AS estado;
