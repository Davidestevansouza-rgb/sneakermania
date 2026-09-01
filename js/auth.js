/* ============================================================
   AUTENTICACIÓN — SneakerMania (Supabase Auth)
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

// IMPORTACIONES NUEVAS (PIN)
import { promptCreatePin, promptEnterPin, hasPin, saveSessionForPin, getSavedSession, clearPin } from './pin.js';

// IMPORTACIONES NUEVAS (huella / Face ID)
import { biometricDisponible, registrarBiometria, verificarBiometria, hasBiometric, clearBiometric, ofrecerActivarBiometria, saveBiometricSession, getBiometricSession } from './biometric.js';

// ─── SESIÓN ÚNICA ────────────────────────────────────────────────────────────
// Token aleatorio que identifica ESTE dispositivo. Se registra en Supabase
// al iniciar sesión (función establecer_sesion). Cada ~20s se valida contra
// la base de datos: si otro dispositivo tomó la sesión, este cierra solo.
const SESSION_TOKEN_KEY = 'ses-session-token';
let _sessionValidationInterval = null;

function _generateSessionToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _registrarSesionUnica(userId) {
  try {
    const token = _generateSessionToken();
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    await supabase.rpc('establecer_sesion', { p_user_id: userId, p_token: token });
    _iniciarValidacionSesion(userId, token);
  } catch (e) { /* noop: no bloquear el login si la sesión única falla */ }
}

function _iniciarValidacionSesion(userId, token) {
  if (_sessionValidationInterval) clearInterval(_sessionValidationInterval);
  _sessionValidationInterval = setInterval(async () => {
    if (!state.session?.loggedIn) return;
    try {
      const { data, error } = await supabase.rpc('valida_sesion', { p_user_id: userId, p_token: token });
      if (!error && data === false) {
        clearInterval(_sessionValidationInterval);
        _sessionValidationInterval = null;
        showToast('⚠️ Tu sesión fue iniciada en otro dispositivo. Esta sesión se cerrará.', 'error');
        setTimeout(() => doLogout(), 2500);
      }
    } catch (e) { /* noop */ }
  }, 20000);
}

async function _cerrarSesionUnica(userId) {
  try {
    if (_sessionValidationInterval) { clearInterval(_sessionValidationInterval); _sessionValidationInterval = null; }
    localStorage.removeItem(SESSION_TOKEN_KEY);
    if (userId) await supabase.rpc('cerrar_sesion', { p_user_id: userId });
  } catch (e) { /* noop */ }
}
// ─────────────────────────────────────────────────────────────────────────────

// Rol seleccionado en la UI (solo estático).
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

    // Guardar sesión para rehidratación, PIN y biometría
    try {
      if (data && data.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        saveSessionForPin(data.session);
        // Si ya hay biometría registrada, actualizar el refresh_token guardado
        if (hasBiometric()) saveBiometricSession(data.session);
      }
    } catch (e) { /* noop */ }

    await onAuthenticated(data.user);

    // Sesión única: registrar este dispositivo en Supabase
    try { await _registrarSesionUnica(data.user.id); } catch (e) { /* noop */ }

    // Ofrecer activar huella/Face ID si no está activada
    try {
      if (!hasBiometric() && await biometricDisponible()) {
        ofrecerActivarBiometria(async () => {
          try {
            await registrarBiometria(state.session.user, state.session.userId);
            // Guardar sesión biométrica tras registro exitoso
            if (data && data.session) saveBiometricSession(data.session);
            showToast('Huella/Face ID activada en este dispositivo. ✓');
          } catch (e) {
            console.error('No se pudo registrar la huella/Face ID:', e);
            showToast('No se pudo activar la huella/Face ID en este dispositivo.');
          }
        });
      }
    } catch (e) { /* noop */ }

  } catch (e) {
    console.error('Error de inicio de sesión:', e);
    if (errorEl) {
      errorEl.textContent = 'Correo o contraseña incorrectos.';
      errorEl.style.display = 'block';
    }
  }
}

/**
 * Inicia sesión con huella dactilar o Face ID, reutilizando la última
 * sesión guardada en este dispositivo (sin volver a pedir contraseña).
 */
export async function doLoginBiometric() {
  const errorEl = document.getElementById('login-error');
  if (errorEl) errorEl.style.display = 'none';

  // Usar la sesión biométrica (guardada por separado, no se borra en logout)
  const bioSession = getBiometricSession();
  if (!bioSession || !hasBiometric()) {
    // Mostrar el error y ocultar el botón biométrico para que el usuario use contraseña
    if (errorEl) { errorEl.textContent = 'No hay una sesión guardada en este dispositivo. Ingresa con tu contraseña.'; errorEl.style.display = 'block'; }
    const btn = document.getElementById('btn-login-biometric');
    if (btn) btn.style.display = 'none';
    return;
  }
  if (!supabase) {
    if (errorEl) { errorEl.textContent = 'No hay conexión con el servidor. Revisa tu internet.'; errorEl.style.display = 'block'; }
    return;
  }

  const verificado = await verificarBiometria();
  if (!verificado) {
    if (errorEl) { errorEl.textContent = 'No se pudo verificar la huella/Face ID.'; errorEl.style.display = 'block'; }
    return;
  }

  try {
    // Usar refreshSession con el refresh_token guardado — NO setSession con tokens viejos.
    // Esto funciona aunque el usuario haya cerrado sesión antes (el signOut local
    // no revoca el refresh_token del servidor si se usa scope:'local').
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: bioSession.refresh_token });
    if (error) throw error;

    try {
      if (data && data.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        saveSessionForPin(data.session);
        saveBiometricSession(data.session); // Actualizar el refresh_token guardado
      }
    } catch (e) { /* noop */ }

    await onAuthenticated(data.user);

    // Sesión única: registrar este dispositivo en Supabase
    try { await _registrarSesionUnica(data.user.id); } catch (e) { /* noop */ }

  } catch (e) {
    console.error('Error restaurando sesión con huella/Face ID:', e);
    if (errorEl) { errorEl.textContent = 'Tu sesión guardada expiró. Ingresa con tu contraseña.'; errorEl.style.display = 'block'; }
    // Ocultar el botón biométrico para que el usuario use contraseña
    const btn = document.getElementById('btn-login-biometric');
    if (btn) btn.style.display = 'none';
  }
}

/**
 * Muestra u oculta el botón de acceso con huella/Face ID en la pantalla
 * de login, según si el dispositivo lo soporta y hay una sesión guardada.
 */
export async function initBiometricLoginUI() {
  const btn = document.getElementById('btn-login-biometric');
  if (!btn) return;
  try {
    const disponible = await biometricDisponible();
    // Usar la sesión biométrica (no la del PIN, que se borra en logout)
    const puedeUsar = disponible && hasBiometric() && !!getBiometricSession();
    btn.style.display = puedeUsar ? 'flex' : 'none';
  } catch (e) {
    btn.style.display = 'none';
  }
}

/**
 * Completa el arranque de la sesión una vez autenticado:
 * carga el perfil, los datos del tenant y muestra la app.
 */
export async function onAuthenticated(authUser) {
  if (!state) setState(seedData());

  // FIX: Restaurar sesión guardada SOLO si no hay sesión activa.
  // Antes este bloque pisaba la sesión recién autenticada con una
  // sesión guardada previa (de otro usuario o expirada), lo que
  // hacía que la consulta a users devolviera 0 filas (403/empty)
  // porque auth.uid() ya no coincidía con authUser.id.
  try {
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current && hasPin()) {
      const saved = getSavedSession();
      if (saved) {
        try { await supabase.auth.setSession(saved); } catch (_) { /* noop */ }
      }
    }
  } catch (e) { /* noop */ }

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

  // --- Bloqueo de empleados/usuarios DESACTIVADOS ---
  // Supabase Auth por sí solo no sabe nada del campo `activo` de la tabla
  // `users`: si el administrador desactiva a alguien desde Empleados, la
  // cuenta de Supabase Auth sigue siendo válida y, sin este control, la
  // persona podía seguir ingresando con su correo y contraseña con
  // total normalidad. Este chequeo es el que realmente impide el acceso.
  if (perfil.activo === false) {
    console.warn('Intento de acceso de un usuario desactivado:', authUser.email);
    showToast('Tu usuario está desactivado. Contacta al administrador.');
    await supabase.auth.signOut();
    try { localStorage.removeItem('supabase_session'); } catch (e) { /* noop */ }
    try { clearPin(); } catch (e) { /* noop */ }
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

  // Inicia el temporizador de cierre por inactividad (30 min).
  if (window.resetInactivityTimer) window.resetInactivityTimer();

  // Notificaciones push automáticas para el rol Supervisor
  if (state.session.role === 'Supervisor') {
    try {
      const pushMod = await import('./modules/push-notifications.js');
      if (typeof pushMod.autoSuscribirSiEsSupervisor === 'function') {
        pushMod.autoSuscribirSiEsSupervisor().catch(() => {});
      }
    } catch (e) { /* noop */ }
  }

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

  // Cerrar sesión única en Supabase
  const userId = state.session?.userId || null;
  await _cerrarSesionUnica(userId);

  try {
    if (supabase) {
      if (hasBiometric()) {
        // Si hay biometría: guardar el refresh_token ANTES del logout local
        // (para que el próximo login biométrico funcione sin contraseña)
        try {
          const { data: { session: currSess } } = await supabase.auth.getSession();
          if (currSess) saveBiometricSession(currSess);
        } catch (e) { /* noop */ }
        // signOut local: no revoca el refresh_token en el servidor
        await supabase.auth.signOut({ scope: 'local' });
      } else {
        await supabase.auth.signOut();
      }
    }
  } catch (e) { /* noop */ }
  try { localStorage.removeItem('supabase_session'); } catch (e) {}
  try { clearPin(); } catch (e) {}
  // NOTA: NO llamamos clearBiometric() aquí para preservar la sesión biométrica

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
Object.assign(window, { selectRole, doLogin, doLogout, doLoginBiometric, initBiometricLoginUI });