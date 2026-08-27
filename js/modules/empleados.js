/* ============================================================
   MÓDULO: EMPLEADOS (gestión de usuarios del tenant)
   Solo accesible para roles Administrador / Supervisor.
   Administra filas de la tabla `users` (nombre, rol, estado).

   NOTA (Fase 1): la creación de la CUENTA DE ACCESO (login) del
   empleado requiere la service_role key y se implementará en Fase 2
   mediante una Edge Function. Aquí se puede editar/activar/desactivar
   empleados existentes; el alta intentará insertar la fila y, si la
   restricción de clave foránea con auth.users lo impide, se informará
   al usuario de que la cuenta debe habilitarse en Fase 2.
   ============================================================ */
import { state } from '../state.js';
import * as db from '../db.js';
import { showToast, closeModal, openModalEl, logActivity } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

// Cache local de la lista de empleados cargada desde la base.
// La reutilizan Órdenes (para asignar responsable por par) y
// Producción (para el selector de empleado).
let empleadosCache = [];

/** Devuelve la caché de empleados activos ya cargada (sin ir a la base). */
export function getEmpleadosCache() {
  return empleadosCache.filter(u => u.activo !== false);
}

/** Carga la caché de empleados si todavía está vacía (lazy). */
export async function ensureEmpleadosCache() {
  if (empleadosCache.length) return empleadosCache;
  try {
    empleadosCache = await db.listUsers();
  } catch (e) {
    console.error(e);
  }
  return empleadosCache;
}

export async function renderEmpleados() {
  const sub = document.getElementById('empleados-sub');
  const table = document.getElementById('empleados-table');
  if (!table) return;
  table.innerHTML = '<tbody><tr><td class="hint" style="padding:14px;">Cargando empleados…</td></tr></tbody>';
  try {
    empleadosCache = await db.listUsers();
  } catch (e) {
    console.error(e);
    empleadosCache = [];
  }
  const activos = empleadosCache.filter(u => u.activo !== false).length;
  if (sub) sub.textContent = empleadosCache.length + ' usuarios · ' + activos + ' activos';
  table.innerHTML = '<thead><tr><th>Nombre</th><th>Rol</th><th>Correo</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (empleadosCache.length ? empleadosCache.map(u => {
      const estado = u.activo !== false
        ? '<span class="chip" style="background:var(--green-tint);color:var(--green);">Activo</span>'
        : '<span class="chip" style="background:var(--line);color:var(--muted);">Inactivo</span>';
      const toggleLabel = u.activo !== false ? 'Desactivar' : 'Activar';
      return '<tr><td data-label="Nombre"><strong>' + escHtml(u.nombre) + '</strong></td>' +
        '<td data-label="Rol">' + escHtml(u.rol) + '</td>' +
        '<td data-label="Correo">' + escHtml(u.email || '—') + '</td>' +
        '<td data-label="Estado">' + estado + '</td>' +
        '<td data-label="" style="white-space:nowrap;">' +
          '<button class="btn btn-ghost btn-sm" onclick="openEmpleadoModal(\'' + escAttr(u.id) + '\')">Editar</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="toggleEmpleadoActivo(\'' + escAttr(u.id) + '\')">' + toggleLabel + '</button>' +
        '</td></tr>';
    }).join('') : '<tr><td class="hint" style="padding:14px;">No hay empleados registrados todavía.</td></tr>') +
    '</tbody>';
}

export function openEmpleadoModal(id) {
  const u = id ? empleadosCache.find(x => x.id === id) : null;
  document.getElementById('emp-id').value = id || '';
  document.getElementById('emp-modal-title').textContent = id ? 'Editar empleado' : 'Nuevo empleado';
  document.getElementById('emp-nombre').value = u ? u.nombre : '';
  document.getElementById('emp-email').value = u ? (u.email || '') : '';
  document.getElementById('emp-rol').value = u ? u.rol : 'Empleado';
  document.getElementById('emp-activo').value = (u && u.activo === false) ? 'false' : 'true';
  // El correo no se puede cambiar al editar (identifica la cuenta de acceso).
  document.getElementById('emp-email').disabled = !!id;
  // Aviso sobre la limitación de Fase 1 al crear.
  const nota = document.getElementById('emp-nota-fase2');
  if (nota) nota.style.display = id ? 'none' : 'block';
  openModalEl('modal-empleado');
}

export async function saveEmpleado() {
  const id = document.getElementById('emp-id').value;
  const nombre = document.getElementById('emp-nombre').value.trim();
  const email = document.getElementById('emp-email').value.trim();
  const rol = document.getElementById('emp-rol').value;
  const activo = document.getElementById('emp-activo').value !== 'false';
  if (!nombre) { showToast('El nombre es obligatorio'); return; }
  if (!email) { showToast('El correo es obligatorio'); return; }

  try {
    if (id) {
      // Edición de un empleado existente (upsert con cola offline).
      const u = { id, nombre, email, rol, activo };
      await db.saveUser(u);
      const cached = empleadosCache.find(x => x.id === id);
      if (cached) Object.assign(cached, u);
      logActivity('Editó al empleado ' + nombre + ' (' + rol + ')');
      showToast('Empleado actualizado');
      closeModal('modal-empleado');
      renderEmpleados();
    } else {
      // Alta: intenta insertar la fila. La cuenta de acceso se crea en Fase 2.
      const nuevo = { id: crypto.randomUUID(), nombre, email, rol, activo };
      const res = await db.createEmpleado(nuevo);
      if (res && res.error) {
        console.error(res.error);
        showToast('No se pudo crear el empleado. La cuenta de acceso (login) se habilita en la Fase 2; por ahora solo es posible editar empleados existentes.');
        return;
      }
      logActivity('Registró al empleado ' + nombre + ' (' + rol + ')');
      showToast('Empleado registrado');
      closeModal('modal-empleado');
      renderEmpleados();
    }
  } catch (e) {
    console.error(e);
    showToast('Error al guardar el empleado');
  }
}

export async function toggleEmpleadoActivo(id) {
  const u = empleadosCache.find(x => x.id === id);
  if (!u) return;
  const nuevoEstado = !(u.activo !== false);
  if (!confirm((nuevoEstado ? 'Activar' : 'Desactivar') + ' al empleado ' + u.nombre + '?')) return;
  u.activo = nuevoEstado;
  try {
    await db.saveUser(u);
    logActivity((nuevoEstado ? 'Activó' : 'Desactivó') + ' al empleado ' + u.nombre);
    showToast('Empleado ' + (nuevoEstado ? 'activado' : 'desactivado'));
    renderEmpleados();
  } catch (e) { console.error(e); showToast('Error al cambiar el estado del empleado'); }
}

Object.assign(window, { renderEmpleados, openEmpleadoModal, saveEmpleado, toggleEmpleadoActivo });
