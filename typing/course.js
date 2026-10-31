// ============================================================
// orOS Typing Tutor: the course (pure, no DOM)
// One course for every layout, written as physical keys, so each
// layout gets its own letters on the same fingers. Lesson ids are
// stored in the synced progress and NEVER change meaning; a new lesson
// gets a new id.
// build(lay, id, seed) gives the lesson text: a drill of the new keys,
// then real words that only use the keys learned so far, then (when
// they fit) a sentence. The same seed gives the same text.
// Needs TypingLayouts and TypingWords (loaded before it).
// ============================================================
(function (root) {
  "use strict";

  var L = root && root.TypingLayouts ? root.TypingLayouts :
    (typeof require === "function" ? require("./layouts.js") : null);
  var W = root && root.TypingWords ? root.TypingWords :
    (typeof require === "function" ? require("./words.js") : null);

  // g: group (home, top, bottom, more); k: the new keys; r: review
  // lesson (no new keys); shift: capitals from here on; s: sentences.
  var LESSONS = [
    { id: "h1", g: "home", k: ["KeyF", "KeyJ", "Space"] },
    { id: "h2", g: "home", k: ["KeyD", "KeyK"] },
    { id: "h3", g: "home", k: ["KeyS", "KeyL"] },
    { id: "h4", g: "home", k: ["KeyA", "Semicolon"] },
    { id: "h5", g: "home", k: ["KeyG", "KeyH"] },
    { id: "h6", g: "home", k: [], r: true },
    { id: "t1", g: "top", k: ["KeyE", "KeyI"] },
    { id: "t2", g: "top", k: ["KeyR", "KeyU"] },
    { id: "t3", g: "top", k: ["KeyT", "KeyY"] },
    { id: "t4", g: "top", k: ["KeyW", "KeyO"] },
    { id: "t5", g: "top", k: ["KeyQ", "KeyP"] },
    { id: "t6", g: "top", k: [], r: true },
    { id: "b1", g: "bottom", k: ["KeyV", "KeyM"] },
    { id: "b2", g: "bottom", k: ["KeyC", "Comma"] },
    { id: "b3", g: "bottom", k: ["KeyX", "Period"] },
    { id: "b4", g: "bottom", k: ["KeyZ", "Slash"] },
    { id: "b5", g: "bottom", k: ["KeyB", "KeyN"] },
    { id: "b6", g: "bottom", k: [], r: true, s: true },
    { id: "s1", g: "more", k: ["ShiftLeft", "ShiftRight"], shift: true, s: true },
    { id: "s2", g: "more", k: ["Quote", "BracketLeft", "Minus"], s: true },
    { id: "n1", g: "more", k: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"] },
    { id: "n2", g: "more", k: ["Digit6", "Digit7", "Digit8", "Digit9", "Digit0"] },
    { id: "p1", g: "more", k: ["Equal", "BracketRight", "Backslash", "Backquote", "IntlBackslash"], s: true },
    { id: "f1", g: "more", k: [], r: true, s: true, fin: true }
  ];
  var GROUPS = ["home", "top", "bottom", "more"];

  function lessons() { return LESSONS.slice(); }
  function indexOf(id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return i;
    return -1;
  }
  function lesson(id) { var i = indexOf(id); return i < 0 ? null : LESSONS[i]; }

  // ---------- seeded random (mulberry32) ----------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function shuffle(r, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------- which characters a lesson may use ----------
  function learnedCodes(upto) {
    var set = {};
    for (var i = 0; i <= upto && i < LESSONS.length; i++) LESSONS[i].k.forEach(function (c) { set[c] = true; });
    return set;
  }
  function shiftAt(upto) {
    for (var i = 0; i <= upto && i < LESSONS.length; i++) if (LESSONS[i].shift) return true;
    return false;
  }

  // Characters typeable with the keys learned up to lesson index `upto`
  // (dead-key letters included once the dead key and the letter are in).
  function allowed(lay, upto) {
    var codes = learnedCodes(upto), sh = shiftAt(upto), out = {};
    L.chars(lay).forEach(function (ch) {
      var st = L.strokes(lay, ch);
      if (!st) return;
      var ok = st.every(function (s) { return codes[s.code] && (!s.shift || sh); });
      if (ok) out[ch] = true;
    });
    return out;
  }
  // The characters a lesson brings in (for its label and its drill).
  function fresh(lay, idx) {
    var now = allowed(lay, idx), before = idx > 0 ? allowed(lay, idx - 1) : {};
    return Object.keys(now).filter(function (c) { return !before[c] && c !== " "; }).sort(function (a, b) {
      // letters first, then the rest, in key order
      var la = /\p{L}/u.test(a), lb = /\p{L}/u.test(b);
      if (la !== lb) return la ? -1 : 1;
      return keyRank(lay, a) - keyRank(lay, b);
    });
  }
  function keyRank(lay, ch) {
    var st = L.strokes(lay, ch), all = L.codes(lay);
    if (!st) return 999;
    var last = st[st.length - 1];
    return all.indexOf(last.code) * 2 + (last.shift ? 1 : 0) + (st.length > 1 ? 0.5 : 0);
  }

  function label(lay, id) {
    var i = indexOf(id);
    if (i < 0) return "";
    var f = fresh(lay, i);
    if (LESSONS[i].shift) return "⇧";
    return f.slice(0, 8).join(" ");
  }

  function fits(word, ok) {
    var cs = Array.from(word);
    for (var i = 0; i < cs.length; i++) if (!ok[cs[i]]) return false;
    return true;
  }
  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (w) { if (!seen[w]) { seen[w] = true; out.push(w); } });
    return out;
  }
  function wordsFor(lay, ok) {
    return uniq((W.WORDS[lay] || []).map(function (w) { return w.normalize("NFC"); })).filter(function (w) { return fits(w, ok); });
  }

  // Groups of 2-5 characters from `letters` (the drill).
  function drill(r, letters, n) {
    var out = [];
    if (!letters.length) return out;
    for (var i = 0; i < n; i++) {
      var len = 2 + Math.floor(r() * 4), g = "";
      for (var j = 0; j < len; j++) g += pick(r, letters);
      out.push(g);
    }
    return out;
  }

  var TARGET = 220;   // about this many characters per lesson
  // Signs typed around a word: openers wrap it, the rest follow it.
  var WRAP = { "(": ")", "[": "]", "{": "}", "<": ">", "\"": "\"", "'": "'", "«": "»" };
  var CLOSERS = { ")": 1, "]": 1, "}": 1, ">": 1, "»": 1 };
  function wrap(sign, word, ok) {
    if (!WRAP[sign]) return word + sign;
    return ok[WRAP[sign]] ? sign + word + WRAP[sign] : sign + word;
  }   // about this many characters per lesson

  // The text of a lesson: a string of words separated by single spaces.
  function build(lay, id, seed) {
    var idx = indexOf(id);
    if (idx < 0) return "";
    var Ls = LESSONS[idx], r = rng(seed || 1), ok = allowed(lay, idx);
    var nw = fresh(lay, idx), parts = [];
    var letters = Object.keys(ok).filter(function (c) { return /\p{Ll}/u.test(c); });
    var newLetters = nw.filter(function (c) { return /\p{L}/u.test(c); });
    var words = wordsFor(lay, ok);
    var withNew = words.filter(function (w) {
      return nw.some(function (c) { return w.indexOf(c) !== -1; });
    });

    if (Ls.shift) {
      // capitals: words that start with a capital, else capitalised words
      var caps = words.filter(function (w) { return /^\p{Lu}/u.test(w); });
      var low = words.filter(function (w) { return /^\p{Ll}/u.test(w) && Array.from(w).length > 2; });
      var capd = low.map(function (w) { var a = Array.from(w); a[0] = a[0].toUpperCase(); return a.join(""); })
        .filter(function (w) { return fits(w, ok); });
      withNew = shuffle(r, caps).slice(0, 12).concat(shuffle(r, capd).slice(0, 12));
    } else if (nw.length && !newLetters.length && !Ls.r) {
      // digits and signs: digit groups and signs around short words
      var base = shuffle(r, words.filter(function (w) { return Array.from(w).length <= 6; }));
      var marks = nw.filter(function (c) { return !/\p{L}/u.test(c); });
      var digits = marks.filter(function (c) { return /\d/.test(c); });
      var signs = marks.filter(function (c) { return !/\d/.test(c) && !CLOSERS[c]; });
      for (var d = 0; d < 16 && base.length; d++) {
        var w0 = base[d % base.length];
        if (digits.length && (d % 2 === 0 || !signs.length)) parts.push(drill(r, digits, 1)[0]);
        else if (signs.length) parts.push(wrap(pick(r, signs), w0, ok));
        parts.push(base[(d + 7) % base.length]);
      }
    }

    // 1. drill of the new letters (with two home letters when only one
    //    is new), then new with old
    if (newLetters.length && !Ls.shift) {
      var dl = newLetters.length > 1 ? newLetters : newLetters.concat(letters.filter(function (c) { return newLetters.indexOf(c) < 0; }).slice(0, 2));
      parts = parts.concat(drill(r, dl, 6));
      var mixed = letters.length > newLetters.length ? letters : newLetters;
      parts = parts.concat(drill(r, mixed.concat(newLetters), 6));
    }
    // 2. words (half of them with a new letter when there are)
    var pool = withNew.length >= 4 ? shuffle(r, withNew).concat(shuffle(r, words)) : shuffle(r, words);
    if (pool.length < 15) {
      // few real words yet: made-up words from the learned letters too
      var src = letters.length ? letters : newLetters;
      pool = pool.concat(drill(r, src, 24 - pool.length));
    }
    // signs that came with a letter lesson (, . / ; …) follow some words
    var tail = Ls.shift ? [] : nw.filter(function (c) { return !/\p{L}/u.test(c) && newLetters.length; });
    var len = function () { return parts.join(" ").length; };
    var k = 0;
    while (len() < TARGET && k < 400 && pool.length) {
      var w = pool[k % pool.length];
      if (tail.length && k % 3 === 2) w = wrap(pick(r, tail), w, ok);
      parts.push(w);
      k++;
    }
    // 3. a sentence that fits
    if (Ls.s) {
      var sents = (W.SENTENCES[lay] || []).map(function (s) { return s.normalize("NFC"); }).filter(function (s) { return fits(s, ok); });
      if (sents.length) {
        var n = Ls.fin ? 4 : 1;
        shuffle(r, sents).slice(0, n).forEach(function (s) { parts.push(s); });
        if (Ls.fin) parts = shuffle(r, words).slice(0, 10).concat(parts.slice(-n));
      }
    }
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  // Words for a speed test: common words the whole layout can type,
  // lower case only (a test measures speed, not Shift).
  function testText(lay, seed, n) {
    var r = rng(seed || 1), ok = allowed(lay, indexOf("b6"));
    var words = wordsFor(lay, ok).filter(function (w) { return Array.from(w).length >= 2; });
    var out = [];
    while (out.length < (n || 200) && words.length) {
      var w = pick(r, words);
      if (out[out.length - 1] !== w) out.push(w);
    }
    return out.join(" ");
  }

  var API = {
    GROUPS: GROUPS, lessons: lessons, lesson: lesson, indexOf: indexOf,
    allowed: allowed, fresh: fresh, label: label, build: build, testText: testText, rng: rng
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingCourse = API;
})(typeof window !== "undefined" ? window : globalThis);
