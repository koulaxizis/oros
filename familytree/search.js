// ============================================================
// orOS Family Tree — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-familytree-data, never writes.
// One hit per person: the shown name (given + family); birth name,
// the years (birth–death), birth and death places, note and the
// tree's name as text. Photos are never read into a hit. Unions
// hold no text of their own. Deleted people and trees: a tombstone
// in tombs{} at or after the row's m hides it (as the merge does),
// and people of a missing / deleted tree are skipped.
// Opens through the generic deep link: target { tree, person }
// (switches to the tree, focuses and selects the person).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-familytree-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function ev(e) { return e && typeof e === "object" ? e : {}; }
  function year(e) {
    var d = str(ev(e).d);
    return /^\d{4}/.test(d) ? d.slice(0, 4) : "";
  }

  var PROVIDER = {
    id: "familytree",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || !Array.isArray(d.people)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0));
      }
      var trees = {};
      arr(d.trees).forEach(function (tr) { if (!gone(tr)) trees[tr.id] = str(tr.name); });
      d.people.forEach(function (p) {
        if (gone(p) || typeof p.tree !== "string" || !(p.tree in trees)) return;
        var name = [str(p.given), str(p.family)].filter(Boolean).join(" ") ||
                   (el ? "(χωρίς όνομα)" : "(no name)");
        var by = year(p.birth), dy = year(p.death);
        out.push({
          id: p.id,
          title: name,
          text: [str(p.birthName), by || dy ? by + "–" + dy : "",
                 str(ev(p.birth).place), str(ev(p.death).place), str(p.note), trees[p.tree]]
            .filter(Boolean).join(" · "),
          target: { tree: p.tree, person: p.id }
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
