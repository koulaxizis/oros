// ============================================================
// orOS Photo Lab — worker (v1.0.0)
// Runs the heavy pure engine functions off the main thread, so the
// editor never freezes on a big picture. Messages:
//   in:  { id, op, a }     out: { id, ok, r } | { id, ok: false }
// Images travel as { w, h, data } with their buffers transferred.
// ============================================================
/* global importScripts, self */
importScripts("select.js", "resample.js", "adjust.js", "../designkit/fx.js");

var PLW = self.PhotoLab;

function run(op, a) {
  var S = PLW.select, R = PLW.resample, A = PLW.adjust;
  switch (op) {
    case "wand": return S.wand(a.img, a.x, a.y, a.tol, a.contiguous);
    case "feather": return S.feather(a.mask, a.r);
    case "grow": return S.grow(a.mask, a.px);
    case "transform": return R.transform(a.img, a.m, a.w, a.h);
    case "resize": return R.resize(a.img, a.w, a.h);
    case "rotate": return R.rotate(a.img, a.deg);
    case "adjust":
      A.run(a.img, a.id, a.p, self.orosDK && self.orosDK.fx);
      if (a.before) A.masked(a.before, a.img, a.mask, a.ox, a.oy);
      return a.img;
  }
  throw new Error("op");
}

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var r = run(m.op, m.a || {});
    var tr = r && r.data && r.data.buffer ? [r.data.buffer] : [];
    self.postMessage({ id: m.id, ok: true, r: r }, tr);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false });
  }
};
