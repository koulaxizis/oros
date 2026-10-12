// ============================================================
// orOS — opening files from the device (fileopen.js)
// ------------------------------------------------------------
// The installed orOS (Chrome / Edge on Windows, Linux, macOS) is
// listed in the system's "Open with" for the file types below,
// through the manifest's "file_handlers". The browser starts orOS
// at the handler's action (/?file-open=<app>) and hands the files
// to window.launchQueue. This file:
//   - holds the one table of types → apps (HANDLERS). The manifest
//     mirrors it (tests/fileopen.test.js keeps the two equal).
//   - picks the app: the person's choice for that type (Settings →
//     Opening files, this device only), else the only app, else an
//     "Open with" chooser (types more than one app reads).
//   - hands the File to the app through the generic deep link:
//     __orosOpenAt(app, { openFile: { token, name, size } }). A File
//     cannot travel in that JSON target, so the shell keeps it under
//     a one-shot token and the app takes it with
//     window.parent.__orosTakeFile(token). Each app then runs its own
//     import (same checks and sanitisers as its Import button).
//     Calendar (.ics) and Contacts (.vcf) take the text instead
//     (BR-FILE-IMPORT: ≤ 5 MB, { importIcs | importVcf: { name, text } }).
//   - never reads, stores or runs the file itself. Nothing is written
//     back to the original file.
// Device-local preference: localStorage "oros-file-open" (oros-
// prefix, so the factory reset sweeps it; never synced).
// Shared by the shell (window.orosFileOpen) and node tests.
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-file-open";
  var MAX_BYTES = 50 * 1024 * 1024;
  var TOKEN_TTL = 10 * 60 * 1000;

  // One entry per manifest file_handler, in the manifest's order.
  // accept: MIME type → extensions (as the manifest wants them).
  // The first app that lists an extension is its default.
  var HANDLERS = [
    { app: "writer", accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.oasis.opendocument.text": [".odt"],
      "application/rtf": [".rtf"],
      "text/markdown": [".md", ".markdown"],
      "text/plain": [".txt"],
      "application/x-oros-doc": [".orosdoc"] } },
    { app: "spreadsheet", accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
      "text/csv": [".csv"] } },
    { app: "atelier", accept: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "application/x-oros-design": [".orosdesign"] } },
    { app: "slides", accept: {
      "application/x-oros-slides": [".orosslides"] } },
    { app: "layout", accept: {
      "application/x-oros-layout": [".oroslayout"],
      "application/vnd.scribus": [".sla"],
      "application/vnd.adobe.indesign-idml-package": [".idml"] } },
    { app: "feeds", accept: {
      "text/x-opml": [".opml"] } },
    { app: "podcasts", accept: {
      "text/x-opml": [".opml"] } },
    { app: "mindmap", accept: {
      "application/x-freemind": [".mm"],
      "application/vnd.xmind.workbook": [".xmind"],
      "text/x-opml": [".opml"],
      "text/markdown": [".md", ".markdown"],
      "text/plain": [".txt"] } },
    { app: "familytree", accept: {
      "application/x-gedcom": [".ged", ".gedcom"] } },
    { app: "ringtones", accept: {
      "audio/x-rtttl": [".rtttl", ".rtx"] } },
    { app: "photolab", accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/gif": [".gif"],
      "image/bmp": [".bmp"],
      "image/avif": [".avif"],
      "image/vnd.adobe.photoshop": [".psd"],
      "image/openraster": [".ora"] } },
    { app: "library", accept: {
      "application/epub+zip": [".epub"],
      "application/pdf": [".pdf"] } },
    { app: "notes", accept: {
      "text/plain": [".txt"],
      "text/markdown": [".md", ".markdown"] } },
    // BR-FILE-IMPORT (owned by Calendar / Contacts): these two take the
    // file's text, not a token: __orosOpenAt(app, { <key>: { name, text } }).
    { app: "calendar", text: "importIcs", accept: {
      "text/calendar": [".ics"] } },
    { app: "contacts", text: "importVcf", accept: {
      "text/vcard": [".vcf"] } }
  ];
  var TEXT_MAX = 5 * 1024 * 1024;

  var STRINGS = {
    en: {
      "title": "Open “{name}” with",
      "always": "Always use this app for {ext} files",
      "cancel": "Cancel",
      "big": "This file is too big to open in orOS.",
      "unknown": "orOS has no app for this kind of file.",
      "more": "orOS opened the first file only."
    },
    el: {
      "title": "Άνοιγμα του «{name}» με",
      "always": "Πάντα με αυτή την εφαρμογή για αρχεία {ext}",
      "cancel": "Άκυρο",
      "big": "Το αρχείο είναι πολύ μεγάλο για να ανοίξει στο orOS.",
      "unknown": "Το orOS δεν έχει εφαρμογή για αυτό το είδος αρχείου.",
      "more": "Το orOS άνοιξε μόνο το πρώτο αρχείο."
    }
  };

  function str(lang, key, vars) {
    var s = (STRINGS[lang === "el" ? "el" : "en"] || STRINGS.en)[key] || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  // ---------- Pure model ----------
  function extOf(name) {
    var m = /\.([a-z0-9]{1,12})$/i.exec(String(name || ""));
    return m ? "." + m[1].toLowerCase() : "";
  }

  var APPS_BY_EXT = (function () {
    var out = {};
    HANDLERS.forEach(function (h) {
      Object.keys(h.accept).forEach(function (mime) {
        h.accept[mime].forEach(function (ext) {
          var list = Object.prototype.hasOwnProperty.call(out, ext) ? out[ext] : (out[ext] = []);
          if (list.indexOf(h.app) === -1) list.push(h.app);
        });
      });
    });
    return out;
  })();

  function appsFor(ext) {
    ext = String(ext || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(APPS_BY_EXT, ext) ? APPS_BY_EXT[ext].slice() : [];
  }

  // Every extension, in table order.
  function extensions() { return Object.keys(APPS_BY_EXT); }

  // The types more than one app can open (the ones with a choice).
  function shared() {
    return extensions().filter(function (x) { return APPS_BY_EXT[x].length > 1; });
  }

  // { ver: 1, map: { ".txt": "writer" | "ask" } } — anything else dropped.
  function normPrefs(raw) {
    var out = { ver: 1, map: {} };
    var map = raw && typeof raw === "object" && raw.map && typeof raw.map === "object" ? raw.map : null;
    if (!map) return out;
    Object.keys(map).forEach(function (ext) {
      var v = map[ext], apps = appsFor(ext);
      if (!apps.length || typeof v !== "string") return;
      if (v === "ask" || apps.indexOf(v) !== -1) out.map[ext] = v;
    });
    return out;
  }

  // What to do with a file: { app } or { ask: [apps] } or null (no app).
  function choose(name, prefs) {
    var ext = extOf(name), apps = appsFor(ext);
    if (!apps.length) return null;
    var p = normPrefs(prefs).map[ext];
    if (p === "ask") return { ask: apps, ext: ext };
    if (p) return { app: p, ext: ext };
    if (apps.length === 1) return { app: apps[0], ext: ext };
    return { ask: apps, ext: ext };
  }

  // The current choice for a type, for Settings: an app id, "ask", or
  // "" (no choice made: the only app, or the chooser).
  function choiceFor(ext, prefs) { return normPrefs(prefs).map[String(ext || "").toLowerCase()] || ""; }

  function setChoice(prefs, ext, value) {
    var p = normPrefs(prefs);
    ext = String(ext || "").toLowerCase();
    if (!value) delete p.map[ext];
    else p.map[ext] = value;
    return normPrefs(p);
  }

  // BR-FILE-IMPORT apps: the deep-link key that carries the text, else "".
  function textKey(app) {
    for (var i = 0; i < HANDLERS.length; i++) if (HANDLERS[i].app === app) return HANDLERS[i].text || "";
    return "";
  }

  // The manifest's file_handlers, built from the table. Each
  // extension goes into one handler only (its first app), so the
  // system's "Open with" lists orOS once per type; the other apps
  // that read it are offered by the chooser inside orOS.
  function manifestHandlers() {
    var seen = {}, out = [];
    HANDLERS.forEach(function (h) {
      var accept = {}, any = false;
      Object.keys(h.accept).forEach(function (mime) {
        var exts = h.accept[mime].filter(function (x) { return !seen[x]; });
        if (!exts.length) return;
        exts.forEach(function (x) { seen[x] = true; });
        accept[mime] = exts;
        any = true;
      });
      if (any) out.push({ action: "/?file-open=" + h.app, accept: accept });
    });
    return out;
  }

  // Android "Share → orOS" (manifest share_target, POST): the file
  // types it offers orOS for. Every MIME type and extension in the
  // table, once each.
  var SHARE_INBOX = "oros-share-inbox";
  function shareAccept() {
    var out = [];
    HANDLERS.forEach(function (h) {
      Object.keys(h.accept).forEach(function (mime) {
        [mime].concat(h.accept[mime]).forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
      });
    });
    return out;
  }
  function shareTarget() {
    return {
      action: "/?share-target", method: "POST", enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url",
                files: [{ name: "files", accept: shareAccept() }] }
    };
  }
  // ?share-files=<id>: the sw.js inbox entry, or "big" (too large).
  function shareIdFromUrl(href) {
    var v = "";
    try { v = new URL(href, "https://x.invalid/").searchParams.get("share-files") || ""; } catch (e) { v = ""; }
    return /^(big|[a-z0-9]{6,40})$/.test(v) ? v : "";
  }

  var api = {
    HANDLERS: HANDLERS, MAX_BYTES: MAX_BYTES, PREF_KEY: PREF_KEY, STRINGS: STRINGS,
    extOf: extOf, appsFor: appsFor, extensions: extensions, shared: shared,
    normPrefs: normPrefs, choose: choose, choiceFor: choiceFor, setChoice: setChoice,
    manifestHandlers: manifestHandlers, shareTarget: shareTarget, shareAccept: shareAccept,
    shareIdFromUrl: shareIdFromUrl, SHARE_INBOX: SHARE_INBOX, textKey: textKey, TEXT_MAX: TEXT_MAX, str: str
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ---------- Browser side (shell) ----------
  var w = root, doc = root.document;

  function lang() { return w.orosLang === "el" ? "el" : "en"; }
  function T(key, vars) { return str(lang(), key, vars); }
  function appName(id) {
    try {
      var k = "app." + id, v = typeof w.t === "function" ? w.t(k) : k;
      return v && v !== k ? v : id;
    } catch (e) { return id; }
  }
  var laterNotices = [];
  function notice(text) {
    if (!isReady) { laterNotices.push(text); return; }    // notifications.js not up yet
    try {
      var n = w.orosNotifs;
      if (n && typeof n.transient === "function" && n.transient({ ns: "files", title: text })) return;
    } catch (e) {}
    try { console.info("[orOS] " + text); } catch (e) {}
  }

  function loadPrefs() {
    try { return normPrefs(JSON.parse(w.localStorage.getItem(PREF_KEY) || "null")); }
    catch (e) { return normPrefs(null); }
  }
  function savePrefs(p) {
    try { w.localStorage.setItem(PREF_KEY, JSON.stringify(normPrefs(p))); } catch (e) {}
  }

  // One-shot File handover. A token lives until taken or 10 minutes.
  var held = {};
  function hold(file) {
    var tok = "";
    try {
      var a = new Uint8Array(12);
      w.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) tok += (a[i] < 16 ? "0" : "") + a[i].toString(16);
    } catch (e) { tok = String(Date.now()) + String(Math.random()).slice(2); }
    held[tok] = { file: file, at: Date.now() };
    return tok;
  }
  w.__orosTakeFile = function (token) {
    token = String(token || "");
    if (!Object.prototype.hasOwnProperty.call(held, token)) return null;
    var h = held[token];
    delete held[token];
    return Date.now() - h.at > TOKEN_TTL ? null : h.file;
  };

  function openWith(app, file) {
    if (typeof w.__orosOpenAt !== "function") return;
    var name = String(file.name || "").slice(0, 255), key = textKey(app);
    if (key) {
      if (file.size > TEXT_MAX) { notice(T("big")); return; }
      Promise.resolve(file.text()).then(function (text) {
        var tg = {};
        tg[key] = { name: name, text: String(text) };
        w.__orosOpenAt(app, tg);
      }, function () { notice(T("unknown")); });
      return;
    }
    w.__orosOpenAt(app, { openFile: { token: hold(file), name: name, size: file.size || 0 } });
  }

  // The "Open with" chooser: one button per app, "always" box, Cancel.
  // Inline styles with palette vars, like the shell's own dialogs.
  function chooser(file, apps, ext) {
    var stale = doc.getElementById("fileopen-dialog");
    if (stale) stale.remove();
    var dlg = doc.createElement("dialog");
    dlg.id = "fileopen-dialog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;background:var(--panel-bg);" +
      "color:var(--text);padding:18px;width:min(340px,calc(100vw - 32px));";
    var h = doc.createElement("div");
    h.style.cssText = "font-weight:600;font-size:15px;margin-bottom:12px;overflow-wrap:anywhere;";
    h.textContent = T("title", { name: String(file.name || "").slice(0, 120) });
    dlg.appendChild(h);
    var list = doc.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:12px;";
    var lab = doc.createElement("label");
    lab.style.cssText = "display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-dim);margin-bottom:14px;";
    var cb = doc.createElement("input");
    cb.type = "checkbox";
    lab.appendChild(cb);
    var sp = doc.createElement("span");
    sp.textContent = T("always", { ext: ext });
    lab.appendChild(sp);
    apps.forEach(function (id) {
      var b = doc.createElement("button");
      b.type = "button";
      b.setAttribute("data-app", id);
      b.style.cssText =
        "text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:8px;" +
        "background:transparent;color:var(--text);font-size:14px;cursor:pointer;min-height:44px;";
      b.textContent = appName(id);
      b.addEventListener("click", function () {
        if (cb.checked) savePrefs(setChoice(loadPrefs(), ext, id));
        dlg.close();
        openWith(id, file);
      });
      list.appendChild(b);
    });
    dlg.appendChild(list);
    dlg.appendChild(lab);
    var row = doc.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;";
    var cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.style.cssText =
      "padding:7px 14px;border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);cursor:pointer;";
    cancel.textContent = T("cancel");
    cancel.addEventListener("click", function () { dlg.close(); });
    row.appendChild(cancel);
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    doc.body.appendChild(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  // One file in: size check, pick the app (or ask), hand it over.
  function deliver(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) { notice(T("big")); return; }
    var c = choose(file.name, loadPrefs());
    if (!c) { notice(T("unknown")); return; }
    if (c.app) openWith(c.app, file);
    else chooser(file, c.ask, c.ext);
  }

  // Launches wait until the shell has its app list (ready()).
  var queue = [], isReady = false;
  function take(files) {
    files = (files || []).filter(Boolean);
    if (!files.length) return;
    if (files.length > 1) notice(T("more"));
    queue.push(files[0]);
    flush();
  }
  function flush() {
    if (!isReady) return;
    while (queue.length) deliver(queue.shift());
  }

  // The action URL (?file-open=…) and a shared file (?share-files=…)
  // are one-shots: out of the address bar at once, so a reload is a
  // plain orOS start.
  var shareId = shareIdFromUrl(w.location.href);
  (function () {
    try {
      var u = new URL(w.location.href);
      if (!u.searchParams.has("file-open") && !u.searchParams.has("share-files")) return;
      u.searchParams.delete("file-open");
      u.searchParams.delete("share-files");
      w.history.replaceState(w.history.state, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  })();

  // Android "Share → orOS" with a file: sw.js put it in the inbox
  // cache (name in X-Name) and redirected here. Taken once; the inbox
  // is emptied after every read so nothing lingers.
  if (shareId === "big") notice(T("big"));
  else if (shareId && w.caches && typeof w.caches.open === "function") {
    w.caches.open(SHARE_INBOX).then(function (c) {
      return c.match("/__share/" + shareId).then(function (r) {
        if (!r) return null;
        var name = "";
        try { name = decodeURIComponent(r.headers.get("X-Name") || ""); } catch (e) { name = ""; }
        var more = r.headers.get("X-More") === "1";
        return r.blob().then(function (b) {
          if (more) notice(T("more"));
          return new w.File([b], name.slice(0, 255) || "file", { type: b.type || "" });
        });
      });
    }).then(function (f) {
      try { w.caches.delete(SHARE_INBOX); } catch (e) {}
      if (f) { queue.push(f); flush(); }
    }, function () {});
  }

  if ("launchQueue" in w && w.launchQueue && typeof w.launchQueue.setConsumer === "function") {
    w.launchQueue.setConsumer(function (params) {
      var handles = params && params.files ? Array.prototype.slice.call(params.files) : [];
      if (!handles.length) return;
      Promise.all(handles.slice(0, 1).map(function (fh) {
        return fh && typeof fh.getFile === "function" ? fh.getFile().then(null, function () { return null; }) : null;
      })).then(function (files) {
        if (handles.length > 1) notice(T("more"));
        queue.push.apply(queue, files.filter(Boolean));
        flush();
      });
    });
  }

  w.orosFileOpen = {
    v: 1,
    // Shell: the app list is in, launches may go now.
    ready: function () {
      isReady = true;
      laterNotices.splice(0).forEach(notice);
      flush();
    },
    // Same path for a File from elsewhere (drag onto the desktop, tests).
    open: function (files) { take(Array.prototype.slice.call(files || [])); },
    // Settings → Opening files.
    supported: function () { return "launchQueue" in w; },
    installed: function () {
      try { return w.matchMedia("(display-mode: standalone)").matches || w.matchMedia("(display-mode: window-controls-overlay)").matches; }
      catch (e) { return false; }
    },
    handlers: function () { return HANDLERS.map(function (h) { return { app: h.app, exts: extsOf(h) }; }); },
    shared: shared,
    appsFor: appsFor,
    choice: function (ext) { return choiceFor(ext, loadPrefs()); },
    setChoice: function (ext, value) {
      if (value && value !== "ask" && appsFor(ext).indexOf(value) === -1) return;
      savePrefs(setChoice(loadPrefs(), ext, value));
    }
  };
  function extsOf(h) {
    var out = [];
    Object.keys(h.accept).forEach(function (m) {
      h.accept[m].forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
    });
    return out;
  }
})(typeof window !== "undefined" ? window : null);
