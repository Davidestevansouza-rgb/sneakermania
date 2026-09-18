-- Clave idempotente para impedir notificaciones automáticas duplicadas.
-- Los registros históricos quedan intactos: NULL no entra en conflicto con UNIQUE.
ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_dedupe_key_unique
  ON public.notificaciones (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
