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
  var PREFS_KEY   = "oros-kanban-prefs";        // device-local: { activeBoardId }
  var RESCUE_KEY  = "oros-kanban-data-broken";  // device-local: unreadable data kept aside
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
      "card.gone":        "This card was deleted on another device",
      "toast.quota":      "Storage is full — changes are not saved on this device",
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
      "import.title":     "Import from other apps",
      "import.hint":      "Supported: Kanri and Trello JSON exports. New boards are created — existing data is never touched.",
      "import.detected":  "Detected source:",
      "import.unknown":   "Unknown file — no Kanban data found.",
      "import.err":       "Could not read the file.",
      "import.run":       "Import",
      "toast.imported":   "Import completed",
      "import.boards":    "boards",
      "import.labels":    "labels",
      "color.blue":       "Blue",
      "color.green":      "Green",
      "color.red":        "Red",
      "color.purple":     "Purple",
      "color.yellow":     "Yellow",
      "color.orange":     "Orange",
      "color.gray":       "Gray",
    },
    el: {
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
      "card.gone":        "Η κάρτα διαγράφηκε σε άλλη συσκευή",
      "toast.quota":      "Ο χώρος αποθήκευσης γέμισε — οι αλλαγές δεν αποθηκεύονται σε αυτή τη συσκευή",
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
      "import.title":     "Εισαγωγή από άλλες εφαρμογές",
      "import.hint":      "Υποστηρίζονται: εξαγωγές JSON από Kanri και Trello. Δημιουργούνται νέα boards — τα υπάρχοντα δεδομένα δεν αγγίζονται.",
      "import.detected":  "Αναγνωρίστηκε προέλευση:",
      "import.unknown":   "Άγνωστο αρχείο — δεν βρέθηκαν δεδομένα Kanban.",
      "import.err":       "Δεν ήταν δυνατή η ανάγνωση του αρχείου.",
      "import.run":       "Εισαγωγή",
      "toast.imported":   "Η εισαγωγή ολοκληρώθηκε",
      "import.boards":    "boards",
      "import.labels":    "ετικέτες",
      "color.blue":       "Μπλε",
      "color.green":      "Πράσινο",
      "color.red":        "Κόκκινο",
      "color.purple":     "Μωβ",
      "color.yellow":     "Κίτρινο",
      "color.orange":     "Πορτοκαλί",
      "color.gray":       "Γκρι",
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
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e0) { raw = null; }
    try {
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.boards) && data.boards.length > 0) {
          state = data;
          // KN-7: the active board is device-local and lives in its own
          // key; a copy left inside the data (older versions) is only a
          // fallback for the first boot on this version.
          var pref = readPrefs().activeBoardId;
          if (pref && boardById(pref)) state.activeBoardId = pref;
          if (!state.activeBoardId || !boardById(state.activeBoardId)) {
            state.activeBoardId = state.boards[0].id;
          }

          // Prune tombstones in ALL boards
          state.boards.forEach(function (board) { pruneTombstones(board); });

          // Prune root-level board tombstones (v0.6.0) — 30ήμερος κανόνας
          if (state.boardDeleted) {
            var rootCut = Date.now() - TOMB_LIFETIME_MS;
            Object.keys(state.boardDeleted).forEach(function (id) {
              if (state.boardDeleted[id] < rootCut) delete state.boardDeleted[id];
            });
          }

          // KN-7: rewrite the stored copy in canonical form, quietly.
          // Opening the app is not an edit: no markDirty here.
          saveLocal();
          return;
        }
      }
    } catch (e) { /* unreadable → rescued below, then fresh start */ }

    // KN-12: stored data that cannot be read is copied aside BEFORE the
    // fresh board is written over it (Bible: rescue backup before any
    // reseed). Device-local key, never synced.
    if (raw) {
      try { localStorage.setItem(RESCUE_KEY, raw); } catch (e1) {}
    }

    // Fresh install: create one default board.
    //
    // SEEDS MUST BE DETERMINISTIC (v0.36.00 fix — "parallel Kanban
    // boards on fresh device" root cause). Fixed board id + mtime/om = 0
    // + fixed column ids mean:
    //   · every device computes IDENTICAL seed ids → the multi-board
    //     merge unions by board.id, so the seed COLLIDES with its
    //     remote twin (if any) and keeps ONE instance — no duplicates
    //   · mtime 0 = oldest possible → any real user edit, and any
    //     remote copy (which has mtime > 0), wins every LWW battle;
    //     the seed can never override real data or board order
    //   · root om 0 → a seeded device never claims board ordering
    //     authority over a device that actually reordered boards
    //   · root boardDeleted tombstone (ts > 0) always beats a
    //     mtime-0 seed → deleted default boards stay deleted
    // DO NOT use newBoardObj()/uid()/Date.now() for the seed —
    // newBoardObj stays for USER-created boards (real new entities
    // that must carry fresh ids/mtimes).
    state = {
      ver: DATA_VER,
      om: 0,
      activeBoardId: null,
      boards: []
    };

    var seedCols = (LANG === "el"
      ? ["Εκκρεμεί", "Σε εξέλιξη", "Ολοκληρωμένα"]
      : ["To Do", "Doing", "Done"])
      .map(function (n, i) {
        return {
          id: "kb-seed-col-" + i,          // deterministic per-position
          name: n,
          mtime: 0,
          om: 0,
          pos: i,
          cards: []
        };
      });

    state.boards.push({
      id: "kb-seed-main",                 // THE fixed seed board id
      name: LANG === "el" ? "Κύριο" : "Main",
      mtime: 0,
      om: 0,
      deleted: {},
      labels: [],
      columns: seedCols
    });
    state.activeBoardId = state.boards[0].id;

    save();
  }

  // KN-7: the stored copy is the canonical synced form (what sliceGet
  // returns, what a closed-app proxy uploads); the active board lives
  // in the device-local PREFS_KEY.
  var quotaWarned = false;
  function writeStore() {
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(canonState(state))); }
    catch (e) { ok = false; }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ activeBoardId: state.activeBoardId || null })); }
    catch (e2) {}
    if (!ok && !quotaWarned) {             // R30: say it once, never swallow
      quotaWarned = true;
      notifyTransient(t("toast.quota"));
    }
    if (undoAfterPending) {                // KN-10: state right after the action
      undoAfterPending = false;
      undoAfter = JSON.stringify(canonState(state));
    }
  }

  function readPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY));
      return (p && typeof p === "object") ? p : {};
    } catch (e) { return {}; }
  }

  function save() {
    writeStore();
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  // Silent save: γράφει ΜΟΝΟ στο localStorage, χωρίς markDirty.
  // Για καθαρά τοπικές ενέργειες (π.χ. switchBoard) που δεν πρέπει
  // να πυροδοτούν δικτυακό sync.
  function saveLocal() {
    writeStore();
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

    // KN-7: one canonical form for the merge result and the getter.
    return canonState({
      ver: DATA_VER,
      om: Math.max(a.om || 0, b.om || 0),
      boardDeleted: boardTomb,
      // activeBoardId ΔΕΝ θέτουμε εδώ — device-local, το κρατά
      // το sliceSet (υφιστάμενο αν το board ζει, αλλιώς πρώτο)
      boards: mergedBoards
    });
  }

  // ---------- KN-7: canonical synced form ----------
  // The engine compares JSON strings (R26). Getter and merge both end
  // here, so merge(get, get) === get and merge(A, B) === merge(B, A)
  // byte for byte:
  //   · no device-local fields (activeBoardId lives in PREFS_KEY);
  //   · tombstone maps with sorted keys, pruned by the same wall-clock
  //     rule the merge uses (KN-Q1);
  //   · known keys in a fixed order, unknown keys kept (sorted) so a
  //     newer version's fields survive a pass through this one;
  //   · pos = index everywhere (the merge's orderEntities does the same);
  //   · board flags normalized (archived boolean, color only when set).
  function canonOrder(obj, keys) {
    var out = {};
    keys.forEach(function (k) {
      if (obj[k] !== undefined) out[k] = obj[k];
    });
    Object.keys(obj).sort().forEach(function (k) {
      if (keys.indexOf(k) === -1 && obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }
  function canonTombs(map) {
    var out = {};
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(map || {}).sort().forEach(function (id) {
      var ts = map[id];
      if (typeof ts === "number" && ts >= cutoff) out[id] = ts;
    });
    return out;
  }
  var CARD_KEYS  = ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos"];
  var COL_KEYS   = ["id", "name", "mtime", "om", "pos", "cards"];
  var LABEL_KEYS = ["id", "name", "color", "mtime", "pos"];
  var BOARD_KEYS = ["id", "name", "archived", "color", "mtime", "om", "pos",
                    "deleted", "labels", "columns"];
  function canonState(src) {
    var s = JSON.parse(JSON.stringify(src || {}));
    var boards = (Array.isArray(s.boards) ? s.boards : []).map(function (b, bi) {
      var labels = (b.labels || []).map(function (lb, i) {
        lb.pos = i;
        return canonOrder(lb, LABEL_KEYS);
      });
      var columns = (b.columns || []).map(function (col, ci) {
        col.pos = ci;
        col.cards = (col.cards || []).map(function (c, ki) {
          c.pos = ki;
          return canonOrder(c, CARD_KEYS);
        });
        return canonOrder(col, COL_KEYS);
      });
      b.archived = !!b.archived;
      if (!b.color) delete b.color;
      b.pos = bi;
      b.deleted = canonTombs(b.deleted);
      b.labels = labels;
      b.columns = columns;
      return canonOrder(b, BOARD_KEYS);
    });
    delete s.activeBoardId;
    s.ver = DATA_VER;
    s.om = typeof s.om === "number" ? s.om : 0;
    s.boardDeleted = canonTombs(s.boardDeleted);
    s.boards = boards;
    return canonOrder(s, ["ver", "om", "boardDeleted", "boards"]);
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
    return canonState(state);            // KN-7: canonical, no device-local fields
  }

  // data — merged αποτέλεσμα (ή plain remote σε legacy LWW paths)
  // info — { merged: true } όταν η τιμή ήρθε μέσω mergeKanbanStates
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || Array.isArray(data.boards) === false || data.boards.length === 0) return;
    // KN-7: an echo of what this device already holds changes nothing.
    var same = JSON.stringify(canonState(data)) === JSON.stringify(canonState(state));

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
      writeStore();
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (same) return;

    scheduleRender();
    // KN-9: an open card dialog follows the merged card instead of
    // writing its stale copy back; the manage list rebinds too.
    refreshOpenCard();
    if ($("manage-dialog") && $("manage-dialog").open) renderManageList();
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
    // KN-8: the rebuild must not eat what the user is typing in a
    // quick-add field (a pull re-renders while the keyboard is up).
    var keep = captureQuick(host);
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
    restoreQuick(keep);

    // Filter popover update
    if (!$("filter-pop").hidden) renderFilterPop();
    updateFilterBtn();
  }

  function captureQuick(host) {
    var out = { vals: {}, focus: null };
    var cols = host.querySelectorAll(".k-col");
    for (var i = 0; i < cols.length; i++) {
      var q = cols[i].querySelector(".col-quick");
      if (!q) continue;
      var id = cols[i].dataset.colId;
      if (q.value) out.vals[id] = q.value;
      if (document.activeElement === q) {
        out.focus = { col: id, a: q.selectionStart, b: q.selectionEnd };
      }
    }
    return out;
  }
  function restoreQuick(keep) {
    if (!keep) return;
    Object.keys(keep.vals).forEach(function (id) {
      var q = findQuickInput(id);
      if (q) q.value = keep.vals[id];
    });
    if (keep.focus) {
      var f = findQuickInput(keep.focus.col);
      if (f) {
        f.focus();
        try { f.setSelectionRange(keep.focus.a, keep.focus.b); } catch (e) {}
      }
    }
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

    var importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "board-import";
    importBtn.setAttribute("title", t("import.title"));
    importBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
    importBtn.addEventListener("click", function () { openImportDlg(); });

    actions.appendChild(newBtn);
    actions.appendChild(importBtn);
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

    var impItem = document.createElement("button");
    impItem.type = "button";
    impItem.className = "dropdown-item";
    impItem.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> ' +
      t("import.title");
    impItem.addEventListener("click", function () {
      closeBoardDropdown();
      openImportDlg();
    });
    pop.appendChild(impItem);
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
        var live = boardByIdIn(state.boards, bd.id);   // KN-9: by id, never a stale copy
        if (!live) return;
        live.color = c || undefined;
        live.mtime = Date.now();         // LWW στο merge
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
  var lastGoodText = "";                 // restored on close if the text was emptied

  // LIVE SAVE (KN-9): every edit lands in the LIVE card object at once
  // and is stamped at once; only the write to storage is debounced
  // (250ms). A pull in between therefore merges the edit, and nothing
  // the dialog shows is ever written back later from a stale copy.
  var liveSaveTimer = null;
  var cardSavePending = false;
  function liveSaveCard() {
    var card = editingCard();
    if (!card) return;
    var tv = $("c-text").value;
    if (tv.trim()) lastGoodText = tv;
    card.text  = tv;
    card.notes = $("c-notes").value;
    touch(card);
    scheduleCardSave();
  }
  function scheduleCardSave() {
    cardSavePending = true;
    clearTimeout(liveSaveTimer);
    liveSaveTimer = setTimeout(function () {
      cardSavePending = false;
      save();
      scheduleRender();               // το board πίσω από το dialog φρεσκάρει
    }, 250);
  }

  // Η κάρτα που είναι αυτή τη στιγμή ανοιχτή στο διάλογο (ή null).
  // KN-9: by id across the columns of the board — after a merge it is
  // the merged object, also when another device moved the card to
  // another column (editingColId follows).
  function editingCard() {
    if (editingCardId === null) return null;
    var board = currentBoard();
    if (!board) return null;
    for (var i = 0; i < board.columns.length; i++) {
      var c = cardById(board.columns[i], editingCardId);
      if (c) { editingColId = board.columns[i].id; return c; }
    }
    return null;
  }

  function itemRef(list, item, idx) {
    // Subtasks / info rows by id; rows from old data may lack one.
    var arr = list || [];
    if (item && item.id) {
      for (var i = 0; i < arr.length; i++) if (arr[i].id === item.id) return arr[i];
      return null;
    }
    return arr[idx] || null;
  }

  // KN-9: a pull while the card dialog is open. Inputs follow the merged
  // card (the user's own edits are already in it: they were stamped at
  // the keystroke), lists are rebuilt from it, focus and caret stay.
  function setInputKeep(el, v) {
    if (!el || el.value === v) return;
    var focused = document.activeElement === el;
    var a = 0, b = 0;
    try { a = el.selectionStart; b = el.selectionEnd; } catch (e) {}
    el.value = v;
    if (focused) { try { el.setSelectionRange(Math.min(a, v.length), Math.min(b, v.length)); } catch (e2) {} }
  }
  function refreshOpenCard() {
    var dlg = $("dlg-card");
    if (!dlg || !dlg.open || editingCardId === null) return;
    var card = editingCard();
    if (!card) {
      // Deleted on another device after this device's last edit
      // (a later edit here would have kept it alive in the merge).
      clearTimeout(liveSaveTimer);
      cardSavePending = false;
      editingColId = null;
      editingCardId = null;
      dlg.close();
      notifyTransient(t("card.gone"));
      return;
    }
    if ((card.text || "").trim()) lastGoodText = card.text;
    setInputKeep($("c-text"), card.text || "");
    setInputKeep($("c-notes"), card.notes || "");
    setInputKeep($("c-due"), card.due || "");

    var ae = document.activeElement;
    var row = ae && ae.closest ? ae.closest(".sub-row, .info-row") : null;
    var focusInfo = null;
    if (row && dlg.contains(row)) {
      focusInfo = { kind: row.className.split(" ")[0], key: row.dataset.key,
                    cls: String(ae.className || "").split(" ")[0] };
      try { focusInfo.a = ae.selectionStart; focusInfo.b = ae.selectionEnd; } catch (e) {}
    }
    renderCardLabels(card);
    if (!$("c-lbl-picker").hidden) renderLblPicker();
    renderSubtasks(card);
    renderInfo(card);
    if (focusInfo && focusInfo.cls) {
      var rows = dlg.querySelectorAll("." + focusInfo.kind);
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.key !== focusInfo.key) continue;
        var inp = rows[i].querySelector("." + focusInfo.cls);
        if (inp) {
          inp.focus();
          try { inp.setSelectionRange(focusInfo.a, focusInfo.b); } catch (e3) {}
        }
        break;
      }
    }
  }

  function openCardDialog(colId, cardId) {
    var col = colById(colId);
    if (!col) return;
    var card = cardById(col, cardId);
    if (!card) return;

    editingColId = colId;
    editingCardId = cardId;
    lastGoodText = card.text || "";
    cardSavePending = false;

    $("c-text").value = card.text;
    $("c-notes").value = card.notes || "";
    $("c-due").value = card.due || "";   // "" = cleared (native date input)

    renderCardLabels(card);
    renderSubtasks(card);
    renderInfo(card);
    $("c-lbl-picker").hidden = true;

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
        var c = editingCard();             // KN-9: the live card, by id
        if (!c) return;
        c.labels = (c.labels || []).filter(function (id) { return id !== lid; });
        touch(c);
        save(); scheduleRender();
        renderCardLabels(c);
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
    (card.subtasks || []).forEach(function (sub, i) {
      host.appendChild(makeSubRow(card, sub, i));
    });
  }

  // KN-9: every handler resolves the LIVE card and row by id at the
  // moment of the action (a pull may have replaced both objects).
  function makeSubRow(card, sub, idx) {
    var row = document.createElement("div");
    row.className = "sub-row";
    row.dataset.key = sub.id ? "id:" + sub.id : "ix:" + idx;

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sub.completed;
    cb.addEventListener("change", function () {
      var c = editingCard();
      var s = c && itemRef(c.subtasks, sub, idx);
      if (!s) return;
      s.completed = cb.checked;
      txt.classList.toggle("completed", cb.checked);
      touch(c);
      save();
      scheduleRender();
    });
    row.appendChild(cb);

    var txt = document.createElement("input");
    txt.type = "text";
    txt.className = "s-text" + (sub.completed ? " completed" : "");
    txt.value = sub.text;
    txt.autocomplete = "off";
    txt.addEventListener("input", function () {
      var c = editingCard();
      var s = c && itemRef(c.subtasks, sub, idx);
      if (!s) return;
      s.text = txt.value;
      liveSaveCard();
    });
    row.appendChild(txt);

    row.appendChild(makeRemoveBtn(function () {
      var c = editingCard();
      var s = c && itemRef(c.subtasks, sub, idx);
      if (!s) return;
      c.subtasks = c.subtasks.filter(function (x) { return x !== s; });
      touch(c);
      save();
      scheduleRender();
      renderSubtasks(c);
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
    (card.info || []).forEach(function (f, i) {
      host.appendChild(makeInfoRow(card, f, i));
    });
  }

  function makeInfoRow(card, f, idx) {
    var row = document.createElement("div");
    row.className = "info-row";
    row.dataset.key = f.id ? "id:" + f.id : "ix:" + idx;

    var lbl = document.createElement("input");
    lbl.type = "text";
    lbl.className = "i-label";
    lbl.setAttribute("placeholder", t("card.info.label"));
    lbl.value = f.label;
    lbl.autocomplete = "off";
    lbl.addEventListener("input", function () {
      var c = editingCard();
      var x = c && itemRef(c.info, f, idx);
      if (!x) return;
      x.label = lbl.value;
      liveSaveCard();
    });
    row.appendChild(lbl);

    var val = document.createElement("input");
    val.type = "text";
    val.className = "i-value";
    val.setAttribute("placeholder", t("card.info.value"));
    val.value = f.value;
    val.autocomplete = "off";
    val.addEventListener("input", function () {
      var c = editingCard();
      var x = c && itemRef(c.info, f, idx);
      if (!x) return;
      x.value = val.value;
      liveSaveCard();
    });
    row.appendChild(val);

    row.appendChild(makeRemoveBtn(function () {
      var c = editingCard();
      var x = c && itemRef(c.info, f, idx);
      if (!x) return;
      c.info = c.info.filter(function (y) { return y !== x; });
      touch(c);
      save();
      scheduleRender();
      renderInfo(c);
    }));

    return row;
  }

  function addInfo() {
    var card = editingCard();
    if (!card) return;
    card.info.push({ id: uid(), label: "", value: "" });
    touch(card);                       // KN-9: the new row is local state now
    scheduleCardSave();
    renderInfo(card);
    var rows = $("c-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector(".i-label");
      if (l) l.focus();
    }
  }

  // --- Duplicate card ---
  function duplicateCard() {
    var card = editingCard();            // first: it updates editingColId
    var col = colById(editingColId);
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
  // KN-9: edits are already in the live card (stamped at the keystroke);
  // the close only trims the text, drops empty info rows and flushes a
  // pending write. A close without an edit writes and stamps nothing.
  $("dlg-card").addEventListener("close", function () {
    if (editingCardId === null) return;
    var card = editingCard();
    editingColId = null;
    editingCardId = null;
    clearTimeout(liveSaveTimer);
    var pending = cardSavePending;
    cardSavePending = false;
    if (!card) { if (pending) save(); return; }
    var changed = false;
    var info = (card.info || []).filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    });
    if (info.length !== (card.info || []).length) { card.info = info; changed = true; }
    var tt = $("c-text").value.trim() || (lastGoodText || "").trim() || card.text;
    if (tt !== card.text) { card.text = tt; changed = true; }
    if (changed) touch(card);
    if (changed || pending) { save(); scheduleRender(); }
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
  var undoSnapshot = null;       // canonical state BEFORE the action
  var undoAfter = null;          // canonical state right AFTER it (writeStore)
  var undoAfterPending = false;
  var undoActive = null;         // board that was open before the action
  var toastTimer = null;

  function pushUndo(key) {
    undoSnapshot = JSON.stringify(canonState(state));
    undoAfter = null;
    undoAfterPending = true;
    undoActive = state.activeBoardId;
    showToast(t(key), true);
  }

  // KN-10: Undo reverses only what the action itself changed (the diff
  // before → after), applied to the CURRENT state. The old Undo put the
  // whole snapshot back and re-stamped every card, column and label of
  // every board: whatever another device had changed in the meantime
  // was reverted everywhere, and a board created and already synced
  // came back at the next pull. Anything the user did not touch keeps
  // its stamp; a thing changed again since the action is left alone.
  function plain(x, drop) {
    var o = JSON.parse(JSON.stringify(x || {}));
    delete o.pos;
    (drop || []).forEach(function (k) { delete o[k]; });
    return JSON.stringify(o);
  }
  function indexById(arr) {
    var m = {};
    (arr || []).forEach(function (x, i) { m[x.id] = { v: x, i: i }; });
    return m;
  }
  function unionIds(a, b) {
    var ids = Object.keys(a);
    Object.keys(b).forEach(function (k) { if (ids.indexOf(k) === -1) ids.push(k); });
    return ids;
  }
  function revertList(beforeArr, afterArr, cur, field, now, drop, onInsert) {
    var bM = indexById(beforeArr), aM = indexById(afterArr);
    var touched = false;
    unionIds(bM, aM).forEach(function (id) {
      var pb = bM[id], pa = aM[id];
      var list = cur[field];
      var at = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { at = i; break; }
      if (pb && !pa) {                                   // removed by the action
        if (at !== -1) return;
        var nv = JSON.parse(JSON.stringify(pb.v));
        nv.mtime = now;
        if (onInsert) onInsert(nv);
        list.splice(Math.min(pb.i, list.length), 0, nv);
        if (cur.deleted) delete cur.deleted[id];
        touched = true;
      } else if (!pb && pa) {                            // created by the action
        if (at === -1) return;
        list.splice(at, 1);
        if (!cur.deleted) cur.deleted = {};
        cur.deleted[id] = now;
        touched = true;
      } else if (pb && pa && plain(pb.v, drop) !== plain(pa.v, drop)) {   // changed by it
        if (at === -1 || plain(list[at], drop) !== plain(pa.v, drop)) return;
        var keep = list[at];
        var rv = JSON.parse(JSON.stringify(pb.v));
        rv.mtime = now;
        if (keep.cards) rv.cards = keep.cards;           // a column keeps its live cards
        list[at] = rv;
      }
    });
    return touched;
  }
  function flatCards(board) {
    var m = {};
    ((board && board.columns) || []).forEach(function (col) {
      (col.cards || []).forEach(function (c, i) { m[c.id] = { v: c, i: i, col: col.id }; });
    });
    return m;
  }
  function revertBoard(pb, pa, cur, now) {
    var hdr = function (x) { return JSON.stringify([x.name, !!x.archived, x.color || null]); };
    if (hdr(pb) !== hdr(pa) && hdr(cur) === hdr(pa)) {
      cur.name = pb.name;
      cur.archived = !!pb.archived;
      if (pb.color) cur.color = pb.color; else delete cur.color;
      cur.mtime = now;
    }
    if (revertList(pb.labels, pa.labels, cur, "labels", now)) cur.om = now;
    if (revertList(pb.columns, pa.columns, cur, "columns", now, ["cards", "om"],
                   function (col) { col.cards = []; col.om = now; })) cur.om = now;
    var bC = flatCards(pb), aC = flatCards(pa);
    unionIds(bC, aC).forEach(function (id) {
      var b = bC[id], a = aC[id], c = flatCards(cur)[id];
      if (b && !a) {                                     // removed by the action
        if (c) return;
        var col = null;
        cur.columns.forEach(function (x) { if (x.id === b.col) col = x; });
        if (!col) col = cur.columns[0];
        if (!col) return;
        var nv = JSON.parse(JSON.stringify(b.v));
        nv.mtime = now;
        col.cards.splice(Math.min(b.i, col.cards.length), 0, nv);
        col.om = now;
        if (cur.deleted) delete cur.deleted[id];
      } else if (!b && a) {                              // created by the action
        if (!c) return;
        cur.columns.forEach(function (x) {
          x.cards = x.cards.filter(function (k) { return k.id !== id; });
        });
        if (!cur.deleted) cur.deleted = {};
        cur.deleted[id] = now;
      } else if (b && a && (plain(b.v) !== plain(a.v) || b.col !== a.col)) {   // changed by it
        if (!c || c.col !== a.col || plain(c.v) !== plain(a.v)) return;
        var rv = JSON.parse(JSON.stringify(b.v));
        rv.mtime = now;
        var src = null, dst = null;
        cur.columns.forEach(function (x) { if (x.id === c.col) src = x; if (x.id === b.col) dst = x; });
        if (!dst) dst = src;
        src.cards = src.cards.filter(function (k) { return k.id !== id; });
        dst.cards.splice(Math.min(b.i, dst.cards.length), 0, rv);
        if (dst !== src) { src.om = now; dst.om = now; }
      }
    });
  }
  function revertDiff(before, after, now) {
    var bM = indexById(before.boards), aM = indexById(after.boards);
    unionIds(bM, aM).forEach(function (id) {
      var pb = bM[id], pa = aM[id], cur = boardById(id);
      if (pb && !pa) {                                   // board removed by the action
        if (cur) return;
        var nb = JSON.parse(JSON.stringify(pb.v));
        nb.mtime = now;
        state.boards.splice(Math.min(pb.i, state.boards.length), 0, nb);
        if (state.boardDeleted) delete state.boardDeleted[id];
        state.om = now;
      } else if (!pb && pa) {                            // board created by the action
        if (!cur || state.boards.length < 2) return;
        state.boards = state.boards.filter(function (b) { return b.id !== id; });
        if (!state.boardDeleted) state.boardDeleted = {};
        state.boardDeleted[id] = now;
        state.om = now;
      } else if (pb && pa && cur) {
        revertBoard(pb.v, pa.v, cur, now);
      }
    });
  }

  function doUndo() {
    if (!undoSnapshot || !undoAfter) return;
    var before = JSON.parse(undoSnapshot);
    var after = JSON.parse(undoAfter);
    undoSnapshot = null;
    undoAfter = null;
    revertDiff(before, after, Date.now());
    var back = undoActive ? boardById(undoActive) : null;
    if (back && !back.archived) state.activeBoardId = back.id;
    else if (!boardById(state.activeBoardId)) state.activeBoardId = state.boards[0].id;
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
    // Undo toasts stay at least 8 s (Part VII).
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, withUndo ? 8000 : 5000);
  }

  
  // ---------- 9b. Import από άλλες εφαρμογές (Kanri / Trello) ----------
  // Verified: Kanri δείγμα export 2026-03-07 (KanriData) + Trello
  // documented board JSON export schema.
  //
  // Σχεδιαστικές αποφάσεις:
  //   · Τα imported boards είναι ΝΕΕΣ οντότητες (duplicateBoard pattern):
  //     φρέσκα mtime/om → νικητές LWW στο merge. Τα υπάρχοντα boards
  //     δεν αγγίζονται ΠΟΤΕ.
  //   · Όλα τα ids παίρνουν prefix ("imp-k-" / "imp-t-"): καμία σύγκρουση
  //     με uid(). Επαν-εισαγωγή του ίδιου αρχείου = replace των ίδιων
  //     ids (idempotent, zero duplicates — σύμφωνο με το union-by-id
  //     του sync merge σε δεύτερη συσκευή).
  //   · Kanri: card color → label χρώματος (on-demand), globalTags +
  //     per-card tags → labels, description → notes, tasks → subtasks.
  //   · Trello: lists→στήλες, cards→κάρτες, desc→notes, due→card.due,
  //     labels→labels, checklists→subtasks. Closed lists/cards → skip.

  var IMPORT_SOURCE_NAMES = { kanri: "Kanri", trello: "Trello" };

  // Kanri Tailwind color classes → orOS swatch + i18n όνομα
  var KANRI_COLORS = {
    "bg-blue-600":    { hex: "#4fc4cf", key: "color.blue"   },
    "bg-cyan-600":    { hex: "#4fc4cf", key: "color.blue"   },
    "bg-sky-600":     { hex: "#4fc4cf", key: "color.blue"   },
    "bg-teal-600":    { hex: "#4fc4cf", key: "color.blue"   },
    "bg-green-600":   { hex: "#87cf3e", key: "color.green"  },
    "bg-emerald-600": { hex: "#87cf3e", key: "color.green"  },
    "bg-lime-600":    { hex: "#87cf3e", key: "color.green"  },
    "bg-red-600":     { hex: "#e06c75", key: "color.red"    },
    "bg-rose-600":    { hex: "#e06c75", key: "color.red"    },
    "bg-pink-600":    { hex: "#e09ecf", key: "color.purple" },
    "bg-purple-600":  { hex: "#e09ecf", key: "color.purple" },
    "bg-yellow-600":  { hex: "#ecc75f", key: "color.yellow" },
    "bg-orange-600":  { hex: "#f28c5a", key: "color.orange" },
    "bg-gray-600":    { hex: "#9aa4b0", key: "color.gray"   },
    "bg-slate-600":   { hex: "#9aa4b0", key: "color.gray"   }
  };

  var TRELLO_HEX = {
    blue: "#4fc4cf", cyan: "#4fc4cf", sky: "#4fc4cf",
    green: "#87cf3e", lime: "#87cf3e", yellow: "#ecc75f",
    orange: "#f28c5a", red: "#e06c75",
    purple: "#e09ecf", pink: "#e09ecf",
    black: "#9aa4b0", gray: "#9aa4b0"
  };

  function importIsoDate(v) {
    if (typeof v !== "string") return null;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[1] + "-" + m[2] + "-" + m[3]) : null;
  }

  function countImport(boards) {
    var cards = 0, labels = 0;
    boards.forEach(function (b) {
      labels += (b.labels || []).length;
      (b.columns || []).forEach(function (col) { cards += (col.cards || []).length; });
    });
    return { boards: boards.length, labels: labels, cards: cards };
  }

  function kanriAdapter(data) {
    if (!data || !Array.isArray(data.boards)) return null;
    var boards = [];

    data.boards.forEach(function (bSrc) {
      var labels = [];          // board-scoped label registry
      var labelByKey = {};      // "gt:<id>" | "clr:<class>" | "tag:<text>"

      function ensureLabel(key, id, name, color) {
        if (labelByKey[key]) return labelByKey[key];
        var lb = { id: id, name: name, color: color,
                   mtime: Date.now(), pos: labels.length };
        labels.push(lb);
        labelByKey[key] = lb.id;
        return lb.id;
      }

      // globalTags (board-level) → labels
      (bSrc.globalTags || []).forEach(function (gt) {
        if (!gt || !gt.text || !gt.id) return;
        ensureLabel("gt:" + gt.id, "imp-k-" + gt.id, gt.text, FALLBACK_COLOR);
      });

      var columns = [];
      (bSrc.columns || []).forEach(function (col) {
        var cards = [];
        (col.cards || []).forEach(function (c) {
          if (!c.name) return;                // nameless → skip

          var cardLabels = [];
          var kc = KANRI_COLORS[(c.color || "").toLowerCase()];
          if (kc) {
            cardLabels.push(ensureLabel(
              "clr:" + c.color, "imp-k-clr-" + c.color, t(kc.key), kc.hex));
          }
          (c.tags || []).forEach(function (tag) {
            var txt = (typeof tag === "string") ? tag : (tag && tag.text);
            if (!txt) return;
            cardLabels.push(ensureLabel(
              "tag:" + txt,
              "imp-k-tag-" + encodeURIComponent(txt).replace(/%/g, ""),
              txt, FALLBACK_COLOR));
          });

          var subtasks = [];
          (c.tasks || []).forEach(function (st) {
            var stTxt = (st && (st.title || st.text || st.name)) || "";
            if (!stTxt) return;
            subtasks.push({
              id: "imp-k-" + (st.id || uid()),
              text: stTxt,
              completed: !!(st && st.done)
            });
          });

          cards.push({
            id: "imp-k-" + c.id,
            text: c.name,
            notes: c.description || "",
            due: importIsoDate(c.dueDate || c.due),
            labels: cardLabels,
            subtasks: subtasks,
            info: [],
            mtime: Date.now(),
            pos: cards.length
          });
        });
        columns.push({
          id: "imp-k-" + col.id,
          name: col.title,
          mtime: Date.now(),
          om: Date.now(),
          pos: columns.length,
          cards: cards
        });
      });

      boards.push({
        id: "imp-k-" + bSrc.id,
        name: bSrc.title,
        mtime: Date.now(),
        om: Date.now(),
        deleted: {},
        labels: labels,
        columns: columns
      });
    });

    if (boards.length === 0) return null;
    return { source: "kanri", boards: boards, stats: countImport(boards) };
  }

  function trelloAdapter(data) {
    if (!data || !Array.isArray(data.lists) || !Array.isArray(data.cards)) return null;

    var lblMap = {};
    var labels = [];
    (data.labels || []).forEach(function (lb, i) {
      if (lblMap[lb.id]) return;
      var ol = {
        id: "imp-t-" + lb.id,
        name: lb.name || ("#" + (i + 1)),
        color: TRELLO_HEX[lb.color] || SWATCH_COLORS[i % SWATCH_COLORS.length],
        mtime: Date.now(), pos: labels.length
      };
      labels.push(ol);
      lblMap[lb.id] = ol.id;
    });

    // Trello export: checklists ζουν TOP-LEVEL (data.checklists) —
    // οι κάρτες αναφέρουν μόνο ids (c.idChecklists). Precompute
    // ανά card id → flat λίστα subtask items.
    var checkByCard = {};
    (data.checklists || []).forEach(function (cl) {
      (cl.checkItems || []).forEach(function (ci) {
        if (!ci.name) return;
        (checkByCard[cl.idCard] = checkByCard[cl.idCard] || []).push({
          id: "imp-t-" + (ci.id || uid()),
          text: ci.name,
          completed: ci.state === "complete"
        });
      });
    });

    var columns = [];
    (data.lists || []).forEach(function (list) {
      if (list.closed) return;               // νεκρές λίστες → skip
      var cards = [];
      (data.cards || []).forEach(function (c) {
        if (c.idList !== list.id || c.closed) return;
        var cardLabels = [];
        (c.idLabels || []).forEach(function (lid) {
          if (lblMap[lid]) cardLabels.push(lblMap[lid]);
        });
        var subtasks = (checkByCard[c.id] || []).slice();
        cards.push({
          id: "imp-t-" + c.id,
          text: c.name || "",
          notes: c.desc || "",
          due: importIsoDate(c.due),
          labels: cardLabels,
          subtasks: subtasks,
          info: [],
          mtime: Date.now(),
          pos: cards.length
        });
      });
      columns.push({
        id: "imp-t-" + list.id,
        name: list.name,
        mtime: Date.now(),
        om: Date.now(),
        pos: columns.length,
        cards: cards
      });
    });

    var boards = [{
      id: "imp-t-" + data.id,
      name: data.name || "Trello",
      mtime: Date.now(),
      om: Date.now(),
      deleted: {},
      labels: labels,
      columns: columns
    }];
    return { source: "trello", boards: boards, stats: countImport(boards) };
  }

  function importInto(ex, nb) {
    var now = Date.now();
    var gone = ex.deleted || {};
    var have = {};
    ex.columns.forEach(function (col) {
      have[col.id] = true;
      col.cards.forEach(function (c) { have[c.id] = true; });
    });
    (ex.labels || []).forEach(function (lb) { have[lb.id] = true; });
    var addedCols = false;
    (nb.labels || []).forEach(function (lb) {
      if (have[lb.id] || gone[lb.id]) return;
      ex.labels.push(lb);
      have[lb.id] = true;
      ex.om = now;
    });
    (nb.columns || []).forEach(function (ncol) {
      if (gone[ncol.id]) return;
      var fresh = (ncol.cards || []).filter(function (c) { return !have[c.id] && !gone[c.id]; });
      var col = null;
      ex.columns.forEach(function (x) { if (x.id === ncol.id) col = x; });
      if (!col) {
        ncol.cards = fresh;
        ex.columns.push(ncol);
        addedCols = true;
      } else if (fresh.length) {
        col.cards = col.cards.concat(fresh);
        col.om = now;
      }
      fresh.forEach(function (c) { have[c.id] = true; });
    });
    if (addedCols) ex.om = now;
  }

  // --- Import dialog (dynamic construction, ίδιο pattern με manage-dialog) ---
  function openImportDlg() {
    if ($("import-dlg") && $("import-dlg").open) return;

    var parsed = null;          // adapter result του επιλεγμένου αρχείου

    var dlg = document.createElement("dialog");
    dlg.id = "import-dlg";

    var h3 = document.createElement("h3");
    h3.textContent = t("import.title");

    var hint = document.createElement("div");
    hint.className = "imp-hint";
    hint.textContent = t("import.hint");

    var file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.className = "imp-file";

    var preview = document.createElement("div");
    preview.className = "imp-preview";
    preview.hidden = true;

    var foot = document.createElement("div");
    foot.className = "dlg-foot";
    var no = document.createElement("button");
    no.type = "button";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    var go = document.createElement("button");
    go.type = "button";
    go.textContent = t("import.run");
    go.disabled = true;
    foot.appendChild(no);
    foot.appendChild(go);

    dlg.appendChild(h3);
    dlg.appendChild(hint);
    dlg.appendChild(file);
    dlg.appendChild(preview);
    dlg.appendChild(foot);
    document.body.appendChild(dlg);

    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });

    // Single reader — shared by the orosDialog native picker and the
    // hidden-input standalone fallback. Byte-for-byte the old logic.
    function readImportFile(f) {
      parsed = null;
      go.disabled = true;
      preview.hidden = false;
      preview.textContent = "";

      var fr = new FileReader();
      fr.onload = function (ev) {
        var json = null;
        try { json = JSON.parse(ev.target.result); } catch (e) { /* not JSON */ }

        parsed = (json && kanriAdapter(json)) ||
                 (json && trelloAdapter(json)) || null;

        if (!parsed) {
          preview.classList.add("imp-error");
          preview.textContent = t("import.unknown");
          return;
        }
        preview.classList.remove("imp-error");
        preview.textContent = t("import.detected") + " " +
          IMPORT_SOURCE_NAMES[parsed.source] + " — " +
          String(parsed.stats.boards) + " " + t("import.boards") + ", " +
          String(parsed.stats.cards) + " " + t("meta.cards") + ", " +
          String(parsed.stats.labels) + " " + t("import.labels");
        go.disabled = false;
      };
      fr.onerror = function () {
        preview.classList.add("imp-error");
        preview.textContent = t("import.err");
      };
      fr.readAsText(f);
    }

    // orosDialog first (native picker on Chromium). The visible file
    // input remains the standalone fallback (no shell present) —
    // when the shell exists we suppress it entirely.
    file.addEventListener("click", function (ev) {
      var dlg = dialogHost();
      if (!(dlg && typeof dlg.openFile === "function")) return;   // standalone → default input
      ev.preventDefault();                    // suppress the fallback input
      dlg.openFile(".json,application/json").then(function (f) {
        if (f) readImportFile(f);             // cancel (null) = silent exit
      });
    });

    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      file.value = "";                       // allow re-pick of same file
      if (f) readImportFile(f);
    });

    go.addEventListener("click", function () {
      if (!parsed || !parsed.boards || parsed.boards.length === 0) return;

      pushUndo("toast.imported");     // real undo — snapshot ΠΡΙΝ τη μετάλλαξη

      // KN-11: idempotent re-import WITHOUT replacing anything: a board
      // that is already here only receives the labels, columns and
      // cards it does not have yet (and not the ones the user deleted).
      // The old code swapped the whole board for the file's copy, so
      // every edit made since the first import was lost.
      parsed.boards.forEach(function (nb) {
        var ex = boardByIdIn(state.boards, nb.id);
        if (!ex) {
          state.boards.push(nb);
          if (state.boardDeleted) delete state.boardDeleted[nb.id];
        } else {
          importInto(ex, nb);
        }
      });
      state.om = Date.now();
      state.activeBoardId = parsed.boards[0].id;

      resetSessionView();
      save();
      renderAll();
      dlg.close();                    // η pushUndo κρατά το toast+Undo ζωντανό
    });

    dlg.showModal();
    setTimeout(function () { file.focus(); }, 50);
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
          editingCard();                       // KN-9: follow a card moved elsewhere
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

    // KN-14: shell shortcut forwarding, Contract Β (capture phase). The
    // old code dispatched a synthetic keydown on the parent WINDOW; the
    // shell listens on its document, so no global shortcut ever fired
    // from inside Kanban.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);

    // Alt+B → γρήγορη δημιουργία νέου board (δεν συγκρούεται με
    // browser shortcuts — δεν υπάρχει browser reserve στο Alt+B).
    // KN-13: matched by e.code (Greek layout, macOS Option+B = "∫"),
    // and never while the user types in a field or a dialog is open.
    document.addEventListener("keydown", function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          e.code === "KeyB") {
        var tg = e.target;
        if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" ||
                   tg.tagName === "SELECT" || tg.isContentEditable)) return;
        if (document.querySelector("dialog[open]")) return;
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