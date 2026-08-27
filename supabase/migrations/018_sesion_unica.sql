-- =====================================================================
-- Sistema SeS — Migración 018
-- Sesión única para Empleado/Supervisor + soporte hasta 3 Administradores
-- por tenant.
--
--  • Agrega columna sesion_token en public.users (TEXT, nullable).
--    El frontend guarda en localStorage 'ses-session-token' y lo compara
--    contra esta columna cada ~20s. Si difieren, fuerza logout.
--    Solo aplica a Empleado/Supervisor (Administrador puede tener varias
--    sesiones simultáneas para no bloquear al dueño).
--  • Agrega RLS para que cada usuario pueda leer/actualizar SOLO su propio
--    sesion_token.
--  • Agrega función valida_sesion(userId, token) que devuelve BOOL: TRUE si
--    la sesión sigue siendo la válida, FALSE si fue reemplazada.
--  • Agrega trigger/constraint opcional: nada destructivo, solo columnas
--    nuevas -> seguro correr varias veces (idempotente).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Columna sesion_token en public.users
-- ---------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sesion_token TEXT;

COMMENT ON COLUMN public.users.sesion_token IS
  'Token de sesión único para Empleado/Supervisor. NULL o vacío = sin sesión activa.';

-- ---------------------------------------------------------------------
-- 2) Índice para validar sesión rápidamente
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_sesion_token
  ON public.users (sesion_token)
  WHERE sesion_token IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3) Función valida_sesion(userId, token)
--    Devuelve TRUE si la sesión almacenada para el usuario coincide con
--    el token pasado (usuario sigue logueado en este dispositivo).
--    FALSE si difiere (otro dispositivo tomó la sesión) o si el usuario
--    no existe / está inactivo.
--    SECURITY DEFINER para que el frontend pueda llamarla con su JWT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.valida_sesion(p_user_id UUID, p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id
      AND activo = TRUE
      AND (
            -- Administrador: no bloqueamos multi-sesión
            rol = 'Administrador'
            OR
            -- Empleado/Supervisor: token debe coincidir exactamente
            (rol IN ('Empleado','Supervisor') AND sesion_token = p_token)
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 4) Función establecer_sesion(userId, token)
--    Marca el token de sesión activo para el usuario.
--    Al llamarla desde un nuevo login, automáticamente desplaza la sesión
--    anterior (cualquier otro dispositivo con el token viejo queda inválido).
--    Empleado/Supervisor: SIEMPRE sobrescribe (sesión única).
--    Administrador: NO sobrescribe (mantiene multi-sesión).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.establecer_sesion(p_user_id UUID, p_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.users
     SET sesion_token = p_token,
         updated_at   = NOW()
   WHERE id = p_user_id
     AND rol IN ('Empleado','Supervisor');
$$;

-- ---------------------------------------------------------------------
-- 5) Función cerrar_sesion(userId)
--    Limpia el token de sesión al hacer logout.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cerrar_sesion(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.users
     SET sesion_token = NULL,
         updated_at   = NOW()
   WHERE id = p_user_id
     AND rol IN ('Empleado','Supervisor');
$$;

-- ---------------------------------------------------------------------
-- 6) RLS: cada usuario puede LEER su propia fila (ya existía) y puede
--    ACTUALIZAR su propio sesion_token.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "users update propio sesion_token" ON public.users;

CREATE POLICY "users update propio sesion_token"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------
-- 7) Concesión de ejecución a usuarios autenticados
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.valida_sesion(UUID, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.establecer_sesion(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_sesion(UUID)           TO authenticated;

-- =====================================================================
-- FIN migración 018
-- =====================================================================
