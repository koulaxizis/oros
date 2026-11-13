// ============================================================
// orOS Files — photos.js (the "Photos" place, wave P1)
// ------------------------------------------------------------
// Every photo and video of the disk on one timeline, newest first,
// by the day it was taken: EXIF DateTimeOriginal, else the video's
// creation time, else the date in the name (IMG_20261112_…), else the
// file's time (photos-core.js pickDate). A viewer goes through them
// (arrows, swipe, double-tap zoom, video playback, details), opens a
// photo in Photo Lab or in its folder, sends photos with the shell's
// album link (redrawn, no EXIF) and moves them to Files' Trash.
//
// Which files: the whole disk except the Trash, hidden folders,
// Documents (and every file the Documents archive holds,
// OrosFilesDocs.isDocument) and the folders other apps keep their own
// pictures in (photos-core SKIP); the person can change the folders.
// orOS Drive files that are only in the cloud (VD-OD) are listed too:
// a tile that comes into view downloads its file once, keeps the
// thumbnail, and the file goes back to the cloud (orosVault.evict).
//
// Nothing here syncs and nothing changes a file. Device-local only:
//   IndexedDB oros-files-photos  (store "items": one record per file,
//                                 its date, place, size, camera)
//   IndexedDB oros-files-thumbs  (store "thumbs": 320 px WebP, keyed
//                                 by SHA-256 when known, LRU 300 MB)
//   localStorage oros-files-photos-view { on, size, skip, extra }
// All three are in the factory-reset list (shell.js).
//
// Files is the only caller and loads this file and photos-core.js the
// first time the place opens (or at boot when it was open last time),
// then OrosFilesPhotos.init(ctx),
// treeNode() from renderTree(), leave() through leavePlaces().
// ============================================================
(function () {
  "use strict";

  var CORE = window.OrosPhotosCore;
  if (!CORE) return;
  var VIEW_LS = "oros-files-photos-view";
  var ROOT = "/internal";
  var THUMB_PX = 320;
  var THUMB_CAP = 300 * 1048576;
  var MAX_FILES = 50000, MAX_DIRS = 8000;
  var CHUNK = 360;                       // tiles added per render step
  var URL_KEEP = 2500;                   // live thumbnail object URLs
  var SIZES = [84, 116, 164];            // tile size steps (px)

  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "ph.tree":        "Photos",
      "ph.count":       "{n} items",
      "ph.countOne":    "1 item",
      "ph.smaller":     "Smaller",
      "ph.bigger":      "Bigger",
      "ph.select":      "Select",
      "ph.more":        "More",
      "ph.folders":     "Folders shown…",
      "ph.rescan":      "Look for new photos",
      "ph.reading":     "Reading dates… {i} of {n}",
      "ph.looking":     "Looking for photos and videos…",
      "ph.empty.title": "No photos yet",
      "ph.empty.body":  "Photos and videos on the orOS disk show up here by the day they were taken. Import some in Files, or turn on Camera backup in the orOS Drive app on your phone.",
      "ph.noDate":      "No date",
      "ph.today":       "Today",
      "ph.yesterday":   "Yesterday",
      "ph.years":       "Years",
      "ph.selected":    "{n} selected",
      "ph.done":        "Done",
      "ph.send":        "Send…",
      "ph.trash":       "Move to Trash",
      "ph.trashAsk":    "Move {n} items to the Trash? You can restore them from Files › Trash for 30 days.",
      "ph.trashAskOne": "Move “{name}” to the Trash? You can restore it from Files › Trash for 30 days.",
      "ph.trashed":     "Moved to the Trash: {n}",
      "ph.trashFail":   "Could not move “{name}” to the Trash",
      "ph.cancel":      "Cancel",
      "ph.sendNone":    "Only photos can be sent this way.",
      "ph.cloud":       "In the cloud",
      "ph.fetching":    "Downloading…",
      "ph.fetchFail":   "This file could not be downloaded. Is sync on and the device online?",
      "ph.noPreview":   "No preview for this file in the browser.",
      "ph.close":       "Close",
      "ph.prev":        "Previous",
      "ph.next":        "Next",
      "ph.info":        "Details",
      "ph.edit":        "Edit in Photo Lab",
      "ph.inFolder":    "Show in folder",
      "ph.i.date":      "Taken",
      "ph.i.src.exif":  "from the camera",
      "ph.i.src.video": "from the video",
      "ph.i.src.name":  "from the file name",
      "ph.i.src.file":  "file time",
      "ph.i.camera":    "Camera",
      "ph.i.size":      "Size",
      "ph.i.dims":      "Dimensions",
      "ph.i.length":    "Length",
      "ph.i.place":     "Place",
      "ph.i.folder":    "Folder",
      "ph.i.name":      "Name",
      "ph.f.title":     "Folders shown in Photos",
      "ph.f.body":      "Folders where other apps keep their own pictures (covers, receipts, designs) are left out. Tick the ones you want to see. Documents and the Trash are never shown.",
      "ph.f.extra":     "Other folders to show",
      "ph.f.add":       "Add a folder…",
      "ph.f.remove":    "Remove {name}",
      "ph.f.pick":      "Show this folder in Photos",
      "ph.f.save":      "Save",
      "ph.f.reset":     "Back to the default"
    },
    el: {
      "ph.tree":        "Φωτογραφίες",
      "ph.count":       "{n} στοιχεία",
      "ph.countOne":    "1 στοιχείο",
      "ph.smaller":     "Μικρότερα",
      "ph.bigger":      "Μεγαλύτερα",
      "ph.select":      "Επιλογή",
      "ph.more":        "Περισσότερα",
      "ph.folders":     "Φάκελοι που φαίνονται…",
      "ph.rescan":      "Αναζήτηση νέων φωτογραφιών",
      "ph.reading":     "Διαβάζω ημερομηνίες… {i} από {n}",
      "ph.looking":     "Ψάχνω φωτογραφίες και βίντεο…",
      "ph.empty.title": "Δεν υπάρχουν ακόμα φωτογραφίες",
      "ph.empty.body":  "Οι φωτογραφίες και τα βίντεο του δίσκου orOS εμφανίζονται εδώ με τη μέρα που τραβήχτηκαν. Κάνε εισαγωγή στο Files ή άνοιξε το Camera backup στην εφαρμογή orOS Drive του κινητού.",
      "ph.noDate":      "Χωρίς ημερομηνία",
      "ph.today":       "Σήμερα",
      "ph.yesterday":   "Χθες",
      "ph.years":       "Έτη",
      "ph.selected":    "{n} επιλεγμένα",
      "ph.done":        "Τέλος",
      "ph.send":        "Αποστολή…",
      "ph.trash":       "Στον Κάδο",
      "ph.trashAsk":    "Να πάνε {n} στοιχεία στον Κάδο; Τα επαναφέρεις από το Files › Κάδος για 30 μέρες.",
      "ph.trashAskOne": "Να πάει το «{name}» στον Κάδο; Το επαναφέρεις από το Files › Κάδος για 30 μέρες.",
      "ph.trashed":     "Πήγαν στον Κάδο: {n}",
      "ph.trashFail":   "Το «{name}» δεν πήγε στον Κάδο",
      "ph.cancel":      "Άκυρο",
      "ph.sendNone":    "Μόνο φωτογραφίες στέλνονται έτσι.",
      "ph.cloud":       "Στο cloud",
      "ph.fetching":    "Κατεβαίνει…",
      "ph.fetchFail":   "Το αρχείο δεν κατέβηκε. Είναι ανοιχτός ο συγχρονισμός και η συσκευή online;",
      "ph.noPreview":   "Ο browser δεν μπορεί να δείξει αυτό το αρχείο.",
      "ph.close":       "Κλείσιμο",
      "ph.prev":        "Προηγούμενο",
      "ph.next":        "Επόμενο",
      "ph.info":        "Λεπτομέρειες",
      "ph.edit":        "Επεξεργασία στο Photo Lab",
      "ph.inFolder":    "Εμφάνιση στον φάκελο",
      "ph.i.date":      "Λήψη",
      "ph.i.src.exif":  "από την κάμερα",
      "ph.i.src.video": "από το βίντεο",
      "ph.i.src.name":  "από το όνομα αρχείου",
      "ph.i.src.file":  "ώρα αρχείου",
      "ph.i.camera":    "Κάμερα",
      "ph.i.size":      "Μέγεθος",
      "ph.i.dims":      "Διαστάσεις",
      "ph.i.length":    "Διάρκεια",
      "ph.i.place":     "Τοποθεσία",
      "ph.i.folder":    "Φάκελος",
      "ph.i.name":      "Όνομα",
      "ph.f.title":     "Φάκελοι που φαίνονται στις Φωτογραφίες",
      "ph.f.body":      "Οι φάκελοι όπου άλλες εφαρμογές κρατούν δικές τους εικόνες (εξώφυλλα, αποδείξεις, σχέδια) μένουν έξω. Τσέκαρε όσους θέλεις να βλέπεις. Τα Έγγραφα και ο Κάδος δεν φαίνονται ποτέ.",
      "ph.f.extra":     "Άλλοι φάκελοι που φαίνονται",
      "ph.f.add":       "Προσθήκη φακέλου…",
      "ph.f.remove":    "Αφαίρεση {name}",
      "ph.f.pick":      "Εμφάνιση αυτού του φακέλου στις Φωτογραφίες",
      "ph.f.save":      "Αποθήκευση",
      "ph.f.reset":     "Επαναφορά"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var SVG = function (body, size) {
    return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  var ICON = {
    photo:  SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    video:  SVG('<rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3z"/>'),
    play:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    cloud:  SVG('<path d="M18 10h-1.3A7 7 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>', 14),
    minus:  SVG('<path d="M5 12h14"/>'),
    plus:   SVG('<path d="M12 5v14M5 12h14"/>'),
    check:  SVG('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>'),
    more:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    close:  SVG('<path d="M18 6L6 18M6 6l12 12"/>', 20),
    prev:   SVG('<path d="M15 18l-6-6 6-6"/>', 26),
    next:   SVG('<path d="M9 18l6-6-6-6"/>', 26),
    info:   SVG('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', 20),
    edit:   SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 20),
    folder: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 20),
    send:   SVG('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>', 20),
    trash:  SVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 20)
  };

  // ---------- state ----------
  var ctx = null, active = false;
  var recs = {};               // path → record
  var order = [];              // records on the timeline, newest first
  var months = [];             // CORE.timeline(order)
  var view = { size: 1, skip: null, extra: [] };
  var scanGen = 0, scanning = false, metaLeft = 0, metaTotal = 0;
  var renderGen = 0, rendered = 0, flat = [];   // flat = [{ m, d, rec }] in order
  var tileObs = null, moreObs = null;
  var urls = {}, urlOrder = [];                 // thumb key → object URL
  var thumbJobs = [], thumbRunning = 0, cloudJobs = [], cloudRunning = false;
  var selecting = false, picked = {};
  var viewer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, title, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;
    b.title = title;
    b.setAttribute("aria-label", title);
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function baseName(p) { return String(p).slice(String(p).lastIndexOf("/") + 1); }
  function parentOf(p) { var i = String(p).lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; }
  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  function vault() { return ctx && ctx.vault ? ctx.vault() : null; }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }
  function tz() { return new Date().getTimezoneOffset(); }
  function shell() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }

  // ---------- view prefs (device-local) ----------
  function readView() {
    try {
      var v = JSON.parse(localStorage.getItem(VIEW_LS) || "null");
      return v && typeof v === "object" ? v : null;
    } catch (e) { return null; }
  }
  function saveView() {
    try {
      localStorage.setItem(VIEW_LS, JSON.stringify({ on: active, size: view.size, skip: view.skip, extra: view.extra }));
    } catch (e) {}
  }
  function scope() {
    return { skip: Array.isArray(view.skip) ? view.skip : CORE.SKIP, extra: view.extra || [] };
  }

  // ---------- IndexedDB ----------
  var dbs = {};
  function openDb(name, store, index) {
    if (dbs[name]) return dbs[name];
    dbs[name] = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no idb")); return; }
      var req = indexedDB.open(name, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(store)) {
          var os = db.createObjectStore(store, { keyPath: "k" });
          if (index) os.createIndex(index, index);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    dbs[name].catch(function () { delete dbs[name]; });
    return dbs[name];
  }
  function itemsDb() { return openDb("oros-files-photos", "items"); }
  function thumbsDb() { return openDb("oros-files-thumbs", "thumbs", "at"); }
  function tx(dbp, store, mode, fn) {
    return dbp.then(function (db) {
      return new Promise(function (resolve, reject) {
        var tr = db.transaction(store, mode), out;
        tr.oncomplete = function () { resolve(out); };
        tr.onerror = tr.onabort = function () { reject(tr.error); };
        out = fn(tr.objectStore(store));
      });
    });
  }
  function reqP(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function loadItems() {
    return itemsDb().then(function (db) {
      return reqP(db.transaction("items").objectStore("items").getAll());
    }).catch(function () { return []; });
  }
  var saveQueue = {}, saveTimer = 0;
  function saveRec(r) {
    saveQueue[r.k] = r;
    if (!saveTimer) saveTimer = setTimeout(flushSaves, 800);
  }
  function flushSaves() {
    saveTimer = 0;
    var list = Object.keys(saveQueue).map(function (k) { return saveQueue[k]; });
    saveQueue = {};
    if (!list.length) return;
    tx(itemsDb(), "items", "readwrite", function (os) {
      list.forEach(function (r) { os.put(r); });
    }).catch(function () {});
  }
  function dropRecs(keys) {
    if (!keys.length) return;
    tx(itemsDb(), "items", "readwrite", function (os) {
      keys.forEach(function (k) { os.delete(k); });
    }).catch(function () {});
  }

  // Thumbnails: { k, b (Blob), n (bytes), at (last used, ms) }.
  var thumbBytes = -1;
  function thumbKey(r) { return r.h ? "h:" + r.h : "p:" + r.k + "|" + r.s + "|" + r.m; }
  function getThumb(key) {
    return thumbsDb().then(function (db) {
      return new Promise(function (resolve) {
        var tr = db.transaction("thumbs", "readwrite"), os = tr.objectStore("thumbs"), out = null;
        var g = os.get(key);
        g.onsuccess = function () {
          var v = g.result;
          out = v && v.b ? v.b : null;
          // Touch at most once a day: fewer writes, still a fair LRU.
          if (v && Date.now() - (v.at || 0) > 86400000) { v.at = Date.now(); os.put(v); }
        };
        tr.oncomplete = function () { resolve(out); };
        tr.onerror = tr.onabort = function () { resolve(out); };
      });
    }).catch(function () { return null; });
  }
  function putThumb(key, blob) {
    return tx(thumbsDb(), "thumbs", "readwrite", function (os) {
      os.put({ k: key, b: blob, n: blob.size, at: Date.now() });
    }).then(function () {
      if (thumbBytes >= 0) thumbBytes += blob.size;
      return pruneThumbs();
    }).catch(function () {});
  }
  // Over the cap → the least recently used go until 80 % is left.
  function pruneThumbs() {
    var countP = thumbBytes >= 0 ? Promise.resolve(thumbBytes) : tx(thumbsDb(), "thumbs", "readonly", function (os) {
      var acc = { n: 0 };
      var c = os.openCursor();
      c.onsuccess = function () { var cur = c.result; if (cur) { acc.n += cur.value.n || 0; cur.continue(); } };
      return acc;
    }).then(function (acc) { thumbBytes = acc.n; return acc.n; });
    return countP.then(function (n) {
      if (n <= THUMB_CAP) return;
      return tx(thumbsDb(), "thumbs", "readwrite", function (os) {
        var c = os.index("at").openCursor();
        c.onsuccess = function () {
          var cur = c.result;
          if (!cur || thumbBytes <= THUMB_CAP * 0.8) return;
          thumbBytes -= cur.value.n || 0;
          cur.delete();
          cur.continue();
        };
      });
    }).catch(function () {});
  }

  // ---------- finding the files ----------
  function walk(gen) {
    var fs = disk(), sc = scope(), found = [], dirs = [ROOT], seen = 0;
    if (!fs) return Promise.resolve(found);
    function next() {
      if (gen !== scanGen) return Promise.resolve(found);
      if (!dirs.length || found.length >= MAX_FILES || seen >= MAX_DIRS) return Promise.resolve(found);
      var d = dirs.shift();
      seen++;
      return fs.ls(d).then(function (list) {
        (list || []).forEach(function (e) {
          if (!e || typeof e.name !== "string") return;
          var p = d + "/" + e.name;
          if (e.dir) { if (CORE.dirWanted(p, sc)) dirs.push(p); }
          else if (CORE.indexable(p, sc)) found.push({ p: p, s: e.size || 0, m: e.mtime || 0 });
        });
      }, function () {}).then(next);
    }
    // The browser disk (OPFS) lists names only: size and time come from
    // a stat, eight at a time.
    function stats() {
      var todo = found.filter(function (f) { return !f.s && !f.m; }), i = 0;
      function worker() {
        if (gen !== scanGen || i >= todo.length) return Promise.resolve();
        var f = todo[i++];
        return fs.stat(f.p).then(function (st) {
          if (st) { f.s = st.size || 0; f.m = st.mtime || st.modified || 0; }
        }, function () {}).then(worker);
      }
      var w = [];
      for (var k = 0; k < 8; k++) w.push(worker());
      return Promise.all(w);
    }
    return next().then(stats).then(function () {
      var v = vault();
      if (v && typeof v.remoteOnly === "function") {
        var have = {};
        found.forEach(function (f) { have[f.p] = true; });
        try {
          v.remoteOnly(v.driveRoot || ROOT + "/Drive").forEach(function (e) {
            if (e && !have[e.path] && CORE.indexable(e.path, sc) && found.length < MAX_FILES) {
              found.push({ p: e.path, s: e.s || 0, m: e.m || 0, h: e.h || "", cloud: true });
            }
          });
        } catch (e) {}
      }
      return found;
    });
  }

  function isDoc(r) {
    var d = ctx && ctx.docs ? ctx.docs() : null;
    try { return !!(d && typeof d.isDocument === "function" && d.isDocument(r.k, r.h)); } catch (e) { return false; }
  }
  function manifestHash(p) {
    var v = vault();
    try {
      var e = v && typeof v.manifestEntry === "function" ? v.manifestEntry(p) : null;
      return e && typeof e.h === "string" ? e.h : "";
    } catch (e2) { return ""; }
  }

  // One record per file: k (path), s, m, kind, t (wall clock), src,
  // h (SHA-256 when sync knows it), cloud, read (metadata read),
  // lat, lon, w, ht, cam, dur.
  function freshRec(f) {
    var r = { k: f.p, s: f.s, m: f.m, kind: CORE.kindOf(f.p), h: f.h || manifestHash(f.p), cloud: !!f.cloud, read: false };
    var d = CORE.pickDate({ name: baseName(f.p), mtime: f.m, tz: tz() });
    r.t = d.t; r.src = d.src;
    return r;
  }

  function scan() {
    var gen = ++scanGen;
    scanning = true;
    paintMsg();
    return loadItems().then(function (stored) {
      var old = {};
      stored.forEach(function (r) { if (r && r.k) old[r.k] = r; });
      return walk(gen).then(function (found) {
        if (gen !== scanGen) return;
        var next = {}, gone = [];
        found.forEach(function (f) {
          var o = old[f.p] || recs[f.p];
          var r = o && o.s === f.s && (o.m === f.m || o.cloud) ? o : freshRec(f);
          r.cloud = !!f.cloud;
          if (!r.h) r.h = f.h || manifestHash(f.p);
          next[f.p] = r;
          if (r !== o) saveRec(r);
        });
        Object.keys(old).forEach(function (k) { if (!next[k]) gone.push(k); });
        dropRecs(gone);
        recs = next;
        scanning = false;
        rebuild();
        readAllMeta(gen);
      });
    }).catch(function () { scanning = false; paintMsg(); });
  }

  function rebuild() {
    var list = [];
    Object.keys(recs).forEach(function (k) { var r = recs[k]; if (!isDoc(r)) list.push({ path: r.k, t: r.t, rec: r }); });
    months = CORE.timeline(list);
    order = [];
    flat = [];
    months.forEach(function (mo) {
      mo.days.forEach(function (d) {
        d.items.forEach(function (x) { order.push(x.rec); flat.push({ m: mo.key, d: d.key, rec: x.rec }); });
      });
    });
    if (active) paint();
  }

  // ---------- metadata ----------
  function readMeta(r, blob) {
    var head = blob.slice(0, CORE.HEAD_BYTES);
    return head.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      if (r.kind === "image") {
        var e = CORE.readExif(b);
        applyMeta(r, e, null);
        return;
      }
      var v = CORE.mp4Scan(b, 0), tries = 0;
      function more(res) {
        if (!res || !res.next || tries++ > 3 || res.next >= blob.size) return Promise.resolve(res && res.next ? null : res);
        var len = Math.min(res.len || CORE.HEAD_BYTES, 16 * 1048576, blob.size - res.next);
        return blob.slice(res.next, res.next + Math.max(len, 8)).arrayBuffer().then(function (bb) {
          return more(CORE.mp4Scan(new Uint8Array(bb), res.next));
        });
      }
      return more(v).then(function (res) { applyMeta(r, null, res); });
    }).catch(function () { applyMeta(r, null, null); });
  }
  function applyMeta(r, exif, video) {
    var d = CORE.pickDate({ exif: exif, video: video, name: baseName(r.k), mtime: r.m, tz: tz() });
    var moved = d.t !== r.t;
    r.t = d.t; r.src = d.src; r.read = true;
    if (moved && metaLeft <= 0) laterRebuild();
    if (exif) {
      r.cam = [exif.make, exif.model].filter(Boolean).join(" ").slice(0, 80);
      if (exif.w) { r.w = exif.w; r.ht = exif.h; }
      if (exif.lat !== null) { r.lat = exif.lat; r.lon = exif.lon; }
    }
    if (video) {
      if (video.duration) r.dur = video.duration;
      if (video.lat !== null && video.lat !== undefined) { r.lat = video.lat; r.lon = video.lon; }
    }
    saveRec(r);
  }

  // A date read while the timeline is shown (a tile's own file, a
  // cloud file just downloaded): drawn again a moment later, at the
  // same place, never under the open viewer.
  var rebuildTimer = 0;
  function laterRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      if (!active) return;
      if (viewer && !viewer.root.hidden) { laterRebuild(); return; }
      var sc = $("ph-scroll"), top = sc ? sc.scrollTop : 0;
      rebuild();
      if (sc) sc.scrollTop = top;
    }, 2500);
  }

  // Local files whose details were never read: two at a time, the
  // newest first; the timeline is drawn again once, at the end.
  function readAllMeta(gen) {
    var fs = disk();
    var todo = Object.keys(recs).map(function (k) { return recs[k]; })
      .filter(function (r) { return !r.read && !r.cloud; })
      .sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    metaTotal = todo.length; metaLeft = todo.length;
    paintMsg();
    if (!todo.length || !fs) return;
    var changed = false;
    function worker() {
      if (gen !== scanGen || !todo.length) return Promise.resolve();
      var r = todo.shift(), before = r.t;
      return fs.read(r.k).then(function (blob) { return readMeta(r, blob); }, function () {}).then(function () {
        if (r.t !== before) changed = true;
        metaLeft--;
        if (metaLeft % 25 === 0) paintMsg();
        return worker();
      });
    }
    Promise.all([worker(), worker()]).then(function () {
      if (gen !== scanGen) return;
      metaLeft = 0;
      paintMsg();
      if (changed) {
        var sc = $("ph-scroll"), top = sc ? sc.scrollTop : 0;
        rebuild();
        if (sc) sc.scrollTop = top;
      }
    });
  }

  // ---------- thumbnails ----------
  function liveUrl(key, blob) {
    if (urls[key]) return urls[key];
    var u = URL.createObjectURL(blob);
    urls[key] = u;
    urlOrder.push(key);
    while (urlOrder.length > URL_KEEP) {
      var old = urlOrder.shift();
      try { URL.revokeObjectURL(urls[old]); } catch (e) {}
      delete urls[old];
      var stale = document.querySelectorAll('.ph-tile[data-key="' + cssEsc(old) + '"] img');
      for (var i = 0; i < stale.length; i++) stale[i].remove();
    }
    return u;
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }
  function revokeAll() {
    Object.keys(urls).forEach(function (k) { try { URL.revokeObjectURL(urls[k]); } catch (e) {} });
    urls = {}; urlOrder = [];
  }

  function drawToBlob(src, w, h) {
    var sc = Math.min(1, THUMB_PX / Math.min(w, h));
    var cw = Math.max(1, Math.round(w * sc)), chh = Math.max(1, Math.round(h * sc));
    var c = document.createElement("canvas");
    c.width = cw; c.height = chh;
    c.getContext("2d").drawImage(src, 0, 0, cw, chh);
    return new Promise(function (resolve) {
      c.toBlob(function (b) {
        if (b && b.size) { resolve(b); return; }
        c.toBlob(function (j) { resolve(j || null); }, "image/jpeg", 0.8);
      }, "image/webp", 0.8);
    });
  }
  function imageThumb(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob, { imageOrientation: "from-image" }).then(function (bmp) {
        var p = drawToBlob(bmp, bmp.width, bmp.height);
        return p.then(function (b) { try { bmp.close(); } catch (e) {} return b; });
      });
    }
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { drawToBlob(img, img.naturalWidth, img.naturalHeight).then(function (b) { URL.revokeObjectURL(u); resolve(b); }); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error("img")); };
      img.src = u;
    });
  }
  function videoThumb(blob) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(blob), v = document.createElement("video"), done = false;
      function end(b, err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeAttribute("src"); try { v.load(); } catch (e) {}
        URL.revokeObjectURL(u);
        if (err) reject(err); else resolve(b);
      }
      var timer = setTimeout(function () { end(null, new Error("timeout")); }, 8000);
      v.muted = true; v.preload = "auto"; v.playsInline = true;
      v.onloadedmetadata = function () {
        var at = isFinite(v.duration) && v.duration > 0 ? Math.min(1, v.duration / 2) : 0;
        try { v.currentTime = at; } catch (e) { end(null, e); }
      };
      v.onseeked = function () {
        if (!v.videoWidth) { end(null, new Error("size")); return; }
        drawToBlob(v, v.videoWidth, v.videoHeight).then(function (b) { end(b); }, function (e) { end(null, e); });
      };
      v.onerror = function () { end(null, new Error("video")); };
      v.src = u;
    });
  }
  function makeThumb(r, blob) {
    var p = r.kind === "video" ? videoThumb(blob) : imageThumb(blob);
    return p.then(function (b) { if (!b) throw new Error("none"); return b; });
  }

  // A tile in view asks for its picture: the cache, else the file.
  function wantThumb(tile) {
    var r = tile._rec;
    if (!r || tile._busy || tile.querySelector("img")) return;
    tile._busy = true;
    thumbJobs.push(tile);
    pumpThumbs();
  }
  function pumpThumbs() {
    while (thumbRunning < 2 && thumbJobs.length) {
      var tile = thumbJobs.pop();          // the most recent: what is on screen now
      if (!tile.isConnected) { tile._busy = false; continue; }
      thumbRunning++;
      loadThumb(tile).then(function () {}, function () {}).then(function () {
        thumbRunning--;
        pumpThumbs();
      });
    }
  }
  function showThumb(tile, key, blob) {
    tile._busy = false;
    if (!tile.isConnected || tile.querySelector("img")) return;
    var img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.src = liveUrl(key, blob);
    tile.insertBefore(img, tile.firstChild);
    tile.classList.add("has-img");
  }
  function loadThumb(tile) {
    var r = tile._rec, key = thumbKey(r);
    if (urls[key]) { showThumb(tile, key, null); return Promise.resolve(); }
    return getThumb(key).then(function (b) {
      if (b) { showThumb(tile, key, b); return; }
      if (r.cloud) { tile._busy = false; queueCloud(tile); return; }
      var fs = disk();
      if (!fs) { tile._busy = false; return; }
      return fs.read(r.k).then(function (blob) {
        var metaP = r.read ? Promise.resolve() : readMeta(r, blob);
        return metaP.then(function () { return makeThumb(r, blob); });
      }).then(function (tb) {
        return putThumb(key, tb).then(function () { showThumb(tile, key, tb); });
      }, function () { tile._busy = false; tile.classList.add("no-thumb"); });
    });
  }

  // Cloud-only files (orOS Drive): one at a time, downloaded, the
  // thumbnail and the details kept, then the file leaves the disk
  // again (evict skips files kept offline or changed here).
  function queueCloud(tile) {
    if (cloudJobs.indexOf(tile) === -1) cloudJobs.push(tile);
    pumpCloud();
  }
  function pumpCloud() {
    if (cloudRunning) return;
    var v = vault(), fs = disk();
    var tile = null;
    while (cloudJobs.length && !tile) {
      var c = cloudJobs.pop();
      if (c.isConnected && !c.querySelector("img")) tile = c;
    }
    if (!tile || !v || !fs || typeof v.fetch !== "function") return;
    var st = null;
    try { st = v.status(); } catch (e) {}
    if (!st || !st.usable) return;
    cloudRunning = true;
    var r = tile._rec, key = thumbKey(r);
    tile.classList.add("fetching");
    v.fetch(r.k).then(function () {
      return fs.read(r.k).then(function (blob) {
        return readMeta(r, blob).then(function () { return makeThumb(r, blob); });
      }).then(function (tb) {
        return putThumb(key, tb).then(function () { showThumb(tile, key, tb); });
      }, function () { tile.classList.add("no-thumb"); }).then(function () {
        if (viewer && viewer.rec === r) return;     // open in the viewer: freed when it moves on
        return evict(r);
      });
    }).catch(function () { tile.classList.add("no-thumb"); }).then(function () {
      tile.classList.remove("fetching");
      cloudRunning = false;
      pumpCloud();
    });
  }
  function evict(r) {
    var v = vault();
    if (!r.cloud || !v || typeof v.evict !== "function") return Promise.resolve();
    return v.evict(r.k).catch(function () {});
  }

  // ---------- place in the tree ----------
  function setMode(on) {
    active = on;
    document.body.classList.toggle("ph-mode", on);
    saveView();
  }
  function treeNode() {
    var wrap = el("div", "dbx-tree ph-tree");
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.appendChild(el("span", "caret empty"));
    var g = el("span", "glyph");
    g.innerHTML = ICON.photo;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("ph.tree")));
    function open() {
      if (ctx && ctx.closeDrawer) ctx.closeDrawer();
      enter();
    }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }

  // ---------- panel ----------
  function ensurePanel() {
    if ($("ph-panel")) return;
    var bar = el("div", "dbx-bar ph-bar");
    bar.id = "ph-bar";
    bar.appendChild(el("strong", "ph-title", t("ph.tree")));
    var cnt = el("span", "ph-count");
    cnt.id = "ph-count";
    bar.appendChild(cnt);
    bar.appendChild(el("span", "ph-gap"));
    bar.appendChild(iconBtn("tool", ICON.minus, t("ph.smaller"), function () { zoom(-1); }));
    bar.appendChild(iconBtn("tool", ICON.plus, t("ph.bigger"), function () { zoom(1); }));
    var sel = iconBtn("tool", ICON.check, t("ph.select"), function () { setSelecting(!selecting); });
    sel.id = "ph-select";
    bar.appendChild(sel);
    var more = iconBtn("tool", ICON.more, t("ph.more"), function (e) { openMore(e.currentTarget); });
    more.id = "ph-more";
    more.setAttribute("aria-haspopup", "menu");
    bar.appendChild(more);
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel ph-panel");
    panel.id = "ph-panel";
    var msg = el("div", "ph-msg");
    msg.id = "ph-msg";
    msg.setAttribute("role", "status");
    panel.appendChild(msg);
    var body = el("div", "ph-body");
    var sc = el("div", "ph-scroll");
    sc.id = "ph-scroll";
    sc.tabIndex = -1;
    body.appendChild(sc);
    var years = el("nav", "ph-years");
    years.id = "ph-years";
    years.setAttribute("aria-label", t("ph.years"));
    body.appendChild(years);
    panel.appendChild(body);
    var sb = el("div", "ph-selbar");
    sb.id = "ph-selbar";
    sb.hidden = true;
    var sn = el("span", "ph-selcount");
    sn.id = "ph-selcount";
    sb.appendChild(sn);
    sb.appendChild(el("span", "ph-gap"));
    var bs = el("button", "", t("ph.send"));
    bs.type = "button"; bs.id = "ph-sel-send";
    bs.addEventListener("click", function () { sendPaths(pickedPaths()); });
    sb.appendChild(bs);
    var bt = el("button", "danger", t("ph.trash"));
    bt.type = "button"; bt.id = "ph-sel-trash";
    bt.addEventListener("click", function () { trashPaths(pickedPaths()); });
    sb.appendChild(bt);
    var bd = el("button", "primary", t("ph.done"));
    bd.type = "button";
    bd.addEventListener("click", function () { setSelecting(false); });
    sb.appendChild(bd);
    panel.appendChild(sb);
    var split = $("split");
    if (split) split.appendChild(panel);
    applySize();
  }

  function zoom(d) {
    view.size = Math.max(0, Math.min(SIZES.length - 1, view.size + d));
    applySize();
    saveView();
  }
  function applySize() {
    var sc = $("ph-scroll");
    if (sc) sc.style.setProperty("--ph-tile", SIZES[view.size] + "px");
  }

  function paintMsg() {
    var m = $("ph-msg"), cnt = $("ph-count");
    if (cnt) cnt.textContent = order.length === 1 ? t("ph.countOne") : order.length ? t("ph.count", { n: order.length }) : "";
    if (!m) return;
    m.innerHTML = "";
    m.hidden = false;
    if (scanning && !order.length) { m.textContent = t("ph.looking"); return; }
    if (!scanning && !order.length) {
      var box = el("div", "ph-empty");
      box.appendChild(el("strong", "", t("ph.empty.title")));
      box.appendChild(el("p", "", t("ph.empty.body")));
      m.appendChild(box);
      return;
    }
    if (metaLeft > 0) { m.textContent = t("ph.reading", { i: metaTotal - metaLeft, n: metaTotal }); return; }
    m.hidden = true;
  }

  function dayLabel(key) {
    if (key === "0000-00-00") return t("ph.noDate");
    var p = key.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (d.getTime() === today) return t("ph.today");
    if (d.getTime() === today - 86400000) return t("ph.yesterday");
    var o = { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" };
    if (+p[0] !== now.getFullYear()) o.year = "numeric";
    try { return d.toLocaleDateString(LOC, o); } catch (e) { return key; }
  }
  function monthLabel(key) {
    if (key === "0000-00") return t("ph.noDate");
    var p = key.split("-");
    try {
      return new Date(Date.UTC(+p[0], +p[1] - 1, 1)).toLocaleDateString(LOC, { month: "long", year: "numeric", timeZone: "UTC" });
    } catch (e) { return key; }
  }
  function fmtDur(ms) {
    var s = Math.round((ms || 0) / 1000), m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  function paint() {
    ensurePanel();
    paintMsg();
    var sc = $("ph-scroll");
    if (!sc) return;
    renderGen++;
    if (tileObs) tileObs.disconnect();
    if (moreObs) moreObs.disconnect();
    sc.innerHTML = "";
    rendered = 0;
    tileObs = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (list) {
      list.forEach(function (en) { if (en.isIntersecting) wantThumb(en.target); });
    }, { root: sc, rootMargin: "600px 0px" }) : null;
    var sentinel = el("div", "ph-more-sentinel");
    sentinel.id = "ph-sentinel";
    sc.appendChild(sentinel);
    moreObs = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (list) {
      list.forEach(function (en) { if (en.isIntersecting) renderMore(); });
    }, { root: sc, rootMargin: "1200px 0px" }) : null;
    renderMore();
    if (moreObs) moreObs.observe(sentinel);
    paintYears();
    paintSelBar();
  }

  // Adds the next CHUNK tiles under their month and day headings.
  function renderMore(until) {
    var sc = $("ph-scroll"), sentinel = $("ph-sentinel");
    if (!sc || !sentinel) return;
    var stop = Math.min(flat.length, Math.max(rendered + CHUNK, until || 0));
    var frag = document.createDocumentFragment();
    var lastDay = sc._lastDay || null, grid = sc._grid || null;
    for (var i = rendered; i < stop; i++) {
      var x = flat[i];
      if (!lastDay || lastDay.key !== x.d) {
        if (!lastDay || lastDay.m !== x.m) {
          var mh = el("h2", "ph-month", monthLabel(x.m));
          mh.id = "ph-m-" + x.m;
          frag.appendChild(mh);
        }
        var dh = el("h3", "ph-day", dayLabel(x.d));
        frag.appendChild(dh);
        grid = el("div", "ph-grid");
        frag.appendChild(grid);
        lastDay = { key: x.d, m: x.m };
      }
      grid.appendChild(tileFor(x.rec, i));
    }
    sc.insertBefore(frag, sentinel);
    sc._lastDay = lastDay; sc._grid = grid;
    rendered = stop;
    sentinel.hidden = rendered >= flat.length;
  }

  function tileFor(r, i) {
    var b = el("button", "ph-tile");
    b.type = "button";
    b._rec = r;
    b.dataset.i = String(i);
    b.dataset.key = thumbKey(r);
    b.setAttribute("aria-label", baseName(r.k));
    var ph = el("span", "ph-ph");
    ph.innerHTML = r.kind === "video" ? ICON.video : ICON.photo;
    b.appendChild(ph);
    if (r.kind === "video") {
      var vb = el("span", "ph-badge");
      vb.innerHTML = ICON.play;
      if (r.dur) vb.appendChild(document.createTextNode(" " + fmtDur(r.dur)));
      b.appendChild(vb);
    }
    if (r.cloud) {
      var cb = el("span", "ph-cloud");
      cb.innerHTML = ICON.cloud;
      cb.title = t("ph.cloud");
      b.appendChild(cb);
    }
    var ck = el("span", "ph-check");
    b.appendChild(ck);
    if (picked[r.k]) b.classList.add("picked");
    b.addEventListener("click", function () {
      if (selecting) { togglePick(b); return; }
      openViewer(+b.dataset.i);
    });
    longPress(b, function () { if (!selecting) setSelecting(true); togglePick(b); });
    var key = thumbKey(r);
    if (urls[key]) showThumb(b, key, null);
    else if (tileObs) tileObs.observe(b);
    else wantThumb(b);
    return b;
  }
  function longPress(node, fn) {
    var timer = 0, x = 0, y = 0, fired = false;
    node.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      fired = false; x = e.clientX; y = e.clientY;
      timer = setTimeout(function () { fired = true; fn(); }, 500);
    });
    function cancel() { clearTimeout(timer); }
    node.addEventListener("pointermove", function (e) { if (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10) cancel(); });
    node.addEventListener("pointerup", cancel);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("click", function (e) { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    node.addEventListener("contextmenu", function (e) { if (e.pointerType !== "mouse" && e.button !== 2) e.preventDefault(); });
  }

  function paintYears() {
    var nav = $("ph-years");
    if (!nav) return;
    nav.innerHTML = "";
    var seen = {};
    months.forEach(function (mo) {
      var y = mo.key.slice(0, 4);
      if (seen[y] || y === "0000") return;
      seen[y] = true;
      var b = el("button", "ph-year", y);
      b.type = "button";
      b.addEventListener("click", function () { jumpTo(mo.key); });
      nav.appendChild(b);
    });
    nav.hidden = Object.keys(seen).length < 2;
  }
  function jumpTo(monthKey) {
    var idx = -1;
    for (var i = 0; i < flat.length; i++) if (flat[i].m === monthKey) { idx = i; break; }
    if (idx < 0) return;
    if (idx >= rendered) renderMore(idx + CHUNK);
    var h = $("ph-m-" + monthKey);
    if (h) h.scrollIntoView({ block: "start" });
  }

  // ---------- selecting ----------
  function setSelecting(on) {
    selecting = on;
    if (!on) picked = {};
    document.body.classList.toggle("ph-selecting", on);
    var tiles = document.querySelectorAll(".ph-tile.picked");
    if (!on) for (var i = 0; i < tiles.length; i++) tiles[i].classList.remove("picked");
    var b = $("ph-select");
    if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
    paintSelBar();
  }
  function togglePick(tile) {
    var p = tile._rec.k;
    if (picked[p]) delete picked[p]; else picked[p] = true;
    tile.classList.toggle("picked", !!picked[p]);
    paintSelBar();
  }
  function pickedPaths() { return Object.keys(picked); }
  function paintSelBar() {
    var sb = $("ph-selbar");
    if (!sb) return;
    sb.hidden = !selecting;
    var n = pickedPaths().length;
    var c = $("ph-selcount");
    if (c) c.textContent = t("ph.selected", { n: n });
    var s = $("ph-sel-send"), tr = $("ph-sel-trash");
    if (s) s.disabled = !n || !shareApi();
    if (tr) tr.disabled = !n;
  }

  // ---------- actions ----------
  function shareApi() { return ctx && ctx.share ? ctx.share() : null; }
  function sendPaths(paths) {
    var api = shareApi();
    if (!api) return;
    var photos = paths.filter(function (p) { return recs[p] && recs[p].kind === "image" && !recs[p].cloud; })
      .slice(0, 200).map(function (p) { return { path: p, name: baseName(p) }; });
    if (!photos.length) { toast(t("ph.sendNone")); return; }
    api.open({ kind: "album", data: { t: "" }, photos: photos });
  }
  function confirmDlg(text, okText) {
    return new Promise(function (resolve) {
      var d = el("dialog", "ph-dlg");
      var f = el("div");
      f.appendChild(el("p", "", text));
      var row = el("menu", "dlg-row");
      var no = el("button", "", t("ph.cancel"));
      no.type = "button";
      no.addEventListener("click", function () { d.close(); });
      var yes = el("button", "danger", okText);
      yes.type = "button";
      yes.addEventListener("click", function () { d.close("yes"); });
      row.appendChild(no); row.appendChild(yes);
      f.appendChild(row);
      d.appendChild(f);
      document.body.appendChild(d);
      d.addEventListener("close", function () { resolve(d.returnValue === "yes"); d.remove(); });
      d.showModal();
      yes.focus();
    });
  }
  // Files' own Trash (ctx.trash = moveToTrash): the record first,
  // then the move; restorable for 30 days. A cloud-only file is
  // fetched first, so the Trash holds it like any other file.
  function trashPaths(paths) {
    paths = paths.filter(function (p) { return recs[p]; });
    if (!paths.length || !ctx || !ctx.trash) return Promise.resolve(0);
    var msg = paths.length === 1 ? t("ph.trashAskOne", { name: baseName(paths[0]) }) : t("ph.trashAsk", { n: paths.length });
    return confirmDlg(msg, t("ph.trash")).then(function (ok) {
      if (!ok) return 0;
      var n = 0, chain = Promise.resolve(), v = vault();
      paths.forEach(function (p) {
        chain = chain.then(function () {
          var r = recs[p];
          var pre = r && r.cloud && v && v.fetch ? v.fetch(p) : Promise.resolve();
          return pre.then(function () { return ctx.trash(p); }).then(function () {
            n++;
            delete recs[p];
            delete picked[p];
            dropRecs([p]);
          }, function () { toast(t("ph.trashFail", { name: baseName(p) })); });
        });
      });
      return chain.then(function () {
        if (n) toast(t("ph.trashed", { n: n }));
        if (ctx.onDiskChanged) ctx.onDiskChanged();
        rebuild();
        return n;
      });
    });
  }

  function openMore(anchor) {
    var old = $("ph-menu");
    if (old) { old.remove(); return; }
    var m = el("div", "dbx-menu ph-menu");
    m.id = "ph-menu";
    m.setAttribute("role", "menu");
    function item(label, fn) {
      var b = el("button", "", label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { m.remove(); fn(); });
      m.appendChild(b);
    }
    item(t("ph.rescan"), scan);
    item(t("ph.folders"), foldersDialog);
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 4) + "px";
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    var first = m.querySelector("button");
    if (first) first.focus();
    setTimeout(function () {
      document.addEventListener("click", function off(e) {
        if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", off, true); }
      }, true);
    }, 0);
    m.addEventListener("keydown", function (e) { if (e.key === "Escape") { m.remove(); anchor.focus(); } });
  }

  function foldersDialog() {
    var skip = (Array.isArray(view.skip) ? view.skip : CORE.SKIP).slice();
    var extra = (view.extra || []).slice();
    var d = el("dialog", "ph-dlg ph-folders");
    var f = el("div");
    f.appendChild(el("h3", "", t("ph.f.title")));
    f.appendChild(el("p", "hint", t("ph.f.body")));
    var list = el("div", "ph-flist");
    CORE.SKIP.forEach(function (name) {
      var lab = el("label", "ph-fitem");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = skip.indexOf(name) === -1;
      cb.addEventListener("change", function () {
        var i = skip.indexOf(name);
        if (cb.checked && i !== -1) skip.splice(i, 1);
        if (!cb.checked && i === -1) skip.push(name);
      });
      lab.appendChild(cb);
      lab.appendChild(el("span", "", name));
      list.appendChild(lab);
    });
    f.appendChild(list);
    f.appendChild(el("h4", "", t("ph.f.extra")));
    var ex = el("ul", "ph-extra");
    function paintExtra() {
      ex.innerHTML = "";
      extra.forEach(function (p, i) {
        var li = el("li");
        li.appendChild(el("span", "", p.slice(ROOT.length + 1) || "/"));
        var rm = iconBtn("tool", ICON.close, t("ph.f.remove", { name: baseName(p) }), function () { extra.splice(i, 1); paintExtra(); });
        li.appendChild(rm);
        ex.appendChild(li);
      });
    }
    paintExtra();
    f.appendChild(ex);
    var add = el("button", "ph-fadd", t("ph.f.add"));
    add.type = "button";
    add.addEventListener("click", function () {
      if (!ctx || !ctx.pickFolder) return;
      ctx.pickFolder(t("ph.f.pick"), t("ph.f.save")).then(function (p) {
        if (p && p.indexOf(ROOT + "/") === 0 && extra.indexOf(p) === -1 && extra.length < 50) { extra.push(p); paintExtra(); }
      });
    });
    if (ctx && ctx.pickFolder) f.appendChild(add);
    var row = el("menu", "dlg-row");
    var reset = el("button", "", t("ph.f.reset"));
    reset.type = "button";
    reset.addEventListener("click", function () { view.skip = null; view.extra = []; saveView(); d.close("save"); });
    var cancel = el("button", "", t("ph.cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", function () { d.close(); });
    var save = el("button", "primary", t("ph.f.save"));
    save.type = "button";
    save.addEventListener("click", function () {
      view.skip = skip; view.extra = extra; saveView();
      d.close("save");
    });
    row.appendChild(reset); row.appendChild(el("span", "ph-gap")); row.appendChild(cancel); row.appendChild(save);
    f.appendChild(row);
    d.appendChild(f);
    document.body.appendChild(d);
    d.addEventListener("close", function () {
      var saved = d.returnValue === "save";
      d.remove();
      if (saved) scan();
    });
    d.showModal();
  }

  // ---------- viewer ----------
  function openViewer(i) {
    if (!order[i]) return;
    if (!viewer) buildViewer();
    viewer.root.hidden = false;
    document.body.classList.add("ph-viewing");
    showAt(i);
    viewer.closeBtn.focus();
  }
  function buildViewer() {
    var root = el("div", "ph-viewer");
    root.id = "ph-viewer";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.tabIndex = -1;
    var top = el("div", "ph-vtop");
    var closeBtn = iconBtn("ph-vbtn", ICON.close, t("ph.close"), closeViewer);
    top.appendChild(closeBtn);
    var title = el("div", "ph-vtitle");
    top.appendChild(title);
    var editBtn = iconBtn("ph-vbtn", ICON.edit, t("ph.edit"), function () { editCurrent(); });
    var folderBtn = iconBtn("ph-vbtn", ICON.folder, t("ph.inFolder"), function () { inFolder(); });
    var sendBtn = iconBtn("ph-vbtn", ICON.send, t("ph.send"), function () { if (viewer.rec) sendPaths([viewer.rec.k]); });
    var infoBtn = iconBtn("ph-vbtn", ICON.info, t("ph.info"), function () { toggleInfo(); });
    var trashBtn = iconBtn("ph-vbtn", ICON.trash, t("ph.trash"), function () { trashCurrent(); });
    [editBtn, folderBtn, sendBtn, infoBtn, trashBtn].forEach(function (b) { top.appendChild(b); });
    root.appendChild(top);
    var stage = el("div", "ph-stage");
    root.appendChild(stage);
    var prev = iconBtn("ph-vnav prev", ICON.prev, t("ph.prev"), function () { step(-1); });
    var next = iconBtn("ph-vnav next", ICON.next, t("ph.next"), function () { step(1); });
    root.appendChild(prev); root.appendChild(next);
    var info = el("aside", "ph-info");
    info.hidden = true;
    root.appendChild(info);
    document.body.appendChild(root);
    viewer = { root: root, stage: stage, title: title, info: info, closeBtn: closeBtn, editBtn: editBtn,
               sendBtn: sendBtn, prev: prev, next: next, i: -1, rec: null, url: null, gen: 0, zoom: 1, fetched: null };
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeViewer(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "Delete") { e.preventDefault(); trashCurrent(); }
      else if (e.key === "i" && !e.ctrlKey && !e.metaKey) toggleInfo();
      else if (e.key === "Tab") trapTab(e);
    });
    swipe(stage);
  }
  function trapTab(e) {
    var f = viewer.root.querySelectorAll("button:not([hidden]):not([disabled]), video");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function swipe(stage) {
    var x0 = null, y0 = 0, panX = 0, panY = 0, sx = 0, sy = 0;
    stage.addEventListener("pointerdown", function (e) {
      x0 = e.clientX; y0 = e.clientY; sx = panX; sy = panY;
      if (viewer.zoom > 1) stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", function (e) {
      if (x0 === null || viewer.zoom <= 1) return;
      panX = sx + (e.clientX - x0); panY = sy + (e.clientY - y0);
      applyZoom(panX, panY);
    });
    stage.addEventListener("pointerup", function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (viewer.zoom > 1) return;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", function () { x0 = null; });
    stage.addEventListener("dblclick", function () {
      if (!viewer.rec || viewer.rec.kind !== "image") return;
      viewer.zoom = viewer.zoom > 1 ? 1 : 2.5;
      panX = panY = 0;
      applyZoom(0, 0);
    });
    viewer.resetPan = function () { panX = panY = 0; };
  }
  function applyZoom(x, y) {
    var img = viewer.stage.querySelector("img");
    if (!img) return;
    img.style.transform = viewer.zoom > 1 ? "translate(" + x + "px," + y + "px) scale(" + viewer.zoom + ")" : "";
    viewer.stage.classList.toggle("zoomed", viewer.zoom > 1);
  }
  function step(d) {
    if (!viewer || viewer.i < 0) return;
    var j = viewer.i + d;
    if (j < 0 || j >= order.length) return;
    showAt(j);
  }
  function releaseCurrent() {
    if (!viewer) return;
    var v = viewer.stage.querySelector("video");
    if (v) { try { v.pause(); } catch (e) {} v.removeAttribute("src"); try { v.load(); } catch (e2) {} }
    if (viewer.url) { URL.revokeObjectURL(viewer.url); viewer.url = null; }
    if (viewer.fetched) { evict(viewer.fetched); viewer.fetched = null; }
  }
  function showAt(i) {
    releaseCurrent();
    var r = order[i], gen = ++viewer.gen;
    viewer.i = i; viewer.rec = r; viewer.zoom = 1;
    if (viewer.resetPan) viewer.resetPan();
    viewer.stage.innerHTML = "";
    viewer.stage.classList.remove("zoomed");
    viewer.title.textContent = r.t ? fullDate(r.t) : baseName(r.k);
    viewer.prev.disabled = i <= 0;
    viewer.next.disabled = i >= order.length - 1;
    viewer.editBtn.hidden = r.kind !== "image";
    viewer.sendBtn.hidden = r.kind !== "image" || !shareApi();
    var fs = disk(), v = vault();
    var ready = Promise.resolve();
    if (r.cloud) {
      viewer.stage.appendChild(el("div", "ph-vmsg", t("ph.fetching")));
      ready = v && v.fetch ? v.fetch(r.k).then(function () { if (viewer.rec === r) viewer.fetched = r; else evict(r); }) : Promise.reject(new Error("no vault"));
    }
    ready.then(function () { return fs.read(r.k); }).then(function (blob) {
      if (gen !== viewer.gen) return;
      if (!r.read) readMeta(r, blob).then(function () { if (gen === viewer.gen) paintInfo(); });
      viewer.stage.innerHTML = "";
      var u = URL.createObjectURL(blob);
      viewer.url = u;
      if (r.kind === "video") {
        var vid = el("video");
        vid.controls = true; vid.playsInline = true; vid.preload = "metadata";
        vid.src = u;
        vid.onerror = function () { viewer.stage.innerHTML = ""; viewer.stage.appendChild(el("div", "ph-vmsg", t("ph.noPreview"))); };
        viewer.stage.appendChild(vid);
      } else {
        var img = el("img");
        img.alt = baseName(r.k);
        img.decoding = "async";
        img.onerror = function () { viewer.stage.innerHTML = ""; viewer.stage.appendChild(el("div", "ph-vmsg", t("ph.noPreview"))); };
        img.src = u;
        viewer.stage.appendChild(img);
      }
    }).catch(function () {
      if (gen !== viewer.gen) return;
      viewer.stage.innerHTML = "";
      viewer.stage.appendChild(el("div", "ph-vmsg", t(r.cloud ? "ph.fetchFail" : "ph.noPreview")));
    });
    paintInfo();
  }
  function fullDate(tm) {
    try {
      return new Date(tm).toLocaleString(LOC, { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    } catch (e) { return CORE.dayKey(tm); }
  }
  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function paintInfo() {
    if (!viewer || !viewer.rec) return;
    var r = viewer.rec, box = viewer.info;
    box.innerHTML = "";
    function row(k, v) {
      if (!v) return;
      var d = el("div", "ph-irow");
      d.appendChild(el("span", "k", t(k)));
      d.appendChild(el("span", "v", v));
      box.appendChild(d);
    }
    row("ph.i.name", baseName(r.k));
    row("ph.i.date", r.t ? fullDate(r.t) + " (" + t("ph.i.src." + (r.src || "file")) + ")" : t("ph.noDate"));
    row("ph.i.camera", r.cam || "");
    row("ph.i.dims", r.w && r.ht ? r.w + " × " + r.ht : "");
    row("ph.i.length", r.kind === "video" && r.dur ? fmtDur(r.dur) : "");
    row("ph.i.size", r.s ? fmtSize(r.s) : "");
    row("ph.i.place", typeof r.lat === "number" ? r.lat.toFixed(5) + ", " + r.lon.toFixed(5) : "");
    row("ph.i.folder", parentOf(r.k).slice(ROOT.length + 1) || "/");
  }
  function toggleInfo() {
    if (!viewer) return;
    viewer.info.hidden = !viewer.info.hidden;
    viewer.root.classList.toggle("info-on", !viewer.info.hidden);
  }
  function closeViewer() {
    if (!viewer) return;
    releaseCurrent();
    viewer.gen++;
    viewer.stage.innerHTML = "";
    viewer.root.hidden = true;
    document.body.classList.remove("ph-viewing");
    var tile = document.querySelector('.ph-tile[data-i="' + viewer.i + '"]');
    viewer.i = -1; viewer.rec = null;
    if (tile) tile.focus();
  }
  function editCurrent() {
    var r = viewer && viewer.rec, p = shell();
    if (!r || r.kind !== "image" || !p || typeof p.__orosOpenAt !== "function") return;
    if (viewer.fetched === r) viewer.fetched = null;    // Photo Lab reads it: keep it on the disk
    p.__orosOpenAt("photolab", { openFile: r.k });
  }
  function inFolder() {
    var r = viewer && viewer.rec;
    if (!r || !ctx || !ctx.openFile) return;
    if (viewer.fetched === r) viewer.fetched = null;
    closeViewer();
    ctx.openFile(r.k);
  }
  function trashCurrent() {
    var r = viewer && viewer.rec;
    if (!r) return;
    var i = viewer.i;
    if (viewer.fetched === r) viewer.fetched = null;
    trashPaths([r.k]).then(function (n) {
      if (!n || !viewer || viewer.root.hidden) return;
      if (!order.length) { closeViewer(); return; }
      showAt(Math.min(i, order.length - 1));
    });
  }

  // ---------- enter / leave ----------
  function enter() {
    if (ctx && ctx.onEnter) ctx.onEnter();
    setMode(true);
    ensurePanel();
    paint();
    scan();
    if (ctx && ctx.afterEnter) ctx.afterEnter();
  }
  function leave() {
    if (!active) return;
    scanGen++;
    renderGen++;
    flushSaves();
    if (viewer && !viewer.root.hidden) closeViewer();
    setSelecting(false);
    var m = $("ph-menu");
    if (m) m.remove();
    if (tileObs) { tileObs.disconnect(); tileObs = null; }
    if (moreObs) { moreObs.disconnect(); moreObs = null; }
    thumbJobs = []; cloudJobs = [];
    var sc = $("ph-scroll");
    if (sc) { sc.innerHTML = ""; sc._lastDay = null; sc._grid = null; }
    revokeAll();
    setMode(false);
  }

  function init(c) {
    ctx = c || {};
    var v = readView();
    if (v) {
      view.size = v.size >= 0 && v.size < SIZES.length ? v.size | 0 : 1;
      view.skip = Array.isArray(v.skip) ? v.skip.filter(function (x) { return typeof x === "string"; }).slice(0, 100) : null;
      view.extra = Array.isArray(v.extra) ? v.extra.filter(function (x) { return typeof x === "string" && x.indexOf(ROOT + "/") === 0; }).slice(0, 50) : [];
    }
    window.addEventListener("pagehide", flushSaves);
    if (v && v.on) enter();
  }

  window.OrosFilesPhotos = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    isActive: function () { return active; },
    refresh: function () { if (active) scan(); },
    t: t
  };
})();
