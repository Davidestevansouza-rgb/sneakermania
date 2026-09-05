/* ============================================================
   ESTADO Y PERSISTENCIA — Sistema SeS
   ============================================================
   Mantiene el estado en memoria (misma forma que la versión
   original) y lo respalda en localStorage como caché offline.
   La sincronización real con Supabase la realiza db.js; aquí solo
   se gestiona la caché local y la cola de escrituras pendientes.
   ============================================================ */
import { STORAGE_KEY, QUEUE_KEY } from './config.js';

/**
 * Estado global de la aplicación (binding vivo: los módulos que lo
 * importan ven las reasignaciones que ocurren aquí).
 */
export let state = null;

/** Estructura inicial vacía. */
export function seedData() {
  return {
    clientes: [],
    clientesEliminados: [],
    ordenes: [],
    ordenesEliminadas: [],
    inventario: [],
    gastos: [],
    registroPares: [],
    ordenItems: [],
    facturas: [],
    agenda: [],
    notificaciones: [],
    activityLog: [],
    nextOrderNum: 1,
    nextInvoiceNum: 2001,
    notifSeenTexts: [],
    config: {},
    session: { loggedIn: false, role: null, user: null }
  };
}

/** Reemplaza por completo el estado en memoria. */
export function setState(next) {
  state = next;
}

/** Tenant activo de la sesión actual (o null si no hay sesión). */
export function tenantId() {
  return state && state.session ? state.session.tenantId || null : null;
}

/** Usuario activo de la sesión actual (o null si no hay sesión). */
export function userId() {
  return state && state.session ? state.session.userId || null : null;
}

/* ------------------------------------------------------------
   Utilidades de fecha (idénticas a la versión original)
   ------------------------------------------------------------ */
export function todayISO(offsetDays = 0) {
  // Usar componentes de fecha LOCAL para no
  // desplazar días al convertir a UTC (ISO).
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

/* ------------------------------------------------------------
   Caché local (offline)
   ------------------------------------------------------------ */

/** Guarda el estado completo en localStorage. */
export function saveCache() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Error guardando caché local', e);
    return false;
  }
}

/** Lee el estado desde la caché local. Devuelve null si no existe. */
export function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error leyendo caché local', e);
  }
  return null;
}

/**
 * Persiste el estado. En Fase 1 se persiste siempre en la caché local
 * (modelo offline-first). db.js empuja además cada cambio a Supabase.
 */
export async function persist() {
  const ok = saveCache();
  if (!ok) {
    // Aviso perezoso para no crear dependencia dura con ui.js
    try {
      const { showToast } = await import('./ui.js');
      showToast('No se pudo guardar en este dispositivo (memoria llena o modo privado).');
    } catch (_) { /* noop */ }
  }
}

/* ------------------------------------------------------------
   Cola de escrituras pendientes (para sincronizar al reconectar)
   ------------------------------------------------------------ */

/** Devuelve la cola de operaciones pendientes. */
export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

/** Agrega una operación a la cola offline. */
export function enqueue(op) {
  const q = getQueue();
  q.push({ ...op, ts: Date.now() });
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e) {
    console.error('No se pudo encolar la operación offline', e);
  }
}

/** Sustituye la cola completa (usado tras un flush parcial). */
export function setQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e) {
    console.error('No se pudo actualizar la cola offline', e);
  }
}

/** Vacía la cola offline. */
export function clearQueue() {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------
   Roles y permisos
   ------------------------------------------------------------
   Roles posibles (columna users.rol): 'Administrador', 'Supervisor',
   'Empleado'. Un valor null en TABS_POR_ROL significa "todo" SOLO para
   Administrador. Cualquier rol desconocido debe fallar cerrado.
   ------------------------------------------------------------ */

/** Rol actual de la sesión (o null si no hay sesión). */
export function rolActual() {
  return state && state.session ? state.session.role || null : null;
}

export function esAdmin() { return rolActual() === 'Administrador'; }
export function esSupervisor() { return rolActual() === 'Supervisor'; }
export function esEmpleado() { return rolActual() === 'Empleado'; }

/**
 * Pestañas visibles por rol.
 *  - Administrador: todo (null).
 *  - Supervisor: todo EXCEPTO finanzas, configuración, empleados y reportes.
 *  - Empleado: solo producción (ahí ve la info de la orden del artículo que
 *    registra); Órdenes queda solo para Administrador y Supervisor.
 */
export const TABS_POR_ROL = {
  Administrador: null,
  Supervisor: ['dashboard', 'clientes', 'ordenes', 'ia', 'galeria', 'produccion', 'biblioteca', 'facturas', 'inventario', 'agenda', 'notificaciones'],
  Empleado: ['produccion', 'galeria', 'agenda', 'inventario']
};

/** ¿El rol actual puede ver esta pestaña? */
export function puedeVerTab(tab) {
  const rol = rolActual();
  if (rol === 'Administrador') return true;
  const permitidas = TABS_POR_ROL[rol];
  if (!Array.isArray(permitidas)) return false;
  return permitidas.includes(tab);
}

/** Pestaña inicial según rol (el empleado no ve dashboard). */
export function tabInicial() {
  return esEmpleado() ? 'produccion' : 'dashboard';
}

/** ¿Puede crear / editar / avanzar / cobrar órdenes? (no el empleado) */
export function puedeEditarOrdenes() {
  return esAdmin() || esSupervisor();
}

/* ------------------------------------------------------------
   Migraciones de datos en memoria (compatibilidad de la caché)
   ------------------------------------------------------------ */
export function ensurePagoFields(o) {
  if (o.pagadoQR === undefined) o.pagadoQR = 0;
  if (o.pagadoEfectivo === undefined) o.pagadoEfectivo = 0;
  return o;
}
