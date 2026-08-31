/* ============================================================
   MÓDULO: ÓRDENES
   Incluye: gestión de órdenes, seguimiento en tiempo real,
   control de calidad, firmas digitales, cobros (QR / efectivo),
   corrección de pagos, detalle e impresión de comprobante.
   ============================================================ */
import { state, todayISO, persist, ensurePagoFields, puedeEditarOrdenes, esEmpleado } from '../state.js';
import * as db from '../db.js';
import {
  showToast, fmtMoney, fmtDate, fmtServicios,
  clienteNombre, clienteById, ordenById,
  chipEstado, chipPago, priPill,
  closeModal, openModalEl, logActivity, lockBtn
} from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as storageManager from '../storage-manager.js';
import { ensureEmpleadosCache, getEmpleadosCache } from './empleados.js';
import { renderItemsPanelHTML } from './items.js';
import { limpiarCombo } from '../combo-search.js';

// Vocabulario de 7 etapas que comparten la orden completa y cada par
// individual (ver ITEM_ESTADOS en items.js), y que también usa como
// etiquetas el seguimiento en tiempo real (ver TIMELINE_STEPS más abajo).
// Compartir el vocabulario NO significa que los 3 se sincronicen entre sí:
// hoy cada uno está vinculado con un solo "vecino", nunca con los otros
// dos (ver el resumen de vínculos más abajo, antes de TIMELINE_STEPS).
// "Reparación" se quitó del flujo (ya no es un estado seleccionable);
// "Secado"+"Detallado" y "Pintado"+"Personalización" quedaron unificados
// en un solo paso cada uno. "Listo para retirar" se quitó: el flujo (y el
// seguimiento en tiempo real) ahora termina en "Biblioteca".
export const FLUJO_ESTADOS = ['Recibido y registrado', 'Lavado', 'Secado y detallado', 'Pintado y personalizado', 'Control de calidad', 'Biblioteca', 'Entregado'];

// De los 7 estados de arriba, la orden completa (igual que cada par, ver
// ITEM_ESTADOS en items.js) solo deja elegir 4 a mano — ni en el <select>
// "Estado" del modal de edición ni con el botón "Avanzar estado" se puede
// saltar directo a Control de calidad/Biblioteca/Entregado:
//   - 'Control de calidad' y 'Biblioteca' se alcanzan SOLO avanzando el
//     seguimiento en tiempo real de la orden más allá de
//     "Pintado y personalizado" (órdenes sin artículos registrados), o —si la
//     orden tiene pares registrados— cuando el Seguimiento en tiempo real
//     de alguno de sus pares avanza (ver sincronizarEstadoOrdenDesdeTimelinePares
//     más abajo). El estado de la orden NUNCA se calcula a partir de
//     it.estado de los pares en este tramo: ese campo es de Producción
//     (ver sincronizarEstadoOrdenDesdeItems en items.js, que solo cubre
//     Recibido/Lavado/Secado y detallado/Pintado y personalizado).
//   - 'Entregado' se maneja con la firma de retiro / cierre de la orden
//     (o el checkbox de entrega de cada par), nunca eligiéndolo a mano.
export const ESTADOS_ORDEN_MANUALES = FLUJO_ESTADOS.slice(0, 4);

// ---- Resumen de los 3 vínculos (cada uno exclusivo, sin cruces) ----
//  1) Pares individuales (it.estado)  ↔  Servicio de Producción
//     (cambiarEstadoItem en items.js, registrarPares en produccion.js).
//  2) Seguimiento en tiempo real (timelineIndex del par)  ↔  Pares de la
//     orden de servicio, es decir el estado de la ORDEN (o.estado), vía
//     sincronizarEstadoOrdenDesdeTimelinePares más abajo.
//  3) it.estado nunca lo escribe el Seguimiento, y o.estado (cuando viene
//     de pares) nunca se calcula a partir de it.estado más allá de
//     "Pintado y personalizado". Lo único que combina ambos flujos es
//     estadoMostradoPar(), y solo para MOSTRAR en pantalla (chips, QR,
//     filtro) — no persiste ni sincroniza nada.

// Tipos de servicio disponibles por par (antes eran solo de la orden
// completa; ahora cada par elige los suyos al agregarse, para poder
// repartir el trabajo con precisión).
export const SERVICIOS_PAR = ['Limpieza básica', 'Limpieza profunda', 'Blanqueamiento de suela', 'Restauración de color', 'Zapatería', 'Expreso ⚡'];

/* ------------------------------------------------------------
   QR de la orden: codifica TODA la información de la orden como
   texto legible, de modo que al escanearlo se vea el detalle
   completo del cliente y su calzado.
   ------------------------------------------------------------ */
// Presupuesto seguro de caracteres para el texto del QR. Por encima de
// esto, la API pública de generación de QR (api.qrserver.com) empieza a
// fallar o a devolver una imagen rota/interrogación, sobre todo en
// órdenes con muchos artículos (ej. 50 pares), porque cada línea de
// detalle por par suma rápido. Además, cuanto más texto lleva el QR, más
// denso (más "cuadraditos") sale el código para la misma imagen, y a
// partir de cierto punto la cámara del celular ya no lo puede enfocar ni
// leer aunque la imagen se genere bien. Por eso el presupuesto es chico
// a propósito: prioriza que el QR se pueda ESCANEAR sobre meter el
// detalle completo. En vez de arriesgar un QR ilegible o roto, se arma
// el texto en niveles cada vez más compactos hasta que entra.
const QR_TEXT_BUDGET = 420;

function lineaArticuloCompleta(it) {
  const serviciosIt = Array.isArray(it.tipoServicio) ? it.tipoServicio.join('/') : '';
  return 'Artículo ' + (it.numeroItem || it.codigo) + ': ' + (it.descripcion || 'sin descripción') +
    (serviciosIt ? ' · Servicio: ' + serviciosIt : '') +
    (it.responsable ? ' · Resp: ' + it.responsable : '') +
    ' · Estado: ' + estadoMostradoPar(it) +
    (it.entregado ? ' (Entregado)' : '');
}
function lineaArticuloCompacta(it) {
  // Sin servicio/responsable, descripción recortada: mantiene lo esencial
  // para reconocer el par al escanear, pero mucho más corto.
  const desc = (it.descripcion || 'sin descripción').slice(0, 28);
  return (it.numeroItem || it.codigo) + ': ' + desc + ' · ' + estadoMostradoPar(it) + (it.entregado ? ' (Ent.)' : '');
}
function lineaArticuloMinima(it) {
  // Solo código y estado abreviado — lo mínimo para ubicar el par.
  return (it.numeroItem || it.codigo) + ' ' + estadoMostradoPar(it);
}

/** Devuelve la primera "foto general" (categoría todos_pares, la del campo
 *  "Fotos generales" del Registro General de los Pares) guardada en la
 *  orden, o null si todavía no tiene ninguna. La usa el envío automático
 *  de WhatsApp al registrar la orden y el botón "💬 WhatsApp". */
function primeraFotoGeneralOrden(o) {
  const fotos = o && o.extra && Array.isArray(o.extra.fotos) ? o.extra.fotos : [];
  return fotos.find(f => f.categoria === 'todos_pares') || null;
}

/** Descarga una foto ya subida (por su URL) y la convierte en File, para
 *  poder adjuntarla junto con el texto en un solo mensaje de WhatsApp
 *  (ver enviarWhatsAppConFoto en whatsapp-limites.js). Si falla la
 *  descarga (sin conexión, CORS, etc.) devuelve null y el mensaje se
 *  envía solo con texto, como antes. */
async function fotoUrlAFile(foto, nombreArchivo) {
  if (!foto || !foto.url) return null;
  try {
    const secureUrl = await storageManager.resolveImageUrl(foto.url, foto.path);
    const resp = await fetch(secureUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new File([blob], nombreArchivo || 'foto.jpg', { type: blob.type || 'image/jpeg' });
  } catch (e) {
    console.error('No se pudo preparar la foto para WhatsApp:', e);
    return null;
  }
}

export function ordenQrText(o) {
  const c = clienteById(o.clienteId) || {};
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  const items = itemsDeOrden(o.id);
  const header = [
    'Orden #' + o.numero,
    'Cliente: ' + (c.nombre || '—'),
    c.telefono ? 'Tel: ' + c.telefono : null,
    'Ingreso: ' + fmtDate(o.fechaIngreso),
    'Entrega est.: ' + fmtDate(o.fechaEstimada)
  ].filter(Boolean);
  const footer = 'Total: ' + fmtMoney(valorFinal) + ' · Pagado: ' + fmtMoney(o.pagado);

  const armar = (lineasArticulos) => header.concat(lineasArticulos, [footer]).filter(Boolean).join('\n');

  if (!items.length) {
    return armar([
      'Artículo: ' + ([o.marca, o.modelo].filter(Boolean).join(' ') || '—'),
      'Color/Talla: ' + (o.color || '—') + ' / ' + (o.talla || '—'),
      'Estado general: ' + (o.estado || '—')
    ]);
  }

  const encabezadoArticulos = '--- Artículos (' + items.length + ') ---';

  // Nivel 1: detalle completo por par.
  let texto = armar([encabezadoArticulos].concat(items.map(lineaArticuloCompleta)));
  if (texto.length <= QR_TEXT_BUDGET) return texto;

  // Nivel 2: línea compacta por par (sin servicio ni responsable).
  texto = armar([encabezadoArticulos].concat(items.map(lineaArticuloCompacta)));
  if (texto.length <= QR_TEXT_BUDGET) return texto;

  // Nivel 3: solo código + estado, todos los pares.
  texto = armar([encabezadoArticulos].concat(items.map(lineaArticuloMinima)));
  if (texto.length <= QR_TEXT_BUDGET) return texto;

  // Nivel 4: siguen sin entrar (demasiados pares) — se listan los que
  // quepan y se indica cuántos quedan afuera, en vez de romper el QR.
  const lineasMin = items.map(lineaArticuloMinima);
  const usados = [];
  const baseLen = armar([encabezadoArticulos, '+0 artículos más']).length;
  let acumulado = baseLen;
  for (const linea of lineasMin) {
    if (acumulado + linea.length + 1 > QR_TEXT_BUDGET) break;
    usados.push(linea);
    acumulado += linea.length + 1;
  }
  const restantes = items.length - usados.length;
  const lineasFinal = [encabezadoArticulos].concat(usados);
  if (restantes > 0) lineasFinal.push('+' + restantes + ' artículo(s) más — ver detalle completo en la app');
  return armar(lineasFinal);
}
function ordenQrUrl(o, size = 160) {
  const texto = ordenQrText(o);
  // ecc=L (corrección de errores baja) reduce la densidad del QR para la
  // misma cantidad de texto, dejando "cuadraditos" más grandes y fáciles
  // de enfocar con la cámara del celular. Si el texto es largo, además se
  // agranda la imagen: mismo número de módulos pero cada uno ocupa más
  // píxeles, que es lo que realmente ayuda a que se pueda escanear.
  const sizeFinal = texto.length > 250 ? Math.max(size, 260) : size;
  return 'https://' + 'api.qrserver.com' + '/v1/create-qr-code/?size=' + sizeFinal + 'x' + sizeFinal + '&ecc=L&margin=8&data=' + encodeURIComponent(texto);
}

/** Descarga el QR de la orden como imagen PNG (útil en el teléfono). */
export async function downloadOrdenQR(id) {
  const o = ordenById(id);
  if (!o) return;
  const url = ordenQrUrl(o, 420);
  const nombre = 'QR-orden-' + o.numero + '.png';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('QR no disponible (' + resp.status + ')');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    showToast('QR descargado');
  } catch (e) {
    // Si el navegador bloquea la descarga directa, abre la imagen para guardarla manualmente.
    window.open(url, '_blank');
    showToast('Abrí el QR en otra pestaña: mantén pulsado para guardarlo.');
  }
}

const TIMELINE_STEPS = [
  { key: 'recibido', label: 'Recibido y registrado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'secado_detallado', label: 'Secado y detallado' },
  { key: 'pintado_personalizado', label: 'Pintado y personalizado' },
  { key: 'calidad', label: 'Control de calidad' },
  { key: 'empaque', label: 'Biblioteca' }
];

// Traduce entre el vocabulario de "estado de trabajo" (FLUJO_ESTADOS /
// ITEM_ESTADOS) y los pasos del Seguimiento en tiempo real (TIMELINE_STEPS),
// que comparten las mismas 7 etiquetas. Ya NO implica que ambos flujos se
// escriban entre sí: el Seguimiento en tiempo real está vinculado y
// sincronizado SOLO con el estado de la orden de servicio (ver
// sincronizarEstadoOrdenDesdeTimelinePares), nunca con it.estado del par
// individual (ese campo lo maneja solo Producción — ver items.js). Este
// mapeo se usa hoy solo para traducir un índice de timeline a una etiqueta
// (estadoDeTimelineIndex) y para el estado "mostrado" de lectura
// (estadoMostradoPar), no para sincronizar nada.
const ESTADO_A_TIMELINE_KEY = {
  'Recibido y registrado': 'recibido',
  'Lavado': 'lavado',
  'Secado y detallado': 'secado_detallado',
  'Pintado y personalizado': 'pintado_personalizado',
  'Control de calidad': 'calidad',
  'Biblioteca': 'empaque'
};

/** Índice del timeline que le corresponde a un estado "de trabajo". */
export function timelineIndexDeEstado(estado) {
  const key = ESTADO_A_TIMELINE_KEY[estado];
  const idx = TIMELINE_STEPS.findIndex(s => s.key === key);
  return idx === -1 ? 0 : idx;
}

/** Inversa: a qué estado "de trabajo" corresponde un índice del timeline
 *  (usado al avanzar el seguimiento a mano con "Marcar completado", para
 *  reflejarlo también en el selector de estado del par/orden). Con el
 *  mapeo 1 a 1 (ver ESTADO_A_TIMELINE_KEY) cada paso del timeline tiene
 *  su propio estado de trabajo correspondiente. */
export function estadoDeTimelineIndex(index) {
  const step = TIMELINE_STEPS[Math.min(index, TIMELINE_STEPS.length - 1)];
  const key = step ? step.key : 'recibido';
  const encontrado = Object.entries(ESTADO_A_TIMELINE_KEY).find(([, k]) => k === key);
  return encontrado ? encontrado[0] : 'Recibido y registrado';
}

// La base de datos (ver supabase/migrations/016_unificar_estados.sql y
// 017_quitar_finalizado.sql) acepta estos 7 valores para ordenes.estado y
// orden_items.estado (constraint ordenes_estado_check / orden_items_estado_check).
// Ya NO se colapsan 'Control de calidad' y 'Biblioteca' en un único
// 'Finalizado': cada uno se guarda con su propio nombre.
export const ORDEN_ESTADOS_DB = ['Recibido y registrado', 'Lavado', 'Secado y detallado', 'Pintado y personalizado', 'Control de calidad', 'Biblioteca', 'Entregado'];

/** Traduce un índice del timeline al estado "guardable" en la base de
 *  datos. Con el constraint ampliado (ver ORDEN_ESTADOS_DB) esto ya es
 *  simplemente estadoDeTimelineIndex — se mantiene esta función aparte
 *  para no tener que tocar cada punto que ya la llama. */
export function estadoGuardableDeTimelineIndex(index) {
  return estadoDeTimelineIndex(index);
}
const QC_ITEMS = [
  ['limpieza', 'Limpieza'], ['costuras', 'Costuras'], ['cordones', 'Cordones'],
  ['pintura', 'Pintura'], ['pegado', 'Pegado'], ['suela', 'Suela'],
  ['plantillas', 'Plantillas'], ['fotos', 'Fotografías finales']
];

// Variables con ámbito de módulo (reemplazan las globales window._*).
let pagoQrOrdenId = null;
let pagoEfectivoOrdenId = null;
let corregirPagoOrdenId = null;
// Evita que, por demora de red al presionar el botón varias veces, se
// registre el mismo pago más de una vez (ver confirmarPagoQR/Efectivo y
// guardarCorreccionPago más abajo).
let pagoQrEnProceso = false;
let pagoEfectivoEnProceso = false;
let corregirPagoEnProceso = false;

/* ---------------- Órdenes ---------------- */
// Se mantiene el nombre por compatibilidad con quien la importa (app.js),
// pero ya no llena un <select>: el selector de cliente de "Nueva orden" /
// "Editar orden" es un buscador por nombre (ver filtrarClientesComboOrden),
// igual que en el modal fusionado de "Nuevo cliente + orden". Con muchos
// clientes registrados, elegir uno en un <select> desplegable era muy lento.
export function populateClienteSelect() {}

/** Buscador tipo autocompletar del cliente para "Nueva orden"/"Editar orden"
 *  (por nombre, teléfono o WhatsApp), igual que en el modal fusionado de
 *  "Nuevo cliente + orden". */
export function filtrarClientesComboOrden(texto) {
  const results = document.getElementById('orden-cliente-results');
  if (!results) return;
  const q = (texto || '').trim().toLowerCase();
  const todos = (state.clientes || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  const base = q ? todos.filter(c => {
    const nombre = (c.nombre || '').toLowerCase();
    const tel = (c.telefono || '').toLowerCase();
    const wa = (c.whatsapp || '').toLowerCase();
    return nombre.includes(q) || tel.includes(q) || wa.includes(q);
  }) : todos;
  // Prioriza los nombres que EMPIEZAN con lo escrito.
  const rank = c => {
    if (!q) return 0;
    const nombre = (c.nombre || '').toLowerCase();
    return nombre.startsWith(q) ? 0 : 1;
  };
  const matches = base.sort((a, b) => rank(a) - rank(b)).slice(0, 20);
  results.innerHTML = matches.length ? matches.map(c =>
    '<div class="combo-item" onmousedown="seleccionarClienteOrden(\'' + escAttr(c.id) + '\')">' +
      '<strong>' + escHtml(c.nombre) + '</strong>' + (c.whatsapp ? ' · ' + escHtml(c.whatsapp) : '') +
    '</div>'
  ).join('') : '<div class="combo-empty">Sin resultados</div>';
}

/** Al elegir un cliente del buscador de "Nueva orden"/"Editar orden": guarda
 *  su id en el campo oculto y muestra su nombre en el buscador. */
export function seleccionarClienteOrden(clienteId) {
  const searchEl = document.getElementById('orden-cliente-search');
  const hiddenEl = document.getElementById('orden-cliente');
  limpiarCombo('orden-cliente-results');
  const c = (state.clientes || []).find(x => x.id === clienteId);
  if (hiddenEl) hiddenEl.value = clienteId;
  if (searchEl) searchEl.value = c ? (c.nombre || '') : '';
}

export function renderOrdenes() {
  const estado = document.getElementById('filtro-estado').value;
  const prioridad = document.getElementById('filtro-prioridad').value;
  const pago = document.getElementById('filtro-pago').value;
  const texto = (document.getElementById('filtro-orden-texto').value || '').toLowerCase();
  document.getElementById('ordenes-sub').textContent = state.ordenes.length + ' órdenes registradas';

  // Buscador de fechas (junto a "+ Nueva orden"): filtra por fecha de
  // ingreso de la orden usando el rango Desde/Hasta del panel.
  const fDesde = document.getElementById('orden-fecha-desde');
  const fHasta = document.getElementById('orden-fecha-hasta');
  const fechaDesde = fDesde ? fDesde.value : '';
  const fechaHasta = fHasta ? fHasta.value : '';
  if (typeof actualizarBotonFiltroFechaOrden === 'function') actualizarBotonFiltroFechaOrden(!!(fechaDesde || fechaHasta));

  let list = state.ordenes.slice().sort((a, b) => b.numero - a.numero);
  if (fechaDesde || fechaHasta) {
    list = list.filter(o => {
      if (!o.fechaIngreso) return false;
      const fecha = o.fechaIngreso.slice(0, 10);
      if (fechaDesde && fecha < fechaDesde) return false;
      if (fechaHasta && fecha > fechaHasta) return false;
      return true;
    });
  }
  // El filtro de estado compara contra el estado general de la orden, pero
  // una orden con varios pares puede tener cada par en un paso distinto
  // (ver paresBreakdownHTML abajo); si no se mira también el estado de
  // cada artículo, una orden con artículos en "Lavado" no aparece al filtrar por
  // "Lavado" salvo que ese sea también el estado general.
  if (estado) list = list.filter(o => o.estado === estado || itemsDeOrden(o.id).some(it => estadoMostradoPar(it) === estado));
  if (prioridad) list = list.filter(o => o.prioridad === prioridad);
  if (pago) list = list.filter(o => pago === 'pendiente' ? (o.estadoPago || 'Pendiente') !== 'Pagado' : (o.estadoPago || 'Pendiente') === pago);
  if (texto) {
    list = list.filter(o => {
      const cliente = (clienteNombre(o.clienteId) || '').toLowerCase();
      const marca = (o.marca || '').toLowerCase();
      const modelo = (o.modelo || '').toLowerCase();
      return cliente.includes(texto) || marca.includes(texto) || modelo.includes(texto) || String(o.numero).includes(texto);
    });
  }

  document.getElementById('ordenes-grid').innerHTML = list.length ? list.map(o => {
    const cliente = clienteNombre(o.clienteId);
    // El "Estado" de la card es el del artículo más atrasado (ver
    // sincronizarEstadoOrdenDesdeItems en items.js): con un solo par eso
    // alcanza, pero con varios no se distingue cuál está en qué paso. Por
    // eso, además del estado general de la orden (visible siempre, tenga
    // 0, 1 o varios pares), si hay pares registrados se detalla cada uno
    // con su propio código (ej. "130-1") y su estado/etapa.
    const paresOrden = itemsDeOrden(o.id);
    // Fila "Estado" de la tarjeta: removida a pedido (el estado por artículo
    // ya se ve en paresBreakdownHTML más abajo, así que no hace falta
    // repetir un estado general de la orden acá).
    // Límite de 5 artículos visibles en la tarjeta: con órdenes grandes
    // (ej. Orden Masiva de 50 pares) listarlos todos hacía crecer la
    // celda/tarjeta sin límite y descuadraba el diseño de la grilla. A
    // partir del 6° se pliegan en un desplegable flotante (no empuja el
    // resto de la tarjeta al abrirse) con el resto de los artículos.
    const LIMITE_ARTICULOS_TARJETA = 5;
    const visibles = paresOrden.slice(0, LIMITE_ARTICULOS_TARJETA);
    const ocultos = paresOrden.slice(LIMITE_ARTICULOS_TARJETA);
    const chipArticulo = it => '<span class="mono" style="font-size:12px;">' + escHtml(it.codigo) + ' ' + chipEstado(estadoMostradoPar(it)) + '</span>';
    const paresBreakdownHTML = paresOrden.length
      ? '<div class="ticket-meta-row articulos-cell" style="align-items:flex-start;position:relative;"><span>Artículos</span>' +
          '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">' +
            visibles.map(chipArticulo).join('') +
            (ocultos.length
              ? '<button type="button" class="articulos-mas-btn" onclick="toggleArticulosDropdown(\'' + escAttr(o.id) + '\', event)">+' + ocultos.length + ' más</button>' +
                '<div class="articulos-dropdown" id="articulos-dropdown-' + escAttr(o.id) + '">' +
                  ocultos.map(chipArticulo).join('') +
                '</div>'
              : '') +
          '</div></div>'
      : '';
    return '<div class="ticket">' +
      '<div class="ticket-top"><span class="ticket-num mono">#' + escHtml(o.numero) + '</span><span class="ticket-client">' + escHtml(cliente) + '</span></div>' +
      '<div class="ticket-body">' +
        paresBreakdownHTML +
        '<div class="ticket-meta-row"><span>Prioridad</span>' + priPill(o.prioridad) + '</div>' +
        '<div class="ticket-meta-row"><span>Entrega estimada</span><span>' + fmtDate(o.fechaEstimada) + '</span></div>' +
        // El chip de Pago de la tarjeta solo distingue "pagó todo" vs "no
        // pagó todo": a nivel visual acá, "Parcial" se muestra como
        // "Pendiente" (igual que en el filtro) para no confundir. El dato
        // real (o.estadoPago = 'Parcial') no se toca, así que en Finanzas
        // sigue viéndose y calculándose correcto (monto pagado, pendiente,
        // método, etc.).
        '<div class="ticket-meta-row"><span>Pago</span>' + chipPago(o.estadoPago === 'Parcial' ? 'Pendiente' : o.estadoPago) + '</div>' +
        '<div class="ticket-actions" style="display:flex;justify-content:space-between;align-items:flex-end;">' +
          '<div style="display:flex;gap:6px;">' +
            '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;">' +
              '<button class="btn btn-ghost btn-sm" onclick="viewOrdenDetalle(\'' + escAttr(o.id) + '\')">Ver</button>' +
              // Editar / avanzar estado: solo para quien puede editar órdenes (no el empleado).
              (puedeEditarOrdenes() ? '<button class="btn btn-ghost btn-sm" onclick="openOrdenModal(\'' + escAttr(o.id) + '\')">Editar</button>' : '') +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;">' +
              (puedeEditarOrdenes() && o.estadoPago !== 'Pagado' ? '<button class="btn btn-ghost btn-sm" onclick="openFormaPagoChooser(\'' + escAttr(o.id) + '\')">💰 Forma de pago</button>' : '') +
              // Marcar como Entregado: solo para supervisor/administrador
              // (implica cobro/cierre), solo mientras no esté ya entregada.
              // Abre la "ventanilla" de entrega por artículo (ver
              // openEntregaParesModal en items.js) en vez de cerrar toda la
              // orden de una sola vez: así, si el cliente viene a buscar
              // solo un par antes que el resto, se puede entregar ese par
              // solo y dejar los demás pendientes.
              (!esEmpleado() && o.estado !== 'Entregado'
                ? '<button class="btn btn-ghost btn-sm" onclick="openEntregaParesModal(\'' + escAttr(o.id) + '\')">📦 Entregado</button>'
                : '') +
            '</div>' +
          '</div>' +
          (state.session && state.session.role === 'Administrador' ? '<button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteOrden(\'' + escAttr(o.id) + '\')">Eliminar</button>' : '') +
        '</div>' +
      '</div></div>';
  }).join('') : '<div class="empty-state"><div class="big">▤</div>No hay órdenes que coincidan con el filtro</div>';
}

/** El campo "Estado" ya no se muestra ni se edita a mano en el formulario
 *  de Nueva orden/Editar orden (se sacó de al lado de "Prioridad" porque
 *  ya no hace falta ahí) — el estado real de la orden se ve y se maneja
 *  desde Órdenes de servicio (debajo del número de orden y el cliente,
 *  arriba de los pares) y avanza solo con el seguimiento en tiempo real
 *  o al avanzar cada par. Acá solo queda un campo oculto con el valor
 *  actual, para no romper el resto del guardado de la orden. */
function poblarSelectEstadoOrden(estadoActual) {
  const sel = document.getElementById('orden-estado');
  if (sel) sel.value = estadoActual || 'Recibido y registrado';
}

export async function openOrdenModal(id) {
  if (!puedeEditarOrdenes()) { showToast('No tienes permiso para crear o editar órdenes'); return; }
  await ensureEmpleadosCache(); // para el selector de "Responsable" de cada artículo
  document.getElementById('orden-id').value = id || '';
  document.getElementById('orden-modal-title').textContent = id ? 'Editar orden' : 'Nueva orden';
  const o = id ? ordenById(id) : { clienteId: '', cantidadPares: 1, tipoServicio: [], prioridad: 'Media', estado: 'Recibido y registrado', responsable: '', precio: '', observaciones: '' };
  // Buscador de cliente por nombre (ver filtrarClientesComboOrden): al
  // editar una orden existente se precarga con el nombre del cliente ya
  // asignado; al crear una nueva queda vacío para que el recepcionista
  // busque y elija.
  limpiarCombo('orden-cliente-results');
  const clienteActual = o.clienteId ? (state.clientes || []).find(c => c.id === o.clienteId) : null;
  document.getElementById('orden-cliente-search').value = clienteActual ? (clienteActual.nombre || '') : '';
  document.getElementById('orden-cliente').value = o.clienteId || '';
  document.getElementById('orden-items-list').innerHTML = '';
  // Reinicia "Orden Masiva" al abrir el modal: sin esto, el modo quedaba
  // prendido visualmente si se había usado en una orden anterior aunque
  // ya no aplicara a la que se está por crear/editar ahora.
  ordenMasivaActiva = false;
  const btnMasiva = document.getElementById('btn-orden-masiva');
  if (btnMasiva) btnMasiva.classList.remove('active');
  const indicadorMasiva = document.getElementById('orden-masiva-activo');
  if (indicadorMasiva) {
    indicadorMasiva.textContent = 'Inactivo';
    indicadorMasiva.style.color = 'whait';
  }
  if (id) {
    const itemsExistentes = itemsDeOrden(id);
    itemsExistentes.forEach(it => agregarFilaItemOrden(it));
    // Ya no se agrega una fila vacía por defecto: los pares individuales
    // son opcionales al momento de crear/editar la orden general, se
    // cargan cuando el recepcionista tenga tiempo.
  }
  document.getElementById('orden-cantidad-pares').value = id ? (o.cantidadPares || itemsDeOrden(id).length || 1) : 1;
  document.getElementById('orden-prioridad').value = o.prioridad;
  poblarSelectEstadoOrden(o.estado);
  document.getElementById('orden-precio').value = o.precio;
  document.getElementById('orden-descuento').value = o.descuento || 0;
  // Una vez creada la orden, el precio solo lo cambia el Administrador.
  const precioBloqueado = state.session.role !== 'Administrador' && !!id;
  document.getElementById('orden-precio').disabled = precioBloqueado;
  document.getElementById('orden-precio').title = precioBloqueado ? 'Solo el Administrador puede cambiar el precio de una orden ya creada' : '';
  document.getElementById('orden-observaciones').value = o.observaciones;

  // Registro General de los Pares: número (real si ya existe, o el que
  // le tocará a la próxima orden) y fotos.
  document.getElementById('orden-numero-general').textContent = '#' + (id ? o.numero : state.nextOrderNum);
  fotosGeneralesPendientes = [];
  fotosGeneralesExistentes = id && o.extra && Array.isArray(o.extra.fotos)
    ? o.extra.fotos.filter(f => f.categoria === 'todos_pares')
    : [];
  renderFotosGeneralesPreview();

  openModalEl('modal-orden');
}

export async function saveOrden(btn) {
  if (!puedeEditarOrdenes()) { showToast('No tienes permiso para guardar órdenes'); return; }
  const id = document.getElementById('orden-id').value;
  const data = {
    clienteId: document.getElementById('orden-cliente').value,
    prioridad: document.getElementById('orden-prioridad').value,
    estado: document.getElementById('orden-estado').value,
    precio: Number(document.getElementById('orden-precio').value) || 0,
    descuento: Number(document.getElementById('orden-descuento').value) || 0,
    observaciones: document.getElementById('orden-observaciones').value.trim(),
    cantidadPares: Math.max(1, parseInt(document.getElementById('orden-cantidad-pares').value, 10) || 1)
  };
  if (!data.clienteId) { showToast('Selecciona un cliente antes de guardar la orden'); return; }
  if (!data.precio || data.precio <= 0) { showToast('Debes indicar el precio del servicio antes de guardar la orden'); return; }
  // Los pares individuales son OPCIONALES al crear/editar la orden general:
  // el recepcionista puede registrar la orden ahora y cargar cada par más
  // tarde. Solo se valida descripción + servicio en los que sí se cargaron.
  const filasItems = Array.from(document.querySelectorAll('#orden-items-list .orden-item-row'));
  for (const fila of filasItems) {
    const desc = (fila.querySelector('.item-desc-input')?.value || '').trim();
    const servicios = Array.from(fila.querySelectorAll('.item-servicio-chk:checked')).map(c => c.value);
    if (!desc) { showToast('Cada artículo cargado necesita una descripción (ej: modelo/color) antes de guardar'); return; }
    if (servicios.length === 0) { showToast('Elige al menos un tipo de servicio para cada artículo cargado'); return; }
  }
  // Tipo de servicio y responsable de la orden quedan como un resumen
  // derivado de sus pares (se usan en reportes/facturas/tickets), ya
  // que ahora se eligen por par y no de forma global.
  data.tipoServicio = Array.from(new Set(filasItems.flatMap(fila => Array.from(fila.querySelectorAll('.item-servicio-chk:checked')).map(c => c.value))));
  data.responsable = Array.from(new Set(filasItems.map(fila => fila.querySelector('.item-responsable-input')?.value || '').filter(Boolean))).join(', ');
  // Fecha de ingreso/entrega de la orden = rango que cubre las fechas
  // cargadas par por par (cada par trae su propia fecha de ingreso y
  // fecha estimada de entrega).
  const fechasIngreso = filasItems.map(fila => fila.querySelector('.item-fecha-ingreso-input')?.value).filter(Boolean).sort();
  const fechasEntrega = filasItems.map(fila => fila.querySelector('.item-fecha-entrega-input')?.value).filter(Boolean).sort();
  data.fechaIngreso = fechasIngreso[0] || todayISO(0);
  data.fechaEstimada = fechasEntrega[fechasEntrega.length - 1] || todayISO(3);
  const restore = lockBtn(btn);   // evita doble guardado
  let target;
  let descuentoNuevo = false; // para notificar solo cuando el descuento cambia de verdad
  let esNuevaOrden = false;   // para enviar el WhatsApp automático de registro
  let fotoGeneralParaWhatsApp = null; // primera "foto general" recién cargada, para ir junto con el mensaje
  try {
    if (id) {
      const o = ordenById(id);
      // Una vez CREADA la orden, solo el Administrador puede cambiar el precio.
      // El supervisor puede editar el resto (y registrar descuento), pero no
      // el precio ya fijado.
      if (state.session.role !== 'Administrador' && data.precio !== Number(o.precio)) {
        showToast('No puedes modificar el precio de una orden ya creada. Pídelo al Administrador.');
        data.precio = Number(o.precio);
      }
      if (data.estado === 'Entregado' && o.estado !== 'Entregado') data.fechaEntrega = todayISO(0);
      const descuentoAnterior = Number(o.descuento || 0);
      if (data.descuento > 0 && data.descuento !== descuentoAnterior) descuentoNuevo = true;
      Object.assign(o, data);
      target = o;
      logActivity('Editó orden #' + o.numero);
    } else {
      // IDs con UUID en lugar de Date.now() para evitar colisiones.
      const o = { id: crypto.randomUUID(), numero: state.nextOrderNum++, descuento: 0, pagado: 0, metodoPago: '', fechaPago: '', estadoPago: 'Pendiente', fechaEntrega: '', fotos: { antes: [], durante: [], despues: [], detalle: [], suela: [], laterales: [], todos_pares: [] } };
      Object.assign(o, data);
      state.ordenes.push(o);
      target = o;
      esNuevaOrden = true;
      if (data.descuento > 0) descuentoNuevo = true;
      logActivity('Creó orden #' + o.numero);
    }
    // Fotos generales cargadas en el Registro General de los Pares: se
    // suben a Storage recién ahora, que ya existe un ID real de orden.
    if (fotosGeneralesPendientes.length) {
      if (!target.extra) target.extra = {};
      if (!target.extra.fotos) target.extra.fotos = [];
      fotoGeneralParaWhatsApp = fotosGeneralesPendientes[0].file; // se guarda antes de subir/limpiar
      for (const f of fotosGeneralesPendientes) {
        try {
          const fotoData = await storageManager.uploadFoto(f.file, target.id, 'todos_pares');
          target.extra.fotos.push(fotoData);
        } catch (e) { console.error('No se pudo subir una foto general:', e); }
      }
      fotosGeneralesPendientes = [];
    }
    await persist();
    await db.saveOrden(target);
    // PRECINTO NUMERADO: crea/actualiza/borra los ítems (pares) según lo
    // que el recepcionista cargó en el formulario, cada uno con su código
    // físico único (NRO_ORDEN-NRO_ITEM).
    await sincronizarItemsDesdeFormulario(target);
    if (descuentoNuevo) {
      const clienteDesc = clienteById(target.clienteId);
      db.createNotification({
        tipo: 'descuento',
        texto: 'Descuento de ' + fmtMoney(target.descuento) + ' aplicado en la orden #' + target.numero + ' de ' + (clienteDesc ? clienteDesc.nombre : 'cliente'),
        ordenId: target.id,
        prioridad: 'Media',
        leida: false
      }).catch(e => console.error('No se pudo registrar la notificación de descuento:', e));
    }
    closeModal('modal-orden');
    renderOrdenes();
    showToast('Orden guardada');
    // Envío automático por WhatsApp al registrar una orden nueva: la info
    // del registro (misma que el QR) y la foto general (si se cargó) van
    // JUNTAS en un solo mensaje. No bloquea el guardado si falla.
    if (esNuevaOrden) {
      const clienteWa = clienteById(target.clienteId);
      enviarWhatsAppAutomatico(target, 'Hola ' + (clienteWa ? clienteWa.nombre : '') + ' 👟 ¡Registramos tu pedido (orden #' + target.numero + ')!', fotoGeneralParaWhatsApp);
    }
  } catch (e) {
    console.error(e);
    showToast('Error al guardar la orden');
  } finally { restore(); }
}

/** Marca la orden completa (y todos sus pares) como Entregado de una
 *  sola vez. Ya NO es lo que dispara el botón "📦 Entregado" de la
 *  tarjeta de Órdenes de servicio (ver openEntregaParesModal en
 *  items.js, que abre la ventanilla para entregar par por par); se deja
 *  disponible por si algún flujo necesita el cierre directo de toda la
 *  orden sin pasar por el desglose de pares. Solo para
 *  supervisor/administrador (implica cobro/cierre), y SOLO se valida
 *  (deja marcar) cuando la orden no tiene ningún pago pendiente — es
 *  decir, todos los pares de esa orden ya están pagados. */
export async function entregarOrden(id) {
  if (esEmpleado()) { showToast('No tienes permiso para marcar la entrega'); return; }
  const o = ordenById(id);
  if (!o) return;
  if (o.estado === 'Entregado') { showToast('La orden #' + o.numero + ' ya está entregada'); return; }
  // No se puede marcar como Entregado mientras haya pago pendiente.
  if ((o.estadoPago || 'Pendiente') !== 'Pagado') {
    showToast('⚠ No se puede marcar como Entregado la orden #' + o.numero + ': tiene saldo pendiente (' + (o.estadoPago || 'pendiente') + '). Cobra el saldo antes de marcarla.');
    return;
  }
  try {
    const items = itemsDeOrden(o.id);
    const ahora = new Date().toISOString();
    for (const it of items) {
      if (!it.entregado) {
        it.entregado = true;
        it.estado = 'Entregado';
        it.fechaEntrega = ahora;
        await db.saveOrdenItem(it);
      }
    }
    o.estado = 'Entregado';
    o.fechaEntrega = o.fechaEntrega || todayISO(0);
    await persist();
    await db.saveOrden(o);
    logActivity('Marcó como Entregado la orden #' + o.numero + (items.length ? ' (' + items.length + ' ' + (items.length === 1 ? 'artículo' : 'artículos') + ')' : ''));
    renderOrdenes();
    showToast('Orden #' + o.numero + ' → Entregado ✓');
  } catch (e) { console.error(e); showToast('Error al marcar la entrega'); }
}

export async function advanceEstado(id) {
  if (!puedeEditarOrdenes()) { showToast('No tienes permiso para avanzar el estado de una orden'); return; }
  const o = ordenById(id);
  const idx = FLUJO_ESTADOS.indexOf(o.estado);
  const idxMaxManual = ESTADOS_ORDEN_MANUALES.length - 1; // 'Pintado y personalizado': tope del avance manual
  // Igual que en los artículos, este botón no puede saltar a "Control de
  // calidad", "Biblioteca" ni a "Entregado" — eso queda vinculado al
  // seguimiento en tiempo real de la orden (o, si tiene pares, a como
  // avancen esos pares).
  if (idx >= idxMaxManual) {
    showToast(o.estado === 'Entregado'
      ? 'La orden ya está Entregada'
      : '⚠ Para pasar de "Pintado y personalizado" en adelante avanza el seguimiento en tiempo real de la orden (Detalle de la orden → Seguimiento).');
    return;
  }
  o.estado = FLUJO_ESTADOS[idx + 1];
  logActivity('Avanzó orden #' + o.numero + ' a ' + o.estado);
  try {
    await persist();
    await db.saveOrden(o);
    renderOrdenes();
    showToast('Orden #' + o.numero + ' → ' + o.estado);
  } catch (e) { console.error(e); showToast('Error al actualizar la orden'); }
}

/** Avanza el estado y refresca el modal de detalle (usado por el botón
 *  "Avanzar estado" que ahora también vive adentro del detalle de orden). */
export async function advanceEstadoYRefrescarDetalle(id) {
  await advanceEstado(id);
  if (document.getElementById('modal-orden-detalle').classList.contains('open')) viewOrdenDetalle(id);
}

/* ---------------- Seguimiento en tiempo real ----------------
   Vive únicamente dentro del Detalle de la orden (no hay acceso rápido
   aparte): ahí se elige el par y se ve/avanza su propia línea de
   tiempo, evitando mezclar pares con fechas de entrega distintas. */
export function ensureTimelineFields(o) {
  if (o.timelineIndex === undefined) o.timelineIndex = 0;
  // Protección: si por una migración vieja el índice quedó fuera de rango
  // (por ejemplo, de antes de quitar el paso "Inspección"), se recorta al
  // último paso válido en vez de dejarlo inconsistente.
  if (o.timelineIndex > TIMELINE_STEPS.length - 1) o.timelineIndex = TIMELINE_STEPS.length - 1;
  if (!o.timelineDates) o.timelineDates = {};
  if (!o.controlCalidad) o.controlCalidad = { limpieza: false, costuras: false, cordones: false, pintura: false, pegado: false, suela: false, plantillas: false, fotos: false };
  if (o.controlCalidad.suela === undefined) o.controlCalidad.suela = false;
  // Firmas ahora en campos separados (firma_ingreso, firma_retiro, firma_recepcionista)
  // Mantener retrocompatibilidad con el campo legacy 'firmas' en extra
  if (!o.firmas) o.firmas = { ingreso: null, retiro: null, recepcionista: null };
  // Migrar firmas legacy a los nuevos campos si existen
  if (o.extra?.firmas) {
    if (o.extra.firmas.ingreso && !o.firmaIngreso) o.firmaIngreso = o.extra.firmas.ingreso;
    if (o.extra.firmas.retiro && !o.firmaRetiro) o.firmaRetiro = o.extra.firmas.retiro;
    if (o.extra.firmas.recepcionista && !o.firmaRecepcionista) o.firmaRecepcionista = o.extra.firmas.recepcionista;
  }
  // Fotos en extra.fotos[] como URLs de Storage (Fase 2)
  if (!o.extra) o.extra = {};
  if (!o.extra.fotos) o.extra.fotos = [];
  return o;
}

/** Dibuja la lista de pasos del timeline a partir de un índice/fechas
 *  sueltos, para poder reusarla tanto a nivel de toda la orden (órdenes
 *  sin pares registrados) como a nivel de un par individual. */
function renderTimelineStepsHTML(timelineIndex, timelineDates, onAdvanceAttr, onCalidadAttr) {
  return '<ul class="timeline-list">' + TIMELINE_STEPS.map((step, i) => {
    const stateClass = i < timelineIndex ? 'done' : (i === timelineIndex ? 'current' : 'pending');
    const dot = stateClass === 'done' ? '✓' : (i + 1);
    const dateStr = timelineDates[i] ? '<div class="timeline-date">' + fmtDate(timelineDates[i]) + '</div>' : '';
    let action = '';
    if (stateClass === 'current') {
      if (step.key === 'calidad' && onCalidadAttr) {
        action = '<div class="timeline-action"><button class="btn btn-teal btn-sm" onclick="' + onCalidadAttr + '">Abrir control de calidad</button></div>';
      } else {
        action = '<div class="timeline-action"><button class="btn btn-teal btn-sm" onclick="' + onAdvanceAttr + '">Marcar completado</button></div>';
      }
    }
    return '<li class="timeline-item ' + stateClass + '"><div class="timeline-dot">' + dot + '</div><div><div class="timeline-label">' + escHtml(step.label) + '</div>' + dateStr + action + '</div></li>';
  }).join('') + '</ul>';
}

function renderTimelineHTML(o) {
  ensureTimelineFields(o);
  return renderTimelineStepsHTML(o.timelineIndex, o.timelineDates,
    "advanceTimelineStep('" + escAttr(o.id) + "')",
    "openCalidadModal('" + escAttr(o.id) + "')");
}

export async function advanceTimelineStep(orderId) {
  const o = ordenById(orderId);
  ensureTimelineFields(o);
  if (o.timelineIndex >= TIMELINE_STEPS.length) return;
  o.timelineDates[o.timelineIndex] = todayISO(0);
  o.timelineIndex++;
  // Vincula el seguimiento con el estado de trabajo de la orden (para
  // órdenes sin pares registrados, ver la versión por par más abajo).
  o.estado = estadoGuardableDeTimelineIndex(o.timelineIndex);
  logActivity('Avanzó seguimiento de orden #' + o.numero + ' a "' + (TIMELINE_STEPS[o.timelineIndex] ? TIMELINE_STEPS[o.timelineIndex].label : 'Biblioteca (completado)') + '"');
  try {
    await persist();
    await db.saveOrden(o);
    // Al llegar a "Biblioteca" (último paso del seguimiento) se avisa
    // automáticamente al cliente de que ya puede retirar su pedido.
    if (o.timelineIndex === TIMELINE_STEPS.length - 1) {
      const cli = clienteById(o.clienteId);
      enviarWhatsAppAutomatico(o, 'Hola ' + (cli ? cli.nombre : '') + ' ✅ ¡Tu pedido (orden #' + o.numero + ') está LISTO PARA RETIRAR!');
    }
    viewOrdenDetalle(orderId);
    renderOrdenes();
    showToast('Seguimiento actualizado');
  } catch (e) { console.error(e); showToast('Error al actualizar el seguimiento'); }
}

/* ---------------- Seguimiento en tiempo real POR PAR ----------------
   Antes el seguimiento (las 9 etapas) era uno solo por orden completa.
   El problema: una orden puede traer varios pares (ej. 10 pares) donde
   2 son Exprés (entrega en 3 días) y el resto entrega en 7 días; con un
   único timeline por orden no había forma de ver el avance real de cada
   par por separado. Ahora cada par (ordenItem) guarda su propio índice
   y fechas de avance, y el seguimiento se hace par por par. */
export function ensureItemTimelineFields(it) {
  if (it.timelineIndex === undefined || it.timelineIndex === null) it.timelineIndex = 0;
  if (it.timelineIndex > TIMELINE_STEPS.length - 1) it.timelineIndex = TIMELINE_STEPS.length - 1;
  if (!it.timelineDates || typeof it.timelineDates !== 'object') it.timelineDates = {};
  if (!it.controlCalidad || typeof it.controlCalidad !== 'object') it.controlCalidad = {};
  QC_ITEMS.forEach(([key]) => { if (it.controlCalidad[key] === undefined) it.controlCalidad[key] = false; });
  return it;
}

/** Estado "mostrado" de un artículo para chips, filtros, QR y el panel de
 *  Pares individuales: combina, SOLO PARA LECTURA/VISUALIZACIÓN, los dos
 *  flujos que ahora están desvinculados entre sí:
 *   - it.estado: el campo real y persistido, que de acá en más SOLO lo
 *     escribe Producción (Lavado/Secado y detallado/Pintado y
 *     personalizado/Entregado) — ver cambiarEstadoItem y registrarPares.
 *   - it.timelineIndex: el avance del Seguimiento en tiempo real, que ya
 *     NO escribe it.estado (ver advanceItemTimelineStep más abajo).
 *  Esta función NO persiste nada ni sincroniza un flujo con el otro: solo
 *  decide qué mostrar. Si el Seguimiento ya pasó "Pintado y
 *  personalizado" (Control de calidad en adelante), se muestra esa etapa;
 *  si no, se muestra el estado real de Producción. */
export function estadoMostradoPar(it) {
  ensureItemTimelineFields(it);
  if (it.entregado) return 'Entregado';
  const idxCalidad = timelineIndexDeEstado('Control de calidad');
  return it.timelineIndex >= idxCalidad ? estadoDeTimelineIndex(it.timelineIndex) : it.estado;
}

function renderItemTimelineHTML(it) {
  ensureItemTimelineFields(it);
  return renderTimelineStepsHTML(it.timelineIndex, it.timelineDates,
    "advanceItemTimelineStep('" + escAttr(it.id) + "')",
    "openCalidadModal('" + escAttr(it.ordenId) + "','" + escAttr(it.id) + "')");
}

// Recuerda, por orden, cuál fue el último par elegido en el combo de
// "Seguimiento en tiempo real" — así al volver a abrir el Detalle de la
// orden se sigue viendo el mismo par en vez de resetear siempre al
// primer artículo pendiente (antes parecía que el seguimiento "retrocedía"
// cuando en realidad estaba mostrando otro par).
const ultimoItemSeguimiento = {};

/** Refresca el bloque de seguimiento del par elegido en el <select> del
 *  detalle de la orden. Si se pasa preselectItemId, primero selecciona
 *  ese par en el combo (usado al abrir el detalle directo a un par). */
export function renderSeguimientoItemSeleccionado(ordenId, preselectItemId) {
  const sel = document.getElementById('seguimiento-item-select');
  const cont = document.getElementById('seguimiento-item-timeline');
  if (!sel || !cont) return;
  if (preselectItemId) sel.value = preselectItemId;
  ultimoItemSeguimiento[ordenId] = sel.value;
  const it = itemsDeOrden(ordenId).find(x => x.id === sel.value);
  cont.innerHTML = it
    ? renderItemTimelineHTML(it)
    : '<div class="hint">Selecciona un artículo para ver su seguimiento.</div>';
}

/** Sincroniza el estado de la ORDEN de servicio a partir del Seguimiento
 *  en tiempo real de un par — el único vínculo que tiene el Seguimiento
 *  (con "artículos de órdenes de servicio"), sin tocar en ningún momento
 *  it.estado (el estado de trabajo del par, reservado a Producción). Solo
 *  avanza hacia adelante (nunca hace retroceder la orden) y no toca
 *  órdenes ya entregadas. Usa estadoGuardableDeTimelineIndex y ranguea con
 *  ORDEN_ESTADOS_DB (no FLUJO_ESTADOS) para guardar siempre un valor que
 *  la base de datos acepta. */
export async function sincronizarEstadoOrdenDesdeTimelinePares(it) {
  const o = ordenById(it.ordenId);
  if (!o || o.estado === 'Entregado') return;
  const nuevoEstado = estadoGuardableDeTimelineIndex(it.timelineIndex);
  if (ORDEN_ESTADOS_DB.indexOf(nuevoEstado) > ORDEN_ESTADOS_DB.indexOf(o.estado)) {
    o.estado = nuevoEstado;
    await db.saveOrden(o);
  }
}

export async function advanceItemTimelineStep(itemId) {
  const it = (state.ordenItems || []).find(x => x.id === itemId);
  if (!it) return;
  ensureItemTimelineFields(it);
  if (it.timelineIndex >= TIMELINE_STEPS.length) return;
  it.timelineDates[it.timelineIndex] = todayISO(0);
  it.timelineIndex++;
  // Desvinculado del estado de trabajo del par (it.estado / pares
  // individuales): avanzar el Seguimiento en tiempo real a mano YA NO
  // toca it.estado, que de acá en más solo lo escribe Producción (ver
  // cambiarEstadoItem en items.js y registrarPares en produccion.js).
  // Lo que sí se sincroniza es el estado de la ORDEN de servicio (ver
  // sincronizarEstadoOrdenDesdeTimelinePares más abajo), que es el otro
  // extremo de este vínculo (Seguimiento en tiempo real ↔ pares de la
  // orden de servicio).
  logActivity('Avanzó seguimiento del artículo ' + it.codigo + ' a "' + (TIMELINE_STEPS[it.timelineIndex] ? TIMELINE_STEPS[it.timelineIndex].label : 'Biblioteca (completado)') + '"');
  try {
    await persist();
    const res = await db.saveOrdenItem(it);
    if (res && res.error && !res.queued) {
      showToast('⚠ No se pudo guardar el seguimiento en el servidor: ' + (res.error.message || 'error desconocido'));
    }
    await sincronizarEstadoOrdenDesdeTimelinePares(it);
    // Cuando este artículo llega a "Biblioteca" (último paso) y TODOS los artículos
    // de la orden ya están ahí, se avisa automáticamente al cliente (una sola vez).
    const listoIndex = TIMELINE_STEPS.length - 1;
    if (it.timelineIndex === listoIndex) {
      const pares = itemsDeOrden(it.ordenId);
      const todosListos = pares.length && pares.every(p => (p.timelineIndex || 0) >= listoIndex);
      if (todosListos) {
        const o = ordenById(it.ordenId);
        const cli = o ? clienteById(o.clienteId) : null;
        if (o) enviarWhatsAppAutomatico(o, 'Hola ' + (cli ? cli.nombre : '') + ' ✅ ¡Tu pedido (orden #' + o.numero + ') está LISTO PARA RETIRAR!');
      }
    }
    renderSeguimientoItemSeleccionado(it.ordenId, it.id);
    renderOrdenes();
    showToast('Seguimiento del artículo ' + it.codigo + ' actualizado');
  } catch (e) { console.error(e); showToast('Error al actualizar el seguimiento del artículo'); }
}

/* ---------------- Control de calidad ----------------
   Puede aplicarse a toda la orden (órdenes sin pares registrados) o a
   un par puntual (itemId): cada par tiene su propio checklist, igual
   que su propio seguimiento en tiempo real. */
export function openCalidadModal(orderId, itemId) {
  const o = ordenById(orderId);
  if (!o) return;
  document.getElementById('calidad-orden-id').value = orderId;
  document.getElementById('calidad-item-id').value = itemId || '';
  let checklist, label;
  if (itemId) {
    const it = itemsDeOrden(orderId).find(x => x.id === itemId);
    if (!it) return;
    ensureItemTimelineFields(it);
    checklist = it.controlCalidad;
    label = it.codigo + (it.descripcion ? ' · ' + it.descripcion : '');
  } else {
    ensureTimelineFields(o);
    checklist = o.controlCalidad;
    label = '#' + o.numero + ' · ' + o.marca + ' ' + o.modelo;
  }
  document.getElementById('calidad-orden-label').textContent = label;
  document.getElementById('calidad-checklist').innerHTML = QC_ITEMS.map(([key, lbl]) =>
    '<label class="qc-row"><input type="checkbox" id="qc-' + key + '" ' + (checklist[key] ? 'checked' : '') + '> ' + escHtml(lbl) + '</label>'
  ).join('');
  updateCalidadProgress();
  openModalEl('modal-calidad');
}

export function updateCalidadProgress() {
  const total = QC_ITEMS.length;
  const done = QC_ITEMS.filter(([key]) => document.getElementById('qc-' + key) && document.getElementById('qc-' + key).checked).length;
  document.getElementById('calidad-progress').textContent = done + ' de ' + total + ' verificaciones completadas';
  document.getElementById('calidad-approve-btn').disabled = done < total;
}

export async function saveCalidadChecklist(approve) {
  const orderId = document.getElementById('calidad-orden-id').value;
  const itemId = document.getElementById('calidad-item-id').value;
  const o = ordenById(orderId);
  if (!o) return;
  try {
    if (itemId) {
      const it = itemsDeOrden(orderId).find(x => x.id === itemId);
      if (!it) return;
      ensureItemTimelineFields(it);
      QC_ITEMS.forEach(([key]) => { it.controlCalidad[key] = document.getElementById('qc-' + key).checked; });
      if (approve) {
        const allDone = QC_ITEMS.every(([key]) => it.controlCalidad[key]);
        if (!allDone) { showToast('Faltan verificaciones por completar'); return; }
        it.timelineDates[it.timelineIndex] = todayISO(0);
        it.timelineIndex++;
        logActivity('Aprobó control de calidad del artículo ' + it.codigo);
        closeModal('modal-calidad');
        showToast('Control de calidad del artículo ' + it.codigo + ' aprobado');
      } else {
        logActivity('Guardó avance de control de calidad del artículo ' + it.codigo);
        closeModal('modal-calidad');
        showToast('Checklist guardado');
      }
      await persist();
      await db.saveOrdenItem(it);
      renderSeguimientoItemSeleccionado(orderId, itemId);
      renderOrdenes();
    } else {
      ensureTimelineFields(o);
      QC_ITEMS.forEach(([key]) => { o.controlCalidad[key] = document.getElementById('qc-' + key).checked; });
      if (approve) {
        const allDone = QC_ITEMS.every(([key]) => o.controlCalidad[key]);
        if (!allDone) { showToast('Faltan verificaciones por completar'); return; }
        o.timelineDates[o.timelineIndex] = todayISO(0);
        o.timelineIndex++;
        logActivity('Aprobó control de calidad de orden #' + o.numero);
        closeModal('modal-calidad');
        showToast('Control de calidad aprobado');
      } else {
        logActivity('Guardó avance de control de calidad de orden #' + o.numero);
        closeModal('modal-calidad');
        showToast('Checklist guardado');
      }
      await persist();
      await db.saveOrden(o);
      viewOrdenDetalle(orderId);
      renderOrdenes();
    }
  } catch (e) { console.error(e); showToast('Error al guardar el control de calidad'); }
}

/* ---------------- Firmas digitales ---------------- */
/** Un solo botón en el detalle de la orden abre este selector con las 3
 *  firmas posibles (cliente al entregar, cliente al retirar, recepcionista);
 *  recién ahí se elige cuál capturar o volver a firmar. */
export function openFirmasChooser(orderId) {
  const o = ordenById(orderId);
  if (!o) return;
  document.getElementById('firmas-chooser-content').innerHTML = renderFirmasHTML(o);
  openModalEl('modal-firmas-chooser');
}

function renderFirmasHTML(o) {
  ensureTimelineFields(o);
  const tipos = [
    ['ingreso', 'Firma del cliente al entregar', o.firmaIngreso],
    ['retiro', 'Firma del cliente al retirar', o.firmaRetiro],
    ['recepcionista', 'Firma del recepcionista', o.firmaRecepcionista]
  ];
  return '<div class="firma-grid">' + tipos.map(([key, label, firmaUrl]) => {
    // Retrocompatibilidad: si no hay URL en el campo directo, buscar en o.firmas (legacy)
    let firma = firmaUrl;
    if (!firma && o.firmas && o.firmas[key]) {
      firma = o.firmas[key].data || o.firmas[key]; // Puede ser string directo o {data, fecha}
    }
    
    if (firma) {
      // Detectar si es URL de Storage o base64
      const isStorageUrl = firma.startsWith('http');
      const displayUrl = firma;
      return '<div class="firma-card"><h5>' + escHtml(label) + '</h5><img class="firma-preview" src="' + escAttr(displayUrl) + '"><div class="firma-status">Firmado' + (isStorageUrl ? ' ☁️' : '') + '</div><button class="btn btn-ghost btn-sm" onclick="openFirmaModal(\'' + escAttr(o.id) + '\',\'' + key + '\')">Volver a firmar</button></div>';
    }
    return '<div class="firma-card"><h5>' + escHtml(label) + '</h5><div class="firma-status pending">Pendiente</div><button class="btn btn-teal btn-sm" onclick="openFirmaModal(\'' + escAttr(o.id) + '\',\'' + key + '\')">Capturar firma</button></div>';
  }).join('') + '</div>';
}

// Variables con ámbito de módulo para el pad de firma.
let sigCtx = null, sigDrawing = false, sigHasStroke = false;

export function openFirmaModal(orderId, tipo) {
  document.getElementById('firma-orden-id').value = orderId;
  document.getElementById('firma-tipo').value = tipo;
  const labels = { ingreso: 'Firma del cliente al entregar', retiro: 'Firma del cliente al retirar', recepcionista: 'Firma del recepcionista' };
  document.getElementById('firma-modal-title').textContent = labels[tipo];
  openModalEl('modal-firma');
  setTimeout(initSignaturePad, 50);
}

function initSignaturePad() {
  const canvas = document.getElementById('signature-canvas');
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  sigCtx = canvas.getContext('2d');
  sigCtx.clearRect(0, 0, canvas.width, canvas.height);
  sigCtx.strokeStyle = '#0B0B0D'; sigCtx.lineWidth = 2.2; sigCtx.lineCap = 'round';
  sigHasStroke = false;
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  canvas.onmousedown = canvas.ontouchstart = e => { e.preventDefault(); sigDrawing = true; const p = pos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
  canvas.onmousemove = canvas.ontouchmove = e => { if (!sigDrawing) return; e.preventDefault(); const p = pos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); sigHasStroke = true; };
  canvas.onmouseup = canvas.onmouseleave = canvas.ontouchend = () => { sigDrawing = false; };
}

export function clearSignature() { initSignaturePad(); }

export async function saveSignature() {
  if (!sigHasStroke) { showToast('Dibuja la firma antes de guardar'); return; }
  const orderId = document.getElementById('firma-orden-id').value;
  const tipo = document.getElementById('firma-tipo').value;
  const canvas = document.getElementById('signature-canvas');
  const o = ordenById(orderId);
  ensureTimelineFields(o);
  // Ningún par/orden se confirma como entregado sin estar cancelado (pagado) antes.
  if (tipo === 'retiro' && o.estadoPago !== 'Pagado') {
    showToast('⚠ No se puede registrar la entrega: la orden #' + o.numero + ' todavía no está cancelada (' + (o.estadoPago || 'pendiente') + ')');
    return;
  }
  
  try {
    // Subir firma a Supabase Storage (Fase 2)
    showToast('Subiendo firma...', 'info');
    const base64Data = canvas.toDataURL('image/png');
    const firmaData = await storageManager.uploadFirma(base64Data, orderId, tipo);
    
    // Guardar URL en el campo correspondiente de la orden
    const fieldMap = {
      'ingreso': 'firmaIngreso',
      'retiro': 'firmaRetiro',
      'recepcionista': 'firmaRecepcionista'
    };
    o[fieldMap[tipo]] = firmaData.url;
    
    // Mantener retrocompatibilidad con el campo legacy
    o.firmas[tipo] = { data: firmaData.url, fecha: firmaData.fecha };
    
    if (tipo === 'retiro') {
      o.entregado = true;
      o.fechaEntrega = todayISO(0);
      o.estado = 'Entregado';
      logActivity('Registró firma de retiro y marcó como entregada la orden #' + o.numero);
    } else {
      logActivity('Registró firma (' + tipo + ') en orden #' + o.numero);
    }
    
    await persist();
    await db.saveOrden(o);
    closeModal('modal-firma');
    viewOrdenDetalle(orderId);
    renderOrdenes();
    if (window.renderDashboard) window.renderDashboard();
    showToast('Firma guardada en la nube ☁️');
  } catch (e) {
    console.error(e);
    showToast('Error al guardar la firma: ' + e.message);
  }
}

/* ---------------- Detalle de orden ---------------- */
export function viewOrdenDetalle(id, preselectItemId) {
  const o = ordenById(id);
  const cliente = clienteById(o.clienteId);
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  const qrData = encodeURIComponent('ORDEN-' + o.numero);
  const waMsg = encodeURIComponent('Hola ' + cliente.nombre + ', tu artículo ' + o.marca + ' ' + o.modelo + ' (orden #' + o.numero + ') está en estado: ' + o.estado + '. ¡Gracias por tu confianza!');
  const waLink = 'https://wa.me/' + (cliente.whatsapp || '').replace(/[^0-9]/g, '') + '?text=' + waMsg;
  const itemsOrden = itemsDeOrden(o.id);
  // Si la orden tiene pares registrados, el seguimiento en tiempo real se
  // hace par por par (cada uno con su propia etapa/fecha de entrega, ej.
  // pares Exprés vs. pares normales), eligiendo el par desde un combo en
  // vez de mostrar un único avance mezclado para toda la orden.
  // El seguimiento en tiempo real es solo para supervisor/administrador.
  // El empleado no lo ve (solo registra su producción).
  const seguimientoHTML = esEmpleado()
    ? ''
    : (itemsOrden.length
      ? (
          '<div class="section-subtitle">Seguimiento en tiempo real</div>' +
          '<div class="field full" style="margin-bottom:8px;">' +
            '<label>Ver el seguimiento de este artículo</label>' +
            '<select id="seguimiento-item-select" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;" onchange="renderSeguimientoItemSeleccionado(\'' + escAttr(o.id) + '\')">' +
              itemsOrden.map(it => '<option value="' + escAttr(it.id) + '">' + escHtml(it.codigo) + (it.descripcion ? ' · ' + escHtml(it.descripcion) : '') + (it.entregado ? ' (Entregado)' : '') + '</option>').join('') +
            '</select>' +
          '</div>' +
          '<div id="seguimiento-item-timeline"></div>'
        )
      : (
          '<div class="section-subtitle">Seguimiento en tiempo real</div>' +
          renderTimelineHTML(o)
        ));
  const titExtraEl = document.getElementById('orden-detalle-titulo-extra');
  if (titExtraEl) titExtraEl.textContent = '#' + o.numero + ' · ' + cliente.nombre;
  // El Empleado no ve el QR ni los datos financieros (precio/pagado/descuento)
  // del Detalle de la orden — solo las fechas y la observación.
  // Con muchas líneas de datos el QR sale más denso ("cuadraditos" más
  // chicos): además de generar una imagen fuente más grande (ver
  // ordenQrUrl), se agranda también el tamaño en el que se MUESTRA en
  // pantalla, porque lo que importa para poder escanearlo con la cámara
  // es el tamaño físico en la pantalla, no solo la resolución del archivo.
  const qrDisplaySize = itemsOrden.length > 12 ? 220 : (itemsOrden.length > 4 ? 180 : 140);
  const bloqueQRHTML = esEmpleado() ? '' : (
    '<div style="text-align:center;">' +
    '<img src="' + ordenQrUrl(o, qrDisplaySize) + '" alt="QR de la orden" style="border:1px solid var(--line);border-radius:8px;display:block;width:' + qrDisplaySize + 'px;height:' + qrDisplaySize + 'px;object-fit:contain;" ' +
      'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
    '<div style="display:none;width:' + qrDisplaySize + 'px;height:' + qrDisplaySize + 'px;align-items:center;justify-content:center;text-align:center;font-size:11.5px;color:var(--ink-soft);border:1px dashed var(--line);border-radius:8px;padding:6px;">No se pudo generar el QR. Probá de nuevo o descargalo.</div>' +
    '<button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%;" onclick="downloadOrdenQR(\'' + escAttr(o.id) + '\')">⬇ Descargar QR</button>' +
    '</div>'
  );
  const filasFinancierasHTML = esEmpleado() ? '' : (
      '<tr><th>Precio / Valor final</th><td>' + fmtMoney(o.precio) + ' / ' + fmtMoney(valorFinal) + '</td></tr>' +
      '<tr><th>Pagado / Pendiente</th><td>' + fmtMoney(o.pagado) + ' / ' + fmtMoney(Math.max(valorFinal - o.pagado, 0)) + '</td></tr>' +
      '<tr><th>Descuento</th><td>' + fmtMoney(o.descuento || 0) + '</td></tr>'
  );
  document.getElementById('orden-detalle-content').innerHTML =
    '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;">' +
    bloqueQRHTML +
    '<table class="data" style="flex:1;min-width:220px;"><tbody>' +
      '<tr><th>Fecha de ingreso</th><td>' + fmtDate(o.fechaIngreso) + '</td></tr>' +
      '<tr><th>Fecha estimada</th><td>' + fmtDate(o.fechaEstimada) + '</td></tr>' +
      '<tr><th>Fecha de entrega</th><td>' + fmtDate(o.fechaEntrega) + '</td></tr>' +
      filasFinancierasHTML +
      '<tr><th>Observaciones</th><td>' + escHtml(o.observaciones || '—') + '</td></tr>' +
    '</tbody></table>' +
    '</div>' +
    (itemsOrden.length ? (
      '<div class="section-subtitle">Artículos individuales — Taller y Entrega</div>' +
      '<div id="orden-detalle-items">' + renderItemsPanelHTML(o.id) + '</div>'
    ) : '') +
    seguimientoHTML +
    // El empleado ve el detalle en modo lectura: sin avanzar estado, firmas,
    // comprobantes ni WhatsApp (esas acciones son de supervisor/administrador).
    (esEmpleado() ? '' : (
      '<div class="modal-foot">' +
        // La ELECCIÓN de forma de pago (QR/efectivo) vive solo afuera, en la
        // tarjeta de Órdenes de servicio. Acá adentro solo se VE/EDITA el pago
        // YA registrado: el Administrador puede corregirlo, pero SOLO cuando la
        // orden ya tiene un pago registrado (por si el supervisor lo cargó mal).
        (state.session.role === 'Administrador' && Number(o.pagado || 0) > 0 ? '<button class="btn btn-ghost btn-sm" onclick="openCorregirPagoModal(\'' + escAttr(o.id) + '\')">👁️ Ver/editar forma de pago</button>' : '') +
        // El "Avanzar estado" ya no vive acá: el avance del servicio se hace
        // artículo por artículo en "Artículos individuales" (arriba) y, a nivel de orden,
        // desde la tarjeta de Órdenes de servicio.
        '<button class="btn btn-ghost btn-sm" onclick="openComprobanteChooser(\'' + escAttr(o.id) + '\')">🖨 Comprobante</button>' +
        '<button class="btn btn-teal btn-sm" onclick="enviarWhatsAppOrden(\'' + escAttr(o.id) + '\')">💬 WhatsApp</button>' +
      '</div>'
    ));
  if (itemsOrden.length && !esEmpleado()) {
    // Preselecciona el par que se estaba mirando la última vez (si lo
    // pedís explícito con preselectItemId, o si ya habías elegido uno
    // antes en esta orden). Si no hay ninguno todavía, cae al primer par
    // sin entregar.
    const primerPendiente = itemsOrden.find(it => !it.entregado);
    const ultimoId = ultimoItemSeguimiento[o.id];
    const ultimoValido = ultimoId && itemsOrden.some(it => it.id === ultimoId) ? ultimoId : null;
    renderSeguimientoItemSeleccionado(o.id, preselectItemId || ultimoValido || (primerPendiente ? primerPendiente.id : itemsOrden[0].id));
  }
  openModalEl('modal-orden-detalle');
}

/* ---------------- Precinto Numerado (pares individuales) ---------------- */

/** Devuelve los ítems (pares) activos de una orden, en orden por número. */
export function itemsDeOrden(ordenId) {
  return (state.ordenItems || []).filter(it => it.ordenId === ordenId).sort((a, b) => a.numeroItem - b.numeroItem);
}

/** Agrega una fila al formulario de la orden para cargar un par (ítem).
 *  Si se pasa un ítem existente, la fila queda vinculada a él (para editar
 *  su descripción o, si ya fue entregado, mostrarlo bloqueado). Cada par
 *  trae su propia descripción (obligatoria), tipo(s) de servicio
 *  (obligatorio, puede ser más de uno) y el empleado responsable de
 *  hacerlo, para que el supervisor reparta el trabajo par por par.
 *  `opts` se usa para filas nuevas generadas por "Orden Masiva": permite
 *  mostrar de una vez el código que le va a tocar (ej. "1050-7"), una
 *  descripción y un servicio por defecto (editables), y marcar la fila
 *  como generada en lote (data-masivo) para poder regenerarlas si el
 *  recepcionista cambia la cantidad de pares. */
function agregarFilaItemOrden(item, opts) {
  const cont = document.getElementById('orden-items-list');
  if (!cont) return;
  const o = opts || {};
  const row = document.createElement('div');
  row.className = 'orden-item-row articulo-row';
  row.dataset.itemId = item ? item.id : '';
  if (o.masivo) row.dataset.masivo = '1';
  const codigo = item ? item.codigo : (o.codigoPreview || '(nuevo)');
  const desc = item ? (item.descripcion || '') : (o.descripcionDefault || '');
  const serviciosPar = item && Array.isArray(item.tipoServicio) ? item.tipoServicio : (o.servicioDefault ? [o.servicioDefault] : []);
  const responsablePar = item ? (item.responsable || '') : '';
  const fechaIngresoPar = item ? (item.fechaIngreso || '') : todayISO(0);
  const fechaEntregaPar = item ? (item.fechaEntregaEstimada || '') : todayISO(3);
  const entregado = item ? !!item.entregado : false;
  const empleados = getEmpleadosCache();

  // Chips en vez de una lista desplegable: cada servicio es un botón que
  // se puede prender/apagar, y se pueden marcar varios a la vez.
  const serviciosChips = SERVICIOS_PAR.map((s, i) => {
    const cid = 'svc-' + Math.random().toString(36).slice(2, 8) + '-' + i;
    return '<label for="' + cid + '" class="chip-toggle' + (serviciosPar.includes(s) ? ' checked' : '') + '">' +
      '<input type="checkbox" id="' + cid + '" class="item-servicio-chk" value="' + escAttr(s) + '"' + (serviciosPar.includes(s) ? ' checked' : '') + (entregado ? ' disabled' : '') + ' onchange="this.closest(\'label\').classList.toggle(\'checked\', this.checked)">' +
      escHtml(s) +
    '</label>';
  }).join('');
  const responsableOptions = '<option value="">Sin asignar</option>' + empleados.map(u =>
    '<option value="' + escAttr(u.nombre) + '"' + (responsablePar === u.nombre ? ' selected' : '') + '>' + escHtml(u.nombre) + '</option>'
  ).join('');

  row.innerHTML =
    '<div class="articulo-row-head">' +
      '<span class="mono" style="min-width:64px;font-size:12px;color:var(--ink-soft);">' + escHtml(codigo) + '</span>' +
      '<input class="item-desc-input" placeholder="Ej: Nike Air Force 1 blancas, talla 42 (obligatorio)" value="' + escAttr(desc) + '" ' + (entregado ? 'disabled' : '') + '>' +
      (entregado
        ? '<span class="hint">✓ Entregado</span>'
        : '<button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="quitarFilaItemOrden(this)">✕</button>') +
    '</div>' +
    '<div>' +
      '<label class="hint" style="display:block;margin-bottom:3px;">Servicio de este artículo * (puedes elegir varios)</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + serviciosChips + '</div>' +
    '</div>' +
    '<div class="articulo-row-fields">' +
      '<div>' +
        '<label class="hint" style="display:block;margin-bottom:2px;">Responsable de este artículo</label>' +
        '<select class="item-responsable-input" ' + (entregado ? 'disabled' : '') + '>' + responsableOptions + '</select>' +
      '</div>' +
      '<div>' +
        '<label class="hint" style="display:block;margin-bottom:2px;">Fecha de ingreso</label>' +
        '<input type="date" class="item-fecha-ingreso-input" value="' + escAttr(fechaIngresoPar) + '" ' + (entregado ? 'disabled' : '') + '>' +
      '</div>' +
      '<div>' +
        '<label class="hint" style="display:block;margin-bottom:2px;">Fecha de entrega</label>' +
        '<input type="date" class="item-fecha-entrega-input" value="' + escAttr(fechaEntregaPar) + '" ' + (entregado ? 'disabled' : '') + '>' +
      '</div>' +
    '</div>';
  cont.appendChild(row);
}

/** Quita una fila del formulario (no borra nada de la base todavía —
 *  eso se resuelve recién al guardar la orden). */
function quitarFilaItemOrden(btn) {
  const row = btn.closest('.orden-item-row');
  if (row) row.remove();
}

/** Ajusta el número escrito en "Cantidad de artículos" (solo queda guardado
 *  como dato de referencia para la orden general). Si el modo "Orden
 *  Masiva" está activo, además regenera las filas con los identificadores
 *  secuenciales (ver generarParesMasivos). Si está apagado, se comporta
 *  como antes: no crea ni borra filas en "Artículos de este pedido".
 */
function sincronizarCantidadPares() {
  const input = document.getElementById('orden-cantidad-pares');
  let n = parseInt(input.value, 10);
  if (!n || n < 1) n = 1;
  input.value = n;
  if (ordenMasivaActiva) generarParesMasivos(n);
}

/* ---------------- Orden Masiva (clientes mayoristas) ----------------
   Genera automáticamente una fila por par con su identificador
   secuencial ("<número de orden>-<n>", ej. 1050-1 .. 1050-50), para no
   tener que cargar par por par a mano en pedidos grandes. Cada fila
   generada queda editable (descripción y servicio traen un valor por
   defecto que se puede cambiar) y se guarda como un par real al guardar
   la orden, igual que si se hubiera agregado a mano. */
let ordenMasivaActiva = false;

/** Prende/apaga el modo Orden Masiva. Al prenderlo, genera de una vez las
 *  filas según lo que haya en "Cantidad de artículos". Al apagarlo, quita
 *  solo las filas que generó (nunca pares ya guardados/reales) para no
 *  dejar el formulario con filas de más si el recepcionista se arrepiente. */
function toggleOrdenMasiva() {
  ordenMasivaActiva = !ordenMasivaActiva;
  const btn = document.getElementById('btn-orden-masiva');
  if (btn) btn.classList.toggle('active', ordenMasivaActiva);
  const indicador = document.getElementById('orden-masiva-activo');
  if (indicador) {
    indicador.textContent = ordenMasivaActiva ? '● Activo' : 'Inactivo';
    indicador.style.color = ordenMasivaActiva ? 'var(--red, #D14343)' : 'var(--ink-soft)';
  }
  if (ordenMasivaActiva) {
    const n = parseInt(document.getElementById('orden-cantidad-pares').value, 10) || 1;
    generarParesMasivos(n);
    showToast('Orden Masiva activada: se generaron ' + n + ' artículos numerados automáticamente.');
  } else {
    quitarFilasMasivas();
  }
}

/** Quita del formulario las filas generadas por Orden Masiva que todavía
 *  no se guardaron como par real (sin itemId) — nunca borra un par ya
 *  existente en la base de datos. */
function quitarFilasMasivas() {
  document.querySelectorAll('#orden-items-list .orden-item-row[data-masivo="1"]').forEach(row => {
    if (!row.dataset.itemId) row.remove();
  });
}

/** Genera (o regenera) las filas de pares numerados según la cantidad
 *  indicada, con el código que le va a tocar a cada uno basado en el
 *  número de la orden actual (ej: la orden rgba(90, 87, 102, 0) con 50 pares genera
 *  1050-1 .. 1050-50). Se usa el mismo servicio y una descripción
 *  genérica en todas para que la orden se pueda guardar de inmediato;
 *  el recepcionista puede editar cualquiera después. */
function generarParesMasivos(n) {
  quitarFilasMasivas();
  const numeroTexto = (document.getElementById('orden-numero-general').textContent || '#—').replace('#', '').trim();
  const servicioDefault = SERVICIOS_PAR[0];
  for (let i = 1; i <= n; i++) {
    agregarFilaItemOrden(null, {
      masivo: true,
      codigoPreview: numeroTexto + '-' + i,
      descripcionDefault: 'Artículo mayorista ' + i,
      servicioDefault
    });
  }
}

/* ---------------- Registro General de los Pares: fotos ---------------- */
// Fotos elegidas antes de guardar la orden (todavía no hay ID real para
// subirlas a Storage). Se suben recién al guardar, junto con el resto.
let fotosGeneralesPendientes = [];
let fotosGeneralesExistentes = [];

function renderFotosGeneralesPreview() {
  const cont = document.getElementById('orden-fotos-generales-preview');
  if (!cont) return;
  const existentesHTML = fotosGeneralesExistentes.map(f =>
    '<div class="foto-general-thumb"><img src="' + f.url + '"></div>'
  ).join('');
  const pendientesHTML = fotosGeneralesPendientes.map((f, i) =>
    '<div class="foto-general-thumb"><img src="' + f.previewUrl + '">' +
      '<button type="button" class="quitar-foto" title="Quitar" onclick="quitarFotoGeneralPendiente(' + i + ')">✕</button>' +
    '</div>'
  ).join('');
  cont.innerHTML = existentesHTML + pendientesHTML;
}

/** Agrega fotos a la cola pendiente (se suben al guardar la orden). */
export function agregarFotosGeneralesOrden(fileList) {
  Array.from(fileList || []).forEach(file => {
    if (!file.type || !file.type.startsWith('image/')) return;
    fotosGeneralesPendientes.push({ file, previewUrl: URL.createObjectURL(file) });
  });
  renderFotosGeneralesPreview();
}

export function quitarFotoGeneralPendiente(i) {
  fotosGeneralesPendientes.splice(i, 1);
  renderFotosGeneralesPreview();
}

/** Sincroniza los ítems reales (Supabase) con lo que quedó cargado en el
 *  formulario al guardar la orden: actualiza descripciones, crea los
 *  pares nuevos con su código físico único, y borra los que el usuario
 *  quitó del formulario (nunca un par ya entregado — la fila queda
 *  bloqueada sin botón de quitar en ese caso, pero se revalida acá por
 *  las dudas). */
async function sincronizarItemsDesdeFormulario(o) {
  const filas = Array.from(document.querySelectorAll('#orden-items-list .orden-item-row'));
  if (!Array.isArray(state.ordenItems)) state.ordenItems = [];
  const existentes = itemsDeOrden(o.id);
  const idsVistos = new Set();
  let siguienteNumero = existentes.reduce((max, it) => Math.max(max, it.numeroItem), 0) + 1;

  for (const fila of filas) {
    const itemId = fila.dataset.itemId;
    const descInput = fila.querySelector('.item-desc-input');
    const descripcion = descInput ? descInput.value.trim() : '';
    const tipoServicio = Array.from(fila.querySelectorAll('.item-servicio-chk:checked')).map(c => c.value);
    const responsableInput = fila.querySelector('.item-responsable-input');
    const responsable = responsableInput ? responsableInput.value : '';
    const fechaIngreso = fila.querySelector('.item-fecha-ingreso-input')?.value || '';
    const fechaEntregaEstimada = fila.querySelector('.item-fecha-entrega-input')?.value || '';

    if (itemId) {
      const item = existentes.find(it => it.id === itemId);
      if (!item) continue;
      idsVistos.add(item.id);
      const cambioServicio = JSON.stringify(item.tipoServicio || []) !== JSON.stringify(tipoServicio);
      if (item.descripcion !== descripcion || cambioServicio || item.responsable !== responsable || item.fechaIngreso !== fechaIngreso || item.fechaEntregaEstimada !== fechaEntregaEstimada) {
        item.descripcion = descripcion;
        item.tipoServicio = tipoServicio;
        item.responsable = responsable;
        item.fechaIngreso = fechaIngreso;
        item.fechaEntregaEstimada = fechaEntregaEstimada;
        await db.saveOrdenItem(item);
      }
    } else {
      const numeroItem = siguienteNumero++;
      const nuevo = {
        id: crypto.randomUUID(), ordenId: o.id, numeroItem,
        codigo: o.numero + '-' + numeroItem, descripcion, tipoServicio, responsable,
        fechaIngreso, fechaEntregaEstimada,
        estado: 'Recibido y registrado', entregado: false, fechaEntrega: null
      };
      state.ordenItems.push(nuevo);
      await db.saveOrdenItem(nuevo);
      idsVistos.add(nuevo.id);
    }
  }

  // Borra (de verdad) los ítems que existían pero cuya fila se quitó del
  // formulario — solo si NO fueron entregados, como protección extra.
  for (const item of existentes) {
    if (!idsVistos.has(item.id) && !item.entregado) {
      state.ordenItems = state.ordenItems.filter(it => it.id !== item.id);
      await db.deleteOrdenItem(item.id);
    }
  }

  // "Cantidad de artículos" es lo que el cliente dejó al ingresar la orden —
  // lo escribe el recepcionista a mano en "Registro General de los Artículos"
  // y NO se recalcula acá. Registrar cada par individual es opcional y
  // puede hacerse después, así que el conteo de filas cargadas no siempre
  // coincide con la cantidad real que trajo el cliente (antes esta línea
  // sobrescribía el valor manual con itemsDeOrden(o.id).length, borrando
  // lo que se había puesto a mano).
  await db.saveOrden(o);
}


export function openFormaPagoChooser(id) {
  if (!puedeEditarOrdenes()) { showToast('No tienes permiso para registrar pagos'); return; }
  const qrBtn = document.getElementById('forma-pago-qr-btn');
  const efBtn = document.getElementById('forma-pago-efectivo-btn');
  const waBtn = document.getElementById('forma-pago-whatsapp-btn');
  qrBtn.onclick = () => { closeModal('modal-forma-pago'); openPagoQRModal(id); };
  efBtn.onclick = () => { closeModal('modal-forma-pago'); openPagoEfectivoModal(id); };
  if (waBtn) waBtn.onclick = () => { enviarWhatsAppOrden(id); };
  openModalEl('modal-forma-pago');
}

/* ---------------- Cobro con QR ---------------- */
export function openPagoQRModal(id) {
  const o = ordenById(id);
  if (!o) return;
  pagoQrOrdenId = id;
  renderPagoQRContent(o);
  openModalEl('modal-pago-qr');
}

function renderPagoQRContent(o) {
  const cliente = clienteById(o.clienteId);
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  const pendiente = Math.max(valorFinal - Number(o.pagado || 0), 0);
  const montoSugerido = pendiente > 0 ? pendiente : valorFinal;
  // Si la empresa cargó su propio QR de pago (banco/billetera), se muestra ese.
  // Si no, se genera uno con los datos de la orden (compatibilidad).
  const qrEmpresa = (state.config || {}).qr_pago_url;
  const qrPayload = encodeURIComponent('SISTEMASES|ORDEN:' + o.numero + '|MONTO:' + montoSugerido.toFixed(2) + '|CLIENTE:' + (cliente ? cliente.nombre : ''));
  const qrImgSrc = qrEmpresa ? qrEmpresa : ('https://' + 'api.qrserver.com' + '/v1/create-qr-code/?size=200x200&data=' + qrPayload);
  document.getElementById('pago-qr-content').innerHTML =
    '<div class="hint" style="margin-bottom:10px;">Orden #' + escHtml(o.numero) + ' · ' + escHtml(cliente ? cliente.nombre : '') + '</div>' +
    '<img src="' + qrImgSrc + '" style="max-width:220px;border:1px solid var(--line);border-radius:10px;margin-bottom:12px;">' +
    '<div class="hint" style="margin-bottom:10px;">El cliente escanea el código con su app bancaria o billetera digital para pagar.</div>' +
    '<label class="hint">Monto a cobrar</label>' +
    '<input type="number" id="pago-qr-monto" step="0.01" value="' + montoSugerido.toFixed(2) + '" style="text-align:center;font-size:16px;font-weight:700;margin-bottom:14px;">' +
    '<div class="modal-foot" style="justify-content:center;">' +
      '<button class="btn btn-teal" id="pago-qr-confirmar-btn" onclick="confirmarPagoQR()">✅ Confirmar pago recibido</button>' +
      '<button class="btn btn-ghost" onclick="closeModal(\'modal-pago-qr\')">Cancelar</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:10px;">Al confirmar, el pago quedará registrado en la aplicación y se reflejará como debitado de la cuenta del cliente.</div>';
}

/** Si el modal de "Cobro con QR" está abierto en este momento, lo vuelve a
 * dibujar con los datos actuales (usado cuando el QR de pago del negocio
 * se actualiza en tiempo real desde otro dispositivo, ver
 * startRealtimeConfig en configuracion.js). */
export function refreshPagoQRSiAbierto() {
  const modal = document.getElementById('modal-pago-qr');
  if (!modal || !modal.classList.contains('open') || !pagoQrOrdenId) return;
  const o = ordenById(pagoQrOrdenId);
  if (o) renderPagoQRContent(o);
}

export async function confirmarPagoQR() {
  // Protección anti doble-clic / red lenta: si ya hay un guardado en curso
  // para este pago, ignora los clics adicionales en vez de registrar el
  // pago dos veces.
  if (pagoQrEnProceso) return;
  const id = pagoQrOrdenId;
  const o = ordenById(id);
  if (!o) return;
  ensurePagoFields(o);
  const monto = Number(document.getElementById('pago-qr-monto').value) || 0;
  if (monto <= 0) { showToast('Ingresa un monto válido'); return; }
  pagoQrEnProceso = true;
  const btn = document.getElementById('pago-qr-confirmar-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  try {
    const valorFinal = Number(o.precio) - Number(o.descuento || 0);
    o.pagado = Number(o.pagado || 0) + monto;
    o.pagadoQR = Number(o.pagadoQR || 0) + monto;
    o.metodoPago = 'QR';
    o.fechaPago = todayISO(0);
    o.estadoPago = o.pagado >= valorFinal ? 'Pagado' : 'Parcial';
    logActivity('Cobro por QR de ' + fmtMoney(monto) + ' en orden #' + o.numero + ' (debitado de la cuenta del cliente)');
    await persist();
    await db.saveOrden(o);
    closeModal('modal-pago-qr');
    showToast('Pago por QR confirmado: ' + fmtMoney(monto) + ' — reflejado en la aplicación');
    renderOrdenes();
    if (document.getElementById('tab-finanzas').classList.contains('active') && window.renderFinanzas) window.renderFinanzas();
    if (document.getElementById('tab-dashboard').classList.contains('active') && window.renderDashboard) window.renderDashboard();
    if (document.getElementById('modal-orden-detalle').classList.contains('open')) viewOrdenDetalle(o.id);
  } catch (e) {
    console.error(e);
    showToast('Error al registrar el pago');
  } finally {
    pagoQrEnProceso = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

/* ---------------- Cobro en efectivo ---------------- */
export function openPagoEfectivoModal(id) {
  const o = ordenById(id);
  if (!o) return;
  ensurePagoFields(o);
  pagoEfectivoOrdenId = id;
  const cliente = clienteById(o.clienteId);
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  const pendiente = Math.max(valorFinal - Number(o.pagado || 0), 0);
  const montoSugerido = pendiente > 0 ? pendiente : valorFinal;
  document.getElementById('pago-efectivo-content').innerHTML =
    '<div class="hint" style="margin-bottom:10px;">Orden #' + escHtml(o.numero) + ' · ' + escHtml(cliente ? cliente.nombre : '') + '</div>' +
    '<div style="font-size:34px;margin-bottom:10px;">💵</div>' +
    '<label class="hint">Monto recibido en efectivo</label>' +
    '<input type="number" id="pago-efectivo-monto" step="0.01" value="' + montoSugerido.toFixed(2) + '" style="width:100%;text-align:center;font-size:16px;font-weight:700;margin-bottom:14px;padding:10px;border:1px solid var(--line);border-radius:8px;">' +
    '<div class="modal-foot" style="justify-content:center;">' +
      '<button class="btn btn-teal" id="pago-efectivo-confirmar-btn" onclick="confirmarPagoEfectivo()">✅ Confirmar pago recibido</button>' +
      '<button class="btn btn-ghost" onclick="closeModal(\'modal-pago-efectivo\')">Cancelar</button>' +
    '</div>';
  openModalEl('modal-pago-efectivo');
}

export async function confirmarPagoEfectivo() {
  // Misma protección anti doble-registro que confirmarPagoQR.
  if (pagoEfectivoEnProceso) return;
  const id = pagoEfectivoOrdenId;
  const o = ordenById(id);
  if (!o) return;
  ensurePagoFields(o);
  const monto = Number(document.getElementById('pago-efectivo-monto').value) || 0;
  if (monto <= 0) { showToast('Ingresa un monto válido'); return; }
  pagoEfectivoEnProceso = true;
  const btn = document.getElementById('pago-efectivo-confirmar-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  try {
    const valorFinal = Number(o.precio) - Number(o.descuento || 0);
    o.pagado = Number(o.pagado || 0) + monto;
    o.pagadoEfectivo = Number(o.pagadoEfectivo || 0) + monto;
    o.metodoPago = 'Efectivo';
    o.fechaPago = todayISO(0);
    o.estadoPago = o.pagado >= valorFinal ? 'Pagado' : 'Parcial';
    logActivity('Cobro en efectivo de ' + fmtMoney(monto) + ' en orden #' + o.numero);
    await persist();
    await db.saveOrden(o);
    closeModal('modal-pago-efectivo');
    showToast('Pago en efectivo confirmado: ' + fmtMoney(monto));
    renderOrdenes();
    if (document.getElementById('tab-finanzas').classList.contains('active') && window.renderFinanzas) window.renderFinanzas();
    if (document.getElementById('tab-dashboard').classList.contains('active') && window.renderDashboard) window.renderDashboard();
    if (document.getElementById('modal-orden-detalle').classList.contains('open')) viewOrdenDetalle(o.id);
  } catch (e) {
    console.error(e);
    showToast('Error al registrar el pago');
  } finally {
    pagoEfectivoEnProceso = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

/* ---------------- Corregir pago ---------------- */
export function openCorregirPagoModal(id) {
  if (state.session.role !== 'Administrador') { showToast('Solo el Administrador puede corregir montos ya pagados'); return; }
  const o = ordenById(id);
  if (!o) return;
  ensurePagoFields(o);
  corregirPagoOrdenId = id;
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  document.getElementById('corregir-pago-content').innerHTML =
    '<div class="hint" style="margin-bottom:12px;">Orden #' + escHtml(o.numero) + ' · Valor final: ' + fmtMoney(valorFinal) + '</div>' +
    '<div class="field"><label>Monto total pagado (corregido)</label>' +
    '<input type="number" id="corregir-pago-monto" step="0.01" value="' + Number(o.pagado || 0).toFixed(2) + '"></div>' +
    '<div class="field"><label>Método de pago</label>' +
    '<select id="corregir-pago-metodo">' +
      '<option value="Efectivo"' + (o.metodoPago === 'Efectivo' ? ' selected' : '') + '>Efectivo</option>' +
      '<option value="QR"' + (o.metodoPago === 'QR' ? ' selected' : '') + '>QR</option>' +
      '<option value="Transferencia"' + (o.metodoPago === 'Transferencia' ? ' selected' : '') + '>Transferencia</option>' +
      '<option value="Tarjeta"' + (o.metodoPago === 'Tarjeta' ? ' selected' : '') + '>Tarjeta</option>' +
    '</select></div>' +
    '<div class="hint" style="margin:8px 0 4px 0;">Esto reemplaza el monto y método registrados anteriormente para esta orden (úsalo para corregir un error, no para sumar un nuevo cobro).</div>' +
    '<div class="modal-foot">' +
      '<button class="btn btn-ghost" onclick="closeModal(\'modal-corregir-pago\')">Cancelar</button>' +
      '<button class="btn btn-primary" id="corregir-pago-guardar-btn" onclick="guardarCorreccionPago()">Guardar corrección</button>' +
    '</div>';
  openModalEl('modal-corregir-pago');
}

export async function guardarCorreccionPago() {
  if (corregirPagoEnProceso) return;
  const id = corregirPagoOrdenId;
  const o = ordenById(id);
  if (!o) return;
  ensurePagoFields(o);
  const monto = Number(document.getElementById('corregir-pago-monto').value) || 0;
  const metodo = document.getElementById('corregir-pago-metodo').value;
  corregirPagoEnProceso = true;
  const btn = document.getElementById('corregir-pago-guardar-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  try {
    const valorFinal = Number(o.precio) - Number(o.descuento || 0);
    o.pagado = monto;
    o.pagadoQR = 0; o.pagadoEfectivo = 0;
    if (metodo === 'QR') o.pagadoQR = monto;
    else if (metodo === 'Efectivo') o.pagadoEfectivo = monto;
    o.metodoPago = metodo;
    o.fechaPago = todayISO(0);
    o.estadoPago = monto <= 0 ? 'Pendiente' : (monto >= valorFinal ? 'Pagado' : 'Parcial');
    logActivity('Corrigió el pago de la orden #' + o.numero + ' a ' + fmtMoney(monto) + ' (' + metodo + ')');
    await persist();
    await db.saveOrden(o);
    closeModal('modal-corregir-pago');
    showToast('Pago corregido');
    renderOrdenes();
    if (document.getElementById('tab-finanzas').classList.contains('active') && window.renderFinanzas) window.renderFinanzas();
    if (document.getElementById('tab-dashboard').classList.contains('active') && window.renderDashboard) window.renderDashboard();
    if (document.getElementById('modal-orden-detalle').classList.contains('open')) viewOrdenDetalle(o.id);
  } catch (e) {
    console.error(e);
    showToast('Error al corregir el pago');
  } finally {
    corregirPagoEnProceso = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

/** Un solo botón "Comprobante" abre este selector con las 2 opciones
 *  (imprimir / compartir) en vez de mostrar dos botones separados. */
export function openComprobanteChooser(id) {
  const imprimirBtn = document.getElementById('comprobante-imprimir-btn');
  const compartirBtn = document.getElementById('comprobante-compartir-btn');
  imprimirBtn.onclick = () => { closeModal('modal-comprobante'); printTicket(id); };
  compartirBtn.onclick = () => { closeModal('modal-comprobante'); shareComprobante(id); };
  openModalEl('modal-comprobante');
}

/** Arma la línea "Artículo" del comprobante con TODA la información del
 *  par (marca, modelo, color y talla van juntos en la descripción de
 *  cada par). Si la orden tiene pares registrados se lista uno por
 *  línea; si es una orden vieja sin pares, cae al artículo/color/talla
 *  a nivel de orden. Ya no se muestra una línea "Color/Talla" aparte
 *  porque quedaba vacía: esa info va dentro de "Artículo". */
function comprobanteCalzado(o) {
  const items = itemsDeOrden(o.id);
  if (items.length) {
    return items.map((it) => 'Artículo ' + (it.numeroItem || it.codigo) + ': ' + (it.descripcion || 'sin descripción'));
  }
  const articulo = [o.marca, o.modelo].filter(Boolean).join(' ');
  const colorTalla = [o.color, o.talla].filter(Boolean).join(' / ');
  return ['Artículo: ' + [articulo, colorTalla].filter(Boolean).join(' - ')];
}

function comprobanteCalzadoHtml(o) {
  return comprobanteCalzado(o).map((linea) => '<p>' + linea + '</p>').join('');
}

/* ---------------- Impresión de comprobante ---------------- */
export function printTicket(id) {
  try {
    const o = ordenById(id); const c = clienteById(o.clienteId);
    const valorFinal = Number(o.precio) - Number(o.descuento || 0);
    const calzadoHtml = comprobanteCalzadoHtml(o);
    const html = '<html><head><title>Comprobante #' + o.numero + '</title><style>body{font-family:monospace;padding:20px;width:300px;}h2{margin:0 0 6px 0;}hr{border:none;border-top:1px dashed #999;}p{margin:4px 0;font-size:13px;}</style></head><body>' +
      '<h2>Comprobante de servicio</h2><hr>' +
      '<p>Orden: #' + o.numero + '</p><p>Cliente: ' + c.nombre + '</p>' + calzadoHtml +
      '<p>Servicio: ' + fmtServicios(o.tipoServicio) + '</p><p>Estado: ' + o.estado + '</p><hr>' +
      '<p>Precio: ' + fmtMoney(o.precio) + '</p><p>Descuento: ' + fmtMoney(o.descuento || 0) + '</p><p>Total: ' + fmtMoney(valorFinal) + '</p>' +
      '<p>Pagado: ' + fmtMoney(o.pagado) + '</p><hr><p>Ingreso: ' + fmtDate(o.fechaIngreso) + '</p><p>Entrega estimada: ' + fmtDate(o.fechaEstimada) + '</p>' +
      '<hr><p style="text-align:center;">¡Gracias por su preferencia!</p>' +
      '</body></html>';
    let frame = document.getElementById('print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'print-frame';
    frame.style.position = 'fixed';
    frame.style.right = '0'; frame.style.bottom = '0';
    frame.style.width = '0'; frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    frame.onload = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { console.error(e); showToast('No se pudo abrir el diálogo de impresión.'); }
    };
  } catch (e) {
    console.error(e);
    showToast('No se pudo generar el comprobante.');
  }
}

/**
 * Comparte el comprobante de la orden como IMAGEN (PNG), ideal para el
 * teléfono: usa la API nativa de compartir (WhatsApp, etc.) y, si no está
 * disponible, descarga la imagen y abre WhatsApp con un mensaje.
 */
export async function shareComprobante(id) {
  const o = ordenById(id);
  if (!o) return;
  const c = clienteById(o.clienteId) || {};
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  const servicios = Array.isArray(o.tipoServicio) ? o.tipoServicio.join(', ') : '';
  try {
    const calzadoRows = comprobanteCalzado(o).map((linea) => {
      const idx = linea.indexOf(':');
      return idx === -1 ? ['Artículo', linea] : [linea.slice(0, idx), linea.slice(idx + 1).trim()];
    });
    const rows = [
      ['Orden', '#' + o.numero],
      ['Cliente', c.nombre || '-'],
      ...calzadoRows,
      ['Servicio', servicios || '-'],
      ['Estado', o.estado || '-'],
      ['Ingreso', fmtDate(o.fechaIngreso)],
      ['Entrega est.', fmtDate(o.fechaEstimada)],
      ['Total', fmtMoney(valorFinal)],
      ['Pagado', fmtMoney(o.pagado)],
      ['Pendiente', fmtMoney(Math.max(valorFinal - o.pagado, 0))]
    ];
    const W = 640, rowH = 42, top = 128, bottom = 78;
    const H = top + rows.length * rowH + bottom;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    // Encabezado
    ctx.fillStyle = '#001A5C'; ctx.fillRect(0, 0, W, 96);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial'; ctx.fillText('Comprobante de servicio', 28, 56);
    // Filas
    let y = top;
    ctx.textBaseline = 'middle';
    rows.forEach((r, idx) => {
      if (idx % 2 === 0) { ctx.fillStyle = '#F4F8FD'; ctx.fillRect(20, y - rowH / 2, W - 40, rowH); }
      ctx.fillStyle = '#5b6472'; ctx.font = '15px Arial';
      ctx.fillText(r[0], 32, y);
      ctx.fillStyle = '#111827'; ctx.font = 'bold 16px Arial';
      const val = String(r[1]);
      ctx.fillText(val.length > 42 ? val.slice(0, 41) + '…' : val, 240, y);
      y += rowH;
    });
    // Pie
    ctx.fillStyle = '#0096E0'; ctx.font = 'bold 16px Arial';
    ctx.fillText('¡Gracias por su preferencia!', 32, y + 20);
    ctx.fillStyle = '#8a93a2'; ctx.font = '13px Arial';
    ctx.fillText(new Date().toLocaleString('es-BO'), 32, y + 46);

    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], 'comprobante-' + o.numero + '.png', { type: 'image/png' });
    const texto = 'Comprobante de tu orden #' + o.numero;

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Comprobante #' + o.numero, text: texto });
      return;
    }
    // Respaldo: descargar imagen y abrir WhatsApp con el mensaje.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    const tel = (c.whatsapp || '').replace(/[^0-9]/g, '');
    const wa = 'ht' + 'tps://wa.me/' + tel + '?text=' + encodeURIComponent(texto + ' (adjunta la imagen que se acaba de descargar).');
    window.open(wa, '_blank');
    showToast('Comprobante descargado. Adjúntalo en el chat de WhatsApp.');
  } catch (e) {
    console.error(e);
    showToast('No se pudo generar el comprobante para compartir.');
  }
}

/**
 * Normaliza las órdenes cargadas (desde la base o la caché) asegurando
 * los campos de pago y de seguimiento. Migra el estado antiguo al índice
 * de la línea de tiempo, igual que en la versión monolítica original.
 */
export function migrateOrdenes() {
  // Mapeo estado→índice de línea de tiempo para órdenes viejas que nunca
  // tuvieron timelineIndex explícito, con valores de ANTES de unificar los
  // 3 flujos (por eso incluye 'Reparación' y estados sueltos que ya no
  // existen como opción: son solo para migrar datos históricos, no el
  // vocabulario actual — ver FLUJO_ESTADOS/TIMELINE_STEPS más arriba).
  const ESTADO_TO_INDEX = { 'Recibido': 0, 'Lavado': 1, 'Secado': 2, 'Reparación': 3, 'Finalizado': TIMELINE_STEPS.length - 1, 'Entregado': TIMELINE_STEPS.length - 1 };
  state.ordenes.forEach(o => {
    ensurePagoFields(o);
    ensureTimelineFields(o);
    if (!o._pagoMigrated) {
      const monto = Number(o.pagado || 0);
      if (monto > 0 && o.pagadoQR === 0 && o.pagadoEfectivo === 0) {
        if (o.metodoPago === 'QR') o.pagadoQR = monto;
        else if (o.metodoPago === 'Efectivo') o.pagadoEfectivo = monto;
      }
      o._pagoMigrated = true;
    }
    if (!o._timelineMigrated) {
      const idx = ESTADO_TO_INDEX[o.estado];
      if (idx !== undefined) {
        const maxIdx = TIMELINE_STEPS.length - 1; // límite dinámico, ya no un número fijo
        o.timelineIndex = Math.min(idx, maxIdx);
        for (let i = 0; i < Math.min(idx, maxIdx); i++) { if (!o.timelineDates[i]) o.timelineDates[i] = o.fechaIngreso; }
        if (o.timelineIndex >= TIMELINE_STEPS.length - 1) { Object.keys(o.controlCalidad).forEach(k => o.controlCalidad[k] = true); }
        if (o.estado === 'Entregado') { o.entregado = true; }
      }
      o._timelineMigrated = true;
    }
  });
}

/** Elimina una orden (solo Administrador, con confirmación previa). No permite
 *  eliminar si la orden tiene saldo pendiente de cobro o si ya tiene una
 *  factura emitida asociada. La orden NO se borra de la base de datos: pasa
 *  a la Papelera (Configuración → Papelera de órdenes) hasta que se elimine
 *  definitivamente desde ahí. */
async function deleteOrden(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar órdenes'); return; }
  const o = ordenById(id);
  if (!o) return;

  const valorFinal = Number(o.precio || 0) - Number(o.descuento || 0);
  const saldoPendiente = valorFinal - Number(o.pagado || 0);
  if (saldoPendiente > 0.009) {
    showToast('No se puede eliminar: la orden #' + o.numero + ' tiene un saldo pendiente de ' + fmtMoney(saldoPendiente));
    return;
  }
  const tieneFactura = (state.facturas || []).some(f => f.ordenId === id);
  if (tieneFactura) {
    showToast('No se puede eliminar: la orden #' + o.numero + ' ya tiene una factura emitida');
    return;
  }

  if (!confirm('¿Enviar la orden #' + o.numero + ' de ' + clienteNombre(o.clienteId) + ' a la papelera?\n\nPodrás restaurarla desde Configuración → Papelera de órdenes.')) return;
  const backup = state.ordenes.slice();
  o.eliminada = true;
  state.ordenes = state.ordenes.filter(x => x.id !== id);
  if (!Array.isArray(state.ordenesEliminadas)) state.ordenesEliminadas = [];
  state.ordenesEliminadas.push(o);
  renderOrdenes();
  const res = await db.saveOrden(o);
  if (res && res.error && !res.queued) {
    // Falló en el servidor (error permanente): restaurar la orden en la vista.
    o.eliminada = false;
    state.ordenes = backup;
    state.ordenesEliminadas = state.ordenesEliminadas.filter(x => x.id !== id);
    renderOrdenes();
    showToast('No se pudo enviar la orden a la papelera: ' + (res.error.message || 'error del servidor'));
    return;
  }
  logActivity('Envió a la papelera la orden #' + o.numero);
  await persist();
  showToast('Orden #' + o.numero + ' enviada a la papelera');
}

/** Restaura una orden desde la Papelera (solo Administrador). */
async function restaurarOrden(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede restaurar órdenes'); return; }
  const o = (state.ordenesEliminadas || []).find(x => x.id === id);
  if (!o) return;
  o.eliminada = false;
  state.ordenesEliminadas = state.ordenesEliminadas.filter(x => x.id !== id);
  state.ordenes.push(o);
  renderOrdenes();
  await persist();
  await db.saveOrden(o);
  logActivity('Restauró desde la papelera la orden #' + o.numero);
  showToast('Orden #' + o.numero + ' restaurada');
  if (window.renderPapeleras) window.renderPapeleras();
}

/** Elimina una orden DEFINITIVAMENTE desde la Papelera (no se puede deshacer). */
async function eliminarOrdenPermanente(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar definitivamente'); return; }
  const o = (state.ordenesEliminadas || []).find(x => x.id === id);
  if (!o) return;
  if (!confirm('¿Eliminar DEFINITIVAMENTE la orden #' + o.numero + '?\n\nEsta acción NO se puede deshacer — se perderá para siempre.')) return;
  const backup = state.ordenesEliminadas.slice();
  // Guardamos también los artículos/pares de esta orden (para poder
  // restaurarlos en la caché local si el borrado falla en el servidor).
  const itemsBackup = (state.ordenItems || []).filter(it => it.ordenId === id);
  state.ordenesEliminadas = state.ordenesEliminadas.filter(x => x.id !== id);
  if (window.renderPapeleras) window.renderPapeleras();
  const res = await db.deleteOrden(id);
  if (res && res.error && !res.queued) {
    state.ordenesEliminadas = backup;
    if (window.renderPapeleras) window.renderPapeleras();
    showToast('No se pudo eliminar definitivamente: ' + (res.error.message || 'error del servidor'));
    return;
  }
  // En el servidor, orden_items tiene ON DELETE CASCADE contra ordenes, así
  // que ya se borraron ahí. Pero la CACHÉ LOCAL (state.ordenItems) no se
  // entera sola: si no se limpia acá, esos artículos quedan "huérfanos" en
  // memoria (y en el caché offline) apuntando a una orden que ya no existe,
  // y siguen apareciendo en pantallas que leen todos los artículos sin
  // pasar por la orden — por ejemplo Biblioteca, que seguía mostrándolos
  // como si estuvieran guardados en un estante aunque la orden ya se había
  // eliminado. Por eso se filtran acá también.
  if (itemsBackup.length) {
    state.ordenItems = (state.ordenItems || []).filter(it => it.ordenId !== id);
    if (window.renderBiblioteca) window.renderBiblioteca();
  }
  logActivity('Eliminó definitivamente la orden #' + o.numero);
  await persist();
  showToast('Orden #' + o.numero + ' eliminada definitivamente');
}

/** Envía WhatsApp verificando el límite mensual configurado. Si la orden
 *  ya tiene una "foto general" cargada (Registro General de los Pares),
 *  la adjunta junto con el texto en el mismo mensaje. */
export async function enviarWhatsAppOrden(ordenId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const c = clienteById(o.clienteId);
  if (!c) return;
  // El mensaje al cliente lleva EXACTAMENTE la misma información del QR de la
  // orden (detalle completo par por par, totales, etc.), sin repetir datos.
  const msg = 'Hola ' + (c.nombre || '') + ' 👟\n\n' + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
  const fotoGeneral = primeraFotoGeneralOrden(o);
  const file = fotoGeneral ? await fotoUrlAFile(fotoGeneral, 'orden-' + o.numero + '.jpg') : null;

  if (window.enviarWhatsAppConFoto) {
    window.enviarWhatsAppConFoto(c.whatsapp || '', msg, file);
  } else if (window.enviarWhatsApp) {
    window.enviarWhatsApp(c.whatsapp || '', msg);
  } else {
    // Fallback si el módulo no está cargado
    const url = 'https://wa.me/' + (c.whatsapp || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
  }
}

/** Envía al cliente un WhatsApp automático con la info del QR de la orden
 *  y, si se le pasa una foto (File), la adjunta junto con el texto en el
 *  mismo mensaje. Se usa al registrar la orden (con la foto general recién
 *  cargada) y al llegar a "Biblioteca" (último paso del seguimiento en
 *  tiempo real, listo para retirar). El encabezado cambia según el
 *  momento (registro vs. listo). */
function enviarWhatsAppAutomatico(o, encabezado, fotoFile) {
  try {
    const c = clienteById(o.clienteId);
    if (!c) return;
    const tel = (c.whatsapp || '').replace(/[^0-9]/g, '');
    if (!tel) return; // sin número no hay envío
    const msg = (encabezado ? encabezado + '\n\n' : '') + ordenQrText(o) + '\n\n¡Gracias por tu confianza!';
    if (window.enviarWhatsAppConFoto) {
      window.enviarWhatsAppConFoto(tel, msg, fotoFile || null);
    } else if (window.enviarWhatsApp) {
      window.enviarWhatsApp(tel, msg);
    } else {
      window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
    }
  } catch (e) { console.error('No se pudo enviar el WhatsApp automático:', e); }
}

/** Abre/cierra el desplegable flotante con los artículos que no entran en
 *  el límite visible de la tarjeta (ver renderOrdenes → LIMITE_ARTICULOS_TARJETA).
 *  Flotante y absoluto a propósito: no debe empujar ni agrandar el resto
 *  de la tarjeta al abrirse. Cierra cualquier otro que haya quedado
 *  abierto (una sola tarjeta con el desplegable abierto a la vez). */
function toggleArticulosDropdown(ordenId, ev) {
  if (ev) ev.stopPropagation();
  const dd = document.getElementById('articulos-dropdown-' + ordenId);
  if (!dd) return;
  const yaAbierto = dd.classList.contains('open');
  document.querySelectorAll('.articulos-dropdown.open').forEach(el => el.classList.remove('open'));
  if (!yaAbierto) dd.classList.add('open');
}
// Cierra cualquier desplegable de artículos abierto al hacer click en
// cualquier otro lado de la pantalla.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest('.articulos-cell')) return;
    document.querySelectorAll('.articulos-dropdown.open').forEach(el => el.classList.remove('open'));
  });
}

/* ---------- Buscador de fechas (Órdenes) ----------
   Panel flotante junto a "+ Nueva orden" para filtrar la grilla por
   fecha de ingreso (Desde/Hasta). Mismo patrón que el de Clientes. */
function toggleFiltroFechaOrden(ev) {
  window.toggleDropdown('orden-fecha-dropdown', ev, 'date-filter-dropdown');
}
function aplicarFiltroFechaOrden() {
  renderOrdenes();
  window.closeDropdown('orden-fecha-dropdown');
}
function limpiarFiltroFechaOrden() {
  document.getElementById('orden-fecha-desde').value = '';
  document.getElementById('orden-fecha-hasta').value = '';
  renderOrdenes();
  window.closeDropdown('orden-fecha-dropdown');
}
function actualizarBotonFiltroFechaOrden(activo) {
  const btn = document.getElementById('btn-filtro-fecha-orden');
  if (btn) btn.classList.toggle('active', activo);
}

// Exponer funciones llamadas desde onclick del HTML y desde otros módulos.
Object.assign(window, {
  populateClienteSelect, filtrarClientesComboOrden, seleccionarClienteOrden,
  renderOrdenes, openOrdenModal, saveOrden, advanceEstado, toggleArticulosDropdown,
  toggleFiltroFechaOrden, aplicarFiltroFechaOrden, limpiarFiltroFechaOrden,
  advanceEstadoYRefrescarDetalle, entregarOrden,
  advanceTimelineStep, openCalidadModal, updateCalidadProgress, saveCalidadChecklist,
  openFirmaModal, clearSignature, saveSignature, viewOrdenDetalle,
  openPagoQRModal, confirmarPagoQR, refreshPagoQRSiAbierto, openPagoEfectivoModal, confirmarPagoEfectivo,
  openFormaPagoChooser,
  openCorregirPagoModal, guardarCorreccionPago, printTicket,
  downloadOrdenQR, shareComprobante, enviarWhatsAppOrden, deleteOrden,
  agregarFilaItemOrden, quitarFilaItemOrden, toggleOrdenMasiva,
  sincronizarCantidadPares,
  agregarFotosGeneralesOrden, quitarFotoGeneralPendiente,
  restaurarOrden, eliminarOrdenPermanente,
  renderSeguimientoItemSeleccionado, advanceItemTimelineStep,
  openFirmasChooser, openComprobanteChooser
});
// estadoMostradoPar y sincronizarEstadoOrdenDesdeTimelinePares no se llaman
// desde onclick del HTML (son de uso interno entre módulos), no hace
// falta exponerlas en window.
