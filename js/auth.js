/* ============================================================
   AUTENTICACIÓN — Sistema SeS (Supabase Auth)
   ============================================================
   Reemplaza el login falso (contraseñas fijas por rol) por
   autenticación real contra Supabase. El selector de rol de la
   pantalla de login es SOLO visual: el rol efectivo proviene de la
   columna users.rol en la base de datos.
   ============================================================ */
import { supabase } from './config.js';
import { state, loadCache, setState, seedData, persist, puedeVerTab, puedeEditarOrdenes, esAdmin } from './state.js';
import { showToast, logActivity, setConnStatus } from './ui.js';
import * as db from './db.js';
import { startNotificationSync, stopNotificationSync } from './modules/notificaciones.js';
import { startRealtimeAgenda, stopRealtimeAgenda } from './modules/agenda.js';
import { startRealtimeConfig, stopRealtimeConfig } from './modules/configuracion.js';

// Rol seleccionado en la UI (solo estético).
let selectedRole = 'Administrador';

/** Marca visualmente el rol elegido en la pantalla de login. */
export function selectRole(btn) {
  document.querySelectorAll('.role-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedRole = btn.dataset.role;
}

/**
 * Inicia sesión con email + contraseña contra Supabase Auth.
 * Tras autenticar, carga el perfil (tenant_id y rol real) desde users.
 */
export async function doLogin() {
  const email = (document.getElementById('login-user').value || '').trim();
  const pass = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  if (errorEl) errorEl.style.display = 'none';

  if (!email || !pass) {
    if (errorEl) { errorEl.textContent = 'Ingresa tu correo y contraseña.'; errorEl.style.display = 'block'; }
    return;
  }
  if (!supabase) {
    if (errorEl) { errorEl.textContent = 'No hay conexión con el servidor. Revisa tu internet.'; errorEl.style.display = 'block'; }
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await onAuthenticated(data.user);
  } catch (e) {
    console.error('Error de inicio de sesión:', e);
    if (errorEl) {
      errorEl.textContent = 'Correo o contraseña incorrectos.';
      errorEl.style.display = 'block';
    }
  }
}

/**
 * Completa el arranque de la sesión una vez autenticado:
 * carga el perfil, los datos del tenant y muestra la app.
 */
export async function onAuthenticated(authUser) {
  if (!state) setState(seedData());
  // Perfil del usuario (rol real + tenant).
  let perfil = null;
  try {
    const { data, error } = await supabase.from('users').select('*').eq('id', authUser.id).single();
    if (error) throw error;
    perfil = data;
  } catch (e) {
    console.error('No se encontró el perfil del usuario en la tabla users:', e);
    showToast('Tu usuario no tiene perfil asignado. Contacta al administrador.');
    await supabase.auth.signOut();
    return;
  }

  state.session = {
    loggedIn: true,
    role: perfil.rol,                 // rol REAL desde la base de datos
    user: perfil.nombre || authUser.email,
    email: authUser.email,
    userId: authUser.id,
    tenantId: perfil.tenant_id
  };

  // Carga los datos del tenant (con respaldo en caché si falla).
  const ok = await db.loadAllData();
  if (!ok) {
    const cached = loadCache();
    if (cached) {
      cached.session = state.session;
      setState(cached);
      showToast('Trabajando con datos guardados (sin conexión).');
    }
  }
  await persist();

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  document.getElementById('side-user-label').textContent = state.session.user + ' · ' + state.session.role;
  const secUser = document.getElementById('sec-user'); if (secUser) secUser.textContent = state.session.user;
  const secRole = document.getElementById('sec-role'); if (secRole) secRole.textContent = state.session.role;

  applyRolePermissions();
  logActivity('Inicio de sesión (' + state.session.role + ')');
  setConnStatus(db.online() ? 'online' : 'offline', db.pendingCount());

  const app = await import('./app.js');
  app.renderAll();

  // El empleado no ve el dashboard: llevarlo a su pestaña inicial.
  const { tabInicial } = await import('./state.js');
  const inicial = tabInicial();
  if (inicial !== 'dashboard' && typeof app.switchTab === 'function') {
    app.switchTab(inicial);
  }

  // Inicia el temporizador de cierre por inactividad (20 min).
  if (window.resetInactivityTimer) window.resetInactivityTimer();

  // Intenta sincronizar operaciones pendientes.
  db.flushQueue().then(r => setConnStatus(db.online() ? 'online' : 'offline', r.pending));
  
  // Iniciar funcionalidades de Fase 2
  startNotificationSync();      // Sincronización automática de notificaciones
  startRealtimeAgenda();         // Actualizaciones en tiempo real de la agenda
  startRealtimeConfig();         // Sincronización en tiempo real del QR de pago / logo del negocio
}

/** Cierra la sesión. */
export async function doLogout() {
  // Detener funcionalidades de Fase 2
  stopNotificationSync();
  stopRealtimeAgenda();
  stopRealtimeConfig();
  
  try { if (supabase) await supabase.auth.signOut(); } catch (e) { /* noop */ }
  if (state) state.session = { loggedIn: false, role: null, user: null };
  // Limpiar SIEMPRE el campo de contraseña al salir (el usuario puede quedarse
  // visible, pero la contraseña nunca debe permanecer cacheada por el navegador.
  const passEl = document.getElementById('login-pass');
  if (passEl) { passEl.value = ''; }
  const userEl = document.getElementById('login-user');
  if (userEl) { userEl.value = ''; }
  await persist();
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  showToast('Sesión cerrada');
}

/**
 * Aplica los permisos por rol a la interfaz:
 *  - Muestra/oculta cada pestaña del menú según TABS_POR_ROL.
 *  - Oculta acciones exclusivas del administrador o de quien edita órdenes.
 */
export function applyRolePermissions() {
  // Menú lateral: recorrer todas las pestañas y mostrar solo las permitidas.
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    const tab = el.dataset.tab;
    el.style.display = puedeVerTab(tab) ? 'flex' : 'none';
  });

  // Botón de nuevo gasto: solo administrador.
  const gastoBtn = document.getElementById('btn-nuevo-gasto');
  if (gastoBtn) gastoBtn.style.display = esAdmin() ? 'inline-flex' : 'none';

  // Botón "+ Nueva orden": solo quien puede editar órdenes (no el empleado).
  const nuevaOrdenBtn = document.getElementById('btn-nueva-orden');
  if (nuevaOrdenBtn) nuevaOrdenBtn.style.display = puedeEditarOrdenes() ? 'inline-flex' : 'none';
}

// Exposición global para los onclick del HTML.
Object.assign(window, { selectRole, doLogin, doLogout });
