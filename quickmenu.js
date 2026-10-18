// ============================================================
// orOS — quickmenu.js (desktop menu: Assistant tasks + apps, mini Assistant, selected text, v1.2.0)
// ------------------------------------------------------------
// A shell component, like launcher.js: it runs IN the shell document,
// keeps its own storage and registers its own sync slice. shell.js
// only calls attach() once at boot. A bundle without this file draws
// exactly what it drew before.
//
//   • Right-click (or a long press, or the context-menu key) on an
//     empty spot of the desktop opens a small menu: "Ask the
//     Assistant…", the user's tasks, the user's apps, the items other
//     desktop components add (Sticky Notes: window.__orosDeskItems),
//     "Change wallpaper…" and "Edit this menu…".
//   • A task is a text for the Assistant. Tapping it opens the
//     Assistant (the mini window) with the text in the message box (deep link { ask });
//     nothing is sent unless the task says "Send on tap" ({ ask,
//     send: 1 }), and then the Assistant's own consent rules
//     (Ask first / never per app) still apply. {date} becomes today's
//     date, {clipboard} the copied text (read on the tap).
//   • An app item opens that app. "Briefing" opens the Assistant's
//     one-tap briefing ({ brief: 1 }), as Today's button does.
//   • The editor (a dialog in the shell) adds, edits, orders and
//     removes items; the Assistant's settings open it too
//     (window.orosQuick.edit()).
//   • 1.1.0: the mini window. The menu's Assistant items open the
//     Assistant in a small panel (assistant/index.html?mini=1) over
//     the desktop or an app, also with Ctrl+Alt+Shift+Q
//     (orosQuick.mini()); "Open in the Assistant" goes on in the full
//     app. When the full Assistant is already open, it gets them.
//   • 1.2.0: selected text in any app. A right-click on selected text
//     (Shift+right-click keeps the browser's menu), or the small
//     Assistant button that shows under text selected by touch or in a
//     text field, opens a menu: Copy, Explain, Summarize, Translate,
//     Fix spelling and grammar, Ask about it…, and the user's tasks
//     with {selection}. Each puts its text in the Assistant's box
//     (nothing is sent, unless a task says "Send on tap").
//     Ctrl+Alt+Shift+Q with text selected opens the same menu. Apps
//     that set window.__orosNoSelAsk (Writer: its own Ask button), the
//     Assistant, Passwords and password fields are left alone. A right-
//     click the app takes for itself (preventDefault) stays the app's.
//
// Data (synced, slice "quickmenu", key oros-quick-menu):
//   { ver:1, items:[{ id, k, n, p, app, send, o, d, m }] }
//   • k    = "ask" | "app" | "brief";
//   • n    = name ("" on an example = its translated name);
//   • p    = the text for the Assistant (k "ask");
//   • app  = the app id (k "app");
//   • send = 1: send on tap (k "ask");
//   • o    = order key (fractional: moving rewrites one item);
//   • d    = 1: removed (the item is its own tombstone);
//   • m    = ms of the last change to THIS item.
//   Three examples (d-brief, d-today, d-week) exist without being
//   stored; a stored item with the same id replaces one. A fresh
//   device stores nothing until the first real change.
// Merge: union by id; per id the higher m wins, a tie goes to the
//   greater canonical JSON. Items sorted by id, fixed field order.
// Pure logic is unit-tested in node (tests/quickmenu.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var DATA_KEY = "oros-quick-menu";
  var MAX_ITEMS = 200;          // stored, tombstones included
  var MAX_SHOWN = 24;           // in the menu
  var MAX_NAME = 60, MAX_TEXT = 2000;
  var MAX_SEL = 8000;           // selected text taken into a question
  var MAX_ASK = 12000;          // a whole question (the Assistant takes 20000)
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  var KINDS = ["ask", "app", "brief"];
  var EXAMPLES = [
    { id: "d-brief", k: "brief", n: "", p: "", app: "", send: 0, o: 1, d: 0, m: 0 },
    { id: "d-today", k: "ask", n: "", p: "", app: "", send: 0, o: 2, d: 0, m: 0 },
    { id: "d-week", k: "ask", n: "", p: "", app: "", send: 0, o: 3, d: 0, m: 0 }
  ];

  // ---------- 1. Model (pure) ----------
  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, max) : "";
  }
  function isExample(id) {
    for (var i = 0; i < EXAMPLES.length; i++) if (EXAMPLES[i].id === id) return EXAMPLES[i];
    return null;
  }

  function cleanItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    if (KINDS.indexOf(it.k) === -1) return null;
    var m = (typeof it.m === "number" && isFinite(it.m) && it.m >= 0) ? Math.floor(it.m) : 0;
    var o = (typeof it.o === "number" && isFinite(it.o)) ? it.o : 0;
    if (it.d) return { id: it.id, k: it.k, n: "", p: "", app: "", send: 0, o: o, d: 1, m: m };
    var app = it.k === "app" && typeof it.app === "string" && ID_RE.test(it.app) ? it.app : "";
    if (it.k === "app" && !app) return null;
    return {
      id: it.id, k: it.k,
      n: str(it.n, MAX_NAME).trim(),
      p: it.k === "ask" ? str(it.p, MAX_TEXT).replace(/^\s+|\s+$/g, "") : "",
      app: app,
      send: it.k === "ask" && it.send ? 1 : 0,
      o: o, d: 0, m: m
    };
  }

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
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
    if (ids.length > MAX_ITEMS) {
      ids = ids.sort(function (a, b) { return byId[b].m - byId[a].m || (a < b ? -1 : 1); }).slice(0, MAX_ITEMS).sort();
    }
    return { ver: 1, items: ids.map(function (id) { return byId[id]; }) };
  }

  function merge(a, b) {
    return normalize({ items: normalize(a).items.concat(normalize(b).items) });
  }

  function find(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }

  // Every item in its shown order: stored ones plus the examples not
  // stored, removed ones left out (order key, then id).
  function list(data) {
    var d = normalize(data);
    var all = d.items.slice();
    EXAMPLES.forEach(function (ex) { if (!find(d, ex.id)) all.push(ex); });
    return all.filter(function (it) { return !it.d; })
      .sort(function (a, b) { return (a.o - b.o) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); })
      .map(function (it) { return { id: it.id, k: it.k, n: it.n, p: it.p, app: it.app, send: it.send, o: it.o, d: 0, m: it.m }; });
  }

  // Add or change one item (a NEW normalized object is returned). A new
  // item goes to the end. Returns the data unchanged when nothing changes.
  function put(data, item, now) {
    var d = normalize(data);
    if (!item || typeof item.id !== "string") return d;
    var shown = list(d), cur = null;
    for (var i = 0; i < shown.length; i++) if (shown[i].id === item.id) cur = shown[i];
    var o = cur ? cur.o : shown.reduce(function (mx, it) { return Math.max(mx, Math.floor(it.o)); }, 0) + 1;
    var stored = find(d, item.id);
    var next = cleanItem({ id: item.id, k: item.k, n: item.n, p: item.p, app: item.app, send: item.send, o: o, d: 0,
                           m: Math.max(now, stored ? stored.m + 1 : 0) });
    if (!next) return d;
    if (cur && JSON.stringify(Object.assign({}, cur, { m: 0 })) === JSON.stringify(Object.assign({}, next, { m: 0 }))) return d;
    return normalize({ items: d.items.filter(function (x) { return x.id !== item.id; }).concat([next]) });
  }

  function remove(data, id, now) {
    var d = normalize(data);
    var shown = list(d), cur = null;
    for (var i = 0; i < shown.length; i++) if (shown[i].id === id) cur = shown[i];
    if (!cur) return d;
    var stored = find(d, id);
    var tomb = { id: id, k: cur.k, n: "", p: "", app: "", send: 0, o: cur.o, d: 1, m: Math.max(now, stored ? stored.m + 1 : 0) };
    return normalize({ items: d.items.filter(function (x) { return x.id !== id; }).concat([tomb]) });
  }

  function withOrder(d, it, o, now) {
    var stored = find(d, it.id);
    var next = { id: it.id, k: it.k, n: it.n, p: it.p, app: it.app, send: it.send, o: o, d: 0,
                 m: Math.max(now, stored ? stored.m + 1 : 0) };
    return normalize({ items: d.items.filter(function (x) { return x.id !== it.id; }).concat([next]) });
  }

  // dir -1 = earlier, +1 = later. Only the moved item changes, unless
  // the keys have become too close to split: then every shown item is
  // renumbered 1..n (rare).
  function move(data, id, dir, now) {
    var d = normalize(data);
    var shown = list(d);
    var i = -1;
    for (var k = 0; k < shown.length; k++) if (shown[k].id === id) i = k;
    var j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= shown.length) return d;
    var lo, hi;
    if (dir < 0) { hi = shown[j].o; lo = j - 1 >= 0 ? shown[j - 1].o : hi - 2; }
    else { lo = shown[j].o; hi = j + 1 < shown.length ? shown[j + 1].o : lo + 2; }
    var mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi) || hi - lo < 1e-6) {
      var it = shown.splice(i, 1)[0];
      shown.splice(j, 0, it);
      shown.forEach(function (x, n) { d = withOrder(d, x, n + 1, now); });
      return d;
    }
    return withOrder(d, shown[i], mid, now);
  }

  // The examples come back as they were; the user's own items stay.
  function reset(data, now) {
    var d = normalize(data);
    var items = d.items.filter(function (x) { return !isExample(x.id); });
    EXAMPLES.forEach(function (ex) {
      var stored = find(d, ex.id);
      if (!stored) return;                       // never stored: already the example
      items.push(Object.assign({}, ex, { m: Math.max(now, stored.m + 1) }));
    });
    return normalize({ items: items });
  }

  // {date}, {clipboard} and {selection} in a task's text.
  function expand(text, ctx) {
    ctx = ctx || {};
    return String(text || "").replace(/\{(date|clipboard|selection)\}/g, function (all, k) {
      var v = k === "date" ? ctx.date : k === "clipboard" ? ctx.clip : ctx.sel;
      return typeof v === "string" ? v : "";
    }).slice(0, MAX_ASK);
  }
  function needsClip(text) { return /\{clipboard\}/.test(String(text || "")); }
  // A task with {selection} belongs to the menu of selected text only.
  function needsSel(text) { return /\{selection\}/.test(String(text || "")); }
  // Selected text as it goes into a question: control characters out,
  // outer blank lines trimmed, at most MAX_SEL characters.
  function cleanSel(text) {
    var t = String(text || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
      .replace(/^\s+|\s+$/g, "");
    return { text: t.slice(0, MAX_SEL), cut: t.length > MAX_SEL };
  }

  function newId(now, rnd) {
    return "q" + Math.floor(now).toString(36) + Math.floor((rnd === undefined ? Math.random() : rnd) * 1e6).toString(36);
  }

  var model = { normalize: normalize, merge: merge, list: list, put: put, remove: remove, move: move, reset: reset,
                expand: expand, needsClip: needsClip, needsSel: needsSel, cleanSel: cleanSel, newId: newId,
                EXAMPLES: EXAMPLES, VER: VER, DATA_KEY: DATA_KEY,
                MAX_SHOWN: MAX_SHOWN, MAX_NAME: MAX_NAME, MAX_TEXT: MAX_TEXT, MAX_SEL: MAX_SEL, MAX_ASK: MAX_ASK };

  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (!root || !root.document) return;

  // ---------- 2. Storage + sync ----------
  var doc = root.document;
  var host = null;
  var cache = null;

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = root.localStorage.getItem(DATA_KEY); } catch (e) {}
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) { try { root.localStorage.setItem(DATA_KEY + "-broken", raw); } catch (e2) {} }
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
    repaintEditor();
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
    repaintEditor();
  }
  function registerSync() {
    var api = root.orosSync;
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("quickmenu", sliceGet, sliceSet, DATA_KEY, merge);
  }

  // ---------- 3. Helpers ----------
  function tr(k, vars) {
    var f = root.t, v = typeof f === "function" ? f("qm." + k) : "";
    v = v && v !== "qm." + k ? v : k;
    if (vars) Object.keys(vars).forEach(function (n) { v = v.split("{" + n + "}").join(vars[n]); });
    return v;
  }
  function apps() { return (host && host.apps && host.apps()) || []; }
  function appById(id) {
    var a = apps();
    for (var i = 0; i < a.length; i++) if (a[i].id === id && a[i].type !== "external") return a[i];
    return null;
  }
  function labelOf(app) { return host && host.label ? host.label(app) : app.name; }
  function hasAssistant() { return !!appById("assistant"); }
  function nameOf(it) {
    if (it.n) return it.n;
    if (it.k === "app") { var a = appById(it.app); return a ? labelOf(a) : it.app; }
    if (isExample(it.id)) return tr("ex." + it.id);
    return it.k === "brief" ? tr("kBrief") : tr("untitled");
  }
  function textOf(it) {
    if (it.p) return it.p;
    return isExample(it.id) && it.k === "ask" ? tr("exp." + it.id) : "";
  }
  // Items that can run on this device (an app not installed, or the
  // Assistant missing, hides them; nothing is removed).
  function usable(it) {
    if (it.k === "app") return !!appById(it.app);
    return hasAssistant();
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function today() {
    var lang = (host && host.lang && host.lang()) || "en";
    try { return new Date().toLocaleDateString(lang, { weekday: "long", year: "numeric", month: "long", day: "numeric" }); }
    catch (e) { return new Date().toDateString(); }
  }
  function toast(msg) {
    if (host && typeof host.toast === "function") host.toast(msg);
  }

  // ---------- 4. Running an item ----------
  function openAt(appId, target) {
    if (typeof root.__orosOpenAt === "function") root.__orosOpenAt(appId, target);
  }
  // The desktop menu's Assistant runs open in the mini window; the
  // full app takes them when it is already open (never two at once).
  function ask(target) {
    if (assistantOpen()) { openAt("assistant", target); return; }
    mini(target);
  }
  function runItem(it, sel) {
    if (it.k === "app") { var a = appById(it.app); if (a && host.open) host.open(a); return; }
    if (!hasAssistant()) return;
    if (it.k === "brief") { ask({ brief: 1 }); return; }
    var text = textOf(it);
    var ctx = { date: today(), sel: sel || "" };
    function go(clipOk) {
      var q = expand(text, ctx).trim();
      if (!q) { ask(null); return; }
      var tg = { ask: q };
      if (it.send && clipOk) tg.send = 1;     // an unread clipboard waits in the box
      ask(tg);
    }
    if (!needsClip(text)) { go(true); return; }
    var cb = root.navigator && root.navigator.clipboard;
    if (!cb || typeof cb.readText !== "function") { ctx.clip = ""; toast(tr("clipFail")); go(false); return; }
    cb.readText().then(function (s) { ctx.clip = str(s, MAX_TEXT); go(!!ctx.clip); },
                       function () { ctx.clip = ""; toast(tr("clipFail")); go(false); });
  }

  // ---------- 5. Styles (injected once; skin variables only) ----------
  var CSS = [
    ".qm-menu{position:fixed;z-index:1100;min-width:220px;max-width:min(320px,calc(100vw - 16px));max-height:calc(100vh - 16px);",
    "overflow:auto;padding:4px;background:var(--panel-bg);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px var(--shadow)}",
    ".qm-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 12px;text-align:left;background:transparent;",
    "border:none;border-radius:7px;color:var(--text);font-size:14px;cursor:pointer}",
    ".qm-menu button:hover,.qm-menu button:focus-visible{background:var(--accent-soft)}",
    ".qm-menu .qm-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".qm-menu .qm-ic{flex:0 0 18px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:var(--accent)}",
    ".qm-menu .qm-ic svg{width:18px;height:18px}",
    ".qm-menu .qm-send{font-size:11px;color:var(--text-dim)}",
    ".qm-menu .qm-sep{height:1px;margin:4px 8px;background:var(--border)}",
    "#qm-dlg{width:min(520px,calc(100vw - 16px));max-height:calc(100vh - 32px);padding:0;border:1px solid var(--border);border-radius:12px;",
    "background:var(--panel-bg);color:var(--text);box-shadow:0 12px 40px var(--shadow)}",
    "#qm-dlg::backdrop{background:rgba(0,0,0,.45)}",
    "#qm-dlg .qm-body{padding:16px;display:flex;flex-direction:column;gap:12px}",
    "#qm-dlg h2{margin:0;font-size:17px}",
    "#qm-dlg .qm-hint{margin:0;font-size:13px;color:var(--text-dim);line-height:1.45}",
    "#qm-dlg .qm-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}",
    "#qm-dlg .qm-row{display:flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;border:1px solid var(--border);border-radius:8px}",
    "#qm-dlg .qm-row .qm-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}",
    "#qm-dlg .qm-row .qm-kind{flex:0 0 auto;font-size:11px;color:var(--text-dim);margin-right:4px}",
    "#qm-dlg .qm-row.qm-off .qm-name{opacity:.55}",
    "#qm-dlg .qm-iconbtn{flex:0 0 auto;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;",
    "border:none;border-radius:7px;background:transparent;color:var(--text);cursor:pointer;font-size:16px}",
    "#qm-dlg .qm-iconbtn:hover,#qm-dlg .qm-iconbtn:focus-visible{background:var(--accent-soft)}",
    "#qm-dlg .qm-iconbtn:disabled{opacity:.35;cursor:default;background:transparent}",
    "#qm-dlg .qm-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}",
    "#qm-dlg .qm-actions .qm-left{margin-right:auto}",
    "#qm-dlg .qm-btn{min-height:40px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:transparent;",
    "color:var(--text);font-size:14px;cursor:pointer}",
    "#qm-dlg .qm-btn.qm-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text,#fff)}",
    "#qm-dlg label.qm-field{display:flex;flex-direction:column;gap:4px;font-size:13px}",
    "#qm-dlg input[type=text],#qm-dlg textarea,#qm-dlg select{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--border);",
    "border-radius:8px;background:var(--input-bg,var(--panel-bg));color:var(--text);width:100%;box-sizing:border-box}",
    "#qm-dlg textarea{min-height:110px;resize:vertical}",
    "#qm-dlg .qm-check{display:flex;align-items:center;gap:10px;min-height:40px;font-size:14px;cursor:pointer}",
    "#qm-dlg .qm-check input{width:18px;height:18px;accent-color:var(--accent);margin:0}",
    // the mini window (z 960: over a running app at 900 and the Dock at 950, under the menu at 999)
    "#qa-mini{position:fixed;z-index:960;right:16px;bottom:calc(16px + var(--tb-h,0px) + env(safe-area-inset-bottom,0px));",
    "width:min(420px,calc(100vw - 32px));height:min(620px,calc(100vh - 88px));display:flex;flex-direction:column;overflow:hidden;",
    "background:var(--panel-bg);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 40px var(--shadow)}",
    "#qa-mini .qa-head{flex:0 0 auto;display:flex;align-items:center;gap:2px;padding:4px 4px 4px 14px;border-bottom:1px solid var(--border)}",
    "#qa-mini .qa-title{flex:1;min-width:0;font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#qa-mini .qa-btn{flex:0 0 auto;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border:none;",
    "border-radius:8px;background:transparent;color:var(--text);cursor:pointer}",
    "#qa-mini .qa-btn:hover,#qa-mini .qa-btn:focus-visible{background:var(--accent-soft)}",
    "#qa-mini .qa-btn svg{width:18px;height:18px}",
    "#qa-mini iframe{flex:1 1 auto;width:100%;min-height:0;border:0;background:transparent}",
    // the button under selected text (over apps and the mini window, under the menu)
    ".qm-chip{position:fixed;z-index:970;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 14px;",
    "border:1px solid var(--border);border-radius:20px;background:var(--panel-bg);color:var(--text);font-size:13px;",
    "box-shadow:0 4px 16px var(--shadow);cursor:pointer}",
    ".qm-chip .qm-ic{display:inline-flex;color:var(--accent)}",
    ".qm-chip svg{width:16px;height:16px}",
    "@media (max-width:600px){#qa-mini{left:8px;right:8px;width:auto;bottom:calc(8px + env(safe-area-inset-bottom,0px));",
    "height:calc(100% - 64px - env(safe-area-inset-top,0px))}}"
  ].join("");
  function injectCss() {
    if (doc.getElementById("qm-css")) return;
    var s = doc.createElement("style");
    s.id = "qm-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  // Static shell icons (never data).
  var IC_ASK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/><path d="M18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z"/></svg>';
  var IC_TASK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var IC_WALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
  var IC_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  function appIcon(app) {
    var icons = (host && host.icons) || {};
    return Object.prototype.hasOwnProperty.call(icons, app.icon) ? icons[app.icon] : "";
  }

  // ---------- 6. The desktop menu ----------
  var menu = null;
  function closeMenu(refocus) {
    if (!menu) return;
    var back = menu.back;
    menu.el.remove();
    menu = null;
    doc.removeEventListener("pointerdown", outside, true);
    if (refocus && back && back.isConnected && back.focus) back.focus();
  }
  function outside(e) { if (menu && !menu.el.contains(e.target)) closeMenu(false); }

  // One menu at a time. fill(item, sep) adds the entries; item(label,
  // icon, fn, extra) and sep() between groups (no empty groups).
  function showMenu(x, y, kb, label, fill, at) {
    closeMenu(false);
    var m = el("div", "qm-menu");
    m.setAttribute("role", "menu");
    m.setAttribute("aria-label", label);
    var inGroup = 0;
    function sep() { if (inGroup) { var s = el("div", "qm-sep"); s.setAttribute("role", "separator"); m.appendChild(s); } inGroup = 0; }
    function item(text, icon, fn, extra) {
      var b = el("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      var ic = el("span", "qm-ic");
      ic.innerHTML = icon || "";               // static shell icon, not data
      b.appendChild(ic);
      b.appendChild(el("span", "qm-lbl", text));
      if (extra) b.appendChild(el("span", "qm-send", extra));
      b.title = text;
      b.addEventListener("click", function () { closeMenu(false); fn(); });
      m.appendChild(b);
      inGroup++;
    }
    fill(item, sep);
    var last = m.lastChild;
    if (last && last.className === "qm-sep") last.remove();
    m.addEventListener("keydown", function (e) {
      var bs = Array.prototype.slice.call(m.querySelectorAll("button"));
      var k = bs.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(k + 1) % bs.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(k - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); bs[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); bs[bs.length - 1].focus(); }
      else if (e.key === "Tab") { closeMenu(false); }
    });
    doc.body.appendChild(m);
    var r = m.getBoundingClientRect(), vw = root.innerWidth, vh = root.innerHeight;
    if (kb && !at) { x = (vw - r.width) / 2; y = Math.max(56, (vh - r.height) / 3); }
    m.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
    menu = { el: m, back: doc.activeElement };
    doc.addEventListener("pointerdown", outside, true);
    var first = m.querySelector("button");
    if (first) first.focus();
  }

  function openMenu(x, y, kb) {
    showMenu(x, y, kb, tr("title"), function (item, sep) {
      var items = list(load()).filter(usable).filter(function (it) { return !needsSel(textOf(it)); }).slice(0, MAX_SHOWN);
      if (hasAssistant()) item(tr("ask"), IC_ASK, function () { ask(null); });
      items.filter(function (it) { return it.k !== "app"; }).forEach(function (it) {
        item(nameOf(it), it.k === "brief" ? IC_ASK : IC_TASK, function () { runItem(it); }, it.send ? tr("sendMark") : "");
      });
      sep();
      items.filter(function (it) { return it.k === "app"; }).forEach(function (it) {
        var a = appById(it.app);
        item(nameOf(it), a ? appIcon(a) : "", function () { runItem(it); });
      });
      // Items other desktop components add (Sticky Notes).
      sep();
      (root.__orosDeskItems || []).forEach(function (fn) {
        var add = [];
        try { add = fn(x, y) || []; } catch (e) { add = []; }
        add.forEach(function (a) {
          if (a && typeof a.label === "string" && typeof a.run === "function") item(a.label, a.icon || "", a.run);
        });
      });
      sep();
      item(tr("wall"), IC_WALL, function () { openAt("settings", { section: "appearance" }); });
      item(tr("edit"), IC_EDIT, function () { edit(); });
    });
  }

  // An empty spot of the desktop: not an icon, a note, the pet, a field…
  var SKIP = ".ld-ic, #ld-dock, .sn-note, .sn-card, .sn-addcard, #sn-add, #pet-layer, #pet-hud, " +
             "input, textarea, select, button, a, [contenteditable], .qm-menu";
  function emptySpot(t) {
    if (!t || !t.closest || !host || !host.desktop) return false;
    if (!host.desktop.contains(t)) return false;
    if (host.running && host.running()) return false;
    return !t.closest(SKIP);
  }

  var fired = 0;
  function wireDesktop() {
    var desk = host.desktop;
    doc.addEventListener("contextmenu", function (e) {
      if (e.defaultPrevented || !emptySpot(e.target)) return;
      e.preventDefault();
      if (fired && Date.now() - fired < 1500) return;      // the long press already opened it
      var kb = !e.clientX && !e.clientY;           // context-menu key
      openMenu(e.clientX, e.clientY, kb);
    });
    // Long press on touch (550 ms; moving more than 10 px cancels).
    var timer = null, sx = 0, sy = 0;
    desk.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" || !emptySpot(e.target)) return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fired = Date.now();
        held = true;
        openMenu(sx, sy, false);
      }, 550);
    });
    desk.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(timer); timer = null; }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
      desk.addEventListener(t, function () { if (timer) { clearTimeout(timer); timer = null; } });
    });
    // The click that ends the long press lands on whatever is under the
    // finger now, often the menu's first item: swallow that one click
    // (it comes right after the finger lifts; a new touch clears it).
    var held = false, swallow = 0;
    doc.addEventListener("pointerup", function () {
      if (held) { held = false; swallow = Date.now() + 600; }
    }, true);
    doc.addEventListener("pointerdown", function () { swallow = 0; }, true);
    doc.addEventListener("click", function (e) {
      if (!swallow || Date.now() > swallow) return;
      swallow = 0;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  // ---------- 7. The editor ----------
  var dlg = null, view = { mode: "list", id: null };

  function kindLabel(it) {
    if (it.k === "ask" && needsSel(textOf(it))) return tr("kSel");
    return it.k === "app" ? tr("kApp") : it.k === "brief" ? tr("kBrief") : tr("kAsk");
  }

  function iconBtn(text, label, fn, disabled) {
    var b = el("button", "qm-iconbtn", text);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.disabled = !!disabled;
    b.addEventListener("click", fn);
    return b;
  }
  function btn(text, cls, fn) {
    var b = el("button", "qm-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function drawList(body) {
    body.appendChild(el("h2", "", tr("title")));
    body.appendChild(el("p", "qm-hint", tr("hint")));
    var shown = list(load());
    var ul = el("ul", "qm-list");
    if (!shown.length) body.appendChild(el("p", "qm-hint", tr("empty")));
    shown.forEach(function (it, i) {
      var li = el("li", "qm-row" + (usable(it) ? "" : " qm-off"));
      li.setAttribute("data-id", it.id);
      li.appendChild(el("span", "qm-name", nameOf(it)));
      li.appendChild(el("span", "qm-kind", kindLabel(it) + (it.send ? " · " + tr("sendMark") : "")));
      li.appendChild(iconBtn("↑", tr("up") + ": " + nameOf(it), function () { change(move(load(), it.id, -1, Date.now())); focusRow(it.id, "up"); }, i === 0));
      li.appendChild(iconBtn("↓", tr("down") + ": " + nameOf(it), function () { change(move(load(), it.id, 1, Date.now())); focusRow(it.id, "down"); }, i === shown.length - 1));
      li.appendChild(iconBtn("✎", tr("editItem") + ": " + nameOf(it), function () { view = { mode: it.k, id: it.id }; repaintEditor(); }));
      li.appendChild(iconBtn("✕", tr("del") + ": " + nameOf(it), function () { change(remove(load(), it.id, Date.now())); }));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    var lab = el("label", "qm-check");
    var chk = el("input");
    chk.type = "checkbox";
    chk.checked = chipOn();
    chk.addEventListener("change", function () { setChipOn(chk.checked); });
    lab.appendChild(chk);
    lab.appendChild(el("span", "", tr("chipOpt")));
    body.appendChild(lab);
    var acts = el("div", "qm-actions");
    var rs = btn(tr("reset"), "qm-left", function () { change(reset(load(), Date.now())); });
    acts.appendChild(rs);
    acts.appendChild(btn(tr("newTask"), "", function () { view = { mode: "ask", id: null }; repaintEditor(); }));
    acts.appendChild(btn(tr("addApp"), "", function () { view = { mode: "app", id: null }; repaintEditor(); }));
    acts.appendChild(btn(tr("close"), "qm-primary", function () { dlg.close(); }));
    body.appendChild(acts);
  }

  function focusRow(id, which) {
    if (!dlg) return;
    var row = dlg.querySelector('.qm-row[data-id="' + id + '"]');
    if (!row) return;
    var bs = row.querySelectorAll(".qm-iconbtn");
    var b = which === "up" ? bs[0] : bs[1];
    if (b && b.disabled) b = which === "up" ? bs[1] : bs[0];
    if (b) b.focus();
  }

  function field(body, label, input) {
    var l = el("label", "qm-field");
    l.appendChild(el("span", "", label));
    l.appendChild(input);
    body.appendChild(l);
    return input;
  }

  function drawForm(body) {
    var cur = null;
    if (view.id) list(load()).forEach(function (it) { if (it.id === view.id) cur = it; });
    var kind = cur ? cur.k : view.mode;
    body.appendChild(el("h2", "", cur ? tr("editItem") : kind === "app" ? tr("addApp") : tr("newTask")));
    var name = el("input");
    name.type = "text";
    name.maxLength = MAX_NAME;
    name.value = cur ? nameOf(cur) : "";
    var text = null, send = null, pick = null;
    if (kind === "app") {
      pick = el("select");
      apps().filter(function (a) { return a.type !== "external"; })
        .map(function (a) { return { id: a.id, name: labelOf(a) }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .forEach(function (a) {
          var o = el("option", "", a.name);
          o.value = a.id;
          pick.appendChild(o);
        });
      if (cur) pick.value = cur.app;
      field(body, tr("app"), pick);
      field(body, tr("name"), name);
      name.placeholder = tr("nameAuto");
      if (cur && !cur.n) name.value = "";
    } else {
      field(body, tr("name"), name);
      if (kind === "ask") {
        text = el("textarea");
        text.maxLength = MAX_TEXT;
        text.value = cur ? textOf(cur) : "";
        field(body, tr("text"), text);
        body.appendChild(el("p", "qm-hint", tr("vars")));
        var lab = el("label", "qm-check");
        send = el("input");
        send.type = "checkbox";
        send.checked = !!(cur && cur.send);
        lab.appendChild(send);
        lab.appendChild(el("span", "", tr("send")));
        body.appendChild(lab);
        body.appendChild(el("p", "qm-hint", tr("sendHint")));
      }
    }
    var err = el("p", "qm-hint");
    err.setAttribute("role", "status");
    body.appendChild(err);
    var acts = el("div", "qm-actions");
    acts.appendChild(btn(tr("cancel"), "", function () { view = { mode: "list", id: null }; repaintEditor(); }));
    acts.appendChild(btn(tr("save"), "qm-primary", function () {
      var it = { id: cur ? cur.id : newId(Date.now()), k: kind, n: name.value.trim(), p: "", app: "", send: 0 };
      if (kind === "app") {
        it.app = pick.value;
        if (!appById(it.app)) return;
      } else if (kind === "ask") {
        it.p = text.value.trim();
        it.send = send.checked ? 1 : 0;
        if (!it.p) { err.textContent = tr("needText"); text.focus(); return; }
        if (!it.n) it.n = it.p.split("\n")[0].slice(0, MAX_NAME).trim();
        // An example keeps following the language until its text is changed.
        if (cur && isExample(cur.id) && it.p === tr("exp." + cur.id)) it.p = "";
      }
      if (cur && isExample(cur.id) && it.n === tr("ex." + cur.id)) it.n = "";
      view = { mode: "list", id: null };
      change(put(load(), it, Date.now()));
      repaintEditor();
    }));
    body.appendChild(acts);
    (pick || name).focus();
  }

  function repaintEditor() {
    if (!dlg || !dlg.open) return;
    var body = dlg.querySelector(".qm-body");
    var act = doc.activeElement, keep = act && dlg.contains(act) && view.mode === "list";
    if (view.mode !== "list" && body.getAttribute("data-form") === "1") return;   // never wipe a form being typed
    body.textContent = "";
    body.setAttribute("data-form", view.mode === "list" ? "0" : "1");
    if (view.mode === "list") drawList(body); else drawForm(body);
    if (keep && !dlg.contains(doc.activeElement)) { var f = body.querySelector("button"); if (f) f.focus(); }
  }

  function edit() {
    closeMenu(false);
    if (!host) return;
    if (!dlg) {
      dlg = el("dialog");
      dlg.id = "qm-dlg";
      dlg.setAttribute("aria-label", tr("title"));
      dlg.appendChild(el("div", "qm-body"));
      dlg.addEventListener("close", function () { view = { mode: "list", id: null }; });
      dlg.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && view.mode !== "list") {
          e.preventDefault();
          view = { mode: "list", id: null };
          dlg.querySelector(".qm-body").setAttribute("data-form", "0");
          repaintEditor();
        }
      });
      doc.body.appendChild(dlg);
    }
    view = { mode: "list", id: null };
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
    dlg.querySelector(".qm-body").setAttribute("data-form", "0");
    repaintEditor();
  }

  // ---------- 8. The mini window (quick access wave 2) ----------
  // The same Assistant (assistant/index.html?mini=1) in a small panel
  // over the desktop or an app: Ctrl+Alt+Shift+Q, or the desktop
  // menu. "Open in the Assistant" closes it and opens the full app on
  // the same conversation (the Assistant keeps the open one in its
  // device prefs). The frame is removed on close, so there is never a
  // second live Assistant; opening the full app closes the panel.
  var panel = null, pending = null;
  var IC_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
  var IC_NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
  var IC_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';

  function assistantOpen() {
    var r = host && host.running && host.running();
    if (r && r.id === "assistant") return true;
    return !!(host && host.isOpen && host.isOpen("assistant"));
  }
  function miniWin() {
    var f = panel && panel.querySelector("iframe");
    try { return f && f.contentWindow; } catch (e) { return null; }
  }
  function miniApi() {
    var w = miniWin();
    try { return w && w.__asMini ? w.__asMini : null; } catch (e) { return null; }
  }
  function headBtn(icon, label, fn) {
    var b = el("button", "qa-btn");
    b.type = "button";
    b.innerHTML = icon;                      // static shell icon, not data
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }
  function mini(target) {
    if (!host || !hasAssistant()) return;
    closeMenu(false);
    if (panel) {
      var api = miniApi(), w = miniWin();
      if (api && w && typeof w.__orosOpenAt === "function") {
        if (target && !w.__orosOpenAt(target) && api.busy()) toast(tr("miniBusy"));
      } else if (target) pending = target;   // still starting: its boot takes it
      try { panel.querySelector("iframe").focus(); } catch (e) {}
      return;
    }
    pending = target || null;
    panel = el("section");
    panel.id = "qa-mini";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", tr("miniTitle"));
    var head = el("div", "qa-head");
    head.appendChild(el("span", "qa-title", tr("miniTitle")));
    head.appendChild(headBtn(IC_NEW, tr("miniNew"), function () { var a = miniApi(); if (a && !a.busy()) a.newChat(); }));
    head.appendChild(headBtn(IC_EXPAND, tr("miniFull"), function () {
      var a = miniApi();
      if (a && a.busy()) { toast(tr("miniBusy")); return; }
      closeMini();
      openAt("assistant", null);
    }));
    head.appendChild(headBtn(IC_X, tr("close"), function () { closeMini(); }));
    panel.appendChild(head);
    var f = el("iframe");
    f.title = tr("miniTitle");
    f.src = "assistant/index.html?mini=1";
    panel.appendChild(f);
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && e.target && e.target.closest && e.target.closest(".qa-head")) { e.preventDefault(); closeMini(); }
    });
    doc.body.appendChild(panel);
    f.addEventListener("load", function () { try { f.focus(); } catch (e) {} });
  }
  function closeMini() {
    if (!panel) return;
    panel.remove();
    panel = null;
    pending = null;
  }
  // The Assistant's boot in the mini frame takes what it should do.
  function takeMini() { var t = pending; pending = null; return t; }
  function watchRunning() {
    var run = doc.getElementById("oros-running");
    if (!run || !root.MutationObserver) return;
    new root.MutationObserver(function () { hideChip(); if (panel && assistantOpen()) closeMini(); })
      .observe(run, { attributes: true, attributeFilter: ["class"], subtree: true });
  }


  // ---------- 9. Selected text in an app (quick access wave 3) ----------
  // Every same-origin frame in the shell (apps, side and hidden frames)
  // is wired on load. Mouse: a right-click on selected text that the
  // app leaves alone (not preventDefault, no Shift, not in a text
  // field, which keeps Cut / Paste) opens the menu. Touch, or text
  // selected in a field: a small button shows under the selection
  // (below the phone's own handles and bar) and opens it. The text is
  // read when the menu opens; nothing leaves before Send.
  var CHIP_KEY = "oros-quick-selchip";      // "0" = no button under selected text (this device)
  var SKIP_APPS = { assistant: 1, passwords: 1 };
  var IC_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
  var SEL_ACTS = ["explain", "sum", "tr", "fix", "ask"];

  function chipOn() { try { return root.localStorage.getItem(CHIP_KEY) !== "0"; } catch (e) { return true; } }
  function setChipOn(on) {
    try { if (on) root.localStorage.removeItem(CHIP_KEY); else root.localStorage.setItem(CHIP_KEY, "0"); } catch (e) {}
    if (!on) hideChip();
  }
  // The app folder of a frame: ".../notes/index.html" → "notes".
  function frameApp(w) {
    var parts = [];
    try { parts = String(w.location.pathname || "").split("/").filter(Boolean); } catch (e) { return ""; }
    if (parts.length && parts[parts.length - 1].indexOf(".") !== -1) parts.pop();
    return parts.length ? parts[parts.length - 1] : "";
  }
  // The frame's window when its text may go to the Assistant, else null.
  function frameOk(f) {
    var w;
    try { w = f.contentWindow; if (!w || !w.document || w.__orosNoSelAsk) return null; } catch (e) { return null; }
    if (f.closest && f.closest("#qa-mini")) return null;
    return SKIP_APPS[frameApp(w)] ? null : w;
  }
  // What is selected in a frame: { text, editable, rect } (rect in the
  // frame's coordinates), or null.
  function selOf(w) {
    var d = w.document, a = d.activeElement, text = "", editable = false, rect = null;
    if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /^(text|search|url|email|tel)?$/i.test(a.getAttribute("type") || "")))) {
      try { text = a.value.slice(a.selectionStart, a.selectionEnd); } catch (e) { text = ""; }
      editable = true;
      rect = a.getBoundingClientRect();
    } else {
      if (a && a.tagName === "INPUT") return null;          // a password or other field
      var sel = w.getSelection && w.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      text = sel.toString();
      var r = sel.getRangeAt(0), rs = r.getClientRects();
      rect = rs.length ? rs[rs.length - 1] : r.getBoundingClientRect();
      var n = sel.focusNode || sel.anchorNode;
      n = n && (n.nodeType === 1 ? n : n.parentElement);
      editable = !!(n && n.isContentEditable);
    }
    if (!text || !/\S/.test(text) || !rect) return null;
    return { text: text, editable: editable, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
  }

  function copyText(text) {
    var cb = root.navigator && root.navigator.clipboard;
    function legacy() {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand("copy"); } catch (e) {}
      ta.remove();
    }
    if (cb && typeof cb.writeText === "function") cb.writeText(text).then(null, legacy);
    else legacy();
  }

  function selAsk(c, run) {
    if (c.cut) toast(tr("sel.cut", { n: String(MAX_SEL) }));
    run();
  }
  function openSelMenu(s, x, y) {
    hideChip();
    var c = cleanSel(s.text);
    if (!c.text) return;
    showMenu(x, y, false, tr("sel.title"), function (item, sep) {
      item(tr("sel.copy"), IC_COPY, function () { copyText(c.text); });
      sep();
      if (!hasAssistant()) return;
      SEL_ACTS.forEach(function (k) {
        item(tr("sel." + k), k === "ask" ? IC_TASK : IC_ASK, function () {
          selAsk(c, function () { ask({ ask: expand(tr("selp." + k), { sel: c.text }) }); });
        });
      });
      sep();
      list(load()).filter(function (it) { return it.k === "ask" && needsSel(textOf(it)); }).slice(0, MAX_SHOWN)
        .forEach(function (it) {
          item(nameOf(it), IC_TASK, function () { selAsk(c, function () { runItem(it, c.text); }); }, it.send ? tr("sendMark") : "");
        });
    });
  }
  // The menu for what is selected in frame f, under the selection.
  function selMenuAt(f, s) {
    var fr = f.getBoundingClientRect();
    openSelMenu(s, fr.left + s.rect.left, fr.top + s.rect.bottom + 4);
  }

  var chip = null, chipTimer = null;
  function hideChip() {
    clearTimeout(chipTimer);
    chipTimer = null;
    if (chip) { chip.el.remove(); chip = null; }
  }
  function showChip(f, s, touch) {
    hideChip();
    var fr = f.getBoundingClientRect();
    if (!fr.width || !fr.height) return;
    var b = el("button", "qm-chip");
    b.type = "button";
    var ic = el("span", "qm-ic");
    ic.innerHTML = IC_ASK;                      // static shell icon, not data
    b.appendChild(ic);
    b.appendChild(el("span", "", tr("sel.chip")));
    b.setAttribute("aria-label", tr("sel.title"));
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); });   // the selection keeps its focus
    b.addEventListener("click", function () {
      var r = b.getBoundingClientRect(), cur = chip ? chip.sel : s;
      hideChip();
      openSelMenu(cur, r.left, r.bottom + 4);
    });
    doc.body.appendChild(b);
    var cw = b.offsetWidth, ch = b.offsetHeight, gap = touch ? 30 : 8;   // under the phone's handles
    var top = Math.max(fr.top, 0) + 8, bottom = Math.min(fr.bottom, root.innerHeight) - 8;
    var x = fr.left + Math.min(s.rect.right, fr.width) - cw;
    var y = fr.top + s.rect.bottom + gap;
    if (y + ch > bottom) y = fr.top + s.rect.top - ch - gap;
    if (y < top) y = bottom - ch;
    b.style.left = Math.max(fr.left + 8, Math.min(x, fr.right - cw - 8)) + "px";
    b.style.top = Math.max(top, Math.min(y, bottom - ch)) + "px";
    chip = { el: b, frame: f, sel: s };
  }

  function wireFrame(f) {
    var w = frameOk(f);
    if (!w) return;
    try { if (w.__qmSel) return; w.__qmSel = 1; } catch (e) { return; }
    var ptr = "mouse", down = false;
    function schedule() {
      clearTimeout(chipTimer);
      chipTimer = setTimeout(function () {
        chipTimer = null;
        if (down || menu || !chipOn() || !hasAssistant() || !frameOk(f)) return;
        var s = selOf(w);
        if (!s || (ptr === "mouse" && !s.editable)) return;     // with a mouse, a right-click does it
        showChip(f, s, ptr !== "mouse");
      }, 450);
    }
    w.addEventListener("pointerdown", function (e) {
      ptr = e.pointerType || "mouse";
      down = true;
      hideChip();
      if (menu) closeMenu(false);
    }, true);
    ["pointerup", "pointercancel"].forEach(function (t) {
      w.addEventListener(t, function () { down = false; schedule(); }, true);
    });
    w.document.addEventListener("selectionchange", function () {
      if (chip && chip.frame === f) hideChip();
      schedule();
    });
    w.addEventListener("keydown", function (e) { if (e.key !== "Shift") ptr = "mouse"; if (chip) hideChip(); }, true);
    w.addEventListener("scroll", function () { if (chip) hideChip(); }, true);
    w.addEventListener("contextmenu", function (e) {
      if (e.defaultPrevented || e.shiftKey || !hasAssistant() || !frameOk(f)) return;
      var kb = !e.clientX && !e.clientY;          // the context-menu key
      if (ptr !== "mouse" && !kb) return;         // touch: the button under the text does it
      var s = selOf(w);
      if (!s || s.editable) return;               // text fields keep Cut and Paste
      e.preventDefault();
      if (kb) { selMenuAt(f, s); return; }
      var fr = f.getBoundingClientRect();
      openSelMenu(s, fr.left + e.clientX, fr.top + e.clientY);
    });
  }
  function wireFrames() {
    doc.addEventListener("load", function (e) {
      var t = e.target;
      if (t && t.tagName === "IFRAME") wireFrame(t);
    }, true);
    Array.prototype.forEach.call(doc.querySelectorAll("iframe"), wireFrame);
    root.addEventListener("resize", hideChip);
  }

  // Ctrl+Alt+Shift+Q: with text selected in the app in front, the menu
  // of selected text; otherwise the mini window.
  function quick() {
    var f = doc.activeElement;
    if (f && f.tagName === "IFRAME" && hasAssistant()) {
      var w = frameOk(f), s = w && selOf(w);
      if (s) { selMenuAt(f, s); return; }
    }
    ask(null);
  }

  // ---------- 10. Public API ----------
  // host = { desktop, apps(), open(app), label(app), icons, lang(),
  //          running() → the open app or null, isOpen(id) optional
  //          (alive behind, multitasking), toast(msg) optional }
  function attach(h) {
    if (host) return;
    host = h || {};
    injectCss();
    load();
    registerSync();
    if (host.desktop) wireDesktop();
    wireFrames();
    watchRunning();
  }

  root.orosQuick = {
    VER: VER,
    model: model,
    attach: attach,
    edit: edit,
    mini: function (target) { if (target) ask(target); else quick(); },
    takeMini: takeMini,
    // Sticky Notes leaves the desktop's right-click to this menu.
    ownsDesktop: function () { return !!(host && host.desktop); },
    selChip: function (on) { if (on !== undefined) setChipOn(!!on); return chipOn(); },
    items: function () { return list(load()).filter(usable).map(function (it) { return { id: it.id, k: it.k, name: nameOf(it) }; }); },
    run: function (id) { list(load()).forEach(function (it) { if (it.id === id && usable(it)) runItem(it); }); }
  };
})(typeof window !== "undefined" ? window : globalThis);
