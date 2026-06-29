const CACHE_NAME = 'oros-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './editor.html',
  './assets/css/style.css',
  './assets/js/main.js',
  './assets/js/editor.js',
  './assets/js/translations.json',
  './favicon.svg',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(response => {
      if (response) return response;
      return fetch(e.request).then(networkResponse => {
        if (networkResponse.ok && e.request.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        return new Response('Offline — Your last cached version.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    })
  );
});