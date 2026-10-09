// ============================================================
// orOS Slides — side panel + dialogs (v1.0.0)
// One panel that follows the selection:
//   - objects selected: Format (text, picture, shape, line; position,
//     arrange, align, lock)
//   - nothing selected: the Slide (layout, transition, background,
//     hidden) and the Presentation (theme, size, footer)
// On a phone the panel is a bottom sheet (the Format button).
// Dialogs: new presentation, recovered text, keyboard shortcuts.
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = SL.C, t = SL.t, $ = SL.$, el = SL.el;
  var PN = SL.panels = {};
  var forced = null;        // "deck": show the presentation part first

  function ED() { return SL.ed; }
  function phone() { return window.matchMedia("(max-width: 760px)").matches; }

  PN.toggle = function () {
    if (phone()) document.body.classList.toggle("side-open");
    else document.body.classList.toggle("side-closed");
    PN.render();
    if (SL.ed) { setTimeout(function () { SL.ed.refresh(); }, 0); }
  };
  PN.open = function (what) {
    forced = what || null;
    if (ED().view() !== "slide") ED().setView("slide");
    document.body.classList.remove("side-closed");
    if (phone()) document.body.classList.add("side-open");
    ED().select([]);
    PN.render();
    var sec = $("side-body").querySelector('[data-sec="' + what + '"]');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
    forced = null;
  };

  // ---------- Controls ----------
  function sec(title, key) {
    var s = el("section", "pn-sec");
    if (key) s.setAttribute("data-sec", key);
    if (title) s.appendChild(el("h3", "pn-h", title));
    return s;
  }
  function row(cls) { return el("div", "pn-row" + (cls ? " " + cls : "")); }
  function seg(opts, value, onPick, key) {
    var s = el("div", "seg");
    opts.forEach(function (o) {
      var b = el("button", "seg-btn" + (o.v === value ? " on" : ""));
      b.type = "button";
      if (o.icon) { b.innerHTML = SL.icon(o.icon); b.setAttribute("aria-label", o.label); b.title = o.label; }
      else b.textContent = o.label;
      b.setAttribute("aria-pressed", o.v === value ? "true" : "false");
      if (key) b.setAttribute("data-k", key + ":" + o.v);
      b.addEventListener("click", function () { onPick(o.v); });
      s.appendChild(b);
    });
    return s;
  }
  function num(label, value, min, max, onSet, key) {
    var f = el("label", "fld");
    f.appendChild(el("span", "fld-lbl", label));
    var i = el("input", "inp sm num");
    i.type = "number"; i.value = String(value); i.min = String(min); i.max = String(max); i.step = "1";
    i.setAttribute("data-k", key);
    i.addEventListener("change", function () {
      var v = parseFloat(String(i.value).replace(",", "."));
      if (!isFinite(v)) { i.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, Math.round(v))));
    });
    f.appendChild(i);
    return f;
  }
  function range(label, value, min, max, onSet, key, fmt) {
    var f = el("label", "fld");
    var head = el("span", "fld-lbl", label);
    var out = el("span", "rng-v", fmt ? fmt(value) : String(value));
    var r = el("input", "rng");
    r.type = "range"; r.min = String(min); r.max = String(max); r.value = String(value);
    r.setAttribute("data-k", key);
    r.setAttribute("aria-label", label);
    var started = false;
    r.addEventListener("input", function () {
      out.textContent = fmt ? fmt(+r.value) : r.value;
      if (!started) { started = true; SL.beginGesture(); }
      onSet(+r.value, true);
    });
    r.addEventListener("change", function () {
      if (!started) SL.beginGesture();
      started = false;
      onSet(+r.value, false);
      SL.endGesture();
      PN.render();
    });
    var h = el("div", "rng-row");
    h.appendChild(head); h.appendChild(out);
    f.appendChild(h); f.appendChild(r);
    return f;
  }
  function check(label, on, onSet, key) {
    var l = el("label", "chk");
    var c = el("input");
    c.type = "checkbox"; c.checked = !!on;
    c.setAttribute("data-k", key);
    c.addEventListener("change", function () { onSet(c.checked); });
    l.appendChild(c); l.appendChild(el("span", "", label));
    return l;
  }
  function btn(label, fn, cls) {
    var b = el("button", "btn small" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  // Theme colours first (they follow a theme change), then a custom one.
  var ROLES = ["bg", "fg", "mu", "sf", "a1", "a2", "a3"];
  function colors(value, onSet, allowNone, key) {
    var th = C.themeById(SL.curDeck().th);
    var w = el("div", "swp");
    function chip(v, css, label) {
      var b = el("button", "sw" + (value === v ? " on" : "") + (v === "" ? " none" : ""));
      b.type = "button";
      if (css) b.style.background = css;
      b.title = label; b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", value === v ? "true" : "false");
      b.setAttribute("data-k", key + ":" + v);
      b.addEventListener("click", function () { onSet(v); });
      w.appendChild(b);
    }
    if (allowNone) chip("", "", t("col.none"));
    ROLES.forEach(function (r) { chip("t:" + r, th.c[r], t("col." + r)); });
    var cust = el("input");
    cust.type = "color";
    cust.title = t("col.custom"); cust.setAttribute("aria-label", t("col.custom"));
    cust.value = value && value.charAt(0) === "#" ? value : (C.resolveColor(value || "t:fg", th) || "#000000");
    if (value && value.charAt(0) === "#") cust.classList.add("on");
    cust.setAttribute("data-k", key + ":custom");
    cust.addEventListener("change", function () { onSet(cust.value.toLowerCase()); });
    w.appendChild(cust);
    return w;
  }
  function fld(label, node) {
    var f = el("div", "fld");
    f.appendChild(el("span", "fld-lbl", label));
    f.appendChild(node);
    return f;
  }

  // ---------- Render ----------
  PN.render = function () {
    if (!SL.deck || !SL.ed) return;
    var host = $("side-body");
    var focusKey = document.activeElement && host.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
    var scroll = host.scrollTop;
    host.innerHTML = "";
    SL.setIcon($("side-close"), "close", t("side.close"));
    var sel = ED().sel.map(ED().item).filter(Boolean);
    $("tool-format") && $("tool-format").classList.toggle("on", document.body.classList.contains("side-open") || (!phone() && !document.body.classList.contains("side-closed")));
    if (sel.length) {
      $("side-title").textContent = t("side.item");
      if (sel.length === 1) itemPanel(host, sel[0]); else multiPanel(host, sel);
    } else {
      $("side-title").textContent = t("side.slide");
      if (forced === "deck") { deckPanel(host); slidePanel(host); }
      else { slidePanel(host); deckPanel(host); }
    }
    host.scrollTop = scroll;
    if (focusKey) {
      var n = host.querySelector('[data-k="' + focusKey + '"]');
      if (n) n.focus();
    }
  };

  // ----- Slide -----
  function slidePanel(host) {
    var s = SL.data().slides[ED().cur];
    if (!s) return;
    var a = sec(t("pn.layout"), "slide");
    var grid = el("div", "ly-grid");
    C.LAYOUTS.forEach(function (ly) {
      var b = el("button", "ly-btn" + (s.ly === ly.id ? " on" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", s.ly === ly.id ? "true" : "false");
      b.setAttribute("data-k", "ly:" + ly.id);
      var pic = el("span", "ly-pic");
      ly.ph.forEach(function (ph) {
        var r = el("span", "ly-ph" + (ph.role === "img" ? " img" : ph.role === "title" ? " title" : ""));
        r.style.left = ph.x * 100 + "%"; r.style.width = ph.w * 100 + "%";
        r.style.top = ph.y / 10 + "%"; r.style.height = ph.h / 10 + "%";
        pic.appendChild(r);
      });
      b.appendChild(pic);
      b.appendChild(el("span", "ly-name", SL.label(ly.name)));
      b.addEventListener("click", function () { ED().setLayout(ly.id); });
      grid.appendChild(b);
    });
    a.appendChild(grid);
    host.appendChild(a);

    var tr = sec(t("pn.transition"));
    var selTr = el("select", "inp sm");
    selTr.setAttribute("data-k", "tr");
    selTr.setAttribute("aria-label", t("pn.transition"));
    C.TRANSITIONS.forEach(function (x) {
      var o = el("option", "", t("tr." + x)); o.value = x; if (s.tr === x) o.selected = true; selTr.appendChild(o);
    });
    selTr.addEventListener("change", function () { ED().editSlide(function (x) { x.tr = selTr.value; }); });
    var r1 = row(); r1.appendChild(selTr);
    r1.appendChild(btn(t("tr.all"), function () {
      var v = s.tr;
      SL.op(function (dt, nw) {
        var ch = false;
        C.deckSlides(dt, SL.deck).forEach(function (x) { if (x.tr !== v) { x.tr = v; x.m = nw; ch = true; } });
        if (!ch) return false;
        C.touchDeck(dt, SL.deck, nw);
      });
    }));
    tr.appendChild(r1);
    host.appendChild(tr);

    var bg = sec(t("pn.bg"));
    bg.appendChild(colors(s.bg || "t:bg", function (v) { ED().editSlide(function (x) { if (v === "t:bg") delete x.bg; else x.bg = v; }); }, false, "bg"));
    bg.appendChild(check(t("pn.hidden"), s.hid, function (v) { ED().editSlide(function (x) { x.hid = v; }); }, "hid"));
    host.appendChild(bg);
  }

  // ----- Presentation -----
  function deckPanel(host) {
    var d = SL.curDeck();
    var a = sec(t("pn.theme"), "deck");
    var grid = el("div", "th-grid");
    C.THEMES.forEach(function (th) {
      grid.appendChild(themeCard(th, d.th === th.id, function () { ED().editDeck(function (x) { x.th = th.id; }); }));
    });
    a.appendChild(grid);
    host.appendChild(a);
    var asp = sec(t("pn.aspect"));
    asp.appendChild(seg([{ v: "16:9", label: t("new.wide") }, { v: "4:3", label: t("new.std") }], d.as, function (v) {
      SL.op(function (dt, nw) { return C.setAspect(dt, SL.deck, v, nw) ? undefined : false; });
    }, "as"));
    host.appendChild(asp);
    var ft = sec(t("pn.footer"));
    function setFt(k, v) { ED().editDeck(function (x) { x.ft = JSON.parse(JSON.stringify(x.ft)); x.ft[k] = v; }); }
    ft.appendChild(check(t("ft.n"), d.ft.n, function (v) { setFt("n", v); }, "ft-n"));
    ft.appendChild(check(t("ft.d"), d.ft.d, function (v) { setFt("d", v); }, "ft-d"));
    var x = el("input", "inp sm");
    x.type = "text"; x.value = d.ft.x; x.maxLength = C.LIM.footer;
    x.setAttribute("data-k", "ft-x");
    x.addEventListener("change", function () { setFt("x", x.value); });
    ft.appendChild(fld(t("ft.x"), x));
    ft.appendChild(check(t("ft.s1"), d.ft.s1, function (v) { setFt("s1", v); }, "ft-s1"));
    host.appendChild(ft);
  }
  function themeCard(th, on, fn) {
    var b = el("button", "th-card" + (on ? " on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("data-k", "th:" + th.id);
    var pic = el("span", "th-pic");
    pic.style.background = th.c.bg;
    var l1 = el("span", "th-l1"); l1.style.background = th.c.fg;
    var l2 = el("span", "th-l2"); l2.style.background = th.c.mu;
    var ac = el("span", "th-ac"); ac.style.background = th.c.a1;
    pic.appendChild(l1); pic.appendChild(l2); pic.appendChild(ac);
    b.appendChild(pic);
    b.appendChild(el("span", "th-name", SL.label(th.name)));
    b.addEventListener("click", fn);
    return b;
  }
  PN.themeCard = themeCard;

  // ----- One object -----
  function itemPanel(host, it) {
    var ids = [it.id];
    function set(fn) { ED().editItems(ids, fn); }
    var kindLbl = it.k === "text" ? t("pn.text") : it.k === "image" ? t("pn.image") : it.k === "shape" ? t("pn.shape") : t("pn.line");
    if (it.k === "text") {
      var a = sec(kindLbl);
      var r = row();
      r.appendChild(btn(t("pn.edit"), function () { SL.text.start(it.id); }, "primary"));
      a.appendChild(r);
      var fsel = el("select", "inp sm");
      fsel.setAttribute("data-k", "ff");
      [["", "font.theme"], ["sans", "font.sans"], ["serif", "font.serif"], ["mono", "font.mono"]].forEach(function (f) {
        var o = el("option", "", t(f[1])); o.value = f[0]; if (it.ff === f[0]) o.selected = true; fsel.appendChild(o);
      });
      fsel.addEventListener("change", function () { set(function (x) { x.ff = fsel.value; }); });
      var g = el("div", "grid2");
      g.appendChild(fld(t("pn.font"), fsel));
      g.appendChild(num(t("pn.size"), it.fs, 6, C.LIM.fs, function (v) { set(function (x) { x.fs = v; }); }, "fs"));
      a.appendChild(g);
      a.appendChild(check(t("pn.fit"), it.fit !== false, function (v) { set(function (x) { if (v) delete x.fit; else x.fit = false; }); }, "fit"));
      var f = SL.D.fitOf(it, C.themeById(SL.curDeck().th));
      if (f.over) a.appendChild(el("p", "hint warn", t("fit.over")));
      else if (f.k < 1) a.appendChild(el("p", "hint", t("fit.shrunk", { n: Math.round(f.k * 100) })));
      a.appendChild(fld(t("pn.talign"), seg(["l", "c", "r", "j"].map(function (v) { return { v: v, icon: "ta" + v, label: t("al." + v) }; }), it.al, function (v) { set(function (x) { x.al = v; }); }, "al")));
      a.appendChild(fld(t("pn.va"), seg(["t", "m", "b"].map(function (v) { return { v: v, icon: "v" + v, label: t("va." + v) }; }), it.va, function (v) { set(function (x) { x.va = v; }); }, "va")));
      a.appendChild(fld(t("pn.tcolor"), colors(it.fc, function (v) { set(function (x) { x.fc = v; }); }, false, "fc")));
      host.appendChild(a);
      host.appendChild(fillStroke(it, set, true));
    } else if (it.k === "image") {
      var im = sec(kindLbl);
      im.appendChild(row().appendChild(btn(it.img ? t("img.replace") : t("img.add"), function () { SL.io.placeImage(it.id); }, "primary")).parentNode);
      if (it.img) {
        if (SL.A.isMissing(it.img.a)) im.appendChild(el("p", "hint warn", t("img.missing")));
        im.appendChild(seg([{ v: "fill", label: t("img.fill") }, { v: "fit", label: t("img.fit") }], it.img.fit, function (v) { set(function (x) { x.img.fit = v; }); }, "ifit"));
        var live = function (k) {
          return function (v, isLive) {
            if (isLive) SL.live2(function (dt, nw) { var x = dt.items[it.id]; if (x && x.img) { x.img[k] = v; x.m = nw; C.touchSlide(dt, x.s, nw); } });
            else set(function (x) { x.img[k] = v; });
          };
        };
        im.appendChild(range(t("img.zoom"), it.img.zm, 100, 400, live("zm"), "zm", function (v) { return v + "%"; }));
        im.appendChild(range(t("img.ox"), it.img.ox, -100, 100, live("ox"), "ox"));
        im.appendChild(range(t("img.oy"), it.img.oy, -100, 100, live("oy"), "oy"));
        var alt = el("input", "inp sm");
        alt.type = "text"; alt.value = it.img.alt; alt.maxLength = 300;
        alt.setAttribute("data-k", "alt");
        alt.addEventListener("change", function () { set(function (x) { x.img.alt = alt.value; }); });
        im.appendChild(fld(t("img.alt"), alt));
      }
      im.appendChild(num(t("pn.radius"), it.rad || 0, 0, C.LIM.radius, function (v) { set(function (x) { x.rad = v; }); }, "rad"));
      host.appendChild(im);
      host.appendChild(fillStroke(it, set, false));
    } else if (it.k === "shape") {
      var sh = sec(kindLbl);
      sh.appendChild(seg([{ v: "rect", icon: "rect", label: t("sh.rect") }, { v: "ellipse", icon: "ell", label: t("sh.ellipse") }], it.sh, function (v) { set(function (x) { x.sh = v; }); }, "sh"));
      if (it.sh === "rect") sh.appendChild(num(t("pn.radius"), it.rad || 0, 0, C.LIM.radius, function (v) { set(function (x) { x.rad = v; }); }, "rad"));
      host.appendChild(sh);
      host.appendChild(fillStroke(it, set, true));
    } else {
      var ln = sec(kindLbl);
      ln.appendChild(fld(t("pn.stroke"), colors(it.st, function (v) { set(function (x) { x.st = v; }); }, false, "st")));
      var g2 = el("div", "grid2");
      g2.appendChild(num(t("pn.sw"), it.sw, 1, C.LIM.stroke, function (v) { set(function (x) { x.sw = v; }); }, "sw"));
      ln.appendChild(g2);
      ln.appendChild(check(t("pn.dash"), it.dash, function (v) { set(function (x) { if (v) x.dash = true; else delete x.dash; }); }, "dash"));
      ln.appendChild(check(t("pn.flip"), it.flip, function (v) { set(function (x) { if (v) x.flip = true; else delete x.flip; }); }, "flip"));
      host.appendChild(ln);
    }
    host.appendChild(geomPanel(it, set));
    host.appendChild(arrangePanel([it]));
  }

  function fillStroke(it, set, withFill) {
    var s = sec(withFill ? t("pn.fill") : t("pn.stroke"));
    if (withFill) s.appendChild(colors(it.fill || "", function (v) { set(function (x) { if (v) x.fill = v; else delete x.fill; }); }, true, "fill"));
    var st = el("div", "pn-col");
    st.appendChild(fld(t("pn.stroke"), colors(it.st || "", function (v) { set(function (x) { if (v) { x.st = v; x.sw = x.sw || 4; } else { delete x.st; delete x.sw; delete x.dash; } }); }, true, "st")));
    if (it.st) {
      var g = el("div", "grid2");
      g.appendChild(num(t("pn.sw"), it.sw, 1, C.LIM.stroke, function (v) { set(function (x) { x.sw = v; }); }, "sw"));
      st.appendChild(g);
      st.appendChild(check(t("pn.dash"), it.dash, function (v) { set(function (x) { if (v) x.dash = true; else delete x.dash; }); }, "dash"));
    }
    s.appendChild(st);
    return s;
  }

  function geomPanel(it, set) {
    var s = sec(t("pn.pos"));
    var g = el("div", "grid2");
    var L = C.LIM;
    g.appendChild(num(t("pn.x"), it.x, -L.coord, L.coord, function (v) { set(function (x) { x.x = v; }); }, "x"));
    g.appendChild(num(t("pn.y"), it.y, -L.coord, L.coord, function (v) { set(function (x) { x.y = v; }); }, "y"));
    g.appendChild(num(t("pn.w"), it.w, 1, L.size, function (v) { set(function (x) { x.w = v; }); }, "w"));
    g.appendChild(num(t("pn.h"), it.h, 1, L.size, function (v) { set(function (x) { x.h = v; }); }, "h"));
    g.appendChild(num(t("pn.rot"), it.r, -180, 180, function (v) { set(function (x) { x.r = v; }); }, "r"));
    s.appendChild(g);
    s.appendChild(range(t("pn.op"), it.op === undefined ? 100 : it.op, 0, 100, function (v, isLive) {
      if (isLive) SL.live2(function (dt, nw) { var x = dt.items[it.id]; if (x) { x.op = v; x.m = nw; C.touchSlide(dt, x.s, nw); } });
      else set(function (x) { if (v === 100) delete x.op; else x.op = v; });
    }, "op", function (v) { return v + "%"; }));
    s.appendChild(check(t("pn.lock"), it.lk, function (v) { set(function (x) { if (v) x.lk = true; else delete x.lk; }); }, "lk"));
    return s;
  }

  function arrangePanel(list) {
    var s = sec(t("pn.arrange"));
    var r = row();
    [["front", "front", "pn.front"], ["fwd", "fwd", "pn.fwd"], ["bwd", "bwd", "pn.bwd"], ["back", "toBack", "pn.back"]].forEach(function (a) {
      var b = SL.iconBtn(a[1], t(a[2]));
      b.setAttribute("data-k", "arr:" + a[0]);
      b.addEventListener("click", function () { ED().arrange(a[0]); });
      r.appendChild(b);
    });
    s.appendChild(r);
    s.appendChild(el("h3", "pn-h pn-h2", t("pn.align") + " · " + (list.length > 1 ? t("pn.toSel") : t("pn.toSlide"))));
    var r2 = row();
    ["al", "ac", "ar", "at", "am", "ab"].forEach(function (a) {
      var b = SL.iconBtn(a, t("pn." + a));
      b.setAttribute("data-k", "aln:" + a);
      b.addEventListener("click", function () { ED().align(a); });
      r2.appendChild(b);
    });
    s.appendChild(r2);
    var r3 = row();
    r3.appendChild(btn(t("pn.dup"), function () { ED().duplicate(); }));
    r3.appendChild(btn(t("pn.del"), function () { ED().deleteSel(); }, "danger"));
    s.appendChild(r3);
    return s;
  }

  function multiPanel(host, list) {
    host.appendChild(el("p", "pn-title", t("pn.multi", { n: list.length })));
    host.appendChild(arrangePanel(list));
  }

  // ---------- Dialogs ----------
  SL.dlg = {};

  SL.dlg.newDeck = function () {
    SL.openDialog(t("new.title"), function (body, close) {
      var state = { th: "light", as: "16:9" };
      var name = el("input", "inp");
      name.type = "text"; name.maxLength = C.LIM.title; name.placeholder = t("deck.untitled");
      body.appendChild(fld(t("new.name"), name));
      body.appendChild(fld(t("new.aspect"), seg([{ v: "16:9", label: t("new.wide") }, { v: "4:3", label: t("new.std") }], state.as, function (v) {
        state.as = v;
        [].forEach.call(body.querySelectorAll('[data-k^="nas:"]'), function (b) { var on = b.getAttribute("data-k") === "nas:" + v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      }, "nas")));
      body.appendChild(el("h3", "", t("new.themes")));
      var grid = el("div", "th-grid");
      C.THEMES.forEach(function (th) {
        grid.appendChild(themeCard(th, false, function () {
          close();
          SL.createDeck({ name: C.cleanLine(name.value, C.LIM.title), th: th.id, as: state.as });
        }));
      });
      body.appendChild(grid);
      body.appendChild(el("h3", "", t("new.templates")));
      var tl = el("div", "tpl-list");
      C.TEMPLATES.forEach(function (tp) {
        var th = C.themeById(tp.th);
        var b = el("button", "tpl");
        b.type = "button";
        var dot = el("span", "tpl-dot"); dot.style.background = th.c.bg; dot.style.borderColor = th.c.a1;
        b.appendChild(dot);
        b.appendChild(el("span", "", SL.label(tp.name)));
        b.addEventListener("click", function () {
          close();
          SL.createDeck({ tpl: tp.id, as: state.as, name: C.cleanLine(name.value, C.LIM.title) });
        });
        tl.appendChild(b);
      });
      body.appendChild(tl);
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.cancel"), close));
      body.appendChild(act);
    }, true);
  };

  SL.dlg.recovered = function () {
    SL.openDialog(t("rec.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("rec.note")));
      var list = SL.recovered(SL.deck);
      if (!list.length) body.appendChild(el("p", "", t("rec.none")));
      list.forEach(function (r) {
        var box = el("div", "rec");
        var n = ED().indexOf(r.s);
        box.appendChild(el("div", "pn-h", n < 0 ? t("rec.gone") : t(r.w === "notes" ? "rec.notes" : "rec.text", { n: n + 1 }) + " · " + SL.fmtDate(r.m)));
        box.appendChild(el("div", "rec-txt", r.x));
        var a = row();
        a.appendChild(btn(t("rec.copy"), function () {
          try { navigator.clipboard.writeText(r.x).then(function () { SL.toast(t("toast.copied")); }); } catch (e) {}
        }));
        a.appendChild(btn(t("rec.insert"), function () {
          SL.dropRecovered(r.id);
          close();
          if (n >= 0) ED().go(r.s);
          var lines = r.x.split("\n");
          ED().addItem({ k: "text", x: Math.round(ED().W() * 0.1), y: 120, w: Math.round(ED().W() * 0.8), h: 600, fs: 24,
            paras: lines.map(function (l) { return { l: 0, ls: "", r: l ? [{ t: l }] : [] }; }) });
        }));
        a.appendChild(btn(t("rec.drop"), function () { SL.dropRecovered(r.id); box.remove(); }, "danger"));
        box.appendChild(a);
        body.appendChild(box);
      });
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  };

  SL.dlg.keys = function () {
    SL.openDialog(t("keys.title"), function (body, close) {
      var tb = el("table", "keys");
      t("keys.rows").split("\n").forEach(function (line) {
        var p = line.split("|"), tr = el("tr");
        tr.appendChild(el("th", "", p[0])); tr.appendChild(el("td", "", p[1]));
        tb.appendChild(tr);
      });
      body.appendChild(tb);
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.close"), close));
      body.appendChild(act);
    });
  };

  SL.on("boot", function () {
    $("side-close").addEventListener("click", function () {
      if (phone()) document.body.classList.remove("side-open"); else document.body.classList.add("side-closed");
      PN.render();
      if (SL.ed) SL.ed.refresh();
    });
  });
})();
