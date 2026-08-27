/* ============================================================
   MÓDULO: STORAGE MANAGER
   Gestión centralizada de Supabase Storage para fotos y firmas.
   Bucket: 'fotos' (debe crearse manualmente en Supabase Dashboard)
   ============================================================ */
import { supabase } from './config.js';
import { state, tenantId } from './state.js';

/**
 * Sube un archivo (File o Blob) a Supabase Storage.
 * @param {Blob|File} file - Archivo a subir
 * @param {string} folder - Carpeta dentro del bucket (ej: 'firmas', 'ordenes')
 * @param {string} filename - Nombre del archivo (sin path)
 * @returns {Promise<{url: string, path: string}>} URL pública y path del archivo
 */
export async function uploadFile(file, folder, filename) {
  if (!file) throw new Error('No se proporcionó archivo');
  
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
    const { data, error } = await supabase.storage
      .from('fotos')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: true, // Sobrescribir si existe
        contentType: file.type || undefined
      });

    if (!error) {
      const { data: urlData } = supabase.storage.from('fotos').getPublicUrl(path);
      return { url: urlData.publicUrl, path: path };
    }

    ultimoError = error;
    const mensaje = (error.message || '').toLowerCase();
    const esErrorRed = mensaje.includes('failed to fetch') || mensaje.includes('network') || mensaje.includes('http2') || mensaje.includes('protocol');
    console.error(`Error al subir archivo (intento ${intento}/${MAX_INTENTOS}):`, error);
    if (!esErrorRed || intento === MAX_INTENTOS) break;
    // Espera creciente antes de reintentar (500ms, 1500ms).
    await new Promise(r => setTimeout(r, intento * 500));
  }
  throw ultimoError;
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
 * Redimensiona y comprime una imagen en el navegador antes de subirla.
 * Reduce drásticamente el peso de fotos tomadas con celular (que suelen
 * pesar 3-8 MB), lo que evita cortes de conexión al subir (HTTP2/red
 * inestable) y acelera la subida.
 * @param {File} file
 * @param {number} maxDim - dimensión máxima (ancho o alto) en px
 * @param {number} calidad - calidad JPEG (0-1)
 * @returns {Promise<Blob>}
 */
async function comprimirImagen(file, maxDim = 1600, calidad = 0.8) {
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', calidad));
    return blob || file; // si algo falla, usar el original
  } catch (e) {
    console.error('No se pudo comprimir la imagen, se sube el original:', e);
    return file;
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
  
  const result = await uploadFile(archivoASubir, `ordenes/${ordenId}`, filename);
  
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
  const { error } = await supabase.storage
    .from('fotos')
    .remove([path]);
  
  if (error) {
    console.error('Error al eliminar archivo:', error);
    throw error;
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
  
  const { data, error } = await supabase.storage
    .from('fotos')
    .list(folder);
  
  if (error) {
    console.error('Error al listar archivos:', error);
    return [];
  }
  
  return data || [];
}
