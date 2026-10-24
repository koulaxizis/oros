// ============================================================
// orOS Together — Today provider
// Loaded by the shell (today/host.js) through apps.json "today"
// (after together/core.js). Read-only: reads oros-together-data and
// the names of linked people from oros-contacts-data, never writes.
// The rows are the Calendar feed's (TogetherCore.dayRows: milestones
// incl. months, the start day, moments and special days marked every
// year, meetings), plus one top line "names · n days together"
// (TogetherCore.todayLine) that the Today widget "Together" shows as a
// card. Together is private: Today keeps it off until the
// person switches it on (today/agg.js DEFAULT_OFF).
// Opens through the generic deep link (Together's __orosOpenAt).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-together-data";

  var PROVIDER = {
    id: "together",
    keys: [KEY, "oros-contacts-data"],
    collect: function (ctx) {
      var C = root.TogetherCore;
      if (!C) return [];
      var raw = ctx.readJSON(KEY);
      if (!raw || !Array.isArray(raw.rels) || !raw.rels.length) return [];
      var data = C.normalize(raw), idx = C.contactIndex(ctx.readJSON("oros-contacts-data"));
      var out = [], line = C.todayLine(data, idx, ctx.today, ctx.lang);
      // The "Together" card (Today widget): one top line, today only.
      if (line) out.push({ id: "days", kind: "info", title: line.title, text: line.text, target: line.target });
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        C.dayRows(data, idx, day, ctx.lang, { months: true }).forEach(function (r) {
          out.push({ id: r.id + "-" + day, due: day, time: r.time || null, kind: "event", title: r.title, target: r.target });
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
