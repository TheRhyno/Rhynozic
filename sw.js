// ============================================================
//  Rhynozic — Service Worker PWA
//  ⚡ Pour déclencher une mise à jour : changer APP_VERSION
// ============================================================

const APP_VERSION  = 'v1.0.11';
const CACHE_NAME   = `rhynozic-shell-${APP_VERSION}`;
const AUDIO_CACHE  = `rhynozic-audio-${APP_VERSION}`;
const IMG_CACHE    = `rhynozic-img-${APP_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './Logo_Rhynozic.png'
];

// ──────────────────────────────────────────────
// INSTALL : pré-cache le shell
// ──────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW] Installation ${APP_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      // NE PAS appeler skipWaiting ici : on attend que la page le demande
      // pour éviter de couper une session en cours
  );
});

// ──────────────────────────────────────────────
// ACTIVATE : supprimer les vieux caches
// ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[SW] Activation ${APP_VERSION}`);
  const keep = [CACHE_NAME, AUDIO_CACHE, IMG_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => {
          console.log('[SW] Suppression vieux cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────
// FETCH : stratégies par type de ressource
// ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Audio : réseau en priorité, cache en fallback
  if (/\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?.*)?$/i.test(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Images : cache-first
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico)(\?.*)?$/i.test(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch {
          return new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // Shell HTML / manifest : network-first, cache en fallback
  if (
    event.request.mode === 'navigate' ||
    url.endsWith('index.html') ||
    url.endsWith('manifest.json')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Tout le reste : network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ──────────────────────────────────────────────
// MESSAGE depuis la page principale
// ──────────────────────────────────────────────
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  // La page demande l'activation immédiate du nouveau SW
  if (data.type === 'SKIP_WAITING') {
    console.log('[SW] skipWaiting demandé par la page');
    self.skipWaiting();
  }

  // La page informe d'un changement de piste
  if (data.type === 'TRACK_CHANGED') {
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SW_ALIVE' }));
    });
  }
});
