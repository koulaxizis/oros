// ============================================================
// orOS Layout — merge.js: data merge (v1.0.0)
// One document page (or every page) as a card, filled once per row
// of a CSV file: name cards, labels, badges, certificates.
//   - text: {{Field}} anywhere in a text frame's story is replaced by
//     that row's cell (field names match the CSV header without
//     regard to case or accents); a paragraph that only held empty
//     fields is dropped (no blank lines on a label)
//   - images: an image frame with a data field (item.mf) gets the
//     picture whose file name is in that cell
//   - output: one card per page, or N-up — as many cards as fit on
//     a sheet (A4, A3, Letter), centred, with cut marks
// Pure: no DOM. The caller lays out and draws the sheets it gets
// (render.js / pdf.js). Needs orosDK.model (Node: require).
// Exposes window.LY_MERGE (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M = typeof module !== "undefined" && module.exports ? require("../designkit/model.js") : root.orosDK.model;

  var MAX_BYTES = 5 * 1024 * 1024;
  var MAX_ROWS = 1000, MAX_COLS = 60, MAX_CELL = 2000, MAX_NAME = 60;
  var FIELD_RE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;
  var MM = 72 / 25.4;

  // ---------- CSV ----------
  // Case, accent and space free key ("Όνομα " = "ονομα").
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\u03c2/g, "\u03c3").replace(/\s+/g, " ").trim();
  }
  // The separator of the first line (outside quotes): , ; or tab.
  function sniff(text) {
    var n = { ",": 0, ";": 0, "\t": 0 }, q = false;
    for (var i = 0; i < text.length && i < 20000; i++) {
      var c = text[i];
      if (c === '"') q = !q;
      else if (!q && (c === "\n" || c === "\r")) break;
      else if (!q && c in n) n[c]++;
    }
    return n["\t"] > n[","] && n["\t"] >= n[";"] ? "\t" : n[";"] > n[","] ? ";" : ",";
  }
  // text → { head: [names], rows: [[cells]], cut, delim }. The first
  // row is the header; blank rows are skipped; quotes as in RFC 4180
  // ("" inside quotes is one "); cells keep their line breaks.
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    var delim = sniff(text), out = [], row = [], cell = "", q = false, cut = false;
    function endCell() {
      row.push(cell.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").slice(0, MAX_CELL));
      cell = "";
    }
    function endRow() {
      endCell();
      if (row.some(function (c) { return c.trim(); })) {
        if (out.length > MAX_ROWS) cut = true;
        else out.push(row.slice(0, MAX_COLS));
      }
      row = [];
    }
    for (var i = 0; i < text.length && !cut; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && !cell.trim()) { cell = ""; q = true; }
      else if (c === delim) endCell();
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; endRow(); }
      else cell += c;
    }
    if (!cut && (cell || row.length)) endRow();
    var head = (out.shift() || []).map(function (h, k) { return h.trim().slice(0, MAX_NAME) || "#" + (k + 1); });
    // repeated names: "Name", "Name 2"
    var seen = {};
    head = head.map(function (h) {
      var n = 1, name = h;
      while (seen[fold(name)]) name = h + " " + (++n);
      seen[fold(name)] = 1;
      return name;
    });
    var rows = out.map(function (r) {
      var o = r.slice(0, head.length);
      while (o.length < head.length) o.push("");
      return o;
    });
    return { head: head, rows: rows, cut: cut, delim: delim };
  }

  // ---------- Fields ----------
  function cardPages(doc, pageIds) {
    var order = M.pagesInOrder(doc), want = {};
    pageIds.forEach(function (id) { want[id] = 1; });
    return order.map(function (p, i) { return { page: p, idx: i }; }).filter(function (x) { return want[x.page.id]; });
  }
  // Items of a page as it prints: its master's items (not detached)
  // under its own.
  function cardItems(doc, page, idx) {
    return M.masterItems(doc, page, M.sideOf(doc, idx)).concat(M.itemsOn(doc, page.id));
  }
  function storyText(st) {
    return (st ? st.paras : []).map(function (p) { return p.runs.map(function (r) { return r.t || ""; }).join(""); }).join("\n");
  }
  // { text: [names], img: [names] } used on the chosen pages, first
  // seen first.
  function fieldsOf(doc, pageIds) {
    var text = [], img = [], seenT = {}, seenI = {}, stories = {};
    cardPages(doc, pageIds).forEach(function (x) {
      cardItems(doc, x.page, x.idx).forEach(function (it) {
        if (it.t === "text" && !stories[it.story]) {
          stories[it.story] = 1;
          var s = storyText(M.story(doc, it.story)), m;
          FIELD_RE.lastIndex = 0;
          while ((m = FIELD_RE.exec(s))) {
            var k = fold(m[1]);
            if (!seenT[k]) { seenT[k] = 1; text.push(m[1].trim()); }
          }
        }
        if (it.t === "img" && it.mf && !seenI[fold(it.mf)]) { seenI[fold(it.mf)] = 1; img.push(it.mf); }
      });
    });
    return { text: text, img: img };
  }
  // Column of a field name, -1 when the CSV has none.
  function colOf(head, name) {
    var k = fold(name);
    for (var i = 0; i < head.length; i++) if (fold(head[i]) === k) return i;
    return -1;
  }

  // Paragraphs with the fields filled. value(name) → string, or null
  // when there is no such column (the {{field}} stays as typed, so
  // the mistake shows). A field may span runs (part of it bold): the
  // value takes the formatting of the run where the field starts.
  function fillParas(paras, value) {
    var out = [];
    paras.forEach(function (p) {
      var runs = p.runs.map(function (r) { return Object.assign({}, r); });
      var chars = [];                          // run index of every character
      runs.forEach(function (r, ri) { if (r.t) for (var o = 0; o < r.t.length; o++) chars.push(ri); });
      var full = runs.map(function (r) { return r.t || ""; }).join("");
      var hits = [], m, any = false;
      FIELD_RE.lastIndex = 0;
      while ((m = FIELD_RE.exec(full))) {
        var v = value(m[1].trim());
        if (v === null || v === undefined) continue;
        hits.push({ a: m.index, b: m.index + m[0].length, v: String(v) });
        any = true;
      }
      if (!any) { out.push({ ps: p.ps, runs: runs }); return; }
      // rebuild each run's text: drop matched characters, put the value
      // where the match starts
      var texts = runs.map(function () { return ""; }), h = 0;
      for (var i = 0; i < full.length; i++) {
        var ri = chars[i];
        while (h < hits.length && i >= hits[h].b) h++;
        var hit = h < hits.length && i >= hits[h].a ? hits[h] : null;
        if (!hit) { texts[ri] += full[i]; continue; }
        if (i === hit.a) texts[ri] += hit.v;
      }
      var nr = [];
      runs.forEach(function (r, ri) {
        if (r.f) { nr.push(r); return; }
        if (!texts[ri]) return;
        var c = Object.assign({}, r); c.t = texts[ri]; nr.push(c);
      });
      var txt = nr.map(function (r) { return r.t || ""; }).join("");
      // only empty fields on this line: no blank line
      if (!txt.trim() && !nr.some(function (r) { return r.f; })) return;
      out.push({ ps: p.ps, runs: nr });
    });
    if (!out.length) out.push({ ps: paras.length ? paras[0].ps : "ps-base", runs: [] });
    return out;
  }

  // File name → key for image lookup ("Photos/Anna.JPG" → "anna.jpg").
  function fileKey(s) {
    var n = String(s || "").replace(/\\/g, "/").split("/").pop();
    return fold(n);
  }
  // Distinct picture names the rows ask for (keys → as typed).
  function imageNames(doc, pageIds, head, rows) {
    var cols = fieldsOf(doc, pageIds).img.map(function (f) { return colOf(head, f); }).filter(function (c) { return c >= 0; });
    var out = {};
    rows.forEach(function (r) { cols.forEach(function (c) { var k = fileKey(r[c]); if (k) out[k] = String(r[c]).trim(); }); });
    return out;
  }

  // ---------- Sheets ----------
  // How many cards of w × h fit on a sheet W × H with `gap` between
  // cards and `margin` around: { cols, rows, x0, y0 } (grid centred).
  function grid(W, H, w, h, gap, margin) {
    var cols = Math.max(0, Math.floor((W - 2 * margin + gap) / (w + gap)));
    var rows = Math.max(0, Math.floor((H - 2 * margin + gap) / (h + gap)));
    return {
      cols: cols, rows: rows,
      x0: (W - (cols * w + (cols - 1) * gap)) / 2, y0: (H - (rows * h + (rows - 1) * gap)) / 2
    };
  }
  var SHEETS = [["a4", 210, 297], ["a3", 297, 420], ["letter", 215.9, 279.4]];
  // The sheet (portrait or landscape) that holds the most cards.
  function bestSheet(id, w, h, gap, margin) {
    var s = SHEETS.filter(function (x) { return x[0] === id; })[0] || SHEETS[0];
    var a = { W: s[1] * MM, H: s[2] * MM }, b = { W: s[2] * MM, H: s[1] * MM };
    var ga = grid(a.W, a.H, w, h, gap, margin), gb = grid(b.W, b.H, w, h, gap, margin);
    return ga.cols * ga.rows >= gb.cols * gb.rows ? { W: a.W, H: a.H, g: ga } : { W: b.W, H: b.H, g: gb };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // A document of finished pages for some rows.
  //   doc, pageIds: the card (every chosen page per row; N-up uses
  //                 the first chosen page)
  //   head, rows:   the CSV (rows: the slice to place)
  //   opts: { now, images { fileKey: { a, iw, ih, nm } },
  //           nup: { sheet "a4"|"a3"|"letter", gap pt, margin pt, marks } | null }
  // → { doc, missing: { fileKey: name }, clip: { itemId: rect } }
  // The result is built from normalized parts and is NOT normalized
  // again (it can hold more pages and items than a stored document);
  // it is never stored.
  function build(doc, pageIds, head, rows, opts) {
    opts = opts || {};
    var now = opts.now || 1, images = opts.images || {}, nup = opts.nup || null;
    var cards = cardPages(doc, pageIds);
    if (nup) cards = cards.slice(0, 1);
    var s = doc.setup;
    var out = {
      id: doc.id, m: now, name: doc.name, setup: clone(s),
      pages: [], masters: [], items: [], stories: [], pstyles: doc.pstyles, cstyles: doc.cstyles,
      swatches: doc.swatches, guides: [], rec: [], tombs: {}
    };
    out.setup.facing = 0;
    var sheet = null;
    if (nup) {
      sheet = bestSheet(nup.sheet, s.w, s.h, nup.gap || 0, nup.margin || 0);
      out.setup.w = Math.round(sheet.W * 1000) / 1000; out.setup.h = Math.round(sheet.H * 1000) / 1000;
      out.setup.bleed = 0;
    }
    var per = sheet ? sheet.g.cols * sheet.g.rows : 1;
    var storyById = {};
    doc.stories.forEach(function (st) { storyById[st.id] = st; });
    var missing = {}, clip = {}, pageNo = 0, slot = per, curPage = null;

    function newPage() {
      curPage = { id: "pg-m" + (++pageNo), m: now, pos: pageNo, ms: "" };
      out.pages.push(curPage);
      slot = 0;
    }
    rows.forEach(function (row, ri) {
      function value(name) {
        var c = colOf(head, name);
        return c < 0 ? null : row[c];
      }
      cards.forEach(function (card, ci) {
        if (slot >= per) newPage();
        var ox = 0, oy = 0, rect = null;
        if (sheet) {
          var col = slot % sheet.g.cols, rw = Math.floor(slot / sheet.g.cols);
          ox = sheet.g.x0 + col * (s.w + (nup.gap || 0));
          oy = sheet.g.y0 + rw * (s.h + (nup.gap || 0));
          rect = { x: ox, y: oy, w: s.w, h: s.h };
        }
        var tag = "r" + ri + "c" + ci, storyMap = {};
        cardItems(doc, card.page, card.idx).forEach(function (src, k) {
          var it = clone(src);
          it.id = "it-" + tag + "k" + k + "p" + pageNo;
          it.pg = curPage.id; it.side = ""; it.grp = ""; it.m = now;
          delete it.ov;
          it.x += ox; it.y += oy;
          it.z = slot * 100000 + k;
          if (it.t === "text") {
            if (!storyMap[it.story]) {
              var st0 = storyById[it.story];
              var nid = "st-" + tag + "p" + pageNo + "n" + Object.keys(storyMap).length;
              storyMap[it.story] = nid;
              out.stories.push({ id: nid, m: now, h: [], paras: fillParas(st0 ? st0.paras : [], value) });
            }
            it.story = storyMap[it.story];
          }
          if (it.t === "img" && it.mf && colOf(head, it.mf) >= 0) {
            var name = String(value(it.mf) || "").trim(), key = fileKey(name), im = key ? images[key] : null;
            if (im) {
              it.a = im.a; it.iw = im.iw; it.ih = im.ih; it.nm = im.nm || name;
              if (it.fit === "custom") {
                it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
                if (it.ext) { delete it.ext.iscy; if (!Object.keys(it.ext).length) delete it.ext; }
              }
            } else {
              it.a = ""; it.nm = name;
              if (key) missing[key] = name;
            }
          }
          if (rect) clip[it.id] = rect;
          out.items.push(it);
        });
        slot++;
      });
    });
    if (sheet && nup.marks) marks(out, sheet, s.w, s.h, nup.gap || 0, now);
    return { doc: out, missing: missing, clip: clip, perSheet: per };
  }

  // Short hairlines in the margin around the grid, on every card edge
  // (one set per sheet: every sheet has the same grid).
  function marks(out, sheet, w, h, gap, now) {
    var g = sheet.g, len = Math.min(5 * MM, Math.max(2, Math.min(g.x0, g.y0) - 2 * MM)), off = 1.5 * MM;
    if (len <= 0 || !out.swatches.some(function (x) { return x.id === "sw-black"; })) return;
    var xs = [], ys = [];
    for (var c = 0; c < g.cols; c++) { var x = g.x0 + c * (w + gap); xs.push(x, x + w); }
    for (var r = 0; r < g.rows; r++) { var y = g.y0 + r * (h + gap); ys.push(y, y + h); }
    xs = xs.filter(function (v, i) { return xs.indexOf(v) === i; });
    ys = ys.filter(function (v, i) { return ys.indexOf(v) === i; });
    var gridR = g.x0 + g.cols * w + (g.cols - 1) * gap, gridB = g.y0 + g.rows * h + (g.rows - 1) * gap, n = 0;
    out.pages.forEach(function (pg) {
      function line(x, y, dx, dy) {
        out.items.push({ id: "it-cut" + pg.pos + "n" + (n++), m: now, t: "line", pg: pg.id, side: "", x: x, y: y, w: dx, h: dy,
          rot: 0, z: 1e11, fill: "", stroke: "sw-black", sw: 0.25, dash: 0, op: 100, r: 0, lock: 0, hide: 0, grp: "", wrap: "none", wo: 0 });
      }
      xs.forEach(function (x) { line(x, g.y0 - off - len, 0, len); line(x, gridB + off, 0, len); });
      ys.forEach(function (y) { line(g.x0 - off - len, y, len, 0); line(gridR + off, y, len, 0); });
    });
  }

  var api = {
    parseCSV: parseCSV, fold: fold, fieldsOf: fieldsOf, colOf: colOf, fillParas: fillParas,
    fileKey: fileKey, imageNames: imageNames, grid: grid, bestSheet: bestSheet, build: build,
    SHEETS: SHEETS, MAX_BYTES: MAX_BYTES, MAX_ROWS: MAX_ROWS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_MERGE = api;
})(typeof window !== "undefined" ? window : this);
