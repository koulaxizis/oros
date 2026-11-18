// ============================================================
// orOS designkit — pdf.js (v1.2.0)
// Vector PDF export with jsPDF (vendor/jspdf.umd.min.js): text as
// real, selectable text in the embedded fonts (Noto, or a family the
// document names: every subset file of it, each character written in
// the file that has it, else in the built-in stand-in), placed glyph run
// by glyph run from the SAME layout the screen draws (render.js),
// shapes as paths (free paths too, even-odd or non-zero), linear and
// radial gradients as PDF shadings (stop opacity is left out), images cropped to their frames, CMYK swatches as
// CMYK, rotation and opacity, bleed, TrimBox/BleedBox and crop marks,
// single pages or spreads. E-book PDF (v1.2.0, LY-OUT): every colour
// as RGB, the document language (/Lang), links (the contents lines to
// their pages) and bookmarks (the headings).
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
  // A run's text in pieces that each one font file writes; with
  // kerning (LY-KERN) a kerned pair also starts a piece, kern: the
  // kerning in points before the piece.
  function pieces(run) {
    var s = run.t, out = [], cur = null, prev = "";
    for (var k = 0; k < s.length; k++) {
      var cp = s.codePointAt(k), ch = cp > 0xFFFF ? s.substr(k, 2) : s.charAt(k);
      if (cp > 0xFFFF) k++;
      var f = cp <= 32 && cur ? cur.f : faceFor(run.key, cp);
      var kn = run.kern && prev ? T.kernPair(run.key, prev, ch, run.size) : 0;
      if (cur && !kn && cur.f[0] === f[0] && cur.f[1] === f[1]) cur.t += ch;
      else { cur = { f: f, t: ch, kern: kn }; out.push(cur); }
      prev = ch;
    }
    return out;
  }

  function setColor(pdf, doc, id, kind) {
    var c = M.swatchColor(doc, id);
    if (!c) return false;
    var fn = kind === "fill" ? "setFillColor" : kind === "draw" ? "setDrawColor" : "setTextColor";
    if (c.cmyk && !pdf.orosRgb) pdf[fn](c.cmyk[0] / 100, c.cmyk[1] / 100, c.cmyk[2] / 100, c.cmyk[3] / 100);
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
          if (run.g) {                                // on a path (LY-TP): glyph by glyph, turned
            run.g.forEach(function (gl) {
              var pc = pieces({ t: gl.ch, key: run.key, size: run.size })[0], name = pc && fontOf(pdf, pc.f[0], pc.f[1]);
              if (!name) return;
              pdf.saveGraphicsState();
              rotateAbout(pdf, gl.rot * 180 / Math.PI, x + gl.x, y + gl.y);
              pdf.setFont(name, "normal");
              pdf.setFontSize(run.size);
              pdf.text(gl.ch, x + gl.x - gl.w / 2, y + gl.y, { baseline: "alphabetic" });
              pdf.restoreGraphicsState();
            });
            return;
          }
          var opt = { baseline: "alphabetic" }, dx = 0;
          if (run.track) opt.charSpace = run.track * run.size / 1000;
          pieces(run).forEach(function (pc) {
            dx += pc.kern;
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

  // marks: true (crop marks, as before) or { crop, bleed, reg, bars,
  // info } (LY-PRO W1); every mark sits outside the bleed.
  function markSet(opts) {
    var m = opts.marks;
    if (!m) return {};
    if (m === true) return { crop: 1 };
    return { crop: !!m.crop, bleed: !!m.bleed, reg: !!m.reg, bars: !!m.bars, info: !!m.info };
  }
  function regInk(pdf) { pdf.setDrawColor(1, 1, 1, 1); pdf.setLineWidth(0.25); pdf.setLineDashPattern([], 0); }   // registration: all inks
  function cropMarks(pdf, x0, y0, w, h, b) {
    pdf.saveGraphicsState();
    regInk(pdf);
    var len = 12;
    [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].forEach(function (c, i) {
      var sx = i % 2 === 0 ? -1 : 1, sy = i < 2 ? -1 : 1;
      var offX = (sx < 0 ? b.l : b.r) + 3, offY = (sy < 0 ? b.t : b.b) + 3;
      pdf.line(c[0] + sx * offX, c[1], c[0] + sx * (offX + len), c[1]);
      pdf.line(c[0], c[1] + sy * offY, c[0], c[1] + sy * (offY + len));
    });
    pdf.restoreGraphicsState();
  }
  // short lines at the bleed's corners, outside it
  function bleedMarks(pdf, x0, y0, w, h, b) {
    pdf.saveGraphicsState();
    regInk(pdf);
    pdf.setLineDashPattern([2, 1.5], 0);
    var L0 = x0 - b.l, R0 = x0 + w + b.r, T0 = y0 - b.t, B0 = y0 + h + b.b, len = 6;
    [[L0, T0, -1, -1], [R0, T0, 1, -1], [L0, B0, -1, 1], [R0, B0, 1, 1]].forEach(function (c) {
      pdf.line(c[0] + c[2] * 3, c[1], c[0] + c[2] * (3 + len), c[1]);
      pdf.line(c[0], c[1] + c[3] * 3, c[0], c[1] + c[3] * (3 + len));
    });
    pdf.restoreGraphicsState();
  }
  function target(pdf, cx, cy) {
    var r = 4;
    pdf.circle(cx, cy, r, "S");
    pdf.circle(cx, cy, r / 2, "S");
    pdf.line(cx - r - 2, cy, cx + r + 2, cy);
    pdf.line(cx, cy - r - 2, cx, cy + r + 2);
  }
  // registration targets in the middle of each side, in the slug
  function regMarks(pdf, x0, y0, w, h, b, slug) {
    if (slug < 12) return;
    pdf.saveGraphicsState();
    regInk(pdf);
    var mid = slug / 2;
    target(pdf, x0 + w / 2, y0 - b.t - mid);
    target(pdf, x0 + w / 2, y0 + h + b.b + mid);
    target(pdf, x0 - b.l - mid, y0 + h / 2);
    target(pdf, x0 + w + b.r + mid, y0 + h / 2);
    pdf.restoreGraphicsState();
  }
  // CMYK patches (solids and 50 % tints) along the bottom slug
  var BARS = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0.5, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 0.5, 0], [0, 0, 0, 0.5], [1, 1, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0]];
  function colourBars(pdf, x0, y0, w, h, b, slug) {
    if (slug < 12) return;
    var sz = Math.min(8, slug / 2 - 2), y = y0 + h + b.b + (slug - sz) / 2, x = x0 + w * 0.6;
    if (x + BARS.length * sz > x0 + w + b.r) x = x0 + w + b.r - BARS.length * sz;
    pdf.saveGraphicsState();
    pdf.setLineWidth(0);
    BARS.forEach(function (c, i) { pdf.setFillColor(c[0], c[1], c[2], c[3]); pdf.rect(x + i * sz, y, sz, sz, "F"); });
    pdf.restoreGraphicsState();
  }
  // document name, pages, date in the top slug (registration black),
  // in the embedded Noto Sans (PDF/X wants every font embedded: no
  // built-in font); left out while that face is not loaded
  function pageInfo(pdf, x0, y0, w, h, b, slug, text) {
    if (slug < 10 || !text || !T.faceParts("sans-r").length) return;
    var name = fontOf(pdf, "sans-r", 0);
    if (!name) return;
    pdf.saveGraphicsState();
    pdf.setTextColor(0, 0, 0, 1);
    pdf.setFont(name, "normal");
    pdf.setFontSize(6);
    pdf.text(String(text).slice(0, 200), x0, y0 - b.t - slug / 2 + 2);
    pdf.restoreGraphicsState();
  }

  // opts: { pages: [pageId] (default all), spreads, bleed, marks
  //         (true = crop marks, or { crop, bleed, reg, bars, info }),
  //         slug (keep the document's slug without marks), stamp (text
  //         after the page numbers in the info line), title, lang
  //         (BCP 47: the PDF's /Lang), rgb (every colour as RGB: an
  //         e-book) }
  // The result's orosBoxes = [{ w, h, trim [x0,y0,x1,y1], bleed }] per
  // PDF page, in points (pdfx.js and the export report read it).
  // deps: { jsPDF, layout (computeLayout result, optional),
  //         images: { itemId: { data, fmt, rect, alias } },
  //         clip: { itemId: { x, y, w, h } } (page coordinates: the
  //           item is cut to that box — N-up cards, optional),
  //         pdf: a jsPDF document made by an earlier build() to add
  //           these pages to (optional; long data merges in parts;
  //           an e-book's cover page),
  //         links: [{ pg, x, y, w, h, to }] (page ids, page points:
  //           a link on page pg to page to, both among the pages out),
  //         outline: [{ t, lvl 1-3, to | pg (page id) }] (bookmarks) }
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

    // bleed per side (model bleeds(), LY-PRO W1); marks need room
    var useB = !!(opts.bleed || opts.marks);
    var slug = opts.marks ? Math.max(SLUG, M.slugOf ? M.slugOf(doc) : 0) : (opts.slug && M.slugOf ? M.slugOf(doc) : 0);
    var marks = markSet(opts);

    var pdf = deps.pdf || null, gstates = pdf ? (pdf.orosGstates = pdf.orosGstates || {}) : {};
    var at = {};   // page id → { n (PDF page number), dx (its x on a spread) }
    var boxes = [];
    groups.forEach(function (g) {
      var sides = g.map(function (p) { return M.sideOf(doc, L.pageOf[p.id]); });
      var bl0 = M.bleeds ? M.bleeds(doc, sides[0]) : { t: s.bleed, b: s.bleed, l: s.bleed, r: s.bleed };
      var bl1 = M.bleeds ? M.bleeds(doc, sides[sides.length - 1]) : bl0;
      var b = useB ? { t: Math.max(bl0.t, bl1.t), b: Math.max(bl0.b, bl1.b), l: bl0.l, r: bl1.r } : { t: 0, b: 0, l: 0, r: 0 };
      // each page's own size (M.pageSize, LY-PRO W3b): a spread is as
      // wide as its pages and as tall as the tallest
      var sz = g.map(function (p) { return M.pageSize ? M.pageSize(doc, p) : { w: s.w, h: s.h }; });
      var TW = sz.reduce(function (a, z) { return a + z.w; }, 0), TH = Math.max.apply(null, sz.map(function (z) { return z.h; }));
      var W = TW + b.l + b.r + 2 * slug, H = TH + b.t + b.b + 2 * slug;
      var orient = W > H ? "l" : "p";
      if (!pdf) {
        pdf = new JsPDF({ unit: "pt", format: [W, H], orientation: orient, compress: true });
        pdf.orosGstates = gstates;
        pdf.setProperties({ title: opts.title || doc.name, creator: "orOS Layout" });
      } else pdf.addPage([W, H], orient);
      if (opts.rgb) pdf.orosRgb = 1;
      if (opts.lang && !pdf.orosLang && typeof pdf.setLanguage === "function") {
        try { pdf.setLanguage(opts.lang); pdf.orosLang = opts.lang; } catch (e) { void e; }
      }
      var info = pdf.internal.getCurrentPageInfo().pageContext;
      var box = function (x0, y0, x1, y1) { return { bottomLeftX: x0, bottomLeftY: y0, topRightX: x1, topRightY: y1 }; };
      // PDF y goes up: the bottom bleed is at the bottom
      var tx0 = slug + b.l, ty0 = slug + b.b, tx1 = tx0 + TW, ty1 = ty0 + TH;
      info.trimBox = box(tx0, ty0, tx1, ty1);
      if (b.t || b.b || b.l || b.r) info.bleedBox = box(slug, slug, W - slug, H - slug);
      boxes.push({ w: W, h: H, trim: [tx0, ty0, tx1, ty1], bleed: [slug, slug, W - slug, H - slug] });

      var x0k = slug + b.l;
      g.forEach(function (page, k) {
        var pw = sz[k].w, ph = sz[k].h, ox = x0k, oy = slug + b.t;
        x0k += pw;
        var idx = L.pageOf[page.id], side = M.sideOf(doc, idx);
        // creep (saddle stitch): the content moves towards the spine,
        // the trim and the clip stay
        var cr = opts.creep && M.creepOf ? M.creepOf(doc, idx, all.length, opts.creep) : 0;
        at[page.id] = { n: pdf.internal.getNumberOfPages(), dx: ox + cr, dy: oy };
        pdf.saveGraphicsState();
        // clip to this page's trim + bleed (outer sides only on a spread)
        var cx0 = ox - (k === 0 ? b.l : 0), cx1 = ox + pw + (k === g.length - 1 ? b.r : 0);
        pdf.rect(cx0, oy - b.t, cx1 - cx0, ph + b.t + b.b, null); pdf.clip(); pdf.discardPath();
        ox += cr;
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
      if (opts.marks) {
        var ox0 = slug + b.l, oy0 = slug + b.t, tw = TW;
        if (marks.crop) cropMarks(pdf, ox0, oy0, tw, TH, b);
        if (marks.bleed && (b.t || b.b || b.l || b.r)) bleedMarks(pdf, ox0, oy0, tw, TH, b);
        if (marks.reg) regMarks(pdf, ox0, oy0, tw, TH, b, slug);
        if (marks.bars) colourBars(pdf, ox0, oy0, tw, TH, b, slug);
        if (marks.info) pageInfo(pdf, ox0, oy0, tw, TH, b, slug, (opts.title || doc.name || "") + "  ·  " +
          g.map(function (p) { var lb = L.labels && L.labels[L.pageOf[p.id]]; return lb ? lb.label : String(L.pageOf[p.id] + M.firstNumber(doc)); }).join("-") + (opts.stamp ? "  ·  " + opts.stamp : ""));
      }
    });
    pdf.orosBoxes = boxes;
    addLinks(pdf, deps.links, at);
    addOutline(pdf, deps.outline, at);
    return pdf;
  }

  // Links between pages that both went out, on the page they sit on.
  function addLinks(pdf, links, at) {
    if (!links || !links.length) return;
    var cur = pdf.internal.getCurrentPageInfo().pageNumber;
    links.forEach(function (ln) {
      var from = at[ln.pg], to = at[ln.to];
      if (!from || !to || !(ln.w > 0) || !(ln.h > 0)) return;
      pdf.setPage(from.n);
      pdf.link(from.dx + ln.x, from.dy + ln.y, ln.w, ln.h, { pageNumber: to.n });
    });
    pdf.setPage(cur);
  }
  // Bookmarks: a level-2 heading under the level-1 before it, and so on.
  function addOutline(pdf, list, at) {
    if (!list || !list.length || !pdf.outline || typeof pdf.outline.add !== "function") return;
    var parents = [null, null, null, null];
    list.forEach(function (h) {
      var to = at[h.to || h.pg];
      if (!to || !h.t) return;
      var lv = Math.max(1, Math.min(3, h.lvl || 1)), par = null;
      for (var i = lv - 1; i >= 1 && !par; i--) par = parents[i];
      var node = pdf.outline.add(par, String(h.t).slice(0, 200), { pageNumber: to.n });
      parents[lv] = node;
      for (var j = lv + 1; j <= 3; j++) parents[j] = null;
    });
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
