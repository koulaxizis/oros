// ============================================================
// orOS · Characters v1.0.0 — characters.js
// Ground-up port of the beta app into the orOS architecture.
//
// Architecture (Mood-app pattern):
//   · Standalone-ish iframe app: palette inherited at runtime from
//     the parent shell; CSS :root vars are first-paint fallback.
//   · Data: localStorage 'oros-characters-data' + orOS sync slice
//     'characters' with tombstones, mtime LWW merge and ordering.
//   · ONE relationship record per unordered character pair (the
//     beta's duplicate-inverse bug dies here).
//   · Inline SVG icons only. No external requests. EN/EL i18n.
//
// Delivery order (this file arrives in 5 parts):
//   1/5 constants · i18n · state · storage · merge · sync · migration
//   2/5 SECTION: RENDER CORE        (grid, search, editor dialog)
//   3/5 SECTION: RELATIONSHIPS      (matrix, rel editor)
//   4/5 SECTION: TOOLS              (templates, randomizer, radar, compare)
//   5/5 SECTION: EXPORTS + SHORTCUTS + BOOT
// ============================================================
(function () {
  "use strict";

  var APP_VER     = "1.0.0";
  var STORAGE_KEY = "oros-characters-data";   // new home
  var LEGACY_KEY  = "oros_characters_data";   // beta app (migration source)
  var SLICE_NAME  = "characters";
  var DATA_VER    = 1;

  // ---------- Parent shell access (same-origin iframes) ----------
  function syncApi() {
    try {
      if (window.orosSync) return window.orosSync;
      if (window.parent && window.parent.orosSync) return window.parent.orosSync;
    } catch (e) { /* cross-origin or standalone — fine */ }
    return null;
  }

  // Runtime palette inheritance: copy the parent's skin vars onto
  // our own <html> so every CSS var follows the OS skin instantly.
  function inheritPalette() {
    try {
      var src = window.parent.document.documentElement;
      var cs  = getComputedStyle(src);
      ["--accent","--accent-soft","--bg","--panel-bg","--panel-2",
       "--border","--text","--text-dim","--shadow"].forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone — CSS fallback stays */ }
  }

  function watchPalette() {
    try {
      var target = window.parent.document.documentElement;
      var last = null;
      var obs = new MutationObserver(function () {
        var cur = getComputedStyle(target).getPropertyValue("--accent");
        if (cur !== last) { last = cur; inheritPalette(); }
      });
      obs.observe(target, { attributes: true, attributeFilter: ["data-skin", "data-theme", "class"] });
    } catch (e) { /* standalone — nothing to watch */ }
  }

  // ---------- i18n (EN default, EL secondary) ----------
  var STRINGS = {
    en: {
      "tab.chars": "Characters",
      "tab.rels":  "Relationships",
      "tb.new":    "New",
      "tb.export": "Export",
      "tb.help":   "Help",

      "search.ph": "Filter by name, role or trait…",

      "empty.chars": "No characters yet",
      "empty.chars.hint": "Press Ctrl+Alt+N or click New to create your first character.",
      "empty.rels": "Nothing to relate yet",
      "empty.rels.hint": "Create at least two characters, then come back to link them.",
      "empty.search": "No characters match your search.",

      "count.chars": "{n} characters",
      "count.rels": "{n} relationships",
      "cc.links":   "{n} links",

      "dlg.editor.new":  "New character",
      "dlg.editor.edit": "Edit character",
      "fld.name":     "Name",
      "fld.role":     "Role / archetype",
      "fld.bio":      "Backstory",
      "fld.traits":   "Traits",
      "fld.trait":    "Trait",
      "fld.strength": "Intensity",
      "fld.goals":    "Goals",
      "fld.goal":     "Goal",
      "add.trait":    "Add trait",
      "add.goal":     "Add goal",

      "btn.save": "Save", "btn.cancel": "Cancel", "btn.delete": "Delete",
      "btn.close": "Close", "btn.ok": "OK",

      "del.char.title": "Delete character?",
      "del.char.body": "“{name}” and all its relationships will be permanently removed.",

      "rel.title": "Relationship",
      "rel.type":  "Type",
      "rel.desc":  "Notes",
      "rel.label": "Short label",
      "rel.hint":  "Click a cell to define the relationship between the two characters.",
      "rel.cell.add": "Add",
      "rel.cell.self": "—",
      "rel.matrix.title": "Relationship matrix",
      "rel.empty.cell": "empty",

      "cmp.title": "Compare",
      "cmp.pick":  "Pick a character…",
      "cmp.rels":  "Their relationship",

      "radar.title": "Trait profile",
      "radar.none":  "Add traits to see the profile.",

      "rnd.button": "Surprise me",
      "rnd.done":   "Filled the empty fields.",

      "tpl.title": "Start from a template",
      "tpl.skip":  "No thanks",

      "exp.md":   "Markdown (.md)",
      "exp.json": "Data (.json)",

      "toast.saved":     "Saved",
      "toast.deleted":   "Deleted",
      "toast.undone":    "Restored",
      "toast.sync":      "Updated from sync",
      "toast.exported":  "Exported",
      "toast.needtwo":   "You need at least two characters",

      "help.title": "Characters",
      "help.shortcut.new": "New character",
      "help.shortcut.export": "Export",
      "help.line1": "Create characters with traits, goals and backstory, then map how they relate to each other.",
      "help.line2": "Everything is stored locally and syncs through orOS (encrypted, end-to-end)."
    },
    el: {
      "tab.chars": "Χαρακτήρες",
      "tab.rels":  "Σχέσεις",
      "tb.new":    "Νέος",
      "tb.export": "Εξαγωγή",
      "tb.help":   "Βοήθεια",

      "search.ph": "Φιλτράρισμα με όνομα, ρόλο ή γνωρίσμα…",

      "empty.chars": "Δεν υπάρχουν χαρακτήρες ακόμα",
      "empty.chars.hint": "Πάτα Ctrl+Alt+N ή «Νέος» για να δημιουργήσεις τον πρώτο σου χαρακτήρα.",
      "empty.rels": "Δεν υπάρχουν σχέσεις ακόμα",
      "empty.rels.hint": "Δημιούργησε τουλάχιστον δύο χαρακτήρες και μετά έλα να τους συνδέσεις.",
      "empty.search": "Κανένας χαρακτήρας δεν ταιριάζει με την αναζήτηση.",

      "count.chars": "{n} χαρακτήρες",
      "count.rels":  "{n} σχέσεις",
      "cc.links":    "{n} δεσμοί",

      "dlg.editor.new":  "Νέος χαρακτήρας",
      "dlg.editor.edit": "Επεξεργασία χαρακτήρα",
      "fld.name":     "Όνομα",
      "fld.role":     "Ρόλος / αρχέτυπο",
      "fld.bio":      "Ιστορία",
      "fld.traits":   "Γνωρίσματα",
      "fld.trait":    "Γνώρισμα",
      "fld.strength": "Ένταση",
      "fld.goals":    "Στόχοι",
      "fld.goal":     "Στόχος",
      "add.trait":    "Προσθήκη γνωρίσματος",
      "add.goal":     "Προσθήκη στόχου",

      "btn.save": "Αποθήκευση", "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή",
      "btn.close": "Κλείσιμο", "btn.ok": "ΟΚ",

      "del.char.title": "Διαγραφή χαρακτήρα;",
      "del.char.body": "Ο «{name}» και όλες οι σχέσεις του θα αφαιρεθούν οριστικά.",

      "rel.title": "Σχέση",
      "rel.type":  "Τύπος",
      "rel.desc":  "Σημειώσεις",
      "rel.label": "Σύντομη ετικέτα",
      "rel.hint":  "Πάτα ένα κελί για να ορίσεις τη σχέση των δύο χαρακτήρων.",
      "rel.cell.add": "Προσθήκη",
      "rel.cell.self": "—",
      "rel.matrix.title": "Πλέγμα σχέσεων",
      "rel.empty.cell": "κενό",

      "cmp.title": "Σύγκριση",
      "cmp.pick":  "Επίλεξε χαρακτήρα…",
      "cmp.rels":  "Η σχέση τους",

      "radar.title": "Προφίλ γνωρισμάτων",
      "radar.none":  "Προσθήκη γνωρισμάτων για να δεις το προφίλ.",

      "rnd.button": "Έκπληξέ με",
      "rnd.done":   "Συμπλήρωσα τα κενά πεδία.",

      "tpl.title": "Ξεκίνα από πρότυπο",
      "tpl.skip":  "Όχι, ευχαριστώ",

      "exp.md":   "Markdown (.md)",
      "exp.json": "Δεδομένα (.json)",

      "toast.saved":     "Αποθηκεύτηκε",
      "toast.deleted":   "Διαγράφηκε",
      "toast.undone":    "Επαναφέρθηκε",
      "toast.sync":      "Ενημερώθηκε από συγχρονισμό",
      "toast.exported":  "Εξήχθη",
      "toast.needtwo":   "Χρειάζεσαι τουλάχιστον δύο χαρακτήρες",

      "help.title": "Χαρακτήρες",
      "help.shortcut.new": "Νέος χαρακτήρας",
      "help.shortcut.export": "Εξαγωγή",
      "help.line1": "Δημιούργησε χαρακτήρες με γνωρίσματα, στόχους και ιστορία, και μετά χαρτογράφησε πώς συνδέονται μεταξύ τους.",
      "help.line2": "Όλα αποθηκεύονται τοπικά και συγχρονίζονται μέσω orOS (κρυπτογραφημένα, end-to-end)."
    }
  };

  function t(key) {
    var lang = window.orosLang || "en";
    var pack = STRINGS[lang] || STRINGS.en;
    return pack[key] !== undefined ? pack[key]
         : STRINGS.en[key] !== undefined ? STRINGS.en[key] : key;
  }
  function tf(key, vals) {
    var s = t(key);
    Object.keys(vals || {}).forEach(function (k) {
      s = s.split("{" + k + "}").join(String(vals[k]));
    });
    return s;
  }

  // ---------- State ----------
  var db;                        // the one data object (below)
  var ui = {
    tab: "chars",                // "chars" | "rels"
    q: "",                       // search filter
    editing: null,               // draft character while editor is open
    compare: [null, null]        // compare view selections
  };
  var suppressDirty = false;     // true while applying pulled data

  // ---------- Data model ----------
  // db = {
  //   ver: 1,
  //   om:  <local op counter>            (grows on every local write)
  //   characters: { id: {id,name,role,bio,traits[],goals[],mtime} },
  //   rels:       { id: {id,a,b,type,text,desc,mtime} },   // ONE per pair
  //   deleted:    { id: tombstoneMtime },                  // chars + rels
  //   pos:        [characterIds in display order],
  //   posR:       [relIds in display order]
  // }

  function uid(prefix) {
    return (prefix || "c") + "-" +
      Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 8);
  }

  function strVal(v, max) {
    if (typeof v !== "string") return "";
    return v.slice(0, max || 200);
  }
  function numVal(v, fb) {
    return (typeof v === "number" && isFinite(v)) ? v : fb;
  }

  function saneTrait(tr) {
    if (!tr || typeof tr !== "object") return null;
    var name = strVal(tr.name, 40).trim();
    if (!name) return null;
    return { name: name, str: Math.min(5, Math.max(1, Math.round(numVal(tr.str, 3)))) };
  }
  function saneGoal(g) {
    if (!g || typeof g !== "object") return null;
    var text = strVal(g.text, 200).trim();
    if (!text) return null;
    return { done: !!g.done, text: text };
  }

  function saneChar(c) {
    if (!c || typeof c !== "object") return null;
    var ch = {
      id:    (typeof c.id === "string" && c.id) ? c.id : uid(),
      name:  strVal(c.name, 80).trim(),
      role:  strVal(c.role, 80).trim(),
      bio:   strVal(c.bio, 4000),
      traits: [],
      goals: [],
      mtime: numVal(c.mtime, 0)
    };
    if (Array.isArray(c.traits)) {
      for (var i = 0; i < c.traits.length && ch.traits.length < 12; i++) {
        var tr = saneTrait(c.traits[i]);
        if (tr) ch.traits.push(tr);
      }
    }
    if (Array.isArray(c.goals)) {
      for (var j = 0; j < c.goals.length && ch.goals.length < 20; j++) {
        var g = saneGoal(c.goals[j]);
        if (g) ch.goals.push(g);
      }
    }
    return ch;
  }

  var REL_TYPE_KEYS = ["friend", "family", "lover", "rival",
                       "enemy",  "mentor", "ally",  "other"];

  function saneRel(r) {
    if (!r || typeof r !== "object") return null;
    var a = strVal(r.a, 64), b = strVal(r.b, 64);
    if (!a || !b || a === b) return null;
    var type = REL_TYPE_KEYS.indexOf(r.type) >= 0 ? r.type : "other";
    return {
      id:    (typeof r.id === "string" && r.id) ? r.id : uid("r"),
      a: a < b ? a : b,             // canonical pair order — one
      b: a < b ? b : a,             // record per unordered pair
      type:  type,
      text:  strVal(r.text, 40).trim(),
      desc:  strVal(r.desc, 500),
      mtime: numVal(r.mtime, 0)
    };
  }

  function pairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

  function relBetween(a, b) {
    var key = pairKey(a, b);
    var ids = Object.keys(db.rels);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === key) return db.rels[ids[i]];
    }
    // rel ids ARE pair keys after migration — but older pulls may carry
    // freestanding ids; scan by membership as the safe fallback.
    for (var j = 0; j < ids.length; j++) {
      var r = db.rels[ids[j]];
      if (pairKey(r.a, r.b) === key) return r;
    }
    return null;
  }

  function saneDB(raw) {
    var out = {
      ver: DATA_VER,
      om:  numVal(raw && raw.om, 0),
      characters: {},
      rels: {},
      deleted: (raw && raw.deleted && typeof raw.deleted === "object")
                 ? raw.deleted : {},
      pos: [],
      posR: []
    };
    if (raw && raw.characters && typeof raw.characters === "object") {
      Object.keys(raw.characters).forEach(function (id) {
        var c = saneChar(raw.characters[id]);
        if (c) out.characters[c.id] = c;
      });
    } else if (raw && Array.isArray(raw.characters)) {
      raw.characters.forEach(function (rc) {
        var c = saneChar(rc);
        if (c) out.characters[c.id] = c;
      });
    }
    if (raw && raw.rels && typeof raw.rels === "object") {
      Object.keys(raw.rels).forEach(function (id) {
        var r = saneRel(raw.rels[id]);
        if (r) out.rels[r.id] = r;
      });
    } else if (raw && Array.isArray(raw.rels)) {
      raw.rels.forEach(function (rr) {
        var r = saneRel(rr);
        if (r) out.rels[r.id] = r;
      });
    }
    // Tombstones only count if their target still exists conceptually.
    Object.keys(out.deleted).forEach(function (id) {
      if (!out.deleted[id]) delete out.deleted[id];
    });
    if (Array.isArray(raw && raw.pos)) out.pos = raw.pos.slice(0, 500);
    if (Array.isArray(raw && raw.posR)) out.posR = raw.posR.slice(0, 500);
    return out;
  }

  function defaultDB() {
    return { ver: DATA_VER, om: 0, characters: {}, rels: {},
             deleted: {}, pos: [], posR: [] };
  }

  // ---------- Load / persist ----------
  function loadDB() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!raw) return defaultDB();
      return saneDB(raw);
    } catch (e) { return defaultDB(); }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) { /* quota — nothing more we can do here */ }
  }

  function markDirty() {
    if (suppressDirty) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }

  // Called after every USER-driven mutation: bump counter, persist,
  // notify the sync engine, repaint the UI.
  function commit(opts) {
    db.om = (db.om || 0) + 1;
    persist();
    markDirty();
    if (!opts || !opts.silent) paint();
  }

  function touchChar(id) {
    if (db.characters[id]) db.characters[id].mtime = Date.now();
  }

  // Ordered character list (pos first, newcomers appended, deleted out)
  function orderedChars() {
    var seen = {}, out = [];
    (db.pos || []).forEach(function (id) {
      if (db.characters[id] && !seen[id]) { seen[id] = true; out.push(db.characters[id]); }
    });
    Object.keys(db.characters).sort().forEach(function (id) {
      if (!seen[id]) { seen[id] = true; out.push(db.characters[id]); }
    });
    return out;
  }

  function orderedRels() {
    var seen = {}, out = [];
    (db.posR || []).forEach(function (id) {
      if (db.rels[id] && !seen[id]) { seen[id] = true; out.push(db.rels[id]); }
    });
    Object.keys(db.rels).sort().forEach(function (id) {
      if (!seen[id]) { seen[id] = true; out.push(db.rels[id]); }
    });
    return out;
  }

  function relCountFor(charId) {
    var n = 0;
    Object.keys(db.rels).forEach(function (id) {
      var r = db.rels[id];
      if (r.a === charId || r.b === charId) n++;
    });
    return n;
  }

  // ---------- Merge (union + LWW + tombstone resurrection) ----------
  // Winner per record id = highest mtime among live copies; a live copy
  // with NEWER mtime than its tombstone resurrects the record; an OLDER
  // one stays dead. Ordering (pos/posR) is donated by whichever side has
  // the larger om (it saw more history).
  function mergeSide(out, field, sanFn, A, B) {
    var ids = {};
    Object.keys(A[field] || {}).forEach(function (id) { ids[id] = true; });
    Object.keys(B[field] || {}).forEach(function (id) { ids[id] = true; });
    Object.keys(A.deleted || {}).forEach(function (id) { ids[id] = true; });
    Object.keys(B.deleted || {}).forEach(function (id) { ids[id] = true; });

    Object.keys(ids).forEach(function (id) {
      var la = A[field] && A[field][id];
      var lb = B[field] && B[field][id];
      var ta = A.deleted && A.deleted[id] || 0;
      var tb = B.deleted && B.deleted[id] || 0;
      var ma = la ? la.mtime : 0;
      var mb = lb ? lb.mtime : 0;

      var bestLive;                                   // ties: local wins,
      if (!la)      bestLive = lb;                    // but a LIVE copy must
      else if (!lb) bestLive = la;                    // never lose to a
      else          bestLive = (ma >= mb) ? la : lb;  // missing one
      var bestMT   = Math.max(ma, mb);
      var deadMT   = Math.max(ta, tb);

      if (bestLive && bestMT > deadMT) {
        var rec = sanFn(bestLive);
        if (rec) { out[field][rec.id] = rec; return; }
      }
      if (deadMT) out.deleted[id] = deadMT;
    });
  }

  function orderFrom(donor, field, universe) {
    var out = [], seen = {};
    (donor[field] || []).forEach(function (id) {
      if (universe[id] && !seen[id]) { seen[id] = true; out.push(id); }
    });
    Object.keys(universe).sort().forEach(function (id) {
      if (!seen[id]) { seen[id] = true; out.push(id); }
    });
    return out;
  }

  function mergeDB(A, B) {
    var out = {
      ver: DATA_VER,
      om:  Math.max(A.om || 0, B.om || 0),
      characters: {},
      rels: {},
      deleted: {},
      pos: [],
      posR: []
    };
    mergeSide(out, "characters", saneChar, A, B);
    mergeSide(out, "rels",       saneRel,  A, B);

    var donor = (B.om || 0) > (A.om || 0) ? B : A;
    out.pos  = orderFrom(donor, "pos",  out.characters);
    out.posR = orderFrom(donor, "posR", out.rels);
    return out;
  }

  // ---------- Legacy migration (beta app) ----------
  // The beta stored characters + relationships under LEGACY_KEY with
  // DUPLICATED symmetric relationships (Friend/Friend stored twice).
  // Migration: convert, deduplicate per unordered pair, drop refs to
  // unknown characters, then never look back.
  function migrateLegacy() {
    if (localStorage.getItem(STORAGE_KEY)) return false;   // already migrated
    var raw;
    try { raw = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (e) { raw = null; }
    if (!raw) return false;

    var out = defaultDB();

    var chars = Array.isArray(raw.characters) ? raw.characters
               : (raw.characters && typeof raw.characters === "object")
                 ? Object.keys(raw.characters).map(function (k) { return raw.characters[k]; })
               : [];
    var idMap = {};
    chars.forEach(function (rc) {
      var c = saneChar({
        id:    rc && rc.id,
        name:  rc && (rc.name || rc.title),
        role:  rc && (rc.role || rc.archetype),
        bio:   rc && (rc.bio || rc.backstory || rc.notes),
        traits: rc && (rc.traits || rc.personality),
        goals:  rc && (rc.goals || rc.objectives),
        mtime: Date.now()
      });
      if (c && c.name) {
        if (out.characters[c.id]) c.id = uid();           // id clash — mint a new one
        out.characters[c.id] = c;
        idMap[c.id] = c.id;
        out.pos.push(c.id);
      }
    });

    var rels = Array.isArray(raw.relationships) ? raw.relationships
             : (raw.relations && Array.isArray(raw.relations)) ? raw.relations
             : (raw.rels && Array.isArray(raw.rels)) ? raw.rels
             : [];
    rels.forEach(function (rr) {
      if (!rr) return;
      var ra = rr.a || rr.from || rr.charA || rr.source;
      var rb = rr.b || rr.to   || rr.charB || rr.target;
      // Beta allowed name-based refs; resolve through id then name.
      var ida = resolveRef(ra, out), idb = resolveRef(rb, out);
      if (!ida || !idb || ida === idb) return;
      var key = pairKey(ida, idb);
      if (out.rels[key]) return;                         // ← duplicate-inverse fix
      var type = rr.type || rr.kind || "other";
      out.rels[key] = saneRel({
        id: key, a: ida, b: idb, type: type,
        text: rr.label || rr.text || "",
        desc: rr.desc || rr.description || rr.notes || "",
        mtime: Date.now()
      });
      out.posR.push(key);
    });

    db = out;
    db.om = 1;
    persist();
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    return Object.keys(out.characters).length > 0 ||
           Object.keys(out.rels).length > 0;
  }

  function resolveRef(ref, out) {
    if (!ref || typeof ref !== "string") return null;
    if (out.characters[ref]) return ref;
    // name-based reference (beta behaviour)
    var ids = Object.keys(out.characters);
    for (var i = 0; i < ids.length; i++) {
      if (out.characters[ids[i]].name === ref) return ids[i];
    }
    return null;
  }

  // ---------- Sync slice ----------
  function sliceGet() {
    // Deep copy — the engine serializes what we hand it; never the live db.
    return JSON.parse(JSON.stringify(db));
  }

  function sliceSet(inc) {
    if (!inc) return;
    var merged = mergeDB(db, saneDB(inc));
    var changed = JSON.stringify(merged) !== JSON.stringify(db);
    db = merged;
    suppressDirty = true;          // pulled data must NEVER re-dirty
    try { persist(); } catch (e) {}
    suppressDirty = false;
    if (changed) {
      paint();
      toast("ok", t("toast.sync"));
    }
  }

  function registerSlice() {
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") {
      try {
        api.registerSlice(SLICE_NAME, sliceGet, sliceSet, STORAGE_KEY);
      } catch (e) { /* engine busy — next boot re-registers */ }
    }
  }

    // ===== SECTION: RENDER CORE =====

  // ---------- DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
  }

  // ---------- Icons (inline SVG — no ForkAwesome, ever) ----------
  var ICO = {
    plus:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    x:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    link:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    dl:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
  };

  // ---------- Toast (lazy, top-right, optional action = Undo) ----------
  function toast(kind, text, action) {
    var host = $("toast-host");
    if (!host) return;
    var box = el("div", "toast" + (kind === "err" ? " err" : ""));
    box.setAttribute("role", "status");
    box.appendChild(document.createTextNode(text));
    if (action && typeof action.fn === "function") {
      var btn = el("button", "t-act", action.label);
      btn.type = "button";
      btn.addEventListener("click", function () {
        action.fn();
        box.remove();
      });
      box.appendChild(btn);
    }
    host.appendChild(box);
    requestAnimationFrame(function () { box.classList.add("show"); });
    setTimeout(function () {
      box.classList.remove("show");
      setTimeout(function () { box.remove(); }, 300);
    }, action ? 5000 : (kind === "err" ? 4500 : 2600));
  }

  // ---------- Confirm dialog (promise-based, no native confirm()) ----------
  function confirmDialog(title, body, okLabel, danger) {
    return new Promise(function (resolve) {
      var dlg = $("dlg-confirm");
      dlg.innerHTML = "";
      var head = el("div", "dlg-head");
      head.appendChild(el("h3", null, title));
      var x = el("button", "dlg-x", "");
      x.type = "button";
      x.innerHTML = ICO.x;
      x.setAttribute("aria-label", t("btn.close"));
      head.appendChild(x);
      dlg.appendChild(head);

      var bd = el("div", "dlg-body");
      var p = el("p", null, body);
      p.style.cssText = "margin:4px 0 0;font-size:13px;line-height:1.6;";
      bd.appendChild(p);
      dlg.appendChild(bd);

      var ft = el("div", "dlg-foot");
      var no = el("button", "btn", t("btn.cancel"));
      no.type = "button";
      var yes = el("button", "btn" + (danger ? " danger" : ""), okLabel || t("btn.ok"));
      yes.type = "button";
      ft.appendChild(no);
      ft.appendChild(yes);
      dlg.appendChild(ft);

      function close(val) {
        dlg.close();
        dlg.innerHTML = "";
        resolve(val);
      }
      x.addEventListener("click", function () { close(false); });
      no.addEventListener("click", function () { close(false); });
      yes.addEventListener("click", function () { close(true); });
      dlg.addEventListener("close", function () {
        // Esc / backdrop path — resolve only once
        dlg.innerHTML = "";
        resolve(false);
      }, { once: true });

      if (typeof dlg.showModal === "function") dlg.showModal();
      else close(false);
    });
  }

  // ---------- Master paint ----------
  function paint() {
    paintChrome();
    if (ui.tab === "chars") renderCharsView();
    else renderRelsView();            // defined in SECTION: RELATIONSHIPS
  }

  // Topbar labels/aria — JS-painted, so language flips need no HTML edits
  function paintChrome() {
    var nb = $("tb-new");
    nb.innerHTML = ICO.plus + '<span class="lbl"></span>';
    nb.querySelector(".lbl").textContent = t("tb.new");
    nb.setAttribute("aria-label", t("tb.new"));

    var eb = $("tb-export");
    eb.innerHTML = ICO.dl + '<span class="lbl"></span>';
    eb.querySelector(".lbl").textContent = t("tb.export");
    eb.setAttribute("aria-label", t("tb.export"));

    var hb = $("tb-help");
    hb.textContent = "?";
    hb.setAttribute("aria-label", t("tb.help"));

    var tabs = document.querySelectorAll(".tb-tab");
    for (var i = 0; i < tabs.length; i++) {
      var key = tabs[i].getAttribute("data-tab") === "rels" ? "tab.rels" : "tab.chars";
      tabs[i].textContent = t(key);
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === ui.tab);
    }
    $("tb-tabs").setAttribute("aria-label", t("tab.chars"));
    $("view-chars").hidden = ui.tab !== "chars";
    $("view-rels").hidden  = ui.tab !== "rels";
  }

  // ---------- Characters view ----------
  function renderCharsView() {
    var host = $("view-chars");
    host.innerHTML = "";

    // Head: title + live count
    var head = el("div", "view-head");
    var h2 = el("h2", null, t("tab.chars"));
    var count = el("span", "count",
      tf("count.chars", { n: Object.keys(db.characters).length }));
    head.appendChild(h2);
    head.appendChild(count);
    host.appendChild(head);

    // Search (persists across grid re-renders — input stays focused)
    var srow = el("div", "search-row");
    var inp = document.createElement("input");
    inp.type = "text";
    inp.value = ui.q;
    inp.placeholder = t("search.ph");
    inp.setAttribute("spellcheck", "false");
    inp.addEventListener("input", function () {
      ui.q = inp.value;
      renderGrid();
    });
    srow.appendChild(inp);
    host.appendChild(srow);

    // Grid host — filter re-renders ONLY this node
    var list = el("div", null);
    list.id = "char-list";
    host.appendChild(list);
    renderGrid();
  }

  function charMatches(c, q) {
    if (!q) return true;
    var hay = (c.name + " " + c.role + " " + (c.traits || []).map(function (x) {
      return x.name;
    }).join(" ")).toLowerCase();
    return hay.indexOf(q.toLowerCase()) >= 0;
  }

  function renderGrid() {
    var list = $("char-list");
    if (!list) return;
    list.innerHTML = "";

    var all = orderedChars();
    var shown = all.filter(function (c) { return charMatches(c, ui.q); });

    if (!all.length) {
      var emp = el("div", "empty-state");
      emp.appendChild(el("div", "big", t("empty.chars")));
      var hint = el("div", "hint", t("empty.chars.hint"));
      emp.appendChild(hint);
      list.appendChild(emp);
      return;
    }
    if (!shown.length) {
      list.appendChild(el("div", "empty-state hint", t("empty.search")));
      return;
    }

    var grid = el("div", "char-grid");
    shown.forEach(function (c) { grid.appendChild(charCard(c)); });
    list.appendChild(grid);
  }

  function charCard(c) {
    var card = el("div", "char-card");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    var top = el("div", "cc-top");
    top.appendChild(el("div", "cc-avatar", initials(c.name)));
    var tw = el("div", null);
    tw.style.cssText = "min-width:0;";
    tw.appendChild(el("div", "cc-name", c.name || "—"));
    tw.appendChild(el("div", "cc-role", c.role || ""));
    top.appendChild(tw);
    card.appendChild(top);

    if (c.traits && c.traits.length) {
      var ch = el("div", "cc-traits");
      var shown = 0;
      for (var i = 0; i < c.traits.length && shown < 3; i++, shown++) {
        ch.appendChild(el("span", "chip", c.traits[i].name));
      }
      if (c.traits.length > 3) {
        ch.appendChild(el("span", "chip", "+" + (c.traits.length - 3)));
      }
      card.appendChild(ch);
    }

    var rc = el("div", "cc-rel-count");
    rc.innerHTML = ICO.link + "<span></span>";
    rc.querySelector("span").textContent =
      tf("cc.links", { n: relCountFor(c.id) });
    card.appendChild(rc);

    function open() { openEditor(c.id); }
    card.addEventListener("click", open);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return card;
  }

  // ---------- Character editor ----------
  // Draft lives in ui.editing; inputs write straight into the draft so
  // Save is a single saneChar() pass — no duplicated read-back logic.
  function openEditor(charId) {
    var src = charId ? db.characters[charId] : null;
    ui.editing = {
      id: src ? src.id : null,
      name: src ? src.name : "",
      role: src ? src.role : "",
      bio:  src ? src.bio : "",
      traits: src ? src.traits.map(function (x) { return { name: x.name, str: x.str }; }) : [],
      goals:  src ? src.goals.map(function (x) { return { done: x.done, text: x.text }; }) : []
    };

    var dlg = $("dlg-editor");
    dlg.innerHTML = "";

    // -- head --
    var head = el("div", "dlg-head");
    head.appendChild(el("h3", null,
      charId ? t("dlg.editor.edit") : t("dlg.editor.new")));
    var x = el("button", "dlg-x", "");
    x.type = "button";
    x.innerHTML = ICO.x;
    x.setAttribute("aria-label", t("btn.close"));
    x.addEventListener("click", function () { dlg.close(); });
    head.appendChild(x);
    dlg.appendChild(head);

    // -- body --
    var body = el("div", "dlg-body");

    var fName = el("div", "field");
    fName.appendChild(el("label", null, t("fld.name")));
    var iName = document.createElement("input");
    iName.type = "text";
    iName.value = ui.editing.name;
    iName.setAttribute("autocomplete", "off");
    iName.maxLength = 80;
    iName.addEventListener("input", function () { ui.editing.name = iName.value; });
    fName.appendChild(iName);
    body.appendChild(fName);

    var fRole = el("div", "field");
    fRole.appendChild(el("label", null, t("fld.role")));
    var iRole = document.createElement("input");
    iRole.type = "text";
    iRole.value = ui.editing.role;
    iRole.setAttribute("autocomplete", "off");
    iRole.maxLength = 80;
    iRole.addEventListener("input", function () { ui.editing.role = iRole.value; });
    fRole.appendChild(iRole);
    body.appendChild(fRole);

    var fBio = el("div", "field");
    fBio.appendChild(el("label", null, t("fld.bio")));
    var iBio = document.createElement("textarea");
    iBio.rows = 4;
    iBio.maxLength = 4000;
    iBio.value = ui.editing.bio;
    iBio.addEventListener("input", function () { ui.editing.bio = iBio.value; });
    fBio.appendChild(iBio);
    body.appendChild(fBio);

    // -- radar (live trait profile) --
    var radarBox = buildRadarBox();
    body.appendChild(radarBox.box);

    // -- starter row (new characters only): templates + surprise --
    if (!charId) {
      var startLbl = el("div", null, t("tpl.title"));
      startLbl.style.cssText =
        "font-size:11px;font-weight:800;text-transform:uppercase;" +
        "letter-spacing:.6px;color:var(--text-dim);margin:14px 0 6px;";
      body.appendChild(startLbl);
      var startRow = el("div", null);
      startRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
      TEMPLATES.forEach(function (tpl) {
        var b = el("button", "chip",
          (window.orosLang === "el" ? tpl.el : tpl.en));
        b.type = "button";
        b.addEventListener("click", function () {
          applyTemplate(ui.editing, tpl);
          iName.value = ui.editing.name;
          iRole.value = ui.editing.role;
          paintTraitRows();
          paintGoalRows();
        });
        startRow.appendChild(b);
      });
      var rnd = el("button", "chip", "🎲 " + t("rnd.button"));
      rnd.type = "button";
      rnd.addEventListener("click", function () {
        if (randomizeDraft(ui.editing)) {
          iName.value = ui.editing.name;
          iRole.value = ui.editing.role;
          paintTraitRows();
          toast("ok", t("rnd.done"));
        }
      });
      startRow.appendChild(rnd);
      body.appendChild(startRow);
    }

    // -- traits --
    body.appendChild(el("label", null, t("fld.traits"))).className = "";
    var traitHost = el("div", null);
    traitHost.style.cssText = "margin:6px 0 4px;";
    var addTraitBtn = el("button", "add-row-btn", "+ " + t("add.trait"));
    addTraitBtn.type = "button";
    addTraitBtn.addEventListener("click", function () {
      ui.editing.traits.push({ name: "", str: 3 });
      paintTraitRows();
      var last = traitHost.querySelector(".trait-row:last-child input[type=text]");
      if (last) last.focus();
    });
    body.appendChild(traitHost);
    body.appendChild(addTraitBtn);

    function paintTraitRows() {
      traitHost.innerHTML = "";
      ui.editing.traits.forEach(function (tr, idx) {
        var row = el("div", "trait-row");
        var iN = document.createElement("input");
        iN.type = "text";
        iN.value = tr.name;
        iN.placeholder = t("fld.trait");
        iN.maxLength = 40;
        iN.addEventListener("input", function () { tr.name = iN.value; });
        row.appendChild(iN);

        var vv = el("div", "trait-val");
        var rng = document.createElement("input");
        rng.type = "range";
        rng.min = 1; rng.max = 5; rng.step = 1;
        rng.value = tr.str;
        rng.setAttribute("aria-label", t("fld.strength"));
        var num = el("span", null, String(tr.str));
        num.style.cssText = "width:10px;text-align:center;";
        rng.addEventListener("input", function () {
          tr.str = parseInt(rng.value, 10);
          num.textContent = rng.value;
        });
        vv.appendChild(rng);
        vv.appendChild(num);
        row.appendChild(vv);

        var del = el("button", "trait-del", "");
        del.type = "button";
        del.innerHTML = ICO.x;
        del.setAttribute("aria-label", t("btn.delete"));
        del.addEventListener("click", function () {
          ui.editing.traits.splice(idx, 1);
          paintTraitRows();
        });
        row.appendChild(del);
        traitHost.appendChild(row);
      });
      radarBox.update(ui.editing.traits);
    }
    paintTraitRows();

    // -- goals --
    var gLbl = el("label", null, t("fld.goals"));
    gLbl.style.cssText = "display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--text-dim);margin:14px 0 6px;";
    body.appendChild(gLbl);
    var goalHost = el("div", null);
    var addGoalBtn = el("button", "add-row-btn", "+ " + t("add.goal"));
    addGoalBtn.type = "button";
    addGoalBtn.addEventListener("click", function () {
      ui.editing.goals.push({ done: false, text: "" });
      paintGoalRows();
      var last = goalHost.querySelector(".goal-row:last-child input[type=text]");
      if (last) last.focus();
    });
    body.appendChild(goalHost);
    body.appendChild(addGoalBtn);

    function paintGoalRows() {
      goalHost.innerHTML = "";
      ui.editing.goals.forEach(function (g, idx) {
        var row = el("div", "goal-row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = g.done;
        cb.setAttribute("aria-label", t("fld.goal"));
        cb.addEventListener("change", function () {
          g.done = cb.checked;
          txt.classList.toggle("done", g.done);
        });
        row.appendChild(cb);
        var txt = document.createElement("input");
        txt.type = "text";
        txt.value = g.text;
        txt.placeholder = t("fld.goal");
        txt.maxLength = 200;
        txt.classList.toggle("done", g.done);
        txt.addEventListener("input", function () { g.text = txt.value; });
        row.appendChild(txt);
        var del = el("button", "trait-del", "");
        del.type = "button";
        del.innerHTML = ICO.x;
        del.setAttribute("aria-label", t("btn.delete"));
        del.addEventListener("click", function () {
          ui.editing.goals.splice(idx, 1);
          paintGoalRows();
        });
        row.appendChild(del);
        goalHost.appendChild(row);
      });
    }
    paintGoalRows();

    dlg.appendChild(body);

    // -- foot --
    var foot = el("div", "dlg-foot");
    if (charId) {
      var delBtn = el("button", "btn danger", t("btn.delete"));
      delBtn.type = "button";
      delBtn.addEventListener("click", function () {
        deleteCharacter(charId).then(function (done) {
          if (done) dlg.close();
        });
      });
      foot.appendChild(delBtn);
    }
    var spacer = el("span", null);
    spacer.style.flex = "1";
    foot.appendChild(spacer);
    var cancel = el("button", "btn", t("btn.cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", function () { dlg.close(); });
    var save = el("button", "btn primary", t("btn.save"));
    save.type = "button";
    save.addEventListener("click", function () { saveCharacter(); });
    foot.appendChild(cancel);
    foot.appendChild(save);
    dlg.appendChild(foot);

    // Enter on the name field = Save (textarea excluded naturally)
    iName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); saveCharacter(); }
    });
    iBio.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); saveCharacter();
      }
    });

    dlg.addEventListener("close", function () { ui.editing = null; }, { once: true });

    if (typeof dlg.showModal === "function") dlg.showModal();
    setTimeout(function () { iName.focus(); }, 50);
  }

  function saveCharacter() {
    if (!ui.editing) return;
    var draft = ui.editing;

    if (!draft.name.trim()) {
      toast("err", t("fld.name") + "?");
      return;
    }
    var rec = saneChar({
      id:    draft.id,
      name:  draft.name,
      role:  draft.role,
      bio:   draft.bio,
      traits: draft.traits,
      goals:  draft.goals,
      mtime:  Date.now()                     // > any tombstone → resurrect-safe
    });
    if (!rec) return;

    var isNew = !draft.id || !db.characters[rec.id];
    db.characters[rec.id] = rec;
    if (db.deleted[rec.id]) delete db.deleted[rec.id];   // undo a deletion
    if (db.pos.indexOf(rec.id) < 0) db.pos.push(rec.id);
    commit();
    $("dlg-editor").close();
    toast("ok", t("toast.saved"));
  }

  // Delete = tombstone + cascade rels, with a 5s Undo net.
  function deleteCharacter(id) {
    var c = db.characters[id];
    if (!c) return Promise.resolve(false);
    return confirmDialog(
      t("del.char.title"),
      tf("del.char.body", { name: c.name }),
      t("btn.delete"),
      true
    ).then(function (yes) {
      if (!yes) return false;

      // Snapshot for undo BEFORE mutating
      var removedChar = JSON.parse(JSON.stringify(c));
      var removedRels = {}, doomedIds = [];
      Object.keys(db.rels).forEach(function (rid) {
        var r = db.rels[rid];
        if (r.a === id || r.b === id) {
          removedRels[rid] = JSON.parse(JSON.stringify(r));
          doomedIds.push(rid);
        }
      });

      var now = Date.now();
      doomedIds.forEach(function (rid) {
        delete db.rels[rid];
        db.deleted[rid] = now;
      });
      delete db.characters[id];
      db.deleted[id] = now;
      db.pos = db.pos.filter(function (x) { return x !== id; });
      db.posR = db.posR.filter(function (x) { return !doomedIds.some(function (d) { return d === x; }); });
      commit();

      toast("ok", t("toast.deleted"), {
        label: t("toast.undone") === t("toast.undone") ? "↩" : "↩",
        fn: function () {
          var stamp = Date.now();             // strictly newer than tombstones
          removedChar.mtime = stamp;
          db.characters[id] = removedChar;
          delete db.deleted[id];
          if (db.pos.indexOf(id) < 0) db.pos.push(id);
          Object.keys(removedRels).forEach(function (rid) {
            var r = removedRels[rid];
            r.mtime = stamp;
            db.rels[rid] = r;
            delete db.deleted[rid];
            if (db.posR.indexOf(rid) < 0) db.posR.push(rid);
          });
          commit();
          toast("ok", t("toast.undone"));
        }
      });
      return true;
    });
  }

  // ---------- Help dialog ----------
  function openHelp() {
    var dlg = $("dlg-help");
    dlg.innerHTML = "";
    var head = el("div", "dlg-head");
    head.appendChild(el("h3", null, t("help.title")));
    var x = el("button", "dlg-x", "");
    x.type = "button";
    x.innerHTML = ICO.x;
    x.setAttribute("aria-label", t("btn.close"));
    x.addEventListener("click", function () { dlg.close(); });
    head.appendChild(x);
    dlg.appendChild(head);

    var body = el("div", "dlg-body");
    var l1 = el("p", null, t("help.line1"));
    l1.style.cssText = "margin:4px 0 8px;font-size:13px;line-height:1.6;";
    var l2 = el("p", null, t("help.line2"));
    l2.style.cssText = "margin:0 0 12px;font-size:12px;color:var(--text-dim);line-height:1.6;";
    body.appendChild(l1);
    body.appendChild(l2);

    function scRow(keys, labelKey) {
      var row = el("div", null);
      row.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:12.5px;";
      var k = el("kbd", null, keys);
      k.style.cssText = "font:inherit;font-weight:800;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel-2);color:var(--accent);";
      row.appendChild(k);
      row.appendChild(el("span", null, t(labelKey)));
      return row;
    }
    body.appendChild(scRow("Ctrl+Alt+N", "help.shortcut.new"));
    body.appendChild(scRow("Ctrl+Alt+E", "help.shortcut.export"));
    dlg.appendChild(body);

    var foot = el("div", "dlg-foot");
    var ok = el("button", "btn primary", t("btn.close"));
    ok.type = "button";
    ok.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(ok);
    dlg.appendChild(foot);

    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    if (typeof dlg.showModal === "function") dlg.showModal();
  }

    // ===== SECTION: RELATIONSHIPS =====

  // Rel type labels — bilingual, local to this section. Keyed by the
  // canonical REL_TYPE_KEYS set from part 1/5. Ordinal position drives
  // the accent/colour coding derived from the theme palette (type
  // index → hue offset, never hardcoded brands).
  var REL_LABELS = {
    en: { friend: "Friend",   family: "Family",   lover: "Lover",
          rival: "Rival",     enemy:  "Enemy",    mentor: "Mentor",
          ally:  "Ally",       other:  "Other" },
    el: { friend: "Φίλος/η",  family: "Οικογένεια", lover: "Ερωτική",
          rival: "Αντίζηλος/η", enemy: "Εχθρός/η", mentor: "Μέντορας",
          ally:  "Σύμμαχος/η", other:  "Άλλο" }
  };
  function relTypeLabel(type) {
    var lang = window.orosLang === "el" ? "el" : "en";
    var p = REL_LABELS[lang] || REL_LABELS.en;
    return p[type] || p.other;
  }

  // ---------- Relationships view ----------
  function renderRelsView() {
    var host = $("view-rels");
    host.innerHTML = "";

    var chars = orderedChars();
    var rels  = orderedRels();

    var head = el("div", "view-head");
    head.appendChild(el("h2", null, t("tab.rels")));
    head.appendChild(el("span", "count",
      tf("count.rels", { n: rels.length })));
    host.appendChild(head);

    if (chars.length < 2) {
      var emp = el("div", "empty-state");
      emp.appendChild(el("div", "big", t("empty.rels")));
      emp.appendChild(el("div", "hint", t("empty.rels.hint")));
      host.appendChild(emp);
      return;
    }

    var hint = el("div", "hint");
    hint.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:10px;";
    hint.textContent = t("rel.hint");
    host.appendChild(hint);

    renderComparePanel(host, chars);

    var wrap = el("div", "matrix-wrap");
    wrap.appendChild(buildMatrix(chars));
    host.appendChild(wrap);

    // Legend (compact — what each type is, no colours invented here)
    if (rels.length) {
      var lg = el("div", null);
      lg.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;";
      var typesSeen = {};
      rels.forEach(function (r) { typesSeen[r.type] = true; });
      Object.keys(REL_TYPE_KEYS).forEach(function (i) {
        var ty = REL_TYPE_KEYS[i];
        if (!typesSeen[ty]) return;
        lg.appendChild(el("span", "chip",
          relTypeLabel(ty) + " · " + Object.keys(db.rels).filter(function (id) {
            return db.rels[id].type === ty;
          }).length));
      });
      host.appendChild(lg);
    }
  }

  // ---------- Matrix ----------
  // Upper triangle only would hide the inverse-direction glance the
  // beta offered; the LOWER half stays clickable and mirrors the same
  // single record (pair key), so both directions edit one entry.
  function buildMatrix(chars) {
    var tbl = document.createElement("table");
    tbl.className = "matrix";

    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    var corner = document.createElement("th");
    corner.setAttribute("aria-hidden", "true");
    hr.appendChild(corner);
    chars.forEach(function (c) {
      var th = document.createElement("th");
      th.setAttribute("scope", "col");
      th.setAttribute("title", c.name);
      th.textContent = shortName(c.name);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = document.createElement("tbody");
    chars.forEach(function (rowChar, ri) {
      var tr = document.createElement("tr");

      var rh = document.createElement("th");
      rh.setAttribute("scope", "row");
      rh.className = "rowhead-accent";
      rh.setAttribute("title", rowChar.name);
      rh.textContent = shortName(rowChar.name);
      tr.appendChild(rh);

      chars.forEach(function (colChar, ci) {
        if (ci === ri) {
          var diag = el("td", "diag", t("rel.cell.self"));
          tr.appendChild(diag);
          return;
        }
        var td = el("td", "cell");

        var rel = relBetween(rowChar.id, colChar.id);
        if (rel) {
          td.classList.add("has");
          td.textContent = relTypeLabel(rel.type);
          td.setAttribute("title",
            rel.text ? rel.text + " — " + rel.desc : rel.desc);
        } else {
          td.textContent = t("rel.empty.cell");
        }

        (function (ra, rb) {
          td.addEventListener("click", function () { openRelEditor(ra, rb); });
        })(rowChar.id, colChar.id);

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    return tbl;
  }

  function shortName(name) {
    var n = String(name || "").trim();
    return n.length > 12 ? n.slice(0, 11) + "…" : n;
  }

  // ---------- Relationship editor ----------
  var relEditing = null;    // {aId, bId, existing}

  function openRelEditor(aId, bId) {
    if (!db.characters[aId] || !db.characters[bId]) return;
    relEditing = { aId: aId, bId: bId, existing: relBetween(aId, bId) };
    var isNew = !relEditing.existing;

    var dlg = $("dlg-rel");
    dlg.innerHTML = "";

    // -- head --
    var head = el("div", "dlg-head");
    var title = el("h3", null, t("rel.title"));
    title.textContent = t("rel.title") + ": " +
      db.characters[aId].name + " ↔ " + db.characters[bId].name;
    head.appendChild(title);
    var x = el("button", "dlg-x", "");
    x.type = "button";
    x.innerHTML = ICO.x;
    x.setAttribute("aria-label", t("btn.close"));
    x.addEventListener("click", function () { dlg.close(); });
    head.appendChild(x);
    dlg.appendChild(head);

    // -- body --
    var body = el("div", "dlg-body");

    // Pair display (visual anchor)
    var pair = el("div", null);
    pair.style.cssText =
      "display:flex;align-items:center;gap:8px;margin-bottom:14px;" +
      "font-size:12.5px;font-weight:700;";
    pair.appendChild(el("span", "cc-avatar", initials(db.characters[aId].name)));
    pair.appendChild(el("span", null, db.characters[aId].name));
    pair.appendChild(el("span", null, "↔")).style.cssText = "color:var(--text-dim);font-size:15px;";
    pair.appendChild(el("span", "cc-avatar", initials(db.characters[bId].name)));
    pair.appendChild(el("span", null, db.characters[bId].name));
    body.appendChild(pair);

    // Type — segmented control, not a dropdown (one-tap selection)
    var fType = el("div", "field");
    fType.appendChild(el("label", null, t("rel.type")));
    var seg = el("div", null);
    seg.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    var currentType = relEditing.existing ? relEditing.existing.type : "friend";
    var typeBtns = {};
    REL_TYPE_KEYS.forEach(function (tk) {
      var b = el("button", "btn", relTypeLabel(tk));
      b.type = "button";
      if (tk === currentType) b.classList.add("primary");
      b.style.height = "30px";
      b.addEventListener("click", function () {
        currentType = tk;
        iText.placeholder = relTypeLabel(tk);
        Object.keys(typeBtns).forEach(function (k) {
          typeBtns[k].classList.toggle("primary", k === tk);
        });
      });
      typeBtns[tk] = b;
      seg.appendChild(b);
    });
    fType.appendChild(seg);
    body.appendChild(fType);

    // Short label
    var fText = el("div", "field");
    fText.appendChild(el("label", null, t("rel.label")));
    var iText = document.createElement("input");
    iText.type = "text";
    iText.value = relEditing.existing ? relEditing.existing.text : "";
    iText.placeholder = relTypeLabel(currentType);
    iText.maxLength = 40;
    iText.setAttribute("autocomplete", "off");
    fText.appendChild(iText);
    body.appendChild(fText);

    // Notes
    var fDesc = el("div", "field");
    fDesc.appendChild(el("label", null, t("rel.desc")));
    var iDesc = document.createElement("textarea");
    iDesc.rows = 3;
    iDesc.maxLength = 500;
    iDesc.value = relEditing.existing ? relEditing.existing.desc : "";
    fDesc.appendChild(iDesc);
    body.appendChild(fDesc);

    dlg.appendChild(body);

    // -- foot --
    var foot = el("div", "dlg-foot");
    if (!isNew) {
      var del = el("button", "btn danger", t("btn.delete"));
      del.type = "button";
      del.addEventListener("click", function () {
        deleteRel(relEditing.existing.id).then(function (done) {
          if (done) dlg.close();
        });
      });
      foot.appendChild(del);
    }
    var spacer = el("span", null);
    spacer.style.flex = "1";
    foot.appendChild(spacer);
    var cancel = el("button", "btn", t("btn.cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", function () { dlg.close(); });
    var save = el("button", "btn primary", t("btn.save"));
    save.type = "button";
    save.addEventListener("click", function () { saveRel(currentType, iText.value, iDesc.value); });
    foot.appendChild(cancel);
    foot.appendChild(save);
    dlg.appendChild(foot);

    if (typeof dlg.showModal === "function") dlg.showModal();
    setTimeout(function () { iText.focus(); }, 50);
  }

  function saveRel(type, text, desc) {
    if (!relEditing) return;
    var id = pairKey(relEditing.aId, relEditing.bId);

    var rec = saneRel({
      id:    id,
      a:     relEditing.aId,
      b:     relEditing.bId,
      type:  type,
      text:  text,
      desc:  desc,
      mtime: Date.now()
    });
    if (!rec) return;

    db.rels[rec.id] = rec;
    if (db.deleted[rec.id]) delete db.deleted[rec.id];
    if (db.posR.indexOf(rec.id) < 0) db.posR.push(rec.id);
    // Touch both ends: mtimes of the characters themselves stay intact
    // (their CONTENT did not change) — only the pair record is newer.
    commit();
    $("dlg-rel").close();
    toast("ok", t("toast.saved"));
  }

  function deleteRel(id) {
    var r = db.rels[id];
    if (!r) return Promise.resolve(false);
    return confirmDialog(
      t("btn.delete"),
      relTypeLabel(r.type) + ": " +
        db.characters[r.a].name + " ↔ " + db.characters[r.b].name,
      t("btn.delete"),
      true
    ).then(function (yes) {
      if (!yes) return false;
      var removed = JSON.parse(JSON.stringify(r));
      var now = Date.now();
      delete db.rels[id];
      db.deleted[id] = now;
      db.posR = db.posR.filter(function (x) { return x !== id; });
      commit();
      toast("ok", t("toast.deleted"), {
        label: "↩",
        fn: function () {
          removed.mtime = Date.now();           // beat the tombstone
          db.rels[id] = removed;
          delete db.deleted[id];
          if (db.posR.indexOf(id) < 0) db.posR.push(id);
          commit();
          toast("ok", t("toast.undone"));
        }
      });
      return true;
    });
  }

    // ===== SECTION: TOOLS =====
  // Templates, randomizer (built-in pools), radar chart, compare view.

  // ---------- Built-in pools (no external datasets — doctrine) ----------
  var POOLS = {
    en: {
      first: ["Alma","Bran","Cyrus","Dahlia","Elias","Freya","Gabriel","Harriet",
              "Ines","Jonas","Kira","Leo","Marisol","Nadia","Oscar","Petra",
              "Quinn","Rosa","Silas","Tessa","Ulric","Vera","Wren","Yusuf"],
      last:  ["Ashwood","Bellamy","Crane","Devereux","Ellery","Fairbanks","Grimaldi",
              "Halloway","Ingram","Jessup","Kestrel","Larkin","Marchetti","Norwood",
              "Okafor","Pemberton","Quill","Ravenscroft","Sterling","Thorne"],
      roles: ["Detective","Cartographer","Fence","Archivist","Smuggler","Composer",
              "Botanist","Bodyguard","Journalist","Librarian","Mercenary","Physician",
              "Sailor","Translator","Watchmaker","Innkeeper"],
      traits:["stubborn","curious","loyal","cynical","ambitious","compassionate",
              "guarded","impulsive","patient","sarcastic","brave","calculating",
              "chaotic","devoted","envious","forgiving","honest","irritable",
              "observant","proud","reckless","resentful","tactful","vengeful"]
    },
    el: {
      first: ["Αγνή","Βλάσης","Γιώργος","Δάφνη","Ελένη","Ζήσης","Ήρα","Θανάσης",
              "Ιωάννα","Κώστας","Λένα","Μάριος","Νίκη","Ξένια","Οδυσσέας","Πέτρος",
              "Ραχήλ","Σοφία","Τάσος","Υβόννη","Φωτεινή","Χάρης","Ψαθας","Άγγελος"],
      last:  ["Αντωνόπουλος","Βλάχος","Γεωργίου","Δημάκης","Ευσταθίου","Ζωιτός",
              "Ηλιάδης","Θεοδωρίδης","Καραγιάννης","Λαμπρόπουλος","Μακρής",
              "Νικολαΐδης","Οικονόμου","Παπαδόπουλος","Ρούσσος","Σταυρόπουλος"],
      roles: ["Αστυνόμος","Χαρτογράφος","Επαγγελματίας δανειστής","Αρχειοθέτης",
              "Λαθρέμπορος","Συνθέτης","Βοτανολόγος","Bodyguard","Δημοσιογράφος",
              "Βιβλιοθηκονόμος","Εκτελεστής","Ιατρός","Ναυτικός","Μεταφραστής",
              "Ρολογάς","Ξενοδόχος"],
      traits:["πείσμων","περίεργος","πιστός","κυνικός","φιλόδοξος","συμπονετικός",
              "κλειστός","παρορμητικός","υπομονετικός","σαρκαστικός","γενναίος",
              "υπολογιστικός","χαοτικός","αφοσιωμένος","ζηλόφθωνος","συγχωρητικός",
              "ειλικρινής","ευέξαπτος","παρατηρητικός","περήφανος","απερίσκεπτος",
              "φοβικός","εύγλωττος","εκδικητικός"]
    }
  };

  var TEMPLATES = [
    { key: "hero",   en: "Hero",   el: "Ήρωας",
      role: { en: "Protagonist",   el: "Πρωταγωνιστής" },
      traits: [["brave", 4], ["stubborn", 3], ["compassionate", 3], ["reckless", 2]],
      traitsEl: [["γενναίος", 4], ["πείσμων", 3], ["συμπονετικός", 3], ["απερίσκεπτος", 2]],
      goal: { en: "Save what remains of their family's name", el: "Να σώσει ό,τι απέμεινε από το όνομα της οικογένειάς του" } },
    { key: "villain", en: "Villain", el: "Αντίπαλος",
      role: { en: "Antagonist",     el: "Ανταγωνιστής" },
      traits: [["calculating", 5], ["proud", 4], ["resentful", 3], ["honest", 1]],
      traitsEl: [["υπολογιστικός", 5], ["περήφανος", 4], ["φοβικός", 3], ["ειλικρινής", 1]],
      goal: { en: "Prove the world wrong, whatever the cost", el: "Να αποδείξει ότι ο κόσμος έκανε λάθος, όποιο κι αν είναι το κόστος" } },
    { key: "mentor", en: "Mentor", el: "Μέντορας",
      role: { en: "Guide / Mentor", el: "Οδηγός / Μέντορας" },
      traits: [["patient", 4], ["observant", 4], ["guarded", 3], ["cynical", 2]],
      traitsEl: [["υπομονετικός", 4], ["παρατηρητικός", 4], ["κλειστός", 3], ["κυνικός", 2]],
      goal: { en: "Prepare someone else to survive without them", el: "Να προετοιμάσει κάποιον άλλον να επιβιώσει χωρίς εκείνον" } }
  ];

  function poolLang() { return window.orosLang === "el" ? "el" : "en"; }

  function existingNames() {
    return Object.keys(db.characters).map(function (id) {
      return db.characters[id].name.toLowerCase();
    });
  }

  function pickUnused(poolArr, taken) {
    var free = poolArr.filter(function (x) { return taken.indexOf(String(x).toLowerCase()) < 0; });
    var arr = free.length ? free : poolArr;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function genName(L) {
    var p = POOLS[L];
    var first = pickUnused(p.first, existingNames());
    return first + " " + p.last[Math.floor(Math.random() * p.last.length)];
  }

  // Fill ONLY empty draft fields — never overwrite what the user typed.
  function randomizeDraft(draft) {
    var L = poolLang();
    var changed = false;
    if (!draft.name.trim())  { draft.name  = genName(L); changed = true; }
    if (!draft.role.trim())  { draft.role  = POOLS[L].roles[Math.floor(Math.random() * POOLS[L].roles.length)]; changed = true; }
    if (!draft.traits.length) {
      var bag = POOLS[L].traits.slice();
      for (var i = 0; i < 3 && bag.length; i++) {
        var idx = Math.floor(Math.random() * bag.length);
        draft.traits.push({
          name: bag.splice(idx, 1)[0],
          str:  2 + Math.floor(Math.random() * 4)
        });
      }
      changed = true;
    }
    return changed;
  }

  function applyTemplate(draft, tpl) {
    var L = poolLang();
    draft.name  = draft.name.trim()  || genName(L);
    draft.role  = tpl.role[L];
    var tr = L === "el" ? tpl.traitsEl : tpl.traits;
    draft.traits = tr.map(function (x) { return { name: x[0], str: x[1] }; });
    if (!draft.goals.length) draft.goals = [{ done: false, text: tpl.goal[L] }];
  }

  // ---------- Radar chart (pure SVG, currentColor = theme accent) ----------
  function buildRadarBox() {
    var box = el("div", "radar-box");
    var title = el("div", null, t("radar.title"));
    title.style.cssText = "font-size:12px;font-weight:800;color:var(--text-dim);";
    var holder = el("div", null);
    box.appendChild(title);
    box.appendChild(holder);
    function update(traits) {
      holder.innerHTML = "";
      if (!traits || !traits.length) {
        holder.appendChild(el("div", "hint", t("radar.none")));
        return;
      }
      holder.appendChild(buildRadarSVG(traits.slice(0, 8)));
    }
    return { box: box, update: update };
  }

  function buildRadarSVG(traits) {
    var n = traits.length;
    var axes = Math.max(3, n);                 // a 2-point radar is a line — pad
    var R = 88, CX = 120, CY = 105;
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 240 210");
    svg.setAttribute("width", "240");
    svg.style.color = "var(--accent)";         // follows the OS skin
    svg.style.maxWidth = "100%";

    function pt(axisIdx, r) {
      var ang = -Math.PI / 2 + (2 * Math.PI * axisIdx) / axes;
      return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)];
    }

    // rings
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var ring = document.createElementNS(svgNS, "polygon");
      var pts = [];
      for (var a = 0; a < axes; a++) {
        var p = pt(a, R * f);
        pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
      }
      ring.setAttribute("points", pts.join(" "));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "var(--border)");
      ring.setAttribute("stroke-width", "1");
      svg.appendChild(ring);
    });

    // spokes + labels
    for (var a = 0; a < axes; a++) {
      var sp = document.createElementNS(svgNS, "line");
      var end = pt(a, R);
      sp.setAttribute("x1", CX); sp.setAttribute("y1", CY);
      sp.setAttribute("x2", end[0].toFixed(1)); sp.setAttribute("y2", end[1].toFixed(1));
      sp.setAttribute("stroke", "var(--border)");
      sp.setAttribute("stroke-width", "1");
      svg.appendChild(sp);

      if (a < n) {
        var lp = pt(a, R + 16);
        var lab = document.createElementNS(svgNS, "text");
        lab.setAttribute("x", lp[0].toFixed(1));
        lab.setAttribute("y", lp[1].toFixed(1));
        lab.setAttribute("text-anchor",
          lp[0] > CX + 6 ? "start" : lp[0] < CX - 6 ? "end" : "middle");
        lab.setAttribute("dominant-baseline", "middle");
        lab.setAttribute("fill", "var(--text-dim)");
        lab.setAttribute("font-size", "9");
        lab.setAttribute("font-weight", "700");
        lab.textContent = String(traits[a].name).slice(0, 10);
        svg.appendChild(lab);
      }
    }

    // data polygon
    var poly = document.createElementNS(svgNS, "polygon");
    var dpts = [];
    for (var d = 0; d < axes; d++) {
      var v = d < n ? traits[d].str / 5 : 0;
      var dp = pt(d, R * v);
      dpts.push(dp[0].toFixed(1) + "," + dp[1].toFixed(1));
    }
    poly.setAttribute("points", dpts.join(" "));
    poly.setAttribute("fill", "currentColor");
    poly.setAttribute("fill-opacity", "0.22");
    poly.setAttribute("stroke", "currentColor");
    poly.setAttribute("stroke-width", "2");
    svg.appendChild(poly);

    // vertex dots
    for (var v2 = 0; v2 < n; v2++) {
      var cp = pt(v2, R * traits[v2].str / 5);
      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", cp[0].toFixed(1));
      dot.setAttribute("cy", cp[1].toFixed(1));
      dot.setAttribute("r", "2.5");
      dot.setAttribute("fill", "currentColor");
      svg.appendChild(dot);
    }
    return svg;
  }

  // ---------- Compare panel (Relationships tab) ----------
  function renderComparePanel(host, chars) {
    var box = el("div", null);
    box.style.cssText = "margin-bottom:14px;";

    var head = el("div", "view-head");
    head.appendChild(el("h2", null, t("cmp.title")));
    box.appendChild(head);

    var row = el("div", null);
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;";
    var selA = buildCharSelect(chars, ui.compare[0]);
    var selB = buildCharSelect(chars, ui.compare[1]);
    var mid = el("span", null, "↔");
    mid.style.cssText = "align-self:center;color:var(--text-dim);font-weight:800;";
    row.appendChild(selA);
    row.appendChild(mid);
    row.appendChild(selB);
    box.appendChild(row);

    var body = el("div", null);
    box.appendChild(body);

    function repaint() {
      ui.compare[0] = selA.value || null;
      ui.compare[1] = selB.value || null;
      body.innerHTML = "";
      if (ui.compare[0] && ui.compare[1] && ui.compare[0] !== ui.compare[1]) {
        body.appendChild(buildCompareGrid(ui.compare[0], ui.compare[1]));
      }
    }
    selA.addEventListener("change", repaint);
    selB.addEventListener("change", repaint);
    repaint();

    host.appendChild(box);
  }

  function buildCharSelect(chars, selected) {
    var sel = document.createElement("select");
    sel.className = "pill-select";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = t("cmp.pick");
    sel.appendChild(ph);
    chars.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      if (selected === c.id) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function buildCompareGrid(aId, bId) {
    var wrap = el("div", null);

    // Their mutual relationship ribbon
    var rel = relBetween(aId, bId);
    if (rel) {
      var rib = el("div", null);
      rib.style.cssText =
        "background:var(--accent-soft);border:1px solid var(--accent);" +
        "border-radius:8px;padding:8px 12px;margin-bottom:12px;" +
        "font-size:12.5px;font-weight:700;color:var(--accent);";
      var txt = relTypeLabel(rel.type) +
        (rel.text ? " · " + rel.text : "") +
        (rel.desc ? " — " + rel.desc : "");
      rib.textContent = t("cmp.rels") + ": " + txt;
      wrap.appendChild(rib);
    }

    var grid = el("div", "compare-grid");
    grid.appendChild(compareCol(db.characters[aId]));
    grid.appendChild(compareCol(db.characters[bId]));
    wrap.appendChild(grid);
    return wrap;
  }

  function compareCol(c) {
    var col = el("div", "compare-col");
    var h4 = el("h4", null, c.name);
    h4.style.color = "var(--accent)";
    col.appendChild(h4);
    col.appendChild(el("div", "role", c.role || "—"));

    if (c.bio) {
      var dt = el("dt", null, t("fld.bio"));
      var dd = el("dd", null, c.bio.length > 220 ? c.bio.slice(0, 219) + "…" : c.bio);
      col.appendChild(dt); col.appendChild(dd);
    }
    if (c.traits.length) {
      col.appendChild(el("dt", null, t("fld.traits")));
      c.traits.forEach(function (tr) {
        var bar = el("div", null);
        bar.style.cssText =
          "display:flex;align-items:center;gap:6px;margin:3px 0;";
        var nm = el("span", null, tr.name);
        nm.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        var track = el("span", null);
        track.style.cssText =
          "width:70px;height:6px;border-radius:4px;background:var(--panel-2);display:inline-block;position:relative;flex-shrink:0;";
        var fill = el("span", null);
        fill.style.cssText =
          "position:absolute;left:0;top:0;bottom:0;border-radius:4px;" +
          "background:var(--accent);width:" + (tr.str * 20) + "%;";
        track.appendChild(fill);
        var val = el("span", null, String(tr.str) + "/5");
        val.style.cssText = "font-size:10.5px;color:var(--text-dim);font-weight:700;flex-shrink:0;";
        bar.appendChild(nm); bar.appendChild(track); bar.appendChild(val);
        col.appendChild(bar);
      });
    }
    if (c.goals.length) {
      col.appendChild(el("dt", null, t("fld.goals")));
      c.goals.forEach(function (g) {
        var row = el("div", null, (g.done ? "☑ " : "☐ ") + g.text);
        row.style.cssText = "margin:3px 0;font-size:12px;" +
          (g.done ? "text-decoration:line-through;color:var(--text-dim);" : "");
        col.appendChild(row);
      });
    }
    if (c.traits.length) {
      var rb = buildRadarBox();
      rb.update(c.traits);
      rb.box.style.marginTop = "10px";
      col.appendChild(rb.box);
    }
    return col;
  }

    // ===== SECTION: EXPORTS + SHORTCUTS + BOOT =====

  // ---------- Export popovers ----------
  var exportPopup = null;

  function toggleExportMenu() {
    var pop = $("export-pop");
    if (!pop) return;
    var btn = $("tb-export");
    var rect = btn.getBoundingClientRect();

    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }

    pop.innerHTML = "";
    var md = el("div", "pop-item", ICO.dl + "  " + t("exp.md"));
    var js = el("div", "pop-item", ICO.dl + "  " + t("exp.json"));
    pop.appendChild(md);
    pop.appendChild(js);
    pop.style.top = (rect.bottom + 6) + "px";
    pop.style.left = rect.left + "px";
    pop.hidden = false;

    md.addEventListener("click", function () { pop.hidden = true; exportMD(); });
    js.addEventListener("click", function () { pop.hidden = true; exportJSON(); });
  }

  // ---------- Export: Markdown ----------
  function exportMD() {
    var chars = orderedChars();
    var rels  = orderedRels();

    var buf = [];
    buf.push("# Characters");
    buf.push("");
    buf.push("> Exported on " + new Date().toLocaleString());
    buf.push("");
    buf.push("---");
    buf.push("");

    chars.forEach(function (c) {
      buf.push("## " + c.name);
      buf.push("");
      if (c.role) buf.push("**Role:** " + c.role + "");
      if (c.bio) {
        buf.push("");
        buf.push(c.bio);
      }
      buf.push("");
      if (c.traits.length) {
        buf.push("### Traits");
        buf.push("");
        c.traits.forEach(function (tr) {
          buf.push("- **" + tr.name + "** — intensity " + tr.str + "/5");
        });
        buf.push("");
      }
      if (c.goals.length) {
        // BUG #4 FIX: > 0 instead of > 4 — never drop goals silently
        var active = c.goals.filter(function (g) { return g.text.trim(); });
        if (active.length) {
          buf.push("### Goals");
          buf.push("");
          active.forEach(function (g) {
            buf.push((g.done ? "- [x] " : "- [ ] ") + g.text);
          });
          buf.push("");
        }
      }
      buf.push("---");
      buf.push("");
    });

    if (rels.length) {
      buf.push("## Relationships");
      buf.push("");
      rels.forEach(function (r) {
        var ca = db.characters[r.a], cb = db.characters[r.b];
        if (!ca || !cb) return;
        var label = relTypeLabel(r.type);
        if (r.text) label += " — " + r.text;
        if (r.desc) label += ": " + r.desc;
        buf.push("- **" + ca.name + "** ↔ **" + cb.name + "** : " + label);
      });
      buf.push("");
    }

    var text = buf.join("\n");
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, "characters.md");
  }

  // ---------- Export: JSON ----------
  function exportJSON() {
    var payload = JSON.parse(JSON.stringify(db));   // deep copy
    payload._exportMeta = {
      ver: DATA_VER,
      exportedAt: new Date().toISOString(),
      appVer: APP_VER
    };
    var text = JSON.stringify(payload, null, 2);
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, "characters-data.json");
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    toast("ok", t("toast.exported"));
  }

  // ---------- Shortcuts (forwarded to parent shell) ----------
  var SHORTCUT_MAP = {
    newChar:  "Ctrl+Alt+N",
    export:   "Ctrl+Alt+E"
  };

  function handleAppShortcut(key) {
    if (key === "newChar") {
      openEditor(null);
      return true;
    }
    if (key === "export") {
      toggleExportMenu();
      return true;
    }
    return false;
  }

  // Contract Α: Apps forward Ctrl+Alt+Shift combos via capture-phase
  // handler. This app forwards ONLY its own bindings; everything else
  // bubbles up to the parent for the global SC_DEFS table.
  function registerShortcuts() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var code = e.code || "";
      if (code.indexOf("Key") !== 0) return;
      var letter = code.charAt(code.length - 1).toUpperCase();

      if (letter === "N") {
        e.preventDefault();
        handleAppShortcut("newChar");
        return;
      }
      if (letter === "E") {
        e.preventDefault();
        handleAppShortcut("export");
        return;
      }
    }, true);  // capture phase

    // Non-shift variants (Ctrl+Alt+Letter) handled locally only —
    // they never clash with the shell's Ctrl+Alt+Shift+Letter.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
      var code = e.code || "";
      if (code.indexOf("Key") !== 0) return;
      var letter = code.charAt(code.length - 1).toUpperCase();

      if (letter === "N") {
        e.preventDefault();
        handleAppShortcut("newChar");
      } else if (letter === "E") {
        e.preventDefault();
        handleAppShortcut("export");
      }
    });
  }

  // ---------- Tab wiring ----------
  function wireTabs() {
    var tabs = document.querySelectorAll(".tb-tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        ui.tab = tab.getAttribute("data-tab");
        paint();
      });
    });
  }

  // ---------- Topbar button wiring ----------
  function wireTopbar() {
    $("tb-new").addEventListener("click", function () {
      openEditor(null);
    });
    $("tb-export").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleExportMenu();
    });
    $("tb-help").addEventListener("click", function () {
      openHelp();
    });
    window.addEventListener("click", function (e) {
      var pop = $("export-pop");
      if (pop && !pop.hidden && !pop.contains(e.target)) pop.hidden = true;
    });
  }

  // ---------- Boot ----------
  function boot() {
    console.log("[orOS] characters.js v" + APP_VER + " booted");

    // 1. Palette inheritance & watch
    inheritPalette();
    watchPalette();

    // 2. Language sync with parent
    if (window.orosLang) {
      document.documentElement.lang = window.orosLang;
    } else {
      // Standalone mode: read localStorage or default to EN
      window.orosLang = localStorage.getItem("oros-lang") || "en";
      document.documentElement.lang = window.orosLang;
    }

    // 3. Load DB (try legacy migration first)
    var migrated = migrateLegacy();
    db = loadDB();

    // 4. Register sync slice
    registerSlice();

    // 5. Wire UI
    wireTabs();
    wireTopbar();
    registerShortcuts();

    // 6. Initial paint
    paint();

    // 7. Version badge (cache-busted fetch already handles in HTML)
    var host = document.querySelector("title");
    if (host) host.textContent = t("tab.chars") + " · orOS";
  }

  // Kick-start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})(); // IIFE closes here