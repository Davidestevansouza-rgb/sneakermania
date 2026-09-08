/* ============================================================
   HOTFIX 2026-09-08
   - Galería: búsqueda flexible por par/cliente/marca/modelo/color/talla.
   - Galería: "todos los pares" abre la vista consolidada y agrega Buscar.
   - Pagos: nunca permite cobrar/corregir por encima del saldo/valor final.
   Cambio aislado: no toca fotos, Storage/R2 ni persistencia de órdenes.
   ============================================================ */
import { state } from '../state.js';
import { showToast, clienteNombre, ordenById, fmtMoney } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

function normalizarBusqueda(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function textoBuscableItem(it, o) {
  const cliente = o ? clienteNombre(o.clienteId) : '';
  const talla = it.talla || (o && o.talla) || '';
  return normalizarBusqueda([it.codigo, cliente, it.descripcion, it.marca, it.modelo, it.color, talla, talla ? 'talla ' + talla : '', o && o.marca, o && o.modelo, o && o.color, o && o.numero].filter(Boolean).join(' '));
}
function esBusquedaTodos(q) {
  return ['todos los pares','todas las ordenes','todos los articulos','todas las fotos','ver todos','ver todos los pares','todos'].includes(q);
}
export function filtrarGaleriaOrdenesFlexible(texto) {
  const results = document.getElementById('galeria-orden-results');
  if (!results) return;
  const q = normalizarBusqueda(texto);
  if (esBusquedaTodos(q)) {
    results.innerHTML = '<div class="combo-item" onmousedown="seleccionarGaleriaOrden(\'__ALL__\')">👟 <strong>Ver fotos de todos los pares</strong></div>';
    return;
  }
  const tokens = q.split(' ').filter(Boolean);
  const itemMatches = tokens.length ? (state.ordenItems || []).filter(it => {
    const o = ordenById(it.ordenId);
    return !!o && tokens.every(token => textoBuscableItem(it, o).includes(token));
  }).slice(0, 20) : [];
  const opcionTodos = !tokens.length ? '<div class="combo-item" onmousedown="seleccionarGaleriaOrden(\'__ALL__\')">👟 <strong>Ver fotos de todos los pares</strong></div>' : '';
  const listaItems = itemMatches.map(it => {
    const o = ordenById(it.ordenId);
    if (!o) return '';
    return '<div class="combo-item" onmousedown="seleccionarGaleriaItem(\'' + escAttr(it.id) + '\')"><strong>#' + escHtml(it.codigo) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) + '</div>';
  }).join('');
  const sinResultados = tokens.length && !itemMatches.length ? '<div class="combo-empty">Sin resultados — buscá por par, cliente, marca, modelo o talla (ej. Nike 40)</div>' : '';
  results.innerHTML = opcionTodos + listaItems + sinResultados;
}
function ejecutarBusquedaGaleria() {
  const input = document.getElementById('galeria-orden-search');
  if (!input) return;
  const q = normalizarBusqueda(input.value);
  if (esBusquedaTodos(q)) {
    if (typeof window.seleccionarGaleriaOrden === 'function') window.seleccionarGaleriaOrden('__ALL__');
    return;
  }
  filtrarGaleriaOrdenesFlexible(input.value);
}
function instalarBuscarGaleria() {
  const input = document.getElementById('galeria-orden-search');
  if (!input) return;
  if (!document.getElementById('galeria-buscar-btn')) {
    const btn = document.createElement('button');
    btn.id = 'galeria-buscar-btn';
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = 'Buscar';
    btn.style.marginTop = '8px';
    btn.style.marginRight = '8px';
    btn.onclick = ejecutarBusquedaGaleria;
    const wrap = input.closest('.combo-wrap');
    if (wrap) wrap.appendChild(btn);
  }
  if (!input.dataset.busquedaEnterInstalada) {
    input.dataset.busquedaEnterInstalada = '1';
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ejecutarBusquedaGaleria();
      }
    });
  }
}
window.filtrarGaleriaOrdenes = filtrarGaleriaOrdenesFlexible;
window.ejecutarBusquedaGaleria = ejecutarBusquedaGaleria;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalarBuscarGaleria, { once: true });
else instalarBuscarGaleria();

function valorFinalOrden(o) { return Math.max(Number(o.precio || 0) - Number(o.descuento || 0), 0); }
function validarNuevoPago(id, inputId) {
  const o = ordenById(id); if (!o) return false;
  const input = document.getElementById(inputId);
  const monto = Number(input && input.value) || 0;
  const pendiente = Math.max(valorFinalOrden(o) - Number(o.pagado || 0), 0);
  if (monto <= 0) return true;
  if (monto - pendiente > 0.000001) {
    showToast('⚠ El pago no puede superar el saldo pendiente de ' + fmtMoney(pendiente));
    if (input) { input.value = pendiente.toFixed(2); input.focus(); }
    return false;
  }
  return true;
}
function validarCorreccionPago(inputId) {
  const o = window.__corregirPagoOrdenIdSafety ? ordenById(window.__corregirPagoOrdenIdSafety) : null;
  if (!o) return true;
  const input = document.getElementById(inputId);
  const monto = Number(input && input.value) || 0;
  const valorFinal = valorFinalOrden(o);
  if (monto - valorFinal > 0.000001) {
    showToast('⚠ El pago total no puede superar el valor final de ' + fmtMoney(valorFinal));
    if (input) { input.value = valorFinal.toFixed(2); input.focus(); }
    return false;
  }
  return true;
}
const originalOpenPagoQR = window.openPagoQRModal;
const originalConfirmarPagoQR = window.confirmarPagoQR;
const originalOpenPagoEfectivo = window.openPagoEfectivoModal;
const originalConfirmarPagoEfectivo = window.confirmarPagoEfectivo;
const originalOpenCorregirPago = window.openCorregirPagoModal;
const originalGuardarCorreccionPago = window.guardarCorreccionPago;
if (typeof originalOpenPagoQR === 'function') window.openPagoQRModal = function(id) { window.__pagoQrOrdenIdSafety = id; return originalOpenPagoQR(id); };
if (typeof originalConfirmarPagoQR === 'function') window.confirmarPagoQR = function() { if (!validarNuevoPago(window.__pagoQrOrdenIdSafety, 'pago-qr-monto')) return; return originalConfirmarPagoQR(); };
if (typeof originalOpenPagoEfectivo === 'function') window.openPagoEfectivoModal = function(id) { window.__pagoEfectivoOrdenIdSafety = id; return originalOpenPagoEfectivo(id); };
if (typeof originalConfirmarPagoEfectivo === 'function') window.confirmarPagoEfectivo = function() { if (!validarNuevoPago(window.__pagoEfectivoOrdenIdSafety, 'pago-efectivo-monto')) return; return originalConfirmarPagoEfectivo(); };
if (typeof originalOpenCorregirPago === 'function') window.openCorregirPagoModal = function(id) { window.__corregirPagoOrdenIdSafety = id; return originalOpenCorregirPago(id); };
if (typeof originalGuardarCorreccionPago === 'function') window.guardarCorreccionPago = function() { if (!validarCorreccionPago('corregir-pago-monto')) return; return originalGuardarCorreccionPago(); };
