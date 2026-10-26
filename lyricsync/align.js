// ============================================================
// orOS Lyric Sync — align.js (wave 4): rough times from speech
// ------------------------------------------------------------
// Montage's on-device Whisper (montage/asr.js) hears the song and
// returns cues [{ start, end, text }] in seconds. This file lines the
// person's own lyrics up with what it heard, so every line gets a
// rough start to fix by ear (the words of the lyrics are never
// replaced by what Whisper wrote):
//   1. the heard words get times inside their cue, by letter count;
//   2. the lyric words and the heard words are aligned like two
//      strings (Needleman-Wunsch; similar words match, so "gonna" ~
//      "going", Greek accents and final sigma do not count);
//   3. a line starts at its first matched word, moved back by the
//      words before it; lines with no match sit between their
//      neighbours by word count; starts never go back in time.
// Pure, no DOM: node tests and the app window.
// ============================================================
(function (root) {
  "use strict";

  var MAX_WORDS = 3000, WORD_MS = 280;

  function fold(w) {
    return String(w || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\u03c2/g, "\u03c3").replace(/[^\p{L}\p{N}]+/gu, "");
  }
  // "[Chorus]", "(x2)": not sung, never timed
  function isLabel(text) { return /^\s*[\[(][^\])]*[\])]\s*$/.test(String(text || "")); }
  function wordsOf(text) {
    if (isLabel(text)) return [];
    return String(text || "").split(/\s+/).map(fold).filter(Boolean);
  }
  // Levenshtein ratio, 0..1 (short words only need to be close).
  function similar(a, b) {
    if (a === b) return 1;
    var n = a.length, m = b.length;
    if (!n || !m) return 0;
    if (Math.abs(n - m) > Math.max(n, m) / 2) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur = [i];
      for (j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[m] / Math.max(n, m);
  }

  // cues → [{ w, ms }] (heard words with a time each)
  function heard(cues) {
    var out = [];
    (cues || []).forEach(function (c) {
      var s = Math.max(0, +c.start || 0) * 1000, e = Math.max(s, (+c.end || 0) * 1000);
      var ws = String(c.text || "").split(/\s+/).filter(function (x) { return fold(x); });
      var total = ws.reduce(function (n, x) { return n + fold(x).length; }, 0) || 1, done = 0;
      ws.forEach(function (x) {
        out.push({ w: fold(x), ms: Math.round(s + (e - s) * done / total) });
        done += fold(x).length;
      });
    });
    return out.slice(0, MAX_WORDS);
  }

  // Global alignment. → map: lyric word index → heard word index.
  function alignWords(a, b) {
    var n = a.length, m = b.length, GAP = -0.4, i, j;
    var score = new Float32Array((n + 1) * (m + 1)), back = new Uint8Array((n + 1) * (m + 1));
    var W = m + 1;
    for (i = 1; i <= n; i++) { score[i * W] = i * GAP; back[i * W] = 1; }
    for (j = 1; j <= m; j++) { score[j] = j * GAP * 0.5; back[j] = 2; }   // heard extras are cheap (ad libs, noise)
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var sim = similar(a[i - 1], b[j - 1]);
        var d = score[(i - 1) * W + j - 1] + (sim >= 0.6 ? sim : -0.6);
        var u = score[(i - 1) * W + j] + GAP;
        var l = score[i * W + j - 1] + GAP * 0.5;
        if (d >= u && d >= l) { score[i * W + j] = d; back[i * W + j] = sim >= 0.6 ? 0 : 3; }
        else if (u >= l) { score[i * W + j] = u; back[i * W + j] = 1; }
        else { score[i * W + j] = l; back[i * W + j] = 2; }
      }
    }
    var map = {};
    i = n; j = m;
    while (i > 0 || j > 0) {
      var k = back[i * W + j];
      if (i > 0 && j > 0 && (k === 0 || k === 3)) { if (k === 0) map[i - 1] = j - 1; i--; j--; }
      else if (i > 0 && (k === 1 || j === 0)) i--;
      else j--;
    }
    return map;
  }

  // lines: [{ t }] (the song's lines), cues from MontageASR.run.
  // → { starts: [ms|null per line], matched, words }
  function align(lines, cues) {
    var lw = [], owner = [], first = [];
    (lines || []).forEach(function (l, li) {
      first[li] = lw.length;
      wordsOf(l && l.t).forEach(function (w) { if (lw.length < MAX_WORDS) { lw.push(w); owner.push(li); } });
    });
    var hw = heard(cues);
    var starts = (lines || []).map(function () { return null; });
    if (!lw.length || !hw.length) return { starts: starts, matched: 0, words: lw.length };
    var map = alignWords(lw, hw.map(function (x) { return x.w; })), matched = 0;
    Object.keys(map).forEach(function () { matched++; });
    // 3. a line's start from its first matched word
    (lines || []).forEach(function (l, li) {
      for (var k = first[li]; k < lw.length && owner[k] === li; k++) {
        if (map[k] !== undefined) { starts[li] = Math.max(0, hw[map[k]].ms - (k - first[li]) * WORD_MS); return; }
      }
    });
    // never back in time: a start earlier than the one before is dropped
    var last = -1;
    starts.forEach(function (s, i) { if (s === null) return; if (s < last) starts[i] = null; else last = s; });
    // lines without a match between two that have one: by word count
    var known = [];
    starts.forEach(function (s, i) { if (s !== null) known.push(i); });
    for (var q = 0; q + 1 < known.length; q++) {
      var a = known[q], b = known[q + 1];
      if (b - a < 2) continue;
      var wa = first[a], wb = first[b], span = Math.max(1, wb - wa);
      for (var i = a + 1; i < b; i++) {
        if (first[i] === undefined || !wordsOf(lines[i].t).length) continue;
        starts[i] = Math.round(starts[a] + (starts[b] - starts[a]) * (first[i] - wa) / span);
      }
    }
    return { starts: starts, matched: matched, words: lw.length };
  }

  // Mono 16 kHz samples from decoded audio (an AudioBuffer-like
  // { sampleRate, numberOfChannels, getChannelData }), by averaging
  // the channels and a linear resample. Songs over maxSec are cut.
  function to16k(buf, maxSec) {
    var sr = buf.sampleRate, ch = buf.numberOfChannels, len = buf.length;
    if (maxSec) len = Math.min(len, Math.floor(maxSec * sr));
    var mono = new Float32Array(len), c, i;
    for (c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (i = 0; i < len; i++) mono[i] += d[i] / ch; }
    if (sr === 16000) return mono;
    var n = Math.floor(len * 16000 / sr), out = new Float32Array(n), r = sr / 16000;
    for (i = 0; i < n; i++) {
      var x = i * r, k = Math.floor(x), f = x - k;
      out[i] = (mono[k] || 0) * (1 - f) + (mono[k + 1] || 0) * f;
    }
    return out;
  }

  var API = { align: align, heard: heard, alignWords: alignWords, similar: similar, fold: fold, to16k: to16k };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncAlign = API;
})(typeof window !== "undefined" ? window : globalThis);
