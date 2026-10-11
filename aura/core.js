// ============================================================
// orOS Aura Painter — pure core (no DOM)
// Paint with light: strokes of glowing colour on a dark (or light)
// background. A work is kept as its strokes, not as a picture, so
// it redraws cleanly at any size and can be replayed stroke by
// stroke.
//
//   Work   { id, m, name, w, h, bg, st: [stroke] }
//          w × h = the work's own units (long side 2000); every
//          point is an integer in [0, w] × [0, h].
//   Stroke { b: brush, c: colour, s: size 1-100, g: brightness
//            10-100, y: symmetry, p: points }
//          c = "#rrggbb", or "r<hue>" for a rainbow stroke that
//          starts at that hue. p = the points packed in a string
//          (encodePoints): x, y and a width step 0-15 per point,
//          as zigzag varints in deltas, 6 bits per character.
//   Data   { ver, works: [work], tombs: { id: ms } }
//          LWW per work + tombstones (R17, R26).
//
// Limits: 4000 points a work (counted before symmetry), 60 works.
//
// Drawing goes through draw(ctx, work, opts) with any canvas 2D
// context; the strokes are filled outlines (one fill per pass, so
// overlaps inside a stroke never double up under "lighter").
//
// UMD: module.exports in Node (tests), window.AuraCore in the app.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER   = 1;
  var MAX_WORKS  = 60;
  var MAX_POINTS = 4000;
  var MAX_STROKE = 1500;              // points in one stroke
  var NAME_LEN   = 60;
  var LONG       = 2000;              // long side of a work, in units
  var ID_RE      = /^a[a-z0-9]{6,20}$/;
  var HEX_RE     = /^#[0-9a-f]{6}$/;
  var RAIN_RE    = /^r(\d{1,3})$/;
  var P_RE       = /^[A-Za-z0-9_-]+$/;
  var TAU        = Math.PI * 2;

  var BRUSHES = ["glow", "neon", "sparks", "mist", "ribbon"];
  var SYMS    = ["none", "mirror", "k4", "k6", "k8", "k12"];
  var BGS     = ["black", "blue", "purple", "light"];
  var BG_COLOUR = { black: "#05060a", blue: "#06122e", purple: "#160a2a", light: "#f6f1e6" };

  var PALETTES = {
    aurora: ["#3cff9e", "#2ee6d6", "#39b8ff", "#7b5cff", "#d14bff"],
    sunset: ["#ff4e6a", "#ff8a4c", "#ffc94a", "#ff4fa3", "#b44cf0"],
    ocean:  ["#00e0ff", "#0a84ff", "#22ffc8", "#7fe9ff", "#3d6bff"],
    neon:   ["#ff2bd6", "#00f0ff", "#f6ff2b", "#39ff14", "#ff3b3b"],
    fire:   ["#ff2a00", "#ff7a00", "#ffc000", "#ffe680", "#ff0050"]
  };
  var PALETTE_IDS = ["aurora", "sunset", "ocean", "neon", "fire"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // ---------- Points: pack / unpack ----------
  var ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var DEC = {};
  for (var ai = 0; ai < ALPHA.length; ai++) DEC[ALPHA.charAt(ai)] = ai;

  function putVar(out, n) {             // signed int → zigzag → 5 bits a char
    var z = n < 0 ? (-n * 2 - 1) : n * 2;
    do {
      var c = z & 31;
      z = Math.floor(z / 32);
      out.push(ALPHA.charAt(z > 0 ? c | 32 : c));
    } while (z > 0);
  }

  // pts = [{x, y, w}] (integers; w 0-15) → string
  function encodePoints(pts) {
    var out = [], px = 0, py = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      putVar(out, p.x - px); putVar(out, p.y - py); putVar(out, p.w);
      px = p.x; py = p.y;
    }
    return out.join("");
  }

  // string → [{x, y, w}], or null when it is not a valid packing
  function decodePoints(s) {
    if (typeof s !== "string" || !s || !P_RE.test(s)) return null;
    var nums = [], z = 0, mul = 1, i;
    for (i = 0; i < s.length; i++) {
      var v = DEC[s.charAt(i)];
      z += (v & 31) * mul;
      if (v & 32) {
        mul *= 32;
        if (mul > 1048576) return null;         // a number too long: garbage
      } else {
        nums.push(z % 2 ? -(z + 1) / 2 : z / 2);
        z = 0; mul = 1;
      }
    }
    if (mul !== 1 || nums.length % 3 !== 0 || !nums.length) return null;
    var pts = [], x = 0, y = 0;
    for (i = 0; i < nums.length; i += 3) {
      x += nums[i]; y += nums[i + 1];
      pts.push({ x: x, y: y, w: nums[i + 2] });
    }
    return pts;
  }

  // ---------- Normalising ----------
  function cleanName(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_LEN);
  }

  function normColour(c) {
    if (typeof c !== "string") return null;
    c = c.toLowerCase();
    if (HEX_RE.test(c)) return c;
    var m = RAIN_RE.exec(c);
    if (m && +m[1] < 360) return "r" + (+m[1]);
    return null;
  }

  function normPoints(pts, w, h) {
    var out = [];
    for (var i = 0; i < pts.length && out.length < MAX_STROKE; i++) {
      var p = pts[i];
      if (!isInt(p.x) || !isInt(p.y) || !isInt(p.w)) return null;
      out.push({ x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)),
                 w: Math.max(0, Math.min(15, p.w)) });
    }
    return out.length ? out : null;
  }

  // → { stroke, n } (n = points), or null
  function normStroke(raw, w, h) {
    if (!raw || typeof raw !== "object") return null;
    if (BRUSHES.indexOf(raw.b) < 0 || SYMS.indexOf(raw.y) < 0) return null;
    var c = normColour(raw.c);
    if (!c) return null;
    var pts = decodePoints(raw.p);
    if (!pts) return null;
    pts = normPoints(pts, w, h);
    if (!pts) return null;
    return {
      stroke: { b: raw.b, c: c, s: clampInt(raw.s, 1, 100, 30), g: clampInt(raw.g, 10, 100, 70),
                y: raw.y, p: encodePoints(pts) },
      n: pts.length
    };
  }

  function normSize(w, h) {
    if (!isInt(w) || !isInt(h) || w < 100 || h < 100 || w > LONG || h > LONG) return null;
    if (Math.max(w, h) !== LONG) return null;
    return { w: w, h: h };
  }

  // A work's units for a w × h screen (long side LONG).
  function sizeFor(sw, sh) {
    sw = Math.max(1, sw); sh = Math.max(1, sh);
    var k = LONG / Math.max(sw, sh);
    return { w: Math.max(100, Math.min(LONG, Math.round(sw * k))),
             h: Math.max(100, Math.min(LONG, Math.round(sh * k))) };
  }

  // Strokes past the point limit are dropped (whole strokes).
  function normStrokes(list, w, h) {
    var out = [], total = 0;
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var s = normStroke(list[i], w, h);
      if (!s) continue;
      if (total + s.n > MAX_POINTS) break;
      total += s.n;
      out.push(s.stroke);
    }
    return out;
  }

  function normWork(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    if (!isInt(raw.m) || raw.m < 0) return null;
    var sz = normSize(raw.w, raw.h);
    if (!sz) return null;
    return {
      id: raw.id, m: raw.m, name: cleanName(raw.name) || "Aura",
      w: sz.w, h: sz.h, bg: BGS.indexOf(raw.bg) >= 0 ? raw.bg : "black",
      st: normStrokes(raw.st, sz.w, sz.h)
    };
  }

  function pointCount(strokes) {
    var n = 0;
    for (var i = 0; i < strokes.length; i++) {
      var p = decodePoints(strokes[i].p);
      n += p ? p.length : 0;
    }
    return n;
  }

  // ---------- Merge (LWW per work + tombstones) ----------
  function mergeWorks(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.works, b.works].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var wk = normWork(raw);
        if (!wk) return;
        var cur = best[wk.id];
        if (!cur || wk.m > cur.m ||
            (wk.m === cur.m && JSON.stringify(wk) > JSON.stringify(cur))) best[wk.id] = wk;
      });
    });
    var live = [];
    Object.keys(best).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      live.push(best[id]);
    });
    // Over the limit (two devices filled it): the newest stay.
    live.sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
    live = live.slice(0, MAX_WORKS);
    live.sort(function (x, y) { return cmpStr(x.id, y.id); });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, works: live, tombs: sortedTombs };
  }

  function findWork(dat, id) {
    for (var i = 0; i < dat.works.length; i++) if (dat.works[i].id === id) return dat.works[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(r) {
    var s = "a";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  function fileName(name, ext) {
    var base = String(name || "").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "").slice(0, 50);
    return "aura-" + (base || "work") + "." + ext;
  }

  // ---------- Symmetry ----------
  // Matrices [a, b, c, d] about the centre: x' = a·x + b·y, y' = c·x + d·y.
  // Mirror = 2 copies (left-right); kN = N copies, N/2 turns each
  // with its mirror image, like a real kaleidoscope.
  function transforms(sym) {
    if (sym === "mirror") return [[1, 0, 0, 1], [-1, 0, 0, 1]];
    var m = /^k(\d+)$/.exec(sym || "");
    if (!m) return [[1, 0, 0, 1]];
    var n = (+m[1]) / 2, out = [];
    for (var i = 0; i < n; i++) {
      var a = TAU * i / n, co = Math.cos(a), si = Math.sin(a);
      out.push([co, -si, si, co]);                       // turn
      out.push([-co, -si, -si, co]);                     // turn · mirror (x → -x)
    }
    return out;
  }
  function copies(sym) { return transforms(sym).length; }

  function applyT(pts, T, cx, cy) {
    var out = new Array(pts.length);
    for (var i = 0; i < pts.length; i++) {
      var dx = pts[i].x - cx, dy = pts[i].y - cy;
      out[i] = { x: cx + T[0] * dx + T[1] * dy, y: cy + T[2] * dx + T[3] * dy, w: pts[i].w };
    }
    return out;
  }

  // ---------- Colour ----------
  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function rgbHex(c) {
    return "#" + c.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function mix(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    return rgbHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function hsl(hue, s, l) {
    hue = ((hue % 360) + 360) % 360 / 360;
    function f(n) {
      var k = (n + hue * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    }
    return rgbHex([f(0) * 255, f(8) * 255, f(4) * 255]);
  }
  function rainbowHue(c) { var m = RAIN_RE.exec(c || ""); return m ? +m[1] : null; }

  // ---------- Random numbers ----------
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function prng(seed) {               // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Geometry for drawing ----------
  function smooth(pts) {               // light 1-2-1 smoothing, ends kept
    if (pts.length < 3) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      out.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4, w: b.w });
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function widthStep(w) { return 0.4 + w * 0.08; }          // step 0-15 → ×0.4-1.6
  function radius(size) { return 2 + size * 0.5; }           // units

  // Outline polygon of a stroke: rad(i) = half width at point i.
  // Round caps at both ends; one closed path.
  function outline(pts, rad) {
    var n = pts.length, left = [], right = [], i;
    if (n === 1) {
      var r0 = rad(0), circle = [];
      for (i = 0; i < 16; i++) {
        var a0 = TAU * i / 16;
        circle.push(pts[0].x + Math.cos(a0) * r0, pts[0].y + Math.sin(a0) * r0);
      }
      return circle;
    }
    var nx = [], ny = [];
    for (i = 0; i < n; i++) {
      var p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx.push(-dy / len); ny.push(dx / len);
    }
    for (i = 0; i < n; i++) {
      var r = rad(i);
      left.push(pts[i].x + nx[i] * r, pts[i].y + ny[i] * r);
      right.push(pts[i].x - nx[i] * r, pts[i].y - ny[i] * r);
    }
    var out = left.slice();
    cap(out, pts[n - 1], nx[n - 1], ny[n - 1], rad(n - 1));   // end: left → right
    for (i = n - 1; i >= 0; i--) out.push(right[i * 2], right[i * 2 + 1]);
    cap(out, pts[0], -nx[0], -ny[0], rad(0));                 // start: right → left
    return out;
  }
  function cap(out, p, nx, ny, r) {
    var a = Math.atan2(ny, nx);
    for (var k = 1; k < 8; k++) {
      var t = a - Math.PI * k / 8;
      out.push(p.x + Math.cos(t) * r, p.y + Math.sin(t) * r);
    }
  }

  // Passes per brush: [width ×, alpha, mix towards white]
  var PASSES = {
    glow:   [[3.2, 0.045, 0], [1.9, 0.09, 0], [1.0, 0.3, 0.08], [0.34, 0.5, 0.5]],
    neon:   [[2.6, 0.07, 0], [1.1, 0.24, 0.04], [0.42, 0.7, 0.45], [0.15, 0.85, 0.85]],
    sparks: [[1.6, 0.06, 0], [0.5, 0.36, 0.25], [0.18, 0.75, 0.75]],
    mist:   [[4.4, 0.025, 0], [3.2, 0.032, 0], [2.2, 0.04, 0.04], [1.3, 0.05, 0.08]],
    ribbon: [[1.7, 0.08, 0], [1.0, 0.42, 0.04], [0.25, 0.45, 0.6]]
  };

  // Half width at each point for a brush.
  function radii(st, pts) {
    var base = radius(st.s), out = new Array(pts.length);
    for (var i = 0; i < pts.length; i++) {
      var r = base * widthStep(pts[i].w);
      if (st.b === "ribbon") {                       // a flat nib at 45°: turns change the width
        var p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
        var ang = Math.atan2(q.y - p.y, q.x - p.x);
        r *= 0.25 + 0.95 * Math.abs(Math.sin(ang - Math.PI / 4));
      }
      if (st.b === "neon") r *= 0.75;
      out[i] = r;
    }
    var taper = Math.min(6, Math.floor(pts.length / 3));   // soft ends
    for (var j = 0; j < taper; j++) {
      var f = 0.45 + 0.55 * (j + 1) / (taper + 1);
      out[j] *= f; out[pts.length - 1 - j] *= f;
    }
    return out;
  }

  function fillPoly(ctx, poly, k, ox, oy) {
    ctx.beginPath();
    ctx.moveTo(ox + poly[0] * k, oy + poly[1] * k);
    for (var i = 2; i < poly.length; i += 2) ctx.lineTo(ox + poly[i] * k, oy + poly[i + 1] * k);
    ctx.closePath();
    ctx.fill();
  }

  // Colour along a stroke: one colour, or rainbow chunks.
  function chunks(st, pts) {
    var hue = rainbowHue(st.c);
    if (hue === null) return [{ from: 0, to: pts.length - 1, col: st.c }];
    var out = [], from = 0, dist = 0, i;
    var CH = 6;
    for (i = 1; i <= pts.length - 1; i++) {
      dist += Math.sqrt(Math.pow(pts[i].x - pts[i - 1].x, 2) + Math.pow(pts[i].y - pts[i - 1].y, 2));
      if (i - from >= CH || i === pts.length - 1) {
        out.push({ from: from, to: i, col: hsl(hue + dist * 0.18, 1, 0.6) });
        from = i;
      }
    }
    if (!out.length) out.push({ from: 0, to: 0, col: hsl(hue, 1, 0.6) });
    return out;
  }

  // Draws one stroke (all its symmetry copies) on ctx.
  // o: { k, ox, oy, cx, cy, light, alpha (fade), upto (points shown),
  //      calm (fewer sparks) }
  function drawStroke(ctx, st, o) {
    var pts = decodePoints(st.p);
    if (!pts) return;
    if (o.upto !== undefined) pts = pts.slice(0, Math.max(1, o.upto));
    pts = smooth(pts);
    var R = radii(st, pts);
    var passes = PASSES[st.b];
    var bright = 0.25 + st.g / 100 * 0.85;
    var alpha = o.alpha === undefined ? 1 : o.alpha;
    var parts = chunks(st, pts);
    var Ts = transforms(st.y);
    // many copies pile up light at the centre: a little less each
    alpha *= st.b === "mist" ? 2 / (1 + Math.sqrt(Ts.length)) : (Ts.length > 4 ? 0.8 : 1);
    var light = !!o.light;
    for (var ti = 0; ti < Ts.length; ti++) {
      var tp = applyT(pts, Ts[ti], o.cx, o.cy);
      for (var pi = 0; pi < passes.length; pi++) {
        var ps = passes[pi];
        if (light && ps[2] > 0.5) continue;           // white cores vanish on paper
        ctx.globalAlpha = Math.min(1, ps[1] * bright * alpha * (light ? 1.15 : 1));
        for (var ci = 0; ci < parts.length; ci++) {
          var ch = parts[ci];
          var sub = tp.slice(ch.from, ch.to + 1);
          var subR = R.slice(ch.from, ch.to + 1);
          var col = light ? mix(ch.col, "#000000", 0.15 + ps[2] * 0.2) : (ps[2] ? mix(ch.col, "#ffffff", ps[2]) : ch.col);
          ctx.fillStyle = col;
          fillPoly(ctx, outline(sub, function (i) { return subR[i] * ps[0]; }), o.k, o.ox, o.oy);
        }
      }
      if (st.b === "sparks") drawSparks(ctx, st, tp, R, parts, bright * alpha, o, light);
    }
    ctx.globalAlpha = 1;
  }

  // Specks thrown off a sparks stroke, the same every time it is drawn.
  function drawSparks(ctx, st, pts, R, parts, a, o, light) {
    var rnd = prng(hash32(st.p + "|" + st.c));
    var every = o.calm ? 3 : 1;
    var ci = 0;
    for (var i = 0; i < pts.length; i += every) {
      while (ci < parts.length - 1 && parts[ci].to < i) ci++;
      var col = light ? mix(parts[ci].col, "#000000", 0.2) : parts[ci].col;
      var n = o.calm ? 1 : 2;
      for (var j = 0; j < n; j++) {
        var ang = rnd() * TAU, d = R[i] * (1 + rnd() * 3.2), sz = R[i] * (0.08 + rnd() * 0.22);
        var x = pts[i].x + Math.cos(ang) * d, y = pts[i].y + Math.sin(ang) * d;
        ctx.globalAlpha = Math.min(1, a * (0.25 + rnd() * 0.6));
        ctx.fillStyle = rnd() < 0.3 && !light ? "#ffffff" : col;
        ctx.beginPath();
        ctx.arc(o.ox + x * o.k, o.oy + y * o.k, Math.max(0.6, sz * o.k), 0, TAU);
        ctx.fill();
      }
    }
  }

  // Where a work sits in a w × h canvas: contained, centred.
  function fit(work, w, h) {
    var k = Math.min(w / work.w, h / work.h);
    return { k: k, ox: (w - work.w * k) / 2, oy: (h - work.h * k) / 2 };
  }

  // Draws a whole work. opts: { bg (fill, default true), upto:
  // {stroke, point} for replay, calm, alphas: [per stroke] (fade) }
  function draw(ctx, work, w, h, opts) {
    opts = opts || {};
    var f = fit(work, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (opts.bg !== false) {
      ctx.fillStyle = BG_COLOUR[work.bg] || BG_COLOUR.black;
      ctx.fillRect(0, 0, w, h);
    }
    var light = work.bg === "light";
    ctx.globalCompositeOperation = light ? "multiply" : "lighter";
    var o = { k: f.k, ox: f.ox, oy: f.oy, cx: work.w / 2, cy: work.h / 2, light: light, calm: !!opts.calm };
    var last = work.st.length - 1, upto = opts.upto;
    if (upto) last = Math.min(last, upto.stroke);
    for (var i = 0; i <= last; i++) {
      o.upto = (upto && i === upto.stroke) ? upto.point : undefined;
      o.alpha = opts.alphas ? opts.alphas[i] : undefined;
      if (o.alpha !== undefined && o.alpha <= 0) continue;
      drawStroke(ctx, work.st[i], o);
    }
    ctx.restore();
  }

  // ---------- Surprise: a random work ----------
  function surprise(rnd, w, h) {
    var sz = (normSize(w, h) || sizeFor(w, h));
    var pal = PALETTES[PALETTE_IDS[Math.floor(rnd() * PALETTE_IDS.length)]];
    var sym = ["k6", "k8", "k12", "k8", "mirror"][Math.floor(rnd() * 5)];
    var cx = sz.w / 2, cy = sz.h / 2, R = Math.min(sz.w, sz.h) * 0.46;
    var n = 3 + Math.floor(rnd() * 4), st = [], used = 0;
    var rainbow = rnd() < 0.25;
    for (var s = 0; s < n; s++) {
      var b = BRUSHES[Math.floor(rnd() * BRUSHES.length)];
      if (s === 0) b = "mist";
      var pts = [], steps = 70 + Math.floor(rnd() * 90);
      var r0 = R * (0.1 + rnd() * 0.5), r1 = R * (0.3 + rnd() * 0.7);
      var a0 = rnd() * TAU, turn = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 1.8);
      var wob = rnd() * 0.25, fq = 2 + Math.floor(rnd() * 5);
      for (var i = 0; i < steps; i++) {
        var t = i / (steps - 1);
        var r = r0 + (r1 - r0) * t + R * wob * Math.sin(t * TAU * fq / 2);
        var a = a0 + turn * t * Math.PI;
        pts.push({ x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r),
                   w: Math.round(7 + 6 * Math.sin(t * Math.PI)) });
      }
      var np = normPoints(pts, sz.w, sz.h);
      if (used + np.length > MAX_POINTS) break;
      used += np.length;
      st.push({
        b: b,
        c: rainbow ? "r" + Math.floor(rnd() * 360) : pal[Math.floor(rnd() * pal.length)],
        s: b === "mist" ? 50 + Math.floor(rnd() * 30) : 8 + Math.floor(rnd() * 26),
        g: b === "mist" ? 40 + Math.floor(rnd() * 30) : 50 + Math.floor(rnd() * 40),
        y: sym, p: encodePoints(np)
      });
    }
    return { w: sz.w, h: sz.h, bg: rnd() < 0.2 ? "blue" : (rnd() < 0.2 ? "purple" : "black"), st: st };
  }

  var api = {
    VER: DATA_VER, MAX_WORKS: MAX_WORKS, MAX_POINTS: MAX_POINTS, MAX_STROKE: MAX_STROKE,
    NAME_LEN: NAME_LEN, LONG: LONG,
    BRUSHES: BRUSHES.slice(), SYMS: SYMS.slice(), BGS: BGS.slice(), BG_COLOUR: BG_COLOUR,
    PALETTES: PALETTES, PALETTE_IDS: PALETTE_IDS.slice(),
    encodePoints: encodePoints, decodePoints: decodePoints,
    cleanName: cleanName, normColour: normColour, normStroke: normStroke, normWork: normWork,
    normPoints: normPoints, normStrokes: normStrokes, sizeFor: sizeFor, pointCount: pointCount,
    mergeWorks: mergeWorks, findWork: findWork, newestFirst: newestFirst, newId: newId, fileName: fileName,
    transforms: transforms, copies: copies, applyT: applyT,
    mix: mix, hsl: hsl, rainbowHue: rainbowHue, hash32: hash32, prng: prng,
    radius: radius, widthStep: widthStep, outline: outline, fit: fit,
    drawStroke: drawStroke, draw: draw, surprise: surprise
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AuraCore = api;
})(typeof window !== "undefined" ? window : this);
