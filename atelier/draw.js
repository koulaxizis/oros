// ============================================================
// orOS Atelier — drawing (v1.0.0)
// Draws a design page on a 2D canvas: the editor, thumbnails and the
// PNG / JPG / PDF exports all go through drawPage(), so what you see
// is what you export. Geometry and text layout come from
// designkit (render.imageRect, text.js via atelier/ax.js); looks from
// designkit/fx.js (shapes, text effects, curved text, photo
// adjustments + filters).
// Coordinates: the caller sets a transform where 1 unit = 1 pt and
// (0, 0) = the page's top-left corner.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, DK = window.orosDK;
  var FX = DK.fx, T = DK.text, R = DK.render, A = DK.assets, M = DK.model;
  var AX = window.AtelierAX, ICONS = window.ATELIER_ICONS;

  function rad(d) { return d * Math.PI / 180; }

  // ---------- Small caches ----------
  function lru(max) {
    var map = new Map();
    return {
      get: function (k) { if (!map.has(k)) return undefined; var v = map.get(k); map.delete(k); map.set(k, v); return v; },
      set: function (k, v) { map.set(k, v); if (map.size > max) map.delete(map.keys().next().value); return v; },
      clear: function () { map.clear(); }
    };
  }
  var shapeCache = lru(300), textCache = lru(400), photoCache = lru(24);

  var iconById = {};
  ICONS.list.forEach(function (e) { iconById[e[0]] = e; });
  var iconPathCache = {};
  function iconPaths(id) {
    if (iconPathCache[id]) return iconPathCache[id];
    var e = iconById[id];
    if (!e) return null;
    iconPathCache[id] = e[4].map(function (d) { return new Path2D(d); });
    return iconPathCache[id];
  }

  function shapePath(shp, w, h, rd) {
    var key = shp + "|" + w + "|" + h + "|" + rd;
    var p = shapeCache.get(key);
    if (p) return p;
    var cmds = FX.shapePath(shp || "rect", Math.max(0.01, w), Math.max(0.01, h), { round: rd });
    return shapeCache.set(key, new Path2D(FX.toSvgPath(cmds) || "M0 0"));
  }
  function itemShape(it) {
    var ax = it.ax || {};
    return shapePath(ax.shp || "rect", it.w, it.h, ax.rd === undefined ? AX.RD_DEF : ax.rd);
  }

  // Text layout per (item size + text fields).
  function textLines(it) {
    var key = it.w + "|" + JSON.stringify(it.ax);
    var v = textCache.get(key);
    if (v) return v;
    return textCache.set(key, it.ax.cv ? { curve: AX.curveLayout(it) } : AX.textLayout(it));
  }

  // ---------- Fills ----------
  function gradient(ctx, it, g) {
    var a = rad(g.ang - 90), cx = it.w / 2, cy = it.h / 2;
    var len = Math.abs(it.w * Math.cos(a)) / 2 + Math.abs(it.h * Math.sin(a)) / 2;
    var dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    var gr = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gr.addColorStop(0, g.a); gr.addColorStop(1, g.b);
    return gr;
  }

  // ---------- Photos ----------
  // The pixels of a photo with its filter + adjustments, cached per
  // (image, look, size). maxSide caps the work while editing; exports
  // pass 0 (full resolution).
  function lookOf(ax) {
    var f = ax.flt ? FX.filterById(ax.flt) : null;
    var p = f ? f.p : FX.normAdjust({});
    if (ax.adj) Object.keys(ax.adj).forEach(function (k) { p[k] = (p[k] || 0) + ax.adj[k]; });
    return FX.normAdjust(p);
  }
  function photoSource(it, maxSide) {
    var img = A.get(it.a);
    if (!img) return null;
    var look = lookOf(it.ax || {});
    if (FX.isIdentity(look)) return img;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var s = maxSide ? Math.min(1, maxSide / Math.max(iw, ih)) : 1;
    var w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    var key = it.a + "|" + w + "|" + JSON.stringify(look);
    var c = photoCache.get(key);
    if (c) return c;
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    FX.applyToCanvas(cv, look);
    return photoCache.set(key, cv);
  }

  function drawPhoto(ctx, it, opts) {
    var ax = it.ax || {};
    ctx.save();
    if (ax.shp) ctx.clip(itemShape(it));
    else { ctx.beginPath(); ctx.rect(0, 0, it.w, it.h); ctx.clip(); }
    var src = it.a ? photoSource(it, opts.maxSide) : null;
    if (src) {
      var r = R.imageRect(it);
      if (ax.flh || ax.flv) {
        ctx.translate(it.w / 2, it.h / 2);
        ctx.scale(ax.flh ? -1 : 1, ax.flv ? -1 : 1);
        ctx.translate(-it.w / 2, -it.h / 2);
      }
      ctx.drawImage(src, r.x, r.y, r.w, r.h);
    } else if (!opts.clean) {
      ctx.fillStyle = "rgba(128,128,128,0.25)";
      ctx.fillRect(0, 0, it.w, it.h);
      var p = iconPaths("photo");
      if (p) {
        var s = Math.min(it.w, it.h) / 24 * 0.4;
        ctx.translate(it.w / 2 - 12 * s, it.h / 2 - 12 * s);
        ctx.scale(s, s);
        ctx.strokeStyle = "rgba(128,128,128,0.9)";
        ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
        p.forEach(function (q) { ctx.stroke(q); });
      }
    }
    ctx.restore();
  }

  // ---------- Text ----------
  function scaleOf(ctx) {
    var m = ctx.getTransform();
    return Math.sqrt(m.a * m.a + m.b * m.b) || 1;
  }
  // Device-space vector of a local offset (shadows ignore the CTM).
  function devOffset(ctx, dx, dy) {
    var m = ctx.getTransform();
    return { x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy };
  }

  function eachRun(lay, fn) {
    lay.lines.forEach(function (ln) { ln.runs.forEach(function (r) { if (r.t) fn(r, ln); }); });
  }
  function paintRun(ctx, r, mode, dx, dy) {
    ctx.font = r.size + "px " + T.cssFamily(r.key);
    var draw = mode === "stroke" ? ctx.strokeText.bind(ctx) : ctx.fillText.bind(ctx);
    if (r.track) {
      var x = r.x;
      for (var i = 0; i < r.t.length; i++) {
        var ch = r.t[i];
        draw(ch, x + dx, r.y + dy);
        x += T.measure(r.key, ch, r.size, r.track);
      }
    } else draw(r.t, r.x + dx, r.y + dy);
    if (r.u && mode === "fill") ctx.fillRect(r.x + dx, r.y + dy + r.size * 0.12, r.w, Math.max(0.3, r.size * 0.05));
  }
  function paintCurve(ctx, cl, it, mode, dx, dy) {
    ctx.font = cl.size + "px " + T.cssFamily(cl.key);
    cl.glyphs.forEach(function (g) {
      ctx.save();
      ctx.translate(it.w / 2 + g.x + dx, it.h / 2 + g.y + dy);
      ctx.rotate(g.rot);
      if (mode === "stroke") ctx.strokeText(g.ch, -g.w / 2, 0);
      else ctx.fillText(g.ch, -g.w / 2, 0);
      ctx.restore();
    });
  }

  function drawText(ctx, it) {
    var ax = it.ax || {};
    var lay = textLines(it);
    var fill = ax.fc || "#000000";
    var passes = FX.textPasses(ax.tfx, ax.size || AX.TEXT_DEF.size, fill);
    var key = AX.fontKeyOf(ax), size = ax.size || AX.TEXT_DEF.size;
    var asc = T.ascent(key, size), desc = T.descent(key, size);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    try { ctx.fontKerning = "none"; } catch (e) {}
    var k = scaleOf(ctx);
    passes.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha *= p.alpha;
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      if (p.mode === "box") {
        if (lay.curve) { ctx.restore(); return; }
        lay.lines.forEach(function (ln) {
          var x0 = Infinity, x1 = -Infinity;
          ln.runs.forEach(function (r) { if (r.t && r.t.trim()) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); } });
          if (x0 === Infinity) return;
          R.roundRectPath(ctx, x0 - p.pad, ln.y - asc - p.pad * 0.6, x1 - x0 + 2 * p.pad, asc + desc + p.pad * 1.2, p.radius);
          ctx.fill();
        });
        ctx.restore();
        return;
      }
      var dx = p.dx, dy = p.dy;
      if (p.blur > 0) {
        var o = devOffset(ctx, dx, dy);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.blur * k;
        ctx.shadowOffsetX = o.x; ctx.shadowOffsetY = o.y;
        dx = 0; dy = 0;
      }
      if (p.mode === "stroke") { ctx.lineWidth = p.width; ctx.lineJoin = "round"; ctx.miterLimit = 2; }
      if (lay.curve) paintCurve(ctx, lay.curve, it, p.mode, dx, dy);
      else eachRun(lay, function (r) { paintRun(ctx, r, p.mode, dx, dy); });
      ctx.restore();
    });
  }

  // ---------- Lines ----------
  function head(ctx, x, y, ang, kind, sw) {
    var s = Math.max(6, sw * 3.2);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    if (kind === "dot") ctx.arc(0, 0, s / 2.2, 0, Math.PI * 2);
    else { ctx.moveTo(0, 0); ctx.lineTo(-s, -s / 1.6); ctx.lineTo(-s, s / 1.6); ctx.closePath(); }
    ctx.fill();
    ctx.restore();
  }
  function drawLine(ctx, it) {
    var ax = it.ax || {}, sw = it.sw || 1;
    ctx.strokeStyle = ax.sc || "#000000"; ctx.fillStyle = ax.sc || "#000000";
    ctx.lineWidth = sw; ctx.lineCap = "round";
    ctx.setLineDash(it.dash ? [sw * 3, sw * 2] : []);
    var ang = Math.atan2(it.h, it.w), len = Math.sqrt(it.w * it.w + it.h * it.h);
    var cut = Math.max(6, sw * 3.2) * 0.7;
    var x0 = 0, y0 = 0, x1 = it.w, y1 = it.h;
    if (ax.as === "arrow" && len > cut) { x0 += Math.cos(ang) * cut; y0 += Math.sin(ang) * cut; }
    if (ax.ae === "arrow" && len > cut) { x1 -= Math.cos(ang) * cut; y1 -= Math.sin(ang) * cut; }
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    if (ax.as) head(ctx, 0, 0, ang + Math.PI, ax.as, sw);
    if (ax.ae) head(ctx, it.w, it.h, ang, ax.ae, sw);
  }

  // ---------- One item ----------
  // opts: { maxSide (photo work size, 0 = full), clean (no
  // placeholders: exports, thumbnails) }
  function drawItem(ctx, doc, it, opts) {
    var ax = it.ax;
    if (!ax || it.hide) return;
    opts = opts || {};
    ctx.save();
    ctx.globalAlpha = (it.op === undefined ? 100 : it.op) / 100;
    if (it.t === "line") {
      ctx.translate(it.x, it.y);
      drawLine(ctx, it);
      ctx.restore();
      return;
    }
    var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    ctx.translate(cx, cy);
    if (it.rot) ctx.rotate(rad(it.rot));
    ctx.translate(-it.w / 2, -it.h / 2);
    if (ax.k === "shape") {
      var path = itemShape(it);
      if (ax.g) { ctx.fillStyle = gradient(ctx, it, ax.g); ctx.fill(path); }
      else if (ax.fc) { ctx.fillStyle = ax.fc; ctx.fill(path); }
      if (ax.sc && it.sw > 0) {
        ctx.strokeStyle = ax.sc; ctx.lineWidth = it.sw; ctx.lineJoin = "round";
        ctx.setLineDash(it.dash ? [it.sw * 3, it.sw * 2] : []);
        ctx.stroke(path);
      }
    } else if (ax.k === "photo") drawPhoto(ctx, it, opts);
    else if (ax.k === "icon") {
      var ps = iconPaths(ax.ico);
      var s = Math.min(it.w, it.h) / 24;
      ctx.translate((it.w - 24 * s) / 2, (it.h - 24 * s) / 2);
      ctx.scale(s, s);
      ctx.strokeStyle = ax.sc || "#000000";
      ctx.lineWidth = it.sw > 0 ? it.sw : 2;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (ax.fc) { ctx.fillStyle = ax.fc; }
      if (ps) ps.forEach(function (p) { if (ax.fc) ctx.fill(p); ctx.stroke(p); });
      else { ctx.strokeRect(2, 2, 20, 20); }
    } else if (ax.k === "text") drawText(ctx, it);
    ctx.restore();
  }

  function itemsOf(doc, pg) {
    return doc.items.filter(function (it) { return it.pg === pg && it.ax; }).sort(M.byZ);
  }

  function drawPage(ctx, doc, page, opts) {
    itemsOf(doc, page.id).forEach(function (it) {
      if (opts && opts.skip && opts.skip[it.id]) return;
      drawItem(ctx, doc, it, opts);
    });
  }

  // A page on a fresh canvas. scale = px per pt.
  function renderPage(doc, page, scale, opts) {
    opts = opts || {};
    var s = doc.setup;
    var cv = opts.canvas || document.createElement("canvas");
    cv.width = Math.max(1, Math.round(s.w * scale));
    cv.height = Math.max(1, Math.round(s.h * scale));
    var ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, cv.width, cv.height); }
    else ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip();
    drawPage(ctx, doc, page, { maxSide: opts.maxSide || 0, clean: true });
    return cv;
  }

  // Fonts a design uses (loaded before drawing / export).
  function fontKeys(doc) {
    var keys = { "sans-r": 1 };
    doc.items.forEach(function (it) { if (it.ax && it.ax.k === "text") keys[AX.fontKeyOf(it.ax)] = 1; });
    return Object.keys(keys);
  }

  AT.draw = {
    drawItem: drawItem, drawPage: drawPage, renderPage: renderPage, itemShape: itemShape,
    iconPaths: iconPaths, textLines: textLines, fontKeys: fontKeys, lookOf: lookOf,
    clearCaches: function () { photoCache.clear(); }
  };
})();
