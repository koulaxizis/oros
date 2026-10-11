// ============================================================
// orOS Habits — core.js (shared schedule rules, v1.0.0)
// One copy of "is this habit due on this day, and was it done", read
// by every page that needs it:
//   - the Habits app (habits/index.html loads it before habits.js)
//   - the Calendar's Habits feed (calendar/index.html)
//   - the Today summary (habits/today.js, through apps.json "today")
//   - the tests (tests/today-wave3.test.js, through module.exports)
// Pure functions, no DOM, no storage, no language. Read-only.
//
// API (window.OrosHabitsCore):
//   schedIdx(ymd)             weekday 0..6, MONDAY = 0 (schedule space)
//   isScheduledOn(habit, ymd) habit.days holds that weekday; an empty
//                             days list is "flexible" = never scheduled
//   isDone(data, habitId, ymd) a completion "<habitId>|<ymd>" exists
//                             and is not a tombstone
//   living(data)              habits that are not deleted
//   dueOn(data, ymd)          living habits scheduled that day and not
//                             done yet, in the app's order
// Data (synced slice "habits", key oros-habits-data):
//   { ver, habits: [{ id, name, icon, color, days: [0..6], mtime, del }],
//     comps: [{ id: "<habitId>|<ymd>", habitId, date, mtime, del }] }
// ============================================================
(function (root) {
  "use strict";
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function schedIdx(ymd) {
    var m = YMD_RE.exec(String(ymd || ""));
    if (!m) return -1;
    var day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();   // 0 = Sunday
    return (day + 6) % 7;
  }
  function isScheduledOn(habit, ymd) {
    if (!habit || !Array.isArray(habit.days) || !habit.days.length) return false;   // flexible ≠ scheduled
    return habit.days.indexOf(schedIdx(ymd)) !== -1;
  }
  function isDone(data, habitId, ymd) {
    var comps = data && Array.isArray(data.comps) ? data.comps : [];
    var key = habitId + "|" + ymd;
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      if (c && c.id === key) return !c.del;
    }
    return false;
  }
  function living(data) {
    var list = data && Array.isArray(data.habits) ? data.habits : [];
    return list.filter(function (h) {
      return h && !h.del && typeof h.id === "string" && h.id && typeof h.name === "string" && h.name;
    });
  }
  function dueOn(data, ymd) {
    if (!YMD_RE.test(String(ymd || ""))) return [];
    return living(data).filter(function (h) { return isScheduledOn(h, ymd) && !isDone(data, h.id, ymd); });
  }

  var API = { schedIdx: schedIdx, isScheduledOn: isScheduledOn, isDone: isDone, living: living, dueOn: dueOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosHabitsCore = API;
})(typeof window !== "undefined" ? window : globalThis);
