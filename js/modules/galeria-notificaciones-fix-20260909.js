/* Ajustes puntuales 2026-09-09.
   1) Galería: "Todos los pares" abre siempre la vista consolidada __ALL__.
   2) Notificaciones: "Notificaciones leídas" marca y oculta todas las pendientes.
   3) Producción: los servicios más recientes se muestran arriba.
   No toca pagos, permisos, contenido de fotos ni lógica financiera. */
import { state } from '../state.js';
import * as db from '../db.js';
import { showToast } from '../ui.js';

let ultimoGaleriaTodosAt = 0;

function activarGaleriaTodos() {
  const select = document.getElementById('galeria-orden-select');
  const search = document.getElementById('galeria-orden-search');
  const results = document.getElementById('galeria-orden-results');

  if (select) select.value = '__ALL__';
  if (search) search.value = '👟 Todos los pares';
  if (results) results.innerHTML = '';

  // El filtro por artículo no puede quedar activo al pedir la vista completa.
  if (typeof window.limpiarFiltroGaleriaItem === 'function') {
    try { window.limpiarFiltroGaleriaItem(); } catch (_) {}
  }
  if (select) select.value = '__ALL__';
  if (typeof window.renderGaleria === 'function') window.renderGaleria();
}

function manejarGaleriaTodos(ev) {
  const item = ev.target?.closest?.('.combo-item');
  if (!item) return;
  const inline = item.getAttribute('onmousedown') || item.getAttribute('onclick') || '';
  const texto = (item.textContent || '').trim();
  const esTodos = inline.includes("seleccionarGaleriaOrden('__ALL__')") ||
    inline.includes('mostrarTodosLosParesGaleria') ||
    /Ver fotos de (todas las órdenes|todos los pares)/i.test(texto);
  if (!esTodos) return;

  ev.preventDefault();
  ev.stopImmediatePropagation();

  const ahora = Date.now();
  if (ahora - ultimoGaleriaTodosAt < 250) return;
  ultimoGaleriaTodosAt = ahora;
  activarGaleriaTodos();
}

function instalarGaleriaTodos() {
  // Algunos resultados usan onmousedown y otros onclick. Capturamos ambos
  // para que "Todos los pares" no vuelva a quedar en una orden individual.
  document.addEventListener('mousedown', manejarGaleriaTodos, true);
  document.addEventListener('click', manejarGaleriaTodos, true);
}

async function limpiarTodasNotificaciones() {
  if (!(state.session && state.session.role === 'Administrador')) {
    showToast('Solo el Administrador puede marcar todas las notificaciones como leídas');
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
    if (typeof window.silenciarNotificacionesActuales === 'function') {
      window.silenciarNotificacionesActuales(pendientes);
    }
    for (const n of pendientes) {
      await db.markNotificationRead(n.id);
      n.leida = true;
    }
    localStorage.setItem('ses-notif-badge', '0');
    if (typeof window.renderNotificaciones === 'function') await window.renderNotificaciones();
    else if (typeof window.updateBell === 'function') window.updateBell();
    showToast('✅ Notificaciones marcadas como leídas');
  } catch (e) {
    console.error('Error marcando notificaciones como leídas:', e);
    showToast('No se pudieron marcar todas las notificaciones como leídas');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function instalarBotonNotificaciones() {
  const tab = document.getElementById('tab-notificaciones');
  if (!tab) return;
  if (!(state.session && state.session.role === 'Administrador')) return;

  let btn = document.getElementById('notif-clear-all-btn');
  if (!btn) {
    const head = tab.querySelector('.page-head');
    if (!head) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'notif-clear-all-btn';
    btn.className = 'btn btn-ghost';
    btn.onclick = limpiarTodasNotificaciones;
    head.appendChild(btn);
  }
  btn.textContent = '✅ Notificaciones leídas';
  btn.title = 'Marcar como leídas y ocultar todas las notificaciones mostradas';
}

function minutosHoraCard(card) {
  const texto = card?.textContent || '';
  const m = texto.match(/Hora:\s*(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function ordenarGridProduccion(scopeId) {
  const grid = document.querySelector('#' + scopeId + ' .prod-grid');
  if (!grid) return;
  const cards = Array.from(grid.children);
  if (cards.length < 2) return;

  const ordenadas = cards.map((el, idx) => ({ el, idx, hora: minutosHoraCard(el) }))
    .sort((a, b) => {
      if (a.hora == null && b.hora == null) return a.idx - b.idx;
      if (a.hora == null) return 1;
      if (b.hora == null) return -1;
      return b.hora - a.hora || a.idx - b.idx;
    })
    .map(x => x.el);

  if (ordenadas.every((el, idx) => el === cards[idx])) return;
  const frag = document.createDocumentFragment();
  ordenadas.forEach(el => frag.appendChild(el));
  grid.appendChild(frag);
}

let ordenarProduccionTimer = null;
function ordenarProduccionMasReciente() {
  clearTimeout(ordenarProduccionTimer);
  ordenarProduccionTimer = setTimeout(() => {
    ordenarGridProduccion('prod-lista');
    ordenarGridProduccion('prod-historial-lista');
  }, 0);
}

function instalarOrdenProduccion() {
  ordenarProduccionMasReciente();
  const tab = document.getElementById('tab-produccion') || document.body;
  const obs = new MutationObserver(() => ordenarProduccionMasReciente());
  obs.observe(tab, { childList: true, subtree: true });
}

function instalar() {
  instalarGaleriaTodos();
  instalarBotonNotificaciones();
  instalarOrdenProduccion();
  const obs = new MutationObserver(() => instalarBotonNotificaciones());
  obs.observe(document.body, { childList:true, subtree:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once:true });
else instalar();

Object.assign(window, {
  limpiarTodasNotificaciones,
  marcarTodasNotificacionesLeidas: limpiarTodasNotificaciones,
  activarGaleriaTodos
});
