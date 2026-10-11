// ============================================================
// orOS One-Sentence Diary — App logic (v1.0.0)
// One sentence a day, ten seconds. Under the day's line, the same
// date in the years before ("on this day").
//   - Today: the line (up to 280 characters, saved as you type),
//     an optional emoji, on this day, streak; any past day can be
//     written or fixed (arrows, calendar); before 03:00 the line is
//     offered for yesterday
//   - My days: a month calendar with the days written, the month's
//     lines, search in every line
//   - Year: every line of a year on one page, printable
//   - Settings: evening reminder (device-local, off by default; the
//     shell fires it with the app closed), export TXT/CSV/JSON,
//     import (fills empty days only)
// Data:
//   - synced slice "diary" (oros-diary-data): LWW per day +
//     tombstones (R5, R17, R26); clearing a line deletes the day
//   - device-local (R10): oros-diary-prefs (reminder), the open tab
// Deep link: __orosOpenAt("diary", { day: "YYYY-MM-DD" }) opens a day
// (reminder, universal search).
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Writing a day
//   4. On this day, stats, header
//   5. My days: calendar, search
//   6. Year
//   7. Settings: reminder, export, import
//   8. Tabs, toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.DiaryCore;
  var STORAGE_KEY = "oros-diary-data";
  var PREFS_KEY   = C.PREFS_KEY;
  var SAVE_MS     = 500;
  var VIEWS       = ["today", "days", "year"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app.name": "One-Sentence Diary",
      "sub.write": "Today's line is waiting", "sub.done": "Today is written",
      "sub.streak": "{n}-day streak",
      "tab.today": "Today", "tab.days": "My days", "tab.year": "Year",
      "btn.rand": "A random memory", "btn.more": "Diary settings", "btn.close": "Close",
      "btn.prev": "Day before", "btn.next": "Day after", "btn.today": "Back to today",
      "btn.mprev": "Month before", "btn.mnext": "Month after",
      "btn.delete": "Delete this day", "btn.print": "Print",
      "btn.txt": "Text", "btn.csv": "CSV", "btn.json": "JSON", "btn.import": "Choose a file",
      "rel.today": "Today", "rel.yesterday": "Yesterday", "rel.ago": "{n} days ago",
      "late.q": "After midnight. This line is for:", "late.yesterday": "Yesterday", "late.today": "Today",
      "f.line": "One sentence about this day", "f.emoji": "Emoji of the day", "f.search": "Search your days",
      "f.year": "Year",
      "ph.today": "One sentence about today…", "ph.day": "One sentence about this day…",
      "ph.search": "Search your days",
      "st.saved": "Saved", "st.saving": "Saving…", "st.empty": "",
      "count.left": "{n} left",
      "emoji.none": "No emoji", "emoji.pick": "Emoji {e}",
      "sec.otd": "On this day",
      "otd.ago1": "A year ago", "otd.agoN": "{n} years ago",
      "otd.empty": "In a year, what you write today will appear here.",
      "otd.emptyDay": "Nothing on this date in the years before.",
      "stats": "Streak {cur} · Longest {long} · {total} days written",
      "stats.none": "Your first line starts the diary.",
      "month.empty": "No lines this month.",
      "res.count": "{n} days found", "res.count1": "1 day found", "res.none": "Nothing found.",
      "year.empty": "No lines in this year yet.", "year.count": "{n} days",
      "more.title": "Diary settings", "sec.rem": "Evening reminder",
      "rem.on": "Remind me when I have not written today", "rem.time": "At",
      "rem.hint": "Reminders appear while orOS is open (also with this app closed). With orOS closed they wait for the next time you open it. This setting stays on this device.",
      "sec.export": "Export", "sec.import": "Import",
      "imp.hint": "A CSV, JSON or text file with a date and a line per day (like the exports). Days that already have a line keep it.",
      "toast.deleted": "Day deleted", "toast.undo": "Undo",
      "toast.saveFail": "Could not save: storage is full", "toast.file": "Saved",
      "toast.imported": "Added {a} days, {k} already had a line", "toast.impNone": "No days found in this file",
      "toast.impFail": "Could not read this file",
      "toast.noRand": "Write a few days first",
      "aria.day": "{date}: {text}", "aria.dayEmpty": "{date}: no line", "aria.today": "today"
    },
    el: {
      "app.name": "Ημερολόγιο μιας πρότασης",
      "sub.write": "Η σημερινή φράση σε περιμένει", "sub.done": "Η σημερινή μέρα γράφτηκε",
      "sub.streak": "Σερί {n} ημερών",
      "tab.today": "Σήμερα", "tab.days": "Οι μέρες μου", "tab.year": "Χρονιά",
      "btn.rand": "Μια τυχαία ανάμνηση", "btn.more": "Ρυθμίσεις ημερολογίου", "btn.close": "Κλείσιμο",
      "btn.prev": "Προηγούμενη μέρα", "btn.next": "Επόμενη μέρα", "btn.today": "Πίσω στο σήμερα",
      "btn.mprev": "Προηγούμενος μήνας", "btn.mnext": "Επόμενος μήνας",
      "btn.delete": "Διαγραφή μέρας", "btn.print": "Εκτύπωση",
      "btn.txt": "Κείμενο", "btn.csv": "CSV", "btn.json": "JSON", "btn.import": "Επιλογή αρχείου",
      "rel.today": "Σήμερα", "rel.yesterday": "Χθες", "rel.ago": "Πριν από {n} μέρες",
      "late.q": "Πέρασαν τα μεσάνυχτα. Η φράση είναι για:", "late.yesterday": "Χθες", "late.today": "Σήμερα",
      "f.line": "Μία φράση για αυτή τη μέρα", "f.emoji": "Emoji της μέρας", "f.search": "Αναζήτηση στις μέρες σου",
      "f.year": "Έτος",
      "ph.today": "Μία φράση για σήμερα…", "ph.day": "Μία φράση για αυτή τη μέρα…",
      "ph.search": "Αναζήτηση στις μέρες σου",
      "st.saved": "Αποθηκεύτηκε", "st.saving": "Αποθήκευση…", "st.empty": "",
      "count.left": "Απομένουν {n}",
      "emoji.none": "Χωρίς emoji", "emoji.pick": "Emoji {e}",
      "sec.otd": "Σαν σήμερα",
      "otd.ago1": "Πριν από ένα χρόνο", "otd.agoN": "Πριν από {n} χρόνια",
      "otd.empty": "Σε έναν χρόνο, ό,τι γράψεις σήμερα θα εμφανιστεί εδώ.",
      "otd.emptyDay": "Τίποτα σε αυτή την ημερομηνία τα προηγούμενα χρόνια.",
      "stats": "Σερί {cur} · Μεγαλύτερο {long} · {total} μέρες γραμμένες",
      "stats.none": "Η πρώτη σου φράση ξεκινά το ημερολόγιο.",
      "month.empty": "Καμία φράση αυτόν τον μήνα.",
      "res.count": "Βρέθηκαν {n} μέρες", "res.count1": "Βρέθηκε 1 μέρα", "res.none": "Δεν βρέθηκε τίποτα.",
      "year.empty": "Καμία φράση σε αυτή τη χρονιά ακόμα.", "year.count": "{n} μέρες",
      "more.title": "Ρυθμίσεις ημερολογίου", "sec.rem": "Βραδινή υπενθύμιση",
      "rem.on": "Υπενθύμισέ μου όταν δεν έχω γράψει σήμερα", "rem.time": "Στις",
      "rem.hint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Με κλειστό το orOS περιμένουν το επόμενο άνοιγμα. Η ρύθμιση μένει σε αυτή τη συσκευή.",
      "sec.export": "Εξαγωγή", "sec.import": "Εισαγωγή",
      "imp.hint": "Αρχείο CSV, JSON ή κειμένου με ημερομηνία και φράση ανά μέρα (όπως οι εξαγωγές). Οι μέρες που έχουν ήδη φράση την κρατούν.",
      "toast.deleted": "Η μέρα διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.file": "Αποθηκεύτηκε",
      "toast.imported": "Προστέθηκαν {a} μέρες, {k} είχαν ήδη φράση", "toast.impNone": "Δεν βρέθηκαν μέρες σε αυτό το αρχείο",
      "toast.impFail": "Δεν διαβάστηκε αυτό το αρχείο",
      "toast.noRand": "Γράψε πρώτα μερικές μέρες",
      "aria.day": "{date}: {text}", "aria.dayEmpty": "{date}: χωρίς φράση", "aria.today": "σήμερα"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function num(n) { try { return n.toLocaleString(LOCALE); } catch (e) { return String(n); } }
  function fmt(ymd, opts) {
    var d = C.parseYmd(ymd);
    if (!d) return ymd;
    try { return d.toLocaleDateString(LOCALE, opts); } catch (e) { return ymd; }
  }
  // The month on its own, in the nominative (el: "Οκτώβριος", not
  // the "Οκτωβρίου" of a full date): the month part of "month year".
  function monthName(ymd) {
    var d = C.parseYmd(ymd);
    try {
      var parts = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "month") return parts[i].value;
    } catch (e) {}
    return fmt(ymd, { month: "long" });
  }
  function longDate(ymd) { return fmt(ymd, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  function shortDate(ymd) { return fmt(ymd, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
  function todayYmd() { return C.ymdOf(new Date()); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("diary.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, days: {}, tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object") {
          data = C.mergeDiary(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] diary: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, days: {}, tombs: {} };
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    prefs = C.readPrefs(raw);
    prefs.view = raw && VIEWS.indexOf(raw.view) >= 0 ? raw.view : "today";
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Writing a day ----------
  var day = null;            // the day being written (ymd)
  var lateChoice = null;     // before 03:00: the day picked for the line
  var pendEmoji = null;      // emoji picked for a day with no line yet
  var editTimer = null;

  function lineOf(ymd) { return data.days[ymd] || null; }

  function commit() {
    clearTimeout(editTimer); editTimer = null;
    var text = C.cleanText($("line").value);
    var cur = lineOf(day);
    var emoji = cur ? cur.e : (pendEmoji || "");
    if (cur && cur.t === text) return;
    if (!cur && !text) return;
    data = C.setDay(data, day, text, emoji, Date.now());
    if (text) pendEmoji = null;
    save();
    $("status").textContent = text ? t("st.saved") : "";
    renderAfterEdit();
  }
  function commitSoon() {
    clearTimeout(editTimer);
    $("status").textContent = t("st.saving");
    editTimer = setTimeout(commit, SAVE_MS);
  }
  function flush() { if (editTimer) commit(); }

  function onLineInput() {
    var ta = $("line"), chars = Array.from(ta.value);
    var clean = ta.value.replace(/[\r\n]+/g, " ");
    if (chars.length > C.MAX_LEN || clean !== ta.value) {
      var pos = ta.selectionStart;
      ta.value = Array.from(clean).slice(0, C.MAX_LEN).join("");
      try { ta.setSelectionRange(pos, pos); } catch (e) {}
    }
    renderCount();
    commitSoon();
  }

  function renderCount() {
    var n = Array.from($("line").value).length, left = C.MAX_LEN - n, c = $("count");
    c.hidden = left > 40;
    c.textContent = t("count.left", { n: left });
    c.classList.toggle("low", left <= 10);
  }

  function setEmoji(e) {
    var cur = lineOf(day);
    var next = (cur ? cur.e : pendEmoji) === e ? "" : e;     // tap again = none
    if (cur) {
      flush();
      cur = lineOf(day);
      if (cur) { data = C.setDay(data, day, cur.t, next, Date.now()); save(); }
    } else pendEmoji = next || null;
    renderEmojis();
    renderAfterEdit();
  }

  function renderEmojis() {
    var host = $("emojis"), cur = lineOf(day), curE = cur ? cur.e : (pendEmoji || "");
    host.innerHTML = "";
    C.EMOJIS.forEach(function (e) {
      var on = e === curE;
      var b = el("button", "emoji" + (on ? " on" : ""), e);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on || (!curE && e === C.EMOJIS[0]) ? 0 : -1;
      setLabel(b, t("emoji.pick", { e: e }));
      b.addEventListener("click", function () { setEmoji(e); });
      host.appendChild(b);
    });
    host.onkeydown = function (ev) {
      var d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : (ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      ev.preventDefault();
      var btns = host.querySelectorAll("button"), i = [].indexOf.call(btns, document.activeElement);
      var j = (Math.max(0, i) + d + btns.length) % btns.length;
      btns[j].focus();
    };
  }

  function relText(ymd) {
    var today = todayYmd();
    if (ymd === today) return t("rel.today");
    if (ymd === C.addDays(today, -1)) return t("rel.yesterday");
    var a = C.parseYmd(ymd), b = C.parseYmd(today);
    var n = Math.round((b - a) / 86400000);
    return t("rel.ago", { n: num(n) });
  }

  // Opens a day for writing (never a day after today).
  function openDay(ymd, focus) {
    var today = todayYmd();
    if (!C.isYmd(ymd) || ymd > today) ymd = today;
    flush();
    day = ymd; pendEmoji = null;
    renderDay();
    showView("today");
    if (focus) { var ta = $("line"); ta.focus(); var L = ta.value.length; try { ta.setSelectionRange(L, L); } catch (e) {} }
  }

  function renderLate() {
    var box = $("late"), w = C.writingDay(data, new Date());
    var show = w.late && (day === w.today || day === w.yesterday) && (lateChoice !== null || day === w.day);
    box.hidden = !show;
    if (!show) return;
    var host = $("late-chips");
    host.innerHTML = "";
    [["yesterday", w.yesterday], ["today", w.today]].forEach(function (p) {
      var on = day === p[1];
      var b = el("button", "chip" + (on ? " on" : ""), t("late." + p[0]) + " · " + fmt(p[1], { day: "numeric", month: "short" }));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", function () { lateChoice = p[1]; openDay(p[1], true); });
      host.appendChild(b);
    });
  }

  function renderDay() {
    var today = todayYmd(), cur = lineOf(day), ta = $("line");
    $("day-title").textContent = longDate(day);
    $("day-rel").textContent = relText(day);
    $("today-btn").hidden = day === today || (C.writingDay(data, new Date()).late && day === C.addDays(today, -1));
    $("next-btn").disabled = day >= today;
    if (document.activeElement !== ta || !editTimer) ta.value = cur ? cur.t : "";
    ta.placeholder = day === today ? t("ph.today") : t("ph.day");
    $("status").textContent = "";
    $("del-btn").hidden = !cur;
    renderCount();
    renderEmojis();
    renderLate();
    renderOtd();
    renderStats();
    renderHead();
  }

  function renderAfterEdit() {
    $("del-btn").hidden = !lineOf(day);
    renderStats(); renderHead();
    calDirty = yearDirty = true;
  }

  function deleteDay() {
    var cur = lineOf(day);
    if (!cur) return;
    clearTimeout(editTimer); editTimer = null;
    var snap = { ymd: day, t: cur.t, e: cur.e };
    data = C.setDay(data, day, "", "", Date.now());
    save();
    renderDay();
    calDirty = yearDirty = true;
    undoToast(t("toast.deleted"), function () {
      data = C.setDay(data, snap.ymd, snap.t, snap.e, Date.now());    // R17: newer than the tombstone
      save();
      openDay(snap.ymd);
    });
  }

  // ---------- 4. On this day, stats, header ----------
  function lineItem(ymd, text, emoji, label, onOpen) {
    var li = el("li", "line-item");
    var b = el("button", "line-open");
    b.type = "button";
    var head = el("span", "line-date", label);
    b.appendChild(head);
    var body = el("span", "line-text");
    if (emoji) body.appendChild(el("span", "line-emoji", emoji));
    body.appendChild(document.createTextNode(text));
    b.appendChild(body);
    b.addEventListener("click", onOpen || function () { openDay(ymd); });
    li.appendChild(b);
    return li;
  }

  function renderOtd() {
    var list = C.onThisDay(data, day), host = $("otd-list");
    host.innerHTML = "";
    $("otd-title").textContent = day === todayYmd() ? t("sec.otd") : t("sec.otd") + " · " + fmt(day, { day: "numeric", month: "long" });
    list.forEach(function (o) {
      var ago = o.ago === 1 ? t("otd.ago1") : t("otd.agoN", { n: o.ago });
      host.appendChild(lineItem(o.ymd, o.t, o.e, o.year + " · " + ago));
    });
    var empty = $("otd-empty");
    empty.hidden = list.length > 0;
    empty.textContent = Object.keys(data.days).length && day !== todayYmd() ? t("otd.emptyDay") : t("otd.empty");
  }

  function renderStats() {
    var st = C.streak(data, todayYmd());
    $("stats").textContent = st.total ? t("stats", { cur: num(st.current), long: num(st.longest), total: num(st.total) })
                                      : t("stats.none");
  }

  function renderHead() {
    var st = C.streak(data, todayYmd());
    $("title-view").textContent = t("app.name");
    var sub = st.today ? t("sub.done") : t("sub.write");
    if (st.current > 1) sub = t("sub.streak", { n: num(st.current) }) + " · " + sub;
    $("title-sub").textContent = sub;
  }

  // ---------- 5. My days: calendar, search ----------
  var month = null;          // { y, m } shown in the calendar
  var calDirty = true;

  function weekdayNames() {
    var out = [], base = new Date(2024, 0, 1, 12);   // a Monday
    for (var i = 0; i < 7; i++) {
      var d = new Date(base); d.setDate(1 + i);
      try { out.push(d.toLocaleDateString(LOCALE, { weekday: "short" })); } catch (e) { out.push("MTWTFSS".charAt(i)); }
    }
    return out;
  }

  function renderCalendar() {
    calDirty = false;
    var y = month.y, m = month.m, today = todayYmd();
    var first = y + "-" + (m < 10 ? "0" : "") + m + "-01";
    $("month-title").textContent = fmt(first, { month: "long", year: "numeric" });
    var lastMonth = +today.slice(0, 4) * 12 + +today.slice(5, 7);
    $("mnext-btn").disabled = y * 12 + m >= lastMonth;
    var grid = $("grid");
    grid.innerHTML = "";
    var head = el("div", "grid-row grid-head");
    head.setAttribute("role", "row");
    weekdayNames().forEach(function (n) { var c = el("span", "grid-wd", n); c.setAttribute("role", "columnheader"); head.appendChild(c); });
    grid.appendChild(head);
    var pad = C.weekday(first), n = C.daysInMonth(y, m), cells = [];
    for (var i = 0; i < pad; i++) cells.push(null);
    for (var d = 1; d <= n; d++) cells.push(y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d);
    while (cells.length % 7) cells.push(null);
    for (var r = 0; r < cells.length; r += 7) {
      var row = el("div", "grid-row");
      row.setAttribute("role", "row");
      cells.slice(r, r + 7).forEach(function (ymd) {
        if (!ymd) { var e = el("span", "cell blank"); e.setAttribute("role", "gridcell"); row.appendChild(e); return; }
        var ln = lineOf(ymd), future = ymd > today;
        var b = el("button", "cell" + (ln ? " has" : "") + (ymd === today ? " today" : "") + (ymd === day ? " sel" : ""));
        b.type = "button";
        b.setAttribute("role", "gridcell");
        b.disabled = future;
        b.appendChild(el("span", "cell-n", String(+ymd.slice(8))));
        b.appendChild(el("span", "cell-mark", ln ? (ln.e || "•") : ""));
        var lbl = ln ? t("aria.day", { date: longDate(ymd), text: ln.t }) : t("aria.dayEmpty", { date: longDate(ymd) });
        if (ymd === today) lbl += " (" + t("aria.today") + ")";
        b.setAttribute("aria-label", lbl);
        if (ln) b.title = ln.t;
        b.addEventListener("click", function () { openDay(ymd, true); });
        row.appendChild(b);
      });
      grid.appendChild(row);
    }
    var list = $("month-list"), lines = C.monthDays(data, y, m).reverse();
    list.innerHTML = "";
    lines.forEach(function (o) { list.appendChild(lineItem(o.ymd, o.t, o.e, shortDate(o.ymd))); });
    $("month-empty").hidden = lines.length > 0;
  }

  function moveMonth(d) {
    var k = month.y * 12 + (month.m - 1) + d;
    month = { y: Math.floor(k / 12), m: k % 12 + 1 };
    renderCalendar();
  }

  var qTimer = null;
  function renderSearch() {
    var q = $("q").value.trim();
    $("cal-wrap").hidden = !!q;
    $("results-wrap").hidden = !q;
    if (!q) { if (calDirty) renderCalendar(); return; }
    var hits = C.search(data, q), host = $("results");
    host.innerHTML = "";
    hits.slice(0, 300).forEach(function (o) { host.appendChild(lineItem(o.ymd, o.t, o.e, shortDate(o.ymd))); });
    $("results-count").textContent = !hits.length ? t("res.none") : (hits.length === 1 ? t("res.count1") : t("res.count", { n: num(hits.length) }));
  }

  // ---------- 6. Year ----------
  var year = null, yearDirty = true;
  function renderYear() {
    yearDirty = false;
    var ys = C.years(data), cy = +todayYmd().slice(0, 4);
    if (ys.indexOf(cy) < 0) ys.unshift(cy);
    ys.sort(function (a, b) { return b - a; });
    if (year === null || ys.indexOf(year) < 0) year = cy;
    var sel = $("year-sel");
    sel.innerHTML = "";
    ys.forEach(function (y) { var o = el("option", "", String(y)); o.value = String(y); sel.appendChild(o); });
    sel.value = String(year);
    var lines = C.yearDays(data, year), host = $("year-list");
    host.innerHTML = "";
    $("year-count").textContent = lines.length ? t("year.count", { n: num(lines.length) }) : "";
    $("year-empty").hidden = lines.length > 0;
    $("print-btn").disabled = !lines.length;
    $("v-year").setAttribute("data-print-title", t("app.name") + " · " + year);
    var curM = null, ul = null;
    lines.forEach(function (o) {
      var mm = o.ymd.slice(0, 7);
      if (mm !== curM) {
        curM = mm;
        host.appendChild(el("h3", "year-month", monthName(mm + "-01")));
        ul = el("ul", "lines year-lines");
        host.appendChild(ul);
      }
      ul.appendChild(lineItem(o.ymd, o.t, o.e, fmt(o.ymd, { weekday: "short", day: "numeric" })));
    });
  }

  // ---------- 7. Settings: reminder, export, import ----------
  var lastFocus = null;
  function openMore() {
    lastFocus = document.activeElement;
    $("rem-on").checked = prefs.rem.on;
    $("rem-time").value = (prefs.rem.h < 10 ? "0" : "") + prefs.rem.h + ":" + (prefs.rem.mi < 10 ? "0" : "") + prefs.rem.mi;
    $("rem-time").disabled = !prefs.rem.on;
    $("more").hidden = false; $("scrim").hidden = false;
    $("more-close").focus();
  }
  function closeMore() {
    $("more").hidden = true; $("scrim").hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onRem() {
    prefs.rem.on = $("rem-on").checked;
    var m = /^(\d{1,2}):(\d{2})/.exec($("rem-time").value || "");
    if (m) { prefs.rem.h = Math.min(23, +m[1]); prefs.rem.mi = Math.min(59, +m[2]); }
    $("rem-time").disabled = !prefs.rem.on;
    savePrefs();
  }

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.file"));
  }
  function exportAs(kind) {
    flush();
    var today = todayYmd();
    if (kind === "txt") saveBlob(new Blob([C.toText(data)], { type: "text/plain" }), C.fileName("txt", today), "text/plain", "txt");
    if (kind === "csv") saveBlob(new Blob(["\ufeff" + C.toCSV(data)], { type: "text/csv" }), C.fileName("csv", today), "text/csv", "csv");
    if (kind === "json") saveBlob(new Blob([C.toJSON(data)], { type: "application/json" }), C.fileName("json", today), "application/json", "json");
  }
  function importFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var rows = C.parseImport(String(rd.result || ""));
      if (!rows.length) { showToast(t("toast.impNone")); return; }
      flush();
      var r = C.importInto(data, rows, Date.now());
      data = r.data;
      save();
      calDirty = yearDirty = true;
      renderDay();
      showToast(t("toast.imported", { a: num(r.added), k: num(r.kept) }));
    };
    rd.onerror = function () { showToast(t("toast.impFail")); };
    rd.readAsText(file);
  }

  function randomMemory() {
    var r = C.randomDay(data, Math.random, todayYmd());
    if (!r) { showToast(t("toast.noRand")); return; }
    openDay(r.ymd);
    live(longDate(r.ymd) + ": " + r.t);
  }

  // ---------- 8. Tabs, toasts ----------
  var view = "today";
  function showView(v) {
    view = VIEWS.indexOf(v) >= 0 ? v : "today";
    VIEWS.forEach(function (k) {
      var on = k === view, tab = $("tab-" + k);
      $("v-" + k).hidden = !on;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle("on", on);
    });
    if (view === "days") {
      if (!month) month = { y: +day.slice(0, 4), m: +day.slice(5, 7) };
      if ($("q").value.trim()) renderSearch(); else if (calDirty) renderCalendar();
    }
    if (view === "year" && yearDirty) renderYear();
    if (prefs.view !== view) { prefs.view = view; savePrefs(); }
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "diary", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 9. Keyboard ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "checkbox" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("more").hidden) { e.preventDefault(); closeMore(); return; }
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      var inLine = e.target === $("line");
      if (view === "today" && (e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.altKey || (!typing(e) && !inLine))) {
        if (e.target && e.target.closest && e.target.closest('[role="radiogroup"], [role="tablist"]')) return;
        e.preventDefault();
        stepDay(e.key === "ArrowLeft" ? -1 : 1);
      }
    });
    $("line").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      flush();
      if (day < todayYmd() && C.cleanText($("line").value)) stepDay(1, true);   // filling in past days: on to the next
      else $("status").textContent = lineOf(day) ? t("st.saved") : "";
    });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = (VIEWS.indexOf(view) + d + VIEWS.length) % VIEWS.length;
      showView(VIEWS[i]);
      $("tab-" + VIEWS[i]).focus();
    });
  }
  function stepDay(d, focus) {
    var next = C.addDays(day, d);
    if (!next || next > todayYmd()) return;
    openDay(next, focus);
  }

  // ---------- 10. Sync slice + palette + deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("diary", sliceGet, sliceSet, STORAGE_KEY, C.mergeDiary);
  }

  function sliceGet() { flush(); return C.mergeDiary(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.days || typeof incoming.days !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeDiary(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    calDirty = yearDirty = true;
    renderDay();                              // keeps a line being typed (see renderDay)
    if (view === "days") renderSearch();
    if (view === "year") renderYear();
  }

  // Deep link: { day } opens that day (reminder, universal search).
  function openTarget(target) {
    if (!target || typeof target !== "object") { openDay(todayYmd()); return; }
    openDay(C.isYmd(target.day) ? target.day : C.writingDay(data, new Date()).day, true);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    rand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("prev-btn").innerHTML = ICON.prev; setLabel($("prev-btn"), t("btn.prev"));
    $("next-btn").innerHTML = ICON.next; setLabel($("next-btn"), t("btn.next"));
    $("mprev-btn").innerHTML = ICON.prev; setLabel($("mprev-btn"), t("btn.mprev"));
    $("mnext-btn").innerHTML = ICON.next; setLabel($("mnext-btn"), t("btn.mnext"));
    $("rand-btn").innerHTML = ICON.rand; setLabel($("rand-btn"), t("btn.rand"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("more-close").innerHTML = ICON.close; setLabel($("more-close"), t("btn.close"));
    $("q").placeholder = t("ph.search");
  }

  function wire() {
    $("line").addEventListener("input", onLineInput);
    $("line").addEventListener("blur", flush);
    $("prev-btn").addEventListener("click", function () { stepDay(-1); });
    $("next-btn").addEventListener("click", function () { stepDay(1); });
    $("today-btn").addEventListener("click", function () { lateChoice = null; openDay(C.writingDay(data, new Date()).day, true); });
    $("del-btn").addEventListener("click", deleteDay);
    $("mprev-btn").addEventListener("click", function () { moveMonth(-1); });
    $("mnext-btn").addEventListener("click", function () { moveMonth(1); });
    $("q").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(renderSearch, 150); });
    $("year-sel").addEventListener("change", function () { year = +$("year-sel").value; renderYear(); });
    $("print-btn").addEventListener("click", function () { window.print(); });
    $("rand-btn").addEventListener("click", randomMemory);
    $("more-btn").addEventListener("click", openMore);
    $("more-close").addEventListener("click", closeMore);
    $("scrim").addEventListener("click", closeMore);
    $("rem-on").addEventListener("change", onRem);
    $("rem-time").addEventListener("change", onRem);
    $("exp-txt").addEventListener("click", function () { exportAs("txt"); });
    $("exp-csv").addEventListener("click", function () { exportAs("csv"); });
    $("exp-json").addEventListener("click", function () { exportAs("json"); });
    $("imp-btn").addEventListener("click", function () { $("imp-file").value = ""; $("imp-file").click(); });
    $("imp-file").addEventListener("change", function () { importFile($("imp-file").files[0]); });
    VIEWS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { showView(v); }); });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
      else if (day > todayYmd() || (!editTimer && document.activeElement !== $("line"))) renderDay();   // a new day may have started
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    day = C.writingDay(data, new Date()).day;
    wire();
    registerSync();
    watchPalette();
    renderDay();
    showView(prefs.view);
    var opened = false;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("diary");
        if (pending) { openTarget(pending); opened = true; }
      }
    } catch (e) {}
    if (!opened && view === "today" && !lineOf(day)) $("line").focus();
  }

  boot();
})();
