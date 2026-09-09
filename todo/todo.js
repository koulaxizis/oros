// ============================================================
// orOS To-Do — App logic (v0.3)
// New in v0.3 (Kanban-pattern port):
//   - Labels (board-wide store + attach/detach per task)
//   - Global search (across ALL lists, flattened results
//     with source-list chips; covers text, notes, extra info,
//     label names)
//   - Filter by label (popover, combines with search, AND)
//   - Extra info: free key-value fields per task
//   - Tab drag reorder (pointer-based, horizontal bias)
//   - Tab rename pencil (hover on desktop, always on touch)
//   - DATA_VER 1 → 2 migration (additive: state.labels,
//     item.labels, item.info) in load() AND sliceSet
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration, IDs
//   3. Recurrence date math + list-cycle engine
//   4. Render: tabs (+ rename pencil + drag reorder)
//   5. Render: items (+ search/filter view)
//   6. Quick-add (natural date parsing)
//   7. Item detail dialog (+ labels / extra info editors)
//   8. List settings dialog
//   9. Item drag & drop reorder
//  10. Label helpers (shared by items + filter)
//  11. Undo / toast
//  12. Sync slice (Dropbox) + palette inheritance
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-todo-data";
  var DATA_VER = 2;

  // ---------- 1. Constants, i18n, helpers ----------
  // Language comes from the shell (same-origin, shared localStorage).
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "quick.add":     "Add a task… (try “tomorrow”, “friday”)",
      "hide.completed":"Hide completed",
      "clear.completed":"Clear completed",
      "empty.title":   "Nothing here yet",
      "empty.hint":    "Add your first task above.",
      "item.title":    "Task",
      "item.text":     "Text",
      "item.due":      "Due date",
      "item.notes":    "Notes",
      "item.labels":   "Labels",
      "labels.manage": "Add / manage labels",
      "labels.chipRemove": "Click to remove",
      "labels.newph":  "New label…",
      "labels.add":    "Add",
      "labels.none":   "No labels yet — create one below.",
      "item.info":     "Extra info",
      "item.info.add": "Add field",
      "item.info.label": "Field",
      "item.info.value": "Value",
      "recur.title":   "Repeat",
      "recur.none":    "Never",
      "recur.every":   "Every",
      "unit.day":      "days",
      "unit.week":     "weeks",
      "unit.month":    "months",
      "item.delete":   "Delete",
      "save":          "Save",
      "list.settings": "List settings",
      "list.name":     "Name",
      "list.delete":   "Delete list",
      "recur.list.title": "List cycle",
      "recur.list.hint":  "When a cycle ends, all checks are cleared automatically.",
      "due.today":     "Today",
      "due.tomorrow":  "Tomorrow",
      "due.overdue":   "Overdue",
      "search.ph":     "Search…",
      "search.clear":  "Clear search",
      "search.none":   "No matches",
      "search.none.hint": "Try another term or clear the label filter.",
      "filter.title":  "Filter by label",
      "filter.empty":  "No labels yet — add one from a task.",
      "filter.del":   "Delete label",
      "tab.rename":    "Rename list",
      "toast.deleted": "Deleted",
      "toast.undone":  "Restored",
      "toast.cleared": "Completed items cleared",
      "toast.listdel": "List deleted",
      "toast.labeladd": "Label created",
      "toast.labeldel": "Label deleted",
      "undo":          "Undo",
      "confirm.listdel": "Delete this list and all its tasks?",
      "confirm.itemdel": "Delete this task?",
      "confirm.lbldel":  "Delete this label? It will be removed from all tasks.",
      "new.list":      "New list",
      "recur.list.next": "Next reset:",
      "drag.reorder":   "Reorder"
    },
    el: {
      "quick.add":     "Προσθήκη εργασίας… (δοκίμασε «αύριο», «παρασκευή»)",
      "hide.completed":"Απόκρυψη ολοκληρωμένων",
      "clear.completed":"Καθαρισμός ολοκληρωμένων",
      "empty.title":   "Δεν υπάρχει τίποτα εδώ ακόμα",
      "empty.hint":    "Πρόσθεσε την πρώτη σου εργασία παραπάνω.",
      "item.title":    "Εργασία",
      "item.text":     "Κείμενο",
      "item.due":      "Προθεσμία",
      "item.notes":    "Σημειώσεις",
      "item.labels":   "Ετικέτες",
      "labels.manage": "Προσθήκη / διαχείριση ετικετών",
      "labels.chipRemove": "Κλικ για αφαίρεση",
      "labels.newph":  "Νέα ετικέτα…",
      "labels.add":    "Προσθήκη",
      "labels.none":   "Δεν υπάρχουν ετικέτες — δημιούργησε από κάτω.",
      "item.info":     "Επιπλέον στοιχεία",
      "item.info.add": "Προσθήκη πεδίου",
      "item.info.label": "Πεδίο",
      "item.info.value": "Τιμή",
      "recur.title":   "Επανάληψη",
      "recur.none":    "Ποτέ",
      "recur.every":   "Κάθε",
      "unit.day":      "ημέρες",
      "unit.week":     "εβδομάδες",
      "unit.month":    "μήνες",
      "item.delete":   "Διαγραφή",
      "save":          "Αποθήκευση",
      "list.settings": "Ρυθμίσεις λίστας",
      "list.name":     "Όνομα",
      "list.delete":   "Διαγραφή λίστας",
      "recur.list.title": "Κύκλος λίστας",
      "recur.list.hint":  "Όταν λήξει ο κύκλος, όλα τα τσεκαρίσματα μηδενίζονται αυτόματα.",
      "due.today":     "Σήμερα",
      "due.tomorrow":  "Αύριο",
      "due.overdue":   "Σε καθυστέρηση",
      "search.ph":     "Αναζήτηση…",
      "search.clear":  "Καθαρισμός αναζήτησης",
      "search.none":   "Καμία αντιστοιχία",
      "search.none.hint": "Δοκίμασε άλλον όρο ή καθάρισε το φίλτρο ετικετών.",
      "filter.title":  "Φιλτράρισμα ανά ετικέτα",
      "filter.empty":  "Δεν υπάρχουν ετικέτες — πρόσθεσε από κάποια εργασία.",
      "filter.del":    "Διαγραφή ετικέτας",
      "tab.rename":    "Μετονομασία λίστας",
      "toast.deleted": "Διαγράφηκε",
      "toast.undone":  "Επαναφέρθηκε",
      "toast.cleared": "Καθαρίστηκαν οι ολοκληρωμένες εργασίες",
      "toast.listdel": "Η λίστα διαγράφηκε",
      "toast.labeladd": "Η ετικέτα δημιουργήθηκε",
      "toast.labeldel": "Η ετικέτα διαγράφηκε",
      "undo":          "Αναίρεση",
      "confirm.listdel": "Διαγραφή λίστας και όλων των εργασιών της;",
      "confirm.itemdel": "Διαγραφή αυτής της εργασίας;",
      "confirm.lbldel":  "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις εργασίες.",
      "new.list":      "Νέα λίστα",
      "recur.list.next": "Επόμενο reset:",
      "drag.reorder":   "Αναδιάταξη"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  var WEEKDAY_KEYS = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
  };
  // Lookup words for the quick-add parser (lowercased, accents stripped)
  var WEEKDAY_WORDS = {};
  ["en", "el"].forEach(function (l) {
    WEEKDAY_KEYS[l].forEach(function (name, idx) {
      WEEKDAY_WORDS[normalize(name)] = idx;
      WEEKDAY_WORDS[normalize(name.slice(0, 3))] = idx;   // "fri", "παρ"
    });
  });
  var WORD_TOMORROW = {};
  WORD_TOMORROW["tomorrow"] = WORD_TOMORROW["αύριο"] = WORD_TOMORROW["αυριο"] = true;
  var WORD_TODAY = {};
  WORD_TODAY["today"] = WORD_TODAY["σήμερα"] = WORD_TODAY["σημερα"] = true;

  function normalize(s) {
    return s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
      .replace(/[^\p{L}\p{N}]+/gu, "");                  // letters+digits only
  }

  // ISO date (YYYY-MM-DD) helpers — everything human-readable is
  // derived locally, so EL gets GR format for free via toLocaleDateString.
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoToDate(iso) {
    var p = String(iso).split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function dateToISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysDiff(isoA, isoB) {          // a - b, in days
    return Math.round((isoToDate(isoA) - isoToDate(isoB)) / 86400000);
  }
  function fmtDue(iso) {
    var diff = daysDiff(iso, todayISO());
    if (diff === 0)  return t("due.today");
    if (diff === 1)  return t("due.tomorrow");
    var d = isoToDate(iso);
    var loc = LANG === "el" ? "el-GR" : "en-GB";
    return d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }

  var SWATCH_COLORS = ["#d4af37", "#4caf50", "#f44336", "#2196f3",
                       "#ff9800", "#9c27b0", "#e91e63", "#03a9f4"];
  var FALLBACK_COLOR = "#d4af37";

  // ---------- 2. Data model, storage, migration ----------
  // state = {
  //   ver: 2,
  //   activeList: <listId>,
  //   hideCompleted: bool,
  //   labels: [{ id, name, color }],
  //   lists: [{
  //     id, name,
  //     recurrence: null | {every, unit, weekday},
  //     lastReset: iso, nextReset: iso,
  //     items: [{ id, text, done, due, notes,
  //               labels: [<label id>],
  //               info: [{ id, label, value }],
  //               recurrence: null | {every, unit, weekday} }]
  //   }]
  // }
  var state = null;
  var renderQueued = false;

  // Search / filter are session-only view state (never persisted):
  // sync pulls from another device must not resurrect a stale view.
  var searchQuery = "";
  var activeFilters = [];

  function defaultState() {
    var first = newListObj(LANG === "el" ? "Γενικά" : "General");
    var work   = newListObj(LANG === "el" ? "Ψώνια" : "Groceries");
    return {
      ver: DATA_VER,
      activeList: first.id,
      hideCompleted: false,
      labels: [],
      lists: [first, work]
    };
  }

  function newListObj(name) {
    return { id: uid(), name: name, recurrence: null,
             lastReset: null, nextReset: null, items: [] };
  }

  // Additive migration: bring ANY older/missing shape up to DATA_VER.
  // v1 data gains labels[]/info[] defaults — zero data loss.
  function migrate(data) {
    if (!data || !Array.isArray(data.lists)) return null;
    if (!Array.isArray(data.labels)) data.labels = [];
    data.lists.forEach(function (list) {
      if (!Array.isArray(list.items)) list.items = [];
      list.items.forEach(function (it) {
        if (!Array.isArray(it.labels)) it.labels = [];
        if (!Array.isArray(it.info)) it.info = [];
      });
    });
    data.ver = DATA_VER;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.lists) && data.lists.length > 0) {
          state = data;
          applyListCycles();      // section 3 — may reset lists
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    state = defaultState();
    save();
  }

  // Auto-save: every mutation ends with save() + scheduleRender().
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota — nothing sensible to do offline */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  function activeList() {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === state.activeList) return state.lists[i];
    }
    return state.lists[0];      // fallback (guarded in sliceSet)
  }

  function listById(id) {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === id) return state.lists[i];
    }
    return null;
  }

  function itemById(list, itemId) {
    if (!list) return null;
    for (var i = 0; i < list.items.length; i++) {
      if (list.items[i].id === itemId) return list.items[i];
    }
    return null;
  }

  // ---------- 3. Recurrence date math + list cycles ----------
  function advance(date, rec) {
    var d = new Date(date.getTime());
    if (rec.unit === "day")   d.setDate(d.getDate() + rec.every);
    else if (rec.unit === "month") d.setMonth(d.getMonth() + rec.every);
    else                       d.setDate(d.getDate() + 7 * rec.every);   // weeks
    return d;
  }

  // Next occurrence honoring a weekday constraint (weekly only).
  function nextWithWeekday(from, rec) {
    var d = new Date(from.getTime());
    d.setDate(d.getDate() + 7 * rec.every);
    var wd = d.getDay();
    if (wd !== rec.weekday) {
      var delta = (rec.weekday - wd + 7) % 7;
      d.setDate(d.getDate() + delta);
    }
    return d;
  }

  // Advance until strictly after "from". An item completed while
  // already overdue jumps to the FIRST future occurrence, not N-ahead.
  function nextOccurrence(from, rec) {
    var d = new Date(from.getTime());
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      while (d <= from || d.getDay() !== rec.weekday) d = nextWithWeekday(d, rec);
      return d;
    }
    d = advance(d, rec);
    while (d <= from) d = advance(d, rec);
    return d;
  }

  // Checked a recurring item → it re-opens with the next due date
  // instead of staying done. Returns true if the item recycled.
  function recycleItem(item) {
    if (!item.recurrence) return false;
    var anchor = new Date();                                // now
    var next = nextOccurrence(anchor, item.recurrence);
    item.due = dateToISO(next);
    item.done = false;
    return true;
  }

  // List-level cycle: when the deadline passes, every item resets.
  function applyListCycles() {
    var today = todayISO();
    var changed = false;
    state.lists.forEach(function (list) {
      if (!list.recurrence) { list.nextReset = null; return; }
      if (!list.nextReset) {
        list.lastReset = today;
        list.nextReset = dateToISO(
          nextOccurrence(isoToDate(today), list.recurrence));
        changed = true;
      }
      while (list.nextReset <= today) {
        list.lastReset = list.nextReset;
        list.items.forEach(function (it) { it.done = false; });
        list.nextReset = dateToISO(
          nextOccurrence(isoToDate(list.nextReset), list.recurrence));
        changed = true;
      }
    });
    if (changed) save();
  }

  // ---------- 4. Render: tabs ----------
  function overdueCount(list) {
    var today = todayISO();
    var n = 0;
    list.items.forEach(function (it) {
      if (!it.done && it.due && it.due < today) n++;
    });
    return n;
  }

  function renderTabs() {
    var tabs = $("tabs");
    tabs.innerHTML = "";
    state.lists.forEach(function (list) {
      var b = document.createElement("button");
      b.className = "tab" + (list.id === state.activeList ? " active" : "");
      b.setAttribute("role", "tab");
	  b.dataset.listId = list.id;
      b.type = "button";

      var name = document.createElement("span");
      name.textContent = list.name;
      b.appendChild(name);

      var od = overdueCount(list);
      if (od > 0) {
        var chip = document.createElement("span");
        chip.className = "chip overdue";
        chip.textContent = String(od);
        b.appendChild(chip);
      }

      // Rename pencil — same dialog as dblclick (Kanban #22 parity)
      var pen = document.createElement("span");
      pen.className = "t-rename";
      pen.setAttribute("role", "button");
      pen.setAttribute("aria-label", t("tab.rename"));
      pen.title = t("tab.rename");
      pen.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
      pen.addEventListener("click", function (e) {
        e.stopPropagation();
        openListDialog(list.id);
      });
      b.appendChild(pen);

      b.addEventListener("dblclick", function () { openListDialog(list.id); });
      b.addEventListener("click", function () {
        if (state.activeList === list.id) return;
        state.activeList = list.id;
        // switching lists is not a view filter anymore — clear nothing,
        // search stays as typed (user might want to keep looking)
        save(); scheduleRender();
      });

      // Tab drag reorder (pointer-based, horizontal bias)
      attachTabDrag(b, list);

      tabs.appendChild(b);
    });
  }

  // ---------- 5. Render: items ----------
  // View modes:
  //   - browsing: the active list's items (drag handles enabled)
  //   - searching/filtering: flattened results from ALL lists,
  //     source chip per item, no drag handles (cross-list reorder
  //     is meaningless)
  function isSearching() {
    return !!(searchQuery || activeFilters.length > 0);
  }

  function itemMatchesView(item) {
    if (state.hideCompleted && item.done) return false;
    if (searchQuery && !matchesSearch(item)) return false;
    if (activeFilters.length > 0 && !matchesFilters(item)) return false;
    return true;
  }

  function matchesSearch(item) {
    if ((item.text || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if ((item.notes || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var i = 0; i < (item.info || []).length; i++) {
      var f = item.info[i];
      if ((f.label || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
      if ((f.value || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    for (var j = 0; j < (item.labels || []).length; j++) {
      var label = labelById(item.labels[j]);
      if (label && label.name.toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    return false;
  }

  // OR over selected labels — item shows if it carries ANY active label.
  function matchesFilters(item) {
    if (!item.labels || item.labels.length === 0) return false;
    for (var i = 0; i < activeFilters.length; i++) {
      if (item.labels.indexOf(activeFilters[i]) !== -1) return true;
    }
    return false;
  }

  function renderItems() {
    var ul = $("items");
    ul.innerHTML = "";

    if (isSearching()) {
      var results = [];
      state.lists.forEach(function (list) {
        list.items.forEach(function (item) {
          if (itemMatchesView(item)) results.push({ list: list, item: item });
        });
      });

      results.forEach(function (r) {
        ul.appendChild(makeItemRow(r.list, r.item, { source: true }));
      });

      var anyItems = state.lists.some(function (l) { return l.items.length > 0; });
      $("empty").hidden = true;
      $("no-match").hidden = !(results.length === 0 && anyItems);
      return;
    }

    // Browsing mode — the active list, drag handles on
    var list = activeList();
    $("no-match").hidden = true;
    $("empty").hidden = !(list.items.length === 0);

    list.items.forEach(function (item, index) {
      if (state.hideCompleted && item.done) return;
      ul.appendChild(makeItemRow(list, item, { handle: true, index: index }));
    });
  }

  // Shared row builder (both view modes render identical rows —
  // the ONLY difference is the drag handle vs the source chip).
  function makeItemRow(list, item, opts) {
    var li = document.createElement("li");
    li.className = "item" + (item.done ? " done" : "");
    li.dataset.id = item.id;

    // checkbox
    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.checked = item.done;
    check.addEventListener("change", function () {
      item.done = check.checked;
      if (item.done) recycleItem(item);       // recurring → reopens
      save(); scheduleRender();
    });
    li.appendChild(check);

    // body (text + extras) — click opens detail dialog
    var body = document.createElement("div");
    body.className = "body";
    var label = document.createElement("div");
    label.className = "label";
    label.textContent = item.text;
    body.appendChild(label);

    if (item.notes) {
      var prev = document.createElement("div");
      prev.className = "notes-preview";
      prev.textContent = item.notes;
      body.appendChild(prev);
    }

    // label chips (Kanban parity)
    if (item.labels && item.labels.length > 0) {
      var chipHost = document.createElement("div");
      chipHost.className = "chips";
      item.labels.forEach(function (lid) {
        var lb = labelById(lid);
        if (!lb) return;
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.style.background = lb.color || FALLBACK_COLOR;
        chip.textContent = lb.name;
        chip.title = lb.name;
        chipHost.appendChild(chip);
      });
      if (chipHost.childNodes.length > 0) body.appendChild(chipHost);
    }

    // extra info preview: one dim, truncated line (Kanban parity)
    var infoParts = [];
    (item.info || []).forEach(function (f) {
      var l = (f.label || "").trim();
      var v = (f.value || "").trim();
      if (l && v) infoParts.push(l + ": " + v);
    });
    if (infoParts.length > 0) {
      var ip = document.createElement("div");
      ip.className = "info-preview";
      ip.textContent = infoParts.join("  ·  ");
      body.appendChild(ip);
    }

    // meta row: due chip + repeat indicator + source list chip
    var hasMeta = item.due || item.recurrence || opts.source;
    if (hasMeta) {
      var meta = document.createElement("div");
      meta.className = "meta";
      if (item.due) {
        var chip = document.createElement("span");
        chip.className = "chip-due" + dueClass(item.due);
        chip.textContent = fmtDue(item.due);
        meta.appendChild(chip);
      }
      if (item.recurrence) {
        var rec = document.createElement("span");
        rec.className = "chip-recur-ico";
        rec.innerHTML = RECUR_SVG;
        rec.appendChild(document.createTextNode(recurShort(item.recurrence)));
        meta.appendChild(rec);
      }
      if (opts.source) {
        var src = document.createElement("span");
        src.className = "chip-src";
        src.textContent = list.name;
        src.title = list.name;
        meta.appendChild(src);
      }
      body.appendChild(meta);
    }

    body.addEventListener("click", function () { openItemDialog(list.id, item.id); });
    li.appendChild(body);

    // drag handle (browsing mode only)
    if (opts.handle) li.appendChild(makeDragHandle(list, item));

    return li;
  }

  function dueClass(iso) {
    var diff = daysDiff(iso, todayISO());
    if (diff < 0) return " overdue";
    if (diff === 0) return " today";
    return "";
  }

  function recurShort(rec) {
    var s = t("recur.every") + " " + rec.every + " " + t("unit." + rec.unit);
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      s += " · " + WEEKDAY_KEYS[LANG][rec.weekday];
    }
    return s;
  }

  // ---------- 6. Quick-add with natural date parsing ----------
  function parseQuickAdd(raw) {
    var tokens = raw.trim().split(/\s+/);
    var due = null;
    var weekdayHit = null;

    var kept = tokens.filter(function (tok) {
      var n = normalize(tok);
      if (WORD_TODAY[n]) { due = todayISO(); return false; }
      if (WORD_TOMORROW[n]) {
        var d = isoToDate(todayISO());
        d.setDate(d.getDate() + 1);
        due = dateToISO(d);
        return false;
      }
      if (WEEKDAY_WORDS[n] !== undefined) {
        weekdayHit = WEEKDAY_WORDS[n];
        return false;
      }
      return true;
    });

    if (weekdayHit !== null) {
      var d2 = isoToDate(todayISO());
      var delta = (weekdayHit - d2.getDay() + 7) % 7;
      if (delta === 0) delta = 7;                 // "friday" on a Friday = next one
      d2.setDate(d2.getDate() + delta);
      due = dateToISO(d2);
    }

    return { text: kept.join(" ").trim(), due: due };
  }

  function quickAdd() {
    var input = $("quick-add");
    var raw = input.value;
    if (!raw.trim()) return;

    var parsed = parseQuickAdd(raw);
    if (!parsed.text) return;                    // only date words typed

    activeList().items.unshift({
      id: uid(),
      text: parsed.text,
      done: false,
      due: parsed.due,
      notes: "",
      labels: [],
      info: [],
      recurrence: null
    });
    input.value = "";
    save(); scheduleRender();
  }

  function renderAll() {
    renderTabs();
    renderItems();
  }

  // ---------- 7. Item detail dialog ----------
  var editingListId = null;
  var editingItemId = null;
  var pickedSwatch = FALLBACK_COLOR;

  function editingItem() {
    return itemById(listById(editingListId), editingItemId);
  }

  function populateWeekdaySelects() {
    [$("f-weekday"), $("l-weekday")].forEach(function (sel) {
      sel.innerHTML = "";
      WEEKDAY_KEYS[LANG].forEach(function (name, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.value = "1";   // Monday default
    });
  }

  function openItemDialog(listId, itemId) {
    var list = listById(listId);
    var item = itemById(list, itemId);
    if (!list || !item) return;

    editingListId = listId;
    editingItemId = itemId;

    $("f-text").value  = item.text;
    $("f-due").value   = item.due || "";
    $("f-notes").value = item.notes || "";

    renderItemLabels(item);
    renderInfoRows(item);
    $("f-lbl-picker").hidden = true;

    var hasRec = !!item.recurrence;
    setRadio("f-rec", hasRec ? "on" : "none");
    $("rec-editor").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("f-", item.recurrence);

    $("dlg-item").showModal();
    setTimeout(function () { $("f-text").focus(); }, 50);
  }

  function fillRecFields(prefix, rec) {
    $(prefix + "every").value = rec.every || 1;
    $(prefix + "unit").value  = rec.unit || "week";
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      $(prefix + "weekday").value = String(rec.weekday);
    }
    $(prefix + "weekday").disabled = ($(prefix + "unit").value !== "week");
  }

  function setRadio(name, val) {
    var radios = document.getElementsByName(name);
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === val;
    }
  }

  function getRadio(name) {
    var radios = document.getElementsByName(name);
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) return radios[i].value;
    }
    return null;
  }

  function readRecFromFields(prefix) {
    if (getRadio(prefix + "rec") !== "on") return null;
    var unit = $(prefix + "unit").value;
    return {
      every:   Math.max(1, parseInt($(prefix + "every").value, 10) || 1),
      unit:    unit,
      weekday: unit === "week" ? parseInt($(prefix + "weekday").value, 10) : null
    };
  }

  // --- Labels inside the item dialog (Kanban-parity contract) ---
  function renderItemLabels(item) {
    var host = $("f-lbl-chips");
    host.innerHTML = "";
    (item.labels || []).forEach(function (lid) {
      var lb = labelById(lid);
      if (!lb) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lbl-chip";
      chip.style.background = lb.color || FALLBACK_COLOR;
      chip.title = t("labels.chipRemove");
      var name = document.createElement("span");
      name.textContent = lb.name;
      chip.appendChild(name);
      chip.addEventListener("click", function () {
        item.labels = item.labels.filter(function (id) { return id !== lid; });
        save(); scheduleRender();
        renderItemLabels(item);
      });
      host.appendChild(chip);
    });
  }

  function renderLblPicker() {
    var list = $("f-lbl-list");
    list.innerHTML = "";

    if (state.labels.length === 0) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("labels.none");
      list.appendChild(none);
      return;
    }

    var item = editingItem();
    state.labels.forEach(function (label) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "lbl-item";
      if (item && item.labels.indexOf(label.id) !== -1) {
        row.classList.add("attached");
      }

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      row.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      row.appendChild(name);

      row.addEventListener("click", function () {
        var it = editingItem();
        if (!it) return;
        var pos = it.labels.indexOf(label.id);
        if (pos === -1) it.labels.push(label.id);
        else            it.labels.splice(pos, 1);
        save(); scheduleRender();
        renderItemLabels(it);
        renderLblPicker();
      });

      list.appendChild(row);
    });
  }

  function renderLblSwatches() {
    var host = $("f-lbl-swatches");
    host.innerHTML = "";
    SWATCH_COLORS.forEach(function (c) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "lbl-swatch" + (pickedSwatch === c ? " sel" : "");
      sw.style.background = c;
      sw.addEventListener("click", function () {
        pickedSwatch = c;
        renderLblSwatches();
      });
      host.appendChild(sw);
    });
  }

  function createNewLabel() {
    var input = $("f-lbl-name");
    var name = input.value.trim();
    if (!name) return;

    var label = { id: uid(), name: name, color: pickedSwatch };
    state.labels.push(label);

    var item = editingItem();
    if (item) item.labels.push(label.id);

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (item) renderItemLabels(item);
    renderLblPicker();
    input.focus();
    showToast(t("toast.labeladd"), false);
  }

  // --- Extra info rows inside the item dialog (free key-value) ---
  function renderInfoRows(item) {
    var host = $("f-info-list");
    host.innerHTML = "";
    item.info.forEach(function (f) {
      host.appendChild(makeInfoRow(item, f));
    });
  }

  function makeInfoRow(item, f) {
    var row = document.createElement("div");
    row.className = "info-row";

    var lbl = document.createElement("input");
    lbl.type = "text";
    lbl.setAttribute("placeholder", t("item.info.label"));
    lbl.value = f.label;
    lbl.autocomplete = "off";
    lbl.addEventListener("input", function () { f.label = lbl.value; });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.setAttribute("placeholder", t("item.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () { f.value = val.value; });
    row.appendChild(val);

    var x = document.createElement("button");
    x.type = "button";
    x.className = "row-x";
    x.setAttribute("aria-label", t("item.info.add"));
    x.title = t("item.info.add");
    x.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", function () {
      item.info = item.info.filter(function (r) { return r !== f; });
      save(); scheduleRender();
      renderInfoRows(item);
    });
    row.appendChild(x);

    return row;
  }

  function addInfoRow() {
    var item = editingItem();
    if (!item) return;
    item.info.push({ id: uid(), label: "", value: "" });
    save();
    renderInfoRows(item);
    var rows = $("f-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector("input");
      if (l) l.focus();
    }
  }

  // Flush typed-but-unsaved text when the item dialog closes by ANY
  // path (Save button, Esc) — nothing is ever lost. Structural label/
  // info changes are saved at the moment of the click, Kanban-style.
  $("dlg-item").addEventListener("close", function () {
    if (editingListId === null) return;
    var item = editingItem();
    editingListId = null;
    editingItemId = null;
    if (!item) return;
    item.info = (item.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
    item.text  = $("f-text").value.trim() || item.text;
    item.due   = $("f-due").value || null;
    item.notes = $("f-notes").value;
    item.recurrence = readRecFromFields("f-");
    save(); scheduleRender();
  });

  // ---------- 8. List settings dialog ----------
  function openListDialog(listId) {
    var list = listById(listId);
    if (!list) return;

    editingListId = listId;
    editingItemId = null;

    $("l-name").value = list.name;
    var hasRec = !!list.recurrence;
    setRadio("l-rec", hasRec ? "on" : "none");
    $("rec-editor-list").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("l-", list.recurrence);

    updateNextResetLabel(list);

    $("dlg-list").showModal();
    setTimeout(function () { $("l-name").focus(); }, 50);
  }

  function updateNextResetLabel(list) {
    var el = $("l-next-reset");
    if (list.recurrence && list.nextReset) {
      var d = isoToDate(list.nextReset);
      el.textContent = t("recur.list.next") + " " +
        d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
                             { day: "numeric", month: "short", year: "numeric" });
    } else {
      el.textContent = "";
    }
  }

  function createList() {
    var list = newListObj(t("new.list"));
    state.lists.push(list);
    state.activeList = list.id;
    save(); scheduleRender();
    openListDialog(list.id);      // straight into settings to name it
  }

  // ---------- 9. Item drag & drop reorder ----------
  var DRAG_SVG =
    '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">' +
    '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>' +
    '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
    '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';

  var RECUR_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

  function makeDragHandle(list, item) {
    var h = document.createElement("span");
    h.className = "drag-handle";
    h.setAttribute("title", t("drag.reorder"));
    h.setAttribute("aria-label", t("drag.reorder"));
    h.innerHTML = DRAG_SVG;

    h.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      startDrag(h.closest(".item"), list, item, e);
    });
    return h;
  }

  // Pointer-based (mouse + touch unified). While dragging we only
  // decorate the DOM; the array is touched once, on drop.
  function startDrag(li, list, item, e) {
    var rows = [].slice.call(document.querySelectorAll("#items .item"));
    li.classList.add("dragging");
    document.body.classList.add("is-dragging");

    function clearMarks() {
      rows.forEach(function (el) {
        el.classList.remove("drag-over-above", "drag-over-below");
      });
    }

    function hitTest(y) {
      var inside = null, nearest = null, bestDist = Infinity;
      rows.forEach(function (el) {
        if (el === li) return;
        var r = el.getBoundingClientRect();
        var cy = r.top + r.height / 2;
        if (y >= r.top && y <= r.bottom) inside = el;
        var dist = Math.abs(y - cy);
        if (dist < bestDist) { bestDist = dist; nearest = el; }
      });
      return inside || nearest;
    }

    function onMove(ev) {
      clearMarks();
      var target = hitTest(ev.clientY);
      if (!target || target === li) return;
      var r = target.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) target.classList.add("drag-over-above");
      else                                  target.classList.add("drag-over-below");
    }

    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);

      var target = hitTest(ev.clientY);
      li.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      clearMarks();

      if (!target || target === li) return;      // dropped nowhere useful

      var before = ev.clientY < target.getBoundingClientRect().top +
                           target.getBoundingClientRect().height / 2;

      // Build the visible order, splice the dragged item in, then
      // append any items the filter hid (keeps them, at the end).
      var ids = rows.map(function (el) { return el.dataset.id; })
                    .filter(function (id) { return id !== item.id; });
      var ti = ids.indexOf(target.dataset.id);
      if (ti === -1) return;
      ids.splice(before ? ti : ti + 1, 0, item.id);

      var byId = {};
      list.items.forEach(function (it) { byId[it.id] = it; });
      var reordered = [];
      ids.forEach(function (id) {
        if (byId[id]) { reordered.push(byId[id]); delete byId[id]; }
      });
      Object.keys(byId).forEach(function (k) { reordered.push(byId[k]); });
      list.items = reordered;

      save(); scheduleRender();
    }

    function onCancel() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      li.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      clearMarks();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // ---------- 9b. Tab drag reorder ----------
  // Same contract as the Kanban column reorder: pointer-based,
  // threshold-gated with horizontal bias (vertical = native scroll
  // passthrough). The pencil is excluded via closest('.t-rename').
  var TAB_DRAG_THRESHOLD = 8;

  function attachTabDrag(tabEl, list) {
    tabEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest(".t-rename")) return;
      if ($("dlg-item").open || $("dlg-list").open) return;
      if (state.lists.length < 2) return;        // nothing to reorder

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        tabEl.classList.add("drag-src");
        document.body.classList.add("is-dragging-tab");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".tab.drag-over-left, .tab.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-left", "drag-over-right");
        }
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          // horizontal bias: vertical drags stay with the browser
          if (Math.abs(dx) < TAB_DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
          beginDrag();
        }
        ev.preventDefault();
        clearMarks();

        var tabs = [].slice.call(document.querySelectorAll("#tabs .tab"));
        var target = null, bestDist = Infinity;
        tabs.forEach(function (tb) {
          if (tb === tabEl) return;
          var r = tb.getBoundingClientRect();
          var cx = r.left + r.width / 2;
          var dist = Math.abs(ev.clientX - cx);
          if (dist < bestDist) { bestDist = dist; target = tb; }
        });
        if (!target) return;
        var r = target.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) target.classList.add("drag-over-left");
        else                                   target.classList.add("drag-over-right");
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        // compute target BEFORE clearing marks (class needed? no —
        // recompute honestly from geometry, like item drag)
        var target = null, bestDist = Infinity;
        var tabs = [].slice.call(document.querySelectorAll("#tabs .tab"));
        tabs.forEach(function (tb) {
          if (tb === tabEl) return;
          var r = tb.getBoundingClientRect();
          var cx = r.left + r.width / 2;
          var dist = Math.abs(ev.clientX - cx);
          if (dist < bestDist) { bestDist = dist; target = tb; }
        });

        tabEl.classList.remove("drag-src");
        document.body.classList.remove("is-dragging-tab");
        clearMarks();

        if (started && target && target.dataset.listId) {
          var r = target.getBoundingClientRect();
          var before = ev.clientX < r.left + r.width / 2;
          moveListById(list, target.dataset.listId, before);
        }
        if (started) { save(); scheduleRender(); }
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          tabEl.classList.remove("drag-src");
          document.body.classList.remove("is-dragging-tab");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  function moveListById(srcList, targetListId, before) {
    var targetList = listById(targetListId);
    if (!targetList || targetList === srcList) return;

    var from = state.lists.indexOf(srcList);
    if (from === -1) return;
    state.lists.splice(from, 1);

    var to = state.lists.indexOf(targetList);
    if (to === -1) {                     // paranoia — restore source
      state.lists.splice(from, 0, srcList);
      return;
    }
    state.lists.splice(before ? to : to + 1, 0, srcList);
  }

  // ---------- 10. Label helpers ----------
  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }

  function updateFilterBtn() {
    var btn = $("filter-btn");
    var badge = $("filter-count");
    if (!btn || !badge) return;
    if (activeFilters.length > 0) {
      btn.classList.add("has-filters");
      badge.textContent = String(activeFilters.length);
      badge.hidden = false;
    } else {
      btn.classList.remove("has-filters");
      badge.hidden = true;
    }
  }

  function renderFilterPop() {
    var pop = $("filter-pop");
    pop.innerHTML = "";

    if (state.labels.length === 0) {
      var e = document.createElement("div");
      e.className = "fl-empty";
      e.textContent = t("filter.empty");
      pop.appendChild(e);
      return;
    }

    state.labels.forEach(function (label) {
      var item = document.createElement("div");
      item.className = "fl-item";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = activeFilters.indexOf(label.id) !== -1;
      cb.addEventListener("change", function () {
        var at = activeFilters.indexOf(label.id);
        if (cb.checked && at === -1) activeFilters.push(label.id);
        if (!cb.checked && at !== -1) activeFilters.splice(at, 1);
        updateFilterBtn();
        scheduleRender();
      });
      item.appendChild(cb);

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      item.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      item.appendChild(name);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "fl-del";
      del.setAttribute("aria-label", t("filter.del"));
      del.title = t("filter.del");
      del.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (!confirm(t("confirm.lbldel"))) return;
        deleteLabel(label.id);
      });
      item.appendChild(del);

      pop.appendChild(item);
    });
  }

  // Deleting a label detaches it everywhere and clears it from active
  // filters → no orphan ids, no ghost filter entries.
  function deleteLabel(labelId) {
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        item.labels = (item.labels || []).filter(function (id) { return id !== labelId; });
      });
    });
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var item = editingItem();
    if (item) renderItemLabels(item);
    showToast(t("toast.labeldel"), false);
  }

  // ---------- 11. Undo / toast ----------
  var undoSnapshot = null;
  var toastTimer = null;

  function pushUndo(key) {
    undoSnapshot = JSON.stringify(state);
    showToast(t(key), true);
  }

  function doUndo() {
    if (!undoSnapshot) return;
    state = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    save(); renderAll();
    showToast(t("toast.undone"), false);
  }

  function showToast(text, withUndo) {
    var el = $("toast");
    el.innerHTML = "";
    el.classList.remove("show");

    var span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);

    if (withUndo) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t("undo");
      b.addEventListener("click", doUndo);
      el.appendChild(b);
    }

    void el.offsetWidth;               // restart transition
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  // ---------- 12. Sync slice + palette inheritance ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone (direct) open — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("todo", sliceGet, sliceSet, "oros-todo-data");
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.lists) || data.lists.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyListCycles();               // may fast-forward missed cycles
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // activeList must point at something that exists
    var ok = state.lists.some(function (l) { return l.id === state.activeList; });
    if (!ok) state.activeList = state.lists[0].id;

    scheduleRender();
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // Quick-add
    $("quick-add").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
    });
    $("quick-add-btn").addEventListener("click", function () {
      quickAdd();
      $("quick-add").focus();
    });

    // Controls
    $("hide-completed").addEventListener("change", function () {
      state.hideCompleted = this.checked;
      save(); scheduleRender();
    });
    $("clear-completed").addEventListener("click", function () {
      var list = activeList();
      var had = list.items.some(function (it) { return it.done; });
      if (!had) return;
      pushUndo("toast.cleared");
      list.items = list.items.filter(function (it) { return !it.done; });
      save(); scheduleRender();
    });
    $("list-settings").addEventListener("click", function () {
      openListDialog(activeList().id);
    });

    // New list
    $("tab-add").addEventListener("click", createList);

    // --- Global search ---
    $("search").addEventListener("input", function () {
      searchQuery = this.value.trim().toLowerCase();
      $("search-clear").hidden = !searchQuery;
      scheduleRender();
    });
    $("search-clear").addEventListener("click", function () {
      $("search").value = "";
      searchQuery = "";
      $("search-clear").hidden = true;
      scheduleRender();
      $("search").focus();
    });

    // --- Label filter popover ---
    $("filter-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("filter-pop");
      pop.hidden = !pop.hidden;
      if (!pop.hidden) renderFilterPop();
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#filter-slot")) {
        $("filter-pop").hidden = true;
      }
    });

    // --- Item dialog: labels ---
    $("f-lbl-toggle").addEventListener("click", function () {
      var picker = $("f-lbl-picker");
      if (picker.hidden) {
        renderLblPicker();
        renderLblSwatches();
        picker.hidden = false;
      } else {
        picker.hidden = true;
      }
    });
    $("f-lbl-new-add").addEventListener("click", createNewLabel);
    $("f-lbl-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); createNewLabel(); }
    });

    // --- Item dialog: extra info ---
    $("f-info-add").addEventListener("click", addInfoRow);

    // --- Item dialog submit (form-validation path) ---
    var itemForm = $("item-form");
    itemForm.addEventListener("submit", function (e) {
      e.preventDefault();
      // Actual persistence happens in the dialog 'close' handler,
      // which also covers the Esc path. Close here = commit there.
      $("dlg-item").close();
    });
    $("f-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.itemdel"))) return;
      var list = listById(editingListId);
      if (list) {
        pushUndo("toast.deleted");
        list.items = list.items.filter(function (it) { return it.id !== editingItemId; });
        editingListId = null;          // skip the close-flush — item is gone
        editingItemId = null;
        save(); scheduleRender();
      }
      $("dlg-item").close();
    });
    [].forEach.call(document.getElementsByName("f-rec"), function (r) {
      r.addEventListener("change", function () {
        $("rec-editor").style.display =
          getRadio("f-rec") === "on" ? "flex" : "none";
      });
    });
    $("f-unit").addEventListener("change", function () {
      $("f-weekday").disabled = this.value !== "week";
    });

    // --- List dialog ---
    var listForm = $("list-form");
    listForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var list = listById(editingListId);
      if (!list) { $("dlg-list").close(); return; }

      var name = $("l-name").value.trim();
      if (!name) return;

      list.name = name;
      var newRec = readRecFromFields("l-");

      // Recurrence changed → re-anchor the cycle from today
      if (JSON.stringify(newRec) !== JSON.stringify(list.recurrence)) {
        list.recurrence = newRec;
        list.lastReset = null;
        list.nextReset = null;
        window.__orosSyncApi._suppress = true;
        try { applyListCycles(); } finally {
          window.__orosSyncApi._suppress = false;
        }
      }

      save(); scheduleRender();
      $("dlg-list").close();
    });
    $("l-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.listdel"))) return;
      pushUndo("toast.listdel");
      state.lists = state.lists.filter(function (l) { return l.id !== editingListId; });
      if (state.lists.length === 0) {
        var fresh = newListObj(t("new.list"));
        state.lists.push(fresh);
        state.activeList = fresh.id;
      } else if (!state.lists.some(function (l) { return l.id === state.activeList; })) {
        state.activeList = state.lists[0].id;
      }
      save(); scheduleRender();
      $("dlg-list").close();
    });
    [].forEach.call(document.getElementsByName("l-rec"), function (r) {
      r.addEventListener("change", function () {
        $("rec-editor-list").style.display =
          getRadio("l-rec") === "on" ? "flex" : "none";
      });
    });
    $("l-unit").addEventListener("change", function () {
      $("l-weekday").disabled = this.value !== "week";
    });
  }

  function boot() {
    document.documentElement.setAttribute("lang", LANG);
    applyI18n();
    populateWeekdaySelects();
    load();
    wire();
    registerSync();       // must come AFTER load(): sliceGet reads state
    inheritPalette();
    watchPalette();
    scheduleRender();
  }

  boot();
})();