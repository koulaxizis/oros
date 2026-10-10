// ============================================================
// orOS Layout — PDF import (v1.0.0)
// Opens a PDF (for example one exported from Affinity Publisher) as a
// NEW Layout document you can go on working in:
//   - every page becomes a page of the same size;
//   - its text becomes editable text frames: pieces on one baseline
//     join into lines, lines that stack like a paragraph join into one
//     frame (alignment, leading, size, family, bold / italic, colour);
//   - everything else (pictures, drawings, backgrounds) becomes one
//     locked picture per page behind the text, drawn without the text.
// The PDF is read by PDF.js (vendor/pdfjs, Mozilla, Apache-2.0), loaded
// only when a PDF is opened, with eval off; the file's own scripts,
// forms and links are never run. Text colours are measured by drawing
// each page with and without its text.
// Pure part (lines, blocks, document) is testable under Node; the
// browser part (open) needs PDF.js and a canvas.
// Exposes LY_PDFIN (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, X;
  if (typeof module !== "undefined" && module.exports) { M = require("../designkit/model.js"); T = require("../designkit/text.js"); X = require("./sla.js"); }
  else { M = root.orosDK.model; T = root.orosDK.text; X = root.LY_SLA; }

  var MAX_PAGES = 300, MAX_STYLES = 120, MAX_SWATCHES = 60;

  // ---------- 1. Pieces → lines ----------
  // piece: { s, x, y (baseline start, page pt, y down), w, size, rot
  //          (degrees), fam, b, i, eol }
  // line:  { x, y, rot, size, a0 / a1 (start / end along the text),
  //          c (across: the baseline's offset), runs: [{ t, fam, b, i }] }
  function axes(rot) { var a = rot * Math.PI / 180; return { c: Math.cos(a), s: Math.sin(a) }; }
  function along(ax, x, y) { return x * ax.c + y * ax.s; }
  function across(ax, x, y) { return -x * ax.s + y * ax.c; }
  function toLines(pieces) {
    var lines = [], cur = null;
    pieces.forEach(function (p) {
      var s = String(p.s || "").replace(/[\u0000-\u001f\u007f\u00ad\ufeff]/g, "").replace(/\s+/g, " ");
      if (!s || !(p.size > 0)) { if (p.eol) cur = null; return; }
      var rot = Math.round((p.rot || 0) * 100) / 100, ax = axes(rot);
      var a0 = along(ax, p.x, p.y), c = across(ax, p.x, p.y), a1 = a0 + Math.max(0, p.w || 0);
      var fits = cur && Math.abs(cur.rot - rot) < 1 && Math.abs(cur.size - p.size) <= cur.size * 0.1 &&
        Math.abs(cur.c - c) < cur.size * 0.3 && a0 > cur.a1 - cur.size * 0.5 && a0 < cur.a1 + cur.size * 1.5;
      if (fits) {
        var last = cur.runs[cur.runs.length - 1];
        if (a0 - cur.a1 > cur.size * 0.15 && !/ $/.test(last.t) && s[0] !== " ") s = " " + s;
        if (last.fam === p.fam && last.b === (p.b ? 1 : 0) && last.i === (p.i ? 1 : 0)) last.t += s;
        else cur.runs.push({ t: s, fam: p.fam, b: p.b ? 1 : 0, i: p.i ? 1 : 0 });
        cur.a1 = Math.max(cur.a1, a1);
      } else {
        cur = { x: p.x, y: p.y, rot: rot, size: p.size, a0: a0, a1: a1, c: c, color: p.color || null,
                runs: [{ t: s, fam: p.fam, b: p.b ? 1 : 0, i: p.i ? 1 : 0 }] };
        lines.push(cur);
      }
      if (p.eol) cur = null;
    });
    lines.forEach(function (l) {
      var r0 = l.runs[0], rl = l.runs[l.runs.length - 1];
      r0.t = r0.t.replace(/^ +/, ""); rl.t = rl.t.replace(/ +$/, "");
      l.runs = l.runs.filter(function (r) { return r.t; });
    });
    return lines.filter(function (l) { return l.runs.length; });
  }

  // ---------- 2. Lines → blocks (one text frame each) ----------
  function width(l) { return l.a1 - l.a0; }
  function toBlocks(lines) {
    var blocks = [];
    lines.forEach(function (l) {
      var best = null;
      for (var k = blocks.length - 1; k >= 0 && k >= blocks.length - 8; k--) {
        var b = blocks[k], pl = b.lines[b.lines.length - 1], dy = l.c - pl.c;
        if (Math.abs(b.rot - l.rot) >= 1 || Math.abs(b.size - l.size) > b.size * 0.12) continue;
        if (dy < b.size * 0.5 || dy > b.size * 2.2) continue;
        if (b.lines.length > 1) {
          // the same line step, or a bigger one after a paragraph's
          // short last line (space after the paragraph)
          var off = dy - b.step, paraEnd = width(pl) < (b.a1 - b.a0) * 0.85;
          if (off < -b.size * 0.35 || off > b.size * 0.35 && !(paraEnd && off < b.size * 2.5)) continue;
        }
        if (l.a0 > b.a1 || l.a1 < b.a0 - b.size || l.a0 < b.a0 - b.size * 2 && l.a1 < b.a0 + width(pl) * 0.3) continue;
        best = b; break;
      }
      if (best) {
        if (best.lines.length === 1) best.step = l.c - best.lines[0].c;
        best.lines.push(l);
        best.a0 = Math.min(best.a0, l.a0); best.a1 = Math.max(best.a1, l.a1);
      } else blocks.push({ rot: l.rot, size: l.size, a0: l.a0, a1: l.a1, lines: [l], step: 0 });
    });
    blocks.forEach(shape);
    return blocks;
  }
  // alignment, paragraphs, leading and paragraph spacing of a block
  function shape(b) {
    var ls = b.lines, W = b.a1 - b.a0, tol = b.size * 0.5, n = ls.length;
    b.lead = n > 1 ? Math.round(b.step * 100) / 100 : 0;
    // paragraph ends: a short line, a bigger gap, or an indented next line
    b.paras = [];
    var cur = [], gaps = [];
    ls.forEach(function (l, k) {
      cur.push(l);
      var next = ls[k + 1], gap = next ? next.c - l.c - b.step : 0;
      if (gap > b.size * 0.35) gaps.push(gap);
      if (!next || gap > b.size * 0.35 || width(l) < W * 0.85 || next.a0 - b.a0 > b.size * 0.8 && Math.abs(l.a0 - b.a0) < tol) { b.paras.push(cur); cur = []; }
    });
    gaps.sort(function (x, y) { return x - y; });
    b.sa = gaps.length ? Math.round(gaps[gaps.length >> 1] * 2) / 2 : 0;
    // justified: at least two full lines that also end at the right edge
    var full = ls.filter(function (l, k) { return k < n - 1 && width(l) >= W * 0.85; });
    var dl = 0, dr = 0, dc = 0, mid = (b.a0 + b.a1) / 2;
    ls.forEach(function (l) { dl = Math.max(dl, l.a0 - b.a0); dr = Math.max(dr, b.a1 - l.a1); dc = Math.max(dc, Math.abs((l.a0 + l.a1) / 2 - mid)); });
    if (n === 1) b.align = "l";
    else if (dl < tol && full.length >= 2 && full.every(function (l) { return b.a1 - l.a1 < tol; }) && dr >= tol) b.align = "j";
    else if (dl < tol) b.align = "l";
    else if (dc < tol) b.align = "c";
    else if (dr < tol) b.align = "r";
    else b.align = "l";
  }

  // ---------- 3. Document ----------
  var ALIGN_NAME = { en: { c: "centre", r: "right", j: "justify" }, el: { c: "\u03ba\u03ad\u03bd\u03c4\u03c1\u03bf", r: "\u03b4\u03b5\u03be\u03b9\u03ac", j: "\u03c0\u03bb\u03ae\u03c1\u03b7\u03c2" } };
  function most(o) { return Object.keys(o).sort(function (x, y) { return o[y] - o[x]; })[0]; }
  function famLabel(f) { return f === "serif" ? "Serif" : f === "mono" ? "Mono" : "Sans"; }
  function hex(c) { return "#" + c.map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }
  // pages: [{ w, h, blocks, bg: { a, iw, ih } | null }]; opts: { now,
  // name }. → { doc, stats: { pages, items, frames } }
  function buildDoc(pages, opts) {
    opts = opts || {};
    var now = opts.now || 1;
    if (!pages.length) return null;
    var doc = M.newDoc({ name: opts.name || "PDF", w: pages[0].w, h: pages[0].h, unit: "mm", bleed: 0, mt: 0, mb: 0, mi: 0, mo: 0, preset: "custom", pages: pages.length }, now);
    doc.pages.forEach(function (p) { p.ms = ""; });
    var used = {}, z = 0, frames = 0;
    doc.swatches.forEach(function (s) { used[s.id] = 1; });
    doc.pstyles.forEach(function (s) { used[s.id] = 1; });
    doc.cstyles.forEach(function (s) { used[s.id] = 1; });
    var sw = {}, swList = [];
    function swatch(c) {
      if (!c) return "sw-black";
      if (c[0] < 48 && c[1] < 48 && c[2] < 48) return "sw-black";
      if (c[0] > 238 && c[1] > 238 && c[2] > 238) return "sw-paper";
      var q = c.map(function (v) { return Math.round(v / 4) * 4; }), h = hex(q);
      if (sw[h]) return sw[h];
      if (swList.length >= MAX_SWATCHES) {
        var best = "sw-black", bd = Infinity;
        swList.forEach(function (s) { var d = Math.abs(s.v[0] - q[0]) + Math.abs(s.v[1] - q[1]) + Math.abs(s.v[2] - q[2]); if (d < bd) { bd = d; best = s.id; } });
        return best;
      }
      var id = X.slug(h.slice(1), "sw", used), s = { id: id, m: now, name: h, mode: "rgb", v: q.map(function (v) { return Math.min(255, v); }) };
      doc.swatches.push(s); swList.push(s); sw[h] = id;
      return id;
    }
    var psBy = {}, nPs = 0;
    function pstyle(fam, size, lead, align, color, sa) {
      size = Math.round(size * 2) / 2; lead = Math.round(lead * 2) / 2;
      var key = [fam, size, lead, align, color, sa].join("|");
      if (psBy[key]) return psBy[key];
      if (nPs >= MAX_STYLES) return "ps-base";
      nPs++;
      var id = X.slug("pdf" + nPs, "ps", used);
      var base = "PDF " + famLabel(fam) + " " + size + (lead ? "/" + lead : "") + " pt";
      var name = align === "l" ? base : { en: base + " " + ALIGN_NAME.en[align], el: base + " " + ALIGN_NAME.el[align] };
      doc.pstyles.push({ id: id, m: now, name: name, base: "ps-base", font: fam, size: size, lead: lead, align: align, color: color, b: 0, i: 0, sb: 0, sa: sa, fi: 0, li: 0, ri: 0 });
      psBy[key] = id;
      return id;
    }
    var csBy = {};
    function cstyle(fam, color) {
      var key = fam + "|" + color;
      if (csBy[key]) return csBy[key];
      var n = Object.keys(csBy).length + 1, id = X.slug("pdf" + n, "cs", used), s = { id: id, m: now, name: "PDF " + n };
      if (fam) s.font = fam;
      if (color) s.color = color;
      doc.cstyles.push(s);
      csBy[key] = id;
      return id;
    }
    var order = M.pagesInOrder(doc);
    pages.forEach(function (pg, k) {
      var pid = order[k].id;
      if (pg.bg && pg.bg.a) {
        doc.items.push({ id: M.newId("it"), m: now, t: "img", pg: pid, x: 0, y: 0, w: pg.w, h: pg.h, z: (++z) * 16,
                         a: pg.bg.a, iw: pg.bg.iw, ih: pg.bg.ih, fit: "fill", lock: 1, sw: 0, nm: "PDF " + (k + 1) });
      }
      (pg.blocks || []).forEach(function (b) {
        // the block's family and colour by character count
        var famN = {}, colN = {};
        b.lines.forEach(function (l) {
          var col = swatch(l.color);
          l.runs.forEach(function (r) { famN[r.fam] = (famN[r.fam] || 0) + r.t.length; colN[col] = (colN[col] || 0) + r.t.length; });
          l.sw = col;
        });
        var fam = most(famN), col = most(colN);
        var ps = pstyle(fam, b.size, b.lead, b.align, col, b.sa || 0);
        var paras = b.paras.map(function (pl) {
          var runs = [];
          pl.forEach(function (l, li) {
            l.runs.forEach(function (r, ri) {
              var t = r.t;
              if (li > 0 && ri === 0 && !/-$/.test(runs.length ? runs[runs.length - 1].t : "")) t = " " + t;
              var o = { t: t };
              if (r.b) o.b = 1;
              if (r.i) o.i = 1;
              if (r.fam !== fam || l.sw !== col) o.cs = cstyle(r.fam !== fam ? r.fam : "", l.sw !== col ? l.sw : "");
              var prev = runs[runs.length - 1];
              if (prev && prev.b === o.b && prev.i === o.i && prev.cs === o.cs) prev.t += o.t;
              else runs.push(o);
            });
          });
          return { ps: ps, runs: runs };
        });
        var st = { id: M.newId("st"), m: now, h: [], paras: paras };
        doc.stories.push(st);
        // frame: first baseline where it was, some room for our fonts
        var asc = T.ascent(T.fontKey(fam, 0, 0), b.size) || b.size * 0.9;
        var first = b.lines[0], last = b.lines[b.lines.length - 1];
        // (justified lines keep their width: more room would change the breaks)
        var w0 = b.a1 - b.a0, extra = b.align === "j" ? w0 * 0.02 : w0 * 0.08 + b.size * 0.5;
        var left = b.align === "r" ? b.a0 - extra : b.align === "c" ? b.a0 - extra / 2 : b.a0;
        var w = w0 + extra, topC = first.c - asc, h = (last.c - first.c) + asc + b.size * 1.5;
        var ax = axes(b.rot), cA = left + w / 2, cC = topC + h / 2;
        var cx = cA * ax.c - cC * ax.s, cy = cA * ax.s + cC * ax.c;
        doc.items.push({ id: M.newId("it"), m: now, t: "text", pg: pid, x: cx - w / 2, y: cy - h / 2, w: w, h: h, rot: b.rot,
                         z: (++z) * 16, story: st.id, seq: 1024, cols: 1, gut: 12, ins: 0, sw: 1 });
        frames++;
      });
    });
    if (doc.items.length > M.MAX_ITEMS) doc.items.length = M.MAX_ITEMS;
    var out = M.normDoc(doc);
    return { doc: out, stats: { pages: pages.length, items: out.items.length, frames: frames } };
  }

  // ---------- 4. Browser: PDF.js ----------
  var LIB = "../vendor/pdfjs/pdf.min.js", WORKER = "../vendor/pdfjs/pdf.worker.min.js";
  function loadLib() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = LIB;
      s.onload = function () { if (root.pdfjsLib) res(root.pdfjsLib); else rej(new Error("pdfjs")); };
      s.onerror = function () { rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
  }
  function fontOf(page, name) {
    var f = null;
    try { f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch (e) { f = null; }
    var nm = f ? String(f.name || "").replace(/^[A-Z]{6}\+/, "") : "";
    var st = X.fontOf(nm || (f && f.fallbackName) || "");
    // short style suffixes: "-b", "-Bd", "-It", "-BI" (Layout's own "serif-bi")
    var suf = (/[-_ ,](b|bd|bi|bdit|i|it)$/i.exec(nm) || ["", ""])[1].toLowerCase();
    return { fam: f && f.isSerifFont && !/sans/i.test(nm) ? "serif" : st.font,
             b: st.b || /^b/.test(suf) ? 1 : 0, i: st.i || /i/.test(suf) ? 1 : 0 };
  }
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function blank(d) {
    for (var i = 0; i < d.length; i += 16) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) return false;
    return true;
  }
  // average colour of the pixels the text changed inside a box
  function textColour(full, bare, W, H, box) {
    var x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(W, Math.ceil(box[2])), y1 = Math.min(H, Math.ceil(box[3]));
    var r = 0, g = 0, b = 0, n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var i = (y * W + x) * 4, d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
      if (d > 90) { r += full[i]; g += full[i + 1]; b += full[i + 2]; n++; }
    }
    return n ? [r / n, g / n, b / n] : null;
  }
  // buf: ArrayBuffer; store(blob) → Promise of { id, w, h } (the asset
  // store); progress(done, total). → Promise of { doc, stats } or null.
  function open(buf, opts, store, progress) {
    opts = opts || {};
    return loadLib().then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = WORKER;
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, MAX_PAGES), pages = [], chain = Promise.resolve();
        var TEXT_OPS = {};
        [lib.OPS.showText, lib.OPS.showSpacedText, lib.OPS.nextLineShowText, lib.OPS.nextLineSetSpacingShowText].forEach(function (o) { TEXT_OPS[o] = 1; });
        for (var k = 1; k <= n; k++) (function (k) {
          chain = chain.then(function () { return pdf.getPage(k); }).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 }), W0 = vp1.width, H0 = vp1.height;
            var sc = Math.min(150 / 72, 3500 / Math.max(W0, H0)), vp = page.getViewport({ scale: sc });
            var cw = Math.max(1, Math.round(vp.width)), ch = Math.max(1, Math.round(vp.height));
            var cA = canvas(cw, ch), cB = canvas(cw, ch), xA = cA.getContext("2d"), xB = cB.getContext("2d", { willReadFrequently: true });
            var text, ops;
            return Promise.all([page.getTextContent(), page.getOperatorList()]).then(function (r) {
              text = r[0]; ops = r[1];
              return page.render({ canvasContext: xA, viewport: vp, background: "#ffffff" }).promise;
            }).then(function () {
              return page.render({ canvasContext: xB, viewport: vp, background: "#ffffff", operationsFilter: function (i) { return !TEXT_OPS[ops.fnArray[i]]; } }).promise;
            }).then(function () {
              var full = xA.getImageData(0, 0, cw, ch).data, bare = xB.getImageData(0, 0, cw, ch).data;
              var pieces = text.items.map(function (it) {
                if (typeof it.str !== "string") return { s: "" };
                var m = lib.Util.transform(vp1.transform, it.transform);
                var size = Math.hypot(m[2], m[3]), rot = Math.atan2(m[1], m[0]) * 180 / Math.PI, f = fontOf(page, it.fontName);
                var ax = axes(rot), wv = it.width || 0;
                // the piece's box in canvas pixels, for its colour
                var x0 = m[4], y0 = m[5], x1 = x0 + wv * ax.c, y1 = y0 + wv * ax.s;
                var box = [Math.min(x0, x1) * sc, (Math.min(y0, y1) - size * 0.85) * sc, Math.max(x0, x1) * sc, (Math.max(y0, y1) + size * 0.2) * sc];
                return { s: it.str, x: m[4], y: m[5], w: wv, size: size, rot: rot, fam: f.fam, b: f.b, i: f.i, eol: it.hasEOL, color: it.str.trim() ? textColour(full, bare, cw, ch, box) : null };
              });
              var bg = blank(bare) ? null : new Promise(function (res) { cB.toBlob(res, "image/jpeg", 0.9); });
              return Promise.resolve(bg).then(function (blob) {
                if (!blob) return null;
                blob.name = "pdf-page-" + k + ".jpg";
                return store(blob).then(function (r) { return { a: r.id, iw: r.w, ih: r.h }; }, function () { return null; });
              }).then(function (bgRes) {
                pages.push({ w: W0, h: H0, blocks: toBlocks(toLines(pieces)), bg: bgRes });
                page.cleanup();
                if (progress) progress(k, n);
              });
            });
          });
        })(k);
        return chain.then(function () {
          var res = buildDoc(pages, opts);
          if (res) { res.stats.total = pdf.numPages; res.stats.cut = pdf.numPages > n; }
          pdf.destroy();
          return res;
        });
      });
    }).then(null, function () { return null; });
  }

  var api = { toLines: toLines, toBlocks: toBlocks, buildDoc: buildDoc, open: open, MAX_PAGES: MAX_PAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_PDFIN = api;
})(typeof window !== "undefined" ? window : this);
