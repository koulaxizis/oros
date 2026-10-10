// ============================================================
// orOS Characters — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-characters-data, never writes.
// One hit per character (name; role, biography, traits and goals as
// text) and one per relationship ("A ↔ B"; its label, type and
// description as text). The date is the last edit. Skipped: records
// covered by a tombstone (deleted[id] >= mtime: alive means newer
// than the tombstone, as the merge), relationships whose characters
// are gone. A delete normally removes the record from the maps too.
// Opens through the generic deep link: target { char } or { rel }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-characters-data";
  var REL = {
    en: { friend: "Friend", family: "Family", lover: "Lover", rival: "Rival",
          enemy: "Enemy", mentor: "Mentor", ally: "Ally", other: "Other" },
    el: { friend: "Φίλος/η", family: "Οικογένεια", lover: "Ερωτική", rival: "Αντίζηλος/η",
          enemy: "Εχθρός/η", mentor: "Μέντορας", ally: "Σύμμαχος/η", other: "Άλλο" }
  };

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  // characters / rels are maps by id (an older shape used arrays).
  function rows(o) {
    if (Array.isArray(o)) return o;
    return o && typeof o === "object" ? Object.keys(o).map(function (k) { return o[k]; }) : [];
  }

  var PROVIDER = {
    id: "characters",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      function alive(x) {
        var t = Object.prototype.hasOwnProperty.call(tomb, x.id) ? Number(tomb[x.id]) || 0 : 0;
        return !t || (Number(x.mtime) || 0) > t;
      }
      var el = ctx.lang === "el", labels = el ? REL.el : REL.en;
      var unnamed = el ? "Χωρίς όνομα" : "Unnamed";
      var names = {};
      rows(d.characters).forEach(function (c) {
        if (!c || typeof c.id !== "string" || !c.id || !alive(c)) return;
        var name = str(c.name);
        names[c.id] = name || unnamed;
        out.push({
          id: c.id,
          title: name || unnamed,
          text: [str(c.role), str(c.bio),
                 arr(c.traits).map(function (x) { return x ? str(x.name) : ""; }).filter(Boolean).join(", "),
                 arr(c.goals).map(function (g) { return g ? str(g.text) : ""; }).filter(Boolean).join(" · ")]
            .filter(Boolean).join(" · "),
          when: typeof c.mtime === "number" ? c.mtime : 0,
          target: { char: c.id }
        });
      });
      rows(d.rels).forEach(function (r) {
        if (!r || typeof r.id !== "string" || !r.id || !alive(r)) return;
        if (!names[r.a] || !names[r.b] || r.a === r.b) return;
        out.push({
          id: r.id,
          title: names[r.a] + " ↔ " + names[r.b],
          text: [str(r.text), labels[r.type] || labels.other, str(r.desc)].filter(Boolean).join(" · "),
          when: typeof r.mtime === "number" ? r.mtime : 0,
          target: { rel: r.id }
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
