/* www/js/pin.js — Desbloqueo rápido por PIN local (4 dígitos).
   El PIN se guarda SOLO en este dispositivo con hash SHA-256 + salt.
   No se envía al servidor. */
const PIN_KEY = 'sm_device_pin';
const SALT_KEY = 'sm_pin_salt';
const SESSION_KEY = 'sm_pin_session';

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function getOrCreateSalt() {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const arr = new Uint8Array(16); crypto.getRandomValues(arr);
    salt = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SALT_KEY, salt);
  }
  return salt;
}

export function hasPin() { return !!localStorage.getItem(PIN_KEY); }
export async function savePin(pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('El PIN debe tener 4 dígitos');
  const hash = await sha256(getOrCreateSalt() + pin);
  localStorage.setItem(PIN_KEY, hash);
}
export async function validatePin(pin) {
  const stored = localStorage.getItem(PIN_KEY); if (!stored) return false;
  return (await sha256(localStorage.getItem(SALT_KEY) + pin)) === stored;
}
export function clearPin() { localStorage.removeItem(PIN_KEY); localStorage.removeItem(SESSION_KEY); }
export function saveSessionForPin(session) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
export function getSavedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

/* --- UI modal de PIN --- */
let pinModalEl = null, pinResolve = null, pinBuffer = '', pinMode = 'enter', pinCreateFirst = '';

function ensurePinModal() {
  if (pinModalEl) return;
  pinModalEl = document.createElement('div');
  pinModalEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:99999;';
  pinModalEl.innerHTML = `
    <div style="background:#1e1e1e;color:#fff;border-radius:16px;padding:24px;width:300px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,.5);font-family:inherit;">
      <h3 id="pin-title" style="margin:0 0 8px;text-align:center;font-size:18px;">Ingresa tu PIN</h3>
      <p id="pin-sub" style="margin:0 0 16px;text-align:center;font-size:13px;color:#aaa;">Desbloqueo rápido</p>
      <div id="pin-dots" style="display:flex;justify-content:center;gap:12px;margin-bottom:20px;">
        ${[1,2,3,4].map(()=>'<span class="pin-dot" style="width:14px;height:14px;border-radius:50%;background:#444;"></span>').join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="pin-key" data-k="${n}" style="padding:16px;font-size:22px;border:none;border-radius:12px;background:#2a2a2a;color:#fff;cursor:pointer;">${n}</button>`).join('')}
        <button id="pin-cancel" style="padding:16px;font-size:14px;border:none;border-radius:12px;background:transparent;color:#888;cursor:pointer;">Cancelar</button>
        <button class="pin-key" data-k="0" style="padding:16px;font-size:22px;border:none;border-radius:12px;background:#2a2a2a;color:#fff;cursor:pointer;">0</button>
        <button id="pin-del" style="padding:16px;font-size:18px;border:none;border-radius:12px;background:transparent;color:#888;cursor:pointer;">⌫</button>
      </div>
      <p id="pin-error" style="color:#e74c3c;text-align:center;font-size:13px;margin:12px 0 0;min-height:18px;"></p>
    </div>`;
  document.body.appendChild(pinModalEl);
  pinModalEl.querySelectorAll('.pin-key').forEach(b => b.addEventListener('click', () => onPinKey(b.dataset.k)));
  pinModalEl.querySelector('#pin-del').addEventListener('click', onPinDel);
  pinModalEl.querySelector('#pin-cancel').addEventListener('click', () => closePinModal(false));
}
function updateDots() {
  pinModalEl.querySelectorAll('.pin-dot').forEach((d,i) => d.style.background = i < pinBuffer.length ? '#fff' : '#444');
}
function onPinKey(k) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += k; updateDots();
  if (pinBuffer.length === 4) setTimeout(onPinComplete, 120);
}
function onPinDel() { pinBuffer = pinBuffer.slice(0,-1); updateDots(); pinModalEl.querySelector('#pin-error').textContent=''; }

async function onPinComplete() {
  const err = pinModalEl.querySelector('#pin-error'); err.textContent='';
  if (pinMode === 'create') {
    pinCreateFirst = pinBuffer; pinMode='confirm'; pinBuffer=''; updateDots();
    pinModalEl.querySelector('#pin-title').textContent='Confirma tu PIN';
    pinModalEl.querySelector('#pin-sub').textContent='Repite los 4 dígitos'; return;
  }
  if (pinMode === 'confirm') {
    if (pinBuffer !== pinCreateFirst) {
      err.textContent='Los PIN no coinciden.'; pinBuffer=''; pinCreateFirst=''; pinMode='create'; updateDots();
      pinModalEl.querySelector('#pin-title').textContent='Crea tu PIN';
      pinModalEl.querySelector('#pin-sub').textContent='4 dígitos para desbloquear rápido'; return;
    }
    await savePin(pinBuffer); closePinModal(true); return;
  }
  const ok = await validatePin(pinBuffer);
  if (ok) closePinModal(true); else { err.textContent='PIN incorrecto'; pinBuffer=''; updateDots(); }
}
function openPinModal(mode) {
  ensurePinModal(); pinMode=mode; pinBuffer=''; pinCreateFirst=''; updateDots();
  pinModalEl.querySelector('#pin-error').textContent='';
  if (mode==='create') { pinModalEl.querySelector('#pin-title').textContent='Crea tu PIN'; pinModalEl.querySelector('#pin-sub').textContent='4 dígitos para desbloquear rápido'; }
  else { pinModalEl.querySelector('#pin-title').textContent='Ingresa tu PIN'; pinModalEl.querySelector('#pin-sub').textContent='Desbloqueo rápido'; }
  pinModalEl.style.display='flex';
  return new Promise(r => pinResolve = r);
}
function closePinModal(res) { pinModalEl.style.display='none'; const r=pinResolve; pinResolve=null; if(r) r(res); }

export async function promptCreatePin() { return await openPinModal('create'); }
export async function promptEnterPin() { return await openPinModal('enter'); }

Object.assign(window, { promptCreatePin, promptEnterPin, hasPin, clearPin, saveSessionForPin, getSavedSession, savePin, validatePin });