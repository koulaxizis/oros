// ============================================================
// orOS Layout — imposition (LY-W10, v1.0.0)
// Pages of a print PDF placed on printer's sheets, with pdf-lib:
//   - plan(n, kind, opts) → { pages (padded), sheets: [{ front, back }] }
//     each side [left, right] of 0-based page numbers or null (blank):
//       "saddle"  a booklet: one stack folded once (pages padded to 4)
//       "sig"     sections of opts.sig pages (8, 16 or 32) folded and
//                 gathered (perfect binding); each section is a
//                 small booklet
//       "twoUp"   two pages side by side in reading order (no folding)
//     opts.creep (pt): saddle and sig move the content of the inner
//     sheets towards the spine, the innermost by the whole amount.
//   - make(PDFLib, bytes, plan, opts) → Promise<{ bytes, sheets, sides }>
//     the sides of the sheets, in order (front, back, front, ...):
//     pages cut at their TrimBox plus the bleed on the outer edges,
//     spine to spine, with crop marks and a fold mark when opts.marks;
//     TrimBox / BleedBox on every sheet.
// Pure (no DOM): Node tests run it. Exposes LY_IMPOSE / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var KINDS = ["saddle", "sig", "twoUp"];
  var SIGS = [4, 8, 16, 32];

  function pad(n, k) { return Math.ceil(Math.max(1, n) / k) * k; }

  // one folded stack of P pages starting at `off` (n pages in all, the
  // rest blank): P/4 sheets, outer first
  function booklet(off, P, n, creep, out) {
    var S = P / 4;
    for (var s = 0; s < S; s++) {
      var a = off + P - 1 - 2 * s, b = off + 2 * s, c = off + 2 * s + 1, d = off + P - 2 - 2 * s;
      var cr = S > 1 ? creep * s / (S - 1) : 0;
      out.push({
        front: [a < n ? a : null, b < n ? b : null],
        back: [c < n ? c : null, d < n ? d : null],
        creep: Math.round(cr * 1000) / 1000
      });
    }
  }
  function plan(n, kind, opts) {
    opts = opts || {};
    n = Math.max(0, Math.floor(n));
    var creep = Math.max(0, Math.min(20, Number(opts.creep) || 0)), sheets = [], P;
    if (kind === "twoUp") {
      P = pad(n, 2);
      for (var i = 0; i < P; i += 2) sheets.push({ front: [i, i + 1 < n ? i + 1 : null], back: null, creep: 0 });
      return { kind: kind, pages: P, sheets: sheets };
    }
    if (kind === "sig") {
      var g = SIGS.indexOf(+opts.sig) > 0 ? +opts.sig : 16;
      P = pad(n, g);
      for (var o = 0; o < P; o += g) booklet(o, g, n, creep, sheets);
      // a sheet with nothing on it is not printed
      sheets = sheets.filter(function (sh) { return sh.front.concat(sh.back).some(function (p) { return p !== null; }); });
      return { kind: kind, pages: P, sheets: sheets, sig: g };
    }
    P = pad(n, 4);
    booklet(0, P, n, creep, sheets);
    return { kind: "saddle", pages: P, sheets: sheets };
  }

  function boxOf(P, page, name) {
    var v = page.node.get(P.PDFName.of(name));
    if (!(v instanceof P.PDFArray) || v.size() !== 4) return null;
    return [0, 1, 2, 3].map(function (i) { return v.get(i).asNumber(); });
  }

  // crop marks at the corners of the trim (x, y, w, h), off by `off`
  function cropMarks(page, x, y, w, h, off, len, rgb) {
    var col = rgb(0, 0, 0), t = 0.25;
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (c, i) {
      var sx = i % 2 ? 1 : -1, sy = i < 2 ? -1 : 1;
      page.drawLine({ start: { x: c[0] + sx * off, y: c[1] }, end: { x: c[0] + sx * (off + len), y: c[1] }, thickness: t, color: col });
      page.drawLine({ start: { x: c[0], y: c[1] + sy * off }, end: { x: c[0], y: c[1] + sy * (off + len) }, thickness: t, color: col });
    });
  }

  function make(P, bytes, pl, opts) {
    opts = opts || {};
    var marks = !!opts.marks, MK = marks ? 24 : 0, two = pl.kind === "twoUp";
    return Promise.all([P.PDFDocument.load(bytes, { updateMetadata: false }), P.PDFDocument.create()]).then(function (r) {
      var src = r[0], out = r[1], pages = src.getPages();
      if (!pages.length) throw new Error("empty");
      var first = pages[0], trim = boxOf(P, first, "TrimBox"), media = first.getMediaBox();
      if (!trim) trim = [media.x, media.y, media.x + media.width, media.y + media.height];
      var bl = boxOf(P, first, "BleedBox") || trim;
      var W = trim[2] - trim[0], H = trim[3] - trim[1], b = Math.max(0, Math.min(trim[0] - bl[0], 36));
      var gap = two ? 2 * b : 0;
      var SW = 2 * W + gap + 2 * b + 2 * MK, SH = H + 2 * b + 2 * MK;
      var ox = MK + b, oy = MK + b;
      var sides = [];
      pl.sheets.forEach(function (sh) { sides.push({ s: sh.front, cr: sh.creep }); if (sh.back) sides.push({ s: sh.back, cr: sh.creep }); });
      // each page once, cut at its trim plus the bleed (all round; the
      // spine side is clipped below)
      var used = [];
      sides.forEach(function (sd) { sd.s.forEach(function (p) { if (p !== null && p < pages.length && used.indexOf(p) < 0) used.push(p); }); });
      var boxes = used.map(function (p) {
        var t = boxOf(P, pages[p], "TrimBox") || trim;
        return { left: t[0] - b, bottom: t[1] - b, right: t[2] + b, top: t[3] + b };
      });
      return out.embedPages(used.map(function (p) { return pages[p]; }), boxes).then(function (emb) {
        var byPage = {};
        used.forEach(function (p, i) { byPage[p] = emb[i]; });
        sides.forEach(function (sd) {
          var pg = out.addPage([SW, SH]);
          sd.s.forEach(function (p, k) {
            if (p === null || !byPage[p]) return;
            var x0 = ox + k * (W + gap), shift = two ? 0 : (k === 0 ? sd.cr : -sd.cr);
            // the half of the sheet this page owns: its bleed on the
            // outer edges, none across the spine
            var cx = k === 0 ? 0 : x0 - (two ? b : 0), cw = k === 0 ? (two ? x0 + W + b : x0 + W) : SW - cx;
            pg.pushOperators(P.pushGraphicsState(), P.rectangle(cx, 0, cw, SH), P.clip(), P.endPath());
            pg.drawPage(byPage[p], { x: x0 - b + shift, y: oy - b, width: W + 2 * b, height: H + 2 * b });
            pg.pushOperators(P.popGraphicsState());
          });
          var N = P.PDFName.of, tw = 2 * W + gap;
          pg.node.set(N("TrimBox"), out.context.obj([ox, oy, ox + tw, oy + H]));
          pg.node.set(N("BleedBox"), out.context.obj([ox - b, oy - b, ox + tw + b, oy + H + b]));
          if (marks) {
            if (two) { cropMarks(pg, ox, oy, W, H, b + 3, 12, P.rgb); cropMarks(pg, ox + W + gap, oy, W, H, b + 3, 12, P.rgb); }
            else {
              cropMarks(pg, ox, oy, tw, H, b + 3, 12, P.rgb);
              // the fold, dashed, outside the bleed at the spine
              [[oy - b - 3, oy - b - 15], [oy + H + b + 3, oy + H + b + 15]].forEach(function (y) {
                pg.drawLine({ start: { x: ox + W, y: y[0] }, end: { x: ox + W, y: y[1] }, thickness: 0.25, color: P.rgb(0, 0, 0), dashArray: [2, 2] });
              });
            }
          }
        });
        out.setTitle(src.getTitle() || "");
        out.setProducer("orOS Layout (pdf-lib)");
        out.setCreator("orOS Layout");
        return out.save({ useObjectStreams: false }).then(function (b2) { return { bytes: b2, sheets: pl.sheets.length, sides: sides.length, size: [SW, SH] }; });
      });
    });
  }

  var api = { KINDS: KINDS, SIGS: SIGS, plan: plan, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_IMPOSE = api;
})(typeof window !== "undefined" ? window : this);
