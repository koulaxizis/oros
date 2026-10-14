// ============================================================
// orOS Certificates — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-certificates-data, never writes.
// Hits: each set of certificates (its seminar / course, issuer,
// place) and each person on a list (name, email, number).
// Opens through __orosOpenAt("certificates", { ev, p? }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-certificates-data";
  var EV_RE = /^e[0-9a-z]{6,24}$/, P_RE = /^p[0-9a-z]{6,24}$/;
  var NAME = { en: "Certificates", el: "Πιστοποιητικά" };

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function pad(n) { var s = String(n); while (s.length < 4) s = "0" + s; return s; }

  var PROVIDER = {
    id: "certificates",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], lang = ctx.lang === "el" ? "el" : "en";
      if (!d || !Array.isArray(d.evs)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var evs = {};
      d.evs.forEach(function (e) {
        if (!e || typeof e.id !== "string" || !EV_RE.test(e.id)) return;
        if (tombs[e.id] && tombs[e.id] >= e.m) return;
        evs[e.id] = e;
        var title = str(e.t) || NAME[lang];
        out.push({ id: e.id, title: title, text: [e.issuer, e.place].map(str).filter(Boolean).join(" · "), target: { ev: e.id } });
      });
      (Array.isArray(d.ppl) ? d.ppl : []).forEach(function (p) {
        if (!p || typeof p.id !== "string" || !P_RE.test(p.id) || !evs[p.e]) return;
        if (tombs[p.id] && tombs[p.id] >= p.m) return;
        var e = evs[p.e], no = typeof p.no === "number" && p.no > 0 ? str(e.pre) + pad(p.no) : "";
        out.push({ id: p.id, title: str(p.n), text: [str(e.t) || NAME[lang], no, str(p.em)].filter(Boolean).join(" · "), target: { ev: p.e, p: p.id } });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("certificates", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
