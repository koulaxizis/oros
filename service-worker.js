const CACHE_NAME = 'oros-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/editor.html',
  '/assets/css/style.css',
  '/assets/js/main.js',
  '/assets/js/editor.js',
  '/assets/js/translations.json',
  '/assets/js/components/header.js',
  '/assets/js/components/footer.js',
  '/assets/fonts/nunito-regular.woff2',
  '/assets/fonts/nunito-medium.woff2',
  '/assets/fonts/nunito-semibold.woff2',
  '/assets/fonts/nunito-bold.woff2',
  '/assets/fonts/nunito-extrabold.woff2',
  '/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
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