// ============================================================
// orOS Kanban — App logic (v0.2, Wave 1)
// New in v0.2:
//   - Subtasks (checkbox checklist + progress chip on card)
//   - Extra info (free key-value fields per card)
//   - Duplicate card
//   - DATA_VER 1 → 2 migration (additive, zero data loss)
//   - Card dialog is live-editing (mutations save instantly;
//     text/notes are flushed on dialog close — no keystroke spam)
// Δομή ενοτήτων (Sections):
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration
//   3. Render: columns + cards (subtask chip / info preview)
//   4. Quick-add (per column)
//   5. Card dialog (live editing: subtasks, info, duplicate)
//   6. Column dialog
//   7. Drag & drop (within + across columns, pointer-based)
//   8. Undo / toast
//   9. Sync slice (Dropbox) + palette inheritance
//  10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-kanban-data";
  var DATA_VER = 2;

  // ---------- 1. Constants, i18n, helpers ----------
  // Language comes from the shell (same-origin, shared localStorage).
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "board.title":     "Kanban",
      "col.add":         "Add column",
      "col.add.title":   "Add column",
      "empty.title":     "No columns yet",
      "empty.hint":      "Add your first column with the button above.",
      "quick.add":       "Add a card…",
      "card.title":      "Card",
      "card.text":       "Text",
      "card.notes":      "Notes",
      "card.subtasks":   "Subtasks",
      "card.subph":      "New subtask…",
      "card.subadd":     "Add subtask",
      "card.info":       "Extra info",
      "card.info.add":   "Add field",
      "card.info.label": "Field",
      "card.info.value": "Value",
      "card.delete":     "Delete",
      "card.duplicate":  "Duplicate",
      "dup.suffix":      " (copy)",
      "toast.duplicated":"Duplicated",
      "save":            "Save",
      "col.settings":    "Column settings",
      "col.name":        "Name",
      "col.delete":      "Delete column",
      "toast.deleted":   "Deleted",
      "toast.undone":    "Restored",
      "toast.coldel":    "Column deleted",
      "undo":            "Undo",
      "confirm.carddel": "Delete this card?",
      "confirm.coldel":  "Delete this column and all its cards?",
      "new.col":         "New column"
    },
    el: {
      "board.title":     "Kanban",
      "col.add":         "Προσθήκη στήλης",
      "col.add.title":   "Προσθήκη στήλης",
      "empty.title":     "Δεν υπάρχουν στήλες ακόμα",
      "empty.hint":      "Πρόσθεσε την πρώτη σου στήλη με το κουμπί παραπάνω.",
      "quick.add":       "Προσθήκη κάρτας…",
      "card.title":      "Κάρτα",
      "card.text":       "Κείμενο",
      "card.notes":      "Σημειώσεις",
      "card.subtasks":   "Υπο-εργασίες",
      "card.subph":      "Νέα υπο-εργασία…",
      "card.subadd":     "Προσθήκη υπο-εργασίας",
      "card.info":       "Επιπλέον στοιχεία",
      "card.info.add":   "Προσθήκη πεδίου",
      "card.info.label": "Πεδίο",
      "card.info.value": "Τιμή",
      "card.delete":     "Διαγραφή",
      "card.duplicate":  "Αντίγραφο",
      "dup.suffix":      " (αντίγραφο)",
      "toast.duplicated":"Αντιγράφηκε",
      "save":            "Αποθήκευση",
      "col.settings":    "Ρυθμίσεις στήλης",
      "col.name":        "Όνομα",
      "col.delete":      "Διαγραφή στήλης",
      "toast.deleted":   "Διαγράφηκε",
      "toast.undone":    "Επαναφέρθηκε",
      "toast.coldel":    "Η στήλη διαγράφηκε",
      "undo":            "Αναίρεση",
      "confirm.carddel": "Διαγραφή αυτής της κάρτας;",
      "confirm.coldel":  "Διαγραφή στήλης και όλων των καρτών της;",
      "new.col":         "Νέα στήλη"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }

  // ---------- 2. Data model, storage, migration ----------
  // state = {
  //   ver: 2,
  //   columns: [{
  //     id, name,
  //     cards: [{
  //       id, text, notes,
  //       subtasks: [{ id, text, completed }],
  //       info:     [{ id, label, value }]
  //     }]
  //   }]
  // }
  var state = null;
  var renderQueued = false;

  // Additive migration: bring ANY older/missing shape up to DATA_VER.
  // Missing subtasks/info arrays are filled with empty ones — never
  // destructive, so old backups, v1 slices and v2 data all load alike.
  function migrate(data) {
    if (!data || !Array.isArray(data.columns)) return null;
    data.columns.forEach(function (col) {
      if (!Array.isArray(col.cards)) col.cards = [];
      col.cards.forEach(function (card) {
        if (!Array.isArray(card.subtasks)) card.subtasks = [];
        if (!Array.isArray(card.info)) card.info = [];
      });
    });
    data.ver = DATA_VER;
    return data;
  }

  function defaultState() {
    var names = LANG === "el"
      ? ["Εκκρεμεί", "Σε εξέλιξη", "Ολοκληρωμένα"]
      : ["To Do", "Doing", "Done"];
    return {
      ver: DATA_VER,
      columns: names.map(function (n) { return newColumnObj(n); })
    };
  }

  function newColumnObj(name) {
    return { id: uid(), name: name, cards: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.columns) && data.columns.length > 0) {
          state = data;
          save();                       // persist migrated shape
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

  function colById(id) {
    for (var i = 0; i < state.columns.length; i++) {
      if (state.columns[i].id === id) return state.columns[i];
    }
    return null;
  }

  function cardById(col, cardId) {
    if (!col) return null;
    for (var i = 0; i < col.cards.length; i++) {
      if (col.cards[i].id === cardId) return col.cards[i];
    }
    return null;
  }

  // ---------- 3. Render: columns + cards ----------
  function renderAll() {
    var host = $("columns");
    host.innerHTML = "";
    $("empty").hidden = !(state.columns.length === 0);

    state.columns.forEach(function (col) {
      host.appendChild(makeColumnEl(col));
    });
  }

  function makeColumnEl(col) {
    var el = document.createElement("div");
    el.className = "k-col";
    el.dataset.colId = col.id;

    // Head: title (dblclick → rename) + card count
    var head = document.createElement("div");
    head.className = "col-head";

    var title = document.createElement("span");
    title.className = "col-title";
    title.textContent = col.name;
    title.title = col.name;               // full name on hover if truncated
    title.addEventListener("dblclick", function () { openColDialog(col.id); });
    head.appendChild(title);

    var count = document.createElement("span");
    count.className = "col-count";
    count.textContent = String(col.cards.length);
    head.appendChild(count);

    el.appendChild(head);

    // Body: the cards
    var body = document.createElement("div");
    body.className = "col-body";
    col.cards.forEach(function (card) {
      body.appendChild(makeCardEl(col, card));
    });
    el.appendChild(body);

    // Foot: quick-add (input + mouse-friendly button)
    var foot = document.createElement("div");
    foot.className = "col-foot";

    var quick = document.createElement("input");
    quick.type = "text";
    quick.className = "col-quick";
    quick.setAttribute("placeholder", t("quick.add"));
    quick.autocomplete = "off";
    quick.spellcheck = false;
    quick.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(col, quick); }
    });
    foot.appendChild(quick);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "col-add-btn";
    addBtn.setAttribute("aria-label", t("quick.add"));
    addBtn.title = t("quick.add");
    addBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    addBtn.addEventListener("click", function () {
      quickAdd(col, quick);
      quick.focus();
    });
    foot.appendChild(addBtn);

    el.appendChild(foot);
    return el;
  }

  function makeCardEl(col, card) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "card";
    el.dataset.cardId = card.id;

    var text = document.createElement("div");
    text.className = "text";
    text.textContent = card.text;
    el.appendChild(text);

    if (card.notes) {
      var prev = document.createElement("div");
      prev.className = "notes-preview";
      prev.textContent = card.notes;
      el.appendChild(prev);
    }

    // Subtask progress chip: "x/y" + slim bar (only when subtasks exist)
    if (card.subtasks && card.subtasks.length > 0) {
      var done = 0;
      card.subtasks.forEach(function (s) { if (s.completed) done++; });
      var pct = Math.round((done / card.subtasks.length) * 100);

      var ind = document.createElement("div");
      ind.className = "sub-ind";
      ind.appendChild(document.createTextNode(done + "/" + card.subtasks.length));

      var bar = document.createElement("span");
      bar.className = "bar";
      var fill = document.createElement("span");
      fill.className = "fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      ind.appendChild(bar);
      el.appendChild(ind);
    }

    // Extra info preview: one dim, truncated line of "label: value · …"
    var infoParts = [];
    (card.info || []).forEach(function (f) {
      var l = (f.label || "").trim();
      var v = (f.value || "").trim();
      if (l && v) infoParts.push(l + ": " + v);
    });
    if (infoParts.length > 0) {
      var ip = document.createElement("div");
      ip.className = "info-preview";
      ip.textContent = infoParts.join("  ·  ");
      el.appendChild(ip);
    }

    el.addEventListener("click", function () { openCardDialog(col.id, card.id); });
    attachCardDrag(el, col, card);
    return el;
  }

  // ---------- 4. Quick-add ----------
  function quickAdd(col, input) {
    var raw = input.value.trim();
    if (!raw) return;
    col.cards.unshift({
      id: uid(), text: raw, notes: "",
      subtasks: [], info: []
    });
    input.value = "";
    save(); scheduleRender();
    // Re-focus the fresh input (render replaced the old node)
    var fresh = findQuickInput(col.id);
    if (fresh) fresh.focus();
  }

  function findQuickInput(colId) {
    var cols = document.querySelectorAll(".k-col");
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].dataset.colId === colId) {
        return cols[i].querySelector(".col-quick");
      }
    }
    return null;
  }

  // ---------- 5. Card dialog (live editing) ----------
  var editingColId = null;
  var editingCardId = null;

  // Small helper: the card currently open in the dialog (or null).
  function editingCard() {
    return cardById(colById(editingColId), editingCardId);
  }

  function openCardDialog(colId, cardId) {
    var col = colById(colId);
    if (!col) return;
    var card = cardById(col, cardId);
    if (!card) return;

    editingColId = colId;
    editingCardId = cardId;

    $("c-text").value = card.text;
    $("c-notes").value = card.notes || "";

    renderSubtasks(card);
    renderInfo(card);

    $("dlg-card").showModal();
    setTimeout(function () { $("c-text").focus(); }, 50);
  }

  // Live-editing model:
  //   - structural changes (check / add / remove row) → save() + render NOW
  //   - typing in text fields → in-memory only, flushed on dialog close
  //     (dialog 'close' fires for submit AND for Esc — nothing is ever lost)

  function renderSubtasks(card) {
    var host = $("c-sub-list");
    host.innerHTML = "";
    card.subtasks.forEach(function (sub) {
      host.appendChild(makeSubRow(card, sub));
    });
  }

  function makeSubRow(card, sub) {
    var row = document.createElement("div");
    row.className = "sub-row";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sub.completed;
    cb.addEventListener("change", function () {
      sub.completed = cb.checked;
      txt.classList.toggle("completed", cb.checked);
      save(); scheduleRender();
    });
    row.appendChild(cb);

    var txt = document.createElement("input");
    txt.type = "text";
    txt.className = "s-text" + (sub.completed ? " completed" : "");
    txt.value = sub.text;
    txt.autocomplete = "off";
    txt.addEventListener("input", function () { sub.text = txt.value; });
    row.appendChild(txt);

    row.appendChild(makeRemoveBtn(function () {
      card.subtasks = card.subtasks.filter(function (s) { return s !== sub; });
      save(); scheduleRender();
      renderSubtasks(card);
    }));

    return row;
  }

  function makeRemoveBtn(onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sub-x info-x";
    b.setAttribute("aria-label", t("card.delete"));
    b.title = t("card.delete");
    b.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    b.addEventListener("click", onClick);
    return b;
  }

  function addSubtask() {
    var card = editingCard();
    if (!card) return;
    var input = $("c-sub-new");
    var raw = input.value.trim();
    if (!raw) return;
    card.subtasks.push({ id: uid(), text: raw, completed: false });
    input.value = "";
    save(); scheduleRender();
    renderSubtasks(card);
    input.focus();
  }

  function renderInfo(card) {
    var host = $("c-info-list");
    host.innerHTML = "";
    card.info.forEach(function (f) {
      host.appendChild(makeInfoRow(card, f));
    });
  }

  function makeInfoRow(card, f) {
    var row = document.createElement("div");
    row.className = "info-row";

    var lbl = document.createElement("input");
    lbl.type = "text";
    lbl.className = "i-label";
    lbl.setAttribute("placeholder", t("card.info.label"));
    lbl.value = f.label;
    lbl.autocomplete = "off";
    lbl.addEventListener("input", function () { f.label = lbl.value; });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.className = "i-value";
    val.setAttribute("placeholder", t("card.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () { f.value = val.value; });
    row.appendChild(val);

    row.appendChild(makeRemoveBtn(function () {
      card.info = card.info.filter(function (x) { return x !== f; });
      save(); scheduleRender();
      renderInfo(card);
    }));

    return row;
  }

  function addInfo() {
    var card = editingCard();
    if (!card) return;
    card.info.push({ id: uid(), label: "", value: "" });
    save();
    renderInfo(card);
    // focus the fresh label so the user can type right away
    var rows = $("c-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector(".i-label");
      if (l) l.focus();
    }
  }

  // Duplicate: deep clone (fresh ids everywhere), "(copy)" suffix,
  // placed right after the original in the same column.
  function duplicateCard() {
    var col = colById(editingColId);
    var card = editingCard();
    if (!col || !card) return;

    var copy = JSON.parse(JSON.stringify(card));
    copy.id = uid();
    copy.text = card.text + t("dup.suffix");
    copy.subtasks.forEach(function (s) { s.id = uid(); });
    copy.info.forEach(function (f) { f.id = uid(); });

    var idx = col.cards.indexOf(card);
    col.cards.splice(idx + 1, 0, copy);

    save(); scheduleRender();
    showToast(t("toast.duplicated"), false);
  }

  // Flush typed-but-unsaved text when the dialog closes by ANY path
  // (Save button, Esc, backdrop policy) — guarantees no data loss.
  $("dlg-card").addEventListener("close", function () {
    if (editingColId === null) return;
    var card = editingCard();
    editingColId = null;
    editingCardId = null;
    if (!card) return;
    save(); scheduleRender();
  });

  // ---------- 6. Column dialog ----------
  function openColDialog(colId) {
    var col = colById(colId);
    if (!col) return;

    editingColId = colId;
    editingCardId = null;

    $("col-name").value = col.name;

    $("dlg-col").showModal();
    setTimeout(function () { $("col-name").focus(); }, 50);
  }

  function createColumn() {
    var col = newColumnObj(t("new.col"));
    state.columns.push(col);
    save(); scheduleRender();
    openColDialog(col.id);     // straight into settings to name it
  }

  // ---------- 7. Drag & drop ----------
  // Pointer-based, threshold-gated: a plain tap never starts a drag
  // (the click → dialog keeps working). Vertical touch movement
  // scrolls the column list (touch-action: pan-y); horizontal
  // movement belongs to us → cross-column drag.
  var DRAG_THRESHOLD = 8;

  function attachCardDrag(el, col, card) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;   // primary only
      // never start a drag from inside the open dialog's inputs
      if ($("dlg-card").open) return;

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        el.classList.add("dragging");
        el.style.pointerEvents = "none";   // elementFromPoint sees THROUGH us
        document.body.classList.add("is-dragging");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".drag-over-above, .drag-over-below, .k-col.drag-over");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below", "drag-over");
        }
      }

      function mark(x, y) {
        clearMarks();
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest) return;
        var cardEl = hit.closest(".card");
        if (cardEl && cardEl !== el) {
          var r = cardEl.getBoundingClientRect();
          if (y < r.top + r.height / 2) cardEl.classList.add("drag-over-above");
          else                          cardEl.classList.add("drag-over-below");
          return;
        }
        var colEl = hit.closest(".k-col");
        if (colEl && colEl.dataset.colId !== col.id) colEl.classList.add("drag-over");
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          beginDrag();
        }
        ev.preventDefault();
        mark(ev.clientX, ev.clientY);
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        if (!started) return;              // was a tap — nothing to undo

        // Compute destination FIRST (our pointer-events hack still active)
        var hit = document.elementFromPoint(ev.clientX, ev.clientY);

        el.classList.remove("dragging");
        el.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) return;
        var destCard = hit.closest(".card");
        var destColEl = hit.closest(".k-col");

        if (destCard && destCard !== el) {
          var r = destCard.getBoundingClientRect();
          var before = ev.clientY < r.top + r.height / 2;
          moveCard(col, card,
                   destCard.closest(".k-col").dataset.colId,
                   destCard.dataset.cardId, before);
        } else if (destColEl) {
          moveCard(col, card, destColEl.dataset.colId, null, false);
        }
        // else: dropped outside the board — position unchanged

        save(); scheduleRender();
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          el.classList.remove("dragging");
          el.style.pointerEvents = "";
          document.body.classList.remove("is-dragging");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  function moveCard(srcCol, card, destColId, beforeCardId, before) {
    var srcIdx = srcCol.cards.indexOf(card);
    if (srcIdx === -1) return;
    var dest = colById(destColId);
    if (!dest) return;

    srcCol.cards.splice(srcIdx, 1);

    var at = dest.cards.length;
    if (beforeCardId) {
      var bi = -1;
      dest.cards.forEach(function (c, i) { if (c.id === beforeCardId) bi = i; });
      if (bi !== -1) at = before ? bi : bi + 1;
    }
    dest.cards.splice(at, 0, card);
  }

  // ---------- 8. Undo / toast ----------
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

    void el.offsetWidth;                 // restart transition
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  // ---------- 9. Sync slice + palette inheritance ----------
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
    } catch (e) { /* standalone open — fallback palette stands */ }
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

    // Bridge consumed by save(). Created UNCONDITIONALLY so save()
    // never crashes in standalone opens. The suppression flag makes
    // pulls safe: applying remote data never re-marks dirty → no loop.
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("kanban", sliceGet, sliceSet, "oros-kanban-data");
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.columns) || data.columns.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    scheduleRender();
  }

  // ---------- 10. Wiring & boot ----------
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
    // Placeholders (data-i18n-ph) — set AFTER inputs exist in the DOM
    var ph = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < ph.length; k++) {
      ph[k].setAttribute("placeholder", t(ph[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // New column
    $("col-add").addEventListener("click", createColumn);

    // --- Card dialog ---
    // Text/notes: typed values live in the card object via input
    // listeners in openCardDialog wiring below; flushed on close.
    $("c-text").addEventListener("input", function () {
      var card = editingCard();
      if (card) card.text = $("c-text").value;
    });
    $("c-notes").addEventListener("input", function () {
      var card = editingCard();
      if (card) card.notes = $("c-notes").value;
    });

    // Submit = "Save & close". Validation lives in the form (required).
    $("card-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var card = editingCard();
      if (card) {
        card.text = $("c-text").value.trim() || card.text;
        save(); scheduleRender();
      }
      $("dlg-card").close();
    });

    $("c-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.carddel"))) return;
      var col = colById(editingColId);
      if (col) {
        pushUndo("toast.deleted");
        col.cards = col.cards.filter(function (c) { return c.id !== editingCardId; });
        save(); scheduleRender();
      }
      $("dlg-card").close();
    });

    // Subtasks
    $("c-sub-add").addEventListener("click", addSubtask);
    $("c-sub-new").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addSubtask(); }
    });

    // Extra info
    $("c-info-add").addEventListener("click", addInfo);

    // Duplicate
    $("c-duplicate").addEventListener("click", duplicateCard);

    // --- Column dialog ---
    $("col-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var col = colById(editingColId);
      if (!col) { $("dlg-col").close(); return; }

      var name = $("col-name").value.trim();
      if (!name) return;

      col.name = name;
      save(); scheduleRender();
      $("dlg-col").close();
    });

    $("col-delete").addEventListener("click", function () {
      if (!confirm(t("confirm.coldel"))) return;
      pushUndo("toast.coldel");
      state.columns = state.columns.filter(function (c) { return c.id !== editingColId; });
      if (state.columns.length === 0) {
        var fresh = newColumnObj(t("new.col"));
        state.columns.push(fresh);
      }
      save(); scheduleRender();
      $("dlg-col").close();
    });
  }

  function boot() {
    document.documentElement.setAttribute("lang", LANG);
    applyI18n();
    load();
    wire();
    registerSync();       // must come AFTER load(): sliceGet reads state
    inheritPalette();
    watchPalette();
    scheduleRender();
  }

  boot();
})();