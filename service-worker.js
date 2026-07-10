// ============================================
// orOS Service Worker — Cache-First Strategy
// Uses OROS_CONFIG for cache name and base path
// ============================================

importScripts('config.js');

var CACHE_NAME = (typeof OROS_CONFIG !== 'undefined' && OROS_CONFIG.cacheName) || 'oros-cache';
var BASE = self.registration.scope || '/';

// Assets to cache precache (fonts, icons, static CSS/JS)
var ASSETS_TO_CACHE = [
  'favicon.svg',
  'assets/css/icons.css',
  'assets/css/style.css',
  'assets/fonts/nunito-regular.woff2',
  'assets/fonts/nunito-medium.woff2',
  'assets/fonts/nunito-semibold.woff2',
  'assets/fonts/nunito-bold.woff2',
  'assets/fonts/nunito-extrabold.woff2',
  'assets/fonts/forkawesome-webfont.woff2',
  'assets/fonts/forkawesome-webfont.woff',
  'assets/fonts/forkawesome-webfont.ttf'
];

// Dynamic assets to cache (JS files loaded by editor)
var SCRIPTS_TO_CACHE = [
  'assets/js/main.js',
  'assets/js/editor.js',
  'assets/js/components/header.js',
  'assets/js/components/footer.js',
  'assets/js/translations.json'
];

// ============================================
// INSTALL — Precache static assets
// ============================================
self.addEventListener('install', function(event) {
  console.log('[SW] Installing cache:', CACHE_NAME);
  
  var assetsToPreCache = ASSETS_TO_CACHE.concat(SCRIPTS_TO_CACHE);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Precaching', assetsToPreCache.length, 'files');
        return cache.addAll(assetsToPreCache.map(function(path) {
          return BASE + path;
        }));
      })
      .then(function() {
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.warn('[SW] Precache error:', err);
      })
  );
});

// ============================================
// ACTIVATE — Clean old caches
// ============================================
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating:', CACHE_NAME);
  
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys.filter(function(key) {
            return key !== CACHE_NAME;
          }).map(function(key) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
        );
      })
      .then(function() {
        return self.clients.claim();
      })
  );
});

// ============================================
// FETCH — Cache-first strategy for assets
// ============================================
self.addEventListener('fetch', function(event) {
  var requestUrl = new URL(event.request.url);
  var origin = self.location.origin;
  
  // Skip non-origin requests (don't proxy external resources)
  if (requestUrl.origin !== origin) {
    return;
  }

  // Cache-first for assets
  if (isAssetRequest(requestUrl.pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Network-first for HTML pages (fallback to cache)
  if (isHTMLRequest(requestUrl.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Default: cache-first for everything else
  event.respondWith(cacheFirst(event.request));
});

// ========== HELPER FUNCTIONS ==========

function isAssetRequest(path) {
  var assetExtensions = ['.css', '.js', '.json', '.svg', '.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg'];
  return assetExtensions.some(function(ext) {
    return path.endsWith(ext);
  });
}

function isHTMLRequest(path) {
  return path.endsWith('.html') || path === '/' || path === '/editor.html' || path === BASE || path === BASE + '/';
}

function cacheFirst(request) {
  return caches.open(CACHE_NAME)
    .then(function(cache) {
      return cache.match(request).then(function(matched) {
        if (matched) {
          console.log('[SW] Cache hit:', request.url);
          return matched;
        }
        console.log('[SW] Cache miss, fetching:', request.url);
        return fetch(request).then(function(response) {
          if (response.ok) {
            var responseClone = response.clone();
            cache.put(request, responseClone);
          }
          return response;
        });
      });
    });
}

function networkFirst(request) {
  return fetch(request)
    .then(function(response) {
      if (response.ok) {
        var responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then(function(cache) {
            cache.put(request, responseClone);
          });
      }
      return response;
    })
    .catch(function() {
      console.log('[SW] Network failed, trying cache:', request.url);
      return caches.open(CACHE_NAME)
        .then(function(cache) {
          return cache.match(request);
        });
    });
}