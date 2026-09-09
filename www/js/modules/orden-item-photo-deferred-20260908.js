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
import * as db from '../db.js';
import * as storageManager from '../storage-manager.js';
import { showToast } from '../ui.js';
import { supabase } from '../config.js';

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

function agregarFotosLegacy(destino, origen) {
  if (!origen) return;
  if (Array.isArray(origen)) {
    origen.forEach(f => { if (f) destino.push(typeof f === 'string' ? { url: f } : f); });
    return;
  }
  if (typeof origen === 'object') {
    Object.entries(origen).forEach(([categoria, lista]) => {
      if (!Array.isArray(lista)) return;
      lista.forEach(f => {
        if (!f) return;
        destino.push(typeof f === 'string' ? { url: f, categoria } : { ...f, categoria: f.categoria || categoria });
      });
    });
  }
}

function asegurarFotosSinPerdida(orden) {
  const reunidas = [];
  agregarFotosLegacy(reunidas, orden?.extra?.fotos);
  agregarFotosLegacy(reunidas, orden?.fotos);
  const vistas = new Set();
  const unicas = reunidas.filter(f => {
    const k = f?.path || f?.url || JSON.stringify(f);
    if (!k || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  orden.extra = orden.extra || {};
  orden.extra.fotos = unicas;
  return orden.extra.fotos;
}

function keyPath(foto) {
  if (foto?.path) return String(foto.path).replace(/^r2:\/\//, '');
  if (typeof foto?.url === 'string' && foto.url.startsWith('r2://')) return foto.url.slice(5).replace(/^\/+/, '');
  return '';
}

function recolectarPathsFotos(nodo, salida = new Set(), vistos = new Set()) {
  if (!nodo || typeof nodo !== 'object' || vistos.has(nodo)) return salida;
  vistos.add(nodo);
  if (Array.isArray(nodo)) {
    nodo.forEach(x => recolectarPathsFotos(x, salida, vistos));
    return salida;
  }
  const k = keyPath(nodo);
  if (k) salida.add(k);
  Object.values(nodo).forEach(x => recolectarPathsFotos(x, salida, vistos));
  return salida;
}

async function confirmarPathsEnSupabase(ordenId, paths) {
  const esperadas = Array.from(new Set((paths || []).map(String).filter(Boolean)));
  if (!esperadas.length) return { ok: true, confirmed: [], missing: [] };
  if (!supabase) return { ok: false, confirmed: [], missing: esperadas, error: new Error('Supabase no disponible') };
  try {
    const { data, error } = await supabase.from('ordenes').select('extra').eq('id', ordenId).single();
    if (error) throw error;
    const presentes = recolectarPathsFotos(data?.extra || {});
    const confirmed = esperadas.filter(x => presentes.has(x.replace(/^r2:\/\//, '')));
    const missing = esperadas.filter(x => !presentes.has(x.replace(/^r2:\/\//, '')));
    return { ok: missing.length === 0, confirmed, missing };
  } catch (error) {
    return { ok: false, confirmed: [], missing: esperadas, error };
  }
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
  const fotosOrden = asegurarFotosSinPerdida(orden);
  const candidatos = [];
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
          foto.item = item.codigo;
          foto.itemId = item.id;
          foto.categoria = 'item_inicial';
          entry.uploadedFoto = foto;
        } else {
          foto.item = item.codigo;
          foto.itemId = item.id;
          foto.categoria = 'item_inicial';
        }

        const k = keyPath(foto) || foto.url;
        if (!fotosOrden.some(f => (keyPath(f) || f?.url) === k)) fotosOrden.push(foto);
        entry.status = 'confirming';
        candidatos.push({ p, item, entry, foto });
        mostrarPendientes(p.row);
      } catch (error) {
        entry.status = 'error';
        entry.error = error;
        fallos.push({ codigo: item.codigo, entry, error });
        console.error('No se pudo subir foto inicial del artículo ' + (item.codigo || ''), error);
        mostrarPendientes(p.row);
      }
    }
  }

  if (candidatos.length) {
    try {
      await persist();
      const res = await db.saveOrden(orden);
      if (res?.queued) throw new Error('La referencia quedó en cola y todavía no fue confirmada en Supabase');
      if (res?.error) throw res.error;

      const paths = candidatos.map(x => keyPath(x.foto)).filter(Boolean);
      const confirmacion = await confirmarPathsEnSupabase(ordenId, paths);
      const confirmadas = new Set((confirmacion.confirmed || []).map(x => String(x).replace(/^r2:\/\//, '')));

      for (const c of candidatos) {
        const k = keyPath(c.foto);
        if (k && confirmadas.has(k)) {
          c.entry.status = 'saved';
          c.entry.error = null;
        } else {
          c.entry.status = 'error';
          c.entry.error = confirmacion.error || new Error('Supabase no confirmó la referencia de la foto');
          fallos.push({ codigo: c.item.codigo, entry: c.entry, error: c.entry.error });
        }
      }
    } catch (error) {
      for (const c of candidatos) {
        c.entry.status = 'error';
        c.entry.error = error;
        fallos.push({ codigo: c.item.codigo, entry: c.entry, error });
      }
      console.error('No se pudieron confirmar las fotos iniciales en Supabase:', error);
    }
  }

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
