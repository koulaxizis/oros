// ============================================================
// orOS designkit — table.js (v1.0.0, LY-W12): tables in a story.
// A table is a paragraph whose ext.tbl holds it; text.js sets it in
// the text's column (rows never split; header rows repeat at the top
// of each new column or page) and the renderers draw its fills and
// rules (line.tb). The grid is always whole: every row has one cell
// per column; a cell under another's span is { x: 1 }.
//   tbl = { cols: [relative widths], rows: [{ c: [cell], h (pt, the
//           least height), }], hdr (header rows, repeated), pad (pt),
//           bw (rule width, pt; 0 = none), rep (0 = header rows not
//           repeated), bc (rule swatch), hf
//           (header fill swatch), cps / hps (cell / header paragraph
//           style; default the table paragraph's) }
//   cell = { t (text; "\n" parts paragraphs), s (columns it spans),
//            r (rows it spans), f (fill swatch), x (covered) }
// norm(tbl) → a clean table or null. fromGrid(rows of strings, {hdr})
// → tbl. Edits (return a new table): addRow, delRow, addCol, delCol,
// merge(r, c, rs, cs), split(r, c), setText(r, c, t). text(tbl) → the
// cell texts, row by row, tab-separated (search, EPUB, counts).
// parseCSV(text) → rows of strings, for fromGrid. unrun(paras): text
// in a table paragraph moves to a paragraph after it.
// Pure (no DOM). Exposes orosDK.table / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_R = 1000, MAX_C = 30, MAX_T = 4000, ID = /^[a-z]{1,4}-[A-Za-z0-9_-]{1,40}$/;

  function int(v, lo, hi, d) { v = Math.round(Number(v)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function sid(v) { return typeof v === "string" && ID.test(v) ? v : ""; }
  function txt(v) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_T) : ""; }

  // a clean table: sizes held, spans inside the grid, covered cells
  // marked again from the spans
  function norm(tb) {
    if (!tb || typeof tb !== "object" || !Array.isArray(tb.rows) || !tb.rows.length) return null;
    var C = Array.isArray(tb.cols) && tb.cols.length ? Math.min(MAX_C, tb.cols.length) : 0;
    tb.rows.slice(0, MAX_R).forEach(function (r) { if (r && Array.isArray(r.c)) C = Math.max(C, Math.min(MAX_C, r.c.length)); });
    if (!C) return null;
    var cols = [];
    for (var k = 0; k < C; k++) cols.push(num(tb.cols && tb.cols[k], 0.05, 100, 1));
    var rows = tb.rows.slice(0, MAX_R).map(function (r) {
      var c = [];
      for (var j = 0; j < C; j++) {
        var x = r && Array.isArray(r.c) ? r.c[j] : null, o = { t: txt(x && x.t) };
        var s = int(x && x.s, 1, C - j, 1), rs = int(x && x.r, 1, MAX_R, 1), f = sid(x && x.f);
        if (s > 1) o.s = s;
        if (rs > 1) o.r = rs;
        if (f) o.f = f;
        c.push(o);
      }
      var row = { c: c }, h = num(r && r.h, 0, 2000, 0);
      if (h) row.h = h;
      return row;
    });
    var R = rows.length;
    // spans: the first cell wins; what it covers is x
    for (var i = 0; i < R; i++) for (var j2 = 0; j2 < C; j2++) {
      var cl = rows[i].c[j2];
      if (cl.x) continue;
      if (cl.r) cl.r = Math.min(cl.r, R - i);
      if (cl.r === 1) delete cl.r;
      var rs2 = cl.r || 1, cs2 = cl.s || 1, clash = false;
      // a span may not reach a cell another span covers
      for (var a0 = 0; a0 < rs2; a0++) for (var b0 = 0; b0 < cs2; b0++) if ((a0 || b0) && rows[i + a0].c[j2 + b0].x) clash = true;
      if (clash) { delete cl.r; delete cl.s; rs2 = cs2 = 1; }
      for (var a = 0; a < rs2; a++) for (var b = 0; b < cs2; b++) {
        if (!a && !b) continue;
        var u = rows[i + a].c[j2 + b];
        u.x = 1; delete u.s; delete u.r; u.t = ""; delete u.f;
      }
    }
    var out = { cols: cols, rows: rows, hdr: int(tb.hdr, 0, Math.min(R - 1, 20), 0), pad: num(tb.pad, 0, 36, 4), bw: num(tb.bw, 0, 12, 0.5) };
    ["bc", "hf", "cps", "hps"].forEach(function (k) { var v = sid(tb[k]); if (v) out[k] = v; });
    if (tb.rep === 0) out.rep = 0;
    return out;
  }
  function fromGrid(grid, opts) {
    opts = opts || {};
    var rows = (grid || []).slice(0, MAX_R).map(function (r) { return { c: (r || []).slice(0, MAX_C).map(function (v) { return { t: v == null ? "" : String(v) }; }) }; });
    if (!rows.length) return null;
    var C = Math.max.apply(null, rows.map(function (r) { return r.c.length; }).concat([1]));
    rows.forEach(function (r) { while (r.c.length < C) r.c.push({ t: "" }); });
    var cols = [];
    for (var k = 0; k < C; k++) cols.push(1);
    return norm({ cols: cols, rows: rows, hdr: opts.hdr ? 1 : 0, pad: opts.pad, bw: opts.bw, bc: opts.bc, hf: opts.hf });
  }
  function copy(tb) { return JSON.parse(JSON.stringify(tb)); }
  function blankRow(C) { var c = []; for (var j = 0; j < C; j++) c.push({ t: "" }); return { c: c }; }
  // spans are re-read from scratch: undo every x, then norm marks them
  function open(tb) { tb.rows.forEach(function (r) { r.c.forEach(function (c) { delete c.x; }); }); return tb; }
  function addRow(tb, at) {
    var t = open(copy(tb)), R = t.rows.length;
    at = int(at, 0, R, R);
    if (R >= MAX_R) return norm(t);
    // a span over the new row grows
    t.rows.forEach(function (r, i) { r.c.forEach(function (c) { if (c.r && i < at && i + c.r > at) c.r++; }); });
    t.rows.splice(at, 0, blankRow(t.cols.length));
    if (at < t.hdr) t.hdr++;
    return norm(t);
  }
  function delRow(tb, at) {
    var t = open(copy(tb)), R = t.rows.length;
    if (R < 2) return norm(t);
    at = int(at, 0, R - 1, R - 1);
    t.rows.forEach(function (r, i) { r.c.forEach(function (c) { if (c.r && i < at && i + c.r > at) c.r--; }); });
    // a span that starts here moves down
    t.rows[at].c.forEach(function (c, j) { if (c.r > 1 && t.rows[at + 1]) { var n = t.rows[at + 1].c[j]; n.r = c.r - 1; n.s = c.s; n.t = n.t || c.t; n.f = n.f || c.f; } });
    t.rows.splice(at, 1);
    if (at < t.hdr) t.hdr--;
    return norm(t);
  }
  function addCol(tb, at) {
    var t = open(copy(tb)), C = t.cols.length;
    if (C >= MAX_C) return norm(t);
    at = int(at, 0, C, C);
    t.rows.forEach(function (r) {
      r.c.forEach(function (c, j) { if (c.s && j < at && j + c.s > at) c.s++; });
      r.c.splice(at, 0, { t: "" });
    });
    t.cols.splice(at, 0, t.cols[Math.min(at, C - 1)] || 1);
    return norm(t);
  }
  function delCol(tb, at) {
    var t = open(copy(tb)), C = t.cols.length;
    if (C < 2) return norm(t);
    at = int(at, 0, C - 1, C - 1);
    t.rows.forEach(function (r) {
      r.c.forEach(function (c, j) { if (c.s && j < at && j + c.s > at) c.s--; });
      var c0 = r.c[at], nx = r.c[at + 1];
      if (c0.s > 1 && nx) { nx.s = c0.s - 1; nx.r = c0.r; nx.t = nx.t || c0.t; nx.f = nx.f || c0.f; }
      r.c.splice(at, 1);
    });
    t.cols.splice(at, 1);
    return norm(t);
  }
  // one cell over rs rows and cs columns; the texts join
  function merge(tb, r0, c0, rs, cs) {
    var t = open(copy(tb)), R = t.rows.length, C = t.cols.length;
    r0 = int(r0, 0, R - 1, 0); c0 = int(c0, 0, C - 1, 0);
    rs = int(rs, 1, R - r0, 1); cs = int(cs, 1, C - c0, 1);
    var parts = [];
    for (var i = r0; i < r0 + rs; i++) for (var j = c0; j < c0 + cs; j++) {
      var c = t.rows[i].c[j];
      if (c.t) parts.push(c.t);
      if (i !== r0 || j !== c0) { c.t = ""; delete c.s; delete c.r; }
    }
    var top = t.rows[r0].c[c0];
    top.t = txt(parts.join("\n"));
    if (cs > 1) top.s = cs; else delete top.s;
    if (rs > 1) top.r = rs; else delete top.r;
    return norm(t);
  }
  function split(tb, r0, c0) {
    var t = open(copy(tb));
    var c = t.rows[r0] && t.rows[r0].c[c0];
    if (c) { delete c.s; delete c.r; }
    return norm(t);
  }
  function setText(tb, r, c, s) {
    var t = copy(tb), cl = t.rows[r] && t.rows[r].c[c];
    if (cl && !cl.x) cl.t = txt(s);
    return norm(t);
  }
  // CSV / TSV text → rows of strings (quotes as in RFC 4180; the
  // delimiter is the one the first line has most of: tab ; or ,)
  function parseCSV(s) {
    s = String(s || "").replace(/^\uFEFF/, "");
    var first = s.split(/\r?\n/, 1)[0] || "", n = { "\t": 0, ";": 0, ",": 0 };
    for (var i0 = 0; i0 < first.length; i0++) if (n[first[i0]] !== undefined) n[first[i0]]++;
    var d = n["\t"] > 0 && n["\t"] >= n[","] && n["\t"] >= n[";"] ? "\t" : n[";"] > n[","] ? ";" : ",";
    var out = [], row = [], cell = "", q = false;
    function endRow() { row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") out.push(row.slice(0, MAX_C)); row = []; }
    for (var i = 0; i < s.length && out.length < MAX_R; i++) {
      var c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && !cell) q = true;
      else if (c === d) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; endRow(); }
      else cell += c;
    }
    if (out.length < MAX_R && (cell || row.length)) endRow();
    return out;
  }
  // a table paragraph holds no text: text typed into it (or joined
  // to it by a deletion) becomes the paragraph after it
  function unrun(paras) {
    var out = [];
    (paras || []).forEach(function (p) {
      if (p && p.ext && p.ext.tbl && p.runs && p.runs.length) {
        out.push(Object.assign({}, p, { runs: [] }));
        var q = { ps: p.ps, runs: p.runs };
        out.push(q);
      } else out.push(p);
    });
    return out;
  }
  function text(tb) {
    return (tb && tb.rows || []).map(function (r) { return r.c.filter(function (c) { return !c.x; }).map(function (c) { return c.t.replace(/\n/g, " "); }).join("\t"); }).join("\n");
  }

  var api = { norm: norm, fromGrid: fromGrid, addRow: addRow, delRow: delRow, addCol: addCol, delCol: delCol, merge: merge, split: split, setText: setText, text: text, parseCSV: parseCSV, unrun: unrun, MAX_R: MAX_R, MAX_C: MAX_C };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.table = api; }
})(typeof window !== "undefined" ? window : this);
