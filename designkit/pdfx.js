// ============================================================
// orOS designkit — pdfx.js (v1.1.0, LY-PRO W1): a print PDF made by
// pdf.js (jsPDF) becomes PDF/X-4, with the vendored pdf-lib:
//   - OutputIntent GTS_PDFX with the print profile embedded
//     (DestOutputProfile, e.g. ISO Coated v2 = Coated FOGRA39);
//   - every RGB colour and picture tagged as sRGB (ICCBased): images
//     with /DeviceRGB get the sRGB profile as their colour space, and
//     each page's resources get /DefaultRGB, so the content stream's
//     rg / RG colours are device independent too (PDF/X-4 allows RGB
//     that is ICC based; the printer's RIP converts it);
//   - Info: GTS_PDFXVersion PDF/X-4, Trapped False, dates; XMP
//     metadata with pdfxid:GTS_PDFXVersion and the same values;
//     trailer /ID;
//   - checks: every page has a TrimBox (and a BleedBox inside its
//     MediaBox), no encryption, no fonts left unembedded.
// make(PDFLib, bytes, { icc, srgb, cond, info, title, now, cmyk }) →
//   Promise<{ bytes, boxes: [{ trim, bleed, media }], problems: [], cmyk? }>
// 1.1.0 (LY-PORT-C) cmyk: true converts the RGB colours of text,
//   lines, shapes and gradients to the print profile's CMYK
//   (relative colorimetric, through its B2A1 table); greys and black
//   become black ink alone (K, as the profile's K ramp prints that
//   lightness, at most 100 % K; chroma under 4 counts as grey), so
//   black text is 0 0 0 100. Photos
//   stay sRGB with their profile (PDF/X-4 allows it; the printer's RIP
//   converts them). cmyk() → { rgb(r, g, b) → [c, m, y, k] (0..1) }
//   from the profile bytes; recolor(text, conv) rewrites one content
//   stream's rg / RG.
// 1.2.0 (LY-W9) cmyk() also gives lab(c, m, y, k) (the profile's
//   A2B1), show(c, m, y, k) and proof(r, g, b) → sRGB 0..1, what the
//   ink looks like on paper (soft proof, relative colorimetric);
//   grid(fn, n) a 3D table of fn on 0..255 bytes (fast per pixel).
//   recolor(text, conv, op): op(cmyk 0..1, "f" | "s") true → that
//   colour overprints: "/OPsf gs" before it switches (OP, op, OPM 1;
//   q / Q keep the state). make(..., { overprint: op }) sets that on
//   pages; make(..., { x1a: true, decode }) makes PDF/X-1a:2003
//   instead: every colour CMYK, pictures too (decode(bytes, filter) →
//   Promise<{ w, h, data RGBA }> reads a JPEG; Flate RGB is read here),
//   no sRGB profile, PDF 1.4, and transparency reported
//   ("transparency"), never left in silently.
// Pure (no DOM): Node tests run it. Exposes orosDK.pdfx / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var FOGRA39 = { id: "FOGRA39", info: "Coated FOGRA39 (ISO 12647-2:2004)", file: "ISOcoated_v2_eci.icc", registry: "http://www.color.org" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function pdfDate(d) {
    return "D:" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function isoDate(d) { return d.toISOString().replace(/\.\d{3}Z$/, "Z"); }
  function xmlEsc(s) { return String(s || "").replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  function uuid(rand) {
    var b = rand(16);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = hex(b);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function randBytes(n) {
    var b = new Uint8Array(n), c = root && root.crypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else { try { require("crypto").randomFillSync(b); } catch (e) { for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); } }
    return b;
  }

  function xmp(o) {
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
      'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"' + (o.ua ? ' xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"' : "") + '>\n' +
      '<dc:format>application/pdf</dc:format>\n' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(o.title) + '</rdf:li></rdf:Alt></dc:title>\n' +
      '<xmp:CreatorTool>' + xmlEsc(o.creator) + '</xmp:CreatorTool>\n' +
      '<xmp:CreateDate>' + o.date + '</xmp:CreateDate>\n<xmp:ModifyDate>' + o.date + '</xmp:ModifyDate>\n<xmp:MetadataDate>' + o.date + '</xmp:MetadataDate>\n' +
      '<pdf:Producer>' + xmlEsc(o.producer) + '</pdf:Producer>\n<pdf:Trapped>False</pdf:Trapped>\n' +
      '<pdfxid:GTS_PDFXVersion>' + (o.ver || "PDF/X-4") + '</pdfxid:GTS_PDFXVersion>\n' +
      '<xmpMM:DocumentID>uuid:' + o.docId + '</xmpMM:DocumentID>\n<xmpMM:InstanceID>uuid:' + o.instId + '</xmpMM:InstanceID>\n<xmpMM:RenditionClass>default</xmpMM:RenditionClass>\n<xmpMM:VersionID>1</xmpMM:VersionID>\n' +
      (o.ua ? '<pdfuaid:part>1</pdfuaid:part>\n' : "") +
      '</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n' + new Array(20).join("                                                  \n") + '<?xpacket end="w"?>';
  }

  function boxOf(page, P, name) {
    var v = page.node.get(P.PDFName.of(name));
    if (!v || !(v instanceof P.PDFArray) || v.size() !== 4) return null;
    return [0, 1, 2, 3].map(function (i) { var n = v.get(i); return n && typeof n.asNumber === "function" ? n.asNumber() : 0; });
  }

  // The text of a content stream (Flate decoded by pdf-lib), "" when
  // it cannot be read.
  function streamText(P, ctx, v) {
    var parts = [];
    function one(x) {
      if (x instanceof P.PDFRef) x = ctx.lookup(x);
      if (x instanceof P.PDFArray) { for (var i = 0; i < x.size(); i++) one(x.get(i)); return; }
      if (!x || !(x instanceof P.PDFStream)) return;
      try {
        var b = x instanceof P.PDFRawStream ? P.decodePDFRawStream(x).decode() : x.getContents();
        var s = "";
        for (var j = 0; j < b.length; j += 8192) s += String.fromCharCode.apply(null, b.subarray(j, j + 8192));
        parts.push(s);
      } catch (e) { parts.push(null); }
    }
    one(v);
    return parts.indexOf(null) !== -1 ? null : parts.join("\n");
  }
  // jsPDF lists its 14 standard fonts in every resource dictionary,
  // used or not; PDF/X needs every font embedded, so the ones no
  // content stream sets (Tf) go. A stream that cannot be read keeps
  // everything (then the check below reports the fonts).
  function pruneFonts(P, doc) {
    var ctx = doc.context, N = P.PDFName.of, used = {}, dicts = [], unreadable = false;
    function scan(text) {
      if (text === null) { unreadable = true; return; }
      var re = /\/([^\s\/\[\]()<>{}%]+)\s+[-+.\d]+\s+Tf\b/g, m;
      while ((m = re.exec(text))) used[m[1]] = 1;
    }
    function resOf(res) {
      if (res instanceof P.PDFRef) res = ctx.lookup(res);
      if (!res || typeof res.get !== "function") return;
      var f = res.get(N("Font"));
      if (f instanceof P.PDFRef) f = ctx.lookup(f);
      if (f && typeof f.keys === "function" && dicts.indexOf(f) === -1) dicts.push(f);
      var xo = res.get(N("XObject"));
      if (xo instanceof P.PDFRef) xo = ctx.lookup(xo);
      if (xo && typeof xo.keys === "function") xo.keys().forEach(function (k) {
        var st = ctx.lookup(xo.get(k));
        if (st && st.dict && st.dict.get(N("Subtype")) === N("Form")) { scan(streamText(P, ctx, st)); resOf(st.dict.get(N("Resources"))); }
      });
    }
    doc.getPages().forEach(function (pg) {
      scan(streamText(P, ctx, pg.node.get(N("Contents"))));
      resOf(pg.node.get(N("Resources")));
    });
    if (unreadable) return 0;
    var gone = 0, drop = [], keep = {};
    dicts.forEach(function (f) {
      f.keys().forEach(function (k) {
        var ref = f.get(k);
        if (used[k.asString().slice(1)]) { if (ref instanceof P.PDFRef) keep[ref.toString()] = 1; return; }
        f.delete(k);
        if (ref instanceof P.PDFRef) drop.push(ref);
        gone++;
      });
    });
    // an object another dictionary still names stays
    drop.forEach(function (ref) { if (!keep[ref.toString()]) ctx.delete(ref); });
    return gone;
  }


  // ---------- CMYK (1.1.0) ----------
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function s15(b, o) { var v = u32(b, o); if (v > 0x7fffffff) v -= 0x100000000; return v / 65536; }
  function tagOf(b, sig) {
    var n = u32(b, 128);
    for (var i = 0; i < n && 144 + i * 12 <= b.length; i++) {
      var o = 132 + i * 12;
      if (String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === sig) return { off: u32(b, o + 4), len: u32(b, o + 8) };
    }
    return null;
  }
  // an mft2 (lut16) table: in and out values 0..1
  function lut16(b, t) {
    var o = t.off;
    if (!t || String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) !== "mft2") return null;
    var ni = b[o + 8], no = b[o + 9], g = b[o + 10], ne = u16(b, o + 48), me = u16(b, o + 50), p = o + 52, i, k;
    if (ni < 1 || ni > 4 || no < 1 || no > 4 || g < 2 || ne < 2 || me < 2) return null;
    var inT = [], outT = [], clut;
    for (i = 0; i < ni; i++) { var a = new Float64Array(ne); for (k = 0; k < ne; k++, p += 2) a[k] = u16(b, p) / 65535; inT.push(a); }
    var cells = Math.pow(g, ni) * no;
    if (p + cells * 2 > b.length) return null;
    clut = new Float64Array(cells);
    for (k = 0; k < cells; k++, p += 2) clut[k] = u16(b, p) / 65535;
    for (i = 0; i < no; i++) { var c = new Float64Array(me); for (k = 0; k < me; k++, p += 2) c[k] = u16(b, p) / 65535; outT.push(c); }
    function curve(a, v) { v = Math.max(0, Math.min(1, v)) * (a.length - 1); var j = Math.min(a.length - 2, Math.floor(v)), f = v - j; return a[j] + (a[j + 1] - a[j]) * f; }
    return function (vin) {
      var x = [], base = [], fr = [], i2, out = [];
      for (i2 = 0; i2 < ni; i2++) { var v = curve(inT[i2], vin[i2]) * (g - 1), j = Math.min(g - 2, Math.floor(v)); base.push(j); fr.push(v - j); }
      for (i2 = 0; i2 < no; i2++) out.push(0);
      // multilinear over the 2^ni corners
      for (var c2 = 0; c2 < (1 << ni); c2++) {
        var w = 1, idx = 0;
        for (i2 = 0; i2 < ni; i2++) { var bit = (c2 >> (ni - 1 - i2)) & 1; w *= bit ? fr[i2] : 1 - fr[i2]; idx = idx * g + base[i2] + bit; }
        if (!w) continue;
        for (i2 = 0; i2 < no; i2++) out[i2] += w * clut[idx * no + i2];
      }
      for (i2 = 0; i2 < no; i2++) x.push(curve(outT[i2], out[i2]));
      return x;
    };
  }
  // ICC legacy 16-bit Lab (mft2): L 0..100 → 0..0xFF00, a/b −128..127.996
  function labIn(L, a, bb) { var k = 65280 / 65535; return [L / 100 * k, (a + 128) / 255 * k, (bb + 128) / 255 * k]; }
  function labOut(v) { var k = 65535 / 65280; return [v[0] * k * 100, v[1] * k * 255 - 128, v[2] * k * 255 - 128]; }
  // sRGB 0..1 → Lab (D50, as the profile connection space)
  function srgbLab(r, g, b) {
    var lin = function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    r = lin(r); g = lin(g); b = lin(b);
    var X = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b, Y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b, Z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b;
    var f = function (t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; };
    var fx = f(X / 0.9642), fy = f(Y), fz = f(Z / 0.8249);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  // Lab (D50) → sRGB 0..1, clipped
  function labSrgb(L, a, bb) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    var inv = function (t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); };
    var X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8249 * inv(fz);
    var r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, b = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
    var gam = function (c) { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    return [gam(r), gam(g), gam(b)];
  }
  // fn(r, g, b 0..1) → n outputs (0..1) on an s×s×s grid; the result
  // reads bytes: at(r, g, b 0..255, out) fills out[] (trilinear)
  function grid(fn, nOut, s) {
    s = s || 17;
    var T = new Float32Array(s * s * s * nOut), i = 0;
    for (var a = 0; a < s; a++) for (var b = 0; b < s; b++) for (var c = 0; c < s; c++) {
      var v = fn(a / (s - 1), b / (s - 1), c / (s - 1));
      for (var k = 0; k < nOut; k++) T[i++] = v[k];
    }
    var sc = (s - 1) / 255;
    return function at(r, g, b, out) {
      var x = r * sc, y = g * sc, z = b * sc, x0 = Math.min(s - 2, x | 0), y0 = Math.min(s - 2, y | 0), z0 = Math.min(s - 2, z | 0);
      var fx = x - x0, fy = y - y0, fz = z - z0;
      for (var k = 0; k < nOut; k++) {
        var o = ((x0 * s + y0) * s + z0) * nOut + k, sz = nOut, sy = s * nOut, sx = s * s * nOut;
        var c00 = T[o] + (T[o + sz] - T[o]) * fz, c01 = T[o + sy] + (T[o + sy + sz] - T[o + sy]) * fz;
        var c10 = T[o + sx] + (T[o + sx + sz] - T[o + sx]) * fz, c11 = T[o + sx + sy] + (T[o + sx + sy + sz] - T[o + sx + sy]) * fz;
        var c0 = c00 + (c01 - c00) * fy, c1 = c10 + (c11 - c10) * fy;
        out[k] = c0 + (c1 - c0) * fx;
      }
      return out;
    };
  }
  // an ICC profile's header and name → { cls, space, name } or null
  function profileInfo(icc) {
    var b = icc instanceof Uint8Array ? icc : new Uint8Array(icc);
    if (b.length < 132 || String.fromCharCode(b[36], b[37], b[38], b[39]) !== "acsp") return null;
    var str = function (o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); };
    var out = { cls: str(12), space: str(16).trim(), name: "" }, t = tagOf(b, "desc");
    if (t && t.off + 12 < b.length) {
      var ty = str(t.off), nm = "";
      if (ty === "desc") { var n = Math.min(u32(b, t.off + 8), 200); for (var i = 0; i < n - 1 && t.off + 12 + i < b.length; i++) nm += String.fromCharCode(b[t.off + 12 + i]); }
      else if (ty === "mluc" && u32(b, t.off + 8) > 0) {
        var len = u32(b, t.off + 20), off = t.off + u32(b, t.off + 24);
        for (var j = 0; j + 1 < Math.min(len, 400) && off + j + 1 < b.length; j += 2) nm += String.fromCharCode((b[off + j] << 8) | b[off + j + 1]);
      }
      out.name = nm.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
    }
    return out;
  }
  function cmyk(icc) {
    var b = icc instanceof Uint8Array ? icc : new Uint8Array(icc);
    var tB = tagOf(b, "B2A1"), tA = tagOf(b, "A2B1");
    var toC = tB && lut16(b, tB), toL = tA && lut16(b, tA);
    if (!toC || !toL) return null;
    // the K ramp: lightness of K alone, 0..100 % in 256 steps
    var ramp = [];
    for (var i = 0; i <= 255; i++) ramp.push(labOut(toL([0, 0, 0, i / 255]))[0]);
    var paper = ramp[0];
    function kFor(L) {
      // the profile's own paper is white (relative colorimetric)
      var want = L / 100 * paper;
      if (want >= ramp[0]) return 0;
      for (var j = 1; j <= 255; j++) if (ramp[j] <= want) { var f = (ramp[j - 1] - want) / (ramp[j - 1] - ramp[j] || 1); return (j - 1 + f) / 255; }
      return 1;
    }
    var memo = {};
    function rgb(r, g, bl) {
      var key = Math.round(r * 255) + "," + Math.round(g * 255) + "," + Math.round(bl * 255);
      if (memo[key]) return memo[key];
      var lab = srgbLab(r, g, bl), out;
      // a grey (chroma under 4: also the near-black a PDF's K-only text
      // shows on screen, 35 31 32): black ink alone
      if (Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]) < 4) out = [0, 0, 0, kFor(lab[0])];
      else out = toC(labIn(Math.max(0, Math.min(100, lab[0])), Math.max(-128, Math.min(127, lab[1])), Math.max(-128, Math.min(127, lab[2]))));
      out = out.map(function (v) { v = Math.max(0, Math.min(1, v)); return v < 0.002 ? 0 : v > 0.998 ? 1 : v; });
      return (memo[key] = out);
    }
    // what the inks look like: the profile's Lab, its paper as white
    function lab(c, m, y, k) { return labOut(toL([c, m, y, k])); }
    function show(c, m, y, k) {
      var L = lab(c, m, y, k), s = paper > 1 ? 100 / paper : 1;
      return labSrgb(Math.min(100, L[0] * s), L[1], L[2]);
    }
    function proof(r, g, bl) { var q = rgb(r, g, bl); return show(q[0], q[1], q[2], q[3]); }
    return { rgb: rgb, kFor: kFor, lab: lab, show: show, proof: proof };
  }
  function num(v) { var s = (Math.round(v * 10000) / 10000).toString(); return s.indexOf("e") >= 0 ? "0" : s; }
  // One content stream: every "r g b rg" / "r g b RG" → "c m y k k" /
  // "… K". Strings, hex strings, comments and inline images are left
  // as they are. conv null leaves the colours. op(cmyk, "f" | "s")
  // true → the colour overprints: "/OPsf gs" goes before it when the
  // state changes (OP00 .. OP11, stroke then fill; q / Q keep it).
  // → { text, n (colours changed), ops (gs inserted) }.
  function recolor(src, conv, op) {
    var out = "", i = 0, L = src.length, ops = [], n = 0, last = 0, nOp = 0;
    var st = { s: false, f: false }, stack = [];
    var DELIM = "()<>[]{}/%";
    function isWs(c) { return c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0"; }
    // the gs that the colour about to be set needs ("" none)
    function gsFor(q, kind) {
      if (!op) return "";
      var want = !!op(q, kind), cur = kind === "f" ? st.f : st.s;
      if (want === cur) return "";
      if (kind === "f") st.f = want; else st.s = want;
      nOp++;
      return "/OP" + (st.s ? 1 : 0) + (st.f ? 1 : 0) + " gs ";
    }
    while (i < L) {
      var c = src[i];
      if (isWs(c)) { i++; continue; }
      if (c === "%") { while (i < L && src[i] !== "\n" && src[i] !== "\r") i++; ops = []; continue; }
      if (c === "(") {
        var depth = 1; i++;
        while (i < L && depth) { var d = src[i]; if (d === "\\") i += 2; else { if (d === "(") depth++; else if (d === ")") depth--; i++; } }
        ops = []; continue;
      }
      if (c === "<" && src[i + 1] !== "<") { while (i < L && src[i] !== ">") i++; i++; ops = []; continue; }
      if (c === "<" || c === ">") { i += src[i + 1] === c ? 2 : 1; ops = []; continue; }
      if (c === "[" || c === "]" || c === "{" || c === "}") { i++; ops = []; continue; }
      var s0 = i;
      if (c === "/") i++;
      while (i < L && !isWs(src[i]) && DELIM.indexOf(src[i]) < 0) i++;
      if (i === s0) { i++; continue; }
      var tok = src.slice(s0, i);
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok)) { ops.push({ v: +tok, s: s0 }); continue; }
      var cl = function (v) { return Math.max(0, Math.min(1, v)); };
      if ((tok === "rg" || tok === "RG") && ops.length >= 3) {
        var a = ops.slice(-3), rgb3 = [cl(a[0].v), cl(a[1].v), cl(a[2].v)];
        var q = conv ? conv(rgb3[0], rgb3[1], rgb3[2]) : null, g1 = gsFor(q || rgbK(rgb3), tok === "rg" ? "f" : "s");
        if (q) { out += src.slice(last, a[0].s) + g1 + q.map(num).join(" ") + " " + (tok === "rg" ? "k" : "K"); last = i; n++; }
        else if (g1) { out += src.slice(last, a[0].s) + g1; last = a[0].s; }
      } else if ((tok === "k" || tok === "K") && ops.length >= 4 && op) {
        var a4 = ops.slice(-4), g2 = gsFor(a4.map(function (x) { return cl(x.v); }), tok === "k" ? "f" : "s");
        if (g2) { out += src.slice(last, a4[0].s) + g2; last = a4[0].s; }
      } else if ((tok === "g" || tok === "G") && ops.length >= 1 && op) {
        var a1 = ops[ops.length - 1], g3 = gsFor([0, 0, 0, 1 - cl(a1.v)], tok === "g" ? "f" : "s");
        if (g3) { out += src.slice(last, a1.s) + g3; last = a1.s; }
      } else if (tok === "q") stack.push({ s: st.s, f: st.f });
      else if (tok === "Q") { if (stack.length) st = stack.pop(); }
      else if (tok === "BI") {
        // an inline image: up to "EI" after its data
        var e = src.indexOf("EI", i);
        while (e > 0 && !(isWs(src[e - 1]) && (e + 2 >= L || isWs(src[e + 2])))) e = src.indexOf("EI", e + 2);
        i = e < 0 ? L : e + 2;
      }
      ops = [];
    }
    return { text: out + src.slice(last), n: n, ops: nOp };
  }
  // an RGB colour as naive CMYK (only to decide overprint when nothing
  // converts: pure black is 0 0 0 1)
  function rgbK(v) {
    var k = 1 - Math.max(v[0], v[1], v[2]);
    return k >= 1 ? [0, 0, 0, 1] : [(1 - v[0] - k) / (1 - k), (1 - v[1] - k) / (1 - k), (1 - v[2] - k) / (1 - k), k];
  }
  function latin1(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  // Every page's content and every form's: rg / RG to CMYK; gradients
  // (shadings with /DeviceRGB, functions of type 2 or 3 of type 2) too.
  // the four overprint states a page may switch between (stroke, fill)
  function opStates(P, ctx) {
    var N = P.PDFName.of, out = {};
    [0, 1].forEach(function (s) {
      [0, 1].forEach(function (f) {
        var g = ctx.obj({ Type: "ExtGState" });
        g.set(N("OP"), s ? P.PDFBool.True : P.PDFBool.False);
        g.set(N("op"), f ? P.PDFBool.True : P.PDFBool.False);
        g.set(N("OPM"), ctx.obj(s || f ? 1 : 0));
        out["OP" + s + f] = ctx.register(g);
      });
    });
    return out;
  }
  function toCmyk(P, doc, conv, op) {
    var ctx = doc.context, N = P.PDFName.of, count = 0, f = conv ? function (r, g, b) { return conv.rgb(r, g, b); } : null, states = null;
    doc.getPages().forEach(function (pg) {
      var text = streamText(P, ctx, pg.node.get(N("Contents")));
      if (text === null) return;
      var r = recolor(text, f, op || null);
      if (!r.n && !r.ops) return;
      count += r.n;
      pg.node.set(N("Contents"), ctx.register(ctx.flateStream(latin1(r.text))));
      if (!r.ops) return;
      states = states || opStates(P, ctx);
      var res = pg.node.Resources();
      if (!res) { res = ctx.obj({}); pg.node.set(N("Resources"), res); }
      var gs = res.get(N("ExtGState"));
      if (gs instanceof P.PDFRef) gs = ctx.lookup(gs);
      if (!gs || typeof gs.set !== "function") { gs = ctx.obj({}); res.set(N("ExtGState"), gs); }
      Object.keys(states).forEach(function (k) { gs.set(N(k), states[k]); });
    });
    if (!f) return count;
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var ref = pair[0], obj = pair[1], dict = obj && obj.dict ? obj.dict : obj;
      if (!dict || typeof dict.get !== "function") return;
      if (obj.dict && dict.get(N("Subtype")) === N("Form")) {
        var text = streamText(P, ctx, obj);
        if (text === null) return;
        var r = recolor(text, f);
        if (!r.n) return;
        count += r.n;
        var nd = {};
        dict.keys().forEach(function (k) { var nm = k.asString().slice(1); if (nm !== "Length" && nm !== "Filter" && nm !== "DecodeParms") nd[nm] = dict.get(k); });
        ctx.assign(ref, ctx.flateStream(latin1(r.text), nd));
        return;
      }
      var sh = dict.get(N("ShadingType")) ? dict : null;
      if (sh && sh.get(N("ColorSpace")) === N("DeviceRGB")) {
        var fns = [], samp = [];
        // type 2 (C0 → C1), type 3 (stitching type 2 / 0) and type 0
        // (sampled, 1 input, 8 bits: jsPDF's gradients) functions
        var add = function (x, ref) {
          if (x instanceof P.PDFRef) { ref = x; x = ctx.lookup(x); }
          var d = x && x.dict ? x.dict : x;
          if (!d || typeof d.get !== "function") return false;
          var tp = d.get(N("FunctionType"));
          tp = tp && tp.asNumber ? tp.asNumber() : -1;
          if (tp === 2) { var n1 = d.get(N("N")); if (n1 && n1.asNumber && n1.asNumber() !== 1) return false; fns.push(d); return true; }
          if (tp === 3) { var arr = d.get(N("Functions")); if (arr instanceof P.PDFRef) arr = ctx.lookup(arr); if (!(arr instanceof P.PDFArray)) return false; for (var j = 0; j < arr.size(); j++) if (!add(arr.get(j))) return false; return true; }
          if (tp === 0 && x.dict && ref) {
            var size = d.get(N("Size")), bps = d.get(N("BitsPerSample"));
            if (!(size instanceof P.PDFArray) || size.size() !== 1 || !bps || bps.asNumber() !== 8) return false;
            try { var raw = P.decodePDFRawStream(x).decode(), m = size.get(0).asNumber(); if (raw.length < m * 3) return false; samp.push({ ref: ref, d: d, raw: raw, m: m }); return true; }
            catch (e) { return false; }
          }
          return false;
        };
        if (!add(sh.get(N("Function")))) return;
        fns.forEach(function (x) {
          ["C0", "C1"].forEach(function (key) {
            var a = x.get(N(key)), v = key === "C1" ? [1, 1, 1] : [0, 0, 0];
            if (a instanceof P.PDFArray && a.size() === 3) v = [0, 1, 2].map(function (j) { var e = a.get(j); return e && e.asNumber ? e.asNumber() : 0; });
            x.set(N(key), ctx.obj(f(v[0], v[1], v[2])));
          });
        });
        samp.forEach(function (sm) {
          var out = new Uint8Array(sm.m * 4);
          for (var j = 0; j < sm.m; j++) {
            var q = f(sm.raw[j * 3] / 255, sm.raw[j * 3 + 1] / 255, sm.raw[j * 3 + 2] / 255);
            for (var c = 0; c < 4; c++) out[j * 4 + c] = Math.round(q[c] * 255);
          }
          var nd = {};
          sm.d.keys().forEach(function (k) { var nm = k.asString().slice(1); if (["Length", "Filter", "DecodeParms", "Range", "Decode"].indexOf(nm) < 0) nd[nm] = sm.d.get(k); });
          nd.Range = [0, 1, 0, 1, 0, 1, 0, 1];
          ctx.assign(sm.ref, ctx.flateStream(out, nd));
        });
        sh.set(N("ColorSpace"), N("DeviceCMYK"));
        count++;
      }
    });
    return count;
  }

  // PNG predictors (10..15) undone: rows of `bpr` bytes, `bpp` per pixel
  function unpredict(b, bpr, bpp) {
    var rows = Math.floor(b.length / (bpr + 1)), out = new Uint8Array(rows * bpr);
    for (var y = 0; y < rows; y++) {
      var t = b[y * (bpr + 1)], s0 = y * (bpr + 1) + 1, o = y * bpr;
      for (var x = 0; x < bpr; x++) {
        var a = x >= bpp ? out[o + x - bpp] : 0, up = y ? out[o - bpr + x] : 0, c = x >= bpp && y ? out[o - bpr + x - bpp] : 0, v = b[s0 + x];
        if (t === 1) v += a; else if (t === 2) v += up; else if (t === 3) v += (a + up) >> 1;
        else if (t === 4) { var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
        out[o + x] = v & 255;
      }
    }
    return out;
  }
  function numOf(x) { return x && typeof x.asNumber === "function" ? x.asNumber() : NaN; }
  // PDF/X-1a: every RGB picture becomes DeviceCMYK through the profile
  // (one 33³ table); a JPEG is read by decode(), Flate here.
  function x1aImages(P, doc, conv, decode, problems) {
    var ctx = doc.context, N = P.PDFName.of, jobs = [], at = null, n = 0;
    function bad(code) { if (!problems.some(function (q) { return q.code === code; })) problems.push({ code: code }); }
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var ref = pair[0], obj = pair[1], d = obj && obj.dict;
      if (!d || d.get(N("Subtype")) !== N("Image")) return;
      if (d.get(N("SMask")) || d.get(N("Mask"))) bad("transparency");
      var cs = d.get(N("ColorSpace"));
      if (cs === N("DeviceGray") || cs === N("DeviceCMYK") || d.get(N("ImageMask"))) return;
      if (cs !== N("DeviceRGB")) { bad("x1aImage"); return; }
      var w = numOf(d.get(N("Width"))), h = numOf(d.get(N("Height"))), bpc = numOf(d.get(N("BitsPerComponent")));
      var f = d.get(N("Filter"));
      if (f instanceof P.PDFArray) f = f.size() === 1 ? f.get(0) : null;
      if (!(w > 0 && h > 0) || bpc !== 8) { bad("x1aImage"); return; }
      jobs.push(function () {
        var px;
        if (f === N("DCTDecode")) {
          if (!decode) { bad("x1aImage"); return Promise.resolve(); }
          px = Promise.resolve(decode(obj.contents, "jpeg")).then(function (im) {
            if (!im || im.w !== w || im.h !== h) return null;
            var rgb = new Uint8Array(w * h * 3), a = im.data;
            for (var i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = a[i]; rgb[j + 1] = a[i + 1]; rgb[j + 2] = a[i + 2]; }
            return rgb;
          });
        } else if (!f || f === N("FlateDecode")) {
          px = new Promise(function (res) {
            var raw = P.decodePDFRawStream(obj).decode(), dp = d.get(N("DecodeParms"));
            if (dp instanceof P.PDFRef) dp = ctx.lookup(dp);
            var pr = dp && typeof dp.get === "function" ? numOf(dp.get(N("Predictor"))) : 1;
            if (pr >= 10) raw = unpredict(raw, w * 3, 3);
            else if (pr > 1) raw = null;
            res(raw && raw.length >= w * h * 3 ? raw : null);
          });
        } else px = Promise.resolve(null);
        return px.then(function (rgb) {
          if (!rgb) { bad("x1aImage"); return; }
          at = at || grid(function (r, g, b) { return conv.rgb(r, g, b); }, 4, 33);
          var out = new Uint8Array(w * h * 4), q = [0, 0, 0, 0];
          for (var i = 0, j = 0; i < w * h * 3; i += 3, j += 4) {
            at(rgb[i], rgb[i + 1], rgb[i + 2], q);
            out[j] = Math.round(q[0] * 255); out[j + 1] = Math.round(q[1] * 255); out[j + 2] = Math.round(q[2] * 255); out[j + 3] = Math.round(q[3] * 255);
          }
          var nd = { Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceCMYK", BitsPerComponent: 8 };
          var keep = ["SMask", "Mask", "Interpolate", "Intent"];
          keep.forEach(function (k) { var v = d.get(N(k)); if (v) nd[k] = v; });
          ctx.assign(ref, ctx.flateStream(out, nd));
          n++;
        }, function () { bad("x1aImage"); });
      });
    });
    return jobs.reduce(function (p, job) { return p.then(job); }, Promise.resolve()).then(function () { return n; });
  }
  // what PDF/X-1a cannot hold: soft masks, opacity, blend modes
  function transparencyIn(P, doc) {
    var ctx = doc.context, N = P.PDFName.of, found = false;
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var obj = pair[1], d = obj && obj.dict ? obj.dict : obj;
      if (found || !d || typeof d.get !== "function") return;
      check(d);
    });
    function check(d) {
      if (d.get(N("Type")) === N("ExtGState") || d.get(N("ca")) || d.get(N("CA"))) {
        var ca = numOf(d.get(N("ca"))), CA = numOf(d.get(N("CA"))), sm = d.get(N("SMask")), bm = d.get(N("BM"));
        if ((ca < 1) || (CA < 1) || (sm && sm !== N("None")) || (bm && bm !== N("Normal") && bm !== N("Compatible"))) found = true;
      }
      if (d.get(N("Group")) && !found) {
        var g = d.get(N("Group"));
        if (g instanceof P.PDFRef) g = ctx.lookup(g);
        if (g && typeof g.get === "function" && g.get(N("S")) === N("Transparency")) found = true;
      }
    }
    // inline ExtGState dictionaries in resources
    doc.getPages().forEach(function (pg) {
      var res = pg.node.Resources(), gs = res && res.get(N("ExtGState"));
      if (gs instanceof P.PDFRef) gs = ctx.lookup(gs);
      if (gs && typeof gs.keys === "function") gs.keys().forEach(function (k) { var v = gs.get(k); if (v instanceof P.PDFRef) v = ctx.lookup(v); if (v && typeof v.get === "function") check(v); });
    });
    return found;
  }

  function make(P, bytes, opts) {
    opts = opts || {};
    var x1a = !!opts.x1a, ver = x1a ? "PDF/X-1a:2003" : "PDF/X-4";
    if (!opts.icc || (!opts.srgb && !x1a)) return Promise.reject(new Error("profiles"));
    var N = P.PDFName.of;
    return P.PDFDocument.load(bytes, { updateMetadata: false }).then(function (doc) {
      var ctx = doc.context, problems = [];
      if (doc.isEncrypted) problems.push({ code: "encrypted" });
      var cond = opts.cond || FOGRA39;
      // the profiles
      var icc = ctx.flateStream(opts.icc, { N: 4 });
      var iccRef = ctx.register(icc);
      var srgbCSRef = null;
      if (!x1a) {
        var srgb = ctx.flateStream(opts.srgb, { N: 3 });
        srgbCSRef = ctx.register(ctx.obj([N("ICCBased"), ctx.register(srgb)]));
      }
      // OutputIntent
      var oi = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFX", OutputConditionIdentifier: P.PDFString.of(cond.id), RegistryName: P.PDFString.of(cond.registry),
                         Info: P.PDFString.of(cond.info), OutputCondition: P.PDFString.of(cond.info) });
      oi.set(N("DestOutputProfile"), iccRef);
      doc.catalog.set(N("OutputIntents"), ctx.obj([ctx.register(oi)]));
      pruneFonts(P, doc);
      var conv = opts.cmyk || x1a ? cmyk(opts.icc) : null, changed = conv || opts.overprint ? toCmyk(P, doc, conv, opts.overprint) : 0;
      if ((opts.cmyk || x1a) && !conv) problems.push({ code: "cmykProfile" });
      if (x1a && transparencyIn(P, doc)) problems.push({ code: "transparency" });
      return (x1a && conv ? x1aImages(P, doc, conv, opts.decode, problems) : Promise.resolve(0)).then(function (pics) {
      // pictures: DeviceRGB → sRGB; fonts must be embedded
      ctx.enumerateIndirectObjects().forEach(function (pair) {
        var obj = pair[1], dict = obj && obj.dict ? obj.dict : obj;
        if (!dict || typeof dict.get !== "function") return;
        var sub = dict.get(N("Subtype")), type = dict.get(N("Type"));
        if (sub === N("Image")) {
          var cs = dict.get(N("ColorSpace"));
          if (cs === N("DeviceRGB")) { if (srgbCSRef) dict.set(N("ColorSpace"), srgbCSRef); else problems.push({ code: "x1aImage" }); }
        }
        if (type === N("Font") && (sub === N("Type1") || sub === N("TrueType") || sub === N("Type0"))) {
          if (sub === N("Type1") && !dict.get(N("FontDescriptor"))) problems.push({ code: "fontNotEmbedded" });
        }
        if (type === N("FontDescriptor")) {
          if (!dict.get(N("FontFile")) && !dict.get(N("FontFile2")) && !dict.get(N("FontFile3"))) problems.push({ code: "fontNotEmbedded" });
        }
      });
      // pages: DefaultRGB, boxes
      var boxes = [];
      doc.getPages().forEach(function (pg, i) {
        var res = pg.node.Resources();
        if (!res) { res = ctx.obj({}); pg.node.set(N("Resources"), res); }
        var csd = res.get(N("ColorSpace"));
        if (csd && csd instanceof P.PDFRef) csd = ctx.lookup(csd);
        if (!csd || typeof csd.set !== "function") { csd = ctx.obj({}); res.set(N("ColorSpace"), csd); }
        if (srgbCSRef) csd.set(N("DefaultRGB"), srgbCSRef);
        var media = boxOf(pg, P, "MediaBox"), trim = boxOf(pg, P, "TrimBox"), bleed = boxOf(pg, P, "BleedBox");
        if (!trim) problems.push({ code: "noTrimBox", page: i + 1 });
        if (bleed && media && (bleed[0] < media[0] - 0.01 || bleed[1] < media[1] - 0.01 || bleed[2] > media[2] + 0.01 || bleed[3] > media[3] + 0.01)) problems.push({ code: "bleedOutside", page: i + 1 });
        boxes.push({ media: media, trim: trim, bleed: bleed || trim });
      });
      // Info + XMP
      var now = opts.now ? new Date(opts.now) : new Date();
      var title = String(opts.title || "Untitled").slice(0, 300), creator = "orOS Layout", producer = "orOS Layout (jsPDF + pdf-lib)";
      var info = ctx.obj({});
      info.set(N("Title"), P.PDFHexString.fromText(title));
      info.set(N("Creator"), P.PDFString.of(creator));
      info.set(N("Producer"), P.PDFString.of(producer));
      info.set(N("CreationDate"), P.PDFString.of(pdfDate(now)));
      info.set(N("ModDate"), P.PDFString.of(pdfDate(now)));
      info.set(N("Trapped"), N("False"));
      info.set(N("GTS_PDFXVersion"), P.PDFString.of(ver));
      ctx.trailerInfo.Info = ctx.register(info);
      // XMP is UTF-8 (a string would be written as Latin-1)
      var meta = ctx.stream(utf8(xmp({ ver: ver, title: title, creator: creator, producer: producer, date: isoDate(now), docId: uuid(randBytes), instId: uuid(randBytes),
                                       ua: !!doc.catalog.get(N("StructTreeRoot")) })),   // a tagged PDF stays PDF/UA (LY-N6)
                            { Type: "Metadata", Subtype: "XML" });
      doc.catalog.set(N("Metadata"), ctx.register(meta));
      var id = P.PDFHexString.of(hex(randBytes(16)));
      ctx.trailerInfo.ID = ctx.obj([id, id]);
      return doc.save({ useObjectStreams: false, updateFieldAppearances: false }).then(function (out) {
        // PDF/X-1a:2003 is PDF 1.4 (no object streams, as here); pdf-lib
        // always writes "%PDF-1.7", and the same length keeps every offset
        if (x1a && String.fromCharCode(out[0], out[1], out[2], out[3], out[4], out[5], out[6], out[7]) === "%PDF-1.7") out[7] = 0x34;
        var res = { bytes: out, boxes: boxes, problems: problems, intent: cond.info, pdfx: ver };
        if (conv) res.cmyk = changed;
        if (x1a) res.pictures = pics;
        return res;
      });
      });
    });
  }

  var api = { make: make, FOGRA39: FOGRA39, cmyk: cmyk, recolor: recolor, srgbLab: srgbLab, labSrgb: labSrgb, grid: grid, unpredict: unpredict, profileInfo: profileInfo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.pdfx = api; }
})(typeof window !== "undefined" ? window : this);
