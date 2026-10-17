// ============================================================
// orOS Scanner & PDF — core.js: the pure parts (no DOM, no storage)
// ------------------------------------------------------------
// Recognising files (name + first bytes), the page list and its
// edits (move, rotate, delete, duplicate, undo), page ranges for
// split, picture page sizes, output names and device-local prefs.
// Wave 2: overlays (signatures, text) and where they sit on a turned
// page, page numbers, watermark, compress levels, the signature
// library and turning a photo of a signature into ink.
// scanpdf.js does the DOM and the I/O, pdfops.js the PDF writing.
// UMD: window.ScanPdfCore, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.1.0";
  var PREFS_KEY = "oros-scanpdf-prefs";      // device-local (R10), never synced
  var SIGS_KEY = "oros-scanpdf-sigs";        // device-local (R10), never synced
  var MAX_SIGS = 6;
  var MAX_SIG_URL = 280000;                  // ~200 KB of PNG as a data: URL
  var MAX_OV = 40;                           // additions on one page
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
  var CMPS = ["off", "light", "medium", "strong"];
  function pick(v, list, def) { return list.indexOf(v) !== -1 ? v : def; }
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      size: pick(p.size, SIZES, "a4"),
      orient: pick(p.orient, ORIENTS, "auto"),
      margin: pick(p.margin, MARGINS, "small"),
      dest: pick(p.dest, DESTS, "device"),
      cmp: pick(p.cmp, CMPS, "off")
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
  // p.ov: the additions on the page (see Overlays), copied one level
  // deep so an edit never changes an older list kept for Undo.
  function clonePages(pages) {
    return pages.map(function (p) {
      var c = { key: p.key, src: p.src, idx: p.idx, rot: p.rot };
      if (p.ov && p.ov.length) c.ov = cloneOv(p.ov);
      return c;
    });
  }
  function cloneOv(ov) { return (ov || []).map(function (o) { return Object.assign({}, o); }); }
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
      if (s[p.key]) {
        var c = { key: mkKey(), src: p.src, idx: p.idx, rot: p.rot };
        if (p.ov && p.ov.length) c.ov = cloneOv(p.ov);
        out.push(c);
      }
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

  // ---------- Overlays ----------
  // An addition on a page: { id, t: "img"|"text", cx, cy, A, ... }.
  //   cx, cy: its centre as fractions of the UNTURNED page (W × H
  //           points, top-left origin), so turning the page later
  //           turns the addition with it.
  //   A:      how the page was turned (0|90|180|270, clockwise) when
  //           it was put on, so it stood upright then.
  //   img:    w, h as fractions of S = min(W, H); src a PNG data: URL.
  //   text:   fs (font size / S), text, color ("black"|"blue"|"red").
  // The display of a page turned by R (clockwise) is W' × H' with
  // W' = H when R is 90 or 270.
  var COLORS = { black: [0.07, 0.07, 0.09], blue: [0.1, 0.23, 0.6], red: [0.75, 0.1, 0.12] };
  function dispSize(W, H, R) { return R % 180 ? [H, W] : [W, H]; }
  // Unturned point (px, py) → where it shows on the turned page.
  function toDisp(px, py, W, H, R) {
    R = normRot(R);
    if (R === 90) return [H - py, px];
    if (R === 180) return [W - px, H - py];
    if (R === 270) return [py, W - px];
    return [px, py];
  }
  // And back: a point on the turned page → the unturned page.
  function fromDisp(dx, dy, W, H, R) {
    R = normRot(R);
    if (R === 90) return [dy, H - dx];
    if (R === 180) return [W - dx, H - dy];
    if (R === 270) return [W - dy, dx];
    return [dx, dy];
  }
  function clamp01(n) { n = Number(n); return n > 1 ? 1 : n > 0 ? n : 0; }
  // Display fractions (fx, fy of W' × H') → { cx, cy } of the unturned page.
  function ovAt(fx, fy, W, H, R) {
    var d = dispSize(W, H, R), u = fromDisp(clamp01(fx) * d[0], clamp01(fy) * d[1], W, H, R);
    return { cx: round4(u[0] / W), cy: round4(u[1] / H) };
  }
  // Where an addition shows: { fx, fy } of the turned page and how
  // much it is turned there (clockwise degrees).
  function ovDisp(o, W, H, R) {
    var d = dispSize(W, H, R), v = toDisp(o.cx * W, o.cy * H, W, H, R);
    return { fx: v[0] / d[0], fy: v[1] / d[1], turn: normRot(R - (o.A || 0)) };
  }
  function round4(n) { return Math.round(n * 10000) / 10000; }

  // The point pdf-lib draws from (bottom-left of a picture, start of
  // the baseline of a line of text) for a box of ow × oh points whose
  // centre is (X, Y) in PDF space (y up), turned A degrees
  // counter-clockwise; (ox, oy) is that point's offset from the centre
  // before turning.
  function anchor(X, Y, ox, oy, A) {
    var a = A * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: round2(X + ox * c - oy * s), y: round2(Y + ox * s + oy * c) };
  }
  // Baseline below the centre of a line box of 1.2 × size (Noto Sans:
  // ascender 1.069, descender 0.293), as the editor shows it.
  var BASELINE = 0.388;

  // A clean overlay, or null: only known fields, numbers in range.
  function cleanOv(o) {
    if (!o || typeof o !== "object") return null;
    var c = { id: String(o.id || "").slice(0, 40) || "o", t: o.t === "img" ? "img" : "text",
              cx: clamp01(o.cx), cy: clamp01(o.cy), A: normRot(o.A) };
    if (c.t === "img") {
      if (typeof o.src !== "string" || o.src.indexOf("data:image/png;base64,") !== 0 || o.src.length > MAX_SIG_URL) return null;
      c.src = o.src;
      c.w = Math.min(2, Math.max(0.01, Number(o.w) || 0.3));
      c.h = Math.min(2, Math.max(0.005, Number(o.h) || 0.1));
    } else {
      c.text = String(o.text == null ? "" : o.text).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
      if (!c.text.trim()) return null;
      c.fs = Math.min(0.5, Math.max(0.005, Number(o.fs) || 0.03));
      c.color = COLORS[o.color] ? o.color : "black";
    }
    return c;
  }
  // Put the additions of each key in `map` ({ key: [ov] }) on the list.
  function setOverlays(pages, map) {
    return clonePages(pages).map(function (p) {
      if (!Object.prototype.hasOwnProperty.call(map, p.key)) return p;
      var ov = (map[p.key] || []).map(cleanOv).filter(Boolean).slice(0, MAX_OV);
      if (ov.length) p.ov = ov; else delete p.ov;
      return p;
    });
  }

  // ---------- Page numbers and watermark ----------
  var NUM_POS = ["bc", "br", "bl", "tc", "tr"];
  var NUM_FMT = ["n", "nt"];
  var WM_OP = { light: 0.12, medium: 0.22, strong: 0.35 };
  // The document options of one session (not kept): page numbers,
  // watermark, title and author.
  function readDocOpts(raw) {
    var o = raw && typeof raw === "object" ? raw : {}, n = o.num || {}, w = o.wm || {};
    var start = Math.floor(Number(n.start));
    return {
      num: { on: !!n.on, pos: pick(n.pos, NUM_POS, "bc"), fmt: pick(n.fmt, NUM_FMT, "n"),
             start: start >= 0 && start <= 99999 ? start : 1 },
      wm: { on: !!w.on && !!String(w.text || "").trim(), text: String(w.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60),
            op: WM_OP[w.op] ? w.op : "light" },
      title: String(o.title || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200),
      author: String(o.author || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200)
    };
  }
  // The text of the page number of the i-th page (0-based) of `total`.
  function numText(opts, i, total) {
    var n = opts.num.start + i;
    return opts.num.fmt === "nt" ? n + " / " + (opts.num.start + total - 1) : String(n);
  }
  function numSize(S) { return Math.max(8, Math.min(16, round2(S / 60))); }
  // Centre of the number on the turned page (W' × H'), points, top-left.
  function numCenter(pos, dw, dh, size) {
    var m = Math.max(18, size * 2.2);
    var x = pos === "br" || pos === "tr" ? dw - m : pos === "bl" ? m : dw / 2;
    var y = pos.charAt(0) === "t" ? m * 0.8 : dh - m * 0.8;
    return [x, y];
  }
  // Watermark: corner to corner of the turned page, 45° up.
  function wmSize(textWidthAt1, dw, dh) {
    var diag = Math.sqrt(dw * dw + dh * dh);
    return Math.max(10, Math.min(Math.min(dw, dh) / 4, round2(diag * 0.62 / Math.max(0.1, textWidthAt1))));
  }

  // ---------- Compress ----------
  var COMPRESS = { light: { dpi: 150, q: 0.8 }, medium: { dpi: 110, q: 0.7 }, strong: { dpi: 80, q: 0.6 } };
  var MAX_RENDER_SIDE = 5000;
  // Scale for PDF.js (pixels per point) of a page of w × h points.
  function renderScale(w, h, dpi) {
    var s = dpi / 72, big = Math.max(w, h) * s;
    return big > MAX_RENDER_SIDE ? MAX_RENDER_SIDE / Math.max(w, h) : s;
  }

  // ---------- Signatures ----------
  // The saved signatures: [{ id, src (PNG data: URL), w, h }], newest first.
  function readSigs(raw) {
    var list = Array.isArray(raw) ? raw : [], out = [], seen = {};
    list.forEach(function (s) {
      if (!s || typeof s.src !== "string" || s.src.indexOf("data:image/png;base64,") !== 0 || s.src.length > MAX_SIG_URL) return;
      var id = String(s.id || "").slice(0, 40);
      if (!id || seen[id]) return;
      seen[id] = true;
      var w = Math.floor(Number(s.w)), h = Math.floor(Number(s.h));
      if (!(w > 0 && h > 0 && w <= 4000 && h <= 4000)) return;
      out.push({ id: id, src: s.src, w: w, h: h });
    });
    return out.slice(0, MAX_SIGS);
  }
  function addSig(list, sig) {
    return readSigs([sig].concat((list || []).filter(function (s) { return s.id !== sig.id; })));
  }
  function removeSig(list, id) { return readSigs((list || []).filter(function (s) { return s.id !== id; })); }

  // Otsu's split of a 256-bin histogram of grey levels: the split that
  // best parts ink from paper; the level returned is half way between
  // the mean ink and the mean paper of that split.
  function otsu(hist) {
    var total = 0, sum = 0, i;
    for (i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    if (!total) return 128;
    var sumB = 0, wB = 0, best = 0, at = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; at = Math.round((mB + mF) / 2); }
    }
    return at;
  }
  // RGBA pixels of a photo of a signature → ink: dark pixels keep the
  // ink colour with an alpha that fades near the threshold, the paper
  // becomes see-through. Changes `data` in place; returns the threshold.
  function inkFromPhoto(data, rgb) {
    var hist = new Array(256), i, n = data.length / 4;
    for (i = 0; i < 256; i++) hist[i] = 0;
    var grey = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var g = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
      grey[i] = g; hist[g]++;
    }
    var thr = Math.min(otsu(hist), 200), soft = 24;
    for (i = 0; i < n; i++) {
      var a = grey[i] >= thr ? 0 : Math.min(255, Math.round(255 * (thr - grey[i]) / soft));
      data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = a;
    }
    return thr;
  }
  // The box around the visible pixels (alpha > min) of RGBA data, with
  // `pad` pixels around it; null when nothing is visible.
  function inkBox(data, w, h, pad, min) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, lim = min == null ? 8 : min;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > lim) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    pad = pad || 0;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // The bytes of a base64 data: URL.
  function dataUrlBytes(url) {
    var b64 = String(url).slice(String(url).indexOf(",") + 1);
    if (typeof atob === "function") {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
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
    parseRanges: parseRanges, splitPlan: splitPlan, rangeLabel: rangeLabel, parseTarget: parseTarget,
    SIGS_KEY: SIGS_KEY, MAX_SIGS: MAX_SIGS, MAX_OV: MAX_OV, COLORS: COLORS, BASELINE: BASELINE,
    COMPRESS: COMPRESS, WM_OP: WM_OP, NUM_POS: NUM_POS,
    cloneOv: cloneOv, dispSize: dispSize, toDisp: toDisp, fromDisp: fromDisp, ovAt: ovAt, ovDisp: ovDisp,
    anchor: anchor, cleanOv: cleanOv, setOverlays: setOverlays,
    readDocOpts: readDocOpts, numText: numText, numSize: numSize, numCenter: numCenter, wmSize: wmSize,
    renderScale: renderScale, readSigs: readSigs, addSig: addSig, removeSig: removeSig,
    otsu: otsu, inkFromPhoto: inkFromPhoto, inkBox: inkBox, dataUrlBytes: dataUrlBytes
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfCore = api;
})(typeof window !== "undefined" ? window : this);
