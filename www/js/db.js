/* ============================================================
   CAPA DE DATOS (Supabase) — Sistema SeS
   ============================================================
   Traduce entre el modelo en memoria (camelCase) y las columnas de
   PostgreSQL (snake_case), y realiza las operaciones CRUD. Es
   "offline-first": si no hay conexión, las escrituras se encolan y
   se reintentan al reconectar (ver flushQueue).
   ============================================================ */
import { supabase } from './config.js';
import { state, enqueue, getQueue, setQueue, clearQueue, todayISO } from './state.js';

/* ---------- Helpers ---------- */
function tenantId() { return state.session && state.session.tenantId; }
function userId() { return state.session && state.session.userId; }
export function online() {
  return !!supabase && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

/* ============================================================
   SINCRONIZACIÓN DE IDs TEMPORALES EN EL STATE LOCAL
   ============================================================
   Cuando una operación upsert/insert devuelve un id real por parte
   de la base (distinto del id temporal usado en cliente), llamamos
   a applyIdToState para:
     - actualizar el campo "id" en cualquier entidad que tuviera el
       id temporal (todas las colecciones relevantes del state)
     - actualizar cualquier campo FK (ordenId, clienteId, inventarioId,
       usuarioId) que apunte al id temporal, para no romper referencias
   ============================================================ */
const STATE_COLLECTIONS = () => [
  state.clientes || [],
  state.clientesEliminados || [],
  state.ordenes || [],
  state.ordenesEliminadas || [],
  state.gastos || [],
  state.inventario || [],
  state.ordenItems || [],
  state.registroPares || [],
  state.facturas || [],
  state.notificaciones || []
];

const FK_FIELDS = ['ordenId', 'clienteId', 'inventarioId', 'usuarioId'];

export function applyIdToState(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  const collections = STATE_COLLECTIONS();
  for (const arr of collections) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      if (item.id === oldId) item.id = newId;
      for (const fk of FK_FIELDS) {
        if (item[fk] === oldId) item[fk] = newId;
      }
    }
  }
}

/* ============================================================
   MAPPERS camelCase <-> snake_case
   ============================================================ */

/* --- clientes --- */
function clienteToDb(c) {
  return {
    id: c.id, tenant_id: tenantId(),
    nombre: c.nombre, telefono: c.telefono, whatsapp: c.whatsapp,
    email: c.email || null, direccion: c.direccion, rfc: c.rfc || null,
    observaciones: c.observaciones, eliminada: !!c.eliminada
  };
}
function clienteFromDb(r) {
  return {
    id: r.id, nombre: r.nombre || '', telefono: r.telefono || '',
    whatsapp: r.whatsapp || '', email: r.email || '', direccion: r.direccion || '',
    rfc: r.rfc || '', observaciones: r.observaciones || '', eliminada: !!r.eliminada,
    // Fecha de alta del cliente (columna created_at que Supabase agrega
    // automáticamente a cada tabla) — se usa en el buscador de fechas.
    creadoEn: r.created_at || null
  };
}

/* --- ordenes ---
   Los escalares se guardan en columnas tipadas (para consultas/RLS);
   el objeto completo se guarda además en `extra` para fidelidad total. */
function normalizarSnapshotOrden(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const chain = [];
  const seen = new Set();
  let current = raw;
  while (current && typeof current === 'object' && !Array.isArray(current) && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = (current.extra && typeof current.extra === 'object' && !Array.isArray(current.extra))
      ? current.extra
      : null;
  }

  const base = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [key, value] of Object.entries(chain[i])) {
      if (key !== 'extra') base[key] = value;
    }
  }

  const fotos = [];
  const fotoKeys = new Set();
  for (const node of chain) {
    if (!Array.isArray(node.fotos)) continue;
    for (const foto of node.fotos) {
      if (!foto || typeof foto !== 'object') continue;
      const key = foto.path || foto.url || JSON.stringify(foto);
      if (fotoKeys.has(key)) continue;
      fotoKeys.add(key);
      fotos.push(foto);
    }
  }

  const deepest = chain[chain.length - 1] || {};
  const deepestLooksLikeOrder = (
    Object.prototype.hasOwnProperty.call(deepest, 'id') ||
    Object.prototype.hasOwnProperty.call(deepest, 'numero') ||
    Object.prototype.hasOwnProperty.call(deepest, 'clienteId') ||
    Object.prototype.hasOwnProperty.call(deepest, 'cliente_id')
  );
  const extra = deepestLooksLikeOrder ? {} : { ...deepest };
  delete extra.extra;
  if (fotos.length) extra.fotos = fotos;
  else if (!Array.isArray(extra.fotos)) extra.fotos = [];

  base.extra = extra;
  return base;
}

function ordenToDb(o) {
  const snapshot = normalizarSnapshotOrden(o);
  return {
    id: o.id, tenant_id: tenantId(), numero: o.numero,
    cliente_id: o.clienteId, usuario_id: userId(),
    marca: o.marca, modelo: o.modelo, tipo_calzado: o.tipoCalzado || null,
    color: o.color, material: o.material, talla: o.talla,
    cantidad_pares: Number(o.cantidadPares) || 1,
    estado_calzado: o.estadoCalzado || null,
    tratamiento_sugerido: o.tratamientoSugerido || null,
    tipos_servicio: Array.isArray(o.tipoServicio) ? o.tipoServicio : [],
    prioridad: o.prioridad || 'Media', estado: o.estado || 'Recibido y registrado',
    observaciones: o.observaciones || null, responsable: o.responsable || null,
    fecha_ingreso: o.fechaIngreso || null,
    fecha_estimada: o.fechaEstimada || null,
    fecha_entrega: o.fechaEntrega || null,
    precio: Number(o.precio) || 0, descuento: Number(o.descuento) || 0,
    pagado: Number(o.pagado) || 0, pagado_qr: Number(o.pagadoQR) || 0,
    pagado_efectivo: Number(o.pagadoEfectivo) || 0,
    metodo_pago: o.metodoPago || null, fecha_pago: o.fechaPago || null,
    estado_pago: o.estadoPago || 'Pendiente',
    ia_resultado: o.iaResultado || null,
    ia_confianza: o.iaResultado && o.iaResultado.confianza != null ? Number(o.iaResultado.confianza) : null,
    timeline_index: Number(o.timelineIndex) || 0,
    timeline_dates: o.timelineDates || {},
    control_calidad: o.controlCalidad || {},
    firma_ingreso: o.firmaIngreso || null,
    firma_retiro: o.firmaRetiro || null,
    firma_recepcionista: o.firmaRecepcionista || null,
    entregado: !!o.entregado,
    extra: snapshot
  };
}
function ordenFromDb(r) {
  const base = normalizarSnapshotOrden(
    (r.extra && typeof r.extra === 'object') ? r.extra : {}
  );
  base.id = r.id;
  base.numero = r.numero != null ? r.numero : base.numero;
  base.clienteId = base.clienteId || r.cliente_id;
  base.estado = base.estado || r.estado;
  base.estadoPago = base.estadoPago || r.estado_pago;
  base.timelineIndex = r.timeline_index != null ? r.timeline_index : base.timelineIndex;
  base.timelineDates = r.timeline_dates || base.timelineDates || {};
  base.controlCalidad = r.control_calidad || base.controlCalidad || {};
  base.firmaIngreso = r.firma_ingreso || base.firmaIngreso;
  base.firmaRetiro = r.firma_retiro || base.firmaRetiro;
  base.firmaRecepcionista = r.firma_recepcionista || base.firmaRecepcionista;
  base.entregado = r.entregado != null ? r.entregado : base.entregado;
  base._egressSlim = false;
  return base;
}

/* --- gastos --- */
function gastoToDb(g) {
  return {
    id: g.id, tenant_id: tenantId(), categoria: g.categoria,
    monto: Number(g.monto) || 0, fecha: g.fecha,
    descripcion: g.descripcion || null, usuario_id: userId()
  };
}
function gastoFromDb(r) {
  return {
    id: r.id, categoria: r.categoria, monto: Number(r.monto) || 0,
    fecha: r.fecha, descripcion: r.descripcion || ''
  };
}

/* --- inventario --- */
function invToDb(i) {
  return {
    id: i.id, tenant_id: tenantId(), nombre: i.nombre, categoria: i.categoria,
    proveedor: i.proveedor || null, cantidad: Number(i.cantidad) || 0,
    stock_minimo: Number(i.stockMinimo) || 0, precio_compra: Number(i.precioCompra) || 0,
    fecha_compra: i.fechaCompra || null, fecha_vencimiento: i.fechaVencimiento || null
  };
}
function invFromDb(r) {
  return {
    id: r.id, nombre: r.nombre, categoria: r.categoria, proveedor: r.proveedor || '',
    cantidad: Number(r.cantidad) || 0, stockMinimo: Number(r.stock_minimo) || 0,
    precioCompra: Number(r.precio_compra) || 0, fechaCompra: r.fecha_compra || '',
    fechaVencimiento: r.fecha_vencimiento || ''
  };
}

/* --- users (empleados) --- */
export function userFromDb(r) {
  return {
    id: r.id, tenantId: r.tenant_id, nombre: r.nombre, email: r.email,
    rol: r.rol, activo: r.activo !== false
  };
}

/* ============================================================
   ESCRITURA GENÉRICA (con cola offline)
   ============================================================ */

function isPermanentError(e) {
  if (!e) return false;
  if (e.code && typeof e.code === 'string' && /^[0-9A-Z]/.test(e.code)) return true;
  const st = e.status || e.statusCode;
  if (st && st >= 400 && st < 500) return true;
  return false;
}

async function pushUpsert(table, row) {
  if (!online()) { enqueue({ op: 'upsert', table, row }); return { queued: true }; }
  try {
    const { data, error } = await supabase.from(table).upsert(row).select();
    if (error) throw error;
    if (data && data[0] && data[0].id && row && row.id && row.id !== data[0].id) {
      applyIdToState(row.id, data[0].id);
    }
    return { ok: true, data };
  } catch (e) {
    if (isPermanentError(e)) {
      console.error('Error permanente al guardar en ' + table + ' (no se reintenta):', e.message || e);
      return { error: e };
    }
    console.error('Error al guardar en ' + table + ', se encola:', e.message || e);
    enqueue({ op: 'upsert', table, row });
    return { queued: true, error: e };
  }
}

async function pushDelete(table, id) {
  if (!online()) { enqueue({ op: 'delete', table, id }); return { queued: true }; }
  try {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    if (isPermanentError(e)) {
      console.error('Error permanente al eliminar en ' + table + ' (no se reintenta):', e.message || e);
      return { error: e };
    }
    console.error('Error al eliminar en ' + table + ', se encola:', e.message || e);
    enqueue({ op: 'delete', table, id });
    return { queued: true, error: e };
  }
}

/* ============================================================
   API por entidad (usada por los módulos de features)
   ============================================================ */
export const saveCliente = (c) => pushUpsert('clientes', clienteToDb(c));
export const deleteCliente = (id) => pushDelete('clientes', id);
export async function saveOrden(o) {
  const row = ordenToDb(o);
  const res = await pushUpsert('ordenes', row);
  // El resumen liviano alimenta Dashboard/Notificaciones. Mantenerlo al día
  // con las escrituras locales evita que una nueva orden, pago o entrega
  // aparezca recién después de volver a iniciar sesión.
  if (Array.isArray(state.dashboardOrders) && (res?.ok || res?.queued)) {
    if (o && o.eliminada === true) {
      state.dashboardOrders = state.dashboardOrders.filter(x => x.id !== o.id);
    } else {
      const slim = ordenSlimFromDb(row);
      const idx = state.dashboardOrders.findIndex(x => x.id === slim.id);
      if (idx >= 0) state.dashboardOrders[idx] = { ...state.dashboardOrders[idx], ...slim };
      else state.dashboardOrders.push(slim);
    }
  }
  return res;
}

/** Obtiene el próximo número de orden exclusivamente de la BD.
 *  Crear una orden nueva requiere conexión: nunca se usa un número local provisional. */
export async function siguienteOrdenNumero() {
  if (!online() || !supabase) {
    throw new Error('ORDER_NUMBER_REQUIRES_ONLINE');
  }
  const { data, error } = await supabase.rpc('siguiente_orden_numero', {
    p_tenant_id: tenantId()
  });
  if (error) throw error;
  const numero = Number(data);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error('ORDER_NUMBER_INVALID_RESPONSE');
  }
  return numero;
}
export const deleteOrden = (id) => pushDelete('ordenes', id);

export async function deleteOrdenPapeleraSeguro(id) {
  if (!online() || !supabase) return { error: new Error('Necesitas conexión para eliminar definitivamente') };
  try {
    const { data, error } = await supabase.rpc('eliminar_orden_papelera_seguro', { p_order_id: id });
    if (error) throw error;
    return { ok: true, data };
  } catch (e) {
    return { error: e };
  }
}
export const saveGasto = (g) => pushUpsert('gastos', gastoToDb(g));
export const deleteGasto = (id) => pushDelete('gastos', id);

export async function saveInventario(i) {
  const row = invToDb(i);
  const res = await pushUpsert('inventario', row);
  if (res.ok && res.data && res.data[0] && res.data[0].id) {
    i.id = res.data[0].id;
  }
  return res;
}
export const deleteInventario = (id) => pushDelete('inventario', id);

/* --- registro_pares --- */
function registroParToDb(r) {
  const urls = Array.isArray(r.fotoUrls) ? r.fotoUrls : (r.fotoUrl ? [r.fotoUrl] : []);
  return {
    id: r.id, tenant_id: tenantId(), empleado: r.empleado, fecha: r.fecha,
    pares: Number(r.pares) || 0, foto_url: urls[0] || null, foto_urls: urls,
    usuario_id: userId(),
    codigo: r.codigo || null, servicio: r.servicio || null, hora: r.hora || null,
    observacion: r.observacion || null
  };
}
function registroParFromDb(r) {
  const urls = Array.isArray(r.foto_urls) && r.foto_urls.length ? r.foto_urls : (r.foto_url ? [r.foto_url] : []);
  // Respaldo para registros viejos sin "hora" guardada: se toma la hora de
  // created_at (columna que ya existía en la tabla desde el inicio).
  const horaRespaldo = (!r.hora && r.created_at)
    ? new Date(r.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : null;
  return {
    id: r.id, empleado: r.empleado, fecha: r.fecha, pares: Number(r.pares) || 0,
    fotoUrls: urls, fotoUrl: urls[0] || '', usuarioId: r.usuario_id || null,
    codigo: r.codigo || null, servicio: r.servicio || null, hora: r.hora || horaRespaldo || null,
    observacion: r.observacion || null
  };
}
export const saveRegistroPar = (r) => pushUpsert('registro_pares', registroParToDb(r));
export const deleteRegistroPar = (id) => pushDelete('registro_pares', id);

export async function deleteRegistroParSeguro(id) {
  if (!online() || !supabase) return { error: new Error('Necesitas conexión para eliminar un registro de producción') };
  try {
    const { data, error } = await supabase.rpc('eliminar_registro_produccion_seguro', { p_registro_id: id });
    if (error) throw error;
    return { ok: true, data };
  } catch (e) {
    return { error: e };
  }
}

/* --- orden_items --- */
function itemToDb(it) {
  return {
    id: it.id, tenant_id: tenantId(), orden_id: it.ordenId, numero_item: it.numeroItem,
    codigo: it.codigo, descripcion: it.descripcion || null,
    estado: it.estado || 'Recibido y registrado',
    tipo_servicio: Array.isArray(it.tipoServicio) ? it.tipoServicio : [],
    responsable: it.responsable || null,
    fecha_ingreso: it.fechaIngreso || null, fecha_entrega_estimada: it.fechaEntregaEstimada || null,
    precio: Number(it.precio) || 0,
    entregado: !!it.entregado, fecha_entrega: it.fechaEntrega || null,
    marca: it.marca || null, modelo: it.modelo || null, tipo_calzado: it.tipoCalzado || null,
    color: it.color || null, material: it.material || null,
    estado_calzado: it.estadoCalzado || null, tratamiento_sugerido: it.tratamientoSugerido || null,
    timeline_index: it.timelineIndex || 0,
    timeline_dates: it.timelineDates && typeof it.timelineDates === 'object' ? it.timelineDates : {},
    control_calidad: it.controlCalidad && typeof it.controlCalidad === 'object' ? it.controlCalidad : {},
    biblioteca: it.biblioteca && typeof it.biblioteca === 'object' ? it.biblioteca : {},
    registro_servicios: it.registroServicios && typeof it.registroServicios === 'object' ? it.registroServicios : {}
  };
}
function itemFromDb(r) {
  return {
    id: r.id, ordenId: r.orden_id, numeroItem: r.numero_item, codigo: r.codigo,
    descripcion: r.descripcion || '', estado: r.estado || 'Recibido y registrado',
    tipoServicio: Array.isArray(r.tipo_servicio) ? r.tipo_servicio : [],
    responsable: r.responsable || '',
    fechaIngreso: r.fecha_ingreso || '', fechaEntregaEstimada: r.fecha_entrega_estimada || '',
    precio: Number(r.precio) || 0,
    entregado: !!r.entregado, fechaEntrega: r.fecha_entrega || null,
    marca: r.marca || '', modelo: r.modelo || '', tipoCalzado: r.tipo_calzado || '',
    color: r.color || '', material: r.material || '',
    estadoCalzado: r.estado_calzado || '', tratamientoSugerido: r.tratamiento_sugerido || '',
    timelineIndex: r.timeline_index || 0,
    timelineDates: r.timeline_dates && typeof r.timeline_dates === 'object' ? r.timeline_dates : {},
    controlCalidad: r.control_calidad && typeof r.control_calidad === 'object' ? r.control_calidad : {},
    biblioteca: r.biblioteca && typeof r.biblioteca === 'object' ? r.biblioteca : {},
    registroServicios: r.registro_servicios && typeof r.registro_servicios === 'object' ? r.registro_servicios : {}
  };
}
export const saveOrdenItem = (it) => pushUpsert('orden_items', itemToDb(it));
export const deleteOrdenItem = (id) => pushDelete('orden_items', id);

/** Recarga desde Supabase únicamente los artículos de una orden.
 *  Se usa al mostrar Órdenes para reparar una caché local parcial sin
 *  modificar ni recrear artículos en la base. */

/* ============================================================
   CARGA EFICIENTE / EGRESS
   ============================================================
   La app ya no necesita precargar todo el histórico en cada login.
   Estas funciones mantienen la misma fuente de verdad (Supabase), pero:
   - cargan 20 órdenes al inicio;
   - agregan 30 por página cuando hace falta;
   - buscan órdenes/artículos antiguos directamente en Postgres;
   - Producción carga el día actual y consulta código+servicio exactos;
   - pantallas históricas pesadas se hidratan solo al abrirlas.
   Ninguna función borra datos.
   ============================================================ */

const EG_CLIENT_COLS = 'id,nombre,telefono,whatsapp,email,direccion,rfc,observaciones,eliminada,created_at';
const EG_ORDER_COLS = 'id,numero,cliente_id,marca,modelo,tipo_calzado,color,material,talla,cantidad_pares,estado_calzado,tratamiento_sugerido,tipos_servicio,prioridad,estado,observaciones,responsable,fecha_ingreso,fecha_estimada,fecha_entrega,precio,descuento,pagado,pagado_qr,pagado_efectivo,metodo_pago,fecha_pago,estado_pago,ia_resultado,ia_confianza,timeline_index,timeline_dates,control_calidad,firma_ingreso,firma_retiro,firma_recepcionista,entregado,extra';
const EG_ORDER_SLIM_COLS = 'id,numero,cliente_id,prioridad,estado,responsable,fecha_ingreso,fecha_estimada,fecha_entrega,precio,descuento,pagado,pagado_qr,pagado_efectivo,metodo_pago,fecha_pago,estado_pago,cantidad_pares,entregado';
const EG_ITEM_COLS = 'id,orden_id,numero_item,codigo,descripcion,estado,tipo_servicio,responsable,fecha_ingreso,fecha_entrega_estimada,precio,entregado,fecha_entrega,marca,modelo,tipo_calzado,color,material,estado_calzado,tratamiento_sugerido,timeline_index,timeline_dates,control_calidad,biblioteca,registro_servicios';
const EG_PARES_COLS = 'id,empleado,fecha,pares,foto_url,foto_urls,usuario_id,codigo,servicio,hora,observacion,created_at';
const EG_CONFIG_MIN_COLS = 'tenant_id,nombre_negocio,whatsapp_negocio,email_negocio,prefijo_factura,mensaje_whatsapp_template,color_primario,moneda,simbolo_moneda,siguiente_orden,siguiente_factura,logo_url,updated_at';

function egressMeta() {
  if (!state._egress || typeof state._egress !== 'object') {
    state._egress = {
      optimized: true,
      orderPageIds: [],
      orderCursor: null,
      orderHasMore: true,
      orderTotal: null,
      clientsFull: false,
      dashboardLoaded: false,
      libraryLoaded: false,
      agendaLoaded: false,
      fullOperationalLoaded: false,
      configFull: false,
      productionDates: {},
      galleryPageIds: [],
      galleryCursor: null,
      galleryHasMore: true,
      galleryInitialized: false
    };
  }
  if (!Array.isArray(state._egress.orderPageIds)) state._egress.orderPageIds = [];
  if (!state._egress.productionDates || typeof state._egress.productionDates !== 'object') state._egress.productionDates = {};
  if (!Array.isArray(state._egress.galleryPageIds)) state._egress.galleryPageIds = [];
  return state._egress;
}

export function getEgressMeta() {
  return egressMeta();
}

function mergeById(base, incoming) {
  const map = new Map((base || []).filter(Boolean).map(x => [x.id, x]));
  (incoming || []).filter(Boolean).forEach(x => {
    const prev = map.get(x.id);
    map.set(x.id, prev ? { ...prev, ...x } : x);
  });
  return Array.from(map.values());
}

function ordenSlimFromDb(r) {
  return {
    id: r.id,
    numero: r.numero,
    clienteId: r.cliente_id || null,
    prioridad: r.prioridad || 'Media',
    estado: r.estado || 'Recibido y registrado',
    responsable: r.responsable || '',
    fechaIngreso: r.fecha_ingreso || '',
    fechaEstimada: r.fecha_estimada || '',
    fechaEntrega: r.fecha_entrega || null,
    precio: Number(r.precio || 0),
    descuento: Number(r.descuento || 0),
    pagado: Number(r.pagado || 0),
    pagadoQR: Number(r.pagado_qr || 0),
    pagadoEfectivo: Number(r.pagado_efectivo || 0),
    metodoPago: r.metodo_pago || '',
    fechaPago: r.fecha_pago || null,
    estadoPago: r.estado_pago || 'Pendiente',
    cantidadPares: Number(r.cantidad_pares || 0),
    entregado: !!r.entregado,
    extra: { fotos: [] },
    _egressSlim: true
  };
}

function mergeSlimOrdersIntoState(incoming) {
  const map = new Map((state.ordenes || []).filter(Boolean).map(o => [o.id, o]));
  (incoming || []).forEach(o => {
    const prev = map.get(o.id);
    // Nunca degradar una orden completa (con extra/fotos reales) a una fila
    // liviana de Dashboard/Agenda/Biblioteca.
    if (prev && prev._egressSlim !== true) return;
    map.set(o.id, prev ? { ...prev, ...o } : o);
  });
  state.ordenes = Array.from(map.values());
}

async function loadSlimOrderContextsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))].slice(0, 500);
  if (!unique.length) return [];
  const { data, error } = await supabase.from('ordenes')
    .select(EG_ORDER_SLIM_COLS)
    .eq('tenant_id', tenantId())
    .in('id', unique)
    .or('extra->>eliminada.is.null,extra->>eliminada.eq.false');
  if (error) throw error;
  const rows = (data || []).map(ordenSlimFromDb);
  mergeSlimOrdersIntoState(rows);
  await loadClientsByIds(rows.map(o => o.clienteId));
  return rows;
}

async function loadClientsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await supabase
    .from('clientes')
    .select(EG_CLIENT_COLS)
    .eq('tenant_id', tenantId())
    .in('id', unique);
  if (error) throw error;
  const rows = (data || []).map(clienteFromDb).filter(c => !c.eliminada);
  state.clientes = mergeById(state.clientes || [], rows);
  return rows;
}

async function loadProductionByCodes(codes) {
  const unique = [...new Set((codes || []).filter(Boolean))];
  if (!unique.length) return [];
  const out = [];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const { data, error } = await supabase
      .from('registro_pares')
      .select(EG_PARES_COLS)
      .eq('tenant_id', tenantId())
      .in('codigo', chunk);
    if (error) throw error;
    out.push(...(data || []).map(registroParFromDb));
  }
  state.registroPares = mergeById(state.registroPares || [], out);
  return out;
}

async function hydrateOrders(orders, opts = {}) {
  const includeProduction = opts.includeProduction !== false;
  const ids = [...new Set((orders || []).map(o => o.id).filter(Boolean))];
  const clientIds = [...new Set((orders || []).map(o => o.clienteId).filter(Boolean))];
  if (!ids.length) {
    await loadClientsByIds(clientIds);
    return [];
  }

  const [{ data: itemRows, error: itemErr }] = await Promise.all([
    supabase.from('orden_items')
      .select(EG_ITEM_COLS)
      .eq('tenant_id', tenantId())
      .in('orden_id', ids)
      .order('numero_item', { ascending: true }),
    loadClientsByIds(clientIds)
  ]);
  if (itemErr) throw itemErr;
  const items = (itemRows || []).map(itemFromDb);
  state.ordenItems = mergeById(state.ordenItems || [], items);
  if (includeProduction) {
    await loadProductionByCodes(items.map(it => it.codigo));
  }
  return items;
}

async function loadOrderContextsByIds(ids, opts = {}) {
  const unique = [...new Set((ids || []).filter(Boolean))].slice(0, 120);
  if (!unique.length) return [];
  const { data, error } = await supabase
    .from('ordenes')
    .select(EG_ORDER_COLS)
    .eq('tenant_id', tenantId())
    .in('id', unique)
    .or('extra->>eliminada.is.null,extra->>eliminada.eq.false');
  if (error) throw error;
  const orders = (data || []).map(ordenFromDb).filter(o => !o.eliminada);
  state.ordenes = mergeById(state.ordenes || [], orders);
  await hydrateOrders(orders, opts);
  return orders;
}

export async function loadOrderPage({ limit = 20, beforeNumero = null, reset = false } = {}) {
  if (!online() || !tenantId()) return { error: 'NO_CONNECTION' };
  const meta = egressMeta();
  try {
    if (reset) {
      state.ordenes = [];
      state.ordenItems = [];
      state.clientes = [];
      meta.orderPageIds = [];
      meta.orderCursor = null;
      meta.orderHasMore = true;
    }

    let q = supabase
      .from('ordenes')
      .select(EG_ORDER_COLS, beforeNumero == null ? { count: 'exact' } : undefined)
      .eq('tenant_id', tenantId())
      .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
      .order('numero', { ascending: false })
      .limit(Math.max(1, Number(limit) || 20));
    if (beforeNumero != null) q = q.lt('numero', Number(beforeNumero));

    const { data, error, count } = await q;
    if (error) throw error;
    const raw = data || [];
    const orders = raw.map(ordenFromDb).filter(o => !o.eliminada);
    state.ordenes = mergeById(state.ordenes || [], orders);

    const pageIds = orders.map(o => o.id);
    meta.orderPageIds = [...new Set(meta.orderPageIds.concat(pageIds))];
    if (raw.length) meta.orderCursor = Math.min(...raw.map(r => Number(r.numero)).filter(Number.isFinite));
    if (beforeNumero == null && Number.isFinite(count)) meta.orderTotal = count;
    meta.orderHasMore = raw.length >= Math.max(1, Number(limit) || 20);

    await hydrateOrders(orders, { includeProduction: true });

    const maxNumero = orders.reduce((max, o) => Math.max(max, Number(o.numero) || 0), 0);
    if (maxNumero + 1 > state.nextOrderNum) state.nextOrderNum = maxNumero + 1;

    return { ok: true, orders, hasMore: meta.orderHasMore, total: meta.orderTotal, cursor: meta.orderCursor };
  } catch (e) {
    console.error('No se pudo cargar la página de órdenes:', e);
    return { error: e };
  }
}

export async function loadNextOrderPage(limit = 30) {
  const meta = egressMeta();
  if (!meta.orderHasMore || meta.orderCursor == null) return { ok: true, orders: [], hasMore: false };
  return loadOrderPage({ limit, beforeNumero: meta.orderCursor, reset: false });
}

export async function loadProductionDate(fecha = todayISO(0), opts = {}) {
  if (!online() || !tenantId()) return { error: 'NO_CONNECTION' };
  try {
    let q = supabase
      .from('registro_pares')
      .select(EG_PARES_COLS)
      .eq('tenant_id', tenantId())
      .eq('fecha', fecha);
    if (opts.ownOnly && userId()) q = q.eq('usuario_id', userId());
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).map(registroParFromDb);
    const otros = (state.registroPares || []).filter(r => r.fecha !== fecha);
    state.registroPares = mergeById(otros, rows);
    egressMeta().productionDates[fecha] = true;
    return { ok: true, rows };
  } catch (e) {
    console.error('No se pudo cargar Producción de la fecha:', e);
    return { error: e };
  }
}

export async function loadProductionRange(desde, hasta) {
  if (!online() || !tenantId() || !desde || !hasta) return { error: 'NO_CONNECTION' };
  try {
    const { data, error } = await supabase
      .from('registro_pares')
      .select(EG_PARES_COLS)
      .eq('tenant_id', tenantId())
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).map(registroParFromDb);
    const otros = (state.registroPares || []).filter(r => !(r.fecha >= desde && r.fecha <= hasta));
    state.registroPares = mergeById(otros, rows);
    const d = new Date(desde + 'T12:00:00');
    const fin = new Date(hasta + 'T12:00:00');
    const meta = egressMeta();
    while (!isNaN(d.getTime()) && d <= fin) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      meta.productionDates[y + '-' + m + '-' + day] = true;
      d.setDate(d.getDate() + 1);
    }
    return { ok: true, rows };
  } catch (e) {
    console.error('No se pudo cargar el rango de Producción:', e);
    return { error: e };
  }
}

export async function findProductionExisting(codigo, servicio) {
  if (!online() || !tenantId() || !codigo || !servicio) return null;
  try {
    const { data, error } = await supabase
      .from('registro_pares')
      .select(EG_PARES_COLS)
      .eq('tenant_id', tenantId())
      .eq('codigo', codigo)
      .eq('servicio', servicio)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = registroParFromDb(data);
    state.registroPares = mergeById(state.registroPares || [], [row]);
    return row;
  } catch (e) {
    console.error('No se pudo comprobar el registro existente:', e);
    return null;
  }
}

export async function fetchItemContextByCode(codigo) {
  const clean = String(codigo || '').trim().replace(/[#\s]/g, '');
  if (!online() || !tenantId() || !clean) return null;
  try {
    const { data, error } = await supabase
      .from('orden_items')
      .select(EG_ITEM_COLS)
      .eq('tenant_id', tenantId())
      .eq('codigo', clean)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const item = itemFromDb(data);
    state.ordenItems = mergeById(state.ordenItems || [], [item]);
    await loadOrderContextsByIds([item.ordenId], { includeProduction: true });
    return (state.ordenItems || []).find(it => it.id === item.id) || item;
  } catch (e) {
    console.error('No se pudo buscar el artículo ' + clean + ':', e);
    return null;
  }
}

function normalizeSearch(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function safeProbe(v) {
  return String(v || '').replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function remoteSearchCandidateOrderIds(text) {
  const norm = normalizeSearch(text);
  const tokens = norm.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const probe = safeProbe(tokens[0]);
  const ids = new Set();

  if (/^\d+$/.test(norm)) {
    const { data } = await supabase.from('ordenes')
      .select('id')
      .eq('tenant_id', tenantId())
      .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
      .eq('numero', Number(norm))
      .limit(10);
    (data || []).forEach(r => ids.add(r.id));
  }

  if (/^\d+-\d+$/.test(norm)) {
    const { data } = await supabase.from('orden_items')
      .select('orden_id')
      .eq('tenant_id', tenantId())
      .eq('codigo', norm)
      .limit(10);
    (data || []).forEach(r => ids.add(r.orden_id));
  }

  if (probe) {
    const p = '%' + probe + '%';
    const [items, orders, clients] = await Promise.all([
      supabase.from('orden_items')
        .select('orden_id')
        .eq('tenant_id', tenantId())
        .or('codigo.ilike.' + p + ',descripcion.ilike.' + p + ',marca.ilike.' + p + ',modelo.ilike.' + p + ',talla.ilike.' + p + ',color.ilike.' + p)
        .limit(200),
      supabase.from('ordenes')
        .select('id')
        .eq('tenant_id', tenantId())
        .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
        .or('marca.ilike.' + p + ',modelo.ilike.' + p + ',talla.ilike.' + p + ',color.ilike.' + p)
        .limit(120),
      supabase.from('clientes')
        .select('id')
        .eq('tenant_id', tenantId())
        .or('nombre.ilike.' + p + ',telefono.ilike.' + p + ',whatsapp.ilike.' + p)
        .limit(120)
    ]);
    if (!items.error) (items.data || []).forEach(r => ids.add(r.orden_id));
    if (!orders.error) (orders.data || []).forEach(r => ids.add(r.id));
    if (!clients.error && (clients.data || []).length) {
      const clientIds = (clients.data || []).map(r => r.id);
      const { data: byClient, error: byClientErr } = await supabase.from('ordenes')
        .select('id')
        .eq('tenant_id', tenantId())
        .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
        .in('cliente_id', clientIds)
        .order('numero', { ascending: false })
        .limit(200);
      if (!byClientErr) (byClient || []).forEach(r => ids.add(r.id));
    }
  }

  return [...ids].slice(0, 120);
}

export async function fetchOrderContextById(id) {
  if (!id) return null;
  const rows = await loadOrderContextsByIds([id], { includeProduction: true });
  return rows[0] || (state.ordenes || []).find(o => o.id === id) || null;
}

export async function searchOrdersGlobal(text, limit = 30) {
  const norm = normalizeSearch(text);
  if (!norm) return [];
  try {
    const ids = await remoteSearchCandidateOrderIds(norm);
    await loadOrderContextsByIds(ids, { includeProduction: true });
    const tokens = norm.split(' ').filter(Boolean);
    const itemsByOrder = new Map();
    (state.ordenItems || []).forEach(it => {
      if (!itemsByOrder.has(it.ordenId)) itemsByOrder.set(it.ordenId, []);
      itemsByOrder.get(it.ordenId).push(it);
    });
    const found = (state.ordenes || []).filter(o => ids.includes(o.id)).filter(o => {
      const cli = (state.clientes || []).find(c => c.id === o.clienteId);
      const items = itemsByOrder.get(o.id) || [];
      const hay = normalizeSearch([
        o.numero, o.marca, o.modelo, o.talla, o.color,
        cli && cli.nombre, cli && cli.telefono, cli && cli.whatsapp,
        ...items.flatMap(it => [it.codigo, it.descripcion, it.marca, it.modelo, it.talla, it.color])
      ].filter(Boolean).join(' '));
      return tokens.every(t => hay.includes(t));
    }).sort((a,b) => Number(b.numero || 0) - Number(a.numero || 0)).slice(0, limit);
    egressMeta().lastSearchOrderIds = found.map(o => o.id);
    return found;
  } catch (e) {
    console.error('No se pudo buscar órdenes en Supabase:', e);
    return [];
  }
}

export async function searchGalleryItems(text, limit = 20) {
  const norm = normalizeSearch(text);
  if (!norm) return [];
  await searchOrdersGlobal(norm, 80);
  const ids = new Set(egressMeta().lastSearchOrderIds || []);
  const tokens = norm.split(' ').filter(Boolean);
  return (state.ordenItems || []).filter(it => ids.has(it.ordenId)).filter(it => {
    const o = (state.ordenes || []).find(x => x.id === it.ordenId);
    const cli = o ? (state.clientes || []).find(c => c.id === o.clienteId) : null;
    const hay = normalizeSearch([
      it.codigo, it.descripcion, it.marca, it.modelo, it.talla, it.color, it.tipoCalzado, it.material,
      o && o.numero, o && o.marca, o && o.modelo, o && o.talla, o && o.color,
      cli && cli.nombre, cli && cli.telefono, cli && cli.whatsapp
    ].filter(Boolean).join(' '));
    return tokens.every(t => hay.includes(t));
  }).slice(0, limit);
}


function orderHasGalleryPhotos(order) {
  if (!order) return false;
  const orderPhotos = order.extra && Array.isArray(order.extra.fotos) ? order.extra.fotos : [];
  if (orderPhotos.length) return true;
  const codes = new Set((state.ordenItems || []).filter(it => it.ordenId === order.id).map(it => it.codigo).filter(Boolean));
  if (!codes.size) return false;
  return (state.registroPares || []).some(r => {
    if (!codes.has(r.codigo)) return false;
    const urls = Array.isArray(r.fotoUrls) ? r.fotoUrls : (r.fotoUrl ? [r.fotoUrl] : []);
    return urls.length > 0;
  });
}

export async function loadGalleryPage(target = 20, { reset = false } = {}) {
  if (!online() || !tenantId()) return { error: 'NO_CONNECTION' };
  const meta = egressMeta();
  try {
    if (reset) {
      meta.galleryPageIds = [];
      meta.galleryCursor = null;
      meta.galleryHasMore = true;
      meta.galleryInitialized = false;
    }
    if (!meta.galleryHasMore && meta.galleryInitialized) {
      return { ok: true, ids: [], hasMore: false };
    }

    const wanted = Math.max(1, Number(target) || 20);
    const added = [];
    let safety = 0;

    while (added.length < wanted && meta.galleryHasMore && safety < 12) {
      safety++;
      const scanSize = Math.max(1, Math.min(30, wanted - added.length));
      let q = supabase
        .from('ordenes')
        .select(EG_ORDER_COLS)
        .eq('tenant_id', tenantId())
        .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
        .order('numero', { ascending: false })
        .limit(scanSize);
      if (meta.galleryCursor != null) q = q.lt('numero', Number(meta.galleryCursor));

      const { data, error } = await q;
      if (error) throw error;
      const raw = data || [];
      if (!raw.length) {
        meta.galleryHasMore = false;
        break;
      }

      const orders = raw.map(ordenFromDb).filter(o => !o.eliminada);
      state.ordenes = mergeById(state.ordenes || [], orders);
      await hydrateOrders(orders, { includeProduction: true });

      let reachedTarget = false;
      let lastProcessedNumero = null;
      for (const o of orders) {
        lastProcessedNumero = Number(o.numero);
        if (!meta.galleryPageIds.includes(o.id) && !added.includes(o.id) && orderHasGalleryPhotos(o)) {
          added.push(o.id);
          if (added.length >= wanted) {
            reachedTarget = true;
            break;
          }
        }
      }

      // El cursor avanza solo hasta la última orden realmente examinada. Si
      // el lote contenía más candidatas de las necesarias, quedan disponibles
      // para la siguiente página y nunca se saltan carpetas.
      if (Number.isFinite(lastProcessedNumero)) meta.galleryCursor = lastProcessedNumero;
      if (!reachedTarget && raw.length < scanSize) meta.galleryHasMore = false;
    }

    meta.galleryPageIds = [...new Set(meta.galleryPageIds.concat(added))];
    meta.galleryInitialized = true;
    return { ok: true, ids: added, hasMore: meta.galleryHasMore };
  } catch (e) {
    console.error('No se pudo cargar la página de Galería:', e);
    return { error: e };
  }
}

export async function loadNextGalleryPage(limit = 30) {
  return loadGalleryPage(limit, { reset: false });
}

export async function loadAllClients() {
  const meta = egressMeta();
  if (meta.clientsFull) return { ok: true, rows: state.clientes || [] };
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select(EG_CLIENT_COLS)
      .eq('tenant_id', tenantId())
      .order('created_at', { ascending: false });
    if (error) throw error;
    const todos = (data || []).map(clienteFromDb);
    state.clientes = todos.filter(c => !c.eliminada);
    state.clientesEliminados = todos.filter(c => c.eliminada);
    meta.clientsFull = true;
    return { ok: true, rows: state.clientes };
  } catch (e) {
    console.error('No se pudieron cargar los clientes:', e);
    return { error: e };
  }
}

export async function loadDashboardData() {
  const meta = egressMeta();
  if (meta.dashboardLoaded) return { ok: true };
  try {
    const role = state.session && state.session.role;
    const orderPromise = supabase.from('ordenes')
      .select(EG_ORDER_SLIM_COLS)
      .eq('tenant_id', tenantId())
      .or('extra->>eliminada.is.null,extra->>eliminada.eq.false');
    const countPromise = supabase.from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId())
      .or('eliminada.is.null,eliminada.eq.false');
    const clientNamesPromise = supabase.from('clientes')
      .select('id,nombre')
      .eq('tenant_id', tenantId())
      .or('eliminada.is.null,eliminada.eq.false');
    const gastosPromise = role === 'Administrador'
      ? supabase.from('gastos').select('id,categoria,monto,fecha,descripcion').eq('tenant_id', tenantId())
      : Promise.resolve({ data: [], error: null });
    const [ord, cliCount, clientNames, gas] = await Promise.all([orderPromise, countPromise, clientNamesPromise, gastosPromise]);
    if (ord.error) throw ord.error;
    state.dashboardOrders = (ord.data || []).map(ordenSlimFromDb);
    state.dashboardClientCount = Number.isFinite(cliCount.count) ? cliCount.count : (state.clientes || []).length;
    if (!clientNames.error) {
      const slimClients = (clientNames.data || []).map(x => ({ id:x.id, nombre:x.nombre || '', telefono:'', whatsapp:'', email:'', direccion:'', rfc:'', observaciones:'', eliminada:false, creadoEn:null }));
      state.clientes = mergeById(state.clientes || [], slimClients);
    }
    if (!gas.error && role === 'Administrador') state.gastos = (gas.data || []).map(gastoFromDb);
    meta.dashboardLoaded = true;
    return { ok: true };
  } catch (e) {
    console.error('No se pudo cargar el resumen del Dashboard:', e);
    return { error: e };
  }
}

export async function loadBibliotecaCurrent() {
  const meta = egressMeta();
  if (meta.libraryLoaded) return { ok: true };
  try {
    const { data, error } = await supabase.from('orden_items')
      .select(EG_ITEM_COLS)
      .eq('tenant_id', tenantId())
      .eq('entregado', false)
      .gte('timeline_index', 5);
    if (error) throw error;
    const items = (data || []).map(itemFromDb);
    state.ordenItems = mergeById(state.ordenItems || [], items);
    // Biblioteca operativa necesita orden/cliente para identificar el par,
    // pero no necesita descargar fotos de 200+ órdenes al abrir la pantalla.
    await loadSlimOrderContextsByIds(items.map(it => it.ordenId));
    meta.libraryLoaded = true;
    return { ok: true, rows: items };
  } catch (e) {
    console.error('No se pudo cargar Biblioteca actual:', e);
    return { error: e };
  }
}

export async function loadBibliotecaDate(fecha) {
  if (!online() || !tenantId() || !fecha) return { error: 'NO_CONNECTION' };
  try {
    const { data, error } = await supabase.from('orden_items')
      .select(EG_ITEM_COLS)
      .eq('tenant_id', tenantId())
      .eq('biblioteca->>fecha', fecha)
      .order('codigo', { ascending: true });
    if (error) throw error;
    const items = (data || []).map(itemFromDb);
    state.ordenItems = mergeById(state.ordenItems || [], items);
    // El histórico con fecha es una acción explícita: ahí sí se hidratan solo
    // las órdenes de ese día para conservar sus portadas/fotos.
    await loadOrderContextsByIds(items.map(it => it.ordenId), { includeProduction: false });
    return { ok: true, rows: items };
  } catch (e) {
    console.error('No se pudo cargar el histórico de Biblioteca:', e);
    return { error: e };
  }
}

export async function loadAgendaData() {
  const meta = egressMeta();
  if (meta.agendaLoaded) return { ok: true };
  try {
    const [itemsRes, ordersRes] = await Promise.all([
      supabase.from('orden_items')
        .select(EG_ITEM_COLS)
        .eq('tenant_id', tenantId())
        .eq('entregado', false)
        .not('fecha_entrega_estimada', 'is', null),
      supabase.from('ordenes')
        .select(EG_ORDER_SLIM_COLS)
        .eq('tenant_id', tenantId())
        .or('extra->>eliminada.is.null,extra->>eliminada.eq.false')
        .neq('estado', 'Entregado')
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    const items = (itemsRes.data || []).map(itemFromDb);
    const orders = (ordersRes.data || []).map(ordenSlimFromDb);
    state.ordenItems = mergeById(state.ordenItems || [], items);
    mergeSlimOrdersIntoState(orders);
    await loadClientsByIds(orders.map(o => o.clienteId));
    meta.agendaLoaded = true;
    return { ok: true };
  } catch (e) {
    console.error('No se pudo cargar Agenda:', e);
    return { error: e };
  }
}

export async function loadFullConfig() {
  const meta = egressMeta();
  if (meta.configFull) return { ok: true, data: state.config || {} };
  if (!online() || !tenantId()) return { error: 'NO_CONNECTION' };
  try {
    const { data, error } = await supabase.from('configuracion_tenant')
      .select('*')
      .eq('tenant_id', tenantId())
      .maybeSingle();
    if (error) throw error;
    if (data) state.config = data;
    meta.configFull = true;
    return { ok: true, data: state.config || {} };
  } catch (e) {
    console.error('No se pudo cargar la configuración completa:', e);
    return { error: e };
  }
}

export async function loadInitialDataForRole() {
  if (!online() || !tenantId()) return false;
  try {
    const role = state.session && state.session.role;
    const meta = egressMeta();
    state.clientes = [];
    state.clientesEliminados = [];
    state.ordenes = [];
    state.ordenesEliminadas = [];
    state.ordenItems = [];
    state.registroPares = [];
    state.gastos = [];
    state.facturas = [];
    state.activityLog = [];
    state.notificaciones = [];
    meta.orderPageIds = [];
    meta.orderCursor = null;
    meta.orderHasMore = true;
    meta.orderTotal = null;
    meta.clientsFull = false;
    meta.dashboardLoaded = false;
    meta.libraryLoaded = false;
    meta.agendaLoaded = false;
    meta.fullOperationalLoaded = false;
    meta.configFull = false;
    meta.productionDates = {};
    meta.galleryPageIds = [];
    meta.galleryCursor = null;
    meta.galleryHasMore = true;
    meta.galleryInitialized = false;

    const common = [
      loadProductionDate(todayISO(0), { ownOnly: role === 'Empleado' }),
      supabase.from('inventario').select('id,nombre,categoria,proveedor,cantidad,stock_minimo,precio_compra,fecha_compra,fecha_vencimiento').eq('tenant_id', tenantId()),
      supabase.from('configuracion_tenant').select(EG_CONFIG_MIN_COLS).eq('tenant_id', tenantId()).maybeSingle()
    ];
    if (role !== 'Empleado') {
      common.push(loadDashboardData());
      common.push(supabase.from('notificaciones')
        .select('id,tipo,texto,leida,prioridad,orden_id,inventario_id,dedupe_key,created_at')
        .eq('tenant_id', tenantId()).eq('leida', false).order('created_at', { ascending: false }).limit(100));
      common.push(supabase.from('facturas')
        .select('id,numero,orden_id,cliente_id,nombre_cliente,total,created_at')
        .eq('tenant_id', tenantId()));
    }
    if (role === 'Administrador') {
      common.push(supabase.from('actividad_log')
        .select('created_at,accion,datos')
        .eq('tenant_id', tenantId()).order('created_at', { ascending: false }).limit(100));
    }

    const results = await Promise.all(common);
    const inv = results[1];
    const cfg = results[2];
    if (inv && !inv.error) state.inventario = (inv.data || []).map(invFromDb);
    if (cfg && !cfg.error && cfg.data) state.config = cfg.data;

    let idx = 3;
    if (role !== 'Empleado') {
      idx++; // loadDashboardData()
      const notif = results[idx++];
      const fact = results[idx++];
      if (notif && !notif.error) state.notificaciones = (notif.data || []).map(n => ({
        id:n.id, tipo:n.tipo, texto:n.texto, leida:!!n.leida, prioridad:n.prioridad || 'Media',
        ordenId:n.orden_id || null, inventarioId:n.inventario_id || null,
        dedupeKey:n.dedupe_key || null, fecha:n.created_at
      }));
      if (fact && !fact.error) state.facturas = (fact.data || []).map(f => ({
        id:f.id, numero:f.numero, ordenId:f.orden_id || null, clienteId:f.cliente_id || null,
        nombreCliente:f.nombre_cliente, total:Number(f.total || 0), fecha:f.created_at
      }));
    }
    if (role === 'Administrador') {
      const log = results[idx++];
      if (log && !log.error) state.activityLog = (log.data || []).map(r => ({
        fecha:r.created_at, accion:r.accion, usuario:(r.datos && r.datos.usuario) || '—'
      }));
    }
    meta.initialLoaded = true;
    return true;
  } catch (e) {
    console.error('No se pudo realizar la carga inicial optimizada:', e);
    return false;
  }
}

export async function ensureTabData(tab) {
  const meta = egressMeta();
  if (!online() || !tenantId()) return false;
  try {
    if (tab === 'dashboard') await loadDashboardData();
    else if (tab === 'clientes') await loadAllClients();
    else if (tab === 'ordenes' && !(meta.orderPageIds || []).length) await loadOrderPage({ limit: 20, reset: false });
    else if (tab === 'galeria' && !meta.galleryInitialized) await loadGalleryPage(20, { reset: true });
    else if (tab === 'produccion' && !meta.productionDates[todayISO(0)]) await loadProductionDate(todayISO(0), { ownOnly: state.session?.role === 'Empleado' });
    else if (tab === 'biblioteca') await loadBibliotecaCurrent();
    else if (tab === 'agenda') await loadAgendaData();
    else if (tab === 'configuracion' || tab === 'seguridad') await loadFullConfig();
    else if (['consulta','ia','finanzas','facturas','reportes'].includes(tab) && !meta.fullOperationalLoaded) {
      // Estas pantallas todavía dependen de colecciones históricas completas.
      // Se conserva su comportamiento exacto, pero el costo se paga solo si
      // el usuario realmente abre una de ellas.
      const ok = await loadAllData();
      if (ok) {
        meta.fullOperationalLoaded = true;
        meta.orderPageIds = (state.ordenes || []).map(o => o.id);
        meta.orderHasMore = false;
        meta.clientsFull = true;
        meta.dashboardLoaded = true;
      }
    }
    return true;
  } catch (e) {
    console.error('No se pudo preparar la pestaña ' + tab + ':', e);
    return false;
  }
}


export async function refreshOrdenItems(ordenId) {
  if (!online() || !supabase || !tenantId() || !ordenId) return { error: 'NO_CONNECTION' };
  try {
    const ITEM_REFRESH_COLS = 'id,orden_id,numero_item,codigo,descripcion,estado,tipo_servicio,responsable,fecha_ingreso,fecha_entrega_estimada,precio,entregado,fecha_entrega,marca,modelo,tipo_calzado,color,material,estado_calzado,tratamiento_sugerido,timeline_index,timeline_dates,control_calidad,biblioteca,registro_servicios';
    const { data, error } = await supabase
      .from('orden_items')
      .select(ITEM_REFRESH_COLS)
      .eq('orden_id', ordenId)
      .order('numero_item', { ascending: true });
    if (error) throw error;
    const frescos = (data || []).map(itemFromDb);
    const otros = (state.ordenItems || []).filter(it => it.ordenId !== ordenId);
    state.ordenItems = otros.concat(frescos);
    return { ok: true, items: frescos };
  } catch (e) {
    console.error('No se pudieron refrescar los artículos de la orden:', e);
    return { error: e };
  }
}

export const saveUser = (u) => pushUpsert('users', {
  id: u.id, tenant_id: tenantId(), nombre: u.nombre, email: u.email,
  rol: u.rol, activo: u.activo !== false
});

export async function createEmpleado(u) {
  if (!online()) return { error: { message: 'Sin conexión: no se puede crear el empleado ahora.' } };
  if (!tenantId()) return { error: { message: 'No hay un tenant activo.' } };
  try {
    const row = { id: u.id, tenant_id: tenantId(), nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo !== false };
    const { error } = await supabase.from('users').insert(row);
    if (error) return { error };
    return { ok: true };
  } catch (e) {
    return { error: e };
  }
}

export async function logRemote(accion) {
  if (!tenantId()) return;
  const row = {
    tenant_id: tenantId(), usuario_id: userId() || null, accion,
    datos: { usuario: state.session ? state.session.user : 'sistema' }
  };
  if (!online()) { enqueue({ op: 'insert', table: 'actividad_log', row }); return; }
  try {
    const { error } = await supabase.from('actividad_log').insert(row);
    if (error) throw error;
  } catch (e) {
    enqueue({ op: 'insert', table: 'actividad_log', row });
  }
}

/** Busca en el registro de actividad (bitácora) dentro de un rango de
 *  fechas puntual (ej. hasta 2 meses atrás), sin quedar limitado a los
 *  últimos 100 registros que carga loadAllData(). Devuelve null si no se
 *  pudo consultar (sin conexión / error), para que quien llama pueda
 *  avisar sin confundirlo con "no hay resultados". */
export async function fetchActivityLogRange(desde, hasta) {
  if (!online() || !supabase || !tenantId()) return null;
  try {
    let q = supabase.from('actividad_log').select('created_at,accion,datos').order('created_at', { ascending: false }).limit(1000);
    if (desde) q = q.gte('created_at', desde + 'T00:00:00');
    if (hasta) q = q.lte('created_at', hasta + 'T23:59:59');
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => ({
      fecha: r.created_at, accion: r.accion,
      usuario: (r.datos && r.datos.usuario) || '—'
    }));
  } catch (e) {
    console.error('No se pudo buscar la bitácora por fecha:', e);
    return null;
  }
}

export async function fetchLatestActivityLog(limit = 100) {
  if (!online() || !supabase || !tenantId()) return null;
  try {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
    const { data, error } = await supabase
      .from('actividad_log')
      .select('created_at,accion,datos')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    return (data || []).map(r => ({
      fecha: r.created_at,
      accion: r.accion,
      usuario: (r.datos && r.datos.usuario) || '—'
    }));
  } catch (e) {
    console.error('No se pudo recargar la bitácora:', e);
    return null;
  }
}

export async function saveConfig(cfg) {
  return pushUpsert('configuracion_tenant', { tenant_id: tenantId(), ...cfg });
}

/* ============================================================
   CARGA INICIAL DE DATOS DEL TENANT
   ============================================================ */
async function fetchAllRows(table, { orderColumn = null, ascending = true, pageSize = 500, columns = '*' } = {}) {
  const data = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (orderColumn) q = q.order(orderColumn, { ascending });
    const page = await q;
    if (page.error) return { data: [], error: page.error };
    const rows = page.data || [];
    data.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data, error: null };
}

export async function loadAllData() {
  if (!online() || !tenantId()) return false;
  try {
    // Carga completa de las entidades operativas, pero sin columnas que la UI
    // nunca usa. No se limita el historial: evita repetir el problema de filas
    // faltantes y reduce Egress/PostgREST sin cambiar la fuente de verdad.
    const CLIENTE_COLS = 'id,nombre,telefono,whatsapp,email,direccion,rfc,observaciones,eliminada,created_at';
    const ORDEN_COLS = 'id,numero,cliente_id,marca,modelo,tipo_calzado,color,material,talla,cantidad_pares,estado_calzado,tratamiento_sugerido,tipos_servicio,prioridad,estado,observaciones,responsable,fecha_ingreso,fecha_estimada,fecha_entrega,precio,descuento,pagado,pagado_qr,pagado_efectivo,metodo_pago,fecha_pago,estado_pago,ia_resultado,ia_confianza,timeline_index,timeline_dates,control_calidad,firma_ingreso,firma_retiro,firma_recepcionista,entregado,extra';
    const ITEM_COLS = 'id,orden_id,numero_item,codigo,descripcion,estado,tipo_servicio,responsable,fecha_ingreso,fecha_entrega_estimada,precio,entregado,fecha_entrega,marca,modelo,tipo_calzado,color,material,estado_calzado,tratamiento_sugerido,timeline_index,timeline_dates,control_calidad,biblioteca,registro_servicios';
    const PARES_COLS = 'id,empleado,fecha,pares,foto_url,foto_urls,usuario_id,codigo,servicio,hora,observacion,created_at';

    const [cli, ord, gas, inv, log, cfg, notif, fact, pares, items] = await Promise.all([
      supabase.from('clientes').select(CLIENTE_COLS),
      supabase.from('ordenes').select(ORDEN_COLS),
      supabase.from('gastos').select('id,categoria,monto,fecha,descripcion'),
      supabase.from('inventario').select('id,nombre,categoria,proveedor,cantidad,stock_minimo,precio_compra,fecha_compra,fecha_vencimiento'),
      supabase.from('actividad_log').select('created_at,accion,datos').order('created_at', { ascending: false }).limit(100),
      supabase.from('configuracion_tenant').select('*').eq('tenant_id', tenantId()).maybeSingle(),
      supabase.from('notificaciones')
        .select('id,tipo,texto,leida,prioridad,orden_id,inventario_id,dedupe_key,created_at')
        .eq('leida', false)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('facturas').select('id,numero,orden_id,cliente_id,nombre_cliente,total,created_at'),
      fetchAllRows('registro_pares', { orderColumn: 'created_at', ascending: false, columns: PARES_COLS }),
      fetchAllRows('orden_items', { orderColumn: 'numero_item', ascending: true, columns: ITEM_COLS })
    ]);
    if (!cli.error) {
      const todos = (cli.data || []).map(clienteFromDb);
      state.clientes = todos.filter(c => !c.eliminada);
      state.clientesEliminados = todos.filter(c => c.eliminada);
    }
    if (!ord.error) {
      const todas = (ord.data || []).map(ordenFromDb);
      state.ordenes = todas.filter(o => !o.eliminada);
      state.ordenesEliminadas = todas.filter(o => o.eliminada);
      const maxNumero = todas.reduce((max, o) => Math.max(max, Number(o.numero) || 0), 0);
      if (maxNumero + 1 > state.nextOrderNum) state.nextOrderNum = maxNumero + 1;
    }
    if (!gas.error) state.gastos = (gas.data || []).map(gastoFromDb);
    if (!inv.error) state.inventario = (inv.data || []).map(invFromDb);
    if (cfg && !cfg.error && cfg.data) state.config = cfg.data;
    if (!notif.error) {
      state.notificaciones = (notif.data || []).map(n => ({
        id: n.id, tipo: n.tipo, texto: n.texto, leida: !!n.leida,
        prioridad: n.prioridad || 'Media',
        ordenId: n.orden_id || null, inventarioId: n.inventario_id || null,
        dedupeKey: n.dedupe_key || null, fecha: n.created_at
      }));
    }
    if (!fact.error) {
      state.facturas = (fact.data || []).map(f => ({
        id: f.id, numero: f.numero, ordenId: f.orden_id || null, clienteId: f.cliente_id || null,
        nombreCliente: f.nombre_cliente, total: Number(f.total || 0), fecha: f.created_at
      }));
    }
    if (!pares.error) state.registroPares = (pares.data || []).map(registroParFromDb);
    if (!items.error) state.ordenItems = (items.data || []).map(itemFromDb);
    if (!log.error) {
      state.activityLog = (log.data || []).map(r => ({
        fecha: r.created_at, accion: r.accion,
        usuario: (r.datos && r.datos.usuario) || '—'
      }));
    }
    return true;
  } catch (e) {
    console.error('No se pudieron cargar los datos del tenant:', e);
    return false;
  }
}

export async function saveFactura(factura) {
  const row = {
    id: factura.id || crypto.randomUUID(),
    tenant_id: tenantId(),
    numero: factura.numero,
    orden_id: factura.ordenId || null,
    cliente_id: factura.clienteId || null,
    nombre_cliente: factura.nombreCliente || factura.nombre || '',
    rfc: factura.rfc || null,
    email: factura.email || null,
    telefono: factura.telefono || null,
    direccion: factura.direccion || null,
    concepto: factura.concepto || null,
    metodo_pago: factura.metodoPago || null,
    subtotal: factura.subtotal || 0,
    total: factura.total || 0
  };
  try {
    if (online()) {
      const { error } = await supabase.from('facturas').insert(row);
      if (error) throw error;
    } else {
      pushUpsert('facturas', row);
    }
    return { ok: true, id: row.id };
  } catch (e) {
    console.error('Error al guardar la factura:', e);
    return { error: e };
  }
}

export async function listUsers() {
  if (!online() || !tenantId()) return [];
  try {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(userFromDb);
  } catch (e) {
    console.error('No se pudieron listar los usuarios:', e);
    return [];
  }
}

export async function createNotification(notif) {
  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenantId(),
    tipo: notif.tipo,
    texto: notif.texto,
    orden_id: notif.ordenId || null,
    inventario_id: notif.inventarioId || null,
    prioridad: notif.prioridad || 'Media',
    dedupe_key: notif.dedupeKey || null,
    leida: false
  };
  try {
    if (online()) {
      const { error } = await supabase.from('notificaciones').insert(row);
      if (error && error.code === '23505' && row.dedupe_key) return { ok: true, duplicate: true };
      if (error) throw error;
    } else {
      pushUpsert('notificaciones', row);
    }
    state.notificaciones.push({
      id: row.id,
      tipo: row.tipo,
      texto: row.texto,
      ordenId: row.orden_id,
      inventarioId: row.inventario_id,
      prioridad: row.prioridad,
      dedupeKey: row.dedupe_key,
      leida: false
    });
    return { ok: true };
  } catch (e) {
    console.error('Error al crear notificación:', e);
    return { error: e.message };
  }
}

export async function markNotificationRead(notifId) {
  try {
    if (online()) {
      const { error } = await supabase
        .from('notificaciones')
        .update({ leida: true })
        .eq('id', notifId);
      if (error) throw error;
    } else {
      pushUpsert('notificaciones', { id: notifId, leida: true });
    }
    const n = state.notificaciones.find(x => x.id === notifId);
    if (n) n.leida = true;
    return { ok: true };
  } catch (e) {
    console.error('Error al marcar notificación como leída:', e);
    return { error: e.message };
  }
}

export async function markAllNotificationsRead() {
  try {
    if (!online()) return { error: 'OFFLINE' };
    const tenant = tenantId();
    if (!tenant) return { error: 'NO_TENANT' };
    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('tenant_id', tenant)
      .eq('leida', false);
    if (error) throw error;
    (state.notificaciones || []).forEach(n => { if (n) n.leida = true; });
    return { ok: true };
  } catch (e) {
    console.error('Error al marcar todas las notificaciones como leídas:', e);
    return { error: e.message || String(e) };
  }
}

/* ============================================================
   SINCRONIZACIÓN DE LA COLA OFFLINE
   ============================================================ */
export async function flushQueue() {
  if (!online()) return { flushed: 0, pending: getQueue().length };
  let q = getQueue();
  if (!q.length) return { flushed: 0, pending: 0 };

  const restantes = [];
  let flushed = 0;
  let descartadas = 0;
  const idMap = new Map();

  function replaceIdsInRow(row) {
    if (!row || typeof row !== 'object') return row;
    const cloned = JSON.parse(JSON.stringify(row));
    for (const k of Object.keys(cloned)) {
      const v = cloned[k];
      if (typeof v === 'string' && idMap.has(v)) cloned[k] = idMap.get(v);
      if (v && typeof v === 'object' && v.id && typeof v.id === 'string' && idMap.has(v.id)) {
        cloned[k].id = idMap.get(v.id);
      }
    }
    return cloned;
  }

  for (let i = 0; i < q.length; i++) {
    let op = q[i];
    try {
      if (op.row) op.row = replaceIdsInRow(op.row);
      if (op.op === 'delete' && op.id && idMap.has(op.id)) op.id = idMap.get(op.id);

      let data = null, error = null;
      if (op.op === 'upsert') ({ data, error } = await supabase.from(op.table).upsert(op.row).select());
      else if (op.op === 'insert') ({ data, error } = await supabase.from(op.table).insert(op.row).select());
      else if (op.op === 'delete') ({ error } = await supabase.from(op.table).delete().eq('id', op.id));

      if (error) throw error;

      if ((op.op === 'upsert' || op.op === 'insert') && data && data[0] && data[0].id && op.row && op.row.id && op.row.id !== data[0].id) {
        idMap.set(op.row.id, data[0].id);
        applyIdToState(op.row.id, data[0].id);
      }
      flushed++;
    } catch (e) {
      if (isPermanentError(e)) {
        console.error('Operación descartada de la cola por error permanente:', e.message || e);
        descartadas++;
      } else {
        console.error('No se pudo sincronizar una operación, se mantiene en cola:', e.message || e);
        restantes.push(op);
      }
    }
  }

  if (idMap.size && restantes.length) {
    for (let j = 0; j < restantes.length; j++) {
      const op = restantes[j];
      if (op.row) op.row = replaceIdsInRow(op.row);
      if (op.op === 'delete' && op.id && idMap.has(op.id)) op.id = idMap.get(op.id);
    }
  }

  if (restantes.length) setQueue(restantes); else clearQueue();
  return { flushed, pending: restantes.length, descartadas };
}

export function pendingCount() { return getQueue().length; }