import { supabase } from '../config.js';
import { state } from '../state.js';
import { startRealtimeAgenda, stopRealtimeAgenda } from './agenda.js';
import { startRealtimeConfig, stopRealtimeConfig } from './configuracion.js';
import { startNotificationSync, stopNotificationSync } from './notificaciones.js';

const VALIDACION_MIN_MS = 2 * 60 * 1000;
let lastValidationAt = 0;
let lastValidationData = true;
let validationInFlight = null;

function onlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

if (supabase && typeof supabase.rpc === 'function' && !supabase.__smRpcOptimized) {
  const originalRpc = supabase.rpc.bind(supabase);
  supabase.rpc = async function(fn, args, options) {
    if (fn !== 'valida_sesion') return originalRpc(fn, args, options);
    if (!onlineNow()) {
      return { data: lastValidationData, error: null, count: null, status: 200, statusText: 'offline-cache' };
    }

    const now = Date.now();
    if (validationInFlight) return validationInFlight;
    if (lastValidationAt && now - lastValidationAt < VALIDACION_MIN_MS) {
      return { data: lastValidationData, error: null, count: null, status: 200, statusText: 'validation-cache' };
    }

    validationInFlight = Promise.resolve(originalRpc(fn, args, options))
      .then(result => {
        if (!result?.error) {
          lastValidationAt = Date.now();
          lastValidationData = result?.data !== false;
        }
        return result;
      })
      .finally(() => { validationInFlight = null; });

    return validationInFlight;
  };
  supabase.__smRpcOptimized = true;
}

let offlineApplied = false;

function pauseNetworkLoops() {
  if (offlineApplied) return;
  offlineApplied = true;
  stopNotificationSync();
  stopRealtimeAgenda();
  stopRealtimeConfig();
}

function resumeNetworkLoops() {
  offlineApplied = false;
  if (!state.session?.loggedIn || !onlineNow()) return;
  startNotificationSync();
  startRealtimeAgenda();
  startRealtimeConfig();
}

if (typeof window !== 'undefined' && !window.__smNetworkOptimizerInstalled) {
  window.__smNetworkOptimizerInstalled = true;
  window.addEventListener('offline', pauseNetworkLoops);
  window.addEventListener('online', resumeNetworkLoops);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && onlineNow()) resumeNetworkLoops();
  });
  if (!onlineNow()) pauseNetworkLoops();
}
