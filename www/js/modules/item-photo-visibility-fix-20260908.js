import { state, persist } from '../state.js';
import * as storageManager from '../storage-manager.js';
import { showToast, ordenById, logActivity } from '../ui.js';
import { appendOrderPhotoAtomic } from '../photo-store.js';
import './photo-integrity-runtime-20260909.js';

let detalleOrdenActual = null;
let renderGen = 0;
const R2_ORDER_FILES_CACHE = new Map();
const R2_ORDER_FILES_PENDING = new Map();
const R2_ORDER_FILES_TTL_MS = 5 * 60 * 1000;

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

function fotoVinculadaAlItem(f, item) {
  return !!(f && item && (f.itemId === item.id || f.item === item.codigo));
}

function esFotoInicialCompatible(f, item) {
  if (!fotoVinculadaAlItem(f, item)) return false;
  if (f.categoria === 'item_inicial') return true;

  // Compatibilidad histórica: hubo versiones que guardaban la foto tomada
  // desde "Agregar foto" del artículo como `todos_pares`, pero conservaban
  // explícitamente `item`/`itemId`. Una foto general real no tiene vínculo a
  // un artículo. Solo este caso inequívoco se trata como foto inicial.
  return f.categoria === 'todos_pares' && !!(f.item || f.itemId);
}

function fotosDelItem(orden, item) {
  return todasFotosOrden(orden).filter(f => esFotoInicialCompatible(f, item));
}

function pathFoto(f) {
  if (!f) return '';
  if (f.path) return String(f.path).replace(/^r2:\/\//, '').replace(/^\/+/, '');
  if (typeof f.url === 'string' && f.url.startsWith('r2://')) return f.url.slice(5).replace(/^\/+/, '');
  return '';
}

async function listarArchivosOrdenR2(ordenId) {
  const cached = R2_ORDER_FILES_CACHE.get(ordenId);
  if (cached && cached.expiresAt > Date.now()) return cached.files;
  if (R2_ORDER_FILES_PENDING.has(ordenId)) return R2_ORDER_FILES_PENDING.get(ordenId);

  const p = (async () => {
    try {
      const files = await storageManager.listOrdenFiles(ordenId);
      const lista = Array.isArray(files) ? files : [];
      R2_ORDER_FILES_CACHE.set(ordenId, { files: lista, expiresAt: Date.now() + R2_ORDER_FILES_TTL_MS });
      return lista;
    } catch (e) {
      console.warn('No se pudo auditar R2 para la orden ' + ordenId + ':', e);
      return [];
    } finally {
      R2_ORDER_FILES_PENDING.delete(ordenId);
    }
  })();

  R2_ORDER_FILES_PENDING.set(ordenId, p);
  return p;
}

/**
 * Recuperación visual NO destructiva de huérfanas R2.
 * Solo se usa cuando la asociación es matemáticamente inequívoca:
 * exactamente 1 artículo sin foto + exactamente 1 objeto `foto_item_inicial`
 * que existe en R2 pero no está referenciado en Supabase.
 * No escribe ni cambia datos; las asociaciones ambiguas nunca se adivinan.
 */
async function fotoHuerfanaR2Segura(orden, item, items) {
  const faltantes = items.filter(it => fotosDelItem(orden, it).length === 0);
  if (faltantes.length !== 1 || faltantes[0].id !== item.id) return [];

  const conocidas = new Set(todasFotosOrden(orden).map(pathFoto).filter(Boolean));
  const archivos = await listarArchivosOrdenR2(orden.id);
  const huerfanas = archivos.filter(file => {
    const p = pathFoto(file);
    const nombre = String(file?.name || p.split('/').pop() || '');
    return p && /foto_item_inicial_/i.test(nombre) && !conocidas.has(p);
  });

  if (huerfanas.length !== 1) {
    if (huerfanas.length > 1) {
      console.warn('Recuperación R2 ambigua: orden #' + (orden.numero || '') + ' tiene ' + huerfanas.length + ' fotos iniciales huérfanas para ' + faltantes.length + ' artículo(s) faltante(s). No se asignó ninguna automáticamente.');
    }
    return [];
  }

  const f = huerfanas[0];
  return [{
    url: f.url || ('r2://' + pathFoto(f)),
    path: pathFoto(f),
    categoria: 'item_inicial',
    itemId: item.id,
    item: item.codigo,
    __smRecoveredReadOnly: true
  }];
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

function ocultarRenderAntiguoFoto(card) {
  const img = card.querySelector('img[title="Foto del artículo"]');
  if (!img) return;
  const wrap = img.parentElement;
  if (wrap && wrap.tagName === 'DIV') wrap.remove();
  else img.remove();
}

async function renderFotosEnDetalle(ordenId) {
  const cont = document.getElementById('orden-detalle-items');
  const orden = ordenById(ordenId);
  if (!cont || !orden) return;

  const gen = ++renderGen;
  const items = itemsOrden(ordenId);
  const cards = Array.from(cont.children).filter(el => el.classList && el.classList.contains('panel'));

  cont.querySelectorAll('.sm-item-fotos-visible,.sm-fotos-ingreso-orden').forEach(x => x.remove());

  for (let i = 0; i < cards.length && i < items.length; i++) {
    const card = cards[i];
    const item = items[i];

    // Un único render controla la foto bajo Ingreso / Entrega. Así el render
    // histórico de items.js no puede duplicarla, parpadear ni colar una foto
    // de Producción como si fuera la foto inicial.
    ocultarRenderAntiguoFoto(card);

    let fotos = fotosDelItem(orden, item);
    if (!fotos.length) fotos = await fotoHuerfanaR2Segura(orden, item, items);
    if (gen !== renderGen) return;
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

    const res = await appendOrderPhotoAtomic(orden.id, fotoData);
    if (res && res.error) throw res.error;
    R2_ORDER_FILES_CACHE.delete(orden.id);
    await persist();

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
  if (typeof originalDetalle === 'function' && !originalDetalle.__smFotoVisibleV7) {
    const wrapped = function(id, preselectItemId) {
      detalleOrdenActual = id;
      const r = originalDetalle(id, preselectItemId);
      Promise.resolve(r).finally(() => setTimeout(() => renderFotosEnDetalle(id), 0));
      return r;
    };
    wrapped.__smFotoVisibleV7 = true;
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
