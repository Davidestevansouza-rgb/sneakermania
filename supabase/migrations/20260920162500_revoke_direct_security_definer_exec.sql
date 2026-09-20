-- Endurecimiento: estas funciones SECURITY DEFINER no forman parte de la API RPC pública.
-- Las dos funciones de trigger siguen ejecutándose normalmente cuando Postgres dispara
-- sus triggers; el usuario que ejecuta INSERT/UPDATE/DELETE no necesita EXECUTE directo.
-- get_storage_size_mb() tampoco es llamado por el frontend actual.

revoke execute on function public.get_storage_size_mb() from public, anon, authenticated;
revoke execute on function public.proteger_orden_item_con_produccion() from public, anon, authenticated;
revoke execute on function public.registro_pares_identidad_autenticada() from public, anon, authenticated;

-- Mantener acceso explícito al rol de servicio para tareas administrativas/servidor.
grant execute on function public.get_storage_size_mb() to service_role;
grant execute on function public.proteger_orden_item_con_produccion() to service_role;
grant execute on function public.registro_pares_identidad_autenticada() to service_role;
