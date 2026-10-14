// ============================================================
// orOS Slides — anim.js (build animations: the timeline, v1.0.0)
// Pure: no DOM. Turns the entrance animations of a slide's objects
// (item.an, core.js normAnim) into click steps and says, for a step
// and a moment, what is hidden, what is coming in and how far.
// The show (designkit/show.js) counts the clicks; app.js draws the
// frame (SL.renderFrame) from state().
//
//   plan(data, slideId) -> { steps: [[effect]], clicks }
//     steps[0]: what starts by itself when the slide appears (effects
//     "with / after the previous" before any click); steps[k], k >= 1:
//     the k-th click. effect: { ids, pi (paragraph, -1 = whole object),
//     e, d, du, t0 (ms after its step began), end }.
//     Semantics as in PowerPoint: "with the previous" starts with the
//     group it joins, "after the previous" when that group has ended;
//     the delay counts from there. "Bullets one by one" makes every
//     non-empty paragraph its own step (the first keeps the object's
//     start).
//   state(plan, step, t, still) -> { hidden: {id: 1}, paras: {id:
//     {pi: 1}}, fx: [{ ids, pi, e, d, p (0..1, eased) }], busy }
//     step: clicks done on the slide; t: ms since that step began
//     (undefined = the step has finished). Everything of earlier
//     steps is in place, later steps are hidden. still (reduced
//     motion): every effect is in place at once, nothing moves.
//   stepEnd(plan, step) -> ms the step needs.
//   numbers(plan) -> { itemId: click number } (0: by itself), for the
//     badges in the editor.
// Needs OrosSlidesCore on the same global.
// ============================================================
(function (root) {
  "use strict";

  function C() { return root.OrosSlidesCore; }

  function ease(p) { p = p < 0 ? 0 : p > 1 ? 1 : p; return 1 - Math.pow(1 - p, 3); }

  function plan(data, slideId) {
    var Co = C(), units = Co.animUnits(data, slideId), effects = [];
    units.forEach(function (u) {
      var an = u.an, base = { e: an.e, d: an.d || "b", du: an.e === "appear" ? 0 : (an.du || 500), dl: an.dl || 0 };
      var it = u.ids.length === 1 ? data.items[u.ids[0]] : null;
      var paras = [];
      if (an.p && it && it.k === "text") it.paras.forEach(function (p, i) { if (Co.paraText(p).trim()) paras.push(i); });
      if (!paras.length) { effects.push(fx(base, u.ids, -1, an.w || "c")); return; }
      paras.forEach(function (pi, k) { effects.push(fx(base, u.ids, pi, k === 0 ? (an.w || "c") : "c")); });
    });
    function fx(b, ids, pi, w) { return { ids: ids.slice(), pi: pi, e: b.e, d: b.d, du: b.du, dl: b.dl, w: w }; }
    var steps = [[]], cur = steps[0], gStart = 0, gEnd = 0;
    effects.forEach(function (e) {
      if (e.w === "c") { cur = []; steps.push(cur); gStart = 0; gEnd = 0; }
      else if (e.w === "a") gStart = gEnd;
      e.t0 = gStart + e.dl;
      e.end = e.t0 + e.du;
      if (e.end > gEnd) gEnd = e.end;
      delete e.w; delete e.dl;
      cur.push(e);
    });
    return { steps: steps, clicks: steps.length - 1 };
  }

  function stepEnd(pl, step) {
    var s = pl && pl.steps[step], end = 0;
    (s || []).forEach(function (e) { if (e.end > end) end = e.end; });
    return end;
  }

  function state(pl, step, t, still) {
    var out = { hidden: {}, paras: {}, fx: [], busy: false };
    if (!pl) return out;
    var fin = t === undefined || t === null || !isFinite(t) || still;
    pl.steps.forEach(function (list, s) {
      list.forEach(function (e) {
        var hide = s > step, p = 1;
        if (s === step && !fin) {
          if (t < e.t0) { hide = true; out.busy = true; }
          else if (e.du && t < e.end) { p = ease((t - e.t0) / e.du); out.busy = true; }
        }
        if (hide) {
          e.ids.forEach(function (id) {
            if (e.pi < 0) out.hidden[id] = 1;
            else (out.paras[id] = out.paras[id] || {})[e.pi] = 1;
          });
        } else if (p < 1) out.fx.push({ ids: e.ids, pi: e.pi, e: e.e, d: e.d, p: p });
      });
    });
    return out;
  }

  function numbers(pl) {
    var out = {};
    if (!pl) return out;
    pl.steps.forEach(function (list, s) {
      list.forEach(function (e) { e.ids.forEach(function (id) { if (!(id in out)) out[id] = s; }); });
    });
    return out;
  }

  // Where an object (its box b, slide units) starts when it flies in
  // from side d of a slide W x H: the offset that puts it just outside.
  function flyFrom(b, d, W, H) {
    if (d === "l") return { x: -(b.x + b.w), y: 0 };
    if (d === "r") return { x: W - b.x, y: 0 };
    if (d === "t") return { x: 0, y: -(b.y + b.h) };
    return { x: 0, y: H - b.y };
  }

  root.OrosSlidesAnim = { plan: plan, state: state, stepEnd: stepEnd, numbers: numbers, ease: ease, flyFrom: flyFrom };
})(typeof window !== "undefined" ? window : this);
