import { state, persist, esAdmin } from '../state.js';
import * as storageManager from '../storage-manager.js';
import { showToast } from '../ui.js';
import { deleteOrderPhotoAtomic } from '../photo-store.js';

let bridgeGen = 0;
let observer = null;

function ordenActualGaleria() {
  const id = document.getElementById('galeria-orden-select')?.value || '';
  if (!id || id === '__ALL__') return null;
  return (state.ordenes || []).find(o => o.id === id) || null;
}

function itemFiltradoPorUI(ordenId) {
  const search = document.getElementById('galeria-orden-search');
  const value = (search?.value || '').trim();
  const m = value.match(/^#([^·]+)\s*·/);
  if (!m) return null;
  const codigo = m[1].trim();
  return (state.ordenItems || []).find(it => it.ordenId === ordenId && String(it.codigo || '') === codigo) || null;
}

function fotoKeyLocal(foto) {
  if (!foto || typeof foto !== 'object') return '';
  if (foto.path) return String(foto.path).replace(/^r2:\/\//, '').replace(/^\/+/, '');
  if (foto.url?.startsWith('r2://')) return foto.url.slice(5).replace(/^\/+/, '');
  return foto.url || JSON.stringify(foto);
}

async function eliminarFotoPorReferencia(ordenId, foto) {
  if (!esAdmin()) {
    showToast('Solo el Administrador puede eliminar fotos de la galería');
    return false;
  }
  if (!foto || !confirm('¿Eliminar esta fotografía?')) return false;

  const res = await deleteOrderPhotoAtomic(ordenId, foto);
  if (res?.error) {
    console.error('No se pudo eliminar la referencia de foto:', res.error);
    showToast('Error al eliminar la fotografía: ' + (res.error.message || ''));
    return false;
  }

  await persist();

  const path = foto.path || (typeof foto.url === 'string' && foto.url.startsWith('r2://')
    ? foto.url.slice(5).replace(/^\/+/, '')
    : '');
  if (path) {
    try { await storageManager.deleteFile(path); }
    catch (e) { console.warn('La referencia se eliminó, pero no se pudo borrar el objeto R2:', e); }
  }

  showToast('Fotografía eliminada');
  try {
    if (typeof window.renderGaleria === 'function') await window.renderGaleria();
  } catch (_) {}
  return true;
}

function instalarEliminacionAtomica(intento = 0) {
  const original = window.eliminarFoto;
  if (typeof original !== 'function') {
    if (intento < 80) setTimeout(() => instalarEliminacionAtomica(intento + 1), 50);
    return;
  }
  if (original.__smAtomicPhotoDelete) return;

  const wrapped = async function(ordenId, globalIdx, cat, itemId) {
    const orden = (state.ordenes || []).find(o => o.id === ordenId);
    const fotos = Array.isArray(orden?.extra?.fotos) ? orden.extra.fotos : [];
    const candidatas = fotos.filter(f => f?.categoria === cat && (!itemId || f.itemId === itemId));
    const foto = candidatas[globalIdx];
    if (!foto) {
      showToast('Foto no encontrada');
      return;
    }
    await eliminarFotoPorReferencia(ordenId, foto);
  };
  wrapped.__smAtomicPhotoDelete = true;
  window.eliminarFoto = wrapped;
}

function crearThumb(foto, urls, ordenId) {
  const wrap = document.createElement('div');
  wrap.className = 'gallery-thumb-wrap';

  const img = document.createElement('img');
  img.src = foto.resolvedUrl;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = 'Foto inicial del artículo';
  img.title = [foto.item ? '#' + foto.item : '', foto.fecha || ''].filter(Boolean).join(' · ');
  img.onclick = () => {
    if (typeof window.ampliarImagen === 'function') window.ampliarImagen(foto.resolvedUrl, urls);
  };
  wrap.appendChild(img);

  if (esAdmin()) {
    const del = document.createElement('button');
    del.className = 'gallery-delete-btn';
    del.type = 'button';
    del.title = 'Eliminar';
    del.textContent = '×';
    del.onclick = async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      await eliminarFotoPorReferencia(ordenId, foto);
    };
    wrap.appendChild(del);
  }

  return wrap;
}

async function renderFotosInicialesEnGaleria() {
  const gen = ++bridgeGen;
  const content = document.getElementById('galeria-content');
  if (!content) return;

  const orden = ordenActualGaleria();
  const existente = content.querySelector('.sm-galeria-item-inicial');
  if (!orden) {
    existente?.remove();
    return;
  }

  const item = itemFiltradoPorUI(orden.id);
  let fotos = Array.isArray(orden.extra?.fotos)
    ? orden.extra.fotos.filter(f => f && f.categoria === 'item_inicial')
    : [];
  if (item) fotos = fotos.filter(f => f.itemId === item.id || f.item === item.codigo);

  const signature = [orden.id, item?.id || 'ALL', ...fotos.map(fotoKeyLocal)].join('|');
  if (existente?.dataset.signature === signature) return;
  existente?.remove();
  if (!fotos.length) return;

  const resueltas = await storageManager.resolveImageUrls(fotos);
  if (gen !== bridgeGen) return;
  const validas = resueltas.filter(f => f?.resolvedUrl && !String(f.resolvedUrl).startsWith('r2://'));
  if (!validas.length) return;

  const cat = document.createElement('div');
  cat.className = 'gallery-cat sm-galeria-item-inicial';
  cat.dataset.signature = signature;

  const h4 = document.createElement('h4');
  h4.textContent = item
    ? 'Ingreso · Artículo #' + item.codigo + ' (' + validas.length + ')'
    : 'Ingreso · Fotos iniciales (' + validas.length + ')';
  cat.appendChild(h4);

  const thumbs = document.createElement('div');
  thumbs.className = 'gallery-thumbs';
  thumbs.style.display = 'flex';
  const urls = validas.map(f => f.resolvedUrl);
  validas.forEach(f => thumbs.appendChild(crearThumb(f, urls, orden.id)));
  cat.appendChild(thumbs);

  const cats = content.querySelector('.gallery-cats');
  if (cats) cats.insertBefore(cat, cats.firstChild || null);
  else content.insertBefore(cat, content.firstChild || null);
}

function mutationEsSoloBridge(mutations) {
  return mutations.length > 0 && mutations.every(m => {
    const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])].filter(n => n?.nodeType === 1);
    return nodes.length > 0 && nodes.every(n => n.matches?.('.sm-galeria-item-inicial') || n.closest?.('.sm-galeria-item-inicial'));
  });
}

function instalarBridgeGaleria() {
  if (observer) return;
  const content = document.getElementById('galeria-content');
  if (!content) {
    setTimeout(instalarBridgeGaleria, 100);
    return;
  }

  observer = new MutationObserver(mutations => {
    if (mutationEsSoloBridge(mutations)) return;
    clearTimeout(observer.__t);
    observer.__t = setTimeout(() => renderFotosInicialesEnGaleria().catch(() => {}), 60);
  });
  observer.observe(content, { childList: true, subtree: true });
  renderFotosInicialesEnGaleria().catch(() => {});
}

function instalar() {
  instalarEliminacionAtomica();
  instalarBridgeGaleria();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
