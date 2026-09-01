// ============================================
// orOS Service Worker
// Cache-first strategy with network fallback
// Version: 1.0.0
// ============================================

var CACHE_NAME = 'oros-v1.0.0';
var CACHE_URLS = [
  './',
  './index.html',
  './writer.html',
  './converter.html',
  './kanban.html',
  './notes.html',
  './prompter.html',
  './habits.html',
  './config.js',
  './manifest.json',
  './favicon.svg',
  './sitemap.xml',
  './ai-meta.txt',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './screenshots/writer.png',
  './screenshots/converter.png',
  './screenshots/kanban.png',
  './screenshots/notes.png',
  // Translations
  './assets/js/translations.json',
  // CSS
  './assets/css/style.css',
  './assets/css/icons.css',
  './assets/css/converter.css',
  './assets/css/kanban.css',
  './assets/css/notes.css',
  './assets/css/writer.css',
  './assets/css/prompter.css',
  './assets/css/habits.css',
  './assets/css/characters.css',
  // JS — Core
  './assets/js/global-settings.js',
  './assets/js/seo.js',
  './assets/js/main.js',
  // JS — Components
  './assets/js/components/header.js',
  './assets/js/components/footer.js',
  // JS — Libraries
  './assets/js/lib/jszip.min.js',
  './assets/js/lib/html2pdf.bundle.min.js',
  './assets/js/lib/mammoth.browser.min.js',
  './assets/js/lib/rtf-parser.js',
  // JS — App Logic
  './assets/js/writer.js',
  './assets/js/converter.js',
  './assets/js/kanban.js',
  './assets/js/notes.js',
  './assets/js/prompter.js',
  './assets/js/prompts.json',
  './assets/js/habits.js',
  './assets/js/characters.js',
  // Fonts
  './assets/fonts/nunito-regular.woff2',
  './assets/fonts/nunito-medium.woff2',
  './assets/fonts/nunito-semibold.woff2',
  './assets/fonts/nunito-bold.woff2',
  './assets/fonts/nunito-extrabold.woff2',
  './assets/fonts/forkawesome-webfont.woff2',
  './assets/fonts/forkawesome-webfont.woff',
  './assets/fonts/forkawesome-webfont.ttf',

];

// ========== INSTALL ==========
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS).catch(function(err) {
        console.warn('SW: Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ========== ACTIVATE ==========
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ========== FETCH ==========
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Stale-while-revalidate: return cache, update in background
        fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response.clone());
            });
          }
        }).catch(function() {});
        return cachedResponse;
      }

      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        var responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(function() {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        if ((event.request.url || '').indexOf('translations.json') !== -1) {
          return caches.match('./assets/js/translations.json');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ========== MESSAGE ==========
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});