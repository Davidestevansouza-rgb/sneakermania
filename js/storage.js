/* ============================================================
   ALMACENAMIENTO DE ARCHIVOS — Sistema SeS (Supabase Storage)
   ============================================================
   Helpers para subir/obtener archivos (fotos de órdenes, firmas,
   PDFs de facturas). En Fase 1 las fotos y firmas se conservan como
   base64 dentro de la orden (offline-first); estas utilidades quedan
   listas para migrar a Storage en Fase 2 sin tocar la UI.
   ============================================================ */
import { supabase } from './config.js';
import { state } from './state.js';

export const BUCKET_FOTOS = 'fotos-ordenes';
export const BUCKET_FIRMAS = 'firmas';
export const BUCKET_FACTURAS = 'facturas';

function tenantId() { return state.session && state.session.tenantId; }

/**
 * Sube un archivo a un bucket, prefijando el path con el tenant_id
 * para respetar el aislamiento multitenant.
 * @returns {Promise<{path:string, publicUrl:string}|null>}
 */
export async function uploadFile(bucket, relativePath, fileOrBlob, contentType) {
  if (!supabase) return null;
  const path = tenantId() ? tenantId() + '/' + relativePath : relativePath;
  try {
    const { error } = await supabase.storage.from(bucket).upload(path, fileOrBlob, {
      upsert: true,
      contentType: contentType || (fileOrBlob && fileOrBlob.type) || 'application/octet-stream'
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { path, publicUrl: data ? data.publicUrl : '' };
  } catch (e) {
    console.error('No se pudo subir el archivo a Storage:', e);
    return null;
  }
}

/** Devuelve una URL firmada (temporal) para un archivo privado. */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data ? data.signedUrl : null;
  } catch (e) {
    console.error('No se pudo generar la URL firmada:', e);
    return null;
  }
}

/** Convierte un dataURL (base64) en Blob para subirlo a Storage. */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(body);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
