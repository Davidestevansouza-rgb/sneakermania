/* ============================================================
   MÓDULO: FINANZAS Y GASTOS
   ============================================================ */
import { state, todayISO, setDateValue, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtMoney, fmtDate, clienteNombre, chipPago, closeModal, openModalEl, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

export function renderFinanzas() {
  const totalCobrado = state.ordenes.reduce((s, o) => s + Number(o.pagado || 0), 0);
  const totalQR = state.ordenes.reduce((s, o) => s + Number(o.pagadoQR || 0), 0);
  const totalEfectivo = state.ordenes.reduce((s, o) => s + Number(o.pagadoEfectivo || 0), 0);
  const totalPendiente = state.ordenes.reduce((s, o) => { const vf = Number(o.precio) - Number(o.descuento || 0); return s + Math.max(vf - Number(o.pagado || 0), 0); }, 0);
  // Descuentos otorgados en las órdenes: se reportan aquí para que las
  // cuentas cuadren (precio bruto − descuentos = lo realmente cobrable).
  const totalDescuentos = state.ordenes.reduce((s, o) => s + Number(o.descuento || 0), 0);
  const ventaBruta = state.ordenes.reduce((s, o) => s + Number(o.precio || 0), 0);
  const gastosTotal = state.gastos.reduce((s, g) => s + Number(g.monto || 0), 0);
  const utilidadNeta = totalCobrado - gastosTotal;
  document.getElementById('fin-kpi-grid').innerHTML = [
    { label: 'Venta bruta (sin desc.)', value: fmtMoney(ventaBruta) },
    { label: 'Descuentos otorgados', value: fmtMoney(totalDescuentos) },
    { label: 'Total cobrado', value: fmtMoney(totalCobrado) },
    { label: 'Cobrado por QR', value: fmtMoney(totalQR) },
    { label: 'Cobrado en efectivo', value: fmtMoney(totalEfectivo) },
    { label: 'Total pendiente', value: fmtMoney(totalPendiente) },
    { label: 'Gastos totales', value: fmtMoney(gastosTotal) },
    { label: 'Utilidad neta', value: fmtMoney(utilidadNeta) }
  ].map(k => '<div class="kpi-card"><div class="kpi-label">' + escHtml(k.label) + '</div><div class="kpi-value">' + k.value + '</div></div>').join('');

  document.getElementById('finanzas-ordenes-table').innerHTML = '<thead><tr><th>Orden</th><th>Cliente</th><th>Precio</th><th>Desc.</th><th>Valor final</th><th>Pagado</th><th>Pendiente</th><th>Método</th><th>Estado</th></tr></thead><tbody>' +
    state.ordenes.slice().sort((a, b) => b.numero - a.numero).map(o => {
      const vf = Number(o.precio) - Number(o.descuento || 0);
      const pend = Math.max(vf - Number(o.pagado || 0), 0);
      return '<tr><td class="mono" data-label="Orden">#' + escHtml(o.numero) + '</td><td data-label="Cliente">' + escHtml(clienteNombre(o.clienteId)) + '</td><td data-label="Precio">' + fmtMoney(o.precio) + '</td><td data-label="Desc.">' + fmtMoney(o.descuento || 0) + '</td>' +
      '<td data-label="Valor final">' + fmtMoney(vf) + '</td><td data-label="Pagado">' + fmtMoney(o.pagado) + '</td><td data-label="Pendiente">' + fmtMoney(pend) + '</td><td data-label="Método">' + escHtml(o.metodoPago || '—') + '</td><td data-label="Estado">' + chipPago(o.estadoPago) + '</td></tr>';
    }).join('') + '</tbody>';

  document.getElementById('gastos-table').innerHTML = '<thead><tr><th>Categoría</th><th>Monto</th><th>Fecha</th><th>Descripción</th><th></th></tr></thead><tbody>' +
    state.gastos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(g =>
      '<tr><td data-label="Categoría">' + escHtml(g.categoria) + '</td><td data-label="Monto">' + fmtMoney(g.monto) + '</td><td data-label="Fecha">' + fmtDate(g.fecha) + '</td><td data-label="Descripción">' + escHtml(g.descripcion || '—') + '</td>' +
      '<td data-label="" style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="openGastoModal(\'' + escAttr(g.id) + '\')">Editar</button> <button class="btn btn-danger btn-sm" onclick="deleteGasto(\'' + escAttr(g.id) + '\')">Eliminar</button></td></tr>'
    ).join('') + '</tbody>';
}

export function openGastoModal(id) {
  document.getElementById('gasto-id').value = id || '';
  document.getElementById('gasto-modal-title').textContent = id ? 'Editar gasto' : 'Nuevo gasto';
  const g = id ? state.gastos.find(x => x.id === id) : { categoria: 'Alquiler', monto: '', fecha: todayISO(0), descripcion: '' };
  document.getElementById('gasto-categoria').value = g.categoria;
  document.getElementById('gasto-monto').value = g.monto;
  setDateValue('gasto-fecha', g.fecha);
  document.getElementById('gasto-descripcion').value = g.descripcion;
  openModalEl('modal-gasto');
}

export async function saveGasto(btn) {
  const id = document.getElementById('gasto-id').value;
  const data = {
    categoria: document.getElementById('gasto-categoria').value,
    monto: Number(document.getElementById('gasto-monto').value) || 0,
    fecha: document.getElementById('gasto-fecha').value,
    descripcion: document.getElementById('gasto-descripcion').value.trim()
  };
  if (!data.monto || data.monto <= 0) { showToast('Debes indicar el monto del gasto'); return; }
  const restore = lockBtn(btn);   // evita doble guardado
  let target;
  try {
    if (id) {
      target = state.gastos.find(x => x.id === id);
      Object.assign(target, data);
      logActivity('Editó gasto de ' + data.categoria + ' por ' + fmtMoney(data.monto));
    } else {
      // ID con UUID en lugar de Date.now().
      data.id = crypto.randomUUID();
      state.gastos.push(data);
      target = data;
      logActivity('Registró gasto de ' + data.categoria + ' por ' + fmtMoney(data.monto));
    }
    await persist();
    await db.saveGasto(target);
    closeModal('modal-gasto');
    renderFinanzas();
    showToast(id ? 'Gasto actualizado' : 'Gasto registrado');
  } catch (e) { console.error(e); showToast('Error al guardar el gasto'); }
  finally { restore(); }
}

export async function deleteGasto(id) {
  const g = state.gastos.find(x => x.id === id);
  if (!g) return;
  if (!confirm('¿Eliminar el gasto de ' + g.categoria + ' por ' + fmtMoney(g.monto) + '?')) return;
  state.gastos = state.gastos.filter(x => x.id !== id);
  logActivity('Eliminó gasto de ' + g.categoria + ' por ' + fmtMoney(g.monto));
  try {
    await persist();
    await db.deleteGasto(id);
    renderFinanzas();
    showToast('Gasto eliminado');
  } catch (e) { console.error(e); showToast('Error al eliminar el gasto'); }
}

Object.assign(window, { renderFinanzas, openGastoModal, saveGasto, deleteGasto });
