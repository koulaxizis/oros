// ============================================================
// orOS Chore Wheel — App logic (v1.0.0)
// Circular home task allocation: members, chores, and a wheel
// that turns every period so the work goes round.
//   - members (2–12) with colour, icon, order and "away" dates
//   - chores (≤ 40): daily, every N days, weekdays, weekly or
//     monthly; weight 1–3; who takes part; three rotation modes:
//     round robin, balanced (fewest points), spin (fair draw)
//   - the assignment is COMPUTED from the synced members, chores
//     and events; only events are stored (done / skipped / undone,
//     one-off hand-overs and spin results)
//   - views: Wheel (two concentric discs), Today, Week, Stats,
//     Home (setup)
// Data:
//   - synced slice "chores" (oros-chores-data): members + chores
//     LWW + tombstones, events LWW per key (R5, R17, R26)
//   - device-local (R10): oros-chores-prefs (who I am here, the
//     open tab, wheel group, "only mine" filter)
// Sections:
//   1. Constants, i18n, helpers
//   2. Dates + occurrences
//   3. Data model: normalize, merge
//   4. Assignment + stats
//   5. Storage, prefs
//   6. Mutations
//   7. The wheel: drawing + turning
//   8. Views: Today, Week, Stats, Home
//   9. Dialogs: member, chore, row actions, spin
//  10. Toasts + keyboard (Contract Β)
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-chores-data";
  var PREFS_KEY   = "oros-chores-prefs";
  var DATA_VER    = 1;
  var MAX_MEMBERS = 12;
  var MAX_TASKS   = 40;
  var NAME_LEN    = 30;
  var TASK_LEN    = 50;
  var ICON_LEN    = 16;
  var KEEP_MONTHS = 13;      // events older than this many months are pruned
  var BAL_DAYS    = 28;      // balanced mode looks at the last 4 weeks
  var OVERDUE_DAYS = 7;      // an unfinished chore stays "late" this long
  var TAU         = Math.PI * 2;
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var FREQS = ["d", "n", "wd", "w", "mo"];
  var MODES = ["rr", "bal", "spin"];
  var TASK_ICONS = ["🍽️", "🧽", "🧹", "🪣", "🗑️", "♻️", "🧺", "👕", "🛏️", "🛁", "🚽", "🪟",
                    "🪴", "🛒", "🍳", "🐾", "🦮", "🚗", "📦", "🧊", "🪶", "🌿", "💡", "📬"];
  var MEMBER_ICONS = ["", "🙂", "😎", "👩", "👨", "👧", "👦", "👵", "👴", "🐱", "🐶", "🦊",
                      "🐻", "🐼", "🦁", "🐸", "🌟", "🌈", "⚽", "🎸"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Chore Wheel",
      "tab.wheel": "Wheel", "tab.today": "Today", "tab.week": "Week", "tab.stats": "Stats", "tab.home": "Home",
      "grp.d": "Daily", "grp.w": "Weekly", "grp.mo": "Monthly",
      "per.prev": "Previous", "per.next": "Next", "per.now": "Now",
      "wheel.none": "Round-robin chores of this kind will turn on the wheel.",
      "wheel.empty": "Add members and chores to start the wheel.",
      "wheel.setup": "Set up the home",
      "wheel.aria": "Who does what: {list}",
      "today.prog": "{d} of {n} done", "today.free": "Nothing to do today.",
      "today.only": "Only mine", "today.late": "late", "today.open": "Waiting for a spin",
      "today.nobody": "No one yet",
      "week.wk": "This week", "week.mo": "This month",
      "week.none": "Nothing this day.",
      "row.done": "Mark “{t}” done", "row.undone": "Mark “{t}” not done", "row.more": "More for “{t}”",
      "row.by": "done by {m}", "row.skipped": "skipped",
      "stats.wk": "This week", "stats.mo": "This month", "stats.yr": "12 months",
      "stats.pts": "{n} pts", "stats.pt": "1 pt", "stats.done": "Done: {n}", "stats.missed": "Missed: {n}",
      "stats.streak": "Streak", "stats.days": "{n} days", "stats.day": "1 day",
      "stats.hist": "History (90 days)", "stats.histEmpty": "Nothing done yet.",
      "stats.fair": "Fair share", "stats.none": "Add members to see the stats.",
      "home.members": "Members", "home.tasks": "Chores", "home.sets": "Ready sets", "home.me": "Who are you on this device?",
      "home.meNone": "Nobody (show all)",
      "home.addMember": "Add a member…", "home.addTask": "New chore",
      "home.membersEmpty": "Add the people who share the chores.",
      "home.tasksEmpty": "Add a chore, or start from a ready set.",
      "m.edit": "Edit {name}", "m.del": "Delete {name}", "m.up": "Move {name} up", "m.down": "Move {name} down",
      "m.away": "away {from} – {to}",
      "dlg.member": "Member", "dlg.task": "Chore", "dlg.name": "Name", "dlg.color": "Colour", "dlg.icon": "Icon",
      "dlg.away": "Away (the wheel skips them)", "dlg.awayFrom": "From", "dlg.awayTo": "To", "dlg.awayClear": "Back home",
      "dlg.freq": "How often", "dlg.every": "Every how many days", "dlg.days": "On", "dlg.start": "Starts",
      "dlg.weight": "Effort", "dlg.mode": "Who gets it", "dlg.who": "Who takes part", "dlg.all": "None picked means everyone.",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.delete": "Delete", "dlg.close": "Close",
      "freq.d": "Every day", "freq.n": "Every N days", "freq.wd": "On weekdays", "freq.w": "Every week", "freq.mo": "Every month",
      "freq.nShort": "Every {n} days",
      "w.1": "Easy", "w.2": "Medium", "w.3": "Heavy",
      "mode.rr": "In turn", "mode.bal": "Balanced", "mode.spin": "Spin",
      "mode.rr.d": "Each time it goes to the next one in order.",
      "mode.bal.d": "It goes to whoever has the fewest points in the last 4 weeks.",
      "mode.spin.d": "Spin the wheel each time; the draw is fair.",
      "act.doneBy": "Done by", "act.give": "Hand over this time", "act.skip": "Skip this time",
      "act.undo": "Not done", "act.spin": "Spin the wheel", "act.respin": "Spin again", "act.keep": "Back to the turn",
      "spin.title": "Who gets “{t}”?", "spin.go": "Spin!", "spin.res": "{m} gets it", "spin.one": "{m} gets it (the only one free)",
      "toast.undo": "Undo", "toast.memberDel": "Member deleted", "toast.taskDel": "Chore deleted",
      "toast.save": "Could not save: storage is full", "toast.maxMembers": "Up to {n} members",
      "toast.maxTasks": "Up to {n} chores", "toast.needName": "Give it a name", "toast.setAdded": "{n} chores added",
      "toast.setNone": "Those chores are already here", "toast.done": "“{t}” done", "toast.needMembers": "Add a member first",
      "toast.awayBad": "The return date is before the leaving date",
      "toast.daysBad": "Pick at least one day",
      "live.spin": "{m} gets {t}",
      "set.kitchen": "Kitchen", "set.clean": "Weekly cleaning", "set.pet": "Pet", "set.home": "Around the house",
      "dow": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      "months": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    },
    el: {
      "app": "Τροχός δουλειών",
      "tab.wheel": "Τροχός", "tab.today": "Σήμερα", "tab.week": "Εβδομάδα", "tab.stats": "Στατιστικά", "tab.home": "Σπίτι",
      "grp.d": "Ημερήσιες", "grp.w": "Εβδομαδιαίες", "grp.mo": "Μηνιαίες",
      "per.prev": "Προηγούμενη", "per.next": "Επόμενη", "per.now": "Τώρα",
      "wheel.none": "Οι δουλειές «με τη σειρά» αυτού του είδους γυρίζουν στον τροχό.",
      "wheel.empty": "Πρόσθεσε μέλη και δουλειές για να ξεκινήσει ο τροχός.",
      "wheel.setup": "Ρύθμισε το σπίτι",
      "wheel.aria": "Ποιος κάνει τι: {list}",
      "today.prog": "{d} από {n} έγιναν", "today.free": "Καμία δουλειά σήμερα.",
      "today.only": "Μόνο οι δικές μου", "today.late": "καθυστερεί", "today.open": "Περιμένουν γύρισμα",
      "today.nobody": "Κανείς ακόμα",
      "week.wk": "Αυτή την εβδομάδα", "week.mo": "Αυτόν τον μήνα",
      "week.none": "Τίποτα αυτή τη μέρα.",
      "row.done": "Έγινε: «{t}»", "row.undone": "Δεν έγινε: «{t}»", "row.more": "Περισσότερα για «{t}»",
      "row.by": "την έκανε: {m}", "row.skipped": "προσπεράστηκε",
      "stats.wk": "Αυτή την εβδομάδα", "stats.mo": "Αυτόν τον μήνα", "stats.yr": "12 μήνες",
      "stats.pts": "{n} πόντοι", "stats.pt": "1 πόντος", "stats.done": "Έγιναν: {n}", "stats.missed": "Χάθηκαν: {n}",
      "stats.streak": "Σερί", "stats.days": "{n} μέρες", "stats.day": "1 μέρα",
      "stats.hist": "Ιστορικό (90 μέρες)", "stats.histEmpty": "Δεν έχει γίνει τίποτα ακόμα.",
      "stats.fair": "Δίκαιο μερίδιο", "stats.none": "Πρόσθεσε μέλη για να δεις στατιστικά.",
      "home.members": "Μέλη", "home.tasks": "Δουλειές", "home.sets": "Έτοιμα σετ", "home.me": "Ποιος είσαι σε αυτή τη συσκευή;",
      "home.meNone": "Κανείς (δείξε όλους)",
      "home.addMember": "Πρόσθεσε μέλος…", "home.addTask": "Νέα δουλειά",
      "home.membersEmpty": "Πρόσθεσε όσους μοιράζονται τις δουλειές.",
      "home.tasksEmpty": "Πρόσθεσε μια δουλειά ή ξεκίνα από ένα έτοιμο σετ.",
      "m.edit": "Επεξεργασία: {name}", "m.del": "Διαγραφή: {name}", "m.up": "Πάνω: {name}", "m.down": "Κάτω: {name}",
      "m.away": "εκτός {from} – {to}",
      "dlg.member": "Μέλος", "dlg.task": "Δουλειά", "dlg.name": "Όνομα", "dlg.color": "Χρώμα", "dlg.icon": "Εικονίδιο",
      "dlg.away": "Εκτός (ο τροχός τον προσπερνά)", "dlg.awayFrom": "Από", "dlg.awayTo": "Έως", "dlg.awayClear": "Επέστρεψε",
      "dlg.freq": "Κάθε πότε", "dlg.every": "Κάθε πόσες μέρες", "dlg.days": "Μέρες", "dlg.start": "Ξεκινά",
      "dlg.weight": "Κόπος", "dlg.mode": "Ποιος την παίρνει", "dlg.who": "Ποιοι συμμετέχουν", "dlg.all": "Αν δεν διαλέξεις κανέναν, συμμετέχουν όλοι.",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.delete": "Διαγραφή", "dlg.close": "Κλείσιμο",
      "freq.d": "Κάθε μέρα", "freq.n": "Κάθε N μέρες", "freq.wd": "Συγκεκριμένες μέρες", "freq.w": "Κάθε εβδομάδα", "freq.mo": "Κάθε μήνα",
      "freq.nShort": "Κάθε {n} μέρες",
      "w.1": "Εύκολη", "w.2": "Μέτρια", "w.3": "Βαριά",
      "mode.rr": "Κυκλικά", "mode.bal": "Ισορροπημένα", "mode.spin": "Γύρισμα",
      "mode.rr.d": "Κάθε φορά πάει στον επόμενο της σειράς.",
      "mode.bal.d": "Πάει σε όποιον έχει τους λιγότερους πόντους τις τελευταίες 4 εβδομάδες.",
      "mode.spin.d": "Γυρίζεις τον τροχό κάθε φορά· η κλήρωση είναι δίκαιη.",
      "act.doneBy": "Την έκανε", "act.give": "Ανέλαβε αυτή τη φορά", "act.skip": "Προσπέρασε αυτή τη φορά",
      "act.undo": "Δεν έγινε", "act.spin": "Γύρνα τον τροχό", "act.respin": "Γύρνα ξανά", "act.keep": "Πίσω στη σειρά",
      "spin.title": "Ποιος παίρνει «{t}»;", "spin.go": "Γύρνα!", "spin.res": "Την παίρνει: {m}", "spin.one": "Την παίρνει: {m} (ο μόνος διαθέσιμος)",
      "toast.undo": "Αναίρεση", "toast.memberDel": "Το μέλος διαγράφηκε", "toast.taskDel": "Η δουλειά διαγράφηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.maxMembers": "Έως {n} μέλη",
      "toast.maxTasks": "Έως {n} δουλειές", "toast.needName": "Δώσε ένα όνομα", "toast.setAdded": "Προστέθηκαν {n} δουλειές",
      "toast.setNone": "Αυτές οι δουλειές υπάρχουν ήδη", "toast.done": "Έγινε: «{t}»", "toast.needMembers": "Πρόσθεσε πρώτα ένα μέλος",
      "toast.awayBad": "Η επιστροφή είναι πριν από την αναχώρηση",
      "toast.daysBad": "Διάλεξε τουλάχιστον μία μέρα",
      "live.spin": "{t}: την παίρνει {m}",
      "set.kitchen": "Κουζίνα", "set.clean": "Εβδομαδιαίο καθάρισμα", "set.pet": "Κατοικίδιο", "set.home": "Γύρω από το σπίτι",
      "dow": ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"],
      "months": ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"]
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params && typeof s === "string") {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("chores.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Dates + occurrences ----------
  // Days are counted as whole UTC day numbers ("dn") from a local
  // calendar date, so DST never shifts a chore.
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function ymdToDn(s) {
    var m = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return Math.round(dt.getTime() / 864e5);
  }
  function dnToYmd(n) {
    var d = new Date(n * 864e5);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function localDn(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  }
  function dow(n) { return ((n + 3) % 7 + 7) % 7; }          // 0 = Monday (day 0 was a Thursday)
  function monday(n) { return n - dow(n); }
  function monthIdx(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  function monthStartOf(idx) { return Math.round(Date.UTC(Math.floor(idx / 12), idx % 12, 1) / 864e5); }

  // Weekdays in [s, n) that are in `days`.
  function countDays(s, n, days) {
    if (n <= s) return 0;
    var full = Math.floor((n - s) / 7), c = full * days.length;
    for (var i = s + full * 7; i < n; i++) if (days.indexOf(dow(i)) >= 0) c++;
    return c;
  }

  // The occurrence of `task` whose window holds day n, or null.
  // { a: first day, b: last day, k: index from the start, key }
  function occAt(task, n) {
    var s = ymdToDn(task.start), f = task.freq, a, b, k;
    if (isNaN(s)) return null;
    if (f.k === "d") {
      if (n < s) return null;
      a = n; b = n; k = n - s;
    } else if (f.k === "n") {
      if (n < s) return null;
      k = Math.floor((n - s) / f.n); a = s + k * f.n; b = a + f.n - 1;
    } else if (f.k === "wd") {
      if (n < s || f.d.indexOf(dow(n)) < 0) return null;
      a = n; b = n; k = countDays(s, n, f.d);
    } else if (f.k === "w") {
      a = monday(n);
      if (a < monday(s)) return null;
      b = a + 6; k = (a - monday(s)) / 7;
    } else if (f.k === "mo") {
      var mi = monthIdx(n), ms = monthIdx(s);
      if (mi < ms) return null;
      a = monthStartOf(mi); b = monthStartOf(mi + 1) - 1; k = mi - ms;
    } else return null;
    return { a: a, b: b, k: k, key: task.id + "|" + dnToYmd(a) };
  }
  // Occurrences that START in [from, to].
  function occsIn(task, from, to) {
    var out = [];
    for (var n = from; n <= to; n++) {
      var o = occAt(task, n);
      if (o && o.a === n) out.push(o);
    }
    return out;
  }
  // The last occurrence that ended before day n (looks back ≤ 62 days).
  function prevOcc(task, n) {
    var cur = occAt(task, n), d = cur ? cur.a - 1 : n - 1;
    for (var i = 0; i < 62; i++, d--) {
      var o = occAt(task, d);
      if (o) return o;
    }
    return null;
  }

  // ---------- 3. Data model: normalize, merge ----------
  // member = { id, m, name, color 0–7, icon, away: null | [ymd, ymd], order, om }
  //          m stamps the content, om the place in the order: moving a
  //          member on one phone never undoes an edit made on another
  // task   = { id, m, name, icon, freq: {k, n?, d?}, weight 1–3, mode, who[], start, off }
  //          off = where the chore starts on the wheel (set once at creation,
  //          so chores made together spread over the members)
  // done   = { "<taskId>|<ymd>": [state 0 undone | 1 done | 2 skipped, by, m] }
  // set    = { "<taskId>|<ymd>": [memberId | "" (back to the turn), m] }  hand-over or spin
  // data   = { ver, members[] by id, tasks[] by id, done{}, set{}, tombs{id: deletedAt} }
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var KEY_RE = /^([a-z0-9]{6,40})\|(\d{4}-\d{2}-\d{2})$/;

  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function normIcon(s) {
    return typeof s === "string" && s.length <= ICON_LEN && !/[\u0000-\u001f\u007f<>&"']/.test(s) ? s : "";
  }
  function normYmd(s) { return isNaN(ymdToDn(s)) ? null : s; }

  function normMember(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name) return null;
    var away = null;
    if (Array.isArray(x.away) && x.away.length === 2) {
      var a = normYmd(x.away[0]), b = normYmd(x.away[1]);
      if (a && b && a <= b) away = [a, b];
    }
    return {
      id: x.id, m: x.m, name: name,
      color: isInt(x.color) && x.color >= 0 && x.color < COLORS.length ? x.color : 0,
      icon: normIcon(x.icon),
      away: away,
      order: isInt(x.order) && x.order >= 0 && x.order <= 9999 ? x.order : 0,
      om: isInt(x.om) && x.om >= 0 ? x.om : 0
    };
  }

  function normFreq(f) {
    if (!f || typeof f !== "object" || FREQS.indexOf(f.k) < 0) return null;
    if (f.k === "n") return isInt(f.n) && f.n >= 2 && f.n <= 30 ? { k: "n", n: f.n } : null;
    if (f.k === "wd") {
      var d = [];
      (Array.isArray(f.d) ? f.d : []).forEach(function (v) {
        if (isInt(v) && v >= 0 && v <= 6 && d.indexOf(v) < 0) d.push(v);
      });
      d.sort(function (a, b) { return a - b; });
      return d.length ? { k: "wd", d: d } : null;
    }
    return { k: f.k };
  }

  function normTask(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normText(x.name, TASK_LEN), freq = normFreq(x.freq), start = normYmd(x.start);
    if (!name || !freq || !start) return null;
    var who = [];
    (Array.isArray(x.who) ? x.who : []).forEach(function (id) {
      if (typeof id === "string" && ID_RE.test(id) && who.indexOf(id) < 0) who.push(id);
    });
    who.sort(cmpStr);
    return {
      id: x.id, m: x.m, name: name, icon: normIcon(x.icon), freq: freq,
      weight: isInt(x.weight) && x.weight >= 1 && x.weight <= 3 ? x.weight : 1,
      mode: MODES.indexOf(x.mode) >= 0 ? x.mode : "rr",
      who: who.slice(0, MAX_MEMBERS), start: start,
      off: isInt(x.off) && x.off >= 0 && x.off <= 999 ? x.off : 0
    };
  }

  function normDone(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    var st = v[0], by = v[1], m = v[2];
    if (!isInt(st) || st < 0 || st > 2 || typeof by !== "string" || (by && !ID_RE.test(by)) ||
        !isInt(m) || m < 0) return null;
    if (st === 1 && !by) return null;
    return [st, by, m];
  }
  function normSet(v) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    if (typeof v[0] !== "string" || (v[0] && !ID_RE.test(v[0])) || !isInt(v[1]) || v[1] < 0) return null;
    return [v[0], v[1]];
  }

  // Events whose day is before this are dropped (whole months, so all
  // devices agree on the cut for a whole month).
  function pruneBeforeYmd(nowMs) {
    var d = new Date(nowMs);
    var idx = d.getFullYear() * 12 + d.getMonth() - KEEP_MONTHS;
    return dnToYmd(monthStartOf(idx));
  }

  function newer(x, y, mi) {           // LWW: higher stamp, equal stamp → larger canonical JSON
    if (!y) return true;
    if (x[mi] !== y[mi]) return x[mi] > y[mi];
    return JSON.stringify(x) > JSON.stringify(y);
  }

  // Symmetric and canonical (R5, R26): entities LWW by m (equal m:
  // larger canonical JSON), tombstones max-merged, delete wins ties,
  // a newer edit resurrects (R17); events LWW per key.
  function mergeChores(A, B, nowMs) {
    var a = A || {}, b = B || {};
    var cut = pruneBeforeYmd(isInt(nowMs) ? nowMs : Date.now());
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    function ents(field, norm, join) {
      var best = {};
      [a[field], b[field]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = norm(raw);
          if (!x) return;
          best[x.id] = best[x.id] ? join(best[x.id], x) : x;
        });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var x = best[id];
        if (id in tombs && tombs[id] >= Math.max(x.m, x.om || 0)) return;
        out.push(x);
      });
      return out;
    }
    function lww(x, y) {
      return y.m > x.m || (y.m === x.m && JSON.stringify(y) > JSON.stringify(x)) ? y : x;
    }
    // members: content by m, order by om (each side its own LWW)
    function joinMember(x, y) {
      var c = lww(contentOf(x), contentOf(y));
      var o = (y.om > x.om || (y.om === x.om && y.order > x.order)) ? y : x;
      return { id: x.id, m: c.m, name: c.name, color: c.color, icon: c.icon, away: c.away, order: o.order, om: o.om };
    }
    function contentOf(x) { return { id: x.id, m: x.m, name: x.name, color: x.color, icon: x.icon, away: x.away }; }
    function events(field, norm, mi) {
      var best = {};
      [a[field], b[field]].forEach(function (map) {
        if (!map || typeof map !== "object" || Array.isArray(map)) return;
        Object.keys(map).forEach(function (k) {
          var km = KEY_RE.exec(k);
          if (!km || isNaN(ymdToDn(km[2])) || km[2] < cut) return;
          var v = norm(map[k]);
          if (v && newer(v, best[k], mi)) best[k] = v;
        });
      });
      var out = {};
      Object.keys(best).sort(cmpStr).forEach(function (k) { out[k] = best[k]; });
      return out;
    }
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return {
      ver: DATA_VER,
      members: ents("members", normMember, joinMember),
      tasks: ents("tasks", normTask, lww),
      done: events("done", normDone, 2),
      set: events("set", normSet, 1),
      tombs: sortedTombs
    };
  }

  // Ready sets: templates, copied into plain chores when applied.
  var SET_IDS = ["kitchen", "clean", "pet", "home"];
  var SETS = {
    kitchen: [
      { icon: "🍽️", en: "Dishes", el: "Πιάτα", freq: { k: "d" }, weight: 1 },
      { icon: "🧽", en: "Wipe the counters", el: "Πάγκοι και τραπέζι", freq: { k: "d" }, weight: 1 },
      { icon: "🗑️", en: "Take out the trash", el: "Σκουπίδια", freq: { k: "n", n: 2 }, weight: 1 },
      { icon: "🧊", en: "Clean the fridge", el: "Καθάρισμα ψυγείου", freq: { k: "mo" }, weight: 2 }
    ],
    clean: [
      { icon: "🧹", en: "Vacuum", el: "Σκούπα", freq: { k: "w" }, weight: 2 },
      { icon: "🪣", en: "Mop the floors", el: "Σφουγγάρισμα", freq: { k: "w" }, weight: 2 },
      { icon: "🛁", en: "Bathroom", el: "Μπάνιο", freq: { k: "w" }, weight: 3 },
      { icon: "🪶", en: "Dusting", el: "Ξεσκόνισμα", freq: { k: "w" }, weight: 1 },
      { icon: "🛏️", en: "Change the sheets", el: "Αλλαγή σεντονιών", freq: { k: "w" }, weight: 2 },
      { icon: "🧺", en: "Laundry", el: "Πλυντήριο ρούχων", freq: { k: "wd", d: [0, 3] }, weight: 2 }
    ],
    pet: [
      { icon: "🐾", en: "Feed the pet", el: "Φαγητό στο κατοικίδιο", freq: { k: "d" }, weight: 1 },
      { icon: "🦮", en: "Walk the dog", el: "Βόλτα τον σκύλο", freq: { k: "d" }, weight: 2 },
      { icon: "🧹", en: "Clean the litter or cage", el: "Άμμος ή κλουβί", freq: { k: "n", n: 3 }, weight: 2 }
    ],
    home: [
      { icon: "🛒", en: "Groceries", el: "Ψώνια", freq: { k: "w" }, weight: 2 },
      { icon: "🪴", en: "Water the plants", el: "Πότισμα", freq: { k: "n", n: 3 }, weight: 1 },
      { icon: "♻️", en: "Recycling", el: "Ανακύκλωση", freq: { k: "w" }, weight: 1 },
      { icon: "🪟", en: "Windows", el: "Τζάμια", freq: { k: "mo" }, weight: 3 }
    ]
  };

  // ---------- 4. Assignment + stats ----------
  function orderedMembers(st) {
    return st.members.slice().sort(function (x, y) { return x.order - y.order || cmpStr(x.id, y.id); });
  }
  function memberById(st, id) {
    for (var i = 0; i < st.members.length; i++) if (st.members[i].id === id) return st.members[i];
    return null;
  }
  function taskById(st, id) {
    for (var i = 0; i < st.tasks.length; i++) if (st.tasks[i].id === id) return st.tasks[i];
    return null;
  }
  function isAway(mb, n) {
    return !!mb.away && n >= ymdToDn(mb.away[0]) && n <= ymdToDn(mb.away[1]);
  }
  // The members who take part, in wheel order (all when none is picked
  // or every picked one is gone).
  function pool(st, task) {
    var L = orderedMembers(st);
    if (!task.who.length) return L;
    var P = L.filter(function (mb) { return task.who.indexOf(mb.id) >= 0; });
    return P.length ? P : L;
  }
  function stateOf(st, key) { var d = st.done[key]; return d ? d[0] : 0; }

  // A context caches the balanced-mode loads for one render.
  function makeCtx(st) {
    var pts = [];
    Object.keys(st.done).forEach(function (k) {
      var d = st.done[k];
      if (d[0] !== 1) return;
      var km = KEY_RE.exec(k), tk = taskById(st, km[1]);
      pts.push({ n: ymdToDn(km[2]), by: d[1], w: tk ? tk.weight : 1 });
    });
    return { st: st, pts: pts, bal: {} };
  }

  // Who has the chore for occurrence o: a hand-over or spin result
  // first, then the mode. null = nobody yet (spin not done).
  function assignee(ctx, task, o) {
    var st = ctx.st, s = st.set[o.key];
    if (s && s[0] && memberById(st, s[0])) return s[0];
    var L = pool(st, task);
    if (!L.length) return null;
    if (task.mode === "rr") {
      var i0 = (o.k + task.off) % L.length;
      for (var j = 0; j < L.length; j++) {
        var mb = L[(i0 + j) % L.length];
        if (!isAway(mb, o.a)) return mb.id;
      }
      return L[i0].id;
    }
    if (task.mode === "bal") return balFor(ctx, o.a)[task.id] || null;
    return null;
  }

  // Balanced chores that start on day a, in id order: each goes to
  // the free member with the fewest points over the 4 weeks before a
  // (plus what this day already handed out); ties follow the turn.
  function balFor(ctx, a) {
    if (ctx.bal[a]) return ctx.bal[a];
    var st = ctx.st, load = {}, res = {};
    st.members.forEach(function (mb) { load[mb.id] = 0; });
    ctx.pts.forEach(function (p) {
      if (p.n >= a - BAL_DAYS && p.n < a && p.by in load) load[p.by] += p.w;
    });
    st.tasks.forEach(function (tk) {
      if (tk.mode !== "bal") return;
      var o = occAt(tk, a);
      if (!o || o.a !== a) return;
      var s = st.set[o.key], who = null;
      if (s && s[0] && memberById(st, s[0])) who = s[0];
      else {
        var L = pool(st, tk), free = L.filter(function (mb) { return !isAway(mb, a); });
        if (!free.length) free = L;
        var best = null, i0 = (o.k + tk.off) % free.length;
        for (var j = 0; j < free.length; j++) {
          var mb = free[(i0 + j) % free.length];
          if (best === null || load[mb.id] < load[best]) best = mb.id;
        }
        who = best;
      }
      if (who) { res[tk.id] = who; load[who] = (load[who] || 0) + tk.weight; }
    });
    ctx.bal[a] = res;
    return res;
  }

  // Rows for one day: chores whose window holds day n, plus the last
  // unfinished one of each chore if it ended ≤ 7 days ago (late).
  function dayRows(ctx, n) {
    var rows = [];
    ctx.st.tasks.forEach(function (tk) {
      var o = occAt(tk, n);
      if (o) rows.push(row(ctx, tk, o, false));
      var p = prevOcc(tk, n);
      if (p && p.b < n && p.b >= n - OVERDUE_DAYS && stateOf(ctx.st, p.key) === 0) rows.push(row(ctx, tk, p, true));
    });
    return rows;
  }
  function row(ctx, tk, o, late) {
    var d = ctx.st.done[o.key];
    return { task: tk, o: o, late: late, who: assignee(ctx, tk, o), state: d ? d[0] : 0, by: d ? d[1] : "" };
  }

  // Points, done and missed per member for days [from, to]; missed
  // counts only windows that ended before `today`.
  function statsFor(ctx, from, to, today) {
    var st = ctx.st, res = {};
    st.members.forEach(function (mb) { res[mb.id] = { pts: 0, done: 0, missed: 0 }; });
    ctx.pts.forEach(function (p) {
      if (p.n >= from && p.n <= to && res[p.by]) { res[p.by].pts += p.w; res[p.by].done++; }
    });
    var last = Math.min(to, today - 1);
    st.tasks.forEach(function (tk) {
      occsIn(tk, from, last).forEach(function (o) {
        if (o.b >= today || stateOf(st, o.key) !== 0) return;
        var who = assignee(ctx, tk, o);
        if (who && res[who]) res[who].missed++;
      });
    });
    return res;
  }

  // Days in a row, back from yesterday, on which none of the member's
  // chores was left undone; today counts once nothing due today is open.
  function streakOf(ctx, memberId, today) {
    var st = ctx.st, first = Infinity, missed = {}, todayOpen = false;
    st.tasks.forEach(function (tk) {
      var s = ymdToDn(tk.start);
      if (s < first) first = s;
      occsIn(tk, today - 400, today).forEach(function (o) {
        if (o.b > today || stateOf(st, o.key) !== 0 || assignee(ctx, tk, o) !== memberId) return;
        if (o.b < today) missed[o.b] = true;
        else todayOpen = true;
      });
    });
    if (first === Infinity || first > today) return 0;
    var n = 0;
    for (var d = today - 1; d >= Math.max(first, today - 365); d--) {
      if (missed[d]) break;
      n++;
    }
    return n + (todayOpen ? 0 : 1);
  }

  // ---------- 5. Storage, prefs ----------
  var data = null, prefs = null;

  function emptyData() { return { ver: DATA_VER, members: [], tasks: [], done: {}, set: {}, tombs: {} }; }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.members)) {
          data = mergeChores(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] chores: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  var TABS = ["wheel", "today", "week", "stats", "home"];
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      me: typeof p.me === "string" && ID_RE.test(p.me) ? p.me : "",
      tab: TABS.indexOf(p.tab) >= 0 ? p.tab : "",
      grp: ["d", "w", "mo"].indexOf(p.grp) >= 0 ? p.grp : "",
      only: p.only === 1 ? 1 : 0,
      range: ["wk", "mo", "yr"].indexOf(p.range) >= 0 ? p.range : "wk"
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 6. Mutations ----------
  // Stamp at the mutation site (R27); then canonicalize, save, render.
  function stamp(x) { x.m = Math.max(Date.now(), (x.m || 0) + 1); }
  function commit() {
    data = mergeChores(data, data);
    saveNow();
    renderAll();
  }
  function eventStamp(prev, mi) { return Math.max(Date.now(), prev ? prev[mi] + 1 : 0); }

  function setDone(key, st, by) {
    var prev = data.done[key];
    data.done[key] = [st, st === 1 ? by : (by || ""), eventStamp(prev, 2)];
    commit();
  }
  function setWho(key, to) {
    var prev = data.set[key];
    data.set[key] = [to, eventStamp(prev, 1)];
    commit();
  }

  function addMember(name) {
    name = normText(name, NAME_LEN);
    if (!name) { showToast(t("toast.needName")); return false; }
    if (data.members.length >= MAX_MEMBERS) { showToast(t("toast.maxMembers", { n: MAX_MEMBERS })); return false; }
    var used = data.members.map(function (mb) { return mb.color; }), color = 0;
    for (var c = 0; c < COLORS.length; c++) if (used.indexOf(c) < 0) { color = c; break; }
    var top = -1;
    data.members.forEach(function (mb) { if (mb.order > top) top = mb.order; });
    data.members.push({ id: newId(), m: Date.now(), name: name, color: color, icon: "", away: null, order: Math.min(9999, top + 1), om: 0 });
    commit();
    return true;
  }

  // Rewrite the order 0..n-1, stamping only the members that moved.
  function moveMember(id, dir) {
    var L = orderedMembers(data), i = -1;
    L.forEach(function (mb, k) { if (mb.id === id) i = k; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= L.length) return;
    var x = L[i]; L[i] = L[j]; L[j] = x;
    L.forEach(function (mb, k) {
      if (mb.order !== k) { mb.order = k; mb.om = Math.max(Date.now(), mb.om + 1); }
    });
    commit();
  }

  function deleteEntity(kind, id) {
    var list = kind === "member" ? data.members : data.tasks, x = null;
    list.forEach(function (y) { if (y.id === id) x = y; });
    if (!x) return;
    var copy = JSON.parse(JSON.stringify(x));
    data.tombs[id] = Math.max(Date.now(), x.m, x.om || 0);
    if (kind === "member" && prefs.me === id) { prefs.me = ""; savePrefs(); }
    commit();
    undoToast(t(kind === "member" ? "toast.memberDel" : "toast.taskDel"), function () {
      copy.m = Math.max(Date.now(), (data.tombs[id] || 0) + 1);       // a newer edit resurrects (R17)
      var arr = kind === "member" ? data.members : data.tasks;
      if (kind === "member" ? data.members.length >= MAX_MEMBERS : data.tasks.length >= MAX_TASKS) return;
      arr.push(copy);
      commit();
    });
  }

  // The next free start slot among the chores of the same kind.
  function nextOff(k) {
    var n = 0;
    data.tasks.forEach(function (tk) { if (tk.freq.k === k) n++; });
    return n % 1000;
  }

  function applySet(id) {
    var have = {}, added = 0, today = dnToYmd(localDn(new Date())), base = Date.now();
    data.tasks.forEach(function (tk) { have[tk.name.toLowerCase()] = true; });
    SETS[id].forEach(function (x) {
      var name = x[LANG] || x.en;
      if (have[name.toLowerCase()] || data.tasks.length >= MAX_TASKS) return;
      data.tasks.push({ id: newId(), m: base + added, name: name, icon: x.icon, freq: JSON.parse(JSON.stringify(x.freq)),
                        weight: x.weight, mode: "rr", who: [], start: today, off: nextOff(x.freq.k) });
      have[name.toLowerCase()] = true;
      added++;
    });
    if (!added) { showToast(data.tasks.length >= MAX_TASKS ? t("toast.maxTasks", { n: MAX_TASKS }) : t("toast.setNone")); return; }
    commit();
    showToast(t("toast.setAdded", { n: added }));
  }

  // ---------- 7. The wheel: drawing + turning ----------
  var cv = null, g = null, size = 0;
  var wheelPer = null;          // period start (dn) shown on the wheel; null = now
  var anim = null;              // { from: {taskId: angle}, t0, dur }
  var lastAngles = {};

  function todayDn() { return localDn(new Date()); }
  function periodNow(grp) {
    var n = todayDn();
    return grp === "w" ? monday(n) : (grp === "mo" ? monthStartOf(monthIdx(n)) : n);
  }
  function periodStep(grp, p, dir) {
    if (grp === "w") return p + 7 * dir;
    if (grp === "mo") return monthStartOf(monthIdx(p) + dir);
    return p + dir;
  }
  function wheelGroups() {
    var have = {};
    data.tasks.forEach(function (tk) { if (tk.mode === "rr" && ["d", "w", "mo"].indexOf(tk.freq.k) >= 0) have[tk.freq.k] = true; });
    return ["d", "w", "mo"].filter(function (k) { return have[k]; });
  }
  function curGroup() {
    var gs = wheelGroups();
    if (prefs.grp && gs.indexOf(prefs.grp) >= 0) return prefs.grp;
    return gs.indexOf("w") >= 0 ? "w" : (gs[0] || "w");
  }
  function curPeriod() { return wheelPer === null ? periodNow(curGroup()) : wheelPer; }

  // Chores on the wheel for the shown period, with who has them.
  function wheelModel() {
    var grp = curGroup(), p = curPeriod(), ctx = makeCtx(data), M = orderedMembers(data);
    var items = [];
    data.tasks.forEach(function (tk) {
      if (tk.mode !== "rr" || tk.freq.k !== grp) return;
      var o = occAt(tk, p);
      if (!o) return;
      items.push({ task: tk, o: o, who: assignee(ctx, tk, o), state: stateOf(data, o.key) });
    });
    items.sort(function (x, y) { return cmpStr(x.task.name.toLowerCase(), y.task.name.toLowerCase()) || cmpStr(x.task.id, y.task.id); });
    // angle of each chore: inside its member's sector, spread evenly
    var n = M.length, s = n ? TAU / n : TAU, angles = {};
    M.forEach(function (mb, i) {
      var mine = items.filter(function (it) { return it.who === mb.id; });
      mine.forEach(function (it, j) { angles[it.task.id] = i * s + s * (j + 0.5) / mine.length; });
    });
    return { grp: grp, p: p, members: M, items: items, angles: angles, s: s };
  }

  function resize() {
    var box = $("wheel-box");
    if (!box || !cv) return;
    var r = box.getBoundingClientRect();
    var sz = Math.max(160, Math.floor(Math.min(r.width, r.height || r.width)));
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.style.width = cv.style.height = sz + "px";
    cv.width = cv.height = Math.round(sz * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    size = sz;
    drawWheel();
  }

  function font(w, px) { return w + " " + px + "px Nunito, 'Segoe UI', system-ui, sans-serif"; }
  function fitText(text, maxW, px, w) {
    g.font = font(w || 800, px);
    if (g.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s.replace(/\s+$/, "") + "…";
  }
  function inkFor(hex) {
    var v = parseInt(hex.slice(1), 16);
    var lin = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255);
    return L > 0.33 ? "#1b1b1b" : "#ffffff";
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  // Radial label from rIn to rOut at angle `ang` (0 = top, clockwise).
  function radialText(text, ang, rIn, rOut, px, color, weight) {
    var c = size / 2, a = ang - Math.PI / 2;
    g.save();
    g.translate(c, c);
    g.fillStyle = color;
    g.textBaseline = "middle";
    g.font = font(weight, px);
    var w = g.measureText(text).width;
    if (w > rOut - rIn) px = Math.max(px * 0.75, px * (rOut - rIn) / w);   // shrink a little before cutting
    var txt = fitText(text, rOut - rIn, px, weight);
    if (Math.cos(a) < -0.01) { g.rotate(a + Math.PI); g.textAlign = "left"; g.fillText(txt, -rOut, 0); }
    else { g.rotate(a); g.textAlign = "right"; g.fillText(txt, rOut, 0); }
    g.restore();
  }
  // Text along the ring, upright at the top and bottom halves.
  function ringText(text, ang, r, maxW, px, color) {
    var c = size / 2, a = ang - Math.PI / 2;
    g.save();
    g.translate(c + Math.cos(a) * r, c + Math.sin(a) * r);
    var bottom = Math.sin(a) > 0.01;
    g.rotate(bottom ? a - Math.PI / 2 : a + Math.PI / 2);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(fitText(text, maxW, px, 900), 0, 0);
    g.restore();
  }

  function drawWheel(now) {
    if (!g || !size || !$("view-wheel") || $("view-wheel").hidden) return;
    var W = wheelModel(), c = size / 2, R = c - 4, rIn = R * (size < 360 ? 0.8 : 0.76), hub = R * (size < 360 ? 0.2 : 0.23);
    var css = getComputedStyle(document.documentElement);
    var border = css.getPropertyValue("--border").trim() || "#322d20";
    var panel = css.getPropertyValue("--panel-bg").trim() || "#1d1a13";
    var text = css.getPropertyValue("--text").trim() || "#f0ead9";
    var dim = css.getPropertyValue("--text-dim").trim() || "#a89f8a";
    var bg = css.getPropertyValue("--bg").trim() || "#14120d";
    g.clearRect(0, 0, size, size);
    var n = W.members.length, s = W.s;
    if (!n) {
      g.beginPath(); g.arc(c, c, R, 0, TAU);
      g.fillStyle = panel; g.fill();
      g.lineWidth = 2; g.setLineDash([8, 8]); g.strokeStyle = border; g.stroke(); g.setLineDash([]);
      return;
    }
    // outer disc: the members
    W.members.forEach(function (mb, i) {
      var a0 = -Math.PI / 2 + i * s, a1 = a0 + s, col = COLORS[mb.color];
      g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, a0, a1); g.closePath();
      g.globalAlpha = isAway(mb, W.p) ? 0.35 : 1;
      g.fillStyle = col; g.fill();
      g.globalAlpha = 1;
      var px = Math.max(11, Math.min(size / 26, 18));
      ringText((mb.icon ? mb.icon + " " : "") + mb.name, i * s + s / 2, (R + rIn) / 2, Math.max(30, s * (R + rIn) / 2 - 10), px, inkFor(col));
    });
    // inner disc
    g.beginPath(); g.arc(c, c, rIn, 0, TAU);
    g.fillStyle = panel; g.fill();
    g.lineWidth = Math.max(2, size / 120); g.strokeStyle = bg; g.stroke();
    // turning: interpolate each chore's angle (always forward)
    var k = 1;
    if (anim) {
      var tt = Math.min(1, ((now || performance.now()) - anim.t0) / anim.dur);
      k = 1 - Math.pow(1 - tt, 3);
    }
    var angles = {};
    W.items.forEach(function (it) {
      var to = W.angles[it.task.id];
      if (to === undefined) return;
      var from = anim && anim.from[it.task.id];
      if (from === undefined || !anim) { angles[it.task.id] = to; return; }
      var d = ((to - from) % TAU + TAU) % TAU;
      angles[it.task.id] = from + d * k;
    });
    // spokes on the inner disc follow the sectors
    for (var i = 0; i < n && n > 1; i++) {
      var a = -Math.PI / 2 + i * s;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * hub, c + Math.sin(a) * hub);
      g.lineTo(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn);
      g.lineWidth = 1; g.strokeStyle = border; g.stroke();
    }
    var count = {};
    W.items.forEach(function (it) { if (it.who) count[it.who] = (count[it.who] || 0) + 1; });
    W.items.forEach(function (it) {
      var ang = angles[it.task.id];
      if (ang === undefined) return;
      var mb = memberById(data, it.who), many = count[it.who] || 1;
      var px = Math.max(10, Math.min(size / 28, 16, (rIn * s / many) * 0.55));
      var label = (it.task.icon ? it.task.icon + " " : "") + it.task.name;
      g.globalAlpha = it.state ? 0.45 : 1;
      radialText(label, ang, hub + 8, rIn - 10, px, text, 800);
      // a dot at the rim in the member's colour
      var a2 = ang - Math.PI / 2;
      g.beginPath(); g.arc(c + Math.cos(a2) * (rIn - 5), c + Math.sin(a2) * (rIn - 5), 3, 0, TAU);
      g.fillStyle = mb ? COLORS[mb.color] : dim; g.fill();
      g.globalAlpha = 1;
      lastAngles[it.task.id] = ang;
    });
    // hub
    g.beginPath(); g.arc(c, c, hub, 0, TAU);
    g.fillStyle = bg; g.fill();
    g.lineWidth = Math.max(2, size / 120); g.strokeStyle = border; g.stroke();
    var lines = periodLabel(W.grp, W.p, true);
    g.fillStyle = text; g.textAlign = "center"; g.textBaseline = "middle";
    var hp = Math.max(10, Math.min(hub / 3.2, 16));
    g.font = font(900, hp);
    g.fillText(fitText(lines[0], hub * 1.7, hp, 900), c, c - (lines[1] ? hp * 0.6 : 0));
    if (lines[1]) {
      g.fillStyle = dim;
      g.fillText(fitText(lines[1], hub * 1.7, hp * 0.8, 700), c, c + hp * 0.7);
    }
  }

  function turnWheel(dir) {
    var grp = curGroup();
    var from = {};
    Object.keys(lastAngles).forEach(function (k) { from[k] = lastAngles[k]; });
    wheelPer = periodStep(grp, curPeriod(), dir);
    if (wheelPer === periodNow(grp)) wheelPer = null;
    lastAngles = {};
    if (!reducedMotion()) {
      anim = { from: from, t0: performance.now(), dur: 700 };
      var step = function (now) {
        drawWheel(now);
        if (anim && now - anim.t0 < anim.dur) requestAnimationFrame(step);
        else { anim = null; drawWheel(); }
      };
      requestAnimationFrame(step);
    }
    renderWheel();
  }

  // ---------- 8. Views ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }

  var UI = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17 19 7"/></svg>',
    more:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="3" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="21" y2="12"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><polyline points="8.5 13.5 11 16 15.5 11"/><line x1="8" y1="2.5" x2="8" y2="6"/><line x1="16" y1="2.5" x2="16" y2="6"/></svg>',
    week:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="13" x2="8" y2="17"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="16" y1="13" x2="16" y2="17"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/></svg>',
    home:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>'
  };

  function fmtDay(n, withDow) {
    var ymd = dnToYmd(n), d = ymd.slice(8, 10), m = ymd.slice(5, 7);
    return (withDow ? t("dow")[dow(n)] + " " : "") + d + "/" + m;
  }
  function periodLabel(grp, p, two) {
    if (grp === "w") return two ? [fmtDay(p), fmtDay(p + 6)] : [fmtDay(p) + " – " + fmtDay(p + 6)];
    if (grp === "mo") {
      var mi = monthIdx(p);
      return two ? [t("months")[mi % 12], String(Math.floor(mi / 12))] : [t("months")[mi % 12] + " " + Math.floor(mi / 12)];
    }
    return two ? [t("dow")[dow(p)], fmtDay(p)] : [fmtDay(p, true)];
  }
  function freqLabel(f) {
    if (f.k === "n") return t("freq.nShort", { n: f.n });
    if (f.k === "wd") return f.d.map(function (d) { return t("dow")[d]; }).join(" · ");
    return t("freq." + f.k);
  }
  function memberChip(id) {
    var mb = memberById(data, id);
    var c = el("span", "who");
    if (!mb) { c.textContent = t("today.nobody"); c.classList.add("none"); return c; }
    var dot = el("span", "dot");
    dot.style.background = COLORS[mb.color];
    c.appendChild(dot);
    c.appendChild(el("span", "who-name", (mb.icon ? mb.icon + " " : "") + mb.name));
    return c;
  }

  function setTab(tab) {
    prefs.tab = tab;
    savePrefs();
    renderAll();
  }
  function activeTab() { return prefs.tab || "home"; }

  function renderTabs() {
    var cur = activeTab();
    TABS.forEach(function (id) {
      var b = $("tab-" + id), on = id === cur;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("on", on);
      $("view-" + id).hidden = !on;
    });
  }

  // ----- Wheel view -----
  function renderWheel() {
    if ($("view-wheel").hidden) return;
    var gs = wheelGroups(), grp = curGroup();
    var chips = $("grp-chips");
    chips.innerHTML = "";
    gs.forEach(function (k) {
      var b = el("button", "chip" + (k === grp ? " on" : ""), t("grp." + k));
      b.type = "button";
      b.setAttribute("aria-pressed", k === grp ? "true" : "false");
      b.addEventListener("click", function () { prefs.grp = k; wheelPer = null; lastAngles = {}; savePrefs(); renderWheel(); });
      chips.appendChild(b);
    });
    var empty = !data.members.length || !data.tasks.length;
    $("wheel-empty").hidden = !empty;
    $("wheel-none").hidden = empty || gs.length > 0;
    $("per-label").textContent = periodLabel(grp, curPeriod())[0];
    $("per-now").hidden = wheelPer === null;
    var W = wheelModel();
    // text alternative + legend: who has what this period
    var leg = $("legend"), parts = [];
    leg.innerHTML = "";
    W.members.forEach(function (mb) {
      var mine = W.items.filter(function (it) { return it.who === mb.id; });
      var li = el("li");
      li.appendChild(memberChip(mb.id));
      var tl = el("span", "leg-tasks");
      if (!mine.length) tl.textContent = "—";
      mine.forEach(function (it, i) {
        var s = el("span", "leg-task" + (it.state ? " done" : ""), (it.task.icon ? it.task.icon + " " : "") + it.task.name);
        tl.appendChild(s);
        if (i < mine.length - 1) tl.appendChild(document.createTextNode(", "));
      });
      li.appendChild(tl);
      leg.appendChild(li);
      parts.push(mb.name + ": " + (mine.map(function (it) { return it.task.name; }).join(", ") || "—"));
    });
    $("wheel-wrap").setAttribute("aria-label", t("wheel.aria", { list: parts.join("; ") }));
    resize();
  }

  // ----- Today view -----
  function rowEl(r, n) {
    var li = el("li", "row" + (r.state === 1 ? " is-done" : "") + (r.state === 2 ? " is-skip" : "") + (r.late ? " is-late" : ""));
    var future = r.o.a > todayDn();
    var cb = el("button", "cb");
    cb.type = "button";
    cb.innerHTML = UI.check;
    cb.setAttribute("role", "checkbox");
    cb.setAttribute("aria-checked", r.state === 1 ? "true" : "false");
    cb.setAttribute("aria-label", t(r.state === 1 ? "row.undone" : "row.done", { t: r.task.name }));
    cb.disabled = future || (!r.who && r.state !== 1);
    cb.addEventListener("click", function () {
      if (r.state === 1) setDone(r.o.key, 0, "");
      else {
        var by = r.who || prefs.me;
        if (!by) return;
        setDone(r.o.key, 1, by);
        live(t("toast.done", { t: r.task.name }));
      }
    });
    li.appendChild(cb);
    var body = el("div", "row-body");
    var title = el("div", "row-title", (r.task.icon ? r.task.icon + " " : "") + r.task.name);
    body.appendChild(title);
    var meta = el("div", "row-meta");
    if (r.late) meta.appendChild(el("span", "tag late", t("today.late") + " · " + fmtDay(r.o.a)));
    if (r.task.freq.k === "w" || r.task.freq.k === "mo" || r.task.freq.k === "n") {
      if (!r.late) meta.appendChild(el("span", "tag", fmtDay(r.o.a) + " – " + fmtDay(r.o.b)));
    }
    if (r.state === 1 && r.by && r.by !== r.who) meta.appendChild(el("span", "tag", t("row.by", { m: (memberById(data, r.by) || { name: "?" }).name })));
    if (r.state === 2) meta.appendChild(el("span", "tag", t("row.skipped")));
    if (meta.childNodes.length) body.appendChild(meta);
    li.appendChild(body);
    if (n !== "noWho") li.appendChild(memberChip(r.who));
    if (!r.who && r.task.mode === "spin" && !r.state) {
      var sp = el("button", "txt-btn small", t("act.spin"));
      sp.type = "button";
      sp.addEventListener("click", function () { spinDialog(r); });
      li.appendChild(sp);
    }
    li.appendChild(iconBtn("mini", UI.more, t("row.more", { t: r.task.name }), function () { actionsDialog(r); }));
    return li;
  }

  function renderToday() {
    if ($("view-today").hidden) return;
    var n = todayDn(), ctx = makeCtx(data), rows = dayRows(ctx, n);
    $("today-date").textContent = fmtDay(n, true);
    var counted = rows.filter(function (r) { return !r.late; });
    var doneN = counted.filter(function (r) { return r.state !== 0; }).length;
    $("today-prog").textContent = counted.length ? t("today.prog", { d: doneN, n: counted.length }) : "";
    var bar = $("today-bar");
    bar.hidden = !counted.length;
    bar.firstChild.style.width = counted.length ? Math.round(doneN * 100 / counted.length) + "%" : "0";
    var meOk = !!memberById(data, prefs.me);
    $("only-wrap").hidden = !meOk;
    $("only-me").checked = !!prefs.only;
    var only = meOk && prefs.only;
    var host = $("today-list");
    host.innerHTML = "";
    var M = orderedMembers(data);
    if (meOk) M.sort(function (x, y) { return (x.id === prefs.me ? 0 : 1) - (y.id === prefs.me ? 0 : 1); });
    var any = false;
    M.forEach(function (mb) {
      if (only && mb.id !== prefs.me) return;
      var mine = rows.filter(function (r) { return r.who === mb.id; });
      if (!mine.length) return;
      any = true;
      host.appendChild(groupEl(mb, mine));
    });
    var open = rows.filter(function (r) { return !r.who; });
    if (open.length && !only) {
      any = true;
      var sec = el("section", "grp");
      sec.appendChild(el("h3", "grp-head", t("today.open")));
      var ul = el("ul", "rows");
      open.forEach(function (r) { ul.appendChild(rowEl(r, "noWho")); });
      sec.appendChild(ul);
      host.appendChild(sec);
    }
    $("today-free").hidden = any || !data.members.length;
    $("today-setup").hidden = !!data.members.length;
  }
  function groupEl(mb, rows) {
    var sec = el("section", "grp" + (mb.id === prefs.me ? " me" : ""));
    var h = el("h3", "grp-head");
    var dot = el("span", "dot");
    dot.style.background = COLORS[mb.color];
    h.appendChild(dot);
    h.appendChild(document.createTextNode((mb.icon ? mb.icon + " " : "") + mb.name));
    var dn = rows.filter(function (r) { return r.state !== 0; }).length;
    h.appendChild(el("span", "grp-count", dn + "/" + rows.length));
    sec.appendChild(h);
    var ul = el("ul", "rows");
    rows.forEach(function (r) { ul.appendChild(rowEl(r, "noWho")); });
    sec.appendChild(ul);
    return sec;
  }

  // ----- Week view -----
  var weekStart = null;          // monday dn; null = this week
  function renderWeek() {
    if ($("view-week").hidden) return;
    var mon = weekStart === null ? monday(todayDn()) : weekStart, today = todayDn();
    $("week-label").textContent = fmtDay(mon) + " – " + fmtDay(mon + 6);
    $("week-now").hidden = weekStart === null;
    var ctx = makeCtx(data), host = $("week-list");
    host.innerHTML = "";
    var only = memberById(data, prefs.me) && prefs.only;
    function keep(r) { return !only || r.who === prefs.me; }
    // chores of the whole week / month first
    var wide = [];
    data.tasks.forEach(function (tk) {
      if (tk.freq.k !== "w" && tk.freq.k !== "mo") return;
      var seen = {};
      for (var d = mon; d <= mon + 6; d++) {
        var o = occAt(tk, d);
        if (o && !seen[o.key]) { seen[o.key] = true; wide.push(row(ctx, tk, o, false)); }
      }
    });
    wide = wide.filter(keep);
    if (wide.length) host.appendChild(daySec(t("week.wk"), wide, false));
    for (var n = mon; n <= mon + 6; n++) {
      var rows = [];
      data.tasks.forEach(function (tk) {
        if (tk.freq.k === "w" || tk.freq.k === "mo") return;
        var o = occAt(tk, n);
        if (o && o.a === n) rows.push(row(ctx, tk, o, false));
      });
      rows = rows.filter(keep);
      host.appendChild(daySec(fmtDay(n, true), rows, n === today));
    }
    $("week-setup").hidden = !!data.members.length;
  }
  function daySec(title, rows, isToday) {
    var sec = el("section", "grp" + (isToday ? " today" : ""));
    sec.appendChild(el("h3", "grp-head", title));
    if (!rows.length) { sec.appendChild(el("p", "hint", t("week.none"))); return sec; }
    rows.sort(function (x, y) {
      var a = memberById(data, x.who), b = memberById(data, y.who);
      return (a ? a.order : 1e4) - (b ? b.order : 1e4) || cmpStr(x.task.name, y.task.name);
    });
    var ul = el("ul", "rows");
    rows.forEach(function (r) { ul.appendChild(rowEl(r)); });
    sec.appendChild(ul);
    return sec;
  }

  // ----- Stats view -----
  function renderStats() {
    if ($("view-stats").hidden) return;
    var today = todayDn(), ctx = makeCtx(data), from, to = today;
    [].forEach.call(document.querySelectorAll("#range-chips .chip"), function (b) {
      var on = b.getAttribute("data-r") === prefs.range;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (prefs.range === "wk") { from = monday(today); to = from + 6; }
    else if (prefs.range === "mo") { from = monthStartOf(monthIdx(today)); to = monthStartOf(monthIdx(today) + 1) - 1; }
    else from = today - 364;
    var S = statsFor(ctx, from, to, today), M = orderedMembers(data);
    var host = $("stats-list");
    host.innerHTML = "";
    $("stats-none").hidden = !!M.length;
    var max = 0, total = 0;
    M.forEach(function (mb) { max = Math.max(max, S[mb.id].pts); total += S[mb.id].pts; });
    M.forEach(function (mb) {
      var s = S[mb.id], li = el("li", "stat");
      var top = el("div", "stat-top");
      top.appendChild(memberChip(mb.id));
      top.appendChild(el("span", "stat-pts", s.pts === 1 ? t("stats.pt") : t("stats.pts", { n: s.pts })));
      li.appendChild(top);
      var bar = el("div", "bar"), fill = el("i");
      fill.style.width = max ? Math.round(s.pts * 100 / max) + "%" : "0";
      fill.style.background = COLORS[mb.color];
      bar.appendChild(fill);
      // the fair share mark: everyone equal
      if (total && M.length > 1) {
        var mark = el("b", "fair");
        mark.style.left = Math.min(100, Math.round((total / M.length) * 100 / max)) + "%";
        mark.title = t("stats.fair");
        bar.appendChild(mark);
      }
      li.appendChild(bar);
      var sk = streakOf(ctx, mb.id, today);
      var sub = el("div", "stat-sub");
      sub.appendChild(el("span", "", t("stats.done", { n: s.done })));
      sub.appendChild(el("span", s.missed ? "warn" : "", t("stats.missed", { n: s.missed })));
      sub.appendChild(el("span", "", t("stats.streak") + ": " + (sk === 1 ? t("stats.day") : t("stats.days", { n: sk }))));
      li.appendChild(sub);
      host.appendChild(li);
    });
    // history: last 90 days, newest first
    var hist = [];
    Object.keys(data.done).forEach(function (k) {
      var d = data.done[k], km = KEY_RE.exec(k);
      if (d[0] === 0 || ymdToDn(km[2]) < today - 90) return;
      hist.push({ task: taskById(data, km[1]), by: d[1], st: d[0], m: d[2], a: ymdToDn(km[2]) });
    });
    hist.sort(function (x, y) { return y.m - x.m; });
    var hl = $("hist");
    hl.innerHTML = "";
    hist.slice(0, 150).forEach(function (h) {
      if (!h.task) return;
      var li = el("li");
      li.appendChild(el("span", "h-w", (h.task.icon ? h.task.icon + " " : "") + h.task.name));
      li.appendChild(h.st === 1 ? memberChip(h.by) : el("span", "tag", t("row.skipped")));
      li.appendChild(el("span", "h-t", fmtDay(h.a)));
      hl.appendChild(li);
    });
    $("hist-empty").hidden = !!hl.childNodes.length;
  }

  // ----- Home view -----
  function renderHome() {
    if ($("view-home").hidden) return;
    var M = orderedMembers(data), ml = $("members");
    ml.innerHTML = "";
    M.forEach(function (mb, i) {
      var li = el("li", "item");
      var sw = el("span", "swatch", mb.icon || mb.name.charAt(0).toUpperCase());
      sw.style.background = COLORS[mb.color];
      sw.style.color = inkFor(COLORS[mb.color]);
      li.appendChild(sw);
      var body = el("div", "item-body");
      body.appendChild(el("div", "item-name", mb.name));
      if (mb.away) body.appendChild(el("div", "item-sub", t("m.away", { from: fmtDay(ymdToDn(mb.away[0])), to: fmtDay(ymdToDn(mb.away[1])) })));
      li.appendChild(body);
      var up = iconBtn("mini", UI.up, t("m.up", { name: mb.name }), function () { moveMember(mb.id, -1); });
      up.disabled = i === 0;
      var dn = iconBtn("mini", UI.down, t("m.down", { name: mb.name }), function () { moveMember(mb.id, 1); });
      dn.disabled = i === M.length - 1;
      li.appendChild(up);
      li.appendChild(dn);
      li.appendChild(iconBtn("mini", UI.edit, t("m.edit", { name: mb.name }), function () { memberDialog(mb.id); }));
      li.appendChild(iconBtn("mini danger", UI.x, t("m.del", { name: mb.name }), function () { deleteEntity("member", mb.id); }));
      ml.appendChild(li);
    });
    $("members-empty").hidden = !!M.length;
    $("add-member").disabled = M.length >= MAX_MEMBERS;
    // who am I here
    var sel = $("me-sel"), cur = memberById(data, prefs.me) ? prefs.me : "";
    sel.innerHTML = "";
    var o0 = el("option", "", t("home.meNone"));
    o0.value = "";
    sel.appendChild(o0);
    M.forEach(function (mb) {
      var o = el("option", "", mb.name);
      o.value = mb.id;
      sel.appendChild(o);
    });
    sel.value = cur;
    // chores
    var tl = $("tasks");
    tl.innerHTML = "";
    data.tasks.slice().sort(function (x, y) { return cmpStr(x.name.toLowerCase(), y.name.toLowerCase()) || cmpStr(x.id, y.id); })
      .forEach(function (tk) {
        var li = el("li", "item");
        li.appendChild(el("span", "swatch task", tk.icon || "•"));
        var body = el("button", "item-body as-btn");
        body.type = "button";
        body.appendChild(el("div", "item-name", tk.name));
        body.appendChild(el("div", "item-sub", freqLabel(tk.freq) + " · " + t("mode." + tk.mode) + " · " + t("w." + tk.weight)));
        body.addEventListener("click", function () { taskDialog(tk.id); });
        li.appendChild(body);
        li.appendChild(iconBtn("mini", UI.edit, t("m.edit", { name: tk.name }), function () { taskDialog(tk.id); }));
        li.appendChild(iconBtn("mini danger", UI.x, t("m.del", { name: tk.name }), function () { deleteEntity("task", tk.id); }));
        tl.appendChild(li);
      });
    $("tasks-empty").hidden = !!data.tasks.length;
    $("new-task").disabled = data.tasks.length >= MAX_TASKS;
  }

  function renderAll() {
    renderTabs();
    renderWheel();
    renderToday();
    renderWeek();
    renderStats();
    renderHome();
  }

  // ---------- 9. Dialogs ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function field(label, node) {
    var w = el("div", "fld");
    var l = el("label", "dlg-lbl", label);
    if (node.id) l.htmlFor = node.id;
    w.appendChild(l);
    w.appendChild(node);
    return w;
  }
  // A row of toggle chips (radio-like when `single`).
  function chipGroup(label, items, cur, single, onPick) {
    var w = el("div", "fld");
    w.appendChild(el("div", "dlg-lbl", label));
    var box = el("div", "chips");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", label);
    items.forEach(function (it) {
      var b = el("button", "chip", it.label);
      b.type = "button";
      if (it.title) b.title = it.title;
      if (it.style) b.style.cssText = it.style;
      var on = single ? cur === it.v : cur.indexOf(it.v) >= 0;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        onPick(it.v);
        [].forEach.call(box.children, function (c) {
          if (!single && c !== b) return;
          var o2 = single ? c === b : !c.classList.contains("on");
          c.classList.toggle("on", o2);
          c.setAttribute("aria-pressed", o2 ? "true" : "false");
        });
      });
      box.appendChild(b);
    });
    w.appendChild(box);
    return w;
  }

  function memberDialog(id) {
    var mb = memberById(data, id);
    if (!mb) return;
    var dlg = makeDialog("member-dlg");
    dlg.setAttribute("aria-label", t("dlg.member"));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("div", "dlg-title", t("dlg.member")));
    var name = el("input");
    name.id = "m-name"; name.maxLength = NAME_LEN; name.value = mb.name; name.autocomplete = "off";
    form.appendChild(field(t("dlg.name"), name));
    var color = mb.color, icon = mb.icon;
    form.appendChild(chipGroup(t("dlg.color"), COLORS.map(function (c, i) {
      return { v: i, label: "", title: c, style: "background:" + c + ";width:36px;padding:0" };
    }), color, true, function (v) { color = v; }));
    form.appendChild(chipGroup(t("dlg.icon"), MEMBER_ICONS.map(function (ic) {
      return { v: ic, label: ic || mb.name.charAt(0).toUpperCase() };
    }), icon, true, function (v) { icon = v; }));
    var aw = el("div", "fld");
    aw.appendChild(el("div", "dlg-lbl", t("dlg.away")));
    var row2 = el("div", "two");
    var af = el("input"), at = el("input");
    af.type = at.type = "date";
    af.setAttribute("aria-label", t("dlg.awayFrom"));
    at.setAttribute("aria-label", t("dlg.awayTo"));
    af.value = mb.away ? mb.away[0] : "";
    at.value = mb.away ? mb.away[1] : "";
    row2.appendChild(af);
    row2.appendChild(at);
    aw.appendChild(row2);
    var clr = el("button", "link-btn", t("dlg.awayClear"));
    clr.type = "button";
    clr.addEventListener("click", function () { af.value = ""; at.value = ""; });
    aw.appendChild(clr);
    form.appendChild(aw);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("dlg.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = normText(name.value, NAME_LEN);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var away = null;
      if (af.value || at.value) {
        var a = normYmd(af.value || at.value), b = normYmd(at.value || af.value);
        if (!a || !b) { showToast(t("toast.awayBad")); return; }
        if (a > b) { showToast(t("toast.awayBad")); return; }
        away = [a, b];
      }
      var x = memberById(data, id);
      if (!x) { dlg.close(); return; }
      var next = { name: nm, color: color, icon: icon, away: away };
      if (JSON.stringify([x.name, x.color, x.icon, x.away]) !== JSON.stringify([nm, color, icon, away])) {
        Object.keys(next).forEach(function (k) { x[k] = next[k]; });
        stamp(x);
        commit();
      }
      dlg.close();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    name.focus();
  }

  function taskDialog(id) {
    var tk = id ? taskById(data, id) : null;
    if (!tk && data.tasks.length >= MAX_TASKS) { showToast(t("toast.maxTasks", { n: MAX_TASKS })); return; }
    var cur = tk ? JSON.parse(JSON.stringify(tk)) :
      { name: "", icon: TASK_ICONS[0], freq: { k: "w" }, weight: 1, mode: "rr", who: [], start: dnToYmd(todayDn()) };
    var dlg = makeDialog("task-dlg");
    dlg.setAttribute("aria-label", t("dlg.task"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("div", "dlg-title", t("dlg.task")));
    var name = el("input");
    name.id = "t-name"; name.maxLength = TASK_LEN; name.value = cur.name; name.autocomplete = "off";
    form.appendChild(field(t("dlg.name"), name));
    form.appendChild(chipGroup(t("dlg.icon"), TASK_ICONS.map(function (ic) { return { v: ic, label: ic }; }),
      cur.icon, true, function (v) { cur.icon = v; }));
    // frequency
    var fsel = el("select");
    fsel.id = "t-freq";
    FREQS.forEach(function (k) { var o = el("option", "", t("freq." + k)); o.value = k; fsel.appendChild(o); });
    fsel.value = cur.freq.k;
    form.appendChild(field(t("dlg.freq"), fsel));
    var nIn = el("input");
    nIn.id = "t-n"; nIn.type = "number"; nIn.min = 2; nIn.max = 30; nIn.value = cur.freq.n || 2;
    var nFld = field(t("dlg.every"), nIn);
    form.appendChild(nFld);
    var days = (cur.freq.d || [5]).slice();
    var dFld = chipGroup(t("dlg.days"), [0, 1, 2, 3, 4, 5, 6].map(function (d) { return { v: d, label: t("dow")[d] }; }),
      days, false, function (v) { var i = days.indexOf(v); if (i >= 0) days.splice(i, 1); else days.push(v); });
    form.appendChild(dFld);
    function showFreq() { nFld.hidden = fsel.value !== "n"; dFld.hidden = fsel.value !== "wd"; }
    fsel.addEventListener("change", showFreq);
    showFreq();
    var start = el("input");
    start.id = "t-start"; start.type = "date"; start.value = cur.start;
    form.appendChild(field(t("dlg.start"), start));
    form.appendChild(chipGroup(t("dlg.weight"), [1, 2, 3].map(function (w) { return { v: w, label: t("w." + w) }; }),
      cur.weight, true, function (v) { cur.weight = v; }));
    var modeHint = el("p", "hint", t("mode." + cur.mode + ".d"));
    var mg = chipGroup(t("dlg.mode"), MODES.map(function (m) { return { v: m, label: t("mode." + m) }; }),
      cur.mode, true, function (v) { cur.mode = v; modeHint.textContent = t("mode." + v + ".d"); });
    mg.appendChild(modeHint);
    form.appendChild(mg);
    var M = orderedMembers(data);
    var who = cur.who.filter(function (x) { return memberById(data, x); });
    if (M.length) {
      var wg = chipGroup(t("dlg.who"),
        M.map(function (mb) { return { v: mb.id, label: (mb.icon ? mb.icon + " " : "") + mb.name }; }),
        who, false, function (v) { var i = who.indexOf(v); if (i >= 0) who.splice(i, 1); else who.push(v); });
      wg.appendChild(el("p", "hint", t("dlg.all")));
      form.appendChild(wg);
    }
    var acts = el("div", "dlg-actions");
    if (tk) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteEntity("task", tk.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = el("button", "dlg-btn primary", t("dlg.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = normText(name.value, TASK_LEN);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var freq = { k: fsel.value };
      if (freq.k === "n") freq.n = Math.max(2, Math.min(30, parseInt(nIn.value, 10) || 2));
      if (freq.k === "wd") {
        if (!days.length) { showToast(t("toast.daysBad")); return; }
        freq.d = days.slice();
      }
      var st = normYmd(start.value) || dnToYmd(todayDn());
      var next = normTask({ id: tk ? tk.id : "aaaaaa", m: 0, name: nm, icon: cur.icon, freq: freq, weight: cur.weight,
                            mode: cur.mode, who: who.length === M.length ? [] : who, start: st,
                            off: tk ? tk.off : nextOff(freq.k) });
      if (!next) return;
      if (tk) {
        var x = taskById(data, tk.id);
        if (!x) { dlg.close(); return; }
        var keys = ["name", "icon", "freq", "weight", "mode", "who", "start"];
        var changed = keys.some(function (k) { return JSON.stringify(x[k]) !== JSON.stringify(next[k]); });
        if (changed) {
          keys.forEach(function (k) { x[k] = next[k]; });
          stamp(x);
          commit();
        }
      } else {
        if (data.tasks.length >= MAX_TASKS) { showToast(t("toast.maxTasks", { n: MAX_TASKS })); return; }
        next.id = newId();
        next.m = Date.now();
        data.tasks.push(next);
        commit();
      }
      dlg.close();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!tk) name.focus();
  }

  // Actions on one chore occurrence: done by…, hand over, skip, undo, spin.
  function actionsDialog(r) {
    var dlg = makeDialog("act-dlg");
    dlg.setAttribute("aria-label", r.task.name);
    dlg.appendChild(el("div", "dlg-title", (r.task.icon ? r.task.icon + " " : "") + r.task.name));
    var sub = r.o.a === r.o.b ? fmtDay(r.o.a, true) : fmtDay(r.o.a) + " – " + fmtDay(r.o.b);
    dlg.appendChild(el("div", "dlg-sub", sub + " · " + t("mode." + r.task.mode)));
    var M = orderedMembers(data), future = r.o.a > todayDn();
    function memberRow(label, pick, curId) {
      var w = el("div", "fld");
      w.appendChild(el("div", "dlg-lbl", label));
      var box = el("div", "chips");
      M.forEach(function (mb) {
        var b = el("button", "chip" + (mb.id === curId ? " on" : ""), (mb.icon ? mb.icon + " " : "") + mb.name);
        b.type = "button";
        b.style.borderColor = COLORS[mb.color];
        b.addEventListener("click", function () { dlg.close(); pick(mb.id); });
        box.appendChild(b);
      });
      w.appendChild(box);
      return w;
    }
    if (!future) dlg.appendChild(memberRow(t("act.doneBy"), function (id) { setDone(r.o.key, 1, id); }, r.state === 1 ? r.by : ""));
    dlg.appendChild(memberRow(t("act.give"), function (id) { setWho(r.o.key, id); }, data.set[r.o.key] && data.set[r.o.key][0]));
    var acts = el("div", "dlg-actions wrap");
    if (data.set[r.o.key] && data.set[r.o.key][0] && r.task.mode !== "spin") {
      acts.appendChild(button(t("act.keep"), "", function () { dlg.close(); setWho(r.o.key, ""); }));
    }
    if (r.task.mode === "spin" && !r.state) {
      acts.appendChild(button(r.who ? t("act.respin") : t("act.spin"), "", function () { dlg.close(); spinDialog(r); }));
    }
    if (r.state !== 2 && !future) acts.appendChild(button(t("act.skip"), "", function () { dlg.close(); setDone(r.o.key, 2, ""); }));
    if (r.state !== 0) acts.appendChild(button(t("act.undo"), "", function () { dlg.close(); setDone(r.o.key, 0, ""); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Uniform integer in [0, n): rejection sampling, no modulo bias.
  function randInt(n) {
    var lim = Math.floor(4294967296 / n) * n, r = new Uint32Array(1);
    do { crypto.getRandomValues(r); } while (r[0] >= lim);
    return r[0] % n;
  }

  // Spin for one occurrence: the winner is drawn first among the free
  // members, the wheel only lands there; the result is stored as an
  // event (LWW, so two phones spinning at once settle on one).
  function spinDialog(r) {
    var L = pool(data, r.task), free = L.filter(function (mb) { return !isAway(mb, r.o.a); });
    if (!free.length) free = L;
    if (!free.length) { showToast(t("toast.needMembers")); return; }
    if (free.length === 1) {
      setWho(r.o.key, free[0].id);
      showToast(t("spin.one", { m: free[0].name }));
      return;
    }
    var dlg = makeDialog("spin-dlg");
    dlg.classList.add("spin-dlg");
    dlg.setAttribute("aria-label", t("spin.title", { t: r.task.name }));
    dlg.appendChild(el("div", "dlg-title", t("spin.title", { t: r.task.name })));
    var wrap = el("div", "spin-wrap");
    var c2 = el("canvas");
    c2.setAttribute("aria-hidden", "true");
    wrap.appendChild(el("div", "spin-ptr"));
    wrap.appendChild(c2);
    dlg.appendChild(wrap);
    var res = el("div", "res-win", "");
    res.setAttribute("aria-live", "polite");
    dlg.appendChild(res);
    var acts = el("div", "dlg-actions");
    var close = button(t("dlg.close"), "", function () { dlg.close(); });
    var go = button(t("spin.go"), "primary", doSpin);
    acts.appendChild(close);
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    var S = 240, dpr = Math.min(3, window.devicePixelRatio || 1), x = c2.getContext("2d"), rot = 0, n = free.length;
    c2.width = c2.height = Math.round(S * dpr);
    c2.style.width = c2.style.height = S + "px";
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    function paint() {
      var cc = S / 2, R = cc - 3, s = TAU / n;
      x.clearRect(0, 0, S, S);
      free.forEach(function (mb, i) {
        var a0 = -Math.PI / 2 + rot + i * s, col = COLORS[mb.color];
        x.beginPath(); x.moveTo(cc, cc); x.arc(cc, cc, R, a0, a0 + s); x.closePath();
        x.fillStyle = col; x.fill();
        x.lineWidth = 1.5; x.strokeStyle = "rgba(0,0,0,0.25)"; x.stroke();
        x.save(); x.translate(cc, cc);
        var mid = a0 + s / 2, txt = (mb.icon ? mb.icon + " " : "") + mb.name;
        x.font = font(800, 14);
        while (txt.length > 1 && x.measureText(txt).width > R - 30) txt = txt.slice(0, -1);
        x.fillStyle = inkFor(col); x.textBaseline = "middle";
        if (Math.cos(mid) < -0.01) { x.rotate(mid + Math.PI); x.textAlign = "left"; x.fillText(txt, -(R - 10), 0); }
        else { x.rotate(mid); x.textAlign = "right"; x.fillText(txt, R - 10, 0); }
        x.restore();
      });
    }
    paint();
    var busy = false;
    function doSpin() {
      if (busy) return;
      busy = true;
      go.disabled = true;
      res.textContent = "";
      var win = randInt(n), s = TAU / n, frac = 0.15 + 0.7 * randInt(1000) / 1000;
      var want = ((-(win + frac) * s) % TAU + TAU) % TAU;
      var turns = reducedMotion() ? 1 : 3 + randInt(3);
      var from = rot, to = rot + turns * TAU + ((want - rot) % TAU + TAU) % TAU;
      var dur = reducedMotion() ? 900 : 3200, t0 = performance.now();
      function frame(now) {
        if (!dlg.open) return;
        var k = Math.min(1, (now - t0) / dur);
        rot = from + (to - from) * (1 - Math.pow(1 - k, 3));
        paint();
        if (k < 1) { requestAnimationFrame(frame); return; }
        rot = to % TAU;
        var mb = free[win];
        res.textContent = t("spin.res", { m: mb.name });
        live(t("live.spin", { m: mb.name, t: r.task.name }));
        setWho(r.o.key, mb.id);
        busy = false;
        go.disabled = false;
        go.textContent = t("act.respin");
      }
      requestAnimationFrame(frame);
    }
  }

  // ---------- 10. Toasts + keyboard ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "chores", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
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
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
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
    // ← / → change the period (wheel, week); N new chore
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (tg && tg.getAttribute && tg.getAttribute("role") === "tab") return;
      var tab = activeTab();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        var dir = e.key === "ArrowLeft" ? -1 : 1;
        if (tab === "wheel") { e.preventDefault(); turnWheel(dir); }
        else if (tab === "week") { e.preventDefault(); stepWeek(dir); }
      } else if (e.code === "KeyN") {
        e.preventDefault();
        taskDialog(null);
      }
    });
  }
  function stepWeek(dir) {
    var mon = weekStart === null ? monday(todayDn()) : weekStart;
    weekStart = mon + 7 * dir;
    if (weekStart === monday(todayDn())) weekStart = null;
    renderWeek();
  }

  // ---------- 11. Sync slice + palette ----------
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
    drawWheel();
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
    api.registerSlice("chores", sliceGet, sliceSet, STORAGE_KEY, mergeChores);
  }

  function sliceGet() {
    return mergeChores(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.members)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeChores(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (prefs.me && !memberById(data, prefs.me)) { prefs.me = ""; savePrefs(); }
    var open = document.querySelector("dialog[open]");
    if (open && open.id === "spin-dlg") return;       // never repaint under a running spin
    renderAll();
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    TABS.forEach(function (id) {
      var b = $("tab-" + id);
      b.innerHTML = UI[id] + "<span>" + t("tab." + id) + "</span>";
      b.setAttribute("aria-label", t("tab." + id));
    });
    [["per-prev", UI.left, "per.prev"], ["per-next", UI.right, "per.next"],
     ["week-prev", UI.left, "per.prev"], ["week-next", UI.right, "per.next"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = x[1];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("per-now").textContent = t("per.now");
    $("week-now").textContent = t("per.now");
    $("add-member-in").placeholder = t("home.addMember");
    $("add-member-in").setAttribute("aria-label", t("home.addMember"));
    $("add-member").innerHTML = UI.plus;
    $("add-member").setAttribute("aria-label", t("home.addMember"));
    $("new-task").innerHTML = UI.plus + "<span>" + t("home.addTask") + "</span>";
    var sets = $("sets");
    sets.innerHTML = "";
    SET_IDS.forEach(function (id) {
      var b = el("button", "chip", SETS[id][0].icon + " " + t("set." + id));
      b.type = "button";
      b.addEventListener("click", function () { applySet(id); });
      sets.appendChild(b);
    });
    [].forEach.call(document.querySelectorAll("#range-chips .chip"), function (b) {
      b.textContent = t("stats." + b.getAttribute("data-r"));
    });
  }

  function wireTabs() {
    TABS.forEach(function (id, i) {
      var b = $("tab-" + id);
      b.addEventListener("click", function () { setTab(id); });
      b.addEventListener("keydown", function (e) {
        var j = -1;
        if (e.key === "ArrowRight") j = (i + 1) % TABS.length;
        else if (e.key === "ArrowLeft") j = (i + TABS.length - 1) % TABS.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = TABS.length - 1;
        if (j < 0) return;
        e.preventDefault();
        setTab(TABS[j]);
        $("tab-" + TABS[j]).focus();
      });
    });
  }

  function wire() {
    wireTabs();
    $("per-prev").addEventListener("click", function () { turnWheel(-1); });
    $("per-next").addEventListener("click", function () { turnWheel(1); });
    $("per-now").addEventListener("click", function () { wheelPer = null; lastAngles = {}; renderWheel(); });
    $("week-prev").addEventListener("click", function () { stepWeek(-1); });
    $("week-next").addEventListener("click", function () { stepWeek(1); });
    $("week-now").addEventListener("click", function () { weekStart = null; renderWeek(); });
    [].forEach.call(document.querySelectorAll(".to-home"), function (b) {
      b.addEventListener("click", function () { setTab("home"); });
    });
    $("only-me").addEventListener("change", function () { prefs.only = this.checked ? 1 : 0; savePrefs(); renderToday(); renderWeek(); });
    [].forEach.call(document.querySelectorAll("#range-chips .chip"), function (b) {
      b.addEventListener("click", function () { prefs.range = b.getAttribute("data-r"); savePrefs(); renderStats(); });
    });
    function addM() {
      var inp = $("add-member-in");
      if (addMember(inp.value)) { inp.value = ""; inp.focus(); }
    }
    $("add-member").addEventListener("click", addM);
    $("add-member-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addM(); }
    });
    $("me-sel").addEventListener("change", function () { prefs.me = this.value; savePrefs(); renderAll(); });
    $("new-task").addEventListener("click", function () { taskDialog(null); });
    // A new day while the app stays open: repaint.
    var shown = todayDn();
    setInterval(function () {
      if (todayDn() !== shown) { shown = todayDn(); renderAll(); }
    }, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && todayDn() !== shown) { shown = todayDn(); renderAll(); }
    });
    if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe($("wheel-box"));
    else window.addEventListener("resize", resize);
  }

  function boot() {
    load();
    loadPrefs();
    registerSync();
    inheritPalette();
    watchPalette();
    cv = $("cv");
    g = cv.getContext("2d");
    if (!prefs.tab) prefs.tab = data.members.length && data.tasks.length ? "today" : "home";   // first open: stays put while you set up
    applyI18n();
    wire();
    wireKeyboard();
    renderAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawWheel(); });
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("chores");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { task } or { member }. Home tab + that chore's or member's
  // dialog. Unknown id → no-op; an open dialog → no-op (unsaved edits win).
  function openSearchTarget(t) {
    if (!t || document.querySelector("dialog[open]")) return;
    var tk = typeof t.task === "string" ? taskById(data, t.task) : null;
    var mb = !tk && typeof t.member === "string" ? memberById(data, t.member) : null;
    if (!tk && !mb) return;
    setTab("home");
    if (tk) taskDialog(tk.id); else memberDialog(mb.id);
  }
  window.__orosOpenAt = openSearchTarget;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
