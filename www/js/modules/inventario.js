/* ============================================================
   MÓDULO: INVENTARIO
   ============================================================ */
import { state, todayISO, setDateValue, persist, esEmpleado, esSupervisor, esAdmin } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtMoney, fmtDate, closeModal, openModalEl, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

export function renderInventario() {
  const esAdmin = state.session && state.session.role === 'Administrador';
  const bajo = state.inventario.filter(i => Number(i.cantidad) <= Number(i.stockMinimo)).length;
  document.getElementById('inv-sub').textContent = state.inventario.length + ' productos · ' + bajo + ' con stock bajo';
  document.getElementById('inventario-table').innerHTML = '<thead><tr><th>Nombre</th><th>Categoría</th><th>Proveedor</th><th>Cantidad</th><th>Stock mín.</th><th>Precio compra</th><th>Vencimiento</th><th></th></tr></thead><tbody>' +
    state.inventario.map(i => {
      const low = Number(i.cantidad) <= Number(i.stockMinimo);
      return '<tr' + (low ? ' style="background:rgba(201,122,43,0.08);"' : '') + '><td data-label=""><strong>' + escHtml(i.nombre) + '</strong></td><td data-label="Categoría">' + escHtml(i.categoria) + '</td><td data-label="Proveedor">' + escHtml(i.proveedor || '—') + '</td>' +
      '<td data-label="Cantidad">' + escHtml(i.cantidad) + (low ? ' ⚠' : '') + '</td><td data-label="Stock mín.">' + escHtml(i.stockMinimo) + '</td><td data-label="Precio compra">' + fmtMoney(i.precioCompra) + '</td><td data-label="Vencimiento">' + (i.fechaVencimiento ? fmtDate(i.fechaVencimiento) : '—') + '</td>' +
      '<td data-label="" style="white-space:nowrap;">' + (esEmpleado() ? '<button class="btn btn-ghost btn-sm" onclick="openInventarioModal(\'' + escAttr(i.id) + '\', true)">Ajustar stock</button>' : '<button class="btn btn-ghost btn-sm" onclick="openInventarioModal(\'' + escAttr(i.id) + '\')">Editar</button>') +
      (esAdmin ? ' <button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteInventario(\'' + escAttr(i.id) + '\')">Eliminar</button>' : '') +
      '</td></tr>';
    }).join('') + '</tbody>';
}

export function openInventarioModal(id, soloCantidad) {
  // El Empleado solo puede ajustar la cantidad — nunca crear productos ni
  // editar otros campos (precio, proveedor, vencimiento, etc.).
  const modoSoloCantidad = esEmpleado() || soloCantidad === true;
  const permitidoCrear = !esEmpleado();
  document.getElementById('inv-id').value = id || '';
  document.getElementById('inv-modal-title').textContent = id ? (modoSoloCantidad ? 'Ajustar cantidad' : 'Editar producto') : 'Nuevo producto';
  const i = id ? state.inventario.find(x => x.id === id) : { nombre: '', categoria: 'Producto', proveedor: '', cantidad: 0, stockMinimo: 0, precioCompra: 0, fechaCompra: todayISO(0), fechaVencimiento: '' };
  document.getElementById('inv-nombre').value = i.nombre;
  document.getElementById('inv-categoria').value = i.categoria;
  document.getElementById('inv-proveedor').value = i.proveedor;
  document.getElementById('inv-cantidad').value = i.cantidad;
  document.getElementById('inv-stock-min').value = i.stockMinimo;
  document.getElementById('inv-precio').value = i.precioCompra;
  setDateValue('inv-fecha-compra', i.fechaCompra);
  setDateValue('inv-fecha-venc', i.fechaVencimiento);
  // Bloquear campos según permiso:
  //   - Empleado: solo Cantidad. Nadie crea producto desde aquí en modo Empleado.
  //   - El resto: editable completo.
  const bloquear = modoSoloCantidad;
  ['inv-nombre', 'inv-categoria', 'inv-proveedor', 'inv-stock-min', 'inv-precio', 'inv-fecha-compra', 'inv-fecha-venc'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.disabled = bloquear;
  });
  document.getElementById('inv-cantidad').disabled = false; // cantidad SIEMPRE editable
  // Si el Empleado intenta crear (sin id), abortar — no debería llegar aquí
  // (la tabla no le muestra el botón "Nuevo"), pero por seguridad:
  if (!id && esEmpleado()) {
    showToast('No tienes permiso para crear productos. Pídelo a un Supervisor o Administrador.');
    return;
  }
  openModalEl('modal-inventario');
}

export async function saveInventario(btn) {
  // Seguridad: el Empleado nunca crea productos (solo ajusta cantidad de existentes).
  const id = document.getElementById('inv-id').value;
  if (!id && esEmpleado()) { showToast('No tienes permiso para crear productos'); return; }
  const data = {
    nombre: document.getElementById('inv-nombre').value.trim(),
    categoria: document.getElementById('inv-categoria').value,
    proveedor: document.getElementById('inv-proveedor').value.trim(),
    cantidad: Number(document.getElementById('inv-cantidad').value) || 0,
    stockMinimo: Number(document.getElementById('inv-stock-min').value) || 0,
    precioCompra: Number(document.getElementById('inv-precio').value) || 0,
    fechaCompra: document.getElementById('inv-fecha-compra').value,
    fechaVencimiento: document.getElementById('inv-fecha-venc').value
  };
  if (!data.nombre) { showToast('El nombre es obligatorio'); return; }
  if (!data.proveedor) { showToast('El proveedor es obligatorio'); return; }
  if (document.getElementById('inv-cantidad').value === '') { showToast('La cantidad es obligatoria'); return; }
  if (document.getElementById('inv-stock-min').value === '') { showToast('El stock mínimo es obligatorio'); return; }
  if (!data.precioCompra || data.precioCompra <= 0) { showToast('El precio de compra es obligatorio'); return; }
  const restore = lockBtn(btn);   // evita doble guardado
  let target;
  try {
    if (id) {
      target = state.inventario.find(x => x.id === id);
      Object.assign(target, data);
      logActivity('Editó producto ' + data.nombre);
    } else {
      // ID con UUID en lugar de Date.now().
      data.id = crypto.randomUUID();
      state.inventario.push(data);
      target = data;
      logActivity('Agregó producto ' + data.nombre);
    }
    await persist();
    await db.saveInventario(target);
    closeModal('modal-inventario');
    renderInventario();
    showToast('Producto guardado');
  } catch (e) { console.error(e); showToast('Error al guardar el producto'); }
  finally { restore(); }
}

/** Elimina un producto del inventario (solo Administrador, con confirmación). */
export async function deleteInventario(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar productos'); return; }
  const i = state.inventario.find(x => x.id === id);
  if (!i) return;
  if (!confirm('¿Eliminar el producto "' + i.nombre + '"? Esta acción no se puede deshacer.')) return;
  state.inventario = state.inventario.filter(x => x.id !== id);
  logActivity('Eliminó producto ' + i.nombre);
  try {
    await persist();
    await db.deleteInventario(id);
    renderInventario();
    showToast('Producto eliminado');
  } catch (e) { console.error(e); showToast('Error al eliminar el producto'); }
}

Object.assign(window, { renderInventario, openInventarioModal, saveInventario, deleteInventario });
