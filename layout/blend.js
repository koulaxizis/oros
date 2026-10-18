// ============================================================
// orOS Layout — blend: n shapes stepping from one shape to another
// (wave C1, v1.0.0). Pure: no DOM; edits a working copy of the
// document inside LY.op. Same idea as Atelier's blend (atelier/
// blend.js), on designkit items:
// - two rectangles stay rectangles (corner radius blended), two
//   ellipses stay ellipses; any other pair becomes "path" items
//   whose outline morphs (designkit/blend.js), so every copy of
//   Layout draws the steps without knowing about blends;
// - colours are swatches: a step whose colour differs from both ends
//   gets a swatch of its own (CMYK when both ends are CMYK, else
//   RGB), marked ext.bl = group id; Update and Release keep the
//   swatches a step still uses and remove the rest;
// - a gradient fill is the nearer end's;
// - ext.bl = { g, a, b, n, i } on each step, like Atelier.
//   canBlend(a, b), make(doc, a, b, n, now), update(doc, g, n, now),
//   release(doc, g, now), groupOf(it), members(doc, g), ends(doc, g)
// Exposes window.LayoutBlend (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, B;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); B = require("../designkit/blend.js");
  } else {
    M = root.orosDK.model; B = root.orosDK.blend;
  }

  var MIN_STEPS = 1, MAX_STEPS = 50, DEF_STEPS = 5;
  var SHAPES = { rect: 1, ell: 1, path: 1 };
  var KAPPA = 0.5522847498;

  function isShape(it) { return !!(it && SHAPES[it.t] && !it.lock); }
  function canBlend(a, b) { return isShape(a) && isShape(b) && a.id !== b.id && a.pg === b.pg; }
  function steps(n) { n = Math.round(Number(n)); return isFinite(n) ? Math.min(MAX_STEPS, Math.max(MIN_STEPS, n)) : DEF_STEPS; }

  function groupOf(it) {
    var bl = it && it.ext && it.ext.bl;
    return bl && typeof bl === "object" && typeof bl.g === "string" ? bl.g : "";
  }
  function members(doc, g) {
    return g ? doc.items.filter(function (it) { return groupOf(it) === g; }) : [];
  }
  function ends(doc, g) {
    var m = members(doc, g)[0];
    if (!m) return null;
    var a = M.find(doc.items, m.ext.bl.a), b = M.find(doc.items, m.ext.bl.b);
    return canBlend(a, b) ? { a: a, b: b } : null;
  }

  // ---------- outlines in unit space ----------
  function ellUnit() {
    var k = KAPPA / 2;
    return [["M", 0.5, 0], ["C", 0.5 + k, 0, 1, 0.5 - k, 1, 0.5], ["C", 1, 0.5 + k, 0.5 + k, 1, 0.5, 1],
      ["C", 0.5 - k, 1, 0, 0.5 + k, 0, 0.5], ["C", 0, 0.5 - k, 0.5 - k, 0, 0.5, 0], ["Z"]];
  }
  function rectUnit(w, h, r) {
    w = Math.max(0.01, Math.abs(w)); h = Math.max(0.01, Math.abs(h));
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) return [["M", 0, 0], ["L", 1, 0], ["L", 1, 1], ["L", 0, 1], ["Z"]];
    var c = [], k = r * KAPPA;
    c.push(["M", r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h - r],
      ["C", w, h - r + k, w - r + k, h, w - r, h], ["L", r, h], ["C", r - k, h, 0, h - r + k, 0, h - r],
      ["L", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["Z"]);
    return B.toUnit(c, w, h);
  }
  function unitOf(it) {
    if (it.t === "ell") return ellUnit();
    if (it.t === "path") return M.parsePath(it.d) || [];
    return rectUnit(it.w, it.h, it.r);
  }

  // ---------- colours ----------
  function swatchOf(doc, id) { return id ? M.find(doc.swatches, id) : null; }
  function vals(doc, sw, mode) {
    if (sw.mode === mode) return sw.v.slice();
    return M.swatchColor(doc, sw.id).rgb;
  }
  function label(mode, v) {
    return mode === "cmyk"
      ? "C" + Math.round(v[0]) + " M" + Math.round(v[1]) + " Y" + Math.round(v[2]) + " K" + Math.round(v[3])
      : "#" + v.map(function (x) { var s = Math.round(x).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }
  // the swatch id for colour a → b at t ("" none). A new swatch is
  // marked with the blend group, so update / release can tidy it.
  function mixSwatch(doc, ida, idb, t, g, now) {
    var sa = swatchOf(doc, ida), sb = swatchOf(doc, idb);
    if (!sa && !sb) return "";
    if (!sa || !sb || sa.id === sb.id) return (sa || sb).id;
    var mode = sa.mode === "cmyk" && sb.mode === "cmyk" ? "cmyk" : "rgb";
    var v = B.mixVals(vals(doc, sa, mode), vals(doc, sb, mode), t).map(function (x) {
      return mode === "cmyk" ? Math.round(x * 10) / 10 : Math.round(x);
    });
    for (var i = 0; i < doc.swatches.length; i++) {
      var s = doc.swatches[i];
      if (s.mode === mode && s.v.join() === v.join()) return s.id;
    }
    var nsw = { id: M.newId("sw"), m: now, name: label(mode, v), mode: mode, v: v, ext: { bl: g } };
    doc.swatches.push(nsw);
    return nsw.id;
  }
  // swatches made for blend g that no item or gradient uses any more
  function tidySwatches(doc, g, now) {
    var used = {};
    doc.items.forEach(function (it) {
      if (it.fill) used[it.fill] = 1;
      if (it.stroke) used[it.stroke] = 1;
      if (it.gr) it.gr.st.forEach(function (s) { used[s[1]] = 1; });
    });
    (doc.stories || []).forEach(function (st) {
      JSON.stringify(st).replace(/"(sw-[a-z0-9]+)"/g, function (m, id) { used[id] = 1; return m; });
    });
    ["pstyles", "cstyles"].forEach(function (c) {
      (doc[c] || []).forEach(function (s) { JSON.stringify(s).replace(/"(sw-[a-z0-9]+)"/g, function (m, id) { used[id] = 1; return m; }); });
    });
    doc.swatches = doc.swatches.filter(function (s) {
      var mine = s.ext && s.ext.bl === g;
      if (mine && !used[s.id]) { doc.tombs[s.id] = now; return false; }
      return true;
    });
  }

  // z strictly between the ends (see atelier/blend.js)
  function zSlots(doc, a, b, n, now) {
    var lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z), need = (n + 1) * 0.01;
    var low = a.z <= b.z ? a.id : b.id;
    if (hi - lo < need) {
      var up = Math.ceil(n + 1 - (hi - lo));
      doc.items.forEach(function (it) {
        if (it.pg === a.pg && it.z >= hi && it.id !== low) { it.z += up; M.touch(it, now); }
      });
      hi += up;
    }
    var from = a.z <= b.z ? lo : hi, to = a.z <= b.z ? hi : lo;
    return B.steps(n).map(function (t) { return Math.round(B.num(from, to, t) * 100) / 100; });
  }

  function make(doc, a, b, n, now, g, reuse) {
    a = typeof a === "string" ? M.find(doc.items, a) : a;
    b = typeof b === "string" ? M.find(doc.items, b) : b;
    if (!canBlend(a, b)) return null;
    n = steps(n);
    if (doc.items.length + n > M.MAX_ITEMS) return null;
    g = g || M.newId("bl");
    var kind = a.t === b.t && a.t !== "path" ? a.t : "path";
    var plan = kind === "path" ? B.prepare(unitOf(a), unitOf(b)) : null;
    var zs = zSlots(doc, a, b, n, now), ids = [];
    B.steps(n).forEach(function (t, i) {
      var near = t < 0.5 ? a : b, old = reuse && reuse[i];
      var it = {
        id: old ? old.id : M.newId("it"), m: old ? Math.max(now, old.m + 1) : now, t: kind, pg: a.pg, side: a.side,
        x: B.num(a.x, b.x, t), y: B.num(a.y, b.y, t), w: B.num(a.w, b.w, t), h: B.num(a.h, b.h, t),
        rot: B.angle(a.rot || 0, b.rot || 0, t), z: zs[i],
        fill: near.gr ? "" : mixSwatch(doc, a.gr ? "" : a.fill, b.gr ? "" : b.fill, t, g, now),
        stroke: mixSwatch(doc, a.sw > 0 ? a.stroke : "", b.sw > 0 ? b.stroke : "", t, g, now),
        sw: B.num(a.sw || 0, b.sw || 0, t), dash: near.dash, op: Math.round(B.num(a.op, b.op, t)),
        grp: a.grp && a.grp === b.grp ? a.grp : "", wrap: near.wrap, wo: near.wo,
        ext: { bl: { a: a.id, b: b.id, g: g, i: i + 1, n: n } }
      };
      if (kind === "rect") it.r = B.num(a.r || 0, b.r || 0, t);
      if (near.gr) it.gr = JSON.parse(JSON.stringify(near.gr));
      if (plan) it.d = M.pathText(B.at(plan, t));
      var ni = M.normItem(it);
      if (!ni) return;
      doc.items.push(ni);
      ids.push(ni.id);
    });
    return { g: g, ids: ids };
  }

  function update(doc, g, n, now) {
    var e = ends(doc, g), old = members(doc, g);
    if (!e) return null;
    n = steps(n === undefined || n === null ? old[0].ext.bl.n : n);
    old.sort(function (x, y) { return x.ext.bl.i - y.ext.bl.i; });
    var reuse = old.slice(0, n).map(function (it) { return { id: it.id, m: it.m }; });
    var gone = old.map(function (it) { return it.id; });
    doc.items = doc.items.filter(function (it) { return gone.indexOf(it.id) < 0; });
    gone.slice(n).forEach(function (id) { doc.tombs[id] = now; });
    var res = make(doc, e.a, e.b, n, now, g, reuse);
    tidySwatches(doc, g, now);
    return res;
  }

  function release(doc, g, now) {
    var list = members(doc, g);
    list.forEach(function (it) {
      var x = {};
      Object.keys(it.ext).forEach(function (k) { if (k !== "bl") x[k] = it.ext[k]; });
      if (Object.keys(x).length) it.ext = x; else delete it.ext;
      M.touch(it, now);
    });
    // the steps' own swatches become ordinary swatches
    doc.swatches.forEach(function (s) {
      if (s.ext && s.ext.bl === g) { delete s.ext.bl; if (!Object.keys(s.ext).length) delete s.ext; M.touch(s, now); }
    });
    return list.length;
  }

  // a pasted copy of a step is a plain shape
  function unlink(it) {
    if (it && it.ext && it.ext.bl) { delete it.ext.bl; if (!Object.keys(it.ext).length) delete it.ext; }
    return it;
  }

  var api = {
    MIN_STEPS: MIN_STEPS, MAX_STEPS: MAX_STEPS, DEF_STEPS: DEF_STEPS,
    canBlend: canBlend, make: make, update: update, release: release, unlink: unlink,
    groupOf: groupOf, members: members, ends: ends, steps: steps, tidySwatches: tidySwatches
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LayoutBlend = api;
})(typeof window !== "undefined" ? window : this);
