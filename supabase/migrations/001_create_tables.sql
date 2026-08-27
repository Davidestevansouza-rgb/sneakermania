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
                    'Recibido','Lavado','Secado','Reparación','Finalizado','Entregado')),
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
  tipo        TEXT NOT NULL,  -- 'entrega_hoy','atraso','stock_bajo','pago_pendiente'
  texto       TEXT NOT NULL,
  leida       BOOLEAN DEFAULT FALSE,
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
