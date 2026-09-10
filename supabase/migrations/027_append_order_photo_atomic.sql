-- Append atómico de referencias de fotos de órdenes.
-- No reemplaza ordenes.extra completo y conserva el aislamiento por tenant/RLS.
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
  v_nested_extra jsonb;
  v_photos jsonb;
  v_url text;
  v_path text;
  v_r2_path text;
  v_item_id_text text;
  v_item_id uuid;
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

  v_extra := coalesce(v_extra, '{}'::jsonb);
  v_nested_extra := case
    when jsonb_typeof(v_extra->'extra') = 'object' then v_extra->'extra'
    else '{}'::jsonb
  end;
  v_photos := case
    when jsonb_typeof(v_nested_extra->'fotos') = 'array' then v_nested_extra->'fotos'
    else '[]'::jsonb
  end;

  if exists (
    select 1
    from jsonb_array_elements(v_photos) existing
    where (v_url is not null and existing->>'url' = v_url)
       or (v_path is not null and regexp_replace(regexp_replace(coalesce(existing->>'path',''), '^r2://', ''), '^/+', '') = v_path)
  ) then
    return v_extra;
  end if;

  v_nested_extra := jsonb_set(
    v_nested_extra,
    '{fotos}',
    v_photos || jsonb_build_array(p_photo),
    true
  );
  v_extra := jsonb_set(v_extra, '{extra}', v_nested_extra, true);

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
