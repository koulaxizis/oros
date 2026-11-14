// ============================================================
// orOS Pad — the Tools list and the developer tools (wave D1).
// Loaded by pad/app.js the first time Tools… opens (Alt+T), with the
// pure functions of pad/devtools.js and, for YAML, vendor/yaml (ISC).
// A tool changes the text (one Undo), writes at the cursor, opens a
// new tab, or shows its result in the side panel #dev. Results are set
// with textContent only; nothing is sent anywhere or stored.
// app.js hands in what it shares (H): the editor, the tab, its helpers.
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: {
      "tools.search": "Search the tools",
      "tools.newTab": "Opens a new tab; this one stays as it is",
      "tools.jsonCheck": "Check JSON",
      "tools.jsonCheckSub": "Says whether it is valid, or where the mistake is",
      "tools.jsonSort": "Sort JSON keys A → Z",
      "tools.jsonSortSub": "At every level; numbers and text stay as written",
      "tools.jsonYaml": "JSON → YAML",
      "tools.yamlCheck": "Check YAML",
      "tools.yamlCheckSub": "Says whether it is valid, or where the mistake is",
      "tools.yamlFormat": "Format YAML",
      "tools.yamlFormatSub": "Even indentation; comments stay",
      "tools.yamlJson": "YAML → JSON",
      "tools.gCodes": "Hashes and IDs",
      "tools.hash": "Hashes (MD5, SHA)…",
      "tools.hashSub": "Of the selection, or of the whole file as it is saved",
      "tools.uuid4": "Insert UUID v4",
      "tools.uuid4Sub": "Random; one for every cursor",
      "tools.uuid7": "Insert UUID v7",
      "tools.uuid7Sub": "Starts with the time, so they sort in order",
      "tools.gValues": "Time, numbers, colours",
      "tools.time": "Time stamps…",
      "tools.timeSub": "Unix time ↔ date, or the time now",
      "tools.base": "Number bases…",
      "tools.baseSub": "The selected number in decimal, hex, binary, octal",
      "tools.color": "Colour…",
      "tools.colorSub": "The selected CSS colour as hex, rgb() and hsl()",
      "tools.gLines": "Lines",
      "tools.gMore": "More",
      "tools.gHint": "For the selection",
      "tools.tt": "Open in Text Tools",
      "tools.ttSub": "Base64, URL, HTML entities and more",
      "json.ok": "Valid JSON.",
      "yaml.bad": "This is not valid YAML: line {line}, column {col}. {msg}",
      "yaml.ok": "Valid YAML.",
      "yaml.okN": "Valid YAML ({n} documents).",
      "yaml.big": "This YAML grows too large when its aliases are followed.",
      "conv.done": "Opened in a new tab.",
      "conv.comments": "Comments are not part of JSON and were left out.",
      "conv.docs": "The {n} documents became one list.",
      "conv.inf": "Infinity and NaN have no JSON form and became null.",
      "dev.fail": "The tools could not load.",
      "dev.copy": "Copy",
      "dev.insert": "Insert",
      "dev.copied": "Copied.",
      "dev.noCopy": "Copying is not allowed here; select the text and copy it yourself.",
      "hash.title": "Hashes",
      "hash.sel": "Of the selection, as UTF-8.",
      "hash.file": "Of the whole file as it is saved ({enc}, {eol}).",
      "hash.size": "{size}.",
      "hash.cmp": "Compare with",
      "hash.cmpPh": "Paste a checksum or the line of a .sha256 file",
      "hash.yes": "✓ Same as {name}.",
      "hash.no": "✗ No hash here is the same.",
      "hash.noSha": "SHA is not available in this browser window.",
      "ts.title": "Time stamps",
      "ts.notSel": "The selection is not a time stamp or a date.",
      "ts.sel": "{v} ({unit})",
      "ts.now": "Now",
      "ts.hint": "Select a number such as 1700000000 or a date such as 2026-11-13 to convert it.",
      "ts.u.s": "seconds",
      "ts.u.ms": "milliseconds",
      "ts.u.us": "microseconds",
      "ts.u.ns": "nanoseconds",
      "ts.u.date": "date",
      "ts.local": "Local time",
      "ts.isoLocal": "ISO 8601, local",
      "ts.isoUtc": "ISO 8601, UTC",
      "ts.unixS": "Unix seconds",
      "ts.unixMs": "Unix milliseconds",
      "ts.rel": "From now",
      "nb.title": "Number bases",
      "nb.none": "Select a whole number such as 255, 0xFF or 0b1010.",
      "nb.dec": "Decimal",
      "nb.hex": "Hexadecimal",
      "nb.bin": "Binary",
      "nb.oct": "Octal",
      "nb.eel2": "EEL2 (JSFX)",
      "col.title": "Colour",
      "col.none": "Select a CSS colour such as #ff8800, rgb(255 136 0) or hsl(32 100% 50%).",
      "tt.none": "Text Tools opens only inside orOS."
    },
    el: {
      "tools.search": "Αναζήτηση εργαλείων",
      "tools.newTab": "Ανοίγει σε νέα καρτέλα· αυτή μένει όπως είναι",
      "tools.jsonCheck": "Έλεγχος JSON",
      "tools.jsonCheckSub": "Λέει αν είναι έγκυρο ή πού είναι το λάθος",
      "tools.jsonSort": "Ταξινόμηση κλειδιών JSON Α → Ω",
      "tools.jsonSortSub": "Σε κάθε επίπεδο· αριθμοί και κείμενο μένουν όπως γράφτηκαν",
      "tools.jsonYaml": "JSON → YAML",
      "tools.yamlCheck": "Έλεγχος YAML",
      "tools.yamlCheckSub": "Λέει αν είναι έγκυρο ή πού είναι το λάθος",
      "tools.yamlFormat": "Μορφοποίηση YAML",
      "tools.yamlFormatSub": "Ομοιόμορφες εσοχές· τα σχόλια μένουν",
      "tools.yamlJson": "YAML → JSON",
      "tools.gCodes": "Hashes και αναγνωριστικά",
      "tools.hash": "Hashes (MD5, SHA)…",
      "tools.hashSub": "Της επιλογής ή όλου του αρχείου όπως αποθηκεύεται",
      "tools.uuid4": "Εισαγωγή UUID v4",
      "tools.uuid4Sub": "Τυχαίο· ένα για κάθε κέρσορα",
      "tools.uuid7": "Εισαγωγή UUID v7",
      "tools.uuid7Sub": "Ξεκινά με την ώρα, οπότε ταξινομούνται στη σειρά",
      "tools.gValues": "Ώρα, αριθμοί, χρώματα",
      "tools.time": "Χρονοσφραγίδες…",
      "tools.timeSub": "Χρόνος Unix ↔ ημερομηνία, ή η ώρα τώρα",
      "tools.base": "Αριθμητικά συστήματα…",
      "tools.baseSub": "Ο επιλεγμένος αριθμός σε δεκαδικό, hex, δυαδικό, οκταδικό",
      "tools.color": "Χρώμα…",
      "tools.colorSub": "Το επιλεγμένο χρώμα CSS σε hex, rgb() και hsl()",
      "tools.gLines": "Γραμμές",
      "tools.gMore": "Περισσότερα",
      "tools.gHint": "Για την επιλογή",
      "tools.tt": "Άνοιγμα στα Εργαλεία κειμένου",
      "tools.ttSub": "Base64, URL, οντότητες HTML και άλλα",
      "json.ok": "Έγκυρο JSON.",
      "yaml.bad": "Αυτό δεν είναι έγκυρο YAML: γραμμή {line}, στήλη {col}. {msg}",
      "yaml.ok": "Έγκυρο YAML.",
      "yaml.okN": "Έγκυρο YAML ({n} έγγραφα).",
      "yaml.big": "Αυτό το YAML γίνεται πολύ μεγάλο όταν ακολουθούνται τα aliases του.",
      "conv.done": "Άνοιξε σε νέα καρτέλα.",
      "conv.comments": "Τα σχόλια δεν υπάρχουν στο JSON και έμειναν έξω.",
      "conv.docs": "Τα {n} έγγραφα έγιναν μία λίστα.",
      "conv.inf": "Το άπειρο και το NaN δεν γράφονται σε JSON και έγιναν null.",
      "dev.fail": "Τα εργαλεία δεν φόρτωσαν.",
      "dev.copy": "Αντιγραφή",
      "dev.insert": "Εισαγωγή",
      "dev.copied": "Αντιγράφηκε.",
      "dev.noCopy": "Η αντιγραφή δεν επιτρέπεται εδώ· επίλεξε το κείμενο και αντίγραψέ το εσύ.",
      "hash.title": "Hashes",
      "hash.sel": "Της επιλογής, ως UTF-8.",
      "hash.file": "Όλου του αρχείου όπως αποθηκεύεται ({enc}, {eol}).",
      "hash.size": "{size}.",
      "hash.cmp": "Σύγκριση με",
      "hash.cmpPh": "Επικόλλησε ένα checksum ή τη γραμμή ενός αρχείου .sha256",
      "hash.yes": "✓ Ίδιο με το {name}.",
      "hash.no": "✗ Κανένα hash εδώ δεν είναι ίδιο.",
      "hash.noSha": "Το SHA δεν είναι διαθέσιμο σε αυτό το παράθυρο του browser.",
      "ts.title": "Χρονοσφραγίδες",
      "ts.notSel": "Η επιλογή δεν είναι χρονοσφραγίδα ή ημερομηνία.",
      "ts.sel": "{v} ({unit})",
      "ts.now": "Τώρα",
      "ts.hint": "Επίλεξε έναν αριθμό όπως 1700000000 ή μια ημερομηνία όπως 2026-11-13 για να τη μετατρέψεις.",
      "ts.u.s": "δευτερόλεπτα",
      "ts.u.ms": "χιλιοστά του δευτερολέπτου",
      "ts.u.us": "μικροδευτερόλεπτα",
      "ts.u.ns": "νανοδευτερόλεπτα",
      "ts.u.date": "ημερομηνία",
      "ts.local": "Τοπική ώρα",
      "ts.isoLocal": "ISO 8601, τοπική",
      "ts.isoUtc": "ISO 8601, UTC",
      "ts.unixS": "Δευτερόλεπτα Unix",
      "ts.unixMs": "Χιλιοστά Unix",
      "ts.rel": "Από τώρα",
      "nb.title": "Αριθμητικά συστήματα",
      "nb.none": "Επίλεξε έναν ακέραιο όπως 255, 0xFF ή 0b1010.",
      "nb.dec": "Δεκαδικό",
      "nb.hex": "Δεκαεξαδικό",
      "nb.bin": "Δυαδικό",
      "nb.oct": "Οκταδικό",
      "nb.eel2": "EEL2 (JSFX)",
      "col.title": "Χρώμα",
      "col.none": "Επίλεξε ένα χρώμα CSS όπως #ff8800, rgb(255 136 0) ή hsl(32 100% 50%).",
      "tt.none": "Τα Εργαλεία κειμένου ανοίγουν μόνο μέσα στο orOS."
    }
  };

  window.PadDevUI = function (H) {
    var LANG = H.lang;
    if (window.orosI18n) { try { window.orosI18n.table(STR, "pad", LANG); } catch (e) { /* English then */ } }
    function t(k, vars) {
      var s = (STR[LANG] && STR[LANG][k]) || STR.en[k];
      if (s === undefined) return H.t(k, vars);
      if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
      return s;
    }
    function $(id) { return document.getElementById(id); }
    function V() { return H.view(); }
    function A() { return H.active(); }

    // pad/devtools.js (pure functions) and vendor/yaml (ISC) load the
    // first time they are needed; both are precached. A tool changes the
    // text (one Undo), writes at the cursor, opens a new tab, or shows its
    // result in the side panel #dev. Results are set with textContent
    // only; nothing is sent anywhere or stored.
    var devP = null, yamlP = null;
    function loadScript(src, ready) {
      return new Promise(function (resolve) {
        if (ready()) { resolve(ready()); return; }
        var sc = document.createElement("script");
        sc.src = src + (H.v ? "?v=" + H.v : "");
        sc.onload = function () { resolve(ready() || null); };
        sc.onerror = function () { resolve(null); };
        document.head.appendChild(sc);
      });
    }
    function loadDev() {
      if (!devP) devP = loadScript("devtools.js", function () { return window.PadDev; }).then(function (D) { if (!D) devP = null; return D; });
      return devP;
    }
    function loadYaml() {
      if (!yamlP) yamlP = Promise.all([loadDev(), loadScript("../vendor/yaml/yaml.min.js", function () { return window.OrosYAML; })])
        .then(function (r) { if (!r[0] || !r[1]) { yamlP = null; return null; } return { D: r[0], Y: r[1] }; });
      return yamlP;
    }
    function selText() {
      if (!V()) return "";
      var m = V().state.selection.main;
      return V().state.sliceDoc(m.from, m.to);
    }
    function indentStr() {
      var ind = A().indent || { tabs: false, size: 2 };
      return ind.tabs ? "\t" : new Array((ind.size || 2) + 1).join(" ");
    }
    function yamlIndent() { var ind = A().indent || {}; return ind.tabs ? 2 : (ind.size || 2); }
    // Put the cursor where a check failed (line/column inside the range).
    function goError(r, err, key) {
      var base = r.all ? 0 : V().state.doc.lineAt(r.from).number - 1, line = Math.min(V().state.doc.lines, err.line + base);
      var ln = V().state.doc.line(line), pos = Math.min(ln.to, ln.from + Math.max(0, (err.col || 1) - 1));
      V().dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      V().focus();
      H.toast(t(key, { line: line, col: err.col || 1, msg: err.msg || "" }));
    }
    function stripEnd(r, text) { return r.all ? text : text.replace(/\n$/, ""); }
    function siblingName(ext) {
      var n = A().name, dot = n.lastIndexOf(".");
      return (dot > 0 ? n.slice(0, dot) : n) + ext;
    }
    function openResult(name, lang, text) {
      var tab = H.addTab({ name: name, text: text, lang: lang, dirty: true });
      H.activate(tab);
    }
    function devNeeds(fn, yaml) {
      if (!V() || !A()) return;
      (yaml ? loadYaml() : loadDev().then(function (D) { return D ? { D: D } : null; })).then(function (L) {
        if (!L) { H.toast(t("dev.fail")); return; }
        fn(L.D, L.Y);
      });
    }

    function jsonCheckTool() {
      devNeeds(function (D) {
        var r = H.toolRange(), out = D.jsonCheck(V().state.sliceDoc(r.from, r.to));
        if (out.error) goError(r, out.error, "json.bad");
        else H.toast(t("json.ok"));
      });
    }
    function jsonSortTool() {
      devNeeds(function (D) {
        H.applyTool(function (text, r) {
          var out = D.jsonSortKeys(text, /\n/.test(text.trim()) ? indentStr() : "");
          if (out.error) { goError(r, out.error, "json.bad"); return null; }
          return stripEnd(r, out.text);
        });
      });
    }
    function jsonToYamlTool() {
      devNeeds(function (D) {
        var r = H.toolRange(), out = D.jsonToYaml(V().state.sliceDoc(r.from, r.to), yamlIndent());
        if (out.error) { goError(r, out.error, "json.bad"); return; }
        openResult(siblingName(".yaml"), "yaml", out.text);
        H.toast(t("conv.done"));
      });
    }
    function yamlCheckTool() {
      devNeeds(function (D, Y) {
        var r = H.toolRange(), out = D.yamlCheck(Y, V().state.sliceDoc(r.from, r.to));
        if (out.error) goError(r, out.error, "yaml.bad");
        else H.toast(out.docs > 1 ? t("yaml.okN", { n: out.docs }) : t("yaml.ok"));
      }, true);
    }
    function yamlFormatTool() {
      devNeeds(function (D, Y) {
        H.applyTool(function (text, r) {
          var out = D.yamlFormat(Y, text, yamlIndent());
          if (out.error) { goError(r, out.error, "yaml.bad"); return null; }
          return stripEnd(r, out.text);
        });
      }, true);
    }
    function yamlToJsonTool() {
      devNeeds(function (D, Y) {
        var r = H.toolRange(), out = D.yamlToJson(Y, V().state.sliceDoc(r.from, r.to), indentStr());
        if (out.error) { if (out.error.big) H.toast(t("yaml.big")); else goError(r, out.error, "yaml.bad"); return; }
        openResult(siblingName(".json"), "json", out.text);
        var n = out.notes, msg = [t("conv.done")];
        if (n.comments) msg.push(t("conv.comments"));
        if (n.docs > 1) msg.push(t("conv.docs", { n: n.docs }));
        if (n.inf) msg.push(t("conv.inf"));
        H.toast(msg.join(" "));
      }, true);
    }

    // Every cursor or selection gets its own value (UUIDs).
    function insertEach(make) {
      if (!V()) return;
      var st = V().state, changes = st.selection.ranges.map(function (rg) { return { from: rg.from, to: rg.to, insert: make() }; });
      V().dispatch(st.update({ changes: changes, scrollIntoView: true, userEvent: "input.tool" }));
      V().focus();
    }
    function insertText(text) { insertEach(function () { return text; }); }
    function uuidTool(v7) {
      devNeeds(function (D) { insertEach(function () { return v7 ? D.uuid7(Date.now()) : D.uuid4(); }); });
    }

    function copyText(text) {
      function done() { H.toast(t("dev.copied")); }
      function old() {
        var ta = H.el("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove();
        H.toast(t(ok ? "dev.copied" : "dev.noCopy"));
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, old); return; }
      } catch (e) { /* fall through */ }
      old();
    }

    // ----- the side panel -----
    function closeDev() {
      var p = $("dev");
      if (!p || p.hidden) return;
      p.hidden = true;
      document.body.classList.remove("dv-on");
      $("dev-body").textContent = "";
      if (V()) V().focus();
    }
    // build(body) fills it. The panel shows a copy of the moment it opened.
    function showDev(title, build) {
      H.previewOff();
      H.closeCompare();
      $("dev-title").textContent = title;
      var body = $("dev-body");
      body.textContent = "";
      build(body);
      $("dev").hidden = false;
      document.body.classList.add("dv-on");
      body.scrollTop = 0;
      var f = body.querySelector("input, button");
      $("dev-close").focus();
      if (f && f.tagName === "INPUT") f.focus();
    }
    function devNote(body, text) { body.appendChild(H.el("p", "dv-note", text)); return body; }
    function devHead(body, text) { body.appendChild(H.el("h3", "dv-head", text)); }
    // A result row: what it is, the value (selectable), Copy and Insert.
    function devRow(body, label, value, canInsert) {
      var row = H.el("div", "dv-row");
      row.appendChild(H.el("span", "dv-k", label));
      var v = H.el("code", "dv-v", value);
      row.appendChild(v);
      var btns = H.el("span", "dv-btns");
      btns.appendChild(H.button(t("dev.copy"), "chip sm", function () { copyText(value); }));
      if (canInsert) btns.appendChild(H.button(t("dev.insert"), "chip sm", function () { insertText(value); }));
      row.appendChild(btns);
      body.appendChild(row);
      return row;
    }

    function hashTool() {
      devNeeds(function (D) {
        var sel = selText(), bytes, note;
        if (sel) { bytes = D.utf8(sel); note = t("hash.sel"); }
        else {
          bytes = H.fileBytes(A());
          if (!bytes) return;
          note = t("hash.file", { enc: H.C.encInfo(A().enc).name, eol: (A().eol || "lf").toUpperCase() });
        }
        note += " " + t("hash.size", { size: H.fmtSize(bytes.length) });
        var subtle = null;
        try { subtle = window.crypto && window.crypto.subtle; } catch (e) { subtle = null; }
        D.hashAll(bytes, subtle).then(function (rows) {
          showDev(t("hash.title"), function (body) {
            devNote(body, note);
            var lab = H.el("label", "dv-lbl", t("hash.cmp"));
            var inp = H.el("input");
            inp.type = "text"; inp.autocomplete = "off"; inp.spellcheck = false;
            inp.setAttribute("placeholder", t("hash.cmpPh"));
            lab.appendChild(inp);
            body.appendChild(lab);
            var res = H.el("p", "dv-match");
            res.setAttribute("role", "status");
            body.appendChild(res);
            var rowEls = {};
            rows.forEach(function (r) {
              devHead(body, r.name);
              rowEls[r.id] = [devRow(body, "hex", r.hex, true), devRow(body, "Base64", r.b64, true)];
            });
            if (rows.length < D.ALGOS.length) devNote(body, t("hash.noSha"));
            inp.addEventListener("input", function () {
              var m = D.matchHash(rows, inp.value);
              Object.keys(rowEls).forEach(function (k) { rowEls[k].forEach(function (x) { x.classList.toggle("hit", !!m && m.id === k); }); });
              res.className = "dv-match" + (m ? " ok" : m === null ? " no" : "");
              res.textContent = m ? t("hash.yes", { name: m.name }) : m === null ? t("hash.no") : "";
            });
          });
        });
      });
    }

    var STAMP_KEYS = { local: "ts.local", isoLocal: "ts.isoLocal", isoUtc: "ts.isoUtc", unixS: "ts.unixS", unixMs: "ts.unixMs", rel: "ts.rel" };
    function timeTool() {
      devNeeds(function (D) {
        var sel = selText().trim(), p = sel ? D.parseStamp(sel) : null, now = Date.now();
        showDev(t("ts.title"), function (body) {
          if (sel && !p) devNote(body, t("ts.notSel"));
          if (p) {
            devHead(body, t("ts.sel", { v: sel.length > 40 ? sel.slice(0, 40) + "…" : sel, unit: t("ts.u." + p.unit) }));
            D.stampRows(p.ms, now, H.locale()).forEach(function (r) { devRow(body, t(STAMP_KEYS[r.k]), r.v, r.k !== "rel"); });
          }
          if (!sel) devNote(body, t("ts.hint"));
          devHead(body, t("ts.now"));
          D.stampRows(now, null, H.locale()).forEach(function (r) { devRow(body, t(STAMP_KEYS[r.k]), r.v, true); });
        });
      });
    }

    var BASE_KEYS = { dec: "nb.dec", hex: "nb.hex", bin: "nb.bin", oct: "nb.oct", eel2: "nb.eel2" };
    function baseTool() {
      devNeeds(function (D) {
        var sel = selText().trim(), v = D.parseNumber(sel);
        if (v === null) { H.toast(t("nb.none")); return; }
        showDev(t("nb.title"), function (body) {
          devHead(body, sel);
          D.baseRows(v, A().lang === "eel2").forEach(function (r) { devRow(body, t(BASE_KEYS[r.k]), r.v, true); });
        });
      });
    }

    function colorTool() {
      devNeeds(function (D) {
        var sel = selText().trim(), c = D.parseColor(sel);
        if (!c) { H.toast(t("col.none")); return; }
        var rows = D.colorRows(c);
        showDev(t("col.title"), function (body) {
          var sw = H.el("div", "dv-swatch"), fill = H.el("div", "dv-fill");
          // rows[0].v is our own #rrggbb(aa), built from numbers only.
          fill.style.backgroundColor = rows[0].v;
          sw.appendChild(fill);
          sw.setAttribute("role", "img");
          sw.setAttribute("aria-label", rows[0].v);
          body.appendChild(sw);
          rows.forEach(function (r) { devRow(body, r.k === "hex" ? "HEX" : r.k.toUpperCase(), r.v, true); });
        });
      });
    }

    // Base64, URL and the other encoders live in Text Tools.
    function textToolsTool() {
      var text = selText() || (V() ? V().state.doc.toString() : "");
      try {
        if (window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function") {
          window.parent.__orosOpenAt("texttools", { text: text.slice(0, 2000000), group: "code" });
          return;
        }
      } catch (e) { /* standalone */ }
      H.toast(t("tt.none"));
    }

    // The Tools list: groups, a search box, and a suggestion from the
    // selection (a colour, a time stamp, a number).
    function toolsMenu() {
      if (!V()) return;
      var sel = selText(), lang = A().lang, rows = [];
      var JSON_ROWS = [
        { value: "json", label: t("tools.json"), sub: t("tools.jsonSub"), kw: "json format pretty" },
        { value: "jsonMin", label: t("tools.jsonMin"), sub: t("tools.jsonMinSub"), kw: "json minify compact" },
        { value: "jsonCheck", label: t("tools.jsonCheck"), sub: t("tools.jsonCheckSub"), kw: "json validate lint" },
        { value: "jsonSort", label: t("tools.jsonSort"), sub: t("tools.jsonSortSub"), kw: "json sort keys" },
        { value: "jsonYaml", label: t("tools.jsonYaml"), sub: t("tools.newTab"), kw: "json yaml convert" }
      ];
      var YAML_ROWS = [
        { value: "yamlCheck", label: t("tools.yamlCheck"), sub: t("tools.yamlCheckSub"), kw: "yaml yml validate lint" },
        { value: "yamlFormat", label: t("tools.yamlFormat"), sub: t("tools.yamlFormatSub"), kw: "yaml yml format" },
        { value: "yamlJson", label: t("tools.yamlJson"), sub: t("tools.newTab"), kw: "yaml yml json convert" }
      ];
      var groups = [
        { head: "JSON", rows: JSON_ROWS },
        { head: "YAML", rows: YAML_ROWS },
        { head: t("tools.gCodes"), rows: [
          { value: "hash", label: t("tools.hash"), sub: t("tools.hashSub"), kw: "hash md5 sha sha1 sha256 sha512 checksum" },
          { value: "uuid4", label: t("tools.uuid4"), sub: t("tools.uuid4Sub"), kw: "uuid guid random" },
          { value: "uuid7", label: t("tools.uuid7"), sub: t("tools.uuid7Sub"), kw: "uuid guid time" }
        ] },
        { head: t("tools.gValues"), rows: [
          { value: "time", label: t("tools.time"), sub: t("tools.timeSub"), kw: "time timestamp unix epoch date iso" },
          { value: "base", label: t("tools.base"), sub: t("tools.baseSub"), kw: "hex binary octal decimal number base" },
          { value: "color", label: t("tools.color"), sub: t("tools.colorSub"), kw: "colour color css rgb hsl hex" }
        ] },
        { head: t("tools.gLines"), rows: [
          { value: "az", label: t("tools.az"), kw: "sort" },
          { value: "za", label: t("tools.za"), kw: "sort" },
          { value: "uniq", label: t("tools.uniq"), kw: "duplicates unique" },
          { value: "trim", label: t("tools.trim"), kw: "trim whitespace" }
        ] },
        { head: t("tools.gMore"), rows: [
          { value: "tt", label: t("tools.tt"), sub: t("tools.ttSub"), kw: "base64 url encode decode html slug text tools" }
        ] }
      ];
      // The file's own kind first: a YAML file shows YAML on top.
      if (lang === "yaml") groups.splice(0, 2, groups[1], groups[0]);
      var hint = window.PadDev ? window.PadDev.sniff(sel) : "";
      if (hint) {
        var pick = { color: "color", time: "time", base: "base" }[hint], all = [].concat.apply([], groups.map(function (g) { return g.rows; }));
        var s = all.filter(function (r) { return r.value === pick; })[0];
        if (s) rows.push({ head: t("tools.gHint") }, { value: s.value, label: s.label, sub: s.sub, kw: s.kw });
      }
      groups.forEach(function (g) { rows.push({ head: g.head }); rows = rows.concat(g.rows); });
      H.choose(t("tools.title"), rows, V().state.selection.main.empty ? t("tools.whole") : t("tools.sel"), { filter: t("tools.search") }).then(function (v) {
        var map = {
          json: function () { H.jsonTool(true); }, jsonMin: function () { H.jsonTool(false); },
          jsonCheck: jsonCheckTool, jsonSort: jsonSortTool, jsonYaml: jsonToYamlTool,
          yamlCheck: yamlCheckTool, yamlFormat: yamlFormatTool, yamlJson: yamlToJsonTool,
          hash: hashTool, uuid4: function () { uuidTool(false); }, uuid7: function () { uuidTool(true); },
          time: timeTool, base: baseTool, color: colorTool, tt: textToolsTool,
          az: function () { H.applyTool(function (x) { return H.C.sortLines(x, false, H.locale()); }); },
          za: function () { H.applyTool(function (x) { return H.C.sortLines(x, true, H.locale()); }); },
          uniq: function () { H.applyTool(H.C.uniqueLines); },
          trim: function () { H.applyTool(H.C.trimTrailing); }
        };
        if (v && map[v]) map[v]();
      });
      loadDev();   // ready for the next time (the suggestion row needs it)
    }

    return { toolsMenu: toolsMenu, closeDev: closeDev };
  };
})();
