/* ============================================================
   CAPA DE DATOS (Supabase) — Sistema SeS
   ============================================================
   Traduce entre el modelo en memoria (camelCase) y las columnas de
   PostgreSQL (snake_case), y realiza las operaciones CRUD. Es
   "offline-first": si no hay conexión, las escrituras se encolan y
   se reintentan al reconectar (ver flushQueue).
   ============================================================ */
import { supabase } from './config.js';
import { state, enqueue, getQueue, setQueue, clearQueue } from './state.js';

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
export const saveOrden = (o) => pushUpsert('ordenes', ordenToDb(o));

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
    let q = supabase.from('actividad_log').select('*').order('created_at', { ascending: false }).limit(1000);
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

export async function saveConfig(cfg) {
  return pushUpsert('configuracion_tenant', { tenant_id: tenantId(), ...cfg });
}

/* ============================================================
   CARGA INICIAL DE DATOS DEL TENANT
   ============================================================ */
export async function loadAllData() {
  if (!online() || !tenantId()) return false;
  try {
    const [cli, ord, gas, inv, log, cfg, notif, fact, pares, items] = await Promise.all([
      supabase.from('clientes').select('*'),
      supabase.from('ordenes').select('*'),
      supabase.from('gastos').select('*'),
      supabase.from('inventario').select('*'),
      supabase.from('actividad_log').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('configuracion_tenant').select('*').eq('tenant_id', tenantId()).maybeSingle(),
      supabase.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('facturas').select('*'),
      supabase.from('registro_pares').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('orden_items').select('*')
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
        fecha: n.created_at
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
    leida: false
  };
  try {
    if (online()) {
      const { error } = await supabase.from('notificaciones').insert(row);
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