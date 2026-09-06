import { state } from '../state.js';
import * as storage from '../storage-manager.js';

if (!window.__smFotosGeneralesFix0906) {
  window.__smFotosGeneralesFix0906 = true;
  queueMicrotask(instalar);
  setTimeout(instalar, 300);
  setTimeout(instalar, 1200);
}

let cacheVisual = [];
let observer = null;
let restaurando = false;

function generales(o) {
  return o?.extra && Array.isArray(o.extra.fotos)
    ? o.extra.fotos.filter(f => f && f.categoria === 'todos_pares')
    : [];
}

function modalOrdenVisible() {
  const modal = document.getElementById('modal-orden');
  if (!modal) return false;
  const cs = getComputedStyle(modal);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function contenedor() {
  return document.getElementById('orden-fotos-generales-preview');
}

function capturarVisual() {
  const cont = contenedor();
  if (!cont) return;
  const urls = Array.from(cont.querySelectorAll('img'))
    .map(img => img.currentSrc || img.src || '')
    .filter(Boolean);
  if (urls.length) cacheVisual = [...new Set(urls)];
}

function crearThumb(url) {
  const wrap = document.createElement('div');
  wrap.className = 'foto-general-thumb';
  const img = document.createElement('img');
  img.alt = 'Foto general';
  img.loading = 'lazy';
  img.style.cursor = 'pointer';
  img.src = url;
  img.onclick = () => {
    if (typeof window.ampliarImagen === 'function') window.ampliarImagen(img.src);
  };
  wrap.appendChild(img);
  return wrap;
}

function restaurarCacheSiSeVacia() {
  if (restaurando || !modalOrdenVisible()) return;
  const cont = contenedor();
  if (!cont || cont.querySelector('img') || !cacheVisual.length) return;
  restaurando = true;
  try {
    cacheVisual.forEach(url => cont.appendChild(crearThumb(url)));
  } finally {
    restaurando = false;
  }
}

async function reconstruirDesdeState({ conservarVisual = true } = {}) {
  const cont = contenedor();
  const id = document.getElementById('orden-id')?.value || '';
  if (!cont || !id) {
    if (conservarVisual) restaurarCacheSiSeVacia();
    return;
  }
  const orden = (state.ordenes || []).find(o => o.id === id);
  const fotos = generales(orden);
  if (!fotos.length) {
    if (conservarVisual) restaurarCacheSiSeVacia();
    return;
  }

  const urls = [];
  for (const foto of fotos) {
    try {
      const u = await storage.resolveImageUrl(foto.url, foto.path);
      if (u) urls.push(u);
    } catch (_) {
      if (foto.url) urls.push(foto.url);
    }
  }
  if (!urls.length) {
    if (conservarVisual) restaurarCacheSiSeVacia();
    return;
  }

  const locales = Array.from(cont.querySelectorAll('img'))
    .map(img => img.currentSrc || img.src || '')
    .filter(u => u && (u.startsWith('blob:') || u.startsWith('data:')));
  const todos = [...new Set([...urls, ...locales])];
  cacheVisual = todos.slice();
  restaurando = true;
  try {
    cont.innerHTML = '';
    todos.forEach(url => cont.appendChild(crearThumb(url)));
  } finally {
    restaurando = false;
  }
}

function vigilarContenedor() {
  const cont = contenedor();
  if (!cont) return;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    if (restaurando) return;
    const tiene = !!cont.querySelector('img');
    if (tiene) capturarVisual();
    else restaurarCacheSiSeVacia();
  });
  observer.observe(cont, { childList: true, subtree: true });
  capturarVisual();
}

function envolverOpenOrden() {
  const original = window.openOrdenModal;
  if (typeof original !== 'function' || original.__smFotosGeneralesOpenV2) return;
  const w = function(...args) {
    cacheVisual = [];
    const r = original.apply(this, args);
    Promise.resolve(r).finally(() => {
      setTimeout(() => {
        vigilarContenedor();
        reconstruirDesdeState();
      }, 0);
    });
    return r;
  };
  w.__smFotosGeneralesOpenV2 = true;
  window.openOrdenModal = w;
}

function envolverSaveOrden() {
  const original = window.saveOrden;
  if (typeof original !== 'function' || original.__smFotosGeneralesSaveV2) return;
  const w = async function(...args) {
    capturarVisual();
    const r = await original.apply(this, args);
    [0, 250, 700, 1500, 3000].forEach(ms => setTimeout(() => {
      if (!modalOrdenVisible()) return;
      restaurarCacheSiSeVacia();
      reconstruirDesdeState();
    }, ms));
    return r;
  };
  w.__smFotosGeneralesSaveV2 = true;
  window.saveOrden = w;
}

function instalar() {
  envolverOpenOrden();
  envolverSaveOrden();

  document.addEventListener('change', e => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const general = document.getElementById('orden-registro-general');
    if (general?.contains(input) || input.id === 'orden-foto-general-camera' || input.id === 'orden-foto-general-galeria') {
      setTimeout(() => {
        vigilarContenedor();
        capturarVisual();
      }, 0);
    }
  }, true);

  document.addEventListener('click', e => {
    const b = e.target?.closest?.('button');
    if (!b || !document.getElementById('modal-orden')?.contains(b)) return;
    const txt = (b.textContent || '').toLowerCase();
    const on = b.getAttribute('onclick') || '';
    if (txt.includes('guardar') || on.includes('saveOrden')) {
      capturarVisual();
      [300, 800, 1600, 3000].forEach(ms => setTimeout(() => {
        if (!modalOrdenVisible()) return;
        restaurarCacheSiSeVacia();
        reconstruirDesdeState();
      }, ms));
    }
  }, true);

  vigilarContenedor();
  reconstruirDesdeState();
}
