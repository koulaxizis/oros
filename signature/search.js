// ============================================================
// orOS Email Signature — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-signature-data, never writes.
// One hit per signature: its name as title, and as text the person,
// job title, company, email, phone and website.
// Opens through __orosOpenAt("signature", { id }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-signature-data";
  // The shell passes "el" or "en"; a pack language reads English
  // here unless the "signature" pack is loaded (orosI18n).
  var NAME = {
    en: { "search.untitled": "Signature" },
    el: { "search.untitled": "Υπογραφή" }
  };
  var ID_RE = /^s[0-9a-z]{6,24}$/;

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  var PROVIDER = {
    id: "signature",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], lang = ctx.lang === "el" ? "el" : "en", I = typeof window !== "undefined" && window.orosI18n;
      if (lang === "en" && I) { lang = I.lang(); if (lang !== "el" && lang !== "en") I.table(NAME, "signature", lang); }
      if (!d || !Array.isArray(d.sigs)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.sigs.forEach(function (s) {
        if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return;
        if (tombs[s.id] && tombs[s.id] >= s.m) return;
        var f = s.f && typeof s.f === "object" ? s.f : {};
        var title = str(s.nm) || str(f.name) || str(f.company) || (NAME[lang] || NAME.en)["search.untitled"];
        var text = [f.name, f.title, f.dept, f.company, f.email, f.phone, f.mobile, f.web].map(str).filter(Boolean).join(" · ");
        out.push({ id: s.id, title: title, text: text, target: { id: s.id } });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("signature", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
