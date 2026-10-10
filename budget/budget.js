// ============================================================
// orOS Budget — App logic (v1.0.0)
// Income and expenses: a month at a time, categories, monthly
// limits, recurring entries, charts and export.
//   - amounts are integer cents (no rounding drift in totals)
//   - ready categories with language-free ids; your own on top
//   - monthly limits per expense category + an overall limit,
//     one orOS notification when a limit is passed
//   - recurring entries (weekly / monthly / yearly) become real
//     entries on their day, with a fixed id per occurrence, so
//     two devices that both create one create the SAME one
//   - charts: expenses by category (donut + ranked list),
//     income vs expenses over 12 months, balance over 12 months
//   - export: CSV, Excel (.xlsx), PDF report, JSON backup;
//     restore = merge (never overwrites)
// Data:
//   - synced slice "budget" (oros-budget-data): entries, own
//     categories, limits, recurring entries LWW per id +
//     tombstones; settings LWW (R5, R17, R26, R27)
//   - device-local (R10): oros-budget-prefs (tab, CSV format)
// Sections:
//   1. Constants, i18n, helpers
//   2. Money + dates
//   3. Model: ready categories, normalize, merge
//   4. Derived: categories, totals, limits, recurring
//   5. CSV
//   6. Storage, prefs
//   7. Rendering: toolbar, summary, list, limits, recurring
//   8. Charts
//   9. Dialogs: entry, recurring, categories, limit, currency
//  10. Export: CSV, Excel, PDF, JSON backup + restore
//  11. Toasts, menu, keyboard
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-budget-data";
  var PREFS_KEY   = "oros-budget-prefs";
  var DATA_VER    = 1;
  var NOTE_LEN    = 140;
  var NAME_LEN    = 30;
  var MAX_CENTS   = 100000000000;      // 1 billion in whole units
  var MAX_CATS    = 60;
  var MAX_REC     = 100;
  var MAX_ACC     = 20;
  var REC_BACK_DAYS = 730;             // recurring entries are back-filled at most 2 years
  var COLOR_SLOTS = 9;                 // 0–7 chart palette, 8 = neutral grey
  var CURRENCIES  = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                     "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app": "Budget",
      "tab.list": "Entries", "tab.charts": "Charts", "tab.limits": "Limits", "tab.rec": "Recurring",
      "sum.in": "Income", "sum.out": "Expenses", "sum.bal": "Balance",
      "btn.add": "New", "btn.add.aria": "New entry (N)", "btn.prev": "Previous month", "btn.next": "Next month",
      "btn.menu": "More", "btn.today": "This month",
      "menu.cats": "Categories", "menu.export": "Export", "menu.backup": "Backup (JSON)",
      "menu.restore": "Restore from backup", "menu.currency": "Currency",
      "q.ph": "Search all entries…", "flt.all": "All entries", "flt.out": "Expenses only", "flt.in": "Income only",
      "list.empty": "No entries this month. Tap “New” to add one.", "list.none": "Nothing matches.",
      "list.found": "{n} found", "day.total": "Day total",
      "k.out": "Expense", "k.in": "Income",
      "cat.none": "Uncategorized", "cat.other": "Other",
      "dlg.new": "New entry", "f.from": "From {app}", "dlg.edit": "Edit entry", "f.amount": "Amount", "f.date": "Date",
      "f.cat": "Category", "f.note": "Note", "f.note.ph": "Optional",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.delete": "Delete", "dlg.close": "Close",
      "err.amount": "Type an amount, for example 12,50", "err.date": "Pick a date",
      "rec.tag": "Recurring",
      "toast.saved": "Saved", "toast.deleted": "Entry deleted", "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full",
      "toast.recMade": "{n} recurring entries added",
      "lim.total": "All expenses", "lim.set": "Set limit", "lim.edit": "Change",
      "lim.of": "{a} of {b}", "lim.left": "{a} left", "lim.over": "Over by {a}",
      "lim.warn": "Close to the limit", "lim.overLbl": "Over the limit",
      "lim.nolimit": "Without a limit", "lim.hint": "Monthly limits apply to every month.",
      "lim.dlg": "Monthly limit", "lim.clear": "Remove limit", "lim.none": "No expense categories.",
      "notif.over": "Over budget: {c}", "notif.overBody": "{a} spent of {b} · {m}",
      "notif.rec": "Recurring entries", "notif.recBody": "{n} new entries were added",
      "rec.empty": "Rent, salary, subscriptions: add them once and they appear on their day.",
      "rec.new": "New recurring entry", "rec.edit": "Edit recurring entry",
      "rec.freq": "Repeats", "rec.f.m": "Every month", "rec.f.w": "Every week", "rec.f.y": "Every year",
      "rec.start": "First date", "rec.end": "Last date (optional)",
      "rec.every.m": "Every month on the {d}", "rec.every.w": "Every {d}", "rec.every.y": "Every year on {d}",
      "rec.next": "Next: {d}", "rec.ended": "Ended", "rec.deleted": "Recurring entry deleted",
      "rec.keep": "Entries already added stay.", "rec.full": "Up to {n} recurring entries", "rec.gone": "This recurring entry was deleted",
      "err.end": "The last date is before the first",
      "cats.title": "Categories", "cats.out": "Expenses", "cats.in": "Income",
      "cats.add": "New category…", "cats.color": "Colour of {c}", "cats.del": "Delete {c}",
      "cats.name": "Name of {c}", "cats.deleted": "Category deleted", "cats.full": "Up to {n} categories",
      "cats.needName": "Give the category a name", "cats.hint": "Entries of a deleted category show as “Uncategorized”.",
      "ch.donut": "Expenses by category", "ch.bars": "Income and expenses, 12 months",
      "ch.line": "Balance at the end of each month", "ch.table": "Show as a table",
      "ch.none": "No expenses this month.", "ch.total": "total",
      "ch.month": "Month", "ch.cat": "Category", "ch.share": "Share", "ch.balance": "Balance",
      "ch.open": "Open {m}", "ch.filter": "Show {c} entries",
      "exp.title": "Export", "exp.period": "Period", "exp.month": "This month ({m})", "exp.year": "This year ({y})",
      "exp.all": "Everything", "exp.csvfmt": "CSV for", "exp.csv.excel": "Greek Excel (; and 12,50)",
      "exp.csv.std": "Other apps, orOS Spreadsheet (, and 12.50)",
      "exp.csv": "CSV", "exp.xlsx": "Excel", "exp.pdf": "PDF report", "exp.done": "Exported",
      "exp.empty": "Nothing to export in this period",
      "exp.lib": "Library not found (vendor/{f})", "exp.font": "Greek font not found: Greek text may not show in the PDF",
      "exp.hint": "The orOS Spreadsheet opens the Excel file and the “other apps” CSV.",
      "col.date": "Date", "col.type": "Type", "col.cat": "Category", "col.amount": "Amount",
      "col.cur": "Currency", "col.note": "Note", "col.total": "Total", "sheet.tx": "Entries", "sheet.sum": "Summary",
      "pdf.title": "Budget report", "pdf.gen": "Created {d}", "pdf.bycat": "Expenses by category",
      "pdf.incat": "Income by category", "pdf.list": "Entries", "pdf.page": "Page {n}",
      "bk.done": "Backup saved", "bk.restored": "Backup merged: {n} new or newer items",
      "bk.same": "Backup merged: nothing new", "bk.bad": "This is not an orOS Budget backup",
      "cur.title": "Currency", "cur.hint": "One currency for every entry. Changing it does not convert amounts.",
      "live.month": "{m}", "live.saved": "Saved",
      "menu.accounts": "Accounts", "acc.title": "Accounts", "acc.new": "New account", "acc.edit": "Edit account",
      "acc.name": "Name", "acc.name.ph": "Cash, Card, Bank…", "acc.open": "Starting balance",
      "acc.open.hint": "What it held before your first entry here. A minus sign for a debt.",
      "acc.hint": "Pick an account in an entry to keep its balance. Entries without an account still count in the totals.",
      "acc.empty": "No accounts yet: Budget works without them too.", "acc.none": "No account",
      "acc.bal": "Balances today", "acc.deleted": "Account deleted", "acc.full": "Up to {n} accounts",
      "acc.keep": "Its entries stay, without an account.", "acc.open.aria": "Open the accounts",
      "f.acc": "Account", "err.name": "Write a name", "err.open": "Type a balance, for example -120,50",
      "xf.btn": "Transfer", "xf.new": "Transfer between accounts", "xf.edit": "Edit transfer",
      "xf.from": "From", "xf.to": "To", "xf.need": "Make two accounts first", "xf.deleted": "Transfer deleted",
      "err.same": "Pick two different accounts", "flt.xfer": "Transfers only", "flt.accs": "Accounts",
      "xf.aria": "Transfer {a} from {f} to {t}, {d}", "col.acc": "Account",
      "exp.sheet": "Open in Spreadsheet", "exp.sheetCap": "Only the first {n} entries fit in one sheet"
    },
    el: {
      "app": "Έσοδα & Έξοδα",
      "tab.list": "Κινήσεις", "tab.charts": "Γραφήματα", "tab.limits": "Όρια", "tab.rec": "Πάγια",
      "sum.in": "Έσοδα", "sum.out": "Έξοδα", "sum.bal": "Υπόλοιπο",
      "btn.add": "Νέα", "btn.add.aria": "Νέα κίνηση (N)", "btn.prev": "Προηγούμενος μήνας", "btn.next": "Επόμενος μήνας",
      "btn.menu": "Περισσότερα", "btn.today": "Τρέχων μήνας",
      "menu.cats": "Κατηγορίες", "menu.export": "Εξαγωγή", "menu.backup": "Αντίγραφο ασφαλείας (JSON)",
      "menu.restore": "Επαναφορά από αντίγραφο", "menu.currency": "Νόμισμα",
      "q.ph": "Αναζήτηση σε όλες τις κινήσεις…", "flt.all": "Όλες οι κινήσεις", "flt.out": "Μόνο έξοδα", "flt.in": "Μόνο έσοδα",
      "list.empty": "Καμία κίνηση αυτόν τον μήνα. Πάτα «Νέα» για να προσθέσεις.", "list.none": "Δεν βρέθηκε τίποτα.",
      "list.found": "Βρέθηκαν {n}", "day.total": "Σύνολο ημέρας",
      "k.out": "Έξοδο", "k.in": "Έσοδο",
      "cat.none": "Χωρίς κατηγορία", "cat.other": "Υπόλοιπες",
      "dlg.new": "Νέα κίνηση", "f.from": "Από: {app}", "dlg.edit": "Επεξεργασία κίνησης", "f.amount": "Ποσό", "f.date": "Ημερομηνία",
      "f.cat": "Κατηγορία", "f.note": "Σημείωση", "f.note.ph": "Προαιρετικά",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.delete": "Διαγραφή", "dlg.close": "Κλείσιμο",
      "err.amount": "Γράψε ένα ποσό, π.χ. 12,50", "err.date": "Διάλεξε ημερομηνία",
      "rec.tag": "Πάγιο",
      "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Η κίνηση διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.recMade": "Προστέθηκαν {n} πάγιες κινήσεις",
      "lim.total": "Όλα τα έξοδα", "lim.set": "Ορισμός ορίου", "lim.edit": "Αλλαγή",
      "lim.of": "{a} από {b}", "lim.left": "Απομένουν {a}", "lim.over": "Πάνω κατά {a}",
      "lim.warn": "Κοντά στο όριο", "lim.overLbl": "Πάνω από το όριο",
      "lim.nolimit": "Χωρίς όριο", "lim.hint": "Τα μηνιαία όρια ισχύουν για κάθε μήνα.",
      "lim.dlg": "Μηνιαίο όριο", "lim.clear": "Αφαίρεση ορίου", "lim.none": "Δεν υπάρχουν κατηγορίες εξόδων.",
      "notif.over": "Πέρασες το όριο: {c}", "notif.overBody": "{a} από όριο {b} · {m}",
      "notif.rec": "Πάγιες κινήσεις", "notif.recBody": "Προστέθηκαν {n} νέες κινήσεις",
      "rec.empty": "Ενοίκιο, μισθός, συνδρομές: τα βάζεις μία φορά και εμφανίζονται μόνα τους την ημέρα τους.",
      "rec.new": "Νέο πάγιο", "rec.edit": "Επεξεργασία παγίου",
      "rec.freq": "Επανάληψη", "rec.f.m": "Κάθε μήνα", "rec.f.w": "Κάθε εβδομάδα", "rec.f.y": "Κάθε χρόνο",
      "rec.start": "Πρώτη ημερομηνία", "rec.end": "Τελευταία ημερομηνία (προαιρετικά)",
      "rec.every.m": "Κάθε μήνα στις {d}", "rec.every.w": "Κάθε {d}", "rec.every.y": "Κάθε χρόνο στις {d}",
      "rec.next": "Επόμενη: {d}", "rec.ended": "Έληξε", "rec.deleted": "Το πάγιο διαγράφηκε",
      "rec.keep": "Οι κινήσεις που μπήκαν ήδη μένουν.", "rec.full": "Έως {n} πάγια", "rec.gone": "Αυτό το πάγιο διαγράφηκε",
      "err.end": "Η τελευταία ημερομηνία είναι πριν από την πρώτη",
      "cats.title": "Κατηγορίες", "cats.out": "Έξοδα", "cats.in": "Έσοδα",
      "cats.add": "Νέα κατηγορία…", "cats.color": "Χρώμα: {c}", "cats.del": "Διαγραφή: {c}",
      "cats.name": "Όνομα: {c}", "cats.deleted": "Η κατηγορία διαγράφηκε", "cats.full": "Έως {n} κατηγορίες",
      "cats.needName": "Δώσε ένα όνομα στην κατηγορία", "cats.hint": "Οι κινήσεις μιας κατηγορίας που σβήνεται εμφανίζονται «Χωρίς κατηγορία».",
      "ch.donut": "Έξοδα ανά κατηγορία", "ch.bars": "Έσοδα και έξοδα, 12 μήνες",
      "ch.line": "Υπόλοιπο στο τέλος κάθε μήνα", "ch.table": "Προβολή ως πίνακας",
      "ch.none": "Κανένα έξοδο αυτόν τον μήνα.", "ch.total": "σύνολο",
      "ch.month": "Μήνας", "ch.cat": "Κατηγορία", "ch.share": "Μερίδιο", "ch.balance": "Υπόλοιπο",
      "ch.open": "Άνοιγμα: {m}", "ch.filter": "Κινήσεις: {c}",
      "exp.title": "Εξαγωγή", "exp.period": "Περίοδος", "exp.month": "Αυτός ο μήνας ({m})", "exp.year": "Αυτό το έτος ({y})",
      "exp.all": "Όλα", "exp.csvfmt": "CSV για", "exp.csv.excel": "Ελληνικό Excel (; και 12,50)",
      "exp.csv.std": "Άλλες εφαρμογές, Υπολογιστικό φύλλο orOS (, και 12.50)",
      "exp.csv": "CSV", "exp.xlsx": "Excel", "exp.pdf": "Αναφορά PDF", "exp.done": "Η εξαγωγή έγινε",
      "exp.empty": "Δεν υπάρχει τίποτα για εξαγωγή σε αυτή την περίοδο",
      "exp.lib": "Δεν βρέθηκε η βιβλιοθήκη (vendor/{f})", "exp.font": "Δεν βρέθηκε η ελληνική γραμματοσειρά: τα ελληνικά μπορεί να μη φανούν στο PDF",
      "exp.hint": "Το Υπολογιστικό φύλλο του orOS ανοίγει το αρχείο Excel και το CSV «άλλες εφαρμογές».",
      "col.date": "Ημερομηνία", "col.type": "Τύπος", "col.cat": "Κατηγορία", "col.amount": "Ποσό",
      "col.cur": "Νόμισμα", "col.note": "Σημείωση", "col.total": "Σύνολο", "sheet.tx": "Κινήσεις", "sheet.sum": "Σύνοψη",
      "pdf.title": "Αναφορά εσόδων και εξόδων", "pdf.gen": "Δημιουργήθηκε {d}", "pdf.bycat": "Έξοδα ανά κατηγορία",
      "pdf.incat": "Έσοδα ανά κατηγορία", "pdf.list": "Κινήσεις", "pdf.page": "Σελίδα {n}",
      "bk.done": "Το αντίγραφο αποθηκεύτηκε", "bk.restored": "Το αντίγραφο ενώθηκε: {n} νέα ή νεότερα στοιχεία",
      "bk.same": "Το αντίγραφο ενώθηκε: τίποτα καινούργιο", "bk.bad": "Αυτό δεν είναι αντίγραφο των Εσόδων & Εξόδων του orOS",
      "cur.title": "Νόμισμα", "cur.hint": "Ένα νόμισμα για όλες τις κινήσεις. Η αλλαγή του δεν μετατρέπει τα ποσά.",
      "live.month": "{m}", "live.saved": "Αποθηκεύτηκε",
      "menu.accounts": "Λογαριασμοί", "acc.title": "Λογαριασμοί", "acc.new": "Νέος λογαριασμός", "acc.edit": "Επεξεργασία λογαριασμού",
      "acc.name": "Όνομα", "acc.name.ph": "Μετρητά, Κάρτα, Τράπεζα…", "acc.open": "Αρχικό υπόλοιπο",
      "acc.open.hint": "Όσα είχε πριν από την πρώτη κίνησή του εδώ. Με μείον για χρέος.",
      "acc.hint": "Διάλεξε λογαριασμό σε μια κίνηση για να κρατάς το υπόλοιπό του. Οι κινήσεις χωρίς λογαριασμό μετρούν κανονικά στα σύνολα.",
      "acc.empty": "Δεν υπάρχουν λογαριασμοί: η εφαρμογή δουλεύει και χωρίς αυτούς.", "acc.none": "Χωρίς λογαριασμό",
      "acc.bal": "Υπόλοιπα σήμερα", "acc.deleted": "Ο λογαριασμός διαγράφηκε", "acc.full": "Έως {n} λογαριασμοί",
      "acc.keep": "Οι κινήσεις του μένουν, χωρίς λογαριασμό.", "acc.open.aria": "Άνοιγμα λογαριασμών",
      "f.acc": "Λογαριασμός", "err.name": "Γράψε ένα όνομα", "err.open": "Γράψε ένα ποσό, για παράδειγμα -120,50",
      "xf.btn": "Μεταφορά", "xf.new": "Μεταφορά μεταξύ λογαριασμών", "xf.edit": "Επεξεργασία μεταφοράς",
      "xf.from": "Από", "xf.to": "Προς", "xf.need": "Φτιάξε πρώτα δύο λογαριασμούς", "xf.deleted": "Η μεταφορά διαγράφηκε",
      "err.same": "Διάλεξε δύο διαφορετικούς λογαριασμούς", "flt.xfer": "Μόνο μεταφορές", "flt.accs": "Λογαριασμοί",
      "xf.aria": "Μεταφορά {a} από {f} προς {t}, {d}", "col.acc": "Λογαριασμός",
      "exp.sheet": "Άνοιγμα στα Λογιστικά φύλλα", "exp.sheetCap": "Χωρούν μόνο οι πρώτες {n} κινήσεις σε ένα φύλλο"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  var MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August",
         "September", "October", "November", "December"],
    el: ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος",
         "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"]
  };
  var MONTHS_GEN = {   // "8 October" / «8 Οκτωβρίου»
    en: MONTHS.en,
    el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου",
         "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"]
  };
  var MONTHS_SHORT = {
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    el: ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"]
  };
  var WEEKDAYS = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
  };
  var WEEKDAYS_ACC = {   // "every Monday" / «κάθε Δευτέρα»
    en: WEEKDAYS.en,
    el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
  };

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function newId() {
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + (r[0] % 46656).toString(36);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("budget.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Money + dates ----------
  // Typed amount → integer cents, or null. Accepts "12,50", "12.50",
  // "1.234,50", "1,234.50", "1 234", "€ 12". A single separator with
  // exactly three digits after it is a thousands separator ("1.250"
  // = 1250); with one or two it is the decimal point.
  function parseAmount(s) {
    if (typeof s !== "string") return null;
    s = s.replace(/[\s  '’€$£¥]/g, "").replace(/^\+/, "");
    if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
    var dot = s.lastIndexOf("."), com = s.lastIndexOf(",");
    var intPart, decPart = "";
    if (dot >= 0 && com >= 0) {
      var dec = Math.max(dot, com), thou = dec === dot ? "," : ".";
      intPart = s.slice(0, dec);
      decPart = s.slice(dec + 1);
      if (intPart.indexOf(s.charAt(dec)) >= 0) return null;
      if (!thousandsOk(intPart, thou)) return null;
      intPart = intPart.split(thou).join("");
    } else if (dot >= 0 || com >= 0) {
      var ch = dot >= 0 ? "." : ",";
      var parts = s.split(ch);
      if (parts.length === 2 && parts[1].length !== 3) {
        intPart = parts[0];
        decPart = parts[1];
      } else {
        if (!thousandsOk(s, ch)) return null;
        intPart = parts.join("");
      }
    } else {
      intPart = s;
    }
    if (decPart.length > 2 || !/^[0-9]*$/.test(decPart) || !/^[0-9]*$/.test(intPart)) return null;
    if (!intPart && !decPart) return null;
    var cents = Number(intPart || "0") * 100 + Number((decPart + "00").slice(0, 2));
    if (!isInt(cents) || cents <= 0 || cents > MAX_CENTS) return null;
    return cents;
  }
  function thousandsOk(s, ch) {
    var g = s.split(ch);
    if (!g[0] || g[0].length > 3) return false;
    for (var i = 1; i < g.length; i++) if (g[i].length !== 3) return false;
    return true;
  }
  // Cents → plain input text in the user's language ("12,50" / "12.50").
  function centsToInput(c, lang) {
    var s = (Math.floor(c / 100)) + (c % 100 ? (lang === "el" ? "," : ".") + pad2(c % 100) : "");
    return s;
  }
  // Cents → "12.50" / "12,50" for CSV (no thousands separators).
  function centsPlain(c, decSep) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? "-" : "") + Math.floor(a / 100) + decSep + pad2(a % 100);
  }

  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m: 1–12
  function parseYmd(s) {
    var x = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!x) return null;
    var y = +x[1], m = +x[2], d = +x[3];
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  function ymdOf(y, m, d) { return y + "-" + pad2(m) + "-" + pad2(d); }
  function ymdLocal(date) { return ymdOf(date.getFullYear(), date.getMonth() + 1, date.getDate()); }
  function utcMs(ymd) { var p = parseYmd(ymd); return Date.UTC(p.y, p.m - 1, p.d); }
  function ymdUTC(ms) { var x = new Date(ms); return ymdOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }
  function addDays(ymd, n) { return ymdUTC(utcMs(ymd) + n * 86400000); }
  function weekday(ymd) { return new Date(utcMs(ymd)).getUTCDay(); }
  // Month keys "YYYY-MM"
  function mkOf(ymd) { return ymd.slice(0, 7); }
  function mkAdd(mk, n) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + pad2(m + 1);
  }

  // Occurrences of a recurring entry between `from` and `to`
  // (inclusive, "YYYY-MM-DD"), oldest first. Monthly and yearly
  // keep the day of the first date, clamped to the month's last day
  // (31 → 30 / 28; 29 February → 28 in other years).
  function occurrences(rec, from, to) {
    var out = [], s = parseYmd(rec.s);
    if (!s) return out;
    var end = rec.e && rec.e < to ? rec.e : to;
    if (from < rec.s) from = rec.s;
    if (from > end) return out;
    var guard = 0;
    if (rec.f === "w") {
      var t0 = utcMs(rec.s), k = Math.max(0, Math.floor((utcMs(from) - t0) / 604800000));
      for (; guard < 2000; k++, guard++) {
        var y = ymdUTC(t0 + k * 604800000);
        if (y > end) break;
        if (y >= from) out.push(y);
      }
    } else if (rec.f === "y") {
      for (var yy = +from.slice(0, 4); guard < 300; yy++, guard++) {
        var oy = ymdOf(yy, s.m, Math.min(s.d, daysIn(yy, s.m)));
        if (oy > end) break;
        if (oy >= from) out.push(oy);
      }
    } else {
      var mk = mkOf(from);
      for (; guard < 3000; mk = mkAdd(mk, 1), guard++) {
        var Y = +mk.slice(0, 4), M = +mk.slice(5, 7);
        var om = ymdOf(Y, M, Math.min(s.d, daysIn(Y, M)));
        if (om > end) break;
        if (om >= from) out.push(om);
      }
    }
    return out;
  }
  function recTxId(recId, ymd) { return "r" + recId + "-" + ymd.replace(/-/g, ""); }

  // ---------- 3. Model ----------
  // Ready categories: ids and colours are fixed and language-free,
  // names come from SEED_NAMES at render time. They are NOT stored
  // until you change one (a fresh device stores nothing, so an EN
  // and an EL device never disagree about them).
  var SEEDS = [
    { id: "o-groc",   k: "o", col: 0 }, { id: "o-eat",   k: "o", col: 1 },
    { id: "o-bills",  k: "o", col: 2 }, { id: "o-home",  k: "o", col: 3 },
    { id: "o-trans",  k: "o", col: 4 }, { id: "o-health", k: "o", col: 5 },
    { id: "o-fun",    k: "o", col: 6 }, { id: "o-cloth", k: "o", col: 7 },
    { id: "o-gift",   k: "o", col: 4 }, { id: "o-other", k: "o", col: 8 },
    { id: "i-salary", k: "i", col: 2 }, { id: "i-free",  k: "i", col: 0 },
    { id: "i-gift",   k: "i", col: 4 }, { id: "i-other", k: "i", col: 8 }
  ];
  var SEED_NAMES = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home",
          "o-trans": "Transport", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing",
          "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance",
          "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι",
          "o-trans": "Μεταφορές", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα",
          "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα",
          "i-gift": "Δώρα", "i-other": "Άλλα" }
  };
  var SEED_BY_ID = {};
  SEEDS.forEach(function (s) { SEED_BY_ID[s.id] = s; });

  var ID_RE = /^[a-z0-9-]{1,64}$/;
  var KINDS = { o: 1, i: 1 };
  var FREQS = { m: 1, w: 1, y: 1 };

  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function okStamp(m) { return isInt(m) && m >= 0; }
  function okCents(a) { return isInt(a) && a > 0 && a <= MAX_CENTS; }

  // Forward compatibility (Bible: "unknown fields carried forward").
  // A newer Budget may add fields to an item or whole collections; this
  // version keeps them untouched so a sync through an older device
  // never strips them. Only flat, small values travel: short lowercase
  // names, strings ≤ 500, finite numbers, booleans; at most 16 per
  // item, in name order (canonical JSON).
  var XKEY_RE = /^[a-z][a-z0-9]{0,15}$/;
  function okExtra(v) {
    return (typeof v === "string" && v.length <= 500) || (typeof v === "number" && isFinite(v)) || typeof v === "boolean";
  }
  function withExtras(out, x, skip) {
    var keys = Object.keys(x).filter(function (k) {
      return !(k in out) && !(skip && skip[k]) && XKEY_RE.test(k) && okExtra(x[k]);
    }).sort(cmpStr);
    keys.slice(0, 16).forEach(function (k) { out[k] = x[k]; });
    return out;
  }
  // An item of a collection this version does not know: { id, m, … }.
  function normOther(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m)) return null;
    return withExtras({ id: x.id, m: x.m }, x);
  }

  // "Send to Budget" (Bible BR-B1): another app's prefill for the New
  // entry form. A bad kind, amount or date drops it all; the optional
  // parts are cleaned or left empty. It is never stored as such.
  var SRC_RE = /^[a-z0-9]{1,20}$/;
  function normPrefill(p) {
    if (!p || typeof p !== "object" || !KINDS[p.k] || !okCents(p.a)) return null;
    var hasD = p.d !== undefined && p.d !== null && p.d !== "";
    if (hasD && !parseYmd(p.d)) return null;
    return { k: p.k, a: p.a, d: hasD ? p.d : "", n: normText(p.n, NOTE_LEN),
             c: typeof p.c === "string" && ID_RE.test(p.c) ? p.c : "",
             src: typeof p.src === "string" && SRC_RE.test(p.src) ? p.src : "" };
  }

  // Optional account of an entry or a recurring entry: `ac` (account
  // id), written only when set, so entries without one keep the v1 shape.
  var AC_SKIP = { ac: 1 };
  function withAcc(out, x) {
    if (typeof x.ac === "string" && ID_RE.test(x.ac)) out.ac = x.ac;
    return out;
  }

  // entry = { id, m, d, a (cents > 0), k ("o" expense | "i" income), c (category id | ""), n (note), ac? }
  function normTx(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !okStamp(x.m) || !parseYmd(x.d) || !okCents(x.a) || !KINDS[x.k]) return null;
    var c = typeof x.c === "string" && ID_RE.test(x.c) ? x.c : "";
    return withExtras(withAcc({ id: x.id, m: x.m, d: x.d, a: x.a, k: x.k, c: c, n: normText(x.n, NOTE_LEN) }, x), x, AC_SKIP);
  }
  // category = { id, m, k, name ("" = the ready name), col (0–8) }
  function normCat(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !okStamp(x.m) || !KINDS[x.k]) return null;
    var seed = SEED_BY_ID[x.id];
    if (seed && seed.k !== x.k) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name && !seed) return null;
    var col = isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : (seed ? seed.col : 8);
    return withExtras({ id: x.id, m: x.m, k: x.k, name: name, col: col }, x);
  }
  // limit = { id (category id | "all"), m, a (cents; 0 = no limit) }
  function normBud(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !okStamp(x.m) || !isInt(x.a) || x.a < 0 || x.a > MAX_CENTS) return null;
    return withExtras({ id: x.id, m: x.m, a: x.a }, x);
  }
  // recurring = { id, m, k, a, c, n, f ("m" | "w" | "y"), s (first date), e (last date | ""), ac? }
  function normRec(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !/^[a-z0-9]{1,24}$/.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !KINDS[x.k] || !FREQS[x.f] || !parseYmd(x.s)) return null;
    var e = typeof x.e === "string" && parseYmd(x.e) && x.e >= x.s ? x.e : "";
    var c = typeof x.c === "string" && ID_RE.test(x.c) ? x.c : "";
    return withExtras(withAcc({ id: x.id, m: x.m, k: x.k, a: x.a, c: c, n: normText(x.n, NOTE_LEN), f: x.f, s: x.s, e: e }, x), x, AC_SKIP);
  }
  function normSet(x) {
    if (!x || typeof x !== "object" || !okStamp(x.m)) return null;
    return withExtras({ m: x.m, cur: CURRENCIES.indexOf(x.cur) >= 0 ? x.cur : "EUR" }, x);
  }

  // account = { id, m, n (name), o (starting balance in cents, may be
  // negative), col (0–8) }
  function normAcc(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    var o = isInt(x.o) && Math.abs(x.o) <= MAX_CENTS ? x.o : 0;
    var col = isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : 8;
    return withExtras({ id: x.id, m: x.m, n: n, o: o, col: col }, x);
  }
  // transfer between two accounts = { id, m, d, a (cents > 0), f (from), t (to), n }.
  // Not income, not an expense: it only moves money between balances.
  function normXfer(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !okStamp(x.m) || !parseYmd(x.d) || !okCents(x.a) || typeof x.f !== "string" || !ID_RE.test(x.f) ||
        typeof x.t !== "string" || !ID_RE.test(x.t) || x.f === x.t) return null;
    return withExtras({ id: x.id, m: x.m, d: x.d, a: x.a, f: x.f, t: x.t, n: normText(x.n, NOTE_LEN) }, x);
  }

  var COLLS = [
    { key: "tx",   tomb: "tx",  norm: normTx },
    { key: "cats", tomb: "cat", norm: normCat },
    { key: "bud",  tomb: null,  norm: normBud },
    { key: "rec",  tomb: "rec", norm: normRec },
    { key: "acc",  tomb: "acc", norm: normAcc },
    { key: "xfer", tomb: "xfer", norm: normXfer }
  ];
  // Known prefixes tx/cat/rec; a newer version's collection "<key>"
  // uses the tombstone prefix "<key>:" (2–8 lowercase letters).
  var TOMB_RE = /^[a-z]{2,8}:[a-z0-9-]{1,64}$/;
  var KNOWN_TOP = { ver: 1, tx: 1, cats: 1, cat: 1, bud: 1, rec: 1, acc: 1, xfer: 1, set: 1, tombs: 1 };
  var OTHER_RE = /^[a-z]{2,8}$/;

  function emptyData() { return { ver: DATA_VER, tx: [], cats: [], bud: [], rec: [], acc: [], xfer: [], set: { m: 0, cur: "EUR" }, tombs: {} }; }

  function laterOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.m !== a.m) return b.m > a.m ? b : a;
    return JSON.stringify(b) > JSON.stringify(a) ? b : a;
  }

  // Merge: per collection LWW by id (newer m wins; equal m: the larger
  // canonical JSON); tombstones "tx:<id>" etc. max-merged, delete wins
  // ties, a newer edit resurrects (R17). Limits have no tombstones:
  // a = 0 is "no limit" and travels like any value. Settings: later m.
  // Symmetric, idempotent and canonical (R5, R26).
  function mergeBudget(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (k) {
        if (!TOMB_RE.test(k) || !okStamp(tm[k])) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var out = { ver: DATA_VER };
    // Collections of a newer version: same LWW + tombstone "<key>:".
    var seen = {};
    [a, b].forEach(function (side) {
      Object.keys(side).forEach(function (k) {
        if (!KNOWN_TOP[k] && OTHER_RE.test(k) && Array.isArray(side[k])) seen[k] = 1;
      });
    });
    var colls = COLLS.concat(Object.keys(seen).sort(cmpStr).map(function (k) {
      return { key: k, tomb: k, norm: normOther };
    }));
    colls.forEach(function (C) {
      var best = {};
      [a[C.key], b[C.key]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = C.norm(raw);
          if (x) best[x.id] = laterOf(best[x.id], x);
        });
      });
      var arr = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        if (C.tomb) {
          var tk = C.tomb + ":" + id;
          if (tk in tombs && tombs[tk] >= best[id].m) return;
        }
        arr.push(best[id]);
      });
      out[C.key] = arr;
    });
    out.set = laterOf(normSet(a.set), normSet(b.set)) || { m: 0, cur: "EUR" };
    var st = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { st[k] = tombs[k]; });
    out.tombs = st;
    return out;
  }

  // ---------- 4. Derived ----------
  // Every live category: the ready ones (unless deleted), changed by
  // what is stored, then your own, by name. `names` = SEED_NAMES[lang].
  function categoryList(d, names) {
    var stored = {}, out = [];
    d.cats.forEach(function (c) { stored[c.id] = c; });
    SEEDS.forEach(function (s) {
      if (("cat:" + s.id) in d.tombs && !stored[s.id]) return;
      var c = stored[s.id];
      out.push({ id: s.id, k: s.k, col: c ? c.col : s.col,
                 name: (c && c.name) || names[s.id] || s.id, seed: true });
    });
    var own = d.cats.filter(function (c) { return !SEED_BY_ID[c.id]; })
      .map(function (c) { return { id: c.id, k: c.k, col: c.col, name: c.name, seed: false }; });
    own.sort(function (x, y) { return x.name.localeCompare(y.name) || cmpStr(x.id, y.id); });
    return out.concat(own);
  }

  // Totals of the entries whose date starts with `prefix`
  // ("YYYY-MM" for a month, "YYYY" for a year, "" for all).
  function totals(txs, prefix) {
    var r = { inc: 0, out: 0, byCat: {}, n: 0 };
    txs.forEach(function (x) {
      if (prefix && x.d.slice(0, prefix.length) !== prefix) return;
      r.n++;
      if (x.k === "i") r.inc += x.a; else r.out += x.a;
      var key = x.k + ":" + x.c;
      r.byCat[key] = (r.byCat[key] || 0) + x.a;
    });
    return r;
  }
  // Income − expenses per month for `months` (ascending "YYYY-MM"),
  // plus the running balance at the end of each of them (everything
  // before the first month included).
  function monthSeries(txs, months) {
    var idx = {}, rows = months.map(function (mk, i) { idx[mk] = i; return { mk: mk, inc: 0, out: 0, bal: 0 }; });
    var before = 0, first = months[0], last = months[months.length - 1];
    txs.forEach(function (x) {
      var mk = mkOf(x.d), sgn = x.k === "i" ? x.a : -x.a;
      if (mk < first) { before += sgn; return; }
      if (mk > last) return;
      var r = rows[idx[mk]];
      if (x.k === "i") r.inc += x.a; else r.out += x.a;
    });
    var run = before;
    rows.forEach(function (r) { run += r.inc - r.out; r.bal = run; });
    return rows;
  }
  // Limit state: "ok", "warn" (≥ 80 %), "over" (> 100 %).
  function limitState(spent, limit) {
    if (!limit) return "none";
    if (spent > limit) return "over";
    if (spent * 10 >= limit * 8) return "warn";
    return "ok";
  }
  // Recurring entries that are due (up to `today`) and not there yet:
  // a new entry per missing occurrence, never one that exists or was
  // deleted. The id is fixed per occurrence (recTxId) and m is the
  // occurrence's own midnight UTC, so two devices produce the very
  // same entry and a deletion (stamped later) always wins.
  function dueRecurring(d, today) {
    var have = {}, made = [];
    d.tx.forEach(function (x) { have[x.id] = 1; });
    var floor = addDays(today, -REC_BACK_DAYS);
    d.rec.forEach(function (r) {
      if (("rec:" + r.id) in d.tombs) return;
      occurrences(r, floor, today).forEach(function (ymd) {
        var id = recTxId(r.id, ymd);
        if (have[id] || ("tx:" + id) in d.tombs) return;
        have[id] = 1;
        var x = { id: id, m: utcMs(ymd), d: ymd, a: r.a, k: r.k, c: r.c, n: r.n };
        if (r.ac) x.ac = r.ac;
        made.push(x);
      });
    });
    return made;
  }

  // Balance of every account at the end of `upto` ("YYYY-MM-DD"):
  // starting balance, + income − expenses booked to it, ± transfers.
  // Entries of a deleted account count nowhere here. → { id: cents }
  function accBalances(d, upto) {
    var bal = {};
    d.acc.forEach(function (a) { bal[a.id] = a.o; });
    d.tx.forEach(function (x) {
      if (x.ac && bal[x.ac] !== undefined && x.d <= upto) bal[x.ac] += x.k === "i" ? x.a : -x.a;
    });
    d.xfer.forEach(function (x) {
      if (x.d > upto) return;
      if (bal[x.f] !== undefined) bal[x.f] -= x.a;
      if (bal[x.t] !== undefined) bal[x.t] += x.a;
    });
    return bal;
  }
  // "-12,50", "−12.50", "" (= 0) → signed cents | null. For starting balances.
  function parseSigned(s) {
    var v = typeof s === "string" ? s.trim() : "";
    if (!v) return 0;
    var neg = /^[-−]/.test(v);
    if (neg) v = v.slice(1).trim();
    if (/^0+([.,]0*)?$/.test(v)) return 0;
    var c = parseAmount(v);
    return c === null ? null : (neg ? -c : c);
  }

  // ---------- 5. CSV ----------
  // RFC 4180 quoting. A text cell that starts with = + - @ (or a tab /
  // CR) gets a leading apostrophe so a spreadsheet never runs it as a
  // formula (CSV injection). Amounts are numbers and stay as they are.
  function csvCell(v, sep) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // rows: [{ d, k, cat, a, n, acc? }] → CSV text (with a BOM, CRLF); a 7th heading adds the account column.
  // fmt "excel": ";" and "12,50" (Greek Excel); "std": "," and "12.50".
  // Expenses are negative, so a SUM of the column is the balance.
  function buildCsv(rows, fmt, cur, head, kindName) {
    var sep = fmt === "excel" ? ";" : ",", dec = fmt === "excel" ? "," : ".";
    var lines = [head.map(function (h) { return csvCell(h, sep); }).join(sep)];
    rows.forEach(function (r) {
      var cells = [r.d, csvCell(kindName(r.k), sep), csvCell(r.cat, sep),
                   centsPlain(r.k === "i" ? r.a : -r.a, dec), cur, csvCell(r.n, sep)];
      if (head.length > 6) cells.push(csvCell(r.acc || "", sep));   // "Account" column, with accounts only
      lines.push(cells.join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // ---------- 6. Storage, prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.tx)) {
          data = mergeBudget(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] budget: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  // Canonicalize, persist, mark dirty. Callers stamp m themselves (R27).
  function commit() {
    data = mergeBudget(data, data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      tab: ["list", "charts", "limits", "rec"].indexOf(p.tab) >= 0 ? p.tab : "list",
      csv: p.csv === "std" || p.csv === "excel" ? p.csv : (LANG === "el" ? "excel" : "std")
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // Stamp: wall clock, but always past the previous stamp (R27).
  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function tombstone(kind, id) {
    var k = kind + ":" + id;
    data.tombs[k] = Math.max(Date.now(), (data.tombs[k] || 0) + 1);
  }
  function untomb(kind, id) { delete data.tombs[kind + ":" + id]; }

  // ---------- view state (session only, R10) ----------
  var today = ymdLocal(new Date());
  var viewMk = mkOf(today);
  var query = "", filter = "all";

  function cats() { return categoryList(data, SEED_NAMES[LANG] || SEED_NAMES.en); }
  function catById(id) {
    var list = cats();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function catName(id) { var c = id ? catById(id) : null; return c ? c.name : t("cat.none"); }
  function catCol(id) { var c = id ? catById(id) : null; return c ? c.col : 8; }
  function cur() { return data.set.cur || "EUR"; }
  // Accounts, by name.
  function accs() {
    return data.acc.slice().sort(function (x, y) { return x.n.localeCompare(y.n) || cmpStr(x.id, y.id); });
  }
  function accName(id) { var a = id ? findIn(data.acc, id) : null; return a ? a.n : ""; }

  var fmtCache = {};
  function money(cents) {
    var key = cur();
    if (!fmtCache[key]) {
      try { fmtCache[key] = new Intl.NumberFormat(LOCALE, { style: "currency", currency: key }); }
      catch (e) { fmtCache[key] = { format: function (v) { return v.toFixed(2) + " " + key; } }; }
    }
    return fmtCache[key].format(cents / 100);
  }
  var shortFmt = null;
  function moneyShort(cents) {
    if (!shortFmt) {
      try { shortFmt = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }); }
      catch (e) { shortFmt = { format: function (v) { return String(Math.round(v)); } }; }
    }
    return shortFmt.format(cents / 100);
  }
  function monthLabel(mk) { return MONTHS[LANG][+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4); }
  function monthShort(mk) { return MONTHS_SHORT[LANG][+mk.slice(5, 7) - 1]; }
  function dayLabel(ymd) {
    var p = parseYmd(ymd);
    return WEEKDAYS[LANG][weekday(ymd)] + " " + p.d + " " + MONTHS_GEN[LANG][p.m - 1];
  }
  function dateShort(ymd) {   // dd/mm/yyyy (Greek) or dd/mm/yyyy (en-GB)
    var p = parseYmd(ymd);
    return pad2(p.d) + "/" + pad2(p.m) + "/" + p.y;
  }

  // ---------- 7. Rendering ----------
  var UI = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>',
    over: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 16.5h.01"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function swatch(col) {
    var s = el("span", "sw");
    s.style.background = "var(--c" + col + ")";
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  function renderAll() {
    renderToolbar();
    renderTabs();
    renderSummary();
    renderFilter();
    if (prefs.tab === "list") renderList();
    if (prefs.tab === "charts") renderCharts();
    if (prefs.tab === "limits") renderLimits();
    if (prefs.tab === "rec") renderRec();
  }

  function renderToolbar() {
    $("month").textContent = monthLabel(viewMk);
    $("today-btn").hidden = viewMk === mkOf(today);
  }

  function renderTabs() {
    ["list", "charts", "limits", "rec"].forEach(function (k) {
      var b = $("tab-" + k), on = prefs.tab === k;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      $("p-" + k).hidden = !on;
    });
    $("sum").hidden = prefs.tab === "rec";
  }

  function renderSummary() {
    var tt = totals(data.tx, viewMk), bal = tt.inc - tt.out;
    $("sum-in").textContent = money(tt.inc);
    $("sum-out").textContent = money(tt.out);
    var b = $("sum-bal");
    b.textContent = money(bal);
    b.classList.toggle("neg", bal < 0);
    renderAccStrip();
  }
  // Balance of each account today, under the totals (only with accounts).
  function renderAccStrip() {
    var box = $("acc-strip");
    box.innerHTML = "";
    var list = accs();
    box.hidden = !list.length || prefs.tab === "rec";
    if (box.hidden) return;
    var bal = accBalances(data, today);
    var btn = el("button", "acc-chips");
    btn.type = "button";
    btn.setAttribute("aria-label", t("acc.open.aria"));
    btn.title = t("acc.bal");
    list.forEach(function (a) {
      var c = el("span", "acc-chip");
      c.appendChild(swatch(a.col));
      c.appendChild(el("span", "acc-chip-n", a.n));
      var v = el("span", "acc-chip-v" + (bal[a.id] < 0 ? " neg" : ""), money(bal[a.id]));
      c.appendChild(v);
      btn.appendChild(c);
    });
    btn.addEventListener("click", accountsDialog);
    box.appendChild(btn);
  }

  function renderFilter() {
    var sel = $("flt"), prev = filter;
    sel.innerHTML = "";
    var add = function (v, label) { var o = el("option", "", label); o.value = v; sel.appendChild(o); };
    add("all", t("flt.all"));
    add("k:o", t("flt.out"));
    add("k:i", t("flt.in"));
    var g1 = el("optgroup"); g1.label = t("cats.out");
    var g2 = el("optgroup"); g2.label = t("cats.in");
    cats().forEach(function (c) {
      var o = el("option", "", c.name); o.value = "c:" + c.id;
      (c.k === "o" ? g1 : g2).appendChild(o);
    });
    var on = el("option", "", t("cat.none")); on.value = "c:";
    g1.appendChild(on);
    sel.appendChild(g1); sel.appendChild(g2);
    if (data.acc.length || data.xfer.length) {
      var g3 = el("optgroup"); g3.label = t("flt.accs");
      accs().forEach(function (a) { var o = el("option", "", a.n); o.value = "a:" + a.id; g3.appendChild(o); });
      var ox = el("option", "", t("flt.xfer")); ox.value = "k:t"; g3.appendChild(ox);
      sel.appendChild(g3);
    }
    sel.value = prev;
    if (sel.value !== prev) { filter = "all"; sel.value = "all"; }
  }

  function matches(x) {
    if (filter.indexOf("k:") === 0 && x.k !== filter.slice(2)) return false;
    if (filter.indexOf("c:") === 0 && x.c !== filter.slice(2)) return false;
    if (filter.indexOf("a:") === 0 && (x.ac || "") !== filter.slice(2)) return false;
    if (query) {
      var hay = (x.n + " " + catName(x.c) + " " + accName(x.ac) + " " + centsToInput(x.a, LANG)).toLowerCase();
      if (hay.indexOf(query) < 0) return false;
    }
    return true;
  }
  // A transfer shows with "All", "Transfers only" and the filter of either account.
  function xferMatches(x) {
    if (filter !== "all" && filter !== "k:t" && filter !== "a:" + x.f && filter !== "a:" + x.t) return false;
    if (query) {
      var hay = (x.n + " " + accName(x.f) + " " + accName(x.t) + " " + t("xf.btn") + " " + centsToInput(x.a, LANG)).toLowerCase();
      if (hay.indexOf(query) < 0) return false;
    }
    return true;
  }

  function renderList() {
    var box = $("list");
    box.innerHTML = "";
    var rows = data.tx.filter(function (x) {
      return (query || mkOf(x.d) === viewMk) && matches(x);
    }).concat(data.xfer.filter(function (x) {
      return (query || mkOf(x.d) === viewMk) && xferMatches(x);
    }));
    rows.sort(function (a, b) { return cmpStr(b.d, a.d) || b.m - a.m || cmpStr(b.id, a.id); });
    var empty = $("list-empty"), found = $("list-found");
    found.hidden = !query;
    if (query) found.textContent = t("list.found", { n: rows.length });
    empty.hidden = rows.length > 0;
    empty.textContent = (query || filter !== "all") ? t("list.none") : t("list.empty");
    var day = null, group = null, dayIn = 0, dayOut = 0, totEl = null;
    var flushDay = function () {
      if (totEl) totEl.textContent = (dayIn ? "+" + money(dayIn) + "  " : "") + (dayOut ? "−" + money(dayOut) : "");
    };
    rows.forEach(function (x) {
      if (x.d !== day) {
        flushDay();
        day = x.d; dayIn = 0; dayOut = 0;
        var head = el("div", "day-head");
        head.appendChild(el("span", "day-name", dayLabel(x.d) + (query ? " " + x.d.slice(0, 4) : "")));
        totEl = el("span", "day-tot");
        totEl.title = t("day.total");
        head.appendChild(totEl);
        box.appendChild(head);
        group = el("ul", "day-list");
        box.appendChild(group);
      }
      if (!x.k) { group.appendChild(xferRow(x)); return; }   // a transfer: not in the day total
      if (x.k === "i") dayIn += x.a; else dayOut += x.a;
      group.appendChild(txRow(x));
    });
    flushDay();
  }

  function txRow(x) {
    var li = el("li");
    var b = el("button", "tx " + (x.k === "i" ? "in" : "out"));
    b.type = "button";
    b.appendChild(swatch(catCol(x.c)));
    var mid = el("span", "tx-mid");
    mid.appendChild(el("span", "tx-cat", catName(x.c)));
    var an = accName(x.ac);
    var sub = [an, x.n].filter(Boolean).join(" · ");
    if (sub) mid.appendChild(el("span", "tx-note", sub));
    b.appendChild(mid);
    if (x.id.charAt(0) === "r" && /-\d{8}$/.test(x.id)) {
      var r = el("span", "tx-rec");
      r.innerHTML = UI.repeat;
      r.title = t("rec.tag");
      r.setAttribute("aria-label", t("rec.tag"));
      b.appendChild(r);
    }
    b.appendChild(el("span", "tx-amt", (x.k === "i" ? "+" : "−") + money(x.a)));
    b.setAttribute("aria-label", t(x.k === "i" ? "k.in" : "k.out") + ", " + catName(x.c) +
      (an ? ", " + an : "") + (x.n ? ", " + x.n : "") + ", " + money(x.a) + ", " + dateShort(x.d));
    b.addEventListener("click", function () { txDialog(x.id); });
    li.appendChild(b);
    return li;
  }
  function xferRow(x) {
    var li = el("li");
    var b = el("button", "tx xf");
    b.type = "button";
    b.appendChild(swatch(8));
    var mid = el("span", "tx-mid");
    var f = accName(x.f) || t("acc.none"), to = accName(x.t) || t("acc.none");
    mid.appendChild(el("span", "tx-cat", f + " → " + to));
    mid.appendChild(el("span", "tx-note", x.n ? t("xf.btn") + " · " + x.n : t("xf.btn")));
    b.appendChild(mid);
    b.appendChild(el("span", "tx-amt", money(x.a)));
    b.setAttribute("aria-label", t("xf.aria", { a: money(x.a), f: f, t: to, d: dateShort(x.d) }) + (x.n ? ", " + x.n : ""));
    b.addEventListener("click", function () { xferDialog(x.id); });
    li.appendChild(b);
    return li;
  }

  // Limits tab
  function budOf(id) { var b = findIn(data.bud, id); return b ? b.a : 0; }

  function renderLimits() {
    var box = $("limits");
    box.innerHTML = "";
    var tt = totals(data.tx, viewMk);
    box.appendChild(limitRow({ id: "all", name: t("lim.total"), col: null }, tt.out, budOf("all")));
    var withL = [], without = [];
    cats().filter(function (c) { return c.k === "o"; }).forEach(function (c) {
      (budOf(c.id) ? withL : without).push(c);
    });
    withL.forEach(function (c) { box.appendChild(limitRow(c, tt.byCat["o:" + c.id] || 0, budOf(c.id))); });
    if (!withL.length && !without.length) box.appendChild(el("p", "hint", t("lim.none")));
    if (without.length) {
      box.appendChild(el("h2", "sub-h", t("lim.nolimit")));
      var ul = el("ul", "nolim");
      without.forEach(function (c) {
        var li = el("li");
        var spent = tt.byCat["o:" + c.id] || 0;
        li.appendChild(swatch(c.col));
        li.appendChild(el("span", "nl-name", c.name));
        li.appendChild(el("span", "nl-amt", spent ? money(spent) : ""));
        var b = el("button", "mini", t("lim.set"));
        b.type = "button";
        b.setAttribute("aria-label", t("lim.set") + ": " + c.name);
        b.addEventListener("click", function () { limitDialog(c.id, c.name); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
  }

  function limitRow(c, spent, limit) {
    var card = el("div", "lim");
    var head = el("div", "lim-head");
    if (c.col !== null) head.appendChild(swatch(c.col));
    head.appendChild(el("span", "lim-name", c.name));
    var b = el("button", "mini", limit ? t("lim.edit") : t("lim.set"));
    b.type = "button";
    b.setAttribute("aria-label", (limit ? t("lim.edit") : t("lim.set")) + ": " + c.name);
    b.addEventListener("click", function () { limitDialog(c.id, c.name); });
    head.appendChild(b);
    card.appendChild(head);
    if (!limit) {
      card.appendChild(el("div", "lim-sub", money(spent)));
      return card;
    }
    var st = limitState(spent, limit);
    var bar = el("div", "bar " + st);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    var pct = Math.round(spent * 100 / limit);
    bar.setAttribute("aria-valuenow", String(Math.min(pct, 100)));
    bar.setAttribute("aria-label", c.name + ": " + pct + "%");
    var fill = el("span");
    fill.style.width = Math.min(100, spent * 100 / limit) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);
    var sub = el("div", "lim-sub");
    sub.appendChild(el("span", "", t("lim.of", { a: money(spent), b: money(limit) })));
    var right = el("span", "lim-state " + st);
    if (st === "over" || st === "warn") {
      var ic = el("span", "ic");
      ic.innerHTML = st === "over" ? UI.over : UI.warn;
      right.appendChild(ic);
      right.appendChild(el("span", "", st === "over" ? t("lim.overLbl") + " · " + t("lim.over", { a: money(spent - limit) })
                                                     : t("lim.warn") + " · " + t("lim.left", { a: money(limit - spent) })));
    } else {
      right.appendChild(el("span", "", t("lim.left", { a: money(limit - spent) })));
    }
    sub.appendChild(right);
    card.appendChild(sub);
    return card;
  }

  // Recurring tab
  function recWhen(r) {
    var p = parseYmd(r.s);
    if (r.f === "w") return t("rec.every.w", { d: WEEKDAYS_ACC[LANG][weekday(r.s)] });
    if (r.f === "y") return t("rec.every.y", { d: p.d + " " + MONTHS_GEN[LANG][p.m - 1] });
    return t("rec.every.m", { d: p.d });
  }
  function recNext(r) {
    var next = occurrences(r, addDays(today, 1), addDays(today, 400))[0];
    return next ? t("rec.next", { d: dateShort(next) }) : t("rec.ended");
  }

  function renderRec() {
    var box = $("rec");
    box.innerHTML = "";
    $("rec-empty").hidden = data.rec.length > 0;
    var list = data.rec.slice().sort(function (a, b) {
      return cmpStr(a.k, b.k) || b.a - a.a || cmpStr(a.id, b.id);
    });
    list.forEach(function (r) {
      var li = el("li");
      var b = el("button", "tx " + (r.k === "i" ? "in" : "out"));
      b.type = "button";
      b.appendChild(swatch(catCol(r.c)));
      var mid = el("span", "tx-mid");
      mid.appendChild(el("span", "tx-cat", r.n || catName(r.c)));
      mid.appendChild(el("span", "tx-note", recWhen(r) + " · " + recNext(r)));
      b.appendChild(mid);
      b.appendChild(el("span", "tx-amt", (r.k === "i" ? "+" : "−") + money(r.a)));
      b.addEventListener("click", function () { recDialog(r.id); });
      li.appendChild(b);
      box.appendChild(li);
    });
  }

  // ---------- 8. Charts ----------
  // Hand-written SVG, no library. Colours are CSS tokens (--c0…--c8)
  // stepped separately for dark and light (budget.css), so a theme
  // change repaints them with no redraw. Text is always text ink.
  // Every mark has a hit target, a tooltip and a table twin.
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function svText(x, y, text, cls, anchor) {
    var n = sv("text", { x: x, y: y, "class": cls || "ax" });
    if (anchor) n.setAttribute("text-anchor", anchor);
    n.textContent = text;
    return n;
  }
  function niceStep(span) {
    if (span <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(span))), f = span / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  // Interactive mark: tooltip on hover / focus, Enter or click acts.
  function hit(node, tip, onAct) {
    node.setAttribute("class", "hit");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", tip);
    node.addEventListener("pointerenter", function (e) { showTip(tip, e.clientX, e.clientY); });
    node.addEventListener("pointermove", function (e) { showTip(tip, e.clientX, e.clientY); });
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", function () {
      var r = node.getBoundingClientRect();
      showTip(tip, r.left + r.width / 2, r.top);
    });
    node.addEventListener("blur", hideTip);
    if (onAct) {
      node.addEventListener("click", function () { hideTip(); onAct(); });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hideTip(); onAct(); }
      });
    }
  }
  function showTip(text, x, y) {
    var tip = $("tip");
    tip.textContent = text;
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    var top = y - h - 12;
    if (top < 8) top = y + 16;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { $("tip").hidden = true; }

  function tableTwin(head, rows) {
    var det = el("details", "twin");
    det.appendChild(el("summary", "", t("ch.table")));
    var tb = el("table");
    var tr = el("tr");
    head.forEach(function (h, i) { var th = el("th", i ? "num" : "", h); th.scope = "col"; tr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(tr); tb.appendChild(thead);
    var body = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (v, i) { row.appendChild(el(i ? "td" : "th", i ? "num" : "", v)); });
      body.appendChild(row);
    });
    tb.appendChild(body);
    det.appendChild(tb);
    return det;
  }

  function renderCharts() {
    hideTip();
    renderDonut();
    renderBars();
    renderLine();
  }

  // Expenses of the month by category: top 7 + "Other" folded.
  function renderDonut() {
    var box = $("ch-donut");
    box.innerHTML = "";
    var tt = totals(data.tx, viewMk);
    var parts = [];
    Object.keys(tt.byCat).forEach(function (k) {
      if (k.charAt(0) !== "o") return;
      var id = k.slice(2);
      parts.push({ id: id, name: catName(id), col: catCol(id), a: tt.byCat[k] });
    });
    parts.sort(function (a, b) { return b.a - a.a || cmpStr(a.name, b.name); });
    if (!parts.length) { box.appendChild(el("p", "hint", t("ch.none"))); return; }
    if (parts.length > 8) {
      var rest = parts.slice(7), sum = 0;
      rest.forEach(function (p) { sum += p.a; });
      parts = parts.slice(0, 7).concat([{ id: null, name: t("cat.other"), col: 8, a: sum }]);
    }
    var total = tt.out;
    var wrap = el("div", "donut-wrap");
    var S = 180, R = 84, r0 = 54, cx = S / 2, cy = S / 2;
    var svg = sv("svg", { viewBox: "0 0 " + S + " " + S, width: S, height: S, "class": "donut", role: "img",
                         "aria-label": t("ch.donut") + ", " + monthLabel(viewMk) + ": " + money(total) });
    var a0 = -Math.PI / 2;
    parts.forEach(function (p) {
      var frac = p.a / total, a1 = a0 + frac * Math.PI * 2;
      var path;
      if (frac >= 0.9999) {
        path = sv("path", { d: "M" + cx + "," + (cy - R) + " A" + R + "," + R + " 0 1 1 " + (cx - 0.01) + "," + (cy - R) +
          " L" + (cx - 0.01) + "," + (cy - r0) + " A" + r0 + "," + r0 + " 0 1 0 " + cx + "," + (cy - r0) + " Z" });
      } else {
        var big = a1 - a0 > Math.PI ? 1 : 0;
        var p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
        var q1 = [cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1)], q0 = [cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0)];
        path = sv("path", { d: "M" + p0 + " A" + R + "," + R + " 0 " + big + " 1 " + p1 + " L" + q1 +
          " A" + r0 + "," + r0 + " 0 " + big + " 0 " + q0 + " Z" });
      }
      path.setAttribute("style", "fill:var(--c" + p.col + ")");
      path.setAttribute("class", "slice");
      var tip = p.name + ": " + money(p.a) + " (" + Math.round(frac * 100) + "%)";
      var g = sv("g");
      g.appendChild(path);
      hit(g, tip, p.id !== null ? showCat(p.id) : null);
      g.setAttribute("class", "hit slice-g");
      svg.appendChild(g);
      a0 = a1;
    });
    svg.appendChild(svText(cx, cy - 2, money(total), "donut-total", "middle"));
    svg.appendChild(svText(cx, cy + 16, t("ch.total"), "ax", "middle"));
    wrap.appendChild(svg);
    // Ranked list = the legend, with direct values
    var ul = el("ul", "rank");
    parts.forEach(function (p) {
      var li = el("li");
      var b = el(p.id !== null ? "button" : "div", "rank-row");
      if (p.id !== null) {
        b.type = "button";
        b.addEventListener("click", showCat(p.id));
        b.setAttribute("aria-label", t("ch.filter", { c: p.name }) + ", " + money(p.a));
      }
      var top = el("span", "rank-top");
      top.appendChild(swatch(p.col));
      top.appendChild(el("span", "rank-name", p.name));
      top.appendChild(el("span", "rank-amt", money(p.a)));
      top.appendChild(el("span", "rank-pct", Math.round(p.a * 100 / total) + "%"));
      b.appendChild(top);
      var bar = el("span", "rank-bar");
      var f = el("span");
      f.style.width = (p.a * 100 / parts[0].a) + "%";
      f.style.background = "var(--c" + p.col + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      li.appendChild(b);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    box.appendChild(wrap);
  }
  function showCat(id) {
    return function () {
      filter = "c:" + id;
      query = "";
      $("q").value = "";
      setTab("list");
    };
  }

  function last12() {
    var out = [];
    for (var i = 11; i >= 0; i--) out.push(mkAdd(viewMk, -i));
    return out;
  }
  function chartWidth(box) { return Math.max(280, Math.floor(box.clientWidth || 320)); }

  // Income vs expenses, 12 months ending with the month on screen.
  function renderBars() {
    var box = $("ch-bars");
    box.innerHTML = "";
    var rows = monthSeries(data.tx, last12());
    var legend = el("div", "legend");
    [["c0", t("sum.in")], ["c1", t("sum.out")]].forEach(function (x) {
      var s = el("span", "lg");
      var sw = el("span", "sw"); sw.style.background = "var(--" + x[0] + ")"; sw.setAttribute("aria-hidden", "true");
      s.appendChild(sw); s.appendChild(el("span", "", x[1]));
      legend.appendChild(s);
    });
    box.appendChild(legend);
    var W = chartWidth(box), H = 200, L = 46, Rm = 6, T = 10, B = 24;
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.inc, r.out); });
    var step = niceStep((max || 100) / 4), top = Math.max(step, Math.ceil((max || 1) / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var y = function (v) { return T + ph - v / top * ph; };
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart", role: "img",
                         "aria-label": t("ch.bars") });
    for (var v = 0; v <= top + 0.5; v += step) {
      svg.appendChild(sv("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(svText(L - 6, y(v) + 4, moneyShort(v), "ax", "end"));
    }
    var gw = pw / rows.length, bw = Math.max(3, Math.min(14, (gw - 8) / 2));
    var narrow = W < 420;
    rows.forEach(function (r, i) {
      var gx = L + i * gw, cx = gx + gw / 2;
      [[r.inc, 0, cx - bw - 1], [r.out, 1, cx + 1]].forEach(function (b) {
        if (!b[0]) return;
        var h = Math.max(1, ph * b[0] / top), x = b[2], yy = T + ph - h, rr = Math.min(3, bw / 2, h);
        var d = "M" + x + "," + (T + ph) + " V" + (yy + rr) + " Q" + x + "," + yy + " " + (x + rr) + "," + yy +
                " H" + (x + bw - rr) + " Q" + (x + bw) + "," + yy + " " + (x + bw) + "," + (yy + rr) + " V" + (T + ph) + " Z";
        var p = sv("path", { d: d, style: "fill:var(--c" + b[1] + ")" });
        svg.appendChild(p);
      });
      if (!narrow || i % 2 === (rows.length - 1) % 2) {
        var lab = svText(cx, H - 6, monthShort(r.mk), r.mk === viewMk ? "ax cur" : "ax", "middle");
        svg.appendChild(lab);
      }
      var target = sv("rect", { x: gx, y: T, width: gw, height: ph + B, fill: "transparent" });
      hit(target, monthLabel(r.mk) + ": " + t("sum.in") + " " + money(r.inc) + ", " + t("sum.out") + " " + money(r.out),
          r.mk === viewMk ? null : goMonth(r.mk));
      svg.appendChild(target);
    });
    box.appendChild(svg);
    box.appendChild(tableTwin([t("ch.month"), t("sum.in"), t("sum.out")],
      rows.map(function (r) { return [monthLabel(r.mk), money(r.inc), money(r.out)]; })));
  }
  function goMonth(mk) { return function () { setMonth(mk); }; }

  // Running balance at the end of each of the 12 months.
  function renderLine() {
    var box = $("ch-line");
    box.innerHTML = "";
    var rows = monthSeries(data.tx, last12());
    var W = chartWidth(box), H = 180, L = 46, Rm = 10, T = 12, B = 24;
    var lo = 0, hi = 0;
    rows.forEach(function (r) { lo = Math.min(lo, r.bal); hi = Math.max(hi, r.bal); });
    var step = niceStep(((hi - lo) || 100) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.max(lo + step, Math.ceil(hi / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var y = function (v) { return T + ph - (v - lo) / (hi - lo) * ph; };
    var x = function (i) { return L + (i + 0.5) * pw / rows.length; };
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart", role: "img",
                         "aria-label": t("ch.line") });
    for (var v = lo; v <= hi + 0.5; v += step) {
      svg.appendChild(sv("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(svText(L - 6, y(v) + 4, moneyShort(v), "ax", "end"));
    }
    var d = rows.map(function (r, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(r.bal).toFixed(1); }).join(" ");
    svg.appendChild(sv("path", { d: d, "class": "line", style: "stroke:var(--c0)" }));
    var narrow = W < 420;
    rows.forEach(function (r, i) {
      svg.appendChild(sv("circle", { cx: x(i), cy: y(r.bal), r: 4, "class": "dot", style: "fill:var(--c0)" }));
      if (!narrow || i % 2 === (rows.length - 1) % 2) {
        svg.appendChild(svText(x(i), H - 6, monthShort(r.mk), r.mk === viewMk ? "ax cur" : "ax", "middle"));
      }
      var target = sv("rect", { x: L + i * pw / rows.length, y: T, width: pw / rows.length, height: ph + B, fill: "transparent" });
      hit(target, monthLabel(r.mk) + ": " + money(r.bal), r.mk === viewMk ? null : goMonth(r.mk));
      svg.appendChild(target);
    });
    var lastR = rows[rows.length - 1];
    svg.appendChild(svText(Math.min(x(rows.length - 1), W - Rm), Math.max(T + 10, y(lastR.bal) - 10),
                           money(lastR.bal), "lbl", "end"));
    box.appendChild(svg);
    box.appendChild(tableTwin([t("ch.month"), t("ch.balance")],
      rows.map(function (r) { return [monthLabel(r.mk), money(r.bal)]; })));
  }

  // ---------- 9. Dialogs ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.setAttribute("aria-labelledby", id + "-t");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    var h = el("div", "dlg-title", title);
    h.id = id + "-t";
    dlg.appendChild(h);
    return dlg;
  }
  function field(labelText, input, id) {
    var w = el("div", "fld");
    var lab = el("label", "dlg-lbl", labelText);
    input.id = id;
    lab.setAttribute("for", id);
    w.appendChild(lab);
    w.appendChild(input);
    return w;
  }
  function kindSwitch(k, onChange) {
    var w = el("div", "seg");
    w.setAttribute("role", "radiogroup");
    var cur = k;
    var btns = {};
    ["o", "i"].forEach(function (v) {
      var b = el("button", "seg-btn " + (v === "i" ? "in" : "out"), t(v === "i" ? "k.in" : "k.out"));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { set(v); onChange(v); });
      btns[v] = b;
      w.appendChild(b);
    });
    function set(v) {
      cur = v;
      Object.keys(btns).forEach(function (x) { btns[x].setAttribute("aria-checked", x === v ? "true" : "false"); });
    }
    set(k);
    w.get = function () { return cur; };
    return w;
  }
  function catSelect(k, selected) {
    var sel = el("select");
    fillCatSelect(sel, k, selected);
    return sel;
  }
  function fillCatSelect(sel, k, selected) {
    sel.innerHTML = "";
    var list = cats().filter(function (c) { return c.k === k; });
    list.forEach(function (c) { var o = el("option", "", c.name); o.value = c.id; sel.appendChild(o); });
    var none = el("option", "", t("cat.none")); none.value = ""; sel.appendChild(none);
    sel.value = selected;
    if (sel.value !== selected) sel.value = list.length ? list[0].id : "";
  }
  function errLine() { var p = el("p", "err"); p.setAttribute("role", "alert"); p.hidden = true; return p; }
  function showErr(p, msg, focusEl) { p.textContent = msg; p.hidden = false; if (focusEl) focusEl.focus(); }

  // New / edit entry
  // A new entry is an expense unless you switch it; the category
  // remembers the last one you used for each kind.
  var lastCat = { o: "o-groc", i: "i-salary" };
  var lastAcc = "";   // session only: the account you used last
  function accSelect(selected) {
    var sel = el("select");
    var none = el("option", "", t("acc.none")); none.value = ""; sel.appendChild(none);
    accs().forEach(function (a) { var o = el("option", "", a.n); o.value = a.id; sel.appendChild(o); });
    sel.value = selected || "";
    if (sel.value !== (selected || "")) sel.value = "";
    return sel;
  }
  function txDialog(id, preset) {
    var x = id ? findIn(data.tx, id) : null;
    if (id && !x) return;
    var dlg = makeDialog("bd-tx", t(x ? "dlg.edit" : "dlg.new"));
    var form = el("form");
    form.method = "dialog";
    var pre = !x && preset ? preset : null;
    var k0 = x ? x.k : (pre && pre.k) || "o";
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.value = x ? centsToInput(x.a, LANG) : pre && pre.a ? centsToInput(pre.a, LANG) : "";
    amt.placeholder = LANG === "el" ? "0,00" : "0.00";
    var date = el("input");
    date.type = "date";
    date.value = x ? x.d : pre && pre.d ? pre.d : pre ? today : (mkOf(today) === viewMk ? today : viewMk + "-01");
    // A category hint counts only if it still exists and is of the same kind.
    var hint = pre && pre.c ? catById(pre.c) : null;
    var sel = catSelect(k0, x ? x.c : hint && hint.k === k0 ? hint.id : lastCat[k0]);
    var note = el("input");
    note.maxLength = NOTE_LEN;
    note.autocomplete = "off";
    note.placeholder = t("f.note.ph");
    note.value = x ? x.n : pre && pre.n ? pre.n : "";
    var sw = kindSwitch(k0, function (v) { fillCatSelect(sel, v, lastCat[v]); });
    var err = errLine();
    if (pre && pre.src) dlg.appendChild(el("div", "dlg-sub", t("f.from").replace("{app}", appName(pre.src))));
    form.appendChild(sw);
    form.appendChild(field(t("f.amount") + " (" + cur() + ")", amt, "bd-amt"));
    var row = el("div", "fld-row");
    row.appendChild(field(t("f.date"), date, "bd-date"));
    row.appendChild(field(t("f.cat"), sel, "bd-cat"));
    form.appendChild(row);
    var accSel = null;
    if (data.acc.length) {
      accSel = accSelect(x ? x.ac : lastAcc);
      form.appendChild(field(t("f.acc"), accSel, "bd-acc"));
    }
    form.appendChild(field(t("f.note"), note, "bd-note"));
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (x) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteTx(x.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var cents = parseAmount(amt.value);
      if (cents === null) { showErr(err, t("err.amount"), amt); return; }
      if (!parseYmd(date.value)) { showErr(err, t("err.date"), date); return; }
      var k = sw.get(), c = sel.value, n = normText(note.value, NOTE_LEN);
      // Without accounts the field is absent and an entry keeps its account.
      var cur0 = x ? findIn(data.tx, x.id) : null;   // may have changed by a pull meanwhile
      var ac = accSel ? accSel.value : (cur0 ? cur0.ac || "" : "");
      if (cur0) {
        if (cur0.d !== date.value || cur0.a !== cents || cur0.k !== k || cur0.c !== c || cur0.n !== n || (cur0.ac || "") !== ac) {
          cur0.d = date.value; cur0.a = cents; cur0.k = k; cur0.c = c; cur0.n = n;
          if (ac) cur0.ac = ac; else delete cur0.ac;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var nid = x ? x.id : newId();
        if (x) untomb("tx", nid);
        var nx = { id: nid, m: stamp(x ? x.m : 0), d: date.value, a: cents, k: k, c: c, n: n };
        if (ac) nx.ac = ac;
        data.tx.push(nx);
        commit();
      }
      lastCat[k] = c;
      if (accSel) lastAcc = ac;
      dlg.close();
      if (k === "o") checkLimits(date.value, c);
      live(t("live.saved"));
      if (!x && mkOf(date.value) !== viewMk && !query) setMonth(mkOf(date.value));
      else renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!x) (pre ? ok : amt).focus();
  }
  // Another app's display name, from the shell's strings ("app.<id>").
  function appName(id) {
    var n = "";
    try { n = window.parent && window.parent !== window && typeof window.parent.t === "function" ? window.parent.t("app." + id) : ""; } catch (e) {}
    return typeof n === "string" && n && n !== "app." + id ? n : id;
  }

  function deleteTx(id) {
    var x = findIn(data.tx, id);
    if (!x) return;
    var copy = JSON.parse(JSON.stringify(x));
    data.tx = data.tx.filter(function (y) { return y.id !== id; });
    tombstone("tx", id);
    commit();
    renderAll();
    undoToast(t("toast.deleted"), function () {
      untomb("tx", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["tx:" + id] || 0));
      if (!findIn(data.tx, id)) data.tx.push(copy);
      commit();
      renderAll();
    });
  }

  // One notification per category (and overall) per month, when the
  // month on the calendar passes its limit.
  function checkLimits(ymd, catId) {
    var mk = mkOf(ymd);
    if (mk !== mkOf(today)) return;
    var tt = totals(data.tx, mk);
    [[catId, tt.byCat["o:" + catId] || 0, catName(catId)], ["all", tt.out, t("lim.total")]].forEach(function (z) {
      var lim = z[0] ? budOf(z[0]) : 0;
      if (!lim || z[1] <= lim) return;
      notify("over:" + z[0] + ":" + mk, t("notif.over", { c: z[2] }),
             t("notif.overBody", { a: money(z[1]), b: money(lim), m: monthLabel(mk) }));
    });
  }
  function notify(key, title, body) {
    try {
      var n = window.parent && window.parent !== window ? window.parent.orosNotifs : null;
      if (n && typeof n.emit === "function") {
        n.emit({ ns: "budget", key: key, title: title, body: body, deepLink: "system:open:budget" });
        return;
      }
    } catch (e) {}
    showToast(title);
  }

  // Monthly limit
  function limitDialog(id, name) {
    var dlg = makeDialog("bd-lim", t("lim.dlg"));
    dlg.appendChild(el("div", "dlg-sub", name));
    var form = el("form");
    var cur0 = budOf(id);
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.value = cur0 ? centsToInput(cur0, LANG) : "";
    var err = errLine();
    form.appendChild(field(t("f.amount") + " (" + cur() + ")", amt, "bd-lim-amt"));
    form.appendChild(el("p", "hint", t("lim.hint")));
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (cur0) acts.appendChild(button(t("lim.clear"), "danger", function () { setLimit(id, 0); dlg.close(); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var c = parseAmount(amt.value);
      if (c === null) { showErr(err, t("err.amount"), amt); return; }
      setLimit(id, c);
      dlg.close();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    amt.focus();
  }
  function setLimit(id, cents) {
    var b = findIn(data.bud, id);
    if (b && b.a === cents) return;
    if (!b && !cents) return;
    if (b) { b.a = cents; b.m = stamp(b.m); }
    else data.bud.push({ id: id, m: stamp(0), a: cents });
    commit();
    renderAll();
  }

  // Recurring entry
  function recDialog(id) {
    var r = id ? findIn(data.rec, id) : null;
    if (id && !r) return;
    if (!r && data.rec.length >= MAX_REC) { showToast(t("rec.full", { n: MAX_REC })); return; }
    var dlg = makeDialog("bd-rec", t(r ? "rec.edit" : "rec.new"));
    var form = el("form");
    var k0 = r ? r.k : "o";
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.value = r ? centsToInput(r.a, LANG) : "";
    amt.placeholder = LANG === "el" ? "0,00" : "0.00";
    var sel = catSelect(k0, r ? r.c : (k0 === "o" ? "o-home" : "i-salary"));
    var note = el("input");
    note.maxLength = NOTE_LEN;
    note.autocomplete = "off";
    note.placeholder = t("f.note.ph");
    note.value = r ? r.n : "";
    var freq = el("select");
    ["m", "w", "y"].forEach(function (f) { var o = el("option", "", t("rec.f." + f)); o.value = f; freq.appendChild(o); });
    freq.value = r ? r.f : "m";
    var start = el("input"); start.type = "date"; start.value = r ? r.s : today;
    var end = el("input"); end.type = "date"; end.value = r ? r.e : "";
    var sw = kindSwitch(k0, function (v) { fillCatSelect(sel, v, v === "o" ? "o-home" : "i-salary"); });
    var err = errLine();
    form.appendChild(sw);
    form.appendChild(field(t("f.amount") + " (" + cur() + ")", amt, "bd-r-amt"));
    var row = el("div", "fld-row");
    row.appendChild(field(t("f.cat"), sel, "bd-r-cat"));
    row.appendChild(field(t("rec.freq"), freq, "bd-r-freq"));
    form.appendChild(row);
    form.appendChild(field(t("f.note"), note, "bd-r-note"));
    var row2 = el("div", "fld-row");
    row2.appendChild(field(t("rec.start"), start, "bd-r-s"));
    row2.appendChild(field(t("rec.end"), end, "bd-r-e"));
    form.appendChild(row2);
    var accSel = null;
    if (data.acc.length) {
      accSel = accSelect(r ? r.ac : lastAcc);
      form.appendChild(field(t("f.acc"), accSel, "bd-r-acc"));
    }
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (r) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteRec(r.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var cents = parseAmount(amt.value);
      if (cents === null) { showErr(err, t("err.amount"), amt); return; }
      if (!parseYmd(start.value)) { showErr(err, t("err.date"), start); return; }
      var e2 = end.value && parseYmd(end.value) ? end.value : "";
      if (e2 && e2 < start.value) { showErr(err, t("err.end"), end); return; }
      var vals = { k: sw.get(), a: cents, c: sel.value, n: normText(note.value, NOTE_LEN), f: freq.value, s: start.value, e: e2 };
      var cur0 = r ? findIn(data.rec, r.id) : null;
      var ac = accSel ? accSel.value : (cur0 ? cur0.ac || "" : "");
      if (cur0) {
        var changed = Object.keys(vals).some(function (kk) { return cur0[kk] !== vals[kk]; }) || (cur0.ac || "") !== ac;
        if (changed) {
          Object.keys(vals).forEach(function (kk) { cur0[kk] = vals[kk]; });
          if (ac) cur0.ac = ac; else delete cur0.ac;
          cur0.m = stamp(cur0.m);
        }
      } else {
        var nid = r ? r.id : newId();
        if (r) untomb("rec", nid);
        var obj = { id: nid, m: stamp(r ? r.m : 0) };
        Object.keys(vals).forEach(function (kk) { obj[kk] = vals[kk]; });
        if (ac) obj.ac = ac;
        data.rec.push(obj);
      }
      if (accSel) lastAcc = ac;
      commit();
      dlg.close();
      var n = materialize(false);
      if (n) showToast(t("toast.recMade", { n: n }));
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!r) amt.focus();
  }
  function deleteRec(id) {
    var r = findIn(data.rec, id);
    if (!r) return;
    var copy = JSON.parse(JSON.stringify(r));
    data.rec = data.rec.filter(function (y) { return y.id !== id; });
    tombstone("rec", id);
    commit();
    renderAll();
    undoToast(t("rec.deleted") + " " + t("rec.keep"), function () {
      untomb("rec", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["rec:" + id] || 0));
      if (!findIn(data.rec, id)) data.rec.push(copy);
      commit();
      renderAll();
    });
  }

  // Add the due recurring entries; returns how many.
  function materialize(announce) {
    var made = dueRecurring(data, today);
    if (!made.length) return 0;
    data.tx = data.tx.concat(made);
    commit();
    if (announce) notify("rec:" + today, t("notif.rec"), t("notif.recBody", { n: made.length }));
    made.forEach(function (x) { if (x.k === "o") checkLimits(x.d, x.c); });
    return made.length;
  }

  // Categories manager
  // Accounts: list with today's balance, new account, transfer.
  function accountsDialog() {
    var dlg = makeDialog("bd-accs", t("acc.title"));
    var body = el("div");
    dlg.appendChild(body);
    dlg.appendChild(el("p", "hint", t("acc.hint")));
    var acts = el("div", "dlg-actions");
    var xb = button(t("xf.btn"), "", function () { dlg.close(); xferDialog(null); });
    acts.appendChild(xb);
    acts.appendChild(button(t("acc.new"), "", function () { dlg.close(); accDialog(null); }));
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var list = accs();
    xb.hidden = list.length < 2;
    if (!list.length) body.appendChild(el("p", "hint empty", t("acc.empty")));
    else {
      body.appendChild(el("h3", "sub-h", t("acc.bal")));
      var bal = accBalances(data, today);
      var ul = el("ul", "day-list");
      list.forEach(function (a) {
        var li = el("li");
        var b = el("button", "tx acc-row");
        b.type = "button";
        b.appendChild(swatch(a.col));
        var mid = el("span", "tx-mid");
        mid.appendChild(el("span", "tx-cat", a.n));
        b.appendChild(mid);
        var v = el("span", "tx-amt" + (bal[a.id] < 0 ? " neg" : ""), money(bal[a.id]));
        b.appendChild(v);
        b.setAttribute("aria-label", a.n + ", " + money(bal[a.id]) + ", " + t("acc.edit"));
        b.addEventListener("click", function () { dlg.close(); accDialog(a.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function accDialog(id) {
    var a = id ? findIn(data.acc, id) : null;
    if (id && !a) return;
    if (!a && data.acc.length >= MAX_ACC) { showToast(t("acc.full", { n: MAX_ACC })); return; }
    var dlg = makeDialog("bd-acc-dlg", t(a ? "acc.edit" : "acc.new"));
    var form = el("form");
    var name = el("input");
    name.maxLength = NAME_LEN;
    name.autocomplete = "off";
    name.placeholder = t("acc.name.ph");
    name.value = a ? a.n : "";
    var open = el("input");
    open.inputMode = "decimal";
    open.autocomplete = "off";
    open.placeholder = LANG === "el" ? "0,00" : "0.00";
    open.value = a && a.o ? (a.o < 0 ? "-" : "") + centsToInput(Math.abs(a.o), LANG) : "";
    var err = errLine();
    form.appendChild(field(t("acc.name"), name, "bd-acc-n"));
    form.appendChild(field(t("acc.open") + " (" + cur() + ")", open, "bd-acc-o"));
    form.appendChild(el("p", "hint", t("acc.open.hint")));
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (a) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteAcc(a.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = normText(name.value, NAME_LEN);
      if (!n) { showErr(err, t("err.name"), name); return; }
      var o = parseSigned(open.value);
      if (o === null) { showErr(err, t("err.open"), open); return; }
      var cur0 = a ? findIn(data.acc, a.id) : null;
      if (cur0) {
        if (cur0.n !== n || cur0.o !== o) { cur0.n = n; cur0.o = o; cur0.m = stamp(cur0.m); commit(); }
      } else {
        var used = {};
        data.acc.forEach(function (y) { used[y.col] = 1; });
        var col = 0;
        while (col < 8 && used[col]) col++;
        var nid = a ? a.id : newId();
        if (a) untomb("acc", nid);
        data.acc.push({ id: nid, m: stamp(a ? a.m : 0), n: n, o: o, col: col % 8 });
        commit();
      }
      dlg.close();
      live(t("live.saved"));
      renderAll();
      accountsDialog();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    name.focus();
  }
  // Its entries and transfers stay; they just no longer point anywhere.
  function deleteAcc(id) {
    var a = findIn(data.acc, id);
    if (!a) return;
    var copy = JSON.parse(JSON.stringify(a));
    data.acc = data.acc.filter(function (y) { return y.id !== id; });
    tombstone("acc", id);
    if (lastAcc === id) lastAcc = "";
    commit();
    renderAll();
    undoToast(t("acc.deleted") + ". " + t("acc.keep"), function () {
      untomb("acc", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["acc:" + id] || 0));
      if (!findIn(data.acc, id)) data.acc.push(copy);
      commit();
      renderAll();
    });
  }
  function xferDialog(id) {
    var x = id ? findIn(data.xfer, id) : null;
    if (id && !x) return;
    var list = accs();
    if (!x && list.length < 2) { showToast(t("xf.need")); return; }
    var dlg = makeDialog("bd-xf", t(x ? "xf.edit" : "xf.new"));
    var form = el("form");
    var from = accSelect(x ? x.f : (lastAcc || list[0].id));
    var to = accSelect(x ? x.t : "");
    // "No account" makes no sense for a transfer, except to keep one whose account was deleted.
    [from, to].forEach(function (s, i) {
      var keep = x ? (i ? x.t : x.f) : "";
      if (!keep || findIn(data.acc, keep)) s.removeChild(s.options[0]);
    });
    if (!x) { to.value = (list[0].id === from.value ? list[1] : list[0]).id; }
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.placeholder = LANG === "el" ? "0,00" : "0.00";
    amt.value = x ? centsToInput(x.a, LANG) : "";
    var date = el("input");
    date.type = "date";
    date.value = x ? x.d : (mkOf(today) === viewMk ? today : viewMk + "-01");
    var note = el("input");
    note.maxLength = NOTE_LEN;
    note.autocomplete = "off";
    note.placeholder = t("f.note.ph");
    note.value = x ? x.n : "";
    var err = errLine();
    var row = el("div", "fld-row");
    row.appendChild(field(t("xf.from"), from, "bd-xf-from"));
    row.appendChild(field(t("xf.to"), to, "bd-xf-to"));
    form.appendChild(row);
    form.appendChild(field(t("f.amount") + " (" + cur() + ")", amt, "bd-xf-amt"));
    form.appendChild(field(t("f.date"), date, "bd-xf-date"));
    form.appendChild(field(t("f.note"), note, "bd-xf-note"));
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (x) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteXfer(x.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!from.value || !to.value || from.value === to.value) { showErr(err, t("err.same"), to); return; }
      var cents = parseAmount(amt.value);
      if (cents === null) { showErr(err, t("err.amount"), amt); return; }
      if (!parseYmd(date.value)) { showErr(err, t("err.date"), date); return; }
      var n = normText(note.value, NOTE_LEN);
      var cur0 = x ? findIn(data.xfer, x.id) : null;
      if (cur0) {
        if (cur0.f !== from.value || cur0.t !== to.value || cur0.a !== cents || cur0.d !== date.value || cur0.n !== n) {
          cur0.f = from.value; cur0.t = to.value; cur0.a = cents; cur0.d = date.value; cur0.n = n;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var nid = x ? x.id : newId();
        if (x) untomb("xfer", nid);
        data.xfer.push({ id: nid, m: stamp(x ? x.m : 0), d: date.value, a: cents, f: from.value, t: to.value, n: n });
        commit();
      }
      lastAcc = from.value;
      dlg.close();
      live(t("live.saved"));
      if (!x && mkOf(date.value) !== viewMk && !query) setMonth(mkOf(date.value));
      else renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!x) amt.focus();
  }
  function deleteXfer(id) {
    var x = findIn(data.xfer, id);
    if (!x) return;
    var copy = JSON.parse(JSON.stringify(x));
    data.xfer = data.xfer.filter(function (y) { return y.id !== id; });
    tombstone("xfer", id);
    commit();
    renderAll();
    undoToast(t("xf.deleted"), function () {
      untomb("xfer", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["xfer:" + id] || 0));
      if (!findIn(data.xfer, id)) data.xfer.push(copy);
      commit();
      renderAll();
    });
  }

  function catsDialog() {
    var dlg = makeDialog("bd-cats", t("cats.title"));
    dlg.classList.add("wide");
    var body = el("div");
    dlg.appendChild(body);
    dlg.appendChild(el("p", "hint", t("cats.hint")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    function draw() {
      body.innerHTML = "";
      ["o", "i"].forEach(function (k) {
        body.appendChild(el("h3", "sub-h", t(k === "o" ? "cats.out" : "cats.in")));
        var ul = el("ul", "cat-list");
        cats().filter(function (c) { return c.k === k; }).forEach(function (c) { ul.appendChild(catRow(c, draw)); });
        body.appendChild(ul);
        var add = el("form", "cat-add");
        var inp = el("input");
        inp.maxLength = NAME_LEN;
        inp.placeholder = t("cats.add");
        inp.setAttribute("aria-label", t("cats.add") + " (" + t(k === "o" ? "cats.out" : "cats.in") + ")");
        var b = el("button", "icon-btn");
        b.type = "submit";
        b.innerHTML = UI.plus;
        b.setAttribute("aria-label", t("cats.add"));
        add.appendChild(inp); add.appendChild(b);
        add.addEventListener("submit", function (e) {
          e.preventDefault();
          var name = normText(inp.value, NAME_LEN);
          if (!name) { showToast(t("cats.needName")); inp.focus(); return; }
          if (cats().length >= MAX_CATS) { showToast(t("cats.full", { n: MAX_CATS })); return; }
          var used = {};
          cats().forEach(function (c) { if (c.k === k) used[c.col] = 1; });
          var col = 0;
          while (col < 8 && used[col]) col++;
          data.cats.push({ id: "u" + newId(), m: stamp(0), k: k, name: name, col: col % 8 });
          commit();
          draw();
          renderAll();
          var again = body.querySelectorAll(".cat-add input")[k === "o" ? 0 : 1];
          if (again) again.focus();
        });
        body.appendChild(add);
      });
    }
    draw();
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function storedCat(c) {
    var s = findIn(data.cats, c.id);
    if (!s) {
      s = { id: c.id, m: 0, k: c.k, name: "", col: c.col };
      data.cats.push(s);
    }
    return s;
  }
  function catRow(c, redraw) {
    var li = el("li");
    var colB = el("button", "col-btn");
    colB.type = "button";
    colB.appendChild(swatch(c.col));
    colB.setAttribute("aria-label", t("cats.color", { c: c.name }));
    colB.addEventListener("click", function () {
      var s = storedCat(c);
      s.col = (s.col + 1) % COLOR_SLOTS;
      s.m = stamp(s.m);
      commit();
      redraw();
      renderAll();
      var again = document.querySelector('#bd-cats [data-cat="' + c.id + '"] .col-btn');
      if (again) again.focus();
    });
    li.setAttribute("data-cat", c.id);
    var inp = el("input");
    inp.value = c.name;
    inp.maxLength = NAME_LEN;
    inp.setAttribute("aria-label", t("cats.name", { c: c.name }));
    inp.addEventListener("change", function () {
      var name = normText(inp.value, NAME_LEN);
      var seedName = c.seed ? (SEED_NAMES[LANG] || SEED_NAMES.en)[c.id] : "";
      if (!name) { inp.value = c.name; showToast(t("cats.needName")); return; }
      var want = c.seed && name === seedName ? "" : name;   // back to the ready name = language-free again
      var have = findIn(data.cats, c.id);
      if ((have ? have.name : "") === want) return;
      var s = storedCat(c);
      s.name = want;
      s.m = stamp(s.m);
      commit();
      renderAll();
    });
    var del = el("button", "icon-btn");
    del.type = "button";
    del.innerHTML = UI.trash;
    del.setAttribute("aria-label", t("cats.del", { c: c.name }));
    del.addEventListener("click", function () {
      var snapshot = findIn(data.cats, c.id);
      snapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
      data.cats = data.cats.filter(function (y) { return y.id !== c.id; });
      tombstone("cat", c.id);
      commit();
      redraw();
      renderAll();
      undoToast(t("cats.deleted"), function () {
        untomb("cat", c.id);
        if (snapshot) {
          snapshot.m = stamp(Math.max(snapshot.m, data.tombs["cat:" + c.id] || 0));
          if (!findIn(data.cats, c.id)) data.cats.push(snapshot);
        } else if (c.seed) {
          // A ready category is back as soon as its tombstone is gone;
          // store it once so the return beats the tombstone elsewhere.
          data.cats.push({ id: c.id, m: stamp(0), k: c.k, name: "", col: c.col });
        }
        commit();
        redraw();
        renderAll();
      });
    });
    li.appendChild(colB);
    li.appendChild(inp);
    li.appendChild(del);
    return li;
  }

  // Currency
  function currencyDialog() {
    var dlg = makeDialog("bd-cur", t("cur.title"));
    var form = el("form");
    var sel = el("select");
    CURRENCIES.forEach(function (c) {
      var label = c;
      try {
        var parts = new Intl.NumberFormat(LOCALE, { style: "currency", currency: c }).formatToParts(0);
        parts.forEach(function (p) { if (p.type === "currency" && p.value !== c) label = c + " (" + p.value + ")"; });
      } catch (e) {}
      var o = el("option", "", label); o.value = c; sel.appendChild(o);
    });
    sel.value = cur();
    form.appendChild(field(t("cur.title"), sel, "bd-cur-sel"));
    form.appendChild(el("p", "hint", t("cur.hint")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sel.value !== cur()) {
        data.set.m = stamp(data.set.m);   // in place: keeps a newer version's fields
        data.set.cur = sel.value;
        commit();
        renderAll();
      }
      dlg.close();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    sel.focus();
  }

  // ---------- 10. Export ----------
  function dialogHost() {
    try { return window.orosDialog || window.parent.orosDialog || null; } catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, filename, mime, desc, ext) {
    var done = function () { showToast(t("exp.done")); };
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime.split(";")[0]] = [ext];
      dlg.saveFile({ blob: blob, filename: filename, mime: mime, types: [{ description: desc, accept: acc }] })
        .then(function (r) { if (r && r.ok) done(); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    done();
  }
  function fileStamp() { return today; }

  // Period → { prefix, label, slug }
  function periodOf(p) {
    if (p === "year") return { prefix: viewMk.slice(0, 4), label: viewMk.slice(0, 4), slug: viewMk.slice(0, 4) };
    if (p === "all") return { prefix: "", label: t("exp.all"), slug: "all" };
    return { prefix: viewMk, label: monthLabel(viewMk), slug: viewMk };
  }
  function exportRows(prefix) {
    return data.tx.filter(function (x) { return !prefix || x.d.slice(0, prefix.length) === prefix; })
      .sort(function (a, b) { return cmpStr(a.d, b.d) || a.m - b.m || cmpStr(a.id, b.id); })
      .map(function (x) { return { d: x.d, k: x.k, cat: catName(x.c), a: x.a, n: x.n, c: x.c, acc: accName(x.ac) }; });
  }
  function kindName(k) { return t(k === "i" ? "k.in" : "k.out"); }
  // The "Account" column only when there are accounts (otherwise the v1 layout).
  function colHead() {
    var h = [t("col.date"), t("col.type"), t("col.cat"), t("col.amount"), t("col.cur"), t("col.note")];
    if (data.acc.length) h.push(t("col.acc"));
    return h;
  }

  function exportDialog() {
    var dlg = makeDialog("bd-exp", t("exp.title"));
    var period = "month";
    var grp = el("div", "seg seg3");
    grp.setAttribute("role", "radiogroup");
    grp.setAttribute("aria-label", t("exp.period"));
    var pb = {};
    [["month", t("exp.month", { m: monthLabel(viewMk) })], ["year", t("exp.year", { y: viewMk.slice(0, 4) })],
     ["all", t("exp.all")]].forEach(function (p) {
      var b = el("button", "seg-btn", p[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { period = p[0]; mark(); });
      pb[p[0]] = b;
      grp.appendChild(b);
    });
    function mark() { Object.keys(pb).forEach(function (k) { pb[k].setAttribute("aria-checked", k === period ? "true" : "false"); }); }
    mark();
    var lab = el("div", "dlg-lbl", t("exp.period"));
    dlg.appendChild(lab);
    dlg.appendChild(grp);
    var fmt = el("select");
    [["excel", t("exp.csv.excel")], ["std", t("exp.csv.std")]].forEach(function (f) {
      var o = el("option", "", f[1]); o.value = f[0]; fmt.appendChild(o);
    });
    fmt.value = prefs.csv;
    fmt.addEventListener("change", function () { prefs.csv = fmt.value; savePrefs(); });
    dlg.appendChild(field(t("exp.csvfmt"), fmt, "bd-exp-fmt"));
    var acts = el("div", "dlg-actions exp-acts");
    var go = function (kind) {
      return function () {
        var P = periodOf(period), rows = exportRows(P.prefix);
        if (!rows.length) { showToast(t("exp.empty")); return; }
        if (kind === "csv") exportCsv(rows, P);
        if (kind === "xlsx") exportXlsx(rows, P);
        if (kind === "pdf") exportPdf(rows, P);
        if (kind === "sheet") openInSheet(rows, P);
        dlg.close();
      };
    };
    acts.appendChild(button(t("exp.csv"), "", go("csv")));
    acts.appendChild(button(t("exp.xlsx"), "", go("xlsx")));
    acts.appendChild(button(t("exp.pdf"), "primary", go("pdf")));
    dlg.appendChild(acts);
    if (sheetBridge()) {
      var sa = el("div", "dlg-actions");
      sa.appendChild(button(t("exp.sheet"), "", go("sheet")));
      dlg.appendChild(sa);
    }
    dlg.appendChild(el("p", "hint", t("exp.hint")));
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(close);
    document.body.appendChild(dlg);
    dlg.showModal();
    loadLib("xlsx.full.min.js", function () {}, true);   // pre-warm: keeps the click's activation (R33)
  }

  // "Open in Spreadsheet" (Bible BR-S1): a new sheet in the orOS
  // Spreadsheet with the entries and a SUM under the amounts.
  var SHEET_ROWS = 498;   // + heading + SUM row = the Spreadsheet's 500
  function sheetBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenAt === "function" ? p : null;
    } catch (e) { return null; }
  }
  function openInSheet(rows, P) {
    var p = sheetBridge();
    if (!p) return;
    if (rows.length > SHEET_ROWS) { showToast(t("exp.sheetCap", { n: SHEET_ROWS })); rows = rows.slice(0, SHEET_ROWS); }
    var withAcc = data.acc.length > 0;
    var table = [colHead()].concat(rows.map(function (r) {
      var line = [dateShort(r.d), kindName(r.k), r.cat, (r.k === "i" ? r.a : -r.a) / 100, cur(), r.n];
      if (withAcc) line.push(r.acc);
      return line;
    }));
    p.__orosOpenAt("spreadsheet", { newSheet: { name: t("app") + " " + P.slug, rows: table, sum: [3] } });
  }

  function exportCsv(rows, P) {
    var text = buildCsv(rows, prefs.csv, cur(), colHead(), kindName);
    saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), "oros-budget-" + P.slug + ".csv",
             "text/csv;charset=utf-8", "CSV", ".csv");
  }

  // Vendored libraries (never a CDN), loaded on first use.
  var libState = {};
  function loadLib(file, done, quiet) {
    var ready = file.indexOf("xlsx") === 0 ? function () { return window.XLSX && window.XLSX.utils; }
                                          : function () { return window.jspdf && window.jspdf.jsPDF; };
    if (ready()) { done(); return; }
    var st = libState[file] || (libState[file] = { loading: false, q: [] });
    st.q.push(done);
    if (st.loading) return;
    st.loading = true;
    var s = document.createElement("script");
    s.src = "../vendor/" + file + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    s.onload = function () { st.loading = false; st.q.splice(0).forEach(function (cb) { cb(); }); };
    s.onerror = function () {
      st.loading = false;
      st.q.splice(0);
      s.remove();
      if (!quiet) showToast(t("exp.lib", { f: file }));
    };
    document.head.appendChild(s);
  }

  // Same guard as the CSV: a text cell never starts like a formula
  // (the orOS Spreadsheet would run "=…" text as one).
  function safeText(s) { return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }

  function summaryRows(rows) {
    var by = {};
    rows.forEach(function (r) {
      var k = r.k + ":" + r.c;
      if (!by[k]) by[k] = { k: r.k, cat: r.cat, a: 0 };
      by[k].a += r.a;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return cmpStr(b.k, a.k) || b.a - a.a; });
  }

  function exportXlsx(rows, P) {
    loadLib("xlsx.full.min.js", function () {
      var X = window.XLSX;
      var aoa = [colHead()];
      rows.forEach(function (r) {
        var p = parseYmd(r.d);
        var line = [new Date(p.y, p.m - 1, p.d), kindName(r.k), safeText(r.cat), (r.k === "i" ? r.a : -r.a) / 100, cur(), safeText(r.n)];
        if (data.acc.length) line.push(safeText(r.acc));
        aoa.push(line);
      });
      var ws = X.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "yyyy-mm-dd" });
      ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 40 }, { wch: 16 }];
      var sum = [[t("col.type"), t("col.cat"), t("col.total")]];
      var inc = 0, out = 0;
      summaryRows(rows).forEach(function (s) {
        sum.push([kindName(s.k), safeText(s.cat), (s.k === "i" ? s.a : -s.a) / 100]);
        if (s.k === "i") inc += s.a; else out += s.a;
      });
      sum.push([]);
      sum.push([t("sum.in"), "", inc / 100]);
      sum.push([t("sum.out"), "", -out / 100]);
      sum.push([t("sum.bal"), "", (inc - out) / 100]);
      var ws2 = X.utils.aoa_to_sheet(sum);
      ws2["!cols"] = [{ wch: 12 }, { wch: 24 }, { wch: 14 }];
      var wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, t("sheet.tx"));
      X.utils.book_append_sheet(wb, ws2, t("sheet.sum"));
      var buf = X.write(wb, { bookType: "xlsx", type: "array" });
      var mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      saveBlob(new Blob([buf], { type: mime }), "oros-budget-" + P.slug + ".xlsx", mime, "Excel", ".xlsx");
    });
  }

  function loadPdfFont(done) {
    if (window.__budgetPdfFont) { done(); return; }
    fetch("../vendor/NotoSans-Regular.ttf" + (SCRIPT_V ? "?v=" + SCRIPT_V : ""))
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(String(fr.result).split(",")[1]); };
          fr.readAsDataURL(b);
        });
      })
      .then(function (b64) { window.__budgetPdfFont = b64; done(); })
      .catch(function () { showToast(t("exp.font")); done(); });
  }

  function exportPdf(rows, P) {
    loadLib("jspdf.umd.min.js", function () {
      loadPdfFont(function () { buildPdf(rows, P); });
    });
  }
  function buildPdf(rows, P) {
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var FONT = "helvetica";
    if (window.__budgetPdfFont) {
      doc.addFileToVFS("NotoSans-Regular.ttf", window.__budgetPdfFont);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      FONT = "NotoSans";
    }
    var txt = function (s, x, y, opt) { doc.text(String(s).normalize("NFC"), x, y, opt); };
    doc.setFont(FONT, "normal");
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
    var y = M, page = 1;
    var foot = function () {
      doc.setFontSize(8);
      doc.setTextColor(120);
      txt("orOS · " + t("app") + " · " + t("pdf.page", { n: page }), W / 2, H - 24, { align: "center" });
      doc.setTextColor(0);
    };
    var need = function (h) {
      if (y + h <= H - 48) return;
      foot();
      doc.addPage();
      page++;
      y = M;
      doc.setFont(FONT, "normal");
    };
    doc.setFontSize(18);
    txt(t("pdf.title"), M, y); y += 22;
    doc.setFontSize(12);
    txt(P.label, M, y); y += 14;
    doc.setFontSize(9);
    doc.setTextColor(110);
    txt(t("pdf.gen", { d: dateShort(today) }), M, y); y += 24;
    doc.setTextColor(0);
    var inc = 0, out = 0;
    rows.forEach(function (r) { if (r.k === "i") inc += r.a; else out += r.a; });
    doc.setFontSize(11);
    [[t("sum.in"), inc], [t("sum.out"), out], [t("sum.bal"), inc - out]].forEach(function (z, i) {
      var x = M + i * ((W - 2 * M) / 3);
      doc.setFontSize(9); doc.setTextColor(110); txt(z[0], x, y);
      doc.setFontSize(14); doc.setTextColor(0); txt(money(z[1]), x, y + 18);
    });
    y += 44;
    var sums = summaryRows(rows);
    [["o", t("pdf.bycat"), out], ["i", t("pdf.incat"), inc]].forEach(function (sec) {
      var list = sums.filter(function (s) { return s.k === sec[0]; });
      if (!list.length) return;
      need(40);
      doc.setFontSize(12);
      txt(sec[1], M, y); y += 8;
      doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 14;
      doc.setFontSize(10);
      list.forEach(function (s) {
        need(16);
        txt(s.cat, M, y);
        txt(money(s.a), W - M - 50, y, { align: "right" });
        txt(Math.round(s.a * 100 / (sec[2] || 1)) + "%", W - M, y, { align: "right" });
        y += 15;
      });
      y += 12;
    });
    need(40);
    doc.setFontSize(12);
    txt(t("pdf.list"), M, y); y += 8;
    doc.line(M, y, W - M, y); y += 14;
    doc.setFontSize(9);
    rows.forEach(function (r) {
      var noteLines = r.n ? doc.splitTextToSize(String(r.n).normalize("NFC"), W - 2 * M - 250) : [""];
      var h = Math.max(1, noteLines.length) * 12 + 3;
      need(h);
      txt(dateShort(r.d), M, y);
      txt(r.cat.length > 26 ? r.cat.slice(0, 25) + "…" : r.cat, M + 62, y);
      noteLines.forEach(function (ln, i) { txt(ln, M + 190, y + i * 12); });
      txt((r.k === "i" ? "+" : "−") + money(r.a), W - M, y, { align: "right" });
      y += h;
    });
    foot();
    saveBlob(doc.output("blob"), "oros-budget-" + P.slug + ".pdf", "application/pdf", "PDF", ".pdf");
  }

  // JSON backup: the synced slice as it is. Restore = merge (never
  // overwrites; a backup can only add or bring newer versions).
  function backup() {
    var payload = { app: "oros-budget", ver: DATA_VER, exported: new Date().toISOString(), data: mergeBudget(data, data) };
    saveBlob(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }),
             "oros-budget-backup-" + fileStamp() + ".json", "application/json", "JSON", ".json");
  }
  function restore() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(".json,application/json") : localPick(".json,application/json");
    pick.then(function (file) {
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result)); } catch (e) {}
        if (!obj || obj.app !== "oros-budget" || !obj.data || !Array.isArray(obj.data.tx)) { showToast(t("bk.bad")); return; }
        var before = mergeBudget(data, data);
        var merged = mergeBudget(before, obj.data);
        var n = changedCount(before, merged);
        if (!n) { showToast(t("bk.same")); return; }
        data = merged;
        commit();
        materialize(false);
        renderAll();
        showToast(t("bk.restored", { n: n }));
      };
      fr.readAsText(file);
    });
  }
  function changedCount(a, b) {
    var n = 0;
    ["tx", "cats", "bud", "rec"].forEach(function (k) {
      var idx = {};
      a[k].forEach(function (x) { idx[x.id] = JSON.stringify(x); });
      b[k].forEach(function (x) { if (idx[x.id] !== JSON.stringify(x)) n++; });
    });
    if (JSON.stringify(a.set) !== JSON.stringify(b.set)) n++;
    return n;
  }
  function localPick(accept) {
    return new Promise(function (res) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.addEventListener("change", function () { res(inp.files && inp.files[0] || null); });
      inp.addEventListener("cancel", function () { res(null); });
      inp.click();
    });
  }

  // ---------- 11. Toasts, menu, keyboard ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "budget", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // Menu: per-instance listeners, removed on close.
  function openMenu() {
    var menu = $("menu"), btn = $("menu-btn");
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    var first = menu.querySelector("button");
    if (first) first.focus();
    var onDown = function (e) { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu(); };
    var onKey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); btn.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        var items = [].slice.call(menu.querySelectorAll("button"));
        var i = items.indexOf(document.activeElement);
        i = (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        items[i].focus();
        e.preventDefault();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    menu._off = function () {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }
  function closeMenu() {
    var menu = $("menu");
    if (menu.hidden) return;
    menu.hidden = true;
    $("menu-btn").setAttribute("aria-expanded", "false");
    if (menu._off) { menu._off(); menu._off = null; }
  }

  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]") || !$("menu").hidden) return;
      if (e.key === "n" || e.key === "N" || e.key === "ν" || e.key === "Ν") { e.preventDefault(); txDialog(null); }
      else if (e.key === "ArrowLeft" && tag !== "BUTTON") { e.preventDefault(); setMonth(mkAdd(viewMk, -1)); }
      else if (e.key === "ArrowRight" && tag !== "BUTTON") { e.preventDefault(); setMonth(mkAdd(viewMk, 1)); }
    });
    // Tabs: arrows move between them (ARIA tabs pattern)
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var order = ["list", "charts", "limits", "rec"], i = order.indexOf(prefs.tab);
      i = (i + (e.key === "ArrowRight" ? 1 : 3)) % 4;
      e.preventDefault();
      e.stopPropagation();
      setTab(order[i]);
      $("tab-" + order[i]).focus();
    });
  }

  function setMonth(mk) {
    viewMk = mk;
    renderAll();
    live(t("live.month", { m: monthLabel(mk) }));
  }
  function setTab(tab) {
    prefs.tab = tab;
    savePrefs();
    renderAll();
  }

  // ---------- 12. Sync slice + palette ----------
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
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("budget", sliceGet, sliceSet, STORAGE_KEY, mergeBudget);
  }

  function sliceGet() { return mergeBudget(data, data); }   // canonical copy (R26)

  // A pull: adopt, persist without dirty (R6), redraw the page but
  // never an open dialog (what you are typing stays, SS-4 lesson).
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.tx)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;
    try {
      data = mergeBudget(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    materialize(false);   // a recurring entry from another device: its due days (same ids everywhere)
    renderAll();
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    var ib = function (id, icon, key) {
      var b = $(id);
      b.innerHTML = icon;
      b.setAttribute("aria-label", t(key));
      b.title = t(key);
    };
    ib("prev-btn", UI.left, "btn.prev");
    ib("next-btn", UI.right, "btn.next");
    ib("menu-btn", UI.more, "btn.menu");
    $("add-btn").innerHTML = UI.plus + "<span>" + t("btn.add") + "</span>";
    $("add-btn").setAttribute("aria-label", t("btn.add.aria"));
    $("add-btn").title = t("btn.add.aria");
    $("rec-add").innerHTML = UI.plus + "<span>" + t("rec.new") + "</span>";
    $("q").placeholder = t("q.ph");
    $("q").setAttribute("aria-label", t("q.ph"));
    $("flt").setAttribute("aria-label", t("f.cat"));
  }

  function wire() {
    $("prev-btn").addEventListener("click", function () { setMonth(mkAdd(viewMk, -1)); });
    $("next-btn").addEventListener("click", function () { setMonth(mkAdd(viewMk, 1)); });
    $("today-btn").addEventListener("click", function () { setMonth(mkOf(today)); });
    $("add-btn").addEventListener("click", function () { txDialog(null); });
    $("rec-add").addEventListener("click", function () { recDialog(null); });
    $("menu-btn").addEventListener("click", openMenu);
    ["list", "charts", "limits", "rec"].forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    var qt = null;
    $("q").addEventListener("input", function () {
      clearTimeout(qt);
      qt = setTimeout(function () { query = $("q").value.trim().toLowerCase(); renderList(); }, 150);
    });
    $("flt").addEventListener("change", function () { filter = $("flt").value; renderList(); });
    var acts = { accounts: accountsDialog, cats: catsDialog, export: exportDialog, backup: backup, restore: restore, currency: currencyDialog };
    [].forEach.call(document.querySelectorAll("#menu [data-act]"), function (b) {
      b.addEventListener("click", function () { closeMenu(); acts[b.getAttribute("data-act")](); });
    });
    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (prefs.tab === "charts") renderCharts(); }, 120);
    });
    $("main").addEventListener("scroll", hideTip, { passive: true });
    // A new day: due recurring entries, "today" moves on.
    var tick = function () {
      var now = ymdLocal(new Date());
      if (now === today) return;
      var wasCur = viewMk === mkOf(today);
      today = now;
      if (wasCur) viewMk = mkOf(today);
      materialize(true);
      renderAll();
    };
    setInterval(tick, 60000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") tick(); });
    wireKeyboard();
  }

  // ---------- "Send to Budget" receiver (Bible BR-B1) ----------
  // The shell pushes here while Budget is running; otherwise it stages
  // the payload in sessionStorage and opens Budget, which takes it once
  // at boot. Standalone: /budget/?new={JSON}. A prefill only: nothing
  // is stored until Save.
  var NEW_KEY = "oros-budget-new";
  window.__orosBudgetNew = function (p) {
    var q = normPrefill(p);
    if (!q || !data) return false;
    txDialog(null, q);
    return true;
  };
  // Deep link from the shell (window.__orosOpenAt("budget", target)):
  // { rec: id } opens that recurring entry on the Recurring tab (the
  // Calendar's Budget feed, universal search); { tx: id } opens that
  // entry on its month (universal search). Live push while the app is
  // open; a staged target is taken at boot. An open dialog is closed
  // first; anything else is ignored.
  function openTarget(x) {
    if (!x || typeof x !== "object" || !data) return;
    var rec = typeof x.rec === "string" && /^[a-z0-9]{1,24}$/.test(x.rec) ? x.rec : "";
    var tx = typeof x.tx === "string" && ID_RE.test(x.tx) ? findIn(data.tx, x.tx) : null;
    if (!rec && !tx) return;
    Array.prototype.forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
    if (tx) {
      prefs.tab = "list";
      savePrefs();
      setMonth(mkOf(tx.d));
      txDialog(tx.id, null);
      return;
    }
    if (prefs.tab !== "rec") setTab("rec");
    if (findIn(data.rec, rec)) recDialog(rec);
    else showToast(t("rec.gone"));
  }
  window.__orosOpenAt = openTarget;
  function takeTarget() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") openTarget(p.__orosTakeTarget("budget"));
    } catch (e) {}
  }

  function takeStagedNew() {
    var raw = null;
    try {
      raw = sessionStorage.getItem(NEW_KEY);
      if (raw !== null) sessionStorage.removeItem(NEW_KEY);
    } catch (e) {}
    if (raw === null) {
      try {
        var u = new URL(location.href);
        raw = u.searchParams.get("new");
        if (raw !== null) {
          u.searchParams.delete("new");
          history.replaceState(history.state, "", u.pathname + u.search + u.hash);
        }
      } catch (e) {}
    }
    if (!raw) return;
    var p = null;
    try { p = JSON.parse(raw); } catch (e) { return; }
    window.__orosBudgetNew(p);
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    materialize(true);
    renderAll();
    takeStagedNew();
    takeTarget();
  }

  boot();
})();
