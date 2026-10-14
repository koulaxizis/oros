// ============================================================
// orOS Habits — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-habits-data, never writes.
// One hit per habit: its name, and its schedule as text ("Every
// day", "3 days / week", "Any day", "3 times / week", "2 times /
// month"), plus the daily target of a measurable habit ("at least
// 10 pages"). Deleted habits (del: true) are skipped. Notes on
// check-ins are not searched (they belong to a day, not a habit).
// Opens through the generic deep link: target { habit: id }
// (habits.js openSearchTarget opens its edit dialog). The Habits
// bridge (__orosOpenHabits) only moves the period, so it is not used.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-habits-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function schedule(h, lang) {
    var per = h.per;
    if (Array.isArray(per) && (per[0] === "w" || per[0] === "m") && typeof per[1] === "number") {
      if (per[0] === "w") return lang === "el" ? per[1] + " φορές / εβδομάδα" : per[1] + " times / week";
      return lang === "el" ? per[1] + " φορές / μήνα" : per[1] + " times / month";
    }
    var days = h.days;
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
        var text = schedule(h, lang);
        var num = h.num;
        if (num && typeof num === "object" && typeof num.t === "number" && num.t > 0) {
          var unit = str(num.u);
          text += " · " + (num.c === "le" ? (lang === "el" ? "το πολύ " : "at most ") : (lang === "el" ? "τουλάχιστον " : "at least ")) +
                  num.t + (unit ? " " + unit : "");
        }
        out.push({ id: h.id, title: name, text: text, target: { habit: h.id } });
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
