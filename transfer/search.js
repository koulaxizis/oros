// ============================================================
// orOS Transfer — universal search provider (AS-SUM8, 2026-11-17)
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads the
// synced History (oros-transfer-data, core.js mergeHistory shape)
// and never writes. One hit per transfer: up to three top names
// (`what`, never a file's contents), the direction, the device and
// how many files. Tombstoned entries are left out. Being searchable
// is also what offers Transfer to the Assistant and to orOS Gate
// (shell.js orosAssistApps), so app_summary transfer can read the
// History (assistant/summary.js transferHistory).
// Opens through the generic deep link __orosOpenAt: { tab: "hist" }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-transfer-data";
  var MAX = 200;
  // English and Greek here; a pack language (orosI18n) adds its own.
  var S = {
    en: { "sx.sent": "Sent", "sx.recv": "Received", "sx.files": "{n} files", "sx.file": "1 file", "sx.some": "Files" },
    el: { "sx.sent": "Στάλθηκε", "sx.recv": "Λήφθηκε", "sx.files": "{n} αρχεία", "sx.file": "1 αρχείο", "sx.some": "Αρχεία" }
  };
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && lang && !S[lang]) I.table(S, "transfer", lang);
    return S[lang] || S.en;
  }
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }

  var PROVIDER = {
    id: "transfer",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY), w = words(ctx.lang), out = [];
      if (!d || typeof d !== "object" || !Array.isArray(d.items)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.items.forEach(function (x) {
        if (out.length >= MAX || !x || typeof x.id !== "string" || !(x.at > 0) || tombs[x.id]) return;
        var n = Math.max(0, Math.floor(+x.n || 0));
        out.push({
          id: x.id,
          title: str(x.what, 120) || w["sx.some"],
          text: [x.dir === "recv" ? w["sx.recv"] : w["sx.sent"], str(x.dev, 60), n === 1 ? w["sx.file"] : w["sx.files"].replace("{n}", n)]
            .filter(Boolean).join(" · "),
          when: x.at,
          target: { tab: "hist" }
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
