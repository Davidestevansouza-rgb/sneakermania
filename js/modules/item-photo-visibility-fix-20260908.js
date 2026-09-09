import { state, persist } from '../state.js';
import * as db from '../db.js';
import * as storageManager from '../storage-manager.js';
import { showToast, ordenById, logActivity } from '../ui.js';

let detalleOrdenActual = null;
let renderGen = 0;

function itemsOrden(ordenId) {
  return (state.ordenItems || []).filter(it => it.ordenId === ordenId).sort((a,b) => (a.numeroItem || 0) - (b.numeroItem || 0));
}

function agregarFotosColeccion(destino, origen, categoriaFallback = null) {
  if (!origen) return;
  if (Array.isArray(origen)) {
    for (const f of origen) {
      if (!f) continue;
      destino.push(typeof f === 'string'
        ? { url: f, categoria: categoriaFallback || undefined }
        : { ...f, categoria: f.categoria || categoriaFallback || undefined });
    }
    return;
  }
  if (typeof origen === 'object') {
    for (const [categoria, lista] of Object.entries(origen)) {
      if (!Array.isArray(lista)) continue;
      agregarFotosColeccion(destino, lista, categoria);
    }
  }
}

function todasFotosOrden(orden) {
  const encontradas = [];
  const vistosNodos = new Set();
  let nodo = orden;
  while (nodo && typeof nodo === 'object' && !Array.isArray(nodo) && !vistosNodos.has(nodo)) {
    vistosNodos.add(nodo);
    agregarFotosColeccion(encontradas, nodo.fotos);
    nodo = nodo.extra && typeof nodo.extra === 'object' && !Array.isArray(nodo.extra) ? nodo.extra : null;
  }
  const claves = new Set();
  return encontradas.filter(f => {
    const key = f.path || f.url || JSON.stringify(f);
    if (!key || claves.has(key)) return false;
    claves.add(key);
    return true;
  });
}

function fotosDelItem(orden, item) {
  // Debajo de Ingreso/Entrega solo corresponde la evidencia inicial tomada
  // en recepción. Las fotos de Producción (detalle/suela/laterales/etc.) se
  // muestran en sus vistas propias y nunca reemplazan esta evidencia.
  return todasFotosOrden(orden).filter(f => f && f.categoria === 'item_inicial' && (f.itemId === item.id || f.item === item.codigo));
}

async function resolverFotos(fotos) {
  if (!fotos.length) return [];
  try {
    const resueltas = await storageManager.resolveImageUrls(fotos);
    return resueltas.filter(f => f && f.resolvedUrl && !String(f.resolvedUrl).startsWith('r2://'));
  } catch (e) {
    console.warn('No se pudieron resolver algunas fotos R2 del detalle:', e);
    return [];
  }
}

function crearGaleriaFotos(validas, item) {
  const box = document.createElement('div');
  box.className = 'sm-item-fotos-visible';
  box.dataset.itemId = item.id || '';
  box.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;';
  for (const foto of validas) {
    const img = document.createElement('img');
    img.src = foto.resolvedUrl;
    img.loading = 'lazy';
    img.alt = 'Foto del artículo ' + item.codigo;
    img.style.cssText = 'width:90px;height:90px;object-fit:cover;border-radius:7px;border:1px solid var(--line);cursor:pointer;';
    img.onclick = () => {
      if (typeof window.ampliarImagen === 'function') {
        window.ampliarImagen(foto.resolvedUrl, validas.map(x => x.resolvedUrl));
      }
    };
    box.appendChild(img);
  }
  return box;
}

function insertarDebajoDeFechas(card, box) {
  const izquierda = card.firstElementChild?.firstElementChild || card;
  const fechas = Array.from(izquierda.querySelectorAll('.hint')).find(el => {
    const t = (el.textContent || '').trim();
    return t.startsWith('Ingreso:') && t.includes('Entrega estimada:');
  });
  if (fechas && fechas.parentNode === izquierda) fechas.insertAdjacentElement('afterend', box);
  else izquierda.appendChild(box);
}

async function renderFotosEnDetalle(ordenId) {
  const cont = document.getElementById('orden-detalle-items');
  const orden = ordenById(ordenId);
  if (!cont || !orden) return;

  const gen = ++renderGen;
  const items = itemsOrden(ordenId);
  const cards = Array.from(cont.children).filter(el => el.classList && el.classList.contains('panel'));

  cont.querySelectorAll('.sm-item-fotos-visible,.sm-fotos-ingreso-orden').forEach(x => x.remove());

  // Fotos correctamente vinculadas: siempre debajo del artículo exacto.
  for (let i = 0; i < cards.length && i < items.length; i++) {
    const card = cards[i];
    const item = items[i];
    const fotos = fotosDelItem(orden, item);
    if (!fotos.length) continue;

    const validas = await resolverFotos(fotos);
    if (gen !== renderGen) return;
    if (!validas.length) continue;

    insertarDebajoDeFechas(card, crearGaleriaFotos(validas, item));
  }

}

async function agregarFotoItemVisible(itemId, file) {
  if (!file) return;
  const item = (state.ordenItems || []).find(it => it.id === itemId);
  if (!item) { showToast('Artículo no encontrado'); return; }
  const orden = ordenById(item.ordenId);
  if (!orden) { showToast('Orden no encontrada'); return; }

  showToast('Subiendo foto del artículo...');
  try {
    const fotoData = await storageManager.uploadFoto(file, orden.id, 'item_inicial');
    fotoData.item = item.codigo;
    fotoData.itemId = item.id;
    fotoData.categoria = 'item_inicial';

    orden.extra = orden.extra || {};
    const existentes = todasFotosOrden(orden);
    orden.extra.fotos = existentes;
    orden.extra.fotos.push(fotoData);

    await persist();
    const res = await db.saveOrden(orden);
    if (res && res.error && !res.queued) throw res.error;

    logActivity('Agregó foto al artículo ' + item.codigo);
    showToast('✅ Foto guardada');
    if (detalleOrdenActual === item.ordenId) await renderFotosEnDetalle(item.ordenId);
    if (typeof window.renderGaleria === 'function') window.renderGaleria();
  } catch (e) {
    console.error('Error subiendo foto del artículo:', e);
    showToast('❌ Error subiendo foto: ' + (e && e.message ? e.message : ''));
  }
}

function instalar() {
  window.agregarFotoItem = agregarFotoItemVisible;

  const originalDetalle = window.viewOrdenDetalle;
  if (typeof originalDetalle === 'function' && !originalDetalle.__smFotoVisibleV6) {
    const wrapped = function(id, preselectItemId) {
      detalleOrdenActual = id;
      const r = originalDetalle(id, preselectItemId);
      Promise.resolve(r).finally(() => setTimeout(() => renderFotosEnDetalle(id), 0));
      return r;
    };
    wrapped.__smFotoVisibleV6 = true;
    window.viewOrdenDetalle = wrapped;
  }

  const observer = new MutationObserver((mutations) => {
    const soloPropias = mutations.length > 0 && mutations.every(m => {
      const targetPropio = m.target?.closest?.('.sm-item-fotos-visible');
      const nodos = [...m.addedNodes, ...m.removedNodes].filter(n => n && n.nodeType === 1);
      return !!targetPropio || (nodos.length > 0 && nodos.every(n => n.matches?.('.sm-item-fotos-visible') || n.closest?.('.sm-item-fotos-visible')));
    });
    if (soloPropias) return;

    if (detalleOrdenActual && document.getElementById('orden-detalle-items')) {
      clearTimeout(observer.__t);
      observer.__t = setTimeout(() => renderFotosEnDetalle(detalleOrdenActual), 80);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
