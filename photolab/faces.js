// ============================================================
// orOS Photo Lab — faces.js: Select › Faces, Filter › Blur faces
// (FACE-BLUR, v1.0.0)
// The shared face finder ../facekit.js (YuNet, OpenCV Zoo, MIT, on the
// device in ONNX Runtime Web, the runtime shared with Atelier and
// Select subject), loaded only when one of these is asked for. It finds
// WHERE faces are, never whose; nothing is kept after the dialog.
//   - Select › Faces: the faces (head-sized ellipses, soft edge) become
//     the selection, for any filter or adjustment.
//   - Filter › Blur faces: a new top layer "Blurred faces" holds the
//     faces blurred / pixelated / covered (one undo step, nothing below
//     is changed, so it can be hidden, moved or deleted).
// Both look at the whole visible picture and let the person keep a
// face clear or add one that was missed before anything changes.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, st = PL.st, el = PL.el;
  var FIND = 2560;                     // the picture the finder sees (long side)
  var VIEW = 720;                      // the review picture in the dialog
  function t(k, p) { return PL.t(k, p); }

  var fkP = null;
  function facekit() {
    if (window.OrosFaces) return Promise.resolve(window.OrosFaces);
    if (!fkP) {
      fkP = new Promise(function (ok, fail) {
        var v = (document.querySelector('script[src*="app.js?v="]') || {}).src || "";
        var m = v.match(/[?&]v=([^&#]+)/);
        var s = document.createElement("script");
        s.src = "../facekit.js" + (m ? "?v=" + m[1] : "");
        s.onload = function () { if (window.OrosFaces) ok(window.OrosFaces); else fail(new Error("facekit")); };
        s.onerror = function () { fail(new Error("facekit")); };
        document.head.appendChild(s);
      });
      fkP.catch(function () { fkP = null; });
    }
    return fkP;
  }

  // Doc-space boxes → a soft selection of head ellipses.
  function selOf(FK, boxes, w, h) {
    var m = S.make(w, h);
    boxes.forEach(function (b) {
      if (b.off) return;
      var e = FK.head(b), R = Math.min(e.rx, e.ry), fe = Math.max(1.5, R * 0.12);
      var x0 = Math.max(0, Math.floor(e.cx - e.rx)), x1 = Math.min(w, Math.ceil(e.cx + e.rx));
      var y0 = Math.max(0, Math.floor(e.cy - e.ry)), y1 = Math.min(h, Math.ceil(e.cy + e.ry));
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var dx = (x + 0.5 - e.cx) / e.rx, dy = (y + 0.5 - e.cy) / e.ry;
        var a = Math.round(Math.max(0, Math.min(1, (1 - Math.sqrt(dx * dx + dy * dy)) * R / fe)) * 255);
        if (a > m.data[y * w + x]) m.data[y * w + x] = a;
      }
    });
    return m;
  }
  // The box around every face's ellipse, inside the picture, or null.
  function unionOf(FK, boxes, w, h) {
    var x0 = w, y0 = h, x1 = 0, y1 = 0;
    boxes.forEach(function (b) {
      if (b.off) return;
      var e = FK.head(b);
      x0 = Math.min(x0, Math.floor(e.cx - e.rx)); y0 = Math.min(y0, Math.floor(e.cy - e.ry));
      x1 = Math.max(x1, Math.ceil(e.cx + e.rx)); y1 = Math.max(y1, Math.ceil(e.cy + e.ry));
    });
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function scaleBoxes(boxes, k) {
    return boxes.map(function (b) {
      var o = Object.assign({}, b);
      o.x = b.x * k; o.y = b.y * k; o.w = b.w * k; o.h = b.h * k;
      return o;
    });
  }

  // kind: "select" | "blur"
  function run(kind) {
    if (!st.doc) return;
    PL.busy(true);
    facekit().then(function (FK) {
      return FK.ready().then(function (have) {
        return FK.needMB().then(function (mb) { PL.busy(false); dialog(kind, FK, have, mb); });
      });
    }).then(null, function () { PL.busy(false); PL.toast(t("msg.facesFail", { why: t("subject.noLoader") })); });
  }

  function dialog(kind, FK, have, mb) {
    var d = st.doc, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var boxes = null, ed = null, working = false, style = "blur";
    var kv = Math.min(1, VIEW / Math.max(d.w, d.h)), view = null;
    var about = el("p", "hint", t(kind === "blur" ? "faces.aboutBlur" : "faces.aboutSelect"));
    var need = el("p", "hint", t("faces.need", { mb: mb >= 1 ? Math.round(mb) : "0.3" }));
    need.hidden = have;
    var stage = el("div", "faces-stage"); stage.hidden = true;
    var hint = el("p", "hint", t("faces.hint")); hint.hidden = true;
    var styleRow = null, styleSel = null;
    if (kind === "blur") {
      styleSel = el("select");
      FK.STYLES.forEach(function (id) {
        var o = el("option", "", t("faces.st." + id)); o.value = id; styleSel.appendChild(o);
      });
      styleSel.value = style;
      styleSel.addEventListener("change", function () { style = styleSel.value; });
      styleRow = el("label", "fld");
      styleRow.appendChild(el("span", "fld-l", t("faces.style")));
      styleRow.appendChild(styleSel);
      styleRow.hidden = true;
    }
    var stat = el("p", "hint faces-stat");
    stat.setAttribute("aria-live", "polite");
    var dlg = PL.dialog({
      title: t(kind === "blur" ? "dlg.blurFaces" : "dlg.selFaces"),
      ok: t(have ? "faces.find" : "faces.download"),
      wide: true,
      body: [about, need, stage, hint, styleRow, stat],
      onOk: function () {
        if (working) return false;
        if (!boxes) { start(); return false; }
        return apply();
      },
      onCancel: function () { if (ctl) ctl.abort(); if (view) view.width = view.height = 0; }
    });
    function why(e) {
      var m = String(e && e.message || e || "");
      if (m === "checksum") return t("faces.bad");
      if (/http|fetch|network/i.test(m)) return t("faces.net");
      return m.slice(0, 120);
    }
    function start() {
      working = true; dlg.ok.disabled = true;
      stat.textContent = have ? t("faces.run") : t("faces.load", { p: 0 });
      var k = Math.min(1, FIND / Math.max(d.w, d.h)), src = PL.view.flatten(null, k);
      FK.detect(src, {
        signal: ctl ? ctl.signal : undefined,
        onProgress: function (p) { if (!have) stat.textContent = t("faces.load", { p: Math.round(p * 100) }); },
        onRun: function () { stat.textContent = t("faces.run"); }
      }).then(function (found) {
        src.width = src.height = 0;
        working = false;
        if (ctl && ctl.signal.aborted) return;
        have = true; need.hidden = true;
        boxes = scaleBoxes(found, 1 / k);                     // doc pixels
        view = PL.view.flatten(null, kv);
        ed = FK.editor(view, scaleBoxes(boxes, kv), { label: t("faces.count", { n: boxes.length }) });
        stage.innerHTML = "";
        stage.appendChild(ed.el);
        stage.hidden = false; hint.hidden = false;
        if (styleRow) styleRow.hidden = false;
        stat.textContent = boxes.length ? t("faces.count", { n: boxes.length }) : t("faces.none");
        dlg.ok.textContent = t("btn.apply"); dlg.ok.disabled = false;
      }, function (e) {
        src.width = src.height = 0;
        working = false;
        if (ctl && ctl.signal.aborted) return;
        stat.textContent = t("msg.facesFail", { why: why(e) });
        dlg.ok.disabled = false;
      });
    }
    function apply() {
      if (st.doc !== d) return true;
      var list = scaleBoxes(ed.boxes(), 1 / kv).filter(function (b) { return !b.off; });
      if (view) view.width = view.height = 0;
      if (!list.length) { PL.toast(t("faces.none")); return true; }
      if (kind === "select") {
        var m = selOf(FK, list, d.w, d.h);
        PL.setSel(S.isEmpty(m) ? null : m, t("step.selFaces"));
        PL.toast(t("msg.facesSel", { n: list.length }));
        return true;
      }
      blurLayer(FK, list, style);
      return true;
    }
    if (have) start();
  }

  // The faces of the visible picture, blurred, as a new layer on top.
  function blurLayer(FK, list, style) {
    var d = st.doc, r = unionOf(FK, list, d.w, d.h);
    if (!r) return false;
    var cv = PL.view.flatten(r, 1), g = cv.getContext("2d", { willReadFrequently: true });
    var img = g.getImageData(0, 0, r.w, r.h);
    cv.width = cv.height = 0;
    var local = list.map(function (b) { var o = Object.assign({}, b); o.x -= r.x; o.y -= r.y; return o; });
    FK.blurInto(img.data, r.w, r.h, local, style, { layer: true });
    var s = T.create();
    T.writeRect(s, 0, 0, { w: r.w, h: r.h, data: img.data });
    var top = d.layers[d.layers.length - 1];
    if (top) st.active = top.id;                             // the new layer goes on top of everything
    PL.addLayer({ k: "raster", name: t("layer.faces"), x: r.x, y: r.y, surface: s, g: "" }, t("step.blurFaces"));
    PL.toast(t("msg.facesBlurred", { n: list.length }));
    return true;
  }

  PL.faces = { run: run, selOf: selOf, unionOf: unionOf };
})();
