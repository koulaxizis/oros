// ============================================================
// orOS Photo Lab — subject.js: Select subject, Remove background
// (v1.0.0)
// The same on-device model as Atelier's background tool: U²-Net
// "u2netp" (vendor/u2netp/) in ONNX Runtime Web (vendor/ort/), through
// Atelier's own loader atelier/cutout.js, loaded here only when asked
// for. The files are fetched once (about 16 MB) into the IndexedDB
// "oros-atelier-ai" both apps share (same origin), so a download made
// in either app serves the other; nothing is uploaded, nothing is
// duplicated, and Atelier's behaviour does not change.
//   - Select › Subject: the subject becomes the selection (soft edge)
//   - Layer › Remove background: the subject becomes the active
//     layer's mask (one undo step; a mask already there is replaced),
//     so nothing is erased and the mask can be painted further
// The model looks at the whole visible picture (all layers).
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, st = PL.st, el = PL.el;
  var SPAN = 0.76;                     // cutout.js: the soft edge's width
  function t(k, p) { return PL.t(k, p); }

  // ---------- Atelier's loader ----------
  var cutP = null;
  function cutout() {
    if (window.AtelierCutout) return Promise.resolve(window.AtelierCutout);
    if (!cutP) {
      cutP = new Promise(function (ok, fail) {
        var v = (document.querySelector('script[src*="app.js?v="]') || {}).src || "";
        var m = v.match(/[?&]v=([^&#]+)/);
        var s = document.createElement("script");
        s.src = "../atelier/cutout.js" + (m ? "?v=" + m[1] : "");
        s.onload = function () { if (window.AtelierCutout) ok(window.AtelierCutout); else fail(new Error("cutout")); };
        s.onerror = function () { fail(new Error("cutout")); };
        document.head.appendChild(s);
      });
      cutP.catch(function () { cutP = null; });
    }
    return cutP;
  }

  // alpha (doc w × h, 0-255) → a selection mask
  function selOf(alpha, w, h) {
    var m = S.make(w, h);
    m.data.set(alpha);
    return m;
  }
  // The subject as the layer's mask (white = shows), in the layer's grid.
  function maskLayer(L, alpha) {
    var d = st.doc, old = L.mk ? L.mk.id : null, id = C.newLayerId();
    // only the part with something in it (the mask's background is 0)
    var x0 = d.w, y0 = d.h, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < d.h; y++) for (x = 0; x < d.w; x++) {
      if (!alpha[y * d.w + x]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    PL.docChange(t("step.removeBg"), function () {
      var s = T.create();
      if (x1 >= x0) {
        var w = x1 - x0 + 1, h = y1 - y0 + 1, img = { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) };
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          var j = (y * w + x) * 4;
          img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
          img.data[j + 3] = alpha[(y + y0) * d.w + x + x0];
        }
        T.writeRect(s, x0 - L.x, y0 - L.y, img);
      }
      if (old) delete st.surfaces[old];
      st.surfaces[id] = s;
      L.mk = { id: id, t: {}, on: 1, bg: 0 };
      st.maskEdit = false;
    }, old ? [old, id] : [id]);
  }

  // kind: "select" | "remove"
  function run(kind) {
    if (!st.doc) return;
    var L = null;
    if (kind === "remove") {
      L = PL.layer();
      if (!PL.ops.maskable(L)) return;
    }
    PL.busy(true);
    cutout().then(function (CUT) {
      return CUT.ready().then(function (have) { PL.busy(false); dialog(kind, L, CUT, have); });
    }, function () { PL.busy(false); PL.toast(t("msg.subjectFail", { why: t("subject.noLoader") })); });
  }

  function dialog(kind, L, CUT, have) {
    var d = st.doc, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var res = null, lo = CUT.LO, working = false;
    var need = el("p", "hint", t("subject.need", { mb: CUT.APPROX_MB }));
    need.hidden = have;
    var about = el("p", "hint", t(kind === "remove" ? "subject.aboutRemove" : "subject.aboutSelect"));
    var stage = el("div", "subj-stage subj-checker"); stage.hidden = true;
    var edge = PL.ui.range(t("subject.edge"), Math.round(lo * 100), 0, 60, function (x) {
      lo = x / 100;
      if (res && !pend) pend = requestAnimationFrame(function () { pend = 0; preview(); });
    });
    edge.hidden = true;
    var stat = el("p", "hint subj-stat");
    stat.setAttribute("aria-live", "polite");
    var pend = 0;
    var dlg = PL.dialog({
      title: t(kind === "remove" ? "dlg.removeBg" : "dlg.subject"),
      ok: t(have ? "subject.find" : "subject.download"),
      body: [about, need, stage, edge, stat],
      onOk: function () {
        if (working) return false;
        if (!res) { start(); return false; }
        apply();
        return true;
      },
      onCancel: function () { if (ctl) ctl.abort(); }
    });
    function preview() {
      var cv = res.render(lo, 360);
      cv.className = "subj-img";
      stage.innerHTML = "";
      stage.appendChild(cv);
      stat.textContent = cv.kept < 0.01 ? t("subject.little") : "";
    }
    function start() {
      working = true; dlg.ok.disabled = true;
      stat.textContent = have ? t("subject.run") : t("subject.load", { p: 0 });
      // The model sees at most 1024 px; a smaller copy is enough.
      var k = Math.min(1, 1024 / Math.max(d.w, d.h)), src = PL.view.flatten(null, k);
      CUT.cut(src, {
        signal: ctl ? ctl.signal : undefined,
        onProgress: function (p) { if (!have) stat.textContent = t("subject.load", { p: Math.round(p * 100) }); },
        onRun: function () { stat.textContent = t("subject.run"); }
      }).then(function (r) {
        working = false;
        if (ctl && ctl.signal.aborted) return;
        res = r; have = true; need.hidden = true;
        stage.hidden = false; edge.hidden = false;
        preview();
        dlg.ok.textContent = t("btn.apply"); dlg.ok.disabled = false;
      }, function (e) {
        working = false;
        if (ctl && ctl.signal.aborted) return;
        stat.textContent = t("msg.subjectFail", { why: String(e && e.message || e).slice(0, 120) });
        dlg.ok.disabled = false;
      });
    }
    function apply() {
      if (st.doc !== d) return;
      var alpha = CUT.alphaFor(res.mask, CUT.S, d.w, d.h, lo, Math.min(1, lo + SPAN));
      if (kind === "select") {
        var m = selOf(alpha, d.w, d.h);
        PL.setSel(S.isEmpty(m) ? null : m, t("step.subject"));
        PL.toast(t(st.sel ? "msg.subjectSel" : "subject.little"));
      } else {
        if (C.findLayer(st.doc, L.id) < 0) return;
        L = st.doc.layers[C.findLayer(st.doc, L.id)];
        maskLayer(L, alpha);
        PL.toast(t("msg.removedBg"));
      }
    }
    if (have) start();
  }

  PL.subject = { run: run, selOf: selOf };
})();
