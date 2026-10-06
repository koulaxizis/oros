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
var ROWS = 100, COLS = 26;
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
    "xl.trunc":    "Import capped at {r} rows × {c} columns"
  },
  el: {
    "title": "Λογιστικά φύλλα",
    "sheet.default": "Φύλλο1",
    "sheet.last": "Δεν μπορεί να διαγραφεί το τελευταίο φύλλο",
    "tab.confirm": "Πάτησε ξανά ✕ για διαγραφή του φύλλου",
    "csv.imported": "Το CSV εισήχθη ως νέο φύλλο",
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
    "xl.trunc":    "Η εισαγωγή περικόπηκε σε {r} γραμμές × {c} στήλες"
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
                cw: { "<colIdx>": pxWidth } }],
     cells:  { "<sheetId>|<r>|<c>":
               { v: "<raw input>", mtime, f?: { b?, i?, u?,
                 al?: "l|c|r", co?: "#hex", nf?: "gen|0|2|%|€" } } },
     deleted:{ "<sheetId>": ts, "<sheetId>|<r>|<c>": ts } }
   · f-only cells allowed: v === "" && f present (format on empty cell).
   · cw rides the sheet entity → synced via sheet LWW.
   · actSID, CLIP, undoStack are DEVICE-LOCAL, never synced. */

var state = null;
var actSID = "s-main";
var SID = "s-main";

function blankState() {
  return {
    ver: DATA_VER,
    sheets: [{
      id: SID, name: null,
      bi: { en: t("sheet.default"), el: "Φύλλο1" },
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
      f.nf === "%" || f.nf === "\u20AC") out.nf = f.nf;
  var has = false;
  for (var kk in out) { has = true; break; }
  return has ? out : undefined;
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
    sh.rows = Math.min(Math.max(parseInt(sh.rows, 10) || ROWS, 1), 500);
    sh.cols = Math.min(Math.max(parseInt(sh.cols, 10) || COLS, 1), 64);
    if (typeof sh.mtime !== "number" || !isFinite(sh.mtime)) sh.mtime = 0;
    if (sh.pos === undefined || typeof sh.pos !== "number") sh.pos = 0;
    if (sh.cw === undefined || typeof sh.cw !== "object" || !sh.cw) sh.cw = {};
    if (sh.name !== null && sh.name !== undefined &&
        typeof sh.name !== "string") sh.name = String(sh.name);
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

function cellKey(sid, r, c) { return sid + "|" + r + "|" + c; }

/* ===== SECTION 2b: MERGE ENGINE (unchanged semantics — f rides
   whole-cell LWW, cw rides whole-sheet LWW) ===== */

function newerObj(a, b) {
  if (!a) return b;
  if (!b) return a;
  var am = a.mtime || 0, bm = b.mtime || 0;
  if (am > bm) return a;
  if (bm > am) return b;
  var aj = JSON.stringify(a), bj = JSON.stringify(b);
  return (aj < bj) ? a : b;
}

function mergeState(local, remote) {
  if (!local || typeof local !== "object") local = blankState();
  if (!remote || typeof remote !== "object") return local;

  var localVer = local.ver || DATA_VER;
  var remoteVer = remote.ver || DATA_VER;
  if (remoteVer > localVer) localVer = remoteVer;

  /* 1. DELETED UNION (first — sheet-tombstones computed early) */
  var mergedDel = {};
  for (var k in local.deleted)
    mergedDel[k] = Math.max(local.deleted[k] || 0, mergedDel[k] || 0);
  for (k in remote.deleted)
    mergedDel[k] = Math.max(remote.deleted[k] || 0, mergedDel[k] || 0);
  /* deterministic cutoff: dataset max tombstone ts — NEVER wall clock.
     Merge must be pure: two devices must reach identical results at
     any moment (Bible Lesson 3 / HB-3 / NT-2 / MD-4). */
  var maxTs = 0;
  for (k in mergedDel) if (mergedDel[k] > maxTs) maxTs = mergedDel[k];
  var pruneCutoff = maxTs - (30 * 24 * 60 * 60 * 1000);
  for (k in mergedDel) {
    if (mergedDel[k] < pruneCutoff) delete mergedDel[k];
  }

  /* 2. Sheets merge — union, LWW by mtime, tombstone-filtered */
  var sheetsMap = {}, i, sh;
  for (i = 0; i < local.sheets.length; i++) {
    sh = local.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") continue;
    if (tombFor(mergedDel, sh.id) && (sh.mtime || 0) <= tombFor(mergedDel, sh.id))
      continue;
    sheetsMap[sh.id] = sh;
  }
  for (i = 0; i < remote.sheets.length; i++) {
    sh = remote.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") continue;
    if (tombFor(mergedDel, sh.id) && (sh.mtime || 0) <= tombFor(mergedDel, sh.id))
      continue;
    var existing = sheetsMap[sh.id];
    if (!existing) { sheetsMap[sh.id] = sh; continue; }
    if (existing.mtime === 0 && sh.mtime === 0) {
      sheetsMap[sh.id] = (existing.id <= sh.id) ? existing : sh;
    } else {
      sheetsMap[sh.id] = newerObj(existing, sh);
    }
  }

  var mergedSheets = [], ks = Object.keys(sheetsMap).sort(function(a,b){
    var sa = sheetsMap[a], sb = sheetsMap[b];
    var d = (sa.pos || 0) - (sb.pos || 0);
    /* id tie-break: same pos must order identically on every device */
    return d !== 0 ? d : (a < b ? -1 : (a > b ? 1 : 0));
  });
  for (i = 0; i < ks.length; i++) mergedSheets.push(sheetsMap[ks[i]]);

  /* 3. Cells merge — sparse union, tombstone-filtered */
  var mergedCells = {};
  var candidates = {};
  for (k in local.cells) {
    if (!local.cells[k] || typeof local.cells[k] !== "object") continue;
    candidates[k] = local.cells[k];
  }
  for (k in remote.cells) {
    if (!remote.cells[k] || typeof remote.cells[k] !== "object") continue;
    if (!candidates[k]) candidates[k] = remote.cells[k];
    else candidates[k] = newerObj(remote.cells[k], local.cells[k]);
  }

  for (k in candidates) {
    var cel = candidates[k];
    var pk = (function(key){ var p = key.split("|"); if (p.length !== 3) return null;
      return { sid: p[0], r: parseInt(p[1], 10), c: parseInt(p[2], 10) }; })(k);
    if (!pk) continue;
    var cellTomb = tombFor(mergedDel, k);
    var sheetTomb = tombFor(mergedDel, pk.sid);
    var maxTomb = Math.max(cellTomb || 0, sheetTomb || 0);
    if ((cel.mtime || 0) > maxTomb) {
      mergedCells[k] = cel;
    }
  }

  return { ver: localVer, sheets: mergedSheets, cells: mergedCells, deleted: mergedDel };
}

/* ===== SECTION 2c: STORAGE FUNNEL ===== */

var saveTimer = null;

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  dirtyFlag = false;       /* saved state */
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
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
    if (raw) setTimeout(function(){ toast(t("err.corrupt")); }, 400);
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
var fxFocused = false;
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
function rawSet(sid, r, c, v, f) {
  var key = cellKey(sid, r, c);
  delete state.deleted[key];
  var o = { v: String(v), mtime: now() };
  var sf = sanitizeF(f);
  if (sf) o.f = sf;
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
  var e, i;
  for (i = 0; i < entries.length; i++) {
    e = entries[i];
    var target = useAfter ? e.after : e.before;
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

/* ===== SECTION 3b: FORMULA ENGINE (Wave 3 — cache invalidation aware) ===== */

var TT_NUM = 1, TT_STR = 2, TT_OP = 3, TT_REF = 4, TT_FUNC = 5,
    TT_SEP = 6, TT_LPAREN = 7, TT_RPAREN = 8, TT_ERROR = 9;

var OPERATORS = {
  "+": { prec: 2, assoc: "L" },
  "-": { prec: 2, assoc: "L" },
  "*": { prec: 3, assoc: "L" },
  "/": { prec: 3, assoc: "L" },
  "^": { prec: 4, assoc: "R" },
  "&": { prec: 1, assoc: "L" },
  "=":  { prec: 0, assoc: "L", cmp: true },
  "<>": { prec: 0, assoc: "L", cmp: true },
  "<":  { prec: 0, assoc: "L", cmp: true },
  ">":  { prec: 0, assoc: "L", cmp: true },
  "<=": { prec: 0, assoc: "L", cmp: true },
  ">=": { prec: 0, assoc: "L", cmp: true }
};

var BOOL_LITERALS = { "TRUE": 1, "FALSE": 0 };

function tokenize(formula) {
  var tokens = [];
  var i = 0, s = String(formula).trim();

  if (!s || s.charAt(0) !== "=") {
    if (s) tokens.push({ type: TT_STR, value: s });
    return tokens;
  }

  i++;
  while (i < s.length) {
    var ch = s.charAt(i);

    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      var str = "", j = i + 1;
      while (j < s.length && s.charAt(j) !== '"') {
        if (s.charAt(j) === "\\" && j + 1 < s.length) j++;
        str += s.charAt(j++);
      }
      tokens.push({ type: TT_STR, value: str });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s.charAt(i+1)))) {
      var num = "", hasDot = false;
      while (i < s.length && /[0-9.]/.test(s.charAt(i))) {
        var digit = s.charAt(i);
        if (digit === ".") { if (hasDot) break; hasDot = true; }
        num += digit; i++;
      }
      tokens.push({ type: TT_NUM, value: parseFloat(num) });
      continue;
    }

    var op = "";
    if (i + 1 < s.length) {
      var twoChar = s.substr(i, 2);
      if (OPERATORS[twoChar]) { op = twoChar; i += 2; }
    }
    if (!op && OPERATORS[ch]) { op = ch; i++; }
    if (op) { tokens.push({ type: TT_OP, value: op }); continue; }

    if (ch === "(") { tokens.push({ type: TT_LPAREN, value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: TT_RPAREN, value: ch }); i++; continue; }
    if (ch === ",") { tokens.push({ type: TT_SEP, value: "," }); i++; continue; }
    if (ch === ";") { tokens.push({ type: TT_SEP, value: ";" }); i++; continue; }
    if (ch === ":") { tokens.push({ type: TT_SEP, value: ":" }); i++; continue; }

    var sheetPrefix = null;
    var m1 = s.slice(i).match(/^'([^']*)'!/);
    if (!m1) m1 = s.slice(i).match(/^([^\s':();,+*/^&<>=!]+)!/);
    if (m1) {
      sheetPrefix = m1[1];
      i += m1[0].length;
      ch = s.charAt(i);
    }

    var ident = "", j = i;
    while (j < s.length && /[A-Za-zΑ-Ωα-ω0-9_]/.test(s.charAt(j)))
      ident += s.charAt(j++);
    if (!ident) { tokens.push({ type: TT_ERROR, value: ch }); i++; continue; }

    var lookahead = s.charAt(j);
    var refMatch = ident.toUpperCase().match(/^([A-Z]+)(\d+)$/);

    if (lookahead === "(") {
      tokens.push({ type: TT_FUNC, value: ident.toUpperCase() });
    } else if (BOOL_LITERALS.hasOwnProperty(ident.toUpperCase())) {
      tokens.push({ type: TT_NUM, value: BOOL_LITERALS[ident.toUpperCase()] });
    } else if (refMatch) {
      if (sheetPrefix) {
        if (s.charAt(j) === ":") {
          var rest = s.slice(j + 1).match(/^([A-Z]+[0-9]+)/i);
          if (rest) {
            j += 1 + rest[0].length;
            tokens.push({ type: TT_REF, value: sheetPrefix + "!" + ident + ":" + rest[0].toUpperCase() });
          } else {
            tokens.push({ type: TT_REF, value: sheetPrefix + "!" + ident });
          }
        } else {
          tokens.push({ type: TT_REF, value: sheetPrefix + "!" + ident });
        }
      } else {
        tokens.push({ type: TT_REF, value: ident.toUpperCase() });
      }
    } else if (sheetPrefix) {
      tokens.push({ type: TT_ERROR, value: "#REF!" });
    } else {
      tokens.push({ type: TT_STR, value: ident });
    }
    i = j;
  }

  return tokens;
}

function parse(tokens) {
  var output = [], opStack = [];
  var i = 0, lastWasOperand = false;

  while (i < tokens.length) {
    var tok = tokens[i];

    if (tok.type === TT_NUM || tok.type === TT_STR) {
      output.push(tok);
      lastWasOperand = true;
    }
    else if (tok.type === TT_REF) {
      output.push(tok);
      lastWasOperand = true;
    }
    else if (tok.type === TT_FUNC) {
      opStack.push({ type: "FUNC", name: tok.value, argc: 0, seenArg: false });
      lastWasOperand = false;
    }
    else if (tok.type === TT_LPAREN) {
      opStack.push(tok);
      lastWasOperand = false;
    }
    else if (tok.type === TT_RPAREN) {
      while (opStack.length && opStack[opStack.length-1].type !== "LPAREN" &&
             opStack[opStack.length-1].type !== "FUNC") {
        output.push(opStack.pop());
      }
      var topT = opStack.length ? opStack[opStack.length-1] : null;
      if (topT && topT.type === "LPAREN") {
        opStack.pop();
      }
      else if (topT && topT.type === "FUNC") {
        var fn = opStack.pop();
        output.push({ type: TT_FUNC, value: fn.name, argc: fn.argc });
        lastWasOperand = true;
      }
      if (opStack.length && opStack[opStack.length-1].type === "LPAREN")
        opStack.pop();
      lastWasOperand = true;
    }
    else if (tok.type === TT_OP) {
      var o1 = tok.value;
      var o1Def = OPERATORS[o1] || { prec: 0, assoc: "L" };
      while (opStack.length) {
        var top = opStack[opStack.length-1];
        if (top.type !== "OP") break;
        var o2Def = OPERATORS[top.value] || { prec: 0, assoc: "L" };
        if ((o1Def.prec < o2Def.prec) ||
            (o1Def.prec === o2Def.prec && o1Def.assoc === "L")) {
          output.push(opStack.pop());
        } else break;
      }
      opStack.push({ type: "OP", value: o1 });
      lastWasOperand = false;
    }
    else if (tok.type === TT_SEP) {
      if (tok.value === ":") { /* range colon — handled in lexer */ }
      else {
        while (opStack.length &&
               opStack[opStack.length-1].type !== "LPAREN" &&
               opStack[opStack.length-1].type !== "FUNC") {
          output.push(opStack.pop());
        }
        var ft = opStack.length ? opStack[opStack.length-1] : null;
        if (ft && ft.type === "FUNC") { ft.argc++; ft.seenArg = true; }
      }
      lastWasOperand = false;
    }
    i++;
  }

  while (opStack.length) {
    var rem = opStack.pop();
    if (rem.type === "FUNC")
      output.push({ type: TT_FUNC, value: rem.name, argc: rem.argc });
    else if (rem.type === "OP") output.push(rem);
  }

  return output; /* RPN */
}

function cellRaw(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  return cel ? cel.v : "";
}

function resolveRef(refStr) {
  var bang = refStr.indexOf("!"), sheetPart = null, cellPart = refStr;
  if (bang >= 0) {
    sheetPart = refStr.slice(0, bang);
    cellPart = refStr.slice(bang + 1);
  }
  var m = cellPart.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  var c = colFromName(m[1]), r = parseInt(m[2], 10) - 1;
  if (c < 0 || r < 0) return null;
  var sid = actSID;
  if (sheetPart !== null) {
    var sp = decodeURIComponent(sheetPart).replace(/^'|'$/g, "");
    var sh = findSheetByName(sp);
    if (!sh) return null;
    sid = sh.id;
  }
  return { sid: sid, r: r, c: c };
}

function coerceNum(v) {
  if (typeof v === "number") return v;
  if (v === "" || v === null || v === undefined) return 0;
  var n = parseFloat(v);
  return isNaN(n) ? v : n;
}

function isError(v) { return typeof v === "string" && v.charAt(0) === "#"; }

var EVAL_CACHE = {};

function evalCell(sid, r, c, visiting) {
  var key = sid + "|" + r + "|" + c;
  if (EVAL_CACHE.hasOwnProperty(key)) return EVAL_CACHE[key];
  if (visiting[key]) return "#CYC!";
  var raw = cellRaw(sid, r, c);
  if (raw === "") return 0;
  if (raw.charAt(0) !== "=") return coerceNum(raw);
  visiting[key] = true;
  var res;
  try {
    res = evaluate(parse(tokenize(raw)), visiting);
  } catch (e) { res = "#ERROR!"; }
  delete visiting[key];
  /* Imported-formula fallback: unknown functions (#NAME?) etc. ->
     use Excel's cached value so the sheet stays usable and any
     dependent formulas keep computing.                        */
  if (isError(res)) {
    var cel = state.cells[cellKey(sid, r, c)];
    if (cel && typeof cel.cv === "string" && cel.cv !== "")
      res = coerceNum(cel.cv);
  }
  EVAL_CACHE[key] = res;
  return res;
}

function flattenArgs(args) {
  var out = [];
  for (var i = 0; i < args.length; i++) {
    if (Array.isArray(args[i])) {
      for (var j = 0; j < args[i].length; j++) out.push(args[i][j]);
    } else out.push(args[i]);
  }
  return out;
}

function numsOf(vals) {
  var out = [];
  for (var i = 0; i < vals.length; i++)
    if (typeof vals[i] === "number" && !isNaN(vals[i])) out.push(vals[i]);
  return out;
}

function compareVals(a, b) {
  var na = coerceNum(a), nb = coerceNum(b);
  if (typeof na === "number" && typeof nb === "number") return na - nb;
  var sa = String(a), sb = String(b);
  return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

function evaluate(ast, visiting) {
  var stack = [];

  for (var i = 0; i < ast.length; i++) {
    var tok = ast[i];

    if (tok.type === TT_NUM || tok.type === TT_STR) { stack.push(tok.value); }

    else if (tok.type === TT_REF) {
      var ref = tok.value;
      if (ref.indexOf(":") >= 0) {
        var parts = ref.split(":");
        var rl = parts[0].indexOf("!") >= 0 ? parts[0].split("!") : [null, parts[0]];
        var rr = parts[1].indexOf("!") >= 0 ? parts[1].split("!") : [null, parts[1]];
        var a = resolveRef((rl[0] ? rl[0] + "!" : "") + rl[1]);
        var b = resolveRef((rr[0] ? rr[0] + "!" : (rl[0] ? rl[0] + "!" : "")) + rr[1]);
        if (!a || !b) { stack.push("#REF!"); continue; }
        var vals = [];
        for (var r = Math.min(a.r,b.r); r <= Math.max(a.r,b.r); r++)
          for (var c = Math.min(a.c,b.c); c <= Math.max(a.c,b.c); c++)
            vals.push(evalCell(a.sid, r, c, visiting));
        stack.push(vals);
      } else {
        var rc = resolveRef(ref);
        if (!rc) { stack.push("#REF!"); continue; }
        stack.push(evalCell(rc.sid, rc.r, rc.c, visiting));
      }
    }

    else if (tok.type === TT_OP) {
      if (tok.value === "&") {
        var bs = stack.pop(), as = stack.pop();
        if (isError(as)) { stack.push(as); continue; }
        if (isError(bs)) { stack.push(bs); continue; }
        stack.push(String(fmtVal(as)) + String(fmtVal(bs)));
        continue;
      }
      if (stack.length < 2) { stack.push("#ERROR!"); continue; }
      var bv = stack.pop(), av = stack.pop();
      if (isError(av)) { stack.push(av); continue; }
      if (isError(bv)) { stack.push(bv); continue; }
      var opDef = OPERATORS[tok.value];
      if (!opDef) { stack.push("#ERROR!"); continue; }
      if (opDef.cmp) {
        var cmp = compareVals(av, bv);
        var res;
        switch (tok.value) {
          case "=":  res = cmp === 0; break;
          case "<>": res = cmp !== 0; break;
          case "<":  res = cmp < 0; break;
          case ">":  res = cmp > 0; break;
          case "<=": res = cmp <= 0; break;
          case ">=": res = cmp >= 0; break;
        }
        stack.push(res ? 1 : 0);
      } else {
        var an = coerceNum(av), bn = coerceNum(bv);
        if (typeof an !== "number" || typeof bn !== "number") { stack.push("#VALUE!"); continue; }
        switch (tok.value) {
          case "+": stack.push(an + bn); break;
          case "-": stack.push(an - bn); break;
          case "*": stack.push(an * bn); break;
          case "/": stack.push(bn === 0 ? "#DIV/0!" : an / bn); break;
          case "^": stack.push(Math.pow(an, bn)); break;
        }
      }
    }

    else if (tok.type === TT_FUNC) {
      var argc = (typeof tok.argc === "number") ? tok.argc + 1 : 1;
      var args = [];
      var enough = true;
      while (argc-- > 0) {
        if (!stack.length) { enough = false; break; }
        args.unshift(stack.pop());
      }
      if (!enough) { stack.push("#ERROR!"); continue; }

      var fn = tok.value;
      var flat = flattenArgs(args);

      var errArg = null;
      for (var ai = 0; ai < flat.length; ai++)
        if (isError(flat[ai])) { errArg = flat[ai]; break; }
      if (errArg !== null) { stack.push(errArg); continue; }

      var nums = numsOf(flat);

      if (fn === "SUM") {
        var s = 0; for (var q = 0; q < nums.length; q++) s += nums[q];
        stack.push(s);
      }
      else if (fn === "AVERAGE" || fn === "AVG") {
        if (!nums.length) { stack.push("#DIV/0!"); }
        else { var tt = 0; for (var q = 0; q < nums.length; q++) tt += nums[q];
               stack.push(tt / nums.length); }
      }
      else if (fn === "MIN") {
        if (!nums.length) stack.push("#N/A");
        else { var mn = Infinity; for (var q = 0; q < nums.length; q++)
                 if (nums[q] < mn) mn = nums[q];
               stack.push(mn); }
      }
      else if (fn === "MAX") {
        if (!nums.length) stack.push("#N/A");
        else { var mx = -Infinity; for (var q = 0; q < nums.length; q++)
                 if (nums[q] > mx) mx = nums[q];
               stack.push(mx); }
      }
      else if (fn === "COUNT") { stack.push(nums.length); }
      else if (fn === "COUNTA") {
        var ca = 0; for (var q = 0; q < flat.length; q++)
          if (flat[q] !== "" && flat[q] !== null && flat[q] !== undefined &&
              !(typeof flat[q] === "number" && isNaN(flat[q]))) ca++;
        stack.push(ca);
      }
      else if (fn === "ROUND") {
        if (args.length < 2) { stack.push("#VALUE!"); continue; }
        var flat = flattenArgs(args);
        var rn = coerceNum(flat[0]), rp = flat.length > 1 ? coerceNum(flat[1]) : 0;
        if (typeof rn !== "number" || typeof rp !== "number") { stack.push("#VALUE!"); continue; }
        var f = Math.pow(10, rp);
        stack.push(Math.round(rn * f) / f);
      }
      else if (fn === "ABS") {
        var flat = flattenArgs(args);
        var ab = coerceNum(flat[0]);
        stack.push(typeof ab === "number" ? Math.abs(ab) : "#VALUE!");
      }
      else if (fn === "IF") {
        if (args.length < 2) { stack.push("#VALUE!"); continue; }
        var flat = flattenArgs(args);
        var cond = flat[0];
        var truthy = (typeof cond === "number" && cond !== 0) || cond === "TRUE";
        stack.push(truthy ? args[1] : (args.length > 2 ? args[2] : ""));
      }
      else if (fn === "AND") {
        var ra = 1;
        for (var q = 0; q < flat.length; q++)
          if (!(flat[q] === 1 || (typeof flat[q] === "number" && flat[q] !== 0) || flat[q] === "TRUE"))
            { ra = 0; break; }
        stack.push(ra);
      }
      else if (fn === "OR") {
        var ro = 0;
        for (var q = 0; q < flat.length; q++)
          if (flat[q] === 1 || (typeof flat[q] === "number" && flat[q] !== 0) || flat[q] === "TRUE")
            { ro = 1; break; }
        stack.push(ro);
      }
      else if (fn === "NOT") {
        var flat = flattenArgs(args);
        var nn = flat[0];
        stack.push(!(nn === 1 || (typeof nn === "number" && nn !== 0) || nn === "TRUE") ? 1 : 0);
      }
      else if (fn === "CONCAT" || fn === "CONCATENATE") {
        var cs = "";
        for (var q = 0; q < flat.length; q++)
          cs += (flat[q] === null || flat[q] === undefined) ? "" : String(fmtVal(flat[q]));
        stack.push(cs);
      }
      else { stack.push("#NAME?"); }
    }
  }

  if (stack.length !== 1) return "#ERROR!";
  var result = stack[0];
  if (result === undefined || result === null) return "";
  if (typeof result === "boolean") return result ? 1 : 0;
  if (typeof result === "number" && isNaN(result)) return "#NUM!";
  return result;
}

function fmtVal(v) {
  if (typeof v === "number") return String(Number(v.toFixed(10)));
  return String(v);
}
 
/* --- NUMBER FORMAT rendering (display layer only) --- */
function fmtDisplay(disp, nf) {
  if (nf === "gen" || !nf || disp === "" || disp.charAt(0) === "#") return disp;
  var n = parseFloat(disp);
  if (isNaN(n)) return disp; /* text: format ignores */
  if (nf === "0") return String(Math.round(n));
  if (nf === "2") return n.toFixed(2);
  if (nf === "%") return (n * 100).toFixed(1) + "%";
  if (nf === "\u20AC") return n.toFixed(2) + " \u20AC";
  return disp;
}

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

/* Shift relative refs in "=FORMULA" by (dr, dc). Built on tokenize:
   strings stay verbatim; plain A1 / A1:B10 refs shift; SHEET!refs
   stay (Calc behaviour); refs shifting out of bounds -> #REF!. */
function shiftFormula(formula, dr, dc) {
  if (dr === 0 && dc === 0) return formula;
  var tokens = tokenize(formula);
  var out = "", i, tk;
  /* We rebuild from tokens: faithful because tokenize round-trips
     everything we accept in input. Separator ; preserved. */
  for (i = 0; i < tokens.length; i++) {
    tk = tokens[i];
    if (tk.type === TT_REF) {
      out += shiftRefToken(tk.value, dr, dc);
    } else if (tk.type === TT_FUNC) {
      out += tk.value; /* "(" arrives from the TT_LPAREN token itself */
    } else if (tk.type === TT_OP || tk.type === TT_LPAREN ||
               tk.type === TT_RPAREN || tk.type === TT_SEP) {
      out += (tk.type === TT_SEP) ? tk.value : tk.value;
      if (tk.type === TT_FUNC) out += "";
    } else if (tk.type === TT_NUM) {
      out += String(tk.value);
    } else if (tk.type === TT_STR) {
      out += '"' + String(tk.value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    } else if (tk.type === TT_ERROR) {
      out += tk.value;
    }
  }
  return "=" + out;
}

/* token reconstruction cleanup: SEP tokens emit ',' or ';' as-is. */

function shiftRefToken(ref, dr, dc) {
  var parts = ref.split("!");
  var sheetPart = parts.length > 1 ? parts[0] + "!" : "";
  var cellPart = parts[parts.length - 1];
  var halves = cellPart.split(":");
  var shifted = [], hi;
  for (hi = 0; hi < halves.length; hi++) {
    var m = halves[hi].match(/^([A-Z]+)(\d+)$/);
    if (!m) return ref; /* unparseable — leave untouched */
    var c = colFromName(m[1]), r = parseInt(m[2], 10) - 1;
    var nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nc > 63) return "#REF!";
    shifted.push(colName(nc) + (nr + 1));
  }
  return sheetPart + shifted.join(":");
}

/* Copy/Cut strips the leading "=" problem: tokenizer emits raw for
   non-"=" strings, so formulas always enter shiftFormula with "=".
   But our token rebuild loses original spacing — acceptable, we
   STORE canonical rebuilt form (single source of truth).        */

function pasteClipboard() {
  if (editing) cancelEdit();
  if (!CLIP) { notifyTransient(t("clip.empty")); return; }
  var sheet = getActiveSheet();
  if (!sheet) return;

  var top = selTop(), lef = selLeft();
  var entries = [], r, c;

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

/* ===== SECTION 3c: RENDER (formats + rangesel + col widths) ===== */

var cellRefs = [];
var headRow = null;
var rowHeads = [];
var colHeads = [];
var DISP = {};
var lastPainted = [];

function buildGrid() {
  var tbl = $("grid");
  if (!tbl) { console.error("[SS] CRITICAL: #grid element missing!"); return; }

  var sheet = getActiveSheet();
  if (!sheet) { console.error("[SS] CRITICAL: no active sheet!"); return; }

  if (typeof sheet.rows !== "number" || sheet.rows < 1) sheet.rows = ROWS;
  if (typeof sheet.cols !== "number" || sheet.cols < 1) sheet.cols = COLS;
  if (!sheet.cw || typeof sheet.cw !== "object") sheet.cw = {};

  var r, c, tr, th, td;

  tbl.innerHTML = "";

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
    headRow.appendChild(th);
    colHeads.push(th);
  }
  thead.appendChild(headRow);
  tbl.appendChild(thead);

  var tbody = document.createElement("tbody");
  cellRefs = []; rowHeads = []; lastPainted = [];
  for (r = 0; r < sheet.rows; r++) {
    tr = document.createElement("tr");
    th = document.createElement("th");
    th.className = "rowh";
    th.textContent = String(r + 1);
    tr.appendChild(th);
    rowHeads.push(th);
    cellRefs[r] = []; lastPainted[r] = [];
    for (c = 0; c < sheet.cols; c++) {
      td = document.createElement("td");
      if (sheet.cw[c]) { td.style.width = sheet.cw[c] + "px"; td.style.minWidth = sheet.cw[c] + "px"; }
      tr.appendChild(td);
      cellRefs[r][c] = td;
      lastPainted[r][c] = null;
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  initColResize();
}

function displayVal(r, c) {
  var k = r + "," + c;
  if (DISP.hasOwnProperty(k)) return DISP[k];
  var cel = getCell(r, c);
  var v = cel ? cel.v : "";
  if (v !== "" && v.charAt(0) === "=") {
    var res = evalCell(actSID, r, c, {});
    v = isError(res) ? res : fmtVal(res);
  }
  if (cel && cel.f && cel.f.nf) v = fmtDisplay(v, cel.f.nf);
  DISP[k] = v;
  return v;
}

function paintCell(r, c) {
  if (editing && editingR === r && editingC === c) return;
  var td = cellRefs[r] && cellRefs[r][c];
  if (!td) return;
  var cel = getCell(r, c);
  var disp = displayVal(r, c);
  if (lastPainted[r][c] !== disp) {
    lastPainted[r][c] = disp;
    td.textContent = disp;
  }

  /* class rebuild: base (num/err) + format + selection */
  var cls = "";
  if (disp !== "" && disp.charAt(0) === "#") cls = "err";
  else if (disp !== "" && isFinite(parseFloat(disp))) cls = "num";

  var f = cel && cel.f;
  if (f) {
    if (f.b) cls += " fb";
    if (f.i) cls += " fi";
    if (f.u) cls += " fu";
    if (f.al === "c") cls += " fa-c";
    else if (f.al === "r") cls += " fa-r";
  }
  var inRange = (r >= selTop() && r <= selBottom() &&
                 c >= selLeft() && c <= selRight());
  if (inRange && !(r === selR && c === selC) && selIsRange()) cls += " rangesel";
  if (r === selR && c === selC) cls += " sel";

  /* cssText rebuild is cheap but className compares stale: use data attr */
  if (td.dataset.cls !== cls) {
    td.dataset.cls = cls;
    td.className = cls;
  }
  if (f && f.co) td.style.color = f.co;
  else if (td.style.color) td.style.color = "";
}

/* format CSS lives in stylesheet? No — minimal inline classes: */
/* injected once via a <style> tag at the end of this section.   */

function renderGrid() {
  if (EVAL_DIRTY) { EVAL_CACHE = {}; EVAL_DIRTY = false; }
  DISP = {};
  var sheet = getActiveSheet(), r, c;
  if (!sheet) return;
  for (r = 0; r < sheet.rows; r++)
    for (c = 0; c < sheet.cols; c++) paintCell(r, c);
}

function refreshCell(r, c) { DISP = {}; paintCell(r, c); }

function renderSelection() {
  var i;
  for (i = 0; i < rowHeads.length; i++)
    rowHeads[i].classList.remove("hl");
  for (i = 0; i < colHeads.length; i++)
    colHeads[i].classList.remove("hl");

  var prev = document.querySelectorAll("#grid td.sel, #grid td.rangesel");
  for (i = 0; i < prev.length; i++)
    prev[i].classList.remove("sel", "rangesel");

  if (selR < 0 || selC < 0) return;
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) td.classList.add("sel");
  if (rowHeads[selR]) rowHeads[selR].classList.add("hl");
  if (colHeads[selC + 1]) colHeads[selC + 1].classList.add("hl");
  if (selIsRange()) {
    var r, c;
    for (r = selTop(); r <= selBottom(); r++)
      for (c = selLeft(); c <= selRight(); c++) {
        if (r === selR && c === selC) continue;
        var rt = cellRefs[r] && cellRefs[r][c];
        if (rt) rt.classList.add("rangesel");
      }
    /* header spans light up across the range */
    for (i = selTop(); i <= selBottom(); i++) rowHeads[i].classList.add("hl");
    for (i = selLeft(); i <= selRight(); i++) colHeads[i + 1].classList.add("hl");
  }

  var refTxt = colName(selC) + (selR + 1) +
    (selIsRange() ? ":" + colName(selRight()) + (selBottom() + 1) : "");
  $("st-sel").textContent = refTxt;
  $("fx-ref").textContent = colName(selC) + (selR + 1);
  if (!fxFocused) {
    var cel = getCell(selR, selC);
    $("fx-input").value = cel ? cel.v : "";
  }
  updateToolbar();
}

/* ===== SECTION 3d: EDITING FLOW ===== */

function beginEdit(initialText) {
  if (editing) return;
  collapseSel(); /* typing replaces the range — single-cell edit */
  editing = true; editingR = selR; editingC = selC;
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (!td) { editing = false; return; }

  editInput = document.createElement("input");
  editInput.type = "text";
  editInput.autocomplete = "off";
  editInput.spellcheck = false;
  editInput.value =
    (initialText !== undefined && initialText !== null)
      ? initialText
      : (function () {
          var cel = getCell(selR, selC);
          return cel ? cel.v : "";
        })();
  td.textContent = "";
  td.className = "cell-editor";
  td.appendChild(editInput);
  editInput.focus();
  if (initialText !== undefined) editInput.setSelectionRange(
    editInput.value.length, editInput.value.length);

  editInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    e.stopPropagation();
  });
  editInput.addEventListener("input", function () {
    $("fx-input").value = editInput.value;
  });
}

function endEditDom() {
  var td = cellRefs[editingR] && cellRefs[editingR][editingC];
  if (td && editInput && td.contains(editInput)) td.removeChild(editInput);
  editInput = null;
  editing = false;
  lastPainted[editingR][editingC] = null;
  if (cellRefs[editingR] && cellRefs[editingR][editingC])
    delete cellRefs[editingR][editingC].dataset.cls;
  editingR = -1; editingC = -1;
}

function commitEdit(dr, dc) {
  if (!editing) return;
  var val = editInput ? editInput.value : "";
  val = val.replace(/^\s+|\s+$/g, "");
  var r = editingR, c = editingC;
  if (val === "") {
    if (getCell(r, c)) deleteCell(r, c);
  } else {
    setCell(r, c, val);
  }
  endEditDom();
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

function navigate(dr, dc, extend) {
  var sheet = getActiveSheet();
  if (!sheet) return;
  var nr = Math.min(Math.max(selR + dr, 0), sheet.rows - 1);
  var nc = Math.min(Math.max(selC + dc, 0), sheet.cols - 1);
  if (extend) {
    /* Shift+Arrow: extend the range from the anchor */
    selR = nr; selC = nc;
    renderSelection();
    var td = cellRefs[selR] && cellRefs[selR][selC];
    if (td) {
      try { td.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      catch (e) {}
    }
    return;
  }
  if (nr === selR && nc === selC) return;
  collapseSel(nr, nc);
  renderSelection();
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) {
    try { td.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    catch (e) {}
  }
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
  for (r = selTop(); r <= selBottom(); r++)
    for (c = selLeft(); c <= selRight(); c++) {
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
  pop.style.left = Math.max(4, br.left) + "px";
  pop.style.top = (br.bottom + 4) + "px";
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
    var r;
    for (r = 0; r < cellRefs.length; r++) {
      if (cellRefs[r][rsCol]) {
        cellRefs[r][rsCol].style.width = w + "px";
        cellRefs[r][rsCol].style.minWidth = w + "px";
      }
    }
  });
  document.addEventListener("mouseup", function () {
    if (!rsDrag) return;
    rsDrag = null;
    /* persist via sheet entity LWW */
    var sheet = getActiveSheet();
    if (sheet) { sheet.mtime = now(); markDirty(); }
  });
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

      tab.addEventListener("click", function (e) {
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        if (editing) commitEdit(0, 0);
        switchTo(sh.id);
      });
      tab.addEventListener("dblclick", function (e) {
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        beginRename(tab, label, sh);
      });

      nav.appendChild(tab);
    })(sheets[i]);
  }

  var add = document.createElement("button");
  add.type = "button";
  add.className = "stab-add";
  add.innerHTML = IC_ADD;
  add.title = "+";
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
  if (state.sheets.length <= 1) { toast(t("sheet.last")); return; }

  if (armX.id !== id) {
    if (armX.timer) clearTimeout(armX.timer);
    armX.id = id;
    armX.timer = setTimeout(function () {
      armX.id = null; renderTabs();
    }, 3000);
    toast(t("tab.confirm"));
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

function csvParse(text) {
  var rows = [], row = [], field = "", inQ = false, i, ch;
  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (ch === "\r") { }
      else field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  /* Hard cap at 64 columns — matches normalizeState limit */
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length > COLS) rows[r].length = COLS;
  }
  return rows;
}

function csvImport(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var rows = csvParse(sniffDecode(reader.result));
      if (!rows.length) { toast(t("err.corrupt")); return; }

      var n = nextSheetNumber();
      var maxCols = 0, ii;
      for (ii = 0; ii < rows.length; ii++)
        if (rows[ii].length > maxCols) maxCols = rows[ii].length;

      var sh = {
        id: uid(),
        name: null,
        bi: { en: "Sheet" + n, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + n },
        rows: Math.max(ROWS, rows.length + 5),
        cols: Math.max(COLS, maxCols),
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
    } catch (e) {
      console.error("[SS] CSV import failed:", e);
      toast(t("err.corrupt"));
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

var XL_ROWS_CAP = 500, XL_COLS_CAP = 64;   /* = normalizeState limits */
var xlLibLoading = false;

function loadXlsxLib(done) {
  if (window.XLSX && window.XLSX.utils) { done(); return; }
  if (xlLibLoading) return;
  xlLibLoading = true;
  var cands = ["vendor/xlsx.full.min.js", "../vendor/xlsx.full.min.js"];
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
        if (truncated) toast(t("xl.trunc")
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
  m.style.top = (br.bottom + 4) + "px";
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

function sliceGet() {
  var out = clone(state);
  /* Prune ancient tombstones from the SYNC PAYLOAD ONLY — local
     state keeps everything. Deterministic cutoff (dataset max ts,
     never wall clock) mirrors the mergeState rule exactly. */
  var maxTs = 0, k;
  for (k in out.deleted) if (out.deleted[k] > maxTs) maxTs = out.deleted[k];
  if (maxTs > 0) {
    var cutoff = maxTs - (30 * 24 * 60 * 60 * 1000);
    for (k in out.deleted) if (out.deleted[k] < cutoff) delete out.deleted[k];
  }
  return out;
}

function sliceSet(data, info) {
  __ss._suppress = true;
  try {
    var merged = normalizeState(mergeState(sliceGet(), data));
    if (merged) state = merged;
  } catch (e) {}
  __ss._suppress = false;

  var act = getSheetById(actSID);
  if (!act || state.deleted[actSID]) {
    actSID = state.sheets[0] ? state.sheets[0].id : SID;
    collapseSel(0, 0);
    buildGrid();
  }

  saveNow();
  if (editing) cancelEdit();
  undoStack.length = 0; /* sync reshape — device-local undo voids */
  redoStack.length = 0;
  invalidateEval();
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
  ' aria-hidden="true">';
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
  "tb-und":   svg('<text x="10" y="14" text-anchor="middle" style="font:600 12px sans-serif">U</text><path d="M6 16h8"/>', true),
  "tb-al-l":  svg('<path d="M3 6h14M3 10h9M3 14h12"/>'),
  "tb-al-c":  svg('<path d="M3 6h14M5.5 10h9M4.5 14h11"/>'),
  "tb-al-r":  svg('<path d="M3 6h14M8 10h9M5 14h12"/>'),
  "tb-col":   svg('<circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>'),
  "tb-clr":   svg('<path d="M4 14 12 6l4 4-6 6H6z"/><path d="M3 17h14"/>'),
  "csv-imp":  svg('<path d="M10 12V3"/><path d="M6.5 6.5 10 3l3.5 3.5"/><path d="M4 13v3.5h12V13"/>'),
  "csv-exp":  svg('<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 13v3.5h12V13"/>')
};
var IC_X   = svg('<path d="M5 5l10 10M15 5 5 15"/>');
var IC_ADD = svg('<path d="M10 4v12M4 10h12"/>');

function injectIcons() {
  var k;
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

  $("grid").addEventListener("pointerdown", function (e) {
    ptrType = e.pointerType || "mouse";
  }, true);

  $("grid").addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td || td.tagName !== "TD") return;
    var r = td.parentElement.rowIndex - 1;
    var c = td.cellIndex - 1;
    if (r < 0 || c < 0) return;
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
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td || td.tagName !== "TD") return;
    var r = td.parentElement.rowIndex - 1;
    var c = td.cellIndex - 1;
    if (r < 0 || c < 0) return;
    if (r !== selR || c !== selC) {
      selR = r; selC = c;
      renderSelection();
    }
  });

  document.addEventListener("mouseup", function () {
    dragSelecting = false;
  });

  /* dblclick on cell = edit (desktop fast path) */
  $("grid").addEventListener("dblclick", function (e) {
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td) return;
    if (!editing) beginEdit();
  });

  /* mobile: tap selects, tap on SELECTED cell edits.
     ptrType comes from pointerdown (works in every browser —
     click/mousedown never expose pointerType in Firefox/Safari). */
  $("grid").addEventListener("click", function (e) {
    if (mdSelected) { mdSelected = false; return; } /* mouse: mousedown owned it */
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td || td.tagName !== "TD") return;
    var r = td.parentElement.rowIndex - 1;
    var c = td.cellIndex - 1;
    if (r < 0 || c < 0) return;
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
  fx.addEventListener("focus", function () { fxFocused = true; });
  fx.addEventListener("blur", function () {
    fxFocused = false;
    renderSelection();
  });
  fx.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var val = fx.value.replace(/^\s+|\s+$/g, "");
      if (val === "") { if (getCell(selR, selC)) deleteCell(selR, selC); }
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
}

boot();

})();
