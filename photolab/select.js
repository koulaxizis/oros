// ============================================================
// orOS Photo Lab — selections (no DOM)
// A selection is a mask over the canvas: { w, h, data: Uint8Array }
// with 0 = outside, 255 = inside, values between = partly selected
// (feathered or anti-aliased edges). null means "nothing selected"
// (tools then work on the whole layer).
//
//   rect(w, h, r), ellipse(w, h, r), polygon(w, h, pts)
//   wand(img, x, y, tol, contiguous)   img = { w, h, data RGBA }
//   combine(a, b, mode)   mode: "replace" | "add" | "sub" | "and"
//   invert(m), feather(m, radius), grow(m, px), bounds(m), isEmpty(m)
//   all(w, h), cover(m, x, y)  0-255 at a canvas pixel (255 if m null)
//
// UMD: module.exports in Node (tests), window.PhotoLab.select in the app.
// ============================================================
(function (root) {
  "use strict";

  function make(w, h) { return { w: w, h: h, data: new Uint8Array(w * h) }; }
  function all(w, h) { var m = make(w, h); m.data.fill(255); return m; }

  function rect(w, h, r) {
    var m = make(w, h);
    var x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
    var x1 = Math.min(w, Math.round(r.x + r.w)), y1 = Math.min(h, Math.round(r.y + r.h));
    for (var y = y0; y < y1; y++) m.data.fill(255, y * w + x0, y * w + Math.max(x0, x1));
    return m;
  }

  // Anti-aliased: 4×4 samples per edge pixel.
  function ellipse(w, h, r) {
    var m = make(w, h);
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
    if (rx <= 0 || ry <= 0) return m;
    var y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(h, Math.ceil(r.y + r.h));
    var x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(w, Math.ceil(r.x + r.w));
    function inside(px, py) { var dx = (px - cx) / rx, dy = (py - cy) / ry; return dx * dx + dy * dy <= 1; }
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var a = inside(x, y), b = inside(x + 1, y), c = inside(x, y + 1), d = inside(x + 1, y + 1);
        if (a && b && c && d) { m.data[y * w + x] = 255; continue; }
        if (!a && !b && !c && !d && !inside(x + 0.5, y + 0.5)) continue;
        var n = 0;
        for (var sy = 0; sy < 4; sy++) for (var sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
        m.data[y * w + x] = Math.round(n * 255 / 16);
      }
    }
    return m;
  }

  // Even-odd scanline fill at pixel centres; pts = [{x, y}] closed.
  function polygon(w, h, pts) {
    var m = make(w, h);
    if (!pts || pts.length < 3) return m;
    var n = pts.length, ys = [];
    var miny = Infinity, maxy = -Infinity;
    for (var i = 0; i < n; i++) { miny = Math.min(miny, pts[i].y); maxy = Math.max(maxy, pts[i].y); }
    var y0 = Math.max(0, Math.floor(miny)), y1 = Math.min(h - 1, Math.ceil(maxy));
    for (var y = y0; y <= y1; y++) {
      var cy = y + 0.5;
      ys.length = 0;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var pa = pts[a], pb = pts[b];
        if ((pa.y > cy) !== (pb.y > cy)) ys.push(pa.x + (cy - pa.y) * (pb.x - pa.x) / (pb.y - pa.y));
      }
      ys.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < ys.length; k += 2) {
        var xs = Math.max(0, Math.ceil(ys[k] - 0.5)), xe = Math.min(w - 1, Math.floor(ys[k + 1] - 0.5));
        if (xe >= xs) m.data.fill(255, y * w + xs, y * w + xe + 1);
      }
    }
    return m;
  }

  // Magic wand: pixels whose colour (and alpha) is within tol (0-255,
  // largest channel difference) of the clicked pixel. contiguous =
  // flood fill (4-neighbours) from the click, else the whole image.
  function wand(img, x, y, tol, contiguous) {
    var w = img.w, h = img.h, d = img.data, m = make(w, h);
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return m;
    var o = (y * w + x) * 4, r = d[o], g = d[o + 1], b = d[o + 2], al = d[o + 3];
    tol = Math.max(0, Math.min(255, tol | 0));
    function near(p) {
      var q = p * 4;
      return Math.abs(d[q] - r) <= tol && Math.abs(d[q + 1] - g) <= tol &&
             Math.abs(d[q + 2] - b) <= tol && Math.abs(d[q + 3] - al) <= tol;
    }
    if (!contiguous) {
      for (var p = 0; p < w * h; p++) if (near(p)) m.data[p] = 255;
      return m;
    }
    // Scanline flood fill, explicit stack (no recursion).
    var stack = [x, y];
    while (stack.length) {
      var sy = stack.pop(), sx = stack.pop();
      var lx = sx;
      while (lx >= 0 && !m.data[sy * w + lx] && near(sy * w + lx)) lx--;
      lx++;
      var upOpen = false, downOpen = false;
      for (var cx = lx; cx < w; cx++) {
        var pi = sy * w + cx;
        if (m.data[pi] || !near(pi)) break;
        m.data[pi] = 255;
        if (sy > 0) {
          var u = pi - w, uo = !m.data[u] && near(u);
          if (uo && !upOpen) stack.push(cx, sy - 1);
          upOpen = uo;
        }
        if (sy < h - 1) {
          var dn = pi + w, dno = !m.data[dn] && near(dn);
          if (dno && !downOpen) stack.push(cx, sy + 1);
          downOpen = dno;
        }
      }
    }
    return m;
  }

  function combine(a, b, mode) {
    // a = the current selection (null: none), b = the new shape.
    if (mode === "sub") { if (!a) return null; if (!b) return a; }
    else if (mode !== "add" && mode !== "and") return b;
    if (!a) return b;
    if (!b) return a;
    var out = make(a.w, a.h), A = a.data, B = b.data, O = out.data;
    for (var i = 0; i < O.length; i++) {
      if (mode === "add") O[i] = Math.max(A[i], B[i]);
      else if (mode === "sub") O[i] = Math.min(A[i], 255 - B[i]);
      else O[i] = Math.min(A[i], B[i]);
    }
    return out;
  }

  function invert(m) {
    var out = make(m.w, m.h);
    for (var i = 0; i < m.data.length; i++) out.data[i] = 255 - m.data[i];
    return out;
  }

  // Three box blurs ≈ a Gaussian of the given radius.
  function boxPass(src, dst, w, h, r, horiz) {
    var len = horiz ? w : h, lines = horiz ? h : w, win = r * 2 + 1;
    function at(l, k) {
      k = k < 0 ? 0 : (k >= len ? len - 1 : k);
      return src[horiz ? l * w + k : k * w + l];
    }
    for (var l = 0; l < lines; l++) {
      var sum = 0, i;
      for (i = -r; i <= r; i++) sum += at(l, i);
      for (i = 0; i < len; i++) {
        dst[horiz ? l * w + i : i * w + l] = Math.round(sum / win);
        sum += at(l, i + r + 1) - at(l, i - r);
      }
    }
  }
  function feather(m, radius) {
    radius = Math.max(0, Math.min(250, Math.round(radius)));
    if (!radius) return m;
    var r = Math.max(1, Math.round(radius / 2));
    var a = new Uint8Array(m.data), b = new Uint8Array(a.length);
    for (var pass = 0; pass < 3; pass++) {
      boxPass(a, b, m.w, m.h, r, true);
      boxPass(b, a, m.w, m.h, r, false);
    }
    return { w: m.w, h: m.h, data: a };
  }

  // Grow (px > 0) or shrink (px < 0), square neighbourhood, by
  // separable max / min.
  function grow(m, px) {
    px = Math.round(px);
    if (!px) return m;
    var r = Math.min(100, Math.abs(px)), shrink = px < 0, w = m.w, h = m.h;
    var a = m.data, tmp = new Uint8Array(a.length), out = new Uint8Array(a.length);
    function pass(src, dst, horiz) {
      var len = horiz ? w : h, lines = horiz ? h : w;
      for (var l = 0; l < lines; l++) {
        for (var i = 0; i < len; i++) {
          var best = shrink ? 255 : 0;
          // The canvas edge neither grows nor erodes the selection.
          var k0 = Math.max(0, i - r), k1 = Math.min(len - 1, i + r);
          for (var k = k0; k <= k1; k++) {
            var v = src[horiz ? l * w + k : k * w + l];
            if (shrink ? v < best : v > best) best = v;
          }
          dst[horiz ? l * w + i : i * w + l] = best;
        }
      }
    }
    pass(a, tmp, true);
    pass(tmp, out, false);
    return { w: w, h: h, data: out };
  }

  function bounds(m) {
    if (!m) return null;
    var x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
    for (var y = 0; y < m.h; y++) {
      var row = y * m.w;
      for (var x = 0; x < m.w; x++) {
        if (!m.data[row + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function isEmpty(m) { return !m || bounds(m) === null; }

  function cover(m, x, y) {
    if (!m) return 255;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 0;
    return m.data[y * m.w + x];
  }

  // Marching-ants outline: horizontal and vertical edge segments
  // between pixels at >= 128 and < 128, as [x0, y0, x1, y1] runs.
  function outline(m) {
    var segs = [], w = m.w, h = m.h, d = m.data;
    function on(x, y) { return x >= 0 && y >= 0 && x < w && y < h && d[y * w + x] >= 128; }
    for (var y = 0; y <= h; y++) {
      var start = -1;
      for (var x = 0; x <= w; x++) {
        var edge = x < w && on(x, y) !== on(x, y - 1);
        if (edge && start < 0) start = x;
        if (!edge && start >= 0) { segs.push([start, y, x, y]); start = -1; }
      }
    }
    for (var x2 = 0; x2 <= w; x2++) {
      var s2 = -1;
      for (var y2 = 0; y2 <= h; y2++) {
        var e2 = y2 < h && on(x2, y2) !== on(x2 - 1, y2);
        if (e2 && s2 < 0) s2 = y2;
        if (!e2 && s2 >= 0) { segs.push([x2, s2, x2, y2]); s2 = -1; }
      }
    }
    return segs;
  }

  var API = {
    make: make, all: all, rect: rect, ellipse: ellipse, polygon: polygon, wand: wand,
    combine: combine, invert: invert, feather: feather, grow: grow, bounds: bounds,
    isEmpty: isEmpty, cover: cover, outline: outline
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.select = API; }
})(typeof window !== "undefined" ? window : this);
