/* DEPRECATED: Supabase Storage is not used by SneakerMania application code.
 * Use ./storage-manager.js for R2 uploads and signed image access.
 */
export const BUCKET_FOTOS = 'fotos-ordenes';
export const BUCKET_FIRMAS = 'firmas';
export const BUCKET_FACTURAS = 'facturas';

export async function uploadFile() {
  throw new Error('Supabase Storage deshabilitado. Usa storage-manager.js/R2.');
}
export async function getSignedUrl() {
  throw new Error('Supabase Storage deshabilitado. Usa storage-manager.js/R2.');
}
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
