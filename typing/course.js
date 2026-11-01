// ============================================================
// orOS Typing Tutor: the course (pure, no DOM)
// i18n-inline-ok: the Greek letters below are lesson material (marked vowels and consonants), no UI text
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
  // Polytonic Greek (wave 4, layout elp): the letters are known from the
  // Greek course; these lessons bring in the marks, one dead key each.
  // mk: what the lesson card shows.
  var POLY_LESSONS = [
    { id: "g1", g: "poly", k: ["Semicolon"], mk: "ά ἀ" },
    { id: "g2", g: "poly", k: ["Quote"], mk: "ὰ ἁ" },
    { id: "g3", g: "poly", k: ["BracketLeft"], mk: "ᾶ ϊ" },
    { id: "g4", g: "poly", k: ["BracketRight"], mk: "ᾳ" },
    { id: "g5", g: "poly", k: [], r: true, s: true },
    { id: "g6", g: "poly", k: [], r: true, s: true, fin: true }
  ];
  var GROUPS = ["home", "top", "bottom", "more", "poly"];

  function isPoly(lay) { return !!(L && L.get(lay).poly); }
  function listFor(lay) { return isPoly(lay) ? POLY_LESSONS : LESSONS; }
  // The lessons of a layout (no layout: the main course).
  function lessons(lay) { return (lay ? listFor(lay) : LESSONS).slice(); }
  // A lesson's place in its own list (lesson ids are unique across both).
  function indexOf(id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return i;
    for (var j = 0; j < POLY_LESSONS.length; j++) if (POLY_LESSONS[j].id === id) return j;
    return -1;
  }
  function lesson(id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i];
    for (var j = 0; j < POLY_LESSONS.length; j++) if (POLY_LESSONS[j].id === id) return POLY_LESSONS[j];
    return null;
  }
  // Is this lesson part of the layout's course?
  function has(lay, id) { return listFor(lay).some(function (x) { return x.id === id; }); }
  // The lesson index whose keys a game or test may use before any lesson
  // is done (-1 on polytonic: every letter, no marks).
  function homeIdx(lay) { return isPoly(lay) ? -1 : indexOf("h5"); }
  function fullIdx(lay) { return isPoly(lay) ? POLY_LESSONS.length - 1 : indexOf("b6"); }

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
  function learnedCodes(lay, upto) {
    var set = {}, list = listFor(lay);
    if (isPoly(lay)) {
      // every key that is not a dead key is known from the start
      var keys = L.get(lay).keys;
      Object.keys(keys).forEach(function (c) {
        if (!keys[c].some(function (ch) { return ch && ch.indexOf("dead:") === 0; })) set[c] = true;
      });
      set.Space = set.ShiftLeft = set.ShiftRight = true;
    }
    for (var i = 0; i <= upto && i < list.length; i++) list[i].k.forEach(function (c) { set[c] = true; });
    return set;
  }
  function shiftAt(lay, upto) {
    if (isPoly(lay)) return true;
    for (var i = 0; i <= upto && i < LESSONS.length; i++) if (LESSONS[i].shift) return true;
    return false;
  }

  // Characters typeable with the keys learned up to lesson index `upto`
  // (dead-key letters included once the dead key and the letter are in).
  function allowed(lay, upto) {
    var codes = learnedCodes(lay, upto), sh = shiftAt(lay, upto), out = {};
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
    var now = allowed(lay, idx), before = idx > 0 || isPoly(lay) ? allowed(lay, idx - 1) : {};
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
    var Ls = lesson(id);
    if (Ls.mk) return Ls.mk;
    var f = fresh(lay, i);
    if (Ls.shift) return "⇧";
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
  function lang(lay) { return L.get(lay).words || lay; }
  function wordsFor(lay, ok) {
    return uniq((W.WORDS[lang(lay)] || []).map(function (w) { return w.normalize("NFC"); })).filter(function (w) { return fits(w, ok); });
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
  var KID_TARGET = 110;   // kids mode (wave 3): shorter lessons
  // Signs typed around a word: openers wrap it, the rest follow it.
  var WRAP = { "(": ")", "[": "]", "{": "}", "<": ">", "\"": "\"", "'": "'", "«": "»" };
  var CLOSERS = { ")": 1, "]": 1, "}": 1, ">": 1, "»": 1 };
  function wrap(sign, word, ok) {
    if (!WRAP[sign]) return word + sign;
    return ok[WRAP[sign]] ? sign + word + WRAP[sign] : sign + word;
  }

  // Kids mode: the simple words first (animals, colours, food), then
  // short common words, so a lesson is never empty.
  function kidWords(lay, ok) {
    var kw = uniq((W.KIDS && W.KIDS[lang(lay)] || []).map(function (w) { return w.normalize("NFC"); })).filter(function (w) { return fits(w, ok); });
    var short = wordsFor(lay, ok).filter(function (w) { return Array.from(w).length <= 5 && kw.indexOf(w) < 0; });
    return kw.concat(short);
  }

  // The text of a lesson: a string of words separated by single spaces.
  // opt.kid (wave 3): about half as long, kids' words, no sentences.
  function build(lay, id, seed, opt) {
    var idx = indexOf(id);
    if (idx < 0 || !has(lay, id)) return "";
    var kid = !!(opt && opt.kid), target = kid ? KID_TARGET : TARGET;
    var Ls = listFor(lay)[idx], r = rng(seed || 1), ok = allowed(lay, idx);
    var nw = fresh(lay, idx), parts = [];
    var letters = Object.keys(ok).filter(function (c) { return /\p{Ll}/u.test(c); });
    var newLetters = nw.filter(function (c) { return /\p{L}/u.test(c); });
    var words = kid ? kidWords(lay, ok) : wordsFor(lay, ok);
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
      for (var d = 0; d < (kid ? 8 : 16) && base.length; d++) {
        var w0 = base[d % base.length];
        if (digits.length && (d % 2 === 0 || !signs.length)) parts.push(drill(r, digits, 1)[0]);
        else if (signs.length) parts.push(wrap(pick(r, signs), w0, ok));
        parts.push(base[(d + 7) % base.length]);
      }
    }

    // 1. drill of the new letters (with two home letters when only one
    //    is new), then new with old
    if (newLetters.length && isPoly(lay)) {
      // polytonic: the new marked vowels in short syllables (ἀν, ὁτ…),
      // lower case, the most frequent forms first
      var vow = newLetters.filter(function (c) { return /\p{Ll}/u.test(c) && c !== "ῤ" && c.normalize("NFD").length <= 3; });
      var cons = ["ν", "σ", "τ", "λ", "κ", "ρ", "μ"];
      for (var q = 0; q < (kid ? 6 : 12) && vow.length; q++) parts.push(pick(r, vow) + pick(r, cons));
    } else if (newLetters.length && !Ls.shift) {
      var dl = newLetters.length > 1 ? newLetters : newLetters.concat(letters.filter(function (c) { return newLetters.indexOf(c) < 0; }).slice(0, 2));
      parts = parts.concat(drill(r, dl, kid ? 4 : 6));
      var mixed = letters.length > newLetters.length ? letters : newLetters;
      parts = parts.concat(drill(r, mixed.concat(newLetters), kid ? 3 : 6));
    }
    // 2. words (half of them with a new letter when there are)
    // kids: their own words keep their order of preference (shuffled within)
    var pool = withNew.length >= 4 ? shuffle(r, withNew).concat(shuffle(r, words)) : shuffle(r, words);
    if (kid && withNew.length < 4) {
      var kw = W.KIDS && W.KIDS[lang(lay)] ? W.KIDS[lang(lay)].map(function (w) { return w.normalize("NFC"); }) : [];
      pool = shuffle(r, words.filter(function (w) { return kw.indexOf(w) >= 0; }))
        .concat(shuffle(r, words.filter(function (w) { return kw.indexOf(w) < 0; })));
    }
    if (pool.length < 15) {
      // few real words yet: made-up words from the learned letters too
      var src = letters.length ? letters : newLetters;
      pool = pool.concat(drill(r, src, 24 - pool.length));
    }
    // signs that came with a letter lesson (, . / ; …) follow some words
    var tail = Ls.shift ? [] : nw.filter(function (c) { return !/\p{L}/u.test(c) && newLetters.length; });
    var len = function () { return parts.join(" ").length; };
    var k = 0;
    while (len() < target && k < 400 && pool.length) {
      var w = pool[k % pool.length];
      if (tail.length && k % 3 === 2) w = wrap(pick(r, tail), w, ok);
      parts.push(w);
      k++;
    }
    // 3. a sentence that fits
    if (Ls.s && !kid) {
      var sents = (W.SENTENCES[lang(lay)] || []).map(function (s) { return s.normalize("NFC"); }).filter(function (s) { return fits(s, ok); });
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
    var r = rng(seed || 1), ok = allowed(lay, fullIdx(lay));
    var words = wordsFor(lay, ok).filter(function (w) { return Array.from(w).length >= 2; });
    var out = [];
    while (out.length < (n || 200) && words.length) {
      var w = pick(r, words);
      if (out[out.length - 1] !== w) out.push(w);
    }
    return out.join(" ");
  }

  // ---------- Adaptive practice (wave 2) ----------
  // ks = TypingCore.keyStats(data, lay): {char: {r right, w wrong, ms on the right ones}}.
  // A key's weight: its error share (with one made-up miss so a key
  // seen twice does not look perfect or hopeless) plus how much slower
  // than the person's usual key it is. Keys seen fewer than 5 times
  // count as average. Only letters the person has learned (lesson
  // index `upto`) take part, lower case unless Shift is learned.
  function weak(lay, ks, upto, n) {
    var ok = allowed(lay, upto);
    var letters = Object.keys(ok).filter(function (c) { return /\p{L}/u.test(c); });
    var times = [];
    letters.forEach(function (c) { var s = ks[c]; if (s && s.r >= 5) times.push(s.ms / s.r); });
    times.sort(function (a, b) { return a - b; });
    var mid = times.length ? times[Math.floor(times.length / 2)] : 0;
    var scored = letters.map(function (c) {
      var s = ks[c] || { r: 0, w: 0, ms: 0 }, seen = s.r + s.w;
      if (seen < 5) return { c: c, v: 0.05 };
      var err = (s.w + 1) / (seen + 2);
      var slow = mid && s.r ? Math.max(0, (s.ms / s.r) / mid - 1) : 0;
      return { c: c, v: err + Math.min(1, slow) * 0.1 };
    });
    scored.sort(function (a, b) { return b.v - a.v || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0); });
    return scored.slice(0, n || 5).filter(function (x) { return x.v > 0.05; }).map(function (x) { return x.c; });
  }
  // The text of a practice round: the weak letters in short groups, then
  // real words that hold them (about two in three), then other words.
  // Same input and seed, same text.
  function practice(lay, ks, upto, seed) {
    upto = Math.max(isPoly(lay) ? -1 : 0, Math.min(listFor(lay).length - 1, upto | 0));
    var r = rng(seed || 1), ok = allowed(lay, upto);
    var weakOnes = weak(lay, ks, upto, 5);
    var letters = Object.keys(ok).filter(function (c) { return /\p{Ll}/u.test(c); });
    var focus = weakOnes.length ? weakOnes : shuffle(r, letters).slice(0, 4);
    var words = wordsFor(lay, ok).filter(function (w) { return Array.from(w).length >= 2; });
    var hit = words.filter(function (w) { return focus.some(function (c) { return w.indexOf(c) !== -1; }); });
    // one weak key alone makes a dull drill: two other learned letters join it
    var dl = focus.length > 1 ? focus : focus.concat(shuffle(r, letters.filter(function (c) { return focus.indexOf(c) < 0; })).slice(0, 2));
    var parts = drill(r, dl.concat(focus), 6);
    var pool = hit.length ? hit : words;
    if (pool.length < 10) pool = pool.concat(drill(r, letters.length ? letters : focus, 12));
    var others = words.length ? words : pool;
    var k = 0;
    while (parts.join(" ").length < TARGET + 80 && k < 400) {
      parts.push(k % 3 === 2 ? pick(r, others) : pick(r, pool));
      k++;
    }
    return { text: parts.join(" ").replace(/\s+/g, " ").trim(), keys: focus };
  }

  var API = {
    GROUPS: GROUPS, lessons: lessons, lesson: lesson, indexOf: indexOf,
    allowed: allowed, fresh: fresh, label: label, build: build, testText: testText, rng: rng, KID_TARGET: KID_TARGET,
    weak: weak, practice: practice, has: has, isPoly: isPoly, homeIdx: homeIdx, fullIdx: fullIdx
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingCourse = API;
})(typeof window !== "undefined" ? window : globalThis);
