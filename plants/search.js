// ============================================================
// orOS Plant Care — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-plants-data, never writes.
// One hit per plant: its name, and as text the room, the species
// (ready-species name when OrosPlantsCore is loaded, as it is in
// the shell), "outdoors" and the notes. The care log holds no user
// text and is not searched. Deleted plants leave plants[] (their
// tombstone lives in tombs{}); a plant whose tombstone is at or
// after its m is skipped as well, the way the merge hides it.
// Opens through the existing Plant Care bridge (__orosOpenPlants):
// target = the plant id (Plants tab + its details).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-plants-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function species(sp, lang) {
    var core = root && root.OrosPlantsCore;
    var pr = sp && core && core.PRESETS && Object.prototype.hasOwnProperty.call(core.PRESETS, sp)
      ? core.PRESETS[sp] : null;
    var pair = pr && (lang === "el" ? pr.el : pr.en);
    return pair && typeof pair[0] === "string" ? pair[0] : "";
  }

  var PROVIDER = {
    id: "plants",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.plants)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.plants.forEach(function (p) {
        if (!p || typeof p.id !== "string") return;
        if (typeof tombs[p.id] === "number" && tombs[p.id] >= (Number(p.m) || 0)) return;
        var name = str(p.name) || (ctx.lang === "el" ? "Φυτό χωρίς όνομα" : "Unnamed plant");
        out.push({
          id: p.id,
          title: name,
          text: [str(p.room), species(p.sp, ctx.lang),
                 p.out === 1 ? (ctx.lang === "el" ? "Εξωτερικό" : "Outdoors") : "",
                 str(p.notes)].filter(Boolean).join(" · "),
          target: p.id
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && win && typeof win.__orosOpenPlants === "function") {
        win.__orosOpenPlants(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("plants", null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
