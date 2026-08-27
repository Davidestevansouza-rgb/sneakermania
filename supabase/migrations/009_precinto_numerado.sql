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
