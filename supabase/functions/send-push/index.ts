// ==================================================================
// Edge Function: send-push
// Manda notificaciones push REALES (Web Push) a todos los dispositivos
// suscritos de cada tenant, aunque la app esté cerrada o el celular
// bloqueado. Pensada para ser invocada periódicamente por pg_cron
// (ver supabase/migrations/005_push_subscriptions.sql y el instructivo
// PUSH_REAL_SETUP.md), pero también se puede llamar a mano para probar.
//
// Revisa, por cada tenant que tenga al menos una suscripción activa:
//   - pagos pendientes / parciales
//   - servicios atrasados (fecha estimada vencida y no entregados)
//   - stock bajo
// y manda como máximo UNA notificación por tenant/tipo/día (se registra
// en push_notif_log para no repetir spam en cada corrida del cron).
// ==================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@tudominio.com'
// Secreto compartido para que solo pg_cron (o vos manualmente) puedan
// disparar esta función — evita que cualquiera con la URL sature de push.
const CRON_SECRET = Deno.env.get('CRON_SECRET')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret')
    if (got !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders })
    }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const hoy = new Date().toISOString().slice(0, 10)

    const { data: subs, error: subsErr } = await supabase.from('push_subscriptions').select('*')
    if (subsErr) throw subsErr
    if (!subs || !subs.length) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: 'sin suscripciones' }), { headers: jsonHeaders })
    }

    const tenantIds = [...new Set(subs.map((s: any) => s.tenant_id))]
    let totalEnviados = 0
    const detalle: Record<string, any> = {}

    for (const tenantId of tenantIds) {
      const subsTenant = subs.filter((s: any) => s.tenant_id === tenantId)

      const [{ data: ordenesRaw }, { data: inventario }] = await Promise.all([
        supabase.from('ordenes').select('id, numero, estado, estado_pago, fecha_estimada, extra').eq('tenant_id', tenantId),
        supabase.from('inventario').select('id, nombre, cantidad, stock_minimo').eq('tenant_id', tenantId),
      ])
      // Las órdenes en la Papelera (extra.eliminada = true) no deben contar
      // para pagos pendientes/atrasos — ya no están en uso activo.
      const ordenes = (ordenesRaw || []).filter((o: any) => !(o.extra && o.extra.eliminada === true))

      const pagosPendientes = (ordenes || []).filter((o: any) => o.estado_pago === 'Pendiente' || o.estado_pago === 'Parcial').length
      const atrasados = (ordenes || []).filter((o: any) => o.fecha_estimada && o.fecha_estimada < hoy && o.estado !== 'Entregado').length
      const stockBajo = (inventario || []).filter((i: any) => Number(i.cantidad) <= Number(i.stock_minimo)).length

      const candidatos = [
        { tipo: 'pago', condicion: pagosPendientes > 0, titulo: '💵 Pagos pendientes', mensaje: `Tienes ${pagosPendientes} orden(es) con pago pendiente o parcial.` },
        { tipo: 'atraso', condicion: atrasados > 0, titulo: '⚠️ Servicios atrasados', mensaje: `Tienes ${atrasados} orden(es) atrasada(s) sin entregar.` },
        { tipo: 'stock', condicion: stockBajo > 0, titulo: '📦 Stock bajo', mensaje: `${stockBajo} producto(s) con stock por debajo del mínimo.` },
      ]

      for (const c of candidatos) {
        if (!c.condicion) continue

        // Evitar repetir el mismo tipo de aviso más de una vez por día por tenant.
        const { data: yaEnviado } = await supabase
          .from('push_notif_log')
          .select('id')
          .eq('tenant_id', tenantId).eq('tipo', c.tipo).eq('fecha', hoy)
          .maybeSingle()
        if (yaEnviado) continue

        const payload = JSON.stringify({ titulo: c.titulo, mensaje: c.mensaje, url: './', tag: 'ses-' + c.tipo })

        for (const sub of subsTenant) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            )
            totalEnviados++
          } catch (err: any) {
            // 404/410 = la suscripción venció o el usuario desinstaló: la borramos.
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
              await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            } else {
              console.error('Error enviando push a', sub.endpoint, err?.message || err)
            }
          }
        }

        await supabase.from('push_notif_log').insert({ tenant_id: tenantId, tipo: c.tipo, fecha: hoy })
      }

      detalle[tenantId] = { pagosPendientes, atrasados, stockBajo, dispositivos: subsTenant.length }
    }

    return new Response(JSON.stringify({ ok: true, enviados: totalEnviados, detalle }), { headers: jsonHeaders })
  } catch (e) {
    console.error('send-push error:', e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders })
  }
})
