// ============================================================
// orOS Flashcards — "cards waiting" for Today and the reminder
// (FlashcardsDue). The cards live on the orOS disk and their schedule
// is a replay of every answer, too much work for the shell or Today.
// So the app, after each rebuild, writes a small summary to the
// DEVICE-LOCAL key oros-flashcards-due (core.dueSummary); this file
// only reads it:
//   - count(sum, day): cards to study on that day (new + reviews),
//     an estimate on later days (answers given on another device
//     arrive when Flashcards opens there and here);
//   - the study reminder (device-local key oros-flashcards-rem,
//     OFF by default): once a day from the chosen time on, while
//     cards are waiting. The shell emits it (shell.js
//     flashcardsCheckTick) through orosNotifs, ns "flashcards".
// Loaded by index.html (the shell) and by Today (apps.json "today").
// Pure: no DOM, no storage writes. window.FlashcardsDue / module.exports.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-flashcards-due";
  var REM_KEY = "oros-flashcards-rem";
  var YMD = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var REM_DEF = "19:00";
  var T = {
    en: { app: "Flashcards", one: "1 card is waiting for you today.", many: "{n} cards are waiting for you today.",
          row1: "1 card to study", rowN: "{n} cards to study" },
    el: { app: "Κάρτες μελέτης",
          one: "Μια κάρτα σε περιμένει σήμερα.",
          many: "{n} κάρτες σε περιμένουν σήμερα.",
          row1: "1 κάρτα για μελέτη",
          rowN: "{n} κάρτες για μελέτη" }
  };

  function int(x) { x = +x; return isFinite(x) && x > 0 ? Math.min(Math.floor(x), 10000000) : 0; }
  // Raw text (or object) → clean summary | null.
  function read(raw) {
    var s = raw;
    if (typeof raw === "string") { try { s = JSON.parse(raw); } catch (e) { return null; } }
    if (!s || typeof s !== "object" || s.v !== 1 || typeof s.day !== "string" || !YMD.test(s.day)) return null;
    var days = {};
    if (s.days && typeof s.days === "object") {
      Object.keys(s.days).slice(0, 40).forEach(function (k) { if (YMD.test(k) && int(s.days[k])) days[k] = int(s.days[k]); });
    }
    return { v: 1, at: int(s.at), day: s.day, n: int(s.n), rv: int(s.rv), nd: int(s.nd), fresh: int(s.fresh), days: days };
  }
  // Cards to study on `day` ("YYYY-MM-DD"). On the summary's own day it
  // is exact; later, what was left plus what falls due, plus the new
  // cards the deck limits allow in a day.
  function count(sum, day) {
    if (!sum || !YMD.test(String(day)) || day < sum.day) return 0;
    if (day === sum.day) return sum.n + sum.rv;
    var due = sum.rv;
    Object.keys(sum.days).forEach(function (k) { if (k <= day) due += sum.days[k]; });
    return due + Math.min(sum.fresh, sum.nd);
  }
  function ymd(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  function readRem(raw) {
    var r = raw;
    if (typeof raw === "string") { try { r = JSON.parse(raw); } catch (e) { r = null; } }
    r = r && typeof r === "object" ? r : {};
    return { on: r.on === true, at: typeof r.at === "string" && HM.test(r.at) ? r.at : REM_DEF };
  }
  // → { key, n } once the reminder time has come on a day with cards waiting, else null.
  function reminderDue(sum, rem, now) {
    rem = readRem(rem);
    if (!rem.on || !sum) return null;
    var at = new Date(now);
    at.setHours(+rem.at.slice(0, 2), +rem.at.slice(3, 5), 0, 0);
    if (now < at.getTime()) return null;
    var day = ymd(now), n = count(sum, day);
    return n > 0 ? { key: "study-" + day, n: n } : null;
  }
  // A pack language (de, …): English overlaid with the "flashcards" pack,
  // when the page has loaded it (i18n.js); English otherwise.
  function words(lang) {
    if (lang === "el" || lang === "en") return T[lang];
    var I = typeof window !== "undefined" && window.orosI18n;
    return I && typeof lang === "string" ? I.table(T, "flashcards", lang) : T.en;
  }
  function reminderText(n, lang) {
    var w = words(lang);
    return { title: w.app, body: n === 1 ? w.one : w.many.replace("{n}", n) };
  }
  function rowText(n, lang) {
    var w = words(lang);
    return n === 1 ? w.row1 : w.rowN.replace("{n}", n);
  }

  var API = { KEY: KEY, REM_KEY: REM_KEY, REM_DEF: REM_DEF, read: read, count: count, ymd: ymd,
              readRem: readRem, reminderDue: reminderDue, reminderText: reminderText, rowText: rowText };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsDue = API;
})(typeof window !== "undefined" ? window : globalThis);
