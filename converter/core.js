// ============================================================
// orOS Converter — core.js: the pure parts (no DOM, no storage)
// ------------------------------------------------------------
// Recognising a file (extension + first bytes), output names,
// folder names, sizes, device-local prefs, deep-link targets and
// error codes. converter.js does the DOM, the loading and the I/O.
// UMD: window.ConverterCore, or module.exports in Node (needs
// registry.js next to it: window.OrosConvertRegistry / require).
// ============================================================
(function (root) {
  "use strict";

  var R = (typeof module !== "undefined" && module.exports) ? require("./registry.js") : root.OrosConvertRegistry;

  var PREFS_KEY = "oros-converter-prefs";       // device-local (R10), never synced
  var OUTS = ["zip", "folder", "each"];
  var MAX_FILE = 300 * 1024 * 1024;             // one input file
  var MAX_FILES = 500;                          // rows in the list
  var DISK_DIR = "Converted";                   // /internal/Converted/<date>/
  var ROOT = "/internal";

  // Formats that are ZIP files inside: they start with "PK\3\4".
  var ZIP_KINDS = [".docx", ".xlsx", ".odt", ".ods", ".apkg", ".colpkg"];

  // The converter entry for a file name, or null ("not supported").
  function targetFor(name) { return R.forName(name); }

  // Cheap check of the first bytes (≥ 8). "" = fine, "bad" = the
  // file is not what its extension says, "oros" = already an orOS
  // bundle (a ZIP whose first entry is "mimetype" with an oros type).
  function checkHead(ext, head) {
    ext = String(ext || "").toLowerCase();
    if (!head || typeof head.length !== "number") return "";
    var zip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (ZIP_KINDS.indexOf(ext) !== -1) {
      if (!zip) return "bad";
      if (head.length >= 38 && ascii(head, 30, 8) === "mimetype" && ascii(head, 38, 25).indexOf("application/x-oros-") === 0) return "oros";
      return "";
    }
    if (ext === ".xls") {
      // Real .xls is an OLE2 file; HTML or CSV saved as .xls and an
      // .xlsx renamed to .xls are read by the spreadsheet too.
      return "";
    }
    if (ext === ".rtf") {
      if (head.length < 5) return "bad";
      var start = ascii(head, 0, 8).replace(/^﻿|^\xEF\xBB\xBF/, "");
      return /^\{\\rtf/.test(start) ? "" : "bad";
    }
    return "";
  }
  function ascii(b, o, n) {
    var s = "";
    for (var i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  // A safe file name: no path separators or characters other systems
  // refuse, no control characters, not empty, not too long.
  function cleanName(name) {
    var s = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\/\\:*?"<>|]/g, "_");
    s = s.replace(/^[\s.]+|[\s.]+$/g, "");
    if (s.length > 120) {
      var m = /(\.[a-z0-9]{1,12})$/i.exec(s);
      s = m ? s.slice(0, 120 - m[1].length).replace(/[\s.]+$/, "") + m[1] : s.slice(0, 120);
    }
    return s;
  }

  // The result's file name: the converter's own name when it gives one,
  // else the source name with the target extension; always ends in `to`.
  function outName(resultName, sourceName, to) {
    to = String(to || "").toLowerCase();
    var n = cleanName(resultName);
    if (!n || n.toLowerCase().slice(-to.length) !== to) {
      var base = cleanName(String(sourceName || "").replace(/\.[a-z0-9]+$/i, ""));
      n = (base || "Untitled") + to;
    }
    if (n.length === to.length) n = "Untitled" + to;
    return n;
  }

  // "Report.orosdoc" → "Report (2).orosdoc" … while the name is taken.
  // taken: an object used as a set (keys lower-cased); the chosen name
  // is added to it.
  function uniqueName(name, taken) {
    var m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name), base = m[1], ext = m[2] || "";
    var n = name, i = 2;
    while (Object.prototype.hasOwnProperty.call(taken, n.toLowerCase())) {
      n = base + " (" + i + ")" + ext;
      i++;
    }
    taken[n.toLowerCase()] = true;
    return n;
  }

  // The sub-folder of a file picked with its folder (webkitRelativePath
  // "Docs/2024/a.docx" → "Docs/2024"), every part cleaned, "" for none.
  function relDir(relPath) {
    var parts = String(relPath || "").replace(/\\/g, "/").split("/");
    parts.pop();
    var out = [];
    parts.forEach(function (p) {
      var c = cleanName(p);
      if (c && c !== "." && c !== "..") out.push(c);
    });
    return out.slice(0, 16).join("/");
  }

  // Files a folder carries that nobody means to convert: Office lock
  // files (~$Report.docx), hidden files (.DS_Store), macOS forks.
  function skipInFolder(name) {
    var n = String(name || "");
    return /^~\$/.test(n) || n.charAt(0) === "." || /^__MACOSX$/.test(n);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Local date "2026-10-15": the folder name in Files and in the .zip name.
  function dateStamp(d) {
    d = d instanceof Date && !isNaN(d) ? d : new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  // "/internal/Converted/2026-10-15"
  function diskDir(d) { return ROOT + "/" + DISK_DIR + "/" + dateStamp(d); }
  // The ZIP's name, in the app's language. Pack "converter".
  var NAMES = {
    en: { "zip.name": "orOS converted {date}" },
    el: { "zip.name": "orOS μετατροπές {date}" }
  };
  var W = typeof window !== "undefined" ? window : null;
  function names(lang) {
    if (lang && !NAMES[lang] && W && W.orosI18n) { try { W.orosI18n.table(NAMES, "converter", lang); } catch (e) {} }
    return NAMES[lang] || NAMES.en;
  }
  // German, like Greek, writes 1,5 (decimal comma).
  function commaDecimal(lang) {
    if (lang === "el") return true;
    if (!lang || lang === "en" || !W || !W.orosI18n) return false;
    try { return new Intl.NumberFormat(W.orosI18n.locale(lang)).format(1.5).indexOf(",") !== -1; } catch (e) { return false; }
  }
  function zipName(d, lang) {
    return names(lang)["zip.name"].split("{date}").join(dateStamp(d)) + ".zip";
  }

  function fmtSize(bytes, lang) {
    var n = Math.max(0, Number(bytes) || 0), u = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    var s = i === 0 ? String(Math.round(n)) : (n >= 100 ? String(Math.round(n)) : n.toFixed(1));
    if (commaDecimal(lang)) s = s.replace(".", ",");
    return s + " " + u[i];
  }

  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return { out: OUTS.indexOf(p.out) !== -1 ? p.out : "zip" };
  }

  // Error → one of the contract's codes, or "failed".
  function errorCode(err) {
    var c = err && typeof err === "object" ? err.code : "";
    return c === "unsupported" || c === "bad" || c === "toobig" ? c : "failed";
  }

  // A disk path the Converter may read: under /internal, no "." or
  // ".." parts, not in the Trash.
  function okPath(p) {
    if (typeof p !== "string" || p.length > 1024 || p.indexOf(ROOT + "/") !== 0) return false;
    var parts = p.slice(ROOT.length + 1).split("/");
    for (var i = 0; i < parts.length; i++) if (!parts[i] || parts[i] === "." || parts[i] === "..") return false;
    return parts[0] !== ".trash";
  }

  // Deep-link target → { paths: [...], token: "" } (files are handled
  // by the caller: a File cannot travel in JSON).
  function parseTarget(t) {
    var out = { paths: [], token: "" };
    if (!t || typeof t !== "object") return out;
    if (Array.isArray(t.paths)) {
      t.paths.forEach(function (p) {
        if (okPath(p) && out.paths.indexOf(p) === -1 && out.paths.length < MAX_FILES) out.paths.push(p);
      });
    }
    if (t.openFile && typeof t.openFile === "object" && typeof t.openFile.token === "string") out.token = t.openFile.token.slice(0, 64);
    return out;
  }

  // A key that spots the same file added twice.
  function fileKey(name, size, mtime, dir) {
    return [String(dir || ""), String(name || ""), Number(size) || 0, Number(mtime) || 0].join("\u0001");
  }

  // Counts for the footer. rows: [{ target, status }]
  function summary(rows) {
    var s = { total: rows.length, can: 0, waiting: 0, done: 0, error: 0, busy: 0, unsupported: 0 };
    rows.forEach(function (r) {
      if (!r.target) { s.unsupported++; return; }
      s.can++;
      if (r.status === "waiting") s.waiting++;
      else if (r.status === "done") s.done++;
      else if (r.status === "error") s.error++;
      else if (r.status === "converting" || r.status === "saving") s.busy++;
    });
    return s;
  }

  var api = {
    PREFS_KEY: PREFS_KEY, OUTS: OUTS, MAX_FILE: MAX_FILE, MAX_FILES: MAX_FILES, ROOT: ROOT, ZIP_KINDS: ZIP_KINDS,
    registry: R, targetFor: targetFor, checkHead: checkHead, cleanName: cleanName, outName: outName,
    uniqueName: uniqueName, relDir: relDir, skipInFolder: skipInFolder, dateStamp: dateStamp,
    diskDir: diskDir, zipName: zipName, fmtSize: fmtSize, readPrefs: readPrefs, errorCode: errorCode,
    okPath: okPath, parseTarget: parseTarget, fileKey: fileKey, summary: summary
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConverterCore = api;
})(typeof window !== "undefined" ? window : this);
