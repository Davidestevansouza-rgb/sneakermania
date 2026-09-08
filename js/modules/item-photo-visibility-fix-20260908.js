import { state, persist } from '../state.js';
import * as db from '../db.js';
import * as storageManager from '../storage-manager.js';
import { showToast, ordenById, logActivity } from '../ui.js';

let detalleOrdenActual = null;
let renderGen = 0;

function itemsOrden(ordenId) {
  return (state.ordenItems || []).filter(it => it.ordenId === ordenId).sort((a,b) => (a.numeroItem || 0) - (b.numeroItem || 0));
}

function fotosDelItem(orden, item) {
  const fotos = orden && orden.extra && Array.isArray(orden.extra.fotos) ? orden.extra.fotos : [];
  return fotos.filter(f => f && (f.itemId === item.id || (!f.itemId && f.item === item.codigo)));
}

function normalizarVinculosEnMemoria(orden) {
  if (!orden || !orden.extra || !Array.isArray(orden.extra.fotos)) return false;
  const items = itemsOrden(orden.id);
  let cambio = false;
  for (const foto of orden.extra.fotos) {
    if (!foto) continue;
    if (!foto.itemId && foto.item) {
      const item = items.find(it => it.codigo === foto.item);
      if (item) {
        foto.itemId = item.id;
        cambio = true;
      }
    }
    // Las fotos iniciales de artículo deben aparecer en "Todos los archivos".
    if (foto.itemId && (foto.categoria === 'item_inicial' || !foto.categoria)) {
      foto.categoria = 'todos_pares';
      cambio = true;
    }
  }
  return cambio;
}

async function renderFotosEnDetalle(ordenId) {
  const cont = document.getElementById('orden-detalle-items');
  const orden = ordenById(ordenId);
  if (!cont || !orden) return;
  const gen = ++renderGen;
  normalizarVinculosEnMemoria(orden);
  const items = itemsOrden(ordenId);
  const cards = Array.from(cont.children).filter(el => el.classList && el.classList.contains('panel'));
  for (let i = 0; i < cards.length && i < items.length; i++) {
    const card = cards[i];
    const item = items[i];
    card.querySelectorAll('.sm-item-fotos-visible').forEach(x => x.remove());
    const fotos = fotosDelItem(orden, item);
    if (!fotos.length) continue;
    let resueltas;
    try { resueltas = await storageManager.resolveImageUrls(fotos); }
    catch (_) { resueltas = fotos.map(f => ({...f, resolvedUrl: f.url})); }
    if (gen !== renderGen) return;
    const validas = resueltas.filter(f => f && f.resolvedUrl && !String(f.resolvedUrl).startsWith('r2://'));
    if (!validas.length) continue;
    const box = document.createElement('div');
    box.className = 'sm-item-fotos-visible';
    box.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;justify-content:flex-end;max-width:300px;';
    for (const foto of validas) {
      const img = document.createElement('img');
      img.src = foto.resolvedUrl;
      img.loading = 'lazy';
      img.alt = 'Foto del artículo ' + item.codigo;
      img.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:7px;border:1px solid var(--line);cursor:pointer;';
      img.onclick = () => {
        if (typeof window.ampliarImagen === 'function') window.ampliarImagen(foto.resolvedUrl, validas.map(x => x.resolvedUrl));
      };
      box.appendChild(img);
    }
    const estado = Array.from(card.querySelectorAll('span.hint')).find(el => (el.textContent || '').trim().startsWith('Estado:'));
    const destino = estado ? estado.closest('div[style*="flex-direction:column"]') : null;
    (destino || card).appendChild(box);
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
    orden.extra.fotos = Array.isArray(orden.extra.fotos) ? orden.extra.fotos : [];
    // IMPORTANTE: agregar, nunca reemplazar fotos anteriores del mismo artículo.
    orden.extra.fotos.push(fotoData);
    normalizarVinculosEnMemoria(orden);
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
  // Se instala al final del arranque para prevalecer sobre wrappers antiguos
  // que reemplazaban la foto anterior o no guardaban itemId.
  window.agregarFotoItem = agregarFotoItemVisible;

  const originalDetalle = window.viewOrdenDetalle;
  if (typeof originalDetalle === 'function' && !originalDetalle.__smFotoVisibleV3) {
    const wrapped = function(id, preselectItemId) {
      detalleOrdenActual = id;
      const r = originalDetalle(id, preselectItemId);
      setTimeout(() => renderFotosEnDetalle(id), 0);
      return r;
    };
    wrapped.__smFotoVisibleV3 = true;
    window.viewOrdenDetalle = wrapped;
  }

  const originalGaleria = window.renderGaleria;
  if (typeof originalGaleria === 'function' && !originalGaleria.__smFotoVisibleV3) {
    const wrappedGaleria = function(...args) {
      // Compatibilidad con fotos ya guardadas sin itemId: las vinculamos en memoria
      // antes de que Galería aplique su filtro por itemId.
      (state.ordenes || []).forEach(normalizarVinculosEnMemoria);
      return originalGaleria.apply(this, args);
    };
    wrappedGaleria.__smFotoVisibleV3 = true;
    window.renderGaleria = wrappedGaleria;
  }

  const observer = new MutationObserver(() => {
    if (detalleOrdenActual && document.getElementById('orden-detalle-items')) {
      clearTimeout(observer.__t);
      observer.__t = setTimeout(() => renderFotosEnDetalle(detalleOrdenActual), 30);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
