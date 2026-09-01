/* ============================================================
   Buscador de órdenes tipo autocompletar, compartido por los
   paneles de Análisis con IA, Galería y Facturas.
   Muestra los resultados pegados directamente debajo del input
   (mismo bloque visual) y, desde la primera letra escrita,
   prioriza los clientes cuyo nombre EMPIEZA con lo tecleado.
   ============================================================ */
import { state } from './state.js';
import { clienteNombre } from './ui.js';
import { escHtml, escAttr } from './sanitize.js';

/**
 * @param {string} texto - lo que el usuario escribió
 * @param {string} resultsElId - id del contenedor .combo-list
 * @param {string} onSelectFnName - nombre de la función global (window.x) a invocar al elegir una orden
 * @returns {void}
 */
export function filtrarOrdenesCombo(texto, resultsElId, onSelectFnName) {
  const results = document.getElementById(resultsElId);
  if (!results) return;
  const q = (texto || '').trim().toLowerCase();

  // Sin texto: se muestran las órdenes más recientes para no dejar el
  // buscador vacío al enfocarlo (más fácil de usar que un input "en blanco").
  const base = q ? state.ordenes.filter(o => {
    const cliente = clienteNombre(o.clienteId).toLowerCase();
    const c = state.clientes.find(cl => cl.id === o.clienteId);
    const whatsapp = (c && c.whatsapp || '').toLowerCase();
    return cliente.includes(q) || String(o.numero).includes(q) || whatsapp.includes(q);
  }) : state.ordenes.slice();

  // Prioriza coincidencias que EMPIEZAN con lo escrito (nombre de cliente
  // o número de orden) por encima de las que solo lo contienen en el medio.
  const rank = o => {
    const cliente = clienteNombre(o.clienteId).toLowerCase();
    if (!q) return 0;
    if (cliente.startsWith(q)) return 0;
    if (String(o.numero).startsWith(q)) return 1;
    return 2;
  };
  const matches = base
    .sort((a, b) => rank(a) - rank(b) || b.numero - a.numero)
    .slice(0, 20);

  results.innerHTML = matches.length ? matches.map(o =>
    '<div class="combo-item" onmousedown="' + onSelectFnName + '(\'' + escAttr(o.id) + '\')">' +
      '<strong>#' + escHtml(o.numero) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) + ' · ' + escHtml(o.marca) + ' ' + escHtml(o.modelo) +
    '</div>'
  ).join('') : '<div class="combo-empty">Sin resultados</div>';
}

export function limpiarCombo(resultsElId) {
  const results = document.getElementById(resultsElId);
  if (results) results.innerHTML = '';
}

// Cierra cualquier lista de resultados abierta si el usuario hace clic
// fuera del buscador (los combo-item usan onmousedown para seleccionar
// antes de este cierre, así que no chocan entre sí).
document.addEventListener('click', (ev) => {
  if (ev.target.closest && ev.target.closest('.combo-wrap')) return;
  document.querySelectorAll('.combo-list').forEach(el => { el.innerHTML = ''; });
});
