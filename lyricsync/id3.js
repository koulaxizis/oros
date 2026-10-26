// ============================================================
// orOS Lyric Sync — id3.js (wave 3): the lyrics inside an MP3
// ------------------------------------------------------------
// Builds a new ID3v2 tag for an MP3 with the song's lyrics in it:
//   USLT  the words as plain text (what most players show),
//   SYLT  one entry per timed line, in milliseconds (synced lyrics:
//         Music, foobar2000, MusicBee, many car and phone players).
// Every other frame of the song's tag (title, artist, cover…) is
// copied byte for byte; old USLT / SYLT frames are replaced. The
// audio after the tag is never read or changed: the new file is
// Blob([new tag, original audio]), so a 300 MB file costs no memory.
// Tags this file cannot rewrite safely (ID3v2.2, unsynchronised or
// with an extended header or footer) → null, and nothing is made.
// Pure: no DOM. Works in the app window and in node tests.
// ============================================================
(function (root) {
  "use strict";

  var PAD = 1024;
  var LANGS = { en: "eng", el: "ell", de: "deu", fr: "fra", es: "spa", it: "ita", pt: "por", nl: "nld", sv: "swe", pl: "pol", tr: "tur", ru: "rus", ja: "jpn", ko: "kor", zh: "zho" };

  function lang3(lg) {
    var s = String(lg || "").toLowerCase().split(/[-_]/)[0];
    if (/^[a-z]{3}$/.test(s)) return s;
    return LANGS[s] || "und";
  }
  function syncsafe(n) { return [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]; }
  function unsyncsafe(b, o) { return ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127); }
  function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

  // Text in the frame's encoding: v2.3 UTF-16 with a BOM (1), v2.4
  // UTF-8 (3). term adds the terminator.
  function enc(s, v4, term) {
    var out = [];
    s = String(s || "");
    if (v4) {
      var u = new TextEncoder().encode(s);
      for (var i = 0; i < u.length; i++) out.push(u[i]);
      if (term) out.push(0);
    } else {
      out.push(0xff, 0xfe);
      for (var j = 0; j < s.length; j++) { var c = s.charCodeAt(j); out.push(c & 255, c >>> 8); }
      if (term) out.push(0, 0);
    }
    return out;
  }
  function frame(id, body, v4) {
    var head = [id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3)]
      .concat(v4 ? syncsafe(body.length) : be32(body.length), [0, 0]);
    return head.concat(body);
  }
  // lines: [{ s: ms, t: text }] (timed only, in order).
  function uslt(text, lg, v4) {
    return frame("USLT", [v4 ? 3 : 1].concat(lang3(lg).split("").map(function (c) { return c.charCodeAt(0); }), enc("", v4, true), enc(text, v4, false)), v4);
  }
  function sylt(lines, lg, v4) {
    var body = [v4 ? 3 : 1].concat(lang3(lg).split("").map(function (c) { return c.charCodeAt(0); }), [2, 1], enc("", v4, true));
    lines.forEach(function (l) { body = body.concat(enc(l.t, v4, true), be32(Math.max(0, Math.round(l.s)) >>> 0)); });
    return frame("SYLT", body, v4);
  }

  // head: the file's first bytes (at least 10, the whole old tag when
  // there is one). → { major, end } | { none: true, end: 0 } | null
  // (a tag this file does not rewrite).
  function readHeader(head) {
    if (!head || head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return { none: true, end: 0 };
    var major = head[3], flags = head[5];
    if (major !== 3 && major !== 4) return null;
    if (flags & 0xd0) return null;          // unsynchronised, extended header, footer
    return { major: major, end: 10 + unsyncsafe(head, 6) };
  }
  // The frames of the old tag except USLT and SYLT, as raw bytes.
  function keepFrames(tag, major) {
    var out = [], o = 10, end = tag.length;
    while (o + 10 <= end) {
      if (tag[o] === 0) break;                                   // padding
      var id = String.fromCharCode(tag[o], tag[o + 1], tag[o + 2], tag[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) return null;
      var size = major === 4 ? unsyncsafe(tag, o + 4) : ((tag[o + 4] << 24) | (tag[o + 5] << 16) | (tag[o + 6] << 8) | tag[o + 7]) >>> 0;
      if (o + 10 + size > end) return null;
      if (id !== "USLT" && id !== "SYLT") for (var i = o; i < o + 10 + size; i++) out.push(tag[i]);
      o += 10 + size;
    }
    return out;
  }

  // lyrics: { text, lines: [{ s, t }], lg }. head: the old tag's
  // bytes (from readHeader's end) or the first bytes of a tagless
  // file. → { tag: Uint8Array, cut: bytes of the old file to skip }
  // | null.
  function build(head, lyrics) {
    var h = readHeader(head);
    if (!h) return null;
    var v4 = h.major === 4, kept = [];
    if (!h.none) {
      if (head.length < h.end) return null;
      kept = keepFrames(head.subarray ? head.subarray(0, h.end) : head.slice(0, h.end), h.major);
      if (!kept) return null;
    }
    var lines = (lyrics.lines || []).filter(function (l) { return typeof l.s === "number" && l.s >= 0; });
    var body = kept.concat(uslt(lyrics.text || "", lyrics.lg, v4));
    if (lines.length) body = body.concat(sylt(lines, lyrics.lg, v4));
    var size = body.length + PAD;
    var tag = new Uint8Array(10 + size);
    tag.set([0x49, 0x44, 0x33, v4 ? 4 : 3, 0, 0].concat(syncsafe(size)), 0);
    tag.set(body, 10);
    return { tag: tag, cut: h.none ? 0 : h.end };
  }
  // Looks like an MP3: an ID3 tag, or an MPEG audio frame sync.
  function isMp3(head, name, type) {
    if (head && head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return /\.mp3$/i.test(name || "") || /mpeg|mp3/i.test(type || "");
    return !!(head && head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0);
  }
  // The tag's total size from its first 10 bytes (0 when none).
  function tagEnd(head10) { var h = readHeader(head10); return h && !h.none ? h.end : 0; }

  var API = { build: build, isMp3: isMp3, tagEnd: tagEnd, lang3: lang3, readHeader: readHeader };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncId3 = API;
})(typeof window !== "undefined" ? window : globalThis);
