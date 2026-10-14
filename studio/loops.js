// ============================================================
// orOS Studio — loop library (v1.0.0)
// Built-in loops for instrument tracks: drums, bass and keys in eight
// styles, written here as patterns and turned into MIDI notes by this
// code (no audio files, nothing downloaded; our own work, free to use
// like the rest of orOS). A loop is in 4/4 and has a tempo it was
// written for, but it is added at the project's tempo.
// Pure, no DOM (window.StudioLoops; tests/studio-midi.test.js).
//
// Patterns: 16 steps a bar (sixteenth notes); a string of 16 repeats
// every bar, a longer one runs over the bars.
//   drums  { lanes: { gmNote: "x..." } }  X loud, x normal, o soft
//   bass   { key, roots: [semitones per bar], rhythm }
//          r root, o octave, 5 fifth, m minor third, M major third,
//          7 minor seventh, - hold, . rest
//   keys   { key, chords: [[semitones, quality] per bar], rhythm }
//          x chord (X loud), 1–5 one note of the chord (arpeggio),
//          - hold, . rest
// swing (optional): how far (0..0.5 of a step) every second sixteenth
// is played late.
// ============================================================
(function (root) {
  "use strict";

  var GENRES = ["pop", "rock", "hiphop", "house", "funk", "lofi", "latin", "ballad"];
  var KINDS = ["drums", "bass", "keys"];
  var STEP = 0.25;                 // beats in a step
  var KICK = 36, SNARE = 38, RIM = 37, CLAP = 39, HAT = 42, OHAT = 46, CRASH = 49, RIDE = 51, SHAKER = 70, COW = 56, TOM1 = 45, TOM2 = 48;
  var QUAL = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], "7": [0, 4, 7, 10], sus2: [0, 2, 7] };

  function d(id, g, bpm, bars, lanes, swing) { return { id: id, g: g, k: "drums", inst: "drums", bpm: bpm, bars: bars, lanes: lanes, swing: swing || 0 }; }
  function b(id, g, bpm, key, roots, rhythm, swing) { return { id: id, g: g, k: "bass", inst: "bass", bpm: bpm, bars: roots.length, key: key, roots: roots, rhythm: rhythm, swing: swing || 0 }; }
  function k(id, g, inst, bpm, key, chords, rhythm, swing) { return { id: id, g: g, k: "keys", inst: inst, bpm: bpm, bars: chords.length, key: key, chords: chords, rhythm: rhythm, swing: swing || 0 }; }
  function lanes(list) { var o = {}; for (var i = 0; i < list.length; i += 2) o[list[i]] = list[i + 1]; return o; }

  var LOOPS = [
    // ---- Pop ----
    d("pop-d1", "pop", 110, 2, lanes([KICK, "x.......x.x.....", SNARE, "....x.......x...", HAT, "x.x.x.x.x.x.x.x."])),
    d("pop-d2", "pop", 116, 2, lanes([KICK, "x..x..x...x.....", SNARE, "....x.......x..o", HAT, "Xx.xXx.xXx.xXx.x", CLAP, "....x.......x..."])),
    b("pop-b1", "pop", 110, 36, [0, 7, 9, 5], "r.r.r.r.r.r.r.r."),
    b("pop-b2", "pop", 116, 36, [0, 7, 9, 5], "r--.r--.r-o.r-5."),
    k("pop-k1", "pop", "piano", 110, 60, [[0, "maj"], [7, "maj"], [9, "min"], [5, "maj"]], "x---x---x---x-x-"),
    k("pop-k2", "pop", "piano", 116, 60, [[0, "maj"], [7, "maj"], [9, "min"], [5, "maj"]], "1.2.3.4.1.2.3.4."),
    // ---- Rock ----
    d("rock-d1", "rock", 120, 2, lanes([KICK, "x.......x.x.....", SNARE, "....X.......X...", HAT, "x.x.x.x.x.x.x.x.", CRASH, "X..............................."])),
    d("rock-d2", "rock", 140, 2, lanes([KICK, "x.x...x.x.x...x.", SNARE, "....X.......X...", RIDE, "x.x.x.x.x.x.x.x.", TOM1, "............................x...", TOM2, "..............................x."])),
    b("rock-b1", "rock", 120, 40, [0, 5, 7, 5], "r.r.r.r.r.r.r.r."),
    k("rock-k1", "rock", "organ", 120, 64, [[0, "maj"], [5, "maj"], [7, "maj"], [5, "maj"]], "x-------x---x---"),
    // ---- Hip hop ----
    d("hiphop-d1", "hiphop", 90, 2, lanes([KICK, "x......x..x.....x.x....x..x.....", SNARE, "....x.......x...", HAT, "x.x.x.x.x.x.x.xx"]), 0.22),
    d("hiphop-d2", "hiphop", 140, 2, lanes([KICK, "x.....x...x.....x.....x.x.......", SNARE, "........X.......", HAT, "xxxxxxxx.xxxxxxxxxxxxxxxxxxxxXxX"])),
    b("hiphop-b1", "hiphop", 90, 33, [0, 0, 3, 5], "r-----.r--.r----", 0.22),
    k("hiphop-k1", "hiphop", "epiano", 90, 57, [[0, "m7"], [5, "m7"], [3, "maj7"], [7, "m7"]], "x-----x-------..", 0.22),
    // ---- House ----
    d("house-d1", "house", 124, 1, lanes([KICK, "x...x...x...x...", CLAP, "....x.......x...", OHAT, "..x...x...x...x.", HAT, "o...o...o...o..."])),
    d("house-d2", "house", 128, 1, lanes([KICK, "x...x...x...x...", CLAP, "....x.......x...", SHAKER, "xoxoxoxoxoxoxoxo", OHAT, "..x...x...x...x."])),
    b("house-b1", "house", 124, 45, [0, -4, 3, -2], "..r...r...r...r."),
    k("house-k1", "house", "piano", 124, 57, [[0, "min"], [-4, "maj"], [3, "maj"], [-2, "maj"]], "..x...x...x..x.."),
    // ---- Funk ----
    d("funk-d1", "funk", 104, 1, lanes([KICK, "x.........x..x..", SNARE, "....x..o.o..x..o", HAT, "XxxxXxxxXxxxXxxx"]), 0.08),
    b("funk-b1", "funk", 104, 40, [0, 0, 0, 0], "r..o.r.5r.7.r.o.", 0.08),
    k("funk-k1", "funk", "epiano", 104, 64, [[0, "7"], [0, "7"], [5, "7"], [0, "7"]], ".x.x..x..x.x..x.", 0.08),
    // ---- Lo-fi ----
    d("lofi-d1", "lofi", 76, 2, lanes([KICK, "x.....x...x.....x......xx.......", SNARE, "....x.......x...", HAT, "x.x.x.x.x.x.x.x.", RIM, "...............o"]), 0.3),
    b("lofi-b1", "lofi", 76, 41, [2, 7, 0, 9], "r-----r.....5---", 0.3),
    k("lofi-k1", "lofi", "epiano", 76, 65, [[0, "maj7"], [-1, "m7"], [-3, "m7"], [-5, "maj7"]], "x-------------..", 0.3),
    // ---- Latin ----
    d("latin-d1", "latin", 96, 1, lanes([KICK, "x...x...x...x...", SNARE, "...x..x....x..x.", HAT, "x.x.x.x.x.x.x.x."])),
    d("latin-d2", "latin", 100, 2, lanes([KICK, "x...x...x...x...", RIM, "x..x..x...x.x...", SHAKER, "xoxoxoxoxoxoxoxo", COW, "x.....x.....x..."])),
    b("latin-b1", "latin", 96, 33, [0, 0, -4, -2], "r..r..r.r..r..r."),
    k("latin-k1", "latin", "piano", 100, 57, [[0, "min"], [5, "min"], [-2, "maj"], [3, "maj"]], "x.x..x.x.x..x.x."),
    // ---- Ballad ----
    d("ballad-d1", "ballad", 70, 1, lanes([KICK, "x.......x.....x.", RIM, "....x.......x...", HAT, "o.o.o.o.o.o.o.o."])),
    b("ballad-b1", "ballad", 70, 36, [0, -3, 5, 7], "r-------5-------"),
    k("ballad-k1", "ballad", "strings", 70, 60, [[0, "maj"], [-3, "min"], [5, "maj"], [7, "sus2"]], "x---------------"),
    k("ballad-k2", "ballad", "piano", 70, 60, [[0, "maj"], [-3, "min"], [5, "maj"], [7, "maj"]], "1.2.3.4.3.2.1.2.")
  ];

  function stepVel(ch) { return ch === "X" ? 118 : ch === "o" ? 62 : 96; }
  function at(loop, i) { return i * STEP + (i % 2 ? (loop.swing || 0) * STEP : 0); }
  function pat(s, bar, i) { return s.length > 16 ? s.charAt((bar * 16 + i) % s.length) : s.charAt(i); }
  // how many steps a note at `i` holds ('-' after it)
  function holds(s, bar, i) {
    var n = 1;
    while (i + n < 16 && pat(s, bar, i + n) === "-") n++;
    return n;
  }
  // a chord's notes near `key`
  function voicing(key, semis, qual) {
    var r = key + semis;
    while (r > key + 6) r -= 12;
    while (r < key - 6) r += 12;
    return (QUAL[qual] || QUAL.maj).map(function (x) { return r + x; });
  }

  // The notes of a loop, in beats: [[pitch, start, len, vel]] in time order.
  function notesOf(loop) {
    var out = [];
    for (var bar = 0; bar < loop.bars; bar++) {
      var b0 = bar * 4;
      if (loop.k === "drums") {
        Object.keys(loop.lanes).forEach(function (n) {
          for (var i = 0; i < 16; i++) {
            var c = pat(loop.lanes[n], bar, i);
            if (c === "x" || c === "X" || c === "o") out.push([+n, b0 + at(loop, i), STEP / 2, stepVel(c)]);
          }
        });
      } else if (loop.k === "bass") {
        var r = loop.key + loop.roots[bar];
        for (var j = 0; j < 16; j++) {
          var ch = pat(loop.rhythm, bar, j), off = { r: 0, o: 12, "5": 7, m: 3, M: 4, "7": 10 }[ch];
          if (off == null) continue;
          var h = holds(loop.rhythm, bar, j);
          out.push([r + off, b0 + at(loop, j), h * STEP * 0.92, j % 4 === 0 ? 104 : 92]);
        }
      } else {
        var ch2 = loop.chords[bar], v = voicing(loop.key, ch2[0], ch2[1]);
        for (var m = 0; m < 16; m++) {
          var c2 = pat(loop.rhythm, bar, m);
          if (c2 === "." || c2 === "-") continue;
          var len = holds(loop.rhythm, bar, m) * STEP * 0.92, t = b0 + at(loop, m);
          if (c2 === "x" || c2 === "X") v.forEach(function (p) { out.push([p, t, len, c2 === "X" ? 108 : 86]); });
          else {
            var idx = +c2 - 1, ext = v.concat([v[0] + 12, v[1] + 12]);
            if (ext[idx] != null) out.push([ext[idx], t, len, 82]);
          }
        }
      }
    }
    return out.map(function (q) { return [q[0], Math.round(q[1] * 1e4) / 1e4, Math.round(q[2] * 1e4) / 1e4, q[3]]; })
      .sort(function (a, b2) { return a[1] - b2[1] || a[0] - b2[0] || a[2] - b2[2] || a[3] - b2[3]; });
  }
  function beatsOf(loop) { return loop.bars * 4; }
  // "slow" under 90 BPM, "mid" 90–119, "fast" 120 and up
  function tempoBand(bpm) { return bpm < 90 ? "slow" : bpm < 120 ? "mid" : "fast"; }
  // The loops for a genre, kind and tempo band ("" = any).
  function filter(f) {
    f = f || {};
    return LOOPS.filter(function (l) {
      return (!f.g || l.g === f.g) && (!f.k || l.k === f.k) && (!f.tempo || tempoBand(l.bpm) === f.tempo);
    });
  }
  function byId(id) { return LOOPS.filter(function (l) { return l.id === id; })[0] || null; }
  // its number among the loops of the same genre and kind (1, 2, …)
  function numberOf(loop) {
    var n = 0;
    for (var i = 0; i < LOOPS.length; i++) {
      if (LOOPS[i].g === loop.g && LOOPS[i].k === loop.k) n++;
      if (LOOPS[i] === loop) return n;
    }
    return 1;
  }

  var api = {
    GENRES: GENRES, KINDS: KINDS, LOOPS: LOOPS, STEP: STEP,
    notesOf: notesOf, beatsOf: beatsOf, tempoBand: tempoBand, filter: filter, byId: byId, numberOf: numberOf
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioLoops = api;
})(typeof window !== "undefined" ? window : this);
