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
// Wave 30 (additive; both keys exist only when non-empty, so an
// untouched diary keeps the exact v1 shape — a device on the previous
// core drops unknown keys in its merge, and union means its copy can
// never delete them):
//   long    { ymd: { md?, ph?, loc?, wx? } } — the optional long entry
//           of a day, each field { v, m }, LWW PER FIELD (tie: larger
//           JSON). A field never set is absent; clearing writes the
//           empty value with a new stamp (it stays as a tombstone).
//           md  markdown text (≤ 20 000 characters)
//           ph  photo file names on the orOS disk (≤ 4, PHOTO_DIR)
//           loc { n: name, la, lo } (coords rounded to 0.01°) | null
//           wx  { c: WMO code, hi, lo } (°C, one decimal) | null
//   prompts { id: { t, m, x? } } — the user's own daily questions,
//           LWW per id, x = deleted (soft delete, never comes back).
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

  // ---------- Wave 30: long entries + own prompts ----------
  var MD_MAX = 20000, PH_MAX = 4, LOCN_MAX = 80, PROMPT_MAX = 200;
  var PHOTO_DIR = "/internal/Diary/Photos";
  var PH_RE = /^\d{8}-[a-z0-9]{6,16}\.jpg$/;
  var LONG_FIELDS = ["md", "ph", "loc", "wx"];
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function cleanMd(s) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    try { s = s.normalize("NFC"); } catch (e) {}
    s = s.replace(/[ \t]+$/gm, "").replace(/^\n+|\s+$/g, "");
    return Array.from(s).slice(0, MD_MAX).join("");
  }
  function oneLine(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(s).slice(0, max).join("");
  }
  function coarse(x) { return Math.round(x * 100) / 100; }
  function normPh(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    v.forEach(function (n) { if (typeof n === "string" && PH_RE.test(n) && out.indexOf(n) < 0 && out.length < PH_MAX) out.push(n); });
    return out;
  }
  function normLoc(v) {
    if (!v || typeof v !== "object") return null;
    var n = oneLine(v.n, LOCN_MAX), o = {};
    if (n) o.n = n;
    if (isNum(v.la) && isNum(v.lo) && Math.abs(v.la) <= 90 && Math.abs(v.lo) <= 180) { o.la = coarse(v.la); o.lo = coarse(v.lo); }
    return (o.n || o.la !== undefined) ? o : null;
  }
  function normWx(v) {
    if (!v || typeof v !== "object" || !isInt(v.c) || v.c < 0 || v.c > 99) return null;
    var o = { c: v.c };
    if (isNum(v.hi) && Math.abs(v.hi) < 80) o.hi = Math.round(v.hi * 10) / 10;
    if (isNum(v.lo) && Math.abs(v.lo) < 80) o.lo = Math.round(v.lo * 10) / 10;
    return o;
  }
  var LONG_NORM = { md: cleanMd, ph: normPh, loc: normLoc, wx: normWx };
  function normField(f, raw) {
    if (!raw || typeof raw !== "object" || !isInt(raw.m) || raw.m < 0) return null;
    return { v: LONG_NORM[f](raw.v), m: raw.m };
  }
  function pickField(x, y) {
    if (!x) return y;
    if (!y) return x;
    if (x.m !== y.m) return x.m > y.m ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }
  function mergeLong(A, B) {
    var out = {}, keys = {};
    [A, B].forEach(function (L) {
      if (!L || typeof L !== "object" || Array.isArray(L)) return;
      Object.keys(L).forEach(function (k) { if (isYmd(k) && L[k] && typeof L[k] === "object") keys[k] = 1; });
    });
    Object.keys(keys).sort(cmpStr).forEach(function (k) {
      var item = {}, any = false;
      LONG_FIELDS.forEach(function (f) {
        var x = A && A[k] ? normField(f, A[k][f]) : null;
        var y = B && B[k] ? normField(f, B[k][f]) : null;
        var w = pickField(x, y);
        if (w) { item[f] = w; any = true; }
      });
      if (any) out[k] = item;
    });
    return out;
  }
  function normPrompt(p) {
    if (!p || typeof p !== "object" || !isInt(p.m) || p.m < 0) return null;
    var t = oneLine(p.t, PROMPT_MAX);
    if (!t && !p.x) return null;
    var o = { t: t, m: p.m };
    if (p.x) o.x = 1;
    return o;
  }
  function mergePrompts(A, B) {
    var map = {};
    [A, B].forEach(function (P) {
      if (!P || typeof P !== "object" || Array.isArray(P)) return;
      Object.keys(P).forEach(function (id) {
        if (!/^[a-z0-9-]{4,40}$/.test(id)) return;
        var p = normPrompt(P[id]);
        if (!p) return;
        map[id] = pickField(map[id], p);
      });
    });
    var out = {};
    Object.keys(map).sort(cmpStr).forEach(function (id) { out[id] = map[id]; });
    return out;
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
    var res = { ver: DATA_VER, days: out, tombs: sortedTombs };
    var lg = mergeLong(a.long, b.long);
    if (Object.keys(lg).length) res.long = lg;
    var pr = mergePrompts(a.prompts, b.prompts);
    if (Object.keys(pr).length) res.prompts = pr;
    return res;
  }

  // The long entry of a day as plain values ({ md, ph, loc, wx }),
  // empty values when never set.
  function longOf(data, ymd) {
    var L = data && data.long && data.long[ymd];
    return {
      md: L && L.md ? L.md.v : "", ph: L && L.ph ? L.ph.v.slice() : [],
      loc: L && L.loc ? L.loc.v : null, wx: L && L.wx ? L.wx.v : null
    };
  }
  function hasLong(data, ymd) {
    var l = longOf(data, ymd);
    return !!(l.md || l.ph.length || l.loc || l.wx);
  }
  // One field of a day's long entry; the stamp always moves forward.
  // Returns the new data (input untouched).
  function setLong(data, ymd, field, value, now) {
    if (!isYmd(ymd) || LONG_FIELDS.indexOf(field) < 0) return data;
    var cur = mergeDiary(data, null);
    var old = cur.long && cur.long[ymd] && cur.long[ymd][field];
    var v = LONG_NORM[field](value);
    if (old && JSON.stringify(old.v) === JSON.stringify(v)) return cur;
    if (!old && (v === "" || v === null || (Array.isArray(v) && !v.length))) return cur;   // nothing to say
    var patch = { long: {} };
    patch.long[ymd] = {};
    patch.long[ymd][field] = { v: v, m: Math.max(now, old ? old.m + 1 : 0) };
    return mergeDiary(cur, patch);
  }
  // Every photo name any long entry points at.
  function photosOf(data) {
    var out = [];
    Object.keys((data && data.long) || {}).forEach(function (k) {
      var p = data.long[k].ph;
      (p ? p.v : []).forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
    });
    return out;
  }
  function photoPath(name) { return typeof name === "string" && PH_RE.test(name) ? PHOTO_DIR + "/" + name : null; }
  function photoName(ymd, rand) {
    var r = String(rand || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
    if (!isYmd(ymd) || r.length < 6) return null;
    return ymd.replace(/-/g, "") + "-" + r + ".jpg";
  }
  function livePrompts(data) {
    var P = (data && data.prompts) || {}, out = [];
    Object.keys(P).sort(cmpStr).forEach(function (id) { if (!P[id].x && P[id].t) out.push({ id: id, t: P[id].t }); });
    return out;
  }
  function setPrompt(data, id, text, del, now) {
    var cur = mergeDiary(data, null), old = cur.prompts && cur.prompts[id];
    var p = { t: oneLine(text, PROMPT_MAX), m: Math.max(now, old ? old.m + 1 : 0) };
    if (del) { p.x = 1; p.t = old ? old.t : p.t; }
    else if (!p.t) return cur;
    var patch = { prompts: {} };
    patch.prompts[id] = p;
    return mergeDiary(cur, patch);
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
  // Wave 30: the long entry (text and place) is searched too; a day
  // with only a long entry shows the start of its text.
  function search(data, q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var out = [], keys = {};
    sortedDays(data).forEach(function (k) { keys[k] = 1; });
    Object.keys((data && data.long) || {}).forEach(function (k) { if (hasLong(data, k)) keys[k] = 1; });
    Object.keys(keys).sort(cmpStr).reverse().forEach(function (k) {
      var day = data.days[k], l = longOf(data, k);
      var f = fold((day ? day.t : "") + "\n" + l.md + "\n" + (l.loc && l.loc.n ? l.loc.n : ""));
      if (words.every(function (w) { return f.indexOf(w) >= 0; })) {
        out.push({ ymd: k, t: day ? day.t : oneLine(l.md.replace(/[#*_>\x60\[\]()-]+/g, " "), 120), e: day ? day.e : "" });
      }
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
  // The reminder (shown by the shell). Pack "diary" (../i18n.js) adds
  // other languages where it is loaded; English otherwise.
  var STR = {
    en: {
      "rem.title": "One-Sentence Diary",
      "rem.body": "One sentence about today?",
      "rem.streak": "One sentence about today? A {n}-day streak."
    },
    el: {
      "rem.title": "Ημερολόγιο μιας πρότασης",
      "rem.body": "Μία φράση για σήμερα;",
      "rem.streak": "Μία φράση για σήμερα; Σερί {n} ημερών."
    }
  };
  function strOf(lang) {
    var L = typeof lang === "string" && lang ? lang : "en";
    var I = root && root.orosI18n;
    if (!STR[L] && I && typeof I.table === "function") I.table(STR, "diary", L);
    return STR[L] || STR.en;
  }
  function reminderText(lang, st) {
    var S = strOf(lang);
    var body = st && st.current > 1 ? S["rem.streak"].replace("{n}", String(st.current)) : S["rem.body"];
    return { title: S["rem.title"], body: body };
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
    readPrefs: readPrefs, reminderDue: reminderDue, reminderText: reminderText, fileName: fileName,
    MD_MAX: MD_MAX, PH_MAX: PH_MAX, PHOTO_DIR: PHOTO_DIR, PH_RE: PH_RE, LONG_FIELDS: LONG_FIELDS.slice(),
    cleanMd: cleanMd, coarse: coarse, normLoc: normLoc, normWx: normWx, mergeLong: mergeLong, mergePrompts: mergePrompts,
    longOf: longOf, hasLong: hasLong, setLong: setLong, photosOf: photosOf, photoPath: photoPath, photoName: photoName,
    livePrompts: livePrompts, setPrompt: setPrompt
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DiaryCore = api;
})(typeof window !== "undefined" ? window : this);
