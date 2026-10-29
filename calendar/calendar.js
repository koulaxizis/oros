// ============================================================
// orOS Calendar v0.3.0
// Views: Month (Monday-first grid), Week, Agenda, search.
// Event CRUD, labels (color-coded, filterable), start/end times,
// location, multi-day spans (dateEnd), recurrence, reminders.
// Data: localStorage "oros-calendar-data"
//   { ver: 1,
//     labels:  [ { id, name, color, mtime } ],
//     events:  [ { id, date: "YYYY-MM-DD",
//                  dateEnd: "YYYY-MM-DD" | null,  // v0.3: multi-day,
//                                              // plain events only
//                  start: "HH:MM" | null, end: "HH:MM" | null,
//                  title, note, location,
//                  labelId: string | null, mtime } ],
//     deleted: [ { id, mtime } ] }
// v0.1 legacy "time" → "start" at load (zero-loss migration).
// v0.3 legacy: no "dateEnd" → null = single-day (zero-loss).
// Multi-day + recurrence is a deliberate non-goal (see §3b notes):
// combining both opens a combinatorial hole in the occurrence math.
// id + mtime exist from day one for the Part 5 merge sync.
// ============================================================
(function () {
  "use strict";

  /* ---------- 0. Shell palette inheritance (same-origin iframe) ---------- */
  // Function NAMES are load-bearing: bump-version.yml's G3 palette
  // guard greps every app's JS for inheritPalette + watchPalette.
  // Same contract as todo/kanban/notes/weather/mood.
  function inheritPalette() {
    try {
      var pDoc = window.parent.document;
      var pCs = window.parent.getComputedStyle(pDoc.documentElement);
      ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
       "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
        var val = pCs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
      var th = pDoc.documentElement.getAttribute("data-theme");
      if (th) document.documentElement.setAttribute("data-theme", th);
    } catch (e) { /* standalone load — CSS fallbacks apply */ }
  }
  // Live follow: theme/skin changes in the shell reach an OPEN app
  // without a re-open — the observer re-inherits on attribute change.
  function watchPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (typeof MutationObserver !== "function") return;
      new MutationObserver(inheritPalette).observe(pRoot, {
        attributes: true, attributeFilter: ["data-theme", "data-skin"]
      });
    } catch (e) { /* standalone — nothing to watch */ }
  }
  inheritPalette();
  watchPalette();

  /* ---------- 1. i18n ---------- */
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = "en";
  if (window.orosI18n) LANG = window.orosI18n.lang();
  else try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}
  // "el" or "en" for shared modules that pick between two inline texts.
  var LB = LANG === "el" ? "el" : "en";
  // Dates and numbers (de-DE for German, …).
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STR = {
    en: {
      "cal.today": "Today",
      "cal.prev": "Previous month",
      "cal.next": "Next month",
      "cal.export": "Export",
      "cal.stats": "Stats",
      "cal.search.ph": "Search events…",
      "vw.month": "Month",
      "vw.week": "Week",
      "vw.agenda": "Agenda",
      "cal.filters.lbl": "Labels",
      "wd": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      "months": ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"],
      // Weekdays from Sunday, months as in "5 March" (Greek: genitive).
      "wd.full": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      "wd.short": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      "mon.gen": ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"],
      "date.long": "{wd} {d} {m} {y}",
      // Repeat rules: "Every 2 weeks on Mon, Wed, 10 times". {d} = weekday;
      // nthN.* = the same for a Saturday (Greek neuter).
      "rr.D1": "Daily", "rr.Dn": "Every {n} days",
      "rr.W1": "Weekly", "rr.Wn": "Every {n} weeks",
      "rr.M1": "Monthly", "rr.Mn": "Every {n} months",
      "rr.Y1": "Yearly", "rr.Yn": "Every {n} years",
      "rr.days": "{s} on {d}",
      "rr.nth": "{s} on {x}",
      "rr.mday": "{s} on day {n}",
      "rr.ynth": "{s} on {x} of {m}",
      "rr.yday": "{s} on {n} {m}",
      "rr.count1": "{s}, 1 time",
      "rr.countN": "{s}, {n} times",
      "rr.until": "{s}, until {d}",
      "rp.nth": "On {x}",
      "rp.nthm": "On {x} of {m}",
      "rp.yday": "On {n} {m}",
      "nth.1": "the first {d}", "nth.2": "the second {d}", "nth.3": "the third {d}",
      "nth.4": "the fourth {d}", "nth.5": "the fifth {d}", "nth.-1": "the last {d}",
      "nthN.1": "the first {d}", "nthN.2": "the second {d}", "nthN.3": "the third {d}",
      "nthN.4": "the fourth {d}", "nthN.5": "the fifth {d}", "nthN.-1": "the last {d}",
      "day.today": "Today", "wx.day": "Forecast: {t}",
      "ev.add": "Add",
      "ev.dlg.new": "New event",
      "ev.dlg.edit": "Edit event",
      "ev.field.title": "Title",
      "ev.ph.title": "What's happening?",
      "ev.field.when": "Time",
      "ev.ph.start": "Start time…",
      "ev.end.none": "No end",
      "ev.allday": "All day",
      "ev.field.loc": "Location",
      "ev.ph.loc": "Where?",
      "ev.field.note": "Note",
      "ev.ph.note": "Details…",
      "ev.save": "Save",
      "ev.cancel": "Cancel",
      "ev.delete": "Delete event",
      "ev.qr": "QR code",
      "ev.track": "Track time",
      "ev.mail": "Email",
      "ev.share": "Send…",
      "ev.delete.confirm": "Delete this event?",
      "ev.none": "No events",
      "ev.untitled": "(untitled)",
      "ev.alltime": "All day",
      "ev.err.title": "Enter a title first",
      "cal.maps": "Show on map",
      "ev.err.time": "End time must be after start time",
      "ev.err.dateend": "End date must be on or after the start date",
      "ev.del.yes": "Delete",
      "del.done": "Event deleted",
      "undo": "Undo",
      "toast.quota": "Storage is full: changes are not saved on this device",
      "exp.done": "Calendar exported (.ics)",
      "cal.import": "Import",
      "imp.title": "Import events",
      "ph.btn": "On this phone",
      "ph.title": "orOS calendar on this phone",
      "ph.text": "Adds your orOS events, with their reminders, to the phone's Calendar as an \"orOS\" calendar, and the visible feeds as a read-only \"orOS feeds\" one. Events you add or change in the \"orOS\" calendar there come back here when you open orOS.",
      "ph.on": "Show on this phone",
      "ph.what": "events",
      "ph.allow": "Allow access",
      "ph.ask": "Android asks for permission once.",
      "ph.denied": "Android access is off. Allow it from the app's settings.",
      "ph.off": "Not shown on this phone.",
      "ph.wait": "Sending…",
      "ph.last": "Sent {t}: {n} {what}.",
      "ph.err": "Last attempt failed: {e}",
      "ph.close": "Close",
      "imp.sum": "{new} new · {upd} updated · {same} already in the Calendar",
      "imp.simpl": "{n} repeating event(s) use a rule the Calendar does not have: only their first date is imported.",
      "imp.skip": "{n} skipped (cancelled or without a date).",
      "imp.more": "Only the first {n} events are imported.",
      "imp.go": "Import",
      "imp.done": "{n} event(s) imported",
      "imp.none": "No new or changed events in this file",
      "imp.bad": "Could not read that file",
      "imp.big": "That file is too large (5 MB at most)",
      "lbl.personal": "Personal",
      "lbl.work": "Work",
      "lbl.family": "Family",
      "lbl.feed.bday": "Birthdays",
      "lbl.feed.anniv": "Anniversaries",
      "lbl.feed.cycle": "Cycle",
      "lbl.feed.mood": "Mood",
      "lbl.feed.habits": "Habits",
      "lbl.feed.kanban": "Kanban",
      "lbl.feed.todo": "To-Do",
      "lbl.feed.fitness": "Workouts",
      "feed.cycle.period": "Period",
      "feed.mood.entry": "Mood entry",
      "lbl.feed.pet": "Screen Pet",
      "lbl.feed.plants": "Plants",
      "lbl.feed.chores": "Chores",
      "lbl.feed.garage": "Garage",
      "lbl.feed.travel": "Travel",
      "feed.travel.day": "{name} · day {n}/{of}",
      "lbl.feed.meals": "Meals",
      "feed.meals.b": "Breakfast", "feed.meals.l": "Lunch", "feed.meals.d": "Dinner", "feed.meals.s": "Snack", "feed.meals.x": "Extra",
      "lbl.feed.budget": "Budget",
      "lbl.feed.shelf": "Media Shelf", "lbl.feed.publish": "Publishing",
      "lbl.feed.inv": "Invoices", "feed.inv.due": "{n} due · {a}",
      "feed.garage.exp": "{vehicle}: {what} expires",
      "feed.garage.expired": "{vehicle}: {what} expired",
      "feed.garage.svc": "{vehicle}: {what} due",
      "feed.garage.kteo": "KTEO", "feed.garage.ins": "insurance", "feed.garage.tax": "road tax",
      "feed.garage.kek": "emissions card", "feed.garage.road": "roadside assistance",
      "feed.garage.lic": "driving licence", "feed.garage.other": "renewal", "feed.garage.service": "service",
      "feed.plants.done": "{name}: {kind} done",
      "feed.plants.due": "{name}: {kind} due",
      "feed.plants.water": "watering", "feed.plants.fert": "fertilizing", "feed.plants.mist": "misting", "feed.plants.repot": "repotting",
      "lbl.feed.petcare": "Pet health",
      "lbl.feed.baby": "Baby", "lbl.feed.together": "Together",
      "feed.pc.due": "{name}: {what} due", "feed.pc.done": "{name}: {what}", "feed.pc.bday": "🎂 {name} turns {n}",
      "feed.pc.deworm": "deworming", "feed.pc.visit": "vet visit", "feed.pc.recheck": "recheck",
      "feed.pc.medDue": "{name}: last day of {what}", "feed.pc.food": "food runs out",
      "feed.pc.care.bath": "bath", "feed.pc.care.nails": "nail trim", "feed.pc.care.brush": "brushing",
      "feed.pc.care.teeth": "teeth", "feed.pc.care.ears": "ear cleaning", "feed.pc.care.litter": "litter change",
      "feed.pc.care.cage": "cage cleaning", "feed.pc.care.tank": "tank water change",
      "feed.pet.feed": "{name} was fed",
      "feed.pet.pet": "{name} was petted",
      "feed.pet.sleep": "{name} went to sleep",
      "feed.pet.wake": "{name} woke up",
      "feed.pet.newpet": "{name} joined the family",
      "feed.pet.catch": "{name} caught the ball",
      "feed.pet.bday": "{name}'s birthday",
      "lbl.feed.custom": "Custom Feed",
      "lbl.feed.hol": "Holidays",
      "lbl.feed.nameday": "Name days",
      "lbl.feed.obs": "World days",
      "lbl.feed.time": "Work time",
      "lbl.feed.sky": "Moon & Sky",
      "lbl.feed.famtree": "Death anniversaries",
      "lbl.feed.crm": "Customers",
      "lbl.feed.meds": "Medicines",
      "lbl.feed.appts": "Doctor visits",
      "feed.ap.vx": "{name}: vaccine dose due",
      "feed.md.start": "{name}: first day", "feed.md.end": "{name}: last day", "feed.md.out": "{name}: runs out",
      "feed.crm.late": "Late",
      "feed.crm.close": "Expected close",
      "feed.famtree.one": "{name} · 1 year since death",
      "feed.famtree.n": "{name} · {n} years since death",
      "feed.time.noproj": "No project",
      "nd.line": "Name days:",
      "nd.contact": "{name}: name day",
      "nd.more": "+{n} more",
      "lbl.feeds": "App feeds",
      "hh.head": "Shared with a household",
      "hh.share": "Share with a household",
      "hh.go": "Share",
      "hh.stop": "Stop sharing",
      "hh.del": "Delete shared calendar",
      "hh.in": "Shared in {hh}",
      "hh.by": "Last changed by {n}",
      "hh.none": "Share a label with the house icon: everyone in the household sees and edits its events.",
      "hh.nohh": "Create or join a household first, in the Household app.",
      "hh.open": "Open Household",
      "hh.share.text": "Everyone in the household will see and edit the events of “{n}”. Reminders stay yours.",
      "hh.stop.text": "“{n}” leaves {hh} for everyone, and you keep your own copy. The others can bring it back from Household for 30 days.",
      "hh.del.text": "“{n}” leaves {hh} for everyone, and you keep no copy. The others can bring it back from Household for 30 days.",
      "hh.loose": "Share the events with no label",
      "hh.loose.n": "Events: {c}",
      "hh.loose.text": "Your {c} events with no label go into a new calendar with this name, shared with the household: everyone there sees and edits them. Reminders stay yours. Stop sharing gives them back to you as a label.",
      "hh.loose.name": "Name of the shared calendar",
      "hh.loose.def": "Home",
      "hh.shared": "Shared with {hh}",
      "hh.stopped": "Sharing stopped. Your own copy is in your labels.",
      "hh.deleted": "Shared calendar deleted",
      "hh.fail": "Could not reach the household. Try again.",
      "lbl.feed.ro": "Read-only — managed by its app",
      "lbl.manage": "Manage labels",
      "lbl.acts": "Quick filters",
      "lbl.f.all": "All",
      "lbl.f.all.hint": "Show every chip (Moon & Sky, Medicines and Doctor visits stay as they are)",
      "lbl.f.none": "None",
      "lbl.f.none.hint": "Hide every chip, then turn on only the ones you want",
      "lbl.f.mine": "My events",
      "lbl.f.mine.hint": "Only your own events: every label and No label, no feeds",
      "lbl.chip.hint": "Click: show or hide. Right-click, Alt+click or long press: only this one (again: all)",
      "lbl.toggle": "Labels & feeds",
      "lbl.toggle.n": "{on} of {all} on",
      "lbl.new": "New label",
      "lbl.ph.name": "Name…",
      "lbl.color": "Color",
      "lbl.done": "Done",
      "lbl.delete": "Delete",
      "lbl.inuse": "This label is used by events",
      "lbl.none": "No label",
      "lbl.empty": "No labels yet",
      "ev.field.repeat": "Repeat",
      "rep.none": "Does not repeat",
      "rep.custom": "Custom…",
      "rep.weeklyOn": "Weekly on {d}",
      "rep.weekdays": "Every weekday (Mon–Fri)",
      "rep.every": "Every",
      "rep.u.D": "days",
      "rep.u.W": "weeks",
      "rep.u.M": "months",
      "rep.u.Y": "years",
      "rep.onDay": "On day {n}",
      "rep.ends": "Repeat ends",
      "rep.ends.never": "Never",
      "rep.ends.on": "On a date",
      "rep.ends.n": "After",
      "rep.times": "times",
      "ev.field.date": "Starts on (day)",
      "ev.field.tz": "Time zone",
      "tz.device": "This device ({z})",
      "ev.err.date": "Pick the day it starts",
      "ser.move.q": "Move this occurrence or the whole series?",
      "vw.day": "Day",
      "vw.year": "Year",
      "ev.field.dateend": "Ends on (day)",
      "ev.cont": "Day {a} of {b}",
      "ev.field.remind": "Reminder",
      "rem.none": "None",
      "rem.min": "{n} min before",
      "rem.hour": "{n} h before",
      "rem.day": "{n} day(s) before",
      "ser.edit.q": "Edit this occurrence or the whole series?",
      "ser.this": "This occurrence",
      "ser.all": "Entire series",
      "remind.toast": "Reminder",
      "ev.moved": "Moved",
      "srch.empty": "No events found",
      "ag.more": "Show more",
      "ag.empty": "Nothing scheduled in the next 30 days",
      "stat.title": "Statistics",
      "stat.kpi.total": "Events",
      "stat.kpi.upcoming": "Next 30 days",
      "stat.kpi.recurring": "Recurring",
      "stat.byLabel": "Events by label",
      "stat.perMonth": "{n} events stored"
    },
    el: {
      "cal.today": "Σήμερα",
      "cal.prev": "Προηγούμενος μήνας",
      "cal.next": "Επόμενος μήνας",
      "cal.export": "Εξαγωγή",
      "cal.stats": "Στατιστικά",
      "cal.search.ph": "Αναζήτηση συμβάντων…",
      "vw.month": "Μήνας",
      "vw.week": "Εβδομάδα",
      "vw.agenda": "Ατζέντα",
      "cal.filters.lbl": "Ετικέτες",
      "wd": ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"],
      "months": ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος",
                 "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος",
                 "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"],
      "wd.full": ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"],
      "wd.short": ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"],
      "mon.gen": ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου",
                  "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"],
      "date.long": "{wd} {d} {m} {y}",
      "rr.D1": "Καθημερινά", "rr.Dn": "Κάθε {n} ημέρες",
      "rr.W1": "Εβδομαδιαία", "rr.Wn": "Κάθε {n} εβδομάδες",
      "rr.M1": "Μηνιαία", "rr.Mn": "Κάθε {n} μήνες",
      "rr.Y1": "Ετήσια", "rr.Yn": "Κάθε {n} χρόνια",
      "rr.days": "{s}: {d}",
      "rr.nth": "{s}, {x}",
      "rr.mday": "{s}, στις {n}",
      "rr.ynth": "{s}, {x} του {m}",
      "rr.yday": "{s}, στις {n} {m}",
      "rr.count1": "{s}, 1 φορά",
      "rr.countN": "{s}, {n} φορές",
      "rr.until": "{s}, έως {d}",
      "rp.nth": "{x}",
      "rp.nthm": "{x} του {m}",
      "rp.yday": "Στις {n} {m}",
      "nth.1": "την πρώτη {d}", "nth.2": "τη δεύτερη {d}", "nth.3": "την τρίτη {d}",
      "nth.4": "την τέταρτη {d}", "nth.5": "την πέμπτη {d}", "nth.-1": "την τελευταία {d}",
      "nthN.1": "το πρώτο {d}", "nthN.2": "το δεύτερο {d}", "nthN.3": "το τρίτο {d}",
      "nthN.4": "το τέταρτο {d}", "nthN.5": "το πέμπτο {d}", "nthN.-1": "το τελευταίο {d}",
      "day.today": "Σήμερα", "wx.day": "Πρόγνωση: {t}",
      "ev.add": "Προσθήκη",
      "ev.dlg.new": "Νέο συμβάν",
      "ev.dlg.edit": "Επεξεργασία συμβάντος",
      "ev.field.title": "Τίτλος",
      "ev.ph.title": "Τι συμβαίνει;",
      "ev.field.when": "Ώρα",
      "ev.ph.start": "Ώρα έναρξης…",
      "ev.end.none": "Χωρίς λήξη",
      "ev.allday": "Όλη μέρα",
      "ev.field.loc": "Τοποθεσία",
      "ev.ph.loc": "Πού;",
      "ev.field.note": "Σημείωση",
      "ev.ph.note": "Λεπτομέρειες…",
      "ev.save": "Αποθήκευση",
      "ev.cancel": "Άκυρο",
      "ev.delete": "Διαγραφή συμβάντος",
      "ev.qr": "Κωδικός QR",
      "ev.track": "Χρονομέτρηση",
      "ev.mail": "Email",
      "ev.share": "Αποστολή…",
      "ev.delete.confirm": "Να διαγραφεί αυτό το συμβάν;",
      "ev.none": "Κανένα συμβάν",
      "ev.untitled": "(χωρίς τίτλο)",
      "ev.alltime": "Όλη μέρα",
      "ev.err.title": "Δώσε πρώτα έναν τίτλο",
      "cal.maps": "Εμφάνιση στον χάρτη",
      "ev.err.time": "Η ώρα λήξης πρέπει να είναι μετά την έναρξη",
      "ev.err.dateend": "Η ημερομηνία λήξης πρέπει να είναι ίδια ή μετά την έναρξη",
      "ev.del.yes": "Διαγραφή",
      "del.done": "Το συμβάν διαγράφηκε",
      "undo": "Αναίρεση",
      "toast.quota": "Ο χώρος αποθήκευσης γέμισε: οι αλλαγές δεν αποθηκεύονται σε αυτή τη συσκευή",
      "exp.done": "Το ημερολόγιο εξήχθη (.ics)",
      "cal.import": "Εισαγωγή",
      "imp.title": "Εισαγωγή συμβάντων",
      "ph.btn": "Στο κινητό",
      "ph.title": "Το ημερολόγιο του orOS στο κινητό",
      "ph.text": "Βάζει τα συμβάντα του orOS, με τις υπενθυμίσεις τους, στο Ημερολόγιο του κινητού ως ημερολόγιο \"orOS\", και τις ορατές ροές ως \"orOS ροές\", μόνο για ανάγνωση. Ό,τι προσθέτεις ή αλλάζεις εκεί στο ημερολόγιο \"orOS\" έρχεται εδώ όταν ανοίγεις το orOS.",
      "ph.on": "Εμφάνιση στο κινητό",
      "ph.what": "συμβάντα",
      "ph.allow": "Να επιτραπεί",
      "ph.ask": "Το Android ζητά άδεια μία φορά.",
      "ph.denied": "Η πρόσβαση στο Android είναι κλειστή. Άνοιξέ την από τις ρυθμίσεις της εφαρμογής.",
      "ph.off": "Δεν εμφανίζονται στο κινητό.",
      "ph.wait": "Αποστολή…",
      "ph.last": "Στάλθηκαν {t}: {n} {what}.",
      "ph.err": "Η τελευταία προσπάθεια απέτυχε: {e}",
      "ph.close": "Κλείσιμο",
      "imp.sum": "{new} νέα · {upd} ενημερωμένα · {same} υπάρχουν ήδη στο Ημερολόγιο",
      "imp.simpl": "{n} επαναλαμβανόμενο/α συμβάν/τα έχουν κανόνα που δεν υποστηρίζει το Ημερολόγιο: εισάγεται μόνο η πρώτη ημερομηνία.",
      "imp.skip": "{n} παραλείφθηκαν (ακυρωμένα ή χωρίς ημερομηνία).",
      "imp.more": "Εισάγονται μόνο τα πρώτα {n} συμβάντα.",
      "imp.go": "Εισαγωγή",
      "imp.done": "Εισήχθησαν {n} συμβάν/τα",
      "imp.none": "Δεν υπάρχουν νέα ή αλλαγμένα συμβάντα σε αυτό το αρχείο",
      "imp.bad": "Το αρχείο δεν μπόρεσε να διαβαστεί",
      "imp.big": "Το αρχείο είναι πολύ μεγάλο (έως 5 MB)",
      "lbl.personal": "Προσωπικό",
      "lbl.work": "Εργασία",
      "lbl.family": "Οικογένεια",
      "lbl.feed.bday": "Γενέθλια",
      "lbl.feed.anniv": "Επέτειοι",
      "lbl.feed.cycle": "Κύκλος",
      "lbl.feed.mood": "Διάθεση",
      "lbl.feed.habits": "Συνήθειες",
      "lbl.feed.kanban": "Kanban",
      "lbl.feed.todo": "Εργασίες",
      "lbl.feed.fitness": "Προπόνηση",
      "feed.cycle.period": "Περίοδος",
      "feed.mood.entry": "Καταγραφή διάθεσης",
      "lbl.feed.pet": "Συντροφάκι",
      "lbl.feed.plants": "Φυτά",
      "lbl.feed.chores": "Δουλειές",
      "lbl.feed.garage": "Γκαράζ",
      "lbl.feed.travel": "Ταξίδια",
      "feed.travel.day": "{name} · μέρα {n}/{of}",
      "lbl.feed.meals": "Γεύματα",
      "feed.meals.b": "Πρωινό", "feed.meals.l": "Μεσημεριανό", "feed.meals.d": "Βραδινό", "feed.meals.s": "Σνακ", "feed.meals.x": "Άλλο",
      "lbl.feed.budget": "Προϋπολογισμός",
      "lbl.feed.shelf": "Το ράφι μου", "lbl.feed.publish": "Εκδόσεις",
      "lbl.feed.inv": "Τιμολόγια", "feed.inv.due": "Λήγει το {n} · {a}",
      "feed.garage.exp": "{vehicle}: λήγει {what}",
      "feed.garage.expired": "{vehicle}: έληξε {what}",
      "feed.garage.svc": "{vehicle}: σέρβις ({what})",
      "feed.garage.kteo": "ΚΤΕΟ", "feed.garage.ins": "ασφάλεια", "feed.garage.tax": "τέλη κυκλοφορίας",
      "feed.garage.kek": "κάρτα καυσαερίων", "feed.garage.road": "οδική βοήθεια",
      "feed.garage.lic": "δίπλωμα οδήγησης", "feed.garage.other": "ανανέωση", "feed.garage.service": "σέρβις",
      "feed.plants.done": "{name}: έγινε {kind}",
      "feed.plants.due": "{name}: ώρα για {kind}",
      "feed.plants.water": "πότισμα", "feed.plants.fert": "λίπανση", "feed.plants.mist": "ψέκασμα", "feed.plants.repot": "μεταφύτευση",
      "lbl.feed.petcare": "Υγεία ζώων",
      "lbl.feed.baby": "Μωρό", "lbl.feed.together": "Μαζί",
      "feed.pc.due": "{name}: ώρα για {what}", "feed.pc.done": "{name}: {what}", "feed.pc.bday": "🎂 {name}: γενέθλια ({n})",
      "feed.pc.deworm": "αποπαρασίτωση", "feed.pc.visit": "επίσκεψη στον κτηνίατρο", "feed.pc.recheck": "επανεξέταση",
      "feed.pc.medDue": "{name}: τελευταία μέρα για {what}", "feed.pc.food": "νέο σακί τροφής",
      "feed.pc.care.bath": "μπάνιο", "feed.pc.care.nails": "κόψιμο νυχιών", "feed.pc.care.brush": "βούρτσισμα",
      "feed.pc.care.teeth": "δόντια", "feed.pc.care.ears": "καθάρισμα αυτιών", "feed.pc.care.litter": "αλλαγή άμμου",
      "feed.pc.care.cage": "καθάρισμα κλουβιού", "feed.pc.care.tank": "αλλαγή νερού ενυδρείου",
      "feed.pet.feed": "{name} ταΐστηκε",
      "feed.pet.pet": "{name} χαϊδεύτηκε",
      "feed.pet.sleep": "{name} πήγε για ύπνο",
      "feed.pet.wake": "{name} ξύπνησε",
      "feed.pet.newpet": "{name} ήρθε στην οικογένεια",
      "feed.pet.catch": "{name} έπιασε την μπάλα",
      "feed.pet.bday": "Γενέθλια του/της {name}",
      "lbl.feed.custom": "Προσαρμοσμένο Feed",
      "lbl.feed.hol": "Αργίες",
      "lbl.feed.nameday": "Ονομαστικές εορτές",
      "lbl.feed.obs": "Παγκόσμιες ημέρες",
      "lbl.feed.time": "Ώρες εργασίας",
      "lbl.feed.sky": "Σελήνη & Ουρανός",
      "lbl.feed.famtree": "Επέτειοι θανάτου",
      "lbl.feed.crm": "Πελάτες",
      "lbl.feed.meds": "Φάρμακα",
      "lbl.feed.appts": "Ιατρικά ραντεβού",
      "feed.ap.vx": "{name}: δόση εμβολίου",
      "feed.md.start": "{name}: πρώτη μέρα", "feed.md.end": "{name}: τελευταία μέρα", "feed.md.out": "{name}: τελειώνει",
      "feed.crm.late": "Καθυστερεί",
      "feed.crm.close": "Αναμένεται κλείσιμο",
      "feed.famtree.one": "{name} · 1 χρόνος από τον θάνατο",
      "feed.famtree.n": "{name} · {n} χρόνια από τον θάνατο",
      "feed.time.noproj": "Χωρίς έργο",
      "nd.line": "Γιορτάζουν:",
      "nd.contact": "Γιορτάζει: {name}",
      "nd.more": "+{n} ακόμη",
      "lbl.feeds": "Ροές εφαρμογών",
      "hh.head": "Κοινά με νοικοκυριό",
      "hh.share": "Κοινή χρήση με νοικοκυριό",
      "hh.go": "Κοινή χρήση",
      "hh.stop": "Διακοπή κοινής χρήσης",
      "hh.del": "Διαγραφή κοινού ημερολογίου",
      "hh.in": "Κοινό στο «{hh}»",
      "hh.by": "Τελευταία αλλαγή: {n}",
      "hh.none": "Μοιράσου μια ετικέτα με το εικονίδιο του σπιτιού: όλοι στο νοικοκυριό βλέπουν και αλλάζουν τα συμβάντα της.",
      "hh.nohh": "Φτιάξε πρώτα ένα νοικοκυριό ή μπες σε ένα, από την εφαρμογή Νοικοκυριό.",
      "hh.open": "Άνοιγμα Νοικοκυριού",
      "hh.share.text": "Όλοι στο νοικοκυριό θα βλέπουν και θα αλλάζουν τα συμβάντα της ετικέτας «{n}». Οι υπενθυμίσεις μένουν δικές σου.",
      "hh.stop.text": "Η «{n}» φεύγει από το «{hh}» για όλους και εσύ κρατάς δικό σου αντίγραφο. Οι άλλοι μπορούν να τη φέρουν πίσω από το Νοικοκυριό για 30 ημέρες.",
      "hh.del.text": "Η «{n}» φεύγει από το «{hh}» για όλους και εσύ δεν κρατάς αντίγραφο. Οι άλλοι μπορούν να τη φέρουν πίσω από το Νοικοκυριό για 30 ημέρες.",
      "hh.loose": "Μοιράσου τα συμβάντα χωρίς ετικέτα",
      "hh.loose.n": "Συμβάντα: {c}",
      "hh.loose.text": "Τα {c} συμβάντα σου χωρίς ετικέτα μπαίνουν σε ένα νέο ημερολόγιο με αυτό το όνομα, κοινό με το νοικοκυριό: όλοι εκεί τα βλέπουν και τα αλλάζουν. Οι υπενθυμίσεις μένουν δικές σου. Με τη διακοπή της κοινής χρήσης σού επιστρέφονται ως ετικέτα.",
      "hh.loose.name": "Όνομα του κοινού ημερολογίου",
      "hh.loose.def": "Σπίτι",
      "hh.shared": "Κοινό με «{hh}»",
      "hh.stopped": "Η κοινή χρήση σταμάτησε. Το αντίγραφό σου είναι στις ετικέτες σου.",
      "hh.deleted": "Το κοινό ημερολόγιο διαγράφηκε",
      "hh.fail": "Δεν έγινε σύνδεση με το νοικοκυριό. Δοκίμασε ξανά.",
      "lbl.feed.ro": "Μόνο ανάγνωση — διαχειρίζεται η εφαρμογή της",
      "lbl.manage": "Διαχείριση ετικετών",
      "lbl.acts": "Γρήγορα φίλτρα",
      "lbl.f.all": "Όλα",
      "lbl.f.all.hint": "Εμφάνιση όλων των ταμπελακιών (τα Σελήνη & Ουρανός, Φάρμακα και Ιατρικά ραντεβού μένουν όπως είναι)",
      "lbl.f.none": "Κανένα",
      "lbl.f.none.hint": "Απόκρυψη όλων των ταμπελακιών, και μετά άναψε μόνο όσα θέλεις",
      "lbl.f.mine": "Τα δικά μου",
      "lbl.f.mine.hint": "Μόνο τα δικά σου συμβάντα: όλες οι ετικέτες και το Χωρίς ετικέτα, χωρίς ροές",
      "lbl.chip.hint": "Κλικ: εμφάνιση ή απόκρυψη. Δεξί κλικ, Alt+κλικ ή παρατεταμένο πάτημα: μόνο αυτό (ξανά: όλα)",
      "lbl.toggle": "Ετικέτες & ροές",
      "lbl.toggle.n": "{on} από {all} ενεργές",
      "lbl.new": "Νέα ετικέτα",
      "lbl.ph.name": "Όνομα…",
      "lbl.color": "Χρώμα",
      "lbl.done": "Τέλος",
      "lbl.delete": "Διαγραφή",
      "lbl.inuse": "Η ετικέτα χρησιμοποιείται από συμβάντα",
      "lbl.none": "Χωρίς ετικέτα",
      "lbl.empty": "Δεν υπάρχουν ετικέτες ακόμα",
      "ev.field.repeat": "Επανάληψη",
      "rep.none": "Χωρίς επανάληψη",
      "rep.custom": "Προσαρμογή…",
      "rep.weeklyOn": "Κάθε εβδομάδα, {d}",
      "rep.weekdays": "Κάθε εργάσιμη (Δευ–Παρ)",
      "rep.every": "Κάθε",
      "rep.u.D": "ημέρες",
      "rep.u.W": "εβδομάδες",
      "rep.u.M": "μήνες",
      "rep.u.Y": "χρόνια",
      "rep.onDay": "Στις {n} του μήνα",
      "rep.ends": "Τέλος επανάληψης",
      "rep.ends.never": "Ποτέ",
      "rep.ends.on": "Σε ημερομηνία",
      "rep.ends.n": "Μετά από",
      "rep.times": "φορές",
      "ev.field.date": "Έναρξη (ημέρα)",
      "ev.field.tz": "Ζώνη ώρας",
      "tz.device": "Αυτή η συσκευή ({z})",
      "ev.err.date": "Διάλεξε τη μέρα έναρξης",
      "ser.move.q": "Να μετακινηθεί αυτή η εμφάνιση ή όλη η σειρά;",
      "vw.day": "Ημέρα",
      "vw.year": "Έτος",
      "ev.field.dateend": "Λήξη (ημέρα)",
      "ev.cont": "Ημέρα {a} από {b}",
      "ev.field.remind": "Υπενθύμιση",
      "rem.none": "Καμία",
      "rem.min": "{n} λεπτά πριν",
      "rem.hour": "{n} ώρες πριν",
      "rem.day": "{n} μέρες πριν",
      "ser.edit.q": "Να επεξεργαστείς αυτή την εμφάνιση ή όλη τη σειρά;",
      "ser.this": "Αυτή η εμφάνιση",
      "ser.all": "Όλη η σειρά",
      "remind.toast": "Υπενθύμιση",
      "ev.moved": "Μετακινήθηκε",
      "srch.empty": "Κανένα αποτέλεσμα",
      "ag.more": "Περισσότερα",
      "ag.empty": "Τίποτα προγραμματισμένο τις επόμενες 30 μέρες",
      "stat.title": "Στατιστικά",
      "stat.kpi.total": "Συμβάντα",
      "stat.kpi.upcoming": "Επόμενες 30 μέρες",
      "stat.kpi.recurring": "Επαναλαμβανόμενα",
      "stat.byLabel": "Συμβάντα ανά ετικέτα",
      "stat.perMonth": "{n} συμβάντα αποθηκευμένα"
    }
  };

  // Wave 8 strings (quick add, subscriptions, free times, print).
  (function (more) {
    ["en", "el"].forEach(function (l) {
      Object.keys(more[l]).forEach(function (k) { STR[l][k] = more[l][k]; });
    });
  })({
    en: {
      "cal.more": "More",
      "mm.subs": "Subscribe to a calendar…",
      "mm.free": "Share free times…",
      "mm.print": "Print…",
      "mm.names": "Event names in Month",
      "mm.names.short": "Names",
      "qa.btn": "Quick add",
      "qa.title": "Quick add",
      "qa.ph": "e.g. Coffee with Nikos Thursday 6pm at Syntagma",
      "qa.hint": "Write it the way you'd say it: what, when, and \"at\" where. You check it in the event window before saving.",
      "qa.go": "Continue",
      "qa.what": "What", "qa.when": "When", "qa.rep": "Repeats", "qa.where": "Where",
      "qa.allday": "all day",
      "subs.title": "Subscribed calendars",
      "subs.text": "Paste the address of a calendar that is published as .ics (webcal:// or https://): a team calendar, school holidays, fixtures. Its events show read-only with their own chip and refresh by themselves.",
      "subs.url": "Calendar address",
      "subs.url.ph": "webcal://… or https://….ics",
      "subs.name": "Name (optional)",
      "subs.name.ph": "Its own name",
      "subs.add": "Subscribe",
      "subs.none": "No subscriptions yet.",
      "subs.refresh": "Refresh",
      "subs.remove": "Remove",
      "subs.removed": "Subscription removed",
      "subs.color": "Change colour",
      "subs.bad": "That doesn't look like a calendar address (webcal:// or https://).",
      "subs.dup": "You're already subscribed to that calendar.",
      "subs.wait": "Reading the calendar…",
      "subs.ok": "{n} events · updated {t}",
      "subs.never": "Not read yet",
      "subs.more": "{n} more left out (oldest first)",
      "subs.err.offline": "You're offline. The last copy is shown.",
      "subs.err.norelay": "This calendar's server doesn't let a browser read it directly. It needs the orOS relay: set its address in Mail or in the Reader's Settings.",
      "subs.err.http": "The server answered with an error ({n}).",
      "subs.err.notics": "That address didn't return a calendar (.ics).",
      "subs.err.big": "That calendar is too big to read (5 MB at most).",
      "subs.err.timeout": "The server took too long to answer.",
      "subs.err.other": "Couldn't read the calendar ({e}).",
      "subs.lasterr": "Last try failed: {e}",
      "sv.copy": "Copy to my calendar",
      "sv.from": "From {name}",
      "fr.title": "Share free times",
      "fr.text": "Makes a link with the times you're free, worked out from your calendar on this device. The other person picks one and emails you back. No server keeps anything, and nothing is booked by itself.",
      "fr.what": "What for",
      "fr.what.ph": "Meeting",
      "fr.len": "Length",
      "fr.days": "Over the next",
      "fr.from": "From",
      "fr.to": "Until",
      "fr.wknd": "Include Saturday and Sunday",
      "fr.name": "Your name",
      "fr.mail": "Your email (answers come here)",
      "fr.mail.ph": "you@example.com",
      "fr.loc.ph": "Optional: a place or a call link",
      "fr.go": "Make the link…",
      "fr.min": "{n} min",
      "fr.hours": "{n} h",
      "fr.dayN": "{n} days",
      "fr.sum": "{n} free times on {d} days.",
      "fr.sum1": "1 free time.",
      "fr.none": "No free time in those hours. Try more days or longer hours.",
      "fr.nomail": "Without an email the other person can still add the time to their calendar, but can't answer you from the page.",
      "fr.noshare": "Open the Calendar inside orOS to send the link.",
      "pr.week": "Week of {d}",
      "pr.agenda": "Agenda from {d}",
      "pr.more": "+{n} more",
      "pr.none": "Nothing scheduled"
    },
    el: {
      "cal.more": "Περισσότερα",
      "mm.subs": "Συνδρομή σε ημερολόγιο…",
      "mm.free": "Κοινοποίηση ελεύθερων ωρών…",
      "mm.print": "Εκτύπωση…",
      "mm.names": "Ονόματα συμβάντων στον Μήνα",
      "mm.names.short": "Ονόματα",
      "qa.btn": "Γρήγορη προσθήκη",
      "qa.title": "Γρήγορη προσθήκη",
      "qa.ph": "π.χ. Καφές με Νίκο Πέμπτη 6μμ στο Σύνταγμα",
      "qa.hint": "Γράψ' το όπως θα το έλεγες: τι, πότε και «στο» πού. Το ελέγχεις στο παράθυρο του συμβάντος πριν το αποθηκεύσεις.",
      "qa.go": "Συνέχεια",
      "qa.what": "Τι", "qa.when": "Πότε", "qa.rep": "Επανάληψη", "qa.where": "Πού",
      "qa.allday": "όλη μέρα",
      "subs.title": "Ημερολόγια συνδρομής",
      "subs.text": "Επικόλλησε τη διεύθυνση ενός ημερολογίου που δημοσιεύεται ως .ics (webcal:// ή https://): ημερολόγιο ομάδας, σχολικές αργίες, αγώνες. Τα συμβάντα του φαίνονται μόνο για ανάγνωση, με δικό τους chip, και ανανεώνονται μόνα τους.",
      "subs.url": "Διεύθυνση ημερολογίου",
      "subs.url.ph": "webcal://… ή https://….ics",
      "subs.name": "Όνομα (προαιρετικό)",
      "subs.name.ph": "Το δικό του όνομα",
      "subs.add": "Συνδρομή",
      "subs.none": "Καμία συνδρομή ακόμα.",
      "subs.refresh": "Ανανέωση",
      "subs.remove": "Αφαίρεση",
      "subs.removed": "Η συνδρομή αφαιρέθηκε",
      "subs.color": "Αλλαγή χρώματος",
      "subs.bad": "Αυτό δεν μοιάζει με διεύθυνση ημερολογίου (webcal:// ή https://).",
      "subs.dup": "Έχεις ήδη συνδρομή σε αυτό το ημερολόγιο.",
      "subs.wait": "Διαβάζω το ημερολόγιο…",
      "subs.ok": "{n} συμβάντα · ενημέρωση {t}",
      "subs.never": "Δεν έχει διαβαστεί ακόμα",
      "subs.more": "Άλλα {n} έμειναν έξω (πρώτα τα παλαιότερα)",
      "subs.err.offline": "Είσαι εκτός σύνδεσης. Φαίνεται το τελευταίο αντίγραφο.",
      "subs.err.norelay": "Ο server αυτού του ημερολογίου δεν αφήνει έναν browser να το διαβάσει απευθείας. Χρειάζεται το relay του orOS: βάλε τη διεύθυνσή του στην Αλληλογραφία ή στις Ρυθμίσεις του Αναγνώστη.",
      "subs.err.http": "Ο server απάντησε με σφάλμα ({n}).",
      "subs.err.notics": "Αυτή η διεύθυνση δεν έδωσε ημερολόγιο (.ics).",
      "subs.err.big": "Το ημερολόγιο είναι πολύ μεγάλο (έως 5 MB).",
      "subs.err.timeout": "Ο server άργησε πολύ να απαντήσει.",
      "subs.err.other": "Δεν ήταν δυνατό να διαβαστεί το ημερολόγιο ({e}).",
      "subs.lasterr": "Η τελευταία προσπάθεια απέτυχε: {e}",
      "sv.copy": "Αντιγραφή στο ημερολόγιό μου",
      "sv.from": "Από: {name}",
      "fr.title": "Κοινοποίηση ελεύθερων ωρών",
      "fr.text": "Φτιάχνει έναν σύνδεσμο με τις ώρες που είσαι ελεύθερος/η, από το ημερολόγιό σου σε αυτή τη συσκευή. Ο άλλος διαλέγει μία και σου απαντά με email. Κανένας server δεν κρατά τίποτα και τίποτα δεν κλείνεται μόνο του.",
      "fr.what": "Για ποιο λόγο",
      "fr.what.ph": "Συνάντηση",
      "fr.len": "Διάρκεια",
      "fr.days": "Τις επόμενες",
      "fr.from": "Από",
      "fr.to": "Έως",
      "fr.wknd": "Μαζί με Σάββατο και Κυριακή",
      "fr.name": "Το όνομά σου",
      "fr.mail": "Το email σου (εκεί έρχονται οι απαντήσεις)",
      "fr.mail.ph": "esy@example.com",
      "fr.loc.ph": "Προαιρετικά: ένα μέρος ή σύνδεσμος κλήσης",
      "fr.go": "Φτιάξε τον σύνδεσμο…",
      "fr.min": "{n}′",
      "fr.hours": "{n} ώρ.",
      "fr.dayN": "{n} μέρες",
      "fr.sum": "{n} ελεύθερες ώρες σε {d} μέρες.",
      "fr.sum1": "1 ελεύθερη ώρα.",
      "fr.none": "Καμία ελεύθερη ώρα σε αυτό το ωράριο. Δοκίμασε περισσότερες μέρες ή μεγαλύτερο ωράριο.",
      "fr.nomail": "Χωρίς email ο άλλος μπορεί να βάλει την ώρα στο ημερολόγιό του, αλλά όχι να σου απαντήσει από τη σελίδα.",
      "fr.noshare": "Άνοιξε το Ημερολόγιο μέσα στο orOS για να στείλεις τον σύνδεσμο.",
      "pr.week": "Εβδομάδα από {d}",
      "pr.agenda": "Ατζέντα από {d}",
      "pr.more": "+{n} ακόμα",
      "pr.none": "Τίποτα προγραμματισμένο"
    }
  });
  // One-time import from Google Calendar (gcal.js + /google-import.js).
  (function (more) {
    ["en", "el"].forEach(function (l) {
      Object.keys(more[l]).forEach(function (k) { STR[l][k] = more[l][k]; });
    });
  })({
    en: {
      "mm.google": "Import from Google Calendar…",
      "gi.title": "Import from Google Calendar",
      "gi.text": "Sign in to Google once: orOS reads your calendars, you choose which ones come in, and the access is given back right away. Nothing is kept, nothing changes at Google.",
      "gi.wait": "Waiting for the Google sign-in window…",
      "gi.read": "Reading events… {n}",
      "gi.pick": "Calendars to import",
      "gi.row": "{new} new · {same} already here",
      "gi.sum": "{n} event(s) to import",
      "gi.dup": "{n} event(s) appear on more than one calendar: they come in once.",
      "gi.lbl": "Each calendar becomes a label with its name (an existing label with the same name is used).",
      "gi.none": "No events in this Google account.",
      "gi.nothing": "Nothing new: the Calendar already has these events.",
      "gi.done": "{n} event(s) imported from Google",
      "gi.undone": "Import undone",
      "gi.own": "To use your own Google app id, set it in Contacts › From an account.",
      "gi.cancel": "Cancel",
      "gi.close": "Close"
    },
    el: {
      "mm.google": "Εισαγωγή από Google Calendar…",
      "gi.title": "Εισαγωγή από Google Calendar",
      "gi.text": "Συνδέεσαι μία φορά στη Google: το orOS διαβάζει τα ημερολόγιά σου, διαλέγεις ποια θα έρθουν και η πρόσβαση επιστρέφεται αμέσως. Δεν κρατιέται τίποτα και δεν αλλάζει τίποτα στη Google.",
      "gi.wait": "Αναμονή για το παράθυρο σύνδεσης της Google…",
      "gi.read": "Ανάγνωση συμβάντων… {n}",
      "gi.pick": "Ημερολόγια για εισαγωγή",
      "gi.row": "{new} νέα · {same} υπάρχουν ήδη",
      "gi.sum": "{n} συμβάν/τα για εισαγωγή",
      "gi.dup": "{n} συμβάν/τα υπάρχουν σε περισσότερα από ένα ημερολόγια: έρχονται μία φορά.",
      "gi.lbl": "Κάθε ημερολόγιο γίνεται ετικέτα με το όνομά του (αν υπάρχει ήδη ετικέτα με το ίδιο όνομα, χρησιμοποιείται αυτή).",
      "gi.none": "Δεν υπάρχουν συμβάντα σε αυτόν τον λογαριασμό Google.",
      "gi.nothing": "Τίποτα νέο: το Ημερολόγιο έχει ήδη αυτά τα συμβάντα.",
      "gi.done": "Εισήχθησαν {n} συμβάν/τα από τη Google",
      "gi.undone": "Η εισαγωγή αναιρέθηκε",
      "gi.own": "Για δικό σου αναγνωριστικό εφαρμογής Google, όρισέ το στις Επαφές › Από λογαριασμό.",
      "gi.cancel": "Άκυρο",
      "gi.close": "Κλείσιμο"
    }
  });
  // Send a whole calendar or a date range (share wave 3, kind "cal").
  (function (more) {
    ["en", "el"].forEach(function (l) {
      Object.keys(more[l]).forEach(function (k) { STR[l][k] = more[l][k]; });
    });
  })({
    en: {
      "mm.send": "Send calendar to someone…",
      "sc.title": "Send calendar to someone",
      "sc.text": "Your own events go in a link: the whole calendar or only some dates. Events from subscriptions and other apps stay here.",
      "sc.which": "Calendar", "sc.all": "All my events", "sc.calName": "Calendar",
      "sc.range": "Dates", "sc.r.all": "Everything", "sc.r.month": "This month", "sc.r.3m": "Next 3 months",
      "sc.r.year": "This year", "sc.r.pick": "Choose dates…", "sc.from": "From", "sc.to": "To",
      "sc.sum": "{n} events go.", "sc.sum1": "1 event goes.", "sc.none": "No events in this choice.",
      "sc.cap": "Only the {n} newest go.", "sc.go": "Next"
    },
    el: {
      "mm.send": "Στείλε το ημερολόγιο σε κάποιον…",
      "sc.title": "Στείλε το ημερολόγιο σε κάποιον",
      "sc.text": "Τα δικά σου γεγονότα μπαίνουν σε έναν σύνδεσμο: όλο το ημερολόγιο ή μόνο κάποιες ημερομηνίες. Γεγονότα από συνδρομές και άλλες εφαρμογές μένουν εδώ.",
      "sc.which": "Ημερολόγιο", "sc.all": "Όλα τα γεγονότα μου", "sc.calName": "Ημερολόγιο",
      "sc.range": "Ημερομηνίες", "sc.r.all": "Όλα", "sc.r.month": "Αυτός ο μήνας", "sc.r.3m": "Επόμενοι 3 μήνες",
      "sc.r.year": "Φέτος", "sc.r.pick": "Διάλεξε ημερομηνίες…", "sc.from": "Από", "sc.to": "Έως",
      "sc.sum": "Θα σταλούν {n} γεγονότα.", "sc.sum1": "Θα σταλεί 1 γεγονός.", "sc.none": "Δεν υπάρχουν γεγονότα σε αυτή την επιλογή.",
      "sc.cap": "Θα σταλούν μόνο τα {n} πιο πρόσφατα.", "sc.go": "Επόμενο"
    }
  });
  // .oroscal: the orOS file of every event and label (package.js).
  (function (more) {
    ["en", "el"].forEach(function (l) {
      Object.keys(more[l]).forEach(function (k) { STR[l][k] = more[l][k]; });
    });
  })({
    en: {
      "mm.osave": "orOS file (.oroscal)",
      "mm.oopen": "Open orOS file…",
      "mm.ofolder": "Unzipped orOS folder…"
    },
    el: {
      "mm.osave": "Αρχείο orOS (.oroscal)",
      "mm.oopen": "Άνοιγμα αρχείου orOS…",
      "mm.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"
    }
  });
  // A pack language (German, …): STR[LANG] = English + the pack, and
  // weekday / month names from Intl in that language's locale.
  if (window.orosI18n) {
    window.orosI18n.table(STR, "calendar", LANG);
    if (LANG !== "en" && LANG !== "el" && STR[LANG]) (function (T) {
      try {
        var L = loc(), wl = new Intl.DateTimeFormat(L, { weekday: "long" }),
            ws = new Intl.DateTimeFormat(L, { weekday: "short" }),
            ml = new Intl.DateTimeFormat(L, { month: "long" });
        var full = [], short = [], mons = [];
        for (var i = 0; i < 7; i++) {           // 2023-01-01 was a Sunday
          var d = new Date(2023, 0, 1 + i, 12);
          full.push(wl.format(d)); short.push(ws.format(d));
        }
        for (var m = 0; m < 12; m++) mons.push(ml.format(new Date(2023, m, 1, 12)));
        T["wd.full"] = full; T["wd.short"] = short;
        T.wd = short.slice(1).concat(short[0]);  // Monday first
        T.months = mons; T["mon.gen"] = mons;
      } catch (e) { /* no Intl: English names */ }
    })(STR[LANG]);
  }
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
    var airs = document.querySelectorAll("[data-i18n-aria]");
    for (var k = 0; k < airs.length; k++) airs[k].setAttribute("aria-label", t(airs[k].getAttribute("data-i18n-aria")));
  }

  // Boot marker (stale-bundle detection — R3/R11) + live lang attr
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("calendar.js v" + (SCRIPT_V || "?") + " boot");
  })();

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Lazy singleton toast (orOS standard: top-right, text node FIRST,
  // optional action button SECOND, 5s auto-hide, single-slot).
  var toastEl = null, toastTimer = null;
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) toastEl.classList.remove("show");
  }
  function toast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "app-toast";
      document.body.appendChild(toastEl);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.textContent = "";               // wipe before append
    toastEl.appendChild(document.createTextNode(text));
    if (actionLabel && typeof actionFn === "function") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "app-toast-btn";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        hideToast();
        actionFn();
      });
      toastEl.appendChild(b);
    }
    toastEl.classList.add("show");
    // CA-13: ένα toast με Undo μένει ≥8s (κανόνας orOS)
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 5000);
  }
  
  /* Unified notifications (orOS compliance): informational toasts
   route through the shell's orosNotifs.transient() — click
   feedback, no inbox, no toggle needed. Falls back to the local
   toast when the app runs standalone (no shell present).
   Undo-bearing toasts keep the local path (interactive action). */
function transientNote(title, body) {
  var api = null;
  try { api = window.parent.orosNotifs; } catch (e) {}
  if (!api && window.orosNotifs) api = window.orosNotifs;
  
  if (api && typeof api.transient === "function") {
    api.transient({ ns: "calendar", title: title, body: body || "" });
  } else {
    toast(title + (body ? " — " + body : ""));
  }
}

  /* ---------- 2. State ---------- */
  var DATA_KEY = "oros-calendar-data";
  var RESCUE_KEY = "oros-calendar-data-broken";   // CA-12: αντίγραφο μη αναγνώσιμων δεδομένων
  var state = { ver: 1, labels: [], events: [], deleted: [], subs: [] };

  // Whitelist — the sync-sanitizer contract (deterministic).
  // Declared HERE (moved up from §3b in v0.3): sanitizeEvent runs
  // at load and at merge time, so the presets must be initialized
  // before any sanitizer ever touches an event.
  var REMIND_PRESETS = [5, 15, 30, 60, 1440, 4320, 7200];

  // Fixed label palette — deterministic across devices (stored
  // verbatim inside the synced blob; theme-independent by design).
  var LABEL_PALETTE = [
    "#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
    "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"
  ];

  // CA3/CA4: THE single color source for both sanitizers. Brown
  // (#c8a96e) is reserved for the Contacts "Custom" feed label —
  // the user-facing picker still iterates LABEL_PALETTE only.
  // A color can never again "pass at load but die at merge".
  var VALID_COLORS = LABEL_PALETTE.concat(["#c8a96e"]);

  // Wave 2.1 — virtual feed labels (Contacts/Cycle/Mood/Habits feeds).
  // DELIBERATELY not in state.labels: they never travel in the synced
  // blob, can never be deleted/renamed from the label manager
  // (renderLblList iterates state.labels only), and carry no mtime.
  // Display-only constants; the name is painted via i18n at render time.
  // Colors come from LABEL_PALETTE so they match the design system.
  var FEED_LABELS = [
    { id: "lbl-feed-bday",    color: "#9ece6a" },   // green — Birthdays
    { id: "lbl-feed-anniv",   color: "#f28fb6" },   // pink — Anniversaries
    { id: "lbl-feed-cycle",   color: "#f28fb6" },   // pink — Cycle (same as anniv by design)
    { id: "lbl-feed-mood",    color: "#a78bfa" },   // purple — Mood
    { id: "lbl-feed-habits",  color: "#4ec9b0" },   // teal — Habits
    { id: "lbl-feed-kanban",  color: "#7aa2f7" },   // blue — Kanban (teal taken by Habits)
    { id: "lbl-feed-todo",    color: "#e06c75" },   // red — To-Do due dates
    { id: "lbl-feed-fitness", color: "#f28c5a" },   // orange — finished workouts
    { id: "lbl-feed-pet",    color: "#b39ddb" },   // light purple — Screen Pet (distinct from Mood #a78bfa)
    { id: "lbl-feed-plants", color: "#8bc34a" },   // leaf green — Plant Care (distinct from Birthdays #9ece6a)
    { id: "lbl-feed-chores", color: "#c678dd" },   // magenta — Chore Wheel (distinct from Mood #a78bfa)
    { id: "lbl-feed-petcare", color: "#e0af68" },  // amber — Pet Health Book (real pets; Screen Pet is lbl-feed-pet)
    { id: "lbl-feed-garage", color: "#ecc75f" },   // amber — Garage renewals + service
    { id: "lbl-feed-travel", color: "#2bb3a3" },   // sea green — Travel trips + timed itinerary
    { id: "lbl-feed-meals",  color: "#ff9e64" },   // orange — Meal Planner plan
    { id: "lbl-feed-budget", color: "#2bb673" },   // emerald — Budget recurring entries (distinct from the lime greens)
    { id: "lbl-feed-shelf",  color: "#d16ba5" },   // berry — Media Shelf finishes + wishlist release dates
    { id: "lbl-feed-publish", color: "#b5835a" },  // bronze — Publishing release dates + release-plan steps
    { id: "lbl-feed-inv",    color: "#e5a54b" },   // ochre — Invoices: unpaid documents on their due date
    { id: "lbl-feed-baby",   color: "#f4a3c8" },   // soft pink — Baby milestones, health, monthly age
    { id: "lbl-feed-together", color: "#ef5d8a" }, // rose — Together anniversaries, milestones, moments
    { id: "lbl-feed-custom", color: "#c8a96e" },    // brown — Contacts custom event types
    { id: "lbl-feed-hol",     color: "#ef6b5b" },   // coral red — Greek public holidays
    { id: "lbl-feed-nameday", color: "#ffb74d" },   // amber — contacts who have a name day
    { id: "lbl-feed-obs",     color: "#64b5f6" },   // sky blue — world / internet days
    { id: "lbl-feed-time",    color: "#56b6c2" },   // cyan — Timesheet work time per project
    { id: "lbl-feed-famtree", color: "#9aa4b0" },   // slate grey — Family Tree death anniversaries
    { id: "lbl-feed-crm",     color: "#8c9eff" },   // periwinkle — CRM follow-ups + expected deal closes
    { id: "lbl-feed-meds",    color: "#e57373" },   // soft red — Health medicines (opt-in: sensitive)
    { id: "lbl-feed-appts",   color: "#f06292" },   // pink — Health doctor's appointments + vaccines due (opt-in)
    { id: "lbl-feed-sky",     color: "#e9dfb4" }    // moonlight cream — Moon & Sky (opt-in)
  ];
  function feedLabelName(l) {
    if (l.id === "lbl-feed-bday") return t("lbl.feed.bday");
    if (l.id === "lbl-feed-anniv") return t("lbl.feed.anniv");
    if (l.id === "lbl-feed-cycle") return t("lbl.feed.cycle");
    if (l.id === "lbl-feed-mood") return t("lbl.feed.mood");
    if (l.id === "lbl-feed-habits") return t("lbl.feed.habits");
    if (l.id === "lbl-feed-kanban") return t("lbl.feed.kanban");
    if (l.id === "lbl-feed-pet") return t("lbl.feed.pet");
    if (l.id === "lbl-feed-todo") return t("lbl.feed.todo");
    if (l.id === "lbl-feed-plants") return t("lbl.feed.plants");
    if (l.id === "lbl-feed-chores") return t("lbl.feed.chores");
    if (l.id === "lbl-feed-petcare") return t("lbl.feed.petcare");
    if (l.id === "lbl-feed-garage") return t("lbl.feed.garage");
    if (l.id === "lbl-feed-travel") return t("lbl.feed.travel");
    if (l.id === "lbl-feed-meals") return t("lbl.feed.meals");
    if (l.id === "lbl-feed-budget") return t("lbl.feed.budget");
    if (l.id === "lbl-feed-baby") return t("lbl.feed.baby");
    if (l.id === "lbl-feed-together") return t("lbl.feed.together");
    if (l.id === "lbl-feed-shelf") return t("lbl.feed.shelf");
    if (l.id === "lbl-feed-publish") return t("lbl.feed.publish");
    if (l.id === "lbl-feed-inv") return t("lbl.feed.inv");
    if (l.id === "lbl-feed-fitness") return t("lbl.feed.fitness");
    if (l.id === "lbl-feed-hol") return t("lbl.feed.hol");
    if (l.id === "lbl-feed-nameday") return t("lbl.feed.nameday");
    if (l.id === "lbl-feed-obs") return t("lbl.feed.obs");
    if (l.id === "lbl-feed-time") return t("lbl.feed.time");
    if (l.id === "lbl-feed-famtree") return t("lbl.feed.famtree");
    if (l.id === "lbl-feed-crm") return t("lbl.feed.crm");
    if (l.id === "lbl-feed-meds") return t("lbl.feed.meds");
    if (l.id === "lbl-feed-appts") return t("lbl.feed.appts");
    if (l.id === "lbl-feed-sky") return t("lbl.feed.sky");
    return t("lbl.feed.custom");
  }

  // Seeds for fresh installs (mtime 0 → any user edit wins the merge
  // everywhere; identical bytes on every device — no Date.now() here).
  function defaultLabels() {
    return [
      { id: "lbl-personal", name: t("lbl.personal"), color: LABEL_PALETTE[0], mtime: 0 },
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[2], mtime: 0 },
      { id: "lbl-family",   name: t("lbl.family"),   color: LABEL_PALETTE[3], mtime: 0 }
    ];
  }

  // CA-7: untouched seeds (mtime 0) are STORED with one canonical
  // (English) name on every device and translated only on screen
  // (lblName). Before, each device wrote its own language at mtime 0:
  // the EN and EL blobs never matched, and every pull on the EL
  // device re-ran the setter (dialog closed, Undo lost, toast).
  var SEED_NAMES = {
    "lbl-personal": ["Personal", "lbl.personal"],
    "lbl-work":     ["Work",     "lbl.work"],
    "lbl-family":   ["Family",   "lbl.family"]
  };
  function canonSeedName(l) {
    if (l && l.mtime === 0 && SEED_NAMES[l.id]) l.name = SEED_NAMES[l.id][0];
    return l;
  }
  function lblName(l) {
    if (l && l.mtime === 0 && SEED_NAMES[l.id]) return t(SEED_NAMES[l.id][1]);
    return l ? l.name : "";
  }
  // A seed the user edits keeps the name it SHOWED (Greek on an EL
  // device), not the canonical English one.
  function stampLabel(l) {
    if (l.mtime === 0 && SEED_NAMES[l.id]) l.name = lblName(l);
    l.mtime = Date.now();
  }
  function reseedSeedNames() {
    state.labels.forEach(canonSeedName);
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    // CA4: single palette source (VALID_COLORS = LABEL_PALETTE + brown)
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    return canonSeedName({
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    });
  }

  function labelById(id) {
    var own = ownLabels();
    for (var i = 0; i < own.length; i++) {
      if (own[i].id === id) return own[i];
    }
    for (var f = 0; f < FEED_LABELS.length; f++) {
      if (FEED_LABELS[f].id === id) return FEED_LABELS[f];
    }
    if (typeof id === "string" && id.indexOf("sub-") === 0) return subLabel(id.slice(4));
    return null;
  }
  function labelColor(labelId) {
    var l = labelById(labelId);
    if (l) return l.color;
    var acc = "";
    try {
      acc = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim();
    } catch (e) {}
    return acc || "#d4af37";
  }

  function sanitizeEvent(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    // v0.1 legacy: single "time" field migrates to "start" (zero loss)
    var start = null;
    if (typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start)) start = e.start;
    else if (typeof e.time === "string" && /^\d{2}:\d{2}$/.test(e.time)) start = e.time;
    var end = (typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end)) ? e.end : null;
    var labelId = (typeof e.labelId === "string" && e.labelId) ? e.labelId : null;
    var remindMin = (typeof e.remindMin === "number" &&
                     REMIND_PRESETS.indexOf(e.remindMin) !== -1)
      ? e.remindMin : null;
    // Multi-day: dateEnd on/after the anchor (a series may span days
    // too since wave 5: every occurrence lasts dateEnd − date days).
    var dateEnd = null;
    if (typeof e.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateEnd)) {
      if (e.dateEnd >= e.date) dateEnd = e.dateEnd;
    }
    // Corrupted range → no end. An end before the start is fine only
    // when the event runs into a later day (Fri 22:00 → Sun 09:00).
    if (start && end && end < start && !(dateEnd && dateEnd > e.date)) end = null;
    var out = {
      id: e.id,
      date: e.date,
      dateEnd: dateEnd,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      recur: sanitizeRecur(e.recur, e.date),
      remindMin: remindMin,
      mtime: (typeof e.mtime === "number" && isFinite(e.mtime)) ? e.mtime : Date.now()
    };
    // Time zone (wave 5): only on timed events, LAST key and left out
    // when unset, so older events keep their exact bytes.
    if (start && validTzName(e.tz)) out.tz = e.tz;
    return out;
  }
  // Wave 8: a subscribed calendar { id, url, name, color, mtime }
  // (calendar/subs.js). Same colour list as the labels.
  function sanitizeSub(s) { return window.OrosCalSubs ? window.OrosCalSubs.sanitizeSub(s, VALID_COLORS, false) : null; }
  function mergeSanitizeSub(s) { return window.OrosCalSubs ? window.OrosCalSubs.sanitizeSub(s, VALID_COLORS, true) : null; }

  // Deterministic on every device (no Intl): a name, not a lookup.
  function validTzName(tz) {
    return typeof tz === "string" && /^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(tz);
  }

  // Tombstones: deletion markers — { id, mtime }. They travel in the
  // same blob (additive field, ver stays 1) so a delete on device A
  // can never be resurrected by device B's stale copy of the event.
  function sanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    return {
      id: d.id,
      mtime: (typeof d.mtime === "number" && isFinite(d.mtime)) ? d.mtime : Date.now()
    };
  }

  function loadState() {
    var raw = null, hhEvs = state.events.filter(isHhEv);   // BR-HH: not in DATA_KEY
    try { raw = localStorage.getItem(DATA_KEY); } catch (e0) { raw = null; }
    try {
      var d = JSON.parse(raw);
      if (d && typeof d === "object" && Array.isArray(d.events)) {
        state.events = d.events.map(sanitizeEvent).filter(Boolean);
      }
      // Pre-sync blobs have no "deleted" → empty list, zero migration
      if (d && Array.isArray(d.deleted)) {
        state.deleted = d.deleted.map(sanitizeTomb).filter(Boolean);
      }
      // Wave 8: subscribed calendars (absent in older blobs = none)
      if (d && Array.isArray(d.subs)) {
        state.subs = d.subs.map(sanitizeSub).filter(Boolean);
      }
      // Seed ΜΟΝΟ όταν λείπει το κλειδί "labels" (φρέσκια
      // εγκατάσταση / v0.1 blob). Άδειο-but-παρόν array = ο χρήστης
      // τα σβήσε όλα — το σεβόμαστε, δεν τα φυτεύουμε ξανά.
      if (d && Array.isArray(d.labels)) {
        state.labels = d.labels.map(sanitizeLabel).filter(Boolean);
      } else {
        state.labels = defaultLabels();
        // CA1: persist NOW — merge-inert, NO markDirty. A fresh
        // install otherwise hands the merge an empty local blob,
        // and a labels-less peer wipes the seeds in setFromSync.
        // Writing immediately means the merge union sees them;
        // mtime 0 keeps cloud traffic at exactly zero.
        // (CA-7: the write itself is writeStore() at the end.)
      }
    } catch (e) {
      // CA-12: unreadable blob → keep a copy before anything
      // overwrites it (the first save would otherwise destroy it).
      if (raw) { try { localStorage.setItem(RESCUE_KEY, raw); } catch (e3) {} }
      if (!state.labels.length) state.labels = defaultLabels();
    }
    state.events = state.events.filter(function (e) { return !isHhEv(e); }).concat(hhEvs);
    writeStore();
  }

  // CA-7: the disk holds exactly what the getter hands to sync —
  // the merge's canonical form (sorted by id, sanitized, canonical
  // seed names). The closed-app proxy then reads the same bytes.
  // BR-HH: only the person's own calendar (personal()); true when the
  // stored bytes changed.
  var quotaWarned = false, lastStore = null;
  function writeStore() {
    var canon = mergeCalendars(personal(state), null), text = JSON.stringify(canon);
    hhOwnIds = {};
    canon.events.forEach(function (e) { hhOwnIds[e.id] = 1; });
    var changed = text !== lastStore;
    try {
      localStorage.setItem(DATA_KEY, text);
      lastStore = text;
      quotaWarned = false;
    } catch (e) {
      // R30: one message per failure streak, never silence.
      if (!quotaWarned) { quotaWarned = true; transientNote(t("toast.quota")); }
      changed = true;
    }
    return changed;
  }
  // An edit of a shared calendar only goes to its household: the
  // person's own cloud copy is marked dirty only when it changed.
  function saveState() {
    hhTombMoved();
    if (writeStore()) markDirty();
    hhPush();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
  }

  /* ---------- 2a. Calendars shared with a household (BR-HH) ----------
     A shared calendar is a household document of kind "cal"
     (window.parent.orosHousehold, household/engine.js). calendar/house.js
     turns it into a label "hh-<document id>" (hhLabels, never in
     state.labels) and events of that label. They live only in memory:
     never in DATA_KEY nor in the person's own cloud copy (personal()),
     and every edit leaves through saveState() → hhPush() as the fields
     that changed. Nothing here merges a shared calendar: the household
     merge does, field by field, and hhInject() rebuilds the events from
     its result, so the two can never answer each other. Reminders stay
     personal (REM_KEY, this device). */
  var HHc = window.OrosCalHouse || null, HC = window.OrosHouseCore || null;
  var hhLabels = [];      // the shared calendars, as labels
  var hhLast = {};        // document id → the projection last read or sent
  var hhInfo = {};        // label id → { box, id, hh }
  var hhOwnIds = {};      // event ids last written to DATA_KEY
  var hhWant = null;      // a deep link to a shared event not built yet
  var hhNoCopy = {};      // calendars deleted here: no own copy
  var hhBuilt = false;    // the first build ran
  function hhApi() {
    if (!HHc || !HC) return null;
    try {
      var p = window.parent;
      return p && p !== window && p.orosHousehold && typeof p.orosHousehold.docs === "function" ? p.orosHousehold : null;
    } catch (e) { return null; }
  }
  function isHh(id) { return !!HHc && HHc.isShared(id); }
  function isHhEv(e) { return !!e && isHh(e.labelId); }
  function personal(st) {
    var o = {};
    Object.keys(st).forEach(function (k) { o[k] = st[k]; });
    o.events = (st.events || []).filter(function (e) { return !isHhEv(e); });
    return o;
  }
  // The person's labels and the shared calendars: chips, the event
  // dialog, filters.
  function ownLabels() { return hhLabels.length ? state.labels.concat(hhLabels) : state.labels; }
  // An event moved from the person's own calendar into a shared one is
  // gone from the own calendar on every device of theirs (tombstone).
  function hhTombMoved() {
    var now = Date.now();
    state.events.forEach(function (e) {
      if (!isHhEv(e) || !hhOwnIds[e.id]) return;
      state.deleted = state.deleted.filter(function (d) { return d.id !== e.id; });
      state.deleted.push({ id: e.id, mtime: Math.max(now, e.mtime || 0) });
    });
  }
  function hhSig(labels, events) {
    var evs = events.slice().sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    return JSON.stringify(labels) + JSON.stringify(evs.map(function (e) {
      return [HHc.project(null, [e]).items[e.id] || null, e.labelId, e.remindMin, e.hhBy || ""];
    }));
  }
  // Rebuilds the shared calendars from the household; true when what is
  // on screen changed. Calendars that left a household (this person
  // stopped sharing, left, was removed) become calendars of their own.
  function hhInject() {
    var h = hhApi();
    if (!h) return false;
    var rem = HHc.readRem(), labels = [], evs = [], info = {};
    h.docs("cal").forEach(function (d) {
      if (!d.ready) return;
      var v = h.view(d.box, d.id, ["o"]);
      if (!v) return;
      var b = HHc.build(v, d.id, rem);
      info[b.label.id] = { box: d.box, id: d.id, hh: d.hh };
      hhLast[d.id] = HHc.project(b.label, b.events);
      labels.push(b.label);
      evs = evs.concat(b.events);
    });
    hhBuilt = true;
    hhInfo = info;
    var changed = hhSig(hhLabels, state.events.filter(isHhEv)) !== hhSig(labels, evs);
    if (changed) {
      hhLabels = labels;
      state.events = state.events.filter(function (e) { return !isHhEv(e); }).concat(evs);
    }
    var copies = hhCopies(h);
    if (copies) saveState();
    if (changed || copies) refreshOpenDlg();
    if (hhWant) {
      var w = hhWant;
      hhWant = null;
      if (findEvent(w.id)) setTimeout(function () { __orosCalendarOpen(w.id, w.date); }, 0);
    }
    return changed || copies;
  }
  // The own copy "lbc-<document id>" of a calendar that left a household
  // (same event ids: every device of the person makes the very same one).
  function hhCopies(h) {
    var made = false, now = Date.now();
    h.archived("cal").forEach(function (a) {
      if (!a.take) return;
      if (hhNoCopy[a.id]) { h.dropArchived(a.box, a.id); return; }
      var lid = HHc.COPY + a.id;
      if (!state.labels.some(function (l) { return l.id === lid; })) {
        var c = HHc.copyOf(HC.view(a.doc, ["o"]), a.id, now), ids = {};
        ids[lid] = 1;
        c.events.forEach(function (e) { ids[e.id] = 1; });
        // newer than any tombstone the share left on these ids
        state.deleted = state.deleted.filter(function (d) { return !ids[d.id]; });
        state.events = state.events.filter(function (e) { return !ids[e.id]; });
        var lbl = sanitizeLabel(c.label);
        if (lbl) state.labels.push(lbl);
        c.events.forEach(function (e) { var s = sanitizeEvent(e); if (s) state.events.push(s); });
        made = true;
      }
      h.dropArchived(a.box, a.id);
    });
    return made;
  }
  // Sends what changed in the shared calendars since they were last read.
  var lastRem = null;
  function hhPush() {
    var h = hhApi();
    if (!h || !HHc) return;
    var rem = HHc.readRem(), gone = [];
    hhLabels.forEach(function (l) {
      var inf = hhInfo[l.id];
      if (!inf || !hhLast[inf.id]) return;
      var mine = state.events.filter(function (e) { return e.labelId === l.id; });
      mine.forEach(function (e) { if (e.remindMin) rem[e.id] = e.remindMin; else delete rem[e.id]; });
      var prev = hhLast[inf.id], cur = HHc.project(l, mine);
      var d = HC.diffItems(prev.items, cur.items, HHc.FIELDS), m = {}, anyM = false;
      if (prev.m.c !== cur.m.c) { m.c = cur.m.c; anyM = true; }
      hhLast[inf.id] = cur;
      if (d) gone = gone.concat(d.del);
      if (cur.m.t && cur.m.t !== prev.m.t) h.retitle(inf.box, inf.id, cur.m.t);
      if (d || anyM) h.change(inf.box, inf.id, { set: d ? d.set : {}, del: d ? d.del : [], m: m });
    });
    gone.forEach(function (id) { if (!findEvent(id) || !isHhEv(findEvent(id))) delete rem[id]; });
    var txt = JSON.stringify(rem);
    if (txt === lastRem) return;
    lastRem = txt;
    try {
      if (Object.keys(rem).length) localStorage.setItem(HHc.REM_KEY, txt);
      else localStorage.removeItem(HHc.REM_KEY);
    } catch (e) {}
  }
  // Who last changed a shared event (another member only).
  function hhByOf(e) {
    var h = hhApi(), src = e && e._src ? e._src : e, inf = src ? hhInfo[src.labelId] : null;
    if (!h || !inf || !src.hhBy || src.hhBy === h.me(inf.box)) return null;
    return h.member(inf.box, src.hhBy);
  }
  var hhQueued = false;
  function hhRefresh() {
    if (hhQueued) return;
    hhQueued = true;
    setTimeout(function () {
      hhQueued = false;
      if (hhInject()) {
        renderChips();
        renderAll();
        renderDay();
        if ($("lbl-dlg") && $("lbl-dlg").open) renderLblList();
      }
    }, 0);
  }
  function hhBoot() {
    var h = hhApi();
    if (!h) return;
    var off = h.on(function (e) {
      if (e && (e.type === "doc" || e.type === "list" || e.type === "roster" || e.type === "archive")) hhRefresh();
    });
    window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
    Promise.resolve(h.ready()).then(hhRefresh, hhRefresh);
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  /* ---------- 2b. Time picker (custom, 24h) ----------
     Browser-native <input type="time"> is AM/PM in some locales and
     its dropdown cannot be styled — replaced by this component.
     Menu: 15-minute slots, 00:00–23:45. Typing stays free-form:
     "9" → 09:00, "937" → 09:37 (any HH:MM survives, not just :15s).
     opts.noEnd: prepend a "no end" (empty) option. */
  function tpParse(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (/^\d{2}:\d{2}$/.test(s)) {
      var h1 = +s.slice(0, 2), m1 = +s.slice(3);
      return (h1 <= 23 && m1 <= 59) ? s : null;
    }
    var d = s.replace(/\D+/g, "");
    if (!d) return null;
    var hh, mm;
    if (d.length === 1 || d.length === 2) { hh = +d; mm = 0; }
    else if (d.length === 3) { hh = +d.slice(0, 1); mm = +d.slice(1); }
    else if (d.length === 4) { hh = +d.slice(0, 2); mm = +d.slice(2); }
    else return null;
    if (hh > 23 || mm > 59 || isNaN(hh) || isNaN(mm)) return null;
    return pad(hh) + ":" + pad(mm);
  }

  function makeTP(inputId, menuId, opts) {
    opts = opts || {};
    var input = $(inputId);
    var menu = $(menuId);
    var activeIdx = 0;
    var options = [];              // { label, value } — value "" = none

    if (opts.noEnd) {
      options.push({ label: "— " + t("ev.end.none"), value: "" });
    }
    for (var h = 0; h < 24; h++) {
      for (var m = 0; m < 60; m += 15) {
        options.push({ label: pad(h) + ":" + pad(m), value: pad(h) + ":" + pad(m) });
      }
    }

    function buildMenu() {
      menu.textContent = "";
      options.forEach(function (o, idx) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tp-opt" + (o.value === "" ? " tp-none" : "");
        b.textContent = o.label;
        b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        b.addEventListener("click", function () { commit(o.value); });
        menu.appendChild(b);
      });
    }

    function setActive(idx) {
      activeIdx = idx;
      var kids = menu.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].classList.toggle("active", i === idx);
      }
      if (kids[idx]) kids[idx].scrollIntoView({ block: "nearest" });
    }

    function nearestIdx(val) {
      // exact slot, else the closest one at-or-below val
      var best = 0;
      for (var i = 0; i < options.length; i++) {
        if (options[i].value === val) return i;
        if (options[i].value && options[i].value <= val) best = i;
      }
      return best;
    }

    function open() {
      if (input.disabled) return;
      buildMenu();
      menu.hidden = false;
      var val = tpParse(input.value);
      setActive(nearestIdx(val || "09:00"));
    }
    function close() {
      menu.hidden = true;
    }

    function commit(value) {
      input.value = value;
      input.classList.remove("invalid");
      close();
    }

    input.addEventListener("focus", open);
    input.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) open();
    });
    input.addEventListener("input", function () {
      // live feedback while typing: valid → normalized preview
      var v = tpParse(input.value);
      if (v) input.classList.remove("invalid");
    });
    input.addEventListener("keydown", function (e) {
      if (menu.hidden) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
          open();
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, options.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var raw = tpParse(input.value);
        if (raw && raw !== input.value) { commit(raw); return; }
        commit(options[activeIdx].value);
      }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { close(); }
    });
    input.addEventListener("blur", function () {
      // leaving the field: normalize whatever was typed (or clear)
      setTimeout(close, 120);
      var v = tpParse(input.value);
      input.value = v || "";
      input.classList.toggle("invalid", !!input.value && !v);
    });

    // outside click closes the menu
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.parentNode.contains(e.target)) close();
    });

    return {
      open: open,
      close: close,
      value: function () { return tpParse(input.value); }
    };
  }

  /* ---------- 2c. Rollup holders (wired at boot) ---------- */
  var tpStart = null, tpEnd = null;

  /* ---------- 3. Date helpers + label visibility ---------- */
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function todayYMD() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }
  // Both operate on "YYYY-MM-DD" strings only (local timezone math).
  function dparse(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }
  function dAdd(s, n) {
    var p = s.split("-");
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    dt.setDate(dt.getDate() + n);
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  // Label visibility: id -> true/false. Absent = visible. Chips row
  // toggles these; nothing is ever deleted by filtering.
  var labelVis = { "lbl-feed-sky": false, "lbl-feed-meds": false, "lbl-feed-appts": false };   // opt-in feeds start hidden (loadFeedVis)
  function labelVisible(labelId) {
    if (!labelId) return true;
    return labelVis[labelId] !== false;
  }
  // Own events with no label (or one that no longer exists here) have
  // their own chip, NO_LABEL. Filtering only hides, never changes them.
  var NO_LABEL = "lbl-nolabel";
  function eventVisible(e) {
    var own = false, lbls = ownLabels();
    for (var i = 0; i < lbls.length; i++) {
      if (lbls[i].id === e.labelId) { own = true; break; }
    }
    return labelVisible(own ? e.labelId : NO_LABEL);
  }

  /* ---------- 3b. Recurrence + multi-day + time zone engine ----------
     Masters stored in state.events with "recur". Occurrences are
     COMPUTED — never stored — by calendar/occur.js, shared with the
     shell's reminder engine, the Today summary, search, .ics and the
     phone bridge. Rules (wave 5): every N days/weeks/months/years,
     weekly on several weekdays, monthly / yearly by day (sticky clamp
     Jan 31 → Feb 28 → Mar 31) or "Nth / last weekday", end after N
     times or on a date, exdates skipped. A series may span several
     days (dateEnd − date per occurrence). A timed event may carry
     `tz`: its times are wall-clock times there, shown converted to
     this device's zone (OCC.instance). */

  var OCC = window.OrosCalOccur;
  function validRecur(r) { return OCC.validRecur(r); }
  function dimOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // Canonical recur (occur.js normRecur): exdates deduped + SORTED,
  // new keys only when they say something → identical JSON on every
  // device and old series byte-for-byte unchanged.
  function sanitizeRecur(r, date) { return OCC.normRecur(r, date); }

  function eachOccurrence(e, cb) { OCC.eachOccurrence(e, cb); }
  function occursOn(e, dateStr) { return OCC.occursOn(e, dateStr); }

  // A stored event as drawn on one device day: a copy whose date,
  // dateEnd, start and end are that occurrence's, in this device's
  // zone. _src = the stored event, _occ = the occurrence's own start
  // date (what "This occurrence" and exdates use).
  function viewOf(e, inst) {
    var v = {};
    for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) v[k] = e[k];
    v.date = inst.date;
    v.dateEnd = inst.dateEnd;
    v.start = inst.start;
    v.end = inst.end;
    v._src = e;
    v._occ = inst.occ;
    v._zoned = inst.zoned;
    return v;
  }
  function srcOf(e) { return (e && e._src) || e; }
  function occOf(e, dayYmd) { return (e && e._occ) || dayYmd; }

  // Multi-day span info: null on single-day rows, otherwise
  // { days: total, idx: 1-based position of dateStr inside }.
  // Guards against span-crossing corruption (idx < 1 / > days).
  function spanInfo(e, dateStr) {
    if (!e.dateEnd || e.dateEnd === e.date) return null;
    var days = Math.round((dparse(e.dateEnd) - dparse(e.date)) / 86400000) + 1;
    var idx = Math.round((dparse(dateStr) - dparse(e.date)) / 86400000) + 1;
    if (days < 1 || idx < 1 || idx > days) return null;
    return { days: days, idx: idx };
  }

  // Human text of a rule ("Every 2 weeks on Mon, Wed, 10 times").
  function fill(k, v) {
    var s = t(k);
    Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function wdFull(i) { return t("wd.full")[i]; }
  function wdShort(i) { return t("wd.short")[i]; }
  function monGen(i) { return t("mon.gen")[i]; }
  // "the last Friday" / «την τελευταία Παρασκευή»
  function nthText(pos, wday) {
    return fill((wday === 6 ? "nthN." : "nth.") + pos, { d: wdFull(wday) });
  }
  function shortDate(s) {
    var p = s.split("-");
    return (+p[2]) + " " + t("months")[+p[1] - 1].slice(0, 3) + " " + p[0];
  }
  function recurText(r, date) {
    if (!validRecur(r)) return "";
    var N = OCC.everyOf(r);
    var s = fill("rr." + r.freq + (N > 1 ? "n" : "1"), { n: N });
    var p = (date || "").split("-");
    var nth = (r.pos === -1 || (r.pos >= 1 && r.pos <= 5)) && r.wday >= 0 && r.wday <= 6;
    var wdays = (r.freq === "W" && Array.isArray(r.byday) && r.byday.length) ? r.byday
      : (r.freq === "W" && p.length === 3 ? [OCC.wdOf(date)] : null);
    if (wdays) {
      var ds = wdays.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
      s = fill("rr.days", { s: s, d: ds.map(wdShort).join(", ") });
    } else if (r.freq === "M" && nth) {
      s = fill("rr.nth", { s: s, x: nthText(r.pos, r.wday) });
    } else if (r.freq === "M" && p.length === 3) {
      s = fill("rr.mday", { s: s, n: +p[2] });
    } else if (r.freq === "Y" && p.length === 3) {
      var mi = +p[1] - 1;
      if (nth) s = fill("rr.ynth", { s: s, x: nthText(r.pos, r.wday), m: monGen(mi) });
      else s = fill("rr.yday", { s: s, n: +p[2], m: monGen(mi) });
    }
    if (typeof r.count === "number" && r.count > 0) {
      s = fill(r.count === 1 ? "rr.count1" : "rr.countN", { s: s, n: r.count });
    } else if (r.until) {
      s = fill("rr.until", { s: s, d: shortDate(r.until) });
    }
    return s;
  }
  function recurDesc(e) { return recurText(e.recur, (srcOf(e) || e).date); }

  // Time zone label: "London" from "Europe/London".
  function tzCity(tz) {
    var s = String(tz || "").split("/");
    return s[s.length - 1].replace(/_/g, " ");
  }
  // "09:00–10:00 London" — the event's own times, for zoned rows.
  function tzNote(e) {
    var s = srcOf(e);
    if (!e._zoned || !s || !s.start) return "";
    return s.start + (s.end ? "–" + s.end : "") + " " + tzCity(s.tz);
  }

  // Wave 2.1 — Contacts read-only feed. Same-origin iframe → shared
  // localStorage: reads the blob contacts.js owns. Read-only by
  // construction: absent/corrupt data → no feed events (standalone
  // Calendar unaffected). Feed events carry _feed/_contactId and
  // are NEVER written back (not stored, not synced, not exported).
  var CT_DATA_KEY = "oros-contacts-data";
  var contactsCache = { when: 0, data: {} };

  function contactsRaw() {
    // 1s micro-cache — month render calls eventsOn ~31× per paint.
    // Keeps a Contacts edit visible here within ~1s, without a
    // JSON.parse storm on every cell.
    var now = Date.now();
    if (now - contactsCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(CT_DATA_KEY));
        contactsCache.data = (d && typeof d === "object") ? d : {};
      } catch (e) { contactsCache.data = {}; }
      contactsCache.when = now;
    }
    return contactsCache.data;
  }

  // Mirrors contacts.js displayName() composition:
  // given+middle+family → nickname → org → "?"
  function ctName(c) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (c.nickname) return c.nickname;
    if (c.org) return c.org;
    return "?";
  }

  function feedLabelIdFor(type) {
    if (type === "birthday") return "lbl-feed-bday";
    if (type === "anniversary") return "lbl-feed-anniv";
    return "lbl-feed-custom";
  }

  function contactsFeedOn(dateStr) {
    // dateStr "YYYY-MM-DD" → tail is the "MM-DD" the contact
    // events carry (yearless by design: the day is the whole story).
    // contacts/dates.js decides which dates fall on the day (one copy
    // with the Today summary; 29 February shows on the 28th in years
    // without one).
    var out = [];
    var CD = window.OrosContactDates;
    var raw = contactsRaw();
    if (!CD || !Array.isArray(raw.contacts)) return out;
    CD.eventsOn(raw.contacts, dateStr, raw.deleted).forEach(function (x) {
      var c = x.contact, ev = x.ev;
      var labelId = feedLabelIdFor(ev.type);
      if (!labelVisible(labelId)) return;
      var who = ctName(c);
      out.push({
        id: "feed-" + c.id + "-" + x.ix,        // per-render key, never stored
        title: (ev.type === "custom" && ev.label)
          ? who + " · " + ev.label.slice(0, 40)
          : who,
        labelId: labelId,
        start: null,                            // all-day → sorted last
        _feed: true,
        _contactId: c.id
      });
    });
    return out;
  }
  
  // Wave 2.1 — Habits read-only feed. Reads completions from
  // oros-habits-data, injects completed habits as colored dots.
  // Same-origin localStorage → micro-cached for ~1s to avoid
  // JSON.parse storms during month render.
  var HBT_DATA_KEY = "oros-habits-data";
  var habitsCache = { when: 0, data: null };

  function habitsRaw() {
    var now = Date.now();
    if (now - habitsCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(HBT_DATA_KEY));
        habitsCache.data = (d && typeof d === "object" && Array.isArray(d.comps)) ? d : null;
      } catch (e) { habitsCache.data = null; }
      habitsCache.when = now;
    }
    return habitsCache.data;
  }

  // "Done" is habits/core.js (OrosHabitsCore.isDone), the app's own rule.
  function habitsFeedOn(dateStr) {
    var HC = window.OrosHabitsCore;
    var data = habitsRaw();
    if (!HC || !data || !Array.isArray(data.habits) || !Array.isArray(data.comps)) return [];
    
    var out = [];
    var livingHabits = data.habits.filter(function (h) { return h && !h.del; });
    
    livingHabits.forEach(function (h) {
      if (HC.isDone(data, h.id, dateStr)) {
        if (!labelVisible("lbl-feed-habits")) return;
        out.push({
          id: "habit-" + h.id + "-" + dateStr,
          title: h.name,
          labelId: "lbl-feed-habits",
          start: null,                    // all-day dot
          _feed: true,
          _habitId: h.id
        });
      }
    });
    
    return out;
  }

  // Wave 2.1 — Cycle read-only feed. Reads periods from
  // oros-cycle-data and paints every day inside a closed period
  // (start..end, inclusive) with the pink Cycle label. An OPEN
  // period (end null) paints ONLY its first day — projecting the
  // usual length forward would be a guess, and we never guess.
  // Tombstone map honored (stale open app on another tab).
  // Same-origin localStorage → micro-cached for ~1s.
  var CYC_DATA_KEY = "oros-cycle-data";
  var cycleCache = { when: 0, data: null };

  function cycleRaw() {
    var now = Date.now();
    if (now - cycleCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(CYC_DATA_KEY));
        cycleCache.data = (d && typeof d === "object") ? d : null;
      } catch (e) { cycleCache.data = null; }
      cycleCache.when = now;
    }
    return cycleCache.data;
  }

  function cycleFeedOn(dateStr) {
    var data = cycleRaw();
    if (!data || !Array.isArray(data.periods)) return [];
    if (!labelVisible("lbl-feed-cycle")) return [];

    var target = dparse(dateStr);   // local midnight of the cell
    var out = [];

    data.periods.forEach(function (p) {
      if (!p || typeof p !== "object" || typeof p.start !== "number" ||
          !isFinite(p.start)) return;
      if (data.deleted && data.deleted[p.id]) return;   // tombstone
      var ps = new Date(p.start);
      if (isNaN(ps.getTime())) return;
      ps.setHours(0, 0, 0, 0);
      var startTs = ps.getTime();
      var endTs = startTs;                                // open → day 1 only
      if (typeof p.end === "number" && isFinite(p.end) && p.end >= p.start) {
        var pe = new Date(p.end);
        if (!isNaN(pe.getTime())) {
          pe.setHours(0, 0, 0, 0);
          endTs = pe.getTime();
        }
      }
      if (target >= startTs && target <= endTs) {
        out.push({
          id: "cycle-" + p.id + "-" + dateStr,   // per-render key, never stored
          title: t("feed.cycle.period"),
          labelId: "lbl-feed-cycle",
          start: null,                           // all-day band
          _feed: true,
          _cycleId: p.id
        });
      }
    });
    return out;
  }

  // Wave 2.1 — Mood read-only feed. Reads entries from
  // oros-mood-data: every entry whose LOCAL calendar day matches
  // the cell becomes a purple all-day row. Title = note excerpt
  // when present, else the generic localized label. Tombstone
  // map honored. Micro-cached ~1s like the other feeds.
  var MOOD_DATA_KEY = "oros-mood-data";
  var moodCache = { when: 0, data: null };

  function moodRaw() {
    var now = Date.now();
    if (now - moodCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(MOOD_DATA_KEY));
        moodCache.data = (d && typeof d === "object" && Array.isArray(d.entries))
          ? d : null;
      } catch (e) { moodCache.data = null; }
      moodCache.when = now;
    }
    return moodCache.data;
  }

  function tsToLocalYmd(ts) {
    var dt = new Date(ts);
    if (isNaN(dt.getTime())) return null;
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function moodFeedOn(dateStr) {
    var data = moodRaw();
    if (!data || !Array.isArray(data.entries)) return [];
    if (!labelVisible("lbl-feed-mood")) return [];

    var out = [];
    data.entries.forEach(function (en) {
      if (!en || typeof en !== "object" ||
          typeof en.ts !== "number" || !isFinite(en.ts)) return;
      if (data.deleted && data.deleted[en.id]) return;   // tombstone
      if (tsToLocalYmd(en.ts) !== dateStr) return;
      out.push({
        id: "mood-" + en.id + "-" + dateStr,   // per-render key, never stored
        title: (typeof en.note === "string" && en.note.trim())
          ? en.note.trim().slice(0, 40)
          : t("feed.mood.entry"),
        labelId: "lbl-feed-mood",
        start: null,                            // all-day
        _feed: true,
        _moodId: en.id
      });
    });
    return out;
  }

  // Wave — Kanban read-only feed. Reads the multi-board blob
  // (oros-kanban-data) and surfaces every card carrying a due date
  // as an all-day event on that day. Title: "COLUMN · card text"
  // (decision record #3); the notes field lands in e.note, which
  // buildEvRow already renders (#4: description = detail, not
  // title clutter). ARCHIVED boards are skipped by design (#6):
  // hidden boards must not leak into the calendar. Feed rows are
  // never stored, synced or exported — micro-cached ~1s like the
  // other feeds.
  var KB_DATA_KEY = "oros-kanban-data";
  var kanbanCache = { when: 0, data: null };

  function kanbanRaw() {
    var now = Date.now();
    if (now - kanbanCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(KB_DATA_KEY));
        kanbanCache.data = (d && typeof d === "object" &&
                            Array.isArray(d.boards)) ? d : null;
      } catch (e) { kanbanCache.data = null; }
      kanbanCache.when = now;
    }
    return kanbanCache.data;
  }

  function kanbanFeedOn(dateStr) {
    var data = kanbanRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-kanban")) return [];

    var KC = window.OrosKanbanCore;
    if (!KC) return [];
    // kanban/core.js: archived boards skipped (#6); every column,
    // the last one included, shows on the Calendar.
    return KC.dueCards(data, dateStr, dateStr).map(function (x) {
      var bd = x.board, col = x.col, card = x.card;
      return {
        id: "kb-" + card.id + "-" + dateStr,   // per-render key, never stored
        title: (col.name || "").slice(0, 24) + " · " +
               (card.text || "").slice(0, 60),
        labelId: "lbl-feed-kanban",
        start: null,                           // all-day event
        note: (card.notes || "").slice(0, 500),
        _feed: true,
        _kanban: { boardId: bd.id, colId: col.id, cardId: card.id }
      };
    });
  }

  // Wave — To-Do read-only feed. Reads "oros-todo-data" (written
  // by todo.js, same-origin shared localStorage) and surfaces
  // every UNCOMPLETED task whose due date lands on the cell as an
  // all-day red row. Completed tasks are skipped — a due date
  // already taken care of is not calendar noise. Feed rows are
  // never stored, synced or exported; micro-cached ~1s like the
  // other feeds. Corrupt/absent blob simply yields no rows —
  // standalone Calendar unaffected.
  var TODO_DATA_KEY = "oros-todo-data";
  var todoCache = { when: 0, data: null };

  function todoRaw() {
    var now = Date.now();
    if (now - todoCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(TODO_DATA_KEY));
        todoCache.data = (d && typeof d === "object" &&
                          Array.isArray(d.lists)) ? d : null;
      } catch (e) { todoCache.data = null; }
      todoCache.when = now;
    }
    return todoCache.data;
  }

  function todoFeedOn(dateStr) {
    var data = todoRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-todo")) return [];

    var TC = window.OrosTodoCore;
    if (!TC) return [];
    // todo/core.js: open tasks due on the day (one copy with the shell
    // reminder and the Today summary).
    return TC.dueOn(data, dateStr).map(function (x) {
      var list = x.list, item = x.item;
      return {
        id: "tdo-" + item.id + "-" + dateStr,   // per-render key, never stored
        title: (item.text || "").slice(0, 60),
        labelId: "lbl-feed-todo",
        start: null,                           // all-day
        note: (item.notes || "").slice(0, 500),
        _feed: true,
        _todo: { listId: list.id, itemId: item.id }
      };
    });
  }

  // Workouts read-only feed. Reads "oros-fitness-data" (written by
  // fitness.js) and surfaces every FINISHED workout as an all-day row
  // on its day: "Push · 18:30 · 52′". A running workout (en = 0) is
  // left out. Feed rows are never stored, synced or exported;
  // micro-cached ~1s like the other feeds. Corrupt/absent data
  // yields no rows.
  var FIT_DATA_KEY = "oros-fitness-data";
  var fitCache = { when: 0, data: null };

  function fitRaw() {
    var now = Date.now();
    if (now - fitCache.when > 1000) {
      try {
        var d = JSON.parse(localStorage.getItem(FIT_DATA_KEY));
        fitCache.data = (d && typeof d === "object" && Array.isArray(d.wo)) ? d : null;
      } catch (e) { fitCache.data = null; }
      fitCache.when = now;
    }
    return fitCache.data;
  }

  function fitnessFeedOn(dateStr) {
    var data = fitRaw();
    if (!data) return [];
    if (!labelVisible("lbl-feed-fitness")) return [];
    var out = [];
    data.wo.forEach(function (w) {
      if (!w || w.d !== dateStr || typeof w.id !== "string" ||
          !(typeof w.en === "number" && w.en > 0) || typeof w.st !== "number") return;
      var st = new Date(w.st), mins = Math.max(0, Math.round((w.en - w.st) / 60000));
      var hhmm = (st.getHours() < 10 ? "0" : "") + st.getHours() + ":" +
                 (st.getMinutes() < 10 ? "0" : "") + st.getMinutes();
      var title = (typeof w.ti === "string" && w.ti) ? w.ti : t("lbl.feed.fitness");
      out.push({
        id: "fit-" + w.id,                       // per-render key, never stored
        title: (title.slice(0, 40) + " · " + hhmm + " · " + mins + "′"),
        labelId: "lbl-feed-fitness",
        start: null,                             // all-day
        note: (typeof w.n === "string" ? w.n : "").slice(0, 500),
        _feed: true,
        _fitnessId: w.id
      });
    });
    return out;
  }

  // Timesheet read-only feed (Timesheet Wave 4). Reads
  // "oros-timesheet-data" with timesheet/core.js (the SAME file the
  // app runs; index.html loads it) and shows one all-day row per
  // project per day: "Website · 2:15" (▶ while its timer runs).
  // Exact times, no rounding; an entry across midnight counts on
  // each day. The chip's on/off state is remembered on this device
  // (STICKY_FEEDS). Click → Timesheet on that day. Never stored,
  // synced or exported; parsed at most once a second.
  var TS_DATA_KEY = "oros-timesheet-data";
  var tsCache = { when: 0, raw: null, data: null };
  function tsData() {
    var C = window.orosTimesheetCore;
    if (!C) return null;
    var now = Date.now();
    if (now - tsCache.when > 1000) {
      tsCache.when = now;
      var raw = null;
      try { raw = localStorage.getItem(TS_DATA_KEY); } catch (e) { raw = null; }
      if (raw !== tsCache.raw) {
        tsCache.raw = raw;
        tsCache.data = raw ? C.parse(raw) : null;
      }
    }
    return tsCache.data;
  }
  function timesheetFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-time")) return [];
    var data = tsData();
    if (!data || !data.entries.length) return [];
    var C = window.orosTimesheetCore;
    return C.dayFeed(data, dateStr, Date.now()).filter(function (r) {
      return r.ms >= 60000;                    // under a minute: not worth a row
    }).map(function (r) {
      var name = r.name || t("feed.time.noproj");
      return {
        id: "ts-" + dateStr + "-" + (r.pid || "none"),   // per-render key, never stored
        title: (r.running ? "▶ " : "") + name.slice(0, 40) + " · " + C.fmtDur(r.ms),
        labelId: "lbl-feed-time",
        start: null,                             // all-day
        note: r.notes.join(" · ").slice(0, 500),
        _feed: true,
        _openAt: { app: "timesheet", target: { day: dateStr } }
      };
    });
  }

  // CRM read-only feed (crm/core.js, loaded by index.html: the same
  // follow-up list as the app's Agenda, OrosCrmCore.calendarOn). An
  // open follow-up on its day, at its time when it has one (late ones
  // on today, marked); a done one on the day it was done (✓); an open
  // deal on its expected close day. Rows are never stored;
  // micro-cached ~1s. Click → __orosOpenAt("crm", { fup | deal }).
  var crmCache = { when: 0, data: null };
  function crmData() {
    var C = window.OrosCrmCore, now = Date.now();
    if (!C) return null;
    if (now - crmCache.when > 1000) {
      crmCache.data = null;
      try {
        var raw = JSON.parse(localStorage.getItem("oros-crm-data"));
        if (raw && typeof raw === "object" && Array.isArray(raw.cust)) crmCache.data = C.norm(raw);
      } catch (e) { crmCache.data = null; }
      crmCache.when = now;
    }
    return crmCache.data;
  }
  function crmFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-crm")) return [];
    var data = crmData();
    if (!data || !data.cust.length) return [];
    var C = window.OrosCrmCore;
    var today = C.ymdOf(Date.now());
    return C.calendarOn(data, dateStr, today).map(function (r) {
      var x = r.fup || r.deal;
      var c = C.byId(data.cust, x.cust);
      var who = c ? C.custName(c) : "";
      var title = r.fup
        ? (r.k === "done" ? "✓ " : (r.k === "late" ? t("feed.crm.late") + ": " : "")) + x.text
        : t("feed.crm.close") + ": " + x.title;
      return {
        id: "crm-" + r.k + "-" + x.id + "-" + dateStr,   // per-render key, never stored
        title: (who ? who + " · " : "") + title,
        labelId: "lbl-feed-crm",
        start: r.fup && r.k !== "done" && x.t ? x.t : null,
        end: null,
        _feed: true,
        _openAt: { app: "crm", target: r.fup ? { fup: x.id } : { deal: x.id } }
      };
    });
  }

  // Health medicines read-only feed (health/core.js, loaded by
  // index.html; OrosHealthCore.calendarOn): a course's first and last
  // day and the day a counted medicine runs out. Opt-in (health data
  // is sensitive): the chip starts off (OPT_IN_FEEDS). Click → Health
  // with that medicine open (__orosOpenAt("health", {med})). Never
  // stored; parsed at most once a second.
  var medsCache = { when: 0, data: null };
  function medsData() {
    var now = Date.now(), C = window.OrosHealthCore;
    if (!C || typeof C.calendarOn !== "function") return null;
    if (now - medsCache.when > 1000) {
      medsCache.data = null;
      try {
        var d = JSON.parse(localStorage.getItem("oros-health-data"));
        if (d && typeof d === "object" && Array.isArray(d.md) && d.md.length) medsCache.data = C.merge(d, d);
      } catch (e) { medsCache.data = null; }
      medsCache.when = now;
    }
    return medsCache.data;
  }
  function medsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-meds")) return [];
    var data = medsData();
    if (!data) return [];
    return window.OrosHealthCore.calendarOn(data, dateStr, Date.now()).map(function (r) {
      return {
        id: "md-" + r.k + "-" + r.med.id + "-" + dateStr,   // per-render key, never stored
        title: t("feed.md." + r.k).replace("{name}", r.med.n + (r.med.s ? " " + r.med.s : "")),
        labelId: "lbl-feed-meds",
        start: null,
        end: null,
        _feed: true,
        _openAt: { app: "health", target: { med: r.med.id } }
      };
    });
  }

  // Health doctor's appointments read-only feed (Health wave 3,
  // OrosHealthCore.recordOn): each appointment at its time (and end
  // when it has a duration), and the day a vaccination's next dose is
  // due. Opt-in like Medicines (sensitive). Click → Health with that
  // appointment / vaccination open. Never stored.
  var apptsCache = { when: 0, data: null };
  function apptsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-appts")) return [];
    var C = window.OrosHealthCore, now = Date.now();
    if (!C || typeof C.recordOn !== "function") return [];
    if (now - apptsCache.when > 1000) {
      apptsCache.data = null;
      try {
        var d = JSON.parse(localStorage.getItem("oros-health-data"));
        if (d && typeof d === "object" && ((Array.isArray(d.ap) && d.ap.length) || (Array.isArray(d.vx) && d.vx.length))) apptsCache.data = C.merge(d, d);
      } catch (e) { apptsCache.data = null; }
      apptsCache.when = now;
    }
    if (!apptsCache.data) return [];
    function hm(ms) { var x = new Date(ms); return (x.getHours() < 10 ? "0" : "") + x.getHours() + ":" + (x.getMinutes() < 10 ? "0" : "") + x.getMinutes(); }
    return C.recordOn(apptsCache.data, dateStr).map(function (r) {
      if (r.k === "vx") {
        return { id: "vx-" + r.vx.id + "-" + dateStr, title: t("feed.ap.vx").replace("{name}", r.vx.n), labelId: "lbl-feed-appts",
                 start: null, end: null, _feed: true, _openAt: { app: "health", target: { vax: r.vx.id } } };
      }
      var a = r.ap;
      return {
        id: "ap-" + a.id + "-" + dateStr,                 // per-render key, never stored
        title: (a.dr && a.sp ? a.dr + " · " + a.sp : (a.dr || a.sp)) + (a.pl ? " · " + a.pl : ""),
        labelId: "lbl-feed-appts",
        start: hm(a.at),
        end: a.du && new Date(a.at + a.du * 60000).getDate() === new Date(a.at).getDate() ? hm(a.at + a.du * 60000) : null,
        _feed: true,
        _openAt: { app: "health", target: { appt: a.id } }
      };
    });
  }

  // Family Tree read-only feed (familytree/ft-core.js, loaded by
  // index.html): every year on the day of an exact death date (29 Feb
  // also on 28 Feb of common years), "Name · N years since death".
  // The day index is rebuilt only when the stored blob changes.
  // Click → Family Tree centred on the person (generic deep link).
  var FT_DATA_KEY = "oros-familytree-data";
  var ftCache = { when: 0, raw: null, idx: null };
  function ftIndex() {
    var F = window.FTCore;
    if (!F) return null;
    var now = Date.now();
    if (now - ftCache.when > 1000) {
      ftCache.when = now;
      var raw = null;
      try { raw = localStorage.getItem(FT_DATA_KEY); } catch (e) { raw = null; }
      if (raw !== ftCache.raw) {
        ftCache.raw = raw;
        ftCache.idx = null;
        try { if (raw) ftCache.idx = F.deathDays(JSON.parse(raw)); } catch (e) { ftCache.idx = null; }
      }
    }
    return ftCache.idx;
  }
  function familyTreeFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-famtree")) return [];
    var idx = ftIndex();
    if (!idx) return [];
    return window.FTCore.deathAnniversaries(idx, dateStr).map(function (r) {
      return {
        id: "ft-" + dateStr + "-" + r.pid,       // per-render key, never stored
        title: t(r.years === 1 ? "feed.famtree.one" : "feed.famtree.n")
                 .replace("{name}", r.name.slice(0, 60)).replace("{n}", String(r.years)),
        labelId: "lbl-feed-famtree",
        start: null,                             // all-day
        _feed: true,
        _openAt: { app: "familytree", target: { person: r.pid } }
      };
    });
  }

  // Moon & Sky read-only feed (sky/core.js, loaded by index.html): the
  // four main Moon phases, equinoxes and solstices, meteor shower peaks
  // and eclipses, computed on the device, nothing stored. Opt-in: the
  // chip starts off and its state is remembered here (OPT_IN_FEEDS).
  // Click → Moon & Sky on that day.
  function skyFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-sky")) return [];
    var Core = window.OrosSkyCore;
    if (!Core) return [];
    return Core.feedFor(dateStr, LB).map(function (r, i) {
      var d = new Date(r.t);
      return {
        id: "sky-" + dateStr + "-" + i,          // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-sky",
        start: r.allDay ? null : (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(),
        _feed: true,
        _openAt: { app: "sky", target: { date: dateStr } }
      };
    });
  }

  // Wave 5 — Screen Pet read-only feed (pet.js v0.3). Two sources:
  //   1. "oros-pet-data" (SYNCED identity) → birthday row on every
  //      local-day anniversary of birthTs (birth day excluded) —
  //      every device agrees on the day, even with an empty log.
  //   2. "oros-pet-events" (DEVICE-LOCAL rolling log) → care rows
  //      (fed/petted/sleep/wake/new pet/catch) on their day.
  // Opt-out: "oros-pet-calendar-sync" === "0" (device-local, shell
  // toggle). Feed rows are never stored, synced or exported;
  // micro-cached ~1s like the other feeds. Corrupt/absent blobs
  // simply yield no rows — standalone load is unaffected.
  var PET_DATA_KEY   = "oros-pet-data";
  var PET_LOG_KEY    = "oros-pet-events";
  var PET_OPTOUT_KEY = "oros-pet-calendar-sync";
  var petCache = { when: 0, optOut: false, petData: null, logData: null };

  function petRaw() {
    var now = Date.now();
    if (now - petCache.when > 1000) {
      try {
        petCache.optOut = localStorage.getItem(PET_OPTOUT_KEY) === "0";
        petCache.petData = JSON.parse(localStorage.getItem(PET_DATA_KEY)) || null;
        petCache.logData = JSON.parse(localStorage.getItem(PET_LOG_KEY)) || null;
      } catch (e) {
        petCache.petData = null;
        petCache.logData = null;
      }
      petCache.when = now;
    }
    return petCache;
  }

  // Log type → i18n title key. "birthday" log entries are skipped:
  // the computed birthTs row above is the richer source and the
  // two must never double up on the same cell.
  var PET_TITLE_KEYS = {
    feed:   "feed.pet.feed",
    pet:    "feed.pet.pet",
    sleep:  "feed.pet.sleep",
    wake:   "feed.pet.wake",
    newpet: "feed.pet.newpet",
    catch:  "feed.pet.catch"
  };

  function petFeedOn(dateStr) {
    var c = petRaw();
    if (c.optOut) return [];
    if (!labelVisible("lbl-feed-pet")) return [];

    var out = [];
    var pet = (c.petData && c.petData.pet &&
               typeof c.petData.pet === "object") ? c.petData.pet : null;

    // 1. Birthday — computed from the synced birthTs
    // (namedays.js petBirthday: the rule the Today summary uses too)
    var ND = window.OrosNamedays;
    if (pet && ND && typeof ND.petBirthday === "function") {
      if (ND.petBirthday(pet, dateStr) > 0) {
        out.push({
          id: "pet-bday-" + dateStr,        // per-render key, never stored
          title: t("feed.pet.bday")
            .replace("{name}", String(pet.name || "?")),
          labelId: "lbl-feed-pet",
          start: null,                      // all-day
          _feed: true,
          _petOpen: true
        });
      }
    }

    // 2. Care events from the device-local log (local YMD match —
    // same convention as the Mood feed's tsToLocalYmd)
    var events = (c.logData && Array.isArray(c.logData.events))
      ? c.logData.events : [];
    events.forEach(function (ev) {
      if (!ev || typeof ev.ts !== "number" || !isFinite(ev.ts)) return;
      var key = PET_TITLE_KEYS[String(ev.type)];
      if (key === undefined) return;
      if (tsToLocalYmd(ev.ts) !== dateStr) return;
      out.push({
        id: "pet-" + ev.id + "-" + dateStr, // per-render key, never stored
        title: t(key)
          .replace("{name}", String(ev.name || (pet && pet.name) || "?")),
        labelId: "lbl-feed-pet",
        start: null,                        // all-day
        _feed: true,
        _petOpen: true,
        _petEvId: String(ev.id)
      });
    });
    return out;
  }

  // Chore Wheel read-only feed (chores/core.js, loaded by index.html:
  // the same who-does-what as the app and the shell reminder). Each
  // chore shows on the day its period starts (a weekly one on its
  // Monday, a monthly one on the 1st), ✓ when done. With "who are you
  // on this device" set in the app, only your own chores; otherwise
  // everyone's, with the name. Only ±60 days around today. Rows are
  // never stored; micro-cached ~1s like the other feeds.
  var CHORES_DATA_KEY = "oros-chores-data", CHORES_HH_KEY = "oros-chores-hh";
  var choresCache = { when: 0, list: null, today: 0 };

  // [{ data, me }]: the own wheel, then the wheels shared with a
  // household (the device-local mirror chores/house.js keeps, BR-HH).
  function choresRaw() {
    var now = Date.now();
    var Core = window.OrosChoresCore;
    if (!Core) return null;
    if (now - choresCache.when > 1000) {
      var list = [];
      try {
        var d = JSON.parse(localStorage.getItem(CHORES_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.tasks) && d.tasks.length) {
          list.push({ data: Core.mergeChores(d, d, now), me: Core.readPrefs(JSON.parse(localStorage.getItem("oros-chores-prefs"))).me });
        }
      } catch (e) {}
      try {
        var hh = JSON.parse(localStorage.getItem(CHORES_HH_KEY));
        (hh && Array.isArray(hh.wheels) ? hh.wheels : []).forEach(function (w) {
          if (w && w.data && typeof w.data === "object") list.push({ data: Core.mergeChores(w.data, w.data, now), me: typeof w.me === "string" ? w.me : "" });
        });
      } catch (e) {}
      choresCache.list = list.length ? list : null;
      choresCache.today = Core.localDn(new Date(now));
      choresCache.when = now;
    }
    return choresCache.list ? choresCache : null;
  }

  function choresFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-chores")) return [];
    var c = choresRaw();
    if (!c) return [];
    var Core = window.OrosChoresCore, n = Core.ymdToDn(dateStr);
    if (isNaN(n) || Math.abs(n - c.today) > 60) return [];
    var out = [];
    c.list.forEach(function (w) {
      var mine = !!(w.me && Core.memberById(w.data, w.me));
      Core.feedRows(w.data, n, w.me).forEach(function (r) {
        var title = (r.state === 1 ? "✓ " : "") + (r.task.icon ? r.task.icon + " " : "") + r.task.name;
        if (!mine && r.name) title += " · " + r.name;
        out.push({
          id: "chr-" + r.key,                     // per-render key, never stored
          title: title.slice(0, 80),
          labelId: "lbl-feed-chores",
          start: null,                            // all-day
          _feed: true,
          _choresDay: dateStr
        });
      });
    });
    return out;
  }

  // Plant Care read-only feed (plants/core.js, loaded by index.html:
  // the same schedule math as the app and the shell reminder).
  // Past days and today: what was done (skips are not shown).
  // Today: every task due or late. Future days: only each task's
  // NEXT due day, never a projection months ahead. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var PLANTS_DATA_KEY = "oros-plants-data";
  var plantsCache = { when: 0, data: null, today: "", due: null };

  function plantsRaw() {
    var now = Date.now();
    var Core = window.OrosPlantsCore;
    if (!Core) return null;
    if (now - plantsCache.when > 1000) {
      plantsCache.data = null;
      plantsCache.due = null;
      try {
        var d = JSON.parse(localStorage.getItem(PLANTS_DATA_KEY));
        // plants shared with a household (plants/house.js mirror, BR-HH):
        // each garden merged on its own, then shown next to the own ones
        var hh = null;
        try { hh = JSON.parse(localStorage.getItem("oros-plants-hh")); } catch (e) {}
        var gardens = hh && Array.isArray(hh.gardens) ? hh.gardens : [];
        if ((d && typeof d === "object" && Array.isArray(d.plants)) || gardens.length) {
          var all = Core.merge(d && Array.isArray(d.plants) ? d : null, null, now);
          gardens.forEach(function (g) {
            if (!g || !g.data || typeof g.data !== "object") return;
            var x = Core.merge(g.data, g.data, now);
            all.plants = all.plants.concat(x.plants);
            all.log = all.log.concat(x.log);
          });
          plantsCache.data = all;
          var prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-plants-prefs")));
          plantsCache.today = Core.ymdOf(new Date(now));
          plantsCache.due = Core.tasks(plantsCache.data, plantsCache.today, 400, prefs.hemi);
        }
      } catch (e) { plantsCache.data = null; plantsCache.due = null; }
      plantsCache.when = now;
    }
    return plantsCache.data ? plantsCache : null;
  }

  function plantsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-plants")) return [];
    var c = plantsRaw();
    if (!c) return [];
    var names = {};
    c.data.plants.forEach(function (p) { names[p.id] = p.name; });
    var out = [];
    if (dateStr <= c.today) {
      c.data.log.forEach(function (e) {
        if (e.d !== dateStr || e.s || !names[e.p]) return;
        out.push({
          id: "plt-" + e.id,                    // per-render key, never stored
          title: t("feed.plants.done").replace("{name}", names[e.p])
                   .replace("{kind}", t("feed.plants." + e.k)),
          labelId: "lbl-feed-plants",
          start: null,                          // all-day
          _feed: true,
          _plantId: e.p
        });
      });
    }
    if (dateStr >= c.today) {
      c.due.forEach(function (tk) {
        if (dateStr === c.today ? tk.due > dateStr : tk.due !== dateStr) return;
        out.push({
          id: "plt-" + tk.key + "-" + dateStr,  // per-render key, never stored
          title: t("feed.plants.due").replace("{name}", tk.plant.name)
                   .replace("{kind}", t("feed.plants." + tk.kind)),
          labelId: "lbl-feed-plants",
          start: null,
          _feed: true,
          _plantId: tk.plant.id
        });
      });
    }
    return out;
  }

  // Pet Health Book read-only feed (petcare/core.js, loaded by
  // index.html: the same "what is due" math as the app and the shell
  // reminder). Past days and today: vaccines, deworming and vet
  // visits that happened. Today: everything due or late. Future
  // days: only each item's NEXT due day. Birthdays every year (full
  // birth dates only). Pets that are gone show their history, no
  // due dates. Rows are never stored; micro-cached ~1s.
  var PETCARE_DATA_KEY = "oros-petcare-data";
  var petcareCache = { when: 0, data: null, today: "", due: null };

  function petcareRaw() {
    var now = Date.now();
    var Core = window.OrosPetcareCore;
    if (!Core) return null;
    if (now - petcareCache.when > 1000) {
      petcareCache.data = null;
      petcareCache.due = null;
      try {
        var d = JSON.parse(localStorage.getItem(PETCARE_DATA_KEY));
        // shared books (BR-HH wave 7c): a pet in a household is read from there
        if (window.OrosPetcareHouse) d = window.OrosPetcareHouse.withShared(d && Array.isArray(d.pets) ? d : null);
        if (d && typeof d === "object" && Array.isArray(d.pets)) {
          petcareCache.data = Core.merge(d, d, now);
          petcareCache.today = Core.ymdOf(new Date(now));
          petcareCache.due = Core.items(petcareCache.data, petcareCache.today);
        }
      } catch (e) { petcareCache.data = null; petcareCache.due = null; }
      petcareCache.when = now;
    }
    return petcareCache.data ? petcareCache : null;
  }

  function petcareWhat(kind, sub, label) {
    if (kind === "vacc") return label;
    if (kind === "deworm") return t("feed.pc.deworm") + (label ? " (" + label + ")" : "");
    if (kind === "visit") return label || t("feed.pc.visit");
    if (kind === "recheck") return t("feed.pc.recheck") + (label ? " (" + label + ")" : "");
    if (kind === "care") return t("feed.pc.care." + sub);
    return t("feed.pc.food");
  }

  function petcareFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-petcare")) return [];
    var c = petcareRaw();
    if (!c) return [];
    var Core = window.OrosPetcareCore;
    var names = {}, out = [];
    function row(id, title, petId) {
      out.push({
        id: "pcf-" + id,                        // per-render key, never stored
        title: title,
        labelId: "lbl-feed-petcare",
        start: null,                            // all-day
        _feed: true,
        _petcareId: petId
      });
    }
    c.data.pets.forEach(function (p) {
      names[p.id] = p.name;
      var n = p.gone ? 0 : Core.birthdayOn(p, dateStr);
      if (n) row("bd-" + p.id + "-" + dateStr, t("feed.pc.bday").replace("{name}", p.name).replace("{n}", n), p.id);
    });
    if (dateStr <= c.today) {
      c.data.recs.forEach(function (r) {
        if (r.d !== dateStr || !names[r.p] ||
            (r.k !== "vacc" && r.k !== "deworm" && r.k !== "visit")) return;
        row(r.id, t("feed.pc.done").replace("{name}", names[r.p])
                     .replace("{what}", petcareWhat(r.k, "", r.n)), r.p);
      });
    }
    if (dateStr >= c.today) {
      c.due.forEach(function (it) {
        if (dateStr === c.today ? it.due > dateStr : it.due !== dateStr) return;
        var title = it.kind === "med"
          ? t("feed.pc.medDue").replace("{name}", it.pet.name).replace("{what}", it.label)
          : t("feed.pc.due").replace("{name}", it.pet.name)
              .replace("{what}", petcareWhat(it.kind === "visit" ? "recheck" : it.kind, it.sub, it.label));
        row(it.key + "-" + dateStr, title, it.pet.id);
      });
    }
    return out;
  }

  // Baby read-only feed (baby/core.js, loaded by index.html: the
  // same rows the app's own data gives). Milestones, vaccines and
  // doctor visits on their day; "N months old today" up to 2 years,
  // then birthdays. Deleted children stay out. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var babyCache = { when: 0, data: null };

  function babyData() {
    var now = Date.now();
    var Core = window.orosBabyCore;
    if (!Core) return null;
    if (now - babyCache.when > 1000) {
      babyCache.data = null;
      try { babyCache.data = Core.parse(localStorage.getItem(Core.STORAGE_KEY)); } catch (e) {}
      babyCache.when = now;
    }
    return babyCache.data;
  }

  function babyFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-baby")) return [];
    var d = babyData();
    if (!d || !d.kids.length) return [];
    return window.orosBabyCore.calendarRows(d, dateStr, LB).map(function (r) {
      return {
        id: "bbf-" + r.id,                      // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-baby",
        start: null,                            // all-day
        _feed: true,
        _babyOpen: true
      };
    });
  }

  // Together read-only feed (together/core.js, loaded by index.html:
  // TogetherCore.dayRows, the same rows as Today): anniversaries, every
  // 100 days / 50 weeks, fun numbers, the start day, moments and
  // special days marked every year, meetings. Discreet relationships
  // show initials. A row opens Together on that relationship (or
  // moment). Rows are never stored; micro-cached ~1s.
  var togetherCache = { when: 0, data: null, idx: null };
  function togetherFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-together")) return [];
    var Core = window.TogetherCore;
    if (!Core) return [];
    var now = Date.now();
    if (now - togetherCache.when > 1000) {
      togetherCache.data = null;
      try {
        var raw = JSON.parse(localStorage.getItem(Core.STORAGE_KEY) || "null");
        if (window.TogetherHouse) raw = window.TogetherHouse.withShared(raw);   // shared relationships (BR-HH wave 7d)
        if (raw && Array.isArray(raw.rels) && raw.rels.length) {
          togetherCache.data = Core.normalize(raw);
          togetherCache.idx = Core.contactIndex(JSON.parse(localStorage.getItem("oros-contacts-data") || "null"));
        }
      } catch (e) {}
      togetherCache.when = now;
    }
    if (!togetherCache.data) return [];
    return Core.dayRows(togetherCache.data, togetherCache.idx, dateStr, LANG).map(function (r) {
      return {
        id: "tgf-" + r.id,                      // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-together",
        start: null,                            // all-day
        _feed: true,
        _openAt: { app: "together", target: r.target }
      };
    });
  }

  // Garage read-only feed (garage/core.js, loaded by index.html: the
  // same math as the app and the shell reminder). Renewals on their
  // expiry day, service plans on their due (or estimated) day; only
  // the NEXT occurrence, never a projection. Anything already passed
  // shows on today. Archived vehicles stay out. Rows are never
  // stored; micro-cached ~1s like the other feeds.
  var GARAGE_DATA_KEY = "oros-garage-data";
  var garageCache = { when: 0, rows: null, today: "" };

  function garageRows() {
    var now = Date.now();
    var Core = window.OrosGarageCore;
    if (!Core) return null;
    if (now - garageCache.when > 1000) {
      garageCache.rows = null;
      try {
        var d = JSON.parse(localStorage.getItem(GARAGE_DATA_KEY));
        if (window.OrosGarageHouse) d = window.OrosGarageHouse.withShared(d && Array.isArray(d.vehicles) ? d : null);   // shared vehicles (BR-HH wave 7e)
        if (d && typeof d === "object" && Array.isArray(d.vehicles) && d.vehicles.length) {
          d = Core.merge(d, d, now);
          var today = Core.ymdOf(new Date(now)), names = {}, rows = [];
          d.vehicles.forEach(function (v) { if (!v.arch) names[v.id] = v.name; });
          d.renewals.forEach(function (r) {
            if (!names[r.v]) return;
            var what = r.kind === "other" && r.label ? r.label : t("feed.garage." + r.kind);
            rows.push({ day: r.exp < today ? today : r.exp, id: r.id, key: "r" + r.id,
              title: t(r.exp < today ? "feed.garage.expired" : "feed.garage.exp")
                .replace("{vehicle}", names[r.v]).replace("{what}", what) });
          });
          d.plans.forEach(function (p) {
            if (!names[p.v]) return;
            var st = Core.planStatus(p, d, today);
            if (!st.when && st.level !== "due") return;
            var item = p.item === "other" && p.label ? p.label : t("feed.garage.service");
            if (p.item !== "other") item = Core.itemName(p.item, LB);
            rows.push({ day: !st.when || st.when < today ? today : st.when, id: p.id, key: "p" + p.id,
              title: t("feed.garage.svc").replace("{vehicle}", names[p.v]).replace("{what}", item) });
          });
          garageCache.rows = rows;
          garageCache.today = today;
        }
      } catch (e) { garageCache.rows = null; }
      garageCache.when = now;
    }
    return garageCache.rows;
  }

  function garageFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-garage")) return [];
    var rows = garageRows();
    if (!rows || dateStr < garageCache.today) return [];
    var out = [];
    rows.forEach(function (r) {
      if (r.day !== dateStr) return;
      out.push({
        id: "grg-" + r.key + "-" + dateStr,     // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-garage",
        start: null,                            // all-day
        _feed: true,
        _garageId: r.id
      });
    });
    return out;
  }

  // Travel read-only feed (travel/core.js, loaded by index.html: the
  // same reading as the shell reminder). Each trip shows on every day
  // of its dates (all-day, "Rome · day 2/5"); itinerary entries that
  // have a day and a time show at that time. Rows are never stored;
  // micro-cached ~1s like the other feeds. Click → the trip in Travel
  // (timed rows open its itinerary).
  var TRAVEL_DATA_KEY = "oros-travel-data";
  var travelCache = { when: 0, rows: null };

  function travelRows() {
    var now = Date.now();
    var Core = window.OrosTravelCore;
    if (!Core) return null;
    if (now - travelCache.when > 1000) {
      travelCache.rows = null;
      try {
        var raw = localStorage.getItem(TRAVEL_DATA_KEY);
        if (raw) travelCache.rows = Core.feedRows(Core.trips(JSON.parse(raw)));
      } catch (e) { travelCache.rows = null; }
      travelCache.when = now;
    }
    return travelCache.rows;
  }

  function travelFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-travel")) return [];
    var rows = travelRows();
    if (!rows) return [];
    var Core = window.OrosTravelCore, out = [];
    rows.forEach(function (r) {
      if (r.day !== dateStr) return;
      var title = r.kind === "trip"
        ? (r.of > 1 ? t("feed.travel.day").replace("{name}", r.name).replace("{n}", r.n).replace("{of}", r.of) : r.name)
        : Core.entryTitle(r.entry, LB);
      out.push({
        id: "trv-" + r.key,                     // per-render key, never stored
        title: title,
        labelId: "lbl-feed-travel",
        start: r.start,                         // null = all-day
        end: r.end,
        _feed: true,
        _travel: { trip: r.trip, tab: r.kind === "trip" ? "" : "plan" }
      });
    });
    return out;
  }

  // Meal Planner read-only feed (meals/core.js, loaded by index.html).
  // One all-day row per planned meal: "Dinner: Fasolada, Salad", in the
  // slots the app shows, with the user's own slot names. Ready recipes
  // are named in this device's language; deleted recipes are left out.
  // Rows are never stored; micro-cached ~1s like the other feeds.
  var MEALS_DATA_KEY = "oros-meals-data";
  var mealsCache = { when: 0, rows: null };

  function mealsRows() {
    var now = Date.now();
    var Core = window.OrosMealsCore;
    if (!Core) return null;
    if (now - mealsCache.when > 1000) {
      mealsCache.rows = null;
      try {
        var raw = JSON.parse(localStorage.getItem(MEALS_DATA_KEY));
        if (raw && typeof raw === "object" && raw.pl && typeof raw.pl === "object") {
          var plan = Core.planByDay(raw, LB), rows = {};
          Object.keys(plan).forEach(function (day) {
            rows[day] = plan[day].map(function (r) {
              return { key: r.slot, order: r.order, title: (r.name || t("feed.meals." + r.slot)) + ": " + r.what.join(", ") };
            });
          });
          mealsCache.rows = rows;
        }
      } catch (e) { mealsCache.rows = null; }
      mealsCache.when = now;
    }
    return mealsCache.rows;
  }

  function mealsFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-meals")) return [];
    var rows = mealsRows();
    if (!rows || !rows[dateStr]) return [];
    return rows[dateStr].slice().sort(function (a, b) { return a.order - b.order; }).map(function (r) {
      return {
        id: "mls-" + dateStr + "-" + r.key,       // per-render key, never stored
        title: r.title,
        labelId: "lbl-feed-meals",
        start: null,                              // all-day
        _feed: true,
        _openAt: { app: "meals", target: { day: dateStr } }
      };
    });
  }

  // Budget read-only feed (budget/feed.js, loaded by index.html: the
  // same occurrence rules as the app). Upcoming occurrences of the
  // recurring entries, today and later only (earlier ones are real
  // entries in Budget by then). "Rent −€500.00" / "Salary +€1,200.00".
  // Rows are never stored; the blob is micro-cached ~1s like the
  // other feeds. Click → Budget opens that recurring entry.
  var BUDGET_DATA_KEY = "oros-budget-data";
  var budgetCache = { when: 0, data: null, fmt: null, fmtCur: "", fmtLang: "" };

  function budgetData() {
    var now = Date.now();
    if (now - budgetCache.when > 1000) {
      budgetCache.data = null;
      try {
        var d = JSON.parse(localStorage.getItem(BUDGET_DATA_KEY));
        if (d && typeof d === "object" && Array.isArray(d.rec) && d.rec.length) budgetCache.data = d;
      } catch (e) {}
      budgetCache.when = now;
    }
    return budgetCache.data;
  }
  function budgetMoney(cents, cur) {
    if (!budgetCache.fmt || budgetCache.fmtCur !== cur || budgetCache.fmtLang !== LANG) {
      try {
        budgetCache.fmt = new Intl.NumberFormat(loc(), { style: "currency", currency: cur });
      } catch (e) {
        budgetCache.fmt = { format: function (v) { return v.toFixed(2) + " " + cur; } };
      }
      budgetCache.fmtCur = cur;
      budgetCache.fmtLang = LANG;
    }
    return budgetCache.fmt.format(cents / 100);
  }

  function budgetFeedOn(dateStr) {
    var F = window.OrosBudgetFeed;
    if (!F || !labelVisible("lbl-feed-budget")) return [];
    var d = budgetData();
    if (!d) return [];
    return F.rowsOn(d, dateStr, todayYMD(), LB).map(function (r) {
      return {
        id: "bud-" + r.id + "-" + dateStr,      // per-render key, never stored
        title: (r.name ? r.name + " " : "") + (r.k === "o" ? "\u2212" : "+") + budgetMoney(r.a, r.cur),
        labelId: "lbl-feed-budget",
        start: null,                            // all-day
        _feed: true,
        _budgetRec: r.id
      };
    });
  }

  // Media Shelf read-only feed (shelf/feed.js, loaded by index.html):
  // finishes ("Finished: Dune") on their day and wishlist release dates
  // ("Release: …"). Rows are never stored; the day map is micro-cached
  // ~1s like the other feeds. Click → Media Shelf opens that title.
  var SHELF_DATA_KEY = "oros-shelf-data";
  var shelfCache = { when: 0, days: null };

  function shelfDays() {
    var now = Date.now(), F = window.OrosShelfFeed;
    if (!F) return null;
    if (now - shelfCache.when > 1000) {
      shelfCache.days = null;
      try {
        var d = JSON.parse(localStorage.getItem(SHELF_DATA_KEY));
        if (d && typeof d === "object") shelfCache.days = F.byDay(d);
      } catch (e) {}
      shelfCache.when = now;
    }
    return shelfCache.days;
  }

  function shelfFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-shelf")) return [];
    var days = shelfDays();
    if (!days || !days[dateStr]) return [];
    return days[dateStr].map(function (r) {
      return {
        id: "shf-" + r.k + "-" + r.item + "-" + dateStr,   // per-render key, never stored
        title: window.OrosShelfFeed.label(r.k, r.title, LB),
        labelId: "lbl-feed-shelf",
        start: null,                                     // all-day
        _feed: true,
        _openAt: { app: "shelf", target: { item: r.item } }
      };
    });
  }

  // Publishing read-only feed (publish/core.js + publish/feed.js, loaded
  // by index.html): release dates ("Release: …") and the open steps of
  // each release plan ("Proofs 1 · …"). Never stored; micro-cached ~1s.
  // Click → Publishing opens that title.
  var PUBLISH_DATA_KEY = "oros-publish-data";
  var publishCache = { when: 0, days: null };
  function publishDays() {
    var now = Date.now(), F = window.OrosPublishFeed;
    if (!F) return null;
    if (now - publishCache.when > 1000) {
      publishCache.days = null;
      try {
        var d = JSON.parse(localStorage.getItem(PUBLISH_DATA_KEY));
        if (d && typeof d === "object") publishCache.days = F.byDay(d);
      } catch (e) {}
      publishCache.when = now;
    }
    return publishCache.days;
  }
  function publishFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-publish")) return [];
    var days = publishDays();
    if (!days || !days[dateStr]) return [];
    return days[dateStr].map(function (r) {
      return {
        id: "pub-" + r.k + "-" + r.title + "-" + (r.step || r.post || "") + "-" + dateStr,   // per-render key, never stored
        title: window.OrosPublishFeed.label(r, LB),
        labelId: "lbl-feed-publish",
        start: null,                                     // all-day
        _feed: true,
        _openAt: { app: "publish", target: r.post ? { post: r.post } : { title: r.title } }
      };
    });
  }

  // Invoices read-only feed (invoices/core.js dueOn, loaded by
  // index.html: the same rule as the app, Today and the reminder).
  // Issued invoices, receipts and records with money still owed, on
  // their due date: "INV-2026-0042 due · Acme". Rows are never
  // stored; the parsed blob is micro-cached ~1s like the other feeds.
  // Click → Invoices opens that document.
  var INV_DATA_KEY = "oros-invoices-data";
  var invCache = { when: 0, raw: null, data: null };
  function invData() {
    var C = window.OrosInvoicesCore;
    if (!C) return null;
    var now = Date.now();
    if (now - invCache.when > 1000) {
      invCache.when = now;
      var raw = null;
      try { raw = localStorage.getItem(INV_DATA_KEY); } catch (e) { raw = null; }
      if (raw !== invCache.raw) {
        invCache.raw = raw;
        invCache.data = raw ? C.parse(raw) : null;
      }
    }
    return invCache.data;
  }
  function invoicesFeedOn(dateStr) {
    if (!labelVisible("lbl-feed-inv")) return [];
    var data = invData();
    if (!data || !data.docs.length) return [];
    var C = window.OrosInvoicesCore;
    return C.dueOn(data, dateStr).map(function (d) {
      return {
        id: "inv-" + d.id,                       // per-render key, never stored
        title: t("feed.inv.due").replace("{n}", d.num || "").replace("{a}", C.partyName(data, d) || "")
          .replace(/ · $/, "").slice(0, 120),
        labelId: "lbl-feed-inv",
        start: null,                             // all-day
        note: C.fmtMoney(C.balance(data, d), d.cur, LB),
        _feed: true,
        _openAt: { app: "invoices", target: { invoice: d.id } }
      };
    });
  }

  /* ---------- 3d. Name days, holidays, world days ----------
     Data and rules live in namedays.js (window.OrosNamedays, pure).
     Three chips, all read-only virtual rows, never stored in the
     synced blob:
       - Holidays: Greek public holidays (fixed + from Orthodox Easter).
       - Name days: the day view's "Name days:" line, plus one row per
         CONTACT whose first name has a name day (click → Contacts).
       - World days: observances from days.json. The file is fetched
         from our own site at most once a week and cached on this
         device (DAYS_KEY); the service worker's precached copy is
         the offline fallback. Nothing leaves the device but that GET.
     The on/off state of these three chips is remembered on this
     device (FEEDVIS_KEY, outside sync); the other feeds reset to
     visible on every load as before. */
  var ND = window.OrosNamedays || null;
  var FEEDVIS_KEY = "oros-cal-feedvis";
  var DAYS_KEY = "oros-cal-days";
  var DAYS_MAX_AGE = 7 * 86400000;
  var STICKY_FEEDS = ["lbl-feed-hol", "lbl-feed-nameday", "lbl-feed-obs", "lbl-feed-time"];
  var daysData = null;

  // Opt-in feeds start hidden; turning one on is remembered (true).
  var OPT_IN_FEEDS = ["lbl-feed-sky", "lbl-feed-meds", "lbl-feed-appts"];
  function loadFeedVis() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(FEEDVIS_KEY) || "{}"); } catch (e) {}
    STICKY_FEEDS.forEach(function (id) { if (v && v[id] === false) labelVis[id] = false; });
    // Wave 8: subscribed calendars remember "hidden" on this device too.
    if (v && typeof v === "object") Object.keys(v).forEach(function (id) { if (id.indexOf("sub-") === 0 && v[id] === false) labelVis[id] = false; });
    OPT_IN_FEEDS.forEach(function (id) { labelVis[id] = !!(v && v[id] === true); });
  }
  function saveFeedVis(id) {
    if (STICKY_FEEDS.indexOf(id) === -1 && OPT_IN_FEEDS.indexOf(id) === -1 && String(id).indexOf("sub-") !== 0) return;
    var v = {};
    STICKY_FEEDS.forEach(function (k) { if (!labelVisible(k)) v[k] = false; });
    OPT_IN_FEEDS.forEach(function (k) { if (labelVisible(k)) v[k] = true; });
    state.subs.forEach(function (x) { if (!labelVisible("sub-" + x.id)) v["sub-" + x.id] = false; });
    try { localStorage.setItem(FEEDVIS_KEY, JSON.stringify(v)); } catch (e) {}
  }

  function loadDays() {
    if (!ND) return;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(DAYS_KEY) || "null"); } catch (e) {}
    if (cached && typeof cached === "object") daysData = ND.cleanDays(cached.data);
    var fresh = cached && typeof cached.at === "number" &&
                Date.now() - cached.at < DAYS_MAX_AGE && cached.at <= Date.now();
    if (fresh && daysData) return;
    if (typeof fetch !== "function") return;
    // One URL per week: a new week is a cache miss in the service
    // worker (exact-match), so this reaches the network when online;
    // offline, the SW's ignoreSearch fallback answers with its copy.
    var week = Math.floor(Date.now() / DAYS_MAX_AGE);
    fetch("days.json?w=" + week, { cache: "no-cache" }).then(function (r) {
      return r && r.ok ? r.json() : null;
    }).then(function (json) {
      var clean = ND.cleanDays(json);
      if (!clean) return;
      daysData = clean;
      try { localStorage.setItem(DAYS_KEY, JSON.stringify({ at: Date.now(), data: clean })); } catch (e) {}
      renderAll();
      renderDay();
    }).catch(function () {});
  }

  function holidaysFeedOn(dateStr) {
    if (!ND || !labelVisible("lbl-feed-hol")) return [];
    return ND.holidaysOn(dateStr).map(function (h) {
      return { id: "hol-" + h.id + "-" + dateStr, title: LANG === "el" ? h.el : h.en,
               labelId: "lbl-feed-hol", start: null, _feed: true };
    });
  }
  function isHoliday(dateStr) {
    return !!(ND && labelVisible("lbl-feed-hol") && ND.holidaysOn(dateStr).length);
  }
  function observancesFeedOn(dateStr) {
    if (!ND || !daysData || !labelVisible("lbl-feed-obs")) return [];
    return ND.observancesOn(dateStr, daysData).map(function (o) {
      return { id: "obs-" + o.id + "-" + dateStr, title: LANG === "el" ? o.el : o.en,
               labelId: "lbl-feed-obs", start: null, _feed: true };
    });
  }
  function namedayContactsOn(dateStr) {
    if (!ND || !labelVisible("lbl-feed-nameday")) return [];
    var cs = contactsRaw().contacts;
    if (!Array.isArray(cs)) return [];
    var out = [], byId = {};
    cs.forEach(function (c) { if (c && typeof c.id === "string") byId[c.id] = c; });
    ND.contactsCelebrating(cs, dateStr).forEach(function (x) {
      var c = byId[x.id];
      out.push({ id: "nd-" + c.id + "-" + dateStr,          // per-render key, never stored
                 title: t("nd.contact").replace("{name}", ctName(c)),
                 labelId: "lbl-feed-nameday", start: null, _feed: true, _contactId: c.id });
    });
    return out;
  }

  // Own events as drawn on that day (viewOf copies: the occurrence's
  // dates and times in this device's zone).
  function ownOn(dateStr) {
    var out = [];
    state.events.forEach(function (e) {
      if (!eventVisible(e)) return;
      var inst = OCC.instanceOn(e, dateStr);
      if (inst) out.push(viewOf(e, inst));
    });
    return out;
  }
  function eventsOn(dateStr) {
    return ownOn(dateStr).concat(feedsOn(dateStr))
    .sort(function (a, b) {
      if (a.start === b.start) return 0;
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start < b.start ? -1 : 1;
    });
  }
  // The other apps' read-only rows on that day (unsorted).
  function feedsOn(dateStr) {
    return contactsFeedOn(dateStr)
    .concat(habitsFeedOn(dateStr))
    .concat(cycleFeedOn(dateStr))
    .concat(moodFeedOn(dateStr))
    .concat(kanbanFeedOn(dateStr))
    .concat(todoFeedOn(dateStr))
    .concat(fitnessFeedOn(dateStr))
    .concat(petFeedOn(dateStr))
    .concat(plantsFeedOn(dateStr))
    .concat(choresFeedOn(dateStr))
    .concat(petcareFeedOn(dateStr))
    .concat(garageFeedOn(dateStr))
    .concat(travelFeedOn(dateStr))
    .concat(mealsFeedOn(dateStr))
    .concat(budgetFeedOn(dateStr))
    .concat(shelfFeedOn(dateStr))
    .concat(publishFeedOn(dateStr))
    .concat(invoicesFeedOn(dateStr))
    .concat(babyFeedOn(dateStr))
    .concat(togetherFeedOn(dateStr))
    .concat(holidaysFeedOn(dateStr))
    .concat(namedayContactsOn(dateStr))
    .concat(observancesFeedOn(dateStr))
    .concat(timesheetFeedOn(dateStr))
    .concat(familyTreeFeedOn(dateStr))
    .concat(crmFeedOn(dateStr))
    .concat(medsFeedOn(dateStr))
    .concat(apptsFeedOn(dateStr))
    .concat(skyFeedOn(dateStr))
    .concat(subsFeedOn(dateStr));
  }

  // Wave 4 — click-through: any feed row → its owning app. The shell
  // owns every deep link (live iframe push or sessionStorage staging
  // + app open). One dispatcher, three contracts: Contacts / Cycle /
  // Mood. Habits rows carry no bridge yet → silently inert. Standalone
  // load (no parent shell): ignored — the source app is only a tab
  // away in that mode anyway.
  function openFeedRow(ev) {
    if (!ev || !ev._feed) return;
    if (ev._sub) { openSubEvent(ev); return; }      // wave 8: subscribed calendar
    try {
      var p = window.parent;
      if (!p) return;
      if (ev._contactId &&
          typeof p.__orosOpenContact === "function") {
        p.__orosOpenContact(ev._contactId);
      } else if (ev._cycleId &&
                 typeof p.__orosOpenCycle === "function") {
        p.__orosOpenCycle(ev._cycleId);
      } else if (ev._moodId &&
                 typeof p.__orosOpenMood === "function") {
        p.__orosOpenMood(ev._moodId);
      } else if (ev._kanban &&
                 typeof p.__orosOpenKanbanCard === "function") {
        p.__orosOpenKanbanCard(ev._kanban.boardId,
                               ev._kanban.colId,
                               ev._kanban.cardId);
      } else if (ev._todo &&
                 typeof p.__orosOpenTodo === "function") {
        p.__orosOpenTodo(ev._todo.listId);
      } else if (ev._plantId &&
                 typeof p.__orosOpenPlants === "function") {
        p.__orosOpenPlants(ev._plantId);
      } else if (ev._choresDay &&
                 typeof p.__orosOpenChores === "function") {
        p.__orosOpenChores(ev._choresDay);
      } else if (ev._petcareId &&
                 typeof p.__orosOpenPetcare === "function") {
        p.__orosOpenPetcare(ev._petcareId);
      } else if (ev._garageId &&
                 typeof p.__orosOpenGarage === "function") {
        p.__orosOpenGarage(ev._garageId);
      } else if (ev._travel &&
                 typeof p.__orosOpenTravel === "function") {
        p.__orosOpenTravel(ev._travel.trip, ev._travel.tab);
      } else if (ev._openAt &&
                 typeof p.__orosOpenAt === "function") {
        p.__orosOpenAt(ev._openAt.app, ev._openAt.target);
      } else if (ev._budgetRec &&
                 typeof p.__orosOpenAt === "function") {
        p.__orosOpenAt("budget", { rec: ev._budgetRec });
      } else if (ev._fitnessId &&
                 typeof p.__orosOpenFitness === "function") {
        p.__orosOpenFitness(ev._fitnessId);
      } else if (ev._babyOpen &&
                 typeof p.__orosOpenApp === "function") {
        p.__orosOpenApp("baby");
      } else if (ev._petOpen &&
                 typeof p.__orosOpenPet === "function") {
        // Screen Pet is a SHELL component — the bridge lives on the
        // parent, not this iframe. Care rows pass the log entry id;
        // the birthday row passes null (plain log, no highlight).
        p.__orosOpenPet(ev._petEvId || null);
      }
    } catch (e) {}
  }

  /* Wave 7 — Calendar → Maps geocode bridge (same contract as
     Bookmarks/Contacts): shell first (live push or staged +
     open), standalone fallback opens /maps/?q= in a new tab. */
  function openInMaps(query, label) {
    if (typeof query !== "string" || !query.trim()) return;
    try {
      if (window.parent &&
          typeof window.parent.__orosOpenMapsQuery === "function") {
        window.parent.__orosOpenMapsQuery(query.trim(), label || "");
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    window.open("/maps/?q=" + encodeURIComponent(query.trim()),
      "_blank", "noopener,noreferrer");
  }
  
  /* ---------- 4. View system + month grid ---------- */
  var viewYear, viewMonth;          // month currently displayed
  var selDate = null;               // "YYYY-MM-DD" or null
  var curView = "month";            // "month" | "week" | "agenda"
  var weekAnchor = null;            // Monday (YMD) of the shown week
  var searchQ = "";                 // non-empty → results overlay
  var AGENDA_STEP = 30;             // days per "show more" chunk

  function renderWeekdays() {
    var wd = $("cal-wd");
    wd.textContent = "";
    for (var i = 0; i < 7; i++) {
      var d = document.createElement("div");
      d.textContent = t("wd")[i];
      if (i >= 5) d.className = "wend";
      wd.appendChild(d);
    }
  }

  // Monday (YMD) of the week containing the given date.
  function mondayOf(dateStr) {
    var p = dateStr.split("-");
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    var lead = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - lead);
    return ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function longDate(s) {
    var p = s.split("-");
    var wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
    return fill("date.long", { wd: wdFull(wd), d: +p[2], m: monGen(+p[1] - 1), y: p[0] });
  }

  function renderTitle() {
    var el = $("cal-title");
    if (curView === "agenda") { el.textContent = t("vw.agenda"); return; }
    if (curView === "year") { el.textContent = String(viewYear); return; }
    if (curView === "day") { el.textContent = longDate(selDate || todayYMD()); return; }
    if (curView === "week") {
      var m = t("months");
      var a = weekAnchor.split("-");
      var b = dAdd(weekAnchor, 6).split("-");
      var s1 = (+a[2]) + " " + m[+a[1] - 1].slice(0, 3);
      var s2 = (+b[2]) + " " + m[+b[1] - 1].slice(0, 3) + " " + b[0];
      el.textContent = s1 + " – " + s2;
      return;
    }
    el.textContent = t("months")[viewMonth] + " " + viewYear;
  }

  // Drag & drop (desktop, Month and Week): any own event. The payload
  // names the event, the day it was picked up on and its occurrence.
  function dragSource(node, ev, dayYmd) {
    if (!ev || ev._feed) return;
    node.draggable = true;
    node.addEventListener("dragstart", function (de) {
      de.stopPropagation();
      try {
        de.dataTransfer.setData("text/plain", "cal-ev:" + srcOf(ev).id + "|" + dayYmd + "|" + occOf(ev, dayYmd));
        de.dataTransfer.effectAllowed = "move";
      } catch (e2) {}
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", function () { node.classList.remove("dragging"); });
  }
  // Drop target — accepts only calendar-event payloads ("cal-ev:").
  function dropTarget(node, dayYmd) {
    node.addEventListener("dragover", function (de) {
      var types = de.dataTransfer.types;
      if (types && Array.prototype.indexOf.call(types, "text/plain") !== -1) {
        de.preventDefault();               // required: makes the drop legal
        de.dataTransfer.dropEffect = "move";
        node.classList.add("drop-target");
      }
    });
    node.addEventListener("dragleave", function () { node.classList.remove("drop-target"); });
    node.addEventListener("drop", function (de) {
      de.preventDefault();
      de.stopPropagation();
      node.classList.remove("drop-target");
      var raw = "";
      try { raw = de.dataTransfer.getData("text/plain") || ""; } catch (e2) {}
      if (raw.indexOf("cal-ev:") !== 0) return;
      dropEvent(raw.slice(7), dayYmd);
    });
  }
  // Click on an own row: series → chooser (this occurrence / all),
  // plain → editor; feed rows open their app.
  function openRow(ev, dayYmd) {
    if (ev._feed) { openFeedRow(ev); return; }
    var src = srcOf(ev);
    if (validRecur(src.recur)) showSerChooser(src, occOf(ev, dayYmd));
    else openDlg(src);
  }

  // Weather on days (app links wave 6): the Weather app's cached
  // forecast, read only, never fetched (../weather/days.js).
  function wxDays(dates) {
    try { return window.OrosWeatherDays ? window.OrosWeatherDays.forDates(dates) || {} : {}; }
    catch (e) { return {}; }
  }
  function wxChip(w, cls, withTemp) {
    var sp = document.createElement("span");
    sp.className = cls;
    sp.textContent = withTemp ? w.icon + " " + w.label : w.icon;
    sp.title = t("wx.day").replace("{t}", w.label);
    sp.setAttribute("aria-label", sp.title);
    return sp;
  }

  function renderGrid() {
    var grid = $("cal-grid");
    grid.textContent = "";
    var wxDates = [];

    // Monday-first offset: getDay(): Sun=0..Sat=6 → Mon-first index.
    var first = new Date(viewYear, viewMonth, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var prevMonth = new Date(viewYear, viewMonth, 0).getDate();

    var today = todayYMD();
    var cells = lead + daysInMonth;
    var rows = Math.ceil(cells / 7) * 7;   // pad trailing week

    for (var i = 0; i < rows; i++) {
      var dayNum, out = false, cellDate;
      if (i < lead) {
        dayNum = prevMonth - lead + 1 + i;
        out = true;
        var pm = viewMonth - 1, py = viewYear;
        if (pm < 0) { pm = 11; py--; }
        cellDate = ymd(py, pm, dayNum);
      } else if (i >= cells) {
        dayNum = i - cells + 1;
        out = true;
        var nm = viewMonth + 1, ny = viewYear;
        if (nm > 11) { nm = 0; ny++; }
        cellDate = ymd(ny, nm, dayNum);
      } else {
        dayNum = i - lead + 1;
        cellDate = ymd(viewYear, viewMonth, dayNum);
      }

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-cell";
      if (out) btn.className += " out";
      if (cellDate === today) btn.className += " today";
      if (selDate === cellDate) btn.className += " sel";
      if (isHoliday(cellDate)) btn.className += " hol";

      var num = document.createElement("span");
      num.className = "cal-num";
      num.textContent = dayNum;
      btn.appendChild(num);
      wxDates.push([cellDate, btn]);

      var dayEvents = eventsOn(cellDate);
      if (!monthNames) {
        // Default: one dot per event (up to 6) in its label colour.
        var dots = document.createElement("span");
        dots.className = "ev-dot-row";
        for (var k = 0; k < dayEvents.length && k < 6; k++) {
          var dot = document.createElement("span");
          dot.className = "ev-dot" + (dayEvents[k].start ? " timed" : "");
          dot.style.background = labelColor(dayEvents[k].labelId);
          dots.appendChild(dot);
        }
        btn.appendChild(dots);
      }
      // Opt-in (More › Event names in Month), Google style;
      // fitMonth() keeps as many as the cell has room for and puts
      // "+N" in place of the rest.
      var evs = document.createElement("span");
      evs.className = "cal-evs";
      for (var j = 0; monthNames && j < dayEvents.length; j++) {
        var de = dayEvents[j], dsp = spanInfo(de, cellDate);
        var pill = document.createElement("span");
        pill.className = "cal-ev";
        pill.style.borderLeftColor = labelColor(de.labelId);
        if (de.start && !(dsp && dsp.idx > 1)) {
          var pt = document.createElement("span");
          pt.className = "cal-ev-t";
          pt.textContent = de.start;
          pill.appendChild(pt);
        }
        pill.appendChild(document.createTextNode(
          (dsp && dsp.idx > 1 ? "…" : "") + (de.title || t("ev.untitled"))));
        evs.appendChild(pill);
      }
      if (monthNames) {
        var more = document.createElement("span");
        more.className = "cal-more";
        more.hidden = true;
        evs.appendChild(more);
        btn.appendChild(evs);
      }

      (function (cd) {
        btn.addEventListener("click", function () { selectDay(cd); });
        dropTarget(btn, cd);
      })(cellDate);

      grid.appendChild(btn);
    }
    var wx = wxDays(wxDates.map(function (x) { return x[0]; }));
    wxDates.forEach(function (x) { if (wx[x[0]]) x[1].appendChild(wxChip(wx[x[0]], "cal-wx", false)); });
  }

  /* ---------- 4b. Week view ---------- */
  function renderWeek() {
    var grid = $("week-grid");
    grid.textContent = "";
    var today = todayYMD();

    for (var i = 0; i < 7; i++) {
      var dayYmd = dAdd(weekAnchor, i);
      var p = dayYmd.split("-");

      // A11y fix: div + role="button" — the day column CONTAINS
      // .wk-ev buttons, so it must not itself be a button.
      var col = document.createElement("div");
      col.setAttribute("role", "button");
      col.tabIndex = 0;
      col.className = "wk-col" +
        (dayYmd === today ? " today" : "") +
        (selDate === dayYmd ? " sel" : "") +
        (isHoliday(dayYmd) ? " hol" : "");

      var head = document.createElement("div");
      head.className = "wk-head";
      var dn = document.createElement("span");
      dn.className = "wk-dnum";
      dn.textContent = t("wd")[i] + " " + (+p[2]);
      head.appendChild(dn);
      var wxd = wxDays([dayYmd])[dayYmd];
      if (wxd) head.appendChild(wxChip(wxd, "wk-wx", true));
      col.appendChild(head);

      var body = document.createElement("div");
      body.className = "wk-body";
      var dayEvents = eventsOn(dayYmd);
      if (!dayEvents.length) {
        var em = document.createElement("div");
        em.className = "wk-empty";
        em.textContent = "—";
        body.appendChild(em);
      }
      dayEvents.forEach(function (e) {
        var sp = spanInfo(e, dayYmd);
        var ev = document.createElement("button");
        ev.type = "button";
        ev.className = "wk-ev";
        ev.style.borderLeftColor = labelColor(e.labelId);
        if (e.start && !(sp && sp.idx > 1)) {
          var tm = document.createElement("span");
          tm.className = "wk-ev-time";
          tm.textContent = e.start;
          if (e._zoned) {
            var tzm = document.createElement("span");
            tzm.className = "tz-mark";
            tzm.textContent = " ◷";
            tzm.title = tzNote(e);
            tm.appendChild(tzm);
          }
          ev.appendChild(tm);
        }
        ev.appendChild(document.createTextNode(
          (sp && sp.idx > 1 ? "…" : "") +
          (e.title || t("ev.untitled")) +
          (sp ? " (" + sp.idx + "/" + sp.days + ")" : "") +
          (validRecur(e.recur) ? " ↻" : "")));
        if (e.location && !e._feed) {
          var wloc = document.createElement("span");
          wloc.className = "wk-ev-loc map-link";
          wloc.textContent = "▸ " + e.location;
          wloc.title = t("cal.maps");
          (function (lq, lbl) {
            wloc.addEventListener("click", function (evt) {
              evt.stopPropagation();
              openInMaps(lq, lbl);
            });
          })(e.location, e.title || "");
          ev.appendChild(wloc);
        }
        (function (ee, dy) {
          ev.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openRow(ee, dy);
          });
          dragSource(ev, ee, dy);
        })(e, dayYmd);
        body.appendChild(ev);
      });
      col.appendChild(body);

      (function (cd) {
        col.addEventListener("click", function () { selectDay(cd); });
        col.addEventListener("keydown", function (ke) {
          if (ke.key === "Enter" || ke.key === " ") {
            ke.preventDefault();
            selectDay(cd);
          }
        });
        dropTarget(col, cd);
      })(dayYmd);

      grid.appendChild(col);
    }
  }

  /* ---------- 4b2. Day view (wave 5): hour grid ----------
     All-day rows (and whole days inside a multi-day event) in a strip
     on top; timed rows as blocks on a 24-hour grid, side by side when
     they overlap; a line at the current time on today. A tap on an
     empty hour starts a new event there. */
  var DV_HOUR = 60;                 // px per hour
  var dvScrolledFor = null;         // the day the grid was last scrolled for
  function hmMin(s) { var p = String(s).split(":"); return (+p[0]) * 60 + (+p[1]); }
  function fmtMin(m) { return pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60); }

  function dayLayout(day) {
    var allDay = [], timed = [];
    eventsOn(day).forEach(function (e) {
      if (!e.start) { allDay.push(e); return; }
      var first = !e.date || e.date >= day;
      var last = !e.dateEnd || e.dateEnd <= day;
      var s = first ? hmMin(e.start) : 0;
      var en = last ? (e.end ? hmMin(e.end) : s + 60) : 1440;
      if (!first && !last) { allDay.push(e); return; }     // a whole day inside a span
      if (en <= s) en = Math.min(1440, s + 30);
      timed.push({ e: e, s: s, en: Math.max(en, s + 20) });
    });
    // Overlaps: clusters of rows that touch; each takes a column.
    timed.sort(function (a, b) { return a.s - b.s || b.en - a.en; });
    var cluster = [], colsEnd = [], clusterEnd = -1;
    function close() {
      cluster.forEach(function (x) { x.cols = colsEnd.length; });
      cluster = []; colsEnd = [];
    }
    timed.forEach(function (x) {
      if (x.s >= clusterEnd) { close(); clusterEnd = -1; }
      var c = 0;
      while (c < colsEnd.length && colsEnd[c] > x.s) c++;
      colsEnd[c] = x.en;
      x.col = c;
      cluster.push(x);
      clusterEnd = Math.max(clusterEnd, x.en);
    });
    close();
    return { allDay: allDay, timed: timed };
  }

  function renderDayView() {
    var box = $("day-view");
    box.textContent = "";
    var day = selDate || todayYMD();
    var lay = dayLayout(day);

    var strip = document.createElement("div");
    strip.className = "dv-allday";
    var sl = document.createElement("span");
    sl.className = "dv-allday-lab";
    sl.textContent = t("ev.alltime");
    strip.appendChild(sl);
    var chips = document.createElement("div");
    chips.className = "dv-allday-list";
    if (!lay.allDay.length) {
      var none = document.createElement("span");
      none.className = "wk-empty";
      none.textContent = "—";
      chips.appendChild(none);
    }
    lay.allDay.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dv-chip";
      b.style.borderLeftColor = labelColor(e.labelId);
      var sp = spanInfo(e, day);
      b.textContent = (e.title || t("ev.untitled")) + (sp ? " (" + sp.idx + "/" + sp.days + ")" : "") +
        (validRecur(e.recur) ? " ↻" : "");
      b.addEventListener("click", function () { openRow(e, day); });
      chips.appendChild(b);
    });
    strip.appendChild(chips);
    box.appendChild(strip);

    var scroll = document.createElement("div");
    scroll.className = "dv-scroll";
    var grid = document.createElement("div");
    grid.className = "dv-grid";
    grid.style.height = (24 * DV_HOUR) + "px";
    for (var h = 0; h < 24; h++) {
      var line = document.createElement("div");
      line.className = "dv-hour";
      line.style.top = (h * DV_HOUR) + "px";
      var lab = document.createElement("span");
      lab.className = "dv-hlab";
      lab.textContent = pad(h) + ":00";
      line.appendChild(lab);
      grid.appendChild(line);
    }
    var lane = document.createElement("div");
    lane.className = "dv-lane";
    lay.timed.forEach(function (x) {
      var e = x.e;
      var b = document.createElement("button");
      b.type = "button";
      // Under 45 minutes: time and title share one line.
      b.className = "dv-ev" + (x.en - x.s < 45 ? " short" : "");
      b.style.top = (x.s * DV_HOUR / 60) + "px";
      b.style.height = Math.max(18, (x.en - x.s) * DV_HOUR / 60 - 2) + "px";
      b.style.left = (100 * x.col / x.cols) + "%";
      b.style.width = "calc(" + (100 / x.cols) + "% - 3px)";
      b.style.borderLeftColor = labelColor(e.labelId);
      var tm = document.createElement("span");
      tm.className = "dv-ev-time";
      tm.textContent = fmtMin(x.s) + (x.en < 1440 ? "–" + fmtMin(x.en) : "");
      if (e._zoned) {
        var tzm = document.createElement("span");
        tzm.className = "tz-mark";
        tzm.textContent = " ◷ " + tzNote(e);
        tm.appendChild(tzm);
      }
      b.appendChild(tm);
      var ti = document.createElement("span");
      ti.className = "dv-ev-title";
      ti.textContent = (e.title || t("ev.untitled")) + (validRecur(e.recur) ? " ↻" : "");
      b.appendChild(ti);
      if (e.location) {
        var lo = document.createElement("span");
        lo.className = "dv-ev-loc";
        lo.textContent = e.location;
        b.appendChild(lo);
      }
      b.title = (e.title || "") + " " + tm.textContent;
      b.addEventListener("click", function (evt) { evt.stopPropagation(); openRow(e, day); });
      lane.appendChild(b);
    });
    grid.appendChild(lane);
    if (day === todayYMD()) {
      var now = document.createElement("div");
      now.className = "dv-now";
      now.id = "dv-now";
      grid.appendChild(now);
      placeNowLine();
    }
    // A tap on an empty spot: a new event at that hour.
    lane.addEventListener("click", function (evt) {
      if (evt.target !== lane) return;
      var r = lane.getBoundingClientRect();
      var hr = Math.max(0, Math.min(23, Math.floor((evt.clientY - r.top) / DV_HOUR)));
      newEventAt(day, pad(hr) + ":00");
    });
    scroll.appendChild(grid);
    box.appendChild(scroll);
    if (dvScrolledFor !== day) {
      dvScrolledFor = day;
      var first = lay.timed.length ? lay.timed[0].s : 8 * 60;
      if (day === todayYMD()) { var n = new Date(); first = Math.min(first, n.getHours() * 60 + n.getMinutes()); }
      scroll.scrollTop = Math.max(0, (first / 60 - 1) * DV_HOUR);
    }
  }
  function placeNowLine() {
    var el = document.getElementById("dv-now");
    if (!el) return;
    var n = new Date();
    el.style.top = ((n.getHours() * 60 + n.getMinutes()) * DV_HOUR / 60) + "px";
  }
  setInterval(function () { if (curView === "day") placeNowLine(); }, 60000);

  function newEventAt(day, hm) {
    selDate = day;
    renderDay();
    openDlg(null);
    $("ev-allday").checked = false;
    $("ev-allday").dispatchEvent(new Event("change"));
    $("ev-start").value = hm;
    $("ev-end").value = fmtMin(hmMin(hm) + 60);
  }

  /* ---------- 4b3. Year view (wave 5): 12 small months ----------
     A dot under each day that has something; a tap opens that day in
     the Day view, a month's name opens it in the Month view. */
  function renderYear() {
    var box = $("year-grid");
    box.textContent = "";
    var today = todayYMD();
    // Own events: one walk per event over the whole year.
    var busy = {};
    var from = ymd(viewYear, 0, 1), to = ymd(viewYear, 11, 31);
    state.events.forEach(function (e) {
      if (!eventVisible(e)) return;
      OCC.instancesBetween(e, from, to, function (inst) {
        var d = inst.date < from ? from : inst.date, last = inst.dateEnd || inst.date;
        for (var k = 0; k < 400 && d <= last && d <= to; k++) {
          (busy[d] = busy[d] || []).push(labelColor(e.labelId));
          d = dAdd(d, 1);
        }
      });
    });
    for (var m = 0; m < 12; m++) {
      var mb = document.createElement("div");
      mb.className = "yr-month";
      var mh = document.createElement("button");
      mh.type = "button";
      mh.className = "yr-mname";
      mh.textContent = t("months")[m];
      (function (mm) {
        mh.addEventListener("click", function () {
          viewMonth = mm;
          selDate = ymd(viewYear, mm, 1);
          setView("month");
          renderDay();
        });
      })(m);
      mb.appendChild(mh);
      var g = document.createElement("div");
      g.className = "yr-days";
      for (var w = 0; w < 7; w++) {
        var wd = document.createElement("span");
        wd.className = "yr-wd";
        wd.textContent = t("wd")[w].charAt(0);
        g.appendChild(wd);
      }
      var lead = (new Date(viewYear, m, 1).getDay() + 6) % 7;
      var dim = new Date(viewYear, m + 1, 0).getDate();
      for (var b = 0; b < lead; b++) g.appendChild(document.createElement("span"));
      for (var d = 1; d <= dim; d++) {
        var day = ymd(viewYear, m, d);
        var c = document.createElement("button");
        c.type = "button";
        c.className = "yr-day" + (day === today ? " today" : "") + (day === selDate ? " sel" : "") +
          (isHoliday(day) ? " hol" : "");
        c.textContent = String(d);
        var colors = (busy[day] || []).slice(0);
        if (colors.length < 3) {
          feedsOn(day).forEach(function (x) { if (colors.length < 3) colors.push(labelColor(x.labelId)); });
        }
        if (colors.length) {
          var dots = document.createElement("span");
          dots.className = "yr-dots";
          colors.slice(0, 3).forEach(function (col) {
            var dt = document.createElement("span");
            dt.className = "yr-dot";
            dt.style.background = col;
            dots.appendChild(dt);
          });
          c.appendChild(dots);
          c.setAttribute("aria-label", d + " " + t("months")[m] + " •");
        }
        (function (dd) {
          c.addEventListener("click", function () {
            selDate = dd;
            setView("day");
            renderDay();
          });
        })(day);
        g.appendChild(c);
      }
      mb.appendChild(g);
      box.appendChild(mb);
    }
  }

  /* ---------- 4c. Agenda view + search results ---------- */
  var agendaStart = null, agendaLimitDays = AGENDA_STEP;

  function renderAgenda() {
    var ul = $("agenda-list");
    ul.textContent = "";
    if (!agendaStart) agendaStart = todayYMD();
    var today = todayYMD();

    var shown = 0;
    for (var i = 0; i < agendaLimitDays; i++) {
      var dayYmd = dAdd(agendaStart, i);
      var dayEvents = eventsOn(dayYmd);
      if (!dayEvents.length) continue;

      var li = document.createElement("li");
      li.className = "ag-day" + (dayYmd === today ? " ag-today" : "");

      var head = document.createElement("div");
      head.className = "ag-day-head";
      var nm = document.createElement("span");
      nm.className = "ag-day-name";
      var p = dayYmd.split("-");
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      nm.textContent = t("wd")[(d.getDay() + 6) % 7] + " " +
        (+p[2]) + " " + t("months")[+p[1] - 1];
      var cnt = document.createElement("span");
      cnt.className = "ag-count";
      cnt.textContent = String(dayEvents.length);
      head.appendChild(nm);
      head.appendChild(cnt);
      li.appendChild(head);

      dayEvents.forEach(function (e) {
        li.appendChild(buildEvRow(e, dayYmd));
      });
      ul.appendChild(li);
      shown++;
    }

    if (!shown) {
      var emp = document.createElement("li");
      emp.className = "empty";
      emp.textContent = t("ag.empty");
      ul.appendChild(emp);
    }
    // Το κουμπί εμφανίζεται μόνο όταν το τρέχον παράθυρο είχε
    // περιεχόμενο — δίπλα σε μήνυμα κενού δεν προφέρουμε paginator.
    if (shown) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "mini ag-more";
      more.textContent = t("ag.more");
      more.addEventListener("click", function () {
        agendaLimitDays += AGENDA_STEP;
        renderAgenda();
      });
      ul.appendChild(more);
    }
  }

  function renderSearch() {
    var ul = $("search-results");
    ul.textContent = "";
    var q = searchQ.trim().toLowerCase();
    if (!q) return;

    var hits = state.events.filter(function (e) {
      return eventVisible(e) &&
        ((e.title || "").toLowerCase().indexOf(q) !== -1 ||
         (e.note || "").toLowerCase().indexOf(q) !== -1 ||
         (e.location || "").toLowerCase().indexOf(q) !== -1);
    }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    if (!hits.length) {
      var emp = document.createElement("li");
      emp.className = "res-empty";
      emp.textContent = t("srch.empty");
      ul.appendChild(emp);
      return;
    }
    hits.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "res-row";
      var dt = document.createElement("span");
      dt.className = "res-date";
      var p = e.date.split("-");
      dt.textContent = (+p[2]) + " " + t("months")[+p[1] - 1].slice(0, 3) + " " + p[0] +
        (e.dateEnd ? " –" : "");
      var ti = document.createElement("span");
      ti.className = "res-title";
      ti.textContent = (e.title || t("ev.untitled")) +
        (validRecur(e.recur) ? " ↻" : "");
      li.appendChild(dt);
      li.appendChild(ti);
      if (e.location) {
        var slo = document.createElement("span");
        slo.className = "res-loc map-link";
        slo.textContent = "▸ " + e.location;
        slo.title = t("cal.maps");
        (function (lq, lbl) {
          slo.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openInMaps(lq, lbl);
          });
        })(e.location, e.title || "");
        li.appendChild(slo);
      }
      li.addEventListener("click", function () {
        // jump: clear search, show that month, select the day
        setSearch("");
        var pd = e.date.split("-");
        viewYear = +pd[0];
        viewMonth = +pd[1] - 1;
        if (curView === "week") {
          weekAnchor = mondayOf(e.date);
        } else if (curView === "agenda") {
          // Agenda: τραβάμε το παράθυρο πίσω ώστε η εβδομάδα του
          // συμβάντος να οδηγεί τη λίστα.
          agendaStart = mondayOf(e.date);
          agendaLimitDays = AGENDA_STEP;
        }
        selectDay(e.date);
        var sec = document.querySelector(".sec");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      ul.appendChild(li);
    });
  }

  function setSearch(q) {
    searchQ = q;
    renderAll();
  }

  /* ---------- Pane switching — ONE place decides visibility ---------- */
  function syncPanes() {
    var searching = searchQ.trim().length > 0;
    var month = curView === "month" && !searching;
    var week = curView === "week" && !searching;
    var agenda = curView === "agenda" && !searching;
    $("cal-wd").hidden = !month;
    $("cal-grid").hidden = !month;
    if ($("vw-names")) $("vw-names").hidden = !month;
    $("week-grid").hidden = !week;
    if ($("day-view")) $("day-view").hidden = !(curView === "day" && !searching);
    if ($("year-grid")) $("year-grid").hidden = !(curView === "year" && !searching);
    $("agenda-list").hidden = !agenda;
    $("search-results").hidden = !searching;
  }

  var VIEWS = ["day", "week", "month", "year", "agenda"];
  function setView(v) {
    if (VIEWS.indexOf(v) === -1) v = "month";
    curView = v;
    VIEWS.forEach(function (k) {
      var b = $("vw-" + k);
      if (b) {
        b.classList.toggle("active", k === v);
        b.setAttribute("aria-pressed", k === v ? "true" : "false");
      }
    });
    var base = selDate || todayYMD();
    if (v === "week") {
      weekAnchor = mondayOf(base);
    }
    if (v === "day") { if (!selDate) selDate = base; }
    if (v === "month" || v === "year") {
      var p = base.split("-");
      viewYear = +p[0];
      if (v === "month") viewMonth = +p[1] - 1;
    }
    if (v === "agenda") { agendaStart = todayYMD(); agendaLimitDays = AGENDA_STEP; }
    renderAll();
  }

  function renderAll() {
    renderTitle();
    syncPanes();
    var searching = searchQ.trim().length > 0;
    if (searching) { renderSearch(); return; }
    if (curView === "month") { renderWeekdays(); renderGrid(); }
    else if (curView === "week") { renderWeek(); }
    else if (curView === "day") { renderDayView(); }
    else if (curView === "year") { renderYear(); }
    else if (curView === "agenda") { renderAgenda(); }
    fillHeight();
    phonePublish();
  }

  /* ---------- 4c2. Fill the window (Proton / Google style) ----------
     Month, Week and Day take the window's height under the bars and
     stop where the selected day's title is still in sight; the month
     cells then show as many event names as fit. FILL_MIN keeps a
     usable grid in a very short window (the page scrolls instead). */
  var FILL_MIN = 300;
  function fillHeight() {
    var main = $("cmain");
    var el = curView === "month" ? $("cal-grid") :
      curView === "week" ? $("week-grid") :
      curView === "day" ? $("day-view") : null;
    if (!main || !el || el.hidden) return;
    var mr = main.getBoundingClientRect(), er = el.getBoundingClientRect();
    var title = $("day-title");
    var peek = title ? Math.max(0, title.getBoundingClientRect().bottom - er.bottom) + 8 : 0;
    var top = er.top - mr.top + main.scrollTop;
    var h = Math.max(FILL_MIN, Math.floor(main.clientHeight - top - peek));
    if (main.style.getPropertyValue("--fill-h") !== h + "px") main.style.setProperty("--fill-h", h + "px");
    if (curView === "month" && monthNames) fitMonth();
  }

  // Month cells: coloured dots (default) or event names. Device-local
  // view choice (R10), never synced.
  var NAMES_KEY = "oros-cal-month-names";
  var monthNames = false;
  try { monthNames = localStorage.getItem(NAMES_KEY) === "1"; } catch (e) {}
  function setMonthNames(on) {
    monthNames = !!on;
    try {
      if (monthNames) localStorage.setItem(NAMES_KEY, "1");
      else localStorage.removeItem(NAMES_KEY);
    } catch (e) {}
    syncNamesItem();
    renderAll();
  }
  function syncNamesItem() {
    var b = $("vw-names");
    if (b) b.setAttribute("aria-pressed", monthNames ? "true" : "false");
  }

  function fitMonth() {
    var boxes = $("cal-grid").querySelectorAll(".cal-evs"), i, j, items;
    // Show everything first, then measure every cell, then hide.
    for (i = 0; i < boxes.length; i++) {
      items = boxes[i].querySelectorAll(".cal-ev");
      for (j = 0; j < items.length; j++) items[j].hidden = false;
      boxes[i].lastChild.hidden = true;
    }
    var fits = [];
    for (i = 0; i < boxes.length; i++) {
      var first = boxes[i].querySelector(".cal-ev");
      fits.push(first ? Math.floor((boxes[i].clientHeight + 2) / (first.offsetHeight + 2)) : 0);
    }
    for (i = 0; i < boxes.length; i++) {
      items = boxes[i].querySelectorAll(".cal-ev");
      if (fits[i] >= items.length) continue;
      var show = Math.max(0, fits[i] - 1);
      for (j = show; j < items.length; j++) items[j].hidden = true;
      boxes[i].lastChild.textContent = "+" + (items.length - show);
      boxes[i].lastChild.hidden = false;
    }
  }
  if (window.ResizeObserver) {
    var fillQueued = false;
    var fillRo = new ResizeObserver(function () {
      if (fillQueued) return;
      fillQueued = true;
      requestAnimationFrame(function () { fillQueued = false; fillHeight(); });
    });
    ["cmain", "cal-top", "view-bar", "lbl-bar"].forEach(function (id) { if ($(id)) fillRo.observe($(id)); });
  } else {
    window.addEventListener("resize", fillHeight);
  }

  // View switcher + search wiring (guarded — stale HTML cannot crash)
  if ($("vw-names")) {
    syncNamesItem();
    $("vw-names").title = t("mm.names");
    $("vw-names").addEventListener("click", function () { setMonthNames(!monthNames); });
  }
  VIEWS.forEach(function (k) {
    var b = $("vw-" + k);
    if (b) b.addEventListener("click", function () { setSearch(""); setView(k); });
  });
  if ($("search-in")) {
    $("search-in").addEventListener("input", function () {
      setSearch(this.value);
    });
    // Esc inside the field clears the search too (the global
    // keydown handler skips INPUT targets — special case here)
    $("search-in").addEventListener("keydown", function (e) {
      if (e.key === "Escape" && searchQ) {
        e.preventDefault();
        this.value = "";
        setSearch("");
      }
    });
  }

  /* ---------- 4d. Label filter chips ----------
     On phones the chip row is folded behind #lbl-toggle (CSS shows
     the toggle below 700px only). Open/closed is a per-device
     convenience, never synced. */
  var CHIPS_OPEN_KEY = "oros-calendar-chips-open";
  var chipsOpen = false;
  try { chipsOpen = localStorage.getItem(CHIPS_OPEN_KEY) === "1"; } catch (eCo) {}

  function setChipsOpen(open) {
    chipsOpen = !!open;
    try {
      if (chipsOpen) localStorage.setItem(CHIPS_OPEN_KEY, "1");
      else localStorage.removeItem(CHIPS_OPEN_KEY);
    } catch (eCs) {}
    renderChipsToggle();
  }

  // Every chip of the filter row, in row order: own labels, "No label",
  // the feeds, the subscribed calendars.
  function filterIds() {
    var ids = ownLabels().map(function (l) { return l.id; });
    ids.push(NO_LABEL);
    FEED_LABELS.forEach(function (fl) { ids.push(fl.id); });
    state.subs.forEach(function (x) { ids.push("sub-" + x.id); });
    return ids;
  }
  function isOwnFilter(id) {
    return id === NO_LABEL || ownLabels().some(function (l) { return l.id === id; });
  }

  // One way to change the filter: sets each id, then saves the chips
  // remembered on this device (saveFeedVis keeps only those) and redraws.
  function applyVis(fn) {
    filterIds().forEach(function (id) {
      var v = fn(id);
      if (v === true) delete labelVis[id];
      else if (v === false) labelVis[id] = false;
    });
    saveFeedVis("lbl-feed-hol");    // any remembered id: saves them all
    renderChips();
    renderAll();
    renderDay();
  }

  // Show only this chip. When it already is the only one on, the same
  // gesture brings the others back (see showAll).
  function soloChip(id) {
    var ids = filterIds();
    var alone = labelVisible(id) && ids.every(function (k) { return k === id || !labelVisible(k); });
    if (alone) { showAll(); return; }
    applyVis(function (k) { return k === id; });
  }
  // Everything on, except the opt-in feeds (Moon & Sky, Medicines,
  // Doctor visits): those turn on only from their own chip.
  function showAll() {
    applyVis(function (k) { return OPT_IN_FEEDS.indexOf(k) === -1 ? true : undefined; });
  }

  // Click toggles; a long press (phone), right-click or Alt+click shows
  // only this chip. The row is redrawn under the finger, so the click
  // and contextmenu that follow a long press reach a NEW button: one
  // shared time stamp tells them to do nothing.
  var chipPressAt = 0;
  function wireChip(btn, id, toggle) {
    var timer = null;
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    function afterPress() { return Date.now() - chipPressAt < 700; }
    btn.title = t("lbl.chip.hint");
    btn.setAttribute("aria-pressed", labelVisible(id) ? "true" : "false");
    btn.addEventListener("pointerdown", function (e) {
      cancel();
      if (e.button !== 0 || e.pointerType === "mouse") return;
      timer = setTimeout(function () { timer = null; chipPressAt = Date.now(); soloChip(id); }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { btn.addEventListener(ev, cancel); });
    btn.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (timer) { cancel(); chipPressAt = Date.now(); }   // touch: the press ends here
      else if (afterPress()) return;                       // the long press already did it
      soloChip(id);
    });
    btn.addEventListener("click", function (e) {
      if (afterPress()) return;
      if (e.altKey) { soloChip(id); return; }
      toggle();
    });
  }

  function renderChipsToggle() {
    var btn = $("lbl-toggle");
    if (!btn) return;
    var ids = filterIds();
    var all = ids.length;
    var on = ids.filter(function (k) { return labelVisible(k); }).length;
    btn.textContent = "";
    var name = document.createElement("span");
    name.className = "lbl-tg-name";
    name.textContent = t("lbl.toggle");
    var cnt = document.createElement("span");
    cnt.className = "lbl-tg-count";
    cnt.textContent = t("lbl.toggle.n").replace("{on}", on).replace("{all}", all);
    var chev = document.createElement("span");
    chev.className = "lbl-tg-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "▾";
    btn.appendChild(name);
    btn.appendChild(cnt);
    btn.appendChild(chev);
    btn.setAttribute("aria-expanded", chipsOpen ? "true" : "false");
    $("lbl-bar").classList.toggle("open", chipsOpen);
  }

  function chipEl(id, color, text, cls) {
    var c = document.createElement("button");
    c.type = "button";
    c.className = "chip" + (cls ? " " + cls : "") + (labelVisible(id) ? "" : " off");
    var dot = document.createElement("span");
    dot.className = "chip-dot";
    if (color) dot.style.background = color;
    c.appendChild(dot);
    c.appendChild(document.createTextNode(text));
    return c;
  }

  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";
    renderChipsToggle();
    // Quick filters: all, none, only my own events.
    var acts = document.createElement("div");
    acts.className = "chip-acts";
    acts.setAttribute("role", "group");
    acts.setAttribute("aria-label", t("lbl.acts"));
    [["lbl.f.all", showAll],
     ["lbl.f.none", function () { applyVis(function () { return false; }); }],
     ["lbl.f.mine", function () { applyVis(function (k) { return isOwnFilter(k); }); }]
    ].forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip-act";
      b.textContent = t(a[0]);
      b.title = t(a[0] + ".hint");
      b.addEventListener("click", a[1]);
      acts.appendChild(b);
    });
    var sep = document.createElement("span");
    sep.className = "chip-sep";
    sep.setAttribute("aria-hidden", "true");
    acts.appendChild(sep);
    row.appendChild(acts);
    ownLabels().forEach(function (l) {
      var c = chipEl(l.id, l.color, lblName(l), isHh(l.id) ? "chip-hh" : "");
      wireChip(c, l.id, function () {
        labelVis[l.id] = !labelVisible(l.id);
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(c);
    });
    var nc = chipEl(NO_LABEL, "", t("lbl.none"), "chip-nolabel");
    wireChip(nc, NO_LABEL, function () {
      labelVis[NO_LABEL] = !labelVisible(NO_LABEL);
      renderChips();
      renderAll();
      renderDay();
    });
    row.appendChild(nc);
    FEED_LABELS.forEach(function (fl) {
      var fc = chipEl(fl.id, fl.color, feedLabelName(fl));
      wireChip(fc, fl.id, function () {
        labelVis[fl.id] = !labelVisible(fl.id);
        saveFeedVis(fl.id);
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(fc);
    });
    // Wave 8: one chip per subscribed calendar (its own colour).
    state.subs.forEach(function (x) {
      var lid = "sub-" + x.id, sl = subLabel(x.id);
      var sc = chipEl(lid, x.color, sl.name, "chip-sub");
      wireChip(sc, lid, function () {
        labelVis[lid] = !labelVisible(lid);
        saveFeedVis(lid);
        renderChips();
        renderAll();
        renderDay();
      });
      var se = subCache[x.id];
      if (se && se.err) sc.title = subErrText(se);
      row.appendChild(sc);
    });
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip chip-manage";
    mg.textContent = "＋ " + t("lbl.manage");
    mg.addEventListener("click", openLblDlg);
    row.appendChild(mg);
  }

  $("lbl-toggle").addEventListener("click", function () {
    setChipsOpen(!chipsOpen);
  });

  /* ---------- 5. Day section ---------- */
  function selectDay(dateStr) {
    selDate = dateStr;
    renderAll();
    renderDay();
  }

  function timeSpan(e, day) {
    if (!e.start) return t("ev.alltime");
    // A timed event over several days: its start on the first day,
    // its end on the last, "all day" in between.
    if (day && e.dateEnd && e.dateEnd > e.date) {
      if (day === e.date) return e.start + " →";
      if (day < e.dateEnd) return t("ev.alltime");
      return "→ " + (e.end || e.start);
    }
    return e.start + (e.end ? " – " + e.end : "");
  }

  // Shared row builder — day list AND agenda use the exact same
  // markup + interactions (chooser logic included), so a click
  // behaves identically everywhere.
  function buildEvRow(e, dayYmd) {
    var li = document.createElement("li");
    li.className = "ev-row";

    var time = document.createElement("span");
    time.className = "ev-time";
    time.textContent = timeSpan(e, dayYmd);

    var main = document.createElement("div");
    main.className = "ev-main";
    var title = document.createElement("div");
    title.className = "ev-title";
    var titleTxt = document.createElement("span");
    titleTxt.className = "ev-title-text";
    titleTxt.textContent = e.title || t("ev.untitled");
    title.appendChild(titleTxt);
    if (validRecur(e.recur)) {
      var rp = document.createElement("span");
      rp.className = "ev-repeat";
      rp.title = recurDesc(e);
      rp.textContent = "↻";
      title.appendChild(rp);
    }

    var lb = e.labelId ? labelById(e.labelId) : null;
    if (lb) {
      var tag = document.createElement("span");
      tag.className = "ev-label";
      tag.style.background = lb.color;
      tag.textContent = (lb.name !== undefined) ? lblName(lb) : feedLabelName(lb);
      title.appendChild(tag);
    }
    var by = isHhEv(e) ? hhByOf(e) : null;   // BR-HH: another member changed it last
    if (by) {
      var bc = document.createElement("span");
      bc.className = "ev-by";
      bc.style.background = by.color;
      bc.textContent = by.initials;
      bc.title = t("hh.by").replace("{n}", by.name);
      bc.setAttribute("aria-label", bc.title);
      title.appendChild(bc);
    }
    main.appendChild(title);

    var sp = spanInfo(e, dayYmd);
    if (sp) {
      var cont = document.createElement("div");
      cont.className = "ev-cont";
      cont.textContent = t("ev.cont")
        .replace("{a}", String(sp.idx))
        .replace("{b}", String(sp.days));
      main.appendChild(cont);
    }
    var tzn = tzNote(e);
    if (tzn) {
      var tzl = document.createElement("div");
      tzl.className = "ev-cont ev-tz";
      tzl.textContent = "◷ " + tzn;
      main.appendChild(tzl);
    }
    if (e.location) {
      var loc = document.createElement("div");
      loc.className = "ev-note ev-loc map-link";
      loc.textContent = "▸ " + e.location;
      if (!e._feed) {
        loc.title = t("cal.maps");
        (function (lq, lbl) {
          loc.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openInMaps(lq, lbl);
          });
        })(e.location, e.title || "");
      }
      main.appendChild(loc);
    }
    if (e.note) {
      var note = document.createElement("div");
      note.className = "ev-note";
      note.textContent = e.note;
      main.appendChild(note);
    }
    li.appendChild(time);
    li.appendChild(main);
    // Feed rows open their app; a series asks "this occurrence or the
    // whole series" first. Drag & drop (desktop) moves any own event
    // onto a day of the Month or Week view (series ask first too).
    li.addEventListener("click", function () { openRow(e, dayYmd); });
    dragSource(li, e, dayYmd);
    return li;
  }

  // "Name days: …" under the day title. Greek names in both
  // languages (a Greek custom); long lists fold behind "+N more".
  var ND_SHOW = 8;
  function renderNamedayLine() {
    var el = $("nd-line");
    if (!el) return;
    el.textContent = "";
    var names = (ND && selDate && labelVisible("lbl-feed-nameday")) ? ND.namesOn(selDate) : [];
    el.hidden = !names.length;
    if (!names.length) return;
    var lab = document.createElement("span");
    lab.className = "nd-lab";
    lab.textContent = t("nd.line") + " ";
    el.appendChild(lab);
    var txt = document.createElement("span");
    txt.textContent = names.slice(0, ND_SHOW).join(", ");
    el.appendChild(txt);
    if (names.length > ND_SHOW) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "nd-more";
      more.textContent = t("nd.more").replace("{n}", String(names.length - ND_SHOW));
      more.addEventListener("click", function () {
        txt.textContent = names.join(", ");
        more.remove();
      });
      el.appendChild(document.createTextNode(" "));
      el.appendChild(more);
    }
  }

  function renderDay() {
    var head = $("day-title");
    if (!selDate) {
      if ($("nd-line")) { $("nd-line").textContent = ""; $("nd-line").hidden = true; }
      head.textContent = "";
      $("ev-list").textContent = "";
      return;
    }
    var parts = selDate.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var txt = d.getDate() + " " + t("months")[d.getMonth()];
    if (selDate === todayYMD()) txt += " — " + t("day.today");
    head.textContent = txt;
    var wxs = wxDays([selDate])[selDate];
    if (wxs) head.appendChild(wxChip(wxs, "day-wx", true));
    renderNamedayLine();

    var ul = $("ev-list");
    ul.textContent = "";
    var list = eventsOn(selDate);
    if (!list.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("ev.none");
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (e) { ul.appendChild(buildEvRow(e, selDate)); });
  }
  
  /* ---------- 6. Navigation (view-aware) ---------- */
  // Selection follows the viewed month: the day panel always shows
  // a date that is actually on screen (Add targets the visible day).
  function navStep(dir) {
    if (curView === "day") {
      var nd = dAdd(selDate || todayYMD(), dir);
      var np = nd.split("-");
      viewYear = +np[0];
      viewMonth = +np[1] - 1;
      selectDay(nd);
      return;
    }
    if (curView === "year") {
      viewYear += dir;
      var sp0 = (selDate || todayYMD()).split("-");
      var sm = +sp0[1] - 1;
      selectDay(ymd(viewYear, sm, Math.min(+sp0[2], dimOfMonth(viewYear, sm))));
      return;
    }
    if (curView === "week") {
      weekAnchor = dAdd(weekAnchor, dir * 7);
      // Η επιλογή ταξιδεύει στην ΙΔΙΑ μέρα της εβδομάδας (shift 7
      // ημερών). Το clamp την κρατά πάντα μέσα στην ορατή εβδομάδα.
      var newSel = selDate ? dAdd(selDate, dir * 7) : weekAnchor;
      if (newSel < weekAnchor) newSel = weekAnchor;
      if (newSel > dAdd(weekAnchor, 6)) newSel = dAdd(weekAnchor, 6);
      selectDay(newSel);   // single paint
      return;
    }
    if (curView === "agenda") {
      agendaStart = dAdd(agendaStart || todayYMD(), dir * AGENDA_STEP);
      agendaLimitDays = AGENDA_STEP;
      renderAll();
      return;
    }
    // month
    viewMonth += dir;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    followView();
  }
  // Ακριβώς ΕΝΑ paint ανά πλοήγηση: αν η επιλογή μετακινείται,
  // το selectDay ζωγραφίζει· αλλιώς ζωγραφίζει εδώ.
  function followView() {
    if (selDate) {
      var p = selDate.split("-");
      if (+p[0] === viewYear && (+p[1] - 1) === viewMonth) {
        renderAll(); renderDay();
        return;
      }
      selectDay(ymd(viewYear, viewMonth, 1));   // paints internally
      return;
    }
    renderAll(); renderDay();
  }
  $("cal-prev").addEventListener("click", function () { navStep(-1); });
  $("cal-next").addEventListener("click", function () { navStep(1); });
  $("cal-today").addEventListener("click", function () {
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    agendaStart = todayYMD();
    agendaLimitDays = AGENDA_STEP;
    weekAnchor = mondayOf(todayYMD());
    $("search-in").value = "";
    searchQ = "";              // σιωπηλά — το selectDay κάνει το ΜΟΝΟ repaint
    selectDay(todayYMD());
  });

  /* ---------- 7. Event dialog (add & edit) ---------- */
  var editingId = null;

  // Label picker inside the dialog: chips + "none". Local only —
  // committed on Save (unlike the month-view chips which filter).
  var dlgLabelId = null;
  var dlgBase = null;      // CA-8: field values the open dialog started from

  /* ---------- 7c. Dialog state + series helpers ---------- */
  // dlgMode: null = plain event / new, "master" = editing the whole
  // series, "occ" = editing ONE occurrence (override on save).
  // pendingOverride carries master id + occurrence date across
  // chooser → dialog → save.
  var dlgMode = null;
  var pendingOverride = null;

  // The dialog's start day (the event's own date; new: the selected day).
  function dlgDate() {
    var v = $("ev-date") ? $("ev-date").value : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (selDate || todayYMD());
  }

  /* Repeat (wave 5). The select offers presets built from the start
     day (e.g. "Monthly on the last Friday"); "Custom…" opens every N
     days / weeks / months / years, weekdays, and day-of-month or
     Nth-weekday. "Ends": never, on a date, or after N times. */
  function repPresets(date) {
    var wd = OCC.wdOf(date);
    var nth = OCC.posOf(date, false), last = OCC.posOf(date, true) === -1;
    var list = [
      { k: "D", r: { freq: "D" } },
      { k: "W", r: { freq: "W" }, txt: t("rep.weeklyOn").replace("{d}", wdFull(wd)) },
      { k: "WD", r: { freq: "W", byday: [1, 2, 3, 4, 5] }, txt: t("rep.weekdays") },
      { k: "W2", r: { freq: "W", interval: 2 } },
      { k: "M", r: { freq: "M" } }
    ];
    if (nth >= 1 && nth <= 4) list.push({ k: "MN", r: { freq: "M", pos: nth, wday: wd } });
    if (last) list.push({ k: "ML", r: { freq: "M", pos: -1, wday: wd } });
    list.push({ k: "Y", r: { freq: "Y" } });
    list.forEach(function (p) { if (!p.txt) p.txt = recurText(sanitizeRecur(p.r, date), date); });
    return list;
  }
  function ruleKey(r, date) {
    var n = sanitizeRecur(r, date);
    if (!n) return "";
    n.until = null; n.exdates = []; delete n.count;
    return JSON.stringify(n);
  }
  function presetOf(r, date) {
    if (!validRecur(r)) return "";
    var key = ruleKey(r, date), list = repPresets(date);
    for (var i = 0; i < list.length; i++) if (ruleKey(list[i].r, date) === key) return list[i].k;
    return "C";
  }
  function fillRepeatSelect(keep) {
    var sel = $("ev-repeat");
    if (!sel) return;
    var date = dlgDate();
    sel.textContent = "";
    var add = function (k, txt) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = txt;
      sel.appendChild(o);
    };
    add("", t("rep.none"));
    repPresets(date).forEach(function (p) { add(p.k, p.txt); });
    add("C", t("rep.custom"));
    var ok = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === keep) ok = true;
    sel.value = ok ? keep : (keep ? "C" : "");
  }
  // Day-of-month / Nth weekday choice for monthly and yearly rules.
  function fillMonthMode(keep) {
    var sel = $("ev-rep-mode");
    if (!sel) return;
    var date = dlgDate(), wd = OCC.wdOf(date), p = date.split("-");
    var unit = $("ev-rep-unit").value, mon = monGen(+p[1] - 1);
    var nth = OCC.posOf(date, false), last = OCC.posOf(date, true) === -1;
    sel.textContent = "";
    var add = function (k, txt) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = txt;
      sel.appendChild(o);
    };
    add("day", unit === "Y"
      ? fill("rp.yday", { n: +p[2], m: mon })
      : t("rep.onDay").replace("{n}", String(+p[2])));
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var onNth = function (pos) {
      return cap(unit === "Y" ? fill("rp.nthm", { x: nthText(pos, wd), m: mon }) : fill("rp.nth", { x: nthText(pos, wd) }));
    };
    if (nth >= 1 && nth <= 5) add("nth", onNth(nth));
    if (last) add("last", onNth(-1));
    sel.value = keep;
    if (sel.value !== keep) sel.value = "day";
  }
  var repDays = [];
  function renderRepDays() {
    var row = $("ev-rep-days");
    if (!row) return;
    row.textContent = "";
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rep-day" + (repDays.indexOf(d) !== -1 ? " on" : "");
      b.textContent = wdShort(d);
      b.title = wdFull(d);
      b.setAttribute("aria-pressed", repDays.indexOf(d) !== -1 ? "true" : "false");
      b.addEventListener("click", function () {
        var i = repDays.indexOf(d);
        if (i === -1) repDays.push(d);
        else if (repDays.length > 1) repDays.splice(i, 1);    // at least one day
        renderRepDays();
        repSummary();
      });
      row.appendChild(b);
    });
  }
  // Show / hide the parts of the repeat block that apply.
  function syncRepeatUi() {
    var k = $("ev-repeat") ? $("ev-repeat").value : "";
    var box = $("ev-rep-custom");
    if (box) box.hidden = k !== "C";
    var unit = $("ev-rep-unit") ? $("ev-rep-unit").value : "D";
    if ($("ev-rep-days")) $("ev-rep-days").hidden = !(k === "C" && unit === "W");
    if ($("ev-rep-mode")) $("ev-rep-mode").hidden = !(k === "C" && (unit === "M" || unit === "Y"));
    var uRow = $("ev-until-row");
    if (uRow) uRow.className = "dlg-row" + (k ? " show" : "");
    var ends = $("ev-ends") ? $("ev-ends").value : "";
    if ($("ev-until")) $("ev-until").hidden = ends !== "on";
    if ($("ev-count")) $("ev-count").hidden = ends !== "n";
    if ($("ev-count-lab")) $("ev-count-lab").hidden = ends !== "n";
    repSummary();
  }
  function repSummary() {
    var el = $("ev-rep-sum");
    if (!el) return;
    var r = dlgReadRecur();
    el.textContent = r ? recurText(r, dlgDate()) : "";
    el.hidden = !r;
  }
  // Puts a rule into the dialog (null = does not repeat).
  function setRepeatUi(r, date) {
    var k = presetOf(r, date);
    fillRepeatSelect(k);
    dlgRepPrev = k;
    var n = validRecur(r) ? OCC.everyOf(r) : 1;
    $("ev-rep-n").value = String(n);
    $("ev-rep-unit").value = validRecur(r) ? r.freq : "W";
    repDays = (validRecur(r) && r.freq === "W" && Array.isArray(r.byday) && r.byday.length)
      ? r.byday.slice() : [OCC.wdOf(date)];
    renderRepDays();
    fillMonthMode(validRecur(r) && r.pos ? (r.pos === -1 ? "last" : "nth") : "day");
    var ends = !validRecur(r) ? "" : (r.count ? "n" : (r.until ? "on" : ""));
    $("ev-ends").value = ends;
    $("ev-until").value = validRecur(r) && r.until && !r.count ? r.until : "";
    $("ev-count").value = validRecur(r) && r.count ? String(r.count) : "10";
    syncRepeatUi();
  }

  function dlgReadRecur() {
    var sel = $("ev-repeat");
    if (!sel || !sel.value) return null;
    var date = dlgDate(), k = sel.value, base = null;
    if (k === "C") {
      var n = parseInt($("ev-rep-n").value, 10);
      if (!(n >= 1 && n <= 999)) n = 1;
      var u = $("ev-rep-unit").value;
      if (!/^[DWMY]$/.test(u)) u = "D";
      base = { freq: u, interval: (u === "W" && n === 2) ? 2 : 1, every: n };
      if (u === "W") base.byday = repDays.length ? repDays.slice() : [OCC.wdOf(date)];
      if (u === "M" || u === "Y") {
        var mode = $("ev-rep-mode").value;
        if (mode === "nth") { base.pos = OCC.posOf(date, false); base.wday = OCC.wdOf(date); }
        else if (mode === "last") { base.pos = -1; base.wday = OCC.wdOf(date); }
      }
    } else {
      var list = repPresets(date);
      for (var i = 0; i < list.length; i++) if (list[i].k === k) base = JSON.parse(JSON.stringify(list[i].r));
      if (!base) return null;
    }
    var ends = $("ev-ends") ? $("ev-ends").value : "";
    var untilRaw = $("ev-until") ? $("ev-until").value : "";
    if (ends === "on" && /^\d{4}-\d{2}-\d{2}$/.test(untilRaw)) base.until = untilRaw;
    if (ends === "n") {
      var c = parseInt($("ev-count").value, 10);
      if (c >= 1 && c <= 999) base.count = c;
    }
    return sanitizeRecur(base, date);
  }

  // Multi-day end date: an empty or equal-to-start value = one day.
  function dlgReadDateEnd() {
    var inp = $("ev-date-end");
    if (!inp || !inp.value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return null;
    return inp.value;
  }

  function dlgReadRemind() {
    var sel = $("ev-remind");
    if (!sel || !sel.value) return null;
    var v = parseInt(sel.value, 10);
    return REMIND_PRESETS.indexOf(v) !== -1 ? v : null;
  }

  function remLabel(min) {
    if (min >= 1440) return t("rem.day").replace("{n}", String(Math.round(min / 1440)));
    if (min >= 60)   return t("rem.hour").replace("{n}", String(Math.round(min / 60)));
    return t("rem.min").replace("{n}", String(min));
  }

  // Occurrence exclusion on a master: push + SORT (the sanitized
  // shape keeps exdates sorted — merge determinism depends on it).
  function exdateMaster(masterId, occYmd) {
    for (var i = 0; i < state.events.length; i++) {
      var m = state.events[i];
      if (m.id === masterId && validRecur(m.recur)) {
        if (m.recur.exdates.indexOf(occYmd) === -1) {
          m.recur.exdates.push(occYmd);
          m.recur.exdates.sort();
        }
        m.mtime = Date.now();
        saveState();
        return true;
      }
    }
    console.warn("[Calendar] exdateMaster: master not found", masterId);
    return false;
  }

  // Chooser: recurring event clicked (or dropped) → ask which scope
  // first. Override clones (already split off) are plain events and
  // skip this entirely. cb (optional) gets "this" | "all".
  function showSerChooser(master, occYmd, question, cb) {
    var dlg = $("ser-dlg");
    if (!dlg) { if (cb) cb("all"); else openDlg(master, "master"); return; }   // stale HTML — safe fallback
    $("ser-q").textContent = question || t("ser.edit.q");
    serCb = cb ? function (which) { if (which) cb(which); } : function (which) {
      if (which === "this") openDlgOccurrence(master, occYmd);
      else if (which === "all") openDlg(master, "master");
      // which === null → backdrop dismissal: pure cancel, nothing opens
    };
    dlg.showModal();
  }
  var serCb = null;

  function openDlgOccurrence(master, occYmd) {
    pendingOverride = { masterId: master.id, occYmd: occYmd };
    openDlg(master, "occ");
  }

  // Series chooser wiring + reminder select options + repeat block
  // wiring — all guarded so a stale index.html cannot crash the app.
  if ($("ser-this") && $("ser-all")) {
    $("ser-this").addEventListener("click", function () {
      $("ser-dlg").close();
      var cb = serCb; serCb = null;
      if (cb) cb("this");
    });
    $("ser-all").addEventListener("click", function () {
      $("ser-dlg").close();
      var cb = serCb; serCb = null;
      if (cb) cb("all");
    });
    $("ser-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) { this.close(); var cb = serCb; serCb = null; if (cb) cb(null); }
    });
    $("ser-dlg").addEventListener("cancel", function () {
      serCb = null;   // Esc: dismissed — never act on the stale callback
    });
  }
  if ($("ev-remind")) {
    var remSel = $("ev-remind");
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = t("rem.none");
    remSel.appendChild(noneOpt);
    REMIND_PRESETS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = String(m);
      o.textContent = remLabel(m);
      remSel.appendChild(o);
    });
  }
  if ($("ev-repeat") && $("ev-rep-unit")) {
    ["D", "W", "M", "Y"].forEach(function (u) {
      var o = document.createElement("option");
      o.value = u;
      o.textContent = t("rep.u." + u);
      $("ev-rep-unit").appendChild(o);
    });
    [["", "rep.ends.never"], ["on", "rep.ends.on"], ["n", "rep.ends.n"]].forEach(function (x) {
      var o = document.createElement("option");
      o.value = x[0];
      o.textContent = t(x[1]);
      $("ev-ends").appendChild(o);
    });
    $("ev-repeat").addEventListener("change", function () {
      if (this.value === "C") {
        // Custom starts from what the preset said (or weekly).
        var r = sanitizeRecur(JSON.parse(JSON.stringify(
          (repPresets(dlgDate()).filter(function (p) { return p.k === dlgRepPrev; })[0] || { r: { freq: "W" } }).r)), dlgDate());
        $("ev-rep-n").value = String(OCC.everyOf(r));
        $("ev-rep-unit").value = r.freq;
        repDays = r.freq === "W" && r.byday ? r.byday.slice() : [OCC.wdOf(dlgDate())];
        renderRepDays();
        fillMonthMode(r.pos ? (r.pos === -1 ? "last" : "nth") : "day");
      }
      dlgRepPrev = this.value;
      syncRepeatUi();
    });
    $("ev-rep-unit").addEventListener("change", function () { fillMonthMode($("ev-rep-mode").value); syncRepeatUi(); });
    ["ev-rep-n", "ev-rep-mode", "ev-until", "ev-count"].forEach(function (id) {
      $(id).addEventListener("input", repSummary);
      $(id).addEventListener("change", repSummary);
    });
    $("ev-ends").addEventListener("change", function () {
      if (this.value === "on" && !$("ev-until").value) $("ev-until").value = dAdd(dlgDate(), 30);
      syncRepeatUi();
    });
  }
  var dlgRepPrev = "";
  // A new start day re-labels the presets ("Monthly on the 2nd Tuesday").
  if ($("ev-date")) {
    $("ev-date").addEventListener("change", function () {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.value)) return;
      var keep = $("ev-repeat").value;
      fillRepeatSelect(keep);
      if ($("ev-rep-unit").value === "W" && repDays.length === 1) repDays = [OCC.wdOf(this.value)];
      renderRepDays();
      fillMonthMode($("ev-rep-mode").value);
      syncRepeatUi();
    });
  }

  /* Time zone (wave 5): "" = this device's zone (the default). The
     list is the browser's IANA zones when it can tell them. */
  var TZ_FALLBACK = ["UTC", "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Rome",
    "Europe/Madrid", "Europe/Amsterdam", "Europe/Athens", "Europe/Istanbul", "Europe/Kiev", "Europe/Moscow",
    "Africa/Cairo", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Shanghai",
    "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland", "America/St_Johns",
    "America/Halifax", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
    "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Mexico_City", "America/Bogota",
    "America/Sao_Paulo", "America/Argentina/Buenos_Aires"];
  var tzFilled = false;
  function fillTzSelect(keep) {
    var sel = $("ev-tz");
    if (!sel) return;
    if (!tzFilled) {
      tzFilled = true;
      var list = null;
      try { if (typeof Intl.supportedValuesOf === "function") list = Intl.supportedValuesOf("timeZone"); } catch (e) { list = null; }
      if (!list || !list.length) list = TZ_FALLBACK.slice();
      var o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = t("tz.device").replace("{z}", OCC.deviceZone() || "?");
      sel.appendChild(o0);
      list.forEach(function (z) {
        if (typeof z !== "string" || !validTzName(z)) return;
        var o = document.createElement("option");
        o.value = z;
        o.textContent = z.replace(/_/g, " ");
        sel.appendChild(o);
      });
    }
    if (keep && validTzName(keep)) {
      var has = false;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === keep) has = true;
      if (!has) {
        var ox = document.createElement("option");
        ox.value = keep;
        ox.textContent = keep.replace(/_/g, " ");
        sel.appendChild(ox);
      }
      sel.value = keep;
    } else sel.value = "";
  }

  function renderDlgLabels() {
    var row = $("ev-label-row");
    row.textContent = "";
    var mk = function (id, name, color) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (dlgLabelId === id ? "" : " off");
      if (color) {
        var dot = document.createElement("span");
        dot.className = "chip-dot";
        dot.style.background = color;
        c.appendChild(dot);
      }
      c.appendChild(document.createTextNode(name));
      c.addEventListener("click", function () {
        dlgLabelId = id;
        renderDlgLabels();
      });
      row.appendChild(c);
    };
    mk(null, t("lbl.none"), null);
    ownLabels().forEach(function (l) { mk(l.id, lblName(l), l.color); });
  }

  var dlgQr = null;
  function shellOpenAt() {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; }
    catch (e) { return null; }
  }
  if ($("ev-qr")) {
    $("ev-qr").addEventListener("click", function () {
      var p = shellOpenAt(), target = dlgQr;
      if (!p || !target) return;
      $("ev-dlg").close();     // unsaved edits are left behind, like Cancel
      p.__orosOpenAt("qr", target);
    });
  }

  // Timesheet: "Track time" starts a Timesheet timer named after the
  // SAVED event (__orosOpenAt("timesheet", { startTimer: { title } });
  // the user's own click, like Start there; a running timer is kept).
  // Shown inside orOS only, and only when the shell lists Timesheet
  // among the installed apps (orosAssistInstalled).
  var dlgTrack = null, tsInstalled = false;
  if (shellOpenAt()) {
    try {
      var inst = window.parent.orosAssistInstalled;
      tsInstalled = typeof inst === "function" && inst().some(function (a) { return a && a.id === "timesheet"; });
    } catch (e) {}
  }
  if ($("ev-track")) {
    $("ev-track").addEventListener("click", function () {
      var p = shellOpenAt(), title = dlgTrack;
      if (!p || !title) return;
      $("ev-dlg").close();     // unsaved edits are left behind, like Cancel
      p.__orosOpenAt("timesheet", { startTimer: { title: title } });
    });
  }

  // Mail: "Email" writes a message about the SAVED event (orOS Mail
  // compose receiver: a prefilled draft, never sent by itself). To =
  // the addresses written in the event; shown only when Mail has an
  // account on this device.
  var dlgMail = null;
  function mailReady() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return !!(d && Array.isArray(d.accounts) && d.accounts.length);
    } catch (e) { return false; }
  }
  function mailFromEvent(ev, ymd) {
    var lc = loc();
    var when = new Date(dparse(ymd)).toLocaleDateString(lc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (ev.start) when += ", " + ev.start + (ev.end ? "\u2013" + ev.end : "");
    var lines = [ev.title, when];
    if (ev.location) lines.push(ev.location);
    if (ev.note) lines.push("", ev.note);
    var seen = {}, to = [];
    String([ev.title, ev.location, ev.note].join(" ")).replace(/[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[a-z]{2,}/gi, function (a) {
      if (!seen[a.toLowerCase()] && to.length < 50) { seen[a.toLowerCase()] = 1; to.push(a); }
    });
    return { compose: { to: to.join(", "), subject: String(ev.title || "").slice(0, 300), body: lines.join("\n").slice(0, 20000) } };
  }
  // "Send to someone" (shell share/, kind "event"): the SAVED event in
  // a link; an occurrence of a series goes as that one day.
  var dlgShare = null;
  function shareApi() {
    try { return window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; }
    catch (e) { return null; }
  }
  // An event as seen here on one occurrence (local times), for the
  // Mail / Send texts.
  function localView(ev, occYmd) {
    return viewOf(ev, OCC.instance(ev, occYmd || ev.date));
  }
  function sharePayload(ev, occYmd) {
    var v = localView(ev, occYmd);
    var d = { id: ev.id, t: ev.title || t("ev.untitled"), d: v.date, l: ev.location, x: ev.note };
    if (v.start) { d.s = v.start; if (v.end) d.e = v.end; }
    if (v.dateEnd && v.dateEnd > v.date && (!occYmd || !v.start || v.end)) d.de = v.dateEnd;
    if (!occYmd && validRecur(ev.recur)) {
      d.r = { f: ev.recur.freq, i: OCC.everyOf(ev.recur) === 2 && ev.recur.freq === "W" ? 2 : 1 };
      if (ev.recur.until) d.r.u = ev.recur.until;
      // A rule the short form cannot say travels as RRULE text too.
      var rr = OCC.toRrule(ev);
      var simple = OCC.toRrule({ date: ev.date, recur: { freq: ev.recur.freq, interval: d.r.i, until: ev.recur.until, exdates: [] } });
      if (rr && rr !== simple) d.r.x = rr;
    }
    if (occYmd) d.id = ev.id + "-" + occYmd.replace(/-/g, "");
    return d;
  }
  if ($("ev-share")) {
    $("ev-share").addEventListener("click", function () {
      var api = shareApi(), d = dlgShare;
      if (!api || !d) return;
      $("ev-dlg").close();     // unsaved edits are left behind, like Cancel
      api.open({ kind: "event", data: d });
    });
  }

  if ($("ev-mail")) {
    $("ev-mail").addEventListener("click", function () {
      var p = shellOpenAt(), target = dlgMail;
      if (!p || !target) return;
      $("ev-dlg").close();     // unsaved edits are left behind, like Cancel
      p.__orosOpenAt("mail", target);
    });
  }

  function openDlg(existing, mode) {
    dlgMode = mode || null;
    if (mode !== "occ") pendingOverride = null;   // kept by openDlgOccurrence
    editingId = (mode === "occ") ? null : (existing ? existing.id : null);
    var occ = (mode === "occ" && pendingOverride) ? pendingOverride.occYmd : null;
    $("ev-dlg-title").textContent = t(existing ? "ev.dlg.edit" : "ev.dlg.new");
    $("ev-title").value = existing ? existing.title : "";
    // Days: the event's own (an occurrence: its own day; new: the
    // selected day). A span keeps its length.
    var dDate = existing ? (occ || existing.date) : (selDate || todayYMD());
    var span = existing ? OCC.spanOf(existing) : 0;
    if ($("ev-date")) $("ev-date").value = dDate;
    if ($("ev-date-end")) $("ev-date-end").value = span ? dAdd(dDate, span) : "";
    $("ev-start").value = existing && existing.start ? existing.start : "09:00";
    $("ev-end").value = existing && existing.end ? existing.end : "";
    $("ev-allday").checked = existing ? existing.start === null : false;
    fillTzSelect(existing && existing.start ? existing.tz : "");
    $("ev-allday").dispatchEvent(new Event("change"));
    $("ev-location").value = existing ? existing.location : "";
    $("ev-note").value = existing ? existing.note : "";

    // Repeat: masters carry it; an occurrence override starts plain.
    var r = (mode === "occ") ? null : (existing ? existing.recur : null);
    if ($("ev-repeat") && $("ev-rep-unit")) setRepeatUi(validRecur(r) ? r : null, dDate);
    // Reminder: prefilled from the event (occurrence inherits master's).
    var remSel = $("ev-remind");
    if (remSel) {
      remSel.value = (existing && existing.remindMin) ? String(existing.remindMin) : "";
    }

    dlgLabelId = existing ? existing.labelId : null;
    renderDlgLabels();
    // Occurrence mode keeps the delete button too — del-dlg-yes
    // routes occ-mode deletes to exdateMaster (the series lives on).
    $("ev-del-row").className = "dlg-row" +
      (existing ? " show" : "");
    // QR app: a new event code from the SAVED event (shell deep link;
    // an occurrence of a series passes its own date).
    dlgQr = existing ? { from: "calendar", id: existing.id } : null;
    if (dlgQr && occ) dlgQr.date = occ;
    var qrBtn = $("ev-qr");
    if (qrBtn) qrBtn.hidden = !(dlgQr && shellOpenAt());
    dlgTrack = existing && tsInstalled && shellOpenAt()
      ? String(existing.title || t("ev.untitled")).replace(/\s+/g, " ").trim().slice(0, 200) : null;
    var trackBtn = $("ev-track");
    if (trackBtn) trackBtn.hidden = !dlgTrack;
    dlgMail = existing && shellOpenAt() && mailReady()
      ? mailFromEvent(localView(existing, occ), occ ? OCC.instance(existing, occ).date : OCC.instance(existing, existing.date).date) : null;
    dlgShare = existing && shareApi() ? sharePayload(existing, occ) : null;
    var shareBtn = $("ev-share");
    if (shareBtn) shareBtn.hidden = !dlgShare;
    var mailBtn = $("ev-mail");
    if (mailBtn) mailBtn.hidden = !dlgMail;
    // CA-8: what the dialog showed at open — a pull may update every
    // field the user has not touched since.
    dlgBase = (existing && mode !== "occ") ? {
      selDate: selDate, date: existing.date, title: existing.title,
      note: existing.note, location: existing.location,
      remind: (existing.remindMin ? String(existing.remindMin) : ""),
      labelId: existing.labelId
    } : null;
    $("ev-dlg").showModal();
    setTimeout(function () { $("ev-title").focus(); }, 50);
  }

  $("ev-allday").addEventListener("change", function () {
    var off = $("ev-allday").checked;
    $("ev-start").disabled = off;
    $("ev-end").disabled = off;
    if ($("ev-tz-row")) $("ev-tz-row").hidden = off;
  });

  $("ev-add").addEventListener("click", function () {
    if (!selDate) selectDay(todayYMD());
    openDlg(null);
  });

  function fieldError(id, key) {
    var el = $(id);
    el.classList.add("invalid");
    el.focus();
    transientNote(t(key));
    setTimeout(function () { el.classList.remove("invalid"); }, 1600);
  }

  $("ev-save").addEventListener("click", function () {
    var title = $("ev-title").value.trim();
    if (!title) { fieldError("ev-title", "ev.err.title"); return; }
    var date = $("ev-date") ? $("ev-date").value : (selDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if ($("ev-date")) { fieldError("ev-date", "ev.err.date"); return; }
      date = selDate || todayYMD();
    }

    var start = tpStart ? tpStart.value() : null;
    var end = tpEnd ? tpEnd.value() : null;
    if ($("ev-allday").checked) { start = null; end = null; }

    // Multi-day: the end day must be on/after the start day. A repeat
    // may span days too (every occurrence lasts as long).
    var dateEnd = dlgReadDateEnd();
    if (dateEnd && dateEnd < date) { fieldError("ev-date-end", "ev.err.dateend"); return; }
    if (dateEnd === date) dateEnd = null;
    if (start && end && end <= start && !dateEnd) { fieldError("ev-end", "ev.err.time"); return; }
    var tz = (start && $("ev-tz") && validTzName($("ev-tz").value)) ? $("ev-tz").value : null;

    var recur = dlgReadRecur();
    // "until" before the start would kill every occurrence — drop it
    // instead (the series stays open).
    if (recur && recur.until && recur.until < date && !recur.count) recur.until = null;

    var location = $("ev-location").value.trim().slice(0, 150);
    var note = $("ev-note").value.trim().slice(0, 500);
    var remindMin = dlgReadRemind();
    function build(id, rec, day) {
      var span = dateEnd ? OCC.dayNum(dateEnd) - OCC.dayNum(date) : 0;
      var o = {
        id: id, date: day, dateEnd: span ? dAdd(day, span) : null, start: start, end: end,
        title: title, note: note, location: location, labelId: dlgLabelId,
        recur: rec, remindMin: remindMin, mtime: Date.now()
      };
      if (tz) o.tz = tz;
      return sanitizeEvent(o);
    }

    // "This occurrence" save → OVERRIDE: exdate on the master, then
    // a standalone copy on its (possibly new) day. The rest of the
    // series is untouched.
    if (dlgMode === "occ" && pendingOverride) {
      exdateMaster(pendingOverride.masterId, pendingOverride.occYmd);
      var one = build(uid(), null, date);             // a single instance — never a series
      state.events.push(one);
      pendingOverride = null;
      dlgMode = null;
      saveState();
      $("ev-dlg").close();
      renderAll();
      renderDay();
      return;
    }

    var savedId = editingId || uid();
    if (editingId) {
      var found = false;
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === editingId) {
          var live = state.events[i];
          // CA-8: the user did not change the day but another device
          // moved the event → keep the live date.
          var day = date;
          if (dlgBase && date === dlgBase.date && live.date !== dlgBase.date) day = live.date;
          // Excluded days ("This occurrence" edits and deletes) stay
          // with the series when it is edited as a whole.
          if (recur && validRecur(live.recur) && live.recur.exdates.length) {
            recur.exdates = live.recur.exdates.slice();
            recur = sanitizeRecur(recur, day);
          }
          state.events[i] = build(editingId, recur, day);
          found = true;
          break;
        }
      }
      // Edited while another device deleted it → resurrect with fresh input
      // (fresh mtime beats the tombstone, same contract as mood/time).
      if (!found) state.events.push(build(editingId, recur, date));
      // Any edit outranks a stale tombstone (no phantom deletes survive).
      state.deleted = state.deleted.filter(function (d) {
        return d.id !== editingId;
      });
    } else {
      state.events.push(build(savedId, recur, date));
    }
    // Web-notification permission: Save is a legal user gesture —
    // the ONLY moment we may ask. Fire-and-forget, no-op if already
    // decided or unsupported (the shell fires only when granted).
    if (remindMin && "Notification" in window &&
        Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) {}
    }
    // The day panel follows the event to its (new) day.
    var shown = OCC.instance({ date: date, start: start, tz: tz }, date).date;
    saveState();
    $("ev-dlg").close();
    var stillHere = false;
    state.events.forEach(function (e) { if (e.id === savedId && selDate && OCC.occursOn(e, selDate)) stillHere = true; });
    if (!stillHere && shown !== selDate) {
      var sp2 = shown.split("-");
      viewYear = +sp2[0];
      viewMonth = +sp2[1] - 1;
      if (curView === "week") weekAnchor = mondayOf(shown);
      selectDay(shown);
    } else {
      renderAll();
      renderDay();
    }
  });

  $("ev-cancel").addEventListener("click", function () { $("ev-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("ev-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  /* Delete: themed confirm + UNDO (resurrection via fresh mtime —
     the merge contract already guarantees the tombstone is beaten). */
  var lastDeleted = null;

  $("ev-delete").addEventListener("click", function () {
    // Occurrence mode: delete THIS occurrence (exdate on the master).
    // editingId is null here by design — the pendingOverride pair
    // carries the identity instead.
    if (dlgMode === "occ" && pendingOverride) {
      var m = null;
      for (var oi = 0; oi < state.events.length; oi++) {
        if (state.events[oi].id === pendingOverride.masterId) { m = state.events[oi]; break; }
      }
      $("del-dlg-text").textContent =
        (m && m.title ? m.title : t("ev.untitled"));
      $("del-dlg").showModal();
      $("del-dlg-yes").focus();
      return;
    }
    if (!editingId) return;
    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { ev = state.events[i]; break; }
    }
    $("del-dlg-text").textContent =
      (ev && ev.title ? ev.title : t("ev.untitled"));
    $("del-dlg").showModal();
    $("del-dlg-yes").focus();
  });

  var lastExdate = null;   // { id, ymd } — undo data for occurrence deletes

  $("del-dlg-yes").addEventListener("click", function () {
    // Deleting from occurrence mode = exdate on the master: the
    // series survives, this instance goes away. No tombstone — the
    // master is still very much alive.
    if (dlgMode === "occ" && pendingOverride) {
      exdateMaster(pendingOverride.masterId, pendingOverride.occYmd);
      lastExdate = {
        id: pendingOverride.masterId,
        ymd: pendingOverride.occYmd
      };
      saveState();
      pendingOverride = null;
      dlgMode = null;
      editingId = null;
      $("del-dlg").close();
      $("ev-dlg").close();
      renderAll();
      renderDay();
      toast(t("del.done"), t("undo"), undoExdate);
      return;
    }
    if (!editingId) { $("del-dlg").close(); return; }
    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { ev = state.events[i]; break; }
    }
    state.events = state.events.filter(function (e) { return e.id !== editingId; });
    state.deleted.push({ id: editingId, mtime: Date.now() });
    saveState();
    lastDeleted = ev ? JSON.parse(JSON.stringify(ev)) : null;
    editingId = null;   // clear dangling state
    $("del-dlg").close();
    $("ev-dlg").close();
    renderAll();
    renderDay();
    if (lastDeleted) toast(t("del.done"), t("undo"), undoDelete);
  });

  $("del-dlg-no").addEventListener("click", function () {
    $("del-dlg").close();
  });

  // Outside-click close (same pattern as #ev-dlg)
  $("del-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  function undoDelete() {
    if (!lastDeleted) return;
    lastDeleted.mtime = Date.now();   // fresh: beats the tombstone
    var undoId = lastDeleted.id;      // CA-10: never a duplicate id
    state.events = state.events.filter(function (e) { return e.id !== undoId; });
    state.events.push(lastDeleted);
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== lastDeleted.id;
    });
    lastDeleted = null;
    saveState();
    renderAll();
    renderDay();
  }

  // Undo an occurrence delete: pull the date back out of the
  // master's exdates — the occurrence simply reappears.
  function undoExdate() {
    if (!lastExdate) return;
    for (var i = 0; i < state.events.length; i++) {
      var m = state.events[i];
      if (m.id === lastExdate.id && validRecur(m.recur)) {
        m.recur.exdates = m.recur.exdates.filter(function (d) {
          return d !== lastExdate.ymd;
        });
        m.mtime = Date.now();
        break;
      }
    }
    lastExdate = null;
    saveState();
    renderAll();
    renderDay();
  }

  /* ---------- 7d. Drag & drop move + undo ----------
     Any own event (wave 5). A plain event moves with its whole span.
     A series asks first: "This occurrence" (it becomes its own event
     on the new day, the series skips the old one) or "Entire series"
     (the series starts that many days earlier / later; its weekdays,
     "Nth weekday", exdates and end date follow). The move = fresh
     mtime → travels via the sync merge. Undo puts the earlier copies
     back with ANOTHER fresh mtime (same resurrection contract as
     undoDelete) and removes a split-off occurrence. */
  var lastMoved = null;   // { before: [copies], added: id | null, backTo }

  function findEvent(id) {
    for (var i = 0; i < state.events.length; i++) if (state.events[i].id === id) return state.events[i];
    return null;
  }
  function cloneEv(e) { return JSON.parse(JSON.stringify(e)); }
  function shiftedEvent(ev, delta) {
    var n = cloneEv(ev);
    n.date = dAdd(ev.date, delta);
    if (n.dateEnd) n.dateEnd = dAdd(ev.dateEnd, delta);
    if (validRecur(n.recur)) {
      var r = n.recur;
      r.exdates = r.exdates.map(function (d) { return dAdd(d, delta); });
      if (r.until && !r.count) r.until = dAdd(r.until, delta);
      if (Array.isArray(r.byday)) r.byday = r.byday.map(function (x) { return ((x + delta) % 7 + 7) % 7; });
      if (r.pos) {
        r.wday = OCC.wdOf(n.date);
        r.pos = (r.pos === -1 && OCC.posOf(n.date, true) === -1) ? -1 : OCC.posOf(n.date, false);
      }
      n.recur = sanitizeRecur(r, n.date);
    }
    n.mtime = Date.now();
    return sanitizeEvent(n);
  }
  function replaceEvent(n) {
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === n.id) { state.events[i] = n; return; }
    }
    state.events.push(n);
  }

  // payload = "<id>|<day it was picked up on>|<its occurrence>"
  // (an older single "<id>" still works).
  function dropEvent(payload, targetYmd) {
    var parts = String(payload).split("|");
    var ev = findEvent(parts[0]);
    if (!ev) return;
    var from = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ? parts[1] : ev.date;
    var occ = /^\d{4}-\d{2}-\d{2}$/.test(parts[2] || "") ? parts[2] : ev.date;
    var delta = OCC.dayNum(targetYmd) - OCC.dayNum(from);
    if (!delta) { selectDay(targetYmd); return; }                 // no-op drop on self
    if (!validRecur(ev.recur)) {
      lastMoved = { before: [cloneEv(ev)], added: null, backTo: from };
      replaceEvent(shiftedEvent(ev, delta));
      afterMove(targetYmd);
      return;
    }
    showSerChooser(ev, occ, t("ser.move.q"), function (which) {
      var live = findEvent(ev.id);
      if (!live || !validRecur(live.recur)) return;
      lastMoved = { before: [cloneEv(live)], added: null, backTo: from };
      if (which === "this") {
        var one = cloneEv(live);
        one.id = uid();
        one.recur = null;
        one.date = occ;
        one.dateEnd = live.dateEnd ? dAdd(occ, OCC.spanOf(live)) : null;
        one = shiftedEvent(one, delta);
        exdateMaster(live.id, occ);
        state.events.push(one);
        lastMoved.added = one.id;
      } else {
        replaceEvent(shiftedEvent(live, delta));
      }
      afterMove(targetYmd);
    });
  }
  function afterMove(targetYmd) {
    saveState();
    selectDay(targetYmd);   // day panel follows — selectDay paints once
    toast(t("ev.moved"), t("undo"), undoMove);
  }

  function undoMove() {
    if (!lastMoved) return;
    var m = lastMoved;
    lastMoved = null;
    var now = Date.now();
    m.before.forEach(function (b) { b.mtime = now; replaceEvent(b); });
    if (m.added) {
      state.events = state.events.filter(function (e) { return e.id !== m.added; });
      state.deleted.push({ id: m.added, mtime: now });
    }
    saveState();
    selectDay(m.backTo);   // day panel returns — selectDay paints once
  }

  /* ---------- 7a. Label management dialog ---------- */
  function nextFreeColor() {
    for (var i = 0; i < LABEL_PALETTE.length; i++) {
      var used = state.labels.some(function (l) { return l.color === LABEL_PALETTE[i]; });
      if (!used) return LABEL_PALETTE[i];
    }
    return LABEL_PALETTE[state.labels.length % LABEL_PALETTE.length];
  }

  var lblAddColor = null;          // chosen color for the NEXT new label
  function renderLblAddColors() {
    var wrap = $("lbl-add-colors");
    wrap.textContent = "";
    var def = nextFreeColor();
    LABEL_PALETTE.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "lbl-swatch" +
        ((lblAddColor || def) === c ? " active" : "");
      sw.style.background = c;
      sw.setAttribute("aria-label", c);
      sw.addEventListener("click", function () {
        lblAddColor = c;
        renderLblAddColors();
      });
      wrap.appendChild(sw);
    });
  }

  function openLblDlg() {
    renderLblList();
    renderLblAddColors();
    $("lbl-dlg").showModal();
    $("lbl-new-name").focus();
  }

  // CA-11: a pull replaces state.labels with new objects. Handlers
  // resolve the label by id at click time; one deleted meanwhile on
  // another device is brought back by the edit (newer than its
  // tombstone — the merge contract for labels).
  function liveLabel(snap) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === snap.id) return state.labels[i];
    }
    var back = { id: snap.id, name: snap.name, color: snap.color, mtime: snap.mtime };
    state.labels.push(back);
    state.deleted = state.deleted.filter(function (d) { return d.id !== snap.id; });
    return back;
  }

  function renderLblList() {
    var list = $("lbl-list");
    list.textContent = "";
    state.labels.forEach(function (l0) {
      var l = { id: l0.id, name: l0.name, color: l0.color, mtime: l0.mtime };
      var row = document.createElement("div");
      row.className = "lbl-row";

      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "lbl-color-btn";
      dot.style.background = l.color;
      dot.setAttribute("aria-label", t("lbl.color"));
      dot.title = t("lbl.color");
      var pal = document.createElement("div");
      pal.className = "lbl-palette";
      pal.hidden = true;
      dot.addEventListener("click", function () {
        document.querySelectorAll(".lbl-palette").forEach(function (p) {
          if (p !== pal) p.hidden = true;
        });
        pal.hidden = !pal.hidden;
      });
      LABEL_PALETTE.forEach(function (c) {
        var sw = document.createElement("button");
        sw.type = "button";
        sw.className = "lbl-swatch" + (c === l.color ? " active" : "");
        sw.style.background = c;
        sw.setAttribute("aria-label", c);
        sw.addEventListener("click", function () {
          var lv = liveLabel(l);
          lv.color = c;
          stampLabel(lv);         // color change propagates via merge
          saveState();
          renderLblList();
          renderChips();
          renderAll();
          renderDay();
        });
        pal.appendChild(sw);
      });
      row.appendChild(dot);

      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "lbl-name-in";
      inp.maxLength = 40;
      inp.value = lblName(l);
      inp.addEventListener("change", function () {
        var lv = liveLabel(l);
        var nm = inp.value.trim().slice(0, 40);
        stampLabel(lv);
        if (nm) lv.name = nm;
        inp.value = lv.name;
        saveState();
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(inp);

      // BR-HH: share this calendar with a household
      if (hhApi()) {
        var sh = document.createElement("button");
        sh.type = "button";
        sh.className = "btn lbl-hh";
        sh.innerHTML = HH_SVG;
        sh.title = t("hh.share");
        sh.setAttribute("aria-label", t("hh.share") + ": " + lblName(l));
        sh.addEventListener("click", function () { hhOpen("share", l.id); });
        row.appendChild(sh);
      }

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () {
        var inUse = state.events.some(function (e) { return e.labelId === l.id; });
        if (inUse) { transientNote(t("lbl.inuse")); return; }
        state.labels = state.labels.filter(function (x) { return x.id !== l.id; });
        state.deleted.push({ id: l.id, mtime: Date.now() });   // label tombstone (shared list)
        delete labelVis[l.id];
        saveState();
        renderLblList();
        renderChips();
        renderAll();
        renderDay();
      });
      row.appendChild(del);
      row.appendChild(pal);   // color palette (toggled by the dot button)
      list.appendChild(row);
    });
    hhLooseRow(list);
    hhLblRows(list);
    // Feed labels — visible but IMMUTABLE: born from FEED_LABELS,
    // never from state.labels, so no rename/delete/color controls.
    // Pure transparency: the user sees why these chips exist.
    if (FEED_LABELS.length) {
      var fh = document.createElement("div");
      fh.className = "lbl-feeds-head";
      fh.textContent = t("lbl.feeds");
      list.appendChild(fh);
      FEED_LABELS.forEach(function (fl) {
        var row = document.createElement("div");
        row.className = "lbl-row feed";

        var dot = document.createElement("span");
        dot.className = "lbl-color-dot";
        dot.style.background = fl.color;
        row.appendChild(dot);

        var nm = document.createElement("span");
        nm.className = "lbl-feed-name";
        nm.textContent = feedLabelName(fl);
        nm.title = t("lbl.feed.ro");
        row.appendChild(nm);

        var lk = document.createElement("span");
        lk.className = "lbl-lock";
        lk.textContent = "🔒";
        lk.title = t("lbl.feed.ro");
        lk.setAttribute("aria-hidden", "true");
        row.appendChild(lk);
        list.appendChild(row);
      });
    }
    if (!state.labels.length) {
      var emp = document.createElement("div");
      emp.className = "empty";
      emp.textContent = t("lbl.empty");
      list.appendChild(emp);
    }
  }

  // BR-HH: the shared calendars in the label manager. Name and colour
  // change for the whole household; "Stop sharing" leaves everyone an
  // own copy, "Delete" leaves none here.
  var HH_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>';
  function hhLabelOf(id) {
    for (var i = 0; i < hhLabels.length; i++) if (hhLabels[i].id === id) return hhLabels[i];
    return null;
  }
  // The person's own events with no label (or a label gone from here):
  // the house icon puts them into a new label and shares that.
  function hhLoose() { return HHc ? HHc.loose(state.events, state.labels) : []; }
  function hhLooseRow(list) {
    var h = hhApi(), n = hhLoose().length;
    if (!h || !h.list().length || !n) return;
    var row = document.createElement("div");
    row.className = "lbl-row nolbl";
    var nm = document.createElement("span");
    nm.className = "lbl-feed-name";
    nm.textContent = t("lbl.none") + " · " + t("hh.loose.n").replace("{c}", n);
    row.appendChild(nm);
    var sh = document.createElement("button");
    sh.type = "button";
    sh.className = "btn lbl-hh";
    sh.innerHTML = HH_SVG;
    sh.title = t("hh.loose");
    sh.setAttribute("aria-label", t("hh.loose"));
    sh.addEventListener("click", function () { hhOpen("loose", null); });
    row.appendChild(sh);
    list.appendChild(row);
  }
  function hhLblRows(list) {
    var h = hhApi();
    if (!h) return;
    var hd = document.createElement("div");
    hd.className = "lbl-feeds-head";
    hd.textContent = t("hh.head");
    list.appendChild(hd);
    if (!hhLabels.length) {
      var hint = document.createElement("div");
      hint.className = "lbl-hh-hint";
      hint.textContent = t(h.list().length ? "hh.none" : "hh.nohh");
      list.appendChild(hint);
      if (!h.list().length) {
        var op = document.createElement("button");
        op.type = "button";
        op.className = "btn lbl-hh-open";
        op.textContent = t("hh.open");
        op.addEventListener("click", function () {
          $("lbl-dlg").close();
          try { window.parent.__orosOpenAt("household", null); } catch (e) {}
        });
        list.appendChild(op);
      }
      return;
    }
    hhLabels.forEach(function (l0) {
      var lid = l0.id, inf = hhInfo[lid] || {};
      var row = document.createElement("div");
      row.className = "lbl-row hh";
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "lbl-color-btn";
      dot.style.background = l0.color;
      dot.setAttribute("aria-label", t("lbl.color"));
      dot.title = t("lbl.color");
      var pal = document.createElement("div");
      pal.className = "lbl-palette";
      pal.hidden = true;
      dot.addEventListener("click", function () {
        document.querySelectorAll(".lbl-palette").forEach(function (p) { if (p !== pal) p.hidden = true; });
        pal.hidden = !pal.hidden;
      });
      LABEL_PALETTE.forEach(function (c) {
        var sw = document.createElement("button");
        sw.type = "button";
        sw.className = "lbl-swatch" + (c === l0.color ? " active" : "");
        sw.style.background = c;
        sw.setAttribute("aria-label", c);
        sw.addEventListener("click", function () {
          var lv = hhLabelOf(lid);
          if (!lv) return;
          lv.color = c;
          saveState();
          renderLblList(); renderChips(); renderAll(); renderDay();
        });
        pal.appendChild(sw);
      });
      row.appendChild(dot);
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "lbl-name-in";
      inp.maxLength = 40;
      inp.value = l0.name;
      inp.addEventListener("change", function () {
        var lv = hhLabelOf(lid), nm = inp.value.trim().slice(0, 40);
        if (!lv) return;
        if (nm) lv.name = nm;
        inp.value = lv.name;
        saveState();
        renderChips(); renderAll(); renderDay();
      });
      row.appendChild(inp);
      var where = document.createElement("div");
      where.className = "lbl-hh-in";
      where.textContent = t("hh.in").replace("{hh}", inf.hh || "");
      row.appendChild(where);
      var stop = document.createElement("button");
      stop.type = "button";
      stop.className = "btn lbl-hh-stop";
      stop.textContent = t("hh.stop");
      stop.addEventListener("click", function () { hhOpen("stop", lid); });
      row.appendChild(stop);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () { hhOpen("del", lid); });
      row.appendChild(del);
      row.appendChild(pal);
      list.appendChild(row);
    });
  }
  // One small dialog for the three questions: share (pick the
  // household), stop sharing, delete.
  var hhMode = null, hhFor = null;
  function hhOpen(mode, lid) {
    var h = hhApi();
    if (!h) return;
    var loose = mode === "loose", l = loose ? null : labelById(lid);
    if (!loose && !l) return;
    if (loose && !hhLoose().length) return;
    hhMode = mode; hhFor = lid;
    $("hh-dlg-title").textContent = t(loose ? "hh.loose" : (mode === "share" ? "hh.share" : (mode === "stop" ? "hh.stop" : "hh.del")));
    $("hh-dlg-text").textContent = loose ? t("hh.loose.text").replace("{c}", hhLoose().length)
      : t("hh." + mode + ".text").replace("{n}", lblName(l)).replace("{hh}", (hhInfo[lid] || {}).hh || "");
    var nmIn = $("hh-dlg-name");
    nmIn.hidden = !loose;
    if (loose) nmIn.value = t("hh.loose.def");
    if (loose) mode = "share";      // the same household picker and button
    var sel = $("hh-dlg-box"), hhs = h.list();
    sel.textContent = "";
    hhs.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.box;
      o.textContent = x.name || "?";
      sel.appendChild(o);
    });
    sel.hidden = mode !== "share" || hhs.length < 2;
    $("hh-dlg-nohh").hidden = mode !== "share" || hhs.length > 0;
    var go = $("hh-dlg-go");
    go.textContent = t(mode === "share" ? "hh.go" : (mode === "stop" ? "hh.stop" : "lbl.delete"));
    go.className = "btn " + (mode === "del" ? "danger" : "prim");
    go.disabled = mode === "share" && !hhs.length;
    $("hh-dlg").showModal();
    if (loose) { nmIn.focus(); nmIn.select(); }
  }
  // "No label" → a new label holding those events, shared as any
  // other. Should the household not take it, the events go back to no
  // label and the new label is dropped (nothing was saved meanwhile).
  function hhShareLoose(name, box) {
    var evs = hhLoose();
    if (!evs.length) { $("hh-dlg").close(); return; }
    var now = Date.now(), lid = "lbl-" + uid();
    var was = evs.map(function (e) { return { e: e, l: e.labelId, m: e.mtime }; });
    state.labels.push({ id: lid, name: name.slice(0, 40) || t("hh.loose.def"), color: nextFreeColor(), mtime: now });
    evs.forEach(function (e) { e.labelId = lid; e.mtime = Math.max(now, e.mtime || 0); });
    hhShare(lid, box, function () {
      state.labels = state.labels.filter(function (x) { return x.id !== lid; });
      was.forEach(function (w) { w.e.labelId = w.l; w.e.mtime = w.m; });
    });
  }
  function hhShare(lid, box, undo) {
    var h = hhApi(), l = null;
    state.labels.forEach(function (x) { if (x.id === lid) l = x; });
    if (!h || !l) return;
    var hh = (h.list().filter(function (x) { return x.box === box; })[0] || {}).name || "";
    var evs = state.events.filter(function (e) { return e.labelId === lid; });
    // ids the household does not take get a new one (imported events)
    evs.forEach(function (e) {
      if (HHc.ID_RE.test(e.id)) return;
      state.deleted.push({ id: e.id, mtime: Date.now() });
      e.id = uid();
    });
    var proj = HHc.project({ name: lblName(l), color: l.color }, evs);
    var rem = HHc.readRem();
    $("hh-dlg-go").disabled = true;
    Promise.resolve(h.share(box, "cal", proj.m.t, { set: proj.items, m: { c: proj.m.c } })).then(function (id) {
      // the calendar leaves the person's own one on every device of theirs
      var now = Date.now(), gone = {};
      gone[lid] = 1;
      evs.forEach(function (e) { gone[e.id] = 1; if (e.remindMin) rem[e.id] = e.remindMin; });
      try { localStorage.setItem(HHc.REM_KEY, JSON.stringify(rem)); } catch (e) {}
      state.events = state.events.filter(function (e) { return !gone[e.id]; });
      state.labels = state.labels.filter(function (x) { return x.id !== lid; });
      state.deleted = state.deleted.filter(function (d) { return !gone[d.id]; });
      Object.keys(gone).forEach(function (k) { state.deleted.push({ id: k, mtime: now }); });
      if (labelVis[lid] === false) labelVis[HHc.PREFIX + id] = false;
      delete labelVis[lid];
      hhInject();
      saveState();
      $("hh-dlg").close();
      renderLblList(); renderChips(); renderAll(); renderDay();
      transientNote(t("hh.shared").replace("{hh}", hh));
    }, function () {
      if (undo) undo();
      $("hh-dlg-go").disabled = false;
      transientNote(t("hh.fail"));
    });
  }
  function hhStop(lid, drop) {
    var h = hhApi(), inf = hhInfo[lid];
    if (!h || !inf) return;
    if (drop) hhNoCopy[inf.id] = 1;
    $("hh-dlg-go").disabled = true;
    Promise.resolve(h.unshare(inf.box, inf.id)).then(function () {
      hhInject();
      saveState();
      $("hh-dlg").close();
      renderLblList(); renderChips(); renderAll(); renderDay();
      transientNote(t(drop ? "hh.deleted" : "hh.stopped"));
    }, function () {
      $("hh-dlg-go").disabled = false;
      transientNote(t("hh.fail"));
    });
  }
  if ($("hh-dlg")) {
    $("hh-dlg-go").addEventListener("click", function () {
      if (hhMode === "loose") hhShareLoose($("hh-dlg-name").value.trim(), $("hh-dlg-box").value);
      else if (hhMode === "share") hhShare(hhFor, $("hh-dlg-box").value);
      else if (hhMode === "stop") hhStop(hhFor, false);
      else if (hhMode === "del") hhStop(hhFor, true);
    });
    $("hh-dlg-no").addEventListener("click", function () { $("hh-dlg").close(); });
    $("hh-dlg").addEventListener("click", function (ev) { if (ev.target === this) this.close(); });
  }

  $("lbl-add").addEventListener("click", function () {
    var name = $("lbl-new-name").value.trim().slice(0, 40);
    if (!name) {
      $("lbl-new-name").focus();
      return;
    }
    var id = "lbl-" + uid();
    state.labels.push({ id: id, name: name, color: lblAddColor || nextFreeColor(), mtime: Date.now() });
    $("lbl-new-name").value = "";
    lblAddColor = null;
    saveState();
    renderLblList();
    renderLblAddColors();
    renderChips();
  });
  $("lbl-new-name").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("lbl-add").click(); }
  });
  $("lbl-done").addEventListener("click", function () { $("lbl-dlg").close(); });
  $("lbl-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });
  
  /* ---------- 7b. Shell shortcut forwarding (Contract Β) ---------- */
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts &&
        typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  /* ---------- 7e. ICS export ----------
     The text comes from calendar/ics.js build() (pure, RFC 5545
     subset; also the .oroscal file's preview/calendar.ics): VEVENT
     with UID/DTSTART/DTEND/SUMMARY/DESCRIPTION/LOCATION/RRULE/EXDATE/
     CATEGORIES/VALARM, all-day as VALUE=DATE, a zoned event with
     TZID=<IANA>. Here: the label names and saving the file. */
  function icsText(events) {
    return window.OrosIcs.build(events, {
      untitled: t("ev.untitled"),
      label: function (id) { var lb = labelById(id); return lb ? String(lb.name || "") : null; }
    });
  }
  function exportICS() {
    if (!window.OrosIcs || typeof window.OrosIcs.build !== "function") return;
    var blob = new Blob([icsText(state.events)], { type: "text/calendar;charset=utf-8" });
    var done = function () { transientNote(t("exp.done")); };
    var dlg = dialogHost();

    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({
        blob: blob,
        filename: "oros-calendar.ics",
        mime: "text/calendar;charset=utf-8",
        types: [{ description: "iCalendar",
                  accept: { "text/calendar": [".ics"] } }]
      }).then(function (r) { if (r && r.ok) done(); });
      return;                         // cancel (ok=false) = silent exit
    }

    // Standalone fallback — classic download (no shell present).
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "oros-calendar.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    done();
  }
  if ($("cal-export")) {
    $("cal-export").addEventListener("click", exportICS);
  }

  /* ---------- 7e2. ICS import ----------
     calendar/ics.js parses (pure, RFC 5545 subset); this part only
     compares with what is stored, asks, and saves. Never silent: a
     themed dialog shows new / updated / unchanged counts first. The
     same path serves the Import button and BR-FILE-IMPORT
     (__orosOpenAt("calendar", { importIcs: { name, text } }), a file
     handed over by the shell). Imported events are ordinary events:
     fresh mtime, so they sync and win over an older copy or
     tombstone like any edit. */
  var ICS_MAX_CHARS = 5 * 1024 * 1024;
  var impPending = null;
  function sameEvent(a, b) {
    var ka = ["date", "dateEnd", "start", "end", "title", "note", "location", "labelId", "remindMin", "tz"];
    for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
    return JSON.stringify(a.recur) === JSON.stringify(b.recur);
  }
  function importIcsText(text, name) {
    if (typeof text !== "string" || !window.OrosIcs) { transientNote(t("imp.bad")); return; }
    if (text.length > ICS_MAX_CHARS) { transientNote(t("imp.big")); return; }
    var res;
    try { res = window.OrosIcs.parse(text); } catch (e) {
      console.error("calendar: ICS import failed:", e);
      transientNote(t("imp.bad"));
      return;
    }
    if (!res.found) { transientNote(t("imp.bad")); return; }
    var byId = {};
    state.events.forEach(function (e) { byId[e.id] = e; });
    var lblByName = {};
    state.labels.forEach(function (l) { lblByName[String(l.name).toLowerCase()] = l.id; });
    var add = [], upd = [], same = 0;
    res.events.forEach(function (pe) {
      var lid = null;
      for (var c = 0; c < pe.cats.length && !lid; c++) lid = lblByName[pe.cats[c].toLowerCase()] || null;
      var ev = sanitizeEvent({
        id: pe.id, date: pe.date, dateEnd: pe.dateEnd, start: pe.start, end: pe.end,
        title: pe.title, note: pe.note, location: pe.location, labelId: lid,
        recur: pe.recur, remindMin: pe.remindMin, tz: pe.tz || null, mtime: 0
      });
      if (!ev) return;
      var cur = byId[ev.id];
      if (!cur) add.push(ev);
      else if (sameEvent(cur, ev)) same++;
      else { if (!lid) ev.labelId = cur.labelId; upd.push(ev); }
    });
    if (!add.length && !upd.length) { transientNote(t("imp.none")); return; }
    impPending = { add: add, upd: upd };
    $("imp-name").textContent = String(name || "").slice(0, 120);
    $("imp-sum").textContent = t("imp.sum").replace("{new}", add.length)
      .replace("{upd}", upd.length).replace("{same}", same);
    var notes = [];
    if (res.simplified) notes.push(t("imp.simpl").replace("{n}", res.simplified));
    if (res.skipped) notes.push(t("imp.skip").replace("{n}", res.skipped));
    if (res.more) notes.push(t("imp.more").replace("{n}", window.OrosIcs.MAX_EVENTS));
    $("imp-notes").textContent = notes.join(" ");
    $("imp-notes").hidden = !notes.length;
    try { if ($("imp-dlg").open) $("imp-dlg").close(); } catch (e) {}
    $("imp-dlg").showModal();
  }
  function commitIcsImport() {
    var p = impPending;
    impPending = null;
    $("imp-dlg").close();
    if (!p) return;
    var now = Date.now();
    var ids = {};
    p.upd.forEach(function (ev) { ev.mtime = now; ids[ev.id] = ev; });
    state.events = state.events.map(function (e) { return ids[e.id] || e; });
    p.add.forEach(function (ev) { ev.mtime = now; state.events.push(ev); ids[ev.id] = ev; });
    state.deleted = state.deleted.filter(function (d) { return !ids[d.id]; });
    saveState();
    renderAll();
    renderDay();
    transientNote(t("imp.done").replace("{n}", p.add.length + p.upd.length));
  }
  function readIcsFile(f) {
    if (!f) return;
    if (f.size > ICS_MAX_CHARS) { transientNote(t("imp.big")); return; }
    var fr = new FileReader();
    fr.onload = function () { importIcsText(String(fr.result), f.name); };
    fr.onerror = function () { transientNote(t("imp.bad")); };
    fr.readAsText(f, "utf-8");
  }
  // On this phone (BR-PHONE): only inside the orOS Android app, which
  // mirrors this app's data into the phone's own Calendar. The shell
  // (phone.js) owns the channel; this is just the switch and status.
  var orosPhone = null;
  try { if (window.parent && window.parent !== window) orosPhone = window.parent.orosPhone || null; } catch (e) {}
  // App feeds and holidays exist only as this app renders them, so the
  // days around today are written for phone.js (feedRows) to send with
  // the events: device-local "oros-phone-cal-feeds", only while the
  // mirror is on. Hidden labels stay hidden on the phone too.
  // Edits made in the phone's Calendar (BR-PHONE v2): phone.js writes
  // them to the blob, then this open copy re-reads it.
  window.__orosPhoneReload = function (kind) {
    if (kind !== "calendar") return;
    loadState();
    renderAll();
  };
  var PHONE_FEEDS_KEY = "oros-phone-cal-feeds", PHONE_BACK = 14, PHONE_AHEAD = 180, phoneTimer = null;
  function phonePublish() {
    if (!orosPhone || !orosPhone.enabled("calendar")) return;
    clearTimeout(phoneTimer);
    phoneTimer = setTimeout(function () {
      var items = [], from = dAdd(todayYMD(), -PHONE_BACK);
      for (var i = 0; i <= PHONE_BACK + PHONE_AHEAD; i++) {
        var day = dAdd(from, i);
        eventsOn(day).forEach(function (r) {
          if (!r || !r._feed || r.id == null) return;
          var l = labelById(r.labelId), what = !l ? "" : l.id.indexOf("lbl-feed-") === 0 ? feedLabelName(l) : lblName(l);
          var note = typeof r.note === "string" && r.note ? r.note : "";
          items.push({ k: String(r.id), date: day, start: r.start || null, end: r.end || null, color: l ? l.color : null,
                       title: String(r.title || what), note: what && note ? what + "\n" + note : (note || what) });
        });
      }
      try { localStorage.setItem(PHONE_FEEDS_KEY, JSON.stringify({ at: Date.now(), items: items })); } catch (e) {}
    }, 1500);
  }
  function phoneRender() {
    if (!orosPhone || !$("cal-mirror")) return;
    $("cal-mirror").hidden = !orosPhone.available();
    if (!$("ph-dlg").open) return;
    var st = orosPhone.state() || {}, perm = st.calendar || "ask";
    var on = orosPhone.enabled("calendar"), last = orosPhone.lastSync("calendar");
    $("ph-on").checked = on;
    $("ph-allow").hidden = perm === "granted";
    var msg;
    if (perm === "denied") msg = t("ph.denied");
    else if (perm !== "granted") msg = t("ph.ask");
    else if (!on) msg = t("ph.off");
    else if (last.err) msg = t("ph.err").replace("{e}", last.err);
    else if (!last.at) msg = t("ph.wait");
    else msg = t("ph.last").replace("{t}", new Date(last.at).toLocaleString(loc(),
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))
      .replace("{n}", String(last.n)).replace("{what}", t("ph.what"));
    $("ph-stat").textContent = msg;
  }
  if (orosPhone && $("cal-mirror") && $("ph-dlg")) {
    var phoneOff = orosPhone.onChange(phoneRender);
    window.addEventListener("pagehide", function () { phoneOff(); });
    $("cal-mirror").addEventListener("click", function () {
      $("ph-dlg").showModal();
      orosPhone.refresh();
      phoneRender();
    });
    $("ph-on").addEventListener("change", function () {
      var st = orosPhone.state() || {};
      orosPhone.setEnabled("calendar", $("ph-on").checked);
      phonePublish();
      // Switching on before Android allowed it: ask in the same tap.
      if ($("ph-on").checked && st.calendar !== "granted") orosPhone.askPermission("calendar");
      phoneRender();
    });
    $("ph-allow").addEventListener("click", function () { orosPhone.askPermission("calendar"); });
    $("ph-close").addEventListener("click", function () { $("ph-dlg").close(); });
    phoneRender();
  }

  if ($("cal-import")) {
    $("cal-import").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile(".ics,text/calendar").then(readIcsFile);
        return;                          // cancel (null) = silent exit
      }
      $("ics-file").click();             // standalone fallback
    });
  }
  if ($("ics-file")) {
    $("ics-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      readIcsFile(f);
    });
  }
  if ($("imp-dlg")) {
    $("imp-go").addEventListener("click", commitIcsImport);
    $("imp-no").addEventListener("click", function () { impPending = null; $("imp-dlg").close(); });
    $("imp-dlg").addEventListener("close", function () { impPending = null; });
  }

  /* ---------- 7e3. One-time import from Google Calendar ----------
     /google-import.js signs in (token flow, read-only scope), gcal.js
     reads and turns Google's events into the ICS parser's events (same
     ids as an .ics import of the same calendar). Here: the dialog —
     wait, progress, a checkbox per calendar with its counts — then ONE
     write and a toast with Undo. Only what is missing comes in: an
     event already here (same id) is left exactly as it is. Each
     calendar becomes a label of its name (an existing one is reused).
     Undo takes out what came in (tombstones newer than the import)
     and the labels it made. */
  var GI = window.OrosGoogleImport || null, GCAL = window.OrosGcal || null;
  var giBusy = false, giCals = null;
  function giStat(text) { $("gi-stat").textContent = text || ""; }
  function giShow(phase) {
    $("gi-pick").hidden = phase !== "pick";
    $("gi-go").hidden = phase !== "pick";
    $("gi-no").textContent = t(phase === "wait" ? "gi.cancel" : "gi.close");
  }
  function giLabelFor(name) {
    var low = String(name).toLowerCase();
    for (var i = 0; i < state.labels.length; i++) {
      if (String(state.labels[i].name).toLowerCase() === low) return state.labels[i].id;
    }
    return null;
  }
  // What the ticked calendars bring: new events only, first calendar wins.
  function giPlan() {
    var have = {}, seen = {}, out = { add: [], dup: 0, simpl: 0, more: false, cals: [] };
    state.events.forEach(function (e) { have[e.id] = 1; });
    (giCals || []).forEach(function (c, i) {
      var box = $("gi-list").querySelector('input[data-i="' + i + '"]');
      if (!box || !box.checked) return;
      var n = 0;
      c.events.forEach(function (pe) {
        if (have[pe.id]) return;
        if (seen[pe.id]) { out.dup++; return; }
        seen[pe.id] = 1;
        out.add.push({ cal: c, pe: pe });
        n++;
      });
      if (n) out.cals.push(c);
      out.simpl += c.simplified;
      if (c.more) out.more = true;
    });
    return out;
  }
  function giSync() {
    var p = giPlan();
    var notes = [t("gi.sum").replace("{n}", p.add.length)];
    if (p.dup) notes.push(t("gi.dup").replace("{n}", p.dup));
    if (p.simpl) notes.push(t("imp.simpl").replace("{n}", p.simpl));
    if (p.more) notes.push(t("imp.more").replace("{n}", GCAL.MAX_EVENTS));
    giStat(notes.join(" "));
    $("gi-go").disabled = !p.add.length;
  }
  function giPreview(cals) {
    giCals = cals;
    var list = $("gi-list"), have = {};
    state.events.forEach(function (e) { have[e.id] = 1; });
    list.textContent = "";
    cals.forEach(function (c, i) {
      var nw = 0, same = 0;
      c.events.forEach(function (pe) { if (have[pe.id]) same++; else nw++; });
      var lab = document.createElement("label"), cb = document.createElement("input");
      var txt = document.createElement("span"), nm = document.createElement("span"), meta = document.createElement("span");
      lab.className = "gi-row";
      cb.type = "checkbox";
      cb.setAttribute("data-i", String(i));
      cb.checked = c.on && nw > 0;
      cb.disabled = !nw;
      nm.className = "gi-name";
      nm.textContent = c.name;
      meta.className = "gi-meta";
      meta.textContent = t("gi.row").replace("{new}", nw).replace("{same}", same);
      txt.appendChild(nm);
      txt.appendChild(meta);
      lab.appendChild(cb);
      lab.appendChild(txt);
      list.appendChild(lab);
    });
    giShow("pick");
    giSync();
  }
  function giCommit() {
    var p = giPlan();
    if (!p.add.length) return;
    var now = Date.now(), back = { events: [], labels: [] }, lblOf = {};
    p.cals.forEach(function (c) {
      var lid = giLabelFor(c.name);
      if (!lid) {
        lid = "lbl-g" + GI.hash("gcal|" + c.id).slice(0, 12);
        if (!labelById(lid)) {
          state.labels.push({ id: lid, name: c.name.slice(0, 40), color: nextFreeColor(), mtime: now });
          state.deleted = state.deleted.filter(function (d) { return d.id !== lid; });
          back.labels.push(lid);
        }
      }
      lblOf[c.id] = lid;
    });
    var ids = {};
    p.add.forEach(function (x) {
      var pe = x.pe;
      var ev = sanitizeEvent({
        id: pe.id, date: pe.date, dateEnd: pe.dateEnd, start: pe.start, end: pe.end,
        title: pe.title, note: pe.note, location: pe.location, labelId: lblOf[x.cal.id] || null,
        recur: pe.recur, remindMin: pe.remindMin, tz: pe.tz || null, mtime: now
      });
      if (!ev) return;
      state.events.push(ev);
      ids[ev.id] = 1;
      back.events.push(ev.id);
    });
    state.deleted = state.deleted.filter(function (d) { return !ids[d.id]; });
    saveState();                                   // one write, one dirty mark
    $("gi-dlg").close();
    renderChips();
    renderAll();
    renderDay();
    var used = false;
    toast(t("gi.done").replace("{n}", back.events.length), t("undo"), function () {
      if (used) return;
      used = true;
      giUndo(back);
    });
  }
  // Tombstones newer than the import, so the events stay gone on every
  // device; the labels it made go the same way.
  function giUndo(back) {
    dropAdded(back.events.concat(back.labels));
    transientNote(t("gi.undone"));
  }
  // Undo of an import (Google, .oroscal): the events and labels it
  // added go, each with a tombstone newer than the import.
  function dropAdded(ids) {
    var t0 = Date.now(), gone = {};
    ids.forEach(function (id) { gone[id] = 1; });
    state.events = state.events.filter(function (e) { return !gone[e.id]; });
    state.labels = state.labels.filter(function (l) { return !gone[l.id]; });
    state.deleted = state.deleted.filter(function (d) { return !gone[d.id]; });
    Object.keys(gone).forEach(function (id) { state.deleted.push({ id: id, mtime: t0 }); });
    saveState();
    renderChips();
    renderAll();
    renderDay();
  }
  // Inside the click: the sign-in window must open right here.
  function giStart() {
    if (giBusy || !GI || !GCAL || !window.OrosIcs) return;
    giCals = null;
    $("gi-list").textContent = "";
    giShow("wait");
    giStat(t("gi.wait"));
    if (!$("gi-dlg").open) $("gi-dlg").showModal();
    giBusy = true;
    GI.run({
      scope: GI.SCOPES.calendar,
      progress: function (n) { giStat(t("gi.read").replace("{n}", n)); },
      read: function (token, api) {
        return GCAL.read(api, function (n) { giStat(t("gi.read").replace("{n}", n)); });
      }
    }).then(function (res) {
      giBusy = false;
      var cals = GCAL.build(res.data, window.OrosIcs).filter(function (c) { return c.events.length; });
      if (!cals.length) { giShow("none"); giStat(t("gi.none")); return; }
      var nw = 0, have = {};
      state.events.forEach(function (e) { have[e.id] = 1; });
      cals.forEach(function (c) { c.events.forEach(function (pe) { if (!have[pe.id]) nw++; }); });
      if (!nw) { giShow("none"); giStat(t("gi.nothing")); return; }
      giPreview(cals);
    }, function (e) {
      giBusy = false;
      console.warn("calendar: Google import failed:", e && e.code);
      giShow("none");
      giStat(GI.message(e, LB));
    });
  }
  if ($("mm-google") && $("gi-dlg")) {
    $("mm-google").hidden = !(GI && GCAL && window.OrosIcs && GI.ready());
    $("mm-google").addEventListener("click", function () { setMore(false); giStart(); });
    $("gi-list").addEventListener("change", giSync);
    $("gi-go").addEventListener("click", giCommit);
    $("gi-no").addEventListener("click", function () { $("gi-dlg").close(); });
    // Closing the dialog while signing in stops the wait (the token,
    // if one arrives later, is never used).
    $("gi-dlg").addEventListener("close", function () { if (giBusy && GI) GI.cancel(); giCals = null; });
  }

  /* ---------- 7e4. The .oroscal file (OBF-4e) ----------
     Every event and label as one orOS file (../recordpkg.js +
     package.js). Opening ADDS what this device lacks, with its ids;
     an event already here (or deleted here) is kept as it is unless
     "Update with newer versions" is ticked. Subscriptions are not in
     the file (their addresses can hold private keys), nor the Google
     sign-in or any setting. The result goes through the sanitizers +
     saveState (so sync carries it); Undo removes the added events and
     labels the way the Google import's Undo does (tombstones). */
  var RP = window.OrosRecordPkg || null, CPK = window.OrosCalPackage || null;
  var recFile = RP && CPK && window.OrosBundle ? RP.ui(CPK.DESC, {
    lang: function () { return LANG; },
    get: function () { return mergeCalendars(personal(state), null); },   // BR-HH: own calendar only
    title: function () { return "Calendar"; },
    set: function (next) {
      if (!next || !Array.isArray(next.events)) return;
      var hhEvs = state.events.filter(isHhEv);
      state = {
        ver: 1,
        labels: (Array.isArray(next.labels) ? next.labels : []).map(sanitizeLabel).filter(Boolean),
        events: next.events.map(sanitizeEvent).filter(function (e) { return e && !isHhEv(e); }).concat(hhEvs),
        deleted: (Array.isArray(next.deleted) ? next.deleted : []).map(sanitizeTomb).filter(Boolean),
        subs: state.subs                // never from a file
      };
      saveState();
      renderChips();
      renderAll();
      renderDay();
    },
    deleteIds: function (ids) { dropAdded(ids); },
    // .ics picked in "Open orOS file…": the .ics import as usual
    notBundle: function (f) { readIcsFile(f); return true; },
    toast: function (text, undo) {
      if (undo) {
        var used = false;
        toast(text, t("undo"), function () { if (used) return; used = true; undo(); });
      } else transientNote(text);
    }
  }) : null;
  [["mm-osave", "mm.osave", "save"], ["mm-oopen", "mm.oopen", "open"], ["mm-ofolder", "mm.ofolder", "openFolder"]]
    .forEach(function (b) {
      var el = $(b[0]);
      if (!el) return;
      el.textContent = t(b[1]);
      el.hidden = !recFile;
      el.addEventListener("click", function () {
        setMore(false);
        if (recFile) recFile[b[2]]();
      });
    });

  // Generic shell deep link (one receiver per app). BR-FILE-IMPORT:
  // { importIcs: { name, text } } (an .ics handed over as text) and
  // { openFile: { token } } ("Open with" an .oroscal file, fileopen.js:
  // the File taken once with window.parent.__orosTakeFile(token)).
  // Anything else just opens the app.
  window.__orosOpenAt = function (target) {
    if (target && target.openFile) { if (recFile) recFile.openTarget(target.openFile); return; }
    var f = target && typeof target === "object" ? target.importIcs : null;
    if (f && typeof f === "object" && typeof f.text === "string") {
      importIcsText(f.text, typeof f.name === "string" ? f.name : "");
    }
  };

  /* ---------- 7f. Stats dialog (v0.3.0) ---------- */
  function openStats() {
    var body = $("stat-body");
    body.textContent = "";

    var total = state.events.length;
    var recurring = state.events.filter(function (e) {
      return validRecur(e.recur);
    }).length;

    // upcoming 30 days — occurrences included, label-filter aware.
    // CP1 (Wave 2.1 close-out): state.events ONLY. eventsOn() now
    // injects the read-only Contacts feed, but "total" and byLabel
    // are store-backed — one truth for every KPI here: no feed
    // events in stats.
    var up = 0;
    var today = todayYMD();
    for (var i = 0; i < 30; i++) {
      up += state.events.filter(function (e) {
        return occursOn(e, dAdd(today, i)) && eventVisible(e);
      }).length;
    }

    var kpis = document.createElement("div");
    kpis.className = "stat-kpis";
    [["stat.kpi.total", total], ["stat.kpi.upcoming", up],
     ["stat.kpi.recurring", recurring]].forEach(function (pair) {
      var k = document.createElement("div");
      k.className = "stat-kpi";
      var b = document.createElement("b");
      b.textContent = String(pair[1]);
      var s = document.createElement("span");
      s.textContent = t(pair[0]);
      k.appendChild(b);
      k.appendChild(s);
      kpis.appendChild(k);
    });
    body.appendChild(kpis);

    // per-label distribution (bar share of labelled events)
    var byLbl = {};
    state.events.forEach(function (e) {
      var id = e.labelId || "";
      byLbl[id] = (byLbl[id] || 0) + 1;
    });
    var entries = Object.keys(byLbl).map(function (id) {
      return { id: id, count: byLbl[id] };
    }).sort(function (a, b) { return b.count - a.count; });

    if (entries.length) {
      var hdr = document.createElement("div");
      hdr.className = "ag-day-head";
      var hs = document.createElement("span");
      hs.className = "ag-day-name";
      hs.textContent = t("stat.byLabel");
      hdr.appendChild(hs);
      body.appendChild(hdr);

      var bars = document.createElement("div");
      bars.id = "stat-bars";
      var max = entries[0].count;
      entries.forEach(function (en) {
        var row = document.createElement("div");
        row.className = "stat-row";
        var nm = document.createElement("span");
        nm.className = "stat-lbl-name";
        var lb = en.id ? labelById(en.id) : null;
        nm.textContent = lb ? lblName(lb) : t("lbl.none");
        var wrap = document.createElement("div");
        wrap.className = "stat-bar-wrap";
        var bar = document.createElement("div");
        bar.className = "stat-bar";
        bar.style.width = Math.max(4, Math.round(en.count / max * 100)) + "%";
        bar.style.background = lb ? lb.color : "var(--text-dim)";
        wrap.appendChild(bar);
        var num = document.createElement("span");
        num.className = "stat-num";
        num.textContent = String(en.count);
        row.appendChild(nm);
        row.appendChild(wrap);
        row.appendChild(num);
        bars.appendChild(row);
      });
      body.appendChild(bars);
    } else {
      var emp = document.createElement("div");
      emp.className = "stat-empty";
      emp.textContent = t("ev.none");
      body.appendChild(emp);
    }

    if (total > 0) {
      var sub = document.createElement("div");
      sub.className = "stat-sub";
      sub.textContent = t("stat.perMonth").replace("{n}", String(total));
      body.appendChild(sub);
    }
    $("stat-dlg").showModal();
  }
  if ($("cal-stats")) {
    $("cal-stats").addEventListener("click", openStats);
  }
  if ($("stat-done")) {
    $("stat-done").addEventListener("click", function () { $("stat-dlg").close(); });
  }
  if ($("stat-dlg")) {
    $("stat-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

  /* ---------- 7g. Keyboard navigation (v0.3.0) ----------
     ←/→ = prev/next (view-aware). Esc = clear search (when not in
     a dialog/input). Skipped whenever focus sits in a field — the
     time picker owns its own arrow keys, inputs own theirs. */
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector("dialog[open]")) return;   // modal open
    if (e.key === "ArrowLeft") { e.preventDefault(); navStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); navStep(1); }
    else if (e.key === "Escape" && searchQ) {
      e.preventDefault();
      $("search-in").value = "";
      setSearch("");
    }
  });
  
  /* ---------- 8c. Deep-link consumer (Wave 1B) ----------
     The unified notification system routes "calendar:" payloads
     here (via the shell's __orosOpenCalendar bridge): the app
     navigates to the reminder's day, selects it, and opens the
     event (series → occurrence chooser, plain → edit dialog).
     Payload: { id: eventId, date: "YYYY-MM-DD" }. Stale/unknown
     ids (event deleted meanwhile, or tombstoned by sync) are
     dropped safely — the day selection alone still lands. */
  var CAL_PENDING_KEY = "oros-cal-pending";
  var CAL_NEW_KEY = "oros-cal-new";

  // Wave 6/#C1 — deep-link receiver RENAMED to match the
  // DL_BRIDGE contract (shell sends __orosOpenCalendar(evId, ymd)).
  // The DL_BRIDGE wraps this as a 2-arg call for backward-compat
  // with the shell's generic routing pattern.
  function __orosCalendarOpen(evId, ymd) {
    // CA2: the shell's live path calls __calDeepLink({ id, date }) —
    // an OBJECT payload — while the staged/boot path calls this with
    // two plain args. Normalize both contracts at the door.
    if (evId && typeof evId === "object") {
      ymd = evId.date;
      evId = evId.id;
    }
    if (typeof evId !== "string" || !evId) return;
    if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    var p = ymd.split("-");
    viewYear = +p[0];
    viewMonth = +p[1] - 1;
    selDate = ymd; if (curView === "agenda" || curView === "year") setView("month");
    if (curView === "week") weekAnchor = mondayOf(ymd);
    var si = $("search-in");
    if (si) si.value = "";
    setSearch("");
    selectDay(ymd);

    var ev = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === evId) { ev = state.events[i]; break; }
    }
    if (!ev) {         // deleted meanwhile — day selection suffices,
      // unless it is in a shared calendar not built yet
      if (hhApi()) hhWant = { id: evId, date: ymd };
      return;
    }

    // Paint settle first (mirrors the checkReminders boot sweep
    // timing — dialogs need the paints finished before showModal).
    setTimeout(function () {
      if (validRecur(ev.recur)) showSerChooser(ev, ymd);
      else openDlg(ev);
    }, 60);
  }
  // The shell's live-path contract (verified in shell.js): it calls
  // contentWindow.__calDeepLink({ id, date }) — the object payload
  // normalized inside __orosCalendarOpen. The 2-arg shape stays
  // internal (boot staging + this file's own callers only).
  window.__calDeepLink = __orosCalendarOpen;

  /* Wave 8 — Maps → Calendar "plan route" receiver: navigates to
     the date, selects it and opens the New Event dialog prefilled
     (title / location / start time). Payload: { date: "YYYY-MM-DD",
     title?: string, location?: string, start?: "HH:MM" }. Invalid
     or absent date = silent no-op (the Maps side guards first,
     this is the belt-and-braces layer). */
  function __orosCalendarNew(p) {
    if (!p || typeof p !== "object") return;
    if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return;
    var pd = p.date.split("-");
    viewYear = +pd[0];
    viewMonth = +pd[1] - 1;
    selDate = p.date; if (curView === "agenda" || curView === "year") setView("month");
    if (curView === "week") weekAnchor = mondayOf(p.date);
    var si = $("search-in");
    if (si) si.value = "";
    setSearch("");
    selectDay(p.date);
    setTimeout(function () {
      openDlg(null);
      if (typeof p.title === "string" && p.title.trim()) {
        $("ev-title").value = p.title.trim().slice(0, 80);
      }
      if (typeof p.location === "string" && p.location.trim()) {
        $("ev-location").value = p.location.trim().slice(0, 150);
      }
      if (typeof p.note === "string" && p.note.trim()) {
        $("ev-note").value = p.note.trim().slice(0, 500);
      }
      if (typeof p.start === "string" && /^\d{2}:\d{2}$/.test(p.start)) {
        $("ev-allday").checked = false;
        $("ev-allday").dispatchEvent(new Event("change"));
        $("ev-start").value = p.start;
        // From the phone's "add to calendar" (BR-PHONE v2): an end too.
        if (typeof p.end === "string" && /^\d{2}:\d{2}$/.test(p.end)) $("ev-end").value = p.end;
      }
      if (typeof p.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dateEnd) && p.dateEnd > p.date && $("ev-date-end")) {
        $("ev-date-end").value = p.dateEnd;
        $("ev-date-end").dispatchEvent(new Event("change"));
      }
      // Wave 8 (quick add): no time said = all day; a repeat,
      // normalised like any stored one.
      if (p.allDay === true && !p.start) {
        $("ev-allday").checked = true;
        $("ev-allday").dispatchEvent(new Event("change"));
      }
      if (p.recur && validRecur(p.recur) && $("ev-repeat") && $("ev-rep-unit")) {
        var rr = OCC.normRecur(p.recur, p.date);
        if (rr) setRepeatUi(rr, p.date);
      }
    }, 60);
  }
  window.__calNewEvent = __orosCalendarNew;


  /* ---------- 7h. Wave 8: subscribed calendars (ICS by address) ----------
     A subscription { id, url, name, color, mtime } is synced in the
     slice (`subs`, union by id + the shared tombstones). Its events
     are read from the address on THIS device and kept in the
     device-local cache "oros-cal-subs-cache" (a feed can hold
     thousands of events; every device fetches its own copy, so the
     slice stays small). Reading: straight from the browser when the
     server allows it, else through the Mail relay's "web" op, the
     same way the Reader reads feeds (feeds/fetch.js, loaded on first
     use). Re-read when the Calendar opens (after 30 min) and every
     3 hours while it stays open; offline the last copy is shown. */
  var SUBS = window.OrosCalSubs || null;
  var SUBS_CACHE_KEY = "oros-cal-subs-cache";
  var SUB_OPEN_AGE = 30 * 60000;
  var SUB_EVERY = 3 * 3600000;
  var subCache = {};                 // id → cache entry (device-local)
  var subIdx = {};                   // id → day index (memory only)
  var subBusy = {};                  // id → true while it is being read
  var subNewColor = null;

  function subById(id) {
    for (var i = 0; i < state.subs.length; i++) if (state.subs[i].id === id) return state.subs[i];
    return null;
  }
  // The chip / row label of a subscription (never stored).
  function subLabel(id) {
    var x = subById(id);
    if (!x) return null;
    var c = subCache[id];
    return { id: "sub-" + id, color: x.color,
             name: x.name || (c && c.name) || (SUBS && SUBS.hostName(x.url)) || "ICS" };
  }
  function fixRecur(e) { if (e.recur) e.recur = OCC.normRecur(e.recur, e.date) || null; }
  function loadSubsCache() {
    if (!SUBS) return;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SUBS_CACHE_KEY) || "null"); } catch (e) { raw = null; }
    subCache = {};
    subIdx = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      Object.keys(raw).forEach(function (id) {
        var c = SUBS.cleanCache(raw[id]);
        if (!c) return;
        c.events.forEach(fixRecur);
        subCache[id] = c;
      });
    }
  }
  function saveSubsCache() {
    var keep = {};
    state.subs.forEach(function (x) { if (subCache[x.id]) keep[x.id] = subCache[x.id]; });
    Object.keys(subCache).forEach(function (id) { if (!keep[id]) { delete subCache[id]; delete subIdx[id]; } });
    try { localStorage.setItem(SUBS_CACHE_KEY, JSON.stringify(keep)); }
    catch (e) { if (!quotaWarned) { quotaWarned = true; transientNote(t("toast.quota")); } }
  }

  function subsFeedOn(dateStr) {
    if (!SUBS || !state.subs.length) return [];
    var out = [];
    state.subs.forEach(function (x) {
      var lid = "sub-" + x.id, c = subCache[x.id];
      if (!c || !c.events.length || !labelVisible(lid)) return;
      var idx = subIdx[x.id] || (subIdx[x.id] = SUBS.index(c.events, OCC));
      SUBS.rowsOn(c.events, idx, dateStr, OCC).forEach(function (r) {
        out.push({ id: lid + "-" + r.ev.id + "-" + r.inst.occ, title: r.ev.title, location: r.ev.location, note: "",
                   date: r.inst.date, dateEnd: r.inst.dateEnd || null, start: r.inst.start, end: r.inst.end,
                   labelId: lid, _feed: true, _sub: { sub: x.id, ev: r.ev, inst: r.inst } });
      });
    });
    return out;
  }

  // The Reader's network layer, loaded on first use.
  var feedsLibP = null;
  function feedsLib() {
    if (window.orosFeedsFetch) return Promise.resolve(window.orosFeedsFetch);
    if (feedsLibP) return feedsLibP;
    var q = SCRIPT_V ? "?v=" + encodeURIComponent(SCRIPT_V) : "";
    function load(src) {
      return new Promise(function (res) {
        var sc = document.createElement("script");
        sc.src = src + q;
        sc.onload = function () { res(true); };
        sc.onerror = function () { res(false); };
        document.head.appendChild(sc);
      });
    }
    feedsLibP = (window.orosFeedsCore ? Promise.resolve(true) : load("../feeds/core.js"))
      .then(function () { return window.orosFeedsFetch ? true : load("../feeds/fetch.js"); })
      .then(function () {
        if (!window.orosFeedsFetch) feedsLibP = null;
        return window.orosFeedsFetch || null;
      });
    return feedsLibP;
  }

  // The relay: the Reader's own address when it has one, else Mail's
  // (feeds/fetch.js falls back to Mail's by itself).
  function readerRelay() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-feeds-data") || "null");
      var e = d && d.set && d.set.relay;
      return e && typeof e.v === "string" ? e.v : "";
    } catch (err) { return ""; }
  }
  function refreshSub(x) {
    if (!SUBS || !x || subBusy[x.id]) return Promise.resolve();
    var id = x.id, url = x.url, now = Date.now();
    var prev = subCache[id] && subCache[id].url === url ? subCache[id] : null;
    subBusy[id] = true;
    renderSubsList();
    return feedsLib().then(function (F) {
      if (!F) throw { code: "lib" };
      return F.fetchOne(url, { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", timeout: 20000, relay: readerRelay });
    }).then(function (r) {
      if (r.status < 200 || r.status > 299) throw { code: "http", n: r.status };
      var text = r.text || "";
      if (text.length > ICS_MAX_CHARS) throw { code: "too-big" };
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw { code: "notics" };
      var res = SUBS.fromIcs(text, todayYMD(), window.OrosIcs);
      res.events.forEach(fixRecur);
      return { url: url, at: now, ok: now, err: "", n: 0, name: res.name, total: res.total,
               dropped: res.dropped, events: res.events };
    }).catch(function (e) {
      var keep = prev || { url: url, at: 0, ok: 0, err: "", n: 0, name: "", total: 0, dropped: 0, events: [] };
      keep.at = now;
      keep.err = (e && e.code) ? String(e.code).slice(0, 40) : "other";
      keep.n = e && typeof e.n === "number" ? e.n : 0;
      return keep;
    }).then(function (entry) {
      delete subBusy[id];
      if (!subById(id)) { renderSubsList(); return; }       // removed meanwhile
      subCache[id] = entry;
      subIdx[id] = SUBS.index(entry.events, OCC);
      saveSubsCache();
      renderChips();
      renderAll();
      renderDay();
      renderSubsList();
    });
  }
  function subErrText(c) {
    var e = c.err;
    if (e === "offline") return t("subs.err.offline");
    if (e === "norelay" || e === "cors") return t("subs.err.norelay");
    if (e === "http") return t("subs.err.http").replace("{n}", String(c.n || "?"));
    if (e === "notics" || e === "type") return t("subs.err.notics");
    if (e === "too-big") return t("subs.err.big");
    if (e === "timeout") return t("subs.err.timeout");
    return t("subs.err.other").replace("{e}", e);
  }
  // Read the subscriptions whose copy is older than maxAge (or that
  // have none, or whose address changed), one after the other.
  function subsDue(maxAge, onlyErr) {
    if (!SUBS || !state.subs.length) return;
    var now = Date.now();
    var list = state.subs.filter(function (x) {
      var c = subCache[x.id];
      if (subBusy[x.id]) return false;
      if (!c || c.url !== x.url) return true;
      if (onlyErr) return !!c.err;
      return SUBS.due(c, now, maxAge);
    });
    list.reduce(function (p, x) {
      return p.then(function () { return refreshSub(x); });
    }, Promise.resolve());
  }
  // After a pull: new subscriptions are read now, removed ones drop
  // their copy.
  function subsAfterChange() {
    if (!SUBS) return;
    saveSubsCache();
    renderChips();
    subsDue(SUB_EVERY);
    renderSubsList();
  }
  function subsBoot() {
    if (!SUBS) return;
    loadSubsCache();
    setTimeout(function () { subsDue(SUB_OPEN_AGE); }, 1200);
    setInterval(function () { subsDue(SUB_EVERY); }, 10 * 60000);
    window.addEventListener("online", function () { subsDue(SUB_EVERY, true); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") subsDue(SUB_EVERY);
    });
  }

  // ----- The subscriptions window -----
  function nextSubColor() {
    var used = {};
    state.labels.forEach(function (l) { used[l.color] = 1; });
    state.subs.forEach(function (x) { used[x.color] = 1; });
    for (var i = 0; i < LABEL_PALETTE.length; i++) if (!used[LABEL_PALETTE[i]]) return LABEL_PALETTE[i];
    return LABEL_PALETTE[state.subs.length % LABEL_PALETTE.length];
  }
  function renderSubColors() {
    var wrap = $("sub-colors");
    if (!wrap) return;
    wrap.textContent = "";
    LABEL_PALETTE.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "lbl-swatch" + (subNewColor === c ? " active" : "");
      sw.style.background = c;
      sw.setAttribute("aria-label", c);
      sw.setAttribute("aria-pressed", subNewColor === c ? "true" : "false");
      sw.addEventListener("click", function () { subNewColor = c; renderSubColors(); });
      wrap.appendChild(sw);
    });
  }
  function subMsg(text, err) {
    var p = $("sub-msg");
    if (!p) return;
    p.textContent = text || "";
    p.hidden = !text;
    p.classList.toggle("err", !!err);
  }
  function fmtStamp(ms) {
    try {
      return new Date(ms).toLocaleString(loc(),
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return ""; }
  }
  function subStatus(x) {
    if (subBusy[x.id]) return t("subs.wait");
    var c = subCache[x.id];
    if (!c || (!c.ok && !c.err)) return t("subs.never");
    if (!c.ok) return subErrText(c);
    var s = t("subs.ok").replace("{n}", String(c.events.length)).replace("{t}", fmtStamp(c.ok));
    if (c.dropped) s += " · " + t("subs.more").replace("{n}", String(c.dropped));
    if (c.err) s += " · " + t("subs.lasterr").replace("{e}", subErrText(c));
    return s;
  }
  function stampSub(x) {
    x.mtime = Date.now();
    saveState();
    renderChips();
    renderAll();
    renderDay();
  }
  function removeSub(x) {
    var cached = subCache[x.id];
    state.subs = state.subs.filter(function (y) { return y.id !== x.id; });
    state.deleted = state.deleted.filter(function (d) { return d.id !== x.id; });
    state.deleted.push({ id: x.id, mtime: Date.now() });
    saveState();
    saveSubsCache();
    renderChips();
    renderAll();
    renderDay();
    renderSubsList();
    toast(t("subs.removed"), t("undo"), function () {
      if (subById(x.id)) return;
      state.deleted = state.deleted.filter(function (d) { return d.id !== x.id; });
      state.subs.push({ id: x.id, url: x.url, name: x.name, color: x.color, mtime: Date.now() });
      if (cached) { subCache[x.id] = cached; delete subIdx[x.id]; }
      saveState();
      saveSubsCache();
      renderChips();
      renderAll();
      renderDay();
      renderSubsList();
    });
  }
  function renderSubsList() {
    var ul = $("subs-list"), dlg = $("subs-dlg");
    if (!ul || !dlg || !dlg.open) return;
    ul.textContent = "";
    if (!state.subs.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("subs.none");
      ul.appendChild(li0);
      return;
    }
    state.subs.slice().sort(function (a, b) { return a.mtime - b.mtime || (a.id < b.id ? -1 : 1); }).forEach(function (x) {
      var li = document.createElement("li");
      li.className = "sub-row";
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "sub-dot";
      dot.style.background = x.color;
      dot.title = t("subs.color");
      dot.setAttribute("aria-label", t("subs.color"));
      dot.addEventListener("click", function () {
        var i = LABEL_PALETTE.indexOf(x.color);
        x.color = LABEL_PALETTE[(i + 1) % LABEL_PALETTE.length];
        stampSub(x);
        renderSubsList();
      });
      var main = document.createElement("div");
      main.className = "sub-main";
      var nm = document.createElement("input");
      nm.type = "text";
      nm.className = "sub-name";
      nm.maxLength = 40;
      nm.value = x.name;
      nm.placeholder = subLabel(x.id).name;
      nm.setAttribute("aria-label", t("subs.name"));
      nm.addEventListener("change", function () {
        var v = nm.value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
        if (v === x.name) return;
        x.name = v;
        stampSub(x);
      });
      var url = document.createElement("div");
      url.className = "sub-url";
      url.textContent = x.url;
      var st = document.createElement("div");
      st.className = "sub-stat" + (subCache[x.id] && subCache[x.id].err && !subBusy[x.id] ? " err" : "");
      st.textContent = subStatus(x);
      main.appendChild(nm);
      main.appendChild(url);
      main.appendChild(st);
      var acts = document.createElement("div");
      acts.className = "sub-acts";
      var rf = document.createElement("button");
      rf.type = "button";
      rf.className = "btn";
      rf.textContent = t("subs.refresh");
      rf.disabled = !!subBusy[x.id];
      rf.addEventListener("click", function () { refreshSub(x); });
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn danger";
      rm.textContent = t("subs.remove");
      rm.addEventListener("click", function () { removeSub(x); });
      acts.appendChild(rf);
      acts.appendChild(rm);
      li.appendChild(dot);
      li.appendChild(main);
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }
  function openSubsDlg() {
    if (!SUBS) return;
    $("sub-url").value = "";
    $("sub-name").value = "";
    subNewColor = nextSubColor();
    renderSubColors();
    subMsg("");
    $("subs-dlg").showModal();
    renderSubsList();
  }
  function addSub() {
    var url = SUBS.normUrl($("sub-url").value);
    if (!url) { subMsg(t("subs.bad"), true); $("sub-url").focus(); return; }
    for (var i = 0; i < state.subs.length; i++) {
      if (state.subs[i].url === url) { subMsg(t("subs.dup"), true); return; }
    }
    var x = { id: "sub" + uid(), url: url,
              name: $("sub-name").value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40),
              color: subNewColor || nextSubColor(), mtime: Date.now() };
    state.subs.push(x);
    saveState();
    renderChips();
    $("sub-url").value = "";
    $("sub-name").value = "";
    subNewColor = nextSubColor();
    renderSubColors();
    subMsg("");
    renderSubsList();
    refreshSub(x);
  }
  if ($("sub-add")) {
    $("sub-add").addEventListener("click", addSub);
    $("sub-url").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSub(); } });
    $("sub-done").addEventListener("click", function () { $("subs-dlg").close(); });
  }

  // ----- A subscribed event (read-only) -----
  var svCur = null;
  function instWhen(inst, recur, recurDate) {
    var w = longDate(inst.date);
    if (inst.dateEnd && inst.dateEnd > inst.date) w += " – " + longDate(inst.dateEnd);
    w += ", " + (inst.start ? inst.start + (inst.end ? "–" + inst.end : "") : t("ev.alltime"));
    if (recur) w += " · " + recurText(recur, recurDate);
    return w;
  }
  function openSubEvent(row) {
    var s = row._sub, ev = s.ev, inst = s.inst, lb = subLabel(s.sub);
    svCur = { ev: ev, inst: inst };
    $("sv-title").textContent = ev.title || t("ev.untitled");
    $("sv-when").textContent = instWhen(inst, ev.recur, ev.date);
    $("sv-where").textContent = ev.location ? "▸ " + ev.location : "";
    $("sv-where").hidden = !ev.location;
    $("sv-note").textContent = ev.note || "";
    $("sv-note").hidden = !ev.note;
    $("sv-src").textContent = t("sv.from").replace("{name}", lb ? lblName(lb) : "");
    $("sv-dlg").showModal();
  }
  if ($("sv-dlg")) {
    $("sv-close").addEventListener("click", function () { $("sv-dlg").close(); });
    $("sv-copy").addEventListener("click", function () {
      var c = svCur;
      $("sv-dlg").close();
      if (!c) return;
      __orosCalendarNew({ date: c.inst.date, title: c.ev.title, location: c.ev.location, note: c.ev.note,
                          start: c.inst.start || undefined, end: c.inst.end || undefined,
                          dateEnd: c.inst.dateEnd || undefined, allDay: !c.inst.start });
    });
  }

  /* ---------- 7i. Wave 8: quick add ----------
     One line of words (calendar/quickadd.js, EN + EL) → the New event
     window, filled in. Nothing is saved until Save there. */
  var QA = window.OrosCalQuick || null;
  function quickParse() { return QA.parse($("qa-in").value, { today: todayYMD() }); }
  function renderQuickPrev() {
    var dl = $("qa-prev");
    dl.textContent = "";
    if (!$("qa-in").value.trim()) { dl.hidden = true; return; }
    dl.hidden = false;
    var r = quickParse();
    function row(k, v) {
      var dt = document.createElement("dt");
      dt.textContent = k;
      var dd = document.createElement("dd");
      dd.textContent = v;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    row(t("qa.what"), r.title || t("ev.untitled"));
    var when = longDate(r.date);
    if (r.dateEnd) when += " – " + longDate(r.dateEnd);
    when += ", " + (r.start ? r.start + (r.end ? "–" + r.end : "") : t("qa.allday"));
    row(t("qa.when"), when);
    if (r.recur) {
      var rr = OCC.normRecur(r.recur, r.date);
      if (rr) row(t("qa.rep"), recurText(rr, r.date));
    }
    if (r.location) row(t("qa.where"), r.location);
  }
  function openQuick() {
    if (!QA) { openDlg(null); return; }
    $("qa-in").value = "";
    renderQuickPrev();
    $("qa-dlg").showModal();
    setTimeout(function () { $("qa-in").focus(); }, 30);
  }
  if ($("qa-dlg")) {
    $("ev-quick").addEventListener("click", openQuick);
    $("qa-in").addEventListener("input", renderQuickPrev);
    $("qa-no").addEventListener("click", function () { $("qa-dlg").close(); });
    $("qa-form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!$("qa-in").value.trim()) { $("qa-in").focus(); return; }
      var r = quickParse();
      $("qa-dlg").close();
      __orosCalendarNew({ date: r.date, title: r.title, location: r.location,
                          start: r.start || undefined, end: r.end || undefined,
                          dateEnd: r.dateEnd || undefined, allDay: !r.start, recur: r.recur || undefined });
    });
  }

  /* ---------- 7j. Wave 8: share free times (booking link) ----------
     Free slots of a chosen length over the next N days within the
     hours set here, worked out on this device (calendar/free.js) from
     your own timed events and the visible subscribed calendars. The
     link is the shell's "Send to someone" (kind "slots",
     share/kinds.js): the times travel inside the link, the receiver
     picks one and gets an .ics plus a prefilled email back. */
  var FREE = window.OrosCalFree || null;
  var FREE_PREFS_KEY = "oros-cal-free-prefs";
  var FREE_LENS = [15, 30, 45, 60, 90, 120];
  var FREE_DAYS = [3, 5, 7, 14, 21, 30];
  function freePrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(FREE_PREFS_KEY) || "null"); } catch (e) {}
    return p && typeof p === "object" ? p : {};
  }
  function mailIdentity() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      var a = d && Array.isArray(d.accounts) ? d.accounts.filter(function (x) { return x && x.email; })[0] : null;
      return a ? { name: typeof a.name === "string" ? a.name : "", email: String(a.email) } : null;
    } catch (e) { return null; }
  }
  function fillSel(sel, list, val) {
    sel.textContent = "";
    list.forEach(function (o) {
      var op = document.createElement("option");
      op.value = String(o.v);
      op.textContent = o.l;
      sel.appendChild(op);
    });
    sel.value = String(val);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  }
  function halfHours(a, b) {
    var out = [];
    for (var m = a; m <= b; m += 30) {
      var v = pad(Math.floor(m / 60)) + ":" + pad(m % 60);
      out.push({ v: v, l: v });
    }
    return out;
  }
  function freeOpts() {
    var now = new Date();
    return { from: todayYMD(), days: +$("fr-days").value, len: +$("fr-len").value,
             dayStart: $("fr-from").value, dayEnd: $("fr-to").value,
             wdays: $("fr-wknd").checked ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
             nowMin: now.getHours() * 60 + now.getMinutes() + 15, max: 400 };
  }
  function freeEvents() {
    var list = state.events.slice();
    state.subs.forEach(function (x) {
      var c = subCache[x.id];
      if (!c || !labelVisible("sub-" + x.id)) return;
      c.events.forEach(function (e) { if (e.start) list.push(e); });
    });
    return list;
  }
  function freeCompute() { return FREE.slots(freeEvents(), freeOpts(), OCC); }
  function renderFreeSum() {
    var s = freeCompute(), n = 0;
    s.forEach(function (x) { n += x.m.length; });
    var txt = !n ? t("fr.none") : (n === 1 ? t("fr.sum1") : t("fr.sum").replace("{n}", String(n)).replace("{d}", String(s.length)));
    if (n && !$("fr-mail").value.trim()) txt += " " + t("fr.nomail");
    $("fr-sum").textContent = txt;
    $("fr-go").disabled = !n;
    return s;
  }
  function openFree() {
    if (!FREE) return;
    if (!shareApi()) { toast(t("fr.noshare")); return; }
    var p = freePrefs(), me = mailIdentity();
    fillSel($("fr-len"), FREE_LENS.map(function (n) {
      return { v: n, l: n < 60 || n % 60 ? t("fr.min").replace("{n}", n) : t("fr.hours").replace("{n}", n / 60) };
    }), FREE_LENS.indexOf(p.len) >= 0 ? p.len : 30);
    fillSel($("fr-days"), FREE_DAYS.map(function (n) { return { v: n, l: t("fr.dayN").replace("{n}", n) }; }),
            FREE_DAYS.indexOf(p.days) >= 0 ? p.days : 7);
    fillSel($("fr-from"), halfHours(5 * 60, 23 * 60), /^\d{2}:\d{2}$/.test(p.from || "") ? p.from : "09:00");
    fillSel($("fr-to"), halfHours(6 * 60, 24 * 60), /^\d{2}:\d{2}$/.test(p.to || "") ? p.to : "17:00");
    $("fr-wknd").checked = p.wknd === true;
    $("fr-what").value = typeof p.what === "string" ? p.what : "";
    $("fr-name").value = typeof p.name === "string" && p.name ? p.name : (me ? me.name : "");
    $("fr-mail").value = typeof p.mail === "string" && p.mail ? p.mail : (me ? me.email : "");
    $("fr-loc").value = typeof p.loc === "string" ? p.loc : "";
    renderFreeSum();
    $("free-dlg").showModal();
  }
  if ($("free-dlg")) {
    ["fr-len", "fr-days", "fr-from", "fr-to", "fr-wknd"].forEach(function (id) {
      $(id).addEventListener("change", renderFreeSum);
    });
    $("fr-mail").addEventListener("input", renderFreeSum);
    $("fr-no").addEventListener("click", function () { $("free-dlg").close(); });
    $("fr-go").addEventListener("click", function () {
      var s = renderFreeSum(), api = shareApi();
      if (!s.length || !api) return;
      var prefs = { len: +$("fr-len").value, days: +$("fr-days").value, from: $("fr-from").value, to: $("fr-to").value,
                    wknd: $("fr-wknd").checked, what: $("fr-what").value.trim().slice(0, 120),
                    name: $("fr-name").value.trim().slice(0, 80), mail: $("fr-mail").value.trim().slice(0, 120),
                    loc: $("fr-loc").value.trim().slice(0, 150) };
      try { localStorage.setItem(FREE_PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
      var data = { t: prefs.what || t("fr.what.ph"), n: prefs.name, m: prefs.mail, len: prefs.len, s: s };
      var z = OCC.deviceZone();
      if (z) data.tz = z;
      if (prefs.loc) data.l = prefs.loc;
      $("free-dlg").close();
      api.open({ kind: "slots", data: data });
    });
  }

  /* ---------- 7j2. Send a whole calendar or a date range ----------
     Share wave 3 (kind "cal", share/kinds.js): the person's OWN events
     (no subscriptions, no feeds) of one label or all, whole or only
     those with an occurrence in a date range, as the Calendar stores
     them: wall times (in `tz`, or the event's own zone `z`), the
     series rule (short form + RRULE text when richer) and its excluded
     dates. The shell's send window takes it from there (a long one
     always goes as a link with an expiry). */
  var SCAL_MAX = 5000;
  function scalRange() {
    var r = $("sc-range").value, today = todayYMD(), y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
    if (r === "month") return { f: ymdOfParts(y, m, 1), u: ymdOfParts(y, m + 1, 0) };
    if (r === "3m") return { f: today, u: dAdd(today, 91) };
    if (r === "year") return { f: y + "-01-01", u: y + "-12-31" };
    if (r === "pick") {
      var f = $("sc-from").value, u = $("sc-to").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(u)) return null;
      return u >= f ? { f: f, u: u } : { f: u, u: f };
    }
    return {};
  }
  function ymdOfParts(y, m, d) {
    var x = new Date(y, m, d);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  function scalEvents() {
    var lid = $("sc-lbl").value, rg = scalRange();
    if (!rg) return { list: [], rg: null };
    var list = state.events.filter(function (e) {
      if (lid && e.labelId !== lid) return false;
      if (!rg.f) return true;
      var hit = false;
      OCC.instancesBetween(e, rg.f, rg.u, function () { hit = true; return false; });
      return hit;
    });
    return { list: list, rg: rg };
  }
  function scalPayload(ev, lbIdx) {
    var d = { id: ev.id, t: ev.title || t("ev.untitled"), d: ev.date, l: ev.location, x: ev.note };
    if (ev.start) { d.s = ev.start; if (ev.end) d.e = ev.end; if (ev.tz && ev.tz !== OCC.deviceZone()) d.z = ev.tz; }
    if (ev.dateEnd && ev.dateEnd > ev.date) d.de = ev.dateEnd;
    if (validRecur(ev.recur)) {
      d.r = { f: ev.recur.freq, i: OCC.everyOf(ev.recur) === 2 && ev.recur.freq === "W" ? 2 : 1 };
      if (ev.recur.until) d.r.u = ev.recur.until;
      var rr = OCC.toRrule(ev);
      var simple = OCC.toRrule({ date: ev.date, recur: { freq: ev.recur.freq, interval: d.r.i, until: ev.recur.until, exdates: [] } });
      if (rr && rr !== simple) d.r.x = rr;
      if (Array.isArray(ev.recur.exdates) && ev.recur.exdates.length) d.xd = ev.recur.exdates.slice(-400);
    }
    if (ev.labelId && lbIdx[ev.labelId] !== undefined) d.b = lbIdx[ev.labelId];
    return d;
  }
  function renderScalSum() {
    $("sc-dates").hidden = $("sc-range").value !== "pick";
    var got = scalEvents(), n = got.list.length;
    var txt = !n ? t("sc.none") : (n === 1 ? t("sc.sum1") : t("sc.sum").replace("{n}", String(n)));
    if (n > SCAL_MAX) txt += " " + t("sc.cap").replace("{n}", String(SCAL_MAX));
    $("sc-sum").textContent = txt;
    $("sc-go").disabled = !n;
    return got;
  }
  function openScal() {
    if (!shareApi()) { toast(t("fr.noshare")); return; }
    var opts = [{ v: "", l: t("sc.all") }];
    ownLabels().forEach(function (l) { opts.push({ v: l.id, l: lblName(l) }); });
    fillSel($("sc-lbl"), opts, "");
    fillSel($("sc-range"), [{ v: "all", l: t("sc.r.all") }, { v: "month", l: t("sc.r.month") }, { v: "3m", l: t("sc.r.3m") },
      { v: "year", l: t("sc.r.year") }, { v: "pick", l: t("sc.r.pick") }], "all");
    var today = todayYMD();
    $("sc-from").value = today;
    $("sc-to").value = dAdd(today, 30);
    renderScalSum();
    $("scal-dlg").showModal();
  }
  if ($("scal-dlg")) {
    ["sc-lbl", "sc-range", "sc-from", "sc-to"].forEach(function (id) { $(id).addEventListener("change", renderScalSum); });
    $("sc-no").addEventListener("click", function () { $("scal-dlg").close(); });
    $("sc-go").addEventListener("click", function () {
      var got = renderScalSum(), api = shareApi();
      if (!got.list.length || !api) return;
      // Over the cap, the newest go (by start date).
      var list = got.list.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
        .slice(0, SCAL_MAX).reverse();
      var lb = [], lbIdx = {};
      list.forEach(function (e) {
        if (!e.labelId || lbIdx[e.labelId] !== undefined) return;
        var l = labelById(e.labelId);
        if (!l || lb.length >= 50) return;
        lbIdx[e.labelId] = lb.length;
        lb.push({ n: lblName(l), c: l.color });
      });
      var lid = $("sc-lbl").value, lab = lid ? labelById(lid) : null;
      var data = { t: lab ? lblName(lab) : t("sc.calName"), ev: list.map(function (e) { return scalPayload(e, lbIdx); }) };
      if (lb.length) data.lb = lb;
      if (got.rg.f) { data.f = got.rg.f; data.u = got.rg.u; }
      var z = OCC.deviceZone();
      if (z) data.tz = z;
      $("scal-dlg").close();
      api.open({ kind: "cal", data: data });
    });
  }

  /* ---------- 7k. Wave 8: print (browser print → PDF) ----------
     A plain, ink-friendly copy of the current view is built into
     #print-area just before printing; the print stylesheet hides
     everything else. Day, Week, Month, Year and Agenda. */
  function prEl(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }
  function prLine(e, day) {
    var li = prEl("li", "pr-ev");
    var dot = prEl("span", "pr-dot");
    dot.style.background = labelColor(e.labelId);
    li.appendChild(dot);
    li.appendChild(prEl("span", "pr-time", e.start ? timeSpan(e, day) : t("ev.alltime")));
    var main = prEl("span", "pr-main");
    main.appendChild(prEl("b", "", e.title || t("ev.untitled")));
    if (e.location) main.appendChild(document.createTextNode(" · " + e.location));
    if (e.note && !e._feed) main.appendChild(prEl("span", "pr-note", e.note));
    li.appendChild(main);
    return li;
  }
  function prDay(box, day, head) {
    var sec = prEl("section", "pr-day");
    if (head !== null) sec.appendChild(prEl("h2", "", head || longDate(day)));
    var list = eventsOn(day), ul = prEl("ul", "pr-list");
    if (!list.length) ul.appendChild(prEl("li", "pr-empty", t("ev.none")));
    list.forEach(function (e) { ul.appendChild(prLine(e, day)); });
    sec.appendChild(ul);
    box.appendChild(sec);
  }
  function prMonth(box, y, m, compact) {
    var tbl = prEl("table", "pr-month" + (compact ? " pr-mini" : ""));
    if (compact) {
      var cap = prEl("caption", "", t("months")[m]);
      tbl.appendChild(cap);
    }
    var hr = prEl("tr");
    t("wd").forEach(function (w) { hr.appendChild(prEl("th", "", compact ? w.charAt(0) : w)); });
    var thead = prEl("thead");
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = prEl("tbody");
    var first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7;
    var dim = new Date(y, m + 1, 0).getDate();
    var cells = Math.ceil((lead + dim) / 7) * 7, tr = null;
    for (var i = 0; i < cells; i++) {
      if (i % 7 === 0) { tr = prEl("tr"); tb.appendChild(tr); }
      var dn = i - lead + 1;
      var td = prEl("td");
      if (dn < 1 || dn > dim) { td.className = "out"; tr.appendChild(td); continue; }
      var day = ymd(y, m, dn), evs = eventsOn(day);
      td.appendChild(prEl("span", "pr-num", String(dn)));
      if (compact) {
        if (evs.length) td.className = "has";
      } else {
        var MAX = 5;
        evs.slice(0, MAX).forEach(function (e) {
          td.appendChild(prEl("div", "pr-cell-ev", (e.start ? e.start + " " : "") + (e.title || t("ev.untitled"))));
        });
        if (evs.length > MAX) td.appendChild(prEl("div", "pr-more", t("pr.more").replace("{n}", String(evs.length - MAX))));
      }
      tr.appendChild(td);
    }
    tbl.appendChild(tb);
    box.appendChild(tbl);
  }
  function buildPrint() {
    var box = $("print-area");
    if (!box) { box = prEl("div"); box.id = "print-area"; document.body.appendChild(box); }
    box.textContent = "";
    var title = prEl("h1", "pr-title");
    box.appendChild(title);
    var day = selDate || todayYMD();
    if (curView === "day") {
      title.textContent = longDate(day);
      prDay(box, day, null);
    } else if (curView === "week") {
      var mon = weekAnchor || mondayOf(day);
      title.textContent = t("pr.week").replace("{d}", longDate(mon));
      for (var i = 0; i < 7; i++) prDay(box, dAdd(mon, i));
    } else if (curView === "agenda") {
      var st = agendaStart || todayYMD(), any = false;
      title.textContent = t("pr.agenda").replace("{d}", longDate(st));
      for (var k = 0; k < agendaLimitDays; k++) {
        var d = dAdd(st, k);
        if (eventsOn(d).length) { prDay(box, d); any = true; }
      }
      if (!any) box.appendChild(prEl("p", "pr-empty", t("pr.none")));
    } else if (curView === "year") {
      title.textContent = String(viewYear);
      var grid = prEl("div", "pr-year");
      for (var mm = 0; mm < 12; mm++) prMonth(grid, viewYear, mm, true);
      box.appendChild(grid);
    } else {
      title.textContent = t("months")[viewMonth] + " " + viewYear;
      prMonth(box, viewYear, viewMonth, false);
    }
    return box;
  }
  function doPrint() {
    buildPrint();
    try { window.focus(); window.print(); } catch (e) {}
  }
  window.addEventListener("afterprint", function () {
    var box = $("print-area");
    if (box) box.textContent = "";
  });

  /* ---------- 7l. Wave 8: the "More" menu ---------- */
  function setMore(open) {
    var m = $("more-menu"), b = $("cal-more");
    if (!m || !b) return;
    m.hidden = !open;
    b.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) return;
    // Keep it on screen: anchored to the button, shifted left when needed.
    m.style.left = "0px";
    var r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    if (r.right > vw - 8) m.style.left = Math.round(vw - 8 - r.right) + "px";
  }
  if ($("cal-more")) {
    $("cal-more").textContent = t("cal.more") + " ▾";
    $("cal-more").addEventListener("click", function (e) {
      e.stopPropagation();
      setMore($("more-menu").hidden);
    });
    document.addEventListener("click", function (e) {
      var m = $("more-menu");
      if (m && !m.hidden && !m.contains(e.target)) setMore(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("more-menu").hidden) { setMore(false); $("cal-more").focus(); }
    });
    $("mm-subs").hidden = !SUBS;
    $("mm-free").hidden = !FREE;
    $("mm-subs").addEventListener("click", function () { setMore(false); openSubsDlg(); });
    $("mm-free").addEventListener("click", function () { setMore(false); openFree(); });
    $("mm-send").hidden = !shareApi();
    $("mm-send").addEventListener("click", function () { setMore(false); openScal(); });
    $("mm-print").addEventListener("click", function () { setMore(false); doPrint(); });
  }

  /* ---------- 8. Boot ---------- */
  loadState();
  applyI18n();
  // Re-translate seeded labels if the store was freshly seeded with
  // the other language (seeds depend on LANG at seed time).
  reseedSeedNames();
  tpStart = makeTP("ev-start", "ev-start-menu");
  tpEnd = makeTP("ev-end", "ev-end-menu", { noEnd: true });
  var boot = new Date();
  viewYear = boot.getFullYear();
  viewMonth = boot.getMonth();
  loadFeedVis();
  loadDays();
  subsBoot();          // wave 8: subscribed calendars (cache, then re-read)
  renderChips();
  setView("month");
  selectDay(todayYMD());
  hhBoot();            // BR-HH: calendars shared with a household
  setTimeout(checkReminders, 1500);   // boot sweep (after paints settle)
  // Wave 6/#C1: staged deep link consumption — renamed from
  // deepLink() to __orosCalendarOpen() for DL_BRIDGE parity.
  try {
    var pend = sessionStorage.getItem(CAL_PENDING_KEY);
    if (pend) {
      sessionStorage.removeItem(CAL_PENDING_KEY);
      var pl = JSON.parse(pend);
      if (pl && typeof pl === "object" && pl.id && pl.date) {
        setTimeout(function () {
          __orosCalendarOpen(pl.id, pl.date);
        }, 100);
      }
    }
  } catch (e4) {}
  // Wave 8: staged "new event" payload from Maps (shell staged it
  // while the Calendar app was not running).
  try {
    var pendNew = sessionStorage.getItem(CAL_NEW_KEY);
    if (pendNew) {
      sessionStorage.removeItem(CAL_NEW_KEY);
      var pn = JSON.parse(pendNew);
      if (pn && typeof pn === "object" && pn.date) {
        setTimeout(function () { __orosCalendarNew(pn); }, 250);
      }
    }
  } catch (e5) {}
  // Standalone deep-link: /calendar/?new={json} — Maps opened the
  // Calendar in a new tab (no shell present in that context).
  try {
    var urlNew = new URLSearchParams(location.search).get("new");
    if (urlNew) {
      var un = JSON.parse(urlNew);
      if (un && typeof un === "object" && un.date) {
        setTimeout(function () { __orosCalendarNew(un); }, 400);
      }
    }
  } catch (e6) {}

  // Midnight rollover: grid "today", day title and ev-add must
  // follow the real calendar day without a re-open.
  var shownDay = todayYMD();
  setInterval(function () {
    var td = todayYMD();
    if (td === shownDay) return;
    shownDay = td;
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    renderAll();
    selectDay(td);
  }, 30000);
  // Immediate rollover check when the tab becomes visible again
  // (battery-friendly — same guard as To-Do audit #20).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var td = todayYMD();
    if (td === shownDay) return;
    shownDay = td;
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    renderAll();
    selectDay(td);
    checkReminders();   // catch-up sweep on tab-visible
  });
  // Open-tab sweep: covers a standalone foreground tab where neither
  // the shell tick nor visibilitychange ever fires (mobile PWA).
  // Doubling with the shell engine is impossible — the fired-log
  // dedupe key settles who wins.
  setInterval(checkReminders, 30000);
  
  // Wave 1B — start-moment label for emitted reminders (mirrors
  // the shell engine's calRemWhen: "20 Sep · 09:30", locale-aware).
  function remStartLabel(due) {
    var startTs = due.remTs + due.ev.remindMin * 60000;
    var lc = loc();
    var d = new Date(startTs);
    return d.toLocaleDateString(lc, { day: "2-digit", month: "short" }) +
      " · " + d.toLocaleTimeString(lc, { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------- 8b. In-app reminder check ----------
     Belt-and-braces companion of the shell engine (shell.js 9e2):
     covers the standalone-load case (calendar opened directly,
     no parent shell). DEDUPE: both engines share the device-local
     "oros-cal-reminders-fired" key — whoever fires first wins,
     a reminder can never double-toast. Note: when orOS runs the
     app in its iframe, the shell is always alive, so this path
     is normally quiet. */

  var REM_FIRED_KEY = "oros-cal-reminders-fired";

  // Start of one occurrence (occur.js: its own time zone respected).
  function remOccTs(e, occYmd) { return OCC.startTs(e, occYmd); }

  function checkReminders() {
    var now = Date.now();
    var fired;
    try {
      var f = JSON.parse(localStorage.getItem(REM_FIRED_KEY));
      fired = Array.isArray(f) ? f : [];
    } catch (e2) { fired = []; }

    var due = null;   // earliest due wins — same doctrine as the shell
    // Walk horizon: today + 8 days. Largest preset is 5 days, so no
    // occurrence beyond it can have an open reminder window — and
    // ascending order lets us STOP the walk there (perf + correctness).
    var hz = new Date();
    hz.setDate(hz.getDate() + 8);
    var horizonYmd = ymd(hz.getFullYear(), hz.getMonth(), hz.getDate());
    state.events.forEach(function (e) {
      if (typeof e.remindMin !== "number" || e.remindMin <= 0) return;

      function check(ts, occYmd) {
        if (ts < now) return;                       // already started
        var remTs = ts - e.remindMin * 60000;
        if (remTs > now) return;                    // not due yet
        var remKey = "rem:" + e.id + ":" + occYmd;
        if (fired.indexOf(remKey) !== -1) return;
        if (!due || remTs < due.remTs) {
          due = { remTs: remTs, ev: e, remKey: remKey };
        }
      }

      if (validRecur(e.recur)) {
        eachOccurrence(e, function (occYmd) {
          if (occYmd > horizonYmd) return false;   // STOP: past horizon,
          check(remOccTs(e, occYmd), occYmd);      // nothing due further
        });
      } else {
        // Multi-day spans: the reminder anchors on the FIRST day —
        // the start of the event, per the v0.3 design note.
        check(remOccTs(e, e.date), e.date);
      }
    });

    if (!due) return;
    // Claim BEFORE notifying — whichever engine claims first, the
    // other must stay silent one tick later.
    fired.push(due.remKey);
    try {
      localStorage.setItem(REM_FIRED_KEY,
        JSON.stringify(fired.slice(-500)));
    } catch (e3) {}

    // Wave 1B: inside orOS (parent shell alive) the reminder flows
    // through the unified system — inbox + badge + styled toast +
    // per-app toggle + quiet hours. The emit key is the SAME remKey
    // the shell engine uses, so the inbox-level dedup makes a
    // double-fire impossible no matter which engine wins the race.
    // A null return (calendar notifs off / quiet hours / already in
    // inbox) is a USER DECISION — we never fall back to a local
    // toast, suppression is the point (same contract as shell T3).
    var pNotifs = null;
    try { pNotifs = window.parent && window.parent.orosNotifs; } catch (e4) {}
    if (pNotifs && typeof pNotifs.emit === "function") {
      pNotifs.emit({
        ns: "calendar",
        key: due.remKey,
        type: "reminder",
        title: (due.ev.title || t("ev.untitled")),
        body: remStartLabel(due),
        deepLink: "calendar:" + due.ev.id + ":" + due.remKey.split(":")[2]
      });
    } else {
      // Standalone load / stale shell without the module — the
      // legacy local toast stands alone (a reminder is never lost).
      toast(t("remind.toast") + " · " + (due.ev.title || t("ev.untitled")));
    }
  }

  /* ---------- 9. Sync slice registration ---------- */
  // Same self-registration contract as todo/kanban/notes: the app
  // registers itself, the engine persists the storageKey and builds
  // closed-app proxies on future boots. mergeFn = deterministic
  // entity-union with tombstones, so two devices editing (or
  // deleting!) concurrently converge instead of last-write-wins.
  //
  // LABEL SYNC DESIGN: labels reuse the SAME tombstone list as
  // events ("deleted"). A label delete pushes { id, mtime } there;
  // a label newer than its tombstone survives (rename = resurrect).
  // Benefits: zero schema additions, and feed-app labels (cycle/
  // habits stamping) can never be resurrected by a stale peer.

  // Strict merge-time sanitizers — DROP rows with invalid mtime.
  // Never Date.now() inside merge: non-determinism (Storage #6 precedent).
  function mergeSanitizeEv(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    if (typeof e.mtime !== "number" || !isFinite(e.mtime)) return null;
    var start = (typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start)) ? e.start : null;
    var end = (typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end)) ? e.end : null;
    // Multi-day: same contract as sanitizeEvent (series may span too).
    // Identical rule on EVERY device, so the JSON tie-break stays
    // byte-deterministic.
    var dateEnd = null;
    if (typeof e.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateEnd)) {
      if (e.dateEnd >= e.date) dateEnd = e.dateEnd;
    }
    if (start && end && end < start && !(dateEnd && dateEnd > e.date)) end = null;   // deterministic normalization
    var labelId = (typeof e.labelId === "string" && e.labelId) ? e.labelId : null;
    var remindMin = (typeof e.remindMin === "number" &&
                     REMIND_PRESETS.indexOf(e.remindMin) !== -1)
      ? e.remindMin : null;
    var out = {
      id: e.id,
      date: e.date,
      dateEnd: dateEnd,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      recur: sanitizeRecur(e.recur, e.date),
      remindMin: remindMin,
      mtime: e.mtime
    };
    if (start && validTzName(e.tz)) out.tz = e.tz;   // last key, only when set
    return out;
  }
  function mergeSanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    if (typeof d.mtime !== "number" || !isFinite(d.mtime)) return null;
    return { id: d.id, mtime: d.mtime };
  }
  function mergeSanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    if (typeof l.mtime !== "number" || !isFinite(l.mtime)) return null;
    // CA4: VALID_COLORS = LABEL_PALETTE + brown (#c8a96e for
    // Contacts custom events). Both merge and load sanitizers
    // must agree — if one drops brown, the other resurrects it.
    if (VALID_COLORS.indexOf(l.color) === -1) return null;
    // CA-7: untouched seeds carry the canonical name in every blob
    // (an older EL device may still send its Greek seed names).
    return canonSeedName({
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: l.mtime
    });
  }

  // Deterministic entity merge: per id, bigger mtime wins; equal
  // mtimes broken by lexicographic JSON (same output on every
  // device regardless of processing order — the engine contract).
  // Tombstones beat events on ties (a delete must not resurrect).
  // A surviving NEWER event cancels its tombstone (resurrection).
  function mergeCalendars(local, remote) {
    var tomb = {};
    function takeTomb(d) {
      if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
    }
    var byId = {};
    function takeEv(e) {
      var cur = byId[e.id];
      if (!cur || e.mtime > cur.mtime ||
          (e.mtime === cur.mtime && JSON.stringify(e) < JSON.stringify(cur))) {
        byId[e.id] = e;
      }
    }
    var subById = {};
    function takeSub(x) {
      var cur = subById[x.id];
      if (!cur || x.mtime > cur.mtime ||
          (x.mtime === cur.mtime && JSON.stringify(x) < JSON.stringify(cur))) {
        subById[x.id] = x;
      }
    }
    var lblById = {};
    function takeLbl(l) {
      var cur = lblById[l.id];
      if (!cur || l.mtime > cur.mtime ||
          (l.mtime === cur.mtime && JSON.stringify(l) < JSON.stringify(cur))) {
        lblById[l.id] = l;
      }
    }

    [local, remote].forEach(function (side) {
      if (!side || typeof side !== "object") return;
      (Array.isArray(side.deleted) ? side.deleted : [])
        .map(mergeSanitizeTomb).filter(Boolean).forEach(takeTomb);
      (Array.isArray(side.labels) ? side.labels : [])
        .map(mergeSanitizeLabel).filter(Boolean).forEach(takeLbl);
      (Array.isArray(side.events) ? side.events : [])
        .map(mergeSanitizeEv).filter(Boolean).forEach(takeEv);
      (Array.isArray(side.subs) ? side.subs : [])
        .map(mergeSanitizeSub).filter(Boolean).forEach(takeSub);
    });

    var events = [], deleted = [], labels = [];
    Object.keys(byId).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= byId[id].mtime) return;   // delete wins (ties included)
      events.push(byId[id]);                           // survived (or resurrected):
      delete tomb[id];                                 // tombstone cancelled
    });
    // Labels obey the same tombstone contract as events: a label
    // dies unless it is NEWER than its tombstone (rename wins).
    Object.keys(lblById).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= lblById[id].mtime) return;  // label deleted
      labels.push(lblById[id]);                         // survived (or renamed)
      delete tomb[id];
    });
    // Wave 8: subscriptions share the same tombstone list (ids are
    // unique across events, labels and subscriptions).
    var subs = [];
    Object.keys(subById).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= subById[id].mtime) return;
      subs.push(subById[id]);
      delete tomb[id];
    });
    Object.keys(tomb).forEach(function (id) { deleted.push(tomb[id]); });

    // Sorted by id → identical byte output on every device
    events.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    labels.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    deleted.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    subs.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var out = { ver: 1, labels: labels, events: events, deleted: deleted };
    // Left out when there are none: blobs without subscriptions keep
    // their exact bytes (no upload just for upgrading).
    if (subs.length) out.subs = subs;
    return out;
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  // CA-8 (A67 Q1): a pull never closes the open event dialog. Fields
  // the user has not touched since opening follow the live event;
  // typed fields stay. Save edits by id (a remotely deleted event is
  // brought back by the edit — the existing resurrect path).
  function refreshOpenDlg() {
    var dlg = $("ev-dlg");
    if (!dlg || !dlg.open || !dlgBase || !editingId) return;
    var live = null;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === editingId) { live = state.events[i]; break; }
    }
    if (!live) return;
    var follow = function (id, key, val) {
      var el = $(id);
      if (el && el.value === dlgBase[key] && val !== dlgBase[key]) {
        el.value = val;
        dlgBase[key] = val;
      }
    };
    follow("ev-date", "date", live.date);
    follow("ev-title", "title", live.title);
    follow("ev-note", "note", live.note);
    follow("ev-location", "location", live.location);
    follow("ev-remind", "remind", live.remindMin ? String(live.remindMin) : "");
    if (dlgLabelId === dlgBase.labelId && live.labelId !== dlgBase.labelId) {
      dlgLabelId = live.labelId;
      dlgBase.labelId = live.labelId;
    }
    renderDlgLabels();
  }

  function setFromSync(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    var evs = data.events.map(sanitizeEvent).filter(Boolean);
    var dels = (Array.isArray(data.deleted) ? data.deleted : [])
      .map(sanitizeTomb).filter(Boolean);
    var lbls = Array.isArray(data.labels)
      ? data.labels.map(sanitizeLabel).filter(Boolean)
      : defaultLabels();   // παλιό-peer blob χωρίς labels → seed
    // BR-HH: the shared calendars are not in the person's copy; they stay.
    var hhEvs = state.events.filter(isHhEv);
    state = { ver: 1, labels: lbls, events: evs.filter(function (e) { return !isHhEv(e); }).concat(hhEvs), deleted: dels,
              subs: Array.isArray(data.subs) ? data.subs.map(sanitizeSub).filter(Boolean) : [] };
    // CA-10: Undo data survives a pull (R28) — undoDelete/undoMove/
    // undoExdate all work by id on the live state.
    reseedSeedNames();
    refreshOpenDlg();
    writeStore();         // no markDirty: this IS the sync result
    subsAfterChange();    // wave 8: a new / moved subscription is read now
    // INVALIDATE ALL FEED CACHES — sync may have just pulled fresh
    // data for Contacts/Cycle/Mood/Habits/Kanban; the 1s micro-cache
    // would otherwise serve stale reads on the immediate renderAll()
    contactsCache = { when: 0, data: {} };
    habitsCache = { when: 0, data: null };
    cycleCache = { when: 0, data: null };
    moodCache = { when: 0, data: null };
    kanbanCache = { when: 0, data: null };
    todoCache = { when: 0, data: null };
    fitCache = { when: 0, data: null };
    petCache = { when: 0, optOut: false, petData: null, logData: null };
    renderAll();
    renderDay();          // selDate-aware (guarded when null)
    // CA-9: no "Updated from sync" toast — a receipt on every pull
    // is noise, and the changed data is already on screen.
  }

  // Canonical dirty funnel (Part VII) — created BEFORE registration,
  // even when sync is absent (dirty becomes a safe no-op).
  var syncApi = (window.parent && window.parent.orosSync) || window.orosSync;
  window.__orosSyncApi = {
    dirty: function () {
      if (syncApi && typeof syncApi.markDirty === "function") syncApi.markDirty();
    }
  };

  try {
    if (syncApi && typeof syncApi.registerSlice === "function") {
      syncApi.registerSlice(
        "calendar",
        function () {     // getter: localStorage is the durable truth,
          // CA-7: always in the merge's canonical form (merge(get, get)
          // = get), so an unchanged device never re-uploads.
          try {
            return mergeCalendars(JSON.parse(localStorage.getItem(DATA_KEY)), null);
          } catch (e) {
            return mergeCalendars(state, null);
          }
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeCalendars
      );
    }
  } catch (e) {
    // Standalone load = normal. A real registration crash = loudly
    // visible in the console instead of a silently dead sync.
    console.warn("[Calendar] sync registration failed:", e);
  }

  // A deep link staged while the Calendar was closed (one-shot take).
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var bootTarget = window.parent.__orosTakeTarget("calendar");
      if (bootTarget) window.__orosOpenAt(bootTarget);
    }
  } catch (e) {}
})();