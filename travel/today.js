// ============================================================
// orOS Travel — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-travel-data, never writes. The rows are
// travel/core.js (trips, feedRows), the same the Calendar feed reads.
// Today: the trip day you are on ("Rome · day 2/5") and the timed
// itinerary entries (flight, train…). Next days: departures (a trip's
// first day) and timed entries. Opens the trip through the generic
// deep link (Travel's own __orosOpenAt: { trip, tab }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-travel-data";
  var W = { en: { day: "{name} · day {n}/{of}" }, el: { day: "{name} · μέρα {n}/{of}" } };

  var PROVIDER = {
    id: "travel",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosTravelCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var w = W[ctx.lang] || W.en, last = ctx.addDays(ctx.today, ctx.horizon), out = [], names = {};
      var trips = C.trips(raw);
      trips.forEach(function (t) { names[t.id] = C.label(t) || ""; });
      C.feedRows(trips).forEach(function (r) {
        if (r.day < ctx.today || r.day > last) return;
        if (r.kind === "trip") {
          if (r.day !== ctx.today && r.n !== 1) return;     // later days: departures only
          out.push({
            id: r.key, due: r.day, kind: "event",
            title: r.of > 1 ? w.day.replace("{name}", r.name).replace("{n}", r.n).replace("{of}", r.of) : r.name,
            target: { trip: r.trip, tab: "" }
          });
        } else {
          out.push({
            id: r.key, due: r.day, time: r.start, kind: "event",
            title: C.entryTitle(r.entry, ctx.lang),
            text: names[r.trip] || "",
            target: { trip: r.trip, tab: "plan" }
          });
        }
      });
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
