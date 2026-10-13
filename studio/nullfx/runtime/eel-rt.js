// Runtime for effects translated by web/tools/eel2js.js (NULL JSFX, MIT License).
// EEL2's numeric rules, memory, strings and FFT, shared by the AudioWorklet, the page
// and the Node tests. Plain ES5; registers globalThis.NULLRT.
(function (g) {
  "use strict";

  var CLOSE = 0.00001;
  var MEM_MAX = 8388608;        // REAPER's default: 128 blocks of 65536 slots
  var BLOCK = 65536;
  var MIN_NORMAL = 2.2250738585072014e-308;

  // invsqrt: EEL2's fast float approximation, bit for bit
  var f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);

  function intOf(x) { return x < 0 ? Math.ceil(x) : Math.floor(x); }
  function big(x) { return BigInt(intOf(x)); }
  function bitop(a, b, op) {
    // EEL2 converts to 64-bit integers; 32 bits cover every value the effects use
    if (a > -2147483648 && a < 2147483648 && b > -2147483648 && b < 2147483648) {
      var x = intOf(a) | 0, y = intOf(b) | 0;
      return op === 0 ? (x & y) : op === 1 ? (x | y) : (x ^ y);
    }
    if (!(a - a === 0) || !(b - b === 0)) return 0;
    var X = big(a), Y = big(b);
    return Number(op === 0 ? (X & Y) : op === 1 ? (X | Y) : (X ^ Y));
  }
  function int32(x) { return x - x === 0 ? intOf(x) | 0 : 0; }

  var R = {
    t: function (x) { return x >= CLOSE || x <= -CLOSE; },
    eq: function (a, b) { var d = a - b; return d < CLOSE && d > -CLOSE; },
    // assignment from a computed value: denormals, inf and NaN become 0
    d: function (x) { return (x >= MIN_NORMAL || x <= -MIN_NORMAL) && x - x === 0 ? x : 0; },
    pow: function (a, b) { return Math.pow(a, b); },
    mod: function (a, b) {
      var y = Math.abs(int32(b));
      return y ? Math.abs(int32(a)) % y : 0;
    },
    shl: function (a, b) { return int32(a) << int32(b); },
    shr: function (a, b) { return int32(a) >> int32(b); },
    and: function (a, b) { return bitop(a, b, 0); },
    or: function (a, b) { return bitop(a, b, 1); },
    xor: function (a, b) { return bitop(a, b, 2); },
    log10: function (x) { return Math.log10(x); },
    sign: function (x) { return x < 0 ? -1 : x > 0 ? 1 : x; },
    sqr: function (x) { return x * x; },
    sqrt: function (x) { return Math.sqrt(Math.abs(x)); },
    invsqrt: function (x) {
      f32[0] = x;
      i32[0] = 0x5f3759df - (i32[0] >> 1);
      var y = f32[0];
      return y * (1.5 - ((x * 0.5) * y * y));
    },
    min: function (a, b) { return a > b ? b : a; },
    max: function (a, b) { return a < b ? b : a; },
    rand: function (x) {
      x = Math.floor(x);
      if (!(x >= 1)) x = 1;
      return R.random() * x;
    },
    random: Math.random,
    loopCount: function (n) {
      var c = int32(n);
      return c < 1 ? 0 : c > 1048576 ? 1048576 : c;
    },
    memory: function () { return new Memory(); },
    strings: function (literals) { return new Strings(literals); }
  };

  // ---------------------------------------------------------------- memory -----------
  // Like EEL2: 128 blocks of 65536 slots, each allocated on first write, so an effect that
  // keeps a buffer at index 4,000,000 does not cost 32 MB.
  function Memory() {
    this.b = [new Float64Array(BLOCK)]; // block 0 always exists: generated code reads it directly (M0)
    this.scratch = 0; // out-of-range reads and writes share this slot, as in EEL2
  }
  // read with the 0.00001 already added
  Memory.prototype.rc = function (x) {
    if (x > -1 && x < MEM_MAX) { var i = x | 0, blk = this.b[i >> 16]; return blk ? blk[i & 65535] : 0; }
    return this.scratch;
  };
  Memory.prototype.i = function (x) {
    x += CLOSE;
    if (x > -1 && x < MEM_MAX) return x | 0;
    return -1;
  };
  Memory.prototype.r = function (x) {
    x += CLOSE;
    if (x > -1 && x < MEM_MAX) { var i = x | 0, blk = this.b[i >> 16]; return blk ? blk[i & 65535] : 0; }
    return this.scratch;
  };
  Memory.prototype.g = function (i) {
    if (i < 0) return this.scratch;
    var blk = this.b[i >> 16];
    return blk ? blk[i & 65535] : 0;
  };
  Memory.prototype.block = function (n) {
    return this.b[n] || (this.b[n] = new Float64Array(BLOCK));
  };
  Memory.prototype.w = function (i, v) {
    if (i < 0) { this.scratch = v; return v; }
    (this.b[i >> 16] || this.block(i >> 16))[i & 65535] = v;
    return v;
  };
  // calls f(block array, start in block, count, offset from the beginning) over [d, d + n)
  Memory.prototype.each = function (d, n, create, f) {
    var done = 0;
    while (done < n) {
      var i = d + done, bn = i >> 16, o = i & 65535, c = Math.min(n - done, BLOCK - o);
      var blk = create ? this.block(bn) : this.b[bn];
      f(blk, o, c, done);
      done += c;
    }
  };
  Memory.prototype.set = function (dest, value, len) {
    var d = int32(dest + 0.0001), n = int32(len + 0.0001); // EEL2 rounds these by +0.0001
    if (d < 0) { n += d; d = 0; }
    if (d >= MEM_MAX) return dest;
    if (d + n > MEM_MAX) n = MEM_MAX - d;
    if (n < 1) return dest;
    this.each(d, n, value !== 0, function (blk, o, c) { if (blk) blk.fill(value, o, o + c); });
    return dest;
  };
  Memory.prototype.read = function (d, n) { // copy of [d, d + n) as one array
    var out = new Float64Array(n);
    this.each(d, n, false, function (blk, o, c, at) { if (blk) out.set(blk.subarray(o, o + c), at); });
    return out;
  };
  Memory.prototype.write = function (d, src) {
    this.each(d, src.length, true, function (blk, o, c, at) { blk.set(src.subarray(at, at + c), o); });
  };
  Memory.prototype.copy = function (dest, src, len) {
    var d = int32(dest + 0.0001), s = int32(src + 0.0001), n = int32(len + 0.0001);
    if (d < 0) { s -= d; n += d; d = 0; }
    if (s < 0) { d -= s; n += s; s = 0; }
    if (d + n > MEM_MAX) n = MEM_MAX - d;
    if (s + n > MEM_MAX) n = MEM_MAX - s;
    if (n <= 0 || d === s) return dest;
    this.write(d, this.read(s, n)); // memmove semantics
    return dest;
  };
  Memory.prototype.free = function (top) {
    // freembuf(top): blocks wholly above top are released and read 0 again
    var t = Math.max(0, int32(top + 0.0001));
    for (var k = Math.ceil(t / BLOCK); k < this.b.length; k++) {
      if (k === 0) this.b[0].fill(0); // block 0 stays (generated code holds it); zeroed reads the same
      else this.b[k] = undefined;
    }
    return top;
  };
  Memory.prototype.setValues = function (dest) {
    var d = this.i(dest);
    for (var k = 1; k < arguments.length; k++) this.w(d < 0 ? -1 : d + k - 1, arguments[k]);
    return dest;
  };
  // a writable view of len slots at offs inside one block (FFT); null when it would cross
  Memory.prototype.span = function (offs, len) {
    var d = int32(offs + 0.0001);
    if (d < 0 || d + len > MEM_MAX || (d >> 16) !== ((d + len - 1) >> 16)) return null;
    return this.block(d >> 16).subarray(d & 65535, (d & 65535) + len);
  };

  // ---------------------------------------------------------------- FFT ---------------
  // EEL2's fft() leaves the spectrum in WDL's permuted order; fft_permute() puts it in
  // natural order. Here the transform is computed in natural order and then scattered
  // with the same permutation, so both orders match REAPER's.
  var permTabs = {}, twiddles = {};
  function fftfreq(i, n) {
    if (n <= 2) return i;
    var m = n >>> 1;
    if (i < m) return fftfreq(i, m) << 1;
    i -= m; m >>>= 1;
    if (i < m) return (fftfreq(i, m) << 2) + 1;
    i -= m;
    return ((fftfreq(i, m) << 2) - 1) & (n - 1);
  }
  function permTab(n) {
    var t = permTabs[n];
    if (t) return t;
    t = new Int32Array(n);
    for (var i = 1; i < n; i++) t[n - fftfreq(i, n)] = i;
    t[0] = 0;
    return (permTabs[n] = t);
  }
  function tw(n) {
    var t = twiddles[n];
    if (t) return t;
    t = new Float64Array(n);
    for (var k = 0; k < n / 2; k++) { t[2 * k] = Math.cos(2 * Math.PI * k / n); t[2 * k + 1] = Math.sin(2 * Math.PI * k / n); }
    return (twiddles[n] = t);
  }
  var work = new Float64Array(2 * 32768);
  // in-place radix-2 on interleaved complex data; sign -1 forward, +1 inverse; natural order
  function dft(d, n, sign) {
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = d[2 * i], ti = d[2 * i + 1];
        d[2 * i] = d[2 * j]; d[2 * i + 1] = d[2 * j + 1];
        d[2 * j] = tr; d[2 * j + 1] = ti;
      }
    }
    var T = tw(n);
    for (var len = 2; len <= n; len <<= 1) {
      var half = len >> 1, step = n / len;
      for (var s = 0; s < n; s += len) {
        for (var k = 0; k < half; k++) {
          var wr = T[2 * k * step], wi = sign * T[2 * k * step + 1];
          var a = 2 * (s + k), b = 2 * (s + k + half);
          var xr = d[b] * wr - d[b + 1] * wi, xi = d[b] * wi + d[b + 1] * wr;
          d[b] = d[a] - xr; d[b + 1] = d[a + 1] - xi;
          d[a] += xr; d[a + 1] += xi;
        }
      }
    }
  }
  function fftSize(len, minBits) {
    var l = int32(len + 0.0001), bits = 0;
    while (l > 1 && bits < 15) { bits++; l >>= 1; }
    return bits < minBits ? 0 : 1 << bits;
  }
  function fftSpan(mem, start, n, items) { return mem.span(start, items); }
  function scatter(d, n, toPermuted) {
    var p = permTab(n), w = work;
    for (var k = 0; k < 2 * n; k++) w[k] = d[k];
    for (var x = 0; x < n; x++) {
      var y = p[x];
      if (toPermuted) { d[2 * y] = w[2 * x]; d[2 * y + 1] = w[2 * x + 1]; }
      else { d[2 * x] = w[2 * y]; d[2 * x + 1] = w[2 * y + 1]; }
    }
  }
  R.fft = function (mem, start, len) {
    var n = fftSize(len, 4); if (!n) return start;
    var d = fftSpan(mem, start, n, 2 * n); if (!d) return start;
    dft(d, n, -1);
    scatter(d, n, true);
    return start;
  };
  R.ifft = function (mem, start, len) {
    var n = fftSize(len, 4); if (!n) return start;
    var d = fftSpan(mem, start, n, 2 * n); if (!d) return start;
    scatter(d, n, false);
    dft(d, n, 1);
    return start;
  };
  R.fftPermute = function (mem, start, len) {
    var n = fftSize(len, 3); if (!n) return start;
    var d = fftSpan(mem, start, n, 2 * n); if (!d) return start;
    scatter(d, n, false);
    return start;
  };
  R.fftIpermute = function (mem, start, len) {
    var n = fftSize(len, 3); if (!n) return start;
    var d = fftSpan(mem, start, n, 2 * n); if (!d) return start;
    scatter(d, n, true);
    return start;
  };
  R.convolveC = function (mem, dest, src, len) {
    var n = int32(len + 0.0001);
    if (n < 1) return dest;
    var d = fftSpan(mem, dest, n, 2 * n), s = fftSpan(mem, src, n, 2 * n);
    if (!d || !s) return dest;
    for (var k = 0; k < 2 * n; k += 2) {
      var re = d[k] * s[k] - d[k + 1] * s[k + 1];
      d[k + 1] = d[k] * s[k + 1] + d[k + 1] * s[k];
      d[k] = re;
    }
    return dest;
  };
  R.fftReal = R.ifftReal = function (mem, start) { return start; }; // not used by NULL JSFX

  // ---------------------------------------------------------------- strings -----------
  // handles: 0-1023 user slots, 10000+ literals (read-only), 90000+ #named strings
  function Strings(literals) { this.lit = literals || []; this.s = {}; }
  Strings.prototype.get = function (h) {
    h = Math.floor(h + 0.5);
    if (h >= 10000 && h < 10000 + this.lit.length) return this.lit[h - 10000];
    var v = this.s[h];
    return v == null ? "" : v;
  };
  Strings.prototype.put = function (h, v) {
    h = Math.floor(h + 0.5);
    if (h >= 10000 && h < 90000) return h; // literals are read-only
    if (h < 0 || (h >= 1024 && h < 10000)) return h;
    this.s[h] = v;
    return h;
  };
  Strings.prototype.len = function (h) { return this.get(h).length; };
  Strings.prototype.cpy = function (d, s) { this.put(d, this.get(s)); return d; };
  Strings.prototype.cat = function (d, s) { this.put(d, this.get(d) + this.get(s)); return d; };
  Strings.prototype.cmp = function (a, b) { a = this.get(a); b = this.get(b); return a < b ? -1 : a > b ? 1 : 0; };
  Strings.prototype.icmp = function (a, b) { return this.cmp2(this.get(a).toLowerCase(), this.get(b).toLowerCase()); };
  Strings.prototype.cmp2 = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  Strings.prototype.ncmp = function (a, b, n) { n = Math.max(0, int32(n)); return this.cmp2(this.get(a).slice(0, n), this.get(b).slice(0, n)); };
  Strings.prototype.ncpy = function (d, s, n) { n = int32(n); this.put(d, n < 0 ? this.get(s) : this.get(s).slice(0, n)); return d; };
  Strings.prototype.substr = function (d, s, offs, len) {
    var str = this.get(s), o = int32(offs);
    if (o < 0) o = Math.max(0, str.length + o);
    var out = str.slice(o);
    if (arguments.length > 3) { var l = int32(len); out = l < 0 ? out.slice(0, Math.max(0, out.length + l)) : out.slice(0, l); }
    this.put(d, out);
    return d;
  };
  Strings.prototype.from = function (d, s, offs) { return this.substr(d, s, offs); };
  Strings.prototype.getchar = function (s, idx) {
    var str = this.get(s), i = int32(idx);
    if (i < 0) i += str.length;
    return i >= 0 && i < str.length ? str.charCodeAt(i) & 255 : 0;
  };
  Strings.prototype.setchar = function (s, idx, ch) {
    var str = this.get(s), i = int32(idx);
    if (i < 0) i += str.length;
    if (i < 0 || i > str.length) return s;
    this.put(s, str.slice(0, i) + String.fromCharCode(int32(ch) & 255) + str.slice(i + 1));
    return s;
  };
  Strings.prototype.setlen = function (s, n) {
    var str = this.get(s); n = Math.max(0, int32(n));
    this.put(s, str.length >= n ? str.slice(0, n) : str + new Array(n - str.length + 1).join(" "));
    return s;
  };
  // C printf subset: %[-+ 0#][width][.prec](d i u x X o c s f F e E g G %)
  function fixedC(v, prec) {
    // C rounds exact halves to even; toFixed rounds them up
    var s = v.toFixed(prec);
    var scaled = Math.abs(v) * Math.pow(10, prec);
    if (scaled - Math.floor(scaled) === 0.5 && prec <= 15) {
      var down = (Math.floor(scaled) / Math.pow(10, prec)).toFixed(prec);
      if (Math.floor(scaled) % 2 === 0) s = (v < 0 ? "-" : "") + down;
    }
    return s;
  }
  Strings.prototype.format = function (fmt, args) {
    var self = this, ai = 0;
    return fmt.replace(/%([-+ 0#]*)(\d*|\*)(?:\.(\d*|\*))?([diuxXocsfFeEgG%])/g, function (all, flags, width, prec, conv) {
      if (conv === "%") return "%";
      if (width === "*") width = String(int32(args[ai++] || 0));
      if (prec === "*") prec = String(int32(args[ai++] || 0));
      var v = args[ai++]; if (v == null) v = 0;
      var s, p = prec === undefined || prec === "" ? (prec === "" ? 0 : -1) : +prec;
      switch (conv) {
        case "d": case "i": case "u": s = String(Math.abs(intOf(v))); if (p >= 0) while (s.length < p) s = "0" + s; if (intOf(v) < 0) s = "-" + s; break;
        case "x": case "X": s = (intOf(v) >>> 0).toString(16); if (conv === "X") s = s.toUpperCase(); break;
        case "o": s = (intOf(v) >>> 0).toString(8); break;
        case "c": s = String.fromCharCode(int32(v) & 255); break;
        case "s": s = self.get(v); if (p >= 0) s = s.slice(0, p); break;
        case "f": case "F": s = fixedC(v, p < 0 ? 6 : p); break;
        case "e": case "E": s = v.toExponential(p < 0 ? 6 : p).replace(/e([-+])(\d)$/, "e$10$2"); if (conv === "E") s = s.toUpperCase(); break;
        case "g": case "G": s = String(+v.toPrecision(p < 0 ? 6 : Math.max(p, 1))); break;
      }
      if (/[dif]/i.test(conv) && v >= 0 && flags.indexOf("+") >= 0) s = "+" + s;
      else if (/[dif]/i.test(conv) && v >= 0 && flags.indexOf(" ") >= 0) s = " " + s;
      var w = width ? +width : 0;
      if (s.length < w) {
        if (flags.indexOf("-") >= 0) s = s + new Array(w - s.length + 1).join(" ");
        else if (flags.indexOf("0") >= 0 && conv !== "s" && conv !== "c") {
          var sign = /^[-+ ]/.test(s) ? s.charAt(0) : "";
          s = sign + new Array(w - s.length + 1).join("0") + s.slice(sign.length);
        } else s = new Array(w - s.length + 1).join(" ") + s;
      }
      return s;
    });
  };
  Strings.prototype.sprintf = function (d, fmt) {
    var args = Array.prototype.slice.call(arguments, 2);
    this.put(d, this.format(this.get(fmt), args));
    return d;
  };

  R.Memory = Memory;
  R.Strings = Strings;
  R.permTab = permTab;
  g.NULLRT = R;
  if (typeof module !== "undefined" && module.exports) module.exports = R;
})(typeof globalThis !== "undefined" ? globalThis : this);
