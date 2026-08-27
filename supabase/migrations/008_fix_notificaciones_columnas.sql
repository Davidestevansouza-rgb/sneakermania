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
