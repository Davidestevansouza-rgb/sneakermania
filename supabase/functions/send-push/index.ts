import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@tudominio.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const SUMMARY_MAP: Record<string, string> = { atrasados: 'atraso', stock_bajo: 'stock', pagos_pendientes: 'pago' }
function extraerCantidad(o: any): number { return Number((o.extra && o.extra.cantidadPares) || o.cantidad || o.pares || 1) || 1 }
function armarCuerpoOrdenes(items: any[], total: number): string { const lineas = items.map((it: any, idx: number) => `${idx + 1}) #${it.orden} — ${it.cantidad} par(es) — ${it.cliente}`); const resto = total - items.length; if (resto > 0) lineas.push(`y ${resto} más...`); return lineas.join('\n') }
function armarCuerpoStock(items: any[], total: number): string { const lineas = items.map((it: any, idx: number) => `${idx + 1}) ${it.nombre} (${it.cantidad}/${it.minimo})`); const resto = total - items.length; if (resto > 0) lineas.push(`y ${resto} más...`); return lineas.join('\n') }

async function getExpectedSecret(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'SEND_PUSH_CRON_SECRET').maybeSingle()
  if (error || !data?.value) return null
  return data.value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: jsonHeaders })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return new Response(JSON.stringify({ error: 'Endpoint no configurado' }), { status: 503, headers: jsonHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const expectedSecret = await getExpectedSecret(supabase)
    const got = req.headers.get('x-cron-secret') || ''
    if (!expectedSecret) return new Response(JSON.stringify({ error: 'Endpoint de cron no configurado' }), { status: 503, headers: jsonHeaders })
    if (!got || got !== expectedSecret) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders })

    const hoy = new Date().toISOString().slice(0, 10)
    const urlObj = new URL(req.url)
    const summaryParam = urlObj.searchParams.get('summary') || ''
    const soloTipo = SUMMARY_MAP[summaryParam] || null

    const { data: subs, error: subsErr } = await supabase.from('push_subscriptions').select('*')
    if (subsErr) throw subsErr
    if (!subs || !subs.length) return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: 'sin suscripciones' }), { headers: jsonHeaders })

    const tenantIds = [...new Set(subs.map((s: any) => s.tenant_id))]
    let totalEnviados = 0
    const detalle: Record<string, any> = {}

    for (const tenantId of tenantIds) {
      const subsTenant = subs.filter((s: any) => s.tenant_id === tenantId)
      const { data: ordenesRaw, error: ordenesErr } = await supabase.from('ordenes').select('id, numero, estado, estado_pago, fecha_estimada, extra').eq('tenant_id', tenantId)
      if (ordenesErr) { detalle[tenantId] = { error: 'No se pudo consultar ordenes', dispositivos: subsTenant.length }; continue }
      const { data: inventario, error: invErr } = await supabase.from('inventario').select('id, nombre, cantidad, stock_minimo').eq('tenant_id', tenantId)
      if (invErr) console.error('Error consultando inventario:', invErr)
      const ordenes = (ordenesRaw || []).filter((o: any) => !(o.extra && o.extra.eliminada === true))
      const clienteIds = [...new Set(ordenes.map((o: any) => o.extra?.clienteId).filter(Boolean))]
      const clientesMap: Record<string, string> = {}
      if (clienteIds.length > 0) {
        const { data: clientesData } = await supabase.from('clientes').select('id, nombre').in('id', clienteIds)
        for (const c of clientesData || []) clientesMap[c.id] = c.nombre || 'Cliente'
      }
      const itemsPagos = ordenes.filter((o: any) => o.estado_pago === 'Pendiente' || o.estado_pago === 'Parcial')
      const itemsAtrasados = ordenes.filter((o: any) => o.fecha_estimada && o.fecha_estimada < hoy && o.estado !== 'Entregado')
      const itemsStock = (inventario || []).filter((i: any) => Number(i.cantidad) <= Number(i.stock_minimo))
      const getClienteNombre = (o: any) => { const cid = o.extra?.clienteId; return cid && clientesMap[cid] ? clientesMap[cid] : 'Cliente' }
      const MAX_ITEMS = 5
      const mapItemOrden = (o: any) => ({ orden: o.numero || o.id, cliente: getClienteNombre(o), cantidad: extraerCantidad(o) })
      const candidatos: any[] = [
        { tipo:'pago', condicion:itemsPagos.length>0, titulo:`SneakerMania — ${itemsPagos.length} pago(s) pendiente(s)`, tag:'ses-pago', type:'resumen_pagos', armarMensaje:()=>armarCuerpoOrdenes(itemsPagos.slice(0,MAX_ITEMS).map(mapItemOrden),itemsPagos.length), armarItems:()=>itemsPagos.slice(0,MAX_ITEMS).map(mapItemOrden) },
        { tipo:'atraso', condicion:itemsAtrasados.length>0, titulo:`SneakerMania — ${itemsAtrasados.length} orden(es) atrasada(s)`, tag:'ses-atraso', type:'resumen_atrasados', armarMensaje:()=>armarCuerpoOrdenes(itemsAtrasados.slice(0,MAX_ITEMS).map(mapItemOrden),itemsAtrasados.length), armarItems:()=>itemsAtrasados.slice(0,MAX_ITEMS).map(mapItemOrden) },
        { tipo:'stock', condicion:itemsStock.length>0, titulo:`SneakerMania — ${itemsStock.length} producto(s) con stock bajo`, tag:'ses-stock', type:'resumen_stock', armarMensaje:()=>armarCuerpoStock(itemsStock.slice(0,MAX_ITEMS).map((i:any)=>({nombre:i.nombre||'Producto',cantidad:i.cantidad,minimo:i.stock_minimo})),itemsStock.length), armarItems:()=>itemsStock.slice(0,MAX_ITEMS).map((i:any)=>({nombre:i.nombre||'Producto',cantidad:i.cantidad,minimo:i.stock_minimo})) }
      ].filter((c:any) => c.condicion && (!soloTipo || c.tipo === soloTipo))

      for (const c of candidatos) {
        if (!soloTipo) {
          const { data: yaEnviado } = await supabase.from('push_notif_log').select('id').eq('tenant_id',tenantId).eq('tipo',c.tipo).eq('fecha',hoy).maybeSingle()
          if (yaEnviado) continue
        }
        const payload = JSON.stringify({ titulo:c.titulo, mensaje:c.armarMensaje(), url:'./', tag:c.tag, type:c.type, items:c.armarItems(), tenant_id:tenantId })
        for (const sub of subsTenant) {
          try { await webpush.sendNotification({ endpoint:sub.endpoint, keys:{p256dh:sub.p256dh,auth:sub.auth} },payload); totalEnviados++ }
          catch (err:any) { if (err && (err.statusCode===404 || err.statusCode===410)) await supabase.from('push_subscriptions').delete().eq('id',sub.id); else console.error('Error enviando push:',err?.message||err) }
        }
        await supabase.from('push_notif_log').insert({tenant_id:tenantId,tipo:c.tipo,fecha:hoy})
      }
      detalle[tenantId] = { pagosPendientes:itemsPagos.length, atrasados:itemsAtrasados.length, stockBajo:itemsStock.length, dispositivos:subsTenant.length, modo:soloTipo?`summary=${summaryParam}`:'completo' }
    }
    return new Response(JSON.stringify({ok:true,enviados:totalEnviados,detalle}),{headers:jsonHeaders})
  } catch (e) {
    console.error('send-push error:', e)
    return new Response(JSON.stringify({error:'Error interno del servidor'}),{status:500,headers:jsonHeaders})
  }
})
