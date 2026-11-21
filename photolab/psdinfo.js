// ============================================================
// orOS Photo Lab — psdinfo.js: what a Photoshop layer says beside its
// pixels (no DOM). Used by psd.js (Photo Lab) and, read-only, by
// Atelier's PSD import.
//
//   desc(bytes)          an Action Descriptor (the format of lfx2,
//                        SoCo, GdFl, CgEd, blwh, vibA …) → plain object
//                        { _class, key: value }; numbers with units as
//                        { u: "#Pxl", v }, enums as { t, e }, lists as
//                        arrays. Bounded: depth 12, 4000 items.
//   effects(bytes, ang)  lfx2 block → { fx (Photo Lab layer styles:
//                        sh, gl, ig, st, co), lost: [names of styles
//                        Photo Lab has no counterpart for], approx: [] }
//                        ang: the file's global light angle.
//   adjust(key, bytes, extra)  an adjustment layer block → { aj: { id, p },
//                        approx: bool } | { lost: key } (Photo Lab's
//                        11 adjustment ids, core.js ADJ)
//   fill(key, bytes)     SoCo → { c: "#rrggbb" }; GdFl → { stops, ang,
//                        type }; PtFl → { pattern: true }
//   vmask(bytes)         vmsk / vsms → { inv, off, paths } (paths in
//                        0…1 of the canvas, cubic segments)
//   paint(vm, w, h, x0, y0, mw, mh)  coverage of a vector mask over the
//                        rectangle (x0, y0, mw, mh) of a w × h canvas →
//                        Uint8Array mw × mh (4 × 4 samples per pixel)
//   colour(obj)          a descriptor colour (RGBC, HSBC, CMYC, Grsc,
//                        LbCl) → "#rrggbb"
//
// Everything reads only inside the bytes given; a damaged block throws
// Error("psd-info"), which psd.js turns into "this part was lost".
// UMD: module.exports in Node (tests), window.PhotoLab.psdInfo.
// ============================================================
(function (root) {
  "use strict";

  var MAX_ITEMS = 4000, MAX_DEPTH = 12;

  function R(b) { this.b = b; this.p = 0; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  R.prototype.need = function (n) { if (n < 0 || this.p + n > this.b.length) throw new Error("psd-info"); };
  R.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  R.prototype.u16 = function () { this.need(2); var v = this.dv.getUint16(this.p); this.p += 2; return v; };
  R.prototype.i16 = function () { this.need(2); var v = this.dv.getInt16(this.p); this.p += 2; return v; };
  R.prototype.u32 = function () { this.need(4); var v = this.dv.getUint32(this.p); this.p += 4; return v; };
  R.prototype.i32 = function () { this.need(4); var v = this.dv.getInt32(this.p); this.p += 4; return v; };
  R.prototype.f32 = function () { this.need(4); var v = this.dv.getFloat32(this.p); this.p += 4; return v; };
  R.prototype.f64 = function () { this.need(8); var v = this.dv.getFloat64(this.p); this.p += 8; return v; };
  R.prototype.str = function (n) {
    this.need(n);
    var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p + i]);
    this.p += n; return s;
  };
  R.prototype.skip = function (n) { this.need(n); this.p += n; };
  R.prototype.uni = function () {
    var n = this.u32();
    if (n > 100000) throw new Error("psd-info");
    var s = "";
    for (var i = 0; i < n; i++) { var c = this.u16(); if (c) s += String.fromCharCode(c); }
    return s;
  };
  R.prototype.key = function () {                       // classID / key: length 0 = 4 chars
    var n = this.u32();
    if (n > 1000) throw new Error("psd-info");
    return this.str(n || 4);
  };

  // ---------- Action Descriptors ----------
  function desc(bytes) {
    var r = new R(bytes), cnt = { n: 0 };
    return readDesc(r, 0, cnt);
  }
  function readDesc(r, depth, cnt) {
    if (depth > MAX_DEPTH) throw new Error("psd-info");
    r.uni();                                             // name (often empty)
    var o = { _class: r.key() }, n = r.u32();
    if (n > MAX_ITEMS) throw new Error("psd-info");
    for (var i = 0; i < n; i++) {
      var k = r.key();
      o[k] = readItem(r, r.str(4), depth, cnt);
    }
    return o;
  }
  function readItem(r, type, depth, cnt) {
    if (++cnt.n > MAX_ITEMS) throw new Error("psd-info");
    switch (type) {
      case "Objc": case "GlbO": return readDesc(r, depth + 1, cnt);
      case "VlLs":
        var n = r.u32(), a = [];
        if (n > MAX_ITEMS) throw new Error("psd-info");
        for (var i = 0; i < n; i++) a.push(readItem(r, r.str(4), depth + 1, cnt));
        return a;
      case "doub": return r.f64();
      case "UntF": var u = r.str(4); return { u: u, v: r.f64() };
      case "UnFl":
        var uu = r.str(4), m = r.u32(), vs = [];
        if (m > MAX_ITEMS) throw new Error("psd-info");
        for (var j = 0; j < m; j++) vs.push(r.f64());
        return { u: uu, v: vs[0], all: vs };
      case "TEXT": return r.uni();
      case "enum": var t = r.key(); return { t: t, e: r.key() };
      case "long": return r.i32();
      case "comp": var hi = r.u32(), lo = r.u32(); return hi * 4294967296 + lo;
      case "bool": return !!r.u8();
      case "type": case "GlbC": r.uni(); return { cls: r.key() };
      case "alis": case "tdta": case "Pth ": var len = r.u32(); r.skip(len); return { data: len };
      case "obj ":
        var c = r.u32();
        if (c > 100) throw new Error("psd-info");
        for (var q = 0; q < c; q++) {
          var rt = r.str(4);
          if (rt === "prop") { r.uni(); r.key(); r.key(); }
          else if (rt === "Clss") { r.uni(); r.key(); }
          else if (rt === "Enmr") { r.uni(); r.key(); r.key(); r.key(); }
          else if (rt === "rele") { r.uni(); r.key(); r.i32(); }
          else if (rt === "Idnt" || rt === "indx") r.i32();
          else if (rt === "name") { r.uni(); r.key(); r.uni(); }
          else throw new Error("psd-info");
        }
        return { ref: c };
      case "ObAr":                                        // object arrays (rare): not needed here
      default: throw new Error("psd-info");
    }
  }

  // ---------- Colours ----------
  function hex2(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }
  function rgbHex(r, g, b) { return "#" + hex2(r) + hex2(g) + hex2(b); }
  function num(x, d) {
    if (typeof x === "number" && isFinite(x)) return x;
    if (x && typeof x.v === "number" && isFinite(x.v)) return x.v;
    return d;
  }
  function hsbRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
    var i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    var c = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [c[0] * 255, c[1] * 255, c[2] * 255];
  }
  // CIE Lab (D50, as Photoshop) → sRGB 0…255.
  function labRgb(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); }
    var X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8251 * inv(fz);
    return xyzRgb(X, Y, Z, true);
  }
  // XYZ (0…1) → sRGB 0…255; d50: Bradford-adapted D50 → D65 matrix.
  function xyzRgb(X, Y, Z, d50) {
    var r, g, b;
    if (d50) {
      r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
      g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z;
      b = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
    } else {
      r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
      g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
      b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    }
    return [r, g, b].map(function (v) {
      v = Math.max(0, Math.min(1, v));
      return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    });
  }
  function colour(c) {
    if (!c || typeof c !== "object") return null;
    var k = c._class;
    if (k === "RGBC" || ("Rd  " in c && "Grn " in c)) {
      var red = num(c["Rd  "], num(c.redFloat, 0) * 255), grn = num(c["Grn "], num(c.greenFloat, 0) * 255), blu = num(c["Bl  "], num(c.blueFloat, 0) * 255);
      return rgbHex(red, grn, blu);
    }
    if (k === "HSBC") { var x = hsbRgb(num(c["H   "], 0), num(c.Strt, 0) / 100, num(c.Brgh, 0) / 100); return rgbHex(x[0], x[1], x[2]); }
    if (k === "CMYC") {
      var K = 1 - num(c.Blck, 0) / 100;
      return rgbHex(255 * (1 - num(c["Cyn "], 0) / 100) * K, 255 * (1 - num(c.Mgnt, 0) / 100) * K, 255 * (1 - num(c["Ylw "], 0) / 100) * K);
    }
    if (k === "Grsc") { var gv = 255 * (1 - num(c["Gry "], 0) / 100); return rgbHex(gv, gv, gv); }
    if (k === "LbCl") { var l = labRgb(num(c.Lmnc, 0), num(c["A   "], 0), num(c["B   "], 0)); return rgbHex(l[0], l[1], l[2]); }
    return null;
  }
  // The 10-byte colour of the binary blocks (space + four 16-bit values).
  function binColour(space, v) {
    if (space === 0) return rgbHex(v[0] / 257, v[1] / 257, v[2] / 257);
    if (space === 1) { var h = hsbRgb(v[0] / 65535 * 360, v[1] / 65535, v[2] / 65535); return rgbHex(h[0], h[1], h[2]); }
    if (space === 2) {
      var K = v[3] / 65535;                               // stored as 65535 = no ink
      return rgbHex(v[0] / 257 * K, v[1] / 257 * K, v[2] / 257 * K);
    }
    if (space === 7) { var l = labRgb(v[0] / 100, (v[1] > 32767 ? v[1] - 65536 : v[1]) / 100, (v[2] > 32767 ? v[2] - 65536 : v[2]) / 100); return rgbHex(l[0], l[1], l[2]); }
    if (space === 8) { var g = 255 - v[0] / 10000 * 255; return rgbHex(g, g, g); }
    return null;
  }

  // ---------- Layer styles (lfx2) ----------
  function on(o) { return o && typeof o === "object" && o.enab !== false; }
  function first(d, single, multi) {
    if (Array.isArray(d[multi])) {
      for (var i = 0; i < d[multi].length; i++) if (on(d[multi][i])) return d[multi][i];
      return null;
    }
    return on(d[single]) ? d[single] : null;
  }
  function px(v) { return Math.round(num(v, 0)); }
  var LOST_FX = { ebbl: "bevel", IrSh: "innerShadow", ChFX: "satin", GrFl: "gradientOverlay", patternFill: "patternOverlay" };
  var LOST_MULTI = { innerShadowMulti: "innerShadow", gradientFillMulti: "gradientOverlay" };
  function effects(bytes, globalAngle) {
    var r = new R(bytes);
    r.u32();                                              // object effects version
    var dv = r.u32();
    if (dv !== 16) throw new Error("psd-info");
    var d = readDesc(r, 0, { n: 0 });
    var out = { fx: null, lost: [], approx: [] };
    if (d.masterFXSwitch === false) return out;
    var fx = {}, any = false, ga = typeof globalAngle === "number" ? globalAngle : 120;
    var ds = first(d, "DrSh", "dropShadowMulti");
    if (ds) {
      fx.sh = { c: colour(ds["Clr "]) || "#000000", op: px(ds.Opct || { v: 75 }), a: Math.round(ds.uglg === false ? num(ds.lagl, ga) : ga),
                d: px(ds.Dstn), s: px(ds.blur) };
      if (fx.sh.a > 180) fx.sh.a -= 360;
      if (fx.sh.a < -180) fx.sh.a += 360;
      if (num(ds.Ckmt, 0) > 0) out.approx.push("spread");
      any = true;
    }
    var og = on(d.OrGl) ? d.OrGl : null;
    if (og) { fx.gl = { c: colour(og["Clr "]) || "#ffffbe", op: px(og.Opct || { v: 75 }), s: px(og.blur) }; any = true; if (og.Grad) out.approx.push("glowGradient"); }
    var ig = on(d.IrGl) ? d.IrGl : null;
    if (ig) { fx.ig = { c: colour(ig["Clr "]) || "#ffffbe", op: px(ig.Opct || { v: 75 }), s: px(ig.blur) }; any = true; }
    var st = first(d, "FrFX", "frameFXMulti");
    if (st) {
      fx.st = { c: colour(st["Clr "]) || "#000000", op: px(st.Opct || { v: 100 }), w: Math.max(1, px(st["Sz  "])) };
      var kind = st.PntT && st.PntT.e;
      if (kind && kind !== "SClr") out.approx.push("strokeFill");
      var pos = st.Styl && st.Styl.e;
      if (pos && pos !== "OutF") out.approx.push("strokeInside");
      any = true;
    }
    var co = first(d, "SoFi", "solidFillMulti");
    if (co) { fx.co = { c: colour(co["Clr "]) || "#ff0000", op: px(co.Opct || { v: 100 }) }; any = true; }
    Object.keys(LOST_FX).forEach(function (k) { if (on(d[k]) && out.lost.indexOf(LOST_FX[k]) < 0) out.lost.push(LOST_FX[k]); });
    Object.keys(LOST_MULTI).forEach(function (k) {
      if (Array.isArray(d[k]) && d[k].some(on) && out.lost.indexOf(LOST_MULTI[k]) < 0) out.lost.push(LOST_MULTI[k]);
    });
    if (Array.isArray(d.patternFill) && d.patternFill.some(on) && out.lost.indexOf("patternOverlay") < 0) out.lost.push("patternOverlay");
    if (any) out.fx = fx;
    return out;
  }

  // ---------- Adjustment layers ----------
  var ADJ_KEYS = { levl: 1, curv: 1, "hue ": 1, hue2: 1, blnc: 1, brit: 1, CgEd: 1, blwh: 1, phfl: 1, grdm: 1, nvrt: 1, thrs: 1, post: 1,
                   vibA: 1, expA: 1, selc: 1, mixr: 1, clrL: 1, "lrFX": 0 };
  function isAdj(key) { return !!ADJ_KEYS[key]; }
  function clampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  // Photoshop's curve through its points (natural cubic spline, as
  // the Curves dialog draws it) sampled at x.
  function curveAt(pts, x) {
    var n = pts.length;
    if (n < 2) return x;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    var h = [], al = [], l = [1], mu = [0], z = [0], c = [], i;
    for (i = 0; i < n - 1; i++) h[i] = Math.max(1e-6, pts[i + 1][0] - pts[i][0]);
    for (i = 1; i < n - 1; i++) al[i] = 3 / h[i] * (pts[i + 1][1] - pts[i][1]) - 3 / h[i - 1] * (pts[i][1] - pts[i - 1][1]);
    for (i = 1; i < n - 1; i++) {
      l[i] = 2 * (pts[i + 1][0] - pts[i - 1][0]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i]; z[i] = (al[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    c[n - 1] = 0;
    for (i = n - 2; i >= 0; i--) c[i] = (i === 0 ? 0 : z[i]) - (i === 0 ? 0 : mu[i] * c[i + 1]);
    for (i = 0; i < n - 1 && x > pts[i + 1][0]; i++);
    var b = (pts[i + 1][1] - pts[i][1]) / h[i] - h[i] * (c[i + 1] + 2 * c[i]) / 3, dd = (c[i + 1] - c[i]) / (3 * h[i]);
    var t = x - pts[i][0];
    return pts[i][1] + b * t + c[i] * t * t + dd * t * t * t;
  }
  function samePts(p) { return p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255; }
  function curves(bytes) {
    var r = new R(bytes);
    var isMap = r.u8(), ver = r.u16();
    if (ver !== 1 && ver !== 4) throw new Error("psd-info");
    var cm = r.u32(), list = [], i, chans = [];
    if (ver === 1) { for (i = 0; i < 32; i++) if (cm & (1 << i)) chans.push(i); }
    var count = ver === 1 ? chans.length : cm;
    if (count > 32) throw new Error("psd-info");
    for (i = 0; i < count; i++) {
      var ch = ver === 1 ? chans[i] : r.u16();
      if (isMap) { var m = []; for (var k = 0; k < 256; k++) m.push(r.u8()); list.push({ ch: ch, map: m }); continue; }
      var n = r.u16(), pts = [];
      if (n < 2 || n > 19) throw new Error("psd-info");
      for (var j = 0; j < n; j++) { var o = r.u16(), inp = r.u16(); pts.push([inp, o]); }
      list.push({ ch: ch, pts: pts });
    }
    // Photoshop also writes the 'Crv ' extra (version 4) with every
    // channel: prefer it when it is there.
    if (ver === 1 && r.p + 10 <= bytes.length && r.str(4) === "Crv ") {
      try {
        var v4 = r.u16(), c4 = r.u32(), ext = [];
        if (v4 === 4 && c4 <= 32) {
          for (i = 0; i < c4; i++) {
            var id = r.u16();
            if (isMap) { var mm = []; for (var q = 0; q < 256; q++) mm.push(r.u8()); ext.push({ ch: id, map: mm }); continue; }
            var nn = r.u16(), pp = [];
            if (nn < 2 || nn > 19) throw new Error("psd-info");
            for (var w = 0; w < nn; w++) { var oo = r.u16(), ii = r.u16(); pp.push([ii, oo]); }
            ext.push({ ch: id, pts: pp });
          }
          list = ext;
        }
      } catch (e) { /* keep the version 1 curves */ }
    }
    var comp = null, approx = false;
    list.forEach(function (c) {
      if (c.ch === 0) comp = c;
      else if (c.map ? c.map.some(function (v, x) { return v !== x; }) : !samePts(c.pts)) approx = true;
    });
    var at = function (x) {
      if (!comp) return x;
      return comp.map ? comp.map[x] : curveAt(comp.pts, x);
    };
    if (comp && comp.pts && comp.pts.length > 5) approx = true;
    return { aj: { id: "curves", p: { s: clampN(Math.round(at(64)), 0, 255), m: clampN(Math.round(at(128)), 0, 255), h: clampN(Math.round(at(192)), 0, 255) } }, approx: approx };
  }
  function levels(bytes) {
    var r = new R(bytes);
    if (r.u16() !== 2) throw new Error("psd-info");
    var rec = [], approx = false;
    for (var i = 0; i < 29 && r.p + 10 <= bytes.length; i++) rec.push([r.u16(), r.u16(), r.u16(), r.u16(), r.u16()]);
    if (!rec.length) throw new Error("psd-info");
    for (var k = 1; k < Math.min(rec.length, 4); k++) {
      var q = rec[k];
      if (q[0] !== 0 || q[1] !== 255 || q[2] !== 0 || q[3] !== 255 || q[4] !== 100) approx = true;
    }
    var c = rec[0];
    return { aj: { id: "levels", p: { ib: clampN(c[0], 0, 254), iw: clampN(Math.max(c[1], c[0] + 1), 1, 255), g: clampN(c[4] / 100, 0.1, 9.99), ob: clampN(c[2], 0, 255), ow: clampN(c[3], 0, 255) } }, approx: approx };
  }
  function hueSat(bytes) {
    var r = new R(bytes);
    var ver = r.u16();
    if (ver !== 2) throw new Error("psd-info");
    var colorize = r.u8(); r.u8();
    var ch = r.i16(), cs = r.i16(), cl = r.i16();
    var mh = r.i16(), ms = r.i16(), ml = r.i16(), approx = false;
    for (var i = 0; i < 6 && r.p + 14 <= bytes.length; i++) {
      r.skip(8);
      if (r.i16() || r.i16() || r.i16()) approx = true;
    }
    if (colorize) {
      var c = hsbRgb(ch < 0 ? ch + 360 : ch, clampN(cs, 0, 100) / 100, 1), hex = rgbHex(c[0], c[1], c[2]);
      return { aj: { id: "photo", p: { c: hex, d: 100 } }, approx: true };
    }
    return { aj: { id: "hsl", p: { h: clampN(mh, -180, 180), s: clampN(ms, -100, 100), l: clampN(ml, -100, 100) } }, approx: approx };
  }
  function balance(bytes) {
    var r = new R(bytes), v = [];
    for (var i = 0; i < 9; i++) v.push(r.i16());
    var approx = v[0] || v[1] || v[2] || v[6] || v[7] || v[8];
    // shadows and highlights: a third of them folded into the midtones
    var mix = function (k) { return clampN(Math.round(v[3 + k] + (v[k] + v[6 + k]) / 3), -100, 100); };
    return { aj: { id: "balance", p: { r: mix(0), g: mix(1), b: mix(2) } }, approx: !!approx };
  }
  function brightness(key, bytes, extra) {
    var b, c, approx = false;
    if (key === "CgEd") {
      var d = desc(skipVer(bytes));
      b = num(d.Brgh, 0); c = num(d.Cntr, 0);
      if (d.useLegacy === false && c) approx = true;
    } else {
      var r = new R(bytes);
      b = r.i16(); c = r.i16();
      if (extra && extra.CgEd) return brightness("CgEd", extra.CgEd);
    }
    return { aj: { id: "bc", p: { b: clampN(Math.round(b), -150, 150), c: clampN(Math.round(c), -100, 100) } }, approx: approx };
  }
  function skipVer(bytes) { return bytes.subarray(4); }      // u32 descriptor version (16)
  function blackWhite(bytes) {
    var d = desc(skipVer(bytes)), approx = false;
    var def = { "Rd  ": 40, Yllw: 60, "Grn ": 40, "Cyn ": 60, "Bl  ": 20, Mgnt: 80 };
    Object.keys(def).forEach(function (k) { if (k in d && Math.round(num(d[k], def[k])) !== def[k]) approx = true; });
    if (d.useTint) return { aj: { id: "photo", p: { c: colour(d.tintColor) || "#e1d3b3", d: 100 } }, approx: true };
    return { aj: { id: "gray", p: {} }, approx: approx };
  }
  function photoFilter(bytes) {
    var r = new R(bytes), ver = r.u16(), hex;
    if (ver === 3) {
      var X = r.i32(), Y = r.i32(), Z = r.i32(), mx = Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) || 1;
      var c = xyzRgb(X / mx, Y / mx, Z / mx, false);
      var top = Math.max(c[0], c[1], c[2]) || 1;              // only the hue counts: Photo Lab scales by luminance
      hex = rgbHex(c[0] * 255 / top, c[1] * 255 / top, c[2] * 255 / top);
    } else if (ver === 2) {
      var sp = r.u16(), v = [r.u16(), r.u16(), r.u16(), r.u16()];
      hex = binColour(sp, v);
    } else throw new Error("psd-info");
    var dens = r.u32();
    return { aj: { id: "photo", p: { c: hex || "#ec8a00", d: clampN(dens, 1, 100) } }, approx: false };
  }
  function gradMap(bytes) {
    var r = new R(bytes);
    if (r.u16() !== 1) throw new Error("psd-info");
    var rev = r.u8(); r.u8();
    r.uni();
    var n = r.u16(), stops = [];
    if (n < 2 || n > 200) throw new Error("psd-info");
    for (var i = 0; i < n; i++) {
      var loc = r.u32(); r.u32();
      var sp = r.u16(), v = [r.u16(), r.u16(), r.u16(), r.u16()]; r.u16();
      stops.push({ at: loc, c: binColour(sp, v) || "#000000" });
    }
    stops.sort(function (a, b) { return a.at - b.at; });
    var c0 = stops[0].c, c1 = stops[stops.length - 1].c;
    if (rev) { var t = c0; c0 = c1; c1 = t; }
    return { aj: { id: "gradmap", p: { c0: c0, c1: c1 } }, approx: n > 2 };
  }
  function vibrance(bytes) {
    var d = desc(skipVer(bytes)), v = num(d.vibrance, 0), s = num(d.Strt, 0);
    return { aj: { id: "hsl", p: { h: 0, s: clampN(Math.round(s + v / 2), -100, 100), l: 0 } }, approx: !!v };
  }
  function exposure(bytes) {
    var r = new R(bytes);
    r.u16();
    var e = r.f32(), off = r.f32(), g = r.f32();
    if (!isFinite(e) || !isFinite(off) || !isFinite(g)) throw new Error("psd-info");
    // gain 2^e: white input point 255 / gain (brighter) or output white
    // 255 · gain (darker); offset lifts or lowers black; gamma 1 / g.
    var gain = Math.pow(2, clampN(e, -20, 20));
    var p = { ib: 0, iw: 255, g: clampN(1 / (g || 1), 0.1, 9.99), ob: 0, ow: 255 };
    if (gain >= 1) p.iw = clampN(Math.round(255 / gain), 1, 255); else p.ow = clampN(Math.round(255 * gain), 0, 255);
    if (off > 0) p.ob = clampN(Math.round(off * 255), 0, 255);
    else if (off < 0) p.ib = clampN(Math.round(-off * 255), 0, Math.max(0, p.iw - 1));
    return { aj: { id: "levels", p: p }, approx: true };
  }
  function adjust(key, bytes, extra) {
    try {
      switch (key) {
        case "levl": return levels(bytes);
        case "curv": return curves(bytes);
        case "hue2": case "hue ": return hueSat(bytes);
        case "blnc": return balance(bytes);
        case "brit": case "CgEd": return brightness(key, bytes, extra);
        case "blwh": return blackWhite(bytes);
        case "phfl": return photoFilter(bytes);
        case "grdm": return gradMap(bytes);
        case "nvrt": return { aj: { id: "invert", p: {} }, approx: false };
        case "thrs": return { aj: { id: "threshold", p: { t: clampN(new R(bytes).u16(), 1, 255) } }, approx: false };
        case "post": return { aj: { id: "posterize", p: { n: clampN(new R(bytes).u16(), 2, 32) } }, approx: false };
        case "vibA": return vibrance(bytes);
        case "expA": return exposure(bytes);
      }
    } catch (e) { return { lost: key }; }
    return { lost: key };
  }

  // ---------- Fill layers ----------
  function fill(key, bytes) {
    try {
      var d = desc(skipVer(bytes));
      if (key === "SoCo") { var c = colour(d["Clr "]); return c ? { c: c } : null; }
      if (key === "GdFl") {
        var g = d.Grad, stops = [];
        (g && Array.isArray(g.Clrs) ? g.Clrs : []).forEach(function (s) {
          var hex = colour(s["Clr "]);
          if (hex) stops.push({ at: num(s.Lctn, 0) / 4096, c: hex });
        });
        if (!stops.length) return null;
        stops.sort(function (a, b) { return a.at - b.at; });
        var type = d.Type && d.Type.e === "Rdl " ? "radial" : "linear";
        return { stops: stops, ang: num(d.Angl, 90), type: type, rev: !!d.Rvrs, approx: !!(d.Type && d.Type.e !== "Lnr " && d.Type.e !== "Rdl ") };
      }
      if (key === "PtFl") return { pattern: true };
    } catch (e) { return null; }
    return null;
  }

  // ---------- Vector masks ----------
  function fixed(r) { return r.i32() / 16777216; }       // 8.24 fixed point, 0…1 of the canvas
  function vmask(bytes) {
    var r = new R(bytes);
    if (r.u32() !== 3) throw new Error("psd-info");
    var flags = r.u32(), paths = [], cur = null, fillAll = false;
    while (r.p + 26 <= bytes.length) {
      var sel = r.u16(), s = r.p;
      if (sel === 0 || sel === 3) {
        var n = r.u16(), op = r.i16();
        cur = { closed: sel === 0, op: op, knots: [], left: n };
        paths.push(cur);
      } else if (sel === 1 || sel === 2 || sel === 4 || sel === 5) {
        var k = [];
        for (var i = 0; i < 3; i++) { var y = fixed(r), x = fixed(r); k.push([x, y]); }
        if (cur && cur.left > 0) { cur.knots.push(k); cur.left--; }
      } else if (sel === 8) fillAll = r.u16() === 1;
      r.p = s + 24;
    }
    return { inv: !!(flags & 1), off: !!(flags & 4), all: fillAll, paths: paths.filter(function (p) { return p.knots.length >= 2; }) };
  }
  // Flatten one subpath into a polygon in canvas pixels.
  function polygon(p, w, h) {
    var pts = [], K = p.knots, n = K.length;
    for (var i = 0; i < n; i++) {
      var a = K[i], b = K[(i + 1) % n];
      if (i === n - 1 && !p.closed) break;
      var x0 = a[1][0] * w, y0 = a[1][1] * h, x1 = a[2][0] * w, y1 = a[2][1] * h;
      var x2 = b[0][0] * w, y2 = b[0][1] * h, x3 = b[1][0] * w, y3 = b[1][1] * h;
      var len = Math.abs(x1 - x0) + Math.abs(y1 - y0) + Math.abs(x2 - x1) + Math.abs(y2 - y1) + Math.abs(x3 - x2) + Math.abs(y3 - y2);
      var steps = Math.max(1, Math.min(64, Math.ceil(len / 6)));
      for (var s = 0; s < steps; s++) {
        var t = s / steps, u = 1 - t;
        pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                  u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
    }
    return pts;
  }
  // 4 × 4 samples per pixel, nonzero winding per subpath; subpaths
  // combine by their operation (Photoshop: 0 exclude, 1 combine,
  // 2 subtract, 3 intersect; -1 = combine).
  function paint(vm, w, h, x0, y0, mw, mh) {
    var S = 4, acc = new Uint8Array(mw * S * mh * S), one = new Uint8Array(mw * S * mh * S);
    var first = true;
    if (vm.all) { acc.fill(1); first = false; }
    vm.paths.forEach(function (p) {
      var poly = polygon(p, w, h);
      if (poly.length < 3) return;
      one.fill(0);
      var W = mw * S, H = mh * S, wind = new Int16Array(W + 1);
      for (var sy = 0; sy < H; sy++) {
        var yy = y0 + (sy + 0.5) / S;
        wind.fill(0);
        for (var i = 0; i < poly.length; i++) {
          var a = poly[i], b = poly[(i + 1) % poly.length];
          if ((a[1] <= yy) === (b[1] <= yy)) continue;
          var xx = a[0] + (yy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
          var sx = Math.ceil((xx - x0) * S - 0.5);
          if (sx < 0) sx = 0;
          if (sx > W) continue;
          wind[sx] += b[1] > a[1] ? 1 : -1;
        }
        var wsum = 0, row = sy * W;
        for (var x = 0; x < W; x++) { wsum += wind[x]; if (wsum) one[row + x] = 1; }
      }
      var op = p.op;
      for (var k = 0; k < acc.length; k++) {
        var A = acc[k], B = one[k];
        if (first || op === 1 || op === -1) acc[k] = first ? B : (A | B);
        else if (op === 2) acc[k] = A & (B ^ 1);
        else if (op === 3) acc[k] = A & B;
        else acc[k] = A ^ B;
      }
      first = false;
    });
    var out = new Uint8Array(mw * mh), W2 = mw * S;
    for (var y = 0; y < mh; y++) for (var x2 = 0; x2 < mw; x2++) {
      var c = 0;
      for (var a2 = 0; a2 < S; a2++) for (var b2 = 0; b2 < S; b2++) c += acc[(y * S + a2) * W2 + x2 * S + b2];
      var v = Math.round(c * 255 / (S * S));
      out[y * mw + x2] = vm.inv ? 255 - v : v;
    }
    return out;
  }

  var API = { desc: desc, effects: effects, adjust: adjust, isAdj: isAdj, fill: fill, vmask: vmask, paint: paint,
              colour: colour, binColour: binColour, curveAt: curveAt, labRgb: labRgb };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.psdInfo = API; }
})(typeof window !== "undefined" ? window : this);
