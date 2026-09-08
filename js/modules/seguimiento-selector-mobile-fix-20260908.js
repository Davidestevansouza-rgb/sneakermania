/* Seguimiento en tiempo real: selector táctil robusto para móvil. */
import { state } from '../state.js';

function itemPorId(id) {
  return (state.ordenItems || []).find(it => it.id === id) || null;
}

function actualizarBotones() {
  const sel = document.getElementById('seguimiento-item-select');
  if (!sel) return;
  const parent = sel.parentElement;
  if (!parent) return;

  let wrap = document.getElementById('sm-seguimiento-item-buttons');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'sm-seguimiento-item-buttons';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;';
    parent.appendChild(wrap);
  }

  const opciones = Array.from(sel.options || []);
  wrap.innerHTML = opciones.map(op => {
    const activo = op.value === sel.value;
    return '<button type="button" class="btn btn-sm ' + (activo ? 'btn-teal' : 'btn-ghost') + '" data-sm-seg-item="' + op.value.replace(/"/g, '&quot;') + '" style="min-height:38px;touch-action:manipulation;">' + op.textContent + '</button>';
  }).join('');
}

function seleccionarItem(itemId) {
  const sel = document.getElementById('seguimiento-item-select');
  if (!sel) return;
  const it = itemPorId(itemId);
  if (!it) return;
  sel.value = itemId;
  if (typeof window.renderSeguimientoItemSeleccionado === 'function') {
    window.renderSeguimientoItemSeleccionado(it.ordenId, itemId);
  } else {
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setTimeout(actualizarBotones, 0);
}

document.addEventListener('click', ev => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('[data-sm-seg-item]') : null;
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  seleccionarItem(btn.getAttribute('data-sm-seg-item'));
}, true);

// Refuerza el select nativo: en caso de que sí abra, cualquier cambio también refresca.
document.addEventListener('change', ev => {
  const sel = ev.target;
  if (!sel || sel.id !== 'seguimiento-item-select') return;
  setTimeout(actualizarBotones, 0);
}, true);

if (typeof window.renderSeguimientoItemSeleccionado === 'function' && !window.renderSeguimientoItemSeleccionado.__smMobileFix) {
  const original = window.renderSeguimientoItemSeleccionado;
  const wrapped = function(...args) {
    const r = original.apply(this, args);
    setTimeout(actualizarBotones, 0);
    return r;
  };
  wrapped.__smMobileFix = true;
  window.renderSeguimientoItemSeleccionado = wrapped;
}

const modal = document.getElementById('modal-orden-detalle');
if (modal && typeof MutationObserver !== 'undefined') {
  const obs = new MutationObserver(() => {
    if (document.getElementById('seguimiento-item-select')) setTimeout(actualizarBotones, 0);
  });
  obs.observe(modal, { childList: true, subtree: true });
}

setTimeout(actualizarBotones, 0);
