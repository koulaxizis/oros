// ============================================================
// orOS Calculator — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). The Calculator's Convert mode is the Unit Converter
// folded in (APP-ALIAS merge 5), so its search is the Unit
// Converter's own (units/search.js, loaded once from next door):
// a conversion typed in the search comes back as an answer, and
// favourite pairs are found by unit names. Read-only.
// Hits open through the old id: __orosOpenAt("units", target)
// forwards to the Calculator's Convert mode.
// ============================================================
(function (root) {
  "use strict";
  var inner = null, wait = null;
  var SRC = "units/search.js";
  try {
    var cs = root && root.document && root.document.currentScript;
    if (cs && typeof cs.src === "string" && /calculator\/search\.js(?=[?#]|$)/.test(cs.src)) {
      SRC = cs.src.replace(/calculator\/search\.js(?=[?#]|$)/, "units/search.js");
    }
  } catch (e) {}

  function findInner() {
    var list = (root && root.orosSearchProviders) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === "units") return list[i];
    return null;
  }
  function getInner() {
    if (inner) return Promise.resolve(inner);
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { inner = require("../units/search.js"); return Promise.resolve(inner); } catch (e) {}
    }
    inner = findInner();
    if (inner) return Promise.resolve(inner);
    if (!root || !root.document) return Promise.resolve(null);
    if (wait) return wait;
    wait = new Promise(function (resolve) {
      var s = root.document.createElement("script");
      s.src = SRC;
      s.onload = function () { inner = findInner(); resolve(inner); };
      s.onerror = function () { wait = null; resolve(null); };
      root.document.head.appendChild(s);
    });
    return wait;
  }

  var PROVIDER = {
    id: "calculator",
    keys: ["oros-units-data", "oros-units-rates"],
    search: function (ctx) {
      return getInner().then(function (p) { return p ? p.search(ctx) : []; });
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
