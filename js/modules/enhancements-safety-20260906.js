import { state, todayISO, esEmpleado } from '../state.js';
import { supabase } from '../config.js';
import { fmtDate } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';

/* Protecciones de validación para las mejoras operativas.
 * No cambia esquema, RLS, Edge Functions, R2 ni datos históricos.
 */
if (!window.__smSafety0906) {
  window.__smSafety0906 = true;
  queueMicrotask(initSafety);
}

function initSafety() {
  protegerFechaEntregaGeneral();
  envolverProduccion();
  envolverNavegacion();
  enlazarHistorialProduccion();
  corregirEtiquetasBlanqueamiento();
}

/* 1) Al editar una orden vieja, el campo general NO pisa las fechas
 * individuales salvo que el usuario realmente lo cambie. */
function protegerFechaEntregaGeneral() {
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'orden-fecha-entrega-general') {
      e.target.dataset.smChanged = '1';
    }
  }, true);

  const original = window.saveOrden;
  if (typeof original !== 'function' || original.__smDateSafety) return;
  const wrapper = function(...args) {
    const fecha = document.getElementById('orden-fecha-entrega-general');
    const editando = !!document.getElementById('orden-id')?.value;
    if (editando && fecha && fecha.dataset.smChanged !== '1') {
      const valor = fecha.value;
      fecha.value = '';
      try { return original.apply(this, args); }
      finally { fecha.value = valor; }
    }
    return original.apply(this, args);
  };
  wrapper.__smDateSafety = true;
  window.saveOrden = wrapper;
}

/* El blanqueamiento se muestra únicamente en el servicio donde quedó
 * persistido en registroServicios[servicio].blanqueamiento. Esto evita que
 * el campo legacy item.blanqueamiento lo haga aparecer en todos los servicios. */
function servicioDeCard(card) {
  const txt = card.textContent || '';
  return ['Pintado y personalizado', 'Secado y detallado', 'Lavado'].find(s => txt.includes(s)) || '';
}
function blanqueamientoExacto(codigo, servicio) {
  const item = (state.ordenItems || []).find(x => x.codigo === codigo);
  return !!item?.registroServicios?.[servicio]?.blanqueamiento;
}
function corregirEtiquetasBlanqueamiento(root=document) {
  root.querySelectorAll('.prod-card').forEach(card => {
    const codigo = (card.querySelector('.mono')?.textContent || '').trim();
    const servicio = servicioDeCard(card);
    if (!codigo || !servicio) return;
    [...card.querySelectorAll('div')].forEach(el => {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Blanqueamiento: Sí' && !blanqueamientoExacto(codigo, servicio)) {
        el.remove();
      }
    });
  });
}

function registroPropio(r) {
  const s = state.session || {};
  if (r.usuarioId && s.userId) return r.usuarioId === s.userId;
  return (r.empleado || '') === (s.user || '');
}
function mapRegistroDb(r) {
  const urls = Array.isArray(r.foto_urls) && r.foto_urls.length ? r.foto_urls : (r.foto_url ? [r.foto_url] : []);
  return {
    id: r.id, empleado: r.empleado || '', fecha: r.fecha || '', pares: Number(r.pares) || 0,
    fotoUrls: urls, fotoUrl: urls[0] || '', usuarioId: r.usuario_id || null,
    codigo: r.codigo || '', servicio: r.servicio || '', hora: r.hora || '', observacion: r.observacion || ''
  };
}
function claveRegistro(r) { return (r.fecha || '') + 'T' + (r.hora || '00:00'); }

function renderHistorialSeguro(registros, desde, hasta) {
  const out = document.getElementById('prod-historial');
  if (!out) return;
  registros.sort((a,b) => claveRegistro(b).localeCompare(claveRegistro(a)));
  out.innerHTML = '<div class="hint" style="margin-bottom:8px">' + registros.length + ' registro(s) · ' + fmtDate(desde) + ' → ' + fmtDate(hasta) + '</div>' +
    (registros.length ? '<div class="prod-grid">' + registros.map(r => {
      const fotos = Array.isArray(r.fotoUrls) ? r.fotoUrls : [];
      const foto = fotos[0]
        ? '<img src="' + escAttr(fotos[0]) + '" loading="lazy" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px">'
        : '<div class="empty-state" style="padding:18px">Sin foto</div>';
      const bl = blanqueamientoExacto(r.codigo, r.servicio)
        ? '<div style="font-size:11px;font-weight:800;margin-top:3px">Blanqueamiento: Sí</div>' : '';
      return '<div class="prod-card">' + foto + '<div style="padding:6px">' +
        '<div><strong>' + escHtml(r.empleado || '—') + '</strong>' +
        (r.codigo ? ' · <span class="mono">' + escHtml(r.codigo) + '</span>' : '') +
        (r.servicio ? ' · ' + escHtml(r.servicio) : '') + '</div>' +
        '<div class="hint">' + fmtDate(r.fecha) + (r.hora ? ' · ' + escHtml(r.hora) : '') + (fotos.length ? ' · ' + fotos.length + ' foto(s)' : '') + '</div>' +
        bl + (r.observacion ? '<div class="hint" style="white-space:pre-line">📝 ' + escHtml(r.observacion) + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>' : '<div class="hint">Sin registros en el rango.</div>');
}

/* Historial por rango consultado directamente en la tabla existente.
 * Así no depende del límite de 500 registros de la carga inicial de state. */
async function cargarHistorialProduccionSeguro() {
  const out = document.getElementById('prod-historial');
  if (!out) return;
  const desde = document.getElementById('sm-pdesde')?.value || todayISO(0);
  const hasta = document.getElementById('sm-phasta')?.value || todayISO(0);
  if (desde > hasta) { out.innerHTML = '<div class="hint">Rango de fechas inválido.</div>'; return; }
  out.innerHTML = '<div class="hint">Cargando historial…</div>';

  const selector = document.getElementById('sm-pemp');
  const empleadoFiltro = !esEmpleado() ? (selector?.value || '') : '';
  let registros = [];
  try {
    if (!supabase) throw new Error('Sin conexión a Supabase');
    const base = () => supabase.from('registro_pares')
      .select('id,empleado,fecha,pares,foto_url,foto_urls,usuario_id,codigo,servicio,hora,observacion,created_at')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending:false }).order('created_at', { ascending:false }).limit(3000);

    if (esEmpleado()) {
      const uid = state.session?.userId || '';
      const nombre = state.session?.user || '';
      const consultas = [];
      if (uid) consultas.push(base().eq('usuario_id', uid));
      if (nombre) consultas.push(base().is('usuario_id', null).eq('empleado', nombre));
      const respuestas = await Promise.all(consultas);
      const error = respuestas.find(x => x.error)?.error;
      if (error) throw error;
      const porId = new Map();
      respuestas.flatMap(x => x.data || []).forEach(r => porId.set(r.id, r));
      registros = [...porId.values()].map(mapRegistroDb).filter(registroPropio);
    } else {
      let q = base();
      if (empleadoFiltro) q = q.eq('empleado', empleadoFiltro);
      const { data, error } = await q;
      if (error) throw error;
      registros = (data || []).map(mapRegistroDb);
      if (!empleadoFiltro && selector) {
        const actual = selector.value;
        const nombres = [...new Set(registros.map(r => r.empleado).filter(Boolean))].sort();
        selector.innerHTML = '<option value="">Todos los usuarios</option>' + nombres.map(n => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join('');
        if (nombres.includes(actual)) selector.value = actual;
      }
    }
  } catch (e) {
    console.warn('Historial remoto no disponible; usando caché local:', e?.message || e);
    registros = (state.registroPares || []).filter(r => r.fecha >= desde && r.fecha <= hasta);
    if (esEmpleado()) registros = registros.filter(registroPropio);
    else if (empleadoFiltro) registros = registros.filter(r => r.empleado === empleadoFiltro);
  }
  renderHistorialSeguro(registros, desde, hasta);
}

function enlazarHistorialProduccion() {
  window.renderHistorialProduccion = cargarHistorialProduccionSeguro;
  const buscar = document.getElementById('sm-pgo');
  if (buscar) buscar.onclick = cargarHistorialProduccionSeguro;
  const selector = document.getElementById('sm-pemp');
  if (selector) selector.onchange = cargarHistorialProduccionSeguro;
}

function envolverProduccion() {
  const original = window.registrarPares;
  if (typeof original !== 'function' || original.__smSafetyProd) return;
  const wrapper = async function(...args) {
    const r = await original.apply(this, args);
    corregirEtiquetasBlanqueamiento();
    enlazarHistorialProduccion();
    return r;
  };
  wrapper.__smSafetyProd = true;
  window.registrarPares = wrapper;
}

function envolverNavegacion() {
  const original = window.switchTab;
  if (typeof original !== 'function' || original.__smSafetyTab) return;
  const wrapper = function(tab, ...args) {
    const r = original.call(this, tab, ...args);
    if (tab === 'produccion') {
      enlazarHistorialProduccion();
      corregirEtiquetasBlanqueamiento();
    }
    return r;
  };
  wrapper.__smSafetyTab = true;
  window.switchTab = wrapper;
}
