// ============================================================
// orOS Layout — Start here (LY-N1, v1.0.0)
// The guided New book (home: "New book", New document › "A book, step
// by step"): four steps on one dialog: 1 what kind of book (twelve
// starters of our own, layout/starters.js), 2 the trim and margins,
// 3 the type pair, 4 the book's details and its first pages, each step
// with a live picture of the opening pages. Also the one-time hints
// (LY.hint: a line under the toolbar until "Got it", remembered per
// device in Layout's prefs) and the Learn tab of the side panel: the
// basics, each with a button that shows the place in Layout.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, R = LY.R, t = LY.t, el = LY.el, S = window.LY_START;
  var MM = 72 / 25.4;
  var HINTS = { start: 1, editor: 1, master: 1 };

  // a style's name in both of Layout's languages (model names are { en, el })
  function names(key) {
    var en = (LY.STRINGS.en && LY.STRINGS.en[key]) || key, gr = (LY.STRINGS.el && LY.STRINGS.el[key]) || en;
    return { en: en, el: gr };
  }
  function mmText(v) { return String(Math.round(v * 10) / 10).replace(".", LY.BASE === "el" ? "," : "."); }

  // ---------- hints ----------
  function seen() {
    var h = LY.prefs.hints;
    return h && typeof h === "object" ? h : {};
  }
  function hint(key) {
    if (!HINTS[key] || seen()[key] || !LY.doc) return false;
    var host = LY.$("stage");
    if (!host) return false;
    var old = host.querySelector(".hint-bar");
    if (old) old.remove();
    var bar = el("div", "banner hint-bar");
    bar.setAttribute("role", "status");
    bar.appendChild(el("span", "", t("hint." + key)));
    var ok = el("button", "btn small", t("hint.ok"));
    ok.type = "button";
    ok.addEventListener("click", function () {
      var h = seen();
      h[key] = 1;
      LY.prefs.hints = h;
      LY.savePrefs();
      bar.remove();
    });
    bar.appendChild(ok);
    host.appendChild(bar);
    return true;
  }
  LY.hint = hint;
  function resetHints() { LY.prefs.hints = {}; LY.savePrefs(); LY.toast(t("learn.hintsBack")); }

  // ---------- the wizard ----------
  function preview(host, d) {
    host.innerHTML = "";
    if (!d) return;
    var order = M.pagesInOrder(d), opener = null, L;
    var st = d.setup.ext && d.setup.ext.start;
    // the pages the book opens on: the first page with the body's master, and the one before it
    order.forEach(function (p, i) { if (!opener && p.ms === "ms-o") opener = i; });
    if (opener === null) opener = Math.min(order.length - 1, order.length > 2 ? 1 : 0);
    var pair = d.setup.facing && opener > 0 ? [order[opener - 1], order[opener]] : [order[opener]];
    if (st && (st.k === "magazine" || st.k === "zine")) pair = [order[0]];
    try { L = R.computeLayout(d); } catch (e) { return; }
    var box = el("div", "st-spread"), maxH = 220, sc = maxH / d.setup.h;
    pair.forEach(function (pg) {
      try {
        var c = R.renderPage(d, pg, L, sc * (window.devicePixelRatio || 1), {});
        c.style.height = maxH + "px"; c.style.width = Math.round(d.setup.w * sc) + "px";
        // the margins, as a guide
        var x = c.getContext("2d"), k = c.width / d.setup.w, mg = M.margins(d, M.sideOf(d, order.indexOf(pg)));
        x.setTransform(1, 0, 0, 1, 0, 0); x.strokeStyle = "rgba(200,40,140,0.6)"; x.lineWidth = Math.max(1, window.devicePixelRatio || 1);
        x.strokeRect(mg.l * k, mg.t * k, (d.setup.w - mg.l - mg.r) * k, (d.setup.h - mg.t - mg.b) * k);
        box.appendChild(c);
      } catch (e) { void e; }
    });
    host.appendChild(box);
  }
  function startDlg(pre) {
    if (!S) return;
    pre = pre || {};
    var st = { step: 1, kind: pre.kind || "novel", trim: null, w: 0, h: 0, margins: "normal", pair: "noto", front: null, meta: { title: "", author: "", publisher: "", year: String(new Date().getFullYear()), isbn: "" } };
    function setKind(id) {
      var k = S.kindOf(id);
      st.kind = id; st.w = k.trim[0]; st.h = k.trim[1]; st.front = S.frontFor(id);
      if (!st.pairSet) st.pair = id === "workbook" || id === "zine" || id === "children" ? "sans" : "noto";
    }
    setKind(st.kind);
    function doc(now) {
      return S.build({
        kind: st.kind, w: st.w * MM, h: st.h * MM, pair: st.pair, margins: st.margins, front: st.front,
        meta: st.meta, now: now || 1, t: t, names: names, name: st.meta.title.trim() || t("sk." + st.kind)
      });
    }
    LY.openDialog(t("start.title"), function (body, close) {
      var head = el("p", "st-step"), main = el("div", "st-main"), pv = el("div", "st-pv"), act = el("div", "dlg-actions");
      body.appendChild(head); body.appendChild(main); body.appendChild(pv); body.appendChild(act);
      var pvTimer = null;
      function redrawPv() { clearTimeout(pvTimer); pvTimer = setTimeout(function () { preview(pv, st.step > 1 ? doc() : null); }, 120); }
      function draw() {
        head.textContent = t("start.step", { n: st.step, of: 4 }) + " · " + t("start.s" + st.step);
        main.innerHTML = ""; act.innerHTML = "";
        ["", kinds, size, type, details][st.step]();
        if (st.step > 1) act.appendChild(LY.ui.btn(t("start.back"), function () { st.step--; draw(); }));
        act.appendChild(el("span", "spacer"));
        act.appendChild(LY.ui.btn(t("btn.cancel"), close));
        if (st.step < 4) act.appendChild(LY.ui.btn(t("start.next"), function () { st.step++; draw(); }, "primary"));
        else act.appendChild(LY.ui.btn(t("start.make"), make, "primary"));
        redrawPv();
      }
      function kinds() {
        var grid = el("div", "st-kinds");
        S.KINDS.forEach(function (k) {
          var b = el("button", "st-kind" + (k.id === st.kind ? " on" : ""));
          b.type = "button";
          b.setAttribute("aria-pressed", k.id === st.kind ? "true" : "false");
          b.appendChild(el("span", "st-kind-name", t("sk." + k.id)));
          b.appendChild(el("span", "st-kind-d", t("sk.d." + k.id)));
          b.addEventListener("click", function () { setKind(k.id); draw(); });
          grid.appendChild(b);
        });
        main.appendChild(grid);
      }
      function size() {
        var k = S.kindOf(st.kind), opts = [], cur = st.w + "x" + st.h, hit = false;
        [k.trim].concat(S.TRIMS).forEach(function (tr) {
          var id = tr[0] + "x" + tr[1];
          if (opts.some(function (o) { return o[0] === id; })) return;
          if (id === cur) hit = true;
          opts.push([id, mmText(tr[0]) + " × " + mmText(tr[1]) + " mm" + (tr === k.trim ? " · " + t("start.usual") : "")]);
        });
        opts.push(["custom", t("new.custom")]);
        var wIn = el("input", "inp num"), hIn = el("input", "inp num"), cw = el("div", "grid2");
        [wIn, hIn].forEach(function (i, n) { i.type = "number"; i.min = 50; i.max = 1000; i.step = 1; i.value = n ? st.h : st.w; });
        function custom() {
          var w = parseFloat(wIn.value), h = parseFloat(hIn.value);
          if (isFinite(w) && w >= 50 && w <= 1000) st.w = w;
          if (isFinite(h) && h >= 50 && h <= 1000) st.h = h;
          redrawPv();
        }
        wIn.addEventListener("input", custom); hIn.addEventListener("input", custom);
        cw.appendChild(LY.ui.field(t("new.w") + " (mm)", wIn)); cw.appendChild(LY.ui.field(t("new.h") + " (mm)", hIn));
        cw.hidden = hit;
        main.appendChild(LY.ui.field(t("start.trim"), LY.ui.select(opts, hit ? cur : "custom", function (v) {
          if (v === "custom") { cw.hidden = false; wIn.focus(); return; }
          var p = v.split("x");
          st.w = +p[0]; st.h = +p[1]; wIn.value = st.w; hIn.value = st.h; cw.hidden = true; redrawPv();
        })));
        main.appendChild(cw);
        main.appendChild(LY.ui.field(t("new.margins"), LY.ui.seg([["tight", t("start.m.tight")], ["normal", t("start.m.normal")], ["wide", t("start.m.wide")]], st.margins, function (v) { st.margins = v; redrawPv(); })));
        main.appendChild(el("p", "hint", t("start.trimHint")));
      }
      function type() {
        var list = el("div", "st-pairs");
        S.PAIRS.forEach(function (p) {
          var lab = el("label", "chk st-pair"), r = el("input");
          r.type = "radio"; r.name = "st-pair"; r.checked = p.id === st.pair;
          r.addEventListener("change", function () { st.pair = p.id; st.pairSet = 1; redrawPv(); });
          lab.appendChild(r);
          lab.appendChild(el("span", "", t("start.pair." + p.id)));
          list.appendChild(lab);
        });
        main.appendChild(list);
        main.appendChild(el("p", "hint", t("start.pairHint")));
      }
      function details() {
        var k = S.kindOf(st.kind);
        [["title", "start.f.title"], ["author", "start.f.author"], ["publisher", "start.f.publisher"], ["year", "start.f.year"], ["isbn", "start.f.isbn"]].forEach(function (f) {
          var i = el("input", "inp"); i.type = "text"; i.maxLength = f[0] === "title" ? 120 : 80; i.value = st.meta[f[0]];
          i.addEventListener("input", function () { st.meta[f[0]] = i.value; redrawPv(); });
          main.appendChild(LY.ui.field(t(f[1]), i));
        });
        if (k.front) {
          main.appendChild(el("span", "fld-lbl", t("start.front")));
          S.FRONT.forEach(function (key) {
            main.appendChild(LY.ui.check(t("start.fr." + key), st.front[key], function (v) { st.front[key] = v; redrawPv(); }));
          });
        }
        main.appendChild(el("p", "hint", t("start.later")));
      }
      function make() {
        var d = doc(LY.now());
        close();
        if (!d) return;
        LY.addDoc(LY.hyphOn(d));
        setTimeout(function () { hint("start"); }, 300);
      }
      draw();
    }, true);
  }

  // ---------- Learn (side panel) ----------
  var LESSONS = [
    ["text", function () { LY.panels.setTab("styles"); }],
    ["styles", function () { LY.panels.setTab("styles"); }],
    ["pages", function () { LY.panels.setTab("pages"); }],
    ["pics", function () { LY.ed.setTool("image"); }],
    ["toc", function () { if (LY.house && LY.house.hasToc(LY.doc)) LY.house.updateToc(); else LY.toast(t("learn.noToc")); }],
    ["check", function () { LY.dlg.preflight(); }],
    ["export", function () { LY.dlg.exportDlg(); }]
  ];
  function learn(body) {
    body.appendChild(el("p", "pn-title", t("learn.title")));
    body.appendChild(el("p", "hint", t("learn.intro")));
    LESSONS.forEach(function (ls) {
      var box = el("div", "learn-item");
      box.appendChild(el("h3", "pn-h", t("learn." + ls[0])));
      box.appendChild(el("p", "learn-txt", t("learn." + ls[0] + ".d")));
      if (ls[1]) box.appendChild(LY.ui.btn(t("learn.show"), ls[1], "small"));
      body.appendChild(box);
    });
    var more = el("div", "learn-item");
    more.appendChild(LY.ui.btn(t("learn.help"), function () {
      try { if (window.parent && window.parent.orosHelp) { window.parent.orosHelp.open("a/layout"); return; } } catch (e) { void e; }
      LY.toast(t("learn.noHelp"));
    }, "small"));
    more.appendChild(LY.ui.btn(t("learn.hints"), resetHints, "small"));
    body.appendChild(more);
  }

  LY.startUI = { open: startDlg, learn: learn, hint: hint, names: names };
  LY.on("boot", function () {
    var b = LY.$("btn-book"), b2 = LY.$("btn-book2");
    if (b) b.addEventListener("click", function () { startDlg(); });
    if (b2) b2.addEventListener("click", function () { startDlg(); });
  });
  LY.on("open", function () {
    setTimeout(function () { if (!document.querySelector(".hint-bar")) hint("editor"); }, 600);
  });
  LY.on("mode", function () { if (LY.ed.master) hint("master"); });
})();
