// ============================================================
// orOS Atelier — anim.js: animation timing (v2.0.0, wave CV-A)
// Animations of elements, how long a page shows (ax.dur on the page
// background) and the move to the next page (ax.ptr on the page
// background, or a morph: ext.mph, morph.js, which runs over its first
// MORPH seconds; the page's entrances start after it). Used by the
// editor preview, the presentation and the video / GIF export and
// nowhere else: a still export, a thumbnail and the editor draw the
// END state, so nothing is ever half-shown by accident.
//
// Wave CV-A brings Canva's animation set. An element's animation is
// ext.anim (no new record fields, R39):
//   { in:  { e, d?, sp?, by? }   entrance: effect id (EFFECTS), from
//                                direction d "l" | "r" | "u" | "d",
//                                speed sp 0.25..4 (1 = normal), by
//                                "el" | "line" | "word" | "char" (text)
//     out: { e, d?, sp?, by? }   exit at the end of its time (or page)
//     em:  { e, sp? }            emphasis while it shows (EMPHASIS)
//     t0?: s, t1?: s }           its own start and end on the page
// An older entrance ax.an (fade, rise, pop, wipe, type) still plays;
// an element with ext.anim keeps the nearest ax.an (LEGACY) so older
// orOS copies show an entrance too. A page animation (Canva's "page
// animations") is ext.pan { e, sp? } on the page background: every
// element without its own entrance comes in with it, one after the
// other, the background stays.
// Pure: no DOM. Exposes window.AtelierAnim (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var ANIMS = ["fade", "rise", "pop", "wipe", "type"];
  var TRANSITIONS = ["none", "fade", "slide", "push", "zoom"];
  var DUR_DEF = 5, DUR_MIN = 1, DUR_MAX = 60;
  var PTR_DEF = "fade";
  var LEN = 0.7, STAGGER = 0.15, TRANS = 0.5, MORPH = 1;

  // Canva's effects: id → [seconds at speed 1, default direction,
  // nearest older entrance, text only]. The same effect plays as an
  // exit, backwards.
  var EFFECTS = {
    rise: [0.7, "d", "rise"], pan: [0.8, "l", "fade"], fade: [0.7, "", "fade"], pop: [0.6, "", "pop"],
    wipe: [0.7, "l", "wipe"], blur: [0.8, "", "fade"], succession: [0.6, "l", "rise"], breathe: [1.4, "", "pop"],
    baseline: [0.7, "d", "rise"], drift: [1.4, "l", "fade"], tectonic: [0.9, "d", "rise"], tumble: [0.8, "", "pop"],
    neon: [1.0, "", "fade"], scrapbook: [0.6, "", "pop"], stomp: [0.5, "", "pop"], block: [0.7, "l", "wipe"],
    zoom: [0.9, "", "fade"], flow: [1.2, "r", "fade"],
    typewriter: [0, "", "type", 1], ascend: [0.8, "d", "rise", 1], shift: [0.7, "l", "fade", 1], merge: [0.8, "", "fade", 1],
    burst: [0.6, "", "pop", 1], bounce: [0.9, "d", "rise", 1], roll: [0.8, "l", "fade", 1], skate: [0.8, "l", "fade", 1],
    spread: [0.8, "", "fade", 1], clarify: [0.9, "", "fade", 1]
  };
  var EFFECT_IDS = Object.keys(EFFECTS);
  var EMPHASIS = { pulse: 1.4, wiggle: 0.8, flicker: 1.2, rotate: 4 };
  var EMPHASIS_IDS = Object.keys(EMPHASIS);
  var DIRS = ["l", "r", "u", "d"], BYS = ["el", "line", "word", "char"];
  var OLD = { fade: "fade", rise: "rise", pop: "pop", wipe: "wipe", type: "typewriter" };

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function back(p) { var c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  function bounceOut(p) {
    var n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) { p -= 1.5 / d; return n * p * p + 0.75; }
    if (p < 2.5 / d) { p -= 2.25 / d; return n * p * p + 0.9375; }
    p -= 2.625 / d; return n * p * p + 0.984375;
  }
  function num(v, lo, hi, def) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }

  // ---------- The animation of an element ----------
  function normPart(p, ids) {
    if (!p || typeof p !== "object" || ids.indexOf(p.e) < 0) return null;
    var o = { e: p.e };
    if (DIRS.indexOf(p.d) >= 0) o.d = p.d;
    if (p.sp !== undefined && Number(p.sp) !== 1) o.sp = Math.round(num(p.sp, 0.25, 4, 1) * 100) / 100;
    if (BYS.indexOf(p.by) >= 0 && p.by !== "el") o.by = p.by;
    return o;
  }
  // ext.anim as stored (or null): only known effects, numbers in range
  function norm(a) {
    if (!a || typeof a !== "object") return null;
    var o = {}, i = normPart(a.in, EFFECT_IDS), x = normPart(a.out, EFFECT_IDS), m = normPart(a.em, EMPHASIS_IDS);
    if (i) o["in"] = i;
    if (x) o.out = x;
    if (m) { delete m.d; delete m.by; o.em = m; }
    if (a.t0 !== undefined && Number(a.t0) > 0) o.t0 = Math.round(num(a.t0, 0, DUR_MAX, 0) * 10) / 10;
    if (a.t1 !== undefined && Number(a.t1) > 0) o.t1 = Math.round(num(a.t1, 0.1, DUR_MAX, DUR_MAX) * 10) / 10;
    if (o.t0 !== undefined && o.t1 !== undefined && o.t1 <= o.t0) delete o.t1;
    return Object.keys(o).length ? o : null;
  }
  // the nearest older entrance (ax.an) for an animation, or ""
  function legacy(a) { return a && a["in"] ? EFFECTS[a["in"].e][2] : ""; }

  function bgOf(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      if (it.pg === pg && it.ax && it.ax.bg && it.ax.k === "shape") return it;
    }
    return null;
  }
  function pageAnim(doc, pg) {
    var b = bgOf(doc, pg), p = b && b.ext && b.ext.pan;
    return normPart(p, EFFECT_IDS);
  }
  // What an element plays: { in, out, em, t0, t1 } or null. pan: the
  // page animation (or null) for elements without their own entrance.
  function specOf(it, pan) {
    if (!it || !it.ax || it.ax.bg) return null;
    var a = norm(it.ext && it.ext.anim);
    if (a) {
      if (!a["in"] && pan && !it.ax.an) a["in"] = pan;
      return a;
    }
    if (it.ax.an && OLD[it.ax.an]) return { "in": { e: OLD[it.ax.an] } };
    if (pan) return { "in": pan };
    return null;
  }

  function pageDur(doc, pg) { var b = bgOf(doc, pg); return b && b.ax.dur ? b.ax.dur : DUR_DEF; }
  function pageTransition(doc, pg) {
    var b = bgOf(doc, pg);
    if (b && b.ext && b.ext.mph === 1) return "morph";
    return b && b.ax.ptr ? b.ax.ptr : PTR_DEF;
  }
  // seconds before a page's own entrances start (its morph)
  function lead(tr) { return tr === "morph" ? MORPH : 0; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function textLen(it) { return Array.from((it.ax && it.ax.tx) || "").length; }
  // seconds one part takes (a typewriter, or a text by word / letter,
  // follows the length of the text)
  function partLen(it, p) {
    if (!p) return 0;
    var base = EFFECTS[p.e][0], sp = p.sp || 1;
    if (p.e === "typewriter") base = Math.min(4, Math.max(LEN, textLen(it) * 0.05));
    else if (it.ax && it.ax.k === "text" && (p.by === "word" || p.by === "char" || p.by === "line")) {
      var n = units(it, p.by).length;
      base = Math.min(4, base + Math.max(0, n - 1) * (p.by === "char" ? 0.03 : p.by === "word" ? 0.12 : 0.25));
    }
    return base / sp;
  }
  // seconds an entrance takes (kept for older callers)
  function lenOf(it, pan) {
    var s = specOf(it, pan || null);
    return s && s["in"] ? partLen(it, s["in"]) : LEN;
  }

  // Start time of every animated element on a page: its own t0, else
  // in layer order (bottom first), one after the other with a small
  // overlap. Elements with only an exit or an emphasis get one too.
  function schedule(items, pan) {
    var out = {}, t = 0.2;
    items.forEach(function (it) {
      var s = specOf(it, pan || null);
      if (!s) return;
      if (s.t0 !== undefined) { out[it.id] = s.t0; return; }
      out[it.id] = s["in"] ? t : 0;
      if (s["in"]) t += STAGGER;
    });
    return out;
  }

  // Text units for a reveal by line / word / letter: the end offsets
  // (in characters) of each unit.
  function units(it, by) {
    var tx = Array.from((it.ax && it.ax.tx) || ""), ends = [], i;
    if (by === "char") { for (i = 0; i < tx.length; i++) if (tx[i] !== " " && tx[i] !== "\n") ends.push(i + 1); return ends; }
    var sep = by === "line" ? /\n/ : /[\s]/;
    for (i = 0; i < tx.length; i++) if (!sep.test(tx[i]) && (i + 1 === tx.length || sep.test(tx[i + 1]))) ends.push(i + 1);
    return ends;
  }

  // dir → unit vector the element comes FROM
  function vec(d) { return d === "l" ? [-1, 0] : d === "r" ? [1, 0] : d === "u" ? [0, -1] : [0, 1]; }
  // Look of an effect at progress e (0 hidden .. 1 in place, eased)
  // and raw progress p. g: { W, H (page), w, h (element) }.
  function look(id, d, p, g) {
    var e = easeOut(p), v = vec(d || EFFECTS[id][1] || "d"), D = Math.max(12, Math.min(g.W, g.H) * 0.08);
    switch (id) {
      case "fade": return { a: e };
      case "rise": return { a: e, dx: -v[0] * 0 + v[0] * (1 - e) * D, dy: v[1] * (1 - e) * D };
      case "pan": return { a: e, dx: v[0] * (1 - e) * g.W * 0.25, dy: v[1] * (1 - e) * g.H * 0.25 };
      case "pop": return { a: clamp(p * 2), s: 0.5 + 0.5 * back(p) };
      case "wipe": case "block": return { clip: e, cd: d || "l" };
      case "blur": return { a: e, blur: (1 - e) * 24 };
      case "succession": return { a: e, dx: v[0] * (1 - e) * D * 1.5, dy: v[1] * (1 - e) * D * 1.5 };
      case "breathe": return { a: e, s: 0.85 + 0.15 * easeInOut(p) };
      case "baseline": return { clip: e, cd: d === "u" ? "d" : "u", dy: (1 - e) * g.h * 0.6 * (d === "u" ? -1 : 1) };
      case "drift": return { a: e, dx: v[0] * (1 - e) * D * 0.8, dy: v[1] * (1 - e) * D * 0.4 + (1 - e) * D * 0.3 };
      case "tectonic": { var b = back(p); return { a: clamp(p * 3), dx: v[0] * (1 - b) * g.W * 0.5, dy: v[1] * (1 - b) * g.H * 0.5 }; }
      case "tumble": return { a: e, rot: (1 - e) * -90, s: 0.6 + 0.4 * e };
      case "neon": { var f = p < 0.25 ? (p > 0.1 && p < 0.16 ? 0 : 1) : p < 0.5 ? (p > 0.35 && p < 0.4 ? 0.2 : 1) : 1; return { a: clamp(p * 4) * f }; }
      case "scrapbook": return { a: p > 0 ? 1 : 0, rot: (1 - e) * 14, s: 1.25 - 0.25 * back(p) };
      case "stomp": return { a: clamp(p * 4), s: 1.7 - 0.7 * back(p) };
      case "zoom": return { a: clamp(p * 2), s: 1.25 - 0.25 * e, box: 1 };
      case "flow": return { a: clamp(p * 2), dx: v[0] * (1 - e) * g.w * 0.15, dy: v[1] * (1 - e) * g.h * 0.15, s: 1.1 - 0.1 * e, box: 1 };
      case "typewriter": return {};
      case "ascend": return { a: e, dy: v[1] * (1 - e) * D * 0.6, dx: v[0] * (1 - e) * D * 0.6 };
      case "shift": return { a: e, dx: v[0] * (1 - e) * D * 0.5, dy: v[1] * (1 - e) * D * 0.5 };
      case "merge": return { a: e, s: 1.3 - 0.3 * e, blur: (1 - e) * 8 };
      case "burst": return { a: clamp(p * 3), s: 0.3 + 0.7 * back(p), rot: (1 - e) * 10 };
      case "bounce": { var u = bounceOut(p); return { a: clamp(p * 4), dx: v[0] * (1 - u) * D * 2, dy: v[1] * (1 - u) * D * 2 }; }
      case "roll": return { a: e, rot: (1 - e) * (v[0] > 0 ? 180 : -180), dx: v[0] * (1 - e) * D * 2, dy: v[1] * (1 - e) * D * 2 };
      case "skate": return { a: e, dx: v[0] * (1 - e) * D * 2.5, dy: v[1] * (1 - e) * D * 2.5, rot: v[0] * (1 - e) * 6 };
      case "spread": return { a: e, sx: 0.6 + 0.4 * e };
      case "clarify": return { a: e, blur: (1 - e) * 16, s: 1.08 - 0.08 * e };
    }
    return {};
  }
  // an emphasis at time u (seconds into it)
  function emph(id, sp, u) {
    var P = EMPHASIS[id] / (sp || 1), w = 2 * Math.PI * u / P;
    if (id === "pulse") return { s: 1 + 0.05 * Math.sin(w) };
    if (id === "wiggle") return { rot: 4 * Math.sin(w) };
    if (id === "flicker") return { a: 0.65 + 0.35 * Math.abs(Math.cos(w)) };
    if (id === "rotate") return { rot: 360 * u / P };
    return {};
  }
  function mergeLook(o, x) {
    if (!x) return o;
    if (x.a !== undefined) o.a = (o.a === undefined ? 1 : o.a) * x.a;
    ["dx", "dy", "rot", "blur"].forEach(function (k) { if (x[k]) o[k] = (o[k] || 0) + x[k]; });
    ["s", "sx"].forEach(function (k) { if (x[k] !== undefined) o[k] = (o[k] === undefined ? 1 : o[k]) * x[k]; });
    if (x.clip !== undefined) { o.clip = Math.min(o.clip === undefined ? 1 : o.clip, x.clip); o.cd = x.cd; }
    if (x.chars !== undefined) o.chars = o.chars === undefined ? x.chars : Math.min(o.chars, x.chars);
    if (x.box) o.box = 1;
    return o;
  }
  // a part (entrance or exit) at progress p → look, with the text's
  // reveal by unit
  function partLook(it, part, p, g) {
    var o = {};
    if (part.e === "typewriter") return { chars: Math.floor(textLen(it) * p) };
    if (it.ax.k === "text" && part.by && part.by !== "el") {
      var U = units(it, part.by), n = U.length;
      if (n > 1) {
        // units come in one after the other; the element moves with the last
        var k = Math.min(n, Math.floor(p * n) + 1);
        o.chars = p >= 1 ? textLen(it) : U[k - 1];
        var q = clamp(p * n - (k - 1));
        return mergeLook(o, look(part.e, part.d, q, g));
      }
    }
    return look(part.e, part.d, p, g);
  }

  // Look of one element at time t (seconds since the page appeared).
  // → null (as is) or { a: alpha 0..1, dx, dy (pt), s, sx: scale,
  //   rot: degrees, blur: pt, clip: 0..1 with cd (from "l" | "r" | "u"
  //   | "d"), box: 1 (inside its own box), chars: n (text shown) }.
  // pg (optional): { dur: the page's seconds, pan: page animation,
  // W: page width }; without it the page lasts DUR_DEF.
  function stateAt(it, start, t, pageH, pg) {
    pg = pg || {};
    var s = specOf(it, pg.pan || null);
    if (!s || start === undefined) return null;
    var g = { W: pg.W || pageH, H: pageH, w: it.w || 1, h: it.h || 1 };
    var o = {}, any = false;
    var end = s.t1 !== undefined ? s.t1 : (pg.dur || DUR_DEF);
    if (t < start && (s["in"] || s.t0 !== undefined)) return { a: 0 };
    if (s.t1 !== undefined && t >= end) return { a: 0 };
    if (s["in"]) {
      var L = partLen(it, s["in"]), p = L > 0 ? clamp((t - start) / L) : 1;
      if (p < 1) { mergeLook(o, partLook(it, s["in"], p, g)); any = true; }
    }
    if (s.out) {
      var Lo = partLen(it, s.out), q = Lo > 0 ? clamp((end - t) / Lo) : 1;
      if (q < 1) { mergeLook(o, partLook(it, s.out, q, g)); any = true; }
    }
    if (s.em) {
      var e0 = start + (s["in"] ? partLen(it, s["in"]) : 0);
      if (t >= e0) { mergeLook(o, emph(s.em.e, s.em.sp, t - e0)); any = true; }
    }
    return any ? o : null;
  }

  // The animated part of a page lasts until its last entrance ends (or
  // the last own end time, or an emphasis: one round of it).
  function introLen(items, pan) {
    var sc = schedule(items, pan), end = 0;
    items.forEach(function (it) {
      if (sc[it.id] === undefined) return;
      var s = specOf(it, pan || null);
      var e = sc[it.id] + (s["in"] ? partLen(it, s["in"]) : 0);
      if (s.em) e += EMPHASIS[s.em.e] / (s.em.sp || 1);
      if (s.t1 !== undefined) e = Math.max(e, s.t1);
      if (s.out && s.t1 === undefined) e += partLen(it, s.out);
      end = Math.max(end, e);
    });
    return end;
  }
  // the page's look for stateAt: { dur, pan, W }
  function pageCtx(doc, pg) { return { dur: pageDur(doc, pg), pan: pageAnim(doc, pg), W: doc.setup.w }; }

  // The whole design as a film: [{ pg, t0, dur, tr }] + total seconds.
  // A page lasts its duration (at least its intro); the transition
  // to it runs over its first TRANS seconds (a morph MORPH; none on
  // the first page).
  function timeline(doc, pages) {
    var t = 0, list = [];
    pages.forEach(function (p, i) {
      var items = doc.items.filter(function (it) { return it.pg === p.id; }).sort(function (a, b) { return a.z - b.z; });
      var tr = i ? pageTransition(doc, p.id) : "none";
      var dur = Math.max(pageDur(doc, p.id), Math.ceil((introLen(items, pageAnim(doc, p.id)) + lead(tr)) * 10) / 10);
      list.push({ pg: p.id, t0: t, dur: dur, tr: tr });
      t += dur;
    });
    return { pages: list, total: t };
  }
  // where the film is at time t: { i, local, prev (index or -1),
  // mix 0..1, tr, pt (the page's time for its entrances) }
  function at(tl, t) {
    var L = tl.pages;
    for (var i = 0; i < L.length; i++) {
      if (t < L[i].t0 + L[i].dur || i === L.length - 1) {
        var local = Math.max(0, t - L[i].t0), tr = i ? L[i].tr : "none";
        var mix = tr === "none" ? 1 : clamp(local / (tr === "morph" ? MORPH : TRANS));
        return { i: i, local: local, prev: mix < 1 ? i - 1 : -1, mix: tr === "morph" ? easeInOut(mix) : easeOut(mix),
          tr: tr, pt: local - lead(tr) };
      }
    }
    return { i: 0, local: 0, prev: -1, mix: 1, tr: "none", pt: 0 };
  }

  var api = {
    ANIMS: ANIMS, TRANSITIONS: TRANSITIONS, DUR_DEF: DUR_DEF, DUR_MIN: DUR_MIN, DUR_MAX: DUR_MAX, PTR_DEF: PTR_DEF, TRANS: TRANS, MORPH: MORPH,
    EFFECTS: EFFECTS, EFFECT_IDS: EFFECT_IDS, EMPHASIS_IDS: EMPHASIS_IDS, DIRS: DIRS, BYS: BYS,
    norm: norm, legacy: legacy, specOf: specOf, pageAnim: pageAnim, pageCtx: pageCtx, units: units, partLen: partLen,
    lead: lead, easeInOut: easeInOut, pageDur: pageDur, pageTransition: pageTransition, schedule: schedule, stateAt: stateAt, introLen: introLen,
    timeline: timeline, at: at, lenOf: lenOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierAnim = api;
})(typeof window !== "undefined" ? window : this);
