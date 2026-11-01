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

var CACHE_VERSION = "oros-v5.03.00";
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
  "./search.js",
  "./shell.js",
  "./sync.js",
  "./fs.js",
  "./dialogs.js",
  "./pcdialog.js",
  "./notifications.js",
  "./pet.css",
  "./pet.js",
  "./launcher.js",
  "./quickmenu.js",
  "./profiles.js",
  "./seasonal.js",
  "./osk.js",
  "./qsettings.js",
  "./widgets.js",
  "./fileopen.js",
  "./phone.js",
  "./webpush.js",
  "./vault.js",
  "./remote-link.js",
  "./i18n.js",
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
  "photolab/solo.html",
  "photolab/manifest.webmanifest",
  "invoices/solo.html",
  "invoices/manifest.webmanifest",
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
  "icons/solo/photolab.svg",
  "icons/solo/photolab-192.png",
  "icons/solo/photolab-512.png",
  "icons/solo/photolab-maskable-512.png",
  "icons/solo/invoices.svg",
  "icons/solo/invoices-192.png",
  "icons/solo/invoices-512.png",
  "icons/solo/invoices-maskable-512.png",
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
  "whiteboard/assist.js",
  "whiteboard/help.en.txt",
  "whiteboard/help.el.txt",
  "kanban/search.js",
  "notes/",
  "notes/index.html",
  "notes/notes.css",
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
  "sky/sky.css",
  "sky/core.js",
  "sky/stars.js",
  "sky/sky.js",
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
  "quote/quote.css",
  "quote/quote.js",
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
  "signature/signature.css",
  "signature/core.js",
  "signature/signature.js",
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
  "layout/blend.js",
  "layout/idml.js",
  "layout/pdfin.js",
  "layout/linefit.js",
  "layout/afread.js",
  "layout/rebuild.js",
  "designkit/zipin.js",
  "layout/wordin.js",
  "layout/io.js",
  "layout/house.js",
  "layout/intake.js",
  "layout/autolay.js",
  "layout/houseui.js",
  "designkit/assets.js",
  "designkit/fx.js",
  "designkit/blend.js",
  "designkit/media.js",
  "designkit/model.js",
  "designkit/docstore.js",
  "designkit/pdf.js",
  "designkit/render.js",
  "designkit/show.js",
  "designkit/templates.js",
  "designkit/cover.js",
  "designkit/text.js",
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
  "sky/help.en.txt",
  "sky/help.el.txt",
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
  "units/help.en.txt",
  "units/help.el.txt",
  "stickies/help.en.txt",
  "stickies/help.el.txt",
  "textcase/help.en.txt",
  "textcase/help.el.txt",
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
  "device/help.en.txt",
  "device/help.el.txt",
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
  "quote/help.en.txt",
  "quote/help.el.txt",
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
  "signature/help.en.txt",
  "signature/help.el.txt",
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
  "trees/help.en.txt",
  "trees/help.el.txt",
  "aura/help.en.txt",
  "aura/help.el.txt",
  "photolab/package.js",
  "photolab/help.en.txt",
  "photolab/help.el.txt",
  "whack/help.en.txt",
  "whack/help.el.txt",
  "wheel/help.en.txt",
  "wheel/help.el.txt",
  "wordle/help.en.txt",
  "wordle/help.el.txt",
  "wordsearch/help.en.txt",
  "wordsearch/help.el.txt",
  "xeri/help.en.txt",
  "xeri/help.el.txt",
  "zen/help.en.txt",
  "zen/help.el.txt",
  "vendor/codemirror/cm-core.min.js",
  "vendor/codemirror/cm-web.min.js",
  "vendor/codemirror/cm-python.min.js",
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
  "wheel/wheel.css",
  "wheel/wheel.js",
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
  "device/device.css",
  "device/core.js",
  "device/device.js",
  "assistant/",
  "assistant/index.html",
  "assistant/assistant.css",
  "assistant/doctext.js",
  "assistant/core.js",
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
  "settings/help.en.txt",
  "settings/help.el.txt",
  "today/",
  "today/index.html",
  "today/today.css",
  "today/today.js",
  "today/agg.js",
  "today/host.js",
  "today/help.en.txt",
  "today/help.el.txt",
  "calendar/occur.js",
  "todo/core.js",
  "quote/core.js",
  "kanban/core.js",
  "contacts/dates.js",
  "contacts/vcard.js",
  "contacts/dav.js",
  "todo/today.js",
  "quote/today.js",
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
  "sky/today.js",
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
  "wallpaper/wallpaper.css",
  "wallpaper/wallpaper.js",
  "trees/",
  "trees/index.html",
  "trees/trees.css",
  "trees/core.js",
  "trees/trees.js",
  "aura/",
  "aura/index.html",
  "aura/aura.css",
  "aura/core.js",
  "aura/aura.js",
  "photolab/",
  "photolab/index.html",
  "photolab/photolab.css",
  "photolab/core.js",
  "photolab/tiles.js",
  "photolab/history.js",
  "photolab/select.js",
  "photolab/guides.js",
  "photolab/paint.js",
  "photolab/resample.js",
  "photolab/adjust.js",
  "photolab/filters.js",
  "photolab/store.js",
  "photolab/psd.js",
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
  "atelier/anim.js",
  "atelier/morph.js",
  "atelier/core.js",
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
  "atelier/motion.js",
  "atelier/zip.js",
  "mockups/",
  "mockups/index.html",
  "mockups/mockups.css",
  "mockups/core.js",
  "mockups/print.js",
  "mockups/scene.js",
  "mockups/mockups.js",
  "mockups/search.js",
  "mockups/help.en.txt",
  "mockups/help.el.txt",
  "vendor/three/three.module.min.js",
  "vendor/three/three.core.min.js",
  "importkit.js",
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
  "units/",
  "units/index.html",
  "units/units.css",
  "units/core.js",
  "units/units.js",
  "units/search.js",
  "stickies/",
  "stickies/index.html",
  "stickies/stickies.css",
  "stickies/core.js",
  "stickies/host.js",
  "links/core.js",
  "links/host.js",
  "links/woo.js",
  "links/mydata.js",
  "links/mail.js",
  "links/crm.js",
  "links/todo.js",
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
  "textcase/",
  "textcase/index.html",
  "textcase/textcase.css",
  "textcase/core.js",
  "textcase/textcase.js",
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
  "assistant/additems2.js",
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
  "calculator/core.js",
  "calendar/free.js",
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
  "gamecenter/core.js",
  "gamecenter/gamecenter.css",
  "gamecenter/gamecenter.js",
  "gamecenter/index.html",
  "gamekit/daily.js",
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
  "meals/import.js",
  "meals/nutrition.js",
  "meals/pantry.js",
  "meals/house.js",
  "montage/asr.js",
  "montage/denoise.js",
  "montage/reframe.js",
  "mood/vocab.js",
  "notes/md.js",
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
  "studio/fxchain.worklet.js",
  "studio/loops.js",
  "studio/midi.js",
  "studio/bridge.js",
  "studio/sfz.js",
  "studio/sounds.js",
  "studio/notes.js",
  "studio/roll.js",
  "television/core.js",
  "time/cities.js",
  "time/clock-core.js",
  "today/layout.js",
  "todo/model.js",
  "todo/vtodo.js",
  "todo/dav.js",
  "todo/house.js",
  "travel/booking.js",
  "vendor/hash-wasm/argon2.umd.min.js",
  "vendor/jsqr/jsQR.js",
  "vendor/fzstd/fzstd.umd.js",
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
  "fonts/nunito-extrabold.woff2"
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
var PRECACHE_HASH = {"./":"c6f4b3030d8b088e","./index.html":"c6f4b3030d8b088e","./style.css":"e60a90411231309d","./search.js":"a1e3db47e1a98f86","./shell.js":"a6c381133e3b474a","./sync.js":"62a9765049c7a7a5","./fs.js":"887d97f0e01a1869","./dialogs.js":"f8f35595ec2e5ec0","./pcdialog.js":"09edb1011f2e7c24","./notifications.js":"9d06d2fb4faa9256","./pet.css":"393a4afc8465b086","./pet.js":"42e58fde90fca810","./launcher.js":"a050b7ba281df265","./quickmenu.js":"dd3ece227cbd977a","./profiles.js":"3c4e92aa3c276e34","./seasonal.js":"801e6bc2f9dac4f5","./osk.js":"7d3d6f7040485320","./qsettings.js":"23916349030d9d78","./widgets.js":"0a745b2f6b0477d6","./fileopen.js":"e61d51da414eb43e","./phone.js":"47d012589f456729","./webpush.js":"c18d0c8ee5fc11bc","./vault.js":"d9032148c98dd876","./remote-link.js":"ae908e04404965aa","./i18n.js":"4070c1f249bec79e","./diag.js":"7a85648fb98b9fb0","./i18n-tables.js":"a993e7c02cc75ca2","./translations.js":"2417a0ab3b524cd5","./lock.js":"77daaff2abe5dbaf","./apps.json":"fd6dff5f686d331f","./manifest.webmanifest":"b701d5b39c3177f9","./icon.svg":"4825463eacb6f0eb","./icons/icon-192.png":"4630cba28e0c8737","./icons/icon-512.png":"f0f49665b9bbe0af","./icons/icon-maskable-192.png":"de56ba1e9fe1431e","./icons/icon-maskable-512.png":"34c2daf2f56189de","./solo.js":"4bf8c86aa319d10c","notes/solo.html":"bb72d085c5fbd236","notes/manifest.webmanifest":"350b22032589d79a","calendar/solo.html":"475c926138e88d64","calendar/manifest.webmanifest":"71290151dc81e76b","bookmarks/solo.html":"2c4d20c82535490d","bookmarks/manifest.webmanifest":"7f2835755cbea0a3","todo/solo.html":"19a8bec5794878d2","todo/manifest.webmanifest":"6f744e2238417763","contacts/solo.html":"8ed86b4cb1f1a075","contacts/manifest.webmanifest":"eb68b9f0953fe6af","writer/solo.html":"10a8da7e410a4394","writer/manifest.webmanifest":"af0485647923ff45","spreadsheet/solo.html":"6725690cd5e76eb9","spreadsheet/manifest.webmanifest":"4947525a6ea8e45a","kanban/solo.html":"a9933eeb47453ee6","kanban/manifest.webmanifest":"898ef646f4488bb7","mindmap/solo.html":"6cff6e0945eefb82","mindmap/manifest.webmanifest":"c13f7c0be944a835","wiki/solo.html":"fca02c3f6ce58df6","wiki/manifest.webmanifest":"904aa13d4b15c524","slides/solo.html":"9045a50862cdd8f8","slides/manifest.webmanifest":"76ddca68ab6dcdb5","passwords/solo.html":"32b6ebbca125b134","passwords/manifest.webmanifest":"04fbb54f14a60159","budget/solo.html":"fcdfd70d99f8d78a","budget/manifest.webmanifest":"f98c8024e129129f","habits/solo.html":"2a4bcdeabd8733ce","habits/manifest.webmanifest":"6f75031b5daca947","water/solo.html":"5f496bb37a41534c","water/manifest.webmanifest":"6d75c2dfcbcb3c56","diary/solo.html":"105be6440eeb8283","diary/manifest.webmanifest":"791fba93d7e30a65","mood/solo.html":"76d539127f857a40","mood/manifest.webmanifest":"0358c0b55b5ff84c","fitness/solo.html":"73357ba473018c65","fitness/manifest.webmanifest":"316ef568ae171982","health/solo.html":"d00f96037af624ce","health/manifest.webmanifest":"a9ec5adf12840509","cycle/solo.html":"282fce0c40a67015","cycle/manifest.webmanifest":"f79a574b6c058bc4","calculator/solo.html":"3cc99f7d7d850b5d","calculator/manifest.webmanifest":"c8de03dbd54331c4","time/solo.html":"7c3af51b183be2b8","time/manifest.webmanifest":"13408b4f11469a2e","weather/solo.html":"8e2242857a533f9a","weather/manifest.webmanifest":"a376a1adaae97b1d","maps/solo.html":"9b93e62f0253d1c2","maps/manifest.webmanifest":"15f2d8e3306f385a","feeds/solo.html":"2ae026cea1bb2d44","feeds/manifest.webmanifest":"f30abef123d4f35c","mail/solo.html":"ad05926d6bd77fc3","mail/manifest.webmanifest":"379b197c779a7082","files/solo.html":"c3ad7569aea49c7e","files/manifest.webmanifest":"eae7ec2fb808816d","podcasts/solo.html":"a3ab4ffa4f021198","podcasts/manifest.webmanifest":"7b2984ee788f6f01","radio/solo.html":"d54fa85c7964126a","radio/manifest.webmanifest":"44913b2b3649745e","photolab/solo.html":"2a792d57bbb9d347","photolab/manifest.webmanifest":"ca53cdcd5516d15a","invoices/solo.html":"93185cb3e82d3be0","invoices/manifest.webmanifest":"d2ab59e312cc9454","crm/solo.html":"9e4bb5c71ff7633a","crm/manifest.webmanifest":"ae21ce85af347572","timesheet/solo.html":"4b9e566cbe37fb7f","timesheet/manifest.webmanifest":"6b1f58c430796188","gamecenter/solo.html":"600b90bcaa99ef54","gamecenter/manifest.webmanifest":"7698af72b0fc175f","icons/solo/notes.svg":"0a256b46eb0d9f69","icons/solo/notes-192.png":"512b5c44e8b64b1c","icons/solo/notes-512.png":"ea7e9961d67bc261","icons/solo/notes-maskable-512.png":"903a79de59bf7a97","icons/solo/calendar.svg":"b0fe8b94257aff97","icons/solo/calendar-192.png":"30d42fa2d8dff6e6","icons/solo/calendar-512.png":"ac407bc09c6ca8e4","icons/solo/calendar-maskable-512.png":"4220feec36b30f24","icons/solo/bookmarks.svg":"eb8b3c8db4aca859","icons/solo/bookmarks-192.png":"2d93446a86a2b8ec","icons/solo/bookmarks-512.png":"5c79046d12efa427","icons/solo/bookmarks-maskable-512.png":"dc3e1956f8adaa4b","icons/solo/todo.svg":"9cb8ad0f4e35c959","icons/solo/todo-192.png":"f29c2f5506e9b625","icons/solo/todo-512.png":"fb6c0e61b5845059","icons/solo/todo-maskable-512.png":"128274aa7d8732ef","icons/solo/contacts.svg":"4a999cf73e182a23","icons/solo/contacts-192.png":"1397b8e26d84d915","icons/solo/contacts-512.png":"3793b8f35c564d10","icons/solo/contacts-maskable-512.png":"ce22d952b94be164","icons/solo/writer.svg":"26ffb02fbd0d9ac8","icons/solo/writer-192.png":"6757e6507c90138c","icons/solo/writer-512.png":"9fda30911c8948b0","icons/solo/writer-maskable-512.png":"7476a73a474af5c3","icons/solo/spreadsheet.svg":"e6d24e1db0bd87ab","icons/solo/spreadsheet-192.png":"12773f1aee654951","icons/solo/spreadsheet-512.png":"e31a2e51b3ac44a8","icons/solo/spreadsheet-maskable-512.png":"bec16ee6a8275a13","icons/solo/kanban.svg":"3b139b994e5b519d","icons/solo/kanban-192.png":"5fa41428e275ec02","icons/solo/kanban-512.png":"0f47f49c6efea1a5","icons/solo/kanban-maskable-512.png":"ecd8ae5e60cab24c","icons/solo/mindmap.svg":"d55132e8170d3f7f","icons/solo/mindmap-192.png":"dcabb12139f75ee9","icons/solo/mindmap-512.png":"1b3c2aea54c932f6","icons/solo/mindmap-maskable-512.png":"4f8f6e9e808dbc7f","icons/solo/wiki.svg":"1403a7f8c23f911d","icons/solo/wiki-192.png":"40a1a4bfda94171f","icons/solo/wiki-512.png":"c2e1063281ccbf0c","icons/solo/wiki-maskable-512.png":"a6defe3cb04434cb","icons/solo/slides.svg":"7e08d6136491757a","icons/solo/slides-192.png":"47033b8bb61331bb","icons/solo/slides-512.png":"2a075a07a46b4d13","icons/solo/slides-maskable-512.png":"48efddd00445f62e","icons/solo/passwords.svg":"822ecb069f070ab9","icons/solo/passwords-192.png":"f8a8c48eb8fd1b0d","icons/solo/passwords-512.png":"49d6a7df99250be4","icons/solo/passwords-maskable-512.png":"6fab6cca2722d9f3","icons/solo/budget.svg":"35dc1898781536f9","icons/solo/budget-192.png":"ea0651865fe6155a","icons/solo/budget-512.png":"6daa3d92d446c739","icons/solo/budget-maskable-512.png":"da3e24d7f8eece1e","icons/solo/habits.svg":"2c119601ca3bce88","icons/solo/habits-192.png":"a7ed2f02ee66703d","icons/solo/habits-512.png":"1a25e9931fd16733","icons/solo/habits-maskable-512.png":"81c4b1d4f1729a74","icons/solo/water.svg":"33c189f1da44cd18","icons/solo/water-192.png":"d2d2f8ee78308afb","icons/solo/water-512.png":"546317bc607a30d4","icons/solo/water-maskable-512.png":"3cb30c4cecc75e65","icons/solo/diary.svg":"368e072df3103213","icons/solo/diary-192.png":"acef8b7075082c78","icons/solo/diary-512.png":"a58295440d23e637","icons/solo/diary-maskable-512.png":"8e8edea78af26ebf","icons/solo/mood.svg":"231a230c9e417e65","icons/solo/mood-192.png":"c6ed5bb26e0472ab","icons/solo/mood-512.png":"5dea0077ca8a9ace","icons/solo/mood-maskable-512.png":"63f479a335f2144c","icons/solo/fitness.svg":"64cce1b940d97566","icons/solo/fitness-192.png":"5644eefbd5e172cd","icons/solo/fitness-512.png":"763cfed654817724","icons/solo/fitness-maskable-512.png":"6719c52bee3c89b9","icons/solo/health.svg":"65d5a3d7ea10cb56","icons/solo/health-192.png":"88b1fcaa6d2bc157","icons/solo/health-512.png":"2e23c5337492bfde","icons/solo/health-maskable-512.png":"88280b224c271532","icons/solo/cycle.svg":"6aca2878ebfc220a","icons/solo/cycle-192.png":"3fa75a3019195439","icons/solo/cycle-512.png":"4f34f7987486b81d","icons/solo/cycle-maskable-512.png":"7ba99727c213e677","icons/solo/calculator.svg":"7b270cc7a4fced69","icons/solo/calculator-192.png":"d8153dfb19676acb","icons/solo/calculator-512.png":"8ba3e9c635790230","icons/solo/calculator-maskable-512.png":"35e7280ede20617f","icons/solo/time.svg":"972717376fae4b6d","icons/solo/time-192.png":"0d72c6f2eaaf408d","icons/solo/time-512.png":"35b64980b7c57376","icons/solo/time-maskable-512.png":"2ede1a888926621f","icons/solo/weather.svg":"9fa45084b17a8ea0","icons/solo/weather-192.png":"b539133f98982a80","icons/solo/weather-512.png":"545105390541bd23","icons/solo/weather-maskable-512.png":"ac96b12669e620ef","icons/solo/maps.svg":"7d624ecf92af5304","icons/solo/maps-192.png":"bfb3a07aacfe98e4","icons/solo/maps-512.png":"5f35615000c112d3","icons/solo/maps-maskable-512.png":"dd3a9628ec96bae6","icons/solo/feeds.svg":"5f96cd826ff6f54f","icons/solo/feeds-192.png":"ff4f6b7d85ec4a10","icons/solo/feeds-512.png":"7d63a3cb2e18081e","icons/solo/feeds-maskable-512.png":"866e1cbb6fbac510","icons/solo/mail.svg":"b68682641aa032af","icons/solo/mail-192.png":"4e93561d5f3b526e","icons/solo/mail-512.png":"b89a9cc40e340ec0","icons/solo/mail-maskable-512.png":"1b1efb6c0b6eeed1","icons/solo/files.svg":"8195afdbecffd95c","icons/solo/files-192.png":"5fd5df3e57be40bf","icons/solo/files-512.png":"6d560f6ed3fcda67","icons/solo/files-maskable-512.png":"21ab3b748d49562f","icons/solo/podcasts.svg":"d9f6c8b6279a0d16","icons/solo/podcasts-192.png":"acd9679c14a35437","icons/solo/podcasts-512.png":"543ff786ed0fb8f7","icons/solo/podcasts-maskable-512.png":"41e99fadca00b8fe","icons/solo/radio.svg":"dd40a13c4d033cae","icons/solo/radio-192.png":"114252f22ca86003","icons/solo/radio-512.png":"29ce1f02b12d02b0","icons/solo/radio-maskable-512.png":"70b9dcb6d048d281","icons/solo/photolab.svg":"db058eb7d42dd94b","icons/solo/photolab-192.png":"6e4c873dd64eac67","icons/solo/photolab-512.png":"a4e7f5a314d2047c","icons/solo/photolab-maskable-512.png":"f382647648292be1","icons/solo/invoices.svg":"49036fc32a5ef182","icons/solo/invoices-192.png":"4b7e66707c06e933","icons/solo/invoices-512.png":"6ffd5af4d75f44b9","icons/solo/invoices-maskable-512.png":"96336339c4699731","icons/solo/crm.svg":"10f69bbd5ccb0c2f","icons/solo/crm-192.png":"e6dd60322b2878a8","icons/solo/crm-512.png":"0b226ec9d552e973","icons/solo/crm-maskable-512.png":"44c9a5ed2e7af687","icons/solo/timesheet.svg":"06976a7b043ed9d0","icons/solo/timesheet-192.png":"9e87a7edd6198165","icons/solo/timesheet-512.png":"ea28ec493d834cf8","icons/solo/timesheet-maskable-512.png":"9d393ec08afa3bc4","icons/solo/gamecenter.svg":"7a7ba230c2eab317","icons/solo/gamecenter-192.png":"5763dbe4874de9cc","icons/solo/gamecenter-512.png":"411738c910781634","icons/solo/gamecenter-maskable-512.png":"e858c4aad9b69a96","todo/":"980bb97c06953192","todo/index.html":"980bb97c06953192","todo/todo.css":"15db4464825832a5","todo/todo.js":"70329f2d3d18a424","todo/import.js":"702430dc44769c63","todo/gtasks.js":"cc9d283a7028f5b3","todo/search.js":"f50e0b73a1137eda","todo/platforms.js":"fa91daca6a9ac22b","todo/package.js":"b500c682a8a1a9c3","kanban/":"e2271969f0649ca3","kanban/index.html":"e2271969f0649ca3","kanban/kanban.css":"d3cb90c3e91367e1","kanban/kanban.js":"cf1b0615377fdb9b","kanban/import.js":"f64731c625fa770f","mindmap/":"a260b92e6c7a4120","mindmap/index.html":"a260b92e6c7a4120","mindmap/search.js":"e74f00ed95795de6","mindmap/mindmap.css":"1f6f687989ece379","mindmap/mm-core.js":"1ebfc597b9b4da07","mindmap/mm-import.js":"159039d1828a3bc7","mindmap/mindmap.js":"cdfc2d044b764f95","mindmap/commands.js":"e0d193c9e59ae381","mindmap/assist.js":"4960dbfb95bab8ff","mindmap/help.en.txt":"564c18d2c47877b3","mindmap/help.el.txt":"f04edd516081bba4","whiteboard/":"d65e70c78d8c9560","whiteboard/index.html":"d65e70c78d8c9560","whiteboard/app.css":"ddd003628febefcc","whiteboard/core.js":"3bb31c05f101807c","whiteboard/kit.js":"6c2b3373fe2079b3","whiteboard/app.js":"71df22aef35d98b8","whiteboard/search.js":"217f7b2029bfe9ca","whiteboard/commands.js":"dff0852df62fd6ad","whiteboard/assist.js":"b68928f8278b8510","whiteboard/help.en.txt":"15a7108c09c77565","whiteboard/help.el.txt":"8f1fd9eb0dc80ccc","kanban/search.js":"b5afcfc8ee713628","notes/":"60ea2588204f0a33","notes/index.html":"60ea2588204f0a33","notes/notes.css":"fd8f0c33f54c8cc4","notes/notes.js":"4c5b6875d9758086","notes/package.js":"ec568f4dfad84de0","notes/house.js":"2ca5db87f097e949","notes/search.js":"cdb77b725471c346","notes/platforms.js":"04e9c3651fe3c45a","wiki/":"43352f35937ea6f6","wiki/index.html":"43352f35937ea6f6","wiki/wiki.css":"b02be7bfa4966696","wiki/core.js":"0977c28c9894f299","wiki/wiki.js":"6d2f1fd879f48d4a","wiki/import.js":"8e8671f752a0bc82","wiki/search.js":"3c4c9f3323fe5171","wiki/pdf.js":"f967c543f82dc2e7","wiki/io.js":"ee9587d8815cb0ed","weather/":"e3927edd1b522ea9","weather/index.html":"e3927edd1b522ea9","weather/weather.css":"f00f182b4f8b545c","weather/weather.js":"907f7508b787a4f0","mood/":"87e77bb7d9778c78","mood/index.html":"87e77bb7d9778c78","mood/search.js":"2063766d61208ce6","mood/mood.css":"503d4c1d3e298a87","mood/mood.js":"9e173a8e7a4b49a1","mood/import.js":"0b9d66633b9ea6e5","diary/":"0bd59030312af5e1","diary/index.html":"0bd59030312af5e1","diary/search.js":"50d92d9221b620a4","diary/diary.css":"c968fbdacec4151a","diary/core.js":"3c20efb46cb7029f","diary/diary.js":"c44919afe3925eb0","diary/import.js":"a535a456e69035d1","time/":"877015c067819f36","time/index.html":"877015c067819f36","time/time.css":"d7f019254d92c4f1","time/time.js":"0bd53739d30de97a","time/astro.js":"9f5d860792c82021","time/stage-core.js":"10864f90fde75a9b","time/stage.js":"a82cc3e4f03d4f78","time/stage-view.js":"36f7d0092750645f","time/stage-view.css":"673db140a592a7c1","time/display.html":"6194d74e8fa546d2","time/display.js":"b496577a3abff9c6","time/stage-link.js":"b6aff283729f4de2","time/stage-tools.js":"7fdefd247a5c1f5a","time/search.js":"745959c4574edff6","sky/":"200eff27cd1ed294","sky/index.html":"200eff27cd1ed294","sky/sky.css":"16a69f2d4be72375","sky/core.js":"c10c5a0a618a30b0","sky/stars.js":"d3e6dc8ecd82d004","sky/sky.js":"4021d0e7cb817095","calendar/":"2b599f2096318595","calendar/index.html":"2b599f2096318595","calendar/calendar.css":"d4287fb4f3e5f913","calendar/calendar.js":"2ec175f6026a5015","calendar/namedays.js":"609f39a781931ff5","calendar/ics.js":"257139e361e73e89","calendar/gcal.js":"77c19b7e73cf3e3a","calendar/days.json":"20b14d6ade03a9da","calendar/search.js":"69a2d21ebf231996","quote/":"09f70b23b8a9cc31","quote/index.html":"09f70b23b8a9cc31","quote/search.js":"777bba48df86ce54","quote/quote.css":"360202850f25deef","quote/quote.js":"5f2ed2e61f71f79d","invoices/":"ff21b45b9dcfa3b9","invoices/index.html":"ff21b45b9dcfa3b9","invoices/invoices.css":"12ea557a38a4e531","invoices/core.js":"44c641847b3f32d4","invoices/invoices.js":"c15c8e1210ca1b0e","invoices/search.js":"aa10ea03b84b85d5","newsletter/":"6ba89ba231b5e542","newsletter/index.html":"6ba89ba231b5e542","newsletter/newsletter.css":"cfa10e6a62decf58","newsletter/social.js":"401e0135f4d4a55f","newsletter/core.js":"74d4c15d473fde42","newsletter/render.js":"dc8f4a381a7b4299","newsletter/engine.js":"17dfa123a4a241d5","newsletter/runner.js":"a4d802389bc77634","newsletter/today.js":"abe1d9ecc2d4fcf8","newsletter/archive.js":"fae36cec34c02a4a","newsletter/platforms.js":"fb7a5bb2064279e2","newsletter/shop.js":"747f2e01799a28b1","newsletter/newsletter.js":"05085b0bb5740d36","newsletter/import2.js":"19014f0442c80ba9","newsletter/search.js":"a00f22ef1812cbcc","signature/":"30800fb4c5b7b622","signature/index.html":"30800fb4c5b7b622","signature/signature.css":"af79ff06709fd851","signature/core.js":"19e1832b9b2d655d","signature/signature.js":"4a7873bd9e8c9753","signature/search.js":"bb4b8ff5c24c4283","certificates/":"ae54a58e77a258e6","certificates/index.html":"ae54a58e77a258e6","certificates/certificates.css":"b13788c2a98b611f","certificates/core.js":"06afd9554de074cc","certificates/dk.js":"e44afa3ed2b57345","certificates/certificates.js":"f7c9c17bd0971461","certificates/package.js":"fd4c4b8b6dadf6a9","certificates/search.js":"c896dd67f7cd7012","certificates/badges.js":"a3c4cdd705a07639","certificates/send.js":"fc1e3ed4ddb92b07","publish/":"89bbfa06b20d3cb7","publish/index.html":"89bbfa06b20d3cb7","publish/app.css":"875846931c694349","publish/core.js":"444f0f6feb216558","publish/app.js":"439769baab45c341","publish/search.js":"c67213cdd0d82e87","publish/feed.js":"d086e4a03521e57c","publish/today.js":"ecc4b751212127e8","publish/royalty.js":"18df70d98f570984","invoices/today.js":"0a246efe2772379f","invoices/mydata-ui.js":"a46efd275ad20927","crm/":"38bf6ead6c41fc6d","crm/index.html":"38bf6ead6c41fc6d","crm/crm.css":"548a09a99a43702e","crm/core.js":"5e7ac76da9ba962e","crm/contactsync.js":"c56d33cc07ee107c","crm/links.js":"9dfa1c8583f543ab","crm/overview.js":"88051d6624baf998","crm/timeline.js":"635601dca0289570","crm/rs.js":"abeb363ad85635f4","crm/platforms.js":"556cc78133bf2a67","crm/webform.js":"c2bee22572a4a1ea","crm/crm.js":"9d945d69f03f8c58","crm/search.js":"f86546da6dce139e","crm/today.js":"7a5076b2f5f00152","timesheet/":"d131a278504f84ce","timesheet/index.html":"d131a278504f84ce","timesheet/search.js":"322cc8fa78ea74cd","timesheet/timesheet.css":"293daf73f42152d0","timesheet/core.js":"f424750773bab0c5","water/":"732f6de9ea7bd760","water/index.html":"732f6de9ea7bd760","water/water.css":"c36f4a97d86be5fa","water/core.js":"f954148abda761eb","mail/":"3523f46c03e61e5b","mail/index.html":"3523f46c03e61e5b","mail/search.js":"00e2ac77074ffd7c","mail/mail.css":"cd75a2292ae68aef","mail/mail.js":"bd705d2e7e4b2610","mail/mime.js":"9774fdbd30a08327","mail/sanitize.js":"68616c325a66b658","mail/compose.js":"7e86828f16bc1ff9","mail/notify.js":"c9f3c6e0e1620287","mail/trust.js":"ae90c4afd71f16d4","mail/rules.js":"ebe9226fcc5b7367","mail/rich.js":"7a1e73aa03ccfb7b","mail/threads.js":"fc460ab1036c9f7f","mail/outbox.js":"53d22ef6f1dc6f82","mail/people.js":"06152f0675778ee4","mail/sieve.js":"bacd3026b7cf5a82","shelf/":"ea6dd4f382224dcf","shelf/index.html":"ea6dd4f382224dcf","shelf/search.js":"8437b31b456f25a3","shelf/feed.js":"cece651580c20fe3","shelf/shelf.css":"2ef7781b3c3b6588","shelf/shelf.js":"af4f35ad6e595c9f","shelf/import.js":"f7b7bb3aed8b736e","shelf/gbooks.js":"267e3f1f70e6a0d6","library/":"1e7054132b6b8b52","library/index.html":"1e7054132b6b8b52","library/search.js":"6327192e8131f879","library/speak.js":"fe7092a7d58fa41e","library/stats.js":"6d5635791ea20fe9","library/import.js":"dada4a0a450ded52","library/hlimport.js":"3c7ebe2cd6e94c92","library/today.js":"f1d1b5ffaaf2603e","library/lookup.js":"8b2c8ad705542616","library/library.css":"38dd34511fedb6aa","library/core.js":"8fc2f00978dc1d81","library/sanitize.js":"221f1fda1cb80918","library/strings.js":"422f98c21aa82309","library/app.js":"356c2bac13fd53cf","library/store.js":"444b49000a9f34c1","library/home.js":"f3667a0a6d930be1","library/reader.js":"7b46b364ee1a603a","library/epub.js":"030698b15140c70b","library/pdfview.js":"09c3959d80cb0211","water/water.js":"889b3828dfda2f56","water/help.en.txt":"4b88f11e1c11fcb1","water/help.el.txt":"d3d0166a1d39faec","timesheet/timesheet.js":"d92275edf697cfec","timesheet/import.js":"6d6dc6bf2a82d489","storage/":"05d47d863be2dc63","storage/index.html":"05d47d863be2dc63","storage/search.js":"4d238a908d6b253c","storage/storage.css":"0d43161a23dce802","storage/storage.js":"ee4549bdc24653f2","storage/import.js":"caa78696478d8da5","bookmarks/":"2bcd3621cf52700b","bookmarks/index.html":"2bcd3621cf52700b","qr/":"31ebd44920cc146d","qr/index.html":"31ebd44920cc146d","qr/qr.css":"5b3ca11578f54bdf","qr/qr-encode.js":"acbee70852b156d7","qr/qr-payload.js":"21446a83f0a1c326","qr/qr.js":"0e8dbd3ad56fbd3d","bookmarks/bookmarks.css":"0f52f1f3d4e8049f","bookmarks/bookmarks.js":"e3d62740bba8493d","bookmarks/import.js":"9d6f441969204cf1","bookmarks/search.js":"da198258d63fbe5d","bookmarks/platforms.js":"0b49dea2721495b4","prompter/":"2ef361e9e934866e","prompter/index.html":"2ef361e9e934866e","prompter/search.js":"f3eb677cdbbfb43e","pubdomain/":"bc983585f17effe1","pubdomain/index.html":"bc983585f17effe1","pubdomain/pubdomain.css":"cdfeab5e129cd80e","pubdomain/rules.js":"2fac761f19672d54","pubdomain/pubdomain.js":"0a56dece0c6593cc","pubdomain/help.en.txt":"58f9e7c748c5cc31","pubdomain/help.el.txt":"02569d5019fa89a1","prompter/prompter.css":"3ec843754cfffad6","prompter/prompter.js":"c4e1dba0509741b0","prompter/io.js":"6c7af6357c1f80ba","typewriter/":"cc85deb0f5cd8f81","typewriter/index.html":"cc85deb0f5cd8f81","typewriter/typewriter.css":"869484f9b56fde89","typewriter/core.js":"20270e9b488d27be","typewriter/typewriter.js":"8c123864e141bfd8","labels/":"0aa6dfd33454ccaa","labels/index.html":"0aa6dfd33454ccaa","labels/labels.css":"8d21312b6a79bfcd","labels/core.js":"8b5fdc4243a97507","labels/labels.js":"08728a46a57e23a6","typewriter/help.en.txt":"94f603ac4a6f7fcd","typewriter/help.el.txt":"6012da88d59db013","labels/help.en.txt":"1f21cb6ebf1e4d9b","labels/help.el.txt":"29beab98ebff9c40","habits/":"98c35f6bd252ff7c","habits/index.html":"98c35f6bd252ff7c","habits/search.js":"241bb5bf6381b5fe","habits/habits.css":"4e315ad169cb300b","habits/habits.js":"6270a97c21b115c8","habits/import.js":"4dd73db2e54b53cb","meals/":"e2661748895e46b3","meals/index.html":"e2661748895e46b3","meals/search.js":"c46ba7e791a3c1dd","meals/meals.css":"f41342dff2df9e0d","meals/core.js":"df169306c5032b17","meals/meals.js":"1ce397aeebfc6eb4","zen/":"65da6e71189a8730","plants/":"2cbbc6b31fd00691","plants/index.html":"2cbbc6b31fd00691","plants/search.js":"59107d6b143f061c","plants/core.js":"42c630b908860b9f","plants/plants.css":"36156c262bf195cd","plants/plants.js":"86c354734cb9db3d","zen/index.html":"65da6e71189a8730","zen/core.js":"9bd2931d00fb5735","zen/zen.css":"9a6d2074f7258e62","zen/zen.js":"7168ea8e5545b92e","zen/import.js":"69eabc5e550f72a4","health/":"bdc72f494111d8f1","health/index.html":"bdc72f494111d8f1","health/search.js":"4d94b3fb563a2e37","health/core.js":"b56b4d7eb34f060b","health/health.css":"98b96a2674f51ce3","health/health.js":"7037e3a651cd37c5","health/import.js":"203f97523f23b4ef","health/help.en.txt":"8874e3a8f06dce00","health/help.el.txt":"b1814d4276bfd3f1","files/":"e56d546f329eb73c","files/index.html":"e56d546f329eb73c","files/files.css":"b7d3cc0a3a77752d","files/files.js":"1769b6af8b503043","files/search.js":"92c4b898a24f184d","files/dropbox-core.js":"dcefbc6e2f867ba6","files/dropbox.js":"f2685b041937f18f","files/drive.js":"2d33a86af5b0e6ac","files/computer-core.js":"005abfbb7cd573b2","files/computer.js":"1bacd40302628fc0","files/gmedia.js":"d72026d421c36bfd","files/dropbox-callback.html":"fbf916b76ab0e7d0","files/dropbox-callback.js":"e88374047152997b","writer/":"4c871737c7039ac8","writer/index.html":"4c871737c7039ac8","writer/writer.css":"ab9a0943e34b79a0","writer/writer.js":"80142d1687a0a562","writer/io.js":"dac6f3ae322a8906","writer/pdfin.js":"38ae06a583c3f4f4","writer/docxout.js":"caf1df6727f784dd","writer/convert.js":"bcb6f1345b7e473c","layout/":"188d76c55a41ab7a","layout/index.html":"188d76c55a41ab7a","layout/search.js":"a9b41e4d6d42e186","layout/layout.css":"44321dcf5e4e9c1a","layout/layout.js":"6addf87d5ccba03b","layout/editor.js":"49c3276dff71a60d","chores/":"873297e7c4900473","chores/index.html":"873297e7c4900473","chores/search.js":"a859ae404fffb42a","chores/chores.css":"6992e9b199938994","chores/chores.js":"6c24db6e0b28c48a","chores/core.js":"245001382d2290ee","layout/panels.js":"a586e55ad5e4e9f6","layout/fontpick.js":"d8643323131d3c7d","layout/story.js":"3514369e2cb1f3f4","layout/caret.js":"1a48a08b132f6c84","layout/inframe.js":"065280a45f03cb45","layout/sla.js":"248b7f6d94374d65","layout/svgin.js":"51c10b96576bd7a8","layout/blend.js":"db10a2ea02a16b7a","layout/idml.js":"75f6d19a56acfdef","layout/pdfin.js":"31f12903ef34d21f","layout/linefit.js":"72b50b438fdd2c42","layout/afread.js":"66fe22385714579a","layout/rebuild.js":"3eef57ea2d890796","designkit/zipin.js":"543978c94879e901","layout/wordin.js":"da380c54e08dc245","layout/io.js":"f4d3f52d6d3ea3c4","layout/house.js":"72e97b9713900117","layout/intake.js":"19c7422e1d13a86e","layout/autolay.js":"3f5e8e36abf1d415","layout/houseui.js":"019fc4d474e1968f","designkit/assets.js":"3ece94ef51bbba43","designkit/fx.js":"7470349a006b351c","designkit/blend.js":"fb25c52203f22c9b","designkit/media.js":"d91b69bd475e59d6","designkit/model.js":"2eb9c79287d749b3","designkit/docstore.js":"307b845cf53de2a7","designkit/pdf.js":"c93f37f186daf3cc","designkit/render.js":"906dd3f8e6a68ee7","designkit/show.js":"ea6f51a643c39dfa","designkit/templates.js":"a1169963f7995b7b","designkit/cover.js":"e7062f370eaeacf9","designkit/text.js":"7e9d18e111b8f4c9","designkit/fonts.js":"4775949dfd53fe2d","help/":"b629bb27da944a4c","help/index.html":"b629bb27da944a4c","help/search.js":"35449df66069280b","help/help.css":"d41ba8b6815535f6","help/help.js":"209b46d684dcb980","help/asio-compatible.svg":"eed7e2dbd5715b83","help/topics.json":"c13f64c7dea73bdc","help/topics/appearance.el.txt":"086e5f733a226a28","help/topics/appearance.en.txt":"211a154e500bf437","help/topics/backup.el.txt":"3a9c8470e12c1f34","help/topics/backup.en.txt":"40878d75a2630008","help/topics/data.el.txt":"d2599ebb85111303","help/topics/data.en.txt":"3fef363356e082bb","help/topics/faq.el.txt":"970f1a3944b7cb81","help/topics/faq.en.txt":"9ae2e49d84638e8b","help/topics/install.el.txt":"8e60fb8d0ddfa00f","help/topics/install.en.txt":"8b29cbf2f4b39482","help/topics/menu.el.txt":"455491f9c6837e82","help/topics/menu.en.txt":"288f4a49f7709865","help/topics/notifications.el.txt":"3408ef700bfb5e9f","help/topics/notifications.en.txt":"e1f8e6e8c0e7d6f6","help/topics/privacy.el.txt":"1e04037fe1751ae2","help/topics/privacy.en.txt":"b2fe5b30e82d410c","help/topics/reset.el.txt":"f5453ded2295d5bf","help/topics/reset.en.txt":"9c20daafeaf1721e","help/topics/share.el.txt":"31b56f96a35fafa2","help/topics/share.en.txt":"32ee09e9816423a7","help/topics/shortcuts.el.txt":"b9ccf4e2858cea08","help/topics/shortcuts.en.txt":"6b48ffb47ef6f702","help/topics/start.el.txt":"1c585ce7a98f7aac","help/topics/start.en.txt":"926b81ad5176565d","help/topics/sync.el.txt":"b36e0b7ba18390c1","help/topics/sync.en.txt":"82f7e394eb3467c3","help/topics/troubleshooting.el.txt":"653660ccdd612ea9","help/topics/troubleshooting.en.txt":"b9063058c9e7a645","help/topics/whatsnew.el.txt":"1466e54f8e890aed","help/topics/whatsnew.en.txt":"2c9ae9c3649e6c28","weather/help.en.txt":"ae9b8a03441e2aff","weather/help.el.txt":"e50c4af22639ebf3","time/help.en.txt":"8d95686c6a19fd0f","time/help.el.txt":"3b97fba2ae4613a7","sky/help.en.txt":"650acc6b1e7b7a4e","sky/help.el.txt":"ffb0c45b78d41fb8","files/help.en.txt":"7ab562be19537d35","files/help.el.txt":"547fd18436032b52","todo/help.en.txt":"e03e21bef5d59873","todo/help.el.txt":"74c64d3c8068a025","kanban/help.en.txt":"ab93fd13df3e1363","kanban/help.el.txt":"d831c492c754ca6d","notes/help.en.txt":"5a74c6d3b3bfa47c","notes/help.el.txt":"46981101e82cb2a7","wiki/help.en.txt":"306c28cf20ff3a9f","wiki/help.el.txt":"12e418f08831dea2","gamecenter/help.en.txt":"9b15c5e70b8f58ed","gamecenter/help.el.txt":"6c9d8b2c37edf63b","calendar/help.en.txt":"ea0b572ed35246f0","calendar/help.el.txt":"2135e50ffa18d833","contacts/help.en.txt":"d2a55c945b1b3fac","contacts/help.el.txt":"f7328808774ee49d","spreadsheet/help.en.txt":"835d16e455e73c1b","spreadsheet/help.el.txt":"1df1660c5b711a1d","writer/help.en.txt":"184a8d0a3d9e6289","writer/help.el.txt":"e477a2404cfc740a","bookmarks/help.en.txt":"f391bb2c64e34523","bookmarks/help.el.txt":"aaffe253ba9d9270","maps/help.en.txt":"fe7af363cfebbe53","maps/help.el.txt":"5da79734bdfe8229","help/help.en.txt":"c76f100f572198f0","help/help.el.txt":"6d4025554461bf7d","baby/help.en.txt":"76e26cb0856fea4b","baby/help.el.txt":"efc0c45e47f396b7","backgammon/help.en.txt":"0fc421325d693246","backgammon/help.el.txt":"a6d3d7891732fa16","battleship/help.en.txt":"434368a44d6aae6a","battleship/help.el.txt":"c1274fd86e9c7e4f","breakout/help.en.txt":"e1c55f950bcb2894","breakout/help.el.txt":"f3d7e2fcd1650637","bubble/help.en.txt":"62bfe76e34a47f62","bubble/help.el.txt":"e0dee756a45ca9cf","budget/help.en.txt":"47af5a4248d0ee3e","budget/help.el.txt":"7962e9e4b392ce47","calculator/help.en.txt":"4b5444ca9d1a8aa2","calculator/help.el.txt":"382a4260e0cdacee","texttools/help.en.txt":"07fd75fffe247ef8","texttools/help.el.txt":"1962fba87a1d55f6","units/help.en.txt":"45b4177c065a8ff3","units/help.el.txt":"85fa505d7bec5c5f","stickies/help.en.txt":"c1747d041c20d510","stickies/help.el.txt":"547cd80140e62b2d","textcase/help.en.txt":"8d1f5975fe426284","textcase/help.el.txt":"6767bd84c54bb1e5","pad/help.en.txt":"7199cf4409d69af4","pad/help.el.txt":"7690fd09d75ab178","characters/help.en.txt":"8218127e67d872cc","characters/help.el.txt":"bf3fa65dced60772","checkers/help.en.txt":"f99573baa701cb65","checkers/help.el.txt":"61d327b94d10df24","chess/help.en.txt":"a65e769c2e63591b","chess/help.el.txt":"3ee7a2ebe0715384","chores/help.en.txt":"d991b3d93efb3e6c","chores/help.el.txt":"3c2cf0e88e0befbb","connect4/help.en.txt":"211f4d1612183ce2","connect4/help.el.txt":"75036be30e67e7c7","crossword/help.en.txt":"1cb4f4b63139cb93","crossword/help.el.txt":"0f8e47d89c7ba899","cycle/help.en.txt":"7d306d355f8739b8","cycle/help.el.txt":"f4c1f6b16a490e64","device/help.en.txt":"0f4627124e41ada9","device/help.el.txt":"c6903ec127edd68a","dice/help.en.txt":"4a27bd916f61676d","dice/help.el.txt":"0265b1c3181c2ba2","dots/help.en.txt":"9044cf3f74c3b5e0","dots/help.el.txt":"d908a201a4be0f6b","familytree/help.en.txt":"998aeb8740c46548","familytree/help.el.txt":"43d14f3bb00c1a14","feeds/help.en.txt":"b845a0eb72914d6c","feeds/help.el.txt":"d942f49d0af1adc1","fitness/help.en.txt":"bc23a2bf53020629","fitness/help.el.txt":"c6d55221a25a86f9","flow/help.en.txt":"e59d17f83fb49deb","flow/help.el.txt":"c63a0db768707865","g2048/help.en.txt":"46fbf2456fd6908a","g2048/help.el.txt":"79f2fba01faa24df","stock/help.en.txt":"b21c558a422bcb02","stock/help.el.txt":"daa6e8ac0573d7b9","garage/help.en.txt":"15c21e6423d1cdbd","garage/help.el.txt":"fbff3a04054b1b65","gomoku/help.en.txt":"e5b3fc264ab4c0a6","gomoku/help.el.txt":"9902ea02143eade5","habits/help.en.txt":"1d90edd6cfc647e1","habits/help.el.txt":"013303fd1caa131b","hangman/help.en.txt":"f75b2c6f45817cfb","hangman/help.el.txt":"99cbac2e69b6e386","hexagon/help.en.txt":"5a79ade9f51c8698","hexagon/help.el.txt":"091fda637b269a25","jigsaw/help.en.txt":"822790860328942c","jigsaw/help.el.txt":"b297bf3c8a28dc14","layout/help.en.txt":"a126da854830faad","layout/help.el.txt":"e88fa94fc09e60a6","lightsout/help.en.txt":"6de07dec8cd70ec5","lightsout/help.el.txt":"64774a302a25d657","mahjong/help.en.txt":"affa69c0b004d6a5","mahjong/help.el.txt":"56dbdef3cf48d0f5","mail/help.en.txt":"46ddeb043476aae3","mail/help.el.txt":"31212bbd37477075","mancala/help.en.txt":"28999517de54299c","mancala/help.el.txt":"91eee9645d7e5d4e","mastermind/help.en.txt":"e8c689d9605ae7f0","mastermind/help.el.txt":"4606e4546190a9d8","meals/help.en.txt":"da5f3c73be549060","meals/help.el.txt":"32c9ec4d9efd051c","memory/help.en.txt":"ff5e498ca5821ba6","memory/help.el.txt":"54ef4f9f6f6cef0b","minesweeper/help.en.txt":"322a1d82c6ce03f7","minesweeper/help.el.txt":"c848aa2369216afb","minimalism/help.en.txt":"9318ba84949542cb","minimalism/help.el.txt":"e4d7e4ede9944a05","mixer/help.en.txt":"5b934d1f76fa25e6","mixer/help.el.txt":"c0c31449a3f099d2","ringtones/help.en.txt":"809c00ecac514a2f","ringtones/help.el.txt":"43c058c23f37e2fa","studio/help.en.txt":"695e2c3a77d51726","studio/help.el.txt":"e15dd203efe2c859","lyricsync/help.en.txt":"588bb7c6be106067","lyricsync/help.el.txt":"cd21447a885b43eb","mood/help.en.txt":"86250b9c1679f8bc","mood/help.el.txt":"8f9a409f67992531","diary/help.en.txt":"fe3a1248c2460d94","diary/help.el.txt":"8a0413646b7c8441","names/help.en.txt":"ee2fa708614d3cd5","names/help.el.txt":"c899650e98d7519b","netizen/help.en.txt":"d16e793d5ac5ee41","netizen/help.el.txt":"8809d92e32e69d64","nonogram/help.en.txt":"6d1fdfc660f0ebbb","nonogram/help.el.txt":"d46fd668734f160c","passwords/help.en.txt":"a0cb3afd1db6d6db","passwords/help.el.txt":"a84b9f058de7e0d7","petcare/help.en.txt":"3eb936fa4fca115f","petcare/help.el.txt":"4097716d852b9f5b","petworld/help.en.txt":"f3bef6918a824322","petworld/help.el.txt":"db2783b015c43903","pixel/help.en.txt":"4e8484081b948f7c","pixel/help.el.txt":"f485922ba090298e","plants/help.en.txt":"f503812db20a5e8a","plants/help.el.txt":"75f29ab1573a052b","podcasts/help.en.txt":"4a865bdd332b4e40","podcasts/help.el.txt":"f225e35d2872374d","music/help.en.txt":"23e36d35b859ae51","music/help.el.txt":"3b5692bb7821a523","pong/help.en.txt":"9995ecb0302c89ed","pong/help.el.txt":"3d394c848ac6c541","prompter/help.en.txt":"ac3c8180dc9cdb29","prompter/help.el.txt":"2c79e43bbc379e73","qr/help.en.txt":"120e84d2d80a276e","qr/help.el.txt":"32ff95f4fcf22d22","quote/help.en.txt":"1087b5fe75eadc83","quote/help.el.txt":"c155be77996a0ad3","radio/help.en.txt":"3b3e50c54ac132f8","radio/help.el.txt":"42c87072c8df59ab","reversi/help.en.txt":"2371bab5173f0465","reversi/help.el.txt":"1d87ad05b5c93864","rps/help.en.txt":"744b9001391b3c59","rps/help.el.txt":"ea807bfea17eb1d1","scores/help.en.txt":"1a72f688e33e67a7","scores/help.el.txt":"67e9431c6f8f0245","shelf/help.en.txt":"429ee15bbbf3ca83","shelf/help.el.txt":"4ef4cc7427782c64","library/help.en.txt":"0ef6e567f49aa057","library/help.el.txt":"c4822272923ac901","simon/help.en.txt":"00ebfe2021bc784b","simon/help.el.txt":"6677b9fe7424ea41","slider/help.en.txt":"5e5525c2976de160","slider/help.el.txt":"97cc31e8bfbd7aef","snake/help.en.txt":"19fc5cb2f47a36e5","snake/help.el.txt":"7bfc174e2fa60c51","solitaire/help.en.txt":"838695284ff3e21f","solitaire/help.el.txt":"da48f590459adf98","split/help.en.txt":"ee14efbe0ee11ca5","split/help.el.txt":"7d7b025f78da331a","spot/help.en.txt":"f8f9d05e4da51609","spot/help.el.txt":"a51b1dc1747586bc","storage/help.en.txt":"cabd586587f85d00","storage/help.el.txt":"4a31a1a916a13991","sudoku/help.en.txt":"d1ad1e8a9b8b09cb","sudoku/help.el.txt":"58fe0526a4b44367","television/help.en.txt":"336cf3b6a8d86bcd","television/help.el.txt":"5f13a1847d34aaf1","montage/help.en.txt":"02fcc764a8dc5377","montage/help.el.txt":"6b0e707326847419","capture/help.en.txt":"31311cc2ee73f40a","capture/help.el.txt":"05b6877028cc4972","tetris/help.en.txt":"ef49096cb5c38cac","tetris/help.el.txt":"97037e796ae9bd6e","tictactoe/help.en.txt":"fd5e805f88a60b41","tictactoe/help.el.txt":"9a84b31ce27e1231","timesheet/help.en.txt":"2adf4affedd08f78","timesheet/help.el.txt":"34d9c4ddc45859c2","invoices/help.en.txt":"4aee50d32014fafd","invoices/help.el.txt":"88a15e48241f4ad8","newsletter/help.en.txt":"06e70312fae70019","newsletter/help.el.txt":"5d7b04d839081e10","signature/help.en.txt":"b7d605ad7c37083c","signature/help.el.txt":"50b7cfacb638a2ae","certificates/help.en.txt":"cca06e9d257c086a","certificates/help.el.txt":"553ccbc598337178","publish/help.en.txt":"053999fb21ef32b8","publish/help.el.txt":"1be4d81b18b5d0e8","crm/help.en.txt":"753add257d44cdbd","crm/help.el.txt":"11c2959929c5213b","travel/help.en.txt":"d5d07ab17cb56a93","travel/help.el.txt":"6a697ee3b033ae23","wallpaper/help.en.txt":"7e8c0e35e55cec28","wallpaper/help.el.txt":"583866f2e6f63751","trees/help.en.txt":"0e9b1e240fefe2cb","trees/help.el.txt":"b35d71838d0e8156","aura/help.en.txt":"5e7974497b36f874","aura/help.el.txt":"73050f886d8f2959","photolab/package.js":"7979ab108a53cc32","photolab/help.en.txt":"5b5030fc4d51189b","photolab/help.el.txt":"4a46f5cc99e1c1fb","whack/help.en.txt":"bce43a13dfd71371","whack/help.el.txt":"768fbc6657a9853e","wheel/help.en.txt":"cc6ac0437d20e1cc","wheel/help.el.txt":"524c2814e2011cb7","wordle/help.en.txt":"dfefe7d714836887","wordle/help.el.txt":"694fbe3851846068","wordsearch/help.en.txt":"dd7e6b61b3ad431c","wordsearch/help.el.txt":"bfa785a1022c8c10","xeri/help.en.txt":"d38e2ec6d778bf5c","xeri/help.el.txt":"a6f1cc7dd548eb61","zen/help.en.txt":"9246961cda429e93","zen/help.el.txt":"4a28b6b5781f1546","vendor/codemirror/cm-core.min.js":"1b5faa684e4e0921","vendor/codemirror/cm-web.min.js":"0be5dc1bfee5fac3","vendor/codemirror/cm-python.min.js":"2c69a6659577ace1","vendor/codemirror/cm-go.min.js":"394c91778dc427fc","vendor/codemirror/cm-rust.min.js":"95ec4b7e2aa4494d","vendor/codemirror/cm-cpp.min.js":"eddec8176b9882e2","vendor/codemirror/cm-java.min.js":"bbcfee0f503c9861","vendor/codemirror/cm-sql.min.js":"9a3f4a23e5ce882b","vendor/codemirror/cm-yaml.min.js":"1120723119ab46c5","vendor/codemirror/cm-legacy.min.js":"badeb48589fdccbd","vendor/noto/NotoSans-Bold.ttf":"1f988ea9681683c9","vendor/noto/NotoSans-BoldItalic.ttf":"aa4c2bedb8fe67f9","vendor/noto/NotoSans-Italic.ttf":"61aafd431d3dddca","vendor/noto/NotoSans-Regular.ttf":"c1d65ec522212c77","vendor/noto/NotoSansMono-Bold.ttf":"63f8f4f116dd1fbb","vendor/noto/NotoSansMono-Regular.ttf":"ec5d9ab078872763","vendor/noto/NotoSerif-Bold.ttf":"232a47d7fd050444","vendor/noto/NotoSerif-BoldItalic.ttf":"8e2fc4342881fe12","vendor/noto/NotoSerif-Italic.ttf":"f554d79c44ec7992","vendor/noto/NotoSerif-Regular.ttf":"8c1d6b379824ca6a","writer/search.js":"86d070475f0364f2","characters/":"cc5f1edd0bc94a83","characters/index.html":"cc5f1edd0bc94a83","characters/search.js":"10f130e89790acbe","characters/characters.css":"04e8a2a453066d2c","characters/characters.js":"22ae8eec1d47145f","names/":"f57d43377c422020","names/index.html":"f57d43377c422020","names/names.css":"16296c45d9c5e688","names/words.js":"bd6d7590f8118c59","names/names.js":"a0e47c58e70e9d5a","pixel/":"bcd805ce0f528348","pixel/index.html":"bcd805ce0f528348","pixel/pixel.css":"23f092d8c9017832","pixel/pixel.js":"0cf5f40cde1a3fa0","pixel/import.js":"152eb5f4018ce7c6","cycle/":"309f366dc1c106a2","cycle/index.html":"309f366dc1c106a2","cycle/search.js":"bf733d8222e85578","cycle/cycle.css":"24871f5e7c59a6cf","cycle/cycle.js":"04d890147289afd3","cycle/import.js":"0e6c638c8ab2e1cc","contacts/":"08f3a12a9d82ccee","contacts/index.html":"08f3a12a9d82ccee","contacts/contacts.css":"7d281cf8210f63b8","contacts/contacts.js":"199f3583e865aad8","contacts/search.js":"b0a9a8f0150eaef4","stock/":"d9d6111d6650410f","stock/index.html":"d9d6111d6650410f","stock/search.js":"1c6a764c4a4e1420","stock/core.js":"f43c5bc79f2ad341","stock/stock.css":"8778ab2ec4840863","stock/stock.js":"36612b54cdf97b23","stock/import.js":"e26d7890348d8a12","stock/shop.js":"fe341e8c023ae7df","stock/consign.js":"8116a2f7bc806ef0","stock/prices.js":"f3978cafee363ef8","stock/pricelist.js":"a7feebf95d3a3258","stock/today.js":"e672ee1495b0ed0f","garage/":"34451a02ec2a5c9a","garage/index.html":"34451a02ec2a5c9a","garage/search.js":"1fcf1b2176b3b231","garage/core.js":"71eef9fd1f3e7634","garage/house.js":"f6d3ca19bfb2e27d","garage/garage.css":"7a1f75c553d71238","garage/garage.js":"3feaf516864abc03","garage/import.js":"680eb5dad63bf3d7","dice/":"5b18ffeea039a427","dice/index.html":"5b18ffeea039a427","dice/dice.css":"5292792d71f6c2e7","dice/dice.js":"a0994f853f88e5d8","petcare/":"ccd115e2c3c55b2d","petcare/index.html":"ccd115e2c3c55b2d","petcare/search.js":"fb8714679a7890dd","petcare/core.js":"d944a056fac6a523","petcare/house.js":"f1dd1b42dd3d3827","petcare/petcare.css":"4fe7c5495dd5c0a8","petcare/petcare.js":"8174e4d0a80db363","wheel/":"3572deeffe4a4cd4","wheel/index.html":"3572deeffe4a4cd4","wheel/wheel.css":"1aae9d8ac51613c3","wheel/wheel.js":"04b071ba00875927","oracle/":"979af138717e4c11","oracle/index.html":"979af138717e4c11","oracle/oracle.css":"53e7e8ad4d7b7fcf","oracle/prophecies.js":"6f2508d89ffd99d5","oracle/oracle.js":"45546c8988cd8bb9","oracle/help.en.txt":"6b0ef3cf0e0a2012","oracle/help.el.txt":"7cf41e3e853c7c3b","slides/":"562181d310fa01e8","slides/index.html":"562181d310fa01e8","slides/search.js":"897806e859da98f1","slides/odp.js":"cef56c448ff106a4","slides/mdimport.js":"8b9a47356a547445","slides/slides.css":"d1cf2811ad12b67d","slides/core.js":"48a9ffc12562fc68","slides/dk.js":"734aec18fea512a4","slides/app.js":"3b1d835aea75f31c","slides/editor.js":"c01d09a7eac4ae01","slides/text.js":"ccc935f11eb63e42","slides/panels.js":"69ea357c187e8c4f","slides/io.js":"f35376ffbf187a60","slides/help.en.txt":"99e3bba95822a407","slides/help.el.txt":"ac602bd2c9a0ea69","baby/":"28c25906ff244003","baby/index.html":"28c25906ff244003","baby/search.js":"a0fbd534a83b2a3f","baby/baby.css":"9c6d7d9d606dcdec","baby/core.js":"1a63bf8e2e828529","baby/house.js":"6e7f38115c755a00","baby/baby.js":"c7b9c421bd281bd6","baby/import.js":"df4fe0d7ad2c980a","passwords/":"d296be49ba718a33","passwords/index.html":"d296be49ba718a33","passwords/passwords.css":"e369311aad491f5b","passwords/passwords.js":"10b351d80af23991","passwords/pwcore.js":"8f52b776f9ccc07e","passwords/words-eff.js":"3a17072de1e2e0b5","passwords/common.js":"d31abf3c0af092a0","device/":"a2451751404e4875","device/index.html":"a2451751404e4875","device/device.css":"199aa4c0e995e0f2","device/core.js":"60b05f8165db282e","device/device.js":"39e9eb7fb2ece4e9","assistant/":"b1e496805edf34db","assistant/index.html":"b1e496805edf34db","assistant/assistant.css":"63e44168691ae439","assistant/doctext.js":"c27facb26a11a176","assistant/core.js":"b414237c817f07ea","assistant/imgai.js":"094164d0d5d7c29d","assistant/summary.js":"616a95b73ad7632f","assistant/assistant.js":"962ceb3c4241547d","assistant/import.js":"08bb415e1eaa7ab9","assistant/webllm-worker.js":"1db8a657e117eed7","assistant/help.en.txt":"932ad4ab12ebdebf","assistant/help.el.txt":"908821d131e648a3","share/":"ae912e6f8e3d9c9b","share/index.html":"ae912e6f8e3d9c9b","share/share.css":"4e8e5e06618022ca","share/kinds.js":"28086b88579fa5de","share/send.js":"0a9daa8e94962866","share/view.js":"d87437543ce02d49","share/relay.js":"30acf13cd51a8e08","share/out.js":"147fb3551f79a407","share/album.js":"596f6d75ff536d48","send/core.js":"e0df571d848bc2e4","send/sheet.js":"486ea543a363cf22","commands/core.js":"6c5c8874db9ff671","commands/bar.js":"a5b015448d83d5cc","settings/":"e0868aaffcf357de","settings/index.html":"e0868aaffcf357de","settings/settings.css":"c1dafbfac4d61c98","settings/core.js":"dd2b6cff4f50c8ca","settings/report.js":"6fc2b8442661c495","settings/settings.js":"97e17e7a5c67b92f","settings/translate.js":"d41773a4b22e8527","settings/search.js":"c0272efc98c3582b","settings/help.en.txt":"3db96f7dcbb70fae","settings/help.el.txt":"e371cf9fa9ddd5dd","today/":"62818d735f77a854","today/index.html":"62818d735f77a854","today/today.css":"d0976eee688c02bc","today/today.js":"0ee8815475a528b2","today/agg.js":"e7df45e35654f95b","today/host.js":"2e70c4b86ad7f1f3","today/help.en.txt":"c62a84dca48fa92b","today/help.el.txt":"77f52a703dfc942c","calendar/occur.js":"18a6579351b53902","todo/core.js":"eba511210e48cd9e","quote/core.js":"7ca82379841cbe85","kanban/core.js":"6dc5499cddd15bfd","contacts/dates.js":"c0425b0ff2dc3aa5","contacts/vcard.js":"56afb12f5a959d37","contacts/dav.js":"6b64f56c22b3c017","todo/today.js":"df6661f49ca78c5b","quote/today.js":"b0ceb89f35287a08","kanban/today.js":"ab344e533f238335","contacts/today.js":"d350a1eaa78795e4","contacts/importplan.js":"d14f756e8312c1bd","contacts/accounts.js":"c16a303b5eb65011","contacts/oauth-callback.html":"dd50abab1bf83f3c","contacts/oauth-callback.js":"41c37bb99d34b2b2","habits/core.js":"90702acac97c78a6","mail/today.js":"3a29c1af17eecfc9","meals/today.js":"182cbadf12638cc5","budget/today.js":"a7fd549f2ce79908","health/today.js":"c764822d622f2bc1","fitness/today.js":"7797ebc5744b5b00","habits/today.js":"4f67bbd553938da2","cycle/core.js":"2e7221b903eddfa5","mood/core.js":"393ed8f5bd9dea51","minimalism/core.js":"507ef03f4d181514","cycle/today.js":"107f804542be07ea","mood/today.js":"19219e20bccc3ae1","minimalism/today.js":"87a01a1c0d4d9060","familytree/today.js":"20f0c9d9adc924fc","sky/today.js":"b15954b8408e3626","weather/today.js":"3b6ff54db64e3475","time/today.js":"d43826c146cfe60c","calendar/today.js":"dc8ed95c45fcd687","plants/today.js":"1cc5388fbb0b36c9","chores/today.js":"db91aa78cd0140b4","petcare/today.js":"25d97543cd22e06b","garage/today.js":"209a1920dcf6b581","travel/today.js":"d9e37bb40087d8e2","timesheet/today.js":"7b2fa08d296a5fbc","shelf/today.js":"ffe689085e538086","water/today.js":"7bfe613c61706cdd","baby/today.js":"a1fa1fa19aebf62f","netizen/":"94a7358cfda2120d","netizen/index.html":"94a7358cfda2120d","netizen/netizen.css":"effe319c4b612540","netizen/netizen.js":"2cfc4895489f026c","wallpaper/":"68e916802bfac074","wallpaper/index.html":"68e916802bfac074","wallpaper/art.js":"aabd6d08bda0989b","wallpaper/wallpaper.css":"04befca4cac24a5b","wallpaper/wallpaper.js":"25705e010ed74d75","trees/":"01a16dafeb2fb08a","trees/index.html":"01a16dafeb2fb08a","trees/trees.css":"3f59df5d15866bd4","trees/core.js":"f3866bdbd20944f5","trees/trees.js":"4a967e34e6922238","aura/":"d171b91c3d624b0d","aura/index.html":"d171b91c3d624b0d","aura/aura.css":"7dac210316d58b15","aura/core.js":"c42ed5d39251df80","aura/aura.js":"6d1efc99fc23dec9","photolab/":"93ca4e975a6dc83d","photolab/index.html":"93ca4e975a6dc83d","photolab/photolab.css":"da28a3a9316da1e3","photolab/core.js":"45b39e7dfdaa45d3","photolab/tiles.js":"3ed4eb78232bd396","photolab/history.js":"1c5e79eb41845b65","photolab/select.js":"e47de66260f5f183","photolab/guides.js":"d9c2579045f0f002","photolab/paint.js":"7775526d9bfa6650","photolab/resample.js":"6db539837449c1a0","photolab/adjust.js":"5cc5d9dc73c82782","photolab/filters.js":"8c9d972a061633f9","photolab/store.js":"40bd19b1baf75b7b","photolab/psd.js":"8fded19e4451a5f8","photolab/ora.js":"86ec33930d6d514f","photolab/xmp.js":"644d23117ddc46af","photolab/strings.js":"fc6b9029a88c8d08","photolab/app.js":"7d3e043675f48bfb","photolab/view.js":"8875b91236ea358b","photolab/jobs.js":"273d6b8bd834b283","photolab/worker.js":"74e0de72e6fc5604","photolab/tools.js":"cc3bb4da97a454af","photolab/ops.js":"5890ec6a09aef823","photolab/io.js":"b79747d09fff64b3","photolab/home.js":"95d41a26bd51266e","photolab/panels.js":"5a4e41cd8396336a","atelier/":"c25a627906defa6c","atelier/index.html":"c25a627906defa6c","atelier/search.js":"ca9e5fafdc20a57a","atelier/atelier.css":"9defcd4455c20460","atelier/library/icons.js":"0eb6b09ebc640016","atelier/presets.js":"22d9414b8a1d3944","atelier/templates.js":"a3ac28a1e4e673f8","atelier/ax.js":"1fe99903e4b60d82","atelier/blend.js":"fdaf7dcdf54156c2","atelier/anim.js":"f548990539109ae7","atelier/morph.js":"b380d27c8bf4565e","atelier/core.js":"41e3c35e3e0aee2e","atelier/draw.js":"97f241909ca495ce","atelier/editor.js":"7c13238ef1257fe5","atelier/panels.js":"f9f41016c342b419","atelier/sources.js":"2f5515ad0ce14382","atelier/fonts.js":"a9134a37338ee1a7","atelier/brandkit.js":"78a491c64eb9f8dd","atelier/style.js":"6768af3206b1b9e4","atelier/swatches.js":"02bbb051cd25f45b","atelier/brand.js":"448b853cf7a25296","atelier/folders.js":"1d6b0b91cb6f54cf","atelier/homefolders.js":"eb82c2d8c226b05f","atelier/relayout.js":"74bb31012219fe44","atelier/aitext.js":"2e721ef1048097c0","atelier/cutout.js":"f1462a2056eabace","atelier/inpaint.js":"4a858ab600fede1d","atelier/ai.js":"567a5f02831a04e2","atelier/editpic.js":"5a7df43ba3905b28","atelier/magic.js":"363890a3f6f49b62","atelier/imagine.js":"7de67c286f54bd09","atelier/magicai.js":"5d02cc40e2c79d10","atelier/magicdesign.js":"cc1429b99210a3ef","atelier/collage.js":"387b705715cba2f4","atelier/bulk.js":"15ad6bb67122fcc2","atelier/kit.js":"30dffaf477e2ea80","recipes/core.js":"26c3d014816800bd","recipes/ui.js":"8c675c63908d3d6b","recipes/share.js":"a729badd23e7078b","atelier/recipesteps.js":"8ffa8c0e2130ac3f","atelier/recipes.js":"48033c1404e3c4be","atelier/commands.js":"9bd21cfb0c93a5cf","atelier/assist.js":"2836cc235932ea99","atelier/clips.js":"33a974b95e2187a8","atelier/video.js":"0bc4e8543e0c5247","atelier/gif.js":"0871f1ed47b93cc2","atelier/motion.js":"53aed2504388508b","atelier/zip.js":"7aad95973aaee2e1","mockups/":"1ca2a511edf618ba","mockups/index.html":"1ca2a511edf618ba","mockups/mockups.css":"572edc82b07a5d28","mockups/core.js":"f1a06ed0d1d1008b","mockups/print.js":"414da883054f9dc9","mockups/scene.js":"01ce6bce89805682","mockups/mockups.js":"f4152aeffd7439bd","mockups/search.js":"d85407a3b01065f4","mockups/help.en.txt":"2894a1403199d7e4","mockups/help.el.txt":"b3cc657df9788551","vendor/three/three.module.min.js":"e2b5ee6bccd38fd6","vendor/three/three.core.min.js":"61ba0df005b05991","importkit.js":"7f7a69db43f8249d","bundle.js":"79ef5c25296c4b4d","recordpkg.js":"5f1ad0547ee99387","habits/package.js":"97660f79cb9afab6","water/package.js":"6e04c55d60c225c1","chores/package.js":"0b8f1709b6aa7ce5","scores/package.js":"0a5f860e3aff497e","cycle/package.js":"a093199414bb9396","mood/package.js":"a8482da9c40e49e9","calendar/package.js":"f140ce5993f2638e","contacts/package.js":"46719202c9569dd7","bookmarks/package.js":"4d5a23df4a99fa58","feeds/package.js":"f6c50e9d2c9d9798","podcasts/package.js":"c1549d4a0983886d","meals/package.js":"979cc5104566b19f","stickies/package.js":"630ec54c517b5999","crm/package.js":"5b6475741d72acb7","quote/package.js":"d8909c27dc20fc33","timesheet/package.js":"3749d7055e8fdfff","stock/package.js":"76be5d0a61b0314c","budget/package.js":"552883d50e04a99b","invoices/package.js":"ad753843cf451b8d","invoices/acctpack.js":"e53e113ebae8a9c5","invoices/pdfin.js":"6295b63d13d8ba98","budget/links.js":"6d8c701823f6e11c","split/package.js":"35223c062ccdb9cf","diary/package.js":"0767f6b6df5617a3","health/package.js":"4e2b9ad40de4f52e","fitness/package.js":"cc75e8f9316df593","baby/package.js":"90dc7579144d99c1","petcare/package.js":"94959b9d5d134984","plants/package.js":"135a6c20ce34d554","garage/package.js":"253afc38cba1d045","library/package.js":"00a86f44abb5231e","shelf/package.js":"4d4536979a38ab2e","signature/package.js":"86929a497bdb9263","newsletter/package.js":"b218788cd22211ca","storage/package.js":"7c1e95a405f37044","converter/":"a4556f970592cef4","converter/index.html":"a4556f970592cef4","converter/converter.css":"acdc8fc56d669c54","converter/registry.js":"f21dd4b85a42a738","converter/core.js":"7ac2a507e4af2aed","converter/converter.js":"f9202a7a263bacc1","converter/help.en.txt":"200f4e2a43307373","converter/help.el.txt":"5f27f3d123052718","flashcards/":"1ac06503258d9899","flashcards/index.html":"1ac06503258d9899","flashcards/app.css":"42374d27ab0e88de","flashcards/app.js":"d3c17ea9ed8ae433","flashcards/core.js":"e5504635b61694a0","flashcards/fsrs.js":"431fe670534716f8","flashcards/media.js":"0d610666ad4c229b","flashcards/sqlite.js":"c7f90bd02ba9a6df","flashcards/anki.js":"6c0412f52ad53446","flashcards/make.js":"4da27c98db428686","flashcards/due.js":"f1d50b0c64194e45","flashcards/today.js":"bd1d018b20b75344","flashcards/stats.js":"d255dca976c5c0dc","flashcards/package.js":"fa18e3a33faf3b19","flashcards/convert.js":"38d7c86a3c10de63","flashcards/search.js":"bb2fb135bcfe5a4d","flashcards/help.en.txt":"a730b75f7a0497f9","flashcards/help.el.txt":"9e3835bf616e1537","typing/":"5d9776c419e1dcd4","typing/index.html":"5d9776c419e1dcd4","typing/app.css":"4263b9c648aaa6ac","typing/layouts.js":"6db39f10163009de","typing/words.js":"73d7956b3ab326a3","typing/course.js":"19457e59158d7eb9","typing/texts.js":"4fde5c922871db70","typing/core.js":"353d3e5da4f1ce6f","typing/due.js":"02102be40a03b4f2","typing/today.js":"3d73c7aa803d90b3","typing/search.js":"92433eb9bde71777","typing/rain.js":"582b5cc60272fb9f","typing/app.js":"2eacd3d4c2642799","typing/help.en.txt":"9e143420e6e933cc","typing/help.el.txt":"ae9035f96c7ce1d8","scanpdf/":"ad32465ef675e0ae","scanpdf/index.html":"ad32465ef675e0ae","scanpdf/scanpdf.css":"f0fd7773c4e46435","scanpdf/core.js":"26655c35fd1755b7","scanpdf/scan.js":"cf986783de3d9989","scanpdf/device.js":"a33a2705ce64b943","scanpdf/ocr.js":"507461b370e7d18f","scanpdf/pdfops.js":"96bf43eba73f3e20","scanpdf/scanpdf.js":"a3c7a531da1bd3a7","scanpdf/search.js":"bc26f9b144c3784c","scanpdf/help.en.txt":"5079dbf7b57e8d2f","scanpdf/help.el.txt":"149a5effd9d89e1e","vendor/pdf-lib/pdf-lib.min.js":"2d8e83696f30f477","vendor/pdf-lib/fontkit.umd.min.js":"d8df561b9fba98e2","google-import.js":"914b1fe255256fc3","davkit.js":"e9df91993cc962fd","davsync.js":"93b6096ff02c7a43","enrich.js":"b9931d23024f55dc","enrichui.js":"958f2fb4dfbb384c","atelier/pptx.js":"dc1aa5b768905a02","atelier/pptxout.js":"cc5bfe1c5f811fca","atelier/canva.js":"7378f882d4033659","atelier/canva-callback.html":"bc7aa552b0f585c7","atelier/canva-callback.js":"dc4f3b84c2260aae","atelier/io.js":"a431853a87936bd2","atelier/help.el.txt":"b92a640d24533b5c","atelier/help.en.txt":"c55107e2f2d5cc63","minimalism/":"ea5e65f6dbfcd421","minimalism/index.html":"ea5e65f6dbfcd421","minimalism/search.js":"920fa26eeff2c1eb","minimalism/minimalism.css":"f0c74687aa01fd25","minimalism/minimalism.js":"02e77787bc723de1","minimalism/content.js":"2c55ebca92ec87bb","split/":"42490f9c146739f8","split/index.html":"42490f9c146739f8","split/search.js":"7e9b9f07062d1262","split/split.css":"8af39995ddf859a3","split/split.js":"4936fcdc434fd845","split/import.js":"965e0c889fd28a84","split/house.js":"d8557056bf70e519","spreadsheet/":"47dd5a4175c176b4","spreadsheet/index.html":"47dd5a4175c176b4","spreadsheet/search.js":"3d12aa330ea8db6e","spreadsheet/spreadsheet.css":"502b19a3fd4d2205","spreadsheet/spreadsheet.js":"51b127ce8ca2059c","spreadsheet/sheetimport.js":"e4a276de3a86ecf7","spreadsheet/convert.js":"0d9f1d08ad891aed","spreadsheet/platforms.js":"8c6245701636d295","podcasts/":"2f6c9edb1e1120ea","podcasts/index.html":"2f6c9edb1e1120ea","podcasts/search.js":"e7fa9f0314490d36","podcasts/podcasts.css":"81e3021adef95edd","podcasts/core.js":"e34d7c2eca297c51","podcasts/store.js":"97a72252d894cc0c","podcasts/host.js":"9b85fdc7314b4a91","podcasts/podcasts.js":"aa6e8b71f1e9d467","music/":"339b557e5ed31458","music/index.html":"339b557e5ed31458","music/search.js":"57a3faf5cf2f4fc0","music/music.css":"d361020df9dcafc7","music/core.js":"ee4e8fdec275edf8","music/store.js":"169db16e18397211","music/host.js":"0fd246bda7c48a8c","music/library.js":"d7b5c84687364f30","music/open.js":"7cf8dfc079c086a0","music/servers.js":"b61d9dfde1f0cf9d","music/mixes.js":"a9ce76dfbc95032b","music/music.js":"26f2db5d7cf840e7","music/today.js":"afa6a1dd59ae89b8","radio/":"5433b45d692a7361","radio/index.html":"5433b45d692a7361","radio/search.js":"e00e86ee9dc50f83","radio/radio.css":"6319b55c2ab89890","radio/radio.js":"203991540edcaf12","radio/import.js":"f2cb743796a63af4","mixer/":"d0914ff301f4c1e2","mixer/index.html":"d0914ff301f4c1e2","mixer/mixer.css":"823752ac46e90d2a","mixer/mixer.js":"f8cbd632a8b41c38","mixer/engine.js":"fed62a4ea80e6452","ringtones/":"4ab45d4e70dd536e","ringtones/index.html":"4ab45d4e70dd536e","ringtones/ringtones.css":"0ec44efbc84e30fd","ringtones/core.js":"588e23ed811198f9","ringtones/ringtones.js":"16a1806371a36ca5","studio/":"10d5acc140f0628f","studio/index.html":"10d5acc140f0628f","studio/studio.css":"02d54cdcd34ce57a","studio/core.js":"d4bd73bb7606b420","studio/studio.js":"6f1c5f18c9c2bee2","studio/package.js":"a7f9befcb0d6fe15","studio/commands.js":"c848f7716212c0b8","studio/assist.js":"8cce42b02ed40891","studio/rec.worklet.js":"ef78141599f8d81b","studio/fx.js":"b1a0d9ef8fd74643","studio/remote.js":"dcbabe2e23445d4d","studio/nullfx/runtime/eel-rt.js":"c1b7f4ddc7e0f7d9","studio/nullfx/runtime/null-fx.js":"161a1c23053bcd90","studio/nullfx/runtime/null-gfx.js":"4c3b2af0c404c2b0","studio/nullfx/runtime/null-node.js":"44d015a11dfb3737","studio/nullfx/runtime/null-worklet.js":"20f7a45edfaf894b","studio/nullfx/fx/index.json":"d1a47062a7a63fea","lyricsync/":"3f4b34f7b05ed7c4","lyricsync/index.html":"3f4b34f7b05ed7c4","lyricsync/app.css":"abe3a3fac141afa0","lyricsync/core.js":"faa32bec6bdcd701","lyricsync/formats.js":"b590111ef22c4695","lyricsync/wave.js":"28f8943c1ea405a4","lyricsync/id3.js":"96877e242dad2935","lyricsync/align.js":"334f99bb5890b2bc","lyricsync/app.js":"cb935974587d8983","lyricsync/search.js":"f4d4b99e5be02ab8","maps/":"558cef692a779f7c","maps/index.html":"558cef692a779f7c","maps/search.js":"5a74fcc0fab16984","maps/maps.css":"63b92ccb1bdc1721","maps/route-core.js":"32912356e14d8bc8","maps/tools-core.js":"98854b1a333a7388","maps/transit-core.js":"e11e0aeed599c1ab","maps/transit.js":"3e4b46fd9a1a3a43","maps/tools.js":"10c035a378a23e72","maps/planner-core.js":"efca3846503c4b38","maps/planner.js":"9b40e0656ce2759d","maps/fav-core.js":"e0cf470bb936b9c3","maps/fav.js":"214e3c734bb7ce4a","maps/hh-core.js":"b1602ad20cd13705","maps/hh.js":"2059a7ec274feaec","maps/discover-core.js":"fc66919ffdfbc633","maps/discover.js":"3895ac0b29e9cd8c","maps/maps.js":"d27f3db5c0bf7ca4","maps/import.js":"593b1282b824451b","maps/import-ui.js":"eca62b809e3379aa","maps/package.js":"8a75750f89cc1afe","maps/package-ui.js":"d148990ad13cbcd2","maps/osm.js":"0e6ac25396243e6a","maps/osm-api.js":"8911a6d49eadfe55","maps/notes.js":"b9d0751b365ab94c","maps/osm-callback.html":"912abe1d956e6c8c","maps/osm-callback.js":"787e43e96de672cb","maps/poi-core.js":"c5e823383dd1f0a0","maps/everydoor-core.js":"8d056d544a553932","maps/poi.js":"da7fa565d725d745","maps/entrances.js":"e26c01dedca62582","maps/presets-data.js":"cdb2f107c9783745","maps/tracks-core.js":"b9cb8019a88c12ab","maps/tracks.js":"9801f4e9bd37ce3c","maps/heat-core.js":"96b23effc7f11522","maps/heat.js":"8716e907cb34ca13","maps/heat-worker.js":"041a300ece220fbb","maps/quests-core.js":"7175f6c9fba87b13","maps/overlays-core.js":"cfa2c30deda425f7","maps/quests.js":"63433458aebcdd6c","feeds/":"72382f99ffa0b153","feeds/index.html":"72382f99ffa0b153","feeds/search.js":"88fb1035ac7c2abd","feeds/feeds.css":"3713ff9c5d3af76a","feeds/core.js":"46d7dd79c32015e2","feeds/sanitize.js":"9990e65745bf39eb","feeds/fetch.js":"bcdf6fac9c11e52e","feeds/extract.js":"9f5ee5996262e2e7","feeds/feeds.js":"b2b4098aba8f87c4","feeds/youtube.js":"405e977db78234d4","museum/":"5d9ef83a8e8f83ea","museum/index.html":"5d9ef83a8e8f83ea","museum/museum.css":"b94ed2ee7a287304","museum/core.js":"3fbdfa14e562ea91","museum/museum.js":"d1f7b98587de9f5d","museum/help.en.txt":"4178dff7435e143e","museum/help.el.txt":"ced97a293fee29ec","vendor/leaflet.css":"803b85dd520f925d","vendor/leaflet.js":"db49d009c841f5ca","vendor/mediabunny.min.js":"9fb60523f8b2fecc","calculator/":"4c4ae187b3e5dbe5","calculator/index.html":"4c4ae187b3e5dbe5","calculator/calculator.css":"7e898a8ba4680db4","calculator/calculator.js":"1145b004c12be74e","texttools/":"0581010e796ea499","texttools/index.html":"0581010e796ea499","texttools/texttools.css":"d4eb5cb68b6704af","texttools/core.js":"bad9190b9a833e0f","texttools/texttools.js":"92393b31b161eaa3","texttools/worker.js":"ebfb66d129e3e36c","units/":"a0efc86717f903cd","units/index.html":"a0efc86717f903cd","units/units.css":"7ee76aa6bd5fbdab","units/core.js":"a51bfc9056672b11","units/units.js":"95c53f555b56d4fe","units/search.js":"7a0d9ce8590c948d","stickies/":"da4269fc87e3b1cf","stickies/index.html":"da4269fc87e3b1cf","stickies/stickies.css":"08593d880f82515e","stickies/core.js":"a6bcb9f7eef3f51a","stickies/host.js":"ac6b9cdefa53d516","links/core.js":"d4e11bf1ce4e652f","links/host.js":"0be07d4093fabebc","links/woo.js":"12bc02fd4608a475","links/mydata.js":"4b2435746ae66bd8","links/mail.js":"57a013f917fbf35a","links/crm.js":"0567f07ff90ffd45","links/todo.js":"0b74f65853323d76","links/kanban.js":"2230df842545a673","links/bookmarks.js":"dff1b84446e37082","links/notes.js":"c2e02a40b0f5c9c3","links/sheets.js":"be0b711c0a00e588","links/pay.js":"b3cfb25201f6a0b8","stickies/stickies.js":"836ed23071b2efee","stickies/search.js":"93207f636e67b67a","stickies/today.js":"8249f2c96f1b26e0","pad/":"90bf35195c64868e","pad/index.html":"90bf35195c64868e","pad/app.css":"fcb8959f1adf6d35","pad/core.js":"63e1df4816b28e52","pad/search.js":"5ffc366b333d03f3","pad/eel2.js":"d558c37ac9ebcffc","pad/app.js":"a7fb38ea7951b8aa","textcase/":"fb9a3f2255ea4b59","textcase/index.html":"fb9a3f2255ea4b59","textcase/textcase.css":"f15073c61268f010","textcase/core.js":"b5e8b05316cf7c1f","textcase/textcase.js":"bc2307349dd11ace","television/":"4682b61e96089a51","television/index.html":"4682b61e96089a51","television/search.js":"093e85853a9e6c12","television/television.css":"dc4349901679e3c3","television/television.js":"a892928c5e5824d9","montage/":"c08514052b2007c1","montage/index.html":"c08514052b2007c1","montage/montage.css":"275cbb86fe43b030","montage/core.js":"a148bccc253acb4e","montage/hash.js":"fa28f127846947a6","montage/gl.js":"9d2f1ab7d095884b","montage/media.js":"557398b8b8af610c","montage/player.js":"c7ae9223f5cee3fa","montage/export.js":"91bb7d290cb3ba85","montage/montage.js":"b312a8521d003e3e","montage/package.js":"4223e6ce1b92e2bf","montage/search.js":"56281e9ebe8b41df","montage/commands.js":"a933fdbb170b0344","montage/assist.js":"b0c71d3e533cc80d","capture/":"14ee64848b12d710","capture/index.html":"14ee64848b12d710","capture/app.css":"f073bc29f7ebf8ea","capture/core.js":"496f6ecb0fbefdde","capture/app.js":"a334748b88c61ad8","memory/":"1fc446ffdabf3429","memory/index.html":"1fc446ffdabf3429","memory/memory.css":"b2d2fe6c9c382982","memory/memory.js":"fa265126ca1cd8dd","connect4/":"73bacd628502387a","connect4/index.html":"73bacd628502387a","connect4/connect4.css":"d263b12f424b842b","connect4/connect4.js":"2e09110a4d871bc6","dots/":"e82cb5d08cae6195","dots/index.html":"e82cb5d08cae6195","dots/dots.css":"9c057d53f8b2499e","dots/dots.js":"f11385ddf068c4d8","tictactoe/":"b0457814a2b72ef6","tictactoe/index.html":"b0457814a2b72ef6","tictactoe/tictactoe.css":"e56e9acbd4968b8a","tictactoe/tictactoe.js":"f331cd5d55c57253","simon/":"4527a21da02e85b9","simon/index.html":"4527a21da02e85b9","simon/simon.css":"a1d35f31f515d65e","simon/simon.js":"e867376029cb2dcb","slider/":"ab34e55556b03063","slider/index.html":"ab34e55556b03063","slider/slider.css":"a79fc794b7f84a29","slider/slider.js":"b19324c28af1a741","lightsout/":"89f2aa86ce8e4ed9","lightsout/index.html":"89f2aa86ce8e4ed9","lightsout/lightsout.css":"e5456e85ca86e6bf","lightsout/lightsout.js":"c95c0e56b856b4fe","petworld/":"bab659d1611163cb","petworld/index.html":"bab659d1611163cb","petworld/petworld.css":"ddb591466477f848","petworld/petworld.js":"8a717855c46632e0","whack/":"43137d5be1099fcc","whack/index.html":"43137d5be1099fcc","whack/whack.css":"a0834edc6d3d7278","whack/whack.js":"b182fcbbff9407e9","snake/":"3124824ed5cc7cdc","snake/index.html":"3124824ed5cc7cdc","snake/snake.css":"1253c550b1c388a1","snake/snake.js":"862ef483d3ab13ad","g2048/":"0b52b67aaefda9eb","g2048/index.html":"0b52b67aaefda9eb","g2048/g2048.css":"13f3ad68d0a893b5","g2048/g2048.js":"dd64a476463bb6da","scores/":"edca250a92171944","scores/index.html":"edca250a92171944","scores/search.js":"bea683829dd2f861","scores/scores.css":"73cc3160bd5b5867","scores/scores.js":"90ec6e75617e6c4f","scores/import.js":"1c2cc4fc6b102de8","wordsearch/":"2e97da591998a557","wordsearch/index.html":"2e97da591998a557","wordsearch/wordsearch.css":"409bcfe2897b7ad6","wordsearch/wordsearch.js":"499833c57c67cefe","wordsearch/words-en.js":"77db4c8622711f0c","wordsearch/words-el.js":"54e0ec355fb59dcb","solitaire/":"f85e16755c1ae1fe","solitaire/index.html":"f85e16755c1ae1fe","solitaire/solitaire.css":"83828636e85fc3d6","solitaire/solitaire.js":"9f2c56419bf432fa","cardkit/cardkit.js":"56be1a5faedb9d25","cardkit/cardkit.css":"89f856bdee6bfaa8","jigsaw/":"108701775b189be7","jigsaw/index.html":"108701775b189be7","jigsaw/jigsaw.css":"0238c61a6b9069cd","jigsaw/jigsaw.js":"d6f9b7c176809ee7","crossword/":"81733c9bc35e1b49","crossword/index.html":"81733c9bc35e1b49","crossword/crossword.css":"b52838159a8e7282","crossword/crossword.js":"06e96c3df2f4178e","crossword/import.js":"234954435fb88be5","xeri/":"cf871f8f31211445","xeri/index.html":"cf871f8f31211445","xeri/xeri.css":"0b3b71db56fcd8ce","xeri/xeri.js":"414d75ec332fec26","wordle/":"f4b0b3bf779f69c2","wordle/index.html":"f4b0b3bf779f69c2","wordle/wordle.css":"35f87b92e04128a5","wordle/wordle.js":"8aafa2e78723925b","wordle/words-en.js":"754f65a8a33a2839","wordle/words-el.js":"2875a091b9628ff3","backgammon/":"60bb942cc0ab0d09","backgammon/index.html":"60bb942cc0ab0d09","backgammon/backgammon.css":"426a2722b3a63897","backgammon/backgammon.js":"0641c8cd521b0de1","battleship/":"c81b78dc80f7ec56","battleship/index.html":"c81b78dc80f7ec56","battleship/battleship.css":"263148b4c32bbe02","battleship/battleship.js":"e6ebc209a68c2f3c","breakout/":"75be6dfd47b6cd29","breakout/index.html":"75be6dfd47b6cd29","breakout/breakout.css":"935c445fe1244b3a","breakout/breakout.js":"6e5581e41e6419ed","bubble/":"21ff3ef9e5f32ff0","bubble/index.html":"21ff3ef9e5f32ff0","bubble/bubble.css":"c55eaa0f7587762e","bubble/bubble.js":"e19f3e71ed37e27f","budget/":"e491bebc12937f88","budget/index.html":"e491bebc12937f88","budget/search.js":"bb1b41d76156f6dc","budget/budget.css":"9867b7ab92f7a8a8","budget/payments.js":"6804db162aa8920b","budget/budget.js":"40854f2da28f6b6a","budget/import.js":"9fcae52ec074b160","budget/feed.js":"394174e59228c725","checkers/":"0c46382b69385698","checkers/index.html":"0c46382b69385698","checkers/checkers.css":"4bafd88d51dbf82c","checkers/checkers.js":"aa20eab9325fdeb9","chess/":"842fd533077c00c7","chess/index.html":"842fd533077c00c7","chess/chess.css":"f3db618121785062","chess/chess.js":"4440421861c0155f","chess/lichess-callback.html":"4c15cc4e9e7ecdf7","chess/lichess-callback.js":"0fdccfdbfc76cb14","familytree/":"c6dc806b19cf0a62","familytree/index.html":"c6dc806b19cf0a62","familytree/search.js":"9473de3d968f56c5","familytree/familytree.css":"e22975a8eedcf5bf","familytree/familytree.js":"12d8ef28ed36748e","familytree/ft-core.js":"653410469ce9dcff","familytree/gramps.js":"5414d0c0a5ab5038","together/":"a9d76b4615738b2d","together/index.html":"a9d76b4615738b2d","together/app.css":"7804bbe645bfec7e","together/core.js":"f65f4c4c1bc41adc","together/house.js":"c0853686095505e4","together/app.js":"3cc2f71c88500d62","together/search.js":"125dae06a526c306","together/today.js":"e97e236ed7f1884e","together/help.en.txt":"89c1b7238af0d6e1","together/help.el.txt":"44cc6f981c328961","household/":"55fbe0d090d63388","household/index.html":"55fbe0d090d63388","household/app.css":"5a66a676bbfe2732","household/core.js":"32eb02df24261f0a","household/crypto.js":"31e6e5f53aecdadd","household/folder.js":"f5044b4f0c560797","household/backup.js":"cb794653d28bb9a5","household/recent.js":"bc0aba73ddeec0ad","household/engine.js":"f060a9b1ceff6e60","household/whole.js":"42548c00f281b041","household/share.js":"c54b615da5b3df18","household/group.js":"a07324f737f7e467","household/today.js":"fcd81191b069d78f","household/app.js":"da8dc69ec109d8f4","household/help.en.txt":"4a381a7f239d31f9","household/help.el.txt":"45fb414e89a0674d","fitness/":"c63b5ac4a1bae7bf","fitness/index.html":"c63b5ac4a1bae7bf","fitness/search.js":"b3ee8e26d9c5339e","fitness/fitness.css":"d5027c5005a572cf","fitness/core.js":"a79326a5dd6c5871","fitness/fitness.js":"5ae0c678408e2e0b","fitness/import.js":"a6920b7f287f1d3c","flow/":"08f1f52716a7b626","flow/index.html":"08f1f52716a7b626","flow/flow.css":"a435c59f8c9e4292","flow/flow.js":"6cc47e71cb53b457","gomoku/":"7081acadcdbf5c65","gomoku/index.html":"7081acadcdbf5c65","gomoku/gomoku.css":"f3b11064c1aeef40","gomoku/gomoku.js":"7cd6b5fe1ea3fafa","hangman/":"5e1170c9ba63427f","hangman/index.html":"5e1170c9ba63427f","hangman/hangman.css":"3ba59562f6a197bb","hangman/hangman.js":"9ca5c0bae0f95c2f","hangman/words-el.js":"e3399a1a9846452c","hangman/words-en.js":"a3c2882893d40c7e","hexagon/":"eb3910a6975fac4b","hexagon/index.html":"eb3910a6975fac4b","hexagon/hexagon.css":"5513f6e850a85f37","hexagon/hexagon.js":"f3cba7d545752898","mahjong/":"f6c8ef813ecd20c5","mahjong/index.html":"f6c8ef813ecd20c5","mahjong/mahjong.css":"74b61b075fdcd661","mahjong/mahjong.js":"4d328754500073d6","mancala/":"a9eab1ef5accce24","mancala/index.html":"a9eab1ef5accce24","mancala/mancala.css":"5f0153337799436c","mancala/mancala.js":"eb4cee7bb84108bc","mastermind/":"a691cfe899082854","mastermind/index.html":"a691cfe899082854","mastermind/mastermind.css":"1d6ba9ca46f18f34","mastermind/mastermind.js":"3963bbf5cf5202da","minesweeper/":"c41c3a9e8ea0bb87","minesweeper/index.html":"c41c3a9e8ea0bb87","minesweeper/minesweeper.css":"5e592f2ac41e512b","minesweeper/minesweeper.js":"e147ca597323cac1","nonogram/":"74ef867e07b4b108","nonogram/index.html":"74ef867e07b4b108","nonogram/nonogram.css":"e287a940d1ecc9af","nonogram/nonogram.js":"02f04db9954d44e1","pong/":"90c2fa0ced2eb943","pong/index.html":"90c2fa0ced2eb943","pong/pong.css":"4be01f34822209cf","pong/pong.js":"0eefbef3c09d021b","reversi/":"384baaaf82d6ea09","reversi/index.html":"384baaaf82d6ea09","reversi/reversi.css":"c61bdad4d90c6a95","reversi/reversi.js":"c3db2000b3a6011f","rps/":"620726b126243e3d","rps/index.html":"620726b126243e3d","rps/rps.css":"2c7a87522109ea0b","rps/rps.js":"5783dc1312bae6d3","spot/":"1a8e17446deae364","spot/index.html":"1a8e17446deae364","spot/spot.css":"a36de730ce72c9a2","spot/spot.js":"1d5b4f826739c274","sudoku/":"3f20394659be00b6","sudoku/index.html":"3f20394659be00b6","sudoku/sudoku.css":"7b2a275470a0617c","sudoku/sudoku.js":"b3a2a3b571abe92b","sudoku/import.js":"eb7c253ecb0298c1","tetris/":"c3ca0a767cb9bb29","tetris/index.html":"c3ca0a767cb9bb29","tetris/tetris.css":"2d611e86bfdb0779","tetris/tetris.js":"70b90223b28645aa","travel/":"a2b15b41dcdddac8","travel/index.html":"a2b15b41dcdddac8","travel/search.js":"51d2e35721e7ed8e","travel/travel.css":"b49e2ee4b1cfcb62","travel/travel.js":"c20b0ffe448be6a9","travel/package.js":"8154f2d2ec9cc91d","travel/import.js":"17af95cd23307aa2","travel/core.js":"95a3b6973219ce07","assistant/edits.js":"917162631324154f","assistant/create.js":"9d1366d3c3153230","assistant/additems.js":"30ffdb6b12a4cdfd","assistant/edits2.js":"fae2fb1f97915563","assistant/additems2.js":"5e01a6f9949cb244","assistant/links.js":"9e665c2bb30eabc4","atelier/objects.js":"94df36c2999ae5b5","atelier/objui.js":"acf203f14c214bca","atelier/pdfout.js":"84be399d5f85c323","atelier/webout.js":"311181d6f538e455","atelier/templates-more.js":"7e4344d12e8888f7","bookmarks/core.js":"246b05214f1fa6a4","budget/bank.js":"872c0dc5acc7c371","budget/bankui.js":"3ecfa8cdefe8642d","budget/bankapi.js":"f553eab2be552970","budget/banklive.js":"99ed6d60d3acb7b2","budget/bankback.html":"a57d64322c6f9ca3","budget/bankback.js":"774000aa86d78557","budget/plan.js":"1b6bf770879b27ba","budget/planui.js":"9598231f4972fe27","calculator/core.js":"7caffeff81f5637f","calendar/free.js":"7bc1743f3085b56c","calendar/quickadd.js":"70f037369b528bf1","calendar/subs.js":"1d9a8a514d622772","calendar/house.js":"dddd2d198f0704c2","calendar/dav.js":"d71405ae73056db0","chores/house.js":"7cd0ef0198796bed","plants/house.js":"43a2c6e6e9d68d01","certificates/sign.js":"0c238d3173b5fc5a","certificates/verify.css":"0955715b90a2255a","certificates/verify.html":"43822c273fca2c5f","certificates/verify.js":"2b1ad9f46a3d0cb0","chess/openings-data.js":"92126876f6e69452","chess/puzzles-pack.js":"43f151dd4f12ad94","chess/puzzles-lichess.js":"847b18bf06ef961b","chess/train.js":"19784f0e7ccd28be","contacts/cardtext.js":"24a5d11059a1c539","contacts/csvmap.js":"75f76a42f6959c85","contacts/keep.js":"1a00ff4c8b7d0f81","contacts/merge.js":"7117520f10d2d664","diary/journal.js":"ac368a5d814994a6","feeds/ai.js":"2b9e663fd6bde4d9","feeds/sources.js":"23b4728e2a9c9462","files/files-core.js":"c748ffcb565fb8f9","fitness/gps-core.js":"c13044f664a22acd","fitness/plan-core.js":"728a4f2179827b5d","fitness/wger.js":"8a7e1fc4f7305ab3","gamecenter/":"2fb4906158642e5a","gamecenter/core.js":"86531ffd6ae16bc1","gamecenter/gamecenter.css":"0f44ece4fe7017bc","gamecenter/gamecenter.js":"fb46fcf831033b89","gamecenter/index.html":"2fb4906158642e5a","gamekit/daily.js":"7b3910ac7fb916bf","garage/logbook.js":"7301835d05d7596a","garage/receipt.js":"0759475af6e080bf","habits/model.js":"cec299f6d5a51f5b","habits/steps.js":"7c975cc12a64aa05","kanban/model.js":"eee56dd5924dfbfd","kanban/tools.js":"48efed7f47ae7d37","layout/merge.js":"e36e386d4f66ea84","layout/mergeui.js":"f0ae1ad446690cc5","layout/cover.js":"1ccb328bdff26010","layout/recipesteps.js":"5ef78d9015888744","layout/recipes.js":"75ab2e3d24755d5c","layout/commands.js":"3ab703c065391063","layout/assist.js":"40dfedeceb494e9d","library/catalog.js":"d3da7748e8d5b899","library/opds.js":"c85be3d12d8e6c65","mail/feed.js":"3ae5ae55075468c7","mail/pgp.js":"8d4602d7171d0267","mail/pgpmime.js":"e12562717c3e18e7","mail/snooze.js":"d98cb1e0156c600c","mail/unsub.js":"7beed61cc93f7350","maps/offline-core.js":"ea5d85f8ce046ddf","maps/offline.js":"5d83f649ad121457","meals/import.js":"2396457cffa0e76c","meals/nutrition.js":"3e84bd7918f7f77b","meals/pantry.js":"44dc1a3a3a363c2a","meals/house.js":"20acb26033248827","montage/asr.js":"227448d28e87def4","montage/denoise.js":"54706d71e584f0b2","montage/reframe.js":"098e750ba66f298d","mood/vocab.js":"9bc8ab07692ece5a","notes/md.js":"3c914afc9bb9e537","notes/import.js":"fb0c43018a6ef580","passwords/kdbx.js":"48cb12083c2baac6","passwords/pmapp.js":"9a38ee55a9bd0983","passwords/pmcore.js":"15b531720baaf00a","passwords/pmkinds.js":"9d1fb73b1656ae32","passwords/pmcrypto.js":"840c838e427291c4","passwords/import.js":"e72940c41b877370","passwords/otpexport.js":"d12b1f4c92d61cdb","passwords/afindex.js":"2b9096ec495c27c5","photolab/batch.js":"2b2d8bdc256aae98","photolab/batchcore.js":"34355d2aa24f9061","photolab/recipesteps.js":"52c38233fa1a06a1","photolab/recipes.js":"e90971d230811c4f","photolab/search.js":"8f44da07c4a82728","studio/search.js":"43fc19724b61cbbd","photolab/commands.js":"d15873190ddf505e","photolab/assist.js":"f03548b046032836","slides/commands.js":"07c4d646670bf2c7","slides/assist.js":"803b77abab8c7978","photolab/raw.js":"5ea1613edf0e519f","photolab/subject.js":"880fdd9f0b8bad16","plants/identify.js":"27c84005419dc646","podcasts/gpodder.js":"cbb2c9d904cd1dd9","qr/qr-bulk.js":"5880be5d506000f3","qr/qr-scan.js":"e37fd39d04114408","quote/accept-core.js":"a1e9268866d74559","quote/accept.css":"fce99556e425c57d","quote/accept.html":"2e5a260d3470601d","quote/accept.js":"1df270ef587f90c3","radio/tools.js":"cbd765a659180c5c","remote-play.js":"2de2a8c093cd182c","slides/anim.js":"ee601222ab3e9ab4","slides/objects.js":"31dfa42e6db183c5","slides/pptx.js":"391d7d6917b4df76","slides/remote.js":"45f4da73c48024ff","spreadsheet/functions.js":"23b4fff38de71155","spreadsheet/sheetkit.js":"20321d3d136052ba","spreadsheet/commands.js":"de7cd87b8a3e7974","spreadsheet/assist.js":"6bebe8ae257af992","stock/pos-core.js":"86768eab7b2e55d9","stock/pos.js":"0cfd73fc56701c11","storage/core.js":"f6633dbbf65e408e","studio/encode.js":"9d476e79e75916b9","studio/fxchain.worklet.js":"4e95fe7ee15cfeb6","studio/loops.js":"1bcd9d0df7fc34ac","studio/midi.js":"2479ee57c269b2c7","studio/bridge.js":"e3830c812ab31416","studio/sfz.js":"04e79b2850436936","studio/sounds.js":"bddf767fa7598f41","studio/notes.js":"34c449cc48311c4b","studio/roll.js":"c11a508ec95b5cfb","television/core.js":"ce694e119074fc4b","time/cities.js":"90c6a7d6f4d164fb","time/clock-core.js":"9b38e94efe1c9c94","today/layout.js":"df1e85fc5394ed00","todo/model.js":"758d8de395715554","todo/vtodo.js":"ce717da3daa075bf","todo/dav.js":"2cbc3c9d06ae81c6","todo/house.js":"411c039f392fc044","travel/booking.js":"7f9a5d849fb02eb2","vendor/hash-wasm/argon2.umd.min.js":"dcec617a2e1b700f","vendor/jsqr/jsQR.js":"415b07858a9a3972","vendor/fzstd/fzstd.umd.js":"fbea1c25c4413b62","vendor/openpgp/openpgp.min.js":"9736f49e81790af9","weather/core.js":"e5a0c1671b8af34e","weather/days.js":"4281c11dd0c09089","weather/rainmap-core.js":"8b15ae4e44f797ce","weather/rainmap.js":"f9147fbce4c398c9","writer/core.js":"5371adc1f1b1f2dc","writer/merge.js":"28f021fdba1f3d16","writer/spell-worker.js":"400886d297d139a9","writer/spell.js":"a662cc4ceb1cc9b3","writer/track.js":"d5aee5089387a84c","writer/commands.js":"a57e09086a650ffe","writer/assist.js":"edc8101ab57422f7","vendor/jspdf.umd.min.js":"e6551fcdc32f09d6","vendor/xlsx.full.min.js":"0542a718400c5520","vendor/hls.light.min.js":"27c3d1e021df94ce","vendor/pdfjs/pdf.min.js":"d2242a429cffd2a6","vendor/pdfjs/pdf.worker.min.js":"2cbba88314e2190a","vendor/NotoSans-Regular.ttf":"f5f552c8c5edb61f","fonts/nunito-regular.woff2":"abbae35c19866c1e","fonts/nunito-medium.woff2":"41ac63018c5d3c9f","fonts/nunito-semibold.woff2":"dc7500d319bd625c","fonts/nunito-bold.woff2":"fd89aca770f5bcd3","fonts/nunito-extrabold.woff2":"de0cf03cc02a5a1c"};
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

// The other releases' shell caches, newest name first.
function previousShells() {
  return caches.keys().then(function (names) {
    var prev = names.filter(function (n) {
      return n.indexOf("oros-shell-") === 0 && n !== SHELL_CACHE;
    }).sort().reverse();
    return Promise.all(prev.map(function (n) { return caches.open(n); }));
  }).catch(function () { return []; });
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
      return Promise.all([cache.match(PARTIAL_MARK), previousShells()]).then(function (got) {
      var resume = got[0], prev = got[1];
      return Promise.all([markTries(resume)].concat(prev.map(function (c) {
        return c.match(PARTIAL_MARK).then(markTries, function () { return 0; });
      }))).then(function (counts) {
      var tries = Math.max.apply(null, counts) + 1;
      return (updating ? cache.put(PARTIAL_MARK, new Response(String(tries))).catch(function () {})
                       : Promise.resolve()).then(function () {
      function download(u) {
        return precacheFetch(u).then(function (response) {
          if (!response.ok) {
            console.warn("[SW] precache MISS:", u, response.status);
            return true;
          }
          return cache.put(u, response).then(function () { return true; });
        }, function (e) {
          console.warn("[SW] precache MISS:", u, e && e.message);
          return false;
        });
      }
      return pool(PRECACHE_URLS, PRECACHE_POOL, function (u) {
        return (resume ? cache.match(u) : Promise.resolve(undefined)).then(function (have) {
          if (have) return;
          return unchangedCopy(prev, u).then(function (same) {
          if (same) return cache.put(u, same);
          return download(u).then(function (ok) { if (!ok) netFailed.push(u); });
          });   // unchangedCopy
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
        return adoptNullfx(prev);
      }).then(function () {
        if (updating && netFailed.length && tries < PRECACHE_GIVE_UP) {
          throw new Error("precache: " + netFailed.length +
            " file(s) unreachable, keeping the current release (attempt " + tries + ")");
        }
        if (netFailed.length) {
          console.warn("[SW] precache: activating without " + netFailed.length +
            " file(s) after " + tries + " attempts:", netFailed.join(" "));
        }
        return cache.delete(PARTIAL_MARK);
      });
      });   // marker written
      });   // attempt count
      });   // PARTIAL_MARK + previous release
    })
  );
});

// ---------- Activate: purge old caches ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE, LANG_CACHE, NULLFX_CACHE, SOUNDS_CACHE, "oros-television-api", SHARE_INBOX];
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
    var headers = { "Content-Type": f.type || "application/octet-stream",
                    "X-Name": encodeURIComponent(String(f.name || "file").slice(0, 255)) };
    if (files.length > 1) headers["X-More"] = "1";
    return caches.open(SHARE_INBOX).then(function (c) {
      return c.put("/__share/" + id, new Response(f, { headers: headers }));
    }).then(function () { return go("share-files=" + id); });
  }).catch(function () { return go(""); });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

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
self.addEventListener("push", function (event) {
  var d = null;
  try { d = event.data ? event.data.json() : null; } catch (e) { d = null; }
  if (!d || d.v !== 1 || typeof d.title !== "string" || typeof d.k !== "string") return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var onScreen = list.some(function (c) { return c.visibilityState === "visible"; });
    if (onScreen && d.ns !== "system") return;
    var alarm = d.kind === "alarm";
    return self.registration.showNotification("orOS — " + d.title.slice(0, 120), {
      body: typeof d.body === "string" ? d.body.slice(0, 240) : "",
      tag: d.k.slice(0, 200),
      renotify: alarm,
      requireInteraction: alarm,
      vibrate: alarm ? [400, 200, 400, 200, 400] : [200],
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
