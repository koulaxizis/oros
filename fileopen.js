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
//     (BR-FILE-IMPORT: ≤ 5 MB, { importIcs | importVcf: { name, text } });
//     their .oroscal / .oroscontacts bundles go as Files (textExt).
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
      "text/csv": [".csv"],
      "application/x-oros-sheet": [".orossheet"] } },
    { app: "atelier", accept: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "application/x-oros-design": [".orosdesign"] } },
    { app: "slides", accept: {
      "application/x-oros-slides": [".orosslides"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"] } },
    { app: "layout", accept: {
      "application/x-oros-layout": [".oroslayout"],
      "application/vnd.scribus": [".sla"],
      "application/vnd.adobe.indesign-idml-package": [".idml"] } },
    { app: "feeds", accept: {
      "text/x-opml": [".opml"],
      "application/x-oros-feeds": [".orosfeeds"] } },
    { app: "podcasts", accept: {
      "text/x-opml": [".opml"],
      "application/x-oros-podcasts": [".orospodcasts"] } },
    { app: "mindmap", accept: {
      "application/x-freemind": [".mm"],
      "application/vnd.xmind.workbook": [".xmind"],
      "text/x-opml": [".opml"],
      "text/markdown": [".md", ".markdown"],
      "text/plain": [".txt"],
      "application/x-oros-mind": [".orosmind"] } },
    { app: "familytree", accept: {
      "application/x-gedcom": [".ged", ".gedcom"],
      "application/x-oros-tree": [".orostree"] } },
    { app: "ringtones", accept: {
      "audio/x-rtttl": [".rtttl", ".rtx"],
      "application/x-oros-tone": [".orostone"] } },
    { app: "photolab", accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/gif": [".gif"],
      "image/bmp": [".bmp"],
      "image/avif": [".avif"],
      "image/vnd.adobe.photoshop": [".psd"],
      "image/openraster": [".ora"],
      "application/x-oros-photo": [".orosphoto"] } },
    { app: "library", accept: {
      "application/epub+zip": [".epub"],
      "application/pdf": [".pdf"],
      "application/x-fictionbook+xml": [".fb2"],
      "application/vnd.comicbook+zip": [".cbz"],
      "application/vnd.comicbook-rar": [".cbr"],
      "application/x-oros-library": [".oroslibrary"] } },
    { app: "montage", max: 4096 * 1024 * 1024, accept: {
      "video/mp4": [".mp4", ".m4v"],
      "video/webm": [".webm"],
      "video/quicktime": [".mov"],
      "application/x-oros-montage": [".orosmontage"] } },
    { app: "studio", max: 4096 * 1024 * 1024, accept: {
      "application/x-oros-studio": [".orosstudio"] } },
    { app: "pixel", accept: {
      "application/x-oros-pixel": [".orospixel"] } },
    { app: "notes", accept: {
      "text/plain": [".txt"],
      "text/markdown": [".md", ".markdown"],
      "application/x-oros-notes": [".orosnotes"] } },
    { app: "wiki", accept: {
      "application/x-oros-wiki": [".oroswiki"] } },
    { app: "kanban", accept: {
      "application/x-oros-board": [".orosboard"] } },
    { app: "prompter", accept: {
      "application/x-oros-script": [".orosscript"] } },
    { app: "texttools", accept: {
      "text/plain": [".txt"],
      "text/csv": [".csv"],
      "text/tab-separated-values": [".tsv"] } },
    { app: "maps", accept: {
      "application/gpx+xml": [".gpx"],
      "application/vnd.google-earth.kml+xml": [".kml"],
      "application/geo+json": [".geojson"],
      "application/x-oros-map": [".orosmap"] } },
    { app: "certificates", accept: {
      "application/x-oros-cert": [".oroscert"] } },
    { app: "labels", accept: {
      "application/x-oros-labels": [".oroslabels"] } },
    { app: "travel", accept: {
      "application/x-oros-trip": [".orostrip"] } },
    { app: "chess", accept: {
      "application/x-chess-pgn": [".pgn"] } },
    // BR-FILE-IMPORT (owned by Calendar / Contacts): these two take the
    // file's text, not a token: __orosOpenAt(app, { <key>: { name, text } }).
    // The .oroscal / .oroscontacts bundles are Files (token), like
    // every other bundle: textExt names the types that go as text.
    { app: "calendar", text: "importIcs", textExt: [".ics"], accept: {
      "text/calendar": [".ics"],
      "application/x-oros-cal": [".oroscal"] } },
    { app: "contacts", text: "importVcf", textExt: [".vcf"], accept: {
      "text/vcard": [".vcf"],
      "application/x-oros-contacts": [".oroscontacts"] } },
    // Phase 4b record apps (recordpkg.js): one bundle type each, taken
    // as a File through { openFile: { token } }.
    { app: "todo", accept: { "application/x-oros-tasks": [".orostasks"] } },
    { app: "habits", accept: { "application/x-oros-habits": [".oroshabits"] } },
    { app: "water", accept: { "application/x-oros-water": [".oroswater"] } },
    { app: "chores", accept: { "application/x-oros-chores": [".oroschores"] } },
    { app: "scores", accept: { "application/x-oros-scores": [".orosscores"] } },
    { app: "cycle", accept: { "application/x-oros-cycle": [".oroscycle"] } },
    { app: "mood", accept: { "application/x-oros-mood": [".orosmood"] } },
    { app: "bookmarks", accept: { "application/x-oros-bookmarks": [".orosbookmarks"] } },
    { app: "meals", accept: { "application/x-oros-meals": [".orosmeals"] } },
    { app: "stickies", accept: { "application/x-oros-stickies": [".orosstickies"] } },
    { app: "budget", accept: { "application/x-oros-budget": [".orosbudget"] } },
    { app: "invoices", accept: { "application/x-oros-invoices": [".orosinvoices"] } },
    { app: "crm", accept: { "application/x-oros-crm": [".oroscrm"] } },
    { app: "timesheet", accept: { "application/x-oros-hours": [".oroshours"] } },
    { app: "quote", accept: { "application/x-oros-quote": [".orosquote"] } },
    { app: "split", accept: { "application/x-oros-split": [".orossplit"] } },
    { app: "stock", accept: { "application/x-oros-stock": [".orosstock"] } },
    { app: "diary", accept: { "application/x-oros-diary": [".orosdiary"] } },
    { app: "health", accept: { "application/x-oros-health": [".oroshealth"] } },
    { app: "fitness", accept: { "application/x-oros-workouts": [".orosworkouts"] } },
    { app: "baby", accept: { "application/x-oros-baby": [".orosbaby"] } },
    { app: "petcare", accept: { "application/x-oros-pet": [".orospet"] } },
    { app: "plants", accept: { "application/x-oros-plants": [".orosplants"] } },
    { app: "garage", accept: { "application/x-oros-garage": [".orosgarage"] } },
    { app: "shelf", accept: { "application/x-oros-shelf": [".orosshelf"] } },
    { app: "signature", accept: { "application/x-oros-signature": [".orossignature"] } },
    { app: "newsletter", accept: { "application/x-oros-newsletter": [".orosnewsletter"] } },
    { app: "storage", accept: { "application/x-oros-inventory": [".orosinventory"] } },
    { app: "flashcards", accept: { "application/x-oros-cards": [".oroscards"] } },
    // Pad (text and code editor): code and config types no other app
    // reads (Pad is their only app), plus .txt / .md as one more choice
    // after Writer, Mind Map, Notes and Text Tools (Writer stays the
    // default for .txt). From Files, Pad gets the disk path (path:
    // "openPath") so it saves in place; a file from the system's
    // "Open with" is a copy, as for every app (BR-FO-4).
    { app: "pad", path: "openPath", accept: {
      "text/plain": [".txt", ".log", ".nfo", ".ini", ".cfg", ".conf", ".properties", ".env", ".diff", ".patch"],
      "text/markdown": [".md", ".markdown"],
      "text/x-python": [".py", ".pyw"],
      "application/x-sh": [".sh", ".bash", ".zsh"],
      "text/x-powershell": [".ps1", ".psm1"],
      "text/x-c": [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".ino"],
      "text/x-java": [".java", ".kt", ".kts"],
      "text/x-csharp": [".cs"],
      "text/x-go": [".go"],
      "text/x-rust": [".rs"],
      "text/x-typescript": [".ts", ".tsx", ".jsx", ".mts", ".cts"],
      "text/css": [".css", ".scss", ".less"],
      "application/xml": [".xml", ".xsl", ".xslt"],
      "application/x-yaml": [".yaml", ".yml"],
      "application/toml": [".toml"],
      "application/sql": [".sql"],
      "text/x-lua": [".lua"],
      "text/x-ruby": [".rb"],
      "text/x-perl": [".pl", ".pm"],
      "application/x-php": [".php"],
      "text/x-swift": [".swift"],
      "text/x-dart": [".dart"],
      "text/x-r": [".r"],
      "text/x-jsfx": [".jsfx", ".eel"] } },
    { app: "lyricsync", accept: {
      "application/x-lrc": [".lrc"],
      "application/x-subrip": [".srt"],
      "text/vtt": [".vtt"],
      "application/ttml+xml": [".ttml"],
      "text/x-ssa": [".ass", ".ssa"] } }
  ];
  var TEXT_MAX = 5 * 1024 * 1024;

  // Types only orOS's own Files opens in an app (BR-FO-9, app interop
  // wave 2). Not in the manifest: orOS does not take these over in the
  // system's "Open with". Music copies a song from elsewhere into its
  // folder (Files passes { playPath } for a song already there).
  var INSIDE = [
    { app: "music", exts: [".mp3", ".m4a", ".m4b", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wav", ".wave", ".weba"] },
    // Web and data files stay out of the system's "Open with" (BR-FO-2);
    // inside orOS, Files can open them in Pad (as text, never run).
    { app: "pad", path: "openPath", exts: [".js", ".mjs", ".cjs", ".json", ".jsonc", ".webmanifest", ".html", ".htm", ".xhtml", ".vue", ".svelte"] }
  ];

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

  // lang: "en", "el" or a pack language: i18n/<code>/fileopen.js
  // ("fileopen" in the shell's data-app). After a language change in
  // the shell the pack is fetched on first use; English until it is in.
  var packAsked = {};
  function strTable(lang) {
    if (STRINGS[lang]) return STRINGS[lang];
    var I = typeof window !== "undefined" && window.orosI18n;
    if (!I || typeof lang !== "string" || !I.known(lang)) return STRINGS.en;
    var t = I.table(STRINGS, "fileopen", lang);
    if (!I.coverage(STRINGS, "fileopen", lang)) {
      delete STRINGS[lang];
      if (!packAsked[lang]) { packAsked[lang] = true; I.ensure(lang, "fileopen", function () {}); }
    }
    return t;
  }
  function str(lang, key, vars) {
    var s = strTable(lang)[key] || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  // ---------- Pure model ----------
  function extOf(name) {
    var m = /\.([a-z0-9]{1,24})$/i.exec(String(name || ""));
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

  // Apps for a file opened from inside orOS (Files): the table's, then
  // INSIDE's.
  function insideFor(ext) {
    ext = String(ext || "").toLowerCase();
    var out = appsFor(ext);
    INSIDE.forEach(function (h) { if (h.exts.indexOf(ext) !== -1 && out.indexOf(h.app) === -1) out.push(h.app); });
    return out;
  }
  // Same as choose(), with insideFor(): { app } | { ask } | null.
  function chooseInside(name, prefs) {
    var ext = extOf(name), apps = insideFor(ext);
    if (!apps.length) return null;
    var p = normPrefs(prefs).map[ext];
    if (p && p !== "ask" && apps.indexOf(p) !== -1) return { app: p, ext: ext };
    if (p !== "ask" && apps.length === 1) return { app: apps[0], ext: ext };
    return { ask: apps, ext: ext };
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
  // With an extension: "" for the app's types that go as a File (its
  // orOS bundle), when the handler limits the text to textExt.
  function textKey(app, ext) {
    for (var i = 0; i < HANDLERS.length; i++) {
      var h = HANDLERS[i];
      if (h.app !== app) continue;
      if (!h.text) return "";
      if (ext !== undefined && Array.isArray(h.textExt) && h.textExt.indexOf(String(ext).toLowerCase()) === -1) return "";
      return h.text;
    }
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
    INSIDE: INSIDE, insideFor: insideFor, chooseInside: chooseInside,
    manifestHandlers: manifestHandlers, shareTarget: shareTarget, shareAccept: shareAccept,
    // The whole table, copied (the single apps' manifests, solo.js).
    table: function () {
      return HANDLERS.map(function (h) { return { app: h.app, accept: JSON.parse(JSON.stringify(h.accept)) }; });
    },
    shareIdFromUrl: shareIdFromUrl, SHARE_INBOX: SHARE_INBOX, textKey: textKey, TEXT_MAX: TEXT_MAX, str: str
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ---------- Browser side (shell) ----------
  var w = root, doc = root.document;

  function lang() { return w.orosI18n ? w.orosI18n.lang() : (w.orosLang === "el" ? "el" : "en"); }
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

  // A File made in an app's frame dies with that frame: Files is
  // replaced by the app it opens, so the app could not read it any
  // more. A copy made here, in the shell, outlives the caller.
  function ownFile(file) {
    try {
      return new w.File([file], String(file.name || "file"), { type: file.type || "", lastModified: file.lastModified || Date.now() });
    } catch (e) { return file; }
  }

  // The deep-link key of an app that takes a file of the orOS disk by
  // its path (Pad: "openPath"), else "".
  function pathKey(app) {
    var all = HANDLERS.concat(INSIDE);
    for (var i = 0; i < all.length; i++) if (all[i].app === app && all[i].path) return all[i].path;
    return "";
  }

  function openWith(app, file, path) {
    if (typeof w.__orosOpenAt !== "function") return;
    var pk = pathKey(app);
    if (pk && typeof path === "string" && /^\/internal\/./.test(path) && path.indexOf("..") < 0) {
      var pt = {};
      pt[pk] = path;
      w.__orosOpenAt(app, pt);
      return;
    }
    var name = String(file.name || "").slice(0, 255), key = textKey(app, extOf(name));
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
  function chooser(file, apps, ext, path) {
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
        openWith(id, file, path);
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

  // Size cap for one file: the app's own (max) when it has one, else
  // MAX_BYTES (also while the person still has to choose an app).
  function maxFor(app) {
    for (var i = 0; app && i < HANDLERS.length; i++) if (HANDLERS[i].app === app && HANDLERS[i].max) return HANDLERS[i].max;
    return MAX_BYTES;
  }

  // One file in: pick the app (or ask), size check, hand it over.
  // A single app (solo.js, "orOS Notes" …) opens the files of its own
  // types itself: no chooser, no saved choice is consulted.
  function soloApp() {
    var s = w.orosSolo;
    return s && typeof s.id === "string" ? s.id : "";
  }
  function deliver(file) {
    if (!file) return;
    var solo = soloApp(), ext = extOf(file.name);
    var c = (solo && ext && appsFor(ext).indexOf(solo) !== -1) ? { app: solo } : choose(file.name, loadPrefs());
    if (!c) { notice(T("unknown")); return; }
    if (file.size > maxFor(c.app)) { notice(T("big")); return; }
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
    // Files (inside orOS, BR-FO-9). appsFor with the INSIDE types too.
    insideFor: insideFor,
    // A file from the orOS disk: the saved choice, the only app, or the
    // chooser (ask: true always shows the chooser).
    // path (optional): where the file is on the orOS disk, for an app
    // that takes the path instead of a copy (pathKey).
    openInside: function (file, ask, path) {
      if (!file) return;
      file = ownFile(file);
      var c = chooseInside(file.name, loadPrefs());
      if (!c) { notice(T("unknown")); return; }
      if (ask && c.app && insideFor(c.ext).length > 1) c = { ask: insideFor(c.ext), ext: c.ext };
      if (c.app) {
        if (file.size > maxFor(c.app)) { notice(T("big")); return; }
        openWith(c.app, file, path);
        return;
      }
      if (file.size > maxFor("")) { notice(T("big")); return; }
      chooser(file, c.ask, c.ext, path);
    },
    // The Assistant's file card (WR-FMT): one file straight into the
    // app named (no chooser); false when that app can't take it.
    openIn: function (app, file) {
      if (!file || typeof file.size !== "number") return false;
      var ok = false;
      for (var i = 0; i < HANDLERS.length; i++) if (HANDLERS[i].app === app) ok = true;
      if (!ok) return false;
      if (file.size > maxFor(app)) { notice(T("big")); return false; }
      openWith(app, ownFile(file));
      return true;
    },
    // The Assistant's rebuild card (AS-RB): a file for an app's deep
    // link, as a one-shot token the app takes with __orosTakeFile.
    hand: function (file) {
      return file && typeof file.size === "number" ? hold(ownFile(file)) : "";
    },
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
