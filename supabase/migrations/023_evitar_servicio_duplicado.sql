-- =====================================================================
-- SneakerMania — Migración 023
-- Evita, A NIVEL DE BASE DE DATOS, que el mismo servicio quede registrado
-- dos veces para el mismo artículo/par dentro de un mismo tenant.
--
-- Antes, la única validación era del lado del cliente (ver registrarPares
-- en produccion.js): antes de guardar, se revisaba si ya existía un
-- registro con el mismo (codigo, servicio) en la copia local de los
-- datos (state.registroPares). Esa copia local puede estar desactualizada
-- (dos personas registrando casi al mismo tiempo desde dispositivos
-- distintos, o una caché que todavía no se refrescó), así que ese chequeo
-- por sí solo NO alcanza para evitar la condición de carrera: dos
-- registros para el mismo par + mismo servicio podían pasar la validación
-- en el cliente casi al mismo tiempo y terminar los dos guardados en la
-- base de datos. El índice que ya existía (idx_registro_pares_codigo_servicio,
-- migración 015) tampoco lo evitaba: es un índice normal, no UNIQUE.
--
-- Esta migración agrega un índice ÚNICO parcial (solo aplica cuando
-- codigo y servicio no son nulos, que es el caso de los registros
-- ligados a un par puntual) que sí rechaza el duplicado en el servidor,
-- pase lo que pase del lado del cliente.
--
-- IMPORTANTE: si ya existen duplicados cargados de antes, esta migración
-- falla al crear el índice único. Por eso primero se limpia lo ya
-- duplicado (se conserva el registro más antiguo de cada par+servicio,
-- que es el que "vale" — el que efectivamente hizo el trabajo primero —
-- y se borran los repetidos posteriores).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- 1) Limpieza de duplicados existentes (si los hubiera), quedándose con
--    el registro más antiguo de cada (tenant_id, codigo, servicio).
DELETE FROM registro_pares rp
USING registro_pares rp2
WHERE rp.codigo IS NOT NULL
  AND rp.servicio IS NOT NULL
  AND rp.tenant_id = rp2.tenant_id
  AND rp.codigo = rp2.codigo
  AND rp.servicio = rp2.servicio
  AND rp.created_at > rp2.created_at
  AND rp.id <> rp2.id;

-- 2) Índice único parcial: de acá en más, la base de datos rechaza
--    cualquier intento de guardar el mismo (tenant, codigo, servicio) más
--    de una vez, sin importar si el chequeo del cliente falló o llegó
--    tarde.
DROP INDEX IF EXISTS idx_registro_pares_codigo_servicio;
CREATE UNIQUE INDEX IF NOT EXISTS uq_registro_pares_codigo_servicio
  ON registro_pares (tenant_id, codigo, servicio)
  WHERE codigo IS NOT NULL AND servicio IS NOT NULL;

SELECT 'LISTO: no se puede duplicar un mismo servicio para el mismo artículo.' AS estado;
