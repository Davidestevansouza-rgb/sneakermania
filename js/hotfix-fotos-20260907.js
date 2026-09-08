/* Hotfix producción 2026-09-07
   Corrige problemas únicamente visuales de las fotos:
   1) después de guardar/actualizar, el modal podía quedar mostrando un estado viejo;
   2) una foto R2 podía renderizarse temporalmente como src="r2://...", esquema que
      el navegador no entiende, en vez de usar primero su URL HTTPS firmada.
   No modifica PostgreSQL, R2, Storage ni datos persistidos. */
import * as storageManager from './storage-manager.js';

(function installFotoHotfix() {
  if (window.__smFotoHotfixInstalled) return;

  const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const resolviendo = new WeakSet();

  async function resolverImagenR2(img) {
    if (!img || resolviendo.has(img)) return;
    const actual = img.getAttribute('src') || '';
    const original = actual.startsWith('r2://') ? actual : (img.dataset.smR2Src || '');
    if (!original || !original.startsWith('r2://')) return;

    resolviendo.add(img);
    img.dataset.smR2Src = original;
    if (actual.startsWith('r2://')) img.setAttribute('src', PIXEL_TRANSPARENTE);

    try {
      const signed = await storageManager.resolveImageUrl(original);
      if (signed && !signed.startsWith('r2://')) {
        img.setAttribute('src', signed);
        img.removeAttribute('data-sm-r2-src');
      } else {
        console.warn('Hotfix fotos: no se pudo obtener URL HTTPS firmada para una foto R2');
      }
    } catch (e) {
      console.warn('Hotfix fotos: error resolviendo foto R2', e);
    } finally {
      resolviendo.delete(img);
    }
  }

  function resolverR2En(root) {
    if (!root) return;
    if (root.matches && root.matches('img[src^="r2://"]')) resolverImagenR2(root);
    const imgs = root.querySelectorAll ? root.querySelectorAll('img[src^="r2://"], img[data-sm-r2-src]') : [];
    imgs.forEach(resolverImagenR2);
  }

  function modalOrdenVisible() {
    const modal = document.getElementById('modal-orden');
    if (!modal) return false;
    const cs = getComputedStyle(modal);
    return modal.classList.contains('open') || modal.classList.contains('active') ||
      modal.getAttribute('aria-hidden') === 'false' ||
      (cs.display !== 'none' && cs.visibility !== 'hidden');
  }

  async function refrescarModalOrden(id) {
    if (!id || !modalOrdenVisible() || typeof window.openOrdenModal !== 'function') return;
    const modal = document.getElementById('modal-orden');
    const scrollEl = modal?.querySelector('.modal-content');
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    try {
      await window.openOrdenModal(id);
      resolverR2En(modal || document);
      if (storageManager.secureImageUrlsInDom) await storageManager.secureImageUrlsInDom(modal || document);
      requestAnimationFrame(() => {
        const c = document.querySelector('#modal-orden .modal-content');
        if (c) c.scrollTop = scrollTop;
      });
    } catch (e) {
      console.warn('Hotfix fotos: no se pudo refrescar el modal', e);
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.target?.tagName === 'IMG') resolverImagenR2(m.target);
      for (const node of m.addedNodes || []) {
        if (node && node.nodeType === 1) resolverR2En(node);
      }
    }
  });

  const iniciarObserver = () => {
    resolverR2En(document);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarObserver, { once: true });
  else iniciarObserver();

  const tryInstall = () => {
    if (window.__smFotoHotfixInstalled) return true;
    if (typeof window.saveOrden !== 'function' || typeof window.openOrdenModal !== 'function') return false;

    const originalSaveOrden = window.saveOrden;
    window.saveOrden = async function (...args) {
      const result = await originalSaveOrden.apply(this, args);
      if (result && modalOrdenVisible()) await refrescarModalOrden(result);
      else resolverR2En(document);
      return result;
    };

    // El botón "Guardar orden" del modal usa saveOrdenYMantener(), que llama al
    // binding local de saveOrden y por eso no pasa por window.saveOrden. Se envuelve
    // explícitamente este camino para refrescar las fotos después de keepOpen.
    if (typeof window.saveOrdenYMantener === 'function' && !window.saveOrdenYMantener.__smFotoKeepOpenV1) {
      const originalSaveOrdenYMantener = window.saveOrdenYMantener;
      const wrapped = async function (...args) {
        const result = await originalSaveOrdenYMantener.apply(this, args);
        const id = document.getElementById('orden-id')?.value || '';
        if (id && modalOrdenVisible()) await refrescarModalOrden(id);
        return result;
      };
      wrapped.__smFotoKeepOpenV1 = true;
      window.saveOrdenYMantener = wrapped;
    }

    window.__smFotoHotfixInstalled = true;
    return true;
  };

  if (!tryInstall()) {
    const timer = setInterval(() => {
      if (tryInstall()) clearInterval(timer);
    }, 100);
    setTimeout(() => clearInterval(timer), 15000);
  }

  window.addEventListener('online', () => resolverR2En(document));
})();
