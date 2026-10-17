// ============================================================
// orOS Family Tree — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after familytree/ft-core.js. Read-only: reads
// oros-familytree-data, never writes. Death anniversaries of today
// and the next days ("Name · 12 years since death"; 29 February also
// on 28 February of common years), from FTCore.deathDays /
// deathAnniversaries: the same rows as the Calendar's Family Tree
// feed. Opens Family Tree centred on that person (__orosOpenAt:
// { person }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-familytree-data";
  // Same keys and English as the "familytree" pack: a pack language
  // shows its line when the shell has the pack, else English.
  var TXT = { en: { "today.one": "1 year since death", "today.n": "{n} years since death" },
              el: { "today.one": "1 χρόνος από τον θάνατο", "today.n": "{n} χρόνια από τον θάνατο" } };
  function words(lang) {
    var I = root && root.orosI18n;
    return TXT[lang] || (I && lang ? I.table(TXT, "familytree", lang) : TXT.en);
  }

  var PROVIDER = {
    id: "familytree",
    keys: [KEY],
    collect: function (ctx) {
      var F = root.FTCore, raw = ctx.readJSON(KEY);
      if (!F || !raw || typeof raw !== "object") return [];
      var idx = F.deathDays(raw), w = words(ctx.lang), out = [];
      for (var i = 0; i <= ctx.horizon; i++) {
        var day = ctx.addDays(ctx.today, i);
        F.deathAnniversaries(idx, day).forEach(function (r) {
          out.push({ id: r.pid + ":" + day, due: day, kind: "event", title: r.name.slice(0, 60),
                     text: r.years === 1 ? w["today.one"] : w["today.n"].replace("{n}", r.years), target: { person: r.pid } });
        });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
