-- ============================================================
-- MIGRACIÓN 018 — Sesión única por dispositivo + límite de administradores por empresa
-- ============================================================

-- 1) Tabla de sesiones activas por usuario/dispositivo.
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null,
  device_fingerprint text not null,
  session_token text,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_user_sessions_user on public.user_sessions(user_id);
create index if not exists idx_user_sessions_user_device on public.user_sessions(user_id, device_fingerprint);

-- 2) Función que cierra sesiones anteriores de un usuario en otros dispositivos.
create or replace function public.fn_close_other_sessions(p_user uuid, p_device text)
returns void as $$
begin
  delete from public.user_sessions
  where user_id = p_user and device_fingerprint <> p_device;
end;
$$ language plpgsql;

-- 3) Función que valida que una empresa no tenga más de 3 administradores.
create or replace function public.fn_max_admins_por_empresa()
returns trigger as $$
declare
  cantidad_admins int;
begin
  select count(*) into cantidad_admins
  from public.users
  where tenant_id = new.tenant_id and rol = 'Administrador' and activo = true;

  if cantidad_admins >= 3 and new.rol = 'Administrador' and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and OLD.rol <> 'Administrador')) then
    raise exception 'No se pueden registrar más de 3 administradores por empresa.';
  end if;

  return new;
end;
$$ language plpgsql;

-- 4) Trigger: aplica el límite antes de INSERT/UPDATE en users.
drop trigger if exists trg_max_admins on public.users;
create trigger trg_max_admins
before insert or update of rol, tenant_id on public.users
for each row
execute function public.fn_max_admins_por_empresa();

-- 5) Política RLS para que cada tenant solo vea sus sesiones.
alter table public.user_sessions enable row level security;
drop policy if exists "user_sessions_tenant_select" on public.user_sessions;
create policy "user_sessions_tenant_select"
  on public.user_sessions for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.tenant_id = user_sessions.tenant_id));
