// ============================================================
// orOS Mood — core.js (shared check-in rule, v1.0.0)
// One copy of "did the user log a mood today", read by:
//   - the shell (index.html → moodCheckInTick, the daily reminder)
//   - the Today summary (mood/today.js, through apps.json "today")
//   - the tests (tests/today-wave4.test.js, through module.exports)
// Pure functions, no DOM, no storage. Read-only.
// API (window.OrosMoodCore):
//   hasAny(raw)       the app has at least one entry (SH-B7: no entry
//                     ever → no daily nagging)
//   hasOn(raw, ymd)   an entry whose time (ts, ms) falls on that local
//                     day; an entry without a valid time never counts
//   dayMoods(raw, ymd, lang)  the feelings logged on that local day,
//                     for Diary's quiet "mood of the day" line:
//                     [{ k, label, col, ic, i }] in the order first
//                     logged, one per feeling (i = its highest
//                     intensity). A tombstoned entry (deleted, not
//                     revived by a newer edit) never counts. Labels:
//                     the user's own name (vocab), else the built-in
//                     name in lang, else "?"; colours as in Mood.
// raw = oros-mood-data { entries: [{ id, ts, … }] }
// ============================================================
(function (root) {
  "use strict";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function entries(raw) { return raw && Array.isArray(raw.entries) ? raw.entries : []; }
  function hasAny(raw) { return entries(raw).length > 0; }
  function hasOn(raw, ymd) {
    var list = entries(raw);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.ts && ymdOf(e.ts) === ymd) return true;
    }
    return false;
  }
  // Built-in feelings: colour + EN/EL name (the same as mood.js
  // BUILTIN_EMOS and its emo.* strings).
  var BUILTIN_COL = { happy: "#87cf3e", calm: "#51a2da", excited: "#8c5ec7", sad: "#5277c3",
    angry: "#e06c75", anxious: "#e0a44c", tired: "#9aa0ae", stressed: "#ff7043", numb: "#6d4aff" };
  var NAMES = {
    en: { happy: "Happy", calm: "Calm", excited: "Excited", sad: "Sad", angry: "Angry",
          anxious: "Anxious", tired: "Tired", stressed: "Stressed", numb: "Numb" },
    el: { happy: "Χαρούμενος", calm: "Ήρεμος", excited: "Ενθουσιασμένος", sad: "Λυπημένος",
          angry: "Θυμωμένος", anxious: "Αγχωμένος", tired: "Κουρασμένος", stressed: "Πιεσμένος", numb: "Άδειος" }
  };
  // vocab.emo → { id: newest def } (a raw copy may hold stale twins)
  function emoDefs(raw) {
    var list = raw && raw.vocab && Array.isArray(raw.vocab.emo) ? raw.vocab.emo : [], out = {};
    list.forEach(function (d) {
      if (!d || typeof d.id !== "string") return;
      if (!out[d.id] || (+d.mtime || 0) >= (+out[d.id].mtime || 0)) out[d.id] = d;
    });
    return out;
  }
  function str(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function dayMoods(raw, ymd, lang) {
    var del = raw && raw.deleted && typeof raw.deleted === "object" ? raw.deleted : {};
    var names = NAMES[lang] || NAMES.en, defs = null, out = [], at = {};
    entries(raw).filter(function (e) {
      if (!e || typeof e.ts !== "number" || ymdOf(e.ts) !== ymd) return false;
      var tomb = del[e.id];
      return !(typeof tomb === "number" && !((+e.mtime || 0) > tomb));
    }).sort(function (a, b) { return a.ts - b.ts; }).forEach(function (e) {
      (Array.isArray(e.emotions) ? e.emotions : []).forEach(function (m) {
        if (!m || typeof m.k !== "string" || !m.k) return;
        var n = typeof m.i === "number" ? m.i : 0;
        if (at[m.k] !== undefined) { if (n > out[at[m.k]].i) out[at[m.k]].i = n; return; }
        if (!defs) defs = emoDefs(raw);
        var d = defs[m.k] || {};
        at[m.k] = out.length;
        out.push({
          k: m.k,
          label: str(d.lab, 40) || names[m.k] || "?",
          col: typeof d.col === "string" && /^#[0-9a-f]{6}$/i.test(d.col) ? d.col : (BUILTIN_COL[m.k] || "#9aa0ae"),
          ic: str(d.ic, 16),
          i: n
        });
      });
    });
    return out;
  }
  var API = { hasAny: hasAny, hasOn: hasOn, ymdOf: ymdOf, dayMoods: dayMoods };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosMoodCore = API;
})(typeof window !== "undefined" ? window : globalThis);
