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

export function renderAgenda() {
  const today = todayISO(0);
  const items = state.ordenItems || [];

  // Lista plana de "pares" para la agenda (uno por cada ordenItem),
  // con su fecha individual (it.fechaEntrega / it.fechaEstimada / o.fechaEstimada),
  // estado de taller y cliente/orden.
  const pares = [];
  items.forEach(it => {
    const o = state.ordenes.find(x => x.id === it.ordenId);
    if (!o || o.estado === 'Entregado' || it.entregado) return;
    // El par puede tener su propia fecha de entrega estimada (fechaEntregaEstimada,
    // cargada al crear la orden) o caer con la de la orden general.
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

  // Si una orden NO tiene pares individuales, llevamos su fecha general
  // como un único "par general".
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

  // Plantilla: una tarjeta por par, con su código (#orden-NRO_ITEM), cliente
  // (# de orden general), estado de taller y la fecha estimada de entrega.
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

  // Indicador de tiempo real
  const indicator = document.getElementById('realtime-indicator');
  if (indicator) {
    indicator.style.display = realtimeChannel ? 'inline-flex' : 'none';
  }

  // Beep de pip al detectar pares atrasados: lo reproducimos SOLO si la
  // pestaña Agenda está activa y la cuenta de atrasados cambió desde la
  // última vez (para no hacerlo molesto en cada render).
  const cuenta = atrasados.length;
  if (document.getElementById('tab-agenda')
      && document.getElementById('tab-agenda').classList.contains('active')) {
    if (cuenta > 0 && cuenta !== ultimoAtrasadosAgenda) {
      pipBeep();
    }
    ultimoAtrasadosAgenda = cuenta;
  } else {
    // reset caché cuando se sale de la agenda
    ultimoAtrasadosAgenda = cuenta;
  }
}

let ultimoAtrasadosAgenda = null;

/** Reproduce un "pip" corto usando el Web Audio API (sin archivo de audio). */
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
    osc.stop(now + 0.15);   // pip corto de 150ms
    osc.onended = () => { try { ctx.close(); } catch (_) {} };
  } catch (e) { /* sin audio, no rompe nada */ }
}

/** Lleva al detalle de una orden al tocarla desde la agenda. */
export function verOrdenDesdeAgenda(ordenId) {
  if (window.viewOrdenDetalle) window.viewOrdenDetalle(ordenId);
}

/**
 * Inicia suscripción a cambios en tiempo real de la tabla ordenes.
 */
export function startRealtimeAgenda() {
  if (realtimeChannel) return; // Ya está activo
  
  const tenant = tenantId();
  if (!tenant) return;
  
  try {
    // Crear canal de Realtime
    realtimeChannel = supabase
      .channel('agenda-ordenes')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'ordenes',
          filter: `tenant_id=eq.${tenant}`
        },
        async (payload) => {
          console.log('Realtime update:', payload);
          
          // Recargar datos y re-renderizar
          await db.loadAllData();
          
          // Si la agenda está visible, renderizar
          const agendaTab = document.getElementById('tab-agenda');
          if (agendaTab && agendaTab.classList.contains('active')) {
            renderAgenda();
          }
          
          // Mostrar notificación discreta
          if (payload.eventType === 'INSERT') {
            showToast('Nueva orden agregada', 'info');
          } else if (payload.eventType === 'UPDATE') {
            showToast('Orden actualizada', 'info');
          }
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
    console.error('Error al iniciar Realtime:', e);
  }
}

/**
 * Detiene la suscripción a tiempo real.
 */
export function stopRealtimeAgenda() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
    console.log('✗ Realtime agenda detenida');
  }
}

Object.assign(window, { renderAgenda, startRealtimeAgenda, stopRealtimeAgenda, verOrdenDesdeAgenda });
