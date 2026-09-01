/* ============================================================
   MÓDULO: BIBLIOTECA (ubicación en estantería)
   Cuando un par llega al último paso del Seguimiento en tiempo real
   ("Biblioteca", ver TIMELINE_STEPS en ordenes.js) queda esperando a
   que el cliente lo retire. Este módulo es donde el recepcionista
   anota FÍSICAMENTE en qué estante quedó guardado ese par (una letra
   + un número, ej. "H1"), para poder encontrarlo rápido cuando el
   cliente venga a buscarlo.

   No reemplaza ni toca el Seguimiento en tiempo real ni it.estado de
   Producción: es una capa aparte, guardada en it.biblioteca = {
   ubicacion, fecha, hora, usuario }. Un par solo puede ubicarse acá
   una vez que estadoMostradoPar(it) === 'Biblioteca' (mismo requisito
   que ya exige marcarItemEntregado en items.js para poder entregarlo).

   Estantería: letras A a Z, cada una con espacios numerados 1 a 10
   (A1..A10, B1..B10, … Z1..Z10).
   ============================================================ */
import { state, todayISO, persist, esAdmin, esSupervisor } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtDate, ordenById, clienteNombre, logActivity, openModalEl, closeModal } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import { itemsDeOrden, estadoMostradoPar } from './ordenes.js';

const BIBLIOTECA_LETRAS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A..Z
const BIBLIOTECA_NUMEROS_POR_LETRA = 10; // 1..10

function puedeUsarBiblioteca() {
  return esAdmin() || esSupervisor();
}

/** Todos los espacios posibles de la estantería, en orden (A1, A2, …, A10, B1, …). */
function todosLosEspacios() {
  const out = [];
  BIBLIOTECA_LETRAS.forEach(letra => {
    for (let n = 1; n <= BIBLIOTECA_NUMEROS_POR_LETRA; n++) out.push(letra + n);
  });
  return out;
}

/** Todos los artículos (pares) de todas las órdenes, con su orden ya
 *  resuelta. Se descartan los artículos "huérfanos" — aquellos cuya
 *  orden ya no existe (fue eliminada definitivamente) — para que no
 *  sigan apareciendo en Biblioteca como si todavía tuvieran una orden
 *  válida detrás. Esto también limpia, al vuelo, artículos que hayan
 *  quedado huérfanos por datos viejos (de antes de este ajuste). */
function todosLosItems() {
  return (state.ordenItems || []).filter(it => !!ordenById(it.ordenId));
}

/** Pares que ya llegaron a "Biblioteca" (último paso del seguimiento en
 *  tiempo real) y todavía no fueron entregados ni tienen un espacio
 *  asignado: son los que el recepcionista tiene que ubicar. */
function itemsPendientesDeUbicar() {
  return todosLosItems().filter(it =>
    !it.entregado &&
    estadoMostradoPar(it) === 'Biblioteca' &&
    !(it.biblioteca && it.biblioteca.ubicacion)
  );
}

/** Pares que tienen un espacio de estantería asignado y todavía no
 *  fueron entregados (por lo tanto siguen ocupando ese espacio físico). */
function itemsUbicadosVigentes() {
  return todosLosItems().filter(it => it.biblioteca && it.biblioteca.ubicacion && !it.entregado);
}

/** Historial completo de registros en biblioteca (para el buscador por
 *  fecha): incluye también los ya entregados, para poder auditar cuándo
 *  se guardó cada artículo aunque ya se haya retirado. */
function itemsConRegistroBiblioteca() {
  return todosLosItems().filter(it => it.biblioteca && it.biblioteca.fecha);
}

/** Mapa espacio -> artículo, solo con los que siguen ocupando ese lugar. */
function mapaOcupacion() {
  const mapa = {};
  itemsUbicadosVigentes().forEach(it => { mapa[it.biblioteca.ubicacion] = it; });
  return mapa;
}

function infoOrdenItem(it) {
  const o = ordenById(it.ordenId);
  // El código físico del par (ej. "9-1") se arma al crearlo como
  // NUMERO_DE_ORDEN-NUMERO_DE_ITEM (ver ordenes.js). Si por algún motivo
  // ese prefijo ya no coincide con el número actual de la orden vinculada
  // (ej. datos viejos, u órdenes con numeración duplicada), lo marcamos
  // como "mismatch" para poder avisar en pantalla en vez de mostrar un
  // número de orden que no es el que corresponde al artículo.
  const prefijoCodigo = it.codigo ? String(it.codigo).split('-')[0] : null;
  const numeroOrden = o ? o.numero : '?';
  const mismatch = !!(o && prefijoCodigo && String(numeroOrden) !== prefijoCodigo);
  return {
    numeroOrden,
    cliente: o ? clienteNombre(o.clienteId) : '—',
    mismatch
  };
}

/** Código completo tal como se pide mostrar: "7-1/H1". Si todavía no
 *  tiene espacio asignado, muestra solo el código del par. */
function codigoConUbicacion(it) {
  const ubic = it.biblioteca && it.biblioteca.ubicacion;
  return escHtml(it.codigo) + (ubic ? '<span class="mono">/' + escHtml(ubic) + '</span>' : '');
}

/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */
export function renderBiblioteca() {
  const cont = document.getElementById('biblioteca-content');
  if (!cont) return;
  if (!puedeUsarBiblioteca()) {
    cont.innerHTML = '<div class="hint">No tienes acceso a esta sección.</div>';
    return;
  }

  const pendientes = itemsPendientesDeUbicar();
  const ocupados = itemsUbicadosVigentes();
  const totalEspacios = todosLosEspacios().length;

  cont.innerHTML =
    '<div class="kpi-grid" style="margin-bottom:16px;">' +
      '<div class="kpi-card"><div class="kpi-label">Pendientes de ubicar</div><div class="kpi-value">' + pendientes.length + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Espacios ocupados</div><div class="kpi-value">' + ocupados.length + ' / ' + totalEspacios + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Espacios libres</div><div class="kpi-value">' + (totalEspacios - ocupados.length) + '</div></div>' +
    '</div>' +

    '<div class="panel" style="margin-bottom:16px;" id="biblioteca-pendientes-panel">' +
      '<div class="panel-title">Pendientes de ubicar</div>' +
      '<div class="hint" style="margin-bottom:8px;">Artículos que ya llegaron a "Biblioteca" en el seguimiento y todavía no tienen estante asignado.</div>' +
      '<div id="biblioteca-pendientes-lista"></div>' +
    '</div>' +

    '<div class="panel" style="margin-bottom:16px;" id="biblioteca-buscador-panel">' +
      '<div class="panel-title">Buscar ubicación por número de orden</div>' +
      '<div class="hint" style="margin-bottom:8px;">Escribe el número de orden (ej. 9) o el código completo del artículo (ej. 9-1) para saber en qué estante está.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<input type="text" id="biblioteca-buscar-orden-input" placeholder="Número de orden o código, ej. 9 o 9-1" ' +
          'onkeydown="if(event.key===\'Enter\'){buscarUbicacionPorOrden();event.preventDefault();}" style="flex:1;min-width:200px;">' +
        '<button class="btn btn-primary btn-sm" onclick="buscarUbicacionPorOrden()">🔍 Buscar</button>' +
      '</div>' +
      '<div id="biblioteca-buscar-orden-resultado" style="margin-top:10px;"></div>' +
    '</div>' +

    '<div class="panel" style="margin-bottom:16px;">' +
      '<div class="panel-title">Mapa de estantería</div>' +
      '<div class="hint" style="margin-bottom:8px;">Verde: libre. Rojo: ocupado. Letras y números en negro (toca un espacio ocupado para ver el detalle).</div>' +
      '<div id="biblioteca-mapa"></div>' +
    '</div>' +

    '<div class="panel" id="biblioteca-historial-panel">' +
      '<div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<div class="panel-title" style="margin:0;">Registrados en biblioteca</div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          '<input type="date" id="biblioteca-filtro-fecha" onchange="renderBibliotecaLista()">' +
          '<button class="btn btn-ghost btn-sm" onclick="limpiarFiltroFechaBiblioteca()">Ver todos</button>' +
        '</div>' +
      '</div>' +
      '<div class="hint" style="margin:6px 0;">Buscador por fecha: para saber qué se registró en biblioteca un día en particular.</div>' +
      '<div id="biblioteca-lista"></div>' +
    '</div>';

  renderBibliotecaPendientes();
  renderBibliotecaMapa();
  renderBibliotecaLista();
}

function renderBibliotecaPendientes() {
  const el = document.getElementById('biblioteca-pendientes-lista');
  if (!el) return;
  const pendientes = itemsPendientesDeUbicar();
  if (!pendientes.length) { el.innerHTML = '<div class="hint">No hay artículos pendientes de ubicar.</div>'; return; }
  el.innerHTML = pendientes.map(it => {
    const info = infoOrdenItem(it);
    const avisoMismatch = info.mismatch
      ? '<div class="hint" style="color:var(--red,#D14343);" title="El número de orden guardado en el código del artículo no coincide con el número actual de la orden vinculada. Puede tratarse de un dato viejo o de una orden duplicada.">⚠ El código ' + escHtml(it.codigo) + ' no coincide con la orden #' + escHtml(String(info.numeroOrden)) + '</div>'
      : '';
    return '<div class="panel" style="margin-bottom:8px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div>' +
        '<div><strong class="mono">' + escHtml(it.codigo) + '</strong>' + (it.descripcion ? ' · ' + escHtml(it.descripcion) : '') + '</div>' +
        '<div class="hint">Orden #' + escHtml(String(info.numeroOrden)) + ' · <strong>' + escHtml(info.cliente) + '</strong></div>' +
        avisoMismatch +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="abrirUbicarEnBiblioteca(\'' + escAttr(it.id) + '\')">📚 Ubicar en estantería</button>' +
    '</div>';
  }).join('');
}

function renderBibliotecaMapa() {
  const el = document.getElementById('biblioteca-mapa');
  if (!el) return;
  const ocupacion = mapaOcupacion();
  el.innerHTML = '<div class="biblioteca-grid">' +
    BIBLIOTECA_LETRAS.map(letra => {
      const celdas = [];
      for (let n = 1; n <= BIBLIOTECA_NUMEROS_POR_LETRA; n++) {
        const espacio = letra + n;
        const it = ocupacion[espacio];
        if (it) {
          celdas.push('<div class="biblioteca-celda ocupada" title="' + escAttr(it.codigo) + '" onclick="verEspacioBiblioteca(\'' + escAttr(it.id) + '\')">' +
            '<span class="biblioteca-celda-cod">' + escHtml(espacio) + '</span>' +
            '<span class="biblioteca-celda-item">' + escHtml(it.codigo) + '</span>' +
          '</div>');
        } else {
          celdas.push('<div class="biblioteca-celda libre" title="' + escAttr(espacio) + ' libre">' +
            '<span class="biblioteca-celda-cod">' + escHtml(espacio) + '</span>' +
          '</div>');
        }
      }
      return '<div class="biblioteca-fila"><div class="biblioteca-fila-letra">' + escHtml(letra) + '</div><div class="biblioteca-fila-celdas">' + celdas.join('') + '</div></div>';
    }).join('') +
  '</div>';
}

export function renderBibliotecaLista() {
  const el = document.getElementById('biblioteca-lista');
  if (!el) return;
  const fechaEl = document.getElementById('biblioteca-filtro-fecha');
  const fecha = fechaEl ? fechaEl.value : '';
  let items = itemsConRegistroBiblioteca();
  if (fecha) items = items.filter(it => it.biblioteca.fecha === fecha);
  items = items.sort((a, b) => (b.biblioteca.fecha + (b.biblioteca.hora || '')).localeCompare(a.biblioteca.fecha + (a.biblioteca.hora || '')));

  if (!items.length) {
    el.innerHTML = '<div class="hint">' + (fecha ? 'No hay artículos registrados en biblioteca ese día.' : 'Todavía no hay artículos registrados en biblioteca.') + '</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;"><table class="data">' +
    '<thead><tr><th>Código</th><th>Estante</th><th>Orden</th><th>Cliente</th><th>Registrado</th><th>Entregado</th><th></th></tr></thead>' +
    '<tbody>' +
    items.map(it => {
      const info = infoOrdenItem(it);
      const b = it.biblioteca || {};
      return '<tr>' +
        '<td class="mono">' + escHtml(it.codigo) + '</td>' +
        '<td class="mono">' + escHtml(b.ubicacion || '—') + '</td>' +
        '<td>#' + escHtml(String(info.numeroOrden)) + '</td>' +
        '<td>' + escHtml(info.cliente) + '</td>' +
        '<td>' + fmtDate(b.fecha) + (b.hora ? ' · ' + escHtml(b.hora) : '') + (b.usuario ? ' · ' + escHtml(b.usuario) : '') + '</td>' +
        '<td>' + (it.entregado ? 'Sí' : 'No') + '</td>' +
        '<td>' + (!it.entregado && b.ubicacion ? '<button class="btn btn-ghost btn-sm" onclick="abrirUbicarEnBiblioteca(\'' + escAttr(it.id) + '\')">Reubicar</button>' : '') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}


/* ============================================================
   BUSCADOR: número de orden (o código de artículo) → ubicación
   ============================================================ */
export function buscarUbicacionPorOrden() {
  const el = document.getElementById('biblioteca-buscar-orden-resultado');
  const inputEl = document.getElementById('biblioteca-buscar-orden-input');
  if (!el || !inputEl) return;
  const texto = inputEl.value.trim().replace(/^#/, '');
  if (!texto) { el.innerHTML = '<div class="hint">Escribe un número de orden o un código de artículo.</div>'; return; }

  // Si escriben el código completo del artículo (ej. "9-1"), buscamos ese
  // par puntual. Si escriben solo el número de orden (ej. "9"), mostramos
  // todos los pares de esa orden.
  let items;
  if (texto.includes('-')) {
    items = todosLosItems().filter(it => String(it.codigo) === texto);
  } else {
    const ordenes = state.ordenes.filter(o => String(o.numero) === texto);
    const idsOrdenes = new Set(ordenes.map(o => o.id));
    items = todosLosItems().filter(it => idsOrdenes.has(it.ordenId));
  }

  if (!items.length) {
    el.innerHTML = '<div class="hint">No se encontró ninguna orden ni artículo con "' + escHtml(texto) + '".</div>';
    return;
  }

  el.innerHTML = items.map(it => {
    const info = infoOrdenItem(it);
    const ubic = it.biblioteca && it.biblioteca.ubicacion;
    let estadoTxt;
    if (it.entregado) estadoTxt = '<span class="hint">Ya fue entregado</span>';
    else if (ubic) estadoTxt = '<strong class="mono" style="font-size:16px;">Estante ' + escHtml(ubic) + '</strong>';
    else estadoTxt = '<span class="hint">Todavía no tiene estante asignado</span>';
    return '<div class="panel" style="margin-bottom:6px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div>' +
        '<div><strong class="mono">' + escHtml(it.codigo) + '</strong> · Orden #' + escHtml(String(info.numeroOrden)) + '</div>' +
        '<div class="hint">Cliente: <strong>' + escHtml(info.cliente) + '</strong></div>' +
      '</div>' +
      '<div>' + estadoTxt + '</div>' +
    '</div>';
  }).join('');
}

export function limpiarFiltroFechaBiblioteca() {
  const fechaEl = document.getElementById('biblioteca-filtro-fecha');
  if (fechaEl) fechaEl.value = '';
  renderBibliotecaLista();
}

/* ============================================================
   ASIGNAR ESPACIO
   ============================================================ */
let itemBibliotecaActual = null;

export function abrirUbicarEnBiblioteca(itemId) {
  if (!puedeUsarBiblioteca()) { showToast('No tienes permiso para usar la biblioteca'); return; }
  const it = (state.ordenItems || []).find(x => x.id === itemId);
  if (!it) return;
  itemBibliotecaActual = itemId;
  const info = infoOrdenItem(it);
  const titulo = document.getElementById('biblioteca-modal-titulo');
  if (titulo) titulo.textContent = it.codigo + ' — Orden #' + info.numeroOrden + ' · ' + info.cliente;

  const ocupacion = mapaOcupacion();
  const ubicacionActual = it.biblioteca && it.biblioteca.ubicacion;
  const selLetra = document.getElementById('biblioteca-sel-letra');
  const selNumero = document.getElementById('biblioteca-sel-numero');
  if (selLetra) {
    selLetra.innerHTML = BIBLIOTECA_LETRAS.map(l => '<option value="' + l + '">' + l + '</option>').join('');
    selLetra.value = ubicacionActual ? ubicacionActual.charAt(0) : BIBLIOTECA_LETRAS[0];
    selLetra.onchange = () => poblarNumerosBiblioteca(ocupacion, ubicacionActual);
  }
  poblarNumerosBiblioteca(ocupacion, ubicacionActual);
  openModalEl('modal-biblioteca-ubicar');
}

function poblarNumerosBiblioteca(ocupacion, ubicacionActual) {
  const selLetra = document.getElementById('biblioteca-sel-letra');
  const selNumero = document.getElementById('biblioteca-sel-numero');
  if (!selLetra || !selNumero) return;
  const letra = selLetra.value;
  const opciones = [];
  for (let n = 1; n <= BIBLIOTECA_NUMEROS_POR_LETRA; n++) {
    const espacio = letra + n;
    const ocupadoPorOtro = ocupacion[espacio] && espacio !== ubicacionActual;
    opciones.push('<option value="' + n + '"' + (ocupadoPorOtro ? ' disabled' : '') + '>' + espacio + (ocupadoPorOtro ? ' (ocupado)' : '') + '</option>');
  }
  selNumero.innerHTML = opciones.join('');
  if (ubicacionActual && ubicacionActual.charAt(0) === letra) {
    selNumero.value = ubicacionActual.slice(1);
  }
}

export async function guardarUbicacionBiblioteca(btn) {
  if (!itemBibliotecaActual) return;
  const it = (state.ordenItems || []).find(x => x.id === itemBibliotecaActual);
  if (!it) return;
  if (estadoMostradoPar(it) !== 'Biblioteca') {
    showToast('⚠ Este artículo todavía no llegó a "Biblioteca" en el seguimiento en tiempo real');
    return;
  }
  const letra = document.getElementById('biblioteca-sel-letra').value;
  const numero = document.getElementById('biblioteca-sel-numero').value;
  const espacio = letra + numero;
  const ocupacion = mapaOcupacion();
  if (ocupacion[espacio] && ocupacion[espacio].id !== it.id) {
    showToast('⚠ El espacio ' + espacio + ' ya está ocupado por ' + ocupacion[espacio].codigo);
    return;
  }
  const ahora = new Date();
  const hora = ahora.toTimeString().slice(0, 5);
  it.biblioteca = { ubicacion: espacio, fecha: todayISO(0), hora, usuario: (state.session && state.session.user) || '' };
  try {
    await persist();
    const res = await db.saveOrdenItem(it);
    // db.saveOrdenItem puede "tragarse" un error permanente del servidor
    // (ej. si falta aplicar la migración que agrega la columna
    // "biblioteca" en orden_items) y devolver { error } sin lanzar
    // excepción. Si eso pasa, el cambio queda SOLO en este dispositivo:
    // al recargar los datos desde el servidor (otro dispositivo, o una
    // actualización en tiempo real) el artículo vuelve a aparecer como
    // "pendiente de ubicar" porque el servidor nunca se enteró. Por eso
    // acá avisamos claramente en vez de mostrar un "✓" que no es cierto.
    if (res && res.error && !res.queued) {
      console.error('No se pudo sincronizar la ubicación en biblioteca:', res.error);
      showToast('⚠ Se guardó en este dispositivo, pero no se pudo sincronizar con el servidor. Puede volver a aparecer como pendiente. Avisa a soporte.');
    } else if (res && res.queued) {
      logActivity('Ubicó el artículo ' + it.codigo + ' en el estante ' + espacio);
      showToast('Artículo ' + it.codigo + ' → estante ' + espacio + ' (se sincronizará cuando haya conexión)');
    } else {
      logActivity('Ubicó el artículo ' + it.codigo + ' en el estante ' + espacio);
      showToast('Artículo ' + it.codigo + ' → estante ' + espacio + ' ✓');
    }
    closeModal('modal-biblioteca-ubicar');
    itemBibliotecaActual = null;
    renderBiblioteca();
  } catch (e) {
    console.error('Error al guardar la ubicación en biblioteca:', e);
    showToast('No se pudo guardar la ubicación');
  }
}

export function verEspacioBiblioteca(itemId) {
  abrirUbicarEnBiblioteca(itemId);
}

Object.assign(window, {
  renderBiblioteca, renderBibliotecaLista, limpiarFiltroFechaBiblioteca,
  abrirUbicarEnBiblioteca, guardarUbicacionBiblioteca, verEspacioBiblioteca,
  buscarUbicacionPorOrden
});
