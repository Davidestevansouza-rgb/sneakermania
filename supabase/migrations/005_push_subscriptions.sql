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
