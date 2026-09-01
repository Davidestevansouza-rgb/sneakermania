/* www/js/biometric.js — Acceso rápido con huella dactilar / Face ID.
   ============================================================
   Usa la API WebAuthn del navegador (autenticador de plataforma:
   huella, Face ID, PIN del sistema operativo, etc.) para verificar
   al usuario en ESTE dispositivo y así evitar escribir usuario y
   contraseña cada vez. La credencial se guarda solo localmente.
   No reemplaza la autenticación real: solo desbloquea la sesión
   de Supabase que ya se guardó tras el último inicio de sesión
   con contraseña (ver pin.js → saveSessionForPin / getSavedSession).
   ============================================================ */

const CRED_ID_KEY = 'sm_biometric_cred_id';
// Sesión guardada SOLO para biometría (separada del PIN para que no se borre en logout).
const BIOMETRIC_SESSION_KEY = 'sm_biometric_session';

function b64encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0)).buffer;
}
function randomChallenge() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

/** ¿Ya se registró una huella/Face ID en este dispositivo? */
export function hasBiometric() {
  return !!localStorage.getItem(CRED_ID_KEY);
}

/** Borra el registro biométrico de este dispositivo. */
export function clearBiometric() {
  localStorage.removeItem(CRED_ID_KEY);
  localStorage.removeItem(BIOMETRIC_SESSION_KEY);
}

/**
 * Guarda el refresh_token de la sesión para uso biométrico.
 * Se guarda por separado del PIN para que NO se borre en logout.
 * Solo se borra cuando el usuario desactiva la biometría explícitamente.
 */
export function saveBiometricSession(session) {
  try {
    if (!session || !session.refresh_token) return;
    localStorage.setItem(BIOMETRIC_SESSION_KEY, JSON.stringify({
      refresh_token: session.refresh_token,
      user_id: session.user?.id || null
    }));
  } catch (e) { /* noop */ }
}

/** Devuelve los datos de sesión biométrica guardados, o null si no hay. */
export function getBiometricSession() {
  try { return JSON.parse(localStorage.getItem(BIOMETRIC_SESSION_KEY) || 'null'); } catch { return null; }
}

/** ¿El navegador/dispositivo soporta huella o Face ID (autenticador de plataforma)? */
export async function biometricDisponible() {
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

/** Registra la huella/Face ID del usuario en este dispositivo (tras un login exitoso). */
export async function registrarBiometria(userLabel, userId) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'SneakerMania' },
      user: {
        id: new TextEncoder().encode(String(userId || userLabel || 'usuario')),
        name: userLabel || 'usuario',
        displayName: userLabel || 'Usuario'
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }  // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000
    }
  });
  if (!cred) throw new Error('No se pudo registrar la huella/Face ID.');
  localStorage.setItem(CRED_ID_KEY, b64encode(cred.rawId));
  return true;
}

/** Pide la huella/Face ID al usuario. Devuelve true si se verificó correctamente. */
export async function verificarBiometria() {
  const credIdB64 = localStorage.getItem(CRED_ID_KEY);
  if (!credIdB64) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ id: b64decode(credIdB64), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    return !!assertion;
  } catch (e) {
    console.error('Verificación biométrica cancelada o fallida:', e);
    return false;
  }
}

/* --- Modal simple para ofrecer activar huella/Face ID tras iniciar sesión --- */
export function ofrecerActivarBiometria(onAceptar) {
  if (document.getElementById('bio-offer-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'bio-offer-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:99999;';
  modal.innerHTML = `
    <div style="background:#1e1e1e;color:#fff;border-radius:16px;padding:24px;width:300px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,.5);font-family:inherit;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">🔐</div>
      <h3 style="margin:0 0 8px;font-size:17px;">¿Activar huella / Face ID?</h3>
      <p style="margin:0 0 18px;font-size:13px;color:#aaa;">Así podrás ingresar más rápido en este dispositivo sin escribir tu contraseña cada vez.</p>
      <div style="display:flex;gap:10px;">
        <button id="bio-offer-no" style="flex:1;padding:12px;border:none;border-radius:10px;background:#2a2a2a;color:#ccc;cursor:pointer;">Ahora no</button>
        <button id="bio-offer-yes" style="flex:1;padding:12px;border:none;border-radius:10px;background:#B3261E;color:#fff;cursor:pointer;font-weight:600;">Activar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#bio-offer-no').addEventListener('click', close);
  modal.querySelector('#bio-offer-yes').addEventListener('click', async () => {
    close();
    if (onAceptar) await onAceptar();
  });
}

Object.assign(window, { biometricDisponible, registrarBiometria, verificarBiometria, hasBiometric, clearBiometric, saveBiometricSession, getBiometricSession });
