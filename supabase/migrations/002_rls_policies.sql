-- =====================================================================
-- Sistema SeS — Migración 002: Row Level Security (RLS)
-- Aislamiento multitenant: cada usuario solo accede a datos de su tenant.
-- El tenant_id se obtiene de la tabla users mediante auth.uid().
-- =====================================================================

-- Funciones auxiliares (SECURITY DEFINER para evitar recursión en RLS)
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_rol()
RETURNS TEXT AS $$
  SELECT rol FROM users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- Habilitar RLS en todas las tablas
-- ---------------------------------------------------------------------
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fotos_ordenes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario           ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividad_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_tenant ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- tenants: el usuario solo ve/edita su propia lavandería
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  FOR ALL
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- ---------------------------------------------------------------------
-- users: se ven los usuarios del mismo tenant.
-- Solo Administrador/Supervisor pueden crear/editar/eliminar usuarios.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
  FOR SELECT
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS users_admin_write ON users;
CREATE POLICY users_admin_write ON users
  FOR ALL
  USING (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  );

-- ---------------------------------------------------------------------
-- Aislamiento estándar por tenant (SELECT/INSERT/UPDATE/DELETE)
-- clientes, ordenes, fotos_ordenes, inventario, actividad_log,
-- notificaciones, configuracion_tenant
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  col TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes','ordenes','fotos_ordenes','inventario',
    'actividad_log','notificaciones','configuracion_tenant'
  ] LOOP
    col := 'tenant_id';
    EXECUTE format(
      'DROP POLICY IF EXISTS %1$s_tenant_isolation ON %1$s;
       CREATE POLICY %1$s_tenant_isolation ON %1$s
         FOR ALL
         USING (%2$s = current_tenant_id())
         WITH CHECK (%2$s = current_tenant_id());', t, col);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- gastos: solo Administrador/Supervisor (Empleado NO ve finanzas)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS gastos_admin_only ON gastos;
CREATE POLICY gastos_admin_only ON gastos
  FOR ALL
  USING (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  );

-- ---------------------------------------------------------------------
-- facturas: solo Administrador/Supervisor
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS facturas_admin_only ON facturas;
CREATE POLICY facturas_admin_only ON facturas
  FOR ALL
  USING (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND current_user_rol() IN ('Administrador','Supervisor')
  );
