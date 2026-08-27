# Notificaciones Push REALES — Guía de puesta en producción

Esto reemplaza el sistema "demo" (localStorage + key pública de ejemplo)
por notificaciones push de verdad: llegan aunque la app esté cerrada o el
celular bloqueado, mandadas por un servidor (Supabase Edge Function),
igual que cualquier app comercial.

## 0. Qué cambió en el código (ya está en el ZIP)

- `sw.js` — el Service Worker ahora tiene los listeners `push` y
  `notificationclick` (antes no existían: por eso nunca iba a sonar nada
  con la app cerrada, sin importar qué tan bien estuviera configurado el
  resto).
- `js/modules/push-notifications.js` — usa la VAPID key REAL de este
  proyecto (ya generada, ver abajo) y guarda la suscripción de cada
  dispositivo en Supabase (tabla `push_subscriptions`), no en
  `localStorage`.
- `supabase/functions/send-push/index.ts` — Edge Function nueva: es la
  que de verdad manda los push. Revisa pagos pendientes, atrasos y stock
  bajo por cada tienda (tenant) y le manda un push a cada dispositivo
  registrado. Manda como máximo 1 aviso por tipo por día (no satura).
- `supabase/migrations/005_push_subscriptions.sql` — tablas nuevas
  (`push_subscriptions`, `push_notif_log`).

## 1. Correr la migración SQL

Supabase → **SQL Editor** → pegar y ejecutar el contenido de:
`supabase/migrations/005_push_subscriptions.sql`

## 2. Tus VAPID keys (ya generadas, listas para usar)

```
VAPID_PUBLIC_KEY  = BKS5WiqA6iRzj52zakuKzGSbX6ZtZU8rXf12KrIDwGSMvgv5JElQcxNsgn2wwYUGEw6oQgv-sV8w4jYMmqzDCFc
VAPID_PRIVATE_KEY = rGHaw7mfwWBIpaKNrURfM1t5b2GHJD_DgKPxMAyfjqs
```

⚠️ **La `VAPID_PRIVATE_KEY` es secreta.** Nunca la pongas en el frontend
ni la subas a un repo público — solo va como *Secret* de la Edge
Function (paso 4). La `VAPID_PUBLIC_KEY` sí es pública y ya está escrita
en `push-notifications.js`.

Si en algún momento sospechás que la privada se filtró, generá un par
nuevo (cualquier generador de claves VAPID online, o `npx web-push
generate-vapid-keys` con Node) y actualizá ambos lugares.

## 3. Desplegar la Edge Function `send-push`

Con Supabase CLI (desde la carpeta del proyecto, con el CLI ya logueado
y linkeado a tu proyecto):

```bash
supabase functions deploy send-push
```

## 4. Configurar los Secrets de la función

Supabase → **Edge Functions** → `send-push` → **Secrets** (o por CLI):

```bash
supabase secrets set VAPID_PUBLIC_KEY=BKS5WiqA6iRzj52zakuKzGSbX6ZtZU8rXf12KrIDwGSMvgv5JElQcxNsgn2wwYUGEw6oQgv-sV8w4jYMmqzDCFc
supabase secrets set VAPID_PRIVATE_KEY=rGHaw7mfwWBIpaKNrURfM1t5b2GHJD_DgKPxMAyfjqs
supabase secrets set VAPID_SUBJECT=mailto:tu-correo-real@tudominio.com
supabase secrets set CRON_SECRET=JdiSHv9SMFBaQRPPWm5dVsXX1_56A4SxwEmnFgB2uaU
```

(`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen automáticamente
en toda Edge Function, no hace falta configurarlos.)

## 5. Programar el envío automático (pg_cron)

Sin esto, la función existe pero nadie la llama — necesitás que Supabase
la dispare solo, por ejemplo cada 30 minutos. En el **SQL Editor**:

```sql
-- Habilitar extensiones necesarias (una sola vez)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ses-send-push-cada-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://TU-PROYECTO.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'JdiSHv9SMFBaQRPPWm5dVsXX1_56A4SxwEmnFgB2uaU'
    )
  );
  $$
);
```

Reemplazá `TU-PROYECTO` por el ID real de tu proyecto Supabase (lo ves en
la URL del dashboard). Con esto, cada 30 minutos Supabase revisa solo si
hay algo que avisar y lo manda — sin depender de que la app esté abierta.

Para desactivarlo más adelante: `select cron.unschedule('ses-send-push-cada-30-min');`

## 6. Probar que todo funciona de punta a punta

1. Abrí el sistema en el celular o PC que va a recibir avisos (tiene que
   ser `https://` o `localhost`, nunca `http://` plano).
2. Iniciá sesión → **Configuración** → **"Activar notificaciones"** →
   aceptá el permiso del navegador.
3. Confirmá en Supabase → **Table Editor** → `push_subscriptions` que
   apareció una fila nueva con el `endpoint` de ese dispositivo.
4. Para forzar un envío YA (sin esperar los 30 min del cron), llamá a la
   función a mano desde una terminal:

```bash
curl -X POST https://TU-PROYECTO.supabase.co/functions/v1/send-push \
  -H "x-cron-secret: JdiSHv9SMFBaQRPPWm5dVsXX1_56A4SxwEmnFgB2uaU" \
  -H "Content-Type: application/json"
```

   Si hay algún pago pendiente/atraso/stock bajo cargado en el sistema
   de esa tienda, en unos segundos debería sonar la notificación real en
   el celular — **con la app cerrada**, para probar que es real y no demo.
5. Repetí la prueba con el celular bloqueado (pantalla apagada) para
   confirmar que también llega ahí.

## 7. Antes de la prueba en la tienda (checklist final)

- [ ] Migración 005 corrida en Supabase.
- [ ] `send-push` desplegada y con los 4 Secrets configurados.
- [ ] pg_cron programado y corriendo (`select * from cron.job;` para
      verlo listado).
- [ ] Al menos un dispositivo de prueba activó el permiso y aparece en
      `push_subscriptions`.
- [ ] Probaste con la app cerrada y con el celular bloqueado.
- [ ] El sitio está servido en `https://` real (no `localhost`) para la
      prueba en la tienda — los navegadores exigen HTTPS para push fuera
      de desarrollo local.
