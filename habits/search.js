// ============================================================
// orOS Habits — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-habits-data, never writes.
// One hit per habit: its name, and its schedule as text ("Every
// day", "3 days / week", "Any day"). Deleted habits (del: true)
// are skipped; completions hold no text.
// Opens through the generic deep link: target { habit: id }
// (habits.js openSearchTarget opens its edit dialog). The Habits
// bridge (__orosOpenHabits) only moves the period, so it is not used.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-habits-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function schedule(days, lang) {
    var n = Array.isArray(days) ? days.length : 0;
    if (n >= 7) return lang === "el" ? "Καθημερινά" : "Every day";
    if (!n) return lang === "el" ? "Οποιαδήποτε μέρα" : "Any day";
    return lang === "el" ? n + " ημέρες / εβδομάδα" : n + " days / week";
  }

  var PROVIDER = {
    id: "habits",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.habits)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      d.habits.forEach(function (h) {
        if (!h || typeof h.id !== "string" || !h.id || h.del) return;
        var name = str(h.name);
        if (!name) return;
        out.push({ id: h.id, title: name, text: schedule(h.days, lang), target: { habit: h.id } });
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
