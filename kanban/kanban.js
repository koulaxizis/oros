// ============================================================
// orOS Kanban — App logic (v0.4, Wave 3)
// New in v0.4:
//   - Column drag reorder (#21): pointer-based, threshold-gated,
//     head = drag handle, half-column insertion indicators
//   - Column rename button (#22): pencil in the head, same dialog
//     as dblclick — always-visible affordance
// From v0.3 (Wave 2): labels, board search, filter by label,
//   DATA_VER 3 migration, chips, subtasks, extra info, duplicate.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration
//   3. Render: columns + cards (chips / subtask chip / info preview)
//   4. Quick-add (per column)
//   5. Card dialog (live editing: labels, subtasks, info, duplicate)
//   6. Column dialog
//   7. Search & filter (board bar)
//   8. Card drag & drop (pointer-based, threshold-gated)
//   8b. Column drag reorder (pointer-based, threshold-gated)
//   9. Undo / toast
//  10. Sync slice (Dropbox) + palette inheritance
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-kanban-data";
  var DATA_VER = 3;

  // ---------- 1. Constants, i18n, helpers ----------
  // Language comes from the shell (same-origin, shared localStorage).
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "board.title":      "Kanban",
      "col.add":          "Add column",
      "col.add.title":    "Add column",
      "col.rename":       "Rename column",
      "empty.title":      "No columns yet",
      "empty.hint":       "Add your first column with the button above.",
      "quick.add":        "Add a card…",
      "search.ph":        "Search…",
      "search.clear":     "Clear search",
      "filter.title":     "Filter by label",
      "filter.empty":     "No labels yet — add one from a card.",
      "filter.del":       "Delete label",
      "card.title":       "Card",
      "card.text":        "Text",
      "card.notes":       "Notes",
      "card.labels":      "Labels",
      "card.labels.manage": "Add / manage labels",
      "labels.chipRemove": "Click to remove",
      "labels.newph":     "New label…",
      "labels.add":       "Add",
      "labels.none":      "No labels yet — create one below.",
      "card.subtasks":    "Subtasks",
      "card.subph":       "New subtask…",
      "card.add":         "Add",
      "card.info":        "Extra info",
      "card.info.add":    "Add field",
      "card.info.label":  "Field",
      "card.info.value":  "Value",
      "card.delete":      "Delete",
      "card.duplicate":   "Duplicate",
      "dup.suffix":       " (copy)",
      "toast.duplicated": "Duplicated",
      "toast.labeladd":   "Label created",
      "toast.labeldel":   "Label deleted",
      "save":             "Save",
      "col.settings":     "Column settings",
      "col.name":         "Name",
      "col.delete":       "Delete column",
      "toast.deleted":    "Deleted",
      "toast.undone":     "Restored",
      "toast.coldel":     "Column deleted",
      "undo":             "Undo",
      "confirm.carddel":  "Delete this card?",
      "confirm.coldel":   "Delete this column and all its cards?",
      "confirm.lbldel":   "Delete this label? It will be removed from all cards.",
      "new.col":          "New column"
    },
    el: {
      "board.title":      "Kanban",
      "col.add":          "Προσθήκη στήλης",
      "col.add.title":    "Προσθήκη στήλης",
      "col.rename":       "Μετονομασία στήλης",
      "empty.title":      "Δεν υπάρχουν στήλες ακόμα",
      "empty.hint":       "Πρόσθεσε την πρώτη σου στήλη με το κουμπί παραπάνω.",
      "quick.add":        "Προσθήκη κάρτας…",
      "search.ph":        "Αναζήτηση…",
      "search.clear":     "Καθαρισμός αναζήτησης",
      "filter.title":     "Φιλτράρισμα ανά ετικέτα",
      "filter.empty":     "Δεν υπάρχουν ετικέτες — πρόσθεσε από κάποια κάρτα.",
      "filter.del":       "Διαγραφή ετικέτας",
      "card.title":       "Κάρτα",
      "card.text":        "Κείμενο",
      "card.notes":       "Σημειώσεις",
      "card.labels":      "Ετικέτες",
      "card.labels.manage": "Προσθήκη / διαχείριση ετικετών",
      "labels.chipRemove": "Κλικ για αφαίρεση",
      "labels.newph":     "Νέα ετικέτα…",
      "labels.add":       "Προσθήκη",
      "labels.none":      "Δεν υπάρχουν ετικέτες — δημιούργησε από κάτω.",
      "card.subtasks":    "Υπο-εργασίες",
      "card.subph":       "Νέα υπο-εργασία…",
      "card.add":         "Προσθήκη",
      "card.info":        "Επιπλέον στοιχεία",
      "card.info.add":    "Προσθήκη πεδίου",
      "card.info.label":  "Πεδίο",
      "card.info.value":  "Τιμή",
      "card.delete":      "Διαγραφή",
      "card.duplicate":   "Αντίγραφο",
      "dup.suffix":       " (αντίγραφο)",
      "toast.duplicated": "Αντιγράφηκε",
      "toast.labeladd":   "Η ετικέτα δημιουργήθηκε",
      "toast.labeldel":   "Η ετικέτα διαγράφηκε",
      "save":             "Αποθήκευση",
      "col.settings":     "Ρυθμίσεις στήλης",
      "col.name":         "Όνομα",
      "col.delete":       "Διαγραφή στήλης",
      "toast.deleted":    "Διαγράφηκε",
      "toast.undone":     "Επαναφέρθηκε",
      "toast.coldel":     "Η στήλη διαγράφηκε",
      "undo":             "Αναίρεση",
      "confirm.carddel":  "Διαγραφή αυτής της κάρτας;",
      "confirm.coldel":   "Διαγραφή στήλης και όλων των καρτών της;",
      "confirm.lbldel":   "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις κάρτες.",
      "new.col":          "Νέα στήλη"
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
  //   ver: 3,
  //   labels: [{ id, name, color }],
  //   columns: [{
  //     id, name,
  //     cards: [{
  //       id, text, notes,
  //       labels:   [<label id>],
  //       subtasks: [{ id, text, completed }],
  //       info:     [{ id, label, value }]
  //     }]
  //   }]
  // }
  var state = null;
  var renderQueued = false;

  var SWATCH_COLORS = ["#d4af37", "#4caf50", "#f44336", "#2196f3",
                       "#ff9800", "#9c27b0", "#e91e63", "#03a9f4"];
  var FALLBACK_COLOR = "#d4af37";

  // Additive migration: bring ANY older/missing shape up to DATA_VER.
  // Never destructive — old backups, v1/v2 slices and v3 data load alike.
  function migrate(data) {
    if (!data || !Array.isArray(data.columns)) return null;
    if (!Array.isArray(data.labels)) data.labels = [];
    data.columns.forEach(function (col) {
      if (!Array.isArray(col.cards)) col.cards = [];
      col.cards.forEach(function (card) {
        if (!Array.isArray(card.labels)) card.labels = [];
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
      labels: [],
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

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }

  // ---------- 3. Render: columns + cards ----------
  // renderAll paints the board honoring search + filters.
  // The column counter shows VISIBLE cards (search/filter aware).
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

    // Head: title (dblclick → rename) + rename pencil + visible card count.
    // The whole head is the column-reorder drag handle.
    var head = document.createElement("div");
    head.className = "col-head";

    var title = document.createElement("span");
    title.className = "col-title";
    title.textContent = col.name;
    title.title = col.name;               // full name on hover if truncated
    title.addEventListener("dblclick", function () { openColDialog(col.id); });
    head.appendChild(title);

    // Rename pencil (#22) — same dialog as dblclick, always visible
    var rename = document.createElement("button");
    rename.type = "button";
    rename.className = "col-rename";
    rename.setAttribute("aria-label", t("col.rename"));
    rename.title = t("col.rename");
    rename.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    rename.addEventListener("click", function (e) {
      e.stopPropagation();
      openColDialog(col.id);
    });
    head.appendChild(rename);

    var visible = 0;
    col.cards.forEach(function (c) { if (cardMatchesView(c)) visible++; });

    var count = document.createElement("span");
    count.className = "col-count";
    count.textContent = String(visible);
    head.appendChild(count);

    el.appendChild(head);

    // Body: the visible cards
    var body = document.createElement("div");
    body.className = "col-body";
    col.cards.forEach(function (card) {
      if (!cardMatchesView(card)) return;
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

    // Column reorder drag — the head is the handle (after head exists)
    attachColDrag(head, el, col);

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

    // Label chips on the card face
    if (card.labels && card.labels.length > 0) {
      var chipHost = document.createElement("div");
      chipHost.className = "chips";
      card.labels.forEach(function (lid) {
        var label = labelById(lid);
        if (!label) return;
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.style.background = label.color || FALLBACK_COLOR;
        chip.textContent = label.name;
        chip.title = label.name;
        chipHost.appendChild(chip);
      });
      if (chipHost.childNodes.length > 0) el.appendChild(chipHost);
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
      labels: [], subtasks: [], info: []
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
  var pickedSwatch = FALLBACK_COLOR;     // new-label color pick (accent default)

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

    renderCardLabels(card);
    renderSubtasks(card);
    renderInfo(card);
    $("c-lbl-picker").hidden = true;

    $("dlg-card").showModal();
    setTimeout(function () { $("c-text").focus(); }, 50);
  }

  // Live-editing model:
  //   - structural changes (check / add / remove / label attach) → save() NOW
  //   - typing in text fields → in-memory only, flushed on dialog close
  //     (dialog 'close' fires for submit AND for Esc — nothing is ever lost)

  // --- Labels inside the card dialog ---
  function renderCardLabels(card) {
    var host = $("c-lbl-chips");
    host.innerHTML = "";
    (card.labels || []).forEach(function (lid) {
      var label = labelById(lid);
      if (!label) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lbl-chip";
      chip.style.background = label.color || FALLBACK_COLOR;
      chip.title = t("labels.chipRemove");
      var name = document.createElement("span");
      name.textContent = label.name;
      chip.appendChild(name);
      chip.addEventListener("click", function () {
        card.labels = card.labels.filter(function (id) { return id !== lid; });
        save(); scheduleRender();
        renderCardLabels(card);
      });
      host.appendChild(chip);
    });
  }

  // Picker: all board labels — click toggles attach/detach on this card.
  function renderLblPicker() {
    var list = $("c-lbl-list");
    list.innerHTML = "";

    if (state.labels.length === 0) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("labels.none");
      list.appendChild(none);
      return;
    }

    var card = editingCard();
    state.labels.forEach(function (label) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "lbl-item";
      if (card && card.labels.indexOf(label.id) !== -1) {
        item.classList.add("attached");
      }

      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = label.color || FALLBACK_COLOR;
      item.appendChild(dot);

      var name = document.createElement("span");
      name.className = "fl-name";
      name.textContent = label.name;
      item.appendChild(name);

      item.addEventListener("click", function () {
        var c = editingCard();
        if (!c) return;
        var pos = c.labels.indexOf(label.id);
        if (pos === -1) c.labels.push(label.id);
        else            c.labels.splice(pos, 1);
        save(); scheduleRender();
        renderCardLabels(c);
        renderLblPicker();
      });

      list.appendChild(item);
    });
  }

  function renderLblSwatches() {
    var host = $("c-lbl-swatches");
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
    var input = $("c-lbl-name");
    var name = input.value.trim();
    if (!name) return;

    var label = { id: uid(), name: name, color: pickedSwatch };
    state.labels.push(label);

    var card = editingCard();
    if (card) card.labels.push(label.id);

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (card) renderCardLabels(card);
    renderLblPicker();
    input.focus();                      // keep focus → quick label batches
    showToast(t("toast.labeladd"), false);
  }

  // --- Subtasks inside the card dialog ---
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

  // --- Extra info inside the card dialog ---
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

  // --- Duplicate card ---
  // Deep clone (fresh ids everywhere), "(copy)" suffix, placed right
  // after the original in the same column. Labels are copied by id
  // (they reference the shared board-wide store).
  function duplicateCard() {
    var col = colById(editingColId);
    var card = editingCard();
    if (!col || !card) return;

    var copy = JSON.parse(JSON.stringify(card));
    copy.id = uid();
    copy.text = card.text + t("dup.suffix");
    copy.labels = card.labels.slice();
    copy.subtasks.forEach(function (s) { s.id = uid(); });
    copy.info.forEach(function (f) { f.id = uid(); });

    var idx = col.cards.indexOf(card);
    col.cards.splice(idx + 1, 0, copy);

    save(); scheduleRender();
    showToast(t("toast.duplicated"), false);
  }

  // Flush typed-but-unsaved text when the dialog closes by ANY path
  // (Save button, Esc) — guarantees no data loss. Also prunes empty
  // info fields (no label AND no value) that would be pure clutter.
  $("dlg-card").addEventListener("close", function () {
    if (editingColId === null) return;
    var card = editingCard();
    editingColId = null;
    editingCardId = null;
    if (!card) return;
    card.info = (card.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
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

  // ---------- 7. Search & filter ----------
  var searchQuery = "";
  var activeFilters = [];

  // Combined view gate: search (substring) AND filter (≥1 active label).
  function cardMatchesView(card) {
    if (searchQuery && !matchesSearch(card)) return false;
    if (activeFilters.length > 0 && !matchesFilters(card)) return false;
    return true;
  }

  // Search covers: title, notes, info labels AND values, attached label names.
  function matchesSearch(card) {
    if ((card.text || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if ((card.notes || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var i = 0; i < (card.info || []).length; i++) {
      var f = card.info[i];
      if ((f.label || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
      if ((f.value || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    for (var j = 0; j < (card.labels || []).length; j++) {
      var label = labelById(card.labels[j]);
      if (label && label.name.toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    return false;
  }

  // OR over selected labels — a card shows if it carries ANY active label.
  function matchesFilters(card) {
    if (!card.labels || card.labels.length === 0) return false;
    for (var i = 0; i < activeFilters.length; i++) {
      if (card.labels.indexOf(activeFilters[i]) !== -1) return true;
    }
    return false;
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
  // filters → no orphan ids on cards, no ghost filter entries.
  function deleteLabel(labelId) {
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.columns.forEach(function (col) {
      col.cards.forEach(function (card) {
        card.labels = (card.labels || []).filter(function (id) { return id !== labelId; });
      });
    });
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var card = editingCard();
    if (card) renderCardLabels(card);
    showToast(t("toast.labeldel"), false);
  }

  // ---------- 8. Card drag & drop ----------
  // Pointer-based, threshold-gated: a plain tap never starts a drag
  // (the click → dialog keeps working). Vertical touch movement
  // scrolls the column list (touch-action: pan-y); horizontal
  // movement belongs to us → cross-column drag.
  var DRAG_THRESHOLD = 8;

  function attachCardDrag(el, col, card) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;   // primary only
      // never start a drag while the card dialog is open
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
          ".drag-over-above, .drag-over-below, .k-col.drag-over, " +
          ".k-col.drag-over-left, .k-col.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below",
                                     "drag-over", "drag-over-left", "drag-over-right");
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

  // ---------- 8b. Column drag reorder (#21) ----------
  // Same contract as card drag: pointer-based, threshold-gated, no
  // HTML5 dragstart. The head is the handle (grab cursor); the pencil
  // button and dblclick-rename are excluded. The indicator shows LEFT
  // or RIGHT of the hovered target based on the pointer half.
  function attachColDrag(headEl, colEl, col) {
    headEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      // pencils/dlg opens are handled by their own listeners — never drag
      if (e.target.closest(".col-rename")) return;
      if ($("dlg-card").open || $("dlg-col").open) return;
      if (state.columns.length < 2) return;   // nothing to reorder

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        colEl.classList.add("drag-src");
        colEl.style.pointerEvents = "none";  // elementFromPoint sees THROUGH us
        document.body.classList.add("is-dragging");
      }

      function clearMarks() {
        var marked = document.querySelectorAll(
          ".drag-over-above, .drag-over-below, .k-col.drag-over, " +
          ".k-col.drag-over-left, .k-col.drag-over-right");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below",
                                     "drag-over", "drag-over-left", "drag-over-right");
        }
      }

      function mark(x, y) {
        clearMarks();
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest) return;
        var target = hit.closest(".k-col");
        if (!target || target === colEl) return;
        var r = target.getBoundingClientRect();
        if (x < r.left + r.width / 2) target.classList.add("drag-over-left");
        else                          target.classList.add("drag-over-right");
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          // Horizontal bias: column reorder is a horizontal gesture.
          // Mostly-vertical intent (or tiny jiggles) never starts it.
          if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
          beginDrag();
        }
        ev.preventDefault();
        mark(ev.clientX, ev.clientY);
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        if (!started) return;              // was a tap/dblclick start — no-op

        // Compute destination FIRST (pointer-events hack still active)
        var hit = document.elementFromPoint(ev.clientX, ev.clientY);

        colEl.classList.remove("drag-src");
        colEl.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) { save(); scheduleRender(); return; }
        var target = hit.closest(".k-col");
        if (target && target !== colEl) {
          var r = target.getBoundingClientRect();
          var before = ev.clientX < r.left + r.width / 2;
          moveColumn(col, target.dataset.colId, before);
        }
        // else: dropped outside — order unchanged

        save(); scheduleRender();
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          colEl.classList.remove("drag-src");
          colEl.style.pointerEvents = "";
          document.body.classList.remove("is-dragging");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  // Remove the source column, then re-locate the target (indices shift
  // after the splice!) and insert before/after it.
  function moveColumn(srcCol, destColId, before) {
    var from = state.columns.indexOf(srcCol);
    if (from === -1) return;

    state.columns.splice(from, 1);

    var to = -1;
    for (var i = 0; i < state.columns.length; i++) {
      if (state.columns[i].id === destColId) { to = i; break; }
    }
    if (to === -1) { save(); scheduleRender(); return; }  // restore below

    var at = before ? to : to + 1;
    state.columns.splice(at, 0, srcCol);
  }

  // ---------- 9. Undo / toast ----------
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

  // ---------- 10. Sync slice + palette inheritance ----------
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
    if (!data || Array.isArray(data.columns) === false || data.columns.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    scheduleRender();
  }

  // ---------- 11. Wiring & boot ----------
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
    // Placeholders (data-i18n-ph) — inputs exist in the DOM by now
    var ph = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < ph.length; k++) {
      ph[k].setAttribute("placeholder", t(ph[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // New column
    $("col-add").addEventListener("click", createColumn);

    // --- Search ---
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

    // --- Filter popover: toggle + outside-click close ---
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

    // --- Card dialog ---
    // Text/notes flush on dialog close — no keystroke save spam.
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

    // Labels (inside dialog)
    $("c-lbl-toggle").addEventListener("click", function () {
      var picker = $("c-lbl-picker");
      if (picker.hidden) {
        renderLblPicker();
        renderLblSwatches();
        picker.hidden = false;
      } else {
        picker.hidden = true;
      }
    });
    $("c-lbl-new-add").addEventListener("click", createNewLabel);
    $("c-lbl-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); createNewLabel(); }
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