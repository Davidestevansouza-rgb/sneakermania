/* Hotfix producción 2026-09-07
   Corrige el caso en que, después de guardar/actualizar una orden manteniendo
   abierto el modal, las fotos generales quedan visualmente desactualizadas.
   No modifica Supabase, R2, Storage ni datos persistidos: solo reconstruye
   el modal desde el estado ya guardado cuando éste sigue abierto. */
(function installFotoHotfix() {
  if (window.__smFotoHotfixInstalled) return;

  const tryInstall = () => {
    if (window.__smFotoHotfixInstalled) return true;
    if (typeof window.saveOrden !== 'function' || typeof window.openOrdenModal !== 'function') return false;

    const originalSaveOrden = window.saveOrden;
    window.saveOrden = async function (...args) {
      const modal = document.getElementById('modal-orden');
      const result = await originalSaveOrden.apply(this, args);
      if (!result) return result;

      // Solo refresca si el modal quedó abierto (por ejemplo keepOpen).
      // Si el guardado normal lo cerró, no lo vuelve a abrir ni cambia el flujo.
      const sigueAbierto = !!modal && (
        modal.classList.contains('open') ||
        modal.classList.contains('active') ||
        modal.getAttribute('aria-hidden') === 'false' ||
        (getComputedStyle(modal).display !== 'none' && getComputedStyle(modal).visibility !== 'hidden')
      );

      if (sigueAbierto) {
        try {
          await window.openOrdenModal(result);
        } catch (e) {
          console.warn('Hotfix fotos: no se pudo refrescar el modal', e);
        }
      }
      return result;
    };

    window.__smFotoHotfixInstalled = true;
    return true;
  };

  if (tryInstall()) return;
  const timer = setInterval(() => {
    if (tryInstall()) clearInterval(timer);
  }, 100);
  setTimeout(() => clearInterval(timer), 15000);
})();
