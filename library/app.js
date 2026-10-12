// ============================================================
// orOS Library — app core (v1.0.0)
// Library / Βιβλιοθήκη: an EPUB and PDF book reader for the books
// on the orOS disk, with bookmarks, highlights and notes that follow
// you to every device.
// This file holds the shared state (window.LIB), i18n, helpers,
// toasts and dialogs, the synced data (load, save, merge, undo), the
// device-local preferences, the palette, the deep link and the boot.
// home.js draws the library, reader.js the reading screen; epub.js
// and pdfview.js are the two engines; store.js reads the disk.
// Data:
//   - synced slice "library" (oros-library-data): books (one per
//     file, id from its SHA-256), the last place read per book,
//     marks (bookmarks + highlights with notes), tombstones, reading
//     time per day and per book for each device (stats).
//     core.js mergeLibrary (R5, R17, R26). The book FILES are files
//     of the orOS disk, synced by Vault Drive like any other file.
//   - device-local (R10): oros-library-prefs (view, sort, reading
//     settings, reading-aloud speed), oros-library-dev (this
//     device's random id for the stats), oros-library-paths (which
//     disk file is which book on this device), covers in IndexedDB "oros-library-cache".
// Deep link: __orosOpenAt("library", { book, loc? }) opens a book
// (at loc or where you stopped); { openFile: { token } } takes a
// file handed over by the shell (BR-FILE-OPEN); { path } opens a
// book file of the orOS disk.
// ============================================================
(function () {
  "use strict";

  var C = window.LibCore;
  var STORAGE_KEY = "oros-library-data";
  var PREFS_KEY = "oros-library-prefs";
  var LIB = window.LIB = { C: C };

  // ---------- i18n ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  LIB.LANG = appLang();
  document.documentElement.lang = LIB.LANG;     // Greek uppercase labels drop their accents
  LIB.t = function (key, params) {
    var S = window.LIB_STRINGS, p = S[LIB.LANG] || S.en;
    var s = p[key] !== undefined ? p[key] : (S.en[key] !== undefined ? S.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  };
  LIB.num = function (n) { try { return Number(n).toLocaleString(LIB.LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return String(n); } };
  LIB.size = function (b) {
    if (!(b > 0)) return "";
    if (b < 1024 * 1024) return LIB.num(Math.max(1, Math.round(b / 1024))) + " KB";
    return (Math.round(b / 1024 / 102.4) / 10).toLocaleString(LIB.LANG === "el" ? "el-GR" : "en-GB") + " MB";
  };
  LIB.date = function (ms) {
    try {
      return new Date(ms).toLocaleDateString(LIB.LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  };

  // ---------- DOM helpers ----------
  LIB.$ = function (id) { return document.getElementById(id); };
  LIB.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  LIB.btn = function (cls, label, icon, fn) {
    var b = LIB.el("button", cls);
    b.type = "button";
    if (icon) b.innerHTML = icon;
    if (label) { b.setAttribute("aria-label", label); b.title = label; }
    if (fn) b.addEventListener("click", fn);
    return b;
  };
  LIB.textBtn = function (cls, text, fn) {
    var b = LIB.el("button", cls, text);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  };
  LIB.parentWin = function () {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  };
  // Another app through the generic deep link (the shell opens it).
  LIB.openApp = function (app, target) {
    var p = LIB.parentWin();
    try { if (p && typeof p.__orosOpenAt === "function") { p.__orosOpenAt(app, target); return true; } } catch (e) {}
    return false;
  };
  LIB.readShelf = function () {
    try { return JSON.parse(localStorage.getItem("oros-shelf-data") || "null"); } catch (e) { return null; }
  };

  // ---------- Icons (inline SVG, R9) ----------
  function svg(d, extra) {
    return "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" " +
      "stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"" + (extra || "") + ">" + d + "</svg>";
  }
  LIB.UI = {
    plus: svg("<path d=\"M12 5v14M5 12h14\"/>"),
    more: svg("<circle cx=\"12\" cy=\"5\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"19\" r=\"1\"/>"),
    search: svg("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-4.3-4.3\"/>"),
    back: svg("<path d=\"M15 18l-6-6 6-6\"/>"),
    next: svg("<path d=\"M9 18l6-6-6-6\"/>"),
    close: svg("<path d=\"M18 6L6 18M6 6l12 12\"/>"),
    toc: svg("<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>"),
    notes: svg("<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z\"/>"),
    aa: svg("<path d=\"M4 19l5-14 5 14M6 14h6\"/><path d=\"M15 19l3-8 3 8M16 16.5h4\"/>"),
    bookmark: svg("<path d=\"M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z\"/>"),
    bookmarkOn: svg("<path d=\"M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z\" fill=\"currentColor\"/>"),
    grid: svg("<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/>"),
    list: svg("<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>"),
    book: svg("<path d=\"M4 19.5A2.5 2.5 0 016.5 17H20\"/><path d=\"M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z\"/>"),
    disk: svg("<path d=\"M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z\"/>"),
    device: svg("<path d=\"M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4\"/><path d=\"M7 10l5 5 5-5\"/><path d=\"M12 15V3\"/>"),
    copy: svg("<rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1\"/>"),
    trash: svg("<path d=\"M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6\"/>"),
    note: svg("<path d=\"M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z\"/>"),
    zoomIn: svg("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-4.3-4.3M11 8v6M8 11h6\"/>"),
    zoomOut: svg("<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-4.3-4.3M8 11h6\"/>"),
    info: svg("<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\"/>"),
    check: svg("<path d=\"M20 6L9 17l-5-5\"/>"),
    export: svg("<path d=\"M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4\"/><path d=\"M17 8l-5-5-5 5\"/><path d=\"M12 3v12\"/>"),
    speak: svg("<path d=\"M11 5L6 9H2v6h4l5 4z\"/><path d=\"M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14\"/>"),
    play: svg("<path d=\"M7 4l13 8-13 8z\" fill=\"currentColor\"/>"),
    pause: svg("<path d=\"M7 4h3v16H7zM14 4h3v16h-3z\" fill=\"currentColor\"/>"),
    skipBack: svg("<path d=\"M19 20L9 12l10-8z\"/><path d=\"M5 19V5\"/>"),
    skipFwd: svg("<path d=\"M5 4l10 8-10 8z\"/><path d=\"M19 5v14\"/>"),
    stats: svg("<path d=\"M4 20V10M10 20V4M16 20v-7M22 20H2\"/>"),
    refresh: svg("<path d=\"M23 4v6h-6M1 20v-6h6\"/><path d=\"M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15\"/>")
  };

  // ---------- Toasts ----------
  var toastTimer = null;
  LIB.toast = function (text) {
    var p = LIB.parentWin();
    try {
      if (p && p.orosNotifs && typeof p.orosNotifs.transient === "function" &&
          p.orosNotifs.transient({ ns: "library", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null, null);
  };
  // Undo / action toasts stay local (the closure never leaves the frame), 8 s.
  LIB.undoToast = function (text, fn) { localToast(text, LIB.t("btn.undo"), fn); };
  LIB.actionToast = function (text, label, fn) { localToast(text, label, fn); };
  function localToast(text, label, fn) {
    var box = LIB.$("toast");
    if (!box) return;
    var d = document.querySelector("dialog[open]");
    if (d && box.parentNode !== d) d.appendChild(box);
    else if (!d && box.parentNode !== document.body) document.body.appendChild(box);
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(LIB.el("span", "", text));
    if (fn) {
      box.appendChild(LIB.textBtn("", label, function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        fn();
      }));
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, fn ? 8000 : 4000);
  }

  // ---------- Dialogs (R32: centred, CSS) ----------
  LIB.dialog = function (id, title, cls) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "lb-dlg" + (cls ? " " + cls : "");
    if (title) {
      var h = LIB.el("div", "dlg-head");
      h.appendChild(LIB.el("h2", "dlg-title", title));
      h.appendChild(LIB.btn("icon-btn", LIB.t("btn.close"), LIB.UI.close, function () { dlg.close(); }));
      dlg.appendChild(h);
    }
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      var box = LIB.$("toast");
      if (box && box.parentNode === dlg) document.body.appendChild(box);
      setTimeout(function () { dlg.remove(); }, 0);
    });
    document.body.appendChild(dlg);
    return dlg;
  };
  LIB.confirm = function (title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var dlg = LIB.dialog("lb-confirm", title, "small");
      var done = false;
      if (text) dlg.appendChild(LIB.el("p", "dlg-text", text));
      var acts = LIB.el("div", "dlg-actions");
      acts.appendChild(LIB.textBtn("btn", LIB.t("btn.cancel"), function () { dlg.close(); }));
      var ok = LIB.textBtn("btn " + (danger ? "danger" : "primary"), okLabel, function () { done = true; dlg.close(); });
      acts.appendChild(ok);
      dlg.appendChild(acts);
      dlg.addEventListener("close", function () { resolve(done); });
      dlg.showModal();
      ok.focus();
    });
  };
  LIB.busy = function (on, text) {
    var b = LIB.$("busy");
    if (!b) return;
    b.hidden = !on;
    LIB.$("busy-text").textContent = text || LIB.t("busy.opening");
  };

  // ---------- Synced data ----------
  LIB.data = C.emptyState();
  var writeFailed = false;
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!raw) { LIB.data = C.emptyState(); return; }
    try {
      var parsed = JSON.parse(raw);
      LIB.data = C.mergeLibrary(parsed, parsed);
    } catch (e) {
      // keep the unreadable text aside, never overwrite it silently
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) {}
      LIB.data = C.emptyState();
    }
  }
  // Every change goes through here: normalize, store, tell sync, redraw.
  LIB.commit = function (silent) {
    LIB.data = C.mergeLibrary(LIB.data, LIB.data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(LIB.data));
      writeFailed = false;
    } catch (e) {
      if (!writeFailed) LIB.toast(LIB.t("msg.full"));   // R30: say it once
      writeFailed = true;
      return false;
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    if (!silent && LIB.home) LIB.home.refresh();
    return true;
  };
  LIB.now = function (after) { return Math.max(Date.now(), (after || 0) + 1); };
  LIB.book = function (id) {
    var list = LIB.data.books;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  LIB.mark = function (id) {
    var list = LIB.data.marks;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  LIB.marksOf = function (bookId) {
    return C.sortMarks(LIB.data.marks.filter(function (k) { return k.b === bookId; }));
  };
  // Add or update a book record; a real change only (R27).
  // weak: a book the disk scan found by itself. It gets the lowest stamp,
  // so the same book's record from another device (edits, finished date)
  // always wins the merge; a new device scanning before its first pull
  // must not overwrite them.
  LIB.putBook = function (rec, weak) {
    var cur = LIB.book(rec.id);
    if (weak && cur) return cur;
    var next = Object.assign({}, cur || {}, rec);
    Object.keys(next).forEach(function (k) { if (next[k] === undefined) delete next[k]; });
    delete next.m;
    var was = cur ? Object.assign({}, cur) : null;
    if (was) delete was.m;
    if (was && C.canon(was) === C.canon(next)) return cur;
    next.m = weak ? 1 : LIB.now(Math.max(cur ? cur.m : 0, LIB.data.tombs[rec.id] || 0));
    var n = C.normBook(next);
    if (!n) return cur;
    LIB.data.books = LIB.data.books.filter(function (b) { return b.id !== n.id; }).concat([n]);
    LIB.commit();
    return LIB.book(n.id);
  };
  LIB.removeBook = function (id) {
    var b = LIB.book(id);
    if (!b) return;
    var keep = JSON.parse(JSON.stringify(b));
    LIB.data.tombs[id] = LIB.now(b.m);
    LIB.commit();
    LIB.undoToast(LIB.t("msg.removed", { title: b.title }), function () {
      keep.m = LIB.now(LIB.data.tombs[id]);
      LIB.data.books.push(keep);
      LIB.commit();
    });
  };
  LIB.setPos = function (id, loc, pct) {
    if (!C.BOOK_ID_RE.test(id) || !C.LOC_RE.test(loc)) return;
    var cur = LIB.data.pos[id];
    pct = Math.max(0, Math.min(1000, Math.round(pct || 0)));
    if (cur && cur.loc === loc && cur.pct === pct) return;      // R27
    LIB.data.pos[id] = { m: LIB.now(cur ? cur.m : 0), loc: loc, pct: pct };
    LIB.commit(true);
  };
  LIB.putMark = function (rec) {
    var cur = rec.id ? LIB.mark(rec.id) : null;
    var next = Object.assign({}, cur || {}, rec);
    if (!next.id) next.id = C.newMarkId();
    next.m = LIB.now(Math.max(cur ? cur.m : 0, LIB.data.tombs[next.id] || 0));
    var n = C.normMark(next);
    if (!n) return null;
    LIB.data.marks = LIB.data.marks.filter(function (k) { return k.id !== n.id; }).concat([n]);
    LIB.commit(true);
    return n;
  };
  LIB.delMark = function (id, quiet) {
    var k = LIB.mark(id);
    if (!k) return;
    var keep = JSON.parse(JSON.stringify(k));
    LIB.data.tombs[id] = LIB.now(k.m);
    LIB.commit(true);
    if (LIB.reader) LIB.reader.marksChanged();
    if (quiet) return;
    LIB.undoToast(LIB.t(k.k === "bm" ? "msg.bmDeleted" : "msg.hlDeleted"), function () {
      keep.m = LIB.now(LIB.data.tombs[id]);
      LIB.data.marks.push(keep);
      LIB.commit(true);
      if (LIB.reader) LIB.reader.marksChanged();
    });
  };

  // Reading time on this device (stats; core.addReading). The device
  // id only keeps devices' counters apart; it is random, made once.
  LIB.devId = function () {
    var id = null;
    try { id = localStorage.getItem("oros-library-dev"); } catch (e) {}
    if (!id || !C.DEV_RE.test(id)) {
      id = "";
      for (var i = 0; i < 10; i++) id += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
      try { localStorage.setItem("oros-library-dev", id); } catch (e) {}
    }
    return id;
  };
  LIB.addReading = function (bookId, secs) {
    if (!(secs >= 1)) return;
    LIB.data.stats = C.addReading(LIB.data.stats, C.ymdOf(new Date()), LIB.devId(), bookId, secs);
    LIB.commit(true);
  };

  // ---------- Device-local preferences ----------
  var PREF_DEF = {
    view: "grid", sort: "recent", filter: "all",
    size: 100, font: "pub", lh: 1.5, margin: 1, justify: true, hyph: true,
    theme: "auto", mode: "paged", spread: true,
    pdfZoom: "width", pdfNight: false, panelOpen: null, rate: 1
  };
  LIB.prefs = Object.assign({}, PREF_DEF);
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return;
    var P = LIB.prefs;
    if (p.view === "list" || p.view === "grid") P.view = p.view;
    if (["recent", "title", "author", "progress"].indexOf(p.sort) >= 0) P.sort = p.sort;
    if (["all", "reading", "unread", "done", "epub", "pdf", "fb2", "cbz"].indexOf(p.filter) >= 0) P.filter = p.filter;
    if (typeof p.size === "number" && p.size >= 70 && p.size <= 250) P.size = Math.round(p.size / 10) * 10;
    if (["pub", "serif", "sans"].indexOf(p.font) >= 0) P.font = p.font;
    if (typeof p.lh === "number" && p.lh >= 1.2 && p.lh <= 2.2) P.lh = Math.round(p.lh * 10) / 10;
    if (p.margin === 0 || p.margin === 1 || p.margin === 2) P.margin = p.margin;
    if (typeof p.justify === "boolean") P.justify = p.justify;
    if (typeof p.hyph === "boolean") P.hyph = p.hyph;
    if (["auto", "paper", "sepia", "night"].indexOf(p.theme) >= 0) P.theme = p.theme;
    if (p.mode === "paged" || p.mode === "scroll") P.mode = p.mode;
    if (typeof p.spread === "boolean") P.spread = p.spread;
    if (p.pdfZoom === "width" || p.pdfZoom === "page" || (typeof p.pdfZoom === "number" && p.pdfZoom >= 0.25 && p.pdfZoom <= 5)) P.pdfZoom = p.pdfZoom;
    if (typeof p.pdfNight === "boolean") P.pdfNight = p.pdfNight;
    if (["toc", "search", "notes"].indexOf(p.panelOpen) >= 0) P.panelOpen = p.panelOpen;
    if ([0.8, 1, 1.2, 1.4, 1.6, 2].indexOf(p.rate) >= 0) P.rate = p.rate;
  }
  LIB.savePrefs = function () {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(LIB.prefs)); } catch (e) {}
  };

  // ---------- Palette (G3: inheritPalette + watchPalette) ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
    if (LIB.reader && LIB.reader.paletteChanged) LIB.reader.paletteChanged();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  LIB.palette = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  // ---------- Sync slice ----------
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("library", sliceGet, sliceSet, STORAGE_KEY, C.mergeLibrary);
  }
  function sliceGet() {
    if (LIB.reader && LIB.reader.flush) { LIB.reader.flush(); LIB.reader.flushTime(true); }
    return C.mergeLibrary(LIB.data, LIB.data);   // canonical copy (R26)
  }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.books)) return;
    var before = JSON.stringify(LIB.data);
    window.__orosSyncApi._suppress = true;     // R6: a pull never marks dirty
    try {
      LIB.data = C.mergeLibrary(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(LIB.data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(LIB.data) === before) return;
    if (LIB.home) LIB.home.refresh();
    if (LIB.reader) LIB.reader.dataChanged();
  }

  // ---------- Keyboard (Contract Β) ----------
  function wireKeyboard() {
    document.addEventListener("keydown", LIB.forwardShortcut, true);
  }
  // Ctrl+Alt+Shift shortcuts go to the shell (also from the book frame).
  LIB.forwardShortcut = function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = LIB.parentWin();
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) { e.stopPropagation(); e.preventDefault(); }
  };

  // ---------- Deep link ----------
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.book === "string" && C.BOOK_ID_RE.test(target.book)) {
      LIB.openBook(target.book, typeof target.loc === "string" && C.LOC_RE.test(target.loc) ? target.loc : null);
      return;
    }
    var f = target.openFile;
    if (f && typeof f === "object" && typeof f.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(f.token); } catch (e) {}
      if (file) LIB.home.importFiles([file], true);
      else LIB.toast(LIB.t("msg.openFail"));
      return;
    }
    if (typeof target.path === "string" && /^\/internal\/./.test(target.path)) LIB.home.openPath(target.path);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // Opens a book by id: the reader if the file is here, else the
  // book's details (with "Find the file").
  LIB.openBook = function (id, loc) {
    var b = LIB.book(id);
    if (!b) { LIB.toast(LIB.t("msg.noBook")); return; }
    LIB.store.pathOf(b).then(function (path) {
      if (!path) { LIB.home.details(id); return; }
      LIB.reader.open(b, path, loc);
    });
  };

  // ---------- Boot ----------
  function boot() {
    load();
    loadPrefs();
    inheritPalette();
    registerSync();
    watchPalette();
    wireKeyboard();
    LIB.home.build();
    LIB.reader.build();
    LIB.home.refresh();
    LIB.home.scan();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && LIB.reader) { LIB.reader.flush(); LIB.reader.flushTime(true); }
    });
    window.addEventListener("pagehide", function () { if (LIB.reader) { LIB.reader.flush(); LIB.reader.flushTime(true); } });
    try {
      var p = LIB.parentWin();
      if (p && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("library");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
