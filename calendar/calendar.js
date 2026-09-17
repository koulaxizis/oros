// ============================================================
// orOS Calendar v0.1.0
// Monthly grid (Monday-first), day selection, event CRUD.
// Data: localStorage "oros-calendar-data"
//   { ver: 1, events: [ { id, date: "YYYY-MM-DD",
//       time: "HH:MM" | null, title, note, mtime } ] }
// id + mtime exist from day one for the Part 5 merge sync —
// no future migration needed.
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
  // (Bonus fix: previously the app saw shell theme changes only at
  // its own boot; a theme toggle in the menu left it stale.)
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
      "wd": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      "months": ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"],
      "day.today": "Today",
      "ev.add": "Add",
      "ev.dlg.new": "New event",
      "ev.dlg.edit": "Edit event",
      "ev.field.title": "Title",
      "ev.ph.title": "What's happening?",
      "ev.field.time": "Time",
      "ev.allday": "All day",
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
      "ev.del.yes": "Delete",
      "sync.merged": "Updated from sync"
    },
    el: {
      "cal.today": "Σήμερα",
      "cal.prev": "Προηγούμενος μήνας",
      "cal.next": "Επόμενος μήνας",
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
      "ev.field.time": "Ώρα",
      "ev.allday": "Όλη μέρα",
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
      "ev.del.yes": "Διαγραφή",
      "sync.merged": "Ενημερώθηκε από συγχρονισμό"
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
  var state = { ver: 1, events: [], deleted: [] };

  function sanitizeEvent(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    var time = (typeof e.time === "string" && /^\d{2}:\d{2}$/.test(e.time)) ? e.time : null;
    return {
      id: e.id,
      date: e.date,
      time: time,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
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
    } catch (e) {}
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

  /* ---------- 3. Date helpers ---------- */
  function ymd(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function todayYMD() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function eventsOn(dateStr) {
    return state.events.filter(function (e) { return e.date === dateStr; })
      .sort(function (a, b) {
        if (a.time === b.time) return 0;
        if (a.time === null) return 1;     // all-day last
        if (b.time === null) return -1;
        return a.time < b.time ? -1 : 1;
      });
  }

  /* ---------- 4. Month grid ---------- */
  var viewYear, viewMonth;          // month currently displayed
  var selDate = null;               // "YYYY-MM-DD" or null

  function renderWeekdays() {
    var wd = $("cal-wd");
    wd.innerHTML = "";
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
    grid.innerHTML = "";

    // Monday-first offset: Jan 1 1970 was a Thursday (dow 4 with
    // Mon=0). getDay(): Sun=0..Sat=6 → Mon-first index.
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
        dot.className = "ev-dot" + (dayEvents[j].time ? " timed" : "");
        dots.appendChild(dot);
      }
      btn.appendChild(dots);

      (function (cd) {
        btn.addEventListener("click", function () { selectDay(cd); });
      })(cellDate);

      grid.appendChild(btn);
    }
  }

  /* ---------- 5. Day section ---------- */
  function selectDay(dateStr) {
    selDate = dateStr;
    renderGrid();
    renderDay();
  }

  function renderDay() {
    var head = $("day-title");
    if (!selDate) {
      head.textContent = "";
      $("ev-list").innerHTML = "";
      return;
    }
    var parts = selDate.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var txt = d.getDate() + " " + t("months")[d.getMonth()];
    if (selDate === todayYMD()) txt += " — " + t("day.today");
    head.textContent = txt;

    var ul = $("ev-list");
    ul.innerHTML = "";
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
      time.textContent = e.time || t("ev.alltime");
      var main = document.createElement("div");
      main.className = "ev-main";
      var title = document.createElement("div");
      title.className = "ev-title";
      title.textContent = e.title || t("ev.untitled");
      main.appendChild(title);
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

  function openDlg(existing) {
    editingId = existing ? existing.id : null;
    $("ev-dlg-title").textContent = t(existing ? "ev.dlg.edit" : "ev.dlg.new");
    $("ev-title").value = existing ? existing.title : "";
    $("ev-time").value = existing && existing.time ? existing.time : "09:00";
    $("ev-allday").checked = existing ? !existing.time : false;
    $("ev-time").disabled = $("ev-allday").checked;
    $("ev-note").value = existing ? existing.note : "";
    $("ev-del-row").className = "dlg-row" + (existing ? " show" : "");
    $("ev-dlg").showModal();
    if (existing) setTimeout(function () { $("ev-delete").focus(); }, 50);
  }

  $("ev-allday").addEventListener("change", function () {
    $("ev-time").disabled = $("ev-allday").checked;
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

    var time = $("ev-allday").checked ? null : $("ev-time").value;
    if (time && !/^\d{2}:\d{2}$/.test(time)) time = null;
    if (time === "") time = null;   // empty string never reaches storage

    if (editingId) {
      var found = false;
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === editingId) {
          state.events[i].title = title;
          state.events[i].note = $("ev-note").value.trim();
          state.events[i].time = time;
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
          time: time,
          title: title,
          note: $("ev-note").value.trim(),
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
        time: time,
        title: title,
        note: $("ev-note").value.trim(),
        mtime: Date.now()
      });
    }
    saveState();
    $("ev-dlg").close();
    renderGrid();
    renderDay();
  });

  $("ev-cancel").addEventListener("click", function () { $("ev-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("ev-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

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
    state.events = state.events.filter(function (e) { return e.id !== editingId; });
    state.deleted.push({ id: editingId, mtime: Date.now() });
    saveState();
    editingId = null;   // clear dangling state
    $("del-dlg").close();
    $("ev-dlg").close();
    renderGrid();
    renderDay();
  });

  $("del-dlg-no").addEventListener("click", function () {
    $("del-dlg").close();
  });

  // Outside-click close (same pattern as #ev-dlg)
  $("del-dlg").addEventListener("click", function (ev) {
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
  var boot = new Date();
  viewYear = boot.getFullYear();
  viewMonth = boot.getMonth();
  renderWeekdays();
  renderTitle();
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

  // Deterministic entity merge: per id, bigger mtime wins; equal
  // mtimes broken by lexicographic JSON (same output on every
  // device regardless of processing order — the engine contract).
  // Tombstones beat events on ties (a delete must not resurrect).
  // A surviving NEWER event cancels its tombstone (resurrection).
  // Strict merge-time sanitizers — DROP rows with invalid mtime.
  // Never Date.now() inside merge: non-determinism (Storage #6 precedent).
  function mergeSanitizeEv(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    if (typeof e.mtime !== "number" || !isFinite(e.mtime)) return null;
    var time = (typeof e.time === "string" && /^\d{2}:\d{2}$/.test(e.time)) ? e.time : null;
    return {
      id: e.id,
      date: e.date,
      time: time,
      title: (typeof e.title === "string" ? e.title : "").slice(0, 80),
      note: (typeof e.note === "string" ? e.note : "").slice(0, 500),
      mtime: e.mtime
    };
  }
  function mergeSanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    if (typeof d.mtime !== "number" || !isFinite(d.mtime)) return null;
    return { id: d.id, mtime: d.mtime };
  }

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

    [local, remote].forEach(function (side) {
      if (!side || typeof side !== "object") return;
      (Array.isArray(side.deleted) ? side.deleted : [])
        .map(mergeSanitizeTomb).filter(Boolean).forEach(takeTomb);
      (Array.isArray(side.events) ? side.events : [])
        .map(mergeSanitizeEv).filter(Boolean).forEach(takeEv);
    });

    var events = [], deleted = [];
    Object.keys(byId).forEach(function (id) {
      var tb = tomb[id];
      if (tb && tb.mtime >= byId[id].mtime) return;   // delete wins (ties included)
      events.push(byId[id]);                           // survived (or resurrected):
      delete tomb[id];                                 // tombstone cancelled
    });
    Object.keys(tomb).forEach(function (id) { deleted.push(tomb[id]); });

    // Sorted by id → identical byte output on every device
    events.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    deleted.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return { ver: 1, events: events, deleted: deleted };
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  function setFromSync(data, info) {
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return;
    var evs = data.events.map(sanitizeEvent).filter(Boolean);
    var dels = (Array.isArray(data.deleted) ? data.deleted : [])
      .map(sanitizeTomb).filter(Boolean);
    state = { ver: 1, events: evs, deleted: dels };
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    renderTitle();
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
              { ver: 1, events: [], deleted: [] };
          } catch (e) {
            return { ver: 1, events: [], deleted: [] };
          }
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeCalendars
      );
    }
  } catch (e) { /* standalone preview — sync simply absent */ }
})();