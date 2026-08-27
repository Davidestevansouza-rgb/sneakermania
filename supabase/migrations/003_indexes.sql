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
