// ============================================================
// orOS Typing Tutor: practice minutes for Today, Habits and the
// reminder (TypingDue). Pure: no DOM, never writes storage.
// Reads the synced slice oros-typing-data (TYPING v1) on its own, so
// the shell, Today and Habits need no other file of the app:
//   - read(raw) → { goal minutes, days: {yyyymmdd: ms} } (every
//     device added up, rows older than the reset stamp left out);
//   - the practice reminder (device-local oros-typing-rem
//     {on, at "HH:MM"}, OFF by default, set in the app): once a day
//     from the chosen time on, while today's goal is not reached.
//     The shell emits it (shell.js typingCheckTick), ns "typing";
//   - the Today row (typing/today.js) while the goal is not reached
//     and the person practised in the last 7 days;
//   - the Habits feed row "Typing practice" (minutes a day, done when
//     the goal is reached; generic window.orosHabitFeeds contract,
//     habits/index.html loads this file).
// Loaded by index.html (the shell), Today (apps.json "today") and Habits.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-typing-data";
  var REM_KEY = "oros-typing-rem";
  var REM_DEF = "19:00";
  var HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DAY_KEY = /^(\d{8})\|[a-z0-9]{1,12}$/;
  var ACTIVE_DAYS = 7;

  var T = {
    en: {
      "due.app": "Typing Tutor",
      "due.rem": "{n} of {g} minutes of typing practice today. A few minutes keep your fingers on track.",
      "due.row": "Practise typing: {n} of {g} minutes today",
      "feed.name": "Typing practice",
      "feed.hint": "Minutes in Typing Tutor",
      "feed.unit": "min"
    },
    el: {
      "due.app": "Τυφλό σύστημα",
      "due.rem": "{n} από {g} λεπτά εξάσκησης στο τυφλό σύστημα σήμερα. Λίγα λεπτά κρατούν τα δάχτυλα σε φόρμα.",
      "due.row": "Εξάσκηση στο τυφλό σύστημα: {n} από {g} λεπτά σήμερα",
      "feed.name": "Τυφλό σύστημα",
      "feed.hint": "Λεπτά εξάσκησης στο Τυφλό σύστημα",
      "feed.unit": "λεπ."
    }
  };
  // A pack language (de, …): English overlaid with the "typing" pack
  // when the page has loaded it (i18n.js); English otherwise.
  function words(lang) {
    if (lang === "el" || lang === "en") return T[lang];
    var I = typeof window !== "undefined" && window.orosI18n;
    return I && typeof lang === "string" ? I.table(T, "typing", lang) : T.en;
  }
  function fill(s, p) {
    Object.keys(p).forEach(function (k) { s = s.split("{" + k + "}").join(String(p[k])); });
    return s;
  }

  function ymd(t) {
    var d = new Date(t);
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  function read(raw) {
    var d = raw;
    if (typeof raw === "string") { try { d = JSON.parse(raw); } catch (e) { d = null; } }
    var out = { goal: 10, days: {} };
    if (!d || typeof d !== "object") return out;
    var set = d.set && typeof d.set === "object" ? d.set : {};
    var g = num(set.goal);
    if (g >= 1 && g <= 120) out.goal = Math.round(g);
    var rs = num(set.rs);
    var days = d.days && typeof d.days === "object" ? d.days : {};
    Object.keys(days).forEach(function (k) {
      var mt = DAY_KEY.exec(k), r = days[k];
      if (!mt || !r || typeof r !== "object" || num(r.m) < rs) return;
      var v = num(r.ms);
      if (v > 0 && v <= 864e5) out.days[mt[1]] = (out.days[mt[1]] || 0) + v;
    });
    return out;
  }
  function minutes(sum, day) { return Math.floor((sum.days[day] || 0) / 60000); }
  // Practised on one of the last 7 days (today included)?
  function active(sum, now) {
    var t = new Date(now);
    t.setHours(12, 0, 0, 0);
    for (var i = 0; i < ACTIVE_DAYS; i++) {
      if (sum.days[ymd(t.getTime())] > 0) return true;
      t.setDate(t.getDate() - 1);
    }
    return false;
  }

  function readRem(raw) {
    var r = raw;
    if (typeof raw === "string") { try { r = JSON.parse(raw); } catch (e) { r = null; } }
    r = r && typeof r === "object" ? r : {};
    return { on: r.on === true, at: typeof r.at === "string" && HM.test(r.at) ? r.at : REM_DEF };
  }
  // → { key, n, g } once the reminder time has come on a day the goal is not reached, else null.
  function reminderDue(sum, rem, now) {
    rem = readRem(rem);
    if (!rem.on || !sum) return null;
    var at = new Date(now);
    at.setHours(+rem.at.slice(0, 2), +rem.at.slice(3, 5), 0, 0);
    if (now < at.getTime()) return null;
    var day = ymd(now), n = minutes(sum, day);
    return n < sum.goal ? { key: "practice-" + day, n: n, g: sum.goal } : null;
  }
  function reminderText(n, g, lang) {
    var w = words(lang);
    return { title: w["due.app"], body: fill(w["due.rem"], { n: n, g: g }) };
  }
  // The Today row: null when the goal is reached or nobody practised lately.
  function todayRow(sum, now, lang) {
    if (!active(sum, now)) return null;
    var n = minutes(sum, ymd(now));
    if (n >= sum.goal) return null;
    return fill(words(lang)["due.row"], { n: n, g: sum.goal });
  }

  // ---------- Habits feed ----------
  function dash(k) { return k.slice(0, 4) + "-" + k.slice(4, 6) + "-" + k.slice(6, 8); }
  function feedDays(raw) {
    var sum = read(raw), keys = Object.keys(sum.days);
    if (!keys.length) return null;
    var days = {}, vals = {};
    keys.forEach(function (k) {
      var n = minutes(sum, k);
      vals[dash(k)] = n;
      if (n >= sum.goal) days[dash(k)] = true;
    });
    return { days: days, vals: vals, goal: sum.goal };
  }
  function readKey() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function lang() {
    try {
      var I = root.orosI18n;
      if (I && typeof I.lang === "function") return I.lang();
      return localStorage.getItem("oros-lang") === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>';
  var FEED = {
    id: "typing",
    app: "typing",
    name: { en: T.en["feed.name"], el: T.el["feed.name"] },
    hint: { en: T.en["feed.hint"], el: T.el["feed.hint"] },
    unit: { en: T.en["feed.unit"], el: T.el["feed.unit"] },
    color: "#6f9fd8",
    icon: ICON,
    keys: [KEY],
    read: function () { return feedDays(readKey()); }
  };
  // a pack language gets its words when Habits builds the row
  (function () {
    var l = lang();
    if (l === "en" || l === "el") return;
    var w = words(l);
    FEED.name[l] = w["feed.name"]; FEED.hint[l] = w["feed.hint"]; FEED.unit[l] = w["feed.unit"];
  })();

  var API = {
    KEY: KEY, REM_KEY: REM_KEY, REM_DEF: REM_DEF, ymd: ymd, read: read, minutes: minutes, active: active,
    readRem: readRem, reminderDue: reminderDue, reminderText: reminderText, todayRow: todayRow,
    feedDays: feedDays, FEED: FEED, T: T
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else if (root) {
    root.TypingDue = API;
    // Habits loads this file for its feed row.
    if (root.document && /\/habits\//.test(String(root.location && root.location.pathname))) {
      var feeds = root.orosHabitFeeds = root.orosHabitFeeds || [];
      for (var i = 0; i < feeds.length; i++) if (feeds[i] && feeds[i].id === FEED.id) return;
      feeds.push(FEED);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
