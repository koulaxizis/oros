// ============================================================
// orOS Cycle — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-cycle-data, never writes.
// Sensitive data: the app ships with "searchOff": true (opt-in).
// One hit per logged day: the first line of its note as title
// (else its symptoms, else "Cycle day"), and as text the note,
// the symptoms and the medicines taken (column labels in the
// active language for the seed values). The date shown is the
// day. Periods hold no text and are not searched. Days, intakes
// and column values with a tombstone at least as new as the
// record (deleted{}) are skipped.
// Opens through the generic deep link: target { day: "d-YYYY-MM-DD" }
// (cycle.js openSearchTarget opens that day's editor).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-cycle-data";
  var DAY_RE = /^d-\d{4}-\d{2}-\d{2}$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); })
      .filter(Boolean)[0] || "";
  }

  var PROVIDER = {
    id: "cycle",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.days)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var cols = d.cols && typeof d.cols === "object" ? d.cols : {};
      function gone(id, mtime) {
        var ts = tomb[id];
        return typeof ts === "number" && (mtime || 0) <= ts;
      }
      var names = { sym: {}, med: {} };
      ["sym", "med"].forEach(function (c) {
        (Array.isArray(cols[c]) ? cols[c] : []).forEach(function (v) {
          if (!v || typeof v.id !== "string" || gone(v.id, v.mtime)) return;
          names[c][v.id] = str(v.bi && v.bi[lang]) || str(v.label);
        });
      });
      d.days.forEach(function (r) {
        if (!r || typeof r.id !== "string" || !DAY_RE.test(r.id) || gone(r.id, r.mtime)) return;
        var note = typeof r.note === "string" ? r.note : "";
        var sym = (Array.isArray(r.sym) ? r.sym : []).map(function (id) {
          return names.sym[id] || "";
        }).filter(Boolean);
        var meds = (Array.isArray(r.meds) ? r.meds : []).map(function (m) {
          if (!m || typeof m !== "object" || (typeof m.id === "string" && tomb[m.id] !== undefined)) return "";
          return names.med[m.med] || "";
        }).filter(Boolean);
        var title = firstLine(note).slice(0, 60) || sym.join(", ") ||
                    (lang === "el" ? "Ημέρα κύκλου" : "Cycle day");
        out.push({
          id: r.id,
          title: title,
          text: [note.trim(), sym.join(", "), meds.join(", ")].filter(Boolean).join(" · "),
          when: typeof r.day === "number" ? r.day : 0,
          target: { day: r.id }
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
