/* ============================================================
   MÓDULO: REPORTES
   - Filtro por rango de fechas (Órdenes, Finanzas, Gastos)
   - Resumen financiero del período
   - Exportación a CSV (Excel) y a PDF con membrete
   ============================================================ */
import { state } from '../state.js';
import { showToast, fmtServicios, clienteNombre, fmtMoney, fmtDate, logActivity } from '../ui.js';

/* ---------- Utilidades de fecha ---------- */
function getRange() {
  const d = (document.getElementById('rep-desde') || {}).value || '';
  const h = (document.getElementById('rep-hasta') || {}).value || '';
  return { desde: d || null, hasta: h || null };
}

function inRange(fecha, r) {
  if (!fecha) return !r.desde && !r.hasta; // sin fecha solo entra si no hay filtro
  const f = String(fecha).slice(0, 10);
  if (r.desde && f < r.desde) return false;
  if (r.hasta && f > r.hasta) return false;
  return true;
}

function rangeLabel(r) {
  if (!r.desde && !r.hasta) return 'Todos los registros';
  if (r.desde && r.hasta) return `Del ${fmtDate(r.desde)} al ${fmtDate(r.hasta)}`;
  if (r.desde) return `Desde ${fmtDate(r.desde)}`;
  return `Hasta ${fmtDate(r.hasta)}`;
}

/* ---------- Botones de rango rápido ---------- */
export function setRepRange(preset) {
  const desde = document.getElementById('rep-desde');
  const hasta = document.getElementById('rep-hasta');
  if (!desde || !hasta) return;
  const now = new Date();
  // Formatear en fecha LOCAL (no UTC). Usar toISOString() aquí provocaba un
  // desfase de un día en zonas detrás de UTC (ej. La Paz, UTC-4): por la noche
  // "hoy" saltaba al día siguiente. Construimos YYYY-MM-DD con la fecha local.
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (preset === 'hoy') {
    desde.value = iso(now); hasta.value = iso(now);
  } else if (preset === 'mes') {
    desde.value = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    hasta.value = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (preset === 'anio') {
    desde.value = iso(new Date(now.getFullYear(), 0, 1));
    hasta.value = iso(new Date(now.getFullYear(), 11, 31));
  } else if (preset === 'limpiar') {
    desde.value = ''; hasta.value = '';
  }
  renderReportes();
}

/* ---------- Datos filtrados ---------- */
function ordenesFiltradas(r) {
  return state.ordenes.filter(o => {
    if (!r.desde && !r.hasta) return true;
    return inRange(o.fechaIngreso, r);
  });
}
function gastosFiltrados(r) {
  return state.gastos.filter(g => {
    if (!r.desde && !r.hasta) return true;
    return inRange(g.fecha, r);
  });
}

/* ---------- Resumen financiero ---------- */
function calcResumen(r) {
  const ords = ordenesFiltradas(r);
  const gastos = gastosFiltrados(r);
  let ingresos = 0, pendiente = 0;
  ords.forEach(o => {
    const vf = (Number(o.precio) || 0) - (Number(o.descuento) || 0);
    const pag = Number(o.pagado) || 0;
    ingresos += pag;
    pendiente += Math.max(vf - pag, 0);
  });
  const totalGastos = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  return {
    ingresos, gastos: totalGastos, utilidad: ingresos - totalGastos,
    nordenes: ords.length, pendiente
  };
}

export function renderReportes() {
  const r = getRange();
  const s = calcResumen(r);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rep-ingresos', fmtMoney(s.ingresos));
  set('rep-gastos', fmtMoney(s.gastos));
  set('rep-utilidad', fmtMoney(s.utilidad));
  set('rep-nordenes', String(s.nordenes));
  set('rep-pendiente', fmtMoney(s.pendiente));
  const util = document.getElementById('rep-utilidad');
  if (util) util.style.color = s.utilidad >= 0 ? 'var(--ok,#16a34a)' : '#dc2626';
}

/* ---------- Construcción de filas por reporte ---------- */
function buildRows(kind, r) {
  let rows = [];
  if (kind === 'clientes') {
    rows.push(['Nombre', 'Teléfono', 'WhatsApp', 'Dirección', 'Observaciones', 'N° de órdenes']);
    state.clientes.forEach(c => rows.push([c.nombre, c.telefono, c.whatsapp, c.direccion, c.observaciones, state.ordenes.filter(o => o.clienteId === c.id).length]));
  } else if (kind === 'ordenes') {
    rows.push(['N° Orden', 'Cliente', 'Ingreso', 'Est. entrega', 'Entrega', 'Marca', 'Modelo', 'Color', 'Talla', 'Material', 'Artículos', 'Servicio', 'Prioridad', 'Estado', 'Responsable']);
    ordenesFiltradas(r).forEach(o => rows.push([o.numero, clienteNombre(o.clienteId), o.fechaIngreso, o.fechaEstimada, o.fechaEntrega, o.marca, o.modelo, o.color, o.talla, o.material, o.cantidadPares, fmtServicios(o.tipoServicio), o.prioridad, o.estado, o.responsable]));
  } else if (kind === 'finanzas') {
    rows.push(['N° Orden', 'Cliente', 'Precio', 'Descuento', 'Valor final', 'Pagado', 'Pendiente', 'Método de pago', 'Estado de pago']);
    ordenesFiltradas(r).forEach(o => { const vf = (Number(o.precio) || 0) - (Number(o.descuento) || 0); rows.push([o.numero, clienteNombre(o.clienteId), o.precio, o.descuento || 0, vf, o.pagado, Math.max(vf - (Number(o.pagado) || 0), 0), o.metodoPago, o.estadoPago]); });
  } else if (kind === 'gastos') {
    rows.push(['Categoría', 'Monto', 'Fecha', 'Descripción']);
    gastosFiltrados(r).forEach(g => rows.push([g.categoria, g.monto, g.fecha, g.descripcion]));
  } else if (kind === 'inventario') {
    rows.push(['Nombre', 'Categoría', 'Proveedor', 'Cantidad', 'Stock mínimo', 'Precio compra', 'Fecha compra', 'Fecha vencimiento']);
    state.inventario.forEach(i => rows.push([i.nombre, i.categoria, i.proveedor, i.cantidad, i.stockMinimo, i.precioCompra, i.fechaCompra, i.fechaVencimiento]));
  }
  return rows;
}

/* ---------- CSV ---------- */
function toCSV(rows) {
  return rows.map(row => row.map(c => {
    const s = (c === undefined || c === null) ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}
function downloadCSV(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(kind) {
  const r = getRange();
  downloadCSV('ses_' + kind + '.csv', toCSV(buildRows(kind, r)));
  logActivity('Exportó reporte CSV de ' + kind);
  showToast('Reporte CSV descargado');
}

/* ---------- PDF ---------- */
function negocio() {
  const c = state.config || {};
  return {
    nombre: c.nombre_negocio || 'SneakerMania',
    tel: c.whatsapp_negocio || '',
    email: c.email_negocio || ''
  };
}

function pdfHeader(doc, titulo, subtitulo) {
  const marginX = 40;
  const n = negocio();
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(n.nombre, marginX, 46);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  let y = 60;
  doc.text('Gestión de Lavandería de Artículos', marginX, y);
  if (n.tel) { y += 12; doc.text('WhatsApp: ' + n.tel, marginX, y); }
  if (n.email) { y += 12; doc.text(n.email, marginX, y); }
  doc.setTextColor(0);
  doc.setFontSize(13); doc.setFont(undefined, 'bold');
  doc.text(titulo, marginX, y + 26);
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text(subtitulo, marginX, y + 40);
  doc.setTextColor(0);
  return y + 58; // Y donde continúa el contenido
}

function drawTable(doc, rows, startY) {
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - marginX * 2;
  const cols = rows[0].length;
  const colW = usable / cols;
  let y = startY;
  const lineH = 16;

  const drawRow = (row, bold) => {
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    row.forEach((cell, i) => {
      const txt = (cell === undefined || cell === null) ? '' : String(cell);
      const clipped = doc.splitTextToSize(txt, colW - 4)[0] || '';
      doc.text(clipped, marginX + i * colW + 2, y);
    });
    y += lineH;
  };

  drawRow(rows[0], true);
  doc.setDrawColor(200); doc.line(marginX, y - lineH + 4, pageW - marginX, y - lineH + 4);
  for (let i = 1; i < rows.length; i++) {
    if (y > pageH - 40) { doc.addPage(); y = 50; drawRow(rows[0], true); doc.setDrawColor(200); doc.line(marginX, y - lineH + 4, pageW - marginX, y - lineH + 4); }
    drawRow(rows[i], false);
  }
  return y;
}

const TITULOS = { clientes: 'Reporte de Clientes', ordenes: 'Reporte de Órdenes', finanzas: 'Reporte Financiero', gastos: 'Reporte de Gastos', inventario: 'Reporte de Inventario', resumen: 'Resumen Financiero' };

export function exportPDF(kind) {
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('No se pudo cargar el generador de PDF'); return; }
  const { jsPDF } = window.jspdf;
  const r = getRange();
  const usaRango = (kind === 'ordenes' || kind === 'finanzas' || kind === 'gastos' || kind === 'resumen');
  const sub = usaRango ? rangeLabel(r) : 'Listado completo · ' + fmtDate(new Date().toISOString().slice(0, 10));

  if (kind === 'resumen') {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = pdfHeader(doc, TITULOS.resumen, sub);
    const s = calcResumen(r);
    const marginX = 40;
    const lines = [
      ['Ingresos cobrados', fmtMoney(s.ingresos)],
      ['Gastos', fmtMoney(s.gastos)],
      ['Utilidad neta', fmtMoney(s.utilidad)],
      ['Órdenes en el período', String(s.nordenes)],
      ['Pendiente por cobrar', fmtMoney(s.pendiente)]
    ];
    y += 10;
    doc.setFontSize(11);
    lines.forEach(([k, v]) => {
      doc.setFont(undefined, 'normal'); doc.text(k, marginX, y);
      doc.setFont(undefined, 'bold'); doc.text(v, 555, y, { align: 'right' });
      doc.setDrawColor(230); doc.line(marginX, y + 6, 555, y + 6);
      y += 26;
    });
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Generado por SneakerMania · ' + new Date().toLocaleString(), marginX, doc.internal.pageSize.getHeight() - 30);
    doc.save('ses_resumen.pdf');
  } else {
    const rows = buildRows(kind, r);
    const doc = new jsPDF({ unit: 'pt', format: (rows[0].length > 8 ? 'a4' : 'a4'), orientation: (rows[0].length > 8 ? 'landscape' : 'portrait') });
    const y = pdfHeader(doc, TITULOS[kind] || 'Reporte', sub + '  ·  ' + (rows.length - 1) + ' registro(s)');
    drawTable(doc, rows, y + 6);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Generado por SneakerMania · ' + new Date().toLocaleString(), 40, doc.internal.pageSize.getHeight() - 20);
    doc.save('ses_' + kind + '.pdf');
  }
  logActivity('Exportó reporte PDF de ' + kind);
  showToast('Reporte PDF descargado');
}

Object.assign(window, { exportCSV, exportPDF, setRepRange, renderReportes });
