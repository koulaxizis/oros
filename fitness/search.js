// ============================================================
// orOS Workouts — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-fitness-data, never writes.
// Hits:
//   - one per workout: its title (else "Workout"), and as text
//     its notes, the own program it came from and the names of the
//     own exercises in it; the date shown is when it started.
//   - one per own program: its name, its day names as text.
// Skipped: rows with a tombstone at least as new as the row
// (tombs{"wo:<id>"} / tombs{"pg:<id>"} / tombs{"ex:<id>"}). Ready
// (built-in) exercise and program names live in the app's code,
// not in the data, so only names the user typed are searched.
// Opening: a workout through the existing Workouts bridge
// (__orosOpenFitness); a program through the generic deep link,
// target { pg: id } (fitness.js openSearchTarget opens its editor).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-fitness-data";
  var ID_RE = /^[a-z0-9-]{1,40}$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "fitness",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function live(c, x) {
        if (!x || typeof x.id !== "string" || !x.id) return false;
        var ts = tombs[c + ":" + x.id];
        return typeof ts !== "number" || ts < (x.m || 0);
      }
      var exName = {}, pgName = {};
      arr(d.ex).forEach(function (x) { if (live("ex", x) && str(x.n)) exName[x.id] = str(x.n); });
      arr(d.pg).forEach(function (p) {
        if (!live("pg", p) || !str(p.n)) return;
        pgName[p.id] = str(p.n);
        out.push({
          id: "pg:" + p.id,
          title: str(p.n),
          text: arr(p.days).map(function (dy) { return dy ? str(dy.n) : ""; }).filter(Boolean).join(" · "),
          target: { pg: p.id }
        });
      });
      arr(d.wo).forEach(function (w) {
        if (!live("wo", w)) return;
        var seen = {}, names = [];
        arr(w.x).forEach(function (e) {
          var n = e && exName[e.e];
          if (n && !seen[n]) { seen[n] = true; names.push(n); }
        });
        out.push({
          id: "wo:" + w.id,
          title: str(w.ti) || (lang === "el" ? "Προπόνηση" : "Workout"),
          text: [str(w.n), pgName[w.p] || "", names.join(", ")].filter(Boolean).join(" · "),
          when: typeof w.st === "number" ? w.st : 0,
          target: w.id
        });
      });
      return out;
    },
    open: function (t, win) {
      if (typeof t === "string" && ID_RE.test(t) && win && typeof win.__orosOpenFitness === "function") {
        win.__orosOpenFitness(t);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("fitness", t && typeof t.pg === "string" ? { pg: t.pg } : null);
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
