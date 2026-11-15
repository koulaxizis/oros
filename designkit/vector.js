// ============================================================
// orOS designkit — vector: editable outlines (v1.0.0, wave V1)
// Shared by Atelier and Layout. Pure: no DOM, no clock.
// An outline is a list of PATHS, each { closed, n: [nodes] }, and a
// node is { x, y, ix, iy, ox, oy, k }: the point, its in and out
// handles (equal to the point when the node has none) and its kind,
// "c" corner (handles move on their own), "s" smooth (handles stay
// on one line) or "y" symmetric (and of equal length). The kind is
// not stored anywhere: fromCmds works it out from the handles.
// Commands are the designkit ones: ["M", x, y] ["L", x, y]
// ["C", x1, y1, x2, y2, x, y] ["Z"] (Q is read as a cubic).
//   fromCmds(cmds) → paths          toCmds(paths) → cmds
//   bounds(paths | cmds) → { x, y, w, h } (the curve, not the handles)
//   reframe(frame, paths) → { x, y, w, h, rot, unit }: the item box
//     that holds `paths` (given in the frame's own unrotated space,
//     0..frame.w × 0..frame.h) where they are now, and the outline in
//     fractions of that box (designkit "path" / Atelier ext.pth)
//   scaled(unit, w, h) → cmds in a w × h box
//   nearest(paths, x, y) → { pi, si, t, x, y, d } (point on the curve)
//   split(paths, pi, si, t) → index of the new node (shape kept)
//   reverse(path), clone(paths), kindOf(node)
//   setKind(paths, pi, ni, k), straight(node)
//   moveHandle(node, which "i" | "o", x, y, free)
//   removeNodes(paths, keys) → paths or null (nothing left)
//   breakAt(paths, pi, ni) → true when it broke
//   join(paths, a, b) → true; a / b = { pi, ni } open path ends
//   setClosed(paths, pi, on)
//   rectCmds(w, h, r), ellCmds(w, h): shapes as outlines
//   text(cmds, digits), pack(unit, room) → string | [strings] | null
//     (Atelier ext.pth: chunks of ≤ 4000 characters, ≤ room in all)
//   count(paths) → number of nodes
// ============================================================
(function (root) {
  "use strict";

  var EPS = 1e-6;
  var MIN_BOX = 1;              // a straight outline still gets a box this wide
  var KAPPA = 0.5522847498;
  var MAX_NODES = 2000;
  var CHUNK = 4000;             // designkit normX's longest string

  function r3(v) { return Math.round(v * 1000) / 1000; }
  function near(a, b) { return Math.abs(a - b) < 1e-4; }
  function node(x, y) { return { x: x, y: y, ix: x, iy: y, ox: x, oy: y, k: "c" }; }
  function hasIn(n) { return !near(n.ix, n.x) || !near(n.iy, n.y); }
  function hasOut(n) { return !near(n.ox, n.x) || !near(n.oy, n.y); }

  function kindOf(n) {
    var ax = n.ix - n.x, ay = n.iy - n.y, bx = n.ox - n.x, by = n.oy - n.y;
    var la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-3 || lb < 1e-3) return "c";
    var dot = (ax * bx + ay * by) / (la * lb);
    if (dot > -0.9995) return "c";
    return Math.abs(la - lb) <= 0.01 * Math.max(la, lb) ? "y" : "s";
  }

  // ---------- 1. Commands ↔ paths ----------
  function fromCmds(cmds) {
    var paths = [], cur = null;
    function finish(closed) {
      if (!cur) return;
      var n = cur.n;
      if (closed && n.length > 1) {
        var a = n[0], b = n[n.length - 1];
        if (near(a.x, b.x) && near(a.y, b.y)) { a.ix = b.ix; a.iy = b.iy; n.pop(); }
      }
      cur.closed = !!closed && n.length > 1;
      if (n.length) paths.push(cur);
      cur = null;
    }
    (cmds || []).forEach(function (c) {
      if (!c || !c.length) return;
      var op = c[0];
      if (op === "M") { finish(false); cur = { closed: false, n: [node(c[1], c[2])] }; return; }
      if (!cur) return;
      var last = cur.n[cur.n.length - 1];
      if (op === "L") cur.n.push(node(c[1], c[2]));
      else if (op === "C") {
        last.ox = c[1]; last.oy = c[2];
        var q = node(c[5], c[6]); q.ix = c[3]; q.iy = c[4];
        cur.n.push(q);
      } else if (op === "Q") {                          // quadratic → cubic
        last.ox = last.x + (c[1] - last.x) * 2 / 3; last.oy = last.y + (c[2] - last.y) * 2 / 3;
        var r = node(c[3], c[4]); r.ix = c[3] + (c[1] - c[3]) * 2 / 3; r.iy = c[4] + (c[2] - c[4]) * 2 / 3;
        cur.n.push(r);
      } else if (op === "Z") finish(true);
    });
    finish(false);
    paths.forEach(function (p) { p.n.forEach(function (n) { n.k = kindOf(n); }); });
    return paths;
  }

  function seg(out, a, b) {
    if (!hasOut(a) && !hasIn(b)) out.push(["L", b.x, b.y]);
    else out.push(["C", a.ox, a.oy, b.ix, b.iy, b.x, b.y]);
  }
  function toCmds(paths) {
    var out = [];
    (paths || []).forEach(function (p) {
      var n = p.n;
      if (!n || n.length < 2) return;
      out.push(["M", n[0].x, n[0].y]);
      for (var i = 1; i < n.length; i++) seg(out, n[i - 1], n[i]);
      if (p.closed) {                 // a straight way back is the Z itself
        var l = n[n.length - 1];
        if (hasOut(l) || hasIn(n[0])) seg(out, l, n[0]);
        out.push(["Z"]);
      }
    });
    return out;
  }

  function clone(paths) {
    return (paths || []).map(function (p) {
      return { closed: !!p.closed, n: p.n.map(function (n) { return { x: n.x, y: n.y, ix: n.ix, iy: n.iy, ox: n.ox, oy: n.oy, k: n.k || "c" }; }) };
    });
  }
  function count(paths) { var k = 0; (paths || []).forEach(function (p) { k += p.n.length; }); return k; }

  // The segments of a path: [[start node index, end node index], …]
  function segsOf(p) {
    var out = [];
    for (var i = 1; i < p.n.length; i++) out.push([i - 1, i]);
    if (p.closed && p.n.length > 1) out.push([p.n.length - 1, 0]);
    return out;
  }
  function bez(p, s) {
    var a = p.n[s[0]], b = p.n[s[1]];
    return [a.x, a.y, a.ox, a.oy, b.ix, b.iy, b.x, b.y];
  }
  function at(c, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
  }

  // ---------- 2. Bounds ----------
  // Roots in (0, 1) of the derivative of one coordinate of a cubic.
  function extremaT(p0, p1, p2, p3) {
    var A = -p0 + 3 * p1 - 3 * p2 + p3, B = 2 * (p0 - 2 * p1 + p2), C = p1 - p0, out = [];
    if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) out.push(-C / B); }
    else {
      var D = B * B - 4 * A * C;
      if (D >= 0) { var s = Math.sqrt(D); out.push((-B + s) / (2 * A), (-B - s) / (2 * A)); }
    }
    return out.filter(function (t) { return t > 0 && t < 1; });
  }
  function bounds(src) {
    var paths = src && src.length && Array.isArray(src[0]) ? fromCmds(src) : src;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    (paths || []).forEach(function (p) {
      p.n.forEach(function (n) { add(n.x, n.y); });
      segsOf(p).forEach(function (s) {
        var c = bez(p, s);
        extremaT(c[0], c[2], c[4], c[6]).concat(extremaT(c[1], c[3], c[5], c[7])).forEach(function (t) {
          var q = at(c, t); add(q[0], q[1]);
        });
      });
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- 3. Item boxes ----------
  // frame = { x, y, w, h, rot }: the item's box when the paths were
  // taken out of it; the paths are in its unrotated space (0,0 = the
  // box's top-left corner before rotation about its centre). A new
  // outline uses { x: 0, y: 0, w: 0, h: 0, rot: 0 } with paths in page
  // points.
  function reframe(frame, paths) {
    var b = bounds(paths);
    var w = Math.max(MIN_BOX, b.w), h = Math.max(MIN_BOX, b.h);
    var lx = b.x + b.w / 2, ly = b.y + b.h / 2;               // new centre, frame space
    var a = (frame.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var dx = lx - frame.w / 2, dy = ly - frame.h / 2;
    var cx = frame.x + frame.w / 2 + dx * c - dy * s, cy = frame.y + frame.h / 2 + dx * s + dy * c;
    var ox = lx - w / 2, oy = ly - h / 2;
    var unit = toCmds(paths).map(function (cmd) {
      var o = [cmd[0]];
      for (var i = 1; i < cmd.length; i += 2) o.push((cmd[i] - ox) / w, (cmd[i + 1] - oy) / h);
      return o;
    });
    return { x: r3(cx - w / 2), y: r3(cy - h / 2), w: r3(w), h: r3(h), rot: frame.rot || 0, unit: unit };
  }
  function scaled(unit, w, h) {
    return (unit || []).map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) o.push(c[i] * w, c[i + 1] * h);
      return o;
    });
  }

  // ---------- 4. Finding and splitting ----------
  function nearest(paths, x, y) {
    var best = null;
    (paths || []).forEach(function (p, pi) {
      segsOf(p).forEach(function (s, si) {
        var c = bez(p, s), N = 32, bt = 0, bd = Infinity;
        for (var k = 0; k <= N; k++) {
          var q = at(c, k / N), d = Math.hypot(q[0] - x, q[1] - y);
          if (d < bd) { bd = d; bt = k / N; }
        }
        var lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
        for (var it = 0; it < 30; it++) {                  // golden section
          var m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
          var q1 = at(c, m1), q2 = at(c, m2);
          if (Math.hypot(q1[0] - x, q1[1] - y) < Math.hypot(q2[0] - x, q2[1] - y)) hi = m2; else lo = m1;
        }
        var t = (lo + hi) / 2, q3 = at(c, t), d3 = Math.hypot(q3[0] - x, q3[1] - y);
        if (d3 > bd) { t = bt; q3 = at(c, t); d3 = bd; }
        if (!best || d3 < best.d) best = { pi: pi, si: si, t: t, x: q3[0], y: q3[1], d: d3 };
      });
    });
    return best;
  }

  // Split segment si of path pi at t (de Casteljau): the outline keeps
  // its shape. Returns the new node's index.
  function split(paths, pi, si, t) {
    var p = paths[pi], s = segsOf(p)[si];
    if (!s) return -1;
    t = Math.min(0.999, Math.max(0.001, t));
    var a = p.n[s[0]], b = p.n[s[1]];
    var straight = !hasOut(a) && !hasIn(b);
    function lerp(u, v) { return [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]; }
    var P0 = [a.x, a.y], P1 = [a.ox, a.oy], P2 = [b.ix, b.iy], P3 = [b.x, b.y];
    var A = lerp(P0, P1), B = lerp(P1, P2), C = lerp(P2, P3), D = lerp(A, B), E = lerp(B, C), F = lerp(D, E);
    var m = node(F[0], F[1]);
    if (!straight) {
      a.ox = A[0]; a.oy = A[1];
      m.ix = D[0]; m.iy = D[1]; m.ox = E[0]; m.oy = E[1];
      b.ix = C[0]; b.iy = C[1];
      m.k = kindOf(m) === "c" ? "s" : kindOf(m);
    }
    var at2 = s[1] === 0 ? p.n.length : s[1];
    p.n.splice(at2, 0, m);
    return at2;
  }

  function reverse(p) {
    p.n.reverse();
    p.n.forEach(function (n) {
      var x = n.ix, y = n.iy;
      n.ix = n.ox; n.iy = n.oy; n.ox = x; n.oy = y;
    });
    return p;
  }

  // ---------- 5. Editing nodes ----------
  function neighbours(p, ni) {
    var L = p.n.length;
    var prev = ni > 0 ? p.n[ni - 1] : p.closed ? p.n[L - 1] : null;
    var next = ni < L - 1 ? p.n[ni + 1] : p.closed ? p.n[0] : null;
    return { prev: prev === p.n[ni] ? null : prev, next: next === p.n[ni] ? null : next };
  }
  function straight(n) { n.ix = n.x; n.iy = n.y; n.ox = n.x; n.oy = n.y; n.k = "c"; }

  // Make a node smooth or symmetric, building handles along the line
  // between its neighbours when it has none.
  function setKind(paths, pi, ni, k) {
    var p = paths[pi], n = p && p.n[ni];
    if (!n) return;
    n.k = k;
    if (k === "c") return;
    var nb = neighbours(p, ni);
    var ix = n.ix - n.x, iy = n.iy - n.y, ox = n.ox - n.x, oy = n.oy - n.y;
    var li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
    var dx, dy;
    if (li > EPS && lo > EPS) { dx = ox / lo - ix / li; dy = oy / lo - iy / li; }
    else if (lo > EPS) { dx = ox; dy = oy; }
    else if (li > EPS) { dx = -ix; dy = -iy; }
    else {
      var a = nb.prev || n, b = nb.next || n;
      dx = b.x - a.x; dy = b.y - a.y;
      if (Math.hypot(dx, dy) < EPS) { dx = 1; dy = 0; }
    }
    var l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (li < EPS) li = nb.prev ? Math.hypot(nb.prev.x - n.x, nb.prev.y - n.y) / 3 : lo;
    if (lo < EPS) lo = nb.next ? Math.hypot(nb.next.x - n.x, nb.next.y - n.y) / 3 : li;
    if (k === "y") { li = lo = (li + lo) / 2; }
    if (!nb.prev) li = 0;
    if (!nb.next) lo = 0;
    n.ix = n.x - dx * li; n.iy = n.y - dy * li;
    n.ox = n.x + dx * lo; n.oy = n.y + dy * lo;
  }

  // Move one handle; the other follows the node's kind (free = Alt:
  // the node becomes a corner).
  function moveHandle(n, which, x, y, free) {
    if (free) n.k = "c";
    if (which === "i") { n.ix = x; n.iy = y; } else { n.ox = x; n.oy = y; }
    if (n.k === "c") return;
    var mx = x - n.x, my = y - n.y, l = Math.hypot(mx, my);
    if (l < EPS) return;
    var other = which === "i" ? Math.hypot(n.ox - n.x, n.oy - n.y) : Math.hypot(n.ix - n.x, n.iy - n.y);
    if (n.k === "y") other = l;
    if (other < EPS) return;                                 // a smooth node next to a line keeps its line side
    var ux = -mx / l * other, uy = -my / l * other;
    if (which === "i") { n.ox = n.x + ux; n.oy = n.y + uy; } else { n.ix = n.x + ux; n.iy = n.y + uy; }
  }

  // keys: { "pi:ni": 1 }. A path left with fewer than 2 nodes goes.
  function removeNodes(paths, keys) {
    var out = [];
    paths.forEach(function (p, pi) {
      var n = p.n.filter(function (x, ni) { return !keys[pi + ":" + ni]; });
      if (n.length >= 2) out.push({ closed: p.closed && n.length > 1, n: n });
    });
    return out.length ? out : null;
  }

  // Break at a node: a closed path opens there; an open path splits in
  // two (its ends do not break).
  function breakAt(paths, pi, ni) {
    var p = paths[pi];
    if (!p || !p.n[ni]) return false;
    var c = p.n[ni], copy = { x: c.x, y: c.y, ix: c.ix, iy: c.iy, ox: c.ox, oy: c.oy, k: "c" };
    if (p.closed) {
      var n = p.n.slice(ni).concat(p.n.slice(0, ni));
      n[0] = { x: c.x, y: c.y, ix: c.x, iy: c.y, ox: c.ox, oy: c.oy, k: "c" };
      copy.ox = copy.x; copy.oy = copy.y;
      n.push(copy);
      p.n = n; p.closed = false;
      return true;
    }
    if (ni === 0 || ni === p.n.length - 1) return false;
    var first = p.n.slice(0, ni + 1), second = p.n.slice(ni);
    first[ni] = { x: c.x, y: c.y, ix: c.ix, iy: c.iy, ox: c.x, oy: c.y, k: "c" };
    second[0] = { x: c.x, y: c.y, ix: c.x, iy: c.y, ox: c.ox, oy: c.oy, k: "c" };
    p.n = first;
    paths.splice(pi + 1, 0, { closed: false, n: second });
    return true;
  }

  function isEnd(paths, e) {
    var p = paths[e.pi];
    return !!p && !p.closed && (e.ni === 0 || e.ni === p.n.length - 1);
  }
  // Join two open ends: of one path → it closes; of two paths → one
  // path (ends on the same spot become one node, else a straight line).
  function join(paths, a, b) {
    if (!isEnd(paths, a) || !isEnd(paths, b)) return false;
    if (a.pi === b.pi) {
      if (a.ni === b.ni) return false;
      return setClosed(paths, a.pi, true);
    }
    var A = paths[a.pi], B = paths[b.pi];
    if (a.ni === 0) reverse(A);                    // A ends with its joined node
    if (b.ni !== 0) reverse(B);                    // B starts with its joined node
    var ea = A.n[A.n.length - 1], sb = B.n[0];
    if (Math.hypot(ea.x - sb.x, ea.y - sb.y) < 0.5) {
      ea.ox = sb.ox + ea.x - sb.x; ea.oy = sb.oy + ea.y - sb.y; ea.k = kindOf(ea);
      A.n = A.n.concat(B.n.slice(1));
    } else A.n = A.n.concat(B.n);
    paths.splice(b.pi, 1);
    return true;
  }

  function setClosed(paths, pi, on) {
    var p = paths[pi];
    if (!p) return false;
    if (!on) { if (!p.closed) return false; p.closed = false; return true; }
    if (p.closed || p.n.length < 2) return false;
    var a = p.n[0], b = p.n[p.n.length - 1];
    if (p.n.length > 2 && Math.hypot(a.x - b.x, a.y - b.y) < 0.5) {
      a.ix = b.ix + a.x - b.x; a.iy = b.iy + a.y - b.y; a.k = kindOf(a);
      p.n.pop();
    }
    p.closed = true;
    return true;
  }

  // ---------- 6. Shapes as outlines ----------
  function rectCmds(w, h, r) {
    r = Math.max(0, Math.min(Number(r) || 0, w / 2, h / 2));
    if (!r) return [["M", 0, 0], ["L", w, 0], ["L", w, h], ["L", 0, h], ["Z"]];
    var k = r * KAPPA;
    return [["M", r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h - r],
      ["C", w, h - r + k, w - r + k, h, w - r, h], ["L", r, h], ["C", r - k, h, 0, h - r + k, 0, h - r],
      ["L", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["Z"]];
  }
  function ellCmds(w, h) {
    var rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
    return [["M", rx, 0], ["C", rx + kx, 0, w, ry - ky, w, ry], ["C", w, ry + ky, rx + kx, h, rx, h],
      ["C", rx - kx, h, 0, ry + ky, 0, ry], ["C", 0, ry - ky, rx - kx, 0, rx, 0], ["Z"]];
  }

  // ---------- 7. Text ----------
  function num(v, d) {
    var f = Math.pow(10, d), s = String(Math.round(v * f) / f);
    return s === "-0" ? "0" : s;
  }
  function text(cmds, digits) {
    var d = digits === undefined ? 4 : digits;
    return (cmds || []).map(function (c) { return c[0] + c.slice(1).map(function (v) { return num(v, d); }).join(" "); }).join("");
  }
  // Atelier ext.pth: one string, or chunks of ≤ 4000 characters, at
  // most `room` characters of JSON in all; 4 decimals, else 3; null
  // when it does not fit.
  function pack(unit, room) {
    for (var d = 4; d >= 3; d--) {
      var s = text(unit, d), out = [];
      for (var i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
      var v = out.length === 1 ? out[0] : out;
      if (s.length && JSON.stringify(v).length <= room) return v;
    }
    return null;
  }

  var api = {
    MAX_NODES: MAX_NODES, MIN_BOX: MIN_BOX,
    fromCmds: fromCmds, toCmds: toCmds, clone: clone, count: count, kindOf: kindOf,
    bounds: bounds, reframe: reframe, scaled: scaled,
    nearest: nearest, split: split, reverse: reverse,
    setKind: setKind, straight: straight, moveHandle: moveHandle,
    removeNodes: removeNodes, breakAt: breakAt, join: join, setClosed: setClosed, isEnd: isEnd,
    rectCmds: rectCmds, ellCmds: ellCmds, text: text, pack: pack, segsOf: segsOf, at: at, bez: bez
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.vector = api; }
})(typeof window !== "undefined" ? window : this);
