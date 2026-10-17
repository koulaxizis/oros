// ============================================================
// orOS Atelier — tables and charts in the editor (v1.0.0)
//   - chart pictures: the Spreadsheet's chart engine
//     (spreadsheet/sheetkit.js chartModel + chartSVG, read-only, the
//     same engine Slides uses) draws the SVG, a canvas keeps it at the
//     resolution asked for (cached by content + size). draw.js draws
//     the picture; exports call prepare() first so it is ready.
//   - the table and chart editors (one dialog each), the context bar
//     tools of a selected table / chart, the Elements panel buttons.
// Data model + geometry: objects.js (pure) and ax.js tableLayout.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, AX = AT.AX, OB = window.AtelierObjects, K = window.OrosSheetKit;
  var M = AT.M, t = AT.t, el = AT.el;
  var ED = AT.ed;

  // ---------- 1. Chart pictures ----------
  var pics = new Map();          // spec key + "@" + factor → { cv, p }
  var MAX_PICS = 60, MAX_SIDE = 4096, MAX_PIX = 12e6;
  var STEPS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];

  function pageBg(doc, it) {
    var bg = doc && AX.background(doc, it.pg);
    return bg && bg.ax.k === "shape" && !bg.ax.g ? bg.ax.fc : (bg && bg.ax.g ? bg.ax.g.a : "#ffffff");
  }
  function specOf(doc, it) { return OB.chartSpec(it, { pageBg: pageBg(doc, it), lang: AT.BASE }); }
  function words() { return { empty: t("ch.empty"), series: t("ch.series"), other: t("ch.other") }; }
  function svgOf(spec) { return OB.chartSvg(K, spec, words()); }
  // pixels per SVG px for `scale` device px per point
  function factorFor(spec, scale) {
    var want = scale / spec.k, f = STEPS[STEPS.length - 1];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= want - 0.01) { f = STEPS[i]; break; }
    while (f > 0.5 && (spec.w * f > MAX_SIDE || spec.h * f > MAX_SIDE || spec.w * spec.h * f * f > MAX_PIX)) f /= 2;
    return f;
  }
  function rasterize(spec, f) {
    return new Promise(function (resolve) {
      if (!K) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(spec.w * f)); cv.height = Math.max(1, Math.round(spec.h * f));
        try { cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); } catch (e) { resolve(null); return; }
        resolve(cv);
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgOf(spec));
    });
  }
  var tellTimer = null;
  function tell() {
    clearTimeout(tellTimer);
    tellTimer = setTimeout(function () { AT.emit("charts"); }, 60);
  }
  function load(spec, f) {
    var key = OB.chartKey(spec) + "@" + f, e = pics.get(key);
    if (e) return e.p;
    e = { cv: null, p: null };
    pics.set(key, e);
    if (pics.size > MAX_PICS) pics.delete(pics.keys().next().value);
    e.p = rasterize(spec, f).then(function (cv) { e.cv = cv; tell(); return cv; });
    return e.p;
  }
  // The picture of a chart for `scale` device px per point, or null
  // (then it is on its way); a sharper / softer copy stands in.
  function picture(doc, it, scale) {
    var spec = specOf(doc, it), f = factorFor(spec, scale || 1), base = OB.chartKey(spec);
    var e = pics.get(base + "@" + f);
    if (e && e.cv) return e.cv;
    if (!e) load(spec, f);
    for (var i = STEPS.length - 1; i >= 0; i--) {
      var o = pics.get(base + "@" + STEPS[i]);
      if (o && o.cv) return o.cv;
    }
    return null;
  }
  // Every chart of the given pages ready at `scale` (exports).
  function prepare(doc, scale, pages) {
    var only = null;
    if (pages) { only = {}; pages.forEach(function (p) { only[p.id || p] = 1; }); }
    return Promise.all(doc.items.filter(function (it) {
      return it.ax && it.ax.k === "chart" && !it.hide && (!only || only[it.pg]);
    }).map(function (it) {
      var spec = specOf(doc, it);
      return load(spec, factorFor(spec, scale));
    }));
  }
  AT.charts = { picture: picture, prepare: prepare, svg: function (doc, it) { return svgOf(specOf(doc, it)); } };

  // ---------- 2. Grid editor (dialogs) ----------
  function btn(label, fn, cls) {
    var b = el("button", "btn small" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  // rows of texts; pasting several cells (from a spreadsheet: tabs and
  // lines) into a cell fills the grid from there.
  function gridEditor(rows, o) {
    var state = rows.map(function (r) { return r.slice(); });
    var wrap = el("div", "grid-ed"), tools = el("div", "pn-row"), host = el("div", "grid-scroll");
    function render() {
      host.innerHTML = "";
      var tbl = el("table", "grid-tbl");
      state.forEach(function (row, r) {
        var tr = el("tr");
        row.forEach(function (v, c) {
          var td = el("td");
          var inp = el(o.multiline ? "textarea" : "input", "inp sm cell");
          if (!o.multiline) inp.type = "text"; else inp.rows = 1;
          inp.value = v;
          inp.maxLength = o.maxLen;
          inp.setAttribute("aria-label", t("tb.cell", { r: r + 1, c: c + 1 }));
          inp.addEventListener("input", function () { state[r][c] = inp.value; changed(); });
          inp.addEventListener("paste", function (e) {
            var txt = e.clipboardData && e.clipboardData.getData("text/plain");
            if (!txt || !/[\t\n]/.test(txt.replace(/\n+$/, ""))) return;
            e.preventDefault();
            var got = OB.rowsFromText(txt, o.maxR, o.maxC, o.maxLen);
            if (!got) return;
            got.forEach(function (gr, i) {
              var rr = r + i;
              if (rr >= o.maxR) return;
              while (state.length <= rr) state.push(state[0].map(function () { return ""; }));
              gr.forEach(function (v2, j) {
                var cc = c + j;
                if (cc >= o.maxC) return;
                if (state[0].length <= cc) state.forEach(function (x) { while (x.length <= cc) x.push(""); });
                state[rr][cc] = v2;
              });
            });
            render(); changed();
          });
          inp.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !(o.multiline && e.shiftKey)) {
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
    }
    function changed() { if (o.onChange) o.onChange(read()); }
    function read() { return state.map(function (r) { return r.slice(); }); }
    tools.appendChild(btn(t("tb.addRow"), function () { if (state.length < o.maxR) { state.push(state[0].map(function () { return ""; })); render(); changed(); } }));
    tools.appendChild(btn(t("tb.delRow"), function () { if (state.length > 1) { state.pop(); render(); changed(); } }));
    tools.appendChild(btn(t("tb.addCol"), function () { if (state[0].length < o.maxC) { state.forEach(function (r) { r.push(""); }); render(); changed(); } }));
    tools.appendChild(btn(t("tb.delCol"), function () { if (state[0].length > 1) { state.forEach(function (r) { r.pop(); }); render(); changed(); } }));
    wrap.appendChild(tools);
    wrap.appendChild(host);
    render();
    return { node: wrap, read: read };
  }
  function check(label, on) {
    var l = el("label", "chk"), c = el("input");
    c.type = "checkbox"; c.checked = !!on;
    l.appendChild(c); l.appendChild(el("span", "", label));
    return { node: l, input: c };
  }
  function selectOf(label, list, value) {
    var f = el("label", "fld"), s = el("select", "inp sm");
    list.forEach(function (x) { var op = el("option", "", x[1]); op.value = x[0]; if (x[0] === value) op.selected = true; s.appendChild(op); });
    f.appendChild(el("span", "fld-lbl", label)); f.appendChild(s);
    return { node: f, input: s };
  }

  // ---------- 3. Table editor ----------
  function editTable(id) {
    var it = ED.find(id);
    if (!it || it.ax.k !== "table") return;
    var tb = it.ax.tb;
    AT.openDialog(t("tb.edit"), function (body, close) {
      body.appendChild(el("p", "hint", t("tb.hint")));
      var g = gridEditor(tb.rows, { maxR: OB.MAX_R, maxC: OB.MAX_C, maxLen: OB.MAX_CELL, multiline: true });
      body.appendChild(g.node);
      var opts = el("div", "pn-col");
      var hd = check(t("tb.header"), tb.hd !== 0), hc = check(t("tb.firstCol"), tb.hc), bd = check(t("tb.banded"), tb.bd);
      [hd, hc, bd].forEach(function (x) { opts.appendChild(x.node); });
      body.appendChild(opts);
      var two = el("div", "grid2");
      var ln = selectOf(t("tb.lines"), OB.LINES.map(function (k) { return [k, t("tb.ln." + k)]; }), tb.ln || "all");
      two.appendChild(ln.node);
      var cwF = el("label", "fld"), cw = el("input", "inp sm");
      cw.type = "text"; cw.value = tb.cw ? tb.cw.join(", ") : ""; cw.placeholder = "1, 1, 1"; cw.maxLength = 60;
      cwF.appendChild(el("span", "fld-lbl", t("tb.widths"))); cwF.appendChild(cw);
      two.appendChild(cwF);
      body.appendChild(two);
      body.appendChild(el("p", "hint", t("tb.widthsHint")));
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var rows = g.read();
        var ws = cw.value.split(/[,;\s]+/).filter(Boolean).map(function (v) { return parseFloat(v.replace(",", ".")); });
        AT.editItems([id], function (x) {
          var nt = { rows: rows, hd: hd.input.checked ? 1 : 0, hc: hc.input.checked ? 1 : 0, bd: bd.input.checked ? 1 : 0, ln: ln.input.value };
          ["ac", "bf", "cf"].forEach(function (k) { if (x.ax.tb[k]) nt[k] = x.ax.tb[k]; });
          if (ws.length === rows[0].length && ws.every(function (v) { return v > 0; })) {
            var mx = Math.max.apply(null, ws);
            nt.cw = ws.map(function (v) { return Math.max(1, Math.round(v / mx * 100)); });
          }
          x.ax.tb = nt;
        });
        close();
      }, "primary"));
      body.appendChild(act);
      setTimeout(function () { var f = body.querySelector(".cell"); if (f) f.focus(); }, 0);
    }, true);
  }

  // ---------- 4. Chart editor ----------
  function editChart(id) {
    var it = ED.find(id);
    if (!it || it.ax.k !== "chart") return;
    var ch = it.ax.ch;
    AT.openDialog(t("ch.edit"), function (body, close) {
      var top = el("div", "grid2");
      var typ = selectOf(t("ch.type"), OB.CHART_TYPES.map(function (k) { return [k, t("ch.t." + k)]; }), ch.t);
      top.appendChild(typ.node);
      var tf = el("label", "fld"), ttl = el("input", "inp sm");
      ttl.type = "text"; ttl.maxLength = 100; ttl.value = ch.ttl || "";
      tf.appendChild(el("span", "fld-lbl", t("ch.title"))); tf.appendChild(ttl);
      top.appendChild(tf);
      body.appendChild(top);
      var two = el("div", "grid2");
      var by = selectOf(t("ch.by"), [["", t("ch.by.auto")], ["c", t("ch.by.c")], ["r", t("ch.by.r")]], ch.by || "");
      two.appendChild(by.node);
      var lg = check(t("ch.legend"), ch.lg !== 0);
      two.appendChild(lg.node);
      body.appendChild(two);
      var prev = el("div", "ch-prev"), pimg = el("img");
      pimg.alt = t("ch.preview");
      prev.appendChild(pimg);
      body.appendChild(prev);
      body.appendChild(el("p", "hint", t("ch.hint")));
      var rows = ch.rows;
      function preview() {
        var x = JSON.parse(JSON.stringify(it));
        x.ax.ch = OB.normChart({ t: typ.input.value, rows: rows, ttl: ttl.value, lg: lg.input.checked ? 1 : 0, by: by.input.value, tc: ch.tc, co: ch.co });
        pimg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgOf(specOf(AT.doc, x)));
      }
      var g = gridEditor(ch.rows, { maxR: OB.CH_R, maxC: OB.CH_C, maxLen: OB.CH_CELL, onChange: function (r) { rows = r; preview(); } });
      body.appendChild(g.node);
      [typ.input, ttl, lg.input, by.input].forEach(function (n) { n.addEventListener("input", preview); n.addEventListener("change", preview); });
      preview();
      var act = el("div", "dlg-actions");
      act.appendChild(btn(t("btn.cancel"), close));
      act.appendChild(btn(t("btn.save"), function () {
        var r = g.read();
        AT.editItems([id], function (x) {
          x.ax.ch = { t: typ.input.value, rows: r, ttl: ttl.value, lg: lg.input.checked ? 1 : 0, by: by.input.value, tc: x.ax.ch.tc, co: x.ax.ch.co };
        });
        close();
      }, "primary"));
      body.appendChild(act);
    }, true);
  }

  // ---------- 5. New tables and charts ----------
  function newTable() {
    var P = AT.doc.setup, w = Math.round(P.w * 0.7), rows = [];
    for (var r = 0; r < 4; r++) { var row = []; for (var c = 0; c < 3; c++) row.push(r === 0 ? t("tb.head", { n: c + 1 }) : ""); rows.push(row); }
    var size = Math.max(6, Math.round(Math.min(P.w, P.h) / 40));
    var made = ED.add({ k: "table", tb: { rows: rows, bd: 1 }, size: size, w: w, h: Math.round(size * 2.4 * 4), sw: Math.max(0.5, Math.round(size / 12 * 10) / 10) });
    if (made) editTable(made.id);
  }
  function newChart(type) {
    var P = AT.doc.setup, w = Math.round(P.w * 0.6);
    var rows = [["", t("ch.s1"), t("ch.s2")], [t("ch.c1"), "12", "8"], [t("ch.c2"), "18", "11"], [t("ch.c3"), "15", "16"], [t("ch.c4"), "22", "19"]];
    if (type === "pie" || type === "donut") rows = [["", t("ch.s1")], [t("ch.c1"), "40"], [t("ch.c2"), "25"], [t("ch.c3"), "20"], [t("ch.c4"), "15"]];
    var made = ED.add({ k: "chart", ch: { t: type || "col", rows: rows }, w: w, h: Math.round(w * 0.62) });
    if (made) editChart(made.id);
  }

  // The Elements panel section (panels.js calls it).
  AT.objectsSection = function (body, sec) {
    var s = sec(t("el.data"));
    var g = el("div", "obj-grid");
    function tile(label, iconName, fn) {
      var b = el("button", "obj-tile");
      b.type = "button";
      b.innerHTML = AT.icon(iconName);
      b.appendChild(el("span", "", label));
      b.addEventListener("click", fn);
      g.appendChild(b);
    }
    tile(t("el.table"), "table", newTable);
    tile(t("ch.t.col"), "chart", function () { newChart("col"); });
    tile(t("ch.t.bar"), "chartBar", function () { newChart("bar"); });
    tile(t("ch.t.line"), "chartLine", function () { newChart("line"); });
    tile(t("ch.t.pie"), "chartPie", function () { newChart("pie"); });
    tile(t("ch.t.donut"), "chartPie", function () { newChart("donut"); });
    s.appendChild(g);
    s.appendChild(el("p", "hint", t("el.dataHint")));
    body.appendChild(s);
  };

  AT.objects = { editTable: editTable, editChart: editChart, newTable: newTable, newChart: newChart };

  // A chart picture landed: thumbnails and the canvas draw again.
  AT.on("charts", function () {
    AT.dropThumbs();
    if (AT.doc) { ED.redraw(); if (ED.renderPages) ED.renderPages(); }
    else if (AT.renderHome) AT.renderHome();
  });
})();
