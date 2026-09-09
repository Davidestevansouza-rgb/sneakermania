/* ============================================================
   MÓDULO: STORAGE MANAGER
   Gestión centralizada de almacenamiento para fotos y firmas.
   Las fotos se suben a Cloudflare R2 a través de la Edge Function
   'r2-storage' (las claves de R2 quedan como secretos del proyecto,
   nunca expuestas en la app). Mantiene la misma firma que antes para
   que el resto del sistema no necesite cambios.
   ============================================================ */
import { supabase } from './config.js';
import { state, tenantId } from './state.js';

const SIGNED_URL_CACHE = new Map();
// Promesas en curso por path: si varios componentes piden la misma foto al
// mismo tiempo, comparten UNA sola llamada al Edge Function.
const SIGNED_URL_PENDING = new Map();
let SESSION_REFRESH_PENDING = null;
const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
// La firma dura 50 min. El cache local vence antes para no reutilizar una URL
// justo al borde de su expiración.
const SIGNED_URL_TTL_MS = 45 * 60 * 1000;
const SIGNED_URL_CONCURRENCY = 4;

function functionStatus(error) {
  return Number(error?.context?.status || error?.status || error?.statusCode || 0) || 0;
}

function esNoAutorizado(error, data) {
  if (functionStatus(error) === 401) return true;
  const msg = String(error?.message || data?.error || '').toLowerCase();
  return msg.includes('401') || msg.includes('no autorizado') || msg.includes('unauthorized');
}

async function refrescarSesionUnaVez() {
  if (!supabase?.auth) return false;
  if (!SESSION_REFRESH_PENDING) {
    SESSION_REFRESH_PENDING = (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        return !error && !!data?.session?.access_token;
      } catch (_) {
        return false;
      } finally {
        SESSION_REFRESH_PENDING = null;
      }
    })();
  }
  return SESSION_REFRESH_PENDING;
}

async function invokeR2(options, permitirRefresh = true) {
  let resultado = await supabase.functions.invoke('r2-storage', options);
  if (permitirRefresh && esNoAutorizado(resultado.error, resultado.data)) {
    const refreshed = await refrescarSesionUnaVez();
    if (refreshed) resultado = await supabase.functions.invoke('r2-storage', options);
  }
  return resultado;
}

async function mapConcurrencia(items, limite, fn) {
  const salida = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      salida[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limite, items.length) }, () => worker());
  await Promise.all(workers);
  return salida;
}

function extraerPathR2(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('r2://')) return url.slice(5).replace(/^\/+/, '') || null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('.r2.dev')) return null;
    const partes = u.pathname.replace(/^\/+/, '').split('/');
    return partes.length ? partes.join('/') : null;
  } catch (_) { return null; }
}

/** Obtiene una URL firmada para un objeto R2 sin guardar la firma en la BD.
 *  Mantiene compatibilidad: si no se puede firmar, devuelve la URL original.
 */
export async function resolveImageUrl(url, path = null) {
  if (!url || typeof url !== 'string') return url;
  const esReferenciaR2 = url.startsWith('r2://');
  const objectPath = path || extraerPathR2(url);
  if (!objectPath) return esReferenciaR2 ? null : url;

  const cached = SIGNED_URL_CACHE.get(objectPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const pending = SIGNED_URL_PENDING.get(objectPath);
  if (pending) return pending;

  const solicitud = (async () => {
    try {
      const tid1 = tenantId();
      const { data, error } = await invokeR2({
        body: { action: 'signed-url', path: objectPath, expires: 3000 },
        headers: tid1 ? { 'x-tenant-id': tid1 } : {}
      });
      if (!error && data?.url) {
        SIGNED_URL_CACHE.set(objectPath, { url: data.url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
        return data.url;
      }
      if (esReferenciaR2) {
        console.warn('No se pudo resolver referencia R2:', objectPath, error || data?.error || 'respuesta sin URL firmada');
        return null;
      }
    } catch (e) {
      if (esReferenciaR2) {
        console.warn('No se pudo resolver referencia R2:', objectPath, e);
        return null;
      }
      console.warn('No se pudo obtener URL firmada; se mantiene URL existente:', e);
    }
    return esReferenciaR2 ? null : url;
  })().finally(() => {
    SIGNED_URL_PENDING.delete(objectPath);
  });

  SIGNED_URL_PENDING.set(objectPath, solicitud);
  return solicitud;
}

export async function resolveImageUrls(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) return [];
  // Limita la cantidad de firmas simultáneas para no saturar Safari/Chrome
  // móvil ni el Edge Function cuando una galería contiene muchas imágenes.
  return mapConcurrencia(fotos, SIGNED_URL_CONCURRENCY, async f => ({
    ...f,
    resolvedUrl: await resolveImageUrl(f?.url, f?.path)
  }));
}

/**
 * Resuelve un lote de URLs firmadas con concurrencia controlada.
 * @param {Array<{url:string, path?:string}>} fotos
 */
export async function resolveImageUrlsBatch(fotos) {
  return resolveImageUrls(fotos);
}

/**
 * Prefetch en BACKGROUND con la misma concurrencia controlada y cache compartida.
 * @param {Array<{url:string, path?:string}>} fotos
 */
export function prefetchImageUrls(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) return;
  resolveImageUrls(fotos).catch(() => {});
}

function imagenesEn(root) {
  const imgs = [];
  if (root?.matches?.('img')) imgs.push(root);
  if (root?.querySelectorAll) imgs.push(...root.querySelectorAll('img'));
  return imgs;
}

export async function secureImageUrlsInDom(root = document) {
  if (!root) return;
  const imgs = imagenesEn(root);
  await mapConcurrencia(imgs, SIGNED_URL_CONCURRENCY, async img => {
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');

    const srcActual = img.getAttribute('src') || '';
    if (srcActual.startsWith('r2://')) img.dataset.r2Source = srcActual;
    const fuenteR2 = img.dataset.r2Source || (srcActual.startsWith('r2://') ? srcActual : '');
    if (!fuenteR2) return;

    // Si ya tiene una URL HTTP resuelta y no está marcada como no disponible,
    // no vuelve a firmarla por una mutación DOM ajena.
    if (!srcActual.startsWith('r2://') && srcActual && srcActual !== PIXEL_TRANSPARENTE && img.dataset.r2Unavailable !== 'true') return;

    const signed = await resolveImageUrl(fuenteR2);
    if (signed) {
      if (img.getAttribute('src') !== signed) img.setAttribute('src', signed);
      delete img.dataset.r2Unavailable;
    } else {
      // La referencia persistente queda en data-r2-source. Un fallo temporal
      // nunca borra el r2:// original ni convierte el problema en pérdida de foto.
      if (img.getAttribute('src') !== PIXEL_TRANSPARENTE) img.setAttribute('src', PIXEL_TRANSPARENTE);
      img.dataset.r2Unavailable = 'true';
    }
  });
}

if (typeof window !== 'undefined') {
  const iniciarSeguridadImagenes = () => {
    secureImageUrlsInDom(document).catch(() => {});
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target?.tagName === 'IMG') {
          const src = m.target.getAttribute('src') || '';
          if (src.startsWith('r2://')) secureImageUrlsInDom(m.target).catch(() => {});
          continue;
        }
        for (const node of m.addedNodes || []) {
          if (node?.nodeType === 1) secureImageUrlsInDom(node).catch(() => {});
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    window.addEventListener('online', () => {
      document.querySelectorAll('img[data-r2-unavailable="true"]').forEach(img => {
        const source = img.dataset.r2Source;
        if (source) img.setAttribute('src', source);
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarSeguridadImagenes, { once: true });
  else iniciarSeguridadImagenes();
}

/**
 * Sube un archivo (File o Blob) a R2 vía la Edge Function r2-storage.
 * @param {Blob|File} file - Archivo a subir
 * @param {string} folder - Carpeta dentro del bucket (ej: 'firmas', 'ordenes')
 * @param {string} filename - Nombre del archivo (sin path)
 * @returns {Promise<{url: string, path: string}>} URL de R2 y path del archivo
 */
export async function uploadFile(file, folder, filename, internal = {}) {
  if (!file) throw new Error('No se proporcionó archivo');
  if (file.type && file.type.startsWith('image/') && folder !== 'firmas' && !internal.skipImageCompressionCheck) {
    throw new Error('Subida de imagen sin compresión bloqueada. Usa uploadImageFile() o uploadFoto().');
  }
  
  const tenant = tenantId();
  if (!tenant) throw new Error('No hay tenant autenticado');
  
  // Path: tenant_id/folder/filename
  const path = `${tenant}/${folder}/${filename}`;

  // Reintentos: ERR_HTTP2_PROTOCOL_ERROR y "Failed to fetch" suelen ser cortes
  // transitorios de la conexión (típico al subir fotos pesadas desde el
  // celular con wifi/datos inestables), no un error real del archivo.
  const MAX_INTENTOS = 3;
  let ultimoError = null;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('path', path);

    const tid2 = tenantId();
    const { data, error } = await invokeR2({
      body: form,
      headers: tid2 ? { 'x-tenant-id': tid2 } : {}
    });

    if (!error && data && data.url) {
      return { url: data.url, path: data.path || path };
    }

    ultimoError = error || new Error((data && data.error) || 'Error desconocido al subir el archivo');
    const mensaje = (ultimoError.message || '').toLowerCase();
    const esErrorRed = mensaje.includes('failed to fetch') || mensaje.includes('network') ||
      mensaje.includes('http2') || mensaje.includes('protocol') || mensaje.includes('insufficient') ||
      mensaje.includes('resource') || mensaje.includes('timeout');
    console.error(`Error al subir archivo (intento ${intento}/${MAX_INTENTOS}):`, ultimoError);
    if (!esErrorRed || intento === MAX_INTENTOS) break;
    // Espera creciente antes de reintentar (500ms, 1500ms).
    await new Promise(r => setTimeout(r, intento === 1 ? 700 : 1600));
  }
  throw ultimoError;
}

/**
 * Sube una imagen genérica a R2 DESPUÉS de comprimirla.
 * No existe fallback al archivo original: si la compresión falla, se cancela
 * la subida. Esto evita cualquier camino accidental que almacene la foto
 * original sin compresión.
 */
export async function uploadImageFile(file, folder, filename) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen');
  }
  const comprimido = await comprimirImagen(file);
  if (!comprimido || !comprimido.type || !comprimido.type.startsWith('image/')) {
    throw new Error('No se pudo comprimir la imagen; la subida fue cancelada');
  }
  const nombreJpg = filename.replace(/\.[^.]+$/, '') + '.jpg';
  return uploadFile(comprimido, folder, nombreJpg, { skipImageCompressionCheck: true });
}

/**
 * Sube una firma digital (canvas como PNG) a Storage.
 * @param {string} base64Data - Data URI del canvas (data:image/png;base64,...)
 * @param {string} ordenId - ID de la orden
 * @param {string} tipo - Tipo de firma (ingreso, retiro, recepcionista)
 * @returns {Promise<{url: string, path: string, fecha: string}>}
 */
export async function uploadFirma(base64Data, ordenId, tipo) {
  // Convertir base64 a Blob
  const blob = await (await fetch(base64Data)).blob();
  
  // Nombre: firma_tipo_ordenId_timestamp.png
  const timestamp = Date.now();
  const filename = `firma_${tipo}_${ordenId}_${timestamp}.png`;
  
  const result = await uploadFile(blob, 'firmas', filename);
  
  return {
    url: result.url,
    path: result.path,
    fecha: new Date().toISOString()
  };
}

/**
 * Encuadra una imagen en un lienzo cuadrado (como al subir una foto
 * horizontal/vertical a Instagram: se ve completa, con franjas de
 * fondo blanco donde sobra espacio) y la comprime con calidad JPEG
 * adaptativa antes de subirla.
 *
 * A diferencia de un recorte centrado, esto NUNCA corta parte del
 * par de zapatillas aunque la foto no esté perfectamente centrada.
 *
 * @param {File} file
 * @param {number} ladoMax - lado máximo del cuadrado final, en px
 * @param {number} pesoObjetivoKB - peso máximo deseado del JPEG resultante
 * @param {number} calidadMinima - piso de calidad JPEG (0-1) para no
 *        degradar demasiado el detalle aunque no se llegue al peso objetivo
 * @returns {Promise<Blob>}
 */
export async function comprimirImagen(file, ladoMax = 1200, pesoObjetivoKB = 200, calidadMinima = 0.5) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Escala para que la imagen entre completa en ladoMax (nunca agranda
    // fotos que ya son más chicas que el objetivo).
    const escala = Math.min(ladoMax / width, ladoMax / height, 1);
    const anchoFinal = Math.round(width * escala);
    const altoFinal = Math.round(height * escala);
    const lado = Math.max(anchoFinal, altoFinal);

    const canvas = document.createElement('canvas');
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, lado, lado);
    const offsetX = Math.round((lado - anchoFinal) / 2);
    const offsetY = Math.round((lado - altoFinal) / 2);
    ctx.drawImage(bitmap, offsetX, offsetY, anchoFinal, altoFinal);

    // Compresión adaptativa: baja la calidad JPEG en pasos hasta entrar
    // en el peso objetivo, sin bajar del piso de calidad definido.
    const pesoObjetivo = pesoObjetivoKB * 1024;
    let calidad = 0.85;
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', calidad));
    let intentos = 0;
    while (blob && blob.size > pesoObjetivo && calidad > calidadMinima && intentos < 6) {
      calidad = Math.round((calidad - 0.1) * 100) / 100;
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', calidad));
      intentos++;
    }

    if (!blob) throw new Error('No se pudo generar la imagen comprimida');
    return blob;
  } catch (e) {
    console.error('No se pudo comprimir la imagen; se cancela la subida:', e);
    throw new Error('No se pudo comprimir la imagen. La foto original NO se subió.');
  }
}

/**
 * Sube una foto (File desde input) a Storage, comprimiéndola antes.
 * @param {File} file - Archivo de imagen
 * @param {string} ordenId - ID de la orden
 * @param {string} categoria - Categoría (antes, durante, despues, detalle, suela, laterales)
 * @returns {Promise<{url: string, path: string, fecha: string}>}
 */
export async function uploadFoto(file, ordenId, categoria) {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen');
  }
  
  // Comprimir antes de subir (si el archivo ya es chico, apenas cambia).
  const archivoASubir = await comprimirImagen(file);

  // Nombre: foto_categoria_ordenId_timestamp.jpg (siempre jpg tras comprimir)
  const timestamp = Date.now();
  const filename = `foto_${categoria}_${ordenId}_${timestamp}.jpg`;
  
  const result = await uploadFile(archivoASubir, `ordenes/${ordenId}`, filename, { skipImageCompressionCheck: true });
  
  return {
    url: result.url,
    path: result.path,
    fecha: new Date().toISOString(),
    categoria: categoria
  };
}

/**
 * Elimina un archivo de Storage.
 * @param {string} path - Path completo del archivo
 * @returns {Promise<void>}
 */
export async function deleteFile(path) {
  const tidDel = tenantId();
  const { data, error } = await invokeR2({
    body: { action: 'delete', path },
    headers: tidDel ? { 'x-tenant-id': tidDel } : {}
  });

  if (error || !data || data.error) {
    const err = error || new Error(data && data.error);
    console.error('Error al eliminar archivo:', err);
    throw err;
  }
}

/**
 * Lista todos los archivos de una orden.
 * @param {string} ordenId - ID de la orden
 * @returns {Promise<Array>} Lista de archivos
 */
export async function listOrdenFiles(ordenId) {
  const tenant = tenantId();
  const folder = `${tenant}/ordenes/${ordenId}`;

  const tidList = tenantId();
  const { data, error } = await invokeR2({
    body: { action: 'list', prefix: folder },
    headers: tidList ? { 'x-tenant-id': tidList } : {}
  });

  if (error || !data || data.error) {
    console.error('Error al listar archivos:', error || (data && data.error));
    return [];
  }

  return data.files || [];
}
