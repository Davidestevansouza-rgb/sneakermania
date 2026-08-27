/* ============================================================
   MÓDULO: COPIAS DE SEGURIDAD — Sistema SeS
   ============================================================
   - Copia automática diaria: guarda una instantánea de los datos
     del negocio en el propio dispositivo (localStorage), una vez
     por día, conservando las últimas 7.
   - Exportar: descarga un archivo .json con todos los datos.
   - Restaurar: carga un archivo .json y reescribe los datos
     (en memoria, en la caché local y en la base de datos).
   Solo el Administrador debería usar exportar/restaurar (la UI se
   muestra solo para ese rol).
   ============================================================ */
import { state, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, logActivity } from '../ui.js';

const PREFIJO = 'ses_backup_';
const MAX_COPIAS = 7;

/** Arma el objeto de respaldo con los datos del negocio. */
function construirRespaldo() {
  return {
    _tipo: 'sistema-ses-backup',
    _version: 1,
    fecha: new Date().toISOString(),
    tenantId: state.session ? state.session.tenantId || null : null,
    datos: {
      clientes: state.clientes || [],
      clientesEliminados: state.clientesEliminados || [],
      ordenes: state.ordenes || [],
      ordenesEliminadas: state.ordenesEliminadas || [],
      inventario: state.inventario || [],
      gastos: state.gastos || [],
      config: state.config || {},
      nextOrderNum: state.nextOrderNum,
      nextInvoiceNum: state.nextInvoiceNum
    }
  };
}

/** Copia automática diaria en el dispositivo (una por día). */
export function autoDailyBackup() {
  try {
    if (!(state && state.session && state.session.loggedIn)) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const clave = PREFIJO + hoy;
    if (localStorage.getItem(clave)) return; // ya hay copia de hoy
    localStorage.setItem(clave, JSON.stringify(construirRespaldo()));
    // Conservar solo las últimas MAX_COPIAS.
    const claves = Object.keys(localStorage).filter(k => k.startsWith(PREFIJO)).sort();
    while (claves.length > MAX_COPIAS) {
      localStorage.removeItem(claves.shift());
    }
  } catch (e) {
    console.error('No se pudo crear la copia automática:', e);
  }
}

/** Descarga un archivo .json con toda la información (copia manual). */
export function exportBackup() {
  try {
    const blob = new Blob([JSON.stringify(construirRespaldo(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'copia-sistema-ses-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    logActivity('Descargó una copia de seguridad');
    showToast('Copia de seguridad descargada');
  } catch (e) {
    console.error(e);
    showToast('No se pudo generar la copia de seguridad');
  }
}

/** Maneja el archivo elegido en el input de restauración. */
export async function handleRestoreFile(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    const texto = await file.text();
    const obj = JSON.parse(texto);
    const datos = obj && obj.datos ? obj.datos : obj; // admite formato directo
    if (!datos || (!Array.isArray(datos.clientes) && !Array.isArray(datos.ordenes))) {
      showToast('El archivo no parece una copia válida del sistema');
      ev.target.value = '';
      return;
    }
    const total = (datos.clientes || []).length + (datos.ordenes || []).length +
      (datos.inventario || []).length + (datos.gastos || []).length;
    if (!confirm('Vas a RESTAURAR una copia de seguridad.\n\nEsto reemplazará los datos actuales por los del archivo (' + total + ' registros). ¿Continuar?')) {
      ev.target.value = '';
      return;
    }
    await aplicarRestauracion(datos);
    ev.target.value = '';
  } catch (e) {
    console.error(e);
    showToast('No se pudo leer el archivo de copia de seguridad');
    ev.target.value = '';
  }
}

/** Reescribe los datos en memoria, en la caché y en la base de datos. */
async function aplicarRestauracion(datos) {
  state.clientes = Array.isArray(datos.clientes) ? datos.clientes : [];
  state.clientesEliminados = Array.isArray(datos.clientesEliminados) ? datos.clientesEliminados : [];
  state.ordenes = Array.isArray(datos.ordenes) ? datos.ordenes : [];
  state.ordenesEliminadas = Array.isArray(datos.ordenesEliminadas) ? datos.ordenesEliminadas : [];
  state.inventario = Array.isArray(datos.inventario) ? datos.inventario : [];
  state.gastos = Array.isArray(datos.gastos) ? datos.gastos : [];
  if (datos.config) state.config = datos.config;
  if (datos.nextOrderNum) state.nextOrderNum = datos.nextOrderNum;
  if (datos.nextInvoiceNum) state.nextInvoiceNum = datos.nextInvoiceNum;

  await persist();

  // Sincroniza con la base de datos (best-effort; si falla se encola).
  try {
    for (const c of state.clientes) await db.saveCliente(c);
    for (const c of state.clientesEliminados) await db.saveCliente(c);
    for (const o of state.ordenes) await db.saveOrden(o);
    for (const o of state.ordenesEliminadas) await db.saveOrden(o);
    for (const i of state.inventario) await db.saveInventario(i);
    for (const g of state.gastos) await db.saveGasto(g);
    if (state.config && Object.keys(state.config).length) await db.saveConfig(state.config);
  } catch (e) {
    console.error('Algunos datos se sincronizarán al reconectar:', e);
  }

  logActivity('Restauró una copia de seguridad');
  if (window.renderAll) window.renderAll();
  showToast('Copia de seguridad restaurada');
}

Object.assign(window, { exportBackup, handleRestoreFile, autoDailyBackup });
