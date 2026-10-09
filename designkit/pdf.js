// ============================================================
// orOS designkit — pdf.js (v1.0.0)
// Vector PDF export with jsPDF (vendor/jspdf.umd.min.js): text as
// real, selectable text in the embedded Noto fonts, placed glyph run
// by glyph run from the SAME layout the screen draws (render.js),
// shapes as paths, images cropped to their frames, CMYK swatches as
// CMYK, rotation and opacity, bleed, TrimBox/BleedBox and crop marks,
// single pages or spreads.
// Needs orosDK.model + orosDK.text + orosDK.render (Node: require).
// Exposes orosDK.pdf (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M, T, R;
  if (typeof module !== "undefined" && module.exports) { M = require("./model.js"); T = require("./text.js"); R = require("./render.js"); }
  else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; }

  var SLUG = 20;          // room for crop marks around the bleed (pt)

  function f4(n) { return (Math.round(n * 10000) / 10000).toString(); }

  // Fonts used by the laid-out runs of the chosen pages.
  function fontsUsed(doc, L, pages) {
    var keys = {};
    function scan(lines) { (lines || []).forEach(function (ln) { ln.runs.forEach(function (r) { keys[r.key] = 1; }); }); }
    var ids = {};
    pages.forEach(function (p) { ids[p.id] = 1; });
    doc.items.forEach(function (it) { if (it.t === "text" && ids[it.pg] && L.frames[it.id]) scan(L.frames[it.id].lines); });
    pages.forEach(function (p) {
      var mf = L.master[p.id] || {};
      Object.keys(mf).forEach(function (k) { scan(mf[k].lines); });
    });
    return Object.keys(keys).sort();
  }

  function setColor(pdf, doc, id, kind) {
    var c = M.swatchColor(doc, id);
    if (!c) return false;
    var fn = kind === "fill" ? "setFillColor" : kind === "draw" ? "setDrawColor" : "setTextColor";
    if (c.cmyk) pdf[fn](c.cmyk[0] / 100, c.cmyk[1] / 100, c.cmyk[2] / 100, c.cmyk[3] / 100);
    else pdf[fn](c.rgb[0], c.rgb[1], c.rgb[2]);
    return true;
  }

  // Rotate about (cx, cy) in top-down page coordinates. jsPDF flips
  // y itself, so the matrix is written in PDF space (y up), where a
  // clockwise turn on paper is a negative angle.
  function rotateAbout(pdf, deg, cx, cy) {
    var H = pdf.internal.pageSize.getHeight();
    var px = cx, py = H - cy, t = deg * Math.PI / 180;
    var a = Math.cos(t), b = -Math.sin(t), c = Math.sin(t), d = Math.cos(t);
    var e = px - a * px - c * py, f = py - b * px - d * py;
    pdf.internal.write([f4(a), f4(b), f4(c), f4(d), f4(e), f4(f), "cm"].join(" "));
  }

  function style(fill, stroke) { return fill && stroke ? "FD" : fill ? "F" : stroke ? "S" : null; }

  function drawItem(pdf, doc, it, ox, oy, lines, images, gstates) {
    if (it.hide) return;
    var x = ox + it.x, y = oy + it.y;
    pdf.saveGraphicsState();
    if (it.op < 100) {
      var key = String(it.op);
      if (!gstates[key]) gstates[key] = new pdf.GState({ opacity: it.op / 100, "stroke-opacity": it.op / 100 });
      pdf.setGState(gstates[key]);
    }
    if (it.rot) rotateAbout(pdf, it.rot, x + it.w / 2, y + it.h / 2);
    var hasStroke = !!it.stroke && it.sw > 0 && setColor(pdf, doc, it.stroke, "draw");
    if (hasStroke) {
      pdf.setLineWidth(it.sw);
      pdf.setLineDashPattern(it.dash ? [it.sw * 3, it.sw * 2] : [], 0);
    }
    if (it.t === "line") {
      if (hasStroke) pdf.line(x, y, x + it.w, y + it.h);
      pdf.restoreGraphicsState();
      return;
    }
    var hasFill = !!it.fill && setColor(pdf, doc, it.fill, "fill");
    var r = Math.max(0, Math.min(it.r || 0, it.w / 2, it.h / 2));
    function shape(st) {
      if (it.t === "ell") pdf.ellipse(x + it.w / 2, y + it.h / 2, it.w / 2, it.h / 2, st);
      else if (r) pdf.roundedRect(x, y, it.w, it.h, r, r, st);
      else pdf.rect(x, y, it.w, it.h, st);
    }
    if (hasFill) shape("F");
    if (it.t === "img") {
      var im = images[it.id];
      if (im) {
        pdf.saveGraphicsState();
        shape(null); pdf.clip(); pdf.discardPath();
        pdf.addImage(im.data, im.fmt, x + im.rect.x, y + im.rect.y, im.rect.w, im.rect.h, im.alias, "FAST");
        pdf.restoreGraphicsState();
      }
    }
    if (it.t === "text" && lines) {
      lines.forEach(function (ln) {
        ln.runs.forEach(function (run) {
          if (!run.t) return;
          pdf.setFont(run.key, "normal");
          pdf.setFontSize(run.size);
          if (!setColor(pdf, doc, run.color, "text")) pdf.setTextColor(0, 0, 0);
          var opt = { baseline: "alphabetic" };
          if (run.track) opt.charSpace = run.track * run.size / 1000;
          pdf.text(run.t, x + run.x, y + run.y, opt);
          if (run.u) {
            if (!setColor(pdf, doc, run.color, "fill")) pdf.setFillColor(0, 0, 0);
            pdf.rect(x + run.x, y + run.y + run.size * 0.12, run.w, Math.max(0.3, run.size * 0.05), "F");
          }
        });
      });
    }
    if (hasStroke) shape("S");
    pdf.restoreGraphicsState();
  }

  function cropMarks(pdf, x0, y0, w, h, bleed) {
    pdf.saveGraphicsState();
    pdf.setDrawColor(1, 1, 1, 1);           // registration: all inks
    pdf.setLineWidth(0.25);
    pdf.setLineDashPattern([], 0);
    var off = bleed + 3, len = 12;
    [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].forEach(function (c, i) {
      var sx = i % 2 === 0 ? -1 : 1, sy = i < 2 ? -1 : 1;
      pdf.line(c[0] + sx * off, c[1], c[0] + sx * (off + len), c[1]);
      pdf.line(c[0], c[1] + sy * off, c[0], c[1] + sy * (off + len));
    });
    pdf.restoreGraphicsState();
  }

  // opts: { pages: [pageId] (default all), spreads, bleed, marks,
  //         title, lang }
  // deps: { jsPDF, layout (computeLayout result, optional),
  //         images: { itemId: { data, fmt, rect, alias } } }
  // Returns the jsPDF document (caller: .output("blob")).
  function build(doc, opts, deps) {
    opts = opts || {}; deps = deps || {};
    var JsPDF = deps.jsPDF;
    var L = deps.layout || R.computeLayout(doc);
    var s = doc.setup;
    var all = M.pagesInOrder(doc), want = {};
    (opts.pages && opts.pages.length ? opts.pages : all.map(function (p) { return p.id; })).forEach(function (id) { want[id] = 1; });
    var groups = [];
    if (opts.spreads && s.facing) {
      M.spreads(doc).forEach(function (sp) {
        var g = sp.filter(function (p) { return want[p.id]; });
        if (g.length) groups.push(sp.length === 2 && g.length === 1 ? g : sp.filter(function (p) { return want[p.id]; }));
      });
    } else all.forEach(function (p) { if (want[p.id]) groups.push([p]); });
    if (!groups.length) throw new Error("no pages");

    var b = opts.bleed || opts.marks ? s.bleed : 0;
    var slug = opts.marks ? SLUG : 0;
    var used = [];
    groups.forEach(function (g) { used = used.concat(g); });
    var fonts = fontsUsed(doc, L, used);

    var pdf = null, gstates = {};
    groups.forEach(function (g) {
      var W = s.w * g.length + 2 * (b + slug), H = s.h + 2 * (b + slug);
      var orient = W > H ? "l" : "p";
      if (!pdf) {
        pdf = new JsPDF({ unit: "pt", format: [W, H], orientation: orient, compress: true });
        fonts.forEach(function (k) {
          var b64 = T.fontBase64(k);
          if (!b64) return;
          var file = T.fontFile(k).replace(".ttf", "-" + k + ".ttf");
          pdf.addFileToVFS(file, b64);
          pdf.addFont(file, k, "normal", "Identity-H");
        });
        pdf.setProperties({ title: opts.title || doc.name, creator: "orOS Layout" });
      } else pdf.addPage([W, H], orient);
      var info = pdf.internal.getCurrentPageInfo().pageContext;
      var box = function (x0, y0, x1, y1) { return { bottomLeftX: x0, bottomLeftY: y0, topRightX: x1, topRightY: y1 }; };
      info.trimBox = box(b + slug, b + slug, W - b - slug, H - b - slug);
      if (b) info.bleedBox = box(slug, slug, W - slug, H - slug);

      g.forEach(function (page, k) {
        var ox = slug + b + k * s.w, oy = slug + b;
        var idx = L.pageOf[page.id], side = M.sideOf(doc, idx);
        pdf.saveGraphicsState();
        // clip to this page's trim + bleed (outer sides only on a spread)
        var cx0 = ox - (k === 0 ? b : 0), cx1 = ox + s.w + (k === g.length - 1 ? b : 0);
        pdf.rect(cx0, oy - b, cx1 - cx0, s.h + 2 * b, null); pdf.clip(); pdf.discardPath();
        if (page.ms) {
          var mf = L.master[page.id] || {};
          M.itemsOn(doc, page.ms, side).forEach(function (it) {
            drawItem(pdf, doc, it, ox, oy, mf[it.id] && mf[it.id].lines, deps.images || {}, gstates);
          });
        }
        M.itemsOn(doc, page.id).forEach(function (it) {
          drawItem(pdf, doc, it, ox, oy, L.frames[it.id] && L.frames[it.id].lines, deps.images || {}, gstates);
        });
        pdf.restoreGraphicsState();
      });
      if (opts.marks) cropMarks(pdf, b + slug, b + slug, s.w * g.length, s.h, b);
    });
    return pdf;
  }

  // Image placement for the PDF: the visible part of the image (the
  // frame ∩ the image rectangle), in frame-local points, and the
  // source pixel rectangle to cut from the bitmap.
  function imageCrop(it) {
    var r = R.imageRect(it);
    var x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    var x1 = Math.min(it.w, r.x + r.w), y1 = Math.min(it.h, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) return null;
    var sx = it.iw / r.w, sy = it.ih / r.h;
    return {
      rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      src: { x: (x0 - r.x) * sx, y: (y0 - r.y) * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy }
    };
  }

  var api = { build: build, fontsUsed: fontsUsed, imageCrop: imageCrop, SLUG: SLUG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.pdf = api; }
})(typeof window !== "undefined" ? window : this);
