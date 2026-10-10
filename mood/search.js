// ============================================================
// orOS Mood — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mood-data, never writes.
// Sensitive data: the app ships with "searchOff": true (opt-in).
// One hit per entry: the feelings as title, and as text the
// reflection note, the trigger, the location and the person
// (column labels in the active language for the seed values).
// The date shown is the entry's time. Entries with a tombstone at
// least as new as the entry (deleted{}) are skipped.
// Opens through the existing Mood bridge (__orosOpenMood).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mood-data";
  var EMO = {
    happy:    { en: "Happy",    el: "Χαρούμενος" },
    calm:     { en: "Calm",     el: "Ήρεμος" },
    excited:  { en: "Excited",  el: "Ενθουσιασμένος" },
    sad:      { en: "Sad",      el: "Λυπημένος" },
    angry:    { en: "Angry",    el: "Θυμωμένος" },
    anxious:  { en: "Anxious",  el: "Αγχωμένος" },
    tired:    { en: "Tired",    el: "Κουρασμένος" },
    stressed: { en: "Stressed", el: "Πιεσμένος" },
    numb:     { en: "Numb",     el: "Άδειος" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function alive(x, tomb) {
    var ts = tomb[x.id];
    return typeof ts !== "number" || (x.mtime || 0) > ts;
  }

  var PROVIDER = {
    id: "mood",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.entries)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var cols = d.cols && typeof d.cols === "object" ? d.cols : {};
      function label(col, id) {
        if (typeof id !== "string" || !id) return "";
        var arr = Array.isArray(cols[col]) ? cols[col] : [];
        for (var i = 0; i < arr.length; i++) {
          var v = arr[i];
          if (v && v.id === id) {
            if (!alive(v, tomb)) return "";
            return str(v.bi && v.bi[lang]) || str(v.label);
          }
        }
        return "";
      }
      d.entries.forEach(function (e) {
        if (!e || typeof e.id !== "string" || !alive(e, tomb)) return;
        var feel = (Array.isArray(e.emotions) ? e.emotions : []).map(function (m) {
          return m && EMO[m.k] ? EMO[m.k][lang] : "";
        }).filter(Boolean);
        var title = feel.join(", ") || (lang === "el" ? "Καταγραφή διάθεσης" : "Mood entry");
        out.push({
          id: e.id,
          title: title,
          text: [str(e.note), label("trig", e.trig), label("loc", e.loc), label("person", e.person)]
            .filter(Boolean).join(" · "),
          when: typeof e.ts === "number" ? e.ts : 0,
          target: e.id
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && win && typeof win.__orosOpenMood === "function") {
        win.__orosOpenMood(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("mood", null);
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
