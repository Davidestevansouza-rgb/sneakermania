/* ============================================================
   HELPERS DE INTERFAZ — Sistema SeS
   ============================================================
   Funciones utilitarias compartidas: toasts, formateo, búsquedas
   en memoria, chips de estado, apertura/cierre de modales,
   registro de actividad y el indicador de conexión.
   ============================================================ */
import { state, todayISO } from './state.js';
import { LOCALE, CURRENCY_SYMBOL } from './config.js';
import { escHtml } from './sanitize.js';

/* ---------- Toast ---------- */
export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Sonido de alerta (notificaciones) ----------
   Bug reportado: las notificaciones (campanita / push de prueba) aparecían
   en pantalla pero sin ningún sonido. No dependemos de un archivo de audio
   externo (que podía faltar o no cargar): se genera un "ding" corto con
   Web Audio API. Los navegadores exigen un gesto del usuario antes de
   dejar sonar audio, así que el AudioContext se crea recién al primer
   click/tap en la página (ver bindPrimerGestoAudio, llamado desde
   app.js al iniciar) y se reutiliza después para sonar aunque la
   notificación llegue sola (ej. el sync automático cada 60s). */
let audioCtx = null;
let audioDesbloqueado = false;

export function bindPrimerGestoAudio() {
  if (audioDesbloqueado) return;
  const desbloquear = () => {
    audioDesbloqueado = true;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* navegador sin soporte de Web Audio: se ignora, no rompe la app */ }
    document.removeEventListener('click', desbloquear);
    document.removeEventListener('touchstart', desbloquear);
  };
  document.addEventListener('click', desbloquear, { once: true });
  document.addEventListener('touchstart', desbloquear, { once: true });
}

/** Reproduce un "ding" corto de dos tonos para alertar de una notificación nueva. */
export function reproducirSonidoNotificacion() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const ahora = audioCtx.currentTime;
    [[880, ahora], [1175, ahora + 0.12]].forEach(([freq, inicio]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, inicio);
      gain.gain.exponentialRampToValueAtTime(0.22, inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.24);
    });
  } catch (e) {
    // Si el navegador bloquea el audio (sin gesto previo, política del SO, etc.)
    // no debe romper el flujo de notificaciones: solo se pierde el sonido.
    console.warn('No se pudo reproducir el sonido de notificación:', e);
  }
}

/* ---------- Bloqueo de botón (anti-doble-guardado) ----------
   Deshabilita el botón que dispara una acción de guardado y muestra
   "Guardando..." mientras se completa. Devuelve una función que
   restaura el botón a su estado original (llamar en finally). */
export function lockBtn(btn, texto = 'Guardando…') {
  if (!btn || btn.disabled) return () => {};
  const prevHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = texto;
  return () => { btn.disabled = false; btn.innerHTML = prevHtml; };
}

/* ---------- Formateo ---------- */
export function fmtMoney(n) {
  return CURRENCY_SYMBOL + (Number(n) || 0)
    .toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtDate(d) {
  if (!d) return '—';
  // Acepta tanto fechas simples (YYYY-MM-DD) como timestamps ISO.
  // Antes se agregaba 'T00:00:00' siempre, lo que producía 'Invalid Date'
  // cuando el valor ya era un timestamp como 2026-08-25T14:30:00.000Z.
  const raw = String(d).trim();
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00')
    : new Date(raw);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtServicios(ts) {
  if (Array.isArray(ts)) return ts.join(', ') || '—';
  return ts || '—';
}

/* ---------- Búsquedas en memoria ---------- */
export function clienteNombre(id) {
  const c = state.clientes.find(x => x.id === id);
  return c ? c.nombre : '—';
}
export function clienteById(id) { return state.clientes.find(x => x.id === id); }
export function ordenById(id) { return state.ordenes.find(x => x.id === id); }

/* ---------- Chips de estado (texto escapado por seguridad) ---------- */
// Convierte el texto del estado en un slug de clase CSS válido: sin
// tildes, sin espacios (los estados unificados tienen varias palabras,
// ej. "Secado y detallado"), todo en minúscula y separado por guiones.
function slugEstado(e) {
  return String(e)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
export function chipEstado(e) {
  return '<span class="chip chip-' + slugEstado(e) + '">' + escHtml(e) + '</span>';
}
export function chipPago(e) {
  return '<span class="chip chip-' + slugEstado(e) + '">' + escHtml(e) + '</span>';
}
export function priPill(p) {
  return '<span class="pill-priority pri-' + escHtml(String(p).toLowerCase()) + '">' + escHtml(p) + '</span>';
}

/* ---------- Modales ----------
   Bug reportado: al abrir un modal, el fondo (la pantalla detrás) se
   desplazaba/saltaba — típico de no bloquear el scroll del body mientras
   hay un modal abierto: si el contenido de fondo tenía scrollbar y el
   modal se abre con position:fixed pero el body sigue scrolleable, el
   navegador puede saltar o la barra de scroll aparecer/desaparecer y
   correr todo el layout unos píxeles. Se bloquea el scroll del body
   mientras algún modal está abierto y se compensa el ancho de la
   scrollbar (con un padding-right igual a ese ancho) para que el
   contenido de fondo no "salte" horizontalmente al desaparecer la barra.
   Como puede haber más de un modal abierto/cerrándose en secuencia, se
   lleva un contador en vez de bloquear/desbloquear a ciegas. */
let modalesAbiertos = 0;
function bloquearScrollBody() {
  if (modalesAbiertos === 0) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = scrollbarWidth > 0 ? scrollbarWidth + 'px' : '';
    document.body.classList.add('modal-open-lock');
  }
  modalesAbiertos++;
}
function desbloquearScrollBody() {
  modalesAbiertos = Math.max(0, modalesAbiertos - 1);
  if (modalesAbiertos === 0) {
    document.body.classList.remove('modal-open-lock');
    document.body.style.paddingRight = '';
  }
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('open')) desbloquearScrollBody();
  el.classList.remove('open');
}
export function openModalEl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.classList.contains('open')) bloquearScrollBody();
  el.classList.add('open');
}

/* Exponer helpers de modal en window para los onclick inline del HTML
   (los botones X y Cancelar usan onclick="closeModal('...')"). */
if (typeof window !== 'undefined') {
  window.closeModal = closeModal;
  window.openModalEl = openModalEl;
}

/* ---------- Dropdown flotante genérico ----------
   Usado por los buscadores de fecha de Clientes/Órdenes (y reutilizable
   por cualquier otro panel flotante que se abra/cierre con un botón).
   Cierra cualquier otro dropdown de la misma clase que haya quedado
   abierto, y se cierra solo al hacer click afuera. */
export function toggleDropdown(id, ev, closeClass) {
  if (ev) ev.stopPropagation();
  const dd = document.getElementById(id);
  if (!dd) return;
  const yaAbierto = dd.classList.contains('open');
  const selector = '.' + (closeClass || dd.className.split(' ').find(c => c.endsWith('-dropdown')) || 'dropdown') + '.open';
  document.querySelectorAll(selector).forEach(el => el.classList.remove('open'));
  if (!yaAbierto) dd.classList.add('open');
}
export function closeDropdown(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest('.date-filter-wrap')) return;
    document.querySelectorAll('.date-filter-dropdown.open').forEach(el => el.classList.remove('open'));
  });
}
if (typeof window !== 'undefined') {
  window.toggleDropdown = toggleDropdown;
  window.closeDropdown = closeDropdown;
}

/* ---------- Registro de actividad ----------
   Actualiza el log en memoria y lo empuja a Supabase (actividad_log)
   sin bloquear la interfaz. La importación de db.js es dinámica para
   evitar dependencias circulares. */
export function logActivity(accion) {
  if (!state.activityLog) state.activityLog = [];
  state.activityLog.unshift({
    fecha: new Date().toISOString(),
    usuario: state.session ? state.session.user : 'sistema',
    accion
  });
  state.activityLog = state.activityLog.slice(0, 100);
  // Empuje remoto (best-effort).
  import('./db.js')
    .then(db => db.logRemote(accion))
    .catch(() => { /* si falla, queda solo en el log local/caché */ });
}

/* ---------- Indicador de conexión ----------
   Refleja el estado online/offline/sincronizando en la barra superior. */
export function setConnStatus(mode, pending = 0) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.classList.remove('online', 'offline', 'syncing');
  if (mode === 'offline') {
    el.classList.add('offline');
    el.textContent = 'Sin conexión' + (pending ? ' · ' + pending + ' por sincronizar' : '');
    el.style.display = 'inline-flex';
  } else if (mode === 'syncing') {
    el.classList.add('syncing');
    el.textContent = 'Sincronizando…';
    el.style.display = 'inline-flex';
  } else {
    el.classList.add('online');
    el.textContent = 'En línea';
    // En línea y sin pendientes: se oculta tras un momento.
    el.style.display = pending ? 'inline-flex' : 'none';
  }
}

// Se re-exporta todayISO por conveniencia para los módulos de features.
export { todayISO };
