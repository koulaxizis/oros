// ============================================================
// orOS Kanban — App logic (v0.6.0 - Multi-board)
// -------------------------------------------------------------
// Νέο στο v0.6.0 (MULTI-BOARD SUPPORT):
//   - state = { ver: 5, boards: [{ ...oldStateFields, id, mtime }], 
//               om: <έκδοση σειράς boards>, activeBoardId: ... }
//   - Κάθε board είναι πλήρης μονάδα δεδομένων (columns, labels, deleted)
//   - Migration v4→v5: wrapper του υπάρχοντος state σε board "Main"
//   - Merge logic επεκτάθηκε για union boards + nested merge ανά board_id
// -------------------------------------------------------------
// Παλαιές εκδόσεις (v0.5 merge): cross-device merge με LWW + tombstones
// -------------------------------------------------------------
// Ενότητες:
//   1. Σταθερές, i18n, βοηθητικές συναρτήσεις (helpers)
//   2. Μοντέλο δεδομένων, αποθήκευση, migration (v5: multi-board)
//   2b. Μηχανή συγχρονισμού μεταξύ συσκευών (multi-board extended)
//   3. Εμφάνιση (Render): boards list + columns + cards
//   4. Board management UI (dialog, dropdown)
//   5. Γρήγορη προσθήκη (ανά στήλη)
//   6. Διάλογος καρτών (ζωντανή επεξεργασία)
//   7. Διάλογος στηλών
//   8. Αναζήτηση & φιλτράρισμα (session-only)
//   9. Drag & drop καρτών
//  10. Drag αναδιάταξης στηλών
//  11. Undo / toast
//  12. Sync slice (merge-registered) + palette
//  13. Σύνδεση (Wiring) & εκκίνηση (boot)
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-kanban-data";
  var DATA_VER = 5;                          // v0.6.0: multi-board schema
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 ημέρες

  // ---------- 1. Σταθερές, i18n, βοηθητικές συναρτήσεις ----------
  // Ecosystem: η γλώσσα έρχεται από το shell (window.orosLang) με
  // fallback στο τοπικό κλειδί — ίδια αλυσίδα με Characters/Weather.
  var LANG = (function () {
    try {
      if (window.parent && window.parent.orosLang) {
        return window.parent.orosLang === "el" ? "el" : "en";
      }
    } catch (e) { /* cross-origin guard */ }
    return localStorage.getItem("oros-lang") === "el" ? "el" : "en";
  })();

  var STRINGS = {
    en: {
      "board.title":      "Kanban",
      "board.create":     "New board",
      "board.manage":     "Manage boards...",
      "board.close":      "Close",
      "board.archive":    "Archive board",
      "board.unarchive":  "Unarchive board",
      "board.archived":   "Archived",
      "board.color":      "Color",
      "toast.boardarchived":   "Board archived",
      "toast.boardunarchived": "Board unarchived",
      "toast.boardarchlast":   "At least one board must stay active",
      "board.rename":     "Rename board",
      "board.delete":     "Delete board",
      "board.duplicate":  "Duplicate board",
      "board.default":    "Main",
      "board.empty":      "This board is empty",
      "board.empty.hint": "Create your first column to get started.",
      "col.add":          "Add column",
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
      "card.due":         "Due",
      "card.overdue":     "Overdue",
      "card.due.today":   "Today",
      "card.due.tomorrow":"Tomorrow",
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
      "toast.boarddel":   "Board deleted",
      "toast.boardadded": "Board created",
      "undo":             "Undo",
      "confirm.carddel":  "Delete this card?",
      "confirm.coldel":   "Delete this column and all its cards?",
      "confirm.lbldel":   "Delete this label? It will be removed from all cards.",
      "confirm.boarddel": "Delete this board and ALL its data?",
      "confirm.no":       "Cancel",
      "new.col":          "New column",
      "new.board":        "New board",
      "meta.columns":     "columns",
      "meta.cards":       "cards",
    },
    el: {
      "board.title":      "Kanban",
      "board.create":     "Νέο board",
      "board.manage":     "Διαχείριση boards...",
      "board.close":      "Κλείσιμο",
      "board.archive":    "Αρχειοθέτηση board",
      "board.unarchive":  "Επαναφορά board",
      "board.archived":   "Αρχειοθετημένα",
      "board.color":      "Χρώμα",
      "toast.boardarchived":   "Το board αρχειοθετήθηκε",
      "toast.boardunarchived": "Το board επαναφέρθηκε",
      "toast.boardarchlast":   "Τουλάχιστον ένα board πρέπει να παραμείνει ενεργό",
      "board.rename":     "Μετονομασία board",
      "board.delete":     "Διαγραφή board",
      "board.duplicate":  "Αντιγραφή board",
      "board.default":    "Κύριο",
      "board.empty":      "Αυτό το board είναι άδειο",
      "board.empty.hint": "Δημιούργησε την πρώτη σου στήλη για να ξεκινήσεις.",
      "col.add":          "Προσθήκη στήλης",
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
      "card.due":         "Προθεσμία",
      "card.overdue":     "Καθυστέρηση",
      "card.due.today":   "Σήμερα",
      "card.due.tomorrow":"Αύριο",
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
      "toast.boarddel":   "Το board διαγράφηκε",
      "toast.boardadded": "Το board δημιουργήθηκε",
      "undo":             "Αναίρεση",
      "confirm.carddel":  "Διαγραφή αυτής της κάρτας;",
      "confirm.coldel":   "Διαγραφή στήλης και όλων των καρτών της;",
      "confirm.lbldel":   "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις κάρτες.",
      "confirm.boarddel": "Διαγραφή αυτού του board και ΟΛΩΝ των δεδομένων του;",
      "confirm.no":       "Άκυρο",
      "new.col":          "Νέα στήλη",
      "new.board":        "Νέο board",
      "meta.columns":     "στήλες",
      "meta.cards":       "κάρτες",
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

  // --- Unified notifications (Wave 10 migration) ---
  // Το module ζει στο SHELL (parent) — dynamic resolution, ίδιο
  // doctrine με weather.js/orosSync. Το module λείπει (stale
  // bundle / standalone) → το τοπικό showToast στέκεται ως
  // fallback: καμία orphaned λειτουργία.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) ||
               window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "kanban", title: text, body: "" });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    showToast(text);
  }
  
    // ---------- 1b. Themed confirm (R14) ----------
  // Native confirm() is RETIRED (Bible R14): a themed <dialog> built
  // from the app palette. Esc/backdrop/click-outside = cancel;
  // focus starts on CANCEL so Enter never fires the destructive act.
  function confirmDialog(msgKey, onYes) {
    var stale = document.getElementById("kanban-confirm");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "kanban-confirm";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:18px;" +
      "width:min(340px,calc(100vw - 32px));";

    var form = document.createElement("form");
    form.method = "dialog";

    var msg = document.createElement("div");
    msg.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:16px;";
    msg.textContent = t(msgKey);
    form.appendChild(msg);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    var no = document.createElement("button");
    no.type = "button";
    no.style.cssText =
      "border:1px solid var(--border);border-radius:7px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    row.appendChild(no);

    var yes = document.createElement("button");
    yes.type = "submit";
    yes.style.cssText =
      "border:1px solid var(--danger);border-radius:7px;background:transparent;" +
      "color:var(--danger);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    yes.textContent = t("card.delete");  // reuse existing "Delete"/"Διαγραφή"
    row.appendChild(yes);

    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      onYes();
    });
    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { no.focus(); }, 50);
  }

  // ---------- 2. Μοντέλο δεδομένων, αποθήκευση, migration ----------
  // v5 STRUCTURE:
  //   state = {
  //     ver: 5,
  //     om: <έκδοση σειράς boards>,
  //     activeBoardId: <string>,
  //     boards: [
  //       {
  //         id: <string>,
  //         name: <string>,
  //         mtime: <epoch>,
  //         om: <έκδοση σειράς στηλών>,
  //         deleted: { <entityId>: ts },
  //         labels: [{ id, name, color, mtime, pos }],
  //         columns: [{ id, name, mtime, om, pos, cards: [...] }]
  //       }
  //     ]
  //   }
  
  var state = null;
  var renderQueued = false;

  // §14 LABEL_COLORS — shared 8-color vocabulary (Notes/To-Do/
  // Mood/Habits). Audit #28: kanban shipped a private palette;
  // unified. Stored label/board colors are data — untouched;
  // only the picker options change.
  var SWATCH_COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
                       "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var FALLBACK_COLOR = "#ecc75f";

  // --- Board-level helpers ---
  function currentBoard() {
    if (!state || !state.activeBoardId) return null;
    for (var i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === state.activeBoardId) return state.boards[i];
    }
    return null;
  }

  function boardById(id) {
    if (!state || !id) return null;
    for (var i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === id) return state.boards[i];
    }
    return null;
  }

  // --- Entity touch/tombstone (board-scoped) ---
  function touch(ent)     { if (ent) ent.mtime = Date.now(); }
  function tombstone(board, id) {
    if (!board) return;
    if (!board.deleted) board.deleted = {};
    board.deleted[id] = Date.now();
  }

  function stampAll(board) {
    if (!board) return;
    var nowMs = Date.now();
    board.om = nowMs;
    (board.labels || []).forEach(function (lb) { lb.mtime = nowMs; });
    (board.columns || []).forEach(function (col) {
      col.mtime = nowMs;
      col.om = nowMs;
      (col.cards || []).forEach(function (c) { c.mtime = nowMs; });
    });
  }

  function newBoardObj(name) {
    var names = LANG === "el"
      ? ["Εκκρεμεί", "Σε εξέλιξη", "Ολοκληρωμένα"]
      : ["To Do", "Doing", "Done"];
    return {
      id: uid(),
      name: name,
      mtime: Date.now(),
      om: Date.now(),
      deleted: {},
      labels: [],
      columns: names.map(function (n, i) {
        var c = newColumnObj(n);
        c.pos = i;
        return c;
      })
    };
  }

  function newColumnObj(name) {
    return {
      id: uid(),
      name: name,
      mtime: Date.now(),
      om: 0,
      pos: 0,
      cards: []
    };
  }

  function newCardObj(text) {
    return {
      id: uid(),
      text: text,
      notes: "",
      due: null,          // "YYYY-MM-DD" | null — Kalender integration
      labels: [],
      subtasks: [],
      info: [],
      mtime: Date.now(),
      pos: 0
    };
  }

  // ========== ΜΕΤΑΓΡΑΦΗ v4 → v5 ==========
  // Additive migration: wraps παλαιό single-board state μέσα σε νέο multi-board structure
  // v4 → v5: το υπάρχον state τυλίγεται σε board.id="migrated-" + timestamp
  function migrate(data) {
    // Legacy v1-v4 SINGLE-BODY FORMAT detection:
    if (data && typeof data.ver === "number" && data.ver < 5) {
      // Check if it's old format (has columns but no boards array)
      if (Array.isArray(data.columns) && !Array.isArray(data.boards)) {
        // v4 → v5 migration: wrap into default board
        var boardName = (data.ver === 4 && data.columns && data.columns.length > 0 && data.columns[0].name)
          ? "Main" 
          : (LANG === "el" ? "Κύριο" : "Main");
        
        // Create new v5 state
        var v5state = {
          ver: 5,
          om: Date.now(),
          activeBoardId: null,
          boards: []
        };

        // Migrate existing data into a single board
        var board = {
          id: uid(),
          name: boardName,
          mtime: Date.now(),
          om: data.om || Date.now(),
          deleted: data.deleted || {},
          labels: Array.isArray(data.labels) ? data.labels : [],
          columns: Array.isArray(data.columns) ? data.columns : []
        };

        // Ensure all entities have stamps for merge compatibility
        board.labels.forEach(function (lb) {
          if (typeof lb.mtime !== "number") lb.mtime = 0;
          if (typeof lb.pos !== "number") lb.pos = 0;
        });
        board.columns.forEach(function (col) {
          if (typeof col.mtime !== "number") col.mtime = 0;
          if (typeof col.om !== "number") col.om = 0;
          if (typeof col.pos !== "number") col.pos = 0;
          if (!Array.isArray(col.cards)) col.cards = [];
          col.cards.forEach(function (card) {
            if (!Array.isArray(card.labels)) card.labels = [];
            if (!Array.isArray(card.subtasks)) card.subtasks = [];
            if (!Array.isArray(card.info)) card.info = [];
            if (typeof card.mtime !== "number") card.mtime = 0;
            if (typeof card.pos !== "number") card.pos = 0;
            if (typeof card.due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(card.due)) card.due = null;
          });
        });

        v5state.boards.push(board);
        v5state.activeBoardId = board.id;

        return v5state;
      }
    }

    // v5 STATE FORMAT: validate and enrich
    if (!data || !Array.isArray(data.boards)) return null;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.activeBoardId && data.boards.length > 0) {
      data.activeBoardId = data.boards[0].id;
    }

    data.boards.forEach(function (board) {
      if (!board.id) board.id = uid();
      if (typeof board.mtime !== "number") board.mtime = 0;
      if (typeof board.om !== "number") board.om = 0;
      if (!board.deleted) board.deleted = {};
      if (!Array.isArray(board.labels)) board.labels = [];
      board.labels.forEach(function (lb) {
        if (typeof lb.mtime !== "number") lb.mtime = 0;
        if (typeof lb.pos !== "number") lb.pos = 0;
      });
      if (!Array.isArray(board.columns)) board.columns = [];
      board.columns.forEach(function (col) {
        if (!col.id) col.id = uid();
        if (typeof col.mtime !== "number") col.mtime = 0;
        if (typeof col.om !== "number") col.om = 0;
        if (typeof col.pos !== "number") col.pos = 0;
        if (!Array.isArray(col.cards)) col.cards = [];
        col.cards.forEach(function (card) {
          if (!card.id) card.id = uid();
          if (!Array.isArray(card.labels)) card.labels = [];
          if (!Array.isArray(card.subtasks)) card.subtasks = [];
          if (!Array.isArray(card.info)) card.info = [];
          if (typeof card.mtime !== "number") card.mtime = 0;
          if (typeof card.pos !== "number") card.pos = 0;
          if (typeof card.due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(card.due)) card.due = null;
        });
      });
    });

    data.ver = DATA_VER;
    return data;
  }

  function pruneTombstones(board) {
    if (!board || !board.deleted) return;
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(board.deleted).forEach(function (id) {
      if (board.deleted[id] < cutoff) delete board.deleted[id];
    });
  }

  // ========== LOAD / SAVE ==========
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.boards) && data.boards.length > 0) {
          state = data;
          if (!state.activeBoardId) state.activeBoardId = state.boards[0].id;
          
          // Prune tombstones in ALL boards
          state.boards.forEach(function (board) { pruneTombstones(board); });

          // Prune root-level board tombstones (v0.6.0) — 30ήμερος κανόνας
          if (state.boardDeleted) {
            var rootCut = Date.now() - TOMB_LIFETIME_MS;
            Object.keys(state.boardDeleted).forEach(function (id) {
              if (state.boardDeleted[id] < rootCut) delete state.boardDeleted[id];
            });
          }

          save();
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }

    // Fresh install: create one default board
    state = {
      ver: DATA_VER,
      om: Date.now(),
      activeBoardId: null,
      boards: []
    };
    
    var defaultBoard = newBoardObj(LANG === "el" ? "Κύριο" : "Main");
    state.boards.push(defaultBoard);
    state.activeBoardId = defaultBoard.id;
    
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota exceeded — localStorage net stays durable */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  // Silent save: γράφει ΜΟΝΟ στο localStorage, χωρίς markDirty.
  // Για καθαρά τοπικές ενέργειες (π.χ. switchBoard) που δεν πρέπει
  // να πυροδοτούν δικτυακό sync.
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota exceeded */ }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  // --- Board-scoped entity lookup ---
  function colById(id) {
    var board = currentBoard();
    if (!board) return null;
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === id) return board.columns[i];
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
    var board = currentBoard();
    if (!board) return null;
    for (var i = 0; i < board.labels.length; i++) {
      if (board.labels[i].id === id) return board.labels[i];
    }
    return null;
  }

  // ---------- 2b. Cross-device merge engine (v0.6.0 multi-board) ----------
  // Συμβόλαιο (καταναλώνεται από το sync.js μέσω του 5ου ορίσματος
  // της registerSlice):
  //   mergeKanbanStates(local, remote) → merged state | null.
  //
  // MULTI-BOARD ARCHITECTURE:
  //   · Board level — union κατά board.id. Το board NAME κάνει LWW
  //     στο board.mtime (νεότερο κερδίζει· ισοβαθμία → λεξικογραφικό
  //     JSON — συμμετρικό). Board tombstone: αν κάποια πλευρά έχει
  //     διαγράψει το board (deleted[boardId] με ts νεότερο από το
  //     board.mtime), το board ΠΕΘΑΙΝΕΙ μαζί με ΟΛΑ τα περιεχόμενά
  //     του (columns, cards, labels) — cascade, κανένα zombie.
  //   · Ordering boards — η πλευρά με το μεγαλύτερο ROOT om — η πλευρά με το μεγαλύτερο ROOT om
  //     προσφέρει τη σειρά των boards (ίσος κανόνας με στηλές).
  //     Η ενεργή επιλογή board (activeBoardId) είναι DEVICE-LOCAL —
  //     ΔΕΝ ταξιδεύει στο merge: καθε συσκευή κρατά το board που
  //     έβλεπε (αν υπάρχει ακόμα· αλλιώς fallback στο πρώτο).
  //   · Per-board — ΚΑΘΕ board mergeάρεται ανεξάρτητα με ΟΛΟΥΣ τους
  //     κανόνες του v0.5 (tombstones, LWW περιεχομένου, placement,
  //     ordering με om/pos, orphan rule). Κανένα leak μεταξύ boards:
  //     card ids που ζουν σε διαφορετικά boards δεν συγκρούονται ποτέ
  //     (και εξ ορισμού είναι διαφορετικά ids).
  //
  // Deterministic + symmetric: merge(A,B) === merge(B,A) — και στις
  // δύο συσκευές το αποτέλεσμα ταυτίζεται, καμία ταλάντευση.

  // --- Board-level LWW: name/mtime νικητής ---
  // Board header = ΟΛΑ τα LWW πεδία του board (name, archived, color).
  // v0.6.1 fix: archived/color πετάγονταν στο merge → αρχειοθετημένα
  // boards "αναживαν" και τα χρώματα γίνονταν fallback μετά από sync.
  function newerBoardHeader(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

    // --- Τοπικά tombstones ΟΛΩΝ των boards (root-level map ---
  // board διαγραφές ζουν στο ΔΙΚΟ τους state.deleted με το board.id
  // ως key — ψάχνουμε global κάθε φορά που χρειάζεται)

  // ΠΡΟΣΟΧΗ: το board-level tombstone ΕΧΕΙ νόημα μόνο ως marker
  // στο ίδιο το board object. Η τυπική ροή: deleteBoard() γράφει
  // tombstone στο ΕΝΕΡΓΟ board αν είναι το ίδιο, αλλιώς στο δικό
  // του deleted map ΔΕΝ υπάρχει — το board απομακρύνεται απλώς
  // από το boards[]. Στο merge, ένα board που λείπει από μία πλευρά
  // ΔΕΝ σημαίνει διαγραφή (μπορεί να είναι απλώς ακόμα-μη-φτάσιμο
  // νέο board). Γι' αυτό κρατάμε εξωτερικό root map: βλ.
  // ROOT_TOMB παρακάτω.

  // Root-level board tombstones: state.boardDeleted = { id: ts }.
  // ΑΝΩΤΑΤΟ επίπεδο — ένα board θεωρείται νεκρό αν υπάρχει εδώ
  // entry με ts > board.mtime (edit-after-delete ανασταίνει board,
  // ΟΜΩΙ ΚΑΝΟΝΙΚΑ δεν μπορεί: όλα τα boards διαγράφονται ως
  // σύνολο. Απλούστευση: το ts πάντα νικά — κανένα resurrection
  // επιπέδου board, τα δεδομένα του έχουν φύγει cascade).
  function boardAlive(board, rootTomb) {
    var ts = rootTomb[board.id];
    return ts === undefined || (board.mtime || 0) > ts;
  }
  // Σημείωση: επιτρέπουμε πλήρως συμμετρική συνθήκη mtime > ts για
  // συνέπεια με το entAlive — τοπικά ποτέ δεν την προκαλούμε (η
  // διαγραφή board είναι μονόδρομη), αλλά δεν βλάπτει.

  // --- Per-BOARD merge: ΟΛΟΙ οι κανόνες v0.5, με κάποιο board ως
  // εύρος (scope). Πρώην mergeKanbanStates τοπικό σώμα — τώρα
  // mergeBoardBody(boardA, boardB) → merged board | null. ---
  function mergeEntityMaps(aDel, bDel) {
    var out = {};
    var a = aDel || {}, b = bDel || {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) {
      out[id] = Math.max(out[id] || 0, b[id]);
    });
    return out;
  }

  function entAlive(ent, tomb) {
    var ts = tomb[ent.id];
    return ts === undefined || (ent.mtime || 0) > ts;
  }

  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function unionEntities(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? newerEntity(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }

  function orderEntities(entities, refArr) {
    var idx = {};
    (refArr || []).forEach(function (e, i) { idx[e.id] = i; });
    entities.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    entities.forEach(function (e, i) { e.pos = i; });
    return entities;
  }

  function pickRef(aArr, bArr, aOm, bOm) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var ka = JSON.stringify((aArr || []).map(function (e) { return e.id; }));
    var kb = JSON.stringify((bArr || []).map(function (e) { return e.id; }));
    return ka >= kb ? aArr : bArr;
  }

  function flattenSide(board) {
    var out = {};
    ((board && board.columns) || []).forEach(function (col) {
      (col.cards || []).forEach(function (card) {
        out[card.id] = { card: card, colId: col.id };
      });
    });
    return out;
  }

  function newerPlacement(pa, pb) {
    if ((pa.card.mtime || 0) !== (pb.card.mtime || 0)) {
      return (pa.card.mtime || 0) > (pb.card.mtime || 0) ? pa : pb;
    }
    var ka = JSON.stringify(pa.card) + "|" + pa.colId;
    var kb = JSON.stringify(pb.card) + "|" + pb.colId;
    return ka >= kb ? pa : pb;
  }

  function mergeColHeaders(la, lb) {
    var strip = function (c) {
      var h = JSON.parse(JSON.stringify(c));
      delete h.cards;
      return h;
    };
    var head = newerEntity(strip(la), strip(lb));
    head.om = Math.max(la.om || 0, lb.om || 0);
    return head;
  }

  // PER-BOARD BODY MERGE — τα πάντα scoped στο board αυτό.
  // Επιστρέφει merged board object (name/id/mtime/om/deleted/
  // labels/columns) ή null αν δεν μείνει τίποτα ζωντανό.
  function mergeBoardBody(ba, bb) {
    var tomb = mergeEntityMaps(ba.deleted, bb.deleted);
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) {
      if (tomb[id] < cutoff) delete tomb[id];
    });

    // 1. Ετικέτες: LWW περιεχομένου, σειρά από το board om
    var labels = unionEntities(ba.labels || [], bb.labels || [], tomb);

    // 2. Headers στηλών: ζεύγη κατά id
    var colPairs = {};
    var pairColumns = function (arr) {
      (arr || []).forEach(function (col) {
        if (colPairs[col.id]) colPairs[col.id].push(col);
        else                  colPairs[col.id] = [col];
      });
    };
    pairColumns(ba.columns); pairColumns(bb.columns);

    var mergedCols = {};
    Object.keys(colPairs).forEach(function (id) {
      var pair = colPairs[id];
      var head;
      if (pair.length === 2) head = mergeColHeaders(pair[0], pair[1]);
      else {
        head = (function (c) {
          var h = JSON.parse(JSON.stringify(c));
          delete h.cards;
          return h;
        })(pair[0]);
      }
      if (!entAlive(head, tomb)) return;     // διαγεγραμμένη στήλη
      mergedCols[id] = {
        head: head,
        cards: [],
        refA: pair.length > 0 ? pair[0] : null,
        refB: pair.length > 1 ? pair[1] : null
      };
    });

    // 3. Κάρτες: flatten και των δύο πλευρών, νικητής ανά id
    var fa = flattenSide(ba);
    var fb = flattenSide(bb);
    var cardIds = {};
    Object.keys(fa).forEach(function (id) { cardIds[id] = true; });
    Object.keys(fb).forEach(function (id) { cardIds[id] = true; });

    Object.keys(cardIds).forEach(function (id) {
      var pa = fa[id], pb = fb[id];
      var win;
      if (pa && pb) win = newerPlacement(pa, pb);
      else          win = pa || pb;
      if (!win) return;
      if (!entAlive(win.card, tomb)) return;
      var mc = mergedCols[win.colId];
      if (!mc) return;                 // orphan rule
      mc.cards.push(win.card);
    });

    // 4. Σειρά καρτών ανά στήλη
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      var refArr =
        pickRef((mc.refA && mc.refA.cards) || [],
                (mc.refB && mc.refB.cards) || [],
                mc.refA ? mc.refA.om || 0 : 0,
                mc.refB ? mc.refB.om || 0 : 0);
      orderEntities(mc.cards, refArr);
    });

    // 5. Σύνθεση merged board
    var head = newerBoardHeader(
      { id: ba.id, name: ba.name, archived: !!ba.archived,
        color: ba.color || null, mtime: ba.mtime },
      { id: bb.id, name: bb.name, archived: !!bb.archived,
        color: bb.color || null, mtime: bb.mtime }
    );

    var cols = [];
    Object.keys(mergedCols).forEach(function (id) {
      var mc = mergedCols[id];
      mc.head.cards = mc.cards;
      cols.push(mc.head);
    });

    // Board με μηδεν στήλες μετά το merge: ΔΕΝ πεθαίνει — ένα
    // board μπορεί νόμιμα να είναι άδειο (ο χρήστης διέγραψε τις
    // στήλες του). Μόνο ο ROOT board tombstone σκοτώνει board.

    return {
      id: ba.id,
      name: head.name,
      archived: head.archived,       // v0.6.1: survives the merge now
      color: head.color || undefined, // v0.6.1: survives the merge now
      mtime: Math.max(ba.mtime || 0, bb.mtime || 0),
      om: Math.max(ba.om || 0, bb.om || 0),
      deleted: tomb,
      labels: orderEntities(labels, pickRef(ba.labels || [], bb.labels || [],
                                             ba.om || 0, bb.om || 0)),
      columns: orderEntities(cols, pickRef(ba.columns || [], bb.columns || [],
                                           ba.om || 0, bb.om || 0))
    };
  }

  // ===== ROOT MERGE: multi-board entry point =====
  function mergeKanbanStates(A, B) {
    var a = A || {}, b = B || {};

    // Board tombstones: root maps ένωση με max ts. Τα boards
    // κρατούν το δικό τους board.deleted για τις οντότητες τους·
    // το state.boardDeleted αφορά ΜΟΝΟ τα boards.
    var boardTomb = mergeEntityMaps(a.boardDeleted, b.boardDeleted);
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(boardTomb).forEach(function (id) {
      if (boardTomb[id] < cutoff) delete boardTomb[id];
    });

    // Ζευγάρωση boards κατά id (και των δύο πλευρών)
    var boardPairs = {};
    var pairBoards = function (arr) {
      (arr || []).forEach(function (bd) {
        if (boardPairs[bd.id]) boardPairs[bd.id].push(bd);
        else                  boardPairs[bd.id] = [bd];
      });
    };
    pairBoards(a.boards); pairBoards(b.boards);

    var mergedBoards = [];
    Object.keys(boardPairs).forEach(function (id) {
      var pair = boardPairs[id];
      var bd;
      if (pair.length === 2) bd = mergeBoardBody(pair[0], pair[1]);
      else {
        // Μονόπλευρο board: κλώνος (name/mtime/om/labels/columns)
        bd = (function (src) {
          return {
            id: src.id,
            name: src.name,
            archived: src.archived,       // v0.6.1: keep flags/colors
            color: src.color || undefined,
            mtime: src.mtime,
            om: src.om,
            deleted: JSON.parse(JSON.stringify(src.deleted || {})),
            labels: JSON.parse(JSON.stringify(src.labels || [])),
            columns: JSON.parse(JSON.stringify(src.columns || []))
          };
        })(pair[0]);
      }

      // Root tombstone ελέγχεται στο header του board
      if (!boardAlive(bd, boardTomb)) return;   // νεκρό board — drop

      mergedBoards.push(bd);
    });

    // Μετα-συνθήκη: εντελώς άδειο αποτέλεσμα (π.χ. διαγράφηκαν όλα)
    // → null → fallback σε plain apply από το sync.js
    if (mergedBoards.length === 0) return null;

    // Σειρά boards: ref = πλευρά με μεγαλύτερο ROOT om
    orderEntities(mergedBoards,
      pickRef(a.boards || [], b.boards || [], a.om || 0, b.om || 0));

    return {
      ver: DATA_VER,
      om: Math.max(a.om || 0, b.om || 0),
      boardDeleted: boardTomb,
      // activeBoardId ΔΕΝ θέτουμε εδώ — device-local, το κρατά
      // το sliceSet (υφιστάμενο αν το board ζει, αλλιώς πρώτο)
      boards: mergedBoards
    };
  }


  // ---------- 10. Sync slice (merge-registered) + palette ----------
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
    } catch (e) { /* standalone (απευθείας) open — fallback palette */ }
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
    // v0.6.0: 5ο όρισμα — η multi-board merge συνάρτηση.
    api.registerSlice("kanban", sliceGet, sliceSet,
                      "oros-kanban-data", mergeKanbanStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  // data — merged αποτέλεσμα (ή plain remote σε legacy LWW paths)
  // info — { merged: true } όταν η τιμή ήρθε μέσω mergeKanbanStates
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || Array.isArray(data.boards) === false || data.boards.length === 0) return;

    window.__orosSyncApi._suppress = true;
    try {
      // Device-local επιλογή board: το LOCAL activeBoardId είναι εδώ
      // η αλήθεια — ΟΧΙ το incoming (το merge ΔΕΝ το μεταφέρει,
      // οπότε το data.activeBoardId είναι undefined ή remote).
      // Το κρατάμε αν το board επιβίωσε στο merge· αλλιώς fallback
      // στο πρώτο. Έτσι το sync pull δεν αλλάζει board στον χρήστη.
      var keepActive = state ? state.activeBoardId : null;
      data.activeBoardId =
        (keepActive && boardByIdIn(data.boards, keepActive))
          ? keepActive
          : data.boards[0].id;
      state = data;
      state.boards.forEach(function (board) { pruneTombstones(board); });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    scheduleRender();
    // toast.merged removed: εμφανιζόταν σε ΚΑΘΕ sync pull (το info.merged
    // σημαίνει «χρησιμοποιήθηκε merge engine», ΟΧΙ «άλλαξαν δεδομένα»).
    // Feedback sync = το taskbar sync dot.
  }

  function boardByIdIn(boards, id) {
    for (var i = 0; i < (boards || []).length; i++) {
      if (boards[i].id === id) return boards[i];
    }
    return null;
  }

  
  // ---------- 3. Render: board header + columns + cards ----------
  // Το renderAll ζωγραφίζει:
  //   - Board dropdown (dropdown + buttons: new/manage)
  //   - Board name/title (dblclick → rename dialog)
  //   - Search/filter row
  //   - Columns + cards (όπως πριν, αλλά scoped στο currentBoard)
  
  function renderAll() {
    // Header/board section
    var headerHost = $("board-header");
    if (headerHost) renderBoardHeader();

    // Empty state
    var empty = $("empty");
    if (empty) {
      empty.hidden = !(state && state.boards && state.boards.length === 0);
    }

    // Columns body
    var host = $("columns");
    if (!host) return;
    host.innerHTML = "";

    var board = currentBoard();
    if (!board || board.columns.length === 0) {
      if (empty) {
        empty.querySelector("span").textContent = t("board.empty");
        empty.querySelector("small").textContent = t("board.empty.hint");
        empty.hidden = false;
      }
      return;
    }

    if (empty) empty.hidden = true;

    board.columns.forEach(function (col) {
      host.appendChild(makeColumnEl(col));
    });

    // Filter popover update
    if (!$("filter-pop").hidden) renderFilterPop();
    updateFilterBtn();
  }

  // Board dropdown + management buttons
  function renderBoardHeader() {
    var headerHost = $("board-header");
    if (!headerHost) return;

    // Το innerHTML wipe σκοτώνει τυχόν ανοιχτό popover — καθαρό
    // κλείσιμο πρώτα (αλλιώς κρεμούν flag + document listener).
    if (boardDropdownOpen) closeBoardDropdown();
    headerHost.innerHTML = "";

    if (!state || !state.boards || state.boards.length === 0) {
      // Should never happen — but be defensive
      return;
    }

    // Left: Board dropdown
    var dropdownHost = document.createElement("div");
    dropdownHost.className = "board-dropdown";

    // Dropdown button (board name + arrow)
    var boardBtn = document.createElement("button");
    boardBtn.type = "button";
    boardBtn.className = "board-select";
    var board = currentBoard();
    var bName = board ? board.name : t("board.default");

    boardBtn.innerHTML =
      '<span class="board-dot" style="background:' + (board ? (board.color || FALLBACK_COLOR) : FALLBACK_COLOR) + '"></span>' +
      '<span class="board-name">' + escapeHtml(bName) + '</span>' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';

    boardBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleBoardDropdown();
    });

    // Quick rename (ίδιο gesture με τους τίτλους στηλών). Ροή dblclick:
    // click #1 → άνοιγμα dropdown, click #2 → κλείσιμο, dblclick → rename
    // dialog. Κλείνουμε αμυντικά το dropdown πριν ανοίξουμε.
    boardBtn.addEventListener("dblclick", function (e) {
      e.preventDefault();
      closeBoardDropdown();
      renameCurrentBoard(state.activeBoardId);
    });

    dropdownHost.appendChild(boardBtn);

    // Right: Management buttons
    var actions = document.createElement("div");
    actions.className = "board-actions";

    var newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "board-new";
    newBtn.setAttribute("title", t("board.create"));
    newBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    newBtn.addEventListener("click", function () { createBoard(); });

    var manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "board-manage";
    manageBtn.setAttribute("title", t("board.manage"));
    manageBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    manageBtn.addEventListener("click", function () { openBoardManageDlg(); });

    actions.appendChild(newBtn);
    actions.appendChild(manageBtn);
    dropdownHost.appendChild(actions);

    headerHost.appendChild(dropdownHost);
  }

  // Dropdown popover for board switching
  var boardDropdownOpen = false;

  function toggleBoardDropdown() {
    if (boardDropdownOpen) { closeBoardDropdown(); return; }
    openBoardDropdown();
  }

  function openBoardDropdown() {
    var host = $("board-header");
    if (!host) return;

    var anchor = host.querySelector(".board-dropdown");
    if (!anchor) return;

    var pop = document.createElement("div");
    pop.id = "board-dropdown-pop";
    pop.className = "dropdown-pop";

    renderBoardDropdownItems(pop);
    anchor.appendChild(pop);

    // Close on outside click
    setTimeout(function () {
      boardDropdownOpen = true;
      document.addEventListener("click", closeOutsideHandler);
    }, 0);
  }

  // (Re)γεμίζει το dropdown popover — καλείται ξανά μετά από reorder
  // ώστε η νέα σειρά να φαίνεται ΧΩΡΙΣ να κλείνει το popover (δεν
  // περνάμε από renderAll/renderBoardHeader — θα σκότωναν το pop).
  function renderBoardDropdownItems(pop) {
    pop.innerHTML = "";

    // Ζωντανά boards μόνο — τα αρχειοθετημένα ζουν στο Manage dialog
    var live = state.boards.filter(function (b) { return !b.archived; });
    live.forEach(function (bd) {
      pop.appendChild(makeBoardDropItem(bd, pop));
    });

    // Divider
    var sep = document.createElement("hr");
    sep.className = "dropdown-sep";
    pop.appendChild(sep);

    // New board action
    var newItem = document.createElement("button");
    newItem.type = "button";
    newItem.className = "dropdown-item";
    newItem.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> ' +
      t("board.create");
    newItem.addEventListener("click", function () {
      closeBoardDropdown();
      createBoard();
    });
    pop.appendChild(newItem);
  }

  function makeBoardDropItem(bd, pop) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "dropdown-item" + (bd.id === state.activeBoardId ? " active" : "");
    item.dataset.boardId = bd.id;

    var dot = document.createElement("span");
    dot.className = "board-dot";
    dot.style.background = bd.color || FALLBACK_COLOR;
    item.appendChild(dot);

    var name = document.createElement("span");
    name.className = "dropdown-name";
    name.textContent = bd.name;
    item.appendChild(name);

    var meta = document.createElement("span");
    meta.className = "dropdown-meta";
    var colCount = bd.columns.reduce(function (acc, c) { return acc + (c.cards || []).length; }, 0);
    meta.textContent = String(bd.columns.length) + " " + t("meta.columns") +
                       " · " + String(colCount) + " " + t("meta.cards");
    item.appendChild(meta);

    item.addEventListener("click", function () {
      switchBoard(bd.id);
    });

    attachBoardDrag(item, bd, pop);

    return item;
  }

  // Drag-reorder boards μέσα στο dropdown (ίδιο pointer pattern με
  // τις στήλες: threshold + mark above/below). Το reorder stampάρει
  // state.om — αυτή η πλευρά προσφέρει τη σειρά boards στο merge.
  function attachBoardDrag(item, bd, pop) {
    item.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        item.classList.add("dragging");
        item.style.pointerEvents = "none";
        document.body.classList.add("is-dragging");
      }

      function clearMarks() {
        var marked = pop.querySelectorAll(".drag-over-above, .drag-over-below");
        for (var i = 0; i < marked.length; i++) {
          marked[i].classList.remove("drag-over-above", "drag-over-below");
        }
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          beginDrag();
        }
        ev.preventDefault();
        clearMarks();
        var hit = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!hit || !hit.closest) return;
        var target = hit.closest(".dropdown-item");
        if (!target || target === item || !target.dataset.boardId) return;
        var r = target.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) target.classList.add("drag-over-above");
        else                                        target.classList.add("drag-over-below");
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        if (!started) return;              // ήταν tap → αφήνουμε το click να δράσει

        var hit = document.elementFromPoint(ev.clientX, ev.clientY);
        item.classList.remove("dragging");
        item.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) return;
        var target = hit.closest(".dropdown-item");
        if (target && target !== item && target.dataset.boardId) {
          var r = target.getBoundingClientRect();
          var before = ev.clientY < r.top + r.height / 2;
          if (moveBoard(bd.id, target.dataset.boardId, before)) {
            renderBoardDropdownItems(pop);   // νέα σειρά, popover ανοιχτό
          }
        }
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (started) {
          item.classList.remove("dragging");
          item.style.pointerEvents = "";
          document.body.classList.remove("is-dragging");
          clearMarks();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  }

  // moveBoard — reorder μέσα στο state.boards + stamp state.om.
  // Επιστρέφει true αν έγινε μετακίνηση.
  var boardMoveSaveTimer = null;
  function moveBoard(srcId, destId, before) {
    var from = -1;
    for (var i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === srcId) { from = i; break; }
    }
    if (from === -1) return false;

    var bd = state.boards.splice(from, 1)[0];

    var to = -1;
    for (var j = 0; j < state.boards.length; j++) {
      if (state.boards[j].id === destId) { to = j; break; }
    }
    if (to === -1) {                     // paranoia — restore source
      state.boards.splice(from, 0, bd);
      return false;
    }

    state.boards.splice(before ? to : to + 1, 0, bd);
    state.om = Date.now();               // αυτή η πλευρά προσφέρει τη σειρά
    state.boards.forEach(function (b, i) { b.pos = i; });

    // KN-5: debounced save — rapid successive reorders μέσα στο
    // dropdown καταλήγουν σε ΕΝΑ save/dirty αντί για πολλά. Το
    // state.om stampάρεται σε κάθε κίνηση (σωστό για το merge),
    // μόνο το localStorage/sync flush συγχρονίζεται. Το UI δεν
    // επηρεάζεται: το renderBoardDropdownItems() διαβάζει το
    // state απευθείας, όχι το localStorage.
    clearTimeout(boardMoveSaveTimer);
    boardMoveSaveTimer = setTimeout(function () { save(); }, 300);

    return true;
  }

  function closeBoardDropdown() {
    var pop = $("board-dropdown-pop");
    if (pop) pop.remove();
    boardDropdownOpen = false;
    document.removeEventListener("click", closeOutsideHandler);
  }

  function closeOutsideHandler(e) {
    var pop = $("board-dropdown-pop");
    if (pop && !pop.contains(e.target)) closeBoardDropdown();
  }

  // Reset session-only search/filter — κοινός helper για
  // switchBoard/createBoard (πρώην διπλότυπο block).
  function resetSessionView() {
    searchQuery = "";
    activeFilters = [];
    var sb = $("search");
    if (sb) sb.value = "";
    var sc = $("search-clear");
    if (sc) sc.hidden = true;          // fix: το clear button έμενε ορατό
    var fb = $("filter-btn");
    if (fb) fb.classList.remove("has-filters");
    var fp = $("filter-pop");
    if (fp) fp.hidden = true;
  }

  // Switch to a different board (device-local only — doesn't sync)
  function switchBoard(boardId) {
    if (!boardByIdIn(state.boards, boardId)) return;
    state.activeBoardId = boardId;
    resetSessionView();

    saveLocal();                        // silent: καμία ενεργοποίηση sync
    renderAll();
    closeBoardDropdown();
  }

  // Board creation: creates new board, switches to it
  function createBoard() {
    // KN-1b: real undo — snapshot ΠΡΙΝ τη μετάλλαξη (ίδιο pattern
    // με deleteBoard/duplicateBoard). Το παλιό showToast(..., true)
    // έδειχνε Undo button χωρίς pushUndo: noop, ή χειρότερα,
    // επαναφορά σε ΣΤΑΛΕΜΕΝΟ snapshot προηγούμενης ενέργειας.
    pushUndo("toast.boardadded");

    var board = newBoardObj(t("new.board"));   // i18n αντί hardcoded string
    board.pos = state.boards.length;

    state.om = Date.now();
    state.boards.push(board);
    state.activeBoardId = board.id;

    resetSessionView();                 // κοινός helper (πρώην διπλότυπο)

    save();
    renderAll();
  }

  // ========== BOARD MANAGE DIALOG ==========
  function openBoardManageDlg() {
    if ($("manage-dialog") && $("manage-dialog").open) return;

    var dlg = document.createElement("dialog");
    dlg.id = "manage-dialog";
    dlg.innerHTML =
      "<h3>" + t("board.manage") + "</h3>" +
      '<div id="manage-list"></div>' +
      '<div class="dlg-foot">' +
      '<button type="button" id="manage-create">' + t("board.create") + '</button>' +
      '<button type="button" id="manage-close">' + t("board.close") + '</button>' +
      "</div>";
    document.body.appendChild(dlg);

    renderManageList();

    dlg.addEventListener("close", function () {
      dlg.remove();
    });

    $("manage-create").addEventListener("click", function () {
      createBoard();
      dlg.close();
    });

    $("manage-close").addEventListener("click", function () {
      dlg.close();
    });

    // Outside/backdrop click closes
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });

    dlg.showModal();
  }

  function renderManageList() {
    var host = $("manage-list");
    if (!host) return;
    host.innerHTML = "";

          // Ζωντανά πρώτα, μετά τα αρχειοθετημένα με τη σειρά τους
    var live    = state.boards.filter(function (b) { return !b.archived; });
    var archived = state.boards.filter(function (b) { return !!b.archived; });

    if (live.length > 0) host.appendChild(makeManageSection(live, false));
    if (archived.length > 0) host.appendChild(makeManageSection(archived, true));
  }

  function makeManageSection(boards, isArchived) {
    var frag = document.createDocumentFragment();

    if (isArchived) {
      var hdr = document.createElement("div");
      hdr.className = "manage-section-hdr";
      hdr.textContent = t("board.archived");
      frag.appendChild(hdr);
    }

    boards.forEach(function (bd) { frag.appendChild(makeManageRow(bd, isArchived)); });
    return frag;
  }

  function makeManageRow(bd, isArchived) {
    var row = document.createElement("div");
    row.className = "manage-row" + (isArchived ? " is-archived" : "");

    var active = bd.id === state.activeBoardId;
    if (active) row.classList.add("active");

    var check = document.createElement("span");
    check.className = "manage-check";
    check.innerHTML = ICNS.check;
    if (!active) check.style.opacity = "0.3";
    row.appendChild(check);

    // Board color dot (②) — κλικ ανοίγει swatches inline
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "manage-dot";
    dot.style.background = bd.color || FALLBACK_COLOR;
    dot.setAttribute("title", t("board.color"));
    dot.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleManageSwatches(bd, row);
    });
    row.appendChild(dot);

    var info = document.createElement("div");
    info.className = "manage-info";

    var name = document.createElement("div");
    name.className = "manage-name";
    name.textContent = bd.name;
    info.appendChild(name);

    var meta = document.createElement("div");
    meta.className = "manage-meta";
    var colCount = bd.columns.length;
    var cardCount = bd.columns.reduce(function (acc, c) { return acc + (c.cards || []).length; }, 0);
    meta.textContent = String(colCount) + " " + t("meta.columns") + ", " +
                       String(cardCount) + " " + t("meta.cards");
    info.appendChild(meta);

    row.appendChild(info);

    var actions = document.createElement("div");
    actions.className = "manage-actions";

    var renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "manage-rename";
    renameBtn.setAttribute("title", t("board.rename"));
    renameBtn.innerHTML = ICNS.pencil;
    renameBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      renameCurrentBoard(bd.id);
    });
    actions.appendChild(renameBtn);

    var dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "manage-duplicate";
    dupBtn.setAttribute("title", t("board.duplicate"));
    dupBtn.innerHTML = ICNS.copy;
    dupBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      duplicateBoard(bd.id);
    });
    actions.appendChild(dupBtn);

    // Archive / Unarchive (④) — πάντα διαθέσιμο
    var archBtn = document.createElement("button");
    archBtn.type = "button";
    archBtn.className = "manage-archive";
    archBtn.setAttribute("title", isArchived ? t("board.unarchive") : t("board.archive"));
    archBtn.innerHTML = isArchived ? ICNS.unarchive : ICNS.archive;
    archBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      archiveBoard(bd.id, !isArchived);
      renderManageList();
    });
    actions.appendChild(archBtn);

    if (state.boards.length > 1) {
      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "manage-delete";
      delBtn.setAttribute("title", t("board.delete"));
      delBtn.innerHTML = ICNS.trash;
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteBoard(bd.id);
        renderManageList();
      });
      actions.appendChild(delBtn);
    }

    row.appendChild(actions);
    return row;
  }

  // Inline swatches (②) — εμφανίζονται κάτω από τη row που τα ζήτησε
  var manageSwatchRow = null;

  function toggleManageSwatches(bd, row) {
    // Ήδη ανοιχτά για αυτή τη row → κλείσιμο (toggle)
    if (manageSwatchRow && manageSwatchRow.dataset.forBoardId === bd.id) {
      manageSwatchRow.remove();
      manageSwatchRow = null;
      return;
    }
    if (manageSwatchRow) { manageSwatchRow.remove(); manageSwatchRow = null; }

    var host = $("manage-list");
    if (!host) return;

    var sw = document.createElement("div");
    sw.className = "manage-swatches";
    sw.dataset.forBoardId = bd.id;

    // «Καθαρό» = fallback χρώμα (accent) — πρώτη επιλογή
    var swatches = SWATCH_COLORS.slice();
    swatches.unshift(null);
    swatches.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lbl-swatch" + ((bd.color || FALLBACK_COLOR) === (c || FALLBACK_COLOR) ? " sel" : "");
      b.style.background = c || FALLBACK_COLOR;
      b.addEventListener("click", function () {
        bd.color = c || undefined;
        bd.mtime = Date.now();           // LWW στο merge
        save();
        renderManageList();
        renderAll();                     // φρεσκάρει το dropdown dot
      });
      sw.appendChild(b);
    });
    host.insertBefore(sw, row.nextSibling);
    manageSwatchRow = sw;
  }

  // Icon constants (inline SVG for management UI)
  var ICNS = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
    pencil: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    archive: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    unarchive: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></svg>'
  };

  var editingBoardId = null;

  function renameCurrentBoard(boardId) {
    var bd = boardByIdIn(state.boards, boardId);
    if (!bd) return;

    editingBoardId = boardId;

    $("b-name").value = bd.name;
    $("dlg-board").showModal();
    setTimeout(function () { $("b-name").focus(); $("b-name").select(); }, 50);
  }

  // Commit σε οποιονδήποτε δρόμο κλεισίματος (Save, Esc, backdrop) —
  // ίδιο pattern με το column dialog. Zero-edit close ΔΕΝ stampάρει
  // mtime (το όνομα δεν άλλαξε → κανένα κλείδωμα LWW στο merge).
  $("dlg-board").addEventListener("close", function () {
    if (editingBoardId === null) return;
    var bd = boardByIdIn(state.boards, editingBoardId);
    editingBoardId = null;
    if (!bd) return;                    // π.χ. διαγράφηκε στο μεταξύ

    var name = $("b-name").value.trim();
    if (name && name !== bd.name) {
      bd.name = name;
      bd.mtime = Date.now();           // board header edit = δομικό LWW
    }
    save(); scheduleRender();
    renderManageList();                 // noop αν το manage dialog είναι κλειστό
  });

  function duplicateBoard(boardId) {
    var bd = boardByIdIn(state.boards, boardId);
    if (!bd) return;

    pushUndo("toast.duplicated");   // το κείμενο της ΕΝΕΡΓΕΙΑΣ — το Undo ζει (was: toast.undone)

    var copy = {
      id: uid(),
      name: bd.name + t("dup.suffix"),
      archived: bd.archived,            // v0.6.1: duplicate keeps color/archive state
      color: bd.color || undefined,
      mtime: Date.now(),
      om: Date.now(),
      deleted: JSON.parse(JSON.stringify(bd.deleted || {})),
      labels: JSON.parse(JSON.stringify(bd.labels || [])),
      columns: bd.columns.map(function (col) {
        var nc = newColumnObj(col.name);
        nc.mtime = Date.now();
        nc.om = Date.now();
        nc.cards = col.cards.map(function (c) {
          var ncard = newCardObj(c.text);
          ncard.notes = c.notes || "";
          ncard.due = c.due || null;
          ncard.labels = c.labels.slice();
          ncard.subtasks = JSON.parse(JSON.stringify(c.subtasks || []));
          ncard.info = JSON.parse(JSON.stringify(c.info || []));
          ncard.subtasks.forEach(function (s) { s.id = uid(); });
          ncard.info.forEach(function (f) { f.id = uid(); });
          touch(ncard);
          ncard.pos = 0;
          return ncard;
        });
        nc.cards.forEach(function (c, i) { c.pos = i; });
        nc.pos = 0;
        return nc;
      })
    };

    state.om = Date.now();
    state.boards.push(copy);
    state.activeBoardId = copy.id;

    save();
    renderAll();
    renderManageList();  // #32: keep manage dialog in sync
    // Δεν υπάρχει δεύτερο toast — η pushUndo() από πάνω κρατάει το Undo ζωντανό
  }

  function deleteBoard(boardId) {
    var bd = boardByIdIn(state.boards, boardId);
    if (!bd) return;

    confirmDialog("confirm.boarddel", function () {

      pushUndo("toast.boarddel");   // το κείμενο της ΕΝΕΡΓΕΙΑΣ — το Undo ζει (was: toast.undone)

    // Root-level board tombstone (state.boardDeleted) — το ΜΟΝΟ σημείο που
    // κοιτάζει το mergeKanbanStates/boardAlive. Tombstones μέσα στο bd
    // χάνονται μαζί του (το board φεύγει από state.boards) — ΔΕΝ γράφουμε
    // εκεί. Το root tombstone πεθαίνει το board συνολικά (καμία ανάσταση,
    // τα περιεχόμενα πεθαίνουν cascade με την boardAlive ερώτηση).
    if (!state.boardDeleted) state.boardDeleted = {};
    state.boardDeleted[boardId] = Date.now();

    // Remove from boards[]
    state.boards = state.boards.filter(function (b) { return b.id !== boardId; });
    state.om = Date.now();

    // If we deleted the active board, switch to another
    if (state.activeBoardId === boardId) {
      state.activeBoardId = state.boards.length > 0 ? state.boards[0].id : null;
    }

            save(); renderAll();
      });
  }

  // Archive = soft-hide (browser-bar αποκρύβεται από dropdown), ΟΧΙ διαγραφή.
  // Το board παραμένει στο state.boards και συγχρονίζεται κανονικά —
  // ΔΕΝ γράφεται root tombstone, άρα καμία απώλεια δεδομένων.
  // Τα δεδομένα του συνεχίζουν να ζουν στο merge (union by id)·
  // sync-safe: το `archived` flag είναι LWW μέσω board.mtime.
  function archiveBoard(boardId, archived) {
    var bd = boardByIdIn(state.boards, boardId);
    if (!bd) return;

    if (archived) {
      // Δεν αρχειοθετούμε το τελευταίο ενεργό board
      var live = state.boards.filter(function (b) { return !b.archived; });
      if (live.length <= 1 && !bd.archived) {
        notifyTransient(t("toast.boardarchlast"));
        return;
      }
    }

    bd.archived = !!archived;
    bd.mtime = Date.now();               // LWW στο merge

    // Αν αρχειοθετήσαμε το ενεργό board, πήδα στο πρώτο ζωντανό
    if (archived && state.activeBoardId === boardId) {
      var next = state.boards.filter(function (b) { return !b.archived; })[0];
      if (next) switchBoard(next.id);
    }

    save(); renderAll();
    notifyTransient(archived ? t("toast.boardarchived") : t("toast.boardunarchived"));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 3b. Render: columns + cards (board-scoped) ----------
  function makeColumnEl(col) {
    var el = document.createElement("div");
    el.className = "k-col";
    el.dataset.colId = col.id;

    // Head: title (dblclick → rename) + rename pencil + visible count.
    // Όλο το head είναι η λαβή drag της στήλης.
    var head = document.createElement("div");
    head.className = "col-head";

    var title = document.createElement("span");
    title.className = "col-title";
    title.textContent = col.name;
    title.title = col.name;
    title.addEventListener("dblclick", function () { openColDialog(col.id); });
    head.appendChild(title);

    // Rename pencil (#22) — ίδιο dialog με dblclick, πάντα ορατό
    var rename = document.createElement("button");
    rename.type = "button";
    rename.className = "col-rename";
    rename.setAttribute("aria-label", t("col.rename"));
    rename.title = t("col.rename");
    rename.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
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

    // Body: οι ορατές κάρτες
    var body = document.createElement("div");
    body.className = "col-body";
    col.cards.forEach(function (card) {
      if (!cardMatchesView(card)) return;
      body.appendChild(makeCardEl(col, card));
    });
    el.appendChild(body);

    // Foot: quick-add (input + φιλικό προς ποντίκι κουμπί)
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

    // Column reorder drag — το head είναι η λαβή (αφού υπάρχει πια)
    attachColDrag(head, el, col);

    return el;
  }
  
    // --- Due date formatting ---
  // KN-6: τοπικός (όχι UTC) υπολογισμός του "today/tomorrow". Το
  // toISOString() είναι UTC — στη Ελλάδα μεταξύ τοπικής και UTC
  // μεσονυκτίου (~00:00–03:00 καλοκαίρι) το chip έδειχνε λάθος
  // μέρα: κάρτα "σήμερα" ως Tomorrow, "χθες" ως Today. Το card.due
  // από το <input type="date"> είναι πάντα ΤΟΠΙΚΗ ημερομηνία.
  // Επίσης manual parse του ISO date: το date-only string γίνεται
  // UTC midnight — σε αρνητικά UTC offsets το getDate() επέστρεφε
  // την προηγούμενη μέρα. Display-only: δεν αγγίζει data/sync/feed.
  function localDateStr(d) {
    return d.getFullYear() + "-" +
           String(d.getMonth() + 1).padStart(2, "0") + "-" +
           String(d.getDate()).padStart(2, "0");
  }

  function formatDateChip(isoDate) {
    if (!isoDate) return null;
    var now = new Date();
    var todayStr = localDateStr(now);        // τοπικό "YYYY-MM-DD"
    var tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var tomorrowStr = localDateStr(tomorrow);

    var label, colorClass;
    if (isoDate === todayStr) {
      label = t("card.due.today");
      colorClass = "due-today";
    } else if (isoDate === tomorrowStr) {
      label = t("card.due.tomorrow");
      colorClass = "due-today";  // ίδιο χρώμα με το "today"
    } else if (isoDate < todayStr) {
      label = t("card.overdue");
      colorClass = "due-overdue";
    } else {
      var parts = isoDate.split("-");
      var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);  // τοπικό μεσονύκτιο
      var dd = String(d.getDate()).padStart(2, "0");
      var mm = d.toLocaleString(LANG === "el" ? "el" : "en", { month: "short" }).replace(".", "");
      // ΕΛ: "19 Σεπ" | EN: "19 Sep"
      label = dd + " " + mm;
      colorClass = "due-future";
    }
    return { label: label, css: colorClass };
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

    // Label chips πάνω στην κάρτα
    if (card.labels && card.labels.length > 0) {
      var chipHost = document.createElement("div");
      chipHost.className = "chips";
      card.labels.forEach(function (lid) {
        var label = labelById(lid);          // board-scoped (βλ. Part 1)
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

    // Subtask progress chip: "x/y" + slim bar (μόνο με subtasks)
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

    // Due date chip (Kanban → Calendar integration)
    if (card.due) {
      var fmt = formatDateChip(card.due);
      if (fmt) {
        var dueEl = document.createElement("div");
        dueEl.className = "due-chip " + fmt.css;
        dueEl.textContent = fmt.label;
        dueEl.title = card.due;  // full ISO date σε tooltip
        el.appendChild(dueEl);
      }
    }

    // Extra info preview: μία dim, περικομμένη γραμμή "label: value · …"
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

  // ---------- 4. Quick-add (board-scoped: touch στο board header επίσης) ----------
  function quickAdd(col, input) {
    var board = currentBoard();
    if (!board) return;
    var raw = input.value.trim();
    if (!raw) return;
    var card = newCardObj(raw);          // φρέσκο mtime — νέα οντότητα
    col.cards.unshift(card);
    col.cards.forEach(function (c, i) { c.pos = i; });
    col.om = Date.now();   // top-insert = ORDERING decision: αυτή η πλευρά
                           // κερδίζει τη σειρά στο επόμενο merge (v0.5b)
    input.value = "";
    save(); scheduleRender();
    // Επαν-εστίαση στο φρέσκο input (το render αντικατέστησε τον παλιό κόμβο)
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

  // ---------- 5. Card dialog (live editing — board-scoped lookups) ----------
  var editingColId = null;
  var editingCardId = null;
  var pickedSwatch = FALLBACK_COLOR;     // νέο-ετικέτας χρώμα (accent default)
  var openCardSnapshot = null;   // v0.5b: zero-edit close δεν stampάρει mtime

  function cardFingerprint(card) {
    return JSON.stringify([
      card.text, card.notes || "", card.due || null,
      card.subtasks || [], card.info || [],
      (card.labels || []).slice().sort()
    ]);
  }

  // LIVE SAVE: το τυπώμενο κείμενο γράφεται στο state + localStorage
  // άμεσα (debounce 250ms) — καμία απώλεια αν κλείσει ξαφνικά το tab
  // με ανοιχτό το διάλογο. Το mtime stampάρεται (touch) ώστε η live
  // έκδοση να κερδίζει και στο merge. Το close handler παραμένει ως
  // safety net (filtration κενών info rows + zero-edit check).
  var liveSaveTimer = null;
  function liveSaveCard() {
    clearTimeout(liveSaveTimer);
    liveSaveTimer = setTimeout(function () {
      var card = editingCard();
      if (!card) return;
      card.text  = $("c-text").value;
      card.notes = $("c-notes").value;
      touch(card);
      save();
      scheduleRender();               // το board πίσω από το dialog φρεσκάρει
    }, 250);
  }

  // Η κάρτα που είναι αυτή τη στιγμή ανοιχτή στο διάλογο (ή null).
  // Κοιτάζει by-id στο board TOY state — μετά από merge δείχνει
  // στη merged εκδοχή.
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
    $("c-due").value = card.due || "";   // "" = cleared (native date input)

    renderCardLabels(card);
    renderSubtasks(card);
    renderInfo(card);
    $("c-lbl-picker").hidden = true;

    openCardSnapshot = cardFingerprint(card);

    $("dlg-card").showModal();
    setTimeout(function () { $("c-text").focus(); }, 50);
  }

  // --- Labels μέσα στο card dialog (board-scoped: labelById) ---
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
        touch(card);
        save(); scheduleRender();
        renderCardLabels(card);
      });
      host.appendChild(chip);
    });
  }

  function renderLblPicker() {
    var list = $("c-lbl-list");
    list.innerHTML = "";

    var board = currentBoard();
    if (!board) return;

    if (board.labels.length === 0) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("labels.none");
      list.appendChild(none);
      return;
    }

    var card = editingCard();
    board.labels.forEach(function (label) {
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
        touch(c);                     // attach/detach = αλλαγή περιεχομένου
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
    var board = currentBoard();
    if (!board) return;
    var input = $("c-lbl-name");
    var name = input.value.trim();
    if (!name) return;

    var label = {
      id: uid(), name: name, color: pickedSwatch,
      mtime: Date.now(), pos: board.labels.length
    };
    board.labels.push(label);

    var card = editingCard();
    if (card) { card.labels.push(label.id); touch(card); }

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (card) renderCardLabels(card);
    renderLblPicker();
    input.focus();                      // διατηρεί focus → γρήγορα batch ετικετών
    notifyTransient(t("toast.labeladd"));
  }

  // --- Subtasks μέσα στο card dialog ---
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
      touch(card);
      save();
      scheduleRender();
    });
    row.appendChild(cb);

    var txt = document.createElement("input");
    txt.type = "text";
    txt.className = "s-text" + (sub.completed ? " completed" : "");
    txt.value = sub.text;
    txt.autocomplete = "off";
    txt.addEventListener("input", function () { sub.text = txt.value; liveSaveCard(); });
    row.appendChild(txt);

    row.appendChild(makeRemoveBtn(function () {
      card.subtasks = card.subtasks.filter(function (s) { return s !== sub; });
      touch(card);
      save();
      scheduleRender();
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
    touch(card);
    save();
    scheduleRender();
    renderSubtasks(card);
    input.focus();
  }

  // --- Extra info μέσα στο card dialog ---
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
    lbl.addEventListener("input", function () { f.label = lbl.value; liveSaveCard(); });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.className = "i-value";
    val.setAttribute("placeholder", t("card.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () { f.value = val.value; liveSaveCard(); });
    row.appendChild(val);

    row.appendChild(makeRemoveBtn(function () {
      card.info = card.info.filter(function (x) { return x !== f; });
      touch(card);
      save();
      scheduleRender();
      renderInfo(card);
    }));

    return row;
  }

  function addInfo() {
    var card = editingCard();
    if (!card) return;
    card.info.push({ id: uid(), label: "", value: "" });
    renderInfo(card);
    var rows = $("c-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector(".i-label");
      if (l) l.focus();
    }
  }

  // --- Duplicate card ---
  function duplicateCard() {
    var col = colById(editingColId);
    var card = editingCard();
    if (!col || !card) return;

    var copy = newCardObj(card.text + t("dup.suffix"));
    copy.notes = card.notes || "";
    copy.due = card.due || null;
    copy.labels = card.labels.slice();
    copy.subtasks = JSON.parse(JSON.stringify(card.subtasks || []));
    copy.info = JSON.parse(JSON.stringify(card.info || []));
    copy.subtasks.forEach(function (s) { s.id = uid(); });
    copy.info.forEach(function (f) { f.id = uid(); });
    touch(copy);                        // φρέσκο mtime — νικά το merge ως ΝΕΑ οντότητα

    var idx = col.cards.indexOf(card);
    col.cards.splice(idx + 1, 0, copy);
    stampColOrder(col);                 // νέα σειρά τοποθέτησης στη στήλη

    save(); scheduleRender();
    notifyTransient(t("toast.duplicated"));
  }

  function stampColOrder(col) {
    col.om = Date.now();
    col.cards.forEach(function (c, i) { c.pos = i; });
  }

  // Flush typed-but-unsaved text όταν το dialog κλείνει από ΟΠΟΙΟΔΗΠΟΤΕ
  // path (Save, Esc) — καμία απώλεια δεδομένων. Zero-edit close δεν
  // stampάρει mtime (identical fingerprint).
  $("dlg-card").addEventListener("close", function () {
    if (editingColId === null) return;
    var card = editingCard();
    editingColId = null;
    editingCardId = null;
    if (!card) return;
    card.info = (card.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
    card.text  = $("c-text").value.trim() || card.text;
    card.notes = $("c-notes").value;

    if (openCardSnapshot !== null &&
        cardFingerprint(card) === openCardSnapshot) {
      openCardSnapshot = null;
      return;
    }
    openCardSnapshot = null;

    touch(card);
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

  // Ξεχωριστό id-tracking για το column dialog (δεν συγκρούεται με το
  // card dialog editingColId — καθαρίζεται στα αντίστοιχα handlers)
  function createColumn() {
    var board = currentBoard();
    if (!board) return;
    var col = newColumnObj(t("new.col"));
    col.pos = board.columns.length;
    board.om = Date.now();           // v0.6: η σειρά στηλών ζει στο board
    board.columns.push(col);
    board.columns.forEach(function (c, i) { c.pos = i; });
    save(); scheduleRender();
    openColDialog(col.id);     // κατευθείαν στις ρυθμίσεις για ονομασία
  }

  // ---------- 7. Search & filter (session-only, board-scoped) ----------
  var searchQuery = "";
  var activeFilters = [];

  function cardMatchesView(card) {
    if (searchQuery && !matchesSearch(card)) return false;
    if (activeFilters.length > 0 && !matchesFilters(card)) return false;
    return true;
  }

  function matchesSearch(card) {
    if ((card.text || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if ((card.notes || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    if (card.due && card.due.toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var i = 0; i < (card.info || []).length; i++) {
      var f = card.info[i];
      if ((f.label || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
      if ((f.value || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    for (var j = 0; j < (card.labels || []).length; j++) {
      var label = labelById(card.labels[j]);      // board-scoped
      if (label && label.name.toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
    return false;
  }

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

    var board = currentBoard();
    if (!board) return;

    if (board.labels.length === 0) {
      var e = document.createElement("div");
      e.className = "fl-empty";
      e.textContent = t("filter.empty");
      pop.appendChild(e);
      return;
    }

    board.labels.forEach(function (label) {
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
        confirmDialog("confirm.lbldel", function () {
          deleteLabel(label.id);
        });
      });
      item.appendChild(del);

      pop.appendChild(item);
    });
  }

  // Διαγραφή ετικέτας — board-scoped tombstones (merge-safe)
  function deleteLabel(labelId) {
    var board = currentBoard();
    if (!board) return;
    pushUndo("toast.labeldel");
    board.labels = board.labels.filter(function (l) { return l.id !== labelId; });
    board.columns.forEach(function (col) {
      col.cards.forEach(function (card) {
        var had = (card.labels || []).indexOf(labelId) !== -1;
        card.labels = (card.labels || []).filter(function (id) { return id !== labelId; });
        if (had) touch(card);       // αφαίρεση ετικέτας = αλλαγή περιεχομένου
      });
    });
    tombstone(board, labelId);       // merge-safe διαγραφή (board-scoped)
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var card = editingCard();
    if (card) renderCardLabels(card);
    // toast + Undo button from pushUndo() above
  }

  // ---------- 8. Card drag & drop (board-scoped) ----------
  var DRAG_THRESHOLD = 8;

  function attachCardDrag(el, col, card) {
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;   // μόνο primary
      if ($("dlg-card").open) return;

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        el.classList.add("dragging");
        el.style.pointerEvents = "none";   // elementFromPoint βλέπει ΜΕΣΑ από εμάς
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

        if (!started) return;              // ήταν tap — τίποτα προς αναίρεση

        var hit = document.elementFromPoint(ev.clientX, ev.clientY);

        el.classList.remove("dragging");
        el.style.pointerEvents = "";
        document.body.classList.remove("is-dragging");
        clearMarks();

        if (!hit || !hit.closest) return;
        var destCard = hit.closest(".card");
        var destColEl = hit.closest(".k-col");

        var moved = false;
        if (destCard && destCard !== el) {
          var r = destCard.getBoundingClientRect();
          var before = ev.clientY < r.top + r.height / 2;
          moveCard(col, card,
                   destCard.closest(".k-col").dataset.colId,
                   destCard.dataset.cardId, before);
          moved = true;
        } else if (destColEl) {
          moveCard(col, card, destColEl.dataset.colId, null, false);
          moved = true;
        }

        if (moved) { save(); scheduleRender(); }
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

  // moveCard — board-scoped (colById κοιτάζει στο currentBoard)
  function moveCard(srcCol, card, destColId, beforeCardId, before) {
    var srcIdx = srcCol.cards.indexOf(card);
    if (srcIdx === -1) return;
    var dest = colById(destColId);        // board-scoped lookup
    if (!dest) return;

    srcCol.cards.splice(srcIdx, 1);

    var at = dest.cards.length;
    if (beforeCardId) {
      var bi = -1;
      dest.cards.forEach(function (c, i) { if (c.id === beforeCardId) bi = i; });
      if (bi !== -1) at = before ? bi : bi + 1;
    }
    dest.cards.splice(at, 0, card);

    var sameCol = srcCol.id === destColId;
    var nowMs = Date.now();

    if (sameCol) {
      srcCol.om = nowMs;
      srcCol.cards.forEach(function (c, i) { c.pos = i; });
    } else {
      touch(card);
      srcCol.om = nowMs;
      dest.om = nowMs;
      srcCol.cards.forEach(function (c, i) { c.pos = i; });
      dest.cards.forEach(function (c, i) { c.pos = i; });
    }
  }

  // ---------- 8b. Column drag reorder (board-scoped) ----------
  function attachColDrag(headEl, colEl, col) {
    headEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest(".col-rename")) return;
      if ($("dlg-card").open || $("dlg-col").open) return;

      var board = currentBoard();
      if (!board || board.columns.length < 2) return;   // τίποτα προς αναδιάταξη

      var started = false;
      var sx = e.clientX, sy = e.clientY;

      function beginDrag() {
        started = true;
        colEl.classList.add("drag-src");
        colEl.style.pointerEvents = "none";
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

        if (!started) return;              // tap/dblclick start — noop

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

  // moveColumn — board-scoped: stamps το board.om (όχι το root state.om)
  function moveColumn(srcCol, destColId, before) {
    var board = currentBoard();
    if (!board) return;

    var from = board.columns.indexOf(srcCol);
    if (from === -1) return;

    board.columns.splice(from, 1);

    var to = -1;
    for (var i = 0; i < board.columns.length; i++) {
      if (board.columns[i].id === destColId) { to = i; break; }
    }
    if (to === -1) {                     // paranoia — restore source
      board.columns.splice(from, 0, srcCol);
      return;
    }

    board.columns.splice(before ? to : to + 1, 0, srcCol);
    board.om = Date.now();               // v0.6: η σειρά στηλών ανήκει στο board
    board.columns.forEach(function (c, i) { c.pos = i; });
  }

  // ---------- 9. Undo / toast ----------
  var undoSnapshot = null;
  var toastTimer = null;

  function pushUndo(key) {
    undoSnapshot = JSON.stringify(state);     // ΟΛΟ το multi-board state
    showToast(t(key), true);
  }

  // Undo επαναφέρει ΟΛΟ το state (όλα τα boards) και το καθιερώνει
  // ως την πιο πρόσφατη αλήθεια σε ΟΛΑ τα επίπεδα (root om + board
  // om + mtimes) — κερδίζει το επόμενο merge και διαδίδεται.
  function stampAllState() {
    var nowMs = Date.now();
    state.om = nowMs;
    (state.boards || []).forEach(function (board) {
      stampAll(board);                       // board-scoped stampAll (βλ. Part 1)
    });
  }

  function doUndo() {
    if (!undoSnapshot) return;
    state = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    stampAllState();          // το restored snapshot είναι η πιο ΝΕΑ αλήθεια
    save(); renderAll();
    notifyTransient(t("toast.undone"));
  }

  function showToast(text, withUndo) {
    var el = $("toast");
    if (!el) return;
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

    void el.offsetWidth;                 // επανεκκίνηση transition
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  
  // ---------- 10. Undo / toast (closing handlers) ----------
  // Το close handler του card dialog ολοκληρώνεται εδώ —
  // έχει ήδη οριστεί στο Part 4 (μέσα στην IIFE).
  
  // Column dialog: v0.6b — commit σε ΟΠΟΙΟΔΗΠΟΤΕ δρόμο κλεισίματος
  $("dlg-col").addEventListener("close", function () {
    if (editingColId === null) return;
    var col = colById(editingColId);
    editingColId = null;
    if (!col) return;
    var name = $("col-name").value.trim();
    if (name && name !== col.name) {
      col.name = name;
      touch(col);   // header edit = δομικό LWW
    }
    save(); scheduleRender();
  });
  
  // ---------- 10b. Calendar deep-link consumer (Kanban ↔ Calendar) ----------
  // Live path: το shell (window.__orosOpenKanbanCard) καλεί απευθείας
  // εδώ όταν το Kanban τρέχει ήδη. Cold path: το shell stageάρει το
  // payload στο sessionStorage["oros-kanban-open"] και κάνει
  // openAppById("kanban") — το boot() το καταναλώνει one-shot.
  //
  // Guards (καθαρή σιωπή — τίποτα δεν ανοίγει, τίποτα δεν σπάει):
  //   · board δεν υπάρχει ή είναι archived → return (δεν αγγίζουμε
  //     το «τουλάχιστον ένα board ενεργό»: δεν αρχειοθετούμε ποτέ εδώ)
  //   · στήλη/κάρωα δεν βρέθηκαν → το openCardDialog κάνει ήδη silent return
  //   · card dialog ήδη ανοιχτό → κλείνει πρώτα (commit-flush), αλλιώς
  //     το showModal() πετάει InvalidStateError
  window.__orosKanbanOpen = function (payload) {
    if (!payload || typeof payload !== "object" || !state) return;

    var bd = boardByIdIn(state.boards, payload.board);
    if (!bd || bd.archived) return;     // διαγράφηκε/αρχειοθετήθηκε στο μεταξύ

    // Board switch: device-local + silent (saveLocal, ΟΧΙ sync dirty).
    // Πάντα resetSessionView — παλιό search/filter κρύβει την κάρτα-στόχο.
    if (state.activeBoardId !== payload.board) {
      switchBoard(payload.board);       // self-guarded + silent + renderAll
    } else {
      resetSessionView();
      saveLocal();
      scheduleRender();
    }

    // Κλείσιμο τυχόν ανοιχτού card dialog πριν το νέο άνοιγμα
    var dlg = $("dlg-card");
    if (dlg && dlg.open) dlg.close();

    // colById/cardById κοιτούν πια στο currentBoard (= payload.board).
    // Αν δεν βρεθούν → openCardDialog επιστρέφει σιωπηλά.
    openCardDialog(payload.col, payload.card);
  };

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
    var ph = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < ph.length; k++) {
      ph[k].setAttribute("placeholder", t(ph[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // --- New column (board-scoped) ---
    var colAddBtn = $("col-add");
    if (colAddBtn) {
      colAddBtn.addEventListener("click", createColumn);
    }

    // --- Search ---
    var searchInput = $("search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        searchQuery = this.value.trim().toLowerCase();
        var sc = $("search-clear");
        if (sc) sc.hidden = !searchQuery;
        scheduleRender();
      });
    }
    
    var searchClear = $("search-clear");
    if (searchClear) {
      searchClear.addEventListener("click", function () {
        var si = $("search");
        if (si) si.value = "";
        searchQuery = "";
        if (searchClear) searchClear.hidden = true;
        scheduleRender();
        if (searchInput) searchInput.focus();
      });
    }

    // --- Filter popover: toggle + κλείσιμο με εξωτερικό κλικ ---
    var filterBtn = $("filter-btn");
    if (filterBtn) {
      filterBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var pop = $("filter-pop");
        if (pop) {
          pop.hidden = !pop.hidden;
          if (!pop.hidden) renderFilterPop();
        }
      });
    }
    
    document.addEventListener("click", function (e) {
      var pop = $("filter-pop");
      if (pop && !e.target.closest("#filter-slot")) {
        pop.hidden = true;
      }
    });

    // --- Card dialog ---
    // Text/notes flush στο κλείσιμο του dialog — handled above
    // + LIVE SAVE στο input (καμία απώλεια σε αιφνίδιο κλείσιμο tab)
    var cTextInput = $("c-text");
    var cNotesInput = $("c-notes");
    if (cTextInput)  cTextInput.addEventListener("input", liveSaveCard);
    if (cNotesInput) cNotesInput.addEventListener("input", liveSaveCard);

    // Due date — live save, ΞΕΧΩΡΙΣΤΟ handler (όχι το liveSaveCard):
    // το date input δεν περνάει από text flush στο close handler.
    var cDueInput = $("c-due");
    if (cDueInput) {
      cDueInput.addEventListener("input", function () {
        var card = editingCard();
        if (!card) return;
        card.due = cDueInput.value || null;   // "" → null (cleared)
        touch(card);
        save();
        scheduleRender();       // date chip πίσω από το dialog φρεσκάρει
      });
      cDueInput.addEventListener("change", function () {
        var card = editingCard();
        if (!card) return;
        card.due = cDueInput.value || null;
        touch(card);
        save();
        scheduleRender();
      });
    }

    var cardForm = $("card-form");
    if (cardForm) {
      cardForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var dlg = $("dlg-card");
        if (dlg) dlg.close();
      });
    }

    // Delete card
    var cDelete = $("c-delete");
    if (cDelete) {
      cDelete.addEventListener("click", function () {
        confirmDialog("confirm.carddel", function () {
            var col = colById(editingColId);
          if (col) {
            pushUndo("toast.deleted");
            var board = currentBoard();
            tombstone(board, editingCardId);
            col.cards = col.cards.filter(function (c) { return c.id !== editingCardId; });
          }
          editingColId = null;
          editingCardId = null;
          var dlg = $("dlg-card");
          if (dlg) dlg.close();
          save(); scheduleRender();
        });
      });
    }

    // Labels (within dialog)
    var lblToggle = $("c-lbl-toggle");
    var lblPicker = $("c-lbl-picker");
    var lblNewAdd = $("c-lbl-new-add");
    var lblName = $("c-lbl-name");
    
    if (lblToggle && lblPicker) {
      lblToggle.addEventListener("click", function () {
        if (lblPicker.hidden) {
          renderLblPicker();
          renderLblSwatches();
          lblPicker.hidden = false;
        } else {
          lblPicker.hidden = true;
        }
      });
    }
    
    if (lblNewAdd && lblName) {
      lblNewAdd.addEventListener("click", createNewLabel);
      lblName.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); createNewLabel(); }
      });
    }

    // Subtasks
    var subAdd = $("c-sub-add");
    var subNew = $("c-sub-new");
    if (subAdd && subNew) {
      subAdd.addEventListener("click", addSubtask);
      subNew.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); addSubtask(); }
      });
    }

    // Extra info
    var infoAdd = $("c-info-add");
    if (infoAdd) {
      infoAdd.addEventListener("click", addInfo);
    }

    // Duplicate card
    var dupBtn = $("c-duplicate");
    if (dupBtn) {
      dupBtn.addEventListener("click", duplicateCard);
    }

    // --- Column dialog ---
    var colForm = $("col-form");
    if (colForm) {
      colForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var col = colById(editingColId);
        if (!col) {
          var dlg = $("dlg-col");
          if (dlg) dlg.close();
          return;
        }

        var name = $("col-name").value.trim();
        if (!name) return;

        if (name !== col.name) {
          col.name = name;
          touch(col);
        }
        editingColId = null;
        save(); scheduleRender();
        var dlg = $("dlg-col");
        if (dlg) dlg.close();
      });
    }

    var colDelete = $("col-delete");
    if (colDelete) {
      colDelete.addEventListener("click", function () {
        var col = colById(editingColId);
        if (!col) return;
        confirmDialog("confirm.coldel", function () {
          pushUndo("toast.coldel");
          var board = currentBoard();
          if (!board) return;
          tombstone(board, col.id);
          col.cards.forEach(function (c) { tombstone(board, c.id); });
          board.columns = board.columns.filter(function (c) { return c.id !== col.id; });
          if (board.columns.length === 0) {
            var fresh = newColumnObj(t("new.col"));
            fresh.pos = 0;
            board.columns.push(fresh);
          }
          board.om = Date.now();
          board.columns.forEach(function (c, i) { c.pos = i; });
          editingColId = null;
          var dlg = $("dlg-col");
          if (dlg) dlg.close();
          save(); renderAll();
        });
      });
    }

    // Ecosystem: capture-phase shortcut forwarding — τα modifier
    // combos (Ctrl/Alt/Meta) προωθούννονται στο shell ενώ το iframe
    // έχει focus, ώστε τα global shortcuts να λειτουργούν και μέσα
    // από την εφαρμογή. Τα απλά γράμματα (typing) ΔΕΝ προωθούνονται.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
      try {
        if (window.parent && window.parent !== window) {
          window.parent.dispatchEvent(new KeyboardEvent("keydown", {
            key: e.key, code: e.code,
            ctrlKey: e.ctrlKey, altKey: e.altKey,
            shiftKey: e.shiftKey, metaKey: e.metaKey,
            repeat: e.repeat
          }));
        }
      } catch (err) { /* standalone — αγνόησε */ }
    }, true);

    // Alt+B → γρήγορη δημιουργία νέου board (δεν συγκρούεται με
    // browser shortcuts — δεν υπάρχει browser reserve στο Alt+B)
    document.addEventListener("keydown", function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        closeBoardDropdown();
        if ($("manage-dialog") && $("manage-dialog").open) $("manage-dialog").close();
        createBoard();
      }
    });
  }

  function boot() {
    // BOOT MARKER (Part VII §16 + Checklist F): stale-bundle
    // detection (R3/R11) + lang attr at boot (F: i18N).
    var SCRIPT_V = "";
    (function () {
      var m = ((document.currentScript && document.currentScript.src) || "")
        .match(/[?&]v=([^&#]+)/);
      SCRIPT_V = m ? m[1] : "";
      document.documentElement.lang = LANG;
      console.log("kanban.js v" + (SCRIPT_V || "?") + " boot");
    })();

    applyI18n();
    load();
    wire();
    registerSync();       // ΠΡΕΠΕΙ μετά το load(): το sliceGet διαβάζει state
    inheritPalette();
    watchPalette();
    scheduleRender();

    // Cold path: payload staged από το shell (__orosOpenKanbanCard)
    // στο sessionStorage["oros-kanban-open"]. One-shot: το
    // __orosKanbanTakePending() κάνει JSON.parse + removeItem και
    // επιστρέφει {board, col, card} | null. Καμία εκκρεμότητα δεν
    // μένει πίσω — ακόμα κι αν το board/stήλη/κάρωα έχουν στο
    // μεταξύ διαγραφεί, το __orosKanbanOpen κάνει καθαρή σιωπή.
    // try/catch: σε standalone open (χωρίς parent) δεν σπάει το boot.
    try {
      var pending = window.parent &&
                    typeof window.parent.__orosKanbanTakePending === "function"
        ? window.parent.__orosKanbanTakePending()
        : null;
      if (pending) window.__orosKanbanOpen(pending);
    } catch (e) { /* standalone — δεν υπάρχει pending */ }
  }

  boot();
})();