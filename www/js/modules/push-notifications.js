/* ============================================================
   NOTIFICACIONES PUSH — SneakerMania
   ============================================================ */
import { state } from '../state.js';
import { showToast, reproducirSonidoNotificacion } from '../ui.js';
import { supabase } from '../config.js';

let pushSubscription = null;

const VAPID_PUBLIC_KEY = 'BL1GxR2xJjU3_1n2YhVu8M_JcH9o56FBa6J1zrSMl-Qp3ZxPzO7u2rL7G_AzA2DDvaWFCSodSRMj9nwJ4W0X4-Y';

export async function requestPushPermission() {
  if (!('Notification' in window)) { showToast('Este navegador no soporta notificaciones'); return false; }
  if (!('serviceWorker' in navigator)) { showToast('Service Worker no disponible'); return false; }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await subscribeToPush();
      showToast('Notificaciones activadas ✓', 'info');
      return true;
    }
    if (permission === 'denied') showToast('Notificaciones bloqueadas. Revisa los permisos del navegador.');
    else showToast('Notificaciones desactivadas');
    return false;
  } catch (e) {
    console.error('Error al solicitar permisos de notificación:', e);
    showToast('Error al activar notificaciones');
    return false;
  }
}

function uint8ToUrlBase64(value) {
  if (!value) return '';
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function subscribeToPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      const currentKey = uint8ToUrlBase64(subscription.options?.applicationServerKey);
      if (currentKey && currentKey !== VAPID_PUBLIC_KEY) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    pushSubscription = subscription;
    await guardarSuscripcionEnSupabase(subscription);
  } catch (e) {
    console.error('Error al suscribirse a push:', e);
    showToast('No se pudo activar el push: ' + (e.message || 'error desconocido'));
  }
}

async function guardarSuscripcionEnSupabase(subscription) {
  if (!supabase || !state?.session?.tenantId) return;
  const json = subscription.toJSON();
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return;
  const row = {
    tenant_id: state.session.tenantId,
    usuario_id: state.session.userId || null,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent
  };
  const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
  if (error) {
    console.error('No se pudo guardar la suscripción push en Supabase:', error);
    showToast('Se activó el permiso, pero no se pudo registrar en el servidor. Revisa tu conexión.');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function enviarNotificacionPush(titulo, mensaje, icono = './assets/icon-192.png') {
  if (!('Notification' in window)) { showToast('Este navegador no soporta notificaciones push'); return; }
  if (Notification.permission !== 'granted') { showToast('No tenés el permiso de notificaciones concedido en este navegador'); return; }
  try {
    if (!('serviceWorker' in navigator)) throw new Error('Este navegador no soporta Service Worker');
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, {
      body: mensaje,
      icon: icono,
      badge: icono,
      tag: 'ses-notif-' + Date.now(),
      requireInteraction: false,
      silent: false,
      vibrate: [200, 80, 200]
    });
    reproducirSonidoNotificacion();
  } catch (e) {
    console.error('Error al mostrar la notificación:', e);
    showToast('No se pudo mostrar la notificación: ' + (e.message || 'error desconocido'));
  }
}

export function renderPushPanel() {
  if (!('Notification' in window)) {
    const esIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    return `
      <div class="panel">
        <div class="panel-title">Notificaciones Push</div>
        <div class="hint" style="margin-bottom:12px;">Alertas reales en el celular/PC, aunque la app esté cerrada.</div>
        <div class="hint" style="color:var(--red);">⚠️ Este navegador no soporta notificaciones push todavía. ${esIOS ? 'En iPhone: Compartir → "Agregar a pantalla de inicio" y abre SneakerMania desde ese ícono. Requiere iOS 16.4 o superior.' : ''}</div>
      </div>`;
  }
  const permitido = Notification.permission === 'granted';
  const bloqueado = Notification.permission === 'denied';
  let html = `<div class="panel"><div class="panel-title">Notificaciones Push</div><div class="hint" style="margin-bottom:12px;">Alertas reales en el celular/PC, aunque la app esté cerrada.</div>`;
  if (bloqueado) html += `<div class="hint" style="color:var(--red);">⚠️ Las notificaciones están bloqueadas. Permite el acceso desde la configuración del navegador.</div>`;
  else if (permitido) html += `<div style="color:var(--green);margin-bottom:10px;">✓ Notificaciones activadas — este dispositivo está registrado.</div><button class="btn btn-ghost" onclick="testPushNotification()">Enviar notificación de prueba</button>`;
  else html += `<button class="btn btn-primary" onclick="activarNotificacionesPush()">Activar notificaciones</button>`;
  return html + `</div>`;
}

export async function activarNotificacionesPush() {
  const ok = await requestPushPermission();
  if (ok) localStorage.setItem('ses-push-endpoint-ok', '1');
  if (ok && window.renderConfiguracion) window.renderConfiguracion();
}

export function testPushNotification() {
  enviarNotificacionPush('🔔 SneakerMania', 'Las notificaciones están funcionando correctamente en este dispositivo.');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'PUSH_SUBSCRIPTION_CHANGED') subscribeToPush();
  });
}

export async function autoSuscribirSiEsSupervisor() {
  try {
    if (!state?.session || state.session.role !== 'Supervisor') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'granted') {
      await subscribeToPush();
      return;
    }
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await subscribeToPush();
        localStorage.setItem('ses-push-endpoint-ok', '1');
      }
    }
  } catch (e) {
    console.warn('autoSuscribirSiEsSupervisor:', e);
  }
}

Object.assign(window, {
  activarNotificacionesPush,
  testPushNotification,
  renderPushPanel,
  autoSuscribirSiEsSupervisor
});
