// ============================================================
// orOS Layout — Read an Affinity file (.af) for a rebuild (v1.0.0)
// Experimental (Bible Part IX 2026-10-17 "Layout: experimental import
// of Affinity .af"): only CONTENT is read here, never geometry. The
// layout always comes from the same document's print PDF (rebuild.js);
// this adds what the PDF lost:
//   - the original pictures stored inside the file, full size;
//   - the text, for the words that join hyphenated line ends;
//   - its font families and its paragraph and character style names
//     (for the report).
// The container (Affinity 3.x): magic 00 FF 4B 41, "#Inf" with the
// offset of the newest file table at byte 16; file tables "#FT4" chain
// back through the offset at byte 4 and list the files ("#Fil", either
// a zstd frame or a stored block); the newest entry of an id wins, so
// the older copies of the document (its history) are skipped. The
// document is a tagged stream (00 FF 4B 53) whose tags are four
// letters stored backwards; a string is "+", the tag, a u32 length and
// UTF-8. Nothing in the file is ever run, sizes are capped after
// decompression and pictures are only passed on as pictures (the
// caller decodes them as images). Affinity may change the format with
// any release: what cannot be read is left out and said in the report.
// zstd: vendor/fzstd (MIT), given by the caller (deps.zstd).
// Exposes LY_AF (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var MAX_TABLES = 64, MAX_ENTRIES = 20000, MAX_DOC = 256 * 1024 * 1024, MAX_PICS = 400, MAX_STR = 16 * 1024 * 1024;
  var STYLE_TAGS = { Base: 1, Foll: 1, Next: 1, PSty: 1, BSty: 1, TSty: 1 };
  var IMG = [
    { sig: [0xff, 0xd8, 0xff], type: "image/jpeg", ext: "jpg" },
    { sig: [0x89, 0x50, 0x4e, 0x47], type: "image/png", ext: "png" },
    { sig: [0x47, 0x49, 0x46, 0x38], type: "image/gif", ext: "gif" },
    { sig: [0x49, 0x49, 0x2a, 0x00], type: "image/tiff", ext: "tif" },
    { sig: [0x4d, 0x4d, 0x00, 0x2a], type: "image/tiff", ext: "tif" }
  ];

  function at(b, p, sig) {
    if (p < 0 || p + sig.length > b.length) return false;
    for (var k = 0; k < sig.length; k++) if (b[p + k] !== sig[k]) return false;
    return true;
  }
  function u16(b, p) { return b[p] | (b[p + 1] << 8); }
  function u32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; }
  // a u64 that fits a JS number (files are far below 2^53)
  function u64(b, p) { return u32(b, p) + u32(b, p + 4) * 4294967296; }
  var FIL = [0x23, 0x46, 0x69, 0x6c], FT4 = [0x23, 0x46, 0x54, 0x34], ZSTD = [0x28, 0xb5, 0x2f, 0xfd], KS = [0x00, 0xff, 0x4b, 0x53];

  function isAf(b) { return b && b.length > 24 && at(b, 0, [0x00, 0xff, 0x4b, 0x41]); }

  // One file table: its entries { id, off, size, csize, name } (each
  // checked: its offset holds "#Fil" and its bytes are inside the file).
  function table(b, p) {
    var prev = u64(b, p + 4), end = Math.min(u64(b, p + 20) || b.length, b.length), out = [];
    for (var i = p + 8; i + 44 <= end && out.length < MAX_ENTRIES; i++) {
      // u32 id, u8, u64 offset, u64 size, u64 stored size, 13 bytes,
      // u16 name length, name (ASCII paths such as "c/1", "d/1c1")
      var off = u64(b, i + 5), size = u64(b, i + 13), cs = u64(b, i + 21);
      if (!(size > 0 && cs > 0 && size <= 4294967295 && off + 8 <= b.length && cs <= b.length - off && at(b, off, FIL))) continue;
      var k = i + 42, nl = u16(b, k), name = "";
      for (var c = 0; nl < 64 && k + 2 + nl <= end && c < nl; c++) {
        var ch = b[k + 2 + c];
        if (ch < 32 || ch > 126) { name = ""; break; }
        name += String.fromCharCode(ch);
      }
      out.push({ id: u32(b, i), off: off, size: size, csize: cs, name: name });
      i += 28;
    }
    return { prev: prev, entries: out };
  }
  // The newest entry of every id, following the chain from the head.
  function files(b) {
    var head = u64(b, 16), seen = {}, out = [], n = 0;
    while (head && head + 32 < b.length && at(b, head, FT4) && n++ < MAX_TABLES) {
      var t = table(b, head);
      t.entries.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } });
      if (t.prev >= head) break;
      head = t.prev;
    }
    return out;
  }
  // A stored block ("#Fil" 00 FF 4B 53 … "Data" u32 length, bytes) →
  // its bytes, or null.
  function stored(b, off, len) {
    var p = off + 4;
    if (!at(b, p, KS)) return null;
    var lim = Math.min(b.length, p + 256);
    for (var i = p; i + 8 < lim; i++) {
      // "-" "ataD" = the Data tag
      if (b[i] === 0x2d && b[i + 1] === 0x61 && b[i + 2] === 0x74 && b[i + 3] === 0x61 && b[i + 4] === 0x44) {
        var n = u32(b, i + 5), s = i + 9;
        if (s + n <= b.length && (!len || n <= len)) return b.subarray(s, s + n);
        return null;
      }
    }
    return null;
  }
  function inflate(b, e, zstd) {
    var p = e.off + 4;
    if (!at(b, p, ZSTD) || !zstd || e.size > MAX_DOC || !e.size) return null;
    var end = Math.min(b.length, p + e.csize);
    return zstd.decompress(b.subarray(p, end), new Uint8Array(e.size));
  }
  function picture(bytes) {
    for (var k = 0; k < IMG.length; k++) if (at(bytes, 0, IMG[k].sig)) return IMG[k];
    return null;
  }

  // The tagged document → its strings by tag (in order).
  function strings(doc) {
    var dec = new TextDecoder("utf-8", { fatal: true }), out = [];
    for (var i = 0; i + 9 < doc.length; i++) {
      if (doc[i] !== 0x2b) continue;
      var ok = true;
      for (var k = 1; k <= 4; k++) { var c = doc[i + k]; if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 43 || c === 35)) { ok = false; break; } }
      if (!ok) continue;
      var n = u32(doc, i + 5);
      if (n > MAX_STR || i + 9 + n > doc.length) continue;
      var tag = String.fromCharCode(doc[i + 4], doc[i + 3], doc[i + 2], doc[i + 1]), s;
      try { s = dec.decode(doc.subarray(i + 9, i + 9 + n)); } catch (x) { continue; }
      out.push({ tag: tag, s: s, at: i });
      i += 8 + n;
    }
    return out;
  }
  function uniq(a) { var seen = {}; return a.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }); }

  // What a rebuild uses from the strings: words come from the text;
  // style names are names that a style points at (based on, next,
  // following) or whose object goes on with such a pointer.
  function content(list) {
    var text = [], fams = [], named = {}, styles = [];
    list.forEach(function (x) {
      if (x.tag === "Utf8") text.push(x.s);
      else if (x.tag === "Famy") fams.push(x.s);
      if (STYLE_TAGS[x.tag] && x.s) named[x.s] = 1;
    });
    list.forEach(function (x, k) {
      if (x.tag !== "Name" || !x.s) return;
      for (var j = k + 1; j < list.length && j <= k + 8 && list[j].at - x.at < 2048; j++) {
        if (list[j].tag === "Name") break;
        if (STYLE_TAGS[list[j].tag]) { named[x.s] = 1; break; }
      }
      if (named[x.s]) styles.push(x.s);
    });
    Object.keys(named).forEach(function (s) { styles.push(s); });
    return { text: text, fonts: uniq(fams), styles: uniq(styles) };
  }

  // bytes (Uint8Array) of an .af, deps { zstd: fzstd } → { text: [string],
  // fonts: [family], styles: [name], pictures: [{ name, type, bytes }],
  // files: entries in the file tables, problems: [code] } or null when
  // it is not an Affinity file.
  function read(bytes, deps) {
    if (!isAf(bytes)) return null;
    var zstd = deps && deps.zstd, list = files(bytes), problems = [], pics = [], docs = [];
    list.forEach(function (e) {
      if (at(bytes, e.off + 4, ZSTD)) { if (!/^d\//.test(e.name)) docs.push(e); return; }
      if (pics.length >= MAX_PICS) return;
      var data = stored(bytes, e.off, e.size);
      var kind = data && picture(data);
      if (kind) pics.push({ name: "af-" + (pics.length + 1) + "." + kind.ext, type: kind.type, bytes: data });
    });
    // the document: the first compressed file outside the data tiles
    // ("d/…") that holds a tagged stream, newest table first (older
    // copies of it, its history, are older entries of the same id)
    var doc = null;
    for (var k = 0; k < docs.length && !doc; k++) {
      try { var d = inflate(bytes, docs[k], zstd); if (d && at(d, 0, KS)) doc = d; } catch (x) { /* next */ }
    }
    if (!doc) problems.push(zstd ? "doc" : "zstd");
    var c = doc ? content(strings(doc)) : { text: [], fonts: [], styles: [] };
    c.pictures = pics;
    c.problems = problems;
    c.files = list.length;
    return c;
  }
  var api = { read: read, strings: strings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_AF = api;
})(typeof window !== "undefined" ? window : this);
