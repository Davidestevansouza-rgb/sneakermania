-- SneakerMania — borrados seguros y transaccionales
-- 1) Papelera: elimina orden + items solo si no existe Producción ni factura.
-- 2) Producción: elimina un registro y recompone metadatos/estado del artículo.
-- Ninguna función elimina objetos físicos de R2.

create or replace function public.eliminar_orden_papelera_seguro(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
  v_numero integer;
  v_items integer := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.tenant_id, u.rol
    into v_tenant, v_role
  from public.users u
  where u.id = v_uid and u.activo is distinct from false;

  if v_tenant is null or v_role <> 'Administrador' then
    raise exception 'Solo el Administrador puede eliminar definitivamente';
  end if;

  select o.numero
    into v_numero
  from public.ordenes o
  where o.id = p_order_id and o.tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Orden no encontrada para este tenant';
  end if;

  if exists (
    select 1
    from public.facturas f
    where f.orden_id = p_order_id
  ) then
    raise exception 'No se puede eliminar: la orden tiene factura asociada';
  end if;

  if exists (
    select 1
    from public.registro_pares rp
    join public.orden_items oi
      on oi.tenant_id = rp.tenant_id
     and oi.codigo = rp.codigo
    where oi.orden_id = p_order_id
      and oi.tenant_id = v_tenant
  ) then
    raise exception 'No se puede eliminar: uno o más artículos tienen registros de producción';
  end if;

  delete from public.orden_items
  where orden_id = p_order_id and tenant_id = v_tenant;
  get diagnostics v_items = row_count;

  -- fotos_ordenes y notificaciones tienen ON DELETE CASCADE.
  delete from public.ordenes
  where id = p_order_id and tenant_id = v_tenant;

  if not found then
    raise exception 'No se pudo eliminar la orden';
  end if;

  return jsonb_build_object(
    'ok', true,
    'numero', v_numero,
    'items_eliminados', v_items
  );
end;
$$;

revoke all on function public.eliminar_orden_papelera_seguro(uuid) from public, anon;
grant execute on function public.eliminar_orden_papelera_seguro(uuid) to authenticated;
grant execute on function public.eliminar_orden_papelera_seguro(uuid) to service_role;


create or replace function public.eliminar_registro_produccion_seguro(p_registro_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
  v_codigo text;
  v_servicio text;
  v_item_id uuid;
  v_order_id uuid;
  v_estado text := 'Recibido y registrado';
  v_responsable text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.tenant_id, u.rol
    into v_tenant, v_role
  from public.users u
  where u.id = v_uid and u.activo is distinct from false;

  if v_tenant is null or v_role <> 'Administrador' then
    raise exception 'Solo el Administrador puede eliminar registros de producción';
  end if;

  select rp.codigo, rp.servicio
    into v_codigo, v_servicio
  from public.registro_pares rp
  where rp.id = p_registro_id and rp.tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Registro de producción no encontrado';
  end if;

  select oi.id, oi.orden_id
    into v_item_id, v_order_id
  from public.orden_items oi
  where oi.tenant_id = v_tenant and oi.codigo = v_codigo
  limit 1
  for update;

  delete from public.registro_pares
  where id = p_registro_id and tenant_id = v_tenant;

  -- Recalcula el estado de taller usando los servicios que todavía existen.
  if exists (
    select 1 from public.registro_pares
    where tenant_id = v_tenant and codigo = v_codigo
      and servicio = 'Pintado y personalizado'
  ) then
    v_estado := 'Pintado y personalizado';
  elsif exists (
    select 1 from public.registro_pares
    where tenant_id = v_tenant and codigo = v_codigo
      and servicio = 'Secado y detallado'
  ) then
    v_estado := 'Secado y detallado';
  elsif exists (
    select 1 from public.registro_pares
    where tenant_id = v_tenant and codigo = v_codigo
      and servicio in ('Lavado','Blanqueando')
  ) then
    v_estado := 'Lavado';
  end if;

  select rp.empleado
    into v_responsable
  from public.registro_pares rp
  where rp.tenant_id = v_tenant and rp.codigo = v_codigo
  order by rp.created_at desc
  limit 1;

  if v_item_id is not null then
    update public.orden_items
    set registro_servicios = coalesce(registro_servicios, '{}'::jsonb) - coalesce(v_servicio, ''),
        responsable = v_responsable,
        estado = v_estado
    where id = v_item_id and tenant_id = v_tenant;
  end if;

  return jsonb_build_object(
    'ok', true,
    'codigo', v_codigo,
    'servicio', v_servicio,
    'item_id', v_item_id,
    'orden_id', v_order_id,
    'estado', v_estado,
    'responsable', v_responsable
  );
end;
$$;

revoke all on function public.eliminar_registro_produccion_seguro(uuid) from public, anon;
grant execute on function public.eliminar_registro_produccion_seguro(uuid) to authenticated;
grant execute on function public.eliminar_registro_produccion_seguro(uuid) to service_role;
