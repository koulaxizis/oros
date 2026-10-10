// ============================================================
// orOS Spreadsheet — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-spreadsheet-data, never writes.
// Hits: one per sheet (its name) and one per text cell (the typed
// text; sheet name and cell reference such as "B4" as text).
// Formulas and plain numbers are not searched. Cells are
// pre-filtered with ctx.words and capped (MAX_SCAN cells read,
// MAX_CELLS cell hits), so a huge workbook stays fast. Deleted
// sheets and cells (deleted{} tombstones, per cell or per sheet)
// are skipped.
// Opens through the generic deep link: target { sheet, r?, c? }
// (receiver in spreadsheet.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-spreadsheet-data";
  var MAX_SCAN = 20000, MAX_CELLS = 300;
  var KEY_RE = /^([\w-]+)\|(\d+)\|(\d+)$/;
  var NUMERIC = /^[\s\d.,%€$£+\-()\/:]*$/;

  function num(n) { return typeof n === "number" && isFinite(n) && n > 0 ? n : 0; }
  // the value's own stamp (fm.v), as spreadsheet.js cellStamps() reads it
  function valueStamp(cel) {
    var m = num(cel.mtime);
    if (cel.fm && typeof cel.fm === "object") {
      var sv = num(cel.fm.v), sf = num(cel.fm.f);
      if (m <= Math.max(sv, sf)) return sv;
    }
    return m;
  }
  function colName(c) {
    var s = "";
    c = c + 1;
    while (c > 0) { var r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }

  var PROVIDER = {
    id: "spreadsheet",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.sheets)) return out;
      var del = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var cells = d.cells && typeof d.cells === "object" ? d.cells : {};
      var words = Array.isArray(ctx.words) ? ctx.words : [];
      var fold = typeof ctx.fold === "function" ? ctx.fold : function (s) { return String(s).toLowerCase(); };
      function tomb(k) { var v = del[k]; return typeof v === "number" && isFinite(v) ? v : 0; }

      // live cells per sheet (a sheet older than its tombstone lives on
      // only while cells written after the deletion are in it)
      var keys = Object.keys(cells), liveIn = {}, parsed = [];
      for (var i = 0; i < keys.length && i < MAX_SCAN; i++) {
        var m = KEY_RE.exec(keys[i]), cel = cells[keys[i]];
        if (!m || !cel || typeof cel.v !== "string" || cel.v === "") continue;
        var st = valueStamp(cel);
        if (st <= Math.max(tomb(keys[i]), tomb(m[1]))) continue;
        liveIn[m[1]] = true;
        parsed.push({ sid: m[1], r: +m[2], c: +m[3], v: cel.v, m: st });
      }
      var sheets = {};
      d.sheets.forEach(function (sh) {
        if (!sh || typeof sh.id !== "string") return;
        var ts = tomb(sh.id);
        if (ts && num(sh.mtime) <= ts && !liveIn[sh.id]) return;
        var bi = sh.bi && typeof sh.bi === "object" ? sh.bi : {};
        var name = (typeof sh.name === "string" && sh.name.trim()) ||
                   (ctx.lang === "el" ? bi.el || bi.en : bi.en || bi.el) || "";
        sheets[sh.id] = String(name).trim() || (ctx.lang === "el" ? "Φύλλο" : "Sheet");
        out.push({ id: "s:" + sh.id, title: sheets[sh.id], text: "",
                   when: num(sh.mtime), target: { sheet: sh.id } });
      });
      var n = 0;
      for (var j = 0; j < parsed.length && n < MAX_CELLS; j++) {
        var p = parsed[j];
        if (!(p.sid in sheets)) continue;
        var v = p.v.trim();
        if (!v || v.charAt(0) === "=" || NUMERIC.test(v)) continue;
        var ref = colName(p.c) + (p.r + 1);
        if (words.length) {
          var hay = fold(v + " " + sheets[p.sid]), ok = true;
          for (var w = 0; w < words.length && ok; w++) if (hay.indexOf(words[w]) === -1) ok = false;
          if (!ok) continue;
        }
        n++;
        out.push({ id: "c:" + p.sid + "|" + p.r + "|" + p.c, title: v.slice(0, 200),
                   text: sheets[p.sid] + " · " + ref, when: p.m,
                   target: { sheet: p.sid, r: p.r, c: p.c } });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
