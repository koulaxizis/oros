// ============================================================
// orOS Mood — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mood-data, never writes.
// Sensitive data: the app ships with "searchOff": true (opt-in).
// One hit per entry: the feelings as title, and as text the
// reflection note, the trigger, the location and the person
// (column labels in the active language for the seed values), and
// the user's own activities; renamed and custom feelings show the
// user's names (wave 30, d.vocab).
// The date shown is the entry's time. Entries with a tombstone at
// least as new as the entry (deleted{}) are skipped.
// Opens through the existing Mood bridge (__orosOpenMood).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mood-data";
  // Keys as in mood.js (one "mood" pack).
  var W = {
    en: { "search.entry": "Mood entry", "emo.happy": "Happy", "emo.calm": "Calm", "emo.excited": "Excited", "emo.sad": "Sad",
          "emo.angry": "Angry", "emo.anxious": "Anxious", "emo.tired": "Tired", "emo.stressed": "Stressed",
          "emo.numb": "Numb" },
    el: { "search.entry": "Καταγραφή διάθεσης", "emo.happy": "Χαρούμενος", "emo.calm": "Ήρεμος", "emo.excited": "Ενθουσιασμένος",
          "emo.sad": "Λυπημένος", "emo.angry": "Θυμωμένος", "emo.anxious": "Αγχωμένος",
          "emo.tired": "Κουρασμένος", "emo.stressed": "Πιεσμένος", "emo.numb": "Άδειος" }
  };
  // A pack language: English + the mood pack, when one is loaded.
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "mood", lang);
    return W[lang] || W.en;
  }

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
      var w = words(ctx.lang);
      var lang = ctx.lang === "el" ? "el" : "en";       // saved seeds carry bi { en, el }
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
      // Wave 30: the user's own names (vocab.emo / vocab.act defs)
      var own = { emo: {}, act: {} };
      var vo = d.vocab && typeof d.vocab === "object" ? d.vocab : {};
      ["emo", "act"].forEach(function (k) {
        (Array.isArray(vo[k]) ? vo[k] : []).forEach(function (x) {
          if (x && typeof x.id === "string" && str(x.lab)) own[k][x.id] = str(x.lab);
        });
      });
      d.entries.forEach(function (e) {
        if (!e || typeof e.id !== "string" || !alive(e, tomb)) return;
        var feel = (Array.isArray(e.emotions) ? e.emotions : []).map(function (m) {
          if (!m) return "";
          return own.emo[m.k] || w["emo." + m.k] || "";
        }).filter(Boolean);
        var acts = (Array.isArray(e.acts) ? e.acts : []).map(function (id) { return own.act[id] || ""; }).filter(Boolean);
        var title = feel.join(", ") || w["search.entry"];
        out.push({
          id: e.id,
          title: title,
          text: [str(e.note), label("trig", e.trig), label("loc", e.loc), label("person", e.person)]
            .concat(acts).filter(Boolean).join(" · "),
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
