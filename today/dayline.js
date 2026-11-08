// ============================================================
// orOS Today — the shape of the day (T3, BR-TODAY-17)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the Today app draws what this
// decides; node tests require it (tests/today-dayline.test.js).
//   - shape(groups, now) → { items, gaps, fit }: today's rows with a
//     time in order (an end of their own, else an hour for an event
//     and half an hour for a task), the free stretches of 30 minutes
//     or more between them from now (not before 08:00) to 22:00, and
//     how many of today's and late tasks have no time and could go
//     into one. A suggestion only: nothing is moved.
//   - evening(now, eve) → true from the evening hour (Today settings,
//     0 = off) to midnight: the summary then shows tomorrow on top.
// Exposed as window.OrosTodayDay (module.exports in node).
// ============================================================
(function (root) {
  "use strict";

  var DAY_FROM = 8 * 60, DAY_TO = 22 * 60, MIN_GAP = 30, EVENT_MIN = 60, TASK_MIN = 30;
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  function mins(hm) { var m = HM_RE.exec(hm || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(n) { n = Math.max(0, Math.min(24 * 60 - 1, n)); return pad(Math.floor(n / 60)) + ":" + pad(n % 60); }

  function shape(groups, now) {
    var g = groups && typeof groups === "object" ? groups : {};
    var todays = Array.isArray(g.today) ? g.today : [], overdue = Array.isArray(g.overdue) ? g.overdue : [];
    var d = new Date(typeof now === "number" ? now : Date.now());
    var nowM = d.getHours() * 60 + d.getMinutes();
    var items = [];
    todays.forEach(function (r) {
      var s = mins(r && r.time);
      if (s === null) return;
      var e = mins(r.end);
      if (e === null || e <= s) e = Math.min(24 * 60 - 1, s + (r.kind === "event" ? EVENT_MIN : TASK_MIN));
      items.push({ from: s, to: e, row: r });
    });
    items.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    var gaps = [], at = Math.max(DAY_FROM, Math.ceil(nowM / 5) * 5);
    function gap(a, b) { if (b - a >= MIN_GAP) gaps.push({ from: hm(a), to: hm(b), min: b - a }); }
    items.forEach(function (it) {
      if (it.from >= DAY_TO) return;
      if (it.from > at) gap(at, it.from);
      at = Math.max(at, it.to);
    });
    if (at < DAY_TO) gap(at, DAY_TO);
    var fit = overdue.concat(todays).filter(function (r) { return r && r.kind === "task" && !r.time; }).length;
    return {
      items: items.map(function (it) { return { from: hm(it.from), to: hm(it.to), row: it.row }; }),
      gaps: gaps,
      fit: fit
    };
  }

  function evening(now, eve) {
    if (typeof eve !== "number" || !eve) return false;
    return new Date(typeof now === "number" ? now : Date.now()).getHours() >= eve;
  }

  var api = { DAY_FROM: DAY_FROM, DAY_TO: DAY_TO, MIN_GAP: MIN_GAP, shape: shape, evening: evening };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodayDay = api;
})(typeof window !== "undefined" ? window : globalThis);
