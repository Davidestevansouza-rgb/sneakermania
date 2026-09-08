/* WhatsApp de órdenes: respuesta visible inmediata y navegación sin popup bloqueable. */
import { state } from '../state.js';
import { showToast } from '../ui.js';
import * as storageManager from '../storage-manager.js';
import { ordenQrText } from './ordenes.js';

const fotoUrlCache = new Map();

function clienteDeOrden(o) {
  return (state.clientes || []).find(c => c.id === o.clienteId) || null;
}

function primeraFotoOrden(o) {
  const fotos = o && o.extra && Array.isArray(o.extra.fotos) ? o.extra.fotos : [];
  return fotos.find(f => f.categoria === 'todos_pares') || fotos.find(f => f.itemId || f.item) || fotos[0] || null;
}

function overlayWhatsApp(mostrar) {
  let el = document.getElementById('sm-whatsapp-opening');
  if (!mostrar) {
    if (el) el.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'sm-whatsapp-opening';
  el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:24px;';
  el.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px 22px;max-width:320px;width:100%;text-align:center;font-family:Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)"><div style="font-size:30px;margin-bottom:8px">💬</div><strong>Abriendo WhatsApp…</strong><div style="font-size:13px;color:#666;margin-top:7px">Preparando la información de la orden.</div></div>';
  document.body.appendChild(el);
}

async function resolverFotoOrden(o, ms = 4000) {
  if (!o) return null;
  if (fotoUrlCache.has(o.id)) return fotoUrlCache.get(o.id);
  const foto = primeraFotoOrden(o);
  if (!foto) return null;
  if (foto.resolvedUrl && /^https?:\/\//i.test(foto.resolvedUrl)) {
    fotoUrlCache.set(o.id, foto.resolvedUrl);
    return foto.resolvedUrl;
  }
  if (foto.url && /^https?:\/\//i.test(foto.url)) {
    fotoUrlCache.set(o.id, foto.url);
    return foto.url;
  }
  try {
    const url = await Promise.race([
      storageManager.resolveImageUrl(foto.url, foto.path),
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
    if (url && /^https?:\/\//i.test(url)) fotoUrlCache.set(o.id, url);
    return url || null;
  } catch (_) {
    return null;
  }
}

function idOrdenDesdeContexto(btn) {
  const modal = document.getElementById('modal-forma-pago');
  const oculto = document.getElementById('orden-id');
  return (btn && btn.dataset && btn.dataset.ordenId) ||
    (modal && modal.dataset && modal.dataset.ordenId) ||
    window.__smFormaPagoOrdenId ||
    (oculto && oculto.value) || '';
}

export async function enviarWhatsAppOrdenRapido(ordenId) {
  const o = (state.ordenes || []).find(x => x.id === ordenId);
  if (!o) { showToast('Orden no encontrada'); return false; }
  const c = clienteDeOrden(o);
  if (!c) { showToast('Cliente no encontrado'); return false; }
  const tel = String(c.whatsapp || c.telefono || '').replace(/\D/g, '');
  if (!tel) { showToast('El cliente no tiene un número de WhatsApp válido'); return false; }

  overlayWhatsApp(true);
  const baseMsg = 'Hola ' + (c.nombre || '') + ' 👟\n\n' + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
  const fotoUrl = await resolverFotoOrden(o, 4000);
  const msg = baseMsg + (fotoUrl ? '\n\n📷 Foto del artículo:\n' + fotoUrl : '');
  const wa = 'https://api.whatsapp.com/send?phone=' + tel + '&text=' + encodeURIComponent(msg);

  try {
    window.location.assign(wa);
  } catch (e) {
    overlayWhatsApp(false);
    console.error('No se pudo abrir WhatsApp:', e);
    showToast('No se pudo abrir WhatsApp');
    return false;
  }
  return true;
}

window.enviarWhatsAppOrden = enviarWhatsAppOrdenRapido;
window.enviarWhatsAppOrdenRapido = enviarWhatsAppOrdenRapido;

// Captura el botón del modal de forma de pago ANTES del onclick viejo.
document.addEventListener('click', (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('#forma-pago-whatsapp-btn') : null;
  if (!btn) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const id = idOrdenDesdeContexto(btn);
  if (!id) {
    showToast('No se pudo identificar la orden para WhatsApp');
    return;
  }
  void enviarWhatsAppOrdenRapido(id);
}, true);

// Cuando se abre el registro de pago desde la orden, recordamos el ID y preparamos la foto.
document.addEventListener('click', (ev) => {
  const el = ev.target && ev.target.closest ? ev.target.closest('[onclick*="openFormaPagoChooser"], [onclick*="abrirRegistroPagoDesdeModal"]') : null;
  if (!el) return;
  let id = '';
  const txt = el.getAttribute('onclick') || '';
  const m = txt.match(/openFormaPagoChooser\(['\"]([^'\"]+)['\"]\)/);
  if (m) id = m[1];
  if (!id) id = (document.getElementById('orden-id') || {}).value || '';
  if (!id) return;
  window.__smFormaPagoOrdenId = id;
  const modal = document.getElementById('modal-forma-pago');
  if (modal) modal.dataset.ordenId = id;
  const o = (state.ordenes || []).find(x => x.id === id);
  if (o) void resolverFotoOrden(o, 5000);
}, true);

// Wrapping adicional para llamadas globales al chooser.
if (typeof window.openFormaPagoChooser === 'function' && !window.openFormaPagoChooser.__smWaFast2) {
  const originalChooser = window.openFormaPagoChooser;
  const wrapped = function(id, ...args) {
    window.__smFormaPagoOrdenId = id;
    const modal = document.getElementById('modal-forma-pago');
    if (modal) modal.dataset.ordenId = id || '';
    const o = (state.ordenes || []).find(x => x.id === id);
    if (o) void resolverFotoOrden(o, 5000);
    return originalChooser.call(this, id, ...args);
  };
  wrapped.__smWaFast2 = true;
  window.openFormaPagoChooser = wrapped;
}

// Nueva orden fusionada: evita el envío viejo y usa el flujo nuevo al terminar.
if (typeof window.guardarClienteOrden === 'function' && !window.guardarClienteOrden.__smWaFast2) {
  const originalGuardar = window.guardarClienteOrden;
  const wrappedGuardar = async function(...args) {
    const chk = document.getElementById('nco-enviar-whatsapp');
    const quiereWA = !!(chk && chk.checked);
    const idsAntes = new Set((state.ordenes || []).map(o => o.id));
    if (quiereWA && chk) chk.checked = false;
    try {
      const r = await originalGuardar.apply(this, args);
      if (quiereWA) {
        const nueva = (state.ordenes || []).filter(o => !idsAntes.has(o.id)).sort((a,b) => Number(b.numero || 0) - Number(a.numero || 0))[0];
        if (nueva) void enviarWhatsAppOrdenRapido(nueva.id);
      }
      return r;
    } finally {
      if (chk) chk.checked = quiereWA;
    }
  };
  wrappedGuardar.__smWaFast2 = true;
  window.guardarClienteOrden = wrappedGuardar;
}
