// ============================================================
// orOS Moon & Sky — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after sky/core.js. Reads nothing stored and never writes: the sky
// is computed (OrosSkyCore.feedFor, the same events as the Calendar's
// Moon & Sky feed): main moon phases, supermoons, equinoxes and
// solstices, meteor shower peaks, eclipses. Today's ones are top
// lines; the next days' are events on their day, with the time when
// the moment is exact. Opens Moon & Sky on that date (__orosOpenAt:
// { date }).
// ============================================================
(function (root) {
  "use strict";
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var PROVIDER = {
    id: "sky",
    keys: [],
    collect: function (ctx) {
      var S = root.OrosSkyCore;
      if (!S || typeof S.feedFor !== "function") return [];
      var out = [];
      for (var i = 0; i <= ctx.horizon; i++) {
        var day = ctx.addDays(ctx.today, i);
        S.feedFor(day, ctx.lang === "el" ? "el" : "en").forEach(function (e, k) {
          var d = new Date(e.t), hm = e.allDay ? null : pad2(d.getHours()) + ":" + pad2(d.getMinutes());
          out.push({ id: day + ":" + e.kind + ":" + k, due: day, kind: i === 0 ? "info" : "event",
                     time: hm, title: e.title, text: i === 0 && hm ? hm : "", target: { date: day } });
        });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
