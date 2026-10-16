// ============================================================
// orOS Music — core.js (pure logic, v1.0.0)
// Everything that is not the screen, the audio element or the
// storage: reading the tags of a music file (ID3, FLAC, Ogg, MP4,
// WAV), track keys, text folding for search, the synced data model
// (likes + playlists) and its merge, the play queue (shuffle,
// repeat, "next up") and the library views (albums, artists,
// genres, folders).
// No DOM, no storage, no fetch. Node tests load it as is (it
// attaches OrosMusicCore to its global).
//
// Sections:
//   1. Constants
//   2. Text: decoding, folding, hashing
//   3. Tags: ID3v2 / ID3v1 / MP3 duration
//   4. Tags: FLAC, Ogg (Vorbis, Opus), MP4, WAV
//   5. readTags (one entry point) + track keys
//   6. Data model: normalize + merge (R5, R17, R26)
//   7. Mutations (stamp at the mutation site, R27)
//   8. Queue
//   9. Library views
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants ----------
  var DATA_VER = 1;
  var PL_RE = /^p[0-9a-z]{10,14}$/;
  var KEY_RE = /^[a-z]{1,3}:[0-9a-z]{6,40}$/;
  var LIM = { text: 200, likes: 20000, pls: 500, items: 5000, plName: 100, queue: 10000, up: 500, hist: 2000 };
  var DAY = 86400000;
  var AUDIO_EXT = /\.(mp3|m4a|m4b|aac|mp4|ogg|oga|opus|flac|wav|wave|weba|webm)$/i;
  var REPEAT = ["off", "all", "one"];
  var GENRES = ("Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|" +
    "Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|" +
    "Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|Alternative Rock|Bass|Soul|" +
    "Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|" +
    "Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|" +
    "Cabaret|New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|" +
    "Rock & Roll|Hard Rock|Folk|Folk-Rock|National Folk|Swing|Fast Fusion|Bebop|Latin|Revival|Celtic|Bluegrass|" +
    "Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|Easy Listening|" +
    "Acoustic|Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|Satire|Slow Jam|" +
    "Club|Tango|Samba|Folklore|Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A Cappella|" +
    "Euro-House|Dance Hall").split("|");

  // ---------- 2. Text: decoding, folding, hashing ----------
  function clean(v, max) {
    if (typeof v !== "string") return "";
    // eslint-disable-next-line no-control-regex
    v = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return v.length > (max || LIM.text) ? v.slice(0, max || LIM.text) : v;
  }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isStamp(v) { return typeof v === "number" && isFinite(v) && v > 0 && v < 1e14; }

  // Windows-1253 (Greek) for the bytes 0x80-0xFF; Latin-1 elsewhere.
  var CP1253_HI = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
    0x89: 0x2030, 0x8b: 0x2039, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013,
    0x97: 0x2014, 0x99: 0x2122, 0x9b: 0x203a, 0xa1: 0x385, 0xa2: 0x386, 0xb4: 0x384, 0xb8: 0x388, 0xb9: 0x389, 0xba: 0x38a,
    0xbc: 0x38c, 0xbe: 0x38e, 0xbf: 0x38f };
  function cp1253(b) {
    if (b < 0x80) return b;
    if (CP1253_HI[b]) return CP1253_HI[b];
    if (b >= 0xc0 && b <= 0xfe && b !== 0xd2) return b - 0xc0 + 0x390;
    return b;
  }
  // Old tags (ID3 "ISO-8859-1", ID3v1, RIFF INFO) were often written
  // in the Windows code page of the user's country. "auto" picks Greek
  // when the high bytes look like Greek words: most letters high, in
  // runs (Latin-1 accents come one at a time between ASCII letters).
  function looksGreek(bytes) {
    var hi = 0, lo = 0, run = 0, runs = 0;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b >= 0xc1 && b <= 0xfe) { hi++; run++; if (run === 2) runs++; }
      else { run = 0; if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) lo++; }
    }
    return hi >= 2 && runs >= 1 && hi / (hi + lo) > 0.6;
  }
  function decodeLegacy(bytes, mode) {
    var greek = mode === "el" || (mode !== "latin" && looksGreek(bytes));
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(greek ? cp1253(bytes[i]) : bytes[i]);
    return out;
  }
  function utf8(bytes) {
    if (typeof TextDecoder === "function") { try { return new TextDecoder("utf-8").decode(bytes); } catch (e) {} }
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function utf16(bytes, be) {
    var s = "", i = 0;
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { be = false; i = 2; }
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) { be = true; i = 2; }
    }
    for (; i + 1 < bytes.length; i += 2) s += String.fromCharCode(be ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8));
    return s;
  }
  // Accent-free, case-free form for search and sorting keys.
  function fold(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  // Two FNV-1a 32-bit hashes (different seeds) in base 36.
  function hash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619);
      h2 ^= c; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x5bd1e995);
    }
    return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 14);
  }
  function newId(prefix, now, rnd) {
    var r = typeof rnd === "number" ? rnd : Math.random();
    var t = Math.floor(now || Date.now()).toString(36), x = Math.floor(r * 2176782336).toString(36);
    while (t.length < 8) t = "0" + t;
    while (x.length < 6) x = "0" + x;
    return prefix + (t + x).slice(0, 13);
  }
  function u32be(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function u32le(b, o) { return b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0); }
  function ascii(b, o, n) { var s = ""; for (var i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }
  function sniffImage(b) {
    if (!b || b.length < 12) return "";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
    if (ascii(b, 0, 3) === "GIF") return "image/gif";
    return "";
  }
  // "3/12" → 3; "(17)" or "17" → genre name; first of null-separated lists.
  function num(v) { var m = /^\s*(\d{1,4})/.exec(String(v || "")); return m ? +m[1] : 0; }
  function genreName(v) {
    v = clean(String(v || "").split("\u0000")[0]);
    var m = /^\((\d{1,3})\)(.*)$/.exec(v);
    if (m) return clean(m[2]) || GENRES[+m[1]] || "";
    if (/^\d{1,3}$/.test(v)) return GENRES[+v] || "";
    return v;
  }
  function year(v) { var m = /(\d{4})/.exec(String(v || "")); return m && +m[1] >= 1000 && +m[1] <= 2999 ? +m[1] : 0; }

  // ---------- 3. Tags: ID3v2 / ID3v1 / MP3 duration ----------
  function synchsafe(b, o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
  // Total bytes of an ID3v2 tag at the start (0 if none).
  function id3Size(b) {
    if (!b || b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
    return 10 + synchsafe(b, 6) + (b[5] & 0x10 ? 10 : 0);
  }
  function deUnsync(b) {
    var out = [], i = 0;
    for (; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
    return new Uint8Array(out);
  }
  function id3Text(fr, legacy) {
    if (!fr.length) return "";
    var enc = fr[0], body = fr.subarray(1), s;
    if (enc === 1) s = utf16(body, false);
    else if (enc === 2) s = utf16(body, true);
    else if (enc === 3) s = utf8(body);
    else {
      var end = body.indexOf(0);
      s = decodeLegacy(end >= 0 ? body.subarray(0, end) : body, legacy);
    }
    return s.split("\u0000").filter(function (x) { return x.trim(); }).join("; ");
  }
  // Ends of a string in an ID3 frame: 1 zero byte (Latin-1, UTF-8) or 2 aligned (UTF-16).
  function strEnd(b, o, enc) {
    if (enc === 1 || enc === 2) { for (var i = o; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return -1; }
    var j = b.indexOf(0, o);
    return j;
  }
  function id3Picture(fr, v22) {
    var enc = fr[0], o = 1, mime;
    if (v22) { mime = ascii(fr, 1, 3).toLowerCase() === "png" ? "image/png" : "image/jpeg"; o = 4; }
    else { var e = fr.indexOf(0, 1); if (e < 0) return null; mime = ascii(fr, 1, e - 1).toLowerCase(); o = e + 1; }
    var type = fr[o]; o++;
    var de = strEnd(fr, o, enc);
    if (de < 0) return null;
    o = de + (enc === 1 || enc === 2 ? 2 : 1);
    var data = fr.subarray(o);
    var real = sniffImage(data);
    if (!real) return null;
    return { type: type, mime: real || mime, data: data };
  }
  function parseId3v2(b, legacy) {
    var size = id3Size(b);
    if (!size) return null;
    var ver = b[3], flags = b[5];
    var tag = b.subarray(10, Math.min(b.length, size));
    if (ver < 4 && (flags & 0x80)) tag = deUnsync(tag);
    var o = 0, out = { pics: [] };
    if (flags & 0x40) {                      // extended header
      if (ver === 3) o = 4 + u32be(tag, 0);
      else if (ver === 4) o = synchsafe(tag, 0);
    }
    var v22 = ver === 2, hdr = v22 ? 6 : 10;
    while (o + hdr <= tag.length) {
      var id = ascii(tag, o, v22 ? 3 : 4);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      var len = v22 ? (tag[o + 3] << 16) | (tag[o + 4] << 8) | tag[o + 5] : ver === 4 ? synchsafe(tag, o + 4) : u32be(tag, o + 4);
      var fflags = v22 ? 0 : tag[o + 9];
      if (len <= 0 || o + hdr + len > tag.length) break;
      var fr = tag.subarray(o + hdr, o + hdr + len);
      if (ver === 4 && (fflags & 0x02)) fr = deUnsync(fr);
      if (ver === 4 && (fflags & 0x01)) fr = fr.subarray(4);   // data length indicator
      o += hdr + len;
      if (!v22 && (fflags & 0x0c)) continue;                     // compressed or encrypted: skip
      var key = { TIT2: "t", TT2: "t", TPE1: "a", TP1: "a", TPE2: "aa", TP2: "aa", TALB: "al", TAL: "al",
        TRCK: "n", TRK: "n", TPOS: "dn", TPA: "dn", TCON: "g", TCO: "g", TYER: "y", TYE: "y", TDRC: "y", TLEN: "len" }[id];
      if (key) { if (!out[key]) out[key] = id3Text(fr, legacy); continue; }
      if (id === "APIC" || id === "PIC") { var p = id3Picture(fr, v22); if (p) out.pics.push(p); }
    }
    return out;
  }
  function parseId3v1(tail, legacy) {
    if (!tail || tail.length < 128) return null;
    var t = tail.subarray(tail.length - 128);
    if (ascii(t, 0, 3) !== "TAG") return null;
    var f = function (o, n) { var s = t.subarray(o, o + n), e = s.indexOf(0); return clean(decodeLegacy(e >= 0 ? s.subarray(0, e) : s, legacy)); };
    return { t: f(3, 30), a: f(33, 30), al: f(63, 30), y: f(93, 4), n: t[125] === 0 && t[126] ? String(t[126]) : "",
      g: t[127] < GENRES.length ? GENRES[t[127]] : "" };
  }
  var MP3_BR = {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],   // MPEG1 L1
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],      // MPEG1 L2
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],       // MPEG1 L3
    21: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],     // MPEG2 L1
    22: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]           // MPEG2 L2/L3
  };
  var MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  // Seconds of an MP3: Xing/Info or VBRI frame count, else constant bitrate.
  function mp3Duration(b, size, start, tailTag) {
    for (var i = start; i + 4 < b.length && i < start + 65536; i++) {
      if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
      var verBits = (b[i + 1] >> 3) & 3, layerBits = (b[i + 1] >> 1) & 3, brIdx = b[i + 2] >> 4, srIdx = (b[i + 2] >> 2) & 3;
      if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
      var layer = 4 - layerBits, mpeg1 = verBits === 3;
      var br = (mpeg1 ? MP3_BR[layer] : MP3_BR[layer === 1 ? 21 : 22])[brIdx] * 1000;
      var sr = MP3_SR[verBits][srIdx];
      var spf = layer === 1 ? 384 : (layer === 3 && !mpeg1 ? 576 : 1152);
      var mono = (b[i + 3] >> 6) === 3;
      var side = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
      var x = i + 4 + side, tag = ascii(b, x, 4);
      if (tag === "Xing" || tag === "Info") {
        if (b[x + 7] & 1) { var frames = u32be(b, x + 8); if (frames) return frames * spf / sr; }
      }
      if (ascii(b, i + 36, 4) === "VBRI") { var fr2 = u32be(b, i + 36 + 14); if (fr2) return fr2 * spf / sr; }
      var bytes = size - i - (tailTag ? 128 : 0);
      return br > 0 && bytes > 0 ? bytes * 8 / br : 0;
    }
    return 0;
  }

  // ---------- 4. Tags: FLAC, Ogg (Vorbis, Opus), MP4, WAV ----------
  function vorbisComments(b, o, out) {
    if (o + 8 > b.length) return;
    var vlen = u32le(b, o); o += 4 + vlen;
    if (o + 4 > b.length) return;
    var n = u32le(b, o); o += 4;
    for (var i = 0; i < n && i < 1000 && o + 4 <= b.length; i++) {
      var len = u32le(b, o); o += 4;
      if (o + len > b.length) break;
      var kv = b.subarray(o, o + len); o += len;
      var eq = kv.indexOf(0x3d);
      if (eq < 1) continue;
      var k = ascii(kv, 0, eq).toUpperCase();
      if (k === "METADATA_BLOCK_PICTURE") {
        var raw = base64(ascii(kv, eq + 1, kv.length - eq - 1));
        var p = raw && flacPicture(raw, 0);
        if (p) out.pics.push(p);
        continue;
      }
      var key = { TITLE: "t", ARTIST: "a", ALBUMARTIST: "aa", "ALBUM ARTIST": "aa", ALBUM: "al", TRACKNUMBER: "n",
        DISCNUMBER: "dn", GENRE: "g", DATE: "y", YEAR: "y" }[k];
      if (key && !out[key]) out[key] = utf8(kv.subarray(eq + 1));
    }
  }
  function base64(s) {
    try {
      if (typeof atob === "function") { var bin = atob(s.replace(/\s+/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
      if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
    } catch (e) {}
    return null;
  }
  function flacPicture(b, o) {
    if (o + 32 > b.length) return null;
    var type = u32be(b, o), ml = u32be(b, o + 4), mime = ascii(b, o + 8, ml);
    var p = o + 8 + ml, dl = u32be(b, p); p += 4 + dl + 16;
    var len = u32be(b, p); p += 4;
    if (p + len > b.length) return null;
    var data = b.subarray(p, p + len), real = sniffImage(data);
    return real ? { type: type, mime: real || mime, data: data } : null;
  }
  function parseFlac(b) {
    if (ascii(b, 0, 4) !== "fLaC") return null;
    var o = 4, out = { pics: [] };
    for (var guard = 0; o + 4 <= b.length && guard < 64; guard++) {
      var last = b[o] & 0x80, type = b[o] & 0x7f, len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
      var s = o + 4;
      if (type === 0 && s + 18 <= b.length) {
        var sr = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4);
        var total = (b[s + 13] & 0x0f) * 4294967296 + u32be(b, s + 14);
        if (sr) out.dur = total / sr;
      } else if (type === 4 && s + len <= b.length) vorbisComments(b.subarray(s, s + len), 0, out);
      else if (type === 6 && s + len <= b.length) { var p = flacPicture(b.subarray(s, s + len), 0); if (p) out.pics.push(p); }
      if (last) break;
      o = s + len;
    }
    return out;
  }
  // The first packets of an Ogg stream (pages joined; a lacing value
  // under 255 ends a packet).
  function oggPackets(b, want) {
    var packets = [], curp = [], o = 0;
    while (o + 27 <= b.length && packets.length < want) {
      if (ascii(b, o, 4) !== "OggS") break;
      var nseg = b[o + 26], data = o + 27 + nseg;
      for (var i = 0; i < nseg; i++) {
        var lv = b[o + 27 + i];
        if (data + lv > b.length) return packets;
        curp.push(b.subarray(data, data + lv)); data += lv;
        if (lv < 255) {
          var n = 0; curp.forEach(function (c) { n += c.length; });
          var pk = new Uint8Array(n), k = 0; curp.forEach(function (c) { pk.set(c, k); k += c.length; });
          packets.push(pk); curp = [];
          if (packets.length >= want) break;
        }
      }
      o = data;
    }
    return packets;
  }
  function oggLastGranule(tail) {
    if (!tail) return 0;
    for (var i = tail.length - 27; i >= 0; i--) {
      if (tail[i] === 0x4f && ascii(tail, i, 4) === "OggS") return u32le(tail, i + 6) + u32le(tail, i + 10) * 4294967296;
    }
    return 0;
  }
  function parseOgg(b, tail) {
    if (ascii(b, 0, 4) !== "OggS") return null;
    var ps = oggPackets(b, 2), out = { pics: [] };
    if (ps.length < 1) return out;
    var head = ps[0], rate = 0, pre = 0;
    if (ascii(head, 1, 6) === "vorbis") rate = u32le(head, 12);
    else if (ascii(head, 0, 8) === "OpusHead") { rate = 48000; pre = head[10] | (head[11] << 8); }
    if (ps[1]) {
      if (ascii(ps[1], 1, 6) === "vorbis") vorbisComments(ps[1], 7, out);
      else if (ascii(ps[1], 0, 8) === "OpusTags") vorbisComments(ps[1], 8, out);
    }
    var g = oggLastGranule(tail);
    if (rate && g > pre) out.dur = (g - pre) / rate;
    return out;
  }
  // Walk MP4 boxes in [o, end): fn(type, bodyStart, boxEnd).
  function boxes(b, o, end, fn) {
    while (o + 8 <= end) {
      var size = u32be(b, o), type = ascii(b, o + 4, 4), hs = 8;
      if (size === 1) { size = u32be(b, o + 8) * 4294967296 + u32be(b, o + 12); hs = 16; }
      else if (size === 0) size = end - o;
      if (size < hs) return;
      if (fn(type, o + hs, Math.min(end, o + size), o, size) === false) return;
      o += size;
    }
  }
  // One top-level MP4 box header (16 bytes are enough): the app walks
  // the boxes of a file with it to find moov, which can sit after the
  // media at the end of the file. → { type, size } or null.
  function mp4Box(b) {
    if (!b || b.length < 8) return null;
    var size = u32be(b, 0), type = ascii(b, 4, 4);
    if (!/^[\x20-\x7e\xa9]{4}$/.test(type)) return null;
    if (size === 1) { if (b.length < 16) return null; size = u32be(b, 8) * 4294967296 + u32be(b, 12); }
    return { type: type, size: size };
  }
  function parseMp4(b) {
    var out = { pics: [] }, moov = null;
    boxes(b, 0, b.length, function (type, s, e) { if (type === "moov") { moov = [s, e]; return false; } });
    if (!moov) return ascii(b, 4, 4) === "ftyp" ? out : null;
    boxes(b, moov[0], moov[1], function (type, s, e) {
      if (type === "mvhd") {
        var v = b[s], ts = v === 1 ? u32be(b, s + 20) : u32be(b, s + 12);
        var d = v === 1 ? u32be(b, s + 24) * 4294967296 + u32be(b, s + 28) : u32be(b, s + 16);
        if (ts) out.dur = d / ts;
      }
      if (type !== "udta") return;
      boxes(b, s, e, function (t2, s2, e2) {
        if (t2 !== "meta") return;
        boxes(b, s2 + 4, e2, function (t3, s3, e3) {
          if (t3 !== "ilst") return;
          boxes(b, s3, e3, function (item, s4, e4) {
            var data = null;
            boxes(b, s4, e4, function (t5, s5, e5) { if (t5 === "data") { data = { type: u32be(b, s5) & 0xffffff, v: b.subarray(s5 + 8, e5) }; return false; } });
            if (!data) return;
            var key = { "©nam": "t", "©ART": "a", "aART": "aa", "©alb": "al", "©day": "y", "©gen": "g" }[item];
            if (key) { if (!out[key]) out[key] = utf8(data.v); return; }
            if (item === "trkn" && data.v.length >= 4) out.n = String((data.v[2] << 8) | data.v[3]);
            else if (item === "disk" && data.v.length >= 4) out.dn = String((data.v[2] << 8) | data.v[3]);
            else if (item === "gnre" && data.v.length >= 2) out.g = out.g || GENRES[((data.v[0] << 8) | data.v[1]) - 1] || "";
            else if (item === "covr") { var mime = sniffImage(data.v); if (mime) out.pics.push({ type: 3, mime: mime, data: data.v }); }
          });
        });
      });
    });
    return out;
  }
  function parseWav(b, size, legacy) {
    if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
    var out = { pics: [] }, rate = 0, o = 12;
    while (o + 8 <= b.length) {
      var id = ascii(b, o, 4), len = u32le(b, o + 4), s = o + 8;
      if (id === "fmt " && s + 12 <= b.length) rate = u32le(b, s + 8);
      else if (id === "data") { if (rate) out.dur = Math.min(len, size - s) / rate; }
      else if (id === "LIST" && ascii(b, s, 4) === "INFO") {
        var p = s + 4;
        while (p + 8 <= Math.min(b.length, s + len)) {
          var sid = ascii(b, p, 4), sl = u32le(b, p + 4), v = b.subarray(p + 8, p + 8 + sl), z = v.indexOf(0);
          var key = { INAM: "t", IART: "a", IPRD: "al", IGNR: "g", ICRD: "y", ITRK: "n", IPRT: "n" }[sid];
          if (key && !out[key]) out[key] = decodeLegacy(z >= 0 ? v.subarray(0, z) : v, legacy);
          p += 8 + sl + (sl & 1);
        }
      }
      if (id === "data") break;
      o = s + len + (len & 1);
    }
    return out;
  }

  // ---------- 5. readTags (one entry point) + track keys ----------
  // src = { head: Uint8Array (start of the file), tail: Uint8Array
  // (last bytes, for ID3v1 / Ogg length; optional), moov: Uint8Array
  // (MP4 moov box found with mp4Box; optional), size, name }
  // opts.legacy = "auto" | "el" | "latin" (old 8-bit tags).
  // → { t, a, aa, al, n, dn, g, y, dur, pic: {mime, data} | null, fmt }
  function stem(name) {
    var base = String(name || "").split("/").pop().replace(/\.[^.]+$/, "");
    return clean(base.replace(/_/g, " "));
  }
  // "01 - Artist - Title" / "Artist - Title" / "01. Title" from a file name.
  function fromName(name) {
    var s = stem(name), out = { t: s, a: "", n: 0 };
    var m = /^(\d{1,3})[\s.\-_)]+(.+)$/.exec(s);
    if (m) { out.n = +m[1]; s = m[2]; out.t = s; }
    var parts = s.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) { out.a = clean(parts[0]); out.t = clean(parts.slice(1).join(" - ")); }
    return out;
  }
  function readTags(src, opts) {
    var legacy = (opts && opts.legacy) || "auto";
    var head = src.head || new Uint8Array(0), size = +src.size || head.length, tail = src.tail || null;
    var r = null, fmt = "";
    try {
      if (id3Size(head) || /\.mp3$/i.test(src.name || "")) {
        fmt = "mp3";
        r = parseId3v2(head, legacy) || { pics: [] };
        var v1 = parseId3v1(tail, legacy);
        if (v1) Object.keys(v1).forEach(function (k) { if (!r[k] && v1[k]) r[k] = v1[k]; });
        if (r.len && +String(r.len).replace(/\D/g, "") > 0) r.dur = +String(r.len).replace(/\D/g, "") / 1000;
        if (!r.dur) r.dur = mp3Duration(head, size, id3Size(head), !!v1);
        if (id3Size(head) && head.length >= id3Size(head) && head[id3Size(head)] === 0x66 && ascii(head, id3Size(head), 4) === "fLaC") {
          var fl = parseFlac(head.subarray(id3Size(head)));                 // FLAC with a leading ID3 tag
          if (fl) { fmt = "flac"; Object.keys(fl).forEach(function (k) { if (k !== "pics" && fl[k] && !r[k]) r[k] = fl[k]; }); r.pics = r.pics.concat(fl.pics); r.dur = fl.dur || r.dur; }
        }
      } else if ((r = parseFlac(head))) fmt = "flac";
      else if ((r = parseOgg(head, tail))) fmt = "ogg";
      else if (ascii(head, 4, 4) === "ftyp") { fmt = "mp4"; r = parseMp4(src.moov && ascii(src.moov, 4, 4) === "moov" ? src.moov : head) || { pics: [] }; }
      else if ((r = parseWav(head, size, legacy))) fmt = "wav";
    } catch (e) { r = r || null; }
    r = r || { pics: [] };
    // The front cover (picture type 3) first, else the first picture.
    var pic = null;
    (r.pics || []).forEach(function (p) { if (!pic || (p.type === 3 && pic.type !== 3)) pic = p; });
    var nm = fromName(src.name);
    var t = clean(r.t) || nm.t || "", a = clean(r.a) || nm.a || "";
    return {
      t: t, a: a, aa: clean(r.aa), al: clean(r.al), n: num(r.n) || nm.n || 0, dn: num(r.dn), g: genreName(r.g), y: year(r.y),
      dur: r.dur > 0 && isFinite(r.dur) ? Math.round(r.dur) : 0, pic: pic ? { mime: pic.mime, data: pic.data } : null, fmt: fmt
    };
  }
  // A track's key is the same on every device for the same song:
  // "l:" + hash of artist, title and album (or of the file name when
  // the file has no tags). Playlists and likes hold keys, never paths.
  function trackKey(tags, path) {
    var a = fold(tags.aa || tags.a), t = fold(tags.t), al = fold(tags.al);
    if (!t) return "l:" + hash("f|" + fold(String(path || "").split("/").pop()));
    return "l:" + hash(a + "|" + t + "|" + al);
  }
  function albumKey(tags) {
    var al = fold(tags.al);
    if (!al) return "";
    return "b:" + hash(fold(tags.aa || tags.a) + "|" + al);
  }
  function artistKey(name) { return name ? "r:" + hash(fold(name)) : ""; }
  function isAudioName(name) { return AUDIO_EXT.test(String(name || "")); }

  // ---------- 6. Data model: normalize + merge ----------
  // MUSIC v1 (slice "music", key "oros-music-data"):
  //   { ver, likes: [like], pls: [pl], tombs: { plId: m } }
  //   like = { k, m, on 1|0, t, a, al?, d? }  (on 0 = unliked; kept as
  //          the newer state, pruned after a year)
  //   pl   = { id "p…", m, n (name), it: [ref] }
  //   ref  = { k, t, a, al?, d? }              (what a playlist lists)
  //   A song from an open catalogue (open.js, since wave 2) also keeps
  //   where it plays from, so it works on every device:
  //   { s "ia"|"ov"|"cc", u https audio, pg? https page, art? https
  //     cover, li? licence, vi? Openverse source, off? 1 = may be saved
  //     offline, ai? / ri? the source's album / artist id (Jamendo,
  //     since wave 3) }. Its key starts with its source ("ia:", "ov:",
  //     "cc:", "jm:").
  //   Since wave 4 (servers.js): "ln" is a public link from a playlist
  //   file or a music feed (same fields, no licence); a song of the
  //   user's own server is { k "sv:…", s "sv", sh server id, ii item id
  //   on that server, ai? / ri? album / artist id, ca? cover id }: no
  //   address (it needs the login, which stays on the device).
  var SRC_RE = /^(ia|ov|cc|jm|ln)$/;
  var SH_RE = /^[0-9a-z]{6,14}$/;
  var SID_RE = /^[A-Za-z0-9._-]{1,100}$/;
  var LI_RE = /^(cc0|pdm|lma|by(-nc)?(-sa|-nd)?|(nc-)?sampling\+)( \d\.\d)?$/;
  function httpsUrl(u) { return typeof u === "string" && u.length <= 1000 && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }
  function svId(v, max) {
    // eslint-disable-next-line no-control-regex
    return typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  }
  function server(r, o) {
    if (r.k.slice(0, 3) !== "sv:" || !SH_RE.test(r.sh) || !svId(r.ii, 1000)) return o;
    o.s = "sv"; o.sh = r.sh; o.ii = r.ii;
    if (svId(r.ai, 200)) o.ai = r.ai;
    if (svId(r.ri, 200)) o.ri = r.ri;
    if (svId(r.ca, 500)) o.ca = r.ca;
    return o;
  }
  function remote(r, o) {
    if (r.s === "sv") return server(r, o);
    if (!SRC_RE.test(r.s) || r.k.slice(0, 3) !== r.s + ":" || !httpsUrl(r.u)) return o;
    o.s = r.s; o.u = r.u;
    if (httpsUrl(r.pg)) o.pg = r.pg;
    if (httpsUrl(r.art)) o.art = r.art;
    if (typeof r.li === "string" && LI_RE.test(r.li)) o.li = r.li;
    if (typeof r.vi === "string" && /^[a-z_]{1,30}$/.test(r.vi)) o.vi = r.vi;
    if (r.off === 1) o.off = 1;
    if (typeof r.ai === "string" && SID_RE.test(r.ai)) o.ai = r.ai;
    if (typeof r.ri === "string" && SID_RE.test(r.ri)) o.ri = r.ri;
    return o;
  }
  function normRef(r) {
    if (!r || typeof r !== "object" || typeof r.k !== "string" || !KEY_RE.test(r.k)) return null;
    var o = { k: r.k, t: clean(r.t) || "?", a: clean(r.a) };
    if (clean(r.al)) o.al = clean(r.al);
    if (+r.d > 0 && +r.d < 360000) o.d = Math.round(+r.d);
    return remote(r, o);
  }
  function normLike(r) {
    var ref = normRef(r);
    if (!ref || !isStamp(r.m)) return null;
    var o = { k: ref.k, m: r.m, on: r.on === 0 ? 0 : 1 };
    Object.keys(ref).forEach(function (f) { if (f !== "k") o[f] = ref[f]; });
    return o;
  }
  function normPl(r) {
    if (!r || typeof r !== "object" || !PL_RE.test(r.id) || !isStamp(r.m)) return null;
    var it = [];
    (Array.isArray(r.it) ? r.it : []).forEach(function (x) { var y = normRef(x); if (y && it.length < LIM.items) it.push(y); });
    return { id: r.id, m: r.m, n: clean(r.n, LIM.plName) || "Playlist", it: it };
  }
  // LWW by m; equal m: the larger canonical JSON wins (R26).
  function pick(a, b) {
    if (!a) return b; if (!b) return a;
    if (b.m > a.m) return b; if (a.m > b.m) return a;
    return JSON.stringify(b) > JSON.stringify(a) ? b : a;
  }
  function emptyData() { return { ver: DATA_VER, likes: [], pls: [], tombs: {} }; }
  function mergeMusic(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var likes = {}, pls = {}, tombs = {};
    [a, b].forEach(function (s) {
      if (Array.isArray(s.likes)) s.likes.forEach(function (r) { var x = normLike(r); if (x) likes[x.k] = pick(likes[x.k], x); });
      if (Array.isArray(s.pls)) s.pls.forEach(function (r) { var x = normPl(r); if (x) pls[x.id] = pick(pls[x.id], x); });
      if (s.tombs && typeof s.tombs === "object") Object.keys(s.tombs).forEach(function (id) {
        var v = s.tombs[id];
        if (PL_RE.test(id) && isStamp(v) && (!(id in tombs) || v > tombs[id])) tombs[id] = v;
      });
    });
    var newest = 0;
    Object.keys(likes).forEach(function (k) { if (likes[k].m > newest) newest = likes[k].m; });
    Object.keys(pls).forEach(function (k) { if (pls[k].m > newest) newest = pls[k].m; });
    Object.keys(tombs).forEach(function (k) { if (tombs[k] > newest) newest = tombs[k]; });
    var keep = newest - 365 * DAY;
    // Unliked entries and tombstones older than a year are dropped.
    var outLikes = Object.keys(likes).sort(cmpStr).map(function (k) { return likes[k]; })
      .filter(function (l) { return l.on || l.m >= keep; });
    if (outLikes.length > LIM.likes) outLikes = outLikes.sort(function (x, y) { return y.m - x.m || cmpStr(x.k, y.k); }).slice(0, LIM.likes).sort(function (x, y) { return cmpStr(x.k, y.k); });
    // Delete wins ties; a newer edit resurrects.
    var outPls = Object.keys(pls).sort(cmpStr).filter(function (id) { return !(id in tombs && tombs[id] >= pls[id].m); })
      .map(function (id) { return pls[id]; });
    if (outPls.length > LIM.pls) outPls = outPls.slice(0, LIM.pls);
    var outTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { if (tombs[id] >= keep) outTombs[id] = tombs[id]; });
    return { ver: DATA_VER, likes: outLikes, pls: outPls, tombs: outTombs };
  }
  function canon(d) { return mergeMusic(d, d); }

  // ---------- 7. Mutations (stamp at the mutation site, R27) ----------
  function copy(d) { return JSON.parse(JSON.stringify(canon(d))); }
  function isLiked(d, k) {
    var l = (d.likes || []).filter(function (x) { return x.k === k; })[0];
    return !!(l && l.on);
  }
  function likedList(d) {
    return (d.likes || []).filter(function (l) { return l.on; }).sort(function (x, y) { return y.m - x.m || cmpStr(x.k, y.k); });
  }
  function setLike(d, ref, on, now) {
    var r = normRef(ref);
    if (!r) return d;
    var c = copy(d);
    c.likes = c.likes.filter(function (l) { return l.k !== r.k; });
    c.likes.push(normLike(Object.assign({}, r, { m: now, on: on ? 1 : 0 })));
    return canon(c);
  }
  function findPl(d, id) { return (d.pls || []).filter(function (p) { return p.id === id; })[0] || null; }
  function addPl(d, name, refs, now, rnd) {
    var c = copy(d), id = newId("p", now, rnd);
    var it = (refs || []).map(normRef).filter(Boolean).slice(0, LIM.items);
    c.pls.push({ id: id, m: now, n: clean(name, LIM.plName) || "Playlist", it: it });
    return { data: canon(c), id: id };
  }
  function editPl(d, id, fn, now) {
    var c = copy(d), p = findPl(c, id);
    if (!p) return d;
    fn(p);
    p.m = now;
    p.it = p.it.map(normRef).filter(Boolean).slice(0, LIM.items);
    return canon(c);
  }
  function renamePl(d, id, name, now) { return editPl(d, id, function (p) { p.n = clean(name, LIM.plName) || p.n; }, now); }
  function addToPl(d, id, refs, now) {
    return editPl(d, id, function (p) { (refs || []).forEach(function (r) { var x = normRef(r); if (x) p.it.push(x); }); }, now);
  }
  function removeFromPl(d, id, idx, now) { return editPl(d, id, function (p) { if (idx >= 0 && idx < p.it.length) p.it.splice(idx, 1); }, now); }
  function movePl(d, id, from, to, now) {
    return editPl(d, id, function (p) {
      if (from < 0 || from >= p.it.length || to < 0 || to >= p.it.length || from === to) return;
      var x = p.it.splice(from, 1)[0];
      p.it.splice(to, 0, x);
    }, now);
  }
  function deletePl(d, id, now) {
    var c = copy(d);
    c.pls = c.pls.filter(function (p) { return p.id !== id; });
    c.tombs[id] = now;
    return canon(c);
  }

  // ---------- 8. Queue ----------
  // Q = { ctx: [item] (what was started: an album, a playlist, all
  //       songs), ord: [index into ctx] (play order; shuffled when
  //       shf), at: position in ord, up: [item] ("next up", added by
  //       hand, played before the rest), cur: item | null, fromUp,
  //       shf 0|1, rep "off"|"all"|"one", src: {kind, id, n} }
  // item = a ref plus where to play it: { k, t, a, al, d, p (orOS disk
  // path) | u (address), art? }. rnd = function () → [0, 1).
  function emptyQueue() { return { ctx: [], ord: [], at: -1, up: [], cur: null, fromUp: 0, shf: 0, rep: "off", src: null }; }
  function shuffled(n, first, rnd) {
    var a = [];
    for (var i = 0; i < n; i++) if (i !== first) a.push(i);
    for (var j = a.length - 1; j > 0; j--) { var r = Math.floor(rnd() * (j + 1)), t = a[j]; a[j] = a[r]; a[r] = t; }
    if (first >= 0 && first < n) a.unshift(first);
    return a;
  }
  function seq(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function normQueue(Q) {
    var q = emptyQueue();
    if (!Q || typeof Q !== "object") return q;
    q.ctx = Array.isArray(Q.ctx) ? Q.ctx.slice(0, LIM.queue) : [];
    var n = q.ctx.length;
    q.ord = Array.isArray(Q.ord) && Q.ord.length === n && Q.ord.every(function (i) { return i >= 0 && i < n; }) ? Q.ord.slice() : seq(n);
    q.at = typeof Q.at === "number" && Q.at >= -1 && Q.at < n ? Q.at : -1;
    q.up = Array.isArray(Q.up) ? Q.up.slice(0, LIM.up) : [];
    q.cur = Q.cur && typeof Q.cur === "object" ? Q.cur : null;
    q.fromUp = Q.fromUp ? 1 : 0;
    q.shf = Q.shf ? 1 : 0;
    q.rep = REPEAT.indexOf(Q.rep) >= 0 ? Q.rep : "off";
    q.src = Q.src && typeof Q.src === "object" ? { kind: String(Q.src.kind || ""), id: String(Q.src.id || ""), n: clean(Q.src.n) } : null;
    return q;
  }
  // Start a list at one of its items (idx -1 + shuffle = random start).
  function qStart(Q, list, idx, opts, rnd) {
    var q = normQueue(Q);
    rnd = rnd || Math.random;
    q.ctx = (list || []).slice(0, LIM.queue);
    var n = q.ctx.length;
    if (opts && typeof opts.shf === "number") q.shf = opts.shf ? 1 : 0;
    if (opts && opts.src) q.src = opts.src;
    if (!n) { q.ord = []; q.at = -1; q.cur = null; return q; }
    var first = idx >= 0 && idx < n ? idx : (q.shf ? Math.floor(rnd() * n) : 0);
    q.ord = q.shf ? shuffled(n, first, rnd) : seq(n);
    q.at = q.ord.indexOf(first);
    q.cur = q.ctx[first];
    q.fromUp = 0;
    return q;
  }
  // The track after the current one (manual = the user pressed Next:
  // "repeat one" moves on then). → { q, item } (item null = the end).
  function qNext(Q, manual, rnd) {
    var q = normQueue(Q);
    rnd = rnd || Math.random;
    if (q.rep === "one" && !manual && q.cur) return { q: q, item: q.cur };
    if (q.up.length) { q.cur = q.up.shift(); q.fromUp = 1; return { q: q, item: q.cur }; }
    var n = q.ctx.length;
    if (!n) { q.cur = null; q.fromUp = 0; return { q: q, item: null }; }
    if (q.at + 1 < n) q.at++;
    else if (q.rep === "all" || (q.rep === "one" && manual)) {
      if (q.shf) q.ord = shuffled(n, -1, rnd);
      q.at = 0;
    } else { q.cur = null; q.fromUp = 0; q.at = n; return { q: q, item: null }; }
    q.cur = q.ctx[q.ord[q.at]];
    q.fromUp = 0;
    return { q: q, item: q.cur };
  }
  // Previous in the play order (the caller restarts the track instead
  // when more than 3 s have played).
  function qPrev(Q) {
    var q = normQueue(Q), n = q.ctx.length;
    if (!n) return { q: q, item: q.cur };
    if (q.fromUp) { q.fromUp = 0; q.at = Math.max(0, Math.min(q.at, n - 1)); q.cur = q.ctx[q.ord[q.at]]; return { q: q, item: q.cur }; }
    if (q.at > 0) q.at--;
    else if (q.rep === "all") q.at = n - 1;
    else q.at = 0;
    q.cur = q.ctx[q.ord[q.at]];
    return { q: q, item: q.cur };
  }
  // Shuffle on: the rest is shuffled, the current track stays. Off:
  // back to list order from the current track.
  function qShuffle(Q, on, rnd) {
    var q = normQueue(Q), n = q.ctx.length;
    rnd = rnd || Math.random;
    q.shf = on ? 1 : 0;
    if (!n) return q;
    var curIdx = q.at >= 0 && q.at < n ? q.ord[q.at] : -1;
    if (on) {
      var rest = shuffled(n, curIdx, rnd);
      q.ord = rest; q.at = curIdx >= 0 ? 0 : -1;
    } else { q.ord = seq(n); q.at = curIdx; }
    return q;
  }
  function qRepeat(Q, rep) { var q = normQueue(Q); q.rep = REPEAT.indexOf(rep) >= 0 ? rep : "off"; return q; }
  function qCycleRepeat(Q) { var q = normQueue(Q); return qRepeat(q, REPEAT[(REPEAT.indexOf(q.rep) + 1) % 3]); }
  function qAddNext(Q, items) { var q = normQueue(Q); q.up = (items || []).concat(q.up).slice(0, LIM.up); return q; }
  function qAddLast(Q, items) { var q = normQueue(Q); q.up = q.up.concat(items || []).slice(0, LIM.up); return q; }
  function qRemoveUp(Q, i) { var q = normQueue(Q); if (i >= 0 && i < q.up.length) q.up.splice(i, 1); return q; }
  function qClearUp(Q) { var q = normQueue(Q); q.up = []; return q; }
  // Jump to the n-th upcoming row of qUpcoming (Up next first, then the list).
  function qJump(Q, n) {
    var q = normQueue(Q);
    if (n < q.up.length) { q.cur = q.up[n]; q.up = q.up.slice(n + 1); q.fromUp = 1; return { q: q, item: q.cur }; }
    var k = n - q.up.length;
    q.up = [];
    if (q.at + 1 + k < q.ctx.length) { q.at += 1 + k; q.cur = q.ctx[q.ord[q.at]]; q.fromUp = 0; return { q: q, item: q.cur }; }
    return { q: q, item: null };
  }
  // What plays after the current track: { up: [item], next: [item] }.
  function qUpcoming(Q, max) {
    var q = normQueue(Q), next = [];
    max = max || 100;
    for (var i = q.at + 1; i < q.ord.length && next.length < max; i++) next.push(q.ctx[q.ord[i]]);
    return { up: q.up.slice(0, max), next: next };
  }

  // ---------- 9. Library views ----------
  // tracks: [rec] from the device's index (store "tracks"):
  //   { p, k, t, a, aa, al, n, dn, g, y, d, art, add }
  function collator(lang) {
    try { return new Intl.Collator(lang === "el" ? "el" : "en", { sensitivity: "base", numeric: true }); }
    catch (e) { return { compare: function (x, y) { return cmpStr(fold(x), fold(y)); } }; }
  }
  function byTrackNo(x, y) { return (x.dn || 0) - (y.dn || 0) || (x.n || 0) - (y.n || 0) || cmpStr(fold(x.t), fold(y.t)); }
  function albums(tracks, lang) {
    var col = collator(lang), map = {};
    tracks.forEach(function (r) {
      var k = albumKey(r);
      if (!k) return;
      var a = map[k] || (map[k] = { k: k, n: r.al, a: r.aa || r.a, y: 0, art: "", list: [], add: 0 });
      a.list.push(r);
      if (r.y && (!a.y || r.y < a.y)) a.y = r.y;
      if (!a.art && r.art) a.art = r.art;
      if ((r.add || 0) > a.add) a.add = r.add || 0;
    });
    return Object.keys(map).map(function (k) { map[k].list.sort(byTrackNo); return map[k]; })
      .sort(function (x, y) { return col.compare(x.n, y.n) || col.compare(x.a, y.a); });
  }
  function artists(tracks, lang) {
    var col = collator(lang), map = {};
    tracks.forEach(function (r) {
      var name = r.aa || r.a;
      if (!name) return;
      var k = artistKey(name), a = map[k] || (map[k] = { k: k, n: name, list: [], art: "" });
      a.list.push(r);
      if (!a.art && r.art) a.art = r.art;
    });
    // Songs where the artist only performs (album by someone else) count too.
    tracks.forEach(function (r) {
      if (!r.a || !r.aa || fold(r.a) === fold(r.aa)) return;
      var k = artistKey(r.a);
      var a = map[k] || (map[k] = { k: k, n: r.a, list: [], art: r.art || "" });
      if (a.list.indexOf(r) < 0) a.list.push(r);
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return col.compare(x.n, y.n); });
  }
  function genres(tracks, lang) {
    var col = collator(lang), map = {};
    tracks.forEach(function (r) {
      String(r.g || "").split(/\s*[;\/]\s*/).forEach(function (g) {
        g = clean(g);
        if (!g) return;
        var k = "g:" + hash(fold(g)), x = map[k] || (map[k] = { k: k, n: g, list: [] });
        x.list.push(r);
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return col.compare(x.n, y.n); });
  }
  // Folders under the music root, one level at a time: { dirs, files }.
  function folderView(tracks, root, dir) {
    var base = (dir || root).replace(/\/+$/, "") + "/", dirs = {}, files = [];
    tracks.forEach(function (r) {
      if (r.p.indexOf(base) !== 0) return;
      var rest = r.p.slice(base.length), i = rest.indexOf("/");
      if (i < 0) files.push(r); else { var n = rest.slice(0, i); dirs[n] = (dirs[n] || 0) + 1; }
    });
    return { dirs: Object.keys(dirs).sort(function (x, y) { return cmpStr(fold(x), fold(y)); }).map(function (n) { return { n: n, p: base + n, c: dirs[n] }; }),
      files: files.sort(function (x, y) { return cmpStr(fold(x.p), fold(y.p)); }) };
  }
  function sortTracks(tracks, how, lang) {
    var col = collator(lang), list = tracks.slice();
    if (how === "added") list.sort(function (x, y) { return (y.add || 0) - (x.add || 0) || col.compare(x.t, y.t); });
    else if (how === "artist") list.sort(function (x, y) { return col.compare(x.a, y.a) || col.compare(x.al, y.al) || byTrackNo(x, y); });
    else if (how === "album") list.sort(function (x, y) { return col.compare(x.al, y.al) || byTrackNo(x, y); });
    else list.sort(function (x, y) { return col.compare(x.t, y.t) || col.compare(x.a, y.a); });
    return list;
  }
  // Every word must be in the title, artist, album or genre.
  function matches(r, words) {
    var hay = fold([r.t, r.a, r.aa, r.al, r.g].join(" "));
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    return true;
  }
  function words(q) { return fold(q).split(" ").filter(Boolean); }
  function search(tracks, q, lang) {
    var w = words(q);
    if (!w.length) return { songs: [], albums: [], artists: [] };
    var songs = tracks.filter(function (r) { return matches(r, w); });
    var hit = function (s) { var f = fold(s); return w.every(function (x) { return f.indexOf(x) >= 0; }); };
    return {
      songs: sortTracks(songs, "title", lang),
      albums: albums(tracks, lang).filter(function (a) { return hit(a.n + " " + a.a); }),
      artists: artists(tracks, lang).filter(function (a) { return hit(a.n); })
    };
  }
  // Which device track plays a ref: same key, else same title + artist.
  function resolver(tracks) {
    var byK = {}, byTA = {};
    tracks.forEach(function (r) {
      if (!byK[r.k]) byK[r.k] = r;
      var ta = fold(r.t) + "|" + fold(r.a);
      if (!byTA[ta]) byTA[ta] = r;
    });
    return function (ref) { return (ref && (byK[ref.k] || byTA[fold(ref.t) + "|" + fold(ref.a)])) || null; };
  }
  function refOf(r) {
    var o = { k: r.k, t: r.t || "?", a: r.a || "" };
    if (r.al) o.al = r.al; if (r.d) o.d = r.d;
    return r.s && typeof r.k === "string" ? remote(r, o) : o;
  }
  // A server song's cover address carries its login: it is made on
  // screen (servers.js coverUrl), never kept in the queue.
  function itemOf(r) { var o = refOf(r); if (r.p) o.p = r.p; if (r.u && r.s !== "sv") o.u = r.u; if (r.art && r.s !== "sv") o.art = r.art; return o; }
  function isRemote(r) { return !!(r && r.s && SRC_RE.test(r.s) && httpsUrl(r.u)); }
  function isServer(r) { return !!(r && r.s === "sv" && SH_RE.test(r.sh) && svId(r.ii, 1000)); }
  // Listening history on this device: { c: {k: plays}, r: [item] recent, l: {k: last ms} }
  function addPlay(h, item, now) {
    h = h && typeof h === "object" ? h : {};
    var c = h.c && typeof h.c === "object" ? h.c : {}, l = h.l && typeof h.l === "object" ? h.l : {};
    var r = Array.isArray(h.r) ? h.r.filter(function (x) { return x && x.k !== item.k; }) : [];
    c[item.k] = (c[item.k] || 0) + 1;
    l[item.k] = now;
    r.unshift(refOf(item));
    r = r.slice(0, 50);
    var keys = Object.keys(c);
    if (keys.length > LIM.hist) {
      keys.sort(function (x, y) { return (l[y] || 0) - (l[x] || 0); }).slice(LIM.hist).forEach(function (k) { delete c[k]; delete l[k]; });
    }
    return { c: c, r: r, l: l };
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(+s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }

  var api = {
    VERSION: "1.3.0", DATA_VER: DATA_VER, LIM: LIM, GENRES: GENRES, REPEAT: REPEAT, AUDIO_EXT: AUDIO_EXT,
    clean: clean, fold: fold, hash: hash, newId: newId, decodeLegacy: decodeLegacy, looksGreek: looksGreek, utf16: utf16,
    sniffImage: sniffImage, genreName: genreName, fromName: fromName, stem: stem,
    id3Size: id3Size, parseId3v2: parseId3v2, parseId3v1: parseId3v1, mp3Duration: mp3Duration,
    parseFlac: parseFlac, parseOgg: parseOgg, parseMp4: parseMp4, mp4Box: mp4Box, parseWav: parseWav,
    readTags: readTags, trackKey: trackKey, albumKey: albumKey, artistKey: artistKey, isAudioName: isAudioName,
    emptyData: emptyData, mergeMusic: mergeMusic, canon: canon, normRef: normRef,
    isLiked: isLiked, likedList: likedList, setLike: setLike, findPl: findPl, addPl: addPl, renamePl: renamePl,
    addToPl: addToPl, removeFromPl: removeFromPl, movePl: movePl, deletePl: deletePl,
    emptyQueue: emptyQueue, normQueue: normQueue, qStart: qStart, qNext: qNext, qPrev: qPrev, qShuffle: qShuffle,
    qRepeat: qRepeat, qCycleRepeat: qCycleRepeat, qAddNext: qAddNext, qAddLast: qAddLast, qRemoveUp: qRemoveUp,
    qClearUp: qClearUp, qJump: qJump, qUpcoming: qUpcoming,
    albums: albums, artists: artists, genres: genres, folderView: folderView, sortTracks: sortTracks, search: search,
    words: words, matches: matches, resolver: resolver, refOf: refOf, itemOf: itemOf, isRemote: isRemote, isServer: isServer, addPlay: addPlay, fmtTime: fmtTime,
    byTrackNo: byTrackNo, collator: collator
  };
  root.OrosMusicCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = { OrosMusicCore: api };
})(typeof window !== "undefined" ? window : globalThis);
