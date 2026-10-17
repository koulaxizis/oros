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
var T = { NUM: 1, STR: 2, OP: 3, REF: 4, FUNC: 5, SEP: 6, LP: 7, RP: 8, ERR: 9, BOOL: 10, NAME: 11, BAD: 12 };
var OPS2 = { "<>": 1, "<=": 1, ">=": 1 };
var OPS1 = { "+": 1, "-": 1, "*": 1, "/": 1, "^": 1, "&": 1, "=": 1, "<": 1, ">": 1, "%": 1 };
var ERR_LIT = /^#(DIV\/0!|N\/A|NAME\?|NUM!|REF!|VALUE!|NULL!)/i;
var SHEET_Q = /^'((?:[^']|'')+)'!/;
var SHEET_U = /^([^\s'!:(),;+\-*\/^&<>=%"{}\[\]]+)!/;
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
    if (ch === ")") { out.push({ t: T.RP, v: ch, s: st, e: i + 1 }); i++; continue; }
    if (ch === "," || ch === ";") { out.push({ t: T.SEP, v: ch, s: st, e: i + 1 }); i++; continue; }

    rest = s.slice(i);
    var sheet = null, sheetRaw = "", p = i;
    m = rest.match(SHEET_Q) || rest.match(SHEET_U);
    if (m) {
      sheet = m[0].charAt(0) === "'" ? m[1].replace(/''/g, "'") : m[1];
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
  var cm = sec.replace(/"[^"]*"/g, function (q) { return new Array(q.length + 1).join("\u0001"); })
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
function unquoteLit(s) { return s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1"); }
function roundHalfAway(x, d) {
  var f = Math.pow(10, d), y = Number((Math.abs(x) * f).toPrecision(15));
  return (x < 0 ? -1 : 1) * Math.round(y) / f;
}
function isDatePattern(p) {
  var q = p.replace(/"[^"]*"/g, "");
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
  return toStr(a[0]).toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, function (m, p, l) { return p + l.toUpperCase(); });
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
}
Engine.prototype.reset = function () { this.cache = {}; this.visiting = {}; };

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
  if (this.visiting[key]) return ERR.CYC;
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
        try { return lz.f(args, cx, function (x) { return x.k === "empty" ? undefined : self.ev(x, cx); }); }
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
  var ast;
  try { ast = parse(formula); } catch (e) { if (e instanceof Fx) return e.fx; throw e; }
  return scalar(this.ev(ast, { sid: sid, r: 0, c: 0, depth: 0, lang: this.ctx.lang, now: this.ctx.now || Date.now }));
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
var DATE_FN = /^=\s*(TODAY|DATE|EDATE|EOMONTH|DATEVALUE|WORKDAY)\s*\(/i;
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
    ISNONTEXT: "Whether the value is not text", TRUE: "The value TRUE", FALSE: "The value FALSE"
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
    ISNONTEXT: "Αν η τιμή δεν είναι κείμενο", TRUE: "Η τιμή TRUE (αληθές)", FALSE: "Η τιμή FALSE (ψευδές)"
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
  ROUND: "number; digits", LEFT: "text; [n]", MID: "text; start; n", SUBSTITUTE: "text; old; new; [n]", TEXTJOIN: "sep; skip_empty; text…"
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
