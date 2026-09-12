// ============================================================
// orOS Core v0.18.1 — Service Worker
// Offline-first:
//   - Precache shell on install
//   - Cache-first assets, network-first navigations
//   - AUTO-UPDATE: skipWaiting() fires on install — a new worker
//     activates immediately; the inline broker in index.html
//     reloads the page on controllerchange. Zero user gates.
// Update ritual: the GitHub Action stamps CACHE_VERSION from
// APP_VERSION (shell.js) on every push to main. This value below
// is a manual safety stamp in case the Action ever fails.
// Dropbox calls are cross-origin — never touched by this SW.
// (strata: v0.13.1 notes/* precache — full banner history in CHANGELOG)
// ============================================================

var CACHE_VERSION = "oros-v0.24.7";
var SHELL_CACHE   = "oros-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "oros-runtime-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./shell.js",
  "./sync.js",
  "./translations.js",
  "./apps.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "todo/",
  "todo/index.html",
  "todo/todo.css",
  "todo/todo.js",
  "kanban/",
  "kanban/index.html",
  "kanban/kanban.css",
  "kanban/kanban.js",
  "notes/",
  "notes/index.html",
  "notes/notes.css",
  "notes/notes.js",
  "weather/",
  "weather/index.html",
  "weather/weather.css",
  "weather/weather.js",
  "mood/",
  "mood/index.html",
  "mood/mood.css",
  "mood/mood.js",
  "fonts/nunito-regular.woff2",
  "fonts/nunito-medium.woff2",
  "fonts/nunito-semibold.woff2",
  "fonts/nunito-bold.woff2",
  "fonts/nunito-extrabold.woff2"
];
self.addEventListener("install", function (event) {
  self.skipWaiting();          // zero-gate update: install → activate
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

// ---------- Activate: purge old caches ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (keep.indexOf(name) === -1) return caches.delete(name);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ---------- Fetch strategy ----------
self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Dropbox & externals: untouched

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

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
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