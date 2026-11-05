// ============================================================
// orOS Diary — "Your day" line (diary/dayline.js, OrosDiaryDay, wave A4)
// What else happened on a day, read from other apps on this device,
// READ ONLY: the habits ticked (habits/core.js over oros-habits-data)
// and the rows other apps give Habits (window.orosHabitFeeds: Water,
// Workouts, Micro-Zen, Typing Tutor, Steps). Nothing is stored here;
// "Add to the page" puts the lines into the day's longer entry as an
// unsaved draft (the person saves it).
//
//   items(day, lang, src) → [{ app, text }]   src = { habits: raw data
//         or null, core: OrosHabitsCore or null, feeds: array or null }
//   block(items, title) → Markdown lines for the entry ("" when none)
// No DOM, no storage: diary.js passes what it read. Node-tested.
// ============================================================
(function (root) {
  "use strict";

  var MAX = 12;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  function txt(v, lang) {
    if (typeof v === "string") return v.slice(0, 80);
    if (v && typeof v === "object") return String(v[lang] || v.en || "").slice(0, 80);
    return "";
  }
  function num(v, lang) {
    try { return new Intl.NumberFormat(lang === "el" ? "el-GR" : lang || "en", { maximumFractionDigits: 1 }).format(v); }
    catch (e) { return String(Math.round(v * 10) / 10); }
  }
  function clean(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); }

  function items(day, lang, src) {
    var out = [];
    if (!YMD.test(day || "") || !src) return out;
    var H = src.core;
    if (H && src.habits && typeof H.living === "function" && typeof H.isDone === "function") {
      try {
        var ix = H.index(src.habits);
        H.living(ix).forEach(function (h) {
          if (h.archived || out.length >= MAX) return;
          if (H.isDone(ix, h.id, day)) out.push({ app: "habits", text: clean(h.name) });
        });
      } catch (e) {}
    }
    (Array.isArray(src.feeds) ? src.feeds : []).forEach(function (f) {
      if (!f || typeof f.read !== "function" || out.length >= MAX) return;
      var got = null;
      try { got = f.read(); } catch (e) { got = null; }
      if (!got || !got.days || got.days[day] !== true) return;
      var name = clean(txt(f.name, lang)), v = got.vals ? got.vals[day] : undefined;
      if (!name) return;
      if (typeof v === "number" && isFinite(v) && v > 0) name += " " + num(v, lang) + (txt(f.unit, lang) ? " " + clean(txt(f.unit, lang)) : "");
      out.push({ app: typeof f.app === "string" ? f.app : "", text: name });
    });
    return out;
  }
  function block(list, title) {
    if (!list || !list.length) return "";
    return (title ? "**" + clean(title) + "**\n" : "") + list.map(function (x) { return "- " + x.text; }).join("\n");
  }

  var API = { items: items, block: block, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosDiaryDay = API;
})(typeof window !== "undefined" ? window : globalThis);
