// ============================================================
// orOS Baby — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-baby-data and the device-local reminder
// settings (oros-baby-rem), never writes. Rows come from
// baby/core.js: calendarRows (milestones, vaccines, doctor visits
// on their day; "N months old today" as a top line) and reminderDue
// (the daily medicine time, unless it was already logged, the same
// rule as the shell reminder). Baby is a sensitive app: the
// Assistant button follows the Assistant's own permission.
// Opens through the generic deep link (Baby's __orosOpenAt: { kid, mk }).
// ============================================================
(function (root) {
  "use strict";
  // Same key and English as baby.js (one "baby" pack).
  var W = { en: { "t.med": "Medicine" }, el: { "t.med": "Φάρμακο" } };
  function medWord(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "baby", lang);
    return (W[lang] || W.en)["t.med"];
  }

  var PROVIDER = {
    id: "baby",
    keys: ["oros-baby-data", "oros-baby-rem"],
    collect: function (ctx) {
      var C = root.orosBabyCore;
      if (!C) return [];
      var data = C.parse(ctx.readRaw(C.STORAGE_KEY));
      if (!data || !C.liveKids(data).length) return [];
      var out = [];
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        C.calendarRows(data, day, ctx.lang).forEach(function (r) {
          if (r.kind === "age" && d > 0) return;
          var target = { kid: r.kid };
          if (r.kind !== "age") target.mk = r.id;
          out.push({ id: r.id, due: day, kind: r.kind === "age" ? "info" : "event", title: r.title, target: target });
        });
      }
      var rem = C.readRem(ctx.readJSON("oros-baby-rem"));
      if (rem.med) {
        var at = C.keyDate(ctx.today);
        at.setHours(+rem.med.slice(0, 2), +rem.med.slice(3, 5), 0, 0);
        var due = C.reminderDue(data, { med: rem.med, mt: rem.mt }, Math.max(ctx.now, at.getTime()));
        due.forEach(function (x) {
          if (x.kind !== "med") return;
          out.push({ id: x.key, due: ctx.today, time: rem.med, kind: "task", title: rem.mt || medWord(ctx.lang),
                     target: { kid: C.liveKids(data)[0].id } });
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
