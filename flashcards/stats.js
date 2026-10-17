// ============================================================
// orOS Flashcards — progress numbers (FlashcardsStats)
// Everything is worked out from the answers (the same replay as the
// schedule, core.schedule with onAnswer), for all decks or one deck
// and the decks inside it:
//   - today: answers, cards, "Again" presses, minutes;
//   - a year of study days (heatmap) and the streak;
//   - answers per day for the last 30 days (learning vs review);
//   - true retention: of the answers to cards that were in review,
//     how many were not "Again" (last 30 days, and all time);
//   - forecast: reviews falling due on each of the next 30 days;
//   - intervals and difficulty spread of the cards in review;
//   - card counts: new, learning, young (< 21 days), mature,
//     suspended.
// Pure: no DOM, no storage. window.FlashcardsStats / module.exports.
// ============================================================
(function (root) {
  "use strict";
  var DAY = 86400000;
  var IVL = [[1, "1d"], [3, "2-3d"], [7, "4-7d"], [14, "1-2w"], [30, "2-4w"], [90, "1-3m"], [180, "3-6m"], [365, "6-12m"], [Infinity, "1y+"]];
  var MATURE = 21;

  function compute(C, F, data, notesMap, reviews, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), d = C.normalize(data), ro = d.set.ro;
    var ids = opts.deckId ? C.subtree(d, opts.deckId) : null;
    function inScope(c) { return !ids || !!ids[c.deck]; }
    var start = C.dayStart(now, ro);
    function dayKey(t) { return C.ymdOf(C.dayStart(t, ro)); }
    var todayKey = C.ymdOf(start);
    var byDay = {}, ret30 = { n: 0, ok: 0 }, retAll = { n: 0, ok: 0 }, msSum = 0, msN = 0;
    var from30 = start - 29 * DAY;
    var sched = C.schedule(d, notesMap, reviews, F, {
      onAnswer: function (r, before, c) {
        if (!inScope(c)) return;
        var k = dayKey(r.t), b = byDay[k] || (byDay[k] = { n: 0, again: 0, ms: 0, learn: 0, rev: 0, cards: {} });
        b.n++;
        b.cards[r.c] = 1;
        if (r.g === 1) b.again++;
        if (r.ms) { b.ms += r.ms; msSum += r.ms; msN++; }
        if (before.st === 2) {
          b.rev++;
          retAll.n++; if (r.g > 1) retAll.ok++;
          if (r.t >= from30) { ret30.n++; if (r.g > 1) ret30.ok++; }
        } else b.learn++;
      }
    });
    // Days: the last 365 (oldest first), the last 30 with their split.
    function dayAt(i) { return C.ymdOf(C.dayStart(start - i * DAY + DAY / 2, ro)); }
    var heat = [], per = [], max = 0;
    for (var i = 364; i >= 0; i--) {
      var k = i === 0 ? todayKey : dayAt(i), b = byDay[k];
      heat.push({ day: k, n: b ? b.n : 0 });
      if (b && b.n > max) max = b.n;
      if (i < 30) per.push({ day: k, learn: b ? b.learn : 0, rev: b ? b.rev : 0 });
    }
    var streak = 0;
    for (var j = heat.length - 1; j >= 0; j--) {
      if (heat[j].n) streak++;
      else if (j === heat.length - 1) continue;   // today not studied yet: the streak runs to yesterday
      else break;
    }
    var tb = byDay[todayKey];
    var today = { n: tb ? tb.n : 0, cards: tb ? Object.keys(tb.cards).length : 0, again: tb ? tb.again : 0, ms: tb ? tb.ms : 0 };
    // Cards as they are now.
    var counts = { fresh: 0, learn: 0, young: 0, mature: 0, sus: 0 };
    var fc = [], ivl = IVL.map(function (x) { return { label: x[1], n: 0 }; }), diff = [];
    for (var f = 0; f < 30; f++) fc.push({ day: f === 0 ? todayKey : C.ymdOf(C.dayStart(start + f * DAY + DAY / 2, ro)), n: 0 });
    for (var q = 0; q < 10; q++) diff.push({ label: String(q + 1), n: 0 });
    var end = C.dayEnd(now, ro);
    Object.keys(sched).forEach(function (key) {
      var c = sched[key];
      if (!inScope(c)) return;
      if (c.sus) { counts.sus++; return; }
      var st = c.card.st;
      if (!st) { counts.fresh++; return; }
      if (st === 1 || st === 3) counts.learn++;
      else {
        var days = Math.max(1, Math.round((c.card.due - c.card.last) / DAY));
        if (days >= MATURE) counts.mature++; else counts.young++;
        for (var b = 0; b < IVL.length; b++) if (days <= IVL[b][0]) { ivl[b].n++; break; }
      }
      if (c.card.d) diff[Math.min(9, Math.max(0, Math.round(c.card.d) - 1))].n++;
      var at = c.card.due < end ? 0 : Math.floor((C.dayStart(c.card.due, ro) - start) / DAY + 0.5);
      if (at >= 0 && at < 30) fc[at].n++;
    });
    return {
      today: today, streak: streak, heat: heat, heatMax: max, perDay: per,
      retention: { d30: ret30, all: retAll }, forecast: fc, intervals: ivl, difficulty: diff,
      counts: counts, avgMs: msN ? Math.round(msSum / msN) : 0,
      total: Object.keys(byDay).reduce(function (s, k) { return s + byDay[k].n; }, 0)
    };
  }
  function pct(r) { return r && r.n ? Math.round(r.ok / r.n * 1000) / 10 : null; }

  var API = { compute: compute, pct: pct, MATURE: MATURE };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsStats = API;
})(typeof window !== "undefined" ? window : globalThis);
