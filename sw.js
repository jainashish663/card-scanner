const CACHE_NAME = 'card-scanner-v10';
// CDN assets (OCR engine, wasm, language data, XLSX) live in their own cache
// that survives app-shell version bumps — the language data alone is ~15MB
// and re-downloading it on every app update would defeat the point.
const CDN_CACHE = 'card-scanner-cdn-v1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './parser.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cross-origin (CDN) requests: cache-first so the OCR engine and Excel
  // library keep working offline after their first successful load.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((res) => {
            if (res.ok || res.type === 'opaque') {
              cache.put(event.request, res.clone());
            }
            return res;
          });
        })
      )
    );
    return;
  }

  // Same-origin: cache-first, and if both cache and network fail on a page
  // navigation, serve the app shell instead of the browser error page.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
