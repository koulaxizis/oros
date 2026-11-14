// ============================================================
// orOS designkit — boolean: shape operations and outline stroke
// (v1.0.0, wave V2). Shared by Atelier and Layout. Pure: no DOM, no
// clock. Works on designkit/vector.js paths in one common space (page
// points): the outlines are flattened to polygons (within `tol`),
// combined by polygon-clipping (MIT, vendor/polygon-clipping/), and
// the result is fitted back to Bézier curves (Schneider's method,
// corners and straight edges kept), so it stays editable with few
// points. Holes come out wound the other way round from their outer
// ring and never overlap it, so nonzero and even-odd fill draw them
// the same, with no new field.
//   op(kind, shapes, tol) → paths | null; kind "union" | "subtract"
//     (the first shape minus all the others) | "intersect" |
//     "exclude"; shapes = [paths, …], back to front
//   outline(paths, o, tol) → paths | null: the stroke as a filled
//     outline; o = { w, join "miter" | "round" | "bevel", miter,
//     cap "butt" | "round" | "square", dash [on, off] | null,
//     extra [rings] (arrow heads, … added to the result) }
//   flatten(paths, tol) → [{ closed, p: [[x, y], …] }]
//   fit(ring, tol) → a closed path, or null
//   tolFor(paths) → a tolerance for outlines of that size
//   need(base) → Promise: loads polygon-clipping in a browser (base =
//     the app's way to the orOS root, "../")
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports;
  var V = NODE ? require("./vector.js") : root.orosDK.vector;
  var PC_PATH = "vendor/polygon-clipping/polygon-clipping.umd.min.js";
  var MAX_PTS = 60000;           // flattened points in all, before giving up
  var MAX_PIECES = 20000;        // outline stroke pieces

  function pc() {
    if (NODE) return require("../" + PC_PATH);
    return root.polygonClipping || null;
  }
  var loading = null;
  function need(base) {
    if (pc()) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = (base || "../") + PC_PATH;
      s.onload = function () { if (pc()) res(true); else { loading = null; rej(new Error("polygon-clipping")); } };
      s.onerror = function () { loading = null; rej(new Error("polygon-clipping")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ---------- small vector maths ----------
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function len(a) { return Math.hypot(a[0], a[1]); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function unit(a) { var l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; }

  // Clipping is exact on the numbers it gets, and nearly touching
  // pieces trip it: everything goes to a 1/1024 pt grid first.
  var GRID = 1024;
  function snap(q) { return [Math.round(q[0] * GRID) / GRID, Math.round(q[1] * GRID) / GRID]; }
  function tolFor(paths) {
    var b = V.bounds(paths), d = Math.hypot(b.w, b.h);
    return Math.max(0.02, Math.min(0.5, d / 2000));
  }

  // ---------- 1. Flattening ----------
  function cubicPts(c, tol, out) {
    var m = Math.max(Math.hypot(c[0] - 2 * c[2] + c[4], c[1] - 2 * c[3] + c[5]), Math.hypot(c[2] - 2 * c[4] + c[6], c[3] - 2 * c[5] + c[7]));
    var n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(6 * m / (8 * tol)))));
    for (var k = 1; k <= n; k++) out.push(V.at(c, k / n));
  }
  function flatten(paths, tol) {
    var out = [], total = 0;
    (paths || []).forEach(function (p) {
      if (!p.n || p.n.length < 2) return;
      var pts = [[p.n[0].x, p.n[0].y]];
      V.segsOf(p).forEach(function (s) {
        var a = p.n[s[0]], b = p.n[s[1]];
        var curved = a.ox !== a.x || a.oy !== a.y || b.ix !== b.x || b.iy !== b.y;
        if (curved) cubicPts(V.bez(p, s), tol, pts);
        else pts.push([b.x, b.y]);
      });
      if (p.closed) pts.pop();           // the way back ends on the first point
      total += pts.length;
      out.push({ closed: !!p.closed, p: dedupe(pts, tol * 0.01, p.closed) });
    });
    return total > MAX_PTS ? null : out;
  }
  function dedupe(pts, eps, closed) {
    var o = [];
    pts.forEach(function (q) { if (!o.length || dist(o[o.length - 1], q) > eps) o.push(q); });
    if (closed) while (o.length > 1 && dist(o[0], o[o.length - 1]) <= eps) o.pop();
    return o;
  }

  // A shape as an area: its rings combined even-odd (the same as
  // nonzero for an outline that does not cross itself; a drawn
  // outline is closed the way a fill closes it).
  function ring(p) { var r = p.slice(); r.push(p[0]); return r; }
  function region(paths, tol) {
    var fl = flatten(paths, tol), P = pc();
    if (!fl) return null;
    var rings = fl.filter(function (r) { return r.p.length >= 3; }).map(function (r) { return [[ring(r.p.map(snap))]]; });
    if (!rings.length) return [];
    if (rings.length === 1) return P.union(rings[0]);
    return P.xor.apply(null, rings);
  }

  // ---------- 2. Fitting polygons back to curves ----------
  function bzAt(b, t) {
    var u = 1 - t;
    return [u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0],
      u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]];
  }
  function bzD1(b, t) {
    var u = 1 - t;
    return [3 * u * u * (b[1][0] - b[0][0]) + 6 * u * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]),
      3 * u * u * (b[1][1] - b[0][1]) + 6 * u * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1])];
  }
  function bzD2(b, t) {
    var u = 1 - t;
    return [6 * u * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
      6 * u * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1])];
  }
  function chordParams(d) {
    var u = [0];
    for (var i = 1; i < d.length; i++) u.push(u[i - 1] + dist(d[i], d[i - 1]));
    var L = u[u.length - 1] || 1;
    return u.map(function (v) { return v / L; });
  }
  function generate(d, u, t1, t2) {
    var p0 = d[0], p3 = d[d.length - 1];
    var C00 = 0, C01 = 0, C11 = 0, X0 = 0, X1 = 0;
    for (var i = 0; i < d.length; i++) {
      var t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
      var A0 = mul(t1, b1), A1 = mul(t2, b2);
      C00 += dot(A0, A0); C01 += dot(A0, A1); C11 += dot(A1, A1);
      var tmp = sub(d[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
      X0 += dot(A0, tmp); X1 += dot(A1, tmp);
    }
    var det = C00 * C11 - C01 * C01, seg = dist(p0, p3);
    var al = Math.abs(det) > 1e-12 ? (X0 * C11 - X1 * C01) / det : 0;
    var ar = Math.abs(det) > 1e-12 ? (C00 * X1 - C01 * X0) / det : 0;
    if (!(al > 1e-6 * seg) || !(ar > 1e-6 * seg) || al > 3 * seg || ar > 3 * seg) { al = ar = seg / 3; }
    return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
  }
  function maxError(d, b, u) {
    var m = 0, at = Math.floor(d.length / 2);
    for (var i = 1; i < d.length - 1; i++) {
      var q = bzAt(b, u[i]), e = (q[0] - d[i][0]) * (q[0] - d[i][0]) + (q[1] - d[i][1]) * (q[1] - d[i][1]);
      if (e >= m) { m = e; at = i; }
    }
    return { e: m, i: at };
  }
  function reparam(d, b, u) {
    return u.map(function (t, i) {
      var q = bzAt(b, t), q1 = bzD1(b, t), q2 = bzD2(b, t), df = sub(q, d[i]);
      var den = dot(q1, q1) + dot(df, q2);
      if (Math.abs(den) < 1e-12) return t;
      var n = t - dot(df, q1) / den;
      return n < 0 ? 0 : n > 1 ? 1 : n;
    });
  }
  function fitCubic(d, t1, t2, err2, out, depth) {
    if (d.length === 2) {
      var k = dist(d[0], d[1]) / 3;
      out.push([d[0], add(d[0], mul(t1, k)), add(d[1], mul(t2, k)), d[1]]);
      return;
    }
    var u = chordParams(d), b = generate(d, u, t1, t2), r = maxError(d, b, u);
    if (r.e < err2) { out.push(b); return; }
    if (r.e < err2 * 16) {
      for (var it = 0; it < 12; it++) {
        u = reparam(d, b, u); b = generate(d, u, t1, t2); r = maxError(d, b, u);
        if (r.e < err2) { out.push(b); return; }
      }
    }
    if (depth > 40) { out.push(b); return; }
    var s = r.i, tc = unit(sub(d[s - 1], d[s + 1]));
    if (!tc[0] && !tc[1]) tc = unit(sub(d[s - 1], d[s]));
    fitCubic(d.slice(0, s + 1), t1, tc, err2, out, depth + 1);
    fitCubic(d.slice(s), mul(tc, -1), t2, err2, out, depth + 1);
  }

  // Point i of a closed ring is a corner when the outline turns there
  // more than a flattened curve could (its sag over the longer side
  // would be above the tolerance), or by more than 40°.
  function turn(a, b, c) {
    var u = unit(sub(b, a)), v = unit(sub(c, b));
    return Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v));
  }
  function collinear(d, tol) {
    var a = d[0], b = d[d.length - 1], L = dist(a, b);
    if (L < 1e-9) return false;
    for (var i = 1; i < d.length - 1; i++) {
      var e = Math.abs((b[0] - a[0]) * (a[1] - d[i][1]) - (a[0] - d[i][0]) * (b[1] - a[1])) / L;
      if (e > tol * 0.5) return false;
      var t = dot(sub(d[i], a), sub(b, a)) / (L * L);
      if (t < -1e-6 || t > 1 + 1e-6) return false;
    }
    return true;
  }
  // Points that lie on the line between their neighbours add nothing
  // (an offset edge cut by a join, a clipped edge): drop them.
  function slim(p, eps) {
    var o = p.slice(), again = true;
    while (again && o.length > 3) {
      again = false;
      for (var i = 0; i < o.length && o.length > 3; i++) {
        var a = o[(i - 1 + o.length) % o.length], b = o[i], c = o[(i + 1) % o.length], L = dist(a, c);
        if (L < 1e-9) continue;
        var e = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L;
        var t = dot(sub(b, a), sub(c, a)) / (L * L);
        if (e < eps && t > 0 && t < 1) { o.splice(i, 1); i--; again = true; }
      }
    }
    return o;
  }
  function fit(rin, tol) {
    var p = slim(dedupe(rin, tol * 0.05, true), tol * 0.02), N = p.length;
    if (N < 3) return null;
    function P(i) { return p[((i % N) + N) % N]; }
    var e = [], med;
    for (var i = 0; i < N; i++) e.push(dist(P(i), P(i + 1)));
    med = e.slice().sort(function (a, b) { return a - b; })[N >> 1];
    var corner = [], longE = [];
    for (i = 0; i < N; i++) {
      var th = Math.abs(turn(P(i - 1), P(i), P(i + 1))), m = Math.max(e[(i - 1 + N) % N], e[i]);
      corner.push(th > 0.7 || m * th / 8 > 1.5 * tol);
      longE.push(e[i] > Math.max(3 * med, 8 * tol));
    }
    // break points: corners and the ends of long (straight) edges
    var brk = [];
    for (i = 0; i < N; i++) if (corner[i] || longE[i] || longE[(i - 1 + N) % N]) brk.push(i);
    if (!brk.length) brk = [0, N >> 1];
    if (brk.length === 1) brk.push((brk[0] + (N >> 1)) % N);
    function tanOut(i, sec) {         // direction leaving break point i
      if (longE[i]) return unit(sub(P(i + 1), P(i)));
      if (!corner[i] && longE[(i - 1 + N) % N]) return unit(sub(P(i), P(i - 1)));
      if (!corner[i]) return unit(sub(P(i + 1), P(i - 1)));
      return unit(sub(sec[1], sec[0]));
    }
    function tanIn(i, sec) {          // direction pointing back from break point i
      var k = (i - 1 + N) % N;
      if (longE[k]) return unit(sub(P(i - 1), P(i)));
      if (!corner[i] && longE[i]) return unit(sub(P(i), P(i + 1)));
      if (!corner[i]) return unit(sub(P(i - 1), P(i + 1)));
      return unit(sub(sec[sec.length - 2], sec[sec.length - 1]));
    }
    var nodes = [];
    function nd(q) { return { x: q[0], y: q[1], ix: q[0], iy: q[1], ox: q[0], oy: q[1], k: "c" }; }
    var err2 = tol * tol;
    for (var b = 0; b < brk.length; b++) {
      var i0 = brk[b], i1 = brk[(b + 1) % brk.length], sec = [];
      var stop = i1 > i0 ? i1 : i1 + N;
      for (var j = i0; j <= stop; j++) sec.push(P(j));
      var start = nd(P(i0));
      if (b === 0) nodes.push(start);
      var head = nodes[nodes.length - 1];
      if (sec.length === 2 || collinear(sec, tol)) {
        if (b < brk.length - 1) nodes.push(nd(P(i1)));
        continue;
      }
      var bz = [];
      fitCubic(sec, tanOut(i0, sec), tanIn(i1, sec), err2, bz, 0);
      bz.forEach(function (c, ci) {
        head.ox = c[1][0]; head.oy = c[1][1];
        var last = ci === bz.length - 1;
        if (last && b === brk.length - 1) { nodes[0].ix = c[2][0]; nodes[0].iy = c[2][1]; return; }
        var n = nd(c[3]); n.ix = c[2][0]; n.iy = c[2][1];
        nodes.push(n); head = n;
      });
    }
    nodes.forEach(function (n) { n.k = V.kindOf(n); });
    return nodes.length >= 2 ? { closed: true, n: nodes } : null;
  }
  function fromGeom(mp, tol) {
    var out = [];
    (mp || []).forEach(function (poly) {
      poly.forEach(function (r) {
        var q = r.slice(0, r.length - 1), f = fit(q, tol);
        if (f) out.push(f);
      });
    });
    return out;
  }

  // ---------- 3. Shape operations ----------
  function op(kind, shapes, tol) {
    var P = pc();
    if (!P || !shapes || shapes.length < 2) return null;
    tol = tol || tolFor([].concat.apply([], shapes));
    var g = [];
    for (var i = 0; i < shapes.length; i++) {
      var r = safe(function () { return region(shapes[i], tol); });
      if (!r) return null;
      g.push(r);
    }
    var fn = { union: P.union, intersect: P.intersection, subtract: P.difference, exclude: P.xor }[kind];
    if (!fn) return null;
    var res = safe(function () { return fn.apply(null, g); });
    return res ? fromGeom(res, tol) : null;
  }

  // ---------- 4. Outline stroke ----------
  function dashes(pl, closed, on, off) {
    var pts = closed ? pl.concat([pl[0]]) : pl, out = [], cur = [pts[0]], left = on, drawing = true;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], L = dist(a, b), pos = 0;
      while (L - pos > left) {
        pos += left;
        var q = add(a, mul(sub(b, a), pos / L));
        if (drawing) { cur.push(q); if (cur.length > 1) out.push(cur); cur = null; }
        else cur = [q];
        drawing = !drawing; left = drawing ? on : off;
      }
      left -= L - pos;
      if (drawing) cur.push(b);
    }
    if (drawing && cur && cur.length > 1) out.push(cur);
    return out;
  }
  function circle(c, r, tol) {
    var n = Math.max(8, Math.min(96, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / Math.max(r, tol))))));
    var o = [];
    for (var k = 0; k < n; k++) o.push([c[0] + r * Math.cos(2 * Math.PI * k / n), c[1] + r * Math.sin(2 * Math.PI * k / n)]);
    return o;
  }
  function sarea(r) {
    var a = 0;
    for (var i = 0; i < r.length; i++) { var q = r[(i + 1) % r.length]; a += r[i][0] * q[1] - q[0] * r[i][1]; }
    return a / 2;
  }
  // Clipping many pieces at once can trip on nearly touching edges:
  // try again on a coarser grid before giving up.
  function unionAll(pieces) {
    var P = pc(), grids = [GRID, 64, 8];
    for (var g = 0; g < grids.length; g++) {
      var k = grids[g];
      var geo = pieces.map(function (poly) {
        return [poly.map(function (r) { return r.map(function (q) { return [Math.round(q[0] * k) / k, Math.round(q[1] * k) / k]; }); })];
      });
      try { return P.union.apply(null, geo); } catch (e) { /* next grid */ }
    }
    return null;
  }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  function outline(paths, o, tol) {
    if (!pc() || !(o && o.w > 0)) return null;
    tol = tol || tolFor(paths);
    var fl = flatten(paths, tol);
    if (!fl) return null;
    var h = o.w / 2, join = o.join || "miter", cap = o.cap || "butt", lim = o.miter || 10;
    var lines = [];
    fl.forEach(function (r) {
      if (r.p.length < 2) return;
      if (o.dash && o.dash[0] > 0 && o.dash[1] > 0) dashes(r.p, r.closed, o.dash[0], o.dash[1]).forEach(function (d) { lines.push({ closed: false, p: dedupe(d, tol * 0.01, false) }); });
      else lines.push(r);
    });
    var pieces = [];
    function close(r) { var c = r.slice(); c.push(r[0]); return c; }
    function poly(pts) { if (pts.length >= 3) pieces.push([close(pts)]); }
    function nrm(d, s) { return [-d[1] * h * s, d[0] * h * s]; }
    // One side of a run of points: the offset of each edge, mitered at
    // the points between (a flattened curve turns only a little there).
    function side(p, s, loop) {
      var n = p.length, out = [];
      for (var i = 0; i < n; i++) {
        var hasIn = loop || i > 0, hasOut = loop || i < n - 1;
        var din = hasIn ? unit(sub(p[i], p[(i - 1 + n) % n])) : null, dout = hasOut ? unit(sub(p[(i + 1) % n], p[i])) : null;
        if (!din) { out.push(add(p[i], nrm(dout, s))); continue; }
        if (!dout) { out.push(add(p[i], nrm(din, s))); continue; }
        var ni = nrm(din, s), no = nrm(dout, s), bis = unit(add(ni, no)), c = dot(bis, unit(ni));
        out.push(c > 0.2 ? add(p[i], mul(bis, h / c)) : add(p[i], ni));
      }
      return out;
    }
    function ribbon(p) {
      if (p.length < 2) return;
      var l = side(p, 1, false), r = side(p, -1, false).reverse();
      poly(l.concat(r));
    }
    function joinAt(v, d0, d1) {
      var cr = d0[0] * d1[1] - d0[1] * d1[0], s = cr > 0 ? -1 : 1;
      if (join === "round") { poly(circle(v, h, tol)); return; }
      var a0 = add(v, nrm(d0, s)), a1 = add(v, nrm(d1, s));
      if (join === "miter") {
        var bis = unit(add(nrm(d0, s), nrm(d1, s))), c = dot(bis, unit(nrm(d0, s)));
        if (c > 1e-6 && 1 / c <= lim) { poly([v, a0, add(v, mul(bis, h / c)), a1]); return; }
      }
      poly([v, a0, a1]);
    }
    function isCorner(pr, v, nx) {
      var d0 = unit(sub(v, pr)), d1 = unit(sub(nx, v));
      return Math.abs(Math.atan2(d0[0] * d1[1] - d0[1] * d1[0], dot(d0, d1))) >= 0.35;
    }
    lines.forEach(function (l) {
      var p = l.p, n = p.length, closed = l.closed && n > 2, i;
      if (n < 2) return;
      var corners = [];
      for (i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) if (isCorner(p[(i - 1 + n) % n], p[i], p[(i + 1) % n])) corners.push(i);
      if (closed && !corners.length) {
        // a smooth loop: the band between its two offset loops
        var A = side(p, 1, true), B = side(p, -1, true), aa = sarea(A), ab = sarea(B);
        var outer = Math.abs(aa) >= Math.abs(ab) ? A : B, inner = outer === A ? B : A;
        var ao = sarea(outer), ai = sarea(inner);
        pieces.push(ao * ai > 0 && Math.abs(ai) < Math.abs(ao) ? [close(outer), close(inner)] : [close(outer)]);
        return;
      }
      if (closed) {                      // start the loop at a corner
        var k0 = corners[0];
        p = p.slice(k0).concat(p.slice(0, k0)); p.push(p[0]);
        corners = corners.map(function (c) { return c - k0; }).concat([p.length - 1]);
        corners.shift();
        joinAt(p[0], unit(sub(p[0], p[p.length - 2])), unit(sub(p[1], p[0])));
      }
      var start = 0;
      corners.forEach(function (c) {
        ribbon(p.slice(start, c + 1));
        if (c < p.length - 1) joinAt(p[c], unit(sub(p[c], p[c - 1])), unit(sub(p[c + 1], p[c])));
        start = c;
      });
      ribbon(p.slice(start));
      if (!closed && cap !== "butt") {
        [[p[0], unit(sub(p[0], p[1]))], [p[p.length - 1], unit(sub(p[p.length - 1], p[p.length - 2]))]].forEach(function (e) {
          if (cap === "round") { poly(circle(e[0], h, tol)); return; }
          var d = e[1], nr = [-d[1] * h, d[0] * h], f = add(e[0], mul(d, h));
          poly([add(e[0], nr), add(f, nr), sub(f, nr), sub(e[0], nr)]);
        });
      }
    });
    (o.extra || []).forEach(function (r) { poly(r); });
    if (!pieces.length || pieces.length > MAX_PIECES) return null;
    var res = unionAll(pieces);
    return res ? fromGeom(res, tol) : null;
  }

  var api = { op: op, outline: outline, flatten: flatten, fit: fit, tolFor: tolFor, need: need, PC_PATH: PC_PATH };
  if (NODE) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.boolean = api; }
})(typeof window !== "undefined" ? window : this);
