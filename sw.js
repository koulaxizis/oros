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

var CACHE_VERSION = "oros-v8.80.00";
var SHELL_CACHE   = "oros-shell-" + CACHE_VERSION;
var RUNTIME_CACHE = "oros-runtime-" + CACHE_VERSION;
// WebLLM's library (vendor/webllm, about 7 MB, loaded only when the
// Assistant's in-browser model is used): one copy kept across
// releases, so a downloaded model keeps working offline after an update.
var WEBLLM_CACHE = "oros-webllm";
// Language packs (i18n.js, i18n/<code>/…): one copy kept across
// releases, so a chosen language keeps working offline after an update.
var LANG_CACHE = "oros-lang-packs";
// Studio's NULL JSFX effect files (studio/nullfx/fx/<id>.js, about 4 MB
// for all of them) are not precached: each one is stored here the first
// time Studio loads it, and this cache outlives releases, so an effect
// that was opened once keeps working offline. A copy from an older
// release is refreshed while online and only used as an offline fallback.
var NULLFX_CACHE = "oros-nullfx";
// Studio's instrument packs (koulaxizis/oros-sounds on GitHub Pages, cross-origin,
// so this SW never answers for them): studio/sounds.js keeps every file it
// downloaded here, and the cache outlives releases like the effect files.
var SOUNDS_CACHE = "oros-sounds";
// The page an app frame gets offline before it was saved (fetch,
// below). "sw.offline" is also in translations.js, so a pack language
// reads it from its shell pack.
var OFFLINE_T = {
  en: { "sw.offline": "Offline — this app has not been saved for offline use yet." },
  el: { "sw.offline": "Εκτός σύνδεσης — η εφαρμογή δεν έχει αποθηκευτεί ακόμη για χρήση χωρίς δίκτυο." }
};
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
  "server.arcgisonline.com",
  "tile.opentopomap.org"
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
// SW-K1: looked up by its exact unversioned key, never with
// ignoreSearch: Chrome answers an ignoreSearch match by reading every
// entry of the cache (about 1,800), so each script cost about 180 ms
// on the first open after the browser started, one after another:
// 8 s and more of "--:--" before the desktop, the same in every app.
function releaseCopy(request, url) {
  if (url.searchParams.get("v") !== RELEASE) return Promise.resolve(undefined);
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(url.origin + url.pathname, { ignoreVary: true });
  }).catch(function () { return undefined; });
}

// SW-F1: the precached copy of a page in THIS release, or undefined.
// The query is ignored (the pages are static; the script on the page
// reads its own query: ?code=, ?file-open=, ?solo=, ?standalone).
// A redirected copy cannot answer a navigation (SWK-4).
// SW-K1: exact key without the query, not ignoreSearch (above).
function releasePage(request) {
  var url = new URL(request.url);
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(url.origin + url.pathname, { ignoreVary: true });
  }).then(function (hit) {
    return hit && !hit.redirected ? hit : undefined;
  }).catch(function () { return undefined; });
}

// SW-T1: on a bad connection ("lie-fi": online, but packets crawl or
// stall) a network-first fetch() could hang for minutes before it
// failed, and only THEN fell back to the cache — the installed PWA
// sat on the splash or never opened. Network-first now waits at most
// NET_TIMEOUT_MS: after that the cached copy answers, and the network
// response, if it still arrives, refreshes the cache in the
// background (the next open is fresh). With no cached copy the
// request keeps waiting for the network, as before.
var NET_TIMEOUT_MS = 3000;
// After one timeout the connection is known to be bad: for the next
// NET_SLOW_MS a network-first request with a cached copy answers from
// the cache at once (the network still refreshes it in the
// background). Opening orOS then costs one wait, not one per request
// (page, then apps.json, then every app frame). A quick network
// answer ends the slow spell.
var NET_SLOW_MS = 30000;
var netSlowUntil = 0;

// SW-T2: stored in this release's shell cache while its precache is
// incomplete (see install).
var PARTIAL_MARK = "./__oros-precache-partial__";

// fetchInit: options for fetch(). store(response): may it be cached.
// cached(): Promise of the cached answer, or undefined.
// offline(): the answer when the network FAILS and nothing is cached.
function networkFirst(event, request, fetchInit, store, cached, offline) {
  var started = Date.now();
  var wait = started < netSlowUntil ? 0 : NET_TIMEOUT_MS;
  var net = fetch(request, fetchInit).then(function (response) {
    if (Date.now() - started < NET_TIMEOUT_MS) netSlowUntil = 0;
    if (response && store(response)) {
      var copy = response.clone();
      // waitUntil: the SW stays alive until the cache write LANDS —
      // also when the cached copy already answered the page.
      event.waitUntil(
        caches.open(RUNTIME_CACHE).then(function (cache) {
          return cache.put(request, copy);
        }).catch(function () {})
      );
    }
    return response;
  });
  // Keep the worker alive for a late network answer (background update).
  event.waitUntil(net.catch(function () {}));

  return new Promise(function (resolve) {
    var settled = false;
    var timer = null;
    function answer(r) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    }
    function lookup() {
      return Promise.resolve().then(cached).catch(function () { return undefined; });
    }
    timer = setTimeout(function () {
      timer = null;
      if (wait) netSlowUntil = Date.now() + NET_SLOW_MS;
      lookup().then(function (c) { if (c) answer(c); });   // a miss keeps waiting
    }, wait);
    net.then(answer, function () {
      lookup().then(function (c) { answer(c || offline()); });
    });
  });
}

// SW2: exact-match the ROOT apps.json (pathname ends with it).
// A substring test would silently swallow any future asset whose
// name merely CONTAINS "apps.json" into the network-first branch.
// SW-T3: the old test, lastIndexOf(...) === length - 10, was also
// true for EVERY 9-character path ("/shell.js", "/vault.js",
// "/icon.svg"): lastIndexOf gives -1 and so did the subtraction. The
// shell's own scripts went network-first, so on a bad connection
// orOS hung on them even with a cached page.
function isAppsList(pathname) {
  var tail = "/apps.json";
  var at = pathname.length - tail.length;
  return at >= 0 && pathname.indexOf(tail, at) === at;
}

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./fonts.css",
  "./search.js",
  "./shell.js",
  "./sync.js",
  "./fs.js",
  "./dialogs.js",
  "./pcdialog.js",
  "./notifications.js",
  "./pet.css",
  "./iconpacks.css",
  "./pet.js",
  "./launcher.js",
  "./quickmenu.js",
  "./profiles.js",
  "./seasonal.js",
  "./osk.js",
  "./qsettings.js",
  "./widgets.js",
  "./nightlight.js",
  "./a11yfx.js",
  "./smartbar.js",
  "./smartbar-apps.js",
  "./smartbar-live.js",
  "./cliphist.js",
  "./pocket.js",
  "./focus/core.js",
  "./readaloud.js",
  "./continue.js",
  "./textrepl.js",
  "./localroots.js",
  "./emoji.js",
  "emoji/data.js",
  "./fileopen.js",
  "./phone.js",
  "./webpush.js",
  "./vault.js",
  "./remote-link.js",
  "./pair.js",
  "./i18n.js",
  "./pickers.js",
  "./pickers.css",
  "./pickers-ui.js",
  "./pickers-ui.css",
  "./ocrkit.js",
  "./ocrkit-ui.js",
  "./ocrkit-ui.css",
  "./diag.js",
  "./i18n-tables.js",
  "./translations.js",
  "./lock.js",
  "./apps.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./solo.js",
  "./uifont.js",
  "notes/solo.html",
  "notes/manifest.webmanifest",
  "calendar/solo.html",
  "calendar/manifest.webmanifest",
  "bookmarks/solo.html",
  "bookmarks/manifest.webmanifest",
  "todo/solo.html",
  "todo/manifest.webmanifest",
  "contacts/solo.html",
  "contacts/manifest.webmanifest",
  "writer/solo.html",
  "writer/manifest.webmanifest",
  "spreadsheet/solo.html",
  "spreadsheet/manifest.webmanifest",
  "kanban/solo.html",
  "kanban/manifest.webmanifest",
  "mindmap/solo.html",
  "mindmap/manifest.webmanifest",
  "wiki/solo.html",
  "wiki/manifest.webmanifest",
  "slides/solo.html",
  "slides/manifest.webmanifest",
  "passwords/solo.html",
  "passwords/manifest.webmanifest",
  "budget/solo.html",
  "budget/manifest.webmanifest",
  "habits/solo.html",
  "habits/manifest.webmanifest",
  "water/solo.html",
  "water/manifest.webmanifest",
  "diary/solo.html",
  "diary/manifest.webmanifest",
  "mood/solo.html",
  "mood/manifest.webmanifest",
  "fitness/solo.html",
  "fitness/manifest.webmanifest",
  "health/solo.html",
  "health/manifest.webmanifest",
  "cycle/solo.html",
  "cycle/manifest.webmanifest",
  "calculator/solo.html",
  "calculator/manifest.webmanifest",
  "time/solo.html",
  "time/manifest.webmanifest",
  "weather/solo.html",
  "weather/manifest.webmanifest",
  "maps/solo.html",
  "maps/manifest.webmanifest",
  "feeds/solo.html",
  "feeds/manifest.webmanifest",
  "mail/solo.html",
  "mail/manifest.webmanifest",
  "files/solo.html",
  "files/manifest.webmanifest",
  "podcasts/solo.html",
  "podcasts/manifest.webmanifest",
  "radio/solo.html",
  "radio/manifest.webmanifest",
  "music/solo.html",
  "music/manifest.webmanifest",
  "photolab/solo.html",
  "photolab/manifest.webmanifest",
  "invoices/solo.html",
  "invoices/manifest.webmanifest",
  "transfer/solo.html",
  "transfer/manifest.webmanifest",
  "scanpdf/solo.html",
  "scanpdf/manifest.webmanifest",
  "shop/",
  "shop/index.html",
  "shop/app.css",
  "shop/app.js",
  "shop/core.js",
  "shop/search.js",
  "shop/today.js",
  "shop/help.en.txt",
  "shop/help.el.txt",
  "stock/solo.html",
  "stock/manifest.webmanifest",
  "forms/solo.html",
  "forms/manifest.webmanifest",
  "library/solo.html",
  "library/manifest.webmanifest",
  "base/solo.html",
  "base/manifest.webmanifest",
  "crm/solo.html",
  "crm/manifest.webmanifest",
  "timesheet/solo.html",
  "timesheet/manifest.webmanifest",
  "gamecenter/solo.html",
  "gamecenter/manifest.webmanifest",
  "icons/solo/notes.svg",
  "icons/solo/notes-192.png",
  "icons/solo/notes-512.png",
  "icons/solo/notes-maskable-512.png",
  "icons/solo/calendar.svg",
  "icons/solo/calendar-192.png",
  "icons/solo/calendar-512.png",
  "icons/solo/calendar-maskable-512.png",
  "icons/solo/bookmarks.svg",
  "icons/solo/bookmarks-192.png",
  "icons/solo/bookmarks-512.png",
  "icons/solo/bookmarks-maskable-512.png",
  "icons/solo/todo.svg",
  "icons/solo/todo-192.png",
  "icons/solo/todo-512.png",
  "icons/solo/todo-maskable-512.png",
  "icons/solo/contacts.svg",
  "icons/solo/contacts-192.png",
  "icons/solo/contacts-512.png",
  "icons/solo/contacts-maskable-512.png",
  "icons/solo/writer.svg",
  "icons/solo/writer-192.png",
  "icons/solo/writer-512.png",
  "icons/solo/writer-maskable-512.png",
  "icons/solo/spreadsheet.svg",
  "icons/solo/spreadsheet-192.png",
  "icons/solo/spreadsheet-512.png",
  "icons/solo/spreadsheet-maskable-512.png",
  "icons/solo/kanban.svg",
  "icons/solo/kanban-192.png",
  "icons/solo/kanban-512.png",
  "icons/solo/kanban-maskable-512.png",
  "icons/solo/mindmap.svg",
  "icons/solo/mindmap-192.png",
  "icons/solo/mindmap-512.png",
  "icons/solo/mindmap-maskable-512.png",
  "icons/solo/wiki.svg",
  "icons/solo/wiki-192.png",
  "icons/solo/wiki-512.png",
  "icons/solo/wiki-maskable-512.png",
  "icons/solo/slides.svg",
  "icons/solo/slides-192.png",
  "icons/solo/slides-512.png",
  "icons/solo/slides-maskable-512.png",
  "icons/solo/passwords.svg",
  "icons/solo/passwords-192.png",
  "icons/solo/passwords-512.png",
  "icons/solo/passwords-maskable-512.png",
  "icons/solo/budget.svg",
  "icons/solo/budget-192.png",
  "icons/solo/budget-512.png",
  "icons/solo/budget-maskable-512.png",
  "icons/solo/habits.svg",
  "icons/solo/habits-192.png",
  "icons/solo/habits-512.png",
  "icons/solo/habits-maskable-512.png",
  "icons/solo/water.svg",
  "icons/solo/water-192.png",
  "icons/solo/water-512.png",
  "icons/solo/water-maskable-512.png",
  "icons/solo/diary.svg",
  "icons/solo/diary-192.png",
  "icons/solo/diary-512.png",
  "icons/solo/diary-maskable-512.png",
  "icons/solo/mood.svg",
  "icons/solo/mood-192.png",
  "icons/solo/mood-512.png",
  "icons/solo/mood-maskable-512.png",
  "icons/solo/fitness.svg",
  "icons/solo/fitness-192.png",
  "icons/solo/fitness-512.png",
  "icons/solo/fitness-maskable-512.png",
  "icons/solo/health.svg",
  "icons/solo/health-192.png",
  "icons/solo/health-512.png",
  "icons/solo/health-maskable-512.png",
  "icons/solo/cycle.svg",
  "icons/solo/cycle-192.png",
  "icons/solo/cycle-512.png",
  "icons/solo/cycle-maskable-512.png",
  "icons/solo/calculator.svg",
  "icons/solo/calculator-192.png",
  "icons/solo/calculator-512.png",
  "icons/solo/calculator-maskable-512.png",
  "icons/solo/time.svg",
  "icons/solo/time-192.png",
  "icons/solo/time-512.png",
  "icons/solo/time-maskable-512.png",
  "icons/solo/weather.svg",
  "icons/solo/weather-192.png",
  "icons/solo/weather-512.png",
  "icons/solo/weather-maskable-512.png",
  "icons/solo/maps.svg",
  "icons/solo/maps-192.png",
  "icons/solo/maps-512.png",
  "icons/solo/maps-maskable-512.png",
  "icons/solo/feeds.svg",
  "icons/solo/feeds-192.png",
  "icons/solo/feeds-512.png",
  "icons/solo/feeds-maskable-512.png",
  "icons/solo/mail.svg",
  "icons/solo/mail-192.png",
  "icons/solo/mail-512.png",
  "icons/solo/mail-maskable-512.png",
  "icons/solo/files.svg",
  "icons/solo/files-192.png",
  "icons/solo/files-512.png",
  "icons/solo/files-maskable-512.png",
  "icons/solo/podcasts.svg",
  "icons/solo/podcasts-192.png",
  "icons/solo/podcasts-512.png",
  "icons/solo/podcasts-maskable-512.png",
  "icons/solo/radio.svg",
  "icons/solo/radio-192.png",
  "icons/solo/radio-512.png",
  "icons/solo/radio-maskable-512.png",
  "icons/solo/music.svg",
  "icons/solo/music-192.png",
  "icons/solo/music-512.png",
  "icons/solo/music-maskable-512.png",
  "icons/solo/photolab.svg",
  "icons/solo/photolab-192.png",
  "icons/solo/photolab-512.png",
  "icons/solo/photolab-maskable-512.png",
  "icons/solo/invoices.svg",
  "icons/solo/invoices-192.png",
  "icons/solo/invoices-512.png",
  "icons/solo/invoices-maskable-512.png",
  "icons/solo/transfer.svg",
  "icons/solo/transfer-192.png",
  "icons/solo/transfer-512.png",
  "icons/solo/transfer-maskable-512.png",
  "icons/solo/scanpdf.svg",
  "icons/solo/scanpdf-192.png",
  "icons/solo/scanpdf-512.png",
  "icons/solo/scanpdf-maskable-512.png",
  "icons/solo/stock.svg",
  "icons/solo/stock-192.png",
  "icons/solo/stock-512.png",
  "icons/solo/stock-maskable-512.png",
  "icons/solo/forms.svg",
  "icons/solo/forms-192.png",
  "icons/solo/forms-512.png",
  "icons/solo/forms-maskable-512.png",
  "icons/solo/library.svg",
  "icons/solo/library-192.png",
  "icons/solo/library-512.png",
  "icons/solo/library-maskable-512.png",
  "icons/solo/base.svg",
  "icons/solo/base-192.png",
  "icons/solo/base-512.png",
  "icons/solo/base-maskable-512.png",
  "icons/solo/crm.svg",
  "icons/solo/crm-192.png",
  "icons/solo/crm-512.png",
  "icons/solo/crm-maskable-512.png",
  "icons/solo/timesheet.svg",
  "icons/solo/timesheet-192.png",
  "icons/solo/timesheet-512.png",
  "icons/solo/timesheet-maskable-512.png",
  "icons/solo/gamecenter.svg",
  "icons/solo/gamecenter-192.png",
  "icons/solo/gamecenter-512.png",
  "icons/solo/gamecenter-maskable-512.png",
  "todo/",
  "todo/index.html",
  "todo/todo.css",
  "todo/todo.js",
  "todo/import.js",
  "todo/gtasks.js",
  "todo/search.js",
  "todo/platforms.js",
  "todo/package.js",
  "kanban/",
  "kanban/index.html",
  "kanban/kanban.css",
  "kanban/kanban.js",
  "kanban/import.js",
  "mindmap/",
  "mindmap/index.html",
  "mindmap/search.js",
  "mindmap/mindmap.css",
  "mindmap/mm-core.js",
  "mindmap/mm-import.js",
  "mindmap/mindmap.js",
  "mindmap/commands.js",
  "mindmap/assist.js",
  "mindmap/help.en.txt",
  "mindmap/help.el.txt",
  "whiteboard/",
  "whiteboard/index.html",
  "whiteboard/app.css",
  "whiteboard/core.js",
  "whiteboard/kit.js",
  "whiteboard/app.js",
  "whiteboard/search.js",
  "whiteboard/commands.js",
  "whiteboard/diagram.js",
  "whiteboard/assist.js",
  "whiteboard/help.en.txt",
  "whiteboard/help.el.txt",
  "forms/",
  "forms/index.html",
  "forms/app.css",
  "forms/engine.js",
  "forms/core.js",
  "forms/render.js",
  "forms/app.js",
  "forms/help.en.txt",
  "forms/help.el.txt",
  "forms/pub.js",
  "forms/share.js",
  "forms/host.js",
  "forms/today.js",
  "forms/f/index.html",
  "forms/f/fill.js",
  "forms/f/fill.css",
  "forms/quiz.js",
  "forms/results.js",
  "forms/links.js",
  "forms/search.js",
  "kanban/search.js",
  "notes/",
  "notes/index.html",
  "notes/notes.css",
  "notes/expire.js",
  "notes/notes.js",
  "notes/package.js",
  "notes/house.js",
  "notes/search.js",
  "notes/platforms.js",
  "wiki/",
  "wiki/index.html",
  "wiki/wiki.css",
  "wiki/core.js",
  "wiki/wiki.js",
  "wiki/import.js",
  "wiki/search.js",
  "wiki/pdf.js",
  "wiki/io.js",
  "weather/",
  "weather/index.html",
  "weather/weather.css",
  "weather/weather.js",
  "mood/",
  "mood/index.html",
  "mood/search.js",
  "mood/mood.css",
  "mood/mood.js",
  "mood/import.js",
  "diary/",
  "diary/index.html",
  "diary/search.js",
  "diary/diary.css",
  "diary/core.js",
  "diary/diary.js",
  "diary/dayline.js",
  "diary/import.js",
  "time/",
  "time/index.html",
  "time/time.css",
  "time/time.js",
  "time/astro.js",
  "time/stage-core.js",
  "time/stage.js",
  "time/stage-view.js",
  "time/stage-view.css",
  "time/display.html",
  "time/display.js",
  "time/stage-link.js",
  "time/stage-tools.js",
  "time/search.js",
  "sky/",
  "sky/index.html",
  "sky/core.js",
  "sky/stars.js",
  "sky/view.js",
  "sky/view.css",
  "calendar/",
  "calendar/index.html",
  "calendar/calendar.css",
  "calendar/calendar.js",
  "calendar/namedays.js",
  "calendar/ics.js",
  "calendar/gcal.js",
  "calendar/days.json",
  "calendar/search.js",
  "quote/",
  "quote/index.html",
  "quote/search.js",
  "quote/view.js",
  "quote/view.css",
  "invoices/",
  "invoices/index.html",
  "invoices/invoices.css",
  "invoices/core.js",
  "invoices/invoices.js",
  "invoices/search.js",
  "newsletter/",
  "newsletter/index.html",
  "newsletter/newsletter.css",
  "newsletter/social.js",
  "newsletter/core.js",
  "newsletter/render.js",
  "newsletter/engine.js",
  "newsletter/runner.js",
  "newsletter/today.js",
  "newsletter/archive.js",
  "newsletter/platforms.js",
  "newsletter/shop.js",
  "newsletter/newsletter.js",
  "newsletter/import2.js",
  "newsletter/search.js",
  "signature/",
  "signature/index.html",
  "signature/core.js",
  "signature/view.js",
  "signature/view.css",
  "signature/search.js",
  "certificates/",
  "certificates/index.html",
  "certificates/certificates.css",
  "certificates/core.js",
  "certificates/dk.js",
  "certificates/certificates.js",
  "certificates/package.js",
  "certificates/search.js",
  "certificates/badges.js",
  "certificates/send.js",
  "publish/",
  "publish/index.html",
  "publish/app.css",
  "publish/core.js",
  "publish/app.js",
  "publish/search.js",
  "publish/feed.js",
  "publish/today.js",
  "publish/royalty.js",
  "publish/distro.js",
  "publish/costs.js",
  "invoices/today.js",
  "invoices/mydata-ui.js",
  "crm/",
  "crm/index.html",
  "crm/crm.css",
  "crm/core.js",
  "crm/contactsync.js",
  "crm/links.js",
  "crm/overview.js",
  "crm/timeline.js",
  "crm/rs.js",
  "crm/platforms.js",
  "crm/webform.js",
  "crm/crm.js",
  "crm/search.js",
  "crm/today.js",
  "timesheet/",
  "timesheet/index.html",
  "timesheet/search.js",
  "timesheet/timesheet.css",
  "timesheet/core.js",
  "water/",
  "water/index.html",
  "water/water.css",
  "water/core.js",
  "transfer/",
  "transfer/index.html",
  "transfer/receive.html",
  "transfer/app.css",
  "transfer/art.js",
  "transfer/core.js",
  "transfer/today.js",
  "transfer/cloud.js",
  "transfer/engine.js",
  "transfer/store.js",
  "transfer/app.js",
  "transfer/search.js",
  "transfer/help.en.txt",
  "transfer/help.el.txt",
  "mail/",
  "mail/index.html",
  "mail/search.js",
  "mail/mail.css",
  "mail/mail.js",
  "mail/mime.js",
  "mail/sanitize.js",
  "mail/compose.js",
  "mail/notify.js",
  "mail/trust.js",
  "mail/rules.js",
  "mail/rich.js",
  "mail/threads.js",
  "mail/outbox.js",
  "mail/people.js",
  "mail/sieve.js",
  "shelf/",
  "shelf/index.html",
  "shelf/search.js",
  "shelf/feed.js",
  "shelf/shelf.css",
  "shelf/shelf.js",
  "shelf/import.js",
  "shelf/gbooks.js",
  "library/",
  "library/index.html",
  "library/search.js",
  "library/speak.js",
  "library/stats.js",
  "library/import.js",
  "library/hlimport.js",
  "library/today.js",
  "library/lookup.js",
  "library/library.css",
  "library/core.js",
  "library/sanitize.js",
  "library/strings.js",
  "library/app.js",
  "library/store.js",
  "library/home.js",
  "library/reader.js",
  "library/epub.js",
  "library/pdfview.js",
  "water/water.js",
  "water/help.en.txt",
  "water/help.el.txt",
  "timesheet/timesheet.js",
  "timesheet/import.js",
  "storage/",
  "storage/index.html",
  "storage/search.js",
  "storage/storage.css",
  "storage/storage.js",
  "storage/import.js",
  "bookmarks/",
  "bookmarks/index.html",
  "qr/",
  "qr/index.html",
  "qr/qr.css",
  "qr/qr-encode.js",
  "qr/qr-payload.js",
  "qr/qr.js",
  "bookmarks/bookmarks.css",
  "bookmarks/bookmarks.js",
  "bookmarks/import.js",
  "bookmarks/search.js",
  "bookmarks/platforms.js",
  "prompter/",
  "prompter/index.html",
  "prompter/search.js",
  "pubdomain/",
  "pubdomain/index.html",
  "pubdomain/pubdomain.css",
  "pubdomain/rules.js",
  "pubdomain/pubdomain.js",
  "pubdomain/help.en.txt",
  "pubdomain/help.el.txt",
  "prompter/prompter.css",
  "prompter/prompter.js",
  "prompter/io.js",
  "typewriter/",
  "typewriter/index.html",
  "typewriter/typewriter.css",
  "typewriter/core.js",
  "typewriter/typewriter.js",
  "labels/",
  "labels/index.html",
  "labels/labels.css",
  "labels/core.js",
  "labels/labels.js",
  "labels/search.js",
  "typewriter/help.en.txt",
  "typewriter/help.el.txt",
  "labels/help.en.txt",
  "labels/help.el.txt",
  "habits/",
  "habits/index.html",
  "habits/search.js",
  "habits/habits.css",
  "habits/habits.js",
  "habits/import.js",
  "meals/",
  "meals/index.html",
  "meals/search.js",
  "meals/meals.css",
  "meals/core.js",
  "meals/meals.js",
  "zen/",
  "plants/",
  "plants/index.html",
  "plants/search.js",
  "plants/core.js",
  "plants/plants.css",
  "plants/plants.js",
  "zen/index.html",
  "zen/core.js",
  "zen/zen.css",
  "zen/zen.js",
  "zen/import.js",
  "health/",
  "health/index.html",
  "health/search.js",
  "health/core.js",
  "health/health.css",
  "health/health.js",
  "health/import.js",
  "health/help.en.txt",
  "health/help.el.txt",
  "files/",
  "files/index.html",
  "files/files.css",
  "files/files.js",
  "files/search.js",
  "files/dropbox-core.js",
  "files/dropbox.js",
  "files/drive.js",
  "files/computer-core.js",
  "files/computer.js",
  "files/gmedia.js",
  "files/docs-core.js",
  "files/docs.js",
  "files/docs.css",
  "files/docs-text.js",
  "files/docs-read.js",
  "files/clean-core.js",
  "files/docs-due.js",
  "files/today.js",
  "files/docs-links.js",
  "files/tags-core.js",
  "files/tags.js",
  "files/photos-core.js",
  "files/albums-core.js",
  "files/photos.js",
  "files/photos.css",
  "files/dupes-core.js",
  "files/dupes.js",
  "files/dupes.css",
  "files/dropbox-callback.html",
  "files/dropbox-callback.js",
  "writer/",
  "writer/index.html",
  "writer/writer.css",
  "writer/writer.js",
  "writer/io.js",
  "writer/pdfin.js",
  "writer/docxout.js",
  "writer/convert.js",
  "layout/",
  "layout/index.html",
  "layout/search.js",
  "layout/layout.css",
  "layout/layout.js",
  "layout/editor.js",
  "chores/",
  "chores/index.html",
  "chores/search.js",
  "chores/chores.css",
  "chores/chores.js",
  "chores/core.js",
  "layout/panels.js",
  "layout/fontpick.js",
  "layout/story.js",
  "layout/caret.js",
  "layout/inframe.js",
  "layout/sla.js",
  "layout/svgin.js",
  "layout/svgout.js",
  "layout/blend.js",
  "layout/vector.js",
  "layout/idml.js",
  "layout/pdfin.js",
  "layout/linefit.js",
  "layout/afread.js",
  "layout/rebuild.js",
  "layout/port.js",
  "layout/starters.js",
  "layout/startui.js", "layout/smart.js", "layout/comfort.js", "layout/findchange.js", "layout/findui.js", "layout/objstyles.js", "layout/swatchlib.js", "layout/library.js", "layout/notes.js", "layout/book.js", "layout/retrim.js", "layout/proof.js", "layout/impose.js", "layout/versions.js", "layout/tableui.js", "layout/track.js", "layout/comments.js", "layout/bookindex.js", "layout/symbols.js", "layout/xout.js", "layout/altlayout.js",
  "designkit/zipin.js",
  "layout/wordin.js",
  "layout/io.js",
  "layout/house.js",
  "layout/intake.js",
  "layout/autolay.js",
  "layout/outprof.js",
  "layout/epub.js",
  "layout/epubcheck.js",
  "layout/epubout.js",
  "layout/pdfout.js",
  "designkit/pdfx.js",
  "designkit/tagpdf.js",
  "vendor/icc/ISOcoated_v2_eci.icc",
  "vendor/icc/sRGB_IEC61966-2-1.icc",
  "vendor/icc/LICENSES.md",
  "layout/houseui.js",
  "designkit/assets.js",
  "designkit/fx.js",
  "designkit/blend.js",
  "designkit/vector.js",
  "designkit/pathedit.js",
  "designkit/boolean.js",
  "designkit/media.js",
  "designkit/model.js",
  "designkit/docstore.js",
  "designkit/pdf.js",
  "designkit/render.js",
  "designkit/show.js",
  "designkit/templates.js",
  "designkit/cover.js",
  "designkit/text.js",
  "designkit/table.js",
  "designkit/fonts.js",
  "help/",
  "help/index.html",
  "help/search.js",
  "help/help.css",
  "help/help.js",
  "help/asio-compatible.svg",
  "help/topics.json",
  "help/topics/appearance.el.txt",
  "help/topics/appearance.en.txt",
  "help/topics/backup.el.txt",
  "help/topics/backup.en.txt",
  "help/topics/data.el.txt",
  "help/topics/data.en.txt",
  "help/topics/faq.el.txt",
  "help/topics/faq.en.txt",
  "help/topics/install.el.txt",
  "help/topics/install.en.txt",
  "help/topics/menu.el.txt",
  "help/topics/menu.en.txt",
  "help/topics/notifications.el.txt",
  "help/topics/notifications.en.txt",
  "help/topics/privacy.el.txt",
  "help/topics/privacy.en.txt",
  "help/topics/reset.el.txt",
  "help/topics/reset.en.txt",
  "help/topics/sensitive.el.txt",
  "help/topics/sensitive.en.txt",
  "help/topics/share.el.txt",
  "help/topics/share.en.txt",
  "help/topics/shortcuts.el.txt",
  "help/topics/shortcuts.en.txt",
  "help/topics/start.el.txt",
  "help/topics/start.en.txt",
  "help/topics/sync.el.txt",
  "help/topics/sync.en.txt",
  "help/topics/troubleshooting.el.txt",
  "help/topics/troubleshooting.en.txt",
  "help/topics/whatsnew.el.txt",
  "help/topics/whatsnew.en.txt",
  "weather/help.en.txt",
  "weather/help.el.txt",
  "time/help.en.txt",
  "time/help.el.txt",
  "files/help.en.txt",
  "files/help.el.txt",
  "todo/help.en.txt",
  "todo/help.el.txt",
  "kanban/help.en.txt",
  "kanban/help.el.txt",
  "notes/help.en.txt",
  "notes/help.el.txt",
  "wiki/help.en.txt",
  "wiki/help.el.txt",
  "gamecenter/help.en.txt",
  "gamecenter/help.el.txt",
  "calendar/help.en.txt",
  "calendar/help.el.txt",
  "contacts/help.en.txt",
  "contacts/help.el.txt",
  "spreadsheet/help.en.txt",
  "spreadsheet/help.el.txt",
  "writer/help.en.txt",
  "writer/help.el.txt",
  "bookmarks/help.en.txt",
  "bookmarks/help.el.txt",
  "maps/help.en.txt",
  "maps/help.el.txt",
  "help/help.en.txt",
  "help/help.el.txt",
  "baby/help.en.txt",
  "baby/help.el.txt",
  "backgammon/help.en.txt",
  "backgammon/help.el.txt",
  "battleship/help.en.txt",
  "battleship/help.el.txt",
  "breakout/help.en.txt",
  "breakout/help.el.txt",
  "bubble/help.en.txt",
  "bubble/help.el.txt",
  "budget/help.en.txt",
  "budget/help.el.txt",
  "calculator/help.en.txt",
  "calculator/help.el.txt",
  "texttools/help.en.txt",
  "texttools/help.el.txt",
  "stickies/help.en.txt",
  "stickies/help.el.txt",
  "pad/help.en.txt",
  "pad/help.el.txt",
  "characters/help.en.txt",
  "characters/help.el.txt",
  "checkers/help.en.txt",
  "checkers/help.el.txt",
  "chess/help.en.txt",
  "chess/help.el.txt",
  "chores/help.en.txt",
  "chores/help.el.txt",
  "connect4/help.en.txt",
  "connect4/help.el.txt",
  "crossword/help.en.txt",
  "crossword/help.el.txt",
  "cycle/help.en.txt",
  "cycle/help.el.txt",
  "dice/help.en.txt",
  "dice/help.el.txt",
  "dots/help.en.txt",
  "dots/help.el.txt",
  "familytree/help.en.txt",
  "familytree/help.el.txt",
  "feeds/help.en.txt",
  "feeds/help.el.txt",
  "fitness/help.en.txt",
  "fitness/help.el.txt",
  "flow/help.en.txt",
  "flow/help.el.txt",
  "g2048/help.en.txt",
  "g2048/help.el.txt",
  "stock/help.en.txt",
  "stock/help.el.txt",
  "garage/help.en.txt",
  "garage/help.el.txt",
  "gomoku/help.en.txt",
  "gomoku/help.el.txt",
  "habits/help.en.txt",
  "habits/help.el.txt",
  "hangman/help.en.txt",
  "hangman/help.el.txt",
  "hexagon/help.en.txt",
  "hexagon/help.el.txt",
  "jigsaw/help.en.txt",
  "jigsaw/help.el.txt",
  "layout/help.en.txt",
  "layout/help.el.txt",
  "lightsout/help.en.txt",
  "lightsout/help.el.txt",
  "mahjong/help.en.txt",
  "mahjong/help.el.txt",
  "mail/help.en.txt",
  "mail/help.el.txt",
  "mancala/help.en.txt",
  "mancala/help.el.txt",
  "mastermind/help.en.txt",
  "mastermind/help.el.txt",
  "meals/help.en.txt",
  "meals/help.el.txt",
  "memory/help.en.txt",
  "memory/help.el.txt",
  "minesweeper/help.en.txt",
  "minesweeper/help.el.txt",
  "minimalism/help.en.txt",
  "minimalism/help.el.txt",
  "mixer/help.en.txt",
  "mixer/help.el.txt",
  "ringtones/help.en.txt",
  "ringtones/help.el.txt",
  "studio/help.en.txt",
  "studio/help.el.txt",
  "lyricsync/help.en.txt",
  "lyricsync/help.el.txt",
  "mood/help.en.txt",
  "mood/help.el.txt",
  "diary/help.en.txt",
  "diary/help.el.txt",
  "names/help.en.txt",
  "names/help.el.txt",
  "netizen/help.en.txt",
  "netizen/help.el.txt",
  "nonogram/help.en.txt",
  "nonogram/help.el.txt",
  "passwords/help.en.txt",
  "passwords/help.el.txt",
  "petcare/help.en.txt",
  "petcare/help.el.txt",
  "petworld/help.en.txt",
  "petworld/help.el.txt",
  "pixel/help.en.txt",
  "pixel/help.el.txt",
  "plants/help.en.txt",
  "plants/help.el.txt",
  "podcasts/help.en.txt",
  "podcasts/help.el.txt",
  "music/help.en.txt",
  "music/help.el.txt",
  "pong/help.en.txt",
  "pong/help.el.txt",
  "prompter/help.en.txt",
  "prompter/help.el.txt",
  "qr/help.en.txt",
  "qr/help.el.txt",
  "radio/help.en.txt",
  "radio/help.el.txt",
  "reversi/help.en.txt",
  "reversi/help.el.txt",
  "rps/help.en.txt",
  "rps/help.el.txt",
  "scores/help.en.txt",
  "scores/help.el.txt",
  "shelf/help.en.txt",
  "shelf/help.el.txt",
  "library/help.en.txt",
  "library/help.el.txt",
  "simon/help.en.txt",
  "simon/help.el.txt",
  "slider/help.en.txt",
  "slider/help.el.txt",
  "snake/help.en.txt",
  "snake/help.el.txt",
  "solitaire/help.en.txt",
  "solitaire/help.el.txt",
  "split/help.en.txt",
  "split/help.el.txt",
  "spot/help.en.txt",
  "spot/help.el.txt",
  "storage/help.en.txt",
  "storage/help.el.txt",
  "sudoku/help.en.txt",
  "sudoku/help.el.txt",
  "television/help.en.txt",
  "television/help.el.txt",
  "montage/help.en.txt",
  "montage/help.el.txt",
  "capture/help.en.txt",
  "capture/help.el.txt",
  "tetris/help.en.txt",
  "tetris/help.el.txt",
  "tictactoe/help.en.txt",
  "tictactoe/help.el.txt",
  "timesheet/help.en.txt",
  "timesheet/help.el.txt",
  "invoices/help.en.txt",
  "invoices/help.el.txt",
  "newsletter/help.en.txt",
  "newsletter/help.el.txt",
  "certificates/help.en.txt",
  "certificates/help.el.txt",
  "publish/help.en.txt",
  "publish/help.el.txt",
  "crm/help.en.txt",
  "crm/help.el.txt",
  "travel/help.en.txt",
  "travel/help.el.txt",
  "wallpaper/help.en.txt",
  "wallpaper/help.el.txt",
  "aura/help.en.txt",
  "aura/help.el.txt",
  "photolab/package.js",
  "photolab/help.en.txt",
  "photolab/help.el.txt",
  "whack/help.en.txt",
  "whack/help.el.txt",
  "wordle/help.en.txt",
  "wordle/help.el.txt",
  "wordsearch/help.en.txt",
  "wordsearch/help.el.txt",
  "xeri/help.en.txt",
  "xeri/help.el.txt",
  "realm/help.en.txt",
  "realm/help.el.txt",
  "banner/help.en.txt",
  "banner/help.el.txt",
  "fieldwarden/help.en.txt",
  "fieldwarden/help.el.txt",
  "roots/help.en.txt",
  "roots/help.el.txt",
  "hive/help.en.txt",
  "hive/help.el.txt",
  "lighthouse/help.en.txt",
  "lighthouse/help.el.txt",
  "ridge/help.en.txt",
  "ridge/help.el.txt",
  "maze/help.en.txt",
  "maze/help.el.txt",
  "caravan/help.en.txt",
  "caravan/help.el.txt",
  "orbit/help.en.txt",
  "orbit/help.el.txt",
  "starchart/help.en.txt",
  "starchart/help.el.txt",
  "clockwork/help.en.txt",
  "clockwork/help.el.txt",
  "wayfarers/help.en.txt",
  "wayfarers/help.el.txt",
  "crypt/help.en.txt",
  "crypt/help.el.txt",
  "zen/help.en.txt",
  "zen/help.el.txt",
  "vendor/codemirror/cm-core.min.js",
  "vendor/codemirror/cm-web.min.js",
  "vendor/codemirror/cm-python.min.js",
  "vendor/yaml/yaml.min.js",
  "vendor/codemirror/cm-go.min.js",
  "vendor/codemirror/cm-rust.min.js",
  "vendor/codemirror/cm-cpp.min.js",
  "vendor/codemirror/cm-java.min.js",
  "vendor/codemirror/cm-sql.min.js",
  "vendor/codemirror/cm-yaml.min.js",
  "vendor/codemirror/cm-legacy.min.js",
  "vendor/noto/NotoSans-Bold.ttf",
  "vendor/noto/NotoSans-BoldItalic.ttf",
  "vendor/noto/NotoSans-Italic.ttf",
  "vendor/noto/NotoSans-Regular.ttf",
  "vendor/noto/NotoSansMono-Bold.ttf",
  "vendor/noto/NotoSansMono-Regular.ttf",
  "vendor/noto/NotoSerif-Bold.ttf",
  "vendor/noto/NotoSerif-BoldItalic.ttf",
  "vendor/noto/NotoSerif-Italic.ttf",
  "vendor/noto/NotoSerif-Regular.ttf",
  "writer/search.js",
  "characters/",
  "characters/index.html",
  "characters/search.js",
  "characters/characters.css",
  "characters/characters.js",
  "names/",
  "names/index.html",
  "names/names.css",
  "names/words.js",
  "names/names.js",
  "pixel/",
  "pixel/index.html",
  "pixel/pixel.css",
  "pixel/pixel.js",
  "pixel/import.js",
  "cycle/",
  "cycle/index.html",
  "cycle/search.js",
  "cycle/cycle.css",
  "cycle/cycle.js",
  "cycle/import.js",
  "contacts/",
  "contacts/index.html",
  "contacts/contacts.css",
  "contacts/contacts.js",
  "contacts/search.js",
  "stock/",
  "stock/index.html",
  "stock/search.js",
  "stock/core.js",
  "stock/stock.css",
  "stock/stock.js",
  "stock/import.js",
  "stock/shop.js",
  "stock/consign.js",
  "stock/prices.js",
  "stock/pricelist.js",
  "stock/today.js",
  "garage/",
  "garage/index.html",
  "garage/search.js",
  "garage/core.js",
  "garage/house.js",
  "garage/garage.css",
  "garage/garage.js",
  "garage/import.js",
  "dice/",
  "dice/index.html",
  "dice/dice.css",
  "dice/dice.js",
  "petcare/",
  "petcare/index.html",
  "petcare/search.js",
  "petcare/core.js",
  "petcare/house.js",
  "petcare/petcare.css",
  "petcare/petcare.js",
  "wheel/",
  "wheel/index.html",
  "wheel/core.js",
  "wheel/view.js",
  "wheel/view.css",
  "oracle/",
  "oracle/index.html",
  "oracle/oracle.css",
  "oracle/prophecies.js",
  "oracle/oracle.js",
  "oracle/help.en.txt",
  "oracle/help.el.txt",
  "slides/",
  "slides/index.html",
  "slides/search.js",
  "slides/odp.js",
  "slides/mdimport.js",
  "slides/slides.css",
  "slides/core.js",
  "slides/dk.js",
  "slides/app.js",
  "slides/editor.js",
  "slides/text.js",
  "slides/panels.js",
  "slides/io.js",
  "slides/help.en.txt",
  "slides/help.el.txt",
  "baby/",
  "baby/index.html",
  "baby/search.js",
  "baby/baby.css",
  "baby/core.js",
  "baby/house.js",
  "baby/baby.js",
  "baby/import.js",
  "passwords/",
  "passwords/index.html",
  "passwords/passwords.css",
  "passwords/passwords.js",
  "passwords/pwcore.js",
  "passwords/words-eff.js",
  "passwords/common.js",
  "device/",
  "device/index.html",
  "device/core.js",
  "device/view.js",
  "device/view.css",
  "assistant/",
  "assistant/index.html",
  "assistant/assistant.css",
  "assistant/doctext.js",
  "assistant/core.js",
  "assistant/claudefiles.js",
  "gate/filecopy.js",
  "assistant/imgai.js",
  "assistant/summary.js",
  "assistant/assistant.js",
  "assistant/import.js",
  "assistant/webllm-worker.js",
  "assistant/help.en.txt",
  "assistant/help.el.txt",
  "share/",
  "share/index.html",
  "share/share.css",
  "share/kinds.js",
  "share/send.js",
  "share/view.js",
  "share/relay.js",
  "share/out.js",
  "share/album.js",
  "send/core.js",
  "send/detect.js",
  "send/sheet.js",
  "commands/core.js",
  "commands/bar.js",
  "settings/",
  "settings/index.html",
  "settings/settings.css",
  "settings/core.js",
  "settings/report.js",
  "settings/settings.js",
  "settings/translate.js",
  "settings/search.js",
  "settings/fonts.js",
  "settings/fonts.css",
  "settings/screentime.js",
  "settings/screentime.css",
  "settings/help.en.txt",
  "settings/help.el.txt",
  "startpage/",
  "startpage/index.html",
  "startpage/startpage.js",
  "startpage/startpage.css",
  "today/",
  "today/index.html",
  "today/today.css",
  "today/today.js",
  "today/agg.js",
  "today/host.js",
  "today/help.en.txt",
  "today/help.el.txt",
  "automations/",
  "automations/index.html",
  "automations/app.css",
  "automations/app.js",
  "automations/core.js",
  "automations/host.js",
  "automations/hookin.js",
  "automations/bridge.js",
  "automations/search.js",
  "automations/help.en.txt",
  "automations/help.el.txt",
  "calendar/occur.js",
  "todo/core.js",
  "quote/core.js",
  "kanban/core.js",
  "contacts/dates.js",
  "contacts/vcard.js",
  "contacts/dav.js",
  "todo/today.js",
  "kanban/today.js",
  "contacts/today.js",
  "contacts/importplan.js",
  "contacts/accounts.js",
  "contacts/oauth-callback.html",
  "contacts/oauth-callback.js",
  "habits/core.js",
  "mail/today.js",
  "meals/today.js",
  "budget/today.js",
  "health/today.js",
  "fitness/today.js",
  "habits/today.js",
  "cycle/core.js",
  "mood/core.js",
  "minimalism/core.js",
  "cycle/today.js",
  "mood/today.js",
  "minimalism/today.js",
  "familytree/today.js",
  "weather/today.js",
  "time/today.js",
  "calendar/today.js",
  "plants/today.js",
  "chores/today.js",
  "petcare/today.js",
  "garage/today.js",
  "travel/today.js",
  "timesheet/today.js",
  "shelf/today.js",
  "water/today.js",
  "baby/today.js",
  "netizen/",
  "netizen/index.html",
  "netizen/netizen.css",
  "netizen/netizen.js",
  "wallpaper/",
  "wallpaper/index.html",
  "wallpaper/art.js",
  "wallpaper/land.js",
  "wallpaper/wxdesk.js",
  "wallpaper/wallpaper.css",
  "wallpaper/wallpaper.js",
  "trees/",
  "trees/index.html",
  "trees/core.js",
  "aura/",
  "aura/index.html",
  "aura/aura.css",
  "aura/core.js",
  "aura/aura.js",
  "photolab/",
  "photolab/index.html",
  "photolab/photolab.css",
  "photolab/core.js",
  "photolab/blendx.js",
  "photolab/tiles.js",
  "photolab/history.js",
  "photolab/select.js",
  "photolab/guides.js",
  "photolab/paint.js",
  "photolab/resample.js",
  "photolab/warp.js",
  "photolab/adjust.js",
  "photolab/filters.js",
  "photolab/store.js",
  "photolab/psd.js",
  "photolab/psdinfo.js",
  "photolab/xcf.js",
  "photolab/ora.js",
  "photolab/xmp.js",
  "photolab/strings.js",
  "photolab/app.js",
  "photolab/view.js",
  "photolab/jobs.js",
  "photolab/worker.js",
  "photolab/tools.js",
  "photolab/ops.js",
  "photolab/io.js",
  "photolab/home.js",
  "photolab/panels.js",
  "atelier/",
  "atelier/index.html",
  "atelier/search.js",
  "atelier/atelier.css",
  "atelier/library/icons.js",
  "atelier/presets.js",
  "atelier/templates.js",
  "atelier/ax.js",
  "atelier/blend.js",
  "atelier/vector.js",
  "atelier/svgin.js",
  "atelier/pdfin.js",
  "atelier/canvafx.js",
  "atelier/anim.js",
  "atelier/morph.js",
  "atelier/core.js",
  "atelier/photofx.js",
  "atelier/draw.js",
  "atelier/editor.js",
  "atelier/panels.js",
  "atelier/sources.js",
  "atelier/fonts.js",
  "atelier/brandkit.js",
  "atelier/style.js",
  "atelier/swatches.js",
  "atelier/brand.js",
  "atelier/folders.js",
  "atelier/homefolders.js",
  "atelier/relayout.js",
  "atelier/aitext.js",
  "atelier/cutout.js",
  "atelier/inpaint.js",
  "atelier/ai.js",
  "atelier/editpic.js",
  "atelier/magic.js",
  "atelier/imagine.js",
  "atelier/magicai.js",
  "atelier/magicdesign.js",
  "atelier/collage.js",
  "atelier/bulk.js",
  "atelier/kit.js",
  "recipes/core.js",
  "recipes/ui.js",
  "recipes/share.js",
  "atelier/recipesteps.js",
  "atelier/recipes.js",
  "atelier/commands.js",
  "atelier/assist.js",
  "atelier/clips.js",
  "atelier/video.js",
  "atelier/gif.js",
  "atelier/gifdec.js",
  "atelier/motion.js",
  "atelier/zip.js",
  "mockups/",
  "mockups/index.html",
  "mockups/mockups.css",
  "mockups/core.js",
  "mockups/print.js",
  "mockups/scene.js",
  "mockups/surface3d.js",
  "mockups/goods/media.js",
  "mockups/goods/media3d.js",
  "mockups/goods/analog.js",
  "mockups/goods/analog3d.js",
  "mockups/goods/small.js",
  "mockups/goods/small3d.js",
  "mockups/goods/home.js",
  "mockups/goods/home3d.js",
  "mockups/goods/cloth.js",
  "mockups/goods/cloth3d.js",
  "mockups/goods/combo.js",
  "mockups/mockups.js",
  "mockups/commands.js",
  "mockups/assist.js",
  "mockups/search.js",
  "mockups/help.en.txt",
  "mockups/help.el.txt",
  "vendor/three/three.module.min.js",
  "vendor/three/three.core.min.js",
  "importkit.js",
  "emptykit.js",
  "emptykit.css",
  "emptykit-ex.js",
  "vizkit.js",
  "bundle.js",
  "recordpkg.js",
  "habits/package.js",
  "water/package.js",
  "chores/package.js",
  "scores/package.js",
  "cycle/package.js",
  "mood/package.js",
  "calendar/package.js",
  "contacts/package.js",
  "bookmarks/package.js",
  "feeds/package.js",
  "podcasts/package.js",
  "meals/package.js",
  "stickies/package.js",
  "crm/package.js",
  "quote/package.js",
  "timesheet/package.js",
  "stock/package.js",
  "budget/package.js",
  "invoices/package.js",
  "invoices/acctpack.js",
  "invoices/pdfin.js",
  "budget/links.js",
  "budget/shop.js",
  "split/package.js",
  "diary/package.js",
  "health/package.js",
  "fitness/package.js",
  "baby/package.js",
  "petcare/package.js",
  "plants/package.js",
  "garage/package.js",
  "library/package.js",
  "shelf/package.js",
  "signature/package.js",
  "newsletter/package.js",
  "storage/package.js",
  "converter/",
  "converter/index.html",
  "converter/converter.css",
  "converter/registry.js",
  "converter/core.js",
  "converter/converter.js",
  "converter/help.en.txt",
  "converter/help.el.txt",
  "flashcards/",
  "flashcards/index.html",
  "flashcards/app.css",
  "flashcards/app.js",
  "flashcards/core.js",
  "flashcards/fsrs.js",
  "flashcards/media.js",
  "flashcards/sqlite.js",
  "flashcards/anki.js",
  "flashcards/make.js",
  "flashcards/due.js",
  "flashcards/today.js",
  "flashcards/stats.js",
  "flashcards/package.js",
  "flashcards/convert.js",
  "flashcards/search.js",
  "flashcards/help.en.txt",
  "flashcards/help.el.txt",
  "typing/",
  "typing/index.html",
  "typing/app.css",
  "typing/layouts.js",
  "typing/words.js",
  "typing/course.js",
  "typing/texts.js",
  "typing/core.js",
  "typing/due.js",
  "typing/today.js",
  "typing/search.js",
  "typing/rain.js",
  "typing/app.js",
  "typing/help.en.txt",
  "typing/help.el.txt",
  "scanpdf/",
  "scanpdf/index.html",
  "scanpdf/scanpdf.css",
  "scanpdf/core.js",
  "scanpdf/scan.js",
  "scanpdf/device.js",
  "scanpdf/ocr.js",
  "scanpdf/pdfops.js",
  "scanpdf/sign-core.js",
  "scanpdf/today.js",
  "scanpdf/sign.html",
  "scanpdf/sign.js",
  "scanpdf/sign.css",
  "scanpdf/scanpdf.js",
  "scanpdf/search.js",
  "scanpdf/help.en.txt",
  "scanpdf/help.el.txt",
  "vendor/pdf-lib/pdf-lib.min.js",
  "vendor/pdf-lib/fontkit.umd.min.js",
  "google-import.js",
  "davkit.js",
  "davsync.js",
  "enrich.js",
  "enrichui.js",
  "atelier/pptx.js",
  "atelier/pptxout.js",
  "atelier/canva.js",
  "atelier/canva-callback.html",
  "atelier/canva-callback.js",
  "atelier/io.js",
  "atelier/help.el.txt",
  "atelier/help.en.txt",
  "minimalism/",
  "minimalism/index.html",
  "minimalism/search.js",
  "minimalism/minimalism.css",
  "minimalism/minimalism.js",
  "minimalism/content.js",
  "split/",
  "split/index.html",
  "split/search.js",
  "split/split.css",
  "split/split.js",
  "split/import.js",
  "split/house.js",
  "base/",
  "base/index.html",
  "base/app.css",
  "base/core.js",
  "base/app.js",
  "base/search.js",
  "base/package.js",
  "base/feed.js",
  "base/today.js",
  "base/help.en.txt",
  "base/help.el.txt",
  "spreadsheet/",
  "spreadsheet/index.html",
  "spreadsheet/search.js",
  "spreadsheet/spreadsheet.css",
  "spreadsheet/spreadsheet.js",
  "spreadsheet/sheetimport.js",
  "spreadsheet/convert.js",
  "spreadsheet/platforms.js",
  "podcasts/",
  "podcasts/index.html",
  "podcasts/search.js",
  "podcasts/podcasts.css",
  "podcasts/core.js",
  "podcasts/store.js",
  "podcasts/host.js",
  "podcasts/podcasts.js",
  "music/",
  "music/index.html",
  "music/search.js",
  "music/music.css",
  "music/core.js",
  "music/store.js",
  "music/host.js",
  "music/library.js",
  "music/open.js",
  "music/artists.js",
  "music/lb.js",
  "music/servers.js",
  "music/mixes.js",
  "music/music.js",
  "music/today.js",
  "radio/",
  "radio/index.html",
  "radio/search.js",
  "radio/radio.css",
  "radio/radio.js",
  "radio/import.js",
  "mixer/",
  "mixer/index.html",
  "mixer/mixer.css",
  "mixer/mixer.js",
  "mixer/engine.js",
  "ringtones/",
  "ringtones/index.html",
  "ringtones/ringtones.css",
  "ringtones/core.js",
  "ringtones/ringtones.js",
  "ringtones/search.js",
  "studio/",
  "studio/index.html",
  "studio/studio.css",
  "studio/core.js",
  "studio/studio.js",
  "studio/package.js",
  "studio/commands.js",
  "studio/assist.js",
  "studio/rec.worklet.js",
  "studio/fx.js",
  "studio/remote.js",
  "studio/nullfx/runtime/eel-rt.js",
  "studio/nullfx/runtime/null-fx.js",
  "studio/nullfx/runtime/null-gfx.js",
  "studio/nullfx/runtime/null-node.js",
  "studio/nullfx/runtime/null-worklet.js",
  "studio/nullfx/fx/index.json",
  "lyricsync/",
  "lyricsync/index.html",
  "lyricsync/app.css",
  "lyricsync/core.js",
  "lyricsync/formats.js",
  "lyricsync/wave.js",
  "lyricsync/id3.js",
  "lyricsync/align.js",
  "lyricsync/chords.js",
  "lyricsync/sets.js",
  "lyricsync/diagrams.js",
  "lyricsync/sheetpdf.js",
  "lyricsync/app.js",
  "lyricsync/search.js",
  "maps/",
  "maps/index.html",
  "maps/search.js",
  "maps/maps.css",
  "maps/route-core.js",
  "maps/tools-core.js",
  "maps/transit-core.js",
  "maps/transit.js",
  "maps/tools.js",
  "maps/where.js",
  "maps/planner-core.js",
  "maps/planner.js",
  "maps/fav-core.js",
  "maps/fav.js",
  "maps/hh-core.js",
  "maps/hh.js",
  "maps/discover-core.js",
  "maps/discover.js",
  "maps/maps.js",
  "maps/import.js",
  "maps/import-ui.js",
  "maps/package.js",
  "maps/package-ui.js",
  "maps/osm.js",
  "maps/osm-api.js",
  "maps/notes.js",
  "maps/osm-callback.html",
  "maps/osm-callback.js",
  "maps/poi-core.js",
  "maps/everydoor-core.js",
  "maps/poi.js",
  "maps/entrances.js",
  "maps/presets-data.js",
  "maps/tracks-core.js",
  "maps/follow-core.js",
  "maps/where-core.js",
  "maps/tracks.js",
  "maps/heat-core.js",
  "maps/heat.js",
  "maps/heat-worker.js",
  "maps/quests-core.js",
  "maps/overlays-core.js",
  "maps/quests.js",
  "feeds/",
  "feeds/index.html",
  "feeds/search.js",
  "feeds/feeds.css",
  "feeds/core.js",
  "feeds/sanitize.js",
  "feeds/fetch.js",
  "feeds/extract.js",
  "feeds/feeds.js",
  "feeds/youtube.js",
  "museum/",
  "museum/index.html",
  "museum/museum.css",
  "museum/core.js",
  "museum/museum.js",
  "museum/help.en.txt",
  "museum/help.el.txt",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
  "vendor/mediabunny.min.js",
  "calculator/",
  "calculator/index.html",
  "calculator/calculator.css",
  "calculator/calculator.js",
  "texttools/",
  "texttools/index.html",
  "texttools/texttools.css",
  "texttools/core.js",
  "texttools/texttools.js",
  "texttools/worker.js",
  "translate/engine.js",
  "translate/worker.js",
  "translate/panel.js",
  "units/",
  "units/index.html",
  "units/core.js",
  "units/view.js",
  "units/view.css",
  "units/search.js",
  "stickies/",
  "stickies/index.html",
  "stickies/stickies.css",
  "stickies/core.js",
  "stickies/host.js",
  "links/core.js",
  "links/host.js",
  "gate/gate.js",
  "links/woo.js",
  "links/mydata.js",
  "links/mail.js",
  "links/crm.js",
  "links/todo.js",
  "links/timesheet.js",
  "links/kanban.js",
  "links/bookmarks.js",
  "links/notes.js",
  "links/sheets.js",
  "links/pay.js",
  "stickies/stickies.js",
  "stickies/search.js",
  "stickies/today.js",
  "pad/",
  "pad/index.html",
  "pad/app.css",
  "pad/core.js",
  "pad/search.js",
  "pad/eel2.js",
  "pad/app.js",
  "pad/devui.js",
  "pad/devtools.js",
  "pad/regex-worker.js",
  "textcase/",
  "textcase/index.html",
  "textcase/core.js",
  "television/",
  "television/index.html",
  "television/search.js",
  "television/television.css",
  "television/television.js",
  "montage/",
  "montage/index.html",
  "montage/montage.css",
  "montage/core.js",
  "montage/hash.js",
  "montage/gl.js",
  "montage/media.js",
  "montage/player.js",
  "montage/export.js",
  "montage/montage.js",
  "montage/package.js",
  "montage/search.js",
  "montage/commands.js",
  "montage/assist.js",
  "capture/",
  "capture/index.html",
  "capture/app.css",
  "capture/core.js",
  "capture/app.js",
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
  "simon/",
  "simon/index.html",
  "simon/simon.css",
  "simon/simon.js",
  "slider/",
  "slider/index.html",
  "slider/slider.css",
  "slider/slider.js",
  "lightsout/",
  "lightsout/index.html",
  "lightsout/lightsout.css",
  "lightsout/lightsout.js",
  "petworld/",
  "petworld/index.html",
  "petworld/petworld.css",
  "petworld/petworld.js",
  "whack/",
  "whack/index.html",
  "whack/whack.css",
  "whack/whack.js",
  "snake/",
  "snake/index.html",
  "snake/snake.css",
  "snake/snake.js",
  "g2048/",
  "g2048/index.html",
  "g2048/g2048.css",
  "g2048/g2048.js",
  "scores/",
  "scores/index.html",
  "scores/search.js",
  "scores/scores.css",
  "scores/scores.js",
  "scores/import.js",
  "wordsearch/",
  "wordsearch/index.html",
  "wordsearch/wordsearch.css",
  "wordsearch/wordsearch.js",
  "wordsearch/words-en.js",
  "wordsearch/words-el.js",
  "solitaire/",
  "solitaire/index.html",
  "solitaire/solitaire.css",
  "solitaire/solitaire.js",
  "cardkit/cardkit.js",
  "cardkit/cardkit.css",
  "jigsaw/",
  "jigsaw/index.html",
  "jigsaw/jigsaw.css",
  "jigsaw/jigsaw.js",
  "crossword/",
  "crossword/index.html",
  "crossword/crossword.css",
  "crossword/crossword.js",
  "crossword/import.js",
  "xeri/",
  "xeri/index.html",
  "xeri/xeri.css",
  "xeri/xeri.js",
  "realm/",
  "realm/index.html",
  "realm/realm.css",
  "realm/engine.js",
  "realm/campaign.js",
  "realm/realm.js",
  "banner/",
  "banner/index.html",
  "banner/banner.css",
  "banner/cards.js",
  "banner/engine.js",
  "banner/puzzles.js",
  "banner/banner.js",
  "crypt/",
  "crypt/index.html",
  "crypt/crypt.css",
  "crypt/items.js",
  "crypt/engine.js",
  "crypt/crypt.js",
  "fieldwarden/",
  "fieldwarden/index.html",
  "fieldwarden/fieldwarden.css",
  "fieldwarden/data.js",
  "fieldwarden/engine.js",
  "fieldwarden/fieldwarden.js",
  "roots/",
  "roots/index.html",
  "roots/roots.css",
  "roots/engine.js",
  "roots/roots.js",
  "hive/",
  "hive/index.html",
  "hive/hive.css",
  "hive/engine.js",
  "hive/hive.js",
  "lighthouse/",
  "lighthouse/index.html",
  "lighthouse/lighthouse.css",
  "lighthouse/engine.js",
  "lighthouse/lighthouse.js",
  "ridge/",
  "ridge/index.html",
  "ridge/ridge.css",
  "ridge/engine.js",
  "ridge/ridge.js",
  "maze/",
  "maze/index.html",
  "maze/maze.css",
  "maze/engine.js",
  "maze/maze.js",
  "caravan/",
  "caravan/index.html",
  "caravan/caravan.css",
  "caravan/engine.js",
  "caravan/caravan.js",
  "orbit/",
  "orbit/index.html",
  "orbit/orbit.css",
  "orbit/engine.js",
  "orbit/orbit.js",
  "starchart/",
  "starchart/index.html",
  "starchart/starchart.css",
  "starchart/engine.js",
  "starchart/starchart.js",
  "clockwork/",
  "clockwork/index.html",
  "clockwork/clockwork.css",
  "clockwork/engine.js",
  "clockwork/clockwork.js",
  "wayfarers/",
  "wayfarers/index.html",
  "wayfarers/wayfarers.css",
  "wayfarers/data.js",
  "wayfarers/engine.js",
  "wayfarers/wayfarers.js",
  "wordle/",
  "wordle/index.html",
  "wordle/wordle.css",
  "wordle/wordle.js",
  "wordle/words-en.js",
  "wordle/words-el.js",
  "backgammon/",
  "backgammon/index.html",
  "backgammon/backgammon.css",
  "backgammon/backgammon.js",
  "battleship/",
  "battleship/index.html",
  "battleship/battleship.css",
  "battleship/battleship.js",
  "breakout/",
  "breakout/index.html",
  "breakout/breakout.css",
  "breakout/breakout.js",
  "bubble/",
  "bubble/index.html",
  "bubble/bubble.css",
  "bubble/bubble.js",
  "budget/",
  "budget/index.html",
  "budget/search.js",
  "budget/budget.css",
  "budget/payments.js",
  "budget/budget.js",
  "budget/import.js",
  "budget/feed.js",
  "checkers/",
  "checkers/index.html",
  "checkers/checkers.css",
  "checkers/checkers.js",
  "chess/",
  "chess/index.html",
  "chess/chess.css",
  "chess/chess.js",
  "chess/lichess-callback.html",
  "chess/lichess-callback.js",
  "familytree/",
  "familytree/index.html",
  "familytree/search.js",
  "familytree/familytree.css",
  "familytree/familytree.js",
  "familytree/ft-core.js",
  "familytree/gramps.js",
  "together/",
  "together/index.html",
  "together/app.css",
  "together/core.js",
  "together/house.js",
  "together/app.js",
  "together/search.js",
  "together/today.js",
  "together/help.en.txt",
  "together/help.el.txt",
  "household/",
  "household/index.html",
  "household/app.css",
  "device/screens.js",
  "device/screentime.js",
  "household/core.js",
  "household/crypto.js",
  "household/folder.js",
  "household/backup.js",
  "household/recent.js",
  "household/engine.js",
  "household/whole.js",
  "household/share.js",
  "household/group.js",
  "household/today.js",
  "household/app.js",
  "household/search.js",
  "household/help.en.txt",
  "household/help.el.txt",
  "fitness/",
  "fitness/index.html",
  "fitness/search.js",
  "fitness/fitness.css",
  "fitness/core.js",
  "fitness/fitness.js",
  "fitness/import.js",
  "flow/",
  "flow/index.html",
  "flow/flow.css",
  "flow/flow.js",
  "gomoku/",
  "gomoku/index.html",
  "gomoku/gomoku.css",
  "gomoku/gomoku.js",
  "hangman/",
  "hangman/index.html",
  "hangman/hangman.css",
  "hangman/hangman.js",
  "hangman/words-el.js",
  "hangman/words-en.js",
  "hexagon/",
  "hexagon/index.html",
  "hexagon/hexagon.css",
  "hexagon/hexagon.js",
  "mahjong/",
  "mahjong/index.html",
  "mahjong/mahjong.css",
  "mahjong/mahjong.js",
  "mancala/",
  "mancala/index.html",
  "mancala/mancala.css",
  "mancala/mancala.js",
  "mastermind/",
  "mastermind/index.html",
  "mastermind/mastermind.css",
  "mastermind/mastermind.js",
  "minesweeper/",
  "minesweeper/index.html",
  "minesweeper/minesweeper.css",
  "minesweeper/minesweeper.js",
  "nonogram/",
  "nonogram/index.html",
  "nonogram/nonogram.css",
  "nonogram/nonogram.js",
  "pong/",
  "pong/index.html",
  "pong/pong.css",
  "pong/pong.js",
  "reversi/",
  "reversi/index.html",
  "reversi/reversi.css",
  "reversi/reversi.js",
  "rps/",
  "rps/index.html",
  "rps/rps.css",
  "rps/rps.js",
  "spot/",
  "spot/index.html",
  "spot/spot.css",
  "spot/spot.js",
  "sudoku/",
  "sudoku/index.html",
  "sudoku/sudoku.css",
  "sudoku/sudoku.js",
  "sudoku/import.js",
  "tetris/",
  "tetris/index.html",
  "tetris/tetris.css",
  "tetris/tetris.js",
  "travel/",
  "travel/index.html",
  "travel/search.js",
  "travel/travel.css",
  "travel/travel.js",
  "travel/package.js",
  "travel/import.js",
  "travel/core.js",
  "assistant/edits.js",
  "assistant/create.js",
  "assistant/additems.js",
  "assistant/edits2.js",
  "assistant/edits3.js",
  "assistant/edits4.js",
  "assistant/fileops.js",
  "assistant/additems2.js",
  "assistant/additems3.js",
  "assistant/links.js",
  "atelier/objects.js",
  "atelier/objui.js",
  "atelier/pdfout.js",
  "atelier/webout.js",
  "atelier/templates-more.js",
  "bookmarks/core.js",
  "budget/bank.js",
  "budget/bankui.js",
  "budget/bankapi.js",
  "budget/banklive.js",
  "budget/bankback.html",
  "budget/bankback.js",
  "budget/plan.js",
  "budget/planui.js",
  "budget/overview.js",
  "budget/overviewui.js",
  "budget/insights.js",
  "budget/insightsui.js",
  "budget/budgets.js",
  "budget/budgetsui.js",
  "budget/caticons.js",
  "budget/loans.js",
  "budget/invest.js",
  "budget/loansui.js",
  "budget/keypad.js",
  "calculator/core.js",
  "calculator/search.js",
  "calendar/free.js",
  "calendar/guests.js",
  "calendar/guestsui.js",
  "calendar/rsvp.html",
  "calendar/rsvp.js",
  "calendar/rsvp.css",
  "calendar/quickadd.js",
  "calendar/subs.js",
  "calendar/house.js",
  "calendar/dav.js",
  "chores/house.js",
  "plants/house.js",
  "certificates/sign.js",
  "certificates/verify.css",
  "certificates/verify.html",
  "certificates/verify.js",
  "chess/openings-data.js",
  "chess/puzzles-pack.js",
  "chess/puzzles-lichess.js",
  "chess/train.js",
  "contacts/cardtext.js",
  "contacts/csvmap.js",
  "contacts/keep.js",
  "contacts/merge.js",
  "diary/journal.js",
  "feeds/ai.js",
  "feeds/sources.js",
  "files/files-core.js",
  "fitness/gps-core.js",
  "fitness/plan-core.js",
  "fitness/wger.js",
  "gamecenter/",
  "gamecenter/challenge.js",
  "gamecenter/core.js",
  "gamecenter/gamecenter.css",
  "gamecenter/gamecenter.js",
  "gamecenter/host.js",
  "gamecenter/index.html",
  "gamecenter/today.js",
  "discover/core.js",
  "discover/host.js",
  "gamekit/daily.js",
  "gamekit/resume.js",
  "gamekit/layout.css",
  "gamekit/haptics.js",
  "garage/logbook.js",
  "garage/receipt.js",
  "habits/model.js",
  "habits/steps.js",
  "kanban/model.js",
  "kanban/tools.js",
  "layout/merge.js",
  "layout/mergeui.js",
  "layout/cover.js",
  "layout/recipesteps.js",
  "layout/recipes.js",
  "layout/commands.js",
  "layout/pro.js",
  "layout/proassist.js",
  "layout/bleedfill.js",
  "layout/assist.js",
  "library/catalog.js",
  "library/opds.js",
  "mail/feed.js",
  "mail/pgp.js",
  "mail/pgpmime.js",
  "mail/snooze.js",
  "mail/unsub.js",
  "maps/offline-core.js",
  "maps/offline.js",
  "maps/trails-core.js",
  "maps/trails.js",
  "maps/trails-tab.js",
  "maps/outdoor-core.js",
  "maps/outdoor.js",
  "maps/offroute-core.js",
  "maps/offroute.js",
  "meals/import.js",
  "meals/nutrition.js",
  "meals/pantry.js",
  "meals/house.js",
  "montage/asr.js",
  "montage/denoise.js",
  "montage/reframe.js",
  "mood/vocab.js",
  "notes/md.js",
  "notes/voice-core.js",
  "notes/voice.js",
  "notes/import.js",
  "passwords/kdbx.js",
  "passwords/pmapp.js",
  "passwords/pmcore.js",
  "passwords/pmkinds.js",
  "passwords/pmcrypto.js",
  "passwords/import.js",
  "passwords/otpexport.js",
  "passwords/afindex.js",
  "photolab/batch.js",
  "photolab/batchcore.js",
  "photolab/recipesteps.js",
  "photolab/recipes.js",
  "photolab/search.js",
  "studio/search.js",
  "photolab/commands.js",
  "photolab/assist.js",
  "photolab/aiedit.js",
  "slides/commands.js",
  "slides/assist.js",
  "photolab/raw.js",
  "photolab/subject.js",
  "plants/identify.js",
  "podcasts/gpodder.js",
  "qr/qr-bulk.js",
  "qr/qr-scan.js",
  "quote/accept-core.js",
  "quote/accept.css",
  "quote/accept.html",
  "quote/accept.js",
  "radio/tools.js",
  "remote-play.js",
  "cast.js",
  "slides/anim.js",
  "slides/objects.js",
  "slides/pptx.js",
  "slides/remote.js",
  "spreadsheet/functions.js",
  "spreadsheet/sheetkit.js",
  "spreadsheet/commands.js",
  "spreadsheet/assist.js",
  "stock/pos-core.js",
  "stock/pos.js",
  "storage/core.js",
  "studio/encode.js",
  "studio/meter.js",
  "studio/meter.worklet.js",
  "studio/flac.js",
  "studio/aac.js",
  "studio/mp4.js",
  "studio/podcast.js",
  "studio/ghpages.js",
  "studio/davpub.js",
  "studio/podcastui.js",
  "studio/fxchain.worklet.js",
  "studio/loops.js",
  "studio/midi.js",
  "studio/bridge.js",
  "studio/sfz.js",
  "studio/sounds.js",
  "studio/notes.js",
  "studio/roll.js",
  "television/core.js",
  "television/vod.js",
  "television/films.js",
  "time/cities.js",
  "time/clock-core.js",
  "today/layout.js",
  "today/tips.js",
  "today/dayline.js",
  "todo/model.js",
  "todo/vtodo.js",
  "todo/dav.js",
  "todo/house.js",
  "travel/booking.js",
  "vendor/hash-wasm/argon2.umd.min.js",
  "vendor/jsqr/jsQR.js",
  "vendor/fzstd/fzstd.umd.js",
  "vendor/brotli/brotli.min.js",
  "vendor/polygon-clipping/polygon-clipping.umd.min.js",
  "vendor/openpgp/openpgp.min.js",
  "weather/core.js",
  "weather/days.js",
  "weather/rainmap-core.js",
  "weather/rainmap.js",
  "writer/core.js",
  "writer/merge.js",
  "writer/spell-worker.js",
  "writer/spell.js",
  "writer/track.js",
  "writer/commands.js",
  "writer/assist.js",
  "writer/catcore.js",
  "writer/catstore.js",
  "writer/cattm.js",
  "writer/catqa.js",
  "writer/catdocx.js",
  "writer/catxlf.js",
  "writer/catmt.js",
  "writer/cat.js",
  "writer/fonts.js",
  "vendor/jspdf.umd.min.js",
  "vendor/xlsx.full.min.js",
  "vendor/hls.light.min.js",
  "vendor/pdfjs/pdf.min.js",
  "vendor/pdfjs/pdf.worker.min.js",
  "vendor/NotoSans-Regular.ttf",
  "fonts/nunito-regular.woff2",
  "fonts/nunito-medium.woff2",
  "fonts/nunito-semibold.woff2",
  "fonts/nunito-bold.woff2",
  "fonts/nunito-extrabold.woff2",
  "fonts/mplusrounded-greek-regular.woff2",
  "fonts/mplusrounded-greek-medium.woff2",
  "fonts/mplusrounded-greek-bold.woff2",
  "fonts/mplusrounded-greek-extrabold.woff2"
];

// SW-U1: every release used to download the WHOLE precache again
// (1,658 files, 46 MB in 3.19.00), all at once, even though a release
// changes a handful of them. On a phone that meant a 46 MB download per
// release, and it competed with the page for the network: after a
// release orOS took many seconds to show its desktop. Now a file whose
// content did not change is copied from the previous release's cache.
// PRECACHE_HASH is written by the release stamp (stamp-assets.js) on main
// (same pass as CACHE_VERSION): the first 16 hex digits of the SHA-256
// of each file, keyed by its PRECACHE_URLS entry. The old copy is
// hashed here before it is reused, so a stale or wrong copy (or a stale
// table) only costs a download, never serves old code. No table, no
// entry, no previous cache or no crypto: the file is downloaded as
// before.
var PRECACHE_HASH = {"./":"ef6d739c98b0551e","./index.html":"ef6d739c98b0551e","./style.css":"cbd18a7164448495","./fonts.css":"a65304850f8cc654","./search.js":"afa5e3cf44a475b4","./shell.js":"dea685a69ce12360","./sync.js":"60ed984f1c1c92c5","./fs.js":"887d97f0e01a1869","./dialogs.js":"f8f35595ec2e5ec0","./pcdialog.js":"a377e0b6493e2b9e","./notifications.js":"1963657e025d607a","./pet.css":"393a4afc8465b086","./iconpacks.css":"9a9a41800b488071","./pet.js":"42e58fde90fca810","./launcher.js":"fed6373db6618391","./quickmenu.js":"c1478006ce97dc02","./profiles.js":"6e6446bdea1d49fc","./seasonal.js":"6a7b286a53c1b120","./osk.js":"c8e4259facb43198","./qsettings.js":"19f3ddcb6d8f70ef","./widgets.js":"740821c6d27b6747","./nightlight.js":"f098aaaeb08d3a72","./a11yfx.js":"500d55e06aa9a7e4","./smartbar.js":"5c040e630e53bfec","./smartbar-apps.js":"d1a1cb85d4769655","./smartbar-live.js":"0169644b282f7bd0","./cliphist.js":"b3b2e9ef5f8d5cc3","./pocket.js":"b1297045fd52fe47","./focus/core.js":"344edc0137cd74c4","./readaloud.js":"ce5cd7ea57ffac0f","./continue.js":"79117050273fde0c","./textrepl.js":"9b1a30d72c05ec95","./localroots.js":"587f09ef07f59ad8","./emoji.js":"015f10d42557bca7","emoji/data.js":"c7436630912e6f44","./fileopen.js":"b304d679ad33cf30","./phone.js":"27fc698a85de79ff","./webpush.js":"c0b196718810115a","./vault.js":"1bea0ae56dea9ab4","./remote-link.js":"ae908e04404965aa","./pair.js":"0358ca0c48c520c8","./i18n.js":"ee1c67a3d724bbdf","./pickers.js":"52f0ae973252ceb0","./pickers.css":"707a0e33faf1d27c","./pickers-ui.js":"1c57692b9be7ca57","./pickers-ui.css":"9b2e58c874917af3","./ocrkit.js":"c3173ef72415bcdf","./ocrkit-ui.js":"dc61dc99d61ad9e9","./ocrkit-ui.css":"5a7b4034efc0248a","./diag.js":"7a85648fb98b9fb0","./i18n-tables.js":"16644344210bd976","./translations.js":"373493693dfa25c4","./lock.js":"f8ff78039bf11254","./apps.json":"d91c3a883c451d2f","./manifest.webmanifest":"3db047d9d3b9a236","./icon.svg":"4825463eacb6f0eb","./icons/icon-192.png":"4630cba28e0c8737","./icons/icon-512.png":"f0f49665b9bbe0af","./icons/icon-maskable-192.png":"de56ba1e9fe1431e","./icons/icon-maskable-512.png":"34c2daf2f56189de","./solo.js":"c535f24666a7d115","./uifont.js":"5bf3c1326a918574","notes/solo.html":"bb72d085c5fbd236","notes/manifest.webmanifest":"350b22032589d79a","calendar/solo.html":"475c926138e88d64","calendar/manifest.webmanifest":"71290151dc81e76b","bookmarks/solo.html":"2c4d20c82535490d","bookmarks/manifest.webmanifest":"7f2835755cbea0a3","todo/solo.html":"19a8bec5794878d2","todo/manifest.webmanifest":"6f744e2238417763","contacts/solo.html":"8ed86b4cb1f1a075","contacts/manifest.webmanifest":"eb68b9f0953fe6af","writer/solo.html":"10a8da7e410a4394","writer/manifest.webmanifest":"af0485647923ff45","spreadsheet/solo.html":"6725690cd5e76eb9","spreadsheet/manifest.webmanifest":"4947525a6ea8e45a","kanban/solo.html":"a9933eeb47453ee6","kanban/manifest.webmanifest":"898ef646f4488bb7","mindmap/solo.html":"6cff6e0945eefb82","mindmap/manifest.webmanifest":"c13f7c0be944a835","wiki/solo.html":"fca02c3f6ce58df6","wiki/manifest.webmanifest":"904aa13d4b15c524","slides/solo.html":"9045a50862cdd8f8","slides/manifest.webmanifest":"76ddca68ab6dcdb5","passwords/solo.html":"32b6ebbca125b134","passwords/manifest.webmanifest":"04fbb54f14a60159","budget/solo.html":"fcdfd70d99f8d78a","budget/manifest.webmanifest":"f98c8024e129129f","habits/solo.html":"2a4bcdeabd8733ce","habits/manifest.webmanifest":"6f75031b5daca947","water/solo.html":"5f496bb37a41534c","water/manifest.webmanifest":"6d75c2dfcbcb3c56","diary/solo.html":"105be6440eeb8283","diary/manifest.webmanifest":"791fba93d7e30a65","mood/solo.html":"76d539127f857a40","mood/manifest.webmanifest":"0358c0b55b5ff84c","fitness/solo.html":"73357ba473018c65","fitness/manifest.webmanifest":"316ef568ae171982","health/solo.html":"d00f96037af624ce","health/manifest.webmanifest":"a9ec5adf12840509","cycle/solo.html":"282fce0c40a67015","cycle/manifest.webmanifest":"f79a574b6c058bc4","calculator/solo.html":"3cc99f7d7d850b5d","calculator/manifest.webmanifest":"c8de03dbd54331c4","time/solo.html":"7c3af51b183be2b8","time/manifest.webmanifest":"13408b4f11469a2e","weather/solo.html":"8e2242857a533f9a","weather/manifest.webmanifest":"a376a1adaae97b1d","maps/solo.html":"9b93e62f0253d1c2","maps/manifest.webmanifest":"15f2d8e3306f385a","feeds/solo.html":"2ae026cea1bb2d44","feeds/manifest.webmanifest":"f30abef123d4f35c","mail/solo.html":"ad05926d6bd77fc3","mail/manifest.webmanifest":"379b197c779a7082","files/solo.html":"c3ad7569aea49c7e","files/manifest.webmanifest":"eae7ec2fb808816d","podcasts/solo.html":"a3ab4ffa4f021198","podcasts/manifest.webmanifest":"7b2984ee788f6f01","radio/solo.html":"d54fa85c7964126a","radio/manifest.webmanifest":"44913b2b3649745e","music/solo.html":"4e3b4e13ba645943","music/manifest.webmanifest":"66c9afbb4fcf87a9","photolab/solo.html":"2a792d57bbb9d347","photolab/manifest.webmanifest":"c52be905a74cb477","invoices/solo.html":"3e0f1b198c5aae94","invoices/manifest.webmanifest":"03a35b62c030d3c0","transfer/solo.html":"9c6370b891e67cbe","transfer/manifest.webmanifest":"1f17ae1403f5fac7","scanpdf/solo.html":"c85ea00d8bb48d65","scanpdf/manifest.webmanifest":"f85900cb9c368dda","shop/":"a44bb80b812012e2","shop/index.html":"a44bb80b812012e2","shop/app.css":"860da36e704cdb9c","shop/app.js":"a2f8fb92e7680462","shop/core.js":"d5d4c56d76e9f858","shop/search.js":"7b903f84bddf2ec9","shop/today.js":"7157fd605249de45","shop/help.en.txt":"064af191baab1f36","shop/help.el.txt":"d79a1c0916635364","stock/solo.html":"d0170d8d5817c1d1","stock/manifest.webmanifest":"9e33c12ff9711d6c","forms/solo.html":"668c19dd14e64135","forms/manifest.webmanifest":"f6fddedbb68d7cbb","library/solo.html":"de8425e40200ce4d","library/manifest.webmanifest":"76dbbeeb5afc7afc","base/solo.html":"1502c55d6972ee10","base/manifest.webmanifest":"d06494f07d55ca43","crm/solo.html":"9e4bb5c71ff7633a","crm/manifest.webmanifest":"ae21ce85af347572","timesheet/solo.html":"4b9e566cbe37fb7f","timesheet/manifest.webmanifest":"6b1f58c430796188","gamecenter/solo.html":"600b90bcaa99ef54","gamecenter/manifest.webmanifest":"7698af72b0fc175f","icons/solo/notes.svg":"0a256b46eb0d9f69","icons/solo/notes-192.png":"512b5c44e8b64b1c","icons/solo/notes-512.png":"ea7e9961d67bc261","icons/solo/notes-maskable-512.png":"903a79de59bf7a97","icons/solo/calendar.svg":"b0fe8b94257aff97","icons/solo/calendar-192.png":"30d42fa2d8dff6e6","icons/solo/calendar-512.png":"ac407bc09c6ca8e4","icons/solo/calendar-maskable-512.png":"4220feec36b30f24","icons/solo/bookmarks.svg":"eb8b3c8db4aca859","icons/solo/bookmarks-192.png":"2d93446a86a2b8ec","icons/solo/bookmarks-512.png":"5c79046d12efa427","icons/solo/bookmarks-maskable-512.png":"dc3e1956f8adaa4b","icons/solo/todo.svg":"9cb8ad0f4e35c959","icons/solo/todo-192.png":"f29c2f5506e9b625","icons/solo/todo-512.png":"fb6c0e61b5845059","icons/solo/todo-maskable-512.png":"128274aa7d8732ef","icons/solo/contacts.svg":"4a999cf73e182a23","icons/solo/contacts-192.png":"1397b8e26d84d915","icons/solo/contacts-512.png":"3793b8f35c564d10","icons/solo/contacts-maskable-512.png":"ce22d952b94be164","icons/solo/writer.svg":"26ffb02fbd0d9ac8","icons/solo/writer-192.png":"6757e6507c90138c","icons/solo/writer-512.png":"9fda30911c8948b0","icons/solo/writer-maskable-512.png":"7476a73a474af5c3","icons/solo/spreadsheet.svg":"e6d24e1db0bd87ab","icons/solo/spreadsheet-192.png":"12773f1aee654951","icons/solo/spreadsheet-512.png":"e31a2e51b3ac44a8","icons/solo/spreadsheet-maskable-512.png":"bec16ee6a8275a13","icons/solo/kanban.svg":"3b139b994e5b519d","icons/solo/kanban-192.png":"5fa41428e275ec02","icons/solo/kanban-512.png":"0f47f49c6efea1a5","icons/solo/kanban-maskable-512.png":"ecd8ae5e60cab24c","icons/solo/mindmap.svg":"d55132e8170d3f7f","icons/solo/mindmap-192.png":"dcabb12139f75ee9","icons/solo/mindmap-512.png":"1b3c2aea54c932f6","icons/solo/mindmap-maskable-512.png":"4f8f6e9e808dbc7f","icons/solo/wiki.svg":"1403a7f8c23f911d","icons/solo/wiki-192.png":"40a1a4bfda94171f","icons/solo/wiki-512.png":"c2e1063281ccbf0c","icons/solo/wiki-maskable-512.png":"a6defe3cb04434cb","icons/solo/slides.svg":"7e08d6136491757a","icons/solo/slides-192.png":"47033b8bb61331bb","icons/solo/slides-512.png":"2a075a07a46b4d13","icons/solo/slides-maskable-512.png":"48efddd00445f62e","icons/solo/passwords.svg":"822ecb069f070ab9","icons/solo/passwords-192.png":"f8a8c48eb8fd1b0d","icons/solo/passwords-512.png":"49d6a7df99250be4","icons/solo/passwords-maskable-512.png":"6fab6cca2722d9f3","icons/solo/budget.svg":"35dc1898781536f9","icons/solo/budget-192.png":"ea0651865fe6155a","icons/solo/budget-512.png":"6daa3d92d446c739","icons/solo/budget-maskable-512.png":"da3e24d7f8eece1e","icons/solo/habits.svg":"2c119601ca3bce88","icons/solo/habits-192.png":"a7ed2f02ee66703d","icons/solo/habits-512.png":"1a25e9931fd16733","icons/solo/habits-maskable-512.png":"81c4b1d4f1729a74","icons/solo/water.svg":"33c189f1da44cd18","icons/solo/water-192.png":"d2d2f8ee78308afb","icons/solo/water-512.png":"546317bc607a30d4","icons/solo/water-maskable-512.png":"3cb30c4cecc75e65","icons/solo/diary.svg":"368e072df3103213","icons/solo/diary-192.png":"acef8b7075082c78","icons/solo/diary-512.png":"a58295440d23e637","icons/solo/diary-maskable-512.png":"8e8edea78af26ebf","icons/solo/mood.svg":"231a230c9e417e65","icons/solo/mood-192.png":"c6ed5bb26e0472ab","icons/solo/mood-512.png":"5dea0077ca8a9ace","icons/solo/mood-maskable-512.png":"63f479a335f2144c","icons/solo/fitness.svg":"64cce1b940d97566","icons/solo/fitness-192.png":"5644eefbd5e172cd","icons/solo/fitness-512.png":"763cfed654817724","icons/solo/fitness-maskable-512.png":"6719c52bee3c89b9","icons/solo/health.svg":"65d5a3d7ea10cb56","icons/solo/health-192.png":"88b1fcaa6d2bc157","icons/solo/health-512.png":"2e23c5337492bfde","icons/solo/health-maskable-512.png":"88280b224c271532","icons/solo/cycle.svg":"6aca2878ebfc220a","icons/solo/cycle-192.png":"3fa75a3019195439","icons/solo/cycle-512.png":"4f34f7987486b81d","icons/solo/cycle-maskable-512.png":"7ba99727c213e677","icons/solo/calculator.svg":"7b270cc7a4fced69","icons/solo/calculator-192.png":"d8153dfb19676acb","icons/solo/calculator-512.png":"8ba3e9c635790230","icons/solo/calculator-maskable-512.png":"35e7280ede20617f","icons/solo/time.svg":"972717376fae4b6d","icons/solo/time-192.png":"0d72c6f2eaaf408d","icons/solo/time-512.png":"35b64980b7c57376","icons/solo/time-maskable-512.png":"2ede1a888926621f","icons/solo/weather.svg":"9fa45084b17a8ea0","icons/solo/weather-192.png":"b539133f98982a80","icons/solo/weather-512.png":"545105390541bd23","icons/solo/weather-maskable-512.png":"ac96b12669e620ef","icons/solo/maps.svg":"7d624ecf92af5304","icons/solo/maps-192.png":"bfb3a07aacfe98e4","icons/solo/maps-512.png":"5f35615000c112d3","icons/solo/maps-maskable-512.png":"dd3a9628ec96bae6","icons/solo/feeds.svg":"5f96cd826ff6f54f","icons/solo/feeds-192.png":"ff4f6b7d85ec4a10","icons/solo/feeds-512.png":"7d63a3cb2e18081e","icons/solo/feeds-maskable-512.png":"866e1cbb6fbac510","icons/solo/mail.svg":"b68682641aa032af","icons/solo/mail-192.png":"4e93561d5f3b526e","icons/solo/mail-512.png":"b89a9cc40e340ec0","icons/solo/mail-maskable-512.png":"1b1efb6c0b6eeed1","icons/solo/files.svg":"8195afdbecffd95c","icons/solo/files-192.png":"5fd5df3e57be40bf","icons/solo/files-512.png":"6d560f6ed3fcda67","icons/solo/files-maskable-512.png":"21ab3b748d49562f","icons/solo/podcasts.svg":"d9f6c8b6279a0d16","icons/solo/podcasts-192.png":"acd9679c14a35437","icons/solo/podcasts-512.png":"543ff786ed0fb8f7","icons/solo/podcasts-maskable-512.png":"41e99fadca00b8fe","icons/solo/radio.svg":"dd40a13c4d033cae","icons/solo/radio-192.png":"114252f22ca86003","icons/solo/radio-512.png":"29ce1f02b12d02b0","icons/solo/radio-maskable-512.png":"70b9dcb6d048d281","icons/solo/music.svg":"6a3a39829551b570","icons/solo/music-192.png":"0774e9960d4e2742","icons/solo/music-512.png":"efdbbb063a7a49e5","icons/solo/music-maskable-512.png":"2fde197bb19445e7","icons/solo/photolab.svg":"db058eb7d42dd94b","icons/solo/photolab-192.png":"6e4c873dd64eac67","icons/solo/photolab-512.png":"a4e7f5a314d2047c","icons/solo/photolab-maskable-512.png":"f382647648292be1","icons/solo/invoices.svg":"49036fc32a5ef182","icons/solo/invoices-192.png":"4b7e66707c06e933","icons/solo/invoices-512.png":"6ffd5af4d75f44b9","icons/solo/invoices-maskable-512.png":"96336339c4699731","icons/solo/transfer.svg":"43ca105a81ce10da","icons/solo/transfer-192.png":"cf0085f3345d0bf3","icons/solo/transfer-512.png":"1db321e145b1d650","icons/solo/transfer-maskable-512.png":"36a966751f922c6b","icons/solo/scanpdf.svg":"902e7af8bb9ad976","icons/solo/scanpdf-192.png":"27f3f65b6f40ec8a","icons/solo/scanpdf-512.png":"4d52f4b9068678c4","icons/solo/scanpdf-maskable-512.png":"dc28379962197d18","icons/solo/stock.svg":"5cd4e54fff971c4b","icons/solo/stock-192.png":"87ce553f9a60e569","icons/solo/stock-512.png":"f64a07135eea469f","icons/solo/stock-maskable-512.png":"dec8b28275e25f28","icons/solo/forms.svg":"e30bfde2de6de3fb","icons/solo/forms-192.png":"b51baad96dec4152","icons/solo/forms-512.png":"eb51853f6b653289","icons/solo/forms-maskable-512.png":"108c8a43557a9d48","icons/solo/library.svg":"f6ce36c8245a07fa","icons/solo/library-192.png":"0315375d68237611","icons/solo/library-512.png":"dc55f28081a51305","icons/solo/library-maskable-512.png":"cef78e5b2b45cdaa","icons/solo/base.svg":"3e3058a00365083b","icons/solo/base-192.png":"04d4755462df4c7e","icons/solo/base-512.png":"25cbb7febd55d668","icons/solo/base-maskable-512.png":"82b54a63fa964961","icons/solo/crm.svg":"10f69bbd5ccb0c2f","icons/solo/crm-192.png":"e6dd60322b2878a8","icons/solo/crm-512.png":"0b226ec9d552e973","icons/solo/crm-maskable-512.png":"44c9a5ed2e7af687","icons/solo/timesheet.svg":"06976a7b043ed9d0","icons/solo/timesheet-192.png":"9e87a7edd6198165","icons/solo/timesheet-512.png":"ea28ec493d834cf8","icons/solo/timesheet-maskable-512.png":"9d393ec08afa3bc4","icons/solo/gamecenter.svg":"7a7ba230c2eab317","icons/solo/gamecenter-192.png":"5763dbe4874de9cc","icons/solo/gamecenter-512.png":"411738c910781634","icons/solo/gamecenter-maskable-512.png":"e858c4aad9b69a96","todo/":"e6610c649af8d478","todo/index.html":"e6610c649af8d478","todo/todo.css":"8044ff46fb20850f","todo/todo.js":"412273d73cfa864e","todo/import.js":"702430dc44769c63","todo/gtasks.js":"cc9d283a7028f5b3","todo/search.js":"f50e0b73a1137eda","todo/platforms.js":"fa91daca6a9ac22b","todo/package.js":"b500c682a8a1a9c3","kanban/":"b42322351075a929","kanban/index.html":"b42322351075a929","kanban/kanban.css":"1d70c28516caff7c","kanban/kanban.js":"72e51d4f26c02992","kanban/import.js":"86efc9064e14b156","mindmap/":"7a908936054080d6","mindmap/index.html":"7a908936054080d6","mindmap/search.js":"e74f00ed95795de6","mindmap/mindmap.css":"1f6f687989ece379","mindmap/mm-core.js":"1ebfc597b9b4da07","mindmap/mm-import.js":"159039d1828a3bc7","mindmap/mindmap.js":"039d90f6d2d99dae","mindmap/commands.js":"ecf2a4c7d4621e29","mindmap/assist.js":"45e107a2863227d9","mindmap/help.en.txt":"564c18d2c47877b3","mindmap/help.el.txt":"f04edd516081bba4","whiteboard/":"75def5a60a5ba935","whiteboard/index.html":"75def5a60a5ba935","whiteboard/app.css":"fa412b762c39965d","whiteboard/core.js":"82a67480d236c5ec","whiteboard/kit.js":"6c2b3373fe2079b3","whiteboard/app.js":"838b08f6253473de","whiteboard/search.js":"217f7b2029bfe9ca","whiteboard/commands.js":"bb02ab4e505298d6","whiteboard/diagram.js":"d186fba141f83538","whiteboard/assist.js":"605730b94987f1af","whiteboard/help.en.txt":"96ee22300863b19d","whiteboard/help.el.txt":"8c3c904748a6584f","forms/":"4292eba350082685","forms/index.html":"4292eba350082685","forms/app.css":"d9f992b923241a00","forms/engine.js":"66113baff04b3b0a","forms/core.js":"21a756b5cfc66df7","forms/render.js":"771d9831c1257f98","forms/app.js":"f3cef8c39dca4b0f","forms/help.en.txt":"54c7a8794d07dd69","forms/help.el.txt":"c35c6282883251b5","forms/pub.js":"14bf45e6f6e19c0d","forms/share.js":"bd5fa30cdfed9401","forms/host.js":"880b854aadee26db","forms/today.js":"9ede62fe72bba5f1","forms/f/index.html":"d0520ddf5a442b5b","forms/f/fill.js":"07762962ad33930a","forms/f/fill.css":"01bb48c5a0a778ab","forms/quiz.js":"1f2f6118edfed5d5","forms/results.js":"ca050f82d83159d8","forms/links.js":"dd5f26ad6728a555","forms/search.js":"3c1391b44a97517c","kanban/search.js":"b621134ec7cdc557","notes/":"f2fd803225c24440","notes/index.html":"f2fd803225c24440","notes/notes.css":"f9592b47097cd22d","notes/expire.js":"e21a3a0ac8d2d12f","notes/notes.js":"bb412ef738c20274","notes/package.js":"ec568f4dfad84de0","notes/house.js":"2ca5db87f097e949","notes/search.js":"cdb77b725471c346","notes/platforms.js":"04e9c3651fe3c45a","wiki/":"78bf79a7595230ab","wiki/index.html":"78bf79a7595230ab","wiki/wiki.css":"b02be7bfa4966696","wiki/core.js":"0977c28c9894f299","wiki/wiki.js":"d191d45e2b4bd316","wiki/import.js":"8e8671f752a0bc82","wiki/search.js":"3c4c9f3323fe5171","wiki/pdf.js":"f967c543f82dc2e7","wiki/io.js":"ee9587d8815cb0ed","weather/":"137ee2266490cff5","weather/index.html":"137ee2266490cff5","weather/weather.css":"ec498e05a4a6665d","weather/weather.js":"c24a533fba37ea6f","mood/":"a5490d500a10c99e","mood/index.html":"a5490d500a10c99e","mood/search.js":"2063766d61208ce6","mood/mood.css":"503d4c1d3e298a87","mood/mood.js":"4a32311d78fceed0","mood/import.js":"0b9d66633b9ea6e5","diary/":"94c7be1ada4b1e7d","diary/index.html":"94c7be1ada4b1e7d","diary/search.js":"50d92d9221b620a4","diary/diary.css":"074943be83f39c18","diary/core.js":"3c20efb46cb7029f","diary/diary.js":"d4cefb514adb3885","diary/dayline.js":"08ac29e83e61ad1f","diary/import.js":"a535a456e69035d1","time/":"6083a906a1c02cf0","time/index.html":"6083a906a1c02cf0","time/time.css":"c3c0b6d9845b5879","time/time.js":"3638ea07f6f29f7c","time/astro.js":"2464ff310037016b","time/stage-core.js":"10864f90fde75a9b","time/stage.js":"a82cc3e4f03d4f78","time/stage-view.js":"36f7d0092750645f","time/stage-view.css":"673db140a592a7c1","time/display.html":"70df1792f593654d","time/display.js":"b496577a3abff9c6","time/stage-link.js":"b6aff283729f4de2","time/stage-tools.js":"7fdefd247a5c1f5a","time/search.js":"745959c4574edff6","sky/":"0dde170d8976fdff","sky/index.html":"0dde170d8976fdff","sky/core.js":"c10c5a0a618a30b0","sky/stars.js":"d3e6dc8ecd82d004","sky/view.js":"0310ed045fc09050","sky/view.css":"8bf911fab6951d5a","calendar/":"d7948fbf18e78de2","calendar/index.html":"d7948fbf18e78de2","calendar/calendar.css":"91116e8414bbb7c2","calendar/calendar.js":"8ae7f07facc7516d","calendar/namedays.js":"609f39a781931ff5","calendar/ics.js":"257139e361e73e89","calendar/gcal.js":"77c19b7e73cf3e3a","calendar/days.json":"20b14d6ade03a9da","calendar/search.js":"69a2d21ebf231996","quote/":"77e5b4a9e7281a5a","quote/index.html":"77e5b4a9e7281a5a","quote/search.js":"777bba48df86ce54","quote/view.js":"bda9aaff56f2eed8","quote/view.css":"1d8033f68da53e1c","invoices/":"61a24fff43d5c9bd","invoices/index.html":"61a24fff43d5c9bd","invoices/invoices.css":"939f693ed4b7d64d","invoices/core.js":"96cf893e03cf0796","invoices/invoices.js":"52c6cace6c007bf9","invoices/search.js":"aa10ea03b84b85d5","newsletter/":"1d0a31026a638152","newsletter/index.html":"1d0a31026a638152","newsletter/newsletter.css":"b1f281a9b6bef4f8","newsletter/social.js":"401e0135f4d4a55f","newsletter/core.js":"43f146f49185aa2c","newsletter/render.js":"dca412dfe82010ae","newsletter/engine.js":"7d1a9665ba89aa34","newsletter/runner.js":"ca984d699a3cdea9","newsletter/today.js":"abe1d9ecc2d4fcf8","newsletter/archive.js":"fae36cec34c02a4a","newsletter/platforms.js":"fb7a5bb2064279e2","newsletter/shop.js":"d2b8dae0db621950","newsletter/newsletter.js":"8eb67822a56cd8da","newsletter/import2.js":"19014f0442c80ba9","newsletter/search.js":"1c7cdb474683f397","signature/":"03460928725900ce","signature/index.html":"03460928725900ce","signature/core.js":"19e1832b9b2d655d","signature/view.js":"1494607cde818823","signature/view.css":"cbcd5f574fdc05da","signature/search.js":"bb4b8ff5c24c4283","certificates/":"07ad97a911cd1bc8","certificates/index.html":"07ad97a911cd1bc8","certificates/certificates.css":"b13788c2a98b611f","certificates/core.js":"06afd9554de074cc","certificates/dk.js":"e44afa3ed2b57345","certificates/certificates.js":"2532c254ad5be77b","certificates/package.js":"fd4c4b8b6dadf6a9","certificates/search.js":"c896dd67f7cd7012","certificates/badges.js":"a3c4cdd705a07639","certificates/send.js":"fc1e3ed4ddb92b07","publish/":"089626d6e566e59e","publish/index.html":"089626d6e566e59e","publish/app.css":"a2cd0a0dc68aa2bb","publish/core.js":"f060315e34fcbf34","publish/app.js":"36db8ae380c12dd5","publish/search.js":"12957321ce6fd2af","publish/feed.js":"8bc40059016911de","publish/today.js":"ecc4b751212127e8","publish/royalty.js":"3f4724a2ac060444","publish/distro.js":"fa70191fcf783463","publish/costs.js":"f9ce63cb9cb3991c","invoices/today.js":"77c3bdffb7bc3d9c","invoices/mydata-ui.js":"a46efd275ad20927","crm/":"32f39e5511386cf0","crm/index.html":"32f39e5511386cf0","crm/crm.css":"dc86d8f8df5d474f","crm/core.js":"a1f00d8668c199c8","crm/contactsync.js":"c56d33cc07ee107c","crm/links.js":"4a0225e1b05f73d9","crm/overview.js":"0fed0150073b000d","crm/timeline.js":"c4286faa70568cbf","crm/rs.js":"ef5ddef4a55f7852","crm/platforms.js":"556cc78133bf2a67","crm/webform.js":"c2bee22572a4a1ea","crm/crm.js":"85ca6d714f3c6db6","crm/search.js":"335f87738258958e","crm/today.js":"053aa7423069fee2","timesheet/":"32560b476bab1871","timesheet/index.html":"32560b476bab1871","timesheet/search.js":"322cc8fa78ea74cd","timesheet/timesheet.css":"dac0d334ed216b2f","timesheet/core.js":"d7d02f5156a3afdb","water/":"f336f9b3b22aff02","water/index.html":"f336f9b3b22aff02","water/water.css":"c36f4a97d86be5fa","water/core.js":"f954148abda761eb","transfer/":"9b2066ae872a2e1f","transfer/index.html":"9b2066ae872a2e1f","transfer/receive.html":"52c7a06141e7f129","transfer/app.css":"76400b944ab197c1","transfer/art.js":"a06bbb0f8d834687","transfer/core.js":"ba77e9c5e7244eab","transfer/today.js":"e8ac89d08670cea2","transfer/cloud.js":"2ed041e6ccae9cd1","transfer/engine.js":"bcecf48355fd15bc","transfer/store.js":"647f53829f8379ce","transfer/app.js":"142157c906aa5173","transfer/search.js":"2a402a819c21723f","transfer/help.en.txt":"dc1997da95eb2217","transfer/help.el.txt":"712ab454c2a8b23c","mail/":"1736300301425223","mail/index.html":"1736300301425223","mail/search.js":"8e28732b4108340a","mail/mail.css":"6cef001c84fe7018","mail/mail.js":"6aa0a0b136031c76","mail/mime.js":"9774fdbd30a08327","mail/sanitize.js":"68616c325a66b658","mail/compose.js":"0e90b6a3b8e11453","mail/notify.js":"c9f3c6e0e1620287","mail/trust.js":"ae90c4afd71f16d4","mail/rules.js":"ebe9226fcc5b7367","mail/rich.js":"7a1e73aa03ccfb7b","mail/threads.js":"fc460ab1036c9f7f","mail/outbox.js":"53d22ef6f1dc6f82","mail/people.js":"06152f0675778ee4","mail/sieve.js":"bacd3026b7cf5a82","shelf/":"fd603d15baedef13","shelf/index.html":"fd603d15baedef13","shelf/search.js":"8437b31b456f25a3","shelf/feed.js":"cece651580c20fe3","shelf/shelf.css":"2ef7781b3c3b6588","shelf/shelf.js":"d48f2bab52585465","shelf/import.js":"f7b7bb3aed8b736e","shelf/gbooks.js":"267e3f1f70e6a0d6","library/":"471bb4307b91b44d","library/index.html":"471bb4307b91b44d","library/search.js":"6327192e8131f879","library/speak.js":"fe7092a7d58fa41e","library/stats.js":"6d5635791ea20fe9","library/import.js":"dada4a0a450ded52","library/hlimport.js":"3c7ebe2cd6e94c92","library/today.js":"f1d1b5ffaaf2603e","library/lookup.js":"8b2c8ad705542616","library/library.css":"945ddf2080fdc77c","library/core.js":"3d86adcfb8d6d1a4","library/sanitize.js":"8aa9f5bb460538f2","library/strings.js":"ecb6504b0adb907e","library/app.js":"573ff4e88d9ae6af","library/store.js":"444b49000a9f34c1","library/home.js":"2fa5593211ae3722","library/reader.js":"3c92e20f3e8f6962","library/epub.js":"25c576e89aace9ff","library/pdfview.js":"09c3959d80cb0211","water/water.js":"74a6a1578ea48ad2","water/help.en.txt":"4b88f11e1c11fcb1","water/help.el.txt":"d3d0166a1d39faec","timesheet/timesheet.js":"55afe575ea32ba0f","timesheet/import.js":"7a8c1134d09ec937","storage/":"64347628bded9b5c","storage/index.html":"64347628bded9b5c","storage/search.js":"4d238a908d6b253c","storage/storage.css":"9502dcd8418cfb4a","storage/storage.js":"5e5f9fd4ad297250","storage/import.js":"caa78696478d8da5","bookmarks/":"0bd9692e832d088c","bookmarks/index.html":"0bd9692e832d088c","qr/":"2f96bc872366fc31","qr/index.html":"2f96bc872366fc31","qr/qr.css":"5b3ca11578f54bdf","qr/qr-encode.js":"acbee70852b156d7","qr/qr-payload.js":"21446a83f0a1c326","qr/qr.js":"0e6e654406bd3c19","bookmarks/bookmarks.css":"6b4216e0bbc3be22","bookmarks/bookmarks.js":"43b5453369726231","bookmarks/import.js":"9d6f441969204cf1","bookmarks/search.js":"da198258d63fbe5d","bookmarks/platforms.js":"0b49dea2721495b4","prompter/":"37beda79bd3104be","prompter/index.html":"37beda79bd3104be","prompter/search.js":"f3eb677cdbbfb43e","pubdomain/":"b993507911095291","pubdomain/index.html":"b993507911095291","pubdomain/pubdomain.css":"cdfeab5e129cd80e","pubdomain/rules.js":"2fac761f19672d54","pubdomain/pubdomain.js":"8ee78aac16498384","pubdomain/help.en.txt":"ffbd1cab4c75d15b","pubdomain/help.el.txt":"d50a1a7a866944cd","prompter/prompter.css":"94c4a66765344cf1","prompter/prompter.js":"1fb3d596070e679c","prompter/io.js":"6c7af6357c1f80ba","typewriter/":"85a46716728b35f6","typewriter/index.html":"85a46716728b35f6","typewriter/typewriter.css":"869484f9b56fde89","typewriter/core.js":"20270e9b488d27be","typewriter/typewriter.js":"57784361e4c1afd4","labels/":"7c430628301c3ab0","labels/index.html":"7c430628301c3ab0","labels/labels.css":"8d21312b6a79bfcd","labels/core.js":"8b5fdc4243a97507","labels/labels.js":"e1a3a703e263e004","labels/search.js":"0966f9f6f5a6a5e4","typewriter/help.en.txt":"e7f38ede6c47101e","typewriter/help.el.txt":"328ecbc47876645f","labels/help.en.txt":"bd4be65d340c2c3c","labels/help.el.txt":"18fa02473880e3ef","habits/":"5babaf0f3c36b280","habits/index.html":"5babaf0f3c36b280","habits/search.js":"241bb5bf6381b5fe","habits/habits.css":"4d2f735b45c497e0","habits/habits.js":"bb297e742faa23a3","habits/import.js":"4dd73db2e54b53cb","meals/":"10f7031414ff9cbf","meals/index.html":"10f7031414ff9cbf","meals/search.js":"c46ba7e791a3c1dd","meals/meals.css":"f41342dff2df9e0d","meals/core.js":"df169306c5032b17","meals/meals.js":"9799aacdff03d263","zen/":"8022b8d4f8d4a4a5","plants/":"c9207b1507fd5cb3","plants/index.html":"c9207b1507fd5cb3","plants/search.js":"59107d6b143f061c","plants/core.js":"42c630b908860b9f","plants/plants.css":"36156c262bf195cd","plants/plants.js":"6cb0ab75c18ccce5","zen/index.html":"8022b8d4f8d4a4a5","zen/core.js":"703e29b5b2432b41","zen/zen.css":"9a6d2074f7258e62","zen/zen.js":"d0cfe5b36f9b9b40","zen/import.js":"69eabc5e550f72a4","health/":"ad1e42c054b2a775","health/index.html":"ad1e42c054b2a775","health/search.js":"4d94b3fb563a2e37","health/core.js":"b56b4d7eb34f060b","health/health.css":"98b96a2674f51ce3","health/health.js":"4ac720e83a8ca714","health/import.js":"203f97523f23b4ef","health/help.en.txt":"8874e3a8f06dce00","health/help.el.txt":"b1814d4276bfd3f1","files/":"49d285c91d82d76a","files/index.html":"49d285c91d82d76a","files/files.css":"9dd009a7f9ef36bf","files/files.js":"0f10ecde5e1baa9f","files/search.js":"47b06082956c4c52","files/dropbox-core.js":"dcefbc6e2f867ba6","files/dropbox.js":"9ebeeb71b19f7892","files/drive.js":"ee81c530057e03d9","files/computer-core.js":"005abfbb7cd573b2","files/computer.js":"7979d29fc2a59245","files/gmedia.js":"d72026d421c36bfd","files/docs-core.js":"f87f7da43907c7cb","files/docs.js":"09bead006ff263e3","files/docs.css":"320ec2473c7bff23","files/docs-text.js":"e37b14387e21e46e","files/docs-read.js":"6ede7188fec7e16f","files/clean-core.js":"ac88228050ea321c","files/docs-due.js":"173a4871dd0b59c0","files/today.js":"35d97b07bb4d0e77","files/docs-links.js":"02b80bae32c21143","files/tags-core.js":"b3c9b02c6057d8b3","files/tags.js":"2925655e0ed9a7a5","files/photos-core.js":"e9029178341ce1fb","files/albums-core.js":"f258504eb18e4c11","files/photos.js":"96ec7328f7d06d03","files/photos.css":"a527fb6c258ad154","files/dupes-core.js":"eb836246fea56743","files/dupes.js":"0b4e4165588d6531","files/dupes.css":"dc646565fd1c8c81","files/dropbox-callback.html":"fbf916b76ab0e7d0","files/dropbox-callback.js":"e88374047152997b","writer/":"dc282248b0440152","writer/index.html":"dc282248b0440152","writer/writer.css":"6f10bff7be5cd2f0","writer/writer.js":"a6dbcbf2b0882d02","writer/io.js":"dac6f3ae322a8906","writer/pdfin.js":"38ae06a583c3f4f4","writer/docxout.js":"caf1df6727f784dd","writer/convert.js":"bcb6f1345b7e473c","layout/":"995b3261f87dc0f9","layout/index.html":"995b3261f87dc0f9","layout/search.js":"a9b41e4d6d42e186","layout/layout.css":"fedcb2359b28cf8b","layout/layout.js":"c325ace0c8ab2a2c","layout/editor.js":"32c2d8c6a7098b09","chores/":"261eca664f4f561e","chores/index.html":"261eca664f4f561e","chores/search.js":"a859ae404fffb42a","chores/chores.css":"6992e9b199938994","chores/chores.js":"f29170e5dbd9cc9c","chores/core.js":"245001382d2290ee","layout/panels.js":"869eb7184b928b9e","layout/fontpick.js":"e54d3d02982655df","layout/story.js":"e34696bf7f5e6a44","layout/caret.js":"b18c51066ffff95e","layout/inframe.js":"a3d62b6ea77b1620","layout/sla.js":"f0a6e835d71a4c3a","layout/svgin.js":"51c10b96576bd7a8","layout/svgout.js":"14e8ed03d46cc4f3","layout/blend.js":"db10a2ea02a16b7a","layout/vector.js":"d50800625107dc7a","layout/idml.js":"5971e24a3b20efa0","layout/pdfin.js":"31f12903ef34d21f","layout/linefit.js":"72b50b438fdd2c42","layout/afread.js":"66fe22385714579a","layout/rebuild.js":"2f2ae75003a8a5fe","layout/port.js":"84aaafe41829dc9a","layout/starters.js":"097a1c3509a7aafe","layout/startui.js":"0a50f89baff70f55","layout/smart.js":"8079a0c1f7772ea3","layout/comfort.js":"a56c7866258ca639","layout/findchange.js":"fc5be33065af933f","layout/findui.js":"2efeb0f67113f164","layout/objstyles.js":"3e4fcff1cde2e2f2","layout/swatchlib.js":"b0ee9d6e33ee760a","layout/library.js":"3c37d6ea00bb71e4","layout/notes.js":"e8d281c028d9edc2","layout/book.js":"a0a4932bf819aca6","layout/retrim.js":"1ec73fc782374629","layout/proof.js":"1ff6d07079e9f532","layout/impose.js":"fe5d9aa8ac15abd0","layout/versions.js":"871785ffcb679d25","layout/tableui.js":"b920e2c4de60c33d","layout/track.js":"6081111b1d5f22a4","layout/comments.js":"ef7e8bbe2add46dd","layout/bookindex.js":"29faa0548a5a2346","layout/symbols.js":"34ecce7afc336184","layout/xout.js":"9745bc1ca3d6c417","layout/altlayout.js":"191a6da7f5259350","designkit/zipin.js":"543978c94879e901","layout/wordin.js":"da380c54e08dc245","layout/io.js":"513bc3a5d64d1357","layout/house.js":"72e97b9713900117","layout/intake.js":"a57ed841ebac5eda","layout/autolay.js":"13a46bacba75cb0b","layout/outprof.js":"7fe083724eda1971","layout/epub.js":"02276b5cb3df97e4","layout/epubcheck.js":"22b937676c826874","layout/epubout.js":"aa1636b183553c6a","layout/pdfout.js":"06e63abc7e70dfaf","designkit/pdfx.js":"f349ac520e336b04","designkit/tagpdf.js":"1918865520609b60","vendor/icc/ISOcoated_v2_eci.icc":"128dc02f7246cc38","vendor/icc/sRGB_IEC61966-2-1.icc":"3f6a7ffece56fe0f","vendor/icc/LICENSES.md":"db6179b28d4f1da3","layout/houseui.js":"421b29484855796a","designkit/assets.js":"053433ec30b2d9be","designkit/fx.js":"6d32ccaeb6373e2c","designkit/blend.js":"fb25c52203f22c9b","designkit/vector.js":"bfa2f981336193e1","designkit/pathedit.js":"f507a5dab5cb4d8d","designkit/boolean.js":"8faba91547a63e0d","designkit/media.js":"d91b69bd475e59d6","designkit/model.js":"a3f2f129d6311e24","designkit/docstore.js":"307b845cf53de2a7","designkit/pdf.js":"e41b66c421f48a32","designkit/render.js":"4d44700efd9d8093","designkit/show.js":"6af1c756bff4027b","designkit/templates.js":"a1169963f7995b7b","designkit/cover.js":"4a15059d30d01788","designkit/text.js":"1c24d20add4f67d5","designkit/table.js":"9796cf65b75a391a","designkit/fonts.js":"21b835521e8643de","help/":"7902b461013bbc2f","help/index.html":"7902b461013bbc2f","help/search.js":"35449df66069280b","help/help.css":"d41ba8b6815535f6","help/help.js":"05efc41b1ce5a529","help/asio-compatible.svg":"eed7e2dbd5715b83","help/topics.json":"2720dd1031708d0b","help/topics/appearance.el.txt":"7b0da212e9c663b5","help/topics/appearance.en.txt":"12836be20309da13","help/topics/backup.el.txt":"bf6851c1d2abd541","help/topics/backup.en.txt":"8bc887fb7ff57c80","help/topics/data.el.txt":"5a28e00698907169","help/topics/data.en.txt":"ceb4e6843a4ef0d1","help/topics/faq.el.txt":"970f1a3944b7cb81","help/topics/faq.en.txt":"9ae2e49d84638e8b","help/topics/install.el.txt":"e4938285ae567df4","help/topics/install.en.txt":"92834c9ac2d94e5c","help/topics/menu.el.txt":"184ef700a740e497","help/topics/menu.en.txt":"bd30bf4d9318312b","help/topics/notifications.el.txt":"789db34e9938fcc2","help/topics/notifications.en.txt":"ca62b404ebefbc5b","help/topics/privacy.el.txt":"3486533ff4366435","help/topics/privacy.en.txt":"2200621aa53c6989","help/topics/reset.el.txt":"f5453ded2295d5bf","help/topics/reset.en.txt":"9c20daafeaf1721e","help/topics/sensitive.el.txt":"f4ef8b6a264c5b04","help/topics/sensitive.en.txt":"7fa27b8836a979a0","help/topics/share.el.txt":"6c31c499d8dab86c","help/topics/share.en.txt":"9dc2cc7bcf71a16c","help/topics/shortcuts.el.txt":"a07a196664031796","help/topics/shortcuts.en.txt":"4c279ac858b541ec","help/topics/start.el.txt":"1c585ce7a98f7aac","help/topics/start.en.txt":"926b81ad5176565d","help/topics/sync.el.txt":"955c3482729b430e","help/topics/sync.en.txt":"b8112f471e692b22","help/topics/troubleshooting.el.txt":"64f6159022fb912a","help/topics/troubleshooting.en.txt":"7c04fc7e4d99c9e9","help/topics/whatsnew.el.txt":"60472e198f1b297d","help/topics/whatsnew.en.txt":"6f01b6e8eeb79a3c","weather/help.en.txt":"374150352dc03a7e","weather/help.el.txt":"744bb00cd81cb519","time/help.en.txt":"10927940d8c1bd90","time/help.el.txt":"cf4a6918838e6128","files/help.en.txt":"95508c41af314991","files/help.el.txt":"8b0870e946c2ea56","todo/help.en.txt":"23981b75b7924784","todo/help.el.txt":"f71bef77de524b27","kanban/help.en.txt":"7ddbb832325c1c4c","kanban/help.el.txt":"151dec8ff0e4babc","notes/help.en.txt":"3c9c98f673f6afe3","notes/help.el.txt":"1ceca88bb1329d5d","wiki/help.en.txt":"306c28cf20ff3a9f","wiki/help.el.txt":"12e418f08831dea2","gamecenter/help.en.txt":"eeb4195cad8f3aff","gamecenter/help.el.txt":"b9fedf67b22cc082","calendar/help.en.txt":"153424502633cc46","calendar/help.el.txt":"87a65409f155e2bc","contacts/help.en.txt":"710ab43481f49da4","contacts/help.el.txt":"1db4ae9a02c602e3","spreadsheet/help.en.txt":"835d16e455e73c1b","spreadsheet/help.el.txt":"1df1660c5b711a1d","writer/help.en.txt":"fba66b86e394564f","writer/help.el.txt":"7e15f2f9f4034b94","bookmarks/help.en.txt":"941e059b6bbddb27","bookmarks/help.el.txt":"aaffe253ba9d9270","maps/help.en.txt":"3024a54cf4167913","maps/help.el.txt":"faa2e4b70c3beb1a","help/help.en.txt":"c76f100f572198f0","help/help.el.txt":"6d4025554461bf7d","baby/help.en.txt":"9afe6669bb4b162a","baby/help.el.txt":"471a82664aeca0be","backgammon/help.en.txt":"0fc421325d693246","backgammon/help.el.txt":"a6d3d7891732fa16","battleship/help.en.txt":"434368a44d6aae6a","battleship/help.el.txt":"c16db2bf5dc0d365","breakout/help.en.txt":"e1c55f950bcb2894","breakout/help.el.txt":"f3d7e2fcd1650637","bubble/help.en.txt":"62bfe76e34a47f62","bubble/help.el.txt":"e0dee756a45ca9cf","budget/help.en.txt":"8b6793b032a0babf","budget/help.el.txt":"648eeed836153c81","calculator/help.en.txt":"1d616b775a9d6521","calculator/help.el.txt":"3be810ae73c1c114","texttools/help.en.txt":"fcfbbbd6a71633cf","texttools/help.el.txt":"910222fbaa7ce95d","stickies/help.en.txt":"ea22809658422999","stickies/help.el.txt":"bfab892d512ea169","pad/help.en.txt":"5e820ca4ff575b72","pad/help.el.txt":"433e5cd054f545cb","characters/help.en.txt":"8218127e67d872cc","characters/help.el.txt":"bf3fa65dced60772","checkers/help.en.txt":"f99573baa701cb65","checkers/help.el.txt":"61d327b94d10df24","chess/help.en.txt":"a65e769c2e63591b","chess/help.el.txt":"3ee7a2ebe0715384","chores/help.en.txt":"d991b3d93efb3e6c","chores/help.el.txt":"3c2cf0e88e0befbb","connect4/help.en.txt":"211f4d1612183ce2","connect4/help.el.txt":"75036be30e67e7c7","crossword/help.en.txt":"1cb4f4b63139cb93","crossword/help.el.txt":"0f8e47d89c7ba899","cycle/help.en.txt":"7d306d355f8739b8","cycle/help.el.txt":"f4c1f6b16a490e64","dice/help.en.txt":"02843969442b6b6d","dice/help.el.txt":"2a98842c876882c6","dots/help.en.txt":"9044cf3f74c3b5e0","dots/help.el.txt":"d908a201a4be0f6b","familytree/help.en.txt":"998aeb8740c46548","familytree/help.el.txt":"43d14f3bb00c1a14","feeds/help.en.txt":"ff8413e85a960133","feeds/help.el.txt":"ac551f6666c9b21e","fitness/help.en.txt":"bc23a2bf53020629","fitness/help.el.txt":"c6d55221a25a86f9","flow/help.en.txt":"e59d17f83fb49deb","flow/help.el.txt":"c63a0db768707865","g2048/help.en.txt":"46fbf2456fd6908a","g2048/help.el.txt":"79f2fba01faa24df","stock/help.en.txt":"4e873fdb11243415","stock/help.el.txt":"61cc00ff94fbac69","garage/help.en.txt":"15c21e6423d1cdbd","garage/help.el.txt":"fbff3a04054b1b65","gomoku/help.en.txt":"e5b3fc264ab4c0a6","gomoku/help.el.txt":"9902ea02143eade5","habits/help.en.txt":"1d90edd6cfc647e1","habits/help.el.txt":"013303fd1caa131b","hangman/help.en.txt":"f75b2c6f45817cfb","hangman/help.el.txt":"a96f633957d79f43","hexagon/help.en.txt":"5a79ade9f51c8698","hexagon/help.el.txt":"091fda637b269a25","jigsaw/help.en.txt":"19f30fa332822236","jigsaw/help.el.txt":"926738183bfc4a24","layout/help.en.txt":"33acfcbe8b88e342","layout/help.el.txt":"0d25df38d7ed9fa7","lightsout/help.en.txt":"6de07dec8cd70ec5","lightsout/help.el.txt":"64774a302a25d657","mahjong/help.en.txt":"affa69c0b004d6a5","mahjong/help.el.txt":"56dbdef3cf48d0f5","mail/help.en.txt":"850756f03f1bd64e","mail/help.el.txt":"b4022bb2fa809d01","mancala/help.en.txt":"28999517de54299c","mancala/help.el.txt":"91eee9645d7e5d4e","mastermind/help.en.txt":"e8c689d9605ae7f0","mastermind/help.el.txt":"0cd627d688a1fc4e","meals/help.en.txt":"4f83d6fea5ecdd45","meals/help.el.txt":"82c36a1921af3def","memory/help.en.txt":"ff5e498ca5821ba6","memory/help.el.txt":"23ff7036b763a056","minesweeper/help.en.txt":"322a1d82c6ce03f7","minesweeper/help.el.txt":"c848aa2369216afb","minimalism/help.en.txt":"9318ba84949542cb","minimalism/help.el.txt":"e4d7e4ede9944a05","mixer/help.en.txt":"5b934d1f76fa25e6","mixer/help.el.txt":"c0c31449a3f099d2","ringtones/help.en.txt":"070e00f372ba22df","ringtones/help.el.txt":"f00b3c6caea3ad70","studio/help.en.txt":"8c3b68ebc1caed9f","studio/help.el.txt":"a63dd4fc934da6fe","lyricsync/help.en.txt":"7e53efe296f7ad72","lyricsync/help.el.txt":"5bb03a97d3f0b104","mood/help.en.txt":"86250b9c1679f8bc","mood/help.el.txt":"8f9a409f67992531","diary/help.en.txt":"2847ea030f4b5794","diary/help.el.txt":"41ab8f2088a42ad8","names/help.en.txt":"ee2fa708614d3cd5","names/help.el.txt":"c899650e98d7519b","netizen/help.en.txt":"72fab72afdae6b8e","netizen/help.el.txt":"9d81fdad818264a6","nonogram/help.en.txt":"6d1fdfc660f0ebbb","nonogram/help.el.txt":"d46fd668734f160c","passwords/help.en.txt":"44c5b7bd5e9c4d1b","passwords/help.el.txt":"72a3269f34d51de8","petcare/help.en.txt":"3eb936fa4fca115f","petcare/help.el.txt":"4097716d852b9f5b","petworld/help.en.txt":"f3bef6918a824322","petworld/help.el.txt":"db2783b015c43903","pixel/help.en.txt":"4e8484081b948f7c","pixel/help.el.txt":"f485922ba090298e","plants/help.en.txt":"f503812db20a5e8a","plants/help.el.txt":"75f29ab1573a052b","podcasts/help.en.txt":"c044c6b2e25b0006","podcasts/help.el.txt":"c6158e22b444eff5","music/help.en.txt":"32364f4dc898a00c","music/help.el.txt":"795b1b208d7fef66","pong/help.en.txt":"9995ecb0302c89ed","pong/help.el.txt":"3d394c848ac6c541","prompter/help.en.txt":"bb80401a54cd5b1e","prompter/help.el.txt":"5026378a1e37ec7b","qr/help.en.txt":"8bf726bf295697b4","qr/help.el.txt":"76e77ac63c401c09","radio/help.en.txt":"2a0a1822cba366dc","radio/help.el.txt":"2c8b04bbc805336b","reversi/help.en.txt":"2371bab5173f0465","reversi/help.el.txt":"1d87ad05b5c93864","rps/help.en.txt":"744b9001391b3c59","rps/help.el.txt":"ea807bfea17eb1d1","scores/help.en.txt":"1a72f688e33e67a7","scores/help.el.txt":"67e9431c6f8f0245","shelf/help.en.txt":"429ee15bbbf3ca83","shelf/help.el.txt":"4ef4cc7427782c64","library/help.en.txt":"ef9be3d9df80cb13","library/help.el.txt":"5f2606e663b5a1fb","simon/help.en.txt":"0778b17793180f80","simon/help.el.txt":"752e73bb1d039329","slider/help.en.txt":"5e5525c2976de160","slider/help.el.txt":"97cc31e8bfbd7aef","snake/help.en.txt":"19fc5cb2f47a36e5","snake/help.el.txt":"7bfc174e2fa60c51","solitaire/help.en.txt":"838695284ff3e21f","solitaire/help.el.txt":"da48f590459adf98","split/help.en.txt":"f5f55cae9b55488a","split/help.el.txt":"9bbaacd33b1d0c45","spot/help.en.txt":"f8f9d05e4da51609","spot/help.el.txt":"644d6982be43d336","storage/help.en.txt":"cabd586587f85d00","storage/help.el.txt":"4a31a1a916a13991","sudoku/help.en.txt":"d1ad1e8a9b8b09cb","sudoku/help.el.txt":"c928e843da24f258","television/help.en.txt":"5e6cafc714a2dee9","television/help.el.txt":"343195a6509aacd2","montage/help.en.txt":"aaab9dcbfee7dadf","montage/help.el.txt":"12f12f032e264715","capture/help.en.txt":"6d867b29f97287b0","capture/help.el.txt":"079a4d5df4ac286d","tetris/help.en.txt":"ef49096cb5c38cac","tetris/help.el.txt":"97037e796ae9bd6e","tictactoe/help.en.txt":"fd5e805f88a60b41","tictactoe/help.el.txt":"9a84b31ce27e1231","timesheet/help.en.txt":"d262bdf9ea575c41","timesheet/help.el.txt":"fe23297b0f3b4bf6","invoices/help.en.txt":"d1d7757c0f38f935","invoices/help.el.txt":"c77525d3b6981dba","newsletter/help.en.txt":"5ab177d795f04a8a","newsletter/help.el.txt":"8f4dbb5068b4aecf","certificates/help.en.txt":"cca06e9d257c086a","certificates/help.el.txt":"553ccbc598337178","publish/help.en.txt":"f57a3d05786fe1d9","publish/help.el.txt":"29002c2d6a8db204","crm/help.en.txt":"84ef9bfcbb8421cd","crm/help.el.txt":"a2c9510916b4f90f","travel/help.en.txt":"d6eeec4b1bd22dbf","travel/help.el.txt":"f51d67e044d0d043","wallpaper/help.en.txt":"5dad43e9d7b9b7ec","wallpaper/help.el.txt":"100689a2e0376cd4","aura/help.en.txt":"5e7974497b36f874","aura/help.el.txt":"73050f886d8f2959","photolab/package.js":"a6f3be29bd3bd012","photolab/help.en.txt":"a3ea881ad48b40b1","photolab/help.el.txt":"bb84c9ea4bc42451","whack/help.en.txt":"4edf02e709f366c9","whack/help.el.txt":"0b0099e6f06955fa","wordle/help.en.txt":"dfefe7d714836887","wordle/help.el.txt":"694fbe3851846068","wordsearch/help.en.txt":"dd7e6b61b3ad431c","wordsearch/help.el.txt":"bfa785a1022c8c10","xeri/help.en.txt":"d38e2ec6d778bf5c","xeri/help.el.txt":"b9b64d2df4856752","realm/help.en.txt":"9c5f3bb618f8cba5","realm/help.el.txt":"71351f1577b5ea56","banner/help.en.txt":"04edda0d5ff7c5d9","banner/help.el.txt":"8038712c67f22a5c","fieldwarden/help.en.txt":"880a5d532521fdaf","fieldwarden/help.el.txt":"b878985b0c6f2842","roots/help.en.txt":"fe10d1e169eb2f96","roots/help.el.txt":"6e30026da5899d7e","hive/help.en.txt":"ee0b1a4d53a64767","hive/help.el.txt":"8291d27d94588f6a","lighthouse/help.en.txt":"45cb0f40e617b33a","lighthouse/help.el.txt":"9c6828c6bc221f9c","ridge/help.en.txt":"c89798842dbb4647","ridge/help.el.txt":"32974eecc610ab28","maze/help.en.txt":"7d01dfc5c408b559","maze/help.el.txt":"d3a67c95a445637e","caravan/help.en.txt":"84213f69fb18e246","caravan/help.el.txt":"137d9e5df2ebaae1","orbit/help.en.txt":"3b2ab423e19b733b","orbit/help.el.txt":"2b372d1f29b5581b","starchart/help.en.txt":"0e7fa262afd6a1f7","starchart/help.el.txt":"8984bb568174d61b","clockwork/help.en.txt":"17fdfd03475bc8dc","clockwork/help.el.txt":"2961d6a461e1b76a","wayfarers/help.en.txt":"1b80110433a7b407","wayfarers/help.el.txt":"7ab8a959d2f627c1","crypt/help.en.txt":"86a3d7d1cd891a0f","crypt/help.el.txt":"1588146326121686","zen/help.en.txt":"9246961cda429e93","zen/help.el.txt":"4a28b6b5781f1546","vendor/codemirror/cm-core.min.js":"1b5faa684e4e0921","vendor/codemirror/cm-web.min.js":"0be5dc1bfee5fac3","vendor/codemirror/cm-python.min.js":"2c69a6659577ace1","vendor/yaml/yaml.min.js":"7a2b078eb3273af3","vendor/codemirror/cm-go.min.js":"394c91778dc427fc","vendor/codemirror/cm-rust.min.js":"95ec4b7e2aa4494d","vendor/codemirror/cm-cpp.min.js":"eddec8176b9882e2","vendor/codemirror/cm-java.min.js":"bbcfee0f503c9861","vendor/codemirror/cm-sql.min.js":"9a3f4a23e5ce882b","vendor/codemirror/cm-yaml.min.js":"1120723119ab46c5","vendor/codemirror/cm-legacy.min.js":"badeb48589fdccbd","vendor/noto/NotoSans-Bold.ttf":"1f988ea9681683c9","vendor/noto/NotoSans-BoldItalic.ttf":"aa4c2bedb8fe67f9","vendor/noto/NotoSans-Italic.ttf":"61aafd431d3dddca","vendor/noto/NotoSans-Regular.ttf":"c1d65ec522212c77","vendor/noto/NotoSansMono-Bold.ttf":"63f8f4f116dd1fbb","vendor/noto/NotoSansMono-Regular.ttf":"ec5d9ab078872763","vendor/noto/NotoSerif-Bold.ttf":"232a47d7fd050444","vendor/noto/NotoSerif-BoldItalic.ttf":"8e2fc4342881fe12","vendor/noto/NotoSerif-Italic.ttf":"f554d79c44ec7992","vendor/noto/NotoSerif-Regular.ttf":"8c1d6b379824ca6a","writer/search.js":"86d070475f0364f2","characters/":"cb928327f224a49d","characters/index.html":"cb928327f224a49d","characters/search.js":"10f130e89790acbe","characters/characters.css":"e3fd227716c767e4","characters/characters.js":"772deb42bfbaa870","names/":"999edd389bdc232c","names/index.html":"999edd389bdc232c","names/names.css":"16296c45d9c5e688","names/words.js":"bd6d7590f8118c59","names/names.js":"c0d947db5b5c6cef","pixel/":"8f07f83865522868","pixel/index.html":"8f07f83865522868","pixel/pixel.css":"23f092d8c9017832","pixel/pixel.js":"1421f54164334589","pixel/import.js":"152eb5f4018ce7c6","cycle/":"679267e93a284cf7","cycle/index.html":"679267e93a284cf7","cycle/search.js":"bf733d8222e85578","cycle/cycle.css":"24871f5e7c59a6cf","cycle/cycle.js":"b859bef06c502bb4","cycle/import.js":"0e6c638c8ab2e1cc","contacts/":"f539633df43667ee","contacts/index.html":"f539633df43667ee","contacts/contacts.css":"7141801a4b470a5b","contacts/contacts.js":"dca820f0ab390fcd","contacts/search.js":"b0a9a8f0150eaef4","stock/":"2ac81614402f3aea","stock/index.html":"2ac81614402f3aea","stock/search.js":"1c6a764c4a4e1420","stock/core.js":"4bfe69b3434481ae","stock/stock.css":"16300198ad076b35","stock/stock.js":"b7e14353ece5fb6e","stock/import.js":"e26d7890348d8a12","stock/shop.js":"a4705ea10a4376ab","stock/consign.js":"5157ddd86be7496a","stock/prices.js":"f3978cafee363ef8","stock/pricelist.js":"a7feebf95d3a3258","stock/today.js":"e672ee1495b0ed0f","garage/":"1911f1a93eee93c0","garage/index.html":"1911f1a93eee93c0","garage/search.js":"1fcf1b2176b3b231","garage/core.js":"71eef9fd1f3e7634","garage/house.js":"f6d3ca19bfb2e27d","garage/garage.css":"7a1f75c553d71238","garage/garage.js":"1494538cdbfa306c","garage/import.js":"680eb5dad63bf3d7","dice/":"ea53c514cacffab2","dice/index.html":"ea53c514cacffab2","dice/dice.css":"cf78ddf1b0304757","dice/dice.js":"48bede9fa1a4e0f1","petcare/":"d6d915a23012ba5f","petcare/index.html":"d6d915a23012ba5f","petcare/search.js":"fb8714679a7890dd","petcare/core.js":"d944a056fac6a523","petcare/house.js":"f1dd1b42dd3d3827","petcare/petcare.css":"4fe7c5495dd5c0a8","petcare/petcare.js":"0d3d707d4ef3627a","wheel/":"2e9bbcfe593150e8","wheel/index.html":"2e9bbcfe593150e8","wheel/core.js":"78a8b8469df9d646","wheel/view.js":"15836471fb141ca1","wheel/view.css":"ca3b784cd322b579","oracle/":"b8bab66955f42cc2","oracle/index.html":"b8bab66955f42cc2","oracle/oracle.css":"53e7e8ad4d7b7fcf","oracle/prophecies.js":"6f2508d89ffd99d5","oracle/oracle.js":"3d2584a711eda9aa","oracle/help.en.txt":"6b0ef3cf0e0a2012","oracle/help.el.txt":"7cf41e3e853c7c3b","slides/":"5394054360f6b673","slides/index.html":"5394054360f6b673","slides/search.js":"897806e859da98f1","slides/odp.js":"cef56c448ff106a4","slides/mdimport.js":"8b9a47356a547445","slides/slides.css":"fae3ceccca7e0e23","slides/core.js":"48a9ffc12562fc68","slides/dk.js":"734aec18fea512a4","slides/app.js":"c5d21880867ce0de","slides/editor.js":"c01d09a7eac4ae01","slides/text.js":"ccc935f11eb63e42","slides/panels.js":"69ea357c187e8c4f","slides/io.js":"165e03a931aa94ec","slides/help.en.txt":"36b579c9a7b14539","slides/help.el.txt":"76c36ba9e91eadfa","baby/":"d1a54d9976b891fb","baby/index.html":"d1a54d9976b891fb","baby/search.js":"a0fbd534a83b2a3f","baby/baby.css":"9c6d7d9d606dcdec","baby/core.js":"1a63bf8e2e828529","baby/house.js":"6e7f38115c755a00","baby/baby.js":"6456d95a3c28b51c","baby/import.js":"df4fe0d7ad2c980a","passwords/":"a02be70b449b5e91","passwords/index.html":"a02be70b449b5e91","passwords/passwords.css":"feafe6c685a9a852","passwords/passwords.js":"88301eaeddeeb3d0","passwords/pwcore.js":"8f52b776f9ccc07e","passwords/words-eff.js":"3a17072de1e2e0b5","passwords/common.js":"d31abf3c0af092a0","device/":"1709dac4eedf33d5","device/index.html":"1709dac4eedf33d5","device/core.js":"16a1bcaa0da1a9e5","device/view.js":"872f31c51dede94b","device/view.css":"681099e6975a9f02","assistant/":"9ff92801a3b43dea","assistant/index.html":"9ff92801a3b43dea","assistant/assistant.css":"717d214b2c0e4b24","assistant/doctext.js":"c27facb26a11a176","assistant/core.js":"59847680b20e5e78","assistant/claudefiles.js":"f4c14ad2342ba6ec","gate/filecopy.js":"7a5a8401ce3a5c6a","assistant/imgai.js":"8386d7e76de83d77","assistant/summary.js":"24e66fa3c0a1b993","assistant/assistant.js":"d208c083814527d5","assistant/import.js":"08bb415e1eaa7ab9","assistant/webllm-worker.js":"1db8a657e117eed7","assistant/help.en.txt":"8c7e21ddf91f207e","assistant/help.el.txt":"1b5abdce741a8f39","share/":"1e2663fe1ef93b88","share/index.html":"1e2663fe1ef93b88","share/share.css":"c8dc51dcafa566ae","share/kinds.js":"d2a8e952dff188e6","share/send.js":"44520d0191f26a6c","share/view.js":"2c5cd6c897784ed2","share/relay.js":"d672324e2920af0e","share/out.js":"147fb3551f79a407","share/album.js":"596f6d75ff536d48","send/core.js":"b9268a1629ed3dac","send/detect.js":"9adc52338c8ca1b0","send/sheet.js":"d89a1cd273f7a413","commands/core.js":"3cc2b2cf6159f631","commands/bar.js":"340fa050592443a9","settings/":"f536da8357224571","settings/index.html":"f536da8357224571","settings/settings.css":"0ac33b2f3b483c3e","settings/core.js":"357df2a9d5d04cdd","settings/report.js":"6fc2b8442661c495","settings/settings.js":"ddc996aa65d62645","settings/translate.js":"d41773a4b22e8527","settings/search.js":"e0012620e0ada9a2","settings/fonts.js":"46f2627ee0cbe9e8","settings/fonts.css":"eb76c3be8eae0fe1","settings/screentime.js":"5e1781623699e0e0","settings/screentime.css":"c0f3213d8b8835e9","settings/help.en.txt":"5034979128105119","settings/help.el.txt":"7321da0b68495793","startpage/":"4466017aacc7ba04","startpage/index.html":"4466017aacc7ba04","startpage/startpage.js":"bc52352ce86c0d44","startpage/startpage.css":"5a39208b5c4b181f","today/":"f4244fce15dd5565","today/index.html":"f4244fce15dd5565","today/today.css":"a2b61cde75d63598","today/today.js":"b20c2653841aef8a","today/agg.js":"57362e82c9f64ba9","today/host.js":"132fa0f42d421344","today/help.en.txt":"cd1f318a83db3754","today/help.el.txt":"e4f69689bfb0af90","automations/":"e611d896f118ed36","automations/index.html":"e611d896f118ed36","automations/app.css":"2cf591a8e7cf8669","automations/app.js":"188b46b55c966087","automations/core.js":"a22c3f4f354b2e5a","automations/host.js":"dad19719f41770f2","automations/hookin.js":"b2d125c31898dc7c","automations/bridge.js":"2730ae71de43f7ff","automations/search.js":"ef459e86951c1c36","automations/help.en.txt":"0cd4c53a8979076b","automations/help.el.txt":"3a5628d16f75f752","calendar/occur.js":"18a6579351b53902","todo/core.js":"eba511210e48cd9e","quote/core.js":"3ffc6cab3c6aa3d7","kanban/core.js":"15707f4b40f04846","contacts/dates.js":"c0425b0ff2dc3aa5","contacts/vcard.js":"56afb12f5a959d37","contacts/dav.js":"6b64f56c22b3c017","todo/today.js":"784645688c26c561","kanban/today.js":"566406cd987be5ba","contacts/today.js":"be177ea9b94583f6","contacts/importplan.js":"d14f756e8312c1bd","contacts/accounts.js":"c16a303b5eb65011","contacts/oauth-callback.html":"dd50abab1bf83f3c","contacts/oauth-callback.js":"41c37bb99d34b2b2","habits/core.js":"90702acac97c78a6","mail/today.js":"3a29c1af17eecfc9","meals/today.js":"182cbadf12638cc5","budget/today.js":"9d504d35b00e8e1b","health/today.js":"c764822d622f2bc1","fitness/today.js":"7797ebc5744b5b00","habits/today.js":"6037a96e7bfcd301","cycle/core.js":"2e7221b903eddfa5","mood/core.js":"393ed8f5bd9dea51","minimalism/core.js":"507ef03f4d181514","cycle/today.js":"107f804542be07ea","mood/today.js":"19219e20bccc3ae1","minimalism/today.js":"87a01a1c0d4d9060","familytree/today.js":"20f0c9d9adc924fc","weather/today.js":"25dd1d1efc6972c7","time/today.js":"d43826c146cfe60c","calendar/today.js":"5b37392f2ad6ea65","plants/today.js":"1cc5388fbb0b36c9","chores/today.js":"db91aa78cd0140b4","petcare/today.js":"25d97543cd22e06b","garage/today.js":"209a1920dcf6b581","travel/today.js":"d9e37bb40087d8e2","timesheet/today.js":"69d70594c20d8b14","shelf/today.js":"ffe689085e538086","water/today.js":"9c1f903ac51a2678","baby/today.js":"a1fa1fa19aebf62f","netizen/":"1d8c966667345802","netizen/index.html":"1d8c966667345802","netizen/netizen.css":"cdee33e126571f06","netizen/netizen.js":"3a7d2155142398f3","wallpaper/":"3ec405deeb9c77d1","wallpaper/index.html":"3ec405deeb9c77d1","wallpaper/art.js":"a5e69eb0d248182b","wallpaper/land.js":"26fd86505c3335fe","wallpaper/wxdesk.js":"e413db66a995c27c","wallpaper/wallpaper.css":"591d66ef6dabca25","wallpaper/wallpaper.js":"86c5f3ea40858d6b","trees/":"213fe2e29ba13ee2","trees/index.html":"213fe2e29ba13ee2","trees/core.js":"f3866bdbd20944f5","aura/":"1b7562568f24593b","aura/index.html":"1b7562568f24593b","aura/aura.css":"7dac210316d58b15","aura/core.js":"c42ed5d39251df80","aura/aura.js":"e2f5d8ec29fe4804","photolab/":"d94bba2c987cbf14","photolab/index.html":"d94bba2c987cbf14","photolab/photolab.css":"932ccbb3958085c6","photolab/core.js":"41534a3995a9c9fa","photolab/blendx.js":"fc8ca5032831fbb8","photolab/tiles.js":"3ed4eb78232bd396","photolab/history.js":"1c5e79eb41845b65","photolab/select.js":"e47de66260f5f183","photolab/guides.js":"d9c2579045f0f002","photolab/paint.js":"7775526d9bfa6650","photolab/resample.js":"6db539837449c1a0","photolab/warp.js":"90a22544ea8d9d96","photolab/adjust.js":"5cc5d9dc73c82782","photolab/filters.js":"8c9d972a061633f9","photolab/store.js":"40bd19b1baf75b7b","photolab/psd.js":"54bc0e3135cc84ae","photolab/psdinfo.js":"6ba926a262ea42b7","photolab/xcf.js":"453466f5f4a52f5d","photolab/ora.js":"f36992721aa52b25","photolab/xmp.js":"644d23117ddc46af","photolab/strings.js":"17227bef06bb93bd","photolab/app.js":"a4dd7f461dfdc4ae","photolab/view.js":"d5542d3db6073b9f","photolab/jobs.js":"641a947bf8b3fc3b","photolab/worker.js":"ec53b4af0777c990","photolab/tools.js":"666b457e8614c5e2","photolab/ops.js":"b44b00d6384733ec","photolab/io.js":"f9976abcfe9a3b9a","photolab/home.js":"95d41a26bd51266e","photolab/panels.js":"8839047ebba87da0","atelier/":"6ee72924b943955a","atelier/index.html":"6ee72924b943955a","atelier/search.js":"ca9e5fafdc20a57a","atelier/atelier.css":"b9f3c3e42af51b32","atelier/library/icons.js":"0eb6b09ebc640016","atelier/presets.js":"22d9414b8a1d3944","atelier/templates.js":"a3ac28a1e4e673f8","atelier/ax.js":"007b12d9b68a22b5","atelier/blend.js":"fdaf7dcdf54156c2","atelier/vector.js":"c7b7a350cba3ec57","atelier/svgin.js":"fdb6c27a554c45ef","atelier/pdfin.js":"afb0c3edc1d930a8","atelier/canvafx.js":"e4126326b380ab2f","atelier/anim.js":"5c3941a22ef94028","atelier/morph.js":"b380d27c8bf4565e","atelier/core.js":"14ea40535e699454","atelier/photofx.js":"c143d126ad5af0eb","atelier/draw.js":"daa43aa787140938","atelier/editor.js":"ff53657a9f6cc8d8","atelier/panels.js":"437bac1dc431bc95","atelier/sources.js":"2f5515ad0ce14382","atelier/fonts.js":"947f12bab41642df","atelier/brandkit.js":"78a491c64eb9f8dd","atelier/style.js":"6768af3206b1b9e4","atelier/swatches.js":"02bbb051cd25f45b","atelier/brand.js":"448b853cf7a25296","atelier/folders.js":"1d6b0b91cb6f54cf","atelier/homefolders.js":"eb82c2d8c226b05f","atelier/relayout.js":"240817739b848e32","atelier/aitext.js":"2e721ef1048097c0","atelier/cutout.js":"f1462a2056eabace","atelier/inpaint.js":"4a858ab600fede1d","atelier/ai.js":"93f336e24f7aeca4","atelier/editpic.js":"5a7df43ba3905b28","atelier/magic.js":"363890a3f6f49b62","atelier/imagine.js":"479e9eecefd0eae7","atelier/magicai.js":"b9b475cedb5ba194","atelier/magicdesign.js":"46dc7f0c2649598f","atelier/collage.js":"387b705715cba2f4","atelier/bulk.js":"4aff52ca1338409f","atelier/kit.js":"db443526f57cd6fa","recipes/core.js":"c4af9f0cd52b9643","recipes/ui.js":"8c675c63908d3d6b","recipes/share.js":"ada549e93ee8fe40","atelier/recipesteps.js":"4645419ac1c44679","atelier/recipes.js":"e737f344bb40f0ce","atelier/commands.js":"fb6ca18259fe821c","atelier/assist.js":"9c961a4b7de9c2ee","atelier/clips.js":"257942806d04d679","atelier/video.js":"b3f0202b1fb67ed7","atelier/gif.js":"0871f1ed47b93cc2","atelier/gifdec.js":"61254352118e7da8","atelier/motion.js":"c1291a15f53910fe","atelier/zip.js":"7aad95973aaee2e1","mockups/":"94ea039826bfa8f3","mockups/index.html":"94ea039826bfa8f3","mockups/mockups.css":"80266dd8d54adc3b","mockups/core.js":"2a51846f54e59909","mockups/print.js":"fb996ded8f20cf00","mockups/scene.js":"781985c3ce8f1199","mockups/surface3d.js":"aaba159e065ffa74","mockups/goods/media.js":"0b6f8e9b44b6a1f6","mockups/goods/media3d.js":"cbd1bb105ceb51f7","mockups/goods/analog.js":"629485400927634f","mockups/goods/analog3d.js":"5ec82e85474cfc8f","mockups/goods/small.js":"71c44eac9bd411ed","mockups/goods/small3d.js":"1e944f31384a2104","mockups/goods/home.js":"d638fddf8021c20c","mockups/goods/home3d.js":"2be95d77cca9a42d","mockups/goods/cloth.js":"c06d6905e3ff53f0","mockups/goods/cloth3d.js":"8816141981f1606b","mockups/goods/combo.js":"f3f8ed9651255e07","mockups/mockups.js":"f4cb8b6f13ab6c63","mockups/commands.js":"4ffd905df8e13bd3","mockups/assist.js":"0839ca3bd914a478","mockups/search.js":"ca522fba6bdfe8c2","mockups/help.en.txt":"7e56053ef039ed51","mockups/help.el.txt":"6d19417afefd9bc7","vendor/three/three.module.min.js":"e2b5ee6bccd38fd6","vendor/three/three.core.min.js":"61ba0df005b05991","importkit.js":"7f7a69db43f8249d","emptykit.js":"effacf9c14361992","emptykit.css":"c8553896a64d5788","emptykit-ex.js":"5a313a2224c9c51c","vizkit.js":"969ea8cb8f064e67","bundle.js":"6e526975708002f2","recordpkg.js":"0a289aef891f614b","habits/package.js":"97660f79cb9afab6","water/package.js":"6e04c55d60c225c1","chores/package.js":"0b8f1709b6aa7ce5","scores/package.js":"0a5f860e3aff497e","cycle/package.js":"a093199414bb9396","mood/package.js":"a8482da9c40e49e9","calendar/package.js":"f140ce5993f2638e","contacts/package.js":"46719202c9569dd7","bookmarks/package.js":"4d5a23df4a99fa58","feeds/package.js":"f6c50e9d2c9d9798","podcasts/package.js":"c1549d4a0983886d","meals/package.js":"979cc5104566b19f","stickies/package.js":"630ec54c517b5999","crm/package.js":"5b6475741d72acb7","quote/package.js":"d8909c27dc20fc33","timesheet/package.js":"3749d7055e8fdfff","stock/package.js":"76be5d0a61b0314c","budget/package.js":"552883d50e04a99b","invoices/package.js":"ad753843cf451b8d","invoices/acctpack.js":"e53e113ebae8a9c5","invoices/pdfin.js":"6295b63d13d8ba98","budget/links.js":"9905d8b7299525f0","budget/shop.js":"ecaffcd38afcf8a8","split/package.js":"35223c062ccdb9cf","diary/package.js":"0767f6b6df5617a3","health/package.js":"4e2b9ad40de4f52e","fitness/package.js":"cc75e8f9316df593","baby/package.js":"90dc7579144d99c1","petcare/package.js":"94959b9d5d134984","plants/package.js":"135a6c20ce34d554","garage/package.js":"253afc38cba1d045","library/package.js":"00a86f44abb5231e","shelf/package.js":"4d4536979a38ab2e","signature/package.js":"86929a497bdb9263","newsletter/package.js":"fbefe25708502aa1","storage/package.js":"7c1e95a405f37044","converter/":"738b12ee4cf8a364","converter/index.html":"738b12ee4cf8a364","converter/converter.css":"acdc8fc56d669c54","converter/registry.js":"f21dd4b85a42a738","converter/core.js":"7ac2a507e4af2aed","converter/converter.js":"7c70582445bb804b","converter/help.en.txt":"200f4e2a43307373","converter/help.el.txt":"5f27f3d123052718","flashcards/":"479058f7a4810cab","flashcards/index.html":"479058f7a4810cab","flashcards/app.css":"015bd64cbe60fb36","flashcards/app.js":"e27d8a863474914e","flashcards/core.js":"e5504635b61694a0","flashcards/fsrs.js":"431fe670534716f8","flashcards/media.js":"0d610666ad4c229b","flashcards/sqlite.js":"c7f90bd02ba9a6df","flashcards/anki.js":"6c0412f52ad53446","flashcards/make.js":"4da27c98db428686","flashcards/due.js":"f1d50b0c64194e45","flashcards/today.js":"bd1d018b20b75344","flashcards/stats.js":"d255dca976c5c0dc","flashcards/package.js":"fa18e3a33faf3b19","flashcards/convert.js":"38d7c86a3c10de63","flashcards/search.js":"bb2fb135bcfe5a4d","flashcards/help.en.txt":"a730b75f7a0497f9","flashcards/help.el.txt":"9e3835bf616e1537","typing/":"754208b4513510d6","typing/index.html":"754208b4513510d6","typing/app.css":"4263b9c648aaa6ac","typing/layouts.js":"6db39f10163009de","typing/words.js":"73d7956b3ab326a3","typing/course.js":"19457e59158d7eb9","typing/texts.js":"4fde5c922871db70","typing/core.js":"353d3e5da4f1ce6f","typing/due.js":"29bcc393e281db52","typing/today.js":"3d73c7aa803d90b3","typing/search.js":"92433eb9bde71777","typing/rain.js":"582b5cc60272fb9f","typing/app.js":"bcda23a42a9e65e5","typing/help.en.txt":"9e143420e6e933cc","typing/help.el.txt":"ae9035f96c7ce1d8","scanpdf/":"15ec0fe59d5cc77c","scanpdf/index.html":"15ec0fe59d5cc77c","scanpdf/scanpdf.css":"c1f7f356965a5c9c","scanpdf/core.js":"c33d9973c8f7ac83","scanpdf/scan.js":"cf986783de3d9989","scanpdf/device.js":"a33a2705ce64b943","scanpdf/ocr.js":"507461b370e7d18f","scanpdf/pdfops.js":"5c4a2cd9ab97a92a","scanpdf/sign-core.js":"c30f1e50715a5dfc","scanpdf/today.js":"26024f95cca7472c","scanpdf/sign.html":"e944c589caa7d681","scanpdf/sign.js":"21cd9d0c85dfe6b7","scanpdf/sign.css":"8a8d8d70e6c20696","scanpdf/scanpdf.js":"8251dca6373828e1","scanpdf/search.js":"8ac7c3e29969fe6d","scanpdf/help.en.txt":"0f84c0939b44c1af","scanpdf/help.el.txt":"60be7e5b04967cbb","vendor/pdf-lib/pdf-lib.min.js":"2d8e83696f30f477","vendor/pdf-lib/fontkit.umd.min.js":"d8df561b9fba98e2","google-import.js":"914b1fe255256fc3","davkit.js":"e9df91993cc962fd","davsync.js":"93b6096ff02c7a43","enrich.js":"b9931d23024f55dc","enrichui.js":"32695942c745c9ee","atelier/pptx.js":"4ae747ca2f79e74e","atelier/pptxout.js":"7db415fbc9d7186a","atelier/canva.js":"9f470ce48c752a72","atelier/canva-callback.html":"bc7aa552b0f585c7","atelier/canva-callback.js":"dc4f3b84c2260aae","atelier/io.js":"01073aec9c5b6799","atelier/help.el.txt":"4278cb0ae287b98f","atelier/help.en.txt":"97d1bfc23b5ceb97","minimalism/":"24d11c06f6384cd6","minimalism/index.html":"24d11c06f6384cd6","minimalism/search.js":"920fa26eeff2c1eb","minimalism/minimalism.css":"64947560bd54c0cc","minimalism/minimalism.js":"570960536422d7fd","minimalism/content.js":"2c55ebca92ec87bb","split/":"606703e804f9b263","split/index.html":"606703e804f9b263","split/search.js":"7e9b9f07062d1262","split/split.css":"8af39995ddf859a3","split/split.js":"d520616cdd237e5d","split/import.js":"965e0c889fd28a84","split/house.js":"d8557056bf70e519","base/":"d85d447c23d45934","base/index.html":"d85d447c23d45934","base/app.css":"41e76b3cc0d676c8","base/core.js":"a859f0e9311fcf92","base/app.js":"ea075a707d414787","base/search.js":"cfa07b6216f0264e","base/package.js":"441fe64945675f91","base/feed.js":"0a9d2ccf66f0399f","base/today.js":"7573c0a42949242a","base/help.en.txt":"743607f983ee816e","base/help.el.txt":"6de3482e931e9ab4","spreadsheet/":"3cb736e556ee2624","spreadsheet/index.html":"3cb736e556ee2624","spreadsheet/search.js":"3d12aa330ea8db6e","spreadsheet/spreadsheet.css":"502b19a3fd4d2205","spreadsheet/spreadsheet.js":"7875e527976c63b1","spreadsheet/sheetimport.js":"e4a276de3a86ecf7","spreadsheet/convert.js":"0d9f1d08ad891aed","spreadsheet/platforms.js":"8c6245701636d295","podcasts/":"10a4f61b6eae3eb1","podcasts/index.html":"10a4f61b6eae3eb1","podcasts/search.js":"e7fa9f0314490d36","podcasts/podcasts.css":"a7c5884f4ba69b28","podcasts/core.js":"29447a16ee863bae","podcasts/store.js":"97a72252d894cc0c","podcasts/host.js":"4fd3df0d974ee05d","podcasts/podcasts.js":"1e96b48599a896c1","music/":"47770160523bdde0","music/index.html":"47770160523bdde0","music/search.js":"3fe6e2b80949e9fa","music/music.css":"5a0a07d301c496ca","music/core.js":"09114ad79e92f98b","music/store.js":"169db16e18397211","music/host.js":"0ebaeeea192bfcc2","music/library.js":"d7b5c84687364f30","music/open.js":"b6f3b5c1686bd1b6","music/artists.js":"2d2ea6598db72072","music/lb.js":"28043af33edd4c4f","music/servers.js":"b61d9dfde1f0cf9d","music/mixes.js":"a9ce76dfbc95032b","music/music.js":"a3b498ae644128b1","music/today.js":"afa6a1dd59ae89b8","radio/":"a2e7cafbf5409194","radio/index.html":"a2e7cafbf5409194","radio/search.js":"e00e86ee9dc50f83","radio/radio.css":"b7b2e3c32c8e0cf5","radio/radio.js":"325aab15ed699f78","radio/import.js":"f2cb743796a63af4","mixer/":"1bb055f93a7c45f1","mixer/index.html":"1bb055f93a7c45f1","mixer/mixer.css":"823752ac46e90d2a","mixer/mixer.js":"2787d7fef97da141","mixer/engine.js":"fed62a4ea80e6452","ringtones/":"34176e3a5b3f6390","ringtones/index.html":"34176e3a5b3f6390","ringtones/ringtones.css":"0ec44efbc84e30fd","ringtones/core.js":"588e23ed811198f9","ringtones/ringtones.js":"9aee8dd4c23d20c7","ringtones/search.js":"c3d5fe4436cb9974","studio/":"875e01a8784785c8","studio/index.html":"875e01a8784785c8","studio/studio.css":"77ca76e8aa6c1804","studio/core.js":"02adeccd9624f7c5","studio/studio.js":"8ab3ac18746293cc","studio/package.js":"329b03619081809b","studio/commands.js":"7d1f72c7cce284a5","studio/assist.js":"c48b2ae1eafde74e","studio/rec.worklet.js":"ef78141599f8d81b","studio/fx.js":"b1a0d9ef8fd74643","studio/remote.js":"dcbabe2e23445d4d","studio/nullfx/runtime/eel-rt.js":"c1b7f4ddc7e0f7d9","studio/nullfx/runtime/null-fx.js":"161a1c23053bcd90","studio/nullfx/runtime/null-gfx.js":"4c3b2af0c404c2b0","studio/nullfx/runtime/null-node.js":"44d015a11dfb3737","studio/nullfx/runtime/null-worklet.js":"20f7a45edfaf894b","studio/nullfx/fx/index.json":"3537bae71fc28112","lyricsync/":"aa48ee171e569054","lyricsync/index.html":"aa48ee171e569054","lyricsync/app.css":"355782a766806039","lyricsync/core.js":"f12101521c6638d2","lyricsync/formats.js":"85ac8e8c9b1b815a","lyricsync/wave.js":"28f8943c1ea405a4","lyricsync/id3.js":"4fc4bdecf1490f4c","lyricsync/align.js":"334f99bb5890b2bc","lyricsync/chords.js":"6e012a5690e7abfe","lyricsync/sets.js":"e60a57512afd8097","lyricsync/diagrams.js":"161ffe3db0fc696c","lyricsync/sheetpdf.js":"92250875c05c137f","lyricsync/app.js":"c6ddf6823f22a3f0","lyricsync/search.js":"f4d4b99e5be02ab8","maps/":"7bf7dfa4f27854e8","maps/index.html":"7bf7dfa4f27854e8","maps/search.js":"5a74fcc0fab16984","maps/maps.css":"d847f8f4eabedaad","maps/route-core.js":"32912356e14d8bc8","maps/tools-core.js":"98854b1a333a7388","maps/transit-core.js":"e11e0aeed599c1ab","maps/transit.js":"3e4b46fd9a1a3a43","maps/tools.js":"10c035a378a23e72","maps/where.js":"e9c6ed6c689fc7b5","maps/planner-core.js":"efca3846503c4b38","maps/planner.js":"12523eddd5a0f826","maps/fav-core.js":"e0cf470bb936b9c3","maps/fav.js":"214e3c734bb7ce4a","maps/hh-core.js":"b1602ad20cd13705","maps/hh.js":"2059a7ec274feaec","maps/discover-core.js":"ed668874411cea86","maps/discover.js":"2379fd9734ce680f","maps/maps.js":"6a93bc9a2656c1ef","maps/import.js":"593b1282b824451b","maps/import-ui.js":"eca62b809e3379aa","maps/package.js":"8a75750f89cc1afe","maps/package-ui.js":"d148990ad13cbcd2","maps/osm.js":"0e6ac25396243e6a","maps/osm-api.js":"8911a6d49eadfe55","maps/notes.js":"b9d0751b365ab94c","maps/osm-callback.html":"912abe1d956e6c8c","maps/osm-callback.js":"787e43e96de672cb","maps/poi-core.js":"c5e823383dd1f0a0","maps/everydoor-core.js":"8d056d544a553932","maps/poi.js":"da7fa565d725d745","maps/entrances.js":"e26c01dedca62582","maps/presets-data.js":"cdb2f107c9783745","maps/tracks-core.js":"395b5fe47b9898b3","maps/follow-core.js":"a1e70f7117891890","maps/where-core.js":"c3fcb54821257d93","maps/tracks.js":"14ebd85d930133d5","maps/heat-core.js":"96b23effc7f11522","maps/heat.js":"8716e907cb34ca13","maps/heat-worker.js":"041a300ece220fbb","maps/quests-core.js":"91019968592c29ae","maps/overlays-core.js":"c61974d76864c682","maps/quests.js":"d80cdefcfa37ac51","feeds/":"369515193276780a","feeds/index.html":"369515193276780a","feeds/search.js":"88fb1035ac7c2abd","feeds/feeds.css":"3713ff9c5d3af76a","feeds/core.js":"46d7dd79c32015e2","feeds/sanitize.js":"9990e65745bf39eb","feeds/fetch.js":"e1856f83588f5730","feeds/extract.js":"9f5ee5996262e2e7","feeds/feeds.js":"0238c48a5b5f9b76","feeds/youtube.js":"405e977db78234d4","museum/":"56261cbffb9c8c51","museum/index.html":"56261cbffb9c8c51","museum/museum.css":"b94ed2ee7a287304","museum/core.js":"3fbdfa14e562ea91","museum/museum.js":"53cc811e08c26cca","museum/help.en.txt":"4178dff7435e143e","museum/help.el.txt":"ced97a293fee29ec","vendor/leaflet.css":"803b85dd520f925d","vendor/leaflet.js":"db49d009c841f5ca","vendor/mediabunny.min.js":"9fb60523f8b2fecc","calculator/":"4f438759adb90243","calculator/index.html":"4f438759adb90243","calculator/calculator.css":"e78f414cf3bcee66","calculator/calculator.js":"fff004979921b02e","texttools/":"a70f8bfa57f75eeb","texttools/index.html":"a70f8bfa57f75eeb","texttools/texttools.css":"2d4bed667645d771","texttools/core.js":"d0d845ce8ccb8698","texttools/texttools.js":"f24245e6613809e0","texttools/worker.js":"eeb675e0609400da","translate/engine.js":"7e2edfd2d85b7d3b","translate/worker.js":"b4ea7b1707a682f9","translate/panel.js":"0e9d9ec06dbd418c","units/":"f4b15092aaa157f7","units/index.html":"f4b15092aaa157f7","units/core.js":"a51bfc9056672b11","units/view.js":"36e10ea199333e04","units/view.css":"6d1b45da4db9ccab","units/search.js":"ace11161a9bcfbe0","stickies/":"1a35061243b97a44","stickies/index.html":"1a35061243b97a44","stickies/stickies.css":"08593d880f82515e","stickies/core.js":"a6bcb9f7eef3f51a","stickies/host.js":"3fb67c258a5800a9","links/core.js":"d824a1c6661ce33e","links/host.js":"ce7be7113548088e","gate/gate.js":"72951ad0d9f6641c","links/woo.js":"85a68e1ce292f3df","links/mydata.js":"4b2435746ae66bd8","links/mail.js":"57a013f917fbf35a","links/crm.js":"0567f07ff90ffd45","links/todo.js":"0b74f65853323d76","links/timesheet.js":"eb0c3a104395dca9","links/kanban.js":"2230df842545a673","links/bookmarks.js":"dff1b84446e37082","links/notes.js":"c2e02a40b0f5c9c3","links/sheets.js":"be0b711c0a00e588","links/pay.js":"b3cfb25201f6a0b8","stickies/stickies.js":"0c0d21d2803308e7","stickies/search.js":"93207f636e67b67a","stickies/today.js":"8249f2c96f1b26e0","pad/":"acb2112f27bd16d0","pad/index.html":"acb2112f27bd16d0","pad/app.css":"823c0b1264274892","pad/core.js":"09d7886a5ab909fd","pad/search.js":"5ffc366b333d03f3","pad/eel2.js":"d558c37ac9ebcffc","pad/app.js":"0a179f6b3c79f905","pad/devui.js":"aab786eda4a462df","pad/devtools.js":"88d6366a0bf717ce","pad/regex-worker.js":"8a30b5bf2d119879","textcase/":"d3d067e57dd9389b","textcase/index.html":"d3d067e57dd9389b","textcase/core.js":"b5e8b05316cf7c1f","television/":"d84fd083c5dccc98","television/index.html":"d84fd083c5dccc98","television/search.js":"093e85853a9e6c12","television/television.css":"9aa76a7a1b6b1b84","television/television.js":"b2297f280f466947","montage/":"93ed7e21e0ad2b30","montage/index.html":"93ed7e21e0ad2b30","montage/montage.css":"d8ee7e69a3f62a24","montage/core.js":"7c79700f90f18539","montage/hash.js":"fa28f127846947a6","montage/gl.js":"9d2f1ab7d095884b","montage/media.js":"557398b8b8af610c","montage/player.js":"c7ae9223f5cee3fa","montage/export.js":"91bb7d290cb3ba85","montage/montage.js":"3580f09224b3ba3a","montage/package.js":"4223e6ce1b92e2bf","montage/search.js":"56281e9ebe8b41df","montage/commands.js":"6f9fb520268b66a9","montage/assist.js":"5ec479d68fcf3cb7","capture/":"90c14190ee9c4796","capture/index.html":"90c14190ee9c4796","capture/app.css":"7638f7de50de20dd","capture/core.js":"496f6ecb0fbefdde","capture/app.js":"20ddbc29e9eadefe","memory/":"998af905f795e476","memory/index.html":"998af905f795e476","memory/memory.css":"b2d2fe6c9c382982","memory/memory.js":"bf408bb812d46056","connect4/":"95209ef031538f32","connect4/index.html":"95209ef031538f32","connect4/connect4.css":"d263b12f424b842b","connect4/connect4.js":"c3e8a83ff4246e5f","dots/":"49ea26120307a7bf","dots/index.html":"49ea26120307a7bf","dots/dots.css":"9c057d53f8b2499e","dots/dots.js":"9d51858f411e48e0","tictactoe/":"2e9b493d026c1870","tictactoe/index.html":"2e9b493d026c1870","tictactoe/tictactoe.css":"e56e9acbd4968b8a","tictactoe/tictactoe.js":"1eafa41a0904668b","simon/":"8e2848be98d70529","simon/index.html":"8e2848be98d70529","simon/simon.css":"a1d35f31f515d65e","simon/simon.js":"2ab80e31663e920e","slider/":"60be73943e4c5bd1","slider/index.html":"60be73943e4c5bd1","slider/slider.css":"a79fc794b7f84a29","slider/slider.js":"4998fd9d5a832736","lightsout/":"304bf5b85de279a4","lightsout/index.html":"304bf5b85de279a4","lightsout/lightsout.css":"e5456e85ca86e6bf","lightsout/lightsout.js":"f48fc57b35467a36","petworld/":"f5299828b07d36cb","petworld/index.html":"f5299828b07d36cb","petworld/petworld.css":"ddb591466477f848","petworld/petworld.js":"302ce945df54fe58","whack/":"eff6fc380a7dd4de","whack/index.html":"eff6fc380a7dd4de","whack/whack.css":"a0834edc6d3d7278","whack/whack.js":"e7c5cead4defcbfe","snake/":"77c19f00e3c7d8a1","snake/index.html":"77c19f00e3c7d8a1","snake/snake.css":"1253c550b1c388a1","snake/snake.js":"b3c15cbbfc736ab4","g2048/":"fdc05bb4b0a86aff","g2048/index.html":"fdc05bb4b0a86aff","g2048/g2048.css":"1973b29086351202","g2048/g2048.js":"94f7c66250288c89","scores/":"2d83599e7179677d","scores/index.html":"2d83599e7179677d","scores/search.js":"bea683829dd2f861","scores/scores.css":"73cc3160bd5b5867","scores/scores.js":"48054e777ffa67b5","scores/import.js":"1c2cc4fc6b102de8","wordsearch/":"756f0d48712aa34a","wordsearch/index.html":"756f0d48712aa34a","wordsearch/wordsearch.css":"409bcfe2897b7ad6","wordsearch/wordsearch.js":"136838410126771e","wordsearch/words-en.js":"77db4c8622711f0c","wordsearch/words-el.js":"54e0ec355fb59dcb","solitaire/":"d373decf078f6a19","solitaire/index.html":"d373decf078f6a19","solitaire/solitaire.css":"83828636e85fc3d6","solitaire/solitaire.js":"d4476828d85a578e","cardkit/cardkit.js":"56be1a5faedb9d25","cardkit/cardkit.css":"89f856bdee6bfaa8","jigsaw/":"84d9ba2d81739c9d","jigsaw/index.html":"84d9ba2d81739c9d","jigsaw/jigsaw.css":"0bd4544d498af761","jigsaw/jigsaw.js":"e67f97ba5a23bb68","crossword/":"b3425c6ec65875dd","crossword/index.html":"b3425c6ec65875dd","crossword/crossword.css":"b52838159a8e7282","crossword/crossword.js":"4722ab1cd0767aa6","crossword/import.js":"234954435fb88be5","xeri/":"73df63a9c69df4cb","xeri/index.html":"73df63a9c69df4cb","xeri/xeri.css":"0b3b71db56fcd8ce","xeri/xeri.js":"e43e0d54c9ed8d33","realm/":"2db46f0bb2302ca0","realm/index.html":"2db46f0bb2302ca0","realm/realm.css":"452be24c5ff90bf3","realm/engine.js":"ec09f550bd82f6d1","realm/campaign.js":"1f18071b3ed15c19","realm/realm.js":"6022c643687c4fce","banner/":"3a030e68a94205df","banner/index.html":"3a030e68a94205df","banner/banner.css":"58b28078c8755afd","banner/cards.js":"00dff6b83b35b929","banner/engine.js":"07c80b43bcd1ae7a","banner/puzzles.js":"c69a612c736a7b5f","banner/banner.js":"9f152daafd495a73","crypt/":"3c940e789fe8435e","crypt/index.html":"3c940e789fe8435e","crypt/crypt.css":"e322752108581ec2","crypt/items.js":"a67c04866a9e171e","crypt/engine.js":"04abd59b01f7790c","crypt/crypt.js":"503b877dbdf55e97","fieldwarden/":"ea9a30f78f3e3dec","fieldwarden/index.html":"ea9a30f78f3e3dec","fieldwarden/fieldwarden.css":"4350a3e687646da9","fieldwarden/data.js":"e2b53bba7c9abc98","fieldwarden/engine.js":"b61d2743cfe27499","fieldwarden/fieldwarden.js":"b8e232b51e74394b","roots/":"ab263a22a1afa722","roots/index.html":"ab263a22a1afa722","roots/roots.css":"614fa8c1af951f28","roots/engine.js":"9b01360ea57dc983","roots/roots.js":"e5c043529015e518","hive/":"e0d8d61f66324908","hive/index.html":"e0d8d61f66324908","hive/hive.css":"afac2a38819f3949","hive/engine.js":"d9a6dc7ab40619c9","hive/hive.js":"17c8bc2bd38a8bd9","lighthouse/":"4fb28608bf9e1114","lighthouse/index.html":"4fb28608bf9e1114","lighthouse/lighthouse.css":"a9ae74a3a6c78f96","lighthouse/engine.js":"739c88fe23d6b3c3","lighthouse/lighthouse.js":"c0c8871d199f8b01","ridge/":"1a94e4850d2ddf46","ridge/index.html":"1a94e4850d2ddf46","ridge/ridge.css":"a66281b19b450f83","ridge/engine.js":"2aaff900347a4744","ridge/ridge.js":"ba4e76d2e4323b31","maze/":"d40643704bdf00e3","maze/index.html":"d40643704bdf00e3","maze/maze.css":"ee023baaa92db578","maze/engine.js":"c385c88973062d07","maze/maze.js":"7901a04a9b923afb","caravan/":"c2348454c44359e3","caravan/index.html":"c2348454c44359e3","caravan/caravan.css":"60e9429bbce1acde","caravan/engine.js":"a1f3dfb33cbcc42e","caravan/caravan.js":"f1e294498099a49b","orbit/":"0599f7bdff24c211","orbit/index.html":"0599f7bdff24c211","orbit/orbit.css":"1e51f89e8e14b16d","orbit/engine.js":"904cf261f61a069a","orbit/orbit.js":"98944bf8b60237cd","starchart/":"1b74b3f5b2708a9d","starchart/index.html":"1b74b3f5b2708a9d","starchart/starchart.css":"0644d43fa6ca61fc","starchart/engine.js":"756c7de337569a85","starchart/starchart.js":"e15116edff2aa020","clockwork/":"71156fe62442ad0e","clockwork/index.html":"71156fe62442ad0e","clockwork/clockwork.css":"e15897acbad66c02","clockwork/engine.js":"43e686a838cc8d4f","clockwork/clockwork.js":"422374eed16a702c","wayfarers/":"4dec6d4d46489801","wayfarers/index.html":"4dec6d4d46489801","wayfarers/wayfarers.css":"49202f5fc448f0b5","wayfarers/data.js":"5c8655f754864b52","wayfarers/engine.js":"c63d59d55d899736","wayfarers/wayfarers.js":"6efbf0ec2d0ff317","wordle/":"aead83ffc8e57494","wordle/index.html":"aead83ffc8e57494","wordle/wordle.css":"35f87b92e04128a5","wordle/wordle.js":"04e18a366041beab","wordle/words-en.js":"754f65a8a33a2839","wordle/words-el.js":"2875a091b9628ff3","backgammon/":"8548392fe6c4a49d","backgammon/index.html":"8548392fe6c4a49d","backgammon/backgammon.css":"426a2722b3a63897","backgammon/backgammon.js":"0ffa235b0616085e","battleship/":"5c28769a6356ef86","battleship/index.html":"5c28769a6356ef86","battleship/battleship.css":"faad2690bfc83e8f","battleship/battleship.js":"4a395baab4991b36","breakout/":"1c694ec5cf426088","breakout/index.html":"1c694ec5cf426088","breakout/breakout.css":"935c445fe1244b3a","breakout/breakout.js":"1382d5d908376d94","bubble/":"0d9ba0cb8891b324","bubble/index.html":"0d9ba0cb8891b324","bubble/bubble.css":"c55eaa0f7587762e","bubble/bubble.js":"b7879804ee82a4f1","budget/":"5008c43f58c49c92","budget/index.html":"5008c43f58c49c92","budget/search.js":"bb1b41d76156f6dc","budget/budget.css":"37dede556489a45a","budget/payments.js":"6804db162aa8920b","budget/budget.js":"cccc728e783fed4d","budget/import.js":"9fcae52ec074b160","budget/feed.js":"394174e59228c725","checkers/":"691a37bc1340a882","checkers/index.html":"691a37bc1340a882","checkers/checkers.css":"4bafd88d51dbf82c","checkers/checkers.js":"4ec050c2a6abdea0","chess/":"f8a392e312fe8d1f","chess/index.html":"f8a392e312fe8d1f","chess/chess.css":"f3db618121785062","chess/chess.js":"04795d1f9a9befe9","chess/lichess-callback.html":"4c15cc4e9e7ecdf7","chess/lichess-callback.js":"0fdccfdbfc76cb14","familytree/":"a23ec6eb38af8bb2","familytree/index.html":"a23ec6eb38af8bb2","familytree/search.js":"9473de3d968f56c5","familytree/familytree.css":"e22975a8eedcf5bf","familytree/familytree.js":"b7e05aec5353b365","familytree/ft-core.js":"653410469ce9dcff","familytree/gramps.js":"5414d0c0a5ab5038","together/":"19bd296d735bb54d","together/index.html":"19bd296d735bb54d","together/app.css":"41b7e8632a28df70","together/core.js":"f65f4c4c1bc41adc","together/house.js":"c0853686095505e4","together/app.js":"fb139349d8da7cf6","together/search.js":"125dae06a526c306","together/today.js":"e97e236ed7f1884e","together/help.en.txt":"a06c4e5e187cc4ac","together/help.el.txt":"3bd3136694bc5141","household/":"ebb7a60e11703afc","household/index.html":"ebb7a60e11703afc","household/app.css":"6673a7be1145b925","device/screens.js":"81576a851737a6ce","device/screentime.js":"3dcbb2a6b27c0038","household/core.js":"32eb02df24261f0a","household/crypto.js":"31e6e5f53aecdadd","household/folder.js":"f5044b4f0c560797","household/backup.js":"cb794653d28bb9a5","household/recent.js":"bc0aba73ddeec0ad","household/engine.js":"f060a9b1ceff6e60","household/whole.js":"42548c00f281b041","household/share.js":"c54b615da5b3df18","household/group.js":"a07324f737f7e467","household/today.js":"fcd81191b069d78f","household/app.js":"6044775bc79596d7","household/search.js":"9125c87650080fee","household/help.en.txt":"19d23cebb9de1e9c","household/help.el.txt":"a349bfebcc9a9368","fitness/":"64dad8907a4212cd","fitness/index.html":"64dad8907a4212cd","fitness/search.js":"b3ee8e26d9c5339e","fitness/fitness.css":"d5027c5005a572cf","fitness/core.js":"a79326a5dd6c5871","fitness/fitness.js":"25ac733d447581da","fitness/import.js":"a6920b7f287f1d3c","flow/":"3168f9b1a3622173","flow/index.html":"3168f9b1a3622173","flow/flow.css":"a435c59f8c9e4292","flow/flow.js":"92f0504538d571bc","gomoku/":"28abd483232ee911","gomoku/index.html":"28abd483232ee911","gomoku/gomoku.css":"f3b11064c1aeef40","gomoku/gomoku.js":"67400d79bb60445b","hangman/":"7ad3a439adc01c6d","hangman/index.html":"7ad3a439adc01c6d","hangman/hangman.css":"3ba59562f6a197bb","hangman/hangman.js":"7e5d975d2ea35ba8","hangman/words-el.js":"e3399a1a9846452c","hangman/words-en.js":"a3c2882893d40c7e","hexagon/":"9d0e091353e148bc","hexagon/index.html":"9d0e091353e148bc","hexagon/hexagon.css":"5513f6e850a85f37","hexagon/hexagon.js":"f7f97ea3b2664c3e","mahjong/":"880271d3094a9373","mahjong/index.html":"880271d3094a9373","mahjong/mahjong.css":"bb23650186057732","mahjong/mahjong.js":"46bf154f0ba8f69d","mancala/":"cb219550e0bd488e","mancala/index.html":"cb219550e0bd488e","mancala/mancala.css":"5f0153337799436c","mancala/mancala.js":"6fbffe1fb2eb75a2","mastermind/":"19b01e12ba6c0d7f","mastermind/index.html":"19b01e12ba6c0d7f","mastermind/mastermind.css":"1d6ba9ca46f18f34","mastermind/mastermind.js":"9b19f17af5caaa36","minesweeper/":"b0e175a35044bfc7","minesweeper/index.html":"b0e175a35044bfc7","minesweeper/minesweeper.css":"5e592f2ac41e512b","minesweeper/minesweeper.js":"6b35f0c934e87514","nonogram/":"b31526b5f20e69d6","nonogram/index.html":"b31526b5f20e69d6","nonogram/nonogram.css":"e287a940d1ecc9af","nonogram/nonogram.js":"5f549c1f9d05cebb","pong/":"7893ab485745aa7b","pong/index.html":"7893ab485745aa7b","pong/pong.css":"4be01f34822209cf","pong/pong.js":"2d867ef7b02a6cca","reversi/":"5430dfb86b76412c","reversi/index.html":"5430dfb86b76412c","reversi/reversi.css":"c61bdad4d90c6a95","reversi/reversi.js":"295feb18965fca61","rps/":"6a9dde4f7e4c10f5","rps/index.html":"6a9dde4f7e4c10f5","rps/rps.css":"2c7a87522109ea0b","rps/rps.js":"6cb2881d000dd77a","spot/":"31e1d6ac2fb0a15d","spot/index.html":"31e1d6ac2fb0a15d","spot/spot.css":"a36de730ce72c9a2","spot/spot.js":"f2f0543642a1ec87","sudoku/":"a23fdf7109b2fa60","sudoku/index.html":"a23fdf7109b2fa60","sudoku/sudoku.css":"7b2a275470a0617c","sudoku/sudoku.js":"df670538d0fd2a1e","sudoku/import.js":"eb7c253ecb0298c1","tetris/":"a78df652cc4db8a0","tetris/index.html":"a78df652cc4db8a0","tetris/tetris.css":"2d611e86bfdb0779","tetris/tetris.js":"5f40c428b2b165f4","travel/":"79e783d5fa852d13","travel/index.html":"79e783d5fa852d13","travel/search.js":"51d2e35721e7ed8e","travel/travel.css":"b49e2ee4b1cfcb62","travel/travel.js":"b7e1b8c818eb8df2","travel/package.js":"8154f2d2ec9cc91d","travel/import.js":"17af95cd23307aa2","travel/core.js":"95a3b6973219ce07","assistant/edits.js":"882a87e9385950d5","assistant/create.js":"4e320fc1b9a16cf8","assistant/additems.js":"9adaf3da2c3afa5d","assistant/edits2.js":"e22c2c4dba9f2e75","assistant/edits3.js":"363e363ac0ec202a","assistant/edits4.js":"549fc04a0d57a530","assistant/fileops.js":"cd41d703c9c0585e","assistant/additems2.js":"64ba18a9b535799c","assistant/additems3.js":"b68be1c82d781825","assistant/links.js":"ba0859a7e449eebf","atelier/objects.js":"94df36c2999ae5b5","atelier/objui.js":"acf203f14c214bca","atelier/pdfout.js":"aede6630bb45cd82","atelier/webout.js":"b77c1af1aeee5a34","atelier/templates-more.js":"7e4344d12e8888f7","bookmarks/core.js":"246b05214f1fa6a4","budget/bank.js":"a2d440a02997a7ca","budget/bankui.js":"adc1d690ff456530","budget/bankapi.js":"cfe714be7531617a","budget/banklive.js":"67cc6483896e6a73","budget/bankback.html":"a57d64322c6f9ca3","budget/bankback.js":"774000aa86d78557","budget/plan.js":"8dc92e637aecfbbe","budget/planui.js":"cd24e82ae8e02d5b","budget/overview.js":"bd6233aaba11901e","budget/overviewui.js":"0cc1e86316b35338","budget/insights.js":"79e1f97fbcd49407","budget/insightsui.js":"a933167b06f61f50","budget/budgets.js":"be15dff98b8223a4","budget/budgetsui.js":"12f634947ac1f884","budget/caticons.js":"0245eab60059c1e6","budget/loans.js":"fc6d7c6b532809eb","budget/invest.js":"622810846ddefbe8","budget/loansui.js":"b1cb390269800ff0","budget/keypad.js":"1cb1a7c4a118da3c","calculator/core.js":"7caffeff81f5637f","calculator/search.js":"08ad01a352217c0e","calendar/free.js":"7bc1743f3085b56c","calendar/guests.js":"aa67d0e6eb7fc394","calendar/guestsui.js":"9edeef55437f18c6","calendar/rsvp.html":"e89e1b4ed77749e4","calendar/rsvp.js":"6875c0d67c84404a","calendar/rsvp.css":"e5dab98d529c4763","calendar/quickadd.js":"70f037369b528bf1","calendar/subs.js":"1d9a8a514d622772","calendar/house.js":"dddd2d198f0704c2","calendar/dav.js":"d71405ae73056db0","chores/house.js":"7cd0ef0198796bed","plants/house.js":"43a2c6e6e9d68d01","certificates/sign.js":"0c238d3173b5fc5a","certificates/verify.css":"0955715b90a2255a","certificates/verify.html":"7ef4977ba7da45f0","certificates/verify.js":"2b1ad9f46a3d0cb0","chess/openings-data.js":"92126876f6e69452","chess/puzzles-pack.js":"43f151dd4f12ad94","chess/puzzles-lichess.js":"847b18bf06ef961b","chess/train.js":"19784f0e7ccd28be","contacts/cardtext.js":"24a5d11059a1c539","contacts/csvmap.js":"75f76a42f6959c85","contacts/keep.js":"1a00ff4c8b7d0f81","contacts/merge.js":"7117520f10d2d664","diary/journal.js":"ac368a5d814994a6","feeds/ai.js":"f4a194415a322548","feeds/sources.js":"23b4728e2a9c9462","files/files-core.js":"7e5a17925b7ac99a","fitness/gps-core.js":"c13044f664a22acd","fitness/plan-core.js":"728a4f2179827b5d","fitness/wger.js":"8a7e1fc4f7305ab3","gamecenter/":"5eeb60694e397df9","gamecenter/challenge.js":"d6b86f89f61df5a5","gamecenter/core.js":"ac0357fbfc05432a","gamecenter/gamecenter.css":"12d4d463ba7c99db","gamecenter/gamecenter.js":"ff331c74cc4d9fef","gamecenter/host.js":"06798f1e449ab0c6","gamecenter/index.html":"5eeb60694e397df9","gamecenter/today.js":"afee399ddc47e659","discover/core.js":"81d5ad17d339c0c1","discover/host.js":"9bca0c2911003c84","gamekit/daily.js":"0c5dabaf1dc39bfd","gamekit/resume.js":"525ab8c4218c9b26","gamekit/layout.css":"093afeb005328a2d","gamekit/haptics.js":"ceaa0a80b777d24d","garage/logbook.js":"7301835d05d7596a","garage/receipt.js":"0759475af6e080bf","habits/model.js":"cec299f6d5a51f5b","habits/steps.js":"7c975cc12a64aa05","kanban/model.js":"c51160c4850abdde","kanban/tools.js":"fa60ef0028efa13a","layout/merge.js":"e36e386d4f66ea84","layout/mergeui.js":"e1f2dcc876b93e68","layout/cover.js":"58dcef196938b221","layout/recipesteps.js":"5ef78d9015888744","layout/recipes.js":"75ab2e3d24755d5c","layout/commands.js":"72389ee118db203d","layout/pro.js":"8371a50eaf87806f","layout/proassist.js":"c79e2dae3b85ba7d","layout/bleedfill.js":"54f176f8322d2628","layout/assist.js":"ff54ef3589850e28","library/catalog.js":"d3da7748e8d5b899","library/opds.js":"c85be3d12d8e6c65","mail/feed.js":"3ae5ae55075468c7","mail/pgp.js":"8d4602d7171d0267","mail/pgpmime.js":"e12562717c3e18e7","mail/snooze.js":"d98cb1e0156c600c","mail/unsub.js":"7beed61cc93f7350","maps/offline-core.js":"ea5d85f8ce046ddf","maps/offline.js":"1a0cfa454d3dca0b","maps/trails-core.js":"a35bd1d71c296290","maps/trails.js":"652cb9c304a1d214","maps/trails-tab.js":"dc3db0e8568ce2a6","maps/outdoor-core.js":"efdf6207c0a63344","maps/outdoor.js":"1bce15e0cccd831a","maps/offroute-core.js":"1fc54aec3034b8b7","maps/offroute.js":"2f2a6426fe8357b2","meals/import.js":"2396457cffa0e76c","meals/nutrition.js":"3e84bd7918f7f77b","meals/pantry.js":"44dc1a3a3a363c2a","meals/house.js":"20acb26033248827","montage/asr.js":"227448d28e87def4","montage/denoise.js":"54706d71e584f0b2","montage/reframe.js":"098e750ba66f298d","mood/vocab.js":"9bc8ab07692ece5a","notes/md.js":"d4755d0566e04ed7","notes/voice-core.js":"42daa9b702b2c8f6","notes/voice.js":"bdc838c4348ea5e1","notes/import.js":"fb0c43018a6ef580","passwords/kdbx.js":"48cb12083c2baac6","passwords/pmapp.js":"db58f19d4c305411","passwords/pmcore.js":"aef2b34cae89429e","passwords/pmkinds.js":"9d1fb73b1656ae32","passwords/pmcrypto.js":"33599cfdb01f0842","passwords/import.js":"a51b1914981adc09","passwords/otpexport.js":"e94901bf4ae90279","passwords/afindex.js":"2bfaffac134eda93","photolab/batch.js":"2b2d8bdc256aae98","photolab/batchcore.js":"34355d2aa24f9061","photolab/recipesteps.js":"52c38233fa1a06a1","photolab/recipes.js":"e90971d230811c4f","photolab/search.js":"8f44da07c4a82728","studio/search.js":"43fc19724b61cbbd","photolab/commands.js":"10d0e45dea3c02a7","photolab/assist.js":"39b66ee6a4c25d58","photolab/aiedit.js":"d0562c6398453581","slides/commands.js":"cbfe43b24af9a9d8","slides/assist.js":"6df80345199bca5b","photolab/raw.js":"5ea1613edf0e519f","photolab/subject.js":"89595bc4c30dcc98","plants/identify.js":"27c84005419dc646","podcasts/gpodder.js":"f7695fad66886cfe","qr/qr-bulk.js":"5880be5d506000f3","qr/qr-scan.js":"e37fd39d04114408","quote/accept-core.js":"a1e9268866d74559","quote/accept.css":"fce99556e425c57d","quote/accept.html":"562fb89d8e6872ad","quote/accept.js":"e5a4046a9fb6ee60","radio/tools.js":"ceaab8edcf2f02b4","remote-play.js":"2de2a8c093cd182c","cast.js":"b65c1cc5ae512dc4","slides/anim.js":"ee601222ab3e9ab4","slides/objects.js":"31dfa42e6db183c5","slides/pptx.js":"391d7d6917b4df76","slides/remote.js":"45f4da73c48024ff","spreadsheet/functions.js":"23b4fff38de71155","spreadsheet/sheetkit.js":"20321d3d136052ba","spreadsheet/commands.js":"5658bcfd1ac2f5a5","spreadsheet/assist.js":"26ae4a2464dec4a0","stock/pos-core.js":"73b13c6965b8cf71","stock/pos.js":"cdedb16d5c6505c3","storage/core.js":"f6633dbbf65e408e","studio/encode.js":"48bdc9e5ba05ae7d","studio/meter.js":"4d5b55be80104acf","studio/meter.worklet.js":"8daabfccb21370c1","studio/flac.js":"aa3924fd4ba94813","studio/aac.js":"727fddba19dc427a","studio/mp4.js":"aa1c1b12b3c8e666","studio/podcast.js":"80cc2d6cb35efb05","studio/ghpages.js":"004d24f27c108f86","studio/davpub.js":"5d11423ebd5875a0","studio/podcastui.js":"7b76641200fce9f4","studio/fxchain.worklet.js":"4e95fe7ee15cfeb6","studio/loops.js":"1bcd9d0df7fc34ac","studio/midi.js":"2479ee57c269b2c7","studio/bridge.js":"e3830c812ab31416","studio/sfz.js":"04e79b2850436936","studio/sounds.js":"bddf767fa7598f41","studio/notes.js":"34c449cc48311c4b","studio/roll.js":"c11a508ec95b5cfb","television/core.js":"a21d9046cc8e373a","television/vod.js":"5de0686955f08a90","television/films.js":"a0d8ea0c7c9d6a38","time/cities.js":"90c6a7d6f4d164fb","time/clock-core.js":"9b38e94efe1c9c94","today/layout.js":"8f26b97fab052830","today/tips.js":"debe5b85667e2ee4","today/dayline.js":"8924ddcb10177962","todo/model.js":"758d8de395715554","todo/vtodo.js":"ce717da3daa075bf","todo/dav.js":"2cbc3c9d06ae81c6","todo/house.js":"411c039f392fc044","travel/booking.js":"7f9a5d849fb02eb2","vendor/hash-wasm/argon2.umd.min.js":"dcec617a2e1b700f","vendor/jsqr/jsQR.js":"415b07858a9a3972","vendor/fzstd/fzstd.umd.js":"fbea1c25c4413b62","vendor/brotli/brotli.min.js":"eaf9c054ed366cb5","vendor/polygon-clipping/polygon-clipping.umd.min.js":"1bd1335a65dac024","vendor/openpgp/openpgp.min.js":"9736f49e81790af9","weather/core.js":"e5a0c1671b8af34e","weather/days.js":"4281c11dd0c09089","weather/rainmap-core.js":"8b15ae4e44f797ce","weather/rainmap.js":"f9147fbce4c398c9","writer/core.js":"5371adc1f1b1f2dc","writer/merge.js":"28f021fdba1f3d16","writer/spell-worker.js":"400886d297d139a9","writer/spell.js":"a662cc4ceb1cc9b3","writer/track.js":"d5aee5089387a84c","writer/commands.js":"609506354e09e63d","writer/assist.js":"d87c9025e547d611","writer/catcore.js":"b3de17ff7a437390","writer/catstore.js":"01f4f0c38563966a","writer/cattm.js":"d4e07565c0bd3f21","writer/catqa.js":"bbf4b4797f8c805a","writer/catdocx.js":"e59b812b96af561b","writer/catxlf.js":"3cce99d886d9f886","writer/catmt.js":"09e99809fbecdb09","writer/cat.js":"e6b54b55c44b6e43","writer/fonts.js":"d5c00dc57ea16a6f","vendor/jspdf.umd.min.js":"e6551fcdc32f09d6","vendor/xlsx.full.min.js":"0542a718400c5520","vendor/hls.light.min.js":"27c3d1e021df94ce","vendor/pdfjs/pdf.min.js":"d2242a429cffd2a6","vendor/pdfjs/pdf.worker.min.js":"2cbba88314e2190a","vendor/NotoSans-Regular.ttf":"f5f552c8c5edb61f","fonts/nunito-regular.woff2":"d06f70fd3341b837","fonts/nunito-medium.woff2":"0fd97cd9f57d196f","fonts/nunito-semibold.woff2":"1bc41045e28bff7e","fonts/nunito-bold.woff2":"e60de096c1a8b6ef","fonts/nunito-extrabold.woff2":"8d89c07a09e43a9d","fonts/mplusrounded-greek-regular.woff2":"822f5a954831faa8","fonts/mplusrounded-greek-medium.woff2":"476d60749af2dd33","fonts/mplusrounded-greek-bold.woff2":"c3c24ff94445b5c6","fonts/mplusrounded-greek-extrabold.woff2":"158db1d48f4ac564"};
// SW-U2: at most this many precache files at a time, at low fetch
// priority, so an install leaves room on the network for the page.
var PRECACHE_POOL = 4;
// SW-T4: a precache download that has not answered after this long
// counts as a network failure. A request that never answered (a VPN or
// a phone network that drops the connection silently) used to hold the
// whole install until the browser killed the worker, and a killed
// install left no marker: every attempt started from zero and the
// phone stayed on its old release for good.
var PRECACHE_FETCH_MS = 30000;
// SW-T4: a file that failed on the network is tried once more before
// the attempt gives up.
var PRECACHE_TRIES = 2;
// SW-T4: after this many failed attempts at an update (counted across
// releases, so a release every half hour does not reset it) the new
// release activates without the files it could not reach; they come
// from the network when they are used. One file the network never
// delivers (a filter that blocks it, a broken route) must not hold a
// device on an old release forever.
var PRECACHE_GIVE_UP = 3;

function pool(items, size, fn) {
  var i = 0;
  function next() {
    if (i >= items.length) return Promise.resolve();
    var item = items[i++];
    return Promise.resolve().then(function () { return fn(item); }).then(next);
  }
  var runners = [];
  for (var k = 0; k < Math.min(size, items.length); k++) runners.push(next());
  return Promise.all(runners);
}

// SW-T4: fetch(u) for the precache, failing after PRECACHE_FETCH_MS.
function precacheFetch(u) {
  var ctl = typeof AbortController === "function" ? new AbortController() : null;
  var timer = null;
  var init = { cache: "reload", priority: "low" };
  if (ctl) init.signal = ctl.signal;
  return Promise.race([
    fetch(new Request(u, init)),
    new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctl) { try { ctl.abort(); } catch (e) {} }
        reject(new Error("timeout after " + PRECACHE_FETCH_MS + " ms"));
      }, PRECACHE_FETCH_MS);
    })
  ]).then(function (r) { clearTimeout(timer); return r; },
          function (e) { clearTimeout(timer); throw e; });
}

// SW-T4: the number of failed update attempts the marker records
// (an empty marker from an older release counts as one).
function markTries(res) {
  if (!res) return Promise.resolve(0);
  return res.text().then(function (t) {
    var n = parseInt(t, 10);
    return n > 0 ? n : 1;
  }).catch(function () { return 1; });
}

// SW-Q1: shell cache names by release number, newest first (as text
// "v10.00.00" would sort before "v9.99.00").
function shellOrder(a, b) {
  function ver(n) {
    var m = /v(\d+(?:\.\d+)*)$/.exec(n);
    return m ? m[1].split(".").map(Number) : [];
  }
  var x = ver(a), y = ver(b);
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    var d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? -1 : 1;
  }
  return a < b ? 1 : a > b ? -1 : 0;
}

// The other releases' shell caches, newest first. The list also
// carries their names (prev.names[i] is the name of prev[i]).
function previousShells() {
  return caches.keys().then(function (names) {
    var prev = names.filter(function (n) {
      return n.indexOf("oros-shell-") === 0 && n !== SHELL_CACHE;
    }).sort(shellOrder);
    return Promise.all(prev.map(function (n) { return caches.open(n); })).then(function (list) {
      list.names = prev;
      return list;
    });
  }).catch(function () { var none = []; none.names = []; return none; });
}

// SW-Q1: the names of the previous shell caches whose release never
// activated: they still hold PARTIAL_MARK (an install that finished,
// and so the active release, always removed it), newest first.
function failedShells(prev) {
  return Promise.all(prev.map(function (c, i) {
    return c.match(PARTIAL_MARK).then(function (r) { return r ? prev.names[i] : null; },
                                      function () { return null; });
  })).then(function (l) { return l.filter(Boolean); });
}

// SW-Q1: deletes these shell caches; returns prev without them.
function dropShells(prev, names) {
  if (!names.length) return Promise.resolve(prev);
  return Promise.all(names.map(function (n) {
    console.warn("[SW] precache: removing the unfinished release", n);
    return caches.delete(n).catch(function () { return false; });
  })).then(function () {
    var keep = [], keepNames = [];
    prev.forEach(function (c, i) {
      if (names.indexOf(prev.names[i]) === -1) { keep.push(c); keepNames.push(prev.names[i]); }
    });
    keep.names = keepNames;
    return keep;
  });
}

// SW-Q1: what the last install did, for the page (index.html
// orosUpdateNow: the update notice's "Update now" and Settings ›
// Check for updates). A small cache that outlives releases:
//   STATUS_KEY {v, ok, reason: "" | "network" | "space", missing, tries, at}
//   FORCE_KEY  {at}  the person asked to update now: no waiting for
//              PRECACHE_GIVE_UP attempts (honoured for FORCE_MS)
//   DONE_KEY   {v}   this release has every precache file it can get
//              (else fillPrecache fetches the rest; no flag is needed
//              for that, because with no room the flag could not be
//              written either)
var STATUS_CACHE = "oros-sw-status";
var STATUS_KEY = "/__status", FORCE_KEY = "/__force", DONE_KEY = "/__done";
var FORCE_MS = 10 * 60 * 1000;
function statusGet(key) {
  return caches.open(STATUS_CACHE).then(function (c) { return c.match(key); })
    .then(function (r) { return r ? r.json() : null; })
    .catch(function () { return null; });
}
function statusPut(key, obj) {
  return caches.open(STATUS_CACHE).then(function (c) {
    return c.put(key, new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } }));
  }).catch(function () {});
}
function statusDel(key) {
  return caches.open(STATUS_CACHE).then(function (c) { return c.delete(key); }).catch(function () {});
}

function hex16(buf) {
  var b = new Uint8Array(buf), s = "";
  for (var i = 0; i < 8; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}

// A previous release's copy of u whose content hashes to the expected
// value, or undefined.
function unchangedCopy(prev, u) {
  var want = Object.prototype.hasOwnProperty.call(PRECACHE_HASH, u) ? PRECACHE_HASH[u] : "";
  var subtle = self.crypto && self.crypto.subtle;
  if (!want || !subtle || !prev.length) return Promise.resolve(undefined);
  var i = 0;
  function tryNext() {
    if (i >= prev.length) return undefined;
    return prev[i++].match(u).then(function (hit) {
      if (!hit || !hit.ok) return tryNext();
      return hit.clone().arrayBuffer().then(function (buf) {
        return subtle.digest("SHA-256", buf);
      }).then(function (d) {
        return hex16(d) === want ? hit : tryNext();
      });
    });
  }
  return Promise.resolve().then(tryNext).catch(function () { return undefined; });
}

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
      // SW-T2: an UPDATE on a bad connection used to activate with
      // whatever half of the precache made it — and activation then
      // deleted the previous release's caches. The next offline (or
      // slow) open found neither copy: orOS did not open at all.
      // Now, while an older worker is active, a NETWORK failure fails
      // the install: the old release keeps serving, and the next
      // open retries. The retry is resumable — files this release
      // already stored are not downloaded again. A file the server
      // answers with an error (404) still only logs, as before, so
      // one bad entry can never block every future update. The very
      // first install stays tolerant: some offline beats none.
      var updating = !!(self.registration && self.registration.active);
      var netFailed = [];
      // Resume only after a FAILED attempt of this same release (its
      // marker): a worker re-installed under an unchanged version
      // still refreshes every file, as before.
      // SW-T4: the marker goes in at the START of an update and holds
      // the number of attempts so far, so an attempt the browser
      // killed half way (no time to write anything at the end) still
      // resumes, and attempts are counted across releases.
      // SW-Q1: a phone whose storage was nearly full stayed on 7.97.00
      // for good: every update needs room for a second copy of the
      // precache (about 140 MB stored for 66 MB of files), a refused
      // cache.put() failed the whole install without a word, and each
      // failed attempt left its half copy behind, which took more room.
      // Now only the newest unfinished release is kept, a refused put
      // first removes that one too and tries again, and if there is
      // still no room the release activates with what it stored: the
      // old copy goes at activation and fillPrecache() fetches the rest.
      var unstored = [];
      var room = "ok";          // "ok" | "freeing" | "freed" | "full"
      var freeing = null;
      return Promise.all([cache.match(PARTIAL_MARK), previousShells(), statusGet(FORCE_KEY)]).then(function (got) {
      var resume = got[0], prev = got[1];
      var force = !!(got[2] && Date.now() - got[2].at < FORCE_MS);
      return Promise.all([markTries(resume)].concat(prev.map(function (c) {
        return c.match(PARTIAL_MARK).then(markTries, function () { return 0; });
      }))).then(function (counts) {
      var tries = Math.max.apply(null, counts) + 1;
      // SW-Q1: of the releases that never activated only the newest
      // stays (a source of unchanged files for this one).
      return failedShells(prev).then(function (failed) {
        return dropShells(prev, failed.slice(1));
      }).then(function (left) {
      prev = left;
      return (updating ? cache.put(PARTIAL_MARK, new Response(String(tries))).catch(function () {})
                       : Promise.resolve()).then(function () {
      function noRoom(u, e) {
        unstored.push(u);
        if (room === "ok") {
          console.warn("[SW] precache: no room for", u, e && (e.name || e.message));
          room = "freeing";
          freeing = failedShells(prev).then(function (names) {
            return dropShells(prev, names).then(function (left) {
              prev = left;
              room = names.length ? "freed" : "full";
            });
          }).catch(function () { room = "full"; });
          return freeing;
        }
        if (room === "freed") room = "full";
        return freeing || Promise.resolve();
      }
      function keep(u, response) {
        if (room !== "ok" && room !== "freed") { unstored.push(u); return Promise.resolve(); }
        return cache.put(u, response).catch(function (e) { return noRoom(u, e); });
      }
      function download(u) {
        return precacheFetch(u).then(function (response) {
          if (!response.ok) {
            console.warn("[SW] precache MISS:", u, response.status);
            return true;
          }
          return keep(u, response).then(function () { return true; });
        }, function (e) {
          console.warn("[SW] precache MISS:", u, e && e.message);
          return false;
        });
      }
      function fetchOne(u) {
        if (room === "full") { unstored.push(u); return; }
        return unchangedCopy(prev, u).then(function (same) {
          if (same) return keep(u, same);
          return download(u).then(function (ok) { if (!ok) netFailed.push(u); });
        });
      }
      return pool(PRECACHE_URLS, PRECACHE_POOL, function (u) {
        return (resume ? cache.match(u) : Promise.resolve(undefined)).then(function (have) {
          if (have) return;
          return fetchOne(u);
        });
      }).then(function () {
        // SW-T4: the files that failed get PRECACHE_TRIES - 1 more
        // tries, one at a time.
        var round = 1;
        function again() {
          if (!netFailed.length || round >= PRECACHE_TRIES) return;
          round++;
          var list = netFailed;
          netFailed = [];
          return pool(list, 1, function (u) {
            return download(u).then(function (ok) { if (!ok) netFailed.push(u); });
          }).then(again);
        }
        return again();
      }).then(function () {
        // SW-Q1: room was made: the files that did not fit go again.
        if (room !== "freed" || !unstored.length) return;
        var list = unstored;
        unstored = [];
        return pool(list, PRECACHE_POOL, fetchOne);
      }).then(function () {
        return adoptNullfx(prev);
      }).then(function () {
        var noSpace = unstored.length > 0;
        if (updating && netFailed.length && tries < PRECACHE_GIVE_UP && !force && !noSpace) {
          return statusPut(STATUS_KEY, { v: CACHE_VERSION, ok: false, reason: "network",
                                         missing: netFailed.length, tries: tries, at: Date.now() }).then(function () {
            throw new Error("precache: " + netFailed.length +
              " file(s) unreachable, keeping the current release (attempt " + tries + ")");
          });
        }
        var missing = netFailed.length + unstored.length;
        if (missing) {
          console.warn("[SW] precache: activating without " + missing +
            " file(s) after " + tries + " attempt(s)" + (noSpace ? " (no room)" : "") + ":",
            netFailed.concat(unstored).join(" "));
        }
        return cache.delete(PARTIAL_MARK).catch(function () {}).then(function () {
          return Promise.all([
            statusPut(STATUS_KEY, { v: CACHE_VERSION, ok: true,
                                    reason: noSpace ? "space" : netFailed.length ? "network" : "",
                                    missing: missing, tries: tries, at: Date.now() }),
            missing ? statusDel(DONE_KEY) : statusPut(DONE_KEY, { v: CACHE_VERSION }),
            statusDel(FORCE_KEY)
          ]);
        });
      });
      });   // marker written
      });   // unfinished releases trimmed
      });   // attempt count
      });   // PARTIAL_MARK + previous release
    })
  );
});

// ---------- Activate: purge old caches ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE, LANG_CACHE, NULLFX_CACHE, SOUNDS_CACHE, "oros-television-api", SHARE_INBOX, STRICT_CACHE, FOCUS_CACHE, STATUS_CACHE];
  // SW-I: Add a guard against slow cache cleanup blocking claim.
  // If cleanup takes >30s (extreme), we still want to claim clients
  // to restore online/offline functionality. The background cleanup
  // continues but doesn't block activation indefinitely.
  var cleanup = caches.keys().then(function (names) {
    return Promise.all(names.map(function (name) {
      // The Assistant's in-browser models ("webllm/model", "webllm/wasm",
      // "webllm/config", gigabytes the user downloaded on purpose) and
      // the WebLLM library cache outlive every release.
      if (name.indexOf("webllm/") === 0 || name === WEBLLM_CACHE) return;
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

// ---------- SW-Q1: files a release activated without ----------
// After an install that had no room (or gave up on unreachable files)
// the old release's copy is gone and there is room again: the missing
// precache files are fetched now, two at a time. The page asks for it
// once per start ("oros-sw-fill", index.html); it is never part of
// activate (fetch events wait for activation to finish). It stops at
// the first refused put and goes on at the next start.
var filling = null;
function fillPrecache() {
  if (filling) return filling;
  filling = statusGet(DONE_KEY).then(function (d) {
    if (d && d.v === CACHE_VERSION) return;
    return caches.open(SHELL_CACHE).then(function (cache) {
      return cache.keys().then(function (reqs) {
        var have = {};
        reqs.forEach(function (r) { have[r.url] = 1; });
        var todo = PRECACHE_URLS.filter(function (u) { return !have[new URL(u, self.location.href).href]; });
        var left = 0, full = false;
        return pool(todo, 2, function (u) {
          if (full) { left++; return; }
          return precacheFetch(u).then(function (res) {
            if (!res.ok) return;   // a server error stays a MISS, as at install
            return cache.put(u, res).catch(function () { full = true; left++; });
          }, function () { left++; });
        }).then(function () {
          if (!left) return statusPut(DONE_KEY, { v: CACHE_VERSION });
        });
      });
    });
  }).catch(function () {}).then(function () { filling = null; });
  return filling;
}
self.addEventListener("message", function (event) {
  var m = event.data;
  if (m && m.t === "oros-sw-fill") event.waitUntil(fillPrecache());
});

// ---------- Studio effects (NULLFX_CACHE) ----------
var NULLFX_RE = /\/studio\/nullfx\/fx\/[a-z0-9_]+\.js$/;
// Releases before NULLFX_CACHE precached every effect: the newest
// previous shell's copies move here (no X-Oros-Release, so they are
// refreshed while online), so effects that worked offline still do.
function adoptNullfx(prev) {
  if (!prev.length) return Promise.resolve();
  return caches.open(NULLFX_CACHE).then(function (nc) {
    return prev[0].keys().then(function (reqs) {
      return Promise.all(reqs.map(function (r) {
        var u = new URL(r.url), key = u.origin + u.pathname;
        if (u.origin !== self.location.origin || !NULLFX_RE.test(u.pathname)) return;
        return nc.match(key).then(function (have) {
          if (have) return;
          return prev[0].match(r).then(function (res) {
            if (res && res.ok) return nc.put(key, res);
          });
        });
      }));
    });
  }).catch(function () {});
}
function nullfxFile(event, request, key) {
  return caches.open(NULLFX_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit && hit.headers.get("X-Oros-Release") === CACHE_VERSION) return hit;
      return fetch(request, { cache: "no-cache" }).then(function (response) {
        if (!response || response.status !== 200) return hit || response;
        var copy = response.clone();
        event.waitUntil(copy.blob().then(function (body) {
          var h = new Headers(copy.headers);
          h.set("X-Oros-Release", CACHE_VERSION);
          return cache.put(key, new Response(body, { status: 200, headers: h }));
        }).catch(function () {}));
        return response;
      }, function () {
        return hit || Response.error();
      });
    });
  });
}

// ---------- Fetch strategy ----------
// Android "Share → orOS" (manifest share_target, POST multipart to
// /?share-target). Links go on as before: a GET to /?share-url=…
// (Bookmarks). A file is kept in the "oros-share-inbox" cache under a
// random id and orOS opens at /?share-files=<id>; fileopen.js takes
// it once and empties the inbox. Only the first file; > 50 MB is
// refused (?share-files=big). Nothing is parsed or run here.
var SHARE_INBOX = "oros-share-inbox";
var SHARE_MAX = 50 * 1024 * 1024;
// A single app (solo.js) has its own share target,
// /<id>/solo.html?share-target: the answer goes back to that page, which
// hands the parameters to its orOS frame.
function shareTargetPost(request) {
  var home = new URL("./", self.registration.scope).href;
  var soloPage = null;
  try { soloPage = /^\/[a-z0-9-]+\/solo\.html$/.exec(new URL(request.url).pathname); } catch (e) { soloPage = null; }
  if (soloPage) home = new URL(soloPage[0], self.registration.scope).href;
  function go(qs) { return Response.redirect(home + (qs ? "?" + qs : ""), 303); }
  return request.formData().then(function (fd) {
    var files = fd.getAll("files").filter(function (f) {
      return f && typeof f === "object" && typeof f.size === "number" && f.size > 0;
    });
    if (!files.length) {
      var q = new URLSearchParams();
      ["url", "title", "text"].forEach(function (k) {
        var v = fd.get(k);
        if (typeof v === "string" && v) q.set("share-" + k, v.slice(0, 4000));
      });
      // orOS itself lets the user pick the app ("Send to…" sheet);
      // a single app takes it as before.
      if (!soloPage && q.toString()) q.set("share-pick", "1");
      return go(q.toString());
    }
    var f = files[0];
    if (f.size > SHARE_MAX) return go("share-files=big");
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    function hdr(x) {
      return { "Content-Type": x.type || "application/octet-stream",
               "X-Name": encodeURIComponent(String(x.name || "file").slice(0, 255)) };
    }
    var headers = hdr(f);
    if (files.length > 1) headers["X-More"] = "1";
    // SHARE-MANY (wave 2 of the files gap review): the files after the
    // first wait too, at /__share/<id>/<n> (≤ 10 in all, each ≤
    // SHARE_MAX). Only an app that takes several (single Transfer)
    // reads them; the inbox is emptied after every read either way.
    var more = files.slice(1, 10).filter(function (x) { return x.size <= SHARE_MAX; });
    return caches.open(SHARE_INBOX).then(function (c) {
      return c.put("/__share/" + id, new Response(f, { headers: headers })).then(function () {
        return Promise.all(more.map(function (x, i) { return c.put("/__share/" + id + "/" + (i + 1), new Response(x, { headers: hdr(x) })); }));
      });
    }).then(function () { return go("share-files=" + id); });
  }).catch(function () { return go(""); });
}

// STRICT (Sensitive work, lock.js window.orosStrict): the page tells
// the worker the level and the hosts this device may reach. In "hard"
// every cross-origin request (any method) to another host fails here,
// so nothing leaves the device except the sync cloud. In "on" the
// relay is only reported once (the page asks before relay use). The
// state lives in the "oros-strict" cache so a restarted worker keeps
// it. Limits (help page): a hard reload, a page the worker does not
// control yet, WebSockets, cross-origin frames and new windows are
// not covered.
var STRICT_CACHE = "oros-strict";
var strictState = { level: null, hosts: [], relays: [] };
var strictWarned = {};
var strictLoaded = false;
function strictClean(m) {
  var level = m && (m.level === "on" || m.level === "hard") ? m.level : null;
  function list(a) {
    return Array.isArray(a) ? a.filter(function (h) {
      return typeof h === "string" && /^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$/i.test(h);
    }).slice(0, 32).map(function (h) { return h.toLowerCase(); }) : [];
  }
  return { level: level, hosts: list(m && m.hosts), relays: list(m && m.relays) };
}
var strictReady = caches.open(STRICT_CACHE).then(function (c) {
  return c.match("/__strict");
}).then(function (r) { return r ? r.json() : null; }).then(function (j) {
  if (j) strictState = strictClean(j);
}).catch(function () {}).then(function () { strictLoaded = true; });
function strictTell(msg) {
  return self.clients.matchAll({ type: "window" }).then(function (list) {
    list.forEach(function (c) { try { c.postMessage(msg); } catch (e) {} });
  }).catch(function () {});
}
self.addEventListener("message", function (event) {
  var m = event.data;
  if (!m || m.t !== "oros-strict") return;
  strictState = strictClean(m);
  strictWarned = {};
  var body = JSON.stringify(strictState);
  event.waitUntil(caches.open(STRICT_CACHE).then(function (c) {
    return strictState.level
      ? c.put("/__strict", new Response(body, { headers: { "Content-Type": "application/json" } }))
      : c.delete("/__strict");
  }).catch(function () {}));
});
function strictVerdict(url) {
  if (url.origin === self.location.origin) return "ok";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "ok";
  var host = url.host.toLowerCase();
  if (strictState.level === "hard") {
    return strictState.hosts.indexOf(host) >= 0 ? "ok" : "block";
  }
  if (strictState.level === "on" && strictState.relays.indexOf(host) >= 0) return "relay";
  return "ok";
}
function strictNoteRelay(event, host) {
  if (strictWarned[host]) return;
  strictWarned[host] = 1;
  event.waitUntil(strictTell({ t: "oros-strict-relay", host: host }));
}
function strictFetch(event, url) {
    event.respondWith(strictReady.then(function () {
    var v = strictVerdict(url);
    if (v === "block") {
      event.waitUntil(strictTell({ t: "oros-strict-blocked", host: url.host }));
      return Response.error();
    }
    if (v === "relay") strictNoteRelay(event, url.host);
    return fetch(event.request);
  }));
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  // STRICT first: it applies to every method.
  var surl = new URL(request.url);
  if (surl.origin !== self.location.origin) {
    // Before the stored state is read (a few ms after the worker
    // starts) everything but map tiles waits for it; tiles check it
    // in their own branch below.
    if (strictState.level === "hard" || (!strictLoaded && !isTileHost(surl.hostname))) {
      return strictFetch(event, surl);
    }
    if (strictVerdict(surl) === "relay") strictNoteRelay(event, surl.host);
  }

  if (request.method === "POST") {
    var purl = new URL(request.url);
    if (purl.origin === self.location.origin && purl.searchParams.has("share-target")) {
      event.respondWith(shareTargetPost(request));
    }
    return;
  }
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
      strictReady.then(function () {
        if (strictVerdict(url) !== "block") return caches.open(TILE_CACHE);
        event.waitUntil(strictTell({ t: "oros-strict-blocked", host: url.host }));
        throw new Error("strict");
      }).then(function (cache) {
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
  // The computer's own files (orOS USB launcher, Files' "This computer",
  // files/computer-core.js): live answers about the computer's disks.
  // Never cached, never answered by the worker.
  if (url.pathname.indexOf("/__oros/") === 0) return;

  // S1 FIX: apps.json is NETWORK-FIRST. It is fetched unversioned
  // (no ?v= stamp), so a cache-first exact match would freeze the
  // app list at whatever the last CACHE_VERSION precached — a newly
  // added app would stay invisible to already-installed PWAs until
  // the next full release. Network-first keeps the list fresh on
  // every online visit; the precached copy remains the offline
  // fallback (zero offline regression).
  if (isAppsList(url.pathname)) {
    // SW-2/H10: "network-first" must mean network. A plain fetch()
    // honors the HTTP cache — a freshly deployed app could stay
    // invisible for the max-age window. no-store bypasses the HTTP
    // cache entirely; the RUNTIME_CACHE copy below stays as the
    // offline fallback (zero offline regression).
    // SW-T1: at most NET_TIMEOUT_MS, then the cached list answers.
    // SW-F2: the list of THIS release answers first, like the shell
    // page that reads it (every release precaches its own list, and
    // a new app arrives with a new release). Network-first is left
    // for a worker whose precache has no list.
    event.respondWith(releasePage(request).then(function (hit) {
      return hit || networkFirst(event, request, { cache: "no-store" },
        function (response) { return response.ok; },
        function () { return caches.match(request); },
        function () { return Response.error(); });
    }));
    return;
  }

  if (request.mode === "navigate") {
    var frame = request.destination === "iframe" || request.destination === "frame";
    // SW-2: GitHub Pages serves HTML with max-age=600 — a plain
    // fetch() honors the HTTP disk cache, so an online user (and
    // critically the broker's post-update reload) could receive a
    // 10-minute-stale index.html carrying old ?v= stamps: the
    // version toast would then LIE about having updated. no-cache
    // = always revalidate with the server (304s are cheap) — the
    // auto-update chain stays end-to-end fresh.
    // SW-T1: the network gets NET_TIMEOUT_MS; then the cached page.
    var viaNet = function () { return networkFirst(event, request, { cache: "no-cache" },
      function (response) {
        // Cache only REAL pages: a cached 404/502 becomes the
        // offline "truth" for that URL. OAuth redirects (?code=...)
        // are one-shot URLs — never worth a cache entry; so are
        // "Send to orOS" launches (?share-url=…, one per link) and
        // address-bar searches (?search=…), and "Open with" file
        // launches (?file-open=…), and direct app links handed to the
        // shell (?app-at=…, DL-1: one URL per link).
        // SWK-4: a REDIRECTED response ("todo" → "todo/") cannot be
        // replayed to a navigation from the cache — the browser
        // rejects it and the page fails offline. Never store one.
        return response.ok && !response.redirected &&
          url.search.indexOf("code=") === -1 &&
          url.search.indexOf("share-") === -1 &&
          url.search.indexOf("search=") === -1 &&
          url.search.indexOf("file-open=") === -1 &&
          url.search.indexOf("app-at=") === -1 &&
          url.search.indexOf("solo=") === -1;
      },
      function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          // SWK-3: the shell page is the right fallback for the TOP
          // window only. For an app frame it loaded orOS inside
          // orOS — a second shell, with its own sync engine, in the
          // iframe. A single app's frame (/?solo=<id>, solo.js) IS
          // that window's only shell: it gets the shell page.
          var soloFrame = frame && url.pathname === "/" && url.searchParams.has("solo");
          return frame && !soloFrame ? undefined : caches.match("./index.html");
        });
      },
      function () {
        // An app that is not cached says so instead.
        if (frame) {
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>orOS</title>' +
            '<body style="margin:0;min-height:100vh;display:flex;align-items:center;' +
            'justify-content:center;text-align:center;padding:24px;box-sizing:border-box;' +
            'font-family:system-ui,sans-serif;background:#1b1a18;color:#e8eaf0;">' +
            '<p id="m">' + OFFLINE_T.en["sw.offline"] + '</p>' +
            // The person's language: English and Greek from the table, a
            // pack language from its shell pack (kept offline in LANG_CACHE).
            '<script>(function(){var T=' + JSON.stringify(OFFLINE_T) + ',m=document.getElementById("m"),l="en";' +
            'try{l=localStorage.getItem("oros-lang")||"en";}catch(e){}' +
            'if(T[l]){m.textContent=T[l]["sw.offline"];return;}' +
            'if(!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(l))return;' +
            'window.orosPack=function(c,a,t){var v=t&&t["sw.offline"];if(typeof v==="string"&&v.trim())m.textContent=v;};' +
            'var s=document.createElement("script");s.src="/i18n/"+l+"/shell.js";document.head.appendChild(s);})();</script></body>',
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return Response.error();
      }); };
    // SW-F1/SW-F2: a page of THIS release's precache answers at once,
    // the shell page as well as an app frame. Network-first made every
    // open wait for the network: up to NET_TIMEOUT_MS on a bad
    // connection, and right after a release (several a day) the fresh
    // page fetched every script under its new ?v= from the network,
    // one slow request after another (Calendar: about 10 s of empty
    // boxes; the shell, slower still). The precached page and its
    // scripts are one release, so they match. A new release arrives
    // in the background: the browser checks sw.js on every
    // navigation, the broker in index.html calls update() on every
    // load, and the new worker's controllerchange reloads the shell
    // at the first safe moment (SW-2). Pages that are not precached
    // stay network-first.
    event.respondWith(releasePage(request).then(function (hit) {
      return hit || viaNet();
    }));
    return;
  }

  // Sub-resources: cache-first with EXACT URL match. The ?v= stamp
  // in index.html changes the cache key on every release, so a new
  // version can never resolve to an old cached body.
  // SW-D1: next, a request stamped with THIS release is answered by
  // this release's own precache copy (releaseCopy). Everything else
  // goes to the network; the loose ignoreSearch match across caches
  // stays in the network-FAILURE branch only (offline best effort).
  // Atelier's picture tools (vendor/ort + vendor/u2netp + vendor/migan,
  // about 16 + 27 MB) are fetched once and kept in Atelier's own IndexedDB
  // (atelier/cutout.js): no second copy in the runtime cache. The same
  // for Writer's spelling dictionaries (vendor/hunspell, kept by
  // writer/spell-worker.js in IndexedDB). Other lazy vendor files
  // (tesseract, libarchive, libraw, rnnoise) use the runtime cache.
  if (/\/vendor\/(ort|u2netp|migan|hunspell)\//.test(url.pathname)) return;
  // Language packs: their own cache, matched without ?v=. The cached
  // copy answers at once and the network refreshes it in the
  // background; a missing pack (not translated yet) is never stored,
  // and i18n.js then shows English.
  if (/\/i18n\/[a-z]{2,3}(-[A-Z]{2})?\//.test(url.pathname)) {
    event.respondWith(caches.open(LANG_CACHE).then(function (cache) {
      var key = url.origin + url.pathname;
      return cache.match(key).then(function (hit) {
        var net = fetch(request, { cache: "no-cache" }).then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            return cache.put(key, copy).then(function () { return response; }, function () { return response; });
          }
          return response;
        });
        if (hit) { event.waitUntil(net.catch(function () {})); return hit; }
        return net.catch(function () { return Response.error(); });
      });
    }));
    return;
  }
  // Studio's NULL JSFX effects (NULLFX_CACHE above): matched without
  // ?v= (the worklet loads them without one). A copy stored by this
  // release answers at once; an older one is replaced from the network
  // and answers only when the network fails.
  if (url.origin === self.location.origin && NULLFX_RE.test(url.pathname)) {
    event.respondWith(nullfxFile(event, request, url.origin + url.pathname));
    return;
  }
  // WebLLM: cache-first in its own cache, matched without ?v=. The
  // file name carries the library version (web-llm-<version>.js), so
  // a new version is a cache miss; storing it drops the old copy.
  if (/\/vendor\/webllm\//.test(url.pathname)) {
    event.respondWith(caches.open(WEBLLM_CACHE).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            event.waitUntil(cache.keys().then(function (old) {
              return Promise.all(old.map(function (r) { return cache.delete(r); }));
            }).then(function () { return cache.put(request, copy); }));
          }
          return response;
        });
      });
    }));
    return;
  }

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
// ---- Notifications with orOS closed (webpush.js, relay/push.js) ----
// The packet was encrypted by the page for this subscription; the
// browser has decrypted it already. While an orOS window is on screen
// the in-app engine rings, so nothing is shown here. Otherwise one
// notification, tag = the shell's dedupKey, so an in-app one for the
// same reminder replaces it instead of doubling.
// Focus modes (FOCUS-1 F4): the page sends who stays quiet for the next
// 48 hours (focus/core.js timeline); a push of such an app is shown
// without sound or vibration. Alarms always ring. Same rule as
// focus/core.js snapQuiet (keep the two in step).
var FOCUS_CACHE = "oros-focus";
var focusSnap = null;
var focusReady = caches.open(FOCUS_CACHE).then(function (c) {
  return c.match("/__focus");
}).then(function (r) { return r ? r.json() : null; }).then(function (j) {
  if (j && !focusSnap) focusSnap = j;
}).catch(function () {});
function focusQuiet(snap, ns, now) {
  if (!snap || snap.v !== 1 || !(now >= snap.at && now < snap.until)) return false;
  ns = String(ns || "");
  if (Array.isArray(snap.wait) && snap.wait.indexOf(ns) >= 0) return true;
  return (Array.isArray(snap.spans) ? snap.spans : []).some(function (x) {
    return x && x.s <= now && now < x.e && Array.isArray(x.allow) && x.allow.indexOf(ns) < 0;
  });
}
self.addEventListener("message", function (event) {
  var m = event.data;
  if (!m || m.t !== "oros-focus" || !m.snap || typeof m.snap !== "object") return;
  var body;
  try { body = JSON.stringify(m.snap); } catch (e) { return; }
  if (body.length > 200000) return;
  focusSnap = m.snap;
  event.waitUntil(caches.open(FOCUS_CACHE).then(function (c) {
    return c.put("/__focus", new Response(body, { headers: { "Content-Type": "application/json" } }));
  }).catch(function () {}));
});
self.addEventListener("push", function (event) {
  var d = null;
  try { d = event.data ? event.data.json() : null; } catch (e) { d = null; }
  if (!d || d.v !== 1 || typeof d.title !== "string" || typeof d.k !== "string") return;
  event.waitUntil(Promise.all([focusReady, self.clients.matchAll({ type: "window", includeUncontrolled: true })]).then(function (all) {
    var list = all[1];
    var onScreen = list.some(function (c) { return c.visibilityState === "visible"; });
    if (onScreen && d.ns !== "system") return;
    var alarm = d.kind === "alarm";
    var hush = !alarm && focusQuiet(focusSnap, d.ns, Date.now());
    return self.registration.showNotification("orOS — " + d.title.slice(0, 120), {
      body: typeof d.body === "string" ? d.body.slice(0, 240) : "",
      tag: d.k.slice(0, 200),
      renotify: alarm,
      requireInteraction: alarm,
      silent: hush,
      vibrate: alarm ? [400, 200, 400, 200, 400] : hush ? [] : [200],
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      timestamp: typeof d.at === "number" ? d.at : Date.now(),
      data: { link: typeof d.link === "string" ? d.link.slice(0, 200) : "" }
    });
  }));
});

self.addEventListener("notificationclick", function (event) {
  var link = (event.notification.data && event.notification.data.link) || "";
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var c = list.filter(function (w) { return new URL(w.url).origin === self.location.origin; })[0];
    if (c) {
      if (link) c.postMessage({ t: "oros-push-open", link: link });
      return c.focus();
    }
    return self.clients.openWindow("./" + (link ? "?phone-open=" + encodeURIComponent(link) : ""));
  }));
});
