// ============================================================
// orOS Habits — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after habits/core.js. Read-only: reads oros-habits-data, never
// writes. One row per habit scheduled for today and not done yet
// (OrosHabitsCore.dueOn, the app's own rule): fixed weekdays on their
// days, "X times per week / month" while the period's count is not
// met; skipped days stay out. Flexible habits (no weekdays) are never
// "due", so they stay out. A measurable habit shows today's value and
// target in its title ("Read · 4 / 10 pages"). Past days are not
// shown: a missed habit is not a late task. Opens Habits on the
// current period (__orosOpenHabits(0)), where the habit is ticked.
// 1.1.0 (BR-TODAY-15): the streak in the details, a tip to keep it,
// and "Tick it" through Habits' receiver { tick: { id, name } }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-habits-data";

  var W = {
    en: { "hb.streak.d": "Streak: {n} days", "hb.streak.w": "Streak: {n} weeks", "hb.streak.m": "Streak: {n} months",
          "hb.tipKeep": "{n} in a row: one more today keeps the streak going.",
          "hb.tipBest": "Your best run was {n}: today is a good day to start a new one." },
    el: { "hb.streak.d": "Σερί: {n} μέρες", "hb.streak.w": "Σερί: {n} εβδομάδες", "hb.streak.m": "Σερί: {n} μήνες",
          "hb.tipKeep": "{n} στη σειρά: άλλη μία σήμερα και το σερί συνεχίζεται.",
          "hb.tipBest": "Το καλύτερό σου σερί ήταν {n}: σήμερα είναι καλή μέρα για ένα νέο." }
  };
  function words(lang) {
    var I = root.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "habits", lang);
    return W[lang] || W.en;
  }

  var PROVIDER = {
    id: "habits",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosHabitsCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var ix = C.index(raw), w = words(ctx.lang);
      return C.dueOn(ix, ctx.today).map(function (h) {
        var title = h.name;
        if (C.isNum(h)) {
          var v = C.valueOn(ix, h.id, ctx.today);
          title += " · " + (h.num.c === "le" ? "≤ " : "") + (v === null ? 0 : v) + " / " + h.num.t + (h.num.u ? " " + h.num.u : "");
        }
        // Details (BR-TODAY-15): the running streak; "Tick it" goes
        // to Habits' own receiver { tick: { id, name } } (a number
        // habit opens its day there).
        var more = [], tip = "", st = null;
        try { st = typeof C.streaks === "function" ? C.streaks(ix, h, ctx.today) : null; } catch (e) { st = null; }
        if (st && st.cur > 0) more.push(w["hb.streak." + (W.en["hb.streak." + st.unit] ? st.unit : "d")].replace("{n}", st.cur));
        if (st && st.cur >= 3) tip = w["hb.tipKeep"].replace("{n}", st.cur);
        if (st && st.best > st.cur && st.best >= 3 && !tip) tip = w["hb.tipBest"].replace("{n}", st.best);
        return {
          id: h.id,
          due: ctx.today,
          title: title,
          kind: "task",
          target: { habit: h.id },
          more: more, tip: tip,
          acts: [{ k: "tick", target: { tick: { id: h.id, name: String(h.name || "").slice(0, 200) } } }]
        };
      });
    },
    open: function (target, win) {
      if (typeof win.__orosOpenHabits === "function") win.__orosOpenHabits(0);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
