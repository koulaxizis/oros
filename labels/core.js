// ============================================================
// orOS Label Maker — core (v1.0.0)
// Pure logic, no DOM: which letters the tape can take, the uneven
// emboss of each letter, the size of a label in millimetres, the
// print sheet, the saved-labels merge and the recent list.
// Loaded by labels.js (window.LabelsCore) and by the tests.
//
// Saved labels (sync slice "labels"):
//   { ver: 1, labels: [{ id, m, text, tape, width, cut, margin }],
//     tombs: { id: deletedAt } }
// The .oroslabels file (labelsBundle / labelsFromBundle, below):
//   { kind: "oros-labels-package", ver: 1, copies, labels: [...] }
// ============================================================
(function (root) {
  "use strict";

  var MAX_LEN    = 40;
  var MAX_LABELS = 300;
  var MAX_RECENT = 10;
  var DATA_VER   = 1;
  var ID_RE      = /^l[a-z0-9]{6,20}$/;

  var TAPES   = ["red", "black", "blue", "green", "yellow", "white", "clear"];
  var WIDTHS  = [9, 12];                 // mm
  var CUTS    = ["straight", "round"];
  var MARGINS = [0, 1, 2];               // narrow, normal, wide
  var DEFAULT = { tape: "red", width: 12, cut: "straight", margin: 1 };

  // What the embossing wheel can print, in the wheel's order.
  var LATIN   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var GREEK   = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
  var DIGITS  = "0123456789";
  var SYMBOLS = "&-.,/:!?#+='()*@€♥★☺";
  var WHEEL   = Array.from(LATIN + GREEK + DIGITS + SYMBOLS);
  var ALLOWED = {};
  WHEEL.forEach(function (c) { ALLOWED[c] = 1; });

  // Look-alikes typed on a keyboard, mapped to what the wheel has.
  var ALIASES = {
    "’": "'", "‘": "'", "`": "'", "´": "'", "΄": "'", "ʼ": "'",
    "–": "-", "—": "-", "‐": "-", "−": "-", "_": "-",
    "·": ".", "…": "...", "«": "'", "»": "'", "\"": "'", "“": "'", "”": "'",
    "❤": "♥", "♡": "♥", "❥": "♥", "💕": "♥", "💖": "♥",
    "☆": "★", "⭐": "★", "✦": "★", "✩": "★",
    "☻": "☺", "🙂": "☺", "😊": "☺", "😀": "☺", "😃": "☺"
  };

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------- Text ----------
  // Capitals only, no accents (as on the real tape), letters the wheel
  // does not have left out, one space between words, at most MAX_LEN.
  // keepEnd keeps one trailing space (while typing).
  function cleanText(s, keepEnd) {
    if (typeof s !== "string") return "";
    // ";" is the question mark in Greek; in other text it reads as a comma.
    var semi = /[\u0370-\u03ff\u1f00-\u1fff]/.test(s) ? "?" : ",";
    var out = "";
    Array.from(s.normalize("NFC")).forEach(function (c) {
      out += c === ";" ? semi : (ALIASES[c] !== undefined ? ALIASES[c] : c);
    });
    out = out.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    var res = "";
    Array.from(out).forEach(function (c) {
      if (/\s/.test(c)) { if (res && res.charAt(res.length - 1) !== " ") res += " "; return; }
      if (ALLOWED[c]) res += c;
    });
    if (!keepEnd) res = res.replace(/ $/, "");
    return Array.from(res).slice(0, MAX_LEN).join("");
  }
  function length(s) { return Array.from(String(s || "")).length; }

  // The uneven emboss of the letter at position i: the same letter in
  // the same place always looks the same, and typing more letters never
  // changes the ones before. dx/dy as a share of the letter, rot in
  // degrees, sx the width, white how hard the plastic was pressed.
  function emboss(i, ch) {
    var h = hash32(i + ":" + ch);
    return {
      dx:    ((h & 255) / 255 - 0.5) * 0.08,
      dy:    (((h >>> 8) & 255) / 255 - 0.5) * 0.10,
      rot:   (((h >>> 16) & 255) / 255 - 0.5) * 3,
      sx:    0.95 + (((h >>> 24) & 15) / 15) * 0.10,
      white: 0.80 + (((h >>> 28) & 15) / 15) * 0.20
    };
  }

  // ---------- Size (millimetres) ----------
  // Letter height half the tape, narrow letters as on the real thing.
  function geometry(lab) {
    var w = WIDTHS.indexOf(lab && lab.width) >= 0 ? lab.width : DEFAULT.width;
    var margin = MARGINS.indexOf(lab && lab.margin) >= 0 ? lab.margin : DEFAULT.margin;
    var round = lab && lab.cut === "round";
    var capH = w * 0.5, pitch = capH * 0.78;
    var n = length(lab && lab.text);
    var end = pitch * [0.6, 1.6, 3.2][margin];
    if (round) end = Math.max(end, w * 0.5 + pitch * 0.3);       // room for the curve
    var textLen = n * pitch;
    var len = Math.max(textLen + 2 * end, w * 2.5);
    return {
      w: w, len: round3(len), capH: capH, pitch: pitch, round: round,
      x0: round3((len - textLen) / 2), n: n
    };
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  // ---------- Print sheet (A4, real size) ----------
  // Copies laid out in rows, in order; a label longer than the sheet is
  // wide is turned upright. Returns pages of { i, x, y, w, h, rot } in mm,
  // i the index in the list given.
  var A4 = { w: 210, h: 297, pad: 10, gap: 4 };
  function sheetLayout(sizes) {
    var useW = A4.w - 2 * A4.pad, useH = A4.h - 2 * A4.pad;
    var pages = [], page = [], x = 0, y = 0, rowH = 0;
    (sizes || []).forEach(function (s, i) {
      var rot = s.len > useW;
      var w = rot ? s.w : s.len, h = rot ? s.len : s.w;
      w = Math.min(w, useW); h = Math.min(h, useH);
      if (x > 0 && x + w > useW) { x = 0; y += rowH + A4.gap; rowH = 0; }
      if (y > 0 && y + h > useH) { pages.push(page); page = []; x = 0; y = 0; rowH = 0; }
      page.push({ i: i, x: round3(A4.pad + x), y: round3(A4.pad + y), w: w, h: h, rot: rot });
      x += w + A4.gap;
      rowH = Math.max(rowH, h);
    });
    if (page.length) pages.push(page);
    return pages;
  }

  // ---------- Saved labels: normalise + merge ----------
  function normStyle(l) {
    l = l || {};
    return {
      text: cleanText(l.text),
      tape: TAPES.indexOf(l.tape) >= 0 ? l.tape : DEFAULT.tape,
      width: WIDTHS.indexOf(l.width) >= 0 ? l.width : DEFAULT.width,
      cut: CUTS.indexOf(l.cut) >= 0 ? l.cut : DEFAULT.cut,
      margin: MARGINS.indexOf(l.margin) >= 0 ? l.margin : DEFAULT.margin
    };
  }
  function normLabel(l) {
    if (!l || typeof l !== "object" || typeof l.id !== "string" || !ID_RE.test(l.id) ||
        !isInt(l.m) || l.m < 0) return null;
    var s = normStyle(l);
    if (!s.text) return null;
    return { id: l.id, m: l.m, text: s.text, tape: s.tape, width: s.width, cut: s.cut, margin: s.margin };
  }

  // LWW per label (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergeLabels(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.labels, b.labels].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var l = normLabel(raw);
        if (!l) return;
        var cur = best[l.id];
        if (!cur || l.m > cur.m ||
            (l.m === cur.m && JSON.stringify(l) > JSON.stringify(cur))) best[l.id] = l;
      });
    });
    var labels = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      labels.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, labels: labels, tombs: sortedTombs };
  }

  function findLabel(dat, id) {
    for (var i = 0; i < dat.labels.length; i++) if (dat.labels[i].id === id) return dat.labels[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(r) {
    var s = "l";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  function sameStyle(x, y) {
    return x.text === y.text && x.tape === y.tape && x.width === y.width && x.cut === y.cut && x.margin === y.margin;
  }

  // ---------- Recent (device-local) ----------
  // Newest first, no two alike, at most MAX_RECENT. sameEdit: the label
  // is still being typed, so it replaces the newest one when one text
  // grew out of the other (HEL → HELLO is one label, not two).
  function pushRecent(list, item, sameEdit) {
    var s = normStyle(item);
    if (!s.text) return (list || []).slice(0, MAX_RECENT);
    var out = (Array.isArray(list) ? list : []).map(normStyle).filter(function (x) { return x.text; });
    if (sameEdit && out.length) {
      var h = out[0].text;
      if (s.text.indexOf(h) === 0 || h.indexOf(s.text) === 0) out.shift();
    }
    out = out.filter(function (x) { return !sameStyle(x, s); });
    out.unshift(s);
    return out.slice(0, MAX_RECENT);
  }

  // ---------- Wheel ----------
  function wheelIndex(ch) { var i = WHEEL.indexOf(ch); return i < 0 ? 0 : i; }
  function wheelStep(i, d, n) { n = n || WHEEL.length; return ((i + d) % n + n) % n; }

  // File name for the PNG.
  function fileName(text) {
    var base = cleanText(text).replace(/[\\/:*?"<>|.]+/g, "").replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 40);
    return (base || "label") + ".png";
  }

  // ---------- The .oroslabels file ----------
  // One file = a sheet of labels (the ones ticked for printing, or the
  // label on the tape) and how many copies of each:
  //   content.json { kind: "oros-labels-package", ver: 1, copies,
  //                  labels: [{ id, m, text, tape, width, cut, margin }] }
  // The tape is drawn from the text, so there is no media; the app adds
  // preview/thumbnail.png, and preview/labels.csv is built here.
  var LABELS_MIME = "application/x-oros-labels";
  var LABELS_KIND = "oros-labels-package";
  var MAX_COPIES  = 60;

  function csvCell(v) {
    v = String(v === undefined || v === null ? "" : v);
    return /[",\r\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // head: 5 column titles; name(kind, value) → the word shown for a
  // tape / width / cut / margin value (falls back to the raw value).
  function sheetCsv(list, head, name) {
    name = typeof name === "function" ? name : function (k, v) { return v; };
    var rows = [(head || ["text", "tape", "width", "ends", "margin"]).map(csvCell).join(",")];
    list.forEach(function (l) {
      rows.push([l.text, name("tape", l.tape), name("width", l.width), name("cut", l.cut), name("margin", l.margin)]
        .map(csvCell).join(","));
    });
    return "﻿" + rows.join("\r\n") + "\r\n";
  }

  // list: labels (saved ones or plain styles). o: { copies, lang, date,
  // csvHead, name, now, rnd }. → options for OrosBundle.write, or null.
  function labelsBundle(list, o) {
    o = o || {};
    var now = isInt(o.now) ? o.now : Date.now(), rnd = o.rnd || Math.random;
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (out.length >= MAX_LABELS) return;
      var l = normLabel(raw);
      if (!l) {
        var s = normStyle(raw);
        if (!s.text) return;
        l = { id: newId(rnd), m: now, text: s.text, tape: s.tape, width: s.width, cut: s.cut, margin: s.margin };
      }
      out.push(l);
    });
    if (!out.length) return null;
    var copies = isInt(o.copies) && o.copies >= 1 ? Math.min(o.copies, MAX_COPIES) : 1;
    var created = now, modified = 0;
    out.forEach(function (l) { created = Math.min(created, l.m); modified = Math.max(modified, l.m); });
    return {
      mime: LABELS_MIME, app: "labels", schema: "labels/1",
      content: { kind: LABELS_KIND, ver: 1, copies: copies, labels: out },
      meta: { title: out[0].text, created: created, modified: modified || now,
        language: o.lang === "el" ? "el" : "en", generator: "orOS Label Maker" },
      preview: [{ name: "labels.csv", data: sheetCsv(out, o.csvHead, o.name), type: "text/csv" }],
      date: o.date
    };
  }
  // content.json → { labels: NEW labels (fresh ids, m = now, cleaned as
  // typed text is), copies } or null. At most `room` labels are kept.
  function labelsFromBundle(content, rnd, now, room) {
    if (!content || typeof content !== "object" || content.kind !== LABELS_KIND ||
        !Array.isArray(content.labels)) return null;
    rnd = rnd || Math.random;
    now = isInt(now) ? now : Date.now();
    var max = isInt(room) ? Math.max(0, room) : MAX_LABELS, out = [], seen = {};
    content.labels.forEach(function (raw) {
      if (out.length >= max || !raw || typeof raw !== "object") return;
      var s = normStyle(raw);
      if (!s.text) return;
      var id = newId(rnd);
      while (seen[id]) id = newId(rnd);
      seen[id] = 1;
      out.push({ id: id, m: now, text: s.text, tape: s.tape, width: s.width, cut: s.cut, margin: s.margin });
    });
    var c = content.copies;
    return { labels: out, copies: isInt(c) && c >= 1 ? Math.min(c, MAX_COPIES) : 1 };
  }
  // File name for the .oroslabels (after the first label).
  function sheetFileName(text) {
    return fileName(text).replace(/\.png$/, ".oroslabels");
  }

  var api = {
    LABELS_MIME: LABELS_MIME, MAX_COPIES: MAX_COPIES, labelsBundle: labelsBundle,
    labelsFromBundle: labelsFromBundle, sheetCsv: sheetCsv, sheetFileName: sheetFileName,
    MAX_LEN: MAX_LEN, MAX_LABELS: MAX_LABELS, MAX_RECENT: MAX_RECENT, ID_RE: ID_RE,
    TAPES: TAPES, WIDTHS: WIDTHS, CUTS: CUTS, MARGINS: MARGINS, DEFAULT: DEFAULT,
    LATIN: LATIN, GREEK: GREEK, DIGITS: DIGITS, SYMBOLS: SYMBOLS, WHEEL: WHEEL, A4: A4,
    hash32: hash32, cleanText: cleanText, length: length, emboss: emboss, geometry: geometry,
    sheetLayout: sheetLayout, normStyle: normStyle, normLabel: normLabel, mergeLabels: mergeLabels,
    findLabel: findLabel, newestFirst: newestFirst, newId: newId, sameStyle: sameStyle,
    pushRecent: pushRecent, wheelIndex: wheelIndex, wheelStep: wheelStep, fileName: fileName
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LabelsCore = api;
})(typeof window !== "undefined" ? window : this);
