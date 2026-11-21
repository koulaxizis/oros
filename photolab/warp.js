// ============================================================
// orOS Photo Lab — warp engine (wave PS-5, no DOM)
// The geometry behind Edit › Transform › Skew, Distort, Perspective
// and Warp, and Filter › Liquify, as in Photoshop:
//   quad      a rect mapped exactly onto any four corners (a
//             homography: skew, distort and perspective are all one)
//   mesh      Photoshop's warp: a cubic Bezier patch of 4 × 4 control
//             points, drawn as a fine grid of triangles
//   liquify   a displacement field (dx, dy per cell, in image px) the
//             brushes push, twirl, pucker, bloat and reconstruct;
//             out(x) = src(x + D(x)), sampled bilinearly
// Images are straight-alpha { w, h, data } like the rest of Photo
// Lab; sampling is resample.js's (premultiplied bilinear).
// ============================================================
(function (root) {
  "use strict";

  var R = (root.PhotoLab && root.PhotoLab.resample) ||
          (typeof module !== "undefined" && module.exports ? require("./resample.js") : null);

  var MESH_N = 24;                     // grid cells per side when a patch is drawn
  var FIELD_MAX = 1 << 20;             // cells in a liquify field (about 1 Mpx)

  function make(w, h) { return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) }; }

  // ---------- Homography ----------
  // 3 × 3 (row-major, 9 numbers) taking the unit square (0,0) (1,0)
  // (1,1) (0,1) to the quad q = [tl, tr, br, bl] ({x, y}).
  function squareToQuad(q) {
    var x0 = q[0].x, y0 = q[0].y, x1 = q[1].x, y1 = q[1].y, x2 = q[2].x, y2 = q[2].y, x3 = q[3].x, y3 = q[3].y;
    var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
      return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    }
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    var g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  }
  function invert3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
    var det = a * A + b * B + c * Cc;
    if (Math.abs(det) < 1e-18) return null;
    var k = 1 / det;
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
            B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
            Cc * k, -(a * h - b * g) * k, (a * e - b * d) * k];
  }
  function apply3(m, x, y) {
    var w = m[6] * x + m[7] * y + m[8];
    return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
  }
  // A quad is usable when it is convex and not folded (the four turns
  // have one sign): a bow tie would sample from both sides.
  function convex(q) {
    var s = 0;
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      var z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-9) return false;
      if (!s) s = z > 0 ? 1 : -1; else if ((z > 0 ? 1 : -1) !== s) return false;
    }
    return true;
  }

  // img (w × h) mapped onto quad q (output coordinates); the result is
  // ow × oh. Every output pixel is inverse-mapped exactly.
  function perspective(img, q, ow, oh) {
    var out = make(ow, oh);
    var H = squareToQuad(q), Hi = H && invert3(H);
    if (!Hi || !convex(q)) return out;
    var px = [0, 0, 0, 0], d = out.data;
    for (var y = 0; y < oh; y++) {
      for (var x = 0; x < ow; x++) {
        var cx = x + 0.5, cy = y + 0.5;
        var w = Hi[6] * cx + Hi[7] * cy + Hi[8];
        if (w <= 0) continue;
        var u = (Hi[0] * cx + Hi[1] * cy + Hi[2]) / w, v = (Hi[3] * cx + Hi[4] * cy + Hi[5]) / w;
        if (u < -0.001 || v < -0.001 || u > 1.001 || v > 1.001) continue;
        R.sample(img, u * img.w, v * img.h, px);
        if (!px[3]) continue;
        var o = (y * ow + x) * 4;
        d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
      }
    }
    return out;
  }

  // ---------- Bezier patch (Photoshop's warp) ----------
  // mesh: 16 points, row by row (4 × 4), the corners at 0, 3, 12, 15.
  function bern(t) { var s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; }
  function patchAt(mesh, u, v) {
    var bu = bern(u), bv = bern(v), x = 0, y = 0;
    for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) {
      var k = bu[i] * bv[j], p = mesh[j * 4 + i];
      x += k * p.x; y += k * p.y;
    }
    return { x: x, y: y };
  }
  // The 16 points of a flat patch over quad q (a warp that changes
  // nothing yet).
  function meshOfQuad(q) {
    var H = squareToQuad(q), out = [];
    for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) out.push(H ? apply3(H, i / 3, j / 3) : { x: q[0].x, y: q[0].y });
    return out;
  }
  // (n + 1)² points of the patch, row by row.
  function patchGrid(mesh, n) {
    var pts = [];
    for (var j = 0; j <= n; j++) for (var i = 0; i <= n; i++) pts.push(patchAt(mesh, i / n, j / n));
    return pts;
  }
  function quadGrid(q, n) {
    var H = squareToQuad(q), pts = [];
    for (var j = 0; j <= n; j++) for (var i = 0; i <= n; i++) pts.push(H ? apply3(H, i / n, j / n) : { x: 0, y: 0 });
    return pts;
  }

  // img drawn through a grid: pts are (n + 1)² output points (row by
  // row) for the source's regular grid. Each cell is two triangles,
  // each filled by its own affine inverse. Output is ow × oh.
  function meshWarp(img, pts, n, ow, oh) {
    var out = make(ow, oh), d = out.data, px = [0, 0, 0, 0];
    var cw = img.w / n, ch = img.h / n;
    function tri(a, b, c, sa, sb, sc) {
      // output → source affine from the three pairs
      var det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(det) < 1e-9) return;
      var x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(ow - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      var y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(oh - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      var eps = -1e-6;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var X = x + 0.5, Y = y + 0.5;
          var l1 = ((b.y - c.y) * (X - c.x) + (c.x - b.x) * (Y - c.y)) / det;
          var l2 = ((c.y - a.y) * (X - c.x) + (a.x - c.x) * (Y - c.y)) / det;
          var l3 = 1 - l1 - l2;
          if (l1 < eps || l2 < eps || l3 < eps) continue;
          var o = (y * ow + x) * 4;
          if (d[o + 3]) continue;                       // a fold: the first layer of the sheet wins
          R.sample(img, l1 * sa.x + l2 * sb.x + l3 * sc.x, l1 * sa.y + l2 * sb.y + l3 * sc.y, px);
          if (!px[3]) continue;
          d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
        }
      }
    }
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var p00 = pts[j * (n + 1) + i], p10 = pts[j * (n + 1) + i + 1];
      var p01 = pts[(j + 1) * (n + 1) + i], p11 = pts[(j + 1) * (n + 1) + i + 1];
      var s00 = { x: i * cw, y: j * ch }, s10 = { x: (i + 1) * cw, y: j * ch };
      var s01 = { x: i * cw, y: (j + 1) * ch }, s11 = { x: (i + 1) * cw, y: (j + 1) * ch };
      tri(p00, p10, p11, s00, s10, s11);
      tri(p00, p11, p01, s00, s11, s01);
    }
    return out;
  }
  // Photoshop's warp of img: mesh in output coordinates.
  function warp(img, mesh, ow, oh, n) {
    n = n || MESH_N;
    return meshWarp(img, patchGrid(mesh, n), n, ow, oh);
  }

  // ---------- Liquify ----------
  // field { w, h, k: cells per image px (≤ 1), dx, dy: Float32Array }
  function field(imgW, imgH) {
    var k = Math.min(1, Math.sqrt(FIELD_MAX / Math.max(1, imgW * imgH)));
    var w = Math.max(1, Math.round(imgW * k)), h = Math.max(1, Math.round(imgH * k));
    return { w: w, h: h, k: k, iw: imgW, ih: imgH, dx: new Float32Array(w * h), dy: new Float32Array(w * h) };
  }
  // D at image point (x, y), bilinear between cells.
  function at(f, x, y, out) {
    var fx = x * f.k - 0.5, fy = y * f.k - 0.5;
    if (fx < 0) fx = 0; if (fy < 0) fy = 0;
    if (fx > f.w - 1) fx = f.w - 1; if (fy > f.h - 1) fy = f.h - 1;
    var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1);
    var tx = fx - x0, ty = fy - y0;
    var i00 = y0 * f.w + x0, i10 = y0 * f.w + x1, i01 = y1 * f.w + x0, i11 = y1 * f.w + x1;
    out[0] = (f.dx[i00] * (1 - tx) + f.dx[i10] * tx) * (1 - ty) + (f.dx[i01] * (1 - tx) + f.dx[i11] * tx) * ty;
    out[1] = (f.dy[i00] * (1 - tx) + f.dy[i10] * tx) * (1 - ty) + (f.dy[i01] * (1 - tx) + f.dy[i11] * tx) * ty;
    return out;
  }
  // One dab of a brush at image point (cx, cy), radius r (image px),
  // strength s 0..1. tool: push (with vx, vy: the brush's move),
  // twirl (s > 0 clockwise), pucker, bloat, reconstruct. Returns the
  // changed cell rect, or null.
  function dab(f, tool, cx, cy, r, s, vx, vy) {
    if (r <= 0 || !s) return null;
    var k = f.k, rc = r * k;
    var x0 = Math.max(0, Math.floor(cx * k - rc)), x1 = Math.min(f.w - 1, Math.ceil(cx * k + rc));
    var y0 = Math.max(0, Math.floor(cy * k - rc)), y1 = Math.min(f.h - 1, Math.ceil(cy * k + rc));
    if (x1 < x0 || y1 < y0) return null;
    // the field before the dab, for composing (only this rect changes)
    var old = { w: f.w, h: f.h, k: k, dx: f.dx.slice(), dy: f.dy.slice() };
    var tmp = [0, 0];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var X = (x + 0.5) / k, Y = (y + 0.5) / k;
      var ex = X - cx, ey = Y - cy, d2 = ex * ex + ey * ey;
      if (d2 >= r * r) continue;
      var q = 1 - d2 / (r * r), wgt = q * q * Math.abs(s), i = y * f.w + x;
      if (tool === "reconstruct") { f.dx[i] *= 1 - wgt; f.dy[i] *= 1 - wgt; continue; }
      var ox, oy;                                     // where this point now looks, relative to itself
      if (tool === "push") { ox = -vx * wgt; oy = -vy * wgt; }
      else if (tool === "twirl") {
        var a = -wgt * 0.35 * (s > 0 ? 1 : -1);
        var c = Math.cos(a), sn = Math.sin(a);
        ox = cx + ex * c - ey * sn - X; oy = cy + ex * sn + ey * c - Y;
      } else if (tool === "pucker") { ox = ex * wgt * 0.25; oy = ey * wgt * 0.25; }
      else if (tool === "bloat") { ox = -ex * wgt * 0.25; oy = -ey * wgt * 0.25; }
      else continue;
      at(old, X + ox, Y + oy, tmp);
      f.dx[i] = ox + tmp[0]; f.dy[i] = oy + tmp[1];
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  // The liquified picture: out(x) = img(x + D(x)). rect (optional,
  // image px) limits the work to a part (live preview).
  function liquify(img, f, into, rect) {
    var out = into || make(img.w, img.h), d = out.data, px = [0, 0, 0, 0], D = [0, 0];
    var k = img.w / f.iw;                             // img may be a smaller preview of the field's image
    var x0 = 0, y0 = 0, x1 = img.w, y1 = img.h;
    if (rect) {
      x0 = Math.max(0, rect.x); y0 = Math.max(0, rect.y);
      x1 = Math.min(img.w, rect.x + rect.w); y1 = Math.min(img.h, rect.y + rect.h);
    }
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var X = x + 0.5, Y = y + 0.5;
        at(f, X / k, Y / k, D);
        var o = (y * img.w + x) * 4;
        if (D[0] === 0 && D[1] === 0) {
          var s = o; d[o] = img.data[s]; d[o + 1] = img.data[s + 1]; d[o + 2] = img.data[s + 2]; d[o + 3] = img.data[s + 3];
          continue;
        }
        R.sample(img, X + D[0] * k, Y + D[1] * k, px);
        d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
      }
    }
    return out;
  }
  function moved(f) {
    for (var i = 0; i < f.dx.length; i++) if (f.dx[i] || f.dy[i]) return true;
    return false;
  }

  var API = {
    MESH_N: MESH_N, FIELD_MAX: FIELD_MAX,
    squareToQuad: squareToQuad, invert3: invert3, apply3: apply3, convex: convex, perspective: perspective,
    patchAt: patchAt, meshOfQuad: meshOfQuad, patchGrid: patchGrid, quadGrid: quadGrid, meshWarp: meshWarp, warp: warp,
    field: field, at: at, dab: dab, liquify: liquify, moved: moved
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.warp = API; }
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
