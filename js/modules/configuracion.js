/* ============================================================
   MÓDULO: CONFIGURACIÓN (antes "Seguridad")
   Reúne: información de la sesión y roles, datos del negocio del
   tenant, y el registro de actividad (bitácora) leído desde la base.
   La gestión de empleados/usuarios vive en su propia pestaña
   "Empleados" (solo para administradores).
   ============================================================ */
import { state, tenantId, todayISO } from '../state.js';
import * as db from '../db.js';
import { showToast, logActivity } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';
import * as storageManager from '../storage-manager.js';

let realtimeConfigChannel = null;

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/** Sube el logo/QR a Cloudflare R2 (misma vía que usa TODO el resto de la
 *  app para archivos — ver storage-manager.js y la Edge Function
 *  'r2-storage'). NO usa Supabase Storage: este proyecto no tiene ese
 *  bucket configurado, así que subir ahí fallaría (o quedaría fuera de
 *  lugar con el resto de los archivos, que sí están en R2). */
async function uploadImageToStorage(dataUrl, filename) {
  const blob = await dataUrlToBlob(dataUrl);
  const result = await storageManager.uploadImageFile(blob, 'config', filename);
  return result.url;
}

export function renderConfiguracion() {
  // 1) Información de la sesión y rol actual.
  const secUser = document.getElementById('sec-user');
  const secRole = document.getElementById('sec-role');
  if (secUser) secUser.textContent = state.session ? (state.session.user || '—') : '—';
  if (secRole) secRole.textContent = state.session ? (state.session.role || '—') : '—';

  // 2) Datos del negocio (tenant).
  const cfg = state.config || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('cfg-nombre-negocio', cfg.nombre_negocio);
  setVal('cfg-whatsapp', cfg.whatsapp_negocio);
  setVal('cfg-email', cfg.email_negocio);
  setVal('cfg-prefijo-factura', cfg.prefijo_factura || 'F-');
  setVal('cfg-mensaje-template', cfg.mensaje_whatsapp_template);

  // Previsualización de logo y QR ya guardados.
  const logoPrev = document.getElementById('cfg-logo-preview');
  if (logoPrev) { if (cfg.logo_url) { logoPrev.src = cfg.logo_url; logoPrev.style.display = 'block'; } else { logoPrev.style.display = 'none'; } }
  const qrPrev = document.getElementById('cfg-qr-preview');
  if (qrPrev) { if (cfg.qr_pago_url) { qrPrev.src = cfg.qr_pago_url; qrPrev.style.display = 'block'; } else { qrPrev.style.display = 'none'; } }

  // Solo el Administrador puede subir el QR de pago.
  // La opción de "Logo del negocio" queda oculta para todos los roles
  // (a pedido: se quitó esta opción de Configuración). El campo sigue
  // existiendo en el HTML por compatibilidad, pero nunca se muestra.
  const esAdmin = state.session && state.session.role === 'Administrador';
  const logoField = document.getElementById('cfg-logo-field');
  if (logoField) logoField.style.display = 'none';
  const qrField = document.getElementById('cfg-qr-field');
  if (qrField) qrField.style.display = esAdmin ? '' : 'none';

  // Panel de WhatsApp Límites
  const panelWhatsApp = document.getElementById('panel-whatsapp-limites');
  if (panelWhatsApp && window.renderWhatsAppLimites) {
    panelWhatsApp.innerHTML = window.renderWhatsAppLimites();
    panelWhatsApp.style.display = esAdmin ? '' : 'none';
  }

  // Panel de Notificaciones Push
  const panelPush = document.getElementById('panel-push-notifications');
  if (panelPush && window.renderPushPanel) {
    panelPush.innerHTML = window.renderPushPanel();
  }

  // Copias de seguridad: solo el Administrador.
  const panelBackup = document.getElementById('panel-backup');
  if (panelBackup) panelBackup.style.display = esAdmin ? '' : 'none';

  // Papelera de órdenes/clientes eliminados: solo el Administrador.
  const panelPapeleras = document.getElementById('panel-papeleras');
  if (panelPapeleras) panelPapeleras.style.display = esAdmin ? '' : 'none';
  if (esAdmin) renderPapeleras();

  // 3) Registro de actividad (bitácora): acceso exclusivo del Administrador.
  const panelBitacora = document.getElementById('panel-bitacora');
  if (panelBitacora) panelBitacora.style.display = esAdmin ? '' : 'none';
  if (esAdmin) renderActivityLog();
}

/* Lee un archivo de imagen y lo convierte a base64 (data URI). */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* Reduce la imagen a un tamaño razonable para no llenar la base de datos. */
async function shrinkImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width >= height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function onLogoFileChange(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const raw = await fileToDataURL(file);
  const small = await shrinkImage(raw, 256);
  const prev = document.getElementById('cfg-logo-preview');
  if (prev) { prev.src = small; prev.style.display = 'block'; }
  try {
    const publicUrl = await uploadImageToStorage(small, 'logo_' + Date.now() + '.png');
    state.config = { ...(state.config || {}), logo_url: publicUrl };
    showToast('Logo subido. Pulsa "Guardar datos del negocio" para conservarlo.');
  } catch (e) {
    console.error('Error al subir el logo:', e.message || e);
    showToast('No se pudo subir el logo. La imagen original no se guardó.');
  }
}

export async function onQrFileChange(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const raw = await fileToDataURL(file);
  const small = await shrinkImage(raw, 512);
  const prev = document.getElementById('cfg-qr-preview');
  if (prev) { prev.src = small; prev.style.display = 'block'; }
  try {
    const publicUrl = await uploadImageToStorage(small, 'qr-pago_' + Date.now() + '.png');
    state.config = { ...(state.config || {}), qr_pago_url: publicUrl };
    showToast('QR subido. Pulsa "Guardar datos del negocio" para conservarlo.');
  } catch (e) {
    console.error('Error al subir el QR:', e.message || e);
    showToast('No se pudo subir el QR. La imagen original no se guardó.');
  }
}

/* Aplica el logo del negocio (si existe) a las imágenes del sistema. */
export function applyBrandLogo() {
  const url = (state.config || {}).logo_url;
  if (!url) return;
  ['login-logo-img', 'side-logo-img', 'topbar-logo-img'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = url;
  });
}

/** Fecha ISO (YYYY-MM-DD) de hace N meses, para el valor por defecto del
 *  buscador de la bitácora (últimos 2 meses). */
function fechaMesesAtras(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pinta una lista de entradas de bitácora ya armada (se reutiliza tanto
 *  para la vista normal —últimos 100 registros— como para los resultados
 *  del buscador por fecha). */
function renderActivityLogList(lista) {
  const cont = document.getElementById('activity-log');
  if (!cont) return;
  cont.innerHTML = (lista || []).map(l =>
    '<div class="log-item"><span>' + escHtml(l.accion) + ' <strong>(' + escHtml(l.usuario) + ')</strong></span><span>' + escHtml(new Date(l.fecha).toLocaleString('es-MX')) + '</span></div>'
  ).join('') || '<div class="hint">Sin actividad registrada.</div>';
}

/** Vista normal de la bitácora: los últimos 100 registros ya cargados en
 *  memoria (ver loadAllData en db.js). */
function renderActivityLog() {
  // Prepara también el buscador por fecha con su rango por defecto
  // (últimos 2 meses) la primera vez que se abre el panel.
  const desdeEl = document.getElementById('bitacora-desde');
  const hastaEl = document.getElementById('bitacora-hasta');
  if (desdeEl && !desdeEl.value) desdeEl.value = fechaMesesAtras(2);
  if (hastaEl && !hastaEl.value) hastaEl.value = todayISO(0);
  renderActivityLogList((state.activityLog || []).slice(0, 100));
}

/** Busca en la bitácora por rango de fechas (hasta 2 meses atrás o el
 *  rango que el administrador elija), sin quedar atado a los últimos 100
 *  registros de la vista normal. */
export async function buscarActividadPorFecha() {
  const desde = (document.getElementById('bitacora-desde') || {}).value || '';
  const hasta = (document.getElementById('bitacora-hasta') || {}).value || '';
  if (!desde && !hasta) { showToast('Elige al menos una fecha para buscar'); return; }
  const resultados = await db.fetchActivityLogRange(desde, hasta);
  if (resultados === null) { showToast('No se pudo buscar en este momento (revisa tu conexión)'); return; }
  renderActivityLogList(resultados);
  showToast(resultados.length ? resultados.length + ' registro(s) encontrado(s)' : 'Sin actividad en ese rango de fechas');
}

/** Vuelve a la vista normal de la bitácora (últimos 100 registros) y
 *  restablece el buscador a su rango por defecto (últimos 2 meses). */
export function limpiarBusquedaBitacora() {
  const desdeEl = document.getElementById('bitacora-desde');
  const hastaEl = document.getElementById('bitacora-hasta');
  if (desdeEl) desdeEl.value = fechaMesesAtras(2);
  if (hastaEl) hastaEl.value = todayISO(0);
  renderActivityLogList((state.activityLog || []).slice(0, 100));
}

export async function saveConfiguracionNegocio() {
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const cfg = {
    nombre_negocio: getVal('cfg-nombre-negocio'),
    whatsapp_negocio: getVal('cfg-whatsapp'),
    email_negocio: getVal('cfg-email'),
    prefijo_factura: getVal('cfg-prefijo-factura') || 'F-',
    mensaje_whatsapp_template: getVal('cfg-mensaje-template')
  };
  // Incluye logo y QR si el usuario cargó imágenes nuevas (guardadas en state.config).
  if ((state.config || {}).logo_url) cfg.logo_url = state.config.logo_url;
  if ((state.config || {}).qr_pago_url) cfg.qr_pago_url = state.config.qr_pago_url;
  try {
    const res = await db.saveConfig(cfg);
    // Refleja los cambios en el estado en memoria.
    state.config = { ...(state.config || {}), ...cfg };
    applyBrandLogo();
    logActivity('Actualizó los datos del negocio');
    if (res && res.error) {
      showToast('Datos guardados localmente; se sincronizarán al reconectar.');
    } else {
      showToast('Datos del negocio guardados');
    }
  } catch (e) {
    console.error(e);
    showToast('Error al guardar los datos del negocio');
  }
}

/* ============================================================
   SINCRONIZACIÓN EN TIEMPO REAL DEL QR DE PAGO / LOGO (Fase 2)
   ============================================================
   Cuando el Administrador guarda el QR de pago (o el logo) desde
   cualquier dispositivo, la fila de "configuracion_tenant" cambia en
   Supabase. Esta suscripción de Realtime escucha ese cambio y lo
   propaga de inmediato a TODAS las sesiones abiertas del mismo tenant
   (otros usuarios, otros dispositivos, web o móvil), sin que nadie
   tenga que cerrar sesión ni recargar la página:
     - actualiza state.config en memoria,
     - refresca el logo en login/menú/topbar (applyBrandLogo),
     - refresca la previsualización si la pestaña Configuración está
       abierta,
     - refresca el QR mostrado en el modal de "Cobro con QR" si un
       cajero lo tiene abierto en ese momento.
   ============================================================ */
export function startRealtimeConfig() {
  if (realtimeConfigChannel) return; // Ya está activa
  const tenant = tenantId();
  if (!tenant || !supabase) return;

  try {
    realtimeConfigChannel = supabase
      .channel('config-tenant-' + tenant)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'configuracion_tenant',
          filter: `tenant_id=eq.${tenant}`
        },
        async (payload) => {
          const fila = payload.new && Object.keys(payload.new).length ? payload.new : null;
          if (fila) {
            // Actualización optimista e inmediata con la fila recibida.
            state.config = { ...(state.config || {}), ...fila };
          } else {
            // Por si el payload viene incompleto (ej. DELETE): recargar de la base.
            try {
              const { data } = await supabase.from('configuracion_tenant').select('*').eq('tenant_id', tenant).maybeSingle();
              if (data) state.config = data;
            } catch (e) { /* noop */ }
          }
          applyBrandLogo();
          const tabConfig = document.getElementById('tab-configuracion');
          if (tabConfig && tabConfig.classList.contains('active')) renderConfiguracion();
          if (window.refreshPagoQRSiAbierto) window.refreshPagoQRSiAbierto();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✓ Realtime configuración (QR/logo) activa');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Error en canal Realtime de configuración');
        }
      });
  } catch (e) {
    console.error('Error al iniciar Realtime de configuración:', e);
  }
}

export function stopRealtimeConfig() {
  if (realtimeConfigChannel) {
    supabase.removeChannel(realtimeConfigChannel);
    realtimeConfigChannel = null;
    console.log('✗ Realtime configuración (QR/logo) detenida');
  }
}

export async function recargarBitacora() {
  try {
    await db.loadAllData();
    renderActivityLog();
    showToast('Bitácora actualizada');
  } catch (e) { console.error(e); showToast('No se pudo actualizar la bitácora'); }
}

/** Renderiza los 2 paneles de Papelera (órdenes y clientes eliminados). */
export function renderPapeleras() {
  const contOrd = document.getElementById('papelera-ordenes');
  const contCli = document.getElementById('papelera-clientes');
  if (!contOrd || !contCli) return;

  const clienteNombre = (id) => {
    const c = state.clientes.find(x => x.id === id) || (state.clientesEliminados || []).find(x => x.id === id);
    return c ? c.nombre : '—';
  };

  const ordenesElim = state.ordenesEliminadas || [];
  contOrd.innerHTML = ordenesElim.length ? ordenesElim.slice().sort((a, b) => b.numero - a.numero).map(o =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap;">' +
      '<div><strong>#' + escHtml(o.numero) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) + ' · ' + escHtml(o.marca || '') + ' ' + escHtml(o.modelo || '') + '</div>' +
      '<div style="display:flex;gap:6px;"><button class="btn btn-ghost btn-sm" onclick="restaurarOrden(\'' + o.id + '\')">↺ Restaurar</button>' +
      '<button class="btn btn-danger btn-sm" onclick="eliminarOrdenPermanente(\'' + o.id + '\')">Eliminar definitivamente</button></div>' +
    '</div>'
  ).join('') : '<div class="hint">La papelera de órdenes está vacía.</div>';

  const clientesElim = state.clientesEliminados || [];
  contCli.innerHTML = clientesElim.length ? clientesElim.slice().map(c =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap;">' +
      '<div><strong>' + escHtml(c.nombre) + '</strong> · ' + escHtml(c.whatsapp || c.telefono || '—') + '</div>' +
      '<div style="display:flex;gap:6px;"><button class="btn btn-ghost btn-sm" onclick="restaurarCliente(\'' + c.id + '\')">↺ Restaurar</button>' +
      '<button class="btn btn-danger btn-sm" onclick="eliminarClientePermanente(\'' + c.id + '\')">Eliminar definitivamente</button></div>' +
    '</div>'
  ).join('') : '<div class="hint">La papelera de clientes está vacía.</div>';
}

Object.assign(window, { renderConfiguracion, saveConfiguracionNegocio, recargarBitacora, onLogoFileChange, onQrFileChange, applyBrandLogo, renderPapeleras, startRealtimeConfig, stopRealtimeConfig, buscarActividadPorFecha, limpiarBusquedaBitacora });
