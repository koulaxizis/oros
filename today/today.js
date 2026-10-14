// ============================================================
// orOS Today — App logic (v1.0.0)
// The summary of the day, from every app that has something dated:
// late tasks, today's rows, the next 3 days, and a top line
// (weather, holidays, name days).
//   - builds NOTHING itself: window.parent.orosToday.build() (the
//     shell's today/host.js) gathers the apps' today.js providers;
//     this file only draws the answer
//   - read-only: a row opens its item in its own app; "Ask the
//     Assistant" only pre-fills the Assistant's box
//     (__orosOpenAt("assistant", { ask })): nothing is sent until the
//     user presses Send. The button shows only where the Assistant's
//     own permission for that app is not "never" (assistant/core.js
//     permFor; NEVER_APPS untouched)
//   - settings (on/off, start hour, apps, quiet morning reminders)
//     are the shell's synced slice "today", written through
//     orosToday.setSetting
//   - no synced storage of its own; open/closed groups live in
//     sessionStorage "oros-today-ui" (R10)
//   - widgets (wave 48, today/layout.js): which sections and widgets
//     show, in which order and size, is THIS device's choice:
//     localStorage "oros-today-layout", never synced. "Customise"
//     edits it: drag by the handle, or the up / down buttons on touch
//     and keyboard, size, remove, add, back to the standard layout
//   - text is set with textContent only; the only markup written is
//     the app's own static SVG icons and the shell's app icons
// Sections:
//   1. Constants, i18n, helpers
//   2. Drawing
//   3. Assistant button
//   4. Settings dialog
//   5. Keyboard (Contract Β) + palette
//   6. Wiring & boot
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("today.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 1. Constants, i18n, helpers ----------
  var UI_KEY = "oros-today-ui";
  function parentWin() {
    try { return (window.parent && window.parent !== window) ? window.parent : null; }
    catch (e) { return null; }
  }
  function appLang() {
    try {
      var p = parentWin();
      if (p && (p.orosLang === "el" || p.orosLang === "en")) return p.orosLang;
      return localStorage.getItem("oros-lang") === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var I18N = {
    en: {
      app: "Today", refresh: "Refresh", settings: "Settings", close: "Close",
      overdue: "Overdue", today: "Today", soon: "Coming up", tomorrow: "Tomorrow",
      late1: "1 day late", lateN: "{n} days late", allDay: "all day",
      more: "and {n} more in {app}",
      empty: "Nothing for today", emptySoon: "Nothing in the next days either.",
      emptyNext: "Have a look below at what is coming up.",
      off: "The daily summary is off. Turn it on in Settings (the gear button).",
      oldNote: "That notice was for {d}. Here is today.",
      noShell: "Open Today inside orOS to see your day.",
      ask: "Ask the Assistant about this", done: "Done (opens the app)", asked: "Opened in the Assistant. Nothing is sent until you press Send.",
      brief: "Briefing from the Assistant (sends today's summary to your AI service; you see the Ask first apps before)",
      "s.title": "Today settings",
      "s.on": "Daily summary", "s.onHint": "One notice a day when something is late or due today.",
      "s.hour": "From", "s.hourHint": "The notice comes on the first open of orOS after this time.",
      "s.absorb": "Quiet the morning reminders the summary covers",
      "s.absorbHint": "Plants, chores, pet care, garage, to-dos, quotes, name days, the Minimalism proposal and the weather briefing stay quiet once the summary has come. Reminders at a set time still ring.",
      "s.apps": "Apps in the summary", "s.sens": "sensitive",
      "s.sensHint": "Sensitive apps are off until you switch them on.",
      "s.none": "No app gives the summary anything yet.",
      "s.fail": "Could not save. Storage may be full.",
      custom: "Customise", editDone: "Done",
      "w.top": "At a glance", "w.overdue": "Overdue", "w.today": "Today", "w.soon": "Coming up",
      "w.clock": "Clock", "w.weather": "Weather", "w.water": "Water", "w.habits": "Habits",
      "w.events": "Upcoming events", "w.todos": "To-dos",
      "d.top": "Weather, name days, timers and other short lines",
      "d.overdue": "Tasks whose day has passed", "d.today": "What is due today",
      "d.soon": "The next three days", "d.clock": "The time and the date",
      "d.weather": "Today's weather line, in its own card", "d.water": "How much you've drunk today",
      "d.habits": "Habits still to do today", "d.events": "Calendar events of today and the next days",
      "d.todos": "To-Do tasks: late, today and the next days",
      "e.move": "Drag to move: {w}", "e.up": "Move up: {w}", "e.down": "Move down: {w}",
      "e.small": "Small", "e.wide": "Wide", "e.size": "Size of {w}: {s}. Change",
      "e.remove": "Remove {w}", "e.add": "Add a widget", "e.addOne": "Add {w}",
      "e.reset": "Back to the standard layout", "e.all": "Every widget is on the screen.",
      "e.hint": "Drag a widget by its handle, or use the arrows. The layout is kept on this device only.",
      "e.moved": "{w}: place {n} of {m}", "e.removed": "{w} removed", "e.added": "{w} added",
      noWidgets: "No widgets on the screen. Press Customise to add some.",
      "none.habits": "No habits left for today", "none.todos": "No to-dos due in the next days",
      "none.events": "No events in the next days",
      "none.weather": "Nothing from Weather yet. Open it to choose a place.",
      "none.water": "Nothing from Water yet. Open it to start counting."
    },
    el: {
      app: "Σήμερα", refresh: "Ανανέωση", settings: "Ρυθμίσεις", close: "Κλείσιμο",
      overdue: "Εκπρόθεσμα", today: "Σήμερα", soon: "Έρχονται", tomorrow: "Αύριο",
      late1: "1 μέρα καθυστέρηση", lateN: "{n} μέρες καθυστέρηση", allDay: "όλη μέρα",
      more: "και {n} ακόμα στο «{app}»",
      empty: "Τίποτα για σήμερα", emptySoon: "Ούτε τις επόμενες μέρες.",
      emptyNext: "Δες παρακάτω τι έρχεται.",
      off: "Η ημερήσια σύνοψη είναι κλειστή. Άνοιξέ τη από τις Ρυθμίσεις (το γρανάζι).",
      oldNote: "Η ειδοποίηση ήταν για τις {d}. Εδώ είναι το σήμερα.",
      noShell: "Άνοιξε το «Σήμερα» μέσα από το orOS για να δεις τη μέρα σου.",
      ask: "Ρώτα τον Βοηθό γι' αυτό", done: "Έγινε (ανοίγει την εφαρμογή)", asked: "Άνοιξε στον Βοηθό. Τίποτα δεν στέλνεται πριν πατήσεις Αποστολή.",
      brief: "Ενημέρωση ημέρας από τον Βοηθό (στέλνει τη σύνοψη της ημέρας στην υπηρεσία AI σου· τις εφαρμογές «Ρώτα πρώτα» τις βλέπεις πριν)",
      "s.title": "Ρυθμίσεις «Σήμερα»",
      "s.on": "Ημερήσια σύνοψη", "s.onHint": "Μία ειδοποίηση τη μέρα, όταν κάτι έχει καθυστερήσει ή λήγει σήμερα.",
      "s.hour": "Από", "s.hourHint": "Η ειδοποίηση έρχεται στο πρώτο άνοιγμα του orOS μετά από αυτή την ώρα.",
      "s.absorb": "Σίγαση των πρωινών υπενθυμίσεων που καλύπτει η σύνοψη",
      "s.absorbHint": "Φυτά, δουλειές, κατοικίδια, γκαράζ, εργασίες, προσφορές, γιορτές, η πρόταση του Μινιμαλισμού και ο πρωινός καιρός σωπαίνουν όταν έχει έρθει η σύνοψη. Οι υπενθυμίσεις με συγκεκριμένη ώρα χτυπούν κανονικά.",
      "s.apps": "Εφαρμογές στη σύνοψη", "s.sens": "ευαίσθητη",
      "s.sensHint": "Οι ευαίσθητες εφαρμογές είναι κλειστές μέχρι να τις ανοίξεις.",
      "s.none": "Καμία εφαρμογή δεν δίνει ακόμη κάτι στη σύνοψη.",
      "s.fail": "Δεν αποθηκεύτηκε. Ίσως είναι γεμάτος ο χώρος.",
      custom: "Προσαρμογή", editDone: "Τέλος",
      "w.top": "Με μια ματιά", "w.overdue": "Εκπρόθεσμα", "w.today": "Σήμερα", "w.soon": "Έρχονται",
      "w.clock": "Ρολόι", "w.weather": "Καιρός", "w.water": "Νερό", "w.habits": "Συνήθειες",
      "w.events": "Επόμενα γεγονότα", "w.todos": "Εργασίες",
      "d.top": "Καιρός, γιορτές, χρονόμετρα και άλλες σύντομες γραμμές",
      "d.overdue": "Εργασίες που πέρασε η μέρα τους", "d.today": "Ό,τι λήγει σήμερα",
      "d.soon": "Οι επόμενες τρεις μέρες", "d.clock": "Η ώρα και η ημερομηνία",
      "d.weather": "Η γραμμή του καιρού, σε δική της κάρτα", "d.water": "Πόσο νερό ήπιες σήμερα",
      "d.habits": "Συνήθειες που μένουν για σήμερα", "d.events": "Γεγονότα του Ημερολογίου, σήμερα και τις επόμενες μέρες",
      "d.todos": "Εργασίες: εκπρόθεσμες, σήμερα και τις επόμενες μέρες",
      "e.move": "Σύρε για μετακίνηση: {w}", "e.up": "Πάνω: {w}", "e.down": "Κάτω: {w}",
      "e.small": "Μικρό", "e.wide": "Φαρδύ", "e.size": "Μέγεθος ({w}): {s}. Αλλαγή",
      "e.remove": "Αφαίρεση: {w}", "e.add": "Προσθήκη γραφικού στοιχείου", "e.addOne": "Προσθήκη: {w}",
      "e.reset": "Επαναφορά της αρχικής διάταξης", "e.all": "Όλα τα γραφικά στοιχεία είναι ήδη στην οθόνη.",
      "e.hint": "Σύρε ένα στοιχείο από τη λαβή του ή χρησιμοποίησε τα βέλη. Η διάταξη μένει μόνο σε αυτή τη συσκευή.",
      "e.moved": "{w}: θέση {n} από {m}", "e.removed": "Αφαιρέθηκε: {w}", "e.added": "Προστέθηκε: {w}",
      noWidgets: "Δεν υπάρχουν γραφικά στοιχεία στην οθόνη. Πάτησε Προσαρμογή για να προσθέσεις.",
      "none.habits": "Δεν μένουν συνήθειες για σήμερα", "none.todos": "Καμία εργασία τις επόμενες μέρες",
      "none.events": "Κανένα γεγονός τις επόμενες μέρες",
      "none.weather": "Τίποτα από τον Καιρό ακόμη. Άνοιξέ τον για να διαλέξεις τόπο.",
      "none.water": "Τίποτα από το Νερό ακόμη. Άνοιξέ το για να αρχίσεις να μετράς."
    }
  };
  function t(k, vars) {
    var s = (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var SVG = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M13 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    dot: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
    handle: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    brief: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/><path d="M18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function host() { var p = parentWin(); try { return p && p.orosToday ? p.orosToday : null; } catch (e) { return null; } }
  function env() { var p = parentWin(); try { return p && p.orosTodayEnv ? p.orosTodayEnv : null; } catch (e) { return null; } }

  function dateLong(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return "";
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    try {
      return d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ymd; }
  }
  function dayName(ymd, today) {
    var A = parentWin() && parentWin().OrosTodayAgg;
    if (A && A.diff(today, ymd) === 1) return t("tomorrow");
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return ymd;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    try {
      return d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
    } catch (e) { return ymd; }
  }

  var ui = (function () {
    try { return JSON.parse(sessionStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
  })();
  function saveUi() { try { sessionStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  // Widget layout: this device only (never in the synced slice).
  var LAYOUT_KEY = "oros-today-layout";
  var L = window.OrosTodayLayout;
  var layout = (function () {
    try { var raw = localStorage.getItem(LAYOUT_KEY); return raw ? L.parse(raw) : L.defaults(); }
    catch (e) { return L.defaults(); }
  })();
  function setLayout(next) {
    layout = L.norm(next);
    try {
      if (L.isDefault(layout)) localStorage.removeItem(LAYOUT_KEY);
      else localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch (e) {}
  }
  var editing = false;

  var toastTimer = null;
  function toast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, 4000);
  }

  // ---------- 2. Drawing ----------
  var last = null, oldDay = "", seq = 0, assist = null;

  function refresh() {
    var H = host(), my = ++seq;
    if (!H) { renderNoShell(); return; }
    H.build().then(function (res) {
      if (my !== seq) return;
      last = res;
      assist = assistState(res);
      $("brief-btn").hidden = !canBrief();
      if (document.querySelector(".w.dragging")) return;     // the drop renders
      render();
    }, function () {});
  }

  function renderNoShell() {
    var main = $("main");
    main.textContent = "";
    main.appendChild(el("div", "empty", t("noShell")));
    $("set-btn").disabled = true;
    $("refresh-btn").disabled = true;
    $("edit-btn").disabled = true;
  }

  function appInfo(id) {
    var list = last ? last.apps : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, name: id, sensitive: false };
  }
  function iconFor(id) {
    var E = env(), s = "";
    try { s = E ? E.icon(id) : ""; } catch (e) {}
    var n = el("span", "ico");
    n.innerHTML = s || SVG.dot;          // the shell's own static icon, never data
    return n;
  }

  function render() {
    var res = last, main = $("main");
    if (!res) return;
    var keepScroll = main.scrollTop;
    main.textContent = "";
    $("date").textContent = dateLong(res.today);
    var H = host(), set = H ? H.settings() : null;
    if (oldDay && oldDay !== res.today) {
      main.appendChild(el("div", "note", t("oldNote", { d: dateLong(oldDay) })));
    }
    if (set && !set.on.v) main.appendChild(el("div", "note", t("off")));
    var on = L.ids(layout);
    var parts = L.distribute(res.groups, on);
    // "Nothing for today": nothing late or due today in any widget.
    var due = 0, soon = 0;
    on.forEach(function (id) {
      parts[id].forEach(function (p) { if (p.late || p.today) due += p.rows.length; else if (p.day) soon += p.rows.length; });
    });
    var emptyAt = on.indexOf("today") >= 0 ? "today" : on.indexOf("overdue") >= 0 ? "overdue" : "";
    var cols = el("div", editing ? "editing" : "");
    cols.id = "cols";
    layout.items.forEach(function (it, i) {
      var node = editing ? editCard(it, i) : widget(it, parts, res, !due && emptyAt === it.id, soon);
      if (node) cols.appendChild(node);
    });
    if (!layout.items.length) cols.appendChild(el("div", "empty wide", t("noWidgets")));
    main.appendChild(cols);
    if (editing) main.appendChild(addPanel());
    paintClocks();
    main.scrollTop = keepScroll;
  }

  function shellOf(it) {
    var w = L.WIDGETS[it.id];
    var box = el("section", "w w-" + it.id + " kind-" + w.kind + " size-" + it.size);
    box.setAttribute("data-id", it.id);
    return box;
  }
  // Parts → groups: a widget with several parts names each one (late,
  // today, a day); a single late or today part needs no name.
  function headParts(list) {
    var many = list.length > 1;
    return list.map(function (p) {
      var head = p.day ? dayName(p.day, last.today) : (many && p.late ? t("overdue") : (many && p.today ? t("today") : ""));
      return { head: head, rows: p.rows, more: p.more, late: !!p.late };
    });
  }
  function widget(it, parts, res, showEmpty, soonN) {
    var id = it.id, list = parts[id] || [];
    if (id === "top") return list.length ? topLines(list[0].rows, it) : null;
    if (id === "clock") return clockTile(it);
    if (id === "weather" || id === "water") return appTile(it, list.length ? list[0].rows : []);
    if (id === "overdue" || id === "today") {
      if (!list.length) {
        if (!showEmpty) return null;
        var e = shellOf(it);
        e.className += " empty-w";
        var box = el("div", "empty");
        box.appendChild(el("strong", "", t("empty")));
        box.appendChild(document.createTextNode(soonN ? t("emptyNext") : t("emptySoon")));
        e.appendChild(box);
        return e;
      }
      return group(it, t(id === "overdue" ? "overdue" : "today"), headParts(list), id === "overdue" ? "late" : "", res.today);
    }
    if (id === "soon") return list.length ? group(it, t("soon"), headParts(list), "", res.today) : null;
    // habits, events, todos: the card stays even when it has nothing
    return group(it, t("w." + id), headParts(list), "", res.today, t("none." + id));
  }

  function topLines(rows, it) {
    var box = shellOf(it);
    var top = el("ul", "top");
    rows.forEach(function (r) {
      var li = el("li");
      var b = el("button", "top-open");          // a top line opens its app too
      b.type = "button";
      b.appendChild(iconFor(r.app));
      b.appendChild(el("span", "txt", r.title + (r.text ? " · " + r.text : "")));
      b.addEventListener("click", function () {
        var H = host();
        if (H) H.open(r.app, r.target);
      });
      li.appendChild(b);
      top.appendChild(li);
    });
    box.appendChild(top);
    return box;
  }

  // Clock: hours and minutes; the wide one adds seconds and the full date.
  function clockTile(it) {
    var box = shellOf(it);
    box.className += " tile";
    box.appendChild(el("div", "tile-label", t("w.clock")));
    var tm = el("div", "clock-time");
    if (it.size === "wide") tm.setAttribute("data-sec", "1");
    box.appendChild(tm);
    var dt = el("div", "clock-date");
    if (it.size === "wide") dt.setAttribute("data-long", "1");
    box.appendChild(dt);
    return box;
  }
  var clockTimer = 0;
  function paintClocks() {
    var nodes = document.querySelectorAll(".clock-time");
    if (!nodes.length) { if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; } return; }
    var now = new Date(), loc = LANG === "el" ? "el-GR" : "en-GB";
    [].forEach.call(nodes, function (n) {
      var opts = { hour: "2-digit", minute: "2-digit", hour12: false };
      if (n.getAttribute("data-sec")) opts.second = "2-digit";
      var s;
      try { s = now.toLocaleTimeString(loc, opts); } catch (e) { s = now.toTimeString().slice(0, 5); }
      if (n.textContent !== s) n.textContent = s;
    });
    [].forEach.call(document.querySelectorAll(".clock-date"), function (n) {
      var o = n.getAttribute("data-long") ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
                                          : { weekday: "short", day: "numeric", month: "short" };
      var s;
      try { s = now.toLocaleDateString(loc, o); } catch (e) { s = ""; }
      if (n.textContent !== s) n.textContent = s;
    });
    if (!clockTimer) clockTimer = setInterval(paintClocks, 1000);
  }

  // Weather / Water: the app's own top line, larger; a tap opens it.
  function appTile(it, rows) {
    var app = L.WIDGETS[it.id].app;
    var box = shellOf(it);
    box.className += " tile";
    var b = el("button", "tile-open");
    b.type = "button";
    var lab = el("span", "tile-label");
    lab.appendChild(iconFor(app));
    lab.appendChild(document.createTextNode(t("w." + it.id)));
    b.appendChild(lab);
    if (rows.length) {
      rows.forEach(function (r) {
        b.appendChild(el("span", "tile-main", r.title));
        if (r.text) b.appendChild(el("span", "tile-sub", r.text));
      });
    } else {
      b.appendChild(el("span", "tile-sub", t("none." + it.id)));
    }
    b.addEventListener("click", function () {
      var H = host();
      if (!H) return;
      if (rows.length) H.open(rows[0].app, rows[0].target);
      else H.open(app);
    });
    box.appendChild(b);
    return box;
  }

  function group(it, title, parts, cls, today, none) {
    var id = it.id;
    var box = shellOf(it);
    box.className += " group" + (cls ? " " + cls : "");
    var n = 0;
    parts.forEach(function (p) { n += p.rows.length; });
    var open = ui[id] !== false;
    var head = el("button", "group-head");
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    var chev = el("span", "chev");
    chev.innerHTML = SVG.chev;
    head.appendChild(chev);
    head.appendChild(el("span", "", title));
    head.appendChild(el("span", "count", String(n)));
    box.appendChild(head);
    var body = el("div");
    body.hidden = !open;
    if (!parts.length && none) body.appendChild(el("div", "more", none));
    parts.forEach(function (p) {
      if (p.head) body.appendChild(el("div", "day-head", p.head));
      var ul = el("ul", "rows");
      p.rows.forEach(function (r) { ul.appendChild(rowEl(r, p.late, today)); });
      body.appendChild(ul);
      Object.keys(p.more || {}).forEach(function (app) {
        body.appendChild(el("div", "more", t("more", { n: p.more[app], app: appInfo(app).name })));
      });
    });
    box.appendChild(body);
    head.addEventListener("click", function () {
      var o = body.hidden;
      body.hidden = !o;
      head.setAttribute("aria-expanded", o ? "true" : "false");
      ui[id] = o;
      saveUi();
    });
    return box;
  }

  function rowEl(r, late, today) {
    var A = parentWin() && parentWin().OrosTodayAgg;
    var info = appInfo(r.app);
    var li = el("li", "row");
    var b = el("button", "open");
    b.type = "button";
    if (r.time) b.appendChild(el("span", "time", r.time));
    b.appendChild(iconFor(r.app));
    var tx = el("span", "txt");
    tx.appendChild(el("span", "r-title", r.title));
    var meta = el("span", "r-meta");
    if (late && r.due && A) {
      var n = A.diff(r.due, today);
      meta.appendChild(el("span", "late", n === 1 ? t("late1") : t("lateN", { n: n })));
      meta.appendChild(document.createTextNode(" · "));
    }
    meta.appendChild(document.createTextNode(info.name + (r.text ? " · " + r.text : "")));
    tx.appendChild(meta);
    b.appendChild(tx);
    b.addEventListener("click", function () {
      var H = host();
      if (H) H.open(r.app, r.target);
    });
    li.appendChild(b);
    if (r.done && r.kind === "task") {
      var dn = el("button", "ask done-btn");
      dn.type = "button";
      dn.innerHTML = SVG.check;
      dn.title = t("done");
      dn.setAttribute("aria-label", t("done") + ": " + r.title);
      dn.addEventListener("click", function () {
        var H = host();
        if (H && typeof H.done === "function") H.done(r.app, r.done);
      });
      li.appendChild(dn);
    }
    if (canAsk(info)) {
      var a = el("button", "ask");
      a.type = "button";
      a.innerHTML = SVG.ask;
      a.title = t("ask");
      a.setAttribute("aria-label", t("ask") + ": " + r.title);
      a.addEventListener("click", function () { askAssistant(r, info); });
      li.appendChild(a);
    }
    return li;
  }

  // ---------- 2b. Customise (wave 48) ----------
  function wName(id) { return t("w." + id); }
  function iconButton(cls, svg, label, onClick) {
    var b = el("button", "e-btn " + cls);
    b.type = "button";
    b.innerHTML = svg;                          // the app's own static icon
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function say(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }
  function focusLater(id, cls) {
    setTimeout(function () {
      var n = document.querySelector('.w[data-id="' + id + '"] .' + cls);
      if (!n || n.disabled) n = document.querySelector('.w[data-id="' + id + '"] .handle');
      if (n) n.focus();
    }, 0);
  }
  function editCard(it, i) {
    var w = L.WIDGETS[it.id], name = wName(it.id), count = layout.items.length;
    var box = shellOf(it);
    box.className += " edit-card";
    var bar = el("div", "e-bar");
    var h = iconButton("handle", SVG.handle, t("e.move", { w: name }), function () {});
    wireDrag(h, box);
    bar.appendChild(h);
    var txt = el("span", "e-name");
    txt.appendChild(el("strong", "", name));
    txt.appendChild(el("span", "e-desc", t("d." + it.id)));
    bar.appendChild(txt);
    var tools = el("span", "e-tools");
    var up = iconButton("up", SVG.up, t("e.up", { w: name }), function () {
      setLayout(L.moveId(layout, it.id, -1));
      render();
      say(t("e.moved", { w: name, n: i, m: count }));
      focusLater(it.id, "up");
    });
    up.disabled = i === 0;
    var dn = iconButton("down", SVG.down, t("e.down", { w: name }), function () {
      setLayout(L.moveId(layout, it.id, 1));
      render();
      say(t("e.moved", { w: name, n: i + 2, m: count }));
      focusLater(it.id, "down");
    });
    dn.disabled = i === count - 1;
    tools.appendChild(up);
    tools.appendChild(dn);
    if (w.sizes.length > 1) {
      var cur = t(it.size === "wide" ? "e.wide" : "e.small");
      var sz = el("button", "e-btn size", cur);
      sz.type = "button";
      sz.setAttribute("aria-label", t("e.size", { w: name, s: cur }));
      sz.addEventListener("click", function () {
        setLayout(L.setSize(layout, it.id, L.nextSize(it.id, it.size)));
        render();
        focusLater(it.id, "size");
      });
      tools.appendChild(sz);
    }
    tools.appendChild(iconButton("remove", SVG.x, t("e.remove", { w: name }), function () {
      setLayout(L.remove(layout, it.id));
      render();
      say(t("e.removed", { w: name }));
      var first = document.querySelector("#cols .handle, .add-panel button");
      if (first) first.focus();
    }));
    bar.appendChild(tools);
    box.appendChild(bar);
    return box;
  }
  function addPanel() {
    var box = el("section", "add-panel");
    box.appendChild(el("h2", "", t("e.add")));
    box.appendChild(el("p", "hint", t("e.hint")));
    var hid = L.hidden(layout);
    if (!hid.length) box.appendChild(el("p", "hint", t("e.all")));
    var ul = el("ul", "add-list");
    hid.forEach(function (id) {
      var li = el("li");
      var b = el("button", "add-btn");
      b.type = "button";
      var ic = el("span", "ico");
      ic.innerHTML = SVG.plus;                   // the app's own static icon
      b.appendChild(ic);
      var tx = el("span", "txt");
      tx.appendChild(el("strong", "", wName(id)));
      tx.appendChild(el("span", "e-desc", t("d." + id)));
      b.appendChild(tx);
      b.setAttribute("aria-label", t("e.addOne", { w: wName(id) }));
      b.addEventListener("click", function () {
        setLayout(L.add(layout, id));
        render();
        say(t("e.added", { w: wName(id) }));
        focusLater(id, "handle");
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var reset = el("button", "txt-btn", t("e.reset"));
    reset.type = "button";
    reset.disabled = L.isDefault(layout);
    reset.addEventListener("click", function () {
      setLayout(L.defaults());
      render();
    });
    box.appendChild(reset);
    return box;
  }
  // Drag by the handle (mouse, pen and touch: pointer events). The
  // card moves in the DOM as the pointer passes over the others; the
  // drop saves the order. The moves and the drop are followed on the
  // document (moving the card in the DOM would end a pointer capture).
  // The arrows do the same without dragging.
  function wireDrag(handle, box) {
    var drag = null;
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      drag.moved = true;
      var main = $("main"), mr = main.getBoundingClientRect();
      drag.dy = e.clientY < mr.top + 40 ? -12 : e.clientY > mr.bottom - 40 ? 12 : 0;
      var cols = $("cols"), over = document.elementFromPoint(e.clientX, e.clientY);
      var tgt = over && over.closest ? over.closest(".w") : null;
      if (!tgt || tgt === box || tgt.parentNode !== cols) return;
      var r = tgt.getBoundingClientRect();
      var midY = r.top + r.height / 2;
      var after = e.clientY > midY + r.height / 6 ||
                  (Math.abs(e.clientY - midY) <= r.height / 6 && e.clientX > r.left + r.width / 2);
      var ref = after ? tgt.nextSibling : tgt;
      if (ref !== box) cols.insertBefore(box, ref);
    }
    function onEnd(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var moved = drag.moved;
      clearInterval(drag.scroll);
      drag = null;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onEnd, true);
      document.removeEventListener("pointercancel", onEnd, true);
      box.classList.remove("dragging");
      if (!moved) return;
      var order = [].map.call(document.querySelectorAll("#cols > .w"), function (n) { return n.getAttribute("data-id"); });
      var id = box.getAttribute("data-id");
      setLayout(L.reorder(layout, order));
      render();
      var at = L.ids(layout).indexOf(id);
      say(t("e.moved", { w: wName(id), n: at + 1, m: layout.items.length }));
      focusLater(id, "handle");
    }
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      drag = { id: e.pointerId, moved: false, dy: 0, scroll: 0 };
      box.classList.add("dragging");
      var main = $("main");
      drag.scroll = setInterval(function () {
        if (drag && drag.dy) main.scrollTop += drag.dy;
      }, 30);
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onEnd, true);
      document.addEventListener("pointercancel", onEnd, true);
    });
  }
  function setEditing(on) {
    editing = !!on;
    var b = $("edit-btn");
    b.innerHTML = editing ? SVG.check : SVG.grid;
    var label = editing ? t("editDone") : t("custom");
    b.setAttribute("aria-label", label);
    b.title = label;
    b.setAttribute("aria-pressed", editing ? "true" : "false");
    b.classList.toggle("on", editing);
    if (last) render();
  }

  // ---------- 3. Assistant button ----------
  // Shown only when the Assistant is installed and set up, and its
  // permission for the row's app is "ask" or "always". "never" (the
  // default of a sensitive app) and "off" (NEVER_APPS: mail,
  // passwords) hide it.
  function assistState(res) {
    var C = window.OrosAssistCore, E = env();
    if (!C || !E) return null;
    var apps = [];
    try { apps = E.apps(); } catch (e) { return null; }
    var installed = apps.some(function (a) { return a.id === "assistant"; });
    if (!installed) return null;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem("oros-assistant-data")); } catch (e) {}
    var data = C.mergeAssist(raw, raw);
    if (!data.set || !data.set.prov) return null;          // not set up yet
    return { C: C, data: data, today: res.today };
  }
  function canAsk(info) {
    if (!assist) return false;
    var p = assist.C.permFor(assist.data, { id: info.id, sensitive: !!info.sensitive });
    return p === "ask" || p === "always";
  }
  // Briefing (Assistant phase 4 wave 5): the user's own tap opens the
  // Assistant with { brief: 1 }; the Assistant works out the summaries,
  // shows its card for "Ask first" apps and sends one message. Hidden
  // when the chosen AI can't read data (built-in model, Chat only).
  function canBrief() {
    if (!assist) return false;
    var pv = assist.C.PROVIDERS[assist.data.set.prov];
    return !!pv && !pv.builtin && !assist.data.set.chat;
  }
  function briefing() {
    var p = parentWin();
    if (!canBrief() || !p || typeof p.__orosOpenAt !== "function") return;
    p.__orosOpenAt("assistant", { brief: 1 });
  }
  function askAssistant(r, info) {
    var H = host(), p = parentWin();
    if (!H || !p || typeof p.__orosOpenAt !== "function") return;
    var text = H.askText(r, info.name, dateLong(assist ? assist.today : ""), LANG);
    p.__orosOpenAt("assistant", { ask: text });
    toast(t("asked"));
  }

  // ---------- 4. Settings dialog ----------
  function settingsDialog() {
    var H = host();
    if (!H) return;
    var body = $("set-body");
    body.textContent = "";
    var s = H.settings();
    function save(name, v, id) {
      if (!H.setSetting(name, v, id)) toast(t("s.fail"));
      refresh();
    }
    function check(label, hint, value, onChange) {
      var row = el("div", "set-row");
      var lab = el("label");
      var box = el("input");
      box.type = "checkbox";
      box.checked = !!value;
      var uid = "c" + Math.random().toString(36).slice(2, 8);
      box.id = uid;
      lab.htmlFor = uid;
      lab.appendChild(document.createTextNode(label));
      if (hint) lab.appendChild(el("span", "hint", hint));
      box.addEventListener("change", function () { onChange(box.checked); });
      row.appendChild(lab);
      row.appendChild(box);
      return row;
    }
    body.appendChild(check(t("s.on"), t("s.onHint"), s.on.v, function (v) { save("on", v); }));
    var hr = el("div", "set-row");
    var hl = el("label");
    hl.htmlFor = "set-hour";
    hl.appendChild(document.createTextNode(t("s.hour")));
    hl.appendChild(el("span", "hint", t("s.hourHint")));
    var sel = el("select");
    sel.id = "set-hour";
    for (var h = 0; h <= 12; h++) {
      var o = el("option", "", (h < 10 ? "0" : "") + h + ":00");
      o.value = String(h);
      if (h === s.hour.v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () { save("hour", +sel.value); });
    hr.appendChild(hl);
    hr.appendChild(sel);
    body.appendChild(hr);
    body.appendChild(check(t("s.absorb"), t("s.absorbHint"), s.absorb.v, function (v) { save("absorb", v); }));
    body.appendChild(el("div", "set-sub", t("s.apps")));
    var apps = last ? last.apps : [];
    if (!apps.length) body.appendChild(el("div", "set-row", t("s.none")));
    var anySens = false;
    apps.forEach(function (a) {
      if (a.sensitive) anySens = true;
      var row = check(a.name, "", a.on, function (v) { save("app", v, a.id); });
      if (a.sensitive) row.querySelector("label").insertBefore(el("span", "tag", t("s.sens")), row.querySelector("label").childNodes[1] || null);
      body.appendChild(row);
    });
    if (anySens) body.appendChild(el("div", "set-row hint", t("s.sensHint")));
    $("set-dlg").showModal();
  }

  // ---------- 5. Keyboard (Contract Β) + palette ----------
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

  // ---------- 6. Wiring & boot ----------
  // Deep link: { day: "YYYY-MM-DD" } from the daily notice. The tab is
  // always today, built afresh; an older notice gets a one-line note.
  function takeTarget(tg) {
    oldDay = tg && typeof tg.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tg.day) ? tg.day : "";
    refresh();
  }
  window.__orosOpenAt = takeTarget;

  function boot() {
    document.documentElement.lang = LANG;
    document.title = t("app") + " · orOS";
    $("title").textContent = t("app");
    function iconBtn(id, svg, label) {
      var b = $(id);
      b.innerHTML = svg;
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    iconBtn("brief-btn", SVG.brief, t("brief"));
    $("brief-btn").addEventListener("click", briefing);
    iconBtn("refresh-btn", SVG.refresh, t("refresh"));
    iconBtn("set-btn", SVG.gear, t("settings"));
    setEditing(false);
    $("set-title").textContent = t("s.title");
    $("set-close").textContent = t("close");
    $("refresh-btn").addEventListener("click", refresh);
    $("set-btn").addEventListener("click", settingsDialog);
    $("edit-btn").addEventListener("click", function () { setEditing(!editing); });
    inheritPalette();
    watchPalette();
    wireKeyboard();
    var tg = null, p = parentWin();
    try { if (p && typeof p.__orosTakeTarget === "function") tg = p.__orosTakeTarget("today"); } catch (e) {}
    var H = host();
    if (H) {
      var off = H.onChange(function () { if (!document.querySelector("dialog[open]")) refresh(); });
      window.addEventListener("pagehide", off);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    // A new day while the tab stays open.
    var A = p && p.OrosTodayAgg, lastDay = A ? A.ymdOf(new Date()) : "";
    setInterval(function () {
      if (!A) return;
      var d = A.ymdOf(new Date());
      if (d !== lastDay) { lastDay = d; oldDay = ""; refresh(); }
    }, 30000);
    takeTarget(tg);
  }

  boot();
})();
