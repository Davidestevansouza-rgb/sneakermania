-- =====================================================================
-- SneakerMania — Migración 024
-- Agrega el campo "observación" a registro_pares.
--
-- Objetivo: en Producción, debajo de "Servicio", el lavador/detallista/
-- pintor puede escribir una observación del artículo antes de registrar.
-- Si ese mismo artículo + servicio ya estaba registrado y la persona
-- nota algo DESPUÉS (por ejemplo, un defecto que vio más tarde), puede
-- volver a escribir el número de artículo + el mismo servicio y anotar
-- una nueva observación: esa nota se INTEGRA (se agrega, con fecha/hora
-- y quién la escribió) al registro ya existente — nunca se crea un
-- registro nuevo ni se vuelve a contar el artículo. Si ya había una
-- observación cargada, la app la muestra en el campo para que la nueva
-- se sume a la anterior en vez de perderla.
--
-- Ver produccion.js: revisarRegistroExistente() e
-- integrarObservacionEnRegistro().
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE registro_pares ADD COLUMN IF NOT EXISTS observacion text;

SELECT 'LISTO: registro_pares tiene columna observacion.' AS estado;
