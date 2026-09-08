/* WhatsApp de órdenes: envío directo de texto al número guardado. */
import { state } from '../state.js';
import { showToast } from '../ui.js';
import { ordenQrText } from './ordenes.js';

function clienteDeOrden(o) {
  return (state.clientes || []).find(c => c.id === o.clienteId) || null;
}

function idOrdenDesdeContexto(btn) {
  const modal = document.getElementById('modal-forma-pago');
  const oculto = document.getElementById('orden-id');
  return (btn && btn.dataset && btn.dataset.ordenId) ||
    (modal && modal.dataset && modal.dataset.ordenId) ||
    window.__smFormaPagoOrdenId ||
    (oculto && oculto.value) || '';
}

function abrirChatDirecto(tel, msg) {
  const wa = 'https://api.whatsapp.com/send?phone=' + tel + '&text=' + encodeURIComponent(msg);
  try {
    window.location.assign(wa);
    return true;
  } catch (e) {
    console.error('No se pudo abrir WhatsApp:', e);
    return false;
  }
}

export function enviarWhatsAppOrdenRapido(ordenId) {
  const o = (state.ordenes || []).find(x => x.id === ordenId);
  if (!o) { showToast('Orden no encontrada'); return false; }
  const c = clienteDeOrden(o);
  if (!c) { showToast('Cliente no encontrado'); return false; }
  const tel = String(c.whatsapp || c.telefono || '').replace(/\D/g, '');
  if (!tel) { showToast('El cliente no tiene un número de WhatsApp válido'); return false; }

  const msg = 'Hola ' + (c.nombre || '') + ' 👟\n\n' + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
  const ok = abrirChatDirecto(tel, msg);
  if (!ok) showToast('No se pudo abrir WhatsApp');
  return ok;
}

window.enviarWhatsAppOrden = enviarWhatsAppOrdenRapido;
window.enviarWhatsAppOrdenRapido = enviarWhatsAppOrdenRapido;

document.addEventListener('click', (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('#forma-pago-whatsapp-btn') : null;
  if (!btn) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const id = idOrdenDesdeContexto(btn);
  if (!id) { showToast('No se pudo identificar la orden para WhatsApp'); return; }
  enviarWhatsAppOrdenRapido(id);
}, true);

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
}, true);

if (typeof window.openFormaPagoChooser === 'function' && !window.openFormaPagoChooser.__smWaTextOnly) {
  const originalChooser = window.openFormaPagoChooser;
  const wrapped = function(id, ...args) {
    window.__smFormaPagoOrdenId = id;
    const modal = document.getElementById('modal-forma-pago');
    if (modal) modal.dataset.ordenId = id || '';
    return originalChooser.call(this, id, ...args);
  };
  wrapped.__smWaTextOnly = true;
  window.openFormaPagoChooser = wrapped;
}

if (typeof window.guardarClienteOrden === 'function' && !window.guardarClienteOrden.__smWaTextOnly) {
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
        if (nueva) enviarWhatsAppOrdenRapido(nueva.id);
      }
      return r;
    } finally {
      if (chk) chk.checked = quiereWA;
    }
  };
  wrappedGuardar.__smWaTextOnly = true;
  window.guardarClienteOrden = wrappedGuardar;
}
