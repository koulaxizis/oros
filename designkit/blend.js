// ============================================================
// orOS designkit — blend: the steps between two shapes (v1.0.0)
// Shared by Atelier and Layout (wave C1). Pure: no DOM, no clock.
// Outlines are path commands in UNIT space (fractions of the item's
// box, like designkit "path" items): [["M", x, y], ["L", x, y],
// ["C", x1, y1, x2, y2, x, y], ["Z"]]. The box (x, y, w, h, rot) and
// the colours are blended on their own, so a small circle can turn
// into a big star while it moves.
// How two outlines morph: every subpath becomes a closed run of
// cubic segments; the run with fewer segments splits its longest
// segment in two until both have the same count; B turns the same
// way round as A and starts at the point that lies closest to A's
// start; then each control point moves on a straight line.
// Subpaths pair by order; a subpath with no partner grows from (or
// shrinks to) its own middle.
//   prepare(cmdsA, cmdsB)  → plan (reuse it for every step)
//   at(plan, t)            → unit commands at 0 ≤ t ≤ 1
//   steps(n)               → the n values of t between the two ends
//   num(a, b, t), angle(a, b, t), hex(a, b, t), mixVals(a, b, t)
// ============================================================
(function (root) {
  "use strict";

  var MIN_SEGS = 16;             // enough points for the two outlines to line up
  var MAX_SEGS = 600;            // per subpath, after matching

  function r4(v) { return Math.round(v * 10000) / 10000; }

  // → [{ x, y, segs: [[c1x, c1y, c2x, c2y, x, y, line], …] }] closed
  // runs; line = 1 when the segment is straight (drawn back as "L")
  function toRuns(cmds) {
    var runs = [], cur = null, px = 0, py = 0;
    function close() {
      if (!cur) return;
      if (cur.segs.length && (px !== cur.x || py !== cur.y)) line(cur.x, cur.y);
      if (cur.segs.length) runs.push(cur);
      cur = null;
    }
    function line(x, y) {
      cur.segs.push([px + (x - px) / 3, py + (y - py) / 3, px + (x - px) * 2 / 3, py + (y - py) * 2 / 3, x, y, 1]);
      px = x; py = y;
    }
    (cmds || []).forEach(function (c) {
      if (c[0] === "M") { close(); cur = { x: c[1], y: c[2], segs: [] }; px = c[1]; py = c[2]; }
      else if (!cur) return;
      else if (c[0] === "L") line(c[1], c[2]);
      else if (c[0] === "C") { cur.segs.push([c[1], c[2], c[3], c[4], c[5], c[6]]); px = c[5]; py = c[6]; }
      else if (c[0] === "Q") {                       // quadratic → cubic
        cur.segs.push([px + (c[1] - px) * 2 / 3, py + (c[2] - py) * 2 / 3,
          c[3] + (c[1] - c[3]) * 2 / 3, c[4] + (c[2] - c[4]) * 2 / 3, c[3], c[4]]);
        px = c[3]; py = c[4];
      } else if (c[0] === "Z") { close(); }
    });
    close();
    return runs;
  }

  function startOf(run, i) {
    if (i === 0) return [run.x, run.y];
    var s = run.segs[i - 1];
    return [s[4], s[5]];
  }
  function chord(run, i) {
    var p = startOf(run, i), s = run.segs[i];
    return Math.abs(s[4] - p[0]) + Math.abs(s[5] - p[1]) + Math.abs(s[0] - p[0]) + Math.abs(s[1] - p[1]) +
      Math.abs(s[2] - s[4]) + Math.abs(s[3] - s[5]);
  }
  // de Casteljau at t = 0.5: segment i becomes two
  function split(run, i) {
    var p = startOf(run, i), s = run.segs[i];
    var ax = (p[0] + s[0]) / 2, ay = (p[1] + s[1]) / 2;
    var bx = (s[0] + s[2]) / 2, by = (s[1] + s[3]) / 2;
    var cx = (s[2] + s[4]) / 2, cy = (s[3] + s[5]) / 2;
    var dx = (ax + bx) / 2, dy = (ay + by) / 2;
    var ex = (bx + cx) / 2, ey = (by + cy) / 2;
    var mx = (dx + ex) / 2, my = (dy + ey) / 2;
    var ln = s[6] ? 1 : 0;
    run.segs.splice(i, 1, [ax, ay, dx, dy, mx, my, ln], [ex, ey, cx, cy, s[4], s[5], ln]);
  }
  function grow(run, n) {
    while (run.segs.length < n) {
      var best = 0, bl = -1;
      for (var i = 0; i < run.segs.length; i++) { var l = chord(run, i); if (l > bl) { bl = l; best = i; } }
      split(run, best);
    }
  }
  function area(run) {
    var a = 0, px = run.x, py = run.y;
    run.segs.forEach(function (s) { a += px * s[5] - s[4] * py; px = s[4]; py = s[5]; });
    return a / 2;
  }
  function anchors(run) { return run.segs.map(function (s) { return [s[4], s[5]]; }); }
  function middle(run) {
    var a = anchors(run), x = 0, y = 0;
    a.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / a.length, y / a.length];
  }
  function reverse(run) {
    var pts = [[run.x, run.y]], out = [];
    run.segs.forEach(function (s) { pts.push([s[4], s[5]]); });
    for (var i = run.segs.length - 1; i >= 0; i--) {
      var s = run.segs[i], to = pts[i];
      out.push([s[2], s[3], s[0], s[1], to[0], to[1], s[6] ? 1 : 0]);
    }
    return { x: run.x, y: run.y, segs: out };
  }
  // the same closed run, starting at anchor k (k = 0: unchanged)
  function rotate(run, k) {
    if (!k) return run;
    var n = run.segs.length, s0 = run.segs[k - 1];
    return { x: s0[4], y: s0[5], segs: run.segs.slice(k).concat(run.segs.slice(0, k)).slice(0, n) };
  }
  function bestStart(a, b) {
    var pa = [[a.x, a.y]].concat(anchors(a).slice(0, -1)), n = b.segs.length, best = 0, bd = Infinity;
    for (var k = 0; k < n; k++) {
      var rb = rotate(b, k), pb = [[rb.x, rb.y]].concat(anchors(rb).slice(0, -1)), d = 0;
      for (var i = 0; i < pa.length; i++) d += (pa[i][0] - pb[i][0]) * (pa[i][0] - pb[i][0]) + (pa[i][1] - pb[i][1]) * (pa[i][1] - pb[i][1]);
      if (d < bd) { bd = d; best = k; }
    }
    return rotate(b, best);
  }
  // a run of n segments all sitting on point p
  function dot(p, n) {
    var segs = [];
    for (var i = 0; i < n; i++) segs.push([p[0], p[1], p[0], p[1], p[0], p[1], 1]);
    return { x: p[0], y: p[1], segs: segs };
  }
  function copy(run) { return { x: run.x, y: run.y, segs: run.segs.map(function (s) { return s.slice(); }) }; }

  function prepare(cmdsA, cmdsB) {
    var A = toRuns(cmdsA), B = toRuns(cmdsB), pairs = [];
    var n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
      var a = A[i] ? copy(A[i]) : null, b = B[i] ? copy(B[i]) : null;
      if (!a && !b) continue;
      if (!a) a = dot(middle(b), b.segs.length);
      if (!b) b = dot(middle(a), a.segs.length);
      var cnt = Math.min(MAX_SEGS, Math.max(a.segs.length, b.segs.length, MIN_SEGS));
      grow(a, cnt); grow(b, cnt);
      if (area(a) * area(b) < 0) b = reverse(b);
      b = bestStart(a, b);
      pairs.push([a, b]);
    }
    return { pairs: pairs };
  }

  function num(a, b, t) { return a + (b - a) * t; }
  function at(plan, t) {
    var out = [];
    plan.pairs.forEach(function (p) {
      var a = p[0], b = p[1];
      out.push(["M", r4(num(a.x, b.x, t)), r4(num(a.y, b.y, t))]);
      for (var i = 0; i < a.segs.length; i++) {
        var sa = a.segs[i], sb = b.segs[i];
        if (sa[6] && sb[6]) { out.push(["L", r4(num(sa[4], sb[4], t)), r4(num(sa[5], sb[5], t))]); continue; }
        var c = ["C"];
        for (var k = 0; k < 6; k++) c.push(r4(num(sa[k], sb[k], t)));
        out.push(c);
      }
      out.push(["Z"]);
    });
    return out;
  }

  // n steps strictly between the two ends: 1/(n+1) … n/(n+1)
  function steps(n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(i / (n + 1));
    return out;
  }
  // the short way round, in degrees (-180, 180]
  function angle(a, b, t) {
    var d = ((b - a) % 360 + 540) % 360 - 180, v = (a + d * t) % 360;
    if (v > 180) v -= 360; else if (v <= -180) v += 360;
    return v;
  }
  function hex(a, b, t) {
    var pa = parse(a), pb = parse(b);
    if (!pa || !pb) return a || b || "";
    return "#" + [0, 1, 2].map(function (i) {
      var v = Math.round(num(pa[i], pb[i], t));
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function parse(h) {
    var m = typeof h === "string" && /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mixVals(a, b, t) { return a.map(function (v, i) { return num(v, b[i], t); }); }

  // Unit commands of a box outline: x, y scaled by 1/w, 1/h.
  function toUnit(cmds, w, h) {
    return (cmds || []).map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) o.push(c[i] / w, c[i + 1] / h);
      return o;
    });
  }

  var API = { prepare: prepare, at: at, steps: steps, num: num, angle: angle, hex: hex, mixVals: mixVals, toUnit: toUnit, toRuns: toRuns };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else {
    root.orosDK = root.orosDK || {};
    root.orosDK.blend = API;
  }
})(typeof window !== "undefined" ? window : this);
