// ============================================================
// orOS To-Do — App logic
// New in v0.4 (cross-device MERGE):
//   - Every entity (list / task / label) carries mtime (content
//     version) + pos/om (ordering version). Every mutation stamps.
//   - Soft deletes: state.deleted = { [id]: ts } tombstones,
//     pruned after 30 days. Deletion wins over older edits;
//     an edit NEWER than its tombstone resurrects the entity.
//   - mergeTodoStates(local, remote): deterministic, symmetric —
//     both devices compute the SAME converged result.
//       · scalars (activeList/hideCompleted): larger sm wins — kept
//         for devices on the previous version only; this version
//         keeps the view per device ("oros-todo-prefs", TD-8)
//       · entities: union by id, content by larger mtime
//         (tie → lexicographic JSON — identical both ways)
//       · ordering (pos/om): side with larger om wins positions
//       · tombstones: union with max ts; deletion beats older
//         edits, loses to newer ones
//   - Undo puts back ONLY what the action removed, stamped newest
//     (TD-1); nothing else is re-stamped.
//   - Tasks merge FIELD BY FIELD (it.fm, TD-3); the slice and the
//     merge share one canonical form (TD-4).
//   - DATA_VER 2 → 3 additive migration (mtime/om/pos/deleted/sm).
// Carried over from v0.3 (Kanban-pattern port):
//   - Labels, filter by label, global search (all lists),
//     extra info key-value fields, tab drag reorder, rename pencil.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration, IDs
//   2b. Cross-device merge engine (v0.4)
//   3. Recurrence date math + list-cycle engine
//   4. Render: tabs (+ rename pencil + drag reorder)
//   5. Render: items (+ search/filter view)
//   6. Quick-add (natural date parsing)
//   7. Item detail dialog (+ labels / extra info editors)
//   8. List settings dialog
//   9. Item drag & drop reorder
//  10. Label helpers (shared by items + filter)
//  11. Undo / toast
//  12. Sync slice (Dropbox, merge-registered) + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-todo-data";
  var DATA_VER = 3;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

  // ---------- 1. Constants, i18n, helpers ----------
  // Language comes from the shell (same-origin, shared localStorage).
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");

  var STRINGS = {
    en: {
      "aria.lists": "Lists",
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
      "item.info.remove": "Remove field",
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
      "list.share":    "Send to someone…",
      "list.share.empty": "This list is empty: nothing to send",
      "list.name":     "Name",
      "list.delete":   "Delete list",
      "recur.list.title": "List cycle",
      "recur.list.hint":  "When a cycle ends, all checks are cleared automatically.",
      "due.today":     "Today",
      "due.tomorrow":  "Tomorrow",
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
      "toast.ticked":  "Done: {t}",
      "toast.already": "That task is already done",
      "toast.gone":    "That task is no longer on your lists",
      "toast.cleared": "Completed items cleared",
      "toast.listdel": "List deleted",
      "toast.labeladd": "Label created",
      "toast.labeldel": "Label deleted",
      "toast.saveFail": "Could not save — the storage of this browser is full",
      "undo":          "Undo",
      "confirm.listdel": "Delete this list and all its tasks?",
      "confirm.itemdel": "Delete this task?",
      "confirm.lbldel":  "Delete this label? It will be removed from all tasks.",
      "confirm.no":      "Cancel",
      "new.list":      "New list",
      "recur.list.next": "Next reset:",
      "drag.reorder":   "Reorder",
      "tab.add":        "Add list",
      "add.task":       "Add task",
      "interval.aria":  "Interval",
      "filtered.title": "All tasks are completed",
      "filtered.hint":  "Turn off “Hide completed” to see them.",
      "smart.today":    "Today",
      "smart.week":     "Next 7 days",
      "smart.nodate":   "No date",
      "smart.p1":       "Priority 1",
      "smart.empty":    "Nothing here",
      "smart.empty.hint": "Tasks from all your lists show up here when they match.",
      "prio.label":     "Priority",
      "prio.1":         "Priority 1 (urgent)",
      "prio.2":         "Priority 2 (high)",
      "prio.3":         "Priority 3 (medium)",
      "prio.4":         "Priority 4 (none)",
      "prio.none":      "None",
      "item.list":      "List",
      "subs.title":     "Subtasks",
      "subs.add":       "Add",
      "subs.ph":        "New subtask…",
      "subs.remove":    "Delete subtask",
      "subs.up":        "Move up",
      "subs.down":      "Move down",
      "subs.toggle":    "Show or hide subtasks",
      "recur.mode":     "Next date counts from",
      "recur.mode.fixed": "on a fixed schedule",
      "recur.mode.after": "after it's done",
      "recur.after.short": "after done",
      "sort.title":     "Sort",
      "sort.manual":    "Manual order",
      "sort.prio":      "By priority",
      "sort.due":       "By due date",
      "menu.move":      "Move to…",
      "menu.open":      "Open",
      "menu.select":    "Select",
      "sel.count":      "{n} selected",
      "sel.act":        "Priority / Move…",
      "toast.moved":    "Moved to {list}",
      "toast.movedN":   "{n} tasks moved to {list}",
      "toast.addedTo":  "Added to {list}",
      "filter.save":    "New saved filter…",
      "flt.title":      "New saved filter",
      "flt.edit":       "Edit saved filter",
      "flt.newname":    "My filter",
      "flt.labels":     "Labels (any of them)",
      "flt.due.any":    "Any",
      "flt.due.overdue": "Overdue",
      "flt.due.today":  "Today or overdue",
      "flt.due.month":  "Next 30 days",
      "flt.due.range":  "Between dates",
      "flt.from":       "From",
      "flt.to":         "To",
      "flt.text":       "Text contains",
      "flt.delete":     "Delete filter",
      "confirm.fltdel": "Delete this saved filter? Its tasks stay where they are.",
      "toast.fltdel":   "Filter deleted",
      "hh.title":       "Household",
      "hh.shareHint":   "Everyone in the household sees and edits this list from their own orOS. It is encrypted on your devices.",
      "hh.shareGo":     "Share",
      "td.title": "Server task list (CalDAV)",
      "td.hint": "Link this list to a task list on your own server (Nextcloud, Radicale, mailbox.org, Fastmail, iCloud…): its tasks then go both ways, subtasks too. Nothing is deleted on either side unless it was in sync before.",
      "td.noacct": "Connect your calendar server first, in Settings › Sync › Calendars and contacts. The password stays on this device.",
      "td.settings": "Open Settings",
      "td.pick": "Choose a server task list",
      "td.none": "Your server has no task list that is not linked yet.",
      "td.noname": "Tasks",
      "td.ro.col": "read-only",
      "td.link": "Link",
      "td.linked": "Linked to {n}",
      "td.preview.wait": "Checking the server…",
      "td.preview": "{down} to download, {up} to upload, {same} already here. Nothing is written until you tap Link.",
      "td.preview.ro": "The task list is read-only on the server, so nothing goes up.",
      "td.sync": "Sync now",
      "td.unlink": "Unlink",
      "td.unlinked": "Unlinked. The tasks stay in this list and on the server.",
      "td.ok": "In sync, {t}",
      "td.never": "Not synced yet",
      "td.wait": "Syncing…",
      "td.other": "Linked on another device of yours. Connect this device too in Settings › Sync so it syncs here as well.",
      "td.gone": "Your server no longer lists this task list. Check it in Settings › Sync, or unlink.",
      "td.conflicts": "{n} changed on both sides: the newer was kept, the other as a copy marked (conflict).",
      "td.mark": " (conflict)",
      "td.held": "{n} deletions wait for you ({a} in orOS, {b} on the server).",
      "td.held.yes": "Delete them",
      "td.held.no": "Bring them back",
      "td.ro": "This task comes from your server task list and orOS cannot keep all of it, so changes made here are undone. Change it on the server.",
      "td.err.noacct": "No server account on this device: connect it in Settings › Sync.",
      "td.err.net": "The server could not be reached. orOS will try again later.",
      "td.err.auth": "The server did not accept the password: check it in Settings › Sync.",
      "td.err.ro": "The server does not allow changes to this task list.",
      "td.err.other": "The server answered with an error ({e}). orOS will try again later.",
      "hh.none":        "No household yet. Make one in the Household app, then share lists from here.",
      "hh.open":        "Open Household",
      "hh.sharedIn":    "Shared with {hh}",
      "hh.hint":        "Everyone in the household sees and edits this list. Labels stay yours.",
      "hh.stop":        "Stop sharing (keep my own copy)",
      "hh.by":          "Last changed by {name}",
      "tab.shared":     "Shared with a household",
      "confirm.hhdel":  "Delete this list for everyone in the household? The others can bring it back from Household for 30 days.",
      "confirm.hhstop": "Stop sharing this list? It leaves the household for everyone, and you keep your own copy.",
      "toast.hhShared": "Now shared with {hh}",
      "toast.hhStopped":"Sharing stopped. Your own copy is in your lists.",
      "toast.hhDel":    "List deleted for the household",
      "toast.hhFail":   "That did not work. Try again in a moment.",
      "seed.general":   "General",
      "seed.groceries": "Groceries",
      "wd.0": "Sunday", "wd.1": "Monday", "wd.2": "Tuesday", "wd.3": "Wednesday",
      "wd.4": "Thursday", "wd.5": "Friday", "wd.6": "Saturday"
    },
    el: {
      "aria.lists": "Λίστες",
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
      "item.info.remove": "Αφαίρεση πεδίου",
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
      "list.share":    "Στείλε σε κάποιον…",
      "list.share.empty": "Η λίστα είναι άδεια: δεν υπάρχει κάτι να στείλεις",
      "list.name":     "Όνομα",
      "list.delete":   "Διαγραφή λίστας",
      "recur.list.title": "Κύκλος λίστας",
      "recur.list.hint":  "Όταν λήξει ο κύκλος, όλα τα τσεκαρίσματα μηδενίζονται αυτόματα.",
      "due.today":     "Σήμερα",
      "due.tomorrow":  "Αύριο",
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
      "toast.ticked":  "Έγινε: {t}",
      "toast.already": "Η εργασία έχει ήδη γίνει",
      "toast.gone":    "Η εργασία δεν υπάρχει πια στις λίστες σου",
      "toast.cleared": "Καθαρίστηκαν οι ολοκληρωμένες εργασίες",
      "toast.listdel": "Η λίστα διαγράφηκε",
      "toast.labeladd": "Η ετικέτα δημιουργήθηκε",
      "toast.labeldel": "Η ετικέτα διαγράφηκε",
      "toast.saveFail": "Η αποθήκευση απέτυχε — ο χώρος αποθήκευσης του browser γέμισε",
      "undo":          "Αναίρεση",
      "confirm.listdel": "Διαγραφή λίστας και όλων των εργασιών της;",
      "confirm.itemdel": "Διαγραφή αυτής της εργασίας;",
      "confirm.lbldel":  "Διαγραφή αυτής της ετικέτας; Θα αφαιρεθεί από όλες τις εργασίες.",
      "confirm.no":     "Άκυρο",
      "new.list":      "Νέα λίστα",
      "recur.list.next": "Επόμενο reset:",
      "drag.reorder":   "Αναδιάταξη",
      "tab.add":        "Προσθήκη λίστας",
      "add.task":       "Προσθήκη εργασίας",
      "interval.aria":  "Διάστημα",
      "filtered.title": "Όλες οι εργασίες έχουν ολοκληρωθεί",
      "filtered.hint":  "Απενεργοποίησε την «Απόκρυψη ολοκληρωμένων» για να τις δεις.",
      "smart.today":    "Σήμερα",
      "smart.week":     "Επόμενες 7 ημέρες",
      "smart.nodate":   "Χωρίς ημερομηνία",
      "smart.p1":       "Προτεραιότητα 1",
      "smart.empty":    "Τίποτα εδώ",
      "smart.empty.hint": "Εδώ εμφανίζονται εργασίες από όλες τις λίστες σου, όταν ταιριάζουν.",
      "prio.label":     "Προτεραιότητα",
      "prio.1":         "Προτεραιότητα 1 (επείγον)",
      "prio.2":         "Προτεραιότητα 2 (υψηλή)",
      "prio.3":         "Προτεραιότητα 3 (μέτρια)",
      "prio.4":         "Προτεραιότητα 4 (καμία)",
      "prio.none":      "Καμία",
      "item.list":      "Λίστα",
      "subs.title":     "Υποεργασίες",
      "subs.add":       "Προσθήκη",
      "subs.ph":        "Νέα υποεργασία…",
      "subs.remove":    "Διαγραφή υποεργασίας",
      "subs.up":        "Μετακίνηση πάνω",
      "subs.down":      "Μετακίνηση κάτω",
      "subs.toggle":    "Εμφάνιση ή απόκρυψη υποεργασιών",
      "recur.mode":     "Η επόμενη ημερομηνία μετράει",
      "recur.mode.fixed": "με σταθερό πρόγραμμα",
      "recur.mode.after": "από την ολοκλήρωση",
      "recur.after.short": "από την ολοκλήρωση",
      "sort.title":     "Ταξινόμηση",
      "sort.manual":    "Χειροκίνητη σειρά",
      "sort.prio":      "Κατά προτεραιότητα",
      "sort.due":       "Κατά προθεσμία",
      "menu.move":      "Μετακίνηση σε…",
      "menu.open":      "Άνοιγμα",
      "menu.select":    "Επιλογή",
      "sel.count":      "Επιλεγμένες: {n}",
      "sel.act":        "Προτεραιότητα / Μετακίνηση…",
      "toast.moved":    "Μετακινήθηκε στη λίστα «{list}»",
      "toast.movedN":   "{n} εργασίες μετακινήθηκαν στη λίστα «{list}»",
      "toast.addedTo":  "Προστέθηκε στη λίστα «{list}»",
      "filter.save":    "Νέο αποθηκευμένο φίλτρο…",
      "flt.title":      "Νέο αποθηκευμένο φίλτρο",
      "flt.edit":       "Επεξεργασία αποθηκευμένου φίλτρου",
      "flt.newname":    "Το φίλτρο μου",
      "flt.labels":     "Ετικέτες (οποιαδήποτε από αυτές)",
      "flt.due.any":    "Οποιαδήποτε",
      "flt.due.overdue": "Εκπρόθεσμες",
      "flt.due.today":  "Σήμερα ή εκπρόθεσμες",
      "flt.due.month":  "Επόμενες 30 ημέρες",
      "flt.due.range":  "Ανάμεσα σε ημερομηνίες",
      "flt.from":       "Από",
      "flt.to":         "Έως",
      "flt.text":       "Το κείμενο περιέχει",
      "flt.delete":     "Διαγραφή φίλτρου",
      "confirm.fltdel": "Διαγραφή αυτού του αποθηκευμένου φίλτρου; Οι εργασίες του μένουν όπου είναι.",
      "toast.fltdel":   "Το φίλτρο διαγράφηκε",
      "hh.title":       "Νοικοκυριό",
      "hh.shareHint":   "Όλοι στο νοικοκυριό βλέπουν και αλλάζουν αυτή τη λίστα από το δικό τους orOS. Κρυπτογραφείται στις συσκευές σου.",
      "hh.shareGo":     "Κοινή χρήση",
      "td.title": "Λίστα εργασιών server (CalDAV)",
      "td.hint": "Σύνδεσε αυτή τη λίστα με μια λίστα εργασιών του δικού σου server (Nextcloud, Radicale, mailbox.org, Fastmail, iCloud…): οι εργασίες της πηγαίνουν μετά και προς τις δύο μεριές, μαζί και οι υποεργασίες. Τίποτα δεν διαγράφεται σε καμία μεριά αν δεν ήταν συγχρονισμένο πριν.",
      "td.noacct": "Σύνδεσε πρώτα τον server ημερολογίου σου, στις Ρυθμίσεις › Συγχρονισμός › Ημερολόγια και επαφές. Ο κωδικός μένει σε αυτή τη συσκευή.",
      "td.settings": "Άνοιγμα Ρυθμίσεων",
      "td.pick": "Διάλεξε λίστα εργασιών του server",
      "td.none": "Ο server σου δεν έχει λίστα εργασιών που να μην είναι ήδη συνδεδεμένη.",
      "td.noname": "Εργασίες",
      "td.ro.col": "μόνο ανάγνωση",
      "td.link": "Σύνδεση",
      "td.linked": "Συνδεδεμένη με {n}",
      "td.preview.wait": "Έλεγχος του server…",
      "td.preview": "{down} για λήψη, {up} για αποστολή, {same} υπάρχουν ήδη εδώ. Δεν γράφεται τίποτα μέχρι να πατήσεις Σύνδεση.",
      "td.preview.ro": "Η λίστα εργασιών είναι μόνο για ανάγνωση στον server, οπότε δεν στέλνεται τίποτα.",
      "td.sync": "Συγχρονισμός τώρα",
      "td.unlink": "Αποσύνδεση",
      "td.unlinked": "Αποσυνδέθηκε. Οι εργασίες μένουν σε αυτή τη λίστα και στον server.",
      "td.ok": "Συγχρονισμένη, {t}",
      "td.never": "Δεν έχει συγχρονιστεί ακόμα",
      "td.wait": "Συγχρονισμός…",
      "td.other": "Συνδέθηκε σε άλλη συσκευή σου. Σύνδεσε και αυτή τη συσκευή στις Ρυθμίσεις › Συγχρονισμός για να συγχρονίζεται κι εδώ.",
      "td.gone": "Ο server σου δεν δείχνει πια αυτή τη λίστα εργασιών. Έλεγξέ το στις Ρυθμίσεις › Συγχρονισμός ή αποσύνδεσέ τη.",
      "td.conflicts": "{n} άλλαξαν και στις δύο μεριές: κρατήθηκε η νεότερη, η άλλη ως αντίγραφο με την ένδειξη (σύγκρουση).",
      "td.mark": " (σύγκρουση)",
      "td.held": "{n} διαγραφές περιμένουν εσένα ({a} στο orOS, {b} στον server).",
      "td.held.yes": "Διάγραψέ τες",
      "td.held.no": "Φέρ' τες πίσω",
      "td.ro": "Αυτή η εργασία έρχεται από τη λίστα εργασιών του server σου και το orOS δεν μπορεί να κρατήσει όλα της τα στοιχεία, οπότε οι αλλαγές εδώ αναιρούνται. Άλλαξέ τη στον server.",
      "td.err.noacct": "Δεν υπάρχει λογαριασμός server σε αυτή τη συσκευή: σύνδεσέ τον στις Ρυθμίσεις › Συγχρονισμός.",
      "td.err.net": "Ο server δεν ήταν προσβάσιμος. Το orOS θα ξαναδοκιμάσει αργότερα.",
      "td.err.auth": "Ο server δεν δέχτηκε τον κωδικό: έλεγξέ τον στις Ρυθμίσεις › Συγχρονισμός.",
      "td.err.ro": "Ο server δεν επιτρέπει αλλαγές σε αυτή τη λίστα εργασιών.",
      "td.err.other": "Ο server απάντησε με σφάλμα ({e}). Το orOS θα ξαναδοκιμάσει αργότερα.",
      "hh.none":        "Δεν έχεις ακόμα νοικοκυριό. Φτιάξε ένα στην εφαρμογή «Νοικοκυριό» και μετά μοιράσου λίστες από εδώ.",
      "hh.open":        "Άνοιγμα «Νοικοκυριό»",
      "hh.sharedIn":    "Κοινή με: {hh}",
      "hh.hint":        "Όλοι στο νοικοκυριό βλέπουν και αλλάζουν αυτή τη λίστα. Οι ετικέτες μένουν δικές σου.",
      "hh.stop":        "Διακοπή κοινής χρήσης (κρατάω δικό μου αντίγραφο)",
      "hh.by":          "Τελευταία αλλαγή: {name}",
      "tab.shared":     "Κοινή με νοικοκυριό",
      "confirm.hhdel":  "Διαγραφή της λίστας για όλους στο νοικοκυριό; Οι άλλοι μπορούν να τη φέρουν πίσω από το «Νοικοκυριό» για 30 ημέρες.",
      "confirm.hhstop": "Διακοπή κοινής χρήσης; Η λίστα φεύγει από το νοικοκυριό για όλους και εσύ κρατάς δικό σου αντίγραφο.",
      "toast.hhShared": "Τώρα κοινή με: {hh}",
      "toast.hhStopped":"Η κοινή χρήση σταμάτησε. Το αντίγραφό σου είναι στις λίστες σου.",
      "toast.hhDel":    "Η λίστα διαγράφηκε για το νοικοκυριό",
      "toast.hhFail":   "Δεν έγινε. Δοκίμασε ξανά σε λίγο.",
      "seed.general":   "Γενικά",
      "seed.groceries": "Ψώνια",
      "wd.0": "Κυριακή", "wd.1": "Δευτέρα", "wd.2": "Τρίτη", "wd.3": "Τετάρτη",
      "wd.4": "Πέμπτη", "wd.5": "Παρασκευή", "wd.6": "Σάββατο"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "todo", LANG);

  // Dates and numbers: the language's locale (de-DE for German).
  function loc() {
    return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  }

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Weekday names: shown with t("wd.N"); the quick-add parser reads the
  // English and Greek ones (German date words are not parsed).
  var WEEKDAY_KEYS = { en: [], el: [] };
  for (var wdi = 0; wdi < 7; wdi++) {
    WEEKDAY_KEYS.en.push(STRINGS.en["wd." + wdi]);
    WEEKDAY_KEYS.el.push(STRINGS.el["wd." + wdi]);
  }
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
    return d.toLocaleDateString(loc(), { day: "numeric", month: "short" });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }

  // BOOT MARKER (Part VII §16 + Checklist F): stale-bundle
  // detection (R3/R11) + lang attr at boot (F: i18N).
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("todo.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // §14 LABEL_COLORS — shared 8-color vocabulary (Notes/To-Do/
  // Mood/Habits). Audit #23: todo shipped a private palette;
  // unified. Stored label colors are data — untouched; only the
  // picker options change.
  var SWATCH_COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
                       "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var FALLBACK_COLOR = "#ecc75f";

  // ---------- 2. Data model, storage, migration ----------
  // state = {
  //   ver: 3,
  //   sm: <root settings mtime — activeList/hideCompleted LWW>,
  //   activeList: <listId>,
  //   hideCompleted: bool,
  //   deleted: { <entityId>: <tombstone ts> },   // pruned after 30 days
  //   labels: [{ id, name, color, mtime, om, pos }],
  //   lists: [{
  //     id, name, mtime, om, pos,
  //     recurrence: null | {every, unit, weekday},
  //     lastReset: iso, nextReset: iso,
  //     items: [{ id, text, done, due, notes,
  //               labels: [<label id>], info: [{ id, label, value }],
  //               recurrence: null | {every, unit, weekday},
  //               mtime, om, pos }]
  //   }]
  // }
  //   mtime — content version: larger wins merge conflicts
  //   om/pos — ordering version: reorders stamp om + rewrite pos;
  //           content edits never disturb order
  var state = null;
  var renderQueued = false;

  // Search / filter are session-only view state (never persisted):
  // sync pulls from another device must not resurrect a stale view.
  var searchQuery = "";
  var activeFilters = [];

  // --- version stamps ---

  // TD-3 — ONE STAMP PER FIELD OF A TASK. A task used to carry a
  // single mtime and the merge took the whole newer object: ticking
  // a task on the phone erased notes written on the laptop (or the
  // other way round), and the nightly list cycle — which only
  // un-ticks — overwrote every edit made elsewhere to those tasks.
  //   it.fm = { text, done, due, notes, labels, info, recurrence }
  // (always complete once present); it.mtime = the newest of them
  // and still decides life against a tombstone.
  // A task whose mtime is NEWER than all of its field stamps was
  // last changed by a device on the previous todo.js (it bumps mtime
  // only): for that version mtime speaks for every field.
  var ITEM_FIELDS = ["text", "done", "due", "notes", "labels", "info", "recurrence"];
  // TD-14 (wave "closer to Todoist") — the newer fields keep their
  // stamps OUTSIDE fm, in it.xf, so a device on the previous todo.js
  // (whose canonItem rebuilds fm from ITEM_FIELDS) keeps them as they
  // are, and a task that never had them is byte-identical in both:
  //   xf.prio — priority (it.prio 1..3; absent = P4, no priority)
  //   xf.subs — the subtasks changed (each subtask has its own mtime;
  //             removed ones are tombstoned in state.deleted)
  //   xf.so   — the order of the subtasks
  //   xf.list — the task was moved into this list (dedupeMoved)
  var XF_FIELDS = ["prio", "subs", "so", "list"];
  var Mdl = window.OrosTodoModel;
  function touchedByOldCode(it) {
    if (!it.fm || typeof it.fm !== "object") return false;
    var mx = 0;
    for (var i = 0; i < ITEM_FIELDS.length; i++) {
      var v = it.fm[ITEM_FIELDS[i]];
      if (typeof v === "number" && v > mx) mx = v;
    }
    if (it.xf && typeof it.xf === "object") {
      for (var j = 0; j < XF_FIELDS.length; j++) {
        var w = it.xf[XF_FIELDS[j]];
        if (typeof w === "number" && w > mx) mx = w;
      }
    }
    return (it.mtime || 0) > mx;
  }
  function xfStamp(it, f) {
    return (it && it.xf && typeof it.xf[f] === "number") ? it.xf[f] : 0;
  }
  // Stamp one of the newer fields. The fm stamps are spelled out first
  // (ensureFm) while mtime still speaks for them.
  function touchXf(it, f, now) {
    ensureFm(it);
    now = now || Date.now();
    var xf = {};
    XF_FIELDS.forEach(function (k) { if (typeof (it.xf || {})[k] === "number") xf[k] = it.xf[k]; });
    xf[f] = now;
    it.xf = xf;
    it.mtime = Math.max(it.mtime || 0, now);
  }
  function fieldStamp(it, f) {
    if (!it.fm || typeof it.fm !== "object" || touchedByOldCode(it)) return it.mtime || 0;
    return (typeof it.fm[f] === "number") ? it.fm[f] : 0;
  }
  function ensureFm(it) {
    var fm = {};
    for (var i = 0; i < ITEM_FIELDS.length; i++) fm[ITEM_FIELDS[i]] = fieldStamp(it, ITEM_FIELDS[i]);
    it.fm = fm;
  }
  function touchField(it, f) {
    ensureFm(it);
    var now = Date.now();
    it.fm[f] = now;
    it.mtime = now;
  }
  function stampItemNewest(it, now) {
    it.fm = {};
    for (var i = 0; i < ITEM_FIELDS.length; i++) it.fm[ITEM_FIELDS[i]] = now;
    it.mtime = now;
  }

  // TD-9 — the same for a LIST header, in two groups: "name", and
  // "cycle" (recurrence + lastReset + nextReset travel together).
  // Renaming a list on one device no longer reverts a cycle set on
  // another, and the other way round.
  var LIST_FIELDS = ["name", "cycle"];
  function listTouchedByOldCode(l) {
    if (!l.fm || typeof l.fm !== "object") return false;
    var mx = Math.max(typeof l.fm.name === "number" ? l.fm.name : 0,
                      typeof l.fm.cycle === "number" ? l.fm.cycle : 0);
    return (l.mtime || 0) > mx;
  }
  function listStamp(l, f) {
    if (!l.fm || typeof l.fm !== "object" || listTouchedByOldCode(l)) return l.mtime || 0;
    return (typeof l.fm[f] === "number") ? l.fm[f] : 0;
  }
  function touchListField(l, f) {
    var fm = { name: listStamp(l, "name"), cycle: listStamp(l, "cycle") };
    var now = Date.now();
    fm[f] = now;
    l.fm = fm;
    l.mtime = now;
  }
  function stampListNewest(l, now) {
    l.fm = { name: now, cycle: now };
    l.mtime = now;
  }

  function tombstone(id) {
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();
  }

  function defaultState() {
    // SEEDS MUST BE DETERMINISTIC (v0.36.00 fix — "parallel lists on
    // fresh device" root cause). Fixed IDs + mtime/sm/om = 0 mean:
    //   · every device computes byte-identical seeds → the merge
    //     union-by-id COLLAPSES them into ONE instance (no twins)
    //   · mtime 0 = "oldest possible content" → any real user edit
    //     or remote copy wins LWW, seeds never override real data
    //   · sm 0   = seeded settings can NEVER beat the remote's
    //     activeList/hideCompleted (the "opens the new empty list
    //     by default" symptom)
    //   · tombstones (user deleted defaults elsewhere) always beat
    //     mtime-0 seeds → deleted defaults stay deleted
    // DO NOT use newListObj()/uid()/Date.now() here. The names are
    // language-dependent by design (localized per device); LWW picks
    // one deterministically — never duplicates.
    var mkSeed = function (id, name, pos) {
      return {
        id: id, name: name, mtime: 0, om: 0, pos: pos,
        recurrence: null, lastReset: null, nextReset: null, items: [],
        fm: { name: 0, cycle: 0 }
      };
    };
    return {
      ver: DATA_VER,
      sm: 0,
      om: 0,
      activeList: "tdl-general",
      hideCompleted: false,
      deleted: {},
      labels: [],
      lists: [
        mkSeed("tdl-general", t("seed.general"), 0),
        mkSeed("tdl-groceries", t("seed.groceries"), 1)
      ]
    };
  }

  function newListObj(name) {
    return {
      id: uid(),
      name: name,
      mtime: Date.now(),
      om: 0,                         // ordering version (items' order)
      pos: 0,                        // position within state.lists
      recurrence: null,
      lastReset: null,
      nextReset: null,
      items: []
    };
  }
  function freshList(name) {
    var l = newListObj(name);
    stampListNewest(l, l.mtime);
    return l;
  }

  function newItemObj(text, due) {
    return {
      id: uid(),
      text: text,
      done: false,
      due: due || null,
      notes: "",
      labels: [],
      info: [],
      recurrence: null,
      mtime: Date.now(),
      om: 0,                         // (reserved, per-item; ordering is list-level)
      pos: 0
    };
  }
  function freshItem(text, due) {
    var it = newItemObj(text, due);
    stampItemNewest(it, it.mtime);
    return it;
  }

  // Additive migration: bring ANY older shape up to DATA_VER.
  // v1 → labels/info; v2 → merge stamps (sm/om/mtime/pos/deleted).
  // Unknown stamps default to 0 = "oldest possible": real remote
  // timestamps (if any) win over migrated data — never the reverse.
  function migrate(data) {
    if (!data || !Array.isArray(data.lists)) return null;
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (typeof data.hideCompleted !== "boolean") data.hideCompleted = false;
    if (typeof data.activeList !== "string") data.activeList = (data.lists[0] || {}).id || null;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (!Array.isArray(data.labels)) data.labels = [];
    data.labels.forEach(function (lb) {
      if (typeof lb.mtime !== "number") lb.mtime = 0;
      if (typeof lb.pos !== "number") lb.pos = 0;
    });
    data.lists.forEach(function (list) {
      if (typeof list.mtime !== "number") list.mtime = 0;
      if (typeof list.om !== "number") list.om = 0;
      if (typeof list.pos !== "number") list.pos = 0;
      if (!Array.isArray(list.items)) list.items = [];
      list.items.forEach(function (it) {
        if (!Array.isArray(it.labels)) it.labels = [];
        if (!Array.isArray(it.info)) it.info = [];
        if (typeof it.mtime !== "number") it.mtime = 0;
        if (typeof it.pos !== "number") it.pos = 0;
        normNewFields(it);
      });
    });
    normFilters(data);
    normDav(data);
    data.ver = DATA_VER;
    return data;
  }
  // TD-14: the newer task fields in their one shape (on load AND on
  // every merge result, idempotent). Absent = not set, so a task that
  // never had them keeps the exact shape of the previous version.
  function normNewFields(it) {
    if (it.prio !== undefined && it.prio !== 1 && it.prio !== 2 && it.prio !== 3) delete it.prio;
    if (it.subs !== undefined) {
      var subs = Mdl.cleanSubs(it.subs);
      if (subs.length) it.subs = subs; else delete it.subs;
    }
    if (it.xf !== undefined) {
      var xf = {}, any = false;
      if (it.xf && typeof it.xf === "object") {
        XF_FIELDS.forEach(function (k) {
          if (typeof it.xf[k] === "number" && isFinite(it.xf[k])) { xf[k] = it.xf[k]; any = true; }
        });
      }
      if (any) it.xf = xf; else delete it.xf;
    }
    if (it.recurrence && typeof it.recurrence === "object") {
      if (it.recurrence.after !== undefined && it.recurrence.after !== true) delete it.recurrence.after;
    }
  }
  // CalDAV links (wave 5): state.dav = [{ id: <list id>, url, mtime }],
  // one per list, the newer one wins (an unlink is url "" with its own
  // stamp, so it beats the link on the person's other devices). Absent
  // while there is none: the slice then has the previous shape.
  function cleanDavLink(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id || x.id.length > 80) return null;
    var url = typeof x.url === "string" && x.url.length <= 2000 && /^https?:\/\//.test(x.url) ? x.url : "";
    var mt = typeof x.mtime === "number" && isFinite(x.mtime) ? x.mtime : 0;
    return { id: x.id, url: url, mtime: mt };
  }
  function newerLink(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    return a.url >= b.url ? a : b;
  }
  function normDav(data) {
    if (data.dav === undefined) return;
    var by = {};
    (Array.isArray(data.dav) ? data.dav : []).forEach(function (x) {
      var c = cleanDavLink(x);
      if (c) by[c.id] = by[c.id] ? newerLink(by[c.id], c) : c;
    });
    var ids = Object.keys(by).sort();
    if (ids.length) data.dav = ids.map(function (id) { return by[id]; });
    else delete data.dav;
  }
  // Saved filters (state.filters, order version state.fom). Absent
  // when there are none: the slice then has the previous shape.
  function normFilters(data) {
    if (data.filters === undefined && data.fom === undefined) return;
    var fl = [];
    (Array.isArray(data.filters) ? data.filters : []).forEach(function (f) {
      var c = Mdl.cleanFilter(f);
      if (c) fl.push(c);
    });
    if (fl.length) {
      data.filters = fl;
      if (typeof data.fom !== "number") data.fom = 0;
    } else {
      delete data.filters;
      delete data.fom;
    }
  }

  // TD-4 — tombstones in ONE canonical form: keys sorted, and the
  // 30-day prune measured against the NEWEST stamp found in the data,
  // never against this device's clock. Two devices used to hold the
  // same tombstones in different key order (each deletes something
  // before syncing) — the serialized states never matched, and both
  // uploaded on every sync cycle, for as long as the tombs lived.
  function newestStamp(st) {
    var mx = Math.max(st.sm || 0, st.om || 0);
    (st.labels || []).forEach(function (lb) { if ((lb.mtime || 0) > mx) mx = lb.mtime; });
    (st.lists || []).forEach(function (l) {
      if ((l.mtime || 0) > mx) mx = l.mtime;
      if ((l.om || 0) > mx) mx = l.om;
      (l.items || []).forEach(function (it) { if ((it.mtime || 0) > mx) mx = it.mtime; });
    });
    var del = st.deleted || {};
    Object.keys(del).forEach(function (id) { if ((del[id] || 0) > mx) mx = del[id]; });
    return mx;
  }
  // TD-10: the tombstone of a DEFAULT list never expires. Every new
  // device creates the two default lists again (same ids, stamp 0);
  // once the 30 days were over, a default list the user had deleted
  // came back, empty, on all devices.
  var SEED_LIST_IDS = { "tdl-general": true, "tdl-groceries": true };
  function canonDeleted(st) {
    var src = st.deleted || {}, out = {};
    var cutoff = newestStamp(st) - TOMB_LIFETIME_MS;
    Object.keys(src).sort().forEach(function (id) {
      if (SEED_LIST_IDS[id] || (src[id] || 0) >= cutoff) out[id] = src[id];
    });
    return out;
  }
  function pruneTombstones(st) {
    st.deleted = canonDeleted(st);
  }

  // Canonical task: fixed key order, field stamps always spelled out.
  var ITEM_KEYS = ["id", "text", "done", "due", "notes", "labels", "info", "recurrence",
                   "mtime", "om", "pos", "fm"];
  function canonItem(src) {
    var it = {}, i;
    for (i = 0; i < ITEM_KEYS.length; i++) if (src[ITEM_KEYS[i]] !== undefined) it[ITEM_KEYS[i]] = src[ITEM_KEYS[i]];
    Object.keys(src).sort().forEach(function (k) {
      if (it[k] === undefined && src[k] !== undefined) it[k] = src[k];
    });
    var fm = {};
    for (i = 0; i < ITEM_FIELDS.length; i++) fm[ITEM_FIELDS[i]] = fieldStamp(src, ITEM_FIELDS[i]);
    delete it.fm;
    it.fm = fm;
    normNewFields(it);
    return it;
  }
  // What the sync engine sees (getter) and what the merge returns.
  var LIST_KEYS = ["id", "name", "mtime", "om", "pos", "recurrence", "lastReset", "nextReset", "items", "fm"];
  function canonList(src) {
    var l = {}, i;
    for (i = 0; i < LIST_KEYS.length; i++) if (src[LIST_KEYS[i]] !== undefined) l[LIST_KEYS[i]] = src[LIST_KEYS[i]];
    Object.keys(src).sort().forEach(function (k) {
      if (l[k] === undefined && src[k] !== undefined) l[k] = src[k];
    });
    l.items = (src.items || []).map(canonItem);
    delete l.fm;
    l.fm = { name: listStamp(src, "name"), cycle: listStamp(src, "cycle") };
    return l;
  }
  function canonState(st) {
    var out = JSON.parse(JSON.stringify(st));
    var tomb = out.deleted || {};
    out.lists = (out.lists || []).map(canonList);
    // TD-14: a task moved on one device and still in its old list on
    // another stays only where it was moved last; tombstoned subtasks
    // are gone from every copy.
    out.lists = Mdl.dedupeMoved(out.lists, function (x, y) { return canonItem(mergeItem(x, y)); });
    out.lists.forEach(function (l) {
      l.items.forEach(function (it) {
        if (!it.subs) return;
        var alive = Mdl.dropDeadSubs(it.subs, tomb);
        if (alive.length) it.subs = alive; else delete it.subs;
      });
    });
    normFilters(out);
    normDav(out);
    out.deleted = canonDeleted(out);
    // one root key order whatever order the state was built in
    var root = {};
    ROOT_KEYS.forEach(function (k) { if (out[k] !== undefined) root[k] = out[k]; });
    Object.keys(out).sort().forEach(function (k) { if (root[k] === undefined) root[k] = out[k]; });
    return root;
  }
  var ROOT_KEYS = ["ver", "sm", "om", "activeList", "hideCompleted", "deleted", "labels", "lists", "filters", "fom", "dav"];

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data && Array.isArray(data.lists) && data.lists.length > 0) {
          state = data;
          lastSaved = raw;
          pruneTombstones(state);
          applyListCycles();      // section 3 — may reset lists
          return;
        }
      }
    } catch (e) {
      // TD-13: corrupted → fresh start, but the unreadable text is
      // copied aside first (rescue copy, never synced) instead of
      // being overwritten by the save() below.
      try {
        var bad = localStorage.getItem(STORAGE_KEY);
        if (bad && !localStorage.getItem(STORAGE_KEY + "-broken")) localStorage.setItem(STORAGE_KEY + "-broken", bad);
      } catch (e1) {}
    }
    state = defaultState();
    save();
  }

  // Auto-save: every mutation ends with save() + scheduleRender().
  function save() {
    var mine;
    try {
      mine = JSON.stringify(personal(state));
      if (mine !== lastSaved) localStorage.setItem(STORAGE_KEY, mine);
    }
    catch (e) {
      // TD-6: a full disk used to be swallowed here — the task looked
      // saved and was gone at the next start. One inbox line per hour.
      try {
        var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
        if (N && typeof N.emit === "function") {
          N.emit({ ns: "todo", key: "save-fail:" + new Date().toISOString().slice(0, 13),
                   type: "err", title: "To-Do", body: t("toast.saveFail") });
        } else { showToast(t("toast.saveFail"), false); }
      } catch (e2) {}
    }
    hhPush();
    if (!tdApplying) tdKick();
    // only the person's own lists sync to their cloud (shared ones go
    // to the household): nothing of theirs changed → nothing to upload
    if (mine === lastSaved) return;
    lastSaved = mine;
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

  // TD-8 — THE VIEW BELONGS TO THE DEVICE. Which tab is open and
  // whether completed tasks are hidden used to be SYNCED settings
  // (state.activeList / state.hideCompleted, ordered by state.sm):
  // every tab switch marked the engine dirty and uploaded, and the
  // other device's screen jumped to that tab at its next pull — a
  // task typed into the quick-add at that moment landed in a list the
  // user was not looking at a second earlier.
  // They now live in "oros-todo-prefs" (device-local, swept by the
  // factory reset). The three old fields stay in the data untouched,
  // for devices still running the previous todo.js.
  var PREFS_KEY = "oros-todo-prefs";
  // TD-14: also which smart list / saved filter is open (view.smart:
  // "today" | "week" | "nodate" | "p1" | "f:<filter id>" | null) and the
  // sort chosen per view (view.sort { <list id | smart id | f:id>: mode }).
  var view = { activeList: null, hideCompleted: false, smart: null, sort: {} };
  function loadView() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) {}
    if (p && typeof p === "object") {
      view.activeList = (typeof p.activeList === "string") ? p.activeList : null;
      view.hideCompleted = !!p.hideCompleted;
      view.smart = (typeof p.smart === "string") ? p.smart : null;
      view.sort = {};
      if (p.sort && typeof p.sort === "object") {
        Object.keys(p.sort).slice(0, 200).forEach(function (k) {
          if (SORT_MODES.indexOf(p.sort[k]) >= 0) view.sort[k] = p.sort[k];
        });
      }
    } else {
      // first run of this version: start from what this device showed last
      view.activeList = (typeof state.activeList === "string") ? state.activeList : null;
      view.hideCompleted = !!state.hideCompleted;
      saveView();
    }
  }
  function saveView() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(view)); } catch (e) {}
  }
  function setActiveList(id) {
    view.activeList = id;
    view.smart = null;              // a list was asked for: leave any smart list
    saveView();
  }
  function setSmart(id) {
    view.smart = id;
    saveView();
  }
  var SORT_MODES = ["manual", "prio", "due"];
  // What is on screen: null = the active list; otherwise
  // { key, smart: id } or { key, filter: f }.
  function currentView() {
    var id = view.smart;
    if (!id) return null;
    if (Mdl.SMART.indexOf(id) >= 0) return { key: id, smart: id };
    if (id.indexOf("f:") === 0) {
      var f = filterById(id.slice(2));
      if (f) return { key: id, filter: f };
    }
    return null;
  }
  function viewKey() {
    var cv = currentView();
    return cv ? cv.key : activeList().id;
  }
  function sortMode() {
    var k = viewKey(), m = view.sort[k];
    if (SORT_MODES.indexOf(m) >= 0) return m;
    return currentView() ? "due" : "manual";
  }
  function setSortMode(m) {
    var k = viewKey();
    if ((currentView() ? "due" : "manual") === m) delete view.sort[k];
    else view.sort[k] = m;
    saveView();
  }
  function filterById(id) {
    var fl = state.filters || [];
    for (var i = 0; i < fl.length; i++) if (fl[i].id === id) return fl[i];
    return null;
  }
  function activeList() {
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id === view.activeList) return state.lists[i];
    }
    // The list on screen is gone (deleted here or elsewhere): first one.
    view.activeList = state.lists[0].id;
    saveView();
    return state.lists[0];
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


  // ---------- 2a. Lists shared with a household (BR-HH) ----------
  // A shared list is a household document (window.parent.orosHousehold,
  // household/engine.js); todo/house.js turns it into a list with the
  // id "tdh-<document id>" and back. Such a list lives only in memory:
  // it never goes into "oros-todo-data" nor into the person's own cloud
  // copy (personal()), and every edit leaves through save() → hhPush()
  // as the fields that changed. Nothing here merges a shared list: the
  // household merge does, field by field, and hhInject() rebuilds the
  // list from its result, so the two can never answer each other.
  var HHo = window.OrosTodoHouse || null, HC = window.OrosHouseCore || null;
  var lastSaved = null;
  var hhLast = {};        // document id → the projection last read or sent
  var hhInfo = {};        // list id → { box, id, hh }
  var hhWant = null;      // a deep link to a shared list not built yet
  var hhNoCopy = {};      // documents deleted here: no own copy
  function hhApi() {
    if (!HHo || !HC) return null;
    try {
      var p = window.parent;
      return p && p !== window && p.orosHousehold && typeof p.orosHousehold.docs === "function" ? p.orosHousehold : null;
    } catch (e) { return null; }
  }
  function isShared(id) { return !!HHo && HHo.isShared(id); }
  function personal(st) {
    var o = {};
    Object.keys(st).forEach(function (k) { o[k] = st[k]; });
    o.lists = (st.lists || []).filter(function (l) { return !isShared(l.id); });
    return o;
  }
  function personalCount() { return personal(state).lists.length; }
  // The person keeps at least one list of their own (load() treats a
  // state without lists as broken).
  function keepOneList() {
    if (personalCount() > 0) return null;
    var fresh = freshList(t("new.list"));
    fresh.pos = 0;
    state.lists.unshift(fresh);
    return fresh;
  }
  function hhSig(l) {
    return JSON.stringify(HHo.project(l)) + "|" + l.items.map(function (it) { return it.hhBy || ""; }).join(",");
  }
  // Rebuilds the shared lists from the household; true when what is on
  // screen changed. Also turns lists that left a household (this person
  // stopped sharing, left, was removed) into lists of their own.
  function hhInject() {
    var h = hhApi();
    if (!h || !state) return false;
    var changed = false, keep = {}, next = [], info = {};
    state.lists.forEach(function (l) { if (isShared(l.id)) keep[l.id] = l; });
    h.docs("todo").forEach(function (d) {
      if (!d.ready) return;
      var v = h.view(d.box, d.id, ["o"]);
      if (!v) return;
      var lid = HHo.PREFIX + d.id, cur = keep[lid], built = HHo.build(v, d.id, cur);
      info[lid] = { box: d.box, id: d.id, hh: d.hh };
      hhLast[d.id] = HHo.project(built);
      if (cur && hhSig(cur) === hhSig(built)) { next.push(cur); return; }
      if (cur) { built.pos = cur.pos; }
      next.push(built);
      changed = true;
    });
    Object.keys(keep).forEach(function (id) { if (!info[id]) changed = true; });
    hhInfo = info;
    var copies = hhCopies(h);
    if (changed || copies) {
      state.lists = state.lists.filter(function (l) { return !isShared(l.id); }).concat(next);
    }
    if (copies) save();
    if (hhWant && listById(hhWant.list)) { var w = hhWant; hhWant = null; setTimeout(function () { openSearchTarget(w); }, 0); }
    return changed || copies;
  }
  function hhCopies(h) {
    var made = false, now = Date.now();
    h.archived("todo").forEach(function (a) {
      if (!a.take) return;
      if (hhNoCopy[a.id]) { h.dropArchived(a.box, a.id); return; }
      var id = HHo.COPY + a.id;
      if (!listById(id)) {
        var l = HHo.copyOf(HC.view(a.doc, ["o"]), a.id);
        // newer than any tombstone the share left on these ids
        stampListNewest(l, now);
        l.items.forEach(function (it) { stampItemNewest(it, now); delete state.deleted[it.id]; });
        delete state.deleted[id];
        l.pos = state.lists.length;
        state.lists.push(l);
        state.om = now;
        made = true;
      }
      h.dropArchived(a.box, a.id);
    });
    return made;
  }
  // Sends what changed in the shared lists since they were last read.
  function hhPush() {
    var h = hhApi();
    if (!h || !state) return;
    state.lists.forEach(function (l) {
      var inf = hhInfo[l.id];
      if (!inf || !hhLast[inf.id]) return;
      var prev = hhLast[inf.id], cur = HHo.project(l);
      var d = HC.diffItems(prev.items, cur.items, HHo.FIELDS), m = {}, anyM = false;
      ["rec", "last", "next"].forEach(function (f) {
        if (JSON.stringify(prev.m[f]) !== JSON.stringify(cur.m[f])) { m[f] = cur.m[f]; anyM = true; }
      });
      hhLast[inf.id] = cur;
      if (cur.m.t && cur.m.t !== prev.m.t) h.retitle(inf.box, inf.id, cur.m.t);
      if (d || anyM) h.change(inf.box, inf.id, { set: d ? d.set : {}, del: d ? d.del : [], m: m });
    });
  }
  // A task moved between a list of the person's own and a shared one:
  // gone from the own lists everywhere (tombstone), or back in them.
  function hhMoved(item, from, to) {
    if (!isShared(from.id) && isShared(to.id)) tombstone(item.id);
    else if (isShared(from.id) && !isShared(to.id)) { delete item.hhBy; stampItemNewest(item, Date.now()); delete state.deleted[item.id]; }
  }
  function hhByOf(list, item) {
    var h = hhApi(), inf = hhInfo[list.id];
    if (!h || !inf || !item.hhBy || item.hhBy === h.me(inf.box)) return null;
    return h.member(inf.box, item.hhBy);
  }
  var hhQueued = false;
  function hhRefresh() {
    if (hhQueued) return;
    hhQueued = true;
    setTimeout(function () {
      hhQueued = false;
      if (hhInject()) scheduleRender();
    }, 0);
  }
  function hhBoot() {
    var h = hhApi();
    if (!h) return;
    var off = h.on(function (e) {
      if (e && (e.type === "doc" || e.type === "list" || e.type === "roster" || e.type === "archive")) hhRefresh();
    });
    window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
    Promise.resolve(h.ready()).then(hhRefresh, function () {});
  }

  // ---------- 2b. Cross-device merge engine (v0.4) ----------
  // Contract (consumed by sync.js via registerSlice's 5th arg):
  //   mergeTodoStates(local, remote) → merged state.
  // Deterministic + symmetric: merge(A,B) === merge(B,A). Convergence
  // on both devices stops the push/pull ping-pong.
  //
  //   · scalars (activeList/hideCompleted) — larger root sm wins
  //   · content (list headers, tasks, labels) — larger mtime wins;
  //     equal mtimes → lexicographically larger JSON (identical
  //     decision on both sides, no coin flips)
  //   · ordering — the side with the larger ordering version (om)
  //     donates the positions; unknown entities append at the end
  //     (older mtime first)
  //   · tombstones — union, max ts. An entity survives only if its
  //     content mtime is NEWER than its tombstone (edit-after-delete
  //     resurrects); otherwise deletion wins.
  //
  // Timestamps come from different device clocks — clock skew simply
  // biases winners, the determinism guarantees no oscillation.

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

  // Whole-entity LWW for leaves (tasks, labels, list HEADERS):
  // bigger mtime wins; tie → larger serialized JSON (deterministic).
  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // Union two entity arrays by id (LWW content). Tombstoned
  // entities are dropped right here — a merge never resurrects a
  // deletion unless the surviving content is genuinely newer.
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

  // Position merged entities by the reference side's order (the side
  // with the larger om). Entities unknown to the reference side go to
  // the end, oldest first. Assigns fresh sequential pos.
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
    return entities.map(function (e, i) {
      if (e.pos === i) return e;
      var c = {};
      Object.keys(e).forEach(function (k) { c[k] = e[k]; });
      c.pos = i;                                 // on a copy: inputs stay untouched
      return c;
    });
  }
  
    // Symmetric ordering-reference pick: larger om wins; TIES broken
  // by lexicographic id sequence (identical decision on both devices
  // — never "local wins", that flip-flops forever).
  // TD-12: on a tie the two id sequences are compared as SEQUENCES
  // (element by element; a prefix is smaller than its extension),
  // restricted to the entities that survive the merge. The merged
  // order is the chosen sequence plus appended newcomers — an
  // extension of it — so merging the result with either input again
  // picks the result's own order. (The old comparison of serialized
  // strings let an EMPTY list beat a full one, and the order could
  // flip when the same data met again.)
  function pickRef(aArr, bArr, aOm, bOm, survivors) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var alive = {};
    (survivors || []).forEach(function (e) { alive[e.id] = true; });
    var seq = function (arr) {
      return (arr || []).map(function (e) { return e.id; })
        .filter(function (id) { return !survivors || alive[id]; });
    };
    var ka = seq(aArr), kb = seq(bArr), n = Math.min(ka.length, kb.length);
    for (var i = 0; i < n; i++) {
      if (ka[i] !== kb[i]) return ka[i] > kb[i] ? aArr : bArr;
    }
    return ka.length >= kb.length ? aArr : bArr;
  }

  // Lists merge STRUCTURALLY: headers LWW by mtime, but each list's
  // items merge independently — a header edit on one device must
  // never clobber item changes on the other.
  // Two versions of ONE task → one task, field by field (TD-3).
  function mergeItem(x, y) {
    if (JSON.stringify(x) === JSON.stringify(y)) return x;
    var base = newerEntity(x, y), out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    var fm = {};
    ITEM_FIELDS.forEach(function (f) {
      var sx = fieldStamp(x, f), sy = fieldStamp(y, f), w;
      if (sx !== sy) w = (sx > sy) ? x : y;
      else {
        var jx = JSON.stringify(x[f] === undefined ? null : x[f]);
        var jy = JSON.stringify(y[f] === undefined ? null : y[f]);
        w = (jx >= jy) ? x : y;                 // tie → same pick on both devices
      }
      if (w[f] === undefined) delete out[f];
      else out[f] = JSON.parse(JSON.stringify(w[f]));
      fm[f] = Math.max(sx, sy);
    });
    out.fm = fm;
    // TD-14: priority from the side that set it last; subtasks one by
    // one (Mdl.mergeSubs); every xf stamp = the newer one.
    var px = xfStamp(x, "prio"), py = xfStamp(y, "prio"), pw;
    if (px !== py) pw = px > py ? x : y;
    else pw = JSON.stringify(x.prio === undefined ? null : x.prio) >= JSON.stringify(y.prio === undefined ? null : y.prio) ? x : y;
    if (pw.prio === undefined) delete out.prio; else out.prio = pw.prio;
    if (x.subs || y.subs) {
      var subs = Mdl.mergeSubs(x.subs, y.subs, xfStamp(x, "so"), xfStamp(y, "so"));
      if (subs.length) out.subs = subs; else delete out.subs;
    }
    var xf = {}, anyXf = false;
    XF_FIELDS.forEach(function (k) {
      var v = Math.max(xfStamp(x, k), xfStamp(y, k));
      if (v || (x.xf && typeof x.xf[k] === "number") || (y.xf && typeof y.xf[k] === "number")) { xf[k] = v; anyXf = true; }
    });
    if (anyXf) out.xf = xf; else delete out.xf;
    out.mtime = Math.max(x.mtime || 0, y.mtime || 0);
    return out;
  }
  function unionItems(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? mergeItem(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }
  function mergeListEntity(la, lb, tomb) {
    var strip = function (l) {
      var c = JSON.parse(JSON.stringify(l));
      delete c.items;
      return c;
    };
    var base = newerEntity(strip(la), strip(lb)), head = {};
    Object.keys(base).forEach(function (k) { head[k] = base[k]; });
    // TD-9: name and cycle each from the side that changed them last
    var nA = listStamp(la, "name"), nB = listStamp(lb, "name");
    var nameFrom = (nA !== nB) ? (nA > nB ? la : lb)
                 : (JSON.stringify(la.name) >= JSON.stringify(lb.name) ? la : lb);
    head.name = nameFrom.name;
    var cyc = function (l) { return JSON.stringify([l.recurrence || null, l.lastReset || null, l.nextReset || null]); };
    var cA = listStamp(la, "cycle"), cB = listStamp(lb, "cycle");
    var cycFrom = (cA !== cB) ? (cA > cB ? la : lb) : (cyc(la) >= cyc(lb) ? la : lb);
    head.recurrence = cycFrom.recurrence ? JSON.parse(JSON.stringify(cycFrom.recurrence)) : null;
    head.lastReset = cycFrom.lastReset || null;
    head.nextReset = cycFrom.nextReset || null;
    head.fm = { name: Math.max(nA, nB), cycle: Math.max(cA, cB) };
    head.mtime = Math.max(la.mtime || 0, lb.mtime || 0);
    head.om = Math.max(la.om || 0, lb.om || 0);
    head.items = unionItems(la.items || [], lb.items || [], tomb);
    head.items = orderEntities(head.items, pickRef(la.items, lb.items, la.om, lb.om, head.items));
    return head;
  }

  function mergeTodoStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = mergeEntityMaps(a.deleted, b.deleted);
    // Pruning and key order happen once, at the end (canonState →
    // canonDeleted), by a rule that does not read this device's clock.

    // scalars: LWW by root settings mtime. TIES must NOT favor the
    // local side — merge(A,B) and merge(B,A) must pick the SAME side
    // or equal-sm devices ping-pong forever. Symmetric tie-break:
    // lexicographic compare of the scalars themselves.
    var sa = JSON.stringify([a.activeList || null, !!a.hideCompleted]);
    var sb = JSON.stringify([b.activeList || null, !!b.hideCompleted]);
    var settings = (a.sm || 0) !== (b.sm || 0)
      ? ((a.sm || 0) > (b.sm || 0) ? a : b)
      : (sa >= sb ? a : b);

    var out = {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      activeList: settings.activeList,
      hideCompleted: settings.hideCompleted,
      deleted: tomb,
      labels: [],
      lists: []
    };

    // labels: content LWW, order by larger om side
    var labels = unionEntities(a.labels || [], b.labels || [], tomb);
    out.labels = orderEntities(labels, pickRef(a.labels, b.labels, a.om, b.om, labels));

    // saved filters (TD-14): content LWW, order by the larger fom side;
    // left out of the result while there are none (previous shape)
    var filters = unionEntities(a.filters || [], b.filters || [], tomb);
    if (filters.length) {
      out.filters = orderEntities(filters, pickRef(a.filters, b.filters, a.fom, b.fom, filters));
      out.fom = Math.max(a.fom || 0, b.fom || 0);
    }

    // lists: pair by id, structural merge (headers + independent items)
    var listMap = {};
    var forEachList = function (arr) {
      (arr || []).forEach(function (l) {
        if (listMap[l.id]) listMap[l.id].push(l);
        else listMap[l.id] = [l];
      });
    };
    forEachList(a.lists); forEachList(b.lists);

    var mergedLists = [];
    Object.keys(listMap).forEach(function (id) {
      var pair = listMap[id];
      var merged;
      if (pair.length === 2) merged = mergeListEntity(pair[0], pair[1], tomb);
      else {
        // one-sided (new or removed elsewhere): its tasks still obey
        // the tombstones (a task deleted on the other device stays so)
        merged = {};
        Object.keys(pair[0]).forEach(function (k) { merged[k] = pair[0][k]; });
        merged.items = orderEntities(
          (pair[0].items || []).filter(function (it) { return entAlive(it, tomb); }),
          pair[0].items);                          // keep the order, renumber pos
      }
      if (entAlive(merged, tomb)) mergedLists.push(merged);
    });
    out.lists = orderEntities(mergedLists, pickRef(a.lists, b.lists, a.om, b.om, mergedLists));

    // CalDAV links: per list the newer one (a link of a list that is
    // gone goes with it)
    var links = {};
    (a.dav || []).concat(b.dav || []).forEach(function (x) {
      var c = cleanDavLink(x);
      if (c) links[c.id] = links[c.id] ? newerLink(links[c.id], c) : c;
    });
    var dav = out.lists.filter(function (l) { return links[l.id]; }).map(function (l) { return links[l.id]; });
    if (dav.length) out.dav = dav;

    // post-conditions: never ship an empty state (fresh-install
    // fallback), never point activeList at a ghost
    if (out.lists.length === 0) return null;
    var found = out.lists.some(function (l) { return l.id === out.activeList; });
    if (!found) out.activeList = out.lists[0].id;
    return canonState(out);
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
    if (item.recurrence.after === true) {
      // TD-14 "after completion": counts from the day it was ticked
      item.due = Mdl.nextAfterDone(todayISO(), item.recurrence);
      item.done = false;
      untickSubs(item);
      return true;
    }
    // TD2: anchor on the CURRENT due date when it is still ahead —
    // finishing early must skip to the NEXT cycle instead of
    // re-issuing the period that was just completed. Past/absent
    // due dates anchor on now (overdue catch-up unchanged). This
    // also keeps the weekly-weekday math exact for biweekly rules,
    // since the anchor now lands on the due weekday.
    var now = new Date();
    var anchor = now;
    if (item.due) {
      var dIso = isoToDate(item.due);
      if (!isNaN(dIso.getTime()) && dIso >= now) anchor = dIso;
    }
    var next = nextOccurrence(anchor, item.recurrence);
    item.due = dateToISO(next);
    item.done = false;
    untickSubs(item);
    return true;
  }
  // A repeating task that comes back, or a list cycle: its checklist
  // starts again too. Only the subtasks that were ticked are stamped.
  function untickSubs(item) {
    if (!item.subs || !item.subs.length) return false;
    var now = Date.now(), any = false;
    item.subs.forEach(function (s) { if (s.done) { s.done = false; s.mtime = now; any = true; } });
    if (any) touchXf(item, "subs", now);
    return any;
  }

  // List-level cycle: when the deadline passes, every item resets.
  // Rolled-over items get fresh mtimes: the cycle event is a REAL
  // content change and must win the next merge (both devices must
  // agree the cycle happened, not re-fight it forever).
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
        list.items.forEach(function (it) {
          if (it.done) { it.done = false; touchField(it, "done"); }   // TD-3: only the tick
          untickSubs(it);
        });
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

  // TD-14: smart lists and saved filters come first, then the lists.
  var SMART_SVG = {
    today: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    week: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    nodate: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    p1: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>',
    filter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>'
  };
  function smartRows(match) {
    var rows = [];
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        if (match(item)) rows.push({ list: list, item: item, i: rows.length });
      });
    });
    return rows;
  }
  // A view across the lists shows the open tasks that match, plus the
  // ones ticked here a moment ago (so a tick can be taken back).
  function viewMatcher(cv) {
    var today = todayISO();
    var ctx = { today: today, labelName: function (id) { var l = labelById(id); return l ? l.name : ""; } };
    return function (item) {
      if (item.done && !justDone[item.id]) return false;
      if (cv.smart) return Mdl.smartMatch(cv.smart, item, today);
      return Mdl.filterMatch(cv.filter, item, ctx);
    };
  }
  var justDone = {};            // session only: tasks ticked inside a smart list
  function makeSmartTab(key, name, icon, count, overdue, filter) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tab smart" + (view.smart === key ? " active" : "") + (filter ? " flt" : "");
    b.setAttribute("role", "tab");
    b.dataset.smart = key;
    b.title = name;
    b.setAttribute("aria-label", name + (count ? " (" + count + ")" : ""));
    var ic = document.createElement("span");
    ic.className = "t-ico";
    ic.innerHTML = icon;                          // fixed markup, no data
    b.appendChild(ic);
    var nm = document.createElement("span");
    nm.className = "t-name";
    nm.textContent = name;
    b.appendChild(nm);
    if (count > 0) {
      var chip = document.createElement("span");
      chip.className = "chip" + (overdue ? " overdue" : " dim");
      chip.textContent = String(count);
      b.appendChild(chip);
    }
    if (filter) {
      var pen = document.createElement("span");
      pen.className = "t-rename";
      pen.setAttribute("role", "button");
      pen.setAttribute("aria-label", t("flt.edit"));
      pen.title = t("flt.edit");
      pen.innerHTML = PEN_SVG;
      pen.addEventListener("click", function (e) { e.stopPropagation(); openFilterDialog(filter.id); });
      b.appendChild(pen);
      b.addEventListener("dblclick", function () { openFilterDialog(filter.id); });
    }
    b.addEventListener("click", function () {
      if (view.smart === key) return;
      setSmart(key);
      justDone = {};
      endSelection();
      scheduleRender();
    });
    return b;
  }
  var PEN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';

  var HH_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>';
  function renderTabs() {
    var tabs = $("tabs");
    tabs.innerHTML = "";
    var today = todayISO(), cvNow = currentView();
    Mdl.SMART.forEach(function (id) {
      var n = 0, late = 0;
      state.lists.forEach(function (l) {
        l.items.forEach(function (it) {
          if (it.done || !Mdl.smartMatch(id, it, today)) return;
          n++;
          if (it.due && it.due < today) late++;
        });
      });
      tabs.appendChild(makeSmartTab(id, t("smart." + id), SMART_SVG[id], n, id === "today" && late > 0, null));
    });
    (state.filters || []).forEach(function (f) {
      var key = "f:" + f.id;
      var n = smartRows(viewMatcher({ filter: f })).filter(function (r) { return !r.item.done; }).length;
      tabs.appendChild(makeSmartTab(key, f.name || t("flt.newname"), SMART_SVG.filter, n, false, f));
    });
    var sep = document.createElement("span");
    sep.className = "tab-sep";
    sep.setAttribute("aria-hidden", "true");
    tabs.appendChild(sep);
    state.lists.forEach(function (list) {
      var b = document.createElement("button");
      b.className = "tab" + (!cvNow && list.id === activeList().id ? " active" : "");
      b.setAttribute("role", "tab");
      b.dataset.listId = list.id;
      b.type = "button";

      if (isShared(list.id)) {
        var hi = document.createElement("span");
        hi.className = "t-hh";
        hi.title = t("tab.shared");
        hi.setAttribute("aria-label", t("tab.shared"));
        hi.innerHTML = HH_SVG;
        b.appendChild(hi);
      }
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
      pen.innerHTML = PEN_SVG;
      pen.addEventListener("click", function (e) {
        e.stopPropagation();
        openListDialog(list.id);
      });
      b.appendChild(pen);

      b.addEventListener("dblclick", function () { openListDialog(list.id); });
      b.addEventListener("click", function () {
        if (Date.now() - tabDragEndTs < 300) return;   // post-drag click
        if (view.activeList === list.id && !view.smart) return;
        setActiveList(list.id);     // TD-8: a view change — nothing to save or sync
        justDone = {};
        endSelection();
        scheduleRender();
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
    if (view.hideCompleted && item.done) return false;
    if (searchQuery && !matchesSearch(item)) return false;
    if (activeFilters.length > 0 && !matchesFilters(item)) return false;
    return true;
  }

  function matchesSearch(item) {
    return Mdl.textMatch(item, searchQuery, function (id) { var l = labelById(id); return l ? l.name : ""; });
  }

  // OR over selected labels — item shows if it carries ANY active label.
  function matchesFilters(item) {
    if (!item.labels || item.labels.length === 0) return false;
    for (var i = 0; i < activeFilters.length; i++) {
      if (item.labels.indexOf(activeFilters[i]) !== -1) return true;
    }
    return false;
  }

  function showEmpty(which) {
    ["empty", "no-match", "filtered", "smart-empty"].forEach(function (id) { $(id).hidden = id !== which; });
  }

  function renderItems() {
    var ul = $("items");
    ul.innerHTML = "";
    var cv = currentView();
    updateControls(cv);

    if (isSearching()) {
      var results = [];
      state.lists.forEach(function (list) {
        list.items.forEach(function (item) {
          if (itemMatchesView(item)) results.push({ list: list, item: item, i: results.length });
        });
      });
      Mdl.sortRows(results, sortMode()).forEach(function (r) {
        ul.appendChild(makeItemRow(r.list, r.item, { source: true }));
      });

      var anyItems = state.lists.some(function (l) { return l.items.length > 0; });
      showEmpty(results.length ? null : (anyItems ? "no-match" : "empty"));
      return;
    }

    if (cv) {
      // TD-14: a smart list / saved filter — tasks of every list
      var rows = smartRows(viewMatcher(cv)).filter(function (r) {
        return !(view.hideCompleted && r.item.done);
      });
      Mdl.sortRows(rows, sortMode()).forEach(function (r) {
        ul.appendChild(makeItemRow(r.list, r.item, { source: true }));
      });
      showEmpty(rows.length ? null : "smart-empty");
      return;
    }

    // Browsing mode — the active list, drag handles on (manual order)
    var list = activeList();
    var visible = list.items.filter(function (item) {
      return !(view.hideCompleted && item.done);
    });
    if (visible.length === 0 && list.items.length > 0) showEmpty("filtered");
    else showEmpty(list.items.length === 0 ? "empty" : null);

    var mode = sortMode();
    var lrows = visible.map(function (item, i) { return { list: list, item: item, i: i }; });
    Mdl.sortRows(lrows, mode).forEach(function (r) {
      ul.appendChild(makeItemRow(list, r.item, { handle: mode === "manual" }));
    });
  }

  // Which controls make sense in this view.
  var shareApi = null;
  try { shareApi = window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; } catch (e) {}
  function updateControls(cv) {
    $("clear-completed").hidden = !!cv;
    $("list-share").hidden = !!cv || !shareApi;
    $("list-settings").hidden = !!(cv && cv.smart);
    var ls = $("list-settings");
    var key = cv && cv.filter ? "flt.edit" : "list.settings";
    if (ls.getAttribute("data-i18n-title") !== key) {
      ls.setAttribute("data-i18n-title", key);
      ls.title = t(key);
      ls.setAttribute("aria-label", t(key));
    }
    var sb = $("sort-btn");
    if (sb) sb.classList.toggle("has-filters", sortMode() !== (cv ? "due" : "manual"));
  }

  // The tick: the checkbox and "Done" from the Today summary
  // (openSearchTarget { done }) run this one function.
  function setDone(item, done) {
    item.done = !!done;
    touchField(item, "done");               // TD-3: the tick only
    if (item.done && currentView()) justDone[item.id] = 1;
    if (item.done && recycleItem(item)) touchField(item, "due");   // recurring → reopens, new date
    save(); scheduleRender();
  }

  var FLAG_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 22V4" fill="none"/><path d="M4 4h13l-2 4 2 4H4z"/></svg>';
  var SUBS_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/></svg>';
  var expanded = {};            // session only: tasks whose subtasks are shown on the row

  // Shared row builder (both view modes render identical rows —
  // the ONLY difference is the drag handle vs the source chip).
  function makeItemRow(list, item, opts) {
    var li = document.createElement("li");
    var prio = Mdl.prioOf(item);
    li.className = "item" + (item.done ? " done" : "") + (prio < 4 ? " p" + prio : "") +
      (selected[item.id] ? " selected" : "");
    li.dataset.id = item.id;
    li.dataset.list = list.id;

    // checkbox (its colour carries the priority)
    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.checked = item.done;
    check.setAttribute("aria-label", item.text + (prio < 4 ? " · P" + prio : ""));
    check.addEventListener("change", function () { setDone(item, check.checked); });
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

    // meta row: priority + due chip + subtasks + repeat + source list chip
    var sc = Mdl.subCount(item);
    var by = hhByOf(list, item);
    var hasMeta = item.due || item.recurrence || opts.source || prio < 4 || sc.total || by;
    if (hasMeta) {
      var meta = document.createElement("div");
      meta.className = "meta";
      if (prio < 4) {
        var pf = document.createElement("span");
        pf.className = "chip-prio p" + prio;
        pf.innerHTML = FLAG_SVG;
        pf.appendChild(document.createTextNode("P" + prio));
        meta.appendChild(pf);
      }
      if (item.due) {
        var chip = document.createElement("span");
        chip.className = "chip-due" + dueClass(item.due);
        chip.textContent = fmtDue(item.due);
        meta.appendChild(chip);
      }
      if (sc.total) {
        var sb = document.createElement("button");
        sb.type = "button";
        sb.className = "chip-subs" + (expanded[item.id] ? " open" : "") + (sc.done === sc.total ? " all" : "");
        sb.setAttribute("aria-expanded", expanded[item.id] ? "true" : "false");
        sb.title = t("subs.toggle");
        sb.setAttribute("aria-label", t("subs.toggle") + " " + sc.done + "/" + sc.total);
        sb.innerHTML = SUBS_SVG;
        sb.appendChild(document.createTextNode(sc.done + "/" + sc.total));
        sb.addEventListener("click", function (e) {
          e.stopPropagation();
          if (expanded[item.id]) delete expanded[item.id]; else expanded[item.id] = 1;
          scheduleRender();
        });
        meta.appendChild(sb);
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
      if (by) {
        var who = document.createElement("span");
        who.className = "chip-by";
        who.style.background = by.color;
        who.textContent = by.initials;
        who.title = t("hh.by").replace("{name}", by.name);
        who.setAttribute("aria-label", who.title);
        meta.appendChild(who);
      }
      body.appendChild(meta);
    }

    // the checklist, ticked right on the row when expanded
    if (sc.total && expanded[item.id]) {
      var sul = document.createElement("ul");
      sul.className = "row-subs";
      item.subs.forEach(function (sub) {
        var sli = document.createElement("li");
        if (sub.done) sli.className = "done";
        var lab = document.createElement("label");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!sub.done;
        cb.addEventListener("change", function () { setSubDone(list.id, item.id, sub.id, cb.checked); });
        var tx = document.createElement("span");
        tx.textContent = sub.text;
        lab.appendChild(cb);
        lab.appendChild(tx);
        sli.appendChild(lab);
        sul.appendChild(sli);
      });
      sul.addEventListener("click", function (e) { e.stopPropagation(); });
      body.appendChild(sul);
    }

    body.addEventListener("click", function () {
      if (Date.now() - longPressTs < 600) return;      // the click after a long press
      openItemDialog(list.id, item.id);
    });
    li.appendChild(body);

    // drag handle (browsing mode, manual order only)
    if (opts.handle) li.appendChild(makeDragHandle(list, item));

    attachRowMenu(li, list, item);
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
    if (rec.after === true) return s + " · " + t("recur.after.short");
    if (rec.unit === "week" && typeof rec.weekday === "number") {
      s += " · " + t("wd." + rec.weekday);
    }
    return s;
  }

  // ---------- 6. Quick-add with natural date parsing ----------
  function parseQuickAdd(raw) {
    var tokens = raw.trim().split(/\s+/);
    var due = null;
    var weekdayHit = null;
    var prio = 0;

    var kept = tokens.filter(function (tok) {
      var n = normalize(tok);
      var pm = /^[pP]([1-4])$/.exec(tok);          // "p1"…"p4", as in Todoist
      if (pm) { prio = +pm[1]; return false; }
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

    return { text: kept.join(" ").trim(), due: due, prio: prio };
  }

  function quickAdd() {
    var input = $("quick-add");
    var raw = input.value;
    if (!raw.trim()) return;

    var parsed = parseQuickAdd(raw);
    if (!parsed.text) return;                    // only date words typed

    var list = activeList();
    var item = freshItem(parsed.text, parsed.due);
    // TD-14: in a smart list or saved filter the task goes to the last
    // list that was open, with what makes it show up in that view.
    var cv = currentView();
    if (cv && cv.smart && (cv.smart === "today" || cv.smart === "week") && !item.due) item.due = todayISO();
    if (cv && cv.smart === "p1" && !parsed.prio) parsed.prio = 1;
    if (cv && cv.filter) {
      var f = cv.filter;
      item.labels = f.labels.filter(function (id) { return !!labelById(id); });
      if (!parsed.prio && f.prios.length === 1) parsed.prio = f.prios[0];
      if (!item.due && (f.due === "today" || f.due === "week" || f.due === "month")) item.due = todayISO();
      if (!item.due && f.due === "range" && f.from) item.due = f.from < todayISO() && (!f.to || f.to >= todayISO()) ? todayISO() : f.from;
    }
    if (parsed.prio && parsed.prio < 4) { item.prio = parsed.prio; item.xf = { prio: item.mtime }; }
    list.items.unshift(item);
    list.items.forEach(function (it, i) { it.pos = i; });   // keep pos honest
    list.om = Date.now();          // top-insert is an ORDERING decision:
                                   // stamp it so this layout is the merge
                                   // reference (v0.4 — same contract as drag)

    input.value = "";
    // TD4: adding while a search/filter was active used to HIDE the
    // new task (it didn't match the view) — felt like a silent
    // failure. Adding is an explicit "show me this" action: clear
    // the session-only view state (never synced) so the task is
    // immediately visible.
    searchQuery = "";
    activeFilters = [];
    var si = $("search");
    if (si) si.value = "";
    var sc = $("search-clear");
    if (sc) sc.hidden = true;
    updateFilterBtn();
    save(); scheduleRender();
    if (cv) showToast(t("toast.addedTo").replace("{list}", list.name), false);
  }

  var shownTab = null;
  function renderAll() {
    renderTabs();
    renderItems();
    // the open view's tab in sight (the bar scrolls on a phone), once per change
    var key = view.smart || ("l:" + activeList().id);
    if (key !== shownTab) {
      shownTab = key;
      var at = document.querySelector("#tabs .tab.active");
      if (at && at.scrollIntoView) { try { at.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
    }
    // Settings → UI: the checkbox must mirror state on EVERY render
    // (sync pull, undo), not only on user clicks. Fixes the "toggle
    // desync" where the checkbox showed stale state after a merge.
    var hc = $("hide-completed");
    if (hc && hc.checked !== !!view.hideCompleted) hc.checked = !!view.hideCompleted;
  }

  // ---------- 7. Item detail dialog ----------
  var editingListId = null;
  var editingItemId = null;
  var pickedSwatch = FALLBACK_COLOR;
  // TD-2: what the dialog showed when it opened, field by field. On
  // close only the fields the USER changed are written back.
  var openValues = null;
  // Extra-info rows are edited on a dialog-local copy and committed
  // at close: the rows used to write straight into the task object,
  // which a sync pull may replace while the dialog is open.
  var dlgInfo = [];

  function editingItem() {
    if (editingItemId === null) return null;
    var it = itemById(listById(editingListId), editingItemId);
    if (it) return it;
    var hit = findItem(editingItemId);      // moved by a sync while the window was open
    return hit ? hit.item : null;
  }

  function populateWeekdaySelects() {
    [$("f-weekday"), $("l-weekday")].forEach(function (sel) {
      sel.innerHTML = "";
      WEEKDAY_KEYS.en.forEach(function (name, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = t("wd." + idx);
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
    dlgPrio = Mdl.prioOf(item);
    renderPrioSeg();
    fillListSelect($("f-list"), listId);
    renderSubEditor();
    $("f-sub-new").value = "";

    renderItemLabels(item);
    dlgInfo = (item.info || []).map(function (f) {
      return { id: f.id || uid(), label: f.label || "", value: f.value || "" };
    });
    renderInfoRows();
    $("f-lbl-picker").hidden = true;

    var hasRec = !!item.recurrence;
    setRadio("f-rec", hasRec ? "on" : "none");
    $("rec-editor").style.display = hasRec ? "flex" : "none";
    if (hasRec) fillRecFields("f-", item.recurrence);
    else { $("f-rec-mode").value = "fixed"; $("f-weekday").hidden = false; }

    if ($("f-dav-ro")) $("f-dav-ro").hidden = !tdRo[itemId];
    openValues = readItemDialog();
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
    var mode = $(prefix + "rec-mode");
    if (mode) {
      mode.value = rec.after === true ? "after" : "fixed";
      $(prefix + "weekday").hidden = rec.after === true;
    }
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
    var mode = $(prefix + "rec-mode");
    var after = !!(mode && mode.value === "after");
    var rec = {
      every:   Math.max(1, parseInt($(prefix + "every").value, 10) || 1),
      unit:    unit,
      weekday: unit === "week" && !after ? parseInt($(prefix + "weekday").value, 10) : null
    };
    if (after) rec.after = true;      // TD-14: absent on a fixed repeat (previous shape)
    return rec;
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
        var cur = editingItem() || item;       // the state may have been replaced by a pull
        cur.labels = (cur.labels || []).filter(function (id) { return id !== lid; });
        touchField(cur, "labels");
        save(); scheduleRender();
        renderItemLabels(cur);
        if (!$("f-lbl-picker").hidden) renderLblPicker();
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
        touchField(it, "labels");
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

    var label = {
      id: uid(), name: name, color: pickedSwatch,
      mtime: Date.now(), om: 0, pos: state.labels.length
    };
    state.labels.push(label);

    var item = editingItem();
    if (item) { item.labels.push(label.id); touchField(item, "labels"); }

    pickedSwatch = FALLBACK_COLOR;
    input.value = "";

    save(); scheduleRender();
    if (item) renderItemLabels(item);
    renderLblPicker();
    input.focus();
    showToast(t("toast.labeladd"), false);
  }

  // --- Extra info rows inside the item dialog (free key-value) ---
  function renderInfoRows() {
    var host = $("f-info-list");
    host.innerHTML = "";
    dlgInfo.forEach(function (f) {
      host.appendChild(makeInfoRow(f));
    });
  }

  function makeInfoRow(f) {
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
    x.setAttribute("aria-label", t("item.info.remove"));
    x.title = t("item.info.remove");
    x.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", function () {
      // Committed with the rest of the dialog when it closes.
      dlgInfo = dlgInfo.filter(function (r) { return r !== f; });
      renderInfoRows();
    });
    row.appendChild(x);
    return row;
  }

  function addInfoRow() {
    if (!editingItem()) return;
    dlgInfo.push({ id: uid(), label: "", value: "" });
    // A blank row is not a change yet: the close-flush commits filled
    // rows and silently drops blank ones.
    renderInfoRows();
    var rows = $("f-info-list").querySelectorAll(".info-row");
    if (rows.length > 0) {
      var l = rows[rows.length - 1].querySelector("input");
      if (l) l.focus();
    }
  }

  // What the dialog holds right now, in comparable form.
  function readItemDialog() {
    var info = dlgInfo.filter(function (f) {
      return (f.label || "").trim() || (f.value || "").trim();
    }).map(function (f) { return { id: f.id, label: f.label || "", value: f.value || "" }; });
    return {
      text:  $("f-text").value.trim(),
      due:   $("f-due").value || null,
      notes: $("f-notes").value,
      prio:  dlgPrio,
      list:  $("f-list").value,
      rec:   readRecFromFields("f-"),
      info:  info,
      infoKey: JSON.stringify(info.map(function (f) { return [f.label, f.value]; }))
    };
  }

  // TD-2 — commit the dialog: ONLY what the user changed since it
  // opened. The old close handler copied every field of the dialog
  // back into the task before it even checked for changes — when the
  // task had been updated by a sync in the meantime, an untouched
  // dialog (Esc) put the old text, date and notes back in memory, and
  // the next save of anything wrote them out.
  function commitItemDialog() {
    if (editingListId === null || editingItemId === null) return;
    flushSubInputs();
    var item = editingItem();
    var was = openValues;
    var fromHit = editingItemId !== null ? findItem(editingItemId) : null;
    var fromList = fromHit ? fromHit.list : null;
    editingListId = null;
    editingItemId = null;
    openValues = null;
    if (!item || !was) return;
    var now = readItemDialog(), changed = false;
    if (now.prio !== was.prio) {
      if (now.prio < 4) item.prio = now.prio; else delete item.prio;
      touchXf(item, "prio");
      changed = true;
    }
    if (now.text && now.text !== was.text) { item.text = now.text; touchField(item, "text"); changed = true; }
    if (now.due !== was.due) { item.due = now.due; touchField(item, "due"); changed = true; }
    if (now.notes !== was.notes) { item.notes = now.notes; touchField(item, "notes"); changed = true; }
    if (JSON.stringify(now.rec) !== JSON.stringify(was.rec)) {
      item.recurrence = now.rec; touchField(item, "recurrence"); changed = true;
    }
    if (now.infoKey !== was.infoKey) { item.info = now.info; touchField(item, "info"); changed = true; }
    if (now.list !== was.list && listById(now.list) && fromList && fromList.id !== now.list) {
      moveItems([{ item: item, from: fromList }], listById(now.list));   // saves, toast with Undo
      return;
    }
    if (!changed) return;                 // pristine close: no stamp, no save, no push
    save(); scheduleRender();
  }

  // Flush typed-but-unsaved text when the item dialog closes by ANY
  // path (Save button, Esc) — nothing is ever lost. Structural label/
  // info changes are saved at the moment of the click, Kanban-style.
  // Every flush stamps the item: dialog edits are real mutations.
  $("dlg-item").addEventListener("close", commitItemDialog);

  // TD-5: the "close" event never fires when the APP is closed with
  // the dialog still open (the shell replaces the frame) — notes
  // typed in it were simply gone. Commit on the way out too.
  function commitOpenDialogs() {
    try {
      if ($("dlg-item").open) commitItemDialog();
      if ($("dlg-list").open && editingListId !== null) saveListDialog();
    } catch (e) {}
  }
  window.addEventListener("pagehide", commitOpenDialogs);
  window.addEventListener("beforeunload", commitOpenDialogs);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") commitOpenDialogs();
  });

// v0.4b — the list dialog commits on ANY close path (Save, Esc,
  // backdrop), same contract as the item dialog. Nothing typed is
  // ever silently dropped. The submit handler nulls editingListId
  // first, so this handler is a no-op on the Save path (no double
  // commit), and the delete path nulls it before close() as well.
  $("dlg-list").addEventListener("close", function () {
    if (editingListId === null) return;
    saveListDialog();
  });

  // ---------- 7b. Priority, list, subtasks in the item dialog (TD-14) ----------
  var dlgPrio = 4;
  var PRIOS = [1, 2, 3, 4];
  function prioName(p) { return p < 4 ? "P" + p : t("prio.none"); }
  function renderPrioSeg() {
    var host = $("f-prio");
    host.innerHTML = "";
    PRIOS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "prio-btn p" + p + (dlgPrio === p ? " sel" : "");
      b.setAttribute("aria-pressed", dlgPrio === p ? "true" : "false");
      b.title = t("prio." + p);
      b.innerHTML = FLAG_SVG;
      b.appendChild(document.createTextNode("P" + p));
      b.addEventListener("click", function () { dlgPrio = p; renderPrioSeg(); });
      host.appendChild(b);
    });
  }
  function fillListSelect(sel, current) {
    sel.innerHTML = "";
    state.lists.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name || t("new.list");
      sel.appendChild(o);
    });
    sel.value = current;
  }

  // Subtasks are saved the moment they change (like labels): each one
  // carries its own mtime, a removed one is tombstoned, so two devices
  // ticking different steps of one task both keep their ticks.
  function findSub(it, subId) {
    var subs = (it && it.subs) || [];
    for (var i = 0; i < subs.length; i++) if (subs[i].id === subId) return subs[i];
    return null;
  }
  function itemAnywhere(listId, itemId) {
    var it = itemById(listById(listId), itemId);
    if (it) return it;
    var hit = findItem(itemId);
    return hit ? hit.item : null;
  }
  function setSubDone(listId, itemId, subId, done) {
    var it = itemAnywhere(listId, itemId), sub = findSub(it, subId);
    if (!sub || sub.done === !!done) return;
    var now = Date.now();
    sub.done = !!done;
    sub.mtime = now;
    touchXf(it, "subs", now);
    save(); scheduleRender();
  }
  function renderSubEditor() {
    var host = $("f-subs"), it = editingItem();
    host.innerHTML = "";
    var subs = (it && it.subs) || [];
    subs.forEach(function (sub, idx) {
      var row = document.createElement("div");
      row.className = "sub-row" + (sub.done ? " done" : "");
      row.dataset.sub = sub.id;
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!sub.done;
      cb.setAttribute("aria-label", sub.text);
      cb.addEventListener("change", function () {
        setSubDone(editingListId, editingItemId, sub.id, cb.checked);
        row.classList.toggle("done", cb.checked);
      });
      row.appendChild(cb);
      var tx = document.createElement("input");
      tx.type = "text";
      tx.className = "sub-text";
      tx.value = sub.text;
      tx.maxLength = Mdl.SUB_TEXT;
      tx.setAttribute("aria-label", t("subs.title"));
      tx.addEventListener("change", function () { commitSubText(sub.id, tx.value); });
      tx.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); tx.blur(); $("f-sub-new").focus(); }
      });
      row.appendChild(tx);
      [["up", -1, "M6 15l6-6 6 6"], ["down", 1, "M6 9l6 6 6-6"]].forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "row-x sub-mv";
        b.title = t("subs." + d[0]);
        b.setAttribute("aria-label", t("subs." + d[0]));
        b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="' + d[2] + '"/></svg>';
        b.disabled = (d[1] < 0 && idx === 0) || (d[1] > 0 && idx === subs.length - 1);
        b.addEventListener("click", function () { moveSub(sub.id, d[1]); });
        row.appendChild(b);
      });
      var x = document.createElement("button");
      x.type = "button";
      x.className = "row-x";
      x.title = t("subs.remove");
      x.setAttribute("aria-label", t("subs.remove"));
      x.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener("click", function () { removeSub(sub.id); });
      row.appendChild(x);
      host.appendChild(row);
    });
    $("f-sub-add").disabled = subs.length >= Mdl.SUB_MAX;
  }
  function commitSubText(subId, text) {
    var it = editingItem(), sub = findSub(it, subId);
    text = String(text || "").replace(/\s+/g, " ").trim().slice(0, Mdl.SUB_TEXT);
    if (!sub || !text || text === sub.text) return;
    var now = Date.now();
    sub.text = text;
    sub.mtime = now;
    touchXf(it, "subs", now);
    save(); scheduleRender();
  }
  // Typed-but-not-blurred subtask text, when the dialog closes any way.
  function flushSubInputs() {
    var rows = $("f-subs").querySelectorAll(".sub-row");
    for (var i = 0; i < rows.length; i++) {
      var tx = rows[i].querySelector(".sub-text");
      if (tx) commitSubText(rows[i].dataset.sub, tx.value);
    }
    if ($("f-sub-new").value.trim()) addSub();
  }
  function addSub() {
    var it = editingItem(), input = $("f-sub-new");
    var text = input.value.replace(/\s+/g, " ").trim().slice(0, Mdl.SUB_TEXT);
    if (!it || !text) return;
    if ((it.subs || []).length >= Mdl.SUB_MAX) return;
    var now = Date.now();
    it.subs = (it.subs || []).concat([{ id: uid(), text: text, done: false, mtime: now }]);
    touchXf(it, "subs", now);
    input.value = "";
    expanded[it.id] = 1;
    save(); scheduleRender();
    renderSubEditor();
  }
  function moveSub(subId, delta) {
    var it = editingItem();
    if (!it || !it.subs) return;
    var i = -1;
    it.subs.forEach(function (s, k) { if (s.id === subId) i = k; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= it.subs.length) return;
    var subs = it.subs.slice(), tmp = subs[i];
    subs[i] = subs[j]; subs[j] = tmp;
    it.subs = subs;
    touchXf(it, "so");
    save(); scheduleRender();
    renderSubEditor();
    var btn = $("f-subs").querySelector('.sub-row[data-sub="' + subId + '"] .sub-mv:not([disabled])');
    if (btn) btn.focus();
  }
  function removeSub(subId) {
    var it = editingItem();
    if (!it || !it.subs) return;
    var now = Date.now();
    tombstone(subId);
    it.subs = it.subs.filter(function (s) { return s.id !== subId; });
    if (!it.subs.length) delete it.subs;
    touchXf(it, "subs", now);
    save(); scheduleRender();
    renderSubEditor();
  }

  // ---------- 7c. Move tasks to another list (TD-14) ----------
  // pairs: [{ item, from }]. The task leaves its list and goes to the
  // top of the other one, with its subtasks; xf.list says where it was
  // moved last (Mdl.dedupeMoved). Both lists' order is stamped. Undo
  // moves each back to where it was.
  function moveItems(pairs, to, quiet) {
    var now = Date.now(), back = [], touched = {};
    pairs = pairs.filter(function (p) { return p.from && p.from !== to && p.from.items.indexOf(p.item) >= 0; });
    if (!pairs.length || !to) return;
    pairs.slice().reverse().forEach(function (p) {
      var idx = p.from.items.indexOf(p.item);
      back.unshift({ id: p.item.id, from: p.from.id, idx: idx });
      p.from.items.splice(idx, 1);
      to.items.unshift(p.item);
      touchXf(p.item, "list", now);
      hhMoved(p.item, p.from, to);
      touched[p.from.id] = p.from;
    });
    touched[to.id] = to;
    Object.keys(touched).forEach(function (id) {
      var l = touched[id];
      l.items.forEach(function (it, i) { it.pos = i; });
      l.om = now;
    });
    save(); scheduleRender();
    if (quiet) return;
    undoSnapshot = null;
    undoFn = function () {
      var now2 = Date.now(), tl = {};
      back.slice().reverse().forEach(function (b) {
        var hit = findItem(b.id), home = listById(b.from);
        if (!hit || !home || hit.list === home) return;
        hit.list.items.splice(hit.list.items.indexOf(hit.item), 1);
        home.items.splice(Math.min(b.idx, home.items.length), 0, hit.item);
        touchXf(hit.item, "list", now2);
        hhMoved(hit.item, hit.list, home);
        tl[hit.list.id] = hit.list; tl[home.id] = home;
      });
      Object.keys(tl).forEach(function (id) {
        tl[id].items.forEach(function (it, i) { it.pos = i; });
        tl[id].om = now2;
      });
      save(); renderAll();
      showToast(t("toast.undone"), false);
    };
    undoViewList = view.activeList;
    showToast(pairs.length === 1 ? t("toast.moved").replace("{list}", to.name)
                                 : t("toast.movedN").replace("{n}", pairs.length).replace("{list}", to.name), true);
  }

  // ---------- 7d. Quick menu (right-click / long press) + selection ----------
  var longPressTs = 0;
  var selected = {};            // session only: { itemId: listId }
  function selecting() { return Object.keys(selected).length > 0; }
  function toggleSelected(listId, itemId) {
    if (selected[itemId]) delete selected[itemId]; else selected[itemId] = listId;
    renderSelBar();
    scheduleRender();
  }
  function endSelection() {
    if (!selecting()) return;
    selected = {};
    renderSelBar();
    scheduleRender();
  }
  function selectedPairs() {
    var out = [];
    Object.keys(selected).forEach(function (id) {
      var hit = findItem(id);
      if (hit) out.push({ item: hit.item, from: hit.list });
      else delete selected[id];
    });
    return out;
  }
  function renderSelBar() {
    var bar = $("sel-bar");
    var n = selectedPairs().length;
    bar.hidden = n === 0;
    document.body.classList.toggle("selecting", n > 0);
    if (!n) return;
    $("sel-count").textContent = t("sel.count").replace("{n}", n);
  }
  function setPrio(item, p) {
    if (Mdl.prioOf(item) === p) return false;
    if (p < 4) item.prio = p; else delete item.prio;
    touchXf(item, "prio");
    return true;
  }

  function attachRowMenu(li, list, item) {
    // while selecting, a tap anywhere on the row (but its tick) selects it
    li.addEventListener("click", function (e) {
      if (!selecting() || (e.target.closest && e.target.closest(".check"))) return;
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - longPressTs < 600) return;
      toggleSelected(list.id, item.id);
    }, true);
    li.addEventListener("contextmenu", function (e) {
      if (e.target.closest && e.target.closest("input, .drag-handle")) return;
      e.preventDefault();
      openRowMenu(e.clientX, e.clientY, list, item);
    });
    var timer = null, sx = 0, sy = 0;
    li.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      if (e.target.closest && e.target.closest("input, button, .drag-handle")) return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        longPressTs = Date.now();
        openRowMenu(sx, sy, list, item);
      }, 500);
    });
    var cancel = function () { clearTimeout(timer); timer = null; };
    li.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
    });
    li.addEventListener("pointerup", cancel);
    li.addEventListener("pointercancel", cancel);
  }

  function closeMenu() {
    var m = $("row-menu");
    if (m) m.remove();
  }
  function menuButton(host, text, svg, onClick, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rm-item" + (cls ? " " + cls : "");
    b.setAttribute("role", "menuitem");
    if (svg) { var ic = document.createElement("span"); ic.className = "rm-ico"; ic.innerHTML = svg; b.appendChild(ic); }
    var sp = document.createElement("span");
    sp.textContent = text;
    b.appendChild(sp);
    b.addEventListener("click", onClick);
    host.appendChild(b);
    return b;
  }
  // targets: function → [{ item, from }] the menu acts on (one row, or
  // the selection when opened from the selection bar).
  function openRowMenu(x, y, list, item, targets) {
    closeMenu();
    var get = targets || function () {
      var hit = findItem(item.id);
      return hit ? [{ item: hit.item, from: hit.list }] : [];
    };
    var m = document.createElement("div");
    m.id = "row-menu";
    m.setAttribute("role", "menu");
    var head = document.createElement("div");
    head.className = "rm-prios";
    head.setAttribute("aria-label", t("prio.label"));
    var cur = item ? Mdl.prioOf(item) : 0;
    PRIOS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "prio-btn p" + p + (cur === p ? " sel" : "");
      b.title = t("prio." + p);
      b.setAttribute("aria-label", t("prio." + p));
      b.innerHTML = FLAG_SVG;
      b.appendChild(document.createTextNode("P" + p));
      b.addEventListener("click", function () {
        var any = false;
        get().forEach(function (pr) { if (setPrio(pr.item, p)) any = true; });
        closeMenu();
        if (any) { save(); scheduleRender(); }
      });
      head.appendChild(b);
    });
    m.appendChild(head);
    var body = document.createElement("div");
    body.className = "rm-body";
    m.appendChild(body);
    var MOVE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    function showMain() {
      body.innerHTML = "";
      if (state.lists.length > 1) menuButton(body, t("menu.move"), MOVE_SVG, showLists);
      if (!targets) {
        menuButton(body, t("menu.open"), PEN_SVG, function () { closeMenu(); openItemDialog(list.id, item.id); });
        if (!selected[item.id]) {
          menuButton(body, t("menu.select"), SUBS_SVG, function () { closeMenu(); toggleSelected(list.id, item.id); });
        }
      }
    }
    function showLists() {
      body.innerHTML = "";
      var src = get().map(function (p) { return p.from.id; });
      state.lists.forEach(function (l) {
        var here = src.length > 0 && src.every(function (id) { return id === l.id; });
        var b = menuButton(body, l.name || t("new.list"), null, function () {
          closeMenu();
          moveItems(get(), l);
          endSelection();
        }, here ? "here" : "");
        if (here) b.disabled = true;
      });
      var first = body.querySelector("button:not([disabled])");
      if (first) first.focus();
    }
    showMain();
    document.body.appendChild(m);
    // keep it on screen
    var w = m.offsetWidth, h = m.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    m.style.left = Math.max(8, Math.min(x, vw - w - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, vh - h - 8)) + "px";
    var first = m.querySelector(".rm-body button") || m.querySelector("button");
    if (first) first.focus();
  }
  document.addEventListener("pointerdown", function (e) {
    var m = $("row-menu");
    if (m && !m.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("row-menu")) { closeMenu(); e.stopPropagation(); return; }
    if ($("sort-pop") && !$("sort-pop").hidden) { $("sort-pop").hidden = true; e.stopPropagation(); return; }
    if (selecting() && !document.querySelector("dialog[open]")) { endSelection(); e.stopPropagation(); }
  });
  window.addEventListener("resize", closeMenu);

  // ---------- 7e. Sort (per view, device-local) ----------
  function renderSortPop() {
    var pop = $("sort-pop");
    pop.innerHTML = "";
    var cur = sortMode();
    SORT_MODES.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sort-opt" + (cur === m ? " sel" : "");
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", cur === m ? "true" : "false");
      b.textContent = t("sort." + m);
      b.addEventListener("click", function () {
        setSortMode(m);
        pop.hidden = true;
        scheduleRender();
      });
      pop.appendChild(b);
    });
  }

  // ---------- 7f. Saved filters (synced, TD-14) ----------
  var editingFilterId = null;
  var dlgFlt = null;
  function openFilterDialog(id) {
    var f = id ? filterById(id) : null;
    editingFilterId = f ? f.id : null;
    dlgFlt = f ? JSON.parse(JSON.stringify(f)) : {
      id: "", name: "", labels: activeFilters.slice(), prios: [], due: "", from: "", to: "", text: searchQuery || ""
    };
    $("flt-name").value = dlgFlt.name;
    $("flt-text").value = dlgFlt.text;
    $("flt-due").value = dlgFlt.due;
    $("flt-from").value = dlgFlt.from;
    $("flt-to").value = dlgFlt.to;
    $("flt-range").hidden = dlgFlt.due !== "range";
    $("flt-delete").hidden = !f;
    $("dlg-filter").querySelector("h3").textContent = t(f ? "flt.edit" : "flt.title");
    renderFltChips();
    $("filter-pop").hidden = true;
    $("dlg-filter").showModal();
    setTimeout(function () { $("flt-name").focus(); }, 50);
  }
  function renderFltChips() {
    var host = $("flt-labels");
    host.innerHTML = "";
    if (!state.labels.length) {
      var none = document.createElement("div");
      none.className = "lbl-none";
      none.textContent = t("filter.empty");
      host.appendChild(none);
    }
    state.labels.forEach(function (lb) {
      var on = dlgFlt.labels.indexOf(lb.id) >= 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "flt-chip" + (on ? " sel" : "");
      b.setAttribute("aria-pressed", on ? "true" : "false");
      var dot = document.createElement("span");
      dot.className = "fl-dot";
      dot.style.background = lb.color || FALLBACK_COLOR;
      b.appendChild(dot);
      var nm = document.createElement("span");
      nm.textContent = lb.name;
      b.appendChild(nm);
      b.addEventListener("click", function () {
        var i = dlgFlt.labels.indexOf(lb.id);
        if (i >= 0) dlgFlt.labels.splice(i, 1); else dlgFlt.labels.push(lb.id);
        renderFltChips();
      });
      host.appendChild(b);
    });
    var ph = $("flt-prios");
    ph.innerHTML = "";
    PRIOS.forEach(function (p) {
      var on = dlgFlt.prios.indexOf(p) >= 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "prio-btn p" + p + (on ? " sel" : "");
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = t("prio." + p);
      b.innerHTML = FLAG_SVG;
      b.appendChild(document.createTextNode("P" + p));
      b.addEventListener("click", function () {
        var i = dlgFlt.prios.indexOf(p);
        if (i >= 0) dlgFlt.prios.splice(i, 1); else dlgFlt.prios.push(p);
        renderFltChips();
      });
      ph.appendChild(b);
    });
  }
  function saveFilterDialog() {
    if (!dlgFlt) return;
    var now = Date.now();
    var draft = Mdl.cleanFilter({
      id: editingFilterId || uid(),
      name: $("flt-name").value || t("flt.newname"),
      labels: dlgFlt.labels.filter(function (id) { return !!labelById(id); }),
      prios: dlgFlt.prios,
      due: $("flt-due").value,
      from: $("flt-from").value,
      to: $("flt-to").value,
      text: $("flt-text").value,
      mtime: now,
      pos: 0
    });
    if (!draft.name) draft.name = t("flt.newname");
    var cur = editingFilterId ? filterById(editingFilterId) : null;
    dlgFlt = null;
    if (cur) {
      var same = JSON.stringify([cur.name, cur.labels, cur.prios, cur.due, cur.from, cur.to, cur.text]) ===
                 JSON.stringify([draft.name, draft.labels, draft.prios, draft.due, draft.from, draft.to, draft.text]);
      if (same) return;
      draft.pos = cur.pos;
      state.filters = state.filters.map(function (f) { return f.id === cur.id ? draft : f; });
    } else {
      if (!state.filters) state.filters = [];
      draft.pos = state.filters.length;
      state.filters.push(draft);
      state.fom = now;
      setSmart("f:" + draft.id);
      // the search and label filter it was made from are now the view
      searchQuery = ""; activeFilters = [];
      $("search").value = ""; $("search-clear").hidden = true;
      updateFilterBtn();
    }
    save(); renderAll();
  }
  function deleteFilter(id) {
    pushUndo("toast.fltdel");
    state.filters = (state.filters || []).filter(function (f) { return f.id !== id; });
    state.filters.forEach(function (f, i) { f.pos = i; });
    state.fom = Date.now();
    tombstone(id);
    if (!state.filters.length) { delete state.filters; delete state.fom; }
    if (view.smart === "f:" + id) setSmart(null);
    save(); renderAll();
  }

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
    hhFillDialog(list);
    tdFillDialog();

    $("dlg-list").showModal();
    setTimeout(function () { $("l-name").focus(); }, 50);
  }

  function updateNextResetLabel(list) {
    var el = $("l-next-reset");
    if (list.recurrence && list.nextReset) {
      var d = isoToDate(list.nextReset);
      el.textContent = t("recur.list.next") + " " +
        d.toLocaleDateString(loc(),
                             { day: "numeric", month: "short", year: "numeric" });
    } else {
      el.textContent = "";
    }
  }

  // The household part of the list dialog: share a list of one's own,
  // or see where a shared one lives and stop sharing it.
  function hhFillDialog(list) {
    var h = hhApi(), box = $("l-hh");
    if (!box) return;
    box.hidden = !h;
    if (!h) return;
    var shared = isShared(list.id), hhs = h.list();
    $("l-hh-on").hidden = !shared;
    $("l-hh-off").hidden = shared || !hhs.length;
    $("l-hh-none").hidden = shared || hhs.length > 0;
    if (shared) {
      var inf = hhInfo[list.id];
      $("l-hh-in").textContent = t("hh.sharedIn").replace("{hh}", inf ? inf.hh : "");
      return;
    }
    var sel = $("l-hh-box");
    sel.textContent = "";
    hhs.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.box;
      o.textContent = x.name || "?";
      sel.appendChild(o);
    });
    $("l-hh-go").disabled = false;
  }
  function hhShare() {
    var h = hhApi(), list = listById(editingListId);
    if (!h || !list || isShared(list.id)) return;
    saveListDialog();                    // a new name or cycle goes along
    editingListId = list.id;
    var box = $("l-hh-box").value, hh = (h.list().filter(function (x) { return x.box === box; })[0] || {}).name || "";
    var proj = HHo.project(list);
    $("l-hh-go").disabled = true;
    Promise.resolve(h.share(box, "todo", list.name, { set: proj.items, m: { rec: proj.m.rec, last: proj.m.last, next: proj.m.next } })).then(function (id) {
      // the list leaves the person's own lists on every device of theirs
      if (listById(list.id)) {
        tombstone(list.id);
        list.items.forEach(function (it) { tombstone(it.id); });
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; });
        keepOneList();
        state.om = Date.now();
      }
      undoSnapshot = null; undoFn = null;
      hhInject();
      if (listById(HHo.PREFIX + id)) setActiveList(HHo.PREFIX + id);
      editingListId = null;
      $("dlg-list").close();
      save(); renderAll();
      showToast(t("toast.hhShared").replace("{hh}", hh), false);
    }, function () {
      $("l-hh-go").disabled = false;
      showToast(t("toast.hhFail"), false);
    });
  }
  function hhStop(list, drop) {
    var h = hhApi(), inf = hhInfo[list.id];
    if (!h || !inf) return;
    if (drop) hhNoCopy[inf.id] = 1;
    editingListId = null;
    $("dlg-list").close();
    undoSnapshot = null; undoFn = null;
    Promise.resolve(h.unshare(inf.box, inf.id)).then(function () {
      hhInject();
      save(); renderAll();
      if (!drop && listById(HHo.COPY + inf.id)) setActiveList(HHo.COPY + inf.id);
      renderAll();
      showToast(t(drop ? "toast.hhDel" : "toast.hhStopped"), false);
    }, function () { showToast(t("toast.hhFail"), false); });
  }
  function hhDelete(list) { confirmDialog("confirm.hhdel", function () { hhStop(list, true); }); }

  function createList() {
    var list = freshList(t("new.list"));
    list.pos = state.lists.length;
    state.lists.push(list);
    setActiveList(list.id);
    state.om = Date.now();          // new order version
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
  // decorate the DOM; the array is touched once, on drop. A drop
  // stamps the LIST's ordering version (om) — positions are the
  // ordering concern, item content mtimes stay untouched.
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
      list.items.forEach(function (it, i) { it.pos = i; });
      list.om = Date.now();          // this side owns the item order now

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
  var TAB_DRAG_THRESHOLD = 8;
  var tabDragEndTs = 0;   // suppresses the trailing click after a drop

  function attachTabDrag(tabEl, list) {
    tabEl.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest(".t-rename")) return;
      if (document.querySelector("dialog[open]")) return;
      if (state.lists.length < 2) return;        // nothing to reorder
      if (isShared(list.id)) return;             // shared lists keep their place at the end

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

      function findTarget(x) {
        var tabs = [].slice.call(document.querySelectorAll("#tabs .tab[data-list-id]"));
        var target = null, bestDist = Infinity;
        tabs.forEach(function (tb) {
          if (tb === tabEl) return;
          var r = tb.getBoundingClientRect();
          var cx = r.left + r.width / 2;
          var dist = Math.abs(x - cx);
          if (dist < bestDist) { bestDist = dist; target = tb; }
        });
        return target;
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

        var target = findTarget(ev.clientX);
        if (!target) return;
        var r = target.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) target.classList.add("drag-over-left");
        else                                   target.classList.add("drag-over-right");
      }

      function finish(ev) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);

        var target = findTarget(ev.clientX);

        tabEl.classList.remove("drag-src");
        document.body.classList.remove("is-dragging-tab");
        clearMarks();

        if (started && target && target.dataset.listId) {
          var r = target.getBoundingClientRect();
          var before = ev.clientX < r.left + r.width / 2;
          moveListById(list, target.dataset.listId, before);
        }
        if (started) {
          tabDragEndTs = Date.now();   // swallow the synthetic click
          save(); scheduleRender();
        }
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

    // This side owns the LIST order now — fresh ordering version
    state.om = Date.now();
    state.lists.forEach(function (l, i) { l.pos = i; });
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
    var nf = document.createElement("button");
    nf.type = "button";
    nf.className = "fl-new";
    nf.innerHTML = SMART_SVG.filter;
    var nfs = document.createElement("span");
    nfs.textContent = t("filter.save");
    nf.appendChild(nfs);
    nf.addEventListener("click", function (e) { e.stopPropagation(); openFilterDialog(null); });
    pop.appendChild(nf);

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
        confirmDialog("confirm.lbldel", function () {
          deleteLabel(label.id);
        });
      });
      item.appendChild(del);

      pop.appendChild(item);
    });
  }

  // Deleting a label detaches it everywhere and clears it from active
  // filters → no orphan ids, no ghost filter entries. Soft-deleted via
  // tombstone: the OTHER device merges the deletion instead of
  // resurrecting the label from its stale local copy.
  function deleteLabel(labelId) {
    pushUndo("toast.labeldel");   // audit #18: the ONLY destructive op without undo — now consistent
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        var next = (item.labels || []).filter(function (id) { return id !== labelId; });
        // audit #18: detach MUST stamp the item's content version —
        // otherwise remote copies (older mtime, stale label id) can
        // win the JSON tie-break lottery and resurrect dead refs.
        if (next.length !== (item.labels || []).length) {
          item.labels = next;
          touchField(item, "labels");
        }
      });
    });
    tombstone(labelId);      // merge-safe deletion
    activeFilters = activeFilters.filter(function (id) { return id !== labelId; });

    updateFilterBtn();
    save(); scheduleRender();
    if (!$("filter-pop").hidden) renderFilterPop();
    var item = editingItem();
    if (item) renderItemLabels(item);
    // toast now comes from pushUndo() — with Undo button
  }

  // ---------- 11. Undo / toast ----------
  var undoSnapshot = null;
  var toastTimer = null;

  var undoFreshListId = null;   // the empty list created when the LAST list was deleted
  var undoViewList = null;      // the tab that was open when the action happened
  var undoFn = null;            // an action with its own way back (an import)
  function pushUndo(key) {
    undoFn = null;
    undoSnapshot = JSON.stringify(state);
    undoFreshListId = null;
    undoViewList = view.activeList;
    showToast(t(key), true);
  }

  // TD-1 — UNDO PUTS BACK WHAT THE ACTION REMOVED, NOTHING ELSE.
  // It used to restore the whole database as it was before the
  // action and stamp EVERY list, task and label "newest" (stampAll):
  // undoing one deletion then overrode every edit made on another
  // device that had not synced yet — and anything a pull had brought
  // in during the five seconds of the toast.
  function doUndo() {
    if (undoFn) { var fn = undoFn; undoFn = null; undoSnapshot = null; fn(); return; }
    if (!undoSnapshot) return;
    var snap = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    var now = Date.now(), listBack = false;

    // labels that are gone → back, and back onto the tasks that had them
    var labelsBack = {};
    (snap.labels || []).forEach(function (lb, i) {
      if (labelById(lb.id)) return;
      lb.mtime = now;
      state.labels.splice(Math.min(i, state.labels.length), 0, lb);
      delete state.deleted[lb.id];
      labelsBack[lb.id] = true;
    });
    if (Object.keys(labelsBack).length) state.labels.forEach(function (lb, i) { lb.pos = i; });

    (snap.filters || []).forEach(function (f, i) {
      if (filterById(f.id)) return;
      f.mtime = now;
      if (!state.filters) state.filters = [];
      state.filters.splice(Math.min(i, state.filters.length), 0, f);
      state.filters.forEach(function (x, k) { x.pos = k; });
      state.fom = now;
      delete state.deleted[f.id];
    });

    (snap.lists || []).forEach(function (sl, li) {
      var cur = listById(sl.id);
      if (!cur) {                                  // a deleted list → back, with its tasks
        stampListNewest(sl, now);
        sl.om = now;
        (sl.items || []).forEach(function (it) { stampItemNewest(it, now); delete state.deleted[it.id]; });
        state.lists.splice(Math.min(li, state.lists.length), 0, sl);
        delete state.deleted[sl.id];
        listBack = true;
        return;
      }
      var itemsBack = false;
      (sl.items || []).forEach(function (si, ii) {
        var ci = itemById(cur, si.id);
        if (!ci) {                                 // a deleted task → back, at its place
          stampItemNewest(si, now);
          cur.items.splice(Math.min(ii, cur.items.length), 0, si);
          delete state.deleted[si.id];
          itemsBack = true;
          return;
        }
        var add = (si.labels || []).filter(function (id) {
          return labelsBack[id] && (ci.labels || []).indexOf(id) === -1;
        });
        if (add.length) { ci.labels = (ci.labels || []).concat(add); touchField(ci, "labels"); }
      });
      if (itemsBack) {
        cur.items.forEach(function (it, i) { it.pos = i; });
        cur.om = now;                              // this layout is the ordering reference
      }
    });

    if (listBack) {
      if (undoFreshListId) {                       // the stand-in list is no longer needed
        var fl = listById(undoFreshListId);
        if (fl && fl.items.length === 0) {
          state.lists = state.lists.filter(function (l) { return l.id !== undoFreshListId; });
          tombstone(undoFreshListId);
        }
      }
      state.lists.forEach(function (l, i) { l.pos = i; });
      state.om = now;
      if (undoViewList && listById(undoViewList)) setActiveList(undoViewList);
    }
    undoFreshListId = null;
    save(); renderAll();
    showToast(t("toast.undone"), false);
  }

  // R12: only a toast that carries Undo stays in the app. Every plain
  // message goes to the shell's unified notifications; the local
  // toast is the fallback when the app runs standalone.
  function showToast(text, withUndo) {
    if (!withUndo) {
      try {
        var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
        if (N && typeof N.transient === "function") {
          N.transient({ ns: "todo", title: text, body: "" });
          return;
        }
      } catch (e) { /* cross-origin guard */ }
    }
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
    // R12: an Undo offer stays at least 8 seconds; plain notes 4.
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, withUndo ? 8000 : 4000);
  }
  
    // ---------- 11b. Themed confirm (R14) ----------
  // Native confirm() is RETIRED (Bible R14): a themed <dialog> built
  // from the app palette. Esc/backdrop/click-outside = cancel;
  // focus starts on CANCEL so Enter never fires the destructive act.
  function confirmDialog(msgKey, onYes) {
    var stale = document.getElementById("todo-confirm");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "todo-confirm";
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
    yes.textContent = t("item.delete");
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

  // ---------- 12. Sync slice (merge-registered) + palette ----------
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
    // v0.4: 5th argument — the merge function. With it, a pull never
    // wholesale-overwrites local state; local and remote converge.
    api.registerSlice("todo", sliceGet, sliceSet, "oros-todo-data", mergeTodoStates);
  }

  // Debug / test handle (read-only use).
  window.__todoDebug = {
    merge: mergeTodoStates,
    canon: canonState,
    state: function () { return state; }
  };

  function sliceGet() {
    // Canonical copy (TD-4): what the merge would return for this state.
    return canonState(personal(state));
  }

  // data  — merged result (or plain remote on legacy LWW paths)
  // info  — { merged: true } when the value came through mergeTodoStates
  //         (sync.js contract); anything else = wholesale apply.
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.lists) || data.lists.length === 0) return;
    // Echo: nothing new → no rewrite, no re-render.
    if (JSON.stringify(canonState(data)) === JSON.stringify(canonState(personal(state)))) return;
    var shared = state.lists.filter(function (l) { return isShared(l.id); });
    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      pruneTombstones(state);
      lastSaved = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, lastSaved);
      state.lists = state.lists.concat(shared);
      applyListCycles();               // may fast-forward missed cycles
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // activeList must point at something that exists
    var ok = state.lists.some(function (l) { return l.id === state.activeList; });
    if (!ok) state.activeList = state.lists[0].id;
    scheduleRender();
    tdKick();                          // a change from another device goes to the server too
    // (No toast per merge: it fired on every sync cycle that brought
    // anything, on top of whatever the user was doing.)
  }

    // Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) forward FIRST.
  // Standalone listener — does not touch existing keydown handling.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (window.parent.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);   // capture phase: runs BEFORE the app's own bubble listeners

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
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

  // R9 parity with the shell: static buttons ship EMPTY in the HTML,
  // JS paints localized aria-labels/titles at boot.
  function paintStaticAria() {
    var pairs = [
      ["tab-add",       "tab.add"],
      ["quick-add-btn", "add.task"],
      ["f-every",       "interval.aria"],
      ["l-every",       "interval.aria"]
    ];
    pairs.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.setAttribute("aria-label", t(pair[1]));
      el.setAttribute("title", t(pair[1]));
    });
    var ta = $("tab-add");
    if (ta && !ta.innerHTML.trim()) {
      ta.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
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
      view.hideCompleted = this.checked;   // TD-8: device-local
      saveView();
      scheduleRender();
    });
    $("clear-completed").addEventListener("click", function () {
      var list = activeList();
      var doomed = list.items.filter(function (it) { return it.done; });
      if (doomed.length === 0) return;
      pushUndo("toast.cleared");
      doomed.forEach(function (it) { tombstone(it.id); });   // merge-safe
      list.items = list.items.filter(function (it) { return !it.done; });
      save(); scheduleRender();
    });
    $("list-settings").addEventListener("click", function () {
      var cv = currentView();
      if (cv && cv.filter) { openFilterDialog(cv.filter.id); return; }
      openListDialog(activeList().id);
    });

    // --- TD-14: sort, selection bar, saved filters, subtasks ---
    $("sort-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("sort-pop");
      pop.hidden = !pop.hidden;
      if (!pop.hidden) {
        renderSortPop();
        var sel = pop.querySelector(".sel") || pop.querySelector("button");
        if (sel) sel.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#sort-slot")) $("sort-pop").hidden = true;
    });
    $("sel-move").addEventListener("click", function () {
      var r = this.getBoundingClientRect();
      openRowMenu(r.left, r.top - 8, null, null, selectedPairs);
    });
    $("sel-cancel").addEventListener("click", endSelection);
    $("f-sub-add").addEventListener("click", function () { addSub(); $("f-sub-new").focus(); });
    $("f-sub-new").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addSub(); }
    });
    $("f-rec-mode").addEventListener("change", function () {
      $("f-weekday").hidden = this.value === "after";
    });
    $("filter-form").addEventListener("submit", function (e) {
      e.preventDefault();
      saveFilterDialog();
      $("dlg-filter").close();
    });
    $("dlg-filter").addEventListener("close", function () { dlgFlt = null; editingFilterId = null; });
    $("flt-cancel").addEventListener("click", function () { $("dlg-filter").close(); });
    $("flt-due").addEventListener("change", function () { $("flt-range").hidden = this.value !== "range"; });
    $("flt-delete").addEventListener("click", function () {
      var id = editingFilterId;
      if (!id) return;
      confirmDialog("confirm.fltdel", function () {
        dlgFlt = null;
        $("dlg-filter").close();
        deleteFilter(id);
      });
    });
    // "Send to someone" (shell share/): the open list travels in a link.
    $("list-share").hidden = !shareApi;
    $("list-share").addEventListener("click", function () {
      var list = activeList();
      if (!shareApi) return;
      if (!list.items.length) { showToast(t("list.share.empty"), false); return; }
      shareApi.open({ kind: "list", data: {
        t: list.name || t("new.list"),
        i: list.items.map(function (it) { return { x: it.text, n: it.notes || "", d: it.done ? 1 : 0 }; })
      } });
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
    // TD6: keyboard parity — Esc dismisses the open label filter
    // popover (same gesture as outside-click). Bubble phase: the
    // Contract B capture listener only intercepts Ctrl+Alt+Shift
    // combos and is unaffected.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if ($("filter-pop").hidden) return;
      $("filter-pop").hidden = true;
      e.stopPropagation();
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
      $("dlg-item").close();   // persistence commits in the close handler
    });
        // Delete: tombstone (merge-safe) + local removal. Null-ing the
    // editing ids BEFORE close() makes the close-commit handler skip —
    // the item is already deleted, there is nothing to flush.
    $("f-delete").addEventListener("click", function () {
      confirmDialog("confirm.itemdel", function () {
        var list = listById(editingListId);
        if (list) {
          pushUndo("toast.deleted");
          tombstone(editingItemId);        // merge-safe deletion
          list.items = list.items.filter(function (it) { return it.id !== editingItemId; });
        }
        editingListId = null;
        editingItemId = null;
        $("dlg-item").close();
        save(); scheduleRender();
      });
    });

    // --- List dialog ---
    var listForm = $("list-form");
    listForm.addEventListener("submit", function (e) {
      e.preventDefault();
      saveListDialog();
      $("dlg-list").close();
    });
    $("l-delete").addEventListener("click", function () {
      var list = listById(editingListId);
      if (!list) return;

      if (isShared(list.id)) { hhDelete(list); return; }
      confirmDialog("confirm.listdel", function () {
        pushUndo("toast.listdel");
        tombstone(list.id);
        list.items.forEach(function (it) { tombstone(it.id); });   // cascade
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; });

        var fresh = keepOneList();
        if (fresh) undoFreshListId = fresh.id;
        state.om = Date.now();
        editingListId = null;

        $("dlg-list").close();
        save(); renderAll();
      });
    });

    // Household part of the list dialog
    $("l-hh-go").addEventListener("click", hhShare);
    $("l-hh-stop").addEventListener("click", function () {
      var list = listById(editingListId);
      if (list && isShared(list.id)) confirmDialog("confirm.hhstop", function () { hhStop(list, false); });
    });
    $("l-hh-open").addEventListener("click", function () {
      editingListId = null;
      $("dlg-list").close();
      try { window.parent.__orosOpenAt("household", null); } catch (e) {}
    });

    // Recurrence toggles (item + list editors)
    [["f", "rec-editor"], ["l", "rec-editor-list"]].forEach(function (pair) {
      var prefix = pair[0], editorId = pair[1];
      var radios = document.getElementsByName(prefix + "-rec");
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener("change", function () {
          $(editorId).style.display = (this.value === "on") ? "flex" : "none";
        });
      }
      $(prefix + "-unit").addEventListener("change", function () {
        $(prefix + "-weekday").disabled = (this.value !== "week");
      });
    });
  }

  // Commits the list dialog: header edits stamp the HEADER's mtime —
  // never other lists' data (structural merge keeps them independent).
  function saveListDialog() {
    var list = listById(editingListId);
    if (!list) return;

    var newName = $("l-name").value.trim();
    if (newName && newName !== list.name) {
      list.name = newName;
      touchListField(list, "name");
    }

    var rec = readRecFromFields("l-");
    if (JSON.stringify(rec) !== JSON.stringify(list.recurrence)) {
      list.recurrence = rec;
      if (rec) {
        // Cycle restarts from today under the new rule
        list.lastReset = todayISO();
        list.nextReset = dateToISO(nextOccurrence(isoToDate(todayISO()), rec));
      } else {
        list.lastReset = null;
        list.nextReset = null;
      }
      touchListField(list, "cycle");
    }

    editingListId = null;
    save(); scheduleRender();
  }

  // ---------- 14. Import from Todoist (todo/platforms.js) ----------
  // The plan comes from links/todo.js; this is its one write. Undo takes
  // out what came in (tombstoned, like any deletion here) and puts back
  // the fields an update changed. Ids are the plan's (L.extId).
  var TP = window.OrosTodoPlatforms || null;
  function importApply(pl, doneText) {
    var now = Date.now(), back = { lists: [], items: [], labels: [], upd: [], names: [] };
    pl.labels.add.forEach(function (x) {
      if (labelById(x.id)) return;
      state.labels.push({ id: x.id, name: x.name, color: SWATCH_COLORS[state.labels.length % SWATCH_COLORS.length],
                          mtime: now, om: 0, pos: state.labels.length });
      delete state.deleted[x.id];
      back.labels.push(x.id);
    });
    pl.lists.add.forEach(function (x) {
      if (listById(x.id)) return;
      var l = freshList(x.name);
      l.id = x.id;
      stampListNewest(l, now);
      l.pos = state.lists.length;
      state.lists.push(l);
      delete state.deleted[x.id];
      back.lists.push(x.id);
    });
    if (back.lists.length) state.om = now;
    pl.lists.upd.forEach(function (x) {
      var l = listById(x.id);
      if (!l || l.name === x.name) return;
      back.names.push({ id: l.id, name: l.name });
      l.name = x.name;
      touchListField(l, "name");
    });
    var touched = {};
    pl.items.add.forEach(function (x) {
      var l = listById(x.list);
      if (!l || findItem(x.id)) return;
      var it = freshItem(x.text, x.due);
      it.id = x.id;
      it.notes = x.notes || "";
      it.labels = x.labels.filter(function (id) { return !!labelById(id); });
      it.info = x.info.map(function (f) { return { id: f.id, label: f.label, value: f.value }; });
      stampItemNewest(it, now);
      if (x.prio === 1 || x.prio === 2 || x.prio === 3) { it.prio = x.prio; it.xf = { prio: now }; }
      // Google Tasks (gtasks.js): a task completed there, and its subtasks
      if (x.done === true) it.done = true;
      if (Array.isArray(x.subs) && x.subs.length) {
        var subs = Mdl.cleanSubs(x.subs.map(function (sb) { return { id: sb.id, text: sb.text, done: !!sb.done, mtime: now }; }));
        if (subs.length) { it.subs = subs; touchXf(it, "subs", now); }
      }
      l.items.push(it);
      delete state.deleted[x.id];
      back.items.push(x.id);
      touched[l.id] = l;
    });
    Object.keys(touched).forEach(function (id) {
      var l = touched[id];
      l.items.forEach(function (it, i) { it.pos = i; });
      l.om = now;
    });
    pl.items.upd.forEach(function (x) {
      var hit = findItem(x.id);
      if (!hit) return;
      var it = hit.item, old = {};
      Object.keys(x.f).forEach(function (f) {
        if (f === "prio") {                  // TD-14: Todoist's priority → the task's own
          old.prio = Mdl.prioOf(it);
          setPrio(it, Mdl.prioOf({ prio: x.f.prio }));
          return;
        }
        if (ITEM_FIELDS.indexOf(f) < 0) return;
        old[f] = JSON.parse(JSON.stringify(it[f] === undefined ? null : it[f]));
        it[f] = f === "labels" ? x.f[f].filter(function (id) { return !!labelById(id); }) : x.f[f];
        touchField(it, f);
      });
      back.upd.push({ id: x.id, old: old });
    });
    save(); renderAll();
    undoSnapshot = null;
    undoFn = function () { importUndo(back); };
    undoViewList = view.activeList;
    showToast(doneText, true);
    return true;
  }
  function findItem(id) {
    for (var i = 0; i < state.lists.length; i++) {
      var it = itemById(state.lists[i], id);
      if (it) return { list: state.lists[i], item: it };
    }
    return null;
  }
  function importUndo(back) {
    var now = Date.now(), gone = {};
    back.items.forEach(function (id) { gone[id] = 1; tombstone(id); });
    state.lists.forEach(function (l) {
      var before = l.items.length;
      l.items = l.items.filter(function (it) { return !gone[it.id]; });
      if (l.items.length !== before) { l.items.forEach(function (it, i) { it.pos = i; }); l.om = now; }
    });
    back.upd.forEach(function (u) {
      var hit = findItem(u.id);
      if (!hit) return;
      Object.keys(u.old).forEach(function (f) {
        if (f === "prio") { setPrio(hit.item, u.old.prio); return; }
        hit.item[f] = u.old[f]; touchField(hit.item, f);
      });
    });
    back.names.forEach(function (n) { var l = listById(n.id); if (l) { l.name = n.name; touchListField(l, "name"); } });
    var dropList = {};
    back.lists.forEach(function (id) {
      var l = listById(id);
      if (l && !l.items.length) { dropList[id] = 1; tombstone(id); }
    });
    if (Object.keys(dropList).length && state.lists.length > Object.keys(dropList).length) {
      state.lists = state.lists.filter(function (l) { return !dropList[l.id]; });
      state.lists.forEach(function (l, i) { l.pos = i; });
      state.om = now;
    }
    var dropLabel = {};
    back.labels.forEach(function (id) { dropLabel[id] = 1; tombstone(id); });
    if (back.labels.length) {
      state.lists.forEach(function (l) {
        l.items.forEach(function (it) {
          var next = (it.labels || []).filter(function (id) { return !dropLabel[id]; });
          if (next.length !== (it.labels || []).length) { it.labels = next; touchField(it, "labels"); }
        });
      });
      state.labels = state.labels.filter(function (lb) { return !dropLabel[lb.id]; });
      state.labels.forEach(function (lb, i) { lb.pos = i; });
      activeFilters = activeFilters.filter(function (id) { return !dropLabel[id]; });
      updateFilterBtn();
    }
    if (!listById(view.activeList)) setActiveList((undoViewList && listById(undoViewList)) ? undoViewList : state.lists[0].id);
    save(); renderAll();
    showToast(t("toast.undone"), false);
  }
  if (TP) {
    TP.init({ lang: LANG, data: function () { return state; }, apply: importApply });
    var impBtn = $("l-import");
    if (impBtn && TP.has()) {
      impBtn.textContent = TP.label();
      impBtn.hidden = false;
      impBtn.addEventListener("click", function () {
        if (editingListId !== null) saveListDialog();
        editingListId = null;
        $("dlg-list").close();
        TP.open();
      });
    }
  }

  // One-time import from Google Tasks (gtasks.js, /google-import.js):
  // the same plan shape and the same one write + Undo (importApply).
  // The sign-in window opens inside this click.
  var GT = window.OrosTodoGtasks || null;
  if (GT) {
    GT.init({ lang: LANG, data: function () { return state; }, apply: importApply });
    var gBtn = $("l-gimport");
    if (gBtn && GT.has()) {
      gBtn.textContent = GT.label();
      gBtn.hidden = false;
      gBtn.addEventListener("click", function () {
        if (editingListId !== null) saveListDialog();
        editingListId = null;
        $("dlg-list").close();
        GT.open();
      });
    }
  }

  // Import an export file of another task app (import.js): Todoist
  // CSV / backup ZIP, TickTick, Google Takeout, todo.txt, .ics VTODO,
  // Remember The Milk. The same plan shape, one write and Undo
  // (importApply); works inside the shell and on its own. The file
  // picker opens inside this click.
  var FI = window.OrosTodoImport || null;
  if (FI) {
    FI.init({ lang: LANG, data: function () { return state; }, apply: importApply });
    var fBtn = $("l-fimport");
    if (fBtn && FI.has()) {
      fBtn.textContent = FI.label();
      fBtn.hidden = false;
      fBtn.addEventListener("click", function () {
        if (editingListId !== null) saveListDialog();
        editingListId = null;
        $("dlg-list").close();
        FI.open();
      });
    }
  }

  // .orostasks (OBF-4e): every list, task, subtask and label as one
  // orOS file (../recordpkg.js + package.js). Opening ADDS what this
  // device lacks, with its ids; a task already here (or deleted here)
  // is kept as it is unless "Update with newer versions" is ticked.
  // The result goes through migrate + save (so sync carries it); Undo
  // removes the added records the way importUndo does.
  var RP = window.OrosRecordPkg || null, TPK = window.OrosTodoPackage || null;
  var recFile = RP && TPK && window.OrosBundle ? RP.ui(TPK.DESC, {
    lang: function () { return LANG === "el" ? "el" : "en"; },
    // the person's own lists (a list shared with a household is theirs
    // only in part; a file of one comes in as a list of their own)
    get: function () { return canonState(personal(state)); },
    title: function () { return "To-Do"; },
    set: function (next, info) {
      var data = migrate(JSON.parse(JSON.stringify(next)));
      if (!data || !Array.isArray(data.lists) || !data.lists.length) return;
      var now = Date.now(), added = {};
      (info && info.addedIds || []).forEach(function (id) { added[id] = 1; });
      var listsAdded = false;
      data.lists.forEach(function (l) {
        if (added[l.id]) listsAdded = true;
        if (l.items.some(function (it) { return added[it.id]; })) {
          l.items.forEach(function (it, i) { it.pos = i; });
          l.om = now;
        }
      });
      if (listsAdded) { data.lists.forEach(function (l, i) { l.pos = i; }); data.om = now; }
      if (data.labels.some(function (lb) { return added[lb.id]; })) data.labels.forEach(function (lb, i) { lb.pos = i; });
      data.lists.forEach(function (l) { if (isShared(l.id)) l.id = HHo.COPY + HHo.docOf(l.id); });
      var shared = state.lists.filter(function (l) { return isShared(l.id); });
      state = data;
      state.lists = state.lists.concat(shared);
      pruneTombstones(state);
      applyListCycles();
      if (!listById(view.activeList)) setActiveList(state.lists[0].id);
      save(); renderAll();
    },
    deleteIds: function (ids) {
      var back = { items: [], upd: [], names: [], lists: [], labels: [] }, subs = {};
      ids.forEach(function (id) {
        var k = TPK.kindOf(id, state);
        if (k === "item") back.items.push(id);
        else if (k === "list") back.lists.push(id);
        else if (k === "label") back.labels.push(id);
        else if (k === "sub") subs[id] = 1;
      });
      if (Object.keys(subs).length) {
        state.lists.forEach(function (l) {
          l.items.forEach(function (it) {
            if (!it.subs || !it.subs.some(function (sb) { return subs[sb.id]; })) return;
            it.subs = it.subs.filter(function (sb) { return !subs[sb.id]; });
            if (!it.subs.length) delete it.subs;
            touchXf(it, "subs");
          });
        });
        Object.keys(subs).forEach(tombstone);
      }
      importUndo(back);
    },
    toast: function (text, undo) {
      if (undo) {
        undoSnapshot = null;
        undoFn = undo;
        undoViewList = view.activeList;
      }
      showToast(text, !!undo);
    }
  }) : null;
  [["l-osave", "save", function () { recFile.save(); }],
   ["l-oopen", "open", function () { recFile.open(); }],
   ["l-ofolder", "folder", function () { recFile.openFolder(); }]].forEach(function (b) {
    var el = $(b[0]);
    if (!el || !recFile) return;
    el.textContent = recFile.text(b[1]);
    el.hidden = false;
    el.addEventListener("click", function () {
      if (editingListId !== null) saveListDialog();
      editingListId = null;
      $("dlg-list").close();
      b[2]();
    });
  });

  // ---------- 15. CalDAV: a list linked to a task list on the person's own server (wave 5) ----------
  // The account is in Settings › Sync (../davkit.js, this device only);
  // here one of the person's own lists (never a household one) is
  // linked to one server task list (state.dav, synced, so every device
  // of the person links the same) and the tasks go both ways through
  // ../davsync.js with todo/dav.js (+ todo/vtodo.js) as the mapper. The
  // four scripts load on first use. The sync state (ETags, the
  // server's own text) is device-local in IndexedDB "oros-dav", key
  // "todo|<url>", one record per link: { link: the link's mtime, st };
  // a record of an older link is not used (linked again = a first
  // link, nothing deleted on either side).
  // A task is one server task; a subtask is a server task whose
  // RELATED-TO names its task (and that holds only a text and a tick:
  // a child task with more is a task of the list here). Tasks that
  // come down are stamped field by field like any edit (TD-3), so the
  // person's other orOS devices get them by normal sync. Runs while
  // To-Do is open: shortly after it opens, every 5 minutes, when it is
  // shown again, when the network is back, a few seconds after an
  // edit, after an orOS sync and on "Sync now".
  var TD_EVERY = 5 * 60000, TD_KICK = 4000;
  var tdLibP = null, tdStore = null, tdBusy = false, tdQueued = false, tdApplying = false;
  var tdInfo = {};       // list id → { busy, at, err, stats, held, decision }
  var tdRo = {};         // task / subtask id → list id (read-only here, DAV-4)
  var tdUids = {};       // link url → { orOS id: server UID }
  var tdKickT = null, tdLastRun = 0, tdPrev = null;

  function tdLib() {
    if (window.OrosDav && window.OrosDavSync && window.OrosTodoDav && tdStore) return Promise.resolve(true);
    if (tdLibP) return tdLibP;
    var q = SCRIPT_V ? "?v=" + encodeURIComponent(SCRIPT_V) : "";
    function load(src, has) {
      if (has()) return Promise.resolve(true);
      return new Promise(function (res) {
        var sc = document.createElement("script");
        sc.src = src + q;
        sc.onload = function () { res(true); };
        sc.onerror = function () { res(false); };
        document.head.appendChild(sc);
      });
    }
    tdLibP = load("../davkit.js", function () { return !!window.OrosDav; })
      .then(function () { return load("../davsync.js", function () { return !!window.OrosDavSync; }); })
      .then(function () { return load("vtodo.js", function () { return !!window.OrosVtodo; }); })
      .then(function () { return load("dav.js", function () { return !!window.OrosTodoDav; }); })
      .then(function () {
        var ok = !!(window.OrosDav && window.OrosDavSync && window.OrosVtodo && window.OrosTodoDav);
        if (!ok) { tdLibP = null; return false; }
        if (!tdStore) {
          try { tdStore = window.indexedDB ? window.OrosDavSync.idbStore() : window.OrosDavSync.memStore(); }
          catch (e) { tdStore = window.OrosDavSync.memStore(); }
        }
        return true;
      });
    return tdLibP;
  }
  function tdLinkOf(lid) {
    var d = state.dav || [];
    for (var i = 0; i < d.length; i++) if (d[i].id === lid) return d[i];
    return null;
  }
  // The active links: a list of the person's own that is still here.
  function tdLinks() {
    return (state.dav || []).filter(function (x) { return x.url && !isShared(x.id) && !!listById(x.id); });
  }
  function tdLinkByUrl(url) {
    var l = tdLinks();
    for (var i = 0; i < l.length; i++) if (l[i].url === url) return l[i];
    return null;
  }
  function tdAccount() {
    try { return window.OrosDav ? window.OrosDav.load() : null; } catch (e) { return null; }
  }
  function tdColOf(acct, url) {
    var cols = acct && acct.cols || [];
    for (var i = 0; i < cols.length; i++) if (cols[i].url === url) return cols[i];
    return null;
  }
  function tdCols(acct) {
    return (acct && acct.cols || []).filter(function (c) { return c.kind === "cal" && c.comps.indexOf("VTODO") !== -1; });
  }
  function tdKey(url) { return "todo|" + url; }
  function tdKeepUids(url, st) {
    var m = {};
    if (st && st.items) {
      Object.keys(st.items).forEach(function (k) {
        var u = st.raw && st.raw[k] ? window.OrosTodoDav.uidOf(st.raw[k]) : "";
        if (u) m[st.items[k].id] = u;
      });
    }
    tdUids[url] = m;
  }
  function tdUidOf(url, id) {
    var m = tdUids[url] || {};
    return m[id] || id + "@oros.todo";
  }
  function tdLabelNames(it) {
    return (it.labels || []).map(function (id) { var lb = labelById(id); return lb ? lb.name : ""; })
      .filter(Boolean);
  }
  // What the engine compares: a task, or a subtask (a text and a tick).
  function tdTask(it) {
    return { id: it.id, text: it.text || "", notes: it.notes || "", due: it.due || null, prio: Mdl.prioOf(it),
             done: !!it.done, rec: it.recurrence || null, cats: tdLabelNames(it), sub: false, mtime: it.mtime || 0 };
  }
  function tdSub(url, it, s) {
    return { id: s.id, text: s.text || "", notes: "", due: null, prio: 4, done: !!s.done, rec: null, cats: [],
             sub: true, parent: it.id, puid: tdUidOf(url, it.id), mtime: s.mtime || 0 };
  }
  function tdLocal(lid, url) {
    var list = listById(lid), items = [];
    if (list && !isShared(lid)) {
      list.items.forEach(function (it) {
        items.push({ id: it.id, item: tdTask(it) });
        (it.subs || []).forEach(function (s) { items.push({ id: s.id, item: tdSub(url, it, s) }); });
      });
    }
    return { items: items, find: function () { return null; } };
  }
  // Label names → label ids (one label per name, without case; a new
  // name becomes a new label).
  function tdLabelIds(names, now) {
    var DV = window.OrosTodoDav, out = [];
    (names || []).forEach(function (n) {
      var k = DV.catKey(n), lb = null;
      if (!k) return;
      for (var i = 0; i < state.labels.length; i++) if (DV.catKey(state.labels[i].name) === k) { lb = state.labels[i]; break; }
      if (!lb) {
        lb = { id: uid(), name: String(n).trim().slice(0, 40), color: SWATCH_COLORS[state.labels.length % SWATCH_COLORS.length],
               mtime: now, om: 0, pos: state.labels.length };
        state.labels.push(lb);
      }
      if (out.indexOf(lb.id) === -1) out.push(lb.id);
    });
    return out;
  }
  function tdSameCats(it, names) {
    var DV = window.OrosTodoDav;
    var a = tdLabelNames(it).map(DV.catKey).filter(Boolean).sort(), b = (names || []).map(DV.catKey).filter(Boolean).sort();
    a = a.filter(function (x, i) { return a.indexOf(x) === i; });
    b = b.filter(function (x, i) { return b.indexOf(x) === i; });
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // A task's fields from the server, each stamped only when it changed.
  function tdSetTask(it, x, now) {
    var V = window.OrosVtodo, any = false;
    function set(f, v) {
      if (JSON.stringify(it[f] === undefined ? null : it[f]) === JSON.stringify(v)) return;
      it[f] = v;
      ensureFm(it);
      it.fm[f] = now;
      it.mtime = Math.max(it.mtime || 0, now);
      any = true;
    }
    set("text", x.text || it.text || "?");
    if ((it.notes || "").replace(/\s+$/, "") !== (x.notes || "")) set("notes", x.notes || "");
    set("due", x.due || null);
    set("done", !!x.done);
    if (JSON.stringify(V.normRec(it.recurrence)) !== JSON.stringify(V.normRec(x.rec))) set("recurrence", V.normRec(x.rec));
    if (!tdSameCats(it, x.cats)) set("labels", tdLabelIds(x.cats, now));
    var p = x.prio === 1 || x.prio === 2 || x.prio === 3 ? x.prio : 4;
    if (Mdl.prioOf(it) !== p) {
      if (p < 4) it.prio = p; else delete it.prio;
      touchXf(it, "prio", now);
      any = true;
    }
    return any;
  }
  // The engine's result → the list (stamped now). r.state names the
  // server UID of every item, so a subtask finds its task.
  function tdApply(lid, url, r) {
    var list = listById(lid);
    if (!list || (!r.upsert.length && !r.remove.length)) return;
    var DV = window.OrosTodoDav, now = Date.now(), changed = false;
    tdKeepUids(url, r.state);
    var byUid = {};
    Object.keys(tdUids[url] || {}).forEach(function (id) { byUid[tdUids[url][id]] = id; });
    function taskOf(id) { for (var i = 0; i < list.items.length; i++) if (list.items[i].id === id) return list.items[i]; return null; }
    function subOf(id) {
      for (var i = 0; i < list.items.length; i++) {
        var s = findSub(list.items[i], id);
        if (s) return { task: list.items[i], sub: s };
      }
      return null;
    }
    function dropSub(hit) {
      hit.task.subs = hit.task.subs.filter(function (s) { return s !== hit.sub; });
      if (!hit.task.subs.length) delete hit.task.subs;
      touchXf(hit.task, "subs", now);
    }
    function newTask(x) {
      var it = { id: x.id, text: x.text || "?", done: false, due: null, notes: "", labels: [], info: [], recurrence: null,
                 mtime: now, om: 0, pos: list.items.length };
      stampItemNewest(it, now);
      tdSetTask(it, x, now);
      list.items.push(it);
      return it;
    }
    function putTask(x) {
      var hit = subOf(x.id);
      if (hit) dropSub(hit);                       // a subtask that now holds more: a task here
      var it = taskOf(x.id);
      if (it) { if (tdSetTask(it, x, now)) changed = true; }
      else { newTask(x); changed = true; }
    }
    function parentOf(x) {
      var pid = x.parent || (x.puid ? (byUid[x.puid] || DV.parentId(url, x.puid)) : null);
      var p = pid ? taskOf(pid) : null;
      return p && p.id !== x.id ? p : null;
    }
    var subs = [];
    r.upsert.forEach(function (x) { if (x.sub) subs.push(x); else putTask(x); });
    subs.forEach(function (x) {
      var parent = parentOf(x), hit = subOf(x.id);
      if (!parent) { putTask(x); return; }         // its task is not in this list
      var text = String(x.text || "").replace(/\s+/g, " ").trim().slice(0, Mdl.SUB_TEXT) || "?";
      if (hit) {
        if (hit.sub.text !== text || hit.sub.done !== !!x.done) {
          hit.sub.text = text; hit.sub.done = !!x.done; hit.sub.mtime = now;
          touchXf(hit.task, "subs", now);
          changed = true;
        }
        return;
      }
      var asTask = taskOf(x.id);
      if (asTask && ((asTask.info || []).length || (asTask.subs || []).length)) { putTask(x); return; }
      if ((parent.subs || []).length >= Mdl.SUB_MAX) { putTask(x); return; }
      if (asTask) list.items = list.items.filter(function (y) { return y !== asTask; });
      parent.subs = (parent.subs || []).concat([{ id: x.id, text: text, done: !!x.done, mtime: now }]);
      touchXf(parent, "subs", now);
      changed = true;
    });
    var gone = {};
    r.remove.forEach(function (id) { gone[id] = 1; });
    r.remove.forEach(function (id) {
      var it = taskOf(id);
      if (it) {
        // Its subtasks still on the server stay, as tasks of the list.
        (it.subs || []).forEach(function (s) {
          if (gone[s.id]) { tombstone(s.id); return; }
          var t2 = { id: s.id, text: s.text, done: !!s.done, due: null, notes: "", labels: [], info: [], recurrence: null,
                     mtime: now, om: 0, pos: list.items.length };
          stampItemNewest(t2, now);
          list.items.push(t2);
        });
        list.items = list.items.filter(function (y) { return y !== it; });
        tombstone(id);
        changed = true;
        return;
      }
      var hit = subOf(id);
      if (hit) { dropSub(hit); tombstone(id); changed = true; }
    });
    if (!changed) return;
    list.items.forEach(function (it, i) { it.pos = i; });
    tdApplying = true;
    try { save(); } finally { tdApplying = false; }
    scheduleRender();
  }
  function tdRoFor(lid, st) {
    Object.keys(tdRo).forEach(function (id) { if (tdRo[id] === lid) delete tdRo[id]; });
    if (!st || !st.items) return;
    Object.keys(st.items).forEach(function (k) { if (st.items[k].ro) tdRo[st.items[k].id] = lid; });
  }
  function tdRecord(x) {
    return tdStore.get(tdKey(x.url)).then(function (rec) {
      return rec && rec.link === x.mtime ? rec.st : null;
    }, function () { return null; });
  }
  function tdPassOne(x, acct) {
    var DS = window.OrosDavSync, lid = x.id, key = tdKey(x.url);
    var info = tdInfo[lid] || (tdInfo[lid] = {});
    var col = tdColOf(acct, x.url);
    var decision = info.decision || null;
    info.decision = null;
    info.busy = true;
    renderTdBox();
    var cl = window.OrosDav.client(acct.conf, acct.pass);
    var map = window.OrosTodoDav.mapper(x.url, { mark: t("td.mark") });
    function still() { var y = tdLinkOf(lid); return y && y.url === x.url && y.mtime === x.mtime; }
    return tdRecord(x).then(function (st) {
      tdKeepUids(x.url, st);
      return DS.sync({ client: cl, url: x.url, readOnly: !!(col && col.readOnly), state: st, map: map, decision: decision },
        function () { return tdLocal(lid, x.url); },
        function (r) { if (!still()) throw new Error("dav-unlinked"); tdApply(lid, x.url, r); },
        function (s) { tdKeepUids(x.url, s); return tdStore.set(key, { link: x.mtime, st: s }); });
    }).then(function (r) {
      info.at = Date.now();
      info.err = "";
      info.stats = r.stats;
      info.held = r.held;
      tdRoFor(lid, r.state);
    }, function (e) {
      info.err = (e && e.message) || "other";
      if (info.err === "dav-unlinked") info.err = "";
      else console.warn("[To-Do] CalDAV pass failed:", info.err);
    }).then(function () {
      info.busy = false;
      renderTdBox();
    });
  }
  function tdRun() {
    if (tdBusy) { tdQueued = true; return Promise.resolve(); }
    if (!tdLinks().length) return Promise.resolve();
    tdBusy = true;
    return tdLib().then(function (ok) {
      if (!ok) return;
      var acct = tdAccount(), links = tdLinks();
      if (!acct || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        links.forEach(function (x) { (tdInfo[x.id] = tdInfo[x.id] || {}).err = acct ? "offline" : "noacct"; });
        return;
      }
      return links.reduce(function (p, x) {
        return p.then(function () { return tdPassOne(x, acct); });
      }, Promise.resolve());
    }).then(function () {
      tdBusy = false;
      tdLastRun = Date.now();
      renderTdBox();
      if (tdQueued) { tdQueued = false; tdKick(); }
    }, function (e) {
      tdBusy = false;
      console.warn("[To-Do] CalDAV:", e);
    });
  }
  function tdKick() {
    if (tdApplying || !tdLinks().length) return;
    clearTimeout(tdKickT);
    tdKickT = setTimeout(tdRun, TD_KICK);
  }
  // CalDAV wave 6: the shell's background pass opens this app in a
  // hidden frame (?davbg=1) while it is closed; one pass, then the
  // shell is told and drops the frame.
  function tdBgDone() {
    var held = 0, errs = [];
    tdLinks().forEach(function (x) {
      var i = tdInfo[x.id] || {};
      if (i.err) errs.push(i.err);
      if (i.held && (i.held.local || i.held.server)) held++;
    });
    try {
      parent.postMessage({ oros: "dav-bg-done", app: "todo", links: tdLinks().length, held: held, err: errs[0] || "" },
                         location.origin);
    } catch (e) {}
  }
  function tdBoot() {
    if (/[?&]davbg=1(&|$)/.test(location.search)) {
      tdRun().then(tdBgDone, tdBgDone);
      return;
    }
    if (tdLinks().length) {
      tdLib().then(function (ok) {
        if (!ok) return;
        tdLinks().forEach(function (x) { tdRecord(x).then(function (st) { tdKeepUids(x.url, st); tdRoFor(x.id, st); }); });
      });
      setTimeout(tdRun, 1500);
    }
    setInterval(function () {
      if (document.visibilityState !== "hidden") tdRun();
    }, TD_EVERY);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && Date.now() - tdLastRun > 60000) tdRun();
    });
    window.addEventListener("online", function () { tdRun(); });
  }

  // ----- The "Server task list" part of the list dialog -----
  function tdErrText(e) {
    if (e === "noacct") return t("td.err.noacct");
    if (e === "offline" || e === "cd-unreachable") return t("td.err.net");
    if (e === "cd-auth") return t("td.err.auth");
    if (e === "cd-readonly") return t("td.err.ro");
    return t("td.err.other").replace("{e}", String(e).slice(0, 40));
  }
  function tdStamp(ms) {
    var d = new Date(ms);
    return d.toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
  }
  function tdStatus(x) {
    var info = tdInfo[x.id] || {};
    if (info.busy) return t("td.wait");
    if (info.err) return tdErrText(info.err);
    if (!info.at) return t("td.never");
    var s = t("td.ok").replace("{t}", tdStamp(info.at));
    if (info.stats && info.stats.conflicts) s += " · " + t("td.conflicts").replace("{n}", String(info.stats.conflicts));
    return s;
  }
  function renderTdBox() {
    var box = $("l-dav"), dlg = $("dlg-list");
    if (!box || !dlg || !dlg.open) return;
    var lid = editingListId, list = lid ? listById(lid) : null;
    box.hidden = !list || isShared(lid);
    if (box.hidden) return;
    var ready = !!(window.OrosDav && window.OrosTodoDav);
    var acct = ready ? tdAccount() : null, x = tdLinks().filter(function (y) { return y.id === lid; })[0] || null;
    $("l-dav-on").hidden = !x;
    $("l-dav-noacct").hidden = !!x || !!acct;
    $("l-dav-off").hidden = !!x || !acct;
    if (tdPrev && (x || tdPrev.lid !== lid)) tdPrevClose();
    if (x) {
      var col = tdColOf(acct, x.url), info = tdInfo[x.id] || {};
      $("l-dav-in").textContent = t("td.linked").replace("{n}", (col && col.name) || x.url);
      var st = $("l-dav-st");
      st.textContent = col ? tdStatus(x) : (acct ? t("td.gone") : t("td.other"));
      st.classList.toggle("err", !!info.err);
      $("l-dav-held").hidden = !(info.held && !info.busy);
      if (info.held) {
        $("l-dav-held-text").textContent = t("td.held").replace("{n}", String(info.held.local + info.held.server))
          .replace("{a}", String(info.held.local)).replace("{b}", String(info.held.server));
      }
      $("l-dav-sync").hidden = !(col && acct);
      $("l-dav-sync").disabled = !!info.busy || tdBusy;
      return;
    }
    if (!acct) return;
    var sel = $("l-dav-col"), keep = sel.value;
    sel.textContent = "";
    var cols = tdCols(acct).filter(function (c) { return !tdLinkByUrl(c.url); });
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = cols.length ? t("td.pick") : t("td.none");
    sel.appendChild(o0);
    cols.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.url;
      o.textContent = (c.name || t("td.noname")) + (c.readOnly ? " (" + t("td.ro.col") + ")" : "");
      sel.appendChild(o);
    });
    if (keep && cols.some(function (c) { return c.url === keep; })) sel.value = keep;
    sel.disabled = !cols.length;
    $("l-dav-go").disabled = !cols.length;
  }
  function tdPrevShow(text, canGo) {
    $("l-dav-prev").hidden = false;
    $("l-dav-pickrow").hidden = true;
    $("l-dav-prev-text").textContent = text;
    $("l-dav-prev-go").disabled = !canGo;
  }
  function tdPrevClose() {
    tdPrev = null;
    if ($("l-dav-prev")) $("l-dav-prev").hidden = true;
    if ($("l-dav-pickrow")) $("l-dav-pickrow").hidden = false;
  }
  // First link: what would happen, before anything is written.
  function tdPreview() {
    var acct = tdAccount(), lid = editingListId, url = $("l-dav-col").value;
    var col = tdColOf(acct, url);
    if (!acct || !col || !lid || tdBusy) { if (!url) $("l-dav-col").focus(); return; }
    var mine = tdPrev = { col: col, lid: lid, ok: false };
    tdPrevShow(t("td.preview.wait"), false);
    var map = window.OrosTodoDav.mapper(col.url, { mark: t("td.mark") });
    window.OrosDavSync.run({ client: window.OrosDav.client(acct.conf, acct.pass), url: col.url, readOnly: !!col.readOnly,
                             state: null, local: tdLocal(lid, col.url), map: map, dry: true })
      .then(function (r) {
        if (tdPrev !== mine) return;
        mine.ok = true;
        var s = r.stats;
        var text = t("td.preview").replace("{down}", String(s.down)).replace("{up}", String(col.readOnly ? 0 : s.up))
          .replace("{same}", String(s.same));
        if (col.readOnly) text += " " + t("td.preview.ro");
        if (s.conflicts) text += " " + t("td.conflicts").replace("{n}", String(s.conflicts));
        tdPrevShow(text, true);
      }, function (e) {
        if (tdPrev !== mine) return;
        tdPrevShow(tdErrText((e && e.message) || "other"), false);
      });
  }
  function tdLinkNow() {
    var p = tdPrev;
    if (!p || !p.ok || !listById(p.lid) || isShared(p.lid)) return;
    tdPrevClose();
    var now = Date.now();
    state.dav = (state.dav || []).filter(function (y) { return y.id !== p.lid; });
    state.dav.push({ id: p.lid, url: p.col.url, mtime: now });
    normDav(state);
    save();
    renderTdBox();
    tdRun();
  }
  function tdUnlink() {
    var y = tdLinkOf(editingListId);
    if (!y || !y.url) return;
    var url = y.url;
    y.url = "";
    y.mtime = Date.now();
    delete tdInfo[y.id];
    tdRoFor(y.id, null);
    delete tdUids[url];
    if (tdStore) tdStore.del(tdKey(url)).catch(function () {});
    save();
    renderTdBox();
    showToast(t("td.unlinked"), false);
  }
  function tdFillDialog() {
    if (!$("l-dav")) return;
    tdPrevClose();
    var list = editingListId ? listById(editingListId) : null;
    $("l-dav").hidden = !list || isShared(list.id);
    if ($("l-dav").hidden) return;
    $("l-dav-on").hidden = $("l-dav-off").hidden = true;
    $("l-dav-noacct").hidden = true;
    tdLib().then(function (ok) {
      if (!ok) { $("l-dav-noacct").hidden = false; return; }
      renderTdBox();
    });
  }
  if ($("l-dav")) {
    $("l-dav-go").addEventListener("click", tdPreview);
    $("l-dav-prev-go").addEventListener("click", tdLinkNow);
    $("l-dav-prev-no").addEventListener("click", tdPrevClose);
    $("l-dav-sync").addEventListener("click", function () { tdRun(); });
    $("l-dav-unlink").addEventListener("click", tdUnlink);
    $("l-dav-yes").addEventListener("click", function () {
      var info = tdInfo[editingListId];
      if (!info) return;
      info.decision = "allow"; info.held = null; tdRun();
    });
    $("l-dav-no").addEventListener("click", function () {
      var info = tdInfo[editingListId];
      if (!info) return;
      info.decision = "restore"; info.held = null; tdRun();
    });
    $("l-dav-set").addEventListener("click", function () {
      var p = null;
      try { p = window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) {}
      if (!p) return;
      if (editingListId !== null) saveListDialog();
      editingListId = null;
      $("dlg-list").close();
      p.__orosOpenAt("settings", { section: "sync" });
    });
  }

  // ---------- Boot ----------
  load();
  loadView();
  hhBoot();
  applyI18n();
  paintStaticAria();
  populateWeekdaySelects();
  // ---------- 13. "Send to To-Do" receiver (other apps → a list) ----------
  // Contract (OROS_BIBLE.md, BR-TD-ADD): any app calls
  //   window.parent.__orosOpenAt("todo", { addItems: {
  //     list: "tdl-groceries",   // optional: the list to suggest
  //     newList: "Rome",         // optional: offer a new list with this name
  //     from: "Meal Planner",    // optional: who is sending (shown only)
  //     items: [{ text, note }]  // 1..ADD_MAX
  //     now: true                // optional (Quick window, QW): one item,
  //   } })                       //   no newList → added at once, with Undo
  // To-Do opens a dialog with the items ticked and writes NOTHING until
  // the user presses Add (prefill, not data: BR-W8-6). The sender never
  // touches oros-todo-data, so the slice keeps one writer. Items whose
  // text is already open in the chosen list start unticked.
  var ADD_MAX = 200, ADD_TEXT = 300, ADD_NOTE = 1000, ADD_NAME = 60;
  var ADD_STRINGS = {
    en: { "add.title": "Add to To-Do", from: "From {app}", list: "List", newl: "New list: {name}",
          dup: "already on the list", "add.go": "Add {n}", "add.none": "Nothing ticked", added: "{n} added to {list}" },
    el: { "add.title": "Προσθήκη στο To-Do", from: "Από: {app}", list: "Λίστα", newl: "Νέα λίστα: {name}",
          dup: "υπάρχει ήδη στη λίστα", "add.go": "Προσθήκη {n}", "add.none": "Δεν τσεκάρισες τίποτα", added: "{n} μπήκαν στη λίστα «{list}»" }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(ADD_STRINGS, "todo", LANG);
  function addT(k, p) {
    var s = (ADD_STRINGS[LANG] || ADD_STRINGS.en)[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function addClean(v, max, block) {
    if (typeof v !== "string") return "";
    v = v.replace(block ? /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g : /[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
    v = (block ? v.replace(/[ \t]+/g, " ") : v.replace(/\s+/g, " ")).trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  // Pure: payload → { list, newList, from, items[{text, note}] } or null.
  function readAddPayload(p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.items)) return null;
    var seen = {}, items = [];
    p.items.slice(0, ADD_MAX).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var text = addClean(x.text, ADD_TEXT, false), k = normalize(text);
      if (!text || !k || seen[k]) return;
      seen[k] = 1;
      items.push({ text: text, note: addClean(x.note, ADD_NOTE, true) });
    });
    if (!items.length) return null;
    return {
      list: typeof p.list === "string" ? p.list : "",
      newList: addClean(p.newList, ADD_NAME, false),
      from: addClean(p.from, ADD_NAME, false),
      items: items
    };
  }
  function openKeysOf(list) {
    var k = {};
    (list ? list.items : []).forEach(function (it) { if (!it.done) k[normalize(it.text || "")] = 1; });
    return k;
  }
  function openAddItems(raw) {
    var p = readAddPayload(raw);
    if (!p) return;
    if (raw.now === true && p.items.length === 1 && !p.newList) { addItemNow(p); return; }
    var stale = document.getElementById("todo-add");
    if (stale) stale.remove();
    var NEW = "\u0000new";
    var dlg = document.createElement("dialog");
    dlg.id = "todo-add";
    var form = document.createElement("form");
    form.method = "dialog";
    form.autocomplete = "off";
    var h = document.createElement("h3");
    h.textContent = addT("add.title");
    form.appendChild(h);
    if (p.from) {
      var fr = document.createElement("p");
      fr.className = "hint";
      fr.textContent = addT("from", { app: p.from });
      form.appendChild(fr);
    }
    var lab = document.createElement("label");
    lab.textContent = addT("list");
    lab.htmlFor = "add-list";
    form.appendChild(lab);
    var sel = document.createElement("select");
    sel.id = "add-list";
    state.lists.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id; o.textContent = l.name || t("new.list");
      sel.appendChild(o);
    });
    if (p.newList) {
      var on = document.createElement("option");
      on.value = NEW; on.textContent = addT("newl", { name: p.newList });
      sel.appendChild(on);
    }
    sel.value = listById(p.list) ? p.list : (p.newList ? NEW : activeList().id);
    form.appendChild(sel);
    var ul = document.createElement("ul");
    ul.className = "add-items";
    var boxes = [];
    p.items.forEach(function (it) {
      var li = document.createElement("li");
      var l2 = document.createElement("label");
      l2.className = "add-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      var sp = document.createElement("span");
      sp.className = "add-text";
      sp.textContent = it.text;
      var dup = document.createElement("small");
      dup.className = "add-dup";
      l2.appendChild(cb); l2.appendChild(sp); l2.appendChild(dup);
      if (it.note) {
        var nt = document.createElement("small");
        nt.className = "add-note";
        nt.textContent = it.note;
        l2.appendChild(nt);
      }
      li.appendChild(l2);
      ul.appendChild(li);
      boxes.push({ it: it, cb: cb, dup: dup });
      cb.addEventListener("change", count);
    });
    form.appendChild(ul);
    var menu = document.createElement("menu");
    var no = document.createElement("button");
    no.type = "button"; no.className = "danger"; no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    var sp2 = document.createElement("span");
    sp2.className = "spacer";
    var go = document.createElement("button");
    go.type = "submit";
    menu.appendChild(no); menu.appendChild(sp2); menu.appendChild(go);
    form.appendChild(menu);
    // Duplicates follow the chosen list; a tick the user changed stays.
    function markDups() {
      var have = sel.value === NEW ? {} : openKeysOf(listById(sel.value));
      boxes.forEach(function (b) {
        var d = !!have[normalize(b.it.text)];
        b.dup.textContent = d ? addT("dup") : "";
        if (!b.touched) b.cb.checked = !d;
      });
      count();
    }
    function count() {
      var n = boxes.filter(function (b) { return b.cb.checked; }).length;
      go.textContent = addT("add.go", { n: n });
      go.disabled = !n;
    }
    boxes.forEach(function (b) { b.cb.addEventListener("change", function () { b.touched = true; }); });
    sel.addEventListener("change", markDups);
    markDups();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pick = boxes.filter(function (b) { return b.cb.checked; });
      if (!pick.length) { showToast(addT("add.none"), false); return; }
      var list = sel.value === NEW ? null : listById(sel.value);
      if (!list) {                  // a new list, or the list was deleted by a sync meanwhile
        list = freshList(p.newList || t("new.list"));
        list.pos = state.lists.length;
        state.lists.push(list);
        state.om = Date.now();
      }
      var now = Date.now();
      pick.slice().reverse().forEach(function (b) {
        var item = newItemObj(b.it.text, null);
        item.notes = b.it.note;
        stampItemNewest(item, now);
        list.items.unshift(item);
      });
      list.items.forEach(function (it, i) { it.pos = i; });
      list.om = now;
      setActiveList(list.id);
      searchQuery = "";
      activeFilters = [];
      dlg.close();
      save(); renderAll();
      showToast(addT("added", { n: pick.length, list: list.name }), false);
    });
    dlg.appendChild(form);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { go.focus(); }, 50);
  }

  // { now: true } (the Quick window, one task): the Enter in the bar is
  // the confirmation, so the task goes in at once, top of the chosen
  // list (else the open list), with Undo. Already open there → only a
  // note, nothing written.
  function addItemNow(p) {
    var it = p.items[0], list = listById(p.list) || activeList();
    if (!list) return;
    if (openKeysOf(list)[normalize(it.text)]) {
      showToast(it.text + " · " + addT("dup"), false);
      setActiveList(list.id); renderAll();
      return;
    }
    var now = Date.now(), item = newItemObj(it.text, null);
    item.notes = it.note;
    stampItemNewest(item, now);
    list.items.unshift(item);
    list.items.forEach(function (x, i) { x.pos = i; });
    list.om = now;
    setActiveList(list.id);
    searchQuery = "";
    activeFilters = [];
    save(); renderAll();
    undoSnapshot = null;
    undoFn = function () {
      var hit = findItem(item.id);
      if (!hit) return;
      tombstone(item.id);
      hit.list.items.splice(hit.list.items.indexOf(hit.item), 1);
      hit.list.items.forEach(function (x, i) { x.pos = i; });
      hit.list.om = Date.now();
      save(); renderAll();
    };
    undoViewList = view.activeList;
    showToast(addT("added", { n: 1, list: list.name }), true);
  }

  // Another window of this orOS (the Quick window, a second tab, a
  // single app) wrote the tasks: merge them in, so this window's next
  // save never drops what the other one added (SY-W1).
  window.addEventListener("storage", function (e) {
    if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastSaved) return;
    var other;
    try { other = migrate(JSON.parse(e.newValue)); } catch (err) { return; }
    if (!other || !Array.isArray(other.lists) || !other.lists.length) return;
    sliceSet(mergeTodoStates(sliceGet(), other), { merged: true });
  });

  wire();
  registerSync();
  tdBoot();
  inheritPalette();
  watchPalette();

  // Midnight rollover (audit #20): cycles + overdue chips must catch
  // up when the app stays open across the date change. applyListCycles
  // self-saves ONLY when it actually resets something — no pointless
  // dirty/sync push on a no-op wake. scheduleRender refreshes the
  // overdue chips either way.
  var cycleDay = todayISO();
  window.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (todayISO() === cycleDay) return;
    cycleDay = todayISO();
    applyListCycles();
    scheduleRender();
  });

  renderAll();

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { list, item? }. Shows the list; with an item, opens its
  // dialog. Unknown ids, or a dialog already open → no-op.
  function openSearchTarget(t) {
    if (t && t.addItems) { openAddItems(t.addItems); return; }   // section 13
    // "Open with" an .orostasks file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (t && t.openFile) { if (recFile) recFile.openTarget(t.openFile); return; }
    if (t && t.quickAdd) {                // the phone's home-screen widget: "+ Task"
      if (document.querySelector("dialog[open]")) return;
      var qa = $("quick-add");
      if (qa) { qa.scrollIntoView({ block: "nearest" }); qa.focus(); }
      return;
    }
    if (t && t.done) { doneFromToday(t.done); return; }
    if (t && typeof t.list === "string" && isShared(t.list) && !listById(t.list)) { hhWant = t; hhRefresh(); return; }
    if (!t || typeof t.list !== "string" || !listById(t.list)) return;
    // A dialog in progress (maybe with unsaved edits) wins: no jump.
    if (document.querySelector("dialog[open]")) return;
    setActiveList(t.list);
    renderAll();
    if (typeof t.item === "string" && itemById(listById(t.list), t.item)) {
      openItemDialog(t.list, t.item);
    }
  }
  // "Done" from the Today summary: { done: { list, item } } ticks the
  // task with the checkbox's own setDone and shows its list (untick
  // to take it back). Gone or already done → a note, nothing written.
  function doneFromToday(d) {
    if (!d || typeof d.list !== "string" || typeof d.item !== "string") return;
    if (document.querySelector("dialog[open]")) return;
    var list = listById(d.list), item = list ? itemById(list, d.item) : null;
    if (!item) { showToast(t("toast.gone"), false); return; }
    setActiveList(list.id);
    renderAll();
    if (item.done) { showToast(t("toast.already"), false); return; }
    setDone(item, true);
    showToast(t("toast.ticked").replace("{t}", item.text || ""), false);
  }
  window.__orosOpenAt = openSearchTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("todo");
      if (pendingTarget) openSearchTarget(pendingTarget);
    }
  } catch (e) {}
})();


// ===== orOS deep-link receiver (Wave 7 / #TD4) =====
// Consumed by shell.js (__orosOpenTodo) and notifications.js
// (DL_BRIDGES → "todo:<listId>"). Depends ONLY on the DOM contract
// of renderTabs (#tabs .tab[data-list-id] click switching) — no
// internals of the main IIFE are touched.
(function () {
  "use strict";

  function openList(listId) {
    var btn = document.querySelector('#tabs .tab[data-list-id="' + listId + '"]');
    if (btn) btn.click();   // existing tab wiring switches the active list
  }

  // Live push (shell bridge calls this when the app is running)
  window.__orosTodoOpen = function (listId) {
    if (typeof listId !== "string" || !listId) return;
    openList(listId);
  };

  // Boot: consume a list staged by the shell while the app was
  // closed (sessionStorage — same origin, one-shot).
  try {
    var pending = sessionStorage.getItem("oros-todo-open");
    if (pending) {
      sessionStorage.removeItem("oros-todo-open");
      openList(pending);
    }
  } catch (e) { /* storage blocked — navigation no-ops, nothing breaks */ }
})();