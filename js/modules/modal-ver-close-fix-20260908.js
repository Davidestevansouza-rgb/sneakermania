/* Cierre robusto y aislado de la ventana "Ver" (Detalle de orden). */
function instalarCierreDetalleOrden() {
  const modal = document.getElementById('modal-orden-detalle');
  if (!modal || modal.dataset.closeFix0908) return;
  modal.dataset.closeFix0908 = '1';

  const cerrar = (ev) => {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (typeof window.closeModal === 'function') {
      window.closeModal('modal-orden-detalle');
    } else {
      modal.classList.remove('open');
      document.body.classList.remove('modal-open-lock');
      document.body.style.paddingRight = '';
    }
  };

  const btn = modal.querySelector('.modal-head .modal-close');
  if (btn) {
    btn.type = 'button';
    btn.onclick = cerrar;
    btn.addEventListener('touchend', cerrar, { passive: false });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', instalarCierreDetalleOrden, { once: true });
} else {
  instalarCierreDetalleOrden();
}
