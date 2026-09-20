-- Auditoría 2026-09-20: impedir edición/borrado de producción ajena.
-- Empleado/Supervisor: solo UPDATE de su propio registro.
-- Administrador: puede UPDATE de cualquier registro del tenant.
-- DELETE directo: solo Administrador; el frontend debe usar el flujo seguro.

drop policy if exists registro_pares_update on public.registro_pares;
create policy registro_pares_update
on public.registro_pares
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    usuario_id = (select auth.uid())
    or private.current_user_role() = 'Administrador'
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    usuario_id = (select auth.uid())
    or private.current_user_role() = 'Administrador'
  )
);

drop policy if exists registro_pares_delete on public.registro_pares;
create policy registro_pares_delete
on public.registro_pares
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and private.current_user_role() = 'Administrador'
);
