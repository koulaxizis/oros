// ============================================================
// orOS Atelier — tables and charts: the data (v1.0.0)
// Pure: no DOM. ax.js uses it to normalise the two element kinds;
// draw.js / objui.js / pdfout.js use the geometry and the chart spec.
//   table  ax.tb = { rows [[text ≤ 400]] 1..30 × 1..10,
//                    hd 0 (no header row; header is the default),
//                    hc 1 (first column bold), bd 1 (banded rows),
//                    ln "h" | "none" | "box" (default "all"),
//                    ac header fill (default HEAD), bf band fill
//                    (default BAND), cf cell fill ("" = none),
//                    cw [relative column widths 1..100] (absent =
//                    equal) }
//          + ax.font, ax.size (text size before shrink-to-fit),
//          ax.fc text colour, ax.sc line colour, ax.al l|c|r;
//          line width = the item's sw.
//   chart  ax.ch = { t col|bar|line|pie|donut|scatter,
//                    rows [[text ≤ 60]] ≤ 31 × 9 (first row: series
//                    names, first column: categories), ttl ≤ 100,
//                    lg 0 (no legend), by "r" | "c" (series in rows /
//                    columns; absent = automatic), tc text colour,
//                    co [series colours ≤ 8] }
//          + ax.fc background ("" = see-through), ax.size label
//          size in pt (absent = automatic).
// The chart picture comes from the Spreadsheet's chart engine
// (spreadsheet/sheetkit.js: chartModel + chartSVG), like Slides.
// Exposes window.AtelierObjects (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_R = 30, MAX_C = 10, MAX_CELL = 400;
  var CH_R = 31, CH_C = 9, CH_CELL = 60, CH_TTL = 100;
  var CHART_TYPES = ["col", "bar", "line", "pie", "donut", "scatter"];
  var LINES = ["all", "h", "none", "box"];
  var HEAD = "#2b4c7e", BAND = "#eef2f7", INK = "#1f2328", RULE = "#c9d1dc";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function int(v, lo, hi, def) { return isNum(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def; }
  function bit(v) { return v === 1 || v === true ? 1 : 0; }
  function col(c) {
    if (typeof c !== "string") return "";
    var s = c.trim().toLowerCase().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/.test(s)) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return /^[0-9a-f]{6}$/.test(s) ? "#" + s : "";
  }
  function cell(v, max, multi) {
    var s = typeof v === "number" && isFinite(v) ? String(v) : typeof v === "string" ? v : "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
    if (!multi) s = s.replace(/\n+/g, " ");
    return s.slice(0, max);
  }
  // A rectangular grid of strings, cut to the limits, padded to the
  // widest row; null when there is nothing.
  function grid(rows, maxR, maxC, maxCell, multi) {
    if (!Array.isArray(rows)) return null;
    var list = rows.slice(0, maxR).filter(Array.isArray);
    if (!list.length) return null;
    var w = 1;
    list.forEach(function (r) { w = Math.max(w, Math.min(maxC, r.length)); });
    return list.map(function (r) {
      var out = [];
      for (var c = 0; c < w; c++) out.push(cell(r[c], maxCell, multi));
      return out;
    });
  }

  // ---------- 1. Normalisers ----------
  function normTable(tb) {
    if (!tb || typeof tb !== "object") return null;
    var rows = grid(tb.rows, MAX_R, MAX_C, MAX_CELL, true);
    if (!rows) return null;
    var o = { rows: rows };
    if (tb.hd === 0 || tb.hd === false) o.hd = 0;
    if (bit(tb.hc)) o.hc = 1;
    if (bit(tb.bd)) o.bd = 1;
    var ln = LINES.indexOf(tb.ln) >= 0 ? tb.ln : "all";
    if (ln !== "all") o.ln = ln;
    var ac = col(tb.ac);
    if (ac && ac !== HEAD) o.ac = ac;
    var bf = col(tb.bf);
    if (bf && bf !== BAND) o.bf = bf;
    var cf = col(tb.cf);
    if (cf) o.cf = cf;
    if (Array.isArray(tb.cw) && tb.cw.length === rows[0].length) {
      var cw = tb.cw.map(function (v) { return int(v, 1, 100, 10); });
      if (cw.some(function (v) { return v !== cw[0]; })) o.cw = cw;
    }
    return o;
  }
  function normChart(ch) {
    if (!ch || typeof ch !== "object") return null;
    var rows = grid(ch.rows, CH_R, CH_C, CH_CELL, false);
    if (!rows) return null;
    var o = { t: CHART_TYPES.indexOf(ch.t) >= 0 ? ch.t : "col", rows: rows };
    var ttl = cell(ch.ttl, CH_TTL, false).trim();
    if (ttl) o.ttl = ttl;
    if (ch.lg === 0 || ch.lg === false) o.lg = 0;
    if (ch.by === "r" || ch.by === "c") o.by = ch.by;
    var tc = col(ch.tc);
    if (tc && tc !== INK) o.tc = tc;
    if (Array.isArray(ch.co)) {
      var co = ch.co.slice(0, 8).map(col);
      if (co.length && co.every(Boolean)) o.co = co;
    }
    return o;
  }

  // ---------- 2. Table geometry ----------
  // Column lefts / widths and row tops / heights in item points.
  function tableGrid(it) {
    var tb = it.ax.tb, R = tb.rows.length, C = tb.rows[0].length;
    var cw = tb.cw && tb.cw.length === C ? tb.cw : null, sum = 0, xs = [], ws = [];
    for (var c = 0; c < C; c++) sum += cw ? cw[c] : 1;
    var x = 0;
    for (c = 0; c < C; c++) { var w = it.w * (cw ? cw[c] : 1) / sum; xs.push(x); ws.push(w); x += w; }
    var rh = it.h / R, ys = [], hs = [];
    for (var r = 0; r < R; r++) { ys.push(r * rh); hs.push(rh); }
    return { R: R, C: C, xs: xs, ws: ws, ys: ys, hs: hs };
  }
  function lum(hex) {
    var v = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function inkOn(hex) { return lum(col(hex) || "#ffffff") > 0.4 ? INK : "#ffffff"; }
  // What a cell looks like: fill, text colour, bold.
  function cellLook(it, r, c) {
    var tb = it.ax.tb, head = tb.hd !== 0 && r === 0;
    var fill = head ? (tb.ac || HEAD) : (tb.bd && (r - (tb.hd !== 0 ? 1 : 0)) % 2 === 1 ? (tb.bf || BAND) : (tb.cf || ""));
    var ink = head ? inkOn(tb.ac || HEAD) : (it.ax.fc || INK);
    return { head: head, fill: fill, ink: ink, b: head || (tb.hc && c === 0) ? 1 : 0 };
  }
  // The lines of a table in item points: [[x0, y0, x1, y1]].
  function tableRules(it) {
    var tb = it.ax.tb, g = tableGrid(it), ln = tb.ln || "all", out = [], r, c;
    if (ln === "none") return out;
    var W = it.w, H = it.h;
    if (ln === "box" || ln === "all") {
      out.push([0, 0, W, 0], [0, H, W, H], [0, 0, 0, H], [W, 0, W, H]);
    }
    if (ln === "all" || ln === "h") {
      for (r = 1; r < g.R; r++) out.push([0, g.ys[r], W, g.ys[r]]);
      if (ln === "h") out.push([0, H, W, H]);
    }
    if (ln === "box" && tb.hd !== 0 && g.R > 1) out.push([0, g.ys[1], W, g.ys[1]]);
    if (ln === "all") for (c = 1; c < g.C; c++) out.push([g.xs[c], 0, g.xs[c], H]);
    return out;
  }
  function cellPad(size) { return Math.max(1, size * 0.35); }

  // ---------- 3. Charts ----------
  // "1.234,5", "1,234.5", "12,5", "50%", "€ 3" → number; else null.
  function num(s) {
    s = String(s === null || s === undefined ? "" : s).replace(/[\s %€$£]/g, "");
    if (!s) return null;
    if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (/^[-+]?(\d+[.,]?\d*|[.,]\d+)$/.test(s)) s = s.replace(",", ".");
    else return null;
    var v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  // The rows as the cells sheetkit's chartModel reads.
  // An empty top-left cell marks a labelled table: the first row is
  // then series names even when they look like numbers ("2024", "2025").
  function chartGrid(rows) {
    var named = rows.length > 1 && rows[0].length > 1 && !String(rows[0][0]).trim();
    return rows.map(function (row, r) {
      return row.map(function (s) { return { n: named && r === 0 ? null : num(s), s: s }; });
    });
  }
  function mixHex(a, b, t) {
    function p(h, i) { return parseInt(h.substr(i, 2), 16); }
    return "#" + [1, 3, 5].map(function (i) {
      var v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * t);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  // What the picture shows. The SVG is drawn at `k` SVG px per point
  // so its 12 px labels come out at the label size; opts.pageBg is
  // the colour behind a see-through chart (grid and muted tones).
  function chartSpec(it, opts) {
    opts = opts || {};
    var ax = it.ax, ch = ax.ch;
    var label = ax.size || Math.max(6, Math.min(40, Math.min(it.w, it.h) / 26));
    var k = 12 / label;
    var w = Math.max(160, Math.round(it.w * k)), h = Math.max(120, Math.round(it.h * k));
    var under = ax.fc || col(opts.pageBg) || "#ffffff";
    var ink = ch.tc || INK;
    return {
      t: ch.t, rows: ch.rows, by: ch.by || "", ttl: ch.ttl || "", lg: ch.lg === 0 ? 0 : 1,
      w: w, h: h, k: Math.round(w / Math.max(1, it.w) * 10000) / 10000,
      pal: { bg: ax.fc || "none", text: ink, dim: mixHex(ink, under, 0.3), grid: mixHex(ink, under, 0.84), dark: lum(under) < 0.3,
        font: "'Noto Sans', Arial, sans-serif" },
      co: ch.co || [], lang: opts.lang === "el" ? "el" : "en"
    };
  }
  // 64 hex digits of a string (eight FNV-1a passes): a cache key.
  function hash64(s) {
    var out = "";
    for (var k = 0; k < 8; k++) {
      var h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
      out += ("0000000" + (h >>> 0).toString(16)).slice(-8);
    }
    return out;
  }
  function chartKey(spec) { return hash64(JSON.stringify(spec)); }
  // The SVG of a chart (sheetkit passed in: OrosSheetKit).
  function chartSvg(K, spec, words) {
    words = words || {};
    var model = K.chartModel(chartGrid(spec.rows), { by: spec.by, t: spec.t });
    return K.chartSVG(model, {
      t: spec.t, w: spec.w, h: spec.h, ttl: spec.ttl, lg: spec.lg, co: spec.co, lang: spec.lang, pal: spec.pal,
      empty: words.empty || "", seriesWord: words.series || "", otherWord: words.other || ""
    });
  }
  // Text rows from pasted spreadsheet cells (tab-separated, or CSV
  // with , or ;), cut to the given limits.
  function rowsFromText(text, maxR, maxC, maxCell) {
    text = String(text || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (!text) return null;
    var first = text.split("\n")[0];
    var sep = first.indexOf("\t") >= 0 ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
    var rows = [], row = [], f = "", inQ = false, start = true;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inQ) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else inQ = false; } else f += c;
        continue;
      }
      if (c === '"' && start) { inQ = true; start = false; continue; }
      start = false;
      if (c === sep) { row.push(f); f = ""; start = true; }
      else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; start = true; }
      else f += c;
    }
    row.push(f); rows.push(row);
    return grid(rows, maxR || MAX_R, maxC || MAX_C, maxCell || MAX_CELL, true);
  }

  var api = {
    MAX_R: MAX_R, MAX_C: MAX_C, MAX_CELL: MAX_CELL, CH_R: CH_R, CH_C: CH_C, CH_CELL: CH_CELL,
    CHART_TYPES: CHART_TYPES, LINES: LINES, HEAD: HEAD, BAND: BAND, INK: INK, RULE: RULE,
    normTable: normTable, normChart: normChart, tableGrid: tableGrid, tableRules: tableRules, cellLook: cellLook,
    cellPad: cellPad, inkOn: inkOn, num: num, chartGrid: chartGrid, chartSpec: chartSpec, chartKey: chartKey,
    chartSvg: chartSvg, hash64: hash64, rowsFromText: rowsFromText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierObjects = api;
})(typeof window !== "undefined" ? window : this);
