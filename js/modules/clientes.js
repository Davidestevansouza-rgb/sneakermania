/* ============================================================
   CLIENTES — Sistema SeS
   ============================================================ */
import { state, persist } from '../state.js';
import { showToast, logActivity, clienteById, clienteNombre, openModalEl, closeModal, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as db from '../db.js';

export function renderClientes(filter = '') {
  document.getElementById('clientes-sub').textContent = state.clientes.length + ' clientes registrados';
  const esAdmin = state.session && state.session.role === 'Administrador';
  const f = filter.toLowerCase();
  // Buscador de fechas (junto a "+ Nuevo cliente"): filtra por fecha de
  // alta del cliente (creadoEn) usando el rango Desde/Hasta del panel.
  const fDesde = document.getElementById('cliente-fecha-desde');
  const fHasta = document.getElementById('cliente-fecha-hasta');
  const desde = fDesde ? fDesde.value : '';
  const hasta = fHasta ? fHasta.value : '';
  let rows = state.clientes.filter(c => !f || c.nombre.toLowerCase().includes(f) || (c.telefono || '').includes(f));
  if (desde || hasta) {
    rows = rows.filter(c => {
      if (!c.creadoEn) return false;
      const fecha = c.creadoEn.slice(0, 10); // ISO -> "YYYY-MM-DD"
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      return true;
    });
  }
  actualizarBotonFiltroFechaCliente(!!(desde || hasta));
  const html = '<thead><tr><th>Nombre</th><th>Teléfono</th><th>WhatsApp</th><th>Dirección</th><th>Servicios</th><th></th></tr></thead><tbody>' +
    rows.map(c => {
      const historial = state.ordenes.filter(o => o.clienteId === c.id).length;
      return '<tr><td data-label=""><strong>' + escHtml(c.nombre) + '</strong>' + (c.observaciones ? '<div class="hint">' + escHtml(c.observaciones) + '</div>' : '') + '</td>' +
        '<td data-label="Teléfono">' + escHtml(c.telefono) + '</td><td data-label="WhatsApp">' + escHtml(c.whatsapp) + '</td><td data-label="Dirección">' + escHtml(c.direccion) + '</td>' +
        '<td data-label="Servicios">' + historial + ' órdenes</td>' +
        '<td data-label="" style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="openClienteModal(\'' + escAttr(c.id) + '\')">Editar</button> ' +
        '<button class="btn btn-ghost btn-sm" onclick="viewClienteHistorial(\'' + escAttr(c.id) + '\')">Historial</button>' +
        (esAdmin ? ' <button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteCliente(\'' + escAttr(c.id) + '\')">Eliminar</button>' : '') +
        '</td></tr>';
    }).join('') + '</tbody>';
  document.getElementById('clientes-table').innerHTML = html || '<tr><td>Sin resultados</td></tr>';
}

export function openClienteModal(id) {
  document.getElementById('cliente-id').value = id || '';
  document.getElementById('cliente-modal-title').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
  const c = id ? clienteById(id) : { nombre: '', telefono: '', whatsapp: '', direccion: '', observaciones: '' };
  document.getElementById('cliente-nombre').value = c.nombre;
  document.getElementById('cliente-telefono').value = c.telefono;
  document.getElementById('cliente-whatsapp').value = c.whatsapp;
  document.getElementById('cliente-direccion').value = c.direccion;
  document.getElementById('cliente-observaciones').value = c.observaciones;
  openModalEl('modal-cliente');
}

export async function saveCliente(btn) {
  const id = document.getElementById('cliente-id').value;
  const data = {
    nombre: document.getElementById('cliente-nombre').value.trim(),
    telefono: document.getElementById('cliente-telefono').value.trim(),
    whatsapp: document.getElementById('cliente-whatsapp').value.trim(),
    direccion: document.getElementById('cliente-direccion').value.trim(),
    observaciones: document.getElementById('cliente-observaciones').value.trim()
  };
  if (!data.nombre) { showToast('Falta completar: Nombre'); document.getElementById('cliente-nombre').focus(); return; }
  if (!data.whatsapp) { showToast('Falta completar: Número de WhatsApp'); document.getElementById('cliente-whatsapp').focus(); return; }
  const restore = lockBtn(btn);   // evita doble guardado
  try {
    let registro;
    if (id) {
      registro = clienteById(id);
      Object.assign(registro, data);
      logActivity('Editó cliente ' + data.nombre);
    } else {
      data.id = crypto.randomUUID();   // UUID real (corrige el uso de Date.now())
      state.clientes.push(data);
      registro = data;
      logActivity('Registró nuevo cliente ' + data.nombre);
    }
    await persist();
    await db.saveCliente(registro);
    closeModal('modal-cliente');
    renderClientes();
    showToast('Cliente guardado');
  } catch (e) { console.error(e); showToast('Error al guardar el cliente'); }
  finally { restore(); }
}

/** Elimina un cliente (solo Administrador, con confirmación previa). */
/** Elimina un cliente (solo Administrador). No se borra de la base de
 *  datos: pasa a la Papelera (Configuración → Papelera de clientes) hasta
 *  que se elimine definitivamente desde ahí. */
export async function deleteCliente(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar clientes'); return; }
  const c = clienteById(id);
  if (!c) return;
  // No se puede eliminar un cliente con órdenes asociadas (restricción de la base de datos).
  const nOrd = state.ordenes.filter(o => o.clienteId === id).length;
  if (nOrd > 0) {
    alert('No se puede eliminar a "' + c.nombre + '" porque tiene ' + nOrd + ' orden(es) asociada(s).\n\nPrimero elimina sus órdenes en la pestaña Órdenes y vuelve a intentarlo.');
    return;
  }
  if (!confirm('¿Enviar a la papelera al cliente "' + c.nombre + '"?\n\nPodrás restaurarlo desde Configuración → Papelera de clientes.')) return;
  const backup = state.clientes.slice();
  c.eliminada = true;
  state.clientes = state.clientes.filter(x => x.id !== id);
  if (!Array.isArray(state.clientesEliminados)) state.clientesEliminados = [];
  state.clientesEliminados.push(c);
  renderClientes();
  const res = await db.saveCliente(c);
  if (res && res.error && !res.queued) {
    // Falló en el servidor (error permanente): restaurar el cliente en la vista.
    c.eliminada = false;
    state.clientes = backup;
    state.clientesEliminados = state.clientesEliminados.filter(x => x.id !== id);
    renderClientes();
    showToast('No se pudo enviar el cliente a la papelera: ' + (res.error.message || 'error del servidor'));
    return;
  }
  logActivity('Envió a la papelera al cliente ' + c.nombre);
  await persist();
  showToast('Cliente enviado a la papelera');
}

/** Restaura un cliente desde la Papelera (solo Administrador). */
export async function restaurarCliente(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede restaurar clientes'); return; }
  const c = (state.clientesEliminados || []).find(x => x.id === id);
  if (!c) return;
  c.eliminada = false;
  state.clientesEliminados = state.clientesEliminados.filter(x => x.id !== id);
  state.clientes.push(c);
  renderClientes();
  await persist();
  await db.saveCliente(c);
  logActivity('Restauró desde la papelera al cliente ' + c.nombre);
  showToast('Cliente "' + c.nombre + '" restaurado');
  if (window.renderPapeleras) window.renderPapeleras();
}

/** Elimina un cliente DEFINITIVAMENTE desde la Papelera (no se puede deshacer). */
export async function eliminarClientePermanente(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar definitivamente'); return; }
  const c = (state.clientesEliminados || []).find(x => x.id === id);
  if (!c) return;
  if (!confirm('¿Eliminar DEFINITIVAMENTE a "' + c.nombre + '"?\n\nEsta acción NO se puede deshacer — se perderá para siempre.')) return;
  const backup = state.clientesEliminados.slice();
  state.clientesEliminados = state.clientesEliminados.filter(x => x.id !== id);
  if (window.renderPapeleras) window.renderPapeleras();
  const res = await db.deleteCliente(id);
  if (res && res.error && !res.queued) {
    state.clientesEliminados = backup;
    if (window.renderPapeleras) window.renderPapeleras();
    showToast('No se pudo eliminar definitivamente: ' + (res.error.message || 'error del servidor'));
    return;
  }
  logActivity('Eliminó definitivamente al cliente ' + c.nombre);
  showToast('Cliente eliminado definitivamente');
}

export function viewClienteHistorial(id) {
  window.switchTab('ordenes');
  const nombre = clienteNombre(id);
  // El campo real de búsqueda de órdenes está oculto; el visible es
  // "global-search". Antes solo se llenaba el oculto, así que al volver del
  // historial la caja visible quedaba vacía pero el filtro seguía activo y el
  // buscador parecía "trabado". Ahora se sincronizan ambos y se limpian los
  // demás filtros (estado / prioridad / pago / fechas) para no arrastrar
  // filtros viejos que dejaran la lista incompleta.
  const filtroTexto = document.getElementById('filtro-orden-texto');
  if (filtroTexto) filtroTexto.value = nombre;
  const globalSearch = document.getElementById('global-search');
  if (globalSearch) globalSearch.value = nombre;
  ['filtro-estado', 'filtro-prioridad', 'filtro-pago'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  ['orden-fecha-desde', 'orden-fecha-hasta'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  window.renderOrdenes();
}

/* ---------- Buscador de fechas (Clientes) ----------
   Panel flotante junto a "+ Nuevo cliente" para filtrar la tabla por
   fecha de alta del cliente (Desde/Hasta). */
export function toggleFiltroFechaCliente(ev) {
  window.toggleDropdown('cliente-fecha-dropdown', ev, 'date-filter-dropdown');
}
export function aplicarFiltroFechaCliente() {
  renderClientes(document.querySelector('#tab-clientes .toolbar input.grow')?.value || '');
  window.closeDropdown('cliente-fecha-dropdown');
}
export function limpiarFiltroFechaCliente() {
  document.getElementById('cliente-fecha-desde').value = '';
  document.getElementById('cliente-fecha-hasta').value = '';
  renderClientes(document.querySelector('#tab-clientes .toolbar input.grow')?.value || '');
  window.closeDropdown('cliente-fecha-dropdown');
}
function actualizarBotonFiltroFechaCliente(activo) {
  const btn = document.getElementById('btn-filtro-fecha-cliente');
  if (btn) btn.classList.toggle('active', activo);
}

Object.assign(window, {
  renderClientes, openClienteModal, saveCliente, deleteCliente, viewClienteHistorial, restaurarCliente, eliminarClientePermanente,
  toggleFiltroFechaCliente, aplicarFiltroFechaCliente, limpiarFiltroFechaCliente
});
