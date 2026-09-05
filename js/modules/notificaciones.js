/* ============================================================
   MÓDULO: NOTIFICACIONES
   Fase 2: Notificaciones calculadas automáticamente y almacenadas
   en la tabla notificaciones de Supabase.
   ============================================================ */
import { state, todayISO } from '../state.js';
import { clienteNombre, reproducirSonidoNotificacion } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';
import * as db from '../db.js';

/**
 * Calcula notificaciones automáticas basadas en el estado actual.
 * Tipos: 'd' (entrega), 'a' (atrasado), 's' (stock), 'p' (pago)
 */
export function computeNotifications() {
  const today = todayISO(0);
  const notifs = [];

  // Entregas hoy
  state.ordenes.filter(o => o.fechaEstimada === today && o.estado !== 'Entregado').forEach(o =>
    notifs.push({
      type: 'd',
      texto: 'Entrega hoy: orden #' + o.numero + ' de ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: o.prioridad === 'Alta' ? 'Alta' : 'Media'
    })
  );

  // Servicios atrasados
  state.ordenes.filter(o => o.fechaEstimada < today && o.estado !== 'Entregado').forEach(o =>
    notifs.push({
      type: 'a',
      texto: 'Servicio atrasado: orden #' + o.numero + ' de ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: 'Alta'
    })
  );

  // Stock bajo
  state.inventario.filter(i => Number(i.cantidad) <= Number(i.stockMinimo)).forEach(i =>
    notifs.push({
      type: 's',
      texto: 'Stock bajo: ' + i.nombre + ' (' + i.cantidad + ' unidades)',
      inventarioId: i.id,
      prioridad: 'Media'
    })
  );

  // Pagos pendientes
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

/**
 * Refresca SOLO la tabla notificaciones. Antes syncNotifications() llamaba
 * db.loadAllData(), lo que descargaba clientes, órdenes, inventario, gastos,
 * facturas, registro_pares, orden_items, etc. cada minuto.
 */
async function reloadNotificationsOnly() {
  const tenant = state.session?.tenantId;
  if (!supabase || !tenant) return;

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
}

let notifSyncRunning = false;

/**
 * Sincroniza las notificaciones calculadas con la base de datos.
 * Elimina notificaciones resueltas y crea nuevas.
 */
export async function syncNotifications() {
  if (notifSyncRunning || !state.session?.loggedIn) return;
  notifSyncRunning = true;

  try {
    // Primero refrescar únicamente notificaciones para evitar duplicados entre
    // dispositivos sin descargar el resto de las tablas del tenant.
    await reloadNotificationsOnly();

    const computed = computeNotifications();
    const computedTexts = computed.map(n => n.texto);

    if (!Array.isArray(state.notificaciones)) state.notificaciones = [];

    // Marcar como leídas las notificaciones que ya no aplican.
    const resolved = state.notificaciones.filter(n => !n.leida && !computedTexts.includes(n.texto));
    for (const n of resolved) {
      await db.markNotificationRead(n.id);
    }

    // Crear notificaciones nuevas que no existen en la DB.
    const existingTexts = state.notificaciones.map(n => n.texto);
    const nuevas = computed.filter(n => !existingTexts.includes(n.texto));

    for (const n of nuevas) {
      await db.createNotification({
        tipo: n.type,
        texto: n.texto,
        ordenId: n.ordenId || null,
        inventarioId: n.inventarioId || null,
        prioridad: n.prioridad,
        leida: false
      });
    }

    // No se usa loadAllData(): las funciones anteriores ya actualizan el
    // estado local y solo refrescamos esta tabla si hubo escrituras.
    if (resolved.length || nuevas.length) await reloadNotificationsOnly();
    updateBell();

  } catch (e) {
    console.error('Error al sincronizar notificaciones:', e);
  } finally {
    notifSyncRunning = false;
  }
}

export async function renderNotificaciones() {
  // Sincronizar notificaciones primero
  await syncNotifications();

  // Renderizar desde state.notificaciones (ya sincronizadas)
  const notifs = (state.notificaciones || []).filter(n => !n.leida);
  const esAdmin = state.session && state.session.role === 'Administrador';

  document.getElementById('notif-list').innerHTML = notifs.length ? notifs.map(n => {
    const icon = ({ d: '📦', a: '⚠', s: '▥', p: '$' }[n.tipo] || '🔔');
    const prioClass = n.prioridad === 'Alta' ? ' alta' : (n.prioridad === 'Baja' ? ' baja' : '');
    // El botón de eliminar solo se muestra al Administrador. Los demás solo visualizan.
    const btn = esAdmin ? '<button class="notif-dismiss" onclick="dismissNotification(\'' + n.id + '\')">×</button>' : '';
    return '<div class="notif-item' + prioClass + '">' +
      '<div class="notif-ic ' + n.tipo + '">' + icon + '</div>' +
      '<div class="notif-text">' + escHtml(n.texto) + '</div>' +
      btn +
    '</div>';
  }).join('') : '<div class="hint">No hay notificaciones pendientes.</div>';

  // Al abrir el panel se marcan como vistas y el contador rojo vuelve a cero
  // (las notificaciones NO se eliminan).
  marcarNotifsVistas();
  updateBell();
}

export async function dismissNotification(id) {
  // Solo el Administrador puede eliminar notificaciones.
  if (!(state.session && state.session.role === 'Administrador')) {
    if (window.showToast) window.showToast('Solo el Administrador puede eliminar notificaciones');
    return;
  }
  try {
    await db.markNotificationRead(id);
    await renderNotificaciones();
  } catch (e) {
    console.error('Error al descartar notificación:', e);
  }
}

/* ---- Contador rojo: solo sube con notificaciones nuevas y solo vuelve a
   cero cuando el usuario abre el panel (no disminuye automáticamente). ---- */
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
    // Alerta sonora: antes las notificaciones nuevas solo actualizaban el
    // contador de la campanita en silencio. Suena una vez por tanda nueva
    // (no una vez por notificación) para no saturar si llegan varias juntas.
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

/**
 * Auto-sync cada 60 segundos. Mantiene la frecuencia funcional existente,
 * pero ahora cada ciclo consulta únicamente notificaciones.
 */
let notifSyncInterval = null;

export function startNotificationSync() {
  if (notifSyncInterval) return;

  // Sync inmediato
  syncNotifications();

  // Sync cada 60 segundos
  notifSyncInterval = setInterval(() => {
    syncNotifications();
  }, 60000);
}

export function stopNotificationSync() {
  if (notifSyncInterval) {
    clearInterval(notifSyncInterval);
    notifSyncInterval = null;
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
