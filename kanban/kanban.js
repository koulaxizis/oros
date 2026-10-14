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
// Wave K1 (Trello/Planka/Jira-like boards):
//   - per-field card merge (kanban/model.js, OrosKanbanModel)
//   - WIP limits + arrival rules on the column (col.wip, col.auto),
//     overdue rule on its label (label.auto = "overdue")
//   - swimlanes (by label / by card.lane), Table and Timeline views
//     (device-local view prefs), attachments on the orOS disk
//     (/internal/Kanban/Attachments), card cover (colour or image)
//   - board export (JSON, CSV), import of that JSON, templates
//     (archived boards with a "tpl-" id; built-ins in tools.js)
// ============================================================
(function () {
  "use strict";

  var M = window.OrosKanbanModel;              // kanban/model.js
  var T = window.OrosKanbanTools;              // kanban/tools.js
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
      "import.hint":      "Supported: a board exported from orOS Kanban (JSON), and Kanri and Trello JSON exports. New boards are created — existing data is never touched.",
      "import.detected":  "Detected source:",
      "import.unknown":   "Unknown file — no Kanban data found.",
      "import.err":       "Could not read the file.",
      "import.run":       "Import",
      "toast.imported":   "Import completed",
      "import.boards":    "boards",
      "import.labels":    "labels",
      "import.acct":      "From a connected account",
      "import.acctHint":  "Read a Trello board, a GitHub repository's issues or a Notion database straight from your account. orOS only reads: nothing there changes.",
      "import.acctNone":  "Connect Trello, GitHub or Notion in Settings › Connected services to read a board from your account.",
      "import.acctOpen":  "Open Connected services",
      "import.acctSel":   "Account",
      "import.list":      "Show boards",
      "import.listRepo":  "Show repositories",
      "import.listDb":    "Show databases",
      "import.db":        "Database",
      "import.nt.none":   "No status",
      "import.nt.all":    "Cards",
      "import.nt.untitled": "Untitled",
      "import.board":     "Board",
      "import.repo":      "Repository",
      "import.read":      "Read",
      "import.reading":   "Reading…",
      "import.none":      "No boards here.",
      "import.gh.open":   "Open",
      "import.gh.closed": "Closed",
      "import.e.auth":    "The platform refused the key. Check it in Settings › Connected services.",
      "import.e.keys":    "This device doesn't have the account's key yet. Enter it in Settings › Connected services.",
      "import.e.offline": "You're offline.",
      "import.e.busy":    "The platform asks to slow down. Try again in a minute.",
      "import.e.other":   "Couldn't reach the platform. Try again later.",
      "more.title":       "View and board options",
      "view.title":       "View",
      "view.board":       "Board",
      "view.table":       "Table",
      "view.timeline":    "Timeline",
      "lanes.title":      "Swimlanes",
      "lanes.none":       "None",
      "lanes.label":      "By label",
      "lanes.lane":       "By lane",
      "lanes.nolabel":    "No label",
      "lanes.nolane":     "No lane",
      "lanes.hint":       "Rows of cards across the columns. Drag a card to another row to change its label or lane.",
      "card.col":         "Column",
      "card.lane":        "Lane",
      "card.laneph":      "e.g. Team A",
      "card.cover":       "Cover",
      "card.cover.none":  "No cover",
      "card.att":         "Attachments",
      "att.add":          "Add file",
      "att.bad":          "That file could not be added (photos, or other files up to 10 MB).",
      "att.noDisk":       "The orOS disk is not available here.",
      "att.missing":      "Not on this device",
      "att.missingLong":  "This file is not on this device. It comes with the orOS disk (Files) of the device that added it, through Vault Drive.",
      "att.open":         "Open",
      "att.save":         "Save a copy",
      "att.remove":       "Remove",
      "att.cover":        "Use as cover",
      "att.where":        "Kept in Files › Kanban › Attachments. Photos are resized and their location data removed.",
      "att.max":          "Up to 20 attachments per card.",
      "att.close":        "Close",
      "att.count":        "Attachments",
      "col.wip":          "WIP limit",
      "col.wip.hint":     "Empty = no limit. The column turns orange when it holds more cards than this.",
      "col.auto":         "When a card arrives here",
      "wip.title":        "Cards / WIP limit",
      "wip.over":         "Over the WIP limit",
      "auto.done":        "Tick all subtasks",
      "auto.today":       "Set the due date to today",
      "auto.top":         "Move it to the top",
      "auto.label":       "Add a label",
      "auto.nolabel":     "No label",
      "auto.title":       "Automations",
      "auto.menu":        "Automations…",
      "auto.overdue":     "When a due date passes, add the label “Overdue” (cards in the last column are left alone)",
      "auto.overdueName": "Overdue",
      "auto.cols":        "When a card arrives in a column",
      "auto.none":        "No rules",
      "auto.edit":        "Edit",
      "auto.ran":         "Automation ran in “{col}”",
      "auto.badge":       "This column has automations",
      "export.json":      "Export board (JSON)",
      "export.csv":       "Export cards (CSV)",
      "export.done":      "Exported",
      "export.skipped":   "Some attachments were too large and are not in the file.",
      "tpl.save":         "Save as template…",
      "tpl.new":          "New board from template…",
      "tpl.title":        "New board from template",
      "tpl.builtin":      "Built-in",
      "tpl.mine":         "Your templates",
      "tpl.none":         "No templates of your own yet. Use “Save as template…” on a board.",
      "tpl.saved":        "Template saved",
      "tpl.name":         "Template name",
      "tpl.saveTitle":    "Save as template",
      "tpl.saveHint":     "Columns, labels, WIP limits, rules and cards are kept; due dates, attachments and ticks are not.",
      "tpl.del":          "Delete template",
      "tpl.created":      "Board created",
      "confirm.tpldel":   "Delete this template?",
      "tbl.card":         "Card",
      "tbl.col":          "Column",
      "tbl.due":          "Due",
      "tbl.labels":       "Labels",
      "tbl.sub":          "Subtasks",
      "tbl.lane":         "Lane",
      "tbl.sort":         "Sort by",
      "tbl.empty":        "No cards to show.",
      "tl.empty":         "No cards with a due date. Give a card a due date to see it here.",
      "tl.nodue":         "Cards without a due date: {n}",
      "tl.today":         "Today",
      "tl.hint":          "Drag a card along the dates to change its due date.",
      "csv.board":        "Board",
      "csv.notes":        "Notes",
      "csv.info":         "Extra info",
      "import.oros":      "orOS Kanban",
      "color.blue":       "Blue",
      "color.green":      "Green",
      "color.red":        "Red",
      "color.purple":     "Purple",
      "color.yellow":     "Yellow",
      "color.orange":     "Orange",
      "color.gray":       "Gray",
    },
    el: {
      "board.create":     "Νέος πίνακας",
      "board.manage":     "Διαχείριση πινάκων...",
      "board.close":      "Κλείσιμο",
      "board.archive":    "Αρχειοθέτηση πίνακα",
      "board.unarchive":  "Επαναφορά πίνακα",
      "board.archived":   "Αρχειοθετημένα",
      "board.color":      "Χρώμα",
      "toast.boardarchived":   "Ο πίνακας αρχειοθετήθηκε",
      "toast.boardunarchived": "Ο πίνακας επαναφέρθηκε",
      "toast.boardarchlast":   "Τουλάχιστον ένας πίνακας πρέπει να μείνει ενεργός",
      "board.rename":     "Μετονομασία πίνακα",
      "board.delete":     "Διαγραφή πίνακα",
      "board.duplicate":  "Αντιγραφή πίνακα",
      "board.default":    "Κύριο",
      "board.empty":      "Αυτός ο πίνακας είναι άδειος",
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
      "toast.boarddel":   "Ο πίνακας διαγράφηκε",
      "toast.boardadded": "Ο πίνακας δημιουργήθηκε",
      "undo":             "Αναίρεση",
      "confirm.carddel":  "Διαγραφή αυτής της κάρτας;",
      "confirm.coldel":   "Διαγραφή στήλης και όλων των καρτών της;",
      "confirm.lbldel":   "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις κάρτες.",
      "confirm.boarddel": "Διαγραφή αυτού του πίνακα και ΟΛΩΝ των δεδομένων του;",
      "confirm.no":       "Άκυρο",
      "new.col":          "Νέα στήλη",
      "new.board":        "Νέος πίνακας",
      "meta.columns":     "στήλες",
      "meta.cards":       "κάρτες",
      "import.title":     "Εισαγωγή από άλλες εφαρμογές",
      "import.hint":      "Υποστηρίζονται: πίνακας που εξήχθη από το orOS Kanban (JSON), και εξαγωγές JSON από Kanri και Trello. Δημιουργούνται νέοι πίνακες — τα υπάρχοντα δεδομένα δεν αγγίζονται.",
      "import.detected":  "Αναγνωρίστηκε προέλευση:",
      "import.unknown":   "Άγνωστο αρχείο — δεν βρέθηκαν δεδομένα Kanban.",
      "import.err":       "Δεν ήταν δυνατή η ανάγνωση του αρχείου.",
      "import.run":       "Εισαγωγή",
      "toast.imported":   "Η εισαγωγή ολοκληρώθηκε",
      "import.boards":    "πίνακες",
      "import.labels":    "ετικέτες",
      "import.acct":      "Από συνδεδεμένο λογαριασμό",
      "import.acctHint":  "Διάβασε έναν πίνακα του Trello, τα issues ενός αποθετηρίου του GitHub ή μια βάση δεδομένων του Notion κατευθείαν από τον λογαριασμό σου. Το orOS μόνο διαβάζει: εκεί δεν αλλάζει τίποτα.",
      "import.acctNone":  "Σύνδεσε Trello, GitHub ή Notion στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες για να διαβάσεις έναν πίνακα από τον λογαριασμό σου.",
      "import.acctOpen":  "Άνοιγμα Συνδεδεμένων υπηρεσιών",
      "import.acctSel":   "Λογαριασμός",
      "import.list":      "Εμφάνιση πινάκων",
      "import.listRepo":  "Εμφάνιση αποθετηρίων",
      "import.listDb":    "Εμφάνιση βάσεων δεδομένων",
      "import.db":        "Βάση δεδομένων",
      "import.nt.none":   "Χωρίς κατάσταση",
      "import.nt.all":    "Κάρτες",
      "import.nt.untitled": "Χωρίς τίτλο",
      "import.board":     "Πίνακας",
      "import.repo":      "Αποθετήριο",
      "import.read":      "Ανάγνωση",
      "import.reading":   "Ανάγνωση…",
      "import.none":      "Δεν υπάρχουν πίνακες εδώ.",
      "import.gh.open":   "Ανοιχτά",
      "import.gh.closed": "Κλειστά",
      "import.e.auth":    "Η πλατφόρμα απέρριψε το κλειδί. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "import.e.keys":    "Αυτή η συσκευή δεν έχει ακόμα το κλειδί του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "import.e.offline": "Είσαι εκτός σύνδεσης.",
      "import.e.busy":    "Η πλατφόρμα ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "import.e.other":   "Δεν ήταν δυνατή η σύνδεση με την πλατφόρμα. Δοκίμασε αργότερα.",
      "more.title":       "Προβολή και επιλογές πίνακα",
      "view.title":       "Προβολή",
      "view.board":       "Στήλες",
      "view.table":       "Λίστα",
      "view.timeline":    "Χρονολόγιο",
      "lanes.title":      "Λωρίδες",
      "lanes.none":       "Καμία",
      "lanes.label":      "Ανά ετικέτα",
      "lanes.lane":       "Ανά λωρίδα",
      "lanes.nolabel":    "Χωρίς ετικέτα",
      "lanes.nolane":     "Χωρίς λωρίδα",
      "lanes.hint":       "Σειρές καρτών κατά μήκος των στηλών. Σύρε μια κάρτα σε άλλη σειρά για να αλλάξεις ετικέτα ή λωρίδα.",
      "card.col":         "Στήλη",
      "card.lane":        "Λωρίδα",
      "card.laneph":      "π.χ. Ομάδα Α",
      "card.cover":       "Εξώφυλλο",
      "card.cover.none":  "Χωρίς εξώφυλλο",
      "card.att":         "Συνημμένα",
      "att.add":          "Προσθήκη αρχείου",
      "att.bad":          "Δεν ήταν δυνατή η προσθήκη του αρχείου (φωτογραφίες, ή άλλα αρχεία έως 10 MB).",
      "att.noDisk":       "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "att.missing":      "Όχι σε αυτή τη συσκευή",
      "att.missingLong":  "Αυτό το αρχείο δεν υπάρχει σε αυτή τη συσκευή. Έρχεται με τον δίσκο του orOS (Αρχεία) της συσκευής που το πρόσθεσε, μέσω του Vault Drive.",
      "att.open":         "Άνοιγμα",
      "att.save":         "Αποθήκευση αντιγράφου",
      "att.remove":       "Αφαίρεση",
      "att.cover":        "Ως εξώφυλλο",
      "att.where":        "Φυλάσσεται στα Αρχεία › Kanban › Attachments. Οι φωτογραφίες μικραίνουν και χάνουν τα στοιχεία τοποθεσίας τους.",
      "att.max":          "Έως 20 συνημμένα ανά κάρτα.",
      "att.close":        "Κλείσιμο",
      "att.count":        "Συνημμένα",
      "col.wip":          "Όριο εργασιών (WIP)",
      "col.wip.hint":     "Κενό = χωρίς όριο. Η στήλη γίνεται πορτοκαλί όταν έχει περισσότερες κάρτες από αυτό.",
      "col.auto":         "Όταν έρχεται μια κάρτα εδώ",
      "wip.title":        "Κάρτες / όριο WIP",
      "wip.over":         "Πάνω από το όριο WIP",
      "auto.done":        "Τσεκάρισμα όλων των υπο-εργασιών",
      "auto.today":       "Προθεσμία σήμερα",
      "auto.top":         "Μετακίνηση στην κορυφή",
      "auto.label":       "Προσθήκη ετικέτας",
      "auto.nolabel":     "Καμία ετικέτα",
      "auto.title":       "Αυτοματισμοί",
      "auto.menu":        "Αυτοματισμοί…",
      "auto.overdue":     "Όταν περάσει μια προθεσμία, πρόσθεσε την ετικέτα «Καθυστέρηση» (όχι στις κάρτες της τελευταίας στήλης)",
      "auto.overdueName": "Καθυστέρηση",
      "auto.cols":        "Όταν έρχεται μια κάρτα σε στήλη",
      "auto.none":        "Κανένας κανόνας",
      "auto.edit":        "Αλλαγή",
      "auto.ran":         "Εκτελέστηκε αυτοματισμός στη στήλη «{col}»",
      "auto.badge":       "Η στήλη έχει αυτοματισμούς",
      "export.json":      "Εξαγωγή πίνακα (JSON)",
      "export.csv":       "Εξαγωγή καρτών (CSV)",
      "export.done":      "Η εξαγωγή έγινε",
      "export.skipped":   "Κάποια συνημμένα ήταν πολύ μεγάλα και δεν μπήκαν στο αρχείο.",
      "tpl.save":         "Αποθήκευση ως πρότυπο…",
      "tpl.new":          "Νέος πίνακας από πρότυπο…",
      "tpl.title":        "Νέος πίνακας από πρότυπο",
      "tpl.builtin":      "Έτοιμα πρότυπα",
      "tpl.mine":         "Τα πρότυπά σου",
      "tpl.none":         "Δεν έχεις ακόμα δικά σου πρότυπα. Χρησιμοποίησε το «Αποθήκευση ως πρότυπο…» σε έναν πίνακα.",
      "tpl.saved":        "Το πρότυπο αποθηκεύτηκε",
      "tpl.name":         "Όνομα προτύπου",
      "tpl.saveTitle":    "Αποθήκευση ως πρότυπο",
      "tpl.saveHint":     "Κρατούνται οι στήλες, οι ετικέτες, τα όρια WIP, οι κανόνες και οι κάρτες· όχι οι προθεσμίες, τα συνημμένα και τα τσεκαρίσματα.",
      "tpl.del":          "Διαγραφή προτύπου",
      "tpl.created":      "Ο πίνακας δημιουργήθηκε",
      "confirm.tpldel":   "Διαγραφή αυτού του προτύπου;",
      "tbl.card":         "Κάρτα",
      "tbl.col":          "Στήλη",
      "tbl.due":          "Προθεσμία",
      "tbl.labels":       "Ετικέτες",
      "tbl.sub":          "Υπο-εργασίες",
      "tbl.lane":         "Λωρίδα",
      "tbl.sort":         "Ταξινόμηση κατά",
      "tbl.empty":        "Δεν υπάρχουν κάρτες για εμφάνιση.",
      "tl.empty":         "Καμία κάρτα με προθεσμία. Δώσε προθεσμία σε μια κάρτα για να τη δεις εδώ.",
      "tl.nodue":         "Κάρτες χωρίς προθεσμία: {n}",
      "tl.today":         "Σήμερα",
      "tl.hint":          "Σύρε μια κάρτα πάνω στις ημερομηνίες για να αλλάξεις την προθεσμία της.",
      "csv.board":        "Πίνακας",
      "csv.notes":        "Σημειώσεις",
      "csv.info":         "Επιπλέον στοιχεία",
      "import.oros":      "orOS Kanban",
      "color.blue":       "Μπλε",
      "color.green":      "Πράσινο",
      "color.red":        "Κόκκινο",
      "color.purple":     "Μωβ",
      "color.yellow":     "Κίτρινο",
      "color.orange":     "Πορτοκαλί",
      "color.gray":       "Γκρι",
    }
  };

  function t(key, vars) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
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
  function touch(ent)     { if (ent) ent.mtime = Date.now(); }   // columns, labels (cards: stamp())
  function tombstone(board, id, at) {
    if (!board) return;
    if (!board.deleted) board.deleted = {};
    board.deleted[id] = at || Date.now();
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
    var now = Date.now();
    return {
      id: uid(),
      text: text,
      notes: "",
      due: null,          // "YYYY-MM-DD" | null — Kalender integration
      labels: [],
      subtasks: [],
      info: [],
      mtime: now,
      pos: 0,
      fm: M.freshFm(now)  // K1: one stamp per field group
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
          if (!state.activeBoardId || !boardById(state.activeBoardId) || isTpl(boardById(state.activeBoardId))) {
            state.activeBoardId = firstUsable().id;
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
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ activeBoardId: state.activeBoardId || null, views: viewPrefs })); }
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

  // K1: device-local view of each board (never synced):
  //   { <boardId>: { v: "board"|"table"|"timeline", lanes: ""|"label"|"lane",
  //                  sort: "status"|"text"|"due"|"labels"|"sub"|"lane", dir: "asc"|"desc" } }
  var viewPrefs = (function () {
    var v = readPrefs().views;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  })();
  function viewOf(boardId) {
    var v = viewPrefs[boardId] || {};
    return {
      v: v.v === "table" || v.v === "timeline" ? v.v : "board",
      lanes: v.lanes === "label" || v.lanes === "lane" ? v.lanes : "",
      sort: typeof v.sort === "string" ? v.sort : "status",
      dir: v.dir === "desc" ? "desc" : "asc"
    };
  }
  function setView(boardId, patch) {
    var v = viewOf(boardId);
    Object.keys(patch).forEach(function (k) { v[k] = patch[k]; });
    viewPrefs[boardId] = v;
    saveLocal();
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

  // ---------- 2b. Cross-device merge engine → kanban/model.js ----------
  // Wave K1: the merge and the canonical form live in model.js
  // (OrosKanbanModel, Node-tested): boards union by id, per-board
  // tombstones, column/label LWW, and per-FIELD card merge (text, notes,
  // due, labels, subtasks per item, extra info, column, attachments per
  // item, cover, lane), each group with its own stamp in card.fm.
  // Cards from older versions (no fm) keep the old whole-card rule.
  function mergeKanbanStates(A, B) { return M.mergeKanbanStates(A, B); }
  function canonState(src) { return M.canonState(src); }

  // An edit of some field groups of a card (see model.js GROUPS).
  function stamp(card, groups) { return M.stampCard(card, groups, Date.now()); }
  function isTpl(b) { return M.isTpl(b); }
  // Boards the user works in (templates are archived "tpl-" boards).
  function workBoards() { return state.boards.filter(function (b) { return !isTpl(b); }); }
  function firstUsable(boards) {
    var list = boards || state.boards;
    for (var i = 0; i < list.length; i++) if (!list[i].archived && !isTpl(list[i])) return list[i];
    for (var j = 0; j < list.length; j++) if (!isTpl(list[j])) return list[j];
    return list[0] || null;
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
        (keepActive && boardByIdIn(data.boards, keepActive) && !isTpl(boardByIdIn(data.boards, keepActive)))
          ? keepActive
          : firstUsable(data.boards).id;
      state = data;
      state.boards.forEach(function (board) { pruneTombstones(board); });
      writeStore();
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (same) return;

    scheduleRender();
    setTimeout(runOverdue, 1000);       // K1: cards that came in late
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

    var empty = $("empty");
    var host = $("columns");
    var alt = $("alt-view");
    if (!host) return;
    // KN-8: the rebuild must not eat what the user is typing in a
    // quick-add field (a pull re-renders while the keyboard is up).
    var keep = captureQuick(host);
    var altScroll = alt && !alt.hidden ? captureAltScroll(alt) : null;
    host.innerHTML = "";
    if (alt) alt.innerHTML = "";

    var board = currentBoard();
    var vw = board ? viewOf(board.id) : viewOf("");
    updateMoreBtn(vw);
    if (!board || board.columns.length === 0) {
      if (empty) {
        empty.querySelector("span").textContent = t("board.empty");
        empty.querySelector("small").textContent = t("board.empty.hint");
        empty.hidden = false;
      }
      host.hidden = false;
      if (alt) alt.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;

    if (vw.v !== "board" && alt) {
      host.hidden = true;
      host.classList.remove("lanes");
      alt.hidden = false;
      if (vw.v === "table") renderTable(alt, board, vw);
      else renderTimeline(alt, board, altScroll);
      if (altScroll && vw.v === "table") restoreAltScroll(alt, altScroll);
    } else {
      host.hidden = false;
      if (alt) alt.hidden = true;
      host.classList.toggle("lanes", !!vw.lanes);
      if (vw.lanes) renderLanes(host, board, vw.lanes);
      else board.columns.forEach(function (col) { host.appendChild(makeColumnEl(col)); });
      restoreQuick(keep);
    }

    // Filter popover update
    if (!$("filter-pop").hidden) renderFilterPop();
    updateFilterBtn();
  }

  function captureAltScroll(alt) {
    var w = alt.querySelector(".tbl-wrap, .tl-wrap");
    return w ? { l: w.scrollLeft, t: w.scrollTop, kind: w.className } : null;
  }
  function restoreAltScroll(alt, sc) {
    var w = alt.querySelector(".tbl-wrap, .tl-wrap");
    if (w && w.className === sc.kind) { w.scrollLeft = sc.l; w.scrollTop = sc.t; }
  }

  // Quick-add inputs carry data-quick-key = column id (+ "|" + lane key
  // in swimlane mode), so a rebuild puts the typed text back in place.
  function captureQuick(host) {
    var out = { vals: {}, focus: null };
    var qs = host.querySelectorAll(".col-quick");
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i], id = q.getAttribute("data-quick-key");
      if (q.value) out.vals[id] = q.value;
      if (document.activeElement === q) out.focus = { key: id, a: q.selectionStart, b: q.selectionEnd };
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
      var f = findQuickInput(keep.focus.key);
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
    var live = workBoards().filter(function (b) { return !b.archived; });
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
    var live    = workBoards().filter(function (b) { return !b.archived; });
    var archived = workBoards().filter(function (b) { return !!b.archived; });

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

    if (workBoards().length > 1) {
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
        if (col.wip) nc.wip = col.wip;                                   // K1
        if (col.auto) nc.auto = JSON.parse(JSON.stringify(col.auto));    // label ids are kept
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
          if (c.lane) ncard.lane = c.lane;
          if (c.cover && c.cover.charAt(0) === "#") ncard.cover = c.cover;
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
    var gone = [];
    bd.columns.forEach(function (c) { gone = gone.concat(filesOfCards(c.cards)); });
    dropFilesLater(gone);

    // Remove from boards[]
    state.boards = state.boards.filter(function (b) { return b.id !== boardId; });
    state.om = Date.now();

    // If we deleted the active board, switch to another
    if (state.activeBoardId === boardId) {
      var nx = firstUsable();
      state.activeBoardId = nx ? nx.id : null;
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
  var SVG_BOLT = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  var SVG_CLIP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  // Column head: title (dblclick → settings), rules badge, pencil,
  // count — "n/limit" when the column has a WIP limit (orange when over).
  function makeColHead(col) {
    var head = document.createElement("div");
    head.className = "col-head";

    var title = document.createElement("span");
    title.className = "col-title";
    title.textContent = col.name;
    title.title = col.name;
    title.addEventListener("dblclick", function () { openColDialog(col.id); });
    head.appendChild(title);

    if (T.hasRules(col)) {
      var bolt = document.createElement("span");
      bolt.className = "col-auto";
      bolt.title = t("auto.badge");
      bolt.setAttribute("aria-label", t("auto.badge"));
      bolt.innerHTML = SVG_BOLT;
      head.appendChild(bolt);
    }

    // Rename pencil (#22) — ίδιο dialog με dblclick, πάντα ορατό
    var rename = document.createElement("button");
    rename.type = "button";
    rename.className = "col-rename";
    rename.setAttribute("aria-label", t("col.settings"));
    rename.title = t("col.settings");
    rename.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    rename.addEventListener("click", function (e) {
      e.stopPropagation();
      openColDialog(col.id);
    });
    head.appendChild(rename);

    var total = col.cards.length, visible = 0;
    col.cards.forEach(function (c) { if (cardMatchesView(c)) visible++; });
    var count = document.createElement("span");
    count.className = "col-count";
    if (col.wip > 0) {
      count.textContent = total + "/" + col.wip;
      count.title = t("wip.title") + (total > col.wip ? " · " + t("wip.over") : "");
      count.classList.add("wip");
      if (total > col.wip) count.classList.add("over");
    } else {
      count.textContent = String(visible);
    }
    head.appendChild(count);
    return head;
  }
  function wipOver(col) { return col.wip > 0 && col.cards.length > col.wip; }

  function makeColumnEl(col) {
    var el = document.createElement("div");
    el.className = "k-col" + (wipOver(col) ? " wip-over" : "");
    el.dataset.colId = col.id;

    var head = makeColHead(col);
    el.appendChild(head);

    var body = document.createElement("div");
    body.className = "col-body";
    col.cards.forEach(function (card) {
      if (!cardMatchesView(card)) return;
      body.appendChild(makeCardEl(col, card));
    });
    el.appendChild(body);
    el.appendChild(makeQuickFoot(col, null));

    // Column reorder drag — το head είναι η λαβή (αφού υπάρχει πια)
    attachColDrag(head, el, col);
    return el;
  }

  // Foot: quick-add (input + φιλικό προς ποντίκι κουμπί). laneKey !== null
  // in swimlane mode: the new card joins that lane (label or lane text).
  // An Assistant prefill (quickPrefill, see 10c) for this field shows
  // its extras (notes, due) as a line under it until the card is added
  // or the field is emptied.
  function makeQuickFoot(col, laneKey) {
    var foot = document.createElement("div");
    foot.className = "col-foot";
    var qkey = col.id + (laneKey !== null ? "|" + laneKey : "");
    var quick = document.createElement("input");
    quick.type = "text";
    quick.className = "col-quick";
    quick.setAttribute("placeholder", t("quick.add"));
    quick.setAttribute("aria-label", t("quick.add"));
    quick.setAttribute("data-quick-key", qkey);
    quick.autocomplete = "off";
    quick.spellcheck = false;
    quick.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(col, quick, laneKey); }
    });
    quick.addEventListener("input", function () {
      if (!quick.value.trim() && quickPrefill && quickPrefill.key === qkey) dropQuickPrefill();
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
      quickAdd(col, quick, laneKey);
      var fresh = findQuickInput(quick.getAttribute("data-quick-key"));
      if (fresh) fresh.focus();
    });
    foot.appendChild(addBtn);
    if (quickPrefill && quickPrefill.key === qkey) {
      var bits = [];
      if (quickPrefill.notes) bits.push(t("card.notes"));
      if (quickPrefill.due) {
        var dp = quickPrefill.due.split("-");
        bits.push(t("card.due") + " " + new Date(+dp[0], +dp[1] - 1, +dp[2])
          .toLocaleDateString(LANG === "el" ? "el" : "en", { day: "numeric", month: "short", year: "numeric" }));
      }
      if (bits.length) {
        var pf = document.createElement("div");
        pf.className = "col-prefill";
        pf.textContent = "+ " + bits.join(" · ");
        foot.classList.add("has-prefill");
        foot.appendChild(pf);
      }
    }
    return foot;
  }

  // Swimlanes: one sticky row of column heads, then one row per lane
  // (label or lane text, plus "none"), each with a cell per column.
  // Cells are .k-col elements (data-col-id + data-lane), so card drag
  // and drop work the same; a drop in another row changes the lane.
  function renderLanes(host, board, mode) {
    var heads = document.createElement("div");
    heads.className = "lane-heads";
    var spacer = document.createElement("div");
    spacer.className = "lane-corner";
    heads.appendChild(spacer);
    board.columns.forEach(function (col) {
      var hc = document.createElement("div");
      hc.className = "k-col k-colhead" + (wipOver(col) ? " wip-over" : "");
      hc.dataset.colId = col.id;
      var head = makeColHead(col);
      hc.appendChild(head);
      attachColDrag(head, hc, col);
      heads.appendChild(hc);
    });
    host.appendChild(heads);

    var byLane = {};
    board.columns.forEach(function (col) {
      col.cards.forEach(function (card) {
        if (!cardMatchesView(card)) return;
        var k = T.laneKey(board, card, mode);
        if (mode === "lane") k = laneCanon(board, k);
        (byLane[k] = byLane[k] || {});
        (byLane[k][col.id] = byLane[k][col.id] || []).push(card);
      });
    });
    T.lanes(board, mode).forEach(function (ln) {
      var row = document.createElement("section");
      row.className = "lane";
      var lt = document.createElement("div");
      lt.className = "lane-title";
      if (ln.color) {
        var dot = document.createElement("span");
        dot.className = "fl-dot";
        dot.style.background = ln.color;
        lt.appendChild(dot);
      }
      var nm = document.createElement("span");
      nm.className = "lane-name";
      nm.textContent = ln.key ? ln.name : t(mode === "label" ? "lanes.nolabel" : "lanes.nolane");
      lt.appendChild(nm);
      var n = 0;
      Object.keys(byLane[ln.key] || {}).forEach(function (cid) { n += byLane[ln.key][cid].length; });
      var cnt = document.createElement("span");
      cnt.className = "col-count";
      cnt.textContent = String(n);
      lt.appendChild(cnt);
      row.appendChild(lt);
      var cells = document.createElement("div");
      cells.className = "lane-cells";
      board.columns.forEach(function (col) {
        var cell = document.createElement("div");
        cell.className = "k-col k-cell";
        cell.dataset.colId = col.id;
        cell.dataset.lane = ln.key;
        var body = document.createElement("div");
        body.className = "col-body";
        ((byLane[ln.key] || {})[col.id] || []).forEach(function (card) { body.appendChild(makeCardEl(col, card)); });
        cell.appendChild(body);
        cell.appendChild(makeQuickFoot(col, ln.key));
        cells.appendChild(cell);
      });
      row.appendChild(cells);
      host.appendChild(row);
    });
  }
  // Lane texts group without regard to case ("team a" joins "Team A").
  function laneCanon(board, k) {
    if (!k) return "";
    var all = T.lanes(board, "lane");
    for (var i = 0; i < all.length; i++) if (all[i].key && all[i].key.toLowerCase() === k.toLowerCase()) return all[i].key;
    return k;
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

    // K1: cover — a colour band, or an image attachment of the card
    if (card.cover) {
      var cov = document.createElement("div");
      if (card.cover.charAt(0) === "#") {
        cov.className = "card-cover";
        cov.style.background = /^#[0-9a-fA-F]{6}$/.test(card.cover) ? card.cover : FALLBACK_COLOR;
        el.appendChild(cov);
      } else {
        var att = attById(card, card.cover.slice(2));
        if (att && att.kind === "img") {
          cov.className = "card-cover img";
          el.appendChild(cov);
          attUrl(att.file).then(function (u) {
            if (!u) { cov.remove(); return; }
            var im = document.createElement("img");
            im.alt = "";
            im.src = u;
            im.draggable = false;
            cov.appendChild(im);
          });
        }
      }
    }

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

    // Due date chip, lane, attachments (one meta row)
    var meta = document.createElement("div");
    meta.className = "card-meta";
    if (card.due) {
      var fmt = formatDateChip(card.due);
      if (fmt) {
        var dueEl = document.createElement("span");
        dueEl.className = "due-chip " + fmt.css;
        dueEl.textContent = fmt.label;
        dueEl.title = card.due;  // full ISO date σε tooltip
        meta.appendChild(dueEl);
      }
    }
    var b0 = currentBoard();
    if (card.lane && !(b0 && viewOf(b0.id).lanes === "lane")) {
      var ln = document.createElement("span");
      ln.className = "lane-chip";
      ln.textContent = card.lane;
      ln.title = t("card.lane");
      meta.appendChild(ln);
    }
    if (card.att && card.att.length) {
      var ac = document.createElement("span");
      ac.className = "att-ind";
      ac.title = t("att.count");
      ac.innerHTML = SVG_CLIP;
      ac.appendChild(document.createTextNode(String(card.att.length)));
      meta.appendChild(ac);
    }
    if (meta.childNodes.length) el.appendChild(meta);

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
  function quickAdd(col, input, laneKey) {
    var board = currentBoard();
    if (!board) return;
    var raw = input.value.trim();
    if (!raw) return;
    var key = input.getAttribute("data-quick-key");
    var card = newCardObj(raw);          // φρέσκο mtime — νέα οντότητα
    if (quickPrefill && quickPrefill.key === key) {
      // Assistant prefill: the user pressed Add, so the extras go too
      card.notes = quickPrefill.notes;
      card.due = quickPrefill.due || null;
      quickPrefill = null;
    }
    if (laneKey) {
      var mode = viewOf(board.id).lanes;
      if (mode === "lane") card.lane = laneKey;
      else if (mode === "label" && labelById(laneKey)) card.labels = [laneKey];
    }
    col.cards.unshift(card);
    col.cards.forEach(function (c, i) { c.pos = i; });
    col.om = Date.now();   // top-insert = ORDERING decision: αυτή η πλευρά
                           // κερδίζει τη σειρά στο επόμενο merge (v0.5b)
    input.value = "";
    save(); scheduleRender();
    // Επαν-εστίαση στο φρέσκο input (το render αντικατέστησε τον παλιό κόμβο)
    requestAnimationFrame(function () {
      var fresh = findQuickInput(key);
      if (fresh) fresh.focus();
    });
  }

  function findQuickInput(key) {
    var qs = document.querySelectorAll(".col-quick");
    for (var i = 0; i < qs.length; i++) {
      if (qs[i].getAttribute("data-quick-key") === key) return qs[i];
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
    var tv = $("c-text").value, nv = $("c-notes").value;
    if (tv.trim()) lastGoodText = tv;
    var groups = [];
    if (card.text !== tv) { card.text = tv; groups.push("t"); }
    if ((card.notes || "") !== nv) { card.notes = nv; groups.push("n"); }
    if (!groups.length) return;
    stamp(card, groups);
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
    setInputKeep($("c-lane"), card.lane || "");
    renderCardCols();

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
    renderAtt(card);
    renderCover(card);
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
    $("c-lane").value = card.lane || "";
    renderLaneList();
    renderCardCols();

    renderCardLabels(card);
    renderSubtasks(card);
    renderInfo(card);
    renderAtt(card);
    renderCover(card);
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
        stamp(c, ["l"]);
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
        stamp(c, ["l"]);              // attach/detach = αλλαγή περιεχομένου
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
    if (card) { card.labels.push(label.id); stamp(card, ["l"]); }

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
      M.stampItem(c, "s", s, Date.now());
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
      M.stampItem(c, "s", s, Date.now());
      scheduleCardSave();
    });
    row.appendChild(txt);

    row.appendChild(makeRemoveBtn(function () {
      var c = editingCard();
      var s = c && itemRef(c.subtasks, sub, idx);
      if (!s) return;
      c.subtasks = c.subtasks.filter(function (x) { return x !== s; });
      var at = stamp(c, ["s"]);
      if (s.id) tombstone(currentBoard(), M.itemTomb(c.id, s.id), at);
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
    var ns = { id: uid(), text: raw, completed: false };
    card.subtasks.push(ns);
    input.value = "";
    M.stampItem(card, "s", ns, Date.now());
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
      stamp(c, ["x"]);
      scheduleCardSave();
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
      stamp(c, ["x"]);
      scheduleCardSave();
    });
    row.appendChild(val);

    row.appendChild(makeRemoveBtn(function () {
      var c = editingCard();
      var x = c && itemRef(c.info, f, idx);
      if (!x) return;
      c.info = c.info.filter(function (y) { return y !== x; });
      stamp(c, ["x"]);
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
    stamp(card, ["x"]);                // KN-9: the new row is local state now
    scheduleCardSave();
    renderInfo(card);
    var rows = $("c-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector(".i-label");
      if (l) l.focus();
    }
  }

  // ---------- 5b. Card dialog: column, lane, attachments, cover (K1) ----------
  function todayYmd() { return localDateStr(new Date()); }

  function renderCardCols() {
    var sel = $("c-col"), board = currentBoard(), card = editingCard();
    if (!sel || !board || !card) return;
    sel.innerHTML = "";
    board.columns.forEach(function (col) {
      var o = document.createElement("option");
      o.value = col.id;
      o.textContent = col.name + (col.wip > 0 ? " (" + col.cards.length + "/" + col.wip + ")" : "");
      sel.appendChild(o);
    });
    sel.value = editingColId;
  }
  function renderLaneList() {
    var dl = $("c-lane-list"), board = currentBoard();
    if (!dl || !board) return;
    dl.innerHTML = "";
    T.lanes(board, "lane").forEach(function (ln) {
      if (!ln.key) return;
      var o = document.createElement("option");
      o.value = ln.key;
      dl.appendChild(o);
    });
  }

  // Move a card to another column (dialog, table): to the end of it,
  // then that column's arrival rules.
  function moveCardTo(cardId, destColId) {
    var board = currentBoard();
    if (!board) return false;
    var f = T.findCard(board, cardId);
    if (!f || f.col.id === destColId || !colById(destColId)) return false;
    moveCard(f.col, f.card, destColId, null, false);
    save(); scheduleRender();
    return true;
  }
  // Arrival rules after a move into another column (all move paths).
  function runArrival(colId, cardId) {
    var board = currentBoard();
    var col = colById(colId);
    if (!board || !col) return;
    var did = T.applyArrival(board, colId, cardId, todayYmd(), Date.now());
    if (did.length) notifyTransient(t("auto.ran", { col: col.name }));
  }

  // --- Attachments: files on the orOS disk (Files › Kanban › Attachments) ---
  // The card keeps names only (att: [{ id, name, file, kind, size, m }]);
  // the file travels with the orOS disk (Vault Drive), not with sync.
  // Photos are re-drawn on a canvas (long side ≤ 1600 px, JPEG): no EXIF
  // or location kept. PDFs and other files (≤ 10 MB) are kept as they
  // are and are only ever offered as a download (never rendered here).
  var ATT_MAX_IN = 40 * 1024 * 1024, ATT_MAX_FILE = 10 * 1024 * 1024, ATT_MAX = 20;
  var attUrls = {};                       // file → object URL (this session)
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function attById(card, id) {
    var a = card && card.att || [];
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i];
    return null;
  }
  function attRandom() {
    var a = new Uint8Array(10), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function readAtt(file) {
    var fs = fsApi(), path = T.attPath(file);
    if (!fs || !path) return Promise.resolve(null);
    return Promise.resolve(fs.readBlob(path)).then(function (b) { return b || null; }, function () { return null; });
  }
  function attUrl(file) {
    if (attUrls[file]) return Promise.resolve(attUrls[file]);
    return readAtt(file).then(function (b) {
      if (!b) return null;
      if (!attUrls[file]) attUrls[file] = URL.createObjectURL(b.slice(0, b.size, "image/jpeg"));
      return attUrls[file];
    });
  }
  var RASTER = /^image\/(jpeg|png|webp|gif|bmp|avif|heic|heif)$/i;
  function encodeAtt(file) {
    return new Promise(function (resolve) {
      if (!file || !file.size || file.size > ATT_MAX_IN) { resolve(null); return; }
      var ext = ((file.name || "").match(/\.([a-z0-9]{1,8})$/i) || [, "bin"])[1].toLowerCase();
      if (RASTER.test(file.type || "") || /^(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/.test(ext)) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
          var k = Math.min(1, 1600 / Math.max(w, h));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(w * k));
          cv.height = Math.max(1, Math.round(h * k));
          var g = cv.getContext("2d");
          g.fillStyle = "#fff";
          g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(function (b) { resolve(b && b.size ? { blob: b, ext: "jpg", kind: "img" } : null); }, "image/jpeg", 0.82);
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
        return;
      }
      if (file.size > ATT_MAX_FILE) { resolve(null); return; }
      var pdf = file.type === "application/pdf" || ext === "pdf";
      var head = file.slice(0, 5);
      var rd = typeof head.text === "function" ? head.text() : Promise.resolve("%PDF-");
      rd.then(function (h) {
        if (pdf && h !== "%PDF-") { resolve(null); return; }
        resolve({ blob: file.slice(0, file.size, "application/octet-stream"), ext: pdf ? "pdf" : ext, kind: pdf ? "pdf" : "file" });
      }, function () { resolve(null); });
    });
  }
  function pickFiles() {
    var host = dialogHost();
    if (host && typeof host.openFiles === "function") return Promise.resolve(host.openFiles("")).then(function (l) { return l || []; });
    if (host && typeof host.openFile === "function") return Promise.resolve(host.openFile("")).then(function (f) { return f ? [f] : []; });
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.style.display = "none";
      inp.addEventListener("change", function () { resolve(Array.prototype.slice.call(inp.files || [])); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function addAttachments() {
    var fs = fsApi();
    if (!fs) { notifyTransient(t("att.noDisk")); return; }
    pickFiles().then(function (files) {
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          var c0 = editingCard();
          if (!c0) return;
          if ((c0.att || []).length >= ATT_MAX) { notifyTransient(t("att.max")); return; }
          return encodeAtt(file).then(function (enc) {
            if (!enc) { notifyTransient(t("att.bad")); return; }
            var name = attRandom() + "." + enc.ext;
            return Promise.resolve(fs.writeBlob(T.attPath(name), enc.blob)).then(function () {
              var c = editingCard();                 // KN-9: the live card, by id
              if (!c) { rmAtt(name); return; }
              var item = { id: uid(), name: String(file.name || name).slice(0, 120), file: name, kind: enc.kind, size: enc.blob.size };
              c.att = (c.att || []).concat([item]);
              M.stampItem(c, "a", item, Date.now());
              save(); scheduleRender();
              renderAtt(c);
              renderCover(c);
            });
          });
        });
      });
      return chain;
    }).catch(function () { notifyTransient(t("att.noDisk")); });
  }
  function rmAtt(file) {
    var fs = fsApi(), path = T.attPath(file);
    if (!fs || !path) return Promise.resolve();
    if (attUrls[file]) { URL.revokeObjectURL(attUrls[file]); delete attUrls[file]; }
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  // Files no card points at any more leave the disk after the Undo
  // window (a duplicate may share the file; an Undo brings the card back).
  function dropFilesLater(files) {
    if (!files || !files.length || !fsApi()) return;
    var list = files.slice();
    setTimeout(function () {
      var used = T.usedFiles(state);
      list.forEach(function (f) { if (!used[f]) rmAtt(f); });
    }, 12000);
  }
  function filesOfCards(cards) {
    var out = [];
    (cards || []).forEach(function (c) { (c.att || []).forEach(function (x) { if (x && x.file) out.push(x.file); }); });
    return out;
  }
  function removeAttachment(attId) {
    var c = editingCard(), board = currentBoard();
    var x = attById(c, attId);
    if (!x || !board) return;
    c.att = c.att.filter(function (y) { return y !== x; });
    if (!c.att.length) delete c.att;
    var at = stamp(c, ["a"]);
    tombstone(board, M.itemTomb(c.id, attId), at);
    if (c.cover === "a:" + attId) { delete c.cover; stamp(c, ["c"]); }
    save(); scheduleRender();
    renderAtt(c);
    renderCover(c);
    dropFilesLater([x.file]);
  }
  function fmtSize(n) {
    if (!(n > 0)) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function renderAtt(card) {
    var host = $("c-att-list");
    if (!host) return;
    host.innerHTML = "";
    (card.att || []).forEach(function (x) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "att-row";
      var th = document.createElement("span");
      th.className = "att-th";
      if (x.kind === "img") {
        attUrl(x.file).then(function (u) {
          if (!u) { th.textContent = "!"; th.title = t("att.missing"); return; }
          var im = document.createElement("img");
          im.alt = "";
          im.src = u;
          th.appendChild(im);
        });
      } else {
        th.textContent = x.kind === "pdf" ? "PDF" : ((x.file.split(".").pop() || "").toUpperCase().slice(0, 4));
      }
      row.appendChild(th);
      var nm = document.createElement("span");
      nm.className = "att-name";
      nm.textContent = x.name;
      row.appendChild(nm);
      var sz = document.createElement("span");
      sz.className = "att-size";
      sz.textContent = fmtSize(x.size);
      row.appendChild(sz);
      row.addEventListener("click", function () { attViewer(x.id); });
      host.appendChild(row);
    });
    var add = $("c-att-add");
    if (add) add.hidden = (card.att || []).length >= ATT_MAX;
  }
  function attViewer(attId) {
    var c = editingCard();
    var x = attById(c, attId);
    if (!x) return;
    var stale = $("att-view");
    if (stale) stale.remove();
    var v = document.createElement("dialog");
    v.id = "att-view";
    var h = document.createElement("h3");
    h.textContent = x.name;
    v.appendChild(h);
    var box = document.createElement("div");
    box.className = "att-view";
    v.appendChild(box);
    var hint = document.createElement("div");
    hint.className = "imp-hint";
    hint.textContent = t("att.where");
    v.appendChild(hint);
    var foot = document.createElement("div");
    foot.className = "dlg-foot";
    var blobNow = null, url = null;
    function btn(text, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener("click", fn);
      foot.appendChild(b);
      return b;
    }
    btn(t("att.remove"), "danger", function () { v.close(); removeAttachment(attId); });
    var openB = x.kind === "pdf" ? btn(t("att.open"), "", function () {
      if (!url) return;
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    }) : null;
    var coverB = x.kind === "img" ? btn(t("att.cover"), "", function () {
      var cc = editingCard();
      if (!cc) return;
      cc.cover = "a:" + attId;
      stamp(cc, ["c"]);
      save(); scheduleRender(); renderCover(cc);
      v.close();
    }) : null;
    var saveB = btn(t("att.save"), "", function () {
      if (!blobNow) return;
      var host = dialogHost();
      var mime = x.kind === "img" ? "image/jpeg" : x.kind === "pdf" ? "application/pdf" : "application/octet-stream";
      var out = blobNow.slice(0, blobNow.size, mime);
      if (host && typeof host.saveFile === "function") { host.saveFile({ blob: out, filename: x.name, mime: mime }); return; }
      var a = document.createElement("a");
      var u = URL.createObjectURL(out);
      a.href = u; a.download = x.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 40000);
    });
    btn(t("att.close"), "", function () { v.close(); });
    [openB, saveB, coverB].forEach(function (b) { if (b) b.disabled = true; });
    v.appendChild(foot);
    readAtt(x.file).then(function (b) {
      if (!b) { var p = document.createElement("p"); p.className = "imp-hint"; p.textContent = t("att.missingLong"); box.appendChild(p); return; }
      blobNow = b;
      if (x.kind === "img") {
        url = URL.createObjectURL(b.slice(0, b.size, "image/jpeg"));
        var im = document.createElement("img");
        im.alt = x.name;
        im.src = url;
        box.appendChild(im);
      } else {
        if (x.kind === "pdf") url = URL.createObjectURL(b.slice(0, b.size, "application/pdf"));
        var big = document.createElement("div");
        big.className = "att-big";
        big.textContent = (x.kind === "pdf" ? "PDF" : (x.file.split(".").pop() || "").toUpperCase()) + " · " + fmtSize(x.size);
        box.appendChild(big);
      }
      [openB, saveB, coverB].forEach(function (bb) { if (bb) bb.disabled = false; });
    });
    v.addEventListener("close", function () {
      if (url) { var u = url; setTimeout(function () { URL.revokeObjectURL(u); }, 60000); }
      v.remove();
    });
    v.addEventListener("click", function (e) { if (e.target === v) v.close(); });
    document.body.appendChild(v);
    v.showModal();
  }

  // --- Cover: none, a colour, or one of the card's photos ---
  function renderCover(card) {
    var host = $("c-cover");
    if (!host) return;
    host.innerHTML = "";
    function opt(val, cls, title, paint) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cov-opt " + cls + ((card.cover || "") === val ? " sel" : "");
      b.title = title;
      b.setAttribute("aria-label", title);
      b.setAttribute("aria-pressed", (card.cover || "") === val ? "true" : "false");
      if (paint) paint(b);
      b.addEventListener("click", function () {
        var c = editingCard();
        if (!c || (c.cover || "") === val) return;
        if (val) c.cover = val; else delete c.cover;
        stamp(c, ["c"]);
        save(); scheduleRender();
        renderCover(c);
      });
      host.appendChild(b);
    }
    opt("", "none", t("card.cover.none"), function (b) {
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4L18.4 5.6"/></svg>';
    });
    SWATCH_COLORS.forEach(function (col) {
      opt(col, "swatch", t("card.cover"), function (b) { b.style.background = col; });
    });
    (card.att || []).forEach(function (x) {
      if (x.kind !== "img") return;
      opt("a:" + x.id, "photo", x.name, function (b) {
        attUrl(x.file).then(function (u) {
          if (!u) return;
          var im = document.createElement("img");
          im.alt = "";
          im.src = u;
          b.appendChild(im);
        });
      });
    });
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
    if (card.lane) copy.lane = card.lane;
    if (card.cover) copy.cover = card.cover;
    if (card.att && card.att.length) {           // the same files on the disk (removal checks every card)
      copy.att = JSON.parse(JSON.stringify(card.att));
      copy.att.forEach(function (x) {
        var old = x.id;
        x.id = uid();
        if (copy.cover === "a:" + old) copy.cover = "a:" + x.id;
      });
    }
    copy.subtasks.forEach(function (s) { delete s.m; });
    copy.fm = M.freshFm(copy.mtime);              // a new entity: every group stamped now

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
    var groups = [];
    if (info.length !== (card.info || []).length) { card.info = info; changed = true; groups.push("x"); }
    var tt = $("c-text").value.trim() || (lastGoodText || "").trim() || card.text;
    if (tt !== card.text) { card.text = tt; changed = true; groups.push("t"); }
    if (changed) stamp(card, groups);
    if (changed || pending) { save(); scheduleRender(); }
  });

  // ---------- 6. Column dialog ----------
  function openColDialog(colId) {
    var col = colById(colId);
    if (!col) return;

    editingColId = colId;
    editingCardId = null;

    $("col-name").value = col.name;
    $("col-wip").value = col.wip > 0 ? String(col.wip) : "";
    var au = col.auto || {};
    $("col-a-done").checked = !!au.done;
    $("col-a-today").checked = !!au.today;
    $("col-a-top").checked = !!au.top;
    var ls = $("col-a-label");
    ls.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = t("auto.nolabel");
    ls.appendChild(none);
    (currentBoard().labels || []).forEach(function (lb) {
      var o = document.createElement("option");
      o.value = lb.id;
      o.textContent = lb.name;
      ls.appendChild(o);
    });
    ls.value = au.label && labelById(au.label) ? au.label : "";

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
    if (card.lane && card.lane.toLowerCase().indexOf(searchQuery) !== -1) return true;
    for (var a = 0; a < (card.att || []).length; a++) {
      if (String(card.att[a].name || "").toLowerCase().indexOf(searchQuery) !== -1) return true;
    }
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
        if (had) stamp(card, ["l"]); // αφαίρεση ετικέτας = αλλαγή περιεχομένου
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
      var srcCell = el.closest(".k-col");
      var fromLane = srcCell ? srcCell.dataset.lane : undefined;   // swimlane mode only
      var lastX = sx, lastY = sy, edgeTimer = null;

      function beginDrag() {
        started = true;
        el.classList.add("dragging");
        el.style.pointerEvents = "none";   // elementFromPoint βλέπει ΜΕΣΑ από εμάς
        document.body.classList.add("is-dragging");
        edgeTimer = setInterval(edgeScroll, 30);
      }
      // K1: near an edge of the board the board scrolls (columns sideways,
      // swimlane rows up and down), so far targets can be reached.
      function edgeScroll() {
        var sc = $("columns");
        if (!sc) return;
        var r = sc.getBoundingClientRect(), E = 36, step = 14, moved = false;
        if (lastX < r.left + E && sc.scrollLeft > 0) { sc.scrollLeft -= step; moved = true; }
        else if (lastX > r.right - E) { sc.scrollLeft += step; moved = true; }
        if (lastY < r.top + E && sc.scrollTop > 0) { sc.scrollTop -= step; moved = true; }
        else if (lastY > r.bottom - E) { sc.scrollTop += step; moved = true; }
        if (moved) mark(lastX, lastY);
      }
      function stopEdge() { if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = null; } }

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
        if (colEl && !colEl.classList.contains("k-colhead") &&
            (colEl.dataset.colId !== col.id || (colEl.dataset.lane !== undefined && colEl.dataset.lane !== fromLane))) {
          colEl.classList.add("drag-over");
        }
      }

      function onMove(ev) {
        if (!started) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          beginDrag();
        }
        ev.preventDefault();
        lastX = ev.clientX; lastY = ev.clientY;
        mark(ev.clientX, ev.clientY);
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        stopEdge();

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
        var destCell = null;
        if (destCard && destCard !== el) {
          var r = destCard.getBoundingClientRect();
          var before = ev.clientY < r.top + r.height / 2;
          destCell = destCard.closest(".k-col");
          moveCard(col, card, destCell.dataset.colId, destCard.dataset.cardId, before);
          moved = true;
        } else if (destColEl && !destColEl.classList.contains("k-colhead")) {
          destCell = destColEl;
          if (destCell.dataset.colId !== col.id || destCell.dataset.lane === undefined || destCell.dataset.lane === fromLane) {
            moveCard(col, card, destCell.dataset.colId, null, false);
          }
          moved = true;
        }
        // K1 swimlanes: a drop in another row changes the card's label or lane
        var bd = currentBoard();
        var mode = bd ? viewOf(bd.id).lanes : "";
        if (moved && mode && destCell && fromLane !== undefined && destCell.dataset.lane !== undefined &&
            destCell.dataset.lane !== fromLane) {
          var groups = T.setLane(bd, card, mode, fromLane, destCell.dataset.lane);
          if (groups.length) stamp(card, groups);
        }

        if (moved) { save(); scheduleRender(); }
      }

      function onUp(ev) { finish(ev); }
      function onCancel() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        stopEdge();
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
      stamp(card, ["p"]);            // K1: the column is its own field group
      srcCol.om = nowMs;
      dest.om = nowMs;
      srcCol.cards.forEach(function (c, i) { c.pos = i; });
      dest.cards.forEach(function (c, i) { c.pos = i; });
      runArrival(dest.id, card.id);  // K1: the column's automations
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
        M.stampCard(nv, null, now);         // K1: every field group
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
        M.stampCard(rv, null, now);
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
    else if (!boardById(state.activeBoardId) || isTpl(boardById(state.activeBoardId))) state.activeBoardId = firstUsable().id;
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

  var IMPORT_SOURCE_NAMES = { kanri: "Kanri", trello: "Trello", github: "GitHub", notion: "Notion", oros: "orOS Kanban" };

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

  // K1: a board exported from orOS Kanban (Export board, JSON). Always
  // a NEW board with fresh ids (tools.js parseExport checks and caps
  // every field), so importing it never touches an existing board.
  function orosAdapter(data) {
    var r = T.parseExport(data, uid, Date.now());
    if (!r) return null;
    return { source: "oros", boards: [r.board], files: r.files, stats: countImport([r.board]) };
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
  // ---------- Wave 6B: a board from a connected Trello or GitHub account ----------
  // The account and its key live in the shell (Settings › Connected
  // services, parent.orosLinks); links/kanban.js builds the requests and
  // turns the answer into a Trello-export-shaped board, so it lands
  // through trelloAdapter and the same idempotent merge as a file.
  function linksHost() {
    try { var p = window.parent; return p && p !== window && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  var PNAME = { trello: "Trello", github: "GitHub", notion: "Notion" };
  function accountSection(onParsed, onMsg) {
    var K = window.OrosLinksKanban, Lk = linksHost();
    if (!K || !Lk) return null;
    var box = document.createElement("div");
    box.className = "imp-acct";
    var h = document.createElement("h4");
    h.textContent = t("import.acct");
    box.appendChild(h);
    var accts = Lk.list().filter(function (a) { return K.PLATFORMS.indexOf(a.p) >= 0; });
    function hint(text) { var d = document.createElement("div"); d.className = "imp-hint"; d.textContent = text; box.appendChild(d); return d; }
    function btn(text, k, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = text; b.setAttribute("data-k", k); b.addEventListener("click", fn); return b; }
    function sel(k, label, opts) {
      var lab = document.createElement("label");
      lab.textContent = label;
      var s = document.createElement("select");
      s.setAttribute("data-k", k);
      opts.forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
      lab.appendChild(s);
      return { lab: lab, s: s };
    }
    if (!accts.length) {
      hint(t("import.acctNone"));
      box.appendChild(btn(t("import.acctOpen"), "kimp.settings", function () {
        try { window.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      return box;
    }
    hint(t("import.acctHint"));
    var byId = {};
    accts.forEach(function (a) { byId[a.id] = a; });
    var aSel = sel("kimp.acct", t("import.acctSel"), accts.map(function (a) { var pn = PNAME[a.p] || a.p; return [a.id, a.name === pn ? pn : a.name + " (" + pn + ")"]; }));
    box.appendChild(aSel.lab);
    var row = document.createElement("div");
    row.className = "imp-row";
    box.appendChild(row);
    var listBtn = btn("", "kimp.list", loadList);
    var bSel = null, readBtn = null, busy = false, listed = {};
    function label() { var p = byId[aSel.s.value] && byId[aSel.s.value].p; listBtn.textContent = t(p === "github" ? "import.listRepo" : p === "notion" ? "import.listDb" : "import.list"); }
    label();
    row.appendChild(listBtn);
    aSel.s.addEventListener("change", function () {
      label();
      if (bSel) { bSel.lab.remove(); bSel = null; }
      if (readBtn) { readBtn.remove(); readBtn = null; }
      onMsg("");
    });
    function fail(e) {
      var c = e && e.code;
      busy = false;
      onMsg(t(c === "auth" || c === "keys" || c === "offline" || c === "busy" ? "import.e." + c : "import.e.other"));
    }
    function ask(id, req) {
      return Lk.call(id, [req]).then(function (res) {
        var code = Lk.statusCode(res && res[0]);
        if (code) { var e = new Error(code); e.code = code; throw e; }
        return res[0].data;
      });
    }
    function loadList() {
      var a = byId[aSel.s.value];
      if (!a || busy) return;
      busy = true;
      onMsg(t("import.reading"));
      var items = [];
      (function page(n, cursor) {
        return ask(a.id, K.listReq(a.p, n, cursor)).then(function (data) {
          var r = K.readList(a.p, data);
          items = items.concat(r.items);
          if (r.more && n < K.MAX_PAGES.list) return page(n + 1, r.next);
        });
      })(1, "").then(function () {
        busy = false;
        if (bSel) bSel.lab.remove();
        if (readBtn) readBtn.remove();
        if (!items.length) { onMsg(t("import.none")); return; }
        onMsg("");
        listed = {};
        items.forEach(function (x) { listed[x.id] = x; });
        bSel = sel("kimp.board", t(a.p === "github" ? "import.repo" : a.p === "notion" ? "import.db" : "import.board"), items.map(function (x) { return [x.id, x.name]; }));
        box.appendChild(bSel.lab);
        readBtn = btn(t("import.read"), "kimp.read", function () { readBoard(a, bSel.s.value); });
        box.appendChild(readBtn);
      }, fail);
    }
    function readBoard(a, id) {
      if (busy || !id) return;
      busy = true;
      onMsg(t("import.reading"));
      var got;
      var run = a.p === "trello"
        ? ask(a.id, K.boardReq("trello", id)).then(function (d) { got = d; })
        : a.p === "notion"
        ? (function () {                                 // wave 6F: a Notion database's rows, by cursor
            got = { db: listed[id], rows: [] };
            return (function page(n, cursor) {
              return ask(a.id, K.boardReq("notion", id, n, cursor)).then(function (data) {
                var r = K.readRows(data);
                got.rows = got.rows.concat(r.items);
                if (r.more && n < K.MAX_PAGES.issues) return page(n + 1, r.next);
              });
            })(1, "");
          })()
        : (function () {
            got = [];
            return (function page(n) {
              return ask(a.id, K.boardReq("github", id, n)).then(function (data) {
                got = got.concat(Array.isArray(data) ? data : []);
                if (Array.isArray(data) && data.length >= K.PAGE && n < K.MAX_PAGES.issues) return page(n + 1);
              });
            })(1);
          })();
      run.then(function () {
        busy = false;
        var ex = K.toExport(a.p, id, got, { open: t("import.gh.open"), closed: t("import.gh.closed"),
                                            none: t("import.nt.none"), all: t("import.nt.all"), untitled: t("import.nt.untitled") });
        var res = ex && trelloAdapter(ex);
        if (!res) { onMsg(t("import.unknown")); return; }
        res.source = a.p;
        onParsed(res);
      }, fail);
    }
    return box;
  }

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
    var acct = accountSection(function (res) {          // wave 6B: from a connected account
      parsed = res;
      go.disabled = !res;
      preview.hidden = false;
      showParsed(res);
    }, function (text) {
      parsed = null;
      go.disabled = true;
      preview.hidden = false;
      preview.classList.toggle("imp-error", !!text);
      preview.textContent = text || "";
    });
    if (acct) dlg.appendChild(acct);
    dlg.appendChild(preview);
    dlg.appendChild(foot);
    document.body.appendChild(dlg);
    function showParsed(res) {
      preview.classList.remove("imp-error");
      preview.textContent = t("import.detected") + " " +
        IMPORT_SOURCE_NAMES[res.source] + " — " +
        String(res.stats.boards) + " " + t("import.boards") + ", " +
        String(res.stats.cards) + " " + t("meta.cards") + ", " +
        String(res.stats.labels) + " " + t("import.labels");
    }

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

        parsed = (json && orosAdapter(json)) ||
                 (json && kanriAdapter(json)) ||
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
      if (parsed.files) writeImportedFiles(parsed.files);   // K1: attachments inside an orOS export

      resetSessionView();
      save();
      renderAll();
      dlg.close();                    // η pushUndo κρατά το toast+Undo ζωντανό
    });

    dlg.showModal();
    setTimeout(function () { file.focus(); }, 50);
  }

  // ---------- 9c. Views, board menu, automations, export, templates (K1) ----------
  var SVG_VIEW = {
    board: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></svg>',
    table: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>',
    timeline: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><rect x="4" y="5" width="8" height="3" rx="1"/><rect x="9" y="10" width="9" height="3" rx="1"/><rect x="6" y="15" width="6" height="2" rx="1"/></svg>'
  };
  function updateMoreBtn(vw) {
    var b = $("more-btn");
    if (!b) return;
    b.innerHTML = SVG_VIEW[vw.v] || SVG_VIEW.board;
    b.classList.toggle("has-filters", vw.v !== "board" || !!vw.lanes);
  }

  function closeMorePop() { var p = $("more-pop"); if (p) p.hidden = true; }
  function renderMorePop() {
    var pop = $("more-pop"), board = currentBoard();
    if (!pop || !board) return;
    pop.innerHTML = "";
    var vw = viewOf(board.id);
    function head(text) {
      var h = document.createElement("div");
      h.className = "mp-head";
      h.textContent = text;
      pop.appendChild(h);
    }
    function seg(items, cur, onPick) {
      var row = document.createElement("div");
      row.className = "mp-seg";
      row.setAttribute("role", "group");
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mp-seg-btn" + (it[0] === cur ? " sel" : "");
        b.setAttribute("aria-pressed", it[0] === cur ? "true" : "false");
        b.setAttribute("data-k", "mp." + (it[0] || "none"));
        if (it[2]) b.innerHTML = it[2];
        var sp = document.createElement("span");
        sp.textContent = it[1];
        b.appendChild(sp);
        b.addEventListener("click", function () { onPick(it[0]); renderMorePop(); });
        row.appendChild(b);
      });
      pop.appendChild(row);
    }
    function item(text, k, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mp-item";
      b.setAttribute("data-k", k);
      b.textContent = text;
      b.addEventListener("click", function () { closeMorePop(); fn(); });
      pop.appendChild(b);
    }
    head(t("view.title"));
    seg([["board", t("view.board"), SVG_VIEW.board], ["table", t("view.table"), SVG_VIEW.table], ["timeline", t("view.timeline"), SVG_VIEW.timeline]],
        vw.v, function (v) { setView(board.id, { v: v }); renderAll(); });
    if (vw.v === "board") {
      head(t("lanes.title"));
      seg([["", t("lanes.none")], ["label", t("lanes.label")], ["lane", t("lanes.lane")]],
          vw.lanes, function (v) { setView(board.id, { lanes: v }); renderAll(); });
    }
    var sep = document.createElement("hr");
    sep.className = "dropdown-sep";
    pop.appendChild(sep);
    item(t("auto.menu"), "mp.auto", openAutoDlg);
    item(t("export.json"), "mp.json", exportJson);
    item(t("export.csv"), "mp.csv", exportCsv);
    item(t("tpl.save"), "mp.tplsave", saveTemplateDlg);
    item(t("tpl.new"), "mp.tplnew", openTemplatesDlg);
    item(t("import.title"), "mp.import", openImportDlg);
  }

  // --- Table view: one sortable row per card, the column as status ---
  function boardRows(board) {
    var rows = [];
    board.columns.forEach(function (col, ci) {
      col.cards.forEach(function (card, i) {
        if (cardMatchesView(card)) rows.push({ card: card, col: col, colIdx: ci, idx: i });
      });
    });
    return rows;
  }
  function renderTable(host, board, vw) {
    var rows = T.sortRows(boardRows(board), vw.sort, vw.dir, board);
    var hasLane = boardRows(board).some(function (r) { return !!r.card.lane; });
    var wrap = document.createElement("div");
    wrap.className = "tbl-wrap";
    var tbl = document.createElement("table");
    tbl.className = "k-table";
    var thead = document.createElement("thead"), tr = document.createElement("tr");
    var cols = [["text", t("tbl.card")], ["status", t("tbl.col")], ["due", t("tbl.due")], ["labels", t("tbl.labels")], ["sub", t("tbl.sub")]];
    if (hasLane) cols.push(["lane", t("tbl.lane")]);
    cols.forEach(function (c) {
      var th = document.createElement("th");
      th.scope = "col";
      th.setAttribute("aria-sort", vw.sort === c[0] ? (vw.dir === "desc" ? "descending" : "ascending") : "none");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "th-sort" + (vw.sort === c[0] ? " on" : "");
      b.title = t("tbl.sort") + " " + c[1];
      b.textContent = c[1] + (vw.sort === c[0] ? (vw.dir === "desc" ? " ↓" : " ↑") : "");
      b.addEventListener("click", function () {
        var dir = vw.sort === c[0] && vw.dir === "asc" ? "desc" : "asc";
        setView(board.id, { sort: c[0], dir: dir });
        renderAll();
      });
      th.appendChild(b);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    tbl.appendChild(thead);
    var tb = document.createElement("tbody");
    rows.forEach(function (r) {
      var c = r.card, row = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.className = "td-card";
      var open = document.createElement("button");
      open.type = "button";
      open.className = "tbl-open";
      if (c.cover && c.cover.charAt(0) === "#") {
        var dot = document.createElement("span");
        dot.className = "fl-dot";
        dot.style.background = c.cover;
        open.appendChild(dot);
      }
      var tx = document.createElement("span");
      tx.textContent = c.text;
      open.appendChild(tx);
      open.addEventListener("click", function () { openCardDialog(r.col.id, c.id); });
      td1.appendChild(open);
      row.appendChild(td1);
      var td2 = document.createElement("td");
      var sel = document.createElement("select");
      sel.className = "tbl-col";
      sel.setAttribute("aria-label", t("tbl.col"));
      board.columns.forEach(function (col) {
        var o = document.createElement("option");
        o.value = col.id;
        o.textContent = col.name;
        sel.appendChild(o);
      });
      sel.value = r.col.id;
      sel.addEventListener("change", function () { moveCardTo(c.id, sel.value); });
      td2.appendChild(sel);
      row.appendChild(td2);
      var td3 = document.createElement("td");
      td3.className = "td-due";
      if (c.due) {
        var f = formatDateChip(c.due);
        var dc = document.createElement("span");
        dc.className = "due-chip " + f.css;
        dc.textContent = f.css === "due-future" ? f.label : f.label + " · " + c.due.slice(5).split("-").reverse().join("/");
        dc.title = c.due;
        td3.appendChild(dc);
      }
      row.appendChild(td3);
      var td4 = document.createElement("td");
      var ch = document.createElement("div");
      ch.className = "chips";
      (c.labels || []).forEach(function (lid) {
        var lb = labelById(lid);
        if (!lb) return;
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.style.background = lb.color || FALLBACK_COLOR;
        chip.textContent = lb.name;
        ch.appendChild(chip);
      });
      td4.appendChild(ch);
      row.appendChild(td4);
      var td5 = document.createElement("td");
      td5.className = "td-num";
      if (c.subtasks && c.subtasks.length) {
        td5.textContent = c.subtasks.filter(function (s) { return s.completed; }).length + "/" + c.subtasks.length;
      }
      row.appendChild(td5);
      if (hasLane) {
        var td6 = document.createElement("td");
        td6.textContent = c.lane || "";
        row.appendChild(td6);
      }
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    host.appendChild(wrap);
    if (!rows.length) {
      var e = document.createElement("div");
      e.className = "alt-empty";
      e.textContent = t("tbl.empty");
      host.appendChild(e);
    }
  }

  // --- Timeline view: cards with a due date on a horizontal date axis ---
  var TL_DAY = 34;                     // px per day
  function renderTimeline(host, board, keepScroll) {
    var today = todayYmd();
    var rows = boardRows(board);
    var dated = rows.filter(function (r) { return !!r.card.due; });
    var undated = rows.length - dated.length;
    dated.sort(function (a, b) { return a.card.due < b.card.due ? -1 : a.card.due > b.card.due ? 1 : (a.colIdx - b.colIdx) || (a.idx - b.idx); });
    if (!dated.length) {
      var e = document.createElement("div");
      e.className = "alt-empty";
      e.textContent = t("tl.empty");
      host.appendChild(e);
      return;
    }
    var rg = T.timelineRange(dated.map(function (r) { return r.card.due; }), today);
    var wrap = document.createElement("div");
    wrap.className = "tl-wrap";
    var grid = document.createElement("div");
    grid.className = "tl-grid";
    grid.style.setProperty("--tl-day", TL_DAY + "px");
    grid.style.width = "calc(var(--tl-name) + " + (rg.days * TL_DAY) + "px)";
    // header: months + day numbers
    var hd = document.createElement("div");
    hd.className = "tl-row tl-headrow";
    var corner = document.createElement("div");
    corner.className = "tl-name tl-corner";
    hd.appendChild(corner);
    var track = document.createElement("div");
    track.className = "tl-track";
    var loc = LANG === "el" ? "el" : "en";
    for (var i = 0; i < rg.days; i++) {
      var ymd = T.addDays(rg.from, i);
      var p = ymd.split("-");
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      var cell = document.createElement("div");
      cell.className = "tl-day" + (ymd === today ? " today" : "") + (d.getDay() === 0 || d.getDay() === 6 ? " we" : "");
      cell.style.left = (i * TL_DAY) + "px";
      if (+p[2] === 1 || i === 0) {
        var mo = document.createElement("span");
        mo.className = "tl-month";
        mo.textContent = d.toLocaleString(loc, { month: "short" }).replace(".", "") + (+p[1] === 1 || i === 0 ? " " + p[0] : "");
        cell.appendChild(mo);
      }
      var dn = document.createElement("span");
      dn.className = "tl-dn";
      dn.textContent = String(+p[2]);
      cell.appendChild(dn);
      if (ymd === today) cell.title = t("tl.today");
      track.appendChild(cell);
    }
    hd.appendChild(track);
    grid.appendChild(hd);
    var todayIdx = T.daysBetween(rg.from, today);
    var lastIdx = board.columns.length - 1;
    dated.forEach(function (r) {
      var c = r.card;
      var row = document.createElement("div");
      row.className = "tl-row";
      var nm = document.createElement("button");
      nm.type = "button";
      nm.className = "tl-name";
      var cd = document.createElement("span");
      cd.className = "fl-dot";
      cd.style.background = tlColor(c);
      nm.appendChild(cd);
      var nt = document.createElement("span");
      nt.className = "tl-text";
      nt.textContent = c.text;
      nm.appendChild(nt);
      nm.title = c.text + " · " + r.col.name;
      nm.addEventListener("click", function () { openCardDialog(r.col.id, c.id); });
      row.appendChild(nm);
      var tr2 = document.createElement("div");
      tr2.className = "tl-track";
      if (todayIdx >= 0 && todayIdx < rg.days) {
        var tm = document.createElement("div");
        tm.className = "tl-todayline";
        tm.style.left = (todayIdx * TL_DAY) + "px";
        tr2.appendChild(tm);
      }
      var idx = T.daysBetween(rg.from, c.due);
      var pill = document.createElement("button");
      pill.type = "button";
      var fmt = formatDateChip(c.due);
      pill.className = "tl-pill " + fmt.css + (r.colIdx === lastIdx && lastIdx > 0 ? " done" : "");
      pill.style.left = (idx * TL_DAY + 2) + "px";
      pill.style.background = tlColor(c);
      pill.title = c.text + " · " + c.due + " · " + r.col.name;
      pill.setAttribute("aria-label", c.text + ", " + c.due);
      pill.textContent = c.text;
      attachPillDrag(pill, r.col.id, c.id, idx);
      tr2.appendChild(pill);
      row.appendChild(tr2);
      grid.appendChild(row);
    });
    wrap.appendChild(grid);
    host.appendChild(wrap);
    var foot = document.createElement("div");
    foot.className = "alt-foot";
    foot.textContent = t("tl.hint") + (undated ? "  ·  " + t("tl.nodue", { n: undated }) : "");
    host.appendChild(foot);
    requestAnimationFrame(function () {
      if (keepScroll && keepScroll.kind === "tl-wrap") { wrap.scrollLeft = keepScroll.l; wrap.scrollTop = keepScroll.t; }
      else wrap.scrollLeft = Math.max(0, (todayIdx - 3) * TL_DAY);
    });
  }
  function tlColor(c) {
    if (c.cover && /^#[0-9a-fA-F]{6}$/.test(c.cover)) return c.cover;
    var lb = (c.labels || []).map(labelById).filter(Boolean)[0];
    return lb ? (lb.color || FALLBACK_COLOR) : "var(--accent)";
  }
  // Drag a pill along the axis: the due date moves by whole days.
  function attachPillDrag(pill, colId, cardId, idx0) {
    pill.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var sx = e.clientX, started = false, delta = 0;
      var left0 = parseFloat(pill.style.left) || 0;
      function move(ev) {
        var dx = ev.clientX - sx;
        if (!started && Math.abs(dx) < DRAG_THRESHOLD) return;
        if (!started) { started = true; pill.classList.add("dragging"); try { pill.setPointerCapture(e.pointerId); } catch (er) {} }
        ev.preventDefault();
        delta = Math.round(dx / TL_DAY);
        pill.style.left = (left0 + delta * TL_DAY) + "px";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        if (!started) { openCardDialog(colId, cardId); return; }
        pill.classList.remove("dragging");
        if (!delta) return;
        var board = currentBoard();
        var f = board && T.findCard(board, cardId);
        if (!f || !f.card.due) return;
        f.card.due = T.addDays(f.card.due, delta);
        stamp(f.card, ["d"]);
        save(); scheduleRender();
      }
      function cancel() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        pill.classList.remove("dragging");
        pill.style.left = left0 + "px";
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    });
    pill.addEventListener("click", function (e) { e.preventDefault(); });   // the pointerup decides
    pill.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCardDialog(colId, cardId); }
    });
  }

  // --- Automations dialog: the overdue rule + a summary of column rules ---
  function openAutoDlg() {
    if ($("auto-dlg") && $("auto-dlg").open) return;
    var dlg = document.createElement("dialog");
    dlg.id = "auto-dlg";
    var h = document.createElement("h3");
    h.textContent = t("auto.title");
    dlg.appendChild(h);
    var body = document.createElement("div");
    body.id = "auto-body";
    dlg.appendChild(body);
    var foot = document.createElement("div");
    foot.className = "dlg-foot";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = t("board.close");
    close.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(close);
    dlg.appendChild(foot);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    renderAutoDlg();
    dlg.showModal();
  }
  function renderAutoDlg() {
    var body = $("auto-body"), board = currentBoard();
    if (!body || !board) return;
    body.innerHTML = "";
    var od = document.createElement("label");
    od.className = "chk";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "auto-overdue";
    cb.checked = !!T.overdueLabel(board);
    cb.addEventListener("change", function () { setOverdueRule(cb.checked); });
    od.appendChild(cb);
    var sp = document.createElement("span");
    sp.textContent = " " + t("auto.overdue");
    od.appendChild(sp);
    body.appendChild(od);
    var h4 = document.createElement("h4");
    h4.className = "auto-h";
    h4.textContent = t("auto.cols");
    body.appendChild(h4);
    board.columns.forEach(function (col) {
      var row = document.createElement("div");
      row.className = "auto-row";
      var info = document.createElement("div");
      info.className = "auto-info";
      var nm = document.createElement("div");
      nm.className = "manage-name";
      nm.textContent = col.name + (col.wip > 0 ? "  ·  WIP " + col.wip : "");
      info.appendChild(nm);
      var meta = document.createElement("div");
      meta.className = "manage-meta";
      var a = col.auto || {}, parts = [];
      if (a.done) parts.push(t("auto.done"));
      if (a.today) parts.push(t("auto.today"));
      if (a.label && labelById(a.label)) parts.push(t("auto.label") + ": " + labelById(a.label).name);
      if (a.top) parts.push(t("auto.top"));
      meta.textContent = parts.length ? parts.join(" · ") : t("auto.none");
      info.appendChild(meta);
      row.appendChild(info);
      var ed = document.createElement("button");
      ed.type = "button";
      ed.className = "auto-edit";
      ed.textContent = t("auto.edit");
      ed.addEventListener("click", function () { openColDialog(col.id); });
      row.appendChild(ed);
      body.appendChild(row);
    });
  }
  // The rule is a flag on its label (label.auto = "overdue"), so it
  // syncs with the label and older versions keep it.
  function setOverdueRule(on) {
    var board = currentBoard();
    if (!board) return;
    var cur = T.overdueLabel(board);
    if (on && !cur) {
      var name = t("auto.overdueName");
      var lb = null;
      board.labels.forEach(function (l) { if (!lb && (l.name || "").trim().toLowerCase() === name.toLowerCase()) lb = l; });
      if (lb) { lb.auto = "overdue"; touch(lb); }
      else {
        board.labels.push({ id: uid(), name: name, color: "#e06c75", mtime: Date.now(), pos: board.labels.length, auto: "overdue" });
        board.om = Date.now();
      }
    } else if (!on && cur) {
      delete cur.auto;
      touch(cur);
    }
    save();
    runOverdue();
    scheduleRender();
  }
  // Overdue rule on every board (boot, after a pull, every few minutes).
  function runOverdue() {
    if (!state) return;
    var now = Date.now(), n = 0;
    state.boards.forEach(function (b) { n += T.applyOverdue(b, now); });
    if (n) { save(); scheduleRender(); refreshOpenCard(); }
  }

  // --- Export ---
  function slug(s) {
    return String(s || "board").toLowerCase().replace(/[^a-z0-9Ͱ-Ͽ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";
  }
  function blobToB64(b) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { resolve(null); };
      fr.readAsDataURL(b);
    });
  }
  function saveText(text, filename, mime, ext) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      var ty = {};
      ty[mime] = [ext];
      return Promise.resolve(host.saveFile({ text: text, filename: filename, mime: mime,
        types: [{ description: ext.slice(1).toUpperCase(), accept: ty }] })).then(function (r) { return !!(r && r.ok); });
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    return Promise.resolve(true);
  }
  var EXPORT_FILES_MAX = 25 * 1024 * 1024;
  function exportJson() {
    var board = currentBoard();
    if (!board) return;
    var snap = canonState({ boards: [board] }).boards[0];
    var files = {}, total = 0, skipped = false, chain = Promise.resolve();
    snap.columns.forEach(function (col) {
      col.cards.forEach(function (c) {
        (c.att || []).forEach(function (x) {
          chain = chain.then(function () {
            if (files[x.file]) return;
            return readAtt(x.file).then(function (b) {
              if (!b) return;
              if (total + b.size > EXPORT_FILES_MAX) { skipped = true; return; }
              total += b.size;
              return blobToB64(b).then(function (s) { if (s) files[x.file] = s; });
            });
          });
        });
      });
    });
    chain.then(function () {
      var text = JSON.stringify(T.exportBoard(snap, files, Date.now()), null, 1);
      return saveText(text, "orOS-kanban-" + slug(board.name) + "-" + todayYmd() + ".json", "application/json", ".json");
    }).then(function (ok) {
      if (ok) notifyTransient(t(skipped ? "export.skipped" : "export.done"));
    });
  }
  function exportCsv() {
    var board = currentBoard();
    if (!board) return;
    var csv = T.boardCsv(board, [t("csv.board"), t("tbl.col"), t("tbl.card"), t("csv.notes"), t("tbl.due"), t("tbl.labels"),
                                 t("tbl.sub"), t("tbl.lane"), t("csv.info"), t("card.att")]);
    saveText(csv, "orOS-kanban-" + slug(board.name) + "-" + todayYmd() + ".csv", "text/csv", ".csv").then(function (ok) {
      if (ok) notifyTransient(t("export.done"));
    });
  }
  // Attachments that came inside an imported board file → the disk.
  function writeImportedFiles(list) {
    var fs = fsApi();
    if (!fs || !list || !list.length) return;
    list.forEach(function (f) {
      try {
        var bin = atob(f.data.replace(/\s+/g, ""));
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        var path = T.attPath(f.file);
        if (path) Promise.resolve(fs.writeBlob(path, new Blob([u8], { type: "application/octet-stream" }))).then(function () { scheduleRender(); }, function () {});
      } catch (e) { /* a broken file is left out */ }
    });
  }

  // --- Templates ---
  function templates() { return state.boards.filter(isTpl); }
  function smallDialog(id, title, hint, value, onOk) {
    var stale = $(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    var form = document.createElement("form");
    form.method = "dialog";
    var h = document.createElement("h3");
    h.textContent = title;
    form.appendChild(h);
    var lab = document.createElement("label");
    lab.textContent = t("tpl.name");
    lab.setAttribute("for", id + "-in");
    form.appendChild(lab);
    var inp = document.createElement("input");
    inp.type = "text";
    inp.id = id + "-in";
    inp.maxLength = 120;
    inp.value = value;
    form.appendChild(inp);
    if (hint) {
      var hn = document.createElement("div");
      hn.className = "imp-hint";
      hn.textContent = hint;
      form.appendChild(hn);
    }
    var foot = document.createElement("div");
    foot.className = "dlg-foot";
    var no = document.createElement("button");
    no.type = "button";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    var ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = t("save");
    foot.appendChild(no);
    foot.appendChild(ok);
    form.appendChild(foot);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = inp.value.trim();
      if (!v) return;
      dlg.close();
      onOk(v);
    });
    dlg.appendChild(form);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { inp.focus(); inp.select(); }, 50);
  }
  function saveTemplateDlg() {
    var board = currentBoard();
    if (!board) return;
    smallDialog("tpl-save", t("tpl.saveTitle"), t("tpl.saveHint"), board.name, function (name) {
      var tpl = T.templateFromBoard(board, uid, Date.now(), name);
      state.boards.push(tpl);
      state.om = Date.now();
      save();
      notifyTransient(t("tpl.saved"));
    });
  }
  function boardFrom(src, name) {
    pushUndo("tpl.created");
    var nb = T.boardFromTemplate(src, uid, Date.now(), name);
    state.boards.push(nb);
    state.om = Date.now();
    state.activeBoardId = nb.id;
    resetSessionView();
    save();
    renderAll();
  }
  function openTemplatesDlg() {
    var stale = $("tpl-dlg");
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = "tpl-dlg";
    var h = document.createElement("h3");
    h.textContent = t("tpl.title");
    dlg.appendChild(h);
    var list = document.createElement("div");
    list.className = "tpl-list";
    dlg.appendChild(list);
    function sect(text) {
      var d = document.createElement("div");
      d.className = "manage-section-hdr";
      d.textContent = text;
      list.appendChild(d);
    }
    function row(name, desc, onPick, onDel) {
      var r = document.createElement("div");
      r.className = "tpl-row";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tpl-pick";
      var nm = document.createElement("span");
      nm.className = "manage-name";
      nm.textContent = name;
      b.appendChild(nm);
      if (desc) {
        var ds = document.createElement("span");
        ds.className = "manage-meta";
        ds.textContent = desc;
        b.appendChild(ds);
      }
      b.addEventListener("click", function () { dlg.close(); onPick(); });
      r.appendChild(b);
      if (onDel) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "manage-delete";
        del.title = t("tpl.del");
        del.setAttribute("aria-label", t("tpl.del"));
        del.innerHTML = ICNS.trash;
        del.addEventListener("click", function () { onDel(); });
        r.appendChild(del);
      }
      list.appendChild(r);
    }
    function paint() {
      list.innerHTML = "";
      sect(t("tpl.builtin"));
      T.builtinList(LANG).forEach(function (x) {
        row(x.name, x.desc, function () { boardFrom(T.builtinBoard(x.key, LANG), x.name); });
      });
      sect(t("tpl.mine"));
      var mine = templates();
      if (!mine.length) {
        var e = document.createElement("div");
        e.className = "imp-hint";
        e.textContent = t("tpl.none");
        list.appendChild(e);
      }
      mine.forEach(function (tp) {
        var n = tp.columns.length + " " + t("meta.columns") + " · " +
                tp.columns.reduce(function (a, c) { return a + c.cards.length; }, 0) + " " + t("meta.cards");
        row(tp.name, n, function () { boardFrom(tp, tp.name); }, function () {
          confirmDialog("confirm.tpldel", function () {
            if (!state.boardDeleted) state.boardDeleted = {};
            state.boardDeleted[tp.id] = Date.now();
            state.boards = state.boards.filter(function (b) { return b.id !== tp.id; });
            state.om = Date.now();
            save();
            paint();
          });
        });
      });
    }
    paint();
    var foot = document.createElement("div");
    foot.className = "dlg-foot";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = t("board.close");
    close.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(close);
    dlg.appendChild(foot);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
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
    var changed = false;
    var name = $("col-name").value.trim();
    if (name && name !== col.name) { col.name = name; changed = true; }
    // K1: WIP limit + arrival rules — part of the column header (LWW)
    var w = Math.floor(+$("col-wip").value);
    w = w > 0 && w < 1000 ? w : 0;
    if ((col.wip || 0) !== w) { if (w) col.wip = w; else delete col.wip; changed = true; }
    var na = {};
    if ($("col-a-done").checked) na.done = true;
    if ($("col-a-today").checked) na.today = true;
    if ($("col-a-label").value) na.label = $("col-a-label").value;
    if ($("col-a-top").checked) na.top = true;
    var oldA = JSON.stringify(col.auto || {});
    if (oldA !== JSON.stringify(na)) { if (Object.keys(na).length) col.auto = na; else delete col.auto; changed = true; }
    if (changed) touch(col);   // header edit = δομικό LWW
    save(); scheduleRender();
    if ($("auto-dlg") && $("auto-dlg").open) renderAutoDlg();
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

  // ---------- 10c. Shell deep link (__orosOpenAt / __orosTakeTarget) ----------
  // target { board, col, card } → that card, as the Calendar link above.
  // Assistant entry card (BR-W8-6): { asNew: { board?, column?, title,
  // note?, due? } } (T.asNew cleans it) fills the quick-add field of
  // that column, as if the user had typed the title; notes and due
  // ride along (shown under the field) and are only written when the
  // user presses Enter/+ there. Emptying the field drops them. Board
  // and column match by name (trimmed, any case) when exactly one
  // does; otherwise the board on screen and its first column. A board
  // without columns (empty state), no title or an open dialog → no-op.
  var quickPrefill = null;             // { key, notes, due } | null
  function dropQuickPrefill() {
    quickPrefill = null;
    var pf = document.querySelectorAll(".col-prefill");
    for (var i = 0; i < pf.length; i++) {
      if (pf[i].parentNode) pf[i].parentNode.classList.remove("has-prefill");
      pf[i].remove();
    }
  }
  function byName(list, name) {
    if (!name) return null;
    var want = name.toLowerCase(), hit = null, n = 0;
    list.forEach(function (x) {
      if (String(x.name || "").trim().toLowerCase() === want) { hit = x; n++; }
    });
    return n === 1 ? hit : null;
  }
  function newCardFrom(x) {
    var v = T.asNew(x);
    if (!v || document.querySelector("dialog[open]")) return;
    var board = byName(state.boards.filter(function (b) { return !b.archived && !isTpl(b); }), v.board) ||
                currentBoard();
    if (!board) return;
    if (board.id !== state.activeBoardId) switchBoard(board.id);
    if (!board.columns.length) return;
    var col = byName(board.columns, v.column) || board.columns[0];
    var vw = viewOf(board.id);
    if (vw.v !== "board") setView(board.id, { v: "board" });   // the other views have no quick-add
    dropQuickPrefill();
    quickPrefill = { key: col.id + (vw.lanes ? "|" : ""), notes: v.notes, due: v.due };
    renderAll();
    var q = findQuickInput(quickPrefill.key);
    if (!q) { quickPrefill = null; return; }
    q.value = v.title;
    q.focus();
    try { q.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
  }
  // Single app "New card" shortcut ({ quickAdd: true }): the quick-add
  // field of the open board's first column.
  function quickAddFirst() {
    var board = currentBoard();
    if (!board || !board.columns.length || document.querySelector("dialog[open]")) return;
    var vw = viewOf(board.id);
    if (vw.v !== "board") setView(board.id, { v: "board" });
    renderAll();
    var q = findQuickInput(board.columns[0].id + (vw.lanes ? "|" : ""));
    if (!q) return;
    q.focus();
    try { q.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
  }
  function openSearchTarget(tg) {
    if (!tg || typeof tg !== "object" || !state) return;
    if (tg.asNew) { newCardFrom(tg.asNew); return; }
    if (tg.quickAdd === true) { quickAddFirst(); return; }
    if (typeof tg.board === "string" && typeof tg.col === "string" && typeof tg.card === "string") {
      window.__orosKanbanOpen(tg);
    }
  }
  window.__orosOpenAt = openSearchTarget;

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
      var mp = $("more-pop");
      if (mp && !mp.hidden && !e.target.closest("#more-slot")) mp.hidden = true;
    });

    // --- K1: view / board menu ---
    var moreBtn = $("more-btn");
    if (moreBtn) {
      moreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var pop = $("more-pop");
        if (!pop) return;
        pop.hidden = !pop.hidden;
        moreBtn.setAttribute("aria-expanded", pop.hidden ? "false" : "true");
        if (!pop.hidden) renderMorePop();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { var mp = $("more-pop"); if (mp && !mp.hidden) { mp.hidden = true; if (moreBtn) moreBtn.focus(); } }
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
        var dv = cDueInput.value || null;     // "" → null (cleared)
        if (card.due === dv) return;
        card.due = dv;
        stamp(card, ["d"]);
        save();
        scheduleRender();       // date chip πίσω από το dialog φρεσκάρει
      });
      cDueInput.addEventListener("change", function () {
        var card = editingCard();
        if (!card) return;
        var dv2 = cDueInput.value || null;
        if (card.due === dv2) return;
        card.due = dv2;
        stamp(card, ["d"]);
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
            dropFilesLater(filesOfCards(col.cards.filter(function (c) { return c.id === editingCardId; })));
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

    // K1: column (move), lane, attachments
    var cCol = $("c-col");
    if (cCol) cCol.addEventListener("change", function () {
      var card = editingCard();
      if (!card) return;
      moveCardTo(card.id, cCol.value);
      editingCard();                        // editingColId follows
      renderCardCols();
      var c2 = editingCard();
      if (c2) { setInputKeep($("c-due"), c2.due || ""); renderCardLabels(c2); renderSubtasks(c2); }
    });
    var cLane = $("c-lane");
    if (cLane) cLane.addEventListener("input", function () {
      var card = editingCard();
      if (!card) return;
      var v = cLane.value.trim().slice(0, 60);
      if ((card.lane || "") === v) return;
      if (v) card.lane = v; else delete card.lane;
      stamp(card, ["k"]);
      scheduleCardSave();
    });
    var cAtt = $("c-att-add");
    if (cAtt) cAtt.addEventListener("click", addAttachments);

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
        var dlg = $("dlg-col");
        if (dlg) dlg.close();                 // the close handler commits
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
          dropFilesLater(filesOfCards(col.cards));
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

    // K1: the overdue rule — at start, every 5 minutes, back on screen
    setTimeout(runOverdue, 1500);
    setInterval(runOverdue, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) runOverdue(); });

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
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("kanban");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  boot();
})();