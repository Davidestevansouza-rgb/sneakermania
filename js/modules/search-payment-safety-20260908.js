/* ============================================================
   HOTFIX 2026-09-08
   - Galería: búsqueda flexible por par/cliente/marca/modelo/color/talla.
   - Galería: "todos los pares" fuerza la vista consolidada real.
   - Pagos: NO intercepta confirmarPagoQR/confirmarPagoEfectivo.
   ============================================================ */
import { state } from '../state.js';
import { clienteNombre, ordenById } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

function normalizarBusqueda(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function textoBuscableItem(it, o) {
  const cliente = o ? clienteNombre(o.clienteId) : '';
  const talla = it.talla || (o && o.talla) || '';
  return normalizarBusqueda([
    it.codigo, cliente, it.descripcion, it.marca, it.modelo, it.color, talla,
    talla ? 'talla ' + talla : '', o && o.marca, o && o.modelo, o && o.color, o && o.numero
  ].filter(Boolean).join(' '));
}

function esBusquedaTodos(q) {
  return ['todos los pares','todas las ordenes','todos los articulos','todas las fotos','ver todos','ver todos los pares','todos'].includes(q);
}

function mostrarTodosLosPares() {
  const input = document.getElementById('galeria-orden-search');
  const select = document.getElementById('galeria-orden-select');
  const results = document.getElementById('galeria-orden-results');

  if (select) select.value = '__ALL__';
  if (input) input.value = '👟 Todos los pares';
  if (results) results.innerHTML = '';

  // No dependemos del estado anterior del buscador: forzamos la vista global.
  if (typeof window.limpiarFiltroGaleriaItem === 'function') {
    try { window.limpiarFiltroGaleriaItem(); } catch (_) {}
  }
  if (select) select.value = '__ALL__';
  if (typeof window.renderGaleria === 'function') window.renderGaleria();
}

export function filtrarGaleriaOrdenesFlexible(texto) {
  const results = document.getElementById('galeria-orden-results');
  if (!results) return;

  const q = normalizarBusqueda(texto);
  if (esBusquedaTodos(q)) {
    results.innerHTML = '<div class="combo-item" onmousedown="window.mostrarTodosLosParesGaleria()">👟 <strong>Ver fotos de todos los pares</strong></div>';
    return;
  }

  const tokens = q.split(' ').filter(Boolean);
  const itemMatches = tokens.length ? (state.ordenItems || []).filter(it => {
    const o = ordenById(it.ordenId);
    return !!o && tokens.every(token => textoBuscableItem(it, o).includes(token));
  }).slice(0, 20) : [];

  const opcionTodos = !tokens.length
    ? '<div class="combo-item" onmousedown="window.mostrarTodosLosParesGaleria()">👟 <strong>Ver fotos de todos los pares</strong></div>'
    : '';

  const listaItems = itemMatches.map(it => {
    const o = ordenById(it.ordenId);
    if (!o) return '';
    return '<div class="combo-item" onmousedown="seleccionarGaleriaItem(\'' + escAttr(it.id) + '\')"><strong>#' + escHtml(it.codigo) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) + '</div>';
  }).join('');

  const sinResultados = tokens.length && !itemMatches.length
    ? '<div class="combo-empty">Sin resultados — buscá por par, cliente, marca, modelo o talla (ej. Nike 40)</div>'
    : '';

  results.innerHTML = opcionTodos + listaItems + sinResultados;
}

function ejecutarBusquedaGaleria() {
  const input = document.getElementById('galeria-orden-search');
  if (!input) return;
  const q = normalizarBusqueda(input.value);
  if (esBusquedaTodos(q) || q === normalizarBusqueda('👟 Todos los pares')) {
    mostrarTodosLosPares();
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
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ejecutarBusquedaGaleria();
      }
    });
  }
}

window.filtrarGaleriaOrdenes = filtrarGaleriaOrdenesFlexible;
window.ejecutarBusquedaGaleria = ejecutarBusquedaGaleria;
window.mostrarTodosLosParesGaleria = mostrarTodosLosPares;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalarBuscarGaleria, { once: true });
else instalarBuscarGaleria();
