// ============================================================
// orOS QR Generator — QR code encoder (ISO/IEC 18004), v1.1.0
// Written for orOS, no third-party code. No DOM: the same file runs
// in the app frame (window.orosQR) and in Node tests (module.exports).
//   - versions 1–40, error correction L / M / Q / H
//   - numeric, alphanumeric and byte (UTF-8) modes; the cheapest
//     single mode that can hold the whole text is picked
//   - the smallest version that fits; all 8 masks scored with the
//     four penalty rules, the lowest wins
// API:
//   orosQR.encode(text, { ecl: "M" })  -> { version, size, ecl, mask,
//       mode, modules: [[bool]] (row-major, true = dark) }
//       throws Error with .code "TOO_LONG" when nothing fits
//   orosQR.measure(text, ecl)           -> { bits, max, version|null }
//   orosQR.shapes(qr, { margin, round, dot, eye, logo }) -> drawing
//       ops shared by the SVG writer, the canvas painter and the tests
//       (v1.1: dot / eye styles and an empty centre for a logo; calls
//       without them give exactly the v1.0 ops)
//   orosQR.svg(qr, opts)                -> SVG document string
//       (opts.logoSrc: a data:image/png|jpeg|webp|gif;base64 URL)
// ============================================================
(function (root) {
  "use strict";

  var ECL = { L: 0, M: 1, Q: 2, H: 3 };
  var ECL_FORMAT = [1, 0, 3, 2];          // format bits of L, M, Q, H

  // [ecl][version]: EC codewords per block, number of blocks.
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  // mode: indicator bits + character-count bits for versions 1–9, 10–26, 27–40
  var MODES = {
    numeric: { bits: 1, cc: [10, 12, 14] },
    alnum:   { bits: 2, cc: [9, 11, 13] },
    byte:    { bits: 4, cc: [8, 16, 16] }
  };

  function fail(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  // ---------- Text → bits ----------
  function utf8(text) {
    var out = [], s = String(text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
        else c = 0xFFFD;
      } else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;   // lone surrogate
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  function pickMode(s) {
    if (/^[0-9]*$/.test(s)) return "numeric";
    for (var i = 0; i < s.length; i++) if (ALNUM.indexOf(s.charAt(i)) < 0) return "byte";
    return "alnum";
  }

  function pushBits(bb, val, len) { for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); }

  // Payload bits (no mode/count header) and the character count.
  function segment(text) {
    var s = String(text), mode = pickMode(s), bits = [], i, n;
    if (mode === "numeric") {
      for (i = 0; i < s.length; i += 3) {
        var chunk = s.substr(i, 3);
        pushBits(bits, parseInt(chunk, 10), chunk.length * 3 + 1);
      }
      n = s.length;
    } else if (mode === "alnum") {
      for (i = 0; i + 1 < s.length; i += 2)
        pushBits(bits, ALNUM.indexOf(s.charAt(i)) * 45 + ALNUM.indexOf(s.charAt(i + 1)), 11);
      if (i < s.length) pushBits(bits, ALNUM.indexOf(s.charAt(i)), 6);
      n = s.length;
    } else {
      var bytes = utf8(s);
      for (i = 0; i < bytes.length; i++) pushBits(bits, bytes[i], 8);
      n = bytes.length;
    }
    return { mode: mode, bits: bits, count: n };
  }

  function ccBits(mode, ver) { return MODES[mode].cc[ver <= 9 ? 0 : (ver <= 26 ? 1 : 2)]; }

  // ---------- Capacity ----------
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, e) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
  }

  function eclIndex(ecl) {
    var e = ECL[typeof ecl === "string" ? ecl.toUpperCase() : "M"];
    return e === undefined ? 1 : e;
  }

  function fit(seg, e) {
    for (var v = 1; v <= 40; v++) {
      var cc = ccBits(seg.mode, v);
      if (seg.count >= (1 << cc)) continue;
      var used = 4 + cc + seg.bits.length;
      if (used <= dataCodewords(v, e) * 8) return { version: v, used: used };
    }
    return null;
  }

  // How full the text makes the largest code: drives the "fits" meter.
  function measure(text, ecl) {
    var e = eclIndex(ecl), seg = segment(text), f = fit(seg, e);
    return {
      bits: 4 + ccBits(seg.mode, 40) + seg.bits.length,
      max: dataCodewords(40, e) * 8,
      version: f ? f.version : null
    };
  }

  // ---------- Reed–Solomon over GF(256), poly 0x11D ----------
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(deg) {
    var r = [], i, j, root = 1;
    for (i = 0; i < deg - 1; i++) r.push(0);
    r.push(1);
    for (i = 0; i < deg; i++) {
      for (j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      for (var i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    });
    return r;
  }

  function addEcc(data, ver, e) {
    var nb = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(eccLen), blocks = [], k = 0, i, j;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++)
      for (j = 0; j < blocks.length; j++)
        if (i !== shortLen - eccLen || j >= nShort) out.push(blocks[j][i]);
    return out;
  }

  // ---------- Matrix ----------
  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var na = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 8 + na * 3 + 5) / (na * 4 - 4)) * 2;
    var r = [6];
    for (var pos = size - 7; r.length < na; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  function Grid(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.mod = [];
    this.fn = [];
    for (var y = 0; y < this.size; y++) {
      this.mod.push(new Array(this.size).fill(false));
      this.fn.push(new Array(this.size).fill(false));
    }
  }
  Grid.prototype.set = function (x, y, dark) { this.mod[y][x] = !!dark; this.fn[y][x] = true; };

  Grid.prototype.functionPatterns = function () {
    var s = this.size, i, j, self = this;
    for (i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < s && y >= 0 && y < s) self.set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(s - 4, 3); finder(3, s - 4);
    var al = alignPositions(this.ver, s), n = al.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        this.set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.formatBits(1, 0);       // reserve; redrawn per mask
    this.versionBits();
  };

  Grid.prototype.formatBits = function (eclFmt, mask) {
    var data = eclFmt << 3 | mask, rem = data, i, s = this.size;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (data << 10 | rem) ^ 0x5412;
    function b(k) { return ((bits >>> k) & 1) !== 0; }
    for (i = 0; i <= 5; i++) this.set(8, i, b(i));
    this.set(8, 7, b(6));
    this.set(8, 8, b(7));
    this.set(7, 8, b(8));
    for (i = 9; i < 15; i++) this.set(14 - i, 8, b(i));
    for (i = 0; i < 8; i++) this.set(s - 1 - i, 8, b(i));
    for (i = 8; i < 15; i++) this.set(8, s - 15 + i, b(i));
    this.set(8, s - 8, true);    // the dark module
  };

  Grid.prototype.versionBits = function () {
    if (this.ver < 7) return;
    var rem = this.ver, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = this.ver << 12 | rem;
    for (i = 0; i < 18; i++) {
      var bt = ((bits >>> i) & 1) !== 0, a = this.size - 11 + i % 3, b = Math.floor(i / 3);
      this.set(a, b, bt);
      this.set(b, a, bt);
    }
  };

  Grid.prototype.codewords = function (data) {
    var s = this.size, i = 0, total = data.length * 8;
    for (var right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < s; v++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - v : v;
        if (!this.fn[y][x] && i < total) {
          this.mod[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  };

  function maskBit(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }
  Grid.prototype.applyMask = function (m) {
    for (var y = 0; y < this.size; y++) for (var x = 0; x < this.size; x++)
      if (!this.fn[y][x] && maskBit(m, x, y)) this.mod[y][x] = !this.mod[y][x];
  };

  // Penalty (N1 = 3, N2 = 3, N3 = 40, N4 = 10). Any mask decodes; the
  // score only steers towards the one scanners read most easily.
  var F1 = [true, false, true, true, true, false, true, false, false, false, false];
  var F2 = [false, false, false, false, true, false, true, true, true, false, true];
  Grid.prototype.penalty = function () {
    var s = this.size, m = this.mod, p = 0, x, y, k, dark = 0;
    function lineScore(get) {
      var sc = 0, run = 1, i;
      for (i = 1; i < s; i++) {
        if (get(i) === get(i - 1)) run++;
        else { if (run >= 5) sc += 3 + run - 5; run = 1; }
      }
      if (run >= 5) sc += 3 + run - 5;
      for (i = 0; i + 11 <= s; i++) {
        var a = true, b = true;
        for (k = 0; k < 11 && (a || b); k++) {
          var v = get(i + k);
          if (v !== F1[k]) a = false;
          if (v !== F2[k]) b = false;
        }
        if (a) sc += 40;
        if (b) sc += 40;
      }
      return sc;
    }
    for (y = 0; y < s; y++) p += lineScore(function (i) { return m[y][i]; });
    for (x = 0; x < s; x++) p += lineScore(function (i) { return m[i][x]; });
    for (y = 0; y < s - 1; y++) for (x = 0; x < s - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (y = 0; y < s; y++) for (x = 0; x < s; x++) if (m[y][x]) dark++;
    var total = s * s;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  };

  // ---------- Encode ----------
  function encode(text, opts) {
    var e = eclIndex(opts && opts.ecl), seg = segment(text), f = fit(seg, e);
    if (!f) throw fail("TOO_LONG", "Text too long for a QR code");
    var ver = f.version, cap = dataCodewords(ver, e) * 8, bb = [];
    pushBits(bb, MODES[seg.mode].bits, 4);
    pushBits(bb, seg.count, ccBits(seg.mode, ver));
    for (var i = 0; i < seg.bits.length; i++) bb.push(seg.bits[i]);
    pushBits(bb, 0, Math.min(4, cap - bb.length));      // terminator
    pushBits(bb, 0, (8 - bb.length % 8) % 8);            // byte align
    var bytes = [];
    for (i = 0; i < bb.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = b << 1 | bb[i + j];
      bytes.push(b);
    }
    for (var pad = 0xEC; bytes.length < cap / 8; pad ^= 0xEC ^ 0x11) bytes.push(pad);

    var g = new Grid(ver);
    g.functionPatterns();
    g.codewords(addEcc(bytes, ver, e));
    var best = -1, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      g.applyMask(m);
      g.formatBits(ECL_FORMAT[e], m);
      var sc = g.penalty();
      if (sc < bestScore) { best = m; bestScore = sc; }
      g.applyMask(m);                                   // XOR undo
    }
    g.applyMask(best);
    g.formatBits(ECL_FORMAT[e], best);
    return {
      version: ver, size: g.size, ecl: "LMQH".charAt(e), mask: best, mode: seg.mode,
      modules: g.mod, fn: g.fn
    };
  }

  // ---------- Drawing ops ----------
  // Unit = one module. The quiet zone is `margin` modules on every
  // side. Dot styles (opts.dot): "square" = one rect per horizontal run
  // of dark modules; "rounded" = data modules become dots joined to
  // their right and lower dark neighbours by a bridge as wide as the
  // dot (runs read as solid to a scanner); "dots" = separate round dots.
  // Eye styles (opts.eye) for the three finder patterns: "square",
  // "rounded", "circle"; they stay solid so scanners still lock on.
  // Without opts.dot / opts.eye the v1.0 behaviour holds: opts.round
  // means rounded dots + rounded eyes, otherwise all square (same ops).
  // opts.logo (0–0.25): a fraction of the code's width left empty in the
  // middle for a logo (returned as `logo`, in units); use level H.
  // ops: { w, h, margin, rects: [[x, y, w, h, r, "fg"|"bg"?]], dots: [[cx, cy, r]], logo? }
  var DOT_STYLES = ["square", "rounded", "dots"];
  var EYE_STYLES = ["square", "rounded", "circle"];
  var EYE_RADII = { rounded: [1.6, 1.1, 0.8], circle: [3.5, 2.5, 1.5] };
  var DOT_R = 0.42;                    // "dots": a little air between neighbours
  var LOGO_MAX = 0.25;                 // more hides too much of a small code, even at H

  function inFinder(x, y, s) {
    return (x < 7 && y < 7) || (x >= s - 7 && y < 7) || (x < 7 && y >= s - 7);
  }
  function styleOf(o) {
    var dot = DOT_STYLES.indexOf(o.dot) >= 0 ? o.dot : (o.round ? "rounded" : "square");
    var eye = EYE_STYLES.indexOf(o.eye) >= 0 ? o.eye : (dot === "square" ? "square" : "rounded");
    return { dot: dot, eye: eye };
  }
  // The empty square in the middle for a logo: n modules (odd, so it
  // sits exactly in the centre) from (x, y). null when none.
  function logoBox(size, frac) {
    var f = typeof frac === "number" && isFinite(frac) ? Math.min(LOGO_MAX, Math.max(0, frac)) : 0;
    if (!f) return null;
    var n = Math.round(size * f);
    if ((size - n) % 2) n++;
    if (n < 3) return null;
    var p = (size - n) / 2;
    return { x: p, y: p, n: n };
  }
  function shapes(qr, opts) {
    var o = opts || {}, mg = o.margin === undefined ? 4 : Math.max(0, Math.min(10, o.margin | 0));
    var s = qr.size, m = qr.modules, rects = [], dots = [], x, y, st = styleOf(o);
    var lb = logoBox(s, o.logo);
    function dark(u, v) {
      if (u < 0 || v < 0 || u >= s || v >= s || !m[v][u]) return false;
      return !(lb && u >= lb.x && u < lb.x + lb.n && v >= lb.y && v < lb.y + lb.n);
    }
    var sqEye = st.eye === "square";
    // Square runs over the modules `want` accepts.
    function runs(want) {
      for (y = 0; y < s; y++) for (x = 0; x < s;) {
        if (!dark(x, y) || !want(x, y)) { x++; continue; }
        var x0 = x;
        while (x < s && dark(x, y) && want(x, y)) x++;
        rects.push([x0 + mg, y + mg, x - x0, 1, 0]);
      }
    }
    if (st.dot === "square") runs(function (u, v) { return sqEye || !inFinder(u, v, s); });
    else if (sqEye) runs(function (u, v) { return inFinder(u, v, s); });
    if (!sqEye) {
      var er = EYE_RADII[st.eye];
      [[0, 0], [s - 7, 0], [0, s - 7]].forEach(function (c) {
        rects.push([c[0] + mg, c[1] + mg, 7, 7, er[0], "fg"]);
        rects.push([c[0] + mg + 1, c[1] + mg + 1, 5, 5, er[1], "bg"]);
        rects.push([c[0] + mg + 2, c[1] + mg + 2, 3, 3, er[2], "fg"]);
      });
    }
    // "dots": the alignment patterns stay solid (rounded squares), so a
    // scanner that leans on them still finds them; under the logo, none.
    var inAlign = function () { return false; };
    if (st.dot === "dots") {
      var al = alignPositions(qr.version, s), na = al.length, boxes = [];
      for (var i = 0; i < na; i++) for (var j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        var ax = al[i] - 2, ay = al[j] - 2;
        boxes.push([ax, ay]);
        if (lb && ax + 5 > lb.x && ax < lb.x + lb.n && ay + 5 > lb.y && ay < lb.y + lb.n) continue;
        rects.push([ax + mg, ay + mg, 5, 5, 1.2, "fg"]);
        rects.push([ax + mg + 1, ay + mg + 1, 3, 3, 0.7, "bg"]);
        rects.push([ax + mg + 2, ay + mg + 2, 1, 1, 0.5, "fg"]);
      }
      inAlign = function (u, v) {
        for (var k = 0; k < boxes.length; k++)
          if (u >= boxes[k][0] && u < boxes[k][0] + 5 && v >= boxes[k][1] && v < boxes[k][1] + 5) return true;
        return false;
      };
    }
    if (st.dot !== "square") {
      var R = st.dot === "dots" ? DOT_R : 0.5, bridge = st.dot === "rounded";
      for (y = 0; y < s; y++) for (x = 0; x < s; x++) {
        if (!dark(x, y) || inFinder(x, y, s) || inAlign(x, y)) continue;
        dots.push([x + mg + 0.5, y + mg + 0.5, R]);
        if (!bridge) continue;
        if (dark(x + 1, y) && !inFinder(x + 1, y, s)) rects.push([x + mg + 0.5, y + mg + 0.5 - R, 1, 2 * R, 0]);
        if (dark(x, y + 1) && !inFinder(x, y + 1, s)) rects.push([x + mg + 0.5 - R, y + mg + 0.5, 2 * R, 1, 0]);
      }
    }
    var out = { w: s + 2 * mg, h: s + 2 * mg, margin: mg, rects: rects, dots: dots };
    if (lb) out.logo = { x: lb.x + mg, y: lb.y + mg, w: lb.n, h: lb.n };
    return out;
  }

  function xmlEsc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  function color(c, dflt) { return typeof c === "string" && HEX_RE.test(c) ? c.toLowerCase() : dflt; }
  function num(n) { return String(Math.round(n * 1000) / 1000); }

  // Caption band below the code, in module units.
  var CAPTION_H = 5;

  // SVG document. Everything but the caption is numbers; the caption
  // is XML-escaped text. viewBox in modules, crispEdges for squares.
  // A logo picture: a base64 data URL of a PNG, JPEG, WebP or GIF only
  // (no SVG: it could carry scripts or fetch things).
  var LOGO_SRC_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/]+={0,2}$/;
  var LOGO_SRC_MAX = 400000;
  function logoSrcOk(src) { return typeof src === "string" && src.length <= LOGO_SRC_MAX && LOGO_SRC_RE.test(src); }

  function svg(qr, opts) {
    var o = opts || {}, sh = shapes(qr, o), sty = styleOf(o);
    var fg = color(o.fg, "#000000"), bg = color(o.bg, "#ffffff");
    var cap = typeof o.caption === "string" ? o.caption.replace(/\s+/g, " ").trim() : "";
    var H = sh.h + (cap ? CAPTION_H : 0), px = Math.max(1, (o.scale | 0) || 8);
    var out = ['<?xml version="1.0" encoding="UTF-8"?>\n',
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ', sh.w, " ", H,
      '" width="', sh.w * px, '" height="', H * px, '"',
      sty.dot === "square" && sty.eye === "square" ? ' shape-rendering="crispEdges"' : "", ">\n",
      '<rect width="100%" height="100%" fill="', bg, '"/>\n'];
    var d = [];
    sh.rects.forEach(function (r) {
      if (r[4]) {
        out.push('<rect x="', r[0], '" y="', r[1], '" width="', r[2], '" height="', r[3],
          '" rx="', num(r[4]), '" fill="', r[5] === "bg" ? bg : fg, '"/>\n');
      } else d.push("M" + num(r[0]) + " " + num(r[1]) + "h" + num(r[2]) + "v" + num(r[3]) + "h-" + num(r[2]) + "z");
    });
    // Dots go in a path of their own: a dot and a bridge drawn with
    // opposite windings in one path would cut holes (nonzero rule).
    if (d.length) out.push('<path fill="', fg, '" d="', d.join(""), '"/>\n');
    d = [];
    sh.dots.forEach(function (c) {
      d.push("M" + num(c[0] - c[2]) + " " + num(c[1]) + "a" + num(c[2]) + " " + num(c[2]) +
             " 0 1 0 " + num(2 * c[2]) + " 0a" + num(c[2]) + " " + num(c[2]) + " 0 1 0 -" + num(2 * c[2]) + " 0z");
    });
    if (d.length) out.push('<path fill="', fg, '" d="', d.join(""), '"/>\n');
    // The logo, a little inside its empty square
    if (sh.logo && logoSrcOk(o.logoSrc)) {
      var ins = Math.min(0.5, sh.logo.w * 0.06);
      out.push('<image x="', num(sh.logo.x + ins), '" y="', num(sh.logo.y + ins), '" width="', num(sh.logo.w - 2 * ins),
        '" height="', num(sh.logo.h - 2 * ins), '" preserveAspectRatio="xMidYMid meet" href="', o.logoSrc, '"/>\n');
    }
    if (cap) {
      // ~0.6 em per character: shrink long captions to the code width
      var fs = Math.min(2.6, (sh.w - 2) / (Array.from(cap).length * 0.6));
      out.push('<text x="', num(sh.w / 2), '" y="', num(sh.h + CAPTION_H / 2 - 1.2), '" text-anchor="middle"',
        ' dominant-baseline="middle" font-family="Nunito, Segoe UI, system-ui, sans-serif" font-size="', num(fs), '"',
        ' font-weight="700" fill="', fg, '">', xmlEsc(cap), "</text>\n");
    }
    out.push("</svg>\n");
    return out.join("");
  }

  var api = {
    VERSION: "1.1.0",
    encode: encode,
    measure: measure,
    shapes: shapes,
    logoBox: logoBox,
    logoSrcOk: logoSrcOk,
    DOT_STYLES: DOT_STYLES,
    EYE_STYLES: EYE_STYLES,
    LOGO_MAX: LOGO_MAX,
    svg: svg,
    xmlEsc: xmlEsc,
    CAPTION_H: CAPTION_H,
    _internal: { utf8: utf8, pickMode: pickMode, dataCodewords: dataCodewords, rawModules: rawModules,
                 alignPositions: alignPositions, gfMul: gfMul }
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosQR = api;
})(typeof window !== "undefined" ? window : this);
