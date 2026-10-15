/* ============================================================
   sheetimport.js — orOS Spreadsheet, file import + the .orossheet
   pack (OrosSheetImport). Pure: no storage, no app state, no UI.
   One copy of the code that turns a CSV text or a SheetJS workbook
   into the app's own sheet and cell records, and of the pieces of
   the .orossheet file around content.json (the preview CSVs, the
   thumbnail, the OrosBundle.write options). Used by spreadsheet.js
   (the CSV / Excel import, "orOS file (.orossheet)") and by
   spreadsheet/convert.js (the orOS Converter), and required in the
   Node tests (tests/convert-spreadsheet.test.js).
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function (root) {
"use strict";

/* the app's limits (spreadsheet.js ROWS / COLS / MAX_ROWS / MAX_COLS /
   RH_MIN / RH_MAX); the app passes its own values in `o` */
var ROWS = 100, COLS = 26, MAX_ROWS = 10000, MAX_COLS = 104, RH_MIN = 18, RH_MAX = 400;
var SEED_BI = { en: "Sheet1", el: "Φύλλο1" };

function opt(o, k, d) { return (o && o[k] !== undefined) ? o[k] : d; }
function cellKey(sid, r, c) { return sid + "|" + r + "|" + c; }
function colName(n) {
  var s = ""; n += 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ---------- text decoding + CSV ---------- */

/* Encoding-safe decoder: BOM sniff first (UTF-8 / UTF-16 LE+BE),
   then strict UTF-8 validation, then Greek ANSI (windows-1253).
   Used by CSV + Excel import so Greek never turns to mojibake. */
function sniffDecode(buf) {
  var u = new Uint8Array(buf);
  if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF)
    return new TextDecoder("utf-8").decode(u.subarray(3));
  if (u.length >= 2 && u[0] === 0xFF && u[1] === 0xFE)
    return new TextDecoder("utf-16le").decode(u.subarray(2));
  if (u.length >= 2 && u[0] === 0xFE && u[1] === 0xFF)
    return new TextDecoder("utf-16be").decode(u.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u);
  } catch (e) {}
  try {
    return new TextDecoder("windows-1253").decode(u);
  } catch (e) {}
  return new TextDecoder("utf-8").decode(u);
}

/* SS-6: Greek / European Excel writes ';'-separated CSV. The
   separator is the one of , ; TAB that occurs most in the first line
   outside quotes. */
function csvSniffSep(text) {
  var line = text.split(/\r?\n/)[0] || "", n = { ",": 0, ";": 0, "\t": 0 };
  var inQ = false, i, ch;
  for (i = 0; i < line.length; i++) {
    ch = line.charAt(i);
    if (ch === '"') inQ = !inQ;
    else if (!inQ && n.hasOwnProperty(ch)) n[ch]++;
  }
  if (n[";"] > n[","] && n[";"] >= n["\t"]) return ";";
  if (n["\t"] > n[","] && n["\t"] > n[";"]) return "\t";
  return ",";
}

/* text -> rows of fields; rows.truncated when the caps cut it */
function csvParse(text, o) {
  var rowsCap = opt(o, "rowsCap", MAX_ROWS), colsCap = opt(o, "colsCap", MAX_COLS);
  var rows = [], row = [], field = "", inQ = false, i, ch;
  var sep = csvSniffSep(text);
  for (i = 0; i < text.length; i++) {
    ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === sep) { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (ch === "\r") { }
      else field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  /* SS-6: hard cap at the normalizeState limits (XL_ROWS_CAP x
     XL_COLS_CAP). It cut every row to 26 columns without a word. */
  var cut = rows.length > rowsCap;
  if (cut) rows.length = rowsCap;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length > colsCap) { rows[r].length = colsCap; cut = true; }
  }
  rows.truncated = cut;
  return rows;
}

/* parsed CSV rows -> one new sheet, named "Sheet<n>" / "Φύλλο<n>".
   o: { uid, now, n, pos, rows, cols, rowsCap, colsCap }
   -> { sheets: [sh], cells: {}, truncated, lastId } */
function csvSheet(rows, o) {
  var rowsCap = opt(o, "rowsCap", MAX_ROWS), colsCap = opt(o, "colsCap", MAX_COLS);
  var n = o.n, maxCols = 0, ii;
  for (ii = 0; ii < rows.length; ii++)
    if (rows[ii].length > maxCols) maxCols = rows[ii].length;
  var sh = {
    id: o.uid(),
    name: null,
    bi: { en: "Sheet" + n, el: "Φύλλο" + n },
    rows: Math.min(Math.max(opt(o, "rows", ROWS), rows.length + 5), rowsCap),
    cols: Math.min(Math.max(opt(o, "cols", COLS), maxCols), colsCap),
    cw: {},
    pos: o.pos,
    mtime: o.now
  };
  var cells = {}, r, c, ts = o.now;
  for (r = 0; r < rows.length; r++)
    for (c = 0; c < rows[r].length; c++)
      if (rows[r][c] !== "")
        cells[cellKey(sh.id, r, c)] = { v: rows[r][c], mtime: ts };
  return { sheets: [sh], cells: cells, truncated: !!rows.truncated, lastId: sh.id };
}

/* ---------- Excel / Calc through SheetJS ---------- */

function xlPad(n) { return (n < 10 ? "0" : "") + n; }

function xlDateStr(d) {
  var s = d.getFullYear() + "-" + xlPad(d.getMonth() + 1) + "-" + xlPad(d.getDate());
  if (d.getHours() || d.getMinutes() || d.getSeconds())
    s += " " + xlPad(d.getHours()) + ":" + xlPad(d.getMinutes());
  return s;
}

/* Excel sheet-name rules: no []:*?/\ , max 31 chars */
function xlSafeName(nm) {
  var s = String(nm).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31).trim();
  return s || "Sheet";
}

/* worksheet cell -> our raw v string. Formulas ride through as
   "=..." (our engine evaluates the ones it knows; unknown ones
   show #NAME? but the text is preserved and round-trips).    */
function xlCellToRaw(cell) {
  if (cell.f) return "=" + String(cell.f);
  if (cell.t === "n") return isFinite(cell.v) ? String(cell.v) : "";
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "d") return xlDateStr(cell.v);
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

/* Excel's own cached result for a formula cell — kept as `cv`
   (additive field, rides whole-cell LWW, no DATA_VER bump).     */
function xlCacheRaw(cell) {
  if (cell.t === "n") return isFinite(cell.v) ? String(cell.v) : "";
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "d") return xlDateStr(cell.v);
  if (cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

/* the file's bytes -> a SheetJS workbook. Real .xlsx/.ods = ZIP
   (magic "PK") and real Excel 97-2003 .xls = OLE compound file
   (magic D0 CF 11 E0) -> read as array. Plain CSV/text disguised as
   .xls -> sniff decode, then let SheetJS parse the STRING with
   correct encoding. Throws what SheetJS throws. */
function readWorkbook(XLSX, buf) {
  var u8 = new Uint8Array(buf);
  var isZip = u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4B &&
              (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07);
  /* a binary .xls went through the text path before and came in as
     one cell of mojibake */
  var isOle = u8.length > 7 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0 &&
              u8[4] === 0xA1 && u8[5] === 0xB1 && u8[6] === 0x1A && u8[7] === 0xE1;
  return (isZip || isOle)
    ? XLSX.read(buf, { type: "array", cellDates: true, cellStyles: true })
    : XLSX.read(sniffDecode(buf), { type: "string", cellDates: true });
}

/* A SheetJS workbook -> new sheets: every worksheet with a range
   becomes one sheet at tab positions o.pos, o.pos + 1, …
   X: XLSX.utils. o: { uid, now, pos, rows, cols, rowsCap, colsCap,
   rhMin, rhMax } -> { sheets, cells, truncated, lastId } */
function workbookSheets(wb, X, o) {
  var rowsCap = opt(o, "rowsCap", MAX_ROWS), colsCap = opt(o, "colsCap", MAX_COLS);
  var rhMin = opt(o, "rhMin", RH_MIN), rhMax = opt(o, "rhMax", RH_MAX);
  var out = { sheets: [], cells: {}, truncated: false, lastId: null };
  var cells = out.cells, ts = o.now, pos = o.pos;
  for (var si = 0; si < wb.SheetNames.length; si++) {
    var ws = wb.Sheets[wb.SheetNames[si]];
    if (!ws || !ws["!ref"]) continue;
    var rng = X.decode_range(ws["!ref"]);
    var needRows = rng.e.r - rng.s.r + 1;
    var needCols = rng.e.c - rng.s.c + 1;
    if (needRows > rowsCap || needCols > colsCap) out.truncated = true;

    var sh = {
      id: o.uid(),
      name: xlSafeName(wb.SheetNames[si]),
      bi: undefined,
      rows: Math.min(Math.max(opt(o, "rows", ROWS), needRows + 5), rowsCap),
      cols: Math.min(Math.max(opt(o, "cols", COLS), needCols), colsCap),
      cw: {},
      pos: pos++,
      mtime: ts
    };
    out.sheets.push(sh);
    out.lastId = sh.id;

    for (var R = rng.s.r; R <= rng.e.r; R++) {
      if (R - rng.s.r >= rowsCap) break;
      for (var C = rng.s.c; C <= rng.e.c; C++) {
        if (C - rng.s.c >= colsCap) break;
        var cell = ws[X.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        var v = xlCellToRaw(cell);
        if (v === "") continue;
        var rec = { v: v, mtime: ts };
        if (cell.f) {
          var cv = xlCacheRaw(cell);
          if (cv !== "") rec.cv = cv;
        }
        cells[cellKey(sh.id, R - rng.s.r, C - rng.s.c)] = rec;
      }
    }
    /* custom row heights come along */
    (ws["!rows"] || []).forEach(function (ro, ri) {
      var hp = ro && (ro.hpt ? ro.hpt * 4 / 3 : ro.hpx), rr = ri - rng.s.r;
      if (!hp || ro.hidden || rr < 0 || rr >= sh.rows || Math.abs(hp - 20) < 3) return;
      sh.rh = sh.rh || {};
      sh.rh[rr] = Math.max(rhMin, Math.min(rhMax, Math.round(hp)));
    });
    /* merged cells come along (on the top-left cell, at most 500 rows) */
    (ws["!merges"] || []).forEach(function (m) {
      if (!m || !m.s || !m.e) return;
      var r0 = m.s.r - rng.s.r, c0 = m.s.c - rng.s.c;
      if (r0 < 0 || c0 < 0 || r0 >= sh.rows || c0 >= sh.cols) return;
      var mr = Math.min(m.e.r - m.s.r + 1, 500, sh.rows - r0), mc = Math.min(m.e.c - m.s.c + 1, sh.cols - c0);
      if (!(mr > 1 || mc > 1)) return;
      var key = cellKey(sh.id, r0, c0), rec2 = cells[key] || { v: "", mtime: ts };
      rec2.f = rec2.f || {};
      if (mr > 1) rec2.f.mr = mr;
      if (mc > 1) rec2.f.mc = mc;
      cells[key] = rec2;
    });
  }
  return out;
}

/* ---------- the .orossheet file around content.json ---------- */

/* a cell as text for the CSV preview: formulas by their result.
   value() -> the engine's value of the cell; FX: OrosSheetFx */
function previewText(cel, value, FX) {
  var v = cel ? cel.v : "";
  if (!v) return "";
  if (v.charAt(0) === "=") {
    var res = value();
    if (typeof res === "number" && isFinite(res)) return String(+res.toPrecision(15));
    return FX.display(res, "en");
  }
  return v.charAt(0) === "'" ? v.slice(1) : v;
}

/* a sheet's shown name: its own name, else the bilingual default */
function sheetLabel(sh, lang) {
  if (!sh) return "";
  if (sh.name !== null && sh.name !== undefined) return sh.name;
  return sh.bi ? (sh.bi[lang] || sh.bi.en || sh.id) : sh.id;
}

/* preview/NN-<name>.csv for every sheet that has cells.
   textOf(sid, r, c, cel) -> shown text; nameOf(sh) -> tab name */
function previewFiles(KIT, canon, textOf, nameOf) {
  var preview = [];
  canon.sheets.forEach(function (sh, i) {
    var csv = KIT.sheetCSV(sh.id, canon.cells, textOf);
    if (csv !== null) preview.push({ name: KIT.csvName(i, nameOf(sh)), data: csv, type: "text/csv" });
  });
  return preview;
}

/* the first sheet's top-left corner as a PNG (≤ 512 px), or null.
   makeCanvas(w, h) -> a canvas (HTMLCanvasElement or OffscreenCanvas)
   or null; cellAt(r, c) -> the cell record; textOf(r, c, cel) */
function thumbnail(makeCanvas, cellAt, textOf) {
  return new Promise(function (resolve) {
    try {
      var W = 512, H = 320, RH = 20, CWD = 84, HW = 28, rows = Math.floor((H - RH) / RH), cols = Math.ceil((W - HW) / CWD);
      var cv = makeCanvas ? makeCanvas(W, H) : null;
      if (!cv) { resolve(null); return; }
      cv.width = W; cv.height = H;
      var g = cv.getContext("2d");
      if (!g || !(cv.toBlob || cv.convertToBlob)) { resolve(null); return; }
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#eef0f3"; g.fillRect(0, 0, W, RH); g.fillRect(0, 0, HW, H);
      g.strokeStyle = "#d5d9df"; g.lineWidth = 1;
      var r, c, x, y;
      for (r = 0; r <= rows; r++) { y = RH + r * RH + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      for (c = 0; c <= cols; c++) { x = HW + c * CWD + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      g.font = "11px sans-serif"; g.textBaseline = "middle"; g.fillStyle = "#6b7280";
      for (c = 0; c < cols; c++) g.fillText(colName(c), HW + c * CWD + CWD / 2 - 4, RH / 2);
      for (r = 0; r < rows; r++) g.fillText(String(r + 1), 4, RH + r * RH + RH / 2);
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
        var cel = cellAt(r, c);
        if (!cel || (!cel.v && !(cel.f && cel.f.bg))) continue;
        x = HW + c * CWD; y = RH + r * RH;
        if (cel.f && cel.f.bg) { g.fillStyle = cel.f.bg; g.fillRect(x + 1, y + 1, CWD - 1, RH - 1); }
        var txt = textOf(r, c, cel);
        if (!txt) continue;
        g.font = (cel.f && cel.f.i ? "italic " : "") + (cel.f && cel.f.b ? "bold " : "") + "12px sans-serif";
        g.fillStyle = (cel.f && cel.f.co) || "#1f2328";
        g.save(); g.beginPath(); g.rect(x + 1, y, CWD - 2, RH); g.clip();
        g.fillText(txt, x + 4, y + RH / 2); g.restore();
      }
      if (cv.toBlob) cv.toBlob(function (b) { resolve(b || null); }, "image/png");
      else cv.convertToBlob({ type: "image/png" }).then(function (b) { resolve(b || null); }, function () { resolve(null); });
    } catch (e) { resolve(null); }
  });
}

/* the OrosBundle.write options of a workbook.
   o: { KIT, canon, title, lang, active, now, thumb, preview } */
var BOOK_MIME = "application/x-oros-sheet";
function writeOpts(o) {
  var canon = o.canon, ts = o.now;
  return {
    mime: BOOK_MIME, app: "spreadsheet", schema: "spreadsheet/1", content: o.KIT.bookContent(canon),
    meta: { title: o.title, created: Math.min.apply(null, canon.sheets.map(function (sh) { return sh.mtime || ts; })),
            modified: ts, language: o.lang === "el" ? "el" : "en", generator: "orOS Spreadsheet" },
    settings: { active: o.active },
    thumbnail: o.thumb || undefined, preview: o.preview, date: new Date(ts)
  };
}

var API = {
  ROWS: ROWS, COLS: COLS, MAX_ROWS: MAX_ROWS, MAX_COLS: MAX_COLS, RH_MIN: RH_MIN, RH_MAX: RH_MAX,
  SEED_BI: SEED_BI, BOOK_MIME: BOOK_MIME,
  sniffDecode: sniffDecode, csvSniffSep: csvSniffSep, csvParse: csvParse, csvSheet: csvSheet,
  xlDateStr: xlDateStr, xlSafeName: xlSafeName, xlCellToRaw: xlCellToRaw, xlCacheRaw: xlCacheRaw,
  readWorkbook: readWorkbook, workbookSheets: workbookSheets,
  previewText: previewText, sheetLabel: sheetLabel, previewFiles: previewFiles,
  thumbnail: thumbnail, writeOpts: writeOpts
};
root.OrosSheetImport = API;
if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
