// ============================================================
// orOS Layout — swatch libraries (LY-N3, v1.0.0)
// Pure: read and write Adobe Swatch Exchange files (.ase, the swatch
// file InDesign, Illustrator, Photoshop, Affinity and Scribus share),
// a few ready-made libraries, and turning a list into the document's
// swatches without doubles.
//   - parseASE(bytes): { swatches: [{ name, mode "rgb"|"cmyk", v,
//     spot, group }], groups: [names], skipped } or { error }. RGB,
//     CMYK, Gray (as CMYK black) and LAB (to sRGB, D50) colours; at
//     most 2000; names up to 60 characters; nothing in the file is run.
//   - writeASE(swatches): Uint8Array of a .ase with the document's
//     swatches (RGB as 0-1 floats, CMYK as 0-1 floats).
//   - LIBS: ready-made libraries { id, sw: [...] }, named by the
//     strings swl.lib.<id>
//   - merge(existing, incoming, newId): the incoming ones that are not
//     already there (same name and value), with new ids; a name in use
//     with another value gets " (2)".
// ============================================================
(function (root) {
  "use strict";
  var MAX = 2000;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }

  // CIE Lab (D50) → sRGB 0-255
  function labToRgb(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); }
    var X = 0.96422 * inv(fx), Y = 1 * inv(fy), Z = 0.82521 * inv(fz);
    // Bradford D50 → D65, then XYZ → linear sRGB
    var x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z;
    var y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z;
    var z = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z;
    var rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    var gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    var bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    function g(c) { c = clamp(c, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
    return [g(rl), g(gl), g(bl)];
  }

  function parseASE(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 12) return { error: "short" };
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "ASEF") return { error: "notAse" };
    var n = dv.getUint32(8), pos = 12, out = [], groups = [], group = "", skipped = 0;
    function name(at, end) {
      if (at + 2 > end) return null;
      var len = dv.getUint16(at), s = "";
      if (at + 2 + len * 2 > end) return null;
      for (var i = 0; i < len; i++) { var c = dv.getUint16(at + 2 + i * 2); if (c) s += String.fromCharCode(c); }
      return { s: s.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60), next: at + 2 + len * 2 };
    }
    for (var k = 0; k < n && k < 20000; k++) {
      if (pos + 6 > u8.length) break;
      var type = dv.getUint16(pos), len = dv.getUint32(pos + 2), at = pos + 6, end = at + len;
      if (end > u8.length) return out.length ? { swatches: out, groups: groups, skipped: skipped + 1 } : { error: "broken" };
      if (type === 0xC001) { var gn = name(at, end); group = gn ? gn.s : ""; if (group) groups.push(group); }
      else if (type === 0xC002) group = "";
      else if (type === 0x0001) {
        var nm = name(at, end);
        if (!nm || nm.next + 4 > end) { skipped++; pos = end; continue; }
        var model = String.fromCharCode(u8[nm.next], u8[nm.next + 1], u8[nm.next + 2], u8[nm.next + 3]), p = nm.next + 4;
        var cnt = { "CMYK": 4, "RGB ": 3, "LAB ": 3, "Gray": 1 }[model];
        if (!cnt || p + cnt * 4 + 2 > end || out.length >= MAX) { skipped++; pos = end; continue; }
        var v = [];
        for (var j = 0; j < cnt; j++) v.push(dv.getFloat32(p + j * 4));
        if (!v.every(isFinite)) { skipped++; pos = end; continue; }
        var ctype = dv.getUint16(p + cnt * 4), sw;
        if (model === "CMYK") sw = { mode: "cmyk", v: v.map(function (x) { return r1(clamp(x * 100, 0, 100)); }) };
        else if (model === "RGB ") sw = { mode: "rgb", v: v.map(function (x) { return Math.round(clamp(x * 255, 0, 255)); }) };
        else if (model === "Gray") sw = { mode: "cmyk", v: [0, 0, 0, r1(clamp((1 - v[0]) * 100, 0, 100))] };
        else sw = { mode: "rgb", v: labToRgb(v[0] * 100, v[1], v[2]) };
        sw.name = nm.s || (sw.mode === "rgb" ? "#" + sw.v.map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("") : sw.v.join("/"));
        sw.spot = ctype === 1 ? 1 : 0;
        if (group) sw.group = group;
        out.push(sw);
      } else skipped++;
      pos = end;
    }
    return { swatches: out, groups: groups, skipped: skipped };
  }

  function writeASE(list) {
    var blocks = [];
    (list || []).slice(0, MAX).forEach(function (sw) {
      var nm = String(sw.name || "").slice(0, 60), cmyk = sw.mode === "cmyk";
      var cnt = cmyk ? 4 : 3, len = 2 + (nm.length + 1) * 2 + 4 + cnt * 4 + 2;
      var b = new DataView(new ArrayBuffer(6 + len)), p = 0;
      b.setUint16(p, 0x0001); b.setUint32(p + 2, len); p += 6;
      b.setUint16(p, nm.length + 1); p += 2;
      for (var i = 0; i < nm.length; i++) { b.setUint16(p, nm.charCodeAt(i)); p += 2; }
      b.setUint16(p, 0); p += 2;
      var model = cmyk ? "CMYK" : "RGB ";
      for (var m = 0; m < 4; m++) b.setUint8(p + m, model.charCodeAt(m));
      p += 4;
      (sw.v || []).slice(0, cnt).forEach(function (x) { b.setFloat32(p, cmyk ? x / 100 : x / 255); p += 4; });
      b.setUint16(p, sw.spot ? 1 : 2);
      blocks.push(new Uint8Array(b.buffer));
    });
    var total = 12 + blocks.reduce(function (a, x) { return a + x.length; }, 0);
    var out = new Uint8Array(total), hd = new DataView(out.buffer);
    out.set([65, 83, 69, 70], 0); hd.setUint16(4, 1); hd.setUint16(6, 0); hd.setUint32(8, blocks.length);
    var at = 12;
    blocks.forEach(function (x) { out.set(x, at); at += x.length; });
    return out;
  }

  // ready-made libraries: plain process colours a book or a poster
  // often needs (their names are Layout strings swl.lib.<id>)
  var LIBS = [
    { id: "print", sw: [
      ["Cyan", "cmyk", [100, 0, 0, 0]], ["Magenta", "cmyk", [0, 100, 0, 0]], ["Yellow", "cmyk", [0, 0, 100, 0]],
      ["Red", "cmyk", [0, 100, 100, 0]], ["Green", "cmyk", [100, 0, 100, 0]], ["Blue", "cmyk", [100, 100, 0, 0]],
      ["Rich black", "cmyk", [60, 40, 40, 100]], ["Grey 50%", "cmyk", [0, 0, 0, 50]], ["Grey 20%", "cmyk", [0, 0, 0, 20]]] },
    { id: "sea", sw: [
      ["Deep sea", "cmyk", [100, 70, 20, 40]], ["Aegean", "cmyk", [90, 40, 0, 0]], ["Shallows", "cmyk", [55, 0, 20, 0]],
      ["Foam", "cmyk", [10, 0, 5, 0]], ["Sand", "cmyk", [5, 10, 30, 0]], ["Rock", "cmyk", [30, 30, 40, 40]]] },
    { id: "earth", sw: [
      ["Olive", "cmyk", [40, 20, 90, 30]], ["Terracotta", "cmyk", [10, 70, 85, 10]], ["Ochre", "cmyk", [10, 35, 90, 0]],
      ["Clay", "cmyk", [20, 45, 55, 15]], ["Bark", "cmyk", [40, 60, 70, 50]], ["Linen", "cmyk", [3, 5, 12, 0]]] },
    { id: "pastel", sw: [
      ["Rose", "rgb", [244, 194, 194]], ["Peach", "rgb", [255, 218, 185]], ["Butter", "rgb", [255, 241, 173]],
      ["Mint", "rgb", [189, 236, 207]], ["Sky", "rgb", [189, 222, 245]], ["Lilac", "rgb", [215, 198, 238]]] },
    { id: "grey", sw: [10, 20, 30, 40, 50, 60, 70, 80, 90].map(function (k) { return ["K " + k + "%", "cmyk", [0, 0, 0, k]]; }) }
  ];
  LIBS.forEach(function (l) { l.sw = l.sw.map(function (s) { return { name: s[0], mode: s[1], v: s[2] }; }); });

  function same(a, b) { return a.mode === b.mode && a.v.length === b.v.length && a.v.every(function (x, i) { return Math.abs(x - b.v[i]) < 0.05; }); }
  function merge(existing, incoming, newId) {
    var have = (existing || []).slice(), out = [];
    (incoming || []).forEach(function (sw) {
      if (!sw || !Array.isArray(sw.v)) return;
      var nm = String(sw.name || "").slice(0, 60);
      if (have.some(function (h) { return String(h.name) === nm && same(h, sw); })) return;
      var base = nm, n = 2;
      while (have.some(function (h) { return String(h.name) === nm; })) nm = (base.slice(0, 54) + " (" + (n++) + ")");
      var s = { id: newId(), name: nm, mode: sw.mode === "cmyk" ? "cmyk" : "rgb", v: sw.v.slice(0, sw.mode === "cmyk" ? 4 : 3) };
      if (sw.spot) s.ext = { spot: 1 };
      have.push(s); out.push(s);
    });
    return out;
  }

  var api = { MAX: MAX, parseASE: parseASE, writeASE: writeASE, labToRgb: labToRgb, LIBS: LIBS, merge: merge };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_SWLIB = api;
})(typeof window !== "undefined" ? window : this);
