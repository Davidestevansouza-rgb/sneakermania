import { state, persist } from '../state.js';
import * as db from '../db.js';
import * as storage from '../storage-manager.js';
import { showToast } from '../ui.js';

if (!window.__smFotosGeneralesFix0906) {
  window.__smFotosGeneralesFix0906 = true;
  queueMicrotask(instalar);
}

let archivosSeleccionados = [];

function claveArchivo(f) {
  return [f?.name || '', f?.size || 0, f?.lastModified || 0].join('|');
}
function claveFoto(f) {
  return f?.path || f?.url || JSON.stringify(f || {});
}
function generales(o) {
  return o?.extra && Array.isArray(o.extra.fotos)
    ? o.extra.fotos.filter(f => f && f.categoria === 'todos_pares')
    : [];
}
function registrarArchivos(fileList) {
  const actuales = new Set(archivosSeleccionados.map(claveArchivo));
  Array.from(fileList || []).forEach(f => {
    if (!f || !(f.type || '').startsWith('image/')) return;
    const k = claveArchivo(f);
    if (!actuales.has(k)) {
      archivosSeleccionados.push(f);
      actuales.add(k);
    }
  });
}

async function reconstruirMiniaturasExistentes() {
  const id = document.getElementById('orden-id')?.value;
  if (!id) return;
  const orden = (state.ordenes || []).find(o => o.id === id);
  const fotos = generales(orden);
  const cont = document.getElementById('orden-fotos-generales-preview');
  if (!cont) return;

  cont.innerHTML = '';
  for (const foto of fotos) {
    const wrap = document.createElement('div');
    wrap.className = 'foto-general-thumb';
    const img = document.createElement('img');
    img.alt = 'Foto general';
    img.loading = 'lazy';
    img.style.cursor = 'pointer';
    try {
      img.src = await storage.resolveImageUrl(foto.url, foto.path) || foto.url || '';
    } catch (_) {
      img.src = foto.url || '';
    }
    img.onclick = () => {
      if (typeof window.ampliarImagen === 'function') window.ampliarImagen(img.src);
    };
    wrap.appendChild(img);
    cont.appendChild(wrap);
  }
}

function envolverOpenOrden() {
  const original = window.openOrdenModal;
  if (typeof original !== 'function' || original.__smFotosGeneralesOpen) return;
  const w = function(...args) {
    archivosSeleccionados = [];
    const r = original.apply(this, args);
    Promise.resolve(r).finally(() => setTimeout(reconstruirMiniaturasExistentes, 0));
    return r;
  };
  w.__smFotosGeneralesOpen = true;
  window.openOrdenModal = w;
}

function envolverSaveOrden() {
  const original = window.saveOrden;
  if (typeof original !== 'function' || original.__smFotosGeneralesSave) return;
  const w = async function(...args) {
    const idAntes = document.getElementById('orden-id')?.value || '';
    const ordenAntes = idAntes ? (state.ordenes || []).find(o => o.id === idAntes) : null;
    const antiguas = generales(ordenAntes).map(f => ({ ...f }));
    const cantidadAntes = antiguas.length;
    const seleccionadas = archivosSeleccionados.slice();

    const resultado = await original.apply(this, args);
    const idDespues = resultado || document.getElementById('orden-id')?.value || idAntes;
    const orden = (state.ordenes || []).find(o => o.id === idDespues);
    if (!orden) {
      if (resultado) archivosSeleccionados = [];
      return resultado;
    }

    orden.extra = orden.extra && typeof orden.extra === 'object' ? orden.extra : {};
    orden.extra.fotos = Array.isArray(orden.extra.fotos) ? orden.extra.fotos : [];

    let cambio = false;
    const existentesAhora = new Set(orden.extra.fotos.map(claveFoto));

    for (const foto of antiguas) {
      const k = claveFoto(foto);
      if (!existentesAhora.has(k)) {
        orden.extra.fotos.push(foto);
        existentesAhora.add(k);
        cambio = true;
      }
    }

    const cantidadGeneralAhora = generales(orden).length;
    const agregadasPorOriginal = Math.max(0, cantidadGeneralAhora - cantidadAntes);
    const faltantes = seleccionadas.slice(agregadasPorOriginal);
    for (const file of faltantes) {
      try {
        const foto = await storage.uploadFoto(file, orden.id, 'todos_pares');
        const k = claveFoto(foto);
        if (!existentesAhora.has(k)) {
          orden.extra.fotos.push(foto);
          existentesAhora.add(k);
          cambio = true;
        }
      } catch (e) {
        console.error('No se pudo guardar foto general:', e);
        showToast('Una foto general no pudo guardarse. Intenta nuevamente.');
      }
    }

    if (cambio) {
      await persist();
      await db.saveOrden(orden);
    }

    archivosSeleccionados = [];
    setTimeout(reconstruirMiniaturasExistentes, 0);
    return resultado;
  };
  w.__smFotosGeneralesSave = true;
  window.saveOrden = w;
}

function instalar() {
  document.addEventListener('change', e => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
    const general = document.getElementById('orden-registro-general');
    if (general?.contains(input) || input.id === 'orden-foto-general-camera' || input.id === 'orden-foto-general-galeria') {
      registrarArchivos(input.files);
    }
  }, true);

  envolverOpenOrden();
  envolverSaveOrden();
  setTimeout(reconstruirMiniaturasExistentes, 0);
}
