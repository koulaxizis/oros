// ============================================================
// orOS Atelier — morph: one page turns into the next (wave C2, v1.0.0)
// A page whose background has ext.mph = 1 morphs in from the page
// before it: what the two pages share moves, resizes, turns and
// changes colour into place, and a shape turns into another shape
// (designkit/blend.js outlines). The rest fades: the old page's
// elements out, the new page's in. An element with its own entrance
// animation (ax.an) on the new page does not take part: it enters
// after the morph, as on any page. Older copies keep ax.ptr and show
// that transition instead.
// Which elements pair (old page → new page):
//   1. the two backgrounds
//   2. the same content: text with the same words, a photo or video
//      of the same picture / clip, the same icon
//   3. what is left, kind by kind in layer order (shapes, lines,
//      texts, icons, photos); a text or icon whose content differs
//      crossfades while it moves
//   Tables and charts never pair: they fade.
// Used only while drawing (preview, Present, video, GIF): nothing is
// stored, and a still export draws the finished page.
//   isOn(doc, pg)                → true when page pg morphs in
//   pairs(doc, fromPg, toPg)     → [{ a, b }] (a or b null: fades)
//   frame(doc, fromPg, toPg, p)  → drawn copies at 0 ≤ p ≤ 1, in z order
//   ease(p)                      → the morph's ease in-out
// Pure: no DOM. Exposes window.AtelierMorph (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var AX, B;
  if (typeof module !== "undefined" && module.exports) {
    AX = require("./ax.js"); B = require("../designkit/blend.js");
  } else {
    AX = root.AtelierAX; B = root.orosDK.blend;
  }

  var RD_DEF = 30;
  var ORDER = ["shape", "line", "text", "icon", "photo"];

  function bgOf(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      if (it.pg === pg && it.ax && it.ax.bg) return it;
    }
    return null;
  }
  function isOn(doc, pg) {
    var b = bgOf(doc, pg);
    return !!(b && b.ax.k === "shape" && b.ext && b.ext.mph === 1);
  }
  function ease(p) {
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  function itemsOf(doc, pg) {
    return doc.items.filter(function (it) { return it.pg === pg && it.ax && !it.hide && !it.ax.tg; })
      .sort(function (a, b) { return a.z - b.z; });
  }
  // the content that makes two elements "the same one"
  function keyOf(it) {
    var ax = it.ax;
    if (ax.k === "text") return "t|" + ax.tx;
    if (ax.k === "photo") return it.a || ax.vid ? "p|" + (it.a || "") + "|" + (ax.vid || "") : "";
    if (ax.k === "icon") return "i|" + ax.ico;
    return "";
  }
  function pairable(it) { return ORDER.indexOf(it.ax.k) >= 0; }

  function pairs(doc, fromPg, toPg) {
    var A = itemsOf(doc, fromPg), Bs = itemsOf(doc, toPg), out = [];
    var usedA = {}, usedB = {};
    function take(a, b) { usedA[a.id] = 1; usedB[b.id] = 1; out.push({ a: a, b: b }); }
    var ba = A.filter(function (it) { return it.ax.bg; })[0], bb = Bs.filter(function (it) { return it.ax.bg; })[0];
    if (ba && bb && ba.ax.k === bb.ax.k) take(ba, bb);
    // entering elements wait for their own entrance
    Bs.forEach(function (b) { if (b.ax.an && !b.ax.bg) usedB[b.id] = 2; });
    function free(list, used) { return list.filter(function (it) { return !used[it.id] && !it.ax.bg && pairable(it); }); }
    free(Bs, usedB).forEach(function (b) {
      var k = keyOf(b);
      if (!k) return;
      var a = free(A, usedA).filter(function (x) { return x.ax.k === b.ax.k && keyOf(x) === k; })[0];
      if (a) take(a, b);
    });
    ORDER.forEach(function (kind) {
      var fa = free(A, usedA).filter(function (x) { return x.ax.k === kind; });
      var fb = free(Bs, usedB).filter(function (x) { return x.ax.k === kind; });
      for (var i = 0; i < Math.min(fa.length, fb.length); i++) take(fa[i], fb[i]);
    });
    A.forEach(function (a) { if (!usedA[a.id]) out.push({ a: a, b: null }); });
    Bs.forEach(function (b) { if (usedB[b.id] !== 1) out.push({ a: null, b: b }); });
    return out;
  }

  // ---------- one drawn copy ----------
  function copy(it) {
    var c = {};
    Object.keys(it).forEach(function (k) { c[k] = it[k]; });
    c.ax = {};
    Object.keys(it.ax).forEach(function (k) { c.ax[k] = it.ax[k]; });
    if (it.ext) { c.ext = {}; Object.keys(it.ext).forEach(function (k) { c.ext[k] = it.ext[k]; }); }
    return c;
  }
  function opOf(it) { return it.op === undefined ? 100 : it.op; }
  function col(a, b, t) { return a && b ? B.hex(a, b, t) : (t < 0.5 ? a : b); }
  function fillOf(ax) {
    if (ax.g) return { a: ax.g.a, b: ax.g.b, ang: ax.g.ang === undefined ? 90 : ax.g.ang };
    return ax.fc ? { a: ax.fc, b: ax.fc, ang: 90 } : null;
  }
  function samePlainOutline(a, b) {
    return (a.ax.shp || "rect") === (b.ax.shp || "rect") && !AX.pthOf(a) && !AX.pthOf(b) &&
      Math.abs(a.w * b.h - a.h * b.w) < 0.01 * Math.max(1, a.w * b.h);
  }

  // outline plans, reused for every frame of the same two shapes
  var plans = {}, planKeys = [];
  function unitOf(it) { return B.toUnit(AX.shapeCmds(it), Math.max(0.01, it.w), Math.max(0.01, it.h)); }
  function planOf(a, b) {
    var k = [a.id, a.m, a.w, a.h, b.id, b.m, b.w, b.h].join("|");
    if (plans[k]) return plans[k];
    var p = B.prepare(unitOf(a), unitOf(b));
    plans[k] = p; planKeys.push(k);
    if (planKeys.length > 64) delete plans[planKeys.shift()];
    return p;
  }
  function pathText(cmds) {
    return cmds.map(function (c) { return c[0] + c.slice(1).map(function (v) { return String(Math.round(v * 1e5) / 1e5); }).join(" "); }).join("");
  }

  // base (a or b) carries the content; geometry and look move a → b
  function mixed(base, a, b, t) {
    var c = copy(base), A = a.ax, X = b.ax;
    c.x = B.num(a.x, b.x, t); c.y = B.num(a.y, b.y, t);
    c.w = B.num(a.w, b.w, t); c.h = B.num(a.h, b.h, t);
    c.rot = B.angle(a.rot || 0, b.rot || 0, t);
    c.op = B.num(opOf(a), opOf(b), t);
    c.sw = B.num(a.sw || 0, b.sw || 0, t);
    c.z = B.num(a.z, b.z, t);
    if (A.k !== "photo" && A.k !== "line") { var fc = col(A.fc, X.fc, t); if (fc) c.ax.fc = fc; else delete c.ax.fc; }
    if (A.k !== "photo") { var sc = col(A.sc, X.sc, t); if (sc) c.ax.sc = sc; else delete c.ax.sc; }
    if (A.k === "shape") {
      var fa = fillOf(A), fb = fillOf(X);
      delete c.ax.g;
      if ((A.g || X.g) && (fa || fb)) {
        fa = fa || fb; fb = fb || fa;
        c.ax.g = { a: B.hex(fa.a, fb.a, t), b: B.hex(fa.b, fb.b, t), ang: B.angle(fa.ang, fb.ang, t) };
      }
      var rd = B.num(A.rd === undefined ? RD_DEF : A.rd, X.rd === undefined ? RD_DEF : X.rd, t);
      c.ax.rd = rd;
      if (!A.bg && !samePlainOutline(a, b)) {
        c.ext = c.ext || {};
        c.ext.pth = pathText(B.at(planOf(a, b), t));
      }
    }
    if (A.k === "text") {
      c.ax.size = B.num(A.size || 48, X.size || 48, t);
      if (A.lh || X.lh) c.ax.lh = B.num(A.lh || 120, X.lh || 120, t);
      if (A.tr || X.tr) c.ax.tr = B.num(A.tr || 0, X.tr || 0, t);
    }
    if (A.k === "photo" && a.fit === "custom" && b.fit === "custom") {
      c.ix = B.num(a.ix || 0, b.ix || 0, t); c.iy = B.num(a.iy || 0, b.iy || 0, t);
      c.isc = B.num(a.isc || 1, b.isc || 1, t);
    }
    return c;
  }
  function faded(it, k) { var c = copy(it); c.op = opOf(it) * k; return c; }
  function contentDiffers(a, b) {
    var k = a.ax.k;
    if (k === "text") return a.ax.tx !== b.ax.tx;
    if (k === "icon") return a.ax.ico !== b.ax.ico;
    if (k === "photo") return keyOf(a) !== keyOf(b);
    return false;
  }

  function frame(doc, fromPg, toPg, p) {
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    var out = [];
    pairs(doc, fromPg, toPg).forEach(function (q) {
      var a = q.a, b = q.b;
      if (a && b) {
        if (contentDiffers(a, b)) {
          out.push(faded(mixed(a, a, b, p), 1 - p), faded(mixed(b, a, b, p), p));
        } else out.push(mixed(p < 0.5 ? a : b, a, b, p));
      } else if (a) out.push(faded(a, 1 - p));
      else if (!b.ax.an || b.ax.bg) out.push(faded(b, p));
    });
    out.forEach(function (c, i) { c._o = i; });
    out.sort(function (x, y) { return x.z - y.z || x._o - y._o; });
    out.forEach(function (c) { delete c._o; c.pg = toPg; });
    return out;
  }

  var api = { isOn: isOn, pairs: pairs, frame: frame, ease: ease };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierMorph = api;
})(typeof window !== "undefined" ? window : this);
