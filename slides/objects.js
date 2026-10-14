// ============================================================
// orOS Slides — objects.js: charts, tables, animated frames (v1.0.0)
//   - charts: the picture of a chart comes from the Spreadsheet's
//     chart engine (spreadsheet/sheetkit.js, OrosSheetKit.chartModel +
//     chartSVG), drawn once into a canvas and cached by content
//     (dk.js chartSpec / chartKey). SL.getImage(name) hands designkit
//     a chart picture or a stored picture (designkit/assets.js).
//   - SL.renderFrame(slideId, canvas, { step, t, still }): one frame
//     of a slide with its build animations (slides/anim.js): hidden
//     objects and paragraphs left out, the ones coming in drawn faded,
//     moved or scaled. The show and the editor's preview use it.
//   - the table and chart editors (dialogs).
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = SL.C, t = SL.t, el = SL.el;
  var K = window.OrosSheetKit, AN = window.OrosSlidesAnim;

  // ---------- 1. Chart pictures ----------
  var specs = {}, pics = {}, order = [], MAX_PICS = 80;
  function chartSvg(spec) {
    var model = K.chartModel(SL.D.chartGrid({ rows: spec.rows }), { by: spec.by, t: spec.t });
    return K.chartSVG(model, {
      t: spec.t, w: spec.w, h: spec.h, ttl: spec.ttl, lg: spec.lg, co: spec.co, lang: spec.lang, pal: spec.pal,
      empty: t("ch.empty"), seriesWord: t("ch.series"), otherWord: t("ch.other")
    });
  }
  function rasterize(key) {
    var spec = specs[key];
    return new Promise(function (resolve) {
      if (!spec || !K) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = spec.w * spec.px; cv.height = spec.h * spec.px;
        try { cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); } catch (e) { resolve(null); return; }
        resolve(cv);
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(chartSvg(spec));
    });
  }
  function want(key, spec) {
    if (!specs[key]) specs[key] = spec;
  }
  function load(key) {
    var c = pics[key];
    if (c) return c.p;
    c = pics[key] = { cv: null, p: null };
    order.push(key);
    if (order.length > MAX_PICS) { var old = order.shift(); delete pics[old]; }
    c.p = rasterize(key).then(function (cv) {
      c.cv = cv;
      SL.emit("assets");
      if (SL.showCtl && !SL.showCtl.state().closed) SL.showCtl.refresh();
      return cv;
    });
    return c.p;
  }
  function isChart(name) { return Object.prototype.hasOwnProperty.call(specs, name); }
  SL.charts = {
    want: want, load: load, has: isChart, svg: function (spec) { return chartSvg(spec); },
    register: function (built) { if (built && built.charts) Object.keys(built.charts).forEach(function (k) { want(k, built.charts[k]); }); }
  };
  // designkit's getImage: a chart picture or a stored picture
  SL.getImage = function (name) {
    if (isChart(name)) {
      var c = pics[name];
      if (!c) { load(name); return null; }
      return c.cv;
    }
    return SL.A.get(name);
  };
  // A promise of a drawable for PDF / PowerPoint export.
  SL.loadImage = function (name) { return isChart(name) ? load(name) : SL.A.load(name); };

  // ---------- 2. Frames with build animations ----------
  var off = null;
  function offscreen(w, h) {
    if (!off) off = document.createElement("canvas");
    if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
    var g = off.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }
  function linePi(ln) {
    for (var i = 0; i < ln.runs.length; i++) if (ln.runs[i].p !== undefined) return ln.runs[i].p;
    return -1;
  }
  // The plan, the built page and its layout, kept while the data stays
  // the same object (every change makes a new one), so an animation
  // does not lay the slide out again 30 times a second.
  var bases = { data: null, map: {} };
  function frameBase(data, slideId) {
    if (bases.data !== data) bases = { data: data, map: {} };
    var f = bases.map[slideId];
    if (f) return f;
    var pl = AN.plan(data, slideId), b = null, L = null;
    if (pl.clicks || pl.steps[0].length) {
      b = SL.D.slideDoc(data, slideId, { date: SL.fmtDate(Date.now(), true), lang: SL.LANG });
      SL.charts.register(b);
      L = SL.R.computeLayout(b.doc);
    }
    return (bases.map[slideId] = { pl: pl, b: b, L: L });
  }
  SL.animPlan = function (slideId) { return frameBase(SL.data(), slideId).pl; };
  // opts: { step, t (ms since the step began; undefined = finished),
  //   still (reduced motion), date }
  SL.renderFrame = function (slideId, canvas, px, opts) {
    opts = opts || {};
    var data = SL.data();
    var fr = frameBase(data, slideId);
    var pl = fr.pl;
    if (!pl.clicks && !pl.steps[0].length) return SL.renderSlide(slideId, px, { canvas: canvas });
    var st = AN.state(pl, opts.step || 0, opts.t, opts.still);
    var b = fr.b, doc = b.doc, page = doc.pages[0], R = SL.R, L = fr.L;
    var sc = px / doc.setup.w, PT = SL.D.PT;
    canvas.width = Math.max(1, Math.round(doc.setup.w * sc));
    canvas.height = Math.max(1, Math.round(doc.setup.h * sc));
    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, doc.setup.w, doc.setup.h); ctx.clip();

    // what is moving: whole objects (by slide item) and paragraphs
    var whole = {}, paraFx = {};
    st.fx.forEach(function (f) {
      var box = SL.ed.bounds(f.ids.map(function (id) { return data.items[id]; }).filter(Boolean));
      var e = { f: f, box: { x: box.x * PT, y: box.y * PT, w: box.w * PT, h: box.h * PT } };
      f.ids.forEach(function (id) {
        if (f.pi < 0) whole[id] = e;
        else (paraFx[id] = paraFx[id] || {})[f.pi] = e;
      });
    });
    function withFx(e, draw) {
      var f = e.f, p = f.p, bx = e.box;
      if (f.e === "fly") {
        var o = AN.flyFrom(bx, f.d, doc.setup.w, doc.setup.h);
        ctx.save(); ctx.translate(o.x * (1 - p), o.y * (1 - p)); draw(ctx); ctx.restore();
        return;
      }
      if (f.e === "appear") { draw(ctx); return; }
      var g = offscreen(canvas.width, canvas.height);
      g.setTransform(sc, 0, 0, sc, 0, 0);
      if (f.e === "zoom") {
        var s = 0.3 + 0.7 * p, cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
        g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
      }
      draw(g);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, p));
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
    // item by item in stacking order (what render.js drawPage does)
    SL.M.itemsOn(doc, page.id).forEach(function (it) {
      var sid = b.map[it.id];
      if (sid && st.hidden[sid]) return;
      var hideP = sid && st.paras[sid], moveP = sid && paraFx[sid];
      function lines(id) {
        var fr = L.frames[id];
        if (!fr) return null;
        if (!hideP && !moveP) return fr.lines;
        return fr.lines.filter(function (ln) { var pi = linePi(ln); return !(hideP && hideP[pi]) && !(moveP && moveP[pi]); });
      }
      var draw = function (g) { R.drawItem(g, doc, it, { lines: lines, getImage: SL.getImage, preview: true }); };
      if (sid && whole[sid]) withFx(whole[sid], draw); else draw(ctx);
      if (moveP && it.t === "text") {
        Object.keys(moveP).forEach(function (pi) {
          var bare = {};
          Object.keys(it).forEach(function (k) { bare[k] = it[k]; });
          bare.fill = ""; bare.stroke = "";
          withFx(moveP[pi], function (g) {
            R.drawItem(g, doc, bare, { lines: function (id) {
              var fr = L.frames[id];
              return fr ? fr.lines.filter(function (ln) { return String(linePi(ln)) === String(pi); }) : null;
            }, getImage: SL.getImage, preview: true });
          });
        });
      }
    });
    return canvas;
  };

  // ---------- 3. Table editor ----------
  function btn(label, fn, cls) {
    var b = el("button", "btn small" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  // A grid of inputs for rows of texts; returns { node, read() }.
  function gridEditor(rows, opts) {
    var state = rows.map(function (r) { return r.slice(); });
    var wrap = el("div", "grid-ed");
    var tools = el("div", "pn-row");
    var host = el("div", "grid-scroll");
    var tbl = null;
    function render() {
      host.innerHTML = "";
      tbl = el("table", "grid-tbl");
      state.forEach(function (row, r) {
        var tr = el("tr");
        row.forEach(function (v, c) {
          var td = el("td");
          var inp = el(opts.multiline ? "textarea" : "input", "inp sm cell");
          if (!opts.multiline) inp.type = "text";
          else inp.rows = 1;
          inp.value = v;
          inp.maxLength = opts.maxLen;
          inp.setAttribute("aria-label", t("tb.cell", { r: r + 1, c: c + 1 }));
          inp.addEventListener("input", function () { state[r][c] = inp.value; });
          inp.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !(opts.multiline && e.shiftKey)) {
              e.preventDefault();
              var n = host.querySelectorAll(".cell"), i = r * state[0].length + c;
              if (i + state[0].length < n.length) n[i + state[0].length].focus();
            }
          });
          td.appendChild(inp);
          tr.appendChild(td);
        });
        tbl.appendChild(tr);
      });
      host.appendChild(tbl);
      if (opts.onChange) opts.onChange(read());
    }
    function read() { return state.map(function (r) { return r.slice(); }); }
    function addRow() { if (state.length >= opts.maxR) return; state.push(state[0].map(function () { return ""; })); render(); }
    function delRow() { if (state.length <= 1) return; state.pop(); render(); }
    function addCol() { if (state[0].length >= opts.maxC) return; state.forEach(function (r) { r.push(""); }); render(); }
    function delCol() { if (state[0].length <= 1) return; state.forEach(function (r) { r.pop(); }); render(); }
    tools.appendChild(btn(t("tb.addRow"), addRow));
    tools.appendChild(btn(t("tb.delRow"), delRow));
    tools.appendChild(btn(t("tb.addCol"), addCol));
    tools.appendChild(btn(t("tb.delCol"), delCol));
    wrap.appendChild(tools);
    wrap.appendChild(host);
    render();
    host.addEventListener("input", function () { if (opts.onChange) opts.onChange(read()); });
    return { node: wrap, read: read };
  }

  SL.dlg = SL.dlg || {};
  SL.dlg.table = function (itemId) {
    var it = SL.data().items[itemId];
    if (!it || it.k !== "table") return;
    SL.openDialog(t("tb.edit"), function (body, close) {
      body.appendChild(el("p", "hint", t("tb.hint")));
      var g = gridEditor(it.tb.rows, { maxR: C.LIM.tRows, maxC: C.LIM.tCols, maxLen: C.LIM.cell, multiline: true });
      body.appendChild(g.node);
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var rows = g.read();
        SL.ed.editItems([itemId], function (x) { x.tb = JSON.parse(JSON.stringify(x.tb)); x.tb.rows = rows; });
        close();
      }, "primary"));
      body.appendChild(act);
      setTimeout(function () { var f = body.querySelector(".cell"); if (f) f.focus(); }, 0);
    }, true);
  };

  // ---------- 4. Chart editor ----------
  SL.dlg.chart = function (itemId) {
    var it = SL.data().items[itemId];
    if (!it || it.k !== "chart") return;
    var ch = JSON.parse(JSON.stringify(it.ch));
    SL.openDialog(t("ch.edit"), function (body, close) {
      var top = el("div", "grid2");
      var typ = el("select", "inp sm");
      typ.setAttribute("aria-label", t("ch.type"));
      C.CHART_TYPES.forEach(function (x) { var o = el("option", "", t("ch.t." + x)); o.value = x; if (ch.t === x) o.selected = true; typ.appendChild(o); });
      var f1 = el("label", "fld"); f1.appendChild(el("span", "fld-lbl", t("ch.type"))); f1.appendChild(typ);
      var ttl = el("input", "inp sm"); ttl.type = "text"; ttl.maxLength = 100; ttl.value = ch.ttl || "";
      var f2 = el("label", "fld"); f2.appendChild(el("span", "fld-lbl", t("ch.title"))); f2.appendChild(ttl);
      top.appendChild(f1); top.appendChild(f2);
      body.appendChild(top);
      var lg = el("label", "chk"), lgc = el("input"); lgc.type = "checkbox"; lgc.checked = ch.lg !== false;
      lg.appendChild(lgc); lg.appendChild(el("span", "", t("ch.legend")));
      body.appendChild(lg);
      var prev = el("div", "ch-prev");
      var pimg = el("img"); pimg.alt = t("ch.preview");
      prev.appendChild(pimg);
      body.appendChild(prev);
      body.appendChild(el("p", "hint", t("ch.hint")));
      var data = { rows: ch.rows };
      function preview() {
        var th = C.themeById(SL.curDeck().th), s = SL.data().slides[it.s];
        var spec = SL.D.chartSpec({ w: it.w, h: it.h, ch: { t: typ.value, rows: data.rows, ttl: ttl.value, lg: lgc.checked } }, th, s && s.bg, SL.LANG);
        pimg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(chartSvg(spec));
      }
      var g = gridEditor(ch.rows, { maxR: C.LIM.chRows, maxC: C.LIM.chCols, maxLen: C.LIM.chCell, onChange: function (rows) { data.rows = rows; preview(); } });
      body.appendChild(g.node);
      [typ, ttl, lgc].forEach(function (n) { n.addEventListener("input", preview); n.addEventListener("change", preview); });
      preview();
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var rows = g.read();
        SL.ed.editItems([itemId], function (x) {
          x.ch = { t: typ.value, rows: rows, ttl: ttl.value, lg: lgc.checked ? undefined : false, by: x.ch.by };
        });
        close();
      }, "primary"));
      body.appendChild(act);
    }, true);
  };

  // A new table or chart on the current slide.
  SL.newTable = function () {
    var W = SL.ed.W(), rows = [];
    for (var r = 0; r < 4; r++) { var row = []; for (var c = 0; c < 3; c++) row.push(r === 0 ? t("tb.head", { n: c + 1 }) : ""); rows.push(row); }
    var id = SL.ed.addItem({ k: "table", x: Math.round(W * 0.1), y: 260, w: Math.round(W * 0.8), h: 480, tb: { rows: rows, hd: true } });
    if (id) SL.dlg.table(id);
  };
  SL.newChart = function () {
    var W = SL.ed.W();
    var rows = [["", t("ch.s1"), t("ch.s2")], [t("ch.c1"), "12", "8"], [t("ch.c2"), "18", "11"], [t("ch.c3"), "15", "16"], [t("ch.c4"), "22", "19"]];
    var id = SL.ed.addItem({ k: "chart", x: Math.round(W * 0.15), y: 220, w: Math.round(W * 0.7), h: 620, ch: { t: "col", rows: rows } });
    if (id) SL.dlg.chart(id);
  };
})();
