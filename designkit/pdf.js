// ============================================================
// orOS designkit — pdf.js (v1.1.0)
// Vector PDF export with jsPDF (vendor/jspdf.umd.min.js): text as
// real, selectable text in the embedded fonts (Noto, or a family the
// document names: every subset file of it, each character written in
// the file that has it, else in the built-in stand-in), placed glyph run
// by glyph run from the SAME layout the screen draws (render.js),
// shapes as paths (free paths too, even-odd or non-zero), linear and
// radial gradients as PDF shadings (stop opacity is left out), images cropped to their frames, CMYK swatches as
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

  // The font file that writes a character: [key, part index].
  function faceFor(key, cp) {
    var parts = T.faceParts(key), i;
    for (i = 0; i < parts.length; i++) if (parts[i].map[cp] !== undefined) return [key, i];
    var fb = T.fallbackKey(key);
    if (fb === key) return [key, 0];
    var fp = T.faceParts(fb);
    for (i = 0; i < fp.length; i++) if (fp[i].map[cp] !== undefined) return [fb, i];
    return [fb, 0];
  }
  // The jsPDF font of a face file, embedded the first time it is used.
  function fontOf(pdf, key, i) {
    var have = pdf.orosFonts = pdf.orosFonts || {};
    var name = key + (i ? "~" + i : "");
    if (!have[name]) {
      var part = T.faceParts(key)[i];
      if (!part) return null;
      var file = T.FAMILIES[key.split("-")[0]].urls ? "f-" + name.replace(/~/g, "_") + ".ttf" : T.fontFile(key).replace(".ttf", "-" + key + ".ttf");
      pdf.addFileToVFS(file, part.b64());
      pdf.addFont(file, name, "normal", "Identity-H");
      have[name] = 1;
    }
    return name;
  }
  // A run's text in pieces that each one font file writes.
  function pieces(run) {
    var s = run.t, out = [], cur = null;
    for (var k = 0; k < s.length; k++) {
      var cp = s.codePointAt(k), ch = cp > 0xFFFF ? s.substr(k, 2) : s.charAt(k);
      if (cp > 0xFFFF) k++;
      var f = cp <= 32 && cur ? cur.f : faceFor(run.key, cp);
      if (cur && cur.f[0] === f[0] && cur.f[1] === f[1]) cur.t += ch;
      else { cur = { f: f, t: ch }; out.push(cur); }
    }
    return out;
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

  // Path commands (page points, see render.pathCmds) offset by ox, oy.
  function pathOf(pdf, cmds, ox, oy) {
    cmds.forEach(function (c) {
      if (c[0] === "M") pdf.moveTo(ox + c[1], oy + c[2]);
      else if (c[0] === "L") pdf.lineTo(ox + c[1], oy + c[2]);
      else if (c[0] === "C") pdf.curveTo(ox + c[1], oy + c[2], ox + c[3], oy + c[4], ox + c[5], oy + c[6]);
      else pdf.close();
    });
  }
  // Any outline as commands: rect (rounded), ellipse, path.
  var KAPPA = 0.5522847498;
  function outlineCmds(it) {
    if (it.t === "path") return R.pathCmds(it);
    var x = it.x, y = it.y, w = it.w, h = it.h;
    if (it.t === "ell") {
      var rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, kx = rx * KAPPA, ky = ry * KAPPA;
      return [["M", cx + rx, cy], ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
        ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ["Z"]];
    }
    var r = Math.max(0, Math.min(it.r || 0, w / 2, h / 2)), k = r * (1 - KAPPA);
    if (!r) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
    return [["M", x + r, y], ["L", x + w - r, y], ["C", x + w - k, y, x + w, y + k, x + w, y + r], ["L", x + w, y + h - r],
      ["C", x + w, y + h - k, x + w - k, y + h, x + w - r, y + h], ["L", x + r, y + h], ["C", x + k, y + h, x, y + h - k, x, y + h - r],
      ["L", x, y + r], ["C", x, y + k, x + k, y, x + r, y], ["Z"]];
  }
  // A gradient fill: jsPDF clips to the outline and paints the shading
  // in the current user space, so rotation applies to it as well.
  function gradFill(pdf, doc, it, ox, oy) {
    var g = R.gradGeom(it), colors = [];
    it.gr.st.forEach(function (s) {
      var c = M.swatchColor(doc, s[1]);
      colors.push({ offset: s[0], color: c ? c.rgb.slice() : [0, 0, 0] });
    });
    pdf.__dkGrad = (pdf.__dkGrad || 0) + 1;
    var key = "dkg" + pdf.__dkGrad;
    pdf.saveGraphicsState();
    pdf.advancedAPI(function (p) {
      var sp = g.k === "r"
        ? new p.ShadingPattern("radial", [ox + g.x1, oy + g.y1, 0, ox + g.x1, oy + g.y1, g.r], colors)
        : new p.ShadingPattern("axial", [ox + g.x1, oy + g.y1, ox + g.x2, oy + g.y2], colors);
      p.addShadingPattern(key, sp);
      pathOf(p, outlineCmds(it), ox, oy);
      var pat = { key: key, matrix: p.unitMatrix };
      if (it.eo) p.fillEvenOdd(pat); else p.fill(pat);
    });
    pdf.restoreGraphicsState();
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
    var hasFill = !it.gr && !!it.fill && setColor(pdf, doc, it.fill, "fill");
    var r = Math.max(0, Math.min(it.r || 0, it.w / 2, it.h / 2));
    function shape(st) {
      if (it.t === "path") {
        pathOf(pdf, R.pathCmds(it), ox, oy);
        if (st === "F") { if (it.eo) pdf.fillEvenOdd(); else pdf.fill(); }
        else if (st === "S") pdf.stroke();
      } else if (it.t === "ell") pdf.ellipse(x + it.w / 2, y + it.h / 2, it.w / 2, it.h / 2, st);
      else if (r) pdf.roundedRect(x, y, it.w, it.h, r, r, st);
      else pdf.rect(x, y, it.w, it.h, st);
    }
    if (it.gr) gradFill(pdf, doc, it, ox, oy);
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
          if (!setColor(pdf, doc, run.color, "text")) pdf.setTextColor(0, 0, 0);
          var opt = { baseline: "alphabetic" }, dx = 0;
          if (run.track) opt.charSpace = run.track * run.size / 1000;
          pieces(run).forEach(function (pc) {
            var name = fontOf(pdf, pc.f[0], pc.f[1]);
            if (!name) return;
            pdf.setFont(name, "normal");
            pdf.setFontSize(run.size);
            pdf.text(pc.t, x + run.x + dx, y + run.y, opt);
            dx += T.measure(run.key, pc.t, run.size, run.track);
          });
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
  //         images: { itemId: { data, fmt, rect, alias } },
  //         clip: { itemId: { x, y, w, h } } (page coordinates: the
  //           item is cut to that box — N-up cards, optional),
  //         pdf: a jsPDF document made by an earlier build() to add
  //           these pages to (optional; long data merges in parts) }
  // Returns the jsPDF document (caller: .output("blob")).
  function build(doc, opts, deps) {
    opts = opts || {}; deps = deps || {};
    var JsPDF = deps.jsPDF, clip = deps.clip || null;
    function draw(pdf, it, ox, oy, lines, gstates) {
      var c = clip && clip[it.id];
      if (c) { pdf.saveGraphicsState(); pdf.rect(ox + c.x, oy + c.y, c.w, c.h, null); pdf.clip(); pdf.discardPath(); }
      drawItem(pdf, doc, it, ox, oy, lines, deps.images || {}, gstates);
      if (c) pdf.restoreGraphicsState();
    }
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

    var pdf = deps.pdf || null, gstates = pdf ? (pdf.orosGstates = pdf.orosGstates || {}) : {};
    groups.forEach(function (g) {
      var W = s.w * g.length + 2 * (b + slug), H = s.h + 2 * (b + slug);
      var orient = W > H ? "l" : "p";
      if (!pdf) {
        pdf = new JsPDF({ unit: "pt", format: [W, H], orientation: orient, compress: true });
        pdf.orosGstates = gstates;
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
          M.masterItems(doc, page, side).forEach(function (it) {
            draw(pdf, it, ox, oy, mf[it.id] && mf[it.id].lines, gstates);
          });
        }
        M.itemsOn(doc, page.id).forEach(function (it) {
          draw(pdf, it, ox, oy, L.frames[it.id] && L.frames[it.id].lines, gstates);
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

  var api = { build: build, imageCrop: imageCrop, SLUG: SLUG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.pdf = api; }
})(typeof window !== "undefined" ? window : this);
