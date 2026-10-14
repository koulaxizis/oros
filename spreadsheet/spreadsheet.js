/* ============================================================
   spreadsheet.js — orOS Spreadsheet / Λογιστικά φύλλα
   Wave 3 (formatting + ranges + clipboard + undo/redo +
           column resize + fixed dependent recalc)
   — built from scratch per OROS_BIBLE.md Part VII.
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function(){
"use strict";

/* ===== SECTION 1: CONSTANTS · I18N · HELPERS ===== */

var SCRIPT_V = "";
var STORAGE_KEY = "oros-spreadsheet-data";
var ACTIVE_KEY = "oros-spreadsheet-active"; /* device-local, NEVER synced */
var DATA_VER = 2; /* stays 2: f (format) + cw (col widths) are additive,
                     riding whole-object LWW — no migration needed */
var ROWS = 100, COLS = 26;          /* a new sheet */
var MAX_ROWS = 10000, MAX_COLS = 104; /* A..CZ; = functions.js limits */
var VIEW_KEY = "oros-spreadsheet-view"; /* device-local filters, NEVER synced */
var LANG = "en";

try {
  var pl = null;
  try { pl = window.parent && window.parent.orosLang; } catch (e) {}
  LANG = pl || localStorage.getItem("oros-lang") || "en";
} catch (e) {}

(function () {
  var m = (document.currentScript && document.currentScript.src || "")
    .match(/[?&]v=([^&#]+)/);
  SCRIPT_V = m ? m[1] : "";
  document.documentElement.lang = LANG;
  console.log("spreadsheet.js v" + (SCRIPT_V || "?") + " boot [Wave 3]");
})();

var STRINGS = {
  en: {
    "title": "Spreadsheet",
    "sheet.default": "Sheet1",
    "sheet.last": "Can't delete the last sheet",
    "tab.confirm": "Tap ✕ again to delete this sheet",
    "csv.imported": "CSV imported as a new sheet",
    "tbl.made": "New sheet: {n}",
    "csv.exported": "CSV exported",
    "csv.empty": "Cannot export an empty sheet",
    "err.corrupt": "Corrupted data rescued — a fresh sheet was created",
    "undo.empty": "Nothing to undo",
    "redo.empty": "Nothing to redo",
    "clip.empty": "Clipboard is empty",
    "fmt.cleared": "Formatting cleared",
    "xl.imp":      "Import Excel / Calc (.xlsx, .ods, .xls)",
    "xl.exp":      "Export Excel / Calc",
    "xl.xlsx":     "Excel (.xlsx)",
    "xl.ods":      "LibreOffice Calc (.ods)",
    "xl.imported": "Imported — {n} sheet(s)",
    "xl.exported": "Exported as {f}",
    "xl.lib":      "Library not found (vendor/xlsx.full.min.js)",
    "xl.readerr":  "Could not read this file",
    "xl.trunc":    "Import capped at {r} rows × {c} columns",
    "err.save":    "Could not save: the browser storage is full.",
    "tb.undo": "Undo (Ctrl+Z)", "tb.redo": "Redo (Ctrl+Y)",
    "tb.copy": "Copy (Ctrl+C)", "tb.cut": "Cut (Ctrl+X)", "tb.paste": "Paste (Ctrl+V)",
    "tb.bold": "Bold (Ctrl+B)", "tb.ital": "Italic (Ctrl+I)", "tb.und": "Underline (Ctrl+U)",
    "tb.al.l": "Align left", "tb.al.c": "Align center", "tb.al.r": "Align right",
    "tb.nf": "Number format", "tb.nf.gen": "auto", "tb.col": "Text color",
    "tb.clr": "Clear formatting", "tb.bar": "Formatting",
    "csv.imp": "Import CSV", "csv.exp": "Export CSV",
    "sheet.add": "New sheet", "sheets": "Sheets",
    "tb.nf.date": "date",
    "tb.sortA": "Sort A to Z", "tb.sortZ": "Sort Z to A",
    "tb.filter": "Filter", "tb.more": "Rows, columns, freeze",
    "sort.done": "Sorted {n} rows by column {c}",
    "sort.hdr": "Row {r} stays on top as the heading",
    "sort.none": "Nothing to sort here",
    "flt.on": "Filter on the headings of row {r}",
    "flt.none": "Select a table to filter",
    "flt.hidden": "{n} rows hidden",
    "flt.clear": "Remove filter",
    "flt.col": "Filter this column",
    "flt.title": "Filter column {c}",
    "flt.contains": "Contains…",
    "flt.all": "Select all", "flt.nonesel": "Clear all",
    "flt.empty": "(empty)",
    "flt.more": "Only the first {n} values are listed",
    "flt.apply": "Apply", "flt.cancel": "Cancel",
    "flt.local": "Filters stay on this device only",
    "fz.top": "Freeze top row", "fz.rows": "Freeze rows 1–{n}",
    "fz.cols": "Freeze columns A–{c}", "fz.col1": "Freeze column A", "fz.off": "Unfreeze",
    "row.insA": "Insert row above", "row.insB": "Insert row below",
    "row.del1": "Delete row {a}", "row.del": "Delete rows {a}–{b}",
    "col.insL": "Insert column left", "col.insR": "Insert column right",
    "col.del1": "Delete column {a}", "col.del": "Delete columns {a}–{b}",
    "add.rows": "Add {n} rows at the end", "add.cols": "Add {n} columns",
    "max.dims": "A sheet holds at most {r} rows and {c} columns",
    "fx.list": "Functions", "fx.search": "Search functions",
    "menu.label": "Sheet menu"
  },
  el: {
    "title": "Λογιστικά φύλλα",
    "sheet.default": "Φύλλο1",
    "sheet.last": "Δεν μπορεί να διαγραφεί το τελευταίο φύλλο",
    "tab.confirm": "Πάτησε ξανά ✕ για διαγραφή του φύλλου",
    "csv.imported": "Το CSV εισήχθη ως νέο φύλλο",
    "tbl.made": "Νέο φύλλο: {n}",
    "csv.exported": "Το CSV εξήχθη",
    "csv.empty": "Δεν μπορεί να εξάγει κενό φύλλο",
    "err.corrupt": "Τα δεδομένα ήταν κατεστραμμένα — δημιουργήθηκε νέο φύλλο",
    "undo.empty": "Τίποτα προς αναίρεση",
    "redo.empty": "Τίποτα προς επανάληψη",
    "clip.empty": "Το πρόχειρο είναι κενό",
    "fmt.cleared": "Η μορφοποίηση καθαρίστηκε",
    "xl.imp":      "Εισαγωγή Excel / Calc (.xlsx, .ods, .xls)",
    "xl.exp":      "Εξαγωγή Excel / Calc",
    "xl.xlsx":     "Excel (.xlsx)",
    "xl.ods":      "LibreOffice Calc (.ods)",
    "xl.imported": "Εισήχθησαν — {n} φύλλα",
    "xl.exported": "Εξήχθη ως {f}",
    "xl.lib":      "Δεν βρέθηκε η βιβλιοθήκη (vendor/xlsx.full.min.js)",
    "xl.readerr":  "Αδύνατη η ανάγνωση του αρχείου",
    "xl.trunc":    "Η εισαγωγή περικόπηκε σε {r} γραμμές × {c} στήλες",
    "err.save":    "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε.",
    "tb.undo": "Αναίρεση (Ctrl+Z)", "tb.redo": "Επανάληψη (Ctrl+Y)",
    "tb.copy": "Αντιγραφή (Ctrl+C)", "tb.cut": "Αποκοπή (Ctrl+X)", "tb.paste": "Επικόλληση (Ctrl+V)",
    "tb.bold": "Έντονα (Ctrl+B)", "tb.ital": "Πλάγια (Ctrl+I)", "tb.und": "Υπογράμμιση (Ctrl+U)",
    "tb.al.l": "Στοίχιση αριστερά", "tb.al.c": "Στοίχιση στο κέντρο", "tb.al.r": "Στοίχιση δεξιά",
    "tb.nf": "Μορφή αριθμού", "tb.nf.gen": "αυτόματη", "tb.col": "Χρώμα κειμένου",
    "tb.clr": "Καθαρισμός μορφοποίησης", "tb.bar": "Μορφοποίηση",
    "csv.imp": "Εισαγωγή CSV", "csv.exp": "Εξαγωγή CSV",
    "sheet.add": "Νέο φύλλο", "sheets": "Φύλλα",
    "tb.nf.date": "ημερομηνία",
    "tb.sortA": "Ταξινόμηση από Α έως Ω", "tb.sortZ": "Ταξινόμηση από Ω έως Α",
    "tb.filter": "Φίλτρο", "tb.more": "Γραμμές, στήλες, πάγωμα",
    "sort.done": "Ταξινομήθηκαν {n} γραμμές με βάση τη στήλη {c}",
    "sort.hdr": "Η γραμμή {r} μένει πάνω ως επικεφαλίδα",
    "sort.none": "Δεν υπάρχει τίποτα για ταξινόμηση εδώ",
    "flt.on": "Φίλτρο στις επικεφαλίδες της γραμμής {r}",
    "flt.none": "Διάλεξε έναν πίνακα για φιλτράρισμα",
    "flt.hidden": "{n} γραμμές κρυμμένες",
    "flt.clear": "Αφαίρεση φίλτρου",
    "flt.col": "Φιλτράρισμα αυτής της στήλης",
    "flt.title": "Φίλτρο στήλης {c}",
    "flt.contains": "Περιέχει…",
    "flt.all": "Επιλογή όλων", "flt.nonesel": "Καμία επιλογή",
    "flt.empty": "(κενό)",
    "flt.more": "Εμφανίζονται μόνο οι πρώτες {n} τιμές",
    "flt.apply": "Εφαρμογή", "flt.cancel": "Άκυρο",
    "flt.local": "Τα φίλτρα μένουν μόνο σε αυτή τη συσκευή",
    "fz.top": "Πάγωμα πρώτης γραμμής", "fz.rows": "Πάγωμα γραμμών 1–{n}",
    "fz.cols": "Πάγωμα στηλών A–{c}", "fz.col1": "Πάγωμα στήλης A", "fz.off": "Ξεπάγωμα",
    "row.insA": "Εισαγωγή γραμμής από πάνω", "row.insB": "Εισαγωγή γραμμής από κάτω",
    "row.del1": "Διαγραφή γραμμής {a}", "row.del": "Διαγραφή γραμμών {a}–{b}",
    "col.insL": "Εισαγωγή στήλης αριστερά", "col.insR": "Εισαγωγή στήλης δεξιά",
    "col.del1": "Διαγραφή στήλης {a}", "col.del": "Διαγραφή στηλών {a}–{b}",
    "add.rows": "Προσθήκη {n} γραμμών στο τέλος", "add.cols": "Προσθήκη {n} στηλών",
    "max.dims": "Ένα φύλλο χωράει έως {r} γραμμές και {c} στήλες",
    "fx.list": "Συναρτήσεις", "fx.search": "Αναζήτηση συναρτήσεων",
    "menu.label": "Μενού φύλλου"
  }
};

function t(k) {
  var d = STRINGS[LANG] || STRINGS.en;
  return d.hasOwnProperty(k) ? d[k] :
    (STRINGS.en.hasOwnProperty(k) ? STRINGS.en[k] : k);
}

function $(id) { return document.getElementById(id); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() { return Date.now(); }

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function colName(n) { /* 0 -> "A", 25 -> "Z", 26 -> "AA" */
  var s = ""; n += 1;
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colFromName(s) { /* "A" -> 0, "AA" -> 26; -1 on garbage */
  var n = 0; s = String(s).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 65 || c > 90) return -1;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* ===== SECTION 2: DATA MODEL ===== */

/* STATE SHAPE (Wave 3):
   { ver: 2,
     sheets: [{ id, name: null, bi: {en, el}, rows, cols, pos, mtime,
                cw: { "<colIdx>": pxWidth }, fz?: { r, c } }],
     cells:  { "<sheetId>|<r>|<c>":
               { v: "<raw input>", mtime, f?: { b?, i?, u?,
                 al?: "l|c|r", co?: "#hex", nf?: "gen|0|2|%|€|d" } } },
     deleted:{ "<sheetId>": ts, "<sheetId>|<r>|<c>": ts } }
   · f-only cells allowed: v === "" && f present (format on empty cell).
   · cw and fz (frozen rows / columns, only when set) ride the sheet
     entity → synced via sheet LWW. rows ≤ MAX_ROWS, cols ≤ MAX_COLS.
   · filters (oros-spreadsheet-view) are DEVICE-LOCAL, never synced.
   · actSID, CLIP, undoStack are DEVICE-LOCAL, never synced. */

var state = null;
var actSID = "s-main";
var SID = "s-main";

/* SS-2: the seed sheet is the same bytes on every device. It was
   built from t("sheet.default"), so a Greek device stored
   bi.en = "Φύλλο1": an English and a Greek device then held two
   different "untouched" seeds with mtime 0 and uploaded on every
   sync cycle, for ever. */
var SEED_BI = { en: "Sheet1", el: "\u03A6\u03CD\u03BB\u03BB\u03BF1" };

function blankState() {
  return {
    ver: DATA_VER,
    sheets: [{
      id: SID, name: null,
      bi: { en: SEED_BI.en, el: SEED_BI.el },
      rows: ROWS, cols: COLS, pos: 0, mtime: 0, cw: {}
    }],
    cells: {},
    deleted: {}
  };
}

/* sanitize format sub-object; null if nothing usable */
function sanitizeF(f) {
  if (!f || typeof f !== "object") return undefined;
  var out = {};
  if (f.b) out.b = 1;
  if (f.i) out.i = 1;
  if (f.u) out.u = 1;
  if (f.al === "l" || f.al === "c" || f.al === "r") out.al = f.al;
  if (typeof f.co === "string" && /^#[0-9a-fA-F]{6}$/.test(f.co)) out.co = f.co;
  if (f.nf === "gen" || f.nf === "0" || f.nf === "2" ||
      f.nf === "%" || f.nf === "\u20AC" || f.nf === "d") out.nf = f.nf;
  var has = false;
  for (var kk in out) { has = true; break; }
  return has ? out : undefined;
}

/* frozen panes {r, c}: rows 0..r-1 and columns 0..c-1 stay in view;
   null when nothing is frozen (the field is then left out, so sheets
   without it keep their bytes) */
var FZ_MAX_R = 50, FZ_MAX_C = 26;
function normFz(fz, sh) {
  if (!fz || typeof fz !== "object") return null;
  var r = parseInt(fz.r, 10) || 0, c = parseInt(fz.c, 10) || 0;
  r = Math.max(0, Math.min(r, FZ_MAX_R, (sh && sh.rows ? sh.rows : MAX_ROWS) - 1));
  c = Math.max(0, Math.min(c, FZ_MAX_C, (sh && sh.cols ? sh.cols : MAX_COLS) - 1));
  return (r || c) ? { r: r, c: c } : null;
}

function normalizeState(st) {
  if (!st || typeof st !== "object") return null;
  st.ver = DATA_VER;
  if (!Array.isArray(st.sheets)) st.sheets = [];
  var i, sh;
  for (i = 0; i < st.sheets.length; i++) {
    sh = st.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") {
      st.sheets.splice(i, 1); i--; continue;
    }
    sh.rows = Math.min(Math.max(parseInt(sh.rows, 10) || ROWS, 1), MAX_ROWS);
    sh.cols = Math.min(Math.max(parseInt(sh.cols, 10) || COLS, 1), MAX_COLS);
    var fz = normFz(sh.fz, sh);
    if (fz) sh.fz = fz; else delete sh.fz;
    if (typeof sh.mtime !== "number" || !isFinite(sh.mtime)) sh.mtime = 0;
    if (sh.pos === undefined || typeof sh.pos !== "number") sh.pos = 0;
    if (sh.cw === undefined || typeof sh.cw !== "object" || !sh.cw) sh.cw = {};
    if (sh.name !== null && sh.name !== undefined &&
        typeof sh.name !== "string") sh.name = String(sh.name);
    /* SS-2: an untouched seed is repaired to the shared seed bytes */
    if (sh.id === SID && sh.mtime === 0 && (sh.name === null || sh.name === undefined))
      sh.bi = { en: SEED_BI.en, el: SEED_BI.el };
  }
  if (!st.sheets.length) st.sheets = [blankState().sheets[0]];
  if (!st.cells || typeof st.cells !== "object") st.cells = {};
  if (!st.deleted || typeof st.deleted !== "object") st.deleted = {};

  var k;
  for (k in st.cells) {
    var cel = st.cells[k];
    var keep = false;
    if (cel && typeof cel === "object" && typeof cel.v === "string" &&
        typeof cel.mtime === "number" && isFinite(cel.mtime) &&
        /^[\w-]+\|\d+\|\d+$/.test(k)) {
      if (cel.v !== "" || cel.f) {
        keep = true;
        var sf = sanitizeF(cel.f);
        if (sf) cel.f = sf; else delete cel.f;
        if (cel.fm !== undefined && (!cel.fm || typeof cel.fm !== "object")) delete cel.fm;
      }
    }
    if (!keep) delete st.cells[k];
  }
  for (k in st.deleted) {
    if (typeof st.deleted[k] !== "number" || !isFinite(st.deleted[k]))
      delete st.deleted[k];
  }
  return st;
}

function tombFor(del, key) {
  var ts = del[key];
  if (ts && typeof ts === "number" && isFinite(ts)) return ts;
  var sid = key.split("|")[0];
  var stTs = del[sid];
  return (stTs && typeof stTs === "number" && isFinite(stTs)) ? stTs : 0;
}

/* the newer of a cell's own tombstone and its sheet's */
function cellTomb(del, key) {
  var a = del[key], b = del[key.split("|")[0]];
  a = (typeof a === "number" && isFinite(a)) ? a : 0;
  b = (typeof b === "number" && isFinite(b)) ? b : 0;
  return Math.max(a, b);
}

function cellKey(sid, r, c) { return sid + "|" + r + "|" + c; }

/* ===== SECTION 2b: MERGE ENGINE =====
   SS-1 one canonical form (canonSS) for the stored copy, the slice
   getter and the merge output (R26): sheets by (pos, id), cells and
   tombstones by key, fixed key order.
   SS-5 a cell carries one stamp per field, fm{ v, f }: the value
   (with Excel's cached result cv) and the format merge separately,
   so formatting a range on one device no longer reverts values typed
   in it on another. A cell whose mtime is newer than both stamps
   was last written by a device on the previous spreadsheet.js (it
   replaces the whole cell and drops fm): mtime then speaks for both
   fields. A field older than the cell's tombstone is cleared.
   Sheets stay whole-entity LWW (tie -> smaller JSON, both sides). A
   deleted sheet comes back when the other device wrote cells in it
   after the deletion ("a newer edit resurrects", R17). */

function newerObj(a, b) {
  if (!a) return b;
  if (!b) return a;
  var am = a.mtime || 0, bm = b.mtime || 0;
  if (am > bm) return a;
  if (bm > am) return b;
  var aj = JSON.stringify(a), bj = JSON.stringify(b);
  return (aj < bj) ? a : b;
}

function stampNum(n) {
  return (typeof n === "number" && isFinite(n) && n > 0) ? n : 0;
}

/* field stamps of a cell: { v, f } */
function cellStamps(cel) {
  var m = stampNum(cel.mtime);
  if (cel.fm && typeof cel.fm === "object") {
    var sv = stampNum(cel.fm.v), sf = stampNum(cel.fm.f);
    if (m <= Math.max(sv, sf)) return { v: sv, f: sf };
  }
  return { v: m, f: m };        /* written by the previous version */
}

function canonF(f) {
  var sf = sanitizeF(f);
  if (!sf) return undefined;
  var o = {};
  ["b", "i", "u", "al", "co", "nf"].forEach(function (k) {
    if (sf[k] !== undefined) o[k] = sf[k];
  });
  return o;
}

/* canonical cell, or null when nothing is left */
function canonCell(cel, tomb) {
  if (!cel || typeof cel !== "object" || typeof cel.v !== "string") return null;
  var st = cellStamps(cel);
  var m = Math.max(stampNum(cel.mtime), st.v, st.f);
  if (tomb && m <= tomb) return null;
  var v = cel.v, f = canonF(cel.f), cv = (typeof cel.cv === "string") ? cel.cv : undefined;
  if (tomb && st.v <= tomb) { v = ""; cv = undefined; }
  if (tomb && st.f <= tomb) f = undefined;
  if (v === "" && !f) return null;
  var o = { v: v, mtime: m };
  if (f) o.f = f;
  if (cv !== undefined && cv !== "") o.cv = cv;
  o.fm = { v: st.v, f: st.f };
  return o;
}

function mergeCell(a, b) {
  if (!a) return b;
  if (!b) return a;
  var sa = cellStamps(a), sb = cellStamps(b);
  var pv, pf;
  if (sa.v !== sb.v) pv = sa.v > sb.v ? a : b;
  else pv = JSON.stringify([a.v, a.cv || ""]) <= JSON.stringify([b.v, b.cv || ""]) ? a : b;
  if (sa.f !== sb.f) pf = sa.f > sb.f ? a : b;
  else pf = JSON.stringify(canonF(a.f) || {}) <= JSON.stringify(canonF(b.f) || {}) ? a : b;
  var o = { v: pv.v, mtime: Math.max(stampNum(a.mtime), stampNum(b.mtime)) };
  var f = canonF(pf.f);
  if (f) o.f = f;
  if (typeof pv.cv === "string") o.cv = pv.cv;
  o.fm = { v: Math.max(sa.v, sb.v), f: Math.max(sa.f, sb.f) };
  return o;
}

function canonSheet(sh) {
  var o = { id: sh.id, name: (typeof sh.name === "string") ? sh.name : null };
  if (o.name === null && sh.bi && typeof sh.bi === "object")
    o.bi = { en: String(sh.bi.en || ""), el: String(sh.bi.el || "") };
  o.rows = sh.rows; o.cols = sh.cols; o.pos = sh.pos; o.mtime = sh.mtime;
  var cw = {};
  if (sh.cw && typeof sh.cw === "object") {
    Object.keys(sh.cw).sort(function (x, y) { return (+x) - (+y); }).forEach(function (k) {
      var w = sh.cw[k];
      if (/^\d+$/.test(k) && typeof w === "number" && isFinite(w) && w > 0) cw[k] = w;
    });
  }
  o.cw = cw;
  var fz = normFz(sh.fz, sh);
  if (fz) o.fz = fz;
  return o;
}

var TOMB_KEEP = 30 * 24 * 60 * 60 * 1000;

/* Canonical copy (never mutates its input): normalized, tombstones
   pruned 30 days before the NEWEST tombstone (data time, never the
   device clock) except the seed sheet's (SS-3: a deleted Sheet1 must
   not come back when a new device joins), sheets by (pos, id), cells
   and tombstones by key. */
function canonSS(st) {
  st = normalizeState(st ? clone(st) : null) || blankState();
  var del = {}, maxTs = 0, k;
  for (k in st.deleted) if (st.deleted[k] > maxTs) maxTs = st.deleted[k];
  var cutoff = maxTs - TOMB_KEEP;
  Object.keys(st.deleted).sort().forEach(function (key) {
    if (st.deleted[key] >= cutoff || key === SID) del[key] = st.deleted[key];
  });
  var cells = {}, liveSids = {};
  Object.keys(st.cells).sort().forEach(function (key) {
    var c = canonCell(st.cells[key], cellTomb(del, key));
    if (c) { cells[key] = c; liveSids[key.split("|")[0]] = 1; }
  });
  /* a sheet older than its tombstone is gone, unless cells written
     after the deletion keep it (same rule as mergeState) */
  var alive = st.sheets.filter(function (sh) {
    var tomb = del[sh.id] || 0;
    return !(tomb && (sh.mtime || 0) <= tomb && !liveSids[sh.id]);
  });
  if (!alive.length) alive = blankState().sheets;   /* never zero sheets */
  var sheets = alive.map(canonSheet).sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
  return { ver: DATA_VER, sheets: sheets, cells: cells, deleted: del };
}

function mergeState(local, remote) {
  if (!local || typeof local !== "object") local = blankState();
  if (!remote || typeof remote !== "object") return canonSS(local);
  local = canonSS(local); remote = canonSS(remote);

  /* 1. DELETED UNION (pruned by canonSS at the end, same rule as the getter) */
  var mergedDel = {}, k;
  for (k in local.deleted) mergedDel[k] = local.deleted[k];
  for (k in remote.deleted)
    mergedDel[k] = Math.max(remote.deleted[k], mergedDel[k] || 0);

  /* 2. Cells — sparse union, per-field merge, tombstone-filtered */
  var mergedCells = {}, liveSids = {};
  var keys = {};
  for (k in local.cells) keys[k] = 1;
  for (k in remote.cells) keys[k] = 1;
  for (k in keys) {
    var mc = mergeCell(local.cells[k], remote.cells[k]);
    if (mc && mc.v === "" && !canonF(mc.f)) {
      /* both fields ended empty (value cleared here, format there):
         the cell is gone — say so with a tombstone, or the side that
         still holds an older copy would bring it back */
      mergedDel[k] = Math.max(mergedDel[k] || 0, stampNum(mc.mtime));
      continue;
    }
    var cel = canonCell(mc, cellTomb(mergedDel, k));
    if (!cel) continue;
    mergedCells[k] = cel;
    liveSids[k.split("|")[0]] = 1;
  }

  /* 3. Sheets — union, LWW by mtime, tombstone-filtered */
  var sheetsMap = {}, i, sh, src;
  for (src = 0; src < 2; src++) {
    var arr = src ? remote.sheets : local.sheets;
    for (i = 0; i < arr.length; i++) {
      sh = arr[i];
      sheetsMap[sh.id] = newerObj(sheetsMap[sh.id], sh);
    }
  }
  var mergedSheets = [];
  for (k in sheetsMap) {
    sh = sheetsMap[k];
    var tomb = tombFor(mergedDel, sh.id);
    if (tomb && (sh.mtime || 0) <= tomb && !liveSids[sh.id]) continue;
    mergedSheets.push(sh);
  }

  return canonSS({ ver: DATA_VER, sheets: mergedSheets, cells: mergedCells,
                   deleted: mergedDel });
}

/* ===== SECTION 2c: STORAGE FUNNEL ===== */

var saveTimer = null;

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  dirtyFlag = false;       /* saved state */
  saveTimer = setTimeout(saveNow, 400);
}

var saveFailNoted = false;
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canonSS(state)));  /* SS-1: stored = getter */
  } catch (e) {
    if (!saveFailNoted) { saveFailNoted = true; notifyTransient(t("err.save")); }  /* R30 */
  }
}

function loadState() {
  var raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  var st = null;
  if (raw) {
    try { st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st) {
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) {}
    }
  }
  state = normalizeState(st);
  if (!state) {
    state = blankState();
    if (raw) setTimeout(function(){ notifyTransient(t("err.corrupt")); }, 400);
  }
  try {
    var loadedAct = localStorage.getItem(ACTIVE_KEY);
    if (loadedAct) {
      var exists = false, ix;
      for (ix = 0; ix < state.sheets.length; ix++)
        if (state.sheets[ix] && state.sheets[ix].id === loadedAct) { exists = true; break; }
      if (exists && !state.deleted[loadedAct]) actSID = loadedAct;
    }
  } catch (e) {}
  if (!getActiveSheet()) { actSID = state.sheets[0].id; }
  saveActive();
}

function saveActive() {
  try { localStorage.setItem(ACTIVE_KEY, actSID); } catch (e) {}
}

/* ===== SECTION 3: STATE · RAW OPS · UNDO · SELECTION ===== */

var selR = 0, selC = 0;        /* cursor */
var selAR = 0, selAC = 0;      /* selection ANCHOR (range start) */
var editing = false, editingR = -1, editingC = -1;
var editInput = null;
var editStartVal = "";   /* SS-4: value the open editor started from */
var fxFocused = false;
var fxStartVal = "";     /* SS-4: value the formula bar showed on focus */
var dirtyFlag = false;

/* selection rectangle (normalized, inclusive) */
function selTop()    { return Math.min(selR, selAR); }
function selBottom() { return Math.max(selR, selAR); }
function selLeft()   { return Math.min(selC, selAC); }
function selRight()  { return Math.max(selC, selAC); }
function selIsRange() { return selR !== selAR || selC !== selAC; }

function collapseSel(r, c) {
  if (r === undefined) { r = selR; c = selC; }
  selR = selAR = r; selC = selAC = c;
}

function getActiveSheet() {
  for (var i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === actSID)
      return state.sheets[i];
  }
  return state.sheets[0] || null;
}

function getSheetById(id) {
  for (var i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === id)
      return state.sheets[i];
  }
  return null;
}

function findSheetByName(name) {
  /* Keep Greek letters (α-ω, Α-Ω) + ASCII word chars */
  var nl = String(name).toLowerCase().replace(/[^a-z0-9\u03b1-\u03c9]/g, "");
  for (var i = 0; i < state.sheets.length; i++) {
    var sh = state.sheets[i];
    if (!sh) continue;
    var n = sh.name || sh.bi[LANG] || sh.bi.en || "";
    if (String(n).toLowerCase().replace(/[^a-z0-9\u03b1-\u03c9]/g, "") === nl) return sh;
  }
  return null;
}

function getCell(r, c) {
  var key = cellKey(actSID, r, c);
  return state.cells[key] || null;
}

/* --- evaluation cache invalidation (Wave 3 recalc fix) --- */
var EVAL_DIRTY = true;
function invalidateEval() { EVAL_DIRTY = true; }

/* --- raw mutations (no undo, no UI) — used by undo/paste/sync --- */
/* SS-5: only the field that really changes gets a new stamp (R27);
   a value that is set again unchanged stamps nothing. */
function rawSet(sid, r, c, v, f) {
  var key = cellKey(sid, r, c);
  var cur = state.cells[key];
  var t0 = now();
  var nv = String(v), sf = canonF(f);
  var st = cur ? cellStamps(cur) : { v: 0, f: 0 };
  var vChanged = !cur || cur.v !== nv;
  var fChanged = JSON.stringify(cur ? (canonF(cur.f) || null) : null) !== JSON.stringify(sf || null);
  if (cur && !vChanged && !fChanged) return;
  var o = { v: nv, mtime: t0 };
  if (sf) o.f = sf;
  if (cur && !vChanged && typeof cur.cv === "string") o.cv = cur.cv;
  o.fm = { v: vChanged ? t0 : st.v, f: fChanged ? t0 : st.f };
  delete state.deleted[key];
  state.cells[key] = o;
}

function rawDel(sid, r, c) {
  var key = cellKey(sid, r, c);
  delete state.cells[key];
  state.deleted[key] = now();
}

/* cell content snapshot for undo entries: {v, f}|null (null = absent) */
function snapCell(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  if (!cel) return null;
  var o = { v: cel.v };
  if (cel.f) o.f = clone(cel.f);
  return o;
}

/* --- UNDO/REDO (device-local, op-based, batch entries) ---
   entry = [ {key, before:snap|null, after:snap|null}, ... ]
   undo restores `before`, redo reapplies `after`; every apply
   stamps a FRESH mtime so sync stays LWW-consistent.          */
var undoStack = [], redoStack = [], UNDO_MAX = 100;

function pushUndo(entries) {
  if (!entries || !entries.length) return;
  undoStack.push(entries);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0; /* new edit kills the redo branch */
  updateToolbar();
}

function applyEntries(entries, useAfter) {
  var e, i, dimsChanged = false;
  for (i = 0; i < entries.length; i++) {
    e = entries[i];
    var target = useAfter ? e.after : e.before;
    if (e.dim) {
      /* insert / delete rows or columns: the sheet's size and widths */
      var sh = getSheetById(e.sid);
      if (sh && target) {
        sh.rows = target.rows; sh.cols = target.cols; sh.cw = clone(target.cw);
        if (target.fz) sh.fz = clone(target.fz); else delete sh.fz;
        sh.mtime = now();
        dimsChanged = true;
      }
      continue;
    }
    var pk = e.key.split("|");
    var r = parseInt(pk[1], 10), c = parseInt(pk[2], 10);
    if (target === null) {
      rawDel(pk[0], r, c);
    } else {
      rawSet(pk[0], r, c, target.v, target.f);
    }
  }
  invalidateEval();
  markDirty();
  queueSave();
  if (dimsChanged) buildGrid();
  renderGrid();
  renderSelection();
}

function doUndo() {
  if (editing) cancelEdit();
  var entries = undoStack.pop();
  if (!entries) { notifyTransient(t("undo.empty")); return; }
  redoStack.push(entries);
  applyEntries(entries, false);
}

function doRedo() {
  if (editing) cancelEdit();
  var entries = redoStack.pop();
  if (!entries) { notifyTransient(t("redo.empty")); return; }
  undoStack.push(entries);
  applyEntries(entries, true);
}

/* --- undo-capturing single-cell edit ops (UI path) --- */
function setCell(r, c, rawValue) {
  var key = cellKey(actSID, r, c);
  var before = snapCell(actSID, r, c);
  var after = { v: String(rawValue) };
  var cur = state.cells[key];
  if (cur && cur.f) after.f = clone(cur.f); /* keep format on retype */
  rawSet(actSID, r, c, rawValue, after.f);
  invalidateEval();
  markDirty();
  pushUndo([{ key: key, before: before, after: snapCell(actSID, r, c) }]);
}

function deleteCell(r, c) {
  var key = cellKey(actSID, r, c);
  var before = snapCell(actSID, r, c);
  if (!before) return;
  rawDel(actSID, r, c);
  invalidateEval();
  markDirty();
  pushUndo([{ key: key, before: before, after: null }]);
}

/* delete a whole selection rect (single undo entry) */
function deleteSelection() {
  var entries = [], r, c;
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  for (r = top; r <= bot; r++)
    for (c = lef; c <= rig; c++) {
      var key = cellKey(actSID, r, c);
      var before = snapCell(actSID, r, c);
      if (before) {
        rawDel(actSID, r, c);
        entries.push({ key: key, before: before, after: null });
      }
    }
  if (!entries.length) return;
  invalidateEval();
  markDirty();
  pushUndo(entries);
  queueSave();
  renderGrid();
}

function markDirty() {
  dirtyFlag = true;
  updateStatus();
  queueSave();
  if (syncApi && syncApi.dirty) syncApi.dirty();
}

function updateStatus() {
  var st = $("st-note");
  if (st) st.textContent = dirtyFlag ? "*" : "";
}

// orosDialog lives in the parent shell (same-origin iframe).
// Standalone PWA mode -> null -> caller uses local fallback.
function dialogHost() {
  try {
    return window.orosDialog || window.parent.orosDialog || null;
  } catch (e) { return null; }
}

/* ===== SECTION 3b: FORMULA ENGINE (functions.js · OrosSheetFx) =====
   The tokenizer, parser, evaluator and the function library live in
   functions.js (pure, Node-tested). This is the glue: how the engine
   reads cells, finds sheets by name and the used extent of a sheet
   (whole-column references A:A stop there). */

var FX = window.OrosSheetFx;
var EXTENT = {}, FCELLS = null;

function cellRaw(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  return cel ? cel.v : "";
}

function sheetExtent(sid) {
  if (!Object.prototype.hasOwnProperty.call(EXTENT, sid)) {
    var rows = 0, cols = 0, pref = sid + "|", k, p;
    for (k in state.cells) {
      if (k.lastIndexOf(pref, 0) !== 0) continue;
      p = k.split("|");
      if (+p[1] + 1 > rows) rows = +p[1] + 1;
      if (+p[2] + 1 > cols) cols = +p[2] + 1;
    }
    EXTENT[sid] = { rows: rows, cols: cols };
  }
  return EXTENT[sid];
}

function formulaCells() {
  if (!FCELLS) {
    FCELLS = [];
    for (var k in state.cells) {
      var cel = state.cells[k];
      if (cel && cel.v.charAt(0) === "=") {
        var p = k.split("|");
        FCELLS.push([p[0], +p[1], +p[2]]);
      }
    }
    FCELLS.sort(function (a, b) {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] - b[1]) || (a[2] - b[2]);
    });
  }
  return FCELLS;
}

var ENG = FX.engine({
  raw: cellRaw,
  cached: function (sid, r, c) {
    var cel = state.cells[cellKey(sid, r, c)];
    return cel ? cel.cv : undefined;
  },
  sheetId: function (name) {
    var sh = findSheetByName(name);
    return sh ? sh.id : null;
  },
  extent: sheetExtent,
  formulaCells: formulaCells,
  lang: LANG,
  now: function () { return Date.now(); }
});

function resetEval() { ENG.reset(); EXTENT = {}; FCELLS = null; }
function evalCell(sid, r, c) { return ENG.value(sid, r, c); }
function isError(v) { return FX.isErr(v); }

/* --- NUMBER FORMAT rendering (display layer only) --- */
function fmtDisplay(v, nf) {
  if (FX.isErr(v)) return v;
  if (typeof v === "number" && isFinite(v) && nf && nf !== "gen") {
    if (nf === "0") return String(Math.round(v));
    if (nf === "2") return v.toFixed(2);
    if (nf === "%") return (v * 100).toFixed(1) + "%";
    if (nf === "€") return v.toFixed(2) + " €";
    if (nf === "d" || nf === "dt") {
      var ds = FX.dateStr(v, LANG, nf === "dt");
      if (ds !== null) return ds;
    }
  }
  return FX.display(v, LANG);
}

/* what a cell shows: { s: text, k: "" | "num" | "err" | "bool" }.
   Typed values show as typed (so 007 stays 007; a leading ' is
   hidden); a number format applies to numbers. Formulas show their
   result; TODAY(), DATE()… show as a date unless a format is set. */
function cellView(r, c) {
  var key = r + "," + c;
  if (Object.prototype.hasOwnProperty.call(DISP, key)) return DISP[key];
  var cel = getCell(r, c), out, nf = cel && cel.f && cel.f.nf;
  if (!cel || cel.v === "") out = { s: "", k: "" };
  else if (cel.v.charAt(0) === "=") {
    var res = evalCell(actSID, r, c);
    if (!nf) nf = FX.autoDate(cel.v);
    out = { s: fmtDisplay(res, nf),
            k: FX.isErr(res) ? "err" : typeof res === "number" ? "num" : typeof res === "boolean" ? "bool" : "" };
  } else {
    var lv = FX.literal(cel.v);
    if (typeof lv === "number") out = { s: nf ? fmtDisplay(lv, nf) : cel.v, k: "num" };
    else out = { s: cel.v.charAt(0) === "'" ? cel.v.slice(1) : cel.v,
                 k: FX.isErr(lv) ? "err" : typeof lv === "boolean" ? "bool" : "" };
  }
  DISP[key] = out;
  return out;
}
function displayVal(r, c) { return cellView(r, c).s; }

/* ===== SECTION 3b2: CLIPBOARD (internal, ref-shifting) ===== */

/* CLIP = { sid, w, h, cells: [[{v,f}|null,...],...] } — device-local */
var CLIP = null;

function copySelection(cut) {
  if (editing) cancelEdit();
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  var cells = [], r, c;
  for (r = top; r <= bot; r++) {
    var rowArr = [];
    for (c = lef; c <= rig; c++) {
      var sn = snapCell(actSID, r, c);
      rowArr.push(sn ? { v: sn.v, f: sn.f ? clone(sn.f) : undefined } : null);
    }
    cells.push(rowArr);
  }
    CLIP = { sid: actSID, w: rig - lef + 1, h: bot - top + 1, cells: cells,
           originR: top, originC: lef };

  if (cut) {
    var entries = [];
    for (r = top; r <= bot; r++)
      for (c = lef; c <= rig; c++) {
        var before = snapCell(actSID, r, c);
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: cellKey(actSID, r, c), before: before, after: null });
        }
      }
    if (entries.length) {
      invalidateEval();
      markDirty();
      pushUndo(entries);
    }
    renderGrid();
    renderSelection();
  }
}

/* Shift relative refs in "=FORMULA" by (dr, dc) (functions.js): the
   text around the references stays as typed; $A$1 parts stay; refs
   that would leave the sheet become #REF!. Sheet!A1 refs move too. */
function shiftFormula(formula, dr, dc) {
  return FX.shiftFormula(formula, dr, dc, MAX_ROWS, MAX_COLS);
}

function pasteClipboard() {
  if (editing) cancelEdit();
  if (!CLIP) { notifyTransient(t("clip.empty")); return; }
  var sheet = getActiveSheet();
  if (!sheet) return;

  var top = selTop(), lef = selLeft();
  var entries = [], r, c;

  /* a paste past the last row / column grows the sheet (up to the caps) */
  var needR = Math.min(top + CLIP.h, MAX_ROWS), needC = Math.min(lef + CLIP.w, MAX_COLS);
  if (needR > sheet.rows || needC > sheet.cols) {
    sheet.rows = Math.max(sheet.rows, needR);
    sheet.cols = Math.max(sheet.cols, needC);
    sheet.mtime = now();
    markDirty();
    buildGrid();
  }

  for (r = 0; r < CLIP.h; r++) {
    for (c = 0; c < CLIP.w; c++) {
      var tr = top + r, tc = lef + c;
      if (tr >= sheet.rows || tc >= sheet.cols) continue; /* clip overflow */
      var src = CLIP.cells[r][c];
      var key = cellKey(actSID, tr, tc);
      var before = snapCell(actSID, tr, tc);
      if (!src) {
        /* source empty — clear target */
        if (before) {
          rawDel(actSID, tr, tc);
          entries.push({ key: key, before: before, after: null });
        }
        continue;
      }
      var nv = src.v;
      /* shift relative refs by the paste offset from source origin */
      if (nv.charAt(0) === "=" && CLIP.originR !== undefined) {
        nv = shiftFormula(nv, top - CLIP.originR, lef - CLIP.originC);
      }
      var after = { v: nv };
      if (src.f) after.f = clone(src.f);
      rawSet(actSID, tr, tc, nv, after.f);
      entries.push({ key: key, before: before,
        after: { v: nv, f: src.f ? clone(src.f) : undefined } });
    }
  }

  if (entries.length) {
    invalidateEval();
    markDirty();
    pushUndo(entries);
  }
  /* selection expands to pasted rect */
  selR = top; selC = lef;
  selAR = Math.min(top + CLIP.h - 1, sheet.rows - 1);
  selAC = Math.min(lef + CLIP.w - 1, sheet.cols - 1);
  renderGrid();
  renderSelection();
}

/* ===== SECTION 3c: RENDER (virtual rows · frozen panes · filter) =====
   Only the rows in view (plus BUF on each side) exist in the DOM; two
   spacer rows stand in for the rest, so a 10,000-row sheet costs about
   what a 100-row one did. Every row has the same height (ROWH, from
   the CSS), so a row's place is index × ROWH. Columns are all built.
   Frozen rows are always rendered first, sticky under the header;
   frozen columns are sticky after the row numbers.
   VIS = the rows that are shown (the device-local filter hides some),
   in order; POS[r] = index of row r in VIS, -1 when hidden; VIS[0 …
   SL0-1] are the frozen rows, the rest scroll. */

var cellRefs = {};      /* r -> [td, …]  (rendered rows only) */
var rowEls = {};        /* r -> tr */
var rowHeads = {};      /* r -> th.rowh */
var lastPainted = {};   /* r -> [painted text marker, …] */
var colHeads = [];
var headRow = null;
var DISP = {};
var VIS = [], POS = null, SL0 = 0;
var FR = 0, FC = 0;     /* frozen rows / columns in effect */
var ROWH = 28, HEADH = 28, ROWHEADW = 44, DEFW = 88;
var COLLEFT = [];       /* left edge of each column inside the table */
var WIN0 = 0, WIN1 = 0; /* rendered scrolling rows: VIS[SL0+WIN0 … SL0+WIN1-1] */
var BUILT = "";         /* layout the grid was built for (sync rebuild check) */
var tbodyEl = null, spTop = null, spBot = null;
var BUF = 30;

function layoutSig(sh) {
  return JSON.stringify([sh.id, sh.rows, sh.cols, sh.cw || {}, sh.fz || null]);
}
function colW(sheet, c) { return (sheet.cw && sheet.cw[c]) || DEFW; }

function computeVis(sheet) {
  var hidden = filterHidden(sheet), r;
  VIS = []; POS = new Int32Array(sheet.rows);
  for (r = 0; r < sheet.rows; r++) {
    if (hidden && hidden[r]) { POS[r] = -1; continue; }
    POS[r] = VIS.length; VIS.push(r);
  }
  var fz = normFz(sheet.fz, sheet) || { r: 0, c: 0 };
  FR = fz.r; FC = fz.c;
  SL0 = 0;
  while (SL0 < VIS.length && VIS[SL0] < FR) SL0++;
}

function mkSpacer() {
  var tr = document.createElement("tr");
  tr.className = "sp";
  var td = document.createElement("td");
  td.colSpan = (getActiveSheet().cols || 1) + 1;
  tr.appendChild(td);
  tr.style.display = "none";
  return tr;
}
function setSpacer(tr, h) {
  if (h <= 0) { tr.style.display = "none"; return; }
  tr.style.display = "";
  tr.firstChild.style.height = h + "px";
}

function inSelRows(r) { return r >= selTop() && r <= selBottom(); }

function createRow(r, fi) {
  var sheet = getActiveSheet(), c;
  var tr = document.createElement("tr");
  tr.dataset.r = r;
  var th = document.createElement("th");
  th.className = "rowh" + (inSelRows(r) ? " hl" : "");
  th.textContent = String(r + 1);
  tr.appendChild(th);
  var tds = [], lp = [];
  for (c = 0; c < sheet.cols; c++) {
    var td = document.createElement("td");
    if (sheet.cw[c]) { td.style.width = sheet.cw[c] + "px"; td.style.minWidth = sheet.cw[c] + "px"; }
    if (c < FC) td.style.left = COLLEFT[c] + "px";
    tr.appendChild(td);
    tds.push(td); lp.push(null);
  }
  if (fi >= 0) {
    tr.className = "fzr" + (fi === SL0 - 1 ? " fzl" : "");
    var top = (HEADH + fi * ROWH) + "px";
    th.style.top = top;
    for (c = 0; c < tds.length; c++) tds[c].style.top = top;
  }
  rowEls[r] = tr; rowHeads[r] = th; cellRefs[r] = tds; lastPainted[r] = lp;
  for (c = 0; c < tds.length; c++) paintCell(r, c);
  return tr;
}

function dropRow(r) {
  var tr = rowEls[r];
  if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
  delete rowEls[r]; delete cellRefs[r]; delete rowHeads[r]; delete lastPainted[r];
}

function buildGrid() {
  var tbl = $("grid");
  if (!tbl) { console.error("[SS] CRITICAL: #grid element missing!"); return; }
  var sheet = getActiveSheet();
  if (!sheet) { console.error("[SS] CRITICAL: no active sheet!"); return; }
  if (typeof sheet.rows !== "number" || sheet.rows < 1) sheet.rows = ROWS;
  if (typeof sheet.cols !== "number" || sheet.cols < 1) sheet.cols = COLS;
  if (!sheet.cw || typeof sheet.cw !== "object") sheet.cw = {};

  var r, c, th, i;
  tbl.innerHTML = "";
  cellRefs = {}; rowEls = {}; rowHeads = {}; lastPainted = {};
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; }
  DISP = {};
  computeVis(sheet);

  var thead = document.createElement("thead");
  headRow = document.createElement("tr");
  th = document.createElement("th");
  th.className = "corner";
  headRow.appendChild(th);
  colHeads = [th];
  for (c = 0; c < sheet.cols; c++) {
    th = document.createElement("th");
    th.textContent = colName(c);
    if (sheet.cw[c]) th.style.width = sheet.cw[c] + "px";
    if (c < FC) th.className = "fzc" + (c === FC - 1 ? " fzcl" : "");
    headRow.appendChild(th);
    colHeads.push(th);
  }
  thead.appendChild(headRow);
  tbl.appendChild(thead);

  tbodyEl = document.createElement("tbody");
  tbl.appendChild(tbodyEl);

  /* measure: header height, row height (CSS decides: 28 / 34 px), row-number width */
  var probe = document.createElement("tr");
  probe.innerHTML = '<th class="rowh">1</th><td></td>';
  tbodyEl.appendChild(probe);
  ROWH = probe.offsetHeight || ROWH;
  ROWHEADW = colHeads[0].offsetWidth || ROWHEADW;
  HEADH = headRow.offsetHeight || HEADH;
  tbodyEl.removeChild(probe);
  COLLEFT = [];
  var x = ROWHEADW;
  for (c = 0; c < sheet.cols; c++) { COLLEFT.push(x); x += colW(sheet, c); }
  for (c = 0; c < FC; c++) colHeads[c + 1].style.left = COLLEFT[c] + "px";

  for (i = 0; i < SL0; i++) tbodyEl.appendChild(createRow(VIS[i], i));
  spTop = mkSpacer(); spBot = mkSpacer();
  tbodyEl.appendChild(spTop);
  tbodyEl.appendChild(spBot);
  WIN0 = WIN1 = 0;
  renderWindow(true);
  initColResize();
  BUILT = layoutSig(sheet);
  void r;
}

/* put the rows in view (± BUF) in the DOM; force = rebuild the window */
function renderWindow(force) {
  if (!tbodyEl || !spTop) return;
  var wrap = $("grid-wrap");
  var n = VIS.length - SL0;
  var st = wrap ? wrap.scrollTop : 0, ch = (wrap && wrap.clientHeight) || 800;
  var v0 = Math.max(0, Math.floor(st / ROWH));
  var v1 = Math.min(n, Math.ceil((st + ch) / ROWH) + 1);
  if (!force && v0 >= WIN0 && v1 <= WIN1) return;
  var w0 = Math.max(0, v0 - BUF), w1 = Math.min(n, v1 + BUF);
  /* an open editor whose row would leave the DOM is committed first */
  if (editing && editingR >= 0 && POS && POS[editingR] >= SL0) {
    var ek = POS[editingR] - SL0;
    if (ek < w0 || ek >= w1) commitEdit(0, 0);
  }
  var key, r, k;
  for (key in rowEls) {
    r = +key;
    if (POS[r] >= 0 && POS[r] < SL0) continue;          /* frozen */
    k = POS[r] - SL0;
    if (POS[r] < 0 || k < w0 || k >= w1) dropRow(r);
  }
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; DISP = {}; }
  for (k = w0; k < w1; k++) {
    r = VIS[SL0 + k];
    var tr = rowEls[r] || createRow(r, -1);
    tbodyEl.insertBefore(tr, spBot);
  }
  setSpacer(spTop, w0 * ROWH);
  setSpacer(spBot, (n - w1) * ROWH);
  WIN0 = w0; WIN1 = w1;
}

var winRaf = 0;
function onGridScroll() {
  if (winRaf) return;
  winRaf = (window.requestAnimationFrame || setTimeout)(function () {
    winRaf = 0;
    renderWindow(false);
  });
}

/* scroll so the cell (r, c) is in view, outside the frozen panes */
function ensureVisible(r, c) {
  var wrap = $("grid-wrap");
  if (!wrap || !POS) return;
  var sheet = getActiveSheet();
  if (r >= 0 && r < POS.length && POS[r] >= SL0) {
    var y = (POS[r] - SL0) * ROWH, top = wrap.scrollTop;
    var avail = wrap.clientHeight - HEADH - SL0 * ROWH;
    if (y < top) wrap.scrollTop = y;
    else if (y + ROWH > top + avail) wrap.scrollTop = y + ROWH - Math.max(ROWH, avail);
  }
  if (c >= FC && c < COLLEFT.length) {
    var x = COLLEFT[c], w = colW(sheet, c);
    var frozenW = FC ? COLLEFT[FC - 1] + colW(sheet, FC - 1) : ROWHEADW;
    var left = wrap.scrollLeft, cw = wrap.clientWidth;
    if (x < left + frozenW) wrap.scrollLeft = Math.max(0, x - frozenW);
    else if (x + w > left + cw) wrap.scrollLeft = x + w - cw;
  }
  renderWindow(false);
}

function paintCell(r, c) {
  if (editing && editingR === r && editingC === c) return;
  var tds = cellRefs[r], td = tds && tds[c];
  if (!td) return;
  var cel = getCell(r, c);
  var view = cellView(r, c), disp = view.s;
  var fh = filterHead(r, c);
  var mark = fh ? disp + "\u0001" + fh : disp;
  if (lastPainted[r][c] !== mark) {
    lastPainted[r][c] = mark;
    td.textContent = disp;
    if (fh) {
      var b = document.createElement("span");
      b.className = "fbtn" + (fh === 2 ? " on" : "");
      b.setAttribute("role", "button");
      b.title = t("flt.col");
      b.setAttribute("aria-label", t("flt.col"));
      b.innerHTML = IC_FILTER;
      td.appendChild(b);
    }
  }

  /* class rebuild: base (num/err/bool) + format + panes + selection */
  var cls = view.k;
  if (fh) cls += " fhd";
  if (c < FC) cls += " fzc" + (c === FC - 1 ? " fzcl" : "");
  var f = cel && cel.f;
  if (f) {
    if (f.b) cls += " fb";
    if (f.i) cls += " fi";
    if (f.u) cls += " fu";
    if (f.al === "c") cls += " fa-c";
    else if (f.al === "r") cls += " fa-r";
    else if (f.al === "l") cls += " fa-l";
  }
  var inRange = (r >= selTop() && r <= selBottom() &&
                 c >= selLeft() && c <= selRight());
  if (inRange && !(r === selR && c === selC) && selIsRange()) cls += " rangesel";
  if (r === selR && c === selC) cls += " sel";

  if (td.dataset.cls !== cls) {
    td.dataset.cls = cls;
    td.className = cls;
  }
  if (f && f.co) td.style.color = f.co;
  else if (td.style.color) td.style.color = "";
}

function renderGrid() {
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; }
  DISP = {};
  var key, c, row;
  for (key in cellRefs) {
    row = cellRefs[key];
    for (c = 0; c < row.length; c++) paintCell(+key, c);
  }
  updateFilterStatus();
}

function refreshCell(r, c) { DISP = {}; paintCell(r, c); }

function renderSelection() {
  var i, key;
  for (key in rowHeads) rowHeads[key].classList.remove("hl");
  for (i = 0; i < colHeads.length; i++) colHeads[i].classList.remove("hl");

  var prev = document.querySelectorAll("#grid td.sel, #grid td.rangesel");
  for (i = 0; i < prev.length; i++)
    prev[i].classList.remove("sel", "rangesel");

  if (selR < 0 || selC < 0) return;
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) td.classList.add("sel");
  if (rowHeads[selR]) rowHeads[selR].classList.add("hl");
  if (colHeads[selC + 1]) colHeads[selC + 1].classList.add("hl");
  if (selIsRange()) {
    var c, top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
    for (key in cellRefs) {
      var r = +key;
      if (r < top || r > bot) continue;
      for (c = lef; c <= rig; c++) {
        if (r === selR && c === selC) continue;
        var rt = cellRefs[key][c];
        if (rt) rt.classList.add("rangesel");
      }
      if (rowHeads[key]) rowHeads[key].classList.add("hl");
    }
    for (i = lef; i <= rig; i++) if (colHeads[i + 1]) colHeads[i + 1].classList.add("hl");
  }

  var refTxt = colName(selC) + (selR + 1) +
    (selIsRange() ? ":" + colName(selRight()) + (selBottom() + 1) : "");
  $("st-sel").textContent = refTxt;
  $("fx-ref").textContent = colName(selC) + (selR + 1);
  var cel = getCell(selR, selC);
  var fxv = cel ? cel.v : "";
  var fxi = $("fx-input");
  if (!fxFocused) {
    fxi.value = fxv;
  } else if (fxi.value === fxStartVal && fxv !== fxStartVal) {
    /* SS-4: the formula bar is focused but untouched: follow the data */
    fxi.value = fxv; fxStartVal = fxv;
  }
  updateToolbar();
}

/* ===== SECTION 3d: EDITING FLOW ===== */

function beginEdit(initialText) {
  if (editing) return;
  collapseSel(); /* typing replaces the range — single-cell edit */
  ensureVisible(selR, selC);
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (!td) return;
  editing = true; editingR = selR; editingC = selC;

  editInput = document.createElement("input");
  editInput.type = "text";
  editInput.autocomplete = "off";
  editInput.spellcheck = false;
  var startCel = getCell(selR, selC);
  editStartVal = startCel ? startCel.v : "";
  editInput.value =
    (initialText !== undefined && initialText !== null)
      ? initialText : editStartVal;
  td.textContent = "";
  td.className = "cell-editor" + (selC < FC ? " fzc" : "");
  td.appendChild(editInput);
  editInput.focus();
  if (initialText !== undefined) editInput.setSelectionRange(
    editInput.value.length, editInput.value.length);

  editInput.addEventListener("keydown", function (e) {
    if (fxHelpKey(e, editInput)) { e.stopPropagation(); return; }
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    e.stopPropagation();
  });
  editInput.addEventListener("input", function () {
    $("fx-input").value = editInput.value;
    fxHelpUpdate(editInput);
  });
  editInput.addEventListener("blur", function () { setTimeout(fxHelpHideSoon, 150); });
}

function endEditDom() {
  var td = cellRefs[editingR] && cellRefs[editingR][editingC];
  if (td && editInput && td.contains(editInput)) td.removeChild(editInput);
  editInput = null;
  editing = false;
  fxHelpHide();
  if (lastPainted[editingR]) lastPainted[editingR][editingC] = null;
  if (td) delete td.dataset.cls;
  editingR = -1; editingC = -1;
}

function commitEdit(dr, dc) {
  if (!editing) return;
  var raw = editInput ? editInput.value : "";
  var val = raw.replace(/^\s+|\s+$/g, "");
  var r = editingR, c = editingC;
  /* SS-4: an editor whose text was never changed writes nothing (it
     could hold a value another device has replaced meanwhile) */
  if (raw === editStartVal) {
    /* untouched */
  } else if (val === "") {
    if (getCell(r, c)) deleteCell(r, c);
  } else {
    setCell(r, c, val);
  }
  var hadFocus = editInput && document.activeElement === editInput;
  endEditDom();
  /* the editor left the DOM: keep the keyboard on the grid */
  if (hadFocus) try { $("grid-wrap").focus({ preventScroll: true }); } catch (e) {}
  queueSave();
  invalidateEval();
  renderGrid();
  if (dr || dc) navigate(dr, dc);
  renderSelection();
}

function cancelEdit() {
  if (!editing) return;
  var r = editingR, c = editingC;
  endEditDom();
  refreshCell(r, c);
  renderSelection();
  $("grid-wrap").focus();
}

/* the shown row `steps` visible rows away from r (filtered rows are skipped) */
function stepRow(r, steps) {
  if (!VIS.length) return r;
  var k = POS && r < POS.length ? POS[r] : -1;
  if (k < 0) {   /* r is hidden: start from the next shown row */
    k = 0;
    while (k < VIS.length - 1 && VIS[k] < r) k++;
    if (steps > 0) steps--;
  }
  k = Math.min(Math.max(k + steps, 0), VIS.length - 1);
  return VIS[k];
}

function navigate(dr, dc, extend) {
  var sheet = getActiveSheet();
  if (!sheet) return;
  var nr = dr ? stepRow(selR, dr) : selR;
  var nc = Math.min(Math.max(selC + dc, 0), sheet.cols - 1);
  if (extend) {
    /* Shift+Arrow: extend the range from the anchor */
    selR = nr; selC = nc;
    ensureVisible(selR, selC);
    renderSelection();
    return;
  }
  if (nr === selR && nc === selC && !selIsRange()) return;
  collapseSel(nr, nc);
  ensureVisible(selR, selC);
  renderSelection();
}

function clearSelected() {
  if (editing) return;
  if (selIsRange()) { deleteSelection(); return; }
  if (getCell(selR, selC)) {
    deleteCell(selR, selC);
    queueSave();
    invalidateEval();
    renderGrid();
  }
}

/* ===== SECTION 3d2: FORMAT OPS (undoable, whole-selection) ===== */

function applyFormatToSelection(mut) {
  if (editing) cancelEdit();
  var entries = [], r, c, changed = false;
  /* a whole column / row selected: format the used part only (an
     empty cell with a format is a stored, synced cell) */
  var ext = sheetExtent(actSID), sh = getActiveSheet();
  var bot = selBottom(), rig = selRight();
  if (selTop() === 0 && bot === sh.rows - 1 && bot - selTop() > 200) bot = Math.max(selR, ext.rows - 1);
  if (selLeft() === 0 && rig === sh.cols - 1 && rig - selLeft() > 26) rig = Math.max(selC, ext.cols - 1);
  for (r = selTop(); r <= bot; r++)
    for (c = selLeft(); c <= rig; c++) {
      var key = cellKey(actSID, r, c);
      var before = snapCell(actSID, r, c);
      var cel = state.cells[key];
      var f = cel && cel.f ? clone(cel.f) : {};
      var res = mut(f); /* returns {v?, f} or null to delete cell */
      if (!res) continue;
      if (res.remove) {
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: key, before: before, after: null });
          changed = true;
        }
        continue;
      }
      var nv = res.v !== undefined ? res.v : (cel ? cel.v : "");
      var sf = sanitizeF(res.f);
      if (!sf && nv === "") {
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: key, before: before, after: null });
          changed = true;
        }
        continue;
      }
      rawSet(actSID, r, c, nv, sf);
      entries.push({ key: key, before: before,
        after: snapCell(actSID, r, c) });
      changed = true;
    }
  if (changed) {
    markDirty();
    pushUndo(entries);
    invalidateEval();
    renderGrid();
    renderSelection();
  }
}

function fmtToggle(field) {
  return function (f) {
    f[field] = f[field] ? 0 : 1;
    return { f: f };
  };
}

function fmtAlign(al) {
  return function (f) {
    if (f.al === al) delete f.al; else f.al = al;
    return { f: f };
  };
}

function fmtColor(co) {
  return function (f) {
    if (f.co === co) delete f.co; else f.co = co;
    return { f: f };
  };
}

function fmtNumFormat(nf) {
  return function (f) {
    if (!nf || f.nf === nf || (nf === "gen")) delete f.nf; else f.nf = nf;
    return { f: f };
  };
}

function clearFormat() {
  return function (f) { return { f: {} }; };
}

/* SWATCHES — 8 preset colors from OS palette space */
var SWATCHES = ["#c8a96e","#d9bd88","#87cf3e","#e0a44c",
                "#e06c75","#a78bfa","#7dd3fc","#e8e4dc"];

function toggleSwatchPopover() {
  var pop = $("swatches");
  if (!pop) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = "";
  var btn = $("tb-col");
  var br = btn.getBoundingClientRect();
  var i;
  for (i = 0; i < SWATCHES.length; i++) {
    (function (co) {
      var sw = document.createElement("div");
      sw.className = "sw";
      sw.style.background = co;
      sw.title = co;
      sw.addEventListener("click", function () {
        applyFormatToSelection(fmtColor(co));
        pop.hidden = true;
      });
      pop.appendChild(sw);
    })(SWATCHES[i]);
  }
  pop.hidden = false;
  /* SS-9: kept inside the viewport (the color button sits at the far
     end of a scrolled toolbar on a phone) */
  var pw = pop.offsetWidth;
  pop.style.left = Math.max(4, Math.min(br.left, window.innerWidth - pw - 4)) + "px";
  pop.style.top = (br.bottom + 4) + "px";
}

/* --- toolbar state reflection --- */
function updateToolbar() {
  var u = $("tb-undo"), rd = $("tb-redo");
  if (u) u.disabled = undoStack.length === 0;
  if (rd) rd.disabled = redoStack.length === 0;

  var cel = getCell(selR, selC);
  var f = cel && cel.f;
  var on = function (id, flag) {
    var el = $(id);
    if (el) { if (flag) el.classList.add("on"); else el.classList.remove("on"); }
  };
  on("tb-bold", !!(f && f.b));
  on("tb-ital", !!(f && f.i));
  on("tb-und",  !!(f && f.u));
  on("tb-al-l", !f || !f.al || f.al === "l");
  on("tb-al-c", !!(f && f.al === "c"));
  on("tb-al-r", !!(f && f.al === "r"));
  var nf = $("tb-nf");
  if (nf) nf.value = (f && f.nf) ? f.nf : "gen";
}

/* ===== SECTION 3d3: COLUMN RESIZE (mouse only) ===== */

var rsDrag = null, rsStartX = 0, rsStartW = 0, rsCol = -1;

function initColResize() {
  /* per-header handlers only — <th> elements are discarded with the
     table rebuild, so they cannot leak. Document-level handlers are
     attached ONCE (initResizeDocHandlers, called from wire()). */
  var i;
  for (i = 1; i < colHeads.length; i++) {
    (function (th, ci) {
      th.addEventListener("mousemove", function (e) {
        if (rsDrag) return;
        var rect = th.getBoundingClientRect();
        if (e.clientX > rect.right - 6) th.classList.add("colresize");
        else th.classList.remove("colresize");
      });
      th.addEventListener("mousedown", function (e) {
        var rect = th.getBoundingClientRect();
        if (e.clientX <= rect.right - 6) return; /* not on the edge */
        e.preventDefault();
        rsDrag = th; rsStartX = e.clientX;
        rsStartW = rect.width; rsCol = ci - 1;
      });
    })(colHeads[i], i);
  }
}

function initResizeDocHandlers() {
  /* attached exactly once for the app lifetime */
  document.addEventListener("mousemove", function (e) {
    if (!rsDrag) return;
    var sheet = getActiveSheet(); /* fresh: never a stale sheet entity */
    if (!sheet) return;
    var w = Math.max(40, Math.min(400, rsStartW + (e.clientX - rsStartX)));
    sheet.cw = sheet.cw || {};
    sheet.cw[rsCol] = w;
    if (colHeads[rsCol + 1]) colHeads[rsCol + 1].style.width = w + "px";
    var key;
    for (key in cellRefs) {
      var td = cellRefs[key][rsCol];
      if (td) { td.style.width = w + "px"; td.style.minWidth = w + "px"; }
    }
  });
  document.addEventListener("mouseup", function () {
    if (!rsDrag) return;
    rsDrag = null;
    /* persist via sheet entity LWW */
    var sheet = getActiveSheet();
    if (sheet) {
      sheet.mtime = now(); markDirty();
      if (FC) { buildGrid(); renderGrid(); renderSelection(); }   /* frozen offsets */
      else {
        COLLEFT = []; var x = ROWHEADW;
        for (var c = 0; c < sheet.cols; c++) { COLLEFT.push(x); x += colW(sheet, c); }
        BUILT = layoutSig(sheet);
      }
    }
  });
}

/* ===== SECTION 3h: SORT · FILTER · FREEZE · ROWS / COLUMNS · MENUS =====
   Sort and Insert / Delete write cells like any edit (per-cell stamps,
   one Undo step). Freeze is the sheet's fz field (synced like column
   widths). Filters are a view of this device only: oros-spreadsheet-view
   { <sheetId>: { flt: { top, l, r, cols: { <c>: { q, ex: [...] } } } } },
   never in the sync slice. */

/* which grid cell / header an element belongs to */
function gridPos(el) {
  var cell = el;
  while (cell && cell.tagName !== "TD" && cell.tagName !== "TH") {
    if (cell.id === "grid") return null;
    cell = cell.parentElement;
  }
  if (!cell) return null;
  var tr = cell.parentElement;
  if (!tr || tr.classList.contains("sp")) return null;
  if (tr.parentElement && tr.parentElement.tagName === "THEAD")
    return cell.cellIndex > 0 ? { col: cell.cellIndex - 1 } : { all: true };
  if (tr.dataset.r === undefined) return null;
  var r = +tr.dataset.r;
  if (cell.tagName === "TH") return { row: r };
  return { r: r, c: cell.cellIndex - 1, td: cell };
}

function freshEval() {
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; DISP = {}; }
}

/* a cell's full copy {v, f?, cv?} or null */
function snapFull(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  if (!cel) return null;
  var o = { v: cel.v };
  if (cel.f) o.f = clone(cel.f);
  if (typeof cel.cv === "string") o.cv = cel.cv;
  return o;
}

/* write { key: {v, f?, cv?} | null } as ONE undo step (+ an optional
   sheet-size entry). Unchanged cells are not touched (no new stamps). */
function commitChanges(changes, dim) {
  var entries = [], key;
  for (key in changes) {
    var pk = key.split("|"), sid = pk[0], r = +pk[1], c = +pk[2];
    var before = snapCell(sid, r, c), after = changes[key];
    var a2 = after ? { v: after.v } : null;
    if (a2 && after.f) a2.f = clone(after.f);
    if (JSON.stringify(before) === JSON.stringify(a2)) continue;
    if (!a2 || (a2.v === "" && !a2.f)) {
      if (!before) continue;
      rawDel(sid, r, c);
      entries.push({ key: key, before: before, after: null });
    } else {
      rawSet(sid, r, c, a2.v, a2.f);
      if (after.cv && state.cells[key] && state.cells[key].v === after.v) state.cells[key].cv = after.cv;
      entries.push({ key: key, before: before, after: a2 });
    }
  }
  if (dim) entries.push(dim);
  if (!entries.length) return false;
  invalidateEval();
  markDirty();
  pushUndo(entries);
  return true;
}

function hasValue(r, c) {
  var cel = state.cells[cellKey(actSID, r, c)];
  return !!(cel && cel.v !== "");
}
function dataRegion(r, c) {
  var sh = getActiveSheet();
  return FX.region(hasValue, r, c, sh.rows, sh.cols);
}

/* ---------- sort ---------- */
function looksLikeHeading(rg) {
  var c, r, any = false, bold = false;
  for (c = rg.l; c <= rg.r; c++) {
    var cel = getCell(rg.t, c);
    if (!cel || cel.v === "") continue;
    if (cel.v.charAt(0) === "=" || typeof FX.literal(cel.v) !== "string") return false;
    any = true;
    if (cel.f && cel.f.b) bold = true;
  }
  if (!any) return false;
  if (bold) return true;
  for (r = rg.t + 1; r <= Math.min(rg.b, rg.t + 10); r++)
    for (c = rg.l; c <= rg.r; c++)
      if (hasValue(r, c) && typeof evalCell(actSID, r, c) === "number") return true;
  return false;
}

function sortSelection(desc) {
  if (editing) commitEdit(0, 0);
  freshEval();
  var rg, hdr = false, r, c, i;
  if (selIsRange()) {
    var ext = sheetExtent(actSID);
    rg = { t: selTop(), b: selBottom(), l: selLeft(), r: selRight() };
    rg.b = Math.min(rg.b, Math.max(rg.t, ext.rows - 1));
    rg.r = Math.min(rg.r, Math.max(rg.l, ext.cols - 1));
    if (FLT && FLT.top === rg.t) hdr = true;
  } else {
    rg = dataRegion(selR, selC);
    if (!rg) { notifyTransient(t("sort.none")); return; }
    if (FLT && FLT.top >= rg.t && FLT.top < rg.b) { rg.t = FLT.top; hdr = true; }
    else hdr = looksLikeHeading(rg);
  }
  var key = Math.min(Math.max(selC, rg.l), rg.r);
  var first = rg.t + (hdr ? 1 : 0);
  if (first >= rg.b) { notifyTransient(t("sort.none")); return; }
  var rows = [], vals = [];
  for (r = first; r <= rg.b; r++) { rows.push(r); vals.push(hasValue(r, key) ? evalCell(actSID, r, key) : null); }
  var order = FX.sortOrder(vals, desc, LANG), changes = {};
  for (i = 0; i < order.length; i++) {
    var src = rows[order[i]], dst = rows[i];
    if (src === dst) continue;
    for (c = rg.l; c <= rg.r; c++) {
      var sn = snapFull(actSID, src, c);
      if (sn && sn.v.charAt(0) === "=") {
        var nv = shiftFormula(sn.v, dst - src, 0);
        if (nv !== sn.v) { sn.v = nv; delete sn.cv; }
      }
      changes[cellKey(actSID, dst, c)] = sn;
    }
  }
  commitChanges(changes);
  queueSave();
  if (FLT) buildGrid();
  renderGrid();
  renderSelection();
  notifyTransient(t("sort.done").replace("{n}", rows.length).replace("{c}", colName(key)) +
    (hdr ? " · " + t("sort.hdr").replace("{r}", rg.t + 1) : ""));
}

/* ---------- filter (device-local view) ---------- */
var VIEW = null, FLT = null;
function loadView() {
  try { VIEW = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch (e) { VIEW = {}; }
  if (!VIEW || typeof VIEW !== "object" || Array.isArray(VIEW)) VIEW = {};
}
function getView(sid) {
  if (!VIEW) loadView();
  var v = VIEW[sid];
  return (v && typeof v === "object") ? v : null;
}
function setView(sid, v) {
  if (!VIEW) loadView();
  if (v) VIEW[sid] = v; else delete VIEW[sid];
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(VIEW)); } catch (e) {}
}
function readFilter(sheet) {
  var v = getView(sheet.id), f = v && v.flt;
  if (!f || typeof f !== "object") return null;
  var top = parseInt(f.top, 10), l = parseInt(f.l, 10), r = parseInt(f.r, 10);
  if (!(top >= 0 && top < sheet.rows && l >= 0 && r >= l && r < sheet.cols)) return null;
  var cols = {}, k;
  if (f.cols && typeof f.cols === "object") for (k in f.cols) {
    var c = parseInt(k, 10), x = f.cols[k];
    if (!(c >= l && c <= r) || !x || typeof x !== "object") continue;
    var o = {};
    if (typeof x.q === "string" && x.q) o.q = x.q.slice(0, 200);
    if (Array.isArray(x.ex)) { var ex = x.ex.filter(function (s) { return typeof s === "string"; }); if (ex.length) o.ex = ex.slice(0, 2000); }
    if (o.q || o.ex) cols[c] = o;
  }
  return { top: top, l: l, r: r, cols: cols };
}
function filterActive(f) { for (var k in (f && f.cols) || {}) return true; return false; }
/* the last row of the filtered table: down from the heading while the
   next row has something in the filter's columns (the first empty row
   ends it, as in Excel; rows typed right under the table join it) */
function filterBottom(f) {
  var sh = getActiveSheet(), b = f.top, c, any;
  for (;;) {
    if (b + 1 >= sh.rows) return b;
    any = false;
    for (c = f.l; c <= f.r && !any; c++) if (hasValue(b + 1, c)) any = true;
    if (!any) return b;
    b++;
  }
}
function filterHidden(sheet) {
  FLT = readFilter(sheet);
  if (!FLT || !filterActive(FLT)) return null;
  freshEval();
  var hidden = {}, bot = filterBottom(FLT), r;
  for (r = FLT.top + 1; r <= bot; r++) {
    if (!FX.filterPass(FLT, (function (row) { return function (c) { return displayVal(row, c); }; })(r)))
      hidden[r] = 1;
  }
  return hidden;
}
function filterHead(r, c) {
  if (!FLT || r !== FLT.top || c < FLT.l || c > FLT.r) return 0;
  return FLT.cols[c] ? 2 : 1;
}
function updateFilterStatus() {
  var el = $("st-flt"), sheet = getActiveSheet(), b = $("tb-filter");
  if (b) { if (FLT) b.classList.add("on"); else b.classList.remove("on"); }
  if (!el || !sheet) return;
  if (!FLT) { el.hidden = true; return; }
  var n = sheet.rows - VIS.length;
  $("st-flt-t").textContent = n > 0 ? t("flt.hidden").replace("{n}", n) : t("tb.filter");
  el.title = t("flt.local");
  el.hidden = false;
}
function rebuildKeepSel() {
  buildGrid(); renderGrid(); renderSelection();
  if (POS && POS[selR] >= 0) ensureVisible(selR, selC);
}
function toggleFilter() {
  if (editing) commitEdit(0, 0);
  if (FLT) { clearFilter(); return; }
  var rg = selIsRange() ? { t: selTop(), b: selBottom(), l: selLeft(), r: selRight() } : dataRegion(selR, selC);
  if (selIsRange()) {
    var ext = sheetExtent(actSID);
    rg.r = Math.min(rg.r, Math.max(rg.l, ext.cols - 1));
  }
  if (!rg) { notifyTransient(t("flt.none")); return; }
  setView(actSID, { flt: { top: rg.t, l: rg.l, r: rg.r, cols: {} } });
  rebuildKeepSel();
  notifyTransient(t("flt.on").replace("{r}", rg.t + 1));
}
function clearFilter() {
  closePops();
  setView(actSID, null);
  rebuildKeepSel();
}

/* ---------- popovers / menus ---------- */
var popEl = null;
function closePops() {
  if (popEl) { popEl.remove(); popEl = null; }
}
function placePop(el, anchor) {
  document.body.appendChild(el);
  popEl = el;
  if (window.innerWidth <= 480 && !anchor.x) { el.classList.add("sheet"); return; }
  var x, y, h = el.offsetHeight, w = el.offsetWidth;
  if (anchor.el) { var br = anchor.el.getBoundingClientRect(); x = br.left; y = br.bottom + 4; if (y + h > window.innerHeight - 4) y = Math.max(4, br.top - h - 4); }
  else { x = anchor.x; y = anchor.y; if (y + h > window.innerHeight - 4) y = Math.max(4, window.innerHeight - h - 4); }
  el.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + "px";
  el.style.top = Math.max(4, y) + "px";
}
function mkBtn(text, cls, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = cls || "";
  b.textContent = text;
  b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
  return b;
}

function openFilterPop(c, anchor) {
  closePops();
  if (!FLT) return;
  freshEval();
  var cur = FLT.cols[c] || {}, ex = {}, i;
  (cur.ex || []).forEach(function (s) { ex[s] = 1; });
  var bot = filterBottom(FLT), seen = {}, vals = [], CAP = 500, more = false;
  for (var r = FLT.top + 1; r <= bot; r++) {
    var s = displayVal(r, c);
    if (seen[s]) continue;
    if (vals.length >= CAP) { more = true; break; }
    seen[s] = 1; vals.push(s);
  }
  (cur.ex || []).forEach(function (s) { if (!seen[s] && vals.length < CAP + 50) { seen[s] = 1; vals.push(s); } });
  var order = FX.sortOrder(vals.map(function (v) { var n = FX.literal(v); return n === null ? null : n; }), false, LANG);

  var pop = document.createElement("div");
  pop.className = "ss-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("flt.title").replace("{c}", colName(c)));
  var h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = t("flt.title").replace("{c}", colName(c));
  pop.appendChild(h);
  var q = document.createElement("input");
  q.type = "search"; q.className = "pop-q";
  q.placeholder = t("flt.contains");
  q.setAttribute("aria-label", t("flt.contains"));
  q.value = cur.q || "";
  pop.appendChild(q);
  var acts = document.createElement("div");
  acts.className = "pop-acts";
  var list = document.createElement("div");
  list.className = "pop-list";
  var boxes = [];
  acts.appendChild(mkBtn(t("flt.all"), "", function () { boxes.forEach(function (b) { b.checked = true; }); }));
  acts.appendChild(mkBtn(t("flt.nonesel"), "", function () { boxes.forEach(function (b) { b.checked = false; }); }));
  pop.appendChild(acts);
  for (i = 0; i < order.length; i++) {
    var v = vals[order[i]];
    var lab = document.createElement("label");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !ex[v];
    cb._v = v;
    boxes.push(cb);
    var sp = document.createElement("span");
    sp.textContent = v === "" ? t("flt.empty") : v;
    if (v === "") sp.className = "dim";
    lab.appendChild(cb); lab.appendChild(sp);
    list.appendChild(lab);
  }
  pop.appendChild(list);
  var note = document.createElement("div");
  note.className = "pop-note";
  note.textContent = (more ? t("flt.more").replace("{n}", CAP) + " · " : "") + t("flt.local");
  pop.appendChild(note);
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("flt.cancel"), "", closePops));
  btns.appendChild(mkBtn(t("flt.apply"), "primary", function () {
    var nex = [];
    boxes.forEach(function (b) { if (!b.checked) nex.push(b._v); });
    var f = readFilter(getActiveSheet()) || FLT;
    var o = {};
    if (q.value.trim()) o.q = q.value.trim();
    if (nex.length) o.ex = nex;
    if (o.q || o.ex) f.cols[c] = o; else delete f.cols[c];
    setView(actSID, { flt: f });
    closePops();
    rebuildKeepSel();
  }));
  pop.appendChild(btns);
  pop.addEventListener("click", function (e) { e.stopPropagation(); });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
    e.stopPropagation();
  });
  placePop(pop, { el: anchor });
}

/* ---------- freeze ---------- */
function setFreeze(r, c) {
  if (editing) commitEdit(0, 0);
  var sheet = getActiveSheet();
  var fz = normFz({ r: r, c: c }, sheet);
  if (JSON.stringify(fz) === JSON.stringify(normFz(sheet.fz, sheet))) return;
  if (fz) sheet.fz = fz; else delete sheet.fz;
  sheet.mtime = now();
  markDirty();
  var wrap = $("grid-wrap");
  if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
  rebuildKeepSel();
}

/* ---------- insert / delete rows and columns ---------- */
function dimsOf(sh) {
  var o = { rows: sh.rows, cols: sh.cols, cw: clone(sh.cw || {}) };
  if (sh.fz) o.fz = clone(sh.fz);
  return o;
}
/* n > 0: insert n rows ("r") / columns ("c") before index `at`;
   n < 0: delete -n of them from `at`. Cells move (formats with them),
   references to them in every sheet follow (functions.js adjustFormula),
   references into deleted cells become #REF!. One Undo step. */
function structural(axis, at, n) {
  if (editing) commitEdit(0, 0);
  closePops();
  var sheet = getActiveSheet(), sid = actSID, k;
  var cur = axis === "r" ? sheet.rows : sheet.cols, max = axis === "r" ? MAX_ROWS : MAX_COLS;
  if (n > 0 && cur + n > max) {
    notifyTransient(t("max.dims").replace("{r}", MAX_ROWS.toLocaleString(LANG)).replace("{c}", MAX_COLS));
    return;
  }
  function pointsHere(hostSid) {
    return function (name) {
      if (name === null) return hostSid === sid;
      var sh = findSheetByName(name);
      return !!sh && sh.id === sid;
    };
  }
  var adj = {};
  for (k in state.cells) {
    var cel = state.cells[k];
    if (!cel || cel.v.charAt(0) !== "=") continue;
    var nv = FX.adjustFormula(cel.v, pointsHere(k.split("|")[0]), axis, at, n);
    if (nv !== cel.v) adj[k] = nv;
  }
  var changes = {}, moved = {}, pref = sid + "|", end = at - n - 1;
  for (k in state.cells) {
    var p = k.split("|");
    var snap = snapFull(p[0], +p[1], +p[2]);
    if (adj[k]) snap.v = adj[k];
    if (p[0] !== sid) { if (adj[k]) changes[k] = snap; continue; }
    var r = +p[1], c = +p[2], idx = axis === "r" ? r : c, to = -1;
    if (n > 0) { if (idx >= at) to = idx + n; }
    else if (idx >= at && idx <= end) { changes[k] = null; continue; }
    else if (idx > end) to = idx + n;
    if (to >= 0) {
      if (!changes.hasOwnProperty(k)) changes[k] = null;
      moved[axis === "r" ? cellKey(sid, to, c) : cellKey(sid, r, to)] = snap;
    } else if (adj[k]) changes[k] = snap;
  }
  for (k in moved) changes[k] = moved[k];
  void pref;
  var before = dimsOf(sheet);
  if (n > 0) { if (axis === "r") sheet.rows += n; else sheet.cols += n; }
  if (axis === "c") {
    var cw = {}, key;
    for (key in sheet.cw) {
      var ci = +key;
      if (n > 0) cw[ci >= at ? ci + n : ci] = sheet.cw[key];
      else if (ci < at) cw[ci] = sheet.cw[key];
      else if (ci > end) cw[ci + n] = sheet.cw[key];
    }
    sheet.cw = cw;
  }
  sheet.mtime = now();
  /* the device-local filter heading follows its row / columns */
  if (FLT) {
    var f = readFilter(sheet);
    if (f) {
      if (axis === "r") { if (n > 0 && at <= f.top) f.top += n; else if (n < 0 && at <= f.top) { if (f.top <= end) f = null; else f.top += n; } }
      else f = null;
      setView(sid, f ? { flt: f } : null);
    }
  }
  commitChanges(changes, { dim: true, sid: sid, before: before, after: dimsOf(sheet) });
  markDirty();
  queueSave();
  buildGrid();
  renderGrid();
  renderSelection();
}

function insertRows(below) {
  var sh = getActiveSheet(), top = selTop(), bot = selBottom();
  var n = (top === 0 && bot === sh.rows - 1) ? 1 : bot - top + 1;
  structural("r", below ? bot + 1 : top, Math.min(n, 1000));
  if (below) { collapseSel(bot + 1, selC); renderSelection(); }
}
function deleteRows() {
  var top = selTop(), bot = selBottom();
  structural("r", top, -(bot - top + 1));
  collapseSel(Math.min(top, getActiveSheet().rows - 1), selC);
  renderSelection();
}
function insertCols(right) {
  var sh = getActiveSheet(), lef = selLeft(), rig = selRight();
  var n = (lef === 0 && rig === sh.cols - 1) ? 1 : rig - lef + 1;
  structural("c", right ? rig + 1 : lef, n);
  if (right) { collapseSel(selR, rig + 1); renderSelection(); }
}
function deleteCols() {
  var lef = selLeft(), rig = selRight();
  structural("c", lef, -(rig - lef + 1));
  collapseSel(selR, Math.min(lef, getActiveSheet().cols - 1));
  renderSelection();
}
/* grow at the end: no cell moves, only the sheet size (synced) */
function addRowsCols(axis, n) {
  if (editing) commitEdit(0, 0);
  var sh = getActiveSheet();
  var cur = axis === "r" ? sh.rows : sh.cols, max = axis === "r" ? MAX_ROWS : MAX_COLS;
  if (cur >= max) {
    notifyTransient(t("max.dims").replace("{r}", MAX_ROWS.toLocaleString(LANG)).replace("{c}", MAX_COLS));
    return;
  }
  var before = dimsOf(sh);
  if (axis === "r") sh.rows = Math.min(max, sh.rows + n); else sh.cols = Math.min(max, sh.cols + n);
  sh.mtime = now();
  pushUndo([{ dim: true, sid: actSID, before: before, after: dimsOf(sh) }]);
  markDirty();
  rebuildKeepSel();
}

function openSheetMenu(anchor) {
  if (editing) commitEdit(0, 0);
  closePops();
  var sh = getActiveSheet();
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  var m = document.createElement("div");
  m.className = "ss-pop ss-menu";
  m.setAttribute("role", "menu");
  m.setAttribute("aria-label", t("menu.label"));
  function item(text, fn, disabled) {
    var b = mkBtn(text, "mi", function () { closePops(); fn(); });
    b.setAttribute("role", "menuitem");
    if (disabled) b.disabled = true;
    m.appendChild(b);
  }
  function sep() { var d = document.createElement("div"); d.className = "msep"; m.appendChild(d); }
  var fzr = normFz(sh.fz, sh) || { r: 0, c: 0 };
  if (selR > 0 && selR + 1 <= FZ_MAX_R) item(t("fz.rows").replace("{n}", selR + 1), function () { setFreeze(selR + 1, fzr.c); });
  else item(t("fz.top"), function () { setFreeze(1, fzr.c); }, fzr.r === 1);
  if (selC + 1 <= FZ_MAX_C) item(selC === 0 ? t("fz.col1") : t("fz.cols").replace("{c}", colName(selC)), function () { setFreeze(fzr.r, selC + 1); }, selC === 0 && fzr.c === 1);
  if (fzr.r || fzr.c) item(t("fz.off"), function () { setFreeze(0, 0); });
  sep();
  var fullCols = top === 0 && bot === sh.rows - 1, fullRows = lef === 0 && rig === sh.cols - 1;
  item(t("row.insA"), function () { insertRows(false); }, sh.rows >= MAX_ROWS);
  item(t("row.insB"), function () { insertRows(true); }, sh.rows >= MAX_ROWS);
  item(top === bot ? t("row.del1").replace("{a}", top + 1) : t("row.del").replace("{a}", top + 1).replace("{b}", bot + 1), deleteRows, fullCols && sh.rows > 1000);
  sep();
  item(t("col.insL"), function () { insertCols(false); }, sh.cols >= MAX_COLS);
  item(t("col.insR"), function () { insertCols(true); }, sh.cols >= MAX_COLS);
  item(lef === rig ? t("col.del1").replace("{a}", colName(lef)) : t("col.del").replace("{a}", colName(lef)).replace("{b}", colName(rig)), deleteCols, fullRows && sh.cols > 26);
  sep();
  item(t("add.rows").replace("{n}", 100), function () { addRowsCols("r", 100); }, sh.rows >= MAX_ROWS);
  item(t("add.rows").replace("{n}", (1000).toLocaleString(LANG)), function () { addRowsCols("r", 1000); }, sh.rows >= MAX_ROWS);
  item(t("add.cols").replace("{n}", 10), function () { addRowsCols("c", 10); }, sh.cols >= MAX_COLS);
  m.addEventListener("click", function (e) { e.stopPropagation(); });
  m.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
  });
  placePop(m, anchor);
  var first = m.querySelector("button:not([disabled])");
  if (first) try { first.focus({ preventScroll: true }); } catch (e) {}
}

/* ---------- function help (formula bar and cell editor) ---------- */
var fxHelp = { el: null, input: null, items: [], sel: -1, tok: null };
function fxHelpText(name) {
  var H = FX.HELP[LANG] || FX.HELP.en, base = name.replace(/\.[A-Z]+$/, "");
  return H[name] || H[base] || FX.HELP.en[name] || FX.HELP.en[base] || "";
}
function fxToken(inp) {
  var v = inp.value;
  if (v.charAt(0) !== "=") return null;
  var pos = (typeof inp.selectionStart === "number") ? inp.selectionStart : v.length;
  var before = v.slice(0, pos);
  if ((before.match(/"/g) || []).length % 2) return null;      /* inside a string */
  var m = before.match(/(^=|[=(,;+\-*\/^&<>\s])([A-Za-z][A-Za-z0-9.]*)$/);
  return m ? { word: m[2], start: pos - m[2].length, end: pos } : null;
}
function fxHelpHide() {
  if (fxHelp.el) { fxHelp.el.remove(); fxHelp.el = null; }
  fxHelp.items = []; fxHelp.sel = -1; fxHelp.input = null;
}
function fxHelpHideSoon() {
  if (fxHelp.input && document.activeElement === fxHelp.input) return;
  fxHelpHide();
}
function fxHelpPaint() {
  if (!fxHelp.el) return;
  var kids = fxHelp.el.children;
  for (var i = 0; i < kids.length; i++) {
    if (i === fxHelp.sel) { kids[i].classList.add("on"); kids[i].setAttribute("aria-selected", "true"); }
    else { kids[i].classList.remove("on"); kids[i].removeAttribute("aria-selected"); }
  }
}
function fxHelpAccept(name) {
  var inp = fxHelp.input, tk = fxHelp.tok;
  if (!inp || !tk) return;
  var v = inp.value;
  var ins = name + "(";
  inp.value = v.slice(0, tk.start) + ins + v.slice(tk.end).replace(/^\(/, "");
  var at = tk.start + ins.length;
  try { inp.setSelectionRange(at, at); } catch (e) {}
  if (inp === editInput) $("fx-input").value = inp.value;
  fxHelpHide();
  inp.focus();
}
function fxHelpUpdate(inp) {
  var tk = fxToken(inp);
  if (!tk) { fxHelpHide(); return; }
  var up = tk.word.toUpperCase();
  var list = FX.names().filter(function (n) { return n.indexOf(up) === 0; }).slice(0, 8);
  if (!list.length || (list.length === 1 && list[0] === up)) { fxHelpHide(); return; }
  if (!fxHelp.el) {
    fxHelp.el = document.createElement("div");
    fxHelp.el.className = "fx-help";
    fxHelp.el.setAttribute("role", "listbox");
    fxHelp.el.setAttribute("aria-label", t("fx.list"));
    document.body.appendChild(fxHelp.el);
  }
  fxHelp.input = inp; fxHelp.tok = tk; fxHelp.items = list; fxHelp.sel = -1;
  fxHelp.el.innerHTML = "";
  list.forEach(function (n) {
    var it = document.createElement("div");
    it.className = "fx-it";
    it.setAttribute("role", "option");
    var b = document.createElement("b");
    b.textContent = n + (FX.SIG[n] ? "(" + FX.SIG[n] + ")" : "");
    var d = document.createElement("span");
    d.textContent = fxHelpText(n);
    it.appendChild(b); it.appendChild(d);
    it.addEventListener("mousedown", function (e) { e.preventDefault(); fxHelpAccept(n); });
    fxHelp.el.appendChild(it);
  });
  var br = inp.getBoundingClientRect();
  var w = Math.min(420, window.innerWidth - 8);
  fxHelp.el.style.width = w + "px";
  fxHelp.el.style.left = Math.max(4, Math.min(br.left, window.innerWidth - w - 4)) + "px";
  var h = fxHelp.el.offsetHeight, y = br.bottom + 2;
  if (y + h > window.innerHeight - 4) y = Math.max(4, br.top - h - 2);
  fxHelp.el.style.top = y + "px";
}
/* keys while the list is open: arrows choose, Tab (or Enter on a
   chosen item) inserts, Esc closes. true = the key was used */
function fxHelpKey(e, inp) {
  if (!fxHelp.el || fxHelp.input !== inp) return false;
  var n = fxHelp.items.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    fxHelp.sel = e.key === "ArrowDown" ? (fxHelp.sel + 1) % n : (fxHelp.sel <= 0 ? n - 1 : fxHelp.sel - 1);
    fxHelpPaint();
    return true;
  }
  if (e.key === "Tab" || (e.key === "Enter" && fxHelp.sel >= 0)) {
    e.preventDefault();
    fxHelpAccept(fxHelp.items[Math.max(0, fxHelp.sel)]);
    return true;
  }
  if (e.key === "Escape") { e.preventDefault(); fxHelpHide(); return true; }
  return false;
}

/* the full list (the ƒx mark): pick one to put it in the cell */
function openFxList() {
  closePops();
  var pop = document.createElement("div");
  pop.className = "ss-pop fx-list";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("fx.list"));
  var h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = t("fx.list");
  pop.appendChild(h);
  var q = document.createElement("input");
  q.type = "search"; q.className = "pop-q";
  q.placeholder = t("fx.search");
  q.setAttribute("aria-label", t("fx.search"));
  pop.appendChild(q);
  var list = document.createElement("div");
  list.className = "pop-list fx-all";
  pop.appendChild(list);
  var names = FX.names().filter(function (n) { return fxHelpText(n) !== ""; });
  function fill() {
    var s = q.value.trim().toLowerCase();
    list.innerHTML = "";
    names.forEach(function (n) {
      var d = fxHelpText(n);
      if (s && n.toLowerCase().indexOf(s) < 0 && d.toLowerCase().indexOf(s) < 0) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fx-it";
      var bb = document.createElement("b");
      bb.textContent = n;
      var sp = document.createElement("span");
      sp.textContent = d;
      b.appendChild(bb); b.appendChild(sp);
      b.addEventListener("click", function (e) { e.stopPropagation(); closePops(); insertFunction(n); });
      list.appendChild(b);
    });
  }
  q.addEventListener("input", fill);
  fill();
  pop.addEventListener("click", function (e) { e.stopPropagation(); });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); }
    e.stopPropagation();
  });
  placePop(pop, { el: $("fx-mark") });
  try { q.focus({ preventScroll: true }); } catch (e) {}
}
function insertFunction(name) {
  var inp = editing && editInput ? editInput : $("fx-input");
  inp.focus();        /* focus first: the formula bar remembers its starting text on focus */
  var v = inp.value, pos = (typeof inp.selectionStart === "number" && v.charAt(0) === "=") ? inp.selectionStart : v.length;
  if (v.charAt(0) !== "=") { v = "="; pos = 1; }
  inp.value = v.slice(0, pos) + name + "(" + v.slice(pos);
  var at = pos + name.length + 1;
  try { inp.setSelectionRange(at, at); } catch (e) {}
  if (inp === editInput) $("fx-input").value = inp.value;
}

/* ===== SECTION 3e: SHEET TABS (unchanged from Wave 2) ===== */

function displayName(sh) {
  if (!sh) return "";
  if (sh.name !== null && sh.name !== undefined) return sh.name;
  return sh.bi ? (sh.bi[LANG] || sh.bi.en || sh.id) : sh.id;
}

function nextSheetNumber() {
  var n = 1, i;
  for (i = 0; i < state.sheets.length; i++) {
    var m = displayName(state.sheets[i]).match(/(\d+)\s*$/);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  }
  return n + 1;
}

function maxPos() {
  var p = 0, i;
  for (i = 0; i < state.sheets.length; i++)
    if ((state.sheets[i].pos || 0) > p) p = state.sheets[i].pos;
  return p;
}

var armX = { id: null, timer: null };

function renderTabs() {
  var nav = $("stabs");
  if (!nav) return;
  nav.innerHTML = "";

  var sheets = state.sheets.slice().sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });

  var i;
  for (i = 0; i < sheets.length; i++) {
    (function (sh) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "stab" + (sh.id === actSID ? " active" : "");

      var label = document.createElement("span");
      label.className = "stab-label";
      label.textContent = displayName(sh);
      tab.appendChild(label);

      var x = document.createElement("span");
      x.className = "stab-x";
      x.innerHTML = IC_X;
      x.title = t("tab.confirm");
      if (armX.id === sh.id) x.classList.add("armed");
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        tryDeleteSheet(sh.id);
      });
      tab.appendChild(x);

      var lpFired = false;
      tab.addEventListener("click", function (e) {
        if (lpFired) { lpFired = false; return; }   /* the long-press already acted */
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        if (editing) commitEdit(0, 0);
        switchTo(sh.id);
      });
      tab.addEventListener("dblclick", function (e) {
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        beginRename(tab, label, sh);
      });
      /* SS-10: touch twin of the double click (450 ms long-press) */
      var lpT = null;
      tab.addEventListener("touchstart", function (e) {
        if (e.target.closest && e.target.closest(".stab-x")) return;
        lpFired = false;
        lpT = setTimeout(function () { lpT = null; lpFired = true; beginRename(tab, label, sh); }, 450);
      }, { passive: true });
      var lpCancel = function () { if (lpT) { clearTimeout(lpT); lpT = null; } };
      tab.addEventListener("touchend", lpCancel, { passive: true });
      tab.addEventListener("touchmove", lpCancel, { passive: true });
      tab.addEventListener("touchcancel", lpCancel, { passive: true });
      tab.addEventListener("contextmenu", function (e) {
        if (tab.querySelector("input")) e.preventDefault();
      });

      nav.appendChild(tab);
    })(sheets[i]);
  }

  var add = document.createElement("button");
  add.type = "button";
  add.className = "stab-add";
  add.innerHTML = IC_ADD;
  add.title = t("sheet.add");
  add.setAttribute("aria-label", t("sheet.add"));
  add.addEventListener("click", function () {
    if (editing) commitEdit(0, 0);
    addSheet();
  });
  nav.appendChild(add);
}

function switchTo(id) {
  if (id === actSID) return;
  if (!getSheetById(id)) return;
  actSID = id;
  saveActive();
  collapseSel(0, 0);
  closePops();
  var wrap = $("grid-wrap");
  if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
  buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
  $("grid-wrap").focus();
}

function addSheet() {
  var n = nextSheetNumber();
  var sh = {
    id: uid(),
    name: null,
    bi: { en: "Sheet" + n, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + n },
    rows: ROWS, cols: COLS, cw: {},
    pos: maxPos() + 1,
    mtime: now()
  };
  state.sheets.push(sh);
  markDirty();
  switchTo(sh.id);
}

function tryDeleteSheet(id) {
  if (state.sheets.length <= 1) { notifyTransient(t("sheet.last")); return; }

  if (armX.id !== id) {
    if (armX.timer) clearTimeout(armX.timer);
    armX.id = id;
    armX.timer = setTimeout(function () {
      armX.id = null; renderTabs();
    }, 3000);
    notifyTransient(t("tab.confirm"));
    renderTabs();
    return;
  }
  if (armX.timer) { clearTimeout(armX.timer); }
  armX = { id: null, timer: null };

  deleteSheet(id);
}

function deleteSheet(id) {
  var i, k;

  for (i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === id) {
      state.sheets.splice(i, 1); break;
    }
  }

  var ts = now();
  state.deleted[id] = ts;
  setView(id, null);
  var pref = id + "|";
  for (k in state.cells)
    if (k.indexOf(pref) === 0) delete state.cells[k];

  if (actSID === id) {
    actSID = state.sheets[0] ? state.sheets[0].id : SID;
    collapseSel(0, 0);
    buildGrid();
  }

  markDirty();
  renderTabs();
  renderGrid();
  renderSelection();
  $("grid-wrap").focus();
}

function beginRename(tabEl, labelEl, sh) {
  var inp = document.createElement("input");
  inp.type = "text";
  inp.value = displayName(sh);
  inp.maxLength = 24;
  inp.autocomplete = "off";
  inp.spellcheck = false;
  labelEl.style.display = "none";
  tabEl.insertBefore(inp, labelEl);
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);

  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    if (commit) {
      var nv = inp.value.replace(/^\s+|\s+$/g, "");
      if (nv && nv !== displayName(sh)) {
        sh.name = nv;
        sh.bi = undefined;
        sh.mtime = now();
        markDirty();
      }
    }
    tabEl.removeChild(inp);
    labelEl.style.display = "";
    renderTabs();
    renderGrid();
    $("grid-wrap").focus();
  }

  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  inp.addEventListener("blur", function () { finish(true); });
  inp.addEventListener("click", function (e) { e.stopPropagation(); });
}

/* ===== SECTION 3f: CSV IMPORT / EXPORT ===== */

/* Encoding-safe decoder: BOM sniff first (UTF-8 / UTF-16 LE+BE),
   then strict UTF-8 validation, then Greek ANSI (windows-1253).
   Used by CSV + Excel import so Greek never turns to mojibake. */
function sniffDecode(buf) {
  var u = new Uint8Array(buf);
  if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF)
    return new TextDecoder("utf-8").decode(u.subarray(3));
  if (u.length >= 2 && u[0] === 0xFF && u[1] === 0xFE)
    return new TextDecoder("utf-16le").decode(u.subarray(2));
  if (u.length >= 2 && u[0] === 0xFE && u[1] === 0xFF)
    return new TextDecoder("utf-16be").decode(u.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u);
  } catch (e) {}
  try {
    return new TextDecoder("windows-1253").decode(u);
  } catch (e) {}
  return new TextDecoder("utf-8").decode(u);
}

function csvEscape(v) {
  v = String(v);
  if (/[",;\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function csvExport() {
  var sheet = getActiveSheet();
  if (!sheet) return;

  var maxR = -1, maxC = -1, pref = actSID + "|", k;
  for (k in state.cells) {
    if (k.indexOf(pref) !== 0) continue;
    var p = k.split("|");
    var r = parseInt(p[1], 10), c = parseInt(p[2], 10);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) { notifyTransient(t("csv.empty")); return; }

  var lines = [], r, c, row;
  for (r = 0; r <= maxR; r++) {
    row = [];
    for (c = 0; c <= maxC; c++) {
      var cel = state.cells[cellKey(actSID, r, c)];
      row.push(cel ? csvEscape(cel.v) : "");
    }
    lines.push(row.join(","));
  }
  var csv = lines.join("\r\n");

  var safeName = displayName(sheet).replace(/[^\w\- ]+/g, "_") || "sheet";
  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  var done = function () { notifyTransient(t("csv.exported")); };
  var dlg = dialogHost();
  if (dlg && typeof dlg.saveFile === "function") {
    dlg.saveFile({
      blob: blob,
      filename: safeName + ".csv",
      mime: "text/csv;charset=utf-8",
      types: [{ description: "CSV",
                accept: { "text/csv": [".csv"] } }]
    }).then(function (r) { if (r && r.ok) done(); });
    return;                       // cancel (ok=false) = silent exit
  }
  // Standalone fallback — classic download (no shell present).
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = safeName + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
  }, 500);
  done();
}

/* SS-6: Greek / European Excel writes ';'-separated CSV. The
   separator is the one of , ; TAB that occurs most in the first line
   outside quotes. */
function csvSniffSep(text) {
  var line = text.split(/\r?\n/)[0] || "", n = { ",": 0, ";": 0, "\t": 0 };
  var inQ = false, i, ch;
  for (i = 0; i < line.length; i++) {
    ch = line.charAt(i);
    if (ch === '"') inQ = !inQ;
    else if (!inQ && n.hasOwnProperty(ch)) n[ch]++;
  }
  if (n[";"] > n[","] && n[";"] >= n["\t"]) return ";";
  if (n["\t"] > n[","] && n["\t"] > n[";"]) return "\t";
  return ",";
}

function csvParse(text) {
  var rows = [], row = [], field = "", inQ = false, i, ch;
  var sep = csvSniffSep(text);
  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === sep) { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (ch === "\r") { }
      else field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  /* SS-6: hard cap at the normalizeState limits (XL_ROWS_CAP x
     XL_COLS_CAP). It cut every row to 26 columns without a word. */
  var cut = rows.length > XL_ROWS_CAP;
  if (cut) rows.length = XL_ROWS_CAP;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length > XL_COLS_CAP) { rows[r].length = XL_COLS_CAP; cut = true; }
  }
  rows.truncated = cut;
  return rows;
}

function csvImport(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var rows = csvParse(sniffDecode(reader.result));
      if (!rows.length) { notifyTransient(t("xl.readerr")); return; }

      var n = nextSheetNumber();
      var maxCols = 0, ii;
      for (ii = 0; ii < rows.length; ii++)
        if (rows[ii].length > maxCols) maxCols = rows[ii].length;

      var sh = {
        id: uid(),
        name: null,
        bi: { en: "Sheet" + n, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + n },
        rows: Math.min(Math.max(ROWS, rows.length + 5), XL_ROWS_CAP),
        cols: Math.min(Math.max(COLS, maxCols), XL_COLS_CAP),
        cw: {},
        pos: maxPos() + 1,
        mtime: now()
      };
      state.sheets.push(sh);

      var r, c, ts = now();
      for (r = 0; r < rows.length; r++)
        for (c = 0; c < rows[r].length; c++)
          if (rows[r][c] !== "")
            state.cells[cellKey(sh.id, r, c)] = { v: rows[r][c], mtime: ts };

      markDirty();
      switchTo(sh.id);
      notifyTransient(t("csv.imported"));
      if (rows.truncated) notifyTransient(t("xl.trunc")
        .replace("{r}", XL_ROWS_CAP).replace("{c}", XL_COLS_CAP));
    } catch (e) {
      console.error("[SS] CSV import failed:", e);
      notifyTransient(t("xl.readerr"));
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ===== SECTION 3g: XLSX / ODS IMPORT + EXPORT (#9) ===== */
/* SheetJS vendored locally (vendor/xlsx.full.min.js) — never a
   CDN, same discipline as jspdf in cycle.js. Reads AND writes
   .xlsx, .ods (plus legacy .xls). Optional dependency: if the
   file is absent, import/export degrade to a toast — nothing
   else breaks. Lazy-loaded on first use only.               */

var XL_ROWS_CAP = MAX_ROWS, XL_COLS_CAP = MAX_COLS;   /* = normalizeState limits */
var xlLibLoading = false;

function loadXlsxLib(done) {
  if (window.XLSX && window.XLSX.utils) { done(); return; }
  if (xlLibLoading) return;
  xlLibLoading = true;
  var cands = ["../vendor/xlsx.full.min.js", "vendor/xlsx.full.min.js"];
  var i = 0;
  (function next() {
    if (i >= cands.length) {
      xlLibLoading = false;
      notifyTransient(t("xl.lib"));
      return;
    }
    var s = document.createElement("script");
    s.src = cands[i++] + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    s.onload = function () { xlLibLoading = false; done(); };
    s.onerror = function () { s.remove(); next(); };
    document.head.appendChild(s);
  })();
}

function xlPad(n) { return (n < 10 ? "0" : "") + n; }

function xlDateStr(d) {
  var s = d.getFullYear() + "-" + xlPad(d.getMonth() + 1) + "-" + xlPad(d.getDate());
  if (d.getHours() || d.getMinutes() || d.getSeconds())
    s += " " + xlPad(d.getHours()) + ":" + xlPad(d.getMinutes());
  return s;
}

function xlStamp() {
  var d = new Date();
  return d.getFullYear() + "-" + xlPad(d.getMonth() + 1) + "-" + xlPad(d.getDate());
}

/* Excel sheet-name rules: no []:*?/\ , max 31 chars */
function xlSafeName(nm) {
  var s = String(nm).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31).trim();
  return s || "Sheet";
}

/* worksheet cell -> our raw v string. Formulas ride through as
   "=..." (our engine evaluates the ones it knows; unknown ones
   show #NAME? but the text is preserved and round-trips).    */
function xlCellToRaw(cell) {
  if (cell.f) return "=" + String(cell.f);
  if (cell.t === "n") return isFinite(cell.v) ? String(cell.v) : "";
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "d") return xlDateStr(cell.v);
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

/* Excel's own cached result for a formula cell — kept as `cv`
   (additive field, rides whole-cell LWW, no DATA_VER bump).     */
function xlCacheRaw(cell) {
  if (cell.t === "n") return isFinite(cell.v) ? String(cell.v) : "";
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "d") return xlDateStr(cell.v);
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

/* IMPORT — every worksheet becomes a NEW orOS sheet (never
   overwrites existing data; same contract as csvImport).     */
function xlImport(file) {
  loadXlsxLib(function () {
    var reader = new FileReader();
    reader.onload = function () {
      var made = 0, truncated = false, lastId = null;
      try {
        /* Real .xlsx/.ods = ZIP (magic "PK") -> read as array.
           Plain CSV/text disguised as .xls -> sniff decode, then
           let SheetJS parse the STRING with correct encoding.  */
        var u8 = new Uint8Array(reader.result);
        var isZip = u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4B &&
                    (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07);
        var wb = isZip
          ? window.XLSX.read(reader.result, { type: "array", cellDates: true })
          : window.XLSX.read(sniffDecode(reader.result),
              { type: "string", cellDates: true });
        var X = window.XLSX.utils;
        var ts = now();
        for (var si = 0; si < wb.SheetNames.length; si++) {
          var ws = wb.Sheets[wb.SheetNames[si]];
          if (!ws || !ws["!ref"]) continue;
          var rng = X.decode_range(ws["!ref"]);
          var needRows = rng.e.r - rng.s.r + 1;
          var needCols = rng.e.c - rng.s.c + 1;
          if (needRows > XL_ROWS_CAP || needCols > XL_COLS_CAP) truncated = true;

          var sh = {
            id: uid(),
            name: xlSafeName(wb.SheetNames[si]),
            bi: undefined,
            rows: Math.min(Math.max(ROWS, needRows + 5), XL_ROWS_CAP),
            cols: Math.min(Math.max(COLS, needCols), XL_COLS_CAP),
            cw: {},
            pos: maxPos() + 1,
            mtime: ts
          };
          state.sheets.push(sh);
          lastId = sh.id;
          made++;

          for (var R = rng.s.r; R <= rng.e.r; R++) {
            if (R - rng.s.r >= XL_ROWS_CAP) break;
            for (var C = rng.s.c; C <= rng.e.c; C++) {
              if (C - rng.s.c >= XL_COLS_CAP) break;
              var cell = ws[X.encode_cell({ r: R, c: C })];
              if (!cell) continue;
              var v = xlCellToRaw(cell);
              if (v === "") continue;
              var rec = { v: v, mtime: ts };
              if (cell.f) {
                var cv = xlCacheRaw(cell);
                if (cv !== "") rec.cv = cv;
              }
              state.cells[cellKey(sh.id, R - rng.s.r, C - rng.s.c)] = rec;
            }
          }
        }
        if (!made) { notifyTransient(t("xl.readerr")); return; }
        markDirty();
        invalidateEval();
        switchTo(lastId);   /* rebuilds tabs + grid, focuses */
        notifyTransient(t("xl.imported").replace("{n}", made));
        if (truncated) notifyTransient(t("xl.trunc")
          .replace("{r}", XL_ROWS_CAP).replace("{c}", XL_COLS_CAP));
      } catch (e) {
        console.error("[SS] XLSX import failed:", e);
        notifyTransient(t("xl.readerr"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* EXPORT — ALL sheets -> one workbook. Raw v goes out as-is:
   strings starting "=" become formulas (aoa_to_sheet contract);
   numeric-looking strings become real numbers (no green Excel
   triangles), EXCEPT leading-zero values like phone numbers. */
function xlOutVal(v) {
  if (typeof v === "string" && v !== "" && v.charAt(0) !== "=" &&
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v.trim()) &&
      !/^-?0\d/.test(v.trim()) &&
      isFinite(parseFloat(v))) {
    return parseFloat(v);
  }
  return v;
}

function xlExport(bookType) {
  var sheets = state.sheets.slice().sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
  if (!sheets.length) { notifyTransient(t("csv.empty")); return; }

  /* any data at all, anywhere? (same emptiness rule as csvExport) */
  var any = false, k, q, pref;
  for (q = 0; q < sheets.length && !any; q++) {
    pref = sheets[q].id + "|";
    for (k in state.cells) { if (k.indexOf(pref) === 0) { any = true; break; } }
  }
  if (!any) { notifyTransient(t("csv.empty")); return; }

  loadXlsxLib(function () {
    try {
      var X = window.XLSX.utils;
      var wb = X.book_new();
      var used = {};
      sheets.forEach(function (sh) {
        var maxR = -1, maxC = -1, p, r, c;
        pref = sh.id + "|";
        for (k in state.cells) {
          if (k.indexOf(pref) !== 0) continue;
          p = k.split("|");
          r = parseInt(p[1], 10); c = parseInt(p[2], 10);
          if (r > maxR) maxR = r;
          if (c > maxC) maxC = c;
        }
        var aoa = [], row;
        for (r = 0; r <= maxR; r++) {
          row = [];
          for (c = 0; c <= maxC; c++) {
            var cel = state.cells[cellKey(sh.id, r, c)];
            row.push(cel ? xlOutVal(cel.v) : "");
          }
          aoa.push(row);
        }
        var ws = X.aoa_to_sheet(aoa);
        /* column widths ride along (px -> approx character width) */
        var colw = [];
        for (c = 0; c <= Math.max(maxC, 0); c++) {
          colw.push(sh.cw && sh.cw[c]
            ? { wch: Math.max(4, Math.round(sh.cw[c] / 8)) } : undefined);
        }
        try { ws["!cols"] = colw; } catch (e2) {}
        var nm = xlSafeName(displayName(sh));
        while (used[nm]) nm = nm.slice(0, 28) + "_" + (Object.keys(used).length + 1);
        used[nm] = true;
        X.book_append_sheet(wb, ws, nm);
      });

      var out = window.XLSX.write(wb, { bookType: bookType, type: "array" });
      var ext = (bookType === "ods") ? "ods" : "xlsx";
      var mime = (bookType === "ods")
        ? "application/vnd.oasis.opendocument.spreadsheet"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      var fname = "oros-spreadsheet-" + xlStamp() + "." + ext;
      var done = function () {
        notifyTransient(t("xl.exported")
          .replace("{f}", ext.toUpperCase()));
      };
      var blob = new Blob([out], { type: mime });
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        // ES5: dynamic key via bracket assignment (bookType-dependent).
        var accept = {};
        accept[mime] = ["." + ext];
        dlg.saveFile({
          blob: blob,
          filename: fname,
          mime: mime,
          types: [{ description: ext.toUpperCase(),
                    accept: accept }]
        }).then(function (r) { if (r && r.ok) done(); });
        return;                   // cancel (ok=false) = silent exit
      }
      // Standalone fallback — classic download (no shell present).
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 500);
      done();
    } catch (e) {
      console.error("[SS] XLSX export failed:", e);
    }
  });
}

/* ---- toolbar buttons (JS-injected — zero dependence on
   unseen spreadsheet.html markup) ---- */
var xlMenu = null;
function closeXlMenu() { if (xlMenu) { xlMenu.remove(); xlMenu = null; } }

function toggleXlExportMenu(btn) {
  if (xlMenu) { closeXlMenu(); return; }
  var m = document.createElement("div");
  m.style.cssText =
    "position:fixed;z-index:1100;background:var(--panel-bg,#22242a);" +
    "border:1px solid var(--border,#333);border-radius:8px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.35);padding:4px;" +
    "display:flex;flex-direction:column;gap:2px;min-width:175px;";
  [["xlsx", t("xl.xlsx")], ["ods", t("xl.ods")]].forEach(function (o) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = o[1];
    b.style.cssText =
      "text-align:left;padding:7px 12px;font:inherit;font-size:12.5px;" +
      "background:transparent;color:var(--text,#eee);border:none;" +
      "border-radius:6px;cursor:pointer;";
    b.addEventListener("mouseenter", function () {
      b.style.background = "var(--accent-soft,rgba(212,175,55,.15))";
    });
    b.addEventListener("mouseleave", function () {
      b.style.background = "transparent";
    });
    b.addEventListener("click", function () { closeXlMenu(); xlExport(o[0]); });
    m.appendChild(b);
  });
  var br = btn.getBoundingClientRect();
  document.body.appendChild(m);
  void m.offsetWidth;
  m.style.left = Math.max(4, Math.min(br.left, window.innerWidth - 195)) + "px";
  /* SS-9: the button sits in the footer — the menu opened below it,
     outside the window, and could not be reached. Open upwards when
     there is no room below. */
  var mh = m.offsetHeight;
  var top = br.bottom + 4;
  if (top + mh > window.innerHeight - 4) top = Math.max(4, br.top - mh - 4);
  m.style.top = top + "px";
  xlMenu = m;
}

function injectXlButtons() {
  var host = $("btn-csv-exp");
  if (!host || !host.parentElement) return;
  if ($("btn-xl-imp")) return;   /* idempotent */

  var imp = document.createElement("button");
  imp.type = "button";
  imp.id = "btn-xl-imp";
  imp.className = host.className;
  imp.title = t("xl.imp");
  imp.innerHTML = ICONS["csv-imp"] + "XLS";
  imp.addEventListener("click", function () {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile(".xlsx,.xls,.ods").then(function (f) {
        if (f) xlImport(f);       // cancel (null) = silent exit
      });
      return;
    }
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".xlsx,.xls,.ods";
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) xlImport(inp.files[0]);
    });
    inp.click();
  });

  var exp = document.createElement("button");
  exp.type = "button";
  exp.id = "btn-xl-exp";
  exp.className = host.className;
  exp.title = t("xl.exp");
  exp.innerHTML = ICONS["csv-exp"] + "XL";
  exp.addEventListener("click", function () { toggleXlExportMenu(exp); });

  host.parentElement.insertBefore(imp, host.nextSibling);
  host.parentElement.insertBefore(exp, imp.nextSibling);

  /* close the export menu on outside click (swatch pattern) */
  document.addEventListener("click", function (e) {
    if (!xlMenu) return;
    if (xlMenu.contains(e.target)) return;
    var be = $("btn-xl-exp");
    if (be && be.contains(e.target)) return;
    closeXlMenu();
  });
}

/* ===== SECTION 4: SYNC SLICE + PALETTE + NOTIFICATIONS ===== */

var syncApi = null;

var __ss = { _suppress: false,
  dirty: function () {
    if (this._suppress) return;
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
  } };

syncApi = __ss;

/* SS-1: the canonical copy, byte-equal to the stored one */
function sliceGet() {
  return canonSS(state);
}

/* Pull-fed (R6: no markDirty). SS-4: an open cell editor and a
   focused formula bar stay where they are (the old code cancelled
   the edit and dropped the phone keyboard on every pull); an
   editor the user has not typed in follows the new value. */
function sliceSet(data, info) {
  var cur = sliceGet();
  var merged = null;
  __ss._suppress = true;
  try { merged = mergeState(cur, data); } catch (e) { merged = null; }
  __ss._suppress = false;
  if (!merged) return;
  if (JSON.stringify(merged) === JSON.stringify(cur)) return;   /* echo */
  state = merged;

  var rebuild = false;
  var act = getSheetById(actSID);
  if (!act || (state.deleted[actSID] && act.mtime <= state.deleted[actSID])) {
    if (editing) cancelEdit();
    actSID = state.sheets[0] ? state.sheets[0].id : SID;
    collapseSel(0, 0);
    rebuild = true;
  } else if (layoutSig(act) !== BUILT) {
    rebuild = true;          /* rows, columns, widths or frozen panes changed */
  }
  if (rebuild && editing) cancelEdit();
  if (editing && editInput && editInput.value === editStartVal) {
    var ec = getCell(editingR, editingC);
    var nv = ec ? ec.v : "";
    if (nv !== editStartVal) { editInput.value = nv; editStartVal = nv; }
  }
  saveNow();
  undoStack.length = 0; /* sync reshape — device-local undo voids */
  redoStack.length = 0;
  invalidateEval();
  if (rebuild) buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
  updateToolbar();
}

function mergeFn(local, remote) {
  return mergeState(local, remote);
}

function registerSync() {
  var api = (window.parent && window.parent.orosSync) || window.orosSync;
  if (!api || typeof api.registerSlice !== "function") return;
  api.registerSlice("spreadsheet", sliceGet, sliceSet,
    STORAGE_KEY, mergeFn);
}

var PAL_VARS = ["--bg","--bg-desktop","--bar-bg","--text","--text-dim",
  "--accent","--accent-hover","--accent-soft","--panel-bg","--border",
  "--shadow","--danger","--ok","--warn","--font-stack","--mono"];

function inheritPalette() {
  var pd = null;
  try { pd = window.parent && window.parent.document; } catch (e) {}
  if (!pd || !pd.documentElement) return;
  var de = document.documentElement;
  var rs = de.style;
  try {
    de.setAttribute("data-theme", pd.documentElement.getAttribute("data-theme") || "");
    de.setAttribute("data-skin", pd.documentElement.getAttribute("data-skin") || "");
  } catch (e) {}
  for (var i = 0; i < PAL_VARS.length; i++) {
    var v = pd.documentElement.style.getPropertyValue(PAL_VARS[i]);
    if (v) rs.setProperty(PAL_VARS[i], v);
  }
}

function watchPalette() {
  var pd = null;
  try { pd = window.parent && window.parent.document; } catch (e) {}
  if (!pd || !pd.documentElement || typeof MutationObserver === "undefined")
    return;
  new MutationObserver(function () { inheritPalette(); })
    .observe(pd.documentElement, { attributes: true,
      attributeFilter: ["data-skin", "data-theme"] });
}

function notifyTransient(text) {
  var nm = null;
  try { nm = (window.parent && window.parent.orosNotifs) || window.orosNotifs; }
  catch (e) {}
  if (nm && typeof nm.transient === "function") {
    try { nm.transient({ ns: "spreadsheet", title: text }); return; }
    catch (e) {}
  }
  toast(text);
}

function toast(text) {
  var el = document.getElementById("ss-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ss-toast";
    el.className = "ss-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove("on"); }, 5000);
}

/* ===== SECTION 5: WIRING + BOOT ===== */

function applyI18n() {
  document.title = t("title") + " — orOS";
  var el = $("doc-title");
  if (el) el.textContent = t("title");
  document.documentElement.lang = LANG;
}

/* ---- inline SVG icons (Bible R9: HTML ships buttons EMPTY,
        JS injects SVGs — no external deps, no unicode glyphs) ---- */
var SVG_ATTRS = ' xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"' +
  ' width="15" height="15" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' +
  ' aria-hidden="true"';
function svg(inner, txt) {
  return "<svg" + SVG_ATTRS + (txt ? ' fill="currentColor" stroke="none"' : "") +
    ">" + inner + "</svg>";
}
var ICONS = {
  "tb-undo":  svg('<path d="M8 5 4 9l4 4"/><path d="M4 9h7a5 5 0 1 1 0 10H8"/>'),
  "tb-redo":  svg('<path d="M12 5l4 4-4 4"/><path d="M16 9H9a5 5 0 1 0 0 10h3"/>'),
  "tb-copy":  svg('<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/>'),
  "tb-cut":   svg('<circle cx="5.5" cy="5.5" r="2.2"/><circle cx="5.5" cy="14.5" r="2.2"/><path d="M7.4 7.2 17 16.5M7.4 12.8 17 3.5"/>'),
  "tb-paste": svg('<rect x="5" y="4" width="10" height="13" rx="1.5"/><path d="M8 2.5h4v3H8z"/>'),
  "tb-bold":  svg('<text x="10" y="15" text-anchor="middle" style="font:700 13px sans-serif">B</text>', true),
  "tb-ital":  svg('<text x="10" y="15" text-anchor="middle" style="font:italic 600 13px sans-serif">I</text>', true),
  "tb-und":   svg('<text x="10" y="14" text-anchor="middle" style="font:600 12px sans-serif">U</text><path d="M6 16h8" stroke="currentColor"/>', true),
  "tb-al-l":  svg('<path d="M3 6h14M3 10h9M3 14h12"/>'),
  "tb-al-c":  svg('<path d="M3 6h14M5.5 10h9M4.5 14h11"/>'),
  "tb-al-r":  svg('<path d="M3 6h14M8 10h9M5 14h12"/>'),
  "tb-col":   svg('<circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>'),
  "tb-clr":   svg('<path d="M4 14 12 6l4 4-6 6H6z"/><path d="M3 17h14"/>'),
  "csv-imp":  svg('<path d="M10 12V3"/><path d="M6.5 6.5 10 3l3.5 3.5"/><path d="M4 13v3.5h12V13"/>'),
  "csv-exp":  svg('<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 13v3.5h12V13"/>'),
  "tb-sort-a": svg('<path d="M6 3v13M3 13l3 3 3-3"/><text x="14.5" y="8.5" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">A</text><text x="14.5" y="17" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">Z</text>'),
  "tb-sort-z": svg('<path d="M6 3v13M3 13l3 3 3-3"/><text x="14.5" y="8.5" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">Z</text><text x="14.5" y="17" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">A</text>'),
  "tb-filter": svg('<path d="M3.5 5h13l-5 6v4.5l-3 1.5v-6z"/>'),
  "tb-more":   svg('<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 8h14M8 8v9"/>'),
  "st-flt-x":  svg('<path d="M5 5l10 10M15 5 5 15"/>')
};
var IC_X   = svg('<path d="M5 5l10 10M15 5 5 15"/>');
var IC_FILTER = svg('<path d="M3.5 5h13l-5 6v4.5l-3 1.5v-6z"/>');
var IC_ADD = svg('<path d="M10 4v12M4 10h12"/>');

/* SS-8: the toolbar titles in index.html are English only */
var TITLE_KEYS = {
  "tb-undo": "tb.undo", "tb-redo": "tb.redo", "tb-copy": "tb.copy",
  "tb-cut": "tb.cut", "tb-paste": "tb.paste", "tb-bold": "tb.bold",
  "tb-ital": "tb.ital", "tb-und": "tb.und", "tb-al-l": "tb.al.l",
  "tb-al-c": "tb.al.c", "tb-al-r": "tb.al.r", "tb-nf": "tb.nf",
  "tb-col": "tb.col", "tb-clr": "tb.clr",
  "tb-sort-a": "tb.sortA", "tb-sort-z": "tb.sortZ", "tb-filter": "tb.filter",
  "tb-more": "tb.more", "fx-mark": "fx.list", "st-flt-x": "flt.clear",
  "btn-csv-imp": "csv.imp", "btn-csv-exp": "csv.exp"
};

function injectIcons() {
  var k;
  for (k in TITLE_KEYS) {
    var te = $(k);
    if (te) { te.setAttribute("title", t(TITLE_KEYS[k])); te.setAttribute("aria-label", t(TITLE_KEYS[k])); }
  }
  var bar = $("sbar"); if (bar) bar.setAttribute("aria-label", t("tb.bar"));
  var tabsNav = $("stabs"); if (tabsNav) tabsNav.setAttribute("aria-label", t("sheets"));
  var nfSel = $("tb-nf");
  if (nfSel && nfSel.options[0]) nfSel.options[0].textContent = t("tb.nf.gen");
  if (nfSel) for (var oi = 0; oi < nfSel.options.length; oi++)
    if (nfSel.options[oi].value === "d") nfSel.options[oi].textContent = t("tb.nf.date");
  for (k in ICONS) {
    var el = $(k);
    if (el) {
      el.innerHTML = ICONS[k];
      if (!el.getAttribute("aria-label")) {
        var ttl = el.getAttribute("title");
        if (ttl) el.setAttribute("aria-label", ttl);
      }
    }
  }
  var imp = $("btn-csv-imp"), exp = $("btn-csv-exp");
  if (imp) imp.innerHTML = ICONS["csv-imp"] + "CSV";
  if (exp) exp.innerHTML = ICONS["csv-exp"] + "CSV";
}


/* format CSS injection (kept in JS — single-file discipline) */
(function injectFmtCss() {
  var st = document.createElement("style");
  st.textContent =
    "#grid td.fb{font-weight:700;}" +
    "#grid td.fi{font-style:italic;}" +
    "#grid td.fu{text-decoration:underline;}" +
    "#grid td.fa-l{text-align:left;}" +
    "#grid td.fa-c{text-align:center;}" +
    "#grid td.fa-r{text-align:right;}";
  document.head.appendChild(st);
})();

function wire() {
  var wrap = $("grid-wrap");
  var dragSelecting = false;
  var mdSelected = false;     /* mouse mousedown owns the next click */
  var tapWasSelected = false; /* tap target already selected pre-mousedown */
  var ptrType = "mouse";      /* last pointerdown type (mouse|touch|pen) */
  initResizeDocHandlers();   /* document-level: attach EXACTLY once */

  wrap.addEventListener("scroll", onGridScroll, { passive: true });
  var rsT = null;
  window.addEventListener("resize", function () {
    clearTimeout(rsT);
    rsT = setTimeout(function () {
      if (editing) return;
      buildGrid(); renderGrid(); renderSelection();
    }, 200);
  });

  $("grid").addEventListener("pointerdown", function (e) {
    ptrType = e.pointerType || "mouse";
  }, true);

  /* a header click selects the whole column / row (corner = all) */
  function headerSelect(pos, extend) {
    var sh = getActiveSheet();
    if (pos.all) { selR = 0; selC = 0; selAR = sh.rows - 1; selAC = sh.cols - 1; }
    else if (pos.col !== undefined) {
      if (extend) { selC = pos.col; selR = sh.rows - 1; selAR = 0; }
      else { selR = 0; selC = pos.col; selAR = sh.rows - 1; selAC = pos.col; }
    } else if (pos.row !== undefined) {
      if (extend) { selR = pos.row; selC = sh.cols - 1; selAC = 0; }
      else { selR = pos.row; selC = 0; selAR = pos.row; selAC = sh.cols - 1; }
    }
    renderSelection();
  }

  $("grid").addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(".fbtn")) return;   /* filter button: click opens */
    var pos = gridPos(e.target);
    if (!pos) return;
    if (pos.td === undefined) {
      if (rsDrag) return;                         /* column resize grabbed the edge */
      if (editing) commitEdit(0, 0);
      mdSelected = (ptrType === "mouse");
      headerSelect(pos, e.shiftKey);
      return;
    }
    var r = pos.r, c = pos.c;
    tapWasSelected = (r === selR && c === selC && !editing);
    mdSelected = (ptrType === "mouse");
    if (editing) commitEdit(0, 0); /* then KEEP selecting the clicked cell */
    if (e.shiftKey) {
      /* Shift+click: extend selection from anchor */
      selR = r; selC = c;
      renderSelection();
    } else {
      collapseSel(r, c);
      dragSelecting = true;
      renderSelection();
    }
  });

  $("grid").addEventListener("mousemove", function (e) {
    if (!dragSelecting) return;
    var pos = gridPos(e.target);
    if (!pos || pos.td === undefined) return;
    if (pos.r !== selR || pos.c !== selC) {
      selR = pos.r; selC = pos.c;
      renderSelection();
    }
  });

  document.addEventListener("mouseup", function () {
    dragSelecting = false;
  });

  /* dblclick on cell = edit (desktop fast path) */
  $("grid").addEventListener("dblclick", function (e) {
    var pos = gridPos(e.target);
    if (!pos || pos.td === undefined) return;
    if (e.target.closest && e.target.closest(".fbtn")) return;
    if (!editing) beginEdit();
  });

  /* right click: the sheet menu (rows, columns, freeze) */
  $("grid").addEventListener("contextmenu", function (e) {
    var pos = gridPos(e.target);
    if (!pos || editing) return;
    e.preventDefault();
    if (pos.td !== undefined && !(pos.r >= selTop() && pos.r <= selBottom() && pos.c >= selLeft() && pos.c <= selRight())) {
      collapseSel(pos.r, pos.c); renderSelection();
    }
    openSheetMenu({ x: e.clientX, y: e.clientY });
  });

  /* mobile: tap selects, tap on SELECTED cell edits.
     ptrType comes from pointerdown (works in every browser —
     click/mousedown never expose pointerType in Firefox/Safari). */
  $("grid").addEventListener("click", function (e) {
    var fb = e.target.closest && e.target.closest(".fbtn");
    if (fb) {
      e.stopPropagation();          /* the document click would close it again */
      var fp = gridPos(fb);
      mdSelected = false;
      if (fp && fp.td !== undefined) openFilterPop(fp.c, fb);
      return;
    }
    if (mdSelected) { mdSelected = false; return; } /* mouse: mousedown owned it */
    var pos = gridPos(e.target);
    if (!pos) return;
    if (pos.td === undefined) { if (editing) commitEdit(0, 0); headerSelect(pos, false); return; }
    var r = pos.r, c = pos.c;
    if (editing) commitEdit(0, 0);
    if (tapWasSelected && r === selR && c === selC) beginEdit();
    else { collapseSel(r, c); renderSelection(); }
  });

  wrap.addEventListener("keydown", function (e) {
    if (editing) return;
    var k = e.key;
    if (k === "ArrowUp") { e.preventDefault(); navigate(-1, 0, e.shiftKey); }
    else if (k === "ArrowDown") { e.preventDefault(); navigate(1, 0, e.shiftKey); }
    else if (k === "ArrowLeft") { e.preventDefault(); navigate(0, -1, e.shiftKey); }
    else if (k === "ArrowRight") { e.preventDefault(); navigate(0, 1, e.shiftKey); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit(); }
    else if (k === "Tab") { e.preventDefault(); navigate(0, 1); }
    else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      var page = Math.max(1, Math.floor((wrap.clientHeight - HEADH) / ROWH) - 1);
      navigate(k === "PageDown" ? page : -page, 0, e.shiftKey);
    }
    else if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); clearSelected();
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z") && !e.shiftKey) {
      e.preventDefault(); doUndo();
    }
    else if ((e.ctrlKey || e.metaKey) &&
             ((k === "y" || k === "Y") || (e.shiftKey && (k === "z" || k === "Z")))) {
      e.preventDefault(); doRedo();
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "C")) {
      e.preventDefault(); copySelection(false);
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "x" || k === "X")) {
      e.preventDefault(); copySelection(true);
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "v" || k === "V")) {
      e.preventDefault(); pasteClipboard();
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "b" || k === "B")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("b"));
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "i" || k === "I")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("i"));
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "u" || k === "U")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("u"));
    }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); beginEdit(k);
    }
  });

  var fx = $("fx-input");
  fx.addEventListener("focus", function () { fxFocused = true; fxStartVal = fx.value; });
  fx.addEventListener("blur", function () {
    fxFocused = false;
    renderSelection();
  });
  fx.addEventListener("input", function () { fxHelpUpdate(fx); });
  fx.addEventListener("blur", function () { setTimeout(fxHelpHideSoon, 150); });
  fx.addEventListener("keydown", function (e) {
    if (fxHelpKey(e, fx)) { e.stopPropagation(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      var val = fx.value.replace(/^\s+|\s+$/g, "");
      if (fx.value === fxStartVal) { /* SS-4: untouched: write nothing */ }
      else if (val === "") { if (getCell(selR, selC)) deleteCell(selR, selC); }
      else setCell(selR, selC, val);
      queueSave(); invalidateEval(); renderGrid();
      navigate(1, 0);
      fx.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      var cel = getCell(selR, selC);
      fx.value = cel ? cel.v : "";
      fx.blur();
    }
    e.stopPropagation();
  });

  /* ---- toolbar buttons ---- */
  var btn = function (id, fn) {
    var el = $(id);
    if (el) el.addEventListener("click", fn);
  };
  btn("tb-undo", doUndo);
  btn("tb-redo", doRedo);
  btn("tb-copy", function () { copySelection(false); });
  btn("tb-cut", function () { copySelection(true); });
  btn("tb-paste", pasteClipboard);
  btn("tb-bold", function () { applyFormatToSelection(fmtToggle("b")); });
  btn("tb-ital", function () { applyFormatToSelection(fmtToggle("i")); });
  btn("tb-und", function () { applyFormatToSelection(fmtToggle("u")); });
  btn("tb-al-l", function () { applyFormatToSelection(fmtAlign("l")); });
  btn("tb-al-c", function () { applyFormatToSelection(fmtAlign("c")); });
  btn("tb-al-r", function () { applyFormatToSelection(fmtAlign("r")); });
  btn("tb-col", toggleSwatchPopover);
  btn("tb-clr", function () {
    applyFormatToSelection(clearFormat());
    notifyTransient(t("fmt.cleared"));
  });
  var nf = $("tb-nf");
  if (nf) nf.addEventListener("change", function () {
    applyFormatToSelection(fmtNumFormat(nf.value));
  });
  btn("tb-sort-a", function () { sortSelection(false); });
  btn("tb-sort-z", function () { sortSelection(true); });
  btn("tb-filter", toggleFilter);
  btn("tb-more", function (e) { e.stopPropagation(); openSheetMenu({ el: $("tb-more") }); });
  btn("fx-mark", function (e) { e.stopPropagation(); openFxList(); });
  btn("st-flt-x", clearFilter);

  /* sheet menu / filter / function list close on an outside click */
  document.addEventListener("click", function () { closePops(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && popEl) { closePops(); }
  });

  /* swatch popover closes on outside click */
  document.addEventListener("click", function (e) {
    var pop = $("swatches");
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target === $("tb-col") || $("tb-col").contains(e.target)) return;
    pop.hidden = true;
  });

  /* CSV buttons */
  var bi = $("btn-csv-imp"), be = $("btn-csv-exp");
  if (be) be.addEventListener("click", csvExport);
  if (bi) bi.addEventListener("click", function () {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile(".csv,text/csv").then(function (f) {
        if (f) csvImport(f);      // cancel (null) = silent exit
      });
      return;
    }
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".csv,text/csv";
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) csvImport(inp.files[0]);
    });
    inp.click();
  });

  injectXlButtons();   /* #9: XLSX/ODS import + export buttons */
  injectNotionButton();   /* wave 6E: Import from Notion */

  window.addEventListener("beforeunload", function () {
    if (editing) commitEdit(0, 0);
    saveNow();
  });
}

/* SHELL SHORTCUT FORWARDING (Contract Β — capture phase) */
document.addEventListener("keydown", function (e) {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
  var p = window.parent;
  if (!(p && p.orosShortcuts &&
      typeof p.orosShortcuts.handle === "function")) return;
  if (p.orosShortcuts.handle(e)) e.stopPropagation();
}, true);

/* ===== Import from Notion (integrations wave 6E, platforms.js) =====
   The plan comes from links/sheets.js; this is its one write: a new
   sheet per database (row 1 in bold) and, when asked, the values of a
   sheet imported before (its formats stay). Undo deletes the new
   sheets (tombstoned, like any deletion here) and puts back the old
   values. Only inside the orOS shell.                              */
var PLAT = window.OrosSheetPlatforms || null;
function platformData() {
  var sheets = {}, k;
  state.sheets.forEach(function (sh) { sheets[sh.id] = []; });
  for (k in state.cells) {
    var pk = k.split("|"), g = sheets[pk[0]];
    if (!g) continue;
    var r = +pk[1], c = +pk[2];
    while (g.length <= r) g.push([]);
    while (g[r].length <= c) g[r].push("");
    g[r][c] = state.cells[k].v;
  }
  return { sheets: sheets, deleted: state.deleted };
}
function platformApply(pl, doneText) {
  var ts = now(), back = { sheets: [], cells: [] }, first = null;
  pl.add.forEach(function (a) {
    if (getSheetById(a.id)) return;
    var rows = a.rows.slice(0, XL_ROWS_CAP), maxCols = 0, r, c;
    for (r = 0; r < rows.length; r++) if (rows[r].length > maxCols) maxCols = rows[r].length;
    state.sheets.push({
      id: a.id, name: a.name, bi: undefined,
      rows: Math.min(Math.max(ROWS, rows.length + 5), XL_ROWS_CAP),
      cols: Math.min(Math.max(COLS, maxCols), XL_COLS_CAP),
      cw: {}, pos: maxPos() + 1, mtime: ts
    });
    delete state.deleted[a.id];
    for (r = 0; r < rows.length; r++)
      for (c = 0; c < rows[r].length && c < XL_COLS_CAP; c++) {
        if (rows[r][c] === "") continue;
        var rec = { v: rows[r][c], mtime: ts };
        if (r === 0) rec.f = { b: 1 };
        state.cells[cellKey(a.id, r, c)] = rec;
      }
    back.sheets.push(a.id);
    if (!first) first = a.id;
  });
  pl.upd.forEach(function (u) {
    var sh = getSheetById(u.id);
    if (!sh) return;
    var rows = u.rows.slice(0, XL_ROWS_CAP), want = {}, r, c, k, maxCols = 0;
    for (r = 0; r < rows.length; r++)
      for (c = 0; c < rows[r].length && c < XL_COLS_CAP; c++) {
        if (rows[r][c] !== "") want[cellKey(u.id, r, c)] = rows[r][c];
        if (c + 1 > maxCols) maxCols = c + 1;
      }
    var keys = {};
    for (k in state.cells) if (k.indexOf(u.id + "|") === 0) keys[k] = 1;
    for (k in want) keys[k] = 1;
    for (k in keys) {
      var cur = state.cells[k], pk = k.split("|");
      if (Object.prototype.hasOwnProperty.call(want, k)) {
        if (cur && cur.v === want[k]) continue;
        back.cells.push({ key: k, before: snapCell(u.id, +pk[1], +pk[2]) });
        rawSet(u.id, +pk[1], +pk[2], want[k], cur && cur.f);
      } else if (cur && cur.v !== "") {
        back.cells.push({ key: k, before: snapCell(u.id, +pk[1], +pk[2]) });
        if (cur.f) rawSet(u.id, +pk[1], +pk[2], "", cur.f);
        else rawDel(u.id, +pk[1], +pk[2]);
      }
    }
    var nr = Math.min(Math.max(sh.rows, rows.length + 5), XL_ROWS_CAP), nc = Math.min(Math.max(sh.cols, maxCols), XL_COLS_CAP);
    if (nr !== sh.rows || nc !== sh.cols) { sh.rows = nr; sh.cols = nc; sh.mtime = ts; }
    if (!first) first = u.id;
  });
  if (!back.sheets.length && !back.cells.length) return true;
  platformDone(first);
  notifyUndo(doneText, function () { platformUndo(back); });
  return true;
}
function platformUndo(back) {
  back.cells.slice().reverse().forEach(function (e) {
    var pk = e.key.split("|");
    if (!getSheetById(pk[0])) return;
    if (e.before === null) rawDel(pk[0], +pk[1], +pk[2]);
    else rawSet(pk[0], +pk[1], +pk[2], e.before.v, e.before.f);
  });
  var ts = now();
  back.sheets.forEach(function (id) {
    if (!getSheetById(id) || state.sheets.length <= 1) return;
    state.sheets = state.sheets.filter(function (sh) { return sh.id !== id; });
    state.deleted[id] = ts;
    for (var k in state.cells) if (k.indexOf(id + "|") === 0) delete state.cells[k];
  });
  if (!getSheetById(actSID)) { actSID = state.sheets[0].id; saveActive(); }
  platformDone(null);
  notifyTransient(PLAT ? PLAT.undone() : "");
}
function platformDone(id) {
  invalidateEval();
  markDirty();
  saveNow();
  if (id && id !== actSID) { switchTo(id); return; }
  DISP = {};
  collapseSel(0, 0);
  buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
}
/* a notice with an Undo button (the shell's notifications) */
function notifyUndo(text, fn) {
  try {
    var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
    if (N && typeof N.transient === "function") {
      N.transient({ ns: "spreadsheet", title: text, body: "", action: { label: PLAT ? PLAT.undoLabel() : "Undo", fn: fn } });
      return;
    }
  } catch (e) { /* cross-origin guard */ }
  toast(text);
}
/* the cloud button next to CSV / XL (only when the shell can call Notion) */
function injectNotionButton() {
  var host = $("btn-xl-exp") || $("btn-csv-exp");
  if (!PLAT || !PLAT.has() || !host || $("btn-notion")) return;
  PLAT.init({ lang: LANG, data: platformData, apply: platformApply });
  var b = document.createElement("button");
  b.type = "button";
  b.id = "btn-notion";
  b.className = host.className;
  b.title = PLAT.label();
  b.setAttribute("aria-label", PLAT.label());
  b.innerHTML = svg('<path d="M14.5 15.5H7a5 5 0 1 1 4.6-7h1.4a3.5 3.5 0 1 1 0 7z"/><path d="M10 9.5v4"/><path d="m8.3 11.8 1.7 1.7 1.7-1.7"/>') + "Notion";
  b.addEventListener("click", function () { if (editing) commitEdit(0, 0); PLAT.open(); });
  host.parentElement.insertBefore(b, host.nextSibling);
}

/* ===== "Open in Spreadsheet" from another app (Bible BR-S1) =====
   target = { newSheet: { name, rows: [[cell, …], …], sum: [col, …] } }
   Always a NEW sheet (never overwrites). Row 1 is the heading. A cell
   is a finite number, a string (plain text: one starting with = + - @
   gets an apostrophe, so it never runs as a formula) or null/"".
   `sum`: 0-based columns that get =SUM(…) under the last row, the
   only formulas made here. Capped at XL_ROWS_CAP × XL_COLS_CAP.   */
function tableCell(v) {
  if (typeof v === "number") return isFinite(v) ? String(v) : "";
  if (typeof v !== "string") return "";
  v = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 500);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function sheetFromTable(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.rows) || !p.rows.length) return false;
  var sums = Array.isArray(p.sum) ? p.sum.filter(function (c) {
    return c === Math.floor(c) && c >= 0 && c < XL_COLS_CAP;
  }) : [];
  var rows = p.rows.slice(0, XL_ROWS_CAP - (sums.length ? 1 : 0)).map(function (r) {
    return Array.isArray(r) ? r.slice(0, XL_COLS_CAP).map(tableCell) : [];
  });
  var maxCols = 0, r, c;
  for (r = 0; r < rows.length; r++) if (rows[r].length > maxCols) maxCols = rows[r].length;
  var name = typeof p.name === "string" && p.name.trim() ? xlSafeName(p.name) : null;
  var ts = now(), num = nextSheetNumber();
  var sh = {
    id: uid(),
    name: name,
    bi: name ? undefined : { en: "Sheet" + num, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + num },
    rows: Math.min(Math.max(ROWS, rows.length + 5), XL_ROWS_CAP),
    cols: Math.min(Math.max(COLS, maxCols), XL_COLS_CAP),
    cw: {},
    pos: maxPos() + 1,
    mtime: ts
  };
  state.sheets.push(sh);
  for (r = 0; r < rows.length; r++)
    for (c = 0; c < rows[r].length; c++)
      if (rows[r][c] !== "") state.cells[cellKey(sh.id, r, c)] = { v: rows[r][c], mtime: ts };
  if (rows.length > 1) sums.forEach(function (col) {
    var L = colName(col);
    state.cells[cellKey(sh.id, rows.length, col)] = { v: "=SUM(" + L + "2:" + L + rows.length + ")", mtime: ts };
  });
  markDirty();
  invalidateEval();
  switchTo(sh.id);
  notifyTransient(t("tbl.made").replace("{n}", name || sh.bi[LANG] || sh.bi.en));
  return true;
}
/* One receiver for every deep link: live push from the shell
   (window.__orosOpenAt) and the staged target at boot
   (window.parent.__orosTakeTarget). { newSheet } = BR-S1,
   { sheet, r?, c? } = universal search.                            */
function openTarget(tg) {
  if (!tg || typeof tg !== "object") return;
  if (tg.openFile) openSharedFile(tg.openFile);
  else if (tg.newSheet) sheetFromTable(tg.newSheet);
  else openSearchTarget(tg);
}
/* { openFile: { token } }: a file from the system's "Open with"
   (shell fileopen.js), taken once from the shell, then the same
   import as the XL / CSV buttons.                                  */
function openSharedFile(o) {
  var f = null;
  try {
    var p = window.parent;
    if (o && typeof o.token === "string" && p && p !== window && typeof p.__orosTakeFile === "function")
      f = p.__orosTakeFile(o.token);
  } catch (e) { f = null; }
  if (!f) return;
  var nm = String(f.name || "").toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(nm)) xlImport(f);
  else if (/\.csv$/.test(nm)) csvImport(f);
}
window.__orosOpenAt = openTarget;
function takeTarget() {
  var tg = null;
  try {
    if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function")
      tg = window.parent.__orosTakeTarget("spreadsheet");
  } catch (e) { tg = null; }
  openTarget(tg);
}

function boot() {
  console.log("[SS] boot start, LANG =", LANG);
  loadState();
  console.log("[SS] loadState ok, sheets:",
    state.sheets.length, "| cells:", Object.keys(state.cells).length);
  applyI18n();
  injectIcons();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  buildGrid();
  renderTabs();
  collapseSel(0, 0);
  renderGrid();
  renderSelection();
  console.log("[SS] boot COMPLETE [Wave 3]");
  $("grid-wrap").focus();
  takeTarget();
}

boot();

/* Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
   target { sheet, r?, c? }. Shows the sheet and selects the cell.
   Unknown sheet, a cell edit in progress or an open dialog -> no-op. */
function openSearchTarget(tg) {
  if (!tg || typeof tg.sheet !== "string" || editing) return;
  if (document.querySelector("dialog[open]")) return;
  var sh = getSheetById(tg.sheet);
  if (!sh) return;
  switchTo(sh.id);
  var r = tg.r, c = tg.c;
  if (typeof r !== "number" || typeof c !== "number" ||
      r < 0 || c < 0 || r >= sh.rows || c >= sh.cols) return;
  collapseSel(Math.floor(r), Math.floor(c));
  ensureVisible(selR, selC);
  renderSelection();
}

})();
