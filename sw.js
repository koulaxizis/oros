// ============================================================
// orOS Core v0.2 — Service Worker
// Offline-first strategy:
//   - Precache the entire shell on install
//   - Cache-first for same-origin GET requests
//   - Network-first for navigations (so new versions arrive),
//     falling back to cache when offline
//   - Runtime caching for internal apps (apps/*) as they are opened
// NOTE: Dropbox API calls (api.dropboxapi.com / content.dropboxapi.com /
// www.dropbox.com) are cross-origin and never touched by this SW.
// ============================================================

var CACHE_VERSION = "oros-v0.2";
var SHELL_CACHE   = "oros-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "oros-runtime-" + CACHE_VERSION;

// Everything the shell needs to boot with zero network
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./shell.js",
  "./sync.js",
  "./translations.js",
  "./apps.json",
  "./manifest.webmanifest"
];

// ---------- Install: precache shell, activate immediately ----------
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// ---------- Activate: purge old cache versions, take control ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (keep.indexOf(name) === -1) return caches.delete(name);
        }));
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// ---------- Fetch strategy ----------
self.addEventListener("fetch", function (event) {
  var request = event.request;

  // Only handle same-origin GET requests
  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;  // Dropbox & externals: untouched

  // Navigations: network first (updates reach users), cache fallback offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(RUNTIME_CACHE).then(function (cache) {
            cache.put(request, copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            if (cached) return cached;
            return caches.match("./index.html");
          });
        })
    );
    return;
  }

  // Assets: cache first, then network; network results cached
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (!response || response.status !== 200) return response;
        var copy = response.clone();
        caches.open(RUNTIME_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      }).catch(function () {
        return Response.error();
      });
    })
  );
});