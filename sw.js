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

var CACHE_VERSION = "oros-v1.03.00";
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
  "./notifications.js",
  "./pet.css",
  "./pet.js",
  "./launcher.js",
  "./fileopen.js",
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
  "todo/search.js",
  "kanban/",
  "kanban/index.html",
  "kanban/kanban.css",
  "kanban/kanban.js",
  "mindmap/",
  "mindmap/index.html",
  "mindmap/search.js",
  "mindmap/mindmap.css",
  "mindmap/mm-core.js",
  "mindmap/mm-import.js",
  "mindmap/mindmap.js",
  "mindmap/help.en.txt",
  "mindmap/help.el.txt",
  "kanban/search.js",
  "notes/",
  "notes/index.html",
  "notes/notes.css",
  "notes/notes.js",
  "notes/search.js",
  "weather/",
  "weather/index.html",
  "weather/weather.css",
  "weather/weather.js",
  "mood/",
  "mood/index.html",
  "mood/search.js",
  "mood/mood.css",
  "mood/mood.js",
  "diary/",
  "diary/index.html",
  "diary/search.js",
  "diary/diary.css",
  "diary/core.js",
  "diary/diary.js",
  "time/",
  "time/index.html",
  "time/time.css",
  "time/time.js",
  "time/astro.js",
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
  "calendar/days.json",
  "calendar/search.js",
  "quote/",
  "quote/index.html",
  "quote/search.js",
  "quote/quote.css",
  "quote/quote.js",
  "crm/",
  "crm/index.html",
  "crm/crm.css",
  "crm/core.js",
  "crm/crm.js",
  "crm/search.js",
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
  "water/water.js",
  "water/help.en.txt",
  "water/help.el.txt",
  "timesheet/timesheet.js",
  "storage/",
  "storage/index.html",
  "storage/search.js",
  "storage/storage.css",
  "storage/storage.js",
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
  "bookmarks/search.js",
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
  "health/",
  "health/index.html",
  "health/search.js",
  "health/core.js",
  "health/health.css",
  "health/health.js",
  "health/help.en.txt",
  "health/help.el.txt",
  "files/",
  "files/index.html",
  "files/files.css",
  "files/files.js",
  "files/search.js",
  "writer/",
  "writer/index.html",
  "writer/writer.css",
  "writer/writer.js",
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
  "layout/story.js",
  "layout/caret.js",
  "layout/inframe.js",
  "layout/sla.js",
  "layout/idml.js",
  "layout/pdfin.js",
  "layout/io.js",
  "designkit/assets.js",
  "designkit/fx.js",
  "designkit/media.js",
  "designkit/model.js",
  "designkit/pdf.js",
  "designkit/render.js",
  "designkit/show.js",
  "designkit/templates.js",
  "designkit/text.js",
  "help/",
  "help/index.html",
  "help/search.js",
  "help/help.css",
  "help/help.js",
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
  "stickies/help.en.txt",
  "stickies/help.el.txt",
  "textcase/help.en.txt",
  "textcase/help.el.txt",
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
  "tetris/help.en.txt",
  "tetris/help.el.txt",
  "tictactoe/help.en.txt",
  "tictactoe/help.el.txt",
  "timesheet/help.en.txt",
  "timesheet/help.el.txt",
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
  "cycle/",
  "cycle/index.html",
  "cycle/search.js",
  "cycle/cycle.css",
  "cycle/cycle.js",
  "contacts/",
  "contacts/index.html",
  "contacts/contacts.css",
  "contacts/contacts.js",
  "contacts/search.js",
  "garage/",
  "garage/index.html",
  "garage/search.js",
  "garage/core.js",
  "garage/garage.css",
  "garage/garage.js",
  "dice/",
  "dice/index.html",
  "dice/dice.css",
  "dice/dice.js",
  "petcare/",
  "petcare/index.html",
  "petcare/search.js",
  "petcare/core.js",
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
  "baby/baby.js",
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
  "assistant/core.js",
  "assistant/assistant.js",
  "assistant/help.en.txt",
  "assistant/help.el.txt",
  "settings/",
  "settings/index.html",
  "settings/settings.css",
  "settings/core.js",
  "settings/settings.js",
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
  "todo/today.js",
  "quote/today.js",
  "kanban/today.js",
  "contacts/today.js",
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
  "photolab/paint.js",
  "photolab/resample.js",
  "photolab/adjust.js",
  "photolab/filters.js",
  "photolab/store.js",
  "photolab/psd.js",
  "photolab/ora.js",
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
  "atelier/anim.js",
  "atelier/core.js",
  "atelier/draw.js",
  "atelier/editor.js",
  "atelier/panels.js",
  "atelier/sources.js",
  "atelier/fonts.js",
  "atelier/brandkit.js",
  "atelier/brand.js",
  "atelier/folders.js",
  "atelier/homefolders.js",
  "atelier/clips.js",
  "atelier/video.js",
  "atelier/gif.js",
  "atelier/motion.js",
  "atelier/zip.js",
  "atelier/pptx.js",
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
  "spreadsheet/",
  "spreadsheet/index.html",
  "spreadsheet/search.js",
  "spreadsheet/spreadsheet.css",
  "spreadsheet/spreadsheet.js",
  "podcasts/",
  "podcasts/index.html",
  "podcasts/search.js",
  "podcasts/podcasts.css",
  "podcasts/core.js",
  "podcasts/store.js",
  "podcasts/host.js",
  "podcasts/podcasts.js",
  "radio/",
  "radio/index.html",
  "radio/search.js",
  "radio/radio.css",
  "radio/radio.js",
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
  "studio/rec.worklet.js",
  "maps/",
  "maps/index.html",
  "maps/search.js",
  "maps/maps.css",
  "maps/maps.js",
  "feeds/",
  "feeds/index.html",
  "feeds/search.js",
  "feeds/feeds.css",
  "feeds/core.js",
  "feeds/sanitize.js",
  "feeds/fetch.js",
  "feeds/extract.js",
  "feeds/feeds.js",
  "museum/",
  "museum/index.html",
  "museum/museum.css",
  "museum/core.js",
  "museum/museum.js",
  "museum/help.en.txt",
  "museum/help.el.txt",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
  "calculator/",
  "calculator/index.html",
  "calculator/calculator.css",
  "calculator/calculator.js",
  "stickies/",
  "stickies/index.html",
  "stickies/stickies.css",
  "stickies/core.js",
  "stickies/host.js",
  "stickies/stickies.js",
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
  "budget/budget.js",
  "budget/feed.js",
  "checkers/",
  "checkers/index.html",
  "checkers/checkers.css",
  "checkers/checkers.js",
  "chess/",
  "chess/index.html",
  "chess/chess.css",
  "chess/chess.js",
  "familytree/",
  "familytree/index.html",
  "familytree/search.js",
  "familytree/familytree.css",
  "familytree/familytree.js",
  "familytree/ft-core.js",
  "fitness/",
  "fitness/index.html",
  "fitness/search.js",
  "fitness/fitness.css",
  "fitness/core.js",
  "fitness/fitness.js",
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
  "tetris/",
  "tetris/index.html",
  "tetris/tetris.css",
  "tetris/tetris.js",
  "travel/",
  "travel/index.html",
  "travel/search.js",
  "travel/travel.css",
  "travel/travel.js",
  "travel/core.js",
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
      return cache.match(PARTIAL_MARK).then(function (resume) {
      return Promise.all(PRECACHE_URLS.map(function (u) {
        return (resume ? cache.match(u) : Promise.resolve(undefined)).then(function (have) {
          if (have) return;
          return fetch(new Request(u, { cache: "reload" })).then(function (response) {
            if (!response.ok) {
              console.warn("[SW] precache MISS:", u, response.status);
              return;
            }
            return cache.put(u, response);
          }, function (e) {
            netFailed.push(u);
            console.warn("[SW] precache MISS:", u, e && e.message);
          });
        });
      })).then(function () {
        if (updating && netFailed.length) {
          return cache.put(PARTIAL_MARK, new Response("")).catch(function () {}).then(function () {
            throw new Error("precache: " + netFailed.length +
              " file(s) unreachable, keeping the current release");
          });
        }
        return cache.delete(PARTIAL_MARK);
      });
      });   // PARTIAL_MARK
    })
  );
});

// ---------- Activate: purge old caches ----------
self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE, "oros-television-api", SHARE_INBOX];
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
// Android "Share → orOS" (manifest share_target, POST multipart to
// /?share-target). Links go on as before: a GET to /?share-url=…
// (Bookmarks). A file is kept in the "oros-share-inbox" cache under a
// random id and orOS opens at /?share-files=<id>; fileopen.js takes
// it once and empties the inbox. Only the first file; > 50 MB is
// refused (?share-files=big). Nothing is parsed or run here.
var SHARE_INBOX = "oros-share-inbox";
var SHARE_MAX = 50 * 1024 * 1024;
function shareTargetPost(request) {
  var home = new URL("./", self.registration.scope).href;
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
    event.respondWith(networkFirst(event, request, { cache: "no-store" },
      function (response) { return response.ok; },
      function () { return caches.match(request); },
      function () { return Response.error(); }));
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
    event.respondWith(networkFirst(event, request, { cache: "no-cache" },
      function (response) {
        // Cache only REAL pages: a cached 404/502 becomes the
        // offline "truth" for that URL. OAuth redirects (?code=...)
        // are one-shot URLs — never worth a cache entry; so are
        // "Send to orOS" launches (?share-url=…, one per link) and
        // address-bar searches (?search=…), and "Open with" file
        // launches (?file-open=…).
        // SWK-4: a REDIRECTED response ("todo" → "todo/") cannot be
        // replayed to a navigation from the cache — the browser
        // rejects it and the page fails offline. Never store one.
        return response.ok && !response.redirected &&
          url.search.indexOf("code=") === -1 &&
          url.search.indexOf("share-") === -1 &&
          url.search.indexOf("search=") === -1 &&
          url.search.indexOf("file-open=") === -1;
      },
      function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          // SWK-3: the shell page is the right fallback for the TOP
          // window only. For an app frame it loaded orOS inside
          // orOS — a second shell, with its own sync engine, in the
          // iframe.
          return frame ? undefined : caches.match("./index.html");
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
            '<p>Offline — this app has not been saved for offline use yet.<br>' +
            'Εκτός σύνδεσης — η εφαρμογή δεν έχει αποθηκευτεί ακόμη για χρήση χωρίς δίκτυο.</p></body>',
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return Response.error();
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