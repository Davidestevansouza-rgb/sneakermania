/* ============================================================
   ESTADO Y PERSISTENCIA — Sistema SeS
   ============================================================
   Mantiene el estado en memoria (misma forma que la versión
   original) y lo respalda en localStorage como caché offline.
   La sincronización real con Supabase la realiza db.js; aquí solo
   se gestiona la caché local y la cola de escrituras pendientes.
   ============================================================ */
import { STORAGE_KEY, QUEUE_KEY } from './config.js';

export function seedData() {
  return {
    clientes: [], clientesEliminados: [], ordenes: [], ordenesEliminadas: [],
    inventario: [], gastos: [], registroPares: [], ordenItems: [], facturas: [],
    agenda: [], notificaciones: [], activityLog: [], nextOrderNum: 1,
    nextInvoiceNum: 2001, notifSeenTexts: [], config: {},
    session: { loggedIn: false, role: null, user: null }
  };
}

// Estado seguro desde el primer import. app.js lo reemplaza después por
// la caché real o por un seed nuevo. Evita que módulos laterales lean null
// durante la pantalla de login antes de que termine la inicialización.
export let state = seedData();

export function setState(next) { state = next; }
export function tenantId() { return state && state.session ? state.session.tenantId || null : null; }
export function userId() { return state && state.session ? state.session.userId || null : null; }

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function setDateValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  el.value = ok ? value : '';
}

export function saveCache() {
  try {
    // Caché local mínima: Supabase sigue siendo la fuente de verdad.
    // No duplicamos clientes, órdenes, artículos, producción ni URLs/fotos
    // en localStorage; eso era lo que agotaba la cuota del navegador.
    const cache = {
      session: state.session || { loggedIn:false, role:null, user:null },
      config: state.config || {},
      notificaciones: (state.notificaciones || []).filter(n => !n.leida).slice(0, 50),
      activityLog: (state.activityLog || []).slice(0, 30),
      notifSeenTexts: (state.notifSeenTexts || []).slice(-100)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    return true;
  } catch (e) {
    console.error('Error guardando caché local mínima', e);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    return false;
  }
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    // Sanea únicamente residuos históricos de notificaciones para que una
    // caché antigua enorme no vuelva a agotar localStorage al iniciar.
    if (cached && typeof cached === 'object') {
      if (Array.isArray(cached.notificaciones) && cached.notificaciones.length > 100) {
        cached.notificaciones = cached.notificaciones.slice(-100);
      }
      if (Array.isArray(cached.notifSeenTexts) && cached.notifSeenTexts.length > 200) {
        cached.notifSeenTexts = cached.notifSeenTexts.slice(-200);
      }
      try {
        const known = JSON.parse(localStorage.getItem('ses-notif-known') || '[]');
        if (Array.isArray(known) && known.length > 500) {
          localStorage.setItem('ses-notif-known', JSON.stringify(known.slice(-500)));
        }
      } catch (_) {}
    }
    return cached;
  }
  catch (e) { console.error('Error leyendo caché local', e); }
  return null;
}

export async function persist() {
  const ok = saveCache();
  if (!ok) {
    try {
      const { showToast } = await import('./ui.js');
      showToast('No se pudo guardar en este dispositivo (memoria llena o modo privado).');
    } catch (_) {}
  }
}

export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch (e) { return []; }
}

export function enqueue(op) {
  const q = getQueue();
  q.push({ ...op, ts: Date.now() });
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  catch (e) { console.error('No se pudo encolar la operación offline', e); }
}

export function setQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  catch (e) { console.error('No se pudo actualizar la cola offline', e); }
}

export function clearQueue() {
  try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
}

/* ------------------------------------------------------------
   Roles y permisos
   ------------------------------------------------------------ */
function normalizarRol(valor) {
  const r = String(valor || '').trim().toLowerCase();
  if (r === 'administrador' || r === 'admin') return 'Administrador';
  if (r === 'supervisor') return 'Supervisor';
  if (r === 'empleado') return 'Empleado';
  return valor ? String(valor).trim() : null;
}

/** Rol actual normalizado para evitar fallos por espacios o mayúsculas. */
export function rolActual() {
  return normalizarRol(state && state.session ? state.session.role : null);
}

export function esAdmin() { return rolActual() === 'Administrador'; }
export function esSupervisor() { return rolActual() === 'Supervisor'; }
export function esEmpleado() { return rolActual() === 'Empleado'; }

export const TABS_POR_ROL = {
  Administrador: null,
  Supervisor: ['dashboard', 'clientes', 'ordenes', 'consulta', 'ia', 'galeria', 'produccion', 'biblioteca', 'facturas', 'inventario', 'agenda', 'notificaciones'],
  Empleado: ['produccion', 'galeria', 'agenda', 'inventario']
};

export function puedeVerTab(tab) {
  const rol = rolActual();
  if (rol === 'Administrador') return true;
  const permitidas = TABS_POR_ROL[rol];
  if (!Array.isArray(permitidas)) return false;
  return permitidas.includes(tab);
}

export function tabInicial() { return esEmpleado() ? 'produccion' : 'dashboard'; }

/** Administrador y Supervisor pueden crear/editar órdenes. */
export function puedeEditarOrdenes() { return esAdmin() || esSupervisor(); }

export function ensurePagoFields(o) {
  if (o.pagadoQR === undefined) o.pagadoQR = 0;
  if (o.pagadoEfectivo === undefined) o.pagadoEfectivo = 0;
  return o;
}
