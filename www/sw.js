/* Service Worker — Sistema SeS (PWA / modo offline)
   Estrategia: stale-while-revalidate SOLO para archivos estáticos del mismo
   origen. Las peticiones a Supabase (API, Auth, Storage) NUNCA se cachean. */
const CACHE = 'ses-static-v31';
// IMPORTANTE: NO incluir './' — Cloudflare Pages redirige '/' → '/index.html'
// y esa respuesta de redirección queda cacheada; Safari la devuelve y explota
// con "Response served by service worker has redirections".
const CORE = [
  './index.html',
  './manifest.json',
  './styles/main.css',
  './styles/fixes.css'
];

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
  // Safari/iOS lanza "Response served by service worker has redirections"
  // si el SW devuelve cualquier respuesta 3xx para una petición navigate.
  // La solución es servir index.html directamente desde caché (nunca
  // una redirección). Si no está en caché, ir a red con redirect:follow
  // para que el fetch absorba la redirección internamente.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((cached) =>
        cached || fetch('./index.html', { redirect: 'follow' })
      )
    );
    return;
  }

  // ── Recursos estáticos (CSS, JS, imágenes…) ──────────────────────────────
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      // Nunca servir desde caché una respuesta que sea redirección (opaqueredirect).
      const cachedOk = cached && cached.status === 200 ? cached : null;
      const network = fetch(req, { redirect: 'follow' }).then((res) => {
        // Solo cachear respuestas exitosas del mismo origen (basic).
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      }).catch(() => cachedOk);
      return cachedOk || network;
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
