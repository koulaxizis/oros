// ============================================================
// orOS Water — App logic (v1.0.0)
// Daily water intake: one tap per glass, a goal, a history.
//   - quick add (glass / bottle / any amount), Undo, edit, delete
//   - any past day can be filled in (‹ › in the toolbar)
//   - goal per day: a change applies from today on, past days keep
//     theirs; units glasses / ml / fl oz are display only
//   - history: streaks, averages, week bars, month heatmap
//   - reminders (off by default) run in the shell clock engine,
//     the app only stores the settings; "Show in Habits" feeds a
//     read-only row to the Habits app
// The model (normalize, merge, day maths, reminder rule, Habits
// feed) lives in core.js, shared with the shell and Habits.
// Data:
//   - synced slice "water" (oros-water-data), see core.js
//   - device-local (R10): oros-water-view (last celebration day)
// Sections:
//   1. i18n + helpers
//   2. Storage
//   3. Edits: add, undo, edit, delete, prefs, goal
//   4. Render: toolbar, glass, readout, quick add, entries
//   5. Render: history
//   6. Dialogs: amount, entry, settings
//   7. Toasts + celebration
//   8. Keyboard (Contract Β)
//   9. Sync slice + palette
//  10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.orosWaterCore;
  var STORAGE_KEY = C.STORAGE_KEY;
  var VIEW_KEY = "oros-water-view";

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
      "app": "Water", "today": "Today", "yesterday": "Yesterday",
      "prev": "Previous day", "next": "Next day", "settings": "Settings",
      "rem.on": "Reminders on", "rem.off": "Reminders off",
      "of": "of {goal}", "pct": "{p}%", "left": "{x} to go", "over": "{x} over", "done": "Goal reached",
      "add.glass": "+1 glass", "add.bottle": "+ Bottle", "add.other": "Other amount",
      "sec.sips": "Entries", "sips.empty": "Nothing yet. Tap the glass button when you drink.",
      "sips.count": "{n} entries", "sips.count1": "1 entry", "sip.edit": "Edit entry: {a} at {t}",
      "sec.stats": "Overview", "sec.week": "This week",
      "st.streak": "Day streak", "st.best": "Best streak", "st.avg": "Average (7 days)", "st.rate": "Days on goal",
      "st.none": "–",
      "m.prev": "Previous month", "m.next": "Next month",
      "leg.none": "None", "leg.some": "Under half", "leg.most": "Half or more", "leg.full": "Goal",
      "day.aria": "{d}: {a} of {g}",
      "dlg.amount": "Other amount", "dlg.ml": "Amount (ml)", "dlg.add": "Add", "dlg.cancel": "Cancel",
      "dlg.entry": "Edit entry", "dlg.time": "Time", "dlg.save": "Save", "dlg.del": "Delete",
      "dlg.settings": "Settings", "set.goal": "Daily goal (ml)", "set.goalNote": "A new goal counts from today; past days keep theirs.",
      "set.weight": "Your weight (kg)", "set.suggest": "Suggest",
      "set.weightNote": "About 33 ml per kg. A rough guide, not medical advice. Your weight is not stored.",
      "set.glass": "Glass (ml)", "set.bottle": "Bottle (ml)", "set.unit": "Show amounts in",
      "unit.glass": "Glasses", "unit.ml": "ml", "unit.oz": "fl oz",
      "set.rem": "Reminders", "set.remOn": "Remind me when I fall behind",
      "set.from": "From", "set.to": "Until", "set.every": "At most every",
      "set.remNote": "Reminders arrive only while orOS is open (in a tab or installed).",
      "every.n": "{n} min", "every.h": "{n} h",
      "set.habits": "Show in Habits", "set.habitsNote": "A read-only “Water” row, ticked on the days you reach your goal.",
      "set.export": "Export CSV", "set.data": "Data",
      "toast.added": "+{a}", "toast.undo": "Undo", "toast.deleted": "Entry deleted",
      "toast.saved": "Saved", "toast.save": "Could not save: storage is full",
      "toast.bad": "Enter {min}–{max} ml", "toast.badGoal": "The goal must be {min}–{max} ml",
      "toast.badTime": "“Until” must be after “From”", "toast.exported": "CSV exported",
      "toast.goal": "Goal reached! Well done.", "toast.remOn": "Reminders on", "toast.remOff": "Reminders off",
      "live.total": "{a} of {g}"
    },
    el: {
      "app": "Νερό", "today": "Σήμερα", "yesterday": "Χθες",
      "prev": "Προηγούμενη μέρα", "next": "Επόμενη μέρα", "settings": "Ρυθμίσεις",
      "rem.on": "Υπενθυμίσεις: ναι", "rem.off": "Υπενθυμίσεις: όχι",
      "of": "από {goal}", "pct": "{p}%", "left": "μένουν {x}", "over": "{x} παραπάνω", "done": "Ο στόχος επιτεύχθηκε",
      "add.glass": "+1 ποτήρι", "add.bottle": "+ Μπουκάλι", "add.other": "Άλλη ποσότητα",
      "sec.sips": "Καταγραφές", "sips.empty": "Τίποτα ακόμα. Πάτα το ποτήρι κάθε φορά που πίνεις.",
      "sips.count": "{n} καταγραφές", "sips.count1": "1 καταγραφή", "sip.edit": "Διόρθωση: {a} στις {t}",
      "sec.stats": "Σύνοψη", "sec.week": "Αυτή η εβδομάδα",
      "st.streak": "Μέρες σερί", "st.best": "Καλύτερο σερί", "st.avg": "Μέσος όρος (7 ημέρες)", "st.rate": "Μέρες με στόχο",
      "st.none": "–",
      "m.prev": "Προηγούμενος μήνας", "m.next": "Επόμενος μήνας",
      "leg.none": "Τίποτα", "leg.some": "Κάτω από το μισό", "leg.most": "Μισό ή παραπάνω", "leg.full": "Στόχος",
      "day.aria": "{d}: {a} από {g}",
      "dlg.amount": "Άλλη ποσότητα", "dlg.ml": "Ποσότητα (ml)", "dlg.add": "Προσθήκη", "dlg.cancel": "Άκυρο",
      "dlg.entry": "Διόρθωση καταγραφής", "dlg.time": "Ώρα", "dlg.save": "Αποθήκευση", "dlg.del": "Διαγραφή",
      "dlg.settings": "Ρυθμίσεις", "set.goal": "Ημερήσιος στόχος (ml)", "set.goalNote": "Ο νέος στόχος μετράει από σήμερα· οι παλιές μέρες κρατούν τον δικό τους.",
      "set.weight": "Το βάρος σου (kg)", "set.suggest": "Πρόταση",
      "set.weightNote": "Περίπου 33 ml ανά κιλό. Χοντρικός οδηγός, όχι ιατρική συμβουλή. Το βάρος δεν αποθηκεύεται.",
      "set.glass": "Ποτήρι (ml)", "set.bottle": "Μπουκάλι (ml)", "set.unit": "Εμφάνιση σε",
      "unit.glass": "Ποτήρια", "unit.ml": "ml", "unit.oz": "fl oz",
      "set.rem": "Υπενθυμίσεις", "set.remOn": "Θύμισέ μου όταν μένω πίσω",
      "set.from": "Από", "set.to": "Έως", "set.every": "Το πολύ κάθε",
      "set.remNote": "Οι υπενθυμίσεις έρχονται μόνο όσο το orOS είναι ανοιχτό (σε καρτέλα ή εγκατεστημένο).",
      "every.n": "{n} λεπτά", "every.h": "{n} ώρ.",
      "set.habits": "Εμφάνιση στις Συνήθειες", "set.habitsNote": "Μια γραμμή «Νερό» μόνο για ανάγνωση, τσεκαρισμένη τις μέρες που πιάνεις τον στόχο.",
      "set.export": "Εξαγωγή CSV", "set.data": "Δεδομένα",
      "toast.added": "+{a}", "toast.undo": "Αναίρεση", "toast.deleted": "Η καταγραφή διαγράφηκε",
      "toast.saved": "Αποθηκεύτηκε", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.bad": "Γράψε {min}–{max} ml", "toast.badGoal": "Ο στόχος πρέπει να είναι {min}–{max} ml",
      "toast.badTime": "Το «Έως» πρέπει να είναι μετά το «Από»", "toast.exported": "Έγινε εξαγωγή CSV",
      "toast.goal": "Έπιασες τον στόχο! Μπράβο.", "toast.remOn": "Υπενθυμίσεις ενεργές", "toast.remOff": "Υπενθυμίσεις ανενεργές",
      "live.total": "{a} από {g}"
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
  function fmtA(ml) { return C.fmtAmount(ml, data.prefs, LANG); }
  function numA(ml) { return C.amount(ml, data.prefs, LANG); }
  function mlText(ml) { return C.fmtNum(ml, LANG) + " ml"; }
  function hhmm(ts) { var d = new Date(ts); return C.fmtMinutes(d.getHours() * 60 + d.getMinutes()); }

  var UI = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    bell:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
    glass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14l-1.8 17.2a1 1 0 0 1-1 .8H7.8a1 1 0 0 1-1-.8z"/><path d="M5.6 9h12.8"/></svg>',
    bottle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3l1.6 2.4a3 3 0 0 1 .4 1.6V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9a3 3 0 0 1 .4-1.6L10 5z"/><path d="M8 12h8"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function newId() { return C.newId(); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("water.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage ----------
  var data = null, view = null;
  var dayKey = "";          // the day on screen
  var monthKey = "";        // any day of the month on the heatmap

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    data = C.parse(raw);
    if (data) return;
    try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    try { console.error("[orOS] water: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    view = { cel: (v && C.validDay(v.cel)) ? v.cel : "" };
  }
  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) {}
  }

  function todayKey() { return C.dayKey(new Date()); }
  function findSip(id) {
    for (var i = 0; i < data.sips.length; i++) if (data.sips[i].id === id) return data.sips[i];
    return null;
  }
  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }

  // ---------- 3. Edits ----------
  // A drink on the day on screen: now for today, the same clock time
  // on a past day (editable afterwards).
  function tsForDay(key) {
    var now = new Date();
    if (key === C.dayKey(now)) return now.getTime();
    var d = C.keyDate(key);
    d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return d.getTime();
  }

  function addSip(ml) {
    if (!C.inRange(ml, C.LIM.sip)) { showToast(t("toast.bad", { min: C.LIM.sip[0], max: C.LIM.sip[1] })); return; }
    var key = dayKey;
    var before = C.dayTotal(data, key);
    var id = newId();
    data.sips.push({ id: id, ts: tsForDay(key), ml: ml, m: Date.now() });
    saveNow();
    renderAll();
    pulse();
    var after = C.dayTotal(data, key), goal = C.goalFor(data, key);
    live(t("live.total", { a: fmtA(after), g: fmtA(goal) }));
    if (before < goal && after >= goal && key === todayKey() && view.cel !== key) {
      view.cel = key;
      saveView();
      celebrate();
      undoToast(t("toast.goal"), function () { removeSip(id, true); });
      return;
    }
    undoToast(t("toast.added", { a: fmtA(ml) }), function () { removeSip(id, true); });
  }

  // Undo of an add, or a delete from the entry dialog: a tombstone
  // with a fresh stamp (R17), and a way back for the delete.
  function removeSip(id, silent) {
    var s = findSip(id);
    if (!s || s.del) return;
    var snap = { id: s.id, ts: s.ts, ml: s.ml, m: s.m };
    s.del = 1;
    s.m = stamp(s.m);
    delete s.ts; delete s.ml;
    saveNow();
    renderAll();
    if (silent) return;
    undoToast(t("toast.deleted"), function () {
      var cur = findSip(id);
      snap.m = stamp(cur ? cur.m : snap.m);
      data.sips = data.sips.filter(function (x) { return x.id !== id; });
      data.sips.push(snap);
      saveNow();
      renderAll();
    });
  }

  function editSip(id, ml, ts) {
    var s = findSip(id);
    if (!s || s.del) return;
    if (s.ml === ml && s.ts === ts) return;
    s.ml = ml;
    s.ts = ts;
    s.m = stamp(s.m);
    saveNow();
    renderAll();
  }

  function setPrefs(next) {
    var p = C.normPrefs(next);
    if (JSON.stringify(p) === JSON.stringify(data.prefs)) return;
    data.prefs = p;
    data.pm = stamp(data.pm);
    saveNow();
  }

  function setGoal(ml) {
    var key = todayKey();
    if (C.goalFor(data, key) === ml) return;
    C.setGoal(data, key, ml, Date.now());
    saveNow();
  }

  function toggleReminders() {
    var p = JSON.parse(JSON.stringify(data.prefs));
    p.rem.on = p.rem.on ? 0 : 1;
    setPrefs(p);
    renderToolbar();
    showToast(t(p.rem.on ? "toast.remOn" : "toast.remOff"));
  }

  // ---------- 4. Render: day ----------
  function dayLabel(key) {
    var tk = todayKey();
    if (key === tk) return t("today");
    if (key === C.addDays(tk, -1)) return t("yesterday");
    try {
      return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" })
        .format(C.keyDate(key));
    } catch (e) { return key; }
  }

  function renderToolbar() {
    $("day-btn").textContent = dayLabel(dayKey);
    $("day-btn").classList.toggle("is-today", dayKey === todayKey());
    $("next-btn").disabled = dayKey >= todayKey();
    var on = !!data.prefs.rem.on, rb = $("rem-btn");
    rb.innerHTML = (on ? UI.bell : UI.bellOff) + "<span></span>";
    rb.lastChild.textContent = t(on ? "rem.on" : "rem.off");
    rb.setAttribute("aria-pressed", on ? "true" : "false");
    rb.classList.toggle("on", on);
  }

  // The glass: a tapered outline, water clipped inside it.
  var GLASS_PATH = "M14 10 H106 L94 150 a6 6 0 0 1 -6 5 H32 a6 6 0 0 1 -6 -5 Z";
  function buildGlass() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 160");
    svg.innerHTML =
      '<defs><clipPath id="g-clip"><path d="' + GLASS_PATH + '"/></clipPath></defs>' +
      '<path class="g-back" d="' + GLASS_PATH + '"/>' +
      '<g clip-path="url(#g-clip)"><g id="g-water">' +
        '<path class="g-wave" d="M-120 6 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V200 H-120 Z"/>' +
      "</g></g>" +
      '<path class="g-line" d="' + GLASS_PATH + '"/>' +
      '<path class="g-shine" d="M24 22 L33 140"/>';
    $("glass-box").appendChild(svg);
  }
  function renderGlass(frac) {
    var f = Math.max(0, Math.min(1, frac));
    // water surface from y=155 (empty) to y=10 (full)
    var y = 155 - f * 145;
    var g = document.getElementById("g-water");
    if (g) g.setAttribute("transform", "translate(0 " + (f > 0 ? y - 6 : 170).toFixed(1) + ")");
  }

  function renderReadout() {
    var total = C.dayTotal(data, dayKey), goal = C.goalFor(data, dayKey);
    var frac = goal ? total / goal : 0;
    renderGlass(frac);
    $("amt-big").textContent = numA(total);
    $("amt-goal").textContent = t("of", { goal: fmtA(goal) });
    $("pct").textContent = t("pct", { p: Math.round(frac * 100) });
    var left = $("left");
    if (total < goal) left.textContent = t("left", { x: fmtA(goal - total) });
    else if (total > goal) left.textContent = t("over", { x: fmtA(total - goal) });
    else left.textContent = t("done");
    $("day").classList.toggle("met", total >= goal);
  }

  function renderQuick() {
    var p = data.prefs;
    function fill(btn, icon, label, ml) {
      btn.innerHTML = icon + "<span class=\"ab-l\"></span><span class=\"ab-s\"></span>";
      btn.querySelector(".ab-l").textContent = label;
      btn.querySelector(".ab-s").textContent = p.unit === "oz" ? fmtA(ml) : mlText(ml);
    }
    fill($("add-glass"), UI.glass, t("add.glass"), p.glass);
    fill($("add-bottle"), UI.bottle, t("add.bottle"), p.bottle);
    var o = $("add-other");
    o.innerHTML = UI.plus + "<span class=\"ab-l\"></span>";
    o.querySelector(".ab-l").textContent = t("add.other");
  }

  function renderSips() {
    var host = $("sips"), list = C.daySips(data, dayKey).reverse();
    host.innerHTML = "";
    list.forEach(function (s) {
      var li = el("li");
      var b = el("button", "sip");
      b.type = "button";
      b.appendChild(el("time", "s-t", hhmm(s.ts)));
      var bar = el("span", "s-bar");
      bar.style.setProperty("--w", Math.min(100, Math.round(s.ml / C.goalFor(data, dayKey) * 100 * 2.5)) + "%");
      b.appendChild(bar);
      b.appendChild(el("span", "s-a", fmtA(s.ml)));
      b.setAttribute("aria-label", t("sip.edit", { a: fmtA(s.ml), t: hhmm(s.ts) }));
      b.addEventListener("click", function () { entryDialog(s.id); });
      li.appendChild(b);
      host.appendChild(li);
    });
    $("sips-empty").hidden = list.length > 0;
    $("sip-count").textContent = list.length ? (list.length === 1 ? t("sips.count1") : t("sips.count", { n: list.length })) : "";
  }

  // ---------- 5. Render: history ----------
  function statCard(num, lbl) {
    var c = el("div", "stat");
    c.appendChild(el("div", "stat-n", num));
    c.appendChild(el("div", "stat-l", lbl));
    return c;
  }
  function renderStats() {
    var tk = todayKey(), host = $("stats");
    var st = C.streaks(data, tk), avg = C.average(data, tk, 7), rate = C.goalRate(data, tk);
    host.innerHTML = "";
    host.appendChild(statCard(C.fmtNum(st.current, LANG), t("st.streak")));
    host.appendChild(statCard(C.fmtNum(st.longest, LANG), t("st.best")));
    host.appendChild(statCard(avg === null ? t("st.none") : fmtA(avg), t("st.avg")));
    host.appendChild(statCard(rate === null ? t("st.none") : rate + "%", t("st.rate")));
  }

  function weekStartKey(key) {
    var d = C.keyDate(key), wd = (d.getDay() + 6) % 7;   // Monday-first
    return C.addDays(key, -wd);
  }
  function level(total, goal) {
    if (!total) return 0;
    if (total >= goal) return 3;
    return total * 2 >= goal ? 2 : 1;
  }

  function renderWeek() {
    var host = $("week"), tk = todayKey(), t0 = weekStartKey(dayKey);
    var tot = C.totals(data), days = [], max = 0;
    for (var i = 0; i < 7; i++) {
      var k = C.addDays(t0, i), g = C.goalFor(data, k);
      days.push({ k: k, v: tot[k] || 0, g: g });
      max = Math.max(max, tot[k] || 0, g);
    }
    host.innerHTML = "";
    days.forEach(function (d) {
      var b = el("button", "bar");
      b.type = "button";
      var future = d.k > tk;
      b.disabled = future;
      if (d.k === dayKey) b.classList.add("sel");
      if (d.k === tk) b.classList.add("today");
      b.classList.add("lv" + level(d.v, d.g));
      var track = el("span", "b-track");
      var fill = el("span", "b-fill");
      fill.style.height = (max ? Math.round(d.v / max * 100) : 0) + "%";
      var goal = el("span", "b-goal");
      goal.style.bottom = (max ? Math.round(d.g / max * 100) : 0) + "%";
      track.appendChild(fill);
      track.appendChild(goal);
      b.appendChild(track);
      var dn = "";
      try { dn = new Intl.DateTimeFormat(locale(), { weekday: "narrow" }).format(C.keyDate(d.k)); } catch (e) {}
      b.appendChild(el("span", "b-d", dn));
      b.setAttribute("aria-label", t("day.aria", { d: dayLabel(d.k), a: fmtA(d.v), g: fmtA(d.g) }));
      b.title = b.getAttribute("aria-label");
      if (!future) b.addEventListener("click", function () { goDay(d.k); });
      host.appendChild(b);
    });
  }

  function renderMonth() {
    var host = $("month"), tk = todayKey();
    var md = C.keyDate(monthKey);
    md.setDate(1);
    var first = C.dayKey(md);
    try {
      $("month-label").textContent = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(md);
    } catch (e) { $("month-label").textContent = first.slice(0, 7); }
    $("mnext-btn").disabled = first.slice(0, 7) >= tk.slice(0, 7);
    var tot = C.totals(data);
    host.innerHTML = "";
    // weekday heads, Monday-first
    var mon = C.keyDate(weekStartKey(tk));
    for (var h = 0; h < 7; h++) {
      var hd = new Date(mon); hd.setDate(mon.getDate() + h);
      var name = "";
      try { name = new Intl.DateTimeFormat(locale(), { weekday: "narrow" }).format(hd); } catch (e) {}
      host.appendChild(el("span", "h-head", name));
    }
    var lead = (md.getDay() + 6) % 7;
    for (var p = 0; p < lead; p++) host.appendChild(el("span", "h-pad"));
    for (var k = first; k.slice(0, 7) === first.slice(0, 7); k = C.addDays(k, 1)) {
      (function (key) {
        var v = tot[key] || 0, g = C.goalFor(data, key);
        var c = el("button", "cell lv" + level(v, g), String(+key.slice(8)));
        c.type = "button";
        if (key > tk) { c.disabled = true; c.classList.add("future"); }
        if (key === tk) c.classList.add("today");
        if (key === dayKey) c.classList.add("sel");
        c.setAttribute("aria-label", t("day.aria", { d: dayLabel(key), a: fmtA(v), g: fmtA(g) }));
        c.title = c.getAttribute("aria-label");
        if (key <= tk) c.addEventListener("click", function () { goDay(key); });
        host.appendChild(c);
      })(k);
    }
  }

  function renderLegend() {
    var host = $("legend");
    host.innerHTML = "";
    ["none", "some", "most", "full"].forEach(function (n, i) {
      var s = el("span", "lg");
      s.appendChild(el("i", "lv" + i));
      s.appendChild(el("span", "", t("leg." + n)));
      host.appendChild(s);
    });
  }

  function renderAll() {
    var tk = todayKey();
    if (dayKey > tk) dayKey = tk;     // midnight passed while open
    renderToolbar();
    renderReadout();
    renderQuick();
    renderSips();
    renderStats();
    renderWeek();
    renderMonth();
  }

  function goDay(key) {
    var tk = todayKey();
    if (key > tk) key = tk;
    dayKey = key;
    monthKey = key;
    renderAll();
  }
  function shiftDay(n) { goDay(C.addDays(dayKey, n)); }
  function shiftMonth(n) {
    var d = C.keyDate(monthKey);
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    monthKey = C.dayKey(d);
    renderMonth();
  }

  // ---------- 6. Dialogs ----------
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
    if (!input.id) input.id = "f-" + newId();
    lab.setAttribute("for", input.id);
    w.appendChild(lab);
    w.appendChild(input);
    if (note) w.appendChild(el("p", "hint", note));
    return w;
  }
  function numInput(value, lim) {
    var i = el("input");
    i.type = "number";
    i.inputMode = "numeric";
    i.min = lim[0];
    i.max = lim[1];
    i.step = 1;
    i.value = value === null || value === undefined ? "" : String(value);
    return i;
  }
  function readInt(input) {
    var v = String(input.value).trim();
    if (!/^\d+$/.test(v)) return NaN;
    return parseInt(v, 10);
  }
  function timeInput(min) {
    var i = el("input");
    i.type = "time";
    i.value = C.fmtMinutes(min);
    return i;
  }
  function readTime(input) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(input.value));
    if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
    return +m[1] * 60 + +m[2];
  }
  function openDialog(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) { focus.focus(); if (focus.select) try { focus.select(); } catch (e) {} }
  }

  function amountDialog() {
    var dlg = makeDialog("wt-amount", t("dlg.amount"));
    var form = el("form");
    form.method = "dialog";
    var inp = numInput("", C.LIM.sip);
    inp.placeholder = "330";
    form.appendChild(field(t("dlg.ml"), inp));
    var chips = el("div", "chips");
    [100, 150, 200, 330, 750, 1000].forEach(function (ml) {
      var c = el("button", "chip", mlText(ml));
      c.type = "button";
      c.addEventListener("click", function () { dlg.close(); addSip(ml); });
      chips.appendChild(c);
    });
    form.appendChild(chips);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.add"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ml = readInt(inp);
      if (!C.inRange(ml, C.LIM.sip)) {
        showToast(t("toast.bad", { min: C.LIM.sip[0], max: C.LIM.sip[1] }));
        inp.focus();
        return;
      }
      dlg.close();
      addSip(ml);
    });
    dlg.appendChild(form);
    openDialog(dlg, inp);
  }

  function entryDialog(id) {
    var s = findSip(id);
    if (!s || s.del) return;
    var dlg = makeDialog("wt-entry", t("dlg.entry"));
    dlg.appendChild(el("div", "dlg-sub", dayLabel(C.dayKeyOf(s.ts))));
    var form = el("form");
    form.method = "dialog";
    var ml = numInput(s.ml, C.LIM.sip);
    var d0 = new Date(s.ts);
    var tm = timeInput(d0.getHours() * 60 + d0.getMinutes());
    var row = el("div", "fld-row");
    row.appendChild(field(t("dlg.ml"), ml));
    row.appendChild(field(t("dlg.time"), tm));
    form.appendChild(row);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.del"), "danger", function () { dlg.close(); removeSip(id, false); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = readInt(ml), mins = readTime(tm);
      if (!C.inRange(v, C.LIM.sip)) {
        showToast(t("toast.bad", { min: C.LIM.sip[0], max: C.LIM.sip[1] }));
        ml.focus();
        return;
      }
      var cur = findSip(id);
      if (!cur || cur.del) { dlg.close(); return; }     // deleted elsewhere meanwhile
      var d = new Date(cur.ts);
      if (!isNaN(mins)) d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      dlg.close();
      editSip(id, v, d.getTime());
    });
    dlg.appendChild(form);
    openDialog(dlg, ml);
  }

  function checkRow(labelText, checked) {
    var lab = el("label", "check");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!checked;
    lab.appendChild(box);
    lab.appendChild(el("span", "", labelText));
    return { row: lab, box: box };
  }

  function settingsDialog() {
    var p = data.prefs;
    var dlg = makeDialog("wt-settings", t("dlg.settings"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";

    // goal + weight helper
    var goal = numInput(C.goalFor(data, todayKey()), C.LIM.goal);
    form.appendChild(field(t("set.goal"), goal, t("set.goalNote")));
    var wRow = el("div", "fld-row tight");
    var kg = numInput("", [20, 300]);
    kg.placeholder = "70";
    wRow.appendChild(field(t("set.weight"), kg));
    var sug = button(t("set.suggest"), "", function () {
      var v = readInt(kg);
      if (!C.inRange(v, [20, 300])) { kg.focus(); return; }
      var g = Math.round(v * 33 / 50) * 50;
      goal.value = String(Math.max(C.LIM.goal[0], Math.min(C.LIM.goal[1], g)));
    });
    sug.classList.add("inline");
    wRow.appendChild(sug);
    form.appendChild(wRow);
    form.appendChild(el("p", "hint", t("set.weightNote")));

    // sizes + unit
    var sizes = el("div", "fld-row");
    var glass = numInput(p.glass, C.LIM.glass), bottle = numInput(p.bottle, C.LIM.bottle);
    sizes.appendChild(field(t("set.glass"), glass));
    sizes.appendChild(field(t("set.bottle"), bottle));
    form.appendChild(sizes);
    var unit = el("select");
    [["glass", "unit.glass"], ["ml", "unit.ml"], ["oz", "unit.oz"]].forEach(function (u) {
      var o = el("option", "", t(u[1]));
      o.value = u[0];
      if (p.unit === u[0]) o.selected = true;
      unit.appendChild(o);
    });
    form.appendChild(field(t("set.unit"), unit));

    // reminders
    form.appendChild(el("h3", "dlg-h", t("set.rem")));
    var remOn = checkRow(t("set.remOn"), p.rem.on);
    form.appendChild(remOn.row);
    var win = el("div", "fld-row");
    var from = timeInput(p.rem.from), to = timeInput(p.rem.to);
    win.appendChild(field(t("set.from"), from));
    win.appendChild(field(t("set.to"), to));
    form.appendChild(win);
    var every = el("select");
    [30, 45, 60, 90, 120, 180, 240].forEach(function (n) {
      var o = el("option", "", n < 60 || n % 60 ? t("every.n", { n: n }) : t("every.h", { n: n / 60 }));
      o.value = String(n);
      if (p.rem.every === n) o.selected = true;
      every.appendChild(o);
    });
    if (every.selectedIndex < 0 || +every.value !== p.rem.every) {
      var cur = el("option", "", t("every.n", { n: p.rem.every }));
      cur.value = String(p.rem.every);
      cur.selected = true;
      every.appendChild(cur);
    }
    form.appendChild(field(t("set.every"), every, t("set.remNote")));

    // habits + data
    form.appendChild(el("h3", "dlg-h", t("set.data")));
    var hab = checkRow(t("set.habits"), p.habits);
    form.appendChild(hab.row);
    form.appendChild(el("p", "hint", t("set.habitsNote")));
    var exp = button(t("set.export"), "", exportCsv);
    exp.classList.add("block");
    form.appendChild(exp);

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var g = readInt(goal), gl = readInt(glass), bt = readInt(bottle);
      var f = readTime(from), u = readTime(to);
      if (!C.inRange(g, C.LIM.goal)) {
        showToast(t("toast.badGoal", { min: C.LIM.goal[0], max: C.LIM.goal[1] }));
        goal.focus();
        return;
      }
      if (!C.inRange(gl, C.LIM.glass)) {
        showToast(t("toast.bad", { min: C.LIM.glass[0], max: C.LIM.glass[1] }));
        glass.focus();
        return;
      }
      if (!C.inRange(bt, C.LIM.bottle)) {
        showToast(t("toast.bad", { min: C.LIM.bottle[0], max: C.LIM.bottle[1] }));
        bottle.focus();
        return;
      }
      if (isNaN(f) || isNaN(u) || u <= f) { showToast(t("toast.badTime")); to.focus(); return; }
      setPrefs({
        glass: gl, bottle: bt, unit: unit.value,
        rem: { on: remOn.box.checked ? 1 : 0, from: f, to: u, every: +every.value },
        habits: hab.box.checked ? 1 : 0
      });
      setGoal(g);
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
  function exportCsv() {
    var text = C.toCsv(data);
    var name = "oros-water-" + todayKey() + ".csv";
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      host.saveFile({
        text: text, filename: name, mime: "text/csv",
        types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }]
      }).then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }

  // ---------- 7. Toasts + celebration ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "water", title: String(text) })) return;
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

  function pulse() {
    var b = $("glass-box");
    b.classList.remove("pulse");
    void b.offsetWidth;
    b.classList.add("pulse");
  }
  function celebrate() {
    var d = $("day");
    d.classList.remove("party");
    void d.offsetWidth;
    d.classList.add("party");
    setTimeout(function () { d.classList.remove("party"); }, 2400);
  }

  // ---------- 8. Keyboard ----------
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
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); addSip(data.prefs.glass); }
      else if (e.key === "ArrowLeft" && tag !== "BUTTON") { e.preventDefault(); shiftDay(-1); }
      else if (e.key === "ArrowRight" && tag !== "BUTTON") { e.preventDefault(); shiftDay(1); }
    });
  }

  // ---------- 9. Sync slice + palette ----------
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
    api.registerSlice("water", sliceGet, sliceSet, STORAGE_KEY, C.mergeWater);
  }

  function sliceGet() {
    return C.normalize(data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.sips)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeWater(data, incoming);   // local edits are already on disk; the merge keeps them
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    if (!document.querySelector("dialog[open]")) renderAll();
    else { renderToolbar(); renderReadout(); renderSips(); renderStats(); renderWeek(); renderMonth(); }
  }

  // ---------- 10. Wiring & boot ----------
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
    iconBtn("next-btn", UI.right, t("next"));
    iconBtn("set-btn", UI.gear, t("settings"));
    iconBtn("mprev-btn", UI.left, t("m.prev"));
    iconBtn("mnext-btn", UI.right, t("m.next"));
    $("day-btn").title = t("today");
  }

  function wire() {
    $("prev-btn").addEventListener("click", function () { shiftDay(-1); });
    $("next-btn").addEventListener("click", function () { shiftDay(1); });
    $("day-btn").addEventListener("click", function () { goDay(todayKey()); });
    $("rem-btn").addEventListener("click", toggleReminders);
    $("set-btn").addEventListener("click", settingsDialog);
    $("add-glass").addEventListener("click", function () { addSip(data.prefs.glass); });
    $("add-bottle").addEventListener("click", function () { addSip(data.prefs.bottle); });
    $("add-other").addEventListener("click", amountDialog);
    $("mprev-btn").addEventListener("click", function () { shiftMonth(-1); });
    $("mnext-btn").addEventListener("click", function () { shiftMonth(1); });
    // A new day while the app stays open: follow it if we were on "today".
    var lastToday = todayKey();
    setInterval(function () {
      var tk = todayKey();
      if (tk === lastToday) return;
      if (dayKey === lastToday) { dayKey = tk; monthKey = tk; }
      lastToday = tk;
      renderAll();
    }, 30000);
    wireKeyboard();
  }

  function boot() {
    load();
    loadView();
    dayKey = monthKey = todayKey();
    applyI18n();
    buildGlass();
    renderLegend();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
  }

  boot();
})();
