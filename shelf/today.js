// ============================================================
// orOS Media Shelf — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-shelf-data, never writes. Release days of
// wish-list titles come from shelf/feed.js (byDay, label), the same
// the Calendar feed uses. (The reading reminder keeps its own
// evening notice.) Opens the title through the generic deep link
// (Shelf's own __orosOpenAt: { item }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-shelf-data";

  var PROVIDER = {
    id: "shelf",
    keys: [KEY],
    collect: function (ctx) {
      var F = root.OrosShelfFeed, raw = ctx.readJSON(KEY);
      if (!F || !raw) return [];
      var days = F.byDay(raw), out = [];
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        (days[day] || []).forEach(function (r) {
          if (r.k !== "r") return;                 // finished titles are history, not plans
          out.push({ id: "r:" + r.item, due: day, kind: "event", title: F.label("r", r.title, ctx.lang),
                     target: { item: r.item } });
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
