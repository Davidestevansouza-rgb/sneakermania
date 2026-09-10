import { supabase } from './config.js';
import { state } from './state.js';

function innerExtraFromRpc(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.extra && typeof data.extra === 'object' && !Array.isArray(data.extra)) return data.extra;
  return data;
}

function syncOrderExtra(orderId, data) {
  const inner = innerExtraFromRpc(data);
  if (!inner) return;
  const order = (state.ordenes || []).find(o => o.id === orderId);
  if (!order) return;
  order.extra = { ...(order.extra || {}), ...inner };
  if (!Array.isArray(order.extra.fotos)) order.extra.fotos = [];
}

export async function appendOrderPhotoAtomic(orderId, photo) {
  if (!supabase || !orderId || !photo) {
    return { error: new Error('No se puede guardar la referencia de la foto') };
  }
  try {
    const { data, error } = await supabase.rpc('append_order_photo_atomic', {
      p_order_id: orderId,
      p_photo: photo
    });
    if (error) return { error };
    syncOrderExtra(orderId, data);
    return { ok: true, data };
  } catch (error) {
    return { error };
  }
}

export async function deleteOrderPhotoAtomic(orderId, photo) {
  if (!supabase || !orderId || !photo) {
    return { error: new Error('No se puede eliminar la referencia de la foto') };
  }
  try {
    const { data, error } = await supabase.rpc('delete_order_photo_atomic', {
      p_order_id: orderId,
      p_photo: photo
    });
    if (error) return { error };
    syncOrderExtra(orderId, data);
    return { ok: true, data };
  } catch (error) {
    return { error };
  }
}
