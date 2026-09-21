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

const GALERIA_CATS_FULL = [['detalle', 'Lavado'], ['suela', 'Detallado'], ['laterales', 'Pintado y personalizado'], ['todos_pares', 'Fotos generales']];
const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
let _galeriaRenderGen = 0;
let _galeriaEgressSearchTimer = null;
let _galeriaEgressSearchSeq = 0;
let _galeriaEgressLoading = false;
let _galeriaEgressObserver = null;

async function cargarMasGaleriaEgress() {
  const meta = db.getEgressMeta ? db.getEgressMeta() : null;
  if (_galeriaEgressLoading || !meta || !meta.orderHasMore) return;
  _galeriaEgressLoading = true;
  const el = document.getElementById('galeria-load-more-egress');
  if (el) el.textContent = 'Cargando 30 carpetas/órdenes más…';
  try {
    const r = await db.loadNextOrderPage(30);
    if (r && r.error) throw r.error;
    populateGaleriaSelect();
    await renderGaleria();
  } catch (e) {
    console.error('No se pudo cargar más Galería:', e);
    if (el) el.textContent = 'No se pudo cargar más. Toca para reintentar.';
  } finally {
    _galeriaEgressLoading = false;
  }
}

function instalarCargaProgresivaGaleria() {
  const el = document.getElementById('galeria-load-more-egress');
  if (!el || !db.getEgressMeta) return;
  const meta = db.getEgressMeta();
  if (!meta.orderHasMore || meta.fullOperationalLoaded) {
    el.style.display = 'none';
    if (_galeriaEgressObserver) { _galeriaEgressObserver.disconnect(); _galeriaEgressObserver = null; }
    return;
  }
  el.style.display = '';
  el.textContent = 'Desplázate hacia abajo para cargar 30 más';
  el.onclick = () => void cargarMasGaleriaEgress();
  if (_galeriaEgressObserver) _galeriaEgressObserver.disconnect();
  if ('IntersectionObserver' in window) {
    _galeriaEgressObserver = new IntersectionObserver(entries => {
      if (entries.some(x => x.isIntersecting)) void cargarMasGaleriaEgress();
    }, { rootMargin: '180px 0px' });
    _galeriaEgressObserver.observe(el);
  }
}

function fotoUrlNavegable(foto) {
  if (!foto) return PIXEL_TRANSPARENTE;
  if (foto.url && foto.url.startsWith('r2://') && foto.resolvedUrl == null) return PIXEL_TRANSPARENTE;
  const url = foto.resolvedUrl || foto.url || '';
  return url && !url.startsWith('r2://') ? url : PIXEL_TRANSPARENTE;
}

function galeriaCatsParaRol() {
  if (esEmpleado()) return GALERIA_CATS_FULL.filter(c => c[0] === 'todos_pares' || c[0] === 'detalle' || c[0] === 'suela' || c[0] === 'laterales');
  return GALERIA_CATS_FULL;
}

export const SERVICIO_A_GALERIA_CAT = { 'Lavado': 'detalle', 'Secado y detallado': 'suela', 'Pintado y personalizado': 'laterales' };

function migrateLegacyFotos(o) {
  if (o.fotos && typeof o.fotos === 'object' && !Array.isArray(o.fotos.antes)) return;
  if (o.fotos && typeof o.fotos === 'object') {
    const migratedFotos = [];
    for (const [cat, urls] of Object.entries(o.fotos)) {
      if (Array.isArray(urls)) urls.forEach(url => migratedFotos.push({ url, categoria: cat, fecha: o.fechaIngreso || new Date().toISOString().split('T')[0] }));
    }
    if (migratedFotos.length > 0) {
      if (!o.extra) o.extra = {};
      o.extra.fotos = migratedFotos;
      o.fotos = undefined;
    }
  }
  if (!o.extra) o.extra = {};
  if (!o.extra.fotos) o.extra.fotos = [];
}

export function populateGaleriaSelect() {
  const search = document.getElementById('galeria-orden-search');
  if (!search || document.getElementById('galeria-limpiar-busqueda')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'galeria-limpiar-busqueda';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = 'Limpiar';
  btn.style.marginTop = '8px';
  btn.onclick = limpiarBusquedaGaleria;
  const wrap = search.closest('.combo-wrap');
  if (wrap) wrap.appendChild(btn);
}

let galeriaItemActual = null;

function normalizarBusquedaGaleria(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function filtrarGaleriaOrdenes(texto) {
  const results = document.getElementById('galeria-orden-results');
  if (!results) return;
  const q = normalizarBusquedaGaleria(texto);
  const palabrasIgnorables = new Set(['talla', 'marca', 'modelo', 'par']);
  const tokens = q.split(' ').filter(t => t && !palabrasIgnorables.has(t));
  const hayBusqueda = !!q && tokens.length > 0;

  const pintar = (matches) => {
    const opcionTodos = !q ? '<div class="combo-item" onmousedown="seleccionarGaleriaOrden(\'__ALL__\')">👟 <strong>Ver fotos de todas las órdenes cargadas</strong></div>' : '';
    const listaItems = (matches || []).map(it => {
      const o = ordenById(it.ordenId);
      if (!o) return '';
      return '<div class="combo-item" onmousedown="seleccionarGaleriaItem(\'' + escAttr(it.id) + '\')"><strong>#' + escHtml(it.codigo) + '</strong> · ' + escHtml(clienteNombre(o.clienteId)) + '</div>';
    }).join('');
    const sinResultados = (q && !(matches || []).length)
      ? '<div class="combo-empty">Sin resultados — buscá por par, cliente, marca, modelo o talla</div>'
      : '';
    results.innerHTML = opcionTodos + listaItems + sinResultados;
  };

  const local = hayBusqueda
    ? (state.ordenItems || []).filter(it => {
        const o = ordenById(it.ordenId);
        if (!o) return false;
        const searchable = normalizarBusquedaGaleria([
          it.codigo, clienteNombre(o.clienteId), it.marca, it.modelo, it.talla,
          it.color, it.tipoCalzado, it.material, it.descripcion,
          o.marca, o.modelo, o.talla, o.color
        ].filter(v => v !== undefined && v !== null && v !== '').join(' '));
        return tokens.every(token => searchable.includes(token));
      }).slice(0, 20)
    : [];
  pintar(local);

  clearTimeout(_galeriaEgressSearchTimer);
  if (!hayBusqueda) {
    _galeriaEgressSearchSeq++;
    return;
  }

  const seq = ++_galeriaEgressSearchSeq;
  _galeriaEgressSearchTimer = setTimeout(async () => {
    const remotos = await db.searchGalleryItems(q, 20);
    if (seq !== _galeriaEgressSearchSeq) return;
    const actual = normalizarBusquedaGaleria(document.getElementById('galeria-orden-search')?.value || '');
    if (actual !== q) return;
    pintar(remotos);
  }, 320);
}

export function seleccionarGaleriaItem(itemId) {
  const it = (state.ordenItems || []).find(x => x.id === itemId);
  if (!it) return;
  galeriaItemActual = itemId;
  seleccionarGaleriaOrden(it.ordenId, false);
  const search = document.getElementById('galeria-orden-search');
  const o = ordenById(it.ordenId);
  if (search && it.codigo && o) search.value = '#' + it.codigo + ' · ' + clienteNombre(o.clienteId);
}

export function seleccionarGaleriaOrden(id, resetItem = true) {
  if (resetItem) galeriaItemActual = null;
  document.getElementById('galeria-orden-select').value = id;
  const search = document.getElementById('galeria-orden-search');
  if (id === '__ALL__') search.value = '👟 Todas las órdenes';
  else {
    const o = ordenById(id);
    if (o) search.value = '#' + o.numero + ' · ' + clienteNombre(o.clienteId);
  }
  limpiarCombo('galeria-orden-results');
  renderGaleria();
}

export function limpiarBusquedaGaleria() {
  galeriaItemActual = null;
  galeriaCarpetaActual = null;
  const search = document.getElementById('galeria-orden-search');
  const sel = document.getElementById('galeria-orden-select');
  if (search) search.value = '';
  if (sel) sel.value = '__ALL__';
  limpiarCombo('galeria-orden-results');
  renderGaleria();
}

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

let galeriaCarpetaActual = null;

function carpetasGaleria() {
  const grupos = new Map();
  const eg = db.getEgressMeta ? db.getEgressMeta() : null;
  const idsPaginaGaleria = new Set(eg && Array.isArray(eg.orderPageIds) ? eg.orderPageIds : []);
  const limitarAPaginaGaleria = !!(eg && eg.optimized && !eg.fullOperationalLoaded);
  const itemPorId = new Map((state.ordenItems || []).map(it => [it.id, it]));
  const itemPorCodigo = new Map((state.ordenItems || []).map(it => [it.codigo, it]));

  const asegurar = (ordenId, orden = null) => {
    if (!ordenId) return null;
    if (!grupos.has(ordenId)) {
      const o = orden || ordenById(ordenId) || null;
      grupos.set(ordenId, { ordenId, orden: o, fotos: [], keys: new Set(), codigos: new Set() });
    }
    return grupos.get(ordenId);
  };
  const agregar = (g, foto, codigo = null) => {
    if (!g || !foto || !foto.url) return;
    const key = foto.path || foto.url;
    if (g.keys.has(key)) return;
    g.keys.add(key);
    if (codigo) g.codigos.add(codigo);
    g.fotos.push({ ...foto, codigo: codigo || foto.codigo || null });
  };

  // Producción es la fuente canónica. Se agrupa por ORDEN general (405),
  // no por artículo (405-1, 405-2...), conservando cada código dentro.
  (state.registroPares || []).forEach(r => {
    const it = itemPorCodigo.get(r.codigo);
    if (!it) return;
    if (limitarAPaginaGaleria && !idsPaginaGaleria.has(it.ordenId)) return;
    const g = asegurar(it.ordenId);
    const urls = Array.isArray(r.fotoUrls) ? r.fotoUrls : (r.fotoUrl ? [r.fotoUrl] : []);
    urls.forEach(url => agregar(g, {
      url,
      categoria: SERVICIO_A_GALERIA_CAT[r.servicio] || 'todos_pares',
      fecha: r.fecha || '',
      itemId: it.id
    }, r.codigo));
  });

  // Fotos históricas/manuales de la orden se suman a la misma carpeta general.
  (state.ordenes || []).forEach(o => {
    if (limitarAPaginaGaleria && !idsPaginaGaleria.has(o.id)) return;
    migrateLegacyFotos(o);
    const fotos = (o.extra && Array.isArray(o.extra.fotos)) ? o.extra.fotos : [];
    fotos.forEach(f => {
      const it = f.itemId ? itemPorId.get(f.itemId) : null;
      agregar(asegurar(o.id, o), f, it ? it.codigo : null);
    });
  });

  return Array.from(grupos.values())
    .filter(g => g.fotos.length)
    .sort((a, b) => (Number(b.orden?.numero) || 0) - (Number(a.orden?.numero) || 0));
}

export async function seleccionarCarpetaGaleria(ordenId) {
  galeriaCarpetaActual = ordenId || null;
  const grupo = carpetasGaleria().find(g => g.ordenId === ordenId);
  const content = document.getElementById('galeria-content');
  if (!content) return;
  if (!grupo) { galeriaCarpetaActual = null; await renderGaleria(); return; }
  const miGen = ++_galeriaRenderGen;
  const numero = grupo.orden?.numero || '';
  content.innerHTML = '<div class="hint">Cargando fotos de la orden #' + escHtml(numero) + '…</div>';
  const fotos = await storageManager.resolveImageUrls(grupo.fotos);
  if (miGen !== _galeriaRenderGen) return;
  const porArticulo = new Map();
  fotos.forEach(f => {
    const codigo = f.codigo || 'Fotos generales';
    if (!porArticulo.has(codigo)) porArticulo.set(codigo, []);
    porArticulo.get(codigo).push(f);
  });
  const secciones = Array.from(porArticulo.entries()).sort(([a],[b]) => String(a).localeCompare(String(b), undefined, { numeric:true })).map(([codigo, lista]) => {
    const thumbs = lista.map(foto => {
      const src = fotoUrlNavegable(foto);
      const isStorage = !!(foto.url && (foto.url.startsWith('http') || foto.url.startsWith('r2://')));
      const badge = isStorage ? '<span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
      return '<div class="gallery-thumb-wrap"><img src="' + escAttr(src) + '" loading="lazy" decoding="async" onclick="ampliarImagen(\'' + String(src || '').replace(/'/g, "\\'") + '\')" title="' + escAttr(foto.fecha || '') + '">' + badge + '</div>';
    }).join('');
    return '<div class="gallery-cat"><h4>👟 ' + escHtml(codigo) + ' <span class="hint">(' + lista.length + ' fotos)</span></h4><div class="gallery-thumbs" style="display:grid;">' + thumbs + '</div></div>';
  }).join('');
  content.innerHTML = '<div style="margin-bottom:12px;"><button class="btn btn-ghost btn-sm" onclick="volverTodasCarpetasGaleria()">← Todos los pares</button></div>' +
    '<h3>📁 Orden #' + escHtml(numero) + (grupo.orden ? ' · ' + escHtml(clienteNombre(grupo.orden.clienteId)) : '') + '</h3>' +
    '<div class="gallery-cats">' + secciones + '</div>';
}

export function volverTodasCarpetasGaleria() {
  galeriaCarpetaActual = null;
  const sel = document.getElementById('galeria-orden-select');
  const search = document.getElementById('galeria-orden-search');
  if (sel) sel.value = '__ALL__';
  if (search) search.value = '👟 Todos los pares';
  renderGaleria();
}

async function renderGaleriaTodos(miGen) {
  galeriaCarpetaActual = null;
  const grupos = carpetasGaleria();
  const content = document.getElementById('galeria-content');
  if (!content) return;

  if (!grupos.length) {
    content.innerHTML = '<div class="empty-state"><div class="big">📷</div>No hay fotografías para mostrar</div>';
    return;
  }

  // Primero se muestran TODAS las carpetas. La carga de las portadas nunca
  // puede impedir que “Todos los pares” o “Limpiar” muestren la lista.
  const portadas = [];
  const bloques = grupos.map((g, idx) => {
    const portada = g.fotos[0] || null;
    portadas.push(portada);
    const numero = g.orden?.numero || '';
    const codigos = Array.from(g.codigos).sort((a,b) =>
      String(a).localeCompare(String(b), undefined, { numeric:true })
    );
    const contador = g.fotos.length > 1
      ? '<span class="gallery-cover-badge">+' + (g.fotos.length - 1) + ' fotos</span>'
      : '';
    return '<div class="gallery-cat"><h4>#' + escHtml(numero) +
      (g.orden ? ' · ' + escHtml(clienteNombre(g.orden.clienteId)) : '') +
      ' <span class="hint">(' + escHtml(codigos.join(', ')) + ')</span></h4>' +
      '<div class="gallery-thumb-wrap gallery-cover" onclick="seleccionarCarpetaGaleria(\'' +
      escAttr(g.ordenId) + '\')" title="Abrir carpeta de la orden">' +
      '<img data-galeria-cover="' + idx + '" src="' + PIXEL_TRANSPARENTE +
      '" loading="lazy" decoding="async">' + contador + '</div></div>';
  }).join('');

  content.innerHTML = '<div class="gallery-cats">' + bloques + '</div>' +
    '<div id="galeria-load-more-egress" class="hint" style="text-align:center;padding:18px 8px;cursor:pointer;"></div>';
  instalarCargaProgresivaGaleria();

  // Resolver portadas en segundo plano. Si una URL falla, la carpeta sigue
  // visible y utilizable; no desaparece la orden completa.
  storageManager.resolveImageUrls(portadas).then(resueltas => {
    if (miGen !== _galeriaRenderGen) return;
    (resueltas || []).forEach((foto, idx) => {
      const img = content.querySelector('img[data-galeria-cover="' + idx + '"]');
      if (!img) return;
      const src = fotoUrlNavegable(foto);
      if (src && src !== PIXEL_TRANSPARENTE) img.src = src;
    });
  }).catch(err => console.warn('No se pudieron resolver algunas portadas de galería:', err));
}

export async function renderGaleria() {
  const miGen = ++_galeriaRenderGen;
  const sel = document.getElementById('galeria-orden-select');
  if (!state.ordenes.length) {
    document.getElementById('galeria-content').innerHTML = '<div class="empty-state"><div class="big">📷</div>No hay órdenes registradas</div>';
    return;
  }
  if (sel.value === '__ALL__') { await renderGaleriaTodos(miGen); return; }
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
  const itemFiltrado = galeriaItemActual ? (state.ordenItems || []).find(it => it.id === galeriaItemActual && it.ordenId === o.id) : null;
  if (galeriaItemActual && !itemFiltrado) galeriaItemActual = null;
  const fotosPorCat = {};
  const cats = galeriaCatsParaRol(); cats.forEach(([key]) => { fotosPorCat[key] = []; });
  const fotosBase = (o.extra && Array.isArray(o.extra.fotos)) ? o.extra.fotos : [];
  const fotosResueltas = await storageManager.resolveImageUrls(fotosBase);
  if (miGen !== _galeriaRenderGen) return;
  fotosResueltas.forEach(foto => {
    if (itemFiltrado && foto.itemId !== itemFiltrado.id) return;
    if (fotosPorCat[foto.categoria] !== undefined) fotosPorCat[foto.categoria].push(foto);
  });
  const avisoFiltro = itemFiltrado ? '<div class="hint" style="margin-bottom:10px;">Mostrando solo las fotos del artículo <strong>#' + escHtml(itemFiltrado.codigo) + '</strong> · <a href="#" onclick="limpiarFiltroGaleriaItem();return false;">Ver toda la orden #' + escHtml(o.numero) + '</a></div>' : '';
  document.getElementById('galeria-content').innerHTML = avisoFiltro + '<div class="gallery-cats">' + galeriaCatsParaRol().map(([key, label]) => {
    const fotos = fotosPorCat[key];
    const puedeBorrar = esAdmin();
    const puedeSubir = esAdmin() || esSupervisor() || esEmpleado();
    const empleadoPuedeSubirAqui = !esEmpleado() || ['detalle', 'suela', 'laterales', 'todos_pares'].includes(key);
    const grupoId = 'gc-' + escAttr(o.id) + '-' + key;
    const addLabel = (puedeSubir && empleadoPuedeSubirAqui ? '<label class="gallery-add" title="Agregar foto">+<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none;" onchange="addGaleriaFoto(\'' + escAttr(o.id) + '\',\'' + key + '\',this.files[0],\'' + escAttr(itemFiltrado ? itemFiltrado.id : '') + '\')"></label>' : '');
    const thumbsHTML = fotos.map((foto, idx) => {
      const src = fotoUrlNavegable(foto);
      const isStorage = !!(foto.url && (foto.url.startsWith('http') || foto.url.startsWith('r2://')));
      const badge = isStorage ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
      return '<div class="gallery-thumb-wrap"><img src="' + escAttr(src) + '" loading="lazy" decoding="async" onclick="ampliarImagen(\'' + String(src || '').replace(/'/g, "\\'") + '\')" title="' + escAttr(foto.fecha || '') + '">' + badge + (puedeBorrar ? '<button class="gallery-delete-btn" onclick="eliminarFoto(\'' + escAttr(o.id) + '\',' + idx + ',\'' + key + '\',\'' + escAttr(itemFiltrado ? itemFiltrado.id : '') + '\')" title="Eliminar">×</button>' : '') + '</div>';
    }).join('');
    if (fotos.length) {
      const portada = fotos[0];
      const portadaSrc = fotoUrlNavegable(portada);
      const isStoragePortada = !!(portada.url && (portada.url.startsWith('http') || portada.url.startsWith('r2://')));
      const badgePortada = isStoragePortada ? ' <span class="storage-badge" title="Almacenada en la nube">☁️</span>' : '';
      const contadorBadge = fotos.length > 1 ? '<span class="gallery-cover-badge">+' + (fotos.length - 1) + ' fotos</span>' : '';
      return '<div class="gallery-cat"><h4>' + escHtml(label) + ' <span class="hint">(' + fotos.length + ')</span></h4><div class="gallery-thumb-wrap gallery-cover" onclick="toggleGaleriaGrupo(\'' + grupoId + '\')" title="Ver todas las fotos"><img src="' + escAttr(portadaSrc) + '" loading="lazy" decoding="async" title="' + escAttr(portada.fecha || '') + '">' + badgePortada + contadorBadge + '</div><div class="gallery-thumbs" id="' + grupoId + '" style="display:none;">' + thumbsHTML + addLabel + '</div></div>';
    }
    return '<div class="gallery-cat"><h4>' + escHtml(label) + ' <span class="hint">(' + fotos.length + ')</span></h4><div class="gallery-thumbs">' + addLabel + '</div></div>';
  }).join('') + '</div>';
}

export async function vincularFotoGaleria(ordenId, categoria, urls, itemId) {
  const o = ordenById(ordenId);
  if (!o) return;
  const lista = Array.isArray(urls) ? urls : [urls];
  if (!lista.length) return;
  migrateLegacyFotos(o);
  const fecha = todayISO(0);
  lista.forEach(url => o.extra.fotos.push({ url, categoria, fecha, itemId: itemId || null }));
  await persist();
  const res = await db.saveOrden(o);
  if (res && res.error && !res.queued) throw res.error;
}

export async function addGaleriaFoto(ordenId, cat, file, itemId) {
  if (!file) return;
  const type = String(file.type || '').toLowerCase();
  const compatible = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' ||
    /\.(jpe?g|png|webp)$/i.test(String(file.name || ''));
  if (!compatible) {
    showToast('Formato no compatible. Usa fotografías JPEG, PNG o WebP.');
    return;
  }
  const o = ordenById(ordenId);
  migrateLegacyFotos(o);
  try {
    showToast('Subiendo fotografía...', 'info');
    const fotoData = await storageManager.uploadFoto(file, ordenId, cat);
    if (itemId) fotoData.itemId = itemId;
    o.extra.fotos.push(fotoData);
    await persist();
    const res = await db.saveOrden(o);
    if (res && res.error && !res.queued) throw res.error;
    await renderGaleria();
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
  const fotosPorCat = o.extra.fotos.filter(f => f.categoria === cat && (!itemId || f.itemId === itemId));
  const foto = fotosPorCat[globalIdx];
  if (!foto) { showToast('Foto no encontrada'); return; }
  if (!confirm('¿Eliminar esta fotografía?')) return;
  try {
    if (foto.url.startsWith('http') && foto.path) {
      try { await storageManager.deleteFile(foto.path); } catch (e) { console.warn('No se pudo eliminar del Storage:', e); }
    }
    const realIdx = o.extra.fotos.indexOf(foto);
    if (realIdx !== -1) o.extra.fotos.splice(realIdx, 1);
    await persist();
    await db.saveOrden(o);
    await renderGaleria();
    showToast('Fotografía eliminada');
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar la fotografía');
  }
}

let imagenAmpliadaLista = [];
let imagenAmpliadaIdx = 0;
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
  if (img) img.src = secureSrc && !secureSrc.startsWith('r2://') ? secureSrc : PIXEL_TRANSPARENTE;
  const titulo = document.getElementById('imagen-ampliada-titulo');
  if (titulo) titulo.textContent = total > 1 ? 'Fotografía (' + (imagenAmpliadaIdx + 1) + ' de ' + total + ')' : 'Fotografía';
  const prev = document.getElementById('imagen-ampliada-prev');
  const next = document.getElementById('imagen-ampliada-next');
  if (prev) prev.style.display = total > 1 ? 'block' : 'none';
  if (next) next.style.display = total > 1 ? 'block' : 'none';
}
export function toggleGaleriaGrupo(grupoId) {
  const cont = document.getElementById(grupoId);
  if (!cont) return;
  cont.style.display = (cont.style.display === 'none' || !cont.style.display) ? 'flex' : 'none';
}

Object.assign(window, { populateGaleriaSelect, renderGaleria, addGaleriaFoto, eliminarFoto, ampliarImagen, imagenAmpliadaNav, filtrarGaleriaOrdenes, seleccionarGaleriaOrden, seleccionarGaleriaItem, limpiarBusquedaGaleria, limpiarFiltroGaleriaItem, seleccionarCarpetaGaleria, volverTodasCarpetasGaleria, toggleGaleriaGrupo });