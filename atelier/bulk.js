// ============================================================
// orOS Atelier — bulk.js: Bulk create (v1.0.0)
// One design, many copies: write {name}, {date}… in text boxes (or
// table cells), paste a list or open a CSV / Excel file with one row
// per copy, and Atelier makes a design for each row, or one design
// with a page for each row (ready for Export › PDF). A name that
// no longer fits its box gets a smaller size, down to 60%.
// The pure part (AtelierBulk) has no DOM and runs in Node tests; the
// dialog is added to the editor's More menu when Atelier is loaded.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var RX = /\{([^{}\n]{1,40})\}/g;
  var LIM = { rows: 200, copies: 200, pages: 999, items: 5000 };
  var MIN_FIT = 0.6;

  // field names compare without case, accents or extra spaces
  function key(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // The {fields} of a design, in page order, each once.
  function fields(doc) {
    var out = [], seen = {};
    function scan(s) {
      String(s || "").replace(RX, function (m, n) {
        var k = key(n);
        if (k && !seen[k]) { seen[k] = 1; out.push(n.trim()); }
        return m;
      });
    }
    var pos = {};
    (doc.pages || []).forEach(function (p) { pos[p.id] = p.pos; });
    (doc.items || []).slice().sort(function (a, b) {
      return (pos[a.pg] || 0) - (pos[b.pg] || 0) || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
    }).forEach(function (it) {
      var ax = it.ax || {};
      if (ax.k === "text") scan(ax.tx);
      if (ax.tb && Array.isArray(ax.tb.rows)) ax.tb.rows.forEach(function (r) { (r || []).forEach(scan); });
    });
    return out;
  }

  // A pasted list or CSV / TSV: rows of trimmed cells, blank rows out.
  function parseTable(text) {
    text = String(text || "").replace(/^﻿/, "");
    var head = text.split(/\r?\n/).slice(0, 20), c = { ",": 1, ";": 1, "\t": 1 };
    head.forEach(function (ln) { [",", ";", "\t"].forEach(function (k) { c[k] = Math.max(c[k], ln.split(k).length); }); });
    var sep = c["\t"] > 1 && c["\t"] >= c[","] && c["\t"] >= c[";"] ? "\t" : c[";"] > c[","] ? ";" : ",";
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
        continue;
      }
      if (ch === '"' && cell === "") { q = true; continue; }
      if (ch === sep) { row.push(cell); cell = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
        if (rows.length > LIM.rows + 1) break;
        continue;
      }
      cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); })
      .filter(function (r) { return r.some(function (x) { return x; }); });
  }

  // field -> column index (-1 = leave as is). Same name first; a
  // single field and a single column go together.
  function autoMap(flds, header) {
    var hk = (header || []).map(key), map = {};
    flds.forEach(function (f) { map[key(f)] = hk.indexOf(key(f)); });
    if (flds.length === 1 && hk.length === 1 && map[key(flds[0])] < 0) map[key(flds[0])] = 0;
    return map;
  }
  // rows -> [{ fieldKey: value }]
  function values(rows, map) {
    return rows.slice(0, LIM.rows).map(function (r) {
      var v = {};
      Object.keys(map).forEach(function (k) { if (map[k] >= 0) v[k] = r[map[k]] || ""; });
      return v;
    });
  }
  function fillText(s, vals) {
    return String(s || "").replace(RX, function (m, n) {
      var k = key(n);
      return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m;
    });
  }

  // Fill the items of a design for one row. A text that grew past its
  // box shrinks (to 60% at most), then the box takes the text's height.
  function fillItems(items, vals, textH) {
    items.forEach(function (it) {
      var ax = it.ax;
      if (!ax) return;
      if (ax.tb && Array.isArray(ax.tb.rows)) {
        ax.tb.rows = ax.tb.rows.map(function (r) { return (r || []).map(function (s) { return fillText(s, vals); }); });
      }
      if (ax.k !== "text" || !/\{[^{}\n]{1,40}\}/.test(ax.tx || "")) return;
      var h0 = it.h, size0 = ax.size;
      ax.tx = fillText(ax.tx, vals);
      if (!textH || ax.cv) return;
      var h = textH(it);
      if (h > h0 + 0.5 && size0) {
        var min = size0 * MIN_FIT;
        while (h > h0 + 0.5 && ax.size > min) {
          ax.size = Math.max(min, Math.round(ax.size * 0.92 * 10) / 10);
          h = textH(it);
        }
      }
      if (h > h0 + 0.5) it.h = h;
    });
    return items;
  }

  function firstValue(flds, vals) {
    for (var i = 0; i < flds.length; i++) { var v = vals[key(flds[i])]; if (v) return v; }
    return "";
  }

  // A design for each row (ids are given by the caller: AT.addCopies).
  function makeCopies(doc, flds, rows, textH, nameFmt) {
    return rows.slice(0, LIM.copies).map(function (vals, i) {
      var c = copy(doc);
      fillItems(c.items, vals, textH);
      c.name = (nameFmt || defaultName)(doc.name || "", firstValue(flds, vals) || String(i + 1)).slice(0, 120);
      return c;
    });
  }
  function defaultName(name, v) { return (name ? name + " · " : "") + v; }

  // One design with the pages repeated for each row.
  function fits(doc, n) {
    return n * (doc.pages || []).length <= LIM.pages && n * (doc.items || []).length <= LIM.items;
  }
  function makeOne(doc, rows, textH, newId) {
    var c = copy(doc);
    var pages = (doc.pages || []).slice().sort(function (a, b) { return a.pos - b.pos; });
    var n = 0;
    c.pages = []; c.items = []; c.guides = [];
    rows.forEach(function (vals) {
      var pg = {};
      pages.forEach(function (p) {
        var np = copy(p);
        np.id = newId("pg"); np.pos = (++n) * 1024;
        pg[p.id] = np.id;
        c.pages.push(np);
      });
      var its = doc.items.filter(function (it) { return pg[it.pg]; }).map(function (it) {
        var x = copy(it);
        x.id = newId("it"); x.pg = pg[it.pg];
        return x;
      });
      c.items = c.items.concat(fillItems(its, vals, textH));
    });
    return c;
  }

  var api = {
    VERSION: VERSION, LIM: LIM, key: key, fields: fields, parseTable: parseTable, autoMap: autoMap,
    values: values, fillText: fillText, fillItems: fillItems, makeCopies: makeCopies, makeOne: makeOne, fits: fits
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierBulk = api;

  // ---------- the dialog (browser, inside Atelier) ----------
  if (typeof window === "undefined" || !window.AT) return;
  var AT = window.AT, t = AT.t, el = AT.el, M = AT.M, AX = window.AtelierAX;

  var STR = {
    en: {
      "bulk.title": "Bulk create",
      "bulk.hint": "Write fields in curly brackets in your text, like {name} or {date}. Then add a list with one row per copy: each column fills the field with the same name.",
      "bulk.none": "This design has no fields yet. Write, for example, {name} in a text box, then come back here.",
      "bulk.fields": "Fields: {list}", "bulk.paste": "Paste a list (from a spreadsheet, or one name per line)",
      "bulk.file": "Open a file (CSV, Excel)", "bulk.head": "The first row has the column names",
      "bulk.col": "Column {n}", "bulk.keep": "— leave as is —", "bulk.rows": "{n} rows", "bulk.rows1": "1 row",
      "bulk.over": "Only the first {n} rows are used.",
      "bulk.sep": "A separate design for each row", "bulk.one": "One design with a page for each row (for one PDF)",
      "bulk.big": "Too big for one design: at most {p} pages and {i} elements. Make separate designs or use fewer rows.",
      "bulk.go": "Create ({n})", "bulk.made": "{n} designs made.", "bulk.made1": "Design made.", "bulk.open": "Open",
      "bulk.oneName": "{name} · {n} copies", "bulk.noMap": "Pick a column for at least one field.",
      "bulk.badFile": "This file could not be read."
    },
    el: {
      "bulk.title": "Μαζική δημιουργία",
      "bulk.hint": "Γράψε πεδία σε άγκιστρα μέσα στο κείμενο, όπως {όνομα} ή {ημερομηνία}. Μετά πρόσθεσε μια λίστα με μία γραμμή για κάθε αντίγραφο: κάθε στήλη συμπληρώνει το πεδίο με το ίδιο όνομα.",
      "bulk.none": "Αυτό το σχέδιο δεν έχει ακόμα πεδία. Γράψε, για παράδειγμα, {όνομα} σε ένα πλαίσιο κειμένου και έλα ξανά εδώ.",
      "bulk.fields": "Πεδία: {list}", "bulk.paste": "Επικόλληση λίστας (από υπολογιστικό φύλλο ή ένα όνομα σε κάθε γραμμή)",
      "bulk.file": "Άνοιγμα αρχείου (CSV, Excel)", "bulk.head": "Η πρώτη γραμμή έχει τα ονόματα των στηλών",
      "bulk.col": "Στήλη {n}", "bulk.keep": "— να μείνει όπως είναι —", "bulk.rows": "{n} γραμμές", "bulk.rows1": "1 γραμμή",
      "bulk.over": "Χρησιμοποιούνται μόνο οι πρώτες {n} γραμμές.",
      "bulk.sep": "Ξεχωριστό σχέδιο για κάθε γραμμή", "bulk.one": "Ένα σχέδιο με μια σελίδα για κάθε γραμμή (για ένα PDF)",
      "bulk.big": "Πολύ μεγάλο για ένα σχέδιο: έως {p} σελίδες και {i} στοιχεία. Φτιάξε ξεχωριστά σχέδια ή λιγότερες γραμμές.",
      "bulk.go": "Δημιουργία ({n})", "bulk.made": "Φτιάχτηκαν {n} σχέδια.", "bulk.made1": "Το σχέδιο φτιάχτηκε.", "bulk.open": "Άνοιγμα",
      "bulk.oneName": "{name} · {n} αντίγραφα", "bulk.noMap": "Διάλεξε στήλη για ένα πεδίο τουλάχιστον.",
      "bulk.badFile": "Αυτό το αρχείο δεν διαβάζεται."
    }
  };
  ["en", "el"].forEach(function (l) {
    AT.STRINGS[l] = AT.STRINGS[l] || {};
    Object.keys(STR[l]).forEach(function (k) { AT.STRINGS[l][k] = STR[l][k]; });
  });

  function textH(it) { return AX.textHeight(M.normItem(it)); }

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
  function readFile(f) {
    if (/\.(xlsx|xls|ods)$/i.test(f.name || "")) {
      return Promise.all([loadXlsx(), f.arrayBuffer()]).then(function (r) {
        var X = r[0];
        if (!X) throw new Error("xlsx");
        var wb = X.read(new Uint8Array(r[1]), { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, LIM.rows + 1)
          .map(function (row) { return row.map(function (x) { return String(x == null ? "" : x).trim(); }); })
          .filter(function (row) { return row.some(function (x) { return x; }); });
      });
    }
    return f.text().then(parseTable);
  }

  function open() {
    var src = AT.doc;
    if (!src) return;
    var flds = fields(src);
    AT.openDialog(t("bulk.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("bulk.hint")));
      if (!flds.length) {
        body.appendChild(el("p", "hint warn", t("bulk.none")));
        var a0 = el("div", "dlg-actions"), ok = el("button", "btn primary", t("btn.ok"));
        ok.type = "button"; ok.addEventListener("click", close);
        a0.appendChild(ok); body.appendChild(a0);
        return;
      }
      body.appendChild(el("p", "bk-fields", t("bulk.fields", { list: flds.map(function (f) { return "{" + f + "}"; }).join("  ") })));
      var rows = [], map = {}, one = false, hasHead = true;
      var lab = el("label", "fld");
      lab.appendChild(el("span", "fld-lbl", t("bulk.paste")));
      var ta = el("textarea", "inp bk-ta");
      ta.rows = 5; ta.spellcheck = false;
      lab.appendChild(ta);
      body.appendChild(lab);
      var fileBtn = el("button", "btn sm", t("bulk.file")); fileBtn.type = "button";
      var head = el("label", "rs-keep"), hc = el("input");
      hc.type = "checkbox"; hc.checked = true;
      head.appendChild(hc); head.appendChild(el("span", "", t("bulk.head")));
      var tools = el("div", "bk-tools");
      tools.appendChild(fileBtn); tools.appendChild(head);
      body.appendChild(tools);
      var mapBox = el("div", "bk-map"), info = el("p", "hint"), warn = el("p", "hint warn");
      body.appendChild(mapBox); body.appendChild(info);
      var modes = el("div", "bk-modes");
      function radio(label, val) {
        var r = el("label", "rs-keep"), i = el("input");
        i.type = "radio"; i.name = "bk-mode"; i.checked = one === val;
        i.addEventListener("change", function () { if (i.checked) { one = val; update(); } });
        r.appendChild(i); r.appendChild(el("span", "", label));
        modes.appendChild(r);
      }
      radio(t("bulk.sep"), false); radio(t("bulk.one"), true);
      body.appendChild(modes); body.appendChild(warn);
      var act = el("div", "dlg-actions");
      var cancel = el("button", "btn", t("btn.cancel")); cancel.type = "button";
      var go = el("button", "btn primary", ""); go.type = "button";
      act.appendChild(cancel); act.appendChild(go);
      body.appendChild(act);

      function header() {
        var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0), out = [];
        for (var i = 0; i < w; i++) out.push(hasHead && rows[0] && rows[0][i] ? rows[0][i] : t("bulk.col", { n: i + 1 }));
        return out;
      }
      function data() { return hasHead ? rows.slice(1) : rows; }
      function remap() {
        var hd = header();
        map = autoMap(flds, hasHead ? rows[0] || [] : []);
        if (!hasHead && flds.length === 1 && hd.length >= 1) map[key(flds[0])] = 0;
        mapBox.textContent = "";
        if (!rows.length) return;
        flds.forEach(function (f) {
          var r = el("label", "bk-row");
          r.appendChild(el("span", "bk-f", "{" + f + "}"));
          var s = el("select", "inp sm");
          var o0 = el("option", "", t("bulk.keep")); o0.value = "-1"; s.appendChild(o0);
          hd.forEach(function (h, i) { var o = el("option", "", h); o.value = String(i); s.appendChild(o); });
          s.value = String(map[key(f)]);
          s.addEventListener("change", function () { map[key(f)] = +s.value; update(); });
          r.appendChild(s);
          mapBox.appendChild(r);
        });
      }
      function update() {
        var d = data(), n = Math.min(d.length, LIM.rows);
        var mapped = Object.keys(map).some(function (k) { return map[k] >= 0; });
        info.textContent = !rows.length ? "" : (n === 1 ? t("bulk.rows1") : t("bulk.rows", { n: n })) +
          (d.length > LIM.rows ? " " + t("bulk.over", { n: LIM.rows }) : "") + (n && !mapped ? " " + t("bulk.noMap") : "");
        var big = one && n && !fits(src, n);
        warn.hidden = !big;
        warn.textContent = big ? t("bulk.big", { p: LIM.pages, i: LIM.items }) : "";
        go.textContent = t("bulk.go", { n: one ? (n ? 1 : 0) : n });
        go.disabled = !n || !mapped || big;
      }
      function setRows(r) { rows = r || []; remap(); update(); }
      ta.addEventListener("input", function () { setRows(parseTable(ta.value)); });
      hc.addEventListener("change", function () { hasHead = hc.checked; remap(); update(); });
      fileBtn.addEventListener("click", function () {
        AT.io.pickFile(".csv,.tsv,.txt,.xlsx,.xls,.ods").then(function (f) {
          if (!f) return;
          return readFile(f).then(function (r) { ta.value = ""; setRows(r); }, function () { AT.toast(t("bulk.badFile")); });
        });
      });
      cancel.addEventListener("click", close);
      go.addEventListener("click", function () {
        var vals = values(data(), map);
        if (!vals.length) return;
        close();
        if (one) {
          var c = makeOne(src, vals, textH, M.newId);
          c.name = t("bulk.oneName", { name: AT.docTitle(src), n: vals.length }).slice(0, 120);
          var id1 = AT.addCopies([c], src.id);
          AT.toast(t("bulk.made1"), t("bulk.open"), function () { AT.openDoc(id1[0]); });
          return;
        }
        var title = AT.docTitle(src);
        var list = makeCopies(src, flds, vals, textH, function (n, v) { return title + " · " + v; });
        var ids = AT.addCopies(list, src.id);
        if (ids.length === 1) AT.toast(t("bulk.made1"), t("bulk.open"), function () { AT.openDoc(ids[0]); });
        else AT.toast(t("bulk.made", { n: ids.length }));
      });
      update();
    }, true);
  }

  AT.bulk = { open: open };
})(typeof window !== "undefined" ? window : this);
