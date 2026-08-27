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
