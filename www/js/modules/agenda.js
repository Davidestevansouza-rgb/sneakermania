/* ============================================================
   MÓDULO: AGENDA
   Fase 2: Incluye Supabase Realtime para actualizaciones en tiempo real.
   ============================================================ */
import { state, todayISO, tenantId } from '../state.js';
import { fmtDate, clienteNombre, showToast } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { supabase } from '../config.js';

let realtimeChannel = null;

export function renderAgenda() {
  const today = todayISO(0);
  const items = state.ordenItems || [];
  const pares = [];

  items.forEach(it => {
    const o = state.ordenes.find(x => x.id === it.ordenId);
    if (!o || o.estado === 'Entregado' || it.entregado) return;
    const fechaPar = it.fechaEntregaEstimada || o.fechaEstimada;
    if (!fechaPar) return;
    pares.push({
      ordenNum: o.numero,
      ordenId: o.id,
      cliente: clienteNombre(o.clienteId),
      codigo: it.codigo,
      tipoServicio: it.tipoServicio || '',
      fecha: fechaPar,
      estado: it.estado || o.estado
    });
  });

  state.ordenes.forEach(o => {
    if (o.estado === 'Entregado') return;
    const tieneItems = items.some(it => it.ordenId === o.id);
    if (!tieneItems && o.fechaEstimada) {
      pares.push({
        ordenNum: o.numero,
        ordenId: o.id,
        cliente: clienteNombre(o.clienteId),
        codigo: '#' + o.numero,
        tipoServicio: '',
        fecha: o.fechaEstimada,
        estado: o.estado
      });
    }
  });

  const hoy = pares.filter(p => p.fecha === today);
  const atrasados = pares.filter(p => p.fecha < today);
  const diasSel = document.getElementById('agenda-programados-dias');
  const diasProgramados = diasSel ? Number(diasSel.value) || 7 : 7;
  const programados = pares.filter(p => {
    if (!(p.fecha > today)) return false;
    return (new Date(p.fecha) - new Date(today)) / (1000 * 3600 * 24) <= diasProgramados;
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const renderList = (list, kind) => list.length ? list.map(p => {
    const diasLabel = kind === 'atrasados'
      ? ' · ⚠ ' + Math.round((new Date(today) - new Date(p.fecha)) / (1000 * 3600 * 24)) + ' día(s) atrasado'
      : (kind === 'programados'
        ? ' · en ' + Math.round((new Date(p.fecha) - new Date(today)) / (1000 * 3600 * 24)) + ' día(s)'
        : ' · para hoy');
    const estadoChip = p.estado ? '<span class="hint" style="margin-left:4px;">' + escHtml(p.estado) + '</span>' : '';
    return '<div class="mini-order" onclick="window.verOrdenDesdeAgenda(\'' + p.ordenId + '\')" style="cursor:pointer;">'
      + '<strong>' + escHtml(p.codigo) + '</strong> · ' + escHtml(p.cliente)
      + ' <span class="hint">#' + escHtml(p.ordenNum) + (p.tipoServicio ? ' · ' + escHtml(p.tipoServicio) : '') + '</span>'
      + '<br><span class="hint">Entrega: ' + fmtDate(p.fecha) + diasLabel + '</span>'
      + estadoChip
      + '</div>';
  }).join('') : '<div class="hint">Sin registros</div>';

  document.getElementById('agenda-hoy').innerHTML = renderList(hoy, 'hoy');
  document.getElementById('agenda-atrasados').innerHTML = renderList(atrasados, 'atrasados');
  document.getElementById('agenda-programados').innerHTML = renderList(programados, 'programados');

  const indicator = document.getElementById('realtime-indicator');
  if (indicator) indicator.style.display = realtimeChannel ? 'inline-flex' : 'none';

  const cuenta = atrasados.length;
  if (document.getElementById('tab-agenda')
      && document.getElementById('tab-agenda').classList.contains('active')) {
    if (cuenta > 0 && cuenta !== ultimoAtrasadosAgenda) pipBeep();
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

export function verOrdenDesdeAgenda(ordenId) {
  if (window.viewOrdenDetalle) window.viewOrdenDetalle(ordenId);
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
    tenantId: row.tenant_id ?? row.tenantId
  };
}

/**
 * Aplica solamente la fila de orden recibida por Realtime al estado local.
 * No ejecuta loadAllData() ni hace ninguna consulta adicional.
 */
function applyOrdenRealtime(payload) {
  if (!Array.isArray(state.ordenes)) state.ordenes = [];

  const eventType = payload?.eventType;
  const raw = eventType === 'DELETE' ? payload.old : payload.new;
  if (!raw?.id) return;

  const idx = state.ordenes.findIndex(o => o.id === raw.id);

  if (eventType === 'DELETE') {
    if (idx >= 0) state.ordenes.splice(idx, 1);
    return;
  }

  const mapped = mapOrdenRealtime(raw);
  if (idx >= 0) state.ordenes[idx] = { ...state.ordenes[idx], ...mapped };
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
          if (agendaTab && agendaTab.classList.contains('active')) renderAgenda();

          if (payload.eventType === 'INSERT') showToast('Nueva orden agregada', 'info');
          else if (payload.eventType === 'UPDATE') showToast('Orden actualizada', 'info');
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
