// ============================================================
// orOS Photo Lab — worker (v1.0.0)
// Runs the heavy pure engine functions off the main thread, so the
// editor never freezes on a big picture. Messages:
//   in:  { id, op, a }     out: { id, ok, r } | { id, ok: false, e }
//   (r may come from a promise: the PSD reader is asynchronous)
// Images travel as { w, h, data } with their buffers transferred.
// ============================================================
/* global importScripts, self */
importScripts("select.js", "resample.js", "adjust.js", "filters.js", "psd.js", "../designkit/fx.js");

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
    case "filter": return filtered(PLW.filters, A, a);
    case "psd": return PLW.psd.read(a.bytes, a.o);
    case "psdWrite": return PLW.psd.write(a.doc);
  }
  throw new Error("op");
}

// A filter on the padded area, cropped back, the selection mixed in.
function filtered(F, A, a) {
  var out = F.run(a.img, a.id, a.p, a.at), e = a.pad || 0;
  out = F.crop(out, e, e, a.img.w - 2 * e, a.img.h - 2 * e);
  if (a.before) A.masked(a.before, out, a.mask, a.ox, a.oy);
  return out;
}

// Buffers of the result go back transferred (a PSD's layers too).
function buffers(r) {
  var out = [];
  if (r instanceof Uint8Array) out.push(r.buffer);
  if (r && r.data && r.data.buffer) out.push(r.data.buffer);
  if (r && r.layers) r.layers.forEach(function (L) { out.push(L.img.data.buffer); });
  if (r && r.merged) out.push(r.merged.data.buffer);
  return out;
}

self.onmessage = function (e) {
  var m = e.data || {};
  new Promise(function (ok) { ok(run(m.op, m.a || {})); }).then(function (r) {
    self.postMessage({ id: m.id, ok: true, r: r }, buffers(r));
  }, function (err) {
    self.postMessage({ id: m.id, ok: false, e: String(err && err.message || "job") });
  });
};
