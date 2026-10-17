// ============================================================
// orOS Scanner & PDF — scan.js: the pure parts of camera scanning
// ------------------------------------------------------------
// Pictures are { data: RGBA Uint8ClampedArray, width, height } (an
// ImageData, or a plain object in Node). Nothing here touches the
// DOM, the camera or storage; scanpdf.js does.
//   detectQuad(img)        where the sheet of paper is (four corners)
//   homography / warp      straighten it (perspective correction)
//   filter(img, mode)      "color" (cleaned), "gray", "bw", "photo"
//   rotate90, steady, ...  small helpers for the scan screens
// Detection: the sheet is taken to cover the middle of the picture
// and to differ in brightness from what is around it. Otsu splits the
// blurred grey picture, the region under the middle is followed, its
// extreme points give rough corners, and a straight line fitted to
// each side gives the exact ones. When that fails, null: the screens
// then offer the whole picture with handles to set by hand.
// UMD: window.ScanPdfScan, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var C = (typeof module !== "undefined" && module.exports) ? require("./core.js") : root.ScanPdfCore;

  var DETECT_SIDE = 320;                    // detection works on pictures about this big
  var MAX_OUT_SIDE = 2400;                  // a straightened page, long side in pixels
  var FILTERS = ["color", "gray", "bw", "photo"];

  // ---------- Grey, blur ----------
  function toGray(img) {
    var d = img.data, n = img.width * img.height, g = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }
  // Box blur of radius r (two passes: rows, then columns).
  function blur(g, w, h, r) {
    var tmp = new Uint8Array(g.length), out = new Uint8Array(g.length), x, y, s, k, cnt;
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) {
        s = 0; cnt = 0;
        for (k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < w) { s += g[row + xx]; cnt++; } }
        tmp[row + x] = s / cnt;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        s = 0; cnt = 0;
        for (k = -r; k <= r; k++) { var yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; cnt++; } }
        out[y * w + x] = s / cnt;
      }
    }
    return out;
  }

  // ---------- Quads ----------
  // Four points → top-left, top-right, bottom-right, bottom-left.
  function orderQuad(pts) {
    var p = pts.map(function (q) { return [q[0], q[1]]; });
    function by(f, max) { return p.reduce(function (a, b) { return (max ? f(b) > f(a) : f(b) < f(a)) ? b : a; }); }
    var tl = by(function (q) { return q[0] + q[1]; }, false), br = by(function (q) { return q[0] + q[1]; }, true);
    var tr = by(function (q) { return q[0] - q[1]; }, true), bl = by(function (q) { return q[0] - q[1]; }, false);
    return [tl, tr, br, bl];
  }
  function quadArea(q) {
    var a = 0;
    for (var i = 0; i < 4; i++) { var p = q[i], n = q[(i + 1) % 4]; a += p[0] * n[1] - n[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  // Convex and turning one way (no crossed or folded corners).
  function isConvex(q) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      var z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(z) < 1e-9) return false;
      var s = z > 0 ? 1 : -1;
      if (!sign) sign = s; else if (s !== sign) return false;
    }
    return true;
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  // The size of the straightened page: its sides as long as the longer
  // of each pair, the long side at most `max` pixels.
  function outSize(q, max) {
    var w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    var s = Math.min(1, (max || MAX_OUT_SIDE) / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }
  function fullQuad(w, h, inset) {
    var x = w * (inset || 0), y = h * (inset || 0);
    return [[x, y], [w - x, y], [w - x, h - y], [x, h - y]];
  }
  function scaleQuad(q, sx, sy) { return q.map(function (p) { return [p[0] * sx, p[1] * (sy == null ? sx : sy)]; }); }
  // Keep the corners on the picture.
  function clampQuad(q, w, h) {
    return q.map(function (p) { return [Math.max(0, Math.min(w, p[0])), Math.max(0, Math.min(h, p[1]))]; });
  }

  // ---------- Detection ----------
  // img should be small (about DETECT_SIDE); returns { quad, area }
  // in its pixels, area as a fraction of the picture, or null.
  function detectQuad(img) {
    var w = img.width, h = img.height, n = w * h;
    if (w < 16 || h < 16) return null;
    var g = blur(blur(toGray(img), w, h, 2), w, h, 2);
    var hist = new Array(256), i, x, y;
    for (i = 0; i < 256; i++) hist[i] = 0;
    for (i = 0; i < n; i++) hist[g[i]]++;
    var thr = C.otsu(hist);
    // which side of the split is the sheet: the one under the middle
    var cs = 0, cn = 0;
    for (y = Math.floor(h * 0.4); y < h * 0.6; y++) for (x = Math.floor(w * 0.4); x < w * 0.6; x++) { cs += g[y * w + x]; cn++; }
    var bright = cs / cn > thr;
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = (g[i] > thr) === bright ? 1 : 0;
    // the region holding the middle (or the mask pixel nearest it)
    var seed = -1, best = Infinity, cx = w >> 1, cy = h >> 1;
    for (y = Math.floor(h * 0.3); y < h * 0.7; y++) {
      for (x = Math.floor(w * 0.3); x < w * 0.7; x++) {
        var k = y * w + x;
        if (mask[k]) { var dd = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (dd < best) { best = dd; seed = k; } }
      }
    }
    if (seed < 0) return null;
    var comp = new Uint8Array(n), queue = new Int32Array(n), qh = 0, qt = 0, area = 0;
    comp[seed] = 1; queue[qt++] = seed;
    while (qh < qt) {
      var p = queue[qh++], px = p % w, py = (p - px) / w;
      area++;
      if (px > 0 && mask[p - 1] && !comp[p - 1]) { comp[p - 1] = 1; queue[qt++] = p - 1; }
      if (px < w - 1 && mask[p + 1] && !comp[p + 1]) { comp[p + 1] = 1; queue[qt++] = p + 1; }
      if (py > 0 && mask[p - w] && !comp[p - w]) { comp[p - w] = 1; queue[qt++] = p - w; }
      if (py < h - 1 && mask[p + w] && !comp[p + w]) { comp[p + w] = 1; queue[qt++] = p + w; }
    }
    var frac = area / n;
    if (frac < 0.1 || frac > 0.97) return null;
    // rough corners: the extreme points of the region
    var mins = Infinity, maxs = -Infinity, mind = Infinity, maxd = -Infinity, tl, br, tr, bl;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (!comp[y * w + x]) continue;
        var s = x + y, d = x - y;
        if (s < mins) { mins = s; tl = [x, y]; }
        if (s > maxs) { maxs = s; br = [x, y]; }
        if (d > maxd) { maxd = d; tr = [x, y]; }
        if (d < mind) { mind = d; bl = [x, y]; }
      }
    }
    var rough = [tl, tr, br, bl];
    if (!isConvex(rough)) return null;
    var quad = refine(comp, w, h, rough) || rough;
    // a sheet of paper fills most of its outline
    var qa = quadArea(quad);
    if (!(qa > 0) || area / qa < 0.82 || area / qa > 1.12) return null;
    // a little inside the edge, so no line of the desk shows on the page
    var mx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4, my = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
    quad = quad.map(function (p) {
      var dx = mx - p[0], dy = my - p[1], L = Math.hypot(dx, dy) || 1, k = Math.min(1.5, L * 0.05) / L;
      return [p[0] + dx * k, p[1] + dy * k];
    });
    return { quad: quad, area: Math.round(frac * 1000) / 1000 };
  }

  // Fit a straight line to the edge points of each side and meet them.
  function refine(comp, w, h, q) {
    var sides = [[], [], [], []], diag = Math.hypot(w, h), lim = diag * 0.06;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var k = y * w + x;
        if (!comp[k] || (comp[k - 1] && comp[k + 1] && comp[k - w] && comp[k + w])) continue;
        var bestS = -1, bestD = lim;
        for (var s = 0; s < 4; s++) {
          var d = segDist([x, y], q[s], q[(s + 1) % 4]);
          if (d < bestD) { bestD = d; bestS = s; }
        }
        if (bestS >= 0) sides[bestS].push([x, y]);
      }
    }
    var lines = sides.map(fitLine);
    if (lines.some(function (l) { return !l; })) return null;
    var out = [];
    for (var i = 0; i < 4; i++) {
      var p = meet(lines[(i + 3) % 4], lines[i]);
      if (!p || p[0] < -w * 0.05 || p[0] > w * 1.05 || p[1] < -h * 0.05 || p[1] > h * 1.05) return null;
      out.push(p);
    }
    if (!isConvex(out)) return null;
    var ra = quadArea(q), oa = quadArea(out);
    if (oa < ra * 0.85 || oa > ra * 1.3) return null;
    return clampQuad(out, w, h);
  }
  function segDist(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
    var t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  }
  // Total least squares: { x0, y0 (a point), dx, dy (direction) }.
  function fitLine(pts) {
    if (pts.length < 8) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < pts.length; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= pts.length; my /= pts.length;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < pts.length; i++) {
      var ax = pts[i][0] - mx, ay = pts[i][1] - my;
      sxx += ax * ax; syy += ay * ay; sxy += ax * ay;
    }
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { x0: mx, y0: my, dx: Math.cos(th), dy: Math.sin(th) };
  }
  function meet(a, b) {
    var den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-6) return null;
    var t = ((b.x0 - a.x0) * b.dy - (b.y0 - a.y0) * b.dx) / den;
    return [a.x0 + t * a.dx, a.y0 + t * a.dy];
  }

  // ---------- Perspective ----------
  // The 3 × 3 matrix (9 numbers, last 1) taking each src point to dst.
  function homography(src, dst) {
    var A = [], b = [], i;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var h = solve(A, b);
    return h ? h.concat([1]) : null;
  }
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (j = i + 1; j < n; j++) {
        var f = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }
  function applyH(H, x, y) {
    var z = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
  }
  // The sheet inside `quad` (tl, tr, br, bl) of img, straightened into
  // ow × oh pixels (bilinear).
  function warp(img, quad, ow, oh, make) {
    var H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], quad);
    var out = make ? make(ow, oh) : { data: new Uint8ClampedArray(ow * oh * 4), width: ow, height: oh };
    if (!H) return out;
    var d = img.data, w = img.width, h = img.height, o = out.data;
    for (var y = 0; y < oh; y++) {
      for (var x = 0; x < ow; x++) {
        var X = x + 0.5, Y = y + 0.5;
        var z = H[6] * X + H[7] * Y + H[8];
        var sx = (H[0] * X + H[1] * Y + H[2]) / z - 0.5, sy = (H[3] * X + H[4] * Y + H[5]) / z - 0.5;
        var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        if (x0 < 0) { x0 = 0; fx = 0; } else if (x0 >= w - 1) { x0 = w - 2; fx = 1; }
        if (y0 < 0) { y0 = 0; fy = 0; } else if (y0 >= h - 1) { y0 = h - 2; fy = 1; }
        var i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4, oi = (y * ow + x) * 4;
        for (var c = 0; c < 3; c++) {
          var top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx, bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
          o[oi + c] = top + (bot - top) * fy;
        }
        o[oi + 3] = 255;
      }
    }
    return out;
  }

  // ---------- Filters ----------
  // In place. "color": the paper made white and even (shadows and the
  // paper's tint divided away); "gray": the same in grey; "bw": clean
  // black and white (a threshold from the neighbourhood of each pixel,
  // so shadows don't turn black); "photo": as taken.
  function filter(img, mode) {
    if (mode === "photo" || FILTERS.indexOf(mode) === -1) return img;
    if (mode === "bw") return bw(img);
    whiten(img);
    if (mode === "gray") {
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) { var g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = d[i + 1] = d[i + 2] = g; }
    }
    return img;
  }
  // The paper's colour around each pixel: the brightest of small blocks,
  // smoothed, then each pixel divided by it.
  function whiten(img) {
    var w = img.width, h = img.height, d = img.data;
    var bs = Math.max(8, Math.round(Math.max(w, h) / 40)), bw_ = Math.ceil(w / bs), bh = Math.ceil(h / bs);
    var bg = [new Float32Array(bw_ * bh), new Float32Array(bw_ * bh), new Float32Array(bw_ * bh)];
    var bx, by, x, y, c;
    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw_; bx++) {
        // the mean colour of the brightest tenth (not the maximum, so a
        // speck of glare doesn't count)
        var hist = new Uint32Array(256), cnt = 0, xe = Math.min(w, (bx + 1) * bs), ye = Math.min(h, (by + 1) * bs), i;
        for (y = by * bs; y < ye; y += 2) for (x = bx * bs; x < xe; x += 2) {
          i = (y * w + x) * 4; hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; cnt++;
        }
        var lim = 255, acc = 0;
        while (lim > 0 && acc + hist[lim] < cnt * 0.1) { acc += hist[lim]; lim--; }
        var sr = 0, sg = 0, sb = 0, sn = 0;
        for (y = by * bs; y < ye; y += 2) for (x = bx * bs; x < xe; x += 2) {
          i = (y * w + x) * 4;
          if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) >= lim) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sn++; }
        }
        sn = sn || 1;
        bg[0][by * bw_ + bx] = sr / sn; bg[1][by * bw_ + bx] = sg / sn; bg[2][by * bw_ + bx] = sb / sn;
      }
    }
    // smooth the block colours (3 × 3), so text-heavy blocks borrow from their neighbours
    bg = bg.map(function (m) { return smoothMax(m, bw_, bh); });
    for (y = 0; y < h; y++) {
      var gy = Math.min(bh - 1, Math.max(0, (y + 0.5) / bs - 0.5)), y0 = Math.floor(gy), y1 = Math.min(bh - 1, y0 + 1), fy = gy - y0;
      for (x = 0; x < w; x++) {
        var gx = Math.min(bw_ - 1, Math.max(0, (x + 0.5) / bs - 0.5)), x0 = Math.floor(gx), x1 = Math.min(bw_ - 1, x0 + 1), fx = gx - x0;
        var o = (y * w + x) * 4;
        for (c = 0; c < 3; c++) {
          var m = bg[c];
          var v = (m[y0 * bw_ + x0] * (1 - fx) + m[y0 * bw_ + x1] * fx) * (1 - fy) + (m[y1 * bw_ + x0] * (1 - fx) + m[y1 * bw_ + x1] * fx) * fy;
          var r = d[o + c] * 255 / Math.max(48, v);
          d[o + c] = r >= 255 ? 255 : GAMMA[r | 0];
        }
      }
    }
    return img;
  }
  // a little more contrast once the paper is white: the ink a touch darker
  var GAMMA = new Uint8Array(256);
  for (var gi = 0; gi < 256; gi++) GAMMA[gi] = Math.round(255 * Math.pow(gi / 255, 1.35));
  function smoothMax(m, w, h) {
    var out = new Float32Array(m.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var mx = 0, s = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            var v = m[yy * w + xx];
            s += v; n++; if (v > mx) mx = v;
          }
        }
        out[y * w + x] = (mx + s / n) / 2;
      }
    }
    return out;
  }
  // Bradley's threshold: darker than the mean of the window by t → ink.
  function bw(img) {
    var w = img.width, h = img.height, d = img.data, g = toGray(img);
    var I = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var rs = 0;
      for (x = 0; x < w; x++) { rs += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + rs; }
    }
    var r = Math.max(7, Math.round(Math.max(w, h) / 48)), t = 0.13;
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var cnt = (x1 - x0) * (y1 - y0);
        var sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        var v = g[y * w + x] * cnt <= sum * (1 - t) ? 0 : 255, o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    }
    return img;
  }

  // A quarter turn: dir 1 clockwise, -1 counter-clockwise.
  function rotate90(img, dir, make) {
    var w = img.width, h = img.height, out = make ? make(h, w) : { data: new Uint8ClampedArray(w * h * 4), width: h, height: w };
    var s = img.data, o = out.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var nx = dir > 0 ? h - 1 - y : y, ny = dir > 0 ? x : w - 1 - x;
        var si = (y * w + x) * 4, oi = (ny * h + nx) * 4;
        o[oi] = s[si]; o[oi + 1] = s[si + 1]; o[oi + 2] = s[si + 2]; o[oi + 3] = s[si + 3];
      }
    }
    return out;
  }

  // Auto-capture: the last `need` outlines (corners as fractions of the
  // picture) all within `tol` of the newest one.
  function steady(list, need, tol) {
    if (!list || list.length < need) return false;
    var last = list[list.length - 1];
    if (!last) return false;
    for (var i = list.length - need; i < list.length; i++) {
      var q = list[i];
      if (!q) return false;
      for (var k = 0; k < 4; k++) if (Math.abs(q[k][0] - last[k][0]) > tol || Math.abs(q[k][1] - last[k][1]) > tol) return false;
    }
    return true;
  }

  var api = {
    DETECT_SIDE: DETECT_SIDE, MAX_OUT_SIDE: MAX_OUT_SIDE, FILTERS: FILTERS,
    toGray: toGray, blur: blur, orderQuad: orderQuad, quadArea: quadArea, isConvex: isConvex, outSize: outSize,
    fullQuad: fullQuad, scaleQuad: scaleQuad, clampQuad: clampQuad, detectQuad: detectQuad, fitLine: fitLine,
    homography: homography, applyH: applyH, warp: warp, filter: filter, rotate90: rotate90, steady: steady
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfScan = api;
})(typeof window !== "undefined" ? window : this);
