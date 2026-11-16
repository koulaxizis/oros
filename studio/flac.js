// ============================================================
// orOS Studio — FLAC encoder (v1.0.0, Studio wave A2)
// Pure code, no DOM. Lossless: the decoded samples are the very same
// integers that went in (tests/studio-flac.test.js decodes them again).
// What it writes (FLAC format, RFC 9639):
//   - "fLaC", STREAMINFO (with the MD5 of the samples) and a
//     VORBIS_COMMENT block (vendor, optional TITLE / ARTIST / ALBUM …);
//   - fixed-blocksize frames of 4096 samples, 16 or 24 bit, mono or
//     stereo, 1 Hz to 655350 Hz;
//   - per channel the cheapest of CONSTANT, VERBATIM, the FIXED
//     predictors of order 0-4 and LPC of order 4, 8 or 12 (Tukey(0.5)
//     window, Levinson-Durbin, 14/15-bit coefficients) with Rice-coded
//     residuals (partition order 0-8, 5-bit parameters); stereo picks the cheapest of left/right,
//     left/side, right/side and mid/side.
// Use: var enc = new StudioFlac.Encoder(chans, rate, 24, { title: "…" });
//      while (!enc.step(16)) …; enc.bytes() → Uint8Array
//      (chans: Float32Array per channel, -1..1; or StudioFlac.encode(…)).
// Loaded by studio.js (window.StudioFlac) and by the tests.
// ============================================================
(function (root) {
  "use strict";

  var BLOCK = 4096;
  var MAX_PART = 8;

  // ---------- bits ----------
  function BitWriter(size) { this.buf = new Uint8Array(size || 65536); this.pos = 0; this.acc = 0; this.n = 0; }
  BitWriter.prototype.grow = function (need) {
    if (this.pos + need <= this.buf.length) return;
    var b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + need + 1024));
    b.set(this.buf.subarray(0, this.pos)); this.buf = b;
  };
  // value < 2^bits, bits ≤ 32 (integer ops: at most 7 bits wait in acc)
  BitWriter.prototype.put = function (value, bits) {
    if (bits > 24) { this.put(Math.floor(value / 16777216) >>> 0, bits - 24); value = value % 16777216; bits = 24; }
    if (this.pos + 4 > this.buf.length) this.grow(4);
    var acc = (this.acc << bits) | value, n = this.n + bits, buf = this.buf;
    while (n >= 8) { n -= 8; buf[this.pos++] = (acc >>> n) & 255; }
    this.acc = acc & ((1 << n) - 1); this.n = n;
  };
  BitWriter.prototype.zeros = function (k) {         // k zero bits (unary prefix)
    while (k >= 24) { this.put(0, 24); k -= 24; }
    if (k) this.put(0, k);
  };
  BitWriter.prototype.align = function () { if (this.n) this.put(0, 8 - this.n); };
  BitWriter.prototype.bytes = function () { return this.buf.subarray(0, this.pos); };

  // ---------- checks ----------
  var CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
      CRC8[i] = c;
      var d = i << 8;
      for (var j = 0; j < 8; j++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
      CRC16[i] = d;
    }
  })();
  function crc8(b, a, e) { var c = 0; for (var i = a; i < e; i++) c = CRC8[c ^ b[i]]; return c; }
  function crc16(b, a, e) { var c = 0; for (var i = a; i < e; i++) c = ((c << 8) ^ CRC16[(c >> 8) ^ b[i]]) & 0xffff; return c; }

  // MD5 (RFC 1321), fed in pieces
  var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
               4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var MD5_K = new Int32Array(64);
  (function () { for (var i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0; })();
  function Md5() { this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]); this.blk = new Uint8Array(64); this.bn = 0; this.len = 0; this.w = new Int32Array(16); }
  Md5.prototype.block = function (b) {
    var w = this.w, h = this.h;
    for (var i = 0; i < 16; i++) w[i] = b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24);
    var a = h[0], bb = h[1], c = h[2], d = h[3];
    for (var j = 0; j < 64; j++) {
      var f, g;
      if (j < 16) { f = (bb & c) | (~bb & d); g = j; }
      else if (j < 32) { f = (d & bb) | (~d & c); g = (5 * j + 1) & 15; }
      else if (j < 48) { f = bb ^ c ^ d; g = (3 * j + 5) & 15; }
      else { f = c ^ (bb | ~d); g = (7 * j) & 15; }
      var tmp = d; d = c; c = bb;
      var x = (a + f + MD5_K[j] + w[g]) | 0;
      bb = (bb + ((x << MD5_S[j]) | (x >>> (32 - MD5_S[j])))) | 0;
      a = tmp;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  };
  Md5.prototype.byte = function (v) {
    this.blk[this.bn++] = v;
    if (this.bn === 64) { this.block(this.blk); this.bn = 0; }
    this.len++;
  };
  Md5.prototype.digest = function () {
    var bits = this.len * 8;
    this.byte(0x80);
    while (this.bn !== 56) this.byte(0);
    for (var i = 0; i < 8; i++) this.byte(Math.floor(bits / Math.pow(2, 8 * i)) & 255);
    var out = new Uint8Array(16);
    for (var k = 0; k < 4; k++) for (var j = 0; j < 4; j++) out[k * 4 + j] = (this.h[k] >>> (8 * j)) & 255;
    return out;
  };

  // ---------- residuals ----------
  // fixed predictor residuals of order 0..4 (exact integers)
  function fixedResidual(x, n, order, out) {
    var i;
    for (i = 0; i < order; i++) out[i] = 0;
    if (order === 0) for (i = 0; i < n; i++) out[i] = x[i];
    else if (order === 1) for (i = 1; i < n; i++) out[i] = x[i] - x[i - 1];
    else if (order === 2) for (i = 2; i < n; i++) out[i] = x[i] - 2 * x[i - 1] + x[i - 2];
    else if (order === 3) for (i = 3; i < n; i++) out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3];
    else for (i = 4; i < n; i++) out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
  }
  function zig(v) { return v >= 0 ? 2 * v : -2 * v - 1; }
  // estimated bits of one Rice partition (cnt values summing to sum) with
  // parameter k: the unary parts add up to at most sum / 2^k
  function riceBits(sum, cnt, k) { return cnt * (k + 1) + Math.floor(sum / Math.pow(2, k)); }
  function bestK(sum, cnt) {
    if (!cnt) return { k: 0, bits: 0 };
    var guess = sum > cnt ? Math.floor(Math.log2(sum / cnt)) : 0, best = null;
    for (var k = Math.max(0, guess - 1); k <= Math.min(30, guess + 1); k++) {
      var bits = riceBits(sum, cnt, k);
      if (!best || bits < best.bits) best = { k: k, bits: bits };
    }
    return best;
  }
  // the cheapest partitioning of u (the first `order` values are warm-up):
  // sums of the finest partitions once, then merged upwards
  var PSUM = new Float64Array(1 << MAX_PART);
  function bestPartition(u, n, order) {
    var top = 0;
    while (top < MAX_PART && n % (2 << top) === 0 && (n >> (top + 1)) > order) top++;
    var parts = 1 << top, size = n >> top, sums = PSUM, best = null;
    for (var p = 0; p < parts; p++) {
      var sm = 0;
      for (var i = p === 0 ? order : p * size, e = (p + 1) * size; i < e; i++) sm += u[i];
      sums[p] = sm;
    }
    for (var po = top; po >= 0; po--) {
      var np = 1 << po, sz = n >> po, bits = 0, ks = [];
      for (var q = 0; q < np; q++) {
        var r = bestK(sums[q], q === 0 ? sz - order : sz);
        bits += 5 + r.bits; ks.push(r.k);
      }
      if (!best || bits < best.bits) best = { po: po, ks: ks, bits: bits };
      for (var m = 0; m < np / 2; m++) sums[m] = sums[2 * m] + sums[2 * m + 1];
    }
    return best;
  }
  // ---------- LPC ----------
  var LPC_ORDERS = [4, 8, 12];
  var WIN = {};                                   // Tukey(0.5) windows by length
  function tukey(n) {
    if (WIN[n]) return WIN[n];
    var w = new Float64Array(n), m = Math.floor(0.25 * n);
    for (var i = 0; i < n; i++) {
      w[i] = i < m ? 0.5 - 0.5 * Math.cos(Math.PI * i / m) : i >= n - m ? 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / m) : 1;
    }
    return (WIN[n] = w);
  }
  // Levinson-Durbin on the windowed autocorrelation → coefficients per order (1..max)
  function lpcCoefs(x, n, max) {
    var w = tukey(n), xw = new Float64Array(n), ac = new Float64Array(max + 1), i, j;
    for (i = 0; i < n; i++) xw[i] = x[i] * w[i];
    for (var l = 0; l <= max; l++) { var sm = 0; for (i = l; i < n; i++) sm += xw[i] * xw[i - l]; ac[l] = sm; }
    if (!(ac[0] > 0)) return null;
    ac[0] *= 1 + 1e-9;
    var lpc = [], a = new Float64Array(max), err = ac[0];
    for (i = 0; i < max; i++) {
      var r = -ac[i + 1];
      for (j = 0; j < i; j++) r -= a[j] * ac[i - j];
      r /= err;
      a[i] = r;
      for (j = 0; j < (i >> 1); j++) { var tmp = a[j]; a[j] += r * a[i - 1 - j]; a[i - 1 - j] += r * tmp; }
      if (i & 1) a[j] += a[j] * r;
      err *= 1 - r * r;
      if (!(err > 0)) break;
      var c = new Float64Array(i + 1);
      for (j = 0; j <= i; j++) c[j] = -a[j];        // x[n] ≈ Σ c[j] x[n-1-j]
      lpc.push(c);
    }
    return lpc;
  }
  // quantised coefficients (precision bits with sign) and a shift ≥ 0, or null
  function quantLpc(c, precision) {
    var cmax = 0, i;
    for (i = 0; i < c.length; i++) cmax = Math.max(cmax, Math.abs(c[i]));
    if (!(cmax > 0) || !isFinite(cmax)) return null;
    var p = precision - 1, qmax = (1 << p) - 1, qmin = -(1 << p);
    var shift = Math.min(15, p - (Math.floor(Math.log2(cmax)) + 1));
    if (shift < 0) return null;
    var q = new Int32Array(c.length), e = 0, sc = Math.pow(2, shift);
    for (i = 0; i < c.length; i++) {
      e += c[i] * sc;
      var v = Math.round(e);
      v = v > qmax ? qmax : v < qmin ? qmin : v;
      q[i] = v; e -= v;
    }
    return { q: q, shift: shift, prec: precision };
  }
  // exact integer residual (products stay below 2^53); false when one is too big
  function lpcResidual(x, n, ql, out) {
    var q = ql.q, ord = q.length, d = Math.pow(2, ql.shift), lim = 1073741823;
    for (var i = 0; i < ord; i++) out[i] = 0;
    for (var k = ord; k < n; k++) {
      var sm = 0;
      for (var j = 0; j < ord; j++) sm += q[j] * x[k - 1 - j];
      var r = x[k] - Math.floor(sm / d);
      if (r > lim || r < -lim) return false;
      out[k] = r;
    }
    return true;
  }

  // one channel's subframe plan: { type, order, res, part, bits }
  function planSubframe(x, n, bps, work) {
    var first = x[0], same = true;
    for (var i = 1; i < n; i++) if (x[i] !== first) { same = false; break; }
    if (same) return { type: "const", bits: 8 + bps };
    var best = { type: "verbatim", bits: 8 + n * bps };
    for (var o = 0; o <= 4 && o < n; o++) {
      var r = work.res[o], u = work.u[o];
      fixedResidual(x, n, o, r);
      for (var j = 0; j < n; j++) u[j] = zig(r[j]);
      var pt = bestPartition(u, n, o);
      if (!pt) continue;
      var bits = 8 + o * bps + 2 + 4 + pt.bits;
      if (bits < best.bits) best = { type: "fixed", order: o, res: r, u: u, part: pt, bits: bits };
    }
    if (n > 32) {
      var lp = lpcCoefs(x, n, LPC_ORDERS[LPC_ORDERS.length - 1]), prec = bps > 16 ? 15 : 14;
      LPC_ORDERS.forEach(function (ord, k) {
        if (!lp || ord > lp.length || ord >= n) return;
        var ql = quantLpc(lp[ord - 1], prec), r2 = work.res[5 + k], u2 = work.u[5 + k];
        if (!ql || !lpcResidual(x, n, ql, r2)) return;
        for (var j2 = 0; j2 < n; j2++) u2[j2] = zig(r2[j2]);
        var pt2 = bestPartition(u2, n, ord);
        if (!pt2) return;
        var bits2 = 8 + ord * bps + 4 + 5 + ord * prec + 2 + 4 + pt2.bits;
        if (bits2 < best.bits) best = { type: "lpc", order: ord, lpc: ql, res: r2, u: u2, part: pt2, bits: bits2 };
      });
    }
    if (best.type === "fixed" || best.type === "lpc") { best.res = Float64Array.from(best.res.subarray(0, n)); best.u = Float64Array.from(best.u.subarray(0, n)); }
    return best;
  }
  function writeSubframe(w, x, n, bps, plan) {
    if (plan.type === "const") { w.put(0, 8); w.put(signed(x[0], bps), bps); return; }
    if (plan.type === "verbatim") { w.put(2, 8); for (var i = 0; i < n; i++) w.put(signed(x[i], bps), bps); return; }
    if (plan.type === "lpc") {
      w.put((32 + plan.order - 1) << 1, 8);               // 0 1xxxxx 0
      for (var a = 0; a < plan.order; a++) w.put(signed(x[a], bps), bps);
      w.put(plan.lpc.prec - 1, 4);
      w.put(plan.lpc.shift, 5);
      for (var b = 0; b < plan.order; b++) w.put(signed(plan.lpc.q[b], plan.lpc.prec), plan.lpc.prec);
    } else {
      w.put((8 + plan.order) << 1, 8);                    // 0 001xxx 0
      for (var j = 0; j < plan.order; j++) w.put(signed(x[j], bps), bps);
    }
    w.put(1, 2);                                          // Rice, 5-bit parameters
    w.put(plan.part.po, 4);
    var parts = 1 << plan.part.po, size = n >> plan.part.po, u = plan.u;
    for (var p = 0; p < parts; p++) {
      var k = plan.part.ks[p], pk = Math.pow(2, k);
      w.put(k, 5);
      for (var s = p === 0 ? plan.order : p * size, e = (p + 1) * size; s < e; s++) {
        var q = Math.floor(u[s] / pk);
        w.zeros(q); w.put(1, 1);
        if (k) w.put(u[s] - q * pk, k);
      }
    }
  }
  // two's complement in `bits` bits, as an unsigned number
  function signed(v, bits) { return v < 0 ? v + Math.pow(2, bits) : v; }

  // ---------- the encoder ----------
  function quantise(src, n, bps) {
    var full = Math.pow(2, bps - 1), lo = -full, hi = full - 1, out = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var v = Math.round(src[i] * full);
      out[i] = v < lo ? lo : v > hi ? hi : v || 0;
    }
    return out;
  }
  function Encoder(chans, rate, bps, opts) {
    opts = opts || {};
    bps = bps === 16 ? 16 : 24;
    if (!chans || !chans.length || chans.length > 2) throw new Error("channels");
    rate = Math.round(rate);
    if (!(rate >= 1 && rate <= 655350)) throw new Error("rate");
    this.ch = chans.length; this.rate = rate; this.bps = bps;
    this.n = chans[0].length;
    this.pcm = chans.map(function (c) { return c instanceof Int32Array ? c : quantise(c, c.length, bps); });
    this.opts = opts;
    this.frame = 0; this.done = 0;
    this.parts = [];
    this.minF = Infinity; this.maxF = 0;
    this.md5 = new Md5();
    var sz = Math.min(BLOCK, Math.max(1, this.n));
    this.work = { res: [], u: [] };
    for (var o = 0; o < 5 + LPC_ORDERS.length; o++) { this.work.res.push(new Float64Array(sz)); this.work.u.push(new Float64Array(sz)); }
    this.w = new BitWriter(sz * this.ch * 4 + 64);
    this.result = null;
  }
  Encoder.prototype.progress = function () { return this.n ? Math.min(1, this.done / this.n) : 1; };
  Encoder.prototype.step = function (frames) {
    if (this.result) return true;
    for (var f = 0; f < (frames || 16) && this.done < this.n; f++) this.encodeFrame();
    if (this.done >= this.n) { this.finish(); return true; }
    return false;
  };
  Encoder.prototype.encodeFrame = function () {
    var a = this.done, n = Math.min(BLOCK, this.n - a), bps = this.bps, ch = this.ch, md5 = this.md5, bpb = bps / 8;
    var xs = [];
    for (var c = 0; c < ch; c++) xs.push(this.pcm[c].subarray(a, a + n));
    for (var i = 0; i < n; i++) for (var c2 = 0; c2 < ch; c2++) {
      var v = xs[c2][i];
      for (var b = 0; b < bpb; b++) md5.byte((v >> (8 * b)) & 255);
    }
    var assign = ch === 1 ? 0 : 1, plans, chansOut, sizes;
    if (ch === 1) { chansOut = [xs[0]]; sizes = [bps]; plans = [planSubframe(xs[0], n, bps, this.work)]; }
    else {
      var L = xs[0], R = xs[1], S = new Int32Array(n), Mi = new Int32Array(n);
      for (var j = 0; j < n; j++) { S[j] = L[j] - R[j]; Mi[j] = (L[j] + R[j]) >> 1; }
      var pL = planSubframe(L, n, bps, this.work), pR = planSubframe(R, n, bps, this.work);
      var pS = planSubframe(S, n, bps + 1, this.work), pM = planSubframe(Mi, n, bps, this.work);
      var opts = [[1, [L, R], [bps, bps], [pL, pR]], [8, [L, S], [bps, bps + 1], [pL, pS]],
                  [9, [S, R], [bps + 1, bps], [pS, pR]], [10, [Mi, S], [bps, bps + 1], [pM, pS]]];
      var best = opts[0];
      opts.forEach(function (o) { if (o[3][0].bits + o[3][1].bits < best[3][0].bits + best[3][1].bits) best = o; });
      assign = best[0]; chansOut = best[1]; sizes = best[2]; plans = best[3];
    }
    var w = this.w;
    w.pos = 0; w.acc = 0; w.n = 0;
    w.put(0xfff8, 16);                                   // sync, fixed blocksize
    w.put(7, 4);                                         // block size: 16 bits at the end
    w.put(0, 4);                                         // sample rate: from STREAMINFO
    w.put(assign === 1 && ch === 1 ? 0 : assign, 4);
    w.put(bps === 16 ? 4 : 6, 3);
    w.put(0, 1);
    utf8Num(w, this.frame);
    w.put(n - 1, 16);
    var hb = w.bytes();
    w.put(crc8(hb, 0, w.pos), 8);
    for (var k = 0; k < chansOut.length; k++) writeSubframe(w, chansOut[k], n, sizes[k], plans[k]);
    w.align();
    var all = w.bytes();
    w.put(crc16(all, 0, w.pos), 16);
    var out = w.bytes().slice();
    this.parts.push(out);
    this.minF = Math.min(this.minF, out.length); this.maxF = Math.max(this.maxF, out.length);
    this.frame++; this.done += n;
  };
  function utf8Num(w, v) {
    if (v < 0x80) { w.put(v, 8); return; }
    var bytes = v < 0x800 ? 2 : v < 0x10000 ? 3 : v < 0x200000 ? 4 : v < 0x4000000 ? 5 : 6;
    var shift = 6 * (bytes - 1);
    w.put(((0xff << (8 - bytes)) & 0xff) | Math.floor(v / Math.pow(2, shift)), 8);
    for (var i = bytes - 2; i >= 0; i--) w.put(0x80 | (Math.floor(v / Math.pow(2, 6 * i)) & 63), 8);
  }
  function vorbisComment(opts) {
    var u8 = function (s) { return Array.from(unescape(encodeURIComponent(s)), function (c) { return c.charCodeAt(0); }); };
    var le = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    var vendor = u8("orOS Studio"), list = [];
    [["TITLE", opts.title], ["ARTIST", opts.artist], ["ALBUM", opts.album], ["COMMENT", opts.comment]].forEach(function (x) {
      if (typeof x[1] === "string" && x[1].trim()) list.push(u8(x[0] + "=" + x[1].replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 400)));
    });
    var out = le(vendor.length).concat(vendor, le(list.length));
    list.forEach(function (c) { out = out.concat(le(c.length), c); });
    return out;
  }
  Encoder.prototype.finish = function () {
    var md5 = this.md5.digest(), si = new BitWriter(64);
    var bs = Math.min(BLOCK, Math.max(16, this.n)) || 16;
    si.put(bs, 16); si.put(bs, 16);                      // fixed block size (the last frame may be shorter)
    si.put(this.parts.length ? this.minF : 0, 24); si.put(this.maxF, 24);
    si.put(this.rate, 20); si.put(this.ch - 1, 3); si.put(this.bps - 1, 5);
    si.put(Math.floor(this.n / 4294967296), 4); si.put(this.n % 4294967296, 32);
    var info = si.bytes();
    var vc = vorbisComment(this.opts);
    var head = [0x66, 0x4c, 0x61, 0x43, 0x00, 0, 0, 34].concat(Array.from(info), Array.from(md5),
                [0x84, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255], vc);
    var total = head.length;
    this.parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), o = head.length;
    out.set(head, 0);
    this.parts.forEach(function (p) { out.set(p, o); o += p.length; });
    this.parts = [];
    this.result = out;
  };
  Encoder.prototype.bytes = function () { return this.result; };
  function encode(chans, rate, bps, opts) {
    var e = new Encoder(chans, rate, bps, opts);
    while (!e.step(64)) {}
    return e.bytes();
  }

  var api = { VERSION: "1.0.0", Encoder: Encoder, encode: encode, quantise: quantise, BLOCK: BLOCK,
              _test: { fixedResidual: fixedResidual, crc8: crc8, crc16: crc16, Md5: Md5 } };
  root.StudioFlac = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
