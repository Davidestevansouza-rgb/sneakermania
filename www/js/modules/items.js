/* ============================================================
   MÓDULO: PRECINTO NUMERADO (pares individuales de una orden)
   Cada par dentro de una orden tiene su propio código físico
   (NRO_ORDEN-NRO_ITEM), tipo de servicio y responsable propios,
   estado de taller individual, y se marca como entregado uno por
   uno. Esta capa vive embebida en el Detalle de la orden (antes
   era un menú aparte "Precintos"; se fusionó dentro de Órdenes
   porque Taller y Entrega ya son parte del ciclo de vida de una
   orden y duplicaban esa información en dos lugares distintos).
   ============================================================ */
import { state, persist, todayISO, esEmpleado } from '../state.js';
import * as db from '../db.js';
import { showToast, ordenById, clienteNombre, logActivity, closeModal, openModalEl, fmtDate } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import { itemsDeOrden, estadoMostradoPar } from './ordenes.js';

// Estados posibles del campo it.estado ("artículos individuales"). Comparte
// SOLO EL VOCABULARIO (las mismas 7 etiquetas) con la orden completa
// (FLUJO_ESTADOS, en ordenes.js) y con el seguimiento en tiempo real
// (TIMELINE_STEPS), pero it.estado está vinculado y sincronizado
// EXCLUSIVAMENTE con Servicio de Producción — nunca con el seguimiento en
// tiempo real (ver cambiarEstadoItem más abajo y advanceItemTimelineStep
// en ordenes.js, que ya no lo toca). En la práctica, este campo solo
// llega a valer 'Control de calidad' o 'Biblioteca' si en algún momento
// se guardaron así desde fuera de este flujo (datos viejos); Producción
// nunca los escribe.
//
// El panel de "Artículos individuales" (ver renderItemsPanelHTML) ya NO deja
// elegir el estado a mano con ningún selector: es de solo lectura. it.estado
// avanza EXCLUSIVAMENTE cuando se registra en Servicio de Producción (ver
// registrarPares en produccion.js, que escribe it.estado vía
// SERVICIO_A_ESTADO_ITEM más abajo) — nunca desde el detalle de la orden.
//   - 'Recibido y registrado' es el estado inicial del artículo (se pone solo
//     al crearlo) hasta que Producción lo avance a 'Lavado'.
//   - 'Control de calidad' y 'Biblioteca' NO forman parte de este flujo:
//     esas etapas viven solo en el seguimiento en tiempo real del par
//     (timelineIndex) y en el estado de la ORDEN de servicio (ver
//     sincronizarEstadoOrdenDesdeTimelinePares en ordenes.js); se
//     muestran combinadas solo para lectura en pantalla vía
//     estadoMostradoPar(), sin escribir it.estado.
//   - 'Entregado' se maneja aparte con el checkbox de entrega, habilitado
//     recién cuando el artículo ya está en 'Biblioteca' (último paso del
//     seguimiento, chequeado con estadoMostradoPar(), no con it.estado —
//     ver marcarItemEntregado).
// "Reparación" se quitó del flujo (ya no es un estado seleccionable);
// "Secado"+"Detallado" y "Pintado"+"Personalización" quedaron unificados
// en un solo paso cada uno; "Listo para retirar" se quitó (el flujo
// termina en "Biblioteca").
export const ITEM_ESTADOS = ['Recibido y registrado', 'Lavado', 'Secado y detallado', 'Pintado y personalizado', 'Control de calidad', 'Biblioteca', 'Entregado'];

// Orden de avance de cada estado (para saber cuál es el "más atrasado"
// entre los pares de una orden). Como el par y la orden comparten
// vocabulario, ya no hace falta una tabla de conversión aparte.
const RANGO_ITEM = { 'Recibido y registrado': 0, 'Lavado': 1, 'Secado y detallado': 2, 'Pintado y personalizado': 3, 'Control de calidad': 4, 'Biblioteca': 5 };

// Mapeo del "servicio" que se registra en Producción (Lavado/Secado y
// detallado/Pintado y personalizado, ver el <select> "Servicio" en la
// sección Producción) al estado unificado del par que le corresponde.
// Ahora los 3 servicios usan exactamente el mismo texto que su estado
// (ver ITEM_ESTADOS), así que el mapeo queda 1 a 1. "Reparación" se
// quitó como servicio elegible en Producción (ya no se registra);
// "Secado" y "Detallado" se unificaron en un solo servicio, igual que
// ya estaban unificados como un solo paso en ITEM_ESTADOS.
export const SERVICIO_A_ESTADO_ITEM = {
  'Lavado': 'Lavado',
  'Secado y detallado': 'Secado y detallado',
  'Pintado y personalizado': 'Pintado y personalizado'
};

/** Refresca el panel de pares embebido en el detalle de la orden, si
 *  está abierto, y la lista general de órdenes (por si cambió el chip
 *  de estado de entrega). */
function refrescarVistas(ordenId) {
  const cont = document.getElementById('orden-detalle-items');
  if (cont) cont.innerHTML = renderItemsPanelHTML(ordenId);
  if (window.renderOrdenes) window.renderOrdenes();
}

/** HTML del panel de "Artículos individuales (Taller y Entrega)" que se
 *  incrusta dentro del modal de Detalle de orden. Ya NO incluye acciones
 *  de entrega (ni el checkbox "Entregado" por artículo, ni el botón "Cerrar
 *  orden"): este panel es solo para el avance de trabajo del taller.
 *  El Estado de cada par es de SOLO LECTURA acá (nunca se elige a mano
 *  en el detalle de la orden): avanza únicamente cuando se registra en
 *  Servicio de Producción. El chip de Pago y la píldora de Prioridad que
 *  se muestran junto al Estado son datos de la ORDEN (o.estadoPago /
 *  o.prioridad), iguales para todos sus pares e independientes entre sí:
 *  ni el Pago ni la Prioridad de la orden dependen del Estado o de la
 *  Prioridad/Pago de ningún par en particular, y viceversa.
 */
export function renderItemsPanelHTML(ordenId) {
  const items = itemsDeOrden(ordenId);
  if (!items.length) return '<div class="hint">Esta orden no tiene artículos registrados.</div>';

  return items.map(it => renderItemCardHTML(it)).join('');
}

/** HTML de la tarjeta de UN artículo individual (código, cliente/orden,
 *  servicios, responsables por servicio, fechas, estado y análisis de IA
 *  si lo tiene). Es la misma tarjeta que se ve en el Detalle de la orden
 *  ("Artículos individuales — Taller y Entrega"); se extrajo a su propia
 *  función para poder reutilizarla tal cual en Producción, donde el
 *  empleado necesita ver esta misma información apenas escribe el número
 *  de artículo, sin tener que entrar a Órdenes (pestaña que ya no ve). */
export function renderItemCardHTML(it) {
      const servicios = Array.isArray(it.tipoServicio) && it.tipoServicio.length ? it.tipoServicio.join(', ') : 'Sin servicio asignado';
      // Datos del análisis de IA guardados en este par (si ya se le
      // hizo un análisis). Se listan uno debajo del otro (no en fila)
      // para que se vea toda la información sin tener que desplazar
      // la pantalla hacia un lado.
      const iaInfo = [
        ['Marca', it.marca], ['Modelo', it.modelo], ['Tipo', it.tipoCalzado],
        ['Color', it.color], ['Material', it.material],
        ['Estado del artículo', it.estadoCalzado], ['Tratamiento sugerido', it.tratamientoSugerido]
      ].filter(([, v]) => v);
      const iaHTML = iaInfo.length
        ? '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);display:flex;flex-direction:column;gap:2px;">' +
            '<div class="hint" style="font-weight:700;">🤖 Análisis de IA</div>' +
            iaInfo.map(([label, val]) => '<div class="hint"><strong>' + escHtml(label) + ':</strong> ' + escHtml(val) + '</div>').join('') +
          '</div>'
        : '';
      // Este panel muestra el estado REAL de it.estado, de solo lectura,
      // sin mezclarlo con el Seguimiento en tiempo real (timelineIndex).
      // Pares individuales queda vinculado y sincronizado EXCLUSIVAMENTE
      // con Producción: avanzar el timeline de este par (o de cualquier
      // otro), o elegir un estado a mano acá, ya no es posible — el único
      // lugar que escribe it.estado es registrarPares() en produccion.js.
      // (Antes se usaba estadoMostradoPar(), que sí mezclaba ambos flujos
      // para mostrar en pantalla — eso quedó reservado para otras vistas de
      // solo lectura como chips/QR/filtros, nunca para este panel.)
      const estadoPar = it.estado;
      const orden = ordenById(it.ordenId);
      // Responsable FIJO por cada servicio ya registrado en este artículo
      // (ver registrarPares en produccion.js — item.registroServicios).
      // No se pisan entre sí: si primero lo lavó María y después lo detalló
      // Pedro, quedan los dos nombres, cada uno en su propia línea.
      const registroServicios = (it.registroServicios && typeof it.registroServicios === 'object') ? it.registroServicios : {};
      const ORDEN_SERVICIOS_RESP = ['Lavado', 'Secado y detallado', 'Pintado y personalizado'];
      const responsablesPorServicioHTML = ORDEN_SERVICIOS_RESP
        .filter(s => registroServicios[s] && registroServicios[s].responsable)
        .map(s => '<div class="hint">' + escHtml(s) + ': <strong>' + escHtml(registroServicios[s].responsable) + '</strong>' +
          (registroServicios[s].fecha ? ' · ' + fmtDate(registroServicios[s].fecha) : '') + '</div>')
        .join('');
      // Si aún no se registró ningún servicio en Producción, se muestra el
      // responsable asignado a mano al crear/editar el artículo (compatibilidad).
      const responsableFallbackHTML = !responsablesPorServicioHTML
        ? '<div class="hint">Responsable: ' + escHtml(it.responsable || 'Sin asignar') + '</div>'
        : '';
      // Pago y Prioridad pertenecen al resumen de la orden y ya se muestran
      // fuera de este bloque. No se repiten dentro de cada par.
      const pagoHTML = '';
      const prioridadHTML = '';
      // El estado de trabajo del par ya NO se elige a mano acá: es de
      // solo lectura. Avanza únicamente cuando se registra en Servicio de
      // Producción (ver registrarPares en produccion.js y
      // SERVICIO_A_ESTADO_ITEM más arriba), que es quien escribe it.estado.
      const estadoHTML = '<span class="hint">Estado: ' + escHtml(estadoPar) +
        (estadoPar === 'Entregado' ? ' ✓' : '') + '</span>';
      // Fechas propias del par, tal como se cargaron al crear la orden
      // (ver fechaIngresoPar / fechaEntregaPar en agregarFilaItemOrden,
      // ordenes.js). Si el par no tiene fecha propia guardada (datos
      // viejos), se cae a la fecha general de la orden como respaldo.
      const fechaIngresoHTML = it.fechaIngreso || orden.fechaIngreso;
      const fechaEntregaEstHTML = it.fechaEntregaEstimada || orden.fechaEstimada;
      const fechasParHTML = '<div class="hint">Ingreso: ' + fmtDate(fechaIngresoHTML) +
        ' · Entrega estimada: ' + fmtDate(fechaEntregaEstHTML) + '</div>';
      // Cliente y Nº de orden: no se mostraban acá porque este panel vive
      // incrustado en el Detalle de la orden (ya se ven arriba, en el
      // encabezado de esa pantalla). Pero renderItemCardHTML() también se
      // usa sola en Producción, donde el empleado no tiene esa pantalla de
      // contexto (ya no ve la pestaña Órdenes) — así que ahí sí hace falta.
      const clienteOrdenHTML = orden
        ? '<div class="hint">Orden #' + escHtml(orden.numero) + ' · ' + escHtml(clienteNombre(orden.clienteId)) + '</div>'
        : '';
      return '<div class="panel" style="margin-bottom:8px;padding:10px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
          '<div>' +
            '<div><strong class="mono">' + escHtml(it.codigo) + '</strong>' + (it.descripcion ? ' · ' + escHtml(it.descripcion) : '') + '</div>' +
            clienteOrdenHTML +
            '<div class="hint">' + escHtml(servicios) + '</div>' +
            responsablesPorServicioHTML + responsableFallbackHTML +
            fechasParHTML +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            estadoHTML +
          '</div>' +
        '</div>' +
        iaHTML +
      '</div>';
}

export async function cambiarEstadoItem(itemId, nuevoEstado) {
  const item = (state.ordenItems || []).find(it => it.id === itemId);
  if (!item) return;
  item.estado = nuevoEstado;
  // it.estado queda vinculado y sincronizado SOLO con Servicio de
  // Producción: cambiar el estado de trabajo acá (a mano, o desde
  // Producción — ver registrarPares en produccion.js) nunca toca el
  // Seguimiento en tiempo real del par (timelineIndex/timelineDates), ni
  // al revés (ver advanceItemTimelineStep en ordenes.js, que ya no
  // escribe it.estado). Son dos flujos completamente independientes.
  try {
    await persist();
    await db.saveOrdenItem(item);
    logActivity('Actualizó el artículo ' + item.codigo + ' a "' + nuevoEstado + '"');
    // Vincula con el estado de la orden: la orden se muestra en la
    // etapa más atrasada entre todos sus pares que aún no fueron
    // entregados (así el tablero general refleja el avance real del taller).
    await sincronizarEstadoOrdenDesdeItems(item.ordenId);
    showToast('Artículo ' + item.codigo + ' → ' + nuevoEstado);
    refrescarVistas(item.ordenId);
  } catch (e) {
    console.error('Error al actualizar el estado del artículo:', e);
    showToast('No se pudo actualizar el estado');
  }
}

/** Recalcula el estado de la orden a partir de it.estado de sus pares
 *  pendientes (no entregados): queda en la etapa más atrasada entre
 *  todos. Esta es la mitad "Producción" del vínculo orden↔artículos — solo
 *  cubre Recibido/Lavado/Secado y detallado/Pintado y personalizado (ver
 *  RANGO_ITEM), porque it.estado nunca pasa de ahí. La otra mitad
 *  (Control de calidad en adelante) la sincroniza por separado el
 *  Seguimiento en tiempo real — ver sincronizarEstadoOrdenDesdeTimelinePares
 *  en ordenes.js, que no usa it.estado para nada. */
export async function sincronizarEstadoOrdenDesdeItems(ordenId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const items = itemsDeOrden(ordenId);
  const pendientes = items.filter(it => !it.entregado && RANGO_ITEM[it.estado] !== undefined);
  if (!pendientes.length) return; // sin pares en flujo de taller: no se toca el estado de la orden
  const masAtrasado = pendientes.reduce((min, it) => RANGO_ITEM[it.estado] < RANGO_ITEM[min.estado] ? it : min, pendientes[0]);
  if (masAtrasado.estado !== o.estado && o.estado !== 'Entregado') {
    o.estado = masAtrasado.estado;
    await db.saveOrden(o);
  }
}

export async function marcarItemEntregado(itemId, entregado) {
  const item = (state.ordenItems || []).find(it => it.id === itemId);
  if (!item) return;
  if (entregado) {
    const orden = ordenById(item.ordenId);
    // 1) El artículo debe haber llegado a "Biblioteca" (último paso del
    //    seguimiento en tiempo real) antes de poder entregarse. Esa etapa
    //    la alcanza el Seguimiento en tiempo real (nunca it.estado, que es
    //    de Producción), así que se chequea con estadoMostradoPar(), que
    //    la refleja sin sincronizar nada.
    if (estadoMostradoPar(item) !== 'Biblioteca') {
      showToast('⚠ El artículo ' + item.codigo + ' debe estar en estado "Biblioteca" antes de entregarse');
      refrescarVistas(item.ordenId); // revierte el checkbox visualmente
      return;
    }
    // 2) Se permite entregar pares sueltos aunque falte pagar (ej. el cliente
    //    viene a buscar un par antes de recoger el resto), PERO no se puede
    //    dejar TODOS los pares entregados (entregar el último pendiente) si la
    //    orden todavía tiene saldo pendiente / sin pagar.
    if (orden && orden.estadoPago !== 'Pagado') {
      const pendientesAntes = itemsDeOrden(orden.id).filter(it => !it.entregado);
      if (pendientesAntes.length <= 1) { // este sería el último par pendiente
        showToast('⚠ No se puede entregar el último artículo: la orden #' + orden.numero + ' tiene saldo pendiente (' + (orden.estadoPago || 'pendiente') + '). Cobra el saldo antes de entregar todo.');
        refrescarVistas(orden.id); // revierte el checkbox visualmente
        return;
      }
    }
  }
  item.entregado = entregado;
  // it.estado es de Producción y nunca toma valores del Seguimiento en
  // tiempo real (Control de calidad/Biblioteca): al entregar se marca
  // 'Entregado'; al desmarcar, vuelve al último estado de Producción real
  // ('Pintado y personalizado', el tope de ese flujo), no a 'Biblioteca'
  // — eso sigue viviendo solo en el timelineIndex del par, sin tocar
  // este campo.
  item.estado = entregado ? 'Entregado' : (item.estado === 'Entregado' ? 'Pintado y personalizado' : item.estado);
  item.fechaEntrega = entregado ? todayISO(0) : null;
  try {
    await persist();
    await db.saveOrdenItem(item);
    logActivity((entregado ? 'Entregó' : 'Desmarcó entrega de') + ' el artículo ' + item.codigo);
    refrescarVistas(item.ordenId);
  } catch (e) {
    console.error('Error al marcar la entrega del artículo:', e);
    showToast('No se pudo actualizar la entrega');
  }
}

/** Intenta cerrar la orden como entregada. Avisa si falta algún par. */
export async function cerrarOrdenEntrega(ordenId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const items = itemsDeOrden(ordenId);
  const pendientes = items.filter(it => !it.entregado);
  if (pendientes.length > 0) {
    showToast('⚠ Faltan ' + pendientes.length + ' ' + (pendientes.length === 1 ? 'artículo' : 'artículos') + ' por entregar: ' + pendientes.map(p => p.codigo).join(', '));
    return;
  }
  // No se puede cerrar la orden completa si todavía tiene saldo pendiente.
  if (o.estadoPago !== 'Pagado') {
    showToast('⚠ No se puede cerrar la orden #' + o.numero + ': tiene saldo pendiente (' + (o.estadoPago || 'pendiente') + '). Cobra el saldo antes de entregar todo.');
    return;
  }
  if (o.estado !== 'Entregado') {
    o.estado = 'Entregado';
    o.fechaEntrega = o.fechaEntrega || new Date().toISOString().slice(0, 10);
    try {
      await persist();
      await db.saveOrden(o);
      logActivity('Cerró la orden #' + o.numero + ' — todos los artículos entregados');
    } catch (e) { console.error(e); }
  }
  showToast('Orden #' + o.numero + ' entregada completa ✓');
  refrescarVistas(ordenId);
}

/** HTML del panel de entrega por artículo, dentro de la "ventanilla" de
 *  entrega (modal-entrega-pares). Por cada par muestra su código, su
 *  estado mostrado (Producción combinado con Seguimiento en tiempo
 *  real, solo para lectura) y una acción: si ya está entregado, una
 *  etiqueta fija; si no, un botón "Entregar" habilitado solo cuando el
 *  artículo llegó a "Biblioteca" (ver marcarItemEntregado, que valida esto
 *  y el saldo pendiente antes de guardar nada). */
function renderEntregaParesHTML(ordenId) {
  const o = ordenById(ordenId);
  if (!o) return '<div class="hint">No se encontró la orden.</div>';
  const items = itemsDeOrden(ordenId);
  if (!items.length) {
    // Orden sin pares registrados: se entrega de una sola vez (no hay
    // nada para desglosar acá). Se avisa y se deja la acción de cierre
    // directo, igual que antes de existir este desglose por par.
    return '<div class="hint">Esta orden no tiene artículos registrados individualmente.</div>' +
      (o.estado !== 'Entregado'
        ? '<div style="margin-top:12px;"><button class="btn btn-teal btn-sm" onclick="cerrarOrdenSinPares(\'' + escAttr(o.id) + '\')">📦 Marcar orden como Entregada</button></div>'
        : '<div class="hint" style="margin-top:12px;">Esta orden ya está Entregada ✓</div>');
  }
  const pendientes = items.filter(it => !it.entregado).length;
  const resumen = '<div class="hint" style="margin-bottom:10px;">' +
    (pendientes === 0
      ? 'Todos los artículos de la orden #' + escHtml(o.numero) + ' ya fueron entregados.'
      : pendientes + ' de ' + items.length + ' ' + (items.length === 1 ? 'artículo pendiente' : 'artículos pendientes') + ' de entrega en la orden #' + escHtml(o.numero) + '.') +
    '</div>';
  return resumen + items.map(it => {
    const estadoMostrado = estadoMostradoPar(it);
    const listoParaEntregar = estadoMostrado === 'Biblioteca';
    let accion;
    if (it.entregado) {
      accion = '<span class="hint">Entregado' + (it.fechaEntrega ? ' · ' + fmtDate(it.fechaEntrega) : '') + ' ✓</span>';
    } else if (listoParaEntregar) {
      accion = '<button class="btn btn-teal btn-sm" onclick="entregarParDesdeModal(\'' + escAttr(it.id) + '\')">Entregar</button>';
    } else {
      accion = '<span class="hint" title="Debe llegar a &quot;Biblioteca&quot; en el seguimiento en tiempo real antes de poder entregarse">Aún no listo (' + escHtml(estadoMostrado) + ')</span>';
    }
    return '<div class="panel" style="margin-bottom:8px;padding:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div>' +
        '<div><strong class="mono">' + escHtml(it.codigo) + '</strong>' + (it.descripcion ? ' · ' + escHtml(it.descripcion) : '') + '</div>' +
        '<div class="hint">' + escHtml(estadoMostrado) + '</div>' +
      '</div>' +
      accion +
    '</div>';
  }).join('');
}

/** Abre la "ventanilla" de entrega: un modal aparte (no el Detalle de
 *  orden) donde se listan los pares de la orden con su propio botón
 *  "Entregar", para el caso en que el cliente venga a buscar solo
 *  alguno de los pares antes que el resto. Reemplaza, en el botón
 *  "📦 Entregado" de la tarjeta de la orden, el cierre directo de toda
 *  la orden de una sola vez (ver entregarOrden en ordenes.js, que ya no
 *  se usa desde ese botón). */
export function openEntregaParesModal(ordenId) {
  if (esEmpleado()) { showToast('No tienes permiso para marcar la entrega'); return; }
  const o = ordenById(ordenId);
  if (!o) return;
  const extra = document.getElementById('entrega-pares-titulo-extra');
  if (extra) extra.textContent = '#' + o.numero;
  const cont = document.getElementById('entrega-pares-content');
  if (cont) cont.innerHTML = renderEntregaParesHTML(ordenId);
  openModalEl('modal-entrega-pares');
}

/** Refresca el contenido de la ventanilla de entrega, si está abierta,
 *  además del resto de vistas (panel de pares del detalle, lista de
 *  órdenes). */
function refrescarVentanillaEntrega(ordenId) {
  const modalAbierto = document.getElementById('modal-entrega-pares');
  if (modalAbierto && modalAbierto.classList.contains('open')) {
    const cont = document.getElementById('entrega-pares-content');
    if (cont) cont.innerHTML = renderEntregaParesHTML(ordenId);
  }
}

/** Wrapper que llama el botón "Entregar" de cada artículo en la ventanilla:
 *  usa la misma lógica ya validada de marcarItemEntregado (chequea que
 *  el artículo esté en "Biblioteca" y el saldo pendiente) y después refresca
 *  también la ventanilla, no solo el panel del Detalle de orden. */
export async function entregarParDesdeModal(itemId) {
  const item = (state.ordenItems || []).find(it => it.id === itemId);
  if (!item) return;
  await marcarItemEntregado(itemId, true);
  refrescarVentanillaEntrega(item.ordenId);
}

/** Cierra directo una orden que nunca tuvo pares individuales
 *  registrados (no hay nada para desglosar en la ventanilla). Misma
 *  validación de saldo pendiente que ya tenía entregarOrden. */
export async function cerrarOrdenSinPares(ordenId) {
  if (esEmpleado()) { showToast('No tienes permiso para marcar la entrega'); return; }
  const o = ordenById(ordenId);
  if (!o) return;
  if (o.estado === 'Entregado') { showToast('La orden #' + o.numero + ' ya está entregada'); return; }
  if ((o.estadoPago || 'Pendiente') !== 'Pagado') {
    showToast('⚠ No se puede marcar como Entregado la orden #' + o.numero + ': tiene saldo pendiente (' + (o.estadoPago || 'pendiente') + '). Cobra el saldo antes de marcarla.');
    return;
  }
  try {
    o.estado = 'Entregado';
    o.fechaEntrega = o.fechaEntrega || todayISO(0);
    await persist();
    await db.saveOrden(o);
    logActivity('Marcó como Entregado la orden #' + o.numero);
    if (window.renderOrdenes) window.renderOrdenes();
    showToast('Orden #' + o.numero + ' → Entregado ✓');
    closeModal('modal-entrega-pares');
  } catch (e) { console.error(e); showToast('Error al marcar la entrega'); }
}

Object.assign(window, {
  renderItemsPanelHTML, cambiarEstadoItem, marcarItemEntregado, cerrarOrdenEntrega,
  openEntregaParesModal, entregarParDesdeModal, cerrarOrdenSinPares
});
