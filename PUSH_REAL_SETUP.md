# Notificaciones Push REALES — SneakerMania

Este documento describe la arquitectura actual sin publicar credenciales privadas.

## Arquitectura

- `sw.js`: recibe eventos Web Push y muestra la notificación del sistema.
- `js/modules/push-notifications.js`: contiene únicamente la clave VAPID **pública**, registra cada dispositivo y renueva automáticamente una suscripción cuando la clave pública cambia.
- `supabase/functions/send-push/index.ts`: envía notificaciones mediante Web Push.
- `push_subscriptions`: almacena las suscripciones por tenant.
- `push_notif_log`: evita duplicados de los resúmenes diarios.
- `pg_cron` + `pg_net`: llaman automáticamente a `send-push`.

## Seguridad

Las claves privadas y secretos **no deben escribirse en este repositorio, documentación, frontend, SQL versionado ni comandos copiados a archivos públicos**.

La configuración productiva actual usa `public.app_config` como almacén interno accesible únicamente mediante `service_role` para:

- `SEND_PUSH_CRON_SECRET`
- `VAPID_PRIVATE_KEY_V2`
- `VAPID_PUBLIC_KEY_V2`

La tabla `app_config` tiene RLS y no está disponible para `anon` ni `authenticated`.

El secreto de cron se genera/rota en el servidor. Los jobs de `pg_cron` no contienen el valor literal: lo leen en tiempo de ejecución desde `app_config`.

## Rotación VAPID

Si alguna clave privada VAPID se considera comprometida:

1. Generar un nuevo par VAPID en un entorno seguro.
2. Guardar la nueva clave privada únicamente en configuración interna del servidor.
3. Actualizar la clave pública del frontend.
4. El frontend detectará dispositivos suscritos con la clave anterior, cancelará esa suscripción y creará una nueva automáticamente cuando el usuario vuelva a abrir la app con permiso de notificaciones concedido.
5. Las suscripciones antiguas que el proveedor marque como inválidas se eliminan automáticamente durante los envíos.

## Verificación

Para verificar producción:

1. Confirmar que `send-push` está `ACTIVE`.
2. Confirmar que los jobs de `cron.job` están activos y que sus comandos obtienen `x-cron-secret` desde `app_config`, nunca desde texto literal.
3. Confirmar al menos una suscripción vigente en `push_subscriptions` después de abrir una versión actualizada de la app.
4. Ejecutar una prueba desde la interfaz de SneakerMania.
5. Verificar recepción con la app abierta, cerrada y con el teléfono bloqueado.

Nunca pegar valores privados reales en este archivo.
