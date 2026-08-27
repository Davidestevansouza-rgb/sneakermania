/* ============================================================
   CONFIGURACIÓN GLOBAL — Sistema SeS
   ============================================================
   Inicializa el cliente de Supabase y expone constantes.
   Las credenciales se toman de las variables inyectadas en
   window.SNEAKERMANIA_ENV (ver index.html) o de los valores por
   defecto. La ANON KEY es pública por diseño; la seguridad real
   la aplica Row Level Security (RLS) en la base de datos.
   ============================================================ */

// Valores por defecto (pueden sobrescribirse desde window.SNEAKERMANIA_ENV).
const ENV = (typeof window !== 'undefined' && window.SNEAKERMANIA_ENV) || {};

export const SUPABASE_URL =
  ENV.SUPABASE_URL || 'https://ypgyfgbftfvouobmsync.supabase.co';
export const SUPABASE_ANON_KEY =
  ENV.SUPABASE_ANON_KEY || 'sb_publishable_Hq4paRq4YxKnLskWN5ejng_3k9o6Oye';

// Clave de almacenamiento local (caché offline).
export const STORAGE_KEY = 'sneakermania-data-v1';
// Cola de escrituras pendientes cuando no hay conexión.
export const QUEUE_KEY = 'sneakermania-pending-queue-v1';

// Formato de moneda (México por defecto).
export const LOCALE = 'es-MX';
export const CURRENCY_SYMBOL = '$';

/**
 * Cliente de Supabase.
 * La librería se carga por CDN como script clásico (window.supabase),
 * por lo que está disponible antes de que se ejecuten los módulos.
 */
let supabaseClient = null;
try {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: true }
    });
  } else {
    console.error('No se encontró la librería de Supabase (revisa la etiqueta <script> del CDN).');
  }
} catch (e) {
  console.error('No se pudo inicializar Supabase:', e);
}

export const supabase = supabaseClient;