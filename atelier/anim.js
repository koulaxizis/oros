// ============================================================
// orOS Atelier — anim.js: animation timing (v1.0.0)
// Entrance animations of elements (ax.an), how long a page shows
// (ax.dur on the page background) and the move to the next page
// (ax.ptr on the page background). Used by the editor preview, the
// video / GIF export and nowhere else: a still export, a thumbnail
// and the editor draw the END state, so nothing is ever half-shown
// by accident.
// Pure: no DOM. Exposes window.AtelierAnim (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var ANIMS = ["fade", "rise", "pop", "wipe", "type"];
  var TRANSITIONS = ["none", "fade", "slide", "push", "zoom"];
  var DUR_DEF = 5, DUR_MIN = 1, DUR_MAX = 60;
  var PTR_DEF = "fade";
  var LEN = 0.7, STAGGER = 0.15, TRANS = 0.5;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function back(p) { var c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }

  function bgOf(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      if (it.pg === pg && it.ax && it.ax.bg && it.ax.k === "shape") return it;
    }
    return null;
  }
  function pageDur(doc, pg) { var b = bgOf(doc, pg); return b && b.ax.dur ? b.ax.dur : DUR_DEF; }
  function pageTransition(doc, pg) { var b = bgOf(doc, pg); return b && b.ax.ptr ? b.ax.ptr : PTR_DEF; }

  // seconds an entrance takes (the typewriter follows the text length)
  function lenOf(it) {
    if (it.ax.an === "type") return Math.min(4, Math.max(LEN, Array.from(it.ax.tx || "").length * 0.05));
    return LEN;
  }

  // Start time of every animated item on a page: in layer order
  // (bottom first), one after the other with a small overlap.
  function schedule(items) {
    var out = {}, t = 0.2;
    items.forEach(function (it) {
      if (!it.ax || !it.ax.an) return;
      out[it.id] = t;
      t += STAGGER;
    });
    return out;
  }

  // Look of one item at time t (seconds since the page appeared).
  // → null (as is) or { a: alpha 0..1, dx, dy (pt), s: scale,
  //   clip: 0..1 (wipe, from the left), chars: n (typewriter) }
  function stateAt(it, start, t, pageH) {
    var an = it.ax && it.ax.an;
    if (!an || start === undefined) return null;
    var p = clamp((t - start) / lenOf(it));
    if (p >= 1) return null;
    var e = easeOut(p);
    if (an === "fade") return { a: e };
    if (an === "rise") return { a: e, dy: (1 - e) * Math.max(12, pageH * 0.06) };
    if (an === "pop") return { a: clamp(p * 2), s: 0.5 + 0.5 * back(p) };
    if (an === "wipe") return { clip: e };
    if (an === "type") return { chars: Math.floor(Array.from(it.ax.tx || "").length * p) };
    return null;
  }

  // The animated part of a page lasts until its last entrance ends.
  function introLen(items) {
    var sc = schedule(items), end = 0;
    items.forEach(function (it) { if (sc[it.id] !== undefined) end = Math.max(end, sc[it.id] + lenOf(it)); });
    return end;
  }

  // The whole design as a film: [{ pg, t0, dur, tr }] + total seconds.
  // A page lasts its duration (at least its intro); the transition
  // to it runs over its first TRANS seconds (none on the first page).
  function timeline(doc, pages) {
    var t = 0, list = [];
    pages.forEach(function (p, i) {
      var items = doc.items.filter(function (it) { return it.pg === p.id; }).sort(function (a, b) { return a.z - b.z; });
      var dur = Math.max(pageDur(doc, p.id), Math.ceil(introLen(items) * 10) / 10);
      list.push({ pg: p.id, t0: t, dur: dur, tr: i ? pageTransition(doc, p.id) : "none" });
      t += dur;
    });
    return { pages: list, total: t };
  }
  // where the film is at time t: { i, local, prev (index or -1), mix 0..1 }
  function at(tl, t) {
    var L = tl.pages;
    for (var i = 0; i < L.length; i++) {
      if (t < L[i].t0 + L[i].dur || i === L.length - 1) {
        var local = Math.max(0, t - L[i].t0);
        var mix = L[i].tr === "none" || i === 0 ? 1 : clamp(local / TRANS);
        return { i: i, local: local, prev: mix < 1 ? i - 1 : -1, mix: easeOut(mix), tr: L[i].tr };
      }
    }
    return { i: 0, local: 0, prev: -1, mix: 1, tr: "none" };
  }

  var api = {
    ANIMS: ANIMS, TRANSITIONS: TRANSITIONS, DUR_DEF: DUR_DEF, DUR_MIN: DUR_MIN, DUR_MAX: DUR_MAX, PTR_DEF: PTR_DEF, TRANS: TRANS,
    pageDur: pageDur, pageTransition: pageTransition, schedule: schedule, stateAt: stateAt, introLen: introLen,
    timeline: timeline, at: at, lenOf: lenOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierAnim = api;
})(typeof window !== "undefined" ? window : this);
