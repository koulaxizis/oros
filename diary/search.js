// ============================================================
// orOS One-Sentence Diary — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-diary-data, never writes.
// Personal data: the app ships with "searchOff": true (opt-in in
// Settings, like Mood, Cycle and Health).
// One hit per day: the date as title, the sentence as text.
// Days with a tombstone at least as new as the day are skipped.
// Opens through the generic deep link __orosOpenAt("diary", { day }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-diary-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  function dateTitle(ymd, lang) {
    var m = YMD.exec(ymd), d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    try {
      return d.toLocaleDateString(lang === "el" ? "el-GR" : "en-GB",
        { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ymd; }
  }

  var PROVIDER = {
    id: "diary",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !d.days || typeof d.days !== "object") return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var lang = ctx.lang === "el" ? "el" : "en";
      Object.keys(d.days).forEach(function (k) {
        var day = d.days[k], m = YMD.exec(k);
        if (!m || !day || typeof day.t !== "string" || !day.t.trim()) return;
        if (typeof tombs[k] === "number" && tombs[k] >= (day.m || 0)) return;
        out.push({
          id: k,
          title: dateTitle(k, lang),
          text: (typeof day.e === "string" && day.e ? day.e + " " : "") + day.t,
          when: new Date(+m[1], +m[2] - 1, +m[3], 12).getTime(),
          target: k
        });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("diary", typeof target === "string" && YMD.test(target) ? { day: target } : null);
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
