// ============================================================
// orOS Forms — Today provider (FORMS-2)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-forms-data (titles), oros-forms-answers (new
// answers not looked at yet) and the device-local oros-forms-wait
// (answers waiting at the relay, forms/host.js); never writes.
// One line per form with something new: answers here not seen yet
// plus answers still waiting. Opens the form's Answers tab through the
// generic deep link __orosOpenAt("forms", { form, tab: "resp" }).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "td.new1": "1 new answer", "td.new": "{n} new answers", "td.untitled": "Untitled form" },
    el: { "td.new1": "1 νέα απάντηση", "td.new": "{n} νέες απαντήσεις", "td.untitled": "Φόρμα χωρίς τίτλο" }
  };
  function tr(lang, k, p) {
    if (lang && !W[lang] && root && root.orosI18n) root.orosI18n.table(W, "forms", lang);
    var s = (W[lang] || W.en)[k] || W.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }

  var PROVIDER = {
    id: "forms",
    keys: ["oros-forms-data", "oros-forms-answers", "oros-forms-wait"],
    collect: function (ctx) {
      var data = obj(ctx.readJSON("oros-forms-data")), ans = obj(ctx.readJSON("oros-forms-answers")) || {};
      var wait = obj(ctx.readJSON("oros-forms-wait")) || {};
      if (!data || !Array.isArray(data.forms)) return [];
      var seen = obj(ans.seen) || {}, fresh = {};
      (Array.isArray(ans.rs) ? ans.rs : []).forEach(function (r) {
        if (!r || r.del || typeof r.f !== "string" || !(r.at > (seen[r.f] || 0))) return;
        fresh[r.f] = (fresh[r.f] || 0) + 1;
      });
      var rows = [];
      data.forms.forEach(function (f) {
        if (!f || f.del || typeof f.id !== "string") return;
        var w = obj(wait[f.id]), n = (fresh[f.id] || 0) + (w && typeof w.n === "number" ? w.n : 0);
        if (!n) return;
        rows.push({ id: "ans-" + f.id, due: null, time: null,
                    title: n === 1 ? tr(ctx.lang, "td.new1") : tr(ctx.lang, "td.new", { n: n }),
                    text: typeof f.title === "string" && f.title ? f.title : tr(ctx.lang, "td.untitled"),
                    kind: "info", target: { form: f.id, tab: "resp" } });
      });
      return rows;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
