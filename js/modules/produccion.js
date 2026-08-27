/* ============================================================
   MÓDULO: PRODUCCIÓN
   Registro de cuántos pares lavó/detalló/pintó cada empleado, con fotos
   de respaldo (varias por registro). Cuando el registro va ligado a un
   par (código orden-par), sus fotos también quedan vinculadas a la
   Galería de esa orden, en la categoría del servicio realizado (ver
   SERVICIO_A_GALERIA_CAT en galeria.js). Suma automática por empleado
   y por día, avisa al llegar a 50 pares en el día, y ofrece un
   historial por fecha para usar como respaldo de pago (semanal o
   de fin de mes).
   ============================================================ */
import { state, todayISO, persist, esEmpleado } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtDate, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as storageManager from '../storage-manager.js';
import { SERVICIO_A_ESTADO_ITEM, sincronizarEstadoOrdenDesdeItems } from './items.js';
import { SERVICIO_A_GALERIA_CAT, vincularFotoGaleria } from './galeria.js';

const META_DIARIA = 50;
const MAX_FOTOS_POR_REGISTRO = 100;

/** ¿Este registro de pares pertenece al usuario en sesión?
 *  Se compara por id de usuario y, como respaldo (registros antiguos
 *  sin usuario_id), por el nombre del empleado. */
export function esRegistroPropio(r) {
  const s = state.session || {};
  if (r.usuarioId && s.userId) return r.usuarioId === s.userId;
  return (r.empleado || '') === (s.user || '');
}

export function renderProduccion() {
  const fechaEl = document.getElementById('prod-fecha');
  if (fechaEl && !fechaEl.value) fechaEl.value = todayISO(0);
  const histEl = document.getElementById('prod-historial-fecha');
  if (histEl && !histEl.value) histEl.value = todayISO(0);

  // La producción siempre queda a nombre del usuario que está registrando.
  // El campo es solo informativo y no se puede editar ni sustituir por otro nombre.
  const empEl = document.getElementById('prod-empleado');
  if (empEl) {
    empEl.value = (state.session && state.session.user) || '';
    empEl.readOnly = true;
  }

  const hoy = todayISO(0);
  let registrosHoy = (state.registroPares || []).filter(r => r.fecha === hoy);
  // El empleado solo ve SUS propios registros de HOY (no los de otros ni de
  // otros días). Supervisor y administrador ven todo.
  if (esEmpleado()) registrosHoy = registrosHoy.filter(esRegistroPropio);
  renderResumenPares('prod-kpi-grid', 'prod-lista', registrosHoy, { permitirEliminar: true, tituloVacio: 'Todavía no hay artículos registrados hoy.' });

  // El historial por fecha (respaldo de pagos) es solo para supervisor/admin.
  const histPanel = document.getElementById('prod-historial-panel');
  if (histPanel) histPanel.style.display = esEmpleado() ? 'none' : '';
  if (!esEmpleado()) { poblarFiltroEmpleadoProduccion(); renderHistorialProduccion(); }
}

/** Llena el selector "Todos los empleados" del historial con los nombres
 *  que realmente registraron pares (no hace falta ir a buscar la lista de
 *  empleados: alcanza con lo que ya hay en state.registroPares), para que
 *  el administrador pueda ver el respaldo de fotos de UN solo empleado a
 *  la vez y no se le mezclen con las de los demás al verificar cuántos
 *  pares hizo cada uno. */
function poblarFiltroEmpleadoProduccion() {
  const sel = document.getElementById('prod-historial-empleado');
  if (!sel) return;
  const actual = sel.value;
  const nombres = Array.from(new Set((state.registroPares || []).map(r => r.empleado).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">Todos los empleados</option>' + nombres.map(n => '<option value="' + escAttr(n) + '"' + (n === actual ? ' selected' : '') + '>' + escHtml(n) + '</option>').join('');
  if (nombres.includes(actual)) sel.value = actual;
}

/** Arma el bloque de KPIs + tarjetas de fotos para un conjunto de
 *  registros (se reutiliza para "hoy" y para el historial por fecha). */
function renderResumenPares(kpiElId, listaElId, registros, opts) {
  opts = opts || {};
  const total = registros.reduce((sum, r) => sum + Number(r.pares || 0), 0);
  const totalFotos = registros.reduce((sum, r) => sum + (Array.isArray(r.fotoUrls) ? r.fotoUrls.length : 0), 0);

  const porEmpleado = {};
  registros.forEach(r => { porEmpleado[r.empleado] = (porEmpleado[r.empleado] || 0) + Number(r.pares || 0); });
  const rankingHtml = Object.keys(porEmpleado).length
    ? Object.entries(porEmpleado).sort((a, b) => b[1] - a[1]).map(([nombre, cant]) =>
        '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>' + escHtml(nombre) + '</span><strong>' + cant + '</strong></div>'
      ).join('')
    : '<div class="hint">Sin registros por empleado.</div>';

  const kpiGrid = kpiElId && document.getElementById(kpiElId);
  if (kpiGrid) {
    kpiGrid.innerHTML =
      '<div class="kpi-card"><div class="kpi-label">Artículos registrados</div><div class="kpi-value">' + total + (total >= META_DIARIA ? ' 🎉' : '') + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Fotos de respaldo</div><div class="kpi-value">' + totalFotos + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Por usuario</div><div style="padding-top:4px;">' + rankingHtml + '</div></div>';
  }

  const lista = listaElId && document.getElementById(listaElId);
  if (lista) {
    lista.innerHTML = registros.length ? '<div class="prod-grid">' + registros.slice().reverse().map(r => {
      const fotos = Array.isArray(r.fotoUrls) ? r.fotoUrls : (r.fotoUrl ? [r.fotoUrl] : []);
      const primeraFoto = fotos[0];
      const extra = fotos.length > 1 ? '<div class="hint" style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border-radius:4px;padding:1px 6px;">+' + (fotos.length - 1) + '</div>' : '';
      return '<div class="prod-card">' +
        (primeraFoto
          ? '<div style="position:relative;"><img src="' + escHtml(primeraFoto) + '" loading="lazy" onclick="ampliarImagen(\'' + escHtml(primeraFoto) + '\', ' + escAttr(JSON.stringify(fotos)) + ')">' + extra + '</div>'
          : '<div class="empty-state" style="padding:20px;"><div class="big">👟</div>Sin foto</div>') +
        '<div style="padding:6px 4px;">' +
          '<div><strong>' + escHtml(r.empleado) + '</strong>' + (r.codigo ? ' · <span class="mono">' + escHtml(r.codigo) + '</span>' : '') + (r.servicio ? ' · ' + escHtml(r.servicio) : '') + '</div>' +
          '<div class="hint">' + r.pares + ' ' + (Number(r.pares) === 1 ? 'artículo' : 'artículos') + ' · ' + fmtDate(r.fecha) + (fotos.length ? ' · ' + fotos.length + ' foto(s)' : '') + '</div>' +
          (opts.permitirEliminar && state.session && state.session.role === 'Administrador' ? '<button class="btn btn-ghost btn-sm" style="color:var(--red);margin-top:4px;" onclick="eliminarRegistroPar(\'' + r.id + '\')">Eliminar</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>' : '<div class="hint">' + (opts.tituloVacio || 'Sin registros.') + '</div>';
  }
}

/** Muestra cuántas fotos se eligieron antes de registrar (feedback al lavador
 *  cuando sube 50-100 fotos de golpe). */
export function mostrarConteoFotosProduccion() {
  const fileInput = document.getElementById('prod-foto');
  const conteoEl = document.getElementById('prod-foto-conteo');
  if (!fileInput || !conteoEl) return;
  const n = fileInput.files ? fileInput.files.length : 0;
  if (n > MAX_FOTOS_POR_REGISTRO) {
    conteoEl.textContent = n + ' fotos seleccionadas — el máximo es ' + MAX_FOTOS_POR_REGISTRO + ', se subirán solo las primeras ' + MAX_FOTOS_POR_REGISTRO + '.';
  } else {
    conteoEl.textContent = n ? n + ' foto(s) seleccionada(s)' : '';
  }
}

export async function registrarPares(btn) {
  // El empleado siempre registra a su propio nombre (aunque manipule el input).
  const empleado = (state.session && state.session.user) || '';
  const fecha = document.getElementById('prod-fecha').value || todayISO(0);
  const fileInput = document.getElementById('prod-foto');
  const files = fileInput && fileInput.files ? Array.from(fileInput.files).slice(0, MAX_FOTOS_POR_REGISTRO) : [];

  if (!empleado) { showToast('No se pudo identificar al usuario que registra'); return; }

  // --- Modo por NÚMERO DE PAR -------------------------------------------
  // Si el empleado escribe el número del par que agarró (ej. 12-1), el
  // registro queda ligado a ese par + servicio, se contabiliza a su nombre
  // y NO se puede repetir el mismo par para el mismo servicio (si alguien
  // ya lo lavó, solo queda disponible para detallar, etc.). Un par cuenta
  // como 1.
  const codigoInput = document.getElementById('prod-codigo');
  const codigo = codigoInput ? codigoInput.value.trim() : '';
  const servicio = (document.getElementById('prod-servicio') || {}).value || '';
  let pares;

  if (codigo) {
    // Normaliza posibles variantes (# o espacios) → "12-1".
    const codigoNorm = codigo.replace(/[#\s]/g, '');
    const item = (state.ordenItems || []).find(it => (it.codigo || '') === codigoNorm);
    if (!item) { showToast('No existe el artículo ' + codigoNorm + '. Revisa el número (formato orden-artículo, ej. 12-1).'); return; }
    if (!servicio) { showToast('Elige el servicio que le hiciste al artículo'); return; }
    // Anti-repetición POR SERVICIO: ¿ya hay un registro de este par para
    // este mismo servicio? (de cualquier empleado)
    const yaRegistrado = (state.registroPares || []).find(r => (r.codigo || '') === codigoNorm && (r.servicio || '') === servicio);
    if (yaRegistrado) {
      showToast('El artículo ' + codigoNorm + ' ya fue registrado para "' + servicio + '"' + (yaRegistrado.empleado ? ' por ' + yaRegistrado.empleado : '') + '. Solo queda disponible para otro servicio.');
      return;
    }
    pares = 1;
  } else {
    // --- Modo cantidad libre (compatibilidad con lo anterior) ---
    pares = Number(document.getElementById('prod-pares').value) || 0;
    if (!pares || pares <= 0) { showToast('Indica cuántos artículos se registran (o escribe el número de artículo)'); return; }
  }

  const hoyAntes = todayISO(0);
  const totalAntes = (state.registroPares || []).filter(r => r.fecha === hoyAntes).reduce((s, r) => s + Number(r.pares || 0), 0);
  const restore = lockBtn(btn, 'Registrando…');   // evita doble registro mientras suben las fotos

  try {
    const fotoUrls = [];
    if (files.length) {
      const timestamp = Date.now();
      for (let i = 0; i < files.length; i++) {
        showToast('Subiendo foto ' + (i + 1) + ' de ' + files.length + '…');
        const file = files[i];
        const ext = (file.name.split('.').pop() || 'jpg');
        const result = await storageManager.uploadFile(file, 'produccion', 'pares_' + timestamp + '_' + i + '.' + ext);
        fotoUrls.push(result.url);
      }
    }

    const registro = { id: crypto.randomUUID(), empleado, fecha, pares, fotoUrls, fotoUrl: fotoUrls[0] || '', usuarioId: (state.session && state.session.userId) || null, codigo: codigo ? codigo.replace(/[#\s]/g, '') : null, servicio: codigo ? servicio : null };
    if (!Array.isArray(state.registroPares)) state.registroPares = [];
    state.registroPares.push(registro);
    await db.saveRegistroPar(registro);

    // En modo por número de par: el par queda a nombre de quien lo agarró
    // (responsable) y su estado de taller (pares individuales) avanza al
    // que le corresponde al servicio realizado (ver SERVICIO_A_ESTADO_ITEM).
    // Este vínculo es exclusivo: Producción ↔ pares individuales (it.estado)
    // ↔ estado de la orden (vía sincronizarEstadoOrdenDesdeItems) — y nada
    // más. Nunca toca el seguimiento en tiempo real del par (timelineIndex/
    // timelineDates), que es un flujo completamente aparte, vinculado solo
    // con el estado de la orden por su propio camino (ver
    // sincronizarEstadoOrdenDesdeTimelinePares en ordenes.js).
    if (registro.codigo) {
      const item = (state.ordenItems || []).find(it => (it.codigo || '') === registro.codigo);
      if (item) {
        item.responsable = empleado;
        const nuevoEstado = SERVICIO_A_ESTADO_ITEM[servicio];
        if (nuevoEstado) item.estado = nuevoEstado;
        try {
          await db.saveOrdenItem(item);
          await sincronizarEstadoOrdenDesdeItems(item.ordenId);
        } catch (e) { console.error('No se pudo actualizar el artículo:', e); }
        // Vincula las fotos que se acaban de subir (del lavador, el
        // detallista o el pintor) a la Galería de la orden del artículo, en
        // la categoría que le corresponde a este servicio — así aparecen
        // también ahí, sin tener que volver a subirlas a mano. Se pasa
        // item.id para que la foto quede asociada estrictamente a ESTE
        // artículo y no se mezcle con las de otros artículos de la misma
        // orden al buscar por número de artículo individual en la Galería.
        const catGaleria = SERVICIO_A_GALERIA_CAT[servicio];
        if (catGaleria && fotoUrls.length) {
          try { await vincularFotoGaleria(item.ordenId, catGaleria, fotoUrls, item.id); }
          catch (e) { console.error('No se pudo vincular las fotos a la Galería:', e); }
        }
        if (window.renderOrdenes) window.renderOrdenes();
      }
    }

    logActivity('Registró ' + (registro.codigo ? 'el artículo ' + registro.codigo + ' (' + servicio + ')' : pares + ' ' + (pares === 1 ? 'artículo' : 'artículos')) + ' — ' + empleado + (fotoUrls.length ? ' (' + fotoUrls.length + ' foto(s))' : ''));
    await persist();

    document.getElementById('prod-empleado').value = '';
    document.getElementById('prod-pares').value = '1';
    if (codigoInput) codigoInput.value = '';
    if (fileInput) fileInput.value = '';
    const conteoEl = document.getElementById('prod-foto-conteo');
    if (conteoEl) conteoEl.textContent = '';

    renderProduccion();
    showToast('Artículos registrados ✓');

    // Aviso al llegar a 50 pares en el día (solo una vez, cuando se cruza el umbral).
    if (fecha === hoyAntes) {
      const totalDespues = totalAntes + pares;
      if (totalAntes < META_DIARIA && totalDespues >= META_DIARIA) {
        showToast('🎉 ¡Ya se registraron ' + META_DIARIA + ' artículos hoy!');
        db.createNotification({
          tipo: 'produccion',
          texto: '🎉 Ya se registraron ' + META_DIARIA + ' artículos hoy en el sistema.',
          prioridad: 'Media',
          leida: false
        }).catch(e => console.error('No se pudo registrar la notificación de meta diaria:', e));
      }
    }
  } catch (e) {
    console.error('Error al registrar artículos:', e);
    showToast('No se pudo registrar: ' + (e.message || 'error desconocido'));
  } finally { restore(); }
}

export async function eliminarRegistroPar(id) {
  if (!(state.session && state.session.role === 'Administrador')) { showToast('Solo el Administrador puede eliminar registros'); return; }
  if (!confirm('¿Eliminar este registro de artículos?')) return;
  if (!Array.isArray(state.registroPares)) state.registroPares = [];
  const backup = state.registroPares.slice();
  state.registroPares = state.registroPares.filter(r => r.id !== id);
  renderProduccion();
  const res = await db.deleteRegistroPar(id);
  if (res && res.error && !res.queued) {
    state.registroPares = backup;
    renderProduccion();
    showToast('No se pudo eliminar: ' + (res.error.message || 'error del servidor'));
    return;
  }
  await persist();
  showToast('Registro eliminado');
}

/* ---------------- Historial de producción por fecha ----------------
   Respaldo para el administrador: elegir cualquier fecha (o los
   últimos 7 días) y ver cuántos pares se registraron, por quién, con
   sus fotos — para pagar la semana o el mes con ese respaldo. */
export function renderHistorialProduccion() {
  const fechaEl = document.getElementById('prod-historial-fecha');
  const empEl = document.getElementById('prod-historial-empleado');
  const cont = document.getElementById('prod-historial');
  if (!cont) return;
  const fecha = fechaEl ? fechaEl.value : todayISO(0);
  const empleado = empEl ? empEl.value : '';
  if (!fecha) { cont.innerHTML = '<div class="hint">Elige una fecha para ver el historial.</div>'; return; }
  let registros = (state.registroPares || []).filter(r => r.fecha === fecha);
  if (empleado) registros = registros.filter(r => r.empleado === empleado);
  cont.innerHTML = '<div style="margin-bottom:8px;font-weight:700;">' + fmtDate(fecha) + (empleado ? ' · ' + escHtml(empleado) : '') + '</div><div id="prod-historial-kpi" class="kpi-grid" style="margin-bottom:12px;"></div><div id="prod-historial-lista"></div>';
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en esta fecha' + (empleado ? ' para ' + empleado : '') + '.' });
}

/** Atajo: junta los últimos 7 días (incluyendo hoy) en un solo resumen,
 *  útil para el pago de fin de semana. Respeta el empleado elegido en el
 *  filtro, si hay uno. */
export function verSemanaProduccion() {
  const cont = document.getElementById('prod-historial');
  if (!cont) return;
  const dias = [];
  for (let i = 6; i >= 0; i--) dias.push(todayISO(-i));
  const set = new Set(dias);
  const empEl = document.getElementById('prod-historial-empleado');
  const empleado = empEl ? empEl.value : '';
  let registros = (state.registroPares || []).filter(r => set.has(r.fecha));
  if (empleado) registros = registros.filter(r => r.empleado === empleado);
  const fechaEl = document.getElementById('prod-historial-fecha');
  if (fechaEl) fechaEl.value = '';
  cont.innerHTML = '<div style="margin-bottom:8px;font-weight:700;">Últimos 7 días (' + fmtDate(dias[0]) + ' — ' + fmtDate(dias[dias.length - 1]) + ')' + (empleado ? ' · ' + escHtml(empleado) : '') + '</div><div id="prod-historial-kpi" class="kpi-grid" style="margin-bottom:12px;"></div><div id="prod-historial-lista"></div>';
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en los últimos 7 días' + (empleado ? ' para ' + empleado : '') + '.' });
}

/** Atajo: junta los últimos 31 días (incluyendo hoy) en un solo resumen,
 *  útil para pagar a empleados que cobran por mes o por quincena. Respeta
 *  el empleado elegido en el filtro, si hay uno. */
export function verMesProduccion() {
  const cont = document.getElementById('prod-historial');
  if (!cont) return;
  const dias = [];
  for (let i = 30; i >= 0; i--) dias.push(todayISO(-i));
  const set = new Set(dias);
  const empEl = document.getElementById('prod-historial-empleado');
  const empleado = empEl ? empEl.value : '';
  let registros = (state.registroPares || []).filter(r => set.has(r.fecha));
  if (empleado) registros = registros.filter(r => r.empleado === empleado);
  const fechaEl = document.getElementById('prod-historial-fecha');
  if (fechaEl) fechaEl.value = '';
  cont.innerHTML = '<div style="margin-bottom:8px;font-weight:700;">Últimos 31 días (' + fmtDate(dias[0]) + ' — ' + fmtDate(dias[dias.length - 1]) + ')' + (empleado ? ' · ' + escHtml(empleado) : '') + '</div><div id="prod-historial-kpi" class="kpi-grid" style="margin-bottom:12px;"></div><div id="prod-historial-lista"></div>';
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en los últimos 31 días' + (empleado ? ' para ' + empleado : '') + '.' });
}

Object.assign(window, {
  renderProduccion, registrarPares, eliminarRegistroPar,
  mostrarConteoFotosProduccion, renderHistorialProduccion, verSemanaProduccion, verMesProduccion
});
