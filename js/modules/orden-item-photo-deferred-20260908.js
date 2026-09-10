/* ============================================================
   FOTOS INICIALES DE ARTÍCULOS — PIPELINE CONFIRMADO
   - La selección queda pendiente hasta Guardar orden.
   - Una foto solo se marca como guardada después de: compresión + R2 +
     persistencia en ordenes.extra + verificación de lectura en Supabase.
   - Los fallos permanecen pendientes y se reintentan sin volver a subir a R2
     si el archivo físico ya había subido correctamente.
   - Procesamiento secuencial para no saturar iPhone/Android.
   ============================================================ */
import { state, persist } from '../state.js';
import * as storageManager from '../storage-manager.js';
import { showToast } from '../ui.js';
import { appendOrderPhotoAtomic } from '../photo-store.js';

const PENDING_KEY = '__smDeferredOrderItemPhotos';
let seq = 0;

function filaDeInput(input) {
  return input?.closest?.('#orden-items-list .orden-item-row') || null;
}

function nuevaEntrada(file) {
  return {
    id: 'foto-' + Date.now() + '-' + (++seq),
    file,
    status: 'pending',
    uploadedFoto: null,
    error: null
  };
}

function entradasFila(row) {
  const arr = Array.isArray(row?.[PENDING_KEY]) ? row[PENDING_KEY] : [];
  // Compatibilidad con el formato anterior (File directo).
  const normalizadas = arr.map(x => x && x.file ? x : nuevaEntrada(x)).filter(x => x.file);
  if (row) row[PENDING_KEY] = normalizadas;
  return normalizadas;
}

function textoEstado(e) {
  if (e.status === 'uploading') return 'Comprimiendo y subiendo…';
  if (e.status === 'confirming') return 'Confirmando en Supabase…';
  if (e.status === 'error') return '⚠️ No se pudo guardar. Guardá nuevamente para reintentar.';
  return 'Foto lista para guardar';
}

function mostrarPendientes(row) {
  if (!row) return;
  const entries = entradasFila(row);
  let box = row.querySelector('.sm-deferred-photo-preview');
  if (!box) {
    box = document.createElement('div');
    box.className = 'sm-deferred-photo-preview';
    box.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:7px;';
    row.appendChild(box);
  }
  box.innerHTML = '';

  entries.forEach((entry, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:7px;padding:4px 6px;border:1px solid var(--line);border-radius:8px;max-width:100%;';
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(entry.file);
    img.src = objectUrl;
    img.alt = 'Foto pendiente';
    img.style.cssText = 'width:58px;height:58px;object-fit:cover;border-radius:7px;flex:0 0 auto;';
    img.onload = () => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} };

    const txt = document.createElement('span');
    txt.className = 'hint';
    txt.textContent = textoEstado(entry);

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Quitar esta foto';
    del.style.cssText = 'border:0;border-radius:50%;width:24px;height:24px;cursor:pointer;flex:0 0 auto;';
    del.disabled = entry.status === 'uploading' || entry.status === 'confirming';
    del.onclick = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const actuales = entradasFila(row);
      actuales.splice(idx, 1);
      row[PENDING_KEY] = actuales;
      mostrarPendientes(row);
    };
    wrap.append(img, txt, del);
    box.appendChild(wrap);
  });

  if (!entries.length) box.remove();
}

document.addEventListener('change', ev => {
  const input = ev.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
  const row = filaDeInput(input);
  if (!row) return;
  const files = Array.from(input.files || []).filter(f => f && ((f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '')));
  if (!files.length) return;

  // Este módulo es el único dueño del guardado diferido de fotos de artículos.
  // Evita que otros handlers históricos suban la misma selección por duplicado.
  ev.preventDefault();
  ev.stopPropagation();
  if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();

  const actuales = entradasFila(row);
  row[PENDING_KEY] = actuales.concat(files.map(nuevaEntrada));
  mostrarPendientes(row);
  input.value = '';
  showToast(files.length === 1
    ? '📷 Foto lista. Se confirmará al guardar la orden.'
    : '📷 ' + files.length + ' fotos listas. Se confirmarán al guardar la orden.');
}, true);

function snapshotPendientes() {
  return Array.from(document.querySelectorAll('#orden-items-list .orden-item-row')).map((row, index) => ({
    row,
    index,
    itemId: row.dataset.itemId || '',
    entries: entradasFila(row).filter(e => e.status !== 'saved')
  })).filter(x => x.entries.length);
}

function limpiarGuardadasDeFila(row) {
  if (!row) return;
  row[PENDING_KEY] = entradasFila(row).filter(e => e.status !== 'saved');
  mostrarPendientes(row);
}

async function guardarFotosPendientes(ordenId, pendientes) {
  const orden = (state.ordenes || []).find(o => o.id === ordenId);
  const expected = pendientes.reduce((n, p) => n + p.entries.length, 0);
  if (!orden || !expected) return { expected, saved: 0, failed: expected, fallos: [] };

  const items = (state.ordenItems || []).filter(it => it.ordenId === ordenId).sort((a, b) => (a.numeroItem || 0) - (b.numeroItem || 0));
  const fallos = [];

  // Secuencial a propósito: máximo una compresión/subida pesada a la vez.
  for (const p of pendientes) {
    const itemIdActual = p.row?.dataset?.itemId || p.itemId;
    const item = itemIdActual ? items.find(it => it.id === itemIdActual) : items[p.index];
    if (!item) {
      p.entries.forEach(entry => {
        entry.status = 'error';
        entry.error = new Error('No se pudo identificar el artículo');
        fallos.push({ codigo: 'desconocido', entry, error: entry.error });
      });
      mostrarPendientes(p.row);
      continue;
    }

    for (const entry of p.entries) {
      try {
        entry.status = entry.uploadedFoto ? 'confirming' : 'uploading';
        entry.error = null;
        mostrarPendientes(p.row);

        let foto = entry.uploadedFoto;
        if (!foto) {
          foto = await storageManager.uploadFoto(entry.file, orden.id, 'item_inicial');
          entry.uploadedFoto = foto;
        }

        foto.item = item.codigo;
        foto.itemId = item.id;
        foto.categoria = 'item_inicial';

        // R2 puede haber terminado bien aunque falle la vinculación. Por eso
        // uploadedFoto se conserva y un reintento vuelve únicamente a la RPC.
        entry.status = 'confirming';
        mostrarPendientes(p.row);
        const res = await appendOrderPhotoAtomic(orden.id, foto);
        if (res?.error) throw res.error;

        entry.status = 'saved';
        entry.error = null;
        mostrarPendientes(p.row);
      } catch (error) {
        entry.status = 'error';
        entry.error = error;
        fallos.push({ codigo: item.codigo, entry, error });
        console.error('No se pudo guardar foto inicial del artículo ' + (item.codigo || ''), error);
        mostrarPendientes(p.row);
      }
    }
  }

  // La copia local queda sincronizada con el último read-back confirmado.
  await persist();

  // Contar exclusivamente las entradas de ESTE intento. Así una selección nueva
  // realizada mientras termina el guardado no altera el resultado N/N mostrado.
  const saved = pendientes.reduce((n, p) => n + p.entries.filter(e => e.status === 'saved').length, 0);
  const failed = Math.max(0, expected - saved);
  pendientes.forEach(p => limpiarGuardadasDeFila(p.row));
  return { expected, saved, failed, fallos };
}

async function procesarDespuesDeGuardar(pendientes, idAntes, idsAntes, resultado) {
  if (!pendientes.length) return;
  let ordenId = idAntes || document.getElementById('orden-id')?.value || '';
  if (!ordenId) {
    const nueva = (state.ordenes || []).find(o => !idsAntes.has(o.id));
    ordenId = nueva ? nueva.id : (typeof resultado === 'string' ? resultado : '');
  }
  if (!ordenId) return;

  const orden = (state.ordenes || []).find(o => o.id === ordenId);
  const numero = orden?.numero || '—';
  const r = await guardarFotosPendientes(ordenId, pendientes);
  if (!r.expected) return;

  if (r.failed === 0) {
    showToast('✅ Orden #' + numero + ' y ' + r.saved + '/' + r.expected + ' fotos guardadas correctamente.');
    return;
  }

  const codigos = Array.from(new Set(r.fallos.map(f => f.codigo).filter(Boolean)));
  const articulo = codigos.length === 1 ? ' del artículo ' + codigos[0] : (codigos.length ? ' de los artículos ' + codigos.join(', ') : '');
  showToast('⚠️ Orden #' + numero + ' guardada, pero no se pudo guardar la foto' + articulo + '. Intente nuevamente. (' + r.saved + '/' + r.expected + ')');
}

function envolverGuardado(nombre, marca, intento = 0) {
  const original = window[nombre];
  if (typeof original !== 'function') {
    if (intento < 40) setTimeout(() => envolverGuardado(nombre, marca, intento + 1), 50);
    return;
  }
  if (original[marca]) return;
  const wrapper = async function(...args) {
    const pendientes = snapshotPendientes();
    const idAntes = document.getElementById('orden-id')?.value || '';
    const idsAntes = new Set((state.ordenes || []).map(o => o.id));
    const resultado = await original.apply(this, args);
    await procesarDespuesDeGuardar(pendientes, idAntes, idsAntes, resultado);
    return resultado;
  };
  wrapper[marca] = true;
  window[nombre] = wrapper;
}

function hayPendientes() {
  return Array.from(document.querySelectorAll('#orden-items-list .orden-item-row')).some(row => entradasFila(row).length > 0);
}

function instalar() {
  window.__smHayFotosItemPendientes = hayPendientes;
  envolverGuardado('saveOrden', '__smConfirmedItemPhotos');
  // El botón visible usa saveOrdenYMantener y llama internamente al binding
  // léxico saveOrden, por eso se envuelve también explícitamente.
  envolverGuardado('saveOrdenYMantener', '__smConfirmedItemPhotosKeepOpen');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
