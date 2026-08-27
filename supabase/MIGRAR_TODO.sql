-- =====================================================================
-- Sistema SeS — MIGRACIÓN COMPLETA (todo en uno)
-- Pegar TODO este archivo en el SQL Editor de Supabase y ejecutar UNA vez.
-- Es idempotente: se puede correr varias veces sin romper nada
-- (usa IF NOT EXISTS / DROP POLICY IF EXISTS / ADD COLUMN IF NOT EXISTS).
-- Incluye el esquema base + todas las migraciones 005 a 014.
-- =====================================================================

-- ========== BASE (SETUP_COMPLETO) ==========
-- =====================================================================
-- Sistema SeS — SETUP COMPLETO (pegar UNA sola vez en el SQL Editor)
-- Deja TODO listo: tablas + RLS + indices + tenant + usuario Administrador.
-- Es idempotente: puedes ejecutarlo varias veces sin romper nada.
-- =====================================================================

-- 1) LIMPIEZA: elimina tablas de la app mal creadas o previas.
--    NO toca auth.users (tus cuentas de acceso se conservan).
DROP TABLE IF EXISTS actividad_log        CASCADE;
DROP TABLE IF EXISTS notificaciones       CASCADE;
DROP TABLE IF EXISTS facturas             CASCADE;
DROP TABLE IF EXISTS fotos_ordenes        CASCADE;
DROP TABLE IF EXISTS gastos               CASCADE;
DROP TABLE IF EXISTS inventario           CASCADE;
DROP TABLE IF EXISTS ordenes              CASCADE;
DROP TABLE IF EXISTS clientes             CASCADE;
DROP TABLE IF EXISTS configuracion_tenant CASCADE;
DROP TABLE IF EXISTS users                CASCADE;
DROP TABLE IF EXISTS tenants              CASCADE;

-- 2) TABLAS + FUNCIONES
-- =====================================================================
-- Sistema SeS — Migración 001: Creación de tablas
-- Esquema multitenant. Cada fila incluye tenant_id (aislamiento por RLS).
-- =====================================================================

-- Extensión para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 4.1 tenants (lavanderías)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  logo_url      TEXT,
  email         TEXT NOT NULL UNIQUE,
  telefono      TEXT,
  direccion     TEXT,
  ciudad        TEXT,
  pais          TEXT DEFAULT 'MX',
  moneda        TEXT DEFAULT 'MXN',
  plan          TEXT DEFAULT 'free',  -- free, basic, pro
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.2 users (usuarios del sistema, ligados a auth.users)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('Administrador','Empleado','Supervisor')),
  activo        BOOLEAN DEFAULT TRUE,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.3 clientes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  nombre        TEXT NOT NULL,
  telefono      TEXT,
  whatsapp      TEXT,
  email         TEXT,
  direccion     TEXT,
  rfc           TEXT,         -- para facturación
  observaciones TEXT,
  eliminada     BOOLEAN DEFAULT FALSE,  -- papelera: no se borra de verdad, se oculta hasta eliminar definitivamente
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.4 ordenes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordenes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  numero            INT,                -- número visible auto-incremental por tenant
  cliente_id        UUID NOT NULL REFERENCES clientes(id),
  usuario_id        UUID REFERENCES users(id),  -- quién creó la orden
  responsable_id    UUID REFERENCES users(id),  -- técnico asignado (FK, opcional)
  responsable       TEXT,                        -- nombre libre del responsable (compat. Fase 1)

  -- Calzado
  marca             TEXT,
  modelo            TEXT,
  tipo_calzado      TEXT,
  color             TEXT,
  material          TEXT,
  talla             TEXT,
  cantidad_pares    INT DEFAULT 1,
  estado_calzado    TEXT,
  tratamiento_sugerido TEXT,

  -- Servicio
  tipos_servicio    TEXT[],  -- array: ['Limpieza básica', 'Impermeabilización']
  prioridad         TEXT DEFAULT 'Media' CHECK (prioridad IN ('Alta','Media','Baja')),
  estado            TEXT DEFAULT 'Recibido' CHECK (estado IN (
                    'Recibido','Lavado','Secado','Pintado','Reparación','Finalizado','Entregado')),
  observaciones     TEXT,

  -- Fechas
  fecha_ingreso     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_estimada    DATE,
  fecha_entrega     DATE,

  -- Finanzas
  precio            NUMERIC(10,2) DEFAULT 0,
  descuento         NUMERIC(10,2) DEFAULT 0,
  pagado            NUMERIC(10,2) DEFAULT 0,
  pagado_qr         NUMERIC(10,2) DEFAULT 0,
  pagado_efectivo   NUMERIC(10,2) DEFAULT 0,
  pagado_tarjeta    NUMERIC(10,2) DEFAULT 0,
  pagado_transferencia NUMERIC(10,2) DEFAULT 0,
  metodo_pago       TEXT,
  fecha_pago        DATE,
  estado_pago       TEXT DEFAULT 'Pendiente' CHECK (estado_pago IN ('Pendiente','Parcial','Pagado')),

  -- IA
  ia_resultado      JSONB,  -- resultado completo del análisis
  ia_confianza      INT,

  -- Timeline
  timeline_index    INT DEFAULT 0,
  timeline_dates    JSONB DEFAULT '{}',

  -- Control de calidad
  control_calidad   JSONB DEFAULT '{}',

  -- Firma digital (URLs en Storage o base64)
  firma_ingreso     TEXT,
  firma_retiro      TEXT,
  firma_recepcionista TEXT,

  entregado         BOOLEAN DEFAULT FALSE,
  -- Campos complejos que en Fase 1 se conservan tal cual (firmas embebidas,
  -- fotos base64, banderas de migración). En Fase 2 se moverán a Storage y a
  -- la tabla fotos_ordenes. Garantiza fidelidad total del modelo original.
  extra             JSONB DEFAULT '{}',

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.5 fotos_ordenes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fotos_ordenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  orden_id      UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  categoria     TEXT NOT NULL CHECK (categoria IN (
                'antes','durante','despues','detalle','suela','laterales')),
  storage_path  TEXT NOT NULL,   -- path en Supabase Storage
  public_url    TEXT,
  nombre        TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.6 gastos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gastos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  categoria     TEXT NOT NULL,
  monto         NUMERIC(10,2) NOT NULL,
  fecha         DATE NOT NULL,
  descripcion   TEXT,
  comprobante_url TEXT,  -- archivo adjunto en Storage
  usuario_id    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.7 facturas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facturas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  numero          TEXT NOT NULL,  -- F-001, F-002...
  orden_id        UUID REFERENCES ordenes(id),
  cliente_id      UUID REFERENCES clientes(id),
  nombre_cliente  TEXT NOT NULL,
  rfc             TEXT,
  email           TEXT,
  telefono        TEXT,
  direccion       TEXT,
  concepto        TEXT,
  metodo_pago     TEXT,
  subtotal        NUMERIC(10,2),
  impuestos       NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2),
  notas           TEXT,
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  pdf_url         TEXT,   -- path al PDF en Storage
  estado          TEXT DEFAULT 'Emitida' CHECK (estado IN ('Borrador','Emitida','Cancelada')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.8 inventario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  nombre            TEXT NOT NULL,
  categoria         TEXT NOT NULL CHECK (categoria IN ('Producto','Herramienta','Insumo')),
  proveedor         TEXT,
  cantidad          NUMERIC(10,2) DEFAULT 0,
  stock_minimo      NUMERIC(10,2) DEFAULT 0,
  precio_compra     NUMERIC(10,2) DEFAULT 0,
  fecha_compra      DATE,
  fecha_vencimiento DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.9 actividad_log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS actividad_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  accion      TEXT NOT NULL,
  entidad     TEXT,    -- 'orden', 'cliente', etc.
  entidad_id  UUID,
  datos       JSONB,   -- datos antes/después para auditoría
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.10 notificaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  tipo        TEXT NOT NULL,  -- 'entrega_hoy','atraso','stock_bajo','pago_pendiente','descuento','produccion'...
  texto       TEXT NOT NULL,
  leida       BOOLEAN DEFAULT FALSE,
  prioridad   TEXT DEFAULT 'Media',
  orden_id       UUID REFERENCES ordenes(id) ON DELETE CASCADE,
  inventario_id  UUID REFERENCES inventario(id) ON DELETE CASCADE,
  entidad     TEXT,
  entidad_id  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4.11 configuracion_tenant
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion_tenant (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants(id),
  nombre_negocio    TEXT,
  logo_url          TEXT,
  color_primario    TEXT DEFAULT '#2F5DE0',
  moneda            TEXT DEFAULT 'MXN',
  simbolo_moneda    TEXT DEFAULT '$',
  prefijo_factura   TEXT DEFAULT 'F-',
  siguiente_factura INT DEFAULT 1,
  siguiente_orden   INT DEFAULT 1,
  whatsapp_negocio  TEXT,
  email_negocio     TEXT,
  mensaje_whatsapp_template TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================
-- Trigger: mantener updated_at automáticamente
-- =====================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','clientes','ordenes','gastos',
    'inventario','configuracion_tenant'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- =====================================================================
-- Función: siguiente número de orden por tenant (auto-incremental)
-- Usa configuracion_tenant.siguiente_orden como contador.
-- =====================================================================
CREATE OR REPLACE FUNCTION siguiente_numero_orden(p_tenant UUID)
RETURNS INT AS $$
DECLARE
  v_num INT;
BEGIN
  INSERT INTO configuracion_tenant (tenant_id, siguiente_orden)
    VALUES (p_tenant, 1)
    ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE configuracion_tenant
    SET siguiente_orden = COALESCE(siguiente_orden, 1) + 1
    WHERE tenant_id = p_tenant
    RETURNING siguiente_orden - 1 INTO v_num;

  RETURN v_num;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Función: siguiente número de factura por tenant (con prefijo)
-- =====================================================================
CREATE OR REPLACE FUNCTION siguiente_numero_factura(p_tenant UUID)
RETURNS TEXT AS $$
DECLARE
  v_num    INT;
  v_prefijo TEXT;
BEGIN
  INSERT INTO configuracion_tenant (tenant_id, siguiente_factura)
    VALUES (p_tenant, 1)
    ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE configuracion_tenant
    SET siguiente_factura = COALESCE(siguiente_factura, 1) + 1
    WHERE tenant_id = p_tenant
    RETURNING siguiente_factura - 1, COALESCE(prefijo_factura, 'F-')
    INTO v_num, v_prefijo;

  RETURN v_prefijo || LPAD(v_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;


-- 3) RLS (seguridad por tenant)
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


-- 4) INDICES
-- =====================================================================
-- Sistema SeS — Migración 003: Índices
-- Optimizan las consultas más frecuentes (filtros por tenant, fechas,
-- estados y llaves foráneas).
-- =====================================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_tenant           ON users(tenant_id);

-- clientes
CREATE INDEX IF NOT EXISTS idx_clientes_tenant         ON clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre         ON clientes(tenant_id, nombre);

-- ordenes
CREATE INDEX IF NOT EXISTS idx_ordenes_tenant          ON ordenes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente         ON ordenes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_estado          ON ordenes(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_estado_pago     ON ordenes(tenant_id, estado_pago);
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha_estimada  ON ordenes(tenant_id, fecha_estimada);
CREATE INDEX IF NOT EXISTS idx_ordenes_numero          ON ordenes(tenant_id, numero);

-- fotos_ordenes
CREATE INDEX IF NOT EXISTS idx_fotos_tenant            ON fotos_ordenes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fotos_orden             ON fotos_ordenes(orden_id);

-- gastos
CREATE INDEX IF NOT EXISTS idx_gastos_tenant           ON gastos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha            ON gastos(tenant_id, fecha);

-- facturas
CREATE INDEX IF NOT EXISTS idx_facturas_tenant         ON facturas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha          ON facturas(tenant_id, fecha_emision);
CREATE INDEX IF NOT EXISTS idx_facturas_orden          ON facturas(orden_id);

-- inventario
CREATE INDEX IF NOT EXISTS idx_inventario_tenant       ON inventario(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventario_categoria    ON inventario(tenant_id, categoria);

-- actividad_log
CREATE INDEX IF NOT EXISTS idx_actividad_tenant        ON actividad_log(tenant_id, created_at DESC);

-- notificaciones
CREATE INDEX IF NOT EXISTS idx_notif_tenant            ON notificaciones(tenant_id, leida);


-- =====================================================================
-- SEMILLA: tenant + configuracion + tu usuario Administrador
-- =====================================================================
INSERT INTO tenants (id, nombre, email)
VALUES ('d5bf622d-c046-435d-ad48-cc8d65b2f66f', 'Sistema SeS', 'sessistema@gmail.com')
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre;

INSERT INTO configuracion_tenant (tenant_id, nombre_negocio, siguiente_orden, siguiente_factura)
VALUES ('d5bf622d-c046-435d-ad48-cc8d65b2f66f', 'Sistema SeS', 1, 1)
ON CONFLICT (tenant_id) DO NOTHING;

-- Enlaza tu cuenta de Auth existente (sessistema@gmail.com) como Administrador
INSERT INTO users (id, tenant_id, nombre, email, rol, activo)
VALUES ('7d179baa-60fb-4aee-8da1-e3bf10112f29', 'd5bf622d-c046-435d-ad48-cc8d65b2f66f', 'Administrador', 'sessistema@gmail.com', 'Administrador', true)
ON CONFLICT (id) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id,
      rol       = 'Administrador',
      activo    = true,
      nombre    = EXCLUDED.nombre,
      email     = EXCLUDED.email;

-- Verificacion final
SELECT 'LISTO: tablas, RLS, indices y admin creados.' AS estado;

-- ---------------------------------------------------------------------
-- push_subscriptions: notificaciones push reales (ver migración 005)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (endpoint)
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_tenant_isolation ON push_subscriptions;
CREATE POLICY push_subscriptions_tenant_isolation ON push_subscriptions
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS push_notif_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  tipo        TEXT NOT NULL,
  fecha       DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, tipo, fecha)
);
ALTER TABLE push_notif_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_notif_log_tenant_isolation ON push_notif_log;
CREATE POLICY push_notif_log_tenant_isolation ON push_notif_log
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------
-- registro_pares: Producción — pares lavados/detallados por empleado
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_pares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  empleado    TEXT NOT NULL,
  fecha       DATE NOT NULL,
  pares       INTEGER NOT NULL DEFAULT 1 CHECK (pares > 0),
  foto_url    TEXT,
  foto_urls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE registro_pares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registro_pares_tenant_isolation ON registro_pares;
CREATE POLICY registro_pares_tenant_isolation ON registro_pares
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_registro_pares_tenant_fecha ON registro_pares(tenant_id, fecha);

-- ---------------------------------------------------------------------
-- orden_items: PRECINTO NUMERADO — pares individuales dentro de una orden
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orden_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  orden_id      UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  numero_item   INT NOT NULL,
  codigo        TEXT NOT NULL,
  descripcion   TEXT,
  estado        TEXT NOT NULL DEFAULT 'Lavado'
                  CHECK (estado IN ('Lavado','Secado','Detallado y Pintado','Entregado')),
  tipo_servicio JSONB NOT NULL DEFAULT '[]'::jsonb,
  responsable   TEXT,
  fecha_ingreso DATE,
  fecha_entrega_estimada DATE,
  marca         TEXT,
  modelo        TEXT,
  tipo_calzado  TEXT,
  color         TEXT,
  material      TEXT,
  estado_calzado TEXT,
  tratamiento_sugerido TEXT,
  entregado     BOOLEAN DEFAULT FALSE,
  fecha_entrega TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, numero_item)
);
ALTER TABLE orden_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orden_items_tenant_isolation ON orden_items;
CREATE POLICY orden_items_tenant_isolation ON orden_items
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_orden_items_orden  ON orden_items(orden_id);
CREATE INDEX IF NOT EXISTS idx_orden_items_estado ON orden_items(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_orden_items_codigo ON orden_items(tenant_id, codigo);

-- ========== MIGRACIÓN 005_push_subscriptions ==========
-- =====================================================================
-- Sistema SeS — Migración 005: Notificaciones Push REALES
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
-- Reemplaza el sistema "demo" (localStorage + VAPID key pública de
-- ejemplo) por suscripciones guardadas en base de datos, para que la
-- Edge Function send-push pueda notificar a los dispositivos aunque
-- la app esté cerrada o el celular bloqueado.
-- =====================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,   -- clave pública de cifrado del navegador
  auth        TEXT NOT NULL,   -- secreto de autenticación del navegador
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cada usuario ve/crea/borra solo sus propias suscripciones (o las de su
-- tenant si se administran centralizadamente); la Edge Function usa la
-- service_role key y no pasa por RLS, así que puede leer todas.
DROP POLICY IF EXISTS push_subscriptions_tenant_isolation ON push_subscriptions;
CREATE POLICY push_subscriptions_tenant_isolation ON push_subscriptions
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions(tenant_id);

-- Registro de "ya se avisó hoy" por tenant/tipo, para que send-push no
-- mande el mismo aviso en cada corrida del cron (ver Edge Function).
CREATE TABLE IF NOT EXISTS push_notif_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  tipo        TEXT NOT NULL,   -- 'pago' | 'atraso' | 'stock'
  fecha       DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, tipo, fecha)
);
ALTER TABLE push_notif_log ENABLE ROW LEVEL SECURITY;
-- Solo la Edge Function (service_role, que no pasa por RLS) escribe acá;
-- para lectura normal desde la app, alcanza con el aislamiento por tenant.
DROP POLICY IF EXISTS push_notif_log_tenant_isolation ON push_notif_log;
CREATE POLICY push_notif_log_tenant_isolation ON push_notif_log
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

SELECT 'LISTO: tabla push_subscriptions creada.' AS estado;

-- ========== MIGRACIÓN 006_papelera_clientes ==========
-- =====================================================================
-- Sistema SeS — Migración 006
-- Papelera de clientes: agrega la columna `eliminada` a la tabla
-- `clientes` para poder "enviar a la papelera" en vez de borrar de una.
-- (La papelera de ÓRDENES no necesita migración: ese registro ya se
-- guarda completo en la columna `extra`, así que el campo `eliminada`
-- viaja solo ahí sin tocar el esquema.)
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
-- =====================================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS eliminada BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_clientes_eliminada ON clientes(tenant_id, eliminada);

SELECT 'LISTO: columna eliminada agregada a clientes.' AS estado;

-- ========== MIGRACIÓN 007_registro_pares ==========
-- =====================================================================
-- Sistema SeS — Migración 007
-- Producción: registro de pares lavados/detallados por empleado, con
-- foto de respaldo opcional. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

CREATE TABLE IF NOT EXISTS registro_pares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  usuario_id  UUID REFERENCES users(id),
  empleado    TEXT NOT NULL,
  fecha       DATE NOT NULL,
  pares       INTEGER NOT NULL DEFAULT 1 CHECK (pares > 0),
  foto_url    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE registro_pares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS registro_pares_tenant_isolation ON registro_pares;
CREATE POLICY registro_pares_tenant_isolation ON registro_pares
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_registro_pares_tenant_fecha ON registro_pares(tenant_id, fecha);

SELECT 'LISTO: tabla registro_pares creada.' AS estado;

-- ========== MIGRACIÓN 008_fix_notificaciones_columnas ==========
-- =====================================================================
-- Sistema SeS — Migración 008 (corrección de auditoría)
-- La tabla `notificaciones` en los archivos SQL del repo no tenía las
-- columnas `prioridad`, `orden_id` e `inventario_id` que el código
-- (js/db.js → createNotification) ya usa para insertar. En tu base de
-- datos real probablemente ya existen (por eso el sistema funciona),
-- pero el SQL versionado quedaba desincronizado — si alguna vez se
-- instala desde cero con SETUP_COMPLETO.sql, fallaría. Este script es
-- seguro de correr aunque las columnas ya existan (no hace nada en ese
-- caso, gracias a IF NOT EXISTS).
-- =====================================================================

ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'Media';
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS orden_id UUID REFERENCES ordenes(id) ON DELETE CASCADE;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS inventario_id UUID REFERENCES inventario(id) ON DELETE CASCADE;

SELECT 'LISTO: columnas de notificaciones verificadas/agregadas.' AS estado;

-- ========== MIGRACIÓN 009_precinto_numerado ==========
-- =====================================================================
-- Sistema SeS — Migración 009
-- PRECINTO NUMERADO: una orden puede tener varios pares (ítems), cada
-- uno con su propio identificador físico (ej: 1042-1, 1042-2), estado
-- de taller y entrega individual.
--
-- Diseño (decisión de arquitectura, ver explicación al usuario): esta
-- tabla es ADITIVA. No modifica ni reemplaza `ordenes` — la orden sigue
-- siendo la unidad de pago/factura/cliente/análisis IA/galería, tal
-- como funciona hoy. `orden_items` agrega el seguimiento físico por
-- par, sin tocar ni arriesgar el resto del sistema ya en producción.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

CREATE TABLE IF NOT EXISTS orden_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  orden_id      UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  numero_item   INT NOT NULL,                -- 1, 2, 3... dentro de la orden
  codigo        TEXT NOT NULL,               -- "1042-1" (precinto físico)
  descripcion   TEXT,                        -- ej. "Nike Air Force 1 blancas" (opcional, para diferenciar pares dentro de la misma orden)
  estado        TEXT NOT NULL DEFAULT 'Recibido'
                  CHECK (estado IN ('Recibido','En Lavado','En Detallado','Listo','Entregado')),
  entregado     BOOLEAN DEFAULT FALSE,
  fecha_entrega TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, numero_item)
);

ALTER TABLE orden_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orden_items_tenant_isolation ON orden_items;
CREATE POLICY orden_items_tenant_isolation ON orden_items
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_orden_items_orden  ON orden_items(orden_id);
CREATE INDEX IF NOT EXISTS idx_orden_items_estado ON orden_items(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_orden_items_codigo ON orden_items(tenant_id, codigo);

SELECT 'LISTO: tabla orden_items (Precinto Numerado) creada.' AS estado;

-- ========== MIGRACIÓN 010_pares_servicio_responsable_multifoto ==========
-- =====================================================================
-- Sistema SeS — Migración 010
-- 1) orden_items: cada par (precinto) ahora guarda su propio tipo de
--    servicio y el empleado responsable, para poder repartir el
--    trabajo par por par en vez de por orden completa.
-- 2) registro_pares: soporta varias fotos por registro (antes solo
--    admitía una), para que el lavador suba de una vez todas las
--    fotos de los pares que terminó.
-- Ejecutar en el SQL Editor de Supabase. Es seguro correrla aunque las
-- columnas ya existan (usa IF NOT EXISTS).
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS tipo_servicio JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS responsable TEXT;

ALTER TABLE registro_pares
  ADD COLUMN IF NOT EXISTS foto_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Migra la foto única que ya existiera hacia el nuevo arreglo, para no
-- perder las fotos ya cargadas antes de esta migración.
UPDATE registro_pares
SET foto_urls = jsonb_build_array(foto_url)
WHERE foto_url IS NOT NULL AND (foto_urls IS NULL OR foto_urls = '[]'::jsonb);

SELECT 'LISTO: columnas de servicio/responsable por par y multi-foto agregadas.' AS estado;

-- ========== MIGRACIÓN 011_fechas_par_estado_pintado ==========
-- =====================================================================
-- Sistema SeS — Migración 011
-- 1) Cada par (orden_items) ahora guarda su propia fecha de ingreso y
--    fecha estimada de entrega (antes esas fechas solo existían a
--    nivel de toda la orden).
-- 2) Se agrega el estado "Pintado" al flujo de la orden.
-- 3) El estado de cada par pasa a un set reducido: Lavado, Secado,
--    "Detallado y Pintado", Entregado (antes: Recibido/En Lavado/
--    En Detallado/Listo/Entregado).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS fecha_ingreso DATE,
  ADD COLUMN IF NOT EXISTS fecha_entrega_estimada DATE;

-- Migra los estados viejos de cada par al nuevo set reducido.
UPDATE orden_items SET estado = 'Lavado'  WHERE estado IN ('Recibido', 'En Lavado');
UPDATE orden_items SET estado = 'Detallado y Pintado' WHERE estado IN ('En Detallado', 'Listo');
-- 'Entregado' se mantiene igual.

ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;
ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Lavado','Secado','Detallado y Pintado','Entregado'));
ALTER TABLE orden_items ALTER COLUMN estado SET DEFAULT 'Lavado';

ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;
ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido','Lavado','Secado','Pintado','Reparación','Finalizado','Entregado'));

SELECT 'LISTO: fechas por par, estado "Pintado" y nuevos estados de par aplicados.' AS estado;

-- ========== MIGRACIÓN 012_ia_por_par ==========
-- =====================================================================
-- Sistema SeS — Migración 012
-- El análisis con IA ahora se puede aplicar a un PAR específico
-- (precinto) de una orden, no solo a la orden en general. Cada par
-- guarda su propio resultado de análisis.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS modelo TEXT,
  ADD COLUMN IF NOT EXISTS tipo_calzado TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS material TEXT,
  ADD COLUMN IF NOT EXISTS estado_calzado TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento_sugerido TEXT;

SELECT 'LISTO: análisis de IA por par agregado a orden_items.' AS estado;

-- ========== MIGRACIÓN 013_seguimiento_por_par ==========
-- =====================================================================
-- Sistema SeS — Migración 013
-- Seguimiento en tiempo real INDIVIDUAL por par (orden_items).
-- Antes el "Seguimiento en tiempo real" (las 9 etapas: Recibido,
-- Lavado, Secado, Detallado, Pintura, Personalización, Control de
-- calidad, Biblioteca, Listo) vivía a nivel de toda la orden, así que
-- si una orden tenía pares con distinta fecha de entrega (ej. 2 pares
-- Exprés a 3 días y otros a 7 días) no se podía distinguir el avance
-- de cada uno. Ahora cada par guarda su propio avance.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS timeline_index INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeline_dates JSONB NOT NULL DEFAULT '{}'::jsonb;

SELECT 'LISTO: seguimiento en tiempo real por par (timeline_index, timeline_dates) agregado a orden_items.' AS estado;

-- ========== MIGRACIÓN 014_control_calidad_por_par ==========
-- =====================================================================
-- Sistema SeS — Migración 014
-- Control de calidad INDIVIDUAL por par (orden_items).
-- El checklist de control de calidad (limpieza, costuras, cordones,
-- pintura, pegado, suela, plantillas, fotos) vivía solo a nivel de
-- toda la orden. Como el "Seguimiento en tiempo real" pasó a ser por
-- par (migración 013), el botón "Abrir control de calidad" del paso
-- calidad necesita su propio checklist por par también.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

ALTER TABLE orden_items
  ADD COLUMN IF NOT EXISTS control_calidad JSONB NOT NULL DEFAULT '{}'::jsonb;

SELECT 'LISTO: control de calidad por par (control_calidad) agregado a orden_items.' AS estado;



-- ========== MIGRACIÓN 015_produccion_por_par ==========
-- =====================================================================
-- Sistema SeS — Migración 015
-- Producción ligada al número de par: cada registro de producción ahora
-- guarda el CÓDIGO del par que el empleado agarró (ej. 12-1) y el
-- SERVICIO que le hizo (Lavado, Detallado, etc.). Con esto se contabiliza
-- por número de orden y se evita que dos empleados registren el MISMO
-- par para el MISMO servicio (un par lavado no se vuelve a registrar
-- como lavado, pero sí puede registrarse aparte como detallado).
-- Ejecutar en el SQL Editor de Supabase. Es seguro correrla aunque las
-- columnas ya existan (usa IF NOT EXISTS).
-- =====================================================================

ALTER TABLE registro_pares
  ADD COLUMN IF NOT EXISTS codigo   TEXT,
  ADD COLUMN IF NOT EXISTS servicio TEXT;

CREATE INDEX IF NOT EXISTS idx_registro_pares_codigo_servicio
  ON registro_pares(tenant_id, codigo, servicio);

SELECT 'LISTO: columnas codigo + servicio agregadas a registro_pares.' AS estado;

-- ========== MIGRACIÓN 016_unificar_estados ==========
-- =====================================================================
-- Sistema SeS — Migración 016
-- Unifica el vocabulario de estados entre los 3 lugares que antes lo
-- manejaban por separado y podían desincronizarse:
--   1) Estado de cada par individual (orden_items.estado)
--   2) Seguimiento en tiempo real (orden_items.timeline_index / ordenes.timeline_index)
--   3) Estado de la orden completa (ordenes.estado)
--
-- Flujo nuevo (el mismo para pares y para la orden):
--   Recibido y registrado → Lavado → Secado y detallado →
--   Pintado y personalizado → Finalizado → Entregado
--
-- Cambios de vocabulario:
--   - "Secado" + "Detallado" se fusionan en "Secado y detallado".
--   - "Pintado" + "Personalización" se fusionan en "Pintado y personalizado".
--   - "Reparación" se QUITA del flujo (ya no es un estado seleccionable).
--
-- Nota: el CHECK constraint de orden_items que dejó la migración 011
-- ('Lavado','Secado','Detallado y Pintado','Entregado') ya estaba
-- desactualizado frente a lo que realmente guardaba la app (Lavado,
-- Secado, Detallado, Pintado, Reparación, Finalizado, Entregado), así
-- que esta migración también corrige esa mezcla, además de sumar los
-- valores más viejos aún (de la migración 009) por si quedan filas sin
-- tocar desde entonces.
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) Migrar los datos existentes de ordenes.estado al vocabulario nuevo.
-- --------------------------------------------------------------------
UPDATE ordenes SET estado = 'Recibido y registrado' WHERE estado = 'Recibido';
UPDATE ordenes SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado');
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado = 'Pintado';
-- "Reparación" ya no existe como estado: se deja en el último paso de
-- trabajo confirmado (Pintado y personalizado) para que el taller la
-- revise y la avance manualmente al estado real que le corresponda.
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado = 'Reparación';
-- 'Finalizado' y 'Entregado' se mantienen igual.

ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;
ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Finalizado','Entregado'));
ALTER TABLE ordenes ALTER COLUMN estado SET DEFAULT 'Recibido y registrado';

-- --------------------------------------------------------------------
-- 2) Migrar los datos existentes de orden_items.estado (pares
--    individuales) al mismo vocabulario nuevo. Cubre tanto los valores
--    que realmente usaba la app (Lavado/Secado/Detallado/Pintado/
--    Reparación/Finalizado/Entregado) como los más viejos que pudieran
--    haber quedado sin migrar de versiones anteriores.
-- --------------------------------------------------------------------
UPDATE orden_items SET estado = 'Recibido y registrado' WHERE estado = 'Recibido';
UPDATE orden_items SET estado = 'Lavado'                WHERE estado = 'En Lavado';
UPDATE orden_items SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado', 'En Detallado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Detallado y Pintado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado = 'Reparación';
UPDATE orden_items SET estado = 'Finalizado'            WHERE estado = 'Listo';
-- 'Finalizado' y 'Entregado' se mantienen igual.

ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;
ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Finalizado','Entregado'));
ALTER TABLE orden_items ALTER COLUMN estado SET DEFAULT 'Recibido y registrado';

SELECT 'LISTO: estados de orden y de pares unificados (Recibido y registrado → Lavado → Secado y detallado → Pintado y personalizado → Finalizado → Entregado).' AS estado;

-- ========== MIGRACIÓN 017_quitar_finalizado ==========
-- =====================================================================
-- Sistema SeS — Migración 017
-- Deja de colapsar "Control de calidad" y "Biblioteca" en un único valor
-- 'Finalizado' para ordenes.estado / orden_items.estado. Ahora la base
-- acepta esos dos nombres reales, y el paso "Listo para retirar" ya no
-- existe: el seguimiento en tiempo real (y el flujo de trabajo) termina
-- en "Biblioteca".
--
-- Flujo nuevo (el mismo para pares y para la orden):
--   Recibido y registrado → Lavado → Secado y detallado →
--   Pintado y personalizado → Control de calidad → Biblioteca → Entregado
--
-- IMPORTANTE sobre el orden de los pasos: primero se QUITA el constraint
-- viejo (que todavía no permite 'Biblioteca'), recién ahí se normalizan
-- los datos, y al final se agrega el constraint nuevo.
--
-- Esta versión además NORMALIZA cualquier valor viejo/heredado que haya
-- podido quedar sin migrar (de versiones anteriores a la 016, o algún
-- NULL), no solo 'Finalizado' — por eso la primera vez pudo fallar con
-- "check constraint ... is violated by some row": había filas con un
-- valor de estado que ni la migración 016 ni esta contemplaban todavía.
-- Es seguro correrla varias veces (todas las UPDATE son idempotentes).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) ordenes.estado
-- --------------------------------------------------------------------
ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_estado_check;

UPDATE ordenes SET estado = 'Recibido y registrado' WHERE estado = 'Recibido' OR estado IS NULL;
UPDATE ordenes SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado');
UPDATE ordenes SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Reparación');
UPDATE ordenes SET estado = 'Biblioteca'             WHERE estado IN ('Finalizado', 'Listo', 'Listo para retirar');
-- Catch-all: cualquier otro valor que no encaje en el vocabulario nuevo
-- (dato corrupto o de una versión aún más vieja) se deja en el estado
-- inicial para no romper el constraint; se puede corregir a mano después.
UPDATE ordenes SET estado = 'Recibido y registrado'
  WHERE estado NOT IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado');

ALTER TABLE ordenes
  ADD CONSTRAINT ordenes_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado'));

-- --------------------------------------------------------------------
-- 2) orden_items.estado (pares individuales)
-- --------------------------------------------------------------------
ALTER TABLE orden_items DROP CONSTRAINT IF EXISTS orden_items_estado_check;

UPDATE orden_items SET estado = 'Recibido y registrado' WHERE estado = 'Recibido' OR estado IS NULL;
UPDATE orden_items SET estado = 'Lavado'                WHERE estado = 'En Lavado';
UPDATE orden_items SET estado = 'Secado y detallado'    WHERE estado IN ('Secado', 'Detallado', 'En Detallado');
UPDATE orden_items SET estado = 'Pintado y personalizado' WHERE estado IN ('Pintado', 'Detallado y Pintado', 'Reparación');
UPDATE orden_items SET estado = 'Biblioteca'            WHERE estado IN ('Finalizado', 'Listo', 'Listo para retirar');
-- Catch-all: mismo criterio que arriba, por si queda algún valor viejo
-- que ninguna migración anterior contempló.
UPDATE orden_items SET estado = 'Recibido y registrado'
  WHERE estado NOT IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado');

ALTER TABLE orden_items
  ADD CONSTRAINT orden_items_estado_check
  CHECK (estado IN ('Recibido y registrado','Lavado','Secado y detallado','Pintado y personalizado','Control de calidad','Biblioteca','Entregado'));

SELECT 'LISTO: se quitó "Finalizado" — ahora la base acepta Control de calidad y Biblioteca por separado, y el flujo termina en Biblioteca (sin Listo para retirar).' AS estado;
