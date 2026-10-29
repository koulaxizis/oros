// ============================================================
// orOS Spreadsheet — commands.js: what the Assistant may change in a
// workbook (AS-EDIT, wave SS1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Spreadsheet, in
// the step format of the automations (recipes/core.js specs; field
// names as in the other catalogs where they mean the same). The same
// file runs in two places:
//   - in the Assistant, to check a command list, find the sheets it is
//     for (targets), count what it would change on a copy (preview)
//     and describe a sheet to the AI (outline, with the user's
//     consent);
//   - in Spreadsheet (assist.js), which applies it to a copy of the
//     workbook and writes what changed through the app's own cell,
//     sheet and object writes, so it syncs like any other change.
// The documents are the workbook's sheets. Cells are picked with
// range in A1 notation: "B2", "B2:D9", whole columns "B" or "B:D",
// whole rows "3" or "3:5" (whole columns and rows cover the cells in
// use), "" = every cell in use. format and clear also take has (words
// in the cell). Formulas follow what the app does: a value given once
// for a range is filled like the fill handle (references shift),
// inserted and removed rows and columns move the references to them
// in every sheet (functions.js adjustFormula), sorted rows keep their
// formulas pointing at their own row.
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more.
// Pure: no DOM. Needs recipes/core.js, functions.js (OrosSheetFx) and
// sheetkit.js (OrosSheetKit). Exposes window.SheetCommands (browser)
// or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var FX = node ? require("./functions.js") : root.OrosSheetFx;
  var KIT = node ? require("./sheetkit.js") : root.OrosSheetKit;
  if (!R || !FX || !KIT) return;

  // = spreadsheet.js (normalizeState, normFz, column resize, normRh)
  var MAX_ROWS = 10000, MAX_COLS = 104, FZ_MAX_R = 50, FZ_MAX_C = 26, DEFW = 88, ROWH = 28;
  var MAX_CELLS = 100000;   // cells one command may touch
  var NUMFMT = { gen: "gen", "0": "0", "2": "2", pct: "%", eur: "€", date: "d" };

  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  var RANGE = { t: "str", max: 40 }, RANGE_REQ = { t: "str", max: 40, req: 1 };

  // kind: "doc" (every command edits a sheet)
  var CATALOG = {
    set: { kind: "doc", args: { range: RANGE_REQ, text: { t: "str", max: 20000, req: 1 } } },
    replace: { kind: "doc", args: { range: RANGE, find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } } },
    clear: { kind: "doc", args: { range: RANGE_REQ, has: { t: "str", max: 200 }, part: oneOf(["", "values", "format", "fill", "border"]) } },
    format: { kind: "doc", args: { range: RANGE, has: { t: "str", max: 200 }, bold: ONOFF, ital: ONOFF, under: ONOFF, align: oneOf(["", "l", "c", "r"]),
      valign: oneOf(["", "t", "m", "b"]), c: { t: "color" }, fill: { t: "color" }, numfmt: oneOf(["", "gen", "0", "2", "pct", "eur", "date"]),
      wrap: ONOFF, border: oneOf(["", "all", "outer", "bottom", "none"]) } },
    size: { kind: "doc", args: { range: RANGE_REQ, w: { t: "num", lo: 40, hi: 400, def: null }, h: { t: "num", lo: 18, hi: 400, def: null } } },
    insert: { kind: "doc", args: { rows: { t: "str", max: 12 }, cols: { t: "str", max: 12 }, n: { t: "int", lo: 1, hi: 1000, def: 1 } } },
    remove: { kind: "doc", args: { rows: { t: "str", max: 12 }, cols: { t: "str", max: 12 } } },
    sort: { kind: "doc", args: { range: RANGE, by: { t: "str", max: 3, req: 1 }, desc: { t: "bool" }, head: ONOFF } },
    merge: { kind: "doc", args: { range: RANGE_REQ, each: oneOf(["", "row", "col"]) } },
    unmerge: { kind: "doc", args: { range: RANGE_REQ } },
    freeze: { kind: "doc", args: { cell: { t: "str", max: 8, req: 1 } } },
    rename: { kind: "doc", args: { title: { t: "str", max: 24, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Spreadsheet commands (the documents are the workbook's sheets; cells are picked with range in A1 notation: B2, B2:D9, whole columns B or B:D, whole rows 3 or 3:5 " +
    "(whole columns and rows cover the cells in use), \"\" every cell in use; rows and columns count from 1 and A as read_in_app shows them; null or \"\" leaves a field as it is):\n" + [
    "set: write `text` into the cells from the top-left cell of range: lines are rows, a tab (\\t) separates cells; one value for a range of several cells fills every cell (a formula like =B2*C2 is filled like the fill handle, its references shift); " +
      "a value starting with = is a formula; \"\" in a cell empties it; formats stay; the sheet grows when needed",
    "replace: find → repl in the values in range (cs = match case, word = whole words; repl \"\" removes); formulas are not changed (use set)",
    "clear: empty the cells in range (has: only cells with these words); part values|format|fill|border clears only that (\"\" everything)",
    "format: bold, ital, under (on|off), align l|c|r, valign t|m|b, c (text colour #rrggbb), fill (cell colour #rrggbb; clear part fill removes it), numfmt gen|0|2|pct|eur|date " +
      "(general, whole number, 2 decimals, percent, euro, date), wrap on|off (wrap long text), border all|outer|bottom|none for the cells in range (has: only cells with these words)",
    "size: w = width in px (40-400) of range's columns, h = height in px (18-400) of range's rows",
    "insert: n new empty rows before row `rows` (a number, or end) or new columns before column `cols` (a letter, or end); references below or to the right move",
    "remove: delete rows `rows` (5 or 5-7) or columns `cols` (C or C-E); the cells after them move up or left and formulas pointing into them show #REF!",
    "sort: sort the rows of range (\"\" the cells in use) by column `by` (a letter inside the range), desc = largest or Z first; head on|off: the first row is a heading that stays (\"\" decides by itself)",
    "merge: merge range into one cell (only its top-left value stays); each row|col merges each row or each column of it separately",
    "unmerge: split the merged cells in range",
    "freeze: keep the rows above and the columns left of `cell` in view while scrolling (B2 freezes row 1 and column A; A1 unfreezes)",
    "rename: the sheet's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var A1 = "\\$?[A-Za-z]{1,3}\\$?\\d{1,5}";
  var RANGE_RX = new RegExp("^\\s*(" + A1 + "(\\s*:\\s*" + A1 + ")?|[A-Za-z]{1,3}(\\s*[:-]\\s*[A-Za-z]{1,3})?|\\d{1,5}(\\s*[:-]\\s*\\d{1,5})?)?\\s*$");
  var CELL_RX = new RegExp("^\\s*" + A1 + "\\s*$");
  var INS_ROWS = /^\s*(\d{1,5}|end)\s*$/i, INS_COLS = /^\s*([A-Za-z]{1,3}|end)\s*$/i;
  var DEL_ROWS = /^\s*\d{1,5}(\s*[-:]\s*\d{1,5})?\s*$/, DEL_COLS = /^\s*[A-Za-z]{1,3}(\s*[-:]\s*[A-Za-z]{1,3})?\s*$/;

  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          (spec.t === "color" && raw[k] !== "" && !v) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.range === "string" && !RANGE_RX.test(raw.range)) bad.push("range " + JSON.stringify(raw.range.slice(0, 40)) + " is not a cell range (like B2:D9, B:D or 3:5)");
    if (typeof raw.cell === "string" && !CELL_RX.test(raw.cell)) bad.push("cell " + JSON.stringify(raw.cell.slice(0, 20)) + " is not a cell (like B2)");
    if (typeof raw.by === "string" && !/^\s*[A-Za-z]{1,3}\s*$/.test(raw.by)) bad.push("by " + JSON.stringify(raw.by.slice(0, 20)) + " is not a column letter");
    if (raw.op === "insert" || raw.op === "remove") {
      var rx = raw.op === "insert" ? [INS_ROWS, INS_COLS] : [DEL_ROWS, DEL_COLS];
      if (given(raw.rows) === given(raw.cols)) bad.push("give rows or cols (one of them)");
      else if (given(raw.rows) && !rx[0].test(String(raw.rows))) bad.push("rows " + JSON.stringify(String(raw.rows).slice(0, 20)) + " is not allowed");
      else if (given(raw.cols) && !rx[1].test(String(raw.cols))) bad.push("cols " + JSON.stringify(String(raw.cols).slice(0, 20)) + " is not allowed");
    }
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (st.op === "format" && !st.bold && !st.ital && !st.under && !st.align && !st.valign && !st.c && !st.fill && !st.numfmt && !st.wrap && !st.border) {
      return { err: "format: give bold, ital, under, align, valign, c, fill, numfmt, wrap or border" };
    }
    if (st.op === "size" && !given(st.w) && !given(st.h)) return { err: "size: give w or h" };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, i) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (i + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. The workbook copy ----------
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function key(sid, r, c) { return sid + "|" + r + "|" + c; }
  // A workbook as the commands see it: { sheets: [{ id, name, bi,
  // rows, cols, cw, fz?, rh?, pos }], cells: { key: { v, f?, cv? } },
  // charts, cf } (a copy of the app's state).
  function work(book) {
    var b = book && typeof book === "object" ? book : {}, cells = {};
    var sheets = (Array.isArray(b.sheets) ? b.sheets : []).filter(function (sh) { return sh && typeof sh.id === "string"; }).map(function (sh) {
      var o = { id: sh.id, name: typeof sh.name === "string" ? sh.name : null, rows: Math.min(Math.max(parseInt(sh.rows, 10) || 100, 1), MAX_ROWS),
        cols: Math.min(Math.max(parseInt(sh.cols, 10) || 26, 1), MAX_COLS), cw: clone(sh.cw && typeof sh.cw === "object" ? sh.cw : {}), pos: +sh.pos || 0 };
      if (o.name === null && sh.bi && typeof sh.bi === "object") o.bi = { en: String(sh.bi.en || ""), el: String(sh.bi.el || "") };
      if (sh.fz && typeof sh.fz === "object") o.fz = { r: parseInt(sh.fz.r, 10) || 0, c: parseInt(sh.fz.c, 10) || 0 };
      if (sh.rh && typeof sh.rh === "object") o.rh = clone(sh.rh);
      return o;
    });
    Object.keys(b.cells && typeof b.cells === "object" ? b.cells : {}).forEach(function (k) {
      var cel = b.cells[k];
      if (!cel || typeof cel.v !== "string" || !/^[\w-]+\|\d+\|\d+$/.test(k)) return;
      var o = { v: cel.v };
      if (cel.f && typeof cel.f === "object") o.f = clone(cel.f);
      if (typeof cel.cv === "string") o.cv = cel.cv;
      cells[k] = o;
    });
    return { sheets: sheets, cells: cells, charts: clone(b.charts && typeof b.charts === "object" ? b.charts : {}), cf: clone(b.cf && typeof b.cf === "object" ? b.cf : {}) };
  }
  function sheetOf(w, sid) { for (var i = 0; i < w.sheets.length; i++) if (w.sheets[i].id === sid) return w.sheets[i]; return null; }
  // = spreadsheet.js displayName
  function sheetName(sh, lang) {
    if (!sh) return "";
    if (sh.name !== null && sh.name !== undefined) return sh.name;
    return sh.bi ? (sh.bi[lang] || sh.bi.en || sh.id) : sh.id;
  }
  // = spreadsheet.js findSheetByName (formulas name sheets this way)
  function nameKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9α-ω]/g, ""); }
  function byName(w, name, lang) {
    var nl = nameKey(name);
    for (var i = 0; i < w.sheets.length; i++) if (nameKey(sheetName(w.sheets[i], lang)) === nl) return w.sheets[i];
    return null;
  }
  function extent(w, sid) {
    var rows = 0, cols = 0, pref = sid + "|";
    Object.keys(w.cells).forEach(function (k) {
      if (k.lastIndexOf(pref, 0) !== 0) return;
      var p = k.split("|");
      if (+p[1] + 1 > rows) rows = +p[1] + 1;
      if (+p[2] + 1 > cols) cols = +p[2] + 1;
    });
    return { rows: rows, cols: cols };
  }
  // The formula engine over a workbook copy (a new one after changes).
  function engine(w, lang) {
    var fcells = null, ext = {};
    return FX.engine({
      raw: function (sid, r, c) { var x = w.cells[key(sid, r, c)]; return x ? x.v : ""; },
      cached: function (sid, r, c) { var x = w.cells[key(sid, r, c)]; return x ? x.cv : undefined; },
      sheetId: function (name) { var sh = byName(w, name, lang); return sh ? sh.id : null; },
      extent: function (sid) { if (!ext[sid]) ext[sid] = extent(w, sid); return ext[sid]; },
      formulaCells: function () {
        if (!fcells) {
          fcells = [];
          Object.keys(w.cells).forEach(function (k) { if (w.cells[k].v.charAt(0) === "=") { var p = k.split("|"); fcells.push([p[0], +p[1], +p[2]]); } });
          fcells.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] - b[1]) || (a[2] - b[2]); });
        }
        return fcells;
      },
      lang: lang,
      now: function () { return Date.now(); }
    });
  }
  function snap(x) {
    if (!x) return "";
    var f = cleanF(x.f);
    return f ? JSON.stringify([x.v, f]) : x.v === "" ? "" : JSON.stringify([x.v]);
  }
  // a format object without empty fields, or undefined
  function cleanF(f) {
    if (!f || typeof f !== "object") return undefined;
    var o = {}, any = false;
    ["b", "i", "u", "al", "co", "nf", "bg", "bd", "wr", "va", "mr", "mc"].forEach(function (k) { if (f[k] !== undefined && f[k] !== null && f[k] !== "" && f[k] !== 0) { o[k] = f[k]; any = true; } });
    return any ? o : undefined;
  }
  // writes a cell (v, f) and says whether it changed
  function put(w, k, v, f) {
    var cur = w.cells[k], before = snap(cur), nf = cleanF(f);
    if (v === "" && !nf) delete w.cells[k];
    else {
      var o = { v: v };
      if (nf) o.f = nf;
      if (cur && cur.v === v && typeof cur.cv === "string") o.cv = cur.cv;
      w.cells[k] = o;
    }
    return snap(w.cells[k]) !== before;
  }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }

  // A range on a sheet → { t, b, l, r, whole: "" | "c" | "r" } or null.
  // whole columns and rows (and "") cover the cells in use.
  function parseRg(s) {
    s = String(s || "").replace(/\s+/g, "");
    if (/^[A-Za-z]{1,3}$/.test(s)) s = s + ":" + s;
    else if (/^\d{1,5}$/.test(s)) s = s + ":" + s;
    else if (/^([A-Za-z]{1,3}|\d{1,5})-([A-Za-z]{1,3}|\d{1,5})$/.test(s)) s = s.replace("-", ":");
    var g = KIT.parseRange(s, MAX_ROWS, MAX_COLS);
    if (!g) return null;
    var whole = /^[A-Za-z]+:[A-Za-z]+$/.test(s) ? "c" : /^\d+:\d+$/.test(s) ? "r" : "";
    return { t: g.t, b: g.b, l: g.l, r: g.r, whole: whole };
  }
  function rangeIn(w, sh, s) {
    var ext = extent(w, sh.id), g;
    if (!given(s)) {
      if (!ext.rows) return null;
      return { t: 0, b: ext.rows - 1, l: 0, r: ext.cols - 1, whole: "a" };
    }
    g = parseRg(s);
    if (!g) return null;
    if (g.whole === "c") g.b = Math.max(0, ext.rows - 1);
    if (g.whole === "r") g.r = Math.max(0, ext.cols - 1);
    g.b = Math.min(g.b, sh.rows - 1);
    g.r = Math.min(g.r, sh.cols - 1);
    if (g.t > g.b || g.l > g.r) return null;
    return g;
  }
  function cellsOf(g) { return (g.b - g.t + 1) * (g.r - g.l + 1); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function hasWords(x, words) { return !words || (x && x.v !== "" && norm(x.v).indexOf(words) >= 0); }

  // ---------- 3. Rows and columns (= spreadsheet.js structural) ----------
  // n > 0: insert n rows ("r") / columns ("c") before index `at`;
  // n < 0: delete -n of them from `at`. → false when the sheet is full.
  function structural(w, sh, axis, at, n, lang) {
    var sid = sh.id, cur = axis === "r" ? sh.rows : sh.cols, max = axis === "r" ? MAX_ROWS : MAX_COLS, end = at - n - 1;
    if (n > 0 && cur + n > max) return false;
    function pointsHere(host) {
      return function (name) {
        if (name === null) return host === sid;
        var s = byName(w, name, lang);
        return !!s && s.id === sid;
      };
    }
    var out = {};
    Object.keys(w.cells).forEach(function (k) {
      var cel = clone(w.cells[k]), p = k.split("|");
      if (cel.v.charAt(0) === "=") {
        var nv = FX.adjustFormula(cel.v, pointsHere(p[0]), axis, at, n);
        if (nv !== cel.v) { cel.v = nv; delete cel.cv; }
      }
      if (p[0] !== sid) { out[k] = cel; return; }
      var r = +p[1], c = +p[2], idx = axis === "r" ? r : c, to = idx;
      if (n > 0) { if (idx >= at) to = idx + n; }
      else if (idx >= at && idx <= end) return;
      else if (idx > end) to = idx + n;
      out[axis === "r" ? key(sid, to, c) : key(sid, r, to)] = cel;
    });
    w.cells = out;
    if (n > 0) { if (axis === "r") sh.rows += n; else sh.cols += n; }
    function shift(m) {
      var o = {};
      Object.keys(m).forEach(function (k) {
        var i = +k;
        if (n > 0) o[i >= at ? i + n : i] = m[k];
        else if (i < at) o[i] = m[k];
        else if (i > end) o[i + n] = m[k];
      });
      return o;
    }
    if (axis === "r" && sh.rh) sh.rh = shift(sh.rh);
    if (axis === "c") sh.cw = shift(sh.cw);
    // rule and chart ranges follow (= spreadsheet.js adjustObjs)
    Object.keys(w.cf).forEach(function (id) {
      var x = w.cf[id];
      if (x.sid !== sid) return;
      var g = KIT.parseRange(x.rg), ng = g && KIT.adjRange(g, axis, at, n);
      if (!ng) delete w.cf[id];
      else x.rg = KIT.rangeStr(ng);
    });
    Object.keys(w.charts).forEach(function (id) {
      var x = w.charts[id];
      if (x.sid !== sid) return;
      var g = KIT.parseRange(x.src);
      if (g) { var g2 = KIT.adjRange(g, axis, at, n); x.src = g2 ? KIT.rangeStr(g2) : "#REF!"; }
      if (!x.at || typeof x.at !== "object") return;
      var k = axis === "r" ? "r" : "c", a = x.at[k];
      if (n > 0) { if (a >= at) x.at[k] = a + n; }
      else if (a > end) x.at[k] = a + n;
      else if (a >= at) x.at[k] = at;
    });
    return true;
  }

  // ---------- 4. Merged cells (= spreadsheet.js mergeMap, mergeSel) ----------
  function merges(w, sh) {
    var pref = sh.id + "|", list = [], out = [];
    Object.keys(w.cells).forEach(function (k) {
      if (k.lastIndexOf(pref, 0) !== 0) return;
      var f = w.cells[k].f;
      if (!f || !(f.mr || f.mc)) return;
      var p = k.split("|"), r = +p[1], c = +p[2];
      if (r >= sh.rows || c >= sh.cols) return;
      list.push({ r: r, c: c, r2: Math.min(sh.rows - 1, r + (f.mr || 1) - 1), c2: Math.min(sh.cols - 1, c + (f.mc || 1) - 1) });
    });
    list.sort(function (a, b) { return (a.r - b.r) || (a.c - b.c); });
    list.forEach(function (m) {
      for (var i = 0; i < out.length; i++) { var o = out[i]; if (m.r <= o.r2 && m.r2 >= o.r && m.c <= o.c2 && m.c2 >= o.c) return; }
      out.push(m);
    });
    return out;
  }
  function unmergeIn(w, sh, g) {
    var k = 0;
    merges(w, sh).forEach(function (m) {
      if (m.r > g.b || m.r2 < g.t || m.c > g.r || m.c2 < g.l) return;
      var kk = key(sh.id, m.r, m.c), x = w.cells[kk], f = clone(x.f);
      delete f.mr; delete f.mc;
      if (put(w, kk, x.v, f)) k++;
    });
    return k;
  }

  // ---------- 5. Sorting (= spreadsheet.js sortSelection) ----------
  function looksLikeHeading(w, sh, g, eng) {
    var c, r, any = false, bold = false;
    for (c = g.l; c <= g.r; c++) {
      var x = w.cells[key(sh.id, g.t, c)];
      if (!x || x.v === "") continue;
      if (x.v.charAt(0) === "=" || typeof FX.literal(x.v) !== "string") return false;
      any = true;
      if (x.f && x.f.b) bold = true;
    }
    if (!any) return false;
    if (bold) return true;
    for (r = g.t + 1; r <= Math.min(g.b, g.t + 10); r++) {
      for (c = g.l; c <= g.r; c++) {
        var y = w.cells[key(sh.id, r, c)];
        if (y && y.v !== "" && typeof eng.value(sh.id, r, c) === "number") return true;
      }
    }
    return false;
  }
  function sortRows(w, sh, g, st, env) {
    var col = KIT.colFromName(String(st.by).trim());
    if (col < g.l || col > g.r) { note(env, "sortBy"); return 0; }
    var eng = engine(w, env.lang || "en");
    var hdr = st.head === "on" ? true : st.head === "off" ? false : looksLikeHeading(w, sh, g, eng);
    var first = g.t + (hdr ? 1 : 0);
    if (first >= g.b) return 0;
    var rows = [], vals = [], r, c, i, n = 0;
    for (r = first; r <= g.b; r++) {
      var x = w.cells[key(sh.id, r, col)];
      rows.push(r);
      vals.push(x && x.v !== "" ? eng.value(sh.id, r, col) : null);
    }
    var order = FX.sortOrder(vals, !!st.desc, env.lang || "en"), copy = {};
    for (r = first; r <= g.b; r++) for (c = g.l; c <= g.r; c++) copy[r + "|" + c] = clone(w.cells[key(sh.id, r, c)]) || null;
    for (i = 0; i < order.length; i++) {
      var src = rows[order[i]], dst = rows[i];
      if (src === dst) continue;
      var moved = false;
      for (c = g.l; c <= g.r; c++) {
        var sn = copy[src + "|" + c];
        if (sn && sn.v.charAt(0) === "=") {
          var nv = FX.shiftFormula(sn.v, dst - src, 0, MAX_ROWS, MAX_COLS);
          if (nv !== sn.v) { sn = clone(sn); sn.v = nv; delete sn.cv; }
        }
        var kk = key(sh.id, dst, c);
        if (snap(sn) !== snap(w.cells[kk])) {
          if (sn) w.cells[kk] = clone(sn); else delete w.cells[kk];
          moved = true;
        }
      }
      if (moved) n++;
    }
    return n;
  }

  // ---------- 6. Applying ----------
  function linesOf(text) {
    var s = String(text).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    return s.split("\n").map(function (l) { return l.split("\t").map(function (v) { return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ""); }); });
  }
  function setCells(w, sh, st, env) {
    var g = parseRg(st.range);
    if (!g) { note(env, "noCells"); return 0; }
    // whole columns and rows: the rows and columns in use
    var ext = extent(w, sh.id);
    if (g.whole === "c") g.b = Math.max(g.t, ext.rows - 1);
    if (g.whole === "r") g.r = Math.max(g.l, ext.cols - 1);
    var grid = linesOf(st.text), one = grid.length === 1 && grid[0].length === 1, k = 0, r, c, i, j;
    var plan = [];
    if (one) {
      if (cellsOf(g) > MAX_CELLS) { note(env, "big"); return 0; }
      for (r = g.t; r <= g.b; r++) for (c = g.l; c <= g.r; c++) {
        var v = grid[0][0];
        if (v.charAt(0) === "=" && (r !== g.t || c !== g.l)) v = FX.shiftFormula(v, r - g.t, c - g.l, MAX_ROWS, MAX_COLS);
        plan.push([r, c, v]);
      }
    } else {
      for (i = 0; i < grid.length; i++) for (j = 0; j < grid[i].length; j++) plan.push([g.t + i, g.l + j, grid[i][j]]);
    }
    plan.forEach(function (p) {
      if (p[0] >= MAX_ROWS || p[1] >= MAX_COLS) { note(env, "maxDims"); return; }
      var kk = key(sh.id, p[0], p[1]), cur = w.cells[kk];
      if ((cur ? cur.v : "") === p[2]) return;
      if (p[2] !== "") {
        if (p[0] >= sh.rows) sh.rows = p[0] + 1;
        if (p[1] >= sh.cols) sh.cols = p[1] + 1;
      }
      if (put(w, kk, p[2], cur && cur.f)) k++;
    });
    return k;
  }
  function each(g, fn) { for (var r = g.t; r <= g.b; r++) for (var c = g.l; c <= g.r; c++) fn(r, c); }

  // One command on a sheet of a workbook copy (work()) → how many
  // things changed. env: { notes: [], lang: "en" | "el" } (the
  // language sheet names in formulas are read in).
  function apply(w, sid, st, env) {
    env = env || {};
    var sh = sheetOf(w, sid);
    if (!sh) return 0;
    var k = 0, g, words = given(st.has) ? norm(st.has) : "";
    switch (st.op) {
      case "rename": {
        var tl = String(st.title || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24), old = sheetName(sh, env.lang || "en");
        if (!tl || tl === sh.name) return 0;
        var oldKey = nameKey(old), refs = false;
        Object.keys(w.cells).forEach(function (kk) {
          var v = w.cells[kk].v;
          if (v.charAt(0) === "=" && v.indexOf("!") > 0 && FX.mapRefs) {
            FX.mapRefs(v, function (ref) { if (ref.sheet !== null && ref.sheet !== undefined && nameKey(ref.sheet) === oldKey) refs = true; return null; });
          }
        });
        if (refs) note(env, "sheetRefs");
        sh.name = tl;
        delete sh.bi;
        return 1;
      }
      case "freeze": {
        var at = KIT.parseRange(String(st.cell).replace(/\$/g, ""), MAX_ROWS, MAX_COLS);
        if (!at) return 0;
        var fr = Math.max(0, Math.min(at.t, FZ_MAX_R, sh.rows - 1)), fc = Math.max(0, Math.min(at.l, FZ_MAX_C, sh.cols - 1));
        var was = sh.fz ? JSON.stringify(sh.fz) : "";
        if (fr || fc) sh.fz = { r: fr, c: fc }; else delete sh.fz;
        return (sh.fz ? JSON.stringify(sh.fz) : "") !== was ? 1 : 0;
      }
      case "insert": case "remove": {
        var axis = given(st.rows) ? "r" : "c", spec = String(axis === "r" ? st.rows : st.cols).trim().toUpperCase();
        var cur = axis === "r" ? sh.rows : sh.cols, a, b;
        var idx = function (s) { return axis === "r" ? parseInt(s, 10) - 1 : KIT.colFromName(s); };
        if (st.op === "insert") {
          var n = st.n || 1;
          a = spec === "END" ? cur : idx(spec);
          if (a < 0 || a > cur) { note(env, "noCells"); return 0; }
          if (cur + n > (axis === "r" ? MAX_ROWS : MAX_COLS)) { note(env, "maxDims"); return 0; }
          if (a === cur) { if (axis === "r") sh.rows += n; else sh.cols += n; return n; }
          structural(w, sh, axis, a, n, env.lang || "en");
          return n;
        }
        var parts = spec.split(/\s*[-:]\s*/);
        a = idx(parts[0]); b = parts.length > 1 ? idx(parts[1]) : a;
        if (a > b) { var tmp = a; a = b; b = tmp; }
        if (a < 0 || a >= cur) { note(env, "noCells"); return 0; }
        b = Math.min(b, cur - 1);
        structural(w, sh, axis, a, -(b - a + 1), env.lang || "en");
        return b - a + 1;
      }
      case "size": {
        g = rangeIn(w, sh, st.range);
        if (!g) { note(env, "noCells"); return 0; }
        if (given(st.w)) {
          for (var c = g.l; c <= g.r; c++) {
            var cw = Math.round(st.w);
            if ((sh.cw[c] || DEFW) !== cw) { if (cw === DEFW) delete sh.cw[c]; else sh.cw[c] = cw; k++; }
          }
        }
        if (given(st.h)) {
          if (g.b - g.t >= MAX_ROWS) return k;
          for (var r = g.t; r <= g.b; r++) {
            var rh = Math.round(st.h), have = (sh.rh && sh.rh[r]) || ROWH;
            if (have !== rh) {
              if (!sh.rh) sh.rh = {};
              if (rh === ROWH) delete sh.rh[r]; else sh.rh[r] = rh;
              k++;
            }
          }
          if (sh.rh && !Object.keys(sh.rh).length) delete sh.rh;
        }
        return k;
      }
      case "set":
        return setCells(w, sh, st, env);
    }
    g = rangeIn(w, sh, st.range);
    if (!g) { note(env, "noCells"); return 0; }
    if (cellsOf(g) > MAX_CELLS) { note(env, "big"); return 0; }
    switch (st.op) {
      case "replace": {
        var rx = finder(st), skipped = false;
        each(g, function (r, c) {
          var kk = key(sh.id, r, c), x = w.cells[kk];
          if (!x || x.v === "") return;
          rx.lastIndex = 0;
          if (!rx.test(x.v)) return;
          if (x.v.charAt(0) === "=") { skipped = true; return; }
          rx.lastIndex = 0;
          if (put(w, kk, x.v.replace(rx, st.repl || ""), x.f)) k++;
        });
        if (skipped) note(env, "formulas");
        return k;
      }
      case "clear":
        each(g, function (r, c) {
          var kk = key(sh.id, r, c), x = w.cells[kk];
          if (!x || !hasWords(x, words)) return;
          var f = clone(x.f) || {};
          if (st.part === "values") { if (put(w, kk, "", f)) k++; return; }
          if (st.part === "fill") delete f.bg;
          else if (st.part === "border") delete f.bd;
          else if (st.part === "format") f = {};
          else { if (put(w, kk, "", null)) k++; return; }
          if (put(w, kk, x.v, f)) k++;
        });
        return k;
      case "format":
        each(g, function (r, c) {
          var kk = key(sh.id, r, c), x = w.cells[kk];
          if (words && !hasWords(x, words)) return;
          var f = clone(x && x.f) || {};
          [["bold", "b"], ["ital", "i"], ["under", "u"], ["wrap", "wr"]].forEach(function (p) {
            if (st[p[0]] === "on") f[p[1]] = 1;
            else if (st[p[0]] === "off") delete f[p[1]];
          });
          if (st.align) f.al = st.align;
          if (st.valign) f.va = st.valign;
          if (st.c) f.co = st.c;
          if (st.fill) f.bg = st.fill;
          if (st.numfmt) f.nf = NUMFMT[st.numfmt];
          if (st.border) {
            var s = f.bd || "";
            if (st.border === "none") s = "";
            else if (st.border === "all") s = "tblr";
            else if (st.border === "bottom") { if (r === g.b) s += "b"; }
            else { if (r === g.t) s += "t"; if (r === g.b) s += "b"; if (c === g.l) s += "l"; if (c === g.r) s += "r"; }
            s = ["t", "b", "l", "r"].filter(function (e) { return s.indexOf(e) >= 0; }).join("");
            if (s) f.bd = s; else delete f.bd;
          }
          if (put(w, kk, x ? x.v : "", f)) k++;
        });
        return k;
      case "sort":
        return sortRows(w, sh, g, st, env);
      case "unmerge":
        return unmergeIn(w, sh, g);
      case "merge": {
        if (g.b - g.t > 499) { note(env, "big"); return 0; }
        var orig = {}, groups = [], lost = false;
        each(g, function (r, c) { orig[r + "|" + c] = snap(w.cells[key(sh.id, r, c)]); });
        unmergeIn(w, sh, g);
        if (st.each === "row") for (var gr = g.t; gr <= g.b; gr++) groups.push({ t: gr, b: gr, l: g.l, r: g.r });
        else if (st.each === "col") for (var gc = g.l; gc <= g.r; gc++) groups.push({ t: g.t, b: g.b, l: gc, r: gc });
        else groups.push(g);
        groups.forEach(function (m) {
          if (m.t === m.b && m.l === m.r) return;
          var kk = key(sh.id, m.t, m.l), x = w.cells[kk], f = clone(x && x.f) || {};
          if (m.b > m.t) f.mr = m.b - m.t + 1; else delete f.mr;
          if (m.r > m.l) f.mc = m.r - m.l + 1; else delete f.mc;
          put(w, kk, x ? x.v : "", f);
          each(m, function (r, c) {
            if (r === m.t && c === m.l) return;
            var k2 = key(sh.id, r, c);
            if (!w.cells[k2]) return;
            if (w.cells[k2].v !== "") lost = true;
            delete w.cells[k2];
          });
        });
        /* a group counts when it ends up other than it was */
        groups.forEach(function (m) {
          var ch = false;
          each(m, function (r, c) { if (snap(w.cells[key(sh.id, r, c)]) !== orig[r + "|" + c]) ch = true; });
          if (ch) k++;
        });
        if (lost) note(env, "mergeLost");
        return k;
      }
    }
    return 0;
  }

  // ---------- 7. For the Assistant ----------
  function curLang() {
    try { var l = root.document && root.document.documentElement.lang; return /^el/.test(l || "") ? "el" : "en"; } catch (e) { return "en"; }
  }
  // The stored workbook as a list of documents (its sheets): { docs:
  // [{ id, name, m }], data } (each doc's `store`, for outline, is
  // { book, id }).
  function view(data, lang) {
    if (!data || typeof data !== "object" || !Array.isArray(data.sheets)) return { docs: [], data: null };
    lang = lang || curLang();
    var list = data.sheets.filter(function (sh) { return sh && typeof sh.id === "string"; }).slice().sort(function (a, b) { return ((+a.pos || 0) - (+b.pos || 0)) || (a.id < b.id ? -1 : 1); });
    return { docs: list.map(function (sh) {
      var o = { id: sh.id, name: sheetName(sh, lang), m: Number(sh.mtime) || 0 };
      var alt = sh.bi && sh.name == null ? [sh.bi.en, sh.bi.el].filter(Boolean) : [];
      Object.defineProperty(o, "alt", { value: alt });
      Object.defineProperty(o, "store", { value: { book: data, id: sh.id, lang: lang } });   // not copied
      return o;
    }), data: data, lang: lang };
  }
  // Which sheets a request is for. data: view(), open: the open sheet's
  // id (the first sheet when none is stored). designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new sheet is added in Spreadsheet itself; use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Spreadsheet has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no sheets in Spreadsheet yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the sheet's name" };
      var names = function (d) { return [d.name].concat(d.alt || []).map(norm); };
      list = docs.filter(function (d) { return names(d).indexOf(q) >= 0; });
      if (!list.length) list = docs.filter(function (d) { return names(d).some(function (n) { return n.indexOf(q) >= 0; }); });
      if (!list.length) return { ok: false, err: "no sheet is called " + JSON.stringify(String(name).slice(0, 80)) + "; sheets: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name); }).join(", ") };
      if (list.length > 1) {
        var exact = list.filter(function (d) { return names(d).indexOf(q) >= 0; });
        if (exact.length === 1) list = exact;
        else return { ok: false, err: "several sheets match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      list = [o || docs[0]];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on a copy: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] };
    if (!data || !data.data) return out;
    var w = work(data.data), env = { notes: out.notes, lang: data.lang || curLang() };
    ids.forEach(function (id) {
      var k = 0;
      steps.forEach(function (st) { k += apply(w, id, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: sheetName(sheetOf(w, id), env.lang), n: k }); }
    });
    return out;
  }
  // A sheet for the model: its size, frozen panes, column widths, row
  // heights, merged cells, charts, rules and every cell in use with its
  // value (the formula as typed), what a formula shows, and its format
  // (up to a limit).
  var OUT_CELLS = 1500, OUT_TEXT = 300;
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function outline(doc) {
    var store = doc && doc.store;
    if (!store) return null;
    var w = work(store.book), sh = sheetOf(w, store.id), lang = store.lang || "en";
    if (!sh) return null;
    var ext = extent(w, sh.id), eng = engine(w, lang), pref = sh.id + "|";
    var o = { name: sheetName(sh, lang), rows: sh.rows, cols: sh.cols, used: ext.rows ? KIT.rangeStr({ t: 0, l: 0, b: ext.rows - 1, r: ext.cols - 1 }) : "",
      sheets: w.sheets.map(function (s) { return sheetName(s, lang); }) };
    if (sh.fz) o.frozen = KIT.colName(sh.fz.c) + (sh.fz.r + 1);
    var cw = Object.keys(sh.cw || {});
    if (cw.length) { o.widths = {}; cw.forEach(function (c) { o.widths[KIT.colName(+c)] = sh.cw[c]; }); }
    if (sh.rh && Object.keys(sh.rh).length) { o.heights = {}; Object.keys(sh.rh).forEach(function (r) { o.heights[+r + 1] = sh.rh[r]; }); }
    var mg = merges(w, sh);
    if (mg.length) o.merged = mg.slice(0, 200).map(function (m) { return KIT.rangeStr({ t: m.r, b: m.r2, l: m.c, r: m.c2 }); });
    var keys = Object.keys(w.cells).filter(function (k) { return k.lastIndexOf(pref, 0) === 0; }).map(function (k) { var p = k.split("|"); return [+p[1], +p[2], k]; });
    keys.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
    o.cells = [];
    keys.slice(0, OUT_CELLS).forEach(function (p) {
      var x = w.cells[p[2]], e = { ref: KIT.colName(p[1]) + (p[0] + 1), v: short(x.v, OUT_TEXT) };
      if (x.v.charAt(0) === "=") { var res = eng.value(sh.id, p[0], p[1]); e.shows = typeof res === "number" || typeof res === "boolean" ? res : short(FX.display(res, lang), OUT_TEXT); }
      if (x.f) e.f = x.f;
      o.cells.push(e);
    });
    if (keys.length > OUT_CELLS) o.note = "Only the first " + OUT_CELLS + " of " + keys.length + " cells are listed.";
    o.formats = "f: b bold, i italic, u underline, al align l|c|r, va vertical t|m|b, co text colour, bg fill, nf number format (gen, 0, 2, % percent, € euro, d date), bd borders t|b|l|r, wr wrap, mr/mc rows/columns merged";
    var ch = Object.keys(w.charts).map(function (id) { return w.charts[id]; }).filter(function (x) { return x.sid === sh.id; });
    if (ch.length) o.charts = ch.slice(0, 30).map(function (x) { var c = { type: x.t, data: x.src }; if (x.ttl) c.title = x.ttl; return c; });
    var cf = Object.keys(w.cf).filter(function (id) { return w.cf[id].sid === sh.id; });
    if (cf.length) o.rules = cf.length;
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS,
    check: check, work: work, apply: apply, sheetOf: sheetOf, sheetName: sheetName, merges: merges,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.SheetCommands = api;
})(typeof window !== "undefined" ? window : this);
