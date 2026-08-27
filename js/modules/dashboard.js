/* ============================================================
   DASHBOARD — Sistema SeS
   ============================================================ */
import { state } from '../state.js';
import { fmtMoney } from '../ui.js';
import { escHtml } from '../sanitize.js';
import { FLUJO_ESTADOS } from './ordenes.js';

export function renderDashboard() {
  const ordenes = state.ordenes;
  const esAdminSub = state.session && state.session.role === 'Administrador';
  const dashSub = document.querySelector('#tab-dashboard .page-sub');
  if (dashSub) dashSub.textContent = esAdminSub ? 'Resumen operativo y financiero en tiempo real' : 'Resumen operativo en tiempo real';
  // "En proceso" = cualquier estado de trabajo antes de Biblioteca/Entregado.
  const enProceso = ordenes.filter(o => FLUJO_ESTADOS.slice(0, -2).includes(o.estado)).length;
  const finalizados = ordenes.filter(o => o.estado === 'Biblioteca').length;
  const entregados = ordenes.filter(o => o.estado === 'Entregado').length;

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const isSamePeriod = (dateStr, days) => {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00');
    const diff = Math.round((now - d) / (1000 * 3600 * 24));
    return diff >= 0 && diff <= days;
  };
  const ingresosDiarios = ordenes.filter(o => isSamePeriod(o.fechaPago, 0)).reduce((s, o) => s + Number(o.pagado || 0), 0);
  const ingresosSemana = ordenes.filter(o => isSamePeriod(o.fechaPago, 7)).reduce((s, o) => s + Number(o.pagado || 0), 0);
  const ingresosMes = ordenes.filter(o => isSamePeriod(o.fechaPago, 30)).reduce((s, o) => s + Number(o.pagado || 0), 0);
  const ingresosAnio = ordenes.filter(o => isSamePeriod(o.fechaPago, 365)).reduce((s, o) => s + Number(o.pagado || 0), 0);

  const totalCobrado = ordenes.reduce((s, o) => s + Number(o.pagado || 0), 0);
  const totalQR = ordenes.reduce((s, o) => s + Number(o.pagadoQR || 0), 0);
  const totalEfectivo = ordenes.reduce((s, o) => s + Number(o.pagadoEfectivo || 0), 0);
  const totalPendiente = ordenes.reduce((s, o) => {
    const valorFinal = Number(o.precio || 0) - Number(o.descuento || 0);
    return s + Math.max(valorFinal - Number(o.pagado || 0), 0);
  }, 0);
  const gastosMes = state.gastos.filter(g => isSamePeriod(g.fecha, 30)).reduce((s, g) => s + Number(g.monto || 0), 0);
  const gastosTotal = state.gastos.reduce((s, g) => s + Number(g.monto || 0), 0);
  const utilidadBruta = ingresosMes - state.gastos.filter(g => g.categoria === 'Productos' && isSamePeriod(g.fecha, 30)).reduce((s, g) => s + Number(g.monto || 0), 0);
  const utilidadNeta = ingresosMes - gastosMes;
  const flujoCaja = totalCobrado - gastosTotal;
  const bajoStock = state.inventario.filter(i => Number(i.cantidad) <= Number(i.stockMinimo)).length;

  const esAdmin = state.session && state.session.role === 'Administrador';

  const kpisOperativos = [
    { label: 'Clientes registrados', value: state.clientes.length },
    { label: 'Servicios en proceso', value: enProceso },
    { label: 'Finalizados', value: finalizados },
    { label: 'Entregados', value: entregados },
    { label: 'Productos con bajo stock', value: bajoStock, warn: bajoStock > 0 }
  ];
  const kpisFinancieros = [
    { label: 'Ingresos hoy', value: fmtMoney(ingresosDiarios) },
    { label: 'Ingresos semana', value: fmtMoney(ingresosSemana) },
    { label: 'Ingresos mes', value: fmtMoney(ingresosMes) },
    { label: 'Ingresos año', value: fmtMoney(ingresosAnio) },
    { label: 'Total cobrado', value: fmtMoney(totalCobrado) },
    { label: 'Cobrado por QR', value: fmtMoney(totalQR) },
    { label: 'Cobrado en efectivo', value: fmtMoney(totalEfectivo) },
    { label: 'Total pendiente', value: fmtMoney(totalPendiente) },
    { label: 'Gastos (mes)', value: fmtMoney(gastosMes) },
    { label: 'Flujo de caja', value: fmtMoney(flujoCaja) },
    { label: 'Utilidad bruta (mes)', value: fmtMoney(utilidadBruta) },
    { label: 'Utilidad neta (mes)', value: fmtMoney(utilidadNeta) }
  ];
  const kpis = esAdmin ? kpisOperativos.concat(kpisFinancieros) : kpisOperativos;
  document.getElementById('kpi-grid').innerHTML = kpis.map(k =>
    '<div class="kpi-card' + (k.warn ? ' warn' : '') + '"><div class="kpi-label">' + escHtml(k.label) + '</div><div class="kpi-value">' + escHtml(k.value) + '</div></div>'
  ).join('') + (esAdmin ? '' : '<div class="hint" style="grid-column:1/-1;">El resumen financiero solo está disponible para el rol Administrador.</div>');

  // Ingresos últimos 6 meses (solo Administrador)
  const dashIngresosEl = document.getElementById('dash-ingresos-list');
  const chartIngresosWrap = dashIngresosEl ? dashIngresosEl.parentElement : null;
  if (esAdmin && chartIngresosWrap) {
    chartIngresosWrap.style.display = '';
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ label: d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() });
    }
    const ingresosPorMes = months.map(mo => {
      return ordenes.filter(o => {
        if (!o.fechaPago) return false;
        const d = new Date(o.fechaPago + 'T00:00:00');
        return d.getFullYear() === mo.y && d.getMonth() === mo.m;
      }).reduce((s, o) => s + Number(o.pagado || 0), 0);
    });
    const maxIngreso = Math.max(...ingresosPorMes, 1);
    document.getElementById('dash-ingresos-list').innerHTML = months.map((mo, i) => {
      const pct = Math.round((ingresosPorMes[i] / maxIngreso) * 100);
      return '<div style="margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;"><span style="text-transform:capitalize;">' + escHtml(mo.label) + '</span><span class="mono" style="font-weight:700;">' + fmtMoney(ingresosPorMes[i]) + '</span></div>' +
        '<div style="height:8px;border-radius:5px;background:#E7E5DA;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:var(--teal);border-radius:5px;"></div></div>' +
        '</div>';
    }).join('');
  } else if (chartIngresosWrap) {
    chartIngresosWrap.style.display = 'none';
  }

  const estadosLabels = FLUJO_ESTADOS;
  const estadosColors = ['#A8A8AE', '#2F5DE0', '#8E6FC4', '#C6A24D', '#D68A3C', '#4FA8A0', '#6FA867', '#3C8A5A'];
  const estadosData = estadosLabels.map(e => ordenes.filter(o => o.estado === e).length);
  const totalOrdenes = ordenes.length || 1;
  document.getElementById('dash-estados-list').innerHTML = estadosLabels.map((label, i) => {
    const count = estadosData[i];
    const pct = Math.round((count / totalOrdenes) * 100);
    return '<div style="margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;"><span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + estadosColors[i] + ';margin-right:6px;"></span>' + escHtml(label) + '</span><span style="font-weight:700;">' + count + '</span></div>' +
      '<div style="height:8px;border-radius:5px;background:#E7E5DA;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + estadosColors[i] + ';border-radius:5px;"></div></div>' +
      '</div>';
  }).join('');

  const low = state.inventario.filter(i => Number(i.cantidad) <= Number(i.stockMinimo));
  document.getElementById('dash-lowstock').innerHTML = low.length ? low.map(i =>
    '<div class="notif-item"><div class="notif-ic s">▥</div><div><strong>' + escHtml(i.nombre) + '</strong><div class="hint">Quedan ' + escHtml(i.cantidad) + ' unidades · mínimo ' + escHtml(i.stockMinimo) + '</div></div></div>'
  ).join('') : '<div class="hint">No hay productos por debajo del stock mínimo.</div>';

  if (typeof window.updateBell === 'function') window.updateBell();
}

Object.assign(window, { renderDashboard });
