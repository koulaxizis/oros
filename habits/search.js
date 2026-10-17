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

  // Its texts (keys of the "habits" pack). The shell runs this file,
  // not the Habits page: a pack language shows the "habits" pack line
  // when the shell has it, else English.
  var S = {
    en: {
      "search.per.w": "{n} times / week", "search.per.m": "{n} times / month",
      "search.daily": "Every day", "search.any": "Any day", "days.n": "{n} days / week",
      "search.le": "at most {t}", "search.ge": "at least {t}"
    },
    el: {
      "search.per.w": "{n} φορές / εβδομάδα", "search.per.m": "{n} φορές / μήνα",
      "search.daily": "Καθημερινά", "search.any": "Οποιαδήποτε μέρα", "days.n": "{n} ημέρες / εβδομάδα",
      "search.le": "το πολύ {t}", "search.ge": "τουλάχιστον {t}"
    }
  };
  function strs(lang) {
    var I = root && root.orosI18n;
    return S[lang] || (I && lang ? I.table(S, "habits", lang) : S.en);
  }
  function schedule(h, L) {
    var per = h.per;
    if (Array.isArray(per) && (per[0] === "w" || per[0] === "m") && typeof per[1] === "number") {
      return L[per[0] === "w" ? "search.per.w" : "search.per.m"].replace("{n}", String(per[1]));
    }
    var days = h.days;
    var n = Array.isArray(days) ? days.length : 0;
    if (n >= 7) return L["search.daily"];
    if (!n) return L["search.any"];
    return L["days.n"].replace("{n}", String(n));
  }

  var PROVIDER = {
    id: "habits",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.habits)) return out;
      var L = strs(ctx.lang);
      d.habits.forEach(function (h) {
        if (!h || typeof h.id !== "string" || !h.id || h.del) return;
        var name = str(h.name);
        if (!name) return;
        var text = schedule(h, L);
        var num = h.num;
        if (num && typeof num === "object" && typeof num.t === "number" && num.t > 0) {
          var unit = str(num.u);
          text += " · " + L[num.c === "le" ? "search.le" : "search.ge"].replace("{t}", num.t + (unit ? " " + unit : ""));
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
