// ============================================================
//  Rhynozic — Service Worker PWA
//  • Cache shell + assets statiques
//  • Cache audio/images pour lecture continue hors-ligne
//  • Background audio maintenu actif
//  • Notification système via MediaSession (déclenchée côté page)
// ============================================================

const CACHE_NAME   = 'rhynozic-v1';
const AUDIO_CACHE  = 'rhynozic-audio-v1';
const IMG_CACHE    = 'rhynozic-img-v1';

// Fichiers shell à mettre en cache dès l'installation
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

// ──────────────────────────────────────────────
// INSTALL : pré-cache le shell de l'app
// ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────────────
// ACTIVATE : nettoyer les vieux caches
// ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, AUDIO_CACHE, IMG_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────
// FETCH : stratégies différenciées par type
// ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // --- Fichiers AUDIO : cache-first avec mise à jour en background ---
  if (/\.(mp3|ogg|wav|flac|aac|m4a|opus)(\?.*)?$/i.test(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async cache => {
        const cached = await cache.match(request);
        // Pour l'audio on préfère le réseau pour toujours avoir le flux complet
        // mais on utilise le cache si réseau indisponible
        const networkFetch = fetch(request)
          .then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        // Retourner le cache immédiatement si disponible, sinon attendre réseau
        return cached || networkFetch;
      })
    );
    return;
  }

  // --- Images : cache-first ---
  if (/\.(jpg|jpeg|png|webp|gif|svg|ico)(\?.*)?$/i.test(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached || new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // --- Shell HTML / manifest : network-first, cache en fallback ---
  if (
    request.mode === 'navigate' ||
    url.endsWith('index.html') ||
    url.endsWith('manifest.json') ||
    url.endsWith('sw.js')
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // --- Tout le reste : network-first ---
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ──────────────────────────────────────────────
// MESSAGE depuis la page principale
// ──────────────────────────────────────────────
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'TRACK_CHANGED') {
    // Maintenir le SW actif + diffuser aux autres onglets
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SW_ALIVE', track: data.track || null }));
    });
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});