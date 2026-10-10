// ============================================================
// orOS Baby — App logic (v1.1.0)
// A baby log for one or more children, built for one hand and the
// middle of the night:
//   - Today: running timers (breast feed per side, sleep), "how long
//     ago" cards, quick buttons, today's totals and log
//   - History: any day's log and totals, last 7 days bars, a
//     24-hour pattern strip per day
//   - Growth: weight, length, head; one chart each (own values only)
//   - Milestones (seeded + own), vaccines, doctor visits
//   - CSV (log, growth), JSON backup / restore (a merge), a text
//     summary for the paediatrician
// A timer is an event without an end, so a timer started on one
// device can be stopped on another (synced like any edit).
// The model (normalize, merge, timers, totals, ages, export) lives
// in core.js.
// Data:
//   - synced slice "baby" (oros-baby-data), see core.js
//   - device-local (R10): oros-baby-view { kid, tab, night, wk }
// Sections:
//   1. i18n + helpers
//   2. Storage + view
//   3. Edits: events, timers, kids, growth, marks, prefs
//   4. Render: toolbar, nav, today
//   5. Render: history
//   6. Render: growth
//   7. Render: milestones + health
//   8. Dialogs: shared helpers
//   9. Dialogs: events
//  10. Dialogs: kid, growth, marks
//  11. Dialogs: settings, export, summary
//  12. Toasts
//  13. Keyboard (Contract Β)
//  14. Sync slice + palette (night view)
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.orosBabyCore;
  var STORAGE_KEY = C.STORAGE_KEY;
  var VIEW_KEY = "oros-baby-view";
  var TABS = ["today", "hist", "growth", "marks"];
  var KID_COLORS = ["#e98aa8", "#6fb7e8", "#f2b45a", "#7fcf9a", "#b49af0", "#ef8a6a"];

  // ---------- 1. i18n + helpers ----------
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
      "app": "Baby", "settings": "Settings", "night.on": "Night view on", "night.off": "Night view off",
      "kid.pick": "Children", "kid.none": "Add your baby",
      "wel.title": "Baby", "wel.text": "Feeds, sleep, nappies, growth and milestones, on all your devices.", "wel.add": "Add your baby",
      "tab.today": "Today", "tab.hist": "History", "tab.growth": "Growth", "tab.marks": "Milestones",
      "t.feed": "Breastfeed", "t.bottle": "Bottle", "t.solid": "Solids", "t.sleep": "Sleep", "t.diaper": "Nappy",
      "t.pump": "Pump", "t.med": "Medicine", "t.temp": "Temperature", "t.bath": "Bath", "t.tummy": "Tummy time",
      "t.note": "Note", "t.more": "More",
      "q.sleepStop": "Wake up", "q.feedOn": "Feeding…",
      "side.l": "Left", "side.r": "Right", "side.b": "Both", "side.L": "L", "side.R": "R",
      "sub.bm": "Breast milk", "sub.fm": "Formula", "sub.y": "Liked it", "sub.n": "Refused", "sub.a": "Reaction",
      "sub.w": "Wet", "sub.d": "Dirty", "sub.wd": "Wet + dirty",
      "tm.feeding": "Breastfeeding", "tm.sleeping": "Sleeping", "tm.since": "since {t}",
      "tm.pause": "Pause", "tm.resume": "Resume", "tm.done": "Done", "tm.wake": "Woke up", "tm.paused": "Paused",
      "tm.two": "Two timers of the same kind are running (started on two devices). Stop the one you don't need.",
      "since.feed": "Last feed", "since.diaper": "Last nappy", "since.awake": "Awake", "since.asleep": "Asleep",
      "since.none": "–", "ago": "{x} ago", "ago.now": "just now", "next": "next: {s}",
      "sec.today": "Today", "sec.log": "Log", "sec.day": "Entries", "sec.week": "Last 7 days", "sec.pattern": "24-hour pattern",
      "sec.measures": "Measurements", "sec.ms": "Milestones", "sec.vac": "Vaccines", "sec.doc": "Doctor visits",
      "log.empty": "Nothing yet today. Use the buttons above.", "log.none": "Nothing logged on this day.",
      "log.count": "{n} entries", "log.count1": "1 entry",
      "st.feeds": "Feeds", "st.breast": "Breast", "st.bottle": "Bottle", "st.sleep": "Sleep", "st.night": "night {x}",
      "st.wet": "Wet", "st.dirty": "Dirty", "st.pump": "Pumped", "st.naps": "{n} sleeps", "st.naps1": "1 sleep",
      "wk.sleep": "Sleep", "wk.feeds": "Feeds", "wk.nappies": "Nappies",
      "pat.sleep": "Sleep", "pat.feed": "Feed",
      "today": "Today", "yesterday": "Yesterday", "prev": "Previous day", "nextDay": "Next day",
      "gr.add": "Add measurement", "gr.empty": "No measurements yet.",
      "gr.note": "Your own measurements only, not compared with growth standards. Not medical advice: ask your paediatrician.",
      "gr.w": "Weight", "gr.l": "Length", "gr.h": "Head", "gr.months": "months",
      "mk.add": "Add", "mk.addMs": "Add", "mk.emptyVac": "No vaccines recorded.", "mk.emptyDoc": "No visits recorded.",
      "mk.tick": "Mark “{x}”",
      "dlg.cancel": "Cancel", "dlg.save": "Save", "dlg.add": "Add", "dlg.del": "Delete", "dlg.close": "Close",
      "dlg.start": "Start", "dlg.end": "End", "dlg.time": "Time", "dlg.endNote": "Leave the end empty while it is still going.",
      "dlg.ml": "Amount (ml)", "dlg.oz": "Amount (fl oz)", "dlg.kind": "Kind", "dlg.side": "Side", "dlg.note": "Note (optional)",
      "dlg.food": "Food", "dlg.reaction": "How it went", "dlg.medName": "Medicine and dose", "dlg.tempC": "Temperature (°C)",
      "dlg.tempF": "Temperature (°F)", "dlg.min": "Minutes", "dlg.text": "Note", "dlg.lmin": "Left (min)", "dlg.rmin": "Right (min)",
      "dlg.lastSide": "Last side",
      "dlg.feedStart": "Start a feed", "dlg.feedPast": "Log a past feed", "dlg.sleepPast": "Log a past sleep",
      "dlg.suggest": "suggested",
      "dlg.edit": "Edit: {x}", "dlg.new": "New: {x}",
      "dlg.kid": "Child", "dlg.kidNew": "Add a child", "dlg.name": "Name", "dlg.birth": "Date of birth",
      "dlg.sex": "Sex (optional)", "sex.": "Not set", "sex.f": "Girl", "sex.m": "Boy", "dlg.color": "Colour",
      "dlg.kidEdit": "Edit this child", "dlg.kidAdd": "Add another child", "dlg.kidDel": "Delete child and all entries",
      "dlg.gr": "Measurement", "dlg.date": "Date", "dlg.kg": "Weight (kg)", "dlg.lb": "Weight (lb)", "dlg.cm": "Length (cm)",
      "dlg.head": "Head (cm)", "dlg.grNote": "Fill in any of the three.",
      "dlg.ms": "Milestone", "dlg.vac": "Vaccine", "dlg.doc": "Doctor visit", "dlg.label": "What",
      "dlg.vacName": "Vaccine", "dlg.docName": "Reason / doctor", "dlg.unset": "Remove",
      "dlg.settings": "Settings", "set.units": "Units", "set.wu": "Weight", "set.tu": "Temperature", "set.vu": "Volume",
      "set.data": "Data", "set.csv": "Export log (CSV)", "set.gcsv": "Export growth (CSV)", "set.backup": "Back up (JSON)",
      "set.restore": "Restore from backup", "set.restoreNote": "A restore merges: it adds and updates, it never removes what is here.",
      "set.summary": "Summary for the paediatrician",
      "set.rem": "Reminders on this device", "set.remFeed": "Feed reminder", "set.remOff": "Off",
      "set.remAfter": "{x} after the last feed", "set.remMed": "Daily medicine or vitamin", "set.remMedName": "Name (optional)",
      "set.remMedHint": "Leave the time empty to turn it off.",
      "set.remNote": "Reminders come from orOS, on this device only, and only while orOS is open (the Baby app itself can be closed). Each parent turns them on on their own device.",
      "set.note": "orOS Baby keeps a log; it is not medical advice. If you are worried about your baby, call your paediatrician.",
      "sum.title": "Summary", "sum.copy": "Copy", "sum.share": "Share", "sum.save": "Save as text",
      "toast.added": "{x} logged", "toast.undo": "Undo", "toast.deleted": "Deleted", "toast.saved": "Saved",
      "toast.save": "Could not save: storage is full", "toast.exported": "Exported", "toast.copied": "Copied",
      "toast.sleepStart": "Sleep started", "toast.sleepStop": "Woke up after {x}", "toast.feedStop": "Feed logged: {x}",
      "toast.bad": "Check the values", "toast.badTime": "The end must be after the start",
      "toast.future": "That time is in the future", "toast.needName": "A name is needed",
      "toast.needBirth": "A date of birth is needed (not in the future)",
      "toast.kidDel": "{x} deleted", "toast.restored": "Restored: {n} changes", "toast.same": "Nothing new in that backup",
      "toast.badFile": "Not an orOS Baby backup", "toast.noKid": "Add a child first",
      "toast.running": "A feed is already running", "toast.nothing": "Nothing to export yet",
      "live.timer": "{x} running"
    },
    el: {
      "app": "Μωρό", "settings": "Ρυθμίσεις", "night.on": "Νυχτερινή όψη: ναι", "night.off": "Νυχτερινή όψη: όχι",
      "kid.pick": "Παιδιά", "kid.none": "Πρόσθεσε το μωρό σου",
      "wel.title": "Μωρό", "wel.text": "Ταΐσματα, ύπνος, πάνες, ανάπτυξη και ορόσημα, σε όλες σου τις συσκευές.", "wel.add": "Πρόσθεσε το μωρό σου",
      "tab.today": "Σήμερα", "tab.hist": "Ιστορικό", "tab.growth": "Ανάπτυξη", "tab.marks": "Ορόσημα",
      "t.feed": "Θηλασμός", "t.bottle": "Μπιμπερό", "t.solid": "Στερεά", "t.sleep": "Ύπνος", "t.diaper": "Πάνα",
      "t.pump": "Άντληση", "t.med": "Φάρμακο", "t.temp": "Θερμοκρασία", "t.bath": "Μπάνιο", "t.tummy": "Μπρούμυτα",
      "t.note": "Σημείωση", "t.more": "Άλλα",
      "q.sleepStop": "Ξύπνησε", "q.feedOn": "Θηλάζει…",
      "side.l": "Αριστερά", "side.r": "Δεξιά", "side.b": "Και τα δύο", "side.L": "Α", "side.R": "Δ",
      "sub.bm": "Μητρικό", "sub.fm": "Ξένο γάλα", "sub.y": "Του άρεσε", "sub.n": "Δεν το ήθελε", "sub.a": "Αντίδραση",
      "sub.w": "Βρεγμένη", "sub.d": "Λερωμένη", "sub.wd": "Και τα δύο",
      "tm.feeding": "Θηλασμός", "tm.sleeping": "Κοιμάται", "tm.since": "από τις {t}",
      "tm.pause": "Παύση", "tm.resume": "Συνέχεια", "tm.done": "Τέλος", "tm.wake": "Ξύπνησε", "tm.paused": "Σε παύση",
      "tm.two": "Τρέχουν δύο ίδια χρονόμετρα (ξεκίνησαν σε δύο συσκευές). Σταμάτησε αυτό που δεν χρειάζεσαι.",
      "since.feed": "Τάισμα", "since.diaper": "Πάνα", "since.awake": "Ξύπνιο", "since.asleep": "Κοιμάται",
      "since.none": "–", "ago": "πριν {x}", "ago.now": "μόλις τώρα", "next": "επόμενη: {s}",
      "sec.today": "Σήμερα", "sec.log": "Καταγραφές", "sec.day": "Καταγραφές", "sec.week": "Τελευταίες 7 ημέρες", "sec.pattern": "Μοτίβο 24ώρου",
      "sec.measures": "Μετρήσεις", "sec.ms": "Ορόσημα", "sec.vac": "Εμβόλια", "sec.doc": "Επισκέψεις στον γιατρό",
      "log.empty": "Τίποτα ακόμα σήμερα. Χρησιμοποίησε τα κουμπιά από πάνω.", "log.none": "Καμία καταγραφή αυτή τη μέρα.",
      "log.count": "{n} καταγραφές", "log.count1": "1 καταγραφή",
      "st.feeds": "Ταΐσματα", "st.breast": "Θηλασμός", "st.bottle": "Μπιμπερό", "st.sleep": "Ύπνος", "st.night": "νύχτα {x}",
      "st.wet": "Βρεγμένες", "st.dirty": "Λερωμένες", "st.pump": "Άντληση", "st.naps": "{n} ύπνοι", "st.naps1": "1 ύπνος",
      "wk.sleep": "Ύπνος", "wk.feeds": "Ταΐσματα", "wk.nappies": "Πάνες",
      "pat.sleep": "Ύπνος", "pat.feed": "Τάισμα",
      "today": "Σήμερα", "yesterday": "Χθες", "prev": "Προηγούμενη μέρα", "nextDay": "Επόμενη μέρα",
      "gr.add": "Νέα μέτρηση", "gr.empty": "Καμία μέτρηση ακόμα.",
      "gr.note": "Μόνο οι δικές σου μετρήσεις, χωρίς σύγκριση με καμπύλες ανάπτυξης. Δεν είναι ιατρική συμβουλή: ρώτα τον παιδίατρό σου.",
      "gr.w": "Βάρος", "gr.l": "Μήκος", "gr.h": "Κεφάλι", "gr.months": "μήνες",
      "mk.add": "Προσθήκη", "mk.addMs": "Δικό σου", "mk.emptyVac": "Κανένα εμβόλιο ακόμα.", "mk.emptyDoc": "Καμία επίσκεψη ακόμα.",
      "mk.tick": "Σημείωσε «{x}»",
      "dlg.cancel": "Άκυρο", "dlg.save": "Αποθήκευση", "dlg.add": "Προσθήκη", "dlg.del": "Διαγραφή", "dlg.close": "Κλείσιμο",
      "dlg.start": "Έναρξη", "dlg.end": "Λήξη", "dlg.time": "Ώρα", "dlg.endNote": "Άφησε τη λήξη κενή όσο συνεχίζεται.",
      "dlg.ml": "Ποσότητα (ml)", "dlg.oz": "Ποσότητα (fl oz)", "dlg.kind": "Είδος", "dlg.side": "Πλευρά", "dlg.note": "Σημείωση (προαιρετικά)",
      "dlg.food": "Τροφή", "dlg.reaction": "Πώς πήγε", "dlg.medName": "Φάρμακο και δόση", "dlg.tempC": "Θερμοκρασία (°C)",
      "dlg.tempF": "Θερμοκρασία (°F)", "dlg.min": "Λεπτά", "dlg.text": "Σημείωση", "dlg.lmin": "Αριστερά (λεπτά)", "dlg.rmin": "Δεξιά (λεπτά)",
      "dlg.lastSide": "Τελευταία πλευρά",
      "dlg.feedStart": "Ξεκίνα θηλασμό", "dlg.feedPast": "Καταγραφή προηγούμενου θηλασμού", "dlg.sleepPast": "Καταγραφή προηγούμενου ύπνου",
      "dlg.suggest": "προτείνεται",
      "dlg.edit": "Διόρθωση: {x}", "dlg.new": "Νέο: {x}",
      "dlg.kid": "Παιδί", "dlg.kidNew": "Νέο παιδί", "dlg.name": "Όνομα", "dlg.birth": "Ημερομηνία γέννησης",
      "dlg.sex": "Φύλο (προαιρετικά)", "sex.": "Χωρίς", "sex.f": "Κορίτσι", "sex.m": "Αγόρι", "dlg.color": "Χρώμα",
      "dlg.kidEdit": "Επεξεργασία παιδιού", "dlg.kidAdd": "Πρόσθεσε κι άλλο παιδί", "dlg.kidDel": "Διαγραφή παιδιού και όλων των καταγραφών",
      "dlg.gr": "Μέτρηση", "dlg.date": "Ημερομηνία", "dlg.kg": "Βάρος (kg)", "dlg.lb": "Βάρος (lb)", "dlg.cm": "Μήκος (cm)",
      "dlg.head": "Περίμετρος κεφαλής (cm)", "dlg.grNote": "Συμπλήρωσε όποιο από τα τρία έχεις.",
      "dlg.ms": "Ορόσημο", "dlg.vac": "Εμβόλιο", "dlg.doc": "Επίσκεψη", "dlg.label": "Τι",
      "dlg.vacName": "Εμβόλιο", "dlg.docName": "Λόγος / γιατρός", "dlg.unset": "Αφαίρεση",
      "dlg.settings": "Ρυθμίσεις", "set.units": "Μονάδες", "set.wu": "Βάρος", "set.tu": "Θερμοκρασία", "set.vu": "Όγκος",
      "set.data": "Δεδομένα", "set.csv": "Εξαγωγή καταγραφών (CSV)", "set.gcsv": "Εξαγωγή ανάπτυξης (CSV)", "set.backup": "Αντίγραφο ασφαλείας (JSON)",
      "set.restore": "Επαναφορά από αντίγραφο", "set.restoreNote": "Η επαναφορά συγχωνεύει: προσθέτει και ενημερώνει, δεν σβήνει τίποτα από όσα υπάρχουν.",
      "set.summary": "Σύνοψη για τον παιδίατρο",
      "set.rem": "Υπενθυμίσεις σε αυτή τη συσκευή", "set.remFeed": "Υπενθύμιση ταΐσματος", "set.remOff": "Όχι",
      "set.remAfter": "{x} μετά το τελευταίο τάισμα", "set.remMed": "Καθημερινό φάρμακο ή βιταμίνη", "set.remMedName": "Όνομα (προαιρετικό)",
      "set.remMedHint": "Άφησε την ώρα κενή για να το κλείσεις.",
      "set.remNote": "Οι υπενθυμίσεις έρχονται από το orOS, μόνο σε αυτή τη συσκευή και μόνο όσο το orOS είναι ανοιχτό (η εφαρμογή Μωρό μπορεί να είναι κλειστή). Κάθε γονιός τις ανοίγει στη δική του συσκευή.",
      "set.note": "Το Μωρό κρατά ημερολόγιο· δεν είναι ιατρική συμβουλή. Αν ανησυχείς για το μωρό, πάρε τον παιδίατρό σου.",
      "sum.title": "Σύνοψη", "sum.copy": "Αντιγραφή", "sum.share": "Κοινοποίηση", "sum.save": "Αποθήκευση ως κείμενο",
      "toast.added": "Καταγράφηκε: {x}", "toast.undo": "Αναίρεση", "toast.deleted": "Διαγράφηκε", "toast.saved": "Αποθηκεύτηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.exported": "Έγινε εξαγωγή", "toast.copied": "Αντιγράφηκε",
      "toast.sleepStart": "Ο ύπνος ξεκίνησε", "toast.sleepStop": "Ξύπνησε μετά από {x}", "toast.feedStop": "Ο θηλασμός καταγράφηκε: {x}",
      "toast.bad": "Έλεγξε τις τιμές", "toast.badTime": "Η λήξη πρέπει να είναι μετά την έναρξη",
      "toast.future": "Αυτή η ώρα είναι στο μέλλον", "toast.needName": "Χρειάζεται όνομα",
      "toast.needBirth": "Χρειάζεται ημερομηνία γέννησης (όχι στο μέλλον)",
      "toast.kidDel": "Διαγράφηκε: {x}", "toast.restored": "Επαναφορά: {n} αλλαγές", "toast.same": "Τίποτα καινούργιο σε αυτό το αντίγραφο",
      "toast.badFile": "Δεν είναι αντίγραφο του Μωρό", "toast.noKid": "Πρόσθεσε πρώτα ένα παιδί",
      "toast.running": "Ήδη τρέχει θηλασμός", "toast.nothing": "Δεν υπάρχει τίποτα για εξαγωγή ακόμα",
      "live.timer": "Τρέχει: {x}"
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
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }
  function num(n, dec) { return C.fmtNum(n, LANG, dec); }
  function clock(ts) { return C.fmtClock(ts); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  var S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var UI = {
    left:  '<svg ' + S + '><polyline points="15 6 9 12 15 18"/></svg>',
    right: '<svg ' + S + '><polyline points="9 6 15 12 9 18"/></svg>',
    gear:  '<svg ' + S + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    moon:  '<svg ' + S + '><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    feed:  '<svg ' + S + '><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/></svg>',
    bottle: '<svg ' + S + '><path d="M10 2h4M9.5 5h5M10 5v2.5L8 10v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V10l-2-2.5V5"/><path d="M8 14h3M8 17h3"/></svg>',
    solid: '<svg ' + S + '><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21v-8c-2 0-3-2.5-3-5.5S15.5 3 17 3s2 2.5 2 5-1 5-2 5"/></svg>',
    sleep: '<svg ' + S + '><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/><path d="M15 4h4l-4 4h4"/></svg>',
    diaper: '<svg ' + S + '><path d="M3 6h18v3a9 9 0 0 1-18 0z"/><path d="M8 6v3M16 6v3"/></svg>',
    pump:  '<svg ' + S + '><path d="M6 4h12l-2 6H8z"/><path d="M9 10v4a3 3 0 0 0 6 0v-4"/><path d="M12 17v4"/></svg>',
    med:   '<svg ' + S + '><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-45 12 12.5)"/><path d="M9.5 10l5 5"/></svg>',
    temp:  '<svg ' + S + '><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
    bath:  '<svg ' + S + '><path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/><path d="M6 12V5a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/></svg>',
    tummy: '<svg ' + S + '><circle cx="17" cy="8" r="2.5"/><path d="M3 17h13l3-4M7 17l2-4h5"/></svg>',
    note:  '<svg ' + S + '><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    more:  '<svg ' + S + '><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
    today: '<svg ' + S + '><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    hist:  '<svg ' + S + '><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    growth: '<svg ' + S + '><path d="M3 20h18"/><polyline points="4 16 9 11 13 14 20 6"/><polyline points="15 6 20 6 20 11"/></svg>',
    marks: '<svg ' + S + '><polygon points="12 3 14.8 8.8 21 9.6 16.5 14 17.6 20.2 12 17.3 6.4 20.2 7.5 14 3 9.6 9.2 8.8"/></svg>',
    check: '<svg ' + S + '><polyline points="5 12.5 10 17 19 7"/></svg>',
    vac:   '<svg ' + S + '><path d="M18 2l4 4M20 4l-9.5 9.5M14 4l6 6M8 12l4 4M4.5 19.5L8 16l-2-2-3.5 3.5z"/></svg>',
    doc:   '<svg ' + S + '><path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/></svg>',
    play:  '<svg ' + S + '><polygon points="7 4 19 12 7 20"/></svg>',
    pause: '<svg ' + S + '><path d="M8 5v14M16 5v14"/></svg>',
    stop:  '<svg ' + S + '><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    plus:  '<svg ' + S + '><path d="M12 5v14M5 12h14"/></svg>'
  };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("baby.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + view ----------
  var data = null, view = null;
  var histDay = "";

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    data = C.parse(raw);
    if (data) return;
    try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    try { console.error("[orOS] baby: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    data = C.empty();
  }

  var saveFailShown = false;
  function saveNow() {
    data = C.normalize(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadView() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch (e) {}
    v = (v && typeof v === "object") ? v : {};
    view = {
      kid: typeof v.kid === "string" ? v.kid : "",
      tab: TABS.indexOf(v.tab) >= 0 ? v.tab : "today",
      night: v.night ? 1 : 0,
      wk: ["sleep", "feeds", "nappies"].indexOf(v.wk) >= 0 ? v.wk : "sleep"
    };
  }
  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) {}
  }

  function todayKey() { return C.dayKey(new Date()); }
  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }
  function kids() { return C.liveKids(data); }
  function kid() {
    var list = kids();
    for (var i = 0; i < list.length; i++) if (list[i].id === view.kid) return list[i];
    return list.length ? list[list.length - 1] : null;     // the youngest
  }
  function kidId() { var k = kid(); return k ? k.id : ""; }
  function findEv(id) { return C.findIn(data.ev, id); }

  // ---------- 3. Edits ----------
  // Replace (or add) one record; the caller decides the stamp.
  function put(list, rec) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === rec.id) { list[i] = rec; return; }
    }
    list.push(rec);
  }
  function snap(x) { return JSON.parse(JSON.stringify(x)); }

  function addEv(rec, quiet) {
    rec.id = rec.id || C.newId();
    rec.k = rec.k || kidId();
    rec.m = Date.now();
    var n = C.normEv(rec);
    if (!n) { showToast(t("toast.bad")); return null; }
    put(data.ev, n);
    saveNow();
    renderAll();
    if (!quiet) undoToast(t("toast.added", { x: evTitle(n) }), function () { removeEv(n.id, true); });
    return n;
  }
  function updateEv(next) {
    var cur = findEv(next.id);
    if (!cur || cur.del) return false;
    next.m = stamp(cur.m);
    var n = C.normEv(next);
    if (!n) { showToast(t("toast.bad")); return false; }
    put(data.ev, n);
    saveNow();
    renderAll();
    return true;
  }
  // A tombstone with a fresh stamp (R17); Undo brings the record back.
  function removeEv(id, silent) {
    var cur = findEv(id);
    if (!cur || cur.del) return;
    var copy = snap(cur);
    put(data.ev, { id: id, m: stamp(cur.m), del: 1 });
    saveNow();
    renderAll();
    if (silent) return;
    undoToast(t("toast.deleted"), function () { restoreRec(data.ev, copy); });
  }
  function restoreRec(list, copy) {
    var cur = C.findIn(list, copy.id);
    copy.m = stamp(cur ? cur.m : copy.m);
    put(list, copy);
    saveNow();
    renderAll();
  }

  // Timers
  function startFeed(side) {
    var k = kidId();
    if (!k) return;
    if (C.running(data, k).some(function (e) { return e.t === "feed"; })) { showToast(t("toast.running")); return; }
    var now = Date.now();
    var rec = C.feedStart(k, side, now, C.newId());
    addEv(rec, true);
    live(t("live.timer", { x: t("tm.feeding") }));
  }
  function feedAct(id, act, side) {
    var cur = findEv(id);
    if (!cur || cur.del || cur.e !== undefined) return;
    var now = Date.now(), next;
    if (act === "side") next = C.feedSide(cur, side, now);
    else if (act === "pause") next = C.feedPause(cur, now);
    else next = C.feedStop(cur, now);
    var before = snap(cur);
    if (!updateEv(next)) return;
    if (act === "stop") {
      var s = C.feedSecs(next, now);
      undoToast(t("toast.feedStop", { x: C.fmtDur((s.l + s.r) / 60) }), function () { restoreRec(data.ev, before); });
    }
  }
  function toggleSleep() {
    var k = kidId();
    if (!k) { showToast(t("toast.noKid")); return; }
    var run = C.running(data, k).filter(function (e) { return e.t === "sleep"; });
    if (run.length) { stopSleep(run[run.length - 1].id); return; }
    var rec = addEv({ t: "sleep", ts: Date.now() }, true);
    if (rec) undoToast(t("toast.sleepStart"), function () { removeEv(rec.id, true); });
  }
  function stopSleep(id) {
    var cur = findEv(id);
    if (!cur || cur.del || cur.e !== undefined) return;
    var before = snap(cur), next = snap(cur), now = Date.now();
    next.e = Math.max(cur.ts, Math.min(now, cur.ts + C.LIM.span));
    if (!updateEv(next)) return;
    undoToast(t("toast.sleepStop", { x: C.fmtDur((next.e - next.ts) / 60000) }), function () { restoreRec(data.ev, before); });
  }

  // Kids
  function saveKid(rec) {
    var cur = rec.id ? C.findIn(data.kids, rec.id) : null;
    rec.id = rec.id || C.newId();
    rec.m = stamp(cur ? cur.m : 0);
    var n = C.normKid(rec);
    if (!n) { showToast(t("toast.bad")); return null; }
    put(data.kids, n);
    view.kid = n.id;
    saveView();
    saveNow();
    renderAll();
    return n;
  }
  // Deleting a child tombstones it and everything logged for it (the
  // records would otherwise sit in the shared quota forever); Undo
  // brings all of them back.
  function deleteKid(id) {
    var k = C.findIn(data.kids, id);
    if (!k || k.del) return;
    var copies = { kids: [snap(k)], ev: [], gr: [], mk: [] };
    ["ev", "gr", "mk"].forEach(function (f) {
      data[f].forEach(function (x) { if (!x.del && x.k === id) copies[f].push(snap(x)); });
    });
    ["kids", "ev", "gr", "mk"].forEach(function (f) {
      copies[f].forEach(function (x) { put(data[f], { id: x.id, m: stamp(x.m), del: 1 }); });
    });
    saveNow();
    renderAll();
    undoToast(t("toast.kidDel", { x: k.n }), function () {
      ["kids", "ev", "gr", "mk"].forEach(function (f) {
        copies[f].forEach(function (x) {
          var cur = C.findIn(data[f], x.id);
          x.m = stamp(cur ? cur.m : x.m);
          put(data[f], x);
        });
      });
      view.kid = id;
      saveView();
      saveNow();
      renderAll();
    });
  }

  // Growth + marks: same shape of edit
  function saveRec(field, norm, rec) {
    var list = data[field], cur = rec.id ? C.findIn(list, rec.id) : null;
    rec.id = rec.id || C.newId();
    rec.k = rec.k || kidId();
    rec.m = stamp(cur ? cur.m : 0);
    var n = norm(rec);
    if (!n) { showToast(t("toast.bad")); return null; }
    put(list, n);
    saveNow();
    renderAll();
    return n;
  }
  function removeRec(field, id) {
    var list = data[field], cur = C.findIn(list, id);
    if (!cur || cur.del) return;
    var copy = snap(cur);
    put(list, { id: id, m: stamp(cur.m), del: 1 });
    saveNow();
    renderAll();
    undoToast(t("toast.deleted"), function () { restoreRec(list, copy); });
  }

  function setPrefs(next) {
    var p = C.normPrefs(next);
    if (JSON.stringify(p) === JSON.stringify(data.prefs)) return;
    data.prefs = p;
    data.pm = stamp(data.pm);
    saveNow();
  }

  // Reminder settings: device-local (C.REM_KEY), read by the shell
  // engine (shell.js babyCheckTick). Never synced, never in a backup.
  function readRem() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(C.REM_KEY) || "null"); } catch (e) {}
    return C.readRem(o);
  }
  function writeRem(next) {
    var r = C.readRem(next);
    try {
      if (C.remOn(r)) localStorage.setItem(C.REM_KEY, JSON.stringify(r));
      else localStorage.removeItem(C.REM_KEY);
    } catch (e) {}
  }
  function remHours(min) {
    var h = Math.floor(min / 60), half = min % 60 ? (LANG === "el" ? ",5" : ".5") : "";
    return h + half + (LANG === "el" ? " ώρες" : " h");
  }

  // ---------- 4. Render: toolbar, nav, today ----------
  function dayLabel(key) {
    var tk = todayKey();
    if (key === tk) return t("today");
    if (key === C.addDays(tk, -1)) return t("yesterday");
    try {
      return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" })
        .format(C.keyDate(key));
    } catch (e) { return key; }
  }
  function dateText(key) {
    try {
      return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(C.keyDate(key));
    } catch (e) { return key; }
  }
  function agoText(ts) {
    var min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return t("ago.now");
    return t("ago", { x: C.fmtDur(min) });
  }

  function renderToolbar() {
    var k = kid();
    $("kid-name").textContent = k ? k.n : t("app");
    $("kid-age").textContent = k ? C.fmtAge(k.b, todayKey(), LANG) : "";
    $("kid-dot").style.background = k ? KID_COLORS[k.c] : "var(--border)";
    $("kid-btn").setAttribute("aria-label", k ? k.n + ", " + C.fmtAge(k.b, todayKey(), LANG) + " · " + t("kid.pick") : t("kid.none"));
    var nb = $("night-btn");
    nb.setAttribute("aria-pressed", view.night ? "true" : "false");
    nb.classList.toggle("on", !!view.night);
    nb.setAttribute("aria-label", t(view.night ? "night.on" : "night.off"));
    nb.title = nb.getAttribute("aria-label");
  }

  function renderNav() {
    var host = $("nav"), has = !!kid();
    host.hidden = !has;
    host.innerHTML = "";
    TABS.forEach(function (tab) {
      var b = el("button", "nav-btn" + (view.tab === tab ? " on" : ""));
      b.type = "button";
      b.innerHTML = UI[tab] + "<span></span>";
      b.lastChild.textContent = t("tab." + tab);
      if (view.tab === tab) b.setAttribute("aria-current", "page");
      b.addEventListener("click", function () { goTab(tab); });
      host.appendChild(b);
    });
  }

  function goTab(tab) {
    view.tab = tab;
    saveView();
    renderAll();
    var v = $("view");
    if (v) v.scrollTop = 0;
  }

  function evTitle(e) { return t("t." + e.t); }
  // One line of detail for an event.
  function evDetail(e) {
    var p = data.prefs, now = Date.now(), parts = [];
    switch (e.t) {
      case "feed":
        var s = C.feedSecs(e, now);
        if (s.l) parts.push(t("side.L") + " " + C.fmtDur(s.l / 60));
        if (s.r) parts.push(t("side.R") + " " + C.fmtDur(s.r / 60));
        if (!s.l && !s.r && e.e !== undefined) parts.push(C.fmtDur((e.e - e.ts) / 60000));
        break;
      case "bottle": parts.push(C.fmtVol(e.ml, p, LANG), t("sub." + e.x)); break;
      case "solid": parts.push(t("sub." + e.x)); break;
      case "diaper": parts.push(t("sub." + e.x)); break;
      case "pump": parts.push(C.fmtVol(e.ml, p, LANG), t("side." + e.sd)); break;
      case "temp": parts.push(C.fmtTemp(e.v, p, LANG)); break;
      case "tummy": parts.push(C.fmtDur(e.v)); break;
      case "sleep":
        if (e.e !== undefined) parts.push(C.fmtDur((e.e - e.ts) / 60000));
        break;
    }
    return parts.join(" · ");
  }
  function evTime(e, key) {
    var a = clock(e.ts);
    if (key && C.dayKeyOf(e.ts) !== key) a = "‹ " + a;
    if (C.TIMED[e.t]) return e.e === undefined ? a + " –" : a + "–" + clock(e.e);
    return a;
  }

  function evRow(e, key) {
    var li = el("li");
    var b = el("button", "ev ev-" + e.t);
    b.type = "button";
    b.appendChild(el("time", "ev-t", evTime(e, key)));
    var ic = el("span", "ev-i");
    ic.innerHTML = UI[e.t];
    b.appendChild(ic);
    var body = el("span", "ev-b");
    body.appendChild(el("span", "ev-n", e.tx && (e.t === "med" || e.t === "note" || e.t === "solid") ? evTitle(e) + ": " + e.tx : evTitle(e)));
    var d = evDetail(e);
    if (e.tx && !(e.t === "med" || e.t === "note" || e.t === "solid")) d = d ? d + " · " + e.tx : e.tx;
    if (d) body.appendChild(el("span", "ev-d", d));
    if (C.TIMED[e.t] && e.e === undefined) body.appendChild(el("span", "ev-run", t(e.t === "feed" ? "q.feedOn" : "tm.sleeping")));
    b.appendChild(body);
    b.setAttribute("aria-label", t("dlg.edit", { x: evTitle(e) }) + ", " + evTime(e, key) + (d ? ", " + d : ""));
    b.addEventListener("click", function () { evDialog(e.t, e.id); });
    li.appendChild(b);
    return li;
  }

  function renderList(listId, emptyId, key) {
    var k = kidId(), host = $(listId);
    var list = k ? C.dayEvents(data, k, key).slice().reverse() : [];
    host.innerHTML = "";
    list.forEach(function (e) { host.appendChild(evRow(e, key)); });
    $(emptyId).hidden = list.length > 0;
    return list.length;
  }

  function renderTimers() {
    var host = $("timers"), k = kidId();
    host.innerHTML = "";
    if (!k) return;
    var run = C.running(data, k);
    var kinds = {};
    run.forEach(function (e) { kinds[e.t] = (kinds[e.t] || 0) + 1; });
    run.forEach(function (e) {
      var card = el("div", "timer timer-" + e.t);
      var head = el("div", "tm-head");
      var ic = el("span", "tm-i");
      ic.innerHTML = UI[e.t];
      head.appendChild(ic);
      var lbl = el("div", "tm-l");
      lbl.appendChild(el("div", "tm-name", t(e.t === "feed" ? "tm.feeding" : "tm.sleeping")));
      lbl.appendChild(el("div", "tm-since", t("tm.since", { t: clock(e.ts) })));
      head.appendChild(lbl);
      var clk = el("div", "tm-clock");
      clk.setAttribute("data-run", e.id);
      head.appendChild(clk);
      card.appendChild(head);
      var acts = el("div", "tm-acts");
      if (e.t === "feed") {
        ["l", "r"].forEach(function (side) {
          var b = el("button", "tm-side" + (e.cur === side ? " on" : ""));
          b.type = "button";
          b.appendChild(el("span", "ts-n", t("side." + side)));
          var c = el("span", "ts-c");
          c.setAttribute("data-side", e.id + ":" + side);
          b.appendChild(c);
          b.setAttribute("aria-pressed", e.cur === side ? "true" : "false");
          b.addEventListener("click", function () {
            if (e.cur === side) feedAct(e.id, "pause"); else feedAct(e.id, "side", side);
          });
          acts.appendChild(b);
        });
        var pz = el("button", "tm-btn");
        pz.type = "button";
        pz.innerHTML = (e.cur ? UI.pause : UI.play) + "<span></span>";
        pz.lastChild.textContent = t(e.cur ? "tm.pause" : "tm.resume");
        pz.addEventListener("click", function () {
          if (e.cur) feedAct(e.id, "pause"); else feedAct(e.id, "side", e.sd || "l");
        });
        acts.appendChild(pz);
        var done = el("button", "tm-btn primary");
        done.type = "button";
        done.innerHTML = UI.stop + "<span></span>";
        done.lastChild.textContent = t("tm.done");
        done.addEventListener("click", function () { feedAct(e.id, "stop"); });
        acts.appendChild(done);
      } else {
        var wake = el("button", "tm-btn primary wide");
        wake.type = "button";
        wake.innerHTML = UI.stop + "<span></span>";
        wake.lastChild.textContent = t("tm.wake");
        wake.addEventListener("click", function () { stopSleep(e.id); });
        acts.appendChild(wake);
      }
      card.appendChild(acts);
      if (kinds[e.t] > 1) card.appendChild(el("p", "hint", t("tm.two")));
      host.appendChild(card);
    });
    tickTimers();
  }

  // Updates only the running clocks (once a second).
  function tickTimers() {
    var now = Date.now();
    [].forEach.call(document.querySelectorAll("[data-run]"), function (n) {
      var e = findEv(n.getAttribute("data-run"));
      if (!e || e.del) return;
      if (e.t === "feed") {
        var s = C.feedSecs(e, now);
        n.textContent = C.fmtTimer(s.l + s.r);
        n.classList.toggle("paused", !e.cur);
      } else {
        n.textContent = C.fmtTimer((now - e.ts) / 1000);
      }
    });
    [].forEach.call(document.querySelectorAll("[data-side]"), function (n) {
      var p = n.getAttribute("data-side").split(":"), e = findEv(p[0]);
      if (!e || e.del) return;
      var s = C.feedSecs(e, now);
      n.textContent = C.fmtTimer(p[1] === "l" ? s.l : s.r);
    });
  }

  function sinceCard(label, main, sub) {
    var c = el("div", "since-c");
    c.appendChild(el("div", "sc-l", label));
    c.appendChild(el("div", "sc-n", main));
    if (sub) c.appendChild(el("div", "sc-s", sub));
    return c;
  }
  function renderSince() {
    var host = $("since"), k = kidId(), now = Date.now();
    host.innerHTML = "";
    if (!k) return;
    var f = C.lastOf(data, k, ["feed", "bottle"], now);
    if (f && f.t === "feed" && f.e === undefined) {
      host.appendChild(sinceCard(t("since.feed"), t("q.feedOn"), t("tm.since", { t: clock(f.ts) })));
    } else {
      var fsub = t("next", { s: t("side." + C.nextSide(data, k, now)) });
      if (f) fsub = (f.t === "bottle" ? C.fmtVol(f.ml, data.prefs, LANG) : evDetail(f)) + " · " + fsub;
      host.appendChild(sinceCard(t("since.feed"), f ? agoText(f.ts) : t("since.none"), fsub));
    }
    var d = C.lastOf(data, k, ["diaper"], now);
    host.appendChild(sinceCard(t("since.diaper"), d ? agoText(d.ts) : t("since.none"), d ? t("sub." + d.x) : ""));
    var run = C.running(data, k).filter(function (e) { return e.t === "sleep"; });
    if (run.length) {
      host.appendChild(sinceCard(t("since.asleep"), C.fmtDur((now - run[0].ts) / 60000), t("tm.since", { t: clock(run[0].ts) })));
    } else {
      var w = C.lastWake(data, k, now);
      host.appendChild(sinceCard(t("since.awake"), w ? C.fmtDur((now - w) / 60000) : t("since.none"), w ? t("tm.since", { t: clock(w) }) : ""));
    }
  }

  var QUICK = ["feed", "bottle", "sleep", "diaper", "solid", "pump", "more"];
  function renderQuick() {
    var host = $("quick"), k = kidId();
    host.innerHTML = "";
    if (!k) return;
    var asleep = C.isAsleep(data, k);
    var feeding = C.running(data, k).some(function (e) { return e.t === "feed"; });
    QUICK.forEach(function (q) {
      var b = el("button", "q-btn q-" + q);
      b.type = "button";
      b.innerHTML = UI[q] + "<span></span>";
      var label = t("t." + q);
      if (q === "sleep" && asleep) { label = t("q.sleepStop"); b.classList.add("on"); }
      if (q === "feed" && feeding) { label = t("q.feedOn"); b.classList.add("on"); b.disabled = true; }
      b.lastChild.textContent = label;
      b.addEventListener("click", function () { quick(q); });
      host.appendChild(b);
    });
  }
  function quick(q) {
    if (!kidId()) { showToast(t("toast.noKid")); return; }
    if (q === "feed") feedDialog();
    else if (q === "sleep") toggleSleep();
    else if (q === "bottle") bottleDialog();
    else if (q === "diaper") diaperDialog();
    else if (q === "more") moreDialog();
    else evDialog(q, null);
  }

  function stat(n, l, sub) {
    var c = el("div", "stat");
    c.appendChild(el("div", "stat-n", n));
    c.appendChild(el("div", "stat-l", l));
    if (sub) c.appendChild(el("div", "stat-s", sub));
    return c;
  }
  function renderTotals(hostId, key) {
    var host = $(hostId), k = kidId();
    host.innerHTML = "";
    if (!k) return;
    var o = C.dayTotals(data, k, key, Date.now());
    host.appendChild(stat(num(o.feeds), t("st.feeds"),
      (o.breastMin ? t("st.breast") + " " + C.fmtDur(o.breastMin) : "") +
      (o.breastMin && o.bottleMl ? " · " : "") +
      (o.bottleMl ? t("st.bottle") + " " + C.fmtVol(o.bottleMl, data.prefs, LANG) : "")));
    host.appendChild(stat(C.fmtDur(o.sleepMin), t("st.sleep"),
      (o.nightMin ? t("st.night", { x: C.fmtDur(o.nightMin) }) : "") +
      (o.naps ? (o.nightMin ? " · " : "") + (o.naps === 1 ? t("st.naps1") : t("st.naps", { n: o.naps })) : "")));
    host.appendChild(stat(num(o.wet), t("st.wet")));
    host.appendChild(stat(num(o.dirty), t("st.dirty")));
    if (o.pumpMl) host.appendChild(stat(C.fmtVol(o.pumpMl, data.prefs, LANG), t("st.pump")));
  }

  function renderToday() {
    renderTimers();
    renderSince();
    renderQuick();
    var tk = todayKey();
    renderTotals("today-tot", tk);
    var n = renderList("today-list", "today-empty", tk);
    $("today-count").textContent = n ? (n === 1 ? t("log.count1") : t("log.count", { n: n })) : "";
  }

  // ---------- 5. Render: history ----------
  function renderHist() {
    var tk = todayKey();
    if (!histDay || histDay > tk) histDay = tk;
    $("day-btn").textContent = dayLabel(histDay);
    $("day-btn").classList.toggle("is-today", histDay === tk);
    $("next-btn").disabled = histDay >= tk;
    renderTotals("hist-tot", histDay);
    renderList("hist-list", "hist-empty", histDay);
    renderWeek();
    renderPattern();
  }
  function shiftDay(n) {
    var k = C.addDays(histDay || todayKey(), n);
    if (k > todayKey()) return;
    histDay = k;
    renderHist();
  }

  function renderWeekPick() {
    var host = $("week-pick");
    host.innerHTML = "";
    ["sleep", "feeds", "nappies"].forEach(function (w) {
      var b = el("button", "seg-b" + (view.wk === w ? " on" : ""), t("wk." + w));
      b.type = "button";
      b.setAttribute("aria-pressed", view.wk === w ? "true" : "false");
      b.addEventListener("click", function () { view.wk = w; saveView(); renderWeekPick(); renderWeek(); });
      host.appendChild(b);
    });
  }
  function renderWeek() {
    var host = $("week"), k = kidId(), tk = todayKey();
    host.innerHTML = "";
    if (!k) return;
    var rows = C.weekTotals(data, k, tk, Date.now()), max = 0;
    rows.forEach(function (r) {
      var v = view.wk === "sleep" ? r.tot.sleepMin : (view.wk === "feeds" ? r.tot.feeds : r.tot.wet + r.tot.dirty);
      r.v = v;
      if (v > max) max = v;
    });
    rows.forEach(function (r) {
      var b = el("button", "bar");
      b.type = "button";
      if (r.key === histDay) b.classList.add("sel");
      if (r.key === tk) b.classList.add("today");
      var txt = view.wk === "sleep" ? C.fmtDur(r.v) : num(r.v);
      b.appendChild(el("span", "b-v", r.v ? txt : ""));
      var track = el("span", "b-track");
      var fill = el("span", "b-fill");
      fill.style.height = (max ? Math.round(r.v / max * 100) : 0) + "%";
      track.appendChild(fill);
      b.appendChild(track);
      var dn = "";
      try { dn = new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(C.keyDate(r.key)); } catch (e) {}
      b.appendChild(el("span", "b-d", dn));
      b.setAttribute("aria-label", dayLabel(r.key) + ": " + txt + " " + t("wk." + view.wk));
      b.addEventListener("click", function () { histDay = r.key; renderHist(); });
      host.appendChild(b);
    });
  }

  function renderPattern() {
    var host = $("pattern"), k = kidId(), tk = todayKey(), now = Date.now();
    host.innerHTML = "";
    if (!k) return;
    var scale = el("div", "pat-row pat-scale");
    scale.appendChild(el("span", "pat-d", ""));
    var sc = el("span", "pat-strip");
    [0, 6, 12, 18, 24].forEach(function (h) {
      var m = el("span", "pat-h", String(h));
      m.style.left = (h / 24 * 100) + "%";
      sc.appendChild(m);
    });
    scale.appendChild(sc);
    host.appendChild(scale);
    for (var i = 6; i >= 0; i--) {
      var key = C.addDays(tk, -i);
      var row = el("div", "pat-row" + (key === histDay ? " sel" : ""));
      var dn = "";
      try { dn = new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(C.keyDate(key)); } catch (e) {}
      row.appendChild(el("span", "pat-d", dn));
      var strip = el("span", "pat-strip");
      C.daySpans(data, k, key, now).forEach(function (s) {
        var seg = el("i", "pat-" + s.t);
        seg.style.left = (s.a * 100).toFixed(2) + "%";
        seg.style.width = Math.max(0.6, (s.b - s.a) * 100).toFixed(2) + "%";
        strip.appendChild(seg);
      });
      row.appendChild(strip);
      host.appendChild(row);
    }
    var lg = $("pattern-legend");
    lg.innerHTML = "";
    ["sleep", "feed"].forEach(function (n) {
      var s = el("span", "lg");
      s.appendChild(el("i", "pat-" + n));
      s.appendChild(el("span", "", t("pat." + n)));
      lg.appendChild(s);
    });
  }

  // ---------- 6. Render: growth ----------
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (a) { n.setAttribute(a, attrs[a]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fmtMeasure(f, v) {
    return f === "g" ? C.fmtWeight(v, data.prefs, LANG) : C.fmtLen(v, LANG);
  }
  function chart(k, f, title) {
    var pts = C.kidGrowth(data, k.id).filter(function (g) { return g[f] !== undefined; })
      .map(function (g) { return { x: C.ageMonths(k.b, g.d), y: g[f], d: g.d }; });
    var box = el("section", "chart");
    box.appendChild(el("h2", "", title));
    if (!pts.length) { box.hidden = true; return box; }
    var W = 320, H = 150, L = 44, R = 12, T = 10, B = 24;
    var xMax = Math.max(1, Math.ceil(Math.max(C.ageMonths(k.b, todayKey()), pts[pts.length - 1].x)));
    var yMin = Infinity, yMax = -Infinity;
    pts.forEach(function (p) { yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); });
    var padY = Math.max((yMax - yMin) * 0.15, f === "g" ? 300 : 10);
    yMin = Math.max(0, yMin - padY);
    yMax = yMax + padY;
    function X(v) { return L + v / xMax * (W - L - R); }
    function Y(v) { return T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B); }
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": title + ": " + pts.map(function (p) { return p.d + " " + fmtMeasure(f, p.y); }).join(", ") });
    // grid: 3 horizontal lines, month ticks
    for (var i = 0; i <= 2; i++) {
      var v = yMin + (yMax - yMin) * i / 2, y = Y(v);
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, "class": "c-grid" }));
      var lab = f === "g" ? (data.prefs.wu === "lb" ? num(v / 453.59237, 1) : num(v / 1000, 1)) : num(v / 10);
      svg.appendChild(svgEl("text", { x: L - 6, y: y + 4, "text-anchor": "end", "class": "c-lbl" }, lab));
    }
    var step = xMax <= 6 ? 1 : (xMax <= 12 ? 2 : (xMax <= 24 ? 3 : 6));
    for (var m = 0; m <= xMax; m += step) {
      svg.appendChild(svgEl("text", { x: X(m), y: H - 6, "text-anchor": "middle", "class": "c-lbl" }, String(m)));
    }
    svg.appendChild(svgEl("text", { x: W - R, y: H - 6, "text-anchor": "end", "class": "c-lbl c-unit" }, ""));
    var d = pts.map(function (p, j) { return (j ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); }).join(" ");
    svg.appendChild(svgEl("path", { d: d, "class": "c-line" }));
    pts.forEach(function (p) {
      svg.appendChild(svgEl("circle", { cx: X(p.x).toFixed(1), cy: Y(p.y).toFixed(1), r: 3.5, "class": "c-dot" }));
    });
    box.appendChild(svg);
    var last = pts[pts.length - 1];
    var cap = el("div", "c-cap");
    cap.appendChild(el("strong", "", fmtMeasure(f, last.y)));
    cap.appendChild(el("span", "", " · " + dateText(last.d) + " · x: " + t("gr.months")));
    box.appendChild(cap);
    return box;
  }
  function renderGrowth() {
    var k = kid(), host = $("charts"), list = $("gr-list");
    host.innerHTML = "";
    list.innerHTML = "";
    if (!k) return;
    host.appendChild(chart(k, "g", t("gr.w")));
    host.appendChild(chart(k, "l", t("gr.l")));
    host.appendChild(chart(k, "h", t("gr.h")));
    var gs = C.kidGrowth(data, k.id).slice().reverse();
    gs.forEach(function (g) {
      var li = el("li");
      var b = el("button", "ev");
      b.type = "button";
      b.appendChild(el("time", "ev-t wide", dateText(g.d)));
      var body = el("span", "ev-b");
      var parts = [];
      if (g.g) parts.push(t("gr.w") + " " + fmtMeasure("g", g.g));
      if (g.l) parts.push(t("gr.l") + " " + fmtMeasure("l", g.l));
      if (g.h) parts.push(t("gr.h") + " " + fmtMeasure("h", g.h));
      body.appendChild(el("span", "ev-n", parts.join(" · ")));
      body.appendChild(el("span", "ev-d", C.fmtAge(k.b, g.d, LANG)));
      b.appendChild(body);
      b.addEventListener("click", function () { growthDialog(g.id); });
      li.appendChild(b);
      list.appendChild(li);
    });
    $("gr-empty").hidden = gs.length > 0;
  }

  // ---------- 7. Render: milestones + health ----------
  function renderMarks() {
    var k = kid();
    var ms = $("ms-list");
    ms.innerHTML = "";
    if (!k) return;
    var done = {};
    C.kidMarks(data, k.id, "ms").forEach(function (x) { if (x.key) done[x.key] = x; });
    C.MILESTONES.forEach(function (m) {
      var rec = done[m[0]];
      var li = el("li");
      var b = el("button", "ms" + (rec ? " done" : ""));
      b.type = "button";
      var ic = el("span", "ms-i");
      ic.innerHTML = rec ? UI.check : "";
      b.appendChild(ic);
      b.appendChild(el("span", "ms-n", C.msLabel(m[0], LANG)));
      b.appendChild(el("span", "ms-d", rec ? dateText(rec.d) : ""));
      b.setAttribute("aria-label", rec ? C.msLabel(m[0], LANG) + ", " + dateText(rec.d) : t("mk.tick", { x: C.msLabel(m[0], LANG) }));
      b.addEventListener("click", function () { markDialog("ms", rec ? rec.id : null, m[0]); });
      li.appendChild(b);
      ms.appendChild(li);
    });
    C.kidMarks(data, k.id, "ms").filter(function (x) { return !x.key; }).forEach(function (x) {
      var li = el("li");
      var b = el("button", "ms done custom");
      b.type = "button";
      var ic = el("span", "ms-i");
      ic.innerHTML = UI.check;
      b.appendChild(ic);
      b.appendChild(el("span", "ms-n", x.tx));
      b.appendChild(el("span", "ms-d", dateText(x.d)));
      b.addEventListener("click", function () { markDialog("ms", x.id, null); });
      li.appendChild(b);
      ms.appendChild(li);
    });
    ["vac", "doc"].forEach(function (type) {
      var host = $(type + "-list"), list = C.kidMarks(data, k.id, type).slice().reverse();
      host.innerHTML = "";
      list.forEach(function (x) {
        var li = el("li");
        var b = el("button", "ev");
        b.type = "button";
        b.appendChild(el("time", "ev-t wide", dateText(x.d)));
        var ic = el("span", "ev-i");
        ic.innerHTML = UI[type];
        b.appendChild(ic);
        var body = el("span", "ev-b");
        body.appendChild(el("span", "ev-n", x.tx));
        if (x.nt) body.appendChild(el("span", "ev-d", x.nt));
        b.appendChild(body);
        b.addEventListener("click", function () { markDialog(type, x.id, null); });
        li.appendChild(b);
        host.appendChild(li);
      });
      $(type + "-empty").hidden = list.length > 0;
    });
  }

  function renderAll() {
    var has = !!kid();
    renderToolbar();
    renderNav();
    $("welcome").hidden = has;
    TABS.forEach(function (tab) { $("tab-" + tab).hidden = !has || view.tab !== tab; });
    document.body.classList.toggle("no-kid", !has);
    if (!has) return;
    if (view.tab === "today") renderToday();
    else if (view.tab === "hist") renderHist();
    else if (view.tab === "growth") renderGrowth();
    else renderMarks();
  }

  // ---------- 8. Dialogs: shared helpers ----------
  function makeDialog(id, title) {
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
    dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function field(labelText, input, note) {
    var w = el("div", "fld");
    var lab = el("label", "dlg-lbl", labelText);
    if (!input.id) input.id = "f-" + C.newId();
    lab.setAttribute("for", input.id);
    w.appendChild(lab);
    w.appendChild(input);
    if (note) w.appendChild(el("p", "hint", note));
    return w;
  }
  function numInput(value, dec) {
    var i = el("input");
    i.type = "text";
    i.inputMode = dec ? "decimal" : "numeric";
    i.autocomplete = "off";
    i.value = value === null || value === undefined ? "" : String(value);
    return i;
  }
  // "12", "12.5", "12,5" → number; blank → null; junk → NaN
  function readNum(input) {
    var v = String(input.value).trim().replace(",", ".");
    if (!v) return null;
    if (!/^\d+(\.\d+)?$/.test(v)) return NaN;
    return parseFloat(v);
  }
  function textInput(value, max) {
    var i = el("input");
    i.type = "text";
    i.maxLength = max;
    i.value = value || "";
    return i;
  }
  function localInput(ts) {
    var d = new Date(ts);
    return C.dayKey(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dtInput(ts) {
    var i = el("input");
    i.type = "datetime-local";
    i.value = ts ? localInput(ts) : "";
    return i;
  }
  // "YYYY-MM-DDTHH:MM" (local) → ms; blank → null; junk → NaN
  function readDt(input) {
    var v = String(input.value).trim();
    if (!v) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }
  function dateInput(key, max) {
    var i = el("input");
    i.type = "date";
    i.value = key || "";
    if (max) i.max = max;
    return i;
  }
  // Segmented choice: [[value, label], ...]
  function seg(options, value) {
    var box = el("div", "seg");
    box.setAttribute("role", "radiogroup");
    var cur = value;
    options.forEach(function (o) {
      var b = el("button", "seg-b" + (o[0] === cur ? " on" : ""), o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", o[0] === cur ? "true" : "false");
      b.addEventListener("click", function () {
        cur = o[0];
        [].forEach.call(box.children, function (c, i) {
          var on = options[i][0] === cur;
          c.classList.toggle("on", on);
          c.setAttribute("aria-checked", on ? "true" : "false");
        });
      });
      box.appendChild(b);
    });
    return { node: box, get: function () { return cur; } };
  }
  function segField(labelText, s) {
    var w = el("div", "fld");
    var lab = el("div", "dlg-lbl", labelText);
    w.appendChild(lab);
    w.appendChild(s.node);
    s.node.setAttribute("aria-label", labelText);
    return w;
  }
  function actions(form, dlg, okLabel, delFn) {
    var acts = el("div", "dlg-actions");
    if (delFn) acts.appendChild(button(t("dlg.del"), "danger", function () { dlg.close(); delFn(); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(okLabel || t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
  }
  function openDialog(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) { focus.focus(); if (focus.select) try { focus.select(); } catch (e) {} }
  }
  function bigChoice(icon, label, sub, cls, fn) {
    var b = el("button", "choice" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = icon + "<span class=\"ch-l\"></span><span class=\"ch-s\"></span>";
    b.querySelector(".ch-l").textContent = label;
    b.querySelector(".ch-s").textContent = sub || "";
    b.addEventListener("click", fn);
    return b;
  }
  function toMl(v) { return data.prefs.vu === "oz" ? Math.round(v * 29.5735) : Math.round(v); }
  function fromMl(ml) { return data.prefs.vu === "oz" ? Math.round(ml / 29.5735 * 10) / 10 : ml; }
  function volLabel() { return t(data.prefs.vu === "oz" ? "dlg.oz" : "dlg.ml"); }

  // ---------- 9. Dialogs: events ----------
  // Breastfeed: start a timer on either side (the suggested one is
  // marked), or log a feed that already happened.
  function feedDialog() {
    var k = kidId(), next = C.nextSide(data, k, Date.now());
    var dlg = makeDialog("bb-feed", t("dlg.feedStart"));
    var row = el("div", "choices two");
    ["l", "r"].forEach(function (side) {
      row.appendChild(bigChoice(UI.play, t("side." + side), side === next ? t("dlg.suggest") : "",
        side === next ? "suggest" : "", function () { dlg.close(); startFeed(side); }));
    });
    dlg.appendChild(row);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.feedPast"), "", function () { dlg.close(); evDialog("feed", null); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, row.querySelector(".suggest"));
  }

  // Nappy: one tap logs it now.
  function diaperDialog() {
    var dlg = makeDialog("bb-diaper", t("t.diaper"));
    var row = el("div", "choices three");
    C.SUBS.diaper.forEach(function (x) {
      row.appendChild(bigChoice(UI.diaper, t("sub." + x), "", "d-" + x, function () {
        dlg.close();
        addEv({ t: "diaper", ts: Date.now(), x: x });
      }));
    });
    dlg.appendChild(row);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.time") + "…", "", function () { dlg.close(); evDialog("diaper", null); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, null);
  }

  // Bottle: a chip logs that amount now; or type one.
  function bottleDialog() {
    var dlg = makeDialog("bb-bottle", t("t.bottle"));
    var form = el("form");
    form.method = "dialog";
    var last = C.lastOf(data, kidId(), ["bottle"], Date.now());
    var kind = seg([["bm", t("sub.bm")], ["fm", t("sub.fm")]], last ? last.x : "bm");
    form.appendChild(segField(t("dlg.kind"), kind));
    var chips = el("div", "chips");
    var opts = data.prefs.vu === "oz" ? [2, 3, 4, 5, 6, 7, 8] : [30, 60, 90, 120, 150, 180, 210];
    opts.forEach(function (v) {
      var c = el("button", "chip", data.prefs.vu === "oz" ? num(v) + " fl oz" : v + " ml");
      c.type = "button";
      c.addEventListener("click", function () {
        dlg.close();
        addEv({ t: "bottle", ts: Date.now(), ml: toMl(v), x: kind.get() });
      });
      chips.appendChild(c);
    });
    form.appendChild(chips);
    var amt = numInput(last ? fromMl(last.ml) : "", data.prefs.vu === "oz");
    form.appendChild(field(volLabel(), amt));
    actions(form, dlg, t("dlg.add"));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = readNum(amt);
      if (v === null || isNaN(v) || !C.inRange(toMl(v), C.LIM.ml)) { showToast(t("toast.bad")); amt.focus(); return; }
      dlg.close();
      addEv({ t: "bottle", ts: Date.now(), ml: toMl(v), x: kind.get() });
    });
    dlg.appendChild(form);
    openDialog(dlg, null);
  }

  function moreDialog() {
    var dlg = makeDialog("bb-more", t("t.more"));
    var grid = el("div", "choices grid");
    ["med", "temp", "bath", "tummy", "note", "solid", "pump"].forEach(function (type) {
      grid.appendChild(bigChoice(UI[type], t("t." + type), "", "", function () { dlg.close(); evDialog(type, null); }));
    });
    grid.appendChild(bigChoice(UI.sleep, t("dlg.sleepPast"), "", "", function () { dlg.close(); evDialog("sleep", null); }));
    grid.appendChild(bigChoice(UI.feed, t("dlg.feedPast"), "", "", function () { dlg.close(); evDialog("feed", null); }));
    dlg.appendChild(grid);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, null);
  }

  // New or edit, any type. A new timed event here is a PAST one
  // (start + end); the timers start from the quick buttons.
  function evDialog(type, id) {
    var cur = id ? findEv(id) : null;
    if (id && (!cur || cur.del)) return;
    var now = Date.now();
    var dlg = makeDialog("bb-ev", t(cur ? "dlg.edit" : "dlg.new", { x: t("t." + type) }));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var timed = !!C.TIMED[type];
    var start = dtInput(cur ? cur.ts : (timed ? now - 30 * 60000 : now));
    var end = null;
    if (timed) {
      var row = el("div", "fld-row");
      row.appendChild(field(t("dlg.start"), start));
      end = dtInput(cur ? (cur.e !== undefined ? cur.e : null) : now);
      row.appendChild(field(t("dlg.end"), end));
      form.appendChild(row);
      if (cur && cur.e === undefined) form.appendChild(el("p", "hint", t("dlg.endNote")));
    } else {
      form.appendChild(field(t("dlg.time"), start));
    }
    var get = {};          // field readers for this type
    var focus = null;
    if (type === "feed") {
      var s = cur ? C.feedSecs(cur, now) : { l: 0, r: 0 };
      var fr = el("div", "fld-row");
      var lm = numInput(cur ? Math.round(s.l / 60) : "", false), rm = numInput(cur ? Math.round(s.r / 60) : "", false);
      fr.appendChild(field(t("dlg.lmin"), lm));
      fr.appendChild(field(t("dlg.rmin"), rm));
      form.appendChild(fr);
      var ls = seg([["l", t("side.l")], ["r", t("side.r")]], cur ? cur.sd : C.nextSide(data, kidId(), now));
      form.appendChild(segField(t("dlg.lastSide"), ls));
      get.feed = function (o) {
        var a = readNum(lm), b = readNum(rm);
        if (cur && cur.e === undefined && cur.cur) {
          // still running: keep the timer, only the start / side change
          return true;
        }
        if ((a !== null && (isNaN(a) || a > 240)) || (b !== null && (isNaN(b) || b > 240))) return false;
        o.ls = Math.round((a || 0) * 60);
        o.rs = Math.round((b || 0) * 60);
        o.sd = ls.get();
        return true;
      };
      if (cur && cur.e === undefined && cur.cur) { lm.disabled = true; rm.disabled = true; }
      focus = lm;
    } else if (type === "bottle") {
      var amt = numInput(cur ? fromMl(cur.ml) : "", data.prefs.vu === "oz");
      form.appendChild(field(volLabel(), amt));
      var kind = seg([["bm", t("sub.bm")], ["fm", t("sub.fm")]], cur ? cur.x : "bm");
      form.appendChild(segField(t("dlg.kind"), kind));
      get.bottle = function (o) {
        var v = readNum(amt);
        if (v === null || isNaN(v)) return false;
        o.ml = toMl(v);
        o.x = kind.get();
        return C.inRange(o.ml, C.LIM.ml);
      };
      focus = amt;
    } else if (type === "solid") {
      var food = textInput(cur ? cur.tx : "", C.LIM.text);
      form.appendChild(field(t("dlg.food"), food));
      var react = seg([["y", t("sub.y")], ["n", t("sub.n")], ["a", t("sub.a")]], cur ? cur.x : "y");
      form.appendChild(segField(t("dlg.reaction"), react));
      get.solid = function (o) { o.tx = food.value; o.x = react.get(); return true; };
      focus = food;
    } else if (type === "diaper") {
      var dk = seg(C.SUBS.diaper.map(function (x) { return [x, t("sub." + x)]; }), cur ? cur.x : "w");
      form.appendChild(segField(t("dlg.kind"), dk));
      get.diaper = function (o) { o.x = dk.get(); return true; };
    } else if (type === "pump") {
      var pa = numInput(cur ? fromMl(cur.ml) : "", data.prefs.vu === "oz");
      form.appendChild(field(volLabel(), pa));
      var ps = seg([["l", t("side.l")], ["r", t("side.r")], ["b", t("side.b")]], cur ? cur.sd : "b");
      form.appendChild(segField(t("dlg.side"), ps));
      get.pump = function (o) {
        var v = readNum(pa);
        if (v === null || isNaN(v)) return false;
        o.ml = toMl(v);
        o.sd = ps.get();
        return C.inRange(o.ml, C.LIM.pump);
      };
      focus = pa;
    } else if (type === "med") {
      var mn = textInput(cur ? cur.tx : "", C.LIM.text);
      mn.placeholder = LANG === "el" ? "π.χ. Βιταμίνη D, 1 σταγόνα" : "e.g. Vitamin D, 1 drop";
      form.appendChild(field(t("dlg.medName"), mn));
      get.med = function (o) { o.tx = mn.value; return !!C.cleanText(mn.value, C.LIM.text); };
      focus = mn;
    } else if (type === "temp") {
      var f = data.prefs.tu === "f";
      var tv = numInput(cur ? (f ? Math.round((cur.v / 10 * 9 / 5 + 32) * 10) / 10 : cur.v / 10) : "", true);
      form.appendChild(field(t(f ? "dlg.tempF" : "dlg.tempC"), tv));
      get.temp = function (o) {
        var v = readNum(tv);
        if (v === null || isNaN(v)) return false;
        o.v = Math.round((f ? (v - 32) * 5 / 9 : v) * 10);
        return C.inRange(o.v, C.LIM.temp);
      };
      focus = tv;
    } else if (type === "tummy") {
      var tm = numInput(cur ? cur.v : "", false);
      form.appendChild(field(t("dlg.min"), tm));
      get.tummy = function (o) {
        var v = readNum(tm);
        if (v === null || isNaN(v)) return false;
        o.v = Math.round(v);
        return C.inRange(o.v, C.LIM.tummy);
      };
      focus = tm;
    } else if (type === "note") {
      var nt = textInput(cur ? cur.tx : "", C.LIM.text);
      form.appendChild(field(t("dlg.text"), nt));
      get.note = function (o) { o.tx = nt.value; return !!C.cleanText(nt.value, C.LIM.text); };
      focus = nt;
    }
    // optional note for the types without a text of their own
    var note = null;
    if (["bottle", "diaper", "pump", "temp", "bath", "tummy", "sleep", "feed"].indexOf(type) >= 0) {
      note = textInput(cur ? cur.tx : "", C.LIM.text);
      form.appendChild(field(t("dlg.note"), note));
    }
    actions(form, dlg, cur ? t("dlg.save") : t("dlg.add"), cur ? function () { removeEv(cur.id, false); } : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var latest = id ? findEv(id) : null;
      if (id && (!latest || latest.del)) { dlg.close(); return; }       // deleted elsewhere meanwhile
      var o = latest ? snap(latest) : { t: type };
      var ts = readDt(start);
      if (ts === null || isNaN(ts)) { showToast(t("toast.bad")); start.focus(); return; }
      if (ts > Date.now() + 60000) { showToast(t("toast.future")); start.focus(); return; }
      o.ts = ts;
      if (timed) {
        var te = readDt(end);
        if (te !== null && isNaN(te)) { showToast(t("toast.bad")); end.focus(); return; }
        if (te === null && !(latest && latest.e === undefined)) { showToast(t("toast.badTime")); end.focus(); return; }
        if (te !== null) {
          if (te <= ts || te - ts > C.LIM.span) { showToast(t("toast.badTime")); end.focus(); return; }
          if (te > Date.now() + 60000) { showToast(t("toast.future")); end.focus(); return; }
          o.e = te;
          if (latest && latest.e === undefined && type === "feed") {
            var fixed = C.feedStop(latest, Math.min(te, Date.now()));
            o.ls = fixed.ls; o.rs = fixed.rs; delete o.cur; delete o.cs;
          }
        }
        if (latest && latest.cs !== undefined && o.cs !== undefined && o.cs < ts) o.cs = ts;
      }
      if (get[type] && !get[type](o)) { showToast(t("toast.bad")); return; }
      if (note) o.tx = note.value;
      if (type === "feed" && o.e !== undefined && !o.ls && !o.rs && !(latest && latest.e === undefined)) {
        // a past feed with no minutes: the span goes to the last side
        var secs = Math.min(C.LIM.sec[1], Math.round((o.e - o.ts) / 1000));
        if (o.sd === "r") o.rs = secs; else o.ls = secs;
      }
      dlg.close();
      if (latest) updateEv(o); else addEv(o);
    });
    dlg.appendChild(form);
    openDialog(dlg, focus);
  }

  // ---------- 10. Dialogs: kid, growth, marks ----------
  function kidsDialog() {
    var list = kids();
    if (!list.length) { kidDialog(null); return; }
    var dlg = makeDialog("bb-kids", t("kid.pick"));
    var ul = el("div", "kid-list");
    list.forEach(function (k) {
      var b = el("button", "kid-row" + (k.id === kidId() ? " on" : ""));
      b.type = "button";
      var dot = el("i", "kid-dot");
      dot.style.background = KID_COLORS[k.c];
      b.appendChild(dot);
      b.appendChild(el("span", "kr-n", k.n));
      b.appendChild(el("span", "kr-a", C.fmtAge(k.b, todayKey(), LANG)));
      b.addEventListener("click", function () {
        view.kid = k.id;
        saveView();
        dlg.close();
        renderAll();
      });
      ul.appendChild(b);
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions col");
    acts.appendChild(button(t("dlg.kidEdit"), "", function () { dlg.close(); kidDialog(kidId()); }));
    acts.appendChild(button(t("dlg.kidAdd"), "", function () { dlg.close(); kidDialog(null); }));
    acts.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, null);
  }

  function kidDialog(id) {
    var cur = id ? C.findIn(data.kids, id) : null;
    if (id && (!cur || cur.del)) return;
    var dlg = makeDialog("bb-kid", t(cur ? "dlg.kid" : "dlg.kidNew"));
    var form = el("form");
    form.method = "dialog";
    var name = textInput(cur ? cur.n : "", C.LIM.name);
    name.autocomplete = "off";
    form.appendChild(field(t("dlg.name"), name));
    var birth = dateInput(cur ? cur.b : todayKey(), todayKey());
    form.appendChild(field(t("dlg.birth"), birth));
    var sex = seg([["", t("sex.")], ["f", t("sex.f")], ["m", t("sex.m")]], cur ? cur.s : "");
    form.appendChild(segField(t("dlg.sex"), sex));
    var color = cur ? cur.c : kids().length % KID_COLORS.length;
    var sw = el("div", "swatches");
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", t("dlg.color"));
    KID_COLORS.forEach(function (c, i) {
      var b = el("button", "swatch" + (i === color ? " on" : ""));
      b.type = "button";
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === color ? "true" : "false");
      b.setAttribute("aria-label", t("dlg.color") + " " + (i + 1));
      b.addEventListener("click", function () {
        color = i;
        [].forEach.call(sw.children, function (x, j) {
          x.classList.toggle("on", j === i);
          x.setAttribute("aria-checked", j === i ? "true" : "false");
        });
      });
      sw.appendChild(b);
    });
    var cw = el("div", "fld");
    cw.appendChild(el("div", "dlg-lbl", t("dlg.color")));
    cw.appendChild(sw);
    form.appendChild(cw);
    actions(form, dlg, cur ? t("dlg.save") : t("dlg.add"), null);
    if (cur) {
      var del = button(t("dlg.kidDel"), "danger block", function () { dlg.close(); deleteKid(cur.id); });
      form.appendChild(del);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!C.cleanText(name.value, C.LIM.name)) { showToast(t("toast.needName")); name.focus(); return; }
      if (!C.validDay(birth.value) || birth.value > todayKey()) { showToast(t("toast.needBirth")); birth.focus(); return; }
      var rec = { id: cur ? cur.id : "", n: name.value, b: birth.value, s: sex.get(), c: color };
      dlg.close();
      saveKid(rec);
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg, name);
  }

  function growthDialog(id) {
    var cur = id ? C.findIn(data.gr, id) : null;
    if (id && (!cur || cur.del)) return;
    var lb = data.prefs.wu === "lb";
    var dlg = makeDialog("bb-gr", t("dlg.gr"));
    var form = el("form");
    form.method = "dialog";
    var day = dateInput(cur ? cur.d : todayKey(), todayKey());
    form.appendChild(field(t("dlg.date"), day));
    var w = numInput(cur && cur.g ? (lb ? Math.round(cur.g / 453.59237 * 100) / 100 : cur.g / 1000) : "", true);
    form.appendChild(field(t(lb ? "dlg.lb" : "dlg.kg"), w));
    var row = el("div", "fld-row");
    var l = numInput(cur && cur.l ? cur.l / 10 : "", true), h = numInput(cur && cur.h ? cur.h / 10 : "", true);
    row.appendChild(field(t("dlg.cm"), l));
    row.appendChild(field(t("dlg.head"), h));
    form.appendChild(row);
    form.appendChild(el("p", "hint", t("dlg.grNote")));
    actions(form, dlg, cur ? t("dlg.save") : t("dlg.add"), cur ? function () { removeRec("gr", cur.id); } : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!C.validDay(day.value) || day.value > todayKey()) { showToast(t("toast.bad")); day.focus(); return; }
      var wv = readNum(w), lv = readNum(l), hv = readNum(h);
      if ([wv, lv, hv].some(function (v) { return v !== null && isNaN(v); })) { showToast(t("toast.bad")); return; }
      var rec = { id: cur ? cur.id : "", d: day.value };
      if (wv !== null) rec.g = Math.round(lb ? wv * 453.59237 : wv * 1000);
      if (lv !== null) rec.l = Math.round(lv * 10);
      if (hv !== null) rec.h = Math.round(hv * 10);
      if ((rec.g !== undefined && !C.inRange(rec.g, C.LIM.g)) || (rec.l !== undefined && !C.inRange(rec.l, C.LIM.l)) ||
          (rec.h !== undefined && !C.inRange(rec.h, C.LIM.h)) ||
          (rec.g === undefined && rec.l === undefined && rec.h === undefined)) { showToast(t("toast.bad")); return; }
      dlg.close();
      saveRec("gr", C.normGr, rec);
    });
    dlg.appendChild(form);
    openDialog(dlg, w);
  }

  // type "ms" | "vac" | "doc"; key = a seed milestone (new or edit)
  function markDialog(type, id, key) {
    var cur = id ? C.findIn(data.mk, id) : null;
    if (id && (!cur || cur.del)) return;
    if (cur && cur.key) key = cur.key;
    var title = key ? C.msLabel(key, LANG) : t("dlg." + type);
    var dlg = makeDialog("bb-mk", title);
    var form = el("form");
    form.method = "dialog";
    var label = null;
    if (!key) {
      label = textInput(cur ? cur.tx : "", C.LIM.text);
      form.appendChild(field(t(type === "vac" ? "dlg.vacName" : (type === "doc" ? "dlg.docName" : "dlg.label")), label));
    }
    var day = dateInput(cur ? cur.d : todayKey(), todayKey());
    form.appendChild(field(t("dlg.date"), day));
    var nt = textInput(cur ? cur.nt : "", C.LIM.text);
    form.appendChild(field(t("dlg.note"), nt));
    actions(form, dlg, cur ? t("dlg.save") : t("dlg.add"), cur ? function () { removeRec("mk", cur.id); } : null);
    if (cur && key) form.querySelector(".dlg-btn.danger").textContent = t("dlg.unset");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (label && !C.cleanText(label.value, C.LIM.text)) { showToast(t("toast.bad")); label.focus(); return; }
      if (!C.validDay(day.value) || day.value > todayKey()) { showToast(t("toast.bad")); day.focus(); return; }
      var rec = { t: type, d: day.value, nt: nt.value };
      if (key) { rec.key = key; rec.id = C.msId(kidId(), key); }
      else { rec.tx = label.value; rec.id = cur ? cur.id : ""; }
      dlg.close();
      saveRec("mk", C.normMk, rec);
    });
    dlg.appendChild(form);
    openDialog(dlg, label || day);
  }

  // ---------- 11. Dialogs: settings, export, summary ----------
  function settingsDialog() {
    var p = data.prefs;
    var dlg = makeDialog("bb-settings", t("dlg.settings"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("h3", "dlg-h first", t("set.units")));
    var wu = seg([["kg", "kg"], ["lb", "lb / oz"]], p.wu);
    var tu = seg([["c", "°C"], ["f", "°F"]], p.tu);
    var vu = seg([["ml", "ml"], ["oz", "fl oz"]], p.vu);
    form.appendChild(segField(t("set.wu"), wu));
    form.appendChild(segField(t("set.tu"), tu));
    form.appendChild(segField(t("set.vu"), vu));
    var rem = readRem();
    form.appendChild(el("h3", "dlg-h", t("set.rem")));
    var feedSel = el("select");
    [0].concat(C.REM_FEED).forEach(function (m) {
      var o = el("option", "", m ? t("set.remAfter", { x: remHours(m) }) : t("set.remOff"));
      o.value = String(m);
      if (m === rem.feed) o.selected = true;
      feedSel.appendChild(o);
    });
    form.appendChild(field(t("set.remFeed"), feedSel));
    var medRow = el("div", "fld-row");
    var medAt = el("input");
    medAt.type = "time";
    medAt.value = rem.med;
    var medName = textInput(rem.mt, C.LIM.name);
    medName.autocomplete = "off";
    medRow.appendChild(field(t("set.remMed"), medAt));
    medRow.appendChild(field(t("set.remMedName"), medName));
    form.appendChild(medRow);
    form.appendChild(el("p", "hint", t("set.remMedHint")));
    form.appendChild(el("p", "hint", t("set.remNote")));
    form.appendChild(el("h3", "dlg-h", t("set.data")));
    var k = kid();
    if (k) form.appendChild(button(t("set.summary"), "block", function () { dlg.close(); summaryDialog(); }));
    form.appendChild(button(t("set.csv"), "block", function () { exportText(C.toCsv(data), "log", "csv"); }));
    form.appendChild(button(t("set.gcsv"), "block", function () { exportText(C.growthCsv(data), "growth", "csv"); }));
    form.appendChild(button(t("set.backup"), "block", backup));
    form.appendChild(button(t("set.restore"), "block", function () { dlg.close(); restore(); }));
    form.appendChild(el("p", "hint", t("set.restoreNote")));
    form.appendChild(el("p", "hint note", t("set.note")));
    actions(form, dlg, t("dlg.save"), null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setPrefs({ wu: wu.get(), tu: tu.get(), vu: vu.get() });
      writeRem({ feed: parseInt(feedSel.value, 10), med: String(medAt.value).slice(0, 5), mt: medName.value });
      dlg.close();
      renderAll();
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    openDialog(dlg, null);
  }

  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function saveBlob(blob, name, mime, ext) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      var acc = {};
      acc[mime] = ["." + ext];
      host.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function exportText(text, what, ext) {
    if (text.split("\r\n").length <= 2 && ext === "csv") { showToast(t("toast.nothing")); return; }
    var mime = ext === "csv" ? "text/csv" : "text/plain";
    saveBlob(new Blob([text], { type: mime }), "oros-baby-" + what + "-" + todayKey() + "." + ext, mime, ext);
  }
  function backup() {
    var payload = { app: "oros-baby", ver: C.DATA_VER, exported: new Date().toISOString(), data: C.normalize(data) };
    saveBlob(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }),
      "oros-baby-backup-" + todayKey() + ".json", "application/json", "json");
  }
  function localPick(accept) {
    return new Promise(function (res) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.addEventListener("change", function () { res(inp.files && inp.files[0] || null); });
      inp.addEventListener("cancel", function () { res(null); });
      inp.click();
    });
  }
  // A restore is a merge through the sync merge: it can add records
  // or bring newer versions, never remove what is here.
  function restore() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(".json,application/json") : localPick(".json,application/json");
    pick.then(function (file) {
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result)); } catch (e) {}
        if (!obj || obj.app !== "oros-baby" || !C.looksLikeData(obj.data)) { showToast(t("toast.badFile")); return; }
        var before = C.normalize(data);
        var merged = C.mergeBaby(before, obj.data);
        var n = 0;
        ["kids", "ev", "gr", "mk"].forEach(function (f) {
          var idx = {};
          before[f].forEach(function (x) { idx[x.id] = JSON.stringify(x); });
          merged[f].forEach(function (x) { if (idx[x.id] !== JSON.stringify(x)) n++; });
        });
        if (JSON.stringify(before.prefs) !== JSON.stringify(merged.prefs)) n++;
        if (!n) { showToast(t("toast.same")); return; }
        data = merged;
        saveNow();
        renderAll();
        showToast(t("toast.restored", { n: n }));
      };
      fr.readAsText(file);
    });
  }

  function summaryDialog() {
    var k = kid();
    if (!k) return;
    var text = C.summary(data, k.id, todayKey(), LANG, Date.now());
    var dlg = makeDialog("bb-sum", t("sum.title"));
    dlg.classList.add("wide");
    var ta = el("textarea", "sum-text");
    ta.readOnly = true;
    ta.value = text;
    ta.rows = 14;
    ta.setAttribute("aria-label", t("sum.title"));
    dlg.appendChild(ta);
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("sum.copy"), "", function () {
      var done = function () { showToast(t("toast.copied")); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { ta.select(); }); return; }
      } catch (e) {}
      ta.select();
    }));
    if (navigator.share) {
      acts.appendChild(button(t("sum.share"), "", function () {
        try { navigator.share({ title: k.n, text: text }).catch(function () {}); } catch (e) {}
      }));
    }
    acts.appendChild(button(t("sum.save"), "", function () { exportText(text, "summary", "txt"); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, null);
  }

  // ---------- 12. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "baby", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null, undoFn = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    undoFn = onUndo || null;
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", runUndo);
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); undoFn = null; }, onUndo ? 8000 : 4000);
  }
  function runUndo() {
    var fn = undoFn;
    undoFn = null;
    $("toast").classList.remove("show");
    clearTimeout(toastTimer);
    if (fn) fn();
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

  // ---------- 13. Keyboard ----------
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
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (undoFn) { e.preventDefault(); runUndo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !kid()) return;
      var n = "1234".indexOf(e.key);
      if (n >= 0) { e.preventDefault(); goTab(TABS[n]); return; }
      if (view.tab === "hist" && tag !== "BUTTON") {
        if (e.key === "ArrowLeft") { e.preventDefault(); shiftDay(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); shiftDay(1); }
      }
    });
  }

  // ---------- 14. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  // Night view: near-black with dim warm text, easy on eyes in the dark.
  var NIGHT = {
    "--bg": "#050302", "--bg-desktop": "#050302", "--bar-bg": "rgba(8, 5, 3, 0.96)",
    "--text": "#c98a6a", "--text-dim": "#7a5442",
    "--accent": "#c4623e", "--accent-hover": "#d97650", "--accent-soft": "rgba(196, 98, 62, 0.18)",
    "--panel-bg": "#110906", "--border": "#2a1810", "--shadow": "rgba(0, 0, 0, 0.7)", "--danger": "#b5523f"
  };

  function inheritPalette() {
    var root = document.documentElement;
    PAL_VARS.forEach(function (v) { root.style.removeProperty(v); });
    try {
      var pRoot = window.parent.document.documentElement;
      root.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) root.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
    root.classList.toggle("night", !!view.night);
    if (view.night) {
      root.setAttribute("data-theme", "dark");
      Object.keys(NIGHT).forEach(function (v) { root.style.setProperty(v, NIGHT[v]); });
    }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }
  function toggleNight() {
    view.night = view.night ? 0 : 1;
    saveView();
    inheritPalette();
    renderToolbar();
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
    api.registerSlice("baby", sliceGet, sliceSet, STORAGE_KEY, C.mergeBaby);
  }
  function sliceGet() {
    return C.normalize(data);   // canonical copy (R26)
  }
  function sliceSet(incoming) {
    if (!C.looksLikeData(incoming)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeBaby(data, incoming);    // local edits are already on disk; the merge keeps them
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    renderAll();        // dialogs read the latest record on submit
  }

  // ---------- 15. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    function iconBtn(id, svg, label) {
      var b = $(id);
      b.innerHTML = svg;
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    iconBtn("prev-btn", UI.left, t("prev"));
    iconBtn("next-btn", UI.right, t("nextDay"));
    iconBtn("set-btn", UI.gear, t("settings"));
    iconBtn("night-btn", UI.moon, t("night.off"));
    $("welcome-ico").innerHTML = UI.bottle;
    $("day-btn").title = t("today");
  }

  function wire() {
    $("kid-btn").addEventListener("click", kidsDialog);
    $("night-btn").addEventListener("click", toggleNight);
    $("set-btn").addEventListener("click", settingsDialog);
    $("welcome-add").addEventListener("click", function () { kidDialog(null); });
    $("prev-btn").addEventListener("click", function () { shiftDay(-1); });
    $("next-btn").addEventListener("click", function () { shiftDay(1); });
    $("day-btn").addEventListener("click", function () { histDay = todayKey(); renderHist(); });
    $("gr-add").addEventListener("click", function () { growthDialog(null); });
    $("ms-add").addEventListener("click", function () { markDialog("ms", null, null); });
    $("vac-add").addEventListener("click", function () { markDialog("vac", null, null); });
    $("doc-add").addEventListener("click", function () { markDialog("doc", null, null); });
    // Running clocks once a second; "ago" cards and a new day every 30 s.
    setInterval(function () { if (!document.hidden) tickTimers(); }, 1000);
    var lastToday = todayKey();
    setInterval(function () {
      if (document.hidden) return;
      var tk = todayKey();
      if (tk !== lastToday) {
        if (histDay === lastToday) histDay = tk;
        lastToday = tk;
        renderAll();
        return;
      }
      if (view.tab === "today" && kid()) { renderSince(); renderToolbar(); }
    }, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) renderAll(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadView();
    histDay = todayKey();
    applyI18n();
    renderWeekPick();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
  }

  boot();
})();
