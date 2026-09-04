-- =====================================================================
-- Sistema SeS — Migración 026: Contador atómico de números de orden
--
-- Problema: el número de orden se generaba client-side (nextOrderNum++)
-- lo que permite que dos usuarios simultáneos obtengan el mismo número.
-- Solución: tabla de contadores con UPDATE ... RETURNING para garantizar
-- que cada tenant siempre obtiene un número único e irrepetible.
-- =====================================================================

-- Tabla de contadores por tenant
CREATE TABLE IF NOT EXISTS public.orden_contadores (
  tenant_id  UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  siguiente  INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id)
);

-- RLS: cada tenant solo puede leer/modificar su propio contador
ALTER TABLE public.orden_contadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orden_contadores_tenant ON public.orden_contadores;
CREATE POLICY orden_contadores_tenant ON public.orden_contadores
  FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Inicializar contadores para todos los tenants existentes
-- (parte desde el máximo número de orden actual + 1)
INSERT INTO public.orden_contadores (tenant_id, siguiente)
SELECT
  t.id,
  COALESCE((SELECT MAX((o.extra->>'numero')::int) FROM public.ordenes o WHERE o.tenant_id = t.id), 0) + 1
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- -------------------------------------------------------------------------
-- Función: siguiente_orden_numero(p_tenant_id)
-- Devuelve el próximo número de orden para el tenant e incrementa
-- el contador de forma ATÓMICA (un solo UPDATE ... RETURNING).
-- SECURITY DEFINER para que cualquier usuario autenticado pueda llamarla
-- aunque no tenga acceso directo a la tabla.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siguiente_orden_numero(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_num INTEGER;
BEGIN
  -- Inserta el contador si no existe (primera orden del tenant)
  INSERT INTO public.orden_contadores (tenant_id, siguiente)
  VALUES (p_tenant_id, 1)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Incremento atómico: nadie más puede obtener el mismo número
  UPDATE public.orden_contadores
     SET siguiente = siguiente + 1
   WHERE tenant_id = p_tenant_id
  RETURNING siguiente - 1 INTO v_num;

  RETURN v_num;
END;
$$;

-- Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.siguiente_orden_numero(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.siguiente_orden_numero(UUID) TO anon;

-- =====================================================================
-- FIN migración 026
-- =====================================================================
