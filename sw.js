// ============================================================
// orOS Core — Service Worker
// Offline-first:
//   - Precache shell on install
//   - Cache-first assets, network-first navigations
//   - AUTO-UPDATE: skipWaiting() fires on install — a new worker
//     activates immediately; the timer-based broker in index.html
//     reloads the page on controllerchange. Zero user gates.
// Update ritual: the GitHub Action stamps CACHE_VERSION from
// APP_VERSION (shell.js) on every push to main. This value below
// is a manual safety stamp in case the Action ever fails.
// Versioning: orOS-wide version lives ONLY in shell.js (single
// source of truth) — CACHE_VERSION mirrors it as the cache key.
// Dropbox calls are cross-origin — never touched by this SW.
// (strata: v0.13.1 notes/* precache — full banner history in CHANGELOG)
// ============================================================

var CACHE_VERSION = "oros-v0.35.03"; // MANUAL STAMP — GitHub Action should match APP_VERSION from shell.js; bump on every deploy if Action fails
var SHELL_CACHE   = "oros-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "oros-runtime-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./shell.js",
  "./sync.js",
  "./fs.js",
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
  "time/",
  "time/index.html",
  "time/time.css",
  "time/time.js",
  "time/astro.js",
  "calendar/",
  "calendar/index.html",
  "calendar/calendar.css",
  "calendar/calendar.js",
  "quote/",
  "quote/index.html",
  "quote/quote.css",
  "quote/quote.js",
  "storage/",
  "storage/index.html",
  "storage/storage.css",
  "storage/storage.js",
  "prompter/",
  "prompter/index.html",
  "prompter/prompter.css",
  "prompter/prompter.js",
  "habits/",
  "habits/index.html",
  "habits/habits.css",
  "habits/habits.js",
  "files/",
  "files/index.html",
  "files/files.css",
  "files/files.js",
  "writer/",
  "writer/index.html",
  "writer/writer.css",
  "writer/writer.js",
  "characters/",
  "characters/index.html",
  "characters/characters.css",
  "characters/characters.js",
  "vendor/jspdf.umd.min.js",
  "vendor/NotoSans-Regular.ttf",
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
      // D1: addAll is ALL-OR-NOTHING — one 404/timeout on any of the
      // ~47 URLs aborts the ENTIRE install → SW never activates →
      // ZERO offline, silently, forever. Per-URL add instead: a single
      // missing asset degrades (that one page offline-less) instead of
      // nuking the whole precache. Failures SPEAK in the SW console.
      return Promise.all(PRECACHE_URLS.map(function (u) {
        return cache.add(u).catch(function (e) {
          console.warn("[SW] precache MISS:", u, e && e.message);
        });
      }));
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
          // Cache only REAL pages: a cached 404/502 becomes the
          // offline "truth" for that URL. OAuth redirects (?code=...)
          // are one-shot URLs — never worth a cache entry.
          if (response.ok && url.search.indexOf("code=") === -1) {
            var copy = response.clone();
            caches.open(RUNTIME_CACHE).then(function (cache) {
              cache.put(request, copy);
            });
          }
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

  // Sub-resources: cache-first with EXACT URL match. The ?v= stamp
  // in index.html changes the cache key on every release, so a new
  // version can never resolve to an old cached body. Unversioned
  // precache entries survive ONLY as an offline best-effort
  // fallback (ignoreSearch moves to the network-failure branch —
  // it must never decide what an ONLINE user sees).
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(RUNTIME_CACHE).then(function (cache) {
            cache.put(request, copy);   // stored under the EXACT ?v= key
          });
        }
        return response;
      }).catch(function () {
        // OFFLINE only: exact key missed & network dead → legacy
        // best-effort match (unversioned precache entries)
        return caches.match(request, { ignoreSearch: true })
          .then(function (c2) { return c2 || Response.error(); });
      });
    })
  );
});