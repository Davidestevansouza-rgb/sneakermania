-- =====================================================================
-- Sistema SeS — Migración 006
-- Papelera de clientes: agrega la columna `eliminada` a la tabla
-- `clientes` para poder "enviar a la papelera" en vez de borrar de una.
-- (La papelera de ÓRDENES no necesita migración: ese registro ya se
-- guarda completo en la columna `extra`, así que el campo `eliminada`
-- viaja solo ahí sin tocar el esquema.)
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
-- =====================================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS eliminada BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_clientes_eliminada ON clientes(tenant_id, eliminada);

SELECT 'LISTO: columna eliminada agregada a clientes.' AS estado;
