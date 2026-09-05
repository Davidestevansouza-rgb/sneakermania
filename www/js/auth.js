/* ============================================================
   AUTENTICACIÓN — SneakerMania (Supabase Auth)
   ============================================================ */
import { supabase } from './config.js';
import { state, loadCache, setState, seedData, persist, puedeVerTab, puedeEditarOrdenes, esAdmin } from './state.js';
import { showToast, logActivity, setConnStatus } from './ui.js';
import * as db from './db.js';
import { startNotificationSync, stopNotificationSync } from './modules/notificaciones.js';
import { startRealtimeAgenda, stopRealtimeAgenda } from './modules/agenda.js';
import { startRealtimeConfig, stopRealtimeConfig } from './modules/configuracion.js';
import { hasPin, saveSessionForPin, getSavedSession, clearPin } from './pin.js';
import { biometricDisponible, registrarBiometria, verificarBiometria, hasBiometric, ofrecerActivarBiometria, saveBiometricSession, getBiometricSession } from './biometric.js';

// ─── SESIÓN ÚNICA ────────────────────────────────────────────────────────────
const SESSION_TOKEN_KEY = 'ses-session-token';
let _sessionValidationInterval = null;
let _sessionValidationRunning = false;
let _logoutInProgress = false;
let _replacementLogoutScheduled = false;

function _generateSessionToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _stopSessionValidation() {
  if (_sessionValidationInterval) clearInterval(_sessionValidationInterval);
  _sessionValidationInterval = null;
  _sessionValidationRunning = false;
}

async function _registrarSesionUnica(userId) {
  try {
    const token = _generateSessionToken();
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    const { error } = await supabase.rpc('establecer_sesion', { p_user_id: userId, p_token: token });
    if (error) throw error;
    _iniciarValidacionSesion(userId, token);
    return true;
  } catch (e) {
    console.warn('No se pudo registrar la sesión única:', e?.message || e);
    return false;
  }
}

function _iniciarValidacionSesion(userId, token) {
  _stopSessionValidation();

  _sessionValidationInterval = setInterval(async () => {
    if (!state.session?.loggedIn || _logoutInProgress || _sessionValidationRunning) return;
    _sessionValidationRunning = true;

    try {
      const { data, error } = await supabase.rpc('valida_sesion', { p_user_id: userId, p_token: token });
      if (error) return;

      if (data === false && !_replacementLogoutScheduled) {
        _replacementLogoutScheduled = true;
        _stopSessionValidation();
        showToast('⚠️ Tu sesión fue iniciada en otro dispositivo. Esta sesión se cerrará.', 'error');
        setTimeout(() => doLogout({ replaced: true }), 2500);
      }
    } catch (e) {
      // Un fallo temporal de red no debe provocar logout ni ciclos de reconexión.
    } finally {
      _sessionValidationRunning = false;
    }
  }, 20000);
}

/**
 * Al reabrir/recargar, reutiliza el token de sesión única de ESTE dispositivo.
 * Si ya fue reemplazado por otro dispositivo no lo reclama de nuevo: deja que
 * la sesión nueva siga siendo la vigente y muestra el login localmente.
 */
async function _restaurarSesionUnica(userId) {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    await _registrarSesionUnica(userId);
    return true;
  }

  try {
    const { data, error } = await supabase.rpc('valida_sesion', { p_user_id: userId, p_token: token });
    if (error) {
      _iniciarValidacionSesion(userId, token);
      return true;
    }
    if (data === false) return false;
    _iniciarValidacionSesion(userId, token);
    return true;
  } catch (e) {
    _iniciarValidacionSesion(userId, token);
    return true;
  }
}

async function _cerrarSesionUnica(userId, invalidateRemoteToken = true) {
  _stopSessionValidation();
  const localToken = localStorage.getItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_TOKEN_KEY);

  if (!invalidateRemoteToken || !userId || !localToken || !supabase) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const { data: sigueSiendoActual, error: validationError } = await supabase.rpc('valida_sesion', {
      p_user_id: userId,
      p_token: localToken
    });
    if (validationError || sigueSiendoActual !== true) return;
    await supabase.rpc('cerrar_sesion', { p_user_id: userId });
  } catch (e) {
    // El logout local debe continuar aunque la red o el RPC fallen.
  }
}
// ─────────────────────────────────────────────────────────────────────────────

let selectedRole = 'Administrador';

export function selectRole(btn) {
  document.querySelectorAll('.role-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedRole = btn.dataset.role;
}

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

    try {
      if (data?.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        saveSessionForPin(data.session);
        if (hasBiometric()) saveBiometricSession(data.session);
      }
    } catch (e) { /* noop */ }

    const ok = await onAuthenticated(data.user);
    if (!ok) return;
    try { await _registrarSesionUnica(data.user.id); } catch (e) { /* noop */ }

    try {
      if (!hasBiometric() && await biometricDisponible()) {
        ofrecerActivarBiometria(async () => {
          try {
            await registrarBiometria(state.session.user, state.session.userId);
            if (data?.session) saveBiometricSession(data.session);
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

export async function doLoginBiometric() {
  const errorEl = document.getElementById('login-error');
  if (errorEl) errorEl.style.display = 'none';

  if (!hasBiometric()) {
    if (errorEl) { errorEl.textContent = 'Face ID/huella todavía no está activado en este dispositivo.'; errorEl.style.display = 'block'; }
    return;
  }

  const bioSession = getBiometricSession();
  if (!bioSession) {
    if (errorEl) {
      errorEl.textContent = 'Face ID/huella está activado, pero necesita vincularse de nuevo. Ingresa con tu contraseña una sola vez.';
      errorEl.style.display = 'block';
    }
    return;
  }
  if (!supabase) {
    if (errorEl) { errorEl.textContent = 'No hay conexión con el servidor. Revisa tu internet.'; errorEl.style.display = 'block'; }
    return;
  }

  const verificado = await verificarBiometria();
  if (!verificado) {
    if (errorEl) { errorEl.textContent = 'No se pudo verificar Face ID/huella. Intenta nuevamente o usa tu contraseña.'; errorEl.style.display = 'block'; }
    return;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: bioSession.refresh_token });
    if (error) throw error;

    try {
      if (data?.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        saveSessionForPin(data.session);
        saveBiometricSession(data.session);
      }
    } catch (e) { /* noop */ }

    const ok = await onAuthenticated(data.user);
    if (!ok) return;
    try { await _registrarSesionUnica(data.user.id); } catch (e) { /* noop */ }
  } catch (e) {
    console.error('Error restaurando sesión con huella/Face ID:', e);
    if (errorEl) {
      errorEl.textContent = 'Face ID/huella sigue registrado, pero la sesión venció. Ingresa con tu contraseña una sola vez para renovarla.';
      errorEl.style.display = 'block';
    }
  }
}

export async function initBiometricLoginUI() {
  const btn = document.getElementById('btn-login-biometric');
  if (!btn) return;
  try {
    const disponible = await biometricDisponible();
    btn.style.display = (disponible && hasBiometric()) ? 'flex' : 'none';
  } catch (e) {
    btn.style.display = hasBiometric() ? 'flex' : 'none';
  }
}

export async function restorePersistedSession() {
  if (!supabase) return false;
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) return false;

    const uniqueOk = await _restaurarSesionUnica(session.user.id);
    if (!uniqueOk) {
      _stopSessionValidation();
      localStorage.removeItem(SESSION_TOKEN_KEY);
      try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) { /* noop */ }
      if (state) state.session = { loggedIn: false, role: null, user: null };
      await persist();
      const errorEl = document.getElementById('login-error');
      if (errorEl) {
        errorEl.textContent = 'Esta cuenta se abrió en otro dispositivo. Ingresa nuevamente si quieres usarla aquí.';
        errorEl.style.display = 'block';
      }
      return false;
    }

    try {
      localStorage.setItem('supabase_session', JSON.stringify(session));
      saveSessionForPin(session);
      if (hasBiometric()) saveBiometricSession(session);
    } catch (e) { /* noop */ }

    return await onAuthenticated(session.user);
  } catch (e) {
    console.warn('No se pudo recuperar la sesión persistente:', e?.message || e);
    return false;
  }
}

export async function onAuthenticated(authUser) {
  if (!state) setState(seedData());

  try {
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current && hasPin()) {
      const saved = getSavedSession();
      if (saved) {
        try { await supabase.auth.setSession(saved); } catch (_) { /* noop */ }
      }
    }
  } catch (e) { /* noop */ }

  let perfil = null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id,nombre,rol,tenant_id,activo')
      .eq('id', authUser.id)
      .single();
    if (error) throw error;
    perfil = data;
  } catch (e) {
    const cached = loadCache();
    const cachedSession = cached?.session;
    if (cachedSession?.userId === authUser.id && cachedSession?.role && cachedSession?.tenantId) {
      perfil = {
        id: authUser.id,
        nombre: cachedSession.user || authUser.email,
        rol: cachedSession.role,
        tenant_id: cachedSession.tenantId,
        activo: true
      };
    } else {
      console.error('No se pudo verificar el perfil del usuario:', e);
      showToast('No se pudo verificar tu usuario. Revisa tu conexión e intenta nuevamente.');
      return false;
    }
  }

  if (perfil.activo === false) {
    console.warn('Intento de acceso de un usuario desactivado:', authUser.email);
    showToast('Tu usuario está desactivado. Contacta al administrador.');
    await supabase.auth.signOut({ scope: 'local' });
    try { localStorage.removeItem('supabase_session'); } catch (e) { /* noop */ }
    try { clearPin(); } catch (e) { /* noop */ }
    return false;
  }

  state.session = {
    loggedIn: true,
    role: perfil.rol,
    user: perfil.nombre || authUser.email,
    email: authUser.email,
    userId: authUser.id,
    tenantId: perfil.tenant_id
  };

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

  const { tabInicial } = await import('./state.js');
  const inicial = tabInicial();
  if (inicial !== 'dashboard' && typeof app.switchTab === 'function') app.switchTab(inicial);

  if (state.session.role === 'Supervisor') {
    try {
      const pushMod = await import('./modules/push-notifications.js');
      if (typeof pushMod.autoSuscribirSiEsSupervisor === 'function') {
        pushMod.autoSuscribirSiEsSupervisor().catch(() => {});
      }
    } catch (e) { /* noop */ }
  }

  db.flushQueue().then(r => setConnStatus(db.online() ? 'online' : 'offline', r.pending));
  startNotificationSync();
  startRealtimeAgenda();
  startRealtimeConfig();
  return true;
}

export async function doLogout(options = {}) {
  if (_logoutInProgress) return;
  _logoutInProgress = true;

  const replaced = options === true || options?.replaced === true;
  try {
    stopNotificationSync();
    stopRealtimeAgenda();
    stopRealtimeConfig();

    const userId = state.session?.userId || null;
    await _cerrarSesionUnica(userId, !replaced);

    try {
      if (supabase) {
        if (replaced) {
          await supabase.auth.signOut({ scope: 'local' });
        } else if (hasBiometric()) {
          try {
            const { data: { session: currSess } } = await supabase.auth.getSession();
            if (currSess) saveBiometricSession(currSess);
          } catch (e) { /* noop */ }
          await supabase.auth.signOut({ scope: 'local' });
        } else {
          await supabase.auth.signOut({ scope: 'local' });
        }
      }
    } catch (e) { /* noop */ }

    try { localStorage.removeItem('supabase_session'); } catch (e) { /* noop */ }
    try { clearPin(); } catch (e) { /* noop */ }

    if (state) state.session = { loggedIn: false, role: null, user: null };
    const passEl = document.getElementById('login-pass');
    if (passEl) passEl.value = '';
    const userEl = document.getElementById('login-user');
    if (userEl) userEl.value = '';
    await persist();

    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'none';
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'flex';
    await initBiometricLoginUI();
    if (!replaced) showToast('Sesión cerrada');
  } finally {
    _replacementLogoutScheduled = false;
    _logoutInProgress = false;
  }
}

export function applyRolePermissions() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    const tab = el.dataset.tab;
    el.style.display = puedeVerTab(tab) ? 'flex' : 'none';
  });

  const gastoBtn = document.getElementById('btn-nuevo-gasto');
  if (gastoBtn) gastoBtn.style.display = esAdmin() ? 'inline-flex' : 'none';

  const nuevaOrdenBtn = document.getElementById('btn-nueva-orden');
  if (nuevaOrdenBtn) nuevaOrdenBtn.style.display = puedeEditarOrdenes() ? 'inline-flex' : 'none';
}

Object.assign(window, { selectRole, doLogin, doLogout, doLoginBiometric, initBiometricLoginUI, restorePersistedSession });
