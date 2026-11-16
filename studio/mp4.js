// ============================================================
// orOS Studio — MP4 audiobook writer (v1.0.0, Studio wave A4)
// Pure code, no DOM. Puts AAC access units (studio/aac.js) into an
// MPEG-4 file (ISO/IEC 14496-12/14) that Apple Books, VLC, Android
// players and ffmpeg read as an audiobook:
//   - ftyp "M4B ", then moov before mdat (it plays while it loads);
//   - one audio track (mp4a + esds with the AudioSpecificConfig), an
//     edit list that skips the encoder's priming samples, so the file
//     lasts exactly as long as the book;
//   - chapters twice, as players read one or the other: a QuickTime
//     chapter text track (tref "chap") and Nero "chpl" in udta;
//   - iTunes metadata (title, author, album, narrator as composer,
//     year, genre, description, "audiobook" media kind, cover).
// Use: var out = StudioMp4.audiobook({ asc, rate, ch, delay, samples,
//      units: [Uint8Array…], chapters: [{ at: s, title }], tags: { title,
//      artist, album, composer, year, genre, desc, copyright },
//      cover: { bytes, png } });
//      new Blob(out.parts, { type: "audio/mp4" }) (out.size bytes).
// The access units are not copied: the Blob takes them as they are.
// Loaded by studio.js (window.StudioMp4) and by the tests.
// ============================================================
(function (root) {
  "use strict";

  var MOVIE_SCALE = 1000;          // movie time in milliseconds
  var CHUNK = 43;                  // audio access units per chunk (about one second at 44.1 kHz)
  var MAX_CHAPTERS = 255;          // chpl counts them in one byte

  function utf8(s) {
    s = String(s == null ? "" : s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  // a text value as tags carry it: no control characters, at most `max` characters
  function clean(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  // UTF-8 bytes cut at a character boundary to at most n bytes
  function cutUtf8(b, n) { if (b.length <= n) return b; var k = n; while (k > 0 && (b[k] & 0xc0) === 0x80) k--; return b.slice(0, k); }

  // ---------- bytes ----------
  function u8(v) { return [v & 255]; }
  function u16(v) { return [(v >>> 8) & 255, v & 255]; }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function u64(v) { var hi = Math.floor(v / 4294967296); return u32(hi).concat(u32(v - hi * 4294967296)); }
  function cc(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }
  function cat() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a == null) continue;
      for (var j = 0; j < a.length; j++) out.push(a[j]);
    }
    return out;
  }
  function box(type) {
    var body = cat.apply(null, Array.prototype.slice.call(arguments, 1));
    return cat(u32(body.length + 8), typeof type === "string" ? cc(type) : type, body);
  }
  function full(type, ver, flags) {
    var rest = Array.prototype.slice.call(arguments, 3);
    return box.apply(null, [type, [ver & 255].concat(u32(flags).slice(1))].concat(rest));
  }
  var MATRIX = cat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  // the QuickTime text sample entry of a chapter track (display flags, justification, colours,
  // text box, one style record, a font table of one unnamed font): 43 bytes
  var STUB_TEXT = cat(u32(1), u16(0), u32(0), u32(0), u32(0), u32(0), u16(1), u16(0), u32(0),
                      u32(13), cc("ftab"), u16(1), u16(1), [0]);
  function descr(tag, body) {
    var n = body.length;
    return cat([tag, 0x80 | ((n >> 21) & 127), 0x80 | ((n >> 14) & 127), 0x80 | ((n >> 7) & 127), n & 127], body);
  }

  // ---------- boxes ----------
  function tkhd(id, flags, dur, audio) {
    return full("tkhd", 0, flags, u32(0), u32(0), u32(id), u32(0), u32(dur), u32(0), u32(0),
      u16(0), u16(audio ? 1 : 0), u16(audio ? 0x100 : 0), u16(0), MATRIX, u32(0), u32(0));
  }
  function mdhd(scale, dur) { return full("mdhd", 0, 0, u32(0), u32(0), u32(scale), u32(dur), u16(0x55c4), u16(0)); }   // language "und"
  function hdlr(type, name) { return full("hdlr", 0, 0, u32(0), cc(type), u32(0), u32(0), u32(0), utf8(name), [0]); }
  function dinf() { return box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))); }
  function stts(list) {            // [[count, delta]]
    var b = [u32(list.length)];
    list.forEach(function (e) { b.push(u32(e[0]), u32(e[1])); });
    return full.apply(null, ["stts", 0, 0].concat(b));
  }
  function stsz(sizes) {
    var b = [u32(0), u32(sizes.length)];
    var flat = new Array(sizes.length * 4);
    for (var i = 0; i < sizes.length; i++) { var v = sizes[i]; flat[4 * i] = (v >>> 24) & 255; flat[4 * i + 1] = (v >>> 16) & 255; flat[4 * i + 2] = (v >>> 8) & 255; flat[4 * i + 3] = v & 255; }
    b.push(flat);
    return full.apply(null, ["stsz", 0, 0].concat(b));
  }
  function stsc(n, per) {          // n samples in chunks of `per`
    var whole = Math.floor(n / per), rest = n - whole * per, e = [];
    if (whole) e.push([1, per]);
    if (rest) e.push([whole + 1, rest]);
    var b = [u32(e.length)];
    e.forEach(function (x) { b.push(u32(x[0]), u32(x[1]), u32(1)); });
    return full.apply(null, ["stsc", 0, 0].concat(b));
  }
  function stco(offsets, big) {
    var b = [u32(offsets.length)];
    offsets.forEach(function (o) { b.push(big ? u64(o) : u32(o)); });
    return full.apply(null, [big ? "co64" : "stco", 0, 0].concat(b));
  }
  function esds(o) {
    var bits = o.bytes * 8, secs = o.samples / o.rate, avg = secs > 0 ? Math.round(bits / secs) : 0, maxAu = 0;
    o.units.forEach(function (u) { if (u.length > maxAu) maxAu = u.length; });
    var dsi = descr(0x05, Array.prototype.slice.call(o.asc));
    var dcd = descr(0x04, cat([0x40, 0x15], [(maxAu >> 16) & 255, (maxAu >> 8) & 255, maxAu & 255], u32(Math.round(maxAu * 8 * o.rate / 1024)), u32(avg), dsi));
    return full("esds", 0, 0, descr(0x03, cat(u16(1), [0], dcd, descr(0x06, [2]))));
  }
  function mp4a(o) {
    return box("mp4a", u32(0), u16(0), u16(1), u32(0), u32(0), u16(o.ch), u16(16), u16(0), u16(0), u32(o.rate * 65536 >>> 0), esds(o));
  }
  // an iTunes metadata item
  function item(type, kind, payload) { return box(type, box("data", u32(kind), u32(0), payload)); }
  var CPY = [0xa9];                // "©"
  function ilst(tags, cover) {
    var out = [], add = function (k, v, max) { var s = clean(v, max); if (s) out.push(item(k, 1, utf8(s))); };
    add(CPY.concat(cc(" nam").slice(1)), tags.title, 255);
    add(CPY.concat(cc(" ART").slice(1)), tags.artist, 255);
    add(cc("aART"), tags.artist, 255);
    add(CPY.concat(cc(" alb").slice(1)), tags.album, 255);
    add(CPY.concat(cc(" wrt").slice(1)), tags.composer, 255);
    if (typeof tags.year === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(tags.year)) out.push(item(CPY.concat(cc(" day").slice(1)), 1, utf8(tags.year)));
    add(CPY.concat(cc(" gen").slice(1)), tags.genre, 255);
    add(cc("cprt"), tags.copyright, 255);
    add(cc("desc"), tags.desc, 255);
    add(CPY.concat(cc(" too").slice(1)), tags.tool || "orOS Studio", 255);
    out.push(item("stik", 21, [2]));                                     // media kind: audiobook
    if (cover && cover.bytes && cover.bytes.length) out.push(item("covr", cover.png ? 14 : 13, cover.bytes));
    return box.apply(null, ["ilst"].concat(out));
  }
  function chpl(chs) {
    var b = [u32(0), [chs.length]];
    chs.forEach(function (c) { var t = cutUtf8(utf8(c.title), 255); b.push(u64(Math.round(c.at * 1e7)), [t.length], t); });
    return full.apply(null, ["chpl", 1, 0].concat(b));
  }

  // chapters: sorted, inside the book, the first at 0, titles cleaned
  function chapterList(list, secs) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!c || typeof c.at !== "number" || !isFinite(c.at) || c.at < 0 || c.at >= secs) return;
      out.push({ at: c.at, title: clean(c.title, 200) });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    out = out.filter(function (c, i) { return i === 0 || c.at - out[i - 1].at >= 0.001; }).slice(0, MAX_CHAPTERS);
    if (out.length && out[0].at > 0) out[0].at = 0;
    return out;
  }

  function audiobook(o) {
    if (!o || !o.units || !o.units.length || !o.asc || !(o.rate > 0) || !(o.ch === 1 || o.ch === 2)) throw new Error("audio");
    var units = o.units, n = units.length, rate = o.rate, delay = o.delay || 0;
    var samples = Math.max(0, Math.min(o.samples == null ? n * 1024 - delay : o.samples, n * 1024 - delay));
    var secs = samples / rate, ms = Math.round(secs * MOVIE_SCALE);
    var chs = chapterList(o.chapters, secs);
    var bytes = 0, sizes = new Array(n);
    for (var i = 0; i < n; i++) { sizes[i] = units[i].length; bytes += sizes[i]; }
    // the chapter samples: 2-byte length, UTF-8 title, "encd" (UTF-8)
    var texts = chs.map(function (c) { var t = cutUtf8(utf8(c.title), 1000); return new Uint8Array(cat(u16(t.length), t, u32(12), cc("encd"), u32(0x100))); });
    var textBytes = texts.reduce(function (s, t) { return s + t.length; }, 0);
    var big = bytes + textBytes > 4000000000;
    var info = { asc: o.asc, rate: rate, ch: o.ch, units: units, bytes: bytes, samples: samples };
    var tags = o.tags || {};
    var ftyp = box("ftyp", cc("M4B "), u32(0), cc("M4B "), cc("M4A "), cc("mp42"), cc("isom"));

    var build = function (audioAt) {
      var chunks = [], at = audioAt;
      for (var k = 0; k < n; k += CHUNK) {
        chunks.push(at);
        for (var j = k; j < Math.min(n, k + CHUNK); j++) at += sizes[j];
      }
      var textAt = [];
      texts.forEach(function (t) { textAt.push(at); at += t.length; });
      var audio = box("trak",
        tkhd(1, 3, ms, true),
        box("edts", full("elst", 0, 0, u32(1), u32(ms), u32(delay), u32(0x10000))),
        chs.length ? box("tref", box("chap", u32(2))) : null,
        box("mdia", mdhd(rate, n * 1024), hdlr("soun", "SoundHandler"),
          box("minf", full("smhd", 0, 0, u16(0), u16(0)), dinf(),
            box("stbl", full("stsd", 0, 0, u32(1), mp4a(info)), stts([[n, 1024]]), stsc(n, CHUNK), stsz(sizes), stco(chunks, big)))));
      var text = null;
      if (chs.length) {
        var durs = chs.map(function (c, k2) { return Math.max(1, Math.round(((k2 + 1 < chs.length ? chs[k2 + 1].at : secs) - c.at) * MOVIE_SCALE)); });
        var gmhd = box("gmhd", full("gmin", 0, 0, u16(0x40), u16(0x8000), u16(0x8000), u16(0x8000), u16(0), u16(0)),
          box("text", u16(1), u32(0), u32(0), u32(0), u32(1), u32(0), u32(0), u32(0), u32(0x4000), u16(0)));
        text = box("trak",
          tkhd(2, 2, ms, false),
          box("mdia", mdhd(MOVIE_SCALE, durs.reduce(function (s, d) { return s + d; }, 0)), hdlr("text", "ChapterHandler"),
            box("minf", gmhd, dinf(),
              box("stbl", full("stsd", 0, 0, u32(1), box("text", u32(0), u16(0), u16(1), STUB_TEXT)),
                stts(durs.map(function (d) { return [1, d]; })), stsc(chs.length, 1), stsz(texts.map(function (t) { return t.length; })), stco(textAt, big)))));
      }
      var meta = full("meta", 0, 0, full("hdlr", 0, 0, u32(0), cc("mdir"), cc("appl"), u32(0), u32(0), [0]), ilst(tags, o.cover));
      var udta = box("udta", chs.length ? chpl(chs) : null, meta);
      return box("moov",
        full("mvhd", 0, 0, u32(0), u32(0), u32(MOVIE_SCALE), u32(ms), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), MATRIX,
          u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(chs.length ? 3 : 2)),
        audio, text, udta);
    };
    // the sizes do not depend on the offsets, so one dry run gives where mdat starts
    var mdatHead = big ? 16 : 8;
    var moov = build(0);
    var audioAt = ftyp.length + moov.length + mdatHead;
    moov = build(audioAt);
    var payload = bytes + textBytes;
    var head = new Uint8Array(cat(ftyp, moov, big ? cat(u32(1), cc("mdat"), u64(payload + 16)) : cat(u32(payload + 8), cc("mdat"))));
    var parts = [head].concat(units, texts);
    return { parts: parts, size: head.length + payload, secs: secs, chapters: chs };
  }
  // the parts as one array (tests, small files)
  function join(out) {
    var b = new Uint8Array(out.size), p = 0;
    out.parts.forEach(function (x) { b.set(x, p); p += x.length; });
    return b;
  }

  var api = { VERSION: "1.0.0", audiobook: audiobook, join: join, MAX_CHAPTERS: MAX_CHAPTERS, _test: { chapterList: chapterList, utf8: utf8 } };
  root.StudioMp4 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
