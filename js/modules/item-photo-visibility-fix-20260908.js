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
      destino.push(typeof f === 'string' ? { url: f, categoria: categoriaFallback || undefined } : { ...f, categoria: f.categoria || categoriaFallback || undefined });
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
  return todasFotosOrden(orden).filter(f => f && (f.itemId === item.id || f.item === item.codigo));
}

function fotosSinVinculo(orden) {
  return todasFotosOrden(orden).filter(f => f && !f.itemId && !f.item);
}

function normalizarVinculosEnMemoria(orden) {
  if (!orden || !orden.extra) return false;
  const fotos = todasFotosOrden(orden);
  const items = itemsOrden(orden.id);
  let cambio = false;
  for (const foto of fotos) {
    if (!foto.itemId && foto.item) {
      const item = items.find(it => it.codigo === foto.item);
      if (item) { foto.itemId = item.id; cambio = true; }
    }
    if (foto.itemId && (foto.categoria === 'item_inicial' || !foto.categoria)) {
      foto.categoria = 'todos_pares';
      cambio = true;
    }
  }
  return cambio;
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

function crearGaleriaFotos(validas, altBase) {
  const box = document.createElement('div');
  box.className = 'sm-item-fotos-visible';
  box.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;';
  for (const foto of validas) {
    const img = document.createElement('img');
    img.src = foto.resolvedUrl;
    img.loading = 'lazy';
    img.alt = altBase;
    img.style.cssText = 'width:82px;height:82px;object-fit:cover;border-radius:7px;border:1px solid var(--line);cursor:pointer;';
    img.onclick = () => {
      if (typeof window.ampliarImagen === 'function') window.ampliarImagen(foto.resolvedUrl, validas.map(x => x.resolvedUrl));
    };
    box.appendChild(img);
  }
  return box;
}

async function renderFotosEnDetalle(ordenId) {
  const cont = document.getElementById('orden-detalle-items');
  const orden = ordenById(ordenId);
  if (!cont || !orden) return;
  const gen = ++renderGen;
  const items = itemsOrden(ordenId);
  const cards = Array.from(cont.children).filter(el => el.classList && el.classList.contains('panel'));

  cont.querySelectorAll('.sm-item-fotos-visible,.sm-fotos-ingreso-orden').forEach(x => x.remove());

  // 1) Fotos vinculadas a un artículo: SIEMPRE debajo de su tarjeta correcta.
  for (let i = 0; i < cards.length && i < items.length; i++) {
    const card = cards[i];
    const item = items[i];
    const fotos = fotosDelItem(orden, item);
    if (!fotos.length) continue;
    const validas = await resolverFotos(fotos);
    if (gen !== renderGen) return;
    if (!validas.length) continue;
    const box = crearGaleriaFotos(validas, 'Foto del artículo ' + item.codigo);
    const izquierda = card.querySelector('div > div');
    (izquierda || card).appendChild(box);
  }

  // 2) Compatibilidad histórica: fotos que sí existen en R2 pero fueron
  // guardadas sin itemId/item. Nunca se asignan a un precinto al azar.
  const huerfanas = fotosSinVinculo(orden);
  if (huerfanas.length) {
    const validas = await resolverFotos(huerfanas);
    if (gen !== renderGen) return;
    if (validas.length) {
      // Si la orden tiene un solo artículo, no existe ambigüedad: se muestra
      // directamente dentro de esa tarjeta. Con varios artículos se muestra
      // arriba como "Fotos de ingreso de la orden" para no atribuir una foto
      // al precinto equivocado.
      if (items.length === 1 && cards[0]) {
        const box = crearGaleriaFotos(validas, 'Foto de ingreso del artículo');
        const izquierda = cards[0].querySelector('div > div');
        (izquierda || cards[0]).appendChild(box);
      } else {
        const bloque = document.createElement('div');
        bloque.className = 'sm-fotos-ingreso-orden';
        bloque.style.cssText = 'margin:0 0 10px 0;padding:9px 10px;border:1px dashed var(--line);border-radius:8px;';
        const titulo = document.createElement('div');
        titulo.className = 'hint';
        titulo.style.fontWeight = '700';
        titulo.textContent = '📷 Fotos de ingreso de la orden';
        bloque.appendChild(titulo);
        bloque.appendChild(crearGaleriaFotos(validas, 'Foto de ingreso de la orden'));
        cont.insertBefore(bloque, cont.firstChild);
      }
    }
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
    const fotoData = await storageManager.uploadFoto(file, orden.id, 'todos_pares');
    fotoData.item = item.codigo;
    fotoData.itemId = item.id;
    fotoData.categoria = 'todos_pares';
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
  if (typeof originalDetalle === 'function' && !originalDetalle.__smFotoVisibleV4) {
    const wrapped = function(id, preselectItemId) {
      detalleOrdenActual = id;
      const r = originalDetalle(id, preselectItemId);
      Promise.resolve(r).finally(() => setTimeout(() => renderFotosEnDetalle(id), 0));
      return r;
    };
    wrapped.__smFotoVisibleV4 = true;
    window.viewOrdenDetalle = wrapped;
  }

  const originalGaleria = window.renderGaleria;
  if (typeof originalGaleria === 'function' && !originalGaleria.__smFotoVisibleV4) {
    const wrappedGaleria = function(...args) {
      return originalGaleria.apply(this, args);
    };
    wrappedGaleria.__smFotoVisibleV4 = true;
    window.renderGaleria = wrappedGaleria;
  }

  const observer = new MutationObserver((mutations) => {
    const soloPropias = mutations.length > 0 && mutations.every(m => {
      const targetPropio = m.target?.closest?.('.sm-item-fotos-visible,.sm-fotos-ingreso-orden');
      const nodos = [...m.addedNodes, ...m.removedNodes].filter(n => n && n.nodeType === 1);
      return !!targetPropio || (nodos.length > 0 && nodos.every(n => n.matches?.('.sm-item-fotos-visible,.sm-fotos-ingreso-orden') || n.closest?.('.sm-item-fotos-visible,.sm-fotos-ingreso-orden')));
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
