// ============================================================
// orOS — launcher.js (favourites: desktop shortcuts, v1.0.0)
// ------------------------------------------------------------
// A shell component, like pet.js: it runs IN the shell document,
// keeps its own storage and registers its own sync slice. shell.js
// only calls attach() once at boot, refresh() after every menu
// render, and menuRow() for each app row of the menu. A bundle
// without this file draws exactly what it drew before.
//
//   • The menu: a star at the end of every app row opens a small
//     panel with the switch "On the desktop". The star is filled
//     while the app has a shortcut anywhere.
//   • The desktop: shortcuts in an automatic grid, in the order they
//     were added. Tap opens; right-click or a long press opens a
//     small menu (Open · Move earlier · Move later · Remove).
//
// Data (synced, slice "launcher", key oros-launcher-data):
//   { ver:1, items:[{ id, desk, dock, mtime }] }
//   • id    = the app id from apps.json;
//   • desk  = order key on the desktop, or null (not there);
//   • dock  = order key in the Dock, or null (reserved for the Dock);
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

  var VER = "1.0.0";
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

  var model = { normalize: normalize, merge: merge, list: list, isPinned: isPinned, pin: pin, move: move, VER: VER, DATA_KEY: DATA_KEY };

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

  // ---------- 3. Strings (EN / EL) ----------
  var STR = {
    en: {
      star: "Shortcuts", desk: "On the desktop", open: "Open",
      earlier: "Move earlier", later: "Move later", remove: "Remove from desktop",
      deskLabel: "Desktop shortcuts", more: "Options"
    },
    el: {
      star: "Συντομεύσεις", desk: "Στην επιφάνεια εργασίας", open: "Άνοιγμα",
      earlier: "Μετακίνηση νωρίτερα", later: "Μετακίνηση αργότερα", remove: "Αφαίρεση από την επιφάνεια εργασίας",
      deskLabel: "Συντομεύσεις επιφάνειας εργασίας", more: "Επιλογές"
    }
  };
  function tr(k) {
    var lang = (host && host.lang && host.lang() === "el") ? "el" : "en";
    return STR[lang][k] || STR.en[k] || k;
  }

  // ---------- 4. Styles (injected once; skin variables only) ----------
  var CSS = [
    ".ld-row{display:flex;align-items:center;gap:2px;position:relative}",
    ".ld-row>.menu-item{flex:1;min-width:0}",
    ".ld-star{flex:0 0 auto;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;",
    "background:transparent;border:none;border-radius:7px;color:var(--text-dim);cursor:pointer;padding:0}",
    ".ld-star:hover,.ld-star:focus-visible{background:var(--accent-soft);color:var(--accent)}",
    ".ld-star.on{color:var(--accent)}",
    ".ld-star svg{width:18px;height:18px}",
    ".ld-pop{margin:0 4px 6px 32px;padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}",
    ".ld-sw{display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px;color:var(--text);cursor:pointer}",
    ".ld-sw input{width:18px;height:18px;accent-color:var(--accent);margin:0}",
    ".ld-note{font-size:12px;color:var(--text-dim);padding:0 0 8px 28px}",
    ".ld-note button{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;padding:0;text-decoration:underline}",
    "#ld-desk{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px 4px;",
    "padding:14px 10px 150px;max-width:960px;align-content:start}",
    "@media (min-width:600px){#ld-desk{grid-template-columns:repeat(auto-fill,96px);padding:20px 20px 150px}}",
    ".ld-ic{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 2px;min-height:44px;",
    "background:transparent;border:1px solid transparent;border-radius:10px;color:var(--text);cursor:pointer;",
    "-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}",
    ".ld-ic:hover,.ld-ic:focus-visible{background:var(--accent-soft);border-color:var(--border)}",
    ".ld-tile{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;",
    "background:var(--panel-bg);color:var(--accent);border:1px solid var(--border);box-shadow:0 2px 8px var(--shadow)}",
    ".ld-tile svg{width:28px;height:28px}",
    ".ld-name{font-size:12px;line-height:1.25;text-align:center;max-width:100%;overflow:hidden;display:-webkit-box;",
    "-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;padding:1px 5px;border-radius:6px;",
    "background:color-mix(in srgb,var(--panel-bg) 72%,transparent)}",
    ".ld-menu{position:fixed;z-index:1100;min-width:200px;max-width:calc(100vw - 16px);padding:4px;",
    "background:var(--panel-bg);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px var(--shadow)}",
    ".ld-menu button{display:block;width:100%;min-height:44px;padding:8px 12px;text-align:left;background:transparent;",
    "border:none;border-radius:7px;color:var(--text);font-size:14px;cursor:pointer}",
    ".ld-menu button:hover,.ld-menu button:focus-visible{background:var(--accent-soft)}",
    ".ld-menu button:disabled{opacity:.45;cursor:default;background:transparent}",
    ".ld-menu .ld-danger{color:var(--danger)}"
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

  // ---------- 5. Helpers ----------
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

  // ---------- 6. Menu: the star and its panel ----------
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
    var sw = doc.createElement("label");
    sw.className = "ld-sw";
    var cb = doc.createElement("input");
    cb.type = "checkbox";
    cb.checked = isPinned(load(), app.id, "desk");
    cb.addEventListener("change", function () {
      change(pin(load(), app.id, "desk", cb.checked, Date.now()));
      paintStar(star, app.id);
    });
    sw.appendChild(cb);
    var tx = doc.createElement("span");
    tx.textContent = tr("desk");
    sw.appendChild(tx);
    pop.appendChild(sw);
    return pop;
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

  // ---------- 7. Desktop shortcuts ----------
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

  function openCtx(id, anchor, x, y) {
    closeCtx(false);
    var app = appById(id);
    if (!app) return;
    var ids = list(load(), "desk");
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
    item("open", function () { host.open(app); });
    item("earlier", function () { change(move(load(), id, "desk", -1, Date.now())); focusIcon(id); }, i <= 0);
    item("later", function () { change(move(load(), id, "desk", 1, Date.now())); focusIcon(id); }, i === -1 || i >= ids.length - 1);
    item("remove", function () { change(pin(load(), id, "desk", false, Date.now())); }, false, "ld-danger");
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
    m.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
    ctx = { el: m, back: anchor };
    doc.addEventListener("pointerdown", ctxOutside, true);
    var first = m.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function focusIcon(id) {
    var el = doc.querySelector('#ld-desk [data-app="' + id + '"]');
    if (el) el.focus();
  }

  // Long press on touch (500 ms; moving more than 10 px cancels; the
  // click that follows is swallowed). Mouse: the contextmenu event.
  function wireIcon(b, id) {
    var timer = null, sx = 0, sy = 0, fired = 0;
    b.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fired = Date.now();
        openCtx(id, b, sx, sy);
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
      openCtx(id, b, kb ? r.left : e.clientX, kb ? r.bottom : e.clientY);
    });
    b.addEventListener("click", function (e) {
      if (Date.now() - fired < 1000) { e.preventDefault(); return; }
      var app = appById(id);
      if (app) host.open(app);
    });
  }

  function paintDesktop() {
    var desk = host && host.desktop;
    if (!desk) return;
    var grid = doc.getElementById("ld-desk");
    var ids = list(load(), "desk").filter(function (id) { return !!appById(id); });
    if (!ids.length) { if (grid) grid.remove(); return; }
    var focusId = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest("#ld-desk")
      ? doc.activeElement.getAttribute("data-app") : null;
    if (!grid) {
      grid = doc.createElement("div");
      grid.id = "ld-desk";
      grid.setAttribute("role", "list");
      desk.appendChild(grid);
    }
    grid.setAttribute("aria-label", tr("deskLabel"));
    grid.textContent = "";
    ids.forEach(function (id) {
      var app = appById(id);
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "ld-ic";
      b.setAttribute("role", "listitem");
      b.setAttribute("data-app", id);
      b.title = labelOf(app);
      var tile = doc.createElement("span");
      tile.className = "ld-tile";
      tile.innerHTML = iconOf(app);          // static shell icon, not data
      b.appendChild(tile);
      var nm = doc.createElement("span");
      nm.className = "ld-name";
      nm.textContent = labelOf(app);
      b.appendChild(nm);
      wireIcon(b, id);
      grid.appendChild(b);
    });
    if (focusId) focusIcon(focusId);
  }

  function paintStars() {
    var stars = doc.querySelectorAll(".ld-row-wrap");
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i].querySelector(".ld-star");
      var id = s && s.getAttribute("aria-controls");
      if (id) paintStar(s, id.slice(7));
      var cb = stars[i].querySelector(".ld-pop input");
      if (cb && id) cb.checked = isPinned(load(), id.slice(7), "desk");
    }
  }

  function paint() {
    if (!host) return;
    paintDesktop();
    paintStars();
  }

  // ---------- 8. Public API ----------
  // host = { apps(), open(app), label(app), icons, lang(), desktop }
  function attach(h) {
    if (host) return;
    host = h || {};
    injectCss();
    load();
    registerSync();
  }

  root.orosLauncher = {
    VER: VER,
    model: model,
    attach: attach,
    refresh: paint,
    menuRow: menuRow
  };
})(typeof window !== "undefined" ? window : globalThis);
