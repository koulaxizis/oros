/* ============================================================
   functions.js — orOS Spreadsheet formula engine + function library
   (OrosSheetFx). Pure: no DOM, no storage. Loaded before
   spreadsheet.js in the page and with require() in Node tests.

   Values: number · string · boolean · error (one of ERRORS, a
   string) · null (a blank cell). A range is an Array (row-major)
   carrying .rows / .cols (and .sid / .r0 / .c0 when it came from a
   reference), so lookups keep its 2-D shape. Blanks inside a range
   stay null (AVERAGE, COUNTA skip them, COUNTBLANK counts them); a
   formula that is just a blank reference shows 0.
   Dates are Excel serials: days since 1899-12-30 (UTC arithmetic,
   so no daylight-saving drift); the fraction is the time of day.
   Grammar (recursive descent, Excel precedence): comparison < & <
   + - < * / < ^ < unary minus < % ; refs A1, $A$1, A1:B5, A:A,
   Sheet!A1, 'My sheet'!A1:B2; strings "a""b" (and the older \" ).
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function (root) {
"use strict";

var ERR = { DIV0: "#DIV/0!", NA: "#N/A", NAME: "#NAME?", NUM: "#NUM!",
            REF: "#REF!", VALUE: "#VALUE!", CYC: "#CYC!", ERROR: "#ERROR!",
            NULL: "#NULL!" };
var ERRSET = {};
(function () { for (var k in ERR) ERRSET[ERR[k]] = 1; })();
function isErr(v) { return typeof v === "string" && ERRSET[v] === 1; }
function isArr(v) { return Array.isArray(v); }

/* a thrown error code: functions throw, the caller returns the code */
function Fx(code) { this.fx = code; }
function fail(code) { throw new Fx(code); }

var MAX_COLS = 104, MAX_ROWS = 10000;

function colName(n) {
  var s = ""; n += 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colFromName(s) {
  var n = 0; s = String(s).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 65 || c > 90) return -1;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* ===== dates ===== */
var EPOCH = Date.UTC(1899, 11, 30), DAY = 86400000;
function serialOf(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY); }
function partsOf(serial) {
  var dt = new Date(EPOCH + Math.floor(serial + 1e-9) * DAY);
  var frac = serial - Math.floor(serial + 1e-9);
  var secs = Math.round(frac * 86400);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
           wd: dt.getUTCDay(), hh: Math.floor(secs / 3600) % 24,
           mi: Math.floor(secs / 60) % 60, ss: secs % 60 };
}
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
/* local wall-clock "now" as a serial */
function nowSerial(ms) {
  var d = new Date(ms);
  return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) +
    (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}
/* 2026-10-14[ 09:30[:15]] or 14/10/2026 (day first; also 14.10.2026)
   -> serial, else null */
function parseDate(s) {
  s = String(s).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || y < 1900 || y > 9999) return null;
  var t = 0;
  if (m[4] !== undefined) {
    var hh = +m[4], mi = +m[5], ss = m[6] !== undefined ? +m[6] : 0;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    t = (hh * 3600 + mi * 60 + ss) / 86400;
  }
  return serialOf(y, mo, d) + t;
}

var MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  el: ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"]
};
var MONTHS3 = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  el: ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"]
};
var WDAYS = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
};
var WDAYS3 = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  el: ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"]
};
function pad2(n) { return (n < 10 ? "0" : "") + n; }

/* the date number format of the cells ("d"): EN 2026-10-14, EL 14/10/2026 */
function dateStr(serial, lang, withTime) {
  if (typeof serial !== "number" || !isFinite(serial) || serial < 1 || serial > 2958465) return null;
  var p = partsOf(serial);
  var s = lang === "el" ? pad2(p.d) + "/" + pad2(p.m) + "/" + p.y
                        : p.y + "-" + pad2(p.m) + "-" + pad2(p.d);
  if (withTime) s += " " + pad2(p.hh) + ":" + pad2(p.mi);
  return s;
}

/* ===== conversions ===== */
var NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function numStr(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(15)));
}
function scalar(v) { return isArr(v) ? (v.length ? v[0] : null) : v; }
/* text -> number (Excel's coercion): plain numbers, 5%, dates */
function textNum(s) {
  var t = String(s).trim();
  if (NUM_RE.test(t)) return parseFloat(t);
  var m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*%$/);
  if (m) return parseFloat(m[1]) / 100;
  var d = parseDate(t);
  return d === null ? null : d;
}
function toNum(v) {
  v = scalar(v);
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isErr(v)) fail(v);
  var n = textNum(v);
  if (n === null) fail(ERR.VALUE);
  return n;
}
function toStr(v) {
  v = scalar(v);
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return numStr(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isErr(v)) fail(v);
  return String(v);
}
function toBool(v) {
  v = scalar(v);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null || v === undefined || v === "") return false;
  if (isErr(v)) fail(v);
  var u = String(v).toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  fail(ERR.VALUE);
}
function toInt(v) { return Math.trunc(toNum(v)); }

/* a typed (non-formula) cell -> value */
function literal(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (raw.charAt(0) === "'") return raw.slice(1);
  var t = raw.trim();
  if (NUM_RE.test(t)) return parseFloat(t);
  var u = t.toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  if (ERRSET[u]) return u;
  return raw;
}

function mkArr(vals, rows, cols) { vals.rows = rows; vals.cols = cols; return vals; }
function dims(a) {
  if (!isArr(a)) return { rows: 1, cols: 1 };
  return { rows: a.rows || (a.length ? 1 : 0), cols: a.cols || a.length };
}

/* Excel ordering: numbers < text < booleans; text without case */
function typeRank(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return 1;
  if (typeof v === "string") return 2;
  return 3;
}
function cmpVals(a, b) {
  if (a === null || a === undefined) a = (typeof b === "string") ? "" : (typeof b === "boolean" ? false : 0);
  if (b === null || b === undefined) b = (typeof a === "string") ? "" : (typeof a === "boolean" ? false : 0);
  var ta = typeRank(a), tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  if (ta === 1) return a < b ? -1 : (a > b ? 1 : 0);
  if (ta === 3) return (a ? 1 : 0) - (b ? 1 : 0);
  var x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : (x > y ? 1 : 0);
}

/* ===== tokenizer ===== */
var T = { NUM: 1, STR: 2, OP: 3, REF: 4, FUNC: 5, SEP: 6, LP: 7, RP: 8, ERR: 9, BOOL: 10, NAME: 11, BAD: 12, LB: 13, RB: 14 };
var OPS2 = { "<>": 1, "<=": 1, ">=": 1 };
var OPS1 = { "+": 1, "-": 1, "*": 1, "/": 1, "^": 1, "&": 1, "=": 1, "<": 1, ">": 1, "%": 1 };
var ERR_LIT = /^#(DIV\/0!|N\/A|NAME\?|NUM!|REF!|VALUE!|NULL!)/i;
var SHEET_Q = /^\x27((?:[^\x27]|\x27\x27)+)\x27!/;
var SHEET_U = /^([^\s\x27!:(),;+\-*\/^&<>=%\x22{}\[\]]+)!/;
var CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)(?::(\$?)([A-Za-z]{1,3})(\$?)([0-9]+))?(?![A-Za-z0-9_.(])/;
var COLS_RE = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/;
var IDENT_RE = /^[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_.Ͱ-Ͽ]*/;

function tokenize(formula) {
  var s = String(formula), out = [], i = 0;
  if (s.charAt(0) === "=") i = 1;
  while (i < s.length) {
    var ch = s.charAt(i), rest, m, st = i;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      var str = "", j = i + 1, closed = false;
      while (j < s.length) {
        var cj = s.charAt(j);
        if (cj === '"') {
          if (s.charAt(j + 1) === '"') { str += '"'; j += 2; continue; }
          closed = true; j++; break;
        }
        /* the older escape (Wave 3 paste output): \" and \\ */
        if (cj === "\\" && (s.charAt(j + 1) === '"' || s.charAt(j + 1) === "\\")) { str += s.charAt(j + 1); j += 2; continue; }
        str += cj; j++;
      }
      out.push({ t: closed ? T.STR : T.BAD, v: str, s: st, e: j });
      i = j; continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s.charAt(i + 1)))) {
      rest = s.slice(i);
      m = rest.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      /* a number glued to letters is not a number (e.g. 1A) */
      out.push({ t: T.NUM, v: parseFloat(m[0]), s: st, e: i + m[0].length });
      i += m[0].length; continue;
    }
    if (ch === "#") {
      m = s.slice(i).match(ERR_LIT);
      if (m) { out.push({ t: T.ERR, v: m[0].toUpperCase(), s: st, e: i + m[0].length }); i += m[0].length; continue; }
      out.push({ t: T.BAD, v: ch, s: st, e: i + 1 }); i++; continue;
    }
    var two = s.substr(i, 2);
    if (OPS2[two]) { out.push({ t: T.OP, v: two, s: st, e: i + 2 }); i += 2; continue; }
    if (OPS1[ch]) { out.push({ t: T.OP, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === "(") { out.push({ t: T.LP, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === "{") { out.push({ t: T.LB, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === "}") { out.push({ t: T.RB, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === ")") { out.push({ t: T.RP, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === "," || ch === ";") { out.push({ t: T.SEP, v: ch, s: st, e: i + 1 }); i++; continue; }

    rest = s.slice(i);
    var sheet = null, sheetRaw = "", p = i;
    m = rest.match(SHEET_Q) || rest.match(SHEET_U);
    if (m) {
      sheet = m[0].charAt(0) === "'" ? m[1].replace(/\x27\x27/g, "'") : m[1];
      sheetRaw = m[0];
      p = i + m[0].length;
      rest = s.slice(p);
    }
    m = rest.match(CELL_RE);
    if (m) {
      var a = { c: colFromName(m[2]), r: parseInt(m[4], 10) - 1, ac: !!m[1], ar: !!m[3] };
      var b = m[6] ? { c: colFromName(m[6]), r: parseInt(m[8], 10) - 1, ac: !!m[5], ar: !!m[7] } : null;
      if (a.r >= 0 && (!b || b.r >= 0)) {
        out.push({ t: T.REF, v: m[0], s: st, e: p + m[0].length,
                   ref: { sheet: sheet, sheetRaw: sheetRaw, a: a, b: b, cols: false } });
        i = p + m[0].length; continue;
      }
    }
    m = rest.match(COLS_RE);
    if (m) {
      out.push({ t: T.REF, v: m[0], s: st, e: p + m[0].length,
                 ref: { sheet: sheet, sheetRaw: sheetRaw, cols: true,
                        a: { c: colFromName(m[2]), r: 0, ac: !!m[1], ar: true },
                        b: { c: colFromName(m[4]), r: MAX_ROWS - 1, ac: !!m[3], ar: true } } });
      i = p + m[0].length; continue;
    }
    if (sheet !== null) {
      var me = rest.match(ERR_LIT), ln = me ? me[0].length : 0;
      out.push({ t: T.ERR, v: me ? me[0].toUpperCase() : ERR.REF, s: st, e: p + ln });
      i = p + ln; continue;
    }
    m = rest.match(IDENT_RE);
    if (m) {
      var id = m[0], up = id.toUpperCase(), q = i + id.length;
      while (q < s.length && /\s/.test(s.charAt(q))) q++;
      if (s.charAt(q) === "(") {
        out.push({ t: T.FUNC, v: up.replace(/^_XLFN\./, "").replace(/^_XLWS\./, ""), s: st, e: i + id.length });
      } else if (up === "TRUE" || up === "FALSE") {
        out.push({ t: T.BOOL, v: up === "TRUE", s: st, e: i + id.length });
      } else {
        out.push({ t: T.NAME, v: id, s: st, e: i + id.length });
      }
      i += id.length; continue;
    }
    out.push({ t: T.BAD, v: ch, s: st, e: i + 1 }); i++;
  }
  return out;
}

/* ===== parser -> AST ===== */
var CMP = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1 };
function parse(formula) {
  var tk = tokenize(formula), i = 0;
  function peek() { return tk[i]; }
  function isOp(v) { var x = tk[i]; return x && x.t === T.OP && (typeof v === "string" ? x.v === v : v[x.v]); }
  function bad() { throw new Fx(ERR.ERROR); }
  function binary(next, ops) {
    return function () {
      var a = next();
      while (isOp(ops)) { var op = tk[i++].v; a = { k: "op", op: op, a: a, b: next() }; }
      return a;
    };
  }
  var expr, unary;
  function primary() {
    var x = tk[i++];
    if (!x) bad();
    switch (x.t) {
      case T.NUM: return { k: "v", v: x.v };
      case T.STR: return { k: "v", v: x.v };
      case T.BOOL: return { k: "v", v: x.v };
      case T.ERR: return { k: "v", v: x.v };
      case T.NAME: return { k: "v", v: ERR.NAME };
      case T.REF: return { k: "ref", ref: x.ref };
      case T.LP: { var e = expr(); if (!tk[i] || tk[i].t !== T.RP) bad(); i++; return e; }
      case T.LB: return arrayConst();
      case T.FUNC: {
        if (!tk[i] || tk[i].t !== T.LP) bad();
        i++;
        var args = [];
        if (tk[i] && tk[i].t === T.RP) { i++; return { k: "fn", name: x.v, args: args }; }
        for (;;) {
          var y = tk[i];
          if (!y) bad();
          if (y.t === T.SEP || y.t === T.RP) args.push({ k: "empty" });
          else args.push(expr());
          y = tk[i];
          if (!y) bad();
          if (y.t === T.SEP) { i++; continue; }
          if (y.t === T.RP) { i++; break; }
          bad();
        }
        return { k: "fn", name: x.v, args: args };
      }
    }
    bad();
  }
  /* {1,2;3,4}: a comma moves to the next column, a semicolon to the
     next row; items are numbers (a leading minus allowed), texts,
     TRUE/FALSE or error literals */
  function arrayConst() {
    var rows = [[]];
    for (;;) {
      var x = tk[i++], neg = false;
      if (x && x.t === T.OP && (x.v === "-" || x.v === "+")) { neg = x.v === "-"; x = tk[i++]; if (!x || x.t !== T.NUM) bad(); }
      if (!x || [T.NUM, T.STR, T.BOOL, T.ERR].indexOf(x.t) < 0) bad();
      rows[rows.length - 1].push(neg ? -x.v : x.v);
      var y = tk[i++];
      if (!y) bad();
      if (y.t === T.RB) break;
      if (y.t !== T.SEP) bad();
      if (y.v === ";") rows.push([]);
    }
    var w = rows[0].length, vals = [];
    for (var k = 0; k < rows.length; k++) { if (rows[k].length !== w) bad(); vals = vals.concat(rows[k]); }
    return { k: "arr", v: vals, rows: rows.length, cols: w };
  }
  function postfix() {
    var a = primary();
    while (isOp("%")) { i++; a = { k: "pct", a: a }; }
    return a;
  }
  unary = function () {
    if (isOp("-")) { i++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    return postfix();
  };
  var pow = binary(unary, { "^": 1 });
  var mul = binary(pow, { "*": 1, "/": 1 });
  var add = binary(mul, { "+": 1, "-": 1 });
  var cat = binary(add, { "&": 1 });
  expr = binary(cat, CMP);
  if (!tk.length) bad();
  var node = expr();
  if (i < tk.length) bad();
  return node;
}

/* ===== criteria ("<5", "<>x", "a*", 7, TRUE) ===== */
function wildRe(pat) {
  var re = "", i, ch;
  for (i = 0; i < pat.length; i++) {
    ch = pat.charAt(i);
    if (ch === "~" && i + 1 < pat.length && /[*?~]/.test(pat.charAt(i + 1))) { re += "\\" + pat.charAt(++i); continue; }
    if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i");
}
function hasWild(s) { return /[*?]/.test(s.replace(/~[*?~]/g, "")); }

function criteria(crit) {
  crit = scalar(crit);
  if (isErr(crit)) fail(crit);
  if (crit === null || crit === undefined) crit = "";
  if (typeof crit === "number" || typeof crit === "boolean") {
    return function (v) { return v === crit; };
  }
  var s = String(crit), op = "=";
  var m = s.match(/^(<=|>=|<>|<|>|=)/);
  if (m) { op = m[1]; s = s.slice(m[1].length); }
  var n = s.trim() === "" ? null : textNum(s);
  var u = s.toUpperCase();
  if (s === "") {
    if (op === "=") return function (v) { return v === null || v === ""; };
    if (op === "<>") return function (v) { return !(v === null || v === ""); };
    return function () { return false; };
  }
  if (op === "=" || op === "<>") {
    var eq;
    if (n !== null) eq = function (v) { return typeof v === "number" ? Math.abs(v - n) < 1e-12 : (typeof v === "string" && textNum(v) === n); };
    else if (u === "TRUE" || u === "FALSE") eq = function (v) { return typeof v === "boolean" ? v === (u === "TRUE") : (typeof v === "string" && v.toUpperCase() === u); };
    else if (hasWild(s)) { var re = wildRe(s); eq = function (v) { return typeof v === "string" && re.test(v); }; }
    else { var lo = s.toLowerCase().replace(/~([*?~])/g, "$1"); eq = function (v) { return typeof v === "string" && v.toLowerCase() === lo; }; }
    return op === "=" ? eq : function (v) { return !eq(v); };
  }
  var test = function (c) {
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  };
  if (n !== null) return function (v) { return typeof v === "number" && test(v - n); };
  var ls = s.toLowerCase();
  return function (v) {
    if (typeof v !== "string") return false;
    var x = v.toLowerCase();
    return test(x < ls ? -1 : (x > ls ? 1 : 0));
  };
}

/* ===== number format patterns (TEXT and friends) ===== */
function groupThousands(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function formatNumber(n, pat) {
  var sections = splitSections(pat);
  var sec = sections[0];
  if (n < 0 && sections.length > 1 && sections[1] !== "") { sec = sections[1]; n = -n; }
  else if (n === 0 && sections.length > 2) sec = sections[2];
  var core, before, after;
  /* split literal text around the numeric core */
  var cm = sec.replace(/\x22[^\x22]*\x22/g, function (q) { return new Array(q.length + 1).join("\u0001"); })
    .match(/[#0?][#0?,]*(\.[#0?]*)?|\.[#0?]+/);
  if (!cm) return unquoteLit(sec);
  core = cm[0];
  before = unquoteLit(sec.slice(0, cm.index));
  after = unquoteLit(sec.slice(cm.index + core.length));
  var pct = (before + after).indexOf("%") >= 0 ? (before + after).split("%").length - 1 : 0;
  var x = n * Math.pow(100, pct);
  var dot = core.indexOf(".");
  var ip = dot >= 0 ? core.slice(0, dot) : core, dp = dot >= 0 ? core.slice(dot + 1) : "";
  var thou = ip.indexOf(",") >= 0;
  /* trailing commas scale by 1000 */
  var mScale = ip.match(/,+$/);
  if (mScale) { x = x / Math.pow(1000, mScale[0].length); thou = ip.replace(/,+$/, "").indexOf(",") >= 0; }
  var minInt = (ip.match(/0/g) || []).length;
  var fixed = dp.length, req = (dp.match(/0/g) || []).length;
  var neg = x < 0; x = Math.abs(x);
  var str = roundHalfAway(x, fixed).toFixed(fixed);
  var parts = str.split(".");
  var ints = parts[0], decs = parts[1] || "";
  /* optional (#) decimals drop trailing zeros down to the required ones */
  while (decs.length > req && decs.charAt(decs.length - 1) === "0") decs = decs.slice(0, -1);
  if (minInt === 0 && ints === "0") ints = "";
  while (ints.length < minInt) ints = "0" + ints;
  if (thou) ints = groupThousands(ints);
  var body = ints + (decs ? "." + decs : "");
  if (body === "") body = "0";
  return (neg && sections.length < 2 ? "-" : "") + before + body + after;
}
function splitSections(pat) {
  var out = [], cur = "", inQ = false;
  for (var i = 0; i < pat.length; i++) {
    var ch = pat.charAt(i);
    if (ch === '"') inQ = !inQ;
    if (ch === ";" && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function unquoteLit(s) { return s.replace(/\x22([^\x22]*)\x22/g, "$1").replace(/\\(.)/g, "$1"); }
function roundHalfAway(x, d) {
  var f = Math.pow(10, d), y = Number((Math.abs(x) * f).toPrecision(15));
  return (x < 0 ? -1 : 1) * Math.round(y) / f;
}
function isDatePattern(p) {
  var q = p.replace(/\x22[^\x22]*\x22/g, "");
  return /[dy]/i.test(q) || (/m/i.test(q) && !/[0#]/.test(q)) || /h/i.test(q);
}
function formatDate(serial, pat, lang) {
  var L = lang === "el" ? "el" : "en";
  var p = partsOf(serial), ampm = /am\/pm/i.test(pat), toks = [], i = 0, m;
  while (i < pat.length) {
    var rest = pat.slice(i), ch = pat.charAt(i);
    if (ch === '"') { var j = pat.indexOf('"', i + 1); if (j < 0) j = pat.length; toks.push({ lit: pat.slice(i + 1, j) }); i = j + 1; continue; }
    if (ch === "\\" && i + 1 < pat.length) { toks.push({ lit: pat.charAt(i + 1) }); i += 2; continue; }
    if (/^am\/pm/i.test(rest)) { toks.push({ lit: p.hh < 12 ? "AM" : "PM" }); i += 5; continue; }
    m = rest.match(/^([yY]+|[mM]+|[dD]+|[hH]+|[sS]+)/);
    if (m) { toks.push({ k: m[0].charAt(0).toLowerCase(), n: m[0].length }); i += m[0].length; continue; }
    toks.push({ lit: ch }); i++;
  }
  /* m / mm right after an hour or right before seconds = minutes */
  var prev = null, out = "";
  for (i = 0; i < toks.length; i++) {
    var tk = toks[i];
    if (tk.lit !== undefined) { out += tk.lit; continue; }
    var n = tk.n, k = tk.k;
    if (k === "m") {
      var next = null;
      for (var q = i + 1; q < toks.length; q++) if (toks[q].k) { next = toks[q].k; break; }
      if (n <= 2 && (prev === "h" || next === "s")) k = "M";
    }
    switch (k) {
      case "y": out += n <= 2 ? pad2(p.y % 100) : String(p.y); break;
      case "d": out += n === 1 ? p.d : n === 2 ? pad2(p.d) : n === 3 ? WDAYS3[L][p.wd] : WDAYS[L][p.wd]; break;
      case "h": { var h = ampm ? ((p.hh + 11) % 12) + 1 : p.hh; out += n === 1 ? h : pad2(h); break; }
      case "M": out += n === 1 ? p.mi : pad2(p.mi); break;
      case "s": out += n === 1 ? p.ss : pad2(p.ss); break;
      default: out += n === 1 ? p.m : n === 2 ? pad2(p.m) : n === 3 ? MONTHS3[L][p.m - 1] : MONTHS[L][p.m - 1];
    }
    prev = k === "M" ? "m" : k;
  }
  return out;
}
function textFormat(v, pat, lang) {
  pat = String(pat);
  v = scalar(v);
  if (isErr(v)) fail(v);
  var up = pat.toUpperCase();
  if (up === "" ) return "";
  if (up === "GENERAL" || up === "@") return toStr(v);
  var n;
  if (typeof v === "number") n = v;
  else if (typeof v === "boolean") return toStr(v);
  else if (v === null) n = 0;
  else { n = textNum(v); if (n === null) return String(v); }
  if (isDatePattern(pat)) {
    if (n < 0) fail(ERR.VALUE);
    return formatDate(n, pat, lang);
  }
  return formatNumber(n, pat);
}

/* ===== helpers for functions ===== */
function eachVal(args, fn) {
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (isArr(a)) { for (var j = 0; j < a.length; j++) fn(a[j], true); }
    else if (a !== undefined) fn(a, false);
  }
}
/* SUM-style numbers: in ranges only numbers count (errors stop);
   direct arguments are coerced (TRUE = 1, "3" = 3) */
function numbers(args) {
  var out = [];
  eachVal(args, function (v, inRange) {
    if (isErr(v)) fail(v);
    if (typeof v === "number") out.push(v);
    else if (!inRange && v !== null) out.push(toNum(v));
  });
  return out;
}
function flat(args) { var out = []; eachVal(args, function (v) { out.push(v); }); return out; }
function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
function argOr(args, i, d) { return (args[i] === undefined) ? d : args[i]; }
function arr2(v) { /* any value -> range-like array */
  if (isArr(v)) return v;
  return mkArr([v], 1, 1);
}
function at(a, r, c) { var d = dims(a); return (r < d.rows && c < d.cols) ? a[r * d.cols + c] : undefined; }
function isBlank(v) { return v === null || v === undefined; }
function valEq(a, b) {
  if (isBlank(a)) a = "";
  if (isBlank(b)) b = "";
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-12 * Math.max(1, Math.abs(a));
  return a === b;
}
function sortedNums(args) { return numbers(args).sort(function (x, y) { return x - y; }); }
function variance(args, sample) {
  var a = numbers(args), n = a.length;
  if (n < (sample ? 2 : 1)) fail(ERR.DIV0);
  var m = sum(a) / n, s = 0;
  for (var i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
  return s / (sample ? n - 1 : n);
}
/* pairs (range, criteria) -> mask of matching positions */
function ifsMask(pairs, size) {
  var mask = [], i, k;
  for (i = 0; i < size; i++) mask.push(true);
  for (k = 0; k + 1 < pairs.length; k += 2) {
    var rng = arr2(pairs[k]), pred = criteria(pairs[k + 1]);
    for (i = 0; i < size; i++) if (mask[i] && !pred(rng[i] === undefined ? null : rng[i])) mask[i] = false;
  }
  return mask;
}
/* value at the same (row, col) of `other` as position i of `base` */
function samePos(base, other, i) {
  var bd = dims(base), od = dims(other);
  var r = Math.floor(i / bd.cols), c = i % bd.cols;
  return (r < od.rows && c < od.cols) ? other[r * od.cols + c] : null;
}
function vector(a) { /* a 1-D range: its values in order; 2-D -> error */
  a = arr2(a);
  var d = dims(a);
  if (d.rows > 1 && d.cols > 1) fail(ERR.NA);
  return a;
}
/* position of v in vector vec. mode 0 exact (wildcards for text),
   1 largest <= v, -1 smallest >= v, 2 wildcard; dir -1 searches back */
function lookupPos(v, vec, mode, dir) {
  v = scalar(v);
  if (isErr(v)) fail(v);
  var n = vec.length, i, best = -1, re = null;
  if ((mode === 0 || mode === 2) && typeof v === "string" && (mode === 2 || hasWild(v))) re = wildRe(v);
  var start = dir === -1 ? n - 1 : 0, step = dir === -1 ? -1 : 1;
  if (mode === 0 || mode === 2) {
    for (i = start; i >= 0 && i < n; i += step) {
      var x = vec[i];
      if (re ? (typeof x === "string" && re.test(x)) : valEq(x, v) && !isBlank(x)) return i;
    }
    return -1;
  }
  for (i = 0; i < n; i++) {
    var y = vec[i];
    if (isBlank(y) || typeRank(y) !== typeRank(v)) continue;
    var c = cmpVals(y, v);
    if (mode === 1 && c <= 0 && (best < 0 || cmpVals(y, vec[best]) >= 0)) best = i;
    if (mode === -1 && c >= 0 && (best < 0 || cmpVals(y, vec[best]) < 0)) best = i;
  }
  return best;
}
function rowOf(a, r) { var d = dims(a), o = []; for (var c = 0; c < d.cols; c++) o.push(a[r * d.cols + c]); return mkArr(o, 1, d.cols); }
function colOf(a, c) { var d = dims(a), o = []; for (var r = 0; r < d.rows; r++) o.push(a[r * d.cols + c]); return mkArr(o, d.rows, 1); }

function datePartsArg(v) { var n = toNum(v); if (n < 0) fail(ERR.NUM); return partsOf(n); }
function ymdSerial(y, m, d) {
  /* DATE(): months and days overflow like Excel's (13 -> next year) */
  if (y >= 0 && y < 1900) y += 1900;
  var ms = Date.UTC(y, m - 1, 1) + (d - 1) * DAY;
  return Math.round((ms - EPOCH) / DAY);
}
function addMonths(serial, months, endOfMonth) {
  var p = partsOf(serial), y = p.y, m = p.m + months;
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  var dim = daysInMonth(y, m);
  return serialOf(y, m, endOfMonth ? dim : Math.min(p.d, dim));
}

/* ===== the function table =====
   F[name] = { f(args, cx), min, max }   args are evaluated values;
   a reference argument arrives as a range array (1x1 for one cell).
   L[name] = { f(nodes, cx, ev), min, max }   lazy: gets the nodes. */
var F = {}, L = {};
function def(names, min, max, f) { names.split(" ").forEach(function (n) { F[n] = { f: f, min: min, max: max }; }); }
function lazy(names, min, max, f) { names.split(" ").forEach(function (n) { L[n] = { f: f, min: min, max: max }; }); }
var INF = 255;

/* ---- maths ---- */
def("SUM", 1, INF, function (a) { return sum(numbers(a)); });
def("AVERAGE AVG", 1, INF, function (a) { var n = numbers(a); if (!n.length) fail(ERR.DIV0); return sum(n) / n.length; });
def("MIN", 1, INF, function (a) { var n = numbers(a); return n.length ? Math.min.apply(null, n) : 0; });
def("MAX", 1, INF, function (a) { var n = numbers(a); return n.length ? Math.max.apply(null, n) : 0; });
def("COUNT", 1, INF, function (a) {
  var c = 0;
  eachVal(a, function (v, inR) { if (typeof v === "number" || (!inR && v !== null && !isErr(v) && (typeof v === "boolean" || textNum(v) !== null))) c++; });
  return c;
});
def("COUNTA", 1, INF, function (a) { var c = 0; eachVal(a, function (v) { if (!isBlank(v)) c++; }); return c; });
def("COUNTBLANK", 1, 1, function (a) { var c = 0; eachVal(a, function (v) { if (isBlank(v) || v === "") c++; }); return c; });
def("PRODUCT", 1, INF, function (a) { var n = numbers(a), p = 1; for (var i = 0; i < n.length; i++) p *= n[i]; return n.length ? p : 0; });
def("SUMSQ", 1, INF, function (a) { var n = numbers(a), s = 0; for (var i = 0; i < n.length; i++) s += n[i] * n[i]; return s; });
def("SUMPRODUCT", 1, INF, function (a) {
  var size = isArr(a[0]) ? a[0].length : 1, s = 0, i, k;
  for (k = 0; k < a.length; k++) if ((isArr(a[k]) ? a[k].length : 1) !== size) fail(ERR.VALUE);
  for (i = 0; i < size; i++) {
    var p = 1;
    for (k = 0; k < a.length; k++) {
      var v = isArr(a[k]) ? a[k][i] : a[k];
      if (isErr(v)) fail(v);
      p *= typeof v === "number" ? v : 0;
    }
    s += p;
  }
  return s;
});
def("ROUND", 1, 2, function (a) { var n = toNum(a[0]), d = toInt(argOr(a, 1, 0)); return roundHalfAway(n, d); });
def("ROUNDUP", 1, 2, function (a) {
  var n = toNum(a[0]), d = toInt(argOr(a, 1, 0)), f = Math.pow(10, d);
  var y = Number((Math.abs(n) * f).toPrecision(15));
  return (n < 0 ? -1 : 1) * Math.ceil(y) / f;
});
def("ROUNDDOWN TRUNC", 1, 2, function (a) {
  var n = toNum(a[0]), d = toInt(argOr(a, 1, 0)), f = Math.pow(10, d);
  var y = Number((Math.abs(n) * f).toPrecision(15));
  return (n < 0 ? -1 : 1) * Math.floor(y) / f;
});
def("INT", 1, 1, function (a) { return Math.floor(toNum(a[0])); });
def("ABS", 1, 1, function (a) { return Math.abs(toNum(a[0])); });
def("SIGN", 1, 1, function (a) { var n = toNum(a[0]); return n > 0 ? 1 : (n < 0 ? -1 : 0); });
def("MOD", 2, 2, function (a) {
  var n = toNum(a[0]), d = toNum(a[1]);
  if (d === 0) fail(ERR.DIV0);
  return Number((n - d * Math.floor(n / d)).toPrecision(15));
});
def("POWER", 2, 2, function (a) { var r = Math.pow(toNum(a[0]), toNum(a[1])); if (!isFinite(r) || isNaN(r)) fail(ERR.NUM); return r; });
def("SQRT", 1, 1, function (a) { var n = toNum(a[0]); if (n < 0) fail(ERR.NUM); return Math.sqrt(n); });
def("EXP", 1, 1, function (a) { return Math.exp(toNum(a[0])); });
def("LN", 1, 1, function (a) { var n = toNum(a[0]); if (n <= 0) fail(ERR.NUM); return Math.log(n); });
def("LOG", 1, 2, function (a) {
  var n = toNum(a[0]), b = toNum(argOr(a, 1, 10));
  if (n <= 0 || b <= 0 || b === 1) fail(ERR.NUM);
  return Math.log(n) / Math.log(b);
});
def("LOG10", 1, 1, function (a) { var n = toNum(a[0]); if (n <= 0) fail(ERR.NUM); return Math.log(n) / Math.LN10; });
def("CEILING", 1, 2, function (a) { var n = toNum(a[0]), s = toNum(argOr(a, 1, 1)); if (s === 0) return 0; return Math.ceil(Number((n / s).toPrecision(15))) * s; });
def("FLOOR", 1, 2, function (a) { var n = toNum(a[0]), s = toNum(argOr(a, 1, 1)); if (s === 0) fail(ERR.DIV0); return Math.floor(Number((n / s).toPrecision(15))) * s; });
def("PI", 0, 0, function () { return Math.PI; });
def("RAND", 0, 0, function () { return Math.random(); });
def("RANDBETWEEN", 2, 2, function (a) {
  var lo = Math.ceil(toNum(a[0])), hi = Math.floor(toNum(a[1]));
  if (hi < lo) fail(ERR.NUM);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
});

/* ---- statistics ---- */
def("MEDIAN", 1, INF, function (a) {
  var n = sortedNums(a), k = n.length;
  if (!k) fail(ERR.NUM);
  return k % 2 ? n[(k - 1) / 2] : (n[k / 2 - 1] + n[k / 2]) / 2;
});
def("MODE MODE.SNGL", 1, INF, function (a) {
  var n = numbers(a), cnt = {}, best = null, bc = 1, i;
  for (i = 0; i < n.length; i++) {
    var c = (cnt[n[i]] = (cnt[n[i]] || 0) + 1);
    if (c > bc) { bc = c; best = n[i]; }
  }
  if (best === null) fail(ERR.NA);
  /* ties: the value seen first */
  for (i = 0; i < n.length; i++) if (cnt[n[i]] === bc) return n[i];
  return best;
});
def("STDEV STDEV.S", 1, INF, function (a) { return Math.sqrt(variance(a, true)); });
def("STDEVP STDEV.P", 1, INF, function (a) { return Math.sqrt(variance(a, false)); });
def("VAR VAR.S", 1, INF, function (a) { return variance(a, true); });
def("VARP VAR.P", 1, INF, function (a) { return variance(a, false); });
def("LARGE", 2, 2, function (a) {
  var n = sortedNums([a[0]]), k = toInt(a[1]);
  if (k < 1 || k > n.length) fail(ERR.NUM);
  return n[n.length - k];
});
def("SMALL", 2, 2, function (a) {
  var n = sortedNums([a[0]]), k = toInt(a[1]);
  if (k < 1 || k > n.length) fail(ERR.NUM);
  return n[k - 1];
});
def("RANK RANK.EQ", 2, 3, function (a) {
  var x = toNum(a[0]), n = numbers([a[1]]), asc = toNum(argOr(a, 2, 0)) !== 0, r = 1, found = false;
  for (var i = 0; i < n.length; i++) {
    if (n[i] === x) found = true;
    else if (asc ? n[i] < x : n[i] > x) r++;
  }
  if (!found) fail(ERR.NA);
  return r;
});
def("PERCENTILE PERCENTILE.INC", 2, 2, function (a) {
  var n = sortedNums([a[0]]), p = toNum(a[1]);
  if (!n.length || p < 0 || p > 1) fail(ERR.NUM);
  var h = (n.length - 1) * p, lo = Math.floor(h);
  return lo + 1 < n.length ? n[lo] + (h - lo) * (n[lo + 1] - n[lo]) : n[lo];
});
def("QUARTILE QUARTILE.INC", 2, 2, function (a) {
  var q = toInt(a[1]);
  if (q < 0 || q > 4) fail(ERR.NUM);
  return F.PERCENTILE.f([a[0], q / 4]);
});

/* ---- conditional aggregates ---- */
def("SUMIF", 2, 3, function (a) {
  var rng = arr2(a[0]), pred = criteria(a[1]), sr = a[2] === undefined ? rng : arr2(a[2]), s = 0;
  for (var i = 0; i < rng.length; i++) if (pred(rng[i])) {
    var v = samePos(rng, sr, i);
    if (isErr(v)) fail(v);
    if (typeof v === "number") s += v;
  }
  return s;
});
def("SUMIFS", 3, INF, function (a) {
  var sr = arr2(a[0]), mask = ifsMask(a.slice(1), sr.length), s = 0;
  if (a.length % 2 === 0) fail(ERR.VALUE);
  for (var i = 0; i < sr.length; i++) if (mask[i]) { if (isErr(sr[i])) fail(sr[i]); if (typeof sr[i] === "number") s += sr[i]; }
  return s;
});
def("COUNTIF", 2, 2, function (a) {
  var rng = arr2(a[0]), pred = criteria(a[1]), c = 0;
  for (var i = 0; i < rng.length; i++) if (pred(rng[i])) c++;
  return c;
});
def("COUNTIFS", 2, INF, function (a) {
  if (a.length % 2) fail(ERR.VALUE);
  var size = arr2(a[0]).length, mask = ifsMask(a, size), c = 0;
  for (var i = 0; i < size; i++) if (mask[i]) c++;
  return c;
});
def("AVERAGEIF", 2, 3, function (a) {
  var rng = arr2(a[0]), pred = criteria(a[1]), ar = a[2] === undefined ? rng : arr2(a[2]), s = 0, n = 0;
  for (var i = 0; i < rng.length; i++) if (pred(rng[i])) {
    var v = samePos(rng, ar, i);
    if (isErr(v)) fail(v);
    if (typeof v === "number") { s += v; n++; }
  }
  if (!n) fail(ERR.DIV0);
  return s / n;
});
def("AVERAGEIFS", 3, INF, function (a) {
  if (a.length % 2 === 0) fail(ERR.VALUE);
  var ar = arr2(a[0]), mask = ifsMask(a.slice(1), ar.length), s = 0, n = 0;
  for (var i = 0; i < ar.length; i++) if (mask[i] && typeof ar[i] === "number") { s += ar[i]; n++; }
  if (!n) fail(ERR.DIV0);
  return s / n;
});
def("MAXIFS", 3, INF, function (a) {
  var ar = arr2(a[0]), mask = ifsMask(a.slice(1), ar.length), m = null;
  for (var i = 0; i < ar.length; i++) if (mask[i] && typeof ar[i] === "number" && (m === null || ar[i] > m)) m = ar[i];
  return m === null ? 0 : m;
});
def("MINIFS", 3, INF, function (a) {
  var ar = arr2(a[0]), mask = ifsMask(a.slice(1), ar.length), m = null;
  for (var i = 0; i < ar.length; i++) if (mask[i] && typeof ar[i] === "number" && (m === null || ar[i] < m)) m = ar[i];
  return m === null ? 0 : m;
});

/* ---- lookup ---- */
def("VLOOKUP", 3, 4, function (a) {
  var tb = arr2(a[1]), d = dims(tb), col = toInt(a[2]), approx = a[3] === undefined ? true : toBool(a[3]);
  if (col < 1) fail(ERR.VALUE);
  if (col > d.cols) fail(ERR.REF);
  var i = lookupPos(a[0], colOf(tb, 0), approx ? 1 : 0, 1);
  if (i < 0) fail(ERR.NA);
  return at(tb, i, col - 1);
});
def("HLOOKUP", 3, 4, function (a) {
  var tb = arr2(a[1]), d = dims(tb), row = toInt(a[2]), approx = a[3] === undefined ? true : toBool(a[3]);
  if (row < 1) fail(ERR.VALUE);
  if (row > d.rows) fail(ERR.REF);
  var i = lookupPos(a[0], rowOf(tb, 0), approx ? 1 : 0, 1);
  if (i < 0) fail(ERR.NA);
  return at(tb, row - 1, i);
});
def("MATCH", 2, 3, function (a) {
  var t = a[2] === undefined ? 1 : toInt(a[2]);
  var i = lookupPos(a[0], vector(a[1]), t > 0 ? 1 : (t < 0 ? -1 : 0), 1);
  if (i < 0) fail(ERR.NA);
  return i + 1;
});
def("INDEX", 2, 3, function (a) {
  var tb = arr2(a[0]), d = dims(tb), r = toInt(a[1]), c = a[2] === undefined ? null : toInt(a[2]);
  if (r < 0 || (c !== null && c < 0)) fail(ERR.VALUE);
  if (c === null) {
    if (d.rows === 1) { c = r; r = 1; }
    else if (d.cols === 1) c = 1;
    else if (r === 0) fail(ERR.REF);
    else return rowOf(tb, r - 1);
  }
  if (r > d.rows || c > d.cols) fail(ERR.REF);
  if (r === 0 && c === 0) return tb;
  if (r === 0) return colOf(tb, c - 1);
  if (c === 0) return rowOf(tb, r - 1);
  var v = at(tb, r - 1, c - 1);
  return v === undefined ? null : v;
});
def("XLOOKUP", 3, 6, function (a) {
  var lk = vector(a[1]), ret = arr2(a[2]), ld = dims(lk), rd = dims(ret);
  var mode = toInt(argOr(a, 4, 0)), dir = toInt(argOr(a, 5, 1));
  var i = lookupPos(a[0], lk, mode === -1 ? 1 : mode === 1 ? -1 : mode, dir < 0 ? -1 : 1);
  if (i < 0) { if (a[3] !== undefined) return scalar(a[3]); fail(ERR.NA); }
  if (ld.cols === 1 && ld.rows > 1) {           /* vertical lookup */
    if (rd.rows !== ld.rows) fail(ERR.VALUE);
    return rd.cols === 1 ? ret[i] : rowOf(ret, i);
  }
  if (rd.cols !== ld.cols) fail(ERR.VALUE);
  return rd.rows === 1 ? ret[i] : colOf(ret, i);
});
def("ROWS", 1, 1, function (a) { return dims(arr2(a[0])).rows; });
def("COLUMNS", 1, 1, function (a) { return dims(arr2(a[0])).cols; });
def("ROW", 0, 1, function (a, cx) { return a[0] !== undefined && isArr(a[0]) && a[0].r0 !== undefined ? a[0].r0 + 1 : cx.r + 1; });
def("COLUMN", 0, 1, function (a, cx) { return a[0] !== undefined && isArr(a[0]) && a[0].c0 !== undefined ? a[0].c0 + 1 : cx.c + 1; });

/* ---- logic (lazy where Excel skips the unused branch) ---- */
lazy("IF", 1, 3, function (n, cx, ev) {
  var c = scalar(ev(n[0]));
  if (isErr(c)) return c;
  if (toBool(c)) return n[1] ? valueOf(ev(n[1])) : true;
  return n[2] ? valueOf(ev(n[2])) : false;
});
lazy("IFS", 2, INF, function (n, cx, ev) {
  for (var i = 0; i + 1 < n.length; i += 2) {
    var c = scalar(ev(n[i]));
    if (isErr(c)) return c;
    if (toBool(c)) return valueOf(ev(n[i + 1]));
  }
  return ERR.NA;
});
lazy("SWITCH", 3, INF, function (n, cx, ev) {
  var x = scalar(ev(n[0]));
  if (isErr(x)) return x;
  var i;
  for (i = 1; i + 1 < n.length; i += 2) {
    var y = scalar(ev(n[i]));
    if (isErr(y)) return y;
    if (valEq(x, y)) return valueOf(ev(n[i + 1]));
  }
  return i < n.length ? valueOf(ev(n[i])) : ERR.NA;
});
lazy("IFERROR", 2, 2, function (n, cx, ev) {
  var v = ev(n[0]);
  return isErr(scalar(v)) ? valueOf(ev(n[1])) : v;
});
lazy("IFNA", 2, 2, function (n, cx, ev) {
  var v = ev(n[0]);
  return scalar(v) === ERR.NA ? valueOf(ev(n[1])) : v;
});
lazy("CHOOSE", 2, INF, function (n, cx, ev) {
  var k = toInt(ev(n[0]));
  if (k < 1 || k >= n.length) return ERR.VALUE;
  return valueOf(ev(n[k]));
});
function bools(a) {
  var out = [];
  eachVal(a, function (v, inR) {
    if (isErr(v)) fail(v);
    if (typeof v === "boolean" || typeof v === "number") out.push(typeof v === "boolean" ? v : v !== 0);
    else if (!inR && v !== null) out.push(toBool(v));
  });
  if (!out.length) fail(ERR.VALUE);
  return out;
}
def("AND", 1, INF, function (a) { var b = bools(a); for (var i = 0; i < b.length; i++) if (!b[i]) return false; return true; });
def("OR", 1, INF, function (a) { var b = bools(a); for (var i = 0; i < b.length; i++) if (b[i]) return true; return false; });
def("XOR", 1, INF, function (a) { var b = bools(a), x = false; for (var i = 0; i < b.length; i++) if (b[i]) x = !x; return x; });
def("NOT", 1, 1, function (a) { return !toBool(a[0]); });
def("TRUE", 0, 0, function () { return true; });
def("FALSE", 0, 0, function () { return false; });

/* ---- information (they see errors and blanks as they are) ---- */
function info(f) { return function (a) { return f(scalar(a[0])); }; }
def("ISBLANK", 1, 1, info(function (v) { return isBlank(v); }));
def("ISNUMBER", 1, 1, info(function (v) { return typeof v === "number"; }));
def("ISTEXT", 1, 1, info(function (v) { return typeof v === "string" && !isErr(v); }));
def("ISNONTEXT", 1, 1, info(function (v) { return !(typeof v === "string" && !isErr(v)); }));
def("ISLOGICAL", 1, 1, info(function (v) { return typeof v === "boolean"; }));
def("ISERROR", 1, 1, info(function (v) { return isErr(v); }));
def("ISERR", 1, 1, info(function (v) { return isErr(v) && v !== ERR.NA; }));
def("ISNA", 1, 1, info(function (v) { return v === ERR.NA; }));
def("ISEVEN", 1, 1, function (a) { return Math.floor(Math.abs(toNum(a[0]))) % 2 === 0; });
def("ISODD", 1, 1, function (a) { return Math.floor(Math.abs(toNum(a[0]))) % 2 === 1; });
def("NA", 0, 0, function () { return ERR.NA; });
F.ISBLANK.raw = F.ISNUMBER.raw = F.ISTEXT.raw = F.ISNONTEXT.raw = F.ISLOGICAL.raw =
  F.ISERROR.raw = F.ISERR.raw = F.ISNA.raw = true;

/* ---- text ---- */
def("LEN", 1, 1, function (a) { return toStr(a[0]).length; });
def("LEFT", 1, 2, function (a) { var n = toInt(argOr(a, 1, 1)); if (n < 0) fail(ERR.VALUE); return toStr(a[0]).slice(0, n); });
def("RIGHT", 1, 2, function (a) { var s = toStr(a[0]), n = toInt(argOr(a, 1, 1)); if (n < 0) fail(ERR.VALUE); return n ? s.slice(-n) : ""; });
def("MID", 3, 3, function (a) {
  var s = toStr(a[0]), st = toInt(a[1]), n = toInt(a[2]);
  if (st < 1 || n < 0) fail(ERR.VALUE);
  return s.substr(st - 1, n);
});
def("UPPER", 1, 1, function (a) { return toStr(a[0]).toUpperCase(); });
def("LOWER", 1, 1, function (a) { return toStr(a[0]).toLowerCase(); });
def("PROPER", 1, 1, function (a) {
  return toStr(a[0]).toLowerCase().replace(/(^|[^\p{L}\p{N}\x27])(\p{L})/gu, function (m, p, l) { return p + l.toUpperCase(); });
});
def("TRIM", 1, 1, function (a) { return toStr(a[0]).replace(/ +/g, " ").replace(/^ | $/g, ""); });
def("SUBSTITUTE", 3, 4, function (a) {
  var s = toStr(a[0]), o = toStr(a[1]), n = toStr(a[2]);
  if (o === "") return s;
  if (a[3] === undefined) return s.split(o).join(n);
  var k = toInt(a[3]), pos = -1;
  if (k < 1) fail(ERR.VALUE);
  for (var i = 0; i < k; i++) { pos = s.indexOf(o, pos + 1); if (pos < 0) return s; }
  return s.slice(0, pos) + n + s.slice(pos + o.length);
});
def("REPLACE", 4, 4, function (a) {
  var s = toStr(a[0]), st = toInt(a[1]), n = toInt(a[2]);
  if (st < 1 || n < 0) fail(ERR.VALUE);
  return s.slice(0, st - 1) + toStr(a[3]) + s.slice(st - 1 + n);
});
def("FIND", 2, 3, function (a) {
  var f = toStr(a[0]), s = toStr(a[1]), st = toInt(argOr(a, 2, 1));
  if (st < 1 || st > s.length + 1) fail(ERR.VALUE);
  var i = s.indexOf(f, st - 1);
  if (i < 0) fail(ERR.VALUE);
  return i + 1;
});
def("SEARCH", 2, 3, function (a) {
  var f = toStr(a[0]), s = toStr(a[1]), st = toInt(argOr(a, 2, 1));
  if (st < 1 || st > s.length + 1) fail(ERR.VALUE);
  if (f === "") return st;
  var src = wildRe(f).source.replace(/^\^|\$$/g, "");
  var re = new RegExp(src, "i"), sub = s.slice(st - 1), m = re.exec(sub);
  if (!m) fail(ERR.VALUE);
  return m.index + st;
});
def("TEXT", 2, 2, function (a, cx) { return textFormat(a[0], toStr(a[1]), cx.lang); });
def("VALUE", 1, 1, function (a) {
  var v = scalar(a[0]);
  if (typeof v === "number") return v;
  if (isErr(v)) return v;
  var s = toStr(v).trim();
  if (s === "") return 0;
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  var n = textNum(s);
  if (n === null) fail(ERR.VALUE);
  return n;
});
def("TEXTJOIN", 3, INF, function (a) {
  var d = toStr(a[0]), skip = toBool(a[1]), out = [];
  eachVal(a.slice(2), function (v) {
    var s = toStr(v);
    if (!(skip && s === "")) out.push(s);
  });
  return out.join(d);
});
def("CONCAT CONCATENATE", 1, INF, function (a) { var s = ""; eachVal(a, function (v) { s += toStr(v); }); return s; });
def("REPT", 2, 2, function (a) {
  var s = toStr(a[0]), n = toInt(a[1]);
  if (n < 0 || s.length * n > 32767) fail(ERR.VALUE);
  return new Array(n + 1).join(s);
});
def("EXACT", 2, 2, function (a) { return toStr(a[0]) === toStr(a[1]); });
def("CHAR", 1, 1, function (a) { var n = toInt(a[0]); if (n < 1 || n > 65535) fail(ERR.VALUE); return String.fromCharCode(n); });
def("CODE", 1, 1, function (a) { var s = toStr(a[0]); if (!s) fail(ERR.VALUE); return s.charCodeAt(0); });

/* ---- dates ---- */
def("TODAY", 0, 0, function (a, cx) { return Math.floor(nowSerial(cx.now())); });
def("NOW", 0, 0, function (a, cx) { return nowSerial(cx.now()); });
def("DATE", 3, 3, function (a) {
  var s = ymdSerial(toInt(a[0]), toInt(a[1]), toInt(a[2]));
  if (s < 0 || s > 2958465) fail(ERR.NUM);
  return s;
});
def("TIME", 3, 3, function (a) {
  var t = (toInt(a[0]) * 3600 + toInt(a[1]) * 60 + toInt(a[2])) / 86400;
  if (t < 0) fail(ERR.NUM);
  return t - Math.floor(t);
});
def("DATEVALUE", 1, 1, function (a) {
  var v = scalar(a[0]);
  if (isErr(v)) return v;
  var d = parseDate(toStr(v));
  if (d === null) fail(ERR.VALUE);
  return Math.floor(d);
});
def("YEAR", 1, 1, function (a) { return datePartsArg(a[0]).y; });
def("MONTH", 1, 1, function (a) { return datePartsArg(a[0]).m; });
def("DAY", 1, 1, function (a) { return datePartsArg(a[0]).d; });
def("HOUR", 1, 1, function (a) { return datePartsArg(a[0]).hh; });
def("MINUTE", 1, 1, function (a) { return datePartsArg(a[0]).mi; });
def("SECOND", 1, 1, function (a) { return datePartsArg(a[0]).ss; });
def("WEEKDAY", 1, 2, function (a) {
  var wd = datePartsArg(a[0]).wd, t = toInt(argOr(a, 1, 1));
  if (t === 1) return wd + 1;
  if (t === 2) return (wd + 6) % 7 + 1;
  if (t === 3) return (wd + 6) % 7;
  fail(ERR.NUM);
});
def("DAYS", 2, 2, function (a) { return Math.floor(toNum(a[0])) - Math.floor(toNum(a[1])); });
def("DATEDIF", 3, 3, function (a) {
  var s = Math.floor(toNum(a[0])), e = Math.floor(toNum(a[1])), u = toStr(a[2]).toUpperCase();
  if (s > e) fail(ERR.NUM);
  var p = partsOf(s), q = partsOf(e);
  var months = (q.y - p.y) * 12 + (q.m - p.m) - (q.d < p.d ? 1 : 0);
  if (u === "D") return e - s;
  if (u === "M") return months;
  if (u === "Y") return Math.floor(months / 12);
  if (u === "YM") return months % 12;
  if (u === "MD") {
    if (q.d >= p.d) return q.d - p.d;
    var pm = q.m - 1, py = q.y;
    if (pm < 1) { pm = 12; py--; }
    return e - serialOf(py, pm, Math.min(p.d, daysInMonth(py, pm)));
  }
  if (u === "YD") {
    var y = q.y, st = serialOf(y, p.m, Math.min(p.d, daysInMonth(y, p.m)));
    if (st > e) st = serialOf(y - 1, p.m, Math.min(p.d, daysInMonth(y - 1, p.m)));
    return e - st;
  }
  fail(ERR.NUM);
});
def("EDATE", 2, 2, function (a) { var s = toNum(a[0]); if (s < 0) fail(ERR.NUM); return addMonths(s, toInt(a[1]), false); });
def("EOMONTH", 2, 2, function (a) { var s = toNum(a[0]); if (s < 0) fail(ERR.NUM); return addMonths(s, toInt(a[1]), true); });
function holidaySet(v) {
  var h = {};
  if (v !== undefined) eachVal([v], function (x) { if (isErr(x)) fail(x); if (!isBlank(x)) h[Math.floor(toNum(x))] = 1; });
  return h;
}
def("NETWORKDAYS", 2, 3, function (a) {
  var s = Math.floor(toNum(a[0])), e = Math.floor(toNum(a[1])), h = holidaySet(a[2]), sign = 1;
  if (s > e) { var t = s; s = e; e = t; sign = -1; }
  if (e - s > 400000) fail(ERR.NUM);
  var n = 0;
  for (var d = s; d <= e; d++) {
    var wd = partsOf(d).wd;
    if (wd !== 0 && wd !== 6 && !h[d]) n++;
  }
  return sign * n;
});
def("WORKDAY", 2, 3, function (a) {
  var d = Math.floor(toNum(a[0])), k = toInt(a[1]), h = holidaySet(a[2]), step = k < 0 ? -1 : 1;
  if (Math.abs(k) > 100000) fail(ERR.NUM);
  while (k !== 0) {
    d += step;
    var wd = partsOf(d).wd;
    if (wd !== 0 && wd !== 6 && !h[d]) k -= step;
  }
  return d;
});

/* ---- finance (Excel signs: money paid out is negative) ---- */
function finArgs(a) { return { r: toNum(a[0]), n: toNum(a[1]), x: toNum(a[2]), y: toNum(argOr(a, 3, 0)), t: toNum(argOr(a, 4, 0)) ? 1 : 0 }; }
def("PMT", 3, 5, function (a) {
  var f = finArgs(a), r = f.r, n = f.n, pv = f.x, fv = f.y;
  if (n === 0) fail(ERR.NUM);
  if (r === 0) return -(pv + fv) / n;
  var q = Math.pow(1 + r, n);
  return -(r * (fv + pv * q)) / ((1 + r * f.t) * (q - 1));
});
def("FV", 3, 5, function (a) {
  var f = finArgs(a), r = f.r, n = f.n, pmt = f.x, pv = f.y;
  if (r === 0) return -(pv + pmt * n);
  var q = Math.pow(1 + r, n);
  return -(pv * q + pmt * (1 + r * f.t) * (q - 1) / r);
});
def("PV", 3, 5, function (a) {
  var f = finArgs(a), r = f.r, n = f.n, pmt = f.x, fv = f.y;
  if (r === 0) return -(fv + pmt * n);
  var q = Math.pow(1 + r, n);
  return -(fv + pmt * (1 + r * f.t) * (q - 1) / r) / q;
});
def("NPER", 3, 5, function (a) {
  var f = finArgs(a), r = f.r, pmt = f.n, pv = f.x, fv = f.y;
  if (r === 0) { if (pmt === 0) fail(ERR.NUM); return -(pv + fv) / pmt; }
  var k = pmt * (1 + r * f.t) / r, num = k - fv, den = k + pv;
  if (num / den <= 0) fail(ERR.NUM);
  return Math.log(num / den) / Math.log(1 + r);
});
def("NPV", 2, INF, function (a) {
  var r = toNum(a[0]), n = numbers(a.slice(1)), s = 0;
  for (var i = 0; i < n.length; i++) s += n[i] / Math.pow(1 + r, i + 1);
  return s;
});

/* ===== Wave 4 (2026-10-31): more maths, statistics, dates, text,
   finance and lookup functions ===== */

/* ---- maths ---- */
function gcd2(x, y) { while (y) { var t = x % y; x = y; y = t; } return x; }
function wholeNums(a) {
  return numbers(a).map(function (n) { if (n < 0) fail(ERR.NUM); return Math.floor(n); });
}
def("GCD", 1, INF, function (a) { var n = wholeNums(a), g = 0; for (var i = 0; i < n.length; i++) g = gcd2(g, n[i]); return g; });
def("LCM", 1, INF, function (a) {
  var n = wholeNums(a), l = 1;
  for (var i = 0; i < n.length; i++) {
    if (n[i] === 0) return 0;
    l = l / gcd2(l, n[i]) * n[i];
    if (l > 9007199254740991) fail(ERR.NUM);
  }
  return l;
});
def("FACT", 1, 1, function (a) {
  var n = Math.floor(toNum(a[0])), r = 1;
  if (n < 0 || n > 170) fail(ERR.NUM);
  for (var i = 2; i <= n; i++) r *= i;
  return r;
});
def("COMBIN", 2, 2, function (a) {
  var n = Math.floor(toNum(a[0])), k = Math.floor(toNum(a[1])), r = 1;
  if (n < 0 || k < 0 || k > n) fail(ERR.NUM);
  k = Math.min(k, n - k);
  for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return Math.round(r);
});
def("PERMUT", 2, 2, function (a) {
  var n = Math.floor(toNum(a[0])), k = Math.floor(toNum(a[1])), r = 1;
  if (n < 0 || k < 0 || k > n) fail(ERR.NUM);
  for (var i = 0; i < k; i++) r *= n - i;
  return r;
});
def("MROUND", 2, 2, function (a) {
  var n = toNum(a[0]), m = toNum(a[1]);
  if (m === 0) return 0;
  if (n * m < 0) fail(ERR.NUM);
  return Number((roundHalfAway(n / m, 0) * m).toPrecision(15));
});
def("EVEN", 1, 1, function (a) {
  var n = toNum(a[0]), s = n < 0 ? -1 : 1;
  return s * Math.ceil(Number((Math.abs(n) / 2).toPrecision(15))) * 2;
});
def("ODD", 1, 1, function (a) {
  var n = toNum(a[0]), s = n < 0 ? -1 : 1, v = Math.ceil(Number(Math.abs(n).toPrecision(15)));
  if (v % 2 === 0) v++;
  return s * v;
});
def("QUOTIENT", 2, 2, function (a) {
  var n = toNum(a[0]), d = toNum(a[1]);
  if (d === 0) fail(ERR.DIV0);
  return Math.trunc(n / d);
});
function math1(f, check) {
  return function (a) {
    var n = toNum(a[0]);
    if (check && !check(n)) fail(ERR.NUM);
    var r = f(n);
    if (!isFinite(r) || isNaN(r)) fail(ERR.NUM);
    return r;
  };
}
def("SIN", 1, 1, math1(Math.sin));
def("COS", 1, 1, math1(Math.cos));
def("TAN", 1, 1, math1(Math.tan));
def("ASIN", 1, 1, math1(Math.asin, function (n) { return n >= -1 && n <= 1; }));
def("ACOS", 1, 1, math1(Math.acos, function (n) { return n >= -1 && n <= 1; }));
def("ATAN", 1, 1, math1(Math.atan));
def("SINH", 1, 1, math1(Math.sinh));
def("COSH", 1, 1, math1(Math.cosh));
def("TANH", 1, 1, math1(Math.tanh));
def("RADIANS", 1, 1, math1(function (n) { return n * Math.PI / 180; }));
def("DEGREES", 1, 1, math1(function (n) { return n * 180 / Math.PI; }));
def("ATAN2", 2, 2, function (a) {      /* Excel's order: x first, then y */
  var x = toNum(a[0]), y = toNum(a[1]);
  if (x === 0 && y === 0) fail(ERR.DIV0);
  return Math.atan2(y, x);
});
def("CEILING.MATH", 1, 3, function (a) {
  var n = toNum(a[0]), s = Math.abs(toNum(argOr(a, 1, 1))), away = toNum(argOr(a, 2, 0)) !== 0;
  if (s === 0) return 0;
  var q = Number((n / s).toPrecision(15));
  return (n < 0 && away ? Math.floor(q) : Math.ceil(q)) * s;
});
def("FLOOR.MATH", 1, 3, function (a) {
  var n = toNum(a[0]), s = Math.abs(toNum(argOr(a, 1, 1))), away = toNum(argOr(a, 2, 0)) !== 0;
  if (s === 0) return 0;
  var q = Number((n / s).toPrecision(15));
  return (n < 0 && away ? Math.ceil(q) : Math.floor(q)) * s;
});
var SUBTOTAL_FN = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT",
                    7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR", 11: "VARP" };
def("SUBTOTAL", 2, INF, function (a, cx) {
  var k = toInt(a[0]);
  if (k > 100) k -= 100;
  var name = SUBTOTAL_FN[k];
  if (!name) fail(ERR.VALUE);
  return F[name].f(a.slice(1), cx);
});

/* ---- statistics ---- */
/* AVERAGEA-style: in ranges text counts as 0 and TRUE as 1 */
function numbersA(args) {
  var out = [];
  eachVal(args, function (v, inRange) {
    if (isErr(v)) fail(v);
    if (typeof v === "number") out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
    else if (inRange) { if (v !== null && v !== undefined) out.push(0); }
    else if (v !== null) out.push(toNum(v));
  });
  return out;
}
def("AVERAGEA", 1, INF, function (a) { var n = numbersA(a); if (!n.length) fail(ERR.DIV0); return sum(n) / n.length; });
def("MAXA", 1, INF, function (a) { var n = numbersA(a); return n.length ? Math.max.apply(null, n) : 0; });
def("MINA", 1, INF, function (a) { var n = numbersA(a); return n.length ? Math.min.apply(null, n) : 0; });
def("GEOMEAN", 1, INF, function (a) {
  var n = numbers(a), s = 0;
  if (!n.length) fail(ERR.NUM);
  for (var i = 0; i < n.length; i++) { if (n[i] <= 0) fail(ERR.NUM); s += Math.log(n[i]); }
  return Math.exp(s / n.length);
});
def("HARMEAN", 1, INF, function (a) {
  var n = numbers(a), s = 0;
  if (!n.length) fail(ERR.NUM);
  for (var i = 0; i < n.length; i++) { if (n[i] <= 0) fail(ERR.NUM); s += 1 / n[i]; }
  return n.length / s;
});
/* two ranges of the same size -> the positions where both hold numbers */
function numPairs(ys, xs) {
  ys = arr2(ys); xs = arr2(xs);
  if (ys.length !== xs.length) fail(ERR.NA);
  var X = [], Y = [];
  for (var i = 0; i < ys.length; i++) {
    if (isErr(ys[i])) fail(ys[i]);
    if (isErr(xs[i])) fail(xs[i]);
    if (typeof ys[i] === "number" && typeof xs[i] === "number") { Y.push(ys[i]); X.push(xs[i]); }
  }
  return { x: X, y: Y };
}
function linFit(ys, xs) {
  var p = numPairs(ys, xs), n = p.x.length;
  if (n < 2) fail(ERR.DIV0);
  var mx = sum(p.x) / n, my = sum(p.y) / n, sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < n; i++) {
    var dx = p.x[i] - mx, dy = p.y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return { mx: mx, my: my, sxy: sxy, sxx: sxx, syy: syy };
}
def("CORREL PEARSON", 2, 2, function (a) {
  var s = linFit(a[0], a[1]);
  if (s.sxx === 0 || s.syy === 0) fail(ERR.DIV0);
  return s.sxy / Math.sqrt(s.sxx * s.syy);
});
def("RSQ", 2, 2, function (a) {
  var s = linFit(a[0], a[1]);
  if (s.sxx === 0 || s.syy === 0) fail(ERR.DIV0);
  return s.sxy * s.sxy / (s.sxx * s.syy);
});
def("SLOPE", 2, 2, function (a) { var s = linFit(a[0], a[1]); if (s.sxx === 0) fail(ERR.DIV0); return s.sxy / s.sxx; });
def("INTERCEPT", 2, 2, function (a) { var s = linFit(a[0], a[1]); if (s.sxx === 0) fail(ERR.DIV0); return s.my - s.sxy / s.sxx * s.mx; });
def("FORECAST FORECAST.LINEAR", 3, 3, function (a) {
  var x = toNum(scalar(a[0])), s = linFit(a[1], a[2]);
  if (s.sxx === 0) fail(ERR.DIV0);
  var b = s.sxy / s.sxx;
  return s.my - b * s.mx + b * x;
});
/* standard normal distribution (W. J. Cody's / Hart's double-precision
   approximation as given by G. West, 2005) and its inverse (P. J. Acklam,
   refined with one Halley step) */
function normCdf(z) {
  var x = Math.abs(z), c;
  if (x > 37) c = 0;
  else {
    var e = Math.exp(-x * x / 2), b;
    if (x < 7.07106781186547) {
      b = 3.52624965998911e-2 * x + 0.700383064443688;
      b = b * x + 6.37396220353165; b = b * x + 33.912866078383;
      b = b * x + 112.079291497871; b = b * x + 221.213596169931;
      b = b * x + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * x + 1.75566716318264;
      b = b * x + 16.064177579207; b = b * x + 86.7807322029461;
      b = b * x + 296.564248779674; b = b * x + 637.333633378831;
      b = b * x + 793.826512519948; b = b * x + 440.413735824752;
      c = c / b;
    } else {
      b = x + 0.65; b = x + 4 / b; b = x + 3 / b; b = x + 2 / b; b = x + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return z > 0 ? 1 - c : c;
}
function normPdf(z) { return Math.exp(-z * z / 2) / 2.5066282746310002; }
function normInv(p) {
  if (!(p > 0 && p < 1)) fail(ERR.NUM);
  var A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  var B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  var C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  var D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  var lo = 0.02425, q, r, x;
  if (p < lo) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - lo) {
    q = p - 0.5; r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  var e = normCdf(x) - p, u = e * 2.5066282746310002 * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}
def("NORM.S.DIST", 2, 2, function (a) { var z = toNum(a[0]); return toBool(a[1]) ? normCdf(z) : normPdf(z); });
def("NORM.DIST NORMDIST", 4, 4, function (a) {
  var x = toNum(a[0]), m = toNum(a[1]), sd = toNum(a[2]);
  if (sd <= 0) fail(ERR.NUM);
  var z = (x - m) / sd;
  return toBool(a[3]) ? normCdf(z) : normPdf(z) / sd;
});
def("NORM.S.INV NORMSINV", 1, 1, function (a) { return normInv(toNum(a[0])); });
def("NORM.INV NORMINV", 3, 3, function (a) {
  var sd = toNum(a[2]);
  if (sd <= 0) fail(ERR.NUM);
  return toNum(a[1]) + sd * normInv(toNum(a[0]));
});
def("STANDARDIZE", 3, 3, function (a) {
  var sd = toNum(a[2]);
  if (sd <= 0) fail(ERR.NUM);
  return (toNum(a[0]) - toNum(a[1])) / sd;
});

/* ---- dates ---- */
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
def("WEEKNUM", 1, 2, function (a) {
  var d = Math.floor(toNum(a[0])), t = toInt(argOr(a, 1, 1));
  if (d < 0) fail(ERR.NUM);
  if (t === 21) return F.ISOWEEKNUM.f([d]);
  var START = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };
  if (START[t] === undefined) fail(ERR.NUM);
  var jan1 = serialOf(partsOf(d).y, 1, 1), off = (partsOf(jan1).wd - START[t] + 7) % 7;
  return Math.floor((d - jan1 + off) / 7) + 1;
});
def("ISOWEEKNUM", 1, 1, function (a) {
  var d = Math.floor(toNum(a[0]));
  if (d < 0) fail(ERR.NUM);
  var thu = d - (partsOf(d).wd + 6) % 7 + 3;
  return Math.floor((thu - serialOf(partsOf(thu).y, 1, 1)) / 7) + 1;
});
function lastOfFeb(p) { return p.m === 2 && p.d === daysInMonth(p.y, 2); }
function days360(s, e, euro, yf) {
  var p = partsOf(s), q = partsOf(e), d1 = p.d, d2 = q.d, m2 = q.m, y2 = q.y;
  if (euro) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else if (yf) {                       /* YEARFRAC basis 0 (NASD) */
    if (lastOfFeb(p) && lastOfFeb(q)) d2 = 30;
    if (lastOfFeb(p)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  } else {                               /* DAYS360 US method */
    if (d1 === 31 || lastOfFeb(p)) d1 = 30;
    if (d2 === 31) { if (d1 < 30) { d2 = 1; m2++; } else d2 = 30; }
  }
  return (y2 - p.y) * 360 + (m2 - p.m) * 30 + (d2 - d1);
}
def("DAYS360", 2, 3, function (a) {
  var s = Math.floor(toNum(a[0])), e = Math.floor(toNum(a[1]));
  if (s < 0 || e < 0) fail(ERR.NUM);
  return days360(s, e, toBool(argOr(a, 2, false)), false);
});
def("YEARFRAC", 2, 3, function (a) {
  var s = Math.floor(toNum(a[0])), e = Math.floor(toNum(a[1])), b = toInt(argOr(a, 2, 0));
  if (s < 0 || e < 0 || b < 0 || b > 4) fail(ERR.NUM);
  if (s > e) { var t = s; s = e; e = t; }
  if (b === 0) return days360(s, e, false, true) / 360;
  if (b === 4) return days360(s, e, true, false) / 360;
  if (b === 2) return (e - s) / 360;
  if (b === 3) return (e - s) / 365;
  var p = partsOf(s), q = partsOf(e), den;
  if (p.y === q.y) den = isLeap(p.y) ? 366 : 365;
  else if (q.y === p.y + 1 && (p.m > q.m || (p.m === q.m && p.d >= q.d))) {
    den = (isLeap(p.y) && s <= serialOf(p.y, 2, 29)) || (isLeap(q.y) && e >= serialOf(q.y, 2, 29)) ? 366 : 365;
  } else den = (serialOf(q.y + 1, 1, 1) - serialOf(p.y, 1, 1)) / (q.y - p.y + 1);
  return (e - s) / den;
});
def("TIMEVALUE", 1, 1, function (a) {
  var v = scalar(a[0]);
  if (isErr(v)) return v;
  var s = toStr(v).trim(), m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(am|pm|πμ|μμ|π\.μ\.|μ\.μ\.)?$/i);
  if (m) {
    var h = +m[1], ap = (m[4] || "").toLowerCase().replace(/\./g, "");
    if (ap && (h < 1 || h > 12)) fail(ERR.VALUE);
    if (ap === "pm" || ap === "μμ") h = h % 12 + 12; else if (ap) h = h % 12;
    var t = (h * 3600 + (+m[2]) * 60 + (m[3] ? +m[3] : 0)) / 86400;
    return t - Math.floor(t);
  }
  var d = parseDate(s);
  if (d === null) fail(ERR.VALUE);
  return d - Math.floor(d);
});
/* weekend argument of the .INTL functions -> {wd: true} (0 = Sunday) */
function weekendMask(v) {
  v = v === undefined ? 1 : scalar(v);
  if (isErr(v)) fail(v);
  var w = {}, k;
  if (typeof v === "string" && !/^\d+$/.test(v)) fail(ERR.VALUE);
  if (typeof v === "string" && v.length === 7) {
    if (!/^[01]{7}$/.test(v) || v === "1111111") fail(ERR.VALUE);
    for (k = 0; k < 7; k++) if (v.charAt(k) === "1") w[(k + 1) % 7] = true;
    return w;
  }
  var n = toInt(v);
  if (n >= 1 && n <= 7) { w[(n + 5) % 7] = true; w[(n + 6) % 7] = true; return w; }
  if (n >= 11 && n <= 17) { w[n - 11] = true; return w; }
  fail(ERR.NUM);
}
def("NETWORKDAYS.INTL", 2, 4, function (a) {
  var s = Math.floor(toNum(a[0])), e = Math.floor(toNum(a[1])), w = weekendMask(a[2]), h = holidaySet(a[3]), sign = 1;
  if (s > e) { var t = s; s = e; e = t; sign = -1; }
  if (e - s > 400000) fail(ERR.NUM);
  var n = 0;
  for (var d = s; d <= e; d++) if (!w[partsOf(d).wd] && !h[d]) n++;
  return sign * n;
});
def("WORKDAY.INTL", 2, 4, function (a) {
  var d = Math.floor(toNum(a[0])), k = toInt(a[1]), w = weekendMask(a[2]), h = holidaySet(a[3]), step = k < 0 ? -1 : 1;
  if (Math.abs(k) > 100000) fail(ERR.NUM);
  while (k !== 0) {
    d += step;
    if (!w[partsOf(d).wd] && !h[d]) k -= step;
  }
  return d;
});

/* ---- text ---- */
/* TEXTBEFORE / TEXTAFTER: the instance-th delimiter (from the end when
   negative), any of several delimiters, case-blind with match_mode 1,
   the ends of the text count as delimiters with match_end 1 */
function textCut(a, after) {
  var s = toStr(a[0]), inst = toInt(argOr(a, 2, 1)), ci = toInt(argOr(a, 3, 0)) === 1, mEnd = toInt(argOr(a, 4, 0)) === 1;
  var dl = [];
  eachVal([a[1]], function (v) { if (isErr(v)) fail(v); dl.push(toStr(v)); });
  if (!dl.length) fail(ERR.VALUE);
  if (inst === 0 || Math.abs(inst) > s.length + 1) fail(ERR.VALUE);
  var hay = ci ? s.toLowerCase() : s, occ = [], i = 0;
  if (dl.indexOf("") >= 0) occ = inst > 0 ? [{ s: 0, e: 0 }] : [{ s: s.length, e: s.length }];
  else {
    while (i <= hay.length) {
      var best = null;
      for (var k = 0; k < dl.length; k++) {
        var d = ci ? dl[k].toLowerCase() : dl[k];
        if (hay.substr(i, d.length) === d && (!best || d.length > best)) best = d.length;
      }
      if (best) { occ.push({ s: i, e: i + best }); i += best; } else i++;
    }
    if (mEnd) { if (inst > 0) occ.push({ s: s.length, e: s.length }); else occ.unshift({ s: 0, e: 0 }); }
  }
  var o = inst > 0 ? occ[inst - 1] : occ[occ.length + inst];
  if (!o) { if (a[5] !== undefined) return scalar(a[5]); fail(ERR.NA); }
  return after ? s.slice(o.e) : s.slice(0, o.s);
}
def("TEXTBEFORE", 2, 6, function (a) { return textCut(a, false); });
def("TEXTAFTER", 2, 6, function (a) { return textCut(a, true); });
def("CLEAN", 1, 1, function (a) { return toStr(a[0]).replace(/[\x00-\x1f]/g, ""); });
def("UNICHAR", 1, 1, function (a) {
  var n = toInt(a[0]);
  if (n < 1 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) fail(ERR.VALUE);
  return String.fromCodePoint(n);
});
def("UNICODE", 1, 1, function (a) { var s = toStr(a[0]); if (!s) fail(ERR.VALUE); return s.codePointAt(0); });
def("NUMBERVALUE", 1, 3, function (a, cx) {
  var el = cx && cx.lang === "el";
  var dec = a[1] === undefined ? (el ? "," : ".") : toStr(a[1]).charAt(0);
  var grp = a[2] === undefined ? (el ? "." : ",") : toStr(a[2]).charAt(0);
  if (!dec || dec === grp) fail(ERR.VALUE);
  var s = toStr(a[0]).replace(/\s+/g, ""), pct = 0;
  if (s === "") return 0;
  while (s.charAt(s.length - 1) === "%") { pct++; s = s.slice(0, -1); }
  var di = s.indexOf(dec);
  if (di >= 0 && s.indexOf(dec, di + 1) >= 0) fail(ERR.VALUE);
  var ip = di >= 0 ? s.slice(0, di) : s, fp = di >= 0 ? s.slice(di + 1) : "";
  if (grp) {
    if (fp.indexOf(grp) >= 0) fail(ERR.VALUE);
    ip = ip.split(grp).join("");
  }
  var t = ip + (di >= 0 ? "." + fp : "");
  if (!NUM_RE.test(t)) fail(ERR.VALUE);
  return parseFloat(t) / Math.pow(100, pct);
});
def("FIXED", 1, 3, function (a) {
  var n = toNum(a[0]), d = toInt(argOr(a, 1, 2)), plain = toBool(argOr(a, 2, false));
  if (d > 127) fail(ERR.VALUE);
  var x = roundHalfAway(n, d), str = Math.abs(x).toFixed(Math.max(0, d)), parts = str.split(".");
  var ip = plain ? parts[0] : groupThousands(parts[0]);
  return (x < 0 ? "-" : "") + ip + (parts[1] ? "." + parts[1] : "");
});
def("T", 1, 1, function (a) { var v = scalar(a[0]); if (isErr(v)) return v; return typeof v === "string" ? v : ""; });
def("N", 1, 1, function (a) {
  var v = scalar(a[0]);
  if (isErr(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
});
F.T.raw = F.N.raw = true;

/* ---- finance ---- */
function pmtOf(r, n, pv, fv, t) {
  if (n === 0) fail(ERR.NUM);
  if (r === 0) return -(pv + fv) / n;
  var q = Math.pow(1 + r, n);
  return -(r * (fv + pv * q)) / ((1 + r * t) * (q - 1));
}
function fvOf(r, n, pmt, pv, t) {
  if (r === 0) return -(pv + pmt * n);
  var q = Math.pow(1 + r, n);
  return -(pv * q + pmt * (1 + r * t) * (q - 1) / r);
}
function ipmtOf(r, per, n, pv, fv, t) {
  if (per < 1 || per > n) fail(ERR.NUM);
  var pmt = pmtOf(r, n, pv, fv, t), ip;
  if (per === 1) ip = t === 1 ? 0 : -pv;
  else ip = t === 1 ? fvOf(r, per - 2, pmt, pv, 1) - pmt : fvOf(r, per - 1, pmt, pv, 0);
  return ip * r;
}
function typeArg(v) { var t = toNum(v === undefined ? 0 : v); if (t !== 0 && t !== 1) fail(ERR.NUM); return t; }
def("IPMT", 4, 6, function (a) {
  return ipmtOf(toNum(a[0]), toNum(a[1]), toNum(a[2]), toNum(a[3]), toNum(argOr(a, 4, 0)), toNum(argOr(a, 5, 0)) ? 1 : 0);
});
def("PPMT", 4, 6, function (a) {
  var r = toNum(a[0]), per = toNum(a[1]), n = toNum(a[2]), pv = toNum(a[3]), fv = toNum(argOr(a, 4, 0)), t = toNum(argOr(a, 5, 0)) ? 1 : 0;
  return pmtOf(r, n, pv, fv, t) - ipmtOf(r, per, n, pv, fv, t);
});
function cumulative(a, principal) {
  var r = toNum(a[0]), n = toNum(a[1]), pv = toNum(a[2]), st = toInt(a[3]), en = toInt(a[4]), t = typeArg(a[5]);
  if (r <= 0 || n <= 0 || pv <= 0 || st < 1 || en < st || en > n) fail(ERR.NUM);
  var s = 0, pmt = pmtOf(r, n, pv, 0, t);
  for (var p = st; p <= en; p++) {
    var ip = ipmtOf(r, p, n, pv, 0, t);
    s += principal ? pmt - ip : ip;
  }
  return s;
}
def("CUMIPMT", 6, 6, function (a) { return cumulative(a, false); });
def("CUMPRINC", 6, 6, function (a) { return cumulative(a, true); });
/* Newton's method with a numeric slope; null when it does not settle */
function solve(f, guess) {
  var x = guess, h, fx, d;
  for (var i = 0; i < 100; i++) {
    fx = f(x);
    if (!isFinite(fx)) return null;
    if (Math.abs(fx) < 1e-10) return x;
    h = Math.max(1e-7, Math.abs(x) * 1e-7);
    d = (f(x + h) - fx) / h;
    if (!d || !isFinite(d)) return null;
    var nx = x - fx / d;
    if (nx <= -1) nx = (x - 1) / 2;
    if (Math.abs(nx - x) < 1e-12) return nx;
    x = nx;
  }
  return Math.abs(f(x)) < 1e-6 ? x : null;
}
def("RATE", 3, 6, function (a) {
  var n = toNum(a[0]), pmt = toNum(a[1]), pv = toNum(a[2]), fv = toNum(argOr(a, 3, 0)), t = toNum(argOr(a, 4, 0)) ? 1 : 0;
  var g = toNum(argOr(a, 5, 0.1));
  if (n <= 0) fail(ERR.NUM);
  var r = solve(function (x) {
    if (Math.abs(x) < 1e-12) return pv + pmt * n + fv;
    var q = Math.pow(1 + x, n);
    return pv * q + pmt * (1 + x * t) * (q - 1) / x + fv;
  }, g);
  if (r === null) fail(ERR.NUM);
  return r;
});
function cashFlows(v) {
  var out = [];
  eachVal([v], function (x, inR) {
    if (isErr(x)) fail(x);
    if (typeof x === "number") out.push(x);
    else if (!inR && x !== null) out.push(toNum(x));
  });
  return out;
}
function bothSigns(c) {
  var pos = false, neg = false;
  for (var i = 0; i < c.length; i++) { if (c[i] > 0) pos = true; if (c[i] < 0) neg = true; }
  if (!pos || !neg) fail(ERR.NUM);
}
def("IRR", 1, 2, function (a) {
  var c = cashFlows(a[0]);
  bothSigns(c);
  var r = solve(function (x) {
    var s = 0;
    for (var i = 0; i < c.length; i++) s += c[i] / Math.pow(1 + x, i);
    return s;
  }, toNum(argOr(a, 1, 0.1)));
  if (r === null) fail(ERR.NUM);
  return r;
});
function datedFlows(vs, ds) {
  var v = arr2(vs), d = arr2(ds), out = { v: [], d: [] };
  if (v.length !== d.length) fail(ERR.NUM);
  for (var i = 0; i < v.length; i++) {
    if (isErr(v[i])) fail(v[i]);
    if (isErr(d[i])) fail(d[i]);
    var dd = Math.floor(toNum(d[i]));
    if (dd < 0) fail(ERR.NUM);
    out.v.push(toNum(v[i])); out.d.push(dd);
  }
  if (!out.v.length) fail(ERR.NUM);
  for (i = 1; i < out.d.length; i++) if (out.d[i] < out.d[0]) fail(ERR.NUM);
  return out;
}
function xnpv(r, f) {
  var s = 0;
  for (var i = 0; i < f.v.length; i++) s += f.v[i] / Math.pow(1 + r, (f.d[i] - f.d[0]) / 365);
  return s;
}
def("XNPV", 3, 3, function (a) {
  var r = toNum(a[0]);
  if (r <= -1) fail(ERR.NUM);
  return xnpv(r, datedFlows(a[1], a[2]));
});
def("XIRR", 2, 3, function (a) {
  var f = datedFlows(a[0], a[1]);
  bothSigns(f.v);
  var r = solve(function (x) { return xnpv(x, f); }, toNum(argOr(a, 2, 0.1)));
  if (r === null) fail(ERR.NUM);
  return r;
});
def("MIRR", 3, 3, function (a) {
  var c = cashFlows(a[0]), fr = toNum(a[1]), rr = toNum(a[2]), n = c.length, pos = 0, neg = 0;
  if (n < 2) fail(ERR.DIV0);
  for (var i = 0; i < n; i++) {
    if (c[i] > 0) pos += c[i] / Math.pow(1 + rr, i);
    else neg += c[i] / Math.pow(1 + fr, i);
  }
  if (pos === 0 || neg === 0) fail(ERR.DIV0);
  return Math.pow(-pos * Math.pow(1 + rr, n - 1) / neg, 1 / (n - 1)) - 1;
});
def("SLN", 3, 3, function (a) {
  var l = toNum(a[2]);
  if (l === 0) fail(ERR.DIV0);
  return (toNum(a[0]) - toNum(a[1])) / l;
});
def("SYD", 4, 4, function (a) {
  var c = toNum(a[0]), s = toNum(a[1]), l = toNum(a[2]), p = toNum(a[3]);
  if (l <= 0 || p <= 0 || p > l) fail(ERR.NUM);
  return (c - s) * (l - p + 1) * 2 / (l * (l + 1));
});
def("DDB", 4, 5, function (a) {
  var c = toNum(a[0]), s = toNum(a[1]), l = toNum(a[2]), p = toNum(a[3]), f = toNum(argOr(a, 4, 2));
  if (c < 0 || s < 0 || l <= 0 || p <= 0 || p > l || f <= 0) fail(ERR.NUM);
  var acc = 0, dep = 0;
  for (var i = 1; i <= Math.ceil(p); i++) {
    dep = Math.max(0, Math.min((c - acc) * f / l, c - s - acc));
    acc += dep;
  }
  return dep;
});
def("DB", 4, 5, function (a) {
  var c = toNum(a[0]), s = toNum(a[1]), l = toNum(a[2]), p = toInt(a[3]), m = toInt(argOr(a, 4, 12));
  if (c < 0 || s < 0 || l <= 0 || p <= 0 || m < 1 || m > 12 || p > l + (m < 12 ? 1 : 0)) fail(ERR.NUM);
  if (c === 0) return 0;
  var rate = roundHalfAway(1 - Math.pow(s / c, 1 / l), 3), acc = c * rate * m / 12, dep = acc;
  if (p === 1) return dep;
  for (var i = 2; i <= p; i++) {
    dep = i === l + 1 ? (c - acc) * rate * (12 - m) / 12 : (c - acc) * rate;
    acc += dep;
  }
  return dep;
});
def("EFFECT", 2, 2, function (a) {
  var r = toNum(a[0]), p = Math.trunc(toNum(a[1]));
  if (r <= 0 || p < 1) fail(ERR.NUM);
  return Math.pow(1 + r / p, p) - 1;
});
def("NOMINAL", 2, 2, function (a) {
  var r = toNum(a[0]), p = Math.trunc(toNum(a[1]));
  if (r <= 0 || p < 1) fail(ERR.NUM);
  return p * (Math.pow(1 + r, 1 / p) - 1);
});

/* ---- lookup ---- */
def("XMATCH", 2, 4, function (a) {
  var mode = toInt(argOr(a, 2, 0)), dir = toInt(argOr(a, 3, 1));
  if ([-1, 0, 1, 2].indexOf(mode) < 0) fail(ERR.VALUE);
  var i = lookupPos(a[0], vector(a[1]), mode === -1 ? 1 : mode === 1 ? -1 : mode, dir < 0 ? -1 : 1);
  if (i < 0) fail(ERR.NA);
  return i + 1;
});
def("LOOKUP", 2, 3, function (a) {
  var lk = arr2(a[1]), d = dims(lk), res;
  if (a[2] === undefined && d.rows > 1 && d.cols > 1) {
    if (d.cols > d.rows) { res = rowOf(lk, d.rows - 1); lk = rowOf(lk, 0); }
    else { res = colOf(lk, d.cols - 1); lk = colOf(lk, 0); }
  } else res = a[2] === undefined ? lk : vector(a[2]);
  var i = lookupPos(a[0], vector(lk), 1, 1);
  if (i < 0 || i >= res.length) fail(ERR.NA);
  var v = res[i];
  return v === undefined ? null : v;
});
function sheetPrefix(name) {
  if (name === "") return "";
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !CELL_RE.test(name) ? name + "!" : "'" + name.replace(/'/g, "''") + "'!";
}
def("ADDRESS", 2, 5, function (a) {
  var r = toInt(a[0]), c = toInt(a[1]), abs = toInt(argOr(a, 2, 1)), a1 = toBool(argOr(a, 3, true));
  if (r < 1 || c < 1 || r > MAX_ROWS || c > 16384 || abs < 1 || abs > 4) fail(ERR.VALUE);
  var pre = a[4] === undefined ? "" : sheetPrefix(toStr(a[4]));
  var ar = abs === 1 || abs === 2, ac = abs === 1 || abs === 3;
  if (!a1) return pre + (ar ? "R" + r : "R[" + r + "]") + (ac ? "C" + c : "C[" + c + "]");
  return pre + (ac ? "$" : "") + colName(c - 1) + (ar ? "$" : "") + r;
});
/* OFFSET and INDIRECT build a reference; they get the engine (eng) */
function refBase(node, cx, ev, eng) {
  if (node.k === "ref") {
    var ref = node.ref, sid = ref.sheet === null ? cx.sid : eng.ctx.sheetId(ref.sheet);
    if (sid === null || sid === undefined) fail(ERR.REF);
    var b = ref.b || ref.a;
    var r1 = Math.max(ref.a.r, b.r);
    if (ref.cols) {
      var ext = eng.ctx.extent ? eng.ctx.extent(sid) : null;
      r1 = Math.max(0, Math.min(r1, (ext && ext.rows ? ext.rows : 1) - 1));
    }
    return { sid: sid, r: Math.min(ref.a.r, b.r), c: Math.min(ref.a.c, b.c),
             h: r1 - Math.min(ref.a.r, b.r) + 1, w: Math.abs(b.c - ref.a.c) + 1 };
  }
  var v = ev(node);
  if (isErr(v)) fail(v);
  if (isArr(v) && v.r0 !== undefined) { var d = dims(v); return { sid: v.sid, r: v.r0, c: v.c0, h: d.rows, w: d.cols }; }
  fail(ERR.VALUE);
}
function argInt(node, ev, d) {
  if (!node || node.k === "empty") return d;
  var v = scalar(ev(node));
  if (isErr(v)) fail(v);
  return toInt(v);
}
lazy("OFFSET", 3, 5, function (n, cx, ev, eng) {
  var b = refBase(n[0], cx, ev, eng);
  var r = b.r + argInt(n[1], ev, 0), c = b.c + argInt(n[2], ev, 0);
  var h = argInt(n[3], ev, b.h), w = argInt(n[4], ev, b.w);
  if (h === 0 || w === 0) return ERR.REF;
  if (h < 0) { r += h + 1; h = -h; }
  if (w < 0) { c += w + 1; w = -w; }
  if (r < 0 || c < 0 || r + h > MAX_ROWS || c + w > MAX_COLS) return ERR.REF;
  return eng.box(b.sid, r, c, r + h - 1, c + w - 1, cx);
});
lazy("INDIRECT", 1, 2, function (n, cx, ev, eng) {
  var v = scalar(ev(n[0]));
  if (isErr(v)) return v;
  if (n[1] && n[1].k !== "empty" && !toBool(scalar(ev(n[1])))) return ERR.REF;   /* R1C1: not supported */
  var tk = tokenize("=" + toStr(v).trim());
  if (tk.length !== 1 || tk[0].t !== T.REF) return ERR.REF;
  var ref = tk[0].ref, sid = ref.sheet === null ? cx.sid : eng.ctx.sheetId(ref.sheet);
  if (sid === null || sid === undefined) return ERR.REF;
  var b = ref.b || ref.a, r1 = Math.max(ref.a.r, b.r);
  if (ref.cols) {
    var ext = eng.ctx.extent ? eng.ctx.extent(sid) : null;
    r1 = Math.min(r1, (ext && ext.rows ? ext.rows : 1) - 1);
  }
  return eng.box(sid, Math.min(ref.a.r, b.r), Math.min(ref.a.c, b.c), r1, Math.max(ref.a.c, b.c), cx);
});

/* a function result handed on: ranges stay, blanks stay blank */
function valueOf(v) { return v; }

/* ===== evaluator ===== */
var DEEP = { deep: true };
var MAX_DEPTH = 1200;
var MAX_CELLS = 2000000;

/* ctx = { raw(sid,r,c) -> string, cached(sid,r,c) -> string|undefined,
           sheetId(name) -> sid|null, extent(sid) -> {rows, cols},
           formulaCells() -> [[sid,r,c],…], lang, now() -> ms } */
function Engine(ctx) {
  this.ctx = ctx;
  this.cache = {};
  this.visiting = {};
  this.asts = {};
  this.nAst = 0;
  /* iterative calculation (wave 4.2): null = off (a cycle is #CYC!),
     else { n: max iterations, d: max change }. prev holds the last
     settled value of each formula cell and survives reset(), so the
     next recalculation starts from there, as in Excel. */
  this.iter = null;
  this.prev = {};
  this.cyc = false;
}
Engine.prototype.reset = function () { this.cache = {}; this.visiting = {}; this.cyc = false; };
Engine.prototype.setIter = function (o) {
  var n = o && o.it ? Math.max(1, Math.min(1000, Math.floor(o.n) || 100)) : 0;
  this.iter = n ? { n: n, d: (typeof o.d === "number" && o.d > 0) ? o.d : 0.001 } : null;
  if (!this.iter) this.prev = {};
  this.reset();
};
/* with iteration on: evaluate every formula cell, and while a circular
   reference was met, again from the values just found, until no
   number moves by more than d or n rounds are done. -> rounds run */
Engine.prototype.settle = function () {
  if (!this.iter || !this.ctx.formulaCells) return 0;
  var list = this.ctx.formulaCells(), k, i, key, round;
  for (round = 1; round <= this.iter.n; round++) {
    this.reset();
    for (i = 0; i < list.length; i++) this.value(list[i][0], list[i][1], list[i][2]);
    if (!this.cyc) return round;
    var moved = false, next = {};
    for (i = 0; i < list.length; i++) {
      key = list[i][0] + "|" + list[i][1] + "|" + list[i][2];
      var v = this.cache[key], w = this.prev[key];
      next[key] = v;
      if (typeof v === "number" && typeof w === "number") { if (Math.abs(v - w) > this.iter.d) moved = true; }
      else if (v !== w) moved = true;
    }
    for (k in next) this.prev[k] = next[k];
    if (!moved) return round;
  }
  return this.iter.n;
};

Engine.prototype.ast = function (raw) {
  var a = this.asts[raw];
  if (a === undefined) {
    try { a = parse(raw); } catch (e) { if (e instanceof Fx) a = null; else throw e; }
    if (this.nAst > 5000) { this.asts = {}; this.nAst = 0; }
    this.asts[raw] = a; this.nAst++;
  }
  return a;
};

Engine.prototype.cell = function (sid, r, c, depth) {
  var key = sid + "|" + r + "|" + c, cache = this.cache;
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  var raw = this.ctx.raw(sid, r, c);
  if (raw === "" || raw === null || raw === undefined) return null;
  if (raw.charAt(0) !== "=") { var lv = literal(raw); cache[key] = lv; return lv; }
  if (this.visiting[key]) {
    if (!this.iter) return ERR.CYC;
    /* a circular reference: use this cell's value from the last round */
    this.cyc = true;
    var pv = this.prev[key];
    return pv === undefined ? 0 : pv;
  }
  if (depth > MAX_DEPTH) throw DEEP;
  this.visiting[key] = true;
  var res;
  try {
    var ast = this.ast(raw);
    if (!ast) res = ERR.ERROR;
    else res = this.ev(ast, { sid: sid, r: r, c: c, depth: depth, lang: this.ctx.lang, now: this.ctx.now || Date.now });
    res = scalar(res);
    if (res === null || res === undefined) res = 0;
    if (typeof res === "number" && !isFinite(res)) res = ERR.NUM;
  } catch (e) {
    if (e === DEEP) { delete this.visiting[key]; throw e; }
    if (e instanceof Fx) res = e.fx;
    else if (e instanceof RangeError) { delete this.visiting[key]; throw DEEP; }
    else res = ERR.ERROR;
  }
  delete this.visiting[key];
  /* imported formula we cannot compute (unknown function, external
     reference): keep the spreadsheet program's own cached result */
  if (res === ERR.NAME || res === ERR.ERROR || res === ERR.REF) {
    var cv = this.ctx.cached ? this.ctx.cached(sid, r, c) : undefined;
    if (typeof cv === "string" && cv !== "") res = literal(cv);
  }
  cache[key] = res;
  return res;
};

/* the value of one cell (deep chains are evaluated top-down first) */
Engine.prototype.value = function (sid, r, c) {
  for (var attempt = 0; attempt < 4; attempt++) {
    try { return this.cell(sid, r, c, 0); }
    catch (e) {
      if (e !== DEEP) throw e;
      this.visiting = {};
      this.warm(attempt % 2 === 1);
    }
  }
  return ERR.NUM;
};
Engine.prototype.warm = function (backwards) {
  var list = this.ctx.formulaCells ? this.ctx.formulaCells() : [];
  for (var k = 0; k < list.length; k++) {
    var i = backwards ? list.length - 1 - k : k;
    try { this.cell(list[i][0], list[i][1], list[i][2], 0); }
    catch (e) { if (e !== DEEP) throw e; this.visiting = {}; }
  }
};

Engine.prototype.area = function (ref, cx) {
  var sid = ref.sheet === null ? cx.sid : this.ctx.sheetId(ref.sheet);
  if (sid === null || sid === undefined) fail(ERR.REF);
  var a = ref.a, b = ref.b || ref.a;
  var r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
  if (ref.cols) {
    var ext = this.ctx.extent ? this.ctx.extent(sid) : { rows: 0 };
    r1 = Math.min(r1, (ext && ext.rows ? ext.rows : 0) - 1);
  }
  return this.box(sid, r0, c0, r1, c1, cx);
};
/* the values of a block of cells of sheet sid, as a range array */
Engine.prototype.box = function (sid, r0, c0, r1, c1, cx) {
  var rows = Math.max(0, r1 - r0 + 1), cols = c1 - c0 + 1;
  if (rows * cols > MAX_CELLS) fail(ERR.NUM);
  var vals = [];
  for (var r = r0; r <= r1; r++)
    for (var c = c0; c <= c1; c++) vals.push(this.cell(sid, r, c, cx.depth + 1));
  var arr = mkArr(vals, rows, cols);
  arr.sid = sid; arr.r0 = r0; arr.c0 = c0;
  return arr;
};

function elementwise(a, b, f) {
  var A = isArr(a), B = isArr(b);
  if (!A && !B) return f(a, b);
  var da = dims(a), db = dims(b);
  var rows = Math.max(A ? da.rows : 1, B ? db.rows : 1), cols = Math.max(A ? da.cols : 1, B ? db.cols : 1);
  var out = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var x = A ? (da.rows === 1 ? at(a, 0, da.cols === 1 ? 0 : c) : (da.cols === 1 ? at(a, r, 0) : at(a, r, c))) : a;
    var y = B ? (db.rows === 1 ? at(b, 0, db.cols === 1 ? 0 : c) : (db.cols === 1 ? at(b, r, 0) : at(b, r, c))) : b;
    if (x === undefined || y === undefined) { out.push(ERR.NA); continue; }
    try { out.push(f(x, y)); } catch (e) { if (e instanceof Fx) out.push(e.fx); else throw e; }
  }
  return mkArr(out, rows, cols);
}
function arith(op) {
  return function (x, y) {
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    if (op === "&") return toStr(x) + toStr(y);
    if (CMP[op]) {
      var c = cmpVals(x === undefined ? null : x, y === undefined ? null : y);
      return op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 :
             op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
    }
    var a = toNum(x), b = toNum(y);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": if (b === 0) return ERR.DIV0; return a / b;
      case "^": { var p = Math.pow(a, b); return (isNaN(p) || !isFinite(p)) ? ERR.NUM : p; }
    }
    return ERR.ERROR;
  };
}
var ARITH = {};
["+", "-", "*", "/", "^", "&", "=", "<>", "<", ">", "<=", ">="].forEach(function (o) { ARITH[o] = arith(o); });

Engine.prototype.ev = function (n, cx) {
  var self = this;
  switch (n.k) {
    case "v": return n.v;
    case "arr": return mkArr(n.v.slice(), n.rows, n.cols);
    case "empty": return undefined;
    case "ref": {
      if (!n.ref.b && !n.ref.cols) {
        var sid = n.ref.sheet === null ? cx.sid : this.ctx.sheetId(n.ref.sheet);
        if (sid === null || sid === undefined) return ERR.REF;
        return this.cell(sid, n.ref.a.r, n.ref.a.c, cx.depth + 1);
      }
      return this.area(n.ref, cx);
    }
    case "neg": return elementwise(this.ev(n.a, cx), 0, function (x) { if (isErr(x)) return x; return -toNum(x); });
    case "pct": return elementwise(this.ev(n.a, cx), 0, function (x) { if (isErr(x)) return x; return toNum(x) / 100; });
    case "op": return elementwise(this.ev(n.a, cx), this.ev(n.b, cx), ARITH[n.op]);
    case "fn": {
      var name = n.name, args = n.args, lz = L[name];
      if (lz) {
        if (args.length < lz.min || args.length > lz.max) return ERR.VALUE;
        try { return lz.f(args, cx, function (x) { return x.k === "empty" ? undefined : self.ev(x, cx); }, self); }
        catch (e) { if (e instanceof Fx) return e.fx; throw e; }
      }
      var fd = F[name];
      if (!fd) return ERR.NAME;
      if (args.length < fd.min || args.length > fd.max) return ERR.VALUE;
      var vals = [];
      for (var i = 0; i < args.length; i++) {
        var x = args[i];
        if (x.k === "ref" && !x.ref.b && !x.ref.cols) {
          /* a single reference arrives as a 1x1 range (blank stays null) */
          var sid2 = x.ref.sheet === null ? cx.sid : this.ctx.sheetId(x.ref.sheet);
          if (sid2 === null || sid2 === undefined) { vals.push(ERR.REF); continue; }
          var one = mkArr([this.cell(sid2, x.ref.a.r, x.ref.a.c, cx.depth + 1)], 1, 1);
          one.sid = sid2; one.r0 = x.ref.a.r; one.c0 = x.ref.a.c;
          vals.push(one);
        } else vals.push(x.k === "empty" ? undefined : this.ev(x, cx));
      }
      if (!fd.raw) {
        for (i = 0; i < vals.length; i++) {
          var sv = vals[i];
          if (!isArr(sv) && isErr(sv)) return sv;
        }
      }
      try { return fd.f(vals, cx); }
      catch (e2) { if (e2 instanceof Fx) return e2.fx; throw e2; }
    }
  }
  return ERR.ERROR;
};

/* evaluate a formula string outside any sheet (tests, previews) */
Engine.prototype.formula = function (sid, formula) {
  var ast = this.ast(formula);                 /* parsed once, then cached */
  if (!ast) return ERR.ERROR;
  try { return scalar(this.ev(ast, { sid: sid, r: 0, c: 0, depth: 0, lang: this.ctx.lang, now: this.ctx.now || Date.now })); }
  catch (e) { if (e instanceof Fx) return e.fx; if (e === DEEP || e instanceof RangeError) return ERR.NUM; throw e; }
};

/* ===== reference rewriting (copy / sort / insert / delete) ===== */
function refText(ref, a, b) {
  function one(p, colOnly) {
    return (p.ac ? "$" : "") + colName(p.c) + (colOnly ? "" : (p.ar ? "$" : "") + (p.r + 1));
  }
  if (ref.cols) return ref.sheetRaw + one(a, true) + ":" + one(b, true);
  return ref.sheetRaw + one(a) + (b ? ":" + one(b) : "");
}
/* rebuild a formula, replacing each reference with fn(ref) -> text|null
   (null keeps the original text). Everything else stays verbatim. */
function mapRefs(formula, fn) {
  if (typeof formula !== "string" || formula.charAt(0) !== "=") return formula;
  var tk = tokenize(formula), out = "", last = 0, changed = false;
  for (var i = 0; i < tk.length; i++) {
    if (tk[i].t !== T.REF) continue;
    var rep = fn(tk[i].ref);
    if (rep === null || rep === undefined) continue;
    out += formula.slice(last, tk[i].s) + rep;
    last = tk[i].e; changed = true;
  }
  if (!changed) return formula;
  return out + formula.slice(last);
}
/* copy/paste: relative parts move by (dr, dc); $ parts stay */
function shiftFormula(formula, dr, dc, maxRows, maxCols) {
  if (!dr && !dc) return formula;
  maxRows = maxRows || MAX_ROWS; maxCols = maxCols || MAX_COLS;
  return mapRefs(formula, function (ref) {
    function mv(p, colOnly) {
      var q = { c: p.ac ? p.c : p.c + dc, r: colOnly || p.ar ? p.r : p.r + dr, ac: p.ac, ar: p.ar };
      if (q.c < 0 || q.c >= maxCols || (!colOnly && (q.r < 0 || q.r >= maxRows))) return null;
      return q;
    }
    var a = mv(ref.a, ref.cols), b = ref.b ? mv(ref.b, ref.cols) : null;
    if (!a || (ref.b && !b)) return ref.sheetRaw + ERR.REF;
    return refText(ref, a, b);
  });
}
/* insert (n > 0) or delete (n < 0) rows ("r") or columns ("c") at
   index `at` of the sheet `target`. isTarget(sheetNameOrNull) says
   whether a reference points at that sheet. Absolute parts move too
   (as in Excel); a reference wholly inside a deleted band -> #REF!. */
function adjustFormula(formula, isTarget, axis, at, n) {
  return mapRefs(formula, function (ref) {
    if (!isTarget(ref.sheet)) return null;
    if (ref.cols && axis === "r") return null;
    var k = axis === "r" ? "r" : "c";
    var a = { c: ref.a.c, r: ref.a.r, ac: ref.a.ac, ar: ref.a.ar };
    var b = ref.b ? { c: ref.b.c, r: ref.b.r, ac: ref.b.ac, ar: ref.b.ar } : null;
    if (n > 0) {
      if (a[k] >= at) a[k] += n;
      if (b && b[k] >= at) b[k] += n;
    } else {
      var cnt = -n, end = at + cnt - 1;
      if (!b) {
        if (a[k] >= at && a[k] <= end) return ref.sheetRaw + ERR.REF;
        if (a[k] > end) a[k] -= cnt;
      } else {
        var lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]);
        if (lo >= at && hi <= end) return ref.sheetRaw + ERR.REF;
        var nlo = lo > end ? lo - cnt : (lo >= at ? at : lo);
        var nhi = hi > end ? hi - cnt : (hi >= at ? at - 1 : hi);
        if (a[k] <= b[k]) { a[k] = nlo; b[k] = nhi; } else { b[k] = nlo; a[k] = nhi; }
      }
    }
    if (a.r === ref.a.r && a.c === ref.a.c && (!b || (b.r === ref.b.r && b.c === ref.b.c))) return null;
    return refText(ref, a, b);
  });
}

/* ===== display helpers ===== */
function display(v, lang) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    if (!isFinite(v)) return ERR.NUM;
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toFixed(10)));
  }
  void lang;
  return String(v);
}
/* formulas Excel shows as a date by itself */
var DATE_FN = /^=\s*(TODAY|DATE|EDATE|EOMONTH|DATEVALUE|WORKDAY(?:\.INTL)?)\s*\(/i;
var DATETIME_FN = /^=\s*NOW\s*\(/i;
function autoDate(raw) { return DATETIME_FN.test(raw) ? "dt" : (DATE_FN.test(raw) ? "d" : null); }

/* ===== help (name -> one line, EN / EL) ===== */
var HELP = {
  en: {
    SUM: "Adds numbers", AVERAGE: "Average of numbers", MIN: "Smallest number", MAX: "Largest number",
    COUNT: "Counts cells with numbers", COUNTA: "Counts non-empty cells", COUNTBLANK: "Counts empty cells",
    COUNTIF: "Counts cells that meet a condition", COUNTIFS: "Counts rows that meet several conditions",
    SUMIF: "Adds the cells that meet a condition", SUMIFS: "Adds the cells that meet several conditions",
    AVERAGEIF: "Average of the cells that meet a condition", AVERAGEIFS: "Average of the cells that meet several conditions",
    MAXIFS: "Largest value that meets conditions", MINIFS: "Smallest value that meets conditions",
    PRODUCT: "Multiplies numbers", SUMPRODUCT: "Sum of the products of matching items",
    ROUND: "Rounds to a number of digits", ROUNDUP: "Rounds away from zero", ROUNDDOWN: "Rounds toward zero",
    INT: "Rounds down to an integer", TRUNC: "Cuts off the decimals", ABS: "Absolute value", MOD: "Remainder of a division",
    POWER: "Number raised to a power", SQRT: "Square root", PI: "The number pi", RAND: "Random number from 0 to 1",
    RANDBETWEEN: "Random whole number between two numbers", CEILING: "Rounds up to a multiple", FLOOR: "Rounds down to a multiple",
    LN: "Natural logarithm", LOG: "Logarithm to a base", LOG10: "Base-10 logarithm", EXP: "e raised to a power", SIGN: "Sign of a number",
    MEDIAN: "Middle value", MODE: "Most frequent value", STDEV: "Standard deviation of a sample",
    "STDEV.S": "Standard deviation of a sample", "STDEV.P": "Standard deviation of a population",
    VAR: "Variance of a sample", "VAR.P": "Variance of a population", LARGE: "The k-th largest value", SMALL: "The k-th smallest value",
    RANK: "Rank of a number in a list", PERCENTILE: "The k-th percentile", QUARTILE: "A quartile of the data",
    VLOOKUP: "Finds a value in the first column and returns one from its row",
    HLOOKUP: "Finds a value in the first row and returns one from its column",
    XLOOKUP: "Finds a value in one range and returns the matching item of another",
    INDEX: "Value at a row and column of a range", MATCH: "Position of a value in a list",
    CHOOSE: "Picks a value from a list by number", ROW: "Row number", COLUMN: "Column number",
    ROWS: "Number of rows in a range", COLUMNS: "Number of columns in a range",
    IF: "One value if a condition is true, another if not", IFS: "First value whose condition is true",
    SWITCH: "Value matching a case", IFERROR: "A fallback when the value is an error", IFNA: "A fallback when the value is #N/A",
    AND: "True when all conditions are true", OR: "True when any condition is true", NOT: "Reverses true and false",
    XOR: "True when an odd number of conditions are true",
    ISBLANK: "Whether the cell is empty", ISNUMBER: "Whether the value is a number", ISTEXT: "Whether the value is text",
    ISERROR: "Whether the value is an error", ISNA: "Whether the value is #N/A", ISLOGICAL: "Whether the value is TRUE or FALSE",
    ISEVEN: "Whether the number is even", ISODD: "Whether the number is odd", NA: "The #N/A error",
    LEN: "Number of characters", LEFT: "First characters of a text", RIGHT: "Last characters of a text",
    MID: "Characters from the middle of a text", UPPER: "Text in capitals", LOWER: "Text in small letters",
    PROPER: "First letter of each word in capitals", TRIM: "Removes extra spaces",
    SUBSTITUTE: "Replaces text with other text", REPLACE: "Replaces characters at a position",
    FIND: "Position of a text (case-sensitive)", SEARCH: "Position of a text (any case, wildcards)",
    TEXT: "Number as text in a format such as 0.00 or dd/mm/yyyy", VALUE: "Text as a number",
    TEXTJOIN: "Joins texts with a separator", CONCAT: "Joins texts", REPT: "Repeats a text", EXACT: "Whether two texts are identical",
    CHAR: "Character of a code", CODE: "Code of the first character",
    TODAY: "Today's date", NOW: "Date and time now", DATE: "Date from year, month and day", TIME: "Time from hours, minutes and seconds",
    DATEVALUE: "Date written as text as a date", YEAR: "Year of a date", MONTH: "Month of a date", DAY: "Day of a date",
    HOUR: "Hour of a time", MINUTE: "Minute of a time", SECOND: "Second of a time",
    WEEKDAY: "Day of the week as a number", DAYS: "Days between two dates", DATEDIF: "Years, months or days between two dates",
    EDATE: "Date some months before or after", EOMONTH: "Last day of a month some months away",
    NETWORKDAYS: "Working days between two dates", WORKDAY: "Date some working days away",
    PMT: "Payment of a loan per period", FV: "Future value of an investment", PV: "Present value of an investment",
    NPER: "Number of payment periods", NPV: "Net present value of cash flows",
    SUMSQ: "Sum of the squares", STDEVP: "Standard deviation of a population", VARP: "Variance of a population",
    CONCATENATE: "Joins texts", AVG: "Average of numbers", ISERR: "Whether the value is an error other than #N/A",
    ISNONTEXT: "Whether the value is not text", TRUE: "The value TRUE", FALSE: "The value FALSE",
    GCD: "Greatest common divisor", LCM: "Least common multiple", FACT: "Factorial (5! = 120)",
    COMBIN: "Number of ways to choose k items", PERMUT: "Number of ordered ways to pick k items",
    MROUND: "Rounds to the nearest multiple", EVEN: "Rounds up to an even number", ODD: "Rounds up to an odd number",
    QUOTIENT: "Whole part of a division", SIN: "Sine (radians)", COS: "Cosine (radians)", TAN: "Tangent (radians)",
    ASIN: "Arcsine in radians", ACOS: "Arccosine in radians", ATAN: "Arctangent in radians", ATAN2: "Angle of the point x, y in radians",
    SINH: "Hyperbolic sine", COSH: "Hyperbolic cosine", TANH: "Hyperbolic tangent",
    RADIANS: "Degrees to radians", DEGREES: "Radians to degrees",
    "CEILING.MATH": "Rounds up to a multiple (negatives toward or away from zero)",
    "FLOOR.MATH": "Rounds down to a multiple (negatives toward or away from zero)",
    SUBTOTAL: "SUM, AVERAGE, COUNT and others by number (9 = SUM)",
    AVERAGEA: "Average where text counts as 0 and TRUE as 1", MAXA: "Largest value, text as 0", MINA: "Smallest value, text as 0",
    GEOMEAN: "Geometric mean", HARMEAN: "Harmonic mean", CORREL: "Correlation of two ranges", PEARSON: "Correlation of two ranges",
    RSQ: "Square of the correlation (R²)", SLOPE: "Slope of the trend line", INTERCEPT: "Where the trend line crosses the y axis",
    FORECAST: "A value on the trend line", "FORECAST.LINEAR": "A value on the trend line",
    "NORM.DIST": "Normal distribution", NORMDIST: "Normal distribution", "NORM.S.DIST": "Standard normal distribution",
    "NORM.INV": "Inverse of the normal distribution", NORMINV: "Inverse of the normal distribution",
    "NORM.S.INV": "Inverse of the standard normal distribution", NORMSINV: "Inverse of the standard normal distribution",
    STANDARDIZE: "How many standard deviations from the mean",
    WEEKNUM: "Week number of the year", ISOWEEKNUM: "ISO week number of the year", YEARFRAC: "Fraction of a year between two dates",
    DAYS360: "Days between two dates in a 360-day year", TIMEVALUE: "Time written as text as a fraction of a day",
    "NETWORKDAYS.INTL": "Working days between two dates, with your own weekend",
    "WORKDAY.INTL": "Date some working days away, with your own weekend",
    TEXTBEFORE: "Text before a delimiter", TEXTAFTER: "Text after a delimiter", CLEAN: "Removes non-printing characters",
    UNICHAR: "Character of a Unicode number", UNICODE: "Unicode number of the first character",
    NUMBERVALUE: "Text as a number with chosen separators", FIXED: "Number as text with fixed decimals",
    T: "The text, or empty when it is not text", N: "The value as a number",
    IPMT: "Interest part of a loan payment", PPMT: "Principal part of a loan payment",
    CUMIPMT: "Interest paid between two periods", CUMPRINC: "Principal paid between two periods",
    RATE: "Interest rate per period of a loan or investment", IRR: "Internal rate of return",
    XNPV: "Net present value of dated cash flows", XIRR: "Internal rate of return of dated cash flows",
    MIRR: "Modified internal rate of return", SLN: "Straight-line depreciation per period",
    SYD: "Sum-of-years' digits depreciation", DDB: "Double-declining balance depreciation",
    DB: "Fixed-declining balance depreciation", EFFECT: "Effective annual interest rate", NOMINAL: "Nominal annual interest rate",
    XMATCH: "Position of a value, exact by default", LOOKUP: "Finds a value in a sorted list and returns the matching item",
    ADDRESS: "A cell address as text", OFFSET: "A range some rows and columns away from another",
    INDIRECT: "The range named by a text such as \"B2\" or \"Sheet2!A1:A9\"",
    "MODE.SNGL": "Most frequent value", "PERCENTILE.INC": "The k-th percentile", "QUARTILE.INC": "A quartile of the data",
    "RANK.EQ": "Rank of a number in a list", "VAR.S": "Variance of a sample"
  },
  el: {
    SUM: "Άθροισμα αριθμών", AVERAGE: "Μέσος όρος αριθμών", MIN: "Ο μικρότερος αριθμός", MAX: "Ο μεγαλύτερος αριθμός",
    COUNT: "Μετρά τα κελιά με αριθμούς", COUNTA: "Μετρά τα μη κενά κελιά", COUNTBLANK: "Μετρά τα κενά κελιά",
    COUNTIF: "Μετρά τα κελιά που πληρούν μια συνθήκη", COUNTIFS: "Μετρά τις γραμμές που πληρούν πολλές συνθήκες",
    SUMIF: "Αθροίζει τα κελιά που πληρούν μια συνθήκη", SUMIFS: "Αθροίζει τα κελιά που πληρούν πολλές συνθήκες",
    AVERAGEIF: "Μέσος όρος των κελιών που πληρούν μια συνθήκη", AVERAGEIFS: "Μέσος όρος των κελιών που πληρούν πολλές συνθήκες",
    MAXIFS: "Η μεγαλύτερη τιμή που πληροί συνθήκες", MINIFS: "Η μικρότερη τιμή που πληροί συνθήκες",
    PRODUCT: "Γινόμενο αριθμών", SUMPRODUCT: "Άθροισμα των γινομένων αντίστοιχων στοιχείων",
    ROUND: "Στρογγυλοποίηση σε ψηφία", ROUNDUP: "Στρογγυλοποίηση μακριά από το μηδέν", ROUNDDOWN: "Στρογγυλοποίηση προς το μηδέν",
    INT: "Στρογγυλοποίηση προς τα κάτω σε ακέραιο", TRUNC: "Αποκόπτει τα δεκαδικά", ABS: "Απόλυτη τιμή", MOD: "Υπόλοιπο διαίρεσης",
    POWER: "Αριθμός υψωμένος σε δύναμη", SQRT: "Τετραγωνική ρίζα", PI: "Ο αριθμός π", RAND: "Τυχαίος αριθμός από 0 έως 1",
    RANDBETWEEN: "Τυχαίος ακέραιος ανάμεσα σε δύο αριθμούς", CEILING: "Στρογγυλοποίηση προς τα πάνω σε πολλαπλάσιο", FLOOR: "Στρογγυλοποίηση προς τα κάτω σε πολλαπλάσιο",
    LN: "Φυσικός λογάριθμος", LOG: "Λογάριθμος με βάση", LOG10: "Δεκαδικός λογάριθμος", EXP: "Το e υψωμένο σε δύναμη", SIGN: "Πρόσημο αριθμού",
    MEDIAN: "Διάμεσος", MODE: "Η συχνότερη τιμή", STDEV: "Τυπική απόκλιση δείγματος",
    "STDEV.S": "Τυπική απόκλιση δείγματος", "STDEV.P": "Τυπική απόκλιση πληθυσμού",
    VAR: "Διακύμανση δείγματος", "VAR.P": "Διακύμανση πληθυσμού", LARGE: "Η k-οστή μεγαλύτερη τιμή", SMALL: "Η k-οστή μικρότερη τιμή",
    RANK: "Η θέση ενός αριθμού σε λίστα", PERCENTILE: "Το k-οστό εκατοστημόριο", QUARTILE: "Τεταρτημόριο των δεδομένων",
    VLOOKUP: "Βρίσκει τιμή στην πρώτη στήλη και δίνει μια τιμή της γραμμής της",
    HLOOKUP: "Βρίσκει τιμή στην πρώτη γραμμή και δίνει μια τιμή της στήλης της",
    XLOOKUP: "Βρίσκει τιμή σε μια περιοχή και δίνει το αντίστοιχο στοιχείο άλλης",
    INDEX: "Τιμή σε γραμμή και στήλη μιας περιοχής", MATCH: "Η θέση μιας τιμής σε λίστα",
    CHOOSE: "Διαλέγει τιμή από λίστα με αριθμό", ROW: "Αριθμός γραμμής", COLUMN: "Αριθμός στήλης",
    ROWS: "Πλήθος γραμμών περιοχής", COLUMNS: "Πλήθος στηλών περιοχής",
    IF: "Μία τιμή αν η συνθήκη ισχύει, άλλη αν όχι", IFS: "Η πρώτη τιμή της οποίας η συνθήκη ισχύει",
    SWITCH: "Η τιμή της περίπτωσης που ταιριάζει", IFERROR: "Εναλλακτική τιμή όταν υπάρχει σφάλμα", IFNA: "Εναλλακτική τιμή όταν η τιμή είναι #N/A",
    AND: "Αληθές όταν ισχύουν όλες οι συνθήκες", OR: "Αληθές όταν ισχύει κάποια συνθήκη", NOT: "Αντιστρέφει το αληθές και το ψευδές",
    XOR: "Αληθές όταν ισχύει περιττό πλήθος συνθηκών",
    ISBLANK: "Αν το κελί είναι κενό", ISNUMBER: "Αν η τιμή είναι αριθμός", ISTEXT: "Αν η τιμή είναι κείμενο",
    ISERROR: "Αν η τιμή είναι σφάλμα", ISNA: "Αν η τιμή είναι #N/A", ISLOGICAL: "Αν η τιμή είναι TRUE ή FALSE",
    ISEVEN: "Αν ο αριθμός είναι άρτιος", ISODD: "Αν ο αριθμός είναι περιττός", NA: "Το σφάλμα #N/A",
    LEN: "Πλήθος χαρακτήρων", LEFT: "Οι πρώτοι χαρακτήρες κειμένου", RIGHT: "Οι τελευταίοι χαρακτήρες κειμένου",
    MID: "Χαρακτήρες από τη μέση κειμένου", UPPER: "Κείμενο με κεφαλαία", LOWER: "Κείμενο με πεζά",
    PROPER: "Κεφαλαίο το πρώτο γράμμα κάθε λέξης", TRIM: "Αφαιρεί τα περιττά κενά",
    SUBSTITUTE: "Αντικαθιστά κείμενο με άλλο", REPLACE: "Αντικαθιστά χαρακτήρες σε μια θέση",
    FIND: "Θέση κειμένου (με διάκριση πεζών-κεφαλαίων)", SEARCH: "Θέση κειμένου (χωρίς διάκριση, με μπαλαντέρ)",
    TEXT: "Αριθμός ως κείμενο σε μορφή όπως 0.00 ή dd/mm/yyyy", VALUE: "Κείμενο ως αριθμός",
    TEXTJOIN: "Ενώνει κείμενα με διαχωριστικό", CONCAT: "Ενώνει κείμενα", REPT: "Επαναλαμβάνει ένα κείμενο", EXACT: "Αν δύο κείμενα είναι ίδια",
    CHAR: "Ο χαρακτήρας ενός κωδικού", CODE: "Ο κωδικός του πρώτου χαρακτήρα",
    TODAY: "Η σημερινή ημερομηνία", NOW: "Ημερομηνία και ώρα τώρα", DATE: "Ημερομηνία από έτος, μήνα και ημέρα", TIME: "Ώρα από ώρες, λεπτά και δευτερόλεπτα",
    DATEVALUE: "Ημερομηνία γραμμένη ως κείμενο σε ημερομηνία", YEAR: "Το έτος μιας ημερομηνίας", MONTH: "Ο μήνας μιας ημερομηνίας", DAY: "Η ημέρα μιας ημερομηνίας",
    HOUR: "Η ώρα μιας χρονικής τιμής", MINUTE: "Τα λεπτά μιας χρονικής τιμής", SECOND: "Τα δευτερόλεπτα μιας χρονικής τιμής",
    WEEKDAY: "Η ημέρα της εβδομάδας ως αριθμός", DAYS: "Ημέρες ανάμεσα σε δύο ημερομηνίες", DATEDIF: "Έτη, μήνες ή ημέρες ανάμεσα σε δύο ημερομηνίες",
    EDATE: "Ημερομηνία κάποιους μήνες πριν ή μετά", EOMONTH: "Η τελευταία ημέρα του μήνα κάποιους μήνες μετά",
    NETWORKDAYS: "Εργάσιμες ημέρες ανάμεσα σε δύο ημερομηνίες", WORKDAY: "Ημερομηνία κάποιες εργάσιμες μετά",
    PMT: "Δόση δανείου ανά περίοδο", FV: "Μελλοντική αξία επένδυσης", PV: "Παρούσα αξία επένδυσης",
    NPER: "Πλήθος περιόδων πληρωμής", NPV: "Καθαρή παρούσα αξία ταμειακών ροών",
    SUMSQ: "Άθροισμα των τετραγώνων", STDEVP: "Τυπική απόκλιση πληθυσμού", VARP: "Διακύμανση πληθυσμού",
    CONCATENATE: "Ενώνει κείμενα", AVG: "Μέσος όρος αριθμών", ISERR: "Αν η τιμή είναι σφάλμα εκτός από #N/A",
    ISNONTEXT: "Αν η τιμή δεν είναι κείμενο", TRUE: "Η τιμή TRUE (αληθές)", FALSE: "Η τιμή FALSE (ψευδές)",
    GCD: "Μέγιστος κοινός διαιρέτης", LCM: "Ελάχιστο κοινό πολλαπλάσιο", FACT: "Παραγοντικό (5! = 120)",
    COMBIN: "Πλήθος συνδυασμών k στοιχείων", PERMUT: "Πλήθος διατάξεων k στοιχείων",
    MROUND: "Στρογγυλοποίηση στο κοντινότερο πολλαπλάσιο", EVEN: "Στρογγυλοποίηση προς τα πάνω σε άρτιο", ODD: "Στρογγυλοποίηση προς τα πάνω σε περιττό",
    QUOTIENT: "Το ακέραιο μέρος μιας διαίρεσης", SIN: "Ημίτονο (ακτίνια)", COS: "Συνημίτονο (ακτίνια)", TAN: "Εφαπτομένη (ακτίνια)",
    ASIN: "Τόξο ημιτόνου σε ακτίνια", ACOS: "Τόξο συνημιτόνου σε ακτίνια", ATAN: "Τόξο εφαπτομένης σε ακτίνια", ATAN2: "Η γωνία του σημείου x, y σε ακτίνια",
    SINH: "Υπερβολικό ημίτονο", COSH: "Υπερβολικό συνημίτονο", TANH: "Υπερβολική εφαπτομένη",
    RADIANS: "Μοίρες σε ακτίνια", DEGREES: "Ακτίνια σε μοίρες",
    "CEILING.MATH": "Στρογγυλοποίηση προς τα πάνω σε πολλαπλάσιο (αρνητικοί προς ή μακριά από το μηδέν)",
    "FLOOR.MATH": "Στρογγυλοποίηση προς τα κάτω σε πολλαπλάσιο (αρνητικοί προς ή μακριά από το μηδέν)",
    SUBTOTAL: "SUM, AVERAGE, COUNT και άλλες με αριθμό (9 = SUM)",
    AVERAGEA: "Μέσος όρος όπου το κείμενο μετρά 0 και το TRUE 1", MAXA: "Η μεγαλύτερη τιμή, κείμενο ως 0", MINA: "Η μικρότερη τιμή, κείμενο ως 0",
    GEOMEAN: "Γεωμετρικός μέσος", HARMEAN: "Αρμονικός μέσος", CORREL: "Συσχέτιση δύο περιοχών", PEARSON: "Συσχέτιση δύο περιοχών",
    RSQ: "Το τετράγωνο της συσχέτισης (R²)", SLOPE: "Η κλίση της γραμμής τάσης", INTERCEPT: "Πού τέμνει η γραμμή τάσης τον άξονα y",
    FORECAST: "Μια τιμή πάνω στη γραμμή τάσης", "FORECAST.LINEAR": "Μια τιμή πάνω στη γραμμή τάσης",
    "NORM.DIST": "Κανονική κατανομή", NORMDIST: "Κανονική κατανομή", "NORM.S.DIST": "Τυπική κανονική κατανομή",
    "NORM.INV": "Αντίστροφη της κανονικής κατανομής", NORMINV: "Αντίστροφη της κανονικής κατανομής",
    "NORM.S.INV": "Αντίστροφη της τυπικής κανονικής κατανομής", NORMSINV: "Αντίστροφη της τυπικής κανονικής κατανομής",
    STANDARDIZE: "Πόσες τυπικές αποκλίσεις από τον μέσο όρο",
    WEEKNUM: "Ο αριθμός εβδομάδας του έτους", ISOWEEKNUM: "Ο αριθμός εβδομάδας ISO του έτους", YEARFRAC: "Το κλάσμα του έτους ανάμεσα σε δύο ημερομηνίες",
    DAYS360: "Ημέρες ανάμεσα σε δύο ημερομηνίες σε έτος 360 ημερών", TIMEVALUE: "Ώρα γραμμένη ως κείμενο σε κλάσμα της ημέρας",
    "NETWORKDAYS.INTL": "Εργάσιμες ημέρες ανάμεσα σε δύο ημερομηνίες, με δικό σου Σαββατοκύριακο",
    "WORKDAY.INTL": "Ημερομηνία κάποιες εργάσιμες μετά, με δικό σου Σαββατοκύριακο",
    TEXTBEFORE: "Το κείμενο πριν από ένα διαχωριστικό", TEXTAFTER: "Το κείμενο μετά από ένα διαχωριστικό", CLEAN: "Αφαιρεί τους μη εκτυπώσιμους χαρακτήρες",
    UNICHAR: "Ο χαρακτήρας ενός αριθμού Unicode", UNICODE: "Ο αριθμός Unicode του πρώτου χαρακτήρα",
    NUMBERVALUE: "Κείμενο σε αριθμό με διαχωριστικά της επιλογής σου", FIXED: "Αριθμός ως κείμενο με σταθερά δεκαδικά",
    T: "Το κείμενο, ή κενό όταν δεν είναι κείμενο", N: "Η τιμή ως αριθμός",
    IPMT: "Το μέρος τόκου μιας δόσης δανείου", PPMT: "Το μέρος κεφαλαίου μιας δόσης δανείου",
    CUMIPMT: "Οι τόκοι που πληρώθηκαν ανάμεσα σε δύο περιόδους", CUMPRINC: "Το κεφάλαιο που πληρώθηκε ανάμεσα σε δύο περιόδους",
    RATE: "Το επιτόκιο ανά περίοδο δανείου ή επένδυσης", IRR: "Εσωτερικός βαθμός απόδοσης",
    XNPV: "Καθαρή παρούσα αξία χρονολογημένων ταμειακών ροών", XIRR: "Εσωτερικός βαθμός απόδοσης χρονολογημένων ροών",
    MIRR: "Τροποποιημένος εσωτερικός βαθμός απόδοσης", SLN: "Σταθερή απόσβεση ανά περίοδο",
    SYD: "Απόσβεση αθροίσματος ψηφίων ετών", DDB: "Απόσβεση διπλά φθίνοντος υπολοίπου",
    DB: "Απόσβεση σταθερά φθίνοντος υπολοίπου", EFFECT: "Πραγματικό ετήσιο επιτόκιο", NOMINAL: "Ονομαστικό ετήσιο επιτόκιο",
    XMATCH: "Η θέση μιας τιμής, ακριβής από προεπιλογή", LOOKUP: "Βρίσκει τιμή σε ταξινομημένη λίστα και δίνει το αντίστοιχο στοιχείο",
    ADDRESS: "Η διεύθυνση ενός κελιού ως κείμενο", OFFSET: "Περιοχή κάποιες γραμμές και στήλες μακριά από μια άλλη",
    INDIRECT: "Η περιοχή που γράφει ένα κείμενο όπως \"B2\" ή \"Φύλλο2!A1:A9\"",
    "MODE.SNGL": "Η συχνότερη τιμή", "PERCENTILE.INC": "Το k-οστό εκατοστημόριο", "QUARTILE.INC": "Τεταρτημόριο των δεδομένων",
    "RANK.EQ": "Η θέση ενός αριθμού σε λίστα", "VAR.S": "Διακύμανση δείγματος"
  }
};
/* a pack language (i18n.js, browser only): HELP[code] = English + the pack */
if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(HELP, "spreadsheet");
/* argument hints shown next to the name */
var SIG = {
  SUMIF: "range; criteria; [sum_range]", SUMIFS: "sum_range; range1; criteria1; …", COUNTIF: "range; criteria",
  COUNTIFS: "range1; criteria1; …", AVERAGEIF: "range; criteria; [avg_range]", VLOOKUP: "value; table; col; [approx]",
  HLOOKUP: "value; table; row; [approx]", XLOOKUP: "value; lookup; return; [if_none]; [mode]; [search]",
  INDEX: "range; row; [col]", MATCH: "value; range; [type]", IF: "test; then; [else]", IFERROR: "value; fallback",
  TEXT: "value; \"0.00\"", DATE: "year; month; day", DATEDIF: "start; end; \"Y|M|D\"", PMT: "rate; nper; pv; [fv]; [type]",
  ROUND: "number; digits", LEFT: "text; [n]", MID: "text; start; n", SUBSTITUTE: "text; old; new; [n]", TEXTJOIN: "sep; skip_empty; text…",
  XMATCH: "value; range; [mode]; [search]", LOOKUP: "value; lookup; [result]", OFFSET: "ref; rows; cols; [height]; [width]",
  INDIRECT: "\"A1\"", ADDRESS: "row; col; [abs]; [a1]; [sheet]", SUBTOTAL: "9; range…",
  TEXTBEFORE: "text; delimiter; [n]; [any_case]; [end]; [if_none]", TEXTAFTER: "text; delimiter; [n]; [any_case]; [end]; [if_none]",
  NUMBERVALUE: "text; [decimal]; [group]", FIXED: "number; [decimals]; [no_commas]", WEEKNUM: "date; [type]",
  YEARFRAC: "start; end; [basis]", "NETWORKDAYS.INTL": "start; end; [weekend]; [holidays]", "WORKDAY.INTL": "start; days; [weekend]; [holidays]",
  IPMT: "rate; per; nper; pv; [fv]; [type]", PPMT: "rate; per; nper; pv; [fv]; [type]", RATE: "nper; pmt; pv; [fv]; [type]; [guess]",
  IRR: "values; [guess]", XNPV: "rate; values; dates", XIRR: "values; dates; [guess]", MIRR: "values; finance_rate; reinvest_rate",
  CUMIPMT: "rate; nper; pv; start; end; type", CUMPRINC: "rate; nper; pv; start; end; type", DDB: "cost; salvage; life; period; [factor]",
  DB: "cost; salvage; life; period; [month]", "NORM.DIST": "x; mean; sd; cumulative", "NORM.INV": "p; mean; sd",
  FORECAST: "x; known_y; known_x", SLOPE: "known_y; known_x", CORREL: "range1; range2"
};
function names() {
  var out = Object.keys(F).concat(Object.keys(L));
  out.sort();
  return out;
}

/* ===== sort · region · filter (pure) ===== */
/* stable order of positions for sorting values: numbers, text
   (locale collation, numbers inside text in order), booleans,
   errors; blanks always last, in both directions */
function sortOrder(vals, desc, lang) {
  var idx = [], i, coll = null;
  for (i = 0; i < vals.length; i++) idx.push(i);
  try { coll = new Intl.Collator(lang || "en", { numeric: true, sensitivity: "base" }); } catch (e) { coll = null; }
  function rank(v) { return isErr(v) ? 4 : typeRank(v); }
  idx.sort(function (i, j) {
    var a = vals[i], b = vals[j];
    var ba = isBlank(a) || a === "", bb = isBlank(b) || b === "";
    if (ba || bb) return ba === bb ? i - j : (ba ? 1 : -1);
    var ra = rank(a), rb = rank(b), c;
    if (ra !== rb) c = ra - rb;
    else if (ra === 2 || ra === 4) c = coll ? coll.compare(a, b) : cmpVals(a, b);
    else c = cmpVals(a, b);
    if (desc) c = -c;
    return c || i - j;
  });
  return idx;
}
/* Excel's "current region": the block of filled cells around (r, c),
   growing while a neighbouring row or column has something.
   has(r, c) -> bool. Returns {t, b, l, r} or null when it is empty. */
function region(has, r, c, maxR, maxC) {
  var t = r, b = r, l = c, rr = c, grew = true, i;
  function rowHas(y, x0, x1) { if (y < 0 || y >= maxR) return false; for (var x = Math.max(0, x0); x <= Math.min(maxC - 1, x1); x++) if (has(y, x)) return true; return false; }
  function colHas(x, y0, y1) { if (x < 0 || x >= maxC) return false; for (var y = Math.max(0, y0); y <= Math.min(maxR - 1, y1); y++) if (has(y, x)) return true; return false; }
  var guard = 0;
  while (grew && guard++ < 100000) {
    grew = false;
    if (rowHas(t - 1, l - 1, rr + 1)) { t--; grew = true; }
    if (rowHas(b + 1, l - 1, rr + 1)) { b++; grew = true; }
    if (colHas(l - 1, t - 1, b + 1)) { l--; grew = true; }
    if (colHas(rr + 1, t - 1, b + 1)) { rr++; grew = true; }
  }
  for (i = l; i <= rr; i++) if (colHas(i, t, b)) return { t: t, b: b, l: l, r: rr };
  return null;
}
/* filter spec {cols: {c: {q: "text", ex: ["shown value", …]}}}; text(c)
   gives the row's shown text in column c. "" stands for an empty cell. */
function filterPass(spec, text) {
  if (!spec || !spec.cols) return true;
  for (var k in spec.cols) {
    var f = spec.cols[k], s = text(+k);
    if (s === null || s === undefined) s = "";
    if (f.ex && f.ex.length && f.ex.indexOf(s) >= 0) return false;
    if (f.q && String(s).toLowerCase().indexOf(String(f.q).toLowerCase()) < 0) return false;
  }
  return true;
}

var API = {
  ERR: ERR, isErr: isErr, isArr: isArr, MAX_ROWS: MAX_ROWS, MAX_COLS: MAX_COLS,
  colName: colName, colFromName: colFromName,
  tokenize: tokenize, T: T, parse: parse,
  engine: function (ctx) { return new Engine(ctx); },
  literal: literal, toStr: toStr, toNum: toNum, cmpVals: cmpVals, typeRank: typeRank,
  criteria: criteria, wildRe: wildRe,
  serialOf: serialOf, partsOf: partsOf, parseDate: parseDate, dateStr: dateStr, nowSerial: nowSerial,
  textFormat: textFormat, display: display, autoDate: autoDate,
  shiftFormula: shiftFormula, adjustFormula: adjustFormula, mapRefs: mapRefs,
  names: names, HELP: HELP, SIG: SIG,
  sortOrder: sortOrder, region: region, filterPass: filterPass,
  has: function (n) { return !!(F[n] || L[n]); }
};
root.OrosSheetFx = API;
if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
