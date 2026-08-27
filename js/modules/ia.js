/* ============================================================
   MÓDULO: RECONOCIMIENTO IA
   El análisis se dirige a un PAR (precinto) específico de una
   orden, no solo a la orden en general — si la orden tiene varios
   pares, cada uno guarda su propio resultado (marca, modelo, color,
   material, estado, tratamiento sugerido). El buscador muestra el
   número de cliente y cada código de precinto por separado para
   facilitar el registro.
   Fase 2: Usa Edge Function de Supabase para llamar a Claude API
   de forma segura (API Key en servidor, no en cliente).
   ============================================================ */
import { state, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, clienteNombre, clienteById, ordenById, logActivity } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import { supabase } from '../config.js';
import * as storageManager from '../storage-manager.js';
import { itemsDeOrden } from './ordenes.js';

// Variables con ámbito de módulo (reemplazan las globales).
let iaPendingFile = null;
let iaResult = null;

export function populateIaOrderSelect() {
  const hidden = document.getElementById('ia-orden-target');
  const hiddenItem = document.getElementById('ia-item-target');
  const visible = document.getElementById('ia-orden-search');
  if (hidden) hidden.value = '';
  if (hiddenItem) hiddenItem.value = '';
  if (visible) visible.value = '';
  limpiarIaResultados();
}

function limpiarIaResultados() {
  const cont = document.getElementById('ia-orden-results');
  if (cont) cont.innerHTML = '';
}

/**
 * Buscador tipo autocompletar para asociar el análisis a un PAR
 * (precinto) puntual: filtra por nombre de cliente, N° de cliente,
 * N° de orden o WhatsApp, y lista cada par de las órdenes que
 * coincidan por separado — para que sea fácil elegir el par exacto
 * cuando una orden tiene varios.
 */
export function filtrarIaOrdenes(texto) {
  const cont = document.getElementById('ia-orden-results');
  if (!cont) return;
  const q = (texto || '').trim().toLowerCase();

  const base = q ? state.ordenes.filter(o => {
    const c = clienteById(o.clienteId);
    const cliente = (c ? c.nombre : '').toLowerCase();
    const whatsapp = (c && c.whatsapp || '').toLowerCase();
    const numCliente = c ? String(c.telefono || '') : '';
    return cliente.includes(q) || String(o.numero).includes(q) || whatsapp.includes(q) || numCliente.includes(q);
  }) : state.ordenes.slice();

  const rank = o => {
    const cliente = clienteNombre(o.clienteId).toLowerCase();
    if (!q) return 0;
    if (cliente.startsWith(q)) return 0;
    if (String(o.numero).startsWith(q)) return 1;
    return 2;
  };
  const ordenesOrdenadas = base.sort((a, b) => rank(a) - rank(b) || b.numero - a.numero).slice(0, 12);

  // Cada orden se expande a sus pares — un resultado por precinto,
  // no uno por orden, para que el registro vaya directo al par correcto.
  const filas = [];
  ordenesOrdenadas.forEach(o => {
    const c = clienteById(o.clienteId);
    const clienteLabel = (c ? c.nombre : 'Cliente') + (c && c.telefono ? ' (Tel. ' + c.telefono + ')' : '');
    const items = itemsDeOrden(o.id);
    if (items.length) {
      items.forEach(it => {
        filas.push({ ordenId: o.id, itemId: it.id, label: '<strong>' + escHtml(it.codigo) + '</strong> · ' + escHtml(clienteLabel) + (it.descripcion ? ' · ' + escHtml(it.descripcion) : '') });
      });
    } else {
      filas.push({ ordenId: o.id, itemId: '', label: '<strong>#' + escHtml(o.numero) + '</strong> · ' + escHtml(clienteLabel) + ' <span class="hint">(sin artículos registrados todavía)</span>' });
    }
  });

  cont.innerHTML = filas.length ? filas.slice(0, 30).map(f =>
    '<div class="combo-item" onmousedown="seleccionarIaOrden(\'' + escAttr(f.ordenId) + '\',\'' + escAttr(f.itemId) + '\')">' + f.label + '</div>'
  ).join('') : '<div class="combo-empty">Sin resultados</div>';
}

/** Selecciona un par (o, si la orden todavía no tiene pares, la orden entera). */
export function seleccionarIaOrden(ordenId, itemId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const c = clienteById(o.clienteId);
  document.getElementById('ia-orden-target').value = ordenId;
  document.getElementById('ia-item-target').value = itemId || '';
  const item = itemId ? itemsDeOrden(ordenId).find(it => it.id === itemId) : null;
  document.getElementById('ia-orden-search').value =
    (item ? item.codigo : '#' + o.numero) + ' · ' + (c ? c.nombre : 'Cliente') + (c && c.telefono ? ' (Tel. ' + c.telefono + ')' : '');
  limpiarIaResultados();
}

export function handleIaFile(file) {
  if (!file) return;
  iaPendingFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('ia-preview').src = e.target.result;
    document.getElementById('ia-preview').style.display = 'block';
    document.getElementById('ia-dropzone-empty').style.display = 'none';
    document.getElementById('ia-analyze-btn').disabled = false;
    document.getElementById('ia-change-photo-btn').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

export function clearIaPhoto() {
  iaPendingFile = null;
  iaResult = null;
  document.getElementById('ia-file-input-camera').value = '';
  document.getElementById('ia-file-input-galeria').value = '';
  document.getElementById('ia-preview').src = '';
  document.getElementById('ia-preview').style.display = 'none';
  document.getElementById('ia-dropzone-empty').style.display = 'block';
  document.getElementById('ia-analyze-btn').disabled = true;
  document.getElementById('ia-change-photo-btn').style.display = 'none';
  document.getElementById('ia-results-panel').style.display = 'none';
  document.getElementById('ia-loading-panel').style.display = 'none';
  document.getElementById('ia-placeholder-panel').style.display = 'block';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = () => reject(new Error('No se pudo leer la imagen'));
    r.readAsDataURL(file);
  });
}

export async function runIaAnalysis() {
  if (!iaPendingFile) return;

  document.getElementById('ia-results-panel').style.display = 'none';
  document.getElementById('ia-placeholder-panel').style.display = 'none';
  document.getElementById('ia-loading-panel').style.display = 'block';

  try {
    const orderId = document.getElementById('ia-orden-target').value;
    const itemId = document.getElementById('ia-item-target').value;
    let imageUrl = null;

    if (orderId) {
      showToast('Subiendo imagen...', 'info');
      const fotoData = await storageManager.uploadFoto(iaPendingFile, orderId, 'detalle');
      imageUrl = fotoData.url;
    }

    const payload = {};
    if (imageUrl) {
      payload.imageUrl = imageUrl;
    } else {
      const base64 = await fileToBase64(iaPendingFile);
      const mediaType = iaPendingFile.type || 'image/jpeg';
      payload.imageBase64 = `data:${mediaType};base64,${base64}`;
    }

    // Contexto: si el par elegido ya tenía marca/modelo cargados de un
    // análisis anterior, se envían como pista.
    if (orderId) {
      const item = itemId ? itemsDeOrden(orderId).find(it => it.id === itemId) : null;
      if (item && item.marca) payload.marca = item.marca;
      if (item && item.modelo) payload.modelo = item.modelo;
    }

    showToast('Analizando con IA...', 'info');
    const { data, error } = await supabase.functions.invoke('analyze-shoe', {
      body: payload
    });

    if (error) throw new Error(error.message || 'Error al invocar Edge Function');
    if (!data || data.error) throw new Error(data?.error || 'La Edge Function devolvió un error');

    iaResult = {
      marca: data.marca || 'No identificado',
      modelo: data.modelo || 'No identificado',
      tipo: data.tipoCalzado || '',
      color: data.color || '',
      material: data.material || '',
      estadoCalzado: data.estadoCalzado || '',
      tratamientoSugerido: data.tratamientoSugerido || '',
      confianza: Number(data.confianza) || 0
    };

    const o = orderId ? ordenById(orderId) : null;
    const item = orderId && itemId ? itemsDeOrden(orderId).find(it => it.id === itemId) : null;
    logActivity('Ejecutó análisis de IA' + (item ? ' para el artículo ' + item.codigo : (o ? ' para orden #' + o.numero : '')));

  } catch (e) {
    console.error('Error en análisis IA:', e);
    iaResult = {
      marca: 'No identificado', modelo: 'No identificado', tipo: '', color: '', material: '',
      estadoCalzado: '', tratamientoSugerido: '', confianza: 0, _error: true
    };
    showToast('No se pudo completar el análisis: ' + e.message + '. Puedes editar los campos manualmente.');
  }

  document.getElementById('ia-loading-panel').style.display = 'none';
  renderIaResults();
}

function renderIaResults() {
  document.getElementById('ia-results-panel').style.display = 'block';
  const conf = Math.max(0, Math.min(100, Number(iaResult.confianza) || 0));
  document.getElementById('ia-confidence-num').textContent = conf + '%';
  document.getElementById('ia-confidence-fill').style.width = conf + '%';
  document.getElementById('ia-confidence-fill').style.background = conf < 50 ? 'var(--amber)' : (conf < 75 ? 'var(--teal)' : 'var(--green)');
  document.getElementById('ia-low-confidence-hint').style.display = conf < 60 ? 'block' : 'none';

  const fields = [
    ['ia-f-marca', 'Marca', iaResult.marca],
    ['ia-f-modelo', 'Modelo', iaResult.modelo],
    ['ia-f-tipo', 'Tipo', iaResult.tipo],
    ['ia-f-color', 'Color', iaResult.color],
    ['ia-f-material', 'Material', iaResult.material],
    ['ia-f-estado', 'Estado', iaResult.estadoCalzado],
    ['ia-f-tratamiento', 'Tratamiento sugerido', iaResult.tratamientoSugerido]
  ];
  document.getElementById('ia-fields').innerHTML = fields.map(f =>
    '<div class="ia-field-row"><label>' + escHtml(f[1]) + '</label><input id="' + f[0] + '" value="' + escAttr((f[2] || '').toString()) + '"></div>'
  ).join('');
}

export async function saveIaToOrder() {
  const orderId = document.getElementById('ia-orden-target').value;
  const itemId = document.getElementById('ia-item-target').value;
  const analisis = {
    marca: document.getElementById('ia-f-marca').value,
    modelo: document.getElementById('ia-f-modelo').value,
    tipo: document.getElementById('ia-f-tipo').value,
    color: document.getElementById('ia-f-color').value,
    material: document.getElementById('ia-f-material').value,
    estadoCalzado: document.getElementById('ia-f-estado').value,
    tratamientoSugerido: document.getElementById('ia-f-tratamiento').value,
    confianza: iaResult.confianza || 0
  };
  if (!orderId) { showToast('Selecciona un artículo (o una orden) para asociar el análisis'); return; }

  const o = ordenById(orderId);
  if (!o) return;
  const item = itemId ? itemsDeOrden(orderId).find(it => it.id === itemId) : null;

  try {
    if (item) {
      // El análisis queda guardado en el par exacto — así, si la orden
      // tiene varios pares, cada uno conserva su propio resultado.
      item.marca = analisis.marca || item.marca;
      item.modelo = analisis.modelo || item.modelo;
      item.tipoCalzado = analisis.tipo || item.tipoCalzado;
      item.color = analisis.color || item.color;
      item.material = analisis.material || item.material;
      item.estadoCalzado = analisis.estadoCalzado || item.estadoCalzado;
      item.tratamientoSugerido = analisis.tratamientoSugerido || item.tratamientoSugerido;
      await persist();
      await db.saveOrdenItem(item);
      // Resumen a nivel de orden (para tickets/QR/reportes que todavía
      // muestran un solo "artículo"): se completa solo si estaba vacío.
      if (!o.marca) o.marca = item.marca;
      if (!o.modelo) o.modelo = item.modelo;
      if (!o.color) o.color = item.color;
      if (!o.material) o.material = item.material;
      await db.saveOrden(o);
      logActivity('Aplicó análisis de IA al artículo ' + item.codigo + ' (orden #' + o.numero + ')');
      showToast('Análisis guardado en el artículo ' + item.codigo);
    } else {
      // Orden sin pares todavía: se guarda como resumen general de la orden.
      o.marca = analisis.marca || o.marca;
      o.modelo = analisis.modelo || o.modelo;
      o.tipoCalzado = analisis.tipo || o.tipoCalzado;
      o.color = analisis.color || o.color;
      o.material = analisis.material || o.material;
      o.estadoCalzado = analisis.estadoCalzado || o.estadoCalzado;
      o.tratamientoSugerido = analisis.tratamientoSugerido || o.tratamientoSugerido;
      await persist();
      await db.saveOrden(o);
      logActivity('Aplicó análisis de IA a la orden #' + o.numero);
      showToast('Análisis guardado en la orden #' + o.numero);
    }
    if (window.renderOrdenes) window.renderOrdenes();
  } catch (e) { console.error(e); showToast('Error al guardar el análisis'); }
}

Object.assign(window, {
  populateIaOrderSelect, handleIaFile, clearIaPhoto, runIaAnalysis, saveIaToOrder,
  filtrarIaOrdenes, seleccionarIaOrden
});
