// ============================================================
// orOS Mockups — print.js (MockPrint, v1.3.0)
// The cover sheet for the printer, drawn on a 2D canvas from
// MockCore.template(): the cover itself (the full-wrap picture, or
// front / back / spine / flap pictures put together, running into
// the bleed) and the guides (bleed or hardcover wrap tinted, trim
// line, folds, hinges, safe zones, barcode spot, the name and width
// of every panel; a spiral binding's two covers are trimmed apart,
// with the strip of the holes shown). Products (v1.2.0): a part may
// take another slot's picture (part.a), spine text goes on every part
// marked txt, and a disc label is a round sheet (T.circle: print
// ring, hub, hole). Cut sheets (v1.3.0, goods/small.js): T.cut is a
// round, rectangle or die line (the picture's outline, MockSmall),
// with holes; the PDF carries the cut as a vector line. The same drawing feeds the live preview of the
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
    // spiral: the two covers share the bleed between them
    if (out.gap) {
      if (out.back && out.front) out.back[1] = out.front[0] = (out.gap[0] + out.gap[1]) / 2;
      delete out.gap;
    }
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
    if (T.circle) { drawDisc(ctx, T, art, pics, ppm); return; }
    if (T.cut && T.cut.shape === "die") { drawDie(ctx, T, art, pics, ppm); return; }
    var sp = spans(T), alias = {};
    T.parts.forEach(function (p) { if (typeof p.a === "string") alias[p.k] = p.a; });
    Object.keys(sp).forEach(function (k) {
      var x = sp[k][0] * ppm, w = (sp[k][1] - sp[k][0]) * ppm, im = pics[k in alias ? alias[k] : k];
      if (im) { ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, sh); ctx.clip(); coverFit(ctx, im, x, 0, w, sh); ctx.restore(); return; }
      if (k === "flapB" || k === "flapF") { ctx.fillStyle = shade(art.c, 0.08); ctx.fillRect(x, 0, w, sh); }
    });
    T.parts.filter(function (p) { return p.k === "spine" || p.txt; }).forEach(function (spine) {
      if (pics.spine || !art.spT) return;
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
    });
  }
  // A disc label: the picture in the print ring (outer print Ø to
  // the hub), the disc's colour where there is none.
  function drawDisc(ctx, T, art, pics, ppm) {
    var c = T.circle, cx = c.c * ppm, sw = T.sheet.w * ppm;
    ctx.clearRect(0, 0, sw, sw);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, c.print / 2 * ppm, 0, Math.PI * 2);
    ctx.arc(cx, cx, c.hub / 2 * ppm, 0, Math.PI * 2, true);
    ctx.clip("evenodd");
    ctx.fillStyle = art.c; ctx.fillRect(0, 0, sw, sw);
    var im = pics[T.parts[0] && T.parts[0].a || "disc"];
    if (im) coverFit(ctx, im, 0, 0, sw, sw);
    ctx.restore();
  }

  // ---------- Cut sheets (stickers, keychains, pins, magnets) ----------
  // The cut of a sheet in trim mm: { path: [[x, y]…], img: where the
  // picture goes (die cut), holes, warn } or null. A die cut follows
  // the picture's see-through edge, grown by cut.off (MockSmall).
  var dieCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function dieFit(img, box, off) {
    var SM = root.MockSmall, key = [box.x, box.y, box.w, box.h, off].join(",");
    if (!SM || !img) return null;
    var hit = dieCache && dieCache.get(img);
    if (hit && hit[key]) return hit[key];
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    var sc = Math.min(1, 320 / Math.max(iw, ih)), w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
    var cv = canvas(w, h), cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0, w, h);
    var px = cx.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) a[i] = px[i * 4 + 3];
    var bb = SM.alphaBox(a, w, h), warn = [];
    if (!bb) return null;
    if (bb.x0 === 0 && bb.y0 === 0 && bb.x1 === w - 1 && bb.y1 === h - 1) warn.push("dieOpaque");
    var cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    var mpp = Math.min((box.w - 2 * off) / cw, (box.h - 2 * off) / ch), offPx = off / mpp, pad = Math.ceil(offPx) + 2;
    var GW = cw + 2 * pad, GH = ch + 2 * pad, ga = new Uint8Array(GW * GH);
    for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) ga[(y + pad) * GW + x + pad] = a[(y + bb.y0) * w + x + bb.x0];
    var r = SM.dieOutline(ga, GW, GH, offPx);
    if (!r) return null;
    if (r.parts > 1) warn.push("dieParts");
    var x0 = box.x + (box.w - cw * mpp) / 2, y0 = box.y + (box.h - ch * mpp) / 2;
    var out = {
      path: r.path.map(function (q) { return [x0 + (q[0] - pad + 0.5) * mpp, y0 + (q[1] - pad + 0.5) * mpp]; }),
      img: { x: x0 - bb.x0 * mpp, y: y0 - bb.y0 * mpp, w: w * mpp, h: h * mpp }, warn: warn
    };
    if (dieCache) { hit = hit || {}; hit[key] = out; dieCache.set(img, hit); }
    return out;
  }
  function cutOf(T, pics) {
    var c = T.cut, SM = root.MockSmall;
    if (!c || !SM) return null;
    var holes = (T.holes || []).map(function (h) { return Object.assign({}, h); }), res;
    if (c.shape === "round") res = { path: SM.circlePath(T.W / 2, T.H / 2, Math.min(T.W, T.H) / 2), img: null, warn: [] };
    else if (c.shape === "rect") res = { path: SM.rectPath(0, 0, T.W, T.H, c.r), img: null, warn: [] };
    else {
      var top = c.top || 0, im = pics && pics[c.from || T.parts[0].a];
      res = im ? dieFit(im, { x: 0, y: top, w: T.W, h: T.H - top }, c.off) : null;
      if (!res) res = { path: SM.rectPath(c.off, top + c.off, T.W - 2 * c.off, T.H - top - 2 * c.off, 3), img: null, warn: im ? [] : ["dieNoPic"] };
      // the hole tab sits on the outline's top in the middle
      holes.forEach(function (h) {
        if (!h.tab) return;
        var y = SM.topAt(res.path, h.x);
        h.y = Math.max(h.tab / 2, (y == null ? top : y) - h.tab / 2 + 2.5);
      });
    }
    if (c.mirror) {
      res = { path: res.path.map(function (q) { return [T.W - q[0], q[1]]; }), img: null, warn: res.warn };
      holes.forEach(function (h) { h.x = T.W - h.x; });
    }
    res.holes = holes;
    return res;
  }
  function pathOn(ctx, path, ppm, ox) {
    ctx.beginPath();
    path.forEach(function (q, i) { ctx[i ? "lineTo" : "moveTo"](ox + q[0] * ppm, ox + q[1] * ppm); });
    ctx.closePath();
  }
  // A die-cut sheet: see-through outside, the edge colour (white
  // vinyl) inside the cut and into the bleed, the whole picture on it.
  function drawDie(ctx, T, art, pics, ppm) {
    var R = cutOf(T, pics), bl = T.bleed * ppm, im = pics[T.parts[0].a];
    ctx.clearRect(0, 0, T.sheet.w * ppm, T.sheet.h * ppm);
    if (!R) return;
    ctx.save();
    ctx.fillStyle = T.cut.edge || "rgba(0,0,0,0)";
    ctx.strokeStyle = ctx.fillStyle;
    pathOn(ctx, R.path, ppm, bl);
    if (T.cut.edge) { ctx.fill(); if (bl) { ctx.lineWidth = bl * 2; ctx.lineJoin = "round"; ctx.stroke(); } }
    R.holes.forEach(function (h) {
      if (!h.tab || !T.cut.edge) return;
      ctx.beginPath(); ctx.arc(bl + h.x * ppm, bl + h.y * ppm, (h.tab / 2 + T.bleed) * ppm, 0, Math.PI * 2); ctx.fill();
    });
    if (im) {
      if (R.img) ctx.drawImage(im, bl + R.img.x * ppm, bl + R.img.y * ppm, R.img.w * ppm, R.img.h * ppm);
      else { pathOn(ctx, R.path, ppm, bl); ctx.clip(); coverFit(ctx, im, bl, bl, T.W * ppm, T.H * ppm); }
    }
    ctx.restore();
  }
  // The guides of a cut sheet: cut away tinted, the cut line, the
  // holes, a band inside the cut to keep text out of.
  function cutGuides(ctx, T, ppm, L, lw, fs, pics) {
    var R = cutOf(T, pics || {}), bl = T.bleed * ppm, sw = T.sheet.w * ppm, sh = T.sheet.h * ppm;
    if (!R) return;
    ctx.save();
    // what is cut away, tinted (a layer, so the tab and the outline add up)
    var lay = canvas(sw, sh), lx = lay.getContext("2d");
    lx.fillStyle = COL.bleed; lx.fillRect(0, 0, sw, sh);
    lx.globalCompositeOperation = "destination-out";
    pathOn(lx, R.path, ppm, bl); lx.fill();
    R.holes.forEach(function (h) { if (h.tab) { lx.beginPath(); lx.arc(bl + h.x * ppm, bl + h.y * ppm, h.tab / 2 * ppm, 0, Math.PI * 2); lx.fill(); } });
    ctx.drawImage(lay, 0, 0);
    ctx.save();
    pathOn(ctx, R.path, ppm, bl); ctx.clip();
    ctx.strokeStyle = COL.safe; ctx.globalAlpha = 0.35; ctx.lineWidth = 2 * Math.max(0.5, Math.min(T.safeMm || 2, 3)) * ppm; ctx.lineJoin = "round";
    pathOn(ctx, R.path, ppm, bl); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = COL.trim; ctx.lineWidth = lw * 1.4;
    pathOn(ctx, R.path, ppm, bl); ctx.stroke();
    R.holes.forEach(function (h) {
      ctx.beginPath(); ctx.arc(bl + h.x * ppm, bl + h.y * ppm, h.d / 2 * ppm, 0, Math.PI * 2); ctx.stroke();
      if (h.tab) { ctx.beginPath(); ctx.arc(bl + h.x * ppm, bl + h.y * ppm, h.tab / 2 * ppm, Math.PI, 0); ctx.stroke(); }
    });
    label(ctx, L.name(T.parts[0].k), sw / 2, bl + Math.max(fs * 1.4, T.H * ppm * 0.12), fs * 1.2, COL.fold, T.W * ppm * 0.8);
    label(ctx, L.len(T.W) + " × " + L.len(T.H), sw / 2, sh - bl - fs * 1.2, fs, COL.fold, T.W * ppm * 0.9);
    if (L.info) label(ctx, L.info, sw / 2, sh - bl / 2 - fs * 0.2, fs * 0.8, COL.trim, sw * 0.95);
    ctx.restore();
  }

  var COL = { bleed: "rgba(226, 46, 46, 0.30)", trim: "#d81e1e", fold: "#1769d6", hinge: "#8a3fd1", safe: "#11905a", bar: "#1d2330", punch: "rgba(23, 105, 214, 0.16)" };

  // The guides. L: { name(k), len(mm) → "148 mm", bar, info }
  function drawGuides(ctx, T, ppm, L, pics) {
    var bl = T.bleed * ppm, W = T.W * ppm, H = T.H * ppm, sw = T.sheet.w * ppm, sh = T.sheet.h * ppm;
    var lw = Math.max(1, ppm * 0.3), fs = Math.max(9, ppm * 3.2);
    if (T.circle || T.cut) fs = Math.max(7, Math.min(fs, Math.min(T.W, T.H) * ppm * 0.055));   // small sheets: smaller names
    if (T.circle) { discGuides(ctx, T, ppm, L, lw, fs); return; }
    if (T.cut) { cutGuides(ctx, T, ppm, L, lw, fs, pics); return; }
    var trims = T.trims && T.trims.length ? T.trims : [{ x: 0, w: T.W }];
    ctx.save();
    // bleed (paperback, jacket) or wrap round the boards (case)
    ctx.fillStyle = COL.bleed;
    ctx.beginPath(); ctx.rect(0, 0, sw, sh);
    trims.forEach(function (r) { ctx.rect(bl + r.x * ppm, bl, r.w * ppm, H); });
    ctx.fill("evenodd");
    // spiral: the strip of the holes (keep it clear)
    (T.punch || []).forEach(function (r) {
      ctx.fillStyle = COL.punch; ctx.fillRect(bl + r.x * ppm, bl + r.y * ppm, r.w * ppm, r.h * ppm);
      ctx.fillStyle = "rgba(23, 105, 214, 0.55)";
      var cx = bl + (r.x + (r.x < T.W / 2 ? r.w - 5 : 5)) * ppm;
      for (var y = 6; y < r.h - 3; y += 8.47) { ctx.beginPath(); ctx.arc(cx, bl + (r.y + y) * ppm, 1.6 * ppm, 0, Math.PI * 2); ctx.fill(); }
    });
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
    trims.forEach(function (r) { ctx.strokeRect(bl + r.x * ppm, bl, r.w * ppm, H); });
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
      if (p.k === "gap") return;
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
  // A disc label: outside the print ring and inside the hub tinted,
  // the print edge and the hole as trim lines, the safe ring dashed.
  function discGuides(ctx, T, ppm, L, lw, fs) {
    var c = T.circle, cx = c.c * ppm, sw = T.sheet.w * ppm;
    function ring(d) { ctx.beginPath(); ctx.arc(cx, cx, d / 2 * ppm, 0, Math.PI * 2); }
    ctx.save();
    ctx.fillStyle = COL.bleed;
    ctx.beginPath(); ctx.rect(0, 0, sw, sw);
    ctx.arc(cx, cx, c.print / 2 * ppm, 0, Math.PI * 2, true);
    ctx.fill();
    ring(c.hub); ctx.fill();
    ctx.strokeStyle = COL.trim; ctx.lineWidth = lw * 1.4;
    ring(c.print); ctx.stroke();
    ring(c.hole); ctx.stroke();
    ctx.strokeStyle = COL.fold; ctx.lineWidth = lw; ctx.setLineDash([lw * 6, lw * 3]);
    ring(T.W); ctx.stroke();
    if (c.fold) { ctx.strokeStyle = COL.hinge; ring(c.fold); ctx.stroke(); ctx.strokeStyle = COL.safe; }
    ctx.strokeStyle = COL.safe; ctx.setLineDash([lw * 4, lw * 3]);
    ring(c.safeOut); ctx.stroke();
    ring(c.safeIn); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, L.name(T.parts[0] ? T.parts[0].k : "disc"), cx, cx - (c.safeIn / 2 + (c.safeOut - c.safeIn) / 4) * ppm, fs * 1.3, COL.fold, (c.safeOut - c.safeIn) / 2 * ppm);
    label(ctx, "Ø " + L.len(c.print) + " · " + L.len(c.hub), cx, cx + (c.safeIn / 2 + (c.safeOut - c.safeIn) / 4) * ppm, fs, COL.fold, c.safeOut * 0.6 * ppm);
    if (L.info) label(ctx, L.info, cx, sw - fs * 1.2, fs * 0.85, COL.trim, sw * 0.6);
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
    if (o.white) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (o.art) {
      if ((T.circle || T.cut) && o.white) { var lay = canvas(cv.width, cv.height); drawArt(lay.getContext("2d"), T, art, pics || {}, ppm); ctx.drawImage(lay, 0, 0); }
      else drawArt(ctx, T, art, pics || {}, ppm);
    }
    if (o.guides) drawGuides(ctx, T, ppm, o.L || { name: String, len: String }, pics);
    if (T.cut) cv.cut = cutOf(T, pics || {});
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
    // the cut line as a vector path (100 % magenta, hairline), the
    // way cutting plotters and sticker printers read it
    var cut = cv.cut;
    if (cut && cut.path && cut.path.length > 2 && typeof doc.lines === "function") {
      doc.setDrawColor(236, 0, 140); doc.setLineWidth(0.25);
      var P = cut.path.map(function (q) { return [b + q[0] * PT, b + q[1] * PT]; }), seg = [];
      for (var i = 1; i < P.length; i++) seg.push([P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]]);
      doc.lines(seg, P[0][0], P[0][1], [1, 1], "S", true);
      (cut.holes || []).forEach(function (h) { doc.circle(b + h.x * PT, b + h.y * PT, h.d / 2 * PT, "S"); });
    }
    return doc;
  }

  root.MockPrint = { VERSION: "1.3.0", cutOf: cutOf, ppmFor: ppmFor, spans: spans, drawArt: drawArt, drawGuides: drawGuides, render: render, pdf: pdf, COL: COL };
})(typeof window !== "undefined" ? window : globalThis);
