// ============================================================
// orOS QR Generator — many codes from a table, v1.0.0
// Pure: no DOM. Runs in the app (window.orosQRBulk) and in Node
// tests (module.exports).
//   parseCsv(text)            -> { rows: [[cell…]], delim }
//   guessHeader(rows)         -> does the first row hold column names?
//   items(rows, opts)         -> { items: [{ row, text, label }], empty, more }
//   fileNames(items)          -> unique "007 label.png" names
//   sheet(n, grid)            -> label positions on A4 pages (mm)
// ============================================================
(function (root) {
  "use strict";

  var MAX_ITEMS = 500;
  var MAX_ROWS = 5000;
  var MAX_CELL = 2000;
  var MAX_CHARS = 2 * 1024 * 1024;
  // columns × rows of labels on one A4 page
  var GRIDS = { "2x3": [2, 3], "3x4": [3, 4], "4x6": [4, 6], "5x7": [5, 7] };
  var PAGE = { w: 210, h: 297, margin: 10, gap: 4, label: 7 };   // mm

  // RFC 4180: quotes, "" inside quotes, new lines inside quotes. The
  // separator is the one of , ; and tab seen most in the first line
  // (outside quotes); a single column has none.
  function detectDelim(text) {
    var counts = { ",": 0, ";": 0, "\t": 0 }, q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '"') q = !q;
      else if (!q && (c === "\n" || c === "\r")) break;
      else if (!q && counts.hasOwnProperty(c)) counts[c]++;
    }
    var best = ",", n = 0;
    [",", ";", "\t"].forEach(function (d) { if (counts[d] > n) { n = counts[d]; best = d; } });
    return best;
  }
  function parseCsv(text) {
    var s = String(text || "").slice(0, MAX_CHARS).replace(/^﻿/, "");
    var delim = detectDelim(s), rows = [], row = [], cell = "", q = false, i = 0;
    function endCell() { row.push(cell.length > MAX_CELL ? cell.slice(0, MAX_CELL) : cell); cell = ""; }
    function endRow() { endCell(); rows.push(row); row = []; }
    while (i < s.length && rows.length < MAX_ROWS) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === "") { q = true; i++; continue; }
      if (c === delim) { endCell(); i++; continue; }
      if (c === "\r" || c === "\n") {
        endRow();
        i += (c === "\r" && s.charAt(i + 1) === "\n") ? 2 : 1;
        continue;
      }
      cell += c; i++;
    }
    if ((cell !== "" || row.length) && rows.length < MAX_ROWS) endRow();
    // drop blank lines
    rows = rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); });
    return { rows: rows, delim: delim };
  }

  function columns(rows) {
    var n = 0;
    rows.forEach(function (r) { if (r.length > n) n = r.length; });
    return n;
  }

  // A first row of names ("url", "Label") above rows of data: no cell
  // of it looks like data (a link, an address, a number) while the
  // second row has one that does.
  var DATA_RE = /:\/\/|@|^[+\d][\d\s().\/-]*$|^www\./i;
  function guessHeader(rows) {
    if (!rows || rows.length < 2) return false;
    var looks = function (c) { return DATA_RE.test(String(c).trim()); };
    return !rows[0].some(looks) && rows[1].some(looks);
  }

  // opts: { header: bool, col: index, label: index | -1 }. Every row
  // with text in `col` becomes one code (cut to MAX_CELL); rows without
  // it are counted in `empty`. At most MAX_ITEMS (`more` = rows left out).
  function items(rows, opts) {
    var o = opts || {}, col = o.col | 0, lab = typeof o.label === "number" ? o.label : -1;
    var out = [], empty = 0, more = 0;
    (rows || []).forEach(function (r, i) {
      if (o.header && i === 0) return;
      var text = String(r[col] === undefined ? "" : r[col]).trim();
      if (!text) { empty++; return; }
      if (out.length >= MAX_ITEMS) { more++; return; }
      var label = lab >= 0 && r[lab] !== undefined ? String(r[lab]).replace(/\s+/g, " ").trim().slice(0, 80) : "";
      out.push({ row: i + 1, text: text, label: label });
    });
    return { items: out, empty: empty, more: more };
  }

  // "001 Front door.png": the row's place, then the label (letters of
  // any script, digits, space, - and _), unique.
  function fileNames(list, ext) {
    var e = ext || "png", w = Math.max(3, String(list.length).length), used = {};
    return list.map(function (it, i) {
      var num = String(i + 1);
      while (num.length < w) num = "0" + num;
      var lab = String(it.label || "").replace(/[^\p{L}\p{N} _-]+/gu, "-").replace(/\s+/g, " ")
        .replace(/^[-\s]+|[-\s]+$/g, "").slice(0, 40).trim();
      var base = num + (lab ? " " + lab : ""), name = base + "." + e, k = 2;
      while (used[name.toLowerCase()]) name = base + " (" + (k++) + ")." + e;
      used[name.toLowerCase()] = 1;
      return name;
    });
  }

  // Where every label goes: { pages, cells: [{ page, x, y, w, h, code }] }
  // in mm on A4 portrait; `code` is the side of the square code, with
  // room for one line of label text under it when `labels`.
  function sheet(n, gridKey, labels) {
    var g = GRIDS[gridKey] || GRIDS["3x4"], cols = g[0], rws = g[1];
    var cw = (PAGE.w - 2 * PAGE.margin - (cols - 1) * PAGE.gap) / cols;
    var ch = (PAGE.h - 2 * PAGE.margin - (rws - 1) * PAGE.gap) / rws;
    var lab = labels ? Math.min(PAGE.label, ch * 0.2) : 0;
    var side = Math.min(cw, ch - lab) * 0.94;
    var per = cols * rws, cells = [];
    for (var i = 0; i < n; i++) {
      var k = i % per, c = k % cols, r = Math.floor(k / cols);
      cells.push({
        page: Math.floor(i / per),
        x: PAGE.margin + c * (cw + PAGE.gap), y: PAGE.margin + r * (ch + PAGE.gap),
        w: cw, h: ch, code: side, label: lab
      });
    }
    return { pages: Math.ceil(n / per), per: per, cols: cols, rows: rws, cells: cells };
  }

  var api = {
    VERSION: "1.0.0",
    MAX_ITEMS: MAX_ITEMS,
    GRIDS: GRIDS,
    PAGE: PAGE,
    parseCsv: parseCsv,
    columns: columns,
    guessHeader: guessHeader,
    items: items,
    fileNames: fileNames,
    sheet: sheet
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosQRBulk = api;
})(typeof window !== "undefined" ? window : this);
