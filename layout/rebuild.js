// ============================================================
// orOS Layout — Rebuild a print PDF (v1.0.0)
// Turns the final print PDF of a book or magazine (Affinity, InDesign,
// Scribus…), with the original pictures next to it if you have them,
// into a NEW Layout document that looks like the PDF and that you can
// go on editing:
//   - the page is the PDF's trim box, the bleed its bleed box; crop
//     marks, colour bars and everything else outside the bleed go;
//   - text: the text column of right and left pages, the body size and
//     its line pitch are measured, lines join into frames and real
//     paragraphs (alignment, first-line indent, space before, leading,
//     empty lines kept as empty paragraphs), and paragraphs with the
//     same look share one paragraph style;
//   - the PDF's fonts: the same family from the fonts on the orOS
//     disk or from Fontsource when one has its name (opts.fonts, see
//     open), with no tracking added; for the others our fonts stand in
//     and each style gets the tracking that keeps its lines as wide as
//     they were, so lines break where they did;
//   - text beside a picture wraps around it; a caption beside the text
//     is its own frame; page numbers are their own small frames;
//   - every picture is its own frame; when one of the original files
//     shows the same picture it is placed instead of the PDF's copy;
//     transparent ornaments keep their transparency;
//   - drawings and backgrounds inside the bleed are one locked picture
//     per page, behind everything;
//   - at the end the document is laid out again and every line is
//     compared with the PDF: the report says how many landed where they
//     were and on which pages they did not.
// Pure part (build) is testable under Node; the browser part (open)
// reads the PDF with PDF.js (layout/pdfin.js loads it) and its page
// boxes with pdf-lib (vendor/pdf-lib, MIT), both loaded on first use.
// Exposes LY_REBUILD (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, R, PI, LF;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js"); PI = require("./pdfin.js"); LF = require("./linefit.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; PI = root.LY_PDFIN; LF = root.LY_LINEFIT; }

  var MAX_PAGES = 400, MAX_SOURCES = 400;
  // Our fonts set justified lines a little wider than the natural
  // widths measured on the PDF's ragged lines predict: 18 thousandths
  // of an em less keeps 99 % of the lines of a 102-page book in place
  // (−12 to −20 were tried; −18 moved the fewest).
  var TRACK_ADJ = -18;
  var LETTER_HYPHEN = new RegExp("\\p{L}-$", "u"), WORD_END = new RegExp("(\\p{L}+)-$", "u");
  var WORD_START = new RegExp("^\\p{L}+", "u"), LOWER = new RegExp("^\\p{Ll}", "u"), WORDS = new RegExp("[\\p{L}\\p{N}]+", "gu");

  function r3(v) { return Math.round(v * 1000) / 1000; }
  function mode(vals) {
    var cnt = {}, best = null;
    vals.forEach(function (v) { cnt[v] = (cnt[v] || 0) + 1; if (best === null || cnt[v] > cnt[best]) best = v; });
    return best === null ? null : +best;
  }
  function minOf(a, f) { return a.reduce(function (m, x) { return Math.min(m, f(x)); }, Infinity); }
  function maxOf(a, f) { return a.reduce(function (m, x) { return Math.max(m, f(x)); }, -Infinity); }
  function keyOf(fam, b, i) { return T.fontKey(fam, b ? 1 : 0, i ? 1 : 0); }

  // ---------- 1. Spans → lines ----------
  // span: { t, x (ink start), x1 (ink end), y (baseline), size, font
  //         (the PDF's font name), fam, b, i, color: [r, g, b] | null,
  //         rot (degrees), w (advance) } in trim-box points, y down.
  // line: { y, x0, x1, size, spans, text }
  function toLines(spans) {
    var sp = spans.filter(function (s) { return Math.abs(s.rot || 0) < 0.5 && s.t; })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [];
    sp.forEach(function (s) {
      var ln = null;
      for (var k = lines.length - 1; k >= 0; k--) {
        var l = lines[k];
        // (much bigger or smaller type on the same baseline is another line: a title beside a date)
        if (Math.abs(l.y - s.y) < 0.35 * s.size && s.x >= l.x1 - 2 && s.x <= l.x1 + 4 * s.size &&
            Math.max(s.size, l.size) < 1.6 * Math.min(s.size, l.size)) { ln = l; break; }
      }
      if (!ln) { ln = { y: s.y, x0: s.x, x1: s.x, spans: [], size: s.size }; lines.push(ln); }
      if (ln.spans.length) {
        var last = ln.spans[ln.spans.length - 1];
        // a gap between two pieces of text is a word space (PDF.js gives
        // the words of some PDFs as pieces, without their spaces)
        if (s.x - ln.x1 > 0.06 * s.size && !/\s$/.test(last.t) && !/^\s/.test(s.t)) s = copy(s, { t: " " + s.t });
      }
      ln.spans.push(s); ln.x1 = Math.max(ln.x1, s.x1); ln.size = Math.max(ln.size, s.size);
    });
    lines.forEach(function (l) {
      // spaces typed as an indent: the ink start already says it
      while (l.spans.length && !l.spans[0].t.trim()) l.spans.shift();
      if (l.spans.length) l.spans[0] = copy(l.spans[0], { t: l.spans[0].t.replace(/^\s+/, "") });
      l.text = l.spans.map(function (s) { return s.t; }).join("").replace(/\s+$/, "");
      if (l.spans.length) l.x0 = l.spans[0].x;
      // letter-spaced type ("Τ Ι Τ Λ Ο Σ"): the letters, with the tracking that spreads them
      if (/^(\S ){3,}\S/.test(l.text) && /^(\S ?)+$/.test(l.text.replace(/ {2,}/g, " "))) {
        l.spans = l.spans.map(function (s) { return copy(s, { t: s.t.replace(/(\S) (?=\S)/g, "$1") }); });
        l.text = l.spans.map(function (s) { return s.t; }).join("").replace(/\s+$/, "");
        var s0 = l.spans[0], n = l.text.length;
        l.track = Math.round((l.x1 - l.x0 - T.measure(keyOf(s0.fam, s0.b, s0.i), l.text, l.size, 0)) / (n * l.size) * 1000);
      }
    });
    return lines.filter(function (l) { return l.text.trim(); });
  }
  function copy(o, extra) {
    var c = {};
    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }

  // ---------- 2. The book's measures ----------
  // body size (most text), its line pitch, the text column of right
  // and left pages, whether pages face, the page numbers.
  function isNumber(l, H) { return /^\d{1,4}$/.test(l.text.trim()) && (l.y > H * 0.86 || l.y < H * 0.14); }
  function measure(pagesLines, W, H) {
    var bySize = {};
    pagesLines.forEach(function (ls) { ls.forEach(function (l) { var s = Math.round(l.size * 10) / 10; bySize[s] = (bySize[s] || 0) + l.text.length; }); });
    var body = +Object.keys(bySize).sort(function (a, b) { return bySize[b] - bySize[a]; })[0] || 10;
    var isBody = function (l) { return Math.abs(l.size - body) < 0.05; };
    // pitch: the commonest step between body lines that follow each other
    var steps = [];
    pagesLines.forEach(function (ls) {
      var bl = ls.filter(isBody);
      for (var k = 1; k < bl.length; k++) {
        var d = bl[k].y - bl[k - 1].y;
        if (d > body * 0.9 && d < body * 3 && Math.min(bl[k].x1, bl[k - 1].x1) > Math.max(bl[k].x0, bl[k - 1].x0)) steps.push(Math.round(d * 10) / 10);
      }
    });
    var pitch = mode(steps) || Math.round(body * 1.2 * 10) / 10;
    function area(idx) {
      var l0 = [], r0 = [];
      idx.forEach(function (i) {
        pagesLines[i].forEach(function (l) {
          if (!isBody(l) || isNumber(l, H)) return;
          l0.push(Math.round(l.x0 * 10) / 10); r0.push(Math.round(l.x1 * 10) / 10);
        });
      });
      return l0.length ? { l: mode(l0), r: mode(r0), n: l0.length } : null;
    }
    var all = pagesLines.map(function (x, i) { return i; });
    var even = all.filter(function (i) { return i % 2 === 0; }), odd = all.filter(function (i) { return i % 2 === 1; });
    var aR = area(even), aL = area(odd), one = area(all) || { l: W * 0.1, r: W * 0.9, n: 0 };
    var facing = !!(aR && aL && aR.n >= 5 && aL.n >= 5 && (Math.abs(aR.l - aL.l) > 2 || Math.abs(aR.r - aL.r) > 2));
    // page numbers: digits alone near the head or the foot
    var offs = [];
    pagesLines.forEach(function (ls, i) { ls.forEach(function (l) { if (isNumber(l, H) && l.size <= body + 0.05) offs.push(+l.text.trim() - (i + 1)); }); });
    return { body: body, pitch: pitch, facing: facing, R: facing ? aR : one, L: facing ? aL : one, numberOffset: offs.length >= Math.min(3, pagesLines.length) ? mode(offs) : null };
  }

  function lineClass(l, A) {
    var full = Math.abs(l.x1 - A.r) < 1.6, atL = Math.abs(l.x0 - A.l) < 1.2;
    var mid = (l.x0 + l.x1) / 2, cmid = (A.l + A.r) / 2;
    if (full && l.x0 - A.l > 40) return "r";
    if (full && (atL || l.x0 > A.l)) return l.x0 - A.l > 1.2 ? "fulli" : "full";
    if (!atL && Math.abs(mid - cmid) < 2.5) return "c";
    if (Math.abs(l.x1 - A.r) < 1.6 && !atL) return "r";
    return "l";
  }

  // ---------- 3. Tracking that keeps the PDF's widths ----------
  // Measured on lines that were not stretched by justification.
  function tracks(pagesLines, meas, sideOf, fonts) {
    var acc = {};
    pagesLines.forEach(function (ls, i) {
      var A = sideOf(i) === "L" ? meas.L : meas.R;
      ls.forEach(function (l) {
        if (/full/.test(lineClass(l, A)) || l.track !== undefined) return;
        l.spans.forEach(function (s) {
          var t = s.t.trim();
          if (!t || !(s.x1 > s.x)) return;
          var k = s.font || keyOf(s.fam, s.b, s.i), a = acc[k] || (acc[k] = { pdf: 0, ours: 0, em: 0, fam: s.fam, b: s.b, i: s.i });
          a.pdf += s.x1 - s.x; a.ours += T.measure(keyOf(s.fam, s.b, s.i), t, s.size, 0); a.em += t.length * s.size;
        });
      });
    });
    var out = {};
    Object.keys(acc).forEach(function (k) {
      var a = acc[k], tr = a.em ? Math.round((a.pdf - a.ours) / a.em * 1000) : 0;
      // the same font as ours: nothing to make up for
      out[k] = /^noto/i.test(k) || fonts[k] ? 0 : tr + TRACK_ADJ;
    });
    return out;
  }

  // ---------- 4. The document ----------
  // src: { w, h, bleed, pages: [{ spans, imgs: [{ x, y, w, h, rot, vis:
  //   [x, y, w, h] | null (the ink of a transparent picture), a, iw, ih,
  //   nm, original }], bg: { a, iw, ih } | null }] }
  // opts: { now, name, lang: "el" | "en", words: { word: 1 } (spelt as
  //   in the originals: a hyphen at a line end is dropped when the word
  //   without it is one of them or appears elsewhere in the PDF),
  //   fonts: { PDF font name: { id, name, fb } } (families already
  //   registered and loaded in designkit/text.js) }
  // → { doc, report }
  var NAMES = {
    en: { body: "Body text", pn: "Page number", fit: "Line fit", al: { j: "justified", l: "left", c: "centre", r: "right" }, b: "bold", i: "italic", fi: "indent", sb: "above" },
    el: { body: "Σώμα κειμένου", pn: "Αριθμός σελίδας", fit: "Ταίριασμα γραμμής",
          al: { j: "πλήρης", l: "αριστερά", c: "κέντρο", r: "δεξιά" },
          b: "έντονα", i: "πλάγια", fi: "εσοχή", sb: "πάνω" }
  };
  function hex(c) { return "#" + c.map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }

  function build(src, opts) {
    opts = opts || {};
    var now = opts.now || 1, W = src.w, H = src.h, N = NAMES[opts.lang === "el" ? "el" : "en"];
    var pagesIn = src.pages.slice(0, MAX_PAGES);
    if (!pagesIn.length) return null;
    var FONTS = opts.fonts || {}, famUsed = {};
    pagesIn.forEach(function (p) {
      (p.spans || []).forEach(function (s) {
        var e = s.font && FONTS[s.font];
        if (e) { s.fam = e.id; famUsed[e.id] = e; }
      });
    });
    // a style's font: a matched family by its id, ours as the stand-in
    var fbOf = {};
    Object.keys(famUsed).forEach(function (id) { fbOf[id] = famUsed[id].fb; });
    function fontOf(st, fam) {
      if (fbOf[fam]) { st.font = fbOf[fam]; st.ext = { fam: fam }; } else st.font = fam;
      return st;
    }
    var pagesLines = pagesIn.map(function (p) { return toLines(p.spans || []); });
    var meas = measure(pagesLines, W, H);
    var sideOf = function (i) { return meas.facing ? (i % 2 === 0 ? "R" : "L") : "R"; };
    var TRACK = tracks(pagesLines, meas, sideOf, FONTS);
    var trackOf = function (s) { var k = s.font || keyOf(s.fam, s.b, s.i); return TRACK[k] !== undefined ? TRACK[k] : 0; };

    // words for joining hyphenated line ends: the originals, else the PDF itself
    var words = {};
    Object.keys(opts.words || {}).forEach(function (w) { words[w.toLowerCase()] = 1; });
    pagesLines.forEach(function (ls) { ls.forEach(function (l) { (l.text.match(WORDS) || []).forEach(function (w) { words[w.toLowerCase()] = 1; }); }); });

    var A0 = meas.R, top0 = [], bot0 = [];
    var doc = M.newDoc({ name: opts.name || "PDF", w: W, h: H, unit: "mm", bleed: src.bleed || 0, facing: meas.facing ? 1 : 0, pages: pagesIn.length,
      mt: 0, mb: 0, mi: A0.l, mo: Math.max(0, W - A0.r), cols: 1, gut: 12, preset: "custom" }, now);
    var pages = M.pagesInOrder(doc);
    doc.pages.forEach(function (p) { p.ms = ""; });
    var stories = [], items = [], allParas = [], z = 0;
    var report = { pages: pagesIn.length, facing: meas.facing, body: meas.body, pitch: meas.pitch, numberStart: meas.numberOffset === null ? null : meas.numberOffset + 1,
                   pictures: 0, originals: 0, fonts: [], check: null, framesOff: [] };
    var frameLines = [];

    // colours → swatches
    var sw = {}, used = {};
    doc.swatches.forEach(function (s) { used[s.id] = 1; });
    function swatch(c) {
      if (!c) return "sw-black";
      // black text, greyed by the edges of its letters
      if (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 24 && c[0] + c[1] + c[2] < 330) return "sw-black";
      if (Math.min(c[0], c[1], c[2]) > 200 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 40) return "sw-paper";
      var q = c.map(function (v) { return Math.min(255, Math.round(v / 4) * 4); }), h = hex(q);
      if (sw[h]) return sw[h];
      var id = "sw-r" + h.slice(1);
      doc.swatches.push({ id: id, m: now, name: h, mode: "rgb", v: q });
      sw[h] = id;
      return id;
    }

    // br: where the 2nd, 3rd… lines start (character offsets), for
    // the line fitting (layout/linefit.js)
    function para(lines, A, align, sb) {
      var first = lines[0], runs = [], br = [], len = 0;
      lines.forEach(function (l, li) {
        l.spans.forEach(function (s, si) {
          var t = s.t;
          if (si === l.spans.length - 1) t = t.replace(/\s+$/, "");
          if (li > 0 && si === 0) {
            var prev = runs[runs.length - 1];
            var m = prev && WORD_END.exec(prev.t), w2 = WORD_START.exec(t);
            // a word hyphenated at the line end: one word with a soft
            // hyphen, so it breaks there again
            if (m && w2 && LOWER.test(w2[0]) && words[(m[1] + w2[0]).toLowerCase()]) prev.t = prev.t.slice(0, -1) + "\u00AD";
            // a compound split at its own hyphen: it may break after it
            else if (prev && LETTER_HYPHEN.test(prev.t)) t = "\u200B" + t;
            else if (!(prev && /-$/.test(prev.t))) t = " " + t;
            br.push(len + (/^[ \u200B]/.test(t) ? 1 : 0));
          }
          runs.push({ t: t, b: s.b ? 1 : 0, i: s.i ? 1 : 0, size: s.size, sw: swatch(s.color), font: s.font, fam: s.fam });
          len += t.length;
        });
      });
      var s0 = first.spans[0];
      var allB = runs.every(function (r) { return r.b; }), allI = runs.every(function (r) { return r.i; });
      var size = first.size, col = runs[0].sw;
      return {
        size: size, fam: s0.fam, font: s0.font, track: first.track !== undefined ? first.track : trackOf(s0), color: col, lead: 0, align: align, sb: r3(Math.max(0, sb)),
        fi: align === "j" || align === "l" ? r3(Math.max(0, first.x0 - A.l)) : 0,
        b: allB ? 1 : 0, i: allI ? 1 : 0, br: br,
        runs: runs.map(function (r) {
          var o = { t: r.t };
          if (r.b && !allB) o.b = 1;
          if (r.i && !allI) o.i = 1;
          if (r.size !== size) o.size = r.size;
          if (r.sw !== col) o.sw = r.sw;
          return o;
        })
      };
    }

    pagesIn.forEach(function (P, pi) {
      var page = pages[pi], A = sideOf(pi) === "L" ? meas.L : meas.R;
      var lines = pagesLines[pi].slice();
      // a cover, a poster: no running text on the page, every line is display type
      var fewBody = lines.filter(function (l) { return Math.abs(l.size - meas.body) < 0.05; }).length < 6;
      // page numbers: their own small frames
      var pn = lines.filter(function (l) { return isNumber(l, H) && l.size <= meas.body + 0.05; });
      lines = lines.filter(function (l) { return pn.indexOf(l) < 0; });
      pn.forEach(function (l) {
        var sid = M.newId("st"), s0 = l.spans[0];
        stories.push({ id: sid, m: now, paras: [{ ps: { pn: 1, size: l.size, fam: s0.fam, b: s0.b ? 1 : 0, i: s0.i ? 1 : 0, track: trackOf(s0), color: swatch(s0.color) }, runs: [{ t: l.text.trim() }] }] });
        var cx = (l.x0 + l.x1) / 2, asc = T.ascent(keyOf(s0.fam, s0.b, s0.i), l.size);
        items.push({ id: M.newId("it"), m: now, t: "text", pg: page.id, x: r3(cx - 30), y: r3(l.y - asc), w: 60, h: r3(l.size * 2), story: sid, seq: 1, z: 9000 });
      });
      // pictures (+ wrap when lines run beside them)
      var imgs = (P.imgs || []).map(function (im) { return copy(im, { wrapGap: null }); });
      function vbox(im) { return im.vis ? { x: im.vis[0], y: im.vis[1], w: im.vis[2], h: im.vis[3] } : im; }
      imgs.forEach(function (im) {
        var v = vbox(im);
        var beside = lines.filter(function (l) { return l.y - l.size * 0.8 < v.y + v.h && l.y > v.y && (l.x0 >= im.x + im.w || l.x1 <= im.x); });
        if (beside.length) im.wrapGap = minOf(beside, function (l) { return l.x0 >= im.x + im.w ? l.x0 - (im.x + im.w) : im.x - l.x1; });
      });
      // frames: a line joins the open frame right above it that it
      // overlaps across (so a caption beside the text gets its own
      // frame); a picture without wrap between two lines starts a new one
      var blocks = [];
      var ov = function (a, b) { return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.25 * Math.min(a.x1 - a.x0, b.x1 - b.x0); };
      lines.sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; }).forEach(function (l) {
        var best = null;
        blocks.forEach(function (bl) {
          var prev = bl[bl.length - 1];
          if (!ov(prev, l) || l.y - prev.y > meas.pitch * 6.5) return;
          // display type (not the body): one frame only for lines of one size that line up
          if (Math.abs(l.size - meas.body) >= 0.05 && (Math.abs(l.size - prev.size) > 0.05 ||
              Math.min(Math.abs(l.x0 - prev.x0), Math.abs(l.x1 - prev.x1), Math.abs(l.x0 + l.x1 - prev.x0 - prev.x1) / 2) > 2)) return;
          var cut = imgs.some(function (im) {
            var v = vbox(im);
            return im.wrapGap === null && v.y > prev.y - 2 && v.y + v.h < l.y + 2 && im.x < l.x1 && im.x + im.w > l.x0;
          });
          if (cut) return;
          var bp = best && best[best.length - 1];
          if (!best || prev.y > bp.y || (prev.y === bp.y && prev.x1 - prev.x0 > bp.x1 - bp.x0)) best = bl;
        });
        if (best) best.push(l); else blocks.push([l]);
      });
      // a frame whose lines sit beside another frame's lines: text wraps around it
      blocks.forEach(function (bl) {
        var x1 = maxOf(bl, function (l) { return l.x1; }), gap = null;
        blocks.forEach(function (o) {
          // (a column of text beside it: two lines beside a title do not make it wrap)
          if (o === bl || o.length < 3) return;
          o.forEach(function (l) {
            if (l.y < bl[0].y - l.size || l.y > bl[bl.length - 1].y + l.size) return;
            if (l.x0 >= x1) gap = gap === null ? l.x0 - x1 : Math.min(gap, l.x0 - x1);
          });
        });
        if (gap !== null && bl.length < 12) bl.wrapGap = gap;
      });
      function wrapImgAt(l) { return imgs.filter(function (im) { return im.wrapGap !== null && l.y > im.y && l.y - l.size < im.y + im.h; })[0]; }
      blocks.forEach(function (bl) {
        // frame area: the text column, widened when a line goes past it;
        // a caption under a picture: the picture's width
        var capOf = bl.wrapGap !== undefined && imgs.filter(function (im) { return im.x < bl[0].x1 && im.x + im.w > bl[0].x0 && bl[0].y - (im.y + im.h) < 30 && bl[0].y > im.y + im.h; })[0];
        var bx0 = minOf(bl, function (l) { return l.x0; }), bx1 = maxOf(bl, function (l) { return l.x1; });
        var FA = capOf ? { l: capOf.x, r: capOf.x + capOf.w } : bl.wrapGap !== undefined ? { l: bx0, r: bx1 } : { l: Math.min(A.l, bx0), r: Math.max(A.r, bx1) };
        // lines beside a wrapped picture keep the column but start after it
        var effA = function (l) {
          var im = imgs.filter(function (m) { return m.wrapGap !== null && l.y > m.y && l.y - l.size < m.y + m.h && l.x0 >= m.x + m.w - 1; })[0];
          return im ? { l: im.x + im.w + im.wrapGap, r: FA.r } : FA;
        };
        var display = bl.length <= 3 && (fewBody || bl.every(function (l) { return Math.abs(l.size - meas.body) >= 0.05; }));
        var groups = [], g = null;
        bl.forEach(function (l, k) {
          var prev = bl[k - 1], cls = lineClass(l, effA(l)), gap = prev ? l.y - prev.y : 0;
          var pcls = prev ? lineClass(prev, effA(prev)) : null;
          var wi = wrapImgAt(l), startsAfterImg = wi && l.x0 >= wi.x + wi.w - 1;
          var newPara = !g || Math.abs(l.size - prev.size) > 0.05 || l.spans[0].fam !== prev.spans[0].fam ||
            gap > Math.max(g.pitch || 0, prev.size * 1.25) * 1.18 + 0.5;
          if (!newPara) {
            var hyph = LETTER_HYPHEN.test(prev.text) && LOWER.test(l.text);
            var prevEnded = !hyph && !(pcls === "full" || pcls === "fulli") && !(wrapImgAt(prev) && Math.abs(prev.x1 - FA.r) < 1.6);
            if (prevEnded) newPara = true;
            if ((cls === "fulli" || (cls === "l" && l.x0 - FA.l > 1.2)) && !startsAfterImg) newPara = true;
            if (cls === "c" || cls === "r") newPara = true;
          }
          if (newPara) { g = { lines: [l], gapBefore: prev ? gap : 0, cls: cls, pitch: 0 }; groups.push(g); }
          else {
            g.lines.push(l);
            g.pitch = (l.y - g.lines[0].y) / (g.lines.length - 1);
            if (cls === "full" || cls === "fulli") g.cls = "j";
          }
        });
        var paras = groups.map(function (gp, k) {
          var align = gp.cls === "j" || gp.lines.some(function (l, j) { return j < gp.lines.length - 1 && /full/.test(lineClass(l, FA)); }) ? "j"
            : gp.cls === "c" ? "c" : gp.cls === "r" ? "r" : /full/.test(gp.cls) ? "j" : "l";
          // a few lines of display type that happen to end together: set ragged, in a wider frame
          if (display && align === "j") align = "l";
          // leading: its own pitch, else the next gap when it is a plain line step, else the book's pitch
          var lead = gp.pitch, sz = gp.lines[0].size;
          if (!lead) {
            var nx = groups[k + 1];
            lead = nx && nx.gapBefore <= sz * (gp.cls === "c" ? 2.2 : 2.05) ? nx.gapBefore : (Math.abs(sz - meas.body) < 0.05 ? meas.pitch : sz * meas.pitch / meas.body);
          }
          gp.lead = lead;
          var p = para(gp.lines, effA(gp.lines[0]), align, k ? gp.gapBefore - lead : 0);
          p.lead = r3(lead);
          p.one = gp.lines.length === 1;
          return p;
        });
        // a one-line paragraph between justified ones is justified too (same look, fewer styles)
        paras.forEach(function (p, k) {
          if (p.one && p.align === "l" && ((paras[k - 1] && paras[k - 1].align === "j") || (paras[k + 1] && paras[k + 1].align === "j"))) p.align = "j";
        });
        // gaps of whole lines were typed as empty paragraphs: keep them that way
        var outParas = [];
        paras.forEach(function (p) {
          if (p.lead > 0 && p.sb >= p.lead - 1.5) {
            var n = Math.floor((p.sb + 1.5) / p.lead);
            for (var e = 0; e < n; e++) outParas.push(copy(p, { sb: 0, runs: [], br: [] }));
            p.sb = r3(Math.max(0, p.sb - n * p.lead));
          }
          outParas.push(p);
        });
        outParas.forEach(function (p) { allParas.push(p); });
        // frame box: first baseline − our ascent; to the last baseline + descent
        var f0 = outParas[0], k0 = keyOf(f0.fam, f0.b, f0.i);
        var top = bl[0].y - T.ascent(k0, f0.size), last = bl[bl.length - 1];
        var bottom = last.y + T.descent(k0, last.size) + 2;
        var sid = M.newId("st");
        stories.push({ id: sid, m: now, paras: outParas.map(function (p) { return { ps: p, runs: p.runs }; }) });
        var fr = { id: M.newId("it"), m: now, t: "text", pg: page.id, x: r3(FA.l), y: r3(top), w: r3(FA.r - FA.l + 0.5), h: r3(bottom - top + meas.pitch * 3), story: sid, seq: 1, z: 3000 + (++z) };
        if (display && bl.wrapGap === undefined) {
          // our font may run wider: room on the side the text does not start from
          var more = (FA.r - FA.l) * 0.35, al = outParas[0].align;
          fr.w = r3(fr.w + more);
          if (al === "r") fr.x = r3(fr.x - more); else if (al === "c") fr.x = r3(fr.x - more / 2);
        }
        if (bl.wrapGap !== undefined) {
          fr.wrap = "box"; fr.h = r3(bottom - top); fr.w = r3(FA.r - FA.l + 1);
          fr.wo = r3(capOf ? bl.wrapGap - (FA.r - bx1) : bl.wrapGap);
        }
        if (Math.abs(bl[0].size - meas.body) < 0.05 && bl.wrapGap === undefined) { top0.push(Math.round(top)); bot0.push(Math.round(H - bottom)); }
        items.push(fr);
        frameLines.push({ page: pi + 1, id: fr.id, base: bl.map(function (l) { return r3(l.y); }) });
      });
      // rotated text (a spine, a side note): a frame per block, turned
      var turned = (P.spans || []).filter(function (s) { return Math.abs(s.rot || 0) >= 0.5 && s.t; }).map(function (s) {
        return { s: s.t, x: s.x, y: s.y, w: s.w || 0, size: s.size, rot: s.rot, fam: s.fam, b: s.b, i: s.i, color: s.color, font: s.font };
      });
      PI.toBlocks(PI.toLines(turned)).forEach(function (b) {
        var l0 = b.lines[0], s0 = turned.filter(function (s) { return Math.abs(s.size - b.size) < 0.1; })[0] || turned[0];
        var paras = b.paras.map(function (pl) {
          return { ps: { size: b.size, fam: l0.runs[0].fam, b: l0.runs[0].b, i: l0.runs[0].i, track: trackOf(s0), color: swatch(l0.color), lead: b.lead || b.size * 1.2, align: b.align, sb: 0, fi: 0 },
                   runs: [{ t: pl.map(function (l) { return l.runs.map(function (r) { return r.t; }).join(""); }).join(" ") }] };
        });
        paras.forEach(function (p) { allParas.push(p.ps); });
        var sid = M.newId("st");
        stories.push({ id: sid, m: now, paras: paras });
        var asc = T.ascent(keyOf(l0.runs[0].fam, 0, 0), b.size);
        var w = b.a1 - b.a0 + b.size, h = (b.lines[b.lines.length - 1].c - l0.c) + asc + b.size * 0.6;
        var ax = { c: Math.cos(b.rot * Math.PI / 180), s: Math.sin(b.rot * Math.PI / 180) };
        var cA = b.a0 + w / 2 - b.size / 2, cC = l0.c - asc + h / 2;
        var cx = cA * ax.c - cC * ax.s, cy = cA * ax.s + cC * ax.c;
        items.push({ id: M.newId("it"), m: now, t: "text", pg: page.id, x: r3(cx - w / 2), y: r3(cy - h / 2), w: r3(w), h: r3(h), rot: r3(b.rot), story: sid, seq: 1, z: 3000 + (++z) });
      });
      // pictures, and the page's drawings behind everything
      if (P.bg && P.bg.a) {
        var bl0 = src.bleed || 0;
        items.push({ id: M.newId("it"), m: now, t: "img", pg: page.id, x: -bl0, y: -bl0, w: W + 2 * bl0, h: H + 2 * bl0, a: P.bg.a, iw: P.bg.iw, ih: P.bg.ih, fit: "fill", lock: 1, sw: 0, z: 1, nm: "PDF " + (pi + 1) });
      }
      imgs.forEach(function (im, k) {
        var it = { id: M.newId("it"), m: now, t: "img", pg: page.id, x: r3(im.x), y: r3(im.y), w: r3(im.w), h: r3(im.h), a: im.a, nm: im.nm || "", iw: im.iw, ih: im.ih, fit: "fill", sw: 0, z: 1000 + k };
        if (im.rot) it.rot = r3(im.rot);
        if (im.wrapGap !== null) { it.wrap = "box"; it.wo = r3(im.wrapGap); }
        items.push(it);
        report.pictures++;
        if (im.original) report.originals++;
      });
    });

    // ---------- 5. Paragraph styles ----------
    // snap a measured value to the commonest value near it (typed spaces, rounding)
    function snapper(vals, tol) {
      var cnt = {};
      vals.forEach(function (v) { var k = Math.round(v * 10) / 10; cnt[k] = (cnt[k] || 0) + 1; });
      var keys = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).map(Number);
      return function (v) { for (var j = 0; j < keys.length; j++) if (Math.abs(keys[j] - v) <= tol) return keys[j]; return Math.round(v * 10) / 10; };
    }
    var textParas = allParas.filter(function (p) { return !p.pn; });
    var sFi = snapper(textParas.filter(function (p) { return p.fi > 0; }).map(function (p) { return p.fi; }), 2.5);
    var sSb = snapper(textParas.filter(function (p) { return p.sb > 0; }).map(function (p) { return p.sb; }), 1.2);
    var sLd = snapper(textParas.map(function (p) { return p.lead; }), 0.4);
    var styles = {}, list = [];
    textParas.forEach(function (p) {
      p.fi = p.fi > 0.8 ? sFi(p.fi) : 0; p.sb = p.sb > 0.8 ? sSb(p.sb) : 0; p.lead = sLd(p.lead);
      var key = [p.fam, p.font, p.size, p.lead, p.align, p.fi, p.sb, p.b, p.i, p.color, p.track].join("|");
      if (!styles[key]) { styles[key] = { fam: p.fam, size: p.size, lead: p.lead, align: p.align, fi: p.fi, sb: p.sb, b: p.b, i: p.i, track: p.track, color: p.color, n: 0 }; list.push(styles[key]); }
      styles[key].n++;
      p.st = styles[key];
    });
    list.sort(function (a, b) { return b.n - a.n; });
    var base = doc.pstyles.filter(function (s) { return s.id === "ps-base"; })[0];
    doc.pstyles = [base];
    if (list.length) { fontOf(base, list[0].fam); base.size = list[0].size; base.lead = list[0].lead; base.track = list[0].track; }
    // the PDF's program kerned; a found font kerns the same (our Noto has no pairs)
    base.ext = base.ext || {};
    base.ext.kern = 1;
    var taken = {};
    list.forEach(function (s, k) {
      var nm = k === 0 ? N.body : s.size + "/" + Math.round(s.lead * 10) / 10 + " " + N.al[s.align] + (s.b ? " " + N.b : "") + (s.i ? " " + N.i : "") +
        (s.fi ? " " + N.fi + " " + Math.round(s.fi) : "") + (s.sb ? " +" + Math.round(s.sb) + " " + N.sb : "");
      while (taken[nm]) nm += "′";
      taken[nm] = 1;
      s.id = "ps-rb" + (k + 1).toString(36);
      doc.pstyles.push(fontOf({ id: s.id, m: now, name: nm, base: "ps-base", size: s.size, lead: s.lead, align: s.align,
        fi: s.fi, sb: s.sb, sa: 0, b: s.b, i: s.i, track: s.track, color: s.color }, s.fam));
    });
    var pnStyle = null;
    doc.cstyles = [];
    var csBy = {};
    function cstyle(size, swId) {
      var key = (size || "") + "|" + (swId || "");
      if (csBy[key]) return csBy[key];
      var id = "cs-rb" + (doc.cstyles.length + 1).toString(36), cs = { id: id, m: now, name: [size ? size + " pt" : "", swId ? (M.find(doc.swatches, swId) || {}).name || swId : ""].filter(Boolean).join(" ") };
      if (size) cs.size = size;
      if (swId) cs.color = swId;
      doc.cstyles.push(cs);
      csBy[key] = id;
      return id;
    }
    var fitTargets = [];
    stories.forEach(function (st) {
      st.paras = st.paras.map(function (p, pi) {
        var ps = p.ps, id;
        if (ps.br && ps.br.length) fitTargets.push({ sid: st.id, p: pi, br: ps.br });
        if (ps.pn) {
          if (!pnStyle) {
            pnStyle = fontOf({ id: "ps-rbpn", m: now, name: N.pn, base: "ps-base", size: ps.size, lead: r3(ps.size * 1.2), align: "c", b: ps.b, i: ps.i, track: ps.track, color: ps.color, fi: 0, sb: 0, sa: 0 }, ps.fam);
            doc.pstyles.push(pnStyle);
          }
          id = pnStyle.id;
        } else if (ps.st) id = ps.st.id;
        else {
          // rotated text: a style of its own
          id = "ps-rbt" + doc.pstyles.length.toString(36);
          doc.pstyles.push(fontOf({ id: id, m: now, name: ps.size + "/" + r3(ps.lead) + " ↻", base: "ps-base", size: r3(ps.size), lead: r3(ps.lead), align: ps.align, b: ps.b, i: ps.i, track: ps.track, color: ps.color, fi: 0, sb: 0, sa: 0 }, ps.fam));
        }
        return { ps: id, runs: p.runs.map(function (r) {
          var o = { t: r.t };
          if (r.b) o.b = 1;
          if (r.i) o.i = 1;
          if (r.size || r.sw) o.cs = cstyle(r.size, r.sw);
          return o;
        }) };
      });
    });
    // margins: where the body frames start and end, most often
    doc.setup.mt = Math.max(0, mode(top0) || 0);
    doc.setup.mb = Math.max(0, mode(bot0) || 0);
    doc.stories = stories;
    doc.items = items.slice(0, M.MAX_ITEMS);
    var used = Object.keys(famUsed).map(function (id) { return famUsed[id]; });
    if (used.length) { doc.setup.ext = doc.setup.ext || {}; doc.setup.ext.fonts = used; }
    var nd = M.normDoc(doc);
    // lines that break elsewhere get a tracking of their own
    report.fit = LF.fit(nd, fitTargets, { name: N.fit, lang: opts.lang === "el" ? "el" : "en", now: now });

    // ---------- 6. Check: does every line land where it was? ----------
    var L = R.computeLayout(nd), total = 0, moved = 0, extra = 0;
    var byId = {};
    nd.items.forEach(function (it) { byId[it.id] = it; });
    frameLines.forEach(function (f) {
      var fr = L.frames[f.id], it = byId[f.id];
      var got = fr && it ? fr.lines.filter(function (ln) { return ln.runs.some(function (r) { return r.t && r.t.trim(); }); }).map(function (ln) { return r3(it.y + ln.y); }) : [];
      total += f.base.length;
      var d = got.length - f.base.length, mv = 0;
      if (d > 0) extra += d;
      f.base.forEach(function (y, k) { if (got[k] === undefined || Math.abs(got[k] - y) > 1.6) mv++; });
      moved += mv;
      if (d || mv) report.framesOff.push({ page: f.page, id: f.id, want: f.base.length, got: got.length, moved: mv });
    });
    report.check = { lines: total, inPlace: total - moved, moved: moved, extra: extra, overset: Object.keys(L.overset || {}).length };
    report.styles = list.length;
    report.fonts = Object.keys(TRACK).map(function (k) { var o = { font: k, track: TRACK[k] }; if (FONTS[k]) o.as = FONTS[k].name; return o; });
    return { doc: nd, report: report };
  }

  // ---------- 7. Browser: PDF.js + pdf-lib, the .af reader ----------
  var PDFLIB = "../vendor/pdf-lib/pdf-lib.min.js", MAX_AF = 1024 * 1024 * 1024;
  function script(src, name) {
    if (root[name]) return Promise.resolve(root[name]);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { if (root[name]) res(root[name]); else rej(new Error(name)); };
      s.onerror = function () { rej(new Error(name)); };
      document.head.appendChild(s);
    });
  }
  // layout/afread.js and vendor/fzstd (MIT), loaded on first use
  function loadAf() {
    return script("../vendor/fzstd/fzstd.umd.js", "fzstd").then(function () { return script("afread.js", "LY_AF"); });
  }
  function loadPdfLib() { return script(PDFLIB, "PDFLib"); }
  // per page { media, trim, bleed } in PDF user space ([x, y, w, h]);
  // null when pdf-lib cannot read the file (the page is then the PDF's own)
  function pageBoxes(bytes) {
    return loadPdfLib().then(function (L) {
      return L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    }).then(function (d) {
      return d.getPages().map(function (p) {
        var b = function (r) { return [r.x, r.y, r.width, r.height]; };
        return { media: b(p.getMediaBox()), trim: b(p.getTrimBox()), bleed: b(p.getBleedBox()), rot: p.getRotation().angle || 0 };
      });
    }).then(null, function () { return null; });
  }
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function toBlob(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type, q); }); }
  function decode(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("decode")); };
      img.src = url;
    });
  }
  // a 24 × 24 grey thumbnail, for "is this the same picture?"
  function thumb(src, w, h) {
    // in two steps, smoothed: one step from a big picture samples too few pixels
    var mid = canvas(Math.min(w, 192), Math.min(h, 192)), xm = mid.getContext("2d");
    xm.imageSmoothingQuality = "high";
    xm.fillStyle = "#fff"; xm.fillRect(0, 0, mid.width, mid.height);
    xm.drawImage(src, 0, 0, w, h, 0, 0, mid.width, mid.height);
    var c = canvas(24, 24), x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(mid, 0, 0, 24, 24);
    var d = x.getImageData(0, 0, 24, 24).data, out = new Float32Array(576);
    for (var k = 0; k < 576; k++) out[k] = d[k * 4] * 0.299 + d[k * 4 + 1] * 0.587 + d[k * 4 + 2] * 0.114;
    return out;
  }
  function match(cands, cv) {
    var ar = cv.width / cv.height, th = thumb(cv, cv.width, cv.height), best = null;
    cands.forEach(function (c) {
      if (Math.abs(c.ar - ar) > 0.02) return;
      var d = 0;
      for (var k = 0; k < 576; k++) d += Math.abs(th[k] - c.th[k]);
      d /= 576;
      // the very file the PDF was made from has its pixel size too
      if (c.w === cv.width && c.h === cv.height) d /= 2;
      if (!best || d < best.d) best = { c: c, d: d };
    });
    return best && best.d < 18 ? best.c : null;
  }
  // turned a quarter: the picture upright, its box the one it shows
  function upright(cv, rot) {
    var q = Math.round(rot / 90);
    if (Math.abs(rot - q * 90) > 0.5 || !(q % 4)) return null;
    var turn = ((q % 4) + 4) % 4, c = turn % 2 ? canvas(cv.height, cv.width) : canvas(cv.width, cv.height), x = c.getContext("2d");
    x.translate(c.width / 2, c.height / 2); x.rotate(turn * Math.PI / 2); x.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return c;
  }
  // the box of the pixels a transparent picture really paints
  function inkBox(cv) {
    var x = cv.getContext("2d", { willReadFrequently: true }), d = x.getImageData(0, 0, cv.width, cv.height).data;
    var x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1, alpha = false;
    for (var yy = 0; yy < cv.height; yy++) for (var xx = 0; xx < cv.width; xx++) {
      var a = d[(yy * cv.width + xx) * 4 + 3];
      if (a < 255) alpha = true;
      if (a > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    }
    return alpha && x1 >= 0 ? [x0, y0, x1 + 1, y1 + 1] : null;
  }

  // the page drawn at scale k (filter: which operators) → { ctx, data, w, h }
  function draw(page, k, filter) {
    var vp = page.getViewport({ scale: k }), c = canvas(vp.width, vp.height), x = c.getContext("2d", { willReadFrequently: true });
    var o = { canvasContext: x, viewport: vp, background: "#ffffff" };
    if (filter) o.operationsFilter = filter;
    return page.render(o).promise.then(function () { return { ctx: x, data: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }; });
  }
  // Every image the page paints, with its matrix (as pdfin.js), and
  // whether a soft mask, a blend mode or a mask group shapes it.
  function paints(lib, ops) {
    var O = lib.OPS, st = { m: [1, 0, 0, 1, 0, 0], sm: false, bm: false }, stack = [], groups = [], inMask = 0, res = [];
    function push() { stack.push({ m: st.m, sm: st.sm, bm: st.bm }); }
    function pop() { var p = stack.pop(); if (p) st = p; }
    for (var i = 0; i < ops.fnArray.length && res.length < 200; i++) {
      var fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === O.save) push();
      else if (fn === O.restore) pop();
      else if (fn === O.transform && a) st = { m: PI.mulM(st.m, a), sm: st.sm, bm: st.bm };
      else if (fn === O.paintFormXObjectBegin) { push(); if (a && Array.isArray(a[0]) && a[0].length === 6) st = { m: PI.mulM(st.m, a[0]), sm: st.sm, bm: st.bm }; }
      else if (fn === O.paintFormXObjectEnd) pop();
      else if (fn === O.beginGroup) { var mk = !!(a && a[0] && a[0].smask); groups.push(mk); if (mk) inMask++; }
      else if (fn === O.endGroup) { if (groups.pop()) inMask--; }
      else if (fn === O.setGState && a && Array.isArray(a[0])) {
        a[0].forEach(function (kv) {
          // (PDF.js turns a soft mask off again right before the image it
          // masks: only the end of the graphics state ends it here)
          if (kv[0] === "SMask" && kv[1]) st = { m: st.m, sm: true, bm: st.bm };
          else if (kv[0] === "BM") st = { m: st.m, sm: st.sm, bm: !!kv[1] && kv[1] !== "source-over" };
          else if ((kv[0] === "ca" || kv[0] === "CA") && kv[1] < 1) st = { m: st.m, sm: st.sm, bm: true };
        });
      }
      else if (fn === O.paintImageXObject && a && typeof a[0] === "string") res.push({ i: i, id: a[0], m: st.m, masked: !!(inMask || st.sm || st.bm) });
      else if (fn === O.paintInlineImageXObject && a && a[0]) res.push({ i: i, img: a[0], m: st.m, masked: !!(inMask || st.sm || st.bm) });
    }
    return res;
  }
  // the colour of a piece of text: the pixels its letters changed the
  // most (their edges are blended with the paper)
  function textColour(full, bare, W, Hc, box) {
    var x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(W, Math.ceil(box[2])), y1 = Math.min(Hc, Math.ceil(box[3]));
    var px = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var i = (y * W + x) * 4, d = Math.abs(full[i] - bare[i]) + Math.abs(full[i + 1] - bare[i + 1]) + Math.abs(full[i + 2] - bare[i + 2]);
      if (d > 90) px.push([d, i]);
    }
    if (!px.length) return null;
    px.sort(function (a, b) { return b[0] - a[0]; });
    var n = Math.max(1, Math.ceil(px.length / 10)), r = 0, g = 0, b = 0;
    for (var k = 0; k < n; k++) { var j = px[k][1]; r += full[j]; g += full[j + 1]; b += full[j + 2]; }
    return [r / n, g / n, b / n];
  }

  // buf: the PDF (ArrayBuffer); sources: Files (pictures; .txt / .md /
  // .html for the words); opts: { now, name, lang, cancelled(),
  // matchFonts(names) → Promise of { name: entry } (build's opts.fonts) };
  // store(blob) → Promise of { id, w, h } (the asset store);
  // progress(done, total) → Promise of { doc, report } or null.
  function open(buf, sources, opts, store, progress) {
    opts = opts || {};
    var cands = [], words = {}, af = null;
    sources = (sources || []).slice(0, MAX_SOURCES);
    var prep = Promise.resolve();
    function addCand(f) {
      return decode(f).then(function (img) {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (w && h) cands.push({ file: f, w: w, h: h, ar: w / h, th: thumb(img, w, h) });
      }, function () {});
    }
    sources.forEach(function (f) {
      prep = prep.then(function () {
        if (/^image\//.test(f.type || "") || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(f.name || "")) return addCand(f);
        // the Affinity file of the same document (LY-AF): its own
        // pictures, its words, and its fonts and style names for the report
        if (/\.af$/i.test(f.name || "") && f.size <= MAX_AF && !af) {
          return loadAf().then(function (AF) {
            return f.arrayBuffer().then(function (buf) { return AF.read(new Uint8Array(buf), { zstd: root.fzstd }); });
          }).then(function (r) {
            if (!r) { af = { failed: 1 }; return; }
            af = { pictures: r.pictures.length, styles: r.styles.slice(0, 60), fonts: r.fonts.slice(0, 30), problems: r.problems };
            r.text.forEach(function (s) { (s.match(WORDS) || []).forEach(function (w) { words[w] = 1; }); });
            var chain = Promise.resolve();
            r.pictures.forEach(function (p) {
              chain = chain.then(function () { var b = new Blob([p.bytes], { type: p.type }); b.name = p.name; return addCand(b); });
            });
            return chain;
          }, function () { af = { failed: 1 }; });
        }
        if (/\.(txt|md|html?)$/i.test(f.name || "") && f.size < 20e6) {
          return f.text().then(function (s) { (s.match(WORDS) || []).forEach(function (w) { words[w] = 1; }); });
        }
      });
    });
    var bytes = new Uint8Array(buf);
    return prep.then(function () { return Promise.all([pageBoxes(bytes.slice()), PI.loadLib()]); }).then(function (r) {
      var boxes = r[0], lib = r[1];
      lib.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.js";
      return lib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, MAX_PAGES), pages = [], chain = Promise.resolve(), W = 0, H = 0, bleed = 0;
        var TEXT_OPS = {};
        [lib.OPS.showText, lib.OPS.showSpacedText, lib.OPS.nextLineShowText, lib.OPS.nextLineSetSpacingShowText].forEach(function (o) { TEXT_OPS[o] = 1; });
        for (var k = 1; k <= n; k++) (function (k) {
          chain = chain.then(function () {
            if (opts.cancelled && opts.cancelled()) throw new Error("cancelled");
            return pdf.getPage(k);
          }).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 }), view = page.view;
            // trim and bleed in the viewport's points (y down)
            var bx = boxes && boxes[k - 1] && !boxes[k - 1].rot ? boxes[k - 1] : null;
            var vb = function (b) { return { x: b[0] - view[0], y: view[3] - (b[1] + b[3]), w: b[2], h: b[3] }; };
            var trim = bx ? vb(bx.trim) : { x: 0, y: 0, w: vp1.width, h: vp1.height };
            var bl = bx ? vb(bx.bleed) : trim;
            var bleedPt = Math.max(0, Math.min(trim.x - bl.x, trim.y - bl.y, 36));
            if (k === 1) { W = trim.w; H = trim.h; bleed = bleedPt; }
            var sc = Math.min(150 / 72, 3500 / Math.max(vp1.width, vp1.height)), vp = page.getViewport({ scale: sc });
            var cw = Math.max(1, Math.round(vp.width)), ch = Math.max(1, Math.round(vp.height));
            var text, ops, pics = [], out = {}, full, under, bare;
            var noText = function (i) { return !TEXT_OPS[ops.fnArray[i]]; }, bgOnly = function (i) { return !TEXT_OPS[ops.fnArray[i]] && !out[i]; };
            return Promise.all([page.getTextContent(), page.getOperatorList()]).then(function (r) {
              text = r[0]; ops = r[1];
              return draw(page, sc, null);
            }).then(function (d) {
              full = d.data;
              ops = PI.drawnOps(page, ops);
              // pictures drawn as they are: their own frames; masked or
              // blended ones stay in the page's picture, where they look right
              pics = paints(lib, ops).map(function (p) {
                if (p.masked) return null;
                var pl = PI.placement(PI.mulM(vp1.transform, p.m));
                if (pl.w < 6 || pl.h < 6) return null;
                // outside the bleed (marks, colour bars): gone
                if (pl.x > bl.x + bl.w || pl.x + pl.w < bl.x || pl.y > bl.y + bl.h || pl.y + pl.h < bl.y) return null;
                var cv = PI.imageCanvas(p.img || PI.getObj(page, p.id));
                if (!cv) return null;
                pl.canvas = cv; pl.i = p.i;
                return pl;
              }).filter(Boolean);
              pics.forEach(function (p) { out[p.i] = 1; });
              return draw(page, sc, noText);
            }).then(function (d) {
              under = d.data;
              return pics.length ? draw(page, sc, bgOnly) : d;
            }).then(function (d) {
              bare = d;
              var spans = spansOf(lib, page, text, vp1, trim, function (box) {
                return textColour(full, under, cw, ch, box.map(function (v) { return v * sc; }));
              });
              // drawings inside the bleed: one picture behind everything,
              // drawn again at print resolution when there is one
              var cut = function (d, k2) {
                var x0 = Math.max(0, Math.round(bl.x * k2)), y0 = Math.max(0, Math.round(bl.y * k2));
                var w = Math.min(d.w - x0, Math.round(bl.w * k2)), h = Math.min(d.h - y0, Math.round(bl.h * k2));
                return w > 0 && h > 0 ? d.ctx.getImageData(x0, y0, w, h) : null;
              };
              var part = cut(bare, sc), bgP = Promise.resolve(null);
              if (part && !PI.blank(part.data)) {
                var hi = Math.min(300 / 72, 3500 / Math.max(bl.w, bl.h));
                bgP = (hi > sc * 1.2 ? draw(page, hi, bgOnly).then(function (d) { return cut(d, hi); }) : Promise.resolve(part)).then(function (img) {
                  var c = canvas(img.width, img.height);
                  c.getContext("2d").putImageData(img, 0, 0);
                  return toBlob(c, "image/jpeg", 0.9);
                });
              }
              return bgP.then(function (bgBlob) { return { spans: spans, bgBlob: bgBlob }; });
            }).then(function (got) {
              var spans = got.spans, bgBlob = got.bgBlob;
              var res = { spans: spans, imgs: [], bg: null };
              var pc = bgBlob ? Promise.resolve(bgBlob).then(function (blob) {
                blob.name = "pdf-page-" + k + ".jpg";
                return store(blob).then(function (s) { res.bg = { a: s.id, iw: s.w, ih: s.h }; });
              }).then(null, function () {}) : Promise.resolve();
              pics.forEach(function (p, j) {
                pc = pc.then(function () {
                  var up = p.rot ? upright(p.canvas, p.rot) : null, cv = up || p.canvas;
                  var box = up ? { x: p.x + p.w / 2 - p.h / 2, y: p.y + p.h / 2 - p.w / 2, w: p.h, h: p.w, rot: 0 } : { x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot };
                  if (Math.abs(Math.round(p.rot / 90) * 90 - p.rot) < 0.5 && up) box.rot = 0;
                  var ink = inkBox(cv), vis = ink ? [box.x - trim.x + box.w * ink[0] / cv.width, box.y - trim.y + box.h * ink[1] / cv.height, box.w * (ink[2] - ink[0]) / cv.width, box.h * (ink[3] - ink[1]) / cv.height] : null;
                  var orig = ink ? null : match(cands, cv);
                  var blobP = orig ? Promise.resolve(orig.file) : toBlob(cv, ink ? "image/png" : "image/jpeg", 0.92).then(function (b) { if (b) b.name = "pdf-" + k + "-" + (j + 1) + (ink ? ".png" : ".jpg"); return b; });
                  return blobP.then(function (blob) {
                    if (!blob) return;
                    return store(blob).then(function (s) {
                      res.imgs.push({ x: r3(box.x - trim.x), y: r3(box.y - trim.y), w: r3(box.w), h: r3(box.h), rot: box.rot || 0, vis: vis, a: s.id, iw: s.w, ih: s.h,
                                      nm: orig ? String(orig.file.name || "") : blob.name, original: !!orig });
                    });
                  });
                }).then(null, function () {});
              });
              return pc.then(function () {
                pages.push(res);
                page.cleanup();
                if (progress) progress(k, n);
              });
            });
          });
        })(k);
        return chain.then(function () {
          // the PDF's fonts by name, when the caller can find them (opts.matchFonts)
          var names = {};
          pages.forEach(function (p) { p.spans.forEach(function (s) { if (s.font) names[s.font] = 1; }); });
          return opts.matchFonts ? opts.matchFonts(Object.keys(names)).then(null, function () { return {}; }) : {};
        }).then(function (fonts) {
          var out = build({ w: W, h: H, bleed: bleed, pages: pages }, { now: opts.now, name: opts.name, lang: opts.lang, words: words, fonts: fonts });
          if (out) { out.report.total = pdf.numPages; out.report.cut = pdf.numPages > n; out.report.sources = cands.length; if (af) out.report.af = af; }
          pdf.destroy();
          return out;
        }, function (e) { pdf.destroy(); throw e; });
      });
    }).then(null, function (e) { if (e && e.message === "cancelled") return { cancelled: true }; return null; });
  }
  // The text pieces of a page in trim-box points (y down);
  // colour(box) gives a piece's colour from its box in viewport points.
  function spansOf(lib, page, text, vp1, trim, colour) {
    var spans = [];
    text.items.forEach(function (it) {
      if (typeof it.str !== "string" || !it.str) return;
      var m = lib.Util.transform(vp1.transform, it.transform);
      var size = Math.hypot(m[2], m[3]), rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
      if (!(size > 0)) return;
      var f = PI.fontOf(page, it.fontName), fn = fontName(page, it.fontName);
      var str = it.str.replace(/[\u0000-\u001f\u007f\u00ad\ufeff]/g, ""), lead = /^\s*/.exec(str)[0].length, trail = /\s*$/.exec(str)[0].length;
      if (!str.trim()) return;
      var spW = T.measure(keyOf(f.fam, f.b, f.i), " ", size, 0), wv = it.width || 0;
      var ax = { c: Math.cos(rot * Math.PI / 180), s: Math.sin(rot * Math.PI / 180) };
      var x0 = m[4] + lead * spW * ax.c, y0 = m[5] + lead * spW * ax.s;
      var box = [Math.min(m[4], m[4] + wv * ax.c), Math.min(m[5], m[5] + wv * ax.s) - size * 0.85, Math.max(m[4], m[4] + wv * ax.c), Math.max(m[5], m[5] + wv * ax.s) + size * 0.2];
      spans.push({ t: str.replace(/\s+/g, " "), x: r3(x0 - trim.x), y: r3(y0 - trim.y), x1: r3(m[4] + Math.max(0, wv - trail * spW) - trim.x), w: wv,
        size: Math.round(size * 100) / 100, rot: Math.abs(rot) < 0.5 ? 0 : Math.round(rot * 100) / 100, fam: f.fam, b: f.b, i: f.i, font: fn,
        color: colour ? colour(box) : null });
    });
    return spans;
  }
  // Only the text of a PDF (no pictures, no drawing): → Promise of
  // { pages: [{ spans }] } or null; for lining up another program's
  // file with its own print PDF (matchPdf).
  function pdfText(buf, opts) {
    opts = opts || {};
    var bytes = new Uint8Array(buf);
    return Promise.all([pageBoxes(bytes.slice()), PI.loadLib()]).then(function (r) {
      var boxes = r[0], lib = r[1];
      lib.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.js";
      return lib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, MAX_PAGES), pages = [], chain = Promise.resolve();
        for (var k = 1; k <= n; k++) (function (k) {
          chain = chain.then(function () {
            if (opts.cancelled && opts.cancelled()) throw new Error("cancelled");
            return pdf.getPage(k);
          }).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 }), view = page.view;
            var bx = boxes && boxes[k - 1] && !boxes[k - 1].rot ? boxes[k - 1] : null;
            var trim = bx ? { x: bx.trim[0] - view[0], y: view[3] - (bx.trim[1] + bx.trim[3]) } : { x: 0, y: 0 };
            return page.getTextContent().then(function (text) {
              pages.push({ spans: spansOf(lib, page, text, vp1, trim, null) });
              page.cleanup();
              if (opts.progress) opts.progress(k, n);
            });
          });
        })(k);
        return chain.then(function () { pdf.destroy(); return { pages: pages }; }, function (e) { pdf.destroy(); throw e; });
      });
    }).then(null, function () { return null; });
  }

  // ---------- 8. Another program's file + its print PDF ----------
  // doc (normalized, e.g. a Scribus import) and the PDF's pages
  // ({ spans }, pdfText): each text frame takes the PDF's lines inside
  // it (by column), the story's lines are lined up with them
  // (linefit.align) and fitted. Changes doc in place.
  // → { lines, matched, inPlace, fitted, styles }
  function matchPdf(doc, pages, opts) {
    opts = opts || {};
    var order = M.pagesInOrder(doc), pgIdx = {}, taken = {}, targets = [], rep = { lines: 0, matched: 0 };
    order.forEach(function (p, i) { pgIdx[p.id] = i; });
    var done = {};
    doc.items.forEach(function (it0) {
      if (it0.t !== "text" || !it0.story || done[it0.story]) return;
      done[it0.story] = 1;
      var texts = [];
      M.chain(doc, it0.story).forEach(function (f) {
        var pi = pgIdx[f.pg], P = pi === undefined ? null : pages[pi];
        if (!P || Math.abs(f.rot || 0) >= 0.5) return;
        var cols = Math.max(1, f.cols || 1), ins = Math.max(0, f.inset || 0), gut = Math.max(0, f.gut || 0);
        var cw = Math.max(1, (f.w - 2 * ins - gut * (cols - 1)) / cols), byCol = [];
        for (var c = 0; c < cols; c++) byCol.push([]);
        (P.spans || []).forEach(function (s, si) {
          var key = pi + ":" + si;
          if (taken[key] || Math.abs(s.rot || 0) >= 0.5) return;
          if (s.y <= f.y || s.y > f.y + f.h + s.size * 0.3 || s.x < f.x - 2 || s.x >= f.x + f.w) return;
          var col = Math.max(0, Math.min(cols - 1, Math.floor((s.x - f.x - ins + gut / 2) / (cw + gut))));
          byCol[col].push(s);
          taken[key] = 1;
        });
        byCol.forEach(function (sp) { toLines(sp).forEach(function (l) { texts.push(l.text); }); });
      });
      if (!texts.length) return;
      var a = LF.align(doc, it0.story, texts);
      rep.lines += a.total; rep.matched += a.matched;
      a.targets.forEach(function (tg) { targets.push(tg); });
    });
    var st = LF.fit(doc, targets, { name: opts.fitName, lang: opts.lang, now: opts.now });
    rep.inPlace = st.inPlace; rep.checked = st.lines; rep.fitted = st.fitted; rep.styles = st.styles;
    return rep;
  }

  function fontName(page, name) {
    var f = null;
    try { f = page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch (e) { f = null; }
    return f ? String(f.name || "").replace(/^[A-Z]{6}\+/, "").slice(0, 60) : "";
  }

  var api = { toLines: toLines, measure: measure, build: build, open: open, pdfText: pdfText, matchPdf: matchPdf, MAX_PAGES: MAX_PAGES, TRACK_ADJ: TRACK_ADJ };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_REBUILD = api;
})(typeof window !== "undefined" ? window : this);
