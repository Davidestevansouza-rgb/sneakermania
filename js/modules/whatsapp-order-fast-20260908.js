/* WhatsApp de órdenes: mensaje limpio, sin URLs firmadas de R2. */
import { state } from '../state.js';
import { showToast } from '../ui.js';
import * as storageManager from '../storage-manager.js';
import { ordenQrText } from './ordenes.js';

const fotoFileCache = new Map();

function clienteDeOrden(o) {
  return (state.clientes || []).find(c => c.id === o.clienteId) || null;
}

function primeraFotoOrden(o) {
  const fotos = o && o.extra && Array.isArray(o.extra.fotos) ? o.extra.fotos : [];
  return fotos.find(f => f.categoria === 'todos_pares') || fotos.find(f => f.itemId || f.item) || fotos[0] || null;
}

function overlayWhatsApp(mostrar, texto = 'Preparando la información de la orden.') {
  let el = document.getElementById('sm-whatsapp-opening');
  if (!mostrar) { if (el) el.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'sm-whatsapp-opening';
  el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:24px;';
  el.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px 22px;max-width:330px;width:100%;text-align:center;font-family:Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)"><div style="font-size:30px;margin-bottom:8px">💬</div><strong>Abriendo WhatsApp…</strong><div style="font-size:13px;color:#666;margin-top:7px">' + texto + '</div></div>';
  document.body.appendChild(el);
}

async function archivoFotoOrden(o, ms = 4000) {
  if (!o) return null;
  if (fotoFileCache.has(o.id)) return fotoFileCache.get(o.id);
  const foto = primeraFotoOrden(o);
  if (!foto) return null;
  try {
    const url = await Promise.race([
      storageManager.resolveImageUrl(foto.url, foto.path),
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const resp = await Promise.race([
      fetch(url),
      new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
    if (!resp || !resp.ok) return null;
    const blob = await resp.blob();
    if (!blob || !blob.size) return null;
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const file = new File([blob], 'orden-' + (o.numero || 'foto') + '.' + ext, { type: blob.type || 'image/jpeg' });
    fotoFileCache.set(o.id, file);
    return file;
  } catch (_) { return null; }
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
  try { window.location.assign(wa); return true; }
  catch (e) { console.error('No se pudo abrir WhatsApp:', e); return false; }
}

export async function enviarWhatsAppOrdenRapido(ordenId) {
  const o = (state.ordenes || []).find(x => x.id === ordenId);
  if (!o) { showToast('Orden no encontrada'); return false; }
  const c = clienteDeOrden(o);
  if (!c) { showToast('Cliente no encontrado'); return false; }
  const tel = String(c.whatsapp || c.telefono || '').replace(/\D/g, '');
  if (!tel) { showToast('El cliente no tiene un número de WhatsApp válido'); return false; }

  const msg = 'Hola ' + (c.nombre || '') + ' 👟\n\n' + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
  const tieneFoto = !!primeraFotoOrden(o);
  overlayWhatsApp(true, tieneFoto ? 'Preparando la foto real, sin enlaces ni códigos.' : 'Preparando el mensaje.');

  if (tieneFoto) {
    const file = await archivoFotoOrden(o, 4000);
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      overlayWhatsApp(false);
      try {
        await navigator.share({ files: [file], text: msg, title: 'Orden #' + o.numero });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        console.warn('No se pudo compartir la foto; abriendo chat directo:', e);
      }
    }
  }

  // En WhatsApp Web/PC no existe una API web para adjuntar automáticamente
  // un archivo a un número concreto. Se abre el chat directo con texto limpio;
  // nunca se inserta la URL firmada de R2 en el mensaje.
  const ok = abrirChatDirecto(tel, msg);
  if (!ok) {
    overlayWhatsApp(false);
    showToast('No se pudo abrir WhatsApp');
    return false;
  }
  return true;
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
  void enviarWhatsAppOrdenRapido(id);
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
  const o = (state.ordenes || []).find(x => x.id === id);
  if (o && primeraFotoOrden(o)) void archivoFotoOrden(o, 5000);
}, true);

if (typeof window.openFormaPagoChooser === 'function' && !window.openFormaPagoChooser.__smWaClean) {
  const originalChooser = window.openFormaPagoChooser;
  const wrapped = function(id, ...args) {
    window.__smFormaPagoOrdenId = id;
    const modal = document.getElementById('modal-forma-pago');
    if (modal) modal.dataset.ordenId = id || '';
    const o = (state.ordenes || []).find(x => x.id === id);
    if (o && primeraFotoOrden(o)) void archivoFotoOrden(o, 5000);
    return originalChooser.call(this, id, ...args);
  };
  wrapped.__smWaClean = true;
  window.openFormaPagoChooser = wrapped;
}

if (typeof window.guardarClienteOrden === 'function' && !window.guardarClienteOrden.__smWaClean) {
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
    } finally { if (chk) chk.checked = quiereWA; }
  };
  wrappedGuardar.__smWaClean = true;
  window.guardarClienteOrden = wrappedGuardar;
}
