// ============================================================
// orOS Meal Planner — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-meals-data, never writes.
// Hits:
//   • a stored recipe (rc[]: the user's own and ready ones they
//     edited): its title; tags, ingredients, notes, steps and
//     source as text
//   • a free-text item in the week plan ("Pizza at Mum's"): its
//     text; the date shown is its day
// Ready recipes that were never edited are built-in text, not the
// user's, and are not searched; nor are shopping ticks or manual
// shopping items (short-lived). Deleted recipes leave rc[] (a
// tombstone in tombs{}); one whose tombstone is at or after its m
// is skipped too, the way the merge hides it.
// Opens through the generic deep link: target { recipe } (Recipes
// tab + the recipe) or { day } (Week tab, the week of that day).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-meals-data";
  var CELL = /^(\d{4})-(\d{2})-(\d{2})\|[a-z]$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "meals",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || typeof d !== "object") return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      arr(d.rc).forEach(function (r) {
        if (!r || typeof r.id !== "string") return;
        if (typeof tombs[r.id] === "number" && tombs[r.id] >= (Number(r.m) || 0)) return;
        var ings = arr(r.ig).map(function (i) {
          return i ? [str(i.n), str(i.x)].filter(Boolean).join(" ") : "";
        }).filter(Boolean).join(", ");
        out.push({
          id: r.id,
          title: str(r.t) || (el ? "Συνταγή χωρίς τίτλο" : "Untitled recipe"),
          text: [arr(r.tg).map(str).filter(Boolean).join(", "), ings, str(r.no),
                 arr(r.st).map(str).filter(Boolean).join(" "), str(r.src)]
            .filter(Boolean).join(" · "),
          target: { recipe: r.id }
        });
      });
      var pl = d.pl && typeof d.pl === "object" ? d.pl : {};
      Object.keys(pl).forEach(function (k) {
        var m = CELL.exec(k), c = pl[k];
        if (!m || !c || typeof c !== "object") return;
        var day = k.slice(0, 10);
        arr(c.it).forEach(function (it, i) {
          var tx = it && typeof it.r !== "string" ? str(it.t) : "";
          if (!tx) return;
          out.push({
            id: k + "#" + i,
            title: tx,
            when: new Date(+m[1], +m[2] - 1, +m[3], 12).getTime(),
            target: { day: day }
          });
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
