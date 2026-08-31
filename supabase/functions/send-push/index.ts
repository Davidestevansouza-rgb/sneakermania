// ==================================================================
// Edge Function: send-push (v2 corregida con nombres de cliente)
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
const CRON_SECRET = Deno.env.get('CRON_SECRET')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const SUMMARY_MAP: Record<string, string> = {
  atrasados: 'atraso',
  stock_bajo: 'stock',
  pagos_pendientes: 'pago',
}

// --- Helpers ---
function extraerCantidad(o: any): number {
  const c = (o.extra && o.extra.cantidadPares) || o.cantidad || o.pares || 1
  return Number(c) || 1
}

function armarCuerpoOrdenes(items: any[], total: number): string {
  const lineas = items.map((it: any, idx: number) =>
    `${idx + 1}) #${it.orden} — ${it.cantidad} par(es) — ${it.cliente}`
  )
  const resto = total - items.length
  if (resto > 0) lineas.push(`y ${resto} más...`)
  return lineas.join('\n')
}

function armarCuerpoStock(items: any[], total: number): string {
  const lineas = items.map((it: any, idx: number) =>
    `${idx + 1}) ${it.nombre} (${it.cantidad}/${it.minimo})`
  )
  const resto = total - items.length
  if (resto > 0) lineas.push(`y ${resto} más...`)
  return lineas.join('\n')
}

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

    const urlObj = new URL(req.url)
    const summaryParam = urlObj.searchParams.get('summary') || ''
    const soloTipo = SUMMARY_MAP[summaryParam] || null

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

      // --- Consultar órdenes (solo columnas que existen) ---
      const { data: ordenesRaw, error: ordenesErr } = await supabase
        .from('ordenes')
        .select('id, numero, estado, estado_pago, fecha_estimada, extra')
        .eq('tenant_id', tenantId)

      if (ordenesErr) {
        console.error('Error consultando ordenes:', ordenesErr)
        detalle[tenantId] = { pagosPendientes: 0, atrasados: 0, stockBajo: 0, dispositivos: subsTenant.length, error: 'No se pudo consultar ordenes', modo: soloTipo ? `summary=${summaryParam}` : 'completo' }
        continue
      }

      const { data: inventario, error: invErr } = await supabase
        .from('inventario')
        .select('id, nombre, cantidad, stock_minimo')
        .eq('tenant_id', tenantId)

      if (invErr) console.error('Error consultando inventario:', invErr)

      // Filtrar órdenes de la Papelera
      const ordenes = (ordenesRaw || []).filter((o: any) => !(o.extra && o.extra.eliminada === true))

      // --- Buscar nombres de clientes ---
      const clienteIds = [...new Set(
        ordenes.map((o: any) => o.extra?.clienteId).filter(Boolean)
      )]
      const clientesMap: Record<string, string> = {}
      if (clienteIds.length > 0) {
        try {
          const { data: clientesData } = await supabase
            .from('clientes')
            .select('id, nombre')
            .in('id', clienteIds)
          for (const c of clientesData || []) {
            clientesMap[c.id] = c.nombre || 'Cliente'
          }
        } catch (e) {
          console.error('No se pudo consultar clientes:', e)
        }
      }

      // --- Listas detalladas por tipo ---
      const itemsPagos = ordenes.filter((o: any) =>
        o.estado_pago === 'Pendiente' || o.estado_pago === 'Parcial'
      )
      const itemsAtrasados = ordenes.filter((o: any) =>
        o.fecha_estimada && o.fecha_estimada < hoy && o.estado !== 'Entregado'
      )
      const itemsStock = (inventario || []).filter((i: any) =>
        Number(i.cantidad) <= Number(i.stock_minimo)
      )

      const getClienteNombre = (o: any): string => {
        const cid = o.extra?.clienteId
        if (cid && clientesMap[cid]) return clientesMap[cid]
        return 'Cliente'
      }

      const MAX_ITEMS = 5

      const mapItemOrden = (o: any) => ({
        orden: o.numero || o.id,
        cliente: getClienteNombre(o),
        cantidad: extraerCantidad(o),
      })

      const candidatoPago = {
        tipo: 'pago',
        condicion: itemsPagos.length > 0,
        titulo: `SneakerMania — ${itemsPagos.length} pago(s) pendiente(s)`,
        tag: 'ses-pago',
        type: 'resumen_pagos',
        armarMensaje: () => armarCuerpoOrdenes(itemsPagos.slice(0, MAX_ITEMS).map(mapItemOrden), itemsPagos.length),
        armarItems: () => itemsPagos.slice(0, MAX_ITEMS).map(mapItemOrden),
      }

      const candidatoAtraso = {
        tipo: 'atraso',
        condicion: itemsAtrasados.length > 0,
        titulo: `SneakerMania — ${itemsAtrasados.length} orden(es) atrasada(s)`,
        tag: 'ses-atraso',
        type: 'resumen_atrasados',
        armarMensaje: () => armarCuerpoOrdenes(itemsAtrasados.slice(0, MAX_ITEMS).map(mapItemOrden), itemsAtrasados.length),
        armarItems: () => itemsAtrasados.slice(0, MAX_ITEMS).map(mapItemOrden),
      }

      const candidatoStock = {
        tipo: 'stock',
        condicion: itemsStock.length > 0,
        titulo: `SneakerMania — ${itemsStock.length} producto(s) con stock bajo`,
        tag: 'ses-stock',
        type: 'resumen_stock',
        armarMensaje: () => armarCuerpoStock(
          itemsStock.slice(0, MAX_ITEMS).map((i: any) => ({ nombre: i.nombre || 'Producto', cantidad: i.cantidad, minimo: i.stock_minimo })),
          itemsStock.length
        ),
        armarItems: () => itemsStock.slice(0, MAX_ITEMS).map((i: any) => ({ nombre: i.nombre || 'Producto', cantidad: i.cantidad, minimo: i.stock_minimo })),
      }

      let candidatos: any[] = [candidatoPago, candidatoAtraso, candidatoStock]
      if (soloTipo) {
        candidatos = candidatos.filter((c) => c.tipo === soloTipo)
      }

      for (const c of candidatos) {
        if (!c.condicion) continue

        if (!soloTipo) {
          const { data: yaEnviado } = await supabase
            .from('push_notif_log')
            .select('id')
            .eq('tenant_id', tenantId).eq('tipo', c.tipo).eq('fecha', hoy)
            .maybeSingle()
          if (yaEnviado) continue
        }

        const mensaje = c.armarMensaje()
        const items = c.armarItems()

        const payload = JSON.stringify({
          titulo: c.titulo,
          mensaje,
          url: './',
          tag: c.tag,
          type: c.type,
          items,
          tenant_id: tenantId,
        })

        for (const sub of subsTenant) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            )
            totalEnviados++
          } catch (err: any) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
              await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            } else {
              console.error('Error enviando push a', sub.endpoint, err?.message || err)
            }
          }
        }

        await supabase.from('push_notif_log').insert({ tenant_id: tenantId, tipo: c.tipo, fecha: hoy })
      }

      detalle[tenantId] = {
        pagosPendientes: itemsPagos.length,
        atrasados: itemsAtrasados.length,
        stockBajo: itemsStock.length,
        dispositivos: subsTenant.length,
        modo: soloTipo ? `summary=${summaryParam}` : 'completo',
      }
    }

    return new Response(JSON.stringify({ ok: true, enviados: totalEnviados, detalle }), { headers: jsonHeaders })
  } catch (e) {
    console.error('send-push error:', e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders })
  }
})