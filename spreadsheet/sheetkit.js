/* ============================================================
   sheetkit.js — orOS Spreadsheet, Wave 2 pure logic (OrosSheetKit)
   Ranges, fill series, the system clipboard (TSV / HTML tables),
   conditional formatting, chart data and the chart SVG, and the
   normalisers of the synced chart / rule records. No DOM, no
   third-party code: loaded by spreadsheet.js and by the Node tests
   (tests/spreadsheet-kit.test.js, tests/spreadsheet-wave2.test.js).
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function (root) {
"use strict";

var MAX_ROWS = 10000, MAX_COLS = 104;
var HEX_RE = /^#[0-9a-f]{6}$/;

function colName(n) {
  var s = ""; n += 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colFromName(s) {
  var n = 0; s = String(s).toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return -1;
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function hex(c) {
  if (typeof c !== "string") return null;
  c = c.trim().toLowerCase();
  if (HEX_RE.test(c)) return c;
  var m = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  m = c.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;   /* transparent */
    return "#" + [m[1], m[2], m[3]].map(function (x) {
      var n = Math.min(255, +x); return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }
  return null;
}
function rgbOf(h) { h = hex(h) || "#000000"; return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
function toHex(rgb) {
  return "#" + rgb.map(function (x) { x = Math.max(0, Math.min(255, Math.round(x))); return (x < 16 ? "0" : "") + x.toString(16); }).join("");
}
function mix(a, b, t) {
  var x = rgbOf(a), y = rgbOf(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
function luminance(h) {
  var c = rgbOf(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/* readable ink on a background colour */
function inkOn(bg) { return luminance(bg) > 0.4 ? "#1a1a1a" : "#f4f4f4"; }
function rgba(h, a) { var c = rgbOf(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

/* ===== ranges ===== */
/* "A1", "A1:C5", "$A$1:$B$9", "A:C", "2:4" -> {t, l, b, r} (inclusive, ordered) or null */
function parseRange(s, maxR, maxC) {
  maxR = maxR || MAX_ROWS; maxC = maxC || MAX_COLS;
  s = String(s || "").replace(/\$/g, "").replace(/\s+/g, "").toUpperCase();
  var m = s.match(/^([A-Z]{1,3})(\d{1,5})(?::([A-Z]{1,3})(\d{1,5}))?$/), t, l, b, r;
  if (m) {
    l = colFromName(m[1]); t = +m[2] - 1;
    r = m[3] ? colFromName(m[3]) : l; b = m[3] ? +m[4] - 1 : t;
  } else if ((m = s.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/))) {
    l = colFromName(m[1]); r = colFromName(m[2]); t = 0; b = maxR - 1;
  } else if ((m = s.match(/^(\d{1,5}):(\d{1,5})$/))) {
    t = +m[1] - 1; b = +m[2] - 1; l = 0; r = maxC - 1;
  } else return null;
  if (l < 0 || r < 0 || t < 0 || b < 0) return null;
  var o = { t: Math.min(t, b), b: Math.max(t, b), l: Math.min(l, r), r: Math.max(l, r) };
  if (o.b >= maxR || o.r >= maxC) return null;
  return o;
}
function rangeStr(g) {
  var a = colName(g.l) + (g.t + 1);
  return (g.t === g.b && g.l === g.r) ? a : a + ":" + colName(g.r) + (g.b + 1);
}
function inRange(g, r, c) { return r >= g.t && r <= g.b && c >= g.l && c <= g.r; }
/* insert (n > 0) or delete (n < 0) rows ("r") / columns ("c") at index
   `at`: the range follows, as a formula reference does; null when it
   was wholly deleted. Clamped to the sheet caps. */
function adjRange(g, axis, at, n) {
  var lo = axis === "r" ? "t" : "l", hi = axis === "r" ? "b" : "r", max = axis === "r" ? MAX_ROWS : MAX_COLS;
  var o = { t: g.t, b: g.b, l: g.l, r: g.r };
  if (n > 0) { if (o[lo] >= at) o[lo] += n; if (o[hi] >= at) o[hi] += n; }
  else {
    var cnt = -n, end = at + cnt - 1;
    if (o[lo] >= at && o[hi] <= end) return null;
    o[lo] = o[lo] > end ? o[lo] - cnt : (o[lo] >= at ? at : o[lo]);
    o[hi] = o[hi] > end ? o[hi] - cnt : (o[hi] >= at ? at - 1 : o[hi]);
  }
  o[lo] = Math.min(o[lo], max - 1); o[hi] = Math.min(o[hi], max - 1);
  return o;
}

/* ===== fill series (the fill handle) ===== */
var NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
var LISTS = [
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"],
  ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"],
  ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"],
  ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"],
  ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"]
];
function fold(s) {
  return String(s).normalize ? String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : String(s).toLowerCase();
}
var LIST_IX = (function () {
  var m = {};
  LISTS.forEach(function (L, li) { L.forEach(function (w, i) { var k = fold(w); if (!m[k]) m[k] = [li, i]; }); });
  return m;
})();
function caseOf(s) {
  if (s === s.toUpperCase() && s !== s.toLowerCase()) return "U";
  if (s === s.toLowerCase()) return "l";
  return "T";
}
function applyCase(w, cs) {
  if (cs === "U") return fold(w).toUpperCase();
  if (cs === "l") return w.toLowerCase();
  return w;
}
var EPOCH = Date.UTC(1899, 11, 30), DAY = 86400000;
function pad(n, w) { var s = String(Math.abs(n)); while (s.length < w) s = "0" + s; return (n < 0 ? "-" : "") + s; }
function textDate(s) {
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), y, mo, d, f, sep = "-";
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; f = "iso"; }
  else if ((m = s.match(/^(\d{1,2})([\/.])(\d{1,2})\2(\d{4})$/))) { d = +m[1]; mo = +m[3]; y = +m[4]; f = "dmy"; sep = m[2]; }
  else return null;
  var t = Date.UTC(y, mo - 1, d), dt = new Date(t);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900) return null;
  return { n: Math.round((t - EPOCH) / DAY), f: f, sep: sep };
}
function dateText(serial, f, sep) {
  var dt = new Date(EPOCH + serial * DAY);
  var y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
  return f === "iso" ? y + "-" + pad(mo, 2) + "-" + pad(d, 2) : pad(d, 2) + sep + pad(mo, 2) + sep + y;
}
function numText(x) {
  if (!isFinite(x)) return "0";
  var v = Number(x.toPrecision(12));
  if (Object.is && Object.is(v, -0)) v = 0;
  return String(v);
}
function classify(raw) {
  raw = raw === null || raw === undefined ? "" : String(raw);
  if (raw === "") return { t: "e" };
  if (raw.charAt(0) === "=") return { t: "f" };
  var s = raw.trim();
  if (NUM_RE.test(s)) return { t: "n", n: parseFloat(s) };
  var d = textDate(s);
  if (d) return { t: "d", n: d.n, f: d.f, sep: d.sep };
  var li = LIST_IX[fold(s)];
  if (li) return { t: "L", li: li[0], i: li[1], cs: caseOf(s), key: "L" + li[0] };
  var m = raw.match(/^(.*?)(\d+)(\D*)$/);
  if (m && raw.charAt(0) !== "'") return { t: "tn", pre: m[1], n: +m[2], w: m[2].charAt(0) === "0" ? m[2].length : 1, post: m[3], key: m[1] + "\u0001" + m[3] };
  return { t: "s" };
}
function trend(ys) {
  var k = ys.length, i, mx = (k - 1) / 2, my = 0, sxy = 0, sxx = 0;
  for (i = 0; i < k; i++) my += ys[i];
  my /= k;
  for (i = 0; i < k; i++) { sxy += (i - mx) * (ys[i] - my); sxx += (i - mx) * (i - mx); }
  var b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b: b };
}
/* raws: the source values in fill order (top→bottom / left→right).
   n: how many cells to fill. opt.back: filling up / left (the result
   then goes away from the block: index 0 is the cell next to it).
   opt.inc: a single number counts up (Ctrl while dragging).
   opt.dates[i]: source i is a number shown as a date (counts by days).
   -> n entries: { v: "new raw" } or { copy: i } (source index i, the
   caller shifts formulas by the distance). */
function fillSeries(raws, n, opt) {
  opt = opt || {};
  var k = raws.length, out = [], j, i;
  if (!k || n <= 0) return out;
  var src = raws.slice(), dates = (opt.dates || []).slice();
  if (opt.back) { src.reverse(); dates.reverse(); }
  var cl = src.map(classify);
  var t0 = cl[0].t, same = cl.every(function (x) { return x.t === t0 && (x.key || "") === (cl[0].key || ""); });
  function back(ix) { return opt.back ? k - 1 - ix : ix; }
  if (same && (t0 === "n" || t0 === "d" || t0 === "tn" || t0 === "L")) {
    var ys = cl.map(function (x) { return t0 === "L" ? x.i : x.n; });
    var step, a;
    if (k === 1) {
      var single = (t0 === "n") ? ((opt.inc || dates[0]) ? 1 : 0) : 1;
      if (t0 === "n" && !single) { for (j = 0; j < n; j++) out.push({ copy: back(0) }); return out; }
      a = ys[0]; step = single;
      if (opt.back) step = -step;
      for (j = 0; j < n; j++) out.push(make(a + step * (j + 1), cl[0]));
      return out;
    }
    if (t0 === "L") {
      var len = LISTS[cl[0].li].length;
      step = ((ys[1] - ys[0]) % len + len) % len;
      for (j = 0; j < n; j++) out.push(make(ys[k - 1] + step * (j + 1), cl[k - 1]));
      return out;
    }
    var tr = trend(ys);
    for (j = 0; j < n; j++) out.push(make(tr.a + tr.b * (k + j), cl[k - 1]));
    return out;
  }
  /* mixed: repeat the block; "Item 3" style values still count up */
  for (j = 0; j < n; j++) {
    i = j % k;
    var c = cl[i];
    if (c.t === "tn") out.push(make(c.n + Math.floor(j / k) + 1, c));
    else out.push({ copy: back(i) });
  }
  return out;
  function make(val, like) {
    if (like.t === "n") return { v: numText(val) };
    if (like.t === "d") return { v: dateText(Math.round(val), like.f, like.sep) };
    if (like.t === "L") {
      var L = LISTS[like.li], ix = ((Math.round(val) % L.length) + L.length) % L.length;
      return { v: applyCase(L[ix], like.cs) };
    }
    return { v: like.pre + pad(Math.abs(Math.round(val)), like.w) + like.post };
  }
}

/* ===== the system clipboard ===== */
function tsvField(s) {
  s = String(s === null || s === undefined ? "" : s);
  return /[\t\r\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toTSV(rows) {
  return rows.map(function (r) { return r.map(tsvField).join("\t"); }).join("\r\n");
}
/* Excel / Sheets / Calc text: tabs between cells, a line per row,
   "quoted" cells may hold tabs and line breaks */
function parseTSV(text) {
  text = String(text || "").replace(/\r\n?/g, "\n");
  var rows = [], row = [], f = "", i = 0, n = text.length, inQ = false, start = true;
  for (; i < n; i++) {
    var ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else inQ = false; }
      else f += ch;
      continue;
    }
    if (ch === '"' && start) { inQ = true; start = false; continue; }
    start = false;
    if (ch === "\t") { row.push(f); f = ""; start = true; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; start = true; }
    else f += ch;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEnt(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    if (e.charAt(0) === "#") {
      var c = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return (c > 0 && c < 0x110000 && c !== 0xA0) ? String.fromCodePoint(c) : (c === 0xA0 ? " " : "");
    }
    var k = e.toLowerCase();
    return ENT.hasOwnProperty(k) ? ENT[k] : m;
  });
}
function attr(attrs, name) {
  var re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  var m = attrs.match(re);
  return m ? decodeEnt(m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4])) : null;
}
/* a CSS declaration list -> our cell format (only what we keep) */
function cssFmt(css, f) {
  f = f || {};
  String(css || "").split(";").forEach(function (d) {
    var p = d.indexOf(":");
    if (p < 0) return;
    var k = d.slice(0, p).trim().toLowerCase(), v = d.slice(p + 1).trim().toLowerCase().replace(/\s*!important$/, "");
    if (k === "font-weight") { if (v === "bold" || v === "bolder" || parseInt(v, 10) >= 600) f.b = 1; else if (v === "normal" || parseInt(v, 10) < 600) delete f.b; }
    else if (k === "font-style") { if (v === "italic" || v === "oblique") f.i = 1; else delete f.i; }
    else if (k === "text-decoration" || k === "text-decoration-line") { if (v.indexOf("underline") >= 0) f.u = 1; }
    else if (k === "text-align") { if (v === "left" || v === "start") f.al = "l"; else if (v === "center") f.al = "c"; else if (v === "right" || v === "end") f.al = "r"; }
    else if (k === "background-color" || k === "background") { var bg = hex(v.split(/\s+/)[0]); if (bg && bg !== "#ffffff") f.bg = bg; }
    else if (k === "color") { var co = hex(v); if (co && co !== "#000000") f.co = co; }
    else if (k === "white-space") { if (v === "normal" || v === "pre-wrap") f.wr = 1; }
    else if (k === "vertical-align") { if (v === "top") f.va = "t"; else if (v === "middle") f.va = "m"; else if (v === "bottom") f.va = "b"; }
  });
  return f;
}
/* the first <table> of copied HTML -> { rows: [[{ v, f? }]], merges:
   [{ r, c, rs, cs }] }, or null when there is no table. Text only:
   tags are dropped, entities decoded; nothing is ever run. */
function parseHTMLTable(html) {
  html = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  var classes = {};
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (m, css) {
    css.replace(/([^{}]+)\{([^}]*)\}/g, function (mm, sel, body) {
      sel.split(",").forEach(function (s) {
        var cm = s.trim().match(/^(?:[a-z]+)?\.([\w-]+)$/i);
        if (cm) classes[cm[1].toLowerCase()] = (classes[cm[1].toLowerCase()] || "") + ";" + body;
      });
      return "";
    });
    return "";
  });
  html = html.replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "");
  var ti = html.search(/<table[\s>]/i);
  if (ti < 0) return null;
  html = html.slice(ti);
  var re = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi, m;
  var rows = [], merges = [], taken = {}, r = -1, c = 0, cell = null, depth = 0, wrap = [];
  function closeCell() {
    if (!cell) return;
    var v = cell.text.replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/^\s+|\s+$/g, "");
    var f = cell.f;
    if (cell.all.b) f.b = 1;
    if (cell.all.i) f.i = 1;
    if (cell.all.u) f.u = 1;
    var o = { v: v };
    var has = false, kk;
    for (kk in f) { has = true; break; }
    if (has) o.f = f;
    while (rows.length <= r) rows.push([]);
    rows[r][cell.c] = o;
    if (cell.rs > 1 || cell.cs > 1) merges.push({ r: r, c: cell.c, rs: cell.rs, cs: cell.cs });
    for (var dr = 0; dr < cell.rs; dr++) for (var dc = 0; dc < cell.cs; dc++) taken[(r + dr) + "," + (cell.c + dc)] = 1;
    cell = null;
  }
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (cell) {
        var txt = decodeEnt(m[4].replace(/[\r\n]+/g, " "));
        if (/\S/.test(txt)) { cell.all.b = cell.all.b && cell.inB > 0; cell.all.i = cell.all.i && cell.inI > 0; cell.all.u = cell.all.u && cell.inU > 0; }
        cell.text += txt;
      }
      continue;
    }
    var close = m[1] === "/", tag = m[2].toLowerCase(), at = m[3];
    if (tag === "table") { if (close) { depth--; if (depth <= 0) { closeCell(); break; } } else depth++; continue; }
    if (depth > 1) continue;                         /* nested tables: text only via the outer cell */
    if (tag === "tr") { closeCell(); if (!close) { r++; c = 0; } continue; }
    if (tag === "td" || tag === "th") {
      closeCell();
      if (close) continue;
      if (r < 0) { r = 0; c = 0; }
      while (taken[r + "," + c]) c++;
      var cs = Math.max(1, Math.min(MAX_COLS, parseInt(attr(at, "colspan"), 10) || 1));
      var rs = Math.max(1, Math.min(MAX_ROWS, parseInt(attr(at, "rowspan"), 10) || 1));
      var f = {}, cls = (attr(at, "class") || "").toLowerCase().split(/\s+/);
      cls.forEach(function (k) { if (classes[k]) cssFmt(classes[k], f); });
      cssFmt(attr(at, "style"), f);
      var bgc = hex(attr(at, "bgcolor") || "");
      if (bgc && bgc !== "#ffffff") f.bg = bgc;
      var alg = (attr(at, "align") || "").toLowerCase();
      if (alg === "center") f.al = "c"; else if (alg === "right") f.al = "r"; else if (alg === "left") f.al = "l";
      if (tag === "th" && !f.hasOwnProperty("b")) f.b = 1;
      cell = { c: c, cs: cs, rs: rs, f: f, text: "", all: { b: true, i: true, u: true }, inB: 0, inI: 0, inU: 0 };
      c += cs;
      continue;
    }
    if (!cell) continue;
    if (tag === "br") { cell.text += "\n"; continue; }
    if ((tag === "p" || tag === "div") && close) { cell.text += "\n"; continue; }
    var d = close ? -1 : 1;
    if (tag === "b" || tag === "strong") cell.inB += d;
    else if (tag === "i" || tag === "em") cell.inI += d;
    else if (tag === "u") cell.inU += d;
    else if ((tag === "span" || tag === "font") && !close) {
      var sf = cssFmt(attr(at, "style"), {});
      if (sf.b) cell.inB++; if (sf.i) cell.inI++; if (sf.u) cell.inU++;
      wrap.push(sf);
      var col = hex(attr(at, "color") || "");
      if (col && col !== "#000000" && !cell.f.co) cell.f.co = col;
    } else if ((tag === "span" || tag === "font") && close) {
      var pf = wrap.pop() || {};
      if (pf.b) cell.inB--; if (pf.i) cell.inI--; if (pf.u) cell.inU--;
    }
  }
  closeCell();
  if (!rows.length) return null;
  var w = 0, i;
  for (i = 0; i < rows.length; i++) if (rows[i].length > w) w = rows[i].length;
  for (i = 0; i < rows.length; i++) for (var x = 0; x < w; x++) if (!rows[i][x]) rows[i][x] = { v: "" };
  return { rows: rows, merges: merges };
}
/* text copied from another app -> what we store: "1.234,56" (Greek)
   and "1,234.56" (English) become plain numbers; the rest is kept */
function pasteValue(s, lang) {
  s = String(s === null || s === undefined ? "" : s).replace(/\u00a0/g, " ");
  var t = s.trim();
  if (t === "") return "";
  if (lang === "el") {
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) return t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return t.replace(/,/g, "");
  return t === s ? s : (NUM_RE.test(t) ? t : s);
}
function toHTML(rows) {
  var h = '<meta charset="utf-8"><table><tbody>';
  rows.forEach(function (r) {
    h += "<tr>";
    r.forEach(function (c) {
      c = c || { s: "" };
      var st = [], f = c.f || {};
      if (f.b) st.push("font-weight:bold");
      if (f.i) st.push("font-style:italic");
      if (f.u) st.push("text-decoration:underline");
      if (f.al) st.push("text-align:" + (f.al === "c" ? "center" : f.al === "r" ? "right" : "left"));
      if (f.co && HEX_RE.test(f.co)) st.push("color:" + f.co);
      if (f.bg && HEX_RE.test(f.bg)) st.push("background-color:" + f.bg);
      var span = "";
      if (c.rs > 1) span += ' rowspan="' + c.rs + '"';
      if (c.cs > 1) span += ' colspan="' + c.cs + '"';
      if (c.skip) return;
      h += "<td" + span + (st.length ? ' style="' + st.join(";") + '"' : "") + ">" +
        esc(c.s === null || c.s === undefined ? "" : c.s).replace(/\n/g, "<br>") + "</td>";
    });
    h += "</tr>";
  });
  return h + "</tbody></table>";
}

/* ===== conditional formatting ===== */
var CF_KINDS = ["gt", "lt", "bt", "eq", "tx", "top", "bot", "dup", "cs", "db"];
function cfNum(s) {
  s = String(s === null || s === undefined ? "" : s).trim();
  if (NUM_RE.test(s)) return parseFloat(s);
  var d = textDate(s);
  return d ? d.n : null;
}
/* a cell's value for the rules: number, text or null */
function cfVal(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function cfStats(rule, vals) {
  var nums = [], cnt = {}, i;
  for (i = 0; i < vals.length; i++) {
    var v = cfVal(vals[i]);
    if (v === null) continue;
    if (typeof v === "number") nums.push(v);
    var key = typeof v === "number" ? "n" + v : "s" + v.toLowerCase();
    cnt[key] = (cnt[key] || 0) + 1;
  }
  nums.sort(function (a, b) { return a - b; });
  var st = { nums: nums, cnt: cnt, min: nums.length ? nums[0] : 0, max: nums.length ? nums[nums.length - 1] : 0 };
  if (nums.length) {
    var h = (nums.length - 1) / 2, lo = Math.floor(h);
    st.mid = nums[lo] + (nums[Math.ceil(h)] - nums[lo]) * (h - lo);
  } else st.mid = 0;
  var n = Math.max(1, rule.n || 10);
  if (rule.k === "top" && nums.length) st.cut = nums[Math.max(0, nums.length - n)];
  if (rule.k === "bot" && nums.length) st.cut = nums[Math.min(nums.length - 1, n - 1)];
  return st;
}
/* -> { bg?, co?, b?, bar?: 0..1, barCo? } or null */
function cfStyle(rule, v, st) {
  v = cfVal(v);
  if (v === null) return null;
  var k = rule.k, hit = false, a = cfNum(rule.a), b = cfNum(rule.b);
  if (k === "cs" || k === "db") {
    if (typeof v !== "number") return null;
    if (k === "db") {
      var lo = Math.min(0, st.min), span = st.max - lo;
      return { bar: span > 0 ? Math.max(0, Math.min(1, (v - lo) / span)) : 1, barCo: rule.db || "#2a78d6" };
    }
    var cs = rule.cs || ["#e34948", "#1baf7a"], col;
    if (st.max === st.min) col = cs[cs.length - 1];
    else if (cs.length === 3) {
      if (v <= st.mid) col = st.mid === st.min ? cs[1] : mix(cs[0], cs[1], (v - st.min) / (st.mid - st.min));
      else col = st.max === st.mid ? cs[1] : mix(cs[1], cs[2], (v - st.mid) / (st.max - st.mid));
    } else col = mix(cs[0], cs[1], (v - st.min) / (st.max - st.min));
    return { bg: col, co: inkOn(col) };
  }
  if (k === "gt") hit = typeof v === "number" && a !== null && v > a;
  else if (k === "lt") hit = typeof v === "number" && a !== null && v < a;
  else if (k === "bt") hit = typeof v === "number" && a !== null && b !== null && v >= Math.min(a, b) && v <= Math.max(a, b);
  else if (k === "eq") hit = (a !== null && typeof v === "number") ? v === a : String(v).toLowerCase() === String(rule.a || "").trim().toLowerCase();
  else if (k === "tx") hit = !!rule.a && String(v).toLowerCase().indexOf(String(rule.a).toLowerCase()) >= 0;
  else if (k === "top") hit = typeof v === "number" && st.cut !== undefined && v >= st.cut;
  else if (k === "bot") hit = typeof v === "number" && st.cut !== undefined && v <= st.cut;
  else if (k === "dup") hit = (st.cnt[typeof v === "number" ? "n" + v : "s" + v.toLowerCase()] || 0) > 1;
  if (!hit) return null;
  var s = rule.st || {}, o = {};
  if (s.bg) { o.bg = s.bg; o.co = s.co || inkOn(s.bg); }
  else if (s.co) o.co = s.co;
  if (s.b) o.b = 1;
  return o;
}

/* ===== synced records: chart and rule normalisers (canonical) ===== */
var ID_RE = /^[\w-]{1,40}$/;
function str(s, n) { return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n) : ""; }
function int(x, lo, hi, d) { x = parseInt(x, 10); return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; }
function stamp(x) { return (typeof x === "number" && isFinite(x) && x > 0) ? x : 0; }
var CHART_TYPES = ["col", "bar", "line", "pie", "donut", "scatter"];
function normChart(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
      typeof x.sid !== "string" || !ID_RE.test(x.sid)) return null;
  var g = parseRange(x.src);
  var o = { id: x.id, sid: x.sid, mtime: stamp(x.mtime),
    t: CHART_TYPES.indexOf(x.t) >= 0 ? x.t : "col",
    src: g ? rangeStr(g) : str(x.src, 40) };
  if (x.by === "c" || x.by === "r") o.by = x.by;
  var ttl = str(x.ttl, 100), xl = str(x.xl, 60), yl = str(x.yl, 60);
  if (ttl) o.ttl = ttl;
  if (xl) o.xl = xl;
  if (yl) o.yl = yl;
  o.lg = x.lg === 0 ? 0 : 1;
  if (Array.isArray(x.co)) {
    var co = x.co.slice(0, 8).map(function (c) { return hex(c) || ""; });
    while (co.length && !co[co.length - 1]) co.pop();
    if (co.length) o.co = co;
  }
  var at = x.at && typeof x.at === "object" ? x.at : {};
  o.at = { r: int(at.r, 0, MAX_ROWS - 1, 0), c: int(at.c, 0, MAX_COLS - 1, 0), x: int(at.x, 0, 400, 0), y: int(at.y, 0, 400, 0) };
  o.w = int(x.w, 160, 2000, 420);
  o.h = int(x.h, 120, 1500, 260);
  return o;
}
function normCf(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
      typeof x.sid !== "string" || !ID_RE.test(x.sid) || CF_KINDS.indexOf(x.k) < 0) return null;
  var g = parseRange(x.rg);
  if (!g) return null;
  var o = { id: x.id, sid: x.sid, mtime: stamp(x.mtime), pos: (typeof x.pos === "number" && isFinite(x.pos)) ? x.pos : 0,
    rg: rangeStr(g), k: x.k };
  if (o.k === "gt" || o.k === "lt" || o.k === "eq" || o.k === "tx" || o.k === "bt") o.a = str(x.a, 200);
  if (o.k === "bt") o.b = str(x.b, 200);
  if (o.k === "top" || o.k === "bot") o.n = int(x.n, 1, 1000, 10);
  if (o.k === "cs") {
    var cs = Array.isArray(x.cs) ? x.cs.map(hex).filter(Boolean).slice(0, 3) : [];
    o.cs = cs.length >= 2 ? cs : ["#e34948", "#1baf7a"];
  } else if (o.k === "db") o.db = hex(x.db) || "#2a78d6";
  else {
    var s = x.st && typeof x.st === "object" ? x.st : {}, st = {};
    if (hex(s.bg)) st.bg = hex(s.bg);
    if (hex(s.co)) st.co = hex(s.co);
    if (s.b) st.b = 1;
    if (!st.bg && !st.co && !st.b) st.bg = "#f6d36b";
    o.st = st;
  }
  return o;
}

/* ===== charts: data ===== */
/* grid: rows of cells { n: number|null, s: "shown text" } (the source
   range). opt.by: "c" (series in columns), "r" (in rows) or "" (more
   rows than columns -> columns, as in Excel). A first row / column of
   text holds the names / categories. -> { cats: [], series: [{ name,
   vals: [number|null] }], xnum: bool, by } */
var MAX_POINTS = 1000, MAX_SERIES = 8;
function chartModel(grid, opt) {
  opt = opt || {};
  var R = grid.length, C = R ? grid[0].length : 0, by = opt.by;
  if (by !== "c" && by !== "r") by = (R >= C) ? "c" : "r";
  var g = grid;
  if (by === "r") {                 /* transpose: series always in columns below */
    g = [];
    for (var c0 = 0; c0 < C; c0++) { var row = []; for (var r0 = 0; r0 < R; r0++) row.push(grid[r0][c0]); g.push(row); }
    var tmp = R; R = C; C = tmp;
  }
  function isText(cell) { return cell && cell.n === null && cell.s !== ""; }
  function blank(cell) { return !cell || (cell.n === null && cell.s === ""); }
  var hdr = false, cat = false, c, r;
  for (c = 0; c < C; c++) if (isText(g[0] && g[0][c])) { hdr = R > 1; break; }
  if (C > 1) {
    for (r = hdr ? 1 : 0; r < R; r++) if (isText(g[r][0])) { cat = true; break; }
    if (!cat && hdr && blank(g[0][0])) cat = true;
    if (!cat && opt.t === "scatter") cat = true;
  }
  var r1 = hdr ? 1 : 0, c1 = cat ? 1 : 0;
  var cats = [], series = [], xnum = true;
  for (r = r1; r < R && cats.length < MAX_POINTS; r++) {
    var cc = cat ? g[r][0] : null;
    cats.push(cat ? (cc ? cc.s : "") : String(r - r1 + 1));
    if (!cat || !cc || cc.n === null) xnum = false;
  }
  for (c = c1; c < C && series.length < MAX_SERIES; c++) {
    var vals = [], any = false;
    for (r = r1; r < r1 + cats.length; r++) {
      var v = g[r][c] ? g[r][c].n : null;
      vals.push(v);
      if (v !== null) any = true;
    }
    var nm = hdr && g[0][c] ? g[0][c].s : "";
    if (any || nm) series.push({ name: nm, vals: vals });
  }
  return { cats: cats, series: series, xnum: xnum && cats.length > 0, by: by,
    xs: xnum ? cats.map(function (x, i) { return g[r1 + i][0].n; }) : null,
    cut: R - r1 > MAX_POINTS || C - c1 > MAX_SERIES };
}

/* clean axis ticks */
function niceStep(span, count) {
  var raw = span / Math.max(1, count), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function niceScale(min, max, count) {
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) { if (min === 0) { max = 1; } else if (min > 0) { min = 0; } else { max = 0; } }
  var step = niceStep(max - min, count || 5);
  var lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { min: lo, max: hi, ticks: ticks };
}
function fmtNum(v, lang) {
  var a = Math.abs(v), s;
  if (a >= 1e9) s = Number((v / 1e9).toPrecision(3)) + "B";
  else if (a >= 1e6) s = Number((v / 1e6).toPrecision(3)) + "M";
  else if (a >= 1e4) s = Number((v / 1e3).toPrecision(3)) + "K";
  else s = String(Number(v.toPrecision(6)));
  return lang === "el" ? s.replace(".", ",") : s;
}
function fit(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* the categorical palette (validated set, light / dark steps) */
var SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]
};
function seriesColors(pal, custom) {
  var base = SERIES[pal && pal.dark ? "dark" : "light"].slice();
  (custom || []).forEach(function (c, i) { if (hex(c) && i < base.length) base[i] = hex(c); });
  return base;
}

/* ===== charts: SVG =====
   model from chartModel; o = { t, w, h, ttl, xl, yl, lg, co, lang,
   pal: { bg, text, dim, grid, dark, font }, empty: "text when no data" }.
   Every text is escaped. One y axis; bars ≤ 24 px with a 4 px rounded
   end; 2 px lines; ≥ 8 px markers with a surface ring; hairline grid;
   a legend for 2+ series; <title> on every mark (hover text). */
function chartSVG(model, o) {
  var W = Math.max(160, o.w | 0), H = Math.max(120, o.h | 0), P = o.pal || {};
  var bg = P.bg || "#ffffff", ink = P.text || "#1a1a1a", dim = P.dim || "#666666", gridC = P.grid || "#dddddd";
  var font = P.font || "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  var cols = seriesColors(P, o.co), lang = o.lang;
  var t = o.t || "col", out = [];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
    '" font-family="' + esc(font) + '" role="img" aria-label="' + esc(o.ttl || "") + '">');
  out.push('<rect width="' + W + '" height="' + H + '" rx="8" fill="' + bg + '"/>');
  var top = 10, bottom = H - 8, left = 10, right = W - 12;
  if (o.ttl) { out.push(txt(W / 2, 24, fit(o.ttl, 60), ink, 14, "middle", 'font-weight="700"')); top = 36; }
  var series = model.series.filter(function (s) { return s.vals.some(function (v) { return v !== null; }); });
  if (!series.length || !model.cats.length) {
    out.push(txt(W / 2, (top + bottom) / 2, o.empty || "", dim, 13, "middle"));
    out.push("</svg>");
    return out.join("");
  }
  var pie = t === "pie" || t === "donut";
  /* legend */
  var items = [];
  if (pie) {
    items = pieSlices(series[0], model.cats, o.otherWord).map(function (s, i) { return { name: s.name, c: cols[i % 8] }; });
  } else if (series.length > 1) {
    items = series.map(function (s, i) { return { name: s.name || (o.seriesWord || "Series") + " " + (i + 1), c: cols[i] }; });
  }
  if (o.lg !== 0 && items.length) {
    var rows = [[]], x = 0, maxW = right - left, iw;
    items.forEach(function (it) {
      iw = 18 + Math.min(16, it.name.length) * 6.4 + 12;
      if (x + iw > maxW && rows[rows.length - 1].length) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ it: it, x: x, w: iw }); x += iw;
    });
    if (rows.length > 3) rows.length = 3;
    var ly = bottom - rows.length * 18 + 12;
    rows.forEach(function (row, ri) {
      var rw = row.length ? row[row.length - 1].x + row[row.length - 1].w : 0, x0 = left + (maxW - rw) / 2;
      row.forEach(function (e) {
        var yy = ly + ri * 18;
        out.push('<rect x="' + (x0 + e.x).toFixed(1) + '" y="' + (yy - 9) + '" width="10" height="10" rx="2" fill="' + e.it.c + '"/>');
        out.push(txt(x0 + e.x + 15, yy, fit(e.it.name, 16), dim, 11, "start"));
      });
    });
    bottom = ly - 20;
  }
  if (pie) { drawPie(); out.push("</svg>"); return out.join(""); }

  if (o.xl) { out.push(txt((left + right) / 2, bottom, fit(o.xl, 50), dim, 11, "middle")); bottom -= 16; }
  if (o.yl) { out.push('<text x="0" y="0" transform="translate(' + (left + 8) + "," + ((top + bottom) / 2).toFixed(1) + ') rotate(-90)" fill="' + dim + '" font-size="11" text-anchor="middle">' + esc(fit(o.yl, 40)) + "</text>"); left += 16; }

  var all = [];
  series.forEach(function (s) { s.vals.forEach(function (v) { if (v !== null) all.push(v); }); });
  var vmin = Math.min.apply(null, all), vmax = Math.max.apply(null, all);
  if (t !== "line" && t !== "scatter") { vmin = Math.min(0, vmin); vmax = Math.max(0, vmax); }
  var horiz = t === "bar";
  var plotH = bottom - top - 18, plotW;
  var sc = niceScale(vmin, vmax, horiz ? Math.max(2, Math.floor((right - left) / 90)) : Math.max(2, Math.min(6, Math.floor(plotH / 40))));
  var labW = 0;
  sc.ticks.forEach(function (v) { labW = Math.max(labW, fmtNum(v, lang).length * 6.5); });
  var catW = 0;
  model.cats.forEach(function (c) { catW = Math.max(catW, Math.min(14, String(c).length) * 6.4); });
  var x0p, x1p, y0p, y1p;
  if (horiz) { x0p = left + catW + 8; x1p = right - 6; y0p = top; y1p = bottom - 16; }
  else { x0p = left + labW + 8; x1p = right; y0p = top + 4; y1p = bottom - 16; }
  plotW = x1p - x0p;
  if (plotW < 20 || y1p - y0p < 20) { out.push("</svg>"); return out.join(""); }
  function vy(v) { return y1p - (v - sc.min) / (sc.max - sc.min) * (y1p - y0p); }
  function vx(v) { return x0p + (v - sc.min) / (sc.max - sc.min) * (x1p - x0p); }

  /* grid + value axis */
  sc.ticks.forEach(function (v) {
    if (horiz) {
      var gx = vx(v);
      out.push(line(gx, y0p, gx, y1p, v === 0 ? dim : gridC));
      out.push(txt(gx, y1p + 14, fmtNum(v, lang), dim, 10.5, "middle"));
    } else {
      var gy = vy(v);
      out.push(line(x0p, gy, x1p, gy, v === 0 ? dim : gridC));
      out.push(txt(x0p - 6, gy + 3.5, fmtNum(v, lang), dim, 10.5, "end"));
    }
  });
  var n = model.cats.length, ns = series.length;
  if (t === "scatter") {
    var xs = model.xnum ? model.xs : model.cats.map(function (c, i) { return i + 1; });
    var xsc = niceScale(Math.min.apply(null, xs), Math.max.apply(null, xs), Math.max(2, Math.floor(plotW / 80)));
    var sx = function (v) { return x0p + (v - xsc.min) / (xsc.max - xsc.min) * plotW; };
    xsc.ticks.forEach(function (v) { out.push(txt(sx(v), y1p + 14, fmtNum(v, lang), dim, 10.5, "middle")); });
    series.forEach(function (s, si) {
      s.vals.forEach(function (v, i) {
        if (v === null) return;
        out.push('<circle cx="' + sx(xs[i]).toFixed(1) + '" cy="' + vy(v).toFixed(1) + '" r="4" fill="' + cols[si] + '" stroke="' + bg + '" stroke-width="2"><title>' +
          esc((s.name ? s.name + " · " : "") + fmtNum(xs[i], lang) + ", " + fmtNum(v, lang)) + "</title></circle>");
      });
    });
    out.push("</svg>");
    return out.join("");
  }
  /* category axis labels (thinned so they never collide) */
  var band = (horiz ? (y1p - y0p) : plotW) / n;
  var every = Math.max(1, Math.ceil((horiz ? 14 : (catW + 8)) / band));
  model.cats.forEach(function (c, i) {
    if (i % every) return;
    if (horiz) out.push(txt(x0p - 6, y0p + band * (i + 0.5) + 3.5, fit(c, 14), dim, 10.5, "end"));
    else out.push(txt(x0p + band * (i + 0.5), y1p + 14, fit(c, 14), dim, 10.5, "middle"));
  });
  if (t === "line") {
    series.forEach(function (s, si) {
      var d = "", pen = false;
      s.vals.forEach(function (v, i) {
        if (v === null) { pen = false; return; }
        d += (pen ? "L" : "M") + (x0p + band * (i + 0.5)).toFixed(1) + " " + vy(v).toFixed(1);
        pen = true;
      });
      out.push('<path d="' + d + '" fill="none" stroke="' + cols[si] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      if (n <= 60) s.vals.forEach(function (v, i) {
        if (v === null) return;
        out.push('<circle cx="' + (x0p + band * (i + 0.5)).toFixed(1) + '" cy="' + vy(v).toFixed(1) + '" r="4" fill="' + cols[si] + '" stroke="' + bg + '" stroke-width="2"><title>' +
          esc((s.name ? s.name + " · " : "") + model.cats[i] + ": " + fmtNum(v, lang)) + "</title></circle>");
      });
    });
    out.push("</svg>");
    return out.join("");
  }
  /* columns / bars, grouped, 2 px gap between neighbours */
  var bw = Math.max(1, Math.min(24, (band * 0.8 - (ns - 1) * 2) / ns));
  var gw = bw * ns + (ns - 1) * 2;
  series.forEach(function (s, si) {
    s.vals.forEach(function (v, i) {
      if (v === null) return;
      var off = band * i + (band - gw) / 2 + si * (bw + 2), tip = esc((s.name ? s.name + " · " : "") + model.cats[i] + ": " + fmtNum(v, lang));
      if (horiz) {
        var yb = y0p + off, xa = vx(0), xb = vx(v);
        out.push('<path d="' + barPath(Math.min(xa, xb), yb, Math.abs(xb - xa), bw, v >= 0 ? "r" : "l") + '" fill="' + cols[si] + '"><title>' + tip + "</title></path>");
      } else {
        var xb2 = x0p + off, ya = vy(0), yv = vy(v);
        out.push('<path d="' + barPath(xb2, Math.min(ya, yv), bw, Math.abs(ya - yv), v >= 0 ? "t" : "b") + '" fill="' + cols[si] + '"><title>' + tip + "</title></path>");
      }
    });
  });
  out.push("</svg>");
  return out.join("");

  function drawPie() {
    var sl = pieSlices(series[0], model.cats, o.otherWord), tot = 0;
    sl.forEach(function (s) { tot += s.v; });
    var cx = (left + right) / 2, cy = (top + bottom) / 2, rad = Math.max(10, Math.min(right - left, bottom - top) / 2 - 4);
    var inner = t === "donut" ? rad * 0.6 : 0, a0 = -Math.PI / 2;
    if (!tot) { out.push(txt(cx, cy, o.empty || "", dim, 13, "middle")); return; }
    sl.forEach(function (s, i) {
      var a1 = a0 + s.v / tot * Math.PI * 2, pct = s.v / tot * 100;
      var pctTxt = (pct >= 10 ? Math.round(pct) : Number(pct.toFixed(1))) + "%";
      if (lang === "el") pctTxt = pctTxt.replace(".", ",");
      out.push('<path d="' + arc(cx, cy, rad, inner, a0, a1) + '" fill="' + cols[i % 8] + '" stroke="' + bg + '" stroke-width="2"><title>' +
        esc(s.name + ": " + fmtNum(s.v, lang) + " (" + pctTxt + ")") + "</title></path>");
      if (pct >= 6 && rad > 40) {
        var am = (a0 + a1) / 2, lr = inner ? (rad + inner) / 2 : rad * 0.62;
        var fill = cols[i % 8];
        out.push(txt(cx + Math.cos(am) * lr, cy + Math.sin(am) * lr + 4, pctTxt, inkOn(fill), 11, "middle", 'font-weight="700"'));
      }
      a0 = a1;
    });
  }
  function txt(x, y, s, fill, size, anchor, extra) {
    return '<text x="' + (+x).toFixed(1) + '" y="' + (+y).toFixed(1) + '" fill="' + fill + '" font-size="' + size + '" text-anchor="' + anchor + '"' + (extra ? " " + extra : "") + ">" + esc(s) + "</text>";
  }
  function line(xa, ya, xb, yb, c) {
    return '<line x1="' + xa.toFixed(1) + '" y1="' + ya.toFixed(1) + '" x2="' + xb.toFixed(1) + '" y2="' + yb.toFixed(1) + '" stroke="' + c + '" stroke-width="1"/>';
  }
}
/* a bar with a 4 px rounded data end ("t" top, "b" bottom, "r", "l") */
function barPath(x, y, w, h, end) {
  var rr = Math.min(4, w / 2, h / 2);
  if (h <= 0 || w <= 0) return "M" + x.toFixed(1) + " " + y.toFixed(1);
  var X = function (v) { return v.toFixed(1); };
  if (end === "t") return "M" + X(x) + " " + X(y + h) + "V" + X(y + rr) + "Q" + X(x) + " " + X(y) + " " + X(x + rr) + " " + X(y) + "H" + X(x + w - rr) + "Q" + X(x + w) + " " + X(y) + " " + X(x + w) + " " + X(y + rr) + "V" + X(y + h) + "Z";
  if (end === "b") return "M" + X(x) + " " + X(y) + "V" + X(y + h - rr) + "Q" + X(x) + " " + X(y + h) + " " + X(x + rr) + " " + X(y + h) + "H" + X(x + w - rr) + "Q" + X(x + w) + " " + X(y + h) + " " + X(x + w) + " " + X(y + h - rr) + "V" + X(y) + "Z";
  if (end === "r") return "M" + X(x) + " " + X(y) + "H" + X(x + w - rr) + "Q" + X(x + w) + " " + X(y) + " " + X(x + w) + " " + X(y + rr) + "V" + X(y + h - rr) + "Q" + X(x + w) + " " + X(y + h) + " " + X(x + w - rr) + " " + X(y + h) + "H" + X(x) + "Z";
  return "M" + X(x + w) + " " + X(y) + "H" + X(x + rr) + "Q" + X(x) + " " + X(y) + " " + X(x) + " " + X(y + rr) + "V" + X(y + h - rr) + "Q" + X(x) + " " + X(y + h) + " " + X(x + rr) + " " + X(y + h) + "H" + X(x + w) + "Z";
}
function arc(cx, cy, r, ri, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  var large = a1 - a0 > Math.PI ? 1 : 0, f = function (v) { return v.toFixed(2); };
  var p = "M" + f(cx + r * Math.cos(a0)) + " " + f(cy + r * Math.sin(a0)) +
    "A" + f(r) + " " + f(r) + " 0 " + large + " 1 " + f(cx + r * Math.cos(a1)) + " " + f(cy + r * Math.sin(a1));
  if (ri > 0) p += "L" + f(cx + ri * Math.cos(a1)) + " " + f(cy + ri * Math.sin(a1)) +
    "A" + f(ri) + " " + f(ri) + " 0 " + large + " 0 " + f(cx + ri * Math.cos(a0)) + " " + f(cy + ri * Math.sin(a0)) + "Z";
  else p += "L" + f(cx) + " " + f(cy) + "Z";
  return p;
}
/* pie slices: positive values only; past 8 the rest fold into "Other" */
function pieSlices(s, cats, otherWord) {
  var sl = [];
  s.vals.forEach(function (v, i) { if (v !== null && v > 0) sl.push({ name: String(cats[i]), v: v }); });
  if (sl.length > 8) {
    var keep = sl.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 7), rest = 0;
    var set = keep.slice();
    sl.forEach(function (x) { if (set.indexOf(x) < 0) rest += x.v; });
    sl = sl.filter(function (x) { return set.indexOf(x) >= 0; });
    sl.push({ name: otherWord || "Other", v: rest });
  }
  return sl;
}

var API = {
  MAX_ROWS: MAX_ROWS, MAX_COLS: MAX_COLS, MAX_POINTS: MAX_POINTS, MAX_SERIES: MAX_SERIES,
  colName: colName, colFromName: colFromName, esc: esc, hex: hex, mix: mix, inkOn: inkOn, rgba: rgba, luminance: luminance,
  parseRange: parseRange, rangeStr: rangeStr, inRange: inRange, adjRange: adjRange,
  fillSeries: fillSeries, classify: classify,
  toTSV: toTSV, parseTSV: parseTSV, parseHTMLTable: parseHTMLTable, toHTML: toHTML, pasteValue: pasteValue, cssFmt: cssFmt,
  CF_KINDS: CF_KINDS, cfStats: cfStats, cfStyle: cfStyle,
  CHART_TYPES: CHART_TYPES, normChart: normChart, normCf: normCf,
  chartModel: chartModel, chartSVG: chartSVG, niceScale: niceScale, fmtNum: fmtNum, seriesColors: seriesColors, pieSlices: pieSlices,
  SERIES: SERIES
};
root.OrosSheetKit = API;
if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
