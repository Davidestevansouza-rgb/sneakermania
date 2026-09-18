/* Service Worker — Sistema SeS (PWA / modo offline)
   Estrategia: network-first para navegación y archivos estáticos del mismo
   origen. Las peticiones a Supabase (API, Auth, Storage) NUNCA se cachean. */
const CACHE = 'ses-static-v41';
// En Cloudflare Pages la raíz './' responde 200 directo, mientras que
// './index.html' responde 308 → '/'. Por eso cacheamos y servimos SIEMPRE
// la raíz './' para la navegación, NUNCA './index.html' (que redirige y
// rompe Safari con "Response served by service worker has redirections").
const CORE = [
  './',
  './manifest.json',
  './styles/main.css',
  './styles/fixes.css'
];

// Reconstruye una respuesta SIN la bandera `redirected`. Safari/iOS bloquea
// cualquier respuesta que el SW devuelva con response.redirected === true
// (típico cuando el fetch siguió un 3xx). Al recrearla con new Response()
// la bandera desaparece y Safari la acepta.
async function stripRedirect(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // Avisar a todas las pestañas abiertas que hay un SW nuevo activo para
      // que se recarguen solas y tomen la versión más reciente de la app.
      .then(() => self.clients.matchAll({ type: 'window' })
        .then((clientsArr) => clientsArr.forEach((c) => c.postMessage({ type: 'SW_UPDATED' }))))
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo mismo origen: no tocar Supabase ni CDNs externas.
  if (url.origin !== self.location.origin) return;
  // No cachear llamadas a funciones/APIs.
  if (url.pathname.includes('/functions/') || url.pathname.includes('/rest/') || url.pathname.includes('/auth/')) return;

  // ── Peticiones de navegación (cargar la página) ──────────────────────────
  // NETWORK-FIRST: cuando hay conexión, Cloudflare es la fuente de verdad.
  // La caché queda únicamente como respaldo offline. Así un celular no queda
  // atrapado indefinidamente usando un HTML antiguo después de un despliegue.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch('./', { redirect: 'follow', cache: 'no-store' });
        const clean = await stripRedirect(res);
        if (clean && clean.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put('./', clean.clone()).catch(() => {});
        }
        return clean;
      } catch (err) {
        const fallback = await caches.match('./');
        return fallback ? stripRedirect(fallback) : Response.error();
      }
    })());
    return;
  }

  // ── Recursos estáticos (CSS, JS, imágenes…) ──────────────────────────────
  // NETWORK-FIRST también aquí: evita mezclar HTML nuevo con JS/CSS antiguos.
  // Solo se usa la caché cuando la red no está disponible.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const cachedOk = cached && cached.status === 200 && !cached.redirected ? cached : null;
      try {
        const res = await fetch(req, { redirect: 'follow', cache: 'no-store' });
        const clean = await stripRedirect(res);
        if (clean && clean.status === 200 && clean.type === 'basic') {
          cache.put(req, clean.clone()).catch(() => {});
        }
        return clean;
      } catch (err) {
        return cachedOk || Response.error();
      }
    })
  );
});

/* ------------------------------------------------------------------
   PUSH REAL: recibe el mensaje que manda la Edge Function send-push
   (aunque la pestaña esté cerrada o el celular bloqueado) y muestra
   la notificación nativa del sistema operativo.
   ------------------------------------------------------------------ */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { titulo: 'Sistema SeS', mensaje: e.data ? e.data.text() : '' }; }
  const titulo = data.titulo || 'Sistema SeS';
  const opciones = {
    body: data.mensaje || '',
    icon: data.icono || './assets/icon-192.png',
    badge: './assets/icon-192.png',
    tag: data.tag || ('ses-push-' + Date.now()),
    data: { url: data.url || './' },
    requireInteraction: false,
    silent: false,
    vibrate: [200, 80, 200]
  };
  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// Si el navegador renueva la suscripción sola (puede pasar), avisamos a las
// pestañas abiertas para que la vuelvan a guardar en Supabase.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      clientsArr.forEach((c) => c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
    })
  );
});
