/* ============================================================
   MÓDULO: FACTURAS
   Las credenciales EMAILJS_* quedan como placeholders. Si no se
   configuran, "Enviar por correo" descarga el PDF y abre el correo
   del cliente para adjuntarlo manualmente.
   ============================================================ */
import { state, todayISO, persist } from '../state.js';
import { showToast, fmtMoney, fmtDate, fmtServicios, clienteNombre, clienteById, ordenById, logActivity } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as db from '../db.js';
import { filtrarOrdenesCombo, limpiarCombo } from '../combo-search.js';

// Variable con ámbito de módulo (reemplaza window._facturaActual).
let facturaActual = null;

const EMAILJS_SERVICE_ID = 'PEGA_AQUI_TU_EMAILJS_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'PEGA_AQUI_TU_EMAILJS_TEMPLATE_ID';
const EMAILJS_PUBLIC_KEY = 'PEGA_AQUI_TU_EMAILJS_PUBLIC_KEY';
const emailjsConfigured = !EMAILJS_SERVICE_ID.includes('PEGA_AQUI') && !EMAILJS_TEMPLATE_ID.includes('PEGA_AQUI') && !EMAILJS_PUBLIC_KEY.includes('PEGA_AQUI');
if (emailjsConfigured && window.emailjs) { window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); }

export function initFacturasTab() {
  // El selector de orden es un buscador (ver filtrarFacturaOrdenes); no hay
  // nada que precargar en una lista larga.
  if (!document.getElementById('fact-fecha').value) document.getElementById('fact-fecha').value = todayISO(0);
  if (!document.getElementById('fact-numero').value) document.getElementById('fact-numero').value = 'F-' + state.nextInvoiceNum;
}

/**
 * Buscador tipo autocompletar de Facturas: filtra órdenes por nombre de
 * cliente, WhatsApp o número de orden desde la primera letra escrita.
 */
export function filtrarFacturaOrdenes(texto) {
  const results = document.getElementById('fact-orden-results');
  if (!results) return;
  const q = (texto || '').trim().toLowerCase();
  const base = q ? state.ordenes.filter(o => {
    const cliente = clienteNombre(o.clienteId).toLowerCase();
    const c = state.clientes.find(cl => cl.id === o.clienteId);
    const whatsapp = (c && c.whatsapp || '').toLowerCase();
    return cliente.includes(q) || String(o.numero).includes(q) || whatsapp.includes(q);
  }) : state.ordenes.slice();

  const rank = o => {
    const cliente = clienteNombre(o.clienteId).toLowerCase();
    if (!q) return 0;
    if (cliente.startsWith(q)) return 0;
    if (String(o.numero).startsWith(q)) return 1;
    return 2;
  };
  const matches = base.sort((a, b) => rank(a) - rank(b) || b.numero - a.numero).slice(0, 20);
  const lista = matches.length ? matches.map(o =>
    '<div class="combo-item" onmousedown="seleccionarFacturaOrden(\'' + escAttr(o.id) + '\')">' +
      escHtml(clienteNombre(o.clienteId)) +
    '</div>'
  ).join('') : (q ? '<div class="combo-empty">Sin resultados</div>' : '');
  results.innerHTML = lista;
}

/** Selecciona una orden desde los resultados del buscador de Facturas.
 * El campo "Orden relacionada" solo debe mostrar el nombre del cliente
 * (sin # de orden ni marca/modelo del artículo): la orden queda igual
 * vinculada por dentro (fact-orden guarda el id), solo cambia lo que
 * se ve en el buscador. */
export function seleccionarFacturaOrden(id) {
  const o = ordenById(id);
  document.getElementById('fact-orden').value = id;
  if (o) {
    document.getElementById('fact-orden-search').value = clienteNombre(o.clienteId);
  }
  limpiarCombo('fact-orden-results');
  prefillFacturaFromOrden();
}

export function prefillFacturaFromOrden() {
  const id = document.getElementById('fact-orden').value;
  if (!id) return;
  const o = ordenById(id);
  const c = clienteById(o.clienteId);
  const valorFinal = Number(o.precio) - Number(o.descuento || 0);
  document.getElementById('fact-nombre').value = c ? c.nombre : '';
  document.getElementById('fact-telefono').value = c ? (c.whatsapp || c.telefono || '') : '';
  document.getElementById('fact-email').value = c && c.email ? c.email : '';
  document.getElementById('fact-direccion').value = c && c.direccion ? c.direccion : '';
  document.getElementById('fact-concepto').value = fmtServicios(o.tipoServicio) + ' — ' + o.marca + ' ' + o.modelo + ' (' + o.color + ', talla ' + o.talla + ')';
  document.getElementById('fact-subtotal').value = o.precio;
  document.getElementById('fact-total').value = valorFinal;
  if (o.metodoPago) {
    const sel = document.getElementById('fact-metodo-pago');
    if ([...sel.options].some(op => op.value === o.metodoPago)) sel.value = o.metodoPago;
  }
}

export function resetFacturaForm() {
  document.getElementById('fact-orden').value = '';
  const buscador = document.getElementById('fact-orden-search'); if (buscador) buscador.value = '';
  ['fact-nombre', 'fact-rfc', 'fact-email', 'fact-telefono', 'fact-direccion', 'fact-concepto', 'fact-notas'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fact-subtotal').value = '';
  document.getElementById('fact-total').value = '';
  document.getElementById('fact-fecha').value = todayISO(0);
  document.getElementById('factura-preview').innerHTML = '<div class="empty-state"><div class="big">🧾</div>Completa los datos y presiona "Generar factura" para ver la vista previa aquí.</div>';
  document.getElementById('factura-preview-actions').style.display = 'none';
  document.getElementById('factura-preview-actions').innerHTML = '';
}

export function generarFacturaPreview() {
  const nombre = document.getElementById('fact-nombre').value.trim();
  const total = Number(document.getElementById('fact-total').value) || 0;
  if (!nombre) { showToast('Ingresa el nombre o razón social del cliente'); return; }
  if (!total) { showToast('Ingresa el total de la factura'); return; }

  const numero = document.getElementById('fact-numero').value || ('F-' + state.nextInvoiceNum);
  const fecha = document.getElementById('fact-fecha').value || todayISO(0);
  const rfc = document.getElementById('fact-rfc').value.trim() || '—';
  const email = document.getElementById('fact-email').value.trim() || '—';
  const telefono = document.getElementById('fact-telefono').value.trim() || '—';
  const direccion = document.getElementById('fact-direccion').value.trim() || '—';
  const metodoPago = document.getElementById('fact-metodo-pago').value;
  const concepto = document.getElementById('fact-concepto').value.trim() || 'Servicio de lavado y cuidado de calzado';
  const subtotal = Number(document.getElementById('fact-subtotal').value) || total;
  const notas = document.getElementById('fact-notas').value.trim();
  const ordenId = document.getElementById('fact-orden').value;
  const orden = ordenId ? ordenById(ordenId) : null;

  facturaActual = { numero, fecha, nombre, rfc, email, telefono, direccion, metodoPago, concepto, subtotal, total, notas, ordenId: ordenId || null, clienteId: orden ? orden.clienteId : null, ordenNumero: orden ? orden.numero : null };

  document.getElementById('factura-preview').innerHTML =
    '<div id="factura-imprimible" style="border:1px solid var(--line);border-radius:10px;padding:18px;background:#fff;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:12px;">' +
        '<div><div style="font-family:\'Urbanist\',sans-serif;font-weight:700;font-size:17px;">Gestión de Lavandería de Artículos</div></div>' +
        '<div style="text-align:right;"><div class="mono" style="font-weight:700;">Factura ' + escHtml(numero) + '</div><div class="hint">' + fmtDate(fecha) + '</div>' + (orden ? '<div class="hint">Orden #' + escHtml(orden.numero) + '</div>' : '') + '</div>' +
      '</div>' +
      '<table class="data"><tbody>' +
        '<tr><th>Cliente / Razón social</th><td>' + escHtml(nombre) + '</td></tr>' +
        '<tr><th>RFC / ID fiscal</th><td>' + escHtml(rfc) + '</td></tr>' +
        '<tr><th>Correo</th><td>' + escHtml(email) + '</td></tr>' +
        '<tr><th>Teléfono</th><td>' + escHtml(telefono) + '</td></tr>' +
        '<tr><th>Dirección</th><td>' + escHtml(direccion) + '</td></tr>' +
        '<tr><th>Concepto</th><td>' + escHtml(concepto) + '</td></tr>' +
        '<tr><th>Método de pago</th><td>' + escHtml(metodoPago) + '</td></tr>' +
        '<tr><th>Subtotal</th><td>' + fmtMoney(subtotal) + '</td></tr>' +
        '<tr><th>Total</th><td style="font-weight:700;">' + fmtMoney(total) + '</td></tr>' +
        (notas ? '<tr><th>Notas</th><td>' + escHtml(notas) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<div class="hint" style="margin-top:12px;">Gracias por su preferencia.</div>' +
    '</div>';

  document.getElementById('factura-preview-actions').style.display = 'flex';
  document.getElementById('factura-preview-actions').innerHTML =
    '<button class="btn btn-teal" onclick="printFactura()">🖨 Imprimir factura</button>' +
    '<button class="btn btn-teal" onclick="downloadFacturaPDF()">⬇ Descargar PDF</button>' +
    '<button class="btn btn-primary" onclick="sendFacturaPorCorreo()">📧 Enviar por correo</button>' +
    '<button class="btn btn-ghost" onclick="confirmarFacturaEmitida()">Guardar folio</button>';
}

export async function confirmarFacturaEmitida() {
  if (!facturaActual) return;
  try {
    const result = await db.saveFactura({
      numero: facturaActual.numero,
      ordenId: facturaActual.ordenId,
      clienteId: facturaActual.clienteId,
      nombreCliente: facturaActual.nombre,
      rfc: facturaActual.rfc,
      email: facturaActual.email,
      telefono: facturaActual.telefono,
      direccion: facturaActual.direccion,
      concepto: facturaActual.concepto,
      metodoPago: facturaActual.metodoPago,
      subtotal: facturaActual.subtotal,
      total: facturaActual.total
    });
    if (result && result.error) throw result.error;
    // Reflejar la nueva factura en el estado local para que, por ejemplo,
    // el borrado de órdenes pueda detectar que la orden ya tiene factura.
    state.facturas.push({
      id: result.id, numero: facturaActual.numero, ordenId: facturaActual.ordenId,
      clienteId: facturaActual.clienteId, nombreCliente: facturaActual.nombre,
      total: facturaActual.total, fecha: new Date().toISOString()
    });
    state.nextInvoiceNum++;
    logActivity('Emitió factura ' + facturaActual.numero + ' por ' + fmtMoney(facturaActual.total));
    await persist();
    showToast('Factura registrada con folio ' + facturaActual.numero);
    document.getElementById('fact-numero').value = 'F-' + state.nextInvoiceNum;
  } catch (e) { console.error(e); showToast('Error al registrar el folio'); }
}

export function printFactura() {
  try {
    const content = document.getElementById('factura-imprimible');
    if (!content) return;
    const html = '<html><head><title>Factura</title><style>' +
      'body{font-family:Arial,sans-serif;padding:24px;color:#0B0B0D;}' +
      'table{width:100%;border-collapse:collapse;margin-top:10px;}' +
      'th{text-align:left;color:#6E6E76;font-weight:700;padding:6px 8px;width:40%;}' +
      'td{padding:6px 8px;border-bottom:1px solid #E4E3E0;}' +
      '</style></head><body>' + content.innerHTML + '</body></html>';
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
    showToast('No se pudo imprimir la factura.');
  }
}

function buildFacturaPDFDoc() {
  const f = facturaActual;
  if (!f) return null;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('No se pudo cargar el generador de PDF (revisa tu conexión a internet)');
    return null;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  let y = 60;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('Gestión de Lavandería de Artículos', marginX, y);

  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('Factura ' + f.numero, 545, 60, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 110, 118);
  doc.text(fmtDate(f.fecha), 545, 76, { align: 'right' });
  if (f.ordenNumero) doc.text('Orden #' + f.ordenNumero, 545, 90, { align: 'right' });

  y = 120;
  doc.setDrawColor(11, 11, 13); doc.setLineWidth(1.2);
  doc.line(marginX, y, 545, y);
  y += 24;

  const rows = [
    ['Cliente / Razón social', f.nombre],
    ['RFC / ID fiscal', f.rfc],
    ['Correo', f.email],
    ['Teléfono', f.telefono],
    ['Dirección', f.direccion],
    ['Concepto', f.concepto],
    ['Método de pago', f.metodoPago],
    ['Subtotal', fmtMoney(f.subtotal)],
  ];
  doc.setFontSize(10);
  rows.forEach(([label, value]) => {
    doc.setTextColor(110, 110, 118); doc.setFont('helvetica', 'bold');
    doc.text(label, marginX, y);
    doc.setTextColor(11, 11, 13); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(value || '—'), 340);
    doc.text(lines, marginX + 180, y);
    y += 16 * lines.length + 4;
  });

  y += 6;
  doc.setDrawColor(228, 227, 224); doc.line(marginX, y, 545, y);
  y += 26;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Total', marginX, y);
  doc.text(fmtMoney(f.total), 545, y, { align: 'right' });

  if (f.notas) {
    y += 30;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(110, 110, 118);
    doc.text('Notas', marginX, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(11, 11, 13);
    doc.text(doc.splitTextToSize(f.notas, 497), marginX, y);
  }

  doc.setFontSize(9); doc.setTextColor(150, 150, 150);
  doc.text('Gracias por su preferencia.', marginX, 800);
  return doc;
}

export function downloadFacturaPDF() {
  if (!facturaActual) { showToast('Genera la factura antes de descargarla'); return; }
  try {
    const doc = buildFacturaPDFDoc();
    if (!doc) return;
    doc.save('factura-' + facturaActual.numero + '.pdf');
    logActivity('Descargó PDF de factura ' + facturaActual.numero);
  } catch (e) {
    console.error(e);
    showToast('No se pudo descargar el PDF. Intenta de nuevo.');
  }
}

export async function sendFacturaPorCorreo() {
  const f = facturaActual;
  if (!f) { showToast('Genera la factura antes de enviarla'); return; }
  if (!f.email || f.email === '—') { showToast('Ingresa el correo del cliente para poder enviarla'); return; }

  let doc;
  try {
    doc = buildFacturaPDFDoc();
  } catch (e) {
    console.error(e);
    showToast('No se pudo generar el PDF de la factura.');
    return;
  }
  if (!doc) return;
  const fileName = 'factura-' + f.numero + '.pdf';

  if (emailjsConfigured && window.emailjs) {
    try {
      showToast('Enviando factura por correo...');
      const base64PDF = doc.output('datauristring').split(',')[1];
      await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: f.email,
        to_name: f.nombre,
        invoice_number: f.numero,
        invoice_total: fmtMoney(f.total),
        invoice_date: fmtDate(f.fecha),
        attachment: base64PDF,
        attachment_name: fileName
      });
      logActivity('Envió factura ' + f.numero + ' por correo a ' + f.email + ' (automático)');
      showToast('Factura enviada automáticamente a ' + f.email);
    } catch (e) {
      console.error(e);
      showToast('No se pudo enviar automáticamente. Se descargó el PDF para enviarlo manualmente.');
      try { doc.save(fileName); } catch (e2) { console.error(e2); }
      openFacturaMailto(f, fileName);
    }
  } else {
    try { doc.save(fileName); } catch (e) { console.error(e); showToast('No se pudo descargar el PDF.'); }
    openFacturaMailto(f, fileName);
    logActivity('Preparó envío manual de factura ' + f.numero + ' a ' + f.email);
    showToast('PDF descargado. Se abrió tu correo — adjunta el archivo "' + fileName + '" y envíalo.');
  }
}

function openFacturaMailto(f, fileName) {
  try {
    const subject = encodeURIComponent('Factura ' + f.numero);
    const body = encodeURIComponent(
      'Hola ' + f.nombre + ',\n\n' +
      'Adjunto la factura ' + f.numero + ' por un total de ' + fmtMoney(f.total) + ' correspondiente a ' + f.concepto + '.\n\n' +
      '(Recuerda adjuntar el archivo "' + fileName + '" que se acaba de descargar antes de enviar este correo)\n\n' +
      '¡Gracias por tu preferencia!'
    );
    const link = document.createElement('a');
    link.href = 'mailto:' + f.email + '?subject=' + subject + '&body=' + body;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (e) {
    console.error(e);
    showToast('No se pudo abrir tu app de correo. Copia el correo del cliente y envía el PDF manualmente: ' + f.email);
  }
}

Object.assign(window, {
  initFacturasTab, prefillFacturaFromOrden, resetFacturaForm, generarFacturaPreview,
  confirmarFacturaEmitida, printFactura, downloadFacturaPDF, sendFacturaPorCorreo,
  filtrarFacturaOrdenes, seleccionarFacturaOrden
});
