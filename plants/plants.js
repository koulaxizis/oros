// ============================================================
// orOS Plant Care — App logic (v1.0.0)
// Watering schedules with reminders.
//   - "Today": late tasks, today's, the next 7 days; one tap to
//     mark done (Undo), postpone 1–2 days, skip (e.g. rain)
//   - every plant: water every n days, optional winter interval,
//     fertilize / mist / repot; ~25 ready species
//   - history per plant, real average gap, 30-day strip
//   - weather hint for outdoor plants from the Weather app's
//     cache (no network); Calendar feed; daily reminder from the
//     shell engine (plantsCheckTick), which also uses core.js
// Data:
//   - synced slice "plants" (oros-plants-data): plants LWW, log
//     union, tombstones; merge = OrosPlantsCore.merge (R5, R26)
//   - device-local (R10): oros-plants-prefs (reminder hour,
//     hemisphere, tab, room filter)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Mutations: done, skip, postpone, add/edit/delete (Undo)
//   4. Today view
//   5. Plants view + plant details
//   6. Plant editor
//   7. Settings, export / import
//   8. Dialogs + toasts
//   9. Keyboard (Contract Β) + deep link
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosPlantsCore;
  var STORAGE_KEY = "oros-plants-data";
  var PREFS_KEY   = "oros-plants-prefs";
  var OPEN_KEY    = "oros-plants-open";
  var HORIZON     = 7;
  var HIST_SHOW   = 30;
  var EMOJIS = ["🪴", "🌿", "🌱", "🍃", "🌵", "🌸", "🌺", "🌻", "🌷", "💜", "🌳", "🌴", "🍅", "🍋", "🫒"];
  var KIND_COLOR = { water: "#4dabf7", fert: "#8bc34a", mist: "#2ec4b6", repot: "#c8a96e" };

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
      "tab.today": "Today", "tab.plants": "My plants", "btn.add": "Plant", "btn.addAria": "Add a plant",
      "btn.settings": "Settings",
      "grp.late": "Late", "grp.today": "Today", "grp.soon": "Next 7 days",
      "kind.water": "Water", "kind.fert": "Fertilize", "kind.mist": "Mist", "kind.repot": "Repot",
      "done": "Done", "done.aria": "{kind} {name}: done", "more.aria": "More for {name}",
      "allWater": "Water all ({n})",
      "due.today": "today", "due.tomorrow": "tomorrow", "due.in": "in {n} days",
      "due.late1": "1 day late", "due.late": "{n} days late",
      "room.all": "All", "room.none": "No room",
      "empty.first": "No plants yet. Add your first one and orOS will remind you when it is thirsty.",
      "empty.first.btn": "Add a plant",
      "empty.calm": "All good. Nothing is due in the next 7 days.",
      "empty.room": "Nothing due in this room this week.",
      "empty.search": "No plant matches.",
      "search": "Search plants…",
      "wx.rain": "Rain is expected today. Your outdoor plants may not need water.",
      "wx.rainBtn": "Skip outdoor watering",
      "wx.hot": "A hot day ahead. Check your outdoor plants earlier than usual.",
      "act.title": "{name}", "act.p1": "Postpone 1 day", "act.p2": "Postpone 2 days",
      "act.skip": "Skip this time", "act.open": "Open plant", "act.done": "Mark as done",
      "card.next": "{kind} {when}", "card.every": "every {n} days", "card.off": "No schedule",
      "card.out": "Outdoor", "card.in": "Indoor",
      "det.next": "Next", "det.every": "Every", "det.days": "{n} days", "det.months": "{n} months",
      "det.winter": "in winter {n} days", "det.avg": "You water every {n} days on average.",
      "det.hist": "History", "det.histEmpty": "Nothing logged yet.", "det.strip": "Last 30 days",
      "det.skipped": "skipped", "det.edit": "Edit", "det.delete": "Delete", "det.close": "Close",
      "det.undoEntry": "Remove this entry", "det.never": "—",
      "ed.addTitle": "New plant", "ed.editTitle": "Edit plant", "ed.species": "Species",
      "ed.custom": "Other / my own", "ed.name": "Name", "ed.icon": "Icon", "ed.room": "Room or spot",
      "ed.roomPh": "Living room, balcony…", "ed.place": "Where", "ed.in": "Indoor", "ed.out": "Outdoor",
      "ed.water": "Water every (days)", "ed.winter": "In winter every (days, 0 = same)",
      "ed.fert": "Fertilize every (days, 0 = off)", "ed.mist": "Mist every (days, 0 = off)",
      "ed.repot": "Repot every (months, 0 = off)", "ed.last": "Last watered",
      "ed.notes": "Notes", "ed.more": "More care", "ed.save": "Save", "ed.cancel": "Cancel",
      "ed.tip": "Tip: {tip}",
      "set.title": "Settings", "set.remind": "Daily reminder", "set.off": "Off",
      "set.remindHint": "Reminders appear while orOS is open (also with this app closed). With orOS closed they wait for the next time you open it.",
      "set.hemi": "Hemisphere (for the winter interval)", "set.north": "Northern (winter Nov–Feb)",
      "set.south": "Southern (winter May–Aug)", "set.data": "Your plants", "set.export": "Export",
      "set.import": "Import", "set.close": "Close",
      "toast.done": "{kind}: {name}", "toast.doneAll": "Watered {n} plants", "toast.undo": "Undo",
      "toast.skip": "Skipped: {name}", "toast.skipAll": "Skipped {n} outdoor plants",
      "toast.post": "{name}: moved to {when}", "toast.added": "{name} added", "toast.saved": "Saved",
      "toast.deleted": "{name} deleted", "toast.entry": "Entry removed",
      "toast.save": "Could not save: storage is full", "toast.needName": "Give the plant a name",
      "toast.needWater": "Watering interval: 1 to 60 days", "toast.max": "Up to {n} plants",
      "toast.exported": "Exported", "toast.imported": "Imported: {n} plants",
      "toast.badFile": "This is not a Plant Care file",
      "confirm.del": "Delete {name} and its history?", "confirm.yes": "Delete",
      "live.done": "{kind} done for {name}"
    },
    el: {
      "tab.today": "Σήμερα", "tab.plants": "Τα φυτά μου", "btn.add": "Φυτό", "btn.addAria": "Νέο φυτό",
      "btn.settings": "Ρυθμίσεις",
      "grp.late": "Καθυστερούν", "grp.today": "Σήμερα", "grp.soon": "Επόμενες 7 μέρες",
      "kind.water": "Πότισμα", "kind.fert": "Λίπανση", "kind.mist": "Ψέκασμα", "kind.repot": "Μεταφύτευση",
      "done": "Έγινε", "done.aria": "{kind} {name}: έγινε", "more.aria": "Περισσότερα για {name}",
      "allWater": "Πότισε όλα ({n})",
      "due.today": "σήμερα", "due.tomorrow": "αύριο", "due.in": "σε {n} μέρες",
      "due.late1": "1 μέρα πίσω", "due.late": "{n} μέρες πίσω",
      "room.all": "Όλα", "room.none": "Χωρίς δωμάτιο",
      "empty.first": "Δεν έχεις φυτά ακόμα. Πρόσθεσε το πρώτο και το orOS θα σου θυμίζει πότε διψάει.",
      "empty.first.btn": "Νέο φυτό",
      "empty.calm": "Όλα καλά. Τίποτα δεν χρειάζεται φροντίδα τις επόμενες 7 μέρες.",
      "empty.room": "Τίποτα σε αυτό το δωμάτιο αυτή την εβδομάδα.",
      "empty.search": "Κανένα φυτό δεν ταιριάζει.",
      "search": "Αναζήτηση φυτών…",
      "wx.rain": "Σήμερα αναμένεται βροχή. Τα εξωτερικά φυτά μάλλον δεν θέλουν πότισμα.",
      "wx.rainBtn": "Παράλειψη για τα εξωτερικά",
      "wx.hot": "Έρχεται ζέστη. Έλεγξε τα εξωτερικά φυτά νωρίτερα από το συνηθισμένο.",
      "act.title": "{name}", "act.p1": "Αναβολή 1 μέρα", "act.p2": "Αναβολή 2 μέρες",
      "act.skip": "Παράλειψη αυτή τη φορά", "act.open": "Άνοιγμα φυτού", "act.done": "Σημείωσε ότι έγινε",
      "card.next": "{kind} {when}", "card.every": "κάθε {n} μέρες", "card.off": "Χωρίς πρόγραμμα",
      "card.out": "Εξωτερικό", "card.in": "Εσωτερικό",
      "det.next": "Επόμενο", "det.every": "Κάθε", "det.days": "{n} μέρες", "det.months": "{n} μήνες",
      "det.winter": "τον χειμώνα {n} μέρες", "det.avg": "Ποτίζεις κατά μέσο όρο κάθε {n} μέρες.",
      "det.hist": "Ιστορικό", "det.histEmpty": "Τίποτα καταγεγραμμένο ακόμα.", "det.strip": "Τελευταίες 30 μέρες",
      "det.skipped": "παράλειψη", "det.edit": "Επεξεργασία", "det.delete": "Διαγραφή", "det.close": "Κλείσιμο",
      "det.undoEntry": "Αφαίρεση εγγραφής", "det.never": "—",
      "ed.addTitle": "Νέο φυτό", "ed.editTitle": "Επεξεργασία φυτού", "ed.species": "Είδος",
      "ed.custom": "Άλλο / δικό μου", "ed.name": "Όνομα", "ed.icon": "Εικονίδιο", "ed.room": "Δωμάτιο ή σημείο",
      "ed.roomPh": "Σαλόνι, μπαλκόνι…", "ed.place": "Πού", "ed.in": "Μέσα", "ed.out": "Έξω",
      "ed.water": "Πότισμα κάθε (μέρες)", "ed.winter": "Τον χειμώνα κάθε (μέρες, 0 = ίδιο)",
      "ed.fert": "Λίπανση κάθε (μέρες, 0 = όχι)", "ed.mist": "Ψέκασμα κάθε (μέρες, 0 = όχι)",
      "ed.repot": "Μεταφύτευση κάθε (μήνες, 0 = όχι)", "ed.last": "Τελευταίο πότισμα",
      "ed.notes": "Σημειώσεις", "ed.more": "Άλλη φροντίδα", "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο",
      "ed.tip": "Συμβουλή: {tip}",
      "set.title": "Ρυθμίσεις", "set.remind": "Καθημερινή υπενθύμιση", "set.off": "Κλειστή",
      "set.remindHint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Με κλειστό το orOS περιμένουν το επόμενο άνοιγμα.",
      "set.hemi": "Ημισφαίριο (για το χειμερινό διάστημα)", "set.north": "Βόρειο (χειμώνας Νοέ–Φεβ)",
      "set.south": "Νότιο (χειμώνας Μάι–Αύγ)", "set.data": "Τα φυτά σου", "set.export": "Εξαγωγή",
      "set.import": "Εισαγωγή", "set.close": "Κλείσιμο",
      "toast.done": "{kind}: {name}", "toast.doneAll": "Ποτίστηκαν {n} φυτά", "toast.undo": "Αναίρεση",
      "toast.skip": "Παράλειψη: {name}", "toast.skipAll": "Παράλειψη για {n} εξωτερικά φυτά",
      "toast.post": "{name}: μετακινήθηκε {when}", "toast.added": "Προστέθηκε: {name}", "toast.saved": "Αποθηκεύτηκε",
      "toast.deleted": "Διαγράφηκε: {name}", "toast.entry": "Η εγγραφή αφαιρέθηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.needName": "Δώσε ένα όνομα στο φυτό",
      "toast.needWater": "Πότισμα: από 1 έως 60 μέρες", "toast.max": "Έως {n} φυτά",
      "toast.exported": "Η εξαγωγή έγινε", "toast.imported": "Εισαγωγή: {n} φυτά",
      "toast.badFile": "Αυτό δεν είναι αρχείο Φροντίδας φυτών",
      "confirm.del": "Διαγραφή του «{name}» και του ιστορικού του;", "confirm.yes": "Διαγραφή",
      "live.done": "{kind} έγινε για {name}"
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

  var UI = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    more:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.7s-6 6.6-6 11.1a6 6 0 0 0 12 0C18 9.3 12 2.7 12 2.7z"/></svg>',
    fert:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11"/><path d="M12 11c0-4 3-7 8-7 0 5-3 7-8 7z"/><path d="M12 14c0-3-2.5-5-7-5 0 4 2.5 5 7 5z"/></svg>',
    mist:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h.01M8 5h.01M8 11h.01M4 14h.01M12 8h.01"/><rect x="14" y="6" width="6" height="15" rx="2"/><path d="M15 6V3h4"/></svg>',
    repot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 10h14l-2 11H7z"/><path d="M4 7h16v3H4z"/></svg>'
  };

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function todayYmd() { return C.ymdOf(new Date()); }
  function presetName(id) { var p = C.PRESETS[id]; return p ? (p[LANG] || p.en)[0] : ""; }
  function presetTip(id) { var p = C.PRESETS[id]; return p ? (p[LANG] || p.en)[1] : ""; }
  function kindName(k) { return t("kind." + k); }
  function plantIcon(p) { return p.em || (p.sp && C.PRESETS[p.sp] && C.PRESETS[p.sp].em) || "🪴"; }

  function whenText(due, today) {
    var diff = C.dayNum(due) - C.dayNum(today);
    if (diff === 0) return t("due.today");
    if (diff === 1) return t("due.tomorrow");
    if (diff === -1) return t("due.late1");
    if (diff < 0) return t("due.late", { n: -diff });
    if (diff < 7) return t("due.in", { n: diff });
    return fmtDay(due);
  }
  function fmtDay(ymd) {
    var d = new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    try { return d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" }); }
    catch (e) { return ymd; }
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("plants.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;

  function emptyData() { return { ver: C.DATA_VER, plants: [], log: [], tombs: {} }; }
  function canonical(d) { return C.merge(d, d); }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.plants)) {
          data = canonical(parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] plants: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function save() {
    data = canonical(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    var base = C.readPrefs(p);
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      remind: base.remind,
      hemi: base.hemi,
      tab: p.tab === "plants" ? "plants" : "today",
      room: typeof p.room === "string" ? p.room.slice(0, C.ROOM_LEN) : null
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function plantById(id) {
    for (var i = 0; i < data.plants.length; i++) if (data.plants[i].id === id) return data.plants[i];
    return null;
  }
  function rooms() {
    var seen = {}, out = [];
    data.plants.forEach(function (p) { if (p.room && !seen[p.room]) { seen[p.room] = true; out.push(p.room); } });
    out.sort(function (a, b) { return a.localeCompare(b, LOCALE); });
    return out;
  }
  function stamp(p) { p.m = Math.max(Date.now(), p.m + 1); }

  // ---------- 3. Mutations ----------
  // Done / skip: one log entry for today; a postponement of that
  // task is cleared (its cycle is over). Undo = a tombstone on the
  // entry (it may already have travelled) + the old postponement.
  function logTask(tasksToLog, skip) {
    var today = todayYmd(), now = Date.now(), undo = [];
    tasksToLog.forEach(function (tk) {
      var p = plantById(tk.plant.id);
      if (!p) return;
      var id = newId();
      data.log.push({ id: id, p: p.id, k: tk.kind, d: today, s: skip ? 1 : 0, m: now });
      var oldSn = p.sn[tk.kind] || null;
      if (oldSn) { delete p.sn[tk.kind]; stamp(p); }
      undo.push({ entry: id, plant: p.id, kind: tk.kind, sn: oldSn });
    });
    if (!undo.length) return;
    save();
    render();
    var first = tasksToLog[0];
    var msg;
    if (skip) msg = undo.length > 1 ? t("toast.skipAll", { n: undo.length }) : t("toast.skip", { name: first.plant.name });
    else msg = undo.length > 1 ? t("toast.doneAll", { n: undo.length })
                               : t("toast.done", { kind: kindName(first.kind), name: first.plant.name });
    if (!skip && undo.length === 1) live(t("live.done", { kind: kindName(first.kind), name: first.plant.name }));
    undoToast(msg, function () {
      var at = Date.now();
      undo.forEach(function (u) {
        data.tombs[u.entry] = at;
        var p = plantById(u.plant);
        if (p && u.sn) { p.sn[u.kind] = u.sn; stamp(p); }
      });
      save();
      render();
    });
  }

  function postpone(tk, days) {
    var p = plantById(tk.plant.id);
    if (!p) return;
    var today = todayYmd();
    var from = tk.due > today ? tk.due : today;
    var to = C.addDays(from, days);
    var old = p.sn[tk.kind] || null;
    p.sn[tk.kind] = to;
    stamp(p);
    save();
    render();
    undoToast(t("toast.post", { name: p.name, when: whenText(to, today) }), function () {
      var q = plantById(p.id);
      if (!q) return;
      if (old) q.sn[tk.kind] = old; else delete q.sn[tk.kind];
      stamp(q);
      save();
      render();
    });
  }

  function deletePlant(p) {
    var snapshot = JSON.parse(JSON.stringify(p));
    var entries = data.log.filter(function (x) { return x.p === p.id; }).map(function (x) { return Object.assign({}, x); });
    data.tombs[p.id] = Math.max(Date.now(), p.m);
    data.plants = data.plants.filter(function (x) { return x.id !== p.id; });
    save();
    render();
    undoToast(t("toast.deleted", { name: p.name }), function () {
      // a newer edit resurrects (R17): m above the tombstone, which
      // may already have travelled
      snapshot.m = Math.max(Date.now(), (data.tombs[p.id] || 0) + 1, snapshot.m + 1);
      data.plants.push(snapshot);
      // the entries come back under their own ids (no tombstone on them)
      entries.forEach(function (x) { if (!data.log.some(function (y) { return y.id === x.id; })) data.log.push(x); });
      save();
      render();
    });
  }

  function removeEntry(x) {
    data.tombs[x.id] = Math.max(Date.now(), x.m);
    save();
    render();
    undoToast(t("toast.entry"), function () {
      delete data.tombs[x.id];
      var back = Object.assign({}, x, { m: Date.now() });
      data.log = data.log.filter(function (y) { return y.id !== x.id; });
      data.log.push(back);
      save();
      render();
    });
  }

  // ---------- 4. Today view ----------
  function weatherHint() {
    try {
      return C.weather(JSON.parse(localStorage.getItem("oros-weatherapp-data")),
                       JSON.parse(localStorage.getItem("oros-weatherapp-cache")),
                       JSON.parse(localStorage.getItem("oros-weather")),
                       todayYmd(), Date.now());
    } catch (e) { return null; }
  }

  function roomChips(box, onPick) {
    var list = rooms();
    box.innerHTML = "";
    if (list.length < 2 && !(list.length === 1 && data.plants.some(function (p) { return !p.room; }))) {
      box.hidden = true;
      if (prefs.room !== null) { prefs.room = null; savePrefs(); }
      return;
    }
    if (prefs.room !== null && prefs.room !== "" && list.indexOf(prefs.room) < 0) { prefs.room = null; savePrefs(); }
    box.hidden = false;
    var opts = [{ v: null, label: t("room.all") }].concat(list.map(function (r) { return { v: r, label: r }; }));
    if (data.plants.some(function (p) { return !p.room; })) opts.push({ v: "", label: t("room.none") });
    opts.forEach(function (o) {
      var b = el("button", "chip" + (prefs.room === o.v ? " on" : ""), o.label);
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.room === o.v ? "true" : "false");
      b.addEventListener("click", function () { prefs.room = o.v; savePrefs(); onPick(); });
      box.appendChild(b);
    });
  }
  function inRoom(p) { return prefs.room === null || p.room === prefs.room; }

  function renderToday() {
    var list = $("today-list"), empty = $("today-empty"), banner = $("wx-banner");
    list.innerHTML = "";
    empty.innerHTML = "";
    banner.innerHTML = "";
    banner.hidden = true;
    roomChips($("rooms-today"), renderToday);
    if (!data.plants.length) {
      empty.hidden = false;
      empty.appendChild(el("div", "empty-ico", "🪴"));
      empty.appendChild(el("p", "", t("empty.first")));
      var b = el("button", "txt-btn primary", t("empty.first.btn"));
      b.type = "button";
      b.addEventListener("click", function () { editor(null); });
      empty.appendChild(b);
      return;
    }
    var today = todayYmd();
    var all = C.tasks(data, today, HORIZON, prefs.hemi).filter(function (tk) { return inRoom(tk.plant); });

    // Weather hint (outdoor plants only, today's row only)
    var hint = weatherHint();
    var outDue = all.filter(function (tk) { return tk.kind === "water" && tk.plant.out && tk.diff <= 0; });
    if (hint && hint.rain && outDue.length) {
      banner.hidden = false;
      banner.className = "banner rain";
      banner.appendChild(el("span", "", t("wx.rain")));
      var sb = el("button", "txt-btn", t("wx.rainBtn"));
      sb.type = "button";
      sb.addEventListener("click", function () { logTask(outDue, true); });
      banner.appendChild(sb);
    } else if (hint && hint.hot && all.some(function (tk) { return tk.kind === "water" && tk.plant.out; })) {
      banner.hidden = false;
      banner.className = "banner hot";
      banner.appendChild(el("span", "", t("wx.hot")));
    }

    if (!all.length) {
      empty.hidden = false;
      empty.appendChild(el("div", "empty-ico", "🌿"));
      empty.appendChild(el("p", "", prefs.room === null ? t("empty.calm") : t("empty.room")));
      return;
    }
    empty.hidden = true;
    var groups = [
      { key: "late", items: all.filter(function (tk) { return tk.diff < 0; }) },
      { key: "today", items: all.filter(function (tk) { return tk.diff === 0; }) },
      { key: "soon", items: all.filter(function (tk) { return tk.diff > 0; }) }
    ];
    var dueWater = all.filter(function (tk) { return tk.kind === "water" && tk.diff <= 0; });
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var sec = el("section", "grp grp-" + g.key);
      var head = el("div", "grp-head");
      head.appendChild(el("h2", "", t("grp." + g.key)));
      head.appendChild(el("span", "count", String(g.items.length)));
      if (g.key === "today" || (g.key === "late" && !groups[1].items.length)) {
        if (dueWater.length >= 2) {
          var aw = el("button", "link-btn", t("allWater", { n: dueWater.length }));
          aw.type = "button";
          aw.addEventListener("click", function () { logTask(dueWater, false); });
          head.appendChild(el("span", "spacer"));
          head.appendChild(aw);
        }
      }
      sec.appendChild(head);
      var ul = el("ul", "tasks");
      g.items.forEach(function (tk) { ul.appendChild(taskRow(tk, today)); });
      sec.appendChild(ul);
      list.appendChild(sec);
    });
  }

  function taskRow(tk, today) {
    var p = tk.plant;
    var li = el("li", "task" + (tk.diff < 0 ? " late" : ""));
    li.style.setProperty("--kind", KIND_COLOR[tk.kind]);
    var ico = el("button", "p-ico", plantIcon(p));
    ico.type = "button";
    ico.setAttribute("aria-label", t("act.open") + ": " + p.name);
    ico.addEventListener("click", function () { details(p.id); });
    li.appendChild(ico);
    var body = el("div", "t-body");
    body.appendChild(el("div", "t-name", p.name));
    var sub = el("div", "t-sub");
    var kb = el("span", "kind");
    kb.innerHTML = UI[tk.kind];
    kb.appendChild(el("span", "", kindName(tk.kind)));
    sub.appendChild(kb);
    sub.appendChild(el("span", "when", whenText(tk.due, today)));
    if (p.room) sub.appendChild(el("span", "room", p.room));
    body.appendChild(sub);
    li.appendChild(body);
    var done = el("button", "done-btn");
    done.type = "button";
    done.innerHTML = UI.check;
    done.appendChild(el("span", "", t("done")));
    done.setAttribute("aria-label", t("done.aria", { kind: kindName(tk.kind), name: p.name }));
    done.addEventListener("click", function () { logTask([tk], false); });
    li.appendChild(done);
    var more = el("button", "icon-btn more");
    more.type = "button";
    more.innerHTML = UI.more;
    more.setAttribute("aria-label", t("more.aria", { name: p.name }));
    more.addEventListener("click", function () { actions(tk); });
    li.appendChild(more);
    return li;
  }

  function actions(tk) {
    var dlg = makeDialog("pc-act");
    dlg.classList.add("sheet");
    dlg.appendChild(el("div", "dlg-title", kindName(tk.kind) + " · " + tk.plant.name));
    var box = el("div", "sheet-list");
    [
      { label: t("act.done"), fn: function () { logTask([tk], false); } },
      { label: t("act.p1"), fn: function () { postpone(tk, 1); } },
      { label: t("act.p2"), fn: function () { postpone(tk, 2); } },
      { label: t("act.skip"), fn: function () { logTask([tk], true); } },
      { label: t("act.open"), fn: function () { details(tk.plant.id); }, later: true }
    ].forEach(function (a) {
      box.appendChild(button(a.label, "sheet-btn", function () {
        dlg.close();
        if (a.later) setTimeout(a.fn, 0); else a.fn();
      }));
    });
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 5. Plants view + details ----------
  var searchQ = "";
  function renderPlants() {
    var grid = $("plant-grid"), empty = $("plants-empty");
    grid.innerHTML = "";
    empty.innerHTML = "";
    roomChips($("rooms-plants"), renderPlants);
    $("search").parentNode.hidden = data.plants.length < 6;
    if (!data.plants.length) {
      empty.hidden = false;
      empty.appendChild(el("div", "empty-ico", "🪴"));
      empty.appendChild(el("p", "", t("empty.first")));
      var b = el("button", "txt-btn primary", t("empty.first.btn"));
      b.type = "button";
      b.addEventListener("click", function () { editor(null); });
      empty.appendChild(b);
      return;
    }
    var q = searchQ.trim().toLocaleLowerCase(LOCALE);
    var list = data.plants.filter(function (p) {
      if (!inRoom(p)) return false;
      if (!q) return true;
      return (p.name + " " + p.room + " " + presetName(p.sp)).toLocaleLowerCase(LOCALE).indexOf(q) >= 0;
    }).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, LOCALE) || cmpStr(a.id, b.id);
    });
    if (!list.length) { empty.hidden = false; empty.appendChild(el("p", "", t("empty.search"))); return; }
    empty.hidden = true;
    var last = C.lastByKind(data), today = todayYmd();
    list.forEach(function (p) {
      var card = el("button", "card");
      card.type = "button";
      card.appendChild(el("span", "p-ico", plantIcon(p)));
      var body = el("span", "c-body");
      body.appendChild(el("span", "c-name", p.name));
      body.appendChild(el("span", "c-sub", [p.room, p.out ? t("card.out") : t("card.in")].filter(Boolean).join(" · ")));
      var due = C.nextDue(p, "water", last[p.id] && last[p.id].water, prefs.hemi);
      var nx = el("span", "c-next" + (due && due < today ? " late" : ""));
      nx.innerHTML = UI.water;
      nx.appendChild(el("span", "", due ? whenText(due, today) + " · " +
        t("card.every", { n: C.interval(p, "water", today, prefs.hemi) }) : t("card.off")));
      body.appendChild(nx);
      card.appendChild(body);
      card.addEventListener("click", function () { details(p.id); });
      grid.appendChild(card);
    });
  }

  var openDetail = null;   // plant id shown in the details dialog
  function details(id) {
    var p = plantById(id);
    if (!p) return;
    openDetail = id;
    var dlg = makeDialog("pc-det");
    dlg.classList.add("wide");
    dlg.addEventListener("close", function () { if (openDetail === id) openDetail = null; });
    fillDetails(dlg, p);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function fillDetails(dlg, p) {
    dlg.innerHTML = "";
    var today = todayYmd(), last = C.lastByKind(data)[p.id] || {};
    var head = el("div", "det-head");
    head.appendChild(el("span", "p-ico big", plantIcon(p)));
    var hb = el("div", "det-hb");
    hb.appendChild(el("div", "det-name", p.name));
    hb.appendChild(el("div", "c-sub", [presetName(p.sp), p.room, p.out ? t("card.out") : t("card.in")].filter(Boolean).join(" · ")));
    head.appendChild(hb);
    var x = el("button", "icon-btn");
    x.type = "button";
    x.innerHTML = UI.x;
    x.setAttribute("aria-label", t("det.close"));
    x.addEventListener("click", function () { dlg.close(); });
    head.appendChild(x);
    dlg.appendChild(head);
    if (p.sp && presetTip(p.sp)) dlg.appendChild(el("p", "tip", t("ed.tip", { tip: presetTip(p.sp) })));

    // Schedule table
    var tbl = el("div", "sched");
    C.KINDS.forEach(function (k) {
      var iv = C.interval(p, k, today, prefs.hemi);
      if (!iv) return;
      var due = C.nextDue(p, k, last[k], prefs.hemi);
      var row = el("div", "s-row");
      row.style.setProperty("--kind", KIND_COLOR[k]);
      var kb = el("span", "kind");
      kb.innerHTML = UI[k];
      kb.appendChild(el("span", "", kindName(k)));
      row.appendChild(kb);
      var every = k === "repot" ? t("det.months", { n: Math.round(p.r / 30) }) : t("det.days", { n: iv });
      if (k === "water" && p.ww) every = t("det.days", { n: p.w }) + ", " + t("det.winter", { n: p.ww });
      row.appendChild(el("span", "s-every", t("det.every") + " " + every));
      row.appendChild(el("span", "s-next" + (due < today ? " late" : ""), due ? whenText(due, today) : t("det.never")));
      tbl.appendChild(row);
    });
    dlg.appendChild(tbl);

    var avg = C.avgGap(data, p.id);
    if (avg !== null) dlg.appendChild(el("p", "dlg-sub", t("det.avg", { n: avg.toLocaleString(LOCALE) })));

    // 30-day strip: water (done / skipped) per day
    var entries = data.log.filter(function (e) { return e.p === p.id; });
    var byDay = {};
    entries.forEach(function (e) {
      var o = byDay[e.d] || (byDay[e.d] = {});
      o[e.k + (e.s ? "-s" : "")] = true;
    });
    dlg.appendChild(el("div", "dlg-lbl", t("det.strip")));
    var strip = el("div", "strip");
    for (var i = 29; i >= 0; i--) {
      var d = C.addDays(today, -i), o = byDay[d] || {};
      var cell = el("span", "cell" + (o.water ? " w" : (o["water-s"] ? " ws" : "")) +
        (o.fert || o.mist || o.repot ? " o" : "") + (i === 0 ? " today" : ""));
      cell.title = fmtDay(d);
      strip.appendChild(cell);
    }
    dlg.appendChild(strip);

    // History
    dlg.appendChild(el("div", "dlg-lbl", t("det.hist")));
    var hist = entries.slice().sort(function (a, b) { return cmpStr(b.d, a.d) || cmpStr(b.id, a.id); }).slice(0, HIST_SHOW);
    if (!hist.length) dlg.appendChild(el("p", "dlg-sub", t("det.histEmpty")));
    else {
      var ul = el("ul", "hist");
      hist.forEach(function (e) {
        var li = el("li");
        li.style.setProperty("--kind", KIND_COLOR[e.k]);
        var kb = el("span", "kind");
        kb.innerHTML = UI[e.k];
        kb.appendChild(el("span", "", kindName(e.k) + (e.s ? " (" + t("det.skipped") + ")" : "")));
        li.appendChild(kb);
        li.appendChild(el("span", "h-d", fmtDay(e.d)));
        var rm = el("button", "icon-btn mini");
        rm.type = "button";
        rm.innerHTML = UI.x;
        rm.setAttribute("aria-label", t("det.undoEntry"));
        rm.addEventListener("click", function () { removeEntry(e); });
        li.appendChild(rm);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    if (p.notes) {
      dlg.appendChild(el("div", "dlg-lbl", t("ed.notes")));
      dlg.appendChild(el("p", "notes", p.notes));
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("det.delete"), "danger", function () { confirmDelete(p, dlg); }));
    acts.appendChild(button(t("det.edit"), "primary", function () {
      dlg.close();
      setTimeout(function () { editor(p.id); }, 0);
    }));
    dlg.appendChild(acts);
  }

  function refreshDetails() {
    if (!openDetail) return;
    var dlg = $("pc-det"), p = plantById(openDetail);
    if (!dlg || !dlg.open) return;
    if (!p) { dlg.close(); return; }
    fillDetails(dlg, p);
  }

  function confirmDelete(p, parent) {
    var dlg = makeDialog("pc-confirm");
    dlg.appendChild(el("p", "confirm-msg", t("confirm.del", { name: p.name })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("confirm.yes"), "danger-fill", function () {
      dlg.close();
      if (parent && parent.open) parent.close();
      deletePlant(p);
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 6. Plant editor ----------
  function field(label, input, id) {
    var wrap = el("div", "fld");
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    input.id = id;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function numInput(v, min, max) {
    var i = el("input");
    i.type = "number";
    i.inputMode = "numeric";
    i.min = String(min);
    i.max = String(max);
    i.step = "1";
    i.value = String(v);
    return i;
  }
  function readNum(inp, min, max) {
    var v = Number(inp.value);
    if (!isFinite(v) || Math.floor(v) !== v || v < min || v > max) return null;
    return v;
  }

  function editor(id) {
    var p = id ? plantById(id) : null;
    if (!p && data.plants.length >= C.MAX_PLANTS) { showToast(t("toast.max", { n: C.MAX_PLANTS })); return; }
    var dlg = makeDialog("pc-edit");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t(p ? "ed.editTitle" : "ed.addTitle")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;

    var sp = el("select");
    var o0 = el("option", "", t("ed.custom"));
    o0.value = "";
    sp.appendChild(o0);
    C.PRESET_IDS.slice().sort(function (a, b) { return presetName(a).localeCompare(presetName(b), LOCALE); })
      .forEach(function (k) {
        var o = el("option", "", (C.PRESETS[k].em ? C.PRESETS[k].em + " " : "") + presetName(k));
        o.value = k;
        sp.appendChild(o);
      });
    sp.value = p ? p.sp : "";
    form.appendChild(field(t("ed.species"), sp, "pc-sp"));
    var tip = el("p", "tip");
    form.appendChild(tip);

    var name = el("input");
    name.maxLength = C.NAME_LEN;
    name.autocomplete = "off";
    name.value = p ? p.name : "";
    form.appendChild(field(t("ed.name"), name, "pc-name"));

    // icon chips (radio group)
    var curEm = p ? plantIcon(p) : "🪴";
    var emWrap = el("div", "fld");
    emWrap.appendChild(el("div", "dlg-lbl", t("ed.icon")));
    var ems = el("div", "emojis");
    ems.setAttribute("role", "radiogroup");
    ems.setAttribute("aria-label", t("ed.icon"));
    function paintEm() {
      [].forEach.call(ems.children, function (b) {
        var on = b.textContent === curEm;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    }
    EMOJIS.forEach(function (e) {
      var b = el("button", "em", e);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { curEm = e; paintEm(); });
      ems.appendChild(b);
    });
    if (EMOJIS.indexOf(curEm) < 0) curEm = "🪴";
    emWrap.appendChild(ems);
    form.appendChild(emWrap);

    var room = el("input");
    room.maxLength = C.ROOM_LEN;
    room.autocomplete = "off";
    room.placeholder = t("ed.roomPh");
    room.value = p ? p.room : (prefs.room || "");
    room.setAttribute("list", "pc-rooms");
    var dl = el("datalist");
    dl.id = "pc-rooms";
    rooms().forEach(function (r) { var o = el("option"); o.value = r; dl.appendChild(o); });
    var roomFld = field(t("ed.room"), room, "pc-room");
    roomFld.appendChild(dl);
    form.appendChild(roomFld);

    var out = p ? p.out : 0;
    var place = el("div", "fld");
    place.appendChild(el("div", "dlg-lbl", t("ed.place")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("ed.place"));
    var bIn = el("button", "", t("ed.in")), bOut = el("button", "", t("ed.out"));
    [bIn, bOut].forEach(function (b, i) {
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { out = i; paintSeg(); });
      seg.appendChild(b);
    });
    function paintSeg() {
      bIn.classList.toggle("on", !out); bIn.setAttribute("aria-checked", !out ? "true" : "false");
      bOut.classList.toggle("on", !!out); bOut.setAttribute("aria-checked", out ? "true" : "false");
    }
    place.appendChild(seg);
    form.appendChild(place);

    var row = el("div", "fld-row");
    var w = numInput(p ? p.w : 7, 1, C.KIND_MAX.w);
    var ww = numInput(p ? p.ww : 0, 0, C.KIND_MAX.ww);
    row.appendChild(field(t("ed.water"), w, "pc-w"));
    row.appendChild(field(t("ed.winter"), ww, "pc-ww"));
    form.appendChild(row);

    var last = null;
    if (!p) {
      last = el("input");
      last.type = "date";
      last.max = todayYmd();
      last.value = todayYmd();
      form.appendChild(field(t("ed.last"), last, "pc-last"));
    }

    var det = el("details", "more-care");
    det.appendChild(el("summary", "", t("ed.more")));
    var row2 = el("div", "fld-row three");
    var f = numInput(p ? p.f : 0, 0, C.KIND_MAX.f);
    var mi = numInput(p ? p.mi : 0, 0, C.KIND_MAX.mi);
    var r = numInput(p ? Math.round(p.r / 30) : 0, 0, 36);
    row2.appendChild(field(t("ed.fert"), f, "pc-f"));
    row2.appendChild(field(t("ed.mist"), mi, "pc-mi"));
    row2.appendChild(field(t("ed.repot"), r, "pc-r"));
    det.appendChild(row2);
    if (p && (p.f || p.mi || p.r)) det.open = true;
    form.appendChild(det);

    var notes = el("textarea");
    notes.maxLength = C.NOTES_LEN;
    notes.rows = 3;
    notes.value = p ? p.notes : "";
    form.appendChild(field(t("ed.notes"), notes, "pc-notes"));

    // Species → suggested values (only fields the user has not typed in)
    var lastPresetName = p && p.sp ? presetName(p.sp) : "";
    function paintTip() { tip.textContent = sp.value ? t("ed.tip", { tip: presetTip(sp.value) }) : ""; tip.hidden = !sp.value; }
    sp.addEventListener("change", function () {
      var k = sp.value, pr = C.PRESETS[k];
      paintTip();
      if (!pr) return;
      if (!name.value.trim() || name.value.trim() === lastPresetName) name.value = presetName(k);
      lastPresetName = presetName(k);
      curEm = pr.em; paintEm();
      out = pr.out; paintSeg();
      w.value = String(pr.w); ww.value = String(pr.ww);
      f.value = String(pr.f); mi.value = String(pr.mi);
      if (pr.f || pr.mi) det.open = true;
    });
    paintTip();
    paintEm();
    paintSeg();

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = C.cleanText(name.value, C.NAME_LEN, false);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var vw = readNum(w, 1, C.KIND_MAX.w);
      if (vw === null) { showToast(t("toast.needWater")); w.focus(); return; }
      var vals = {
        name: nm, sp: sp.value, room: C.cleanText(room.value, C.ROOM_LEN, false), out: out ? 1 : 0,
        em: curEm, w: vw,
        ww: readNum(ww, 0, C.KIND_MAX.ww) || 0,
        f: readNum(f, 0, C.KIND_MAX.f) || 0,
        mi: readNum(mi, 0, C.KIND_MAX.mi) || 0,
        r: (readNum(r, 0, 36) || 0) * 30,
        notes: C.cleanText(notes.value, C.NOTES_LEN, true)
      };
      if (p) {
        var cur = plantById(p.id);
        if (!cur) { dlg.close(); return; }
        var changed = Object.keys(vals).some(function (k) { return cur[k] !== vals[k]; });
        if (changed) {                       // R27: no stamp without a real change
          Object.keys(vals).forEach(function (k) { cur[k] = vals[k]; });
          stamp(cur);
          save();
          showToast(t("toast.saved"));
        }
      } else {
        var st = last && C.isYmd(last.value) && last.value <= todayYmd() ? last.value : todayYmd();
        var np = Object.assign({ id: newId(), m: Date.now(), st: st, sn: {} }, vals);
        data.plants.push(np);
        save();
        showToast(t("toast.added", { name: nm }));
      }
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!p) sp.focus(); else name.focus();
  }

  // ---------- 7. Settings, export / import ----------
  function settings() {
    var dlg = makeDialog("pc-set");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    var rem = el("select");
    var off = el("option", "", t("set.off"));
    off.value = "-1";
    rem.appendChild(off);
    for (var h = 5; h <= 22; h++) {
      var o = el("option", "", (h < 10 ? "0" : "") + h + ":00");
      o.value = String(h);
      rem.appendChild(o);
    }
    rem.value = String(prefs.remind);
    if (rem.value !== String(prefs.remind)) {           // an hour outside the list
      var ox = el("option", "", (prefs.remind < 10 ? "0" : "") + prefs.remind + ":00");
      ox.value = String(prefs.remind);
      rem.appendChild(ox);
      rem.value = String(prefs.remind);
    }
    rem.addEventListener("change", function () { prefs.remind = Number(rem.value); savePrefsNow(); });
    dlg.appendChild(field(t("set.remind"), rem, "pc-rem"));
    dlg.appendChild(el("p", "dlg-sub", t("set.remindHint")));
    var hemi = el("select");
    [["n", t("set.north")], ["s", t("set.south")]].forEach(function (x) {
      var o = el("option", "", x[1]);
      o.value = x[0];
      hemi.appendChild(o);
    });
    hemi.value = prefs.hemi;
    hemi.addEventListener("change", function () { prefs.hemi = hemi.value === "s" ? "s" : "n"; savePrefsNow(); render(); });
    dlg.appendChild(field(t("set.hemi"), hemi, "pc-hemi"));
    dlg.appendChild(el("div", "dlg-lbl", t("set.data")));
    var io = el("div", "dlg-actions tight");
    io.appendChild(button(t("set.export"), "", exportData));
    io.appendChild(button(t("set.import"), "", importData));
    dlg.appendChild(io);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function exportData() {
    var payload = { app: "oros-plants", ver: C.DATA_VER, exported: new Date().toISOString(), data: canonical(data) };
    var text = JSON.stringify(payload, null, 2);
    var filename = "orOS-plants-" + todayYmd() + ".json";
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ text: text, filename: filename, mime: "application/json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    showToast(t("toast.exported"));
  }

  // A restore is a merge, never an overwrite (App-level import rule).
  function importData() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
      return file.text().then(function (txt) {
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) {}
        var incoming = parsed && parsed.app === "oros-plants" ? parsed.data : parsed;
        if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.plants)) { showToast(t("toast.badFile")); return; }
        var clean = C.merge(incoming, null);
        data = C.merge(data, clean);
        save();
        render();
        showToast(t("toast.imported", { n: clean.plants.length }));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }

  // ---------- 8. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pc-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "plants", title: String(text) })) return;
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
      }, { once: true });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); box.innerHTML = ""; }, onUndo ? 8000 : 4000);
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

  // ---------- 9. Keyboard (Contract Β) + deep link ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // "today" → the Today tab; a plant id → its details. Called live by
  // the shell (__orosOpenPlants) or from the staged key at boot.
  window.__orosPlantsOpen = function (target) {
    if (typeof target !== "string" || !target) return;
    if (target === "today") { setTab("today"); return; }
    if (C.ID_RE.test(target) && plantById(target)) {
      setTab("plants");
      details(target);
    }
  };
  function takeStaged() {
    var v = null;
    try {
      v = sessionStorage.getItem(OPEN_KEY);
      if (v) sessionStorage.removeItem(OPEN_KEY);
    } catch (e) {}
    if (v) window.__orosPlantsOpen(v);
  }

  // ---------- 10. Sync slice + palette ----------
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
  function mergeFn(a, b) { return C.merge(a, b); }

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
    api.registerSlice("plants", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }

  function sliceGet() { return canonical(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.plants)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = canonical(incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    render();
  }

  // ---------- 11. Wiring & boot ----------
  function setTab(tab) {
    prefs.tab = tab === "plants" ? "plants" : "today";
    savePrefs();
    render();
  }

  var renderedDay = null;
  function render() {
    renderedDay = todayYmd();
    var tab = prefs.tab;
    ["today", "plants"].forEach(function (v) {
      var on = v === tab;
      $("view-" + v).hidden = !on;
      var b = $("tab-" + v);
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    if (tab === "today") renderToday(); else renderPlants();
    refreshDetails();
  }

  function applyI18n() {
    $("tab-today").textContent = t("tab.today");
    $("tab-plants").textContent = t("tab.plants");
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    var ab = $("add-btn");
    ab.innerHTML = UI.plus + "<span></span>";
    ab.lastChild.textContent = t("btn.add");
    ab.setAttribute("aria-label", t("btn.addAria"));
    ab.title = t("btn.addAria");
    $("search").placeholder = t("search");
    $("search").setAttribute("aria-label", t("search"));
    document.title = (LANG === "el" ? "Φροντίδα φυτών" : "Plant Care") + " · orOS";
  }

  function wire() {
    $("tab-today").addEventListener("click", function () { setTab("today"); });
    $("tab-plants").addEventListener("click", function () { setTab("plants"); });
    document.querySelector(".tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setTab(prefs.tab === "today" ? "plants" : "today");
      $("tab-" + prefs.tab).focus();
    });
    $("add-btn").addEventListener("click", function () { editor(null); });
    $("settings-btn").addEventListener("click", settings);
    $("search").addEventListener("input", function () { searchQ = this.value; renderPlants(); });
    // A new day (app left open overnight, or back from the background)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
      else if (renderedDay !== todayYmd()) render();
    });
    setInterval(function () {
      if (document.visibilityState !== "hidden" && renderedDay !== todayYmd()) render();
    }, 60000);
    window.addEventListener("pagehide", savePrefsNow);
    wireKeyboard();
  }

  function boot() {
    if (!C) { document.body.textContent = "Plant Care: core.js missing"; return; }
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeStaged();
  }

  boot();
})();
