// ============================================================
// orOS Photo Lab — enlarge.js: Image › Enlarge with AI (2× / 4×)
// (PL-UP, v1.0.0)
// Chris 2026-11-27 (model ideas, item 1): Real-ESRGAN general x4v3
// (BSD-3-Clause, about 5 MB) on this device, downloaded only when the
// person asks, checked by SHA-256 before it is kept, in the ONNX
// Runtime Web Photo Lab and Atelier already share (atelier/cutout.js
// loads and keeps the files in the IndexedDB "oros-atelier-ai", so the
// runtime is downloaded once for all picture tools).
//   - the model runs in upscale-worker.js (the page stays usable; Cancel
//     stops the worker); where a worker cannot run it, on the page
//   - every photo layer goes through the model, tile by tile (steps in
//     upscale.js); masks and selections are resampled, text and shapes
//     grow as they are (ops.js resizeImage): one undo step
//   - the device's size limits (8192 px, phones 4096 px) still apply:
//     a picture too big for the factor is enlarged as far as they allow
// Loaded with upscale.js on first use (panels.js PL.enlargeTool).
// PL.enlarge = { open(), run(k) → Promise<{ w, h }> } (run: aiedit.js,
// the Assistant's and Claude's upscale with prov "device").
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, st = PL.st, el = PL.el, U = window.PhotoLab.upscale;
  var RUNTIME_MB = 11, MODEL_MB = 5;
  function t(k, p) { return PL.t(k, p); }
  function ver() {
    var m = ((document.querySelector('script[src*="app.js?v="]') || {}).src || "").match(/[?&]v=([^&#]+)/);
    return m ? "?v=" + m[1] : "";
  }

  // ---------- Files ----------
  function specOf(CUT) {
    var s = CUT.list(CUT.FILES, CUT.FILES_VER);
    delete s.model;                               // the background model is not needed
    s.esrgan = { url: U.MODEL.url, v: U.MODEL.v, sha: U.MODEL.sha };
    return s;
  }
  // { have: everything is on the device, mb: a first download's size }
  function state() {
    return PL.subject.cutout().then(function (CUT) {
      var s = specOf(CUT), rt = CUT.list(CUT.FILES, CUT.FILES_VER);
      delete rt.model;
      return Promise.all([CUT.readyOf(s), CUT.readyOf(rt)]).then(function (r) {
        return { have: r[0], mb: r[1] ? MODEL_MB : RUNTIME_MB + MODEL_MB };
      });
    });
  }

  // ---------- Engine ----------
  // A runner: { run(img, k, onTile) → Promise<img>, stop() }.
  var engineP = null;
  function engine(onProgress, signal) {
    if (engineP) return engineP;
    var p = engineP = PL.subject.cutout().then(function (CUT) {
      var spec = specOf(CUT);
      return state().then(function (s) {
        return CUT.filesOf(spec, s.mb, onProgress, signal);
      }).then(function (f) {
        if (signal && signal.aborted) throw quiet();
        return inWorker(f).catch(function (e) {
          if (e && e.quiet) throw e;
          return onPage(CUT, spec);
        });
      });
    });
    p.catch(function () { if (engineP === p) engineP = null; });
    return p;
  }
  function quiet() { var e = new Error("cancel"); e.quiet = true; return e; }
  var urls = null;
  function inWorker(f) {
    return f.esrgan.arrayBuffer().then(function (buf) {
      return new Promise(function (ok, fail) {
        var w;
        try { w = new Worker("upscale-worker.js" + ver()); } catch (e) { fail(e); return; }
        if (!urls) urls = {
          js: URL.createObjectURL(new Blob([f.js], { type: "text/javascript" })),
          mjs: URL.createObjectURL(new Blob([f.mjs], { type: "text/javascript" })),
          wasm: URL.createObjectURL(new Blob([f.wasm], { type: "application/wasm" }))
        };
        var job = null;
        w.onerror = function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          var j = job; job = null;
          if (j) j.fail(new Error("worker")); else fail(new Error("worker"));
        };
        w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.op === "ready") { ok(runner); return; }
          if (m.op === "error") { var j = job; job = null; if (j) j.fail(new Error(m.e)); else fail(new Error(m.e)); return; }
          if (m.op === "tile") { if (job && job.onTile) job.onTile(m.done, m.total); return; }
          if (m.op === "done") { var d = job; job = null; if (d) d.ok(m.img); }
        };
        var runner = {
          run: function (img, k, onTile) {
            return new Promise(function (ok2, fail2) {
              job = { ok: ok2, fail: fail2, onTile: onTile };
              w.postMessage({ op: "run", img: img, k: k }, [img.data.buffer]);
            });
          },
          stop: function () {
            try { w.terminate(); } catch (e) {}
            var j = job; job = null;
            if (j) j.fail(quiet());
          }
        };
        w.postMessage({ op: "init", js: urls.js, mjs: urls.mjs, wasm: urls.wasm, model: buf }, [buf]);
      });
    });
  }
  // No worker: the same steps on the page, letting it paint between tiles.
  function onPage(CUT, spec) {
    return CUT.sessionOf(spec, "esrgan", MODEL_MB, null, null).then(function (sess) {
      var stopped = false;
      return {
        run: function (img, k, onTile) {
          stopped = false;
          return U.run(img, {
            k: k, R: window.PhotoLab.resample, onTile: onTile,
            infer: function (data, w, h) {
              return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
                if (stopped) throw quiet();
                var feeds = {};
                feeds[sess.inputNames[0]] = new window.ort.Tensor("float32", data, [1, 3, h, w]);
                return sess.run(feeds);
              }).then(function (o) { return o[sess.outputNames[0]].data; });
            }
          });
        },
        stop: function () { stopped = true; }
      };
    });
  }
  // Cancel: the worker goes (a new one starts next time).
  function stop() {
    var p = engineP;
    engineP = null;
    if (p) p.then(function (r) { r.stop(); }, function () {});
  }

  // ---------- The whole picture ----------
  // The size the picture gets for factor k on this device.
  function sizeFor(k) {
    var d = st.doc;
    return C.fitSize(d.w * k, d.h * k, PL.limits);
  }
  // k (2 or 4, or 3 from a command) → Promise<{ w, h }>, one undo step.
  // o = { onProgress(0..1) (download), onTile(done, total, layer, layers),
  //       signal }
  function run(k, o) {
    o = o || {};
    var d = st.doc;
    if (!d) return Promise.reject(new Error("no picture"));
    var z = sizeFor(k);
    if (z.w <= d.w && z.h <= d.h) return Promise.resolve({ w: d.w, h: d.h, same: true });
    var kx = z.w / d.w, ky = z.h / d.h, layers = 0, n = 0, err = null, chain = Promise.resolve();
    d.layers.forEach(function (L) { if (L.k === "raster") layers++; });
    var label = t("step.enlarge");
    return engine(o.onProgress, o.signal).then(function () {
      return PL.ops.resizeImage(z.w, z.h, {
        label: label,
        job: function (c, O, tw, th) {
          var p = chain = chain.then(function () {
            if (err) throw quiet();
            n++;
            return engine().then(function (r) {
              return r.run(c.img, Math.min(kx, ky), function (done, total) {
                if (o.onTile) o.onTile(done, total, n, Math.max(n, layers));
              });
            }).then(function (img) {
              return img.w === tw && img.h === th ? img : PL.job("resize", { img: img, w: tw, h: th });
            });
          });
          p.catch(function (e) { if (!err) err = e; });
          return p.catch(function (e) { e = e || new Error("failed"); var q = new Error(e.message); q.quiet = true; q.cause = e; throw q; });
        }
      });
    }).then(function () {
      if (err) throw err;
      return { w: st.doc ? st.doc.w : z.w, h: st.doc ? st.doc.h : z.h };
    });
  }

  // A reason a person can read.
  function why(e) {
    var m = String((e && e.message) || e || "");
    if (m === "hash") return t("up.hash");
    if (/^http|fetch|network|load/i.test(m)) return t("up.net");
    return m.slice(0, 120);
  }

  // ---------- Dialog ----------
  function open() {
    if (!st.doc) return;
    PL.busy(true);
    state().then(function (s) { PL.busy(false); dialog(s); },
      function () { PL.busy(false); PL.toast(t("msg.upFail", { why: t("subject.noLoader") })); });
  }
  function dialog(s) {
    var d = st.doc, have = s.have, working = false;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var z2 = sizeFor(2), z4 = sizeFor(4);
    var opts = [["2", t("up.x", { f: 2, w: z2.w, h: z2.h })], ["4", t("up.x", { f: 4, w: z4.w, h: z4.h })]];
    var pick = PL.ui.select(opts, z4.w > z2.w ? "4" : "2");
    var about = el("p", "hint", t("up.about"));
    var need = el("p", "hint", t("up.need", { mb: s.mb })); need.hidden = have;
    var lim = el("p", "hint");
    function limits() {
      var z = pick.value === "4" ? z4 : z2;
      lim.hidden = !z.scaled;
      lim.textContent = z.scaled ? t("up.limit", { w: z.w, h: z.h }) : "";
    }
    pick.addEventListener("change", limits); limits();
    var bar = el("progress", "up-bar"); bar.max = 1; bar.value = 0; bar.hidden = true;
    var stat = el("p", "hint up-stat"); stat.setAttribute("aria-live", "polite");
    var big = z2.w <= d.w && z2.h <= d.h;
    if (big) stat.textContent = t("up.tooBig");
    var dlg = PL.dialog({
      title: t("dlg.enlarge"),
      ok: t(have ? "up.go" : "up.download"),
      body: [about, PL.ui.field(t("up.size"), pick), lim, need, bar, stat],
      onOk: function () { if (!working && !big) go(); return false; },
      onCancel: function () { if (ctl) ctl.abort(); if (working) stop(); }
    });
    if (big) dlg.ok.disabled = true;
    function go() {
      working = true; dlg.ok.disabled = true; pick.disabled = true; bar.hidden = false;
      var t0 = 0;
      stat.textContent = have ? t("up.start") : t("up.load", { p: 0 });
      run(+pick.value, {
        signal: ctl ? ctl.signal : undefined,
        onProgress: function (p) { if (!have) { bar.value = p; stat.textContent = t("up.load", { p: Math.round(p * 100) }); } },
        onTile: function (done, total, layer, layers) {
          var now = Date.now();
          if (!t0 || done === 1) t0 = now;
          var p = done / total, left = done > 1 ? (now - t0) / (done - 1) * (total - done) : 0;
          bar.value = p;
          var txt = done > 2 ? t(left < 60000 ? "up.leftS" : "up.left", { p: Math.round(p * 100), m: Math.ceil(left / 60000) })
                             : t("up.run", { p: Math.round(p * 100) });
          stat.textContent = layers > 1 ? t("up.layer", { i: layer, n: layers }) + " " + txt : txt;
        }
      }).then(function (r) {
        working = false;
        dlg.close("ok");
        PL.toast(r.same ? t("up.tooBig") : t("msg.upDone", { w: r.w, h: r.h }));
      }, function (e) {
        working = false;
        if (e && e.message === "cancel") return;
        bar.hidden = true;
        stat.textContent = t("msg.upFail", { why: why(e && e.cause || e) });
        dlg.ok.disabled = false; pick.disabled = false;
      });
    }
  }

  PL.enlarge = { open: open, run: run, why: why, sizeFor: sizeFor };
})();
