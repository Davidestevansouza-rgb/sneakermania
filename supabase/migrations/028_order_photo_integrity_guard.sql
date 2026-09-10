-- Integridad de referencias de fotos de órdenes.
-- 1) Evita "lost updates": un saveOrden() con snapshot viejo no puede borrar fotos
--    que ya estaban confirmadas en la BD.
-- 2) Las eliminaciones intencionales dejan tombstone para que un dispositivo viejo
--    no pueda resucitar la misma referencia después.
-- 3) Mantiene el aislamiento por tenant y valida itemId para fotos iniciales.

create or replace function public.order_photo_ref_key(p_photo jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_photo->>'path', '')), '') is not null then
      'path:' || regexp_replace(
        regexp_replace(btrim(p_photo->>'path'), '^r2://', ''),
        '^/+', ''
      )
    when nullif(btrim(coalesce(p_photo->>'url', '')), '') is not null
         and btrim(p_photo->>'url') like 'r2://%' then
      'path:' || regexp_replace(substr(btrim(p_photo->>'url'), 6), '^/+', '')
    when nullif(btrim(coalesce(p_photo->>'url', '')), '') is not null then
      'url:' || btrim(p_photo->>'url')
    else
      'json:' || md5(coalesce(p_photo, 'null'::jsonb)::text)
  end;
$$;

create or replace function public.order_photo_inner(p_outer jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(coalesce(p_outer, '{}'::jsonb)->'extra') = 'object'
      then coalesce(p_outer, '{}'::jsonb)->'extra'
    else coalesce(p_outer, '{}'::jsonb)
  end;
$$;

create or replace function public.order_photo_set_inner(p_outer jsonb, p_inner jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(coalesce(p_outer, '{}'::jsonb)->'extra') = 'object'
      or coalesce(p_outer, '{}'::jsonb) ? 'id'
      or coalesce(p_outer, '{}'::jsonb) ? 'numero'
      or coalesce(p_outer, '{}'::jsonb) ? 'clienteId'
      or coalesce(p_outer, '{}'::jsonb) ? 'cliente_id'
    then jsonb_set(coalesce(p_outer, '{}'::jsonb), '{extra}', coalesce(p_inner, '{}'::jsonb), true)
    else coalesce(p_inner, '{}'::jsonb)
  end;
$$;

create or replace function public.protect_order_photo_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_inner jsonb;
  v_new_inner jsonb;
  v_old_photos jsonb;
  v_new_photos jsonb;
  v_old_deleted jsonb;
  v_new_deleted jsonb;
  v_deleted jsonb;
  v_merged jsonb;
begin
  v_old_inner := public.order_photo_inner(old.extra);
  v_new_inner := public.order_photo_inner(new.extra);

  v_old_photos := case
    when jsonb_typeof(v_old_inner->'fotos') = 'array' then v_old_inner->'fotos'
    else '[]'::jsonb
  end;
  v_new_photos := case
    when jsonb_typeof(v_new_inner->'fotos') = 'array' then v_new_inner->'fotos'
    else '[]'::jsonb
  end;

  v_old_deleted := case
    when jsonb_typeof(v_old_inner->'_photo_deleted_keys') = 'array' then v_old_inner->'_photo_deleted_keys'
    else '[]'::jsonb
  end;
  v_new_deleted := case
    when jsonb_typeof(v_new_inner->'_photo_deleted_keys') = 'array' then v_new_inner->'_photo_deleted_keys'
    else '[]'::jsonb
  end;

  select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
    into v_deleted
  from (
    select distinct value as k
    from (
      select value from jsonb_array_elements_text(v_old_deleted)
      union all
      select value from jsonb_array_elements_text(v_new_deleted)
    ) d
    where nullif(btrim(value), '') is not null
  ) uniq;

  with candidates as (
    select 0 as src, ord, photo, public.order_photo_ref_key(photo) as photo_key
    from jsonb_array_elements(v_new_photos) with ordinality n(photo, ord)
    union all
    select 1 as src, ord, photo, public.order_photo_ref_key(photo) as photo_key
    from jsonb_array_elements(v_old_photos) with ordinality o(photo, ord)
  ), filtered as (
    select c.*
    from candidates c
    where not exists (
      select 1
      from jsonb_array_elements_text(v_deleted) t(value)
      where t.value = c.photo_key
    )
  ), dedup as (
    select distinct on (photo_key) src, ord, photo, photo_key
    from filtered
    order by photo_key, src, ord
  )
  select coalesce(jsonb_agg(photo order by src, ord), '[]'::jsonb)
    into v_merged
  from dedup;

  v_new_inner := jsonb_set(v_new_inner, '{fotos}', v_merged, true);
  v_new_inner := jsonb_set(v_new_inner, '{_photo_deleted_keys}', v_deleted, true);
  new.extra := public.order_photo_set_inner(new.extra, v_new_inner);
  return new;
end;
$$;

drop trigger if exists trg_protect_order_photo_refs on public.ordenes;
create trigger trg_protect_order_photo_refs
before update of extra on public.ordenes
for each row
execute function public.protect_order_photo_refs();

create or replace function public.append_order_photo_atomic(
  p_order_id uuid,
  p_photo jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_extra jsonb;
  v_inner jsonb;
  v_photos jsonb;
  v_deleted jsonb;
  v_url text;
  v_path text;
  v_r2_path text;
  v_item_id_text text;
  v_item_id uuid;
  v_key text;
  v_exists boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'No active tenant' using errcode = '42501';
  end if;

  if p_photo is null or jsonb_typeof(p_photo) <> 'object' then
    raise exception 'Invalid photo reference' using errcode = '22023';
  end if;

  v_url := nullif(btrim(p_photo->>'url'), '');
  v_path := nullif(btrim(p_photo->>'path'), '');

  if v_url is null or v_url not like 'r2://%' then
    raise exception 'Photo URL must be a private R2 reference' using errcode = '22023';
  end if;

  v_r2_path := regexp_replace(substr(v_url, 6), '^/+', '');
  if split_part(v_r2_path, '/', 1) <> v_tenant::text then
    raise exception 'Photo tenant does not match authenticated tenant' using errcode = '42501';
  end if;

  if v_path is not null then
    v_path := regexp_replace(regexp_replace(v_path, '^r2://', ''), '^/+', '');
    if split_part(v_path, '/', 1) <> v_tenant::text then
      raise exception 'Photo path tenant does not match authenticated tenant' using errcode = '42501';
    end if;
  end if;

  v_item_id_text := nullif(btrim(p_photo->>'itemId'), '');
  if v_item_id_text is not null then
    begin
      v_item_id := v_item_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid itemId' using errcode = '22023';
    end;

    if not exists (
      select 1
      from public.orden_items oi
      where oi.id = v_item_id
        and oi.orden_id = p_order_id
        and oi.tenant_id = v_tenant
    ) then
      raise exception 'itemId does not belong to this order' using errcode = '22023';
    end if;
  elsif coalesce(p_photo->>'categoria', '') = 'item_inicial' then
    raise exception 'item_inicial requires itemId' using errcode = '22023';
  end if;

  select o.extra
    into v_extra
  from public.ordenes o
  where o.id = p_order_id
    and o.tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Order not found or access denied' using errcode = 'P0002';
  end if;

  v_inner := public.order_photo_inner(v_extra);
  v_photos := case
    when jsonb_typeof(v_inner->'fotos') = 'array' then v_inner->'fotos'
    else '[]'::jsonb
  end;
  v_deleted := case
    when jsonb_typeof(v_inner->'_photo_deleted_keys') = 'array' then v_inner->'_photo_deleted_keys'
    else '[]'::jsonb
  end;
  v_key := public.order_photo_ref_key(p_photo);

  if exists (
    select 1 from jsonb_array_elements_text(v_deleted) d(value)
    where d.value = v_key
  ) then
    raise exception 'Photo reference was intentionally deleted; upload a new file' using errcode = '22023';
  end if;

  select exists (
    select 1 from jsonb_array_elements(v_photos) e(photo)
    where public.order_photo_ref_key(e.photo) = v_key
  ) into v_exists;

  if v_exists then
    select coalesce(jsonb_agg(
      case when public.order_photo_ref_key(e.photo) = v_key then p_photo else e.photo end
      order by e.ord
    ), '[]'::jsonb)
      into v_photos
    from jsonb_array_elements(v_photos) with ordinality e(photo, ord);
  else
    v_photos := v_photos || jsonb_build_array(p_photo);
  end if;

  v_inner := jsonb_set(v_inner, '{fotos}', v_photos, true);
  v_extra := public.order_photo_set_inner(v_extra, v_inner);

  update public.ordenes o
     set extra = v_extra
   where o.id = p_order_id
     and o.tenant_id = v_tenant
  returning o.extra into v_extra;

  return v_extra;
end;
$$;

create or replace function public.delete_order_photo_atomic(
  p_order_id uuid,
  p_photo jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role text;
  v_extra jsonb;
  v_inner jsonb;
  v_photos jsonb;
  v_deleted jsonb;
  v_key text;
  v_found boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'No active tenant' using errcode = '42501';
  end if;

  select u.rol
    into v_role
  from public.users u
  where u.id = (select auth.uid())
    and u.tenant_id = v_tenant
    and u.activo is true;

  if coalesce(v_role, '') <> 'Administrador' then
    raise exception 'Only Administrador can delete order photos' using errcode = '42501';
  end if;

  if p_photo is null or jsonb_typeof(p_photo) <> 'object' then
    raise exception 'Invalid photo reference' using errcode = '22023';
  end if;

  v_key := public.order_photo_ref_key(p_photo);

  select o.extra
    into v_extra
  from public.ordenes o
  where o.id = p_order_id
    and o.tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Order not found or access denied' using errcode = 'P0002';
  end if;

  v_inner := public.order_photo_inner(v_extra);
  v_photos := case
    when jsonb_typeof(v_inner->'fotos') = 'array' then v_inner->'fotos'
    else '[]'::jsonb
  end;
  v_deleted := case
    when jsonb_typeof(v_inner->'_photo_deleted_keys') = 'array' then v_inner->'_photo_deleted_keys'
    else '[]'::jsonb
  end;

  select exists (
    select 1 from jsonb_array_elements(v_photos) e(photo)
    where public.order_photo_ref_key(e.photo) = v_key
  ) into v_found;

  if not v_found then
    -- Idempotente: si ya no existe, conserva/crea el tombstone igualmente.
    if not exists (
      select 1 from jsonb_array_elements_text(v_deleted) d(value)
      where d.value = v_key
    ) then
      v_deleted := v_deleted || jsonb_build_array(v_key);
    end if;
  else
    select coalesce(jsonb_agg(e.photo order by e.ord), '[]'::jsonb)
      into v_photos
    from jsonb_array_elements(v_photos) with ordinality e(photo, ord)
    where public.order_photo_ref_key(e.photo) <> v_key;

    if not exists (
      select 1 from jsonb_array_elements_text(v_deleted) d(value)
      where d.value = v_key
    ) then
      v_deleted := v_deleted || jsonb_build_array(v_key);
    end if;
  end if;

  v_inner := jsonb_set(v_inner, '{fotos}', v_photos, true);
  v_inner := jsonb_set(v_inner, '{_photo_deleted_keys}', v_deleted, true);
  v_extra := public.order_photo_set_inner(v_extra, v_inner);

  update public.ordenes o
     set extra = v_extra
   where o.id = p_order_id
     and o.tenant_id = v_tenant
  returning o.extra into v_extra;

  return v_extra;
end;
$$;

revoke all on function public.append_order_photo_atomic(uuid, jsonb) from public;
revoke all on function public.append_order_photo_atomic(uuid, jsonb) from anon;
grant execute on function public.append_order_photo_atomic(uuid, jsonb) to authenticated;

revoke all on function public.delete_order_photo_atomic(uuid, jsonb) from public;
revoke all on function public.delete_order_photo_atomic(uuid, jsonb) from anon;
grant execute on function public.delete_order_photo_atomic(uuid, jsonb) to authenticated;
