// ============================================================
// orOS To-Do — App logic (v0.1)
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, IDs
//   3. Recurrence date math + list-cycle engine
//   4. Render: tabs
//   5. Render: items
//   6. Quick-add (natural date parsing)
//   7. Item detail dialog
//   8. List settings dialog
//   9. Drag & drop reorder
//  10. Undo / toast
//  11. Sync slice (Dropbox) + palette inheritance
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-todo-data";
  var DATA_VER = 1;

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
      "toast.deleted": "Deleted",
      "toast.undone":  "Restored",
      "toast.cleared": "Completed items cleared",
      "toast.listdel": "List deleted",
      "undo":          "Undo",
      "confirm.listdel": "Delete this list and all its tasks?",
      "confirm.itemdel": "Delete this task?",
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
      "toast.deleted": "Διαγράφηκε",
      "toast.undone":  "Επαναφέρθηκε",
      "toast.cleared": "Καθαρίστηκαν οι ολοκληρωμένες εργασίες",
      "toast.listdel": "Η λίστα διαγράφηκε",
      "undo":          "Αναίρεση",
      "confirm.listdel": "Διαγραφή λίστας και όλων των εργασιών της;",
      "confirm.itemdel": "Διαγραφή αυτής της εργασίας;",
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

  // ---------- 2. Data model & storage ----------
  // state = {
  //   ver: 1,
  //   activeList: <listId>,
  //   hideCompleted: bool,
  //   lists: [{
  //     id, name,
  //     recurrence: null | {every, unit, weekday},
  //     lastReset: iso, nextReset: iso,
  //     items: [{ id, text, done, due, notes,
  //               recurrence: null | {every, unit, weekday} }]
  //   }]
  // }
  var state = null;
  var renderQueued = false;

  function defaultState() {
    var first = newListObj(LANG === "el" ? "Γénéral" : "General");
    var work   = newListObj(LANG === "el" ? "Για ψώνια" : "Groceries");
    return {
      ver: DATA_VER,
      activeList: first.id,
      hideCompleted: false,
      lists: [first, work]
    };
  }

  function newListObj(name) {
    return { id: uid(), name: name, recurrence: null,
             lastReset: null, nextReset: null, items: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.ver === DATA_VER && Array.isArray(data.lists)) {
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

  // The sync engine registers its own dirty-marker; wired in section 11.
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
    return state.lists[0];      // fallback (shouldn't happen; guarded in boot)
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
    // weeks with a fixed weekday are anchored to the weekday
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
    var base = item.due ? isoToDate(item.due) : isoToDate(todayISO());
    var anchor = base > new Date() ? new Date() : new Date();   // now
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
      b.textContent = list.name;

      var od = overdueCount(list);
      if (od > 0) {
        var chip = document.createElement("span");
        chip.className = "chip overdue";
        chip.textContent = String(od);
        b.appendChild(chip);
      }
      b.addEventListener("dblclick", function () { openListDialog(list.id); });
      b.addEventListener("click", function () {
        if (state.activeList === list.id) return;
        state.activeList = list.id;
        save(); scheduleRender();
      });
      tabs.appendChild(b);
    });
  }

  // ---------- 5. Render: items ----------
  function renderItems() {
    var list = activeList();
    var ul = $("items");
    ul.innerHTML = "";
    $("empty").hidden = !(list.items.length === 0);

    list.items.forEach(function (item, index) {
      if (state.hideCompleted && item.done) return;

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

      // body (text + meta) — click opens detail dialog
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

      var hasMeta = item.due || item.recurrence;
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
          rec.className = "chip-recur";
          rec.textContent = "⟳ " + recurShort(item.recurrence);
          meta.appendChild(rec);
        }
        body.appendChild(meta);
      }

      body.addEventListener("click", function () { openItemDialog(list.id, item.id); });
      li.appendChild(body);

      // drag handle
      li.appendChild(makeDragHandle(list, index));

      ul.appendChild(li);
    });
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
  // Scans trailing tokens for date words ("tomorrow", "friday",
  // "αύριο", "παρασκευή"…). Parsed words are consumed, the rest is
  // the task text.
  function parseQuickAdd(raw) {
    var tokens = raw.trim().split(/\s+/);
    var due = null;
    var weekdayHit = null;

    // scan every token (dates might be anywhere, "call bob friday")
    var kept = tokens.filter(function (tok) {
      var n = normalize(tok);
      if (WORD_TODAY[n]) { due = todayISO(); return false; }
      if (WORD_TOMORROW[n]) {
        var d = isoToDate(todayISO());
        d.setDate(d.getDate() + 1);
        due = dateToISO(d);
        return false;
      }
      if (WEEKDAY_WORDS[n] !== undefined) {       // takes precedence over today
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
    var list = null, item = null;
    state.lists.forEach(function (l) {
      if (l.id !== listId) return;
      list = l;
      l.items.forEach(function (it) { if (it.id === itemId) item = it; });
    });
    if (!list || !item) return;

    editingListId = listId;
    editingItemId = itemId;

    $("f-text").value  = item.text;
    $("f-due").value   = item.due || "";
    $("f-notes").value = item.notes || "";

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

  // ---------- 8. List settings dialog ----------
  function openListDialog(listId) {
    var list = null;
    state.lists.forEach(function (l) { if (l.id === listId) list = l; });
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

  // ---------- 9. Drag & drop reorder ----------
  var DRAG_SVG =
    '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">' +
    '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>' +
    '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
    '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';

  function makeDragHandle(list, index) {
    var h = document.createElement("span");
    h.className = "drag-handle";
    h.setAttribute("title", t("drag.reorder"));
    h.setAttribute("aria-label", t("drag.reorder"));
    h.innerHTML = DRAG_SVG;

    var item = list.items[index];
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

      var before = target.classList.contains("drag-over-above");
      // (classList was just cleared — recompute honestly:)
      before = ev.clientY < target.getBoundingClientRect().top +
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

  // ---------- 10. Undo / toast ----------
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

    // restart transition
    void el.offsetWidth;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  // ---------- 11. Sync slice + palette inheritance ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  // The app lives in a same-origin iframe: it reads the shell's
  // computed palette and mirrors it — skin/theme changes in the
  // shell repaint the app instantly (MutationObserver below).
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
    if (!api || typeof api.registerSlice !== "function") return;

    // Bridge consumed by save() (section 2). The suppression flag is
    // what makes pulls safe: applying remote data never re-marks
    // dirty → no pull→push→pull loop.
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    api.registerSlice("todo", sliceGet, sliceSet, "oros-todo-data");
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data) {
    if (!data || data.ver !== DATA_VER ||
        !Array.isArray(data.lists) || data.lists.length === 0) return;

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

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < p.length; j++) {
      p[j].setAttribute("placeholder", t(p[j].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // Quick-add
    $("quick-add").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
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

    // --- Item dialog ---
    var itemForm = $("item-form");
    itemForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var list = null, item = null;
      state.lists.forEach(function (l) {
        if (l.id !== editingListId) return;
        list = l;
        l.items.forEach(function (it) { if (it.id === editingItemId) item = it; });
      });
      if (!list || !item) { $("dlg-item").close(); return; }

      var text = $("f-text").value.trim();
      if (!text) return;

      item.text  = text;
      item.due   = $("f-due").value || null;
      item.notes = $("f-notes").value;
      item.recurrence = readRecFromFields("f-");

      save(); scheduleRender();
      $("dlg-item").close();
    });
    $("f-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.itemdel"))) return;
      var list = state.lists.filter(function (l) { return l.id === editingListId; })[0];
      if (list) {
        pushUndo("toast.deleted");
        list.items = list.items.filter(function (it) { return it.id !== editingItemId; });
        save(); scheduleRender();
      }
      $("dlg-item").close();
    });
    document.getElementsByName("f-rec").forEach = [].forEach;
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
      var list = state.lists.filter(function (l) { return l.id === editingListId; })[0];
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