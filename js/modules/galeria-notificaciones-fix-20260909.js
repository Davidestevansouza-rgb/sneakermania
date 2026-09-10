/* Ajustes puntuales 2026-09-09.
   1) Galería: "Todos los pares" abre siempre la vista consolidada existente.
   2) Notificaciones: botón "Notificaciones leídas" marca y oculta las pendientes.
   3) Producción: orden visual más reciente arriba, instalado solo al abrir Producción.
   No toca pagos, permisos, fotos, R2 ni lógica financiera. */
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

async function marcarTodasNotificacionesLeidas() {
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
  if (!tab || !(state.session && state.session.role === 'Administrador')) return;
  let btn = document.getElementById('notif-clear-all-btn');
  if (!btn) {
    const head = tab.querySelector('.page-head');
    if (!head) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'notif-clear-all-btn';
    btn.className = 'btn btn-ghost';
    head.appendChild(btn);
  }
  btn.textContent = '✅ Notificaciones leídas';
  btn.title = 'Marcar como leídas y ocultar todas las notificaciones mostradas';
  btn.onclick = marcarTodasNotificacionesLeidas;
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

let prodObserver = null;
function activarOrdenProduccion() {
  const lista = document.getElementById('prod-lista');
  const historial = document.getElementById('prod-historial-lista');
  const ordenar = () => {
    ordenarGridProduccion('prod-lista');
    ordenarGridProduccion('prod-historial-lista');
  };
  setTimeout(ordenar, 0);
  setTimeout(ordenar, 150);
  if (prodObserver || (!lista && !historial)) return;
  prodObserver = new MutationObserver(() => {
    clearTimeout(prodObserver.__t);
    prodObserver.__t = setTimeout(ordenar, 0);
  });
  if (lista) prodObserver.observe(lista, { childList:true, subtree:true });
  if (historial) prodObserver.observe(historial, { childList:true, subtree:true });
}

function instalar() {
  document.addEventListener('mousedown', manejarGaleriaTodos, true);
  document.addEventListener('click', manejarGaleriaTodos, true);
  document.addEventListener('click', ev => {
    const tab = ev.target?.closest?.('[data-tab]')?.dataset?.tab;
    if (tab === 'notificaciones') setTimeout(instalarBotonNotificaciones, 0);
    if (tab === 'produccion') setTimeout(activarOrdenProduccion, 0);
  });
  setTimeout(instalarBotonNotificaciones, 0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once:true });
else instalar();

Object.assign(window, {
  limpiarTodasNotificaciones: marcarTodasNotificacionesLeidas,
  marcarTodasNotificacionesLeidas,
  activarGaleriaTodos
});
