/* ============================================================
   MÓDULO: AGENDA
   Fase 2: Incluye Supabase Realtime para actualizaciones en tiempo real.
   ============================================================ */
import { state, todayISO, tenantId } from '../state.js';
import { fmtDate, clienteNombre, showToast } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';
import * as db from '../db.js';

let realtimeChannel = null;


let _agendaObservers = [];
let _agendaLoadingMore = { hoy:false, atrasados:false, programados:false };
let _agendaRenderSeq = 0;

function limpiarAgendaObservers() {
  _agendaObservers.forEach(o => { try { o.disconnect(); } catch (_) {} });
  _agendaObservers = [];
}

async function cargarMasAgenda(kind) {
  if (_agendaLoadingMore[kind]) return;
  _agendaLoadingMore[kind] = true;
  try {
    await db.loadMoreAgenda(kind, 20);
    await renderAgenda(true);
  } catch (e) {
    console.error('No se pudo cargar más Agenda:', e);
  } finally {
    _agendaLoadingMore[kind] = false;
  }
}

function instalarObserverAgenda(id, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onclick = () => void cargarMasAgenda(kind);
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) void cargarMasAgenda(kind);
  }, { rootMargin:'160px 0px' });
  obs.observe(el);
  _agendaObservers.push(obs);
}

export async function renderAgenda(skipReload = false) {
  const seq = ++_agendaRenderSeq;
  const diasSel = document.getElementById('agenda-programados-dias');
  const diasProgramados = diasSel ? Math.max(1, Math.min(Number(diasSel.value) || 7, 7)) : 7;

  let data = db.getAgendaData ? db.getAgendaData() : null;
  if (!skipReload && navigator.onLine && data && Number(data.days || 7) !== diasProgramados) {
    await db.reloadAgendaProgramados(diasProgramados);
    if (seq !== _agendaRenderSeq) return;
    data = db.getAgendaData();
  }
  if (!data) {
    data = { rows:{hoy:[],atrasados:[],programados:[]}, hasMore:{hoy:false,atrasados:false,programados:false}, days:diasProgramados };
  }

  const today = todayISO(0);
  const renderList = (list, kind, hasMore) => {
    const cards = (list || []).map(p => {
      const diasLabel = kind === 'atrasados'
        ? ' · ⚠ ' + Math.max(1, Math.round((new Date(today) - new Date(p.fecha)) / (1000 * 3600 * 24))) + ' día(s) atrasado'
        : (kind === 'programados'
          ? ' · en ' + Math.max(1, Math.round((new Date(p.fecha) - new Date(today)) / (1000 * 3600 * 24))) + ' día(s)'
          : ' · para hoy');
      const estadoChip = p.estado ? '<span class="hint" style="margin-left:4px;">' + escHtml(p.estado) + '</span>' : '';
      return '<div class="mini-order" onclick="window.verOrdenDesdeAgenda(\'' + p.ordenId + '\')" style="cursor:pointer;">'
        + '<strong>' + escHtml(p.codigo) + '</strong> · ' + escHtml(p.cliente)
        + ' <span class="hint">#' + escHtml(p.ordenNum) + (p.tipoServicio ? ' · ' + escHtml(p.tipoServicio) : '') + '</span>'
        + '<br><span class="hint">Entrega: ' + fmtDate(p.fecha) + diasLabel + '</span>'
        + estadoChip
        + '</div>';
    }).join('');
    const empty = (list || []).length ? '' : '<div class="hint">Sin registros</div>';
    const sentinel = hasMore
      ? '<div id="agenda-more-' + kind + '" class="hint" style="text-align:center;padding:12px;cursor:pointer;">Desplázate para cargar 20 más</div>'
      : '';
    return cards + empty + sentinel;
  };

  limpiarAgendaObservers();
  document.getElementById('agenda-hoy').innerHTML = renderList(data.rows.hoy, 'hoy', data.hasMore.hoy);
  document.getElementById('agenda-atrasados').innerHTML = renderList(data.rows.atrasados, 'atrasados', data.hasMore.atrasados);
  document.getElementById('agenda-programados').innerHTML = renderList(data.rows.programados, 'programados', data.hasMore.programados);

  if (data.hasMore.hoy) instalarObserverAgenda('agenda-more-hoy','hoy');
  if (data.hasMore.atrasados) instalarObserverAgenda('agenda-more-atrasados','atrasados');
  if (data.hasMore.programados) instalarObserverAgenda('agenda-more-programados','programados');

  const indicator = document.getElementById('realtime-indicator');
  if (indicator) indicator.style.display = realtimeChannel ? 'inline-flex' : 'none';

  const cuenta = (data.rows.atrasados || []).length;
  if (document.getElementById('tab-agenda')
      && document.getElementById('tab-agenda').classList.contains('active')) {
    if (cuenta > 0 && ultimoAtrasadosAgenda !== null && cuenta > ultimoAtrasadosAgenda) pipBeep();
    ultimoAtrasadosAgenda = cuenta;
  } else {
    ultimoAtrasadosAgenda = cuenta;
  }
}

let ultimoAtrasadosAgenda = null;

function pipBeep() {
  try {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    const ctx = (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.18;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.15);
    osc.onended = () => { try { ctx.close(); } catch (_) {} };
  } catch (e) { /* sin audio, no rompe nada */ }
}

export async function verOrdenDesdeAgenda(ordenId) {
  // Agenda usa filas livianas para ahorrar Egress. Al abrir una orden se
  // hidrata únicamente ESA orden (extra/fotos) y sus artículos antes de
  // mostrar el detalle, para que una orden antigua nunca parezca incompleta.
  let orden = (state.ordenes || []).find(o => o.id === ordenId);
  const tieneDetalleCompleto = !!(orden && orden._egressSlim !== true && orden.extra && typeof orden.extra === 'object');
  if (!tieneDetalleCompleto && navigator.onLine) {
    orden = await db.fetchOrderContextById(ordenId);
  }
  if (window.viewOrdenDetalle && orden) window.viewOrdenDetalle(ordenId);
  else showToast('No se pudo cargar el detalle de esta orden');
}

function ordenEliminadaDesdeFila(row) {
  let cur = row;
  const seen = new Set();
  for (let i = 0; i < 8 && cur && typeof cur === 'object' && !Array.isArray(cur) && !seen.has(cur); i++) {
    if (cur.eliminada === true) return true;
    seen.add(cur);
    cur = (cur.extra && typeof cur.extra === 'object' && !Array.isArray(cur.extra)) ? cur.extra : null;
  }
  return false;
}

/** Convierte la fila snake_case de Postgres al formato camelCase del state. */
function mapOrdenRealtime(row) {
  if (!row) return null;
  return {
    ...row,
    clienteId: row.cliente_id ?? row.clienteId,
    fechaIngreso: row.fecha_ingreso ?? row.fechaIngreso,
    fechaEstimada: row.fecha_estimada ?? row.fechaEstimada,
    estadoPago: row.estado_pago ?? row.estadoPago,
    totalPares: row.total_pares ?? row.totalPares,
    tenantId: row.tenant_id ?? row.tenantId,
    eliminada: ordenEliminadaDesdeFila(row),
    _egressSlim: false
  };
}

/**
 * Aplica solamente la fila de orden recibida por Realtime al estado local.
 * IMPORTANTE: borrar una orden en la app es un soft-delete (eliminada=true),
 * por lo que Supabase emite UPDATE, no DELETE. Si ese UPDATE se trata como
 * una orden normal, Realtime vuelve a insertarla en state.ordenes justo
 * después de enviarla a la papelera. Aquí se separan correctamente las
 * órdenes activas de las eliminadas/restauradas.
 */
function applyOrdenRealtime(payload) {
  if (!Array.isArray(state.ordenes)) state.ordenes = [];
  if (!Array.isArray(state.ordenesEliminadas)) state.ordenesEliminadas = [];

  const eventType = payload?.eventType;
  const raw = eventType === 'DELETE' ? payload.old : payload.new;
  if (!raw?.id) return;

  const idxActivo = state.ordenes.findIndex(o => o.id === raw.id);
  const idxPapelera = state.ordenesEliminadas.findIndex(o => o.id === raw.id);

  if (eventType === 'DELETE') {
    if (idxActivo >= 0) state.ordenes.splice(idxActivo, 1);
    if (idxPapelera >= 0) state.ordenesEliminadas.splice(idxPapelera, 1);
    return;
  }

  const mapped = mapOrdenRealtime(raw);

  if (mapped.eliminada === true) {
    if (idxActivo >= 0) state.ordenes.splice(idxActivo, 1);
    if (idxPapelera >= 0) state.ordenesEliminadas[idxPapelera] = { ...state.ordenesEliminadas[idxPapelera], ...mapped };
    else state.ordenesEliminadas.push(mapped);
    return;
  }

  if (idxPapelera >= 0) state.ordenesEliminadas.splice(idxPapelera, 1);
  const idxActual = state.ordenes.findIndex(o => o.id === raw.id);
  if (idxActual >= 0) state.ordenes[idxActual] = { ...state.ordenes[idxActual], ...mapped };
  else state.ordenes.push(mapped);
}

/** Inicia una única suscripción a cambios de órdenes del tenant actual. */
export function startRealtimeAgenda() {
  if (realtimeChannel) return;

  const tenant = tenantId();
  if (!tenant || !supabase) return;

  try {
    realtimeChannel = supabase
      .channel('agenda-ordenes-' + tenant)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ordenes',
          filter: `tenant_id=eq.${tenant}`
        },
        (payload) => {
          applyOrdenRealtime(payload);

          const agendaTab = document.getElementById('tab-agenda');
          if (agendaTab && agendaTab.classList.contains('active')) {
            // No volver a consultar las tres listas por cada UPDATE Realtime.
            // La fecha operativa vive en orden_items; para cambios de la orden
            // alcanza con actualizar estado en las filas ya cargadas.
            const agenda = db.getAgendaData ? db.getAgendaData() : null;
            const mapped = mapOrdenRealtime(payload.new);
            if (agenda && mapped && agenda.rows) {
              ['hoy','atrasados','programados'].forEach(kind => {
                const arr = agenda.rows[kind] || [];
                if (mapped.estado === 'Entregado' || mapped.entregado === true || mapped.eliminada === true) {
                  agenda.rows[kind] = arr.filter(x => x.ordenId !== mapped.id);
                } else {
                  arr.forEach(x => { if (x.ordenId === mapped.id) x.estado = mapped.estado || x.estado; });
                }
              });
            }
            renderAgenda(true);
          }
          const ordenesTab = document.getElementById('tab-ordenes');
          if (ordenesTab && ordenesTab.classList.contains('active') && window.renderOrdenes) window.renderOrdenes();
          if (window.renderPapeleras) window.renderPapeleras();

          if (payload.eventType === 'INSERT') showToast('Nueva orden agregada', 'info');
          else if (payload.eventType === 'UPDATE' && mapOrdenRealtime(payload.new)?.eliminada !== true) showToast('Orden actualizada', 'info');
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✓ Realtime agenda activa');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Error en canal Realtime');
        }
      });
  } catch (e) {
    realtimeChannel = null;
    console.error('Error al iniciar Realtime:', e);
  }
}

/** Detiene la suscripción actual exactamente una vez. */
export function stopRealtimeAgenda() {
  const channel = realtimeChannel;
  if (!channel) return;
  realtimeChannel = null;
  try { supabase.removeChannel(channel); } catch (e) { /* noop */ }
  console.log('✗ Realtime agenda detenida');
}

Object.assign(window, { renderAgenda, startRealtimeAgenda, stopRealtimeAgenda, verOrdenDesdeAgenda });
