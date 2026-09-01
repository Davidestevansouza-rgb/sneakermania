-- ============================================================
-- MIGRACIÓN 025: Monitoreo automático del sistema
-- Crea las tablas y funciones necesarias para las alertas
-- (Nota: numerada 025 porque 020-024 ya existen en el repo)
-- ============================================================

-- Función para obtener el tamaño de la BD en MB
CREATE OR REPLACE FUNCTION get_db_size_mb()
RETURNS float
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_database_size(current_database()) / (1024.0 * 1024.0);
$$;

-- Tabla de log de intentos de autenticación sospechosos
CREATE TABLE IF NOT EXISTS auth_monitoring_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address text NOT NULL,
  user_email text,
  event_type text NOT NULL DEFAULT 'failed_login',
  count integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Índice para búsquedas rápidas por IP y fecha
CREATE INDEX IF NOT EXISTS idx_auth_monitoring_ip_date
  ON auth_monitoring_log (ip_address, created_at DESC);

-- Tabla de log de errores del sistema
CREATE TABLE IF NOT EXISTS system_error_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message text NOT NULL,
  detail text,
  severity text DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  source text,
  created_at timestamptz DEFAULT now()
);

-- Función que registra intentos fallidos de login
-- Se puede llamar desde triggers de auth.users o desde el Edge Function de auth
CREATE OR REPLACE FUNCTION log_failed_login(p_ip text, p_email text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Incrementar contador si ya existe un registro reciente (últimos 10 min)
  UPDATE auth_monitoring_log
  SET count = count + 1
  WHERE ip_address = p_ip
    AND created_at > now() - interval '10 minutes'
    AND event_type = 'failed_login';

  -- Si no se actualizó ninguna fila, insertar nuevo registro
  IF NOT FOUND THEN
    INSERT INTO auth_monitoring_log (ip_address, user_email, event_type, count)
    VALUES (p_ip, p_email, 'failed_login', 1);
  END IF;
END;
$$;

-- Limpiar registros viejos de monitoring (mantener solo últimas 48h)
CREATE OR REPLACE FUNCTION cleanup_monitoring_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM auth_monitoring_log WHERE created_at < now() - interval '48 hours';
  DELETE FROM system_error_log WHERE created_at < now() - interval '7 days' AND severity != 'critical';
$$;

-- RLS: Solo service_role puede leer/escribir estas tablas
ALTER TABLE auth_monitoring_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_error_log ENABLE ROW LEVEL SECURITY;

-- No se permite acceso directo desde el cliente (solo Edge Functions con service_role)
CREATE POLICY "solo_service_role_auth_log" ON auth_monitoring_log
  FOR ALL USING (false);

CREATE POLICY "solo_service_role_system_log" ON system_error_log
  FOR ALL USING (false);
