/* Seguimiento en tiempo real: usa el selector nativo original y expone
   las acciones que el HTML inline necesita en window. */
import {
  renderSeguimientoItemSeleccionado,
  advanceItemTimelineStep,
  advanceTimelineStep,
  openCalidadModal
} from './ordenes.js';

// El HTML de ordenes.js usa onchange/onclick inline. En módulos ES estas
// funciones no son globales automáticamente, por eso el selector y los
// botones podían no responder aunque las funciones existieran.
Object.assign(window, {
  renderSeguimientoItemSeleccionado,
  advanceItemTimelineStep,
  advanceTimelineStep,
  openCalidadModal
});

// Si quedó algún bloque visual de la versión anterior en una sesión sin
// recargar completamente, lo retiramos y dejamos solo el <select> original.
function limpiarBotonesAnteriores() {
  const viejo = document.getElementById('sm-seguimiento-item-buttons');
  if (viejo) viejo.remove();
}

document.addEventListener('change', (ev) => {
  const sel = ev.target;
  if (!sel || sel.id !== 'seguimiento-item-select') return;
  const modal = sel.closest('#modal-orden-detalle');
  const ordenId = (modal && modal.dataset && modal.dataset.ordenId) ||
    window.__smDetalleOrdenId ||
    ((document.getElementById('orden-id') || {}).value || '');
  // Normalmente el onchange inline ya llama la función. Este listener sirve
  // como respaldo para iOS/PWA sin duplicar el cambio de estado.
  if (ordenId && sel.value) renderSeguimientoItemSeleccionado(ordenId, sel.value);
  limpiarBotonesAnteriores();
}, false);

limpiarBotonesAnteriores();
