// ============================================================
// orOS Atelier — panels (v1.0.0)
//   - the rail (Templates, Elements, Text, Sources, Uploads, Background):
//     a side drawer on wide screens, a bottom sheet on phones
//   - contextual drawer views opened from the context bar: Colour,
//     Effects (text), Filters / Adjust / Shape (photos), Position
//   - the context bar above the stage: the tools of what is
//     selected (font, size, colour, B I U, alignment, spacing,
//     border, roundness, crop, flip, transparency, lock, …)
// Sliders run as one gesture (one undo step, one save).
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, T = AT.T, FX = AT.FX, AX = AT.AX, A = AT.A, t = AT.t, $ = AT.$, el = AT.el;
  var ED = AT.ed, ICONS = window.ATELIER_ICONS;

  var RAIL = ["templates", "elements", "text", "sources", "uploads", "background"];
  var PALETTE = ["#000000", "#545454", "#737373", "#a6a6a6", "#d9d9d9", "#ffffff",
    "#ff3131", "#ff5757", "#ff66c4", "#cb6ce6", "#8c52ff", "#5e17eb",
    "#0097b2", "#0cc0df", "#5ce1e6", "#38b6ff", "#5271ff", "#004aad",
    "#00bf63", "#7ed957", "#c1ff72", "#ffde59", "#ffbd59", "#ff914d"];
  var GRADIENTS = [["#ff9a9e", "#fad0c4"], ["#a18cd1", "#fbc2eb"], ["#84fab0", "#8fd3f4"], ["#f6d365", "#fda085"],
    ["#30cfd0", "#330867"], ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"], ["#0f2027", "#2c5364"],
    ["#ff512f", "#dd2476"], ["#4facfe", "#00f2fe"], ["#fdfbfb", "#ebedee"], ["#232526", "#414345"]];

  var view = null;          // current drawer view id
  var colourTarget = null;  // { kind: "fill"|"stroke"|"fx"|"bg", label }

  // ---------- 1. Small controls ----------
  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function tool(name, label, fn, on) {
    var b = AT.iconBtn(name, label, "ctx-btn");
    if (on) b.classList.add("on");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.addEventListener("click", function (e) { fn(b, e); });
    return b;
  }
  function sep() { return el("span", "ctx-sep"); }
  function chip(colour, gradient) {
    var s = el("span", "chip");
    if (gradient) s.style.background = "linear-gradient(135deg," + gradient.a + "," + gradient.b + ")";
    else if (colour) s.style.background = colour;
    else s.classList.add("none");
    return s;
  }
  function colourBtn(label, colour, gradient, target) {
    var b = el("button", "ctx-btn colour-btn");
    b.type = "button";
    b.title = label; b.setAttribute("aria-label", label);
    b.appendChild(chip(colour, gradient));
    b.addEventListener("click", function () { openColour(target); });
    return b;
  }
  // slider row: live edit as one gesture
  function slider(label, min, max, step, value, onInput, fmt) {
    var row = el("label", "rng-row");
    row.appendChild(el("span", "rng-l", label));
    var r = el("input", "rng");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = value;
    var v = el("span", "rng-v", fmt ? fmt(value) : String(value));
    r.addEventListener("input", function () {
      AT.beginGesture();
      var n = Number(r.value);
      v.textContent = fmt ? fmt(n) : String(n);
      onInput(n);
    });
    r.addEventListener("change", function () { AT.endGesture(); });
    row.appendChild(r); row.appendChild(v);
    return row;
  }
  function sec(title) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    return s;
  }
  function sel1() { var s = ED.selItems(); return s.length === 1 ? s[0] : null; }
  function edit(fn) { return AT.editItems(ED.sel, fn); }

  // ---------- 2. Drawer ----------
  function openView(id, target) {
    if (target) colourTarget = target;
    view = id;
    $("drawer").hidden = false;
    document.body.classList.add("drawer-open");
    renderDrawer();
    renderRail();
  }
  AT.openView = openView;
  function closeDrawer() {
    view = null;
    $("drawer").hidden = true;
    document.body.classList.remove("drawer-open");
    renderRail();
  }
  AT.closeDrawer = closeDrawer;

  function renderRail() {
    var r = $("rail");
    r.innerHTML = "";
    RAIL.forEach(function (id) {
      var b = el("button", "rail-btn" + (view === id ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", view === id ? "true" : "false");
      b.innerHTML = AT.icon(id === "uploads" ? "upload" : id);
      b.appendChild(el("span", "rail-lbl", t("tab." + id)));
      b.addEventListener("click", function () { if (view === id) closeDrawer(); else openView(id); });
      r.appendChild(b);
    });
  }

  function renderDrawer() {
    if (!view || !AT.doc) return;
    var body = $("drawer-body");
    var keep = body.scrollTop;
    body.innerHTML = "";
    $("drawer-title").textContent = t("tab." + view);
    var fn = VIEWS[view];
    if (fn) fn(body);
    body.scrollTop = keep;
  }
  AT.renderDrawer = renderDrawer;

  var VIEWS = {};
  // views that live in their own file (sources.js)
  AT.registerView = function (id, fn) { VIEWS[id] = fn; };

  // --- Templates ---
  VIEWS.templates = function (body) {
    body.appendChild(el("p", "hint", t("tpl.hint")));
    var g = el("div", "tpl-grid");
    AT.TEMPLATES.list.forEach(function (tpl) {
      var b = el("button", "tpl-card");
      b.type = "button";
      var th = el("span", "tpl-thumb");
      th.style.setProperty("--ratio", String(tpl.h / tpl.w));
      var url = AT.thumbOf(AT.tplDoc(tpl), 160, "tpl:" + tpl.id);
      if (url) { var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
      b.appendChild(th);
      b.appendChild(el("span", "tpl-name", AT.lbl(tpl)));
      b.addEventListener("click", function () {
        var busy = ED.items().some(function (it) { return !(it.ax && it.ax.bg); });
        if (busy) AT.confirm(t("tpl.confirm"), t("tpl.apply"), function () { applyTemplate(tpl); });
        else applyTemplate(tpl);
      });
      g.appendChild(b);
    });
    body.appendChild(g);
  };

  // Template pages → the current page (+ new pages after it), scaled
  // to fit this design's size, centred.
  function applyTemplate(tpl) {
    var src = AX.fromTemplate(tpl, AT.LANG, 1);
    var spages = M.pagesInOrder(src);
    var d0 = AT.doc, W = d0.setup.w, H = d0.setup.h;
    var k = Math.min(W / src.setup.w, H / src.setup.h);
    var offX = (W - src.setup.w * k) / 2, offY = (H - src.setup.h * k) / 2;
    var curId = ED.pg;
    AT.op(function (d, nw) {
      var order = M.pagesInOrder(d), idx = 0;
      for (var i = 0; i < order.length; i++) if (order[i].id === curId) idx = i;
      var after = order[idx + 1];
      spages.forEach(function (sp, pi) {
        var pgId = curId;
        if (pi === 0) {
          d.items.filter(function (it) { return it.pg === curId; }).forEach(function (it) { d.tombs[it.id] = nw; });
          d.items = d.items.filter(function (it) { return it.pg !== curId; });
        } else {
          if (d.pages.length >= M.MAX_PAGES) return;
          var base = order[idx].pos, top = after ? after.pos : base + 1024 * (spages.length + 1);
          var np = { id: M.newId("pg"), m: nw, pos: base + (top - base) * pi / spages.length, ms: "" };
          d.pages.push(np);
          pgId = np.id;
        }
        src.items.filter(function (it) { return it.pg === sp.id; }).sort(M.byZ).forEach(function (s) {
          var c = JSON.parse(JSON.stringify(s));
          c.id = M.newId("it"); c.m = nw; c.pg = pgId;
          if (c.ax.bg) { c.x = 0; c.y = 0; c.w = W; c.h = H; }
          else {
            c.x = offX + s.x * k; c.y = offY + s.y * k; c.w = s.w * k; c.h = s.h * k;
            c.sw = s.sw * k;
            if (c.ax.k === "text") c.ax.size = Math.round(s.ax.size * k * 10) / 10;
          }
          var n = M.normItem(c);
          if (!n) return;
          if (n.ax.k === "text") n.h = AX.textHeight(n);
          d.items.push(n);
        });
      });
    });
    T.load(AT.draw.fontKeys(AT.doc)).then(function () { ED.redraw(); }, function () {});
    ED.select([]);
    ED.renderPages();
  }

  // --- Elements ---
  var iconQuery = "", iconCat = "", iconLimit = 120;
  VIEWS.elements = function (body) {
    var s1 = sec(t("el.shapes"));
    var g = el("div", "el-grid");
    FX.SHAPES.forEach(function (sh) {
      var b = el("button", "el-tile");
      b.type = "button";
      b.title = AT.lbl(sh); b.setAttribute("aria-label", AT.lbl(sh));
      b.appendChild(AT.svgPath(FX.toSvgPath(FX.shapePath(sh.id, 40, 40, {})), 40, 40));
      b.addEventListener("click", function () {
        var s = Math.min(AT.doc.setup.w, AT.doc.setup.h) * 0.3;
        ED.add({ k: "shape", shp: sh.id, fc: "#8c52ff", w: s, h: s });
      });
      g.appendChild(b);
    });
    s1.appendChild(g);
    body.appendChild(s1);

    var s2 = sec(t("el.lines"));
    var lr = el("div", "pn-row");
    [["line", "", 0], ["arrow", "arrow", 0], ["dashed", "", 1]].forEach(function (L) {
      lr.appendChild(btn("btn small", t("el." + L[0]), function () {
        var w = AT.doc.setup.w * 0.4, sw = Math.max(1, Math.min(AT.doc.setup.w, AT.doc.setup.h) / 200);
        ED.add({ k: "line", sc: "#000000", ae: L[1], w: w, h: 0, sw: sw, dash: L[2] });
        if (L[2]) edit(function (it) { it.dash = 1; });
      }));
    });
    s2.appendChild(lr);
    body.appendChild(s2);

    var s3 = sec(t("el.icons"));
    var q = el("input", "inp sm");
    q.type = "search"; q.placeholder = t("el.iconsSearch"); q.setAttribute("aria-label", t("el.iconsSearch"));
    q.value = iconQuery;
    s3.appendChild(q);
    var cats = el("div", "chips");
    [["", t("el.all"), t("el.all")]].concat(ICONS.cats).forEach(function (c) {
      var b = btn("chip-btn" + (iconCat === c[0] ? " on" : ""), AT.LANG === "el" ? c[2] : c[1], function () {
        iconCat = c[0]; iconLimit = 120; renderDrawer();
      });
      cats.appendChild(b);
    });
    s3.appendChild(cats);
    var grid = el("div", "ico-grid");
    s3.appendChild(grid);
    function fill() {
      grid.innerHTML = "";
      var words = iconQuery.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      var list = ICONS.list.filter(function (e) {
        if (iconCat && e[1].indexOf(iconCat) < 0) return false;
        var hay = (e[0] + " " + e[2] + " " + e[3]).toLocaleLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (!list.length) grid.appendChild(el("p", "hint", t("el.iconsNone")));
      list.slice(0, iconLimit).forEach(function (e) {
        var b = el("button", "el-tile ico");
        b.type = "button";
        b.title = e[0].replace(/-/g, " "); b.setAttribute("aria-label", b.title);
        b.appendChild(AT.libIcon(e, 26));
        b.addEventListener("click", function () {
          var s = Math.min(AT.doc.setup.w, AT.doc.setup.h) * 0.25;
          ED.add({ k: "icon", ico: e[0], sc: "#000000", w: s, h: s, sw: 2 });
        });
        grid.appendChild(b);
      });
      if (list.length > iconLimit) {
        grid.appendChild(btn("btn small block", "+" + (list.length - iconLimit), function () { iconLimit += 240; fill(); }));
      }
    }
    q.addEventListener("input", function () { iconQuery = q.value; iconLimit = 120; fill(); });
    fill();
    s3.appendChild(el("p", "hint", t("el.iconsCredit")));
    body.appendChild(s3);
  };

  // --- Text ---
  function baseSize() { return Math.min(AT.doc.setup.w, AT.doc.setup.h); }
  VIEWS.text = function (body) {
    var s = sec();
    var b0 = baseSize();
    [["heading", 0.09, 1, "txt.headingT"], ["sub", 0.055, 1, "txt.subT"], ["body", 0.035, 0, "txt.bodyT"]].forEach(function (k) {
      var b = btn("text-add " + k[0], t("txt." + k[0]), function () {
        ED.add({ k: "text", tx: t(k[3]), size: Math.round(b0 * k[1]), b: k[2], fc: "#000000", autoW: 1 }, { edit: true });
      });
      s.appendChild(b);
    });
    body.appendChild(s);
    var s2 = sec(t("txt.combos"));
    var g = el("div", "combo-grid");
    var combos = [
      ["neon", { fc: "#ff4fd8", b: 1, tfx: { type: "neon", blur: 40 } }, "#14141f"],
      ["outline", { fc: "#ffde59", b: 1, tfx: { type: "outline", color: "#000000", thick: 50 } }],
      ["curved", { fc: "#5e17eb", b: 1, cv: 45 }],
      ["shadow", { fc: "#ff5757", b: 1, tfx: { type: "shadow", color: "#000000", alpha: 40 } }],
      ["label", { fc: "#ffffff", b: 1, tfx: { type: "background", color: "#5e17eb", alpha: 100 } }]
    ];
    combos.forEach(function (c) {
      var b = btn("combo", t("txt." + c[0]), function () {
        var spec = { k: "text", tx: t("txt." + c[0]), size: Math.round(b0 * 0.08), autoW: 1 };
        Object.keys(c[1]).forEach(function (k) { spec[k] = c[1][k]; });
        ED.add(spec);
      });
      b.style.color = c[1].fc;
      if (c[2]) b.style.background = c[2];
      if (c[0] === "outline") b.style.webkitTextStroke = "1px #000";
      if (c[0] === "neon") b.style.textShadow = "0 0 6px " + c[1].fc;
      if (c[0] === "label") { b.style.background = "#5e17eb"; }
      if (c[0] === "shadow") b.style.textShadow = "2px 2px 2px rgba(0,0,0,0.4)";
      g.appendChild(b);
    });
    s2.appendChild(g);
    body.appendChild(s2);
  };

  // --- Uploads ---
  var upThumbs = {}, sessionUploads = [];
  AT.noteUpload = function (id) { if (sessionUploads.indexOf(id) < 0) sessionUploads.unshift(id); };
  function assetThumb(id, img) {
    if (upThumbs[id]) { img.src = upThumbs[id]; return; }
    A.load(id).then(function (im) {
      if (!im) return;
      var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = 160 / Math.max(w, h);
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      upThumbs[id] = c.toDataURL("image/jpeg", 0.8);
      img.src = upThumbs[id];
    });
  }
  VIEWS.uploads = function (body) {
    var s = sec();
    s.appendChild(btn("btn primary block", t("up.add"), function () { AT.io.uploadImage(); }));
    s.appendChild(el("p", "hint", t("up.hint")));
    body.appendChild(s);
    var ids = sessionUploads.slice();
    AT.data().docs.forEach(function (d) { AX.assetIds(d).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    var s2 = sec(t("up.used"));
    if (!ids.length) s2.appendChild(el("p", "hint", t("up.none")));
    var g = el("div", "up-grid");
    ids.forEach(function (id) {
      var b = el("button", "up-tile");
      b.type = "button";
      var img = el("img"); img.alt = "";
      assetThumb(id, img);
      b.appendChild(img);
      b.addEventListener("click", function () {
        A.load(id).then(function (im) {
          if (!im) { AT.toast(t("img.missing")); return; }
          AT.io.placePhoto({ id: id, w: im.naturalWidth || im.width, h: im.naturalHeight || im.height, name: "" });
        });
      });
      g.appendChild(b);
    });
    s2.appendChild(g);
    body.appendChild(s2);
  };

  // --- Background ---
  function bgItem() { return AX.background(AT.doc, ED.pg); }
  function ensureBg(fn) {
    AT.op(function (d, nw) {
      var bg = AX.background(d, ED.pg);
      if (!bg) bg = AX.addBackground(d, ED.pg, "#ffffff", nw);
      if (!bg) return false;
      if (fn(bg, d, nw) === false) return false;
      M.touch(bg, nw);
    });
  }
  VIEWS.background = function (body) {
    var bg = bgItem();
    var s = sec(t("bg.colour"));
    s.appendChild(swatches(bg && bg.ax.k === "shape" && !bg.ax.g ? bg.ax.fc : null, function (c) {
      ensureBg(function (b, d, nw) {
        if (b.ax.k !== "shape") return replaceBgWithColour(d, b, c, nw);
        b.ax.fc = c; delete b.ax.g;
      });
    }, true));
    body.appendChild(s);
    var s2 = sec(t("bg.gradients"));
    var g = el("div", "swp");
    GRADIENTS.forEach(function (gr) {
      var b = el("button", "sw grad");
      b.type = "button";
      b.style.background = "linear-gradient(135deg," + gr[0] + "," + gr[1] + ")";
      b.addEventListener("click", function () {
        ensureBg(function (x, d, nw) {
          if (x.ax.k !== "shape") { replaceBgWithColour(d, x, gr[0], nw); x = AX.background(d, ED.pg); }
          x.ax.g = { a: gr[0], b: gr[1], ang: 135 };
          x.ax.fc = gr[0];
        });
      });
      g.appendChild(b);
    });
    s2.appendChild(g);
    if (bg && bg.ax.g) {
      s2.appendChild(slider(t("col.angle"), -180, 180, 5, bg.ax.g.ang, function (v) {
        ensureBg(function (x) { if (!x.ax.g) return false; x.ax.g.ang = v; });
      }, function (v) { return v + "°"; }));
    }
    body.appendChild(s2);
    var s3 = sec();
    var one = sel1();
    if (one && one.ax.k === "photo" && one.a) {
      s3.appendChild(btn("btn block", t("bg.photo"), function () {
        var id = one.id;
        AT.op(function (d, nw) {
          var it = M.find(d.items, id), old = AX.background(d, ED.pg);
          if (!it) return false;
          if (old) { d.items = d.items.filter(function (x) { return x !== old; }); d.tombs[old.id] = nw; }
          it.x = 0; it.y = 0; it.w = d.setup.w; it.h = d.setup.h; it.rot = 0; it.fit = "fill";
          it.ax.bg = 1; it.z = -1e9; it.lock = 1; delete it.ax.shp;
          M.touch(it, nw);
        });
        ED.select([]);
      }));
    }
    if (bg && bg.ax.k === "photo") {
      s3.appendChild(btn("btn block", t("bg.clearPhoto"), function () {
        ensureBg(function (b, d, nw) { return replaceBgWithColour(d, b, "#ffffff", nw); });
      }));
    }
    if (s3.childNodes.length) body.appendChild(s3);
  };
  function replaceBgWithColour(d, old, colour, nw) {
    d.items = d.items.filter(function (x) { return x !== old; });
    d.tombs[old.id] = nw;
    AX.addBackground(d, ED.pg, colour, nw);
  }

  // --- Colour ---
  function docColours() {
    var seen = {}, out = [];
    function add(c) { if (c && !seen[c]) { seen[c] = 1; out.push(c); } }
    AT.doc.items.forEach(function (it) {
      var a = it.ax || {};
      add(a.fc); add(a.sc);
      if (a.g) { add(a.g.a); add(a.g.b); }
      if (a.tfx) add(a.tfx.color);
    });
    return out.slice(0, 24);
  }
  var photoPal = {};
  function photoColours(cb) {
    var ids = AX.assetIds(AT.doc).slice(0, 4), out = [], left = ids.length;
    if (!left) { cb([]); return; }
    ids.forEach(function (id) {
      if (photoPal[id]) { out = out.concat(photoPal[id]); if (!--left) cb(out); return; }
      A.load(id).then(function (im) {
        if (im) {
          var c = document.createElement("canvas"), w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = 120 / Math.max(w, h);
          c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          var g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(im, 0, 0, c.width, c.height);
          photoPal[id] = FX.paletteOf(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 5);
          out = out.concat(photoPal[id]);
        }
        if (!--left) cb(out);
      }, function () { if (!--left) cb(out); });
    });
  }
  function swatches(current, pick, noNone, list) {
    var g = el("div", "swp");
    if (!noNone) {
      var n = el("button", "sw none" + (current === "" ? " on" : ""));
      n.type = "button"; n.title = t("col.none"); n.setAttribute("aria-label", t("col.none"));
      n.addEventListener("click", function () { pick(""); });
      g.appendChild(n);
    }
    (list || PALETTE).forEach(function (c) {
      var b = el("button", "sw" + (current === c ? " on" : ""));
      b.type = "button"; b.style.background = c; b.title = c; b.setAttribute("aria-label", c);
      b.addEventListener("click", function () { pick(c); });
      g.appendChild(b);
    });
    return g;
  }

  // colour of the selection for the current target
  function currentColour(it, kind) {
    var a = it.ax || {};
    if (kind === "fx") return a.tfx ? a.tfx.color : "";
    if (kind === "stroke") return a.sc || "";
    if (it.ax.k === "icon" || it.ax.k === "line") return a.sc || "";
    return a.fc || "";
  }
  function setColour(kind, c) {
    if (kind === "bg") {
      ensureBg(function (b, d, nw) {
        if (b.ax.k !== "shape") return replaceBgWithColour(d, b, c || "#ffffff", nw);
        b.ax.fc = c || "#ffffff"; delete b.ax.g;
      });
      return;
    }
    edit(function (it) {
      var a = it.ax;
      if (kind === "fx") { if (!a.tfx) return false; a.tfx.color = c || "#000000"; return; }
      if (kind === "stroke") { a.sc = c; if (c && !(it.sw > 0)) it.sw = Math.max(1, Math.min(it.w, it.h) / 60); return; }
      if (a.k === "icon" || a.k === "line") { a.sc = c || "#000000"; return; }
      if (a.k === "text") { a.fc = c || "#000000"; return; }
      if (a.k === "shape") { a.fc = c; delete a.g; }
    });
  }
  function openColour(target) { openView("colour", target); }

  VIEWS.colour = function (body) {
    var kind = colourTarget ? colourTarget.kind : "fill";
    var it = sel1();
    var cur = kind === "bg" ? (bgItem() && bgItem().ax.fc) || "" : it ? currentColour(it, kind) : "";
    var allowNone = kind === "stroke" || (kind === "fill" && it && it.ax.k === "shape");
    var s0 = sec(t("col.doc"));
    var dc = docColours();
    if (dc.length) { s0.appendChild(swatches(cur, function (c) { setColour(kind, c); }, true, dc)); body.appendChild(s0); }
    var s1 = sec(t("col.default"));
    s1.appendChild(swatches(cur, function (c) { setColour(kind, c); }, !allowNone));
    body.appendChild(s1);
    var s2 = sec(t("col.custom"));
    var row = el("div", "pn-row");
    var inp = el("input");
    inp.type = "color"; inp.value = cur || "#000000";
    inp.addEventListener("input", function () { AT.beginGesture(); setColour(kind, inp.value); });
    inp.addEventListener("change", function () { AT.endGesture(); });
    var hex = el("input", "inp sm hex");
    hex.value = cur || ""; hex.maxLength = 7; hex.setAttribute("aria-label", "Hex");
    hex.addEventListener("change", function () { var c = FX.normColor(hex.value); if (c) setColour(kind, c); });
    row.appendChild(inp); row.appendChild(hex);
    s2.appendChild(row);
    body.appendChild(s2);
    var s3 = sec(t("col.photo"));
    var holder = el("div");
    s3.appendChild(holder);
    photoColours(function (list) {
      if (!list.length) { s3.remove(); return; }
      holder.appendChild(swatches(cur, function (c) { setColour(kind, c); }, true, list));
    });
    body.appendChild(s3);
    // gradient for shapes
    if (kind === "fill" && it && it.ax.k === "shape") {
      var s4 = sec(t("col.gradient"));
      var seg = el("div", "seg");
      var on = !!it.ax.g;
      seg.appendChild(btn("seg-btn" + (on ? "" : " on"), t("col.solid"), function () { edit(function (x) { delete x.ax.g; }); }));
      seg.appendChild(btn("seg-btn" + (on ? " on" : ""), t("col.gradient"), function () {
        edit(function (x) { if (!x.ax.g) x.ax.g = { a: x.ax.fc || "#8c52ff", b: FX.mix(x.ax.fc || "#8c52ff", "#ffffff", 0.6), ang: 90 }; });
      }));
      s4.appendChild(seg);
      if (on) {
        var r2 = el("div", "grid2");
        ["a", "b"].forEach(function (k) {
          var f = el("label", "fld");
          f.appendChild(el("span", "fld-lbl", t(k === "a" ? "col.from" : "col.to")));
          var ci = el("input");
          ci.type = "color"; ci.value = it.ax.g[k];
          ci.addEventListener("input", function () { AT.beginGesture(); edit(function (x) { if (x.ax.g) x.ax.g[k] = ci.value; }); });
          ci.addEventListener("change", function () { AT.endGesture(); });
          f.appendChild(ci);
          r2.appendChild(f);
        });
        s4.appendChild(r2);
        s4.appendChild(slider(t("col.angle"), -180, 180, 5, it.ax.g.ang, function (v) { edit(function (x) { if (x.ax.g) x.ax.g.ang = v; }); }, function (v) { return v + "°"; }));
      }
      body.appendChild(s4);
    }
  };

  // --- Effects (text) ---
  var FX_PARAMS = {
    shadow: ["off", "dir", "blur", "alpha", "color"], lift: ["blur", "alpha"], hollow: ["thick"],
    outline: ["thick", "color"], splice: ["thick", "off", "dir", "color"], echo: ["off", "dir"],
    glitch: ["off"], neon: ["blur"], background: ["pad", "round", "alpha", "color"]
  };
  VIEWS.effects = function (body) {
    var it = sel1();
    if (!it || it.ax.k !== "text") { body.appendChild(el("p", "hint", t("ctx.hint"))); return; }
    var cur = it.ax.tfx ? it.ax.tfx.type : "none";
    var g = el("div", "fx-grid");
    FX.TEXT_FX.forEach(function (f) {
      var b = btn("fx-tile" + (cur === f.id ? " on" : ""), "", function () {
        edit(function (x) {
          if (f.id === "none") delete x.ax.tfx;
          else x.ax.tfx = FX.normTextFx({ type: f.id, color: f.id === "background" ? "#ffde59" : f.id === "splice" ? "#38b6ff" : "#000000",
            alpha: f.id === "background" ? 100 : 50 });
        });
      });
      var prev = el("span", "fx-prev fx-" + f.id, "Ag");
      b.appendChild(prev);
      b.appendChild(el("span", "fx-name", AT.lbl(f)));
      g.appendChild(b);
    });
    body.appendChild(g);
    if (cur !== "none") {
      var s = sec();
      var fx = it.ax.tfx;
      (FX_PARAMS[cur] || []).forEach(function (p) {
        if (p === "color") {
          var r = el("div", "pn-row");
          r.appendChild(el("span", "fld-lbl", t("fx.color")));
          r.appendChild(colourBtn(t("fx.color"), fx.color, null, { kind: "fx" }));
          s.appendChild(r);
          return;
        }
        var min = p === "dir" ? -180 : 0, max = p === "dir" ? 180 : 100;
        s.appendChild(slider(t("fx." + p), min, max, 1, fx[p], function (v) { edit(function (x) { if (x.ax.tfx) x.ax.tfx[p] = v; }); }));
      });
      body.appendChild(s);
    }
    var s2 = sec(t("fx.curve"));
    s2.appendChild(slider(t("fx.curve"), -100, 100, 1, it.ax.cv || 0, function (v) {
      edit(function (x) {
        x.ax.cv = v;
        if (v) x.w = AX.curveLayout(M.normItem(x) || x).w;
        else x.w = Math.max(x.w, Math.min(AT.doc.setup.w, AX.textWidth(x.ax)));
      });
    }));
    body.appendChild(s2);
  };

  // --- Filters (photos) ---
  var filterThumbs = {};
  VIEWS.filters = function (body) {
    var it = sel1();
    if (!it || it.ax.k !== "photo") { body.appendChild(el("p", "hint", t("ctx.hint"))); return; }
    var g = el("div", "flt-grid");
    var img = it.a ? A.get(it.a) : null;
    FX.FILTERS.forEach(function (f) {
      var on = (it.ax.flt || "none") === f.id;
      var b = btn("flt-tile" + (on ? " on" : ""), "", function () { edit(function (x) { if (f.id === "none") delete x.ax.flt; else x.ax.flt = f.id; }); });
      var th = el("span", "flt-thumb");
      if (img) {
        var key = it.a + "|" + f.id;
        if (!filterThumbs[key]) {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = 120 / Math.max(w, h);
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
          FX.applyToCanvas(c, FX.filterById(f.id).p);
          filterThumbs[key] = c.toDataURL("image/jpeg", 0.8);
        }
        var im = el("img"); im.alt = ""; im.src = filterThumbs[key];
        th.appendChild(im);
      }
      b.appendChild(th);
      b.appendChild(el("span", "flt-name", AT.lbl(f)));
      g.appendChild(b);
    });
    body.appendChild(g);
  };

  // --- Adjust (photos) ---
  VIEWS.adjust = function (body) {
    var it = sel1();
    if (!it || it.ax.k !== "photo") { body.appendChild(el("p", "hint", t("ctx.hint"))); return; }
    var adj = FX.normAdjust(it.ax.adj);
    var s = sec();
    FX.ADJUST.forEach(function (a) {
      s.appendChild(slider(t("adj." + a.id), a.min, a.max, 1, adj[a.id], function (v) {
        edit(function (x) { var p = FX.normAdjust(x.ax.adj); p[a.id] = v; x.ax.adj = p; });
      }));
    });
    s.appendChild(btn("btn small block", t("adj.reset"), function () { edit(function (x) { delete x.ax.adj; }); }));
    body.appendChild(s);
  };

  // --- Mask (photos) ---
  VIEWS.mask = function (body) {
    var it = sel1();
    if (!it || it.ax.k !== "photo") { body.appendChild(el("p", "hint", t("ctx.hint"))); return; }
    var g = el("div", "el-grid");
    var none = el("button", "el-tile" + (!it.ax.shp ? " on" : ""));
    none.type = "button"; none.title = t("mask.none"); none.setAttribute("aria-label", t("mask.none"));
    none.appendChild(AT.svgPath("M4 4H36V36H4Z", 40, 40, "none"));
    none.firstChild.firstChild.setAttribute("stroke", "currentColor");
    none.firstChild.firstChild.setAttribute("stroke-width", "2");
    none.addEventListener("click", function () { edit(function (x) { delete x.ax.shp; }); });
    g.appendChild(none);
    FX.SHAPES.forEach(function (sh) {
      if (sh.id === "rect") return;
      var b = el("button", "el-tile" + (it.ax.shp === sh.id ? " on" : ""));
      b.type = "button";
      b.title = AT.lbl(sh); b.setAttribute("aria-label", AT.lbl(sh));
      b.appendChild(AT.svgPath(FX.toSvgPath(FX.shapePath(sh.id, 40, 40, {})), 40, 40));
      b.addEventListener("click", function () { edit(function (x) { x.ax.shp = sh.id; }); });
      g.appendChild(b);
    });
    body.appendChild(g);
  };

  // --- Position ---
  VIEWS.position = function (body) {
    var list = ED.selItems().filter(function (it) { return !(it.ax && it.ax.bg); });
    if (!list.length) { body.appendChild(el("p", "hint", t("ctx.hint"))); return; }
    var s1 = sec(t("pos.layer"));
    var r1 = el("div", "grid2");
    ["front", "fwd", "bwd", "back"].forEach(function (k) { r1.appendChild(btn("btn small", t("pos." + k), function () { ED.arrange(k); })); });
    s1.appendChild(r1);
    body.appendChild(s1);
    var s2 = sec(list.length > 1 ? t("pos.alignSel") : t("pos.align"));
    var r2 = el("div", "grid3");
    ["al", "ac", "ar", "at", "am", "ab"].forEach(function (k) { r2.appendChild(btn("btn small", t("pos." + k), function () { ED.align(k); })); });
    s2.appendChild(r2);
    body.appendChild(s2);
    if (list.length === 1) {
      var it = list[0];
      var s3 = sec(t("pos.size"));
      var g = el("div", "grid2");
      function num(lbl, val, apply) {
        var f = el("label", "fld");
        f.appendChild(el("span", "fld-lbl", lbl));
        var i = el("input", "inp sm num");
        i.type = "text"; i.inputMode = "decimal"; i.value = val;
        i.addEventListener("change", function () { apply(i.value); });
        i.addEventListener("keydown", function (e) { if (e.key === "Enter") i.blur(); });
        f.appendChild(i);
        g.appendChild(f);
      }
      num(t("pos.x"), AT.fmtLen(it.x), function (v) { var n = AT.parseLen(v); if (n !== null) edit(function (x) { x.x = n; }); });
      num(t("pos.y"), AT.fmtLen(it.y), function (v) { var n = AT.parseLen(v); if (n !== null) edit(function (x) { x.y = n; }); });
      if (it.t !== "line") {
        num(t("pos.w"), AT.fmtLen(it.w), function (v) {
          var n = AT.parseLen(v);
          if (n === null || n < 1) return;
          edit(function (x) {
            if (x.ax.k === "text" && !x.ax.cv) { x.w = n; return; }
            if (x.ax.k === "icon" || x.ax.k === "text") { var k = n / x.w; x.h *= k; if (x.ax.k === "text") x.ax.size *= k; }
            x.w = n;
            ED.coverClamp(x);
          });
        });
        num(t("pos.h"), AT.fmtLen(it.h), function (v) {
          var n = AT.parseLen(v);
          if (n === null || n < 1) return;
          edit(function (x) {
            if (x.ax.k === "text") return false;
            if (x.ax.k === "icon") x.w = x.w * n / x.h;
            x.h = n;
            ED.coverClamp(x);
          });
        });
        num(t("pos.rot"), String(Math.round(it.rot || 0)), function (v) {
          var n = parseFloat(String(v).replace(",", "."));
          if (isFinite(n)) edit(function (x) { x.rot = ((n + 180) % 360 + 360) % 360 - 180; });
        });
      }
      s3.appendChild(g);
      s3.appendChild(el("p", "hint", AT.unitLbl()));
      body.appendChild(s3);
    }
  };

  // ---------- 3. Context bar ----------
  function renderCtx() {
    var bar = $("ctx");
    if (!bar || !AT.doc) return;
    if (bar.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") return;
    bar.innerHTML = "";
    var list = ED.selItems();
    if (ED.cropId) return;
    if (!list.length) {
      var bg = bgItem();
      bar.appendChild(colourBtn(t("ctx.bg"), bg && bg.ax.k === "shape" ? bg.ax.fc : "", bg && bg.ax.g, { kind: "bg" }));
      var bb = btn("ctx-txt", t("ctx.bg"), function () { openView("background"); });
      bar.appendChild(bb);
      bar.appendChild(btn("ctx-txt" + (view === "animate" ? " on" : ""), t("ctx.animate"), function () { openView("animate"); }));
      bar.appendChild(el("span", "ctx-hint", t("ctx.hint")));
      return;
    }
    var one = list.length === 1 ? list[0] : null;
    var k = one ? one.ax.k : "";
    if (one && one.lock) {
      bar.appendChild(tool("unlock", t("ctx.unlock"), function () { edit(function (it) { it.lock = 0; }); }, true));
      return;
    }
    if (k === "text") textTools(bar, one);
    else if (k === "shape") shapeTools(bar, one);
    else if (k === "icon") iconTools(bar, one);
    else if (k === "photo") photoTools(bar, one);
    else if (k === "line") lineTools(bar, one);
    else bar.appendChild(el("span", "ctx-hint", t("ctx.n", { n: list.length })));
    bar.appendChild(sep());
    bar.appendChild(tool("position", t("ctx.position"), function () { openView("position"); }, view === "position"));
    bar.appendChild(tool("op", t("ctx.op"), opacityPop));
    bar.appendChild(tool("anim", t("ctx.animate"), function () { openView("animate"); }, view === "animate"));
    bar.appendChild(tool("lock", t("ctx.lock"), function () { edit(function (it) { it.lock = 1; }); }));
    bar.appendChild(tool("copy", t("ctx.dup"), ED.duplicate));
    bar.appendChild(tool("trash", t("ctx.del"), ED.remove));
  }
  AT.renderCtx = renderCtx;

  function opacityPop(anchor) {
    var it = ED.selItems()[0];
    AT.popover(anchor, function (m) {
      m.appendChild(slider(t("ctx.op"), 0, 100, 1, it ? it.op : 100, function (v) { edit(function (x) { x.op = v; }); }, function (v) { return v + "%"; }));
    });
  }

  function textTools(bar, it) {
    var a = it.ax;
    var f = el("select", "ctx-sel");
    f.setAttribute("aria-label", t("ctx.font")); f.title = t("ctx.font");
    T.FAMILY_IDS.forEach(function (id) {
      var o = el("option", "", T.FAMILIES[id].name);
      o.value = id; if ((a.font || "sans") === id) o.selected = true;
      f.appendChild(o);
    });
    f.addEventListener("change", function () { var v = f.value; f.blur(); edit(function (x) { x.ax.font = v; }); });
    bar.appendChild(f);
    var sz = el("div", "ctx-size");
    var minus = AT.iconBtn("minus", t("ctx.size"), "ctx-btn sm");
    var inp = el("input", "inp sm num");
    inp.type = "text"; inp.inputMode = "decimal"; inp.value = String(Math.round(a.size * 10) / 10);
    inp.setAttribute("aria-label", t("ctx.size")); inp.title = t("ctx.size");
    var plus = AT.iconBtn("plus", t("ctx.size"), "ctx-btn sm");
    function setSize(v) { if (v > 0) edit(function (x) { x.ax.size = Math.min(2000, Math.max(2, v)); if (x.ax.cv) x.w = AX.curveLayout(M.normItem(x)).w; }); }
    minus.addEventListener("click", function () { setSize(Math.round(a.size / 1.1)); });
    plus.addEventListener("click", function () { setSize(Math.round(a.size * 1.1)); });
    inp.addEventListener("change", function () { var v = parseFloat(inp.value.replace(",", ".")); inp.blur(); setSize(v); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    sz.appendChild(minus); sz.appendChild(inp); sz.appendChild(plus);
    bar.appendChild(sz);
    bar.appendChild(colourBtn(t("ctx.colour"), a.fc || "#000000", null, { kind: "fill" }));
    bar.appendChild(tool("bold", t("ctx.bold"), function () { edit(function (x) { x.ax.b = x.ax.b ? 0 : 1; }); }, !!a.b));
    bar.appendChild(tool("italic", t("ctx.italic"), function () { edit(function (x) { x.ax.i = x.ax.i ? 0 : 1; }); }, !!a.i));
    bar.appendChild(tool("underline", t("ctx.underline"), function () { edit(function (x) { x.ax.u = x.ax.u ? 0 : 1; }); }, !!a.u));
    bar.appendChild(tool("caps", t("ctx.caps"), function () { edit(function (x) { x.ax.caps = x.ax.caps ? 0 : 1; }); }, !!a.caps));
    var al = a.al || "l", nextAl = { l: "c", c: "r", r: "j", j: "l" };
    bar.appendChild(tool("a" + al, t("ctx.align"), function () { edit(function (x) { x.ax.al = nextAl[x.ax.al || "l"]; }); }));
    bar.appendChild(tool("spacing", t("ctx.spacing"), function (b) {
      AT.popover(b, function (m) {
        m.appendChild(slider(t("ctx.lh"), 70, 300, 5, a.lh || 120, function (v) { edit(function (x) { x.ax.lh = v; }); }, function (v) { return (v / 100).toFixed(2); }));
        m.appendChild(slider(t("ctx.tr"), -200, 1000, 10, a.tr || 0, function (v) { edit(function (x) { x.ax.tr = v; if (x.ax.cv) x.w = AX.curveLayout(M.normItem(x)).w; }); }));
      });
    }));
    bar.appendChild(btn("ctx-txt" + (view === "effects" ? " on" : ""), t("ctx.effects"), function () { openView("effects"); }));
    bar.appendChild(tool("edit", t("ctx.edit"), function () { ED.enterText(it.id); }));
  }

  function shapeTools(bar, it) {
    var a = it.ax;
    bar.appendChild(colourBtn(t("ctx.fill"), a.fc, a.g, { kind: "fill" }));
    var sb = colourBtn(t("ctx.stroke"), a.sc && it.sw > 0 ? a.sc : "", null, { kind: "stroke" });
    sb.classList.add("stroke");
    bar.appendChild(sb);
    bar.appendChild(btn("ctx-txt", t("ctx.sw"), function (e) {
      AT.popover(e.currentTarget, function (m) {
        var mx = Math.max(20, Math.round(Math.min(it.w, it.h) / 4));
        m.appendChild(slider(t("ctx.weight"), 0, mx, mx > 60 ? 1 : 0.5, it.sw || 0, function (v) {
          edit(function (x) { x.sw = v; if (v > 0 && !x.ax.sc) x.ax.sc = "#000000"; });
        }));
        var c = el("label", "chk");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = !!it.dash;
        cb.addEventListener("change", function () { edit(function (x) { x.dash = cb.checked ? 1 : 0; }); });
        c.appendChild(cb); c.appendChild(el("span", "", t("ctx.dashed")));
        m.appendChild(c);
      });
    }));
    if (a.shp === "rounded" || a.shp === "bubble") {
      bar.appendChild(btn("ctx-txt", t("ctx.round"), function (e) {
        AT.popover(e.currentTarget, function (m) {
          m.appendChild(slider(t("ctx.round"), 0, 100, 1, a.rd === undefined ? AX.RD_DEF : a.rd, function (v) { edit(function (x) { x.ax.rd = v; }); }));
        });
      }));
    }
  }

  function iconTools(bar, it) {
    bar.appendChild(colourBtn(t("ctx.colour"), it.ax.sc || "#000000", null, { kind: "fill" }));
    bar.appendChild(btn("ctx-txt", t("ctx.weight"), function (e) {
      AT.popover(e.currentTarget, function (m) {
        m.appendChild(slider(t("ctx.weight"), 0.5, 4, 0.25, it.sw > 0 ? it.sw : 2, function (v) { edit(function (x) { x.sw = v; }); }));
      });
    }));
  }

  function lineTools(bar, it) {
    bar.appendChild(colourBtn(t("ctx.colour"), it.ax.sc || "#000000", null, { kind: "fill" }));
    bar.appendChild(btn("ctx-txt", t("ctx.weight"), function (e) {
      AT.popover(e.currentTarget, function (m) {
        var mx = Math.max(20, Math.round(Math.min(AT.doc.setup.w, AT.doc.setup.h) / 20));
        m.appendChild(slider(t("ctx.weight"), 0.5, mx, 0.5, it.sw || 1, function (v) { edit(function (x) { x.sw = v; }); }));
        var c = el("label", "chk");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = !!it.dash;
        cb.addEventListener("change", function () { edit(function (x) { x.dash = cb.checked ? 1 : 0; }); });
        c.appendChild(cb); c.appendChild(el("span", "", t("ctx.dashed")));
        m.appendChild(c);
      });
    }));
    ["as", "ae"].forEach(function (end) {
      bar.appendChild(btn("ctx-txt", t(end === "as" ? "ctx.start" : "ctx.end"), function (e) {
        AT.menu(e.currentTarget, AX.HEADS.map(function (hd) {
          return { label: t("ctx.head." + (hd || "none")), on: (it.ax[end] || "") === hd, fn: function () { edit(function (x) { if (hd) x.ax[end] = hd; else delete x.ax[end]; }); } };
        }));
      }));
    });
  }

  function photoTools(bar, it) {
    bar.appendChild(btn("ctx-txt" + (view === "filters" ? " on" : ""), t("ctx.filters"), function () { openView("filters"); }));
    bar.appendChild(btn("ctx-txt" + (view === "adjust" ? " on" : ""), t("ctx.adjust"), function () { openView("adjust"); }));
    bar.appendChild(tool("crop", t("ctx.crop"), function () { ED.enterCrop(it.id); }));
    bar.appendChild(tool("flip", t("ctx.flip"), function (b) {
      AT.menu(b, [
        { label: t("ctx.flipH"), on: !!it.ax.flh, fn: function () { edit(function (x) { x.ax.flh = x.ax.flh ? 0 : 1; }); } },
        { label: t("ctx.flipV"), on: !!it.ax.flv, fn: function () { edit(function (x) { x.ax.flv = x.ax.flv ? 0 : 1; }); } }
      ]);
    }));
    bar.appendChild(tool("mask", t("ctx.mask"), function () { openView("mask"); }, view === "mask"));
    bar.appendChild(tool("replace", t("ctx.replace"), function () { AT.io.uploadImage(it.id); }));
  }

  // ---------- 4. Wiring ----------
  var CONTEXT_VIEWS = { colour: 1, effects: 1, filters: 1, adjust: 1, mask: 1, position: 1, animate: 1 };
  function viewFits() {
    if (!view || !CONTEXT_VIEWS[view] || view === "animate") return true;
    var one = sel1(), list = ED.selItems();
    if (view === "position") return list.length > 0;
    if (view === "colour") return colourTarget && colourTarget.kind === "bg" ? true : !!one;
    if (view === "effects") return one && one.ax.k === "text";
    return one && one.ax.k === "photo";
  }

  AT.on("boot", function () {
    $("drawer-close").addEventListener("click", closeDrawer);
    AT.setIcon($("drawer-close"), "close", t("drawer.close"));
    renderRail();
  });
  AT.on("open", function () {
    closeDrawer();
    if (window.matchMedia && window.matchMedia("(min-width: 1000px)").matches) openView("templates");
    renderCtx();
  });
  AT.on("sel", function () {
    if (!viewFits()) closeDrawer();
    else if (view && CONTEXT_VIEWS[view]) renderDrawer();
    renderCtx();
  });
  AT.on("doc", function () {
    if (AT.inGesture()) return;
    renderCtx();
    if (view && view !== "elements" && view !== "templates" && view !== "text" && !$("drawer").contains(document.activeElement)) renderDrawer();
  });
  AT.on("remote", function () { renderCtx(); renderDrawer(); });
})();
