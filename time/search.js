// ============================================================
// orOS Time — universal search provider (v1.0.0, Stage wave 4)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-time-stage, never writes.
// One hit per Stage event (name; date, start and venue as text) and
// one per rundown item (title; speaker and the event as text).
// Deleted events and items are not in the stored lists (the merge
// drops tombstoned entries); items of an event that is gone are
// skipped. Opens the Stage tab on the event, scrolled to the item,
// through the shell's deep link (__orosOpenAt("time", {stage}),
// received by time/stage.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-time-stage";
  var ID = /^[a-z0-9]{4,24}$/;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var HM = /^\d{2}:\d{2}$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function when(ev) {
    if (!YMD.test(str(ev.date))) return typeof ev.mtime === "number" ? ev.mtime : undefined;
    var p = ev.date.split("-"), hm = HM.test(str(ev.start)) ? ev.start.split(":") : [9, 0];
    return new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1]).getTime();
  }

  var PROVIDER = {
    id: "time",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], evs = {};
      if (!d || !Array.isArray(d.events)) return out;
      d.events.forEach(function (ev) {
        if (!ev || typeof ev.id !== "string" || !ID.test(ev.id)) return;
        evs[ev.id] = ev;
        out.push({
          id: "e:" + ev.id,
          title: str(ev.name),
          text: [str(ev.date), HM.test(str(ev.start)) ? ev.start : ""].filter(Boolean).join(" · "),
          when: when(ev),
          target: { stage: { ev: ev.id } }
        });
      });
      (Array.isArray(d.items) ? d.items : []).slice(0, 5000).forEach(function (it) {
        if (!it || typeof it.id !== "string" || !ID.test(it.id) || !evs[it.ev]) return;
        var ev = evs[it.ev];
        out.push({
          id: "i:" + it.id,
          title: str(it.title),
          text: [str(it.speaker), str(ev.name), str(it.notes)].filter(Boolean).join(" · "),
          when: when(ev),
          target: { stage: { ev: ev.id, it: it.id } }
        });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
