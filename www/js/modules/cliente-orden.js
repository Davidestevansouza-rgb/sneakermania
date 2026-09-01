/* ============================================================
   MÓDULO: NUEVO CLIENTE + ORDEN (fusionado)
   Un solo modal donde se registra el cliente y, en el mismo paso,
   sus pares de calzado: cada par se fotografía y la IA lo analiza
   al instante (marca, modelo, color, material, estado, tratamiento
   sugerido) — todo editable a mano por si la IA no reconoce algún
   zapato de la foto. Al guardar, las fotos quedan en la MISMA
   categoría "Todos los artículos" que usa la Galería. Después de
   guardar se puede registrar el pago (efectivo/QR, va a Finanzas)
   y enviar el resumen por WhatsApp.
   ============================================================ */
import { state, todayISO, persist, ensurePagoFields } from '../state.js';
import * as db from '../db.js';
import { showToast, openModalEl, closeModal, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import { supabase } from '../config.js';
import * as storageManager from '../storage-manager.js';
import { SERVICIOS_PAR, itemsDeOrden, openFormaPagoChooser, enviarWhatsAppOrden } from './ordenes.js';
import { ensureEmpleadosCache, getEmpleadosCache } from './empleados.js';
import { limpiarCombo } from '../combo-search.js';

// Estado en memoria de las filas del modal mientras está abierto: cada
// fila guarda su archivo de foto pendiente (todavía no hay ordenId para
// subirlo a Storage) y el resultado de IA (editable).
let filasCO = new Map(); // rowId -> { file, dataUrl, ia: {...}, analizando }
let filaSeq = 0;
let ultimaOrdenCreada = null; // para los botones de pago/WhatsApp post-guardado

export async function openNuevoClienteOrdenModal() {
  await ensureEmpleadosCache();
  filasCO = new Map();
  filaSeq = 0;
  // Selector de cliente existente: si el cliente ya vino antes, se busca
  // por nombre (autocompletar) aquí y solo se registran sus pares (sin
  // recrearlo). Se limpia la búsqueda y la selección previa al abrir.
  const searchEl = document.getElementById('nco-cliente-search');
  if (searchEl) searchEl.value = '';
  const hiddenEl = document.getElementById('nco-cliente-existente');
  if (hiddenEl) hiddenEl.value = '';
  const limpiarBtn = document.getElementById('nco-cliente-limpiar-btn');
  if (limpiarBtn) limpiarBtn.style.display = 'none';
  limpiarCombo('nco-cliente-results');
  document.getElementById('nco-nombre').value = '';
  document.getElementById('nco-telefono').value = '';
  document.getElementById('nco-whatsapp').value = '';
  document.getElementById('nco-direccion').value = '';
  document.getElementById('nco-observaciones').value = '';
  document.getElementById('nco-nombre').readOnly = false;
  document.getElementById('nco-telefono').readOnly = false;
  document.getElementById('nco-whatsapp').readOnly = false;
  document.getElementById('nco-precio').value = '';
  document.getElementById('nco-descuento').value = 0;
  document.getElementById('nco-prioridad').value = 'Media';
  document.getElementById('nco-metodo-pago').value = '';
  const pagadoEl = document.getElementById('nco-pagado'); if (pagadoEl) pagadoEl.value = 0;
  document.querySelectorAll('#nco-metodo-pago-btns .co-pago-btn').forEach(b => b.classList.remove('btn-teal'));
  document.getElementById('nco-enviar-whatsapp').checked = true;
  document.getElementById('nco-items-list').innerHTML = '';
  const titEl = document.querySelector('#modal-cliente-orden .modal-title'); if (titEl) titEl.textContent = 'Nuevo cliente';
  agregarFilaParCO();
  openModalEl('modal-cliente-orden');
}

/** Buscador tipo autocompletar del cliente existente (por nombre, teléfono
 *  o WhatsApp) para la orden nueva. Reemplaza al listado desplegable: con
 *  muchos clientes registrados era muy lento encontrar uno en un <select>. */
export function filtrarClientesComboCO(texto) {
  const results = document.getElementById('nco-cliente-results');
  if (!results) return;
  const q = (texto || '').trim().toLowerCase();
  const todos = (state.clientes || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  const base = q ? todos.filter(c => {
    const nombre = (c.nombre || '').toLowerCase();
    const tel = (c.telefono || '').toLowerCase();
    const wa = (c.whatsapp || '').toLowerCase();
    return nombre.includes(q) || tel.includes(q) || wa.includes(q);
  }) : todos;
  // Prioriza los nombres que EMPIEZAN con lo escrito.
  const rank = c => {
    if (!q) return 0;
    const nombre = (c.nombre || '').toLowerCase();
    return nombre.startsWith(q) ? 0 : 1;
  };
  const matches = base.sort((a, b) => rank(a) - rank(b)).slice(0, 20);
  results.innerHTML = matches.length ? matches.map(c =>
    '<div class="combo-item" onmousedown="seleccionarClienteExistenteCO(\'' + escAttr(c.id) + '\')">' +
      '<strong>' + escHtml(c.nombre) + '</strong>' + (c.whatsapp ? ' · ' + escHtml(c.whatsapp) : '') +
    '</div>'
  ).join('') : '<div class="combo-empty">Sin resultados — se registrará como cliente nuevo</div>';
}

/** Al elegir un cliente existente del buscador: se cargan sus datos y se
 *  bloquean (para no editarlos por error); se registra solo la nueva orden.
 *  "" = cliente nuevo → se desbloquean y limpian los campos. */
export function seleccionarClienteExistenteCO(clienteId) {
  const nombre = document.getElementById('nco-nombre');
  const tel = document.getElementById('nco-telefono');
  const wa = document.getElementById('nco-whatsapp');
  const dir = document.getElementById('nco-direccion');
  const titEl = document.querySelector('#modal-cliente-orden .modal-title');
  const searchEl = document.getElementById('nco-cliente-search');
  const hiddenEl = document.getElementById('nco-cliente-existente');
  const limpiarBtn = document.getElementById('nco-cliente-limpiar-btn');
  limpiarCombo('nco-cliente-results');
  if (!clienteId) {
    [nombre, tel, wa].forEach(el => { el.readOnly = false; el.value = ''; });
    dir.value = '';
    if (titEl) titEl.textContent = 'Nuevo cliente';
    if (searchEl) searchEl.value = '';
    if (hiddenEl) hiddenEl.value = '';
    if (limpiarBtn) limpiarBtn.style.display = 'none';
    return;
  }
  const c = (state.clientes || []).find(x => x.id === clienteId);
  if (!c) return;
  nombre.value = c.nombre || '';
  tel.value = c.telefono || '';
  wa.value = c.whatsapp || c.telefono || '';
  dir.value = c.direccion || '';
  [nombre, tel, wa].forEach(el => { el.readOnly = true; });
  if (titEl) titEl.textContent = 'Nueva orden — ' + (c.nombre || 'cliente');
  if (searchEl) searchEl.value = c.nombre || '';
  if (hiddenEl) hiddenEl.value = clienteId;
  if (limpiarBtn) limpiarBtn.style.display = '';
}

/** Botones-icono de método de pago: marca el elegido (uno solo). */
export function seleccionarMetodoPagoCO(btn) {
  document.querySelectorAll('#nco-metodo-pago-btns .co-pago-btn').forEach(b => b.classList.remove('btn-teal'));
  btn.classList.add('btn-teal');
  document.getElementById('nco-metodo-pago').value = btn.dataset.metodo || '';
}

/** Envía por WhatsApp un resumen con lo que hay en el formulario ANTES de
 *  guardar (para que el cliente confirme). No guarda nada. */
export function enviarWhatsAppPreviewCO() {
  const nombre = document.getElementById('nco-nombre').value.trim();
  const whatsapp = document.getElementById('nco-whatsapp').value.trim();
  if (!whatsapp) { showToast('Falta el número de WhatsApp'); return; }
  const precio = Number(document.getElementById('nco-precio').value) || 0;
  const descuento = Number(document.getElementById('nco-descuento').value) || 0;
  const pagado = Number(document.getElementById('nco-pagado').value) || 0;
  const metodo = document.getElementById('nco-metodo-pago').value || '';
  const filas = Array.from(document.querySelectorAll('#nco-items-list .co-par-row'));
  const paresTxt = filas.map((f, i) => {
    const desc = (f.querySelector('.co-desc-input')?.value || '').trim() || ('Par ' + (i + 1));
    const svc = Array.from(f.querySelectorAll('.co-servicio-chk:checked')).map(c => c.value).join(', ');
    return '• ' + desc + (svc ? ' (' + svc + ')' : '');
  }).join('\n');
  const total = Math.max(0, precio - descuento);
  const saldo = Math.max(0, total - pagado);
  const msg = 'Hola ' + (nombre || '') + ' 👟\n\nEstos son los detalles de tu pedido:\n' + paresTxt +
    '\n\nTotal: $' + total.toFixed(2) + (descuento ? ' (desc. $' + descuento.toFixed(2) + ')' : '') +
    (pagado ? '\nPagado: $' + pagado.toFixed(2) + (metodo ? ' (' + metodo + ')' : '') : '') +
    (saldo ? '\nSaldo: $' + saldo.toFixed(2) : '\n¡Pagado en su totalidad!') +
    '\n\n¡Gracias por tu confianza!';
  const tel = whatsapp.replace(/[^0-9]/g, '');
  if (window.enviarWhatsApp) window.enviarWhatsApp(tel, msg);
  else window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
  showToast('Abriendo WhatsApp…');
}

/** Agrega una fila de par al formulario fusionado. */
export function agregarFilaParCO() {
  const cont = document.getElementById('nco-items-list');
  if (!cont) return;
  const rowId = 'co' + (++filaSeq);
  filasCO.set(rowId, { file: null, dataUrl: null, ia: null, analizando: false });

  const empleados = getEmpleadosCache();
  const responsableOptions = '<option value="">Sin asignar</option>' + empleados.map(u =>
    '<option value="' + escAttr(u.nombre) + '">' + escHtml(u.nombre) + '</option>'
  ).join('');
  const serviciosChips = SERVICIOS_PAR.map((s, i) => {
    const cid = 'nco-svc-' + rowId + '-' + i;
    return '<label for="' + cid + '" class="chip-toggle">' +
      '<input type="checkbox" id="' + cid + '" class="co-servicio-chk" value="' + escAttr(s) + '" onchange="this.closest(\'label\').classList.toggle(\'checked\', this.checked)">' +
      escHtml(s) +
    '</label>';
  }).join('');

  const row = document.createElement('div');
  row.className = 'co-par-row articulo-row';
  row.dataset.rowId = rowId;
  row.innerHTML =
    '<div class="articulo-row-head">' +
      '<span class="mono" style="min-width:50px;font-size:12px;color:var(--ink-soft);">Artículo</span>' +
      '<input class="co-desc-input" placeholder="Ej: Nike Air Force 1 blancas, talla 42 (obligatorio)">' +
      '<button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="quitarFilaParCO(this)">✕</button>' +
    '</div>' +
    '<div>' +
      '<label class="hint" style="display:block;margin-bottom:3px;">Servicio de este artículo * (puedes elegir varios)</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + serviciosChips + '</div>' +
    '</div>' +
    '<div class="articulo-row-fields">' +
      '<div><label class="hint" style="display:block;margin-bottom:2px;">Responsable</label>' +
        '<select class="co-responsable-input">' + responsableOptions + '</select></div>' +
      '<div><label class="hint" style="display:block;margin-bottom:2px;">Fecha de ingreso</label>' +
        '<input type="date" class="co-fecha-ingreso-input" value="' + escAttr(todayISO(0)) + '"></div>' +
      '<div><label class="hint" style="display:block;margin-bottom:2px;">Fecha de entrega</label>' +
        '<input type="date" class="co-fecha-entrega-input" value="' + escAttr(todayISO(3)) + '"></div>' +
    '</div>' +
    '<div style="border-top:1px dashed var(--line);padding-top:8px;">' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
        '<label class="btn btn-ghost btn-sm" style="cursor:pointer;">📷 Foto del artículo' +
          '<input type="file" accept="image/*" capture="environment" style="display:none;" onchange="capturarFotoParCO(\'' + rowId + '\', this.files[0])">' +
        '</label>' +
        '<img class="co-foto-preview" style="display:none;max-height:64px;border-radius:6px;border:1px solid var(--line);">' +
        '<span class="co-ia-status hint"></span>' +
      '</div>' +
      '<div class="co-ia-fields" style="display:none;margin-top:8px;"></div>' +
      '<div class="hint" style="margin-top:4px;">Si no sacas foto, puedes escribir marca/modelo/color a mano en "Editar información de IA".</div>' +
      '<button type="button" class="btn btn-ghost btn-sm co-ia-manual-btn" style="margin-top:4px;" onclick="mostrarCamposIaCO(this)">Editar información de IA manualmente</button>' +
    '</div>';
  cont.appendChild(row);
}

export function quitarFilaParCO(btn) {
  const row = btn.closest('.co-par-row');
  if (!row) return;
  filasCO.delete(row.dataset.rowId);
  row.remove();
}

/** Muestra el panel de campos de IA (editables) aunque todavía no haya foto. */
export function mostrarCamposIaCO(btn) {
  const row = btn.closest('.co-par-row');
  if (!row) return;
  renderCamposIaCO(row, (filasCO.get(row.dataset.rowId) || {}).ia || {});
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = () => reject(new Error('No se pudo leer la imagen'));
    r.readAsDataURL(file);
  });
}

/** Se dispara al elegir/tomar la foto de un par: la guarda en memoria
 *  (todavía no se sube a Storage, porque la orden no existe hasta
 *  guardar el formulario completo) y lanza el análisis de IA. */
export async function capturarFotoParCO(rowId, file) {
  if (!file) return;
  const row = document.querySelector('.co-par-row[data-row-id="' + rowId + '"]');
  if (!row) return;
  const entry = filasCO.get(rowId) || {};
  entry.file = file;
  filasCO.set(rowId, entry);

  const reader = new FileReader();
  reader.onload = async e => {
    entry.dataUrl = e.target.result;
    const img = row.querySelector('.co-foto-preview');
    img.src = entry.dataUrl;
    img.style.display = 'inline-block';
    await analizarParCO(rowId);
  };
  reader.readAsDataURL(file);
}

async function analizarParCO(rowId) {
  const row = document.querySelector('.co-par-row[data-row-id="' + rowId + '"]');
  const entry = filasCO.get(rowId);
  if (!row || !entry || !entry.file) return;
  const status = row.querySelector('.co-ia-status');
  entry.analizando = true;
  status.textContent = 'Analizando con IA...';

  try {
    const base64 = await fileToBase64(entry.file);
    const mediaType = entry.file.type || 'image/jpeg';
    const { data, error } = await supabase.functions.invoke('analyze-shoe', {
      body: { imageBase64: `data:${mediaType};base64,${base64}` }
    });
    if (error) throw new Error(error.message || 'Error al invocar Edge Function');
    if (!data || data.error) throw new Error(data?.error || 'La Edge Function devolvió un error');

    entry.ia = {
      marca: data.marca || '',
      modelo: data.modelo || '',
      tipo: data.tipoCalzado || '',
      color: data.color || '',
      material: data.material || '',
      estadoCalzado: data.estadoCalzado || '',
      tratamientoSugerido: data.tratamientoSugerido || '',
      confianza: Number(data.confianza) || 0
    };
    status.textContent = 'IA: ' + (entry.ia.marca || 'no identificado') + ' ' + (entry.ia.modelo || '') +
      (entry.ia.confianza ? ' (' + entry.ia.confianza + '% confianza)' : '');
  } catch (e) {
    console.error('Error en análisis IA:', e);
    entry.ia = entry.ia || { marca: '', modelo: '', tipo: '', color: '', material: '', estadoCalzado: '', tratamientoSugerido: '', confianza: 0 };
    status.textContent = 'No se pudo analizar automáticamente. Completa los datos a mano.';
    showToast('La IA no pudo analizar esta foto. Puedes completar los campos manualmente.');
  }
  entry.analizando = false;
  renderCamposIaCO(row, entry.ia);
  // Si la descripción del par está vacía, la sugerimos con lo que detectó la IA.
  const descInput = row.querySelector('.co-desc-input');
  if (descInput && !descInput.value.trim() && entry.ia && entry.ia.marca) {
    descInput.value = [entry.ia.marca, entry.ia.modelo, entry.ia.color].filter(Boolean).join(' ');
  }
}

/** Dibuja (o vuelve a dibujar) los campos editables de IA para un par. */
function renderCamposIaCO(row, ia) {
  const cont = row.querySelector('.co-ia-fields');
  const v = ia || {};
  const fields = [
    ['marca', 'Marca', v.marca],
    ['modelo', 'Modelo', v.modelo],
    ['tipo', 'Tipo de artículo', v.tipo],
    ['color', 'Color', v.color],
    ['material', 'Material', v.material],
    ['estado', 'Estado', v.estadoCalzado],
    ['tratamiento', 'Tratamiento sugerido', v.tratamientoSugerido]
  ];
  cont.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;">' +
    fields.map(f =>
      '<div><label class="hint" style="display:block;margin-bottom:2px;">' + escHtml(f[1]) + '</label>' +
      '<input class="co-ia-f" data-field="' + f[0] + '" value="' + escAttr((f[2] || '').toString()) + '" style="width:100%;padding:6px;border:1px solid var(--line);border-radius:6px;"></div>'
    ).join('') + '</div>';
  cont.style.display = 'block';
}

/** Lee del DOM los campos de IA (editados a mano o no) para una fila. */
function leerIaDeFila(row) {
  const out = { marca: '', modelo: '', tipo: '', color: '', material: '', estadoCalzado: '', tratamientoSugerido: '' };
  row.querySelectorAll('.co-ia-f').forEach(inp => {
    const f = inp.dataset.field;
    if (f === 'estado') out.estadoCalzado = inp.value.trim();
    else if (f === 'tratamiento') out.tratamientoSugerido = inp.value.trim();
    else out[f] = inp.value.trim();
  });
  return out;
}

/** Guarda el cliente + la orden + sus pares (con foto y análisis de IA
 *  ya asociados) en un solo paso. Las fotos quedan en la categoría
 *  "todos_pares", la misma que usa la pestaña Galería. */
export async function guardarClienteOrden(btn) {
  const nombre = document.getElementById('nco-nombre').value.trim();
  const whatsapp = document.getElementById('nco-whatsapp').value.trim();
  if (!nombre) { showToast('Falta completar: Nombre'); document.getElementById('nco-nombre').focus(); return; }
  if (!whatsapp) { showToast('Falta completar: Número de WhatsApp'); document.getElementById('nco-whatsapp').focus(); return; }

  const precio = Number(document.getElementById('nco-precio').value) || 0;
  if (!precio || precio <= 0) { showToast('Indica el precio total del servicio antes de guardar'); return; }

  const filas = Array.from(document.querySelectorAll('#nco-items-list .co-par-row'));
  if (filas.length === 0) { showToast('Agrega al menos un artículo a la orden'); return; }
  for (const fila of filas) {
    const desc = (fila.querySelector('.co-desc-input')?.value || '').trim();
    const servicios = Array.from(fila.querySelectorAll('.co-servicio-chk:checked')).map(c => c.value);
    if (!desc) { showToast('Cada artículo necesita una descripción (ej: modelo/color) antes de guardar'); return; }
    if (servicios.length === 0) { showToast('Elige al menos un tipo de servicio para cada artículo'); return; }
  }

  const metodoPago = document.getElementById('nco-metodo-pago').value;
  const enviarWA = document.getElementById('nco-enviar-whatsapp').checked;
  const pagado = Number((document.getElementById('nco-pagado') || {}).value) || 0;
  const clienteExistenteId = (document.getElementById('nco-cliente-existente') || {}).value || '';

  const restore = lockBtn(btn);
  try {
    // 1) Cliente — nuevo, o uno ya registrado (visita recurrente): en ese
    //    caso NO se crea de nuevo, solo se usa para la nueva orden.
    let cliente;
    if (clienteExistenteId) {
      cliente = (state.clientes || []).find(c => c.id === clienteExistenteId);
      if (!cliente) { showToast('No se encontró el cliente elegido'); restore(); return; }
    } else {
      cliente = {
        id: crypto.randomUUID(),
        nombre,
        telefono: document.getElementById('nco-telefono').value.trim(),
        whatsapp,
        direccion: document.getElementById('nco-direccion').value.trim(),
        observaciones: document.getElementById('nco-observaciones').value.trim()
      };
      state.clientes.push(cliente);
      logActivity('Registró nuevo cliente ' + cliente.nombre);
      await persist();
      await db.saveCliente(cliente);
    }

    // 2) Orden
    const fechasIngreso = filas.map(f => f.querySelector('.co-fecha-ingreso-input')?.value).filter(Boolean).sort();
    const fechasEntrega = filas.map(f => f.querySelector('.co-fecha-entrega-input')?.value).filter(Boolean).sort();
    const tipoServicio = Array.from(new Set(filas.flatMap(f => Array.from(f.querySelectorAll('.co-servicio-chk:checked')).map(c => c.value))));
    const responsable = Array.from(new Set(filas.map(f => f.querySelector('.co-responsable-input')?.value || '').filter(Boolean))).join(', ');
    const orden = ensurePagoFields({
      id: crypto.randomUUID(),
      numero: state.nextOrderNum++,
      clienteId: cliente.id,
      prioridad: document.getElementById('nco-prioridad').value,
      estado: 'Recibido y registrado',
      precio,
      descuento: Number(document.getElementById('nco-descuento').value) || 0,
      pagado: 0, metodoPago, fechaPago: '', estadoPago: 'Pendiente', fechaEntrega: '',
      tipoServicio, responsable,
      fechaIngreso: fechasIngreso[0] || todayISO(0),
      fechaEstimada: fechasEntrega[fechasEntrega.length - 1] || todayISO(3),
      observaciones: '',
      fotos: { antes: [], durante: [], despues: [], detalle: [], suela: [], laterales: [], todos_pares: [] },
      extra: { fotos: [] }
    });

    // Pago registrado ahora mismo (opcional): el monto queda cobrado y va a
    // Finanzas (por método). El saldo restante queda como pendiente/parcial.
    if (pagado > 0) {
      const valorFinal = precio - (Number(orden.descuento) || 0);
      orden.pagado = Math.min(pagado, valorFinal);
      if (metodoPago === 'QR') orden.pagadoQR = orden.pagado;
      else if (metodoPago === 'Efectivo') orden.pagadoEfectivo = orden.pagado;
      orden.fechaPago = todayISO(0);
      orden.estadoPago = orden.pagado >= valorFinal ? 'Pagado' : 'Parcial';
    }
    state.ordenes.push(orden);
    logActivity('Creó orden #' + orden.numero + ' para ' + cliente.nombre);
    await persist();
    await db.saveOrden(orden);

    // 3) Pares (ítems), cada uno con su análisis de IA (editado o no) y su foto.
    if (!Array.isArray(state.ordenItems)) state.ordenItems = [];
    let numeroItem = 1;
    for (const fila of filas) {
      const descripcion = fila.querySelector('.co-desc-input').value.trim();
      const tipoServicioPar = Array.from(fila.querySelectorAll('.co-servicio-chk:checked')).map(c => c.value);
      const responsablePar = fila.querySelector('.co-responsable-input')?.value || '';
      const fechaIngreso = fila.querySelector('.co-fecha-ingreso-input')?.value || '';
      const fechaEntregaEstimada = fila.querySelector('.co-fecha-entrega-input')?.value || '';
      const ia = leerIaDeFila(fila);

      const item = {
        id: crypto.randomUUID(), ordenId: orden.id, numeroItem,
        codigo: orden.numero + '-' + numeroItem, descripcion, tipoServicio: tipoServicioPar, responsable: responsablePar,
        fechaIngreso, fechaEntregaEstimada, estado: 'Recibido y registrado', entregado: false, fechaEntrega: null,
        marca: ia.marca, modelo: ia.modelo, tipoCalzado: ia.tipo, color: ia.color, material: ia.material,
        estadoCalzado: ia.estadoCalzado, tratamientoSugerido: ia.tratamientoSugerido
      };
      state.ordenItems.push(item);
      await db.saveOrdenItem(item);
      numeroItem++;

      // Resumen a nivel de orden (para tickets/QR que muestran un solo artículo).
      if (!orden.marca && ia.marca) { orden.marca = ia.marca; orden.modelo = ia.modelo; orden.color = ia.color; orden.material = ia.material; }

      // Foto del par: recién ahora existe el ordenId, así que se sube a
      // Storage y se guarda en la MISMA categoría "todos_pares" que usa
      // la Galería.
      const entry = filasCO.get(fila.dataset.rowId);
      if (entry && entry.file) {
        try {
          const fotoData = await storageManager.uploadFoto(entry.file, orden.id, 'todos_pares');
          fotoData.item = item.codigo;
          orden.extra.fotos.push(fotoData);
        } catch (e) {
          console.error('No se pudo subir la foto del artículo ' + item.codigo + ':', e);
          showToast('El artículo ' + item.codigo + ' se guardó, pero su foto no se pudo subir.');
        }
      }
    }
    orden.cantidadPares = itemsDeOrden(orden.id).length || 1;
    await persist();
    await db.saveOrden(orden);

    closeModal('modal-cliente-orden');
    if (window.renderClientes) window.renderClientes();
    if (window.renderOrdenes) window.renderOrdenes();
    if (window.populateGaleriaSelect) window.populateGaleriaSelect();
    if (document.getElementById('tab-galeria') && document.getElementById('tab-galeria').classList.contains('active') && window.renderGaleria) window.renderGaleria();
    showToast('Cliente y orden registrados');

    // El método de pago y el envío por WhatsApp ahora se eligen en el
    // propio formulario, antes de guardar. Si se marcó la casilla, el
    // mensaje se manda automáticamente apenas se crea la orden.
    if (enviarWA) enviarWhatsAppOrden(orden.id);

    ultimaOrdenCreada = orden.id;
    abrirExitoClienteOrden(orden.id);
  } catch (e) {
    console.error(e);
    showToast('Error al registrar el cliente y la orden');
  } finally { restore(); }
}

/** Panel post-guardado: queda solo para registrar el cobro (monto), ya que
 *  el método de pago preferido y el aviso por WhatsApp se definieron antes
 *  de guardar, en el propio formulario. */
function abrirExitoClienteOrden(ordenId) {
  const cont = document.getElementById('nco-exito-content');
  cont.innerHTML =
    '<div class="hint">La orden quedó registrada. Si el cliente ya pagó, puedes registrarlo ahora.</div>' +
    '<button class="btn btn-teal btn-block" onclick="closeModal(\'modal-nco-exito\');openFormaPagoChooser(\'' + escAttr(ordenId) + '\')">💳 Registrar pago (efectivo / QR)</button>' +
    '<button class="btn btn-ghost btn-block" onclick="closeModal(\'modal-nco-exito\')">Cerrar</button>';
  openModalEl('modal-nco-exito');
}

Object.assign(window, {
  openNuevoClienteOrdenModal, agregarFilaParCO, quitarFilaParCO, mostrarCamposIaCO,
  capturarFotoParCO, guardarClienteOrden,
  seleccionarClienteExistenteCO, seleccionarMetodoPagoCO, enviarWhatsAppPreviewCO,
  filtrarClientesComboCO
});
