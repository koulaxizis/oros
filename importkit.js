// ============================================================
// orOS — importkit.js: shared helpers for "Import from another app"
// ------------------------------------------------------------
// Every app that reads an export file from a well-known app (Loop,
// Daylio, Day One, Clue, Splitwise, Fuelio…) uses the same small
// pieces, so each importer only maps fields:
//   csv(text, opts)        → { head: [..], rows: [[..]], delim }
//                            RFC 4180 quotes, BOM, CRLF, delimiter
//                            sniffed from , ; tab | (or opts.delim)
//   records(text, opts)    → { head, rows: [{ header: value }] }
//                            (header names trimmed; duplicate headers
//                            get " 2", " 3")
//   col(head, names)       → index of the first header matching one of
//                            names (case/space/punctuation-insensitive)
//   detect(head, sigs)     → id of the first signature whose required
//                            headers are all present: sigs = [{ id,
//                            need: [names…] }]
//   ymd(v, hint)           → "YYYY-MM-DD" or "" from ISO, D/M/Y, M/D/Y
//                            (hint "dmy" | "mdy" | auto), "Mon D, YYYY",
//                            epoch s/ms; parseDate(v, hint) → ms | NaN
//                            (local time, keeps the time of day)
//   num(v)                 → number or NaN ("1.234,5" and "1,234.5")
//   json(text)             → parsed value or null (never throws)
//   hash(str)              → short stable id part (FNV-1a, base 36)
//   readFile(file, max)    → Promise<{ name, bytes }> (size-capped)
//   text(bytes)            → UTF-8 (BOM dropped), UTF-16 when it has a
//                            UTF-16 BOM
//   isZip(bytes)           → starts with PK\3\4
//   unzip(bytes)           → AtelierZip reader (atelier/zip.js must be
//                            loaded first in the browser)
//   clean(v, n)            → one-line trimmed string ≤ n characters
//                            (control characters dropped)
//   cleanText(v, n)        → multi-line version (keeps \n)
// Nothing here touches the DOM or storage; nothing from a file is
// ever run or inserted as HTML (callers render with textContent).
// UMD: window.OrosImportKit in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var MAX_FILE = 60 * 1024 * 1024;
  var MAX_ROWS = 200000;

  function p2(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- strings ----------
  function clean(v, n) {
    var s = v == null ? "" : String(v);
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    return n ? s.slice(0, n) : s;
  }
  function cleanText(v, n) {
    var s = v == null ? "" : String(v);
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
    return n ? s.slice(0, n) : s;
  }
  function norm(h) { return String(h == null ? "" : h).toLowerCase().replace(/^\ufeff/, "").replace(/[^a-z0-9Ͱ-Ͽ]+/g, ""); }

  // ---------- CSV ----------
  function sniff(text) {
    var line = "", inQ = false;
    for (var i = 0; i < text.length && i < 20000; i++) {
      var ch = text[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && (ch === "\n" || ch === "\r")) { if (line) break; continue; }
      line += ch;
    }
    var best = ",", bestN = 0;
    [",", ";", "\t", "|"].forEach(function (d) {
      var n = 0, q = false;
      for (var j = 0; j < line.length; j++) {
        if (line[j] === '"') q = !q;
        else if (!q && line[j] === d) n++;
      }
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }
  function csv(text, opts) {
    opts = opts || {};
    text = String(text == null ? "" : text).replace(/^\ufeff/, "");
    var d = opts.delim || sniff(text);
    var rows = [], row = [], f = "", inQ = false, i = 0, n = text.length;
    var max = opts.maxRows || MAX_ROWS;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { f += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        f += ch; i++; continue;
      }
      if (ch === '"' && f === "") { inQ = true; i++; continue; }
      if (ch === d) { row.push(f); f = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(f); f = "";
        if (!(row.length === 1 && row[0] === "")) rows.push(row);
        row = [];
        if (rows.length > max) break;
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++; continue;
      }
      f += ch; i++;
    }
    if (f !== "" || row.length) { row.push(f); if (!(row.length === 1 && row[0] === "")) rows.push(row); }
    var head = (rows.shift() || []).map(function (h) { return clean(h, 200); });
    return { head: head, rows: rows.slice(0, max), delim: d };
  }
  function records(text, opts) {
    var t = csv(text, opts), seen = {};
    var keys = t.head.map(function (h) {
      var k = h || "col", c = seen[k] = (seen[k] || 0) + 1;
      return c > 1 ? k + " " + c : k;
    });
    return {
      head: keys,
      rows: t.rows.map(function (r) {
        var o = {};
        keys.forEach(function (k, i) { o[k] = r[i] == null ? "" : r[i]; });
        return o;
      })
    };
  }
  function col(head, names) {
    var nh = (head || []).map(norm);
    for (var j = 0; j < names.length; j++) {
      var k = nh.indexOf(norm(names[j]));
      if (k !== -1) return k;
    }
    return -1;
  }
  // value of the first matching header in a record object
  function get(rec, names) {
    if (!rec) return "";
    var keys = Object.keys(rec), nk = keys.map(norm);
    for (var j = 0; j < names.length; j++) {
      var k = nk.indexOf(norm(names[j]));
      if (k !== -1) return rec[keys[k]];
    }
    return "";
  }
  function detect(head, sigs) {
    for (var i = 0; i < sigs.length; i++) {
      var s = sigs[i];
      if (s.need.every(function (h) { return col(head, Array.isArray(h) ? h : [h]) !== -1; })) return s.id;
    }
    return "";
  }

  // ---------- dates ----------
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  function valid(y, m, d) {
    if (!(y >= 1800 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    var t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1;
  }
  function parts(v, hint) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && isFinite(v)) {
      var ms = v > 1e11 ? v : v * 1000;
      var dt = new Date(ms);
      return isNaN(dt.getTime()) ? null : { ms: ms };
    }
    var s = clean(v, 80), m;
    if (/^\d{9,13}$/.test(s)) return parts(+s, hint);
    // ISO date / date-time (offset or Z → exact instant)
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
    if (m) {
      if (!valid(+m[1], +m[2], +m[3])) return null;
      if (m[7]) {
        var ins = Date.parse(m[1] + "-" + p2(+m[2]) + "-" + p2(+m[3]) + "T" + p2(+m[4]) + ":" + m[5] + ":" + (m[6] || "00") +
          (m[7].toUpperCase() === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")));
        return isNaN(ins) ? null : { ms: ins };
      }
      return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    }
    // 2024/03/05
    m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(s);
    if (m) return valid(+m[1], +m[2], +m[3]) ? withTime({ y: +m[1], mo: +m[2], d: +m[3] }, m[4], m[5], m[6], m[7]) : null;
    // 05/03/2024, 5.3.24, 05-03-2024 (+ time)
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      var dmy = hint === "mdy" ? false : hint === "dmy" ? true : !(b > 12 && a <= 12);
      if (hint !== "mdy" && hint !== "dmy" && a > 12) dmy = true;
      var dd = dmy ? a : b, mo = dmy ? b : a;
      return valid(y, mo, dd) ? withTime({ y: y, mo: mo, d: dd }, m[4], m[5], m[6], m[7]) : null;
    }
    // "March 5, 2024", "5 Mar 2024", "Mar 5 2024 10:00 PM", optional weekday
    var t = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, "");
    m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:(?:\s+at)?[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(t);
    if (m && MONTHS[m[1].toLowerCase()]) {
      return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) ? withTime({ y: +m[3], mo: MONTHS[m[1].toLowerCase()], d: +m[2] }, m[4], m[5], m[6], m[7]) : null;
    }
    m = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(t);
    if (m && MONTHS[m[2].toLowerCase()]) {
      return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) ? withTime({ y: +m[3], mo: MONTHS[m[2].toLowerCase()], d: +m[1] }, m[4], m[5], m[6], m[7]) : null;
    }
    return null;
  }
  function withTime(o, h, mi, s, ap) {
    var hh = +(h || 0);
    if (ap) { ap = ap.toLowerCase(); if (ap === "pm" && hh < 12) hh += 12; if (ap === "am" && hh === 12) hh = 0; }
    o.h = hh; o.mi = +(mi || 0); o.s = +(s || 0);
    return o;
  }
  function parseDate(v, hint) {
    var p = parts(v, hint);
    if (!p) return NaN;
    if (p.ms != null) return p.ms;
    return new Date(p.y, p.mo - 1, p.d, p.h || 0, p.mi || 0, p.s || 0).getTime();
  }
  function ymd(v, hint) {
    var p = parts(v, hint);
    if (!p) return "";
    if (p.ms != null) {
      var d = new Date(p.ms);
      return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
    }
    return p.y + "-" + p2(p.mo) + "-" + p2(p.d);
  }

  // ---------- numbers ----------
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    var s = clean(v, 60).replace(/[\s\u00a0'\u2019]/g, "").replace(/[^\d.,+\-eE]/g, "");
    if (!s) return NaN;
    var c = s.lastIndexOf(","), d = s.lastIndexOf(".");
    if (c !== -1 && d !== -1) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (c !== -1) s = /,\d{3}$/.test(s) && s.indexOf(",") !== c ? s.replace(/,/g, "") : s.replace(",", ".");
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // ---------- misc ----------
  function json(text) {
    try { return JSON.parse(String(text == null ? "" : text).replace(/^\ufeff/, "")); } catch (e) { return null; }
  }
  function hash(str) {
    var h = 0x811c9dc5, s = String(str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function text(bytes) {
    if (typeof bytes === "string") return bytes.replace(/^\ufeff/, "");
    if (!bytes) return "";
    var enc = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) enc = "utf-16be";
    return new TextDecoder(enc).decode(bytes).replace(/^\ufeff/, "");
  }
  function isZip(bytes) { return !!bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4; }
  function unzip(bytes) {
    var Z = (typeof module !== "undefined" && module.exports && typeof require === "function")
      ? require("./atelier/zip.js") : root.AtelierZip;
    if (!Z) throw new Error("zip");
    return Z.open(bytes);
  }
  function readFile(file, max) {
    max = max || MAX_FILE;
    if (!file) return Promise.reject(new Error("nofile"));
    if (file.size > max) return Promise.reject(new Error("toobig"));
    return file.arrayBuffer().then(function (buf) { return { name: String(file.name || ""), bytes: new Uint8Array(buf) }; });
  }

  var API = {
    MAX_FILE: MAX_FILE, csv: csv, records: records, col: col, get: get, detect: detect,
    parseDate: parseDate, ymd: ymd, num: num, json: json, hash: hash,
    text: text, isZip: isZip, unzip: unzip, readFile: readFile, clean: clean, cleanText: cleanText, norm: norm
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosImportKit = API;
})(typeof self !== "undefined" ? self : this);
