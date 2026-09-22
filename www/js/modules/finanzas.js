/* ============================================================
   MÓDULO: FINANZAS Y GASTOS
   ============================================================ */
import { state, todayISO, setDateValue, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtMoney, fmtDate, clienteNombre, chipPago, closeModal, openModalEl, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import './network-optimizer-20260907.js';
import './enhancements-20260906.js';
import './enhancements-safety-20260906.js';
import './enhancements-final-20260906.js';
import './item-photo-menu-fix-20260906.js';


let _finOrders = [];
let _finGastos = [];
let _finRangeKey = '';
let _finRenderSeq = 0;

function rangoFinanzas() {
  let desde = document.getElementById('fin-desde')?.value || '';
  let hasta = document.getElementById('fin-hasta')?.value || '';
  if (desde && !hasta) hasta = desde;
  if (hasta && !desde) desde = hasta;
  return { desde, hasta };
}

function limpiarFinanzasVista() {
  const kpi = document.getElementById('fin-kpi-grid');
  const ord = document.getElementById('finanzas-ordenes-table');
  const gas = document.getElementById('gastos-table');
  const status = document.getElementById('fin-range-status');
  if (kpi) kpi.innerHTML = '';
  if (ord) ord.innerHTML = '<tbody><tr><td class="hint">Elige una fecha o rango para cargar cobros.</td></tr></tbody>';
  if (gas) gas.innerHTML = '<tbody><tr><td class="hint">Elige una fecha o rango para cargar gastos.</td></tr></tbody>';
  if (status) status.textContent = 'Elige una fecha o rango para cargar los movimientos.';
}

export function setFinRange(preset) {
  const desde = document.getElementById('fin-desde');
  const hasta = document.getElementById('fin-hasta');
  if (!desde || !hasta) return;
  const hoy = todayISO(0);
  if (preset === 'hoy') {
    desde.value = hoy; hasta.value = hoy;
  } else if (preset === 'mes') {
    const d = new Date(hoy + 'T12:00:00');
    desde.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-01';
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    hasta.value = fin.getFullYear() + '-' + String(fin.getMonth() + 1).padStart(2,'0') + '-' + String(fin.getDate()).padStart(2,'0');
  } else if (preset === 'limpiar') {
    desde.value = ''; hasta.value = '';
  }
  _finRangeKey = '';
  void renderFinanzas();
}

export async function renderFinanzas() {
  const seq = ++_finRenderSeq;
  const r = rangoFinanzas();
  if (!r.desde || !r.hasta) {
    _finOrders = [];
    _finGastos = [];
    _finRangeKey = '';
    limpiarFinanzasVista();
    return;
  }

  const key = r.desde + '|' + r.hasta;
  const status = document.getElementById('fin-range-status');
  if (_finRangeKey !== key && navigator.onLine) {
    if (status) status.textContent = 'Cargando movimientos del rango…';
    const res = await db.loadFinancialRange(r.desde, r.hasta);
    if (seq !== _finRenderSeq) return;
    if (!res || res.error) {
      if (status) status.textContent = 'No se pudo cargar el rango. Revisa la conexión.';
      return;
    }
    _finOrders = res.orders || [];
    _finGastos = res.gastos || [];
    _finRangeKey = key;
  }

  if (status) status.textContent = 'Mostrando ' + fmtDate(r.desde) + (r.hasta !== r.desde ? ' — ' + fmtDate(r.hasta) : '') + '.';

  const totalCobrado = _finOrders.reduce((s, o) => s + Number(o.pagado || 0), 0);
  const totalQR = _finOrders.reduce((s, o) => s + Number(o.pagadoQR || 0), 0);
  const totalEfectivo = _finOrders.reduce((s, o) => s + Number(o.pagadoEfectivo || 0), 0);
  const totalPendiente = _finOrders.reduce((s, o) => { const vf = Number(o.precio) - Number(o.descuento || 0); return s + Math.max(vf - Number(o.pagado || 0), 0); }, 0);
  const totalDescuentos = _finOrders.reduce((s, o) => s + Number(o.descuento || 0), 0);
  const ventaBruta = _finOrders.reduce((s, o) => s + Number(o.precio || 0), 0);
  const gastosTotal = _finGastos.reduce((s, g) => s + Number(g.monto || 0), 0);
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
    _finOrders.slice().sort((a, b) => b.numero - a.numero).map(o => {
      const vf = Number(o.precio) - Number(o.descuento || 0);
      const pend = Math.max(vf - Number(o.pagado || 0), 0);
      return '<tr><td class="mono" data-label="Orden">#' + escHtml(o.numero) + '</td><td data-label="Cliente">' + escHtml(clienteNombre(o.clienteId)) + '</td><td data-label="Precio">' + fmtMoney(o.precio) + '</td><td data-label="Desc.">' + fmtMoney(o.descuento || 0) + '</td>' +
      '<td data-label="Valor final">' + fmtMoney(vf) + '</td><td data-label="Pagado">' + fmtMoney(o.pagado) + '</td><td data-label="Pendiente">' + fmtMoney(pend) + '</td><td data-label="Método">' + escHtml(o.metodoPago || '—') + '</td><td data-label="Estado">' + chipPago(o.estadoPago) + '</td></tr>';
    }).join('') + '</tbody>';

  document.getElementById('gastos-table').innerHTML = '<thead><tr><th>Categoría</th><th>Monto</th><th>Fecha</th><th>Descripción</th><th></th></tr></thead><tbody>' +
    _finGastos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(g =>
      '<tr><td data-label="Categoría">' + escHtml(g.categoria) + '</td><td data-label="Monto">' + fmtMoney(g.monto) + '</td><td data-label="Fecha">' + fmtDate(g.fecha) + '</td><td data-label="Descripción">' + escHtml(g.descripcion || '—') + '</td>' +
      '<td data-label="" style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="openGastoModal(\'' + escAttr(g.id) + '\')">Editar</button> <button class="btn btn-danger btn-sm" onclick="deleteGasto(\'' + escAttr(g.id) + '\')">Eliminar</button></td></tr>'
    ).join('') + '</tbody>';
}

export function openGastoModal(id) {
  document.getElementById('gasto-id').value = id || '';
  document.getElementById('gasto-modal-title').textContent = id ? 'Editar gasto' : 'Nuevo gasto';
  const g = id ? (_finGastos.find(x => x.id === id) || state.gastos.find(x => x.id === id)) : { categoria: 'Alquiler', monto: '', fecha: todayISO(0), descripcion: '' };
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
  const restore = lockBtn(btn);
  let target;
  try {
    if (id) {
      target = state.gastos.find(x => x.id === id);
      Object.assign(target, data);
      logActivity('Editó gasto de ' + data.categoria + ' por ' + fmtMoney(data.monto));
    } else {
      data.id = crypto.randomUUID();
      state.gastos.push(data);
      target = data;
      logActivity('Registró gasto de ' + data.categoria + ' por ' + fmtMoney(data.monto));
    }
    await persist();
    await db.saveGasto(target);
    closeModal('modal-gasto');
    _finRangeKey = '';
    void renderFinanzas();
    showToast(id ? 'Gasto actualizado' : 'Gasto registrado');
  } catch (e) { console.error(e); showToast('Error al guardar el gasto'); }
  finally { restore(); }
}

export async function deleteGasto(id) {
  const g = _finGastos.find(x => x.id === id) || state.gastos.find(x => x.id === id);
  if (!g) return;
  if (!confirm('¿Eliminar el gasto de ' + g.categoria + ' por ' + fmtMoney(g.monto) + '?')) return;
  state.gastos = state.gastos.filter(x => x.id !== id);
  logActivity('Eliminó gasto de ' + g.categoria + ' por ' + fmtMoney(g.monto));
  try {
    await persist();
    await db.deleteGasto(id);
    _finRangeKey = '';
    void renderFinanzas();
    showToast('Gasto eliminado');
  } catch (e) { console.error(e); showToast('Error al eliminar el gasto'); }
}

Object.assign(window, { renderFinanzas, setFinRange, openGastoModal, saveGasto, deleteGasto });
