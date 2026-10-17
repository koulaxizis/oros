// ============================================================
// orOS Flashcards — FSRS-6 scheduler (FlashcardsFsrs), pure.
// An own rewrite of the Free Spaced Repetition Scheduler, version 6
// (21 weights), following the reference implementation ts-fsrs 5.x
// by Open Spaced Repetition (MIT). tests/flashcards-fsrs.test.js
// checks it against vectors made once with ts-fsrs 5.4.2
// (tests/fixtures/flashcards-fsrs-vectors.json).
//
// A card's memory state:
//   { st 0 new | 1 learning | 2 review | 3 relearning,
//     s stability (days), d difficulty 1-10, step learning step,
//     due ms, last ms of the last answer (0 = never),
//     sd scheduled days, reps, lapses }
// Times are ms since 1970. Days between answers are counted in UTC
// calendar days, as ts-fsrs does, so every device that replays the
// same answers gets the same state whatever its time zone.
// Fuzz is seeded from the answer itself (time, reps, d × s), so it
// is the same on every device too.
// ============================================================
(function (root) {
  "use strict";

  var DAY = 86400000, MIN = 60000;
  var S_MIN = 0.001, S_MAX = 36500, INIT_S_MAX = 100;
  var W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
    0.0912, 0.0658, 0.1542];
  var CLIP = [[S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX],
    [1, 10], [0.001, 4], [0.001, 4], [0.001, 0.75], [0, 4.5], [0, 0.8], [0.001, 3.5],
    [0.001, 5], [0.001, 0.25], [0.001, 0.9], [0, 4], [0, 1], [1, 6], [0, 2], [0, 2],
    [0.01, 0.8], [0.1, 0.8]];

  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function round8(n) { return Math.round(n * 1e8) / 1e8; }

  // ---------- Parameters ----------
  // p = { w[21], ret 0.70-0.99, max days, ls [minutes], rs [minutes], fuzz }
  function params(p) {
    p = p || {};
    var w = Array.isArray(p.w) && p.w.length === 21 && p.w.every(isFinite) ? p.w.slice() : W.slice();
    var rs = Array.isArray(p.rs) ? p.rs.filter(validStep) : [10];
    var clip = CLIP.map(function (c) { return c.slice(); });
    if (rs.length > 1) {
      // The same ceiling for w17 / w18 as ts-fsrs with several relearning steps.
      var w11 = clamp(w[11], clip[11][0], clip[11][1]), w13 = clamp(w[13], clip[13][0], clip[13][1]),
          w14 = clamp(w[14], clip[14][0], clip[14][1]);
      var v = -(Math.log(w11) + Math.log(Math.pow(2, w13) - 1) + w14 * 0.3) / rs.length;
      var ceil = clamp(round8(Math.sqrt(Math.max(v, 0))), 0.01, 2);
      clip[17][1] = ceil; clip[18][1] = ceil;
    }
    w = w.map(function (x, i) { return clamp(x || 0, clip[i][0], clip[i][1]); });
    var ret = +p.ret;
    return {
      w: w,
      ret: ret > 0 && ret <= 1 ? ret : 0.9,
      max: p.max > 0 ? Math.floor(p.max) : 36500,
      ls: Array.isArray(p.ls) ? p.ls.filter(validStep) : [1, 10],
      rs: rs,
      fuzz: p.fuzz !== false
    };
  }
  function validStep(m) { return typeof m === "number" && isFinite(m) && m > 0 && m <= 1440 * 365; }

  function decayFactor(w) {
    var decay = -w[20];
    return { decay: decay, factor: round8(Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1) };
  }
  // Probability of recall after t days at stability s.
  function retrievability(w, t, s) {
    var df = decayFactor(w);
    return round8(Math.pow(1 + df.factor * t / s, df.decay));
  }
  function intervalModifier(P) {
    var df = decayFactor(P.w);
    return round8((Math.pow(P.ret, 1 / df.decay) - 1) / df.factor);
  }

  // ---------- Memory model ----------
  function initS(w, g) { return Math.max(w[g - 1], 0.1); }
  function initD(w, g) { return round8(w[4] - Math.exp((g - 1) * w[5]) + 1); }
  function nextD(w, d, g) {
    var delta = -w[6] * (g - 3);
    var nd = d + round8(delta * (10 - d) / 9);
    return clamp(round8(w[7] * initD(w, 4) + (1 - w[7]) * nd), 1, 10);
  }
  function recallS(w, d, s, r, g) {
    var hard = g === 2 ? w[15] : 1, easy = g === 4 ? w[16] : 1;
    return round8(clamp(s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) * hard * easy), S_MIN, 36500));
  }
  function forgetS(w, d, s, r) {
    return round8(clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) *
      Math.exp((1 - r) * w[14]), S_MIN, 36500));
  }
  function shortS(w, s, g) {
    var sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
    if (g >= 2) sinc = Math.max(sinc, 1);
    return round8(clamp(s * sinc, S_MIN, 36500));
  }
  // Next {d, s} after grade g, t days after the last answer.
  function nextDS(P, d, s, t, g, r) {
    var w = P.w;
    if (d === 0 && s === 0) return { d: clamp(initD(w, g), 1, 10), s: initS(w, g) };
    if (typeof r !== "number") r = retrievability(w, t, s);
    var ns;
    if (t === 0) ns = shortS(w, s, g);
    else if (g === 1) {
      var fail = forgetS(w, d, s, r);
      ns = clamp(round8(s / Math.exp(w[17] * w[18])), S_MIN, fail);
    } else ns = recallS(w, d, s, r, g);
    return { d: nextD(w, d, g), s: ns };
  }

  // ---------- Fuzz (Alea, seeded) ----------
  function mash() {
    var n = 4022871197;
    return function (data) {
      data = String(data);
      for (var i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        var h = 0.02519603282416938 * n;
        n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n; n += h * 4294967296;
      }
      return (n >>> 0) * 2.3283064365386963e-10;
    };
  }
  function alea(seed) {
    var m = mash(), c = 1, s0 = m(" "), s1 = m(" "), s2 = m(" ");
    s0 -= m(seed); if (s0 < 0) s0 += 1;
    s1 -= m(seed); if (s1 < 0) s1 += 1;
    s2 -= m(seed); if (s2 < 0) s2 += 1;
    var t = 2091639 * s0 + c * 2.3283064365386963e-10;
    return t - (t | 0);
  }
  var FUZZ = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]];
  function fuzzed(P, ivl, elapsed, seed) {
    if (!P.fuzz || ivl < 2.5) return Math.round(ivl);
    var delta = 1;
    FUZZ.forEach(function (f) { delta += f[2] * Math.max(Math.min(ivl, f[1]) - f[0], 0); });
    ivl = Math.min(ivl, P.max);
    var lo = Math.max(2, Math.round(ivl - delta)), hi = Math.min(Math.round(ivl + delta), P.max);
    if (ivl > elapsed) lo = Math.max(lo, elapsed + 1);
    lo = Math.min(lo, hi);
    return Math.floor(alea(seed) * (hi - lo + 1) + lo);
  }
  function nextIvl(P, s, elapsed, seed) {
    var ivl = Math.min(Math.max(1, Math.round(s * intervalModifier(P))), P.max);
    return fuzzed(P, ivl, elapsed, seed);
  }

  // ---------- Card ----------
  function newCard(now) {
    return { st: 0, s: 0, d: 0, step: 0, due: now || 0, last: 0, sd: 0, reps: 0, lapses: 0 };
  }
  function utcDays(a, b) {
    var x = new Date(a), y = new Date(b);
    return Math.floor((Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()) -
      Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())) / DAY);
  }

  // Learning steps for a card in state st at step `step`:
  // { g: {min, next} } for the grades that stay in (re)learning.
  function steps(P, st, step) {
    var list = st === 2 || st === 3 ? P.rs : P.ls, n = list.length, out = {};
    if (!n || step >= n) return out;
    var first = list[0];
    if (st === 2) { out[1] = { min: list[Math.max(0, step)], next: 0 }; return out; }
    out[1] = { min: first, next: 0 };
    out[2] = { min: n === 1 ? Math.round(first * 1.5) : Math.round((first + list[1]) / 2), next: step };
    if (step + 1 < n && list[step + 1]) out[3] = { min: Math.round(list[step + 1]), next: step + 1 };
    return out;
  }

  // The four possible next states of `card` answered at time `now`.
  // Returns { 1: card, 2: card, 3: card, 4: card }.
  function preview(card, now, p) {
    var P = p && p.w && p.ls ? p : params(p);
    var cur = Object.assign(newCard(now), card || {});
    var elapsed = cur.st !== 0 && cur.last ? utcDays(cur.last, now) : 0;
    var reps = cur.reps + 1;
    var seed = now + "_" + reps + "_" + (cur.d * cur.s);
    function base(ds) {
      return { st: cur.st, s: ds.s, d: ds.d, step: cur.step || 0, due: cur.due, last: now,
        sd: cur.sd, reps: reps, lapses: cur.lapses };
    }
    function learn(next, g, toSt) {
      var info = steps(P, cur.st, cur.step || 0)[g], min = info ? Math.max(0, info.min) : 0;
      var nx = info ? Math.max(0, info.next) : 0;
      if (min > 0 && min < 1440) {
        next.step = nx; next.sd = 0; next.st = toSt; next.due = now + Math.round(min) * MIN;
      } else {
        next.st = 2;
        if (min >= 1440) {
          next.step = nx; next.due = now + Math.round(min) * MIN; next.sd = Math.floor(min / 1440);
        } else {
          next.step = 0;
          var ivl = nextIvl(P, next.s, elapsed, seed);
          next.sd = ivl; next.due = now + ivl * DAY;
        }
      }
      return next;
    }
    var out = {};
    if (cur.st === 0 || cur.st === 1 || cur.st === 3) {
      [1, 2, 3, 4].forEach(function (g) {
        out[g] = learn(base(nextDS(P, cur.d, cur.s, elapsed, g)), g, cur.st === 0 ? 1 : cur.st);
      });
      return out;
    }
    var r = retrievability(P.w, elapsed, cur.s);
    var a = base(nextDS(P, cur.d, cur.s, elapsed, 1, r)), h = base(nextDS(P, cur.d, cur.s, elapsed, 2, r)),
        gd = base(nextDS(P, cur.d, cur.s, elapsed, 3, r)), e = base(nextDS(P, cur.d, cur.s, elapsed, 4, r));
    var hi = nextIvl(P, h.s, elapsed, seed), gi = nextIvl(P, gd.s, elapsed, seed);
    hi = Math.min(hi, gi); gi = Math.max(gi, hi + 1);
    var ei = Math.max(nextIvl(P, e.s, elapsed, seed), gi + 1);
    [[h, hi], [gd, gi], [e, ei]].forEach(function (x) {
      x[0].st = 2; x[0].step = 0; x[0].sd = x[1]; x[0].due = now + x[1] * DAY;
    });
    learn(a, 1, 3);
    a.lapses += 1;
    out[1] = a; out[2] = h; out[3] = gd; out[4] = e;
    return out;
  }
  function next(card, now, g, p) { return preview(card, now, p)[g]; }

  // Recall probability of a card right now (0-1), or null for a new card.
  function recall(card, now, p) {
    if (!card || !card.st || !card.s || !card.last) return null;
    var P = p && p.w && p.ls ? p : params(p);
    return retrievability(P.w, Math.max(0, (now - card.last) / DAY), card.s);
  }

  var API = {
    VERSION: "1.0.0", W: W.slice(), DAY: DAY, MIN: MIN,
    params: params, newCard: newCard, preview: preview, next: next, recall: recall,
    retrievability: retrievability, utcDays: utcDays
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.FlashcardsFsrs = API;
})(typeof window !== "undefined" ? window : globalThis);
