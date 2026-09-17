// ============================================================
// orOS Calendar v0.2.0
// Monthly grid (Monday-first), day selection, event CRUD,
// labels (color-coded, filterable), start/end times, location.
// Data: localStorage "oros-calendar-data"
//   { ver: 1,
//     labels:  [ { id, name, color, mtime } ],
//     events:  [ { id, date: "YYYY-MM-DD",
//                  start: "HH:MM" | null, end: "HH:MM" | null,
//                  title, note, location,
//                  labelId: string | null, mtime } ],
//     deleted: [ { id, mtime } ] }
// v0.1 legacy "time" → "start" at load (zero-loss migration).
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
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "cal.today": "Today",
      "cal.prev": "Previous month",
      "cal.next": "Next month",
      "cal.filters.lbl": "Labels",
      "wd": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      "months": ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"],
      "day.today": "Today",
      "ev.add": "Add",
      "ev.dlg.new": "New event",
      "ev.dlg.edit": "Edit event",
      "ev.field.title": "Title",
      "ev.ph.title": "What's happening?",
      "ev.field.when": "Time",
      "ev.start": "Starts",
      "ev.end": "Ends",
      "ev.end.none": "No end",
      "ev.allday": "All day",
      "ev.field.loc": "Location",
      "ev.ph.loc": "Where?",
      "ev.field.note": "Note",
      "ev.ph.note": "Details…",
      "ev.save": "Save",
      "ev.cancel": "Cancel",
      "ev.delete": "Delete event",
      "ev.delete.confirm": "Delete this event?",
      "ev.none": "No events",
      "ev.untitled": "(untitled)",
      "ev.alltime": "All day",
      "ev.err.title": "Enter a title first",
      "ev.err.time": "End time must be after start time",
      "ev.del.yes": "Delete",
      "del.done": "Event deleted",
      "undo": "Undo",
      "sync.merged": "Updated from sync",
      "lbl.personal": "Personal",
      "lbl.work": "Work",
      "lbl.family": "Family",
      "lbl.manage": "Manage labels",
      "lbl.new": "New label",
      "lbl.name": "Label name",
      "lbl.ph.name": "Name…",
      "lbl.done": "Done",
      "lbl.delete": "Delete",
      "lbl.inuse": "This label is used by events",
      "lbl.none": "No label"
    },
    el: {
      "cal.today": "Σήμερα",
      "cal.prev": "Προηγούμενος μήνας",
      "cal.next": "Επόμενος μήνας",
      "cal.filters.lbl": "Ετικέτες",
      "wd": ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"],
      "months": ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος",
                 "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος",
                 "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"],
      "day.today": "Σήμερα",
      "ev.add": "Προσθήκη",
      "ev.dlg.new": "Νέο συμβάν",
      "ev.dlg.edit": "Επεξεργασία συμβάντος",
      "ev.field.title": "Τίτλος",
      "ev.ph.title": "Τι συμβαίνει;",
      "ev.field.when": "Ώρα",
      "ev.start": "Έναρξη",
      "ev.end": "Λήξη",
      "ev.end.none": "Χωρίς λήξη",
      "ev.allday": "Όλη μέρα",
      "ev.field.loc": "Τοποθεσία",
      "ev.ph.loc": "Πού;",
      "ev.field.note": "Σημείωση",
      "ev.ph.note": "Λεπτομέρειες…",
      "ev.save": "Αποθήκευση",
      "ev.cancel": "Άκυρο",
      "ev.delete": "Διαγραφή συμβάντος",
      "ev.delete.confirm": "Να διαγραφεί αυτό το συμβάν;",
      "ev.none": "Κανένα συμβάν",
      "ev.untitled": "(χωρίς τίτλο)",
      "ev.alltime": "Όλη μέρα",
      "ev.err.title": "Δώσε πρώτα έναν τίτλο",
      "ev.err.time": "Η ώρα λήξης πρέπει να είναι μετά την έναρξη",
      "ev.del.yes": "Διαγραφή",
      "del.done": "Το συμβάν διαγράφηκε",
      "undo": "Αναίρεση",
      "sync.merged": "Ενημερώθηκε από συγχρονισμό",
      "lbl.personal": "Προσωπικό",
      "lbl.work": "Εργασία",
      "lbl.family": "Οικογένεια",
      "lbl.manage": "Διαχείριση ετικετών",
      "lbl.new": "Νέα ετικέτα",
      "lbl.name": "Όνομα ετικέτας",
      "lbl.ph.name": "Όνομα…",
      "lbl.done": "Τέλος",
      "lbl.delete": "Διαγραφή",
      "lbl.inuse": "Η ετικέτα χρησιμοποιείται από συμβάντα",
      "lbl.none": "Χωρίς ετικέτα"
    }
  };
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
    toastTimer = setTimeout(hideToast, 5000);
  }

  /* ---------- 2. State ---------- */
  var DATA_KEY = "oros-calendar-data";
  var state = { ver: 1, labels: [], events: [], deleted: [] };

  // Fixed label palette — deterministic across devices (stored
  // verbatim inside the synced blob; theme-independent by design).
  var LABEL_PALETTE = [
    "#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
    "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"
  ];

  // Seeds for fresh installs (mtime 0 → any user edit wins the merge
  // everywhere; identical bytes on every device — no Date.now() here).
  function defaultLabels() {
    return [
      { id: "lbl-personal", name: t("lbl.personal"), color: LABEL_PALETTE[0], mtime: 0 },
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[2], mtime: 0 },
      { id: "lbl-family",   name: t("lbl.family"),   color: LABEL_PALETTE[3], mtime: 0 }
    ];
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    if (LABEL_PALETTE.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    };
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
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
    return {
      id: e.id,
      date: e.date,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      mtime: (typeof e.mtime === "number" && isFinite(e.mtime)) ? e.mtime : Date.now()
    };
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
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
      if (d && typeof d === "object" && Array.isArray(d.events)) {
        state.events = d.events.map(sanitizeEvent).filter(Boolean);
      }
      // Pre-sync blobs have no "deleted" → empty list, zero migration
      if (d && Array.isArray(d.deleted)) {
        state.deleted = d.deleted.map(sanitizeTomb).filter(Boolean);
      }
      // v0.1 blobs have no "labels" → seed once (never overwritten
      // afterwards; user edits carry a fresh mtime).
      if (d && Array.isArray(d.labels)) {
        state.labels = d.labels.map(sanitizeLabel).filter(Boolean);
      }
      if (!state.labels.length) state.labels = defaultLabels();
    } catch (e) {
      if (!state.labels.length) state.labels = defaultLabels();
    }
  }
  function saveState() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
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
      input.dispatchEvent(new CustomEvent("tp-commit", { bubbles: false }));
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

  /* ---------- 2c. Rollup holders (wired in Part 2) ---------- */
  var tpStart = null, tpEnd = null;

  function hideTPMenus() {
    if (tpStart) tpStart.close();
    if (tpEnd) tpEnd.close();
  }
  
    /* ---------- 3. Date helpers + label visibility ---------- */
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function todayYMD() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // Label visibility: id -> true/false. Absent = visible. Chips row
  // toggles these; nothing is ever deleted by filtering.
  var labelVis = {};
  function labelVisible(labelId) {
    if (!labelId) return true;
    return labelVis[labelId] !== false;
  }

  function eventsOn(dateStr) {
    return state.events.filter(function (e) {
      return e.date === dateStr && labelVisible(e.labelId);
    }).sort(function (a, b) {
      if (a.start === b.start) return 0;
      if (a.start === null) return 1;     // all-day last
      if (b.start === null) return -1;
      return a.start < b.start ? -1 : 1;
    });
  }

  /* ---------- 4. Month grid ---------- */
  var viewYear, viewMonth;          // month currently displayed
  var selDate = null;               // "YYYY-MM-DD" or null

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

  function renderTitle() {
    var m = t("months")[viewMonth];
    $("cal-title").textContent = m + " " + viewYear;
  }

  function renderGrid() {
    var grid = $("cal-grid");
    grid.textContent = "";

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

      var num = document.createElement("span");
      num.className = "cal-num";
      num.textContent = dayNum;
      btn.appendChild(num);

      var dots = document.createElement("span");
      dots.className = "ev-dot-row";
      var dayEvents = eventsOn(cellDate).slice(0, 6);
      for (var j = 0; j < dayEvents.length; j++) {
        var dot = document.createElement("span");
        dot.className = "ev-dot" + (dayEvents[j].start ? " timed" : "");
        dot.style.background = labelColor(dayEvents[j].labelId);
        dots.appendChild(dot);
      }
      btn.appendChild(dots);

      (function (cd) {
        btn.addEventListener("click", function () { selectDay(cd); });
      })(cellDate);

      grid.appendChild(btn);
    }
  }

  /* ---------- 4b. Label filter chips ---------- */
  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";
    state.labels.forEach(function (l) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (labelVisible(l.id) ? "" : " off");
      c.style.setProperty("--chip", l.color);
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      c.appendChild(dot);
      c.appendChild(document.createTextNode(l.name));
      c.addEventListener("click", function () {
        labelVis[l.id] = !labelVisible(l.id);
        renderChips();
        renderGrid();
        renderDay();
      });
      row.appendChild(c);
    });
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip chip-manage";
    mg.textContent = "＋ " + t("lbl.manage");
    mg.addEventListener("click", openLblDlg);
    row.appendChild(mg);
  }

  /* ---------- 5. Day section ---------- */
  function selectDay(dateStr) {
    selDate = dateStr;
    renderGrid();
    renderDay();
  }

  function timeSpan(e) {
    if (e.start === null) return t("ev.alltime");
    return e.start + (e.end ? " – " + e.end : "");
  }

  function renderDay() {
    var head = $("day-title");
    if (!selDate) {
      head.textContent = "";
      $("ev-list").textContent = "";
      return;
    }
    var parts = selDate.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var txt = d.getDate() + " " + t("months")[d.getMonth()];
    if (selDate === todayYMD()) txt += " — " + t("day.today");
    head.textContent = txt;

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
    list.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "ev-row";

      var time = document.createElement("span");
      time.className = "ev-time";
      time.textContent = timeSpan(e);

      var main = document.createElement("div");
      main.className = "ev-main";
      var title = document.createElement("div");
      title.className = "ev-title";
      var titleTxt = document.createElement("span");
      titleTxt.className = "ev-title-text";
      titleTxt.textContent = e.title || t("ev.untitled");
      title.appendChild(titleTxt);

      var lb = e.labelId ? labelById(e.labelId) : null;
      if (lb) {
        var tag = document.createElement("span");
        tag.className = "ev-label";
        tag.style.background = lb.color;
        tag.textContent = lb.name;
        title.appendChild(tag);
      }
      main.appendChild(title);

      if (e.location) {
        var loc = document.createElement("div");
        loc.className = "ev-note ev-loc";
        loc.textContent = "▸ " + e.location;
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
      (function (ev) {
        li.addEventListener("click", function () { openDlg(ev); });
      })(e);
      ul.appendChild(li);
    });
  }

  /* ---------- 6. Navigation ---------- */
  // Selection follows the viewed month: the day panel always shows
  // a date that is actually on screen (Add targets the visible day).
  function followView() {
    if (!selDate) return;
    var p = selDate.split("-");
    if (+p[0] === viewYear && (+p[1] - 1) === viewMonth) return;
    selectDay(ymd(viewYear, viewMonth, 1));
  }
  $("cal-prev").addEventListener("click", function () {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderTitle();
    renderGrid();
    followView();
  });
  $("cal-next").addEventListener("click", function () {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderTitle();
    renderGrid();
    followView();
  });
  $("cal-today").addEventListener("click", function () {
    var n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    renderTitle();
    selectDay(todayYMD());
  });

  /* ---------- 7. Event dialog (add & edit) ---------- */
  var editingId = null;

  // Label picker inside the dialog: chips + "none". Local only —
  // committed on Save (unlike the month-view chips which filter).
  var dlgLabelId = null;

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
    state.labels.forEach(function (l) { mk(l.id, l.name, l.color); });
  }

  function openDlg(existing) {
    editingId = existing ? existing.id : null;
    $("ev-dlg-title").textContent = t(existing ? "ev.dlg.edit" : "ev.dlg.new");
    $("ev-title").value = existing ? existing.title : "";
    $("ev-start").value = existing && existing.start ? existing.start : "09:00";
    $("ev-end").value = existing && existing.end ? existing.end : "";
    $("ev-allday").checked = existing ? existing.start === null : false;
    $("ev-allday").dispatchEvent(new Event("change"));
    $("ev-location").value = existing ? existing.location : "";
    $("ev-note").value = existing ? existing.note : "";
    dlgLabelId = existing ? existing.labelId : null;
    renderDlgLabels();
    $("ev-del-row").className = "dlg-row" + (existing ? " show" : "");
    $("ev-dlg").showModal();
    setTimeout(function () { $("ev-title").focus(); }, 50);
  }

  $("ev-allday").addEventListener("change", function () {
    var off = $("ev-allday").checked;
    $("ev-start").disabled = off;
    $("ev-end").disabled = off;
  });

  $("ev-add").addEventListener("click", function () {
    if (!selDate) selectDay(todayYMD());
    openDlg(null);
  });

  $("ev-save").addEventListener("click", function () {
    var title = $("ev-title").value.trim();
    if (!title) {
      var ti = $("ev-title");
      ti.classList.add("invalid");
      ti.focus();
      setTimeout(function () { ti.classList.remove("invalid"); }, 1600);
      return;
    }
    if (!selDate) { $("ev-dlg").close(); return; }

    var start = tpStart ? tpStart.value() : null;
    var end = tpEnd ? tpEnd.value() : null;
    if ($("ev-allday").checked) { start = null; end = null; }
    // "no end" option commits "" → picker value() returns null there
    if (start === null && !$("ev-allday").checked && $("ev-start").value) {
      // typed garbage that survived normalization → treat as absent
      start = null;
    }
    if (start && end && end <= start) {
      $("ev-end").classList.add("invalid");
      $("ev-end").focus();
      setTimeout(function () { $("ev-end").classList.remove("invalid"); }, 1600);
      return;
    }
    var location = $("ev-location").value.trim().slice(0, 150);
    var note = $("ev-note").value.trim().slice(0, 500);

    if (editingId) {
      var found = false;
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === editingId) {
          state.events[i].title = title;
          state.events[i].start = start;
          state.events[i].end = end;
          state.events[i].location = location;
          state.events[i].note = note;
          state.events[i].labelId = dlgLabelId;
          state.events[i].date = selDate;
          state.events[i].mtime = Date.now();
          found = true;
          break;
        }
      }
      // Edited while another device deleted it → resurrect with fresh input
      // (fresh mtime beats the tombstone, same contract as mood/time).
      if (!found) {
        state.events.push({
          id: editingId,
          date: selDate,
          start: start,
          end: end,
          title: title,
          note: note,
          location: location,
          labelId: dlgLabelId,
          mtime: Date.now()
        });
      }
      // Any edit outranks a stale tombstone (no phantom deletes survive).
      state.deleted = state.deleted.filter(function (d) {
        return d.id !== editingId;
      });
    } else {
      state.events.push({
        id: uid(),
        date: selDate,
        start: start,
        end: end,
        title: title,
        note: note,
        location: location,
        labelId: dlgLabelId,
        mtime: Date.now()
      });
    }
    saveState();
    $("ev-dlg").close();
    renderChips();
    renderGrid();
    renderDay();
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

  $("del-dlg-yes").addEventListener("click", function () {
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
    renderGrid();
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
    state.events.push(lastDeleted);
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== lastDeleted.id;
    });
    lastDeleted = null;
    saveState();
    renderGrid();
    renderDay();
  }

  /* ---------- 7a. Label management dialog ---------- */
  function nextFreeColor() {
    for (var i = 0; i < LABEL_PALETTE.length; i++) {
      var used = state.labels.some(function (l) { return l.color === LABEL_PALETTE[i]; });
      if (!used) return LABEL_PALETTE[i];
    }
    return LABEL_PALETTE[state.labels.length % LABEL_PALETTE.length];
  }

  function openLblDlg() {
    renderLblList();
    $("lbl-dlg").showModal();
    $("lbl-new-name").focus();
  }

  function renderLblList() {
    var list = $("lbl-list");
    list.textContent = "";
    state.labels.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "lbl-row";

      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      row.appendChild(dot);

      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "lbl-name-in";
      inp.maxLength = 40;
      inp.value = l.name;
      inp.addEventListener("change", function () {
        l.name = inp.value.trim().slice(0, 40) || l.name;
        inp.value = l.name;
        l.mtime = Date.now();
        saveState();
        renderChips();
        renderDay();
      });
      row.appendChild(inp);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () {
        var inUse = state.events.some(function (e) { return e.labelId === l.id; });
        if (inUse) { toast(t("lbl.inuse")); return; }
        state.labels = state.labels.filter(function (x) { return x.id !== l.id; });
        state.deleted.push({ id: l.id, mtime: Date.now() });   // label tombstone (shared list)
        delete labelVis[l.id];
        saveState();
        renderLblList();
        renderChips();
        renderGrid();
        renderDay();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    if (!state.labels.length) {
      var emp = document.createElement("div");
      emp.className = "empty";
      emp.textContent = t("lbl.none");
      list.appendChild(emp);
    }
  }

  $("lbl-add").addEventListener("click", function () {
    var name = $("lbl-new-name").value.trim().slice(0, 40);
    if (!name) {
      $("lbl-new-name").focus();
      return;
    }
    var id = "lbl-" + uid();
    state.labels.push({ id: id, name: name, color: nextFreeColor(), mtime: Date.now() });
    $("lbl-new-name").value = "";
    saveState();
    renderLblList();
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

  /* ---------- 8. Boot ---------- */
  loadState();
  applyI18n();
  // Re-translate seeded labels if the store was freshly seeded with
  // the other language (seeds depend on LANG at seed time).
  tpStart = makeTP("ev-start", "ev-start-menu");
  tpEnd = makeTP("ev-end", "ev-end-menu", { noEnd: true });
  var boot = new Date();
  viewYear = boot.getFullYear();
  viewMonth = boot.getMonth();
  renderWeekdays();
  renderTitle();
  renderChips();
  renderGrid();
  selectDay(todayYMD());

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
    renderTitle();
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
    renderTitle();
    selectDay(td);
  });
  
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
    if (start && end && end < start) end = null;   // deterministic normalization
    var labelId = (typeof e.labelId === "string" && e.labelId) ? e.labelId : null;
    return {
      id: e.id,
      date: e.date,
      start: start,
      end: end,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      location: (typeof e.location === "string" ? e.location : "").slice(0, 150),
      labelId: labelId,
      mtime: e.mtime
    };
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
    if (LABEL_PALETTE.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: l.mtime
    };
  }

  // Deterministic entity merge: per id, bigger mtime wins; equal
  // mtimes broken by lexicographic JSON (same output on every
  // device regardless of processing order — the engine contract).
  // Tombstones beat events on ties (a delete must not resurrect).
  // A surviving NEWER event cancels its tombstone (resurrection).
  function mergeCalendars(local, remote) {
    var tomb = {};
    function takeTomb(d) {
      if (!tomb[d.id] || d.mtime > tomb[d.id].mtime ||
          (d.mtime === tomb[d.id].mtime && d.id < tomb[d.id].id)) tomb[d.id] = d;
    }
    var byId = {};
    function takeEv(e) {
      var cur = byId[e.id];
      if (!cur || e.mtime > cur.mtime ||
          (e.mtime === cur.mtime && JSON.stringify(e) < JSON.stringify(cur))) {
        byId[e.id] = e;
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
    Object.keys(tomb).forEach(function (id) { deleted.push(tomb[id]); });

    // Sorted by id → identical byte output on every device
    events.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    labels.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    deleted.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return { ver: 1, labels: labels, events: events, deleted: deleted };
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  function setFromSync(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    var evs = data.events.map(sanitizeEvent).filter(Boolean);
    var dels = (Array.isArray(data.deleted) ? data.deleted : [])
      .map(sanitizeTomb).filter(Boolean);
    var lbls = (Array.isArray(data.labels) ? data.labels : [])
      .map(sanitizeLabel).filter(Boolean);
    if (!lbls.length) lbls = defaultLabels();
    state = { ver: 1, labels: lbls, events: evs, deleted: dels };
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    renderTitle();
    renderChips();
    renderGrid();
    renderDay();          // selDate-aware (guarded when null)
    if (info && info.merged) toast(t("sync.merged"));   // receipt, not "Saved"
  }

  // Canonical dirty funnel (Part VII) — created BEFORE registration,
  // even when sync is absent (dirty becomes a safe no-op).
  var syncApi = (window.parent && window.parent.orosSync) || window.orosSync;
  window.__orosSyncApi = {
    _suppress: false,
    dirty: function () {
      if (this._suppress) return;
      if (syncApi && typeof syncApi.markDirty === "function") syncApi.markDirty();
    }
  };

  try {
    if (syncApi && typeof syncApi.registerSlice === "function") {
      syncApi.registerSlice(
        "calendar",
        function () {     // getter: localStorage is the durable truth
          try {
            return JSON.parse(localStorage.getItem(DATA_KEY)) ||
              { ver: 1, labels: [], events: [], deleted: [] };
          } catch (e) {
            return { ver: 1, labels: [], events: [], deleted: [] };
          }
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeCalendars
      );
    }
  } catch (e) { /* standalone preview — sync simply absent */ }
})();