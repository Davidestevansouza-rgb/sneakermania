-- Independiza prioridad y pago por par (orden_items).
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'Media';
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS precio NUMERIC DEFAULT 0;
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS pagado NUMERIC DEFAULT 0;
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'Pendiente';
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS metodo_pago TEXT;
ALTER TABLE public.orden_items ADD COLUMN IF NOT EXISTS fecha_pago DATE;
