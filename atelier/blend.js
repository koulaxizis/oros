// ============================================================
// orOS Atelier — blend: n shapes stepping from one shape to another
// (wave C1, v1.0.0). Pure: no DOM; edits a working copy of the
// design inside AT.op.
// The steps are ordinary shape items: the box, rotation, opacity,
// stroke width, fill / gradient, stroke colour and roundness move
// evenly from A to B. Two different shapes morph: each step keeps
// its outline in ext.pth (unit path, ax.js) and its shp is the nearer
// end's, which older copies draw instead. ext.bl = { g, a, b, n, i }
// ties the steps to A and B, so Blend › Update makes them again
// from what A and B look like now and Release leaves them as plain
// shapes. A and B themselves are not changed.
//   canBlend(a, b)            → true for two shapes on the same page
//   make(doc, a, b, n, now)   → { g, ids } or null (the steps added)
//   update(doc, g, n, now)    → the same, after removing the old steps
//   release(doc, g, now)      → number of steps let go
//   groupOf(it), members(doc, g), ends(doc, g)
// Exposes window.AtelierBlend (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, AX, B;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); AX = require("./ax.js"); B = require("../designkit/blend.js");
  } else {
    M = root.orosDK.model; AX = root.AtelierAX; B = root.orosDK.blend;
  }

  var MIN_STEPS = 1, MAX_STEPS = 50, DEF_STEPS = 5;
  var PTH_MAX = 7400;              // room left in ext (8192) for bl and the rest
  var CHUNK = 4000;                // normX's longest string
  var RD_DEF = 30;

  function isShape(it) { return !!(it && it.ax && it.ax.k === "shape" && !it.ax.bg); }
  function canBlend(a, b) { return isShape(a) && isShape(b) && a.id !== b.id && a.pg === b.pg; }
  function steps(n) { n = Math.round(Number(n)); return isFinite(n) ? Math.min(MAX_STEPS, Math.max(MIN_STEPS, n)) : DEF_STEPS; }

  function groupOf(it) {
    var bl = it && it.ext && it.ext.bl;
    return bl && typeof bl.g === "string" ? bl.g : "";
  }
  function members(doc, g) {
    return g ? doc.items.filter(function (it) { return groupOf(it) === g; }) : [];
  }
  // the two ends of blend g, from its steps' ext.bl (null when gone)
  function ends(doc, g) {
    var m = members(doc, g)[0];
    if (!m) return null;
    var a = M.find(doc.items, m.ext.bl.a), b = M.find(doc.items, m.ext.bl.b);
    return canBlend(a, b) ? { a: a, b: b } : null;
  }

  // fill of a shape as a gradient { a, b, ang } or null (no fill)
  function fillOf(ax) {
    if (ax.g) return { a: ax.g.a, b: ax.g.b, ang: ax.g.ang === undefined ? 90 : ax.g.ang };
    return ax.fc ? { a: ax.fc, b: ax.fc, ang: 90 } : null;
  }
  function mixFill(fa, fb, t) {
    if (!fa && !fb) return null;
    fa = fa || fb; fb = fb || fa;
    return { a: B.hex(fa.a, fb.a, t), b: B.hex(fa.b, fb.b, t), ang: Math.round(B.angle(fa.ang, fb.ang, t)) };
  }
  // unit outline of a shape (its own path or its library shape)
  function unitOf(it) {
    return B.toUnit(AX.shapeCmds(it), Math.max(0.01, it.w), Math.max(0.01, it.h));
  }
  function r(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }
  // unit path text in chunks, or null when it is too long for ext
  function chunks(cmds) {
    for (var d = 4; d >= 3; d--) {
      var s = cmds.map(function (c) { return c[0] + c.slice(1).map(function (v) { return String(r(v, d)); }).join(" "); }).join("");
      if (s.length <= PTH_MAX) {
        var out = [];
        for (var i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
        return out.length === 1 ? out[0] : out;
      }
    }
    return null;
  }

  // Room in z between the ends: steps go strictly between a.z and b.z
  // (z keeps two decimals); when the gap is too small, the higher end
  // and everything above it on the page move up.
  function zSlots(doc, a, b, n, now) {
    var lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z), need = (n + 1) * 0.01;
    if (hi - lo < need) {
      var up = Math.ceil(n + 1 - (hi - lo));
      doc.items.forEach(function (it) {
        if (it.pg === a.pg && it.z >= hi && it.id !== (a.z <= b.z ? a.id : b.id)) { it.z += up; M.touch(it, now); }
      });
      hi += up;
    }
    var from = a.z <= b.z ? lo : hi, to = a.z <= b.z ? hi : lo;
    return B.steps(n).map(function (t) { return Math.round(B.num(from, to, t) * 100) / 100; });
  }

  // reuse: [{ id, m }] the ids of the old steps (update), kept in
  // order so other devices see the same steps changed, not new ones
  function make(doc, a, b, n, now, g, reuse) {
    a = typeof a === "string" ? M.find(doc.items, a) : a;
    b = typeof b === "string" ? M.find(doc.items, b) : b;
    if (!canBlend(a, b)) return null;
    n = steps(n);
    if (doc.items.length + n > M.MAX_ITEMS) return null;
    g = g || M.newId("bl");
    var A = a.ax, Bx = b.ax, ts = B.steps(n), zs = zSlots(doc, a, b, n, now);
    var same = (A.shp || "rect") === (Bx.shp || "rect") && !AX.pthOf(a) && !AX.pthOf(b);
    var plan = same ? null : B.prepare(unitOf(a), unitOf(b));
    var fa = fillOf(A), fb = fillOf(Bx), ids = [];
    ts.forEach(function (t, i) {
      var f = mixFill(fa, fb, t), spec = {
        k: "shape", shp: (t < 0.5 ? A.shp : Bx.shp) || "rect",
        x: B.num(a.x, b.x, t), y: B.num(a.y, b.y, t),
        w: B.num(a.w, b.w, t), h: B.num(a.h, b.h, t),
        rot: B.angle(a.rot || 0, b.rot || 0, t),
        op: Math.round(B.num(a.op, b.op, t)), sw: B.num(a.sw || 0, b.sw || 0, t), z: zs[i]
      };
      if (f && f.a === f.b && !A.g && !Bx.g) spec.fc = f.a;
      else if (f) { spec.g = f; spec.fc = f.a; }
      if (A.sc || Bx.sc) spec.sc = B.hex(A.sc || Bx.sc, Bx.sc || A.sc, t);
      var rd = Math.round(B.num(A.rd === undefined ? RD_DEF : A.rd, Bx.rd === undefined ? RD_DEF : Bx.rd, t));
      if (rd !== RD_DEF) spec.rd = rd;
      var it = AX.addItem(doc, a.pg, spec, now);
      if (!it) return;
      var old = reuse && reuse[i];
      if (old) { it.id = old.id; it.m = Math.max(now, old.m + 1); }
      if (a.dash && b.dash) it.dash = 1;
      var ext = { bl: { a: a.id, b: b.id, g: g, i: i + 1, n: n } };
      if (plan) { var p = chunks(B.at(plan, t)); if (p) ext.pth = p; }
      it.ext = ext;
      var ni = M.normItem(it);
      if (ni) doc.items[doc.items.indexOf(it)] = ni;
      ids.push(it.id);
    });
    return { g: g, ids: ids };
  }

  function remove(doc, list, now, keep) {
    var ids = list.map(function (it) { return it.id; });
    doc.items = doc.items.filter(function (it) { return ids.indexOf(it.id) < 0; });
    ids.slice(keep || 0).forEach(function (id) { doc.tombs[id] = now; });
  }

  // Make blend g again from its ends as they are now (n: new count,
  // or the old one). The steps keep the group id, so a selection of
  // them still finds the blend. Null when an end is gone.
  function update(doc, g, n, now) {
    var e = ends(doc, g), old = members(doc, g);
    if (!e) return null;
    if (n === undefined || n === null) n = old[0].ext.bl.n;
    n = steps(n);
    old.sort(function (x, y) { return x.ext.bl.i - y.ext.bl.i; });
    var reuse = old.slice(0, n).map(function (it) { return { id: it.id, m: it.m }; });
    remove(doc, old, now, n);
    return make(doc, e.a, e.b, n, now, g, reuse);
  }

  function release(doc, g, now) {
    var list = members(doc, g);
    list.forEach(function (it) {
      var x = {};
      Object.keys(it.ext).forEach(function (k) { if (k !== "bl") x[k] = it.ext[k]; });
      if (Object.keys(x).length) it.ext = x; else delete it.ext;
      M.touch(it, now);
    });
    return list.length;
  }

  var api = {
    MIN_STEPS: MIN_STEPS, MAX_STEPS: MAX_STEPS, DEF_STEPS: DEF_STEPS,
    canBlend: canBlend, make: make, update: update, release: release,
    groupOf: groupOf, members: members, ends: ends, steps: steps
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierBlend = api;
})(typeof window !== "undefined" ? window : this);
