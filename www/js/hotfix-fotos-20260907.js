/* Hotfix producción 2026-09-07
   Corrige dos problemas únicamente visuales de las fotos de órdenes:
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
      const modal = document.getElementById('modal-orden');
      const result = await originalSaveOrden.apply(this, args);
      if (!result) return result;

      const sigueAbierto = !!modal && (
        modal.classList.contains('open') ||
        modal.classList.contains('active') ||
        modal.getAttribute('aria-hidden') === 'false' ||
        (getComputedStyle(modal).display !== 'none' && getComputedStyle(modal).visibility !== 'hidden')
      );

      if (sigueAbierto) {
        try {
          await window.openOrdenModal(result);
          resolverR2En(modal);
          if (storageManager.secureImageUrlsInDom) {
            await storageManager.secureImageUrlsInDom(modal);
          }
        } catch (e) {
          console.warn('Hotfix fotos: no se pudo refrescar el modal', e);
        }
      } else {
        resolverR2En(document);
      }
      return result;
    };

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
