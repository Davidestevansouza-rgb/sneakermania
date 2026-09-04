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
const SIGNED_URL_TTL_MS = 8 * 60 * 1000;

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

/** Obtiene el token JWT válido de la sesión actual */
async function getValidToken() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[getValidToken] Error obteniendo sesión:', error);
      return null;
    }
    if (session && session.access_token) {
      console.log('[getValidToken] Token obtenido exitosamente');
      return session.access_token;
    }
    console.warn('[getValidToken] No hay sesión activa');
    return null;
  } catch (e) {
    console.error('[getValidToken] Exception:', e);
    return null;
  }
}

/** Obtiene una URL firmada para un objeto R2 sin guardar la firma en la BD.
 *  Mantiene compatibilidad: si no se puede firmar, devuelve la URL original.
 */
export async function resolveImageUrl(url, path = null) {
  if (!url || typeof url !== 'string') return url;
  const objectPath = path || extraerPathR2(url);
  if (!objectPath) return url;
  const cached = SIGNED_URL_CACHE.get(objectPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  try {
    const token = await getValidToken();
    const { data, error } = await supabase.functions.invoke('r2-storage', {
      body: { action: 'signed-url', path: objectPath, expires: 600 },
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!error && data?.url) {
      SIGNED_URL_CACHE.set(objectPath, { url: data.url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
      return data.url;
    }
  } catch (e) {
    console.warn('No se pudo obtener URL firmada; se mantiene URL existente:', e);
  }
  return url;
}

export async function resolveImageUrls(fotos) {
  if (!Array.isArray(fotos)) return [];
  return Promise.all(fotos.map(async f => ({ ...f, resolvedUrl: await resolveImageUrl(f.url, f.path) })));
}

export async function secureImageUrlsInDom(root = document) {
  if (!root) return;
  const imgs = root.querySelectorAll ? root.querySelectorAll('img[src]') : [];
  await Promise.all(Array.from(imgs).map(async img => {
    const src = img.getAttribute('src');
    const signed = await resolveImageUrl(src);
    if (signed && signed !== src) img.setAttribute('src', signed);
  }));
}

if (typeof window !== 'undefined') {
  const iniciarSeguridadImagenes = () => {
    secureImageUrlsInDom(document).catch(() => {});
    const observer = new MutationObserver(() => {
      secureImageUrlsInDom(document).catch(() => {});
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
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
  
  // Obtener token ANTES de empezar reintentos
  const token = await getValidToken();
  if (!token) {
    console.error('[uploadFile] No se pudo obtener token JWT válido');
    throw new Error('No se pudo autenticar con el servidor. Intenta refrescar la página.');
  }
  
  const path = `${tenant}/${folder}/${filename}`;
  console.log('[uploadFile] Iniciando subida:', { tenant, folder, filename, path, fileSize: file.size, fileType: file.type });

  // Path: tenant_id/folder/filename
  // Reintentos: ERR_HTTP2_PROTOCOL_ERROR y "Failed to fetch" suelen ser cortes
  // transitorios de la conexión (típico al subir fotos pesadas desde el
  // celular con wifi/datos inestables), no un error real del archivo.
  const MAX_INTENTOS = 3;
  let ultimoError = null;
  
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('path', path);

    try {
      console.log(`[uploadFile] Intento ${intento}/${MAX_INTENTOS}...`);
      
      const { data, error } = await supabase.functions.invoke('r2-storage', { 
        body: form,
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // DEBUGGING DETALLADO
      if (error) {
        console.error(`[uploadFile] Error en intento ${intento}:`, {
          status: error.status,
          message: error.message,
          name: error.name,
          context: error.context
        });
      }
      
      if (data) {
        console.log(`[uploadFile] Respuesta del servidor (intento ${intento}):`, data);
      }

      if (!error && data && data.url) {
        console.log('[uploadFile] ✅ Subida exitosa:', { url: data.url, path: data.path });
        return { url: data.url, path: data.path || path };
      }

      ultimoError = error || new Error((data && data.error) || 'Error desconocido al subir el archivo');
      const mensaje = (ultimoError.message || '').toLowerCase();
      const esErrorRed = mensaje.includes('failed to fetch') || mensaje.includes('network') || mensaje.includes('http2') || mensaje.includes('protocol');
      
      console.error(`[uploadFile] Error en intento ${intento} (tipo: ${esErrorRed ? 'red/temporal' : 'servidor'}):`, ultimoError.message);
      
      if (!esErrorRed || intento === MAX_INTENTOS) {
        console.error(`[uploadFile] No se reintentar más. esErrorRed=${esErrorRed}, intento=${intento}`);
        break;
      }
      // Espera creciente antes de reintentar (500ms, 1500ms).
      const delayMs = intento * 500;
      console.log(`[uploadFile] Esperando ${delayMs}ms antes de reintentar...`);
      await new Promise(r => setTimeout(r, delayMs));
    } catch (e) {
      console.error(`[uploadFile] Exception en intento ${intento}:`, {
        message: e.message,
        name: e.name,
        stack: e.stack
      });
      ultimoError = e;
      if (intento < MAX_INTENTOS) {
        const delayMs = intento * 500;
        console.log(`[uploadFile] Esperando ${delayMs}ms antes de reintentar después de exception...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  
  console.error('[uploadFile] ❌ Fallo definitivo después de ' + MAX_INTENTOS + ' intentos:', ultimoError);
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
  console.log('[uploadImageFile] Comprimiendo imagen:', { filename, fileSize: file.size, fileType: file.type });
  const comprimido = await comprimirImagen(file);
  if (!comprimido || !comprimido.type || !comprimido.type.startsWith('image/')) {
    throw new Error('No se pudo comprimir la imagen; la subida fue cancelada');
  }
  console.log('[uploadImageFile] Imagen comprimida exitosamente:', { comprimidoSize: comprimido.size });
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
    console.log('[comprimirImagen] Iniciando compresión:', { fileName: file.name, fileSize: file.size, ladoMax, pesoObjetivoKB, calidadMinima });
    
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Escala para que la imagen entre completa en ladoMax (nunca agranda
    // fotos que ya son más chicas que el objetivo).
    const escala = Math.min(ladoMax / width, ladoMax / height, 1);
    const anchoFinal = Math.round(width * escala);
    const altoFinal = Math.round(height * escala);
    const lado = Math.max(anchoFinal, altoFinal);

    console.log('[comprimirImagen] Dimensiones:', { original: { width, height }, final: { anchoFinal, altoFinal, lado } });

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
    
    console.log('[comprimirImagen] Compresión adaptativa: pesoObjetivo=' + pesoObjetivo + ' bytes');
    
    while (blob && blob.size > pesoObjetivo && calidad > calidadMinima && intentos < 6) {
      calidad = Math.round((calidad - 0.1) * 100) / 100;
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', calidad));
      intentos++;
      console.log(`[comprimirImagen]   Intento ${intentos}: calidad=${calidad}, size=${blob.size} bytes`);
    }

    if (!blob) throw new Error('No se pudo generar la imagen comprimida');
    
    console.log('[comprimirImagen] ✅ Compresión completada:', { 
      calidadFinal: calidad, 
      tamañoOriginal: file.size, 
      tamañoComprimido: blob.size, 
      ratio: ((1 - blob.size / file.size) * 100).toFixed(1) + '%'
    });
    
    return blob;
  } catch (e) {
    console.error('[comprimirImagen] ❌ Error:', e);
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
  
  console.log('[uploadFoto] Iniciando subida de foto:', { fileName: file.name, fileSize: file.size, ordenId, categoria });
  
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
  const token = await getValidToken();
  
  const { data, error } = await supabase.functions.invoke('r2-storage', {
    body: { action: 'delete', path },
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
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
  const token = await getValidToken();

  const { data, error } = await supabase.functions.invoke('r2-storage', {
    body: { action: 'list', prefix: folder },
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  });

  if (error || !data || data.error) {
    console.error('Error al listar archivos:', error || (data && data.error));
    return [];
  }

  return data.files || [];
}
