// ============================================================
// orOS Photo Lab — recipes.js: Automations (wave A2, v1.0.0)
// The shared Automations panel (recipes/ui.js) with Photo Lab's steps
// (recipesteps.js). A run works on:
// - the open picture: each step is the editor's own command (on the
//   active layer and the selection, like the menus), so every step is
//   one undo step and the toast's Undo takes them all back; the
//   watermark becomes a layer of its own; Export saves into Pictures;
// - Batch process: opens it with this automation picked; there
//   onCanvas(canvas, steps, signal) runs the steps on every photo
//   (after the batch's resize, before its watermark and saving).
// Opens from File › Automations… and the Automations button on the
// projects screen.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, st = PL.st, el = PL.el, S = window.PhotoLabRecipes, UI = window.orosRecipesUI;
  if (!S || !UI || !window.orosRecipes) return;
  var C = S.CATALOG;
  function t(k, p) { return PL.t(k, p); }
  function canvas(w, h) { return PL.view.canvas(w, h); }
  function opName(op) { return t("rc.op." + op); }

  // ---------- The adapter ----------
  function newStep(op) {
    var o = { op: op }, args = C[op].args;
    Object.keys(args).forEach(function (k) {
      var a = args[k];
      o[k] = a.def !== undefined ? a.def : a.t === "bool" ? 0 : a.t === "color" ? "#ffffff" : "";
    });
    if (op === "watermark") o.text = "© ";
    return o;
  }
  function enumLabel(op, key, v) {
    if (op === "look") return t("look." + v);
    if (key === "pos") return t("anchor." + v);
    if (key === "fmt") return v === "jpg" ? "JPG" : v === "png" ? "PNG" : "WebP";
    if (key === "ratio") return v.replace(":", " : ");
    return t("rc.e." + key + "." + v);
  }
  function describe(s) {
    switch (s.op) {
      case "tone":
        return Object.keys(C.tone.args).filter(function (k) { return s[k]; }).map(function (k) {
          return t("rc.f." + k) + " " + (s[k] > 0 && C.tone.args[k].lo < 0 ? "+" : "") + s[k];
        }).join(", ");
      case "look": return t("look." + s.id);
      case "blur": return s.r + " px";
      case "sharpen": return s.amt + "% · " + s.r + " px";
      case "noise": return String(s.amt);
      case "crop": return enumLabel("crop", "ratio", s.ratio);
      case "resize": return enumLabel("resize", "mode", s.mode) + " " + s.v + (s.mode === "pct" ? "%" : " px");
      case "watermark": return "“" + s.text + "”";
      case "export": return enumLabel("export", "fmt", s.fmt) + (s.fmt === "png" ? "" : " " + s.q + "%");
    }
    return "";
  }
  function note(op) {
    var k = "rc.n." + op, v = t(k);
    return v === k ? "" : v;
  }
  function summary(steps) { return steps.map(function (s) { return opName(s.op); }).join(" · "); }

  // One modal <dialog> the panel fills (build adds its own buttons).
  function dialog(title, build) {
    var d = el("dialog", "dlg wide rc-dlg"), f = el("div", "dlg-form");
    f.appendChild(el("h2", "dlg-title", title));
    var body = el("div", "dlg-body");
    f.appendChild(body);
    d.appendChild(f);
    document.body.appendChild(d);
    var done = false;
    function close() {
      if (done) return;
      done = true;
      try { d.close(); } catch (e) {}
      d.remove();
    }
    d.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    build(body, close);
    d.showModal();
    var first = body.querySelector("input, select, button.primary");
    if (first) { try { first.focus(); } catch (e) {} }
  }

  function targets() {
    var out = [];
    if (st.doc) out.push(["open", t("rc.on.open", { name: st.doc.name || t("app.name") })]);
    out.push(["batch", t("rc.on.batch")]);
    return out;
  }
  function preview(steps, target) {
    if (target === "batch") return [t("rc.pv.batch")];
    var out = [t("rc.pv.open")];
    if (steps.some(function (s) { return s.op === "export"; })) out.push(t("rc.pv.export"));
    return out;
  }

  // ---------- On the open picture ----------
  function fail(key) { throw new Error(t(key)); }
  function watermarkLayer(s) {
    var d = st.doc, c = canvas(d.w, d.h);
    PL.batch.watermark(c, S.wmOf(s));
    var px = { w: d.w, h: d.h, data: c.getContext("2d").getImageData(0, 0, d.w, d.h).data };
    c.width = c.height = 0;
    var r = PL.R.trimRect(px);
    if (!r) return;
    var surf = PL.T.create();
    PL.T.writeRect(surf, 0, 0, PL.R.crop(px, r));
    PL.addLayer({ k: "raster", name: t("rc.wmLayer"), x: r.x, y: r.y, surface: surf }, opName("watermark"));
  }
  function exportPic(s) {
    return PL.io.render(s.fmt, s.q / 100, 1).then(function (blob) {
      if (!blob) fail("msg.exportFail");
      var ext = s.fmt === "webp" && blob.type !== "image/webp" ? "png" : s.fmt;
      return PL.io.saveToPictures(blob, PL.io.fileName(ext));
    });
  }
  function onDoc(steps, ctl) {
    var n0 = st.hist.list().done.length, saved = 0, chain = Promise.resolve();
    steps.forEach(function (s, i) {
      chain = chain.then(function () {
        if (ctl.signal.aborted || !st.doc) return;
        ctl.status(t("rc.doing", { i: i + 1, n: steps.length, name: opName(s.op) }));
        var d = st.doc;
        switch (s.op) {
          case "crop":
            var r = S.cropRect(d.w, d.h, s.ratio);
            if (r.w !== d.w || r.h !== d.h) PL.cropTo(r, opName("crop"));
            return;
          case "resize":
            var z = S.resizeTo(d.w, d.h, s);
            return PL.ops.resizeImage(z.w, z.h);
          case "watermark":
            watermarkLayer(s);
            return;
          case "export":
            return exportPic(s).then(function (p) { if (p) saved++; });
        }
        if (S.isIdentity(s)) return;
        var j = S.job(s);
        if (j.kind === "adjust") {
          var tg = PL.ops.adjustTarget();
          if (!tg) fail("rc.noLayer");
          return PL.ops.applyAdjust(tg, j.id, j.p, opName(s.op));
        }
        var tf = PL.ops.filterTarget();
        if (!tf) fail("rc.noLayer");
        return PL.ops.applyFilter(tf, j.id, j.p, opName(s.op));
      });
    });
    return chain.then(function () {
      var k = st.hist.list().done.length - n0, msg = k ? t("rc.done", { n: k }) : t("rc.nochange");
      if (saved) msg += " " + t("rc.saved");
      var res = { msg: msg };
      if (k > 0) res.undo = function () { for (var i = 0; i < k; i++) PL.undo(); };
      return res;
    });
  }

  // ---------- On a canvas (Batch process) ----------
  function pixels(cv) {
    var g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height);
    return { w: d.width, h: d.height, data: d.data };
  }
  function putPixels(cv, img) {
    if (cv.width !== img.w || cv.height !== img.h) { cv.width = img.w; cv.height = img.h; }
    var data = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data);
    cv.getContext("2d").putImageData(new ImageData(data, img.w, img.h), 0, 0);
    return cv;
  }
  function onCanvas(cv, steps, signal) {
    var chain = Promise.resolve(cv);
    steps.forEach(function (s) {
      chain = chain.then(function (cv) {
        if (signal && signal.aborted) { cv.width = cv.height = 0; throw new Error("stop"); }
        var W = cv.width, H = cv.height;
        switch (s.op) {
          case "crop":
            var r = S.cropRect(W, H, s.ratio);
            if (r.w === W && r.h === H) return cv;
            var out = canvas(r.w, r.h);
            out.getContext("2d").drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            cv.width = cv.height = 0;
            return out;
          case "resize":
            var z = PL.batch.fitDevice(S.resizeTo(W, H, s));
            if (z.w === W && z.h === H) return cv;
            var sc = PL.batch.drawScaled(cv, W, H, z.w, z.h);
            cv.width = cv.height = 0;
            return sc;
          case "watermark":
            PL.batch.watermark(cv, S.wmOf(s));
            return cv;
          case "export":
            return cv;
        }
        if (S.isIdentity(s)) return cv;
        var j = S.job(s), img = pixels(cv);
        var a = j.kind === "adjust" ? { img: img, id: j.id, p: j.p }
          : { img: img, id: j.id, p: j.p, pad: 0, at: { x: 0, y: 0, cw: W, ch: H } };
        return PL.job(j.kind, a).then(function (res) { return putPixels(cv, res); });
      });
    });
    return chain;
  }

  function run(steps, target, ctl, rec) {
    if (target === "batch") {
      PL.batch.open({ recipe: rec && rec.id });
      return Promise.resolve({});
    }
    if (!st.doc) return Promise.resolve({ msg: t("rc.noDoc") });
    return onDoc(steps, ctl);
  }

  var panel = UI.mount({
    app: "photolab", catalog: C, order: S.ORDER,
    t: t, enumLabel: enumLabel, choices: null, newStep: newStep, describe: describe, note: note,
    dialog: dialog, toast: function (msg, label, fn) { if (fn) PL.undoToast(msg, fn); else PL.toast(msg); },
    now: function () { return Date.now(); },
    cls: { inp: "", lbl: "fld-l" },
    targets: targets, preview: preview, run: run
  });

  function byId(id) {
    var r = null;
    panel.list().forEach(function (x) { if (x.id === id) r = x; });
    return r;
  }
  PL.recipes = {
    open: panel.open, list: panel.list, draft: panel.draft, onCanvas: onCanvas, summary: summary, watermark: watermarkLayer,
    // the steps of an automation that may run here (none: null)
    steps: function (id) {
      var r = byId(id);
      if (!r) return null;
      var c = window.orosRecipes.check(r, C).steps;
      return c.length ? c : null;
    }
  };
})();
