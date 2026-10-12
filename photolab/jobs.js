// ============================================================
// orOS Photo Lab — jobs (v1.0.0)
// PL.job(op, args) → Promise of the result, run in photolab/
// worker.js when the browser allows a worker, else on the main
// thread with the same engine functions (same result either way).
// Inputs are copied to the worker (never transferred), so a worker
// that fails to start can always fall back to the main thread.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL;
  var worker = null, broken = false, seq = 0, waiting = {};

  function getWorker() {
    if (worker || broken) return worker;
    try {
      worker = new Worker("worker.js");
      worker.onmessage = function (e) {
        var m = e.data || {}, w = waiting[m.id];
        if (!w) return;
        delete waiting[m.id];
        if (m.ok) w.ok(m.r); else w.fail(new Error(m.e || "job"));
      };
      worker.onerror = function () {
        broken = true; worker = null;
        Object.keys(waiting).forEach(function (id) { var w = waiting[id]; delete waiting[id]; w.retry(); });
      };
    } catch (e) { broken = true; worker = null; }
    return worker;
  }

  function local(op, a) {
    var S = PL.S, R = PL.R, A = PL.A;
    switch (op) {
      case "wand": return S.wand(a.img, a.x, a.y, a.tol, a.contiguous);
      case "feather": return S.feather(a.mask, a.r);
      case "grow": return S.grow(a.mask, a.px);
      case "transform": return R.transform(a.img, a.m, a.w, a.h);
      case "resize": return R.resize(a.img, a.w, a.h);
      case "rotate": return R.rotate(a.img, a.deg);
      case "adjust":
        A.run(a.img, a.id, a.p, PL.FX);
        if (a.before) A.masked(a.before, a.img, a.mask, a.ox, a.oy);
        return a.img;
      case "filter":
        var e = a.pad || 0, out = PL.F.crop(PL.F.run(a.img, a.id, a.p, a.at), e, e, a.img.w - 2 * e, a.img.h - 2 * e);
        if (a.before) A.masked(a.before, out, a.mask, a.ox, a.oy);
        return out;
      case "psd": return PL.PSD.read(a.bytes, a.o);
      case "psdWrite": return PL.PSD.write(a.doc);
    }
    throw new Error("op");
  }
  function runLocal(op, a) {
    return new Promise(function (ok, fail) {
      setTimeout(function () { try { ok(local(op, a)); } catch (e) { fail(e); } }, 16);
    });
  }
  PL.job = function (op, a) {
    var w = getWorker();
    if (!w) return runLocal(op, a);
    return new Promise(function (ok, fail) {
      var id = ++seq;
      waiting[id] = { ok: ok, fail: fail, retry: function () { runLocal(op, a).then(ok, fail); } };
      try { w.postMessage({ id: id, op: op, a: a }); }
      catch (e) { delete waiting[id]; broken = true; worker = null; runLocal(op, a).then(ok, fail); }
    });
  };
})();
