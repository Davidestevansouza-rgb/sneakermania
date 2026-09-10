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
 * La sesión se conserva en ESTE dispositivo para que iPhone/Android/PC no
 * obliguen al usuario a escribir la contraseña en cada recarga o reapertura.
 * Supabase renueva el token automáticamente mientras la sesión siga válida.
 */
let supabaseClient = null;
try {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  } else {
    console.error('No se encontró la librería de Supabase (revisa la etiqueta <script> del CDN).');
  }
} catch (e) {
  console.error('No se pudo inicializar Supabase:', e);
}

// r2-storage valida por sí mismo el Bearer JWT del usuario final. Para evitar
// ráfagas de 401 durante restauración/renovación de sesión, los llamados a ESA
// función reciben siempre el access_token vigente de forma explícita. Si varios
// pedidos fallan con el mismo token vencido, comparten un único refresh.
let r2RefreshPending = null;

function r2Status(error) {
  return Number(error?.context?.status || error?.status || error?.statusCode || 0) || 0;
}

function r2Es401(result) {
  if (r2Status(result?.error) === 401) return true;
  const msg = String(result?.error?.message || result?.data?.error || '').toLowerCase();
  return msg.includes('401') || msg.includes('no autorizado') || msg.includes('unauthorized');
}

async function r2AccessToken() {
  if (!supabaseClient?.auth) return '';
  try {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session?.access_token || '';
  } catch (_) {
    return '';
  }
}

async function r2RefreshUnaVez() {
  if (!supabaseClient?.auth) return false;
  if (!r2RefreshPending) {
    r2RefreshPending = (async () => {
      try {
        const { data, error } = await supabaseClient.auth.refreshSession();
        return !error && !!data?.session?.access_token;
      } catch (_) {
        return false;
      } finally {
        r2RefreshPending = null;
      }
    })();
  }
  return r2RefreshPending;
}

function r2OptionsConToken(options, token) {
  return {
    ...(options || {}),
    headers: {
      ...((options && options.headers) || {}),
      Authorization: 'Bearer ' + token
    }
  };
}

if (supabaseClient?.functions && !supabaseClient.functions.__smR2JwtGuard) {
  const invokeOriginal = supabaseClient.functions.invoke.bind(supabaseClient.functions);
  supabaseClient.functions.invoke = async function(nombre, options = {}) {
    if (nombre !== 'r2-storage') return invokeOriginal(nombre, options);

    let tokenUsado = await r2AccessToken();
    if (!tokenUsado) {
      const refreshed = await r2RefreshUnaVez();
      if (refreshed) tokenUsado = await r2AccessToken();
    }

    // Si todavía no existe sesión, no enviamos decenas de requests anónimos
    // que r2-storage rechazará con 401. El render podrá reintentarse al volver
    // a existir una sesión válida.
    if (!tokenUsado) {
      const error = new Error('Sesión todavía no disponible para acceder a las fotos');
      error.__smR2NoSession = true;
      return { data: null, error };
    }

    let resultado = await invokeOriginal(nombre, r2OptionsConToken(options, tokenUsado));
    if (!r2Es401(resultado)) return resultado;

    // Puede que otro request paralelo ya haya renovado el token. Si cambió,
    // reutilizarlo sin volver a ejecutar refreshSession().
    let tokenActual = await r2AccessToken();
    if (!tokenActual || tokenActual === tokenUsado) {
      const refreshed = await r2RefreshUnaVez();
      if (refreshed) tokenActual = await r2AccessToken();
    }

    if (tokenActual && tokenActual !== tokenUsado) {
      resultado = await invokeOriginal(nombre, r2OptionsConToken(options, tokenActual));
    }
    return resultado;
  };
  supabaseClient.functions.__smR2JwtGuard = true;
}

export const supabase = supabaseClient;