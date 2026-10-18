// i18n-inline-ok: the Greek day, month, time and repeat words are quick-add parser data, no UI text
// ============================================================
// orOS Calendar — quick add: one line of plain words → an event
// (English and Greek, mixed freely). Pure: no DOM, no storage.
//
//   "Coffee with Nikos Thursday 6pm at Syntagma"
//   "Καφές με Νίκο Πέμπτη 6μμ στο Σύνταγμα"
//   "dentist 15/11 9:30" · "every Monday gym 7am" · "αύριο 10-12 σύσκεψη"
//
// parse(text, { today: "YYYY-MM-DD" }) →
//   { title, date, dateEnd, start, end, recur, location,
//     found: { date, time, repeat, location } }
//   date      always set (today when the line names no day; the next
//             matching weekday for "every Monday …").
//   start/end "HH:MM" or null (null start = all day). A range that
//             ends before it starts runs into the next day (dateEnd).
//   recur     null or { freq: D|W|M|Y, interval: 1|2, until: null,
//             exdates: [], every?, byday? } (calendar/occur.js shape;
//             the app normalises it with normRecur).
//   location  the words after "at" / "@" / «στο, στη, στην, στον, στα,
//             στους» up to the next date or time, else "".
//   title     what is left.
// Rules worth knowing:
//   - Dates are day-first (15/11, 15.11.2026, 15 Nov, 15 Νοεμβρίου);
//     ISO 2026-11-15 too. A day without a year that has passed means
//     next year. "Thursday" on a Thursday is today; "next Thursday"
//     is the Thursday of next week.
//   - A bare hour counts as a time only after "at" / «στις» / "@", with
//     am/pm (μμ/πμ, «το πρωί», «το βράδυ» …), or in a range (10-12).
//     A bare hour of 1–6 without am/pm is read as the afternoon
//     (meetings, not 3 a.m.); with minutes (9:30) it is taken as is.
// Exposes window.OrosCalQuick and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Folding: lower case, no accents, final sigma → σ ----------
  // One character in, one character out, so match positions on the
  // folded copy are positions in the original text.
  function foldChar(c) {
    var l = c.toLowerCase();
    if (l.length !== 1) return c;
    if (l === "ς") return "σ";
    var n = l.normalize ? l.normalize("NFD").replace(/[̀-ͯ]/g, "") : l;
    return n.length === 1 ? n : l;
  }
  function fold(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) out += foldChar(s.charAt(i));
    return out;
  }

  // ---------- Day math (whole UTC days; no DST) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function wdOf(s) { return ((dayNum(s) % 7) + 7 + 4) % 7; }
  function addMonths(s, n) {
    var p = s.split("-"), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return ymd(y, m, Math.min(d, dim));
  }
  function validDay(y, m, d) {
    if (!(m >= 0 && m <= 11 && d >= 1 && y >= 1900 && y <= 2200)) return false;
    return d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }

  // ---------- Words ----------
  var WD_WORDS = [
    [0, "sunday sun κυριακη κυρ"],
    [1, "monday mon δευτερα δευ"],
    [2, "tuesday tues tue τριτη τρι"],
    [3, "wednesday wed τεταρτη τετ"],
    [4, "thursday thurs thur thu πεμπτη πεμ"],
    [5, "friday fri παρασκευη παρ"],
    [6, "saturday sat σαββατο σαβ"]
  ];
  // Plurals ("on Mondays", «τις Δευτέρες») mean every week on that day.
  var WD_PLURAL = [
    [0, "sundays κυριακεσ"], [1, "mondays δευτερεσ"], [2, "tuesdays τριτεσ"],
    [3, "wednesdays τεταρτεσ"], [4, "thursdays πεμπτεσ"], [5, "fridays παρασκευεσ"],
    [6, "saturdays σαββατα"]
  ];
  var MONTH_WORDS = [
    "january jan ιανουαριοσ ιανουαριου ιαν",
    "february feb φεβρουαριοσ φεβρουαριου φεβ",
    "march mar μαρτιοσ μαρτιου μαρ",
    "april apr απριλιοσ απριλιου απρ",
    "may μαιοσ μαιου μαι",
    "june jun ιουνιοσ ιουνιου ιουν",
    "july jul ιουλιοσ ιουλιου ιουλ",
    "august aug αυγουστοσ αυγουστου αυγ",
    "september sept sep σεπτεμβριοσ σεπτεμβριου σεπτ σεπ",
    "october oct οκτωβριοσ οκτωβριου οκτ",
    "november nov νοεμβριοσ νοεμβριου νοε",
    "december dec δεκεμβριοσ δεκεμβριου δεκ"
  ];
  function lookup(list) {
    var map = {}, all = [];
    list.forEach(function (row, i) {
      var key = Array.isArray(row) ? row[0] : i;
      (Array.isArray(row) ? row[1] : row).split(" ").forEach(function (w) { map[w] = key; all.push(w); });
    });
    all.sort(function (a, b) { return b.length - a.length; });     // longest first in alternations
    return { map: map, re: all.join("|") };
  }
  var WD = lookup(WD_WORDS), WDP = lookup(WD_PLURAL), MON = lookup(MONTH_WORDS);

  var L = "0-9a-zα-ω";                       // "word" characters of the folded text
  function wordRe(body) { return new RegExp("(^|[^" + L + "])(" + body + ")(?=$|[^" + L + "])", "g"); }

  // ---------- The scanner: spans already taken never match twice ----------
  function Scanner(text) {
    this.text = text;
    this.f = fold(text);
    this.used = [];
  }
  Scanner.prototype.free = function (a, b) {
    for (var i = 0; i < this.used.length; i++) {
      var u = this.used[i];
      if (a < u[1] && b > u[0]) return false;
    }
    return true;
  };
  // First match of re whose span is free and that fn accepts (fn
  // returns a value, or null to look further). Groups: m[2] = the
  // whole token, m[3]… the body's own groups.
  Scanner.prototype.first = function (re, fn) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(this.f))) {
      var a = m.index + m[1].length, b = a + m[2].length;
      re.lastIndex = m.index + 1;
      if (!m[2] || !this.free(a, b)) continue;
      var v = fn(m.slice(2), a, b);
      if (v !== null && v !== undefined) { this.used.push([a, b]); return v; }
    }
    return null;
  };

  // ---------- Times ----------
  var AP = "(\\s*(?:a\\.m\\.?|p\\.m\\.?|am|pm|π\\.μ\\.?|μ\\.μ\\.?|πμ|μμ)|\\s+(?:το\\s+)?(?:πρωι|μεσημερι|απογευμα|βραδυ)|\\s+in\\s+the\\s+(?:morning|afternoon|evening)|\\s+at\\s+night)?";
  var HM = "(\\d{1,2})(?:[:.](\\d{2}))?";
  function apKind(s) {
    s = (s || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (/^(a\.?m|π\.?μ)/.test(s) || /πρωι|morning/.test(s)) return "am";
    if (/μεσημερι/.test(s)) return "noon";
    return "pm";
  }
  // h, min (or undefined), ap kind → minutes after midnight, or -1.
  function toMin(h, mm, ap) {
    h = +h; var m = mm === undefined || mm === "" ? 0 : +mm;
    if (isNaN(h) || m > 59) return -1;
    if (ap) {
      if (h < 1 || h > 12) return h <= 23 && h > 12 && ap !== "am" ? h * 60 + m : -1;
      if (ap === "am") h = h === 12 ? 0 : h;
      else if (ap === "noon") h = h === 12 ? 12 : (h <= 5 ? h + 12 : h);
      else h = h === 12 ? 12 : h + 12;
    }
    if (h > 24 || (h === 24 && m)) return -1;
    return (h % 24) * 60 + m;
  }
  function hm(min) { return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60); }
  // A bare hour 1–6 (no minutes, no am/pm) is the afternoon.
  function bare(h, mm, ap) { return !ap && (mm === undefined || mm === "") && +h >= 1 && +h <= 6; }

  function findTime(sc) {
    var PRE = "(?:(?:at|from|@|στισ|απο|μεταξυ|between)\\s*)?";
    // Ranges: 10-12, 6-8pm, 10:00–11:30, from 9 to 5, «από 10 έως 12».
    var range = wordRe(PRE + HM + AP + "\\s*(?:-|–|—|to|till|until|and|εωσ|ωσ|μεχρι|και)\\s*" + HM + AP);
    var r = sc.first(range, function (g) {
      var ap1 = apKind(g[3]), ap2 = apKind(g[6]);
      if (+g[1] > 24 || +g[4] > 24) return null;
      // A connector word ("and", «και», "to") between bare numbers is too
      // loose: ask for a dash, a prefix or a marker.
      var conn = /\d\s*(?:[ap]\.?m\.?|[πμ]\.?μ\.?)?\s*[-–—]\s*\d/.test(g[0]);
      var strong = conn || /^(at|from|@|στισ|απο|μεταξυ|between)/.test(g[0]) || ap1 || ap2 || g[2] || g[5];
      if (!strong) return null;
      if (!ap1 && ap2 && ap2 !== "am") {
        // "6-8pm": both afternoon; "11-1pm": 11 am to 1 pm.
        var s12 = +g[1] % 12, e12 = +g[4] % 12;
        ap1 = (+g[1] <= 12 && s12 <= e12) ? "pm" : "am";
      }
      var a = toMin(g[1], g[2], ap1), b = toMin(g[4], g[5], ap2);
      if (a < 0 || b < 0) return null;
      if (!ap1 && !ap2 && bare(g[1], g[2], "") && bare(g[4], g[5], "")) { a += 720; b += 720; }
      else if (!ap1 && bare(g[1], g[2], "")) a += 720;
      if (!ap2 && b <= a && b + 720 > a && b < 720) b += 720;   // 11-1 → 11:00–13:00
      return { start: a % 1440, end: b % 1440 };
    });
    if (r) return r;
    // One time: 6pm, 18:00, 9:30, at 7, «στις 6», 6μμ, «9 το πρωί».
    var one = wordRe("(?:(?:at|@|στισ|απο|from)\\s*)?" + HM + AP);
    r = sc.first(one, function (g) {
      var ap = apKind(g[3]);
      var pre = /^(at|@|στισ|απο|from)/.test(g[0]);
      if (!ap && !g[2] && !pre) return null;          // "Room 4" is not a time
      var a = toMin(g[1], g[2], ap);
      if (a < 0) return null;
      if (bare(g[1], g[2], ap)) a += 720;
      return { start: a % 1440, end: null };
    });
    if (r) return r;
    var named = wordRe("(?:(?:at|στο|το)\\s+)?(noon|midday|midnight|μεσημερι|μεσανυχτα)");
    return sc.first(named, function (g) {
      return { start: /midnight|μεσανυχτα/.test(g[1]) ? 0 : 720, end: null };
    });
  }

  // ---------- Dates ----------
  function yearOf(y) { y = +y; return y < 100 ? 2000 + y : y; }
  // A day without a year: this year, or next year once it has passed.
  function upcoming(today, m, d) {
    var y = +today.slice(0, 4);
    if (!validDay(y, m, d) && !(m === 1 && d === 29)) return null;
    for (var i = 0; i < 9; i++) {
      if (validDay(y + i, m, d)) {
        var s = ymd(y + i, m, d);
        if (s >= today) return s;
      }
    }
    return null;
  }
  function nextWd(today, wd, next) {
    var off = (wd - wdOf(today) + 7) % 7;
    if (!next) return addDays(today, off);
    // "next Friday": that weekday in next week (weeks start on Monday).
    var monday = addDays(today, -((wdOf(today) + 6) % 7));
    return addDays(monday, 7 + (wd + 6) % 7);
  }

  function findDate(sc, today) {
    var PRE = "(?:(?:on|the|την|τη|το|στισ)\\s+)?";
    // ISO first, then numbers with / or . (day first).
    var d = sc.first(wordRe(PRE + "(\\d{4})-(\\d{1,2})-(\\d{1,2})"), function (g) {
      var y = +g[1], m = +g[2] - 1, dd = +g[3];
      return validDay(y, m, dd) ? ymd(y, m, dd) : null;
    });
    if (d) return d;
    // (\\4 = the separator: group 1 is the boundary, 2 the token.)
    d = sc.first(wordRe(PRE + "(\\d{1,2})([/.])(\\d{1,2})(?:\\4(\\d{4}|\\d{2}))?"), function (g) {
      var dd = +g[1], m = +g[3] - 1;
      // 9.05 / 18.00 without a year read as a time, 15.11 as a date.
      if (g[2] === "." && !g[4] && g[3].charAt(0) === "0") return null;
      if (g[4]) { var y = yearOf(g[4]); return validDay(y, m, dd) ? ymd(y, m, dd) : null; }
      return upcoming(today, m, dd);
    });
    if (d) return d;
    // 15 Nov · 15th of November 2026 · «15 Νοεμβρίου» · Nov 15th, 2026.
    d = sc.first(wordRe(PRE + "(\\d{1,2})(?:st|nd|rd|th|η|ησ)?\\s+(?:of\\s+)?(" + MON.re + ")\\.?(?:,?\\s+(\\d{4}))?"), function (g) {
      var m = MON.map[g[2]], dd = +g[1];
      if (g[3]) return validDay(+g[3], m, dd) ? ymd(+g[3], m, dd) : null;
      return upcoming(today, m, dd);
    });
    if (d) return d;
    d = sc.first(wordRe(PRE + "(" + MON.re + ")\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?"), function (g) {
      var m = MON.map[g[1]], dd = +g[2];
      if (g[3]) return validDay(+g[3], m, dd) ? ymd(+g[3], m, dd) : null;
      return upcoming(today, m, dd);
    });
    if (d) return d;
    // Words.
    d = sc.first(wordRe("(?:the\\s+)?day\\s+after\\s+tomorrow|μεθαυριο"), function () { return addDays(today, 2); });
    if (d) return d;
    d = sc.first(wordRe("today|tonight|this\\s+evening|σημερα|αποψε"), function () { return today; });
    if (d) return d;
    d = sc.first(wordRe("tomorrow|tmrw|αυριο"), function () { return addDays(today, 1); });
    if (d) return d;
    d = sc.first(wordRe("(?:in|σε)\\s+(\\d{1,3}|a|one|μια|ενα)\\s+(days?|weeks?|months?|μερεσ|μερα|ημερεσ|εβδομαδεσ|εβδομαδα|μηνεσ|μηνα)"), function (g) {
      var n = /^\d/.test(g[1]) ? +g[1] : 1;
      if (/^(day|μερ|ημερ)/.test(g[2])) return addDays(today, n);
      if (/^(week|εβδομ)/.test(g[2])) return addDays(today, 7 * n);
      return addMonths(today, n);
    });
    if (d) return d;
    d = sc.first(wordRe("next\\s+week|(?:την\\s+)?(?:αλλη|επομενη|ερχομενη)\\s+εβδομαδα"), function () { return nextWd(today, 1, true); });
    if (d) return d;
    var NEXT = "(next|coming|this|(?:την|τη|το)\\s+(?:αλλη|αλλο|επομενη|επομενο|ερχομενη|ερχομενο)|(?:αυτη\\s+την|αυτη\\s+τη|αυτο\\s+το)|on|την|τη|το)?\\s*";
    return sc.first(wordRe(NEXT + "(" + WD.re + ")\\.?"), function (g) {
      var wd = WD.map[g[2]];
      if (wd === undefined) return null;
      // Short forms (τρι, παρ, mon …) only with a lead word or as the
      // whole token; never in front of a number-less ambiguity.
      var nx = !!g[1] && /^(next|coming|την|τη|το)\s+(αλλ|επομ|ερχομ)|^next|^coming/.test(g[1]);
      return nextWd(today, wd, nx);
    });
  }

  // ---------- Repeats ----------
  function weekdaysList(s) {
    var out = [];
    s.split(/[\s,&]+/).forEach(function (w) {
      w = w.replace(/\.$/, "");
      if (WD.map[w] !== undefined && out.indexOf(WD.map[w]) < 0) out.push(WD.map[w]);
      if (WDP.map[w] !== undefined && out.indexOf(WDP.map[w]) < 0) out.push(WDP.map[w]);
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function rule(freq, n, byday) {
    var r = { freq: freq, interval: 1, until: null, exdates: [] };
    if (freq === "W" && n === 2) r.interval = 2;
    else if (n > 1) r.every = Math.min(n, 999);
    if (byday && byday.length) r.byday = byday;
    return r;
  }
  function findRepeat(sc) {
    var WDL = "(?:" + WD.re + "|" + WDP.re + ")\\.?(?:\\s*(?:,|&|and|και)\\s*(?:" + WD.re + "|" + WDP.re + ")\\.?)*";
    var every = wordRe("(?:every|each|καθε)\\s+(?:(other|αλλη|αλλο|δευτερη|δευτερο|\\d{1,3})\\s+)?(" +
      "days?|weeks?|months?|years?|weekdays?|weekends?|μερα|μερεσ|ημερα|ημερεσ|εβδομαδα|εβδομαδεσ|μηνα|μηνεσ|χρονο|χρονια|καθημερινη|σαββατοκυριακο|" + WDL + ")");
    var r = sc.first(every, function (g) {
      var n = !g[1] ? 1 : (/^\d/.test(g[1]) ? +g[1] : 2);
      if (n < 1) return null;
      var u = g[2];
      if (/^(day|μερ|ημερ)/.test(u)) return { rule: rule("D", n) };
      if (/^weekday|^καθημεριν/.test(u)) return { rule: rule("W", n, [1, 2, 3, 4, 5]), wd: [1, 2, 3, 4, 5] };
      if (/^weekend|^σαββατοκυριακο/.test(u)) return { rule: rule("W", n, [0, 6]), wd: [6, 0] };
      if (/^(week|εβδομ)/.test(u)) return { rule: rule("W", n) };
      if (/^(month|μην)/.test(u)) return { rule: rule("M", n) };
      if (/^(year|χρον)/.test(u)) return { rule: rule("Y", n) };
      var days = weekdaysList(u);
      if (!days.length) return null;
      return { rule: rule("W", n, days.length > 1 ? days : null), wd: days };
    });
    if (r) return r;
    r = sc.first(wordRe("daily|everyday|weekly|fortnightly|biweekly|monthly|yearly|annually|καθημερινα|εβδομαδιαια|μηνιαια|ετησια|ετησιωσ"), function (g) {
      var w = g[0];
      if (/daily|everyday|καθημεριν/.test(w)) return { rule: rule("D", 1) };
      if (/fortnight|biweek/.test(w)) return { rule: rule("W", 2) };
      if (/week|εβδομ/.test(w)) return { rule: rule("W", 1) };
      if (/month|μην/.test(w)) return { rule: rule("M", 1) };
      return { rule: rule("Y", 1) };
    });
    if (r) return r;
    r = sc.first(wordRe("(?:on\\s+)?weekdays|(?:τισ\\s+)?καθημερινεσ"), function () {
      return { rule: rule("W", 1, [1, 2, 3, 4, 5]), wd: [1, 2, 3, 4, 5] };
    });
    if (r) return r;
    // "on Mondays", «τις Δευτέρες», «τα Σάββατα».
    var PL = "(?:" + WDP.re + ")(?:\\s*(?:,|&|and|και)\\s*(?:" + WDP.re + "))*";
    return sc.first(wordRe("(?:(?:on|τισ|τα)\\s+)?(" + PL + ")"), function (g) {
      var days = weekdaysList(g[1]);
      if (!days.length) return null;
      return { rule: rule("W", 1, days.length > 1 ? days : null), wd: days };
    });
  }

  // ---------- Location ----------
  var LOC_MARK = new RegExp("(^|[^" + L + "])(@|(?:at|στο|στη|στην|στον|στα|στουσ|στισ)(?=$|[^" + L + "]))", "g");
  function findLocation(sc) {
    var re = LOC_MARK, m;
    re.lastIndex = 0;
    while ((m = re.exec(sc.f))) {
      var a = m.index + m[1].length, b = a + m[2].length;
      re.lastIndex = m.index + 1;
      if (!sc.free(a, b)) continue;
      if (m[2] === "στισ") continue;                  // «στις» is a time word
      // up to the next taken span (a date or a time) or the end
      var end = sc.f.length;
      sc.used.forEach(function (u) { if (u[0] >= b && u[0] < end) end = u[0]; });
      var raw = sc.text.slice(b, end);
      var loc = raw.replace(/^[\s,:;]+/, "").replace(/[\s,;:.\-–—]+$/, "");
      if (!loc || /^\d/.test(loc)) continue;
      sc.used.push([a, b + raw.length]);
      return loc;
    }
    return "";
  }

  // ---------- Title: what is left ----------
  var DANGLE = /^(on|at|from|the|this|next|by|for|in|@|την|τη|το|τισ|στισ|απο|για|σε|και|and|-|–|—|,|;|:)$/;
  function leftover(sc) {
    var keep = [];
    for (var i = 0; i < sc.text.length; i++) {
      var inUsed = false;
      for (var k = 0; k < sc.used.length; k++) {
        if (i >= sc.used[k][0] && i < sc.used[k][1]) { inUsed = true; break; }
      }
      keep.push(inUsed ? "\u0000" : sc.text.charAt(i));
    }
    // Each removed span splits the text; trim dangling small words at
    // the cut points and at both ends.
    var parts = keep.join("").split(/\u0000+/).map(function (p) { return p; });
    var words = [];
    parts.forEach(function (p, pi) {
      var w = p.trim().split(/\s+/).filter(Boolean);
      // trailing dangle before a removed span, leading dangle after one
      if (pi < parts.length - 1) while (w.length && DANGLE.test(fold(w[w.length - 1]))) w.pop();
      if (pi > 0) while (w.length && DANGLE.test(fold(w[0]))) w.shift();
      if (w.length) words.push(w.join(" "));
    });
    var t = words.join(" ").replace(/\s+([,;:.!?])/g, "$1").replace(/\s+/g, " ").trim();
    var ws = t.split(" ");
    while (ws.length && DANGLE.test(fold(ws[0]))) ws.shift();
    while (ws.length && DANGLE.test(fold(ws[ws.length - 1]))) ws.pop();
    return ws.join(" ").replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "");
  }

  // ---------- parse ----------
  function parse(text, opts) {
    opts = opts || {};
    var today = (typeof opts.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.today)) ? opts.today : null;
    if (!today) { var n = new Date(); today = ymd(n.getFullYear(), n.getMonth(), n.getDate()); }
    var src = String(text == null ? "" : text).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
    var sc = new Scanner(src);
    var rep = findRepeat(sc);
    var date = findDate(sc, today);
    var time = findTime(sc);
    var location = findLocation(sc);
    var out = {
      title: leftover(sc).slice(0, 80),
      date: date || today,
      dateEnd: null,
      start: time ? hm(time.start) : null,
      end: time && time.end !== null ? hm(time.end) : null,
      recur: rep ? rep.rule : null,
      location: location.slice(0, 150),
      found: { date: !!date, time: !!time, repeat: !!rep, location: !!location }
    };
    // "every Monday" without a day: the next Monday (today counts).
    if (rep && rep.wd && rep.wd.length && !date) {
      var best = null;
      rep.wd.forEach(function (w) { var d = nextWd(today, w, false); if (!best || d < best) best = d; });
      out.date = best;
    }
    // A weekly rule on one weekday that differs from the chosen day:
    // keep the weekday by naming it.
    if (rep && rep.wd && rep.wd.length === 1 && date && wdOf(date) !== rep.wd[0]) out.recur.byday = rep.wd.slice();
    if (out.start && out.end && out.end <= out.start) {
      if (out.end === out.start) out.end = null;
      else out.dateEnd = addDays(out.date, 1);
    }
    return out;
  }

  var api = { parse: parse, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalQuick = api;
})(typeof window !== "undefined" ? window : null);
