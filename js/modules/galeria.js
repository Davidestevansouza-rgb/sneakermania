/* ============================================================
   MÓDULO: GALERÍA DE FOTOGRAFÍAS
   Fase 2: Las fotos se suben a Supabase Storage y se guardan
   las URLs en ordenes.extra.fotos[] como objetos {url, categoria, fecha}
   ============================================================ */
import { state, todayISO, persist, esEmpleado, esSupervisor, esAdmin } from '../state.js';
import * as db from '../db.js';
import { showToast, clienteNombre, ordenById, openModalEl, closeModal, fmtDate } from '../ui.js';
import { escHtml, escAttr } from '../sanitize.js';
import * as storageManager from '../storage-manager.js';
import { limpiarCombo } from '../combo-search.js';

const GALERIA_CATS_FULL = [['detalle', 'Lavado'], ['suela', 'Detallado'], ['laterales', 'Pintado y personalizado'], ['todos_pares', 'Todos los archivos']];
// El Empleado solo ve:
//   - 'Todos los archivos' (foto global de los pares)
//   - las fotos de Producción que él sube (categoria según SERVICIO_A_GALERIA_CAT).
// Supervisor/Aministrador: ve todo.
function galeriaCatsParaRol() {
  if (esEmpleado()) return GALERIA_CATS_FULL.filter(c => c[0] === 'todos_pares' || c[0] === 'detalle' || c[0] === 'suela' || c[0] === 'laterales');
  return GALERIA_CATS_FULL;
}

// A qué categoría de la Galería va la foto según el "Servicio" que se
// eligió en Producción (ver el <select id="prod-servicio"> y
// SERVICIO_A_ESTADO_ITEM en items.js — mismo vocabulario). Así, cuando el
// lavador, el detallista o el pintor suben sus fotos al registrar un par
// en Producción, esas fotos quedan vinculadas automáticamente a la
// categoría correspondiente en la Galería de esa orden (no hace falta
// volver a subirlas a mano ahí).
export const SERVICIO_A_GALERIA_CAT = { 'Lavado': 'detalle', 'Secado y detallado': 'suela', 'Pintado y personalizado': 'laterales' };

// Migrar fotos legacy (base64) a estructura nueva (para retrocompatibilidad)
function migrateLegacyFotos(o) {
  // Si tiene fotos legacy en formato {antes:[], durante:[], ...} con base64
  if (o.fotos && typeof o.fotos === 'object' && !Array.isArray(o.fotos.antes)) {
    return; // Ya está en formato nuevo
  }
  
  // Migrar: convertir {antes:[base64, base64]} a []{url, categoria, fecha}
  if (o.fotos && typeof o.fotos === 'object') {
    const migratedFotos = [];
    for (const [cat, urls] of Object.entries(o.fotos)) {
      if (Array.isArray(urls)) {
        urls.forEach(url => {
          migratedFotos.push({
            url: url,
            categoria: cat,
            fecha: o.fechaIngreso || new Date().toISOString().split('T')[0]
          });
        });
      }
    }
    // Si encontramos fotos legacy, reemplazar
    if (migratedFotos.length > 0) {
      if (!o.extra) o.extra = {};
      o.extra.fotos = migratedFotos;
      o.fotos = undefined; // Limpiar el formato legacy
    }
  }
  
  // Asegurar que extra.fotos existe
  if (!o.extra) o.extra = {};
  if (!o.extra.fotos) o.extra.fotos = [];
}

export function populateGaleriaSelect() {
  // El selector de orden es ahora un buscador (ver filtrarGaleriaOrdenes);
  // no hay nada que precargar en una lista larga.
}

// Artículo individual actualmente filtrado en la Galería (it.id), o null si
// se está viendo la orden completa (o "todas las órdenes"). Cuando hay un
// artículo seleccionado, renderGaleria() debe mostrar ESTRICTAMENTE las
// fotos vinculadas a ese artículo (ver campo foto.itemId), sin mezclarlas
// con las de otros artículos de la misma orden.
let galeriaItemActual = null;

/**
 * Buscador tipo autocompletar de la Galería. Admite dos criterios:
 * el número de artículo/par individual (ej. "6-1" o "6-2") y el nombre
 * del cliente. Ya no busca por número de orden general, para no mezclar
 * fotos de distintos artículos de una misma orden. Siempre ofrece arriba
 * la opción "Ver fotos de todas las órdenes" (vista consolidada) cuando
 * el campo está vacío. Los resultados muestran solo el cliente y el par
 * correspondiente, sin marca/modelo ni otros datos que saturen la pantalla.
 */
export function filtrarGaleriaOrdenes(texto) {
  const results = document.getElementById('galeria-orden-results');
  if (!results) return;
  const q = (texto || '').trim().toLowerCase();

  // Criterios: código de par individual (ej. "6-1", "6-2") o nombre del cliente.
  const itemMatches = q
    ? (state.ordenItems || []).filter(it => {
        if (it.codigo && it.codigo.toLowerCase().includes(q)) return true;
        const o = ordenById(it.ordenId);
        const nombreCliente = o ? (clienteNombre(o.clienteId) || '').toLowerCase() : '';
        return nombreCliente.includes(q);
      }).slice(0, 20)
    : [];

  const opcionTodos = !q ? '<div class="combo-item" onmousedown="seleccionarGaleriaOrden(\'__ALL__\')">👟 <strong>Ver fotos de todas las órdenes</strong></div>' : '';

  const listaItems = itemMatches.map(it => {
    const o = ordenById(it.ordenId);
    if (!o) return '';
    return '<div class="combo-item" onmousedown="seleccionarGaleriaItem(\'' + escAttr(it.id) + '\')">' +
      '<strong>#' + escHtml(it.codigo) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) +
    '</div>';
  }).join('');

  const sinResultados = (q && !itemMatches.length)
    ? '<div class="combo-empty">Sin resultados — buscá por # de artículo (ej. 6-1) o por nombre de cliente</div>' : '';

  results.innerHTML = opcionTodos + listaItems + sinResultados;
}
// Selecciona un artículo/par individual dentro de la Galería: muestra sus fotos
// (la global 'todos_pares' y las de producción del artículo) dentro del detalle
// de la orden.
export function seleccionarGaleriaItem(itemId) {
  const it = (state.ordenItems || []).find(x => x.id === itemId);
  if (!it) return;
  // Fijar el filtro por artículo ANTES de renderizar, para que la orden se
  // muestre ya recortada a este artículo (y no mezclada con el resto).
  galeriaItemActual = itemId;
  // Llevar a la orden del artículo (sin resetear el filtro que acabamos de fijar).
  seleccionarGaleriaOrden(it.ordenId, false);
  // Marcar selección visual: solo cliente y artículo, sin datos adicionales.
  const search = document.getElementById('galeria-orden-search');
  const o = ordenById(it.ordenId);
  if (search && it.codigo && o) search.value = '#' + it.codigo + ' · ' + clienteNombre(o.clienteId);
}

/** Selecciona una orden (o "todas") desde los resultados del buscador de la Galería.
 *  @param {string} id - id de la orden, o '__ALL__'.
 *  @param {boolean} [resetItem=true] - si es true (caso normal: el usuario buscó
 *    por cliente o por N° de orden general), se limpia cualquier filtro de
 *    artículo individual que hubiera quedado activo. seleccionarGaleriaItem()
 *    pasa false porque ya fijó su propio filtro justo antes de llamar aquí.
 */
export function seleccionarGaleriaOrden(id, resetItem = true) {
  if (resetItem) galeriaItemActual = null;
  document.getElementById('galeria-orden-select').value = id;
  const search = document.getElementById('galeria-orden-search');
  if (id === '__ALL__') {
    search.value = '👟 Todas las órdenes';
  } else {
    const o = ordenById(id);
    if (o) search.value = '#' + o.numero + ' · ' + clienteNombre(o.clienteId);
  }
  limpiarCombo('galeria-orden-results');
  renderGaleria();
}

/** Quita el filtro por artículo individual y vuelve a la vista completa de la orden. */
export function limpiarFiltroGaleriaItem() {
  if (!galeriaItemActual) return;
  const sel = document.getElementById('galeria-orden-select');
  galeriaItemActual = null;
  if (sel && sel.value && sel.value !== '__ALL__') {
    const o = ordenById(sel.value);
    const search = document.getElementById('galeria-orden-search');
    if (search && o) search.value = '#' + o.numero + ' · ' + clienteNombre(o.clienteId);
  }
  renderGaleria();
}

// Vista consolidada: todas las fotos de todas las órdenes
function renderGaleriaTodos() {
  const ordenes = state.ordenes.slice().sort((a, b) => b.numero - a.numero);
  let bloques = '';
  ordenes.forEach(o => {
    migrateLegacyFotos(o);
    const fotos = (o.extra && o.extra.fotos) ? o.extra.fotos : [];
    if (!fotos.length) return;
    const grupoId = 'gg-all-' + escAttr(o.id);
    const portada = fotos[0];
    const isStoragePortada = portada.url.startsWith('http');
    const badgePortada = isStoragePortada ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
    const contadorBadge = fotos.length > 1 ? '<span class="gallery-cover-badge">+' + (fotos.length - 1) + ' fotos</span>' : '';
    bloques += '<div class="gallery-cat"><h4>#' + escHtml(o.numero) + ' · ' + escHtml(clienteNombre(o.clienteId)) +
      ' <span class="hint">' + escHtml(o.marca || '') + ' ' + escHtml(o.modelo || '') + ' (' + fotos.length + ')</span></h4>' +
      '<div class="gallery-thumb-wrap gallery-cover" onclick="toggleGaleriaGrupo(\'' + grupoId + '\')" title="Ver todas las fotos">' +
        '<img src="' + escAttr(portada.url) + '" loading="lazy" decoding="async" title="' + escAttr(portada.fecha || '') + '">' +
        badgePortada + contadorBadge +
      '</div>' +
      '<div class="gallery-thumbs" id="' + grupoId + '" style="display:none;">' +
      fotos.map(foto => {
        const isStorage = foto.url.startsWith('http');
        const badge = isStorage ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
        return '<div class="gallery-thumb-wrap"><img src="' + escAttr(foto.url) + '" loading="lazy" decoding="async" onclick="ampliarImagen(\'' + foto.url.replace(/'/g, "\\'") + '\')" title="' + escAttr(foto.fecha || '') + '">' + badge + '</div>';
      }).join('') +
      '</div></div>';
  });
  document.getElementById('galeria-content').innerHTML = bloques
    ? '<div class="gallery-cats">' + bloques + '</div>'
    : '<div class="empty-state"><div class="big">📷</div>No hay fotografías para mostrar</div>';
}

export function renderGaleria() {
  const sel = document.getElementById('galeria-orden-select');

  if (!state.ordenes.length) {
    document.getElementById('galeria-content').innerHTML = '<div class="empty-state"><div class="big">📷</div>No hay órdenes registradas</div>';
    return;
  }

  // Vista "Todos los artículos": muestra las fotos de todas las órdenes
  if (sel.value === '__ALL__') { renderGaleriaTodos(); return; }

  const o = ordenById(sel.value) || state.ordenes[0];
  if (!o) {
    document.getElementById('galeria-content').innerHTML = '<div class="empty-state"><div class="big">📷</div>No hay órdenes registradas</div>';
    return;
  }

  migrateLegacyFotos(o);
  if (sel.value !== o.id) {
    sel.value = o.id;
    const search = document.getElementById('galeria-orden-search');
    if (search && !search.value) search.value = '#' + o.numero + ' · ' + clienteNombre(o.clienteId);
  }
  
  // Si hay un artículo individual seleccionado (ej. buscó "6-2"), validar que
  // siga perteneciendo a esta orden; si no, se descarta el filtro.
  const itemFiltrado = galeriaItemActual
    ? (state.ordenItems || []).find(it => it.id === galeriaItemActual && it.ordenId === o.id)
    : null;
  if (galeriaItemActual && !itemFiltrado) galeriaItemActual = null;

  // Agrupar fotos por categoría. Cuando hay un artículo filtrado, se muestran
  // ESTRICTAMENTE las fotos vinculadas a ese artículo (foto.itemId) — nunca
  // las de otros artículos de la misma orden.
  const fotosPorCat = {};
  const cats = galeriaCatsParaRol(); cats.forEach(([key]) => { fotosPorCat[key] = []; });
  
  if (o.extra && o.extra.fotos) {
    o.extra.fotos.forEach(foto => {
      if (itemFiltrado && foto.itemId !== itemFiltrado.id) return;
      if (fotosPorCat[foto.categoria] !== undefined) {
        fotosPorCat[foto.categoria].push(foto);
      }
    });
  }

  const avisoFiltro = itemFiltrado
    ? '<div class="hint" style="margin-bottom:10px;">Mostrando solo las fotos del artículo <strong>#' + escHtml(itemFiltrado.codigo) + '</strong> · ' +
      '<a href="#" onclick="limpiarFiltroGaleriaItem();return false;">Ver toda la orden #' + escHtml(o.numero) + '</a></div>'
    : '';

  document.getElementById('galeria-content').innerHTML = avisoFiltro + '<div class="gallery-cats">' +
    galeriaCatsParaRol().map(([key, label]) => {
      const fotos = fotosPorCat[key];
      const puedeBorrar = esAdmin();
      const puedeSubir = esAdmin() || esSupervisor() || esEmpleado();
      // El Empleado solo puede SUBIR a las categorías de Producción
      // (detalle=suela, suela=Detallado, laterales=Pintado+personalizado) y
      // a "todos_pares". El resto, no.
      const empleadoPuedeSubirAqui = !esEmpleado() || ['detalle', 'suela', 'laterales', 'todos_pares'].includes(key);
      const grupoId = 'gc-' + escAttr(o.id) + '-' + key;
      const addLabel = (puedeSubir && empleadoPuedeSubirAqui ? '<label class="gallery-add" title="Agregar foto">+<input type="file" accept="image/*" style="display:none;" onchange="addGaleriaFoto(\'' + escAttr(o.id) + '\',\'' + key + '\',this.files[0],\'' + escAttr(itemFiltrado ? itemFiltrado.id : '') + '\')"></label>' : '');
      const thumbsHTML = fotos.map((foto, idx) => {
          const isStorage = foto.url.startsWith('http');
          const badge = isStorage ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
          return '<div class="gallery-thumb-wrap">' +
            '<img src="' + escAttr(foto.url) + '" loading="lazy" decoding="async" onclick="ampliarImagen(\'' + foto.url.replace(/'/g, "\\'") + '\')" title="' + escAttr(foto.fecha || '') + '">' +
            badge +
            (puedeBorrar ? '<button class="gallery-delete-btn" onclick="eliminarFoto(\'' + escAttr(o.id) + '\',' + idx + ',\'' + key + '\',\'' + escAttr(itemFiltrado ? itemFiltrado.id : '') + '\')" title="Eliminar">×</button>' : '') +
          '</div>';
        }).join('');
      // Con fotos: se muestra una portada (primera foto) con un badge "+N fotos"
      // que al pulsarse despliega/oculta el resto. Sin fotos: se muestra directo
      // el botón para agregar, para que siempre se pueda subir.
      if (fotos.length) {
        const portada = fotos[0];
        const isStoragePortada = portada.url.startsWith('http');
        const badgePortada = isStoragePortada ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
        const contadorBadge = fotos.length > 1 ? '<span class="gallery-cover-badge">+' + (fotos.length - 1) + ' fotos</span>' : '';
        return '<div class="gallery-cat"><h4>' + escHtml(label) + ' <span class="hint">(' + fotos.length + ')</span></h4>' +
          '<div class="gallery-thumb-wrap gallery-cover" onclick="toggleGaleriaGrupo(\'' + grupoId + '\')" title="Ver todas las fotos">' +
            '<img src="' + escAttr(portada.url) + '" loading="lazy" decoding="async" title="' + escAttr(portada.fecha || '') + '">' +
            badgePortada + contadorBadge +
          '</div>' +
          '<div class="gallery-thumbs" id="' + grupoId + '" style="display:none;">' + thumbsHTML + addLabel + '</div>' +
        '</div>';
      }
      return '<div class="gallery-cat"><h4>' + escHtml(label) + ' <span class="hint">(' + fotos.length + ')</span></h4><div class="gallery-thumbs">' +
        addLabel +
      '</div></div>';
    }).join('') + '</div>';
}

/** Vincula a la Galería de una orden una o varias fotos que YA fueron
 *  subidas a Storage desde otra pantalla (por ahora, Producción: cuando
 *  el lavador, el detallista o el pintor suben sus fotos al registrar un
 *  par). No vuelve a subir los archivos — reutiliza las mismas URLs — y
 *  las deja en la categoría que le corresponde (ver
 *  SERVICIO_A_GALERIA_CAT), guardando la orden una sola vez. */
export async function vincularFotoGaleria(ordenId, categoria, urls, itemId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const lista = Array.isArray(urls) ? urls : [urls];
  if (!lista.length) return;
  migrateLegacyFotos(o);
  const fecha = todayISO(0);
  // itemId vincula la foto al artículo puntual (ej. "6-2") para que la
  // búsqueda por artículo individual en la Galería no la mezcle con las
  // fotos de otros artículos de la misma orden.
  lista.forEach(url => o.extra.fotos.push({ url, categoria, fecha, itemId: itemId || null }));
  await persist();
  await db.saveOrden(o);
}

export async function addGaleriaFoto(ordenId, cat, file, itemId) {
  if (!file) return;
  
  const o = ordenById(ordenId);
  migrateLegacyFotos(o);
  
  try {
    showToast('Subiendo fotografía...', 'info');
    
    // Subir a Supabase Storage
    const fotoData = await storageManager.uploadFoto(file, ordenId, cat);
    // Si se subió estando filtrada la vista por un artículo (ej. "6-2"),
    // vincular la foto a ese artículo para que quede aislada del resto.
    if (itemId) fotoData.itemId = itemId;
    
    // Agregar a la lista
    o.extra.fotos.push(fotoData);
    
    await persist();
    await db.saveOrden(o);
    renderGaleria();
    showToast('Fotografía guardada en la nube ☁️');
  } catch (err) {
    console.error(err);
    showToast('Error al subir la fotografía: ' + err.message);
  }
}

export async function eliminarFoto(ordenId, globalIdx, cat, itemId) {
  if (!esAdmin()) { showToast('Solo el Administrador puede eliminar fotos de la galería'); return; }
  const o = ordenById(ordenId);
  migrateLegacyFotos(o);
  
  // Encontrar el índice dentro de extra.fotos, respetando el mismo filtro
  // (categoría + artículo) que usó renderGaleria() para mostrar la lista,
  // así el índice coincide exactamente con la miniatura que se está borrando.
  const fotosPorCat = o.extra.fotos.filter(f => f.categoria === cat && (!itemId || f.itemId === itemId));
  const foto = fotosPorCat[globalIdx];
  
  if (!foto) {
    showToast('Foto no encontrada');
    return;
  }
  
  if (!confirm('¿Eliminar esta fotografía?')) return;
  
  try {
    // Si es una URL de Storage, intentar eliminar del bucket
    if (foto.url.startsWith('http') && foto.path) {
      try {
        await storageManager.deleteFile(foto.path);
      } catch (e) {
        console.warn('No se pudo eliminar del Storage:', e);
      }
    }
    
    // Eliminar del array
    const realIdx = o.extra.fotos.indexOf(foto);
    if (realIdx !== -1) {
      o.extra.fotos.splice(realIdx, 1);
    }
    
    await persist();
    await db.saveOrden(o);
    renderGaleria();
    showToast('Fotografía eliminada');
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar la fotografía');
  }
}

// Estado del visor ampliado: guarda la lista completa de fotos del grupo
// actual (todas las de esa tarjeta/registro) y en qué posición está, para
// poder navegar con las flechas sin cerrar el modal.
let imagenAmpliadaLista = [];
let imagenAmpliadaIdx = 0;

/**
 * Abre el visor de imagen ampliada. Si se pasa una lista de fotos (por
 * ejemplo todas las de un registro de producción), permite navegar entre
 * ellas con las flechas dentro del mismo modal en vez de mostrar siempre
 * una sola imagen fija.
 * @param {string} src - Foto a mostrar inicialmente.
 * @param {string[]} [lista] - Todas las fotos del grupo (opcional).
 */
export async function ampliarImagen(src, lista) {
  imagenAmpliadaLista = Array.isArray(lista) && lista.length ? lista : [src];
  imagenAmpliadaIdx = Math.max(0, imagenAmpliadaLista.indexOf(src));
  openModalEl('modal-imagen');
  await renderImagenAmpliada();
}

export async function imagenAmpliadaNav(delta) {
  if (!imagenAmpliadaLista.length) return;
  imagenAmpliadaIdx = (imagenAmpliadaIdx + delta + imagenAmpliadaLista.length) % imagenAmpliadaLista.length;
  await renderImagenAmpliada();
}

async function renderImagenAmpliada() {
  const total = imagenAmpliadaLista.length;
  const rawSrc = imagenAmpliadaLista[imagenAmpliadaIdx];
  const secureSrc = await storageManager.resolveImageUrl(rawSrc);
  const img = document.getElementById('imagen-ampliada');
  if (img) img.src = secureSrc || rawSrc;
  const titulo = document.getElementById('imagen-ampliada-titulo');
  if (titulo) titulo.textContent = total > 1 ? 'Fotografía (' + (imagenAmpliadaIdx + 1) + ' de ' + total + ')' : 'Fotografía';
  const prev = document.getElementById('imagen-ampliada-prev');
  const next = document.getElementById('imagen-ampliada-next');
  if (prev) prev.style.display = total > 1 ? 'block' : 'none';
  if (next) next.style.display = total > 1 ? 'block' : 'none';
}

/** Muestra u oculta el grupo de fotos asociado a una portada de la galería.
 *  Se usa desde las portadas (foto principal + badge "+N fotos") para
 *  desplegar/plegar todas las fotos del grupo sin recargar la vista. */
export function toggleGaleriaGrupo(grupoId) {
  const cont = document.getElementById(grupoId);
  if (!cont) return;
  cont.style.display = (cont.style.display === 'none' || !cont.style.display) ? 'flex' : 'none';
}

Object.assign(window, { populateGaleriaSelect, renderGaleria, addGaleriaFoto, eliminarFoto, ampliarImagen, imagenAmpliadaNav, filtrarGaleriaOrdenes, seleccionarGaleriaOrden, seleccionarGaleriaItem, limpiarFiltroGaleriaItem, toggleGaleriaGrupo });
