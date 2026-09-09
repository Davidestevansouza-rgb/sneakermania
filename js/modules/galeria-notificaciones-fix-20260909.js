/* Ajustes puntuales 2026-09-09.
   1) Galería: la opción existente "Ver fotos de todas las órdenes" vuelve a abrir __ALL__.
   2) Notificaciones: botón para limpiar todas las pendientes de una vez.
   No toca R2, fotos, pagos, permisos ni lógica de órdenes. */
import { state } from '../state.js';
import * as db from '../db.js';
import { showToast } from '../ui.js';

function instalarGaleriaTodos() {
  document.addEventListener('click', (ev) => {
    const item = ev.target?.closest?.('.combo-item');
    if (!item) return;
    const inline = item.getAttribute('onmousedown') || item.getAttribute('onclick') || '';
    const texto = (item.textContent || '').trim();
    const esTodos = inline.includes("seleccionarGaleriaOrden('__ALL__')") || /Ver fotos de todas las órdenes/i.test(texto);
    if (!esTodos) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    if (typeof window.seleccionarGaleriaOrden === 'function') {
      window.seleccionarGaleriaOrden('__ALL__');
      return;
    }

    const select = document.getElementById('galeria-orden-select');
    const search = document.getElementById('galeria-orden-search');
    if (select) select.value = '__ALL__';
    if (search) search.value = '👟 Todas las órdenes';
    if (typeof window.renderGaleria === 'function') window.renderGaleria();
  }, true);
}

async function limpiarTodasNotificaciones() {
  if (!(state.session && state.session.role === 'Administrador')) {
    showToast('Solo el Administrador puede limpiar notificaciones');
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showToast('Sin conexión. Intenta nuevamente cuando vuelva internet.');
    return;
  }

  const pendientes = (state.notificaciones || []).filter(n => n && !n.leida && n.id);
  if (!pendientes.length) {
    showToast('No hay notificaciones pendientes');
    return;
  }

  const btn = document.getElementById('notif-clear-all-btn');
  if (btn) btn.disabled = true;
  try {
    for (const n of pendientes) {
      await db.markNotificationRead(n.id);
      n.leida = true;
    }
    localStorage.setItem('ses-notif-badge', '0');
    if (typeof window.renderNotificaciones === 'function') await window.renderNotificaciones();
    else if (typeof window.updateBell === 'function') window.updateBell();
    showToast('✅ Notificaciones limpiadas');
  } catch (e) {
    console.error('Error limpiando notificaciones:', e);
    showToast('No se pudieron limpiar todas las notificaciones');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function instalarBotonNotificaciones() {
  const tab = document.getElementById('tab-notificaciones');
  if (!tab || document.getElementById('notif-clear-all-btn')) return;
  if (!(state.session && state.session.role === 'Administrador')) return;

  const head = tab.querySelector('.page-head');
  if (!head) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'notif-clear-all-btn';
  btn.className = 'btn btn-ghost';
  btn.textContent = '🧹 Limpiar todas';
  btn.onclick = limpiarTodasNotificaciones;
  head.appendChild(btn);
}

function instalar() {
  instalarGaleriaTodos();
  instalarBotonNotificaciones();
  const obs = new MutationObserver(() => instalarBotonNotificaciones());
  obs.observe(document.body, { childList:true, subtree:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once:true });
else instalar();

Object.assign(window, { limpiarTodasNotificaciones });
