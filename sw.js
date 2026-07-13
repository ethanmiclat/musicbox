/* MusicBox — service worker.
   Division of labor: this worker caches the app shell and cover-art
   images. API *data* (charts, search results, metadata) is cached in
   localStorage by js/api.js — the worker deliberately passes those
   requests through so there's one source of truth per kind of thing. */

// Bump the shell version whenever app files change so installed clients
// pick up the new build on their next visit.
const SHELL_CACHE = 'musicbox-shell-v13';
const IMAGE_CACHE = 'musicbox-images-v1';
const IMAGE_LIMIT = 300;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/main.js',
  './js/storage.js',
  './js/api.js',
  './js/render.js',
  './js/search.js',
  './js/nav.js',
  './js/audio.js',
  './js/importer.js',
  './js/charts.js',
  './js/recap.js',
  './fonts/bricolage-grotesque-200-800-normal.woff2',
  './fonts/figtree-300-900-normal.woff2',
  './fonts/figtree-300-900-italic.woff2',
  './fonts/courier-prime-400-normal.woff2',
  './fonts/courier-prime-700-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== IMAGE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

async function trimImageCache() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length > IMAGE_LIMIT) {
    await Promise.all(keys.slice(0, keys.length - IMAGE_LIMIT).map(k => cache.delete(k)));
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // App shell: cache-first, refresh in the background.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fresh = fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  // Cover art & remote images: cache-first with a size cap.
  const isImage = event.request.destination === 'image'
    || /mzstatic\.com|coverartarchive\.org/.test(url.hostname);
  if (isImage) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res.ok || res.type === 'opaque') {
            cache.put(event.request, res.clone());
            trimImageCache();
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
  }
  // Everything else (API JSON, audio previews) passes through — the app's
  // localStorage layer owns that caching.
});
