// ============================================================
// orOS Layout — tables (v1.0.0, LY-W12): the table dialog. A table is
// a paragraph of a story (ext.tbl, designkit/table.js); text.js sets
// it in the column, header rows repeating. The dialog edits a copy:
// cell texts, rows and columns added or removed, cells merged and
// split, header rows, fills, rules, padding, column widths, cell and
// header paragraph styles, and a grid read from a CSV or spreadsheet
// file. OK hands the new table back (done(tbl)); Remove hands null.
// The Story Editor inserts a table at the caret and opens one on a
// click (story.js). No browser dialogs.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t, el = LY.el;
  var TB = window.orosDK && window.orosDK.table;
  var SHOW_R = 300;   // rows shown in the grid (the rest kept as they are)

  var xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxP) return xlsxP;
    xlsxP = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "../vendor/xlsx.full.min.js";
      s.onload = function () { resolve(window.XLSX || null); };
      s.onerror = function () { xlsxP = null; resolve(null); };
      document.head.appendChild(s);
    });
    return xlsxP;
  }
  // a file → rows of strings (CSV, TSV, text, or the first sheet of
  // an .xlsx / .xls / .ods)
  function gridOf(f) {
    var name = String(f.name || "").toLowerCase();
    if (f.size > 15 * 1024 * 1024) return Promise.reject(new Error("big"));
    if (/\.(xlsx|xls|ods)$/.test(name)) {
      return Promise.all([loadXlsx(), f.arrayBuffer()]).then(function (r) {
        var X = r[0];
        if (!X) throw new Error("xlsx");
        var wb = X.read(new Uint8Array(r[1]), { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, TB.MAX_R).map(function (row) { return row.slice(0, TB.MAX_C).map(function (v) { return v == null ? "" : String(v); }); });
      });
    }
    return f.text().then(TB.parseCSV);
  }

  function newTable(r, c) {
    var g = [];
    for (var i = 0; i < r; i++) { var row = []; for (var j = 0; j < c; j++) row.push(""); g.push(row); }
    return TB.fromGrid(g, { hdr: 1 });
  }

  // edit(tbl or null, done(tbl | null), opts {canRemove})
  function edit(tbl, done, opts) {
    if (!TB || !LY.doc) return;
    opts = opts || {};
    var w = TB.norm(tbl) || newTable(4, 3), ui = LY.ui, doc = LY.doc;
    var sel = { r0: 0, c0: 0, r1: 0, c1: 0 };
    LY.openDialog(t(tbl ? "tbl.edit" : "tbl.new"), function (body, close) {
      var bar = el("div", "pn-row wrap tbl-bar"), gridBox = el("div", "tbl-grid"), info = el("p", "hint");
      function op(fn) { var n = fn(w); if (n) w = n; clampSel(); draw(); }
      function clampSel() {
        var R = w.rows.length - 1, C = w.cols.length - 1;
        sel.r0 = Math.min(sel.r0, R); sel.r1 = Math.min(sel.r1, R); sel.c0 = Math.min(sel.c0, C); sel.c1 = Math.min(sel.c1, C);
      }
      function lo(a, b) { return Math.min(a, b); }
      [["tbl.rowAbove", function () { op(function (x) { return TB.addRow(x, lo(sel.r0, sel.r1)); }); }],
        ["tbl.rowBelow", function () { op(function (x) { return TB.addRow(x, Math.max(sel.r0, sel.r1) + 1); }); }],
        ["tbl.rowDel", function () { op(function (x) { return TB.delRow(x, lo(sel.r0, sel.r1)); }); }],
        ["tbl.colLeft", function () { op(function (x) { return TB.addCol(x, lo(sel.c0, sel.c1)); }); }],
        ["tbl.colRight", function () { op(function (x) { return TB.addCol(x, Math.max(sel.c0, sel.c1) + 1); }); }],
        ["tbl.colDel", function () { op(function (x) { return TB.delCol(x, lo(sel.c0, sel.c1)); }); }],
        ["tbl.merge", function () {
          var r0 = lo(sel.r0, sel.r1), c0 = lo(sel.c0, sel.c1);
          op(function (x) { return TB.merge(x, r0, c0, Math.abs(sel.r1 - sel.r0) + 1, Math.abs(sel.c1 - sel.c0) + 1); });
          sel = { r0: r0, c0: c0, r1: r0, c1: c0 }; draw();
        }],
        ["tbl.split", function () { op(function (x) { return TB.split(x, lo(sel.r0, sel.r1), lo(sel.c0, sel.c1)); }); }],
        ["tbl.import", function () {
          LY.io.pickFile(".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv,text/plain").then(function (f) {
            if (!f) return;
            return gridOf(f).then(function (g) {
              var n = g.length ? TB.fromGrid(g, { hdr: w.hdr > 0 }) : null;
              if (!n) { LY.toast(t("tbl.importNone")); return; }
              ["pad", "bw", "bc", "hf", "cps", "hps", "rep"].forEach(function (k) { if (w[k] !== undefined) n[k] = w[k]; });
              n.hdr = Math.min(w.hdr, n.rows.length - 1);
              w = TB.norm(n); sel = { r0: 0, c0: 0, r1: 0, c1: 0 }; draw(); drawSet();
              LY.toast(t("tbl.imported", { r: w.rows.length, c: w.cols.length }));
            });
          }).then(null, function () { LY.toast(t("tbl.importFail")); });
        }]
      ].forEach(function (b) { bar.appendChild(ui.btn(t(b[0]), b[1], "small")); });
      // on a touch screen (no Shift): the next tapped cell extends the range
      var ext = false, extB = ui.btn(t("tbl.range"), function () { ext = !ext; extB.classList.toggle("on", ext); extB.setAttribute("aria-pressed", ext ? "true" : "false"); }, "small");
      extB.setAttribute("aria-pressed", "false");
      bar.appendChild(extB);
      body.appendChild(bar);
      body.appendChild(info);
      body.appendChild(gridBox);

      function inSel(i, j) {
        return i >= lo(sel.r0, sel.r1) && i <= Math.max(sel.r0, sel.r1) && j >= lo(sel.c0, sel.c1) && j <= Math.max(sel.c0, sel.c1);
      }
      function draw() {
        gridBox.innerHTML = "";
        var tab = el("table", "tbl-ed"), R = Math.min(w.rows.length, SHOW_R);
        for (var i = 0; i < R; i++) {
          var tr = el("tr", i < w.hdr ? "hdr" : "");
          w.rows[i].c.forEach(function (c, j) {
            if (c.x) return;
            var td = el("td", inSel(i, j) ? "on" : "");
            if (c.s > 1) td.colSpan = c.s;
            if (c.r > 1) td.rowSpan = Math.min(c.r, R - i);
            if (c.f) td.style.background = M.cssColor(doc, c.f);
            var ta = el("textarea", "inp tbl-cell");
            ta.rows = 1; ta.value = c.t; ta.maxLength = 4000;
            ta.setAttribute("aria-label", t("tbl.cell", { r: i + 1, c: j + 1 }));
            var ri = i;
            ta.addEventListener("input", function () { c.t = ta.value.replace(/\r\n?/g, "\n"); });
            ta.addEventListener("focus", function () { if (ext) { ext = false; extB.classList.remove("on"); extB.setAttribute("aria-pressed", "false"); pick(ri, j, true); } else pick(ri, j, false); });
            ta.addEventListener("mousedown", function (e) { if (e.shiftKey) { e.preventDefault(); pick(ri, j, true); } });
            td.appendChild(ta);
            tr.appendChild(td);
          });
          tab.appendChild(tr);
        }
        gridBox.appendChild(tab);
        info.textContent = t("tbl.size", { r: w.rows.length, c: w.cols.length }) + (w.rows.length > SHOW_R ? " " + t("tbl.more", { n: SHOW_R }) : "") + " " + t("tbl.selHint");
      }
      function pick(i, j, extend) {
        if (extend) { sel.r1 = i; sel.c1 = j; } else sel = { r0: i, c0: j, r1: i, c1: j };
        Array.prototype.forEach.call(gridBox.querySelectorAll("td"), function (td) { td.classList.remove("on"); });
        var tds = gridBox.querySelectorAll("tr");
        for (var a = 0; a < tds.length; a++) {
          var k = 0;
          w.rows[a].c.forEach(function (c, b) { if (c.x) return; if (inSel(a, b)) tds[a].children[k].classList.add("on"); k++; });
        }
        if (extend) draw();
      }

      // settings
      var set = el("div", "tbl-set");
      body.appendChild(set);
      function num(label, v, lo2, hi, step, fn) {
        var i = el("input", "inp num"); i.type = "number"; i.min = lo2; i.max = hi; i.step = step; i.value = v;
        i.addEventListener("change", function () { var n = Number(i.value); if (isFinite(n)) fn(Math.max(lo2, Math.min(hi, n))); });
        return ui.field(label, i);
      }
      function drawSet() {
        set.innerHTML = "";
        var r1 = el("div", "pn-row wrap");
        r1.appendChild(num(t("tbl.hdr"), w.hdr, 0, Math.min(20, w.rows.length - 1), 1, function (n) { w.hdr = Math.round(n); draw(); }));
        r1.appendChild(ui.check(t("tbl.rep"), w.rep !== 0, function (on) { if (on) delete w.rep; else w.rep = 0; }));
        r1.appendChild(num(t("tbl.pad"), w.pad, 0, 36, 0.5, function (n) { w.pad = n; }));
        r1.appendChild(num(t("tbl.bw"), w.bw, 0, 12, 0.25, function (n) { w.bw = n; }));
        var ws = el("input", "inp"); ws.type = "text"; ws.value = w.cols.map(function (v) { return Math.round(v * 100) / 100; }).join(" "); ws.maxLength = 200;
        ws.addEventListener("change", function () {
          var a = ws.value.trim().split(/[\s,;]+/).map(Number).filter(function (v) { return v > 0; });
          if (a.length === w.cols.length) w.cols = a.map(function (v) { return Math.max(0.05, Math.min(100, v)); });
          else { LY.toast(t("tbl.widthsBad", { n: w.cols.length })); ws.value = w.cols.join(" "); }
        });
        r1.appendChild(ui.field(t("tbl.widths"), ws));
        set.appendChild(r1);
        var pss = [["", t("tbl.psSame")]].concat(doc.pstyles.map(function (s) { return [s.id, LY.label(s.name)]; }));
        var r2 = el("div", "pn-row wrap");
        r2.appendChild(ui.field(t("tbl.cps"), ui.select(pss, w.cps || "", function (v) { if (v) w.cps = v; else delete w.cps; })));
        r2.appendChild(ui.field(t("tbl.hps"), ui.select(pss, w.hps || "", function (v) { if (v) w.hps = v; else delete w.hps; })));
        set.appendChild(r2);
        set.appendChild(ui.field(t("tbl.bc"), ui.swatchPicker(w.bc || "", function (id) { if (id) w.bc = id; else delete w.bc; drawSet(); }), "block"));
        set.appendChild(ui.field(t("tbl.hf"), ui.swatchPicker(w.hf || "", function (id) { if (id) w.hf = id; else delete w.hf; drawSet(); }), "block"));
        set.appendChild(ui.field(t("tbl.cf"), ui.swatchPicker("", function (id) {
          for (var i = lo(sel.r0, sel.r1); i <= Math.max(sel.r0, sel.r1); i++) for (var j = lo(sel.c0, sel.c1); j <= Math.max(sel.c0, sel.c1); j++) {
            var c = w.rows[i] && w.rows[i].c[j];
            if (!c || c.x) continue;
            if (id) c.f = id; else delete c.f;
          }
          draw();
        }), "block"));
      }
      draw();
      drawSet();

      var act = el("div", "dlg-actions");
      if (opts.canRemove) {
        var sure = false, rm = ui.btn(t("tbl.remove"), function () {
          if (!sure) { sure = true; rm.textContent = t("tbl.removeSure"); return; }
          close(); done(null);
        });
        act.appendChild(rm);
      }
      act.appendChild(el("span", "spacer"));
      act.appendChild(ui.btn(t("btn.cancel"), close));
      act.appendChild(ui.btn(t("btn.ok"), function () {
        var n = TB.norm(w);
        if (!n) return;
        if (w.rep === 0) n.rep = 0;
        close(); done(n);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }

  // the document may need model level 3 (a table over the usual size)
  function level(doc, now) {
    if (M.tableLevel(doc) < 3) return;
    doc.setup.ext = Object.assign({}, doc.setup.ext || {});
    if (!(doc.setup.ext.mv >= 3)) { doc.setup.ext.mv = 3; doc.m = Math.max(now, (doc.m || 0) + 1); }
  }

  LY.tables = { edit: edit, newTable: newTable, gridOf: gridOf, level: level };
})();
