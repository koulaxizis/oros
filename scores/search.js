// ============================================================
// orOS Score Keeper — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-scores-data, never writes.
// One hit per match (open or finished): its name as the title; the
// players / teams as text. The date is the day it finished, else
// the day it started. Templates and the player list are settings,
// not searched. Skipped: matches covered by a tombstone
// (tombs[id] >= m, as mergeScores); a delete removes them anyway.
// Opens through the generic deep link: target { match }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-scores-data";

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  var PROVIDER = {
    id: "scores",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.matches)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.matches.forEach(function (mt) {
        if (!mt || typeof mt.id !== "string") return;
        if (Object.prototype.hasOwnProperty.call(tombs, mt.id) && num(tombs[mt.id]) >= num(mt.m)) return;
        var name = str(mt.name);
        if (!name) return;
        out.push({
          id: mt.id,
          title: name,
          text: (Array.isArray(mt.seats) ? mt.seats : []).map(str).filter(Boolean).join(" · "),
          when: num(mt.done) || num(mt.c) || num(mt.m),
          target: { match: mt.id }
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
