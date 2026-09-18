/* ============================================================
   MÓDULO: NOTIFICACIONES
   Optimizado para reducir consultas y no golpear Supabase sin conexión.
   ============================================================ */
import { state, todayISO } from '../state.js';
import { clienteNombre, reproducirSonidoNotificacion } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';
import * as db from '../db.js';

const NOTIF_SYNC_MS = 5 * 60 * 1000;

function onlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function notifLogicalKey(n) {
  const tipo = n?.type || n?.tipo || '';
  const ordenId = n?.ordenId || n?.orden_id || '';
  const inventarioId = n?.inventarioId || n?.inventario_id || '';
  if (tipo || ordenId || inventarioId) return [tipo, ordenId, inventarioId].join('|');
  return 'texto|' + String(n?.texto || '');
}

function dismissedStorageKey() {
  return 'ses-notif-dismissed:' + (state?.session?.tenantId || 'local');
}

function getDismissedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(dismissedStorageKey()) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (_) { return new Set(); }
}

function saveDismissedSet(set) {
  try { localStorage.setItem(dismissedStorageKey(), JSON.stringify([...set])); } catch (_) {}
}

export function silenciarNotificacionesActuales(lista = null) {
  const set = getDismissedSet();
  const fuentes = Array.isArray(lista) ? lista : computeNotifications();
  fuentes.forEach(n => set.add(notifLogicalKey(n)));
  saveDismissedSet(set);
}

function depurarSilenciadas(computed) {
  const activas = new Set((computed || []).map(notifLogicalKey));
  const set = getDismissedSet();
  let cambio = false;
  [...set].forEach(k => { if (!activas.has(k)) { set.delete(k); cambio = true; } });
  if (cambio) saveDismissedSet(set);
  return set;
}

export function computeNotifications() {
  const today = todayISO(0);
  const ordenes = Array.isArray(state?.ordenes)
    ? state.ordenes.filter(o => o && o.eliminada !== true)
    : [];

  // Regla definitiva: solo se generan alertas automáticas por atraso.
  // La fecha estimada forma parte de la clave para permitir una nueva alerta
  // si la orden es reprogramada y posteriormente vuelve a atrasarse.
  return ordenes
    .filter(o => o.fechaEstimada && o.fechaEstimada < today && o.estado !== 'Entregado')
    .map(o => ({
      type: 'a',
      texto: 'Servicio atrasado: orden #' + o.numero + ' de ' + clienteNombre(o.clienteId),
      ordenId: o.id,
      prioridad: 'Alta',
      dedupeKey: ['a', o.id, o.fechaEstimada].join('|')
    }));
}

async function reloadNotificationsOnly() {
  const tenant = state.session?.tenantId;
  if (!supabase || !tenant || !onlineNow()) return false;
  const { data, error } = await supabase.from('notificaciones')
    .select('id,tipo,texto,leida,prioridad,orden_id,inventario_id,dedupe_key,created_at')
    .eq('tenant_id', tenant)
    .eq('leida', false)
    .order('created_at', { ascending:false })
    .limit(500);
  if (error) throw error;
  state.notificaciones = (data || []).map(n => ({ id:n.id, tipo:n.tipo, texto:n.texto, leida:!!n.leida, prioridad:n.prioridad || 'Media', ordenId:n.orden_id || null, inventarioId:n.inventario_id || null, dedupeKey:n.dedupe_key || null, fecha:n.created_at }));
  return true;
}

async function idsOrdenesValidas(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Set();
  try {
    const { data, error } = await supabase.from('ordenes').select('id').in('id', unique);
    if (error) throw error;
    return new Set((data || []).map(r => r.id));
  } catch (e) { console.warn('No se pudo validar órdenes para notificaciones:', e); return new Set(); }
}

let notifSyncRunning = false;

async function existingDedupeKeys(keys) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  const found = new Set();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await supabase
      .from('notificaciones')
      .select('dedupe_key')
      .eq('tenant_id', state.session?.tenantId)
      .in('dedupe_key', chunk);
    if (error) throw error;
    (data || []).forEach(r => { if (r.dedupe_key) found.add(r.dedupe_key); });
  }
  return found;
}

export async function syncNotifications() {
  if (notifSyncRunning || !state.session?.loggedIn || !onlineNow()) return;
  notifSyncRunning = true;
  try {
    // Regla simple y definitiva:
    // 1) un atraso tiene una sola dedupe_key;
    // 2) si esa clave existió alguna vez, aunque esté leída, NO se recrea;
    // 3) la UI solo carga filas leida=false del servidor.
    const computed = computeNotifications();
    const keysExistentes = await existingDedupeKeys(computed.map(n => n.dedupeKey));
    const nuevas = computed.filter(n => !keysExistentes.has(n.dedupeKey));
    const validOrderIds = await idsOrdenesValidas(nuevas.map(n => n.ordenId));
    for (const n of nuevas) {
      if (!onlineNow()) break;
      if (n.ordenId && !validOrderIds.has(n.ordenId)) continue;
      await db.createNotification({
        tipo:n.type, texto:n.texto, ordenId:n.ordenId || null,
        inventarioId:n.inventarioId || null, prioridad:n.prioridad,
        dedupeKey:n.dedupeKey, leida:false
      });
    }
    await reloadNotificationsOnly();
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
    const icon = ({ d:'📦', a:'⚠', s:'▥', p:'$' }[n.tipo] || '🔔');
    const prioClass = n.prioridad === 'Alta' ? ' alta' : (n.prioridad === 'Baja' ? ' baja' : '');
    const btn = esAdmin ? '<button class="notif-dismiss" onclick="dismissNotification(\'' + n.id + '\')">×</button>' : '';
    return '<div class="notif-item' + prioClass + '"><div class="notif-ic ' + n.tipo + '">' + icon + '</div><div class="notif-text">' + escHtml(n.texto) + '</div>' + btn + '</div>';
  }).join('') : '<div class="hint">No hay notificaciones pendientes.</div>';
  marcarNotifsVistas();
}

export async function dismissNotification(id) {
  if (!(state.session && state.session.role === 'Administrador')) { if (window.showToast) window.showToast('Solo el Administrador puede eliminar notificaciones'); return; }
  if (!onlineNow()) { if (window.showToast) window.showToast('Sin conexión. Intenta nuevamente cuando vuelva internet.'); return; }
  try {
    const actual = (state.notificaciones || []).find(n => n.id === id);
    if (actual) silenciarNotificacionesActuales([actual]);
    await db.markNotificationRead(id);
    await renderNotificaciones();
  } catch (e) { console.error('Error al descartar notificación:', e); }
}

const NOTIF_KNOWN_KEY='ses-notif-known';
const NOTIF_BADGE_KEY='ses-notif-badge';
const NOTIF_KNOWN_MAX=500;
function registrarNuevas() {
  let known; try { known = JSON.parse(localStorage.getItem(NOTIF_KNOWN_KEY) || '[]'); } catch (e) { known = []; }
  const knownSet = new Set(known);
  let badge = Number(localStorage.getItem(NOTIF_BADGE_KEY) || '0') || 0;
  const activas = (state.notificaciones || []).filter(n => !n.leida);
  let nuevas=0;
  activas.forEach(n => { if (!knownSet.has(n.id)) { knownSet.add(n.id); nuevas++; } });
  if (nuevas > 0) { badge += nuevas; localStorage.setItem(NOTIF_BADGE_KEY, String(badge)); reproducirSonidoNotificacion(); }
  // Evita que años de IDs vistos vuelvan a llenar localStorage.
  const compactKnown = [...knownSet].slice(-NOTIF_KNOWN_MAX);
  localStorage.setItem(NOTIF_KNOWN_KEY, JSON.stringify(compactKnown));
  return badge;
}
export function marcarNotifsVistas(){
  let known; try { known = JSON.parse(localStorage.getItem(NOTIF_KNOWN_KEY) || '[]'); } catch (e) { known = []; }
  const knownSet = new Set(known);
  (state.notificaciones || []).filter(n => !n.leida).forEach(n => { if (n.id) knownSet.add(n.id); });
  const compactKnown = [...knownSet].slice(-NOTIF_KNOWN_MAX);
  localStorage.setItem(NOTIF_KNOWN_KEY, JSON.stringify(compactKnown));
  localStorage.setItem(NOTIF_BADGE_KEY,'0');
  const el=document.getElementById('bell-count');
  if(el){el.textContent='0';el.style.display='none';}
}
export function updateBell(){const count=registrarNuevas();const el=document.getElementById('bell-count');if(!el)return;el.textContent=count;el.style.display=count>0?'flex':'none';}

let notifSyncInterval=null;
let onlineHandlerInstalled=false;
function onBackOnline(){if(state.session?.loggedIn)syncNotifications();}
export function startNotificationSync(){
  if(!onlineHandlerInstalled&&typeof window!=='undefined'){window.addEventListener('online',onBackOnline);onlineHandlerInstalled=true;}
  if(notifSyncInterval)return;
  if(onlineNow())syncNotifications();
  notifSyncInterval=setInterval(()=>{if(onlineNow()&&document.visibilityState!=='hidden')syncNotifications();},NOTIF_SYNC_MS);
}
export function stopNotificationSync(){
  if(notifSyncInterval){clearInterval(notifSyncInterval);notifSyncInterval=null;}
  if(onlineHandlerInstalled&&typeof window!=='undefined'){window.removeEventListener('online',onBackOnline);onlineHandlerInstalled=false;}
  notifSyncRunning=false;
}
Object.assign(window,{computeNotifications,renderNotificaciones,updateBell,marcarNotifsVistas,dismissNotification,startNotificationSync,stopNotificationSync,silenciarNotificacionesActuales});
