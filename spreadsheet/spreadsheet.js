/* ============================================================
   spreadsheet.js — orOS Spreadsheet / Λογιστικά φύλλα
   Wave 1 (bare core) — built from scratch per OROS_BIBLE.md
   Part VII. Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function(){
"use strict";

/* ===== SECTION 1: CONSTANTS · I18N · HELPERS ===== */

var SCRIPT_V = "";
var STORAGE_KEY = "oros-spreadsheet-data";
var DATA_VER = 1;
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
  console.log("spreadsheet.js v" + (SCRIPT_V || "?") + " boot");
})();

var STRINGS = {
  en: {
    "title": "Spreadsheet",
    "sheet.default": "Sheet1",
    "toast.updated": "Updated from sync",
    "err.corrupt": "Corrupted data rescued — a fresh sheet was created"
  },
  el: {
    "title": "Λογιστικά φύλλα",
    "sheet.default": "Φύλλο1",
    "toast.updated": "Ενημερώθηκε από συγχρονισμό",
    "err.corrupt": "Τα δεδομένα ήταν κατεστραμμένα — δημιουργήθηκε νέο φύλλο"
  }
};

function t(k) {
  var d = STRINGS[LANG] || STRINGS.en;
  return d.hasOwnProperty(k) ? d[k] :
    (STRINGS.en.hasOwnProperty(k) ? STRINGS.en[k] : k);
}

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() { return Date.now(); }

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

/* ===== SECTION 2: DATA MODEL + STORAGE ===== */

/* STATE SHAPE (Bible Part IV candidate — cell-entity contract):
   { ver: 1,
     sheets: [{ id, name: null, bi: {en, el}, rows, cols, mtime }],
     cells:  { "<sheetId>|<r>|<c>": { v: "<raw input>", mtime } },
     deleted:{ "<sheetId>": ts, "<sheetId>|<r>|<c>": ts } }
   · name === null => seed using bi (R15); a hand rename writes name
     and kills bi permanently.
   · mtime-0 sheet seeds are merge-inert (Calendar precedent).
   · Empty cells are NEVER stored (sparse model).               */

var state = null;
var SID = "s-main";   /* Wave 1: single sheet, deterministic fixed id (R16) */
var bootCorrupt = false;

function blankState() {
  return {
    ver: DATA_VER,
    sheets: [{
      id: SID, name: null,
      bi: { en: t("sheet.default"), el: "Φύλλο1" },
      rows: ROWS, cols: COLS, mtime: 0
    }],
    cells: {},
    deleted: {}
  };
}

function normalizeState(st) {
  if (!st || typeof st !== "object") return null;
  st.ver = DATA_VER;
  if (!Array.isArray(st.sheets)) st.sheets = [];
  var hasMain = false, i, sh;
  for (i = 0; i < st.sheets.length; i++) {
    sh = st.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") {
      st.sheets.splice(i, 1); i--; continue;
    }
    sh.rows = Math.min(Math.max(parseInt(sh.rows, 10) || ROWS, 1), 500);
    sh.cols = Math.min(Math.max(parseInt(sh.cols, 10) || COLS, 1), 64);
    if (typeof sh.mtime !== "number" || !isFinite(sh.mtime)) sh.mtime = 0;
    if (sh.name !== null && sh.name !== undefined &&
        typeof sh.name !== "string") sh.name = String(sh.name);
    if (sh.id === SID) hasMain = true;
  }
  if (!hasMain) st.sheets.push(blankState().sheets[0]);
  if (!st.cells || typeof st.cells !== "object") st.cells = {};
  if (!st.deleted || typeof st.deleted !== "object") st.deleted = {};

  var k;
  for (k in st.cells) {
    var cel = st.cells[k];
    if (!cel || typeof cel !== "object" || typeof cel.v !== "string" ||
        typeof cel.mtime !== "number" || !isFinite(cel.mtime) ||
        !/^[\w-]+\|\d+\|\d+$/.test(k) || cel.v === "") {
      delete st.cells[k];
    }
  }
  for (k in st.deleted) {
    if (typeof st.deleted[k] !== "number" || !isFinite(st.deleted[k]))
      delete st.deleted[k];
  }
  return st;
}

/* alive if mtime beats BOTH the cell tombstone and the sheet tombstone;
   delete wins ties (R17).                                       */
function tombFor(del, key) {
  var ts = del[key];
  if (ts && typeof ts === "number" && isFinite(ts)) return ts;
  var sid = key.split("|")[0];
  var stTs = del[sid];
  return (stTs && typeof stTs === "number" && isFinite(stTs)) ? stTs : 0;
}

function cellKey(sid, r, c) { return sid + "|" + r + "|" + c; }
function parseCellKey(k) { /* returns {sid, r, c} or null */
  var p = k.split("|");
  if (p.length !== 3) return null;
  var r = parseInt(p[1], 10), c = parseInt(p[2], 10);
  if (!isFinite(r) || !isFinite(c) || r < 0 || c < 0) return null;
  return { sid: p[0], r: r, c: c };
}

/* ===== SECTION 2b: MERGE ENGINE (deterministic, symmetric) ===== */

/* NEWER WINS: mtime comparison → lexicographic JSON/id tie-break
   (Bible Part VII §16 — canonical pattern from mood.js).         */
function newerObj(a, b) {
  if (!a) return b;
  if (!b) return a;
  var am = a.mtime || 0, bm = b.mtime || 0;
  if (am > bm) return a;
  if (bm > am) return b;
  var aj = JSON.stringify(a), bj = JSON.stringify(b);
  return (aj < bj) ? a : b;
}

/* Merges incoming payload into local state with R17 tombstone
   discipline: cell survives iff mtime > cell-tomb AND mtime > sheet-tomb. */
function mergeState(local, remote) {
  if (!local || typeof local !== "object") local = blankState();
  if (!remote || typeof remote !== "object") return local;

  var localVer = local.ver || DATA_VER;
  var remoteVer = remote.ver || DATA_VER;
  if (remoteVer > localVer) localVer = remoteVer;

  /* 1. Sheets merge: entity union, LWW by mtime, mtime-0 seeds inert */
  var sheetsMap = {}, i, sh;
  for (i = 0; i < local.sheets.length; i++) {
    sh = local.sheets[i];
    if (sh && typeof sh === "object" && typeof sh.id === "string")
      sheetsMap[sh.id] = sh;
  }
  for (i = 0; i < remote.sheets.length; i++) {
    sh = remote.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") continue;
    var existing = sheetsMap[sh.id];
    if (!existing) {
      sheetsMap[sh.id] = sh;
      continue;
    }
    if (existing.mtime === 0 && sh.mtime === 0) {
      /* both seeds, lex tie-break on id ensures determinism */
      sheetsMap[sh.id] = (existing.id <= sh.id) ? existing : sh;
    } else {
      sheetsMap[sh.id] = newerObj(existing, sh);
    }
  }

  var mergedSheets = [], ks = Object.keys(sheetsMap).sort();
  for (i = 0; i < ks.length; i++) mergedSheets.push(sheetsMap[ks[i]]);

  /* 2. Cells merge: sparse union with tombstone filtering */
  var mergedCells = {}, k;

  /* First: gather all candidate cells (local ∪ remote) */
  var candidates = {}, tombKey, sk;
  for (k in local.cells) {
    if (!local.cells[k] || typeof local.cells[k] !== "object") continue;
    candidates[k] = local.cells[k];
  }
  for (k in remote.cells) {
    if (!remote.cells[k] || typeof remote.cells[k] !== "object") continue;
    if (!candidates[k]) candidates[k] = remote.cells[k];
    else candidates[k] = newerObj(remote.cells[k], local.cells[k]);
  }

  /* Apply tombstone filter: cell dies if mtime ≤ max(sheet-tomb, cell-tomb) */
  for (k in candidates) {
    var cel = candidates[k];
    var pk = parseCellKey(k);
    if (!pk) continue;
    tombKey = k;
    var cellTomb = tombFor(remote.deleted, tombKey) ||
                   tombFor(local.deleted, tombKey);
    tombKey = pk.sid;
    var sheetTomb = tombFor(remote.deleted, tombKey) ||
                    tombFor(local.deleted, tombKey);
    var maxTomb = Math.max(cellTomb || 0, sheetTomb || 0);
    if ((cel.mtime || 0) > maxTomb) {
      mergedCells[k] = cel;
    }
  }

  /* 3. Deleted union: max-ts per key (tombstone persistence) */
  var mergedDel = {};
  for (k in local.deleted)
    mergedDel[k] = Math.max(local.deleted[k] || 0, mergedDel[k] || 0);
  for (k in remote.deleted)
    mergedDel[k] = Math.max(remote.deleted[k] || 0, mergedDel[k] || 0);

  /* Prune tombstones older than 30 days */
  var nowTs = now(), pruneCutoff = nowTs - (30 * 24 * 60 * 60 * 1000);
  for (k in mergedDel) {
    if (mergedDel[k] < pruneCutoff) delete mergedDel[k];
  }

  return { ver: localVer, sheets: mergedSheets, cells: mergedCells, deleted: mergedDel };
}

/* ===== SECTION 3: CAPTURE + RENDER FLOW ===== */

var selSheet = null;   /* current sheet pointer (always SID for Wave 1) */
var selR = 0, selC = 0;/* selection coordinates (row, col) */
var editing = false;   /* in-cell edit mode flag */
var renderPending = false; /* debounce render guard */
var syncApi = null;    /* sync api wrapper (Section 4) */
var dirtyFlag = false; /* local dirty flag (user edits) */

/* --- 3a. Data access (pure, no DOM) --- */

function getActiveSheet() {
  var i, sh;
  for (i = 0; i < state.sheets.length; i++) {
    sh = state.sheets[i];
    if (sh && sh.id === SID) return sh;
  }
  return state.sheets[0];
}

function getCell(r, c) {
  var key = cellKey(SID, r, c);
  return state.cells[key] || null;
}

function setCell(r, c, rawValue) {
  if (!state.cells) state.cells = {};
  var key = cellKey(SID, r, c);
  var oldVal = state.cells[key];
  state.cells[key] = { v: String(rawValue), mtime: now() };
  if (oldVal) {
    /* value changed — mark dirty */
    markDirty();
  }
}

function deleteCell(r, c) {
  var key = cellKey(SID, r, c);
  delete state.cells[key];
  state.deleted[key] = now();
  markDirty();
}

function markDirty() {
  dirtyFlag = true;
  updateStatus();
  if (syncApi && syncApi.dirty) syncApi.dirty();
}

function updateStatus() {
  var st = $("st-note");
  if (!st) return;
  st.textContent = dirtyFlag ? "*" : "";
}

/* --- 3b. Formula evaluation (Wave 1 core) --- */

/* Token types for the lexer */
var TT_NUM = 1, TT_STR = 2, TT_OP = 3, TT_REF = 4, TT_FUNC = 5, TT_SEP = 6, TT_LPAREN = 7, TT_RPAREN = 8, TT_ERROR = 9;

/* Operators with precedence */
var OPERATORS = {
  "+": { prec: 2, assoc: "L", fn: function(a,b){return a+b;} },
  "-": { prec: 2, assoc: "L", fn: function(a,b){return a-b;} },
  "*": { prec: 3, assoc: "L", fn: function(a,b){return a*b;} },
  "/": { prec: 3, assoc: "L", fn: function(a,b){return b===0?NaN:a/b;} },
  "^": { prec: 4, assoc: "R", fn: function(a,b){return Math.pow(a,b);} },
  "&": { prec: 1, assoc: "L", fn: function(a,b){return String(a||"")+String(b||"");} }
};

/* Comparison operators return boolean (converted to number when needed) */
var COMPARISONS = { "=":1, "<>":1, "<":1, ">":1, "<=":1, ">=":1 };

/* Lexer: converts formula string into tokens */
function tokenize(formula) {
  var tokens = [];
  var i = 0, s = String(formula).trim();
  
  if (!s || s.charAt(0) !== "=") {
    /* Plain value — treated as a single string token */
    if (s) tokens.push({ type: TT_STR, value: s });
    return tokens;
  }
  
  i++; /* skip '=' */
  while (i < s.length) {
    var ch = s.charAt(i);
    
    /* Skip whitespace */
    if (/\s/.test(ch)) { i++; continue; }
    
    /* Strings (double quotes) */
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
    
    /* Numbers (including decimals) */
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s.charAt(i+1)))) {
      var num = "", hasDot = false;
      while (i < s.length && /[0-9.]/.test(s.charAt(i))) {
        var digit = s.charAt(i);
        if (digit === ".") {
          if (hasDot) break;
          hasDot = true;
        }
        num += digit;
        i++;
      }
      tokens.push({ type: TT_NUM, value: parseFloat(num) });
      continue;
    }
    
    /* Operators (multi-char first: <=, >=, <>) */
    var op = "";
    if (i + 1 < s.length) {
      var twoChar = s.substr(i, 2);
      if (COMPARISONS[twoChar] || twoChar === "&&" || twoChar === "||") {
        op = twoChar;
        i += 2;
      }
    }
    if (!op && OPERATORS[ch]) {
      op = ch;
      i++;
    }
    if (op) {
      tokens.push({ type: TT_OP, value: op });
      continue;
    }
    
    /* Parentheses */
    if (ch === "(") { tokens.push({ type: TT_LPAREN, value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: TT_RPAREN, value: ch }); i++; continue; }
    
    /* Commas and colons (range operator) */
    if (ch === ",") { tokens.push({ type: TT_SEP, value: "," }); i++; continue; }
    if (ch === ":") { tokens.push({ type: TT_SEP, value: ":" }); i++; continue; }
    
    /* References (A1, B10, AA100, A1:B10) */
    if (/[A-Z]/i.test(ch)) {
      var ref = "", j = i;
      while (j < s.length && /[A-Za-z0-9:!]/.test(s.charAt(j))) {
        ref += s.charAt(j++);
      }
      
      /* Check if this is a function name (ref followed by '(') */
      var lookahead = s.charAt(j);
      if (lookahead === "(" && !ref.match(/:\d+/)) {
        tokens.push({ type: TT_FUNC, value: ref.toUpperCase() });
      } else {
        tokens.push({ type: TT_REF, value: ref.toUpperCase() });
      }
      i = j;
      continue;
    }
    
    /* Unknown character — error */
    tokens.push({ type: TT_ERROR, value: ch });
    i++;
  }
  
  return tokens;
}

/* Parser: builds AST from tokens (shunting-yard algorithm for infix operators) */
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
      /* Cell reference or range — evaluate lazily */
      output.push(tok);
      lastWasOperand = true;
    }
    else if (tok.type === TT_FUNC) {
      output.push(tok);
      opStack.push({ type: "FUNC_START" });
      lastWasOperand = false;
    }
    else if (tok.type === TT_LPAREN) {
      if (lastWasOperand) {
        /* Implicit multiplication: value( -> value * ( */
        output.push({ type: TT_OP, value: "*" });
      }
      opStack.push(tok);
      lastWasOperand = false;
    }
    else if (tok.type === TT_RPAREN) {
      while (opStack.length && opStack[opStack.length-1].type !== TT_LPAREN) {
        output.push(opStack.pop());
      }
      if (opStack.length) opStack.pop(); /* pop '(' */
      
      /* If function name on top, pop it too */
      if (opStack.length && opStack[opStack.length-1].type === "FUNC_START") {
        opStack.pop();
      }
      lastWasOperand = true;
    }
    else if (tok.type === TT_OP) {
      var o1 = tok.value;
      var o1Prec = OPERATORS[o1] ? OPERATORS[o1].prec : 0;
      
      while (opStack.length) {
        var top = opStack[opStack.length-1];
        if (top.type !== TT_OP) break;
        
        var o2 = top.value;
        var o2Prec = OPERATORS[o2] ? OPERATORS[o2].prec : 0;
        
        if ((o1Prec < o2Prec) || (o1Prec === o2Prec && OPERATORS[o1].assoc === "L")) {
          output.push(opStack.pop());
        } else {
          break;
        }
      }
      opStack.push(tok);
      lastWasOperand = false;
    }
    else if (tok.type === TT_SEP) {
      /* Comma separator in functions — pop until LPAREN */
      while (opStack.length && opStack[opStack.length-1].type !== TT_LPAREN && 
             opStack[opStack.length-1].type !== "FUNC_START") {
        output.push(opStack.pop());
      }
      lastWasOperand = false;
    }
    else {
      /* Error token or unknown — skip */
    }
    
    i++;
  }
  
  while (opStack.length) {
    output.push(opStack.pop());
  }
  
  return output; /* Reverse Polish Notation */
}

/* Evaluator: executes RPN with cell resolution and functions */
function evaluate(ast, visitingRefSet) {
  if (!visitingRefSet) visitingRefSet = {};
  var stack = [];
  
  for (var i = 0; i < ast.length; i++) {
    var tok = ast[i];
    
    if (tok.type === TT_NUM) {
      stack.push(tok.value);
    }
    else if (tok.type === TT_STR) {
      stack.push(tok.value);
    }
    else if (tok.type === TT_REF) {
      var ref = tok.value;
      /* Detect circular reference */
      if (visitingRefSet[ref]) return "#REF!";
      
      /* Parse range (A1:B10) or single cell (A1) */
      if (ref.indexOf(":") >= 0) {
        /* Range — expand to array of values */
        var parts = ref.split(":");
        var startCol = colFromName(parts[0]), startRow = parseInt(parts[0].match(/\d+/)[0], 10) - 1;
        var endCol = colFromName(parts[1]), endRow = parseInt(parts[1].match(/\d+/)[0], 10) - 1;
        
        if (startCol < 0 || endCol < 0 || startRow < 0 || endRow < 0) {
          stack.push("#REF!");
          continue;
        }
        
        var vals = [];
        for (var r = Math.min(startRow,endRow); r <= Math.max(startRow,endRow); r++) {
          for (var c = Math.min(startCol,endCol); c <= Math.max(startCol,endCol); c++) {
            var key = cellKey(SID, r, c);
            var cel = state.cells[key];
            var val = cel ? cel.v : "";
            
            /* Recursively evaluate if it's a formula */
            if (typeof val === "string" && val.charAt(0) === "=") {
              visitingRefSet[ref] = true;
              val = evaluate(parse(tokenize(val)), visitingRefSet);
              delete visitingRefSet[ref];
            }
            
            /* Coerce to number if possible */
            var numVal = parseFloat(val);
            vals.push(isNaN(numVal) ? (val === "" ? 0 : 0) : numVal);
          }
        }
        stack.push(vals);
      }
      else {
        /* Single cell */
        var cMatch = ref.match(/([A-Z]+)(\d+)/);
        if (!cMatch) { stack.push("#NAME?"); continue; }
        
        var cCol = colFromName(cMatch[1]);
        var cRow = parseInt(cMatch[2], 10) - 1;
        if (cCol < 0 || cRow < 0) { stack.push("#REF!"); continue; }
        
        var key = cellKey(SID, cRow, cCol);
        var cell = state.cells[key];
        var val = cell ? cell.v : "";
        
        if (val === "") {
          stack.push(0); /* Empty cell = 0 in arithmetic */
        } else if (val.charAt(0) === "=") {
          /* Evaluate formula recursively */
          visitingRefSet[ref] = true;
          val = evaluate(parse(tokenize(val)), visitingRefSet);
          delete visitingRefSet[ref];
          
          /* Check for errors */
          if (typeof val === "string" && val.charAt(0) === "#") {
            stack.push(val);
          } else {
            var numVal = parseFloat(val);
            stack.push(isNaN(numVal) ? val : numVal);
          }
        } else {
          var numVal = parseFloat(val);
          stack.push(isNaN(numVal) ? val : numVal);
        }
      }
    }
    else if (tok.type === TT_OP) {
      if (stack.length < 2) { stack.push("#ERROR!"); continue; }
      var b = stack.pop();
      var a = stack.pop();
      
      /* Handle errors propagate */
      if (typeof a === "string" && a.charAt(0) === "#") { stack.push(a); continue; }
      if (typeof b === "string" && b.charAt(0) === "#") { stack.push(b); continue; }
      
      var opDef = OPERATORS[tok.value];
      if (!opDef) { stack.push("#ERROR!"); continue; }
      
      var result = opDef.fn(a, b);
      if (tok.value === "+" && typeof a === "string" && typeof b === "string") {
        /* String concatenation via & */
        result = a + b;
      }
      stack.push(result);
    }
    else if (tok.type === TT_FUNC) {
      /* Extract arguments from stack until we hit the FUNC_START marker or comma separators */
      /* This is simplified — full implementation would need better argument tracking */
      /* For Wave 1: we support SUM(A1:A10) style functions */
      var funcName = tok.value;
      var args = [];
      
      /* Pop arguments (simplified: assume last n items are args, where n varies by function) */
      /* Better approach: mark argument boundaries during parsing */
      
      /* Simplified function handler for Wave 1 */
      if (funcName === "SUM") {
        var sum = 0, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (typeof v === "number" && !isNaN(v)) sum += v;
          }
        } else if (typeof arr === "number" && !isNaN(arr)) {
          sum = arr;
        }
        stack.push(sum);
      }
      else if (funcName === "AVERAGE" || funcName === "AVG") {
        var total = 0, count = 0, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (typeof v === "number" && !isNaN(v)) { total += v; count++; }
          }
        } else if (typeof arr === "number" && !isNaN(arr)) {
          total = arr; count = 1;
        }
        stack.push(count > 0 ? (total / count) : "#DIV/0!");
      }
      else if (funcName === "MIN") {
        var min = Infinity, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (typeof v === "number" && !isNaN(v) && v < min) min = v;
          }
        } else if (typeof arr === "number" && !isNaN(arr)) {
          min = arr;
        }
        stack.push(min === Infinity ? "#N/A" : min);
      }
      else if (funcName === "MAX") {
        var max = -Infinity, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (typeof v === "number" && !isNaN(v) && v > max) max = v;
          }
        } else if (typeof arr === "number" && !isNaN(arr)) {
          max = arr;
        }
        stack.push(max === -Infinity ? "#N/A" : max);
      }
      else if (funcName === "COUNT") {
        var cnt = 0, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (typeof v === "number" && !isNaN(v)) cnt++;
          }
        } else if (typeof arr === "number" && !isNaN(arr)) {
          cnt = 1;
        }
        stack.push(cnt);
      }
      else if (funcName === "COUNTA") {
        var cnt = 0, arr = stack.pop();
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var v = arr[j];
            if (v !== "" && v !== undefined && v !== null && !(typeof v === "number" && isNaN(v))) cnt++;
          }
        } else if (arr !== "" && arr !== undefined && arr !== null) {
          cnt = 1;
        }
        stack.push(cnt);
      }
      else if (funcName === "ROUND") {
        var arr = [];
        while (arr.length < 2) arr.unshift(stack.pop());
        var num = arr[0], places = arr[1];
        if (typeof num === "number" && typeof places === "number") {
          var factor = Math.pow(10, places);
          stack.push(Math.round(num * factor) / factor);
        } else {
          stack.push("#VALUE!");
        }
      }
      else if (funcName === "ABS") {
        var val = stack.pop();
        stack.push(typeof val === "number" && !isNaN(val) ? Math.abs(val) : "#VALUE!");
      }
      else if (funcName === "IF") {
        var argsIf = [];
        while (argsIf.length < 3) argsIf.unshift(stack.pop());
        var cond = argsIf[0], thenV = argsIf[1], elseV = argsIf[2];
        var result = (cond && cond !== 0 && cond !== "false") ? thenV : elseV;
        stack.push(result);
      }
      else if (funcName === "AND") {
        var result = true, arr = [];
        while (stack.length && typeof stack[stack.length-1] !== "string" || stack.length > 0) {
          arr.unshift(stack.pop());
          if (arr.length >= 30) break; /* safety */
          if (stack.length === 0) break;
        }
        for (var j = 0; j < arr.length; j++) {
          if (!arr[j] || arr[j] === 0 || arr[j] === "false") { result = false; break; }
        }
        stack.push(result ? 1 : 0);
      }
      else if (funcName === "OR") {
        var result = false, arr = [];
        while (stack.length && (typeof stack[stack.length-1] !== "string" || stack.length > 0)) {
          arr.unshift(stack.pop());
          if (arr.length >= 30) break;
          if (stack.length === 0) break;
        }
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] && arr[j] !== 0 && arr[j] !== "false") { result = true; break; }
        }
        stack.push(result ? 1 : 0);
      }
      else if (funcName === "NOT") {
        var val = stack.pop();
        stack.push(!(val && val !== 0 && val !== "false") ? 1 : 0);
      }
      else if (funcName === "CONCAT") {
        var str = "", arr = [];
        while (stack.length && typeof stack[stack.length-1] !== "string" || stack.length > 0) {
          arr.unshift(stack.pop());
          if (stack.length === 0) break;
        }
        for (var j = 0; j < arr.length; j++) {
          str += (arr[j] !== undefined && arr[j] !== null) ? String(arr[j]) : "";
        }
        stack.push(str);
      }
      else {
        /* Unknown function */
        stack.push("#NAME?");
      }
    }
  }
  
  if (stack.length !== 1) return "#ERROR!";
  var result = stack[0];
  if (result === undefined || result === null) return "";
  if (typeof result === "boolean") return result ? 1 : 0;
  if (typeof result === "number" && isNaN(result)) return "#NUM!";
  return result;
}

function computeCellValue(r, c) {
  var cell = getCell(r, c);
  if (!cell) return "";
  var raw = cell.v;
  
  if (typeof raw !== "string") return raw;
  if (raw === "") return "";
  
  /* Check for error markers already in the cell */
  if (raw === "#CYC!" || raw === "#REF!" || raw === "#VALUE!" || 
      raw === "#NAME?" || raw === "#ERROR!") return raw;
  
  /* Plain formula */
  if (raw.charAt(0) === "=") {
    var tokens = tokenize(raw);
    var ast = parse(tokens);
    var visiting = {};
    var result = evaluate(ast, visiting);
    if (typeof result === "string" && result.charAt(0) === "#") return result;
    if (typeof result === "number") {
      /* Format nicely — no trailing zeros */
      return String(Number(result.toFixed(10)));
    }
    return result;
  }
  
  /* Plain text or number literal */
  return raw;
}

/* ===== SECTION 2c: STORAGE FUNNEL (load/save) ===== */

var saveTimer = null;

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400); /* rapid cell-entry cadence */
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* quota — notifications channel is Wave 2 (emit inbox) */ }
}

function loadState() {
  var raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  var st = null;
  if (raw) {
    try { st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st) {
      /* CORRUPTION RESCUE (Data Safety Supremacy) */
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) {}
    }
  }
  state = normalizeState(st);
  if (!state) {
    state = blankState();
    if (raw) setTimeout(function () { toast(t("err.corrupt")); }, 400);
  }
}

/* markDirty gains the persistence funnel (hoisting makes the
   queueSave declaration above visible here) — the sync echo
   path NEVER comes through here (sliceSet writes directly). */
/* replaces the Section 3a stub:
   function markDirty() { dirtyFlag = true; updateStatus();
     if (syncApi && syncApi.dirty) syncApi.dirty(); }
   — full replacement below in Section 4 wiring order. */

/* ===== SECTION 3c: RENDER ===== */

var cellRefs = [];   /* cellRefs[r][c] -> td */
var headRow = null;  /* thead row */
var rowHeads = [];   /* rowHeads[r] -> th.rowh */
var colHeads = [];   /* colHeads[c] -> thead th */
var DISP = {};       /* per-render display memo (cleared each pass) */
var lastPainted = [];/* lastPainted[r][c] -> last text set (skip no-op) */

function buildGrid() {
  var tbl = $("grid");
  console.log("[SS] buildGrid: #grid found =", !!tbl);
  if (!tbl) { console.error("[SS] CRITICAL: #grid element missing!"); return; }

  var sheet = getActiveSheet();
  console.log("[SS] buildGrid: sheet =", JSON.stringify(sheet));

  /* Safety net: repair invalid dimensions before building */
  if (!sheet || typeof sheet.rows !== "number" || sheet.rows < 1 ||
      typeof sheet.cols !== "number" || sheet.cols < 1) {
    console.error("[SS] CRITICAL: invalid sheet dimensions!");
    if (!sheet) {
      state.sheets = [blankState().sheets[0]];
      sheet = state.sheets[0];
    }
    sheet.rows = (typeof sheet.rows === "number" && sheet.rows > 0) ? sheet.rows : ROWS;
    sheet.cols = (typeof sheet.cols === "number" && sheet.cols > 0) ? sheet.cols : COLS;
    console.warn("[SS] repaired dims:", sheet.rows + "x" + sheet.cols);
  }

  var r, c, tr, th, td;

  var thead = document.createElement("thead");
  headRow = document.createElement("tr");
  th = document.createElement("th");
  th.className = "corner";
  headRow.appendChild(th);
  colHeads = [th];
  for (c = 0; c < sheet.cols; c++) {
    th = document.createElement("th");
    th.textContent = colName(c);
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
      tr.appendChild(td);
      cellRefs[r][c] = td;
      lastPainted[r][c] = null;
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  console.log("[SS] buildGrid COMPLETE:", sheet.rows + "x" + sheet.cols);
}

function displayVal(r, c) {
  var k = r + "," + c;
  if (DISP.hasOwnProperty(k)) return DISP[k];
  var v = computeCellValue(r, c);
  DISP[k] = v;
  return v;
}

function paintCell(r, c) {
  if (editing && editingR === r && editingC === c) return; /* editor owns it */
  var td = cellRefs[r] && cellRefs[r][c];
  if (!td) return;
  var disp = displayVal(r, c);
  if (lastPainted[r][c] === disp) return; /* surgical — skip no-op */
  lastPainted[r][c] = disp;
  td.textContent = disp;
  var cls = "";
  if (disp !== "" && disp.charAt(0) === "#") cls = "err";
  else if (disp !== "" && isFinite(parseFloat(disp))) cls = "num";
  td.className = cls; /* .sel re-applied by renderSelection */
}

function renderGrid() {
  DISP = {};
  var sheet = getActiveSheet(), r, c;
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

  /* clear previous .sel (single-cursor Wave 1 — O(visible) scan) */
  var prev = document.querySelectorAll("#grid td.sel");
  for (i = 0; i < prev.length; i++)
    prev[i].classList.remove("sel");

  if (selR < 0 || selC < 0) return;
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) td.classList.add("sel");
  if (rowHeads[selR]) rowHeads[selR].classList.add("hl");
  if (colHeads[selC + 1]) colHeads[selC + 1].classList.add("hl");

  var refTxt = colName(selC) + (selR + 1);
  $("st-sel").textContent = refTxt;
  $("fx-ref").textContent = refTxt;
  if (!fxFocused) {
    var cel = getCell(selR, selC);
    $("fx-input").value = cel ? cel.v : "";
  }
}

/* ===== SECTION 3d: EDITING FLOW ===== */

var editing = false, editingR = -1, editingC = -1;
var editInput = null;
var fxFocused = false;

function beginEdit(initialText) {
  if (editing) return;
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
    e.stopPropagation(); /* Contract Β forwarder must not see editor keys */
  });
  editInput.addEventListener("input", function () {
    $("fx-input").value = editInput.value; /* live mirror to formula bar */
  });
}

function endEditDom() {
  var td = cellRefs[editingR] && cellRefs[editingR][editingC];
  if (td && td.contains(editInput)) td.removeChild(editInput);
  editInput = null;
  editing = false;
  lastPainted[editingR][editingC] = null; /* force repaint */
  editingR = -1; editingC = -1;
}

function commitEdit(dr, dc) {
  if (!editing) return;
  var val = editInput ? editInput.value : "";
  val = val.replace(/^\s+|\s+$/g, "");
  var r = editingR, c = editingC;
  if (val === "") {
    if (getCell(r, c)) deleteCell(r, c);
    else { /* editing an empty cell to nothing = zero-edit close,
              NO mtime stamp, NO tombstone (Bible Part VIII) */ }
  } else {
    setCell(r, c, val);
  }
  endEditDom();
  queueSave();
  refreshCell(r, c);
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

function navigate(dr, dc) {
  var sheet = getActiveSheet();
  var nr = Math.min(Math.max(selR + dr, 0), sheet.rows - 1);
  var nc = Math.min(Math.max(selC + dc, 0), sheet.cols - 1);
  if (nr === selR && nc === selC) return;
  selR = nr; selC = nc;
  renderSelection();
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) {
    try { td.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    catch (e) {}
  }
}

function clearSelected() {
  if (editing) return;
  if (getCell(selR, selC)) {
    deleteCell(selR, selC);
    queueSave();
    refreshCell(selR, selC);
  }
}

/* ===== SECTION 4: SYNC SLICE + PALETTE + NOTIFICATIONS ===== */

var __ss = { _suppress: false,
  dirty: function () {
    if (this._suppress) return;
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
  } };

function markDirty() {
  dirtyFlag = true;
  updateStatus();
  queueSave();
  __ss.dirty();
}

function sliceGet() { return JSON.parse(JSON.stringify(state)); }

function sliceSet(data, info) {
  __ss._suppress = true;
  try {
    var merged = normalizeState(mergeState(sliceGet(), data));
    if (merged) state = merged;
  } catch (e) { /* defensive: keep local state on malformed payload */ }
  __ss._suppress = false;
  saveNow(); /* local persistence only — NEVER markDirty (R6) */
  if (editing) { cancelEdit(); } /* stale-target hygiene (R7 spirit) */
  renderGrid();
  renderSelection();
  /* NO merged-receipt toast — Wave 10/11 doctrine: the taskbar
     sync dot is the feedback surface. info.merged noted, unused. */
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

/* IFRAME PALETTE CONTRACT (G3 — CI-enforced, MUST exist) */
var PAL_VARS = ["--bg","--bg-desktop","--bar-bg","--text","--text-dim",
  "--accent","--accent-hover","--accent-soft","--panel-bg","--border",
  "--shadow","--danger","--ok","--warn","--font-stack","--mono"];

function inheritPalette() {
  var pd = null;
  try { pd = window.parent && window.parent.document; } catch (e) {}
  if (!pd || !pd.documentElement) return;
  var rs = document.documentElement.style;
  rs.setAttribute("data-theme", pd.documentElement.getAttribute("data-theme") || "");
  rs.setAttribute("data-skin", pd.documentElement.getAttribute("data-skin") || "");
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

/* NOTIFICATIONS — Kanban Wave 10 pattern (no KNOWN_APPS slot:
   transient bypasses toggles by design; no background events). */
function notifyTransient(text) {
  var nm = null;
  try { nm = (window.parent && window.parent.orosNotifs) || window.orosNotifs; }
  catch (e) {}
  if (nm && typeof nm.transient === "function") {
    try { nm.transient({ ns: "spreadsheet", title: text }); return; }
    catch (e) {}
  }
  toast(text); /* stale-bundle fallback */
}

function toast(text) {
  var el = document.getElementById("ss-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ss-toast";
    el.className = "ss-toast";
    document.body.appendChild(el);
  }
  el.textContent = text; /* text node FIRST (Bible §16 toast contract) */
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

function wire() {
  var wrap = $("grid-wrap");

  /* Grid clicks: 1st tap selects, tap on the SELECTED cell edits
     (mobile fill-mode pattern); dblclick edits on desktop too. */
  $("grid").addEventListener("click", function (e) {
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td || td.tagName !== "TD") return;
    var r = td.parentElement.rowIndex - 1;
    var c = td.cellIndex - 1;
    if (r < 0 || c < 0) return;
    if (editing) commitEdit(0, 0);
    if (selR === r && selC === c && !editing) beginEdit();
    else { selR = r; selC = c; renderSelection(); }
  });

  $("grid").addEventListener("dblclick", function (e) {
    var td = e.target;
    while (td && td.tagName !== "TD") td = td.parentElement;
    if (!td) return;
    if (!editing) beginEdit();
  });

  /* Keyboard: selection navigation + edit entry */
  wrap.addEventListener("keydown", function (e) {
    if (editing) return; /* editor input handles its own keys */
    var k = e.key;
    if (k === "ArrowUp") { e.preventDefault(); navigate(-1, 0); }
    else if (k === "ArrowDown") { e.preventDefault(); navigate(1, 0); }
    else if (k === "ArrowLeft") { e.preventDefault(); navigate(0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); navigate(0, 1); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit(); }
    else if (k === "Tab") { e.preventDefault(); navigate(0, 1); }
    else if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); clearSelected();
    }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); beginEdit(k); /* type-to-replace (Excel) */
    }
  });

  /* Formula bar */
  var fx = $("fx-input");
  fx.addEventListener("focus", function () { fxFocused = true; });
  fx.addEventListener("blur", function () {
    fxFocused = false;
    renderSelection(); /* re-sync bar with any commit that raced */
  });
  fx.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var val = fx.value.replace(/^\s+|\s+$/g, "");
      if (val === "") { if (getCell(selR, selC)) deleteCell(selR, selC); }
      else setCell(selR, selC, val);
      queueSave(); refreshCell(selR, selC);
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

  /* Flush safety net */
  window.addEventListener("beforeunload", function () {
    if (editing) commitEdit(0, 0);
    saveNow();
  });
}

/* SHELL SHORTCUT FORWARDING (Contract Β — verbatim, capture phase) */
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
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  buildGrid();
  selR = 0; selC = 0;
  renderGrid();
  renderSelection();
  console.log("[SS] boot COMPLETE");
  $("grid-wrap").focus();
}

boot();

})();