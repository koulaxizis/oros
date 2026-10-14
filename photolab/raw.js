// ============================================================
// orOS Photo Lab — raw.js: camera RAW files (v1.0.0)
// A RAW photo (DNG, CR2, CR3, CRW, NEF, NRW, ARW, SRF, SR2, ORF, RAF,
// RW2, RWL, PEF, SRW, X3F, 3FR, FFF, IIQ, ERF, KDC, DCR, MRW, MOS,
// MEF) opens in two ways:
//   1. developed by LibRaw (vendor/libraw/: the unmodified
//      libraw-wasm 1.6.0 build of LibRaw 0.22.1, LGPL-2.1 or CDDL-1.0,
//      in its own module worker), loaded only when a RAW file is
//      opened. Its WebAssembly memory is "shared", which some browsers
//      allow only on cross-origin-isolated pages: then step 2.
//   2. the JPEG preview the camera stored inside the file, found by
//      the pure parser below (TIFF IFDs and SubIFDs, Fuji RAF header,
//      Panasonic JpgFromRaw, and a scan for any other JPEG, e.g. in a
//      CR3 or ORF). Usually full size or close; the camera's own look.
// Pure part (Node-tested in tests/photolab-raw.test.js):
//   isRaw(name), sniff(bytes), jpegInfo(bytes, off, len),
//   tiffInfo(bytes), previews(bytes) → [{ off, len, w, h, orient }]
//   best first, orientFor(jpeg, rawOrient), rgbToRgba(px, w, h, bits)
// The bytes are only read: offsets and counts are checked against the
// file, IFD loops are cut, nothing in the file runs.
// UMD: module.exports in Node (tests), window.PhotoLab.raw in the app.
// ============================================================
(function (root) {
  "use strict";

  var RAW_RE = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|raf|rw2|rwl|pef|srw|x3f|3fr|fff|iiq|erf|kdc|dcr|mrw|mos|mef)$/i;
  var MAX_IFDS = 64, MAX_ENTRIES = 1000, MAX_SCAN = 64;
  // JPEG frames a browser decodes: baseline, extended, progressive
  // (Huffman). Lossless (C3, the raw data of CR2 / DNG) and
  // arithmetic-coded frames are not pictures a browser can show.
  var SOF_OK = { 0xC0: 1, 0xC1: 1, 0xC2: 1 };
  var SOF_ANY = { 0xC0: 1, 0xC1: 1, 0xC2: 1, 0xC3: 1, 0xC5: 1, 0xC6: 1, 0xC7: 1, 0xC9: 1, 0xCA: 1, 0xCB: 1, 0xCD: 1, 0xCE: 1, 0xCF: 1 };

  function isRaw(name) { return RAW_RE.test(String(name || "")); }

  function u16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
  function u32(b, o, le) {
    return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
              : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  }
  function ascii(b, o, n) {
    var s = "";
    for (var i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
    return s;
  }

  // → "tiff" | "orf" | "rw2" | "raf" | "cr3" | "crw" | "mrw" | "x3f" | ""
  function sniff(b) {
    if (!b || b.length < 16) return "";
    var h4 = ascii(b, 0, 4);
    if (ascii(b, 0, 15) === "FUJIFILMCCD-RAW") return "raf";
    if (h4 === "II*\u0000" || h4 === "MM\u0000*") return "tiff";
    if (h4 === "IIRO" || h4 === "IIRS" || h4 === "MMOR") return "orf";
    if (h4 === "IIU\u0000") return "rw2";
    if (ascii(b, 4, 8) === "ftypcrx ") return "cr3";
    if ((h4.slice(0, 2) === "II" || h4.slice(0, 2) === "MM") && ascii(b, 6, 8) === "HEAPCCDR") return "crw";
    if (h4 === "\u0000MRM") return "mrw";
    if (h4 === "FOVb") return "x3f";
    return "";
  }

  // ---------- JPEG ----------
  // A JPEG at off (len: its size when the container says so) →
  // { off, len, w, h, sof, orient (its own Exif orientation, 0 = none) }
  // or null when it is not a whole JPEG with a frame and an end.
  function jpegInfo(b, off, len) {
    var n = b.length;
    if (off < 0 || off + 4 > n || b[off] !== 0xFF || b[off + 1] !== 0xD8) return null;
    var end = len ? Math.min(n, off + len) : n;
    var p = off + 2, w = 0, h = 0, sof = 0, orient = 0, scans = 0;
    while (p + 1 < end) {
      if (b[p] !== 0xFF) return null;
      while (p + 1 < end && b[p + 1] === 0xFF) p++;               // fill bytes
      var m = b[p + 1];
      p += 2;
      if (m === 0xD9) {
        if (!w || !h || !scans) return null;
        return { off: off, len: p - off, w: w, h: h, sof: sof, orient: orient };
      }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;          // no length
      if (m === 0xD8 || m === 0x00 || p + 2 > end) return null;
      var sl = u16(b, p, false);
      if (sl < 2 || p + sl > end) return null;
      if (SOF_ANY[m]) {
        if (sl < 8 || sof) return null;
        sof = m; h = u16(b, p + 3, false); w = u16(b, p + 5, false);
        if (!w || !h) return null;
      } else if (m === 0xE1 && !orient && sl > 16 && ascii(b, p + 2, 6) === "Exif\u0000\u0000") {
        orient = exifOrient(b, p + 8, p + sl);
      } else if (m === 0xDA) {
        if (!sof) return null;
        scans++;
        p += sl;
        // entropy-coded data: up to the next marker that is not a
        // stuffed 0x00 or a restart marker
        while (p + 1 < end) {
          if (b[p] === 0xFF) {
            var nb = b[p + 1];
            if (nb === 0x00 || (nb >= 0xD0 && nb <= 0xD7)) { p += 2; continue; }
            if (nb === 0xFF) { p++; continue; }
            break;
          }
          p++;
        }
        continue;
      }
      p += sl;
    }
    // The container gave the size: trust it when the frame was read.
    if (len && w && h && scans && off + len <= n) return { off: off, len: len, w: w, h: h, sof: sof, orient: orient };
    return null;
  }

  // Orientation (tag 0x112) of IFD0 of a TIFF block [start, stop).
  function exifOrient(b, start, stop) {
    if (start + 8 > stop) return 0;
    var bo = ascii(b, start, 2), le = bo === "II";
    if (!le && bo !== "MM") return 0;
    var ifd = start + u32(b, start + 4, le);
    if (ifd + 2 > stop) return 0;
    var cnt = Math.min(u16(b, ifd, le), MAX_ENTRIES);
    for (var i = 0; i < cnt; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > stop) return 0;
      if (u16(b, e, le) === 0x112) { var v = u16(b, e + 8, le); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  }

  // ---------- TIFF containers (DNG, CR2, NEF, ARW, PEF, ORF, RW2…) ----------
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
  // → { orient (IFD0, 0 = none), make, w, h, cands: [{ off, len }] }
  // or null when bytes do not start with a TIFF-like header.
  function tiffInfo(b) {
    var k = sniff(b);
    if (k !== "tiff" && k !== "orf" && k !== "rw2") return null;
    var le = b[0] === 0x49, n = b.length;
    var out = { orient: 0, make: "", w: 0, h: 0, cands: [] };
    var seen = {}, ifds = 0;
    function val(e, type, cnt, i) {
      var sz = TSIZE[type] || 1, at = cnt * sz <= 4 ? e + 8 : u32(b, e + 8, le);
      at += i * sz;
      if (at + sz > n) return -1;
      return sz === 2 ? u16(b, at, le) : sz === 1 ? b[at] : u32(b, at, le);
    }
    function walk(off, depth, chain) {
      while (off > 0 && off + 2 <= n && !seen[off] && ifds < MAX_IFDS) {
        seen[off] = 1; ifds++;
        var cnt = u16(b, off, le);
        if (cnt > MAX_ENTRIES || off + 2 + cnt * 12 > n) return;
        var t = {}, subs = [];
        for (var i = 0; i < cnt; i++) {
          var e = off + 2 + i * 12, tag = u16(b, e, le), type = u16(b, e + 2, le), c = u32(b, e + 4, le);
          if (!TSIZE[type]) continue;
          if (tag === 0x14A || tag === 0x8769) {
            for (var j = 0; j < Math.min(c, 16); j++) { var so = val(e, type === 3 ? 3 : 4, c, j); if (so > 0) subs.push(so); }
          } else if (tag === 0x2E && (type === 7 || type === 1) && c > 4) {
            var at = u32(b, e + 8, le);
            if (at + c <= n) out.cands.push({ off: at, len: c });
          } else if (tag === 0x10F && type === 2 && depth === 0 && !out.make) {
            var mo = c <= 4 ? e + 8 : u32(b, e + 8, le);
            if (mo + c <= n) out.make = ascii(b, mo, Math.min(c, 64)).replace(/\u0000[\s\S]*$/, "").trim();
          } else if (c === 1) t[tag] = val(e, type, 1, 0);
        }
        if (depth === 0 && ifds === 1) {
          if (t[0x112] >= 1 && t[0x112] <= 8) out.orient = t[0x112];
          if (t[0x100] > 0 && t[0x101] > 0) { out.w = t[0x100]; out.h = t[0x101]; }
        }
        if (t[0x201] > 0 && t[0x202] > 0) out.cands.push({ off: t[0x201], len: t[0x202] });
        if (t[0x111] > 0 && t[0x117] > 0 && (t[0x103] === 6 || t[0x103] === 7 || t[0x103] === 99)) out.cands.push({ off: t[0x111], len: t[0x117] });
        if (depth < 3) subs.forEach(function (s) { walk(s, depth + 1, false); });
        if (!chain) return;
        var nx = off + 2 + cnt * 12;
        if (nx + 4 > n) return;
        off = u32(b, nx, le);
      }
    }
    walk(u32(b, 4, le), 0, true);
    return out;
  }

  // ---------- Previews ----------
  // Every whole, browser-decodable JPEG in the file, biggest first.
  // Each { off, len, w, h, orient }: orient = how the picture must be
  // turned on top of what the browser does (see orientFor).
  function previews(b) {
    if (!(b instanceof Uint8Array) || b.length < 16) return [];
    var kind = sniff(b), found = [], ranges = [], rawOrient = 0;
    function add(info) {
      if (!info || !SOF_OK[info.sof] || info.w < 16 || info.h < 16) return;
      for (var i = 0; i < found.length; i++) if (found[i].off === info.off) return;
      found.push(info);
    }
    var ti = tiffInfo(b);
    if (ti) {
      rawOrient = ti.orient;
      ti.cands.forEach(function (c) {
        var info = jpegInfo(b, c.off, c.len);
        if (info) { ranges.push([info.off, info.off + info.len]); add(info); }
      });
    }
    if (kind === "raf" && b.length >= 92) {
      var ro = u32(b, 84, false), rl = u32(b, 88, false);
      var ri = jpegInfo(b, ro, rl);
      if (ri) { ranges.push([ri.off, ri.off + ri.len]); add(ri); }
    }
    // Any other JPEG (CR3, ORF maker notes, CRW, X3F…): scan for a
    // start of image, skipping JPEGs already read (their thumbnails).
    var scanned = 0, p = 0, n = b.length;
    while (p < n - 3 && scanned < MAX_SCAN) {
      if (b[p] !== 0xFF || b[p + 1] !== 0xD8 || b[p + 2] !== 0xFF) { p++; continue; }
      var inside = null;
      for (var r = 0; r < ranges.length; r++) if (p >= ranges[r][0] && p < ranges[r][1]) { inside = ranges[r]; break; }
      if (inside) { p = inside[1]; continue; }
      scanned++;
      var info = jpegInfo(b, p, 0);
      if (info) { ranges.push([info.off, info.off + info.len]); add(info); p = info.off + info.len; }
      else p += 2;
    }
    found.sort(function (x, y) { return y.w * y.h - x.w * x.h || x.off - y.off; });
    return found.map(function (f) {
      return { off: f.off, len: f.len, w: f.w, h: f.h, orient: orientFor(f, rawOrient) };
    });
  }

  // A JPEG with its own Exif orientation is turned by the browser
  // (image-orientation: from-image); one without gets the RAW's own.
  function orientFor(jpeg, rawOrient) {
    if (jpeg && jpeg.orient) return 1;
    return rawOrient >= 1 && rawOrient <= 8 ? rawOrient : 1;
  }
  // Width and height after an Exif orientation (5-8 swap them).
  function orientedSize(w, h, o) { return o >= 5 && o <= 8 ? { w: h, h: w } : { w: w, h: h }; }

  // LibRaw's output (RGB, or grey with colors 1; 8 or 16 bits) → RGBA.
  function rgbToRgba(px, w, h, bits, colors) {
    colors = colors || 3;
    var n = w * h, out = new Uint8ClampedArray(n * 4), shift = bits === 16 ? 8 : 0;
    for (var i = 0, s = 0, d = 0; i < n; i++, s += colors, d += 4) {
      if (colors >= 3) { out[d] = px[s] >> shift; out[d + 1] = px[s + 1] >> shift; out[d + 2] = px[s + 2] >> shift; }
      else out[d] = out[d + 1] = out[d + 2] = px[s] >> shift;
      out[d + 3] = 255;
    }
    return out;
  }

  var pure = {
    RAW_RE: RAW_RE, isRaw: isRaw, sniff: sniff, jpegInfo: jpegInfo, tiffInfo: tiffInfo,
    previews: previews, orientFor: orientFor, orientedSize: orientedSize, rgbToRgba: rgbToRgba
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Browser: decoding ----------
  var LIBRAW = "../vendor/libraw/index.js";
  var LIBRAW_MS = 120000;
  var libP = null;
  function library() {
    if (!libP) {
      // A classic script can still import an ES module.
      libP = import(new URL(LIBRAW, location.href).href).then(function (m) {
        if (!m || typeof m.default !== "function") throw new Error("libraw");
        return m.default;
      });
      libP.catch(function () { libP = null; });
    }
    return libP;
  }
  function timeout(p, ms) {
    return new Promise(function (ok, fail) {
      var tm = setTimeout(function () { fail(new Error("timeout")); }, ms);
      p.then(function (v) { clearTimeout(tm); ok(v); }, function (e) { clearTimeout(tm); fail(e); });
    });
  }
  // LibRaw in its own worker, closed after every file (its memory goes).
  // half: develop at half size (faster, a quarter of the memory).
  function develop(bytes, half, signal) {
    return library().then(function (LibRaw) {
      if (signal && signal.aborted) throw new Error("abort");
      var lr = new LibRaw(), done = function () { try { lr.dispose(); } catch (e) {} };
      if (signal) signal.addEventListener("abort", done, { once: true });
      // The library transfers what it gets: a copy keeps ours for step 2.
      return timeout(lr.open(new Uint8Array(bytes), {
        useCameraWb: true, halfSize: !!half, outputBps: 8, userQual: 3, outputColor: 1
      }).then(function () { return lr.imageData(); }), LIBRAW_MS).then(function (img) {
        done();
        if (!img || !img.width || !img.height || !img.data) throw new Error("libraw");
        var bits = img.bits || 8, colors = img.colors || 3;
        if (img.data.length < img.width * img.height * colors) throw new Error("libraw");
        return { w: img.width, h: img.height, data: rgbToRgba(img.data, img.width, img.height, bits, colors) };
      }, function (e) { done(); throw e; });
    });
  }
  function bitmapOf(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob, { imageOrientation: "from-image" });
    return Promise.reject(new Error("decode"));
  }
  // The biggest embedded JPEG that the browser decodes, turned upright.
  // → { canvas, w, h }
  function preview(bytes) {
    var list = previews(bytes), i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error("nopreview"));
      var p = list[i++];
      return bitmapOf(new Blob([bytes.subarray(p.off, p.off + p.len)], { type: "image/jpeg" })).then(function (bm) {
        var o = p.orient, sz = orientedSize(bm.width, bm.height, o);
        var c = document.createElement("canvas");
        c.width = sz.w; c.height = sz.h;
        var g = c.getContext("2d"), W = bm.width, H = bm.height;
        // Exif orientation → canvas transform (draws W × H)
        var M = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, W, 0], 3: [-1, 0, 0, -1, W, H], 4: [1, 0, 0, -1, 0, H],
                  5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, H, 0], 7: [0, -1, -1, 0, H, W], 8: [0, -1, 1, 0, 0, W] }[o] || [1, 0, 0, 1, 0, 0];
        g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
        g.drawImage(bm, 0, 0);
        try { bm.close(); } catch (e) {}
        return { canvas: c, w: sz.w, h: sz.h };
      }, function () { return next(); });
    }
    return next();
  }
  // A RAW file (Blob) → Promise<{ src: canvas | { w, h, data }, w, h,
  // via: "libraw" | "preview" }>. opts: { half, signal }.
  function decode(blob, opts) {
    opts = opts || {};
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (!sniff(bytes) && !previews(bytes).length) throw new Error("notraw");
      return develop(bytes, opts.half, opts.signal).then(function (img) {
        return { img: img, w: img.w, h: img.h, via: "libraw" };
      }, function (e) {
        if (opts.signal && opts.signal.aborted) throw e;
        return preview(bytes).then(function (r) { return { canvas: r.canvas, w: r.w, h: r.h, via: "preview" }; });
      });
    });
  }

  root.PhotoLab = root.PhotoLab || {};
  root.PhotoLab.raw = Object.assign({ decode: decode, develop: develop, preview: preview }, pure);
})(typeof window !== "undefined" ? window : this);
