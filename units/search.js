// ============================================================
// orOS Unit Converter — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-units-data and the device-local
// rates, never writes.
//   - A conversion typed in the search ("10 km σε mi", "72 f to c",
//     "5 στρέμματα", "100 usd σε eur") comes back as a ready answer:
//     "10 km = 6.21371 mi". The query itself is part of the text, so
//     every word of it matches.
//   - Favourite pairs, by unit names in both languages.
// Opens through the generic deep link
// __orosOpenAt("units", { cat, from, to, value }).
// Needs units/core.js (UnitsCore): the shell's window does not have
// it, so the provider loads it once next to itself.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-units-data";
  var RATES = "oros-units-rates";
  var core = null, coreWait = null;
  // core.js sits next to this file (same ?v= stamp).
  var CORE_SRC = "units/core.js";
  try {
    var cs = root && root.document && root.document.currentScript;
    if (cs && typeof cs.src === "string" && /search\.js(?=[?#]|$)/.test(cs.src)) {
      CORE_SRC = cs.src.replace(/search\.js(?=[?#]|$)/, "core.js");
    }
  } catch (e) {}

  function getCore() {
    if (core) return Promise.resolve(core);
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { core = require("./core.js"); return Promise.resolve(core); } catch (e) {}
    }
    if (root && root.UnitsCore) { core = root.UnitsCore; return Promise.resolve(core); }
    if (!root || !root.document) return Promise.resolve(null);
    if (coreWait) return coreWait;
    coreWait = new Promise(function (resolve) {
      var s = root.document.createElement("script");
      s.src = CORE_SRC;
      s.onload = function () { core = root.UnitsCore || null; resolve(core); };
      s.onerror = function () { coreWait = null; resolve(null); };
      root.document.head.appendChild(s);
    });
    return coreWait;
  }

  function hits(C, ctx) {
    var out = [], lang = ctx.lang === "el" ? "el" : "en";
    var rates = C.storedRates(ctx.readJSON(RATES));
    var d = ctx.readJSON(KEY) || {};
    var prec = C.precOf(C.mergeData(d, null));
    var q = C.parseQuery(String(ctx.q || ""), lang, rates);
    if (q) {
      var to = q.to || C.partnerOf(q.cat, q.from);
      var ing = C.ingredient("water");
      var r = C.convert(q.cat, q.from, to, q.v, { rates: rates, dens: ing[1] });
      var a = C.unit(q.cat, q.from, rates), b = C.unit(q.cat, to, rates);
      if (r.ok && a && b) {
        var left = C.formatNumber(q.v, prec, lang, true) + " " + a.sym;
        var right = C.formatNumber(r.v, prec, lang, true) + " " + b.sym;
        out.push({
          id: "q:" + q.cat + ":" + q.from + ">" + to,
          title: left + " = " + right,
          text: String(ctx.q) + " · " + C.unitName(a, lang) + " → " + C.unitName(b, lang),
          target: { cat: q.cat, from: q.from, to: to, value: q.v }
        });
      }
    }
    C.favList(C.mergeData(d, null)).forEach(function (p) {
      var a = C.unit(p.c, p.f, rates), b = C.unit(p.c, p.t, rates), c = C.cat(p.c);
      if (!c) return;
      var names = [C.catName(c, "en"), C.catName(c, "el")];
      [a, b].forEach(function (u) { if (u) names.push(u.sym, C.unitName(u, "en"), C.unitName(u, "el")); });
      out.push({
        id: "f:" + C.favId(p.c, p.f, p.t),
        title: (a ? a.sym : p.f) + " → " + (b ? b.sym : p.t),
        text: names.join(" · "),
        target: { cat: p.c, from: p.f, to: p.t }
      });
    });
    return out;
  }

  var PROVIDER = {
    id: "units",
    keys: [KEY, RATES],
    search: function (ctx) {
      return getCore().then(function (C) { return C ? hits(C, ctx) : []; });
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("units", target && typeof target === "object" ? target : null);
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
