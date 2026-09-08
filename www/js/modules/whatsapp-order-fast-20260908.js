/* WhatsApp de órdenes: respuesta inmediata y sin descarga previa de la foto. */
import { state } from '../state.js';
import { showToast } from '../ui.js';
import * as storageManager from '../storage-manager.js';
import { ordenQrText } from './ordenes.js';

function clienteDeOrden(o) {
  return (state.clientes || []).find(c => c.id === o.clienteId) || null;
}

function primeraFotoOrden(o) {
  const fotos = o && o.extra && Array.isArray(o.extra.fotos) ? o.extra.fotos : [];
  return fotos.find(f => f.categoria === 'todos_pares') || fotos.find(f => f.itemId || f.item) || fotos[0] || null;
}

async function urlFotoConTimeout(foto, ms = 3500) {
  if (!foto) return null;
  if (foto.url && /^https?:\/\//i.test(foto.url)) return foto.url;
  try {
    return await Promise.race([
      storageManager.resolveImageUrl(foto.url, foto.path),
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
  } catch (_) { return null; }
}

export function enviarWhatsAppOrdenRapido(ordenId) {
  const o = (state.ordenes || []).find(x => x.id === ordenId);
  if (!o) { showToast('Orden no encontrada'); return false; }
  const c = clienteDeOrden(o);
  if (!c) { showToast('Cliente no encontrado'); return false; }
  const tel = String(c.whatsapp || c.telefono || '').replace(/\D/g, '');
  if (!tel) { showToast('El cliente no tiene un número de WhatsApp válido'); return false; }

  const baseMsg = 'Hola ' + (c.nombre || '') + ' 👟\n\n' + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
  const popup = window.open('about:blank', '_blank');
  if (!popup) {
    showToast('El navegador bloqueó WhatsApp. Habilita ventanas emergentes para SneakerMania.');
    return false;
  }
  try {
    popup.document.write('<!doctype html><title>WhatsApp</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;padding:24px">Abriendo WhatsApp…</body>');
  } catch (_) {}

  const foto = primeraFotoOrden(o);
  void (async () => {
    const fotoUrl = await urlFotoConTimeout(foto);
    const msg = baseMsg + (fotoUrl && /^https?:\/\//i.test(fotoUrl) ? '\n\n📷 Foto del artículo:\n' + fotoUrl : '');
    const wa = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg);
    try { popup.location.replace(wa); }
    catch (_) { popup.location.href = wa; }
  })();

  showToast(foto ? 'Abriendo WhatsApp con la información y la foto…' : 'Abriendo WhatsApp…');
  return true;
}

window.enviarWhatsAppOrden = enviarWhatsAppOrdenRapido;
window.enviarWhatsAppOrdenRapido = enviarWhatsAppOrdenRapido;

document.addEventListener('click', (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('#forma-pago-whatsapp-btn') : null;
  if (!btn) return;
  const modal = btn.closest('#modal-forma-pago');
  if (!modal) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const id = modal.dataset.ordenId || btn.dataset.ordenId || window.__smFormaPagoOrdenId;
  if (id) enviarWhatsAppOrdenRapido(id);
}, true);

if (typeof window.openFormaPagoChooser === 'function' && !window.openFormaPagoChooser.__smWaFast) {
  const originalChooser = window.openFormaPagoChooser;
  const wrapped = function(id, ...args) {
    window.__smFormaPagoOrdenId = id;
    const modal = document.getElementById('modal-forma-pago');
    if (modal) modal.dataset.ordenId = id || '';
    return originalChooser.call(this, id, ...args);
  };
  wrapped.__smWaFast = true;
  window.openFormaPagoChooser = wrapped;
}

if (typeof window.guardarClienteOrden === 'function' && !window.guardarClienteOrden.__smWaFast) {
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
  wrappedGuardar.__smWaFast = true;
  window.guardarClienteOrden = wrappedGuardar;
}
