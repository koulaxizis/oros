// ============================================================
// orOS Photo Lab — psd.js: Photoshop .psd reader + writer (no DOM)
// Reader: 8- or 16-bit RGB, Grayscale or CMYK PSD (not PSB; CMYK is
// converted simply, without a colour profile), raster layers with
// names (Unicode too), position, opacity, blend mode, visibility and
// the layer mask baked into the alpha. Groups are flattened into the
// layer list (their markers dropped); text, smart objects, effects and
// adjustment layers come in as the pixels Photoshop saved for them (or
// are skipped when they have none). Raw, RLE and ZIP channels (ZIP
// through the platform's DecompressionStream). A file without layers
// opens as its merged picture. Every count and size is checked before anything is
// allocated (a hostile file cannot make it allocate more than `max`).
// Writer: raster layers (RLE), Unicode names, opacity, blend,
// visibility, plus the merged picture, so Photoshop, Photopea, GIMP
// and Krita open it with its layers.
//
// read(bytes, o) → Promise<{ w, h, layers: [{ name, x, y, img, op, bl, vis }],
//                    merged: img | null, skipped: { groups, masks, empty,
//                    blends } }>; layers bottom → top; img = { w, h, data }.
//   o.maxSide, o.maxPixels (sum of all layer areas, default 120 MP).
//   Rejects with Error("psd") (not a PSD / damaged), "psd-mode" (not
//   8/16-bit RGB, Grayscale or CMYK), "psd-big" (over the limits),
//   "psd-zip" (ZIP data and no DecompressionStream).
// write({ w, h, layers, merged }) → Uint8Array (layers bottom → top).
//
// UMD: module.exports in Node (tests), window.PhotoLab.psd in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_RECORDS = 2000;

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
  function Reader(b) { this.b = b; this.p = 0; }
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

  // A channel found while parsing: { comp, at, len, counts, w, h }
  // (at/len: its data after the compression word and the RLE counts).
  // Decodes to w × h bytes; 16-bit samples keep their high byte.
  function decode(b, c, bpc) {
    var rw = c.w * c.h ? c.w * bpc : 0, size = rw * c.h;
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
      var plane = new Uint8Array(c.w * c.h);
      for (var i = 0; i < plane.length; i++) plane[i] = r[i * 2];
      return plane;
    });
  }
  // ZIP with prediction: every sample is stored as the difference from
  // the one to its left (16-bit: big-endian 16-bit differences).
  function unpredict(r, w, h, bpc) {
    for (var y = 0; y < h; y++) {
      var o = y * w * bpc, x;
      if (bpc === 1) for (x = 1; x < w; x++) r[o + x] = (r[o + x] + r[o + x - 1]) & 255;
      else {
        var prev = (r[o] << 8) | r[o + 1];
        for (x = 1; x < w; x++) {
          var i = o + x * 2, v = (((r[i] << 8) | r[i + 1]) + prev) & 65535;
          r[i] = v >> 8; r[i + 1] = v & 255; prev = v;
        }
      }
    }
  }

  // RGBA from the colour planes of one model (RGB, Grayscale, CMYK)
  // and an optional alpha plane.
  function toRgba(planes, n, model, A) {
    var d = new Uint8ClampedArray(n * 4), i;
    if (model === 1) {
      for (i = 0; i < n; i++) { var g = planes[0][i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; }
    } else if (model === 4) {                         // CMYK, stored inverted (255 = no ink)
      for (i = 0; i < n; i++) {
        var k = planes[3][i];
        d[i * 4] = Math.round(planes[0][i] * k / 255);
        d[i * 4 + 1] = Math.round(planes[1][i] * k / 255);
        d[i * 4 + 2] = Math.round(planes[2][i] * k / 255);
      }
    } else {
      for (i = 0; i < n; i++) { d[i * 4] = planes[0][i]; d[i * 4 + 1] = planes[1][i]; d[i * 4 + 2] = planes[2][i]; }
    }
    for (i = 0; i < n; i++) d[i * 4 + 3] = A ? A[i] : 255;
    return d;
  }
  var COLOUR = { 1: 1, 3: 3, 4: 4 };                  // colour channels per model

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
    var maxSide = o.maxSide || 30000, maxPixels = o.maxPixels || 120e6;
    if (!(bytes instanceof Uint8Array)) throw new Error("psd");
    var R = new Reader(bytes);
    if (R.str(4) !== "8BPS") throw new Error("psd");
    var ver = R.u16();
    if (ver !== 1) throw new Error(ver === 2 ? "psd-big" : "psd");
    R.skip(6);
    var nch = R.u16(), h = R.u32(), w = R.u32(), depth = R.u16(), mode = R.u16();
    if (nch < 1 || nch > 56 || !w || !h) throw new Error("psd");
    if ((depth !== 8 && depth !== 16) || !COLOUR[mode]) throw new Error("psd-mode");
    if (w > maxSide || h > maxSide || w * h > maxPixels) throw new Error("psd-big");
    var bpc = depth / 8, nc = COLOUR[mode];
    R.skip(R.u32());                                    // colour mode data
    R.skip(R.u32());                                    // image resources

    var mergedAlpha = false, recs = [];
    var lmLen = R.u32(), lmEnd = R.p + lmLen;
    R.need(lmLen);
    if (lmLen >= 4) {
      var liLen = R.u32(), liEnd = R.p + liLen;
      if (liEnd > lmEnd) throw new Error("psd");
      if (liLen >= 2) {
        var rawCount = R.i16(), count = Math.abs(rawCount);
        mergedAlpha = rawCount < 0;           // negative: the merged picture's first extra channel is transparency
        if (count > MAX_RECORDS) throw new Error("psd-big");
        var total = 0, i;
        for (i = 0; i < count; i++) {
          var r = { top: R.i32(), left: R.i32(), bottom: R.i32(), right: R.i32(), ch: [] };
          r.w = r.right - r.left; r.h = r.bottom - r.top;
          if (r.w < 0 || r.h < 0 || r.w > maxSide || r.h > maxSide) throw new Error("psd-big");
          var cn = R.u16();
          if (cn > 56) throw new Error("psd");
          for (var c = 0; c < cn; c++) r.ch.push({ id: R.i16(), len: R.u32() });
          if (R.str(4) !== "8BIM") throw new Error("psd");
          r.key = R.str(4); r.op = R.u8(); R.skip(1); r.flags = R.u8(); R.skip(1);
          var exLen = R.u32(), exEnd = R.p + exLen;
          R.need(exLen);
          var mkLen = R.u32();
          if (mkLen >= 18) {
            var mp = R.p;
            r.mask = { top: R.i32(), left: R.i32(), bottom: R.i32(), right: R.i32(), def: R.u8(), flags: R.u8() };
            R.p = mp + mkLen;
          } else R.skip(mkLen);
          R.skip(R.u32());                              // blending ranges
          var pl = R.u8(); r.name = R.str(pl); R.skip((4 - ((pl + 1) % 4)) % 4);
          while (R.p + 12 <= exEnd) {
            var sig = R.str(4);
            if (sig !== "8BIM" && sig !== "8B64") break;
            var key = R.str(4), len = R.u32(), dEnd = R.p + len;
            if (dEnd > exEnd) throw new Error("psd");
            if (key === "luni") r.name = name16(R, len);
            else if (key === "lsct" || key === "lsdk") { if (len >= 4) r.section = R.u32(); }
            R.p = dEnd;
          }
          R.p = exEnd;
          if (!r.section) total += r.w * r.h;
          recs.push(r);
        }
        if (total > maxPixels) throw new Error("psd-big");
        // Where each channel's data sits (decoded later).
        recs.forEach(function (r) {
          r.ch.forEach(function (ch) {
            var start = R.p, end = start + ch.len;
            R.need(ch.len);
            ch.w = r.w; ch.h = r.h;
            if (ch.id === -2 && r.mask) {
              ch.w = r.mask.right - r.mask.left; ch.h = r.mask.bottom - r.mask.top;
              if (ch.w < 0 || ch.h < 0 || ch.w > maxSide || ch.h > maxSide) throw new Error("psd-big");
            }
            if (ch.len >= 2 && ch.w && ch.h && (ch.id !== -2 || r.mask)) {
              ch.comp = R.u16();
              if (ch.comp === 1) { ch.counts = []; for (var y = 0; y < ch.h; y++) ch.counts.push(R.u16()); }
              ch.at = R.p; ch.len = end - R.p;
              if (ch.len < 0) throw new Error("psd");
            } else ch.skip = true;
            R.p = end;
          });
        });
      }
      R.p = lmEnd;
    }
    var merged = null;
    if (R.p + 2 <= bytes.length) {
      var comp = R.u16(), use = Math.min(nch, mergedAlpha ? nc + 1 : nc);
      if (nch < nc) throw new Error("psd");
      var counts = null;
      if (comp === 1) { counts = []; for (var k = 0; k < nch * h; k++) counts.push(R.u16()); }
      merged = [];
      var at = R.p;
      for (var m = 0; m < use; m++) {
        var mc = { comp: comp, at: at, len: bytes.length - at, w: w, h: h, counts: null };
        if (comp === 1) {
          mc.counts = counts.slice(m * h, m * h + h);
          var sum = 0; mc.counts.forEach(function (n) { sum += n; });
          mc.len = sum; at += sum;
        } else if (comp === 0) { mc.len = w * h * bpc; at += mc.len; }
        else { merged = null; break; }                  // ZIP merged data has no per-plane lengths
        merged.push(mc);
      }
    }
    return build(bytes, { w: w, h: h, bpc: bpc, mode: mode, nc: nc, recs: recs, merged: merged });
  }

  // Decode channel by channel (one layer's planes alive at a time) and
  // assemble the layers; the merged picture only when no layer came in.
  function build(bytes, f) {
    var layers = [], groups = [], skipped = { groups: 0, masks: 0, empty: 0, blends: 0 };
    var chain = Promise.resolve();
    f.recs.forEach(function (r) {
      chain = chain.then(function () {
        if (r.section === 3) { groups.push(layers.length); return; }
        if (r.section === 1 || r.section === 2) {
          // A folder closes the group opened by its divider and carries
          // the group's visibility and opacity.
          skipped.groups++;
          var from = groups.length ? groups.pop() : 0;
          for (var g = from; g < layers.length; g++) {
            if (r.flags & 2) layers[g].vis = 0;
            layers[g].op = Math.round(layers[g].op * r.op / 255);
          }
          return;
        }
        if (r.section) return;
        if (!r.w || !r.h) { skipped.empty++; return; }
        var planes = {}, want = r.ch.filter(function (ch) { return !ch.skip && (ch.id >= -2 && ch.id < f.nc); });
        var step = Promise.resolve();
        want.forEach(function (ch) {
          step = step.then(function () { return decode(bytes, ch, f.bpc); })
                     .then(function (p) { planes[ch.id] = p; });
        });
        return step.then(function () {
          var cp = [];
          for (var ci = 0; ci < f.nc; ci++) cp.push(planes[ci]);
          if (cp.some(function (pl) { return !pl; })) { skipped.empty++; return; }
          var data = toRgba(cp, r.w * r.h, f.mode, planes[-1]);
          if (planes[-2] && r.mask && !(r.mask.flags & 2)) {     // bit 1: mask disabled
            bakeMask(data, r, planes[-2]);
            skipped.masks++;
          }
          var bl = KEYS[r.key];
          if (!bl) { bl = "normal"; skipped.blends++; }
          layers.push({ name: cleanText(r.name) || "Layer", x: r.left, y: r.top,
                        img: { w: r.w, h: r.h, data: data },
                        op: Math.round(r.op / 255 * 100), bl: bl, vis: (r.flags & 2) ? 0 : 1 });
        });
      });
    });
    return chain.then(function () {
      if (layers.length || !f.merged) {
        if (!layers.length) throw new Error("psd");
        return { w: f.w, h: f.h, layers: layers, merged: null, skipped: skipped };
      }
      var planes = [], step = Promise.resolve();
      f.merged.forEach(function (mc) {
        step = step.then(function () { return decode(bytes, mc, f.bpc); }).then(function (p) { planes.push(p); });
      });
      return step.then(function () {
        var img = { w: f.w, h: f.h, data: toRgba(planes, f.w * f.h, f.mode, planes.length > f.nc ? planes[f.nc] : null) };
        return { w: f.w, h: f.h, layers: [], merged: img, skipped: skipped };
      });
    });
  }

  // The mask (its own rectangle, default colour outside it) multiplies
  // the layer's alpha.
  function bakeMask(data, r, plane) {
    var m = r.mask, mw = m.right - m.left, inv = (m.flags & 4) !== 0;  // bit 2: invert when blending
    for (var y = 0; y < r.h; y++) {
      var gy = r.top + y - m.top;
      for (var x = 0; x < r.w; x++) {
        var gx = r.left + x - m.left, v;
        if (gx >= 0 && gy >= 0 && gx < mw && gy < m.bottom - m.top) v = plane[gy * mw + gx];
        else v = m.def;
        if (inv) v = 255 - v;
        var i = (y * r.w + x) * 4 + 3;
        data[i] = Math.round(data[i] * v / 255);
      }
    }
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

  function write(doc) {
    var W = new Writer(), w = doc.w, h = doc.h;
    W.str("8BPS"); W.u16(1); W.bytes(new Uint8Array(6));
    W.u16(4); W.u32(h); W.u32(w); W.u16(8); W.u16(3);
    W.u32(0);                                        // colour mode data
    W.u32(0);                                        // image resources

    var recs = new Writer(), chans = new Writer();
    var list = doc.layers || [];
    recs.u16(list.length);
    list.forEach(function (L) {
      var img = L.img;
      var data = [-1, 0, 1, 2].map(function (id) {
        return img.w && img.h ? chunk(planeOf(img, id < 0 ? 3 : id), img.w, img.h) : new Uint8Array([0, 0]);
      });
      recs.i32(L.y); recs.i32(L.x); recs.i32(L.y + img.h); recs.i32(L.x + img.w);
      recs.u16(4);
      [-1, 0, 1, 2].forEach(function (id, i) { recs.u16(id & 0xffff); recs.u32(data[i].length); });
      recs.str("8BIM"); recs.str(IDS[L.bl] || "norm");
      recs.u8(Math.round(Math.max(0, Math.min(100, L.op == null ? 100 : L.op)) * 2.55));
      recs.u8(0); recs.u8(L.vis === 0 ? 2 : 0); recs.u8(0);
      var nm = pascal(L.name), un = luni(L.name);
      recs.u32(4 + 4 + nm.length + un.length);
      recs.u32(0); recs.u32(0);                      // no mask, no blending ranges
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
