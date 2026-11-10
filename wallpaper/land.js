// ============================================================
// orOS — land.js (Living land desktop wallpaper, v1.1.0)
// A landscape that grows around what is on the desktop: the
// shortcuts (launcher.js .ld-ic), the widgets (widgets.js .wg-card),
// the sticky notes (stickies .sn-note / .sn-card) and the Dock.
// Every one of them stands on land; the gaps become water. When
// something is added, removed, moved or resized the land is drawn
// again and faded in (no fade with reduced motion).
//
// Look: flat paper-cut layers (deep water, shallow water, a foam
// ring, sand, grass, upland, the plateau the shortcuts stand on),
// each layer casting a soft shadow down-right, ripple lines in the
// water, a little grain. Colours come from the skin's accent (a
// tint) and the theme (light / dark). No files, no network.
// Styles (1.1.0): islands (mostly water), hills (meadows rising to
// terraces, one winding river), garden (lawn with flowers, hedge rows,
// ponds). Gentle motion (1.1.0, off by default): glints on the water
// and one drifting cloud shadow, ≤ 30 fps, never under an app, with
// reduced motion, on a low battery or on a slow device.
//
// The picture is a pure function of (land, accent, theme, size,
// obstacles): the same desktop draws the same land on every device.
// Only { style, seed, motion } travel (shell slice field wpland);
// the shell owns their canonical form (shell.js wplandCanon).
//
// API (window.OrosLand; Node: require("wallpaper/land.js")):
//   v, STYLES                     version, style ids: islands, hills, garden
//   palette(style, accent, theme) { deep, shallow, foam, sand, grass, high, top } as [r,g,b]
//   baseCss(accent, theme, style) the desktop background under the canvas
//   stillReason(o), glint(p, t)   gentle motion rules (pure)
//   field(rects, w, h, seed, cell, style) → { gw, gh, cell, v: Float32Array }
//   paint(img, fld, pal, scale, seed) fills img {width, height, data}
//   sig(rects)                    obstacle signature (rounded)
//   thumb(accent, theme, style)   small picture as a data URL (Settings), or ""
//   demo(w, h)                    a sample desktop (shortcut grid, widget, note)
//                                 for previews (Wallpaper Generator)
//   mount(desktop, o)             → { set(), refresh(), stop() }
//     o = { get() → { land, accent, theme }, paused() → bool }
// ============================================================
(function (root) {
  "use strict";

  var V = "1.2.0";
  var STYLES = ["islands", "hills", "garden"];

  // ---------- 1. Random numbers + noise ----------
  function prng(seed) {            // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2D value noise, smooth-stepped, two octaves, in [0, 1].
  function makeNoise(seed) {
    var rnd = prng(seed);
    var perm = new Uint8Array(512), val = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { perm[i] = i; val[i] = rnd(); }
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), tmp = perm[i];
      perm[i] = perm[j]; perm[j] = tmp;
    }
    for (i = 0; i < 256; i++) perm[i + 256] = perm[i];
    function lat(x, y) { return val[perm[(perm[x & 255] + y) & 511]]; }
    function sm(t) { return t * t * (3 - 2 * t); }
    function one(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var sx = sm(x - xi), sy = sm(y - yi);
      var a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
      var top = a + (b - a) * sx, bot = c + (d - c) * sx;
      return top + (bot - top) * sy;
    }
    return function (x, y) { return one(x, y) * 0.67 + one(x * 2.1 + 17.3, y * 2.1 - 9.1) * 0.33; };
  }

  // ---------- 2. Colour ----------
  function hexRgb(s) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(s || "").trim());
    if (!m) return [212, 175, 55];
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  }
  function hueOf(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.04) return -1;                       // grey accent: no tint
    var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  // Move hue a toward hue t by f (shortest way round).
  function tint(a, t, f) {
    if (t < 0) return a;
    var d = ((t - a + 540) % 360) - 180;
    return a + d * f;
  }
  function css(rgb) { return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")"; }

  // Layers from the lowest up: [hue, sat, light dark theme, light light theme].
  // The layer names are the islands' names; hills and garden reuse the
  // seven slots: river, bank, reeds, low meadow, meadow, hill, hilltop /
  // pond, pond edge, stones, gravel, lawn, hedge, upper lawn.
  var LAYERS = {
    islands: {
      deep:    [206, 48, 14, 32],
      shallow: [193, 45, 23, 46],
      foam:    [186, 36, 36, 66],
      sand:    [40, 42, 42, 72],
      grass:   [112, 30, 27, 48],
      high:    [102, 28, 33, 56],
      top:     [90, 26, 40, 64]
    },
    hills: {
      deep:    [205, 42, 20, 40],
      shallow: [192, 34, 29, 54],
      foam:    [92, 24, 27, 50],
      sand:    [78, 30, 26, 56],
      grass:   [98, 30, 31, 52],
      high:    [108, 28, 37, 60],
      top:     [52, 38, 45, 72]
    },
    garden: {
      deep:    [200, 44, 21, 42],
      shallow: [186, 40, 31, 57],
      foam:    [36, 12, 44, 74],
      sand:    [38, 22, 50, 78],
      grass:   [118, 36, 25, 45],
      high:    [132, 38, 19, 36],
      top:     [100, 32, 35, 58]
    }
  };
  var ORDER = ["deep", "shallow", "foam", "sand", "grass", "high", "top"];
  function styleOf(st) { return STYLES.indexOf(st) >= 0 ? st : "islands"; }

  function palette(style, accent, theme) {
    var ah = hueOf(hexRgb(accent)), light = theme === "light", out = {};
    var T = LAYERS[styleOf(style)];
    ORDER.forEach(function (k) {
      var L = T[k];
      var f = k === "top" ? 0.35 : 0.15;              // the plateau leans most toward the skin
      out[k] = hsl(tint(L[0], ah, f), L[1], light ? L[3] : L[2]);
    });
    out.style = styleOf(style);
    out.accentRgb = hexRgb(accent);
    return out;
  }

  function baseCss(accent, theme, style) {
    var p = palette(style, accent, theme), st = styleOf(style);
    var a = st === "islands" ? p.shallow : p.grass, b = st === "islands" ? p.deep : p.high;
    return "linear-gradient(160deg, " + css(a) + " 0%, " + css(b) + " 70%)";
  }

  // ---------- 3. The field ----------
  // Reach (px) of the land around each kind of obstacle.
  var SOFT = 0.12;
  var REACH = { tile: 46, card: 56, note: 48, dock: 36 };

  // rects: [{ x, y, w, h, k }] in CSS px of the canvas. Returns a
  // coarse grid of heights: ≥ 1 on every obstacle, falling to 0 (the
  // shore) at its reach, noise around it, a few islets of its own.
  function field(rects, w, h, seed, cell, style) {
    var st = styleOf(style);
    cell = cell || Math.max(6, Math.ceil(Math.max(w, h) / 260));
    var gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    var v = new Float32Array(gw * gh);
    var n1 = makeNoise(seed >>> 0), n2 = makeNoise((seed ^ 0x9e3779b9) >>> 0);
    var n3 = st !== "islands" ? makeNoise((seed ^ 0x51ed270b) >>> 0) : null;
    var list = (rects || []).filter(function (r) {
      return r && r.w > 0 && r.h > 0 && isFinite(r.x) && isFinite(r.y);
    });
    for (var j = 0; j < gh; j++) {
      var y = (j - 0.5) * cell;
      for (var i = 0; i < gw; i++) {
        var x = (i - 0.5) * cell;
        var soft = 0, inside = false;
        for (var q = 0; q < list.length; q++) {
          var r = list[q];
          // rounded box: corners of radius rad, so land is a blob, not a block
          var hw = r.w / 2, hh = r.h / 2, rad = Math.min(hw, hh, 30) * 0.9;
          var dx = Math.max(Math.abs(x - r.x - hw) - (hw - rad), 0);
          var dy = Math.max(Math.abs(y - r.y - hh) - (hh - rad), 0);
          var d = Math.sqrt(dx * dx + dy * dy) - rad;
          if (d < 0) d = 0;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) inside = true;
          var s = 1 - d / (REACH[r.k] || 34);
          if (s > -1) soft += Math.exp((s - 1) / SOFT);
        }
        // smooth union of every obstacle (no pinch where two meet)
        var near = soft > 0 ? 1 + SOFT * Math.log(soft) : -2;
        if (near > 1.4) near = 1.4;
        var nz = (n1(x / 95, y / 95) - 0.5) * 2;               // -1 … 1
        var amp = 0.42 * (1 - 0.45 * Math.max(0, Math.min(1, near)));
        var val = near + nz * amp;
        var islet = (n2(x / 170 + 31.7, y / 170 - 12.3) - 0.66) * 2.4 + nz * 0.12;
        if (islet > val) val = islet;
        if (st !== "islands") {
          // hills and garden are land first: their own ground, which
          // rises smoothly to a terrace (0.88) under every obstacle
          var k01 = Math.max(0, Math.min(1, near)), gnd, n3v = n3(x / 330, y / 330);
          if (st === "hills") {
            gnd = 0.1 + (n1(x / 230, y / 230) * 0.65 + n2(x / 90, y / 90) * 0.35) * 0.95;
            var rv = (n3v - 0.5) / 0.03;             // one winding river
            gnd -= 1.25 * Math.exp(-rv * rv);
          } else {
            gnd = 0.28 + (n1(x / 60, y / 60) - 0.5) * 0.12;
            var hg = (n3v - 0.5) / 0.012;            // hedge rows
            gnd += 0.4 * Math.exp(-hg * hg);
            var pd = (0.33 - n2(x / 130 - 7.1, y / 130 + 3.3)) / 0.06;   // round ponds
            if (pd > 0) gnd -= Math.min(1, pd) * 0.85;
          }
          val = gnd + (0.88 - gnd) * k01 * k01 * (3 - 2 * k01);
        }
        if (val < -1) val = -1;
        if (inside && val < 0.62) val = 0.62;   // every obstacle stands on land
        v[j * gw + i] = val;
      }
    }
    return { gw: gw, gh: gh, cell: cell, v: v };
  }

  // Bilinear sample at CSS px (x, y).
  function at(f, x, y) {
    var fx = x / f.cell + 0.5, fy = y / f.cell + 0.5;
    var i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0) { i = 0; fx = 0; } if (j < 0) { j = 0; fy = 0; }
    if (i > f.gw - 2) { i = f.gw - 2; fx = i + 1; } if (j > f.gh - 2) { j = f.gh - 2; fy = j + 1; }
    var tx = fx - i, ty = fy - j, g = f.gw, a = f.v;
    var p = a[j * g + i], b = a[j * g + i + 1], c = a[(j + 1) * g + i], d = a[(j + 1) * g + i + 1];
    var top = p + (b - p) * tx;
    return top + (c + (d - c) * tx - top) * ty;
  }

  // ---------- 4. Painting ----------
  // Layer thresholds (lowest bound of each layer above "deep").
  var LV = [-0.42, -0.07, -0.025, 0.15, 0.5, 0.8];   // shallow, foam, sand, grass, high, top
  var FW = 0.022;                                    // soft edge, in field units

  function layerOf(val) {
    var k = 0;
    while (k < LV.length && val >= LV[k]) k++;
    return k;                                        // 0 = deep … 6 = top
  }

  // Flowers on a garden lawn: one in about 14 cells of 10 px, a dot.
  var FLOWERS = [[244, 170, 196], [250, 246, 236], [246, 214, 112], [196, 176, 240]];
  function flowerAt(x, y, seed) {
    var cx = Math.floor(x / 10), cy = Math.floor(y / 10);
    var hh = Math.imul(cx * 374761393 + cy * 668265263, 1274126177) ^ seed;
    hh = Math.imul(hh ^ (hh >>> 13), 1274126177) >>> 0;
    if (hh % 14) return -1;
    var fx = cx * 10 + 2 + (hh >>> 8) % 6, fy = cy * 10 + 2 + (hh >>> 12) % 6;
    var d = (x - fx) * (x - fx) + (y - fy) * (y - fy);
    return d <= 2.6 ? (hh >>> 16) % FLOWERS.length : -1;
  }

  function paint(img, fld, pal, scale, seed) {
    var W = img.width, H = img.height, data = img.data;
    var garden = pal.style === "garden", accentRgb = pal.accentRgb;
    var cols = ORDER.map(function (k) { return pal[k]; });
    var vals = new Float32Array(W * H), lay = new Uint8Array(W * H);
    var py, px, i = 0;
    for (py = 0; py < H; py++) {
      var y = (py + 0.5) / scale;
      for (px = 0; px < W; px++, i++) {
        var v = at(fld, (px + 0.5) / scale, y);
        vals[i] = v; lay[i] = layerOf(v);
      }
    }
    // shadow offset in pixels: light from the top-left
    var sx = Math.round(6 * scale), sy = Math.round(7 * scale);
    var hs = (seed >>> 0) || 1;
    i = 0;
    for (py = 0; py < H; py++) {
      for (px = 0; px < W; px++, i++) {
        var val = vals[i], L = lay[i];
        var c = cols[L], r = c[0], g = c[1], b = c[2];
        if (L > 0) {                                 // soft edge with the layer below
          var t = (val - LV[L - 1]) / FW;
          if (t < 1) {
            var lo = cols[L - 1], e = t * t * (3 - 2 * t);
            r = lo[0] + (r - lo[0]) * e; g = lo[1] + (g - lo[1]) * e; b = lo[2] + (b - lo[2]) * e;
          }
        }
        if (garden && L === 4) {                     // lawn flowers (the accent is one of them)
          var fl = flowerAt((px + 0.5) / scale, (py + 0.5) / scale, seed >>> 0);
          if (fl >= 0) { var fc = fl === 0 && accentRgb ? accentRgb : FLOWERS[fl]; r = fc[0]; g = fc[1]; b = fc[2]; }
        }
        if (L <= 1) {                                // ripple lines in the water
          var rip = Math.sin(val * 70);
          if (rip > 0.93) { var k = (rip - 0.93) * 0.4; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
        }
        var qx = px - sx, qy = py - sy;
        if (qx < 0) qx = 0; if (qy < 0) qy = 0;
        var up = lay[qy * W + qx];                   // a higher layer toward the light casts a shadow here
        if (up > L) {
          var dim = 1 - Math.min(2, up - L) * 0.13;
          r *= dim; g *= dim; b *= dim;
        }
        hs ^= hs << 13; hs ^= hs >>> 17; hs ^= hs << 5;   // xorshift grain
        var gr = ((hs >>> 0) % 7) - 3, o = i * 4;
        data[o] = r + gr; data[o + 1] = g + gr; data[o + 2] = b + gr; data[o + 3] = 255;
      }
    }
    return img;
  }

  function sig(rects) {
    return (rects || []).map(function (r) {
      return r.k + Math.round(r.x / 4) + "," + Math.round(r.y / 4) + "," + Math.round(r.w / 4) + "," + Math.round(r.h / 4);
    }).join(";");
  }

  // ---------- 5. Browser part ----------
  function hasDom() { return typeof document !== "undefined" && !!document.createElement; }

  function render(cv, rects, w, h, land, accent, theme) {
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    var scale = Math.min(dpr, 1.25);
    var cap = 1800000;                                // pixel budget
    if (w * h * scale * scale > cap) scale = Math.sqrt(cap / (w * h));
    var W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    if (!ctx) return false;
    var seed = (land && land.seed) >>> 0;
    var fld = field(rects, w, h, seed, 0, land && land.style);
    var img = ctx.createImageData(W, H);
    paint(img, fld, palette(land && land.style, accent, theme), W / w, seed);
    ctx.putImageData(img, 0, 0);
    return fld;
  }

  // A sample desktop in CSS pixels: a shortcut grid at the top left,
  // on a wide screen a widget column on the right and a sticky note.
  // Previews only (Wallpaper Generator); the desktop uses its own.
  function demo(w, h) {
    var r = [], phone = w < 600, cols = phone ? 4 : (w < 1000 ? 4 : 5);
    var tw = phone ? Math.min(80, Math.floor((w - 20) / cols) - 6) : 92, th = phone ? 88 : 90;
    var gx = phone ? Math.floor((w - cols * (tw + 6)) / 2) : 20;
    var n = phone ? 12 : 10;
    for (var i = 0; i < n; i++) {
      r.push({ x: gx + (i % cols) * (tw + 6), y: 20 + Math.floor(i / cols) * (th + 10), w: tw, h: th, k: "tile" });
    }
    if (!phone) {
      r.push({ x: w - 320, y: 16, w: 300, h: Math.min(220, Math.round(h * 0.28)), k: "card" });
      if (h > 500) r.push({ x: Math.round(w * 0.45), y: Math.round(h * 0.52), w: 210, h: 190, k: "note" });
    } else if (h > 500) {
      r.push({ x: 10, y: h - 210, w: w - 20, h: 150, k: "card" });
    }
    return r;
  }

  var thumbCache = {};
  function thumb(accent, theme, style) {
    if (!hasDom()) return "";
    style = styleOf(style);
    var key = accent + "|" + theme + "|" + style;
    if (thumbCache[key]) return thumbCache[key];
    try {
      var cv = document.createElement("canvas");
      var w = 160, h = 100, rects = [], i;
      for (i = 0; i < 3; i++) rects.push({ x: 14, y: 12 + i * 28, w: 18, h: 18, k: "tile" });
      rects.push({ x: 108, y: 14, w: 40, h: 46, k: "card" });
      var ctx = cv.getContext("2d");
      if (!ctx) return "";
      cv.width = w; cv.height = h;
      var img = ctx.createImageData(w, h);
      var fld = field(rects.map(function (r) { return { x: r.x, y: r.y, w: r.w, h: r.h, k: r.k === "tile" ? "note" : r.k }; }), w, h, 7, 4, style);
      paint(img, fld, palette(style, accent, theme), 1, 7);
      ctx.putImageData(img, 0, 0);
      thumbCache[key] = cv.toDataURL("image/png");
      cv.width = cv.height = 0;
      return thumbCache[key];
    } catch (e) { return ""; }
  }

  var OBST = [
    [".ld-ic", "tile"], [".wg-card", "card"], [".sn-note", "note"], [".sn-card", "note"]
  ];

  // Gentle motion (wave 2, off by default): why the land stays still
  // now, or "" when it may move. The same rules as seasonal.js: reduced
  // motion, a low battery (< 20 %, not charging), a slow device (frames
  // above 55 ms) leave it still.
  function stillReason(o) {
    o = o || {};
    if (!o.motion) return "off";
    if (o.reduced) return "reduced";
    if (o.battery && typeof o.battery.level === "number" && o.battery.level < 0.2 && !o.battery.charging) return "battery";
    if (o.slow) return "slow";
    return "";
  }
  // Brightness of one glint at time t (s): short flashes, mostly dark.
  function glint(phase, t) {
    var v = Math.sin(phase + t * 1.3);
    return v > 0 ? Math.pow(v, 10) : 0;
  }

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  function mount(desk, o) {
    o = o || {};
    var wrap = document.getElementById("wp-land");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "wp-land";
      wrap.setAttribute("aria-hidden", "true");
      desk.insertBefore(wrap, desk.firstChild);
    }
    var last = "", timer = 0, stopped = false, ro = null, mo = null, tick = 0;
    var cur = null;                                  // { fld, w, h, style } of the land on screen
    var fx = null, raf = 0, slow = false, battery = null, frames = [], glints = [], lastT = 0;
    try {
      if (navigator.getBattery) navigator.getBattery().then(function (b) {
        battery = b;
        var up = function () { motionSync(); };
        b.addEventListener("levelchange", up); b.addEventListener("chargingchange", up);
      }).catch(function () {});
    } catch (e) {}

    function motionStop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
      fx = null;
    }
    function motionSync() {
      if (stopped) return;
      var st = (o.get && o.get()) || {};
      var why = stillReason({ motion: st.land && st.land.motion, reduced: reduced(), battery: battery, slow: slow });
      if (why || !cur || (o.paused && o.paused()) || document.hidden) { motionStop(); return; }
      if (!fx) {
        fx = document.createElement("canvas");
        fx.className = "wp-land-fx";
        wrap.appendChild(fx);
        glints = [];
      }
      if (!raf) { frames = []; lastT = 0; raf = requestAnimationFrame(frame); }
    }
    function water(x, y) { return cur && layerOf(at(cur.fld, x, y)) <= 1; }
    function spawn(g) {
      for (var n = 0; n < 6; n++) {
        g.x = Math.random() * cur.w; g.y = Math.random() * cur.h;
        if (water(g.x, g.y)) break;
      }
      g.p = Math.random() * 6.283; g.l = 4 + Math.random() * 7;
      return g;
    }
    function frame(ts) {
      raf = 0;
      if (stopped || !fx || !cur) return;
      if ((o.paused && o.paused()) || document.hidden) { motionStop(); return; }
      if (lastT && ts - lastT < 33) { raf = requestAnimationFrame(frame); return; }   // ≤ 30 fps
      var t0 = (typeof performance !== "undefined") ? performance.now() : Date.now();
      var dt = lastT ? (ts - lastT) / 1000 : 0;
      lastT = ts;
      var w = cur.w, h = cur.h, dpr = Math.min((window.devicePixelRatio || 1), 1.25);
      if (fx.width !== Math.round(w * dpr)) { fx.width = Math.round(w * dpr); fx.height = Math.round(h * dpr); }
      var ctx = fx.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var t = ts / 1000;
      // one soft cloud shadow drifting across
      var R = Math.max(w, h) * 0.38, cx = ((t * 9) % (w + 2 * R)) - R, cy = h * 0.45 + Math.sin(t / 23) * h * 0.2;
      var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, "rgba(0,0,0,0.09)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      // glints on the water
      var mem = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
      var want = Math.round(Math.max(8, Math.min(60, w * h / 25000)) * (mem ? 0.5 : 1));
      while (glints.length < want) glints.push(spawn({}));
      ctx.strokeStyle = "#ffffff"; ctx.lineCap = "round"; ctx.lineWidth = 1.6;
      for (var i = 0; i < glints.length; i++) {
        var g = glints[i];
        g.x += 6 * dt;
        if (g.x > w || !water(g.x, g.y)) { spawn(g); continue; }
        var a = glint(g.p, t);
        if (a < 0.02) continue;
        ctx.globalAlpha = a * 0.55;
        ctx.beginPath(); ctx.moveTo(g.x - g.l / 2, g.y); ctx.lineTo(g.x + g.l / 2, g.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      var t1 = (typeof performance !== "undefined") ? performance.now() : Date.now();
      frames.push(t1 - t0);
      if (frames.length > 40) frames.shift();
      if (frames.length >= 40) {
        var sum = 0; for (var k = 0; k < frames.length; k++) sum += frames[k];
        if (sum / frames.length > 55) { slow = true; motionStop(); return; }   // slow device: still from now on
      }
      raf = requestAnimationFrame(frame);
    }

    function rects() {
      var box = wrap.getBoundingClientRect(), out = [];
      OBST.forEach(function (p) {
        var list = desk.querySelectorAll(p[0]);
        for (var i = 0; i < list.length; i++) {
          var b = list[i].getBoundingClientRect();
          if (b.width < 2 || b.height < 2) continue;
          if (b.bottom < box.top || b.top > box.bottom || b.right < box.left || b.left > box.right) continue;
          out.push({ x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height, k: p[1] });
        }
      });
      var dock = document.getElementById("ld-dock");
      if (dock) {
        var cs = window.getComputedStyle(dock), db = dock.getBoundingClientRect();
        if (cs.display !== "none" && cs.visibility !== "hidden" && db.width > 2 && db.height > 2 && db.top < box.bottom)
          out.push({ x: db.left - box.left, y: db.top - box.top, w: db.width, h: db.height, k: "dock" });
      }
      return out;
    }

    function draw(force) {
      timer = 0;
      if (stopped) return;
      if ((o.paused && o.paused()) || !desk.offsetParent && desk.style.display === "none") return;
      var box = wrap.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return;
      var st = (o.get && o.get()) || {};
      var rs = rects();
      var key = Math.round(box.width) + "x" + Math.round(box.height) + "|" + JSON.stringify(st.land || null) +
                "|" + st.accent + "|" + st.theme + "|" + sig(rs);
      if (!force && key === last) { motionSync(); return; }
      last = key;
      var cv = document.createElement("canvas");
      cv.className = "wp-land-c";
      var fld = render(cv, rs, box.width, box.height, st.land, st.accent, st.theme);
      if (!fld) return;
      cur = { fld: fld, w: box.width, h: box.height };
      var old = wrap.querySelectorAll("canvas.wp-land-c");
      var fade = old.length > 0 && !reduced();
      if (fade) cv.style.opacity = "0";
      wrap.insertBefore(cv, fx);                     // under the motion layer (fx null = last)
      motionSync();
      var done = function () {
        Array.prototype.forEach.call(old, function (c) {
          if (c.parentNode) c.parentNode.removeChild(c);
          c.width = c.height = 0;
        });
      };
      if (!fade) { done(); return; }
      // two frames: the new canvas is painted at 0 before it fades in
      requestAnimationFrame(function () { requestAnimationFrame(function () { cv.style.opacity = "1"; }); });
      setTimeout(done, 700);
    }

    function soon(ms) {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(draw, ms == null ? 250 : ms);
    }

    // A widget clock rewrites its text every second: the signature
    // check in draw() keeps that from drawing anything.
    try {
      mo = new MutationObserver(function () { soon(250); });
      mo.observe(desk, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    } catch (e) {}
    try {
      ro = new ResizeObserver(function () { soon(250); });
      ro.observe(desk);
    } catch (e) {}
    var onVis = function () { if (document.hidden) motionStop(); else soon(0); };
    document.addEventListener("visibilitychange", onVis);
    var mq = null;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); if (mq.addEventListener) mq.addEventListener("change", motionSync); } catch (e) { mq = null; }
    var onResize = function () { soon(300); };
    var onScroll = function () { soon(150); };
    window.addEventListener("resize", onResize);
    desk.addEventListener("scroll", onScroll, { passive: true });
    // Dock auto-hide and the like change no desktop node: a slow check.
    tick = setInterval(function () { if (!document.hidden) soon(0); }, 4000);

    soon(0);
    return {
      set: function () { slow = false; soon(0); },
      refresh: function () { soon(0); },
      redraw: function () { last = ""; soon(0); },
      stop: function () {
        stopped = true;
        motionStop();
        document.removeEventListener("visibilitychange", onVis);
        try { if (mq && mq.removeEventListener) mq.removeEventListener("change", motionSync); } catch (e) {}
        if (timer) clearTimeout(timer);
        clearInterval(tick);
        try { if (mo) mo.disconnect(); } catch (e) {}
        try { if (ro) ro.disconnect(); } catch (e) {}
        window.removeEventListener("resize", onResize);
        desk.removeEventListener("scroll", onScroll);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  var API = {
    v: V, STYLES: STYLES.slice(), LEVELS: LV.slice(), REACH: REACH,
    palette: palette, baseCss: baseCss, field: field, sample: at, layerOf: layerOf,
    paint: paint, sig: sig, thumb: thumb, demo: demo, mount: mount, stillReason: stillReason, glint: glint
  };
  root.OrosLand = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
