// ============================================================
// orOS Photo Lab — psd.js: Photoshop .psd reader + writer (no DOM)
// Reader: PSD and PSB (large documents), 8-, 16- and 32-bit (linear
// light shown through the sRGB curve), RGB, Grayscale, CMYK (simple
// conversion without a colour profile), Lab, Indexed, Bitmap and
// Duotone (its grey ink); layers from the layer info or, in 16- and
// 32-bit files, from the Lr16 / Lr32 blocks. Each layer keeps its name
// (Unicode too), position, opacity, blend mode and visibility, and,
// through psdinfo.js:
//   - its layer mask as a mask (on/off kept; a vector mask is drawn
//     into it, both multiplied when there are two);
//   - layer styles as Photo Lab styles (drop shadow, outer and inner
//     glow, stroke, colour overlay); the others are named in notes;
//   - adjustment layers as adjustment layers (levels, curves,
//     hue/saturation, colour balance, brightness/contrast, black &
//     white, photo filter, gradient map, invert, threshold, posterize;
//     vibrance and exposure approximated), with their masks;
//   - fill layers without saved pixels drawn (colour, gradient).
// Text, smart objects and shape layers come as the pixels Photoshop
// saved for them. Groups open as groups (wave PS-4: visibility,
// opacity, blend or pass-through, open/closed, nesting); a group's mask
// goes onto the layers inside. Clipping masks are baked: a clipped
// picture keeps what lies over its base, a clipped adjustment changes
// the base's pixels. Fill opacity goes into the layer opacity (or the
// pixels, when the layer has styles). Raw, RLE and ZIP channels (ZIP
// through the platform's DecompressionStream). A file without layers
// opens as its merged picture. Every count and size is checked before
// anything is allocated (a hostile file cannot make it allocate more
// than `max`).
// Writer: raster layers (RLE) with their masks, Unicode names, opacity,
// blend, visibility, groups as folders, plus the merged picture, so Photoshop, Photopea,
// GIMP and Krita open it with its layers.
//
// read(bytes, o) → Promise<{ w, h, layers: [layer], groups, merged: img | null,
//                    notes: { key: count }, names: { key: [layer names] },
//                    skipped (older summary) }>; layers bottom → top;
//   layer = { name, x, y, op, bl, vis, img: { w, h, data RGBA },
//             mk?: { x, y, img: { w, h, data grey }, bg, on }, fx? }
//         | { k: "adj", name, op, bl, vis, x: 0, y: 0, aj: { id, p }, mk? }
//   (mask boxes in canvas pixels); groups = [{ name, vis, op, bl
//   ("pass" or a blend id), open, p: parent index }], layer.g = index.
//   notes keys: groups (a group mask went onto its layers), groupBlend,
//   groupFx, groupMask, blend, blendIf, artboard, adjLost, adjApprox,
//   fx_<style>, fxApprox, fxLost, fillLost, fillApprox, fillFx, vmask,
//   vmaskLost, clip, clipAdj, clipLost, text, smart, empty, cmyk, hdr,
//   duotone.
//   o.maxSide, o.maxPixels (sum of all layer areas, default 120 MP),
//   o.layersOnly (no merged picture even without layers).
//   Rejects with Error("psd") (not a PSD / damaged), "psd-mode" (a
//   colour model or depth it does not read: Multichannel),
//   "psd-big" (over the limits), "psd-zip" (ZIP data and no
//   DecompressionStream).
// write({ w, h, layers, merged }) → Uint8Array (layers bottom → top;
//   a layer may carry mk as read() gives it).
//
// UMD: module.exports in Node (tests), window.PhotoLab.psd in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_RECORDS = 2000;
  // psdinfo.js: layer styles, adjustment and fill layers, vector masks.
  var INFO = (root.PhotoLab && root.PhotoLab.psdInfo) ||
             (typeof module !== "undefined" && module.exports ? require("./psdinfo.js") : null);

  // Photoshop blend keys ⇄ Photo Lab blend ids (core.js BLENDS).
  var KEYS = {
    "norm": "normal", "mul ": "multiply", "scrn": "screen", "over": "overlay",
    "dark": "darken", "lite": "lighten", "div ": "dodge", "idiv": "burn",
    "hLit": "hard", "sLit": "soft", "diff": "difference", "smud": "exclusion",
    "hue ": "hue", "sat ": "saturation", "colr": "color", "lum ": "luminosity"
  };
  var IDS = {};
  Object.keys(KEYS).forEach(function (k) { IDS[KEYS[k]] = k; });

  // ---------- Reading helpers ----------
  function Reader(b, big) { this.b = b; this.p = 0; this.big = !!big; }
  Reader.prototype.need = function (n) { if (n < 0 || this.p + n > this.b.length) throw new Error("psd"); };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  Reader.prototype.u16 = function () { this.need(2); var v = (this.b[this.p] << 8) | this.b[this.p + 1]; this.p += 2; return v; };
  Reader.prototype.i16 = function () { var v = this.u16(); return v > 32767 ? v - 65536 : v; };
  Reader.prototype.u32 = function () {
    this.need(4);
    var b = this.b, p = this.p; this.p += 4;
    return b[p] * 16777216 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
  };
  Reader.prototype.i32 = function () { var v = this.u32(); return v > 2147483647 ? v - 4294967296 : v; };
  Reader.prototype.u64 = function () {
    var hi = this.u32(), lo = this.u32();
    if (hi > 2097151) throw new Error("psd-big");        // past 2^53: no file is that big
    return hi * 4294967296 + lo;
  };
  Reader.prototype.len = function () { return this.big ? this.u64() : this.u32(); };   // PSB: 8-byte lengths
  Reader.prototype.str = function (n) {
    this.need(n);
    var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p + i]);
    this.p += n; return s;
  };
  Reader.prototype.skip = function (n) { this.need(n); this.p += n; };

  // PackBits (RLE) into out[o .. o+n); returns bytes consumed.
  function unpack(src, s, len, out, o, n) {
    var end = s + len, w = o, stop = o + n;
    while (s < end && w < stop) {
      var c = src[s++];
      if (c > 127) c -= 256;
      if (c >= 0) {
        var k = c + 1;
        if (s + k > end) throw new Error("psd");
        for (var i = 0; i < k && w < stop; i++) out[w++] = src[s + i];
        s += k;
      } else if (c !== -128) {
        var r = 1 - c;
        if (s >= end) throw new Error("psd");
        var v = src[s++];
        for (var j = 0; j < r && w < stop; j++) out[w++] = v;
      }
    }
    if (w !== stop) throw new Error("psd");
  }

  // ZIP channels: zlib data inflated by the platform, never past
  // `size` bytes (checked while it streams).
  function inflate(data, size) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("psd-zip"));
    var out = new Uint8Array(size), at = 0;
    var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (at !== size) throw new Error("psd"); return out; }
        if (at + r.value.length > size) { try { reader.cancel(); } catch (e) {} throw new Error("psd"); }
        out.set(r.value, at); at += r.value.length;
        return pump();
      });
    }
    return pump().catch(function () { throw new Error("psd"); });
  }

  // Linear light (32-bit files) → sRGB bytes.
  var SRGB = null;
  function srgbLut() {
    if (SRGB) return SRGB;
    SRGB = new Uint8Array(4097);
    for (var i = 0; i <= 4096; i++) {
      var v = i / 4096;
      SRGB[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    }
    return SRGB;
  }
  function f2b(f, gamma) {
    if (!(f > 0)) return 0;
    if (f >= 1) return 255;
    return gamma ? srgbLut()[Math.round(f * 4096)] : Math.round(f * 255);
  }

  // A channel found while parsing: { comp, at, len, counts, w, h }
  // (at/len: its data after the compression word and the RLE counts).
  // Decodes to w × h bytes: 16-bit samples keep their high byte, 32-bit
  // floats are linear light (colour through the sRGB curve when
  // `gamma`), 1-bit (Bitmap) black = 0.
  function decode(b, c, bpc, gamma) {
    var rw = !(c.w * c.h) ? 0 : bpc === 0 ? Math.ceil(c.w / 8) : c.w * bpc, size = rw * c.h;
    var src = b.subarray(c.at, c.at + c.len), raw;
    if (c.comp === 0) {
      if (src.length < size) return Promise.reject(new Error("psd"));
      raw = Promise.resolve(src.subarray(0, size));
    } else if (c.comp === 1) {
      try {
        var r = new Uint8Array(size), s = 0;
        for (var y = 0; y < c.h; y++) {
          if (s + c.counts[y] > src.length) throw new Error("psd");
          unpack(src, s, c.counts[y], r, y * rw, rw);
          s += c.counts[y];
        }
        raw = Promise.resolve(r);
      } catch (e) { return Promise.reject(e); }
    } else if (c.comp === 2 || c.comp === 3) {
      raw = inflate(src, size).then(function (r) {
        if (c.comp === 3) unpredict(r, c.w, c.h, bpc);
        return r;
      });
    } else return Promise.reject(new Error("psd"));
    return raw.then(function (r) {
      if (bpc === 1) return r;
      var plane = new Uint8Array(c.w * c.h), i;
      if (bpc === 2) for (i = 0; i < plane.length; i++) plane[i] = r[i * 2];
      else if (bpc === 4) {
        var dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
        for (i = 0; i < plane.length; i++) plane[i] = f2b(dv.getFloat32(i * 4), gamma);
      } else {                                          // 1 bit per pixel, rows padded to bytes
        for (var yy = 0; yy < c.h; yy++) for (var x = 0; x < c.w; x++)
          plane[yy * c.w + x] = (r[yy * rw + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
      }
      return plane;
    });
  }
  // ZIP with prediction: every sample is stored as the difference from
  // the one to its left (16-bit: big-endian 16-bit differences; 32-bit:
  // byte differences over the row, its bytes stored plane by plane).
  function unpredict(r, w, h, bpc) {
    for (var y = 0; y < h; y++) {
      var o = y * w * bpc, x;
      if (bpc === 1) for (x = 1; x < w; x++) r[o + x] = (r[o + x] + r[o + x - 1]) & 255;
      else if (bpc === 2) {
        var prev = (r[o] << 8) | r[o + 1];
        for (x = 1; x < w; x++) {
          var i = o + x * 2, v = (((r[i] << 8) | r[i + 1]) + prev) & 65535;
          r[i] = v >> 8; r[i + 1] = v & 255; prev = v;
        }
      } else if (bpc === 4) {
        var n = w * 4, row = r.slice(o, o + n);
        for (x = 1; x < n; x++) row[x] = (row[x] + row[x - 1]) & 255;
        for (x = 0; x < w; x++) for (var k = 0; k < 4; k++) r[o + x * 4 + k] = row[k * w + x];
      }
    }
  }

  // RGBA from the colour planes of one model and an optional alpha.
  // Models: 0 Bitmap, 1 Grayscale, 2 Indexed (f.pal, f.trans), 3 RGB,
  // 4 CMYK (stored inverted, simple conversion without a profile),
  // 8 Duotone (its grey ink), 9 Lab.
  function toRgba(planes, n, f, A) {
    var d = new Uint8ClampedArray(n * 4), i, model = f.mode;
    if (model === 0 || model === 1 || model === 8) {
      for (i = 0; i < n; i++) { var g = planes[0][i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; }
    } else if (model === 2) {
      var pal = f.pal;
      for (i = 0; i < n; i++) {
        var ix = planes[0][i];
        d[i * 4] = pal[ix]; d[i * 4 + 1] = pal[256 + ix]; d[i * 4 + 2] = pal[512 + ix];
      }
    } else if (model === 4) {
      for (i = 0; i < n; i++) {
        var k = planes[3][i];
        d[i * 4] = Math.round(planes[0][i] * k / 255);
        d[i * 4 + 1] = Math.round(planes[1][i] * k / 255);
        d[i * 4 + 2] = Math.round(planes[2][i] * k / 255);
      }
    } else if (model === 9) {
      var cache = {};
      for (i = 0; i < n; i++) {
        var L = planes[0][i], a = planes[1][i], bb = planes[2][i], key = (L << 16) | (a << 8) | bb, c = cache[key];
        if (!c) { c = INFO.labRgb(L * 100 / 255, a - 128, bb - 128); cache[key] = c; }
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2];
      }
    } else {
      for (i = 0; i < n; i++) { d[i * 4] = planes[0][i]; d[i * 4 + 1] = planes[1][i]; d[i * 4 + 2] = planes[2][i]; }
    }
    for (i = 0; i < n; i++) d[i * 4 + 3] = A ? A[i] : 255;
    if (model === 2 && f.trans >= 0) for (i = 0; i < n; i++) if (planes[0][i] === f.trans) d[i * 4 + 3] = 0;
    return d;
  }
  var COLOUR = { 0: 1, 1: 1, 2: 1, 3: 3, 4: 4, 8: 1, 9: 3 };   // colour channels per model
  // Keys whose length is 8 bytes in a PSB.
  var LONG_KEYS = { LMsk: 1, Lr16: 1, Lr32: 1, Layr: 1, Mt16: 1, Mt32: 1, Mtrn: 1, Alph: 1, FMsk: 1, lnk2: 1, FEid: 1, FXid: 1, PxSD: 1 };
  // What a layer may carry beside its pixels (kept as bytes for psdinfo.js).
  var KEEP = { lfx2: 1, lmfx: 1, SoCo: 1, GdFl: 1, PtFl: 1, vmsk: 1, vsms: 1, CgEd: 1 };
  var SMART = { SoLd: 1, PlLd: 1, SoLE: 1 };

  function name16(R, len) {
    var n = R.u32(), s = "";
    if (n * 2 + 4 > len) throw new Error("psd");
    for (var i = 0; i < n; i++) { var c = R.u16(); if (c) s += String.fromCharCode(c); }
    return s;
  }

  function cleanText(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60); }

  function read(bytes, o) {
    try { return parse(bytes, o || {}); } catch (e) { return Promise.reject(e); }
  }
  function parse(bytes, o) {
    var maxPixels = o.maxPixels || 120e6;
    if (!(bytes instanceof Uint8Array)) throw new Error("psd");
    var R = new Reader(bytes);
    if (R.str(4) !== "8BPS") throw new Error("psd");
    var ver = R.u16();
    if (ver !== 1 && ver !== 2) throw new Error("psd");
    R.big = ver === 2;
    var maxSide = o.maxSide || (R.big ? 300000 : 30000);
    R.skip(6);
    var nch = R.u16(), h = R.u32(), w = R.u32(), depth = R.u16(), mode = R.u16();
    if (nch < 1 || nch > 56 || !w || !h) throw new Error("psd");
    if (!COLOUR[mode] || (mode === 0 ? depth !== 1 : (depth !== 8 && depth !== 16 && depth !== 32))) throw new Error("psd-mode");
    if (w > maxSide || h > maxSide || w * h > maxPixels) throw new Error("psd-big");
    var bpc = depth === 1 ? 0 : depth / 8, nc = COLOUR[mode];
    var f = { w: w, h: h, bpc: bpc, mode: mode, nc: nc, big: R.big, pal: null, trans: -1, angle: 120, recs: [], merged: null, notes: {} };
    var cmLen = R.u32(), cmAt = R.p;
    R.need(cmLen);
    if (mode === 2) {
      if (cmLen < 768) throw new Error("psd");
      f.pal = bytes.subarray(cmAt, cmAt + 768);
    }
    if (mode === 8) f.notes.duotone = 1;
    if (mode === 4) f.notes.cmyk = 1;
    if (depth === 32) f.notes.hdr = 1;
    R.p = cmAt + cmLen;
    resources(R, R.u32(), f);

    var mergedAlpha = false;
    var lmLen = R.len(), lmEnd = R.p + lmLen;
    R.need(lmLen);
    if (lmLen >= 4) {
      var liLen = R.len(), liEnd = R.p + liLen;
      if (liEnd > lmEnd) throw new Error("psd");
      if (liLen >= 2) mergedAlpha = layerInfo(R, liEnd, f, maxSide, maxPixels);
      R.p = liEnd;
      if (R.p + 4 <= lmEnd) {
        var gm = R.u32();                               // global layer mask info
        if (R.p + gm > lmEnd) throw new Error("psd");
        R.skip(gm);
        // Tagged blocks: 16- and 32-bit files keep their layers in Lr16 / Lr32.
        while (R.p + 12 <= lmEnd) {
          var sig = R.str(4);
          if (sig !== "8BIM" && sig !== "8B64") break;
          var key = R.str(4), len = R.big && LONG_KEYS[key] ? R.u64() : R.u32(), end = R.p + len;
          if (end > lmEnd) break;
          if ((key === "Lr16" || key === "Lr32") && !f.recs.length && len >= 2) {
            var sub = new Reader(bytes, R.big); sub.p = R.p;
            mergedAlpha = layerInfo(sub, end, f, maxSide, maxPixels) || mergedAlpha;
          }
          R.p = end + ((4 - (len % 4)) % 4);
          if (R.p > lmEnd) break;
        }
      }
      R.p = lmEnd;
    }
    if (R.p + 2 <= bytes.length) {
      var comp = R.u16(), use = Math.min(nch, mergedAlpha ? nc + 1 : nc);
      if (nch < nc) throw new Error("psd");
      var counts = null;
      if (comp === 1) { counts = []; for (var k = 0; k < nch * h; k++) counts.push(R.big ? R.u32() : R.u16()); }
      var merged = [], at = R.p, rowBytes = bpc === 0 ? Math.ceil(w / 8) : w * bpc;
      for (var m = 0; m < use; m++) {
        var mc = { comp: comp, at: at, len: bytes.length - at, w: w, h: h, counts: null };
        if (comp === 1) {
          mc.counts = counts.slice(m * h, m * h + h);
          var sum = 0; mc.counts.forEach(function (n) { sum += n; });
          mc.len = sum; at += sum;
        } else if (comp === 0) { mc.len = rowBytes * h; at += mc.len; }
        else { merged = null; break; }                  // ZIP merged data has no per-plane lengths
        merged.push(mc);
      }
      f.merged = merged;
    }
    return build(bytes, f, o);
  }

  // Image resources: the global light angle (layer styles) and the
  // transparent colour of an Indexed file.
  function resources(R, len, f) {
    var end = R.p + len;
    R.need(len);
    while (R.p + 12 <= end) {
      if (R.str(4) !== "8BIM") break;
      var id = R.u16(), nl = R.u8();
      R.skip(nl + ((nl + 1) % 2));
      var size = R.u32(), at = R.p;
      if (at + size > end) break;
      if (id === 1037 && size >= 4) { var a = R.i32(); if (a >= -360 && a <= 360) f.angle = a; }
      else if (id === 1047 && size >= 2) f.trans = R.u16();
      R.p = at + size + (size % 2);
    }
    R.p = end;
  }

  // Layer records and where their channel data sits; → merged alpha flag.
  function layerInfo(R, end, f, maxSide, maxPixels) {
    var rawCount = R.i16(), count = Math.abs(rawCount);
    if (count > MAX_RECORDS) throw new Error("psd-big");
    var total = 0, i, recs = [];
    for (i = 0; i < count; i++) {
      var r = { top: R.i32(), left: R.i32(), bottom: R.i32(), right: R.i32(), ch: [], info: {} };
      r.w = r.right - r.left; r.h = r.bottom - r.top;
      if (r.w < 0 || r.h < 0 || r.w > maxSide || r.h > maxSide) throw new Error("psd-big");
      var cn = R.u16();
      if (cn > 56) throw new Error("psd");
      for (var c = 0; c < cn; c++) r.ch.push({ id: R.i16(), len: R.len() });
      if (R.str(4) !== "8BIM") throw new Error("psd");
      r.key = R.str(4); r.op = R.u8(); r.clip = R.u8(); r.flags = R.u8(); R.skip(1);
      var exLen = R.u32(), exEnd = R.p + exLen;
      R.need(exLen);
      var mkLen = R.u32();
      if (mkLen >= 18) {
        var mp = R.p;
        r.mask = { top: R.i32(), left: R.i32(), bottom: R.i32(), right: R.i32(), def: R.u8(), flags: R.u8() };
        if (mkLen >= 20 && (r.mask.flags & 16)) {        // mask parameters
          var pf = R.u8();
          if (pf & 1) R.skip(1);
          if (pf & 2) R.skip(8);
          if (pf & 4) R.skip(1);
          if (pf & 8) R.skip(8);
        }
        if (mp + mkLen - R.p >= 18) {                    // the real user mask (with a vector mask too)
          var rf = R.u8(), rd = R.u8();
          r.real = { flags: rf, def: rd, top: R.i32(), left: R.i32(), bottom: R.i32(), right: R.i32() };
        }
        R.p = mp + mkLen;
      } else R.skip(mkLen);
      var brLen = R.u32(), brAt = R.p;
      R.need(brLen);
      for (var q = 0; q + 4 <= brLen; q += 4) {          // "Blend If": [0, 0, 255, 255] everywhere by default
        var b0 = R.b[brAt + q], b1 = R.b[brAt + q + 1], b2 = R.b[brAt + q + 2], b3 = R.b[brAt + q + 3];
        if (b0 !== 0 || b1 !== 0 || b2 !== 255 || b3 !== 255) { r.blendIf = 1; break; }
      }
      R.p = brAt + brLen;
      var pl = R.u8(); r.name = R.str(pl); R.skip((4 - ((pl + 1) % 4)) % 4);
      while (R.p + 12 <= exEnd) {
        var sig = R.str(4);
        if (sig !== "8BIM" && sig !== "8B64") break;
        var key = R.str(4), len = R.big && LONG_KEYS[key] ? R.u64() : R.u32(), dEnd = R.p + len;
        if (dEnd > exEnd) throw new Error("psd");
        if (key === "luni") r.name = name16(R, len);
        else if (key === "lsct" || key === "lsdk") {
          if (len >= 4) r.section = R.u32();
          if (len >= 12 && R.str(4) === "8BIM") r.gblend = R.str(4);
        }
        else if (key === "iOpa" && len >= 1) r.fill = R.u8();
        else if (key === "TySh") r.text = 1;
        else if (SMART[key]) r.smart = 1;
        else if (key === "artb" || key === "artd" || key === "abdd") r.artboard = 1;
        else if (KEEP[key] || INFO.isAdj(key)) {
          r.info[key] = R.b.subarray(R.p, dEnd);
          if (INFO.isAdj(key) && key !== "CgEd" && !r.adj) r.adj = key;
          if (key === "CgEd" && !r.adj) r.adj = "CgEd";
        }
        R.p = dEnd;
      }
      if (r.adj === "CgEd" && r.info.brit) r.adj = "brit";
      R.p = exEnd;
      if (!r.section) total += r.w * r.h;
      recs.push(r);
    }
    if (total > maxPixels) throw new Error("psd-big");
    // Where each channel's data sits (decoded later).
    recs.forEach(function (r) {
      var hasReal = r.real && r.ch.some(function (ch) { return ch.id === -3; });
      r.ch.forEach(function (ch) {
        var start = R.p, chEnd = start + ch.len;
        R.need(ch.len);
        ch.w = r.w; ch.h = r.h;
        var mr = ch.id === -2 ? r.mask : ch.id === -3 ? r.real : null;
        if (ch.id === -2 || ch.id === -3) {
          if (!mr) { ch.skip = true; R.p = chEnd; return; }
          ch.w = mr.right - mr.left; ch.h = mr.bottom - mr.top;
          if (ch.w < 0 || ch.h < 0 || ch.w > maxSide || ch.h > maxSide) throw new Error("psd-big");
          if (ch.id === -2 && hasReal) ch.vec = true;    // -2 is then Photoshop's vector mask picture
        }
        if (ch.len >= 2 && ch.w && ch.h) {
          ch.comp = R.u16();
          if (ch.comp === 1) { ch.counts = []; for (var y = 0; y < ch.h; y++) ch.counts.push(R.big ? R.u32() : R.u16()); }
          ch.at = R.p; ch.len = chEnd - R.p;
          if (ch.len < 0) throw new Error("psd");
        } else ch.skip = true;
        R.p = chEnd;
      });
    });
    f.recs = recs;
    return rawCount < 0;           // negative: the merged picture's first extra channel is transparency
  }

  // Decode channel by channel (one layer's planes alive at a time) and
  // assemble the layers; the merged picture only when no layer came in.
  function note(f, k, name) {
    f.notes[k] = (f.notes[k] || 0) + 1;
    if (name) { var l = f.names[k] = f.names[k] || []; if (l.length < 8 && l.indexOf(name) < 0) l.push(name); }
  }
  function build(bytes, f, o) {
    var layers = [], open = [], groups = [];
    f.names = {};
    var chain = Promise.resolve();
    f.recs.forEach(function (r) {
      chain = chain.then(function () {
        if (r.section === 3) { open.push({ at: layers.length, g: groups.length }); return; }
        if (r.section === 1 || r.section === 2) return closeGroup(bytes, f, r, layers, groups, open.length ? open.pop() : { at: 0, g: 0 });
        if (r.section) return;
        return oneLayer(bytes, f, r, layers);
      });
    });
    return chain.then(function () {
      clipBake(layers, f);
      layers.forEach(function (L) { delete L.clip; });
      if (layers.length || !f.merged || o.layersOnly) {
        if (!layers.length) throw new Error("psd");
        return { w: f.w, h: f.h, layers: layers, groups: groups, merged: null, notes: f.notes, names: f.names, skipped: legacy(f) };
      }
      var planes = [], step = Promise.resolve();
      f.merged.forEach(function (mc, i) {
        step = step.then(function () { return decode(bytes, mc, f.bpc, i < f.nc); }).then(function (p) { planes.push(p); });
      });
      return step.then(function () {
        var img = { w: f.w, h: f.h, data: toRgba(planes, f.w * f.h, f, planes.length > f.nc ? planes[f.nc] : null) };
        return { w: f.w, h: f.h, layers: [], merged: img, notes: f.notes, names: f.names, skipped: legacy(f) };
      });
    });
  }
  function legacy(f) {                                   // the older summary (ORA and Krita use the same)
    var n = f.notes;
    return { groups: n.groups || 0, masks: 0, empty: n.empty || 0, blends: n.blend || 0 };
  }

  function planesOf(bytes, f, r, ids) {
    var planes = {}, step = Promise.resolve();
    r.ch.forEach(function (ch) {
      if (ch.skip || ids.indexOf(ch.id) < 0) return;
      step = step.then(function () { return decode(bytes, ch, f.bpc, ch.id >= 0); })
                 .then(function (p) { planes[ch.id] = p; });
    });
    return step.then(function () { return planes; });
  }
  // The layer's user mask as { x, y, img: { w, h, data: grey }, bg, on }.
  function userMask(r, planes) {
    var real = planes[-3] && r.real, m = real ? r.real : r.mask, plane = real ? planes[-3] : planes[-2];
    if (!m || !plane) return null;
    // bit 3: this mask was drawn from other data (the vector mask, read on its own)
    if (!real && (m.flags & 8) && (r.info.vmsk || r.info.vsms)) return null;
    var inv = (m.flags & 4) !== 0, data = plane, def = m.def ? 255 : 0;
    if (inv) { data = new Uint8Array(plane.length); for (var i = 0; i < plane.length; i++) data[i] = 255 - plane[i]; def = 255 - def; }
    return { x: m.left, y: m.top, img: { w: m.right - m.left, h: m.bottom - m.top, data: data }, bg: def ? 255 : 0, on: (m.flags & 2) ? 0 : 1 };
  }
  // Both masks in one: a × b over the union of their rectangles.
  function mulMasks(a, b) {
    if (!a) return b;
    if (!b) return a;
    var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.img.w, b.x + b.img.w), y1 = Math.max(a.y + a.img.h, b.y + b.img.h);
    var w = x1 - x0, h = y1 - y0, d = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) d[y * w + x] = Math.round(maskAt(a, x + x0, y + y0) * maskAt(b, x + x0, y + y0) / 255);
    return { x: x0, y: y0, img: { w: w, h: h, data: d }, bg: Math.round(a.bg * b.bg / 255) ? 255 : 0, on: a.on && b.on ? 1 : (a.on ? 1 : b.on) };
  }
  function maskAt(m, x, y) {
    var gx = x - m.x, gy = y - m.y;
    if (gx < 0 || gy < 0 || gx >= m.img.w || gy >= m.img.h) return m.bg;
    return m.img.data[gy * m.img.w + gx];
  }
  // A vector mask as a pixel mask over its path's box (cut to the canvas).
  function vectorMask(f, r) {
    var raw = r.info.vmsk || r.info.vsms;
    if (!raw) return null;
    var vm;
    try { vm = INFO.vmask(raw); } catch (e) { note(f, "vmaskLost", cleanText(r.name)); return null; }
    if (vm.off) return null;
    var x0 = f.w, y0 = f.h, x1 = 0, y1 = 0;
    vm.paths.forEach(function (p) {
      p.knots.forEach(function (k) {
        k.forEach(function (pt) {
          x0 = Math.min(x0, Math.floor(pt[0] * f.w)); y0 = Math.min(y0, Math.floor(pt[1] * f.h));
          x1 = Math.max(x1, Math.ceil(pt[0] * f.w)); y1 = Math.max(y1, Math.ceil(pt[1] * f.h));
        });
      });
    });
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(f.w, x1); y1 = Math.min(f.h, y1);
    if (vm.all || vm.inv) { x0 = 0; y0 = 0; x1 = f.w; y1 = f.h; }
    if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, img: { w: 1, h: 1, data: new Uint8Array(1) }, bg: 0, on: 1 };
    var data = INFO.paint(vm, f.w, f.h, x0, y0, x1 - x0, y1 - y0);
    note(f, "vmask");
    return { x: x0, y: y0, img: { w: x1 - x0, h: y1 - y0, data: data }, bg: vm.inv ? 255 : 0, on: 1 };
  }
  // A fill layer without saved pixels, drawn over the canvas.
  function fillPixels(f, r) {
    var key = r.info.SoCo ? "SoCo" : r.info.GdFl ? "GdFl" : r.info.PtFl ? "PtFl" : null;
    if (!key) return null;
    var fl = INFO.fill(key, r.info[key]);
    if (!fl || fl.pattern) { note(f, "fillLost", cleanText(r.name)); return null; }
    var w = f.w, h = f.h, d = new Uint8ClampedArray(w * h * 4), x, y, i;
    if (fl.c) {
      var c = hexRgb(fl.c);
      for (i = 0; i < w * h; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
    } else {
      var stops = fl.stops.map(function (s) { return { at: s.at, c: hexRgb(s.c) }; });
      if (fl.rev) stops = stops.map(function (s) { return { at: 1 - s.at, c: s.c }; }).reverse();
      var a = fl.ang * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a);
      var half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2, rad = Math.sqrt(w * w + h * h) / 2;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
        var t = fl.type === "radial" ? Math.sqrt(px * px + py * py) / rad : (px * dx + py * dy) / (2 * half) + 0.5;
        var col = gradAt(stops, t < 0 ? 0 : t > 1 ? 1 : t);
        i = (y * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      if (fl.approx) note(f, "fillApprox", cleanText(r.name));
    }
    return { x: 0, y: 0, img: { w: w, h: h, data: d } };
  }
  function gradAt(stops, t) {
    if (t <= stops[0].at) return stops[0].c;
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i].at) {
        var a = stops[i - 1], b = stops[i], k = (t - a.at) / ((b.at - a.at) || 1);
        return [a.c[0] + (b.c[0] - a.c[0]) * k, a.c[1] + (b.c[1] - a.c[1]) * k, a.c[2] + (b.c[2] - a.c[2]) * k];
      }
    }
    return stops[stops.length - 1].c;
  }
  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  function oneLayer(bytes, f, r, layers) {
    var name = cleanText(r.name) || "Layer";
    var base = { name: name, op: Math.round(r.op / 255 * 100), vis: (r.flags & 2) ? 0 : 1, clip: r.clip ? 1 : 0 };
    var bl = KEYS[r.key];
    if (!bl) { bl = "normal"; note(f, "blend", name); }
    base.bl = bl;
    if (r.blendIf) note(f, "blendIf", name);
    if (r.artboard) note(f, "artboard", name);
    return planesOf(bytes, f, r, [-3, -2, -1, 0, 1, 2, 3]).then(function (planes) {
      var mk = mulMasks(userMask(r, planes), null);
      if (r.adj) {
        var res = INFO.adjust(r.adj, r.info[r.adj], r.info);
        if (!res.aj) { note(f, "adjLost", name); return; }
        if (res.approx) note(f, "adjApprox", name);
        var L = Object.assign(base, { k: "adj", aj: res.aj, x: 0, y: 0 });
        var vm = vectorMask(f, r);
        mk = mulMasks(mk, vm);
        if (mk) L.mk = mk;
        if (r.fill != null && r.fill < 255) L.op = Math.round(L.op * r.fill / 255);
        layers.push(L);
        return;
      }
      var cp = [];
      for (var ci = 0; ci < f.nc; ci++) cp.push(planes[ci]);
      var px = null;
      if (r.w && r.h && !cp.some(function (pl) { return !pl; })) {
        px = { x: r.left, y: r.top, img: { w: r.w, h: r.h, data: toRgba(cp, r.w * r.h, f, planes[-1]) } };
      } else {
        px = fillPixels(f, r);
        if (px) mk = mulMasks(mk, vectorMask(f, r));
      }
      if (!px) { if (!r.info.PtFl) note(f, "empty"); return; }
      // A vector mask on a picture layer (a shape layer's pixels are already its shape).
      if (r.w && r.h && !(r.info.SoCo || r.info.GdFl || r.info.PtFl)) mk = mulMasks(mk, vectorMask(f, r));
      var L2 = Object.assign(base, { x: px.x, y: px.y, img: px.img });
      if (mk) L2.mk = mk;
      var fxRaw = r.info.lfx2 || r.info.lmfx;
      if (fxRaw) {
        try {
          var e = INFO.effects(fxRaw, f.angle);
          if (e.fx) L2.fx = e.fx;
          e.lost.forEach(function (k) { note(f, "fx_" + k, name); });
          if (e.approx.length) note(f, "fxApprox", name);
        } catch (er) { note(f, "fxLost", name); }
      }
      if (r.fill != null && r.fill < 255) {
        if (!L2.fx) L2.op = Math.round(L2.op * r.fill / 255);
        else {
          var a = L2.img.data, k2 = r.fill / 255;
          for (var i = 3; i < a.length; i += 4) a[i] = Math.round(a[i] * k2);
          note(f, "fillFx", name);
        }
      }
      if (r.text) note(f, "text", name);
      if (r.smart) note(f, "smart", name);
      layers.push(L2);
    });
  }

  // A folder closes the group opened by its divider (wave PS-4): it
  // becomes a group, { name, vis, op, bl, open, p } in groups, with
  // L.g = its index on the layers inside and p on the groups inside.
  // A group mask has no place in Photo Lab: it goes onto the layers.
  function closeGroup(bytes, f, r, layers, groups, from) {
    var name = cleanText(r.name), key = r.gblend || r.key;
    var bl = key === "pass" ? "pass" : KEYS[key];
    if (!bl) { note(f, "groupBlend", name); bl = "pass"; }
    if ((r.info.lfx2 || r.info.lmfx)) note(f, "groupFx", name);
    var op = r.op;
    if (r.fill != null && r.fill < 255) op = op * r.fill / 255;
    var gi = groups.length;
    groups.push({ name: name, vis: (r.flags & 2) ? 0 : 1, op: Math.round(op / 255 * 100), bl: bl, open: r.section === 1 ? 1 : 0 });
    for (var q = from.g; q < gi; q++) if (groups[q].p == null) groups[q].p = gi;
    for (var g = from.at; g < layers.length; g++) if (layers[g].g == null) layers[g].g = gi;
    return planesOf(bytes, f, r, [-3, -2]).then(function (planes) {
      var gm = mulMasks(userMask(r, planes), vectorMask(f, r));
      if (!gm || !gm.on) return;
      note(f, "groups", name);
      for (var g = from.at; g < layers.length; g++) {
        var L = layers[g];
        if (L.k === "adj") { L.mk = mulMasks(L.mk, gm); continue; }
        bakeMask(L, gm);
      }
    });
  }
  // The mask multiplies the layer's alpha (Photo Lab layers keep one mask).
  function bakeMask(L, m) {
    var d = L.img.data, w = L.img.w;
    for (var y = 0; y < L.img.h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4 + 3;
      d[i] = Math.round(d[i] * maskAt(m, L.x + x, L.y + y) / 255);
    }
  }
  function alphaAt(L, x, y) {
    var gx = x - L.x, gy = y - L.y;
    if (gx < 0 || gy < 0 || gx >= L.img.w || gy >= L.img.h) return 0;
    var a = L.img.data[(gy * L.img.w + gx) * 4 + 3];
    return L.mk && L.mk.on ? Math.round(a * maskAt(L.mk, x, y) / 255) : a;
  }
  // Clipping masks (Photo Lab has none): a clipped picture keeps only
  // what lies over its base layer; a clipped adjustment is applied to
  // the base layer's pixels, so the picture looks the same.
  function clipBake(layers, f) {
    var A = adjuster();
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L.clip) continue;
      var b = i - 1;
      while (b >= 0 && layers[b].clip) b--;
      var B = b >= 0 ? layers[b] : null;
      if (!B || B.k === "adj") { note(f, "clipLost", L.name); continue; }
      if (!B.vis) L.vis = 0;
      if (L.k === "adj") {
        if (!A || !L.vis) { if (!A) note(f, "clipLost", L.name); layers.splice(i, 1); i--; continue; }
        var before = new Uint8ClampedArray(B.img.data), img = { w: B.img.w, h: B.img.h, data: new Uint8ClampedArray(B.img.data) };
        A.run(img, L.aj.id, L.aj.p);
        var k = L.op / 100, d = B.img.data;
        for (var y = 0; y < B.img.h; y++) for (var x = 0; x < B.img.w; x++) {
          var m = L.mk && L.mk.on ? maskAt(L.mk, B.x + x, B.y + y) / 255 * k : k, j = (y * B.img.w + x) * 4;
          for (var c = 0; c < 3; c++) d[j + c] = Math.round(before[j + c] + (img.data[j + c] - before[j + c]) * m);
        }
        note(f, "clipAdj", L.name);
        layers.splice(i, 1); i--;
        continue;
      }
      var a = L.img.data, w = L.img.w;
      for (var yy = 0; yy < L.img.h; yy++) for (var xx = 0; xx < w; xx++) {
        var q = (yy * w + xx) * 4 + 3;
        a[q] = Math.round(a[q] * alphaAt(B, L.x + xx, L.y + yy) / 255);
      }
      note(f, "clip", L.name);
    }
  }
  function adjuster() {
    if (root.PhotoLab && root.PhotoLab.adjust) return root.PhotoLab.adjust;
    if (typeof require === "function") { try { return require("./adjust.js"); } catch (e) {} }
    return null;
  }

  // ---------- Writing ----------
  function Writer() { this.parts = []; this.n = 0; }
  Writer.prototype.bytes = function (b) { this.parts.push(b); this.n += b.length; };
  Writer.prototype.u8 = function (v) { this.bytes(new Uint8Array([v & 255])); };
  Writer.prototype.u16 = function (v) { this.bytes(new Uint8Array([(v >> 8) & 255, v & 255])); };
  Writer.prototype.u32 = function (v) { v = v >>> 0; this.bytes(new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])); };
  Writer.prototype.i32 = function (v) { this.u32(v < 0 ? v + 4294967296 : v); };
  Writer.prototype.str = function (s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; this.bytes(b); };
  Writer.prototype.out = function () {
    var o = new Uint8Array(this.n), p = 0;
    this.parts.forEach(function (b) { o.set(b, p); p += b.length; });
    return o;
  };

  // PackBits one row of src[s .. s+n) into out at o; returns the new o.
  // out needs room for n + ceil(n / 128) bytes.
  function packRow(src, s, n, out, o) {
    var i = 0;
    while (i < n) {
      var j = i + 1;
      while (j < n && j - i < 128 && src[s + j] === src[s + i]) j++;
      if (j - i >= 3 || (j - i === 2 && j === n)) {
        out[o++] = 257 - (j - i); out[o++] = src[s + i]; i = j; continue;
      }
      var k = i;
      while (k < n && k - i < 128 && !(k + 2 < n && src[s + k] === src[s + k + 1] && src[s + k] === src[s + k + 2])) k++;
      if (k === i) k = i + 1;
      out[o++] = k - i - 1;
      for (var q = i; q < k; q++) out[o++] = src[s + q];
      i = k;
    }
    return o;
  }
  // One RLE plane: { counts: [bytes per row], data: Uint8Array }.
  function packPlane(plane, w, h) {
    var buf = new Uint8Array(h * (w + Math.ceil(w / 128))), counts = [], o = 0;
    for (var y = 0; y < h; y++) {
      var o2 = packRow(plane, y * w, w, buf, o);
      counts.push(o2 - o); o = o2;
    }
    return { counts: counts, data: buf.subarray(0, o) };
  }
  function planeOf(img, c) {
    var n = img.w * img.h, p = new Uint8Array(n);
    for (var i = 0; i < n; i++) p[i] = img.data[i * 4 + c];
    return p;
  }
  function chunk(plane, wd, ht) {                 // compression word + RLE counts + data
    var pk = packPlane(plane, wd, ht), b = new Writer();
    b.u16(1);
    var cb = new Uint8Array(pk.counts.length * 2);
    pk.counts.forEach(function (c, i) { cb[i * 2] = c >> 8; cb[i * 2 + 1] = c & 255; });
    b.bytes(cb); b.bytes(pk.data);
    return b.out();
  }
  function pascal(name) {
    var s = String(name || "").replace(/[^\x20-\x7e]/g, "?").slice(0, 255);
    var pad = (4 - ((s.length + 1) % 4)) % 4, b = new Writer();
    b.u8(s.length); b.str(s); for (var i = 0; i < pad; i++) b.u8(0);
    return b.out();
  }
  function luni(name) {
    var s = String(name || ""), b = new Writer();
    b.str("8BIM"); b.str("luni");
    var len = 4 + s.length * 2 + (s.length % 2 ? 2 : 0);
    b.u32(len); b.u32(s.length);
    for (var i = 0; i < s.length; i++) b.u16(s.charCodeAt(i));
    if (s.length % 2) b.u16(0);
    return b.out();
  }

  // Layers bottom → top with the folder records Photoshop expects
  // around each group: a divider below its layers, the folder above.
  // A group split by other layers is written as two folders.
  function withFolders(layers, groups) {
    var out = [], open = [];
    function path(gi) {
      var p = [], n = 0;
      for (var i = gi; i != null && groups[i] && n < 64; i = groups[i].p, n++) p.unshift(i);
      return p;
    }
    function close(to) { while (open.length > to) out.push({ folder: 1, G: groups[open.pop()] }); }
    layers.forEach(function (L) {
      var p = L.g != null ? path(L.g) : [], i = 0;
      while (i < open.length && i < p.length && open[i] === p[i]) i++;
      close(i);
      for (; i < p.length; i++) { out.push({ folder: 3 }); open.push(p[i]); }
      out.push(L);
    });
    close(0);
    return out;
  }
  // A divider (section 3) or a folder record (1 open, 2 closed): no
  // pixels, four empty raw channels.
  function folder(recs, chans, F) {
    var G = F.G || {}, div = F.folder === 3, bl = div ? "norm" : G.bl === "pass" ? "pass" : IDS[G.bl] || "norm";
    recs.i32(0); recs.i32(0); recs.i32(0); recs.i32(0);
    recs.u16(4);
    [-1, 0, 1, 2].forEach(function (id) { recs.u16(id & 0xffff); recs.u32(2); });
    recs.str("8BIM"); recs.str(bl);
    recs.u8(div ? 255 : Math.round(Math.max(0, Math.min(100, G.op == null ? 100 : G.op)) * 2.55));
    recs.u8(0); recs.u8(!div && G.vis === 0 ? 2 : 0); recs.u8(0);
    var name = div ? "</Layer group>" : G.name, nm = pascal(name), un = luni(name);
    recs.u32(4 + 4 + nm.length + un.length + 24);
    recs.u32(0); recs.u32(0);
    recs.bytes(nm); recs.bytes(un);
    recs.str("8BIM"); recs.str("lsct"); recs.u32(12);
    recs.u32(div ? 3 : G.open ? 1 : 2); recs.str("8BIM"); recs.str(bl);
    for (var c = 0; c < 4; c++) chans.bytes(new Uint8Array([0, 0]));
  }

  function write(doc) {
    var W = new Writer(), w = doc.w, h = doc.h;
    W.str("8BPS"); W.u16(1); W.bytes(new Uint8Array(6));
    W.u16(4); W.u32(h); W.u32(w); W.u16(8); W.u16(3);
    W.u32(0);                                        // colour mode data
    W.u32(0);                                        // image resources

    var recs = new Writer(), chans = new Writer();
    var list = withFolders(doc.layers || [], doc.groups || []);
    recs.u16(list.length);
    list.forEach(function (L) {
      if (L.folder) { folder(recs, chans, L); return; }
      var img = L.img, mk = L.mk && L.mk.img && L.mk.img.w && L.mk.img.h ? L.mk : null;
      var ids = mk ? [-1, 0, 1, 2, -2] : [-1, 0, 1, 2];
      var data = ids.map(function (id) {
        if (id === -2) return chunk(mk.img.data, mk.img.w, mk.img.h);
        return img.w && img.h ? chunk(planeOf(img, id < 0 ? 3 : id), img.w, img.h) : new Uint8Array([0, 0]);
      });
      recs.i32(L.y); recs.i32(L.x); recs.i32(L.y + img.h); recs.i32(L.x + img.w);
      recs.u16(ids.length);
      ids.forEach(function (id, i) { recs.u16(id & 0xffff); recs.u32(data[i].length); });
      recs.str("8BIM"); recs.str(IDS[L.bl] || "norm");
      recs.u8(Math.round(Math.max(0, Math.min(100, L.op == null ? 100 : L.op)) * 2.55));
      recs.u8(0); recs.u8(L.vis === 0 ? 2 : 0); recs.u8(0);
      var nm = pascal(L.name), un = luni(L.name);
      recs.u32(4 + (mk ? 20 : 0) + 4 + nm.length + un.length);
      if (mk) {                                      // the layer mask: its box, colour outside it, on/off
        recs.u32(20);
        recs.i32(mk.y); recs.i32(mk.x); recs.i32(mk.y + mk.img.h); recs.i32(mk.x + mk.img.w);
        recs.u8(mk.bg ? 255 : 0); recs.u8(mk.on === 0 ? 2 : 0); recs.u16(0);
      } else recs.u32(0);
      recs.u32(0);                                   // no blending ranges
      recs.bytes(nm); recs.bytes(un);
      data.forEach(function (d) { chans.bytes(d); });
    });
    var li = recs.out(), ch = chans.out();
    var liLen = li.length + ch.length; if (liLen % 2) liLen++;
    W.u32(4 + liLen + 4);                            // layer and mask info
    W.u32(liLen); W.bytes(li); W.bytes(ch); if ((li.length + ch.length) % 2) W.u8(0);
    W.u32(0);                                        // global layer mask info

    // Merged picture, RLE: all row counts first, then the data.
    var m = doc.merged, packs = [0, 1, 2, 3].map(function (c) { return packPlane(planeOf(m, c), w, h); });
    W.u16(1);
    packs.forEach(function (p) {
      var cb = new Uint8Array(p.counts.length * 2);
      p.counts.forEach(function (c, i) { cb[i * 2] = c >> 8; cb[i * 2 + 1] = c & 255; });
      W.bytes(cb);
    });
    packs.forEach(function (p) { W.bytes(p.data); });
    return W.out();
  }

  var API = { read: read, write: write, KEYS: KEYS, packRow: packRow, unpack: unpack };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.psd = API; }
})(typeof window !== "undefined" ? window : this);
