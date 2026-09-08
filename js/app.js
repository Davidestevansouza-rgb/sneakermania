/* ============================================================
   PUNTO DE ENTRADA — Sistema SeS
   ============================================================
   Orquesta la aplicación: importa todos los módulos, define la
   navegación entre pestañas, el menú móvil, la búsqueda global y
   el arranque (init). La lógica de cada feature vive en su módulo.
   ============================================================ */
import { LOGO_DATA_URI } from './logo.js';
import { supabase } from './config.js';
import { state, setState, seedData, loadCache, puedeVerTab, tabInicial } from './state.js';
import { showToast, setConnStatus, bindPrimerGestoAudio } from './ui.js';
import * as db from './db.js';
import { initBiometricLoginUI, restorePersistedSession } from './auth.js';
import './hotfix-fotos-20260907.js';

// Módulos de features (cada uno se auto-registra en window).
import { renderDashboard } from './modules/dashboard.js';
import { renderClientes } from './modules/clientes.js';
import { renderOrdenes, populateClienteSelect, migrateOrdenes } from './modules/ordenes.js';
import './modules/cliente-orden.js'; // fusión "Nuevo cliente": cliente + artículos + foto/IA + precio + pago + WhatsApp en un solo modal
import { populateIaOrderSelect } from './modules/ia.js';
import { renderGaleria, populateGaleriaSelect } from './modules/galeria.js';
import { renderProduccion } from './modules/produccion.js';
import './modules/items.js'; // artículos/precintos: se usa embebido en Detalle de orden
import { renderBiblioteca } from './modules/biblioteca.js';
import { renderFinanzas } from './modules/finanzas.js';
import { initFacturasTab } from './modules/facturas.js';
import { renderInventario } from './modules/inventario.js';
import { renderReportes } from './modules/reportes.js';
import { renderAgenda } from './modules/agenda.js';
import { renderNotificaciones } from './modules/notificaciones.js';
import { renderEmpleados } from './modules/empleados.js';
import { renderConfiguracion, applyBrandLogo } from './modules/configuracion.js';
import { autoDailyBackup } from './modules/backup.js';
import './modules/whatsapp-limites.js';
import './modules/push-notifications.js';
import './modules/search-payment-safety-20260908.js';
import './modules/orden-item-photo-deferred-20260908.js';
import './modules/item-photo-visibility-fix-20260908.js';
import './modules/modal-ver-close-fix-20260908.js';
import './modules/whatsapp-order-fast-20260908.js';

/* ============================================================
   NAVEGACIÓN
   ============================================================ */
export function switchTab(tab) {
  if (!puedeVerTab(tab)) {
    showToast('No tienes acceso a esta sección');
    tab = tabInicial();
  }
  closeMobileMenu();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('tab-' + tab);
  if (sec) sec.classList.add('active');
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'clientes') renderClientes();
  if (tab === 'ordenes') renderOrdenes();
  if (tab === 'galeria') renderGaleria();
  if (tab === 'produccion') void renderProduccion();
  if (tab === 'biblioteca') renderBiblioteca();
  if (tab === 'finanzas') renderFinanzas();
  if (tab === 'facturas') initFacturasTab();
  if (tab === 'inventario') renderInventario();
  if (tab === 'agenda') renderAgenda();
  if (tab === 'reportes') renderReportes();
  if (tab === 'notificaciones') renderNotificaciones();
  if (tab === 'empleados') renderEmpleados();
  if (tab === 'configuracion' || tab === 'seguridad') renderConfiguracion();
  if (tab === 'ia') populateIaOrderSelect();
}

export function openMobileMenu() {
  document.getElementById('app-sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}
export function closeMobileMenu() {
  document.getElementById('app-sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

export function handleGlobalSearch(q) {
  const filtroTexto = document.getElementById('filtro-orden-texto');
  if (!q) {
    if (filtroTexto) filtroTexto.value = '';
    renderOrdenes();
    return;
  }
  switchTab('ordenes');
  if (filtroTexto) filtroTexto.value = q;
  renderOrdenes();
}

export function renderAll() {
  migrateOrdenes();
  applyBrandLogo();
  renderDashboard();
  renderClientes();
  renderOrdenes();
  renderInventario();
  renderNotificaciones();
  renderConfiguracion();
  populateIaOrderSelect();
  populateGaleriaSelect();
  populateClienteSelect();
  if (document.getElementById('fin-kpi-grid')) renderFinanzas();
  if (document.getElementById('agenda-hoy')) renderAgenda();
  if (state.session && state.session.role === 'Administrador') renderEmpleados();
  autoDailyBackup();
}

function wireConnectivity() {
  window.addEventListener('online', async () => {
    setConnStatus('online', db.pendingCount());
    const r = await db.flushQueue();
    setConnStatus('online', r.pending);
    if (r.flushed > 0) showToast('Sincronización completada (' + r.flushed + ' cambios).');
  });
  window.addEventListener('offline', () => {
    setConnStatus('offline', db.pendingCount());
    showToast('Sin conexión: los cambios se guardarán y se sincronizarán al reconectar.');
  });
}

window.resetInactivityTimer = () => {};

window.addEventListener('error', function (ev) {
  console.error('Error capturado:', ev.message, ev.filename, ev.lineno);
  try { showToast('Ocurrió un error inesperado. Intenta de nuevo.'); } catch (e) { }
});
window.addEventListener('unhandledrejection', function (ev) {
  console.error('Promesa rechazada:', ev.reason);
  try { showToast('Ocurrió un error inesperado. Intenta de nuevo.'); } catch (e) { }
});

(async function init() {
  const setLogo = (id, prop) => { const el = document.getElementById(id); if (el) el[prop] = LOGO_DATA_URI; };
  setLogo('login-logo-img', 'src');
  setLogo('side-logo-img', 'src');
  setLogo('topbar-logo-img', 'src');
  setLogo('favicon-link', 'href');

  const cached = loadCache();
  setState(cached || seedData());
  if (!state.session) state.session = { loggedIn: false, role: null, user: null };

  wireConnectivity();
  bindPrimerGestoAudio();
  setConnStatus(db.online() ? 'online' : 'offline', db.pendingCount());

  let restored = false;
  if (supabase) {
    try { restored = await restorePersistedSession(); } catch (e) {
      console.warn('No se pudo restaurar la sesión guardada:', e?.message || e);
    }
  }

  if (!restored) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display = 'none';
    await initBiometricLoginUI();
  }
})();

Object.assign(window, { switchTab, openMobileMenu, closeMobileMenu, handleGlobalSearch, renderAll });
