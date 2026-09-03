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
import { state, todayISO, persist, esEmpleado, esAdmin, esSupervisor } from '../state.js';
import * as db from '../db.js';
import { showToast, fmtDate, logActivity, lockBtn } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as storageManager from '../storage-manager.js';
import { SERVICIO_A_ESTADO_ITEM, sincronizarEstadoOrdenDesdeItems, renderItemCardHTML } from './items.js';
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
  // Vista de "hoy": se ven las fotos de los registros del día. El nombre del
  // empleado que registró es visible siempre para el administrador (y para el
  // propio empleado, que solo ve lo suyo); para el supervisor queda oculto en
  // esta vista y solo aparece cuando filtra por una fecha en el historial.
  renderResumenPares('prod-kpi-grid', 'prod-lista', registrosHoy, {
    permitirEliminar: true,
    tituloVacio: 'Todavía no hay artículos registrados hoy.',
    mostrarFotos: true,
    mostrarEmpleado: puedeVerEmpleadoProd(false)
  });

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

/** ¿Debe mostrarse el nombre del empleado que registró?
 *  - Administrador: siempre (y el propio empleado, que solo ve lo suyo).
 *  - Supervisor: solo cuando hay una fecha de filtro seleccionada
 *    (en el historial), nunca en la vista de "hoy" ni en los resúmenes
 *    de rango (semana / mes). */
function puedeVerEmpleadoProd(hayFecha) {
  if (esAdmin() || esEmpleado()) return true;
  if (esSupervisor()) return !!hayFecha;
  return true;
}

/** Arma el bloque de KPIs + tarjetas de fotos para un conjunto de
 *  registros (se reutiliza para "hoy" y para el historial por fecha).
 *  opts.mostrarFotos  (default true): si es false, oculta las miniaturas
 *    de fotos de las tarjetas (se sigue mostrando el resto de la info).
 *  opts.mostrarEmpleado (default true): si es false, oculta el nombre del
 *    empleado que registró (tarjetas y ranking por usuario). */
function renderResumenPares(kpiElId, listaElId, registros, opts) {
  opts = opts || {};
  const mostrarFotos = opts.mostrarFotos !== false;
  const mostrarEmpleado = opts.mostrarEmpleado !== false;
  const total = registros.reduce((sum, r) => sum + Number(r.pares || 0), 0);
  const totalFotos = registros.reduce((sum, r) => sum + (Array.isArray(r.fotoUrls) ? r.fotoUrls.length : 0), 0);

  const porEmpleado = {};
  registros.forEach(r => { porEmpleado[r.empleado] = (porEmpleado[r.empleado] || 0) + Number(r.pares || 0); });
  const rankingHtml = !mostrarEmpleado
    ? '<div class="hint">Elige una fecha para ver el detalle por empleado.</div>'
    : (Object.keys(porEmpleado).length
      ? Object.entries(porEmpleado).sort((a, b) => b[1] - a[1]).map(([nombre, cant]) =>
          '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>' + escHtml(nombre) + '</span><strong>' + cant + '</strong></div>'
        ).join('')
      : '<div class="hint">Sin registros por empleado.</div>');

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
      // Bloque de foto: solo se muestra si mostrarFotos está activo (vista de
      // "hoy" o historial filtrado por una fecha específica). En los resúmenes
      // de rango (semana/mes) las miniaturas quedan ocultas.
      const bloqueFoto = !mostrarFotos
        ? '<div class="empty-state" style="padding:20px;"><div class="big">📅</div><div class="hint">— (filtrá por fecha para ver fotos)</div></div>'
        : (primeraFoto
          ? '<div style="position:relative;"><img src="' + escHtml(primeraFoto) + '" loading="lazy" onclick="ampliarImagen(\'' + escHtml(primeraFoto) + '\', ' + escAttr(JSON.stringify(fotos)) + ')">' + extra + '</div>'
          : '<div class="empty-state" style="padding:20px;"><div class="big">👟</div>Sin foto</div>');
      const empleadoHTML = mostrarEmpleado ? '<strong>' + escHtml(r.empleado) + '</strong>' : '<strong>Artículo registrado</strong>';
      return '<div class="prod-card">' +
        bloqueFoto +
        '<div style="padding:6px 4px;">' +
          '<div>' + empleadoHTML + (r.codigo ? ' · <span class="mono">' + escHtml(r.codigo) + '</span>' : '') + (r.servicio ? ' · ' + escHtml(r.servicio) : '') + '</div>' +
          '<div class="hint">' + r.pares + ' ' + (Number(r.pares) === 1 ? 'artículo' : 'artículos') + ' · ' + fmtDate(r.fecha) + (fotos.length ? ' · ' + fotos.length + ' foto(s)' : '') + '</div>' +
          (r.hora ? '<div class="hint">Hora: ' + escHtml(r.hora) + '</div>' : '') +
          (r.observacion ? '<div class="hint" style="white-space:pre-line;">📝 ' + escHtml(r.observacion) + '</div>' : '') +
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

/** Formatea una nota de observación con fecha/hora y quién la escribió, para
 *  que al integrar varias notas en un mismo registro quede claro cuál es
 *  cuál (y quién la agregó) en vez de perder ese rastro al concatenar. */
function formatearNotaObservacion(texto, empleado) {
  const marca = new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return '[' + marca + ' · ' + (empleado || '') + '] ' + texto;
}

/** Al escribir el número de artículo (o cambiar el servicio) en el formulario
 *  de Producción, revisa si ese artículo YA fue registrado para ese mismo
 *  servicio. Si ya existe, precarga en el campo de Observación la nota que
 *  ya estaba guardada (para que se vea lo que ya se anotó) y avisa que
 *  cualquier observación que se escriba ahora se va a INTEGRAR a ese mismo
 *  registro (no se crea uno nuevo). Si no existe, deja el campo libre para
 *  una observación nueva del registro que se está por crear. */
export function revisarRegistroExistente() {
  const codigoInput = document.getElementById('prod-codigo');
  const servicioSel = document.getElementById('prod-servicio');
  const obsInput = document.getElementById('prod-observacion');
  const hintEl = document.getElementById('prod-observacion-hint');
  if (!codigoInput || !obsInput) return;
  const codigoNorm = codigoInput.value.trim().replace(/[#\s]/g, '');
  const servicio = servicioSel ? servicioSel.value : '';

  if (!codigoNorm) {
    if (obsInput.dataset.registroId) { obsInput.value = ''; }
    delete obsInput.dataset.registroId;
    delete obsInput.dataset.original;
    if (hintEl) hintEl.textContent = '';
    return;
  }

  const existente = (state.registroPares || []).find(r => (r.codigo || '') === codigoNorm && (r.servicio || '') === servicio);
  if (existente) {
    obsInput.value = existente.observacion || '';
    obsInput.dataset.registroId = existente.id;
    obsInput.dataset.original = existente.observacion || '';
    if (hintEl) hintEl.textContent = 'El artículo ' + codigoNorm + ' ya fue registrado para "' + servicio + '"' + (existente.empleado ? ' por ' + existente.empleado : '') + '. Si escribes algo aquí, se integra a este registro (no se crea uno nuevo).';
  } else {
    // No borres lo que la persona ya venía escribiendo si todavía no había
    // un registro previo cargado; solo limpia si veníamos de mostrar la
    // observación de OTRO registro existente.
    if (obsInput.dataset.registroId) obsInput.value = '';
    delete obsInput.dataset.registroId;
    delete obsInput.dataset.original;
    if (hintEl) hintEl.textContent = '';
  }
}

/** Integra una nueva observación a un registro de Producción YA EXISTENTE
 *  (mismo artículo + mismo servicio), en vez de crear un registro nuevo:
 *  la nota se agrega debajo de las que ya hubiera (si las hay), con fecha,
 *  hora y quién la escribió, y se guarda como una actualización del mismo
 *  registro (mismo id). No vuelve a sumar al conteo de artículos ni crea
 *  fotos/eventos duplicados. */
async function integrarObservacionEnRegistro(registroExistente, notaNueva, btn) {
  const empleado = (state.session && state.session.user) || '';
  const restore = lockBtn(btn, 'Guardando observación…');
  const backupObservacion = registroExistente.observacion || '';
  try {
    const nota = formatearNotaObservacion(notaNueva, empleado);
    const observacionIntegrada = backupObservacion ? (backupObservacion + '\n' + nota) : nota;
    const idx = (state.registroPares || []).findIndex(r => r.id === registroExistente.id);
    if (idx < 0) { showToast('No se encontró el registro a actualizar'); return; }

    state.registroPares[idx] = Object.assign({}, state.registroPares[idx], { observacion: observacionIntegrada });
    const res = await db.saveRegistroPar(state.registroPares[idx]);
    if (res && res.error && !res.queued) {
      state.registroPares[idx] = Object.assign({}, state.registroPares[idx], { observacion: backupObservacion });
      showToast('No se pudo guardar la observación: ' + (res.error.message || 'error del servidor'));
      return;
    }

    logActivity('Agregó una observación al artículo ' + (registroExistente.codigo || '') + ' (' + (registroExistente.servicio || '') + ') — ' + empleado);
    await persist();

    const obsInput = document.getElementById('prod-observacion');
    if (obsInput) { obsInput.value = ''; delete obsInput.dataset.registroId; delete obsInput.dataset.original; }
    const codigoInput = document.getElementById('prod-codigo');
    if (codigoInput) codigoInput.value = '';
    const hintEl = document.getElementById('prod-observacion-hint');
    if (hintEl) hintEl.textContent = '';
    mostrarInfoArticuloProduccion();

    renderProduccion();
    showToast('Observación agregada ✓');
  } catch (e) {
    console.error('Error al integrar la observación:', e);
    showToast('No se pudo guardar la observación: ' + (e.message || 'error desconocido'));
  } finally { restore(); }
}

/** Se llama con cada tecla que se escribe en "Número de artículo": busca el
 *  artículo y, si existe, muestra su información (cliente, orden, servicios,
 *  responsables ya registrados, fechas) en vivo, en el mismo lugar donde
 *  antes estaba el campo "Cantidad de artículos". Ahora que Producción es
 *  la única pantalla que ve el Empleado (ya no tiene acceso a Órdenes), es
 *  la forma en la que puede confirmar que agarró el artículo correcto antes
 *  de registrar el servicio. */
export function mostrarInfoArticuloProduccion() {
  const wrap = document.getElementById('prod-info-articulo-wrap');
  const cont = document.getElementById('prod-info-articulo');
  if (!wrap || !cont) return;
  const codigoInput = document.getElementById('prod-codigo');
  const codigo = codigoInput ? codigoInput.value.trim().replace(/[#\s]/g, '') : '';
  if (!codigo) { wrap.style.display = 'none'; cont.innerHTML = ''; return; }
  const item = (state.ordenItems || []).find(it => (it.codigo || '') === codigo);
  wrap.style.display = '';
  if (!item) {
    cont.innerHTML = '<div class="hint" style="color:var(--red);">No existe el artículo ' + escHtml(codigo) + '. Revisa el número (formato orden-artículo, ej. 12-1).</div>';
    return;
  }
  cont.innerHTML = renderItemCardHTML(item);
}

export async function registrarPares(btn) {
  // El empleado siempre registra a su propio nombre (aunque manipule el input).
  const empleado = (state.session && state.session.user) || '';
  const fecha = document.getElementById('prod-fecha').value || todayISO(0);
  const fileInput = document.getElementById('prod-foto');
  const files = fileInput && fileInput.files ? Array.from(fileInput.files).slice(0, MAX_FOTOS_POR_REGISTRO) : [];

  if (!empleado) { showToast('No se pudo identificar al usuario que registra'); return; }

  // --- Registro por NÚMERO DE ARTÍCULO (obligatorio) ---------------------
  // Ya no existe el modo "cantidad libre": todo registro de Producción
  // tiene que ir ligado a un artículo real de una orden. Esto evita que
  // se sumen servicios "sueltos", sin orden detrás, que no se pueden
  // rastrear ni cobrar. El registro queda ligado a ese par + servicio, se
  // contabiliza a nombre de quien lo registra, y NO se puede repetir el
  // mismo par para el mismo servicio (si alguien ya lo lavó, solo queda
  // disponible para detallar, etc.).
  const codigoInput = document.getElementById('prod-codigo');
  const codigo = codigoInput ? codigoInput.value.trim() : '';
  const servicio = (document.getElementById('prod-servicio') || {}).value || '';
  const blanqueamientoChk = document.getElementById('prod-blanqueamiento');
  const blanqueamiento = blanqueamientoChk ? !!blanqueamientoChk.checked : false;
  const obsInput = document.getElementById('prod-observacion');
  const observacionTexto = obsInput ? obsInput.value.trim() : '';

  if (!codigo) { showToast('Escribe el número de artículo (ej. 12-1). No se puede registrar un servicio sin una orden.'); return; }

  // Normaliza posibles variantes (# o espacios) → "12-1".
  const codigoNorm = codigo.replace(/[#\s]/g, '');
  const item = (state.ordenItems || []).find(it => (it.codigo || '') === codigoNorm);
  if (!item) { showToast('No existe el artículo ' + codigoNorm + '. Revisa el número (formato orden-artículo, ej. 12-1).'); return; }
  if (!servicio) { showToast('Elige el servicio que le hiciste al artículo'); return; }
  // Anti-repetición POR SERVICIO: ¿ya hay un registro de este par para
  // este mismo servicio? (de cualquier empleado)
  const yaRegistrado = (state.registroPares || []).find(r => (r.codigo || '') === codigoNorm && (r.servicio || '') === servicio);
  if (yaRegistrado) {
    // El artículo+servicio ya estaba registrado: no se crea un registro
    // nuevo ni se vuelve a contar. Si la persona escribió algo NUEVO en
    // Observación, esa nota se INTEGRA (se agrega) al registro que ya
    // existe — es la única edición permitida sobre un registro ya creado.
    // Como el campo se precarga con la observación anterior (ver
    // revisarRegistroExistente), acá se compara contra ese texto original
    // para no volver a guardar la misma nota de nuevo si la persona no le
    // agregó nada.
    const observacionOriginal = obsInput && obsInput.dataset ? (obsInput.dataset.original || '') : '';
    let notaNueva = observacionTexto;
    if (observacionOriginal && notaNueva.startsWith(observacionOriginal)) {
      notaNueva = notaNueva.slice(observacionOriginal.length).trim();
    } else if (observacionOriginal && notaNueva === observacionOriginal) {
      notaNueva = '';
    }
    if (!notaNueva) {
      showToast('El artículo ' + codigoNorm + ' ya fue registrado para "' + servicio + '"' + (yaRegistrado.empleado ? ' por ' + yaRegistrado.empleado : '') + '. Escribe una observación NUEVA si notaste algo con el artículo, o elige otro servicio.');
      return;
    }
    await integrarObservacionEnRegistro(yaRegistrado, notaNueva, btn);
    return;
  }
  const pares = 1;

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
        const result = await storageManager.uploadImageFile(file, 'produccion', 'pares_' + timestamp + '_' + i + '.' + ext);
        fotoUrls.push(result.url);
      }
    }

    const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const observacionInicial = observacionTexto ? formatearNotaObservacion(observacionTexto, empleado) : null;
    const registro = { id: crypto.randomUUID(), empleado, fecha, hora, pares, fotoUrls, fotoUrl: fotoUrls[0] || '', usuarioId: (state.session && state.session.userId) || null, codigo: codigoNorm, servicio, observacion: observacionInicial };
    if (!Array.isArray(state.registroPares)) state.registroPares = [];
    state.registroPares.push(registro);
    const guardado = await db.saveRegistroPar(registro);
    // El chequeo de "yaRegistrado" de arriba es solo del lado del cliente,
    // contra la copia local de los datos: si dos personas registran casi
    // al mismo tiempo el mismo par para el mismo servicio (o la copia
    // local todavía no se había actualizado), ambos podían pasar esa
    // validación. La base de datos tiene un índice único que sí lo
    // rechaza (ver migración 023); si eso pasa, hay que deshacer el
    // registro en esta pantalla en vez de mostrarlo como guardado.
    if (guardado && guardado.error && !guardado.queued) {
      state.registroPares = state.registroPares.filter(r => r.id !== registro.id);
      await persist();
      showToast('El artículo ' + registro.codigo + ' ya fue registrado para "' + servicio + '" (lo hizo otra persona justo antes). Elige otro servicio.');
      renderProduccion();
      return;
    }

    // El par siempre queda a nombre de quien lo agarró (responsable) y su
    // estado de taller (pares individuales) avanza al que le corresponde al
    // servicio realizado (ver SERVICIO_A_ESTADO_ITEM). Este vínculo es
    // exclusivo: Producción ↔ pares individuales (it.estado) ↔ estado de la
    // orden (vía sincronizarEstadoOrdenDesdeItems) — y nada más. Nunca toca
    // el seguimiento en tiempo real del par (timelineIndex/timelineDates),
    // que es un flujo completamente aparte, vinculado solo con el estado de
    // la orden por su propio camino (ver sincronizarEstadoOrdenDesdeTimelinePares
    // en ordenes.js).
    {
      const itemActualizado = (state.ordenItems || []).find(it => (it.codigo || '') === registro.codigo);
      if (itemActualizado) {
        itemActualizado.responsable = empleado;
        // Registro FIJO por servicio: a diferencia de item.responsable (que
        // se sobrescribe cada vez que se registra un servicio distinto en
        // este mismo artículo), acá queda uno por servicio y no se pisan
        // entre sí. Así, en el Detalle de la orden se ve, uno debajo del
        // otro, quién hizo el Lavado, quién el Secado y detallado y quién
        // el Pintado y personalizado — cada uno con su propio nombre fijo.
        if (!itemActualizado.registroServicios || typeof itemActualizado.registroServicios !== 'object') itemActualizado.registroServicios = {};
        itemActualizado.registroServicios[servicio] = { responsable: empleado, fecha };
        // Blanqueamiento: se guarda como campo propio del artículo.
        // Solo se escribe si el checkbox está marcado (no se desmarca
        // si en un servicio posterior no está chequeado — queda fijo).
        if (blanqueamiento) itemActualizado.blanqueamiento = true;
        const nuevoEstado = SERVICIO_A_ESTADO_ITEM[servicio];
        if (nuevoEstado) itemActualizado.estado = nuevoEstado;
        try {
          await db.saveOrdenItem(itemActualizado);
          await sincronizarEstadoOrdenDesdeItems(itemActualizado.ordenId);
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
          try { await vincularFotoGaleria(itemActualizado.ordenId, catGaleria, fotoUrls, itemActualizado.id); }
          catch (e) { console.error('No se pudo vincular las fotos a la Galería:', e); }
        }
        if (window.renderOrdenes) window.renderOrdenes();
      }
    }

    logActivity('Registró el artículo ' + registro.codigo + ' (' + servicio + ') — ' + empleado + (fotoUrls.length ? ' (' + fotoUrls.length + ' foto(s))' : ''));
    await persist();

    document.getElementById('prod-empleado').value = '';
    if (codigoInput) codigoInput.value = '';
    if (fileInput) fileInput.value = '';
    if (obsInput) { obsInput.value = ''; delete obsInput.dataset.registroId; delete obsInput.dataset.original; }
    if (blanqueamientoChk) blanqueamientoChk.checked = false;
    const hintEl = document.getElementById('prod-observacion-hint');
    if (hintEl) hintEl.textContent = '';
    const conteoEl = document.getElementById('prod-foto-conteo');
    if (conteoEl) conteoEl.textContent = '';
    mostrarInfoArticuloProduccion(); // limpia el panel de info del artículo ya registrado

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
  // CAMBIO 1: el historial debe mostrar primero lo último registrado (más
  // reciente → más antiguo). renderResumenPares() invierte el array al
  // pintarlo (.slice().reverse()), así que aquí ordenamos ASCENDENTE por
  // fecha+hora para que, tras esa inversión, quede el más reciente primero.
  registros = registros.slice().sort((a, b) =>
    (a.fecha || '').localeCompare(b.fecha || '') || (a.hora || '').localeCompare(b.hora || ''));
  // CAMBIO 2: las fotos del historial solo se muestran cuando hay una fecha
  // activa en el filtro (prod-historial-fecha). Aquí siempre hay fecha (la
  // función retorna antes si no la hay), así que se muestran las miniaturas.
  const hayFechaActiva = !!(fechaEl && fechaEl.value);
  cont.innerHTML = '<div style="margin-bottom:8px;font-weight:700;">' + fmtDate(fecha) + (empleado ? ' · ' + escHtml(empleado) : '') + '</div><div id="prod-historial-kpi" class="kpi-grid" style="margin-bottom:12px;"></div><div id="prod-historial-lista"></div>';
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en esta fecha' + (empleado ? ' para ' + empleado : '') + '.', mostrarFotos: hayFechaActiva, mostrarEmpleado: puedeVerEmpleadoProd(true) });
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
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en los últimos 7 días' + (empleado ? ' para ' + empleado : '') + '.', mostrarFotos: false, mostrarEmpleado: puedeVerEmpleadoProd(false) });
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
  renderResumenPares('prod-historial-kpi', 'prod-historial-lista', registros, { permitirEliminar: false, tituloVacio: 'No hay artículos registrados en los últimos 31 días' + (empleado ? ' para ' + empleado : '') + '.', mostrarFotos: false, mostrarEmpleado: puedeVerEmpleadoProd(false) });
}

Object.assign(window, {
  renderProduccion, registrarPares, eliminarRegistroPar,
  mostrarConteoFotosProduccion, mostrarInfoArticuloProduccion, renderHistorialProduccion, verSemanaProduccion, verMesProduccion,
  revisarRegistroExistente
});
