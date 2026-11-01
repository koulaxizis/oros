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
    // orosI18n (../i18n.js): the full language code, a pack language included.
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "app": "Budget",
      "tab.list": "Entries", "tab.charts": "Charts", "tab.limits": "Limits", "tab.rec": "Recurring",
      "sum.in": "Income", "sum.out": "Expenses", "sum.bal": "Balance",
      "btn.add": "New", "btn.add.aria": "New entry (N)", "btn.prev": "Previous month", "btn.next": "Next month",
      "btn.menu": "More", "btn.today": "This month",
      "menu.cats": "Categories", "menu.export": "Export", "menu.backup": "Backup (JSON)",
      "menu.restore": "Restore from backup", "menu.currency": "Currency",
      "menu.osave": "orOS file (.orosbudget)", "menu.oopen": "Open orOS file…", "menu.ofolder": "Unzipped orOS folder…",
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
      "cur.title": "Main currency", "cur.hint": "Every total is in this currency. An entry or an account can be in another one (pick it there); changing this does not convert the amounts already here.",
      "live.month": "{m}", "live.saved": "Saved",
      "menu.accounts": "Accounts", "acc.title": "Accounts", "acc.new": "New account", "acc.edit": "Edit account",
      "acc.name": "Name", "acc.name.ph": "Cash, Card, Bank…", "acc.open": "Starting balance",
      "acc.open.hint": "What it held before your first entry here. A minus sign for a debt.",
      "acc.hint": "Pick an account in an entry to keep its balance. Entries without an account still count in the totals.",
      "acc.empty": "No accounts yet: Budget works without them too.", "acc.none": "No account",
      "acc.bal": "Balances today", "acc.deleted": "Account deleted", "acc.full": "Up to {n} accounts",
      "acc.keep": "Its entries stay, without an account.", "acc.open.aria": "Open the accounts",
      "f.acc": "Account", "f.crm": "Partner in CRM", "err.name": "Write a name", "err.open": "Type a balance, for example -120,50",
      "xf.btn": "Transfer", "xf.new": "Transfer between accounts", "xf.edit": "Edit transfer",
      "xf.from": "From", "xf.to": "To", "xf.need": "Make two accounts first", "xf.deleted": "Transfer deleted",
      "err.same": "Pick two different accounts", "flt.xfer": "Transfers only", "flt.accs": "Accounts",
      "xf.aria": "Transfer {a} from {f} to {t}, {d}", "col.acc": "Account",
      "exp.sheet": "Open in Spreadsheet", "exp.sheetCap": "Only the first {n} entries fit in one sheet",
      "menu.bank": "Import bank statement", "menu.banks": "Banks (automatic)", "menu.rules": "Rules",
      "flt.inbox": "Imported, no category ({n})", "inbox.bar": "{n} imported entries without a category",
      "inbox.hint": "Pick a category for each one. Next time a rule can do it for you.",
      "inbox.run": "Apply rules", "inbox.rule": "Rule…", "inbox.done": "Category set",
      "learn.ask": "Category changed", "learn.yes": "Always for “{q}”", "learn.done": "From now on “{q}” goes to {c}",
      "inbox.empty": "Every imported entry has a category.", "inbox.cat": "Category for {x}",
      "tag.bank": "Imported from the bank", "tag.app": "Imported from another app",
      "menu.apps": "Import from another app",
      "tab.plan": "Plan", "f.cur": "Currency", "f.inMain": "In {c}", "f.inMain.hint": "What it cost in {c}: filled in from the rate, change it to what your bank charged.",
      "fx.of": "ECB rate of {d}.", "fx.off": "ECB rate of {d}: offline, the last saved.", "fx.none": "No exchange rates on this device yet (offline): type the amount in {c} yourself.",
      "fx.loading": "Getting the exchange rates…", "fx.rate": "1 {a} = {r} {b}",
      "err.inMain": "Type the amount in {c} too",
      "rc.title": "Receipt", "rc.add": "Add a receipt photo or PDF", "rc.open": "Receipt {n}", "rc.pdf": "PDF",
      "rc.missing": "Not on this device", "rc.missingLong": "This file is not on this device. Vault Drive brings it over from your other devices.",
      "rc.where": "Kept in Files, folder Budget/Receipts.", "rc.remove": "Remove", "rc.openPdf": "Open", "rc.save": "Save a copy",
      "rc.bad": "Not a photo or a PDF (up to 10 MB)", "rc.noDisk": "Couldn't save the file to the orOS disk",
      "rc.text": "Read the total from text", "rc.textDlg": "Total from receipt text",
      "rc.textHint": "Paste the receipt's text (for example with your phone's “copy text from photo”). Budget looks for the line with the total.",
      "rc.textGo": "Use this amount", "rc.textNone": "No amount found in this text", "rc.textFound": "Total found: {a}",
      "rec.remind": "Remind me", "rec.rOff": "No reminder", "rec.r0": "On the day of the charge", "rec.r1": "1 day before", "rec.rN": "{n} days before",
      "acc.cur": "Currency of the account", "acc.netw": "Net worth", "xf.ta": "Arrived ({c})",
      "notif.sub": "Upcoming charge", "notif.subBody": "{n}: {a} {w}", "notif.w0": "today", "notif.w1": "tomorrow", "notif.wN": "on {d}",
      // month and weekday names (section 6: monthLabel, dayLabel)
      "month.1": "January", "month.2": "February", "month.3": "March", "month.4": "April", "month.5": "May", "month.6": "June",
      "month.7": "July", "month.8": "August", "month.9": "September", "month.10": "October", "month.11": "November", "month.12": "December",
      "monthGen.1": "January", "monthGen.2": "February", "monthGen.3": "March", "monthGen.4": "April", "monthGen.5": "May", "monthGen.6": "June",
      "monthGen.7": "July", "monthGen.8": "August", "monthGen.9": "September", "monthGen.10": "October", "monthGen.11": "November", "monthGen.12": "December",
      "monthShort.1": "Jan", "monthShort.2": "Feb", "monthShort.3": "Mar", "monthShort.4": "Apr", "monthShort.5": "May", "monthShort.6": "Jun", "monthShort.7": "Jul", "monthShort.8": "Aug", "monthShort.9": "Sep", "monthShort.10": "Oct", "monthShort.11": "Nov", "monthShort.12": "Dec",
      "wd.0": "Sunday", "wd.1": "Monday", "wd.2": "Tuesday", "wd.3": "Wednesday", "wd.4": "Thursday", "wd.5": "Friday", "wd.6": "Saturday",
      "wdAcc.0": "Sunday", "wdAcc.1": "Monday", "wdAcc.2": "Tuesday", "wdAcc.3": "Wednesday", "wdAcc.4": "Thursday", "wdAcc.5": "Friday", "wdAcc.6": "Saturday",
      "date.month": "{m} {y}", "date.dm": "{d} {m}", "date.day": "{w} {dm}"
    },
    el: {
      "app": "Έσοδα & Έξοδα",
      "tab.list": "Κινήσεις", "tab.charts": "Γραφήματα", "tab.limits": "Όρια", "tab.rec": "Πάγια",
      "sum.in": "Έσοδα", "sum.out": "Έξοδα", "sum.bal": "Υπόλοιπο",
      "btn.add": "Νέα", "btn.add.aria": "Νέα κίνηση (N)", "btn.prev": "Προηγούμενος μήνας", "btn.next": "Επόμενος μήνας",
      "btn.menu": "Περισσότερα", "btn.today": "Τρέχων μήνας",
      "menu.cats": "Κατηγορίες", "menu.export": "Εξαγωγή", "menu.backup": "Αντίγραφο ασφαλείας (JSON)",
      "menu.restore": "Επαναφορά από αντίγραφο", "menu.currency": "Νόμισμα",
      "menu.osave": "Αρχείο orOS (.orosbudget)", "menu.oopen": "Άνοιγμα αρχείου orOS…", "menu.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
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
      "cur.title": "Κύριο νόμισμα", "cur.hint": "Όλα τα σύνολα είναι σε αυτό το νόμισμα. Μια κίνηση ή ένας λογαριασμός μπορεί να είναι σε άλλο (το διαλέγεις εκεί)· η αλλαγή του δεν μετατρέπει τα ποσά που υπάρχουν ήδη.",
      "live.month": "{m}", "live.saved": "Αποθηκεύτηκε",
      "menu.accounts": "Λογαριασμοί", "acc.title": "Λογαριασμοί", "acc.new": "Νέος λογαριασμός", "acc.edit": "Επεξεργασία λογαριασμού",
      "acc.name": "Όνομα", "acc.name.ph": "Μετρητά, Κάρτα, Τράπεζα…", "acc.open": "Αρχικό υπόλοιπο",
      "acc.open.hint": "Όσα είχε πριν από την πρώτη κίνησή του εδώ. Με μείον για χρέος.",
      "acc.hint": "Διάλεξε λογαριασμό σε μια κίνηση για να κρατάς το υπόλοιπό του. Οι κινήσεις χωρίς λογαριασμό μετρούν κανονικά στα σύνολα.",
      "acc.empty": "Δεν υπάρχουν λογαριασμοί: η εφαρμογή δουλεύει και χωρίς αυτούς.", "acc.none": "Χωρίς λογαριασμό",
      "acc.bal": "Υπόλοιπα σήμερα", "acc.deleted": "Ο λογαριασμός διαγράφηκε", "acc.full": "Έως {n} λογαριασμοί",
      "acc.keep": "Οι κινήσεις του μένουν, χωρίς λογαριασμό.", "acc.open.aria": "Άνοιγμα λογαριασμών",
      "f.acc": "Λογαριασμός", "f.crm": "Συνεργάτης στο CRM", "err.name": "Γράψε ένα όνομα", "err.open": "Γράψε ένα ποσό, για παράδειγμα -120,50",
      "xf.btn": "Μεταφορά", "xf.new": "Μεταφορά μεταξύ λογαριασμών", "xf.edit": "Επεξεργασία μεταφοράς",
      "xf.from": "Από", "xf.to": "Προς", "xf.need": "Φτιάξε πρώτα δύο λογαριασμούς", "xf.deleted": "Η μεταφορά διαγράφηκε",
      "err.same": "Διάλεξε δύο διαφορετικούς λογαριασμούς", "flt.xfer": "Μόνο μεταφορές", "flt.accs": "Λογαριασμοί",
      "xf.aria": "Μεταφορά {a} από {f} προς {t}, {d}", "col.acc": "Λογαριασμός",
      "exp.sheet": "Άνοιγμα στα Λογιστικά φύλλα", "exp.sheetCap": "Χωρούν μόνο οι πρώτες {n} κινήσεις σε ένα φύλλο",
      "menu.bank": "Εισαγωγή κίνησης λογαριασμού", "menu.banks": "Τράπεζες (αυτόματα)", "menu.rules": "Κανόνες",
      "flt.inbox": "Εισαγόμενες χωρίς κατηγορία ({n})", "inbox.bar": "{n} εισαγόμενες κινήσεις χωρίς κατηγορία",
      "inbox.hint": "Διάλεξε κατηγορία για την καθεμία. Την επόμενη φορά μπορεί να το κάνει ένας κανόνας.",
      "inbox.run": "Εφαρμογή κανόνων", "inbox.rule": "Κανόνας…", "inbox.done": "Η κατηγορία μπήκε",
      "learn.ask": "Η κατηγορία άλλαξε", "learn.yes": "Πάντα για «{q}»", "learn.done": "Από εδώ και πέρα το «{q}» πάει στο {c}",
      "inbox.empty": "Όλες οι εισαγόμενες κινήσεις έχουν κατηγορία.", "inbox.cat": "Κατηγορία για {x}",
      "tag.bank": "Από την τράπεζα", "tag.app": "Από άλλη εφαρμογή",
      "menu.apps": "Εισαγωγή από άλλη εφαρμογή",
      "tab.plan": "Πλάνο", "f.cur": "Νόμισμα", "f.inMain": "Σε {c}", "f.inMain.hint": "Πόσο κόστισε σε {c}: συμπληρώνεται από την ισοτιμία, άλλαξέ το σε ό,τι χρέωσε η τράπεζά σου.",
      "fx.of": "Ισοτιμία ΕΚΤ της {d}.", "fx.off": "Ισοτιμία ΕΚΤ της {d}: εκτός σύνδεσης, η τελευταία αποθηκευμένη.", "fx.none": "Δεν υπάρχουν ακόμα ισοτιμίες σε αυτή τη συσκευή (εκτός σύνδεσης): γράψε μόνος σου το ποσό σε {c}.",
      "fx.loading": "Λήψη ισοτιμιών…", "fx.rate": "1 {a} = {r} {b}",
      "err.inMain": "Γράψε και το ποσό σε {c}",
      "rc.title": "Απόδειξη", "rc.add": "Προσθήκη φωτογραφίας ή PDF απόδειξης", "rc.open": "Απόδειξη {n}", "rc.pdf": "PDF",
      "rc.missing": "Όχι σε αυτή τη συσκευή", "rc.missingLong": "Το αρχείο δεν είναι σε αυτή τη συσκευή. Το Vault Drive το φέρνει από τις άλλες συσκευές σου.",
      "rc.where": "Φυλάσσεται στα Αρχεία, φάκελος Budget/Receipts.", "rc.remove": "Αφαίρεση", "rc.openPdf": "Άνοιγμα", "rc.save": "Αποθήκευση αντιγράφου",
      "rc.bad": "Δεν είναι φωτογραφία ή PDF (έως 10 MB)", "rc.noDisk": "Δεν ήταν δυνατή η αποθήκευση στον δίσκο του orOS",
      "rc.text": "Ανάγνωση συνόλου από κείμενο", "rc.textDlg": "Σύνολο από το κείμενο της απόδειξης",
      "rc.textHint": "Επικόλλησε το κείμενο της απόδειξης (για παράδειγμα με την «αντιγραφή κειμένου από φωτογραφία» του κινητού σου). Η εφαρμογή ψάχνει τη γραμμή με το σύνολο.",
      "rc.textGo": "Χρήση αυτού του ποσού", "rc.textNone": "Δεν βρέθηκε ποσό σε αυτό το κείμενο", "rc.textFound": "Βρέθηκε σύνολο: {a}",
      "rec.remind": "Υπενθύμιση", "rec.rOff": "Χωρίς υπενθύμιση", "rec.r0": "Την ημέρα της χρέωσης", "rec.r1": "1 ημέρα πριν", "rec.rN": "{n} ημέρες πριν",
      "acc.cur": "Νόμισμα λογαριασμού", "acc.netw": "Καθαρή περιουσία", "xf.ta": "Έφτασαν ({c})",
      "notif.sub": "Επερχόμενη χρέωση", "notif.subBody": "{n}: {a} {w}", "notif.w0": "σήμερα", "notif.w1": "αύριο", "notif.wN": "στις {d}",
      "month.1": "\u0399\u03b1\u03bd\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2", "month.2": "\u03a6\u03b5\u03b2\u03c1\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2", "month.3": "\u039c\u03ac\u03c1\u03c4\u03b9\u03bf\u03c2", "month.4": "\u0391\u03c0\u03c1\u03af\u03bb\u03b9\u03bf\u03c2", "month.5": "\u039c\u03ac\u03b9\u03bf\u03c2", "month.6": "\u0399\u03bf\u03cd\u03bd\u03b9\u03bf\u03c2",
      "month.7": "\u0399\u03bf\u03cd\u03bb\u03b9\u03bf\u03c2", "month.8": "\u0391\u03cd\u03b3\u03bf\u03c5\u03c3\u03c4\u03bf\u03c2", "month.9": "\u03a3\u03b5\u03c0\u03c4\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2", "month.10": "\u039f\u03ba\u03c4\u03ce\u03b2\u03c1\u03b9\u03bf\u03c2", "month.11": "\u039d\u03bf\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2", "month.12": "\u0394\u03b5\u03ba\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2",
      "monthGen.1": "\u0399\u03b1\u03bd\u03bf\u03c5\u03b1\u03c1\u03af\u03bf\u03c5", "monthGen.2": "\u03a6\u03b5\u03b2\u03c1\u03bf\u03c5\u03b1\u03c1\u03af\u03bf\u03c5", "monthGen.3": "\u039c\u03b1\u03c1\u03c4\u03af\u03bf\u03c5", "monthGen.4": "\u0391\u03c0\u03c1\u03b9\u03bb\u03af\u03bf\u03c5", "monthGen.5": "\u039c\u03b1\u0390\u03bf\u03c5", "monthGen.6": "\u0399\u03bf\u03c5\u03bd\u03af\u03bf\u03c5",
      "monthGen.7": "\u0399\u03bf\u03c5\u03bb\u03af\u03bf\u03c5", "monthGen.8": "\u0391\u03c5\u03b3\u03bf\u03cd\u03c3\u03c4\u03bf\u03c5", "monthGen.9": "\u03a3\u03b5\u03c0\u03c4\u03b5\u03bc\u03b2\u03c1\u03af\u03bf\u03c5", "monthGen.10": "\u039f\u03ba\u03c4\u03c9\u03b2\u03c1\u03af\u03bf\u03c5", "monthGen.11": "\u039d\u03bf\u03b5\u03bc\u03b2\u03c1\u03af\u03bf\u03c5", "monthGen.12": "\u0394\u03b5\u03ba\u03b5\u03bc\u03b2\u03c1\u03af\u03bf\u03c5",
      "monthShort.1": "\u0399\u03b1\u03bd", "monthShort.2": "\u03a6\u03b5\u03b2", "monthShort.3": "\u039c\u03b1\u03c1", "monthShort.4": "\u0391\u03c0\u03c1", "monthShort.5": "\u039c\u03ac\u03b9", "monthShort.6": "\u0399\u03bf\u03c5\u03bd", "monthShort.7": "\u0399\u03bf\u03c5\u03bb", "monthShort.8": "\u0391\u03c5\u03b3", "monthShort.9": "\u03a3\u03b5\u03c0", "monthShort.10": "\u039f\u03ba\u03c4", "monthShort.11": "\u039d\u03bf\u03b5", "monthShort.12": "\u0394\u03b5\u03ba",
      "wd.0": "\u039a\u03c5\u03c1\u03b9\u03b1\u03ba\u03ae", "wd.1": "\u0394\u03b5\u03c5\u03c4\u03ad\u03c1\u03b1", "wd.2": "\u03a4\u03c1\u03af\u03c4\u03b7", "wd.3": "\u03a4\u03b5\u03c4\u03ac\u03c1\u03c4\u03b7", "wd.4": "\u03a0\u03ad\u03bc\u03c0\u03c4\u03b7", "wd.5": "\u03a0\u03b1\u03c1\u03b1\u03c3\u03ba\u03b5\u03c5\u03ae", "wd.6": "\u03a3\u03ac\u03b2\u03b2\u03b1\u03c4\u03bf",
      "wdAcc.0": "\u039a\u03c5\u03c1\u03b9\u03b1\u03ba\u03ae", "wdAcc.1": "\u0394\u03b5\u03c5\u03c4\u03ad\u03c1\u03b1", "wdAcc.2": "\u03a4\u03c1\u03af\u03c4\u03b7", "wdAcc.3": "\u03a4\u03b5\u03c4\u03ac\u03c1\u03c4\u03b7", "wdAcc.4": "\u03a0\u03ad\u03bc\u03c0\u03c4\u03b7", "wdAcc.5": "\u03a0\u03b1\u03c1\u03b1\u03c3\u03ba\u03b5\u03c5\u03ae", "wdAcc.6": "\u03a3\u03ac\u03b2\u03b2\u03b1\u03c4\u03bf",
      "date.month": "{m} {y}", "date.dm": "{d} {m}", "date.day": "{w} {dm}"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "budget", LANG);

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

  // Month and weekday names live in STRINGS: "month.1".."month.12",
  // "monthGen.*" ("8 October" / «8 Οκτωβρίου»), "monthShort.*",
  // "wd.0".."wd.6" (Sunday first), "wdAcc.*" ("every Monday" / «κάθε Δευτέρα»).
  function monthName(m) { return t("month." + m); }

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
  // Does the language write "12,50" (el, de, ...) rather than "12.50"?
  // orosI18n (../i18n.js, in the browser) gives a pack language's locale.
  function decComma(lang) {
    if (lang === "el") return true;
    if (!lang || lang === "en") return false;
    var I = typeof window !== "undefined" && window.orosI18n;
    try { return new Intl.NumberFormat(I ? I.locale(lang) : lang).format(1.5).indexOf(",") >= 0; } catch (e) { return false; }
  }
  // Cents → plain input text in the user's language ("12,50" / "12.50").
  function centsToInput(c, lang) {
    var s = (Math.floor(c / 100)) + (c % 100 ? (decComma(lang) ? "," : ".") + pad2(c % 100) : "");
    return s;
  }
  // The amount field's placeholder in the user's language.
  function zeroAmt(lang) { return decComma(lang) ? "0,00" : "0.00"; }
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
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(SEED_NAMES, "budget", LANG);
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
  // crm (since the CRM partner card, BR-CRM-LINK): the CRM partner an
  // entry is with, an opaque id written only when set; an older
  // version keeps it as a flat extra.
  var CRM_RE = /^[A-Za-z0-9_-]{1,60}$/;
  function normPrefill(p) {
    if (!p || typeof p !== "object" || !KINDS[p.k] || !okCents(p.a)) return null;
    var hasD = p.d !== undefined && p.d !== null && p.d !== "";
    if (hasD && !parseYmd(p.d)) return null;
    var out = { k: p.k, a: p.a, d: hasD ? p.d : "", n: normText(p.n, NOTE_LEN),
                c: typeof p.c === "string" && ID_RE.test(p.c) ? p.c : "",
                src: typeof p.src === "string" && SRC_RE.test(p.src) ? p.src : "" };
    if (typeof p.crm === "string" && CRM_RE.test(p.crm)) out.crm = p.crm;
    return out;
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
    return withExtras(withAcc({ id: x.id, m: x.m, d: x.d, a: x.a, k: x.k, c: c, n: normText(x.n, NOTE_LEN) }, x), txBank(x), AC_SKIP);
  }
  // Bank import marker on an entry (since 1.98): src "bank", ot (the
  // bank's own text, what rules match), fit (the bank's transaction id,
  // OFX FITID / CAMT reference). Checked here, then written in name
  // order together with any other flat extra (same order an older
  // version keeps them in, so both write the same canonical JSON).
  var SRC_TX_RE = /^[a-z0-9]{1,20}$/;
  function txBank(x) {
    var y = Object.assign({}, x);
    if (!(typeof y.src === "string" && SRC_TX_RE.test(y.src))) delete y.src;
    var ot = normText(y.ot, NOTE_LEN);
    if (ot) y.ot = ot; else delete y.ot;
    var fit = normText(y.fit, 80);
    if (fit) y.fit = fit; else delete y.fit;
    // Since wave 10: oc + oa = the amount as typed in another currency
    // (a stays the main-currency amount every total reads); rc = the
    // receipt file names on the orOS disk, one string, space-separated.
    if (!(okCur3(y.oc) && okCents(y.oa))) { delete y.oc; delete y.oa; }
    if (!(typeof y.rc === "string" && RC_STR_RE.test(y.rc))) delete y.rc;
    if (!(typeof y.crm === "string" && CRM_RE.test(y.crm))) delete y.crm;
    // Since BK-1: pp 1 = the row came from a PayPal activity file (the
    // bank's "PAYPAL *…" line for the same money is then a duplicate).
    if (y.pp !== 1) delete y.pp;
    return y;
  }
  var CUR3_RE = /^[A-Z]{3}$/;
  function okCur3(c) { return typeof c === "string" && CUR3_RE.test(c); }
  var RC_STR_RE = /^[a-z0-9.-]+( [a-z0-9.-]+){0,2}$/;
  // Import rule (since 1.98): "if the bank's text contains q (and/or
  // the amount is between lo and hi) → category c, kind k (the
  // category's), rename py, note nt". Keys in name order after id, m:
  // what an older version's carry-forward of an unknown collection
  // writes too (canonical JSON).
  var RULE_Q = 60;
  function normRule(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m) ||
        !KINDS[x.k] || typeof x.c !== "string" || !ID_RE.test(x.c)) return null;
    var q = normText(x.q, RULE_Q);
    var lo = isInt(x.lo) && x.lo > 0 && x.lo <= MAX_CENTS ? x.lo : 0;
    var hi = isInt(x.hi) && x.hi > 0 && x.hi <= MAX_CENTS ? x.hi : 0;
    if (lo && hi && hi < lo) hi = 0;
    if (!q && !lo && !hi) return null;
    return withExtras({ id: x.id, m: x.m, c: x.c, hi: hi, k: x.k, lo: lo, nt: normText(x.nt, 80), py: normText(x.py, RULE_Q), q: q }, x);
  }
  // Bank profile (since 1.98): how a bank's CSV reads, and which Budget
  // account its statements go to. sig = the folded header row, or
  // "ofx:<account>" / "camt:<IBAN>". Columns are 0-based, -1 = none.
  var SEPS = { ";": 1, ",": 1, "\t": 1, "|": 1 };
  var ENCS = { auto: 1, "utf-8": 1, "windows-1253": 1, "iso-8859-7": 1, "windows-1252": 1 };
  function colOf(v) { return isInt(v) && v >= -1 && v < 200 ? v : -1; }
  function normProf(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    return withExtras({ id: x.id, m: x.m,
      ac: typeof x.ac === "string" && ID_RE.test(x.ac) ? x.ac : "",
      ca: colOf(x.ca), ccr: colOf(x.ccr), cd: colOf(x.cd), cdb: colOf(x.cdb), cm: colOf(x.cm), cp: colOf(x.cp), cs: colOf(x.cs),
      dec: x.dec === "," ? "," : ".", df: x.df === "mdy" || x.df === "ymd" ? x.df : "dmy",
      enc: ENCS[x.enc] ? x.enc : "auto", inv: x.inv === true, n: n,
      sep: SEPS[x.sep] ? x.sep : ",", sig: typeof x.sig === "string" ? x.sig.slice(0, 400) : "" }, x);
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
    // nd (since wave 10): remind this many days before a charge (0–30, 0 = on the day).
    var y = Object.assign({}, x);
    if (!(isInt(y.nd) && y.nd >= 0 && y.nd <= 30)) delete y.nd;
    return withExtras(withAcc({ id: x.id, m: x.m, k: x.k, a: x.a, c: c, n: normText(x.n, NOTE_LEN), f: x.f, s: x.s, e: e }, x), y, AC_SKIP);
  }
  // Settings. Since wave 10: env (true = envelope budgeting on) and
  // envs ("YYYY-MM", the month it started), each written only when set,
  // in name order among the extras (what an older version keeps).
  var MK_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  function normSet(x) {
    if (!x || typeof x !== "object" || !okStamp(x.m)) return null;
    var y = Object.assign({}, x);
    if (y.env !== true) delete y.env;
    if (!(typeof y.envs === "string" && MK_RE.test(y.envs))) delete y.envs;
    return withExtras({ m: x.m, cur: CURRENCIES.indexOf(x.cur) >= 0 ? x.cur : "EUR" }, y);
  }

  // account = { id, m, n (name), o (starting balance in cents, may be
  // negative), col (0–8) }
  function normAcc(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    var o = isInt(x.o) && Math.abs(x.o) <= MAX_CENTS ? x.o : 0;
    var col = isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : 8;
    // cur (since wave 10): the account's own currency; absent = the main one.
    // Its starting balance is in that currency.
    var y = Object.assign({}, x);
    if (!okCur3(y.cur)) delete y.cur;
    return withExtras({ id: x.id, m: x.m, n: n, o: o, col: col }, y);
  }
  // transfer between two accounts = { id, m, d, a (cents > 0), f (from), t (to), n }.
  // Not income, not an expense: it only moves money between balances.
  // ta (since wave 10): what reached the to-account, in its currency,
  // when the two accounts have different currencies (a = the from one's).
  function normXfer(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !okStamp(x.m) || !parseYmd(x.d) || !okCents(x.a) || typeof x.f !== "string" || !ID_RE.test(x.f) ||
        typeof x.t !== "string" || !ID_RE.test(x.t) || x.f === x.t) return null;
    var y = Object.assign({}, x);
    if (!okCents(y.ta)) delete y.ta;
    return withExtras({ id: x.id, m: x.m, d: x.d, a: x.a, f: x.f, t: x.t, n: normText(x.n, NOTE_LEN) }, y);
  }
  // Envelope assignment (since wave 10) = { id "<yyyymm>-<category id |
  // none>", m, a (signed cents), c (category id, "" = uncategorised),
  // mk "YYYY-MM" }: one per envelope and month (LWW, never summed).
  function asgId(mk, c) { return mk.replace("-", "") + "-" + (c || "none"); }
  function normAsg(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m) ||
        typeof x.mk !== "string" || !MK_RE.test(x.mk) || !isInt(x.a) || Math.abs(x.a) > MAX_CENTS) return null;
    var c = typeof x.c === "string" && ID_RE.test(x.c) ? x.c : "";
    if (x.id !== asgId(x.mk, c)) return null;
    return withExtras({ id: x.id, m: x.m, a: x.a, c: c, mk: x.mk }, x);
  }
  // Savings goal (since wave 10) = { id, m, ac (account id | ""), col
  // 0–8, d (target date | ""), n (name), sv (put aside by hand, cents),
  // t (target, cents > 0) }: keys in name order after id, m.
  var GOAL_NAME = 40;
  function normGoal(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m) || !okCents(x.t)) return null;
    var n = normText(x.n, GOAL_NAME);
    if (!n) return null;
    return withExtras({ id: x.id, m: x.m,
      ac: typeof x.ac === "string" && ID_RE.test(x.ac) ? x.ac : "",
      col: isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : 2,
      d: parseYmd(x.d) ? x.d : "", n: n,
      sv: isInt(x.sv) && x.sv >= 0 && x.sv <= MAX_CENTS ? x.sv : 0, t: x.t }, x);
  }

  // Connected bank account (since BK-2, budget/bankapi.js) = { id, m,
  // ac (Budget account | ""), bk (bank name), cty (country), cu
  // (currency), ib (last four of the account number), ih (the
  // provider's hash of the account, to find it again after a renewed
  // consent), la (the Connected services account in orOS that holds
  // the keys), lf (last booked day fetched, "" = never), nm (the
  // bank's name for the account), ps ("personal" | "business"), sid
  // (consent session), uid (the account in that session), vu (consent
  // end, ms) }: keys in name order after id, m. Nothing secret: a
  // session or account id is useless without the person's key.
  var EB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function normBnk(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !okStamp(x.m) ||
        typeof x.la !== "string" || !/^[a-z0-9]{8,24}$/.test(x.la)) return null;
    // PayPal Business (BK-3): a Connected services account, no bank session
    if (x.src === "pp") {
      return withExtras({ id: x.id, m: x.m,
        ac: typeof x.ac === "string" && ID_RE.test(x.ac) ? x.ac : "",
        bk: "PayPal", la: x.la, lf: parseYmd(x.lf) ? x.lf : "", nm: normText(x.nm, 40), src: "pp" }, x);
    }
    if (typeof x.sid !== "string" || !EB_UUID.test(x.sid) || typeof x.uid !== "string" || !EB_UUID.test(x.uid)) return null;
    var bk = normText(x.bk, 120);
    if (!bk || typeof x.cty !== "string" || !/^[A-Z]{2}$/.test(x.cty)) return null;
    return withExtras({ id: x.id, m: x.m,
      ac: typeof x.ac === "string" && ID_RE.test(x.ac) ? x.ac : "",
      bk: bk, cty: x.cty, cu: okCur3(x.cu) ? x.cu : "",
      ib: typeof x.ib === "string" && /^[A-Za-z0-9]{4}$/.test(x.ib) ? x.ib : "",
      ih: normText(x.ih, 120), la: x.la,
      lf: parseYmd(x.lf) ? x.lf : "", nm: normText(x.nm, 40),
      ps: x.ps === "business" ? "business" : "personal",
      sid: x.sid, uid: x.uid,
      vu: isInt(x.vu) && x.vu > 0 && x.vu < 1e14 ? x.vu : 0 }, x);
  }

  var COLLS = [
    { key: "tx",   tomb: "tx",  norm: normTx },
    { key: "cats", tomb: "cat", norm: normCat },
    { key: "bud",  tomb: null,  norm: normBud },
    { key: "rec",  tomb: "rec", norm: normRec },
    { key: "acc",  tomb: "acc", norm: normAcc },
    { key: "xfer", tomb: "xfer", norm: normXfer },
    { key: "asg",  tomb: "asg",  norm: normAsg },    // in name order: where an older
    { key: "goal", tomb: "goal", norm: normGoal },   // version puts unknown collections
    { key: "prof", tomb: "prof", norm: normProf },
    { key: "rule", tomb: "rule", norm: normRule },
    { key: "bnk",  tomb: "bnk",  norm: normBnk }     // since BK-2: after the others (an older version's place for it)
  ];
  // Known prefixes tx/cat/rec; a newer version's collection "<key>"
  // uses the tombstone prefix "<key>:" (2–8 lowercase letters).
  var TOMB_RE = /^[a-z]{2,8}:[a-z0-9-]{1,64}$/;
  var KNOWN_TOP = { ver: 1, tx: 1, cats: 1, cat: 1, bud: 1, rec: 1, acc: 1, xfer: 1, asg: 1, goal: 1, rule: 1, prof: 1, bnk: 1, set: 1, tombs: 1 };
  var OTHER_RE = /^[a-z]{2,8}$/;

  function emptyData() { return { ver: DATA_VER, tx: [], cats: [], bud: [], rec: [], acc: [], xfer: [], asg: [], goal: [], prof: [], rule: [], bnk: [], set: { m: 0, cur: "EUR" }, tombs: {} }; }

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
  var TABS = ["list", "plan", "charts", "limits", "rec"];

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
      tab: TABS.indexOf(p.tab) >= 0 ? p.tab : "list",
      csv: p.csv === "std" || p.csv === "excel" ? p.csv : (decComma(LANG) ? "excel" : "std"),
      rv: p.rv === "subs" ? "subs" : "all",                                     // Recurring tab: all | subscriptions
      nh: isInt(p.nh) && p.nh >= -1 && p.nh <= 23 ? p.nh : 9                   // subscription reminders: hour, -1 = off here
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
  // Planning core (budget/plan.js) and its screens (budget/planui.js).
  var PLAN = window.OrosBudgetPlan || null;
  // Balances today, each in its account's own currency.
  function balNow() { return PLAN ? PLAN.balancesFx(data, today, cur(), fx) : accBalances(data, today); }
  function accCur(a) { return (a && a.cur) || cur(); }
  // One account's balance today in the main currency (null: no rate).
  function accBalanceMain(id) {
    var a = findIn(data.acc, id);
    if (!a) return null;
    return fx(balNow()[id], accCur(a), cur());
  }

  var fmtCache = {};
  function money(cents, code) {
    var key = code || cur();
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
  // Whole units, no symbol: the year table (its heading names the currency).
  var plainFmt = null;
  function moneyPlain(cents) {
    if (!plainFmt) {
      try { plainFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }); }
      catch (e) { plainFmt = { format: function (v) { return String(Math.round(v)); } }; }
    }
    return plainFmt.format(Math.round(cents / 100));
  }

  // ---------- Exchange rates (since wave 10) ----------
  // Unit Converter's rates (units/core.js): ONE fetcher and ONE cache
  // on the device ("oros-units-rates"), ECB reference rates through
  // Frankfurter. Fetched only when Budget has something in another
  // currency (an account, an entry, or one being typed), at most every
  // 6 hours; offline, the last saved rates are used and said so.
  var UC = window.UnitsCore && typeof window.UnitsCore.fetchLatest === "function" && typeof window.UnitsCore.crossRate === "function" ? window.UnitsCore : null;
  var rates = null, fxState = "";   // "" | "loading" | "failed"
  function loadFx() {
    rates = null;
    if (!UC) return;
    try { rates = UC.storedRates(JSON.parse(localStorage.getItem(UC.RATES_KEY) || "null")); } catch (e) { rates = null; }
  }
  function fx(cents, from, to) {
    if (from === to) return cents;
    var k = UC && rates ? UC.crossRate(rates, from, to) : null;
    return k === null || k === undefined ? null : Math.round(cents * k);
  }
  function usesFx() {
    var c = cur();
    return data.acc.some(function (a) { return a.cur && a.cur !== c; }) || data.tx.some(function (x) { return x.oc && x.oc !== c; });
  }
  function refreshFx(force, then) {
    if (!UC || fxState === "loading") return;
    if (!force && !UC.ratesStale(rates, Date.now())) return;
    if (navigator.onLine === false) { fxState = "failed"; if (then) then(); return; }
    fxState = "loading";
    UC.fetchLatest(function (u, o) { return fetch(u, o); }, Date.now()).then(function (r) {
      rates = r;
      fxState = "";
      try { localStorage.setItem(UC.RATES_KEY, JSON.stringify(r)); } catch (e) {}
      if (then) then();
      renderAll();
    }, function () {
      fxState = "failed";
      if (then) then();
    });
  }
  function fxNote() {
    if (!rates) return fxState === "loading" ? t("fx.loading") : t("fx.none", { c: cur() });
    var off = fxState === "failed" || (navigator.onLine === false && UC && UC.ratesStale(rates, Date.now()));
    return t(off ? "fx.off" : "fx.of", { d: dateShort(rates.date) });
  }
  function monthLabel(mk) { return t("date.month", { m: monthName(+mk.slice(5, 7)), y: mk.slice(0, 4) }); }
  function monthShort(mk) { return t("monthShort." + (+mk.slice(5, 7))); }
  function dayMonth(p) { return t("date.dm", { d: p.d, m: t("monthGen." + p.m) }); }
  function dayLabel(ymd) {
    return t("date.day", { w: t("wd." + weekday(ymd)), dm: dayMonth(parseYmd(ymd)) });
  }
  function dateShort(ymd) {   // dd/mm/yyyy (Greek, en-GB); a pack language: its locale (de: dd.mm.yyyy)
    var p = parseYmd(ymd);
    if (LANG !== "en" && LANG !== "el") {
      try {
        return new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
          .format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
      } catch (e) {}
    }
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
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-6 9 6"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8"/><path d="M3 21h18"/></svg>',
    over: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 16.5h.01"/></svg>',
    clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
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
    if (prefs.tab === "plan") renderPlanTab();
    if (prefs.tab === "charts") renderCharts();
    if (prefs.tab === "limits") renderLimits();
    if (prefs.tab === "rec") renderRec();
  }
  function renderPlanTab() { if (PLANUI) PLANUI.renderPlan($("plan")); }

  function renderToolbar() {
    $("month").textContent = monthLabel(viewMk);
    $("today-btn").hidden = viewMk === mkOf(today);
  }

  function renderTabs() {
    TABS.forEach(function (k) {
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
    var bal = balNow();
    var btn = el("button", "acc-chips");
    btn.type = "button";
    btn.setAttribute("aria-label", t("acc.open.aria"));
    btn.title = t("acc.bal");
    list.forEach(function (a) {
      var c = el("span", "acc-chip");
      c.appendChild(swatch(a.col));
      c.appendChild(el("span", "acc-chip-n", a.n));
      var v = el("span", "acc-chip-v" + (bal[a.id] < 0 ? " neg" : ""), money(bal[a.id], a.cur));
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
    var nIn = inboxCount();
    if (nIn || prev === "inbox") add("inbox", t("flt.inbox", { n: nIn }));
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

  // Imported from a bank and still without a category (the "inbox").
  function inInbox(x) { return (x.src === "bank" || x.src === "imp") && !x.c; }
  function inboxCount() { var n = 0; data.tx.forEach(function (x) { if (inInbox(x)) n++; }); return n; }
  function matches(x) {
    if (filter === "inbox" && !inInbox(x)) return false;
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
    var inbox = filter === "inbox";
    renderInboxBar();
    var rows = data.tx.filter(function (x) {
      return (query || inbox || mkOf(x.d) === viewMk) && matches(x);
    }).concat(inbox ? [] : data.xfer.filter(function (x) {
      return (query || mkOf(x.d) === viewMk) && xferMatches(x);
    }));
    rows.sort(function (a, b) { return cmpStr(b.d, a.d) || b.m - a.m || cmpStr(b.id, a.id); });
    var empty = $("list-empty"), found = $("list-found");
    found.hidden = !query;
    if (query) found.textContent = t("list.found", { n: rows.length });
    empty.hidden = rows.length > 0;
    empty.textContent = inbox && !query ? t("inbox.empty") : (query || filter !== "all") ? t("list.none") : t("list.empty");
    var day = null, group = null, dayIn = 0, dayOut = 0, totEl = null;
    var flushDay = function () {
      if (totEl) totEl.textContent = (dayIn ? "+" + money(dayIn) + "  " : "") + (dayOut ? "−" + money(dayOut) : "");
    };
    rows.forEach(function (x) {
      if (x.d !== day) {
        flushDay();
        day = x.d; dayIn = 0; dayOut = 0;
        var head = el("div", "day-head");
        head.appendChild(el("span", "day-name", dayLabel(x.d) + (query || inbox ? " " + x.d.slice(0, 4) : "")));
        totEl = el("span", "day-tot");
        totEl.title = t("day.total");
        head.appendChild(totEl);
        box.appendChild(head);
        group = el("ul", "day-list");
        box.appendChild(group);
      }
      if (!x.k) { group.appendChild(xferRow(x)); return; }   // a transfer: not in the day total
      if (x.k === "i") dayIn += x.a; else dayOut += x.a;
      group.appendChild(inbox ? inboxRow(x) : txRow(x));
    });
    flushDay();
  }
  // The bar over the list: a way into the inbox, or, inside it, a hint
  // and the rule buttons.
  function renderInboxBar() {
    if (BANKLIVE) BANKLIVE.bar($("bank-bar"));
    var bar = $("inbox-bar"), n = inboxCount();
    bar.innerHTML = "";
    if (filter === "inbox") {
      bar.hidden = false;
      bar.className = "inbox-bar in";
      bar.appendChild(el("p", "hint", t("inbox.hint")));
      if (BANKUI) {
        var acts = el("div", "inbox-acts");
        if (data.rule.length && n) {
          var run = el("button", "mini", t("inbox.run"));
          run.type = "button";
          run.addEventListener("click", function () { BANKUI.rerun(); });
          acts.appendChild(run);
        }
        var rb = el("button", "mini", t("menu.rules"));
        rb.type = "button";
        rb.addEventListener("click", function () { BANKUI.rules(); });
        acts.appendChild(rb);
        bar.appendChild(acts);
      }
      return;
    }
    bar.hidden = !n;
    bar.className = "inbox-bar";
    if (!n) return;
    var b = el("button", "inbox-go");
    b.type = "button";
    var ic = el("span", "ic");
    ic.innerHTML = UI.bank;
    b.appendChild(ic);
    b.appendChild(el("span", "", t("inbox.bar", { n: n })));
    b.addEventListener("click", function () {
      filter = "inbox";
      query = "";
      $("q").value = "";
      renderFilter();
      renderList();
    });
    bar.appendChild(b);
  }
  // An inbox row: the entry, then its category right there.
  function inboxRow(x) {
    var li = txRow(x);
    li.className = "inbox-li";
    var bot = el("div", "inbox-bot");
    var cs = catSelect(x.k, "");
    cs.value = "";
    cs.setAttribute("aria-label", t("inbox.cat", { x: x.n || money(x.a) }));
    cs.addEventListener("change", function () {
      if (!cs.value) return;
      applyChanges([{ id: x.id, c: cs.value, n: x.n }], t("inbox.done"), learnOffer(x, cs.value));
    });
    bot.appendChild(cs);
    if (BANKUI) {
      var rb = el("button", "mini", t("inbox.rule"));
      rb.type = "button";
      rb.addEventListener("click", function () { BANKUI.ruleFor({ k: x.k, c: cs.value, n: x.n, ot: x.ot }); });
      bot.appendChild(rb);
    }
    li.appendChild(bot);
    return li;
  }

  function txRow(x) {
    var li = el("li");
    var b = el("button", "tx " + (x.k === "i" ? "in" : "out"));
    b.type = "button";
    b.appendChild(swatch(catCol(x.c)));
    var mid = el("span", "tx-mid");
    mid.appendChild(el("span", "tx-cat", catName(x.c)));
    var an = accName(x.ac);
    var orig = x.oc && x.oc !== cur() ? money(x.oa, x.oc) : "";
    var sub = [an, orig, x.n].filter(Boolean).join(" · ");
    if (sub) mid.appendChild(el("span", "tx-note", sub));
    b.appendChild(mid);
    if (x.rc) {
      var rcI = el("span", "tx-rec");
      rcI.innerHTML = UI.clip;
      rcI.title = t("rc.title");
      rcI.setAttribute("aria-label", t("rc.title"));
      b.appendChild(rcI);
    }
    if (x.src === "bank" || x.src === "imp") {
      var bk = el("span", "tx-rec");
      bk.innerHTML = UI.bank;
      bk.title = t(x.src === "imp" ? "tag.app" : "tag.bank");
      bk.setAttribute("aria-label", bk.title);
      b.appendChild(bk);
    }
    if (x.id.charAt(0) === "r" && /-\d{8}$/.test(x.id)) {
      var r = el("span", "tx-rec");
      r.innerHTML = UI.repeat;
      r.title = t("rec.tag");
      r.setAttribute("aria-label", t("rec.tag"));
      b.appendChild(r);
    }
    b.appendChild(el("span", "tx-amt", (x.k === "i" ? "+" : "−") + money(x.a)));
    b.setAttribute("aria-label", t(x.k === "i" ? "k.in" : "k.out") + ", " + catName(x.c) +
      (an ? ", " + an : "") + (x.n ? ", " + x.n : "") + ", " + money(x.a) + (orig ? " (" + orig + ")" : "") + ", " + dateShort(x.d));
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
    var fa = findIn(data.acc, x.f), xa = money(x.a, fa && fa.cur);
    b.appendChild(el("span", "tx-amt", xa));
    b.setAttribute("aria-label", t("xf.aria", { a: xa, f: f, t: to, d: dateShort(x.d) }) + (x.n ? ", " + x.n : ""));
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
    if (r.f === "w") return t("rec.every.w", { d: t("wdAcc." + weekday(r.s)) });
    if (r.f === "y") return t("rec.every.y", { d: dayMonth(p) });
    return t("rec.every.m", { d: p.d });
  }
  function remindLabel(nd) {
    return t("rec.remind") + ": " + (nd === 0 ? t("rec.r0") : nd === 1 ? t("rec.r1") : t("rec.rN", { n: nd }));
  }
  function recNext(r) {
    var next = occurrences(r, addDays(today, 1), addDays(today, 400))[0];
    return next ? t("rec.next", { d: dateShort(next) }) : t("rec.ended");
  }

  function renderRec() {
    var box = $("rec");
    box.innerHTML = "";
    var subs = PLANUI && prefs.rv === "subs";
    if (PLANUI) PLANUI.renderRecHead($("rec-head"), prefs.rv, function (v) { prefs.rv = v; savePrefs(); renderRec(); });
    $("subs").hidden = !subs;
    if (subs) { $("rec-empty").hidden = true; PLANUI.renderSubs($("subs")); return; }
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
      if (isInt(r.nd)) {
        var bell = el("span", "tx-rec");
        bell.innerHTML = UI.bell;
        bell.title = remindLabel(r.nd);
        bell.setAttribute("aria-label", remindLabel(r.nd));
        b.appendChild(bell);
      }
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
    if (PLANUI) {
      PLANUI.renderYear($("ch-year"));
      PLANUI.renderNetWorth($("ch-nw"));
      if (data.acc.length && usesFx()) refreshFx(false);
    }
    $("ch-year").hidden = $("ch-nw").hidden = !PLANUI;
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
  // CRM partners to pick for an entry (read-only from CRM's data).
  function crmPartners() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem("oros-crm-data") || "null"); } catch (e) {}
    var list = o && Array.isArray(o.cust) ? o.cust : [];
    return list.filter(function (c) { return c && !c.del && typeof c.id === "string" && CRM_RE.test(c.id) && typeof c.name === "string" && c.name; })
      .map(function (c) { return { id: c.id, name: normText(c.name, 80) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); });
  }
  function crmSelect(selected) {
    var parts = crmPartners();
    if (!parts.length && !selected) return null;
    var sel = el("select");
    var none = el("option", "", "\u2014"); none.value = ""; sel.appendChild(none);
    parts.forEach(function (c) { var o = el("option", "", c.name); o.value = c.id; sel.appendChild(o); });
    if (selected && !parts.some(function (c) { return c.id === selected; })) {   // not on this device (yet): kept
      var k = el("option", "", selected); k.value = selected; sel.appendChild(k);
    }
    sel.value = selected || "";
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
    var main = cur();
    var foreign0 = x && x.oc && x.oc !== main && x.oa ? x.oc : "";
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.value = x ? centsToInput(foreign0 ? x.oa : x.a, LANG) : pre && pre.a ? centsToInput(pre.a, LANG) : "";
    amt.placeholder = zeroAmt(LANG);
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
    var accSel = null;
    if (data.acc.length) accSel = accSelect(x ? x.ac : lastAcc);
    // Amount + its currency. Another currency than the main one keeps
    // what was typed (oc, oa) and asks for the main amount (a), filled
    // in from Unit Converter's ECB rates and open to correction.
    var curSel = el("select");
    curSel.className = "cur-sel";
    [main].concat(CURRENCIES.filter(function (c) { return c !== main; })).forEach(function (c) {
      var o = el("option", "", c); o.value = c; curSel.appendChild(o);
    });
    var accA = accSel && accSel.value ? findIn(data.acc, accSel.value) : null;
    curSel.value = foreign0 || (!x && accA && accA.cur ? accA.cur : main);
    var curTouched = !!x, mainTouched = !!foreign0;
    var amtRow = el("div", "amt-row");
    amtRow.appendChild(field(t("f.amount"), amt, "bd-amt"));
    var cf = field(t("f.cur"), curSel, "bd-cur");
    cf.className = "fld cur-fld";
    amtRow.appendChild(cf);
    form.appendChild(amtRow);
    var inMain = el("input");
    inMain.inputMode = "decimal";
    inMain.autocomplete = "off";
    inMain.placeholder = zeroAmt(LANG);
    inMain.value = foreign0 ? centsToInput(x.a, LANG) : "";
    inMain.addEventListener("input", function () { mainTouched = true; });
    var mainF = field(t("f.inMain", { c: main }), inMain, "bd-inmain");
    var fxLine = el("p", "hint fx-line");
    mainF.appendChild(fxLine);
    form.appendChild(mainF);
    function syncCur() {
      var c = curSel.value, on = c !== main;
      mainF.hidden = !on;
      if (!on) return;
      var oc = parseAmount(amt.value);
      var r = oc === null ? null : fx(oc, c, main);
      if (!mainTouched && r !== null && r > 0) inMain.value = centsToInput(r, LANG);
      var one = fx(100000, c, main);
      fxLine.textContent = (one !== null ? t("fx.rate", { a: c, r: (one / 100000).toFixed(4).replace(".", decComma(LANG) ? "," : "."), b: main }) + " · " : "") + fxNote();
    }
    curSel.addEventListener("change", function () {
      curTouched = true;
      mainTouched = false;
      syncCur();
      if (curSel.value !== main) refreshFx(false, syncCur);
    });
    amt.addEventListener("input", syncCur);
    if (accSel) accSel.addEventListener("change", function () {
      if (curTouched || x) return;
      var a = findIn(data.acc, accSel.value);
      curSel.value = a && a.cur ? a.cur : main;
      mainTouched = false;
      syncCur();
      if (curSel.value !== main) refreshFx(false, syncCur);
    });
    syncCur();
    if (curSel.value !== main) refreshFx(false, syncCur);
    var row = el("div", "fld-row");
    row.appendChild(field(t("f.date"), date, "bd-date"));
    row.appendChild(field(t("f.cat"), sel, "bd-cat"));
    form.appendChild(row);
    if (accSel) form.appendChild(field(t("f.acc"), accSel, "bd-acc"));
    var crmSel = crmSelect(x ? x.crm || "" : (pre && pre.crm) || "");
    if (crmSel) form.appendChild(field(t("f.crm"), crmSel, "bd-crm"));
    form.appendChild(field(t("f.note"), note, "bd-note"));
    // Receipt photo / PDF on the orOS disk, and its total from text.
    var rowId = x ? x.id : newId();
    var rcb = PLAN ? receiptBox(dlg, x, rowId, date, function (cents) {
      amt.value = centsToInput(cents, LANG);
      mainTouched = false;
      syncCur();
    }) : null;
    if (rcb && rcb.wrap) form.appendChild(rcb.wrap);
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
      var typed = parseAmount(amt.value);
      if (typed === null) { showErr(err, t("err.amount"), amt); return; }
      var oc = curSel.value !== main ? curSel.value : "", cents = typed, oa = 0;
      if (oc) {
        cents = parseAmount(inMain.value);
        if (cents === null) { showErr(err, t("err.inMain", { c: main }), inMain); return; }
        oa = typed;
      }
      if (!parseYmd(date.value)) { showErr(err, t("err.date"), date); return; }
      var k = sw.get(), c = sel.value, n = normText(note.value, NOTE_LEN);
      var rc = rcb ? PLAN.rcJoin(rcb.names()) : "";
      // Without accounts the field is absent and an entry keeps its account.
      var cur0 = x ? findIn(data.tx, x.id) : null;   // may have changed by a pull meanwhile
      var ac = accSel ? accSel.value : (cur0 ? cur0.ac || "" : "");
      if (!rcb && cur0) rc = cur0.rc || "";
      // Without CRM partners the field is absent and an entry keeps its partner.
      var crm = crmSel ? crmSel.value : (cur0 ? cur0.crm || "" : (pre && pre.crm) || "");
      var offer = cur0 && cur0.c !== c ? learnOffer(cur0, c) : null;
      if (cur0) {
        if (cur0.d !== date.value || cur0.a !== cents || cur0.k !== k || cur0.c !== c || cur0.n !== n || (cur0.ac || "") !== ac ||
            (cur0.oc || "") !== oc || (cur0.oa || 0) !== oa || (cur0.rc || "") !== rc || (cur0.crm || "") !== crm) {
          cur0.d = date.value; cur0.a = cents; cur0.k = k; cur0.c = c; cur0.n = n;
          if (ac) cur0.ac = ac; else delete cur0.ac;
          if (crm) cur0.crm = crm; else delete cur0.crm;
          if (oc) { cur0.oc = oc; cur0.oa = oa; } else { delete cur0.oc; delete cur0.oa; }
          if (rc) cur0.rc = rc; else delete cur0.rc;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var nid = rowId;
        if (x) untomb("tx", nid);
        var nx = { id: nid, m: stamp(x ? x.m : (data.tombs["tx:" + nid] || 0)), d: date.value, a: cents, k: k, c: c, n: n };
        if (ac) nx.ac = ac;
        if (oc) { nx.oc = oc; nx.oa = oa; }
        if (rc) nx.rc = rc;
        if (crm) nx.crm = crm;
        data.tx.push(nx);
        commit();
      }
      if (rcb) rcb.commit();
      lastCat[k] = c;
      if (accSel) lastAcc = ac;
      dlg.close();
      if (k === "o") checkLimits(date.value, c);
      live(t("live.saved"));
      if (!x && mkOf(date.value) !== viewMk && !query) setMonth(mkOf(date.value));
      else renderAll();
      if (offer) localToast(t("learn.ask"), null, offer);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!x) (pre ? ok : amt).focus();
  }

  // ---------- Receipts on the orOS disk (since wave 10) ----------
  // The entry keeps file names only (`rc`); each file sits in Files
  // under Budget/Receipts and travels with Vault Drive when the user
  // runs it, never through the slice. Photos are re-drawn on a canvas
  // (long side 1600 px, JPEG 0.8, white background): no EXIF or
  // location is kept. PDFs (≤ 10 MB) are kept as they are, only when
  // their first bytes say "%PDF-".
  var RC_IMG_MAX = 40 * 1024 * 1024, RC_PDF_MAX = 10 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function rcRandom() {
    var a = new Uint8Array(8), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function looksPdf(file) { return !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")); }
  function encodeReceipt(file) {
    if (!file) return Promise.resolve(null);
    if (looksPdf(file)) {
      if (!file.size || file.size > RC_PDF_MAX) return Promise.resolve(null);
      return file.slice(0, 5).arrayBuffer().then(function (buf) {
        return PLAN.isPdfHead(new Uint8Array(buf)) ? { blob: file.slice(0, file.size, "application/pdf"), ext: "pdf" } : null;
      }).catch(function () { return null; });
    }
    if (file.size > RC_IMG_MAX) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
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
        cv.toBlob(function (b) { resolve(b && b.size ? { blob: b, ext: "jpg" } : null); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function rmReceipt(name) {
    var fs = fsApi(), path = PLAN ? PLAN.rcPath(name) : null;
    if (!fs || !path) return Promise.resolve();
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  // A deleted entry keeps its files through the Undo window; then any
  // name no entry points at any more leaves the disk.
  function dropReceiptsLater(names) {
    if (!PLAN || !names || !names.length || !fsApi()) return;
    var list = names.slice();
    setTimeout(function () {
      var used = PLAN.rcAll(data);
      list.forEach(function (n) { if (used.indexOf(n) < 0) rmReceipt(n); });
    }, 12000);
  }
  function openBlob(blob) {
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  // Files added while the editor is open are written at once and
  // removed again if it closes without saving; files taken off leave
  // the disk on save. onTotal(cents) fills the amount from text.
  function receiptBox(dlg, x, rowId, dateIn, onTotal) {
    var fs = fsApi();
    var cur0 = x ? PLAN.rcList(x.rc) : [], orig = cur0.slice(), added = [], urls = [], done = false;
    var wrap = el("div", "fld rc-fld");
    wrap.appendChild(el("div", "dlg-lbl", t("rc.title")));
    var grid = el("div", "rc-grid");
    wrap.appendChild(grid);
    var tb = el("button", "mini rc-text", t("rc.text"));
    tb.type = "button";
    tb.addEventListener("click", function () { totalFromText(onTotal); });
    wrap.appendChild(tb);
    function paint() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls = [];
      grid.innerHTML = "";
      cur0.forEach(function (name, i) {
        var b = el("button", "rc-th");
        b.type = "button";
        b.setAttribute("aria-label", t("rc.open", { n: i + 1 }));
        b.addEventListener("click", function () { viewer(name); });
        grid.appendChild(b);
        if (/\.pdf$/.test(name)) { b.appendChild(el("span", "rc-pdf", t("rc.pdf"))); return; }
        if (!fs) { b.appendChild(el("span", "rc-miss", t("rc.missing"))); return; }
        Promise.resolve(fs.readBlob(PLAN.rcPath(name))).then(function (blob) {
          if (!blob) throw new Error("ENOENT");
          var u = URL.createObjectURL(blob);
          urls.push(u);
          var im = el("img");
          im.alt = "";
          im.src = u;
          b.appendChild(im);
        }).catch(function () { b.appendChild(el("span", "rc-miss", t("rc.missing"))); });
      });
      if (fs && cur0.length < PLAN.RC_MAX) {
        var add = el("button", "rc-th rc-add", "+");
        add.type = "button";
        add.setAttribute("aria-label", t("rc.add"));
        add.title = t("rc.add");
        add.addEventListener("click", pick);
        grid.appendChild(add);
      }
    }
    function pick() {
      pickFile("image/*,application/pdf,.pdf").then(function (file) {
        if (!file) return;
        return encodeReceipt(file).then(function (enc) {
          if (!enc) { showToast(t("rc.bad")); return; }
          var name = PLAN.rcName(parseYmd(dateIn.value) ? dateIn.value : today, rowId, rcRandom(), enc.ext);
          if (!name) return;
          return Promise.resolve(fs.writeBlob(PLAN.rcPath(name), enc.blob)).then(function () {
            if (done) { rmReceipt(name); return; }
            added.push(name);
            cur0.push(name);
            cur0.sort(cmpStr);
            paint();
          });
        });
      }).catch(function () { showToast(t("rc.noDisk")); });
    }
    function viewer(name) {
      var v = makeDialog("bd-rc-view", t("rc.title"));
      var box = el("div", "rc-view");
      v.appendChild(box);
      var blobNow = null, pdf = /\.pdf$/.test(name);
      var acts = el("div", "dlg-actions");
      var openB = pdf ? button(t("rc.openPdf"), "", function () { if (blobNow) openBlob(blobNow); }) : null;
      var saveB = button(t("rc.save"), "", function () {
        if (blobNow) saveBlob(blobNow, name, pdf ? "application/pdf" : "image/jpeg", pdf ? "PDF" : "JPEG", pdf ? ".pdf" : ".jpg");
      });
      if (openB) { openB.disabled = true; acts.appendChild(openB); }
      saveB.disabled = true;
      acts.appendChild(saveB);
      if (fs) Promise.resolve(fs.readBlob(PLAN.rcPath(name))).then(function (blob) {
        if (!blob) throw new Error("ENOENT");
        blobNow = pdf ? blob.slice(0, blob.size, "application/pdf") : blob.slice(0, blob.size, "image/jpeg");
        if (pdf) box.appendChild(el("div", "rc-pdf big", t("rc.pdf")));
        else {
          var u = URL.createObjectURL(blobNow), im = el("img");
          im.alt = t("rc.title");
          im.src = u;
          box.appendChild(im);
          v.addEventListener("close", function () { setTimeout(function () { URL.revokeObjectURL(u); }, 1000); });
        }
        if (openB) openB.disabled = false;
        saveB.disabled = false;
      }).catch(function () { box.appendChild(el("p", "hint", t("rc.missingLong"))); });
      else box.appendChild(el("p", "hint", t("rc.missingLong")));
      v.appendChild(el("p", "hint", t("rc.where")));
      acts.appendChild(button(t("rc.remove"), "danger", function () {
        v.close();
        cur0 = cur0.filter(function (n) { return n !== name; });
        if (added.indexOf(name) >= 0) { added = added.filter(function (n) { return n !== name; }); rmReceipt(name); }
        paint();
      }));
      acts.appendChild(button(t("dlg.close"), "primary", function () { v.close(); }));
      v.appendChild(acts);
      document.body.appendChild(v);
      v.showModal();
    }
    dlg.addEventListener("close", function () {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      if (!done) { done = true; added.forEach(rmReceipt); }
    });
    paint();
    return {
      wrap: wrap,
      names: function () { return cur0.slice(); },
      commit: function () {
        done = true;
        var gone = orig.filter(function (n) { return cur0.indexOf(n) < 0; });
        if (gone.length) setTimeout(function () {
          var used = PLAN.rcAll(data);
          gone.forEach(function (n) { if (used.indexOf(n) < 0) rmReceipt(n); });
        }, 0);
      }
    };
  }
  // "Read the total from text": paste a receipt's text, Budget finds
  // the total line (OCR itself is not done here).
  function totalFromText(onTotal) {
    var dlg = makeDialog("bd-rc-text", t("rc.textDlg"));
    var form = el("form");
    form.appendChild(el("p", "hint", t("rc.textHint")));
    var ta = el("textarea", "rc-ta");
    ta.rows = 7;
    ta.maxLength = 20000;
    ta.setAttribute("aria-label", t("rc.textDlg"));
    form.appendChild(ta);
    var res = el("p", "rc-found");
    res.setAttribute("aria-live", "polite");
    form.appendChild(res);
    var found = null;
    ta.addEventListener("input", function () {
      found = PLAN.amountFromText(ta.value);
      res.textContent = ta.value.trim() ? (found !== null ? t("rc.textFound", { a: centsToInput(found, LANG) }) : t("rc.textNone")) : "";
      ok.disabled = found === null;
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("rc.textGo"), "primary", null);
    ok.type = "submit";
    ok.disabled = true;
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (found === null) return;
      dlg.close();
      onTotal(found);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
  }
  // Another app's display name, from the shell's strings ("app.<id>").
  function appName(id) {
    var n = "";
    try { n = window.parent && window.parent !== window && typeof window.parent.t === "function" ? window.parent.t("app." + id) : ""; } catch (e) {}
    return typeof n === "string" && n && n !== "app." + id ? n : id;
  }

  // Entries from Stripe / Invoice Ninja (budget/payments.js): one write; Undo
  // deletes them again (tombstones, like a delete).
  var PAY = window.OrosBudgetPay || null;
  function addEntries(rows, doneText) {
    var ids = [];
    rows.forEach(function (r) {
      if (findIn(data.tx, r.id)) return;
      data.tx.push(Object.assign({}, r, { m: stamp(data.tombs["tx:" + r.id] || 0) }));
      ids.push(r.id);
    });
    if (!ids.length) return;
    commit();
    renderAll();
    undoToast(doneText, function () {
      data.tx = data.tx.filter(function (y) { return ids.indexOf(y.id) < 0; });
      ids.forEach(function (id) { tombstone("tx", id); });
      commit();
      renderAll();
    });
  }
  function initPay() {
    if (!PAY) return;
    PAY.init({
      lang: LANG, el: el, button: button, makeDialog: makeDialog, field: field,
      showDialog: function (dlg) { document.body.appendChild(dlg); dlg.showModal(); },
      catSelect: catSelect, accSelect: accSelect, hasAccounts: function () { return data.acc.length > 0; },
      daysAgo: function (n) { return addDays(today, -n); },
      data: function () { return { tx: data.tx, tombs: data.tombs, cur: cur() }; },
      addEntries: addEntries
    });
  }

  // Bank statements + rules (budget/bank.js core, budget/bankui.js
  // dialogs). Imports go through addEntries (one write, Undo).
  var BANKUI = window.OrosBudgetBank && window.OrosBudgetBankUI ? window.OrosBudgetBankUI : null;
  function saveRule(v) {
    var cur0 = v.id ? findIn(data.rule, v.id) : null;
    var obj = normRule({ id: cur0 ? cur0.id : newId(), m: stamp(cur0 ? cur0.m : 0),
                         k: v.k, c: v.c, q: v.q, lo: v.lo || 0, hi: v.hi || 0, py: v.py || "", nt: v.nt || "" });
    if (!obj) return null;
    if (cur0) data.rule = data.rule.filter(function (y) { return y.id !== cur0.id; });
    data.rule.push(obj);
    commit();
    renderAll();
    return obj;
  }
  function deleteRule(id, text) {
    var r = findIn(data.rule, id);
    if (!r) return;
    var copy = JSON.parse(JSON.stringify(r));
    data.rule = data.rule.filter(function (y) { return y.id !== id; });
    tombstone("rule", id);
    commit();
    renderAll();
    undoToast(text, function () {
      untomb("rule", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["rule:" + id] || 0));
      if (!findIn(data.rule, id)) data.rule.push(copy);
      commit();
      renderAll();
    });
  }
  // After the person corrects the category of an entry from a bank
  // (BK-4): "Always for «LIDL»?" makes or updates the rule in one tap.
  // → { label, fn } for a toast button, or null when there is nothing
  // to learn (not from a bank, no category, or the rule already says so).
  function learnOffer(x, c) {
    var Bk = window.OrosBudgetBank;
    if (!Bk || !x || x.src !== "bank" || !c) return null;
    var q = Bk.suggestQ(x.ot || x.n || "");
    if (!q || q.length < 3) return null;
    var fq = Bk.fold(q), same = null;
    data.rule.forEach(function (r) { if (!same && r.k === x.k && !r.lo && !r.hi && Bk.fold(r.q || "") === fq) same = r; });
    if (same && same.c === c) return null;
    return { label: t("learn.yes", { q: q }), fn: function () {
      var r = saveRule(same ? { id: same.id, k: same.k, c: c, q: same.q, py: same.py, nt: same.nt } : { k: x.k, c: c, q: q });
      if (r) showToast(t("learn.done", { q: q, c: catName(c) }));
    } };
  }
  // Bank profile: by id, else by name (same name = same profile).
  function saveProf(v) {
    var cur0 = v.id ? findIn(data.prof, v.id) : null;
    if (!cur0) data.prof.forEach(function (p) { if (!cur0 && p.n.toLowerCase() === String(v.n).toLowerCase()) cur0 = p; });
    var base = cur0 ? Object.assign({}, cur0) : { id: newId(), m: 0 };
    Object.keys(v).forEach(function (k) { if (k !== "id" && v[k] !== undefined) base[k] = v[k]; });
    base.m = 0;
    var obj = normProf(base);
    if (!obj) return null;
    var was = cur0 ? JSON.stringify(Object.assign({}, cur0, { m: 0 })) : "";
    if (was === JSON.stringify(obj)) return cur0;   // nothing changed: no write, no sync
    obj.m = stamp(cur0 ? cur0.m : 0);
    if (cur0) data.prof = data.prof.filter(function (y) { return y.id !== cur0.id; });
    data.prof.push(obj);
    commit();
    return obj;
  }
  // [{ id, c, n }] → set on the entries in one write; Undo puts back
  // what they had (unless that entry was changed again since).
  function applyChanges(list, text, extra) {
    var before = [];
    list.forEach(function (ch) {
      var x = findIn(data.tx, ch.id);
      var n = normText(ch.n, NOTE_LEN);
      if (!x || (x.c === ch.c && x.n === n)) return;
      before.push({ id: x.id, c: x.c, n: x.n, nc: ch.c });
      x.c = ch.c;
      x.n = n;
      x.m = stamp(x.m);
    });
    if (!before.length) return;
    commit();
    renderAll();
    undoToast(text, function () {
      before.forEach(function (b) {
        var x = findIn(data.tx, b.id);
        if (!x || x.c !== b.nc) return;
        x.c = b.c; x.n = b.n; x.m = stamp(x.m);
      });
      commit();
      renderAll();
    }, extra || null);
  }
  // Categories for matching an app's names: the live ones, the ready
  // ones also by their name in the other language.
  function importCats() {
    return cats().map(function (c) {
      var o = { id: c.id, k: c.k, name: c.name };
      if (c.seed) o.alt = [SEED_NAMES.en[c.id], SEED_NAMES.el[c.id]].concat(LANG !== "en" && LANG !== "el" && SEED_NAMES[LANG] ? [SEED_NAMES[LANG][c.id]] : []);
      return o;
    });
  }
  // An app's export (budget/import.js): new categories, new accounts
  // and the entries in ONE write. Undo removes exactly those, with
  // tombstones newer than what was written (sync-safe), so every
  // device ends up as before the import.
  function importApp(pkg, doneText) {
    var ids = [], catIds = [], accIds = [];
    (pkg.cats || []).forEach(function (c) {
      if (findIn(data.cats, c.id) || cats().length >= MAX_CATS) return;
      var obj = normCat({ id: c.id, m: stamp(data.tombs["cat:" + c.id] || 0), k: c.k, name: c.name, col: c.col });
      if (!obj) return;
      untomb("cat", c.id);
      data.cats.push(obj);
      catIds.push(c.id);
    });
    (pkg.accs || []).forEach(function (a) {
      if (findIn(data.acc, a.id) || data.acc.length >= MAX_ACC) return;
      var x = { id: a.id, m: stamp(data.tombs["acc:" + a.id] || 0), n: a.n, o: 0, col: 8 };
      if (a.cur) x.cur = a.cur;
      var obj = normAcc(x);
      if (!obj) return;
      untomb("acc", a.id);
      data.acc.push(obj);
      accIds.push(a.id);
    });
    (pkg.tx || []).forEach(function (r) {
      if (findIn(data.tx, r.id)) return;
      var x = normTx(Object.assign({}, r, { m: stamp(data.tombs["tx:" + r.id] || 0) }));
      if (!x) return;
      if (x.c && !catById(x.c)) x.c = "";
      if (x.ac && !findIn(data.acc, x.ac)) delete x.ac;
      data.tx.push(x);
      ids.push(r.id);
    });
    if (!ids.length && !catIds.length && !accIds.length) return;
    commit();
    renderAll();
    undoToast(doneText, function () {
      data.tx = data.tx.filter(function (y) { return ids.indexOf(y.id) < 0; });
      ids.forEach(function (id) { tombstone("tx", id); });
      data.cats = data.cats.filter(function (y) { return catIds.indexOf(y.id) < 0; });
      catIds.forEach(function (id) { tombstone("cat", id); });
      data.acc = data.acc.filter(function (y) { return accIds.indexOf(y.id) < 0; });
      accIds.forEach(function (id) { tombstone("acc", id); });
      commit();
      renderAll();
    });
  }
  // .orosbudget (OBF-4e): every entry, category, limit, recurring
  // entry, account, transfer, envelope, goal and import rule as one
  // orOS file (../recordpkg.js + package.js), the receipts in media/
  // by <sha256>.<jpg|pdf>. Bank profiles (a bank's CSV layout, account
  // number / IBAN) stay on the device. Opening ADDS what this device
  // lacks, with its ids; an entry already here (or deleted here) is
  // kept as it is unless "Update with newer versions" is ticked. The
  // result goes through commit (mergeBudget + save + sync dirty); Undo
  // removes the added records with tombstones, like importApp.
  var RP = window.OrosRecordPkg || null, BPK = window.OrosBudgetPackage || null;
  if (BPK) BPK.useCsv(buildCsv);              // entries.csv = the app's own CSV export
  var TOMB_OF = { tx: "tx", cats: "cat", rec: "rec", acc: "acc", xfer: "xfer", asg: "asg", goal: "goal", rule: "rule", bnk: "bnk" };
  var fileAdded = null, fileCur = "";
  // One receipt of the file → Budget/Receipts, only when that name is
  // not on the disk yet, through the checks of attaching one
  // (encodeReceipt: a PDF must start with "%PDF-", a picture is
  // re-drawn as a JPEG, no EXIF). → Promise<true when the file is there>
  function storeReceipt(name, key, media) {
    var fs = fsApi(), path = PLAN ? PLAN.rcPath(name) : null;
    if (!fs || !path) return Promise.resolve(false);
    return Promise.resolve().then(function () { return fs.readBlob(path); })
      .then(function (b) { return !!b; }, function () { return false; })
      .then(function (there) {
        if (there) return true;
        var item = key && Object.prototype.hasOwnProperty.call(media, key) ? media[key] : null;
        if (!item || !(item.blob || item.bytes)) return false;
        var blob = item.blob ? item.blob.slice(0, item.blob.size, item.type || "") : new Blob([item.bytes], { type: item.type || "" });
        return encodeReceipt(blob).then(function (enc) {
          if (!enc || enc.ext !== name.split(".").pop()) return false;
          return Promise.resolve(fs.writeBlob(path, enc.blob)).then(function () { return true; });
        });
      }).catch(function () { return false; });
  }
  // The added records over the app's caps (categories, accounts,
  // recurring entries) are left out; what was here stays.
  function capAdded(d, before) {
    var drop = function (key, over) {
      for (var i = d[key].length - 1; i >= 0 && over(); i--) if (!before[key][d[key][i].id]) d[key].splice(i, 1);
    };
    drop("cats", function () { return categoryList(d, SEED_NAMES.en).length > MAX_CATS; });
    drop("acc", function () { return d.acc.length > MAX_ACC; });
    drop("rec", function () { return d.rec.length > MAX_REC; });
  }
  var recFile = RP && BPK && window.OrosBundle ? RP.ui(BPK.DESC, {
    lang: function () { return LANG === "el" ? "el" : "en"; },   // recordpkg.js: "en" | "el"
    get: function () { return sliceGet(); },
    title: function () { return t("app"); },
    // media/: every receipt the entries name, read from the orOS disk;
    // state.rcs = { "<file name>": "<media key>" } goes into content.json
    files: function (state) {
      var fs = fsApi(), B = window.OrosBundle, out = [], rcs = {}, chain = Promise.resolve();
      if (!fs || !PLAN) return out;
      PLAN.rcAll(state).forEach(function (name) {
        chain = chain.then(function () {
          if (rcs[name]) return;
          return Promise.resolve(fs.readBlob(PLAN.rcPath(name))).then(function (blob) {
            if (!blob || !blob.size) return;
            return B.digest(blob).then(function (dg) {
              var key = dg.sha + "." + name.split(".").pop();
              rcs[name] = key;
              if (!out.some(function (f) { return f.key === key; }))
                out.push({ key: key, blob: blob, type: /\.pdf$/.test(name) ? "application/pdf" : "image/jpeg" });
            });
          }).catch(function () {});
        });
      });
      return chain.then(function () { state.rcs = rcs; return out; });
    },
    // the receipts of the entries this open adds (or updates); a name
    // whose file could not be stored leaves the entry's rc
    media: function (read, res) {
      var next = res.next, src = read && read.content && read.content.data;
      var rcs = src && src.rcs && typeof src.rcs === "object" ? src.rcs : {}, media = (read && read.media) || {};
      fileCur = src && src.set && typeof src.set.cur === "string" ? src.set.cur : "";
      var want = {}, chain = Promise.resolve();
      res.addedIds.concat(res.updatedIds).forEach(function (id) { want[id] = 1; });
      (next.tx || []).forEach(function (x) {
        if (!want[x.id] || !x.rc) return;
        var kept = [];
        BPK.rcOf(x.rc, x.id).forEach(function (name) {
          chain = chain.then(function () {
            return storeReceipt(name, typeof rcs[name] === "string" ? rcs[name] : "", media);
          }).then(function (ok) { if (ok) kept.push(name); });
        });
        chain = chain.then(function () { if (kept.length) x.rc = PLAN.rcJoin(kept); else delete x.rc; });
      });
      return chain.then(function () { return next; });
    },
    set: function (next) {
      var before = {};
      BPK.COLLS.forEach(function (c) {
        before[c] = {};
        data[c].forEach(function (x) { before[c][x.id] = 1; });
      });
      var fresh = mergeBudget(next, next);
      capAdded(fresh, before);
      // a device that never chose a currency and has no entries takes the file's
      if (fileCur && fresh.set.m === 0 && !data.tx.length && fileCur !== fresh.set.cur && CURRENCIES.indexOf(fileCur) >= 0)
        fresh.set = Object.assign({}, fresh.set, { cur: fileCur, m: stamp(0) });
      fileCur = "";
      data = fresh;
      commit();
      materialize(false);      // due days of an added recurring entry
      fileAdded = {};
      BPK.COLLS.forEach(function (c) {
        fileAdded[c] = data[c].filter(function (x) { return !before[c][x.id]; }).map(function (x) { return x.id; });
      });
      renderAll();
    },
    // Undo: what this open added (with the due days of an added
    // recurring entry) goes again, with tombstones; a limit has none,
    // so an added one becomes "no limit"; receipts no entry names any
    // more leave the disk later.
    deleteIds: function () {
      var a = fileAdded;
      fileAdded = null;
      if (!a) return;
      var names = [];
      BPK.COLLS.forEach(function (c) {
        var ids = a[c] || [];
        if (!ids.length) return;
        if (c === "bud") {
          data.bud.forEach(function (b) { if (ids.indexOf(b.id) >= 0) { b.a = 0; b.m = stamp(b.m); } });
          return;
        }
        data[c] = data[c].filter(function (y) {
          if (ids.indexOf(y.id) < 0) return true;
          if (c === "tx" && PLAN && y.rc) names = names.concat(PLAN.rcList(y.rc));
          return false;
        });
        ids.forEach(function (id) { tombstone(TOMB_OF[c], id); });
      });
      commit();
      renderAll();
      dropReceiptsLater(names);
    },
    toast: function (text, undo) { if (undo) undoToast(text, undo); else showToast(text); }
  }) : null;

  function pickFile(accept) {
    var dh = dialogHost();
    return dh && typeof dh.openFile === "function" ? dh.openFile(accept) : localPick(accept);
  }
  function initBank() {
    if (!BANKUI) return;
    BANKUI.init({
      lang: LANG, el: el, button: button, makeDialog: makeDialog, field: field, swatch: swatch,
      showDialog: function (dlg) { document.body.appendChild(dlg); dlg.showModal(); },
      catSelect: catSelect, fillCatSelect: fillCatSelect, accSelect: accSelect, kindSwitch: kindSwitch,
      hasAccounts: function () { return data.acc.length > 0; },
      data: function () { return data; }, cur: cur, catName: catName, catCol: catCol, money: money,
      dateShort: dateShort, centsToInput: function (c) { return centsToInput(c, LANG); },
      parseAmount: parseAmount, normText: normText, pickFile: pickFile, showToast: showToast,
      addEntries: addEntries, saveRule: saveRule, deleteRule: deleteRule, saveProf: saveProf, applyChanges: applyChanges,
      // exports of other apps (budget/import.js)
      xlsx: function (done) { loadLib("xlsx.full.min.js", function () { done(window.XLSX); }); },
      importCats: importCats, accs: accs, accName: accName, fx: fx, maxCats: MAX_CATS, maxAcc: MAX_ACC,
      importApp: importApp
    });
  }

  // Live bank connection (BK-2: budget/bankapi.js + budget/banklive.js).
  // Connected accounts are the collection "bnk"; entries come in through
  // addEntries (one write, Undo), like a statement file.
  var BANKLIVE = window.OrosBudgetBankApi && window.OrosBudgetBankLive && BANKUI ? window.OrosBudgetBankLive : null;
  function saveBnk(row) {
    var prev = findIn(data.bnk, row.id);
    var next = Object.assign({}, row, { m: stamp(Math.max(prev ? prev.m : 0, data.tombs["bnk:" + row.id] || 0)) });
    data.bnk = data.bnk.filter(function (x) { return x.id !== row.id; }).concat([next]);
    untomb("bnk", row.id);
    commit();
    renderAll();
  }
  function patchBnk(id, fields) {
    var prev = findIn(data.bnk, id);
    if (!prev) return;
    var same = Object.keys(fields).every(function (k) { return prev[k] === fields[k]; });
    if (same) return;
    saveBnk(Object.assign({}, prev, fields));
  }
  function dropBnk(id) {
    if (!findIn(data.bnk, id)) return;
    data.bnk = data.bnk.filter(function (x) { return x.id !== id; });
    tombstone("bnk", id);
    commit();
    renderAll();
  }
  function initBankLive() {
    if (!BANKLIVE) return;
    BANKLIVE.init({
      lang: LANG, el: el, button: button, makeDialog: makeDialog, field: field,
      showDialog: function (dlg) { document.body.appendChild(dlg); dlg.showModal(); },
      accSelect: accSelect, data: function () { return data; }, cur: cur, dateShort: dateShort,
      pickFile: pickFile, showToast: showToast, addEntries: addEntries, renderAll: renderAll,
      newId: newId, saveBnk: saveBnk, patchBnk: patchBnk, dropBnk: dropBnk
    });
  }

  // Plan tab, subscriptions, reports (budget/planui.js over plan.js).
  var PLANUI = PLAN && window.OrosBudgetPlanUI ? window.OrosBudgetPlanUI : null;
  // What the accounts held, in the main currency, at the end of the
  // month before envelope budgeting started (≥ 0): money to assign.
  function startCash() {
    if (!PLAN || !data.acc.length || !data.set.envs) return 0;
    var r = PLAN.netWorth(data, PLAN.lastDay(mkAdd(data.set.envs, -1)), cur(), fx);
    return Math.max(0, r.tot);
  }
  function initPlan() {
    if (!PLANUI) return;
    PLANUI.init({
      lang: LANG, el: el, button: button, makeDialog: makeDialog, field: field, swatch: swatch, errLine: errLine, showErr: showErr,
      showDialog: function (dlg) { document.body.appendChild(dlg); dlg.showModal(); },
      data: function () { return data; }, cats: cats, catName: catName, catCol: catCol, findIn: findIn, stamp: stamp,
      commit: commit, renderAll: renderAll, undoToast: undoToast, showToast: showToast, live: live, tt: t,
      money: money, moneyShort: moneyShort, moneyPlain: moneyPlain, monthLabel: monthLabel, monthShort: monthShort, dateShort: dateShort,
      viewMk: function () { return viewMk; }, today: function () { return today; }, setMonth: setMonth, mkAdd: mkAdd, cur: cur,
      centsToInput: function (c) { return centsToInput(c, LANG); }, zeroAmt: function () { return zeroAmt(LANG); },
      parseAmount: parseAmount, parseSigned: parseSigned,
      normText: normText, newId: newId, accs: accs, accName: accName, tombstone: tombstone, untomb: untomb,
      startCash: startCash, limitOf: budOf, accBalanceMain: accBalanceMain, recDialog: recDialog, recWhen: recWhen,
      icon: function (k) { return UI[k] || ""; },
      notifyHour: function () { return prefs.nh; }, setNotifyHour: function (h) { prefs.nh = h; savePrefs(); },
      chartWidth: chartWidth, niceStep: niceStep, sv: sv, svText: svText, hit: hit, tableTwin: tableTwin,
      fx: fx, fxNote: fxNote
    });
  }

  function deleteTx(id) {
    var x = findIn(data.tx, id);
    if (!x) return;
    var copy = JSON.parse(JSON.stringify(x));
    data.tx = data.tx.filter(function (y) { return y.id !== id; });
    tombstone("tx", id);
    commit();
    renderAll();
    if (PLAN && x.rc) dropReceiptsLater(PLAN.rcList(x.rc));
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
    amt.placeholder = zeroAmt(LANG);
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
    var syncRem = function () {};
    var sw = kindSwitch(k0, function (v) { fillCatSelect(sel, v, v === "o" ? "o-home" : "i-salary"); syncRem(); });
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
    // Reminder before a charge (expenses; the shell rings it at the
    // device's reminder hour, Recurring › Subscriptions).
    var rem = el("select");
    [-1, 0, 1, 2, 3, 5, 7, 14].forEach(function (n) {
      var o = el("option", "", n < 0 ? t("rec.rOff") : n === 0 ? t("rec.r0") : n === 1 ? t("rec.r1") : t("rec.rN", { n: n }));
      o.value = String(n);
      rem.appendChild(o);
    });
    rem.value = r && isInt(r.nd) ? String(r.nd) : "-1";
    if (rem.value === "" && r && isInt(r.nd)) {   // a lead this list doesn't offer (set elsewhere): keep it
      var ox = el("option", "", t("rec.rN", { n: r.nd })); ox.value = String(r.nd); rem.appendChild(ox); rem.value = String(r.nd);
    }
    var remF = field(t("rec.remind"), rem, "bd-r-rem");
    form.appendChild(remF);
    syncRem = function () { remF.hidden = sw.get() !== "o"; };
    syncRem();
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
      var nd = vals.k === "o" ? +rem.value : -1;
      var ndWas = cur0 && isInt(cur0.nd) ? cur0.nd : -1;
      if (cur0) {
        var changed = Object.keys(vals).some(function (kk) { return cur0[kk] !== vals[kk]; }) || (cur0.ac || "") !== ac || ndWas !== nd;
        if (changed) {
          Object.keys(vals).forEach(function (kk) { cur0[kk] = vals[kk]; });
          if (ac) cur0.ac = ac; else delete cur0.ac;
          if (nd >= 0) cur0.nd = nd; else delete cur0.nd;
          cur0.m = stamp(cur0.m);
        }
      } else {
        var nid = r ? r.id : newId();
        if (r) untomb("rec", nid);
        var obj = { id: nid, m: stamp(r ? r.m : 0) };
        Object.keys(vals).forEach(function (kk) { obj[kk] = vals[kk]; });
        if (ac) obj.ac = ac;
        if (nd >= 0) obj.nd = nd;
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

  // Linked entries (budget/links.js, BR-B3): income another app keeps
  // here for you (Invoices payments). Read-only on the source's data;
  // fixed ids and the source's m, so every device writes the same.
  var SOURCES = [
    { src: "invoices", key: "oros-invoices-data", rows: function (o) { return window.OrosBudgetLinks.invoiceRows(o, cur()); } }
  ];
  function linkSources() {
    if (!window.OrosBudgetLinks) return 0;
    var n = 0;
    SOURCES.forEach(function (s) {
      var o = null;
      try { o = JSON.parse(localStorage.getItem(s.key) || "null"); } catch (e) { o = null; }
      if (!o || typeof o !== "object") return;
      var p = window.OrosBudgetLinks.plan(data, s.src, s.rows(o));
      p.put.forEach(function (x) {
        var tx = normTx(x);
        if (!tx) return;
        var i = data.tx.findIndex(function (y) { return y.id === tx.id; });
        if (i >= 0) data.tx[i] = tx; else data.tx.push(tx);
        n++;
      });
      p.drop.forEach(function (x) {
        data.tx = data.tx.filter(function (y) { return y.id !== x.id; });
        data.tombs["tx:" + x.id] = Math.max(data.tombs["tx:" + x.id] || 0, x.m);
        n++;
      });
    });
    if (n) commit();
    return n;
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
      var bal = balNow();
      var ul = el("ul", "day-list");
      list.forEach(function (a) {
        var li = el("li");
        var b = el("button", "tx acc-row");
        b.type = "button";
        b.appendChild(swatch(a.col));
        var mid = el("span", "tx-mid");
        mid.appendChild(el("span", "tx-cat", a.n));
        b.appendChild(mid);
        var v = el("span", "tx-amt" + (bal[a.id] < 0 ? " neg" : ""), money(bal[a.id], a.cur));
        b.appendChild(v);
        b.setAttribute("aria-label", a.n + ", " + money(bal[a.id], a.cur) + ", " + t("acc.edit"));
        b.addEventListener("click", function () { dlg.close(); accDialog(a.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
      // Net worth: every balance in the main currency (ECB rates).
      if (PLAN) {
        var nw = PLAN.netWorth(data, today, cur(), fx);
        var nl = el("div", "acc-nw");
        nl.appendChild(el("span", "", t("acc.netw")));
        nl.appendChild(el("span", "acc-nw-v" + (nw.tot < 0 ? " neg" : ""), money(nw.tot)));
        body.appendChild(nl);
        if (usesFx()) {
          body.appendChild(el("p", "hint", fxNote()));
          refreshFx(false);
        }
      }
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
    open.placeholder = zeroAmt(LANG);
    open.value = a && a.o ? (a.o < 0 ? "-" : "") + centsToInput(Math.abs(a.o), LANG) : "";
    var err = errLine();
    var curSel = el("select");
    [cur()].concat(CURRENCIES.filter(function (c) { return c !== cur(); })).forEach(function (c) {
      var o = el("option", "", c); o.value = c; curSel.appendChild(o);
    });
    curSel.value = a && a.cur ? a.cur : cur();
    if (!curSel.value) curSel.value = cur();
    var openF = field(t("acc.open") + " (" + curSel.value + ")", open, "bd-acc-o");
    curSel.addEventListener("change", function () { openF.querySelector("label").textContent = t("acc.open") + " (" + curSel.value + ")"; });
    form.appendChild(field(t("acc.name"), name, "bd-acc-n"));
    form.appendChild(field(t("acc.cur"), curSel, "bd-acc-cur"));
    form.appendChild(openF);
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
      var ccy = curSel.value !== cur() ? curSel.value : "";
      if (cur0) {
        if (cur0.n !== n || cur0.o !== o || (cur0.cur || "") !== ccy) {
          cur0.n = n; cur0.o = o;
          if (ccy) cur0.cur = ccy; else delete cur0.cur;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var used = {};
        data.acc.forEach(function (y) { used[y.col] = 1; });
        var col = 0;
        while (col < 8 && used[col]) col++;
        var nid = a ? a.id : newId();
        if (a) untomb("acc", nid);
        var na = { id: nid, m: stamp(a ? a.m : 0), n: n, o: o, col: col % 8 };
        if (ccy) na.cur = ccy;
        data.acc.push(na);
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
    amt.placeholder = zeroAmt(LANG);
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
    var amtF = field(t("f.amount") + " (" + cur() + ")", amt, "bd-xf-amt");
    form.appendChild(amtF);
    // Two accounts in different currencies: what arrived, in the to-account's.
    var ta = el("input");
    ta.inputMode = "decimal";
    ta.autocomplete = "off";
    ta.placeholder = zeroAmt(LANG);
    ta.value = x && x.ta ? centsToInput(x.ta, LANG) : "";
    var taTouched = !!(x && x.ta);
    ta.addEventListener("input", function () { taTouched = true; });
    var taF = field(t("xf.ta", { c: cur() }), ta, "bd-xf-ta");
    var taNote = el("p", "hint fx-line");
    taF.appendChild(taNote);
    form.appendChild(taF);
    function xcur(sel) { var a = findIn(data.acc, sel.value); return accCur(a); }
    function syncTa() {
      var fc = xcur(from), tc = xcur(to);
      amtF.querySelector("label").textContent = t("f.amount") + " (" + fc + ")";
      taF.hidden = fc === tc;
      if (fc === tc) return;
      taF.querySelector("label").textContent = t("xf.ta", { c: tc });
      var v = parseAmount(amt.value), r = v === null ? null : fx(v, fc, tc);
      if (!taTouched && r !== null && r > 0) ta.value = centsToInput(r, LANG);
      taNote.textContent = fxNote();
    }
    [from, to].forEach(function (s0) { s0.addEventListener("change", function () { taTouched = false; syncTa(); if (!taF.hidden) refreshFx(false, syncTa); }); });
    amt.addEventListener("input", syncTa);
    syncTa();
    if (!taF.hidden) refreshFx(false, syncTa);
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
      var tac = 0;
      if (!taF.hidden) {
        tac = parseAmount(ta.value);
        if (tac === null) { showErr(err, t("err.amount"), ta); return; }
      }
      var cur0 = x ? findIn(data.xfer, x.id) : null;
      if (cur0) {
        if (cur0.f !== from.value || cur0.t !== to.value || cur0.a !== cents || cur0.d !== date.value || cur0.n !== n || (cur0.ta || 0) !== tac) {
          cur0.f = from.value; cur0.t = to.value; cur0.a = cents; cur0.d = date.value; cur0.n = n;
          if (tac) cur0.ta = tac; else delete cur0.ta;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var nid = x ? x.id : newId();
        if (x) untomb("xfer", nid);
        var nx = { id: nid, m: stamp(x ? x.m : 0), d: date.value, a: cents, f: from.value, t: to.value, n: n };
        if (tac) nx.ta = tac;
        data.xfer.push(nx);
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
    ["tx", "cats", "bud", "rec", "acc", "xfer", "asg", "goal", "prof", "rule", "bnk"].forEach(function (k) {
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
  // extra = { label, fn }: a second button (Budget BK-4 "Always").
  function undoToast(text, onUndo, extra) { localToast(text, onUndo, extra); }

  var toastTimer = null;
  function localToast(text, onUndo, extra) {
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
    if (extra) {
      var xb = el("button", "", extra.label);
      xb.type = "button";
      xb.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        extra.fn();
      });
      box.appendChild(xb);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo || extra ? 8000 : 4000);
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
        var items = [].slice.call(menu.querySelectorAll("button:not([hidden])"));
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
      var order = TABS, i = order.indexOf(prefs.tab);
      i = (i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length;
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
    linkSources();
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
    TABS.forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    var qt = null;
    $("q").addEventListener("input", function () {
      clearTimeout(qt);
      qt = setTimeout(function () { query = $("q").value.trim().toLowerCase(); renderList(); }, 150);
    });
    $("flt").addEventListener("change", function () { filter = $("flt").value; renderList(); });
    var acts = { accounts: accountsDialog, cats: catsDialog, export: exportDialog, backup: backup, restore: restore, currency: currencyDialog,
                 stripe: function () { if (PAY) PAY.open(); },
                 bank: function () { if (BANKUI) BANKUI.open(); }, banks: function () { if (BANKLIVE) BANKLIVE.open(); }, apps: function () { if (BANKUI) BANKUI.open(); }, rules: function () { if (BANKUI) BANKUI.rules(); },
                 osave: function () { if (recFile) recFile.save(); }, oopen: function () { if (recFile) recFile.open(); },
                 ofolder: function () { if (recFile) recFile.openFolder(); } };
    ["osave", "oopen", "ofolder"].forEach(function (k) {     // .orosbudget (the record kit)
      var ob = document.querySelector('#menu [data-act="' + k + '"]');
      if (ob) ob.hidden = !recFile;
    });
    ["bank", "rules"].forEach(function (k) {
      var mb = document.querySelector('#menu [data-act="' + k + '"]');
      if (mb) mb.hidden = !BANKUI;
    });
    var appBtn = document.querySelector('#menu [data-act="apps"]');
    if (appBtn) appBtn.hidden = !(BANKUI && window.OrosBudgetImport);
    var payBtn = document.querySelector('#menu [data-act="stripe"]');
    if (payBtn) { payBtn.hidden = !(PAY && PAY.has()); if (PAY) payBtn.textContent = PAY.label(); }
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
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      tick();
      if (linkSources()) renderAll();
    });
    // A source app (Invoices) saved on this device while Budget is open
    window.addEventListener("storage", function (e) {
      if (!e.key || !SOURCES.some(function (s) { return s.key === e.key; })) return;
      if (linkSources() && !document.querySelector("dialog[open]")) renderAll();
    });
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
    // "Open with" an .orosbudget file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (x.openFile) { if (recFile) recFile.openTarget(x.openFile); return; }
    // Single app (solo.js): { newTx: { n? } } → a new expense (icon
    // shortcut, or a shared text as its note); saved only on Save.
    if (x.newTx && typeof x.newTx === "object") {
      Array.prototype.forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
      var nn = typeof x.newTx.n === "string" ? x.newTx.n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_LEN) : "";
      txDialog(null, nn ? { k: "o", n: nn } : null);
      return;
    }
    var rec = typeof x.rec === "string" && /^[a-z0-9]{1,24}$/.test(x.rec) ? x.rec : "";
    var tx = typeof x.tx === "string" && ID_RE.test(x.tx) ? findIn(data.tx, x.tx) : null;
    // { sub: id } (a subscription reminder): the Subscriptions view, that entry open.
    if (!rec && typeof x.sub === "string" && /^[a-z0-9]{1,24}$/.test(x.sub)) {
      rec = x.sub;
      if (PLANUI) { prefs.rv = "subs"; savePrefs(); }
    }
    if (!rec && !tx) return;
    Array.prototype.forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
    if (tx) {
      prefs.tab = "list";
      savePrefs();
      setMonth(mkOf(tx.d));
      txDialog(tx.id, null);
      return;
    }
    setTab("rec");
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
    initPay();
    initBank();
    initBankLive();
    loadFx();
    initPlan();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    materialize(true);
    linkSources();
    renderAll();
    if (usesFx()) refreshFx(false);
    takeStagedNew();
    takeTarget();
  }

  boot();

})();
