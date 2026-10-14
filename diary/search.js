// ============================================================
// orOS One-Sentence Diary — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-diary-data, never writes.
// Personal data: the app ships with "searchOff": true (opt-in in
// Settings, like Mood, Cycle and Health).
// One hit per day: the date as title, the sentence as text (plus the
// start of the longer entry and its place, wave 30).
// Days with a tombstone at least as new as the day are skipped.
// With a PIN lock on this device (oros-diary-lock) nothing is shown:
// the lock screen would be pointless if search showed the lines.
// Opens through the generic deep link __orosOpenAt("diary", { day }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-diary-data";
  var LOCK_KEY = "oros-diary-lock";
  var SNIP = 240;

  function fieldV(o, k) { return o && o[k] && typeof o[k] === "object" ? o[k].v : undefined; }
  // The longer entry as plain words (Markdown marks dropped).
  function longText(lg) {
    var md = fieldV(lg, "md"), loc = fieldV(lg, "loc"), out = [];
    if (loc && typeof loc.n === "string" && loc.n) out.push(loc.n);
    if (typeof md === "string" && md) {
      var s = md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`~-]+/g, " ").replace(/\s+/g, " ").trim();
      if (s.length > SNIP) s = s.slice(0, SNIP) + "…";
      if (s) out.push(s);
    }
    return out.join(" · ");
  }
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
      var lock = ctx.readJSON(LOCK_KEY);
      if (lock && typeof lock === "object" && lock.h) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var long = d.long && typeof d.long === "object" ? d.long : {};
      var lang = ctx.lang === "el" ? "el" : "en";
      var seen = {};
      function push(k, m, text) {
        seen[k] = 1;
        out.push({
          id: k,
          title: dateTitle(k, lang),
          text: text,
          when: new Date(+m[1], +m[2] - 1, +m[3], 12).getTime(),
          target: k
        });
      }
      Object.keys(d.days).forEach(function (k) {
        var day = d.days[k], m = YMD.exec(k);
        if (!m || !day || typeof day.t !== "string" || !day.t.trim()) return;
        if (typeof tombs[k] === "number" && tombs[k] >= (day.m || 0)) return;
        var lt = longText(long[k]);
        push(k, m, (typeof day.e === "string" && day.e ? day.e + " " : "") + day.t + (lt ? " — " + lt : ""));
      });
      Object.keys(long).forEach(function (k) {
        var m = YMD.exec(k);
        if (!m || seen[k]) return;
        var lt = longText(long[k]);
        if (lt) push(k, m, lt);
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
