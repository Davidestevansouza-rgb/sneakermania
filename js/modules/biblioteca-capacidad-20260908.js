/* ============================================================
   HOTFIX BIBLIOTECA 2026-09-08
   Regla física: cada espacio de estantería (A1, A2, ...) admite
   hasta 4 pares individuales. Recién con 4 queda lleno/bloqueado.
   No modifica fotos, pagos, Galería ni datos existentes.
   ============================================================ */
import { state, todayISO, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, logActivity, closeModal } from '../ui.js';
import { estadoMostradoPar } from './ordenes.js';

const CAPACIDAD_POR_ESTANTE = 4;
let itemActualId = null;

function ocupacionEstante(espacio, excluirId = null) {
  return (state.ordenItems || []).filter(it =>
    it.id !== excluirId &&
    !it.entregado &&
    it.biblioteca &&
    it.biblioteca.ubicacion === espacio
  );
}

function repoblarNumeros() {
  const selLetra = document.getElementById('biblioteca-sel-letra');
  const selNumero = document.getElementById('biblioteca-sel-numero');
  if (!selLetra || !selNumero || !itemActualId) return;
  const it = (state.ordenItems || []).find(x => x.id === itemActualId);
  if (!it) return;
  const ubicacionActual = it.biblioteca && it.biblioteca.ubicacion;
  const letra = selLetra.value;
  const opciones = [];
  for (let n = 1; n <= 10; n++) {
    const espacio = letra + n;
    const cantidad = ocupacionEstante(espacio, itemActualId).length;
    const lleno = cantidad >= CAPACIDAD_POR_ESTANTE && espacio !== ubicacionActual;
    const estado = cantidad === 0 ? '' : (lleno ? ' (lleno 4/4)' : ' (' + cantidad + '/4)');
    opciones.push('<option value="' + n + '"' + (lleno ? ' disabled' : '') + '>' + espacio + estado + '</option>');
  }
  selNumero.innerHTML = opciones.join('');
  if (ubicacionActual && ubicacionActual.charAt(0) === letra) selNumero.value = ubicacionActual.slice(1);
}

function actualizarMapaCapacidad() {
  document.querySelectorAll('#biblioteca-mapa .biblioteca-celda').forEach(celda => {
    const cod = celda.querySelector('.biblioteca-celda-cod');
    if (!cod) return;
    const espacio = cod.textContent.trim();
    const items = ocupacionEstante(espacio);
    const cantidad = items.length;
    celda.classList.remove('libre', 'ocupada');
    if (cantidad >= CAPACIDAD_POR_ESTANTE) celda.classList.add('ocupada');
    else celda.classList.add('libre');
    const itemTxt = celda.querySelector('.biblioteca-celda-item');
    const codigos = items.map(x => x.codigo).join(', ');
    if (cantidad > 0) {
      const nuevoTexto = codigos + ' · ' + cantidad + '/4';
      if (itemTxt && itemTxt.textContent !== nuevoTexto) itemTxt.textContent = nuevoTexto;
      celda.title = espacio + ' · ' + cantidad + '/4 pares' + (cantidad >= CAPACIDAD_POR_ESTANTE ? ' · lleno' : ' · disponible');
    } else {
      celda.title = espacio + ' libre · 0/4 pares';
    }
  });
}

function instalar(intento = 0) {
  const abrirOriginal = window.abrirUbicarEnBiblioteca;
  if (typeof abrirOriginal !== 'function') {
    if (intento < 30) setTimeout(() => instalar(intento + 1), 50);
    return;
  }
  if (abrirOriginal.__capacidad4) return;

  const abrir = function(itemId) {
    itemActualId = itemId;
    const r = abrirOriginal(itemId);
    setTimeout(() => {
      const selLetra = document.getElementById('biblioteca-sel-letra');
      if (selLetra) selLetra.onchange = repoblarNumeros;
      repoblarNumeros();
      actualizarMapaCapacidad();
    }, 0);
    return r;
  };
  abrir.__capacidad4 = true;
  window.abrirUbicarEnBiblioteca = abrir;

  window.guardarUbicacionBiblioteca = async function(btn) {
    if (!itemActualId) return;
    const it = (state.ordenItems || []).find(x => x.id === itemActualId);
    if (!it) return;
    if (estadoMostradoPar(it) !== 'Biblioteca') {
      showToast('⚠ Este artículo todavía no llegó a "Biblioteca" en el seguimiento en tiempo real');
      return;
    }
    const letraEl = document.getElementById('biblioteca-sel-letra');
    const numeroEl = document.getElementById('biblioteca-sel-numero');
    if (!letraEl || !numeroEl) return;
    const espacio = letraEl.value + numeroEl.value;
    const cantidad = ocupacionEstante(espacio, it.id).length;
    if (cantidad >= CAPACIDAD_POR_ESTANTE) {
      showToast('⚠ El estante ' + espacio + ' ya está lleno (4/4 pares). Elegí otro estante.');
      repoblarNumeros();
      return;
    }

    const ahora = new Date();
    it.biblioteca = {
      ubicacion: espacio,
      fecha: todayISO(0),
      hora: ahora.toTimeString().slice(0, 5),
      usuario: (state.session && state.session.user) || ''
    };

    try {
      await persist();
      const res = await db.saveOrdenItem(it);
      if (res && res.error && !res.queued) {
        console.error('No se pudo sincronizar la ubicación en biblioteca:', res.error);
        showToast('⚠ Se guardó en este dispositivo, pero no se pudo sincronizar con el servidor.');
      } else if (res && res.queued) {
        logActivity('Ubicó el artículo ' + it.codigo + ' en el estante ' + espacio);
        showToast('Artículo ' + it.codigo + ' → estante ' + espacio + ' (' + (cantidad + 1) + '/4, se sincronizará cuando haya conexión)');
      } else {
        logActivity('Ubicó el artículo ' + it.codigo + ' en el estante ' + espacio);
        showToast('Artículo ' + it.codigo + ' → estante ' + espacio + ' ✓ (' + (cantidad + 1) + '/4)');
      }
      closeModal('modal-biblioteca-ubicar');
      itemActualId = null;
      if (typeof window.renderBiblioteca === 'function') window.renderBiblioteca();
      setTimeout(actualizarMapaCapacidad, 0);
    } catch (e) {
      console.error('Error al guardar la ubicación en biblioteca:', e);
      showToast('No se pudo guardar la ubicación');
    }
  };

  const observer = new MutationObserver(() => {
    if (document.getElementById('biblioteca-mapa')) actualizarMapaCapacidad();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => instalar(), { once: true });
else instalar();
