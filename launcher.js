// ============================================================
// orOS — launcher.js (favourites: desktop shortcuts + Dock, v1.1.0)
// ------------------------------------------------------------
// A shell component, like pet.js: it runs IN the shell document,
// keeps its own storage and registers its own sync slice. shell.js
// only calls attach() once at boot, refresh() after every menu
// render, menuRow() for each app row of the menu and
// renderSettings() for the Dock section. A bundle without this file
// draws exactly what it drew before.
//
//   • The menu: a star at the end of every app row opens a small
//     panel with two switches, "On the desktop" and "In the Dock".
//     The star is filled while the app has a shortcut anywhere.
//   • The desktop: shortcuts in an automatic grid, in the order they
//     were added. Tap opens; right-click, a long press or the
//     context-menu key opens a small menu (Open · Move earlier ·
//     Move later · Remove).
//   • The Dock: a mac-style bar at the bottom, OFF until the user
//     turns it on in Settings (size, style, magnify, auto-hide,
//     over open apps: off until chosen). Same small menu; mouse users can also drag.
//     While it is shown, --tb-h lifts the pet and the desktop grid.
//
// Data (synced, slice "launcher", key oros-launcher-data):
//   { ver:1, items:[{ id, desk, dock, mtime }] }
//   • id    = the app id from apps.json;
//   • desk  = order key on the desktop, or null (not there);
//   • dock  = order key in the Dock, or null (not there);
//   • mtime = ms of the last change to THIS item (R27: stamped at the
//     mutation site only).
//   Order keys are fractional: moving one shortcut rewrites only that
//   item, so two devices reordering different apps never fight.
//   Removing both places keeps the item with a new mtime: it is its
//   own tombstone (at most one item per app id, so it stays small).
// Merge: union by id; per id the higher mtime wins, a tie goes to the
//   greater canonical JSON. Items sorted by id, fixed field order
//   (R26). A fresh device stores nothing until the first real change.
// Pure logic (normalize, merge, pin, move, list) is unit-tested in
// node (tests/launcher.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var DATA_KEY = "oros-launcher-data";
  var MAX_ITEMS = 500;
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  var PLACES = ["desk", "dock"];

  // ---------- 1. Model (pure) ----------
  function num(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  function cleanItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    var m = (typeof it.mtime === "number" && isFinite(it.mtime) && it.mtime >= 0) ? Math.floor(it.mtime) : 0;
    return { id: it.id, desk: num(it.desk), dock: num(it.dock), mtime: m };
  }

  // The winner between two versions of the same app's item.
  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // The single funnel: load, save, merge output, slice get and set.
  function normalize(data) {
    var byId = {};
    var list = (data && typeof data === "object" && Array.isArray(data.items)) ? data.items : [];
    for (var i = 0; i < list.length; i++) {
      var it = cleanItem(list[i]);
      if (!it) continue;
      byId[it.id] = byId[it.id] ? newer(byId[it.id], it) : it;
    }
    var ids = Object.keys(byId).sort();
    if (ids.length > MAX_ITEMS) ids = ids.slice(0, MAX_ITEMS);
    return { ver: 1, items: ids.map(function (id) { return byId[id]; }) };
  }

  function merge(a, b) {
    var na = normalize(a), nb = normalize(b);
    return normalize({ items: na.items.concat(nb.items) });
  }

  function find(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  // Ids placed in `place`, in their shown order (order key, then id).
  function list(data, place) {
    return data.items.filter(function (it) { return it[place] !== null; })
      .sort(function (a, b) { return (a[place] - b[place]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); })
      .map(function (it) { return it.id; });
  }

  function isPinned(data, id, place) {
    var it = find(data, id);
    if (!it) return false;
    if (place) return it[place] !== null;
    return it.desk !== null || it.dock !== null;
  }

  // Returns a NEW normalized object; the input is never mutated.
  function withItem(data, id, fields, now) {
    var d = normalize(data);
    var it = find(d, id);
    var next = { id: id, desk: it ? it.desk : null, dock: it ? it.dock : null, mtime: Math.max(now, it ? it.mtime + 1 : 0) };
    Object.keys(fields).forEach(function (k) { next[k] = fields[k]; });
    var items = d.items.filter(function (x) { return x.id !== id; });
    items.push(next);
    return normalize({ items: items });
  }

  // Pin goes to the END of the place; unpin clears it. No-op when the
  // state is already right (mtime moves only on a real change).
  function pin(data, id, place, on, now) {
    var d = normalize(data);
    if (!ID_RE.test(String(id)) || PLACES.indexOf(place) === -1) return d;
    if (isPinned(d, id, place) === !!on) return d;
    var f = {};
    if (on) {
      var max = 0;
      d.items.forEach(function (it) { if (it[place] !== null && it[place] > max) max = it[place]; });
      f[place] = Math.floor(max) + 1;
    } else {
      f[place] = null;
    }
    return withItem(d, id, f, now);
  }

  // dir -1 = earlier, +1 = later. Only the moved item changes, unless
  // the keys have become too close to split: then the whole place is
  // renumbered 1..n (every item stamped, rare).
  function move(data, id, place, dir, now) {
    var d = normalize(data);
    var ids = list(d, place);
    var i = ids.indexOf(id);
    var j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= ids.length) return d;
    var key = function (k) { return find(d, ids[k])[place]; };
    var lo, hi;
    if (dir < 0) { hi = key(j); lo = (j - 1 >= 0) ? key(j - 1) : hi - 2; }
    else { lo = key(j); hi = (j + 1 < ids.length) ? key(j + 1) : lo + 2; }
    var mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi) || hi - lo < 1e-6) {
      ids.splice(i, 1);
      ids.splice(j, 0, id);
      var out = d;
      ids.forEach(function (x, n) {
        var f = {}; f[place] = n + 1;
        out = withItem(out, x, f, now);
      });
      return out;
    }
    var f = {}; f[place] = mid;
    return withItem(d, id, f, now);
  }

  // Drop `id` at position `index` of the place (0 = first), as a drag
  // does. Same rules as move(): one item changes, or a renumbering.
  function moveTo(data, id, place, index, now) {
    var d = normalize(data);
    var ids = list(d, place);
    var i = ids.indexOf(id);
    if (i === -1) return d;
    index = Math.max(0, Math.min(ids.length - 1, Math.floor(index)));
    if (index === i) return d;
    while (i !== index) {
      var dir = index < i ? -1 : 1;
      d = move(d, id, place, dir, now);
      i += dir;
    }
    return d;
  }

  var model = { normalize: normalize, merge: merge, list: list, isPinned: isPinned, pin: pin, move: move, moveTo: moveTo, VER: VER, DATA_KEY: DATA_KEY };

  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (!root || !root.document) return;

  // ---------- 2. Storage + sync ----------
  var doc = root.document;
  var host = null;               // set by attach()
  var cache = null;              // normalized data in memory

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) {
        // Unreadable: keep a copy, never overwrite it silently.
        try { root.localStorage.setItem(DATA_KEY + "-broken", raw); } catch (e2) {}
      }
    }
    cache = normalize(parsed);
    return cache;
  }

  function store(d) {
    cache = normalize(d);
    try { root.localStorage.setItem(DATA_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function change(d) {
    if (JSON.stringify(d) === JSON.stringify(load())) return;
    store(d);
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
    paint();
  }

  function sliceGet() {
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return null;     // nothing yet: a fresh device sends nothing
    return load();
  }

  function sliceSet(data) {
    if (!data) return;
    store(data);               // no markDirty: pulled data must not re-push
    paint();
  }

  function registerSync() {
    var api = root.orosSync;
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("launcher", sliceGet, sliceSet, DATA_KEY, merge);
  }

  // ---------- 3. Dock preferences (DEVICE-LOCAL, never synced) ----------
  // A phone and a PC want different docks, so only the pins travel.
  // oros-launcher-prefs = { on, size: s|m|l, magnify, autohide, over, style }
  // over: null = never chosen = off (Chris 2026-10-10; it used to follow
  // the pointer). A stored true / false is the user's own choice and wins.
  // style: the look of the bar (STYLES); unknown = "classic".
  var PREFS_KEY = "oros-launcher-prefs";
  var SIZES = { s: 40, m: 52, l: 64 };
  var STYLES = ["classic", "glass", "frosted", "smoke", "transparent", "solid", "3d", "neon"];

  function finePointer() {
    try { return root.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch (e) { return false; }
  }
  function prefs() {
    var p = null;
    try { p = JSON.parse(root.localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    return {
      on: p.on === true,
      size: SIZES[p.size] ? p.size : "m",
      magnify: p.magnify !== false,
      autohide: p.autohide === true,
      over: (p.over === true || p.over === false) ? p.over : null,
      style: STYLES.indexOf(p.style) >= 0 ? p.style : "classic"
    };
  }
  function savePrefs(p) {
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    paintDock();
  }
  function overApps(p) { return p.over === true; }

  // ---------- 4. Strings (EN / EL) ----------
  var STR = {
    en: {
      star: "Shortcuts", desk: "On the desktop", inDock: "In the Dock", open: "Open",
      earlier: "Move earlier", later: "Move later", remove: "Remove from desktop",
      removeDock: "Remove from the Dock", deskLabel: "Desktop shortcuts",
      dock: "Dock", dockOn: "Show the Dock", dockOff: "The Dock is off.", turnOn: "Turn on",
      size: "Size", s: "Small", m: "Medium", l: "Large",
      magnify: "Magnify on hover", autohide: "Hide automatically", over: "Show over open apps",
      empty: "Add apps with the ☆ next to each app above.", reveal: "Show the Dock"
    },
    el: {
      star: "Συντομεύσεις", desk: "Στην επιφάνεια εργασίας", inDock: "Στο Dock", open: "Άνοιγμα",
      earlier: "Μετακίνηση νωρίτερα", later: "Μετακίνηση αργότερα", remove: "Αφαίρεση από την επιφάνεια εργασίας",
      removeDock: "Αφαίρεση από το Dock", deskLabel: "Συντομεύσεις επιφάνειας εργασίας",
      dock: "Dock", dockOn: "Εμφάνιση του Dock", dockOff: "Το Dock είναι κλειστό.", turnOn: "Ενεργοποίηση",
      size: "Μέγεθος", s: "Μικρό", m: "Μεσαίο", l: "Μεγάλο",
      magnify: "Μεγέθυνση στο πέρασμα του ποντικιού", autohide: "Αυτόματη απόκρυψη",
      over: "Εμφάνιση πάνω από ανοιχτές εφαρμογές",
      empty: "Πρόσθεσε εφαρμογές με το ☆ δίπλα σε κάθε εφαρμογή παραπάνω.", reveal: "Εμφάνιση του Dock"
    }
  };
  function tr(k) {
    var lang = (host && host.lang && host.lang() === "el") ? "el" : "en";
    return STR[lang][k] || STR.en[k] || k;
  }

  // ---------- 5. Styles (injected once; skin variables only) ----------
  var CSS = [
    // menu star + panel
    ".ld-row{display:flex;align-items:center;gap:2px;position:relative}",
    ".ld-row>.menu-item{flex:1;min-width:0}",
    ".ld-star{flex:0 0 auto;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;",
    "background:transparent;border:none;border-radius:7px;color:var(--text-dim);cursor:pointer;padding:0}",
    ".ld-star:hover,.ld-star:focus-visible{background:var(--accent-soft);color:var(--accent)}",
    ".ld-star.on{color:var(--accent)}",
    ".ld-star svg{width:18px;height:18px}",
    ".ld-pop{margin:0 4px 6px 32px;padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}",
    ".ld-sw{display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px;color:var(--text);cursor:pointer;padding:0 10px}",
    ".ld-pop .ld-sw{padding:0}",
    ".ld-sw input{flex:0 0 auto;width:18px;height:18px;accent-color:var(--accent);margin:0}",
    ".ld-note{font-size:12px;color:var(--text-dim);padding:0 10px 8px 38px}",
    ".ld-pop .ld-note{padding:0 0 8px 28px}",
    ".ld-note button{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;padding:4px 0;text-decoration:underline}",
    ".ld-seg{display:flex;gap:4px;padding:4px 10px 6px}",
    ".ld-seg button{flex:1;min-height:40px;border:1px solid var(--border);border-radius:7px;background:transparent;",
    "color:var(--text);font-size:13px;cursor:pointer}",
    ".ld-seg button[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}",
    ".ld-lbl{font-size:12px;color:var(--text-dim);padding:6px 10px 0}",
    // desktop grid (the Dock lifts it through --tb-h)
    "#ld-desk{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px 4px;",
    "padding:14px 10px calc(150px + var(--tb-h,0px));max-width:960px;align-content:start}",
    "@media (min-width:600px){#ld-desk{grid-template-columns:repeat(auto-fill,96px);padding:20px 20px calc(150px + var(--tb-h,0px))}}",
    ".ld-ic{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 2px;min-height:44px;",
    "background:transparent;border:1px solid transparent;border-radius:10px;color:var(--text);cursor:pointer;",
    "-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}",
    ".ld-ic:hover,.ld-ic:focus-visible{background:var(--accent-soft);border-color:var(--border)}",
    ".ld-tile{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;",
    "background:var(--panel-bg);color:var(--accent);border:1px solid var(--border);box-shadow:0 2px 8px var(--shadow)}",
    ".ld-tile svg{width:28px;height:28px}",
    ".ld-name{font-size:12px;line-height:1.25;text-align:center;max-width:100%;overflow:hidden;display:-webkit-box;",
    "-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto;padding:1px 5px;border-radius:6px;",
    "background:color-mix(in srgb,var(--panel-bg) 72%,transparent)}",
    // small menu (desktop + Dock)
    ".ld-menu{position:fixed;z-index:1100;min-width:200px;max-width:calc(100vw - 16px);padding:4px;",
    "background:var(--panel-bg);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px var(--shadow)}",
    ".ld-menu button{display:block;width:100%;min-height:44px;padding:8px 12px;text-align:left;background:transparent;",
    "border:none;border-radius:7px;color:var(--text);font-size:14px;cursor:pointer}",
    ".ld-menu button:hover,.ld-menu button:focus-visible{background:var(--accent-soft)}",
    ".ld-menu button:disabled{opacity:.45;cursor:default;background:transparent}",
    ".ld-menu .ld-danger{color:var(--danger)}",
    // the Dock (z 950: over a running app at 900, under the menu at 999)
    "#ld-dock{position:fixed;left:50%;bottom:calc(6px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);",
    "z-index:950;max-width:calc(100vw - 16px);transition:transform .22s ease,opacity .22s ease}",
    "#ld-dock.ld-hidden{transform:translate(-50%,calc(100% + 12px));opacity:0;pointer-events:none}",
    ".ld-bar{display:flex;align-items:flex-end;gap:6px;padding:6px 8px;border-radius:18px;",
    "background:color-mix(in srgb,var(--panel-bg) 86%,transparent);border:1px solid var(--border);",
    "box-shadow:0 8px 28px var(--shadow);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
    ".ld-dk{position:relative;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:0;",
    "background:transparent;border:none;cursor:pointer;color:var(--accent);transform-origin:50% 100%;",
    "transition:transform .12s ease;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}",
    ".ld-dk .ld-tile{width:var(--ld-t);height:var(--ld-t);border-radius:calc(var(--ld-t) * .27);box-shadow:none}",
    ".ld-dk .ld-tile svg{width:calc(var(--ld-t) * .54);height:calc(var(--ld-t) * .54)}",
    ".ld-dk:focus-visible .ld-tile{outline:2px solid var(--accent);outline-offset:2px}",
    ".ld-dot{width:4px;height:4px;border-radius:50%;margin-top:3px;background:transparent}",
    ".ld-dk.run .ld-dot{background:var(--accent)}",
    ".ld-dk.drag{opacity:.55}",
    ".ld-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;",
    "padding:4px 9px;border-radius:7px;font-size:12px;background:var(--panel-bg);color:var(--text);",
    "border:1px solid var(--border);box-shadow:0 4px 14px var(--shadow);pointer-events:none;opacity:0;transition:opacity .12s}",
    "@media (hover:hover) and (pointer:fine){.ld-dk:hover .ld-tip,.ld-dk:focus-visible .ld-tip{opacity:1}}",
    // looks (Settings › Dock › Style): one class on #ld-dock, the bar only
    "#ld-dock.ld-s-glass .ld-bar{background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,.08));",
    "border:1px solid rgba(255,255,255,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(255,255,255,.12),0 10px 30px rgba(0,0,0,.28);",
    "-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%)}",
    "#ld-dock.ld-s-frosted .ld-bar{background:color-mix(in srgb,var(--panel-bg) 55%,rgba(255,255,255,.35));",
    "border:1px solid rgba(255,255,255,.3);-webkit-backdrop-filter:blur(28px) brightness(1.08);backdrop-filter:blur(28px) brightness(1.08)}",
    "#ld-dock.ld-s-smoke .ld-bar{background:rgba(18,18,22,.58);border:1px solid rgba(255,255,255,.1);",
    "box-shadow:0 10px 30px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(14px) grayscale(.5);backdrop-filter:blur(14px) grayscale(.5)}",
    "#ld-dock.ld-s-transparent .ld-bar{background:transparent;border-color:transparent;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}",
    "#ld-dock.ld-s-transparent .ld-tile{filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}",
    "#ld-dock.ld-s-solid .ld-bar{background:var(--panel-bg);-webkit-backdrop-filter:none;backdrop-filter:none}",
    "#ld-dock.ld-s-3d .ld-bar{position:relative;isolation:isolate;background:transparent;border-color:transparent;box-shadow:none;",
    "-webkit-backdrop-filter:none;backdrop-filter:none;padding-bottom:10px}",
    "#ld-dock.ld-s-3d .ld-bar::before{content:\"\";position:absolute;z-index:-1;left:4px;right:4px;bottom:2px;height:62%;border-radius:10px;",
    "transform:perspective(260px) rotateX(48deg);transform-origin:50% 100%;",
    "background:linear-gradient(180deg,color-mix(in srgb,var(--panel-bg) 35%,rgba(255,255,255,.7)),color-mix(in srgb,var(--panel-bg) 75%,rgba(255,255,255,.2)));",
    "border:1px solid rgba(255,255,255,.4);border-bottom:4px solid color-mix(in srgb,var(--panel-bg) 60%,#000);",
    "box-shadow:0 12px 24px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
    "#ld-dock.ld-s-3d .ld-tile{box-shadow:0 6px 10px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.35)}",
    "#ld-dock.ld-s-neon .ld-bar{background:color-mix(in srgb,var(--panel-bg) 78%,transparent);border:1px solid var(--accent);",
    "box-shadow:0 0 14px color-mix(in srgb,var(--accent) 55%,transparent),inset 0 0 12px color-mix(in srgb,var(--accent) 22%,transparent)}",
    "#ld-dock.ld-s-neon .ld-dk.run .ld-dot{box-shadow:0 0 6px var(--accent)}",
    // auto-hide: an edge strip (mouse) and a small handle (touch)
    "#ld-edge{position:fixed;left:0;right:0;bottom:0;height:calc(10px + env(safe-area-inset-bottom,0px));z-index:949;",
    "display:flex;align-items:flex-end;justify-content:center;background:transparent;border:none;padding:0 0 env(safe-area-inset-bottom,0px);cursor:pointer}",
    "#ld-edge[hidden]{display:none}",
    "#ld-edge span{width:44px;height:4px;border-radius:2px;margin-bottom:3px;background:var(--text-dim);opacity:.6}",
    "@media (pointer:coarse){#ld-edge{height:calc(24px + env(safe-area-inset-bottom,0px));left:calc(50% - 40px);right:auto;width:80px}}",
    // a running app hides the Dock unless "over open apps" is on
    "#oros-running.active ~ #ld-dock.ld-noover,#oros-running.active ~ #ld-edge.ld-noover{display:none}",
    // a pinned (not auto-hidden) Dock over apps: the app ends above it
    "html.ld-push #oros-running.active{bottom:calc(var(--tb-h,0px) + env(safe-area-inset-bottom,0px))}",
    "@media (max-width:480px){.ld-bar{overflow-x:auto;overscroll-behavior:contain;scrollbar-width:none}",
    ".ld-bar::-webkit-scrollbar{display:none}}"
  ].join("\n");

  function injectCss() {
    if (doc.getElementById("ld-css")) return;
    var s = doc.createElement("style");
    s.id = "ld-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  // Outline star / filled star (static markup, never data).
  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z"/></svg>';
  var STAR_ON = STAR.replace('fill="none"', 'fill="currentColor"');

  // ---------- 6. Helpers ----------
  function apps() { return (host && host.apps && host.apps()) || []; }
  function appById(id) {
    var a = apps();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function labelOf(app) { return host && host.label ? host.label(app) : app.name; }
  function iconOf(app) {
    var icons = (host && host.icons) || {};
    return Object.prototype.hasOwnProperty.call(icons, app.icon) ? icons[app.icon] : "";
  }
  function runningId() {
    var r = host && host.running && host.running();
    return r ? r.id : null;
  }
  function launch(id) {
    var app = appById(id);
    if (!app || runningId() === id) return;     // never reload the open app
    host.open(app);
  }
  function shown(place) {
    return list(load(), place).filter(function (id) { return !!appById(id); });
  }
  function switchRow(text, checked, onChange, key) {
    var sw = doc.createElement("label");
    sw.className = "ld-sw";
    var cb = doc.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    if (key) cb.setAttribute("data-k", key);
    cb.addEventListener("change", function () { onChange(cb.checked); });
    sw.appendChild(cb);
    var tx = doc.createElement("span");
    tx.textContent = text;
    sw.appendChild(tx);
    return sw;
  }

  // ---------- 7. Menu: the star and its panel ----------
  var openPop = null;            // app id whose panel is open (memory only)

  function paintStar(btn, id) {
    var on = isPinned(load(), id);
    btn.classList.toggle("on", on);
    btn.innerHTML = on ? STAR_ON : STAR;     // static markup
  }

  function buildPop(app, star) {
    var pop = doc.createElement("div");
    pop.className = "ld-pop";
    pop.id = "ld-pop-" + app.id;
    PLACES.forEach(function (place) {
      pop.appendChild(switchRow(tr(place === "desk" ? "desk" : "inDock"), isPinned(load(), app.id, place), function (on) {
        change(pin(load(), app.id, place, on, Date.now()));
        paintStar(star, app.id);
        paintDockNote(pop);
      }, place));
    });
    paintDockNote(pop);
    return pop;
  }

  // "The Dock is off · Turn on", only while this app is in an off Dock.
  function paintDockNote(pop) {
    var old = pop.querySelector(".ld-note");
    if (old) old.remove();
    var cb = pop.querySelector('input[data-k="dock"]');
    if (!cb || !cb.checked || prefs().on) return;
    var note = doc.createElement("div");
    note.className = "ld-note";
    note.appendChild(doc.createTextNode(tr("dockOff") + " "));
    var b = doc.createElement("button");
    b.type = "button";
    b.textContent = tr("turnOn");
    b.addEventListener("click", function () {
      var p = prefs(); p.on = true; savePrefs(p);
      note.remove();
      cb.focus();
      repaintSettings();
    });
    note.appendChild(b);
    pop.appendChild(note);
  }

  // Wraps the shell's app button in a row with the star. The panel is
  // toggled IN PLACE (no menu rebuild), and the open panel survives
  // the shell's rebuilds through `openPop`.
  function menuRow(btn, app) {
    if (!app || !ID_RE.test(String(app.id)) || app.type === "external") return btn;
    var row = doc.createElement("div");
    row.className = "ld-row-wrap";
    var line = doc.createElement("div");
    line.className = "ld-row";
    line.appendChild(btn);
    var star = doc.createElement("button");
    star.type = "button";
    star.className = "ld-star";
    star.title = tr("star");
    star.setAttribute("aria-label", tr("star") + ": " + labelOf(app));
    star.setAttribute("aria-controls", "ld-pop-" + app.id);
    star.setAttribute("data-app", app.id);
    paintStar(star, app.id);
    line.appendChild(star);
    row.appendChild(line);

    function show(open) {
      var old = row.querySelector(".ld-pop");
      if (old) old.remove();
      star.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) row.appendChild(buildPop(app, star));
    }
    star.addEventListener("click", function () {
      if (openPop && openPop !== app.id) {
        var other = doc.getElementById("ld-pop-" + openPop);
        if (other) {
          var os = other.parentNode && other.parentNode.querySelector(".ld-star");
          if (os) os.setAttribute("aria-expanded", "false");
          other.remove();
        }
      }
      openPop = (openPop === app.id) ? null : app.id;
      show(openPop === app.id);
      if (openPop) {
        var cb = row.querySelector(".ld-pop input");
        if (cb) cb.focus();
      }
    });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openPop === app.id) {
        e.stopPropagation();
        openPop = null;
        show(false);
        star.focus();
      }
    });
    show(openPop === app.id);
    return row;
  }

  function paintStars() {
    var stars = doc.querySelectorAll(".ld-star[data-app]");
    for (var i = 0; i < stars.length; i++) {
      var id = stars[i].getAttribute("data-app");
      paintStar(stars[i], id);
      var pop = doc.getElementById("ld-pop-" + id);
      if (!pop) continue;
      PLACES.forEach(function (place) {
        var cb = pop.querySelector('input[data-k="' + place + '"]');
        if (cb) cb.checked = isPinned(load(), id, place);
      });
      paintDockNote(pop);
    }
  }

  // ---------- 8. Menu: the Dock settings section ----------
  // A callable builder, so a future Settings app can host it too.
  function buildSettings() {
    var p = prefs();
    var sec = doc.createElement("div");
    sec.className = "sync-section";
    sec.id = "ld-set";
    var h = doc.createElement("div");
    h.className = "menu-heading";
    h.textContent = tr("dock");
    sec.appendChild(h);
    function set(k, v) { var q = prefs(); q[k] = v; savePrefs(q); repaintSettings(k); }
    sec.appendChild(switchRow(tr("dockOn"), p.on, function (v) { set("on", v); }, "on"));
    if (!p.on) return sec;

    var lbl = doc.createElement("div");
    lbl.className = "ld-lbl";
    lbl.id = "ld-size-lbl";
    lbl.textContent = tr("size");
    sec.appendChild(lbl);
    var seg = doc.createElement("div");
    seg.className = "ld-seg";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-labelledby", "ld-size-lbl");
    ["s", "m", "l"].forEach(function (k) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = tr(k);
      b.setAttribute("aria-pressed", p.size === k ? "true" : "false");
      b.setAttribute("data-k", "size-" + k);
      b.addEventListener("click", function () { set("size", k); });
      seg.appendChild(b);
    });
    sec.appendChild(seg);
    if (finePointer()) sec.appendChild(switchRow(tr("magnify"), p.magnify, function (v) { set("magnify", v); }, "magnify"));
    sec.appendChild(switchRow(tr("autohide"), p.autohide, function (v) { set("autohide", v); }, "autohide"));
    sec.appendChild(switchRow(tr("over"), overApps(p), function (v) { set("over", v); }, "over"));
    if (!shown("dock").length) {
      var note = doc.createElement("div");
      note.className = "ld-note";
      note.textContent = tr("empty");
      sec.appendChild(note);
    }
    return sec;
  }

  function renderSettings(menu) {
    if (!host || !menu) return;
    menu.appendChild(buildSettings());
  }

  // Rebuild the section in place (no menu rebuild) and keep focus.
  function repaintSettings(focusKey) {
    var old = doc.getElementById("ld-set");
    if (!old) return;
    var fresh = buildSettings();
    old.replaceWith(fresh);
    var k = focusKey === "size" ? "size-" + prefs().size : focusKey;
    var el = k && fresh.querySelector('[data-k="' + k + '"]');
    if (el) el.focus();
  }

  // ---------- 9. Small menu (desktop icons + Dock icons) ----------
  var ctx = null;                // { el, back } of the open small menu

  function closeCtx(refocus) {
    if (!ctx) return;
    var back = ctx.back;
    ctx.el.remove();
    ctx = null;
    doc.removeEventListener("pointerdown", ctxOutside, true);
    if (refocus && back && back.isConnected) back.focus();
  }
  function ctxOutside(e) {
    if (ctx && !ctx.el.contains(e.target)) closeCtx(false);
  }

  function openCtx(id, place, anchor, x, y) {
    closeCtx(false);
    var app = appById(id);
    if (!app) return;
    var ids = list(load(), place);
    var i = ids.indexOf(id);
    var m = doc.createElement("div");
    m.className = "ld-menu";
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", labelOf(app));
    function item(key, fn, disabled, cls) {
      var b = doc.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = tr(key);
      if (cls) b.className = cls;
      b.disabled = !!disabled;
      b.addEventListener("click", function () { closeCtx(false); fn(); });
      m.appendChild(b);
    }
    item("open", function () { launch(id); });
    item("earlier", function () { change(move(load(), id, place, -1, Date.now())); focusIcon(id, place); }, i <= 0);
    item("later", function () { change(move(load(), id, place, 1, Date.now())); focusIcon(id, place); }, i === -1 || i >= ids.length - 1);
    item(place === "desk" ? "remove" : "removeDock", function () { change(pin(load(), id, place, false, Date.now())); }, false, "ld-danger");
    m.addEventListener("keydown", function (e) {
      var bs = Array.prototype.slice.call(m.querySelectorAll("button:not(:disabled)"));
      var k = bs.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCtx(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(k + 1) % bs.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(k - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === "Tab") { closeCtx(false); }
    });
    doc.body.appendChild(m);
    var r = m.getBoundingClientRect();
    var vw = root.innerWidth, vh = root.innerHeight;
    if (place === "dock") y = y - r.height - 8;     // open upwards from the Dock
    m.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
    ctx = { el: m, back: anchor };
    doc.addEventListener("pointerdown", ctxOutside, true);
    var first = m.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function focusIcon(id, place) {
    var el = doc.querySelector((place === "dock" ? "#ld-dock" : "#ld-desk") + ' [data-app="' + id + '"]');
    if (el) el.focus();
  }

  // Long press on touch (500 ms; moving more than 10 px cancels; the
  // click that follows is swallowed). Mouse: the contextmenu event.
  function wireIcon(b, id, place) {
    var timer = null, sx = 0, sy = 0, fired = 0;
    b.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fired = Date.now();
        openCtx(id, place, b, sx, sy);
      }, 500);
    });
    b.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(timer); timer = null; }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
      b.addEventListener(t, function () { if (timer) { clearTimeout(timer); timer = null; } });
    });
    b.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (Date.now() - fired < 1000) return;      // the long press already opened it
      var r = b.getBoundingClientRect();
      var kb = !e.clientX && !e.clientY;           // context-menu key
      openCtx(id, place, b, kb ? r.left : e.clientX, kb ? (place === "dock" ? r.top : r.bottom) : e.clientY);
    });
    b.addEventListener("click", function (e) {
      if (Date.now() - fired < 1000 || b.__ldDragged) { e.preventDefault(); b.__ldDragged = false; return; }
      launch(id);
    });
  }

  function tileFor(app) {
    var tile = doc.createElement("span");
    tile.className = "ld-tile";
    tile.innerHTML = iconOf(app);            // static shell icon, not data
    return tile;
  }

  // ---------- 10. Desktop shortcuts ----------
  function paintDesktop() {
    var desk = host && host.desktop;
    if (!desk) return;
    var grid = doc.getElementById("ld-desk");
    var ids = shown("desk");
    if (!ids.length) { if (grid) grid.remove(); return; }
    var act = doc.activeElement;
    var focusId = act && act.closest && act.closest("#ld-desk") ? act.getAttribute("data-app") : null;
    if (!grid) {
      grid = doc.createElement("div");
      grid.id = "ld-desk";
      grid.setAttribute("role", "list");
      desk.appendChild(grid);
    }
    grid.setAttribute("aria-label", tr("deskLabel"));
    grid.lang = (host.lang && host.lang() === "el") ? "el" : "en";     // hyphenation of long names
    grid.textContent = "";
    ids.forEach(function (id) {
      var app = appById(id);
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-ic";
      b.setAttribute("role", "listitem");
      b.setAttribute("data-app", id);
      b.title = labelOf(app);
      b.appendChild(tileFor(app));
      var nm = doc.createElement("span");
      nm.className = "ld-name";
      nm.textContent = labelOf(app);
      b.appendChild(nm);
      wireIcon(b, id, "desk");
      grid.appendChild(b);
    });
    if (focusId) focusIcon(focusId, "desk");
  }

  // ---------- 11. The Dock ----------
  var dock = null, edge = null, hideTimer = null, dockShownAt = 0;

  function dockHeight(p) { return SIZES[p.size] + 7 + 12 + 2 + 6; }   // tile + dot + padding + border + gap

  function setVars(p, visible) {
    var de = doc.documentElement;
    var lift = (visible && !p.autohide) ? dockHeight(p) + 6 : 0;
    if (lift) de.style.setProperty("--tb-h", lift + "px");
    else de.style.removeProperty("--tb-h");
    de.classList.toggle("ld-push", !!lift && overApps(p));
  }

  function removeDock() {
    if (dock) { dock.remove(); dock = null; }
    if (edge) { edge.remove(); edge = null; }
  }

  function revealDock() {
    if (!dock) return;
    clearTimeout(hideTimer);
    dock.classList.remove("ld-hidden");
    dockShownAt = Date.now();
  }
  function hideSoon(ms) {
    if (!dock || !prefs().autohide) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!dock) return;
      if (dock.contains(doc.activeElement) || (ctx && dock.contains(ctx.back))) { hideSoon(ms); return; }
      dock.classList.add("ld-hidden");
    }, ms);
  }

  function paintDock() {
    if (!host) return;
    var p = prefs();
    var ids = p.on ? shown("dock") : [];
    if (!ids.length) { removeDock(); setVars(p, false); return; }
    var act = doc.activeElement;
    var focusId = act && dock && dock.contains(act) ? act.getAttribute("data-app") : null;
    if (!dock) {
      dock = doc.createElement("div");
      dock.id = "ld-dock";
      dock.setAttribute("role", "toolbar");
      var bar = doc.createElement("div");
      bar.className = "ld-bar";
      dock.appendChild(bar);
      doc.body.appendChild(dock);
      wireDock(dock, bar);
      edge = doc.createElement("button");
      edge.type = "button";
      edge.id = "ld-edge";
      edge.appendChild(doc.createElement("span"));
      edge.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") revealDock(); });
      edge.addEventListener("click", function () { revealDock(); hideSoon(4000); });
      doc.body.appendChild(edge);
      if (p.autohide) dock.classList.add("ld-hidden");
    }
    dock.setAttribute("aria-label", tr("dock"));
    edge.setAttribute("aria-label", tr("reveal"));
    edge.title = tr("reveal");
    var noover = !overApps(p);
    dock.classList.toggle("ld-noover", noover);
    edge.classList.toggle("ld-noover", noover);
    edge.hidden = !p.autohide;
    edge.tabIndex = -1;                 // keyboard users reach the Dock itself (focus reveals it)
    if (!p.autohide) { clearTimeout(hideTimer); dock.classList.remove("ld-hidden"); }
    dock.style.setProperty("--ld-t", SIZES[p.size] + "px");
    STYLES.forEach(function (k) { dock.classList.toggle("ld-s-" + k, p.style === k); });
    var bar2 = dock.firstChild;
    bar2.textContent = "";
    var run = runningId();
    ids.forEach(function (id) {
      var app = appById(id);
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-dk" + (run === id ? " run" : "");
      b.setAttribute("data-app", id);
      b.setAttribute("aria-label", labelOf(app));
      if (run === id) b.setAttribute("aria-current", "true");
      b.appendChild(tileFor(app));
      var dot = doc.createElement("span");
      dot.className = "ld-dot";
      b.appendChild(dot);
      var tip = doc.createElement("span");
      tip.className = "ld-tip";
      tip.setAttribute("aria-hidden", "true");
      tip.textContent = labelOf(app);
      b.appendChild(tip);
      wireIcon(b, id, "dock");
      bar2.appendChild(b);
    });
    setVars(p, true);
    if (focusId) focusIcon(focusId, "dock");
  }

  function wireDock(dk, bar) {
    // Auto-hide: leaving the Dock hides it again; focus shows it.
    dk.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hideSoon(900); });
    dk.addEventListener("pointerenter", function () { clearTimeout(hideTimer); });
    dk.addEventListener("focusin", revealDock);
    dk.addEventListener("focusout", function () { hideSoon(900); });
    doc.addEventListener("pointerdown", function (e) {
      if (dock && prefs().autohide && !dock.contains(e.target) && !(edge && edge.contains(e.target)) &&
          !(ctx && ctx.el.contains(e.target)) && Date.now() - dockShownAt > 300) hideSoon(0);
    }, true);

    // Arrow keys walk the icons.
    bar.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      var bs = Array.prototype.slice.call(bar.querySelectorAll(".ld-dk"));
      var i = bs.indexOf(doc.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var j = e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : i + (e.key === "ArrowLeft" ? -1 : 1);
      if (bs[j]) bs[j].focus();
    });

    // Magnify (mouse only, when the setting is on).
    bar.addEventListener("mousemove", function (e) {
      var p = prefs();
      if (!p.magnify || !finePointer() || dragging) return;
      var t = SIZES[p.size];
      var bs = bar.querySelectorAll(".ld-dk");
      for (var i = 0; i < bs.length; i++) {
        var r = bs[i].getBoundingClientRect();
        var d = Math.abs(e.clientX - (r.left + r.width / 2));
        var s = 1 + 0.45 * Math.max(0, 1 - d / (t * 2.2));
        bs[i].style.transform = s > 1.001 ? "scale(" + s.toFixed(3) + ")" : "";
      }
    });
    bar.addEventListener("mouseleave", unmagnify);
    function unmagnify() {
      var bs = bar.querySelectorAll(".ld-dk");
      for (var i = 0; i < bs.length; i++) bs[i].style.transform = "";
    }

    // Drag to reorder (mouse; touch uses the long-press menu, because
    // a finger dragging across a phone Dock scrolls it).
    var dragging = null, sx = 0, startIdx = -1;
    bar.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      var b = e.target.closest(".ld-dk");
      if (!b) return;
      dragging = null;
      sx = e.clientX;
      var onMove = function (ev) {
        if (!dragging) {
          if (Math.abs(ev.clientX - sx) < 6) return;
          dragging = b;
          startIdx = Array.prototype.indexOf.call(bar.children, b);
          b.classList.add("drag");
          unmagnify();
        }
        var bs = Array.prototype.filter.call(bar.children, function (x) { return x !== dragging; });
        var before = null;
        for (var i = 0; i < bs.length; i++) {
          var r = bs[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) { before = bs[i]; break; }
        }
        if (before !== dragging.nextSibling) bar.insertBefore(dragging, before);
      };
      var onUp = function () {
        doc.removeEventListener("pointermove", onMove, true);
        doc.removeEventListener("pointerup", onUp, true);
        if (!dragging) return;
        var d = dragging;
        dragging = null;
        d.classList.remove("drag");
        d.__ldDragged = true;
        setTimeout(function () { d.__ldDragged = false; }, 0);
        var idx = Array.prototype.indexOf.call(bar.children, d);
        if (idx !== startIdx) change(moveTo(load(), d.getAttribute("data-app"), "dock", idx, Date.now()));
        focusIcon(d.getAttribute("data-app"), "dock");
      };
      doc.addEventListener("pointermove", onMove, true);
      doc.addEventListener("pointerup", onUp, true);
    });
  }

  function paint() {
    if (!host) return;
    paintDesktop();
    paintDock();
    paintStars();
  }

  // ---------- 12. Public API ----------
  // host = { apps(), open(app), running(), label(app), icons, lang(), desktop }
  function attach(h) {
    if (host) return;
    host = h || {};
    injectCss();
    load();
    registerSync();
    // The open app's dot in the Dock, and hiding the Dock behind a
    // running app (CSS) — both follow #oros-running.
    var run = doc.getElementById("oros-running");
    if (run && root.MutationObserver) {
      new root.MutationObserver(function () { paintDock(); }).observe(run, { attributes: true, attributeFilter: ["class"] });
    }
  }

  // For the Settings app: read and write the Dock settings without the
  // menu section. `over` comes resolved (never chosen = off).
  function publicPrefs() {
    var p = prefs();
    return { on: p.on, size: p.size, magnify: p.magnify, autohide: p.autohide,
             over: overApps(p), style: p.style, styles: STYLES.slice(),
             fine: finePointer(), pinned: shown("dock").length };
  }
  var PREF_OK = {
    on: function (v) { return typeof v === "boolean"; },
    size: function (v) { return Object.prototype.hasOwnProperty.call(SIZES, v); },
    magnify: function (v) { return typeof v === "boolean"; },
    autohide: function (v) { return typeof v === "boolean"; },
    over: function (v) { return typeof v === "boolean" || v === null; },
    style: function (v) { return STYLES.indexOf(v) >= 0; }
  };
  function setPref(k, v) {
    if (!Object.prototype.hasOwnProperty.call(PREF_OK, k) || !PREF_OK[k](v)) return false;
    var q = prefs(); q[k] = v; savePrefs(q); repaintSettings();
    return true;
  }

  root.orosLauncher = {
    VER: VER,
    model: model,
    attach: attach,
    refresh: paint,
    menuRow: menuRow,
    renderSettings: renderSettings,
    prefs: publicPrefs,
    setPref: setPref
  };
})(typeof window !== "undefined" ? window : globalThis);
