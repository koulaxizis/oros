// ============================================================
// orOS designkit — fonts.js (v1.1.0)
// Font families a Layout document names besides the built-in Noto
// ones. Owner: Layout.
//   - "fs_<id>": a Fontsource family (open licences, mostly SIL OFL),
//     fetched as TTF subset files on demand and kept in this
//     device's Cache Storage, so it works offline after its first use.
//   - "uf_<16 hex>": a font file of the user's, stored once on the
//     orOS disk as /internal/Fonts/<sha256>.ttf (Vault syncs it like
//     any file; a document keeps only the file name). The files on
//     the disk are the user's font library on every device.
// A style names the family in ext.fam and keeps its built-in `font`
// as the stand-in (designkit/text.js); the document lists its
// families in setup.ext.fonts = [{ id, name, fb, r, b, i, bi }]
// (fb = the stand-in, r/b/i/bi = file names of a uf_ family), so a
// device that does not have a font yet still knows its name.
// Fonts are checked before they are kept: TrueType outlines only
// (jsPDF cannot embed PostScript outlines), never a font whose
// licence forbids embedding (OS/2 fsType "restricted"), ≤ 15 MB. A
// WOFF or WOFF2 file is unpacked to TTF/OTF first (WOFF2 since 1.1.0:
// vendor/brotli/ loads on the first .woff2 only).
// 1.1.0 (Settings › Fonts, FM-1) adds, without changing what 1.0
// callers get: coverage() (which Greek, polytonic, Latin and Cyrillic
// letters a font has), licence() (what the file says about its
// licence, fsType in plain categories, open: OFL / Apache), inspect(),
// library({ all: true }) (PostScript-outline files too, marked cff),
// remove() (a font file to the orOS Trash) and catalog() entries
// with poly (greek-ext) and lic (the Fontsource licence id).
// Exposes orosDK.fonts (browser) or module.exports (Node: the pure
// parts).
// ============================================================
(function (root) {
  "use strict";

  var T;
  if (typeof module !== "undefined" && module.exports) T = require("./text.js");
  else T = root.orosDK.text;

  var FOLDER = "/internal/Fonts";
  var FILE_RE = /^[0-9a-f]{64}\.ttf$/;
  var MAX = 15 * 1024 * 1024, MAX_FONTS = 40;
  var CACHE = "oros-atelier-fonts";        // shared with Atelier (same files)
  var CATALOG = "https://api.fontsource.org/v1/fonts";
  var CDN = "https://cdn.jsdelivr.net/fontsource/fonts/";
  var SUBSETS = ["latin", "latin-ext", "greek", "greek-ext"];
  var BUILTIN = ["serif", "sans", "mono"];

  // ---------- 1. Ids and names ----------
  function isFam(id) { return typeof id === "string" && id.length <= 63 && T.FAM_RE.test(id); }
  function fsIdOf(slug) { return "fs_" + String(slug).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function fsSlug(id) { return id.slice(3).replace(/_/g, "-"); }
  function ufIdOf(file) { return "uf_" + file.slice(0, 16); }
  // "Times New Roman" / "TimesNewRomanPS-BoldMT" / "ABCDEF+Constantia,Bold"
  // → "timesnewroman" / "constantia": what two names of one family share.
  var STYLE_WORDS = /(regular|book|normal|medium|semibold|demibold|bold|extrabold|black|heavy|light|thin|italic|oblique|condensed|ps|mt)$/;
  function squash(name) {
    var s = String(name || "").replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    var prev;
    do { prev = s; s = s.replace(STYLE_WORDS, ""); } while (s !== prev && s.length > 3);
    return s;
  }

  // ---------- 2. Font files ----------
  function tables(dv) {
    var n = dv.getUint16(4), out = {};
    for (var t = 0; t < n; t++) {
      var off = 12 + t * 16;
      var tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      out[tag] = { off: dv.getUint32(off + 8), len: dv.getUint32(off + 12) };
    }
    return out;
  }
  function utf16(dv, o, n) {
    var s = "";
    for (var i = 0; i + 1 < n; i += 2) s += String.fromCharCode(dv.getUint16(o + i));
    return s;
  }
  function latin1(dv, o, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i));
    return s;
  }
  // The name table's strings with these ids → { id: { rank, s } }
  // (Windows English first, then any Windows, then Mac Roman).
  function nameStrings(dv, tb, ids) {
    var names = {};
    if (!tb.name) return names;
    var o = tb.name.off, count = dv.getUint16(o + 2), str = o + dv.getUint16(o + 4);
    for (var r = 0; r < count; r++) {
      var ro = o + 6 + r * 12;
      var pid = dv.getUint16(ro), eid = dv.getUint16(ro + 2), lang = dv.getUint16(ro + 4), nid = dv.getUint16(ro + 6);
      var len = dv.getUint16(ro + 8), off = str + dv.getUint16(ro + 10);
      if (ids.indexOf(nid) < 0 || off + len > dv.byteLength) continue;
      var rank = pid === 3 && lang === 0x409 ? 3 : pid === 3 ? 2 : pid === 1 && eid === 0 ? 1 : 0;
      if (!rank || (names[nid] && names[nid].rank >= rank)) continue;
      names[nid] = { rank: rank, s: (pid === 3 ? utf16(dv, off, len) : latin1(dv, off, len)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() };
    }
    return names;
  }
  // What a TTF says about itself: { family, sub, b, i, fb, fsType,
  // glyf } (family / sub: the typographic names, else the legacy ones).
  function info(buf) {
    var dv = new DataView(buf), tb = tables(dv), names = nameStrings(dv, tb, [1, 2, 16, 17]);
    Object.keys(names).forEach(function (k) { names[k].s = names[k].s.replace(/[\u0000-\u001F]/g, "").trim(); });
    var fam = (names[16] || names[1] || {}).s || "", sub = (names[17] || names[2] || {}).s || "";
    var b = 0, i = 0, fsType = 0, fb = "serif";
    if (tb["OS/2"]) {
      var os = tb["OS/2"].off, sel = dv.getUint16(os + 62);
      fsType = dv.getUint16(os + 8);
      i = sel & 1 ? 1 : 0; b = sel & 32 ? 1 : 0;
      var pan = dv.getUint8(os + 32), serif = dv.getUint8(os + 33), prop = dv.getUint8(os + 35);
      if (pan === 2 && serif >= 11 && serif <= 13) fb = "sans";
      if (pan === 2 && prop === 9) fb = "mono";
    } else if (tb.head) {
      var ms = dv.getUint16(tb.head.off + 44);
      b = ms & 1 ? 1 : 0; i = ms & 2 ? 1 : 0;
    }
    if (/sans/i.test(fam)) fb = "sans";
    if (/mono|code|courier/i.test(fam)) fb = "mono";
    return { family: fam.slice(0, 60), sub: sub.slice(0, 40), b: b, i: i, fb: fb, fsType: fsType, glyf: !!tb.glyf };
  }

  // A WOFF (1.0) file → the TTF it packs (zlib through
  // DecompressionStream); a WOFF2 one through woff2() (1.1.0).
  // Promise of an ArrayBuffer, or null.
  function unwoff(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength >= 48 && latin1(dv, 0, 4) === "wOF2") {
      return brotli().then(function (b) { return woff2(buf, b.decompress); }).then(null, function () { return null; });
    }
    if (latin1(dv, 0, 4) !== "wOFF") return Promise.resolve(buf);
    if (typeof DecompressionStream === "undefined") return Promise.resolve(null);
    var n = dv.getUint16(12), dir = [];
    for (var t = 0; t < n; t++) {
      var o = 44 + t * 20;
      dir.push({ tag: dv.getUint32(o), off: dv.getUint32(o + 4), clen: dv.getUint32(o + 8), olen: dv.getUint32(o + 12), sum: dv.getUint32(o + 16) });
    }
    return Promise.all(dir.map(function (d) {
      var raw = new Uint8Array(buf, d.off, d.clen);
      if (d.clen >= d.olen) return Promise.resolve(raw.slice(0));
      var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    })).then(function (datas) {
      var size = 12 + 16 * n;
      datas.forEach(function (d) { size += (d.length + 3) & ~3; });
      if (size > MAX) return null;
      var out = new Uint8Array(size), ov = new DataView(out.buffer), pos = 12 + 16 * n;
      ov.setUint32(0, dv.getUint32(4));
      ov.setUint16(4, n);
      var p2 = 1, lg = 0;
      while (p2 * 2 <= n) { p2 *= 2; lg++; }
      ov.setUint16(6, p2 * 16); ov.setUint16(8, lg); ov.setUint16(10, n * 16 - p2 * 16);
      dir.forEach(function (d, k) {
        var e = 12 + k * 16;
        ov.setUint32(e, d.tag); ov.setUint32(e + 4, d.sum); ov.setUint32(e + 8, pos); ov.setUint32(e + 12, datas[k].length);
        out.set(datas[k], pos);
        pos += (datas[k].length + 3) & ~3;
      });
      return out.buffer;
    }, function () { return null; });
  }

  // ---------- 2b. WOFF2 (1.1.0) ----------
  // A WOFF2 file → the TTF/OTF it packs, as the W3C WOFF2 spec builds
  // it back: one Brotli stream holds every table; "glyf"/"loca" may
  // come transformed (version 0) and "hmtx" too (version 1). Pure: the
  // Brotli decoder is passed in. Throws on anything it does not
  // understand; font collections (ttcf) are refused.
  var KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
  function tagNum(tag) { return ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0; }
  function Reader(u8, off, end) { this.b = u8; this.p = off || 0; this.end = end === undefined ? u8.length : end; }
  Reader.prototype.need = function (n) { if (this.p + n > this.end) throw new Error("woff2: short"); };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  Reader.prototype.u16 = function () { this.need(2); var v = (this.b[this.p] << 8) | this.b[this.p + 1]; this.p += 2; return v; };
  Reader.prototype.i16 = function () { var v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; };
  Reader.prototype.u32 = function () { this.need(4); var b = this.b, p = this.p; this.p += 4; return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; };
  Reader.prototype.base128 = function () {
    var v = 0;
    for (var i = 0; i < 5; i++) {
      var c = this.u8();
      if (i === 0 && c === 0x80) throw new Error("woff2: base128");
      if (v & 0xFE000000) throw new Error("woff2: base128");
      v = (v * 128) + (c & 0x7F);
      if (!(c & 0x80)) return v;
    }
    throw new Error("woff2: base128");
  };
  Reader.prototype.u255 = function () {
    var c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  };
  Reader.prototype.bytes = function (n) { this.need(n); var v = this.b.subarray(this.p, this.p + n); this.p += n; return v; };

  // Growable byte writer (big endian).
  function Writer(n) { this.b = new Uint8Array(n || 1024); this.p = 0; }
  Writer.prototype.room = function (n) {
    if (this.p + n <= this.b.length) return;
    var len = this.b.length * 2;
    while (len < this.p + n) len *= 2;
    var nb = new Uint8Array(len); nb.set(this.b.subarray(0, this.p)); this.b = nb;
  };
  Writer.prototype.u8 = function (v) { this.room(1); this.b[this.p++] = v & 255; };
  Writer.prototype.u16 = function (v) { this.room(2); this.b[this.p++] = (v >> 8) & 255; this.b[this.p++] = v & 255; };
  Writer.prototype.u32 = function (v) { this.room(4); this.b[this.p++] = (v >>> 24) & 255; this.b[this.p++] = (v >>> 16) & 255; this.b[this.p++] = (v >>> 8) & 255; this.b[this.p++] = v & 255; };
  Writer.prototype.put = function (u8) { this.room(u8.length); this.b.set(u8, this.p); this.p += u8.length; };
  Writer.prototype.pad4 = function () { while (this.p & 3) this.u8(0); };
  Writer.prototype.out = function () { return this.b.slice(0, this.p); };

  function withSign(flag, v) { return flag & 1 ? v : -v; }
  // The transformed glyf table → { glyf, loca, xMin[] } (W3C WOFF2 §5.1).
  function unglyf(data, locaFormat) {
    var r = new Reader(data);
    r.u16();                                       // reserved
    var opt = r.u16(), nGlyphs = r.u16(), fmt = r.u16();
    var sizes = [];
    for (var k = 0; k < 7; k++) sizes.push(r.u32());
    var off = r.p, streams = [];
    sizes.forEach(function (n) { if (off + n > data.length) throw new Error("woff2: glyf streams"); streams.push(new Reader(data, off, off + n)); off += n; });
    var nCont = streams[0], nPts = streams[1], flags = streams[2], gl = streams[3], comp = streams[4], bbox = streams[5], instr = streams[6];
    var bmLen = ((nGlyphs + 31) >> 5) << 2, bm = bbox.bytes(bmLen);
    var ov = null;                                 // OVERLAP_SIMPLE bits, after the streams
    if (opt & 1) { if (off + ((nGlyphs + 7) >> 3) > data.length) throw new Error("woff2: overlap"); ov = data.subarray(off, off + ((nGlyphs + 7) >> 3)); }
    var out = new Writer(Math.max(1024, data.length * 2)), loca = [], xMin = new Int16Array(nGlyphs);
    for (var g = 0; g < nGlyphs; g++) {
      loca.push(out.p);
      var nc = nCont.i16(), hasBox = bm[g >> 3] & (0x80 >> (g & 7));
      if (nc === 0) { if (hasBox) throw new Error("woff2: empty glyph box"); continue; }
      if (nc === -1) {
        if (!hasBox) throw new Error("woff2: composite box");
        var bx = [bbox.i16(), bbox.i16(), bbox.i16(), bbox.i16()];
        var start = comp.p, more = true, instrs = false;
        while (more) {
          var f = comp.u16();
          comp.u16();                              // glyph index
          comp.bytes(f & 1 ? 4 : 2);
          if (f & 0x8) comp.bytes(2); else if (f & 0x40) comp.bytes(4); else if (f & 0x80) comp.bytes(8);
          if (f & 0x100) instrs = true;
          more = !!(f & 0x20);
        }
        var cbytes = data.subarray(start, comp.p);
        out.u16(0xFFFF); bx.forEach(function (v) { out.u16(v & 0xFFFF); });
        out.put(cbytes);
        if (instrs) { var il = gl.u255(); out.u16(il); out.put(instr.bytes(il)); }
        xMin[g] = bx[0];
      } else if (nc > 0) {
        var ends = [], total = 0;
        for (var c = 0; c < nc; c++) { total += nPts.u255(); ends.push(total - 1); }
        var xs = new Int32Array(total), ys = new Int32Array(total), on = new Uint8Array(total), x = 0, y = 0;
        for (var i = 0; i < total; i++) {
          var fl = flags.u8(), dx, dy, b0, b1, b2;
          on[i] = fl & 0x80 ? 0 : 1; fl &= 0x7F;
          if (fl < 10) { dx = 0; dy = withSign(fl, ((fl & 14) << 7) + gl.u8()); }
          else if (fl < 20) { dx = withSign(fl, (((fl - 10) & 14) << 7) + gl.u8()); dy = 0; }
          else if (fl < 84) { b0 = fl - 20; b1 = gl.u8(); dx = withSign(fl, 1 + (b0 & 0x30) + (b1 >> 4)); dy = withSign(fl >> 1, 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F)); }
          else if (fl < 120) { b0 = fl - 84; b1 = gl.u8(); b2 = gl.u8(); dx = withSign(fl, 1 + (Math.floor(b0 / 12) << 8) + b1); dy = withSign(fl >> 1, 1 + (((b0 % 12) >> 2) << 8) + b2); }
          else if (fl < 124) { b0 = gl.u8(); b1 = gl.u8(); b2 = gl.u8(); dx = withSign(fl, (b0 << 4) + (b1 >> 4)); dy = withSign(fl >> 1, ((b1 & 0x0F) << 8) + b2); }
          else { b0 = gl.u16(); b1 = gl.u16(); dx = withSign(fl, b0); dy = withSign(fl >> 1, b1); }
          x += dx; y += dy; xs[i] = x; ys[i] = y;
        }
        var ilen = gl.u255(), ins = instr.bytes(ilen), box;
        if (hasBox) box = [bbox.i16(), bbox.i16(), bbox.i16(), bbox.i16()];
        else {
          box = [xs[0], ys[0], xs[0], ys[0]];
          for (var q = 1; q < total; q++) { box[0] = Math.min(box[0], xs[q]); box[1] = Math.min(box[1], ys[q]); box[2] = Math.max(box[2], xs[q]); box[3] = Math.max(box[3], ys[q]); }
        }
        xMin[g] = box[0];
        out.u16(nc); box.forEach(function (v) { out.u16(v & 0xFFFF); });
        ends.forEach(function (e) { out.u16(e); });
        out.u16(ilen); out.put(ins);
        // flags + coordinates, plain TrueType encoding (short where it fits)
        var fw = [], xw = new Writer(total * 2 + 4), yw = new Writer(total * 2 + 4), px = 0, py = 0;
        for (var j = 0; j < total; j++) {
          var f2 = on[j] ? 1 : 0, ddx = xs[j] - px, ddy = ys[j] - py;
          if (ddx === 0) f2 |= 0x10;
          else if (ddx > -256 && ddx < 256) { f2 |= 0x02 | (ddx > 0 ? 0x10 : 0); xw.u8(Math.abs(ddx)); }
          else xw.u16(ddx & 0xFFFF);
          if (ddy === 0) f2 |= 0x20;
          else if (ddy > -256 && ddy < 256) { f2 |= 0x04 | (ddy > 0 ? 0x20 : 0); yw.u8(Math.abs(ddy)); }
          else yw.u16(ddy & 0xFFFF);
          if (j === 0 && ov && (ov[g >> 3] & (0x80 >> (g & 7)))) f2 |= 0x40;
          fw.push(f2); px = xs[j]; py = ys[j];
        }
        fw.forEach(function (v) { out.u8(v); });
        out.put(xw.out()); out.put(yw.out());
      } else throw new Error("woff2: contours");
      out.pad4();
    }
    loca.push(out.p);
    var glyf = out.out(), lw = new Writer((nGlyphs + 1) * 4);
    var lf = locaFormat === undefined ? fmt : locaFormat;
    loca.forEach(function (o) { if (lf) lw.u32(o); else lw.u16(o >> 1); });
    return { glyf: glyf, loca: lw.out(), xMin: xMin, nGlyphs: nGlyphs, fmt: fmt };
  }
  // The transformed hmtx table (W3C WOFF2 §5.4).
  function unhmtx(data, nH, nGlyphs, xMin) {
    var r = new Reader(data), f = r.u8(), adv = [], lsb = [];
    for (var i = 0; i < nH; i++) adv.push(r.u16());
    for (i = 0; i < nH; i++) lsb.push(f & 1 ? xMin[i] : r.i16());
    for (i = nH; i < nGlyphs; i++) lsb.push(f & 2 ? xMin[i] : r.i16());
    var w = new Writer(nH * 4 + (nGlyphs - nH) * 2);
    for (i = 0; i < nGlyphs; i++) { if (i < nH) w.u16(adv[i]); w.u16(lsb[i] & 0xFFFF); }
    return w.out();
  }
  function checksum(u8) {
    var sum = 0, n = u8.length;
    for (var i = 0; i < n; i += 4) sum = (sum + (((u8[i] << 24) | ((u8[i + 1] || 0) << 16) | ((u8[i + 2] || 0) << 8) | (u8[i + 3] || 0)) >>> 0)) >>> 0;
    return sum;
  }
  // { tag: Uint8Array } → an sfnt ArrayBuffer (tables sorted, 4-aligned,
  // checksums and head.checkSumAdjustment set).
  function sfnt(flavor, tbls) {
    var tags = Object.keys(tbls).sort(function (a, b) { return tagNum(a) - tagNum(b); }), n = tags.length;
    if (tbls.head && tbls.head.length >= 12) { tbls.head = tbls.head.slice(); tbls.head.set([0, 0, 0, 0], 8); }
    var size = 12 + 16 * n;
    tags.forEach(function (t) { size += (tbls[t].length + 3) & ~3; });
    if (size > MAX) throw new Error("woff2: size");
    var out = new Uint8Array(size), dv = new DataView(out.buffer), pos = 12 + 16 * n, p2 = 1, lg = 0;
    while (p2 * 2 <= n) { p2 *= 2; lg++; }
    dv.setUint32(0, flavor); dv.setUint16(4, n); dv.setUint16(6, p2 * 16); dv.setUint16(8, lg); dv.setUint16(10, n * 16 - p2 * 16);
    var headAt = -1;
    tags.forEach(function (t, k) {
      var d = tbls[t], e = 12 + k * 16;
      dv.setUint32(e, tagNum(t)); dv.setUint32(e + 4, checksum(d)); dv.setUint32(e + 8, pos); dv.setUint32(e + 12, d.length);
      out.set(d, pos);
      if (t === "head") headAt = pos;
      pos += (d.length + 3) & ~3;
    });
    if (headAt >= 0) dv.setUint32(headAt + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
    return out.buffer;
  }
  function woff2(buf, decompress) {
    var u8 = new Uint8Array(buf), r = new Reader(u8);
    if (r.u32() !== 0x774F4632) throw new Error("woff2: signature");
    var flavor = r.u32();
    if (flavor === 0x74746366) throw new Error("woff2: collection");
    r.u32();                                       // length
    var n = r.u16();
    r.u16(); r.u32();                              // reserved, totalSfntSize
    var clen = r.u32();
    r.p = 48;
    if (!n || n > 200) throw new Error("woff2: tables");
    var dir = [];
    for (var t = 0; t < n; t++) {
      var fl = r.u8(), tag = (fl & 0x3F) === 0x3F ? String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) : KNOWN[fl & 0x3F];
      var ver = fl >> 6, olen = r.base128(), tr = (tag === "glyf" || tag === "loca") ? ver === 0 : ver !== 0;
      var len = tr ? r.base128() : olen;
      if (olen > MAX || len > MAX) throw new Error("woff2: table size");
      dir.push({ tag: tag, ver: ver, olen: olen, len: len, tr: tr });
    }
    if (r.p + clen > u8.length) throw new Error("woff2: short");
    var raw = decompress(u8.subarray(r.p, r.p + clen));
    if (!raw) throw new Error("woff2: brotli");
    raw = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    var tbls = {}, at = 0, byTag = {};
    dir.forEach(function (d) {
      if (at + d.len > raw.length) throw new Error("woff2: data");
      byTag[d.tag] = d; d.data = raw.subarray(at, at + d.len); at += d.len;
    });
    var gx = null;
    if (byTag.glyf && byTag.glyf.tr) {
      if (byTag.glyf.ver !== 0 || !byTag.loca || !byTag.loca.tr) throw new Error("woff2: glyf");
      var hd = byTag.head && byTag.head.data;
      gx = unglyf(byTag.glyf.data, hd && hd.length >= 52 ? ((hd[50] << 8) | hd[51]) : undefined);
      tbls.glyf = gx.glyf; tbls.loca = gx.loca;
    }
    dir.forEach(function (d) {
      if (d.tag === "glyf" || d.tag === "loca") { if (!d.tr) tbls[d.tag] = d.data.slice(); return; }
      if (!d.tr) { tbls[d.tag] = d.data.slice(); return; }
      if (d.tag === "hmtx" && d.ver === 1 && gx && byTag.hhea && byTag.maxp) {
        var hh = byTag.hhea.data, mp = byTag.maxp.data;
        tbls.hmtx = unhmtx(d.data, (hh[34] << 8) | hh[35], (mp[4] << 8) | mp[5], gx.xMin);
        return;
      }
      throw new Error("woff2: transform " + d.tag);
    });
    return sfnt(flavor, tbls);
  }
  // The Brotli decoder (vendor/brotli/, Apache-2.0 + MIT), once.
  var brotliP = null;
  function brotli() {
    if (root.orosBrotli) return Promise.resolve(root.orosBrotli);
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      require("../vendor/brotli/brotli.min.js");
      return Promise.resolve(globalThis.orosBrotli);
    }
    if (brotliP) return brotliP;
    brotliP = new Promise(function (resolve, reject) {
      var s = document.createElement("script"), v = root.orosI18n && root.orosI18n.ver;
      s.src = "../vendor/brotli/brotli.min.js" + (v ? "?v=" + encodeURIComponent(v) : "");
      s.onload = function () { if (root.orosBrotli) resolve(root.orosBrotli); else reject(new Error("brotli")); };
      s.onerror = function () { reject(new Error("brotli")); };
      document.head.appendChild(s);
    });
    brotliP.then(null, function () { brotliP = null; });
    return brotliP;
  }

  // ---------- 2c. What a font covers, what its licence says (1.1.0) ----------
  // Letter sets: [first, last] code point ranges.
  var SETS = {
    // monotonic Greek: the alphabet, tonos and dialytika, ano teleia
    greek: [[0x0386, 0x0386], [0x0387, 0x0387], [0x0388, 0x038A], [0x038C, 0x038C], [0x038E, 0x03A1], [0x03A3, 0x03CE]],
    // polytonic: every letter of Greek Extended
    poly: [[0x1F00, 0x1F15], [0x1F18, 0x1F1D], [0x1F20, 0x1F45], [0x1F48, 0x1F4D], [0x1F50, 0x1F57], [0x1F59, 0x1F59], [0x1F5B, 0x1F5B], [0x1F5D, 0x1F5D], [0x1F5F, 0x1F7D], [0x1F80, 0x1FB4], [0x1FB6, 0x1FBC], [0x1FC2, 0x1FC4], [0x1FC6, 0x1FCC], [0x1FD0, 0x1FD3], [0x1FD6, 0x1FDB], [0x1FE0, 0x1FEC], [0x1FF2, 0x1FF4], [0x1FF6, 0x1FFC]],
    latin: [[0x0020, 0x007E]],
    latinExt: [[0x00A0, 0x017F]],
    cyr: [[0x0401, 0x0401], [0x0410, 0x044F], [0x0451, 0x0451]]
  };
  var SET_KEYS = ["greek", "poly", "latin", "latinExt", "cyr"];
  function setPoints(k) {
    var out = [];
    SETS[k].forEach(function (r) { for (var c = r[0]; c <= r[1]; c++) out.push(c); });
    return out;
  }
  // A font (TTF/OTF ArrayBuffer, or the map of parseTTF) → { greek: {
  // have, total, missing }, poly, latin, latinExt, cyr }; missing: the
  // first 80 letters it lacks, as a string.
  function coverage(src) {
    var map = src && src.byteLength !== undefined ? T.parseTTF(src).map : (src && src.map) || src || {};
    var out = {};
    SET_KEYS.forEach(function (k) {
      var pts = setPoints(k), have = 0, miss = "";
      pts.forEach(function (c) {
        if (map[c]) have++;
        else if (miss.length < 80) miss += String.fromCharCode(c);
      });
      out[k] = { have: have, total: pts.length, missing: miss };
    });
    return out;
  }
  // "full" (every letter), "most" (95% or more), "some" (30% or
  // more), "few" (a handful: a few symbols, no real alphabet), "none".
  function level(c) {
    if (!c || !c.total || !c.have) return "none";
    if (c.have === c.total) return "full";
    var r = c.have / c.total;
    return r >= 0.95 ? "most" : r >= 0.3 ? "some" : "few";
  }
  // Fontsource subsets → the same levels, before a file is fetched.
  function subsetLevels(subs) {
    subs = Array.isArray(subs) ? subs : [];
    function has(s) { return subs.indexOf(s) >= 0 ? "full" : "none"; }
    return { greek: has("greek"), poly: has("greek-ext"), latin: has("latin"), latinExt: has("latin-ext"), cyr: has("cyrillic") };
  }
  var OFL_RE = /SIL Open Font|Open Font Licen[cs]e|\bOFL\b|openfontlicense\.org|scripts\.sil\.org\/OFL/i;
  var APACHE_RE = /Apache Licen[cs]e|apache\.org\/licenses/i;
  // What the file says about its licence: { copyright, version, maker,
  // designer, text (≤ 2000), url (http(s) only), embed: "installable" |
  // "editable" | "print" | "restricted", noSubset, bitmapOnly, kind:
  // "ofl" | "apache" | "", open }. Embedding (OS/2 fsType): with more
  // than one bit set the least restrictive counts, as the spec says.
  function licence(buf) {
    var dv = new DataView(buf), tb = tables(dv), n = nameStrings(dv, tb, [0, 5, 8, 9, 13, 14]), fsType = 0;
    if (tb["OS/2"] && tb["OS/2"].off + 10 <= dv.byteLength) fsType = dv.getUint16(tb["OS/2"].off + 8);
    function s(id, max) { return ((n[id] || {}).s || "").slice(0, max); }
    var f = fsType & 0x000F;
    var embed = f === 0 ? "installable" : f & 0x0008 ? "editable" : f & 0x0004 ? "print" : "restricted";
    var url = s(14, 300);
    if (!/^https?:\/\/[^\s<>"]+$/i.test(url)) url = "";
    var all = s(13, 4000) + " " + url;
    var kind = OFL_RE.test(all) ? "ofl" : APACHE_RE.test(all) ? "apache" : "";
    return {
      copyright: s(0, 400), version: s(5, 100), maker: s(8, 100), designer: s(9, 200), text: s(13, 2000), url: url,
      embed: embed, fsType: fsType, noSubset: !!(fsType & 0x0100), bitmapOnly: !!(fsType & 0x0200), kind: kind, open: !!kind
    };
  }
  // Everything Settings › Fonts shows about one file: { info, cov, lic,
  // cff, glyphs, map (code point → glyph) } or null when it is not a font.
  function inspect(buf) {
    try {
      var m = T.parseTTF(buf), nfo = info(buf);
      return { info: nfo, cov: coverage(m), lic: licence(buf), cff: !nfo.glyf, glyphs: m.adv.length, map: m.map };
    } catch (e) { return null; }
  }

  // Can this file be kept? → { ok, err, info }; err: "size" | "type" |
  // "outlines" (PostScript) | "restricted" (licence forbids embedding).
  // opts.cff: PostScript outlines are fine (Atelier keeps the fonts a
  // Canva PowerPoint brought and draws their text as a picture in a
  // PDF; Layout never asks, so its library stays TrueType only).
  function check(buf, opts) {
    if (!buf || buf.byteLength > MAX) return { ok: false, err: "size" };
    var nfo;
    try { T.parseTTF(buf); nfo = info(buf); } catch (e) { return { ok: false, err: "type" }; }
    if (!nfo.glyf && !(opts && opts.cff)) return { ok: false, err: "outlines", info: nfo };
    if ((nfo.fsType & 0x000F) === 0x0002) return { ok: false, err: "restricted", info: nfo };
    if (!nfo.family) return { ok: false, err: "type" };
    return { ok: true, err: "", info: nfo };
  }

  // ---------- 3. A document's families ----------
  function variantOf(b, i) { return b ? (i ? "bi" : "b") : (i ? "i" : "r"); }
  function normEntry(e) {
    if (!e || !isFam(e.id)) return null;
    var o = { id: e.id, name: String(e.name || "").replace(/[\u0000-\u001F]/g, "").slice(0, 60) || e.id, fb: BUILTIN.indexOf(e.fb) >= 0 ? e.fb : "serif" };
    if (e.id.indexOf("uf_") === 0) {
      ["r", "b", "i", "bi"].forEach(function (v) { if (FILE_RE.test(e[v] || "")) o[v] = e[v]; });
      if (!o.r) { var any = o.b || o.i || o.bi; if (!any) return null; o.r = any; }
    }
    return o;
  }
  function docFonts(doc) {
    var x = doc && doc.setup && doc.setup.ext, out = [], seen = {};
    (x && Array.isArray(x.fonts) ? x.fonts : []).forEach(function (e) {
      var o = normEntry(e);
      if (o && !seen[o.id]) { seen[o.id] = 1; out.push(o); }
    });
    return out;
  }
  // The families the document's styles name.
  function famsUsed(doc) {
    var ids = {};
    (doc.pstyles || []).concat(doc.cstyles || []).forEach(function (s) {
      var f = s.ext && s.ext.fam;
      if (isFam(f)) ids[f] = 1;
    });
    return Object.keys(ids).sort();
  }
  function fontsourceUrls(id) {
    var slug = fsSlug(id);
    function files(w, st) { return SUBSETS.map(function (s) { return CDN + slug + "@latest/" + s + "-" + w + "-" + st + ".ttf"; }); }
    return { r: files(400, "normal"), b: files(700, "normal"), i: files(400, "italic"), bi: files(700, "italic") };
  }
  // Registers every family the document names (once per family) and
  // returns the font keys its styles may need.
  function register(doc) {
    var byId = {}, keys = [];
    docFonts(doc).forEach(function (e) { byId[e.id] = e; });
    famsUsed(doc).forEach(function (id) {
      var e = byId[id] || fromLibrary(id) || { id: id, name: id.indexOf("fs_") === 0 ? fsName(id) : id, fb: "serif" }, urls;
      if (id.indexOf("fs_") === 0) urls = fontsourceUrls(id);
      else {
        if (!e.r) return;
        urls = {};
        ["r", "b", "i", "bi"].forEach(function (v) { urls[v] = e[v] ? ["asset:" + e[v]] : []; });
      }
      if (!T.registerFamily(id, { name: e.name, urls: urls, fallback: e.fb })) return;
      ["r", "b", "i", "bi"].forEach(function (v) { keys.push(id + "-" + v); });
    });
    return keys;
  }
  // A uf_ family the list does not have (two devices added fonts at
  // once and one list won): its files on this disk, by the hash
  // prefix in the id (known after library()).
  function fromLibrary(id) {
    if (id.indexOf("uf_") !== 0) return null;
    var lib = Object.keys(known).map(function (f) { return known[f]; }).filter(function (r) { return r && !r.cff; });
    return families(lib).filter(function (f) { return f.id === id; })[0] || null;
  }
  function fsName(id) { return fsSlug(id).split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" "); }
  // The document with this family listed (pure; the caller stamps).
  function withEntry(list, e) {
    var o = normEntry(e);
    if (!o) return list;
    var out = list.filter(function (x) { return x.id !== o.id; });
    out.push(o);
    return out.slice(-MAX_FONTS);
  }

  // ---------- 4. Files: the disk, the cache, the network ----------
  function fs() {
    try { return (root.parent && root.parent.orosFS) || root.orosFS || null; }
    catch (e) { return root.orosFS || null; }
  }
  // A copy made in this window: the shell's orosFS (and a file picked
  // through it) gives ArrayBuffers of the shell's window, which fail
  // text.js's `instanceof ArrayBuffer`.
  function local(ab) { return new Uint8Array(ab).slice().buffer; }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(buf) { return root.crypto.subtle.digest("SHA-256", buf).then(hex); }
  function cached(url) {
    if (typeof caches === "undefined") return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(url); }, function () { return null; });
  }
  function keep(url, res) {
    if (typeof caches === "undefined") return;
    caches.open(CACHE).then(function (c) { return c.put(url, res); }).then(null, function () {});
  }
  // designkit/text.js fetcher: "asset:<file>" from the disk, a web
  // address from the cache first. null = not there (a subset or weight
  // a family does not have is remembered as such).
  function fetcher(url) {
    if (url.indexOf("asset:") === 0) {
      var name = url.slice(6), F = fs();
      if (!F || !FILE_RE.test(name)) return Promise.resolve(null);
      return F.read(FOLDER + "/" + name).then(function (b) { return b.arrayBuffer().then(local); }, function () { return null; });
    }
    return cached(url).then(function (hit) {
      if (hit) return hit.status === 204 ? null : hit.arrayBuffer();
      return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" }).then(function (r) {
        if (r.status === 404 || r.status === 403) { keep(url, new Response(null, { status: 204 })); return null; }
        if (!r.ok) throw new Error("font " + r.status);
        return r.arrayBuffer().then(function (ab) {
          if (ab.byteLength > MAX) throw new Error("font size");
          keep(url, new Response(ab, { headers: { "Content-Type": "font/ttf" } }));
          return ab;
        });
      });
    });
  }

  // The font files on the disk: [{ file, family, sub, b, i, fb }],
  // TrueType only; opts.all (1.1.0): PostScript-outline files too, each
  // record with cff: true|false and size (bytes).
  var known = {};
  function rec(name, nfo, size) {
    return { file: name, family: nfo.family, sub: nfo.sub, b: nfo.b, i: nfo.i, fb: nfo.fb, cff: !nfo.glyf, size: size };
  }
  function library(opts) {
    var F = fs(), all = !!(opts && opts.all);
    if (!F) return Promise.resolve([]);
    return F.ls(FOLDER).then(function (list) {
      var files = (list || []).map(function (e) { return e.name; }).filter(function (n) { return FILE_RE.test(n); });
      return Promise.all(files.map(function (f) {
        if (known[f]) return known[f];
        return F.read(FOLDER + "/" + f).then(function (b) { return b.arrayBuffer(); }).then(local).then(function (ab) {
          var c = check(ab, { cff: true });
          if (!c.ok) return null;
          known[f] = rec(f, c.info, ab.byteLength);
          return known[f];
        }, function () { return null; });
      }));
    }, function () { return []; }).then(function (l) {
      return l.filter(function (r) { return r && (all || !r.cff); }).sort(function (a, b) { return a.family.localeCompare(b.family) || (a.b - b.b) || (a.i - b.i); });
    });
  }
  // The library grouped by family: [{ id, name, fb, r, b, i, bi }].
  function families(lib) {
    var by = {}, out = [];
    lib.forEach(function (f) {
      var k = squash(f.family) || f.family.toLowerCase();
      var e = by[k];
      if (!e) { e = by[k] = { name: f.family, fb: f.fb, files: {} }; out.push(e); }
      var v = variantOf(f.b, f.i);
      if (!e.files[v]) e.files[v] = f.file;
    });
    return out.map(function (e) {
      var r = e.files.r || e.files.b || e.files.i || e.files.bi;
      var o = { id: ufIdOf(r), name: e.name, fb: e.fb, r: r };
      ["b", "i", "bi"].forEach(function (v) { if (e.files[v]) o[v] = e.files[v]; });
      return o;
    });
  }
  // A file the user picked → kept on the disk (once: the name is its
  // hash). Promise of { file, family, sub, b, i, fb } or { err }.
  // opts: as check().
  function importFile(file, opts) {
    var F = fs();
    if (!F) return Promise.resolve({ err: "disk" });
    if (!file || file.size > MAX * 2) return Promise.resolve({ err: "size" });
    return file.arrayBuffer().then(local).then(unwoff).then(function (buf) {
      if (!buf) return { err: "type" };
      var c = check(buf, opts);
      if (!c.ok) return { err: c.err };
      return sha256(buf).then(function (h) {
        var name = h + ".ttf", path = FOLDER + "/" + name;
        var r = rec(name, c.info, buf.byteLength);
        return F.stat(path).then(function () { return null; }, function () {
          return F.mkdir(FOLDER).then(null, function () {}).then(function () { return F.write(path, new Blob([buf], { type: "font/ttf" })); });
        }).then(function () {
          known[name] = r;                         // library() leaves cff ones out unless opts.all
          return { file: r.file, family: r.family, sub: r.sub, b: r.b, i: r.i, fb: r.fb };
        });
      });
    }, function () { return { err: "type" }; });
  }
  // A font file from a package: checked against its name (the hash).
  // opts: as check().
  function put(name, blob, opts) {
    var F = fs();
    if (!F || !FILE_RE.test(name || "")) return Promise.reject(new Error("badid"));
    return blob.arrayBuffer().then(local).then(function (ab) {
      return sha256(ab).then(function (h) {
        if (h + ".ttf" !== name) throw new Error("hash");
        if (!check(ab, opts).ok) throw new Error("font");
        var path = FOLDER + "/" + name;
        return F.stat(path).then(function () { return null; }, function () {
          return F.mkdir(FOLDER).then(null, function () {}).then(function () { return F.write(path, new Blob([ab], { type: "font/ttf" })); });
        });
      });
    }).then(function () { return name; });
  }
  // A font file of the disk → the orOS Trash, as Files does it (the
  // record first; taken back when the move fails). Needs Files' core
  // (files/files-core.js, OrosFilesCore). Promise; rejects when the
  // file is not moved.
  function remove(name, core) {
    var F = fs();
    core = core || root.OrosFilesCore;
    if (!F || !core || !FILE_RE.test(name || "")) return Promise.reject(new Error("badid"));
    var now = Date.now(), id = core.trashId(now, Math.random().toString(36).slice(2, 10)), path = FOLDER + "/" + name;
    return F.writeText(core.trashMetaPath(id), JSON.stringify(core.makeMeta(path, false, now))).then(function () {
      return F.mv(path, core.trashItemDir(id) + "/" + name);
    }).then(function () { delete known[name]; return name; }, function (e) {
      return F.rm(core.trashMetaPath(id)).then(null, function () {}).then(function () { throw e; });
    });
  }
  function blob(name) {
    var F = fs();
    if (!F || !FILE_RE.test(name || "")) return Promise.resolve(null);
    return F.read(FOLDER + "/" + name).then(null, function () { return null; });
  }

  // The variants fontsourceUrls() can fetch for a catalog entry.
  function varsOf(f) {
    var w = Array.isArray(f.weights) ? f.weights : [], st = Array.isArray(f.styles) ? f.styles : [], out = [];
    var it = st.indexOf("italic") >= 0, up = st.indexOf("normal") >= 0 || !st.length;
    if (w.indexOf(400) >= 0) { if (up) out.push("r"); if (it) out.push("i"); }
    if (w.indexOf(700) >= 0) { if (up) out.push("b"); if (it) out.push("bi"); }
    return out;
  }
  // The Fontsource catalog (once per device, then from the cache):
  // [{ id, family, cat, greek }]; 1.1.0 adds poly, cyr, subs, lic and
  // vars (["r", "b", "i", "bi"], those it has).
  var catalogP = null;
  function catalog() {
    if (catalogP) return catalogP;
    catalogP = cached(CATALOG).then(function (hit) {
      if (hit && hit.status === 200) return hit.json();
      return fetch(CATALOG, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" }).then(function (r) {
        if (!r.ok) throw new Error("catalog " + r.status);
        return r.clone().json().then(function (j) { keep(CATALOG, r); return j; });
      });
    }).then(function (j) {
      return (Array.isArray(j) ? j : []).filter(function (f) {
        return f && typeof f.id === "string" && /^[a-z0-9-]{1,60}$/.test(f.id) && typeof f.family === "string" && f.type !== "icons";
      }).map(function (f) {
        var subs = Array.isArray(f.subsets) ? f.subsets : [];
        return {
          id: fsIdOf(f.id), family: f.family.slice(0, 60), cat: f.category === "monospace" ? "mono" : f.category === "serif" ? "serif" : "sans", greek: subs.indexOf("greek") >= 0,
          // 1.1.0
          poly: subs.indexOf("greek-ext") >= 0, cyr: subs.indexOf("cyrillic") >= 0, subs: subs.filter(function (x) { return typeof x === "string"; }).slice(0, 40),
          lic: typeof f.license === "string" ? f.license.slice(0, 40) : "", vars: varsOf(f)
        };
      });
    }).then(null, function () { catalogP = null; return []; });
    return catalogP;
  }

  // The family to use for a font name found in a PDF or another
  // program's file: one on the disk, else Fontsource. Promise of an
  // entry for setup.ext.fonts, or null.
  function match(name, lib, opts) {
    var k = squash(name);
    if (!k) return Promise.resolve(null);
    var mine = families(lib || []).filter(function (f) { return squash(f.name) === k; })[0];
    if (mine) return Promise.resolve(mine);
    if (opts && opts.offline) return Promise.resolve(null);
    return catalog().then(function (cat) {
      var f = cat.filter(function (c) { return squash(c.family) === k; })[0];
      return f ? { id: f.id, name: f.family, fb: f.cat } : null;
    });
  }

  var api = {
    FOLDER: FOLDER, FILE_RE: FILE_RE, MAX: MAX,
    isFam: isFam, fsIdOf: fsIdOf, ufIdOf: ufIdOf, squash: squash, info: info, check: check,
    docFonts: docFonts, famsUsed: famsUsed, register: register, withEntry: withEntry, families: families,
    unwoff: unwoff, fetcher: fetcher, library: library, importFile: importFile, put: put, blob: blob,
    catalog: catalog, match: match,
    // 1.1.0
    woff2: woff2, brotli: brotli, coverage: coverage, level: level, subsetLevels: subsetLevels, SETS: SETS, SET_KEYS: SET_KEYS,
    licence: licence, inspect: inspect, remove: remove, fontsourceUrls: fontsourceUrls
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.fonts = api; }
})(typeof window !== "undefined" ? window : this);
