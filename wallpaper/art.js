// ============================================================
// orOS Wallpaper Generator — art.js (shared renderer, v1.0.0)
// One file draws every wallpaper: the Wallpaper Generator app
// (preview, favourites, export) AND the shell (the "Mine" desktop
// wallpaper). Pure Canvas 2D, no libraries, no network.
//
// A wallpaper is a RECIPE, a few bytes that travel through sync:
//   { seed, style, pal, dens, chaos, grain, light }
// The same recipe gives the same picture on every device and in
// every size of the same shape: all geometry is measured in units
// of the short side, and element counts scale with the area in
// those units.
//
// API (window.OrosWallArt):
//   STYLES, PALETTES            ids, in display order
//   normRecipe(r)               canonical recipe, or null (R26)
//   defaultRecipe()             the recipe a fresh app starts with
//   randomSeed()                a pronounceable random seed
//   colors(recipe, accent)      { bg, ink[], light } (accent = skin colour, for "oros")
//   key(recipe, accent)         cache key: changes only when the picture does
//   steps(ctx, w, h, recipe, o) the drawing as a list of small steps
//   renderSync(ctx, w, h, recipe, o)
//   render(ctx, w, h, recipe, o) → Promise<boolean> (false = cancelled)
//     o = { accent, makeCanvas(w, h), onProgress(f), cancelled(), slice }
// Sections:
//   1. Recipe
//   2. Random numbers + noise
//   3. Colour
//   4. Styles (waves, flow, orbits, grid, nebula) + grain
//   5. Runner
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var STYLES = ["waves", "flow", "orbits", "grid", "nebula"];
  var PALETTES = ["oros", "ember", "ocean", "forest", "dusk", "pastel", "mono"];
  var SEED_LEN = 40;
  var TAU = Math.PI * 2;

  // d = dark background, l = light background, c = inks
  var PAL = {
    ember:  { d: "#170c08", l: "#fbf2e8", c: ["#ff6b35", "#f7c59f", "#e63946", "#ffb703", "#9d0208"] },
    ocean:  { d: "#06141f", l: "#eaf4f8", c: ["#0077b6", "#00b4d8", "#90e0ef", "#48cae4", "#023e8a"] },
    forest: { d: "#0b140d", l: "#eef3e8", c: ["#2d6a4f", "#52b788", "#95d5b2", "#d8f3dc", "#1b4332"] },
    dusk:   { d: "#120c1f", l: "#f5eef8", c: ["#7b2cbf", "#c77dff", "#ff6d00", "#ff9e00", "#3c096c"] },
    pastel: { d: "#1d1b22", l: "#fbf8f3", c: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#a0c4ff", "#bdb2ff"] },
    mono:   { d: "#0e0e0e", l: "#f2f2f2", c: ["#e8e8e8", "#a8a8a8", "#6e6e6e", "#3a3a3a", "#1e1e1e"] }
  };

  // ---------- 1. Recipe ----------
  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function normSeed(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\s+/g, " ").trim().slice(0, SEED_LEN);
  }

  // Canonical form, fixed key order. null when it is not a recipe.
  function normRecipe(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    var seed = normSeed(r.seed);
    if (!seed) return null;
    return {
      seed:  seed,
      style: STYLES.indexOf(r.style) >= 0 ? r.style : "waves",
      pal:   PALETTES.indexOf(r.pal) >= 0 ? r.pal : "oros",
      dens:  clampInt(r.dens, 0, 100, 50),
      chaos: clampInt(r.chaos, 0, 100, 35),
      grain: r.grain === 1 || r.grain === true ? 1 : 0,
      light: r.light === 1 || r.light === true ? 1 : 0
    };
  }

  function defaultRecipe() {
    return normRecipe({ seed: "orOS", style: "waves", pal: "oros", dens: 50, chaos: 35, grain: 1, light: 0 });
  }

  var SYL = ["ka", "lo", "mi", "ra", "ne", "to", "su", "vi", "an", "el", "or", "is",
             "ze", "pa", "ro", "di", "mu", "fe", "ly", "no"];
  function randomSeed() {
    var r = new Uint32Array(4);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(r);
    else for (var i = 0; i < 4; i++) r[i] = Math.floor(Math.random() * 4294967296);
    return SYL[r[0] % SYL.length] + SYL[r[1] % SYL.length] + SYL[r[2] % SYL.length] +
           "-" + (100 + r[3] % 900);
  }

  // ---------- 2. Random numbers + noise ----------
  // FNV-1a, 32 bit
  function hash32(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tools(rnd) {
    return {
      rnd: rnd,
      rr: function (a, b) { return a + (b - a) * rnd(); },
      ri: function (n) { return Math.floor(rnd() * n); },
      pick: function (list) { return list[Math.floor(rnd() * list.length)]; }
    };
  }

  // 2D value noise on a 256 lattice, smooth-stepped, two octaves.
  function makeNoise(rnd) {
    var perm = new Uint8Array(512), val = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { perm[i] = i; val[i] = rnd(); }
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), tmp = perm[i];
      perm[i] = perm[j]; perm[j] = tmp;
    }
    for (i = 0; i < 256; i++) perm[i + 256] = perm[i];
    function lattice(x, y) { return val[perm[(perm[x & 255] + y) & 511]]; }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function one(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var sx = smooth(x - xi), sy = smooth(y - yi);
      var a = lattice(xi, yi), b = lattice(xi + 1, yi);
      var c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
      var top = a + (b - a) * sx, bot = c + (d - c) * sx;
      return top + (bot - top) * sy;
    }
    return function (x, y) { return (one(x, y) * 0.67 + one(x * 2.1 + 17.3, y * 2.1 - 9.1) * 0.33); };
  }

  // ---------- 3. Colour ----------
  function parseColor(s) {
    if (typeof s !== "string") return null;
    s = s.trim();
    var m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  function hex(rgb) {
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(rgb[i])));
      out += (v < 16 ? "0" : "") + v.toString(16);
    }
    return out;
  }

  function mix(a, b, t) {
    var x = parseColor(a), y = parseColor(b);
    return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }

  function rgba(c, a) {
    var x = parseColor(c);
    return "rgba(" + x[0] + "," + x[1] + "," + x[2] + "," + (Math.round(a * 1000) / 1000) + ")";
  }

  function toHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function fromHsl(h, s, l) {
    h = ((h % 1) + 1) % 1;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    function f(n) {
      var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
      return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    }
    return hex([f(0), f(8), f(4)]);
  }

  // The "orOS" palette: built from the skin's accent colour.
  function skinPalette(accent) {
    var hsl = toHsl(parseColor(accent) || parseColor("#d4af37"));
    var h = hsl[0], s = Math.max(hsl[1], 0.35), l = Math.min(Math.max(hsl[2], 0.4), 0.62);
    return {
      d: fromHsl(h, s * 0.35, 0.07),
      l: fromHsl(h, s * 0.3, 0.95),
      c: [fromHsl(h, s, l), fromHsl(h, s * 0.9, l + 0.2), fromHsl(h, s, l - 0.22),
          fromHsl(h + 0.08, s * 0.85, l + 0.05), fromHsl(h - 0.08, s * 0.85, l - 0.05)]
    };
  }

  function colors(recipe, accent) {
    var r = normRecipe(recipe) || defaultRecipe();
    var p = r.pal === "oros" ? skinPalette(accent) : PAL[r.pal];
    var light = !!r.light && r.style !== "nebula";   // a nebula is always night
    return { bg: light ? p.l : p.d, ink: p.c.slice(), light: light };
  }

  // Changes exactly when the picture does: the skin colour only
  // matters for the "orOS" palette.
  function key(recipe, accent) {
    var r = normRecipe(recipe);
    if (!r) return "";
    var a = r.pal === "oros" ? hex(parseColor(accent) || parseColor("#d4af37")) : "";
    return "v" + VER + "|" + JSON.stringify(r) + "|" + a;
  }

  // ---------- 4. Styles ----------
  // Each style returns a list of steps; a step is a function(ctx)
  // that draws a small part, so a large export can yield between
  // steps. Steps are created and run in order: the random numbers
  // come out in the same order on every run.
  function background(w, h, C) {
    return function (ctx) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, C.bg);
      g.addColorStop(1, mix(C.bg, C.ink[0], C.light ? 0.08 : 0.14));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
  }

  function waves(T, w, h, u, R, C) {
    var k = R.chaos / 100, out = [];
    var layers = 4 + Math.round(R.dens / 100 * 12);
    var pts = 360;
    for (var i = 0; i < layers; i++) {
      (function (i) {
        var t = (i + 1) / (layers + 1);
        var base = h * (0.12 + 0.82 * t) + T.rr(-0.04, 0.04) * u;
        var comps = [], n = 2 + Math.round(k * 3);
        for (var j = 0; j < n; j++) {
          comps.push({
            f: T.rr(0.6, 2.4 + k * 5) * TAU,
            p: T.rr(0, TAU),
            a: u * T.rr(0.012, 0.05) * (0.6 + k * 1.6) / Math.sqrt(j + 1)
          });
        }
        var col = C.ink[(i + T.ri(C.ink.length)) % C.ink.length];
        var crest = T.rnd() < 0.5;
        out.push(function (ctx) {
          var ys = [], top = Infinity;
          for (var q = 0; q <= pts; q++) {
            var x = w * q / pts, xn = x / u, y = base;
            for (var c = 0; c < comps.length; c++) y += comps[c].a * Math.sin(comps[c].f * xn + comps[c].p);
            ys.push(y);
            if (y < top) top = y;
          }
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (q = 0; q <= pts; q++) ctx.lineTo(w * q / pts, ys[q]);
          ctx.lineTo(w, h);
          ctx.closePath();
          var g = ctx.createLinearGradient(0, top, 0, h);
          g.addColorStop(0, rgba(col, 0.92));
          g.addColorStop(1, rgba(mix(col, C.bg, 0.65), 0.92));
          ctx.fillStyle = g;
          ctx.fill();
          if (crest) {
            ctx.beginPath();
            for (q = 0; q <= pts; q++) {
              if (q === 0) ctx.moveTo(0, ys[0]); else ctx.lineTo(w * q / pts, ys[q]);
            }
            ctx.strokeStyle = rgba(mix(col, C.light ? "#000000" : "#ffffff", 0.35), 0.45);
            ctx.lineWidth = u * 0.002;
            ctx.stroke();
          }
        });
      })(i);
    }
    return out;
  }

  function flow(T, w, h, u, R, C, A) {
    var k = R.chaos / 100, out = [];
    var noise = makeNoise(T.rnd);
    var lines = Math.round((250 + R.dens * 22) * A);
    var scale = 1.1 + k * 3.4, turn = TAU * (1.2 + k * 2.2);
    var step = u * 0.0035, margin = u * 0.05;
    var BATCH = 40;
    for (var b = 0; b < lines; b += BATCH) {
      (function (count) {
        out.push(function (ctx) {
          ctx.lineCap = "round";
          for (var i = 0; i < count; i++) {
            var x = T.rr(-margin, w + margin), y = T.rr(-margin, h + margin);
            var len = 50 + T.ri(90);
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (var s = 0; s < len; s++) {
              var a = noise(x / u * scale, y / u * scale) * turn;
              x += Math.cos(a) * step;
              y += Math.sin(a) * step;
              if (x < -margin || y < -margin || x > w + margin || y > h + margin) break;
              ctx.lineTo(x, y);
            }
            ctx.strokeStyle = rgba(T.pick(C.ink), T.rr(0.35, 0.85));
            ctx.lineWidth = u * T.rr(0.0012, 0.0036);
            ctx.stroke();
          }
        });
      })(Math.min(BATCH, lines - b));
    }
    return out;
  }

  function orbits(T, w, h, u, R, C) {
    var k = R.chaos / 100, out = [], centers = [], i;
    var nc = 1 + Math.floor(k * 3);
    for (i = 0; i < nc; i++) {
      centers.push(i === 0 ? { x: w * T.rr(0.3, 0.7), y: h * T.rr(0.3, 0.7) }
                           : { x: w * T.rr(0.05, 0.95), y: h * T.rr(0.05, 0.95) });
    }
    centers.forEach(function (c, ci) {
      var col = C.ink[ci % C.ink.length];
      var rad = u * T.rr(0.45, 0.75);
      out.push(function (ctx) {
        var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
        g.addColorStop(0, rgba(col, C.light ? 0.16 : 0.26));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
    });
    var rings = 14 + Math.round(R.dens * 0.7);
    var BATCH = 12;
    for (var b = 0; b < rings; b += BATCH) {
      (function (count) {
        out.push(function (ctx) {
          ctx.lineCap = "round";
          for (var j = 0; j < count; j++) {
            var c = T.pick(centers);
            var r = u * T.rr(0.04, 0.78);
            var sq = 1 - T.rr(0, 0.12 + k * 0.6);
            var rot = T.rr(0, Math.PI);
            var st = T.rr(0, TAU);
            var len = T.rr(0.25 + (1 - k) * 2.5, TAU);
            var soft = T.rnd() < 0.15;
            var col = T.pick(C.ink);
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, r, r * sq, rot, st, st + len);
            ctx.strokeStyle = rgba(col, soft ? 0.12 : T.rr(0.4, 0.9));
            ctx.lineWidth = soft ? u * T.rr(0.015, 0.03) : u * T.rr(0.001, 0.007);
            ctx.stroke();
            if (T.rnd() < 0.3) {
              var e = st + len, ce = Math.cos(e), se = Math.sin(e);
              var px = c.x + r * ce * Math.cos(rot) - r * sq * se * Math.sin(rot);
              var py = c.y + r * ce * Math.sin(rot) + r * sq * se * Math.cos(rot);
              ctx.beginPath();
              ctx.arc(px, py, u * T.rr(0.004, 0.014), 0, TAU);
              ctx.fillStyle = rgba(col, 0.95);
              ctx.fill();
            }
          }
        });
      })(Math.min(BATCH, rings - b));
    }
    return out;
  }

  function grid(T, w, h, u, R, C) {
    var k = R.chaos / 100, out = [];
    var n = 3 + Math.round(R.dens / 100 * 13);
    var s = u / n;
    var cols = Math.ceil(w / s), rows = Math.ceil(h / s);
    var ox = (w - cols * s) / 2, oy = (h - rows * s) / 2;
    var tones = [C.bg].concat(C.ink);
    for (var r = 0; r < rows; r++) {
      (function (r) {
        out.push(function (ctx) {
          for (var c = 0; c < cols; c++) {
            var x = ox + c * s, y = oy + r * s;
            var back = T.rnd() < 0.5 ? T.pick(tones) : C.bg;
            var fore = T.pick(C.ink);
            if (fore === back) fore = C.ink[(C.ink.indexOf(fore) + 1) % C.ink.length];
            var shape = T.ri(7), turn = T.ri(4);
            var empty = T.rnd() < k * 0.35;
            var jx = T.rr(-1, 1) * k * 0.22 * s, jy = T.rr(-1, 1) * k * 0.22 * s;
            var sc = 1 + T.rr(-1, 1) * k * 0.3, tilt = T.rr(-0.5, 0.5) * k;
            ctx.fillStyle = back;
            ctx.fillRect(x, y, s + 0.5, s + 0.5);
            if (empty) continue;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, s + 0.5, s + 0.5);
            ctx.clip();
            ctx.translate(x + s / 2 + jx, y + s / 2 + jy);
            ctx.rotate(turn * Math.PI / 2 + tilt);
            ctx.scale(sc, sc);
            ctx.fillStyle = fore;
            ctx.strokeStyle = fore;
            var hs = s / 2;
            ctx.beginPath();
            if (shape === 0) {                       // circle
              ctx.arc(0, 0, hs * 0.82, 0, TAU); ctx.fill();
            } else if (shape === 1) {                // quarter disc from a corner
              ctx.moveTo(-hs, -hs); ctx.arc(-hs, -hs, s, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
            } else if (shape === 2) {                // half disc
              ctx.arc(0, hs, hs, Math.PI, TAU); ctx.closePath(); ctx.fill();
            } else if (shape === 3) {                // triangle (half the cell)
              ctx.moveTo(-hs, -hs); ctx.lineTo(hs, -hs); ctx.lineTo(-hs, hs); ctx.closePath(); ctx.fill();
            } else if (shape === 4) {                // inset square
              ctx.rect(-hs * 0.55, -hs * 0.55, hs * 1.1, hs * 1.1); ctx.fill();
            } else if (shape === 5) {                // stripes
              for (var q = 0; q < 3; q++) ctx.rect(-hs, -hs + q * s / 3 + s / 12, s, s / 6);
              ctx.fill();
            } else {                                 // ring
              ctx.arc(0, 0, hs * 0.62, 0, TAU);
              ctx.lineWidth = s * 0.14;
              ctx.stroke();
            }
            ctx.restore();
          }
        });
      })(r);
    }
    return out;
  }

  function nebula(T, w, h, u, R, C, A) {
    var k = R.chaos / 100, out = [];
    out.push(function (ctx) {
      ctx.fillStyle = rgba("#000000", 0.35);
      ctx.fillRect(0, 0, w, h);
    });
    var clouds = 5 + Math.round(R.dens * 0.12);
    for (var i = 0; i < clouds; i++) {
      (function () {
        var cx = w * T.rr(0.05, 0.95), cy = h * T.rr(0.05, 0.95);
        var spread = u * (0.12 + k * 0.45);
        var col = T.pick(C.ink);
        var blobs = 6 + T.ri(5);
        out.push(function (ctx) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          for (var b = 0; b < blobs; b++) {
            var x = cx + T.rr(-1, 1) * spread, y = cy + T.rr(-1, 1) * spread;
            var r = u * T.rr(0.1, 0.42);
            var g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, rgba(col, T.rr(0.1, 0.22)));
            g.addColorStop(0.6, rgba(col, 0.05));
            g.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }
          ctx.restore();
        });
      })();
    }
    var stars = Math.round((150 + R.dens * 12) * A);
    var BATCH = 300;
    for (var s = 0; s < stars; s += BATCH) {
      (function (count) {
        out.push(function (ctx) {
          for (var j = 0; j < count; j++) {
            var x = T.rr(0, w), y = T.rr(0, h);
            var big = Math.pow(T.rnd(), 6);
            var r = u * 0.0007 * (1 + big * 5);
            var tint = T.rnd() < 0.25 ? mix("#ffffff", T.pick(C.ink), 0.4) : "#ffffff";
            var a = T.rr(0.3, 1);
            if (big > 0.8) {
              var g = ctx.createRadialGradient(x, y, 0, x, y, r * 8);
              g.addColorStop(0, rgba(tint, 0.5 * a));
              g.addColorStop(1, rgba(tint, 0));
              ctx.fillStyle = g;
              ctx.fillRect(x - r * 8, y - r * 8, r * 16, r * 16);
            }
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fillStyle = rgba(tint, a);
            ctx.fill();
          }
        });
      })(Math.min(BATCH, stars - s));
    }
    return out;
  }

  var STYLE_FN = { waves: waves, flow: flow, orbits: orbits, grid: grid, nebula: nebula };

  // Film grain: one seeded 128×128 noise tile, repeated.
  function grain(recipe, C, w, h, makeCanvas) {
    return function (ctx) {
      var tile = makeCanvas ? makeCanvas(128, 128) : null;
      if (!tile) return;
      var tctx = tile.getContext("2d");
      var img = tctx.createImageData(128, 128);
      var rnd = prng(hash32("grain|" + recipe.seed));
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.floor(rnd() * 256);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.globalAlpha = C.light ? 0.06 : 0.08;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = ctx.createPattern(tile, "repeat");
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    };
  }

  function defaultMakeCanvas(w, h) {
    try {
      if (typeof root.OffscreenCanvas === "function") return new root.OffscreenCanvas(w, h);
      if (root.document) {
        var c = root.document.createElement("canvas");
        c.width = w; c.height = h;
        return c;
      }
    } catch (e) {}
    return null;
  }

  // ---------- 5. Runner ----------
  function steps(ctx, w, h, recipe, o) {
    o = o || {};
    var R = normRecipe(recipe) || defaultRecipe();
    var C = colors(R, o.accent);
    var u = Math.min(w, h);
    var A = (w * h) / (u * u);
    var T = tools(prng(hash32(R.style + "|" + R.seed)));
    var list = [background(w, h, C)].concat(STYLE_FN[R.style](T, w, h, u, R, C, A));
    if (R.grain) list.push(grain(R, C, w, h, o.makeCanvas || defaultMakeCanvas));
    // every step starts from a clean state
    return list.map(function (fn) {
      return function () {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        fn(ctx);
        ctx.restore();
      };
    });
  }

  function renderSync(ctx, w, h, recipe, o) {
    var list = steps(ctx, w, h, recipe, o);
    for (var i = 0; i < list.length; i++) list[i]();
  }

  // Runs the steps in time slices (default 12 ms) so the page stays
  // responsive while a 4K or 8K picture is drawn.
  function render(ctx, w, h, recipe, o) {
    o = o || {};
    var list = steps(ctx, w, h, recipe, o);
    var slice = o.slice || 12, i = 0;
    var now = (root.performance && root.performance.now) ? function () { return root.performance.now(); } : Date.now;
    return new Promise(function (resolve, reject) {
      function run() {
        if (o.cancelled && o.cancelled()) { resolve(false); return; }
        var t0 = now();
        try {
          while (i < list.length) {
            list[i++]();
            if (now() - t0 > slice) break;
          }
        } catch (e) { reject(e); return; }
        if (o.onProgress) { try { o.onProgress(i / list.length); } catch (e2) {} }
        if (i < list.length) setTimeout(run, 0);
        else resolve(true);
      }
      run();
    });
  }

  root.OrosWallArt = {
    VER: VER,
    STYLES: STYLES.slice(),
    PALETTES: PALETTES.slice(),
    SEED_LEN: SEED_LEN,
    normRecipe: normRecipe,
    defaultRecipe: defaultRecipe,
    randomSeed: randomSeed,
    colors: colors,
    key: key,
    steps: steps,
    renderSync: renderSync,
    render: render
  };
})(typeof window !== "undefined" ? window : this);
