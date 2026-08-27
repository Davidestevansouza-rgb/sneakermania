-- ============================================================
-- MIGRACIÓN 019 — Realtime para configuracion_tenant (QR de pago / logo)
-- ============================================================
-- Habilita la replicación en tiempo real de la tabla
-- "configuracion_tenant" para que, cuando el Administrador guarde el
-- QR de pago (o el logo) desde cualquier dispositivo, el cambio se
-- propague al instante a todas las sesiones abiertas del mismo
-- negocio (ver startRealtimeConfig en js/modules/configuracion.js).
--
-- Se puede ejecutar tal cual desde el SQL Editor de Supabase. Es
-- seguro correrla más de una vez (usa IF NOT EXISTS / comprobaciones).
-- ============================================================

-- 1) REPLICA IDENTITY FULL: para que el payload de UPDATE incluya
--    todas las columnas de la fila (no solo la clave primaria), y así
--    el cliente reciba el qr_pago_url y logo_url actualizados sin
--    tener que volver a consultar la base.
alter table public.configuracion_tenant replica identity full;

-- 2) Agregar la tabla a la publicación de Realtime de Supabase.
--    (Equivale a activar el toggle "Realtime" de esta tabla en
--    Database → Replication, desde el panel de Supabase.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'configuracion_tenant'
  ) then
    alter publication supabase_realtime add table public.configuracion_tenant;
  end if;
end $$;

-- ------------------------------------------------------------
-- Opcional: por si la tabla "ordenes" (usada por la Agenda en
-- tiempo real, ver startRealtimeAgenda) no hubiera quedado agregada
-- a la publicación todavía, esto la deja igualmente cubierta.
-- ------------------------------------------------------------
alter table public.ordenes replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ordenes'
  ) then
    alter publication supabase_realtime add table public.ordenes;
  end if;
end $$;
