/* Mobile touch stability — permite que selects/inputs nativos reciban touch real. */
(function instalarTouchStability(){
  if (window.__smMobileTouchStability0908) return;
  window.__smMobileTouchStability0908 = true;

  const s = document.createElement('style');
  s.id = 'sm-mobile-touch-stability-0908';
  s.textContent = `
    .modal-backdrop.open,
    .modal-backdrop.open > .modal,
    .modal-backdrop.open select,
    .modal-backdrop.open input,
    .modal-backdrop.open textarea,
    .modal-backdrop.open button {
      touch-action: auto !important;
    }
    #seguimiento-item-select {
      touch-action: auto !important;
      pointer-events: auto !important;
      -webkit-user-select: auto !important;
      user-select: auto !important;
    }
  `;
  document.head.appendChild(s);

  // Respaldo para sesiones donde el modal fue renderizado antes del hotfix.
  const aplicar = () => {
    document.querySelectorAll('.modal-backdrop.open, .modal-backdrop.open > .modal, .modal-backdrop.open select, .modal-backdrop.open input, .modal-backdrop.open textarea, .modal-backdrop.open button')
      .forEach(el => el.style.setProperty('touch-action', 'auto', 'important'));
  };

  document.addEventListener('focusin', aplicar, true);
  document.addEventListener('pointerdown', e => {
    const el = e.target;
    if (el && el.closest && el.closest('.modal-backdrop.open')) aplicar();
  }, true);
  aplicar();
})();
