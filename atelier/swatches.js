// ============================================================
// orOS Atelier — swatches.js: Adobe swatch files (no DOM, v1.0.0)
// Integrations wave 5 (Adobe without an account): colours from
// Illustrator, Photoshop or InDesign come into the Brand kit, and the
// Brand kit goes back out as a swatch file.
//   read(bytes) → [{ name, c "#rrggbb" }] (file order, duplicates
//     kept; the caller decides) from either format:
//       .ase  Adobe Swatch Exchange ("ASEF"; RGB, CMYK, LAB, Gray;
//             groups flattened)
//       .aco  Photoshop swatches (version 1 and 2; RGB, HSB, CMYK,
//             Lab, Grayscale; other spaces skipped)
//     Rejects with Error("swatch") when the bytes are neither.
//   writeAse(colors, group) → Uint8Array ("ASEF" 1.0, one group,
//     RGB global colours named "#rrggbb" or by name)
// CMYK and Lab are converted simply (no colour profile), like the
// PSD reader. Every count and length is checked against the bytes
// left before anything is read (a hostile file can't make it loop or
// allocate more than the file).
// UMD: module.exports in Node (tests), window.AtelierSwatches here.
// ============================================================
(function (root) {
  "use strict";

  var MAX = 2000;                       // colours read from one file

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function hex2(n) { n = Math.round(clamp(n, 0, 255)); return (n < 16 ? "0" : "") + n.toString(16); }
  function rgb(r, g, b) { return "#" + hex2(r) + hex2(g) + hex2(b); }
  function cmyk(c, m, y, k) {          // 0..1 each
    return rgb(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
  }
  // CIE Lab (D50) → sRGB
  function lab(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function f(t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); }
    var X = 0.9642 * f(fx), Y = f(fy), Z = 0.8249 * f(fz);
    // Bradford D50 → D65, then XYZ → linear sRGB
    var x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z;
    var y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z;
    var z = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z;
    var lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    var lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    var lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    function g(v) { v = clamp(v, 0, 1); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
    return rgb(g(lr), g(lg), g(lb));
  }
  function hsb(h, s, v) {              // h 0..360, s v 0..1
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return rgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  function cleanName(s) {
    return String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function reader(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0;
    function need(n) { if (n < 0 || p + n > u8.length) throw new Error("swatch"); }
    return {
      left: function () { return u8.length - p; },
      pos: function () { return p; },
      seek: function (q) { if (q < 0 || q > u8.length) throw new Error("swatch"); p = q; },
      u16: function () { need(2); var v = dv.getUint16(p); p += 2; return v; },
      i16: function () { need(2); var v = dv.getInt16(p); p += 2; return v; },
      u32: function () { need(4); var v = dv.getUint32(p); p += 4; return v; },
      f32: function () { need(4); var v = dv.getFloat32(p); p += 4; return v; },
      ascii: function (n) { need(n); var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]); p += n; return s; },
      utf16: function (n) {            // n UTF-16 units, trailing NUL dropped
        need(n * 2);
        var s = "";
        for (var i = 0; i < n; i++) { var c = dv.getUint16(p + i * 2); if (c) s += String.fromCharCode(c); }
        p += n * 2;
        return s;
      }
    };
  }

  function readAse(R) {
    if (R.ascii(4) !== "ASEF") throw new Error("swatch");
    R.u16(); R.u16();                  // version 1.0
    var n = R.u32(), out = [];
    if (n > R.left() / 6) throw new Error("swatch");
    for (var i = 0; i < n && out.length < MAX; i++) {
      var type = R.u16(), len = R.u32(), start = R.pos();
      if (len > R.left()) throw new Error("swatch");
      if (type === 0x0001) {
        var nl = R.u16();
        if (nl * 2 > len) throw new Error("swatch");
        var name = cleanName(R.utf16(nl)), model = R.ascii(4), c = "";
        if (model === "RGB ") c = rgb(R.f32() * 255, R.f32() * 255, R.f32() * 255);
        else if (model === "CMYK") c = cmyk(clamp(R.f32(), 0, 1), clamp(R.f32(), 0, 1), clamp(R.f32(), 0, 1), clamp(R.f32(), 0, 1));
        else if (model === "Gray") { var gv = R.f32() * 255; c = rgb(gv, gv, gv); }
        else if (model === "LAB ") {
          var L = R.f32(), a = R.f32(), b = R.f32();
          c = lab(L <= 1 ? L * 100 : L, a, b);   // L is 0..1 in files Adobe writes
        }
        if (c && /^#[0-9a-f]{6}$/.test(c)) out.push({ name: name, c: c });
      }
      R.seek(start + len);             // group start / end and anything else: skipped
    }
    return out;
  }

  function readAcoPart(R, version) {
    var n = R.u16(), out = [];
    if (n * 10 > R.left()) throw new Error("swatch");
    for (var i = 0; i < n; i++) {
      var sp = R.u16(), w = R.u16(), x = R.u16(), y = R.u16(), z = R.u16(), name = "";
      if (version === 2) {
        R.u16();                       // high half of the length (always 0 in practice)
        var nl = R.u16();
        name = cleanName(R.utf16(nl));
      }
      var c = "";
      if (sp === 0) c = rgb(w / 257, x / 257, y / 257);
      else if (sp === 1) c = hsb(w / 182.04 % 360, x / 65535, y / 65535);
      else if (sp === 2) c = cmyk(1 - w / 65535, 1 - x / 65535, 1 - y / 65535, 1 - z / 65535);
      else if (sp === 7) c = lab(w / 100, ((x << 16) >> 16) / 100, ((y << 16) >> 16) / 100);
      else if (sp === 8) { var gv = 255 * (1 - clamp(w, 0, 10000) / 10000); c = rgb(gv, gv, gv); }
      if (c && out.length < MAX) out.push({ name: name, c: c });
    }
    return out;
  }
  function readAco(R) {
    var v = R.u16();
    if (v !== 1 && v !== 2) throw new Error("swatch");
    var v1 = readAcoPart(R, v);
    // version 1 is usually followed by the same list again as version 2, with names
    if (v === 1 && R.left() >= 4) {
      try { if (R.u16() === 2) { var v2 = readAcoPart(R, 2); if (v2.length === v1.length) return v2; } } catch (e) {}
    }
    return v1;
  }

  function read(bytes) {
    var R = reader(bytes);
    if (R.left() < 4) throw new Error("swatch");
    var head = R.ascii(4);
    R.seek(0);
    try {
      return head === "ASEF" ? readAse(R) : readAco(R);
    } catch (e) {
      throw new Error("swatch");
    }
  }

  function writeAse(colors, group) {
    var list = (colors || []).filter(function (x) { return x && /^#[0-9a-fA-F]{6}$/.test(x.c); }).slice(0, MAX);
    function nameBytes(s) { s = String(s || "").slice(0, 120); return { s: s, n: s.length + 1 }; }
    var g = nameBytes(group || "orOS");
    var blocks = [];
    blocks.push({ t: 0xC001, len: 2 + g.n * 2, name: g });
    list.forEach(function (x) { var nm = nameBytes(x.name || x.c.toLowerCase()); blocks.push({ t: 0x0001, len: 2 + nm.n * 2 + 4 + 12 + 2, name: nm, c: x.c }); });
    blocks.push({ t: 0xC002, len: 0 });
    var size = 12 + blocks.reduce(function (s, b) { return s + 6 + b.len; }, 0);
    var u8 = new Uint8Array(size), dv = new DataView(u8.buffer), p = 0;
    function str(s) { for (var i = 0; i < s.length; i++) u8[p++] = s.charCodeAt(i); }
    str("ASEF"); dv.setUint16(p, 1); p += 2; dv.setUint16(p, 0); p += 2;
    dv.setUint32(p, blocks.length); p += 4;
    blocks.forEach(function (b) {
      dv.setUint16(p, b.t); p += 2; dv.setUint32(p, b.len); p += 4;
      if (!b.name) return;
      dv.setUint16(p, b.name.n); p += 2;
      for (var i = 0; i < b.name.s.length; i++) { dv.setUint16(p, b.name.s.charCodeAt(i)); p += 2; }
      dv.setUint16(p, 0); p += 2;
      if (b.t !== 0x0001) return;
      str("RGB ");
      var h = b.c.replace("#", "");
      [0, 2, 4].forEach(function (o) { dv.setFloat32(p, parseInt(h.slice(o, o + 2), 16) / 255); p += 4; });
      dv.setUint16(p, 0); p += 2;       // global colour
    });
    return u8;
  }

  var api = { MAX: MAX, read: read, writeAse: writeAse, lab: lab, cmyk: cmyk };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierSwatches = api;
})(typeof window !== "undefined" ? window : this);
