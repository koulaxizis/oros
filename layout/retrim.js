// ============================================================
// orOS Layout — contents that follow a new page size (LY-W8)
// A document, a house style or a starter made for one trim fitted to
// another, the way a designer would move things by hand rather than
// stretching the page like a picture:
//   - a frame that runs to the page edges (a background, a picture in
//     the bleed) still runs to them, its bleed kept;
//   - what sits in a margin (a page number, a running head, a logo at
//     the foot) keeps its edge, its distance in proportion to the
//     margin;
//   - what sits in the text area keeps its place in it, from the old
//     margins to the new;
//   - what is centred stays centred;
//   - pictures, logos, shapes and lines keep their proportions (unless
//     they run to the edges); text frames take the new extent;
//   - guides move with the text area; text sizes stay unless asked
//     (opts.text: paragraph and character styles in proportion).
// retrim(doc, setup, opts) changes doc in place (pages, masters,
// guides) and gives { items, k }; mapRect(rect, from, to, kind) does
// one rectangle (house pages, pro.js). Pure: Node tests.
// ============================================================
(function (root) {
  "use strict";

  var M = typeof module !== "undefined" && module.exports ? require("../designkit/model.js") : root.orosDK.model;
  var TOL = 0.75;   // points: "at the edge"
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // the page and its text area along one axis
  function axis(len, m0, m1) { return { len: len, m0: m0, m1: m1, a: m0, b: Math.max(m0 + 1, len - m1) }; }
  function inBox(v, A, B) { return B.a + (v - A.a) * (B.b - B.a) / Math.max(1, A.b - A.a); }
  // where [a, b] goes on the new axis → { a, b, stretch (it spans or
  // touches an edge, so its size follows), pin ("s" | "e" | "c" | "") }
  function mapSpan(a, b, A, B) {
    var full = a <= TOL && b >= A.len - TOL, atS = a <= TOL, atE = b >= A.len - TOL;
    var mid = (a + b) / 2;
    if (full) return { a: a, b: B.len + (b - A.len), stretch: 1, pin: "" };
    if (b <= A.m0 + TOL && A.m0 > 0) {            // in the leading margin
      var f = B.m0 / A.m0;
      return { a: a * f, b: b * f, pin: "s", band: 1 };
    }
    if (a >= A.len - A.m1 - TOL && A.m1 > 0) {    // in the trailing margin
      var g = B.m1 / A.m1;
      return { a: B.len - (A.len - a) * g, b: B.len - (A.len - b) * g, pin: "e", band: 1 };
    }
    if (atS) return { a: a, b: inBox(b, A, B), stretch: 1, pin: "s" };
    if (atE) return { a: inBox(a, A, B), b: B.len + (b - A.len), stretch: 1, pin: "e" };
    var o = { a: inBox(a, A, B), b: inBox(b, A, B), pin: "" };
    if (Math.abs(mid - A.len / 2) <= Math.max(1, A.len * 0.01)) o.pin = "c";
    else if (Math.abs(a - A.a) <= TOL) o.pin = "s";               // on the text area's edge
    else if (Math.abs(b - (A.len - A.m1)) <= TOL) o.pin = "e";
    return o;
  }
  // one rectangle {x, y, w, h} from page `from` to page `to` (each
  // { w, h, mt, mb, ml, mr }); kind "fit" keeps its proportions
  function mapRect(r, from, to, kind) {
    var X = axis(from.w, from.ml, from.mr), Y = axis(from.h, from.mt, from.mb);
    var X2 = axis(to.w, to.ml, to.mr), Y2 = axis(to.h, to.mt, to.mb);
    var x0 = Math.min(r.x, r.x + r.w), x1 = Math.max(r.x, r.x + r.w), y0 = Math.min(r.y, r.y + r.h), y1 = Math.max(r.y, r.y + r.h);
    var mx = mapSpan(x0, x1, X, X2), my = mapSpan(y0, y1, Y, Y2);
    var nw = mx.b - mx.a, nh = my.b - my.a;
    var ow = Math.max(0.001, x1 - x0), oh = Math.max(0.001, y1 - y0);
    if (kind === "fit" && !(mx.stretch && my.stretch)) {
      // the factor of the axis that did not stretch (both: the smaller)
      var kx = nw / ow, ky = nh / oh, flatX = x1 - x0 < 0.001, flatY = y1 - y0 < 0.001;
      // a level or upright line: the factor of its own length
      var k = flatY ? kx : flatX ? ky : mx.stretch ? ky : my.stretch ? kx : Math.min(kx, ky);
      if (!(k > 0) || !isFinite(k)) k = 1;
      nw = flatX ? 0 : ow * k; nh = flatY ? 0 : oh * k;
      mx = place(mx, nw); my = place(my, nh);
    }
    var o = { x: mx.a, y: my.a, w: nw, h: nh };
    if (r.w < 0) { o.x = mx.a + nw; o.w = -nw; }    // a line drawn right to left
    if (r.h < 0) { o.y = my.a + nh; o.h = -nh; }
    return o;
  }
  function place(m, len) {
    if (m.stretch && m.pin !== "s" && m.pin !== "e") return { a: m.a, b: m.a + len };
    if (m.pin === "s") return { a: m.a, b: m.a + len };
    if (m.pin === "e") return { a: m.b - len, b: m.b };
    var c = (m.a + m.b) / 2;
    return { a: c - len / 2, b: c + len / 2 };
  }
  function pageOf(setup, side) {
    var d = { setup: setup }, m = M.margins(d, side || "R");
    return { w: setup.w, h: setup.h, mt: m.t, mb: m.b, ml: m.l, mr: m.r };
  }
  // text frames take the new extent; everything else keeps its
  // proportions unless it runs to the page edges (a background, a band,
  // a picture in the bleed), where it follows them
  function kindOf(it) { return it.t === "text" ? "stretch" : "fit"; }

  // the side of a page by its place (facing books: even index = right
  // when the first page is a right-hand one)
  function sides(doc) {
    var out = {};
    M.pagesInOrder(doc).forEach(function (p, i) { out[p.id] = M.sideOf(doc, i); });
    return out;
  }

  // the whole document to the new setup (w, h, margins); opts.text
  // "scale" also sizes the styles in proportion. → { items, k }
  function retrim(doc, setup, opts) {
    opts = opts || {};
    var old = JSON.parse(JSON.stringify(doc.setup)), nw = JSON.parse(JSON.stringify(setup));
    var side = sides(doc), masters = {};
    (doc.masters || []).forEach(function (m) { masters[m.id] = 1; });
    var n = 0;
    doc.items.forEach(function (it) {
      var sd = it.side || side[it.pg] || "R";
      var from = pageOf(old, sd), to = pageOf(nw, sd);
      var kind = kindOf(it);
      if (it.rot) {
        // turned: its centre moves, its size in proportion
        var c = mapRect({ x: it.x + it.w / 2, y: it.y + it.h / 2, w: 0.001, h: 0.001 }, from, to, "stretch");
        var k0 = Math.min((to.w - to.ml - to.mr) / Math.max(1, from.w - from.ml - from.mr), (to.h - to.mt - to.mb) / Math.max(1, from.h - from.mt - from.mb));
        it.w = r3(it.w * k0); it.h = r3(it.h * k0); it.x = r3(c.x - it.w / 2); it.y = r3(c.y - it.h / 2);
        n++;
        return;
      }
      var r = mapRect({ x: it.x, y: it.y, w: it.w, h: it.h }, from, to, kind);
      if (r.x !== it.x || r.y !== it.y || r.w !== it.w || r.h !== it.h) n++;
      it.x = r3(r.x); it.y = r3(r.y);
      if (it.t === "line") { it.w = r3(r.w); it.h = r3(r.h); }
      else { it.w = r3(Math.max(0.5, r.w)); it.h = r3(Math.max(0.5, r.h)); }
    });
    (doc.guides || []).forEach(function (g) {
      var from = pageOf(old, "R"), to = pageOf(nw, "R");
      if (g.o === "h") g.p = r3(mapSpan(g.p, g.p, axis(from.h, from.mt, from.mb), axis(to.h, to.mt, to.mb)).a);
      else g.p = r3(mapSpan(g.p, g.p, axis(from.w, from.ml, from.mr), axis(to.w, to.ml, to.mr)).a);
    });
    var k = Math.min((nw.w - nw.mi - nw.mo) / Math.max(1, old.w - old.mi - old.mo), (nw.h - nw.mt - nw.mb) / Math.max(1, old.h - old.mt - old.mb));
    if (opts.text === "scale" && Math.abs(k - 1) > 0.01) scaleStyles(doc, k, opts.now);
    // the size and margins into the same setup (its ext stays the same
    // object: callers may hold it)
    Object.keys(nw).forEach(function (key) { if (key !== "ext") doc.setup[key] = nw[key]; });
    return { items: n, k: r3(k) };
  }
  // the styles' sizes in proportion (only what a style sets itself)
  function scaleStyles(doc, k, now) {
    var keys = ["size", "lead", "sb", "sa", "fi", "li", "ri"];
    (doc.pstyles || []).concat(doc.cstyles || []).forEach(function (s) {
      var ch = false;
      keys.forEach(function (key) {
        if (typeof s[key] === "number" && s[key] > 0) { s[key] = Math.round(s[key] * k * 10) / 10; ch = true; }
      });
      if (ch && now) s.m = now;
    });
  }
  // margins in proportion to the new size (when only the size is given)
  function marginsFor(old, w, h) {
    var sx = w / old.w, sy = h / old.h, rd = function (v) { return Math.round(v * 10) / 10; };
    return { mt: rd(old.mt * sy), mb: rd(old.mb * sy), mi: rd(old.mi * sx), mo: rd(old.mo * sx) };
  }

  var api = { retrim: retrim, mapRect: mapRect, pageOf: pageOf, marginsFor: marginsFor, kindOf: kindOf, scaleStyles: scaleStyles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_RETRIM = api;
})(typeof window !== "undefined" ? window : this);
