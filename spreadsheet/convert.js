/* ============================================================
   convert.js — orOS Spreadsheet's side of the orOS Converter
   (OrosConvert.spreadsheet). .xlsx / .xls / .ods / .csv -> an
   .orossheet bundle, the same file Spreadsheet saves with "orOS
   file (.orossheet)" after it opened that file into an empty
   workbook: the same import (sheetimport.js, shared with the app),
   the same content.json (sheetkit.js bookContent), the same preview
   CSVs and thumbnail and the same OrosBundle.write options.
   One difference by design: the empty "Sheet1" an empty workbook
   starts with is left out, so opening the result adds exactly the
   sheets of the source file (what opening the source itself adds).
   Loading this file boots nothing: no DOM, no storage, no sync.
   UMD: window.OrosConvert.spreadsheet, module.exports in Node.
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function (root) {
"use strict";

var FROM = [".xlsx", ".xls", ".ods", ".csv"];
var MAX_BYTES = 50 * 1024 * 1024;
var MIME = "application/x-oros-sheet";

var STR = {
  en: { trunc: "Capped at {r} rows × {c} columns", bad: "Could not read this file",
        unsupported: "Not a spreadsheet file Spreadsheet can open", toobig: "The file is too big (over {n} MB)" },
  el: { trunc: "Περικόπηκε σε {r} γραμμές × {c} στήλες", bad: "Αδύνατη η ανάγνωση του αρχείου",
        unsupported: "Δεν είναι αρχείο που ανοίγει το Λογιστικά φύλλα", toobig: "Το αρχείο είναι πολύ μεγάλο (πάνω από {n} MB)" }
};

/* the helper scripts / libraries: global in the page (loaded from
   deps by the Converter), require() in Node */
function lib(name, path) {
  if (root && root[name]) return root[name];
  if (typeof require === "function") {
    try { return require(path); } catch (e) {}
  }
  return null;
}
function libs() {
  return {
    XLSX: lib("XLSX", "../vendor/xlsx.full.min.js"),
    FX: lib("OrosSheetFx", "./functions.js"),
    KIT: lib("OrosSheetKit", "./sheetkit.js"),
    SI: lib("OrosSheetImport", "./sheetimport.js"),
    B: lib("OrosBundle", "../bundle.js")
  };
}

function fail(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
function extOf(name) { var m = /\.[^.\/\\]+$/.exec(String(name || "")); return m ? m[0].toLowerCase() : ""; }
function baseOf(name) {
  var s = String(name || "").replace(/^.*[\/\\]/, "").replace(/\.[^.]+$/, "").trim();
  return s || "Spreadsheet";
}
/* spreadsheet.js uid() */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function bytesOf(file) {
  if (file && typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise(function (resolve, reject) {
    if (typeof FileReader === "undefined") { reject(fail("bad")); return; }
    var rd = new FileReader();
    rd.onload = function () { resolve(rd.result); };
    rd.onerror = function () { reject(fail("bad")); };
    rd.readAsArrayBuffer(file);
  });
}

/* The canonical form (spreadsheet.js canonSS) of freshly imported
   records, which carry no tombstones, formats other than merges,
   widths or frozen panes: sheets by (pos, id) with canonSheet's key
   order, cells by key with canonCell's key order and one stamp for
   both fields. tests/convert-spreadsheet.test.js checks it against
   canonSS itself. */
var F_KEYS = ["b", "i", "u", "al", "co", "nf", "bg", "bd", "wr", "va", "mr", "mc"];
function canonFresh(sheets, cells) {
  var out = { ver: 2, sheets: [], cells: {}, deleted: {} };
  out.sheets = sheets.map(function (sh) {
    var o = { id: sh.id, name: (typeof sh.name === "string") ? sh.name : null };
    if (o.name === null && sh.bi) o.bi = { en: String(sh.bi.en || ""), el: String(sh.bi.el || "") };
    o.rows = sh.rows; o.cols = sh.cols; o.pos = sh.pos; o.mtime = sh.mtime; o.cw = {};
    if (sh.rh) {
      var rh = {}, any = false;
      Object.keys(sh.rh).sort(function (x, y) { return (+x) - (+y); }).forEach(function (k) { rh[k] = sh.rh[k]; any = true; });
      if (any) o.rh = rh;
    }
    return o;
  }).sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
  Object.keys(cells).sort().forEach(function (k) {
    var cel = cells[k], o = { v: cel.v, mtime: cel.mtime };
    if (cel.f) {
      var f = {}, anyF = false;
      F_KEYS.forEach(function (n) { if (cel.f[n] !== undefined) { f[n] = cel.f[n]; anyF = true; } });
      if (anyF) o.f = f;
    }
    if (o.v === "" && !o.f) return;
    if (typeof cel.cv === "string" && cel.cv !== "") o.cv = cel.cv;
    o.fm = { v: cel.mtime, f: cel.mtime };
    out.cells[k] = o;
  });
  return out;
}

/* the app's formula engine glue (spreadsheet.js SECTION 3b) over the
   converted workbook: for the preview CSVs only */
function engineFor(FX, st, lang) {
  var extent = {}, fcells = null;
  function key(n) { return String(n).toLowerCase().replace(/[^a-z0-9α-ω]/g, ""); }
  return FX.engine({
    raw: function (sid, r, c) { var cel = st.cells[sid + "|" + r + "|" + c]; return cel ? cel.v : ""; },
    cached: function (sid, r, c) { var cel = st.cells[sid + "|" + r + "|" + c]; return cel ? cel.cv : undefined; },
    sheetId: function (name) {
      var nl = key(name);
      for (var i = 0; i < st.sheets.length; i++) {
        var sh = st.sheets[i], n = sh.name || (sh.bi && (sh.bi[lang] || sh.bi.en)) || "";
        if (key(n) === nl) return sh.id;
      }
      return null;
    },
    extent: function (sid) {
      if (!Object.prototype.hasOwnProperty.call(extent, sid)) {
        var rows = 0, cols = 0, pref = sid + "|", k, p;
        for (k in st.cells) {
          if (k.lastIndexOf(pref, 0) !== 0) continue;
          p = k.split("|");
          if (+p[1] + 1 > rows) rows = +p[1] + 1;
          if (+p[2] + 1 > cols) cols = +p[2] + 1;
        }
        extent[sid] = { rows: rows, cols: cols };
      }
      return extent[sid];
    },
    formulaCells: function () {
      if (!fcells) {
        fcells = [];
        for (var k in st.cells) {
          if (st.cells[k].v.charAt(0) === "=") { var p = k.split("|"); fcells.push([p[0], +p[1], +p[2]]); }
        }
        fcells.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] - b[1]) || (a[2] - b[2]); });
      }
      return fcells;
    },
    lang: lang,
    now: function () { return Date.now(); }
  });
}

function makeCanvas(w, h) {
  try {
    if (typeof document !== "undefined" && document.createElement) return document.createElement("canvas");
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  } catch (e) {}
  return null;
}

function convert(file, opts) {
  opts = opts || {};
  /* S: the messages (a pack language through orosI18n, browser only);
     lang: "el" / "en" for the workbook itself */
  var I = root && root.orosI18n, lang = opts.lang === "el" ? "el" : "en";
  var S = STR[opts.lang] || (I && opts.lang && I.known(opts.lang) ? I.table(STR, "spreadsheet", opts.lang) : STR[lang]);
  var prog = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
  function step(x) { try { prog(x); } catch (e) {} }
  return Promise.resolve().then(function () {
    var ext = extOf(file && file.name);
    if (!file || FROM.indexOf(ext) < 0) throw fail("unsupported", S.unsupported);
    if (typeof file.size === "number" && file.size > MAX_BYTES)
      throw fail("toobig", S.toobig.replace("{n}", MAX_BYTES / 1048576));
    var L = libs();
    if (!L.SI || !L.KIT || !L.FX || !L.B || (ext !== ".csv" && !L.XLSX)) throw fail("bad", "missing deps");
    step(0.05);
    return bytesOf(file).then(function (buf) {
      step(0.2);
      var SI = L.SI, ts = Date.now(), imp, warnings = [];
      /* an empty workbook: the seed "Sheet1" at tab 0 (left out of the
         result), so new sheets start at tab 1 and a CSV is "Sheet2"
         like in the app */
      var o = { uid: uid, now: ts, pos: 1, n: 2 };
      try {
        if (ext === ".csv") {
          var rows = SI.csvParse(SI.sniffDecode(buf));
          if (!rows.length) throw fail("bad", S.bad);
          imp = SI.csvSheet(rows, o);
        } else {
          imp = SI.workbookSheets(SI.readWorkbook(L.XLSX, buf), L.XLSX.utils, o);
        }
      } catch (e) {
        throw (e && e.code === "bad") ? e : fail("bad", S.bad + (e && e.message ? " (" + e.message + ")" : ""));
      }
      if (!imp.sheets.length) throw fail("bad", S.bad);
      if (imp.truncated) warnings.push(S.trunc.replace("{r}", SI.MAX_ROWS).replace("{c}", SI.MAX_COLS));
      step(0.5);

      var canon = canonFresh(imp.sheets, imp.cells);
      var eng = engineFor(L.FX, canon, lang);
      function textOf(sid, r, c, cel) { return SI.previewText(cel, function () { return eng.value(sid, r, c); }, L.FX); }
      var preview = SI.previewFiles(L.KIT, canon, textOf, function (sh) { return SI.sheetLabel(sh, lang); });
      var first = canon.sheets[0];
      step(0.7);
      return SI.thumbnail(makeCanvas,
        function (r, c) { return canon.cells[first.id + "|" + r + "|" + c]; },
        function (r, c, cel) { return textOf(first.id, r, c, cel); }
      ).then(function (thumb) {
        var title = baseOf(file.name);
        return L.B.write(SI.writeOpts({ KIT: L.KIT, canon: canon, title: title, lang: lang,
          active: imp.lastId, now: ts, thumb: thumb, preview: preview }))
          .then(function (bytes) {
            step(1);
            return { blob: new Blob([bytes], { type: MIME }), name: title + ".orossheet", warnings: warnings };
          });
      });
    });
  });
}

var API = {
  app: "spreadsheet", to: ".orossheet", mime: MIME,
  from: FROM.slice(),
  deps: ["vendor/xlsx.full.min.js", "spreadsheet/functions.js", "spreadsheet/sheetkit.js",
         "spreadsheet/sheetimport.js", "bundle.js"],
  maxBytes: MAX_BYTES,
  convert: convert,
  _canonFresh: canonFresh        /* for the Node tests */
};
if (root) {
  root.OrosConvert = root.OrosConvert || {};
  root.OrosConvert.spreadsheet = API;
}
if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
