-- =====================================================================
-- Sistema SeS — Migración 015
-- Producción ligada al número de par: cada registro de producción ahora
-- guarda el CÓDIGO del par que el empleado agarró (ej. 12-1) y el
-- SERVICIO que le hizo (Lavado, Detallado, etc.). Con esto se contabiliza
-- por número de orden y se evita que dos empleados registren el MISMO
-- par para el MISMO servicio (un par lavado no se vuelve a registrar
-- como lavado, pero sí puede registrarse aparte como detallado).
-- Ejecutar en el SQL Editor de Supabase. Es seguro correrla aunque las
-- columnas ya existan (usa IF NOT EXISTS).
-- =====================================================================

ALTER TABLE registro_pares
  ADD COLUMN IF NOT EXISTS codigo   TEXT,
  ADD COLUMN IF NOT EXISTS servicio TEXT;

-- Índice para validar rápido que un (par, servicio) no se repita por tenant.
CREATE INDEX IF NOT EXISTS idx_registro_pares_codigo_servicio
  ON registro_pares(tenant_id, codigo, servicio);

SELECT 'LISTO: columnas codigo + servicio agregadas a registro_pares.' AS estado;
