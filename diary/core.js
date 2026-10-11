// ============================================================
// orOS One-Sentence Diary — pure core (no DOM)
// One sentence a day; under today's line, the same date in the
// years before ("on this day").
//
//   Data   { ver, days: { "YYYY-MM-DD": day }, tombs: { ymd: ms } }
//   day    { t: text (1-280 chars, one line), e: emoji or "", m: ms }
//          LWW per day + tombstones (R17, R26). A day with no text
//          does not exist (clearing the text deletes the day).
//   Prefs  (device-local, R10) { rem: { on, h, mi } } evening
//          reminder, off by default, only when today has no line.
//
// Days follow the device's local calendar. Before 03:00 the line is
// offered for yesterday when yesterday has none (writingDay).
//
// Used by the app (diary/diary.js), the shell's reminder tick (it
// loads this same file) and the tests.
// UMD: module.exports in Node, window.DiaryCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var MAX_LEN  = 280;
  var LATE_H   = 3;
  var YMD_RE   = /^(\d{4})-(\d{2})-(\d{2})$/;
  var EMOJIS   = ["😊", "😐", "😔", "😴", "🎉", "❤️"];
  var PREFS_KEY = "oros-diary-prefs";

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // ---------- Dates (local calendar) ----------
  function ymdOf(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function parseYmd(s) {
    var m = YMD_RE.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return null;
    var dt = new Date(y, mo - 1, d, 12);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;     // 2026-02-30
    return dt;
  }
  function isYmd(s) { return !!parseYmd(s); }
  function addDays(ymd, n) {
    var d = parseYmd(ymd);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return ymdOf(d);
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function weekday(ymd) { var d = parseYmd(ymd); return d ? (d.getDay() + 6) % 7 : 0; }   // Monday = 0
  function daysInMonth(y, mo) { return new Date(y, mo, 0).getDate(); }                    // mo 1-12

  // The day a line written now belongs to: before 03:00, yesterday
  // when yesterday has no line yet.
  function writingDay(data, now) {
    var today = ymdOf(now);
    if (now.getHours() >= LATE_H) return { day: today, late: false };
    var y = addDays(today, -1);
    return { day: (data && data.days && data.days[y]) ? today : y, late: true, today: today, yesterday: y };
  }

  // ---------- Normalising ----------
  function cleanText(s) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(s).slice(0, MAX_LEN).join("");                    // by characters, not halves of emoji
  }
  function normEmoji(e) { return EMOJIS.indexOf(e) >= 0 ? e : ""; }

  function normDay(raw) {
    if (!raw || typeof raw !== "object") return null;
    var t = cleanText(raw.t);
    if (!t || !isInt(raw.m) || raw.m < 0) return null;
    return { t: t, e: normEmoji(raw.e), m: raw.m };
  }

  function mergeDiary(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!isYmd(k) || !isInt(tm[k]) || tm[k] < 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var best = {};
    [a.days, b.days].forEach(function (days) {
      if (!days || typeof days !== "object" || Array.isArray(days)) return;
      Object.keys(days).forEach(function (k) {
        if (!isYmd(k)) return;
        var d = normDay(days[k]);
        if (!d) return;
        var cur = best[k];
        if (!cur || d.m > cur.m || (d.m === cur.m && JSON.stringify(d) > JSON.stringify(cur))) best[k] = d;
      });
    });
    var out = {};
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      out[k] = best[k];
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { sortedTombs[k] = tombs[k]; });
    return { ver: DATA_VER, days: out, tombs: sortedTombs };
  }

  // A change to one day (text + emoji); empty text = delete.
  // Returns the new data (input untouched).
  function setDay(data, ymd, text, emoji, now) {
    if (!isYmd(ymd)) return data;
    var cur = mergeDiary(data, null);
    var t = cleanText(text);
    var old = cur.days[ymd];
    var m = Math.max(now, (cur.tombs[ymd] || 0) + 1, old ? old.m + 1 : 0);
    var patch = { days: {}, tombs: {} };
    if (t) patch.days[ymd] = { t: t, e: normEmoji(emoji), m: m };
    else if (old) patch.tombs[ymd] = m;
    else return cur;
    return mergeDiary(cur, patch);
  }

  // ---------- Reading ----------
  function sortedDays(data) { return Object.keys((data && data.days) || {}).sort(cmpStr); }

  // Lines of the same date in the years before ymd, newest first.
  // A 29 February line shows on 28 February in the years without one.
  function onThisDay(data, ymd) {
    var d = parseYmd(ymd);
    if (!d || !data || !data.days) return [];
    var y = d.getFullYear(), md = ymd.slice(5);
    var alsoLeap = md === "02-28" && !isLeap(y);
    var out = [];
    Object.keys(data.days).forEach(function (k) {
      var ky = +k.slice(0, 4), kmd = k.slice(5);
      if (ky >= y) return;
      if (kmd === md || (alsoLeap && kmd === "02-29")) {
        var day = data.days[k];
        out.push({ ymd: k, year: ky, ago: y - ky, t: day.t, e: day.e });
      }
    });
    return out.sort(function (p, q) { return q.year - p.year; });
  }

  // { current, longest, total, today } — current counts back from
  // today, or from yesterday while today has no line yet.
  function streak(data, today) {
    var keys = sortedDays(data), set = {};
    keys.forEach(function (k) { set[k] = 1; });
    var start = set[today] ? today : addDays(today, -1), cur = 0;
    while (start && set[start]) { cur++; start = addDays(start, -1); }
    var longest = 0, run = 0, prev = null;
    keys.forEach(function (k) {
      run = (prev && addDays(prev, 1) === k) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    });
    return { current: cur, longest: longest, total: keys.length, today: !!set[today] };
  }

  function monthDays(data, y, mo) {
    var out = [], pre = y + "-" + p2(mo) + "-";
    sortedDays(data).forEach(function (k) { if (k.indexOf(pre) === 0) out.push({ ymd: k, t: data.days[k].t, e: data.days[k].e }); });
    return out;
  }
  function yearDays(data, y) {
    var out = [], pre = y + "-";
    sortedDays(data).forEach(function (k) { if (k.indexOf(pre) === 0) out.push({ ymd: k, t: data.days[k].t, e: data.days[k].e }); });
    return out;
  }
  function years(data) {
    var seen = {};
    sortedDays(data).forEach(function (k) { seen[k.slice(0, 4)] = 1; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
  }

  // Case and accent folding (Greek tonos, Latin accents).
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ς/g, "σ");
  }
  // Every word of q must be in the line. Newest first.
  function search(data, q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var out = [];
    sortedDays(data).reverse().forEach(function (k) {
      var day = data.days[k], f = fold(day.t);
      if (words.every(function (w) { return f.indexOf(w) >= 0; })) out.push({ ymd: k, t: day.t, e: day.e });
    });
    return out;
  }

  function randomDay(data, rnd, notYmd) {
    var keys = sortedDays(data).filter(function (k) { return k !== notYmd; });
    if (!keys.length) return null;
    var k = keys[Math.floor(rnd() * keys.length)];
    return { ymd: k, t: data.days[k].t, e: data.days[k].e };
  }

  // ---------- Export / import ----------
  function toText(data) {
    return sortedDays(data).map(function (k) {
      var d = data.days[k];
      return k + " " + (d.e ? d.e + " " : "") + d.t;
    }).join("\n") + "\n";
  }
  function csvCell(s) { return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s; }
  function toCSV(data) {
    var rows = ["date,text,emoji"];
    sortedDays(data).forEach(function (k) {
      var d = data.days[k];
      rows.push(k + "," + csvCell(d.t) + "," + csvCell(d.e));
    });
    return rows.join("\r\n") + "\r\n";
  }
  function toJSON(data) {
    return JSON.stringify({
      app: "oros-diary", ver: DATA_VER,
      days: sortedDays(data).map(function (k) { var d = data.days[k]; return { date: k, text: d.t, emoji: d.e }; })
    }, null, 2);
  }

  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false, i = 0, s = String(text).replace(/^\ufeff/, "");
    for (; i < s.length; i++) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') { if (s.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === "," || c === ";") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s.charAt(i + 1) === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Dates as YYYY-MM-DD, or DD/MM/YYYY (also with . or -).
  function readDate(s) {
    s = String(s || "").trim();
    if (isYmd(s)) return s;
    var m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
    if (m) { var k = m[3] + "-" + p2(+m[2]) + "-" + p2(+m[1]); return isYmd(k) ? k : null; }
    return null;
  }

  // Any of our exports (JSON, CSV, text) → [{ date, text, emoji }].
  function parseImport(text) {
    var s = String(text || "").replace(/^\ufeff/, "").trim(), out = [];
    if (!s) return out;
    function add(date, t, e) {
      var k = readDate(date), tt = cleanText(t);
      if (k && tt) out.push({ date: k, text: tt, emoji: normEmoji(String(e || "").trim()) });
    }
    if (s.charAt(0) === "{" || s.charAt(0) === "[") {
      var j = null;
      try { j = JSON.parse(s); } catch (e) { return out; }
      var list = Array.isArray(j) ? j : (j && Array.isArray(j.days) ? j.days : null);
      if (list) list.forEach(function (r) { if (r && typeof r === "object") add(r.date, r.text, r.emoji); });
      else if (j && typeof j === "object") Object.keys(j).forEach(function (k) {   // { "2026-10-11": "text" }
        if (typeof j[k] === "string") add(k, j[k], "");
      });
      return out;
    }
    var first = s.split(/\r?\n/)[0];
    if (/^\s*"?date"?\s*[,;]/i.test(first) || /^\d{4}-\d{2}-\d{2}[,;]/.test(first)) {
      parseCSV(s).forEach(function (r, i) {
        if (i === 0 && /^\s*date\s*$/i.test(r[0] || "")) return;
        add(r[0], r[1], r[2]);
      });
      return out;
    }
    s.split(/\r?\n/).forEach(function (line) {                          // "2026-10-11 😊 text"
      var m = /^\s*(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(line);
      if (!m) return;
      var rest = m[2], e = "";
      EMOJIS.forEach(function (em) { if (!e && rest.indexOf(em + " ") === 0) { e = em; rest = rest.slice(em.length + 1); } });
      add(m[1], rest, e);
    });
    return out;
  }

  // Imported lines fill days that have none; a day that already has a
  // line keeps it. → { data, added, kept }
  function importInto(data, rows, now) {
    var cur = mergeDiary(data, null), patch = { days: {} }, added = 0, kept = 0, seen = {};
    rows.forEach(function (r) {
      if (seen[r.date]) return;
      seen[r.date] = 1;
      if (cur.days[r.date]) { kept++; return; }
      patch.days[r.date] = { t: r.text, e: r.emoji, m: Math.max(now, (cur.tombs[r.date] || 0) + 1) };
      added++;
    });
    return { data: mergeDiary(cur, patch), added: added, kept: kept };
  }

  // ---------- Reminder (device-local prefs) ----------
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    var r = p.rem && typeof p.rem === "object" ? p.rem : {};
    return {
      rem: {
        on: r.on === true,
        h: isInt(r.h) && r.h >= 0 && r.h <= 23 ? r.h : 21,
        mi: isInt(r.mi) && r.mi >= 0 && r.mi <= 59 ? r.mi : 30
      }
    };
  }
  // The reminder for now, or null: on, past its time, no line today.
  function reminderDue(data, prefs, now) {
    var r = readPrefs(prefs).rem;
    if (!r.on) return null;
    if (now.getHours() * 60 + now.getMinutes() < r.h * 60 + r.mi) return null;
    var today = ymdOf(now);
    if (data && data.days && data.days[today] && cleanText(data.days[today].t)) return null;
    return { key: "write-" + today, day: today };
  }
  function reminderText(lang, st) {
    var el = lang === "el";
    var title = el ? "Ημερολόγιο μιας πρότασης" : "One-Sentence Diary";
    var body = el ? "Μία φράση για σήμερα;" : "One sentence about today?";
    if (st && st.current > 1) body += el ? " Σερί " + st.current + " ημερών." : " A " + st.current + "-day streak.";
    return { title: title, body: body };
  }

  function fileName(ext, today) { return "diary-" + (today || "all") + "." + ext; }

  var api = {
    VER: DATA_VER, MAX_LEN: MAX_LEN, LATE_H: LATE_H, EMOJIS: EMOJIS.slice(), PREFS_KEY: PREFS_KEY,
    ymdOf: ymdOf, parseYmd: parseYmd, isYmd: isYmd, addDays: addDays, isLeap: isLeap, weekday: weekday,
    daysInMonth: daysInMonth, writingDay: writingDay,
    cleanText: cleanText, normDay: normDay, mergeDiary: mergeDiary, setDay: setDay,
    onThisDay: onThisDay, streak: streak, monthDays: monthDays, yearDays: yearDays, years: years,
    fold: fold, search: search, randomDay: randomDay,
    toText: toText, toCSV: toCSV, toJSON: toJSON, parseCSV: parseCSV, parseImport: parseImport, importInto: importInto,
    readPrefs: readPrefs, reminderDue: reminderDue, reminderText: reminderText, fileName: fileName
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DiaryCore = api;
})(typeof window !== "undefined" ? window : this);
