// ============================================================
// orOS Atelier — gif.js: animated GIF encoder (v1.0.0)
// Small and dependency-free: one fixed 252-colour palette (6 red ×
// 7 green × 6 blue levels) with ordered (Bayer) dithering, LZW per
// frame, frames that did not change are merged into the previous
// one's delay. Good enough for social posts; MP4 / WebM is the
// sharp option.
// Pure: no DOM. Exposes window.AtelierGif (browser) or module.exports.
//   quantize(rgba, w, h) → Uint8Array of palette indices
//   encode({ w, h, frames: [{ idx, delay (1/100 s) }], loop }) → Uint8Array
// ============================================================
(function (root) {
  "use strict";

  var R = 6, G = 7, B = 6;
  var PALETTE = new Uint8Array(256 * 3);
  (function () {
    var n = 0;
    for (var r = 0; r < R; r++) for (var g = 0; g < G; g++) for (var b = 0; b < B; b++) {
      PALETTE[n * 3] = Math.round(r * 255 / (R - 1));
      PALETTE[n * 3 + 1] = Math.round(g * 255 / (G - 1));
      PALETTE[n * 3 + 2] = Math.round(b * 255 / (B - 1));
      n++;
    }
  })();
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function quantize(rgba, w, h) {
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i * 4;
        var d = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;   // −0.5..0.5 of a step
        var a = rgba[o + 3] / 255;                                  // over white
        var r = rgba[o] * a + 255 * (1 - a), g = rgba[o + 1] * a + 255 * (1 - a), b = rgba[o + 2] * a + 255 * (1 - a);
        var ri = Math.max(0, Math.min(R - 1, Math.round(r * (R - 1) / 255 + d)));
        var gi = Math.max(0, Math.min(G - 1, Math.round(g * (G - 1) / 255 + d)));
        var bi = Math.max(0, Math.min(B - 1, Math.round(b * (B - 1) / 255 + d)));
        out[i] = (ri * G + gi) * B + bi;
      }
    }
    return out;
  }

  function Bytes() { this.a = []; }
  Bytes.prototype.b = function (v) { this.a.push(v & 255); };
  Bytes.prototype.w = function (v) { this.a.push(v & 255, (v >> 8) & 255); };
  Bytes.prototype.s = function (str) { for (var i = 0; i < str.length; i++) this.a.push(str.charCodeAt(i)); };

  // LZW (GIF flavour, 8-bit codes, variable code size up to 12)
  function lzw(idx, out) {
    var MIN = 8, CLEAR = 256, EOI = 257;
    out.b(MIN);
    var buf = [], cur = 0, nbits = 0;
    function emit(code, size) {
      cur |= code << nbits; nbits += size;
      while (nbits >= 8) { buf.push(cur & 255); cur >>>= 8; nbits -= 8; }
    }
    var dict = new Map(), next = 258, size = 9;
    emit(CLEAR, size);
    var prefix = idx.length ? idx[0] : 0;
    for (var i = 1; i < idx.length; i++) {
      var k = idx[i], key = prefix * 256 + k;
      var hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix, size);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << size) && size < 12) size++;
      } else {
        emit(CLEAR, size);
        dict.clear(); next = 258; size = 9;
      }
      prefix = k;
    }
    if (idx.length) emit(prefix, size);
    emit(EOI, size);
    if (nbits > 0) buf.push(cur & 255);
    for (var p = 0; p < buf.length; p += 255) {
      var n = Math.min(255, buf.length - p);
      out.b(n);
      for (var j = 0; j < n; j++) out.b(buf[p + j]);
    }
    out.b(0);
  }

  function same(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function encode(o) {
    var w = o.w, h = o.h, out = new Bytes();
    // merge unchanged frames
    var frames = [];
    (o.frames || []).forEach(function (f) {
      var last = frames[frames.length - 1];
      if (last && same(last.idx, f.idx) && last.delay + f.delay < 65000) last.delay += f.delay;
      else frames.push({ idx: f.idx, delay: f.delay });
    });
    out.s("GIF89a");
    out.w(w); out.w(h);
    out.b(0xF7); out.b(0); out.b(0);                 // global table, 256 entries
    for (var i = 0; i < 768; i++) out.b(PALETTE[i]);
    out.b(0x21); out.b(0xFF); out.b(11); out.s("NETSCAPE2.0"); out.b(3); out.b(1); out.w(o.loop || 0); out.b(0);
    frames.forEach(function (f) {
      out.b(0x21); out.b(0xF9); out.b(4); out.b(0); out.w(Math.max(2, Math.round(f.delay))); out.b(0); out.b(0);
      out.b(0x2C); out.w(0); out.w(0); out.w(w); out.w(h); out.b(0);
      lzw(f.idx, out);
    });
    out.b(0x3B);
    return new Uint8Array(out.a);
  }

  var api = { quantize: quantize, encode: encode, PALETTE: PALETTE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierGif = api;
})(typeof window !== "undefined" ? window : this);
