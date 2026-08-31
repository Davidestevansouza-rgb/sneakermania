/* ============================================================
   NOTIFICACIONES PUSH — Sistema SeS (REAL, no demo)
   Web Push API: la suscripción se guarda en Supabase
   (push_subscriptions) y la Edge Function send-push manda las
   notificaciones aunque la app esté cerrada o el celular bloqueado.
   ============================================================ */
import { state } from '../state.js';
import { showToast, reproducirSonidoNotificacion } from '../ui.js';
import { supabase } from '../config.js';

let pushSubscription = null;

// Clave pública VAPID REAL de este proyecto (ver PUSH_REAL_SETUP.md para
// la clave privada, que NUNCA va en el frontend). Si necesitás rotarla,
// generá un par nuevo y actualizá acá + en los Secrets de la Edge Function.
const VAPID_PUBLIC_KEY = 'BKS5WiqA6iRzj52zakuKzGSbX6ZtZU8rXf12KrIDwGSMvgv5JElQcxNsgn2wwYUGEw6oQgv-sV8w4jYMmqzDCFc';

/**
 * Solicita permiso para mostrar notificaciones push.
 */
export async function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('Este navegador no soporta notificaciones');
    return false;
  }
  
  if (!('serviceWorker' in navigator)) {
    showToast('Service Worker no disponible');
    return false;
  }
  
  try {
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      showToast('Notificaciones activadas ✓', 'info');
      await subscribeToPush();
      return true;
    } else if (permission === 'denied') {
      showToast('Notificaciones bloqueadas. Revisa los permisos del navegador.');
      return false;
    } else {
      showToast('Notificaciones desactivadas');
      return false;
    }
  } catch (e) {
    console.error('Error al solicitar permisos de notificación:', e);
    showToast('Error al activar notificaciones');
    return false;
  }
}

/**
 * Suscribe al dispositivo a notificaciones push reales y guarda la
 * suscripción en Supabase (tabla push_subscriptions) para que la Edge
 * Function send-push pueda encontrarla y mandarle avisos aunque esta
 * pestaña esté cerrada.
 */
async function subscribeToPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    
    let subscription = await reg.pushManager.getSubscription();
    
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

/** Guarda (o actualiza) la suscripción real en la base de datos. */
async function guardarSuscripcionEnSupabase(subscription) {
  if (!supabase || !state.session || !state.session.tenantId) return;
  const json = subscription.toJSON();
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
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Envía una notificación LOCAL de prueba (usa el Service Worker igual que
 * las reales, para probar que el permiso y el icono funcionan). Las
 * notificaciones de verdad (pago pendiente, stock bajo, atraso) las manda
 * el servidor a través de send-push, no esta función.
 */
export async function enviarNotificacionPush(titulo, mensaje, icono = './assets/icon-192.png') {
  if (!('Notification' in window)) {
    showToast('Este navegador no soporta notificaciones push');
    return;
  }
  if (Notification.permission !== 'granted') {
    console.warn('Notificaciones no permitidas');
    showToast('No tenés el permiso de notificaciones concedido en este navegador');
    return;
  }
  try {
    if (!('serviceWorker' in navigator)) throw new Error('Este navegador no soporta Service Worker');
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, {
      body: mensaje,
      icon: icono,
      badge: icono,
      tag: 'ses-notif-' + Date.now(),
      requireInteraction: false,
      // Bug reportado: la notificación aparecía pero sin sonido. "silent"
      // sin especificar puede quedar en un estado ambiguo en algunos
      // navegadores/Android; se fuerza explícitamente a false, y se agrega
      // "vibrate" porque en Android el sonido/vibración de una notificación
      // web depende de que el canal la reciba con estos datos.
      silent: false,
      vibrate: [200, 80, 200]
    });
    // Además del sonido nativo del sistema (que depende del SO/navegador),
    // se suma el "ding" propio de la app mientras la pestaña está abierta,
    // para que la prueba se escuche siempre en este dispositivo.
    reproducirSonidoNotificacion();
  } catch (e) {
    console.error('Error al mostrar la notificación:', e);
    showToast('No se pudo mostrar la notificación: ' + (e.message || 'error desconocido') + '. Revisá que las notificaciones del navegador/sistema operativo estén permitidas para este sitio.');
  }
}

/**
 * Renderiza el panel de control de notificaciones push en Configuración.
 */
export function renderPushPanel() {
  // iOS (Safari/Chrome) NO tiene la API de notificaciones disponible salvo
  // que el sitio esté instalado como app desde la pantalla de inicio (iOS
  // 16.4+). Sin esta comprobación, "Notification.permission" explota con
  // un ReferenceError en esos casos y rompe toda la pestaña Configuración
  // — eso es lo que te estaba pasando en el celular.
  if (!('Notification' in window)) {
    const esIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    return `
      <div class="panel">
        <div class="panel-title">Notificaciones Push</div>
        <div class="hint" style="margin-bottom:12px;">Alertas reales en el celular/PC (pagos pendientes, atrasos, stock bajo), aunque la app esté cerrada.</div>
        <div class="hint" style="color:var(--red);">
          ⚠️ Este navegador no soporta notificaciones push todavía.
          ${esIOS ? 'En iPhone: abrí el ícono de Compartir → "Agregar a pantalla de inicio", y después abrí el sistema desde ese ícono (no desde Safari/Chrome directamente). Requiere iOS 16.4 o más nuevo.' : ''}
        </div>
      </div>
    `;
  }

  const permitido = Notification.permission === 'granted';
  const bloqueado = Notification.permission === 'denied';
  const suscrito = !!localStorage.getItem('ses-push-endpoint-ok');
  
  let html = `
    <div class="panel">
      <div class="panel-title">Notificaciones Push</div>
      <div class="hint" style="margin-bottom:12px;">Alertas reales en el celular/PC (pagos pendientes, atrasos, stock bajo), aunque la app esté cerrada.</div>
  `;
  
  if (bloqueado) {
    html += `
      <div class="hint" style="color:var(--red);">
        ⚠️ Las notificaciones están bloqueadas. Permite el acceso desde la configuración del navegador (ícono de candado junto a la URL).
      </div>
    `;
  } else if (permitido) {
    html += `
      <div style="color:var(--green);margin-bottom:10px;">
        ✓ Notificaciones activadas — este dispositivo está registrado para recibir avisos reales del servidor.
      </div>
      <button class="btn btn-ghost" onclick="testPushNotification()">Enviar notificación de prueba</button>
    `;
  } else {
    html += `
      <button class="btn btn-primary" onclick="activarNotificacionesPush()">Activar notificaciones</button>
    `;
  }
  
  html += `</div>`;
  return html;
}

/**
 * Botón para activar notificaciones (llamado desde HTML).
 */
export async function activarNotificacionesPush() {
  const ok = await requestPushPermission();
  if (ok) localStorage.setItem('ses-push-endpoint-ok', '1');
  if (ok && window.renderConfiguracion) window.renderConfiguracion();
}

/**
 * Envía una notificación de prueba local (para confirmar permisos e ícono).
 */
export function testPushNotification() {
  enviarNotificacionPush(
    '🔔 SneakerMania',
    'Las notificaciones están funcionando correctamente en este dispositivo.'
  );
}

// Si el Service Worker avisa que la suscripción cambió (puede pasar sola,
// la maneja el navegador), la volvemos a guardar en Supabase.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'PUSH_SUBSCRIPTION_CHANGED') {
      subscribeToPush();
    }
  });
}

Object.assign(window, { 
  activarNotificacionesPush, 
  testPushNotification,
  renderPushPanel
});
