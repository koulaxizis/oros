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
  var PRESET = { "Not today": 1, "Doesn't fit me": 1,
                 "Όχι σήμερα": 1, "Δεν μου ταιριάζει": 1 };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "minimalism",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.days)) return out;
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var el = ctx.lang === "el";
      d.days.forEach(function (e) {
        if (!e || typeof e.id !== "string" || e.status !== "skip") return;
        var ts = tomb[e.id];
        if (typeof ts === "number" && (Number(e.mtime) || 0) <= ts) return;
        var reason = str(e.reason), m = YMD.exec(str(e.date));
        if (!reason || PRESET[reason] || !m) return;
        var lvl = e.level === "dig" ? (el ? "Ψηφιακός" : "Digital") : (el ? "Φυσικός" : "Physical");
        out.push({
          id: e.id,
          title: reason,
          text: (el ? "Παραλείφθηκε" : "Skipped") + " · " + lvl,
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
