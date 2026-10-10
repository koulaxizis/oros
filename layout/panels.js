// ============================================================
// orOS Layout — panels + dialogs (v1.0.0)
// Side panels: Properties (selection or page), Pages (spreads,
// masters), Styles (paragraph + character), Colours (swatches).
// Dialogs (one <dialog>, centred, R32): new document, document
// setup, export, paragraph / character style, swatch, recovered
// text. The "More" menu.
// On a phone the side panel is a bottom sheet (Panels button).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, R = LY.R, T = LY.T, t = LY.t, $ = LY.$, el = LY.el;
  var ED = LY.ed;
  var TABS = ["props", "pages", "styles", "colors"];
  var tab = "props";

  // ---------- Form helpers ----------
  function field(label, input, cls) {
    var w = el("label", "fld" + (cls ? " " + cls : ""));
    w.appendChild(el("span", "fld-lbl", label));
    w.appendChild(input);
    return w;
  }
  // A numeric input in the doc unit (or raw with unit === "raw").
  // onSet(pt) on Enter / blur / arrow keys.
  function numInput(value, onSet, opts) {
    opts = opts || {};
    var inp = el("input", "inp num");
    inp.type = "text";
    inp.inputMode = "decimal";
    inp.autocomplete = "off";
    var raw = opts.unit === "raw";
    function show(v) { inp.value = v === null || v === undefined ? "" : raw ? String(Math.round(v * 100) / 100) : LY.fmt(v); }
    show(value);
    var last = inp.value;
    function commit() {
      if (inp.value === last) return;
      var v = raw ? parseFloat(String(inp.value).replace(",", ".")) : LY.parse(inp.value);
      if (v === null || !isFinite(v)) { inp.value = last; return; }
      if (opts.min !== undefined) v = Math.max(opts.min, v);
      if (opts.max !== undefined) v = Math.min(opts.max, v);
      last = inp.value;
      onSet(v);
    }
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); inp.select(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        var cur = raw ? parseFloat(inp.value) : LY.parse(inp.value);
        if (!isFinite(cur)) cur = 0;
        var step = (e.shiftKey ? 10 : 1) * (raw ? (opts.step || 1) : M.fromUnit(1, LY.unit()) * (LY.unit() === "mm" ? 1 : LY.unit() === "in" ? 0.1 : 1));
        var nv = cur + (e.key === "ArrowUp" ? step : -step);
        if (opts.min !== undefined) nv = Math.max(opts.min, nv);
        if (opts.max !== undefined) nv = Math.min(opts.max, nv);
        show(nv); last = inp.value; onSet(nv);
      }
    });
    if (opts.label) inp.setAttribute("aria-label", opts.label);
    return inp;
  }
  function select(options, value, onSet) {
    var s = el("select", "inp");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      if (o[0] === value) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onSet(s.value); });
    return s;
  }
  function check(label, on, onSet) {
    var w = el("label", "chk");
    var c = el("input"); c.type = "checkbox"; c.checked = !!on;
    c.addEventListener("change", function () { onSet(c.checked ? 1 : 0); });
    w.appendChild(c); w.appendChild(el("span", "", label));
    return w;
  }
  function seg(options, value, onSet) {
    var w = el("div", "seg");
    options.forEach(function (o) {
      var b = el("button", "seg-btn" + (o[0] === value ? " on" : ""));
      b.type = "button";
      if (o[2]) { b.innerHTML = LY.icon(o[2]); b.title = o[1]; b.setAttribute("aria-label", o[1]); }
      else b.textContent = o[1];
      b.setAttribute("aria-pressed", o[0] === value ? "true" : "false");
      b.addEventListener("click", function () { onSet(o[0]); });
      w.appendChild(b);
    });
    return w;
  }
  function btn(label, fn, cls) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function section(title) {
    var s = el("section", "pn-sec");
    if (title) s.appendChild(el("h3", "pn-h", title));
    return s;
  }
  function row() { return el("div", "pn-row"); }
  function swatchName(sw) { return LY.label(sw.name); }

  function swatchPicker(value, onSet, allowNone) {
    var w = el("div", "swp");
    var doc = LY.doc;
    if (allowNone !== false) {
      var n = el("button", "sw none" + (!value ? " on" : ""));
      n.type = "button"; n.title = t("props.none2"); n.setAttribute("aria-label", t("props.none2"));
      n.addEventListener("click", function () { onSet(""); });
      w.appendChild(n);
    }
    doc.swatches.forEach(function (sw) {
      var b = el("button", "sw" + (sw.id === value ? " on" : ""));
      b.type = "button";
      b.style.background = M.cssColor(doc, sw.id);
      b.title = swatchName(sw); b.setAttribute("aria-label", swatchName(sw));
      b.setAttribute("aria-pressed", sw.id === value ? "true" : "false");
      b.addEventListener("click", function () { onSet(sw.id); });
      w.appendChild(b);
    });
    return w;
  }

  // Apply fn(item, now) to every selected item as one undo step.
  function editSel(fn) {
    var ids = ED.sel.slice();
    LY.op(function (doc, now) {
      var any = false;
      ids.forEach(function (id) {
        var it = M.find(doc.items, id);
        if (!it) return;
        if (fn(it, now, doc) !== false) { M.touch(it, now); any = true; }
      });
      if (!any) return false;
    });
  }
  function common(items, key) {
    var v = items[0][key];
    for (var i = 1; i < items.length; i++) if (items[i][key] !== v) return null;
    return v;
  }

  // ---------- Tabs + refresh ----------
  function buildTabs() {
    var host = $("side-tabs");
    host.innerHTML = "";
    TABS.forEach(function (k) {
      var b = el("button", "side-tab", t("tab." + k));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-tab", k);
      b.addEventListener("click", function () { setTab(k); });
      host.appendChild(b);
    });
  }
  function setTab(k) {
    tab = k;
    [].forEach.call(document.querySelectorAll(".side-tab"), function (b) {
      var on = b.getAttribute("data-tab") === k;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    refresh(true);
  }
  LY.panels = { setTab: setTab };

  var refreshTimer = null;
  function refresh(force) {
    if (!LY.doc) return;
    var body = $("side-body");
    var a = document.activeElement;
    if (!force && a && body.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;
    var scroll = body.scrollTop;
    body.innerHTML = "";
    if (tab === "props") buildProps(body);
    else if (tab === "pages") buildPages(body);
    else if (tab === "styles") buildStyles(body);
    else buildColors(body);
    body.scrollTop = scroll;
  }
  LY.panels.refresh = refresh;
  function soon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(function () { refresh(false); }, 60); }

  // ---------- Properties ----------
  function buildProps(body) {
    var items = ED.selItems(), doc = LY.doc;
    if (!items.length) { buildPageProps(body); return; }
    var one = items.length === 1 ? items[0] : null;
    var head = el("p", "pn-title", one ? typeName(one) : t("props.multi", { n: items.length }));
    body.appendChild(head);

    // position + size
    var s1 = section(t("props.pos"));
    var g = el("div", "grid2");
    [["x", "props.x"], ["y", "props.y"], ["w", "props.w"], ["h", "props.h"]].forEach(function (d) {
      var v = common(items, d[0]);
      g.appendChild(field(t(d[1]), numInput(v, function (val) {
        editSel(function (it) {
          if (it.lock) return false;
          if ((d[0] === "w" || d[0] === "h") && it.t !== "line") val = Math.max(1, val);
          it[d[0]] = val;
        });
      }, { label: t(d[1]) })));
    });
    s1.appendChild(g);
    var g2 = el("div", "grid2");
    g2.appendChild(field(t("props.rot"), numInput(common(items, "rot"), function (v) {
      editSel(function (it) { if (it.lock) return false; it.rot = ((v + 540) % 360) - 180; });
    }, { unit: "raw", min: -360, max: 360, step: 1 })));
    g2.appendChild(field(t("props.op") + " %", numInput(common(items, "op"), function (v) {
      editSel(function (it) { it.op = Math.round(v); });
    }, { unit: "raw", min: 0, max: 100, step: 5 })));
    s1.appendChild(g2);
    body.appendChild(s1);

    // fill + stroke
    var s2 = section();
    if (!items.every(function (it) { return it.t === "line"; })) {
      s2.appendChild(el("span", "fld-lbl", t("props.fill")));
      s2.appendChild(swatchPicker(common(items, "fill"), function (id) { editSel(function (it) { if (it.t === "line") return false; it.fill = id; }); }));
    }
    s2.appendChild(el("span", "fld-lbl", t("props.stroke")));
    s2.appendChild(swatchPicker(common(items, "stroke"), function (id) { editSel(function (it) { it.stroke = id; if (id && !(it.sw > 0)) it.sw = 1; }); }));
    var g3 = el("div", "grid2");
    g3.appendChild(field(t("props.sw") + " (pt)", numInput(common(items, "sw"), function (v) {
      editSel(function (it) { it.sw = v; });
    }, { unit: "raw", min: 0, max: 200, step: 0.25 })));
    if (items.some(function (it) { return it.t === "rect" || it.t === "img" || it.t === "text"; })) {
      g3.appendChild(field(t("props.r"), numInput(common(items, "r"), function (v) {
        editSel(function (it) { if (it.t === "ell" || it.t === "line") return false; it.r = Math.max(0, v); });
      }, { min: 0 })));
    }
    s2.appendChild(g3);
    s2.appendChild(check(t("props.dash"), common(items, "dash"), function (v) { editSel(function (it) { it.dash = v; }); }));
    body.appendChild(s2);

    if (one && one.t === "text") body.appendChild(textSection(one));
    if (one && one.t === "img") body.appendChild(imageSection(one));

    // wrap
    var s4 = section(t("props.wrap"));
    s4.appendChild(seg([["none", t("props.wrap.none")], ["box", t("props.wrap.box")], ["ell", t("props.wrap.ell")]], common(items, "wrap"), function (v) {
      editSel(function (it) { it.wrap = v; });
    }));
    if (items.some(function (it) { return it.wrap !== "none"; })) {
      s4.appendChild(field(t("props.wo"), numInput(common(items, "wo"), function (v) { editSel(function (it) { it.wo = v; }); })));
    }
    body.appendChild(s4);

    // arrange + align
    var s5 = section(t("props.arrange"));
    var r1 = row();
    [["front", "front"], ["fwd", "fwd"], ["bwd", "bwd"], ["back", "toBack"]].forEach(function (d) {
      var b = LY.iconBtn(d[1], t("props." + d[0]));
      b.addEventListener("click", function () { ED.arrange(d[0]); });
      r1.appendChild(b);
    });
    s5.appendChild(r1);
    s5.appendChild(el("span", "fld-lbl", t("props.align") + " " + (one ? t("props.alignTo") : t("props.alignSel"))));
    var r2 = row();
    ["al", "ac", "ar", "at", "am", "ab"].concat(items.length > 2 ? ["dh", "dv"] : []).forEach(function (k) {
      var b = LY.iconBtn(k, t("props." + k));
      b.addEventListener("click", function () { ED.align(k); });
      r2.appendChild(b);
    });
    s5.appendChild(r2);
    var r3 = row();
    var locked = common(items, "lock");
    var lb = LY.iconBtn(locked ? "lock" : "unlock", t("props.lock"), locked ? "on" : "");
    lb.setAttribute("aria-pressed", locked ? "true" : "false");
    lb.addEventListener("click", function () { var v = locked ? 0 : 1; editSel(function (it) { it.lock = v; }); });
    r3.appendChild(lb);
    var hb = LY.iconBtn("eye", t("props.hide"));
    hb.addEventListener("click", function () { editSel(function (it) { it.hide = 1; }); ED.select([]); LY.toast(t("hide.done")); });
    r3.appendChild(hb);
    if (items.length > 1) r3.appendChild(btn(t("props.group"), ED.group, "small"));
    if (items.some(function (it) { return it.grp; })) r3.appendChild(btn(t("props.ungroup"), ED.ungroup, "small"));
    if (items.some(function (it) { return it.ov; })) r3.appendChild(btn(t("ms.reset"), ED.resetToMaster, "small"));
    var dupB = LY.iconBtn("copy", t("props.dup")); dupB.addEventListener("click", ED.duplicate); r3.appendChild(dupB);
    var delB = LY.iconBtn("trash", t("props.del"), "danger"); delB.addEventListener("click", ED.deleteSel); r3.appendChild(delB);
    s5.appendChild(r3);
    body.appendChild(s5);
    void doc;
  }

  function typeName(it) {
    return t(it.t === "text" ? "props.text" : it.t === "img" ? "props.image" : it.t === "rect" ? "tool.rect" : it.t === "ell" ? "tool.ell" : "tool.line").replace(/ \(.\)$/, "");
  }

  function textSection(it) {
    var s = section(t("props.text"));
    var doc = LY.doc, ch = M.chain(doc, it.story), i = 0;
    ch.forEach(function (f, k) { if (f.id === it.id) i = k; });
    s.appendChild(btn(t("props.edit"), function () { LY.story.open(it.id); }, "primary block"));
    var g = el("div", "grid2");
    g.appendChild(field(t("props.cols"), numInput(it.cols, function (v) { editSel(function (x) { if (x.t !== "text") return false; x.cols = Math.round(v); }); }, { unit: "raw", min: 1, max: 20, step: 1 })));
    g.appendChild(field(t("props.gut"), numInput(it.gut, function (v) { editSel(function (x) { if (x.t !== "text") return false; x.gut = Math.max(0, v); }); }, { min: 0 })));
    g.appendChild(field(t("props.ins"), numInput(it.ins, function (v) { editSel(function (x) { if (x.t !== "text") return false; x.ins = Math.max(0, v); }); }, { min: 0 })));
    s.appendChild(g);
    s.appendChild(el("span", "fld-lbl", t("props.va")));
    s.appendChild(seg([["t", t("props.va.t")], ["c", t("props.va.c")], ["b", t("props.va.b")]], it.va, function (v) { editSel(function (x) { if (x.t !== "text") return false; x.va = v; }); }));
    if (ch.length > 1) s.appendChild(el("p", "hint", t("props.chain", { i: i + 1, n: ch.length })));
    var isMaster = !!M.find(doc.masters, it.pg);
    if (!isMaster) {
      var r = el("div", "pn-col");
      r.appendChild(btn(t("props.threadNext"), function () { ED.threadNext(it.id); }, "small"));
      if (ED.L && ED.L.overset[it.story]) r.appendChild(btn(t("props.autoflow"), function () { ED.autoflow(it.id); }, "small"));
      if (i < ch.length - 1) r.appendChild(btn(t("props.unthread"), function () { ED.unthread(it.id); }, "small"));
      s.appendChild(r);
    }
    return s;
  }

  function imageSection(it) {
    var s = section(t("props.image"));
    s.appendChild(btn(it.a ? t("props.replace") : t("props.place"), function () { LY.io.placeImage(it.id); }, "primary block"));
    if (it.a) {
      s.appendChild(seg([["fit", t("props.fit")], ["fill", t("props.fillf")]], it.fit === "custom" ? "" : it.fit, function (v) {
        editSel(function (x) { if (x.t !== "img") return false; x.fit = v; });
      }));
      var r = R.imageRect(it);
      var sc = it.iw ? r.w / it.iw : 1;
      var g = el("div", "grid2");
      // scale as % of 72 ppi (1 px = 1 pt)
      g.appendChild(field(t("props.scale") + " %", numInput(sc * 100, function (v) {
        editSel(function (x) {
          if (x.t !== "img") return false;
          var cur = R.imageRect(x), k = Math.max(0.1, v) / 100;
          var cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
          x.fit = "custom"; x.isc = k;
          x.ix = cx - x.iw * k / 2; x.iy = cy - x.ih * k / 2;
        });
      }, { unit: "raw", min: 0.1, max: 100000, step: 5 })));
      g.appendChild(field(t("props.offx"), numInput(r.x, function (v) {
        editSel(function (x) { if (x.t !== "img") return false; var cur = R.imageRect(x); x.fit = "custom"; x.isc = cur.w / (x.iw || 1); x.ix = v; x.iy = cur.y; });
      })));
      g.appendChild(field(t("props.offy"), numInput(r.y, function (v) {
        editSel(function (x) { if (x.t !== "img") return false; var cur = R.imageRect(x); x.fit = "custom"; x.isc = cur.w / (x.iw || 1); x.iy = v; x.ix = cur.x; });
      })));
      s.appendChild(g);
      var ppi = Math.round(R.effectivePpi(it));
      s.appendChild(el("p", "hint" + (ppi < 150 ? " warn" : ""), ppi < 150 ? t("props.ppiLow", { n: ppi }) : t("props.ppi", { n: ppi })));
      if (LY.A.isMissing(it.a)) s.appendChild(el("p", "hint warn", t("props.missing")));
    }
    return s;
  }

  function buildPageProps(body) {
    var doc = LY.doc, s = doc.setup;
    body.appendChild(el("p", "pn-title", t("props.doc")));
    var sec = section();
    sec.appendChild(el("p", "hint", t("props.size") + ": " + LY.fmt(s.w) + " × " + LY.fmt(s.h) + " " + t("unit." + s.unit)));
    sec.appendChild(btn(t("props.setup"), function () { LY.dlg.setup(); }, "block"));
    body.appendChild(sec);
    if (!ED.master) {
      var pg = ED.curPage();
      if (pg) {
        var s2 = section(t("props.pageMaster"));
        s2.appendChild(masterSelect(pg));
        if (pg.ms) s2.appendChild(btn(t("ms.detach"), ED.detachAll, "small"));
        body.appendChild(s2);
        var hidden = LY.doc.items.filter(function (it) { return it.pg === pg.id && it.hide; });
        if (hidden.length) {
          var s3 = section();
          s3.appendChild(btn(t("hide.show", { n: hidden.length }), function () { showHidden(pg.id); }, "small"));
          body.appendChild(s3);
        }
      }
    } else {
      var hm = LY.doc.items.filter(function (it) { return it.pg === ED.master && it.hide; });
      if (hm.length) {
        var s4 = section();
        s4.appendChild(btn(t("hide.show", { n: hm.length }), function () { showHidden(ED.master); }, "small"));
        body.appendChild(s4);
      }
    }
    body.appendChild(el("p", "hint", t("props.none")));
    body.appendChild(el("p", "hint", t("ruler.hint")));
  }
  // Hidden objects come back (and get selected) on one page or master.
  function showHidden(owner) {
    var ids = [];
    LY.op(function (doc, now) {
      doc.items.forEach(function (it) { if (it.pg === owner && it.hide) { it.hide = 0; M.touch(it, now); ids.push(it.id); } });
      if (!ids.length) return false;
    });
    if (ids.length) ED.select(ids);
  }

  function masterSelect(pg) {
    var opts = [["", t("props.noMaster")]].concat(LY.doc.masters.map(function (m) { return [m.id, m.pre + " · " + LY.label(m.name)]; }));
    return select(opts, pg.ms, function (v) {
      LY.op(function (doc, now) { var p = M.find(doc.pages, pg.id); if (!p) return false; p.ms = v; M.touch(p, now); });
    });
  }

  // ---------- Pages ----------
  var thumbCache = {};
  function buildPages(body) {
    var doc = LY.doc;
    var cur = ED.curPage();
    var tools = row();
    var acts = [["plus", "pages.add", addPage], ["copy", "pages.dup", dupPage], ["up", "pages.up", function () { movePage(-1); }],
                ["down", "pages.down", function () { movePage(1); }], ["trash", "pages.del", delPage]];
    acts.forEach(function (a) {
      var b = LY.iconBtn(a[0], t(a[1]), a[0] === "trash" ? "danger" : "");
      b.addEventListener("click", a[2]);
      if (ED.master) b.disabled = true;
      tools.appendChild(b);
    });
    body.appendChild(tools);
    if (cur && !ED.master) body.appendChild(field(t("props.pageMaster"), masterSelect(cur)));

    var list = el("div", "spreads");
    var L = ED.L;
    var idx = 0;
    M.spreads(doc).forEach(function (sp) {
      var srow = el("div", "spread" + (doc.setup.facing && sp.length === 1 && idx === 0 ? " first" : ""));
      sp.forEach(function (p) {
        var n = idx + 1; idx++;
        var tile = el("button", "pg-tile" + (cur && cur.id === p.id && !ED.master ? " on" : ""));
        tile.type = "button";
        tile.setAttribute("aria-label", t("st.page", { n: n, c: doc.pages.length }));
        var ratio = doc.setup.h / doc.setup.w;
        var tw = 54, th = Math.round(tw * ratio);
        var holder = el("span", "pg-thumb");
        holder.style.width = tw + "px"; holder.style.height = th + "px";
        var img = thumbImg(doc, p, L, tw);
        if (img) holder.appendChild(img);
        tile.appendChild(holder);
        var ms = p.ms ? M.find(doc.masters, p.ms) : null;
        tile.appendChild(el("span", "pg-n", (ms ? ms.pre + " · " : "") + n));
        tile.addEventListener("click", function () { if (ED.master) ED.enterMaster(null); ED.scrollToPage(p.id); setTimeout(function () { refresh(true); }, 30); });
        srow.appendChild(tile);
      });
      list.appendChild(srow);
    });
    body.appendChild(list);

    var ms = section(t("pages.masters"));
    doc.masters.forEach(function (m) {
      var r = el("div", "ms-row" + (ED.master === m.id ? " on" : ""));
      r.appendChild(el("span", "ms-pre", m.pre));
      r.appendChild(el("span", "ms-name", LY.label(m.name)));
      var e = LY.iconBtn("edit", t("pages.editMaster"));
      e.addEventListener("click", function () { ED.enterMaster(m.id); });
      r.appendChild(e);
      var more = LY.iconBtn("more", t("ed.more"));
      more.addEventListener("click", function () {
        LY.menu(more, [
          { label: t("pages.renameMaster"), fn: function () { renameMaster(m.id); } },
          { label: t("pages.applyMaster"), disabled: !cur || !!ED.master, fn: function () { LY.op(function (doc2, now) { var p = M.find(doc2.pages, cur.id); p.ms = m.id; M.touch(p, now); }); } },
          { label: t("pages.delMaster"), danger: true, fn: function () { delMaster(m.id); } }
        ]);
      });
      r.appendChild(more);
      ms.appendChild(r);
    });
    ms.appendChild(btn(t("pages.newMaster"), newMaster, "small"));
    body.appendChild(ms);
  }

  function thumbImg(doc, p, L, tw) {
    if (!L) return null;
    var key = p.id + ":" + JSON.stringify(M.itemsOn(doc, p.id)).length + ":" + M.maxM(doc) + ":" + (p.ms || "");
    var c = thumbCache[p.id];
    if (!c || c.key !== key) {
      try {
        var cvs = R.renderPage(doc, p, L, tw * 2 / doc.setup.w, { getImage: LY.A.get });
        c = thumbCache[p.id] = { key: key, url: cvs.toDataURL("image/png") };
      } catch (e) { return null; }
    }
    var img = el("img");
    img.src = c.url; img.alt = "";
    return img;
  }

  function addPage() {
    var cur = ED.curPage(), made = null;
    LY.op(function (doc, now) {
      var after = cur ? cur.id : M.pagesInOrder(doc).slice(-1)[0].id;
      made = ED.addPageAfter(doc, after, now);
      if (!made) return false;
    });
    if (made) setTimeout(function () { ED.scrollToPage(made.id); refresh(true); }, 0);
  }
  function dupPage() {
    var cur = ED.curPage(), made = null;
    if (!cur) return;
    LY.op(function (doc, now) {
      made = ED.addPageAfter(doc, cur.id, now, cur.ms);
      if (!made) return false;
      var storyMap = {};
      M.itemsOn(doc, cur.id).forEach(function (it) {
        var c = JSON.parse(JSON.stringify(it));
        c.id = M.newId("it"); c.m = now; c.pg = made.id;
        if (c.t === "text") {
          // a duplicated frame gets its own copy of the text it shows
          if (!storyMap[c.story]) {
            var st = M.story(doc, c.story);
            storyMap[c.story] = ED.newStory(doc, now, st ? JSON.parse(JSON.stringify(st.paras)) : undefined).id;
          }
          c.story = storyMap[c.story];
        }
        if (c.grp) c.grp = c.grp + "x";
        doc.items.push(c);
      });
      doc.guides.forEach(function (g) {
        if (g.pg === cur.id) doc.guides.push({ id: M.newId("gd"), m: now, pg: made.id, o: g.o, p: g.p });
      });
      doc.items.forEach(function (it) { if (it.pg === made.id && it.grp && !M.isId(it.grp)) it.grp = ""; });
    });
    if (made) setTimeout(function () { ED.scrollToPage(made.id); refresh(true); }, 0);
  }
  function movePage(dir) {
    var cur = ED.curPage();
    if (!cur) return;
    LY.op(function (doc, now) {
      var order = M.pagesInOrder(doc), i = -1;
      order.forEach(function (p, k) { if (p.id === cur.id) i = k; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return false;
      var a = order[i], b = order[j], tmp = a.pos;
      a.pos = b.pos; b.pos = tmp;
      if (a.pos === b.pos) a.pos += dir * 0.5;
      M.touch(a, now); M.touch(b, now);
    });
    setTimeout(function () { ED.scrollToPage(cur.id); refresh(true); }, 0);
  }
  function delPage() {
    var cur = ED.curPage();
    if (!cur) return;
    if (LY.doc.pages.length <= 1) { LY.toast(t("pages.lastOne")); return; }
    LY.op(function (doc, now) {
      doc.pages = doc.pages.filter(function (p) { return p.id !== cur.id; });
      doc.tombs[cur.id] = now;
      ED.delItems(doc, doc.items.filter(function (it) { return it.pg === cur.id; }).map(function (it) { return it.id; }), now);
      doc.guides = doc.guides.filter(function (g) { if (g.pg === cur.id) { doc.tombs[g.id] = now; return false; } return true; });
    });
    LY.toast(t("toast.deleted"), t("btn.undo"), LY.undo);
  }
  function newMaster() {
    var made = null;
    LY.op(function (doc, now) {
      var used = {};
      doc.masters.forEach(function (m) { used[m.pre] = 1; });
      var pre = "A";
      for (var c = 65; c < 91; c++) { pre = String.fromCharCode(c); if (!used[pre]) break; }
      made = { id: M.newId("ms"), m: now, name: pre + "-Master", pre: pre };
      doc.masters.push(made);
    });
    if (made) ED.enterMaster(made.id);
  }
  function renameMaster(id) {
    var m = M.find(LY.doc.masters, id);
    if (!m) return;
    LY.prompt(t("pages.renameMaster"), LY.label(m.name), function (v) {
      v = String(v || "").trim().slice(0, 60);
      if (!v) return;
      LY.op(function (doc, now) { var x = M.find(doc.masters, id); x.name = v; M.touch(x, now); });
    });
  }
  function delMaster(id) {
    LY.op(function (doc, now) {
      doc.masters = doc.masters.filter(function (m) { return m.id !== id; });
      doc.tombs[id] = now;
      doc.pages.forEach(function (p) { if (p.ms === id) { p.ms = ""; M.touch(p, now); } });
      ED.delItems(doc, doc.items.filter(function (it) { return it.pg === id; }).map(function (it) { return it.id; }), now);
      doc.guides = doc.guides.filter(function (g) { if (g.pg === id) { doc.tombs[g.id] = now; return false; } return true; });
    });
    if (ED.master === id) ED.enterMaster(null);
    LY.toast(t("toast.deleted"), t("btn.undo"), LY.undo);
  }

  // ---------- Styles ----------
  function buildStyles(body) {
    var doc = LY.doc;
    var open = LY.story && LY.story.isOpen();
    body.appendChild(el("p", "hint", t("styles.applyHint")));
    var s1 = section(t("styles.para"));
    var curPs = open ? LY.story.currentPs() : null;
    doc.pstyles.slice().sort(styleOrder).forEach(function (ps) {
      s1.appendChild(styleRow(ps, "ps", curPs === ps.id, open));
    });
    s1.appendChild(btn(t("styles.new"), function () { styleDlg("ps", null); }, "small"));
    body.appendChild(s1);
    var s2 = section(t("styles.char"));
    var none = el("div", "sty-row");
    var nb = el("button", "sty-name", t("styles.noneChar"));
    nb.type = "button";
    nb.disabled = !open;
    nb.addEventListener("click", function () { LY.story.applyCs(""); });
    none.appendChild(nb);
    s2.appendChild(none);
    doc.cstyles.slice().sort(styleOrder).forEach(function (cs) { s2.appendChild(styleRow(cs, "cs", false, open)); });
    s2.appendChild(btn(t("styles.new"), function () { styleDlg("cs", null); }, "small"));
    body.appendChild(s2);
  }
  function styleOrder(a, b) {
    var sa = /^(ps|cs)-[a-z0-9]+$/.test(a.id) && a.id.length < 12, sb = /^(ps|cs)-[a-z0-9]+$/.test(b.id) && b.id.length < 12;
    if (sa !== sb) return sa ? -1 : 1;
    return LY.label(a.name).localeCompare(LY.label(b.name));
  }
  function styleRow(st, kind, on, open) {
    var r = el("div", "sty-row" + (on ? " on" : ""));
    var nb = el("button", "sty-name", LY.label(st.name) || st.id);
    nb.type = "button";
    if (kind === "ps") {
      var rs = T.resolvePs(T.byId(LY.doc.pstyles), st.id);
      nb.style.fontFamily = T.cssFamily(T.fontKey(rs.font, rs.b, rs.i));
    }
    nb.disabled = !open;
    nb.addEventListener("click", function () { if (kind === "ps") LY.story.applyPs(st.id); else LY.story.applyCs(st.id); });
    r.appendChild(nb);
    var e = LY.iconBtn("edit", t("styles.edit"));
    e.addEventListener("click", function () { styleDlg(kind, st.id); });
    r.appendChild(e);
    return r;
  }

  // Paragraph (kind "ps") or character ("cs") style editor.
  function styleDlg(kind, id) {
    var doc = LY.doc, coll = kind === "ps" ? "pstyles" : "cstyles";
    var src = id ? M.find(doc[coll], id) : null;
    var st = src ? JSON.parse(JSON.stringify(src)) : { id: M.newId(kind === "ps" ? "ps" : "cs"), name: "", base: kind === "ps" ? "ps-base" : undefined };
    var isNew = !src;
    LY.openDialog(t(isNew ? "styles.new" : "styles.edit"), function (body, close) {
      var name = el("input", "inp"); name.type = "text"; name.maxLength = 60; name.value = LY.label(st.name);
      body.appendChild(field(t("sty.name"), name));
      var others = doc[coll].filter(function (x) { return x.id !== st.id; });
      var baseSel = select([["", t("sty.baseNone")]].concat(others.map(function (x) { return [x.id, LY.label(x.name)]; })), st.base || "", function (v) { st.base = v || undefined; });
      body.appendChild(field(t("sty.base"), baseSel));
      var inheritOpt = ["", t("sty.inherit")];
      var g = el("div", "grid2");
      g.appendChild(field(t("sty.font"), select([inheritOpt, ["sans", t("font.sans")], ["serif", t("font.serif")], ["mono", t("font.mono")]], st.font || "", function (v) { st.font = v || undefined; })));
      g.appendChild(field(t("sty.size"), optNum(st, "size", 1, 1296)));
      if (kind === "ps") g.appendChild(field(t("sty.lead") + " (0 = " + t("sty.auto") + ")", optNum(st, "lead", 0, 1500)));
      g.appendChild(field(t("sty.track"), optNum(st, "track", -500, 2000)));
      body.appendChild(g);
      var flags = el("div", "pn-row wrap");
      ["b", "i", "u", "caps"].concat(kind === "ps" ? ["bul"] : []).forEach(function (k) {
        flags.appendChild(triState(t("sty." + k), st, k));
      });
      body.appendChild(flags);
      if (kind === "ps") {
        body.appendChild(el("span", "fld-lbl", t("sty.align")));
        var alignWrap = el("div");
        function drawAlign() {
          alignWrap.innerHTML = "";
          alignWrap.appendChild(seg([["", t("sty.inherit")], ["l", t("sty.al")], ["c", t("sty.ac")], ["r", t("sty.ar")], ["j", t("sty.aj")]], st.align || "", function (v) { st.align = v || undefined; drawAlign(); }));
        }
        drawAlign();
        body.appendChild(alignWrap);
        var g2 = el("div", "grid2");
        [["sb", "sty.sb"], ["sa", "sty.sa"], ["fi", "sty.fi"], ["li", "sty.li"], ["ri", "sty.ri"]].forEach(function (d) {
          g2.appendChild(field(t(d[1]) + " (pt)", optNum(st, d[0], -1000, 1000)));
        });
        body.appendChild(g2);
      }
      body.appendChild(el("span", "fld-lbl", t("sty.color")));
      var colWrap = el("div");
      function drawCol() {
        colWrap.innerHTML = "";
        colWrap.appendChild(swatchPicker(st.color || "", function (v) { st.color = v || undefined; drawCol(); }, true));
      }
      drawCol();
      body.appendChild(colWrap);

      var act = el("div", "dlg-actions");
      if (!isNew && st.id !== "ps-base") {
        act.appendChild(btn(t("btn.delete"), function () { close(); deleteStyle(kind, st.id); }, "danger"));
      }
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var nm = name.value.trim().slice(0, 60);
        if (src && nm === LY.label(src.name)) st.name = src.name;   // keep a bilingual seed name (R15)
        else st.name = nm || (kind === "ps" ? t("styles.para") : t("styles.char"));
        close();
        LY.op(function (d2, now) {
          var list = d2[coll], cur = M.find(list, st.id);
          var clean = kind === "ps" ? M.normPs(st) : M.normCs(st);
          clean.m = now;
          if (cur) list[list.indexOf(cur)] = clean; else list.push(clean);
        });
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  // A number that may be "as base" (empty).
  function optNum(st, key, min, max) {
    var inp = el("input", "inp num");
    inp.type = "text"; inp.inputMode = "decimal"; inp.placeholder = t("sty.inherit");
    inp.value = st[key] === undefined ? "" : String(st[key]);
    inp.addEventListener("change", function () {
      var v = parseFloat(String(inp.value).replace(",", "."));
      if (inp.value.trim() === "" || !isFinite(v)) { delete st[key]; inp.value = ""; return; }
      st[key] = Math.min(max, Math.max(min, v));
      inp.value = String(st[key]);
    });
    return inp;
  }
  // Three states: inherit / on / off.
  function triState(label, st, key) {
    var b = el("button", "tri");
    b.type = "button";
    function draw() {
      var v = st[key];
      b.textContent = label + (v === 1 ? " ✓" : v === 0 ? " ✕" : "");
      b.className = "tri" + (v === 1 ? " on" : v === 0 ? " off" : "");
      b.title = v === undefined ? t("sty.inherit") : "";
    }
    b.addEventListener("click", function () { st[key] = st[key] === undefined ? 1 : st[key] === 1 ? 0 : undefined; if (st[key] === undefined) delete st[key]; draw(); });
    draw();
    return b;
  }
  function deleteStyle(kind, id) {
    LY.op(function (doc, now) {
      var coll = kind === "ps" ? "pstyles" : "cstyles";
      var gone = M.find(doc[coll], id);
      if (!gone) return false;
      var repl = kind === "ps" ? (gone.base || "ps-base") : "";
      doc[coll] = doc[coll].filter(function (s) { return s.id !== id; });
      doc.tombs[id] = now;
      doc[coll].forEach(function (s) { if (s.base === id) { s.base = gone.base; M.touch(s, now); } });
      doc.stories.forEach(function (st) {
        var changed = false;
        st.paras.forEach(function (p) {
          if (kind === "ps" && p.ps === id) { p.ps = repl; changed = true; }
          if (kind === "cs") p.runs.forEach(function (r) { if (r.cs === id) { delete r.cs; changed = true; } });
        });
        if (changed) { st.h = [st.m].concat(st.h || []); M.touch(st, now); }
      });
    });
    LY.toast(t("toast.deleted"), t("btn.undo"), LY.undo);
  }

  // ---------- Colours ----------
  function buildColors(body) {
    var doc = LY.doc;
    var s = section(t("colors.title"));
    doc.swatches.forEach(function (sw) {
      var r = el("button", "sw-row");
      r.type = "button";
      var chip = el("span", "sw-chip");
      chip.style.background = M.cssColor(doc, sw.id);
      r.appendChild(chip);
      r.appendChild(el("span", "sw-name", swatchName(sw)));
      r.appendChild(el("span", "sw-val", sw.mode === "cmyk" ? "CMYK " + sw.v.join("/") : "#" + sw.v.map(hex2).join("")));
      r.addEventListener("click", function () { swatchDlg(sw.id); });
      s.appendChild(r);
    });
    s.appendChild(btn(t("colors.new"), function () { swatchDlg(null); }, "small"));
    body.appendChild(s);
    body.appendChild(el("p", "hint", t("colors.note")));
  }
  function hex2(n) { return ("0" + Math.round(n).toString(16)).slice(-2); }

  function swatchDlg(id) {
    var doc = LY.doc, src = id ? M.find(doc.swatches, id) : null;
    var sw = src ? JSON.parse(JSON.stringify(src)) : { id: M.newId("sw"), name: "", mode: "cmyk", v: [0, 0, 0, 100] };
    LY.openDialog(t(src ? "colors.edit" : "colors.new"), function (body, close) {
      var name = el("input", "inp"); name.type = "text"; name.maxLength = 60; name.value = LY.label(sw.name);
      body.appendChild(field(t("sty.name"), name));
      var prev = el("div", "sw-preview");
      var vals = el("div");
      function paint() {
        var tmp = { swatches: [M.normSwatch(sw)] };
        prev.style.background = M.cssColor(tmp, sw.id);
      }
      function drawVals() {
        vals.innerHTML = "";
        if (sw.mode === "rgb") {
          var hx = el("input", "inp"); hx.type = "text"; hx.maxLength = 7;
          hx.value = "#" + sw.v.map(hex2).join("");
          hx.addEventListener("input", function () {
            var m = /^#?([0-9a-f]{6})$/i.exec(hx.value.trim());
            if (!m) return;
            sw.v = [0, 2, 4].map(function (k) { return parseInt(m[1].substr(k, 2), 16); });
            paint();
          });
          vals.appendChild(field(t("colors.hex"), hx));
          var pick = el("input"); pick.type = "color"; pick.value = "#" + sw.v.map(hex2).join("");
          pick.addEventListener("input", function () { hx.value = pick.value; hx.dispatchEvent(new Event("input")); });
          vals.appendChild(pick);
        } else {
          ["C", "M", "Y", "K"].forEach(function (lbl, k) {
            var rng = el("input", "rng"); rng.type = "range"; rng.min = 0; rng.max = 100; rng.value = sw.v[k];
            var num = el("span", "rng-v", String(sw.v[k]));
            rng.addEventListener("input", function () { sw.v[k] = +rng.value; num.textContent = rng.value; paint(); });
            var w = el("label", "rng-row");
            w.appendChild(el("span", "rng-l", lbl)); w.appendChild(rng); w.appendChild(num);
            vals.appendChild(w);
          });
        }
        paint();
      }
      var modeWrap = el("div");
      function drawMode() {
        modeWrap.innerHTML = "";
        modeWrap.appendChild(seg([["cmyk", t("colors.cmyk")], ["rgb", t("colors.rgb")]], sw.mode, function (m) {
          if (m === sw.mode) return;
          var c = M.swatchColor({ swatches: [M.normSwatch(sw)] }, sw.id);
          if (m === "rgb") sw.v = c.rgb;
          else {
            var r = c.rgb[0] / 255, g = c.rgb[1] / 255, b = c.rgb[2] / 255, k = 1 - Math.max(r, g, b);
            sw.v = k >= 1 ? [0, 0, 0, 100] : [r, g, b].map(function (x) { return Math.round((1 - x - k) / (1 - k) * 100); }).concat([Math.round(k * 100)]);
          }
          sw.mode = m;
          drawMode(); drawVals();
        }));
      }
      drawMode();
      body.appendChild(field(t("colors.mode"), modeWrap));
      body.appendChild(prev);
      body.appendChild(vals);
      drawVals();
      var act = el("div", "dlg-actions");
      if (src && sw.id !== "sw-black" && sw.id !== "sw-paper") act.appendChild(btn(t("btn.delete"), function () { close(); deleteSwatch(sw.id); }, "danger"));
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var nm = name.value.trim().slice(0, 60);
        if (src && nm === LY.label(src.name)) sw.name = src.name;
        else sw.name = nm || (sw.mode === "cmyk" ? "C" + sw.v.join(" ") : "#" + sw.v.map(hex2).join(""));
        close();
        LY.op(function (d2, now) {
          var clean = M.normSwatch(sw);
          clean.m = now;
          var cur = M.find(d2.swatches, sw.id);
          if (cur) d2.swatches[d2.swatches.indexOf(cur)] = clean; else d2.swatches.push(clean);
        });
      }, "primary"));
      body.appendChild(act);
    });
  }
  function deleteSwatch(id) {
    if (id === "sw-black" || id === "sw-paper") { LY.toast(t("colors.keep")); return; }
    LY.op(function (doc, now) {
      doc.swatches = doc.swatches.filter(function (s) { return s.id !== id; });
      doc.tombs[id] = now;
      doc.items.forEach(function (it) {
        var ch = false;
        if (it.fill === id) { it.fill = "sw-black"; ch = true; }
        if (it.stroke === id) { it.stroke = "sw-black"; ch = true; }
        if (ch) M.touch(it, now);
      });
      doc.pstyles.concat(doc.cstyles).forEach(function (s) { if (s.color === id) { s.color = "sw-black"; M.touch(s, now); } });
    });
    LY.toast(t("toast.deleted"), t("btn.undo"), LY.undo);
  }

  // ---------- Dialogs: new document + setup ----------
  function setupForm(body, s, isNew) {
    // s: working setup copy in pt; returns nothing (edits s)
    var unit = s.unit;
    function ufmt(v) { return LY.fmt(v, unit); }
    function uparse(v) { return LY.parse(v, unit); }
    var presetOpts = M.PRESETS.map(function (p) { return [p[0], t("preset." + p[0])]; }).concat([["custom", t("preset.custom")]]);
    var wIn, hIn;
    var presetSel = select(presetOpts, s.preset, function (v) {
      s.preset = v;
      var p = M.preset(v);
      if (!p) return;
      var land = s.w > s.h;
      s.w = land ? p.h : p.w; s.h = land ? p.w : p.h;
      wIn.value = ufmt(s.w); hIn.value = ufmt(s.h);
    });
    body.appendChild(field(t("new.size"), presetSel));
    var g = el("div", "grid2");
    function dimInput(key) {
      var inp = el("input", "inp num"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = ufmt(s[key]);
      inp.addEventListener("change", function () {
        var v = uparse(inp.value);
        if (v === null) { inp.value = ufmt(s[key]); return; }
        s[key] = Math.min(14400, Math.max(36, v));
        inp.value = ufmt(s[key]);
        s.preset = "custom"; presetSel.value = "custom";
      });
      return inp;
    }
    wIn = dimInput("w"); hIn = dimInput("h");
    g.appendChild(field(t("new.w"), wIn));
    g.appendChild(field(t("new.h"), hIn));
    body.appendChild(g);
    body.appendChild(seg([["p", t("new.portrait")], ["l", t("new.landscape")]], s.w > s.h ? "l" : "p", function () {}));
    var orient = body.lastChild;
    [].forEach.call(orient.children, function (b, k) {
      b.addEventListener("click", function () {
        var land = k === 1;
        if ((s.w > s.h) !== land) { var tmp = s.w; s.w = s.h; s.h = tmp; wIn.value = ufmt(s.w); hIn.value = ufmt(s.h); }
        [].forEach.call(orient.children, function (x, j) { x.classList.toggle("on", j === k); });
      });
    });
    var g2 = el("div", "grid2");
    if (isNew) {
      var pages = el("input", "inp num"); pages.type = "number"; pages.min = 1; pages.max = M.MAX_PAGES; pages.value = s.pages || 1;
      pages.addEventListener("change", function () { s.pages = Math.max(1, Math.min(M.MAX_PAGES, parseInt(pages.value, 10) || 1)); pages.value = s.pages; });
      g2.appendChild(field(t("new.pages"), pages));
    }
    var unitSel = select([["mm", t("unit.mm")], ["pt", t("unit.pt")], ["in", t("unit.in")]], unit, function (v) {
      s.unit = unit = v;
      // re-show every length in the new unit
      [].forEach.call(body.querySelectorAll("[data-len]"), function (inp) { inp.value = ufmt(s[inp.getAttribute("data-len")]); });
      wIn.value = ufmt(s.w); hIn.value = ufmt(s.h);
    });
    g2.appendChild(field(t("new.unit"), unitSel));
    body.appendChild(g2);
    var facingRow = check(t("new.facing"), s.facing, function (v) { s.facing = v; labelMargins(); });
    body.appendChild(facingRow);
    body.appendChild(el("span", "fld-lbl", t("new.margins")));
    var g3 = el("div", "grid2");
    var lblIn = el("span"), lblOut = el("span");
    function lenInput(key, lblNode) {
      var inp = el("input", "inp num"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = ufmt(s[key]);
      inp.setAttribute("data-len", key);
      inp.addEventListener("change", function () {
        var v = uparse(inp.value);
        if (v === null) { inp.value = ufmt(s[key]); return; }
        s[key] = Math.max(0, Math.min(2000, v)); inp.value = ufmt(s[key]);
      });
      var w = el("label", "fld");
      w.appendChild(lblNode); lblNode.className = "fld-lbl";
      w.appendChild(inp);
      return w;
    }
    var lt = el("span", "", t("new.top")), lb = el("span", "", t("new.bottom"));
    g3.appendChild(lenInput("mt", lt)); g3.appendChild(lenInput("mb", lb));
    g3.appendChild(lenInput("mi", lblIn)); g3.appendChild(lenInput("mo", lblOut));
    function labelMargins() { lblIn.textContent = t(s.facing ? "new.inside" : "new.left"); lblOut.textContent = t(s.facing ? "new.outside" : "new.right"); }
    labelMargins();
    body.appendChild(g3);
    var g4 = el("div", "grid2");
    var cols = el("input", "inp num"); cols.type = "number"; cols.min = 1; cols.max = 20; cols.value = s.cols;
    cols.addEventListener("change", function () { s.cols = Math.max(1, Math.min(20, parseInt(cols.value, 10) || 1)); cols.value = s.cols; });
    g4.appendChild(field(t("new.cols"), cols));
    g4.appendChild(lenInput("gut", el("span", "", t("new.gut"))));
    g4.appendChild(lenInput("bleed", el("span", "", t("new.bleed"))));
    body.appendChild(g4);
  }

  function newDocDlg() {
    var lang = LY.LANG, TP = window.orosDK.templates;
    var a4 = M.preset("a4");
    var s = { w: a4.w, h: a4.h, unit: "mm", bleed: 3 * M.PT_PER.mm, mt: 15 * M.PT_PER.mm, mb: 15 * M.PT_PER.mm,
              mi: 15 * M.PT_PER.mm, mo: 15 * M.PT_PER.mm, cols: 1, gut: 5 * M.PT_PER.mm, facing: 0, preset: "a4", pages: 1 };
    var pick = "";
    LY.openDialog(t("new.title"), function (body, close) {
      var name = el("input", "inp"); name.type = "text"; name.maxLength = 120; name.value = t("doc.untitled");
      body.appendChild(field(t("new.name"), name));
      // start from: blank or one of the templates (page 1 as a thumbnail)
      body.appendChild(el("span", "fld-lbl", t("new.from")));
      var grid = el("div", "tpl-grid"), form = el("div");
      [{ id: "", name: t("new.blank") }].concat(TP.LIST).forEach(function (tp) {
        var b = el("button", "tpl" + (tp.id === pick ? " on" : ""));
        b.type = "button";
        b.setAttribute("aria-pressed", tp.id === pick ? "true" : "false");
        var th = el("span", "tpl-th");
        if (tp.id) {
          try {
            var d = TP.build(tp.id, { lang: lang, now: 1 }), pg = M.pagesInOrder(d)[0];
            var sc = 72 / Math.max(d.setup.w, d.setup.h);
            th.appendChild(R.renderPage(d, pg, R.computeLayout(d), sc * (window.devicePixelRatio || 1), {}));
          } catch (e) { void e; }
        }
        b.appendChild(th);
        b.appendChild(el("span", "tpl-name", LY.label(tp.name)));
        b.addEventListener("click", function () {
          pick = tp.id;
          [].forEach.call(grid.children, function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          form.hidden = !!pick;
          if (pick && (name.value === t("doc.untitled") || name.getAttribute("data-auto"))) { name.value = LY.label(tp.name); name.setAttribute("data-auto", "1"); }
        });
        grid.appendChild(b);
      });
      body.appendChild(grid);
      setupForm(form, s, true);
      body.appendChild(form);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.create"), function () {
        var nmv = name.value.trim() || t("doc.untitled");
        close();
        if (pick) LY.addDoc(TP.build(pick, { lang: lang, now: LY.now(), name: nmv }));
        else { s.name = nmv; LY.createDoc(s); }
      }, "primary"));
      body.appendChild(act);
      setTimeout(function () { name.select(); }, 0);
    }, true);
  }

  function setupDlg() {
    var s = JSON.parse(JSON.stringify(LY.doc.setup));
    LY.openDialog(t("setup.title"), function (body, close) {
      setupForm(body, s, false);
      body.appendChild(el("p", "hint", t("setup.note")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.apply"), function () {
        close();
        LY.op(function (doc, now) {
          doc.setup = M.normSetup(s);
          doc.m = Math.max(now, doc.m + 1);
        });
        setTimeout(function () { ED.fit(); refresh(true); }, 0);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }

  // ---------- Export dialog ----------
  var imgPrefs = { page: "", dpi: 150, fmt: "png" };
  var expPrefs = { range: "all", custom: "", spreads: 0, bleed: 1, marks: 0, q: "print" };
  function exportDlg() {
    var doc = LY.doc;
    LY.openDialog(t("exp.title"), function (body, close) {
      body.appendChild(el("h3", "pn-h", t("exp.pdf")));
      var rangeWrap = el("div");
      var custom = el("input", "inp"); custom.type = "text"; custom.placeholder = t("exp.rangeHint"); custom.value = expPrefs.custom;
      custom.addEventListener("input", function () { expPrefs.custom = custom.value; expPrefs.range = "custom"; drawRange(); });
      function drawRange() {
        rangeWrap.innerHTML = "";
        rangeWrap.appendChild(seg([["all", t("exp.all")], ["cur", t("exp.cur")], ["custom", t("exp.custom")]], expPrefs.range, function (v) { expPrefs.range = v; drawRange(); if (v === "custom") custom.focus(); }));
      }
      drawRange();
      body.appendChild(field(t("exp.range"), rangeWrap));
      body.appendChild(custom);
      if (doc.setup.facing) body.appendChild(check(t("exp.spreads"), expPrefs.spreads, function (v) { expPrefs.spreads = v; }));
      body.appendChild(check(t("exp.bleed"), expPrefs.bleed, function (v) { expPrefs.bleed = v; }));
      body.appendChild(check(t("exp.marks"), expPrefs.marks, function (v) { expPrefs.marks = v; }));
      var qWrap = el("div");
      function drawQ() { qWrap.innerHTML = ""; qWrap.appendChild(seg([["print", t("exp.print")], ["screen", t("exp.screen")]], expPrefs.q, function (v) { expPrefs.q = v; drawQ(); })); }
      drawQ();
      body.appendChild(field(t("exp.quality"), qWrap));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("exp.go"), function () {
        var pages = pickPages(doc);
        if (!pages) { LY.toast(t("exp.badRange")); return; }
        close();
        LY.io.exportPdf({ pages: pages, spreads: !!(expPrefs.spreads && doc.setup.facing), bleed: !!expPrefs.bleed, marks: !!expPrefs.marks, ppi: expPrefs.q === "print" ? 300 : 150 });
      }, "primary"));
      body.appendChild(act);
      // one page as an image
      body.appendChild(el("h3", "pn-h", t("exp.img")));
      var order = M.pagesInOrder(doc), cur = ED.curPage();
      var pgSel = select(order.map(function (p, i) { return [p.id, t("pf.page", { n: i + 1 })]; }), cur ? cur.id : order[0].id, function (v) { imgPrefs.page = v; });
      imgPrefs.page = pgSel.value;
      var dpiWrap = el("div"), fmtWrap = el("div");
      function drawImg() {
        dpiWrap.innerHTML = ""; fmtWrap.innerHTML = "";
        dpiWrap.appendChild(seg([["72", "72 dpi"], ["150", "150 dpi"], ["300", "300 dpi"]], String(imgPrefs.dpi), function (v) { imgPrefs.dpi = +v; drawImg(); }));
        fmtWrap.appendChild(seg([["png", "PNG"], ["jpg", "JPG"]], imgPrefs.fmt, function (v) { imgPrefs.fmt = v; drawImg(); }));
      }
      drawImg();
      var gi = el("div", "grid2");
      gi.appendChild(field(t("exp.page"), pgSel));
      gi.appendChild(field(t("exp.format"), fmtWrap));
      body.appendChild(gi);
      body.appendChild(field(t("exp.res"), dpiWrap));
      body.appendChild(btn(t("exp.imgGo"), function () { close(); LY.io.exportImage(imgPrefs); }, "block"));
      body.appendChild(el("h3", "pn-h", t("exp.pkg")));
      body.appendChild(el("p", "hint", t("exp.pkgNote")));
      body.appendChild(btn(t("more.pkg"), function () { close(); LY.io.exportPackage(doc); }, "block"));
    });
  }
  // "1-3, 5" → page ids (null when invalid)
  function pickPages(doc) {
    var order = M.pagesInOrder(doc);
    if (expPrefs.range === "all") return order.map(function (p) { return p.id; });
    if (expPrefs.range === "cur") { var c = ED.curPage(); return c ? [c.id] : null; }
    var out = [], ok = true;
    String(expPrefs.custom).split(/[,;]/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
      if (!m) { ok = false; return; }
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > order.length || a > b) { ok = false; return; }
      for (var i = a; i <= b; i++) if (out.indexOf(order[i - 1].id) < 0) out.push(order[i - 1].id);
    });
    return ok && out.length ? out : null;
  }

  // ---------- Recovered text ----------
  function recDlg() {
    var doc = LY.doc;
    LY.openDialog(t("rec.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("rec.note")));
      doc.rec.forEach(function (r) {
        var box = el("div", "rec");
        box.appendChild(el("pre", "rec-txt", r.t));
        var rr = el("div", "pn-row");
        rr.appendChild(btn(t("rec.copy"), function () {
          try { navigator.clipboard.writeText(r.t).then(function () { LY.toast(t("rec.copied")); }); } catch (e) {}
        }, "small"));
        rr.appendChild(btn(t("rec.del"), function () {
          LY.op(function (d2, now) { d2.rec = d2.rec.filter(function (x) { return x.id !== r.id; }); d2.tombs[r.id] = now; });
          close();
          if (LY.doc.rec.length) recDlg();
        }, "small danger"));
        box.appendChild(rr);
        body.appendChild(box);
      });
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  }

  // ---------- Preflight ----------
  function preflightDlg() {
    var doc = LY.doc, order = {};
    M.pagesInOrder(doc).forEach(function (p, i) { order[p.id] = i; });
    LY.openDialog(t("pf.title"), function (body, close) {
      var list = ED.pf || [];
      if (!list.length) body.appendChild(el("p", "pf-ok", t("pf.none")));
      else body.appendChild(el("p", "hint", t("pf.note")));
      var ul = el("ul", "pf-list"), lastPg = null;
      list.forEach(function (x) {
        if (x.pg !== lastPg) {
          lastPg = x.pg;
          var ms = M.find(doc.masters, x.pg);
          ul.appendChild(el("li", "pf-pg", ms ? t("pf.master", { name: ms.pre + " · " + LY.label(ms.name) }) : t("pf.page", { n: order[x.pg] + 1 })));
        }
        var it = M.find(doc.items, x.id), li = el("li");
        var b = el("button", "pf-item " + x.sev);
        b.type = "button";
        b.appendChild(el("span", "pf-dot"));
        var msg = x.code === "ppi" && it ? t("pf.ppi", { n: Math.round(R.effectivePpi(it)) }) : t("pf." + x.code);
        b.appendChild(el("span", "", msg + (it ? " · " + typeName(it) : "")));
        b.addEventListener("click", function () { close(); ED.gotoItem(x.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  }

  LY.dlg = { newDoc: newDocDlg, setup: setupDlg, exportDlg: exportDlg, style: styleDlg, swatch: swatchDlg, rec: recDlg, preflight: preflightDlg };

  // ---------- More menu + panel toggle ----------
  function moreMenu() {
    var doc = LY.doc, it = ED.selItems()[0];
    var items = [
      { label: t("more.setup"), fn: setupDlg },
      { label: t("more.story"), disabled: !(it && it.t === "text"), fn: function () { LY.story.open(it.id); } },
      { label: t("more.text"), fn: function () { LY.io.importText(); } },
      { label: t("more.selall"), fn: ED.selectAll },
      { sep: true },
      { label: t("more.pkg"), fn: function () { LY.io.exportPackage(doc); } }
    ];
    if (doc.rec.length) items.push({ label: t("more.rec", { n: doc.rec.length }), fn: recDlg });
    LY.menu($("ed-more"), items);
  }

  function togglePanel() {
    var on = !document.body.classList.contains("panel-open");
    document.body.classList.toggle("panel-open", on);
    document.body.classList.toggle("panel-closed", !on);
    $("ed-panel").classList.toggle("on", on);
    $("ed-panel").setAttribute("aria-pressed", on ? "true" : "false");
    if (on) refresh(true);
  }

  function wire() {
    buildTabs();
    setTab("props");
    LY.setIcon($("ed-panel"), "panel", t("ed.panel"));
    LY.setIcon($("ed-more"), "more", t("ed.more"));
    $("ed-more").addEventListener("click", moreMenu);
    $("ed-panel").addEventListener("click", togglePanel);
    $("ed-export").addEventListener("click", exportDlg);
    $("side-body").addEventListener("focusout", function () { setTimeout(function () { refresh(false); }, 0); });
    // desktop starts with the panel open, a phone with the canvas
    var phone = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    document.body.classList.add(phone ? "panel-closed" : "panel-open");
    $("ed-panel").classList.toggle("on", !phone);
    LY.on("sel", function () {
      if (ED.sel.length && tab !== "props" && tab !== "styles") setTab("props"); else soon();
    });
    LY.on("doc", soon);
    LY.on("remote", soon);
    LY.on("open", function () { thumbCache = {}; setTab("props"); });
    LY.on("mode", soon);
    var vt = null;
    LY.on("view", function () { if (tab === "pages" || (tab === "props" && !ED.sel.length)) { clearTimeout(vt); vt = setTimeout(function () { refresh(false); }, 200); } });
    LY.on("story", function () { if (tab === "styles") soon(); });
  }
  LY.on("boot", wire);
})();
