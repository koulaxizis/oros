// ============================================================
// orOS gamekit/daily.js — the shared Daily challenge helpers (v1.0.0)
// NOT an app (no apps.json entry, no slice, no storage). A plain
// script that the puzzle games load next to their own files:
//
//   <script src="../gamekit/daily.js"></script>
//
// It only defines window.orosDaily. Nothing touches the DOM at load
// time, so the file also runs in Node (tests/gamekit.test.js).
// Used by: Sudoku, Nonogram, Flow Free, Minesweeper, Wordle, Crossword
// and the Game Center (gamecenter/).
//
// The same calendar date gives the same puzzle on every device, with
// no network: the seed is "<game>:<YYYY-MM-DD>" (the LOCAL date),
// hashed with FNV-1a into a mulberry32 stream. Day numbers count from
// 1 Jan 2026 = day 0 (the same numbering Wordle, Word Search and
// Crossword have used since 0.45), so "Daily #N" is day N − 1.
//
// API (window.orosDaily):
//   EPOCH_UTC                   Date.UTC(2026, 0, 1)
//   dayIndex(date?) → int       local calendar day of a Date (default now)
//   today() → int               dayIndex(new Date())
//   dateStr(day) → "YYYY-MM-DD" the calendar date of a day number
//   dateLabel(day, lang)        "14 Oct" / "14 Οκτ"
//   seedOf(game, day) → string  "<game>:<YYYY-MM-DD>"
//   hashStr(s) → uint32         FNV-1a
//   random(seed) → fn()         [0, 1) stream; seed: string or integer
//   randInt(seed) → fn(n)       integers in [0, n) from the same stream
//   counter() → fn()            a fake clock that ticks 1 per call, so a
//                               maker with a time budget makes the same
//                               puzzle on a fast and a slow device
//   streaks(days, today)        { cur, best } from { day: truthy } (a
//                               truthy value = a day that counts); the
//                               current streak counts back from today, or
//                               from yesterday when today is not done yet
//   fmtTime(ms)                 "m:ss" / "h:mm:ss"
//   shareText(o)                o = { game, day, line, grid: [rows], label } →
//                               "orOS <game> · <label: Daily> #<n> · <date>\n<line>\n\n<grid>"
//   shareOnMobile() → bool      navigator.share on a phone / tablet only
//                               (desktop browsers open an OS sheet that
//                               mostly cannot paste into a chat)
//   share(text, title) → Promise<"shared"|"copied"|"cancelled"|"failed">
//                               the share sheet on a phone, else the
//                               clipboard
//   hasHub() → bool             the Game Center app is installed
//   openHub(game)               open it (deep link { game })
//   takeTarget(id)              the deep-link target staged for app id
// ============================================================
(function (root) {
  "use strict";

  var EPOCH_UTC = Date.UTC(2026, 0, 1);
  var DAY_MS = 86400000;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function dayIndex(d) {
    d = d || new Date();
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / DAY_MS);
  }
  function today() { return dayIndex(new Date()); }

  function dateStr(day) {
    var d = new Date(EPOCH_UTC + day * DAY_MS);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  // "14 Oct" / "14 Οκτ" (no year), for labels on screen.
  function dateLabel(day, lang) {
    var d = new Date(EPOCH_UTC + day * DAY_MS);
    try {
      var loc = typeof window !== "undefined" && window.orosI18n ? window.orosI18n.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
      return d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" });
    } catch (e) { return dateStr(day); }
  }

  function seedOf(game, day) { return String(game) + ":" + dateStr(day); }

  function hashStr(s) {
    s = String(s);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32
  function random(seed) {
    var a = (typeof seed === "number" ? seed : hashStr(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randInt(seed) {
    var r = random(seed);
    return function (n) { return Math.floor(r() * n); };
  }

  function counter() {
    var n = 0;
    return function () { return n++; };
  }

  function streaks(days, todayIdx) {
    var on = {}, keys = [];
    Object.keys(days || {}).forEach(function (k) {
      if (days[k] && /^-?\d+$/.test(k)) { on[+k] = true; keys.push(+k); }
    });
    var cur = 0, d = on[todayIdx] ? todayIdx : todayIdx - 1;
    while (on[d]) { cur++; d--; }
    keys.sort(function (a, b) { return a - b; });
    var best = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      run = (prev !== null && k === prev + 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = k;
    });
    return { cur: cur, best: best };
  }

  function fmtTime(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    var ss = pad2(s % 60);
    return h ? h + ":" + pad2(m) + ":" + ss : m + ":" + ss;
  }

  // Spoiler-free text: the header, one line of facts, a small grid of
  // emoji that never shows the solution.
  function shareText(o) {
    var head = "orOS " + o.game + " · " + (o.label || "Daily") + " #" + (o.day + 1) + " · " + dateStr(o.day);
    var out = head + (o.line ? "\n" + o.line : "");
    if (o.grid && o.grid.length) out += "\n\n" + o.grid.join("\n");
    return out;
  }

  function shareOnMobile() {
    try {
      if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
      var ua = navigator.userAgent || "";
      if (/Windows NT|Macintosh|X11|CrOS/.test(ua) && !/Android|iPhone|iPad|Mobile/i.test(ua)) return false;
      if (!navigator.maxTouchPoints && !/Android|iPhone|iPad|Mobile/i.test(ua)) return false;
      return true;
    } catch (e) { return false; }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve("copied"); }, function () { resolve(legacyCopy(text)); });
          return;
        }
      } catch (e) {}
      resolve(legacyCopy(text));
    });
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok ? "copied" : "failed";
    } catch (e) { return "failed"; }
  }

  function share(text, title) {
    if (shareOnMobile()) {
      return navigator.share({ title: title || "orOS", text: text }).then(function () { return "shared"; },
        function (err) { return err && err.name === "AbortError" ? "cancelled" : copyText(text); });
    }
    return copyText(text);
  }

  // The Game Center (gamecenter/) is an app of its own: a game shows its
  // "All games" button only when the shell has it installed.
  function shell() {
    try { return root.parent && root.parent !== root ? root.parent : null; } catch (e) { return null; }
  }
  function hasHub() {
    try {
      var p = shell();
      if (!p || typeof p.orosAssistInstalled !== "function") return false;
      return p.orosAssistInstalled().some(function (a) { return a && a.id === "gamecenter"; });
    } catch (e) { return false; }
  }
  function openHub(from) {
    try {
      var p = shell();
      if (p && typeof p.__orosOpenAt === "function") p.__orosOpenAt("gamecenter", { game: String(from || "") });
    } catch (e) {}
  }
  // A deep-link target staged for this game ({ daily: true } from the
  // Game Center), or null.
  function takeTarget(id) {
    try {
      var p = shell();
      return p && typeof p.__orosTakeTarget === "function" ? p.__orosTakeTarget(id) : null;
    } catch (e) { return null; }
  }

  var API = {
    VERSION: "1.0.0",
    hasHub: hasHub,
    openHub: openHub,
    takeTarget: takeTarget,
    EPOCH_UTC: EPOCH_UTC,
    dayIndex: dayIndex,
    today: today,
    dateStr: dateStr,
    dateLabel: dateLabel,
    seedOf: seedOf,
    hashStr: hashStr,
    random: random,
    randInt: randInt,
    counter: counter,
    streaks: streaks,
    fmtTime: fmtTime,
    shareText: shareText,
    shareOnMobile: shareOnMobile,
    share: share
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.orosDaily = API;
})(typeof window !== "undefined" ? window : globalThis);
