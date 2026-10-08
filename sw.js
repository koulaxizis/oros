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

// SW-H: Normalize to ensure consistent cache key regardless of
// APP_VERSION format (shell may store "0.35.07" or "v0.35.07").
// GitHub Action should stamp just the version number; we prepend
// the oros-v prefix here for cache namespace separation.

var CACHE_VERSION = "oros-v0.42.02";
var SHELL_CACHE   = "oros-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "oros-runtime-" + CACHE_VERSION;
// MAPS-TILES (Wave 5): dedicated cache for map raster tiles.
// Deliberately OUTSIDE CACHE_VERSION — tiles must survive SW
// updates (browsing history is expensive to rebuild). Growth is
// bounded by TILE_MAX via occasional trims (oldest first).
var TILE_CACHE = "oros-map-tiles";
var TILE_MAX   = 2000;
var tilePutCount = 0;
// Exact host OR any subdomain of it ("a.tile.openstreetmap.org").
// Length-derived suffix test: hand-counted slice() offsets were off
// by one and silently excluded every {s}.tile.* subdomain — the
// default layer was never cached.
var TILE_HOSTS = [
  "tile.openstreetmap.org",
  "tile.openstreetmap.fr",
  "server.arcgisonline.com"
];
function isTileHost(hostname) {
  for (var i = 0; i < TILE_HOSTS.length; i++) {
    var base = TILE_HOSTS[i];
    if (hostname === base ||
        hostname.slice(-(base.length + 1)) === "." + base) return true;
  }
  return false;
}
function trimTileCache() {
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.keys().then(function (keys) {
      var excess = keys.length - TILE_MAX;
      if (excess <= 0) return;
      return Promise.all(keys.slice(0, excess).map(function (k) {
        return cache.delete(k);
      }));
    });
  });
}

// SW-D1: the release this worker belongs to — the same string the
// GitHub Action writes as ?v= on every .css/.js reference (both come
// from APP_VERSION in one pass).
var RELEASE = CACHE_VERSION.replace(/^oros-v/, "");

// SW-D1: the precache holds UNVERSIONED urls ("todo/todo.js"), the
// pages ask for stamped ones ("todo/todo.js?v=0.39.06"). An exact
// lookup never matched, so every release downloaded each file twice:
// once for the precache, once more on first use. A request stamped
// with THIS worker's release may be answered from THIS release's
// precache: that cache is created at install, straight from the
// network (SWK-1), and deleted with the release. A request with any
// other stamp (a page newer or older than this worker) goes to the
// network as before — the precache never decides for another release.
function releaseCopy(request, url) {
  if (url.searchParams.get("v") !== RELEASE) return Promise.resolve(undefined);
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true, ignoreVary: true });
  }).catch(function () { return undefined; });
}

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./shell.js",
  "./sync.js",
  "./fs.js",
  "./dialogs.js",
  "./notifications.js",
  "./pet.css",
  "./pet.js",
  "./vault.js",
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
  "bookmarks/",
  "bookmarks/index.html",
  "bookmarks/bookmarks.css",
  "bookmarks/bookmarks.js",
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
  "cycle/",
  "cycle/index.html",
  "cycle/cycle.css",
  "cycle/cycle.js",
  "contacts/",
  "contacts/index.html",
  "contacts/contacts.css",
  "contacts/contacts.js",
  "dice/",
  "dice/index.html",
  "dice/dice.css",
  "dice/dice.js",
  "minimalism/",
  "minimalism/index.html",
  "minimalism/minimalism.css",
  "minimalism/minimalism.js",
  "minimalism/content.js",
  "spreadsheet/",
  "spreadsheet/index.html",
  "spreadsheet/spreadsheet.css",
  "spreadsheet/spreadsheet.js",
  "radio/",
  "radio/index.html",
  "radio/radio.css",
  "radio/radio.js",
  "maps/",
  "maps/index.html",
  "maps/maps.css",
  "maps/maps.js",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
  "calculator/",
  "calculator/index.html",
  "calculator/calculator.css",
  "calculator/calculator.js",
  "television/",
  "television/index.html",
  "television/television.css",
  "television/television.js",
  "memory/",
  "memory/index.html",
  "memory/memory.css",
  "memory/memory.js",
  "connect4/",
  "connect4/index.html",
  "connect4/connect4.css",
  "connect4/connect4.js",
  "dots/",
  "dots/index.html",
  "dots/dots.css",
  "dots/dots.js",
  "tictactoe/",
  "tictactoe/index.html",
  "tictactoe/tictactoe.css",
  "tictactoe/tictactoe.js",
  "vendor/jspdf.umd.min.js",
  "vendor/hls.light.min.js",
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
      // SWK-1: cache.add(url) goes through the browser's HTTP cache,
      // and GitHub Pages serves everything with max-age=600. Two
      // releases within ten minutes could therefore precache the
      // PREVIOUS release's files under the new version's name — and
      // these unversioned copies are exactly what an offline first
      // open of an app is served. "reload" = always from the network.
      return Promise.all(PRECACHE_URLS.map(function (u) {
        return cache.add(new Request(u, { cache: "reload" })).catch(function (e) {
          console.warn("[SW] precache MISS:", u, e && e.message);
        });
      }));
    })
  );
});

// ---------- Activate: purge old caches ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE, "oros-television-api"];
  // SW-I: Add a guard against slow cache cleanup blocking claim.
  // If cleanup takes >30s (extreme), we still want to claim clients
  // to restore online/offline functionality. The background cleanup
  // continues but doesn't block activation indefinitely.
  var cleanup = caches.keys().then(function (names) {
    return Promise.all(names.map(function (name) {
      if (keep.indexOf(name) === -1) return caches.delete(name);
    }));
  }).then(function () {
    // tilePutCount lives in memory and dies with every idle SW
    // termination — short sessions could never reach the in-flight
    // trim. One trim per activation keeps TILE_MAX honest.
    return trimTileCache().catch(function () {});
  });

  // SWK-2: the timer was never cancelled — 30s after EVERY normal
  // activation it logged "cleanup took >30s" (false) and claimed a
  // second time. It is cleared the moment the cleanup path claims.
  var slowTimer = null;
  var claimWithTimeout = Promise.race([
    cleanup.then(function () {
      if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
      return self.clients.claim();
    }),
    new Promise(function (resolve) {
      slowTimer = setTimeout(function () {
        slowTimer = null;
        console.warn("[SW] Activate: cache cleanup took >30s, claiming clients anyway");
        resolve(self.clients.claim());
      }, 30000);
    })
  ]);

  event.waitUntil(claimWithTimeout);
});

// ---------- Fetch strategy ----------
self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") return;

  var url = new URL(request.url);

  // MAPS-TILES: tile servers are cross-origin, but they are pure
  // raster GETs — cache-first gives us offline maps for every
  // area the user has already seen. maps.js requests tiles in CORS
  // mode (crossOrigin), so the status is visible: ONLY real 200s
  // are stored. Opaque responses are never stored — their status is
  // unreadable (an error tile would be served forever) and browsers
  // pad their quota cost heavily.
  if (isTileHost(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(url).then(function (hit) {
          // A legacy OPAQUE entry cannot answer a CORS request (the
          // browser rejects it → blank tile forever). Treat it as a
          // miss; the fresh 200 below overwrites it.
          if (hit && !(hit.type === "opaque" && request.mode !== "no-cors")) return hit;
          return fetch(request).then(function (resp) {
            if (resp && resp.ok) {
              var copy = resp.clone();
              event.waitUntil(cache.put(url, copy).then(function () {
                // Bounded growth: trim occasionally, not per-tile
                if (++tilePutCount % 100 === 0) return trimTileCache();
              }));
            }
            return resp;
          }).catch(function () {
            return Response.error();   // offline & not cached → Leaflet shows its own blank
          });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;   // Dropbox & externals: untouched

  // S1 FIX: apps.json is NETWORK-FIRST. It is fetched unversioned
  // (no ?v= stamp), so a cache-first exact match would freeze the
  // app list at whatever the last CACHE_VERSION precached — a newly
  // added app would stay invisible to already-installed PWAs until
  // the next full release. Network-first keeps the list fresh on
  // every online visit; the precached copy remains the offline
  // fallback (zero offline regression).
  // SW2: exact-match the ROOT apps.json (pathname ends with it).
  // A substring test would silently swallow any future asset whose
  // name merely CONTAINS "apps.json" into the network-first branch.
  if (url.pathname.lastIndexOf("/apps.json") ===
        url.pathname.length - "/apps.json".length) {
    // SW-2/H10: "network-first" must mean network. A plain fetch()
    // honors the HTTP cache — a freshly deployed app could stay
    // invisible for the max-age window. no-store bypasses the HTTP
    // cache entirely; the RUNTIME_CACHE copy below stays as the
    // offline fallback (zero offline regression).
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          event.waitUntil(
            caches.open(RUNTIME_CACHE).then(function (cache) {
              return cache.put(request, copy);
            })
          );
        }
        return response;
      }).catch(function () {
        return caches.match(request)
          .then(function (c) { return c || Response.error(); });
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      // SW-2: GitHub Pages serves HTML with max-age=600 — a plain
      // fetch() honors the HTTP disk cache, so an online user (and
      // critically the broker's post-update reload) could receive a
      // 10-minute-stale index.html carrying old ?v= stamps: the
      // version toast would then LIE about having updated. no-cache
      // = always revalidate with the server (304s are cheap) — the
      // auto-update chain stays end-to-end fresh.
      fetch(request, { cache: "no-cache" })
        .then(function (response) {
          // Cache only REAL pages: a cached 404/502 becomes the
          // offline "truth" for that URL. OAuth redirects (?code=...)
          // are one-shot URLs — never worth a cache entry.
          // SWK-4: a REDIRECTED response ("todo" → "todo/") cannot be
          // replayed to a navigation from the cache — the browser
          // rejects it and the page fails offline. Never store one.
          if (response.ok && !response.redirected &&
              url.search.indexOf("code=") === -1) {
            var copy = response.clone();
            // waitUntil: the SW stays alive until the cache write
            // LANDS. A fire-and-forget put can be killed mid-flight
            // by an idle SW termination — the user who then goes
            // offline loses an asset they were entitled to.
            event.waitUntil(
              caches.open(RUNTIME_CACHE).then(function (cache) {
                return cache.put(request, copy);
              })
            );
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            if (cached) return cached;
            // SWK-3: the shell page is the right fallback for the TOP
            // window only. For an app frame it loaded orOS inside
            // orOS — a second shell, with its own sync engine, in the
            // iframe. An app that is not cached says so instead.
            if (request.destination === "iframe" || request.destination === "frame") {
              return new Response(
                '<!doctype html><meta charset="utf-8"><title>orOS</title>' +
                '<body style="margin:0;min-height:100vh;display:flex;align-items:center;' +
                'justify-content:center;text-align:center;padding:24px;box-sizing:border-box;' +
                'font-family:system-ui,sans-serif;background:#1b1a18;color:#e8eaf0;">' +
                '<p>Offline — this app has not been saved for offline use yet.<br>' +
                'Εκτός σύνδεσης — η εφαρμογή δεν έχει αποθηκευτεί ακόμη για χρήση χωρίς δίκτυο.</p></body>',
                { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
            }
            return caches.match("./index.html");
          });
        })
    );
    return;
  }

  // Sub-resources: cache-first with EXACT URL match. The ?v= stamp
  // in index.html changes the cache key on every release, so a new
  // version can never resolve to an old cached body.
  // SW-D1: next, a request stamped with THIS release is answered by
  // this release's own precache copy (releaseCopy). Everything else
  // goes to the network; the loose ignoreSearch match across caches
  // stays in the network-FAILURE branch only (offline best effort).
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return releaseCopy(request, url).then(function (pre) {
      if (pre) return pre;
      return fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          // Same waitUntil contract as the navigation branch above.
          event.waitUntil(
            caches.open(RUNTIME_CACHE).then(function (cache) {
              return cache.put(request, copy);   // stored under the EXACT ?v= key
            })
          );
        }
        return response;
      }).catch(function () {
        // OFFLINE only: exact key missed & network dead → legacy
        // best-effort match (unversioned precache entries)
        return caches.match(request, { ignoreSearch: true })
          .then(function (c2) { return c2 || Response.error(); });
      });
      });   // releaseCopy
    })
  );
});