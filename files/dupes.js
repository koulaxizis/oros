// ============================================================
// orOS Files — dupes.js: "Duplicates", exact duplicate finder
// (DUPES-1, wave K1). A place in the Files tree (PLACE_GLOBALS),
// body.dp-mode. Loaded on demand by files.js loadDupes() with
// dupes-core.js and dupes.css, so a plain Files open stays inside its
// first-open budget.
//
// One click: the whole orOS disk, or a folder with its subfolders
// (context menu › Find duplicates here). No settings. The search
// (OrosDupesCore.find) compares bytes, never names: size → SHA-256 of
// the first 64 KB → SHA-256 of the whole file (cloud-only orOS Drive
// files: the vault manifest's hash, nothing is downloaded) → files
// over 256 MB chunk by chunk. Hashes are kept on this device only
// (IndexedDB oros-files-dupes, store "h", keyPath p, reused while the
// path, size and time are the same; in the factory-reset list).
//
// Results: groups, most space to win first; in each the copy that
// stays (keepOrder: a favourite / document / tagged / album file,
// then on this device, then the oldest, then the shortest path) is
// unticked, the others are ticked. A group can never have every copy
// ticked. Only "Move to Trash" (confirm) removes anything: right
// before each move the copy kept and the copy removed are read again
// and compared byte by byte (a cloud-only copy is fetched first and
// checked against the hash the vault holds); a copy that changed is
// left alone. Files' own Trash (ctx.trash), restorable for 30 days.
// ============================================================
(function () {
  "use strict";

  var CORE = window.OrosDupesCore;
  var ROOT = CORE.ROOT;
  var DB_NAME = "oros-files-dupes";
  var PAGE = 100;                       // groups drawn per "Show more"

  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "dp.tree":        "Duplicates",
      "dp.title":       "Duplicates",
      "dp.scope":       "in {f}",
      "dp.scopeAll":    "on the whole orOS disk",
      "dp.again":       "Search again",
      "dp.stop":        "Stop",
      "dp.listing":     "Looking through folders… {n} files",
      "dp.comparing":   "Comparing contents… {i} of {n} files",
      "dp.stopped":     "Stopped. Search again to finish.",
      "dp.none":        "No duplicates: no two files here have the same contents.",
      "dp.sumOne":      "1 group of duplicates. {b} can be freed.",
      "dp.sum":         "{g} groups of duplicates. {b} can be freed.",
      "dp.how":         "Identical means every byte is the same, whatever the names. In each group one copy stays (unticked); the ticked ones can go to the Trash.",
      "dp.copies":      "{n} copies · {s} each",
      "dp.stays":       "Stays",
      "dp.cloud":       "In the cloud only",
      "dp.open":        "Show in folder",
      "dp.preview":     "Preview",
      "dp.lastCopy":    "One copy of every file always stays.",
      "dp.more":        "Show more",
      "dp.picked":      "{n} ticked · {b}",
      "dp.trash":       "Move to Trash",
      "dp.trashAskOne": "Move 1 copy to the Trash? The copy that stays is checked byte by byte first. You can restore it from the Trash for 30 days.",
      "dp.trashAsk":    "Move {n} copies to the Trash? Each one is checked byte by byte against the copy that stays first. You can restore them from the Trash for 30 days.",
      "dp.cancel":      "Cancel",
      "dp.working":     "Checking and moving… {i} of {n}",
      "dp.trashed":     "{n} moved to the Trash.",
      "dp.changed":     "{n} left alone: they no longer match the copy that stays.",
      "dp.fail":        "“{name}” could not be moved to the Trash.",
      "dp.noDisk":      "The orOS disk is not available here.",
      "dp.details":     "Comparing pictures and sounds without their hidden details… {i} of {n}",
      "dp.sec.dir":     "Identical folders",
      "dp.sec.same":    "Identical files",
      "dp.sec.meta":    "Same picture or sound, other hidden details",
      "dp.dirHow":      "Every file in them is the same, byte for byte. The files of a folder that goes are not listed again below.",
      "dp.metaHow":     "The picture or sound is the same byte for byte; the hidden details differ (camera, date, place, tags). Nothing is ticked: tick what you do not need.",
      "dp.dirCopies":   "{n} folders · {f} files · {s} each",
      "dp.dirCopies1":  "{n} folders · 1 file · {s} each",
      "dp.versions":    "{n} versions",
      "dp.files":       "{n} files",
      "dp.file1":       "1 file",
      "dp.openDir":     "Open the folder",
      "dp.alike":       "Photos that look alike…",
      "dp.scopeDbx":    "in Dropbox {f}",
      "dp.scopeCmp":    "on this computer, {f}",
      "dp.noPlace":     "This place is not available here.",
      "dp.noDbx":       "The Dropbox could not be read. Open Dropbox in the folder list, sign in, and try again.",
      "dp.there":       "Comparing with the orOS disk… {i} of {n}",
      "dp.sec.there":   "Already on the orOS disk",
      "dp.thereDbx":    "The orOS disk has the same file, byte for byte (the copy marked “On the orOS disk” stays). Nothing is ticked: tick what can go from the Dropbox.",
      "dp.thereCmp":    "The orOS disk has the same file, byte for byte (the copy marked “On the orOS disk” stays). Nothing is ticked: tick what can go from this computer.",
      "dp.onDisk":      "On the orOS disk",
      "dp.trashDbx":    "Delete in Dropbox",
      "dp.trashAskDbx": "Delete {n} in the Dropbox? Each one is checked first: unchanged since the search, and the copy that stays still has the same content. Dropbox keeps deleted files for a while; restore them on dropbox.com.",
      "dp.trashAskCmp": "Move {n} to this computer's Trash? Each one is compared byte by byte with the copy that stays first. You can restore them from the computer's Trash."
    },
    el: {
      "dp.tree":        "Διπλότυπα",
      "dp.title":       "Διπλότυπα",
      "dp.scope":       "στο {f}",
      "dp.scopeAll":    "σε όλο τον δίσκο του orOS",
      "dp.again":       "Νέα αναζήτηση",
      "dp.stop":        "Διακοπή",
      "dp.listing":     "Ψάχνω στους φακέλους… {n} αρχεία",
      "dp.comparing":   "Συγκρίνω περιεχόμενα… {i} από {n} αρχεία",
      "dp.stopped":     "Διακόπηκε. Κάνε νέα αναζήτηση για να τελειώσει.",
      "dp.none":        "Δεν υπάρχουν διπλότυπα: κανένα αρχείο εδώ δεν έχει ίδιο περιεχόμενο με άλλο.",
      "dp.sumOne":      "1 ομάδα διπλότυπων. Μπορούν να ελευθερωθούν {b}.",
      "dp.sum":         "{g} ομάδες διπλότυπων. Μπορούν να ελευθερωθούν {b}.",
      "dp.how":         "Ίδια σημαίνει ότι κάθε byte είναι ίδιο, όποια κι αν είναι τα ονόματα. Σε κάθε ομάδα ένα αντίγραφο μένει (χωρίς σημάδι)· τα σημαδεμένα μπορούν να πάνε στον Κάδο.",
      "dp.copies":      "{n} αντίγραφα · {s} το καθένα",
      "dp.stays":       "Μένει",
      "dp.cloud":       "Μόνο στο cloud",
      "dp.open":        "Εμφάνιση στον φάκελο",
      "dp.preview":     "Προεπισκόπηση",
      "dp.lastCopy":    "Ένα αντίγραφο κάθε αρχείου μένει πάντα.",
      "dp.more":        "Περισσότερα",
      "dp.picked":      "{n} σημαδεμένα · {b}",
      "dp.trash":       "Μετακίνηση στον Κάδο",
      "dp.trashAskOne": "Να πάει 1 αντίγραφο στον Κάδο; Πρώτα συγκρίνεται byte προς byte με το αντίγραφο που μένει. Μπορείς να το επαναφέρεις από τον Κάδο για 30 ημέρες.",
      "dp.trashAsk":    "Να πάνε {n} αντίγραφα στον Κάδο; Πρώτα το καθένα συγκρίνεται byte προς byte με το αντίγραφο που μένει. Μπορείς να τα επαναφέρεις από τον Κάδο για 30 ημέρες.",
      "dp.cancel":      "Άκυρο",
      "dp.working":     "Ελέγχω και μετακινώ… {i} από {n}",
      "dp.trashed":     "{n} μετακινήθηκαν στον Κάδο.",
      "dp.changed":     "{n} δεν μετακινήθηκαν: δεν είναι πια ίδια με το αντίγραφο που μένει.",
      "dp.fail":        "Το «{name}» δεν μετακινήθηκε στον Κάδο.",
      "dp.noDisk":      "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "dp.details":     "Συγκρίνω εικόνες και ήχους χωρίς τα κρυφά τους στοιχεία… {i} από {n}",
      "dp.sec.dir":     "Ίδιοι φάκελοι",
      "dp.sec.same":    "Ίδια αρχεία",
      "dp.sec.meta":    "Ίδια εικόνα ή ήχος, άλλα κρυφά στοιχεία",
      "dp.dirHow":      "Κάθε αρχείο τους είναι ίδιο, byte προς byte. Τα αρχεία ενός φακέλου που φεύγει δεν ξαναγράφονται πιο κάτω.",
      "dp.metaHow":     "Η εικόνα ή ο ήχος είναι ίδια byte προς byte· διαφέρουν τα κρυφά στοιχεία (κάμερα, ημερομηνία, τοποθεσία, ετικέτες). Τίποτα δεν είναι σημαδεμένο: σημάδεψε όσα δεν χρειάζεσαι.",
      "dp.dirCopies":   "{n} φάκελοι · {f} αρχεία · {s} ο καθένας",
      "dp.dirCopies1":  "{n} φάκελοι · 1 αρχείο · {s} ο καθένας",
      "dp.versions":    "{n} εκδοχές",
      "dp.files":       "{n} αρχεία",
      "dp.file1":       "1 αρχείο",
      "dp.openDir":     "Άνοιγμα του φακέλου",
      "dp.alike":       "Φωτογραφίες που μοιάζουν…",
      "dp.scopeDbx":    "στο Dropbox {f}",
      "dp.scopeCmp":    "σε αυτόν τον υπολογιστή, {f}",
      "dp.noPlace":     "Αυτή η θέση δεν είναι διαθέσιμη εδώ.",
      "dp.noDbx":       "Το Dropbox δεν διαβάστηκε. Άνοιξε το Dropbox στη λίστα φακέλων, συνδέσου και δοκίμασε ξανά.",
      "dp.there":       "Σύγκριση με τον δίσκο του orOS… {i} από {n}",
      "dp.sec.there":   "Υπάρχουν ήδη στον δίσκο του orOS",
      "dp.thereDbx":    "Ο δίσκος του orOS έχει το ίδιο αρχείο, byte προς byte (το αντίγραφο με την ένδειξη «Στον δίσκο του orOS» μένει). Τίποτα δεν είναι σημαδεμένο: σημάδεψε όσα μπορούν να φύγουν από το Dropbox.",
      "dp.thereCmp":    "Ο δίσκος του orOS έχει το ίδιο αρχείο, byte προς byte (το αντίγραφο με την ένδειξη «Στον δίσκο του orOS» μένει). Τίποτα δεν είναι σημαδεμένο: σημάδεψε όσα μπορούν να φύγουν από αυτόν τον υπολογιστή.",
      "dp.onDisk":      "Στον δίσκο του orOS",
      "dp.trashDbx":    "Διαγραφή στο Dropbox",
      "dp.trashAskDbx": "Να διαγραφούν {n} στο Dropbox; Πρώτα ελέγχεται το καθένα: ότι δεν άλλαξε από την αναζήτηση και ότι το αντίγραφο που μένει έχει ακόμη το ίδιο περιεχόμενο. Το Dropbox κρατά τα διαγραμμένα για λίγο καιρό· η επαναφορά γίνεται στο dropbox.com.",
      "dp.trashAskCmp": "Να πάνε {n} στον Κάδο του υπολογιστή; Πρώτα το καθένα συγκρίνεται byte προς byte με το αντίγραφο που μένει. Μπορείς να τα επαναφέρεις από τον Κάδο του υπολογιστή."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var SVG = function (body) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  var ICON = {
    dupes:  SVG('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>'),
    again:  SVG('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    folder: SVG('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
    cloud:  SVG('<path d="M18 10h-1.3A7 7 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>')
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function dirName(p) { return p.slice(0, p.lastIndexOf("/")) || ROOT; }
  function shown(p) {
    if (p === ROOT) return "/";
    if (p.indexOf(ROOT + "/") === 0) return p.slice(ROOT.length);
    if (p.indexOf("dbx:") === 0) return p.slice(4) || "/";
    if (p.indexOf("/computer") === 0) return p.slice(9) || "/";
    return p;
  }
  function fmtBytes(n) {
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0, v = n || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    var d = i === 0 || v >= 100 ? 0 : 1;
    try { return v.toLocaleString(LOC, { maximumFractionDigits: d }) + " " + u[i]; } catch (e) { return v.toFixed(d) + " " + u[i]; }
  }
  function fmtDate(m) {
    if (!(m > 0)) return "";
    try { return new Date(m < 1e11 ? m * 1000 : m).toLocaleDateString(LOC, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; }
  }

  var ctx = null;
  var active = false;
  var base = ROOT;                      // the folder searched
  var place = "disk";                   // "disk" | "computer" | "dropbox" (K3)
  var src = null;                       // ctx.source(place) for computer / dropbox
  var gen = 0;                          // a new search or leave stops the old one
  var state = null;                     // { phase, n, i, groups, picked, limit, busy }

  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  function vault() { return ctx && ctx.vault ? ctx.vault() : null; }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }

  // ---------- hash cache (device-local IndexedDB) ----------
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("h", { keyPath: "p" }); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbP;
  }
  function cacheGet(p) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try {
          var r = d.transaction("h").objectStore("h").get(p);
          r.onsuccess = function () { res(r.result || null); };
          r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function cachePut(rec) {
    return db().then(function (d) {
      if (!d) return;
      try { d.transaction("h", "readwrite").objectStore("h").put(rec); } catch (e) {}
    });
  }

  // ---------- reading ----------
  function sha(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(CORE.hex);
  }
  // Paths say where a file is: "/internal/…" the orOS disk,
  // "/computer/…" This computer, "dbx:/…" the Dropbox (never read here:
  // Dropbox gives its content_hash).
  function isCmp(p) { return p.indexOf("/computer/") === 0; }
  function isDbx(p) { return p.indexOf("dbx:") === 0; }
  function blobOf(p) { return isCmp(p) ? src.blob(p) : disk().read(p); }
  function statOf(p) { return isCmp(p) ? src.stat(p) : disk().stat(p); }
  function readPart(f, off, n) {
    if (isCmp(f.p)) return src.read(f.p, off, n);
    return blobOf(f.p).then(function (b) { return b.slice(off, off + n).arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
  }
  // head / full SHA-256, from the cache while path, size and time hold.
  function hashed(f, field, work, any) {
    return cacheGet(f.p).then(function (rec) {
      if (CORE.cacheOk(rec, f) && (any ? typeof rec[field] === "string" && rec[field] : CORE.isHash(rec[field]))) return rec[field];
      return work().then(function (h) {
        var next = CORE.cacheOk(rec, f) ? rec : { p: f.p, s: f.s, m: f.m };
        next[field] = h;
        if (f.m > 0) cachePut(next);
        return h;
      });
    });
  }
  function headHash(f) {
    return hashed(f, "q", function () {
      return readPart(f, 0, Math.min(CORE.HEAD, f.s)).then(sha);
    });
  }
  function fullHash(f) {
    return hashed(f, "h", function () {
      return blobOf(f.p).then(function (b) { return b.arrayBuffer(); }).then(sha);
    });
  }

  // ---------- walk ----------
  function walk(g, onCount, from) {
    from = from || base;
    var live0 = function () { return g === gen; };
    if (isCmp(from) || isDbx(from)) {
      return src.list(from, false, live0, onCount).then(function (l) {
        return (l || []).filter(function (f) { return CORE.wanted(f.p, f.s, from); });
      });
    }
    var fs = disk(), found = [], dirs = [from], seen = 0;
    function live() { return g === gen; }
    function next() {
      if (!live() || !dirs.length || found.length >= CORE.MAX_FILES || seen >= CORE.MAX_DIRS) return Promise.resolve();
      var d = dirs.shift();
      seen++;
      return fs.ls(d).then(function (list) {
        (list || []).forEach(function (e) {
          if (!e || typeof e.name !== "string" || !e.name) return;
          var p = d + "/" + e.name;
          if (e.dir) { if (!CORE.skipDir(p)) dirs.push(p); }
          else if (e.name.charAt(0) !== ".") found.push({ p: p, s: e.size || 0, m: e.mtime || 0 });
        });
        if (onCount) onCount(found.length);
      }, function () {}).then(next);
    }
    // The browser disk (OPFS) lists names only: size and time from a stat.
    function stats() {
      var todo = found.filter(function (f) { return !f.s && !f.m; }), i = 0;
      function worker() {
        if (!live() || i >= todo.length) return Promise.resolve();
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
        var dr = v.driveRoot || ROOT + "/Drive";
        var at = from.indexOf(dr + "/") === 0 || from === dr ? from : dr;
        if (at === from || dr.indexOf(from + "/") === 0) {
          try {
            (v.remoteOnly(at) || []).forEach(function (e) {
              if (e && !have[e.path] && found.length < CORE.MAX_FILES) found.push({ p: e.path, s: e.s || 0, m: e.m ? Date.parse(e.m) || 0 : 0, h: e.h || "", cloud: true });
            });
          } catch (e2) {}
        }
      }
      return found.filter(function (f) { return CORE.wanted(f.p, f.s, from); });
    });
  }

  // ---------- search ----------
  function search() {
    var g = ++gen, fs = disk();
    state = { phase: "walk", n: 0, i: 0, groups: null, picked: {}, limit: PAGE, busy: false };
    paint();
    if (!fs || !window.crypto || !crypto.subtle || (place !== "disk" && !src)) { state.phase = "nodisk"; paint(); return; }
    function live() { return g === gen; }
    var painted = 0;
    function throttled() { var now = Date.now(); if (now - painted > 250) { painted = now; paintMsg(); } }
    var all = [];
    walk(g, function (n) { state.n = n; throttled(); }).then(function (files) {
      if (!live()) return null;
      all = files;
      if (place === "disk") files.forEach(function (f) { f.imp = ctx.important ? !!ctx.important(f.p) : false; });
      if (place === "dropbox") {
        // Dropbox lists every file with its content_hash: nothing to read.
        files.forEach(function (f) { f.k = CORE.isHash(f.h) ? "x:" + f.h : ""; });
        return CORE.groups(files.filter(function (f) { return f.k; }));
      }
      state.phase = "compare";
      state.i = 0;
      state.n = CORE.bySize(files).reduce(function (a, x) { return a + x.length; }, 0);
      paintMsg();
      return CORE.find(files, {
        head: headHash, hash: fullHash, read: readPart, live: live,
        tick: function () { state.i++; throttled(); }
      });
    }).then(function (groups) {
      if (!live() || !groups) return null;
      var dirs = CORE.folderTwins(all, base);
      var same = CORE.outsideFolders(groups, dirs);
      var there = [];
      return thereStage(all, live, throttled).then(function (th) {
        there = CORE.outsideFolders(th || [], dirs);
        return place === "dropbox" ? [] : metaStage(all, live, throttled);
      }).then(function (meta) {
        if (!live()) return;
        state.phase = "done";
        state.groups = dirs.concat(same, there, CORE.outsideFolders(meta || [], dirs));
        state.picked = CORE.defaultPicks(state.groups);
        paint();
      });
    }).then(null, function () {
      if (!live()) return;
      state.phase = place === "dropbox" ? "noplace" : "done";
      state.groups = state.phase === "done" ? [] : null;
      paint();
    });
  }
  // K2: pictures and sounds that differ only in hidden details. A
  // cheap first key from a few bytes (JPEG scan length, MP3 sound
  // length, PNG IHDR, WebP VP8X canvas); only files that share one
  // are read whole, cleaned (clean-core) and hashed. Local files only.
  function cleanCore() {
    if (window.orosClean) return Promise.resolve(window.orosClean);
    return ctx && ctx.cleanCore ? ctx.cleanCore() : Promise.reject(new Error("clean"));
  }
  function bytesAt(f, off, n) {
    var a = off < 0 ? Math.max(0, f.s + off) : off;
    return readPart(f, a, Math.max(0, Math.min(n, f.s - a)));
  }
  function hexOf(u) { var s2 = ""; for (var i = 0; i < u.length; i++) s2 += (u[i] < 16 ? "0" : "") + u[i].toString(16); return s2; }
  function preKey(f) {
    return hashed(f, "z", function () {
      if (f.kind === "jpeg") return bytesAt(f, 0, CORE.JPEG_HEAD).then(function (h) { var n = CORE.jpegScanLen(h, f.s); return n > 0 ? "j" + n : "-"; });
      if (f.kind === "mp3") return Promise.all([bytesAt(f, 0, 10), f.s >= 128 ? bytesAt(f, -128, 128) : Promise.resolve(null)]).then(function (r) {
        var rg = CORE.mp3Range(r[0], r[1], f.s);
        return rg ? "m" + (rg[1] - rg[0]) : "-";
      });
      return bytesAt(f, 0, 40).then(function (h) {
        if (f.kind === "png") return h.length >= 29 && h[12] === 0x49 && h[13] === 0x48 ? "p" + hexOf(h.subarray(16, 29)) : "-";
        // A WebP without VP8X cannot hold EXIF or XMP.
        return h.length >= 30 && h[12] === 0x56 && h[15] === 0x58 ? "w" + hexOf(h.subarray(24, 30)) : "-";
      });
    }, true);
  }
  function contentHash(f, fresh) {
    function work() {
      return cleanCore().then(function (C) {
        return blobOf(f.p).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
          var out = CORE.stripped(f.kind, new Uint8Array(ab), C);
          return out ? sha(out) : "-";
        });
      });
    }
    return fresh ? work() : hashed(f, "c", work, true);
  }
  function metaStage(files, live, throttled) {
    var cand = files.filter(function (f) { f.kind = CORE.metaKind(f.p); return f.kind && !f.cloud && f.s <= CORE.META_MAX; });
    if (cand.length < 2) return Promise.resolve([]);
    state.phase = "details";
    state.i = 0; state.n = cand.length;
    paintMsg();
    function seq(list, fn) {
      return list.reduce(function (pr, x) { return pr.then(function () { return live() ? fn(x) : null; }); }, Promise.resolve());
    }
    return seq(cand, function (f) {
      return preKey(f).then(function (z) { f.pre = z !== "-" ? f.kind + z : ""; }, function () { f.pre = ""; })
        .then(function () { state.i++; throttled(); });
    }).then(function () {
      var groupsPre = CORE.splitBy(cand, function (f) { return f.pre; }).filter(function (g) {
        var ks = {};
        g.forEach(function (f) { ks[f.k || "p:" + f.p] = true; });
        return Object.keys(ks).length > 1;
      });
      var todo = [];
      groupsPre.forEach(function (g) { todo = todo.concat(g); });
      state.i = 0; state.n = todo.length;
      paintMsg();
      return seq(todo, function (f) {
        return contentHash(f).then(function (c) { f.c = CORE.isHash(c) ? c : ""; }, function () { f.c = ""; })
          .then(function () { state.i++; throttled(); });
      }).then(function () { return live() ? CORE.metaGroups(todo) : []; });
    }).catch(function () { return []; });
  }

  // K3: files of This computer / the Dropbox that the orOS disk
  // already holds, byte for byte. The disk side is walked whole; only
  // sizes the other place shares are hashed (SHA-256 for This computer,
  // Dropbox's content hash for the Dropbox; cloud-only disk files by
  // the vault's SHA-256 for This computer only). Never pre-ticked.
  function diskKey(d) {
    if (d.kx !== undefined) return Promise.resolve(d.kx);
    var job;
    if (place === "dropbox") {
      job = d.cloud ? Promise.resolve("") : hashed(d, "x", function () {
        return blobOf(d.p).then(function (b) { return b.arrayBuffer(); }).then(function (ab) { return ctx.dbxHash(new Uint8Array(ab)); });
      });
    } else job = d.cloud ? Promise.resolve(CORE.isHash(d.h) ? d.h : "") : d.s > CORE.HASH_MAX ? Promise.resolve("") : fullHash(d);
    return job.then(function (k) { d.kx = k || ""; return d.kx; }, function () { d.kx = ""; return ""; });
  }
  function thereStage(others, live, throttled) {
    if (place === "disk") return Promise.resolve([]);
    state.phase = "there";
    state.i = 0; state.n = 0;
    paintMsg();
    return walk(gen, null, ROOT).then(function (diskFiles) {
      var bySize = {};
      diskFiles.forEach(function (d) { (bySize[d.s] = bySize[d.s] || []).push(d); });
      var cands = others.filter(function (f) { return bySize[f.s] && (place === "dropbox" ? CORE.isHash(f.h) : f.s <= CORE.HASH_MAX); });
      state.n = cands.length;
      var found = {};
      function seq(list, fn) {
        return list.reduce(function (pr, x) { return pr.then(function () { return live() ? fn(x) : null; }); }, Promise.resolve());
      }
      return seq(cands, function (f) {
        var mine = place === "dropbox" ? Promise.resolve(f.h) : fullHash(f);
        return mine.then(function (hf) {
          if (!CORE.isHash(hf)) return null;
          var list = bySize[f.s].slice().sort(CORE.keepOrder), hit = null;
          return seq(list, function (d) {
            if (hit) return null;
            return diskKey(d).then(function (k) { if (k && k === hf) hit = d; });
          }).then(function () {
            if (!hit) return;
            var g = found[hit.p] || (found[hit.p] = { kind: "there", k: "t:" + hit.p, s: hit.s, items: [{ p: hit.p, s: hit.s, m: hit.m, h: hit.h, cloud: hit.cloud, fixed: true }] });
            g.items.push(f);
          });
        }, function () {}).then(function () { state.i++; throttled(); });
      }).then(function () {
        if (!live()) return [];
        var out = Object.keys(found).map(function (k) {
          var g = found[k];
          g.waste = CORE.wasteOf("there", g.items, g.s);
          return g;
        });
        out.sort(function (a, b) { return b.waste - a.waste || (a.items[0].p < b.items[0].p ? -1 : 1); });
        return out;
      });
    });
  }

  function stop() {
    gen++;
    if (state) { state.phase = "stopped"; paint(); }
  }

  // ---------- moving to the Trash ----------
  function itemOf(g, p) {
    for (var i = 0; i < g.items.length; i++) if (g.items[i].p === p) return g.items[i];
    return null;
  }
  // The copy kept and the copy removed, read again right now.
  function stillSame(x, keep, k) {
    if (isDbx(x.p)) return stillSameDbx(x, keep);
    var v = vault();
    var fetched = false;
    var pre = x.cloud && v && typeof v.fetch === "function"
      ? v.fetch(x.p).then(function () { fetched = true; })
      : Promise.resolve();
    function back(ok) {
      if (!ok && fetched && v && typeof v.evict === "function") v.evict(x.p).catch(function () {});
      return ok;
    }
    return pre.then(function () {
      return Promise.all([statOf(x.p), keep.cloud ? Promise.resolve({ size: keep.s }) : statOf(keep.p)]);
    }).then(function (st) {
      if (!st[0] || !st[1] || st[0].dir || st[1].dir || st[0].size !== x.s || st[1].size !== x.s) return false;
      var now = { p: x.p, s: x.s };
      if (keep.cloud) {
        var e = v && typeof v.manifestEntry === "function" ? v.manifestEntry(keep.p) : null;
        if (!e || e.h !== keep.h || (k && k.indexOf("b:") !== 0 && e.h !== k)) return false;
        return blobOf(x.p).then(function (b) { return b.arrayBuffer(); }).then(sha).then(function (h) { return h === e.h; });
      }
      return CORE.sameFiles({ p: keep.p, s: x.s }, now, readPart);
    }).then(back, function () { return back(false); });
  }
  // A Dropbox copy: unchanged since it was listed (same rev and
  // content hash), and the copy that stays still holds that content
  // (another Dropbox file by its metadata, a disk file by a fresh
  // Dropbox content hash of its bytes). delete_v2 then takes the rev.
  function stillSameDbx(x, keep) {
    return src.meta(x.p).then(function (m) {
      if (!m || m.rev !== x.rev || m.h !== x.h || !CORE.isHash(x.h)) return false;
      if (isDbx(keep.p)) return src.meta(keep.p).then(function (k) { return !!k && k.h === x.h; });
      if (keep.cloud) return false;
      return statOf(keep.p).then(function (st) {
        if (!st || st.dir || st.size !== x.s) return false;
        return blobOf(keep.p).then(function (b) { return b.arrayBuffer(); }).then(function (ab) { return ctx.dbxHash(new Uint8Array(ab)); })
          .then(function (h) { return h === x.h; });
      });
    }).catch(function () { return false; });
  }
  function removeOne(x) {
    if (isDbx(x.p) || isCmp(x.p)) return src.remove(x);
    return ctx.trash(x.p);
  }
  // Pictures and sounds: the same content without the details, now.
  function stillSameContent(x, keep) {
    return Promise.all([statOf(x.p), statOf(keep.p)]).then(function (st) {
      if (!st[0] || !st[1] || st[0].dir || st[1].dir || st[0].size !== x.s || st[1].size !== keep.s) return false;
      return Promise.all([contentHash(x, true), contentHash(keep, true)]).then(function (h) {
        return CORE.isHash(h[0]) && h[0] === h[1];
      });
    }).catch(function () { return false; });
  }
  // Every file under a folder, hidden and empty ones too, plus its
  // cloud-only orOS Drive files: rel path → { p, s, h?, cloud }.
  function listAll(dir) {
    if (isDbx(dir) || isCmp(dir)) {
      return src.list(dir, true).then(function (l) {
        var o = {};
        (l || []).forEach(function (f) { o[f.p.slice(dir.length + 1)] = { p: f.p, s: f.s, h: f.h || "", rev: f.rev || "", dbx: isDbx(f.p) }; });
        return o;
      });
    }
    var fs = disk(), v = vault(), out = {}, dirs = [dir], n = 0;
    function next() {
      if (!dirs.length) return Promise.resolve();
      if (++n > CORE.MAX_DIRS) return Promise.reject(new Error("big"));
      var d = dirs.shift();
      return fs.ls(d).then(function (list) {
        var stats = [];
        (list || []).forEach(function (e) {
          if (!e || !e.name) return;
          var p = d + "/" + e.name;
          if (e.dir) dirs.push(p);
          else stats.push(fs.stat(p).then(function (st) { out[p.slice(dir.length + 1)] = { p: p, s: st ? st.size || 0 : -1 }; }));
        });
        return Promise.all(stats);
      }).then(next);
    }
    return next().then(function () {
      if (v && typeof v.remoteOnly === "function") {
        (v.remoteOnly(dir) || []).forEach(function (e) {
          if (e && e.path && e.path.indexOf(dir + "/") === 0) {
            var rel = e.path.slice(dir.length + 1);
            if (!out[rel]) out[rel] = { p: e.path, s: e.s || 0, h: e.h || "", cloud: true };
          }
        });
      }
      return out;
    });
  }
  function freshHash(f) {
    if (f.cloud) return Promise.resolve(CORE.isHash(f.h) ? f.h : "");
    if (f.s > CORE.HASH_MAX) return Promise.resolve("");
    return blobOf(f.p).then(function (b) { return b.arrayBuffer(); }).then(sha);
  }
  // Folders: the same files (names, sizes, every byte) on both sides.
  function stillSameFolder(x, keep) {
    return Promise.all([listAll(x.p), listAll(keep.p)]).then(function (r) {
      var a = r[0], b = r[1], names = Object.keys(a);
      if (!names.length || names.length !== Object.keys(b).length) return false;
      for (var i = 0; i < names.length; i++) {
        var q = b[names[i]];
        if (!q || q.s !== a[names[i]].s || q.s < 0) return false;
      }
      return names.reduce(function (pr, rel) {
        return pr.then(function (ok) {
          if (!ok) return false;
          var f1 = a[rel], f2 = b[rel];
          if (f1.dbx || f2.dbx) return CORE.isHash(f1.h) && f1.h === f2.h;
          if (!f1.cloud && !f2.cloud) return f1.s === 0 ? true : CORE.sameFiles(f1, f2, readPart);
          return Promise.all([freshHash(f1), freshHash(f2)]).then(function (h) { return CORE.isHash(h[0]) && h[0] === h[1]; });
        });
      }, Promise.resolve(true));
    }).catch(function () { return false; });
  }
  function confirmDlg(text, okText) {
    return new Promise(function (resolve) {
      var d = el("dialog", "dp-dlg");
      var f = el("div");
      f.appendChild(el("p", "", text));
      var row = el("menu", "dlg-row");
      var no = el("button", "", t("dp.cancel"));
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
      no.focus();
    });
  }
  function trashLabel() { return t(place === "dropbox" ? "dp.trashDbx" : "dp.trash"); }
  function trashPicked() {
    if (!state || !state.groups || state.busy || !ctx || !ctx.trash) return;
    var todo = CORE.plan(state.groups, state.picked);
    if (!todo.length) return;
    var msg = place === "dropbox" ? t("dp.trashAskDbx", { n: todo.length })
      : place === "computer" ? t("dp.trashAskCmp", { n: todo.length })
      : todo.length === 1 ? t("dp.trashAskOne") : t("dp.trashAsk", { n: todo.length });
    confirmDlg(msg, trashLabel()).then(function (ok) {
      if (!ok || !state || state.busy) return;
      var g0 = gen, st = state;
      st.busy = true;
      st.i = 0; st.n = todo.length;
      paintMsg();
      paintBar();
      var gone = {}, moved = 0, changed = 0;
      function goneWith(p) {
        if (gone[p]) return true;
        for (var q in gone) if (p.indexOf(q + "/") === 0) return true;
        return false;
      }
      var chain = Promise.resolve();
      todo.forEach(function (it) {
        chain = chain.then(function () {
          if (g0 !== gen) return null;
          var g = st.groups[it.gi], x = g && itemOf(g, it.p), keep = g && itemOf(g, it.keep);
          if (x && goneWith(x.p)) return null;                  // went with its folder
          if (!x || !keep || goneWith(keep.p)) { changed++; return null; }
          var check = g.kind === "dir" ? stillSameFolder(x, keep) : g.kind === "meta" ? stillSameContent(x, keep) : stillSame(x, keep, g.k);
          return check.then(function (same) {
            if (!same) { changed++; return null; }
            return removeOne(x).then(function () { gone[x.p] = true; moved++; },
              function () { toast(t("dp.fail", { name: baseName(x.p) })); });
          });
        }).then(function () { st.i++; paintMsg(); });
      });
      chain.then(function () {
        st.busy = false;
        if (g0 !== gen) return;
        st.groups = CORE.without(st.groups, gone);
        Object.keys(gone).forEach(function (p) { delete st.picked[p]; });
        // Picks of a group that lost copies some other way are made safe again.
        st.groups.forEach(function (g) {
          if (!g.items.some(function (x) { return !st.picked[x.p]; })) delete st.picked[g.items[0].p];
        });
        var lines = [];
        if (moved) lines.push(t("dp.trashed", { n: moved }));
        if (changed) lines.push(t("dp.changed", { n: changed }));
        if (lines.length) toast(lines.join(" "));
        if (moved && ctx.onDiskChanged) ctx.onDiskChanged();
        // A copy that changed makes its group stale: search again
        // (quick: the other hashes are cached).
        if (changed) search(); else paint();
      });
    });
  }

  // ---------- painting ----------
  function ensurePanel() {
    if ($("dp-panel")) return;
    var bar = el("div", "dbx-bar dp-bar");
    bar.id = "dp-bar";
    var ttl = el("strong", "dp-title", t("dp.title"));
    bar.appendChild(ttl);
    var sc = el("span", "dp-scope");
    sc.id = "dp-scope";
    bar.appendChild(sc);
    bar.appendChild(el("span", "dp-gap"));
    var again = el("button", "tool");
    again.type = "button";
    again.id = "dp-again";
    again.innerHTML = ICON.again;
    again.title = t("dp.again");
    again.setAttribute("aria-label", t("dp.again"));
    again.addEventListener("click", function () { if (!state || !state.busy) search(); });
    bar.appendChild(again);
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel dp-panel");
    panel.id = "dp-panel";
    var msg = el("div", "dp-msg");
    msg.id = "dp-msg";
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    panel.appendChild(msg);
    var list = el("div", "dp-list");
    list.id = "dp-list";
    panel.appendChild(list);
    var sb = el("div", "dp-selbar");
    sb.id = "dp-selbar";
    sb.hidden = true;
    var cnt = el("span", "dp-selcount");
    cnt.id = "dp-selcount";
    sb.appendChild(cnt);
    sb.appendChild(el("span", "dp-gap"));
    var bt = el("button", "danger", t("dp.trash"));
    bt.type = "button";
    bt.id = "dp-trash";
    bt.addEventListener("click", trashPicked);
    sb.appendChild(bt);
    panel.appendChild(sb);
    var split = $("split");
    if (split) split.appendChild(panel);
  }
  function paintMsg() {
    var m = $("dp-msg");
    if (!m || !state) return;
    m.innerHTML = "";
    var line = "";
    if (state.busy) line = t("dp.working", { i: Math.min(state.i + 1, state.n), n: state.n });
    else if (state.phase === "walk") line = t("dp.listing", { n: state.n });
    else if (state.phase === "compare") line = t("dp.comparing", { i: Math.min(state.i, state.n), n: state.n });
    else if (state.phase === "details") line = t("dp.details", { i: Math.min(state.i, state.n), n: state.n });
    else if (state.phase === "stopped") line = t("dp.stopped");
    else if (state.phase === "nodisk") line = t(place === "disk" ? "dp.noDisk" : "dp.noPlace");
    else if (state.phase === "noplace") line = t("dp.noDbx");
    else if (state.phase === "there") line = t("dp.there", { i: Math.min(state.i, state.n), n: state.n });
    else if (state.groups) {
      var tot = CORE.totals(state.groups);
      line = !tot.groups ? t("dp.none") : tot.groups === 1 ? t("dp.sumOne", { b: fmtBytes(tot.waste) }) : t("dp.sum", { g: tot.groups, b: fmtBytes(tot.waste) });
    }
    m.appendChild(el("span", "", line));
    if (!state.busy && (state.phase === "walk" || state.phase === "compare" || state.phase === "details" || state.phase === "there")) {
      var b = el("button", "dp-stop", t("dp.stop"));
      b.type = "button";
      b.addEventListener("click", stop);
      m.appendChild(b);
      if ((state.phase === "compare" || state.phase === "details" || state.phase === "there") && state.n) {
        var pr = el("progress", "dp-prog");
        pr.max = state.n;
        pr.value = Math.min(state.i, state.n);
        m.appendChild(pr);
      }
    }
    if (state.phase === "done" && state.groups && state.groups.length && !state.busy) {
      m.appendChild(el("p", "dp-how", t("dp.how")));
    }
    // Photos that only look alike (bursts, retakes): Photos' own finder.
    if (state.phase === "done" && !state.busy && place === "disk" && ctx && ctx.photosAlike) {
      var al = el("button", "dp-stop dp-alike", t("dp.alike"));
      al.type = "button";
      al.addEventListener("click", function () { ctx.photosAlike(); });
      m.appendChild(al);
    }
  }
  function paintBar() {
    var sb = $("dp-selbar");
    if (!sb || !state) return;
    var has = state.phase === "done" && state.groups && state.groups.length;
    sb.hidden = !has;
    if (!has) return;
    var tot = CORE.totals(state.groups, state.picked);
    $("dp-selcount").textContent = t("dp.picked", { n: tot.picked, b: fmtBytes(tot.bytes) });
    $("dp-trash").disabled = !tot.picked || state.busy;
    var again = $("dp-again");
    if (again) again.disabled = !!state.busy;
  }
  function row(g, x) {
    var r = el("li", "dp-row");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!state.picked[x.p];
    cb.disabled = !!state.busy;
    cb.setAttribute("aria-label", baseName(x.p) + " · " + shown(dirName(x.p)));
    // The name opens the preview here (the results stay); a cloud-only
    // copy has nothing to show on this device.
    var isDir = g.kind === "dir";
    var other = isDbx(x.p) || isCmp(x.p);          // This computer / Dropbox
    var what = el(x.cloud && !isDir ? "div" : "button", "dp-what");
    if (isDir || other) {
      what.type = "button";
      what.title = t(isDir ? "dp.openDir" : "dp.open");
      what.addEventListener("click", function () { openAt(x.p, isDir); });
    } else if (!x.cloud) {
      what.type = "button";
      what.title = t("dp.preview");
      what.addEventListener("click", function () { if (ctx && ctx.preview) ctx.preview(x.p); });
    }
    what.appendChild(el("span", "dp-name", baseName(x.p)));
    what.appendChild(el("span", "dp-sub", shown(dirName(x.p))));
    var meta = el("span", "dp-meta");
    if (isDir) meta.appendChild(el("span", "", x.n === 1 ? t("dp.file1") : t("dp.files", { n: x.n })));
    if (g.kind === "meta") meta.appendChild(el("span", "", fmtBytes(x.s)));
    var d = fmtDate(x.m);
    if (d) meta.appendChild(el("span", "", d));
    if (x.cloud) {
      var c = el("span", "dp-cloud");
      c.innerHTML = ICON.cloud;
      c.appendChild(document.createTextNode(" " + t("dp.cloud")));
      meta.appendChild(c);
    }
    if (x.fixed) meta.appendChild(el("span", "dp-here", t("dp.onDisk")));
    meta.appendChild(el("span", "dp-stays", t("dp.stays")));
    what.appendChild(meta);
    r.classList.toggle("keep", !cb.checked);
    cb.addEventListener("change", function () {
      if (cb.checked) {
        if (!CORE.canPick(g, state.picked, x.p)) { cb.checked = false; toast(t("dp.lastCopy")); return; }
        state.picked[x.p] = true;
      } else delete state.picked[x.p];
      r.classList.toggle("keep", !cb.checked);
      paintBar();
    });
    var open = el("button", "tool dp-open");
    open.type = "button";
    open.innerHTML = ICON.folder;
    open.title = t("dp.open");
    open.setAttribute("aria-label", t("dp.open") + ": " + baseName(x.p));
    open.addEventListener("click", function () {
      if (!ctx) return;
      if (other) openAt(x.p, false);
      else if (isDir) { if (ctx.openFolder) ctx.openFolder(dirName(x.p)); }
      else if (ctx.openFile) ctx.openFile(x.p);
    });
    var tick = el("label", "dp-tick");
    if (x.fixed) { tick = el("span", "dp-tick"); r.classList.add("fixed"); }   // the orOS disk copy: stays, no box
    else tick.appendChild(cb);
    r.appendChild(tick);
    r.appendChild(what);
    r.appendChild(open);
    return r;
  }
  // Shows a file or folder of This computer / the Dropbox in its place.
  function openAt(p, isDir) {
    if (!src || !src.open) return;
    if (isDir) src.open(p + "/x"); else src.open(p);
  }
  function paintList() {
    var list = $("dp-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state || state.phase !== "done" || !state.groups) return;
    var lastKind = "";
    state.groups.slice(0, state.limit).forEach(function (g) {
      if (g.kind !== lastKind) {
        lastKind = g.kind;
        list.appendChild(el("h2", "dp-sec", t(g.kind === "dir" ? "dp.sec.dir" : g.kind === "meta" ? "dp.sec.meta" : g.kind === "there" ? "dp.sec.there" : "dp.sec.same")));
        if (g.kind === "there") list.appendChild(el("p", "dp-note", t(place === "dropbox" ? "dp.thereDbx" : "dp.thereCmp")));
        if (g.kind === "meta") list.appendChild(el("p", "dp-note", t("dp.metaHow")));
        if (g.kind === "dir") list.appendChild(el("p", "dp-note", t("dp.dirHow")));
      }
      var sec = el("section", "dp-group");
      var head = g.kind === "meta" ? t("dp.versions", { n: g.items.length })
        : g.kind === "dir" ? (g.items[0].n === 1 ? t("dp.dirCopies1", { n: g.items.length, s: fmtBytes(g.s) }) : t("dp.dirCopies", { n: g.items.length, f: g.items[0].n, s: fmtBytes(g.s) }))
        : t("dp.copies", { n: g.items.length, s: fmtBytes(g.s) });
      sec.appendChild(el("h3", "dp-head", head));
      var ul = el("ul", "dp-items");
      g.items.forEach(function (x) { ul.appendChild(row(g, x)); });
      sec.appendChild(ul);
      list.appendChild(sec);
    });
    if (state.groups.length > state.limit) {
      var more = el("button", "dp-more", t("dp.more"));
      more.type = "button";
      more.addEventListener("click", function () { state.limit += PAGE; paintList(); });
      list.appendChild(more);
    }
  }
  function paint() {
    if (!active) return;
    ensurePanel();
    var sc = $("dp-scope");
    if (sc) sc.textContent = place === "dropbox" ? t("dp.scopeDbx", { f: shown(base) })
      : place === "computer" ? t("dp.scopeCmp", { f: shown(base) })
      : base === ROOT ? t("dp.scopeAll") : t("dp.scope", { f: shown(base) });
    var tb = $("dp-trash");
    if (tb) tb.textContent = trashLabel();
    paintMsg();
    paintList();
    paintBar();
  }

  // ---------- place in the tree ----------
  function treeNode() {
    var wrap = el("div", "dbx-tree dp-tree");
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.appendChild(el("span", "caret empty"));
    var g = el("span", "glyph");
    g.innerHTML = ICON.dupes;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("dp.tree")));
    function open() {
      if (ctx && ctx.closeDrawer) ctx.closeDrawer();
      enter(ROOT);
    }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }

  // ---------- enter / leave ----------
  function enter(folder, where) {
    var pl = where === "dropbox" || where === "computer" ? where : "disk";
    var f;
    if (pl === "dropbox") f = typeof folder === "string" && folder.indexOf("dbx:") === 0 ? folder.replace(/\/+$/, "") : "dbx:";
    else if (pl === "computer") f = typeof folder === "string" && folder.indexOf("/computer/") === 0 ? folder : "/computer/home";
    else f = typeof folder === "string" && (folder === ROOT || folder.indexOf(ROOT + "/") === 0) && !CORE.skipDir(folder) ? folder : ROOT;
    // The place modules leave (and lose their view) when this enters.
    src = pl === "disk" ? null : (ctx && ctx.source ? ctx.source(pl) : null);
    if (ctx && ctx.onEnter) ctx.onEnter();
    active = true;
    place = pl;
    base = f;
    document.body.classList.add("dp-mode");
    ensurePanel();
    search();
    if (ctx && ctx.afterEnter) ctx.afterEnter();
  }
  function leave() {
    if (!active) return;
    gen++;
    active = false;
    state = null;
    var l = $("dp-list");
    if (l) l.innerHTML = "";
    document.body.classList.remove("dp-mode");
  }
  function init(c) { ctx = c || {}; }

  window.OrosFilesDupes = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    isActive: function () { return active; },
    t: t
  };
})();
