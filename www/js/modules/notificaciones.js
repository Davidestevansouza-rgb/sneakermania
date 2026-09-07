/* ============================================================
   MÓDULO: NOTIFICACIONES
   Optimizado para reducir consultas y no golpear Supabase sin conexión.
   ============================================================ */
import { state, todayISO } from '../state.js';
import { clienteNombre, reproducirSonidoNotificacion } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';
import * as db from '../db.js';

const NOTIF_SYNC_MS = 5 * 60 * 1000; // 5 min; antes 60 s

function onlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function computeNotifications() {
  const today = todayISO(0);
  const notifs = [];

  state.ordenes.filter(o => o.fechaEstimada === today && o.estado !== 'Entregado').forEach(o =>
    notifs.push({
      type: 'd',
      texto: 'Entrega hoy: orden #' + o.numero + ' de ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: o.prioridad === 'Alta' ? 'Alta' : 'Media'
    })
  );

  state.ordenes.filter(o => o.fechaEstimada < today && o.estado !== 'Entregado').forEach(o =>
    notifs.push({
      type: 'a',
      texto: 'Servicio atrasado: orden #' + o.numero + ' de ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: 'Alta'
    })
  );

  state.inventario.filter(i => Number(i.cantidad) <= Number(i.stockMinimo)).forEach(i =>
    notifs.push({
      type: 's',
      texto: 'Stock bajo: ' + i.nombre + ' (' + i.cantidad + ' unidades)',
      inventarioId: i.id,
      prioridad: 'Media'
    })
  );

  state.ordenes.filter(o => o.estadoPago === 'Pendiente' || o.estadoPago === 'Parcial').forEach(o =>
    notifs.push({
      type: 'p',
      texto: 'Pago pendiente: orden #' + o.numero + ' — ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: 'Baja'
    })
  );

  return notifs;
}

async function reloadNotificationsOnly() {
  const tenant = state.session?.tenantId;
  if (!supabase || !tenant || !onlineNow()) return false;

  const { data, error } = await supabase
    .from('notificaciones')
    .select('id,tipo,texto,leida,prioridad,orden_id,inventario_id,created_at')
    .eq('tenant_id', tenant)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  state.notificaciones = (data || []).map(n => ({
    id: n.id,
    tipo: n.tipo,
    texto: n.texto,
    leida: !!n.leida,
    prioridad: n.prioridad || 'Media',
    ordenId: n.orden_id || null,
    inventarioId: n.inventario_id || null,
    fecha: n.created_at
  }));
  return true;
}

let notifSyncRunning = false;

export async function syncNotifications() {
  if (notifSyncRunning || !state.session?.loggedIn || !onlineNow()) return;
  notifSyncRunning = true;

  try {
    await reloadNotificationsOnly();

    const computed = computeNotifications();
    const computedTexts = computed.map(n => n.texto);
    if (!Array.isArray(state.notificaciones)) state.notificaciones = [];

    const resolved = state.notificaciones.filter(n => !n.leida && !computedTexts.includes(n.texto));
    for (const n of resolved) {
      if (!onlineNow()) break;
      await db.markNotificationRead(n.id);
    }

    const existingTexts = state.notificaciones.map(n => n.texto);
    const nuevas = computed.filter(n => !existingTexts.includes(n.texto));
    for (const n of nuevas) {
      if (!onlineNow()) break;
      await db.createNotification({
        tipo: n.type,
        texto: n.texto,
        ordenId: n.ordenId || null,
        inventarioId: n.inventarioId || null,
        prioridad: n.prioridad,
        leida: false
      });
    }

    updateBell();
  } catch (e) {
    if (onlineNow()) console.error('Error al sincronizar notificaciones:', e);
  } finally {
    notifSyncRunning = false;
  }
}

export async function renderNotificaciones() {
  if (onlineNow()) await syncNotifications();

  const notifs = (state.notificaciones || []).filter(n => !n.leida);
  const esAdmin = state.session && state.session.role === 'Administrador';
  const list = document.getElementById('notif-list');
  if (!list) return;

  list.innerHTML = notifs.length ? notifs.map(n => {
    const icon = ({ d: '📦', a: '⚠', s: '▥', p: '$' }[n.tipo] || '🔔');
    const prioClass = n.prioridad === 'Alta' ? ' alta' : (n.prioridad === 'Baja' ? ' baja' : '');
    const btn = esAdmin ? '<button class="notif-dismiss" onclick="dismissNotification(\'' + n.id + '\')">×</button>' : '';
    return '<div class="notif-item' + prioClass + '">' +
      '<div class="notif-ic ' + n.tipo + '">' + icon + '</div>' +
      '<div class="notif-text">' + escHtml(n.texto) + '</div>' + btn + '</div>';
  }).join('') : '<div class="hint">No hay notificaciones pendientes.</div>';

  marcarNotifsVistas();
  updateBell();
}

export async function dismissNotification(id) {
  if (!(state.session && state.session.role === 'Administrador')) {
    if (window.showToast) window.showToast('Solo el Administrador puede eliminar notificaciones');
    return;
  }
  if (!onlineNow()) {
    if (window.showToast) window.showToast('Sin conexión. Intenta nuevamente cuando vuelva internet.');
    return;
  }
  try {
    await db.markNotificationRead(id);
    await renderNotificaciones();
  } catch (e) {
    console.error('Error al descartar notificación:', e);
  }
}

const NOTIF_KNOWN_KEY = 'ses-notif-known';
const NOTIF_BADGE_KEY = 'ses-notif-badge';

function registrarNuevas() {
  let known;
  try { known = JSON.parse(localStorage.getItem(NOTIF_KNOWN_KEY) || '[]'); } catch (e) { known = []; }
  const knownSet = new Set(known);
  let badge = Number(localStorage.getItem(NOTIF_BADGE_KEY) || '0') || 0;
  const activas = (state.notificaciones || []).filter(n => !n.leida);
  let nuevas = 0;
  activas.forEach(n => { if (!knownSet.has(n.id)) { knownSet.add(n.id); nuevas++; } });
  if (nuevas > 0) {
    badge += nuevas;
    localStorage.setItem(NOTIF_BADGE_KEY, String(badge));
    reproducirSonidoNotificacion();
  }
  localStorage.setItem(NOTIF_KNOWN_KEY, JSON.stringify([...knownSet]));
  return badge;
}

export function marcarNotifsVistas() {
  localStorage.setItem(NOTIF_BADGE_KEY, '0');
  updateBell();
}

export function updateBell() {
  const count = registrarNuevas();
  const el = document.getElementById('bell-count');
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'flex' : 'none';
}

let notifSyncInterval = null;
let onlineHandlerInstalled = false;

function onBackOnline() {
  if (state.session?.loggedIn) syncNotifications();
}

export function startNotificationSync() {
  if (!onlineHandlerInstalled && typeof window !== 'undefined') {
    window.addEventListener('online', onBackOnline);
    onlineHandlerInstalled = true;
  }
  if (notifSyncInterval) return;

  if (onlineNow()) syncNotifications();
  notifSyncInterval = setInterval(() => {
    if (onlineNow() && document.visibilityState !== 'hidden') syncNotifications();
  }, NOTIF_SYNC_MS);
}

export function stopNotificationSync() {
  if (notifSyncInterval) {
    clearInterval(notifSyncInterval);
    notifSyncInterval = null;
  }
  if (onlineHandlerInstalled && typeof window !== 'undefined') {
    window.removeEventListener('online', onBackOnline);
    onlineHandlerInstalled = false;
  }
  notifSyncRunning = false;
}

Object.assign(window, {
  computeNotifications,
  renderNotificaciones,
  updateBell,
  marcarNotifsVistas,
  dismissNotification,
  startNotificationSync,
  stopNotificationSync
});
