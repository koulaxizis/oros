// ============================================================
// orOS Mockups — print.js (MockPrint, v1.0.0)
// The cover sheet for the printer, drawn on a 2D canvas from
// MockCore.template(): the cover itself (the full-wrap picture, or
// front / back / spine / flap pictures put together, running into
// the bleed) and the guides (bleed or hardcover wrap tinted, trim
// line, folds, hinges, safe zones, barcode spot, the name and width
// of every panel). The same drawing feeds the live preview of the
// Print tab, the PNG, the PDF and the new Atelier design.
// No three.js; loaded with the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_SIDE = 16000;                // canvas limits of the browsers
  var MAX_AREA = 60e6;

  function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function coverFit(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih || w <= 0 || h <= 0) return;
    var s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }
  // #rrggbb a little lighter (k > 0) or darker (k < 0)
  function shade(hex, k) {
    var n = parseInt(String(hex || "#808080").slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
    c = c.map(function (v) { return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); });
    return "#" + c.map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
  }

  // Pixels per mm for a dpi, kept inside the canvas limits.
  function ppmFor(T, dpi) {
    var p = (dpi || 300) / 25.4, w = T.sheet.w, h = T.sheet.h;
    p = Math.min(p, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
    return p;
  }

  // Sheet x-span (mm, bleed included) of each picture of a parts
  // cover: the outer panels run into the bleed; a hardcover's hinges
  // go with the boards.
  function spans(T) {
    var bl = T.bleed, n = T.parts.length, out = {};
    T.parts.forEach(function (p, i) {
      var x0 = i === 0 ? 0 : bl + p.x, x1 = i === n - 1 ? T.sheet.w : bl + p.x + p.w;
      var k = p.k === "hingeB" ? "back" : p.k === "hingeF" ? "front" : p.k;
      if (out[k]) { out[k][0] = Math.min(out[k][0], x0); out[k][1] = Math.max(out[k][1], x1); }
      else out[k] = [x0, x1];
    });
    return out;
  }

  // The cover. art: MockCore.normArt; pics: slot → picture.
  function drawArt(ctx, T, art, pics, ppm) {
    var sw = T.sheet.w * ppm, sh = T.sheet.h * ppm;
    ctx.fillStyle = art.c; ctx.fillRect(0, 0, sw, sh);
    if (art.mode === "wrap") {
      if (pics.wrap) ctx.drawImage(pics.wrap, 0, 0, sw, sh);
      return;
    }
    var sp = spans(T);
    Object.keys(sp).forEach(function (k) {
      var x = sp[k][0] * ppm, w = (sp[k][1] - sp[k][0]) * ppm, im = pics[k];
      if (im) { ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, sh); ctx.clip(); coverFit(ctx, im, x, 0, w, sh); ctx.restore(); return; }
      if (k === "flapB" || k === "flapF") { ctx.fillStyle = shade(art.c, 0.08); ctx.fillRect(x, 0, w, sh); }
    });
    var spine = T.parts.filter(function (p) { return p.k === "spine"; })[0];
    if (spine && !pics.spine && art.spT) {
      var w = spine.w * ppm, H = T.H * ppm;
      ctx.save();
      ctx.translate((T.bleed + spine.x + spine.w / 2) * ppm, (T.bleed + T.H / 2) * ppm);
      ctx.rotate(Math.PI / 2);                 // reads top → bottom
      var fs = Math.max(4, Math.min(w * 0.55, H * 0.05));
      ctx.font = "700 " + fs + "px Nunito, 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = art.spTC; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var txt = art.spT;
      while (txt.length > 1 && ctx.measureText(txt).width > H * 0.86) txt = txt.slice(0, -1);
      if (txt !== art.spT) txt = txt.slice(0, -1) + "…";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  }

  var COL = { bleed: "rgba(226, 46, 46, 0.30)", trim: "#d81e1e", fold: "#1769d6", hinge: "#8a3fd1", safe: "#11905a", bar: "#1d2330" };

  // The guides. L: { name(k), len(mm) → "148 mm", bar, info }
  function drawGuides(ctx, T, ppm, L) {
    var bl = T.bleed * ppm, W = T.W * ppm, H = T.H * ppm, sw = T.sheet.w * ppm, sh = T.sheet.h * ppm;
    var lw = Math.max(1, ppm * 0.3), fs = Math.max(9, ppm * 3.2);
    ctx.save();
    // bleed (paperback, jacket) or wrap round the boards (case)
    ctx.fillStyle = COL.bleed;
    ctx.beginPath(); ctx.rect(0, 0, sw, sh); ctx.rect(bl, bl, W, H); ctx.fill("evenodd");
    // safe zones
    ctx.strokeStyle = COL.safe; ctx.lineWidth = lw; ctx.setLineDash([lw * 4, lw * 3]);
    T.safe.forEach(function (r) { ctx.strokeRect(bl + r.x * ppm, bl + r.y * ppm, r.w * ppm, r.h * ppm); });
    // folds and hinges, over the whole sheet
    T.folds.forEach(function (f) {
      ctx.strokeStyle = f.k === "hinge" ? COL.hinge : COL.fold;
      ctx.setLineDash(f.k === "hinge" ? [lw * 2, lw * 2] : [lw * 6, lw * 3]);
      var x = bl + f.x * ppm;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sh); ctx.stroke();
    });
    // trim
    ctx.setLineDash([]); ctx.strokeStyle = COL.trim; ctx.lineWidth = lw * 1.4;
    ctx.strokeRect(bl, bl, W, H);
    // barcode spot
    if (T.bar) {
      var b = T.bar, bx = bl + b.x * ppm, by = bl + b.y * ppm, bw = b.w * ppm, bh = b.h * ppm;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = COL.bar; ctx.lineWidth = lw; ctx.strokeRect(bx, by, bw, bh);
      label(ctx, L.bar, bx + bw / 2, by + bh / 2 - fs * 0.6, fs * 0.9, COL.bar, bw * 0.9);
      label(ctx, L.len(b.w) + " × " + L.len(b.h), bx + bw / 2, by + bh / 2 + fs * 0.6, fs * 0.8, COL.bar, bw * 0.9);
    }
    // panel names and widths, near the top (away from the middle,
    // where titles and spine text usually go)
    var top = bl + Math.max(fs * 1.4, Math.min(H * 0.12, (T.safe.length ? T.safe[0].y * ppm : 0) + fs * 1.6));
    T.parts.forEach(function (p) {
      var cx = bl + (p.x + p.w / 2) * ppm, w = p.w * ppm;
      if (/^hinge/.test(p.k) || p.k === "spine") {
        var f2 = Math.min(fs, w * 0.5);
        ctx.save();
        ctx.translate(cx, top - fs * 0.6); ctx.rotate(Math.PI / 2);
        label(ctx, L.name(p.k) + " · " + L.len(p.w), 0, 0, f2, /^hinge/.test(p.k) ? COL.hinge : COL.fold, H * 0.4, "left");
        ctx.restore();
        return;
      }
      label(ctx, L.name(p.k), cx, top, fs * 1.3, COL.fold, w * 0.85);
      label(ctx, L.len(p.w) + " × " + L.len(T.H), cx, top + fs * 1.5, fs, COL.fold, w * 0.85);
    });
    // what the sheet is: in the wrap of a case, else just above the bottom trim
    if (L.info) label(ctx, L.info, bl + W / 2, T.bleed >= 6 ? sh - bl / 2 : bl + H - fs * 0.9, fs * 0.85, COL.trim, W * 0.95);
    ctx.restore();
  }
  // Text with a white halo, kept inside maxW; centred unless align.
  function label(ctx, txt, x, y, size, color, maxW, align) {
    if (!txt) return;
    ctx.save();
    ctx.font = "700 " + size + "px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
    var t = String(txt);
    while (t.length > 2 && maxW && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + "…";
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, size * 0.28); ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color; ctx.fillText(t, x, y);
    ctx.restore();
  }

  // The whole sheet → canvas. o: { art (bool), guides (bool), L,
  // white (paper under no cover; else see-through) }
  function render(T, art, pics, ppm, o) {
    o = o || {};
    var cv = canvas(T.sheet.w * ppm, T.sheet.h * ppm), ctx = cv.getContext("2d");
    if (o.art) drawArt(ctx, T, art, pics || {}, ppm);
    else if (o.white) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (o.guides) drawGuides(ctx, T, ppm, o.L || { name: String, len: String });
    return cv;
  }

  // A one-page PDF of the sheet (the canvas as a picture), with its
  // TrimBox and BleedBox so print shops see the trim. jsPDF: the
  // vendored vendor/jspdf.umd.min.js constructor.
  function pdf(JsPDF, cv, T, title) {
    var PT = 72 / 25.4, W = T.sheet.w * PT, H = T.sheet.h * PT, b = T.bleed * PT;
    var doc = new JsPDF({ unit: "pt", format: [W, H], orientation: W > H ? "l" : "p", compress: true });
    doc.setProperties({ title: title || "Cover", creator: "orOS Mockups" });
    doc.addImage(cv.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W, H);
    var info = doc.internal.getCurrentPageInfo().pageContext;
    var box = function (x0, y0, x1, y1) { return { bottomLeftX: x0, bottomLeftY: y0, topRightX: x1, topRightY: y1 }; };
    info.trimBox = box(b, b, W - b, H - b);
    info.bleedBox = box(0, 0, W, H);
    return doc;
  }

  root.MockPrint = { VERSION: "1.0.0", ppmFor: ppmFor, spans: spans, drawArt: drawArt, drawGuides: drawGuides, render: render, pdf: pdf, COL: COL };
})(typeof window !== "undefined" ? window : globalThis);
