// ============================================================
// orOS Lyric Sync — diagrams.js (Songbook S4, pure)
// Chord diagrams for guitar, ukulele and piano. There is no chord
// database here (none is copied from anywhere): the notes of a chord
// come from its name (chord grammar of core.js), and each fingering is
// found by a small search over the fretboard, the same every time:
// every note the chord needs, the bass (or the slash bass) lowest on the
// guitar, at most four fingers (a barre counts as one), no more than
// four frets wide, low on the neck and with open strings when it can.
// Piano: the chord's keys from the root (the slash bass an octave
// below).
// Exposes LyricsyncDiagrams (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var TUNINGS = {
    guitar: [40, 45, 50, 55, 59, 64],    // E A D G B E (low to high)
    ukulele: [67, 60, 64, 69]           // G C E A (re-entrant)
  };
  var MAX_FRET = 12, SPAN = 4;

  function parts(ch) {
    var m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(String(ch || ""));
    if (!m || ch === "N.C." || ch === "NC") return null;
    return { r: m[1], a: m[2], q: m[3], b: m[4] || "", ba: m[5] || "" };
  }
  function pcOf(l, a) { return (PC[l] + (a === "#" ? 1 : a === "b" ? 11 : 0)) % 12; }

  // The intervals (semitones above the root) a quality asks for:
  // { need: [...], opt: [...] } — opt notes may be left out.
  function intervals(q) {
    var s = String(q || ""), third = 4, fifth = 7, sev = null, ext = [], add = [], no3 = false, no5 = false;
    function take(re) { var m = re.exec(s); if (m) { s = s.slice(0, m.index) + s.slice(m.index + m[0].length); return true; } return false; }
    if (take(/^\((.*)\)$/)) s = s;   // "(add9)" style handled below
    if (take(/^(maj|M|Δ|\^)7/)) sev = 11;
    else if (take(/^(maj|M|Δ|\^)9/)) { sev = 11; ext.push(14); }
    else if (take(/^(maj|M|Δ|\^)13/)) { sev = 11; ext.push(14, 21); }
    else if (take(/^(maj|M|Δ|\^)(?![a-z])/)) sev = null;
    if (take(/^(dim|°)/)) { third = 3; fifth = 6; if (take(/^7/)) sev = 9; }
    else if (take(/^ø/)) { third = 3; fifth = 6; sev = 10; take(/^7/); }
    else if (take(/^aug|^\+/)) { fifth = 8; }
    else if (take(/^(min|mi|m|-)(?!aj)/)) {
      third = 3;
      if (take(/^(maj|M|Δ|\^)7/)) sev = 11;
    }
    if (take(/^sus2/)) { third = 2; }
    else if (take(/^sus4?/)) { third = 5; }
    if (take(/^6\/9/)) { add.push(9, 14); }
    else if (take(/^6/)) add.push(9);
    if (take(/^7/)) { if (sev === null) sev = 10; }
    else if (take(/^9/)) { if (sev === null) sev = 10; ext.push(14); }
    else if (take(/^11/)) { if (sev === null) sev = 10; ext.push(17); }
    else if (take(/^13/)) { if (sev === null) sev = 10; ext.push(21); }
    if (/sus2/.test(s)) { take(/sus2/); third = 2; }
    else if (/sus4?/.test(s)) { take(/sus4?/); third = 5; }
    var m, re = /(add|\(|)\s*([#b]?)(\d{1,2})\)?/g, rest = s;
    rest = rest.replace(/alt/, function () { ext.push(13, 15); fifth = 8; if (sev === null) sev = 10; return ""; });
    rest = rest.replace(/(no|omit)\s*3/, function () { no3 = true; return ""; }).replace(/(no|omit)\s*5/, function () { no5 = true; return ""; });
    var base = { 2: 2, 4: 5, 5: 7, 6: 9, 9: 14, 11: 17, 13: 21 };
    while ((m = re.exec(rest))) {
      var n = +m[3], acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
      if (!base[n]) continue;
      var iv = base[n] + acc;
      if (n === 5) { fifth = iv; continue; }
      add.push(iv);
    }
    var need = [0], opt = [];
    if (!no3) need.push(third);
    if (sev !== null) need.push(sev);
    ext.concat(add).forEach(function (x) { if (need.indexOf(x) < 0) need.push(x); });
    if (!no5) { if (fifth !== 7) need.push(fifth); else opt.push(7); }
    return { need: need, opt: opt };
  }

  // The chord's pitch classes: { root, bass, need: [pc], opt: [pc] }.
  function notes(ch) {
    var p = parts(ch);
    if (!p) return null;
    var r = pcOf(p.r, p.a), iv = intervals(p.q);
    function pcs(list) { var o = []; list.forEach(function (x) { var v = (r + x) % 12; if (o.indexOf(v) < 0) o.push(v); }); return o; }
    var need = pcs(iv.need), opt = pcs(iv.opt).filter(function (x) { return need.indexOf(x) < 0; });
    return { root: r, bass: p.b ? pcOf(p.b, p.ba) : r, need: need, opt: opt, iv: iv };
  }

  // ---------- Fretted instruments ----------
  function fingersOf(fr) {
    var fretted = fr.filter(function (f) { return f > 0; });
    if (!fretted.length) return { n: 0, barre: null };
    var lo = Math.min.apply(null, fretted), at = [];
    fr.forEach(function (f, i) { if (f === lo) at.push(i); });
    var n = fretted.length, barre = null;
    if (at.length > 1 && n > 4) {
      // More than four notes to fret: a barre at the lowest fret, from its
      // first string to the last, with no open string under it.
      var from = at[0], ok = true;
      for (var i = from; i < fr.length; i++) if (fr[i] === 0) { ok = false; break; }
      if (ok) { barre = { fret: lo, from: from, to: fr.length - 1 }; n = n - at.length + 1; }
    }
    return { n: n, barre: barre };
  }
  function search(inst, ch) {
    var tune = TUNINGS[inst], N = notes(ch);
    if (!tune || !N) return null;
    var guitar = inst === "guitar", strings = tune.length;
    var all = N.need.concat(N.opt);
    if (N.bass !== N.root && all.indexOf(N.bass) < 0) all.push(N.bass);
    // On four strings a chord of five or more notes leaves out the 5th,
    // then the root.
    var need = N.need.slice();
    if (!guitar && need.length > 4) need = need.filter(function (x) { return x !== N.root; }).slice(0, 4);
    if (guitar && need.length > 5) need = need.filter(function (x) { return x !== (N.root + 7) % 12; }).slice(0, 5);
    var best = null;
    for (var b = 0; b <= MAX_FRET - SPAN + 1; b++) {
      var opts = tune.map(function (open) {
        var o = [];
        for (var f = 0; f <= MAX_FRET; f++) {
          if (f > 0 && (f < b || f >= b + SPAN)) continue;
          if (all.indexOf((open + f) % 12) >= 0) o.push(f);
        }
        if (guitar) o.push(-1);
        return o;
      });
      var fr = new Array(strings);
      (function rec(i) {
        if (i === strings) { consider(fr.slice(), b); return; }
        for (var k = 0; k < opts[i].length; k++) {
          var f = opts[i][k];
          // Muted strings only at the bass side, before any played one.
          if (f === -1 && i > 0 && fr[i - 1] !== -1) continue;
          fr[i] = f;
          rec(i + 1);
        }
      })(0);
    }
    function consider(fr, b) {
      var sounding = [], lowest = null, have = {};
      fr.forEach(function (f, i) {
        if (f < 0) return;
        var mid = tune[i] + f;
        sounding.push(mid);
        have[mid % 12] = 1;
        if (lowest === null || mid < lowest) lowest = mid;
      });
      if (sounding.length < (guitar ? 4 : 4)) return;
      if (guitar && lowest % 12 !== N.bass) return;
      for (var k = 0; k < need.length; k++) if (!have[need[k]]) return;
      if (N.bass !== N.root && !have[N.bass]) return;
      var fretted = fr.filter(function (f) { return f > 0; });
      var lo = fretted.length ? Math.min.apply(null, fretted) : 0, hi = fretted.length ? Math.max.apply(null, fretted) : 0;
      if (hi - lo >= SPAN) return;
      var fg = fingersOf(fr);
      if (fg.n > 4) return;
      var muted = fr.filter(function (f) { return f < 0; }).length;
      var open = fr.filter(function (f) { return f === 0; }).length;
      var optMiss = N.opt.filter(function (x) { return !have[x]; }).length;
      var score = lo * 2 + muted * 2.5 + (hi - lo) * 1.2 + fg.n * 0.4 + optMiss * 1.5 + (fg.barre ? 0.8 : 0) +
        (guitar && hi > 3 ? open * 1 : -open * 0.3);   // open strings help low on the neck, not with a high stretch
      score = Math.round(score * 1000);
      var key = fr.map(function (f) { return String(f + 1).padStart(2, "0"); }).join("");
      if (!best || score < best.score || (score === best.score && key < best.key)) best = { score: score, key: key, fr: fr, barre: fg.barre, lo: lo, hi: hi };
    }
    if (!best) return null;
    var first = best.hi <= 4 ? 1 : best.lo;
    return { inst: inst, chord: ch, frets: best.fr, first: first, barre: best.barre };
  }
  var cache = {};
  function shape(inst, ch) {
    var k = inst + "|" + ch;
    if (!(k in cache)) cache[k] = inst === "piano" ? piano(ch) : search(inst, ch);
    return cache[k];
  }

  // ---------- Piano ----------
  // Keys as semitones from C (0 = the C of the drawing), root position
  // from the root in the first octave, the slash bass below it.
  function piano(ch) {
    var N = notes(ch);
    if (!N) return null;
    var p = parts(ch), r = N.root;
    var keys = N.iv.need.concat(N.iv.opt).map(function (x) { return r + x; }).sort(function (a, b) { return a - b; });
    var out = [];
    keys.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
    out = out.map(function (k) { return k + 12; });     // leave the first octave for the bass
    var bass = p.b ? N.bass + (N.bass > r ? 0 : 12) : null;
    if (bass !== null) { while (bass >= out[0]) bass -= 12; while (bass < 0) bass += 12; }
    return { inst: "piano", chord: ch, keys: out, bass: bass };
  }


  // ---------- Drawing (for SVG on screen and jsPDF in the PDF) ----------
  // A shape → { w, h, items } in drawing units: line {x1,y1,x2,y2,sw},
  // dot {x,y,r,fill}, box {x,y,w,h,fill,rx}, text {x,y,t,size,anchor}.
  // lefty mirrors a fretboard (the low string on the right).
  var FRETS = 5;
  function draw(sh, lefty) {
    if (!sh) return null;
    if (sh.inst === "piano") return drawPiano(sh);
    var n = sh.frets.length, W = 64, Hh = 84, x0 = 12, x1 = 52, top = 20, gap = 12, items = [];
    function X(i) { var x = x0 + i * (x1 - x0) / (n - 1); return lefty ? W - x : x; }
    for (var i = 0; i < n; i++) items.push({ k: "line", x1: X(i), y1: top, x2: X(i), y2: top + FRETS * gap, sw: 1 });
    for (var f = 0; f <= FRETS; f++) items.push({ k: "line", x1: X(0), y1: top + f * gap, x2: X(n - 1), y2: top + f * gap, sw: f === 0 && sh.first === 1 ? 3 : 1 });
    if (sh.first > 1) items.push({ k: "text", x: lefty ? W - 4 : 4, y: top + gap * 0.5 + 3, t: String(sh.first), size: 9, anchor: lefty ? "end" : "start" });
    if (sh.barre) {
      var by = top + (sh.barre.fret - sh.first + 0.5) * gap, bx = Math.min(X(sh.barre.from), X(sh.barre.to)), bw = Math.abs(X(sh.barre.to) - X(sh.barre.from));
      items.push({ k: "box", x: bx - 4, y: by - 4, w: bw + 8, h: 8, fill: true, rx: 4 });
    }
    sh.frets.forEach(function (fr, i) {
      if (fr < 0) items.push({ k: "text", x: X(i), y: top - 6, t: "\u00d7", size: 10, anchor: "middle" });
      else if (fr === 0) items.push({ k: "dot", x: X(i), y: top - 9, r: 3, fill: false });
      else if (!(sh.barre && fr === sh.barre.fret && i >= sh.barre.from)) items.push({ k: "dot", x: X(i), y: top + (fr - sh.first + 0.5) * gap, r: 4, fill: true });
    });
    return { w: W, h: Hh, items: items };
  }
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  function drawPiano(sh) {
    var all = sh.keys.concat(sh.bass === null ? [] : [sh.bass]);
    var oct = Math.max(2, Math.min(4, Math.ceil((Math.max.apply(null, all) + 1) / 12)));
    var kw = 8, W = oct * 7 * kw, Hh = 44, items = [], whiteX = {}, x = 0;
    for (var k = 0; k < oct * 12; k++) if (!BLACK[k % 12]) { whiteX[k] = x; items.push({ k: "box", x: x, y: 0, w: kw, h: Hh, fill: false, rx: 0 }); x += kw; }
    var blackX = {};
    for (k = 0; k < oct * 12; k++) if (BLACK[k % 12]) { blackX[k] = whiteX[k - 1] + kw * 0.65; items.push({ k: "box", x: blackX[k], y: 0, w: kw * 0.7, h: Hh * 0.6, fill: true, rx: 0 }); }
    all.forEach(function (key, n) {
      if (key < 0 || key >= oct * 12) return;
      var bl = !!BLACK[key % 12];
      var cx = bl ? blackX[key] + kw * 0.35 : whiteX[key] + kw / 2, cy = bl ? Hh * 0.45 : Hh * 0.8;
      items.push({ k: "dot", x: cx, y: cy, r: 2.6, fill: true, hi: bl ? 1 : 0, bass: key === sh.bass ? 1 : 0 });
    });
    return { w: W, h: Hh, items: items };
  }

  // The chords of a song, once each, in order of first use.
  function chordsOf(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (c) { if (c && c !== "N.C." && c !== "NC" && !seen[c]) { seen[c] = 1; out.push(c); } });
    return out;
  }

  var API = { notes: notes, intervals: intervals, shape: shape, draw: draw, chordsOf: chordsOf, TUNINGS: TUNINGS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncDiagrams = API;
})(typeof window !== "undefined" ? window : globalThis);
