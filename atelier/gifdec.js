// ============================================================
// orOS Atelier — gifdec.js: animated GIF reader (v1.0.0, wave CV-A)
// A moving GIF (a Canva sticker, a GIF in a PowerPoint) plays in the
// design as it does in Canva: the photo shows its first frame (the
// poster, what pictures, PDF and print show) and ext.gif names the GIF
// itself, kept once on the orOS disk like a video clip (clips.js).
// Play, Present, video and GIF export draw the frame of the moment.
// Pure (no DOM): decode(bytes) → { w, h, fw, fh, frames: [{ rgba,
// delay }], dur }: every frame composed onto the full canvas, kept at
// fw × fh (w × h unless all frames together pass MAX_PIXELS: then
// smaller, so a long GIF never takes much memory) (disposal and
// transparency as the GIF89a spec says); frameAt(gif, t) → the index
// shown t seconds in (the GIF loops). Nothing in the file is run; a
// broken or oversized file throws.
// Exposes window.AtelierGifDec (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_FRAMES = 600, MAX_PIXELS = 32 * 1024 * 1024;   // all frames kept together (smaller frames past it)
  var MIN_DELAY = 0.02, SLOW_DELAY = 0.1;                // browsers' rule: ≤ 10 ms plays at 100 ms

  function bad() { return new Error("gif"); }

  function isGif(b) {
    return !!b && b.length >= 13 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
  }

  // LZW data of one image → colour indices (n of them)
  function lzw(data, minSize, n) {
    var out = new Uint8Array(n), op = 0;
    var clear = 1 << minSize, eoi = clear + 1;
    var size = minSize + 1, mask = (1 << size) - 1, next = eoi + 1;
    var prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    for (var i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
    var bits = 0, acc = 0, pos = 0, old = -1, first = 0;
    while (op < n) {
      while (bits < size) {
        if (pos >= data.length) return out;     // short data: the rest stays index 0
        acc |= data[pos++] << bits; bits += 8;
      }
      var code = acc & mask;
      acc >>>= size; bits -= size;
      if (code === clear) { size = minSize + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) break;
      if (old === -1) {
        if (code >= clear) throw bad();
        out[op++] = code; old = code; first = code;
        continue;
      }
      var cur = code, sp = 0;
      if (code >= next) {
        if (code > next) throw bad();
        stack[sp++] = first; cur = old;
      }
      while (cur >= clear) {
        if (sp >= 4096) throw bad();
        stack[sp++] = suffix[cur]; cur = prefix[cur];
      }
      first = cur;
      stack[sp++] = cur;
      while (sp && op < n) out[op++] = stack[--sp];
      if (next < 4096) {
        prefix[next] = old; suffix[next] = first; next++;
        if (next > mask && size < 12) { size++; mask = (1 << size) - 1; }
      }
      old = code;
    }
    return out;
  }

  function decode(b) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    if (!isGif(b)) throw bad();
    var p = 6;
    function u16() { var v = b[p] | (b[p + 1] << 8); p += 2; return v; }
    function need(k) { if (p + k > b.length) throw bad(); }
    var W = u16(), H = u16();
    if (!W || !H || W > 4096 || H > 4096) throw bad();
    var flags = b[p++], bgIndex = b[p++]; p++;
    var gct = null;
    if (flags & 0x80) {
      var gn = 3 * (1 << ((flags & 7) + 1));
      need(gn); gct = b.subarray(p, p + gn); p += gn;
    }
    var count = countFrames(b, p);
    if (!count) throw bad();
    count = Math.min(count, MAX_FRAMES);
    var k = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H * count)));
    var FW = Math.max(1, Math.round(W * k)), FH = Math.max(1, Math.round(H * k));
    var frames = [], canvas = new Uint8ClampedArray(W * H * 4), prev = null;
    var gce = { delay: 0, disp: 0, trans: -1 };
    while (p < b.length) {
      var block = b[p++];
      if (block === 0x3b) break;                       // trailer
      if (block === 0x21) {                            // extension
        need(1);
        var label = b[p++];
        if (label === 0xf9 && b[p] >= 4) {
          need(6);
          var pf = b[p + 1];
          gce = { disp: (pf >> 2) & 7, delay: (b[p + 2] | (b[p + 3] << 8)) / 100, trans: pf & 1 ? b[p + 4] : -1 };
        }
        while (p < b.length && b[p]) p += b[p] + 1;    // sub-blocks
        p++;
        continue;
      }
      if (block !== 0x2c) throw bad();
      need(9);
      var fx = u16(), fy = u16(), fw = u16(), fh = u16(), ff = b[p++];
      var lct = gct;
      if (ff & 0x80) {
        var ln = 3 * (1 << ((ff & 7) + 1));
        need(ln); lct = b.subarray(p, p + ln); p += ln;
      }
      if (!lct) throw bad();
      need(1);
      var minSize = b[p++];
      if (minSize < 2 || minSize > 11) throw bad();
      // gather the sub-blocks
      var start = p, total = 0;
      while (p < b.length && b[p]) { total += b[p]; p += b[p] + 1; }
      p++;
      var data = new Uint8Array(total), q = 0, r = start;
      while (r < b.length && b[r]) { data.set(b.subarray(r + 1, r + 1 + b[r]), q); q += b[r]; r += b[r] + 1; }
      if (frames.length >= MAX_FRAMES) break;
      var idx = lzw(data, minSize, fw * fh);
      if (ff & 0x40) idx = deinterlace(idx, fw, fh);
      if (gce.disp === 3) prev = canvas.slice();
      for (var y = 0; y < fh; y++) {
        var cy = fy + y;
        if (cy >= H) break;
        for (var x = 0; x < fw; x++) {
          var cx = fx + x;
          if (cx >= W) break;
          var ci = idx[y * fw + x];
          if (ci === gce.trans || ci * 3 + 2 >= lct.length) continue;
          var o = (cy * W + cx) * 4;
          canvas[o] = lct[ci * 3]; canvas[o + 1] = lct[ci * 3 + 1]; canvas[o + 2] = lct[ci * 3 + 2]; canvas[o + 3] = 255;
        }
      }
      var d = gce.delay;
      frames.push({ rgba: FW === W && FH === H ? canvas.slice() : shrink(canvas, W, H, FW, FH), delay: d < MIN_DELAY ? SLOW_DELAY : d });
      // what comes after this frame
      if (gce.disp === 2) {
        for (var yy = fy; yy < Math.min(H, fy + fh); yy++) canvas.fill(0, (yy * W + fx) * 4, (yy * W + Math.min(W, fx + fw)) * 4);
      } else if (gce.disp === 3 && prev) canvas = prev;
      gce = { delay: 0, disp: 0, trans: -1 };
    }
    if (!frames.length) throw bad();
    void bgIndex;
    var dur = 0;
    frames.forEach(function (f) { dur += f.delay; });
    return { w: W, h: H, fw: FW, fh: FH, frames: frames, dur: Math.round(dur * 1000) / 1000 };
  }

  // image descriptors from p on (skips every data block)
  function countFrames(b, p) {
    var n = 0;
    while (p < b.length) {
      var block = b[p++];
      if (block === 0x3b) break;
      if (block === 0x21) { p++; while (p < b.length && b[p]) p += b[p] + 1; p++; continue; }
      if (block !== 0x2c || p + 9 > b.length) break;
      var ff = b[p + 8];
      p += 9;
      if (ff & 0x80) p += 3 * (1 << ((ff & 7) + 1));
      p++;
      while (p < b.length && b[p]) p += b[p] + 1;
      p++;
      n++;
    }
    return n;
  }
  // a composed frame at fw × fh (box average, alpha-weighted)
  function shrink(src, W, H, fw, fh) {
    var out = new Uint8ClampedArray(fw * fh * 4);
    for (var y = 0; y < fh; y++) {
      var y0 = Math.floor(y * H / fh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / fh));
      for (var x = 0; x < fw; x++) {
        var x0 = Math.floor(x * W / fw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / fw));
        var r = 0, g = 0, bl = 0, a = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) {
          var o = (yy * W + xx) * 4, al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; bl += src[o + 2] * al; a += al; n++;
        }
        var q = (y * fw + x) * 4;
        if (a) { out[q] = r / a; out[q + 1] = g / a; out[q + 2] = bl / a; out[q + 3] = a / n; }
      }
    }
    return out;
  }

  function deinterlace(idx, w, h) {
    var out = new Uint8Array(idx.length), row = 0;
    [[0, 8], [4, 8], [2, 4], [1, 2]].forEach(function (pass) {
      for (var y = pass[0]; y < h; y += pass[1]) { out.set(idx.subarray(row * w, row * w + w), y * w); row++; }
    });
    return out;
  }

  // the frame t seconds in (looping)
  function frameAt(gif, t) {
    var n = gif.frames.length;
    if (n < 2 || !(gif.dur > 0)) return 0;
    t = ((Number(t) || 0) % gif.dur + gif.dur) % gif.dur;
    for (var i = 0; i < n; i++) { t -= gif.frames[i].delay; if (t < 0) return i; }
    return n - 1;
  }
  // how many frames a GIF holds, without decoding the pictures
  function frameCount(b) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    if (!isGif(b)) return 0;
    var flags = b[10], p = 13;
    if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
    return countFrames(b, p);
  }

  var api = { decode: decode, frameAt: frameAt, frameCount: frameCount, isGif: isGif, MAX_FRAMES: MAX_FRAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierGifDec = api;
})(typeof window !== "undefined" ? window : this);
