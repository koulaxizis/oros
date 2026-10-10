// ============================================================
// orOS Split — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-split-data, never writes.
// Hits: one per group (name; its people as text) and one per
// expense (title, or its category when untitled; note, who paid and
// the group as text; the date shown is the expense's day). Payments
// carry no text and are not searched. Archived (settled) groups and
// their expenses are skipped; so is anything a tombstone in tombs{}
// ("grp:" / "exp:") covers, and children of a group that is gone.
// Opens through the generic deep link: target { group, exp? }
// (receiver in split.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-split-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var CAT = {
    en: { food: "Food & drinks", groc: "Groceries", stay: "Accommodation", trans: "Transport",
          bills: "Bills & rent", fun: "Activities", other: "Other" },
    el: { food: "Φαγητό & ποτό", groc: "Σούπερ μάρκετ", stay: "Διαμονή", trans: "Μεταφορές",
          bills: "Λογαριασμοί & ενοίκιο", fun: "Δραστηριότητες", other: "Άλλα" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function groupOf(id) { var i = id.indexOf("."); return i < 0 ? id : id.slice(0, i); }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }

  var PROVIDER = {
    id: "split",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.groups)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var cats = CAT[ctx.lang === "el" ? "el" : "en"];
      function dead(kind, x) {
        var ts = tombs[kind + ":" + x.id];
        return typeof ts === "number" && ts >= (Number(x.m) || 0);
      }
      var groups = {}, people = {}, names = {};
      d.groups.forEach(function (g) {
        if (!g || typeof g.id !== "string" || g.arch || dead("grp", g)) return;
        groups[g.id] = g;
      });
      arr(d.people).forEach(function (p) {
        if (!p || typeof p.id !== "string" || dead("per", p)) return;
        var gid = groupOf(p.id);
        if (!groups[gid]) return;
        people[p.id] = str(p.n);
        (names[gid] = names[gid] || []).push(str(p.n));
      });
      Object.keys(groups).forEach(function (gid) {
        var g = groups[gid];
        out.push({
          id: "g:" + gid,
          title: str(g.n) || (ctx.lang === "el" ? "Ομάδα χωρίς όνομα" : "Unnamed group"),
          text: (names[gid] || []).filter(Boolean).join(" · "),
          when: typeof g.m === "number" ? g.m : 0,
          target: { group: gid }
        });
      });
      arr(d.exp).forEach(function (x) {
        if (!x || typeof x.id !== "string" || dead("exp", x)) return;
        var gid = groupOf(x.id), g = groups[gid];
        if (!g) return;
        var payers = Object.keys(x.by && typeof x.by === "object" ? x.by : {})
          .map(function (k) { return people[k] || ""; });
        out.push({
          id: "e:" + x.id,
          title: str(x.t) || cats[x.c] || cats.other,
          text: [str(x.n)].concat(payers, [str(g.n)]).filter(Boolean).join(" · "),
          when: dayMs(x.d),
          target: { group: gid, exp: x.id }
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
