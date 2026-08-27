-- =====================================================================
-- Sistema SeS — Migración 010
-- 1) orden_items: cada par (precinto) ahora guarda su propio tipo de
--    servicio y el empleado responsable, para poder repartir el
--    trabajo par por par en vez de por orden completa.
-- 2) registro_pares: soporta varias fotos por registro (antes solo
--    admitía una), para que el lavador suba de una vez todas las
--    fotos de los pares que terminó.
-- Ejecutar en el SQL Editor de Supabase. Es seguro correrla aunque las
-- columnas ya existan (usa IF NOT EXISTS).
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS tipo_servicio JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS responsable TEXT;

ALTER TABLE registro_pares
  ADD COLUMN IF NOT EXISTS foto_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Migra la foto única que ya existiera hacia el nuevo arreglo, para no
-- perder las fotos ya cargadas antes de esta migración.
UPDATE registro_pares
SET foto_urls = jsonb_build_array(foto_url)
WHERE foto_url IS NOT NULL AND (foto_urls IS NULL OR foto_urls = '[]'::jsonb);

SELECT 'LISTO: columnas de servicio/responsable por par y multi-foto agregadas.' AS estado;
