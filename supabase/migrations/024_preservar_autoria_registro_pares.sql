-- La autoría de un registro de producción es inmutable.
-- INSERT: identidad y fecha salen del usuario autenticado/servidor.
-- UPDATE: conserva trabajador, tenant y fecha originales.
create or replace function public.registro_pares_identidad_autenticada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_tenant uuid;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if tg_op = 'UPDATE' then
    new.usuario_id := old.usuario_id;
    new.empleado := old.empleado;
    new.tenant_id := old.tenant_id;
    new.fecha := old.fecha;
    return new;
  end if;
  select u.nombre, u.tenant_id into v_nombre, v_tenant
  from public.users u where u.id = v_uid and coalesce(u.activo, true) = true;
  if v_nombre is null or v_tenant is null then raise exception 'Usuario activo no encontrado'; end if;
  new.usuario_id := v_uid;
  new.empleado := v_nombre;
  new.tenant_id := v_tenant;
  new.fecha := (timezone('America/La_Paz', now()))::date;
  return new;
end;
$function$;