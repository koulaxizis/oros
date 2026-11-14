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

  // ---------- V2: trim and transcription ----------
  var MIN_TRIM_MS = 500;
  // A trim range kept inside the sound and at least half a second long.
  function clampTrim(a, b, dur) {
    dur = Math.max(0, +dur || 0);
    a = Math.max(0, Math.min(+a || 0, dur));
    b = Math.max(0, Math.min(b == null ? dur : +b, dur));
    if (b < a) { var x = a; a = b; b = x; }
    if (b - a < MIN_TRIM_MS) {
      b = Math.min(dur, a + MIN_TRIM_MS);
      a = Math.max(0, b - MIN_TRIM_MS);
    }
    return { a: Math.round(a), b: Math.round(b) };
  }
  // Mono samples → a 16-bit PCM WAV file (where no Opus encoder exists).
  function wav16(samples, rate) {
    var n = samples.length, buf = new Uint8Array(44 + n * 2), dv = new DataView(buf.buffer);
    function str(o, s) { for (var i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); }
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var v = Math.max(-1, Math.min(1, samples[i] || 0));
      dv.setInt16(44 + i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
    }
    return buf;
  }
  // Peaks for a waveform: `cols` values 0..1 (the largest |sample| per column).
  function peaks(samples, cols) {
    var n = samples.length, out = new Array(Math.max(1, cols | 0)), step = n / out.length;
    for (var c = 0; c < out.length; c++) {
      var a = Math.floor(c * step), b = Math.max(a + 1, Math.floor((c + 1) * step)), m = 0;
      for (var i = a; i < b && i < n; i++) { var v = Math.abs(samples[i]); if (v > m) m = v; }
      out[c] = Math.min(1, m);
    }
    return out;
  }
  // Whisper cues → page text: one paragraph per stretch of speech; a
  // pause of PARA_GAP s or more starts a new one. Lines that would read
  // as Markdown blocks or as a voice line are kept as text (escaped).
  var PARA_GAP = 2;
  function safeLine(s) {
    s = String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (/^(#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|```|~~~|\||[-*_=]{3,})/.test(s) || s.indexOf(MARK) === 0) s = "\\" + s;
    return s;
  }
  function transcriptText(cues) {
    var paras = [], cur = [], last = null;
    (cues || []).forEach(function (c) {
      var tx = String(c && c.text || "").replace(/\s+/g, " ").trim();
      if (!tx) return;
      if (last !== null && +c.start - last >= PARA_GAP && cur.length) { paras.push(cur.join(" ")); cur = []; }
      cur.push(tx);
      last = +c.end || +c.start || 0;
    });
    if (cur.length) paras.push(cur.join(" "));
    return paras.map(safeLine).filter(Boolean).join("\n\n");
  }
  // The text with `block` put right after the (first) line of `name`,
  // a blank line before and after. Null when the page has no such line.
  function insertAfter(text, name, block) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), at = -1;
    scan(text, function (v, i) { if (at === -1 && v.name === name) at = i; });
    if (at === -1) return null;
    var before = lines.slice(0, at + 1), after = lines.slice(at + 1);
    while (after.length && after[0] === "") after.shift();
    var out = before.concat([""], String(block).split("\n"));
    if (after.length) out = out.concat([""], after);
    return out.join("\n");
  }
  // A Whisper language from the orOS language ("el-GR" → "el"), or auto.
  function asrLang(code) {
    var c = String(code || "").toLowerCase().slice(0, 2);
    return /^[a-z]{2}$/.test(c) ? c : "auto";
  }

  var api = {
    DIR: DIR, EXTS: EXTS, MARK: MARK, MAX_MS: MAX_MS, CHUNK_MS: CHUNK_MS, BITS: BITS, BIG_MS: BIG_MS, UNUSED_AGE: UNUSED_AGE,
    isName: isName, extOf: extOf, mimeOf: mimeOf, pathOf: pathOf, timeOf: timeOf,
    fileName: fileName, freeName: freeName, fmtDur: fmtDur, parseDur: parseDur,
    lineFor: lineFor, voiceLine: voiceLine, listIn: listIn, insertLine: insertLine,
    removeFrom: removeFrom, replaceIn: replaceIn, unused: unused,
    pickMime: pickMime, extForMime: extForMime, sizeAt: sizeAt,
    MIN_TRIM_MS: MIN_TRIM_MS, PARA_GAP: PARA_GAP, clampTrim: clampTrim, wav16: wav16, peaks: peaks,
    transcriptText: transcriptText, insertAfter: insertAfter, asrLang: asrLang
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesVoice = api;
})(this);
