// ============================================================
// orOS Forms: universal search provider (FORMS-4)
// Loaded by the shell on the first menu search (apps.json "search").
// Read-only: reads oros-forms-data, never writes. One hit per form:
// its title, then its description and question labels. Answers are
// not searched (they are other people's words). Opens through the
// generic deep link: target { form }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-forms-data";
  var S = {
    en: { "srch.untitled": "Untitled form", "srch.qs": "Questions: " },
    el: { "srch.untitled": "Φόρμα χωρίς τίτλο", "srch.qs": "Ερωτήσεις: " }
  };
  function word(lang, k) {
    var I = root && root.orosI18n;
    var tab = S[lang] || (I && lang ? I.table(S, "forms", lang) : S.en);
    return (tab && tab[k]) || S.en[k];
  }
  function str(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; }

  var PROVIDER = {
    id: "forms",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.forms)) return out;
      d.forms.forEach(function (f) {
        if (!f || f.del || typeof f.id !== "string") return;
        var labels = (Array.isArray(f.qs) ? f.qs : []).map(function (q) { return q && q.t !== "page" ? str(q.label, 200) : ""; })
          .filter(Boolean).slice(0, 60);
        var text = [str(f.desc, 400), labels.length ? word(ctx.code || ctx.lang, "srch.qs") + labels.join(" · ") : ""].filter(Boolean).join(" · ");
        out.push({
          id: f.id,
          title: str(f.title, 200) || word(ctx.code || ctx.lang, "srch.untitled"),
          text: text,
          when: typeof f.m === "number" ? f.m : 0,
          target: { form: f.id }
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
