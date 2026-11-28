// ============================================================
// orOS Photo Lab — smart.js: Smart select and Colourize (SC, v1.0.0)
// Chris 2026-11-28 («Ναι σε όλα, σύμφωνα με το πλάνο σου»).
//   - the Smart select tool (tools.js "smart"): click an object, it
//     becomes the selection; Shift adds, Alt takes away (or the tool's
//     Mode), Feather as the other selection tools. The model (SlimSAM,
//     atelier/smartai.js) reads the whole visible picture once (a few
//     seconds); every later click on the same picture is quick
//   - Filter › Colourize…: DDColor guesses the colours of the visible
//     picture; they are laid on its own lightness at full size, as a
//     new layer on top (one undo step) with Strength; inside a
//     selection only that part
//   - auto steps for the Assistant's and Claude's "smartselect" and
//     "colorize" commands (aiedit.js)
// Both models run on this device (ONNX Runtime Web through Atelier's
// loader atelier/cutout.js) and download once, only when asked for.
// Loaded by tools.js PL.smartLoad() the first time it is needed.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, st = PL.st, el = PL.el;
  var LONG = 1024;                     // the picture the segmenter reads (long side)
  var SOFT = 1.5;                      // the selection's edge, in model logits
  function t(k, p) { return PL.t(k, p); }
  function ver() { var v = (document.querySelector('script[src*="app.js?v="]') || {}).src || "", m = v.match(/[?&]v=([^&#]+)/); return m ? "?v=" + m[1] : ""; }
  function load(src, global) {
    if (window[global]) return Promise.resolve(window[global]);
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src + ver();
      s.onload = function () { if (window[global]) ok(window[global]); else fail(new Error(global)); };
      s.onerror = function () { fail(new Error(global)); };
      document.head.appendChild(s);
    });
  }
  var engP = null;
  // → { CUT, AI } (Atelier's runtime loader, the models)
  function engine() {
    if (!engP) {
      engP = load("../atelier/cutout.js", "AtelierCutout").then(function (CUT) {
        return load("../atelier/smartai.js", "OrosSmartAI").then(function (AI) { return { CUT: CUT, AI: AI }; });
      });
      engP.catch(function () { engP = null; });
    }
    return engP;
  }
  function why(e) { return String(e && e.message === "sha" ? t("sc.badFile") : (e && e.message) || e).slice(0, 120); }

  // ---------- Download question ----------
  // Asks once before a first download (mb > 0) → Promise<boolean>
  function askDownload(mb, about) {
    if (!mb) return Promise.resolve(true);
    return new Promise(function (ok) {
      PL.dialog({
        title: t("sc.dlTitle"), ok: t("sc.dlGo"),
        body: [el("p", "hint", about), el("p", "hint", t("sc.dlNeed", { mb: mb }))],
        onOk: function () { ok(true); }, onCancel: function () { ok(false); }
      });
    });
  }

  // ---------- Smart select ----------
  var seg = null, segFor = null, working = false;
  // The visible picture at most LONG on its long side → its segmenter
  // (the encoder runs only when the picture changed).
  function segment(E, opts) {
    var d = st.doc, k = Math.min(1, LONG / Math.max(d.w, d.h)), cv = PL.view.flatten(null, k);
    return E.AI.segmenter(E.CUT, cv, opts).then(function (s) { cv.width = cv.height = 0; s.k = k; s.doc = d; return s; });
  }
  function progress(p) { PL.live(t("sc.loading", { p: Math.round(p * 100) })); setStatus(t("sc.loading", { p: Math.round(p * 100) })); }
  var statusEl = null;
  function setStatus(s) {
    if (!statusEl) { statusEl = el("div", "sc-status"); statusEl.setAttribute("aria-live", "polite"); document.body.appendChild(statusEl); }
    statusEl.textContent = s || "";
    statusEl.hidden = !s;
  }
  // The selection (doc size) for one click point (doc pixels) → mask | null
  function maskAt(s, p, part) {
    var d = st.doc;
    return s.select([{ x: p.x * s.k, y: p.y * s.k }], part).then(function (r) {
      var a = s.alpha(r, d.w, d.h, SOFT), m = S.make(d.w, d.h);
      m.data.set(a);
      return S.isEmpty(m) ? null : m;
    });
  }
  function click(p, mode) {
    if (!st.doc || working) return;
    var d = st.doc;
    working = true;
    PL.busy(true);
    engine().then(function (E) {
      return E.AI.needMb(E.CUT, [E.AI.MODELS.samEnc, E.AI.MODELS.samDec]).then(function (mb) {
        PL.busy(false);
        return askDownload(mb, t("sc.aboutSelect")).then(function (go) {
          if (!go) return null;
          PL.busy(true);
          return segment(E, { onProgress: progress, onRun: function () { setStatus(t("sc.reading")); } });
        });
      });
    }).then(function (s) {
      setStatus("");
      if (!s || st.doc !== d) return undefined;
      return maskAt(s, p, PL.prefs.smart && PL.prefs.smart.part);
    }).then(function (m) {
      working = false; PL.busy(false);
      if (m === undefined || st.doc !== d) return;
      if (!m) { PL.toast(t("sc.nothing")); return; }
      if (PL.prefs.feather > 0) m = S.feather(m, PL.prefs.feather);
      var next = S.combine(st.sel, m, mode);
      PL.setSel(next && S.isEmpty(next) ? null : next, t("step.smart"));
    }, function (e) {
      working = false; PL.busy(false); setStatus("");
      PL.toast(t("sc.fail", { why: why(e) }));
    });
  }
  // The tool was picked: read the picture ahead, when the model is here.
  function warm() {
    if (!st.doc || working) return;
    var d = st.doc;
    engine().then(function (E) {
      return E.AI.needMb(E.CUT, [E.AI.MODELS.samEnc, E.AI.MODELS.samDec]).then(function (mb) {
        if (mb || st.doc !== d || st.tool !== "smart") return;
        return segment(E, {});
      });
    }).catch(function () {});
  }
  // Claude's and the Assistant's smartselect: the object at (x, y) of
  // the canvas → the selection (to "sel") or a copy of it as a new layer
  // (to "layer"). → Promise<1 | 0>
  function autoSelect(o) {
    var d = st.doc;
    if (!d) return Promise.resolve(0);
    return engine().then(function (E) { return segment(E, {}); }).then(function (s) {
      if (st.doc !== d) return 0;
      return maskAt(s, { x: o.x, y: o.y }, !!o.only).then(function (m) {
        if (!m || st.doc !== d) return 0;
        if (o.to === "layer") {
          var img = PL.view.flatten(null, 1), g = img.getContext("2d", { willReadFrequently: true }), px = g.getImageData(0, 0, d.w, d.h);
          for (var i = 0; i < m.data.length; i++) px.data[i * 4 + 3] = Math.round(px.data[i * 4 + 3] * m.data[i] / 255);
          img.width = img.height = 0;
          var sf = T.create();
          T.writeRect(sf, 0, 0, { w: d.w, h: d.h, data: px.data });
          var top = d.layers[d.layers.length - 1];
          if (top) PL.selectLayer(top.id, false);
          return PL.addLayer({ k: "raster", name: t("sc.objLayer"), x: 0, y: 0, surface: sf, g: 0 }, t("step.smart")) ? 1 : 0;
        }
        PL.setSel(m, t("step.smart"));
        return 1;
      });
    });
  }

  // ---------- Colourize ----------
  // The picture (doc size, RGBA of the visible picture) coloured, inside
  // the selection when there is one → a new top layer, one undo step.
  function addColored(res, amt) {
    var d = st.doc, cv = PL.view.flatten(null, 1), g = cv.getContext("2d", { willReadFrequently: true });
    var px = g.getImageData(0, 0, d.w, d.h).data;
    cv.width = cv.height = 0;
    res.apply(px, d.w, d.h, amt);
    if (st.sel) for (var i = 0; i < st.sel.data.length; i++) px[i * 4 + 3] = Math.round(px[i * 4 + 3] * st.sel.data[i] / 255);
    var sf = T.create();
    T.writeRect(sf, 0, 0, { w: d.w, h: d.h, data: px });
    var top = d.layers[d.layers.length - 1];
    if (top) PL.selectLayer(top.id, false);
    return PL.addLayer({ k: "raster", name: t("sc.colorLayer"), x: 0, y: 0, surface: sf, g: 0 }, t("step.colorize"));
  }
  function sideFor(fast) { return fast ? 256 : 512; }
  function colorDialog() {
    if (!st.doc) return;
    PL.busy(true);
    engine().then(function (E) {
      return E.AI.needMb(E.CUT, [E.AI.MODELS.color]).then(function (mb) { PL.busy(false); openColor(E, mb); });
    }, function () { PL.busy(false); PL.toast(t("sc.fail", { why: t("subject.noLoader") })); });
  }
  function openColor(E, mb) {
    var d = st.doc, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var res = null, busy = false, amt = 100, fast = !!PL.phone, pend = 0;
    var about = el("p", "hint", t("sc.aboutColor"));
    var need = el("p", "hint", t("sc.dlNeed", { mb: mb })); need.hidden = !mb;
    var stage = el("div", "sc-stage"); stage.hidden = true;
    var strength = PL.ui.range(t("sc.strength"), amt, 0, 150, function (x) {
      amt = x;
      if (res && !pend) pend = requestAnimationFrame(function () { pend = 0; preview(); });
    });
    strength.hidden = true;
    var q = PL.ui.select([["best", t("sc.qBest")], ["fast", t("sc.qFast")]], fast ? "fast" : "best");
    var qual = PL.ui.field(t("sc.quality"), q);
    q.addEventListener("change", function () { fast = q.value === "fast"; if (res) { res = null; start(); } });
    var stat = el("p", "hint sc-stat"); stat.setAttribute("aria-live", "polite");
    var note = el("p", "hint", t("sc.guess"));
    var small = null;
    var dlg = PL.dialog({
      title: t("dlg.colorize"), ok: t(mb ? "sc.dlGoColor" : "sc.colorGo"),
      body: [about, need, qual, stage, strength, stat, note],
      onOk: function () {
        if (busy) return false;
        if (!res) { start(); return false; }
        apply();
        return true;
      },
      onCancel: function () { if (ctl) ctl.abort(); }
    });
    function preview() {
      if (!small) return;
      var c = document.createElement("canvas"); c.width = small.w; c.height = small.h;
      var data = new Uint8ClampedArray(small.data);
      res.apply(data, small.w, small.h, amt / 100);
      c.getContext("2d").putImageData(new ImageData(data, small.w, small.h), 0, 0);
      c.className = "sc-img";
      stage.innerHTML = ""; stage.appendChild(c);
    }
    function start() {
      busy = true; dlg.ok.disabled = true;
      stat.textContent = mb ? t("sc.loading", { p: 0 }) : t("sc.coloring");
      var k = Math.min(1, 1024 / Math.max(d.w, d.h)), src = PL.view.flatten(null, k);
      var pk = Math.min(1, 360 / Math.max(src.width, src.height)), pc = document.createElement("canvas");
      pc.width = Math.max(1, Math.round(src.width * pk)); pc.height = Math.max(1, Math.round(src.height * pk));
      pc.getContext("2d").drawImage(src, 0, 0, pc.width, pc.height);
      small = { w: pc.width, h: pc.height, data: pc.getContext("2d").getImageData(0, 0, pc.width, pc.height).data };
      E.AI.colorize(E.CUT, src, {
        side: sideFor(fast), signal: ctl ? ctl.signal : undefined,
        onProgress: function (p) { stat.textContent = t("sc.loading", { p: Math.round(p * 100) }); },
        onRun: function () { stat.textContent = t("sc.coloring"); }
      }).then(function (r) {
        busy = false;
        if (ctl && ctl.signal.aborted) return;
        res = r; mb = 0; need.hidden = true;
        stage.hidden = false; strength.hidden = false; stat.textContent = "";
        preview();
        dlg.ok.textContent = t("btn.apply"); dlg.ok.disabled = false;
      }, function (e) {
        busy = false;
        if (ctl && ctl.signal.aborted) return;
        stat.textContent = t("sc.fail", { why: why(e) });
        dlg.ok.disabled = false;
      });
    }
    function apply() {
      if (st.doc !== d || !res) return;
      PL.busy(true);
      setTimeout(function () {
        try { addColored(res, amt / 100); PL.toast(t("sc.colored")); }
        catch (e) { PL.toast(t("sc.fail", { why: why(e) })); }
        PL.busy(false);
      }, 30);
    }
    if (!mb) start();
  }
  // Claude's and the Assistant's colorize: amt 0..150 (%), fast →
  // Promise<1 | 0>
  function autoColor(o) {
    var d = st.doc;
    if (!d) return Promise.resolve(0);
    return engine().then(function (E) {
      var k = Math.min(1, 1024 / Math.max(d.w, d.h));
      return E.AI.colorize(E.CUT, PL.view.flatten(null, k), { side: sideFor(o.fast) });
    }).then(function (r) {
      if (st.doc !== d) return 0;
      return addColored(r, (o.amt == null ? 100 : o.amt) / 100) ? 1 : 0;
    });
  }

  PL.smart = { click: click, warm: warm, colorDialog: colorDialog, autoSelect: autoSelect, autoColor: autoColor, engine: engine };
})();
