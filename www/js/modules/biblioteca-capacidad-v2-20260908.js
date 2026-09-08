/* ============================================================
   BIBLIOTECA CAPACIDAD V2 — 2026-09-08
   Regla física real: cada estante A1, A2, ... admite hasta 4 pares
   individuales, sin importar si pertenecen a la misma o a distintas órdenes.
   Recién al llegar a 4/4 se bloquea un quinto par.
   ============================================================ */
import { state, todayISO, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, logActivity, closeModal } from '../ui.js';
import { estadoMostradoPar } from './ordenes.js';

const CAPACIDAD = 4;
let itemActualId = null;

function itemsEn(espacio, excluirId = null) {
  return (state.ordenItems || []).filter(it =>
    it.id !== excluirId &&
    !it.entregado &&
    it.biblioteca &&
    it.biblioteca.ubicacion === espacio
  );
}

function poblarNumeros() {
  const letraEl = document.getElementById('biblioteca-sel-letra');
  const numeroEl = document.getElementById('biblioteca-sel-numero');
  if (!letraEl || !numeroEl || !itemActualId) return;
  const actual = (state.ordenItems || []).find(it => it.id === itemActualId);
  if (!actual) return;
  const ubicActual = actual.biblioteca?.ubicacion || '';
  const letra = letraEl.value;
  const html = [];
  for (let n = 1; n <= 10; n++) {
    const espacio = letra + n;
    const cantidad = itemsEn(espacio, itemActualId).length;
    const lleno = cantidad >= CAPACIDAD && espacio !== ubicActual;
    const texto = cantidad ? (lleno ? ' (lleno 4/4)' : ` (${cantidad}/4)`) : '';
    html.push(`<option value="${n}"${lleno ? ' disabled' : ''}>${espacio}${texto}</option>`);
  }
  numeroEl.innerHTML = html.join('');
  if (ubicActual && ubicActual.startsWith(letra)) numeroEl.value = ubicActual.slice(1);
}

function refrescarMapa() {
  document.querySelectorAll('#biblioteca-mapa .biblioteca-celda').forEach(celda => {
    const cod = celda.querySelector('.biblioteca-celda-cod')?.textContent?.trim();
    if (!cod) return;
    const lista = itemsEn(cod);
    const cantidad = lista.length;
    celda.classList.remove('libre', 'ocupada');
    celda.classList.add(cantidad >= CAPACIDAD ? 'ocupada' : 'libre');
    const txt = celda.querySelector('.biblioteca-celda-item');
    if (cantidad) {
      const codigos = lista.map(x => x.codigo).join(', ');
      if (txt) txt.textContent = `${codigos} · ${cantidad}/4`;
      celda.title = `${cod} · ${cantidad}/4 pares${cantidad >= CAPACIDAD ? ' · lleno' : ' · disponible'}`;
    } else {
      if (txt) txt.textContent = '';
      celda.title = `${cod} libre · 0/4 pares`;
    }
  });
}

function instalar() {
  const abrirOriginal = window.abrirUbicarEnBiblioteca;
  if (typeof abrirOriginal !== 'function') {
    setTimeout(instalar, 100);
    return;
  }
  if (window.__bibliotecaCapacidadV2) return;
  window.__bibliotecaCapacidadV2 = true;

  window.abrirUbicarEnBiblioteca = function(itemId) {
    itemActualId = itemId;
    const r = abrirOriginal(itemId);
    setTimeout(() => {
      const letraEl = document.getElementById('biblioteca-sel-letra');
      if (letraEl) letraEl.onchange = poblarNumeros;
      poblarNumeros();
      refrescarMapa();
    }, 0);
    return r;
  };

  window.guardarUbicacionBiblioteca = async function() {
    if (!itemActualId) return;
    const it = (state.ordenItems || []).find(x => x.id === itemActualId);
    if (!it) return;
    if (estadoMostradoPar(it) !== 'Biblioteca') {
      showToast('⚠ Este artículo todavía no llegó a "Biblioteca" en el seguimiento en tiempo real');
      return;
    }
    const letra = document.getElementById('biblioteca-sel-letra')?.value || '';
    const numero = document.getElementById('biblioteca-sel-numero')?.value || '';
    const espacio = letra + numero;
    if (!letra || !numero) return;
    const cantidad = itemsEn(espacio, it.id).length;
    if (cantidad >= CAPACIDAD) {
      showToast(`⚠ El estante ${espacio} ya está lleno (4/4 pares). Elegí otro estante.`);
      poblarNumeros();
      return;
    }

    const ahora = new Date();
    it.biblioteca = {
      ubicacion: espacio,
      fecha: todayISO(0),
      hora: ahora.toTimeString().slice(0, 5),
      usuario: state.session?.user || ''
    };

    try {
      await persist();
      const res = await db.saveOrdenItem(it);
      if (res?.error && !res.queued) {
        console.error('No se pudo sincronizar la ubicación en biblioteca:', res.error);
        showToast('⚠ Se guardó en este dispositivo, pero no se pudo sincronizar con el servidor.');
      } else {
        logActivity(`Ubicó el artículo ${it.codigo} en el estante ${espacio}`);
        showToast(`Artículo ${it.codigo} → estante ${espacio} ✓ (${cantidad + 1}/4)`);
      }
      closeModal('modal-biblioteca-ubicar');
      itemActualId = null;
      if (typeof window.renderBiblioteca === 'function') window.renderBiblioteca();
      setTimeout(refrescarMapa, 0);
    } catch (e) {
      console.error('Error al guardar la ubicación en biblioteca:', e);
      showToast('No se pudo guardar la ubicación');
    }
  };

  let rafMapa = 0;
  const observer = new MutationObserver((mutations) => {
    if (!document.getElementById('biblioteca-mapa')) return;
    const relevante = mutations.some(m => {
      const t = m.target;
      return !(t instanceof Element && t.closest('#biblioteca-mapa'));
    });
    if (!relevante) return;
    if (rafMapa) cancelAnimationFrame(rafMapa);
    rafMapa = requestAnimationFrame(() => {
      rafMapa = 0;
      refrescarMapa();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar, { once: true });
else instalar();
