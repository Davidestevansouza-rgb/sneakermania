/* ============================================================
   HOTFIX 2026-09-08
   - Galería queda dedicada únicamente a fotografías.
   - El buscador flexible pasa a una sección independiente: Artículos.
   - Pagos: este módulo NO intercepta confirmarPagoQR/confirmarPagoEfectivo.
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
    it.codigo, cliente, o && o.numero, it.descripcion, it.marca, it.modelo, it.color,
    talla, talla ? 'talla ' + talla : '', it.tipoCalzado, it.material,
    Array.isArray(it.tipoServicio) ? it.tipoServicio.join(' ') : it.tipoServicio,
    o && o.marca, o && o.modelo, o && o.color, o && o.talla
  ].filter(Boolean).join(' '));
}
function tokensBusqueda(valor) {
  const ignorar = new Set(['marca','modelo','talla','par','articulo','articulos']);
  return normalizarBusqueda(valor).split(' ').filter(t => t && !ignorar.has(t));
}
function itemsCoincidentes(valor) {
  const tokens = tokensBusqueda(valor);
  if (!tokens.length) return [];
  return (state.ordenItems || []).filter(it => {
    const o = ordenById(it.ordenId);
    return !!o && tokens.every(token => textoBuscableItem(it, o).includes(token));
  });
}
function textoServicio(it) {
  return Array.isArray(it.tipoServicio) ? it.tipoServicio.join(', ') : (it.tipoServicio || '—');
}
function renderArticuloDetalle(itemId) {
  const it = (state.ordenItems || []).find(x => x.id === itemId);
  const cont = document.getElementById('articulos-content');
  if (!it || !cont) return;
  const o = ordenById(it.ordenId);
  if (!o) return;
  const talla = it.talla || o.talla || '—';
  const marca = it.marca || o.marca || '—';
  const modelo = it.modelo || o.modelo || '—';
  const color = it.color || o.color || '—';
  cont.innerHTML = '<div class="panel" style="max-width:760px;">' +
    '<div class="panel-title">Artículo #' + escHtml(it.codigo || '') + '</div>' +
    '<table class="data"><tbody>' +
      '<tr><th>Cliente</th><td>' + escHtml(clienteNombre(o.clienteId)) + '</td></tr>' +
      '<tr><th>Orden</th><td>#' + escHtml(o.numero) + '</td></tr>' +
      '<tr><th>Marca</th><td>' + escHtml(marca) + '</td></tr>' +
      '<tr><th>Modelo</th><td>' + escHtml(modelo) + '</td></tr>' +
      '<tr><th>Color</th><td>' + escHtml(color) + '</td></tr>' +
      '<tr><th>Talla</th><td>' + escHtml(talla) + '</td></tr>' +
      '<tr><th>Descripción</th><td>' + escHtml(it.descripcion || '—') + '</td></tr>' +
      '<tr><th>Servicio</th><td>' + escHtml(textoServicio(it)) + '</td></tr>' +
      '<tr><th>Estado</th><td>' + escHtml(it.estado || '—') + '</td></tr>' +
    '</tbody></table></div>';
  const input = document.getElementById('articulos-search');
  if (input) input.value = '#' + (it.codigo || '') + ' · ' + clienteNombre(o.clienteId);
  const results = document.getElementById('articulos-results');
  if (results) results.innerHTML = '';
}
function buscarArticulos(valor) {
  const results = document.getElementById('articulos-results');
  const cont = document.getElementById('articulos-content');
  if (!results || !cont) return;
  const q = normalizarBusqueda(valor);
  if (!q) {
    results.innerHTML = '';
    cont.innerHTML = '<div class="empty-state"><div class="big">👟</div>Busca un artículo por código, cliente, marca, modelo, color o talla.</div>';
    return;
  }
  const matches = itemsCoincidentes(valor).slice(0, 50);
  results.innerHTML = matches.length ? matches.map(it => {
    const o = ordenById(it.ordenId);
    const meta = [it.marca || (o && o.marca), it.modelo || (o && o.modelo), (it.talla || (o && o.talla)) ? 'Talla ' + (it.talla || o.talla) : ''].filter(Boolean).join(' · ');
    return '<div class="combo-item" onmousedown="seleccionarArticuloBusqueda(\'' + escAttr(it.id) + '\')"><strong>#' + escHtml(it.codigo || '') + '</strong> · ' + escHtml(o ? clienteNombre(o.clienteId) : '') + (meta ? '<div class="hint">' + escHtml(meta) + '</div>' : '') + '</div>';
  }).join('') : '<div class="combo-empty">Sin resultados — probá combinaciones como “Nike 40”, “On Cloud 42” o el código del par.</div>';
}
function limpiarBusquedaArticulos() {
  const input = document.getElementById('articulos-search');
  const results = document.getElementById('articulos-results');
  const cont = document.getElementById('articulos-content');
  if (input) input.value = '';
  if (results) results.innerHTML = '';
  if (cont) cont.innerHTML = '<div class="empty-state"><div class="big">👟</div>Busca un artículo por código, cliente, marca, modelo, color o talla.</div>';
}
function crearSeccionArticulos() {
  if (document.getElementById('tab-articulos')) return;
  const galeriaNav = document.querySelector('.nav-item[data-tab="galeria"]');
  if (galeriaNav) {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.tab = 'articulos';
    btn.onclick = () => window.switchTab('articulos');
    btn.innerHTML = '<span class="ic">👟</span>Artículos';
    galeriaNav.insertAdjacentElement('afterend', btn);
  }
  const galeriaSection = document.getElementById('tab-galeria');
  if (galeriaSection) {
    const sec = document.createElement('div');
    sec.className = 'tab-section';
    sec.id = 'tab-articulos';
    sec.innerHTML = '<div class="page-head"><div><h1 class="page-title">Artículos</h1><div class="page-sub">Busca cada par de forma independiente por cliente, código, marca, modelo, color o talla.</div></div></div>' +
      '<div class="combo-wrap" style="margin-bottom:16px;max-width:560px;">' +
        '<input type="text" id="articulos-search" class="combo-input" placeholder="Ej: Nike 40, On Cloud 42, 125-2, nombre del cliente..." autocomplete="off">' +
        '<div id="articulos-results" class="combo-list"></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px;"><button type="button" class="btn btn-primary btn-sm" onclick="buscarArticulosDesdeInput()">Buscar</button><button type="button" class="btn btn-ghost btn-sm" onclick="limpiarBusquedaArticulos()">Limpiar</button></div>' +
      '</div><div id="articulos-content"><div class="empty-state"><div class="big">👟</div>Busca un artículo por código, cliente, marca, modelo, color o talla.</div></div>';
    galeriaSection.insertAdjacentElement('afterend', sec);
    const input = sec.querySelector('#articulos-search');
    input.addEventListener('input', () => buscarArticulos(input.value));
    input.addEventListener('focus', () => { if (input.value.trim()) buscarArticulos(input.value); });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarArticulos(input.value); } });
  }
  const oldSearch = document.getElementById('galeria-orden-search');
  const oldWrap = oldSearch && oldSearch.closest('.combo-wrap');
  if (oldWrap) oldWrap.style.display = 'none';
}
function renderArticulos() {
  crearSeccionArticulos();
  const input = document.getElementById('articulos-search');
  if (input && input.value.trim()) buscarArticulos(input.value);
}
function asegurarGaleriaCompleta() {
  const sel = document.getElementById('galeria-orden-select');
  if (sel) sel.value = '__ALL__';
  try {
    if (typeof window.seleccionarGaleriaOrden === 'function') {
      window.seleccionarGaleriaOrden('__ALL__');
      return;
    }
  } catch (_) {}
  if (typeof window.renderGaleria === 'function') window.renderGaleria();
}
function instalarNavegacionSeparada(intento = 0) {
  crearSeccionArticulos();
  const original = window.switchTab;
  if (typeof original !== 'function') {
    if (intento < 20) setTimeout(() => instalarNavegacionSeparada(intento + 1), 50);
    return;
  }
  if (original.__articulosSeparados) return;
  const wrapper = function(tab, ...args) {
    if (tab === 'articulos') {
      if (typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'articulos'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById('tab-articulos');
      if (sec) sec.classList.add('active');
      renderArticulos();
      return;
    }
    if (tab === 'galeria') asegurarGaleriaCompleta();
    return original.call(this, tab, ...args);
  };
  wrapper.__articulosSeparados = true;
  window.switchTab = wrapper;
}
window.buscarArticulos = buscarArticulos;
window.buscarArticulosDesdeInput = () => { const input = document.getElementById('articulos-search'); buscarArticulos(input ? input.value : ''); };
window.limpiarBusquedaArticulos = limpiarBusquedaArticulos;
window.seleccionarArticuloBusqueda = renderArticuloDetalle;
window.renderArticulos = renderArticulos;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => instalarNavegacionSeparada(), { once: true });
else instalarNavegacionSeparada();
