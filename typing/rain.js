// ============================================================
// orOS Typing Tutor: Letter rain (wave 3), the game logic (pure, no DOM)
// Letters fall from the top; typing one takes the lowest copy of it
// away. A letter that reaches the bottom costs a life; three lives.
// Every 10 letters is a level: they fall faster and come more often.
// Only letters the person has learned take part. The same seed and the
// same steps give the same game (tests). app.js draws it.
// ============================================================
(function (root) {
  "use strict";

  var CO = root && root.TypingCourse ? root.TypingCourse :
    (typeof require === "function" ? require("./course.js") : null);

  var LIVES = 3, PER_LEVEL = 10;

  // speed: share of the field height per second; gap: ms between letters
  function speed(level, kid) { return Math.min(0.35, 0.08 + 0.025 * (level - 1)) * (kid ? 0.75 : 1); }
  function gap(level, kid) { return Math.max(500, 1800 - 150 * (level - 1)) * (kid ? 1.3 : 1); }

  // The letters of the game: the learned lower-case letters, else the
  // home row (lesson 5; on polytonic every plain letter), so a first game
  // is still possible.
  function letters(lay, upto) {
    var ok = CO.allowed(lay, upto >= 0 ? upto : CO.homeIdx(lay));
    var out = Object.keys(ok).filter(function (c) { return /\p{Ll}/u.test(c); }).sort();
    return out.length ? out : ["f", "j"];
  }

  function create(list, seed, kid) {
    return {
      letters: list.slice(), r: CO.rng(seed || 1), kid: !!kid,
      t: 0, nextAt: 0, items: [], nid: 0,
      score: 0, lives: LIVES, level: 1, wrong: 0, missed: 0, over: false
    };
  }

  function spawn(s) {
    var onScreen = {};
    s.items.forEach(function (it) { onScreen[it.ch] = true; });
    var free = s.letters.filter(function (c) { return !onScreen[c]; });
    var from = free.length ? free : s.letters;
    var ch = from[Math.floor(s.r() * from.length)];
    s.items.push({ id: ++s.nid, ch: ch, x: 0.06 + 0.88 * s.r(), y: 0 });
  }

  // Moves the game on by dt ms. Returns the letters that fell out.
  function step(s, dt) {
    if (s.over || !(dt > 0)) return [];
    dt = Math.min(dt, 250);   // a stalled frame does not drop a whole row
    s.t += dt;
    while (s.t >= s.nextAt) {
      spawn(s);
      s.nextAt += gap(s.level, s.kid);
    }
    var v = speed(s.level, s.kid) * dt / 1000, lost = [];
    s.items = s.items.filter(function (it) {
      it.y += v;
      if (it.y >= 1) { lost.push(it); return false; }
      return true;
    });
    if (lost.length) {
      s.missed += lost.length;
      s.lives = Math.max(0, s.lives - lost.length);
      if (!s.lives) s.over = true;
    }
    return lost;
  }

  // A typed character: the lowest copy of it goes. Returns it, or null.
  function hit(s, ch) {
    if (s.over) return null;
    var best = null;
    s.items.forEach(function (it) { if (it.ch === ch && (!best || it.y > best.y)) best = it; });
    if (!best) { s.wrong++; return null; }
    s.items = s.items.filter(function (it) { return it !== best; });
    s.score++;
    s.level = 1 + Math.floor(s.score / PER_LEVEL);
    return best;
  }

  var API = { LIVES: LIVES, PER_LEVEL: PER_LEVEL, speed: speed, gap: gap, letters: letters, create: create, step: step, hit: hit };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingRain = API;
})(typeof window !== "undefined" ? window : globalThis);
