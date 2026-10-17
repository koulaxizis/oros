// ============================================================
// orOS Scanner & PDF — core.js: the pure parts (no DOM, no storage)
// ------------------------------------------------------------
// Recognising files (name + first bytes), the page list and its
// edits (move, rotate, delete, duplicate, undo), page ranges for
// split, picture page sizes, output names and device-local prefs.
// scanpdf.js does the DOM and the I/O, pdfops.js the PDF writing.
// UMD: window.ScanPdfCore, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var PREFS_KEY = "oros-scanpdf-prefs";      // device-local (R10), never synced
  var MAX_FILE = 200 * 1024 * 1024;          // one input file
  var MAX_PAGES = 2000;                      // pages in the list
  var MAX_HISTORY = 60;                      // undo steps
  var ROOT = "/internal";
  var DISK_DIR = "PDF";                      // Files › PDF

  var IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];
  var PDF_EXT = [".pdf"];

  // ---------- Files ----------
  function extOf(name) {
    var m = /(\.[a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  // "pdf", "image" or null, from the name and the MIME type.
  function kindOf(name, type) {
    var ext = extOf(name), ty = String(type || "").toLowerCase();
    if (PDF_EXT.indexOf(ext) !== -1 || ty === "application/pdf") return "pdf";
    if (IMAGE_EXT.indexOf(ext) !== -1 || /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(ty)) return "image";
    return null;
  }

  // What the first bytes really are: "pdf", "jpeg", "png", "other".
  function sniff(b) {
    if (!b || b.length < 4) return "other";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    // "%PDF-" may follow a little junk (the spec allows 1024 bytes)
    var n = Math.min(b.length - 4, 1024);
    for (var i = 0; i < n; i++) {
      if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return "pdf";
    }
    return "other";
  }

  // EXIF orientation of a JPEG (1..8), 1 when there is none. Phones
  // store photos sideways and say so here; a PDF ignores it, so such
  // a photo is redrawn upright before it goes into a PDF.
  function exifOrientation(b) {
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
    var i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return 1;
      var marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xda || marker === 0xd9) return 1;        // image data: no EXIF before it
      if (marker === 0xe1 && i + 10 <= b.length &&
          b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        return tiffOrientation(b, i + 10, Math.min(b.length, i + 2 + len));
      }
      if (len < 2) return 1;
      i += 2 + len;
    }
    return 1;
  }
  function tiffOrientation(b, t, end) {
    if (t + 8 > end) return 1;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 1;
    function u16(o) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
    function u32(o) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
                                : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
    var ifd = t + u32(t + 4);
    if (ifd + 2 > end) return 1;
    var n = u16(ifd);
    for (var k = 0; k < n; k++) {
      var e = ifd + 2 + k * 12;
      if (e + 12 > end) return 1;
      if (u16(e) === 0x0112) {
        var v = u16(e + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
    return 1;
  }

  // A safe file name: no path separators or characters other systems
  // refuse, no control characters, not empty, not too long.
  function cleanName(name) {
    var s = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/:*?"<>|]/g, "-").trim();
    s = s.replace(/^\.+/, "").slice(0, 120).trim();
    return s;
  }
  function baseName(name) {
    var s = String(name || ""), i = s.lastIndexOf(".");
    return cleanName(i > 0 ? s.slice(0, i) : s);
  }
  // The output name: "<base>.pdf", "<base> (3-5).pdf" for a part.
  function outName(base, label) {
    var b = cleanName(base) || "Document";
    return b + (label ? " (" + label + ")" : "") + ".pdf";
  }
  function withPdf(name) {
    var b = cleanName(String(name || "").replace(/\.pdf$/i, ""));
    return (b || "Document") + ".pdf";
  }
  // "Name.pdf", then "Name (2).pdf"… within one batch.
  function uniqueName(name, taken) {
    var m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name), b = m[1], ext = m[2] || "";
    for (var n = 1; n < 10000; n++) {
      var nm = b + (n > 1 ? " (" + n + ")" : "") + ext;
      if (!taken[nm.toLowerCase()]) { taken[nm.toLowerCase()] = true; return nm; }
    }
    return name;
  }
  function diskDir() { return ROOT + "/" + DISK_DIR; }
  function zipName(base) { return (cleanName(base) || "Document") + ".zip"; }

  function sizeLabel(n, lang) {
    n = Number(n) || 0;
    var u = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    var s = (i === 0 ? String(Math.round(n)) : n.toFixed(n < 10 ? 1 : 0));
    if (lang === "el") s = s.replace(".", ",");
    return s + " " + u[i];
  }

  // ---------- Prefs ----------
  var SIZES = ["a4", "letter", "fit"];
  var ORIENTS = ["auto", "portrait", "landscape"];
  var MARGINS = ["none", "small", "normal"];
  var DESTS = ["device", "files"];
  function pick(v, list, def) { return list.indexOf(v) !== -1 ? v : def; }
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      size: pick(p.size, SIZES, "a4"),
      orient: pick(p.orient, ORIENTS, "auto"),
      margin: pick(p.margin, MARGINS, "small"),
      dest: pick(p.dest, DESTS, "device")
    };
  }

  // ---------- Picture pages ----------
  var PT = { a4: [595.28, 841.89], letter: [612, 792] };
  var MARGIN_PT = { none: 0, small: 18, normal: 36 };
  var FIT_LONG = 841.89;                     // "picture's shape": long side as A4's

  // Page size in points for a picture of w × h pixels (already upright).
  function pageFor(w, h, prefs) {
    var p = readPrefs(prefs);
    w = Math.max(1, Number(w) || 1); h = Math.max(1, Number(h) || 1);
    var land = w > h;
    if (p.size === "fit") {
      var m = MARGIN_PT[p.margin] * 2, s = (FIT_LONG - m) / Math.max(w, h);
      return [round2(w * s + m), round2(h * s + m)];
    }
    var base = PT[p.size];
    var wantLand = p.orient === "landscape" || (p.orient === "auto" && land);
    return wantLand ? [base[1], base[0]] : [base[0], base[1]];
  }
  // Where the picture goes on that page: centred, as big as fits.
  function fitRect(w, h, pw, ph, margin) {
    var m = MARGIN_PT[margin] !== undefined ? MARGIN_PT[margin] : 0;
    var aw = Math.max(1, pw - 2 * m), ah = Math.max(1, ph - 2 * m);
    var s = Math.min(aw / w, ah / h);
    var dw = w * s, dh = h * s;
    return { x: round2((pw - dw) / 2), y: round2((ph - dh) / 2), w: round2(dw), h: round2(dh) };
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // ---------- Page list ----------
  // page: { key, src (source id), idx (page index in the source, 0-based),
  //         rot (0|90|180|270, added to the page's own rotation) }
  function normRot(r) { r = Math.round((Number(r) || 0) / 90) * 90 % 360; return r < 0 ? r + 360 : r; }
  function clonePages(pages) {
    return pages.map(function (p) { return { key: p.key, src: p.src, idx: p.idx, rot: p.rot }; });
  }
  function keySet(keys) { var s = {}; (keys || []).forEach(function (k) { s[k] = true; }); return s; }

  // Move the chosen pages one step earlier (-1) or later (+1), as a
  // block that keeps its own order; pages at the edge stay put.
  function moveStep(pages, keys, delta) {
    var s = keySet(keys), out = clonePages(pages), i;
    if (delta < 0) {
      for (i = 1; i < out.length; i++) {
        if (s[out[i].key] && !s[out[i - 1].key]) { var a = out[i - 1]; out[i - 1] = out[i]; out[i] = a; }
      }
    } else {
      for (i = out.length - 2; i >= 0; i--) {
        if (s[out[i].key] && !s[out[i + 1].key]) { var b = out[i + 1]; out[i + 1] = out[i]; out[i] = b; }
      }
    }
    return out;
  }
  // Take the chosen pages out and put them, in order, before the page
  // at index `at` of the ORIGINAL list (at = length: at the end). The
  // drop target of a drag, or "move to start / end".
  function moveTo(pages, keys, at) {
    var s = keySet(keys), moving = [], rest = [], before = 0;
    pages.forEach(function (p, i) {
      if (s[p.key]) moving.push(p);
      else { rest.push(p); if (i < at) before++; }
    });
    if (!moving.length) return clonePages(pages);
    var out = rest.slice(0, before).concat(moving, rest.slice(before));
    return clonePages(out);
  }
  function rotate(pages, keys, deg) {
    var s = keySet(keys);
    return clonePages(pages).map(function (p) { if (s[p.key]) p.rot = normRot(p.rot + deg); return p; });
  }
  function remove(pages, keys) {
    var s = keySet(keys);
    return clonePages(pages.filter(function (p) { return !s[p.key]; }));
  }
  // Each chosen page gets a copy right after it. mkKey() gives new keys.
  function duplicate(pages, keys, mkKey) {
    var s = keySet(keys), out = [];
    clonePages(pages).forEach(function (p) {
      out.push(p);
      if (s[p.key]) out.push({ key: mkKey(), src: p.src, idx: p.idx, rot: p.rot });
    });
    return out;
  }
  // Pages of a whole source, appended.
  function pagesOf(srcId, count, mkKey) {
    var out = [];
    for (var i = 0; i < count; i++) out.push({ key: mkKey(), src: srcId, idx: i, rot: 0 });
    return out;
  }
  // Ids of the sources still used by the list.
  function usedSources(pages) {
    var u = {};
    pages.forEach(function (p) { u[p.src] = true; });
    return u;
  }

  // Undo history of page lists: { past: [], future: [] }.
  function history() { return { past: [], future: [] }; }
  function record(h, pages) {
    h.past.push(clonePages(pages));
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
  }
  function undo(h, current) {
    if (!h.past.length) return null;
    h.future.push(clonePages(current));
    return h.past.pop();
  }
  function redo(h, current) {
    if (!h.future.length) return null;
    h.past.push(clonePages(current));
    return h.future.pop();
  }

  // ---------- Ranges and split ----------
  // "1-3, 5, 8-" (1-based, en dash and ";" allowed, "-3" = 1-3,
  // "8-" = 8 to the end) → { ok, ranges: [[from, to]] 1-based
  // inclusive } or { ok: false, err: "empty"|"syntax"|"range", at }.
  function parseRanges(text, count) {
    var s = String(text || "").replace(/[–—−]/g, "-").replace(/\s+/g, "");
    if (!s) return { ok: false, err: "empty" };
    var parts = s.split(/[,;]+/).filter(Boolean), ranges = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d*)-(\d*)$/.exec(parts[i]), a, b;
      if (m) {
        if (!m[1] && !m[2]) return { ok: false, err: "syntax", at: parts[i] };
        a = m[1] ? +m[1] : 1;
        b = m[2] ? +m[2] : count;
      } else if (/^\d+$/.test(parts[i])) {
        a = b = +parts[i];
      } else return { ok: false, err: "syntax", at: parts[i] };
      if (a < 1 || b < 1 || a > count || b > count || a > b) return { ok: false, err: "range", at: parts[i] };
      ranges.push([a, b]);
    }
    return { ok: true, ranges: ranges };
  }
  // The parts of a split: mode "each" | "every" (n pages) | "ranges".
  function splitPlan(mode, count, opt) {
    var out = [], i;
    if (count < 1) return { ok: false, err: "empty" };
    if (mode === "each") {
      for (i = 1; i <= count; i++) out.push([i, i]);
      return { ok: true, ranges: out };
    }
    if (mode === "every") {
      var n = Math.floor(Number(opt));
      if (!(n >= 1)) return { ok: false, err: "number" };
      for (i = 1; i <= count; i += n) out.push([i, Math.min(count, i + n - 1)]);
      return { ok: true, ranges: out };
    }
    return parseRanges(opt, count);
  }
  function rangeLabel(r) { return r[0] === r[1] ? String(r[0]) : r[0] + "-" + r[1]; }

  // ---------- Deep link ----------
  // { openFile: { token } } from the shell, { paths: [disk paths] } from Files.
  function parseTarget(t) {
    var out = { token: "", paths: [] };
    if (!t || typeof t !== "object") return out;
    if (t.openFile && typeof t.openFile.token === "string") out.token = t.openFile.token.slice(0, 200);
    var paths = Array.isArray(t.paths) ? t.paths : (typeof t.path === "string" ? [t.path] : []);
    out.paths = paths.filter(function (p) {
      return typeof p === "string" && p.indexOf(ROOT + "/") === 0 && p.indexOf("..") === -1 && p.length < 1000 &&
             kindOf(p, "") !== null;
    }).slice(0, 200);
    return out;
  }

  var api = {
    VERSION: VERSION, PREFS_KEY: PREFS_KEY, MAX_FILE: MAX_FILE, MAX_PAGES: MAX_PAGES, ROOT: ROOT,
    IMAGE_EXT: IMAGE_EXT, PDF_EXT: PDF_EXT, MARGIN_PT: MARGIN_PT,
    extOf: extOf, kindOf: kindOf, sniff: sniff, exifOrientation: exifOrientation,
    cleanName: cleanName, baseName: baseName, outName: outName, withPdf: withPdf, uniqueName: uniqueName,
    diskDir: diskDir, zipName: zipName, sizeLabel: sizeLabel,
    readPrefs: readPrefs, pageFor: pageFor, fitRect: fitRect,
    normRot: normRot, clonePages: clonePages, moveStep: moveStep, moveTo: moveTo, rotate: rotate,
    remove: remove, duplicate: duplicate, pagesOf: pagesOf, usedSources: usedSources,
    history: history, record: record, undo: undo, redo: redo,
    parseRanges: parseRanges, splitPlan: splitPlan, rangeLabel: rangeLabel, parseTarget: parseTarget
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfCore = api;
})(typeof window !== "undefined" ? window : this);
