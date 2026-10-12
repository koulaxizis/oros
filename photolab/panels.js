// ============================================================
// orOS Photo Lab — panels, menus, dialogs, keyboard (v1.0.0)
// Builds the editor chrome around the canvas:
//   - top bar: projects, document name, menus (one ☰ menu on a
//     phone), undo / redo, save state, panel toggle
//   - tool bar (left on desktop, bottom on a phone) + colours
//   - options bar for the current tool
//   - side panel: Layers and History (a bottom sheet on a phone)
//   - status bar: zoom, size
//   - centred dialogs (R32) for New, Resize, Canvas size, Rotate,
//     Feather, Grow / shrink, Text, Export and the adjustments
//   - shortcuts (Photoshop letters; Ctrl+Alt+Shift goes to the shell)
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, FX = PL.FX;
  var st = PL.st, $ = PL.$, el = PL.el;
  function t(k, p) { return PL.t(k, p); }
  function ops() { return PL.ops; }
  function pr() { return PL.prefs; }

  // ---------- Icons ----------
  function svg(d, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + (extra || "") + "</svg>";
  }
  var ICON = {
    move: svg('<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>'),
    marquee: svg('<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 3"/>'),
    marqueeE: svg('<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 3"/>'),
    lasso: svg('<path d="M7 18c-3-1-4-4-3-7 1-4 6-7 11-6s7 5 5 8-7 4-10 3"/><path d="M7 18c0 2 1 3 3 3"/>'),
    wand: svg('<path d="M4 20L15 9"/><path d="M15 4v2M19 8h2M18 5l1.5-1.5M14 4.5L13 3M20 11l1 1"/>'),
    crop: svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
    brush: svg('<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-5 2-5 5 0 1-1 2-2 2 2 2 7 2 9-1 1-2 1-3 1-3"/>'),
    eraser: svg('<path d="M20 20H8l-5-5a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-8 8"/><path d="M6 11l7 7"/>'),
    fill: svg('<path d="M19 11L11 3 3 11l8 8z"/><path d="M5 9h12"/><path d="M20 14s2 3 2 4a2 2 0 0 1-4 0c0-1 2-4 2-4z"/>'),
    gradient: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l6-6M3 21L21 3M9 21l12-12M15 21l6-6"/>'),
    picker: svg('<path d="M2 22l1-4 10-10 3 3-10 10z"/><path d="M14 4l3-1 4 4-1 3-3 1-4-4z"/>'),
    text: svg('<path d="M4 6V4h16v2M12 4v16M9 20h6"/>'),
    shape: svg('<rect x="3" y="11" width="10" height="10" rx="1"/><circle cx="16" cy="8" r="5"/>'),
    hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>'),
    zoom: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6M11 8v6"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    home: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    layers: svg('<path d="M12 2l10 6-10 6L2 8z"/><path d="M2 16l10 6 10-6"/>'),
    eye: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4.2M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10 10 0 0 0 5.4-1.6"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    dup: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    del: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    down: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
    merge: svg('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
    swap: svg('<path d="M7 4L3 8l4 4M3 8h13a4 4 0 0 1 4 4M17 20l4-4-4-4M21 16H8a4 4 0 0 1-4-4"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: svg('<path d="M5 13l4 4L19 7"/>')
  };
  PL.ICON = ICON;

  // ---------- Generic dialog (R32: centred) ----------
  // o = { title, body: [nodes], ok: label, onOk() → false keeps it open,
  //       onCancel(), extra: [buttons] }
  PL.dialog = function (o) {
    var d = el("dialog", "dlg" + (o.wide ? " wide" : ""));
    var f = el("form", "dlg-form");
    f.method = "dialog";
    f.appendChild(el("h2", "dlg-title", o.title));
    var body = el("div", "dlg-body");
    (o.body || []).forEach(function (n) { if (n) body.appendChild(n); });
    f.appendChild(body);
    var acts = el("div", "dlg-actions");
    (o.extra || []).forEach(function (b) { acts.appendChild(b); });
    var spacer = el("span", "spacer"); acts.appendChild(spacer);
    var cancel = el("button", "btn ghost", t("btn.cancel")); cancel.type = "button"; cancel.value = "cancel";
    var ok = el("button", "btn primary", o.ok || t("btn.ok")); ok.type = "submit"; ok.value = "ok";
    if (o.ok !== null) acts.appendChild(cancel);
    acts.appendChild(ok);
    if (o.ok === null) ok.textContent = t("btn.close");
    f.appendChild(acts);
    d.appendChild(f);
    document.body.appendChild(d);
    var done = false;
    function close(v) {
      if (done) return;
      done = true;
      try { d.close(); } catch (e) {}
      d.remove();
      if (v !== "ok" && o.onCancel) o.onCancel();
    }
    cancel.addEventListener("click", function () { close("cancel"); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (o.onOk && o.onOk() === false) return;
      close("ok");
    });
    d.addEventListener("cancel", function (e) { e.preventDefault(); close("cancel"); });
    d.showModal();
    var first = body.querySelector("input, select, textarea, button");
    if (first) { try { first.focus(); if (first.select && first.type !== "range") first.select(); } catch (e) {} }
    return { close: close, node: d, ok: ok };
  };
  function field(label, input) {
    var w = el("label", "fld");
    w.appendChild(el("span", "fld-l", label));
    w.appendChild(input);
    return w;
  }
  function numIn(v, min, max, step) {
    var i = el("input"); i.type = "number"; i.value = String(v);
    if (min != null) i.min = String(min); if (max != null) i.max = String(max);
    i.step = String(step || 1); i.inputMode = "decimal";
    return i;
  }
  function textIn(v, max) { var i = el("input"); i.type = "text"; i.value = v || ""; i.maxLength = max || 80; i.autocomplete = "off"; return i; }
  function select(options, v) {
    var s = el("select");
    options.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = v;
    return s;
  }
  function check(label, v) {
    var w = el("label", "chk"), i = el("input");
    i.type = "checkbox"; i.checked = !!v;
    w.appendChild(i); w.appendChild(el("span", "", label));
    w.input = i;
    return w;
  }
  function range(label, v, min, max, onInput) {
    var w = el("label", "rng");
    var top = el("span", "rng-top");
    top.appendChild(el("span", "", label));
    var out = el("output", "", String(v)); top.appendChild(out);
    var i = el("input"); i.type = "range"; i.min = String(min); i.max = String(max); i.value = String(v);
    i.addEventListener("input", function () { out.textContent = i.value; if (onInput) onInput(+i.value); });
    w.appendChild(top); w.appendChild(i);
    w.input = i;
    return w;
  }
  function hint(text) { return el("p", "hint", text); }
  PL.ui = { field: field, numIn: numIn, textIn: textIn, select: select, check: check, range: range, hint: hint };

  // ---------- Dialogs ----------
  function newDialog() {
    var presets = C.PRESETS.map(function (p) { return [p.id, p[PL.LANG] || p.en]; });
    presets.unshift(["custom", t("new.custom")]);
    var name = textIn(t("doc.untitled")), pre = select(presets, "hd");
    var w = numIn(1920, 1, 8192), h = numIn(1080, 1, 8192);
    var bg = select([["white", t("new.white")], ["clear", t("new.clear")], ["fg", t("new.fg")]], "white");
    pre.addEventListener("change", function () {
      C.PRESETS.forEach(function (p) { if (p.id === pre.value) { w.value = p.w; h.value = p.h; } });
    });
    [w, h].forEach(function (i) { i.addEventListener("input", function () { pre.value = "custom"; }); });
    PL.dialog({
      title: t("dlg.new"), ok: t("btn.create"),
      body: [field(t("f.name"), name), field(t("f.preset"), pre),
             el2("div", "row2", [field(t("f.width"), w), field(t("f.height"), h)]),
             field(t("f.background"), bg)],
      onOk: function () {
        var W = Math.round(+w.value), Hh = Math.round(+h.value);
        if (!(W >= 1 && Hh >= 1 && W <= 8192 && Hh <= 8192)) { PL.toast(t("msg.badSize")); return false; }
        PL.closeProject(true).then(function () { PL.newProject(W, Hh, name.value, bg.value); });
      }
    });
  }
  function el2(tag, cls, kids) { var n = el(tag, cls); kids.forEach(function (k) { n.appendChild(k); }); return n; }

  function resizeDialog() {
    var d = st.doc, ratio = d.w / d.h;
    var w = numIn(d.w, 1, 8192), h = numIn(d.h, 1, 8192), pct = numIn(100, 1, 1000);
    var keep = check(t("f.keepRatio"), true);
    w.addEventListener("input", function () { if (keep.input.checked) h.value = Math.max(1, Math.round(+w.value / ratio)); pct.value = Math.round(+w.value / d.w * 100); });
    h.addEventListener("input", function () { if (keep.input.checked) w.value = Math.max(1, Math.round(+h.value * ratio)); pct.value = Math.round(+h.value / d.h * 100); });
    pct.addEventListener("input", function () { w.value = Math.max(1, Math.round(d.w * +pct.value / 100)); h.value = Math.max(1, Math.round(d.h * +pct.value / 100)); });
    PL.dialog({
      title: t("dlg.resize"), ok: t("btn.apply"),
      body: [el2("div", "row2", [field(t("f.width"), w), field(t("f.height"), h)]), field(t("f.percent"), pct), keep,
             hint(t("hint.resize"))],
      onOk: function () {
        var W = Math.round(+w.value), Hh = Math.round(+h.value);
        if (!(W >= 1 && Hh >= 1 && W <= 8192 && Hh <= 8192)) { PL.toast(t("msg.badSize")); return false; }
        ops().resizeImage(W, Hh);
      }
    });
  }
  function canvasDialog() {
    var d = st.doc, w = numIn(d.w, 1, 8192), h = numIn(d.h, 1, 8192), anchor = "c";
    var grid = el("div", "anchor-grid");
    PL.R.ANCHORS.forEach(function (a) {
      var b = el("button", "anchor" + (a === anchor ? " on" : ""));
      b.type = "button"; PL.setLabel(b, t("anchor." + a));
      b.addEventListener("click", function () {
        anchor = a;
        [].forEach.call(grid.children, function (c) { c.classList.toggle("on", c === b); });
      });
      grid.appendChild(b);
    });
    PL.dialog({
      title: t("dlg.canvas"), ok: t("btn.apply"),
      body: [el2("div", "row2", [field(t("f.width"), w), field(t("f.height"), h)]), field(t("f.anchor"), grid), hint(t("hint.canvas"))],
      onOk: function () {
        var W = Math.round(+w.value), Hh = Math.round(+h.value);
        if (!(W >= 1 && Hh >= 1 && W <= 8192 && Hh <= 8192)) { PL.toast(t("msg.badSize")); return false; }
        ops().canvasSize(W, Hh, anchor);
      }
    });
  }
  function rotateDialog() {
    var a = numIn(15, -359, 359, 0.1);
    PL.dialog({ title: t("dlg.rotate"), ok: t("btn.apply"), body: [field(t("f.angle"), a), hint(t("hint.rotate"))],
      onOk: function () { ops().rotateAny(+a.value); } });
  }
  function numberDialog(title, label, v, min, max, run) {
    var n = numIn(v, min, max);
    PL.dialog({ title: title, ok: t("btn.apply"), body: [field(label, n)], onOk: function () {
      var x = Math.round(+n.value);
      if (!(x >= min && x <= max)) { PL.toast(t("msg.badNumber")); return false; }
      run(x);
    } });
  }
  function renameDialog() {
    var n = textIn(st.doc.name);
    PL.dialog({ title: t("dlg.rename"), ok: t("btn.save"), body: [field(t("f.name"), n)], onOk: function () { PL.renameDoc(n.value); } });
  }
  function renameLayer(L) {
    var n = textIn(L.name);
    PL.dialog({ title: t("dlg.renameLayer"), ok: t("btn.save"), body: [field(t("f.name"), n)], onOk: function () {
      var v = C.cleanName(n.value);
      if (v) ops().setProp(L, "name", v, t("step.renameLayer"));
    } });
  }

  // Text: a new layer at `at`, or edit L.
  PL.panels = PL.panels || {};
  function textDialog(L, at) {
    var spec = L ? L.tx : { s: "", f: "sans", z: Math.max(12, Math.round(Math.min(st.doc.w, st.doc.h) / 12)), c: st.fg, a: "l", b: 0, i: 0, lh: 120 };
    var ta = el("textarea"); ta.rows = 4; ta.value = spec.s; ta.maxLength = 5000;
    var font = select(PL.view.FONT_IDS.map(function (f) { return [f, t("font." + f)]; }), spec.f);
    var size = numIn(spec.z, 4, 2000), color = el("input"); color.type = "color"; color.value = spec.c;
    var align = select([["l", t("align.l")], ["c", t("align.c")], ["r", t("align.r")]], spec.a);
    var bold = check(t("f.bold"), spec.b), ital = check(t("f.italic"), spec.i);
    PL.dialog({
      title: t(L ? "dlg.editText" : "dlg.text"), ok: t(L ? "btn.save" : "btn.add"),
      body: [field(t("f.text"), ta), el2("div", "row2", [field(t("f.font"), font), field(t("f.size"), size)]),
             el2("div", "row2", [field(t("f.color"), color), field(t("f.align"), align)]), el2("div", "row2", [bold, ital])],
      onOk: function () {
        var s = C.cleanText(ta.value);
        if (!s.trim()) { PL.toast(t("msg.noText")); return false; }
        var nx = { s: s, f: font.value, z: Math.round(+size.value) || 72, c: color.value, a: align.value,
                   b: bold.input.checked ? 1 : 0, i: ital.input.checked ? 1 : 0, lh: spec.lh };
        if (L) {
          PL.docChange(t("step.editText"), function () { L.tx = C.normLayer({ id: L.id, k: "text", tx: nx }).tx; L.name = C.cleanName(s.split("\n")[0]) || L.name; }, []);
        } else {
          PL.addLayer({ k: "text", name: C.cleanName(s.split("\n")[0]) || t("layer.text"), x: at.x, y: at.y, tx: nx }, t("step.text"));
        }
      }
    });
  }
  PL.panels.textDialog = textDialog;

  function exportDialog(toPictures) {
    var d = st.doc;
    var fmt = select([["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"], ["psd", t("fmt.psd")], ["ora", t("fmt.ora")]], pr().exportFmt);
    var q = range(t("f.quality"), pr().exportQ, 10, 100);
    var scale = numIn(100, 1, 400), scaleF = field(t("f.scalePct"), scale);
    var size = el("p", "hint"), jpg = hint(t("hint.jpg")), layered = hint(t("hint.layered"));
    function upd() {
      var lay = fmt.value === "psd" || fmt.value === "ora";
      q.hidden = fmt.value === "png" || lay;
      scaleF.hidden = lay;
      jpg.hidden = fmt.value !== "jpg";
      layered.hidden = !lay;
      var k = lay ? 1 : Math.max(1, +scale.value || 100) / 100;
      size.textContent = t("export.size", { w: Math.max(1, Math.round(d.w * k)), h: Math.max(1, Math.round(d.h * k)) });
    }
    fmt.addEventListener("change", upd); scale.addEventListener("input", upd); upd();
    var body = [field(t("f.format"), fmt), q, scaleF, size, jpg, layered];
    PL.dialog({
      title: t(toPictures ? "dlg.toPictures" : "dlg.export"), ok: t(toPictures ? "btn.save" : "btn.export"), body: body,
      onOk: function () {
        pr().exportFmt = fmt.value; pr().exportQ = +q.input.value; PL.savePrefs();
        var k = Math.max(1, Math.min(400, +scale.value || 100)) / 100;
        PL.io.exportImage(fmt.value, +q.input.value / 100, k, toPictures);
      }
    });
  }

  // Adjustments with a live preview of the active layer.
  var adjPreview = null;
  function adjustDialog(kind) {
    var tg = ops().adjustTarget();
    if (!tg) return;
    var p = {}, body = [], seq = 0, timer = null;
    function preview() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var my = ++seq;
        ops().adjusted(tg, kind === "looks" ? "preset" : kind, p).then(function (img) {
          if (my !== seq || !adjPreview) return;
          var c = PL.view.canvas(img.w, img.h);
          c.getContext("2d").putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
          adjPreview.cv = c; PL.view.invalidate();
        });
      }, 60);
    }
    function slider(key, label, v, min, max) {
      p[key] = v;
      body.push(range(label, v, min, max, function (x) { p[key] = x; preview(); }));
    }
    if (kind === "fx") FX.ADJUST.forEach(function (a) { slider(a.id, t("adj." + a.id), 0, a.min, a.max); });
    else if (kind === "hsl") { slider("h", t("adj.hue"), 0, -180, 180); slider("s", t("adj.sat"), 0, -100, 100); slider("l", t("adj.light"), 0, -100, 100); }
    else if (kind === "levels") {
      slider("ib", t("adj.inBlack"), 0, 0, 254); slider("iw", t("adj.inWhite"), 255, 1, 255);
      p.g = 1;
      body.push(range(t("adj.gamma"), 100, 10, 300, function (x) { p.g = x / 100; preview(); }));
      slider("ob", t("adj.outBlack"), 0, 0, 255); slider("ow", t("adj.outWhite"), 255, 0, 255);
      body.unshift(histogram(tg.img));
    } else if (kind === "threshold") slider("t", t("adj.threshold"), 128, 0, 255);
    else if (kind === "posterize") slider("n", t("adj.levels"), 4, 2, 32);
    else if (kind === "looks") {
      var grid = el("div", "looks");
      p.id = "none";
      FX.FILTERS.forEach(function (f) {
        var b = el("button", "chip" + (f.id === "none" ? " on" : ""), f[PL.LANG] || f.en);
        b.type = "button";
        b.addEventListener("click", function () {
          p.id = f.id;
          [].forEach.call(grid.children, function (c) { c.classList.toggle("on", c === b); });
          preview();
        });
        grid.appendChild(b);
      });
      body.push(grid);
    }
    adjPreview = { L: tg.L, r: tg.r, cv: null };
    PL.dialog({
      title: t("adjk." + kind), ok: t("btn.apply"), body: body, wide: kind === "fx",
      onOk: function () { adjPreview = null; ops().applyAdjust(tg, kind === "looks" ? "preset" : kind, p, t("adjk." + kind)); },
      onCancel: function () { adjPreview = null; PL.view.invalidate(); }
    });
  }
  function histogram(img) {
    var h = PL.A.histogram(img), c = PL.view.canvas(256, 60), g = c.getContext("2d"), mx = 1;
    for (var i = 0; i < 256; i++) mx = Math.max(mx, h[i]);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-dim") || "#999";
    for (var j = 0; j < 256; j++) { var v = Math.round(h[j] / mx * 60); g.fillRect(j, 60 - v, 1, v); }
    c.className = "histo";
    return c;
  }
  // The adjustment preview replaces the target area while the dialog is open.
  var basePreview = null;
  function hookPreview() {
    basePreview = PL.tools.preview;
    PL.tools.preview = function (L, g) {
      if (adjPreview && adjPreview.cv && adjPreview.L === L) {
        PL.view.drawLayer(g, L, null);
        g.save();
        g.clearRect(adjPreview.r.x, adjPreview.r.y, adjPreview.r.w, adjPreview.r.h);
        g.drawImage(adjPreview.cv, adjPreview.r.x, adjPreview.r.y);
        g.restore();
        return true;
      }
      return basePreview(L, g);
    };
  }

  // ---------- Menus ----------
  function has() { return !!st.doc; }
  function hasSel() { return !!st.sel; }
  // Browsers keep Ctrl+N, Ctrl+T and Ctrl+Shift+N, so New, Free
  // transform and New layer use Alt instead.
  var MENUS = [
    { id: "file", items: [
      { id: "new", k: "Alt+N", run: newDialog },
      { id: "open", k: "Ctrl+O", run: function () { PL.io.openPicture(false); } },
      { id: "place", run: function () { PL.io.openPicture(true); }, on: has },
      { id: "projects", run: function () { PL.closeProject(); } , on: has },
      "-",
      { id: "rename", run: renameDialog, on: has },
      { id: "export", k: "Ctrl+Shift+S", run: function () { exportDialog(false); }, on: has },
      { id: "toPictures", run: function () { exportDialog(true); }, on: has },
      { id: "wallpaper", run: function () { PL.io.setWallpaper(); }, on: function () { return has() && PL.io.canWallpaper(); } }
    ] },
    { id: "edit", items: [
      { id: "undo", k: "Ctrl+Z", run: function () { PL.undo(); }, on: function () { return st.hist.canUndo(); } },
      { id: "redo", k: "Ctrl+Shift+Z", run: function () { PL.redo(); }, on: function () { return st.hist.canRedo(); } },
      "-",
      { id: "cut", k: "Ctrl+X", run: function () { ops().copy(true); }, on: has },
      { id: "copy", k: "Ctrl+C", run: function () { ops().copy(false); }, on: has },
      { id: "paste", k: "Ctrl+V", run: function () { PL.io.pasteFromMenu(); } },
      { id: "clear", k: "Delete", run: function () { ops().clearSel(); }, on: hasSel },
      { id: "fill", run: function () { ops().fillSel(st.fg); }, on: has },
      "-",
      { id: "transform", k: "Alt+T", run: function () { PL.tools.startTransform(); }, on: has }
    ] },
    { id: "image", items: [
      { id: "resize", k: "Ctrl+Alt+I", run: resizeDialog, on: has },
      { id: "canvas", k: "Ctrl+Alt+C", run: canvasDialog, on: has },
      "-",
      { id: "rotCw", run: function () { ops().rotateImage(1); }, on: has },
      { id: "rotCcw", run: function () { ops().rotateImage(3); }, on: has },
      { id: "rot180", run: function () { ops().rotateImage(2); }, on: has },
      { id: "rotAny", run: rotateDialog, on: has },
      { id: "flipH", run: function () { ops().flipImage(true); }, on: has },
      { id: "flipV", run: function () { ops().flipImage(false); }, on: has },
      "-",
      { id: "cropSel", run: function () { ops().cropToSel(); }, on: hasSel },
      { id: "trim", run: function () { ops().trim(); }, on: has }
    ] },
    { id: "layer", items: [
      { id: "newLayer", k: "Alt+Shift+N", run: function () { ops().newLayer(); }, on: has },
      { id: "duplicate", run: function () { ops().duplicate(); }, on: has },
      { id: "viaCopy", k: "Ctrl+J", run: function () { ops().viaCopy(false); }, on: has },
      { id: "viaCut", k: "Ctrl+Shift+J", run: function () { ops().viaCopy(true); }, on: hasSel },
      { id: "deleteLayer", run: function () { ops().remove(); }, on: has },
      "-",
      { id: "layerFlipH", run: function () { ops().layerFlip(true); }, on: has },
      { id: "layerFlipV", run: function () { ops().layerFlip(false); }, on: has },
      { id: "layerRotCw", run: function () { ops().layerRotate(1); }, on: has },
      { id: "layerRotCcw", run: function () { ops().layerRotate(3); }, on: has },
      { id: "rasterize", run: function () { var L = PL.layer(); if (L && L.k !== "raster") ops().rasterize(L); else PL.toast(t("msg.alreadyRaster")); }, on: has },
      "-",
      { id: "mergeDown", k: "Ctrl+E", run: function () { ops().mergeDown(); }, on: has },
      { id: "flatten", run: function () { ops().flatten(); }, on: has }
    ] },
    { id: "select", items: [
      { id: "selectAll", k: "Ctrl+A", run: function () { ops().selectAll(); }, on: has },
      { id: "deselect", k: "Ctrl+D", run: function () { ops().deselect(); }, on: hasSel },
      { id: "invertSel", k: "Ctrl+Shift+I", run: function () { ops().invertSel(); }, on: hasSel },
      { id: "selLayer", run: function () { ops().selectLayerPixels(); }, on: has },
      "-",
      { id: "feather", run: function () { numberDialog(t("dlg.feather"), t("f.radius"), 10, 1, 250, ops().featherSel); }, on: hasSel },
      { id: "grow", run: function () { numberDialog(t("dlg.grow"), t("f.pixels"), 5, 1, 100, ops().growSel); }, on: hasSel },
      { id: "shrink", run: function () { numberDialog(t("dlg.shrink"), t("f.pixels"), 5, 1, 100, function (n) { ops().growSel(-n); }); }, on: hasSel }
    ] },
    { id: "adjust", items: [
      { id: "adjFx", run: function () { adjustDialog("fx"); }, on: has },
      { id: "adjLooks", run: function () { adjustDialog("looks"); }, on: has },
      { id: "adjHsl", k: "Ctrl+U", run: function () { adjustDialog("hsl"); }, on: has },
      { id: "adjLevels", k: "Ctrl+L", run: function () { adjustDialog("levels"); }, on: has },
      "-",
      { id: "adjInvert", k: "Ctrl+I", run: function () { ops().quickAdjust("invert", {}, t("menu.adjInvert")); }, on: has },
      { id: "adjGray", k: "Ctrl+Shift+U", run: function () { ops().quickAdjust("gray", {}, t("menu.adjGray")); }, on: has },
      { id: "adjThreshold", run: function () { adjustDialog("threshold"); }, on: has },
      { id: "adjPosterize", run: function () { adjustDialog("posterize"); }, on: has }
    ] },
    { id: "view", items: [
      { id: "zoomIn", k: "Ctrl+=", run: function () { PL.view.zoomStep(1); }, on: has },
      { id: "zoomOut", k: "Ctrl+-", run: function () { PL.view.zoomStep(-1); }, on: has },
      { id: "fit", k: "Ctrl+0", run: function () { PL.view.fit(); }, on: has },
      { id: "actual", k: "Ctrl+1", run: function () { var s = PL.view.size(); PL.view.zoomAt(1, s.w / 2, s.h / 2); }, on: has },
      "-",
      { id: "panel", run: function () { setPanel(!document.body.classList.contains("side-open")); } },
      { id: "help", run: function () { openHelp(); } }
    ] }
  ];
  function openHelp() {
    try { if (window.parent.orosHelp) { window.parent.orosHelp.open("a/photolab"); return; } } catch (e) {}
    PL.toast(t("msg.noHelp"));
  }
  function keyLabel(k) {
    if (!k) return "";
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    return mac ? k.replace("Ctrl+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧") : k;
  }

  var openMenu = null;
  function closeMenus() {
    if (!openMenu) return;
    openMenu.pop.remove();
    openMenu.btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", openMenu.away, true);
    openMenu = null;
  }
  function menuItems(m, onPick) {
    var list = el("div", "menu-list");
    list.setAttribute("role", "menu");
    m.items.forEach(function (it) {
      if (it === "-") { list.appendChild(el("hr")); return; }
      var b = el("button", "menu-item");
      b.type = "button"; b.setAttribute("role", "menuitem");
      b.appendChild(el("span", "mi-l", t("menu." + it.id)));
      if (it.k && !PL.phone) b.appendChild(el("span", "mi-k", keyLabel(it.k)));
      b.disabled = it.on ? !it.on() : false;
      b.addEventListener("click", function () { onPick(); it.run(); });
      list.appendChild(b);
    });
    return list;
  }
  function showMenu(m, btn) {
    var again = openMenu && openMenu.btn === btn;
    closeMenus();
    if (again) return;
    var pop = el("div", "menu-pop");
    pop.appendChild(menuItems(m, closeMenus));
    document.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + "px";
    pop.style.top = r.bottom + 2 + "px";
    btn.setAttribute("aria-expanded", "true");
    var away = function (e) { if (!pop.contains(e.target) && e.target !== btn) closeMenus(); };
    document.addEventListener("pointerdown", away, true);
    openMenu = { pop: pop, btn: btn, away: away };
    var f = pop.querySelector("button:not(:disabled)"); if (f) f.focus();
  }
  // Phone: every menu in one sheet.
  function showAllMenus() {
    var body = [];
    MENUS.forEach(function (m) {
      var sec = el("details", "menu-sec");
      sec.appendChild(el("summary", "", t("menuh." + m.id)));
      sec.appendChild(menuItems(m, function () { dlg.close("ok"); }));
      body.push(sec);
    });
    var dlg = PL.dialog({ title: t("btn.menu"), body: body, ok: null });
  }

  // ---------- Tool bar + options ----------
  function toolIcon(id) {
    if (id === "marquee" && pr().marqueeEllipse) return ICON.marqueeE;
    return ICON[id];
  }
  function renderTools() {
    var box = $("tools");
    box.innerHTML = "";
    PL.tools.ORDER.forEach(function (id) {
      var b = el("button", "tool" + (st.tool === id ? " on" : ""));
      b.type = "button"; b.innerHTML = toolIcon(id);
      PL.setLabel(b, t("tool." + id) + (TOOL_KEYS[id] ? " (" + TOOL_KEYS[id].toUpperCase() + ")" : ""));
      b.setAttribute("aria-pressed", st.tool === id ? "true" : "false");
      b.addEventListener("click", function () { PL.setTool(id); });
      box.appendChild(b);
    });
    var cols = el("div", "colors");
    var fg = el("input", "sw fg"); fg.type = "color"; fg.value = st.fg; PL.setLabel(fg, t("f.fg"));
    var bg = el("input", "sw bg"); bg.type = "color"; bg.value = st.bg; PL.setLabel(bg, t("f.bg"));
    fg.addEventListener("input", function () { st.fg = fg.value; PL.emit("colors"); });
    bg.addEventListener("input", function () { st.bg = bg.value; PL.emit("colors"); });
    var sw = el("button", "icon-btn small"); sw.type = "button"; sw.innerHTML = ICON.swap; PL.setLabel(sw, t("btn.swap"));
    sw.addEventListener("click", swapColors);
    cols.appendChild(fg); cols.appendChild(bg); cols.appendChild(sw);
    box.appendChild(cols);
  }
  function swapColors() { var x = st.fg; st.fg = st.bg; st.bg = x; PL.emit("colors"); renderTools(); }
  var TOOL_KEYS = { move: "v", marquee: "m", lasso: "l", wand: "w", crop: "c", brush: "b", eraser: "e", fill: "g", gradient: "", picker: "i", text: "t", shape: "u", hand: "h", zoom: "z" };

  PL.setTool = function (id, internal) {
    if (st.tool === id && !internal) {
      // A second press switches the variant (Photoshop's tool groups).
      if (id === "marquee") { pr().marqueeEllipse = !pr().marqueeEllipse; PL.savePrefs(); renderTools(); renderOptions(); }
      else if (id === "lasso") { pr().lassoPoly = !pr().lassoPoly; PL.savePrefs(); renderOptions(); }
      return;
    }
    if (st.tool === "transform" && !internal && PL.tools.transforming()) PL.tools.endTransform(true);
    PL.tools.cancel();
    PL.tools.leave(st.tool);
    st.tool = id;
    if (id !== "transform") PL.tools.enter(id);
    $("cv").style.cursor = PL.tools.cursor();
    PL.savePrefs();
    renderTools(); renderOptions();
    PL.view.schedule();
    PL.live(t("tool." + id));
  };

  function optRange(label, obj, key, min, max) {
    var w = el("label", "opt");
    w.appendChild(el("span", "opt-l", label));
    var i = el("input"); i.type = "range"; i.min = String(min); i.max = String(max); i.value = String(obj[key]);
    var n = el("input", "opt-n"); n.type = "number"; n.min = String(min); n.max = String(max); n.value = String(obj[key]);
    i.addEventListener("input", function () { obj[key] = +i.value; n.value = i.value; PL.savePrefs(); PL.view.schedule(); });
    n.addEventListener("change", function () { var v = Math.max(min, Math.min(max, Math.round(+n.value) || min)); obj[key] = v; i.value = n.value = String(v); PL.savePrefs(); });
    w.appendChild(i); w.appendChild(n);
    return w;
  }
  function optCheck(label, obj, key, after) {
    var w = el("label", "opt chk"), i = el("input");
    i.type = "checkbox"; i.checked = !!obj[key];
    i.addEventListener("change", function () { obj[key] = i.checked; PL.savePrefs(); if (after) after(); });
    w.appendChild(i); w.appendChild(el("span", "", label));
    return w;
  }
  function optSelect(label, options, v, on) {
    var w = el("label", "opt");
    w.appendChild(el("span", "opt-l", label));
    var s = select(options, v);
    s.addEventListener("change", function () { on(s.value); PL.savePrefs(); });
    w.appendChild(s);
    return w;
  }
  function optButton(label, run, primary) {
    var b = el("button", "btn small" + (primary ? " primary" : ""), label);
    b.type = "button"; b.addEventListener("click", run);
    return b;
  }
  function selModeOpt() {
    return optSelect(t("f.selMode"), [["replace", t("sel.replace")], ["add", t("sel.add")], ["sub", t("sel.sub")], ["and", t("sel.and")]],
      pr().selMode, function (v) { pr().selMode = v; });
  }
  function renderOptions() {
    var box = $("opts"), P = pr(), id = st.tool;
    box.innerHTML = "";
    box.appendChild(el("span", "opt-title", t("tool." + id)));
    if (id === "brush" || id === "eraser") {
      box.appendChild(optRange(t("f.size"), P[id], "size", 1, 1000));
      box.appendChild(optRange(t("f.hardness"), P[id], "hard", 1, 100));
      box.appendChild(optRange(t("f.opacity"), P[id], "opacity", 1, 100));
      box.appendChild(optRange(t("f.flow"), P[id], "flow", 1, 100));
      if (id === "brush") box.appendChild(optCheck(t("f.lockAlpha"), P.brush, "lockAlpha"));
    } else if (id === "marquee") {
      box.appendChild(optSelect(t("f.shape"), [["rect", t("sel.rect")], ["ellipse", t("sel.ellipse")]], P.marqueeEllipse ? "ellipse" : "rect",
        function (v) { P.marqueeEllipse = v === "ellipse"; renderTools(); }));
      box.appendChild(selModeOpt());
      box.appendChild(optRange(t("f.feather"), P, "feather", 0, 100));
    } else if (id === "lasso") {
      box.appendChild(optSelect(t("f.lassoKind"), [["free", t("lasso.free")], ["poly", t("lasso.poly")]], P.lassoPoly ? "poly" : "free",
        function (v) { P.lassoPoly = v === "poly"; }));
      box.appendChild(selModeOpt());
      box.appendChild(optRange(t("f.feather"), P, "feather", 0, 100));
      if (P.lassoPoly) box.appendChild(el("span", "opt-hint", t("hint.poly")));
    } else if (id === "wand") {
      box.appendChild(selModeOpt());
      box.appendChild(optRange(t("f.tolerance"), P.wand, "tol", 0, 255));
      box.appendChild(optCheck(t("f.contiguous"), P.wand, "contiguous"));
      box.appendChild(optCheck(t("f.allLayers"), P.wand, "all"));
    } else if (id === "fill") {
      box.appendChild(optRange(t("f.tolerance"), P.fill, "tol", 0, 255));
      box.appendChild(optRange(t("f.opacity"), P.fill, "opacity", 1, 100));
      box.appendChild(optCheck(t("f.contiguous"), P.fill, "contiguous"));
      box.appendChild(optCheck(t("f.allLayers"), P.fill, "all"));
    } else if (id === "gradient") {
      box.appendChild(optSelect(t("f.gradType"), [["linear", t("grad.linear")], ["radial", t("grad.radial")]], P.gradient.type,
        function (v) { P.gradient.type = v; }));
      box.appendChild(optRange(t("f.opacity"), P.gradient, "opacity", 1, 100));
      box.appendChild(optCheck(t("f.toClear"), P.gradient, "toClear"));
    } else if (id === "crop") {
      var ratios = [["free", t("crop.free")], ["orig", t("crop.orig")], ["1:1", "1:1"], ["4:3", "4:3"], ["3:2", "3:2"], ["16:9", "16:9"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"]];
      box.appendChild(optSelect(t("f.ratio"), ratios, P.cropRatio, function (v) { P.cropRatio = v; }));
      box.appendChild(optButton(t("btn.applyCrop"), function () { PL.tools.applyCrop(); }, true));
    } else if (id === "shape") {
      box.appendChild(optSelect(t("f.shape"), FX.SHAPES.map(function (s) { return [s.id, s[PL.LANG] || s.en]; }), P.shape.id,
        function (v) { P.shape.id = v; }));
      box.appendChild(optCheck(t("f.noFill"), P.shape, "noFill"));
      box.appendChild(optCheck(t("f.strokeBg"), P.shape, "stroke"));
      box.appendChild(optRange(t("f.strokeW"), P.shape, "sw", 1, 100));
    } else if (id === "transform") {
      box.appendChild(el("span", "opt-hint", t("hint.transform")));
      box.appendChild(optButton(t("btn.apply"), function () { PL.tools.endTransform(true); }, true));
      box.appendChild(optButton(t("btn.cancel"), function () { PL.tools.endTransform(false); }));
    } else if (id === "text") {
      box.appendChild(el("span", "opt-hint", t("hint.text")));
    } else if (id === "picker") {
      box.appendChild(el("span", "opt-hint", t("hint.picker")));
    } else if (id === "move") {
      box.appendChild(el("span", "opt-hint", t(st.sel ? "hint.moveSel" : "hint.move")));
      box.appendChild(optButton(t("menu.transform"), function () { PL.tools.startTransform(); }));
    } else if (id === "zoom" || id === "hand") {
      box.appendChild(optButton(t("menu.fit"), function () { PL.view.fit(); }));
      box.appendChild(optButton("100%", function () { var s = PL.view.size(); PL.view.zoomAt(1, s.w / 2, s.h / 2); }));
    }
  }

  // ---------- Side panel: layers + history ----------
  function setPanel(open) {
    document.body.classList.toggle("side-open", open);
    $("panel-btn").setAttribute("aria-expanded", open ? "true" : "false");
    pr().panelOpen = open; PL.savePrefs();
    setTimeout(function () { PL.view.resize(); }, 0);
  }
  function setTab(id) {
    pr().panel = id; PL.savePrefs();
    ["layers", "history"].forEach(function (k) {
      $("tab-" + k).setAttribute("aria-selected", k === id ? "true" : "false");
      $("pane-" + k).hidden = k !== id;
    });
  }
  var thumbs = {};
  function layerThumb(L) {
    var d = st.doc, k = 40 / Math.max(d.w, d.h);
    var c = PL.view.canvas(Math.max(1, Math.round(d.w * k)), Math.max(1, Math.round(d.h * k)));
    var g = c.getContext("2d");
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingQuality = "low";
    PL.view.drawLayer(g, L, null);
    return c;
  }
  var layersTimer = null;
  function renderLayersSoon() { clearTimeout(layersTimer); layersTimer = setTimeout(renderLayers, 250); }
  function renderLayers() {
    clearTimeout(layersTimer);
    var list = $("layer-list");
    list.innerHTML = "";
    if (!st.doc) return;
    var A = PL.layer();
    st.doc.layers.slice().reverse().forEach(function (L) {
      var row = el("li", "lrow" + (A && A.id === L.id ? " on" : ""));
      var eye = el("button", "icon-btn small"); eye.type = "button";
      eye.innerHTML = L.vis ? ICON.eye : ICON.eyeOff; PL.setLabel(eye, t(L.vis ? "btn.hide" : "btn.show"));
      eye.addEventListener("click", function (e) { e.stopPropagation(); ops().setProp(L, "vis", L.vis ? 0 : 1, t(L.vis ? "step.hide" : "step.show")); });
      var th = el("span", "lthumb"); th.appendChild(layerThumb(L));
      var name = el("button", "lname", L.name); name.type = "button";
      if (L.k !== "raster") name.appendChild(el("span", "lkind", t("kind." + L.k)));
      name.addEventListener("click", function () { PL.selectLayer(L.id); });
      name.addEventListener("dblclick", function () { if (L.k === "text") textDialog(L); else renameLayer(L); });
      var lock = el("button", "icon-btn small"); lock.type = "button";
      lock.innerHTML = L.lock ? ICON.lock : ICON.unlock; PL.setLabel(lock, t(L.lock ? "btn.unlock" : "btn.lock"));
      lock.classList.toggle("dim", !L.lock);
      lock.addEventListener("click", function (e) { e.stopPropagation(); ops().setProp(L, "lock", L.lock ? 0 : 1, t(L.lock ? "step.unlock" : "step.lock")); });
      row.appendChild(eye); row.appendChild(th); row.appendChild(name); row.appendChild(lock);
      list.appendChild(row);
    });
    // Active layer properties.
    var bl = $("blend-sel"), op = $("opacity-in");
    bl.innerHTML = "";
    C.BLENDS.forEach(function (b) { var o = el("option", "", b[PL.LANG] || b.en); o.value = b.id; bl.appendChild(o); });
    if (A) { bl.value = A.bl; op.value = String(A.op); $("opacity-out").textContent = A.op + "%"; }
    bl.disabled = op.disabled = !A;
  }
  function renderHistory() {
    var list = $("history-list"), h = st.hist.list();
    list.innerHTML = "";
    var mk = function (label, n, on, undone) {
      var b = el("button", "hrow" + (on ? " on" : "") + (undone ? " undone" : ""), label);
      b.type = "button";
      b.addEventListener("click", function () {
        if (PL.tools.busy()) return;
        if (PL.tools.transforming()) PL.tools.endTransform(false);
        st.hist.goTo(n); PL.emit("history");
      });
      var li = el("li"); li.appendChild(b); list.appendChild(li);
    };
    mk(t("hist.open"), 0, h.done.length === 0, false);
    h.done.forEach(function (l, i) { mk(l, i + 1, i === h.done.length - 1, false); });
    h.undone.forEach(function (l, i) { mk(l, h.done.length + i + 1, false, true); });
    $("undo-btn").disabled = !st.hist.canUndo();
    $("redo-btn").disabled = !st.hist.canRedo();
  }
  function renderHead() {
    if (!st.doc) return;
    $("doc-title").textContent = st.doc.name;
    $("status-size").textContent = st.doc.w + " × " + st.doc.h + " px";
    var s = $("save-state");
    var fs = PL.fs();
    s.textContent = !fs ? t("save.noDisk") : st.saving ? t("save.saving") : st.dirty ? t("save.pending") : st.fresh ? t("save.new") : t("save.saved");
    s.classList.toggle("warn", !fs);
  }
  function renderZoom() {
    $("zoom-btn").textContent = Math.round(PL.view.state().z * 100) + "%";
  }

  // ---------- Keyboard ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && ["range", "checkbox", "color", "button"].indexOf(tg.type) < 0 || tag === "TEXTAREA" || tag === "SELECT";
  }
  var SHORTCUTS = {};
  MENUS.forEach(function (m) { m.items.forEach(function (it) { if (it !== "-" && it.k) SHORTCUTS[it.k.toLowerCase()] = it; }); });
  function comboOf(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    if (e.code === "Equal" || k === "+") k = "=";
    if (e.code === "Minus") k = "-";
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();       // Greek layout too (R12 spirit)
    if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    return (e.ctrlKey || e.metaKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "") + (e.shiftKey ? "shift+" : "") + k;
  }
  function wireKeys() {
    // Contract Β: Ctrl+Alt+Shift shortcuts belong to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function" && p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && openMenu) { closeMenus(); return; }
      if (!st.doc) {
        var c0 = comboOf(e);
        if (c0 === "alt+n" || c0 === "ctrl+o" || c0 === "ctrl+v") { if (c0 !== "ctrl+v") e.preventDefault(); if (c0 !== "ctrl+v") SHORTCUTS[c0].run(); }
        return;
      }
      if (typing(e)) return;
      if (e.code === "Space" && !e.repeat) { PL.tools.space(true); $("cv").style.cursor = "grab"; e.preventDefault(); return; }
      if (PL.tools.key(e)) { e.preventDefault(); return; }
      var combo = comboOf(e);
      if (combo === "ctrl+y") combo = "ctrl+shift+z";
      if (combo === "backspace") combo = "delete";
      var it = SHORTCUTS[combo];
      if (it) {
        if (combo === "ctrl+v" || combo === "ctrl+c" || combo === "ctrl+x") {
          // Let the browser's paste event bring system pictures; copy
          // and cut also go through the menu commands.
          if (combo !== "ctrl+v") { e.preventDefault(); it.run(); }
          return;
        }
        e.preventDefault();
        if (!it.on || it.on()) it.run();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = combo;
      if (k === "x") { swapColors(); return; }
      if (k === "d") { st.fg = "#000000"; st.bg = "#ffffff"; PL.emit("colors"); renderTools(); return; }
      if (k === "[" || k === "]") {
        var o = PL.prefs[st.tool === "eraser" ? "eraser" : "brush"];
        o.size = Math.max(1, Math.min(1000, Math.round(o.size * (k === "]" ? 1.2 : 1 / 1.2)) + (k === "]" ? 1 : -1)));
        PL.savePrefs(); renderOptions(); PL.view.schedule(); return;
      }
      if (k === "shift+g") { PL.setTool(st.tool === "gradient" ? "fill" : "gradient", true); return; }
      for (var id in TOOL_KEYS) {
        if (TOOL_KEYS[id] && TOOL_KEYS[id] === k) { e.preventDefault(); PL.setTool(id); return; }
      }
    });
    document.addEventListener("keyup", function (e) {
      if (e.code === "Space") { PL.tools.space(false); $("cv").style.cursor = PL.tools.cursor(); }
    });
  }

  // ---------- Build ----------
  function build() {
    hookPreview();
    $("home-btn").innerHTML = ICON.home; PL.setLabel($("home-btn"), t("btn.projects"));
    $("home-btn").addEventListener("click", function () { PL.closeProject(); });
    $("menu-btn").innerHTML = ICON.menu; PL.setLabel($("menu-btn"), t("btn.menu"));
    $("menu-btn").addEventListener("click", showAllMenus);
    $("undo-btn").innerHTML = ICON.undo; PL.setLabel($("undo-btn"), t("menu.undo"));
    $("redo-btn").innerHTML = ICON.redo; PL.setLabel($("redo-btn"), t("menu.redo"));
    $("undo-btn").addEventListener("click", function () { PL.undo(); });
    $("redo-btn").addEventListener("click", function () { PL.redo(); });
    $("panel-btn").innerHTML = ICON.layers; PL.setLabel($("panel-btn"), t("btn.panel"));
    $("panel-btn").addEventListener("click", function () { setPanel(!document.body.classList.contains("side-open")); });
    $("doc-title").addEventListener("click", renameDialog);
    var bar = $("menubar");
    MENUS.forEach(function (m) {
      var b = el("button", "menu-btn", t("menuh." + m.id));
      b.type = "button"; b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", function () { showMenu(m, b); });
      b.addEventListener("pointerenter", function () { if (openMenu && openMenu.btn !== b) showMenu(m, b); });
      bar.appendChild(b);
    });
    ["layers", "history"].forEach(function (k) {
      $("tab-" + k).textContent = t("tab." + k);
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    var acts = [["add-layer", ICON.plus, "btn.newLayer", function () { ops().newLayer(); }],
                ["dup-layer", ICON.dup, "btn.duplicate", function () { ops().duplicate(); }],
                ["up-layer", ICON.up, "btn.up", function () { ops().moveBy(1); }],
                ["down-layer", ICON.down, "btn.down", function () { ops().moveBy(-1); }],
                ["merge-layer", ICON.merge, "btn.merge", function () { ops().mergeDown(); }],
                ["del-layer", ICON.del, "btn.deleteLayer", function () { ops().remove(); }]];
    acts.forEach(function (a) {
      var b = $(a[0]); b.innerHTML = a[1]; PL.setLabel(b, t(a[2])); b.addEventListener("click", a[3]);
    });
    $("blend-lbl").textContent = t("f.blend"); $("opacity-lbl").textContent = t("f.opacity");
    $("blend-sel").addEventListener("change", function () { var L = PL.layer(); if (L) ops().setProp(L, "bl", $("blend-sel").value, t("step.blend")); });
    var opStart = null;
    $("opacity-in").addEventListener("input", function () {
      var L = PL.layer(); if (!L) return;
      if (opStart === null) opStart = { L: L, json: JSON.stringify(st.doc) };
      L.op = +$("opacity-in").value; $("opacity-out").textContent = L.op + "%"; PL.view.invalidate();
    });
    $("opacity-in").addEventListener("change", function () {
      if (!opStart) return;
      var s0 = opStart; opStart = null;
      PL.pushStep(PL.H.docStep(t("step.opacity"), s0.json, JSON.stringify(st.doc), PL.setDocRecord));
      PL.changed();
    });
    $("zoom-btn").addEventListener("click", function () { PL.view.fit(); });
    PL.setLabel($("zoom-btn"), t("menu.fit"));
    $("zoom-in").innerHTML = ICON.plus; PL.setLabel($("zoom-in"), t("menu.zoomIn"));
    $("zoom-out").innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
    PL.setLabel($("zoom-out"), t("menu.zoomOut"));
    $("zoom-in").addEventListener("click", function () { PL.view.zoomStep(1); });
    $("zoom-out").addEventListener("click", function () { PL.view.zoomStep(-1); });

    PL.on("layers", renderLayers);
    PL.on("doc", function () { renderHead(); renderLayersSoon(); });
    PL.on("history", function () { renderHistory(); renderLayersSoon(); });
    PL.on("dirty", renderHead);
    PL.on("view", renderZoom);
    PL.on("colors", renderTools);
    PL.on("tool", function () { renderTools(); renderOptions(); });
    PL.on("sel", function () { if (st.tool === "move") renderOptions(); });
    PL.on("pointer", function (p) {
      var s = $("status-pos");
      if (s) s.textContent = Math.floor(p.x) + ", " + Math.floor(p.y);
    });
    wireKeys();
    document.body.classList.toggle("side-open", !!pr().panelOpen);
    $("panel-btn").setAttribute("aria-expanded", pr().panelOpen ? "true" : "false");
    setTab(pr().panel === "history" ? "history" : "layers");
    renderTools(); renderOptions();
    PL.home.build();
    PL.io.wire();
  }

  PL.panels.build = build;
  PL.panels.newDialog = newDialog;
  PL.panels.exportDialog = exportDialog;
  PL.panels.MENUS = MENUS;

  // panels.js loads last: every module is in place.
  PL.boot();
})();
