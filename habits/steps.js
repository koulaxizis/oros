// ============================================================
// orOS Habits — Steps row (read-only app feed, v1.0.0)
// A measurable "Auto" row in Habits fed by the steps the Health app
// already stores (oros-health-data, kind "st": typed in Health or
// brought from Health Connect by the orOS Android app). Generic
// window.orosHabitFeeds contract (see habits.js APP FEEDS), plus the
// measurable fields: vals {"YYYY-MM-DD": steps}, goal, unit.
// Read-only: never writes Health or Habits data. The row's on/off
// switch and the daily goal live in the Habits slice ("set": st, sg),
// so they follow the person to every device.
// Steps of a day = the highest reading of that day (Health keeps one
// per day; a typed reading next to the phone's one never doubles).
// Hidden in Health (the Steps kind switched off) → no row.
// ============================================================
(function (root) {
  "use strict";
  var HEALTH_KEY = "oros-health-data";
  var HABITS_KEY = "oros-habits-data";
  var DEF_GOAL = 8000;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdLocal(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // { "YYYY-MM-DD": steps } from Health data (tombstones honoured)
  function stepsByDay(health) {
    var out = {};
    if (!health || typeof health !== "object" || !Array.isArray(health.en)) return out;
    var tombs = health.tombs && typeof health.tombs === "object" ? health.tombs : {};
    health.en.forEach(function (e) {
      if (!e || e.t !== "st" || typeof e.id !== "string" || !Array.isArray(e.v)) return;
      if (!isInt(e.at) || !isInt(e.v[0]) || e.v[0] < 1 || e.v[0] > 200000) return;
      var tk = tombs["en:" + e.id];
      if (isInt(tk) && tk >= (isInt(e.m) ? e.m : 0)) return;
      var day = ymdLocal(e.at);
      if (!out[day] || e.v[0] > out[day]) out[day] = e.v[0];
    });
    return out;
  }
  function stepsHidden(health) {
    var ty = health && Array.isArray(health.ty) ? health.ty : [];
    for (var i = 0; i < ty.length; i++) if (ty[i] && ty[i].id === "st") return !!ty[i].h;
    return false;
  }
  function settings(habits) {
    var s = habits && habits.set && typeof habits.set === "object" ? habits.set : {};
    return { on: s.st !== 0, goal: isInt(s.sg) && s.sg >= 100 && s.sg <= 200000 ? s.sg : DEF_GOAL };
  }
  // null (no row) | { days, vals, goal, first }
  function feedFrom(health, habits) {
    var set = settings(habits);
    if (!set.on || stepsHidden(health)) return null;
    var vals = stepsByDay(health), keys = Object.keys(vals).sort();
    if (!keys.length) return null;
    var days = {};
    keys.forEach(function (k) { if (vals[k] >= set.goal) days[k] = true; });
    return { days: days, vals: vals, goal: set.goal, first: keys[0] };
  }

  var FOOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3c1.9 0 3 1.9 3 4.4 0 2.3-.8 3.6-.8 5.1H5.6c0-1.6-.9-2.7-.9-5C4.7 5 6.4 3 8.5 3z"/><path d="M5.7 15.2h5v1.3a2.5 2.5 0 0 1-5 0z"/><path d="M15.5 7c1.9 0 3.6 2 3.6 4.5 0 2.3-.9 3.4-.9 5h-5.1c0-1.5-.8-2.8-.8-5.1C12.3 8.9 13.6 7 15.5 7z"/><path d="M13.1 19.2h5v1.3a2.5 2.5 0 0 1-5 0z"/></svg>';
  // The row's texts (keys of the "habits" pack). The feed contract
  // takes { en, el } or a plain string: a pack language (German) gets
  // its pack line as a string, English and Greek the { en, el } pair.
  var S = {
    en: { "steps.name": "Steps", "steps.hint": "Steps from the Health app", "steps.unit": "steps" },
    el: { "steps.name": "Βήματα", "steps.hint": "Βήματα από την εφαρμογή Υγεία", "steps.unit": "βήματα" }
  };
  var I = typeof window !== "undefined" && window.orosI18n;
  var PACK = I && I.lang() !== "en" && I.lang() !== "el" ? I.table(S, "habits", I.lang()) : null;
  function txt(k) { return PACK ? PACK[k] : { en: S.en[k], el: S.el[k] }; }
  function readJSON(key) {
    try { return JSON.parse(root.localStorage.getItem(key)); } catch (e) { return null; }
  }
  var FEED = {
    id: "steps",
    app: "health",
    name: txt("steps.name"),
    hint: txt("steps.hint"),
    unit: txt("steps.unit"),
    color: "#87cf3e",
    icon: FOOT,
    keys: [HEALTH_KEY, HABITS_KEY],
    read: function () { return feedFrom(readJSON(HEALTH_KEY), readJSON(HABITS_KEY)); }
  };

  var API = { FEED: FEED, stepsByDay: stepsByDay, feedFrom: feedFrom, DEF_GOAL: DEF_GOAL };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) {
    root.OrosHabitsSteps = API;
    var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
    for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) return;
    feeds.push(FEED);
  }
})(typeof window !== "undefined" ? window : globalThis);
