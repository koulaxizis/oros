// ============================================================
// orOS Chore Wheel — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-chores-data and the device-local "who am I"
// (oros-chores-prefs), and the wheels shared with a household from the
// mirror chores/house.js keeps (oros-chores-hh), never writes. Who has what is chores/core.js
// (dayRows), the same the app and the shell reminder use. Rows: the
// open chores of today's windows, and the ones that ended unfinished
// in the last 7 days (late, on the day their window closed). With a
// "me" on this device, only mine; otherwise everyone's, with names.
// Opens through the shell bridge __orosOpenChores(<day>).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-chores-data", HH_KEY = "oros-chores-hh";

  var PROVIDER = {
    id: "chores",
    keys: [KEY, "oros-chores-prefs", HH_KEY],
    collect: function (ctx) {
      var C = root.OrosChoresCore, raw = ctx.readJSON(KEY), wheels = [];
      if (!C) return [];
      if (raw && Array.isArray(raw.tasks) && raw.tasks.length) {
        wheels.push({ id: "", data: C.mergeChores(raw, raw, ctx.now), me: C.readPrefs(ctx.readJSON("oros-chores-prefs")).me });
      }
      // wheels shared with a household (chores/house.js mirror, BR-HH)
      var hh = ctx.readJSON(HH_KEY);
      (hh && Array.isArray(hh.wheels) ? hh.wheels : []).forEach(function (w) {
        if (w && w.data && typeof w.data === "object") {
          wheels.push({ id: String(w.id || ""), data: C.mergeChores(w.data, w.data, ctx.now), me: typeof w.me === "string" ? w.me : "" });
        }
      });
      var out = [];
      wheels.forEach(function (w) { out = out.concat(rowsOf(C, w, ctx)); });
      return out;
    },
    open: function (target, win) {
      var day = target && typeof target.day === "string" ? target.day : "today";
      if (typeof win.__orosOpenChores === "function") win.__orosOpenChores(day);
    }
  };
  function rowsOf(C, w, ctx) {
    var data = w.data, me = w.me;
    var mine = !!(me && C.memberById(data, me));
    var n = C.ymdToDn(ctx.today);
    var out = [];
    C.dayRows(C.makeCtx(data), n).forEach(function (r) {
      if (r.state !== 0) return;
      if (mine && r.who !== me) return;
      var mb = !mine && r.who ? C.memberById(data, r.who) : null;
      out.push({
        id: (w.id ? w.id + ":" : "") + r.o.key,
        due: r.late ? C.dnToYmd(r.o.b) : ctx.today,
        title: (r.task.icon ? r.task.icon + " " : "") + r.task.name,
        text: mb ? mb.name : "",
        kind: "task",
        target: { day: ctx.today }
      });
    });
    return out;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
