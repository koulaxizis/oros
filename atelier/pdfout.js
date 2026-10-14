// ============================================================
// orOS Atelier — PDF with real text (v1.0.0)
// A design page as a PDF page (jsPDF, vendor/jspdf.umd.min.js):
//   - texts are real, selectable text in the fonts the design uses
//     (Noto, or a Fontsource face: every subset file embedded as its
//     own font), placed run by run from the SAME layout the canvas
//     draws (ax.js textLayout / curveLayout); effects that are paint
//     passes become passes here (offset copies, outlines, the
//     background box); blurred passes (shadow, lift, neon glow) are
//     drawn as a picture under the text;
//   - shapes (solid fill, outline, dashes), lines with their heads,
//     table cells, texts and rules are vector paths;
//   - pictures: photos (with filters, cropped to the frame and cut to
//     their shape by a clipping path), icons, charts, gradients,
//     videos (first frame) and anything else the PDF can't hold.
// Rotation and transparency per element as on the canvas.
// plan() says what goes how; the caller draws the pictures (the
// browser: io.js, through draw.js) and build() writes the PDF.
// Exposes window.AtelierPDF (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M, T, FX, AX;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js");
    FX = require("../designkit/fx.js"); AX = require("./ax.js");
  } else {
    M = root.orosDK.model; T = root.orosDK.text; FX = root.orosDK.fx; AX = root.AtelierAX;
  }

  function f4(n) { return (Math.round(n * 10000) / 10000).toString(); }
  function rgb(hex) {
    var s = FX.normColor(hex) || "#000000";
    return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16)];
  }

  // ---------- 1. Fonts ----------
  // The face that draws a character of a run: [faceKey, partIndex],
  // or null when no font of the design has it (then the element is a
  // picture). An extra family falls back to its sans variant, as the
  // canvas and the metrics do.
  function faceFor(key, cp) {
    var parts = T.faceParts(key);
    for (var i = 0; i < parts.length; i++) if (parts[i].map[cp] !== undefined) return [key, i];
    var v = key.split("-")[1] || "r", fb = "sans-" + v;
    if (fb !== key) {
      var fp = T.faceParts(fb);
      for (var j = 0; j < fp.length; j++) if (fp[j].map[cp] !== undefined) return [fb, j];
    }
    return null;
  }
  // Can every visible character of these runs be written as text?
  function coversRuns(runs) {
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i], s = r.t || "";
      for (var k = 0; k < s.length; k++) {
        var cp = s.codePointAt(k);
        if (cp > 0xFFFF) k++;
        if (cp <= 32 || cp === 0xA0) continue;
        if (!faceFor(r.key, cp)) return false;
      }
    }
    return true;
  }
  function textRuns(it) {
    var ax = it.ax;
    if (ax.cv) {
      var cl = AX.curveLayout(it);
      return cl.glyphs.map(function (g) { return { t: g.ch, key: cl.key }; });
    }
    var out = [];
    AX.textLayout(it).lines.forEach(function (ln) { ln.runs.forEach(function (r) { if (r.t) out.push(r); }); });
    return out;
  }
  function tableRuns(it) {
    var out = [];
    AX.tableLayout(it).cells.forEach(function (c) { c.lines.forEach(function (ln) { ln.runs.forEach(function (r) { if (r.t) out.push(r); }); }); });
    return out;
  }

  // ---------- 2. What goes how ----------
  // "vector" | "text" (vector text, blurred passes as a picture
  // underneath: "textfx") | "photo" (picture clipped to the shape) |
  // "raster" (the element as a picture) | "" (nothing to draw).
  function hasBlur(ax) {
    return FX.textPasses(ax.tfx, ax.size || AX.TEXT_DEF.size, ax.fc || "#000000").some(function (p) { return p.blur > 0; });
  }
  function kindOf(it) {
    var ax = it && it.ax;
    if (!ax || it.hide) return "";
    if (ax.k === "text") {
      if (!ax.tx || !ax.tx.trim()) return "";
      if (!coversRuns(textRuns(it))) return "raster";
      return hasBlur(ax) ? "textfx" : "text";
    }
    if (ax.k === "shape") {
      if (ax.g) return "raster";
      return ax.fc || (ax.sc && it.sw > 0) ? "vector" : "";
    }
    if (ax.k === "line") return "vector";
    if (ax.k === "table") return coversRuns(tableRuns(it)) ? "vector" : "raster";
    if (ax.k === "photo") return it.a || ax.vid ? "photo" : "";
    return "raster";                     // icons, charts
  }
  function pageItems(doc, pg) {
    return doc.items.filter(function (it) { return it.pg === pg && it.ax && !it.hide; }).sort(M.byZ);
  }
  // Extra room around an element drawn as a picture (pt).
  function padOf(it, kind) {
    var ax = it.ax;
    if (kind === "textfx" || (kind === "raster" && ax.k === "text")) {
      var p = FX.fxPad(ax.tfx, ax.size || AX.TEXT_DEF.size), s = (ax.size || AX.TEXT_DEF.size) * 0.3;
      return Math.ceil(Math.max(p.l, p.t, p.r, p.b) + s);
    }
    if (ax.k === "icon") return (it.sw || 2) * 2 + 2;
    if (ax.k === "table" || ax.k === "shape") return (it.sw || 0) + 1;
    return 0;
  }
  // [{ id, kind, pad }] for the pages (ids). Only "textfx", "photo"
  // and "raster" need a picture from the caller.
  function plan(doc, pageIds) {
    var out = [];
    pageIds.forEach(function (pg) {
      pageItems(doc, pg).forEach(function (it) {
        var k = kindOf(it);
        if (k) out.push({ id: it.id, pg: pg, kind: k, pad: padOf(it, k) });
      });
    });
    return out;
  }
  function needsPicture(p) { return p.kind === "textfx" || p.kind === "photo" || p.kind === "raster"; }

  // ---------- 3. Writing ----------
  function rotateAbout(pdf, deg, cx, cy) {
    var H = pdf.internal.pageSize.getHeight();
    var px = cx, py = H - cy, a0 = deg * Math.PI / 180;
    var a = Math.cos(a0), b = -Math.sin(a0), c = Math.sin(a0), d = Math.cos(a0);
    var e = px - a * px - c * py, f = py - b * px - d * py;
    pdf.internal.write([f4(a), f4(b), f4(c), f4(d), f4(e), f4(f), "cm"].join(" "));
  }
  function Writer(pdf) {
    var gs = {}, fontsIn = {};
    function alpha(a) {
      a = Math.max(0, Math.min(1, a));
      if (a >= 0.999) return;
      var k = a.toFixed(3);
      if (!gs[k]) gs[k] = new pdf.GState({ opacity: a, "stroke-opacity": a });
      pdf.setGState(gs[k]);
    }
    // the jsPDF font name of a face part (embedded once)
    function font(key, i) {
      var name = key + (i ? "~" + i : "");
      if (!fontsIn[name]) {
        var part = T.faceParts(key)[i];
        var file = "f-" + name.replace(/[^a-z0-9~-]/gi, "_") + ".ttf";
        pdf.addFileToVFS(file, part.b64());
        pdf.addFont(file, name, "normal", "Identity-H");
        fontsIn[name] = 1;
      }
      return name;
    }
    // A run as one or more text pieces (each in the face that has
    // its characters), at x, y (baseline) in page points.
    function run(r, x, y, mode, extra) {
      var s = r.t, segs = [], cur = null;
      for (var k = 0; k < s.length; k++) {
        var cp = s.codePointAt(k), ch = cp > 0xFFFF ? s.substr(k, 2) : s.charAt(k);
        if (cp > 0xFFFF) k++;
        var f = faceFor(r.key, cp) || (cur ? cur.f : faceFor(r.key, 32)) || [r.key, 0];
        if (cur && cur.f[0] === f[0] && cur.f[1] === f[1]) cur.t += ch;
        else { cur = { f: f, t: ch }; segs.push(cur); }
      }
      var dx = 0;
      segs.forEach(function (sg) {
        pdf.setFont(font(sg.f[0], sg.f[1]), "normal");
        pdf.setFontSize(r.size);
        var o = { baseline: "alphabetic" };
        if (r.track) o.charSpace = r.track * r.size / 1000;
        if (mode === "stroke") o.renderingMode = "stroke";
        if (extra && extra.angle) o.angle = extra.angle;
        pdf.text(sg.t, x + dx, y, o);
        dx += T.measure(r.key, sg.t, r.size, r.track || 0);
      });
    }
    return { alpha: alpha, run: run, font: font };
  }

  function pathOf(pdf, cmds, ox, oy) {
    cmds.forEach(function (c) {
      if (c[0] === "M") pdf.moveTo(ox + c[1], oy + c[2]);
      else if (c[0] === "L") pdf.lineTo(ox + c[1], oy + c[2]);
      else if (c[0] === "C") pdf.curveTo(ox + c[1], oy + c[2], ox + c[3], oy + c[4], ox + c[5], oy + c[6]);
      else if (c[0] === "Z") pdf.close();
    });
  }
  function shapeCmds(it) {
    var ax = it.ax;
    return FX.shapePath(ax.shp || "rect", Math.max(0.01, it.w), Math.max(0.01, it.h), { round: ax.rd === undefined ? AX.RD_DEF : ax.rd });
  }
  function dashOf(pdf, it) { pdf.setLineDashPattern(it.dash ? [it.sw * 3, it.sw * 2] : [], 0); }

  function drawShape(pdf, it) {
    var ax = it.ax, fill = !!ax.fc, stroke = !!(ax.sc && it.sw > 0);
    if (fill) pdf.setFillColor.apply(pdf, rgb(ax.fc));
    if (stroke) {
      pdf.setDrawColor.apply(pdf, rgb(ax.sc)); pdf.setLineWidth(it.sw);
      pdf.setLineJoin("round"); dashOf(pdf, it);
    }
    pathOf(pdf, shapeCmds(it), it.x, it.y);
    if (fill && stroke) pdf.fillStroke(); else if (fill) pdf.fill(); else pdf.stroke();
  }
  function head(pdf, x, y, ang, kind, sw) {
    var s = Math.max(6, sw * 3.2), c = Math.cos(ang), n = Math.sin(ang);
    function pt(px, py) { return [x + px * c - py * n, y + px * n + py * c]; }
    if (kind === "dot") { pdf.circle(x, y, s / 2.2, "F"); return; }
    var a = pt(0, 0), b = pt(-s, -s / 1.6), d = pt(-s, s / 1.6);
    pdf.triangle(a[0], a[1], b[0], b[1], d[0], d[1], "F");
  }
  function drawLine(pdf, it) {
    var ax = it.ax, sw = it.sw || 1;
    pdf.setDrawColor.apply(pdf, rgb(ax.sc || "#000000")); pdf.setFillColor.apply(pdf, rgb(ax.sc || "#000000"));
    pdf.setLineWidth(sw); pdf.setLineCap("round"); dashOf(pdf, { dash: it.dash, sw: sw });
    var ang = Math.atan2(it.h, it.w), len = Math.sqrt(it.w * it.w + it.h * it.h), cut = Math.max(6, sw * 3.2) * 0.7;
    var x0 = it.x, y0 = it.y, x1 = it.x + it.w, y1 = it.y + it.h;
    if (ax.as === "arrow" && len > cut) { x0 += Math.cos(ang) * cut; y0 += Math.sin(ang) * cut; }
    if (ax.ae === "arrow" && len > cut) { x1 -= Math.cos(ang) * cut; y1 -= Math.sin(ang) * cut; }
    pdf.line(x0, y0, x1, y1);
    pdf.setLineDashPattern([], 0);
    if (ax.as) head(pdf, it.x, it.y, ang + Math.PI, ax.as, sw);
    if (ax.ae) head(pdf, it.x + it.w, it.y + it.h, ang, ax.ae, sw);
  }
  function drawText(pdf, W, it, opacity) {
    var ax = it.ax, size = ax.size || AX.TEXT_DEF.size;
    var passes = FX.textPasses(ax.tfx, size, ax.fc || "#000000").filter(function (p) { return !(p.blur > 0); });
    var key = AX.fontKeyOf(ax), asc = T.ascent(key, size), desc = T.descent(key, size);
    var curve = ax.cv ? AX.curveLayout(it) : null, lay = curve ? null : AX.textLayout(it);
    passes.forEach(function (p) {
      pdf.saveGraphicsState();
      W.alpha(opacity * p.alpha);
      if (p.mode === "box") {
        if (curve) { pdf.restoreGraphicsState(); return; }
        pdf.setFillColor.apply(pdf, rgb(p.color));
        lay.lines.forEach(function (ln) {
          var x0 = Infinity, x1 = -Infinity;
          ln.runs.forEach(function (r) { if (r.t && r.t.trim()) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); } });
          if (x0 === Infinity) return;
          var bw = x1 - x0 + 2 * p.pad, bh = asc + desc + p.pad * 1.2, rr = Math.max(0, Math.min(p.radius, bw / 2, bh / 2));
          pdf.roundedRect(it.x + x0 - p.pad, it.y + ln.y - asc - p.pad * 0.6, bw, bh, rr, rr, "F");
        });
        pdf.restoreGraphicsState();
        return;
      }
      if (p.mode === "stroke") {
        pdf.setDrawColor.apply(pdf, rgb(p.color)); pdf.setLineWidth(p.width); pdf.setLineJoin("round");
      }
      pdf.setTextColor.apply(pdf, rgb(p.color));
      if (curve) {
        curve.glyphs.forEach(function (g) {
          // the glyph's left end on its baseline, turned about its centre
          var cx = it.x + it.w / 2 + g.x + p.dx, cy = it.y + it.h / 2 + g.y + p.dy;
          var x = cx - Math.cos(g.rot) * g.w / 2, y = cy - Math.sin(g.rot) * g.w / 2;
          W.run({ t: g.ch, key: curve.key, size: curve.size, track: 0 }, x, y, p.mode, { angle: -g.rot * 180 / Math.PI });
        });
      } else {
        lay.lines.forEach(function (ln) {
          ln.runs.forEach(function (r) {
            if (!r.t) return;
            W.run(r, it.x + r.x + p.dx, it.y + r.y + p.dy, p.mode);
            if (r.u && p.mode === "fill") {
              pdf.setFillColor.apply(pdf, rgb(p.color));
              pdf.rect(it.x + r.x + p.dx, it.y + r.y + p.dy + r.size * 0.12, r.w, Math.max(0.3, r.size * 0.05), "F");
            }
          });
        });
      }
      pdf.restoreGraphicsState();
    });
  }
  function drawTable(pdf, W, it) {
    var ax = it.ax, OB = AX.OB, L = AX.tableLayout(it);
    L.cells.forEach(function (c) {
      if (!c.fill) return;
      pdf.setFillColor.apply(pdf, rgb(c.fill));
      pdf.rect(it.x + c.x, it.y + c.y, c.w, c.h, "F");
    });
    L.cells.forEach(function (c) {
      if (!c.lines.length) return;
      pdf.setTextColor.apply(pdf, rgb(c.ink));
      c.lines.forEach(function (ln) { ln.runs.forEach(function (r) { if (r.t) W.run(r, it.x + c.tx + r.x, it.y + c.ty + r.y, "fill"); }); });
    });
    if (it.sw > 0) {
      pdf.setDrawColor.apply(pdf, rgb(ax.sc || OB.RULE)); pdf.setLineWidth(it.sw); pdf.setLineCap("square"); dashOf(pdf, it);
      OB.tableRules(it).forEach(function (l) { pdf.line(it.x + l[0], it.y + l[1], it.x + l[2], it.y + l[3]); });
      pdf.setLineDashPattern([], 0);
    }
  }
  function placePicture(pdf, it, pic, alias) {
    if (!pic) return;
    pdf.addImage(pic.data, pic.fmt, it.x + pic.x, it.y + pic.y, pic.w, pic.h, alias, "FAST");
  }

  // opts: { pages [pageId] (default all), title }
  // deps: { jsPDF, pictures: { itemId: { data, fmt "PNG"|"JPEG",
  //   x, y, w, h (item-local points, unrotated) } }, plan (optional) }
  // Returns the jsPDF document (caller: .output("blob")).
  function build(doc, opts, deps) {
    opts = opts || {}; deps = deps || {};
    var all = M.pagesInOrder(doc), want = {};
    (opts.pages && opts.pages.length ? opts.pages : all.map(function (p) { return p.id; })).forEach(function (id) { want[id] = 1; });
    var pages = all.filter(function (p) { return want[p.id]; });
    if (!pages.length) throw new Error("no pages");
    var P = deps.plan || plan(doc, pages.map(function (p) { return p.id; }));
    var how = {};
    P.forEach(function (p) { how[p.id] = p.kind; });
    var pics = deps.pictures || {};
    var w = doc.setup.w, h = doc.setup.h, orient = w > h ? "l" : "p";
    var pdf = new deps.jsPDF({ unit: "pt", format: [w, h], orientation: orient, compress: true });
    pdf.setProperties({ title: opts.title || doc.name || "", creator: "orOS Atelier" });
    var W = Writer(pdf), n = 0;
    pages.forEach(function (pg, pi) {
      if (pi > 0) pdf.addPage([w, h], orient);
      pageItems(doc, pg.id).forEach(function (it) {
        var kind = how[it.id];
        if (!kind) return;
        var op = (it.op === undefined ? 100 : it.op) / 100;
        pdf.saveGraphicsState();
        if (it.t !== "line" && it.rot) rotateAbout(pdf, it.rot, it.x + it.w / 2, it.y + it.h / 2);
        if (kind === "text" || kind === "textfx") {
          if (kind === "textfx") { pdf.saveGraphicsState(); W.alpha(op); placePicture(pdf, it, pics[it.id], "p" + (n++)); pdf.restoreGraphicsState(); }
          drawText(pdf, W, it, op);
        } else {
          W.alpha(op);
          if (kind === "photo") {
            var pic = pics[it.id];
            if (pic) {
              pathOf(pdf, it.ax.shp ? shapeCmds(it) : FX.shapePath("rect", it.w, it.h, {}), it.x, it.y);
              pdf.clip(); pdf.discardPath();
              placePicture(pdf, it, pic, "p" + (n++));
            }
          } else if (kind === "raster") placePicture(pdf, it, pics[it.id], "p" + (n++));
          else if (it.ax.k === "shape") drawShape(pdf, it);
          else if (it.ax.k === "line") drawLine(pdf, it);
          else if (it.ax.k === "table") drawTable(pdf, W, it);
        }
        pdf.restoreGraphicsState();
      });
    });
    return pdf;
  }

  var api = { plan: plan, kindOf: kindOf, needsPicture: needsPicture, build: build, faceFor: faceFor, coversRuns: coversRuns };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierPDF = api;
})(typeof window !== "undefined" ? window : this);
