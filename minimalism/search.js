// ============================================================
// orOS Minimalism — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-minimalism-data, never writes.
// The daily suggestions live in content.js (not user text, not
// loaded by the shell), so the only user text is the free-text
// reason typed when skipping a day. One hit per skipped day with a
// typed reason (the reason; "Skipped · Physical/Digital" as text;
// the date shown is that day). The two preset reasons ("Not today",
// "Doesn't fit me", EN/EL) are not user text and are skipped; so
// are rows older than their tombstone (deleted{}).
// Opens through the existing Minimalism bridge (__orosOpenMinimalism).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-minimalism-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  // Same keys and English as minimalism.js (orosI18n packs: pack "minimalism").
  var S = {
    en: { "lvl.phys": "Physical", "lvl.dig": "Digital", "status.skip": "Skipped",
          "skip.r1": "Not today", "skip.r2": "Doesn't fit me" },
    el: { "lvl.phys": "Φυσικός", "lvl.dig": "Ψηφιακός", "status.skip": "Παραλείφθηκε",
          "skip.r1": "Όχι σήμερα", "skip.r2": "Δεν μου ταιριάζει" }
  };
  // The shell runs this file: a pack language reads the "minimalism"
  // pack when the shell has it, else English.
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known && I.known(lang) && !S[lang]) I.table(S, "minimalism", lang);
    return S[lang] || S.en;
  }
  // The preset skip reasons, in every language loaded so far, are not user text.
  function isPreset(reason) {
    for (var l in S) if (S[l] && (S[l]["skip.r1"] === reason || S[l]["skip.r2"] === reason)) return true;
    return false;
  }

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "minimalism",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.days)) return out;
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var w = words(ctx.lang);
      d.days.forEach(function (e) {
        if (!e || typeof e.id !== "string" || e.status !== "skip") return;
        var ts = tomb[e.id];
        if (typeof ts === "number" && (Number(e.mtime) || 0) <= ts) return;
        var reason = str(e.reason), m = YMD.exec(str(e.date));
        if (!reason || isPreset(reason) || !m) return;
        var lvl = e.level === "dig" ? w["lvl.dig"] : w["lvl.phys"];
        out.push({
          id: e.id,
          title: reason,
          text: w["status.skip"] + " · " + lvl,
          when: new Date(+m[1], +m[2] - 1, +m[3], 12).getTime(),
          target: m[0]
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && YMD.test(target) && win &&
          typeof win.__orosOpenMinimalism === "function") {
        win.__orosOpenMinimalism(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("minimalism", null);
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
