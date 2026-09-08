/* Seguimiento en tiempo real: usa el selector nativo original y expone
   las acciones que el HTML inline necesita en window. */
import {
  renderSeguimientoItemSeleccionado,
  advanceItemTimelineStep,
  advanceTimelineStep,
  openCalidadModal
} from './ordenes.js';

Object.assign(window, {
  renderSeguimientoItemSeleccionado,
  advanceItemTimelineStep,
  advanceTimelineStep,
  openCalidadModal
});

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
  if (ordenId && sel.value) renderSeguimientoItemSeleccionado(ordenId, sel.value);
  limpiarBotonesAnteriores();
}, false);

limpiarBotonesAnteriores();
