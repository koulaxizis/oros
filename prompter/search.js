// ============================================================
// orOS Prompter — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-prompter-data, never writes.
// One hit per CUSTOM prompt (the user's own): the prompt in the
// current language as the title (the other language when that one
// is empty); the other language and both variations as text. The
// date is the last edit. The 100 built-in prompts ship with the app
// (not user data) and are not searched. Customs covered by a plain
// tombstone (deleted[id] >= mtime, as the merge's alive()) are
// skipped; a delete normally removes them from customs[] anyway.
// Opens through the generic deep link: target { prompt }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-prompter-data";

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  var PROVIDER = {
    id: "prompter",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.customs)) return out;
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var el = ctx.lang === "el";
      d.customs.forEach(function (c) {
        if (!c || typeof c.id !== "string" || c.id.charAt(0) !== "c") return;
        var t = Object.prototype.hasOwnProperty.call(tomb, c.id) ? Number(tomb[c.id]) || 0 : 0;
        if (t && !((Number(c.mtime) || 0) > t)) return;
        var main = el ? str(c.el) : str(c.en), other = el ? str(c.en) : str(c.el);
        var vMain = el ? str(c.var_el) : str(c.var_en), vOther = el ? str(c.var_en) : str(c.var_el);
        var title = main || other;
        if (!title) return;
        out.push({
          id: c.id,
          title: title,
          text: [main ? other : "", vMain, vOther].filter(Boolean).join(" · "),
          when: typeof c.mtime === "number" ? c.mtime : 0,
          target: { prompt: c.id }
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
