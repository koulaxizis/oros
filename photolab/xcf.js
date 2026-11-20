// ============================================================
// orOS Photo Lab — xcf.js: GIMP's own .xcf reader (no DOM)
// GIMP 2.x and 3.x files (XCF versions 0 to 25): RGB, Grayscale and
// Indexed images at every precision GIMP saves (8, 16 and 32-bit
// integer, half, float and double, linear or not; linear light goes
// through the sRGB curve), tiles raw, RLE or zlib (zlib through the
// platform's DecompressionStream), 32- and 64-bit pointers.
// Each layer keeps its name, position, opacity, visibility and mode
// (GIMP's modes mapped to Photo Lab's blend modes, legacy ones too;
// the others become Normal and are named), and its layer mask as a
// mask (on/off from "Apply layer mask"). Layer groups open as groups
// like psd.js does (wave PS-4: visibility, opacity, mode or
// pass-through, nesting; a group mask goes onto the layers inside).
// Text layers come as the pixels GIMP saved for them (named).
// Channels and paths are not layers and are left as they are.
// Every count and size is checked before anything is allocated.
//
// read(bytes, o) → Promise<{ w, h, layers, groups, merged: null, notes, names,
//                    skipped }>, the same shape as psd.js read() (so
//   Photo Lab shows the same report); o.maxSide, o.maxPixels.
//   Rejects with Error("xcf") (not an XCF / damaged), "xcf-big" (over
//   the limits), "psd-zip" (zlib tiles and no DecompressionStream).
//
// UMD: module.exports in Node (tests), window.PhotoLab.xcf in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_ITEMS = 2000, TILE = 64;
  var PROP = { END: 0, COLORMAP: 1, FLOATING: 5, OPACITY: 6, MODE: 7, VISIBLE: 8, APPLY_MASK: 11, OFFSETS: 15,
               COMPRESSION: 17, PARASITES: 21, TEXT_FLAGS: 26, GROUP_ITEM: 29, ITEM_PATH: 30, FLOAT_OPACITY: 33 };

  // GIMP layer modes (GimpLayerMode, legacy 0–22 included) → Photo Lab.
  var MODES = {
    0: "normal", 28: "normal", 3: "multiply", 30: "multiply", 4: "screen", 31: "screen",
    5: "soft", 23: "overlay",                       // GIMP's old "overlay" is soft light
    6: "difference", 32: "difference", 9: "darken", 35: "darken", 10: "lighten", 36: "lighten",
    11: "hue", 37: "hue", 24: "hue", 12: "saturation", 38: "saturation", 25: "saturation",
    13: "color", 39: "color", 26: "color", 14: "luminosity", 40: "luminosity", 27: "luminosity", 56: "luminosity",
    16: "dodge", 42: "dodge", 17: "burn", 43: "burn", 18: "hard", 44: "hard", 19: "soft", 45: "soft", 52: "exclusion"
  };
  var PASS = 61;

  function R(b) { this.b = b; this.p = 0; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.wide = false; }
  R.prototype.need = function (n) { if (n < 0 || this.p + n > this.b.length) throw new Error("xcf"); };
  R.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  R.prototype.u32 = function () { this.need(4); var v = this.dv.getUint32(this.p); this.p += 4; return v; };
  R.prototype.i32 = function () { this.need(4); var v = this.dv.getInt32(this.p); this.p += 4; return v; };
  R.prototype.f32 = function () { this.need(4); var v = this.dv.getFloat32(this.p); this.p += 4; return v; };
  R.prototype.ptr = function () {
    if (!this.wide) return this.u32();
    var hi = this.u32(), lo = this.u32();
    if (hi > 2097151) throw new Error("xcf-big");
    return hi * 4294967296 + lo;
  };
  R.prototype.str = function () {
    var n = this.u32();
    if (n > 65536) throw new Error("xcf");
    this.need(n);
    var s = this.b.subarray(this.p, this.p + n); this.p += n;
    var t = "";
    try { t = new TextDecoder("utf-8").decode(s); } catch (e) { for (var i = 0; i < s.length; i++) t += String.fromCharCode(s[i]); }
    return t.replace(/\u0000+$/, "");
  };
  R.prototype.at = function (p) { if (p < 0 || p >= this.b.length) throw new Error("xcf"); this.p = p; return this; };

  // ---------- Precision ----------
  // → { bytes per component, kind: "u" | "h" | "f" | "d", linear }
  function precision(ver, p) {
    if (ver < 4) return { n: 1, k: "u", lin: false };
    if (ver === 4) return [{ n: 1, k: "u", lin: false }, { n: 2, k: "u", lin: false }, { n: 4, k: "u", lin: true },
                           { n: 2, k: "h", lin: true }, { n: 4, k: "f", lin: true }][p] || null;
    if (ver <= 6) {
      var old = { 100: [1, "u", 1], 150: [1, "u", 0], 200: [2, "u", 1], 250: [2, "u", 0], 300: [4, "u", 1], 350: [4, "u", 0],
                  400: [2, "h", 1], 450: [2, "h", 0], 500: [4, "f", 1], 550: [4, "f", 0], 600: [8, "d", 1], 650: [8, "d", 0] }[p];
      return old ? { n: old[0], k: old[1], lin: !!old[2] } : null;
    }
    var base = Math.floor(p / 100) * 100, lin = p % 100 === 0;
    var m = { 100: [1, "u"], 200: [2, "u"], 300: [4, "u"], 500: [2, "h"], 600: [4, "f"], 700: [8, "d"] }[base];
    if (!m || [0, 50, 75].indexOf(p % 100) < 0) return null;
    return { n: m[0], k: m[1], lin: lin };
  }
  var SRGB = null;
  function srgb(v) {
    if (!SRGB) {
      SRGB = new Uint8Array(4097);
      for (var i = 0; i <= 4096; i++) { var x = i / 4096; SRGB[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); }
    }
    return v <= 0 ? 0 : v >= 1 ? 255 : SRGB[Math.round(v * 4096)];
  }
  function half(h) {
    var s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    if (e === 0) return s * f * Math.pow(2, -24);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * Math.pow(2, e - 15);
  }
  // One component (big-endian, as GIMP saves) → 0…1.
  function comp(dv, o, pr) {
    if (pr.k === "u") return pr.n === 1 ? dv.getUint8(o) / 255 : pr.n === 2 ? dv.getUint16(o) / 65535 : dv.getUint32(o) / 4294967295;
    if (pr.k === "h") return half(dv.getUint16(o));
    if (pr.k === "f") return dv.getFloat32(o);
    return dv.getFloat64(o);
  }

  // ---------- Tiles ----------
  function inflate(data, size) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("psd-zip"));
    var out = new Uint8Array(size), at = 0, done = false;
    var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    reader.closed.then(null, function () {});           // trailing bytes after the stream: handled below
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (at !== size) throw new Error("xcf"); return out; }
        var n = Math.min(r.value.length, size - at);
        out.set(r.value.subarray(0, n), at); at += n;
        if (at === size) { done = true; try { reader.cancel(); } catch (e) {} return out; }
        return pump();
      });
    }
    // zlib may carry bytes after the stream end (the next tile): once the
    // tile is full, what follows does not matter.
    return pump().catch(function (e) { if (done || at === size) return out; throw new Error("xcf"); });
  }
  function unrle(src, s, end, out, bpp, n) {
    for (var i = 0; i < bpp; i++) {
      var w = i, left = n;
      while (left > 0) {
        if (s >= end) throw new Error("xcf");
        var v = src[s++], len;
        if (v >= 128) {
          len = 256 - v;
          if (len === 128) { if (s + 2 > end) throw new Error("xcf"); len = (src[s] << 8) | src[s + 1]; s += 2; }
          if (len > left || s + len > end) throw new Error("xcf");
          for (var k = 0; k < len; k++) { out[w] = src[s++]; w += bpp; }
        } else {
          len = v + 1;
          if (len === 128) { if (s + 2 > end) throw new Error("xcf"); len = (src[s] << 8) | src[s + 1]; s += 2; }
          if (len > left || s >= end) throw new Error("xcf");
          var b = src[s++];
          for (var j = 0; j < len; j++) { out[w] = b; w += bpp; }
        }
        left -= len;
      }
    }
    return s;
  }

  function read(bytes, o) {
    try { return parse(bytes, o || {}); } catch (e) { return Promise.reject(e); }
  }
  function parse(bytes, o) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 30) throw new Error("xcf");
    var r = new R(bytes), sig = "";
    for (var i = 0; i < 9; i++) sig += String.fromCharCode(bytes[i]);
    if (sig !== "gimp xcf ") throw new Error("xcf");
    var vs = String.fromCharCode(bytes[9], bytes[10], bytes[11], bytes[12]);
    var ver = vs === "file" ? 0 : /^v\d\d\d$/.test(vs) ? +vs.slice(1) : -1;
    if (ver < 0 || bytes[13] !== 0) throw new Error("xcf");
    r.p = 14;
    var w = r.u32(), h = r.u32(), base = r.u32();
    var pr = ver >= 4 ? precision(ver, r.u32()) : precision(ver, 0);
    if (!pr || base > 2) throw new Error("xcf");
    r.wide = ver >= 11;
    var maxSide = o.maxSide || 524288, maxPixels = o.maxPixels || 120e6;
    if (!w || !h || w > maxSide || h > maxSide || w * h > maxPixels) throw new Error("xcf-big");
    var f = { w: w, h: h, ver: ver, pr: pr, base: base, cmap: null, comp: 0, notes: {}, names: {}, ptrs: [] };
    props(r, function (t, len, at) {
      if (t === PROP.COLORMAP) { var n = r.u32(); if (n > 256 || 4 + n * 3 > len) throw new Error("xcf"); f.cmap = bytes.subarray(r.p, r.p + n * 3); }
      else if (t === PROP.COMPRESSION && len >= 1) f.comp = r.u8();
    });
    if (f.comp > 2) throw new Error("xcf");             // fractal compression was never written
    var lp = [];
    for (var k = 0; ; k++) { var p = r.ptr(); if (!p) break; if (k >= MAX_ITEMS) throw new Error("xcf-big"); lp.push(p); }
    for (var c = 0; ; c++) { var q = r.ptr(); if (!q) break; if (c >= MAX_ITEMS) throw new Error("xcf-big"); f.ptrs.push(q); }
    f.ptrs = f.ptrs.concat(lp);
    var items = lp.map(function (p, idx) { return layer(r.at(p), f, idx); });
    var total = 0;
    items.forEach(function (L) { if (!L.group) total += L.w * L.h; });
    if (total > maxPixels) throw new Error("xcf-big");
    f.ptrs.sort(function (a, b) { return a - b; });
    return build(bytes, f, items);
  }
  // Properties until PROP_END; cb(type, length, start) reads inside.
  function props(r, cb) {
    for (var n = 0; n < 10000; n++) {
      var t = r.u32(), len = r.u32(), at = r.p;
      r.need(len);
      if (t === PROP.END) return;
      cb(t, len, at);
      r.p = at + len;
    }
    throw new Error("xcf");
  }
  function layer(r, f, idx) {
    var L = { idx: idx, w: r.u32(), h: r.u32(), type: r.u32(), name: r.str(), op: 255, vis: 1, mode: 0, x: 0, y: 0, apply: 0, path: null, group: false };
    if (L.w > 524288 || L.h > 524288 || L.type > 5) throw new Error("xcf");
    var fop = null;
    props(r, function (t, len) {
      if (t === PROP.OPACITY && len >= 4) L.op = Math.min(255, r.u32());
      else if (t === PROP.FLOAT_OPACITY && len >= 4) fop = r.f32();
      else if (t === PROP.MODE && len >= 4) L.mode = r.u32();
      else if (t === PROP.VISIBLE && len >= 4) L.vis = r.u32() ? 1 : 0;
      else if (t === PROP.OFFSETS && len >= 8) { L.x = r.i32(); L.y = r.i32(); }
      else if (t === PROP.APPLY_MASK && len >= 4) L.apply = r.u32();
      else if (t === PROP.GROUP_ITEM) L.group = true;
      else if (t === PROP.ITEM_PATH) { var n = Math.floor(len / 4), a = []; if (n > 64) throw new Error("xcf"); for (var i = 0; i < n; i++) a.push(r.u32()); L.path = a; }
      else if (t === PROP.TEXT_FLAGS) L.text = true;
      else if (t === PROP.FLOATING) L.floating = true;
      else if (t === PROP.PARASITES) {
        var end = r.p + len;
        while (r.p + 12 <= end) {
          var nm = r.str(); r.u32(); var sz = r.u32();
          if (nm === "gimp-text-layer") L.text = true;
          r.need(sz); r.p += sz;
        }
      }
    });
    if (fop != null && isFinite(fop)) L.op = Math.round(Math.max(0, Math.min(1, fop)) * 255);
    L.hier = r.ptr(); L.maskPtr = r.ptr();
    if (L.hier) f.ptrs.push(L.hier);
    if (L.maskPtr) f.ptrs.push(L.maskPtr);
    return L;
  }
  function channel(r, f) {
    var C = { w: r.u32(), h: r.u32(), name: r.str() };
    props(r, function () {});
    C.hier = r.ptr();
    return C;
  }
  // A hierarchy's first level → { w, h, bpp, tiles: [pointers] }.
  function level(r, f, hp) {
    r.at(hp);
    var hw = r.u32(), hh = r.u32(), bpp = r.u32(), lv = r.ptr();
    for (var n = 0; n < 40; n++) { var d = r.ptr(); if (!d) break; f.ptrs.push(d); }
    if (!lv) throw new Error("xcf");
    f.ptrs.push(hp, lv);
    r.at(lv);
    var w = r.u32(), h = r.u32();
    if (w !== hw || h !== hh || bpp < 1 || bpp > 32) throw new Error("xcf");
    var count = Math.ceil(w / TILE) * Math.ceil(h / TILE), tiles = [];
    if (count > 2e6) throw new Error("xcf-big");
    for (var i = 0; i < count; i++) { var t = r.ptr(); if (!t) throw new Error("xcf"); tiles.push(t); }
    return { w: w, h: h, bpp: bpp, tiles: tiles };
  }
  function nextPtr(f, p, len) {
    var a = f.ptrs, lo = 0, hi = a.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] <= p) lo = m + 1; else hi = m; }
    return lo < a.length ? a[lo] : len;
  }
  // The level's pixels as raw big-endian bytes, w × h × bpp.
  function pixels(bytes, f, lv) {
    var tw = Math.ceil(lv.w / TILE), out = new Uint8Array(lv.w * lv.h * lv.bpp), chain = Promise.resolve();
    lv.tiles.forEach(function (tp) { f.ptrs.push(tp); });
    f.ptrs.sort(function (a, b) { return a - b; });
    lv.tiles.forEach(function (tp, i) {
      chain = chain.then(function () {
        var tx = i % tw, ty = Math.floor(i / tw);
        var cw = Math.min(TILE, lv.w - tx * TILE), ch = Math.min(TILE, lv.h - ty * TILE), size = cw * ch * lv.bpp;
        var end = Math.min(bytes.length, nextPtr(f, tp, bytes.length));
        var got;
        if (f.comp === 0) {
          if (tp + size > bytes.length) throw new Error("xcf");
          got = Promise.resolve(bytes.subarray(tp, tp + size));
        } else if (f.comp === 1) {
          var t = new Uint8Array(size);
          unrle(bytes, tp, bytes.length, t, lv.bpp, cw * ch);
          got = Promise.resolve(t);
        } else got = inflate(bytes.subarray(tp, Math.max(end, tp + 1)), size);
        return got.then(function (t) {
          for (var y = 0; y < ch; y++) {
            var dst = ((ty * TILE + y) * lv.w + tx * TILE) * lv.bpp;
            out.set(t.subarray(y * cw * lv.bpp, (y + 1) * cw * lv.bpp), dst);
          }
        });
      });
    });
    return chain.then(function () { return out; });
  }
  var COMPS = [3, 4, 1, 2, 1, 2];                       // by layer type
  function toRgba(raw, n, type, f) {
    var pr = f.pr, nc = COMPS[type], dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var d = new Uint8ClampedArray(n * 4), step = nc * pr.n, i, k;
    var colour = function (v) { return pr.lin ? srgb(v) : Math.round(Math.max(0, Math.min(1, v)) * 255); };
    var lin = function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 255); };
    var cm = f.cmap;
    for (i = 0; i < n; i++) {
      var o = i * step;
      if (type <= 1) {
        for (k = 0; k < 3; k++) d[i * 4 + k] = pr.k === "u" && pr.n === 1 && !pr.lin ? raw[o + k] : colour(comp(dv, o + k * pr.n, pr));
        d[i * 4 + 3] = type === 1 ? lin(comp(dv, o + 3 * pr.n, pr)) : 255;
      } else if (type <= 3) {
        var g = pr.k === "u" && pr.n === 1 && !pr.lin ? raw[o] : colour(comp(dv, o, pr));
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
        d[i * 4 + 3] = type === 3 ? lin(comp(dv, o + pr.n, pr)) : 255;
      } else {
        var ix = raw[o];
        if (cm && ix * 3 + 2 < cm.length) { d[i * 4] = cm[ix * 3]; d[i * 4 + 1] = cm[ix * 3 + 1]; d[i * 4 + 2] = cm[ix * 3 + 2]; }
        d[i * 4 + 3] = type === 5 ? raw[o + 1] : 255;
      }
    }
    return d;
  }
  function grey(raw, n, f) {
    var pr = f.pr, dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), d = new Uint8Array(n);
    for (var i = 0; i < n; i++) d[i] = Math.round(Math.max(0, Math.min(1, comp(dv, i * pr.n, pr))) * 255);
    return d;
  }

  function note(f, k, name) {
    f.notes[k] = (f.notes[k] || 0) + 1;
    if (name) { var l = f.names[k] = f.names[k] || []; if (l.length < 8 && l.indexOf(name) < 0) l.push(name); }
  }
  function clean(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60); }
  function cmpPath(a, b) {                              // bottom first: higher index is lower in GIMP
    for (var i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i];
    return a.length - b.length;
  }
  function isUnder(p, g) {
    if (!p || !g || p.length <= g.length) return false;
    for (var i = 0; i < g.length; i++) if (p[i] !== g[i]) return false;
    return true;
  }

  function build(bytes, f, items) {
    var rd = new R(bytes); rd.wide = f.ver >= 11;
    var groups = items.filter(function (L) { return L.group; });
    var leaves = items.filter(function (L) { return !L.group; });
    if (items.some(function (L) { return L.path; })) leaves.sort(function (a, b) { return cmpPath(a.path || [a.idx], b.path || [b.idx]); });
    else leaves.reverse();
    var out = [], chain = Promise.resolve();
    // the group masks, read once
    var gmask = {};
    // the groups as Photo Lab groups (wave PS-4): the deepest group
    // whose path starts the item's path holds it
    function holder(path) {
      var best = -1;
      groups.forEach(function (G, gi) { if (isUnder(path, G.path) && (best < 0 || G.path.length > groups[best].path.length)) best = gi; });
      return best < 0 ? null : best;
    }
    var glist = groups.map(function (G) {
      var name = clean(G.name) || "Group", bl = G.mode === PASS ? "pass" : MODES[G.mode];
      if (!bl) { note(f, "groupBlend", name); bl = "pass"; }
      return { name: name, vis: G.vis, op: Math.round(G.op / 255 * 100), bl: bl, open: 1, p: G.path ? holder(G.path) : null };
    });
    groups.forEach(function (G) {
      if (G.maskPtr && G.apply) chain = chain.then(function () { return maskOf(bytes, rd, f, G).then(function (m) { gmask[G.idx] = m; }); });
    });
    leaves.forEach(function (L) {
      chain = chain.then(function () {
        var name = clean(L.name) || "Layer";
        if (!L.w || !L.h || !L.hier) { note(f, "empty"); return; }
        var lv = level(rd, f, L.hier);
        if (lv.w !== L.w || lv.h !== L.h || lv.bpp !== COMPS[L.type] * (L.type >= 4 ? 1 : f.pr.n)) throw new Error("xcf");
        return pixels(bytes, f, lv).then(function (raw) {
          var bl = MODES[L.mode];
          if (!bl) { bl = "normal"; note(f, "blend", name); }
          var o = { name: name, x: L.x, y: L.y, img: { w: L.w, h: L.h, data: toRgba(raw, L.w * L.h, L.type, f) },
                    op: Math.round(L.op / 255 * 100), bl: bl, vis: L.vis };
          if (L.text) note(f, "text", name);
          return (L.maskPtr ? maskOf(bytes, rd, f, L) : Promise.resolve(null)).then(function (m) {
            if (m) { m.on = L.apply ? 1 : 0; o.mk = m; }
            if (L.path) { var gi = holder(L.path); if (gi != null) o.g = gi; }
            groups.forEach(function (G) {                     // a group mask has no place in Photo Lab
              if (!isUnder(L.path, G.path)) return;
              var gm = gmask[G.idx];
              if (gm) { bake(o, gm); note(f, "groups", clean(G.name)); }
            });
            out.push(o);
          });
        });
      });
    });
    return chain.then(function () {
      if (!out.length) throw new Error("xcf");
      return { w: f.w, h: f.h, layers: out, groups: glist, merged: null, notes: f.notes, names: f.names,
               skipped: { groups: f.notes.groups || 0, masks: 0, empty: f.notes.empty || 0, blends: f.notes.blend || 0 } };
    });
  }
  function maskOf(bytes, rd, f, L) {
    var C = channel(rd.at(L.maskPtr), f);
    if (!C.hier || C.w !== L.w || C.h !== L.h) return Promise.resolve(null);
    var lv = level(rd, f, C.hier);
    if (lv.bpp !== f.pr.n) return Promise.resolve(null);
    return pixels(bytes, f, lv).then(function (raw) {
      return { x: L.x, y: L.y, img: { w: C.w, h: C.h, data: grey(raw, C.w * C.h, f) }, bg: 255, on: 1 };
    });
  }
  function bake(L, m) {
    var d = L.img.data, w = L.img.w;
    for (var y = 0; y < L.img.h; y++) for (var x = 0; x < w; x++) {
      var gx = L.x + x - m.x, gy = L.y + y - m.y;
      var v = gx < 0 || gy < 0 || gx >= m.img.w || gy >= m.img.h ? 0 : m.img.data[gy * m.img.w + gx];
      var i = (y * w + x) * 4 + 3;
      d[i] = Math.round(d[i] * v / 255);
    }
  }

  var API = { read: read, MODES: MODES, unrle: unrle, precision: precision };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.xcf = API; }
})(typeof window !== "undefined" ? window : this);
