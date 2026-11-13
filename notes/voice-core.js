// ============================================================
// orOS Notes — voice notes, pure core (notes/voice-core.js,
// window.OrosNotesVoice). No DOM, no disk: notes/voice.js and
// `node --test` (tests/notes-voice.test.js) run the same code.
//
// A recording is an ordinary file of the orOS disk, so Vault Drive
// syncs it per file (FILES-V) and it never enters the notes slice:
//   /internal/Notes/Voice/<yyyy-mm-dd>-<hhmmss>-<4 letters>.<ext>
// A page refers to it with one line of its own text:
//   🎙 voice:2026-11-12-181005-a7k2.webm (0:42)
// The line is matched strictly (voiceLine): only a name of exactly
// that pattern, never a path, a "..", a URL or anything else, so a
// page can only ever point inside the Voice folder. Every other
// spelling stays plain text. The page schema does not change.
// ============================================================
(function (root) {
  "use strict";

  var DIR = "/internal/Notes/Voice";
  var EXTS = ["webm", "ogg", "m4a", "wav"];
  var MIME = { webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav" };
  var NAME_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-([0-9a-z]{4})\.(webm|ogg|m4a|wav)$/;
  // 🎙 (U+1F399), an optional VS16, "voice:", the name, an optional "(m:ss)"
  var LINE_RE = /^🎙️?[ \t]+voice:([0-9a-z.-]{1,40})(?:[ \t]+\((\d{1,2}:\d{2}(?::\d{2})?)\))?[ \t]*$/;
  var MARK = "🎙";

  var MAX_MS = 2 * 3600 * 1000;      // one recording: at most 2 hours
  var CHUNK_MS = 5000;               // a piece every 5 s goes to IndexedDB
  var BITS = 32000;                  // 32 kbit/s mono: about 14 MB an hour
  var BIG_MS = 30 * 60 * 1000;       // past 30 minutes the bar shows the size
  var UNUSED_AGE = 24 * 3600 * 1000; // younger files are never "unused"

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function isName(s) {
    var m = NAME_RE.exec(String(s || ""));
    if (!m) return false;
    var mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && se <= 59;
  }
  function extOf(name) { var m = NAME_RE.exec(String(name || "")); return m ? m[8] : ""; }
  function mimeOf(name) { return MIME[extOf(name)] || ""; }
  function pathOf(name) { return isName(name) ? DIR + "/" + name : null; }

  // The time a name was made (local clock of the device that recorded it).
  function timeOf(name) {
    var m = NAME_RE.exec(String(name || ""));
    if (!m || !isName(name)) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  function rnd4(r) {
    var s = String(r || "").toLowerCase().replace(/[^0-9a-z]/g, "");
    while (s.length < 4) s += "0";
    return s.slice(0, 4);
  }
  // fileName(Date, "a7k2", "webm") → "2026-11-12-181005-a7k2.webm"
  function fileName(d, r, ext) {
    if (EXTS.indexOf(ext) === -1) ext = "webm";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "-" +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + "-" + rnd4(r) + "." + ext;
  }
  // A name that is not in `taken` (a list of names): the random part
  // changes until it is free. Nothing is ever written over a file.
  function freeName(d, rand, ext, taken) {
    var seen = {};
    (taken || []).forEach(function (n) { seen[n] = true; });
    for (var i = 0; i < 50; i++) {
      var n = fileName(d, rand(), ext);
      if (!seen[n]) return n;
    }
    return null;
  }

  function fmtDur(ms) {
    var s = Math.max(0, Math.round((+ms || 0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + ":" + pad(m) + ":" + pad(x) : m + ":" + pad(x);
  }
  function parseDur(s) {
    var p = String(s || "").split(":").map(Number);
    if (p.length === 2) return (p[0] * 60 + p[1]) * 1000;
    if (p.length === 3) return (p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
    return 0;
  }

  function lineFor(name, ms) {
    return MARK + " voice:" + name + (ms > 0 ? " (" + fmtDur(ms) + ")" : "");
  }
  // One line of text → { name, ms } or null.
  function voiceLine(s) {
    var m = LINE_RE.exec(String(s == null ? "" : s));
    if (!m || !isName(m[1])) return null;
    return { name: m[1], ms: m[2] ? parseDur(m[2]) : 0 };
  }

  // Lines inside fenced code blocks are text, never recordings (the
  // preview shows them as code, so the strip must not list them).
  function scan(text, fn) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), fence = null;
    for (var i = 0; i < lines.length; i++) {
      var f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (f) {
        if (!fence) fence = f[1];
        else if (f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length && /^ {0,3}[`~]+[ \t]*$/.test(lines[i])) fence = null;
        continue;
      }
      if (fence) continue;
      var v = voiceLine(lines[i]);
      if (v) fn(v, i);
    }
  }
  // The page's recordings in text order, each name once.
  function listIn(text) {
    var out = [], seen = {};
    scan(text, function (v, i) {
      if (seen[v.name]) return;
      seen[v.name] = true;
      out.push({ name: v.name, ms: v.ms, line: i });
    });
    return out;
  }

  // Puts `line` on a line of its own at character `pos` (a caret):
  // inside a line it goes after that line. → { text, caret }
  function insertLine(text, pos, line) {
    text = String(text || "");
    if (!(pos >= 0) || pos > text.length) pos = text.length;
    var start = text.lastIndexOf("\n", pos - 1) + 1;
    var end = text.indexOf("\n", pos);
    if (end === -1) end = text.length;
    if (start === end) {                       // an empty line: use it
      return { text: text.slice(0, start) + line + text.slice(end), caret: start + line.length };
    }
    var before = text.slice(0, end) + "\n" + line;
    return { text: before + text.slice(end), caret: before.length };
  }

  // The text without the lines that point at `name` (outside code).
  function removeFrom(text, name) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), drop = {};
    scan(text, function (v, i) { if (v.name === name) drop[i] = true; });
    return lines.filter(function (s, i) { return !drop[i]; }).join("\n");
  }
  // The text with the line(s) of `from` pointing at `to` (trim, V2).
  function replaceIn(text, from, to, ms) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), hit = {};
    scan(text, function (v, i) { if (v.name === from) hit[i] = true; });
    return lines.map(function (s, i) { return hit[i] ? lineFor(to, ms) : s; }).join("\n");
  }

  // Files of the Voice folder no page names any more. `texts` = every
  // page text this device holds (all notebooks, conflict copies too);
  // `files` = [{ name, size }]. A file younger than a day (by its name)
  // is never listed: its page may simply not have arrived yet.
  function unused(texts, files, now) {
    var named = {};
    (texts || []).forEach(function (tx) { listIn(tx).forEach(function (v) { named[v.name] = true; }); });
    return (files || []).filter(function (f) {
      if (!f || !isName(f.name) || named[f.name]) return false;
      var at = timeOf(f.name);
      return at > 0 && now - at >= UNUSED_AGE;
    }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  }

  // The recorder's format: the first one this browser can write.
  // isSupported = MediaRecorder.isTypeSupported (bound), or null.
  function pickMime(isSupported) {
    var c = [["audio/webm;codecs=opus", "webm"], ["audio/ogg;codecs=opus", "ogg"], ["audio/mp4;codecs=mp4a.40.2", "m4a"], ["audio/mp4", "m4a"], ["audio/webm", "webm"]];
    if (typeof isSupported !== "function") return null;
    for (var i = 0; i < c.length; i++) {
      try { if (isSupported(c[i][0])) return { mime: c[i][0], ext: c[i][1] }; } catch (e) {}
    }
    return null;
  }
  // The extension for what a recorder really wrote (its .mimeType).
  function extForMime(m) {
    m = String(m || "").toLowerCase();
    if (m.indexOf("ogg") !== -1) return "ogg";
    if (m.indexOf("mp4") !== -1 || m.indexOf("aac") !== -1) return "m4a";
    if (m.indexOf("wav") !== -1) return "wav";
    return "webm";
  }
  function sizeAt(ms) { return Math.round(BITS / 8 * (ms / 1000)); }

  var api = {
    DIR: DIR, EXTS: EXTS, MARK: MARK, MAX_MS: MAX_MS, CHUNK_MS: CHUNK_MS, BITS: BITS, BIG_MS: BIG_MS, UNUSED_AGE: UNUSED_AGE,
    isName: isName, extOf: extOf, mimeOf: mimeOf, pathOf: pathOf, timeOf: timeOf,
    fileName: fileName, freeName: freeName, fmtDur: fmtDur, parseDur: parseDur,
    lineFor: lineFor, voiceLine: voiceLine, listIn: listIn, insertLine: insertLine,
    removeFrom: removeFrom, replaceIn: replaceIn, unused: unused,
    pickMime: pickMime, extForMime: extForMime, sizeAt: sizeAt
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesVoice = api;
})(this);
