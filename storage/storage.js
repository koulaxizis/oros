// ============================================================
// orOS Storage v0.2.0 — Home inventory
// Hierarchy: Space → Room → Furniture → Position → Items
//
// v0.2.0 — inventory wave (Sortly / Homebox parity):
//   - search across every level (name, note, tags, lent to) with
//     the path of each hit; the menu search provider (search.js)
//     reads the same fields
//   - move an item or a whole level (picker tree, cycle guard, Undo)
//   - item photos and a receipt (JPEG re-drawn on a canvas, so no
//     EXIF / location; PDF kept as is) on the orOS disk under
//     /internal/Storage/…, the row keeps file names only
//   - QR labels for spaces / rooms / furniture / positions: an A4
//     sheet whose codes are links to this page (?box=<id>); scanning
//     one with the phone camera opens that place (DL-1: the shell
//     hands "?box=…" back to the frame). In-app "Scan a label" where
//     the browser has BarcodeDetector (same approach as Stock)
//   - value, purchase date, warranty end (reminder in the shell,
//     storageCheckTick, off by default, hour on this device), tags
//   - lent items ("lent to … on …", return by) and a "Lent out" list
//   - value totals per place
//   Pure logic (merge, search, move rules, totals, alerts, links)
//   lives in core.js (OrosStorageCore), shared with the shell.
//
// v0.1.1 — post-audit pass (fixes #3,#5,#6,#7,#15,#16,#18):
//   strict merge-row normalizer (now in core.js), rescue copy of
//   unreadable data, qty floor, nav sanitizer after remote deletes.
//
// Architecture mirrored from the mature orOS apps (mood.js):
//   IIFE · "use strict" · ES5 vars · STRINGS (en/el) + t() ·
//   bilingual seeds { bi } until first rename · flat entity
//   array { ver, ents } · tombstone deletes · registerSlice with
//   deterministic mergeFn · lazy toast · palette inheritance.
// ============================================================
(function () {
  "use strict";

  // ===== VERSION & LANGUAGE =====
  var SCRIPT_V = "0.2.0";
  var C = window.OrosStorageCore;
  var LANG = "en";
  try {
    LANG = (window.parent && window.parent.orosLang) ||
           window.orosLang ||
           (localStorage.getItem("oros-lang") === "el" ? "el" : "en");
    if (LANG !== "el" && LANG !== "en") LANG = "en";
  } catch (e) { /* cross-origin edge — default EN */ }
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  // ===== STRINGS =====
  var STRINGS = {
    en: {
      "aria.location": "Location",
      "home":             "Home",
      "add.space":        "Add space",
      "add.room":        "Add room",
      "add.furniture":    "Add furniture",
      "add.position":     "Add position",
      "add.item":         "Add item",
      "name.label":       "Name",
      "qty.label":        "Quantity",
      "note.label":       "Note (optional)",
      "tags.label":       "Tags (optional, separated by commas)",
      "val.label":        "Value of one (optional)",
      "bought.label":     "Purchase date",
      "warr.label":       "Warranty until",
      "photos.label":     "Photos",
      "photo.add":        "Add a photo",
      "photo.open":       "Photo {n}",
      "photo.remove":     "Remove photo",
      "photo.bad":        "That picture could not be read.",
      "photo.missing":    "Not on this device yet",
      "photo.missingLong": "This file is not on this device's disk yet. Vault Drive brings it over from your other devices.",
      "photo.where":      "Kept in Files › Storage.",
      "rc.label":         "Receipt",
      "rc.add":           "Attach a receipt",
      "rc.open":          "Open the receipt",
      "rc.remove":        "Remove the receipt",
      "rc.bad":           "Only a picture or a PDF up to 10 MB.",
      "nodisk":           "The orOS disk is not available here.",
      "close":            "Close",
      "edit":             "Edit",
      "rename":           "Rename",
      "label.make":       "Make a label",
      "del":              "Delete",
      "cancel":           "Cancel",
      "save":             "Save",
      "more":             "More",
      "actions":          "Actions",
      "confirm.del.space":   "Delete this space and EVERYTHING inside it?",
      "confirm.del.room":    "Delete this room and everything inside it?",
      "confirm.del.furn":    "Delete this furniture and everything inside it?",
      "confirm.del.pos":     "Delete this position and everything inside it?",
      "confirm.del.item":    "Delete this item?",
      "empty.space":       "No spaces yet — create your first one.",
      "empty.room":        "No rooms in this space yet.",
      "empty.furniture":   "No furniture in this room yet.",
      "empty.position":    "No positions on this furniture yet.",
      "empty.item":        "No items in this position yet.",
      "contains":          "{n} inside",
      "contains.items":    "{n} items",
      "toast.saved":      "Saved",
      "toast.deleted":    "Deleted",
      "toast.name.req":   "Name is required",
      "toast.badval":     "Check the value, e.g. 25 or 25.50",
      "back":             "Back",
      // search
      "search":           "Search",
      "search.ph":        "Search names, notes, tags…",
      "search.hint":      "Type to search every space, room, furniture, position and item.",
      "search.none":      "Nothing found.",
      "search.count":     "{n} found",
      "hit.tags":         "Tags",
      "hit.note":         "Note",
      "hit.lent":         "Lent to",
      // move
      "move":             "Move",
      "move.title":       "Move “{n}” to…",
      "move.filter":      "Filter places",
      "move.none":        "There is nowhere else to move this to yet.",
      "move.current":     "here now",
      "move.done":        "Moved to {n}",
      "undo":             "Undo",
      "undone":           "Move undone",
      // value
      "val.here":         "Value here",
      "val.total":        "Total value",
      "val.each":         "{v} each",
      "items.n":          "{n} items",
      // warranty
      "warr.until":       "Warranty until {d}",
      "warr.ended":       "Warranty ended {d}",
      "bought.on":        "Bought {d}",
      // lent
      "lend":             "Lend…",
      "lend.title":       "Lend “{n}”",
      "lend.to":          "Lent to",
      "lend.on":          "Lent on",
      "lend.due":         "Return by (optional)",
      "lend.contacts":    "From Contacts",
      "lend.pick":        "Pick a contact",
      "lend.noContacts":  "No contacts found.",
      "lend.req":         "Who did you lend it to?",
      "lend.dueBad":      "The return date is before the lend date.",
      "lend.returned":    "Returned",
      "lend.back":        "Marked as returned",
      "lent.chip":        "Lent to {p} on {d}",
      "lent.due":         "back by {d}",
      "lent.late":        "late since {d}",
      "lent.title":       "Lent out",
      "lent.none":        "Nothing is lent out.",
      "lent.menu":        "Lent out ({n})",
      // QR labels + scan
      "qr.one":           "QR label",
      "qr.title":         "Print QR labels",
      "qr.hint":          "An A4 sheet of 24 labels (70 × 37 mm). Scanning a label with the phone camera opens that place in Storage.",
      "qr.all":           "All",
      "qr.nonePick":      "None",
      "qr.print":         "Print",
      "qr.empty":         "Add a space, room, furniture or position first.",
      "qr.nothing":       "Pick at least one place.",
      "qr.noqr":          "The QR encoder could not load.",
      "qr.foot":          "Storage · orOS",
      "scan":             "Scan a label",
      "scan.wait":        "Starting the camera…",
      "scan.denied":      "The camera is not available or permission was refused.",
      "scan.unknown":     "That code is not a Storage label on this device.",
      // settings
      "settings":         "Settings",
      "set.cur":          "Currency",
      "set.remind":       "Reminders on this device",
      "set.remindHint":   "Warranty ends (30 days, 7 days and on the day) and return-by dates.",
      "set.off":          "Off",
      "set.at":           "From {h}",
      "type.space":       "Space",
      "type.room":        "Room",
      "type.furniture":   "Furniture",
      "type.position":    "Position",
      "type.item":        "Item"
    },
    el: {
      "aria.location": "Τοποθεσία",
      "home":             "Σπίτι",
      "add.space":        "Προσθήκη χώρου",
      "add.room":        "Προσθήκη δωματίου",
      "add.furniture":    "Προσθήκη επίπλου",
      "add.position":     "Προσθήκη θέσης",
      "add.item":         "Προσθήκη αντικειμένου",
      "name.label":       "Όνομα",
      "qty.label":        "Ποσότητα",
      "note.label":       "Σημείωση (προαιρετικό)",
      "tags.label":       "Ετικέτες (προαιρετικό, χωρισμένες με κόμμα)",
      "val.label":        "Αξία ενός τεμαχίου (προαιρετικό)",
      "bought.label":     "Ημερομηνία αγοράς",
      "warr.label":       "Εγγύηση έως",
      "photos.label":     "Φωτογραφίες",
      "photo.add":        "Πρόσθεσε φωτογραφία",
      "photo.open":       "Φωτογραφία {n}",
      "photo.remove":     "Αφαίρεση φωτογραφίας",
      "photo.bad":        "Δεν ήταν δυνατό να διαβαστεί αυτή η εικόνα.",
      "photo.missing":    "Δεν είναι ακόμα σε αυτή τη συσκευή",
      "photo.missingLong": "Αυτό το αρχείο δεν είναι ακόμα στον δίσκο αυτής της συσκευής. Το Vault Drive το φέρνει από τις άλλες συσκευές σου.",
      "photo.where":      "Φυλάσσεται στα Αρχεία › Storage.",
      "rc.label":         "Απόδειξη",
      "rc.add":           "Επισύναψε απόδειξη",
      "rc.open":          "Άνοιγμα της απόδειξης",
      "rc.remove":        "Αφαίρεση της απόδειξης",
      "rc.bad":           "Μόνο εικόνα ή PDF έως 10 MB.",
      "nodisk":           "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "close":            "Κλείσιμο",
      "edit":             "Επεξεργασία",
      "rename":           "Μετονομασία",
      "label.make":       "Φτιάξε ετικέτα",
      "del":              "Διαγραφή",
      "cancel":           "Άκυρο",
      "save":             "Αποθήκευση",
      "more":             "Περισσότερα",
      "actions":          "Ενέργειες",
      "confirm.del.space":   "Διαγραφή αυτού του χώρου και ΟΛΩΝ των περιεχομένων;",
      "confirm.del.room":    "Διαγραφή αυτού του δωματίου και όλων των περιεχομένων;",
      "confirm.del.furn":    "Διαγραφή αυτού του επίπλου και όλων των περιεχομένων;",
      "confirm.del.pos":     "Διαγραφή αυτής της θέσης και όλων των περιεχομένων;",
      "confirm.del.item":    "Διαγραφή αυτού του αντικειμένου;",
      "empty.space":       "Κανείς χώρος ακόμα — δημιούργησε τον πρώτο σου.",
      "empty.room":        "Κανένα δωμάτιο σε αυτόν τον χώρο ακόμα.",
      "empty.furniture":   "Κανένα έπιπλο σε αυτό το δωμάτιο ακόμα.",
      "empty.position":    "Καμία θέση σε αυτό το έπιπλο ακόμα.",
      "empty.item":        "Κανένα αντικείμενο σε αυτή τη θέση ακόμα.",
      "contains":          "{n} μέσα",
      "contains.items":    "{n} αντικείμενα",
      "toast.saved":      "Αποθηκεύτηκε",
      "toast.deleted":    "Διαγράφτηκε",
      "toast.name.req":   "Απαιτείται όνομα",
      "toast.badval":     "Έλεγξε την αξία, π.χ. 25 ή 25,50",
      "back":             "Πίσω",
      "search":           "Αναζήτηση",
      "search.ph":        "Αναζήτηση σε ονόματα, σημειώσεις, ετικέτες…",
      "search.hint":      "Γράψε για να ψάξεις σε κάθε χώρο, δωμάτιο, έπιπλο, θέση και αντικείμενο.",
      "search.none":      "Δεν βρέθηκε τίποτα.",
      "search.count":     "Βρέθηκαν {n}",
      "hit.tags":         "Ετικέτες",
      "hit.note":         "Σημείωση",
      "hit.lent":         "Δανεισμένο σε",
      "move":             "Μετακίνηση",
      "move.title":       "Μετακίνηση του «{n}» σε…",
      "move.filter":      "Φίλτρο θέσεων",
      "move.none":        "Δεν υπάρχει ακόμα άλλο μέρος για να το μετακινήσεις.",
      "move.current":     "είναι εδώ τώρα",
      "move.done":        "Μετακινήθηκε σε {n}",
      "undo":             "Αναίρεση",
      "undone":           "Η μετακίνηση αναιρέθηκε",
      "val.here":         "Αξία εδώ",
      "val.total":        "Συνολική αξία",
      "val.each":         "{v} το ένα",
      "items.n":          "{n} αντικείμενα",
      "warr.until":       "Εγγύηση έως {d}",
      "warr.ended":       "Η εγγύηση έληξε {d}",
      "bought.on":        "Αγορά {d}",
      "lend":             "Δανεισμός…",
      "lend.title":       "Δανεισμός του «{n}»",
      "lend.to":          "Δανεισμένο σε",
      "lend.on":          "Ημερομηνία δανεισμού",
      "lend.due":         "Επιστροφή έως (προαιρετικό)",
      "lend.contacts":    "Από τις Επαφές",
      "lend.pick":        "Διάλεξε επαφή",
      "lend.noContacts":  "Δεν βρέθηκαν επαφές.",
      "lend.req":         "Σε ποιον το δάνεισες;",
      "lend.dueBad":      "Η ημερομηνία επιστροφής είναι πριν από τον δανεισμό.",
      "lend.returned":    "Επιστράφηκε",
      "lend.back":        "Σημειώθηκε ότι επιστράφηκε",
      "lent.chip":        "Δανεισμένο σε {p} στις {d}",
      "lent.due":         "επιστροφή έως {d}",
      "lent.late":        "καθυστερεί από {d}",
      "lent.title":       "Δανεισμένα",
      "lent.none":        "Δεν έχεις δανείσει τίποτα.",
      "lent.menu":        "Δανεισμένα ({n})",
      "qr.one":           "Ετικέτα QR",
      "qr.title":         "Εκτύπωση ετικετών QR",
      "qr.hint":          "Μια σελίδα A4 με 24 ετικέτες (70 × 37 mm). Αν σαρώσεις μια ετικέτα με την κάμερα του κινητού, ανοίγει εκείνη η θέση στην Αποθήκη.",
      "qr.all":           "Όλα",
      "qr.nonePick":      "Κανένα",
      "qr.print":         "Εκτύπωση",
      "qr.empty":         "Πρόσθεσε πρώτα έναν χώρο, δωμάτιο, έπιπλο ή θέση.",
      "qr.nothing":       "Διάλεξε τουλάχιστον μία θέση.",
      "qr.noqr":          "Δεν φορτώθηκε ο κωδικοποιητής QR.",
      "qr.foot":          "Αποθήκη · orOS",
      "scan":             "Σάρωση ετικέτας",
      "scan.wait":        "Ξεκινά η κάμερα…",
      "scan.denied":      "Η κάμερα δεν είναι διαθέσιμη ή δεν δόθηκε άδεια.",
      "scan.unknown":     "Αυτός ο κωδικός δεν είναι ετικέτα της Αποθήκης σε αυτή τη συσκευή.",
      "settings":         "Ρυθμίσεις",
      "set.cur":          "Νόμισμα",
      "set.remind":       "Υπενθυμίσεις σε αυτή τη συσκευή",
      "set.remindHint":   "Λήξη εγγύησης (30 ημέρες, 7 ημέρες και την ίδια μέρα) και ημερομηνίες επιστροφής.",
      "set.off":          "Ανενεργές",
      "set.at":           "Από τις {h}",
      "type.space":       "Χώρος",
      "type.room":        "Δωμάτιο",
      "type.furniture":   "Έπιπλο",
      "type.position":    "Θέση",
      "type.item":        "Αντικείμενο"
    }
  };

  function t(key, vars) {
    var p = STRINGS[LANG] || {};
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function fmt(key, n) {
    return t(key).replace("{n}", String(n));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function todayYmd() { return C.ymdOf(new Date()); }
  function fmtDate(ymd) {
    if (!C.isYmd(ymd)) return "";
    try {
      return new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
        .toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ymd; }
  }

  // ===== CONSTANTS & HIERARCHY =====
  var DATA_KEY = "oros-storage-data";
  var BROKEN_KEY = "oros-storage-data-broken";   // local rescue copy, never synced
  var PREFS_KEY = "oros-storage-prefs";          // device-local: { remind, cur }
  var DATA_VER = 1;

  // type → child type; the drill-down spine of the app
  var LEVELS = C.LEVELS;

  // ===== SEEDS (bilingual until first rename) =====
  var SEEDS = [
    { id: "seed-sp-home", type: "space", bi: { en: "Home", el: "Σπίτι" }, pos: 0 }
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ===== PREFS (device-local, never synced) =====
  function readPrefs() {
    try { return C.readPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); }
    catch (e) { return C.readPrefs(null); }
  }
  function writePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(C.readPrefs(p))); } catch (e) {}
  }
  var prefs = readPrefs();
  function money(cents) { return C.money(cents, prefs.cur, LANG); }

  // ===== DATA LAYER =====
  var db = null;   // in-memory state; persisted atomically on every mutation

  // Local-write normalizer: fills in defaults for rows WE create
  // or sanitize on load/normalize. Never used inside the merge —
  // see C.mergeRow() for the strict, volatility-free counterpart.
  // The wave-2 fields go through the SAME C.extras() as the merge.
  function entDefaults(raw) {
    var e = {
      id:       (typeof raw.id === "string" && raw.id) ? raw.id : uid(),
      type:     (LEVELS[raw.type] ? raw.type : null),
      name:     (typeof raw.name === "string") ? raw.name : "",
      bi:       (raw.bi && typeof raw.bi === "object" &&
                 (raw.bi.en || raw.bi.el)) ? { en: raw.bi.en || "", el: raw.bi.el || "" } : null,
      parentId: (typeof raw.parentId === "string" && raw.parentId) ? raw.parentId : null,
      qty:      (raw.type === "item" && typeof raw.qty === "number" &&
                 isFinite(raw.qty) && raw.qty > 0)
                  ? Math.max(1, Math.floor(raw.qty))
                  : (raw.type === "item" ? 1 : undefined),
      note:     (raw.type === "item" && typeof raw.note === "string")
                  ? raw.note.slice(0, 300) : undefined,
      pos:      (typeof raw.pos === "number" && isFinite(raw.pos)) ? raw.pos : 0,
      mtime:    (typeof raw.mtime === "number" && isFinite(raw.mtime)) ? raw.mtime : Date.now(),
      del:      !!raw.del
    };
    if (e.type) C.extras(raw, e.type, e);
    return e;
  }

  // Display name: an explicit rename (plain string) beats the seed's
  // bilingual pair; seeds resolve per active language until then.
  function nameOf(e) { return C.nameOf(e, LANG); }

  // LOAD with rescue backup (#5): if the stored raw data cannot be
  // parsed or normalized, copy it verbatim to BROKEN_KEY before we
  // give up — dbInit's re-seed can then no longer destroy the only
  // copy. BROKEN_KEY is deliberately NOT part of any sync slice.
  function dbLoad() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) { raw = null; }
    if (!raw) return null;

    function rescue(reason, err) {
      try { localStorage.setItem(BROKEN_KEY, raw); } catch (e2) { /* quota — nothing more we can do */ }
      console.error("[orOS] storage: " + reason +
                    " — raw data backed up to " + BROKEN_KEY, err || "");
    }

    var obj = null;
    try { obj = JSON.parse(raw); }
    catch (parseErr) { rescue("dbLoad parse failed", parseErr); return null; }

    var norm = normalize(obj);
    if (!norm) { rescue("dbLoad shape invalid"); return null; }
    return norm;
  }

  var persistWarned = false;
  function dbPersist() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(db)); }
    catch (e) {
      console.error("[orOS] storage: persist failed:", e);
      if (!persistWarned) { persistWarned = true; notifyTransient("⚠ " + (LANG === "el" ? "Ο χώρος του browser γέμισε" : "Browser storage is full")); }
    }
  }

  // MIGRATE / NORMALIZE — never destructive: every inbound entity
  // passes entDefaults (known types only, qty floor, note clamp),
  // then dedupe by id (first occurrence wins).
  function normalize(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.ents)) return null;
    var seen = {}, ents = [];
    for (var i = 0; i < obj.ents.length; i++) {
      if (!obj.ents[i] || typeof obj.ents[i] !== "object") continue;
      var e = entDefaults(obj.ents[i]);
      if (!e.type) continue;              // garbage — cannot exist anywhere
      if (seen[e.id]) continue;           // dedupe by id
      seen[e.id] = true;
      ents.push(e);
    }
    return { ver: DATA_VER, ents: ents };
  }

  // ST-7: seeds carry mtime 0, never "now". A fresh device used to
  // seed "Home" with the current time, so its untouched seed beat an
  // older rename or delete made on another device (Q3 / R16).
  function seedDb() {
    var ents = [];
    SEEDS.forEach(function (s, i) {
      ents.push(entDefaults({
        id: s.id, type: s.type, bi: s.bi,
        parentId: null, pos: i, mtime: 0, del: false
      }));
    });
    return { ver: DATA_VER, ents: ents };
  }

  function dbInit() {
    db = dbLoad();
    if (!db) { db = seedDb(); dbPersist(); }
  }

  // ===== QUERY HELPERS =====
  function children(type, parentId) {
    var out = [];
    for (var i = 0; i < db.ents.length; i++) {
      var e = db.ents[i];
      if (e.type === type && e.parentId === parentId && !e.del) out.push(e);
    }
    out.sort(function (a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : 1); });
    return out;
  }

  function byId(id) {
    for (var i = 0; i < db.ents.length; i++) {
      if (db.ents[i].id === id) return db.ents[i];
    }
    return null;
  }

  // Recursive descendant count (for "3 inside" meta)
  function countDescendants(id) {
    var n = 0;
    for (var i = 0; i < db.ents.length; i++) {
      var e = db.ents[i];
      if (!e.del && e.parentId === id) n += 1 + countDescendants(e.id);
    }
    return n;
  }

  // ===== MUTATIONS (all funnel through save()) =====
  function touch(e) { e.mtime = Date.now(); }

  function save() {
    dbPersist();
    if (syncApi && typeof syncApi.markDirty === "function") {
      syncApi.markDirty();
    }
  }

  function addEnt(type, parentId, name, extra) {
    var raw = {
      id: (extra && extra.id) || uid(), type: type, name: String(name || "").trim(),
      parentId: parentId || null,
      pos: children(type, parentId || null).length,
      mtime: Date.now(), del: false
    };
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== "id") raw[k] = extra[k]; });
    var e = entDefaults(raw);
    db.ents.push(e);
    save();
    return e;
  }

  // Delete with cascade: descendants get tombstoned too (tombstones
  // propagate through merge — a delete made on ANY device wins).
  // Their photos / receipts leave this device's disk once no live row
  // points at them any more.
  function deleteEnt(e) {
    var files = [];
    function collect(x) { (x.ph || []).forEach(function (n) { files.push(["ph", n]); }); if (x.rc) files.push(["rc", x.rc]); }
    function tombRecursive(id) {
      for (var i = 0; i < db.ents.length; i++) {
        var c = db.ents[i];
        if (c.parentId === id && !c.del) { collect(c); c.del = true; touch(c); tombRecursive(c.id); }
      }
    }
    collect(e);
    e.del = true;
    touch(e);
    tombRecursive(e.id);
    save();
    dropFilesLater(files, 1500);
  }

  function setQty(e, delta) {
    var q = (typeof e.qty === "number" ? e.qty : 1) + delta;
    e.qty = q < 1 ? 1 : q;        // Wave 1 floor: quantity never below 1
    touch(e);
    save();
  }

  // ===== MERGE ENGINE (core.js) =====
  // union by id · LWW by mtime · tombstone wins ties · deterministic;
  // ST-9 pruning (tombstones older than newest mtime − 30 days).
  function mergeData(local, remote) { return C.mergeData(local, remote); }

  // ===== SYNC REGISTRATION =====
  var syncApi = null;
  try {
    syncApi = (window.parent && window.parent.orosSync) || window.orosSync || null;
  } catch (e) { syncApi = window.orosSync || null; }

  function sliceGet() {
    // ST-1 / ST-9: the payload is the canonical merge form (rows
    // normalized + sorted by id, same pruning as mergeData), so
    // merge(get, get) === get and two devices never ping-pong.
    return { ver: db.ver, ents: C.prunePayload(C.mergeEnts(db.ents, [])) };
  }

  // Nav-target sanitizer (#3): if the entity the user is currently
  // viewing was deleted or vanished remotely, climb to the nearest
  // SURVIVING ancestor — never render a dead reference.
  function sanitizeNav() {
    if (!nav.id) return;
    var cur = byId(nav.id);
    if (!cur) { nav.id = null; return; }   // pruned entirely — no ancestry to follow
    if (!cur.del) return;                  // alive — keep
    while (cur && cur.del && cur.parentId) cur = byId(cur.parentId);
    nav.id = (cur && !cur.del) ? cur.id : null;
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.ents)) return;
    var next = normalize({ ver: data.ver, ents: data.ents });
    if (!next) return;
    db = next;
    dbPersist();
    sanitizeNav();               // BEFORE render — no dead-target empty states
    render();
    // ST-2: no per-sync toast (the taskbar sync dot says it).
  }

  function registerSync() {
    if (!syncApi || typeof syncApi.registerSlice !== "function") return;
    syncApi.registerSlice("storage", sliceGet, sliceSet, DATA_KEY, mergeData);
  }

  // ===== NAVIGATION & RENDER =====

  // nav.id === null → root (list of spaces). Navigating INTO a
  // non-item entity shows its children. Items are leaves — no nav.
  // mode: "browse" (the levels), "search" or "lent" (the Lent out list)
  var nav = { id: null };
  var mode = "browse";
  var flashId = null;            // an item to scroll to and highlight once

  // Inline SVG icon set (ForkAwesome exiled, handcrafted forever)
  var ICO = {
    space:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    room:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="15.5" cy="12" r="1.2"/></svg>',
    furniture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5"/><path d="M5 11v9M19 11v9M9.5 8.5h5"/></svg>',
    position:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M12 4v16"/></svg>',
    item:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    plus:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pencil:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>',
    trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    tag:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/></svg>',
    chev:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    search:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    dots:      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    move:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    qr:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    hand:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M11 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg>',
    cam:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 12h10"/></svg>',
    gear:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };

  function iconSvg(type) {
    return '<span class="ico">' + (ICO[type] || ICO.item) + '</span>';
  }

  // Child type listed at the current nav position
  function childTypeFor(navId) {
    if (!navId) return "space";
    var ent = byId(navId);
    if (!ent) return "space";
    return LEVELS[ent.type] ? (LEVELS[ent.type].child || "item") : "space";
  }

  // Desktop split view: the scrolling element is .main-pane, not
  // #view (#8 in v0.1.0) — reset whichever is present.
  function resetScroll() {
    var view = document.getElementById("view");
    if (!view) return;
    view.scrollTop = 0;
    var pane = view.querySelector(".main-pane");
    if (pane) pane.scrollTop = 0;
  }

  function goTo(id) {
    nav.id = id;
    mode = "browse";
    render();
    resetScroll();
    if (flashId) {
      var row = document.querySelector('[data-id="' + cssId(flashId) + '"]');
      flashId = null;
      if (row) {
        row.classList.add("flash");
        try { row.scrollIntoView({ block: "center" }); } catch (e) {}
        setTimeout(function () { row.classList.remove("flash"); }, 2200);
      }
    }
  }
  function cssId(id) { return String(id).replace(/["\\]/g, ""); }

  // open a row: an item opens its position (flashing the item), a
  // level opens itself
  function openEnt(id) {
    var e = byId(id);
    if (!e || !C.isAlive(db.ents, id)) return;
    if (e.type === "item") { flashId = e.id; goTo(e.parentId); }
    else goTo(e.id);
  }

  function goUp() {
    if (mode !== "browse") { mode = "browse"; render(); return; }
    if (!nav.id) return;
    var ent = byId(nav.id);
    goTo(ent ? ent.parentId : null);
  }

  // Breadcrumb chain: root → … → current entity
  function chainFor(id) {
    var chain = [];
    var cur = id ? byId(id) : null;
    while (cur && !cur.del) {
      chain.unshift(cur);
      cur = cur.parentId ? byId(cur.parentId) : null;
    }
    return chain;
  }

  function renderCrumbs() {
    var host = document.getElementById("crumbs");
    host.innerHTML = "";

    if (mode !== "browse") {
      var only = el("span", "crumb active", mode === "search" ? t("search") : t("lent.title"));
      host.appendChild(only);
      return;
    }

    var home = document.createElement("button");
    home.className = "crumb" + (nav.id ? "" : " active");
    home.type = "button";
    home.textContent = t("home");
    home.addEventListener("click", function () { goTo(null); });
    host.appendChild(home);

    var chain = chainFor(nav.id);
    for (var i = 0; i < chain.length; i++) {
      (function (ent, isLast) {
        var sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "›";
        host.appendChild(sep);
        var c = document.createElement("button");
        c.className = "crumb" + (isLast ? " active" : "");
        c.type = "button";
        c.textContent = nameOf(ent);
        c.addEventListener("click", function () { goTo(ent.id); });
        host.appendChild(c);
      })(chain[i], i === chain.length - 1);
    }
    // the last crumb in view on a narrow bar
    setTimeout(function () { host.scrollLeft = host.scrollWidth; }, 0);
  }

  // ----- Content pane (shared: mobile main + desktop main-pane) -----

  function mkEmpty(typeKey) {
    var box = document.createElement("div");
    box.className = "empty";
    box.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 7l2-4h14l2 4"/><path d="M10 11h4"/></svg>' +
      '<div>' + esc(t(typeKey)) + '</div>';
    return box;
  }

  var TOT = {};                  // C.totals() of the current render

  // Entity card (space/room/furniture/position) — tap to drill in
  function mkEntCard(ent) {
    var row = document.createElement("div");
    row.className = "item-row";
    row.setAttribute("role", "button");
    row.setAttribute("data-id", ent.id);
    row.tabIndex = 0;

    var info = document.createElement("div");
    info.className = "item-info";
    var nm = document.createElement("div");
    nm.className = "item-name";
    nm.innerHTML = iconSvg(ent.type) + esc(nameOf(ent));
    var meta = document.createElement("div");
    meta.className = "item-meta";
    var childT = LEVELS[ent.type].child;
    var n = countDescendants(ent.id);
    var bits = [];
    if (childT === "item") bits.push(fmt("contains.items", n));
    else if (n) bits.push(fmt("contains", n));
    var tot = TOT[ent.id];
    if (tot && tot.v) bits.push(money(tot.v));
    meta.textContent = bits.join(" · ");
    info.appendChild(nm);
    info.appendChild(meta);
    if (ent.note) info.appendChild(el("div", "item-meta item-note", ent.note));
    if (ent.tags && ent.tags.length) info.appendChild(tagChips(ent.tags));
    row.appendChild(info);

    var acts = document.createElement("div");
    acts.className = "card-actions";

    var lbl = mkLabelBtn(ent);
    if (lbl) acts.appendChild(lbl);

    acts.appendChild(mkIconBtn(ICO.pencil, t("rename"), function (ev) {
      ev.stopPropagation();
      openEntityDialog("rename", ent);
    }));
    acts.appendChild(mkIconBtn(ICO.dots, t("more") + ": " + nameOf(ent), function (ev) {
      ev.stopPropagation();
      openActions(ent);
    }));
    var chev = mkIconBtn(ICO.chev, nameOf(ent), function (ev) { ev.stopPropagation(); goTo(ent.id); });
    chev.classList.add("chev");
    acts.appendChild(chev);

    row.appendChild(acts);

    row.addEventListener("click", function () { goTo(ent.id); });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target === row) goTo(ent.id);
    });
    return row;
  }

  function tagChips(tags) {
    var box = el("div", "chips");
    tags.forEach(function (tg) { box.appendChild(el("span", "chip tagc", "#" + tg)); });
    return box;
  }

  // Item row — leaf: photo, qty −/+ controls, edit, more
  function mkItemRow(ent) {
    var row = document.createElement("div");
    row.className = "item-row leaf";
    row.setAttribute("data-id", ent.id);

    if (ent.ph && ent.ph.length) {
      var th = el("button", "thumb");
      th.type = "button";
      th.setAttribute("aria-label", t("photo.open", { n: 1 }));
      thumbInto(th, "ph", ent.ph[0]);
      th.addEventListener("click", function () { viewFile("ph", ent.ph[0], null); });
      row.appendChild(th);
    }

    var info = document.createElement("div");
    info.className = "item-info";
    var nm = document.createElement("div");
    nm.className = "item-name";
    nm.innerHTML = iconSvg("item") + esc(nameOf(ent));
    info.appendChild(nm);
    if (ent.note) {
      var meta = document.createElement("div");
      meta.className = "item-meta item-note";
      meta.textContent = ent.note;
      info.appendChild(meta);
    }
    var chips = el("div", "chips");
    if (ent.val) {
      chips.appendChild(el("span", "chip", (ent.qty > 1 ? t("val.each", { v: money(ent.val) }) : money(ent.val))));
    }
    if (ent.lent) {
      var lc = el("span", "chip lentc", t("lent.chip", { p: ent.lent.to, d: fmtDate(ent.lent.on) }) +
        (ent.lent.due ? " · " + (ent.lent.due < todayYmd() ? t("lent.late", { d: fmtDate(ent.lent.due) }) : t("lent.due", { d: fmtDate(ent.lent.due) })) : ""));
      if (ent.lent.due && ent.lent.due < todayYmd()) lc.classList.add("warn");
      chips.appendChild(lc);
    }
    if (ent.warr) {
      var dl = C.daysBetween(todayYmd(), ent.warr);
      var wc = el("span", "chip", dl < 0 ? t("warr.ended", { d: fmtDate(ent.warr) }) : t("warr.until", { d: fmtDate(ent.warr) }));
      if (dl <= 30) wc.classList.add("warn");
      chips.appendChild(wc);
    }
    (ent.tags || []).forEach(function (tg) { chips.appendChild(el("span", "chip tagc", "#" + tg)); });
    if (chips.children.length) info.appendChild(chips);
    row.appendChild(info);

    var qty = document.createElement("div");
    qty.className = "qty-controls";
    var minus = document.createElement("button");
    minus.type = "button";
    minus.className = "qty-btn";
    minus.setAttribute("aria-label", "−1");
    minus.textContent = "−";
    minus.addEventListener("click", function () { setQty(ent, -1); render(); });
    qty.appendChild(minus);
    var val = document.createElement("span");
    val.className = "qty-val";
    val.textContent = String(ent.qty);
    qty.appendChild(val);
    var plus = document.createElement("button");
    plus.type = "button";
    plus.className = "qty-btn";
    plus.setAttribute("aria-label", "+1");
    plus.textContent = "+";
    plus.addEventListener("click", function () { setQty(ent, 1); render(); });
    qty.appendChild(plus);
    row.appendChild(qty);

    var acts = document.createElement("div");
    acts.className = "card-actions";
    acts.appendChild(mkIconBtn(ICO.pencil, t("edit"), function () {
      openEntityDialog("rename", ent);
    }));
    acts.appendChild(mkIconBtn(ICO.dots, t("more") + ": " + nameOf(ent), function () {
      openActions(ent);
    }));
    row.appendChild(acts);
    return row;
  }

  // "Make a label": opens the Label Maker with this name on the tape
  // (__orosOpenAt("labels", { text })). Hidden outside the shell.
  function mkLabelBtn(ent) {
    var shell = null;
    try { shell = window.parent && window.parent !== window ? window.parent : null; } catch (e) {}
    if (!shell || typeof shell.__orosOpenAt !== "function") return null;
    return mkIconBtn(ICO.tag, t("label.make") + ": " + nameOf(ent), function (ev) {
      ev.stopPropagation();
      try { shell.__orosOpenAt("labels", { text: nameOf(ent) }); } catch (e) {}
    });
  }

  function mkIconBtn(svg, label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn ghost";
    b.setAttribute("aria-label", label || "");
    b.setAttribute("title", label || "");
    b.innerHTML = svg;
    b.addEventListener("click", fn);
    return b;
  }

  function totalBar(id) {
    var tot = TOT[id || ""];
    if (!tot || !tot.v) return null;
    var bar = el("div", "total-bar");
    bar.appendChild(el("span", "", (id ? t("val.here") : t("val.total")) + ": "));
    bar.appendChild(el("b", "", money(tot.v)));
    bar.appendChild(el("span", "dim", " · " + t("items.n", { n: tot.n })));
    return bar;
  }

  function paneBrowse() {
    var childT = childTypeFor(nav.id);
    var wrap = document.createElement("div");
    wrap.className = "content-pane";

    var tb = totalBar(nav.id);
    if (tb) wrap.appendChild(tb);
    var cur = nav.id ? byId(nav.id) : null;
    if (cur && (cur.note || (cur.tags && cur.tags.length))) {
      var head = el("div", "place-head");
      if (cur.note) head.appendChild(el("div", "item-meta", cur.note));
      if (cur.tags && cur.tags.length) head.appendChild(tagChips(cur.tags));
      wrap.appendChild(head);
    }

    var kids = children(childT, nav.id);
    if (!kids.length) {
      wrap.appendChild(mkEmpty("empty." + childT));
      return wrap;
    }

    var list = document.createElement("div");
    list.className = "item-list";
    for (var i = 0; i < kids.length; i++) {
      list.appendChild(childT === "item" ? mkItemRow(kids[i]) : mkEntCard(kids[i]));
    }
    wrap.appendChild(list);
    return wrap;
  }

  // ----- Search -----
  var searchInput = null;        // kept across renders (a sync keeps the caret)
  var searchQ = "";
  function getSearchInput() {
    if (searchInput) return searchInput;
    searchInput = el("input", "search-input");
    searchInput.type = "search";
    searchInput.placeholder = t("search.ph");
    searchInput.setAttribute("aria-label", t("search"));
    searchInput.setAttribute("enterkeyhint", "search");
    searchInput.addEventListener("input", function () {
      searchQ = searchInput.value;
      paintResults();
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = document.querySelector(".results .item-row");
        if (first) first.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (searchInput.value) { searchInput.value = ""; searchQ = ""; paintResults(); }
        else goUp();
      }
    });
    return searchInput;
  }
  function paneSearch() {
    var wrap = el("div", "content-pane");
    var inp = getSearchInput();
    if (inp.value !== searchQ) inp.value = searchQ;
    wrap.appendChild(inp);
    var res = el("div", "results");
    res.setAttribute("aria-live", "polite");
    wrap.appendChild(res);
    return wrap;
  }
  function paintResults() {
    var res = document.querySelector(".results");
    if (!res) return;
    res.innerHTML = "";
    var q = searchQ.trim();
    if (!q) { res.appendChild(el("p", "hint", t("search.hint"))); return; }
    var hits = C.search(db.ents, q, LANG, 200);
    if (!hits.length) { res.appendChild(el("p", "hint", t("search.none"))); return; }
    res.appendChild(el("p", "hint", t("search.count", { n: hits.length })));
    var list = el("div", "item-list");
    hits.forEach(function (h) {
      var row = el("div", "item-row hit");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      var info = el("div", "item-info");
      var nm = el("div", "item-name");
      nm.innerHTML = iconSvg(h.type) + esc(h.name || "—");
      info.appendChild(nm);
      info.appendChild(el("div", "item-meta path", h.path.length ? h.path.join(" › ") : t("type." + h.type)));
      var extra = "";
      if (h.field === "tags") extra = t("hit.tags") + ": " + h.tags.map(function (x) { return "#" + x; }).join(" ");
      else if (h.field === "lent" && h.lent) extra = t("hit.lent") + ": " + h.lent.to;
      else if (h.note) extra = h.note;
      if (extra) info.appendChild(el("div", "item-meta item-note", extra));
      row.appendChild(info);
      var go = function () { openEnt(h.id); };
      row.addEventListener("click", go);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      list.appendChild(row);
    });
    res.appendChild(list);
  }

  // ----- Lent out -----
  function paneLent() {
    var wrap = el("div", "content-pane");
    var list = C.lentList(db.ents, LANG);
    if (!list.length) { wrap.appendChild(mkEmpty("lent.none")); return wrap; }
    var box = el("div", "item-list");
    var today = todayYmd();
    list.forEach(function (x) {
      var row = el("div", "item-row");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      var info = el("div", "item-info");
      var nm = el("div", "item-name");
      nm.innerHTML = iconSvg("item") + esc(x.name);
      info.appendChild(nm);
      var line = t("lent.chip", { p: x.to, d: fmtDate(x.on) });
      var ln = el("div", "item-meta", line);
      info.appendChild(ln);
      if (x.due) {
        var late = x.due < today;
        var dd = el("div", "item-meta" + (late ? " warn" : ""), late ? t("lent.late", { d: fmtDate(x.due) }) : t("lent.due", { d: fmtDate(x.due) }));
        info.appendChild(dd);
      }
      info.appendChild(el("div", "item-meta path", x.path.join(" › ")));
      row.appendChild(info);
      var ret = el("button", "btn", t("lend.returned"));
      ret.type = "button";
      ret.addEventListener("click", function (ev) { ev.stopPropagation(); markReturned(x.id); });
      row.appendChild(ret);
      row.addEventListener("click", function () { openEnt(x.id); });
      row.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target === row) openEnt(x.id); });
      box.appendChild(row);
    });
    wrap.appendChild(box);
    return wrap;
  }

  function paneContent() {
    if (mode === "search") return paneSearch();
    if (mode === "lent") return paneLent();
    return paneBrowse();
  }

  // ----- Desktop sidebar tree (≥1024px) -----

  function treeContent() {
    var tree = document.createElement("ul");
    tree.className = "tree";
    buildTreeLevel(tree, "space", null, 0);
    return tree;
  }

  function buildTreeLevel(host, type, parentId, depth) {
    var kids = children(type, parentId);
    for (var i = 0; i < kids.length; i++) {
      (function (ent) {
        var li = document.createElement("li");
        li.setAttribute("data-depth", String(depth));
        var it = document.createElement("div");
        it.className = "item" + (nav.id === ent.id && mode === "browse" ? " active" : "");
        it.setAttribute("role", "button");
        it.tabIndex = 0;
        it.innerHTML = iconSvg(ent.type) + "<span>" + esc(nameOf(ent)) + "</span>";
        it.addEventListener("click", function () { goTo(ent.id); });
        it.addEventListener("keydown", function (e) {
          if (e.key === "Enter") goTo(ent.id);
        });
        li.appendChild(it);
        host.appendChild(li);
        var childT = LEVELS[type].child;
        if (childT && childT !== "item") {
          var sub = document.createElement("ul");
          sub.className = "tree";
          buildTreeLevel(sub, childT, ent.id, depth + 1);
          if (sub.children.length) li.appendChild(sub);
        }
      })(kids[i]);
    }
  }

  // ===== MAIN RENDER =====

  function render() {
    TOT = C.totals(db.ents);
    renderCrumbs();

    // Top bar: back button + add-button label follow the level
    var back = document.getElementById("btn-back");
    if (nav.id || mode !== "browse") { back.hidden = false; back.textContent = "‹ " + t("back"); }
    else { back.hidden = true; }

    var childT = childTypeFor(nav.id);
    var add = document.getElementById("btn-add");
    add.innerHTML = ICO.plus + "<span>" + esc(t("add." + childT)) + "</span>";
    add.setAttribute("aria-label", t("add." + childT));
    add.hidden = mode !== "browse";
    var sb = document.getElementById("btn-search");
    if (sb) sb.classList.toggle("on", mode === "search");

    // View pane — keep the search field (and its caret) across renders
    var view = document.getElementById("view");
    var hadFocus = searchInput && document.activeElement === searchInput;
    view.innerHTML = "";

    var desktop = window.matchMedia("(min-width: 1024px)").matches;
    if (desktop) {
      var side = document.createElement("aside");
      side.className = "sidebar";
      side.appendChild(treeContent());
      view.appendChild(side);
      var main = document.createElement("section");
      main.className = "main-pane";
      main.appendChild(paneContent());
      view.appendChild(main);
    } else {
      view.appendChild(paneContent());
    }
    if (mode === "search") {
      paintResults();
      if (hadFocus) try { searchInput.focus(); } catch (e) {}
    }
  }

  function openSearch() {
    if (document.querySelector("dialog[open]")) return;
    mode = "search";
    render();
    resetScroll();
    var inp = getSearchInput();
    try { inp.focus(); inp.select(); } catch (e) {}
  }
  function openLent() {
    mode = "lent";
    render();
    resetScroll();
  }

  // ===== DIALOGS =====
  function mkDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    if (title) dlg.appendChild(el("h3", "", title));
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();      // outside click = cancel
    });
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    return dlg;
  }
  function showDlg(dlg) {
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function btn(label, cls, fn) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  // ----- action sheet (⋯ on a card) -----
  function openActions(ent) {
    var dlg = mkDialog("act-dialog", nameOf(ent));
    dlg.classList.add("sheet");
    var list = el("div", "sheet-list");
    function add(svg, label, fn, cls) {
      var b = el("button", "sheet-btn" + (cls ? " " + cls : ""));
      b.type = "button";
      b.innerHTML = svg + "<span>" + esc(label) + "</span>";
      b.addEventListener("click", function () { dlg.close(); fn(); });
      list.appendChild(b);
    }
    if (LEVELS[ent.type].parent) add(ICO.move, t("move") + "…", function () { openMoveDialog(ent); });
    if (ent.type === "item") {
      add(ICO.hand, ent.lent ? t("lend.returned") : t("lend"), function () {
        if (ent.lent) markReturned(ent.id); else openLendDialog(ent);
      });
    } else {
      add(ICO.qr, t("qr.one") + "…", function () { openQrDialog([ent.id]); });
    }
    add(ICO.trash, t("del"), function () { openConfirmDialog(ent); }, "danger-text");
    dlg.appendChild(list);
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDlg(dlg);
    var first = list.querySelector("button");
    if (first) first.focus();
  }

  // ----- top-bar "More" menu -----
  function openMoreMenu() {
    var dlg = mkDialog("more-dialog", t("more"));
    dlg.classList.add("sheet");
    var list = el("div", "sheet-list");
    function add(svg, label, fn) {
      var b = el("button", "sheet-btn");
      b.type = "button";
      b.innerHTML = svg + "<span>" + esc(label) + "</span>";
      b.addEventListener("click", function () { dlg.close(); fn(); });
      list.appendChild(b);
    }
    add(ICO.hand, t("lent.menu", { n: C.lentList(db.ents, LANG).length }), openLent);
    add(ICO.qr, t("qr.title") + "…", function () { openQrDialog(null); });
    if (camOk()) add(ICO.cam, t("scan"), openScan);
    add(ICO.gear, t("settings") + "…", openSettings);
    dlg.appendChild(list);
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("close"), "ghost", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDlg(dlg);
    list.querySelector("button").focus();
  }

  // ===== FILES ON THE orOS DISK (photos, receipts) =====
  // The row keeps names only; each file lives in Files under
  // Storage/Photos or Storage/Receipts, synced by Vault Drive when the
  // user runs it. Pictures are re-drawn on a canvas (max 1600 px,
  // JPEG): the file we keep has no EXIF / location and no foreign
  // bytes. A PDF receipt is kept as it is (up to 10 MB).
  var IMG_MAX_IN = 40 * 1024 * 1024, PDF_MAX = 10 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function filePath(kind, name) { return kind === "rc" ? C.receiptPath(name) : C.photoPath(name); }
  function rnd() {
    var a = new Uint8Array(6), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function encodeImage(file) {
    return new Promise(function (resolve) {
      if (!file || file.size > IMG_MAX_IN) { resolve(null); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var k = Math.min(1, 1600 / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? b : null); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function rmFile(kind, name) {
    var fs = fsApi(), path = filePath(kind, name);
    if (!fs || !path) return Promise.resolve();
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  // after a delete / an edit: any name no live row points at any more
  // leaves this device's disk
  function dropFilesLater(list, ms) {
    if (!list || !list.length || !fsApi()) return;
    setTimeout(function () {
      var used = C.filesInUse(db.ents);
      list.forEach(function (p) { if (!used[p[0]][p[1]]) rmFile(p[0], p[1]); });
    }, ms || 0);
  }
  function pickFile(accept) {
    var host = null;
    try { host = window.orosDialog || (window.parent && window.parent.orosDialog) || null; } catch (e) {}
    if (host && typeof host.openFile === "function") return Promise.resolve(host.openFile(accept));
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  // small object-URL cache for thumbnails (cleared when it grows)
  var thumbCache = {}, thumbCount = 0;
  function thumbInto(host, kind, name) {
    var key = kind + ":" + name;
    function put(u) {
      var im = el("img");
      im.alt = "";
      im.src = u;
      host.appendChild(im);
    }
    if (thumbCache[key]) { put(thumbCache[key]); return; }
    var fs = fsApi(), path = filePath(kind, name);
    if (!fs || !path) { host.appendChild(el("span", "miss", "?")); host.title = t("photo.missing"); return; }
    Promise.resolve(fs.readBlob(path)).then(function (blob) {
      if (!blob) throw new Error("ENOENT");
      if (thumbCount > 120) {
        Object.keys(thumbCache).forEach(function (k) { URL.revokeObjectURL(thumbCache[k]); });
        thumbCache = {}; thumbCount = 0;
      }
      var u = URL.createObjectURL(blob);
      thumbCache[key] = u; thumbCount++;
      put(u);
    }).catch(function () { host.appendChild(el("span", "miss", "?")); host.title = t("photo.missing"); });
  }
  // a photo or a receipt full size; onRemove (editor only) adds a
  // "Remove" button
  function viewFile(kind, name, onRemove) {
    var dlg = mkDialog("file-view", kind === "rc" ? t("rc.label") : t("photos.label"));
    dlg.classList.add("wide");
    var box = el("div", "file-view");
    dlg.appendChild(box);
    var u = null, fs = fsApi(), path = filePath(kind, name);
    var isPdf = /\.pdf$/.test(name);
    if (fs && path) Promise.resolve(fs.readBlob(path)).then(function (blob) {
      if (!blob) throw new Error("ENOENT");
      u = URL.createObjectURL(isPdf ? new Blob([blob], { type: "application/pdf" }) : blob);
      if (isPdf) {
        var a = el("a", "btn prim", t("rc.open"));
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener";
        box.appendChild(a);
      } else {
        var im = el("img");
        im.alt = kind === "rc" ? t("rc.label") : t("photos.label");
        im.src = u;
        box.appendChild(im);
      }
    }).catch(function () { box.appendChild(el("p", "hint", t("photo.missingLong"))); });
    else box.appendChild(el("p", "hint", t("photo.missingLong")));
    dlg.appendChild(el("p", "hint", t("photo.where")));
    var acts = el("div", "dialog-actions");
    if (onRemove) acts.appendChild(btn(kind === "rc" ? t("rc.remove") : t("photo.remove"), "danger", function () { dlg.close(); onRemove(); }));
    acts.appendChild(btn(t("close"), "prim", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { if (u) setTimeout(function () { URL.revokeObjectURL(u); }, 60000); });
    showDlg(dlg);
  }

  // The photos + receipt fields of the item editor. Files added while
  // it is open are written at once and removed again if the editor is
  // left without saving; files taken off the row leave the disk after
  // the save (when no other live row points at them).
  function fileFields(form, ent, itemId) {
    var fs = fsApi();
    var ph = ent && ent.ph ? ent.ph.slice() : [];
    var rc = ent && ent.rc ? ent.rc : "";
    var origPh = ph.slice(), origRc = rc, added = [], done = false;
    var wrap = el("div", "field");
    if (!fs && !ph.length && !rc) return { wrap: null, ph: function () { return ph.slice(); }, rc: function () { return rc; }, commit: function () {}, abort: function () {} };
    wrap.appendChild(el("label", "", t("photos.label")));
    var grid = el("div", "ph-grid");
    wrap.appendChild(grid);
    var rcRow = el("div", "rc-row");
    var rcWrap = el("div", "field");
    rcWrap.appendChild(el("label", "", t("rc.label")));
    rcWrap.appendChild(rcRow);
    function paint() {
      grid.innerHTML = "";
      ph.forEach(function (name, i) {
        var b = el("button", "ph-th");
        b.type = "button";
        b.setAttribute("aria-label", t("photo.open", { n: i + 1 }));
        thumbInto(b, "ph", name);
        b.addEventListener("click", function () {
          viewFile("ph", name, function () { ph = ph.filter(function (n) { return n !== name; }); dropAdded("ph", name); paint(); });
        });
        grid.appendChild(b);
      });
      if (fs && ph.length < C.PH_MAX) {
        var a = el("button", "ph-th ph-add", "+");
        a.type = "button";
        a.setAttribute("aria-label", t("photo.add"));
        a.title = t("photo.add");
        a.addEventListener("click", addPhoto);
        grid.appendChild(a);
      }
      rcRow.innerHTML = "";
      if (rc) {
        rcRow.appendChild(btn((/\.pdf$/.test(rc) ? "PDF · " : "") + t("rc.open"), "", function () {
          viewFile("rc", rc, function () { var n = rc; rc = ""; dropAdded("rc", n); paint(); });
        }));
      } else if (fs) {
        rcRow.appendChild(btn(t("rc.add"), "", addReceipt));
      }
    }
    function dropAdded(kind, name) {
      var i = -1;
      added.forEach(function (p, k) { if (p[0] === kind && p[1] === name) i = k; });
      if (i >= 0) { added.splice(i, 1); rmFile(kind, name); }
    }
    function write(kind, name, blob) {
      return Promise.resolve(fs.writeBlob(filePath(kind, name), blob)).then(function () {
        if (done) { rmFile(kind, name); return false; }
        added.push([kind, name]);
        return true;
      });
    }
    function addPhoto() {
      pickFile("image/*").then(function (file) {
        if (!file) return;
        return encodeImage(file).then(function (blob) {
          if (!blob) { notifyTransient(t("photo.bad")); return; }
          var name = C.photoName(itemId, rnd());
          if (!name) return;
          return write("ph", name, blob).then(function (ok) { if (ok) { ph.push(name); paint(); } });
        });
      }).catch(function () { notifyTransient(t("nodisk")); });
    }
    function addReceipt() {
      pickFile("image/*,application/pdf,.pdf").then(function (file) {
        if (!file) return;
        var pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
        var p = pdf ? Promise.resolve(file.size <= PDF_MAX ? file : null) : encodeImage(file);
        return p.then(function (blob) {
          if (!blob) { notifyTransient(t("rc.bad")); return; }
          var name = C.receiptName(itemId, rnd(), pdf ? "pdf" : "jpg");
          if (!name) return;
          return write("rc", name, blob).then(function (ok) {
            if (!ok) return;
            if (rc) dropAdded("rc", rc);
            rc = name;
            paint();
          });
        });
      }).catch(function () { notifyTransient(t("nodisk")); });
    }
    form.appendChild(wrap);
    form.appendChild(rcWrap);
    paint();
    return {
      ph: function () { return ph.slice(); },
      rc: function () { return rc; },
      // after a successful save
      commit: function () {
        done = true;
        var gone = [];
        origPh.forEach(function (n) { if (ph.indexOf(n) < 0) gone.push(["ph", n]); });
        if (origRc && origRc !== rc) gone.push(["rc", origRc]);
        dropFilesLater(gone, 0);
      },
      // the editor closed without saving
      abort: function () {
        if (done) return;
        done = true;
        added.forEach(function (p) { rmFile(p[0], p[1]); });
      }
    };
  }

  // add (target type inferred from current level) / rename (entity)
  function openEntityDialog(mode, ent) {
    var type, parentForAdd;
    if (mode === "add") {
      type = childTypeFor(nav.id);
      parentForAdd = nav.id;
    } else {
      type = ent.type;
    }
    var itemId = mode === "add" ? uid() : ent.id;

    var dlg = mkDialog("ent-dialog", null);
    if (type === "item") dlg.classList.add("wide");

    var form = document.createElement("form");
    form.noValidate = true;
    form.className = "dialog-form";

    // Simple title: add → "Add <type>", rename → "Rename" / "Edit" (#10)
    var title = document.createElement("h3");
    title.textContent = (mode === "add") ? t("add." + type) : (type === "item" ? t("edit") : t("rename"));
    form.appendChild(title);

    function mkField(labelKey, inputType, initial, cls) {
      var wrap = document.createElement("div");
      wrap.className = "field" + (cls ? " " + cls : "");
      var lab = document.createElement("label");
      lab.textContent = t(labelKey);
      wrap.appendChild(lab);
      var inp = document.createElement("input");
      inp.type = inputType;
      inp.value = initial !== undefined && initial !== null ? String(initial) : "";
      if (inputType === "number") { inp.min = "1"; inp.step = "1"; }
      var fid = "f-" + labelKey.replace(/\W/g, "-");
      inp.id = fid;
      lab.htmlFor = fid;
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }
    function row2() { var r = el("div", "row2"); form.appendChild(r); return r; }
    function into(r, inp) { r.appendChild(inp.parentNode); }

    var isEdit = mode === "rename";
    var nameInp = mkField("name.label", "text", isEdit ? nameOf(ent) : "");
    nameInp.maxLength = 120;
    // What the form showed at open (ST-8): only differences are saved.
    var snap = isEdit ? {
      name: nameOf(ent).trim(),
      qty: (typeof ent.qty === "number") ? ent.qty : 1,
      note: String(ent.note || "").trim(),
      tags: (ent.tags || []).join("\u0001"),
      val: ent.val || 0,
      bought: ent.bought || "",
      warr: ent.warr || ""
    } : null;

    var qtyInp = null, noteInp = null, tagsInp, valInp = null, boughtInp = null, warrInp = null, files = null;
    if (type === "item") {
      var r1 = row2();
      qtyInp = mkField("qty.label", "number", isEdit ? ent.qty : 1);
      valInp = mkField("val.label", "text", isEdit && ent.val ? (ent.val / 100).toFixed(2) : "");
      valInp.setAttribute("inputmode", "decimal");
      into(r1, qtyInp); into(r1, valInp);
    }
    noteInp = mkField("note.label", "text", isEdit ? (ent.note || "") : "");
    noteInp.maxLength = C.NOTE_MAX;
    tagsInp = mkField("tags.label", "text", isEdit ? (ent.tags || []).join(", ") : "");
    if (type === "item") {
      var r2 = row2();
      boughtInp = mkField("bought.label", "date", isEdit ? (ent.bought || "") : "");
      warrInp = mkField("warr.label", "date", isEdit ? (ent.warr || "") : "");
      into(r2, boughtInp); into(r2, warrInp);
      files = fileFields(form, isEdit ? ent : null, itemId);
    }

    var errBox = document.createElement("div");
    errBox.className = "dialog-err";
    errBox.setAttribute("role", "alert");
    form.appendChild(errBox);

    var btnRow = document.createElement("div");
    btnRow.className = "dialog-actions";
    btnRow.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    var okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.className = "btn prim";
    okBtn.textContent = t("save");
    btnRow.appendChild(okBtn);
    form.appendChild(btnRow);

    var saved = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.textContent = "";
      var name = nameInp.value.trim();
      if (!name) { errBox.textContent = t("toast.name.req"); nameInp.focus(); return; }
      var val = 0;
      if (valInp) {
        val = C.parseMoney(valInp.value);
        if (val === null) { errBox.textContent = t("toast.badval"); valInp.focus(); return; }
      }
      var tags = C.cleanTags(tagsInp.value);
      var note = noteInp.value.trim();

      if (mode === "add") {
        var extra = { id: itemId, tags: tags };
        if (note) extra.note = note;
        if (type === "item") {
          var q = parseInt(qtyInp.value, 10);
          extra.qty = (isNaN(q) || q < 1) ? 1 : q;
          extra.note = note || undefined;
          extra.val = val;
          extra.bought = boughtInp.value;
          extra.warr = warrInp.value;
          extra.ph = files.ph();
          extra.rc = files.rc();
        }
        addEnt(type, parentForAdd, name, extra);
      } else {
        // ST-8: a pull while the dialog is open replaces db with new
        // objects — work on the CURRENT row (by id), and write only
        // the fields the user changed (an unchanged Save stamps no
        // mtime, R27).
        var cur = byId(ent.id);
        if (cur) {
          var changed = false;
          if (name !== snap.name) { cur.name = name; cur.bi = null; changed = true; }
          if (note !== snap.note) { if (note) cur.note = note; else delete cur.note; changed = true; }
          if (tags.join("\u0001") !== snap.tags) { if (tags.length) cur.tags = tags; else delete cur.tags; changed = true; }
          if (cur.type === "item") {
            var q2 = parseInt(qtyInp.value, 10);
            q2 = (isNaN(q2) || q2 < 1) ? 1 : q2;
            if (q2 !== snap.qty) { cur.qty = q2; changed = true; }
            if (val !== snap.val) { if (val) cur.val = val; else delete cur.val; changed = true; }
            if (boughtInp.value !== snap.bought) { if (C.isYmd(boughtInp.value)) cur.bought = boughtInp.value; else delete cur.bought; changed = true; }
            if (warrInp.value !== snap.warr) { if (C.isYmd(warrInp.value)) cur.warr = warrInp.value; else delete cur.warr; changed = true; }
            var ph = files.ph(), rc = files.rc();
            if (ph.join("\u0001") !== (cur.ph || []).join("\u0001")) { if (ph.length) cur.ph = ph; else delete cur.ph; changed = true; }
            if (rc !== (cur.rc || "")) { if (rc) cur.rc = rc; else delete cur.rc; changed = true; }
          }
          if (changed) {
            // re-normalize in place so the row matches what a load gives
            var norm = entDefaults(cur);
            Object.keys(cur).forEach(function (k) { delete cur[k]; });
            Object.keys(norm).forEach(function (k) { cur[k] = norm[k]; });
            touch(cur); save();
          }
        }
      }
      saved = true;
      if (files) files.commit();
      dlg.close();
      notifyTransient(t("toast.saved"));
      render();
    });

    dlg.addEventListener("close", function () { if (!saved && files) files.abort(); });
    dlg.appendChild(form);
    showDlg(dlg);
    setTimeout(function () { nameInp.focus(); nameInp.select(); }, 50);
  }

  // ===== MOVE (picker tree, cycle guard, Undo) =====
  function openMoveDialog(ent) {
    var dlg = mkDialog("move-dialog", t("move.title", { n: nameOf(ent) }));
    dlg.classList.add("wide");
    var targets = C.moveTargets(db.ents, ent.id);
    var I = C.index(db.ents);
    var cur = byId(ent.id);
    if (!targets.length) {
      dlg.appendChild(el("p", "hint", t("move.none")));
    } else {
      var q = el("input", "search-input");
      q.type = "search";
      q.placeholder = t("move.filter");
      q.setAttribute("aria-label", t("move.filter"));
      if (targets.length > 8) dlg.appendChild(q);
      var tree = el("div", "pick-tree");
      dlg.appendChild(tree);
      var want = LEVELS[ent.type].parent;
      var paint = function () {
        tree.innerHTML = "";
        var words = C.fold(q.value).split(/\s+/).filter(Boolean);
        // walk the hierarchy down to the target level; ancestors are
        // headings, rows of the target level are the choices
        (function walk(p, depth) {
          (I.kids[p] || []).forEach(function (c) {
            if (c.type === "item" || c.id === ent.id) return;
            if (c.type === want) {
              var path = (C.pathNames(I, c.id, LANG) || []).concat([nameOf(c)]).join(" ");
              var f = C.fold(path);
              if (words.some(function (w) { return f.indexOf(w) < 0; })) return;
              var here = cur && cur.parentId === c.id;
              var b = el("button", "pick-btn");
              b.type = "button";
              b.style.paddingLeft = (10 + depth * 14) + "px";
              b.innerHTML = iconSvg(c.type) + "<span>" + esc(nameOf(c)) + "</span>" +
                (here ? '<em class="dim">' + esc(t("move.current")) + "</em>" : "");
              if (here) b.disabled = true;
              else b.addEventListener("click", function () { dlg.close(); doMove(ent.id, c.id); });
              tree.appendChild(b);
            } else {
              var mark = tree.children.length;
              var h = el("div", "pick-head");
              h.style.paddingLeft = (10 + depth * 14) + "px";
              h.innerHTML = iconSvg(c.type) + "<span>" + esc(nameOf(c)) + "</span>";
              tree.appendChild(h);
              walk(c.id, depth + 1);
              if (tree.children.length === mark + 1) tree.removeChild(h);   // nothing under it
            }
          });
        })("", 0);
        if (!tree.children.length) tree.appendChild(el("p", "hint", t("search.none")));
      };
      q.addEventListener("input", paint);
      paint();
    }
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDlg(dlg);
  }

  function doMove(id, targetId) {
    var e = byId(id);
    if (!e || C.moveError(db.ents, id, targetId)) return;
    var prev = { parentId: e.parentId, pos: e.pos };
    e.parentId = targetId;
    e.pos = children(e.type, targetId).length;
    touch(e);
    save();
    render();
    var tg = byId(targetId);
    actionToast(t("move.done", { n: nameOf(tg) }), function () {
      var now = byId(id);
      // undo only if nothing else moved it meanwhile and the old place lives
      if (!now || now.del || now.parentId !== targetId) return;
      if (C.moveError(db.ents, id, prev.parentId)) return;
      now.parentId = prev.parentId;
      now.pos = prev.pos;
      touch(now);
      save();
      render();
      notifyTransient(t("undone"));
    });
  }

  // ===== LEND =====
  function readOther(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  // Contacts (oros-contacts-data), read-only: names of live people /
  // companies. Only copied into the form; nothing is written back.
  function contactNames() {
    var ct = readOther("oros-contacts-data");
    if (!ct || typeof ct !== "object" || !Array.isArray(ct.contacts)) return [];
    var gone = {}, seen = {}, out = [];
    (Array.isArray(ct.deleted) ? ct.deleted : []).forEach(function (d) {
      if (d && typeof d.id === "string" && typeof d.mtime === "number") gone[d.id] = Math.max(gone[d.id] || 0, d.mtime);
    });
    function s(v) { return typeof v === "string" ? v : ""; }
    ct.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.del) return;
      if (c.id in gone && gone[c.id] >= (typeof c.mtime === "number" ? c.mtime : 0)) return;
      var n = [s(c.given), s(c.middle), s(c.family)].join(" ").replace(/\s+/g, " ").trim() ||
              s(c.nickname).trim() || s(c.org).trim();
      n = n.slice(0, C.LENT_LEN);
      if (n && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, LOCALE); }).slice(0, 3000);
  }
  function pickContact(onPick) {
    var list = contactNames();
    var dlg = mkDialog("ct-dialog", t("lend.pick"));
    if (!list.length) dlg.appendChild(el("p", "hint", t("lend.noContacts")));
    else {
      var q = el("input", "search-input");
      q.type = "search";
      q.setAttribute("aria-label", t("lend.pick"));
      dlg.appendChild(q);
      var box = el("div", "pick-tree");
      dlg.appendChild(box);
      var draw = function () {
        box.innerHTML = "";
        var w = C.fold(q.value).split(/\s+/).filter(Boolean);
        list.filter(function (n) {
          var h = C.fold(n);
          return w.every(function (x) { return h.indexOf(x) >= 0; });
        }).slice(0, 80).forEach(function (n) {
          var b = el("button", "pick-btn", n);
          b.type = "button";
          b.addEventListener("click", function () { dlg.close(); onPick(n); });
          box.appendChild(b);
        });
      };
      q.addEventListener("input", draw);
      draw();
    }
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDlg(dlg);
  }
  function openLendDialog(ent) {
    var dlg = mkDialog("lend-dialog", t("lend.title", { n: nameOf(ent) }));
    var form = el("form", "dialog-form");
    form.noValidate = true;
    function field(key, type, val) {
      var w = el("div", "field");
      var lab = el("label", "", t(key));
      var inp = el("input");
      inp.type = type;
      inp.value = val || "";
      inp.id = "l-" + key.replace(/\W/g, "-");
      lab.htmlFor = inp.id;
      w.appendChild(lab);
      w.appendChild(inp);
      form.appendChild(w);
      return inp;
    }
    var L = ent.lent || null;
    var toInp = field("lend.to", "text", L ? L.to : "");
    toInp.maxLength = C.LENT_LEN;
    if (contactNames().length) {
      var cb = btn(t("lend.contacts"), "", function () { pickContact(function (n) { toInp.value = n; }); });
      cb.classList.add("inline-btn");
      toInp.parentNode.appendChild(cb);
    }
    var r = el("div", "row2");
    form.appendChild(r);
    var onInp = field("lend.on", "date", L ? L.on : todayYmd());
    var dueInp = field("lend.due", "date", L && L.due ? L.due : "");
    r.appendChild(onInp.parentNode);
    r.appendChild(dueInp.parentNode);
    var err = el("div", "dialog-err");
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var acts = el("div", "dialog-actions");
    if (L) acts.appendChild(btn(t("lend.returned"), "ghost", function () { dlg.close(); markReturned(ent.id); }));
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    var ok = el("button", "btn prim", t("save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var lent = C.cleanLent({ to: toInp.value, on: C.isYmd(onInp.value) ? onInp.value : todayYmd(), due: dueInp.value });
      if (!lent) { err.textContent = t("lend.req"); toInp.focus(); return; }
      if (lent.due && lent.due < lent.on) { err.textContent = t("lend.dueBad"); dueInp.focus(); return; }
      var cur = byId(ent.id);
      if (cur && !cur.del) {
        if (JSON.stringify(cur.lent || null) !== JSON.stringify(lent)) { cur.lent = lent; touch(cur); save(); }
      }
      dlg.close();
      notifyTransient(t("toast.saved"));
      render();
    });
    dlg.appendChild(form);
    showDlg(dlg);
    setTimeout(function () { toInp.focus(); }, 50);
  }
  function markReturned(id) {
    var cur = byId(id);
    if (!cur || cur.del || !cur.lent) return;
    var prev = cur.lent;
    delete cur.lent;
    touch(cur);
    save();
    render();
    actionToast(t("lend.back"), function () {
      var now = byId(id);
      if (!now || now.del || now.lent) return;
      now.lent = prev;
      touch(now);
      save();
      render();
    });
  }

  // ===== QR LABELS (A4 sheet, printed from a hidden frame) =====
  function qrLib() { return window.orosQR || null; }
  function pageBase() { return location.origin + location.pathname; }
  function openQrDialog(preset) {
    var dlg = mkDialog("qr-dialog", t("qr.title"));
    dlg.classList.add("wide");
    dlg.appendChild(el("p", "hint", t("qr.hint")));
    // the places to offer: inside the current place (itself included),
    // or everything from the top
    var I = C.index(db.ents), rows = [];
    (function walk(p, depth) {
      (I.kids[p] || []).forEach(function (c) {
        if (c.type === "item") return;
        rows.push({ e: c, depth: depth });
        walk(c.id, depth + 1);
      });
    })(nav.id && !preset && mode === "browse" ? nav.id : "", 0);
    if (nav.id && !preset && mode === "browse") {
      var self = byId(nav.id);
      if (self) { rows.forEach(function (r) { r.depth++; }); rows.unshift({ e: self, depth: 0 }); }
    }
    var picked = {};
    rows.forEach(function (r) { picked[r.e.id] = preset ? preset.indexOf(r.e.id) >= 0 : true; });
    if (!rows.length) dlg.appendChild(el("p", "hint", t("qr.empty")));
    var list = el("div", "pick-tree");
    function paint() {
      list.innerHTML = "";
      rows.forEach(function (r) {
        var lab = el("label", "pick-check");
        lab.style.paddingLeft = (10 + r.depth * 14) + "px";
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!picked[r.e.id];
        cb.addEventListener("change", function () { picked[r.e.id] = cb.checked; });
        lab.appendChild(cb);
        var sp = el("span");
        sp.innerHTML = iconSvg(r.e.type) + esc(nameOf(r.e));
        lab.appendChild(sp);
        list.appendChild(lab);
      });
    }
    if (rows.length) {
      var top = el("div", "pick-tools");
      top.appendChild(btn(t("qr.all"), "ghost", function () { rows.forEach(function (r) { picked[r.e.id] = true; }); paint(); }));
      top.appendChild(btn(t("qr.nonePick"), "ghost", function () { rows.forEach(function (r) { picked[r.e.id] = false; }); paint(); }));
      dlg.appendChild(top);
      dlg.appendChild(list);
      paint();
    }
    var err = el("div", "dialog-err");
    dlg.appendChild(err);
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    if (rows.length) acts.appendChild(btn(t("qr.print"), "prim", function () {
      var ids = rows.filter(function (r) { return picked[r.e.id]; }).map(function (r) { return r.e.id; });
      if (!ids.length) { err.textContent = t("qr.nothing"); return; }
      var html = qrSheet(ids);
      if (!html) { err.textContent = t("qr.noqr"); return; }
      dlg.close();
      printHtml(html);
    }));
    dlg.appendChild(acts);
    showDlg(dlg);
  }
  var QR_MAX = 240;              // ten sheets
  function qrSheet(ids) {
    var Q = qrLib();
    if (!Q) return null;
    var cells = [];
    ids.slice(0, QR_MAX).forEach(function (id) {
      var e = byId(id), link = C.boxLink(pageBase(), id);
      if (!e || !link) return;
      var svg;
      try { svg = Q.svg(Q.encode(link, { ecl: "M" }), { margin: 2 }).replace(/^<\?xml[^>]*>\s*/, ""); }
      catch (err) { return; }
      var path = (C.pathNames(db.ents, id, LANG) || []).join(" › ");
      cells.push('<div class="l"><div class="q">' + svg + '</div><div class="x"><div class="k">' + esc(t("type." + e.type)) +
        '</div><div class="n">' + esc(nameOf(e)) + '</div><div class="p">' + esc(path) + '</div><div class="f">' + esc(t("qr.foot")) + "</div></div></div>");
    });
    if (!cells.length) return null;
    var pages = [];
    for (var i = 0; i < cells.length; i += 24) pages.push('<div class="sheet">' + cells.slice(i, i + 24).join("") + "</div>");
    var css = "@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff;color:#000}" +
      "body{font:9pt/1.25 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".sheet{width:210mm;height:296mm;box-sizing:border-box;display:grid;grid-template-columns:repeat(3,70mm);grid-template-rows:repeat(8,37mm);page-break-after:always;break-after:page}" +
      ".sheet:last-child{page-break-after:auto;break-after:auto}" +
      ".l{box-sizing:border-box;padding:2.5mm 3mm;display:flex;gap:2.5mm;align-items:center;overflow:hidden}" +
      ".q{flex:0 0 31mm;width:31mm;height:31mm}.q svg{display:block;width:100%;height:100%}" +
      ".x{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.8mm}" +
      ".k{font-size:7pt;text-transform:uppercase;letter-spacing:.04em;color:#555}" +
      ".n{font-weight:700;font-size:11pt;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}" +
      ".p{font-size:7pt;color:#444;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      ".f{font-size:6pt;color:#777}";
    return '<!DOCTYPE html><html lang="' + LANG + '"><head><meta charset="utf-8"><title>' + esc(t("qr.title")) +
      "</title><style>" + css + "</style></head><body>" + pages.join("") + "</body></html>";
  }
  function printHtml(html) {
    var old = document.getElementById("st-print");
    if (old) old.remove();
    var fr = document.createElement("iframe");
    fr.id = "st-print";
    fr.setAttribute("aria-hidden", "true");
    fr.tabIndex = -1;
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    fr.addEventListener("load", function () {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {}
    }, { once: true });
    fr.srcdoc = html;
    document.body.appendChild(fr);
  }

  // ===== SCAN A LABEL (camera) =====
  // BarcodeDetector (Chrome on Android, no library) — the approach of
  // Stock's camera scan. Where the browser lacks it the menu entry
  // never shows; the phone's own camera app still opens the links.
  function camOk() {
    return typeof window.BarcodeDetector === "function" &&
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }
  function openScan() {
    var dlg = mkDialog("scan-dialog", t("scan"));
    dlg.classList.add("wide");
    var v = el("video", "cam-video");
    v.muted = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    dlg.appendChild(v);
    var msg = el("p", "hint");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("close"), "prim", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var stream = null, timer = 0, done = false, det = null, last = "";
    function stop() {
      done = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      try { v.srcObject = null; } catch (e) {}
    }
    function fail() { msg.textContent = t("scan.denied"); msg.classList.add("warn"); }
    dlg.addEventListener("close", stop);
    try { det = new window.BarcodeDetector({ formats: ["qr_code"] }); }
    catch (e) { try { det = new window.BarcodeDetector(); } catch (e2) { det = null; } }
    function loop() {
      if (done) return;
      if (v.readyState < 2) { timer = setTimeout(loop, 200); return; }
      det.detect(v).then(function (list) {
        if (done) return;
        var raw = list && list[0] && typeof list[0].rawValue === "string" ? list[0].rawValue.trim() : "";
        if (raw && raw !== last) {
          last = raw;
          var id = C.parseBox(raw);
          if (id && byId(id) && C.isAlive(db.ents, id)) {
            try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
            dlg.close();
            openEnt(id);
            return;
          }
          msg.textContent = t("scan.unknown");
          msg.classList.add("warn");
        }
        timer = setTimeout(loop, 150);
      }, function () { timer = setTimeout(loop, 400); });
    }
    showDlg(dlg);
    if (!det) { fail(); return; }
    msg.textContent = t("scan.wait");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
      if (done) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      stream = st;
      v.srcObject = st;
      return v.play().then(function () { msg.textContent = ""; loop(); });
    }).catch(function () { if (!done) fail(); });
  }

  // ===== SETTINGS (this device) =====
  function openSettings() {
    var dlg = mkDialog("set-dialog", t("settings"));
    var form = el("form", "dialog-form");
    function sel(key, opts, val) {
      var w = el("div", "field");
      var lab = el("label", "", t(key));
      var s = el("select");
      s.id = "s-" + key.replace(/\W/g, "-");
      lab.htmlFor = s.id;
      opts.forEach(function (o) {
        var op = el("option", "", o[1]);
        op.value = String(o[0]);
        if (String(o[0]) === String(val)) op.selected = true;
        s.appendChild(op);
      });
      w.appendChild(lab);
      w.appendChild(s);
      form.appendChild(w);
      return s;
    }
    var cur = sel("set.cur", C.CURRENCIES.map(function (c) { return [c, c]; }), prefs.cur);
    var hours = [[-1, t("set.off")]];
    for (var h = 0; h < 24; h++) hours.push([h, t("set.at", { h: (h < 10 ? "0" : "") + h + ":00" })]);
    var rem = sel("set.remind", hours, prefs.remind);
    form.appendChild(el("p", "hint", t("set.remindHint")));
    var acts = el("div", "dialog-actions");
    acts.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    var ok = el("button", "btn prim", t("save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      prefs = C.readPrefs({ cur: cur.value, remind: parseInt(rem.value, 10) });
      writePrefs(prefs);
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    showDlg(dlg);
  }

  // ===== DELETE (styled confirm dialog, cascade tombstones) =====

  // Native window.confirm replaced by a themed <dialog> in the same
  // idiom as the entity dialog (#12 in v0.1.0): destructive action
  // gets the .btn.danger treatment, outside click + Esc cancel.
  function openConfirmDialog(ent) {
    var key = {
      space: "confirm.del.space", room: "confirm.del.room",
      furniture: "confirm.del.furn", position: "confirm.del.pos",
      item: "confirm.del.item"
    }[ent.type] || "confirm.del.item";

    var dlg = mkDialog("confirm-dialog", t("del") + " — " + nameOf(ent));

    var body = document.createElement("p");
    body.className = "confirm-body";
    body.textContent = t(key);
    dlg.appendChild(body);

    var btnRow = document.createElement("div");
    btnRow.className = "dialog-actions";
    btnRow.appendChild(btn(t("cancel"), "ghost", function () { dlg.close(); }));
    var delBtn = btn(t("del"), "danger", function () {
      dlg.close();
      confirmDelete(ent);
    });
    btnRow.appendChild(delBtn);
    dlg.appendChild(btnRow);

    showDlg(dlg);
    delBtn.focus();
  }

  function confirmDelete(ent) {
    // ST-8: the dialog may have outlived a pull — delete the current row.
    var cur = byId(ent.id);
    if (cur && !cur.del) deleteEnt(cur);
    notifyTransient(t("toast.deleted"));
    sanitizeNav();               // shared with sliceSet (#3) — no dead refs
    render();
  }

  // ===== TOAST (lazy) =====

  var toastTimer = null;
  function toast(text, action) {
    var box = document.getElementById("toast");
    if (!box) return;            // ST-2: stale/embedded HTML guard
    box.innerHTML = "";
    box.appendChild(el("span", "", text));
    if (action) {
      var b = el("button", "toast-act", action.label);
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        box.hidden = true;
        action.fn();
      });
      box.appendChild(b);
    }
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.classList.remove("show");
      setTimeout(function () { box.hidden = true; }, 300);
    }, action ? 6000 : 2200);
  }

  // ST-2: unified notifications doctrine (Wave 6 — mood/kanban/
  // prompter/quote pattern). The module lives in the shell
  // (parent), dynamic resolution; the local toast() above stays
  // as the stale-bundle fallback.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
      if (N && typeof N.transient === "function") { N.transient({ ns: "storage", title: text, body: "" }); return; }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }
  // a toast with Undo (the shell's transient action, else our own)
  function actionToast(text, undoFn) {
    var used = false;
    var act = { label: t("undo"), fn: function () { if (used) return; used = true; undoFn(); } };
    try {
      var N = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (N && typeof N.transient === "function" && N.transient({ ns: "storage", title: text, body: "", action: act })) return;
    } catch (e) {}
    toast(text, act);
  }

  // ===== PALETTE INHERITANCE (parent shell) =====

  // mood.js parity (v0.27.00): copy the parent's data-theme
  // attribute + every palette var via setProperty (NEVER cssText
  // += — that APPENDS duplicates instead of replacing on every
  // call). Live skin/theme switches repaint via watchPalette().
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--panel-bg-light", "--border", "--shadow",
                  "--font-stack"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — :root fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone — nothing to watch */ }
  }

  // ===== WIRING =====

  function wireUI() {
    document.getElementById("btn-back").addEventListener("click", goUp);

    document.getElementById("btn-add").addEventListener("click", function () {
      openEntityDialog("add", null);
    });
    var sb = document.getElementById("btn-search");
    sb.innerHTML = ICO.search;
    sb.setAttribute("aria-label", t("search"));
    sb.title = t("search");
    sb.addEventListener("click", function () {
      if (mode === "search") goUp(); else openSearch();
    });
    var mb = document.getElementById("btn-more");
    mb.innerHTML = ICO.dots;
    mb.setAttribute("aria-label", t("more"));
    mb.title = t("more");
    mb.addEventListener("click", openMoreMenu);

    // Debounced resize re-render (#9): crossing the 1024px breakpoint
    // swaps mobile drill-down ↔ desktop split tree.
    var rzTimer = null;
    var lastDesktop = null;
    window.addEventListener("resize", function () {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        var desktop = window.matchMedia("(min-width: 1024px)").matches;
        if (lastDesktop === null || desktop !== lastDesktop) {
          lastDesktop = desktop;
          render();
        }
      }, 150);
    });

    // ST-4: Contract B — shell-owned combos (Ctrl+Alt+Shift+*) get
    // the CANONICAL capture-phase forwarding.
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) {
        try {
          if (window.parent.orosShortcuts &&
              typeof window.parent.orosShortcuts.handle === "function" &&
              window.parent.orosShortcuts.handle(e)) {
            e.stopPropagation();
            return;
          }
        } catch (err) {}
      }
      var tgt = e.target;
      var editable = tgt && (tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" ||
        tgt.isContentEditable);
      // "/" opens the search
      if (e.key === "/" && !editable && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !document.querySelector("dialog[open]")) {
        e.preventDefault();
        openSearch();
        return;
      }
      // ST-6: Escape → goUp(), but yield to editable targets first
      // and never while a dialog is open (Esc cancels dialogs natively).
      if (e.key === "Escape" && (nav.id || mode !== "browse")) {
        if (editable) return;
        if (document.querySelector("dialog[open]")) return;
        goUp();
      }
    }, true);

    // Language switch on the shell re-opens the iframe (fresh boot,
    // zero data risk) — nothing else needed here.
  }

  // ===== BOOT =====

  function boot() {
    inheritPalette();
    watchPalette();
    dbInit();
    wireUI();
    document.getElementById("crumbs").setAttribute("aria-label", t("aria.location"));
    render();
    registerSync();
    console.log("[orOS] storage.js v" + SCRIPT_V + " booted");
  }

  boot();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { id } (also { box } from a label, { view: "lent" } from a
  // reminder). An item opens its position (where items are listed),
  // anything else opens itself. Deleted/unknown ids or an open dialog
  // → no-op.
  function openSearchTarget(tg) {
    if (!tg || document.querySelector("dialog[open]")) return;
    if (tg.view === "lent") { openLent(); return; }
    var id = typeof tg.id === "string" ? tg.id : (typeof tg.box === "string" ? tg.box : null);
    if (!id) return;
    var e = byId(id), cur = e, guard = 0;
    while (cur && !cur.del && cur.parentId && guard++ < 16) cur = byId(cur.parentId);
    if (!e || !cur || cur.del || cur.parentId) return;   // deleted, or a broken chain
    if (e.type === "item") flashId = e.id;
    goTo(e.type === "item" ? e.parentId : e.id);
  }
  window.__orosOpenAt = openSearchTarget;
  // A QR label (DL-1: "/storage/?box=<id>" → the shell hands "?box=…"
  // back to this frame) opens that place once; the query leaves the
  // address so a reload lands on the top level.
  try {
    var boxId = C.parseBox(location.search);
    if (boxId) {
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
      openSearchTarget({ id: boxId });
    }
  } catch (e) {}
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("storage");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}
})();
