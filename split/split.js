// ============================================================
// orOS Split — App logic (v1.0.0)
// Group expenses: who paid what, who owes whom.
//   - groups (a trip, a shared flat, a night out) with people,
//     a colour and their own currency; archive when settled
//   - expenses split equally, by exact amounts, by shares or by
//     percentages; one or several people paid
//   - amounts are integer cents; the cents left over by a split
//     (10 € in 3 = 3,34 + 3,33 + 3,33) go by a fixed rule, so
//     every device shows exactly the same numbers
//   - balances + the fewest payments that settle the group,
//     "Paid" records a payment; balances are always computed
//   - share with friends without a server: a text summary (copy
//     / share sheet) and a group file another orOS imports; the
//     import is the sync merge, so files sent back and forth
//     join up and never double an expense
//   - export: CSV, PDF summary, JSON backup (restore = merge)
// Data:
//   - synced slice "split" (oros-split-data): groups, people,
//     expenses, payments LWW per id + tombstones; a deleted group
//     takes its people, expenses and payments with it (R5, R17,
//     R26, R27). Child ids are "<group id>.<own id>", so a group
//     file can carry exactly its own tombstones.
//   - "who am I" per group (`mine`) travels in YOUR sync only,
//     never in a group file: a friend picks their own
//   - device-local (R10): oros-split-prefs (last group, tab, CSV)
// Sections:
//   1. Constants, i18n, helpers
//   2. Money + dates
//   3. Model: normalize, merge
//   4. Derived: shares, balances, settling up, summary text
//   5. CSV + group file
//   6. Storage, prefs
//   7. Rendering: toolbar, home, group, expenses, balances
//   8. Dialogs: expense, payment, group, export
//   9. Export, share, import, backup
//  10. Toasts, menu, keyboard
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-split-data";
  var PREFS_KEY   = "oros-split-prefs";
  var DATA_VER    = 1;
  var NAME_LEN    = 40;      // group name
  var PERSON_LEN  = 30;
  var TITLE_LEN   = 60;
  var NOTE_LEN    = 140;
  var MAX_CENTS   = 100000000000;      // 1 billion in whole units
  var MAX_GROUPS  = 200;
  var MAX_PEOPLE  = 30;
  var MAX_EXP     = 3000;              // expenses + payments per group
  var MAX_SHARES  = 1000;              // one person's shares
  var PCT_FULL    = 10000;             // percentages in hundredths
  var MAX_FILE    = 5 * 1024 * 1024;
  var COLOR_SLOTS = 9;
  var CURRENCIES  = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                     "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var MODES = { eq: 1, ex: 1, sh: 1, pc: 1 };
  // Expense categories: fixed, language-free ids (SS-2 lesson);
  // names come from the strings at render time.
  var CATS = [
    { id: "food", col: 1 }, { id: "groc", col: 0 }, { id: "stay", col: 6 },
    { id: "trans", col: 4 }, { id: "bills", col: 2 }, { id: "fun", col: 3 },
    { id: "other", col: 8 }
  ];
  // Split category → Budget ready category (send-to-Budget bridge).
  var BUDGET_CAT = { food: "o-eat", groc: "o-groc", stay: "o-other", trans: "o-trans",
                     bills: "o-bills", fun: "o-fun", other: "o-other" };
  var CAT_BY_ID = {};
  CATS.forEach(function (c) { CAT_BY_ID[c.id] = c; });

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
      "app": "Split",
      "btn.back": "All groups", "btn.menu": "More",
      "btn.newGroup": "New group", "btn.newGroup.aria": "New group (N)",
      "btn.newExp": "Expense", "btn.newExp.aria": "New expense (N)",
      "tab.exp": "Expenses", "tab.bal": "Balances",
      "menu.import": "Import a group file…", "menu.backup": "Backup (JSON)", "menu.restore": "Restore from backup",
      "menu.edit": "Group and people", "menu.share": "Share the summary", "menu.file": "Send the group file",
      "menu.export": "Export (CSV, PDF)", "menu.arch": "Archive the group", "menu.unarch": "Bring back from the archive",
      "menu.del": "Delete the group",
      "home.empty": "No groups yet. A trip, a shared flat, a night out: make a group, add the people, then the expenses.",
      "home.arch": "Archived ({n})",
      "g.people": "{n} people", "g.people1": "1 person", "g.exps": "{n} expenses", "g.exps1": "1 expense",
      "g.youGet": "You get back {a}", "g.youOwe": "You owe {a}", "g.settled": "Settled", "g.spent": "{a} spent",
      "sum.total": "Group spending", "sum.share": "Your share", "sum.bal": "Your balance",
      "sum.whoami": "Which one is you?", "sum.whoami.hint": "Pick yourself to see what you owe or get back.",
      "q.ph": "Search the expenses…", "flt.all": "Everything", "flt.cats": "Category", "flt.people": "Involving",
      "flt.pay": "Payments only",
      "list.empty": "No expenses yet. Tap “Expense” to add the first one.", "list.none": "Nothing matches.",
      "list.found": "{n} found",
      "row.paid": "{p} paid", "row.you": "your share {a}", "row.notYou": "not yours",
      "row.pay": "Payment", "row.and": "{a} and {b}", "row.many": "{a} and {n} more",
      "bal.title": "Balances", "bal.paid": "paid {a}", "bal.share": "share {a}",
      "bal.gets": "gets back {a}", "bal.owes": "owes {a}", "bal.even": "even",
      "bal.settle": "Settle up", "bal.settled": "Everyone is even. Nothing to pay.",
      "bal.hint": "The fewest payments that settle the group.",
      "bal.paidBtn": "Paid", "bal.paidAria": "{f} paid {a} to {t}", "bal.record": "Record a payment",
      "bal.shareBtn": "Share the summary",
      "you": "you", "unknown": "(removed person)",
      "cat.food": "Food & drinks", "cat.groc": "Groceries", "cat.stay": "Accommodation", "cat.trans": "Transport",
      "cat.bills": "Bills & rent", "cat.fun": "Activities", "cat.other": "Other",
      "e.new": "New expense", "e.edit": "Edit expense", "e.title": "What for", "e.title.ph": "e.g. Dinner at the taverna",
      "e.amount": "Amount", "e.date": "Date", "e.cat": "Category", "e.by": "Paid by", "e.byMany": "Several people…",
      "e.split": "Split", "e.m.eq": "Equally", "e.m.ex": "Amounts", "e.m.sh": "Shares", "e.m.pc": "%",
      "e.note": "Note", "e.note.ph": "Optional", "e.all": "Everyone", "e.none": "No one",
      "e.left": "Left to share: {a}", "e.over": "Too much by {a}", "e.ok": "Adds up",
      "e.leftPct": "Left: {p}%", "e.overPct": "Too much by {p}%",
      "e.byLeft": "Left to assign to payers: {a}", "e.byOver": "Payers too much by {a}",
      "e.eachShare": "{n} shares", "e.share1": "1 share",
      "err.amount": "Type an amount, for example 12,50", "err.date": "Pick a date",
      "err.nobody": "Pick at least one person to share it", "err.sum": "The split must add up to the amount",
      "err.pct": "The percentages must add up to 100", "err.payers": "What the payers paid must add up to the amount",
      "err.payer": "Pick who paid", "err.value": "Check the number for {p}", "err.full": "This group is full ({n} entries)",
      "p.new": "Payment", "p.from": "From", "p.to": "To", "p.same": "Pick two different people",
      "gd.new": "New group", "gd.edit": "Group and people", "gd.name": "Name", "gd.name.ph": "e.g. Naxos holidays",
      "gd.cur": "Currency", "gd.cur.hint": "Changing it does not convert the amounts.", "gd.col": "Colour",
      "gd.col.n": "Colour {n}", "gd.people": "People", "gd.add": "Add", "gd.add.ph": "Name",
      "gd.me": "This is me", "gd.meOn": "Me", "gd.del": "Remove {p}", "gd.used": "{p} has expenses or payments and stays",
      "gd.hint": "Add everyone, yourself too, and tap “Me” next to your name.",
      "err.gname": "Give the group a name", "err.two": "Add at least two people", "err.pname": "Every person needs a name",
      "err.dup": "Two people have the same name", "err.people": "Up to {n} people", "err.groups": "Up to {n} groups",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.delete": "Delete", "dlg.close": "Close", "dlg.copy": "Copy",
      "toast.saved": "Saved", "toast.deleted": "Expense deleted", "toast.payDel": "Payment deleted",
      "toast.paid": "Payment recorded", "toast.gdel": "Group deleted", "toast.undo": "Undo",
      "toast.save": "Could not save: storage is full", "toast.copied": "Copied", "toast.copyFail": "Could not copy",
      "toast.arch": "Group archived", "toast.unarch": "Group back from the archive",
      "toast.whoami": "Tap “Me” next to your name",
      "sh.title": "Summary", "sh.total": "Spent in total: {a}", "sh.who": "Who pays whom:",
      "sh.even": "Everyone is even.", "sh.bal": "Balances:", "sh.foot": "Made with orOS Split",
      "exp.title": "Export", "exp.csvfmt": "CSV for", "exp.csv.excel": "Greek Excel (; and 12,50)",
      "exp.csv.std": "Other apps, orOS Spreadsheet (, and 12.50)", "exp.csv": "CSV", "exp.pdf": "PDF summary",
      "exp.done": "Exported", "exp.empty": "Nothing to export yet",
      "exp.lib": "Library not found (vendor/{f})", "exp.font": "Greek font not found: Greek text may not show in the PDF",
      "col.date": "Date", "col.type": "Type", "col.title": "What for", "col.cat": "Category", "col.amount": "Amount",
      "col.cur": "Currency", "col.by": "Paid by", "col.share": "Share: {p}", "col.note": "Note",
      "k.exp": "Expense", "k.pay": "Payment",
      "pdf.title": "Group expenses", "pdf.gen": "Created {d}", "pdf.list": "Expenses and payments", "pdf.page": "Page {n}",
      "file.done": "Group file ready: send it to the others",
      "im.group": "Group “{g}” joined: {n} new or newer items", "im.same": "Group “{g}”: nothing new",
      "im.bad": "This is not an orOS Split group file or backup", "im.big": "The file is too big",
      "im.backup": "Backup merged: {n} new or newer items", "im.bsame": "Backup merged: nothing new",
      "live.saved": "Saved", "live.group": "{g}", "live.home": "All groups",
      "bud.btn": "Add my share to Budget ({a})", "bud.note": "Split: {g} · {t}", "bud.fail": "Budget did not take it"
    },
    el: {
      "app": "Μοιρασιά",
      "btn.back": "Όλες οι ομάδες", "btn.menu": "Περισσότερα",
      "btn.newGroup": "Νέα ομάδα", "btn.newGroup.aria": "Νέα ομάδα (N)",
      "btn.newExp": "Έξοδο", "btn.newExp.aria": "Νέο έξοδο (N)",
      "tab.exp": "Έξοδα", "tab.bal": "Υπόλοιπα",
      "menu.import": "Εισαγωγή αρχείου ομάδας…", "menu.backup": "Αντίγραφο ασφαλείας (JSON)", "menu.restore": "Επαναφορά από αντίγραφο",
      "menu.edit": "Ομάδα και άτομα", "menu.share": "Κοινοποίηση σύνοψης", "menu.file": "Αποστολή αρχείου ομάδας",
      "menu.export": "Εξαγωγή (CSV, PDF)", "menu.arch": "Αρχειοθέτηση ομάδας", "menu.unarch": "Επαναφορά από το αρχείο",
      "menu.del": "Διαγραφή ομάδας",
      "home.empty": "Καμία ομάδα ακόμα. Ταξίδι, συγκατοίκηση, έξοδος: φτιάξε μια ομάδα, βάλε τα άτομα και μετά τα έξοδα.",
      "home.arch": "Αρχειοθετημένες ({n})",
      "g.people": "{n} άτομα", "g.people1": "1 άτομο", "g.exps": "{n} έξοδα", "g.exps1": "1 έξοδο",
      "g.youGet": "Παίρνεις {a}", "g.youOwe": "Χρωστάς {a}", "g.settled": "Εξοφλημένα", "g.spent": "Έξοδα {a}",
      "sum.total": "Έξοδα ομάδας", "sum.share": "Το μερίδιό σου", "sum.bal": "Το υπόλοιπό σου",
      "sum.whoami": "Ποιος είσαι εσύ;", "sum.whoami.hint": "Διάλεξε τον εαυτό σου για να βλέπεις τι χρωστάς ή τι παίρνεις.",
      "q.ph": "Αναζήτηση στα έξοδα…", "flt.all": "Όλα", "flt.cats": "Κατηγορία", "flt.people": "Με συμμετοχή",
      "flt.pay": "Μόνο πληρωμές",
      "list.empty": "Κανένα έξοδο ακόμα. Πάτα «Έξοδο» για να βάλεις το πρώτο.", "list.none": "Δεν βρέθηκε τίποτα.",
      "list.found": "Βρέθηκαν {n}",
      "row.paid": "Πλήρωσε: {p}", "row.you": "το μερίδιό σου {a}", "row.notYou": "δεν σε αφορά",
      "row.pay": "Πληρωμή", "row.and": "{a} και {b}", "row.many": "{a} και {n} ακόμα",
      "bal.title": "Υπόλοιπα", "bal.paid": "πλήρωσε {a}", "bal.share": "μερίδιο {a}",
      "bal.gets": "παίρνει {a}", "bal.owes": "χρωστάει {a}", "bal.even": "εντάξει",
      "bal.settle": "Ξεκαθάρισμα", "bal.settled": "Όλοι είναι εντάξει. Δεν χρειάζεται καμία πληρωμή.",
      "bal.hint": "Οι λιγότερες πληρωμές που κλείνουν τους λογαριασμούς.",
      "bal.paidBtn": "Πληρώθηκε", "bal.paidAria": "{f} έδωσε {a} σε {t}", "bal.record": "Καταγραφή πληρωμής",
      "bal.shareBtn": "Κοινοποίηση σύνοψης",
      "you": "εσύ", "unknown": "(άτομο που αφαιρέθηκε)",
      "cat.food": "Φαγητό & ποτό", "cat.groc": "Σούπερ μάρκετ", "cat.stay": "Διαμονή", "cat.trans": "Μεταφορές",
      "cat.bills": "Λογαριασμοί & ενοίκιο", "cat.fun": "Δραστηριότητες", "cat.other": "Άλλα",
      "e.new": "Νέο έξοδο", "e.edit": "Επεξεργασία εξόδου", "e.title": "Για τι", "e.title.ph": "π.χ. Φαγητό στην ταβέρνα",
      "e.amount": "Ποσό", "e.date": "Ημερομηνία", "e.cat": "Κατηγορία", "e.by": "Πλήρωσε", "e.byMany": "Πολλά άτομα…",
      "e.split": "Μοιρασιά", "e.m.eq": "Ίσα", "e.m.ex": "Ποσά", "e.m.sh": "Μερίδια", "e.m.pc": "%",
      "e.note": "Σημείωση", "e.note.ph": "Προαιρετικά", "e.all": "Όλοι", "e.none": "Κανείς",
      "e.left": "Μένουν να μοιραστούν: {a}", "e.over": "Περισσεύουν: {a}", "e.ok": "Βγαίνει σωστά",
      "e.leftPct": "Μένει: {p}%", "e.overPct": "Περισσεύει: {p}%",
      "e.byLeft": "Μένουν για τους πληρωτές: {a}", "e.byOver": "Οι πληρωτές περισσεύουν: {a}",
      "e.eachShare": "{n} μερίδια", "e.share1": "1 μερίδιο",
      "err.amount": "Γράψε ένα ποσό, π.χ. 12,50", "err.date": "Διάλεξε ημερομηνία",
      "err.nobody": "Διάλεξε τουλάχιστον ένα άτομο", "err.sum": "Τα ποσά πρέπει να βγάζουν το σύνολο",
      "err.pct": "Τα ποσοστά πρέπει να βγάζουν 100", "err.payers": "Όσα έδωσαν οι πληρωτές πρέπει να βγάζουν το σύνολο",
      "err.payer": "Διάλεξε ποιος πλήρωσε", "err.value": "Έλεγξε τον αριθμό για: {p}", "err.full": "Η ομάδα γέμισε ({n} εγγραφές)",
      "p.new": "Πληρωμή", "p.from": "Από", "p.to": "Προς", "p.same": "Διάλεξε δύο διαφορετικά άτομα",
      "gd.new": "Νέα ομάδα", "gd.edit": "Ομάδα και άτομα", "gd.name": "Όνομα", "gd.name.ph": "π.χ. Διακοπές Νάξος",
      "gd.cur": "Νόμισμα", "gd.cur.hint": "Η αλλαγή του δεν μετατρέπει τα ποσά.", "gd.col": "Χρώμα",
      "gd.col.n": "Χρώμα {n}", "gd.people": "Άτομα", "gd.add": "Προσθήκη", "gd.add.ph": "Όνομα",
      "gd.me": "Αυτός είμαι εγώ", "gd.meOn": "Εγώ", "gd.del": "Αφαίρεση: {p}", "gd.used": "Το άτομο {p} έχει έξοδα ή πληρωμές και μένει",
      "gd.hint": "Βάλε όλους, και τον εαυτό σου, και πάτα «Εγώ» δίπλα στο όνομά σου.",
      "err.gname": "Δώσε ένα όνομα στην ομάδα", "err.two": "Βάλε τουλάχιστον δύο άτομα", "err.pname": "Κάθε άτομο θέλει όνομα",
      "err.dup": "Δύο άτομα έχουν το ίδιο όνομα", "err.people": "Έως {n} άτομα", "err.groups": "Έως {n} ομάδες",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.delete": "Διαγραφή", "dlg.close": "Κλείσιμο", "dlg.copy": "Αντιγραφή",
      "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Το έξοδο διαγράφηκε", "toast.payDel": "Η πληρωμή διαγράφηκε",
      "toast.paid": "Η πληρωμή καταγράφηκε", "toast.gdel": "Η ομάδα διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή",
      "toast.arch": "Η ομάδα αρχειοθετήθηκε", "toast.unarch": "Η ομάδα επέστρεψε από το αρχείο",
      "toast.whoami": "Πάτα «Εγώ» δίπλα στο όνομά σου",
      "sh.title": "Σύνοψη", "sh.total": "Σύνολο εξόδων: {a}", "sh.who": "Ποιος δίνει σε ποιον:",
      "sh.even": "Όλοι είναι εντάξει.", "sh.bal": "Υπόλοιπα:", "sh.foot": "Από τη Μοιρασιά του orOS",
      "exp.title": "Εξαγωγή", "exp.csvfmt": "CSV για", "exp.csv.excel": "Ελληνικό Excel (; και 12,50)",
      "exp.csv.std": "Άλλες εφαρμογές, Υπολογιστικό φύλλο orOS (, και 12.50)", "exp.csv": "CSV", "exp.pdf": "Σύνοψη PDF",
      "exp.done": "Η εξαγωγή έγινε", "exp.empty": "Δεν υπάρχει τίποτα για εξαγωγή ακόμα",
      "exp.lib": "Δεν βρέθηκε η βιβλιοθήκη (vendor/{f})", "exp.font": "Δεν βρέθηκε η ελληνική γραμματοσειρά: τα ελληνικά μπορεί να μη φανούν στο PDF",
      "col.date": "Ημερομηνία", "col.type": "Τύπος", "col.title": "Για τι", "col.cat": "Κατηγορία", "col.amount": "Ποσό",
      "col.cur": "Νόμισμα", "col.by": "Πλήρωσε", "col.share": "Μερίδιο: {p}", "col.note": "Σημείωση",
      "k.exp": "Έξοδο", "k.pay": "Πληρωμή",
      "pdf.title": "Έξοδα ομάδας", "pdf.gen": "Δημιουργήθηκε {d}", "pdf.list": "Έξοδα και πληρωμές", "pdf.page": "Σελίδα {n}",
      "file.done": "Το αρχείο της ομάδας είναι έτοιμο: στείλ' το στους άλλους",
      "im.group": "Η ομάδα «{g}» ενώθηκε: {n} νέα ή νεότερα στοιχεία", "im.same": "Ομάδα «{g}»: τίποτα καινούργιο",
      "im.bad": "Αυτό δεν είναι αρχείο ομάδας ή αντίγραφο της Μοιρασιάς του orOS", "im.big": "Το αρχείο είναι πολύ μεγάλο",
      "im.backup": "Το αντίγραφο ενώθηκε: {n} νέα ή νεότερα στοιχεία", "im.bsame": "Το αντίγραφο ενώθηκε: τίποτα καινούργιο",
      "live.saved": "Αποθηκεύτηκε", "live.group": "{g}", "live.home": "Όλες οι ομάδες",
      "bud.btn": "Το μερίδιό μου στα Έσοδα & Έξοδα ({a})", "bud.note": "Μοιρασιά: {g} · {t}", "bud.fail": "Τα Έσοδα & Έξοδα δεν το δέχτηκαν"
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

  var MONTHS_GEN = {   // "8 October" / «8 Οκτωβρίου»
    en: ["January", "February", "March", "April", "May", "June", "July", "August",
         "September", "October", "November", "December"],
    el: ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου",
         "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"]
  };
  var WEEKDAYS = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    el: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"]
  };

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function newId() {
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + (r[0] % 1679616).toString(36);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("split.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Money + dates ----------
  // Typed amount → integer cents, or null. Accepts "12,50", "12.50",
  // "1.234,50", "1,234.50", "1 234", "€ 12". A single separator with
  // exactly three digits after it is a thousands separator ("1.250"
  // = 1250); with one or two it is the decimal point. (Budget's rule.)
  function parseAmount(s) {
    if (typeof s !== "string") return null;
    s = s.replace(/[\s  '’€$£¥%]/g, "").replace(/^\+/, "");
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
  // A split field: empty or zero = left out (0), else like parseAmount.
  // null = not a number. Percentages use it too (hundredths).
  function parsePart(s) {
    if (typeof s !== "string") return null;
    var v = s.replace(/[\s  %€]/g, "");
    if (!v || /^0*([.,]0*)?$/.test(v)) return 0;
    return parseAmount(v);
  }
  function parseShares(s) {
    if (typeof s !== "string") return null;
    var v = s.trim();
    if (!v) return 0;
    if (!/^[0-9]{1,4}$/.test(v)) return null;
    var n = Number(v);
    return n <= MAX_SHARES ? n : null;
  }
  // Cents → plain input text in the user's language ("12,50" / "12.50").
  function centsToInput(c, lang) {
    return (Math.floor(c / 100)) + (c % 100 ? (lang === "el" ? "," : ".") + pad2(c % 100) : "");
  }
  // Cents → "12.50" / "12,50" for CSV (no thousands separators).
  function centsPlain(c, decSep) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? "-" : "") + Math.floor(a / 100) + decSep + pad2(a % 100);
  }
  // Hundredths of a percent → "33,33" / "33.33" / "50".
  function pctText(h, lang) { return centsToInput(h, lang); }

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
  function weekday(ymd) { var p = parseYmd(ymd); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }

  // ---------- 3. Model ----------
  // group   = { id, m, n (name), col (0–8), cur, arch (0 | 1) }
  // person  = { id "<group>.<own>", m, n }
  // expense = { id "<group>.<own>", m, t (title), a (cents), d, c (category),
  //             by { person: cents } (who paid, sums to a),
  //             mode "eq" | "ex" | "sh" | "pc",
  //             w { person: weight } (eq: 1 each; sh: shares; pc: hundredths
  //               of a percent, sum 10000; ex: cents, sum a), n (note) }
  // payment = { id "<group>.<own>", m, f (from), to, a, d }
  // mine    = { id (group id), m, v (person id | "") } — who I am there
  // tombs   = { "grp:<id>" | "per:<id>" | "exp:<id>" | "pay:<id>": stamp }
  var GID_RE   = /^[a-z0-9]{1,24}$/;
  var CHILD_RE = /^[a-z0-9]{1,24}\.[a-z0-9]{1,24}$/;
  var TOMB_RE  = /^(grp:[a-z0-9]{1,24}|(per|exp|pay):[a-z0-9]{1,24}\.[a-z0-9]{1,24})$/;

  function groupOf(id) { var i = id.indexOf("."); return i < 0 ? id : id.slice(0, i); }
  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function okStamp(m) { return isInt(m) && m >= 0; }
  function okCents(a) { return isInt(a) && a > 0 && a <= MAX_CENTS; }
  function isChildOf(id, gid) { return typeof id === "string" && CHILD_RE.test(id) && groupOf(id) === gid; }

  // { person: positive int } of one group, keys sorted (R26). null when
  // empty, too big, or a value fails `ok`. Returns [map, sum].
  function normMap(x, gid, ok) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var keys = Object.keys(x);
    if (!keys.length || keys.length > MAX_PEOPLE * 2) return null;
    keys.sort(cmpStr);
    var out = {}, sum = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = x[k];
      if (!isChildOf(k, gid) || !ok(v)) return null;
      out[k] = v;
      sum += v;
    }
    return [out, sum];
  }
  function okOne(v) { return v === 1; }
  function okShare(v) { return isInt(v) && v > 0 && v <= MAX_SHARES; }
  function okPct(v) { return isInt(v) && v > 0 && v <= PCT_FULL; }

  function normGroup(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !GID_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    return { id: x.id, m: x.m, n: n,
             col: isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : 0,
             cur: CURRENCIES.indexOf(x.cur) >= 0 ? x.cur : "EUR",
             arch: x.arch ? 1 : 0 };
  }
  function normPerson(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !CHILD_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, PERSON_LEN);
    return n ? { id: x.id, m: x.m, n: n } : null;
  }
  function normExp(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !CHILD_RE.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !parseYmd(x.d) || !MODES[x.mode]) return null;
    var g = groupOf(x.id);
    var by = normMap(x.by, g, okCents);
    if (!by || by[1] !== x.a) return null;
    var ok = { eq: okOne, sh: okShare, pc: okPct, ex: okCents }[x.mode];
    var w = normMap(x.w, g, ok);
    if (!w) return null;
    if (x.mode === "pc" && w[1] !== PCT_FULL) return null;
    if (x.mode === "ex" && w[1] !== x.a) return null;
    return { id: x.id, m: x.m, t: normText(x.t, TITLE_LEN), a: x.a, d: x.d,
             c: CAT_BY_ID[x.c] ? x.c : "other", by: by[0], mode: x.mode, w: w[0], n: normText(x.n, NOTE_LEN) };
  }
  function normPay(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !CHILD_RE.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !parseYmd(x.d)) return null;
    var g = groupOf(x.id);
    if (!isChildOf(x.f, g) || !isChildOf(x.to, g) || x.f === x.to) return null;
    return { id: x.id, m: x.m, f: x.f, to: x.to, a: x.a, d: x.d };
  }
  function normMine(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !GID_RE.test(x.id) || !okStamp(x.m)) return null;
    return { id: x.id, m: x.m, v: isChildOf(x.v, x.id) ? x.v : "" };
  }

  var COLLS = [
    { key: "groups", tomb: "grp", norm: normGroup, child: false },
    { key: "people", tomb: "per", norm: normPerson, child: true },
    { key: "exp",    tomb: "exp", norm: normExp, child: true },
    { key: "pay",    tomb: "pay", norm: normPay, child: true },
    { key: "mine",   tomb: null,  norm: normMine, child: true }
  ];

  function emptyData() { return { ver: DATA_VER, groups: [], people: [], exp: [], pay: [], mine: [], tombs: {} }; }

  function laterOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.m !== a.m) return b.m > a.m ? b : a;
    return JSON.stringify(b) > JSON.stringify(a) ? b : a;
  }

  // Merge: per collection LWW by id (newer m wins; equal m: the larger
  // canonical JSON); tombstones max-merged, delete wins ties, a newer
  // edit resurrects (R17). A deleted group (tombstone, not live) takes
  // every child with it: people, expenses, payments and `mine` whose id
  // starts with its id. A group that comes back (newer edit) brings
  // back whatever children are still around. Symmetric, idempotent,
  // canonical (R5, R26).
  function mergeSplit(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (k) {
        if (!TOMB_RE.test(k) || !okStamp(tm[k])) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var out = { ver: DATA_VER }, liveG = {};
    COLLS.forEach(function (C) {
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
        if (C.child) {
          var g = groupOf(id);
          if (("grp:" + g) in tombs && !liveG[g]) return;
        } else {
          liveG[id] = 1;
        }
        arr.push(best[id]);
      });
      out[C.key] = arr;
    });
    var st = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { st[k] = tombs[k]; });
    out.tombs = st;
    return out;
  }

  // ---------- 4. Derived ----------
  // Who owes what of one expense: { person: cents }, summing to the
  // amount. Exact amounts are taken as they are. Otherwise each gets
  // floor(a × w / W) and the cents left over go one each to the
  // largest remainders, ties to the smaller person id — the same on
  // every device.
  function sharesOf(x) {
    var out = {};
    var ids = Object.keys(x.w).sort(cmpStr);
    if (x.mode === "ex") { ids.forEach(function (k) { out[k] = x.w[k]; }); return out; }
    var W = 0;
    ids.forEach(function (k) { W += x.w[k]; });
    var given = 0, rems = [];
    ids.forEach(function (k) {
      var p = x.a * x.w[k];
      out[k] = Math.floor(p / W);
      given += out[k];
      rems.push({ k: k, r: p % W });
    });
    rems.sort(function (p, q) { return q.r - p.r || cmpStr(p.k, q.k); });
    for (var i = 0; given < x.a; i++, given++) out[rems[i % rems.length].k]++;
    return out;
  }

  function liveGroups(d) { return d.groups; }
  function groupById(d, gid) {
    for (var i = 0; i < d.groups.length; i++) if (d.groups[i].id === gid) return d.groups[i];
    return null;
  }
  function peopleOf(d, gid) { return d.people.filter(function (p) { return groupOf(p.id) === gid; }); }
  function expOf(d, gid) { return d.exp.filter(function (x) { return groupOf(x.id) === gid; }); }
  function payOf(d, gid) { return d.pay.filter(function (x) { return groupOf(x.id) === gid; }); }
  function meOf(d, gid) {
    for (var i = 0; i < d.mine.length; i++) if (d.mine[i].id === gid) return d.mine[i].v;
    return "";
  }

  // Per person of a group: paid, share, and the balance
  // (positive = gets money back, negative = owes). Payments count:
  // the payer's balance goes up, the receiver's goes down. People
  // that only appear in an entry (removed on another device) are
  // counted too. The balances always add up to zero.
  function balancesOf(d, gid) {
    var rows = {};
    var row = function (id) { return rows[id] || (rows[id] = { id: id, paid: 0, share: 0, bal: 0 }); };
    peopleOf(d, gid).forEach(function (p) { row(p.id); });
    expOf(d, gid).forEach(function (x) {
      Object.keys(x.by).forEach(function (k) { row(k).paid += x.by[k]; row(k).bal += x.by[k]; });
      var sh = sharesOf(x);
      Object.keys(sh).forEach(function (k) { row(k).share += sh[k]; row(k).bal -= sh[k]; });
    });
    payOf(d, gid).forEach(function (p) { row(p.f).bal += p.a; row(p.to).bal -= p.a; });
    return rows;
  }

  // The fewest payments (at most people − 1) that bring every balance
  // to zero: the biggest debtor pays the biggest creditor, again and
  // again; ties by person id, so every device suggests the same.
  function settleUp(rows) {
    var cred = [], debt = [];
    Object.keys(rows).forEach(function (k) {
      var b = rows[k].bal;
      if (b > 0) cred.push({ id: k, a: b });
      else if (b < 0) debt.push({ id: k, a: -b });
    });
    var pick = function (list) {
      var best = null;
      list.forEach(function (x) {
        if (x.a > 0 && (!best || x.a > best.a || (x.a === best.a && x.id < best.id))) best = x;
      });
      return best;
    };
    var out = [];
    for (var guard = 0; guard < 200; guard++) {
      var dd = pick(debt), cc = pick(cred);
      if (!dd || !cc) break;
      var a = Math.min(dd.a, cc.a);
      out.push({ f: dd.id, to: cc.id, a: a });
      dd.a -= a;
      cc.a -= a;
    }
    return out;
  }

  function groupTotal(d, gid) {
    var s = 0;
    expOf(d, gid).forEach(function (x) { s += x.a; });
    return s;
  }

  // The text summary for Viber / WhatsApp / e-mail.
  // `tr(key, params)` = t, `name(id)`, `money(cents)` come from the app.
  function summaryText(d, gid, tr, name, money) {
    var g = groupById(d, gid);
    if (!g) return "";
    var rows = balancesOf(d, gid);
    var lines = [g.n, tr("sh.total", { a: money(groupTotal(d, gid)) }), ""];
    var pays = settleUp(rows);
    if (pays.length) {
      lines.push(tr("sh.who"));
      pays.forEach(function (p) { lines.push("• " + name(p.f) + " → " + name(p.to) + ": " + money(p.a)); });
    } else {
      lines.push(tr("sh.even"));
    }
    lines.push("");
    lines.push(tr("sh.bal"));
    Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (x, y) { return y.bal - x.bal || cmpStr(name(x.id), name(y.id)); })
      .forEach(function (r) {
        lines.push("• " + name(r.id) + ": " + (r.bal > 0 ? "+" : r.bal < 0 ? "−" : "") + money(Math.abs(r.bal)));
      });
    lines.push("");
    lines.push(tr("sh.foot"));
    return lines.join("\n");
  }

  // "Add my share to Budget": the payload of the bridge contract
  // (expenses/budget-bridge-contract.md), or null when I have no
  // share in it. A prefill: Budget stores nothing until Save there.
  function budgetPayload(x, me, groupName, note) {
    var share = me ? sharesOf(x)[me] : 0;
    if (!share) return null;
    return { k: "o", a: share, d: x.d, n: normText(note, NOTE_LEN), c: BUDGET_CAT[x.c] || "o-other", src: "split" };
  }

  // ---------- 5. CSV + group file ----------
  // RFC 4180 quoting. A text cell that starts with = + - @ (or a tab /
  // CR) gets a leading apostrophe so a spreadsheet never runs it as a
  // formula (CSV injection).
  function csvCell(v, sep) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // head: text cells; rows: arrays where numbers are cents.
  // fmt "excel": ";" and "12,50"; "std": "," and "12.50". With a BOM.
  function buildCsv(head, rows, fmt) {
    var sep = fmt === "excel" ? ";" : ",", dec = fmt === "excel" ? "," : ".";
    var lines = [head.map(function (h) { return csvCell(h, sep); }).join(sep)];
    rows.forEach(function (r) {
      lines.push(r.map(function (v) {
        return typeof v === "number" ? centsPlain(v, dec) : csvCell(v, sep);
      }).join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  var GROUP_APP = "oros-split-group", BACKUP_APP = "oros-split";

  // One group, its people, expenses, payments and the tombstones of
  // its own children: what a friend's orOS needs to join it. Never
  // `mine` (who you are is yours).
  function packGroup(d, gid) {
    var pre = gid + ".";
    var tombs = {};
    Object.keys(d.tombs).forEach(function (k) {
      if (k.slice(4, 4 + pre.length) === pre) tombs[k] = d.tombs[k];
    });
    return { app: GROUP_APP, ver: DATA_VER,
             data: mergeSplit({ groups: [groupById(d, gid)], people: peopleOf(d, gid), exp: expOf(d, gid),
                                pay: payOf(d, gid), mine: [], tombs: tombs }, null) };
  }
  // A group file → { gid, data } with ONLY that group (one live group,
  // children with its prefix, their tombstones); null if it is not a
  // group file. A file can never touch another group or your `mine`.
  function unpackGroup(obj) {
    if (!obj || typeof obj !== "object" || obj.app !== GROUP_APP || !obj.data || typeof obj.data !== "object") return null;
    var src = obj.data;
    if (!Array.isArray(src.groups)) return null;
    var gs = src.groups.map(normGroup).filter(Boolean);
    if (gs.length !== 1) return null;
    var gid = gs[0].id, pre = gid + ".";
    var only = function (list) {
      return Array.isArray(list) ? list.filter(function (x) {
        return x && typeof x.id === "string" && x.id.slice(0, pre.length) === pre;
      }) : [];
    };
    var tombs = {};
    if (src.tombs && typeof src.tombs === "object") {
      Object.keys(src.tombs).forEach(function (k) {
        if (k.slice(4, 4 + pre.length) === pre) tombs[k] = src.tombs[k];
      });
    }
    var clean = mergeSplit({ groups: gs, people: only(src.people), exp: only(src.exp), pay: only(src.pay),
                             mine: [], tombs: tombs }, null);
    if (clean.groups.length !== 1) return null;
    return { gid: gid, data: clean };
  }

  // How many items differ between two canonical states (import toasts).
  function changedCount(a, b) {
    var n = 0;
    COLLS.forEach(function (C) {
      var idx = {};
      a[C.key].forEach(function (x) { idx[x.id] = JSON.stringify(x); });
      b[C.key].forEach(function (x) { if (idx[x.id] !== JSON.stringify(x)) n++; });
    });
    return n;
  }

  // ---------- 6. Storage, prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.groups)) {
          data = mergeSplit(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] split: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  // Canonicalize, persist, mark dirty. Callers stamp m themselves (R27).
  function commit() {
    data = mergeSplit(data, data);
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
      g: typeof p.g === "string" && GID_RE.test(p.g) ? p.g : "",
      tab: p.tab === "bal" ? "bal" : "exp",
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
  var query = "", filter = "all";

  function curGroup() { return prefs.g ? groupById(data, prefs.g) : null; }
  function catName(id) { return t("cat." + (CAT_BY_ID[id] ? id : "other")); }
  function catCol(id) { return (CAT_BY_ID[id] || CAT_BY_ID.other).col; }
  function personName(id) {
    var p = findIn(data.people, id);
    return p ? p.n : t("unknown");
  }
  // Name with "(you)" for the current group's "me".
  function whoName(id) {
    var g = curGroup();
    var me = g ? meOf(data, g.id) : "";
    return personName(id) + (id && id === me ? " (" + t("you") + ")" : "");
  }

  var fmtCache = {};
  function moneyIn(cents, cur) {
    var key = cur || "EUR";
    if (!fmtCache[key]) {
      try { fmtCache[key] = new Intl.NumberFormat(LOCALE, { style: "currency", currency: key }); }
      catch (e) { fmtCache[key] = { format: function (v) { return v.toFixed(2) + " " + key; } }; }
    }
    return fmtCache[key].format(cents / 100);
  }
  function money(cents) { var g = curGroup(); return moneyIn(cents, g ? g.cur : "EUR"); }
  function dayLabel(ymd) {
    var p = parseYmd(ymd);
    var s = WEEKDAYS[LANG][weekday(ymd)] + " " + p.d + " " + MONTHS_GEN[LANG][p.m - 1];
    return p.y === +today.slice(0, 4) ? s : s + " " + p.y;
  }
  function dateShort(ymd) { var p = parseYmd(ymd); return pad2(p.d) + "/" + pad2(p.m) + "/" + p.y; }
  function namesList(ids) {
    var names = ids.map(personName);
    if (names.length === 1) return names[0];
    if (names.length === 2) return t("row.and", { a: names[0], b: names[1] });
    return t("row.many", { a: names[0], n: names.length - 1 });
  }

  // ---------- 7. Rendering ----------
  var UI = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
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
    var g = curGroup();
    if (prefs.g && !g) { prefs.g = ""; savePrefs(); }
    renderToolbar(g);
    $("home").hidden = !!g;
    $("grp").hidden = !g;
    $("tabs").hidden = !g;
    if (!g) { renderHome(); return; }
    renderTabs();
    renderSummary(g);
    if (prefs.tab === "exp") { renderFilter(g); renderList(g); }
    else renderBalances(g);
  }

  function renderToolbar(g) {
    $("back-btn").hidden = !g;
    $("title").textContent = g ? g.n : t("app");
    var add = $("add-btn");
    add.innerHTML = UI.plus + "<span>" + (g ? t("btn.newExp") : t("btn.newGroup")) + "</span>";
    add.setAttribute("aria-label", g ? t("btn.newExp.aria") : t("btn.newGroup.aria"));
    add.title = add.getAttribute("aria-label");
  }

  function renderTabs() {
    ["exp", "bal"].forEach(function (k) {
      var b = $("tab-" + k), on = prefs.tab === k;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      $("p-" + k).hidden = !on;
    });
  }

  // Home: the groups, newest activity first, archived ones folded.
  function lastActivity(gid) {
    var m = 0;
    expOf(data, gid).forEach(function (x) { if (x.m > m) m = x.m; });
    payOf(data, gid).forEach(function (x) { if (x.m > m) m = x.m; });
    var g = groupById(data, gid);
    return Math.max(m, g ? g.m : 0);
  }
  function renderHome() {
    var box = $("groups"), arch = $("arch");
    box.innerHTML = "";
    arch.innerHTML = "";
    var list = liveGroups(data).slice().sort(function (a, b) {
      return lastActivity(b.id) - lastActivity(a.id) || a.n.localeCompare(b.n) || cmpStr(a.id, b.id);
    });
    var open = list.filter(function (g) { return !g.arch; }), done = list.filter(function (g) { return g.arch; });
    $("home-empty").hidden = list.length > 0;
    open.forEach(function (g) { box.appendChild(groupCard(g)); });
    $("arch-box").hidden = !done.length;
    $("arch-sum").textContent = t("home.arch", { n: done.length });
    done.forEach(function (g) { arch.appendChild(groupCard(g)); });
  }
  function groupCard(g) {
    var b = el("button", "gcard");
    b.type = "button";
    var dot = el("span", "gdot");
    dot.style.background = "var(--c" + g.col + ")";
    dot.setAttribute("aria-hidden", "true");
    b.appendChild(dot);
    var mid = el("span", "g-mid");
    mid.appendChild(el("span", "g-name", g.n));
    var np = peopleOf(data, g.id).length, ne = expOf(data, g.id).length;
    mid.appendChild(el("span", "g-sub", (np === 1 ? t("g.people1") : t("g.people", { n: np })) + " · " +
                                         (ne === 1 ? t("g.exps1") : t("g.exps", { n: ne }))));
    b.appendChild(mid);
    var me = meOf(data, g.id), stTxt, stCls = "g-st";
    if (me) {
      var r = balancesOf(data, g.id)[me], bal = r ? r.bal : 0;
      if (bal > 0) { stTxt = t("g.youGet", { a: moneyIn(bal, g.cur) }); stCls += " pos"; }
      else if (bal < 0) { stTxt = t("g.youOwe", { a: moneyIn(-bal, g.cur) }); stCls += " neg"; }
      else stTxt = t("g.settled");
    } else {
      stTxt = t("g.spent", { a: moneyIn(groupTotal(data, g.id), g.cur) });
    }
    b.appendChild(el("span", stCls, stTxt));
    b.setAttribute("aria-label", g.n + ", " + mid.lastChild.textContent + ", " + stTxt);
    b.addEventListener("click", function () { openGroup(g.id); });
    return b;
  }

  function renderSummary(g) {
    var me = meOf(data, g.id);
    $("sum-total").textContent = money(groupTotal(data, g.id));
    $("t-share").hidden = !me;
    $("t-bal").hidden = !me;
    $("t-who").hidden = !!me;
    if (me) {
      var r = balancesOf(data, g.id)[me] || { share: 0, bal: 0 };
      $("sum-share").textContent = money(r.share);
      var b = $("sum-bal");
      b.textContent = (r.bal > 0 ? "+" : r.bal < 0 ? "−" : "") + money(Math.abs(r.bal));
      b.classList.toggle("neg", r.bal < 0);
      b.classList.toggle("pos", r.bal > 0);
    }
  }

  function renderFilter(g) {
    var sel = $("flt"), prev = filter;
    sel.innerHTML = "";
    var add = function (parent, v, label) { var o = el("option", "", label); o.value = v; parent.appendChild(o); };
    add(sel, "all", t("flt.all"));
    add(sel, "pay", t("flt.pay"));
    var g1 = el("optgroup"); g1.label = t("flt.cats");
    CATS.forEach(function (c) { add(g1, "c:" + c.id, catName(c.id)); });
    var g2 = el("optgroup"); g2.label = t("flt.people");
    peopleOf(data, g.id).slice().sort(function (a, b) { return a.n.localeCompare(b.n); })
      .forEach(function (p) { add(g2, "p:" + p.id, whoName(p.id)); });
    sel.appendChild(g1);
    sel.appendChild(g2);
    sel.value = prev;
    if (sel.value !== prev) { filter = "all"; sel.value = "all"; }
  }

  // Entries of the list: expenses and payments, one shape.
  function entriesOf(gid) {
    var out = [];
    expOf(data, gid).forEach(function (x) { out.push({ kind: "e", x: x }); });
    payOf(data, gid).forEach(function (x) { out.push({ kind: "p", x: x }); });
    out.sort(function (p, q) { return cmpStr(q.x.d, p.x.d) || q.x.m - p.x.m || cmpStr(q.x.id, p.x.id); });
    return out;
  }
  function entryMatches(en) {
    var x = en.x;
    if (filter === "pay" && en.kind !== "p") return false;
    if (filter.indexOf("c:") === 0 && (en.kind !== "e" || x.c !== filter.slice(2))) return false;
    if (filter.indexOf("p:") === 0) {
      var pid = filter.slice(2);
      if (en.kind === "e" ? !(pid in x.by) && !(pid in x.w) : x.f !== pid && x.to !== pid) return false;
    }
    if (query) {
      var hay = en.kind === "e"
        ? [x.t, x.n, catName(x.c), Object.keys(x.by).map(personName).join(" "), centsToInput(x.a, LANG)].join(" ")
        : [personName(x.f), personName(x.to), t("row.pay"), centsToInput(x.a, LANG)].join(" ");
      if (hay.toLowerCase().indexOf(query) < 0) return false;
    }
    return true;
  }

  function renderList(g) {
    var box = $("list");
    box.innerHTML = "";
    var rows = entriesOf(g.id).filter(entryMatches);
    var empty = $("list-empty"), found = $("list-found");
    found.hidden = !query;
    if (query) found.textContent = t("list.found", { n: rows.length });
    empty.hidden = rows.length > 0;
    empty.textContent = (query || filter !== "all") ? t("list.none") : t("list.empty");
    var me = meOf(data, g.id), day = null, group = null;
    rows.forEach(function (en) {
      if (en.x.d !== day) {
        day = en.x.d;
        box.appendChild(el("div", "day-head", dayLabel(day)));
        group = el("ul", "day-list");
        box.appendChild(group);
      }
      group.appendChild(en.kind === "e" ? expRow(en.x, me) : payRow(en.x));
    });
  }

  function expRow(x, me) {
    var li = el("li");
    var b = el("button", "tx");
    b.type = "button";
    b.appendChild(swatch(catCol(x.c)));
    var mid = el("span", "tx-mid");
    mid.appendChild(el("span", "tx-cat", x.t || catName(x.c)));
    var sub = t("row.paid", { p: namesList(Object.keys(x.by)) });
    if (me) {
      var sh = sharesOf(x)[me];
      sub += " · " + (sh ? t("row.you", { a: money(sh) }) : t("row.notYou"));
    }
    mid.appendChild(el("span", "tx-note", sub));
    b.appendChild(mid);
    b.appendChild(el("span", "tx-amt", money(x.a)));
    b.setAttribute("aria-label", (x.t || catName(x.c)) + ", " + money(x.a) + ", " + sub + ", " + dateShort(x.d));
    b.addEventListener("click", function () { expDialog(x.id); });
    li.appendChild(b);
    return li;
  }
  function payRow(p) {
    var li = el("li");
    var b = el("button", "tx pay");
    b.type = "button";
    var ic = el("span", "pay-ic");
    ic.innerHTML = UI.arrow;
    ic.setAttribute("aria-hidden", "true");
    b.appendChild(ic);
    var mid = el("span", "tx-mid");
    mid.appendChild(el("span", "tx-cat", whoName(p.f) + " → " + whoName(p.to)));
    mid.appendChild(el("span", "tx-note", t("row.pay")));
    b.appendChild(mid);
    b.appendChild(el("span", "tx-amt", money(p.a)));
    b.setAttribute("aria-label", t("bal.paidAria", { f: whoName(p.f), a: money(p.a), t: whoName(p.to) }) + ", " + dateShort(p.d));
    b.addEventListener("click", function () { payDialog(p.id, null); });
    li.appendChild(b);
    return li;
  }

  // Balances tab: per person, then the payments that settle it.
  function renderBalances(g) {
    var box = $("bal");
    box.innerHTML = "";
    var rows = balancesOf(data, g.id);
    var list = Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (a, b) { return b.bal - a.bal || personName(a.id).localeCompare(personName(b.id)) || cmpStr(a.id, b.id); });
    var max = 1;
    list.forEach(function (r) { max = Math.max(max, Math.abs(r.bal)); });
    var card = el("div", "card");
    card.appendChild(el("h2", "", t("bal.title")));
    var ul = el("ul", "bal-list");
    list.forEach(function (r) {
      var li = el("li", "bal-row");
      var top = el("div", "bal-top");
      top.appendChild(el("span", "bal-name", whoName(r.id)));
      var st = r.bal > 0 ? t("bal.gets", { a: money(r.bal) }) : r.bal < 0 ? t("bal.owes", { a: money(-r.bal) }) : t("bal.even");
      top.appendChild(el("span", "bal-amt " + (r.bal > 0 ? "pos" : r.bal < 0 ? "neg" : ""), st));
      li.appendChild(top);
      var bar = el("div", "dbar");
      bar.setAttribute("aria-hidden", "true");
      var f = el("span", r.bal >= 0 ? "pos" : "neg");
      f.style.width = (Math.abs(r.bal) * 50 / max) + "%";
      bar.appendChild(f);
      li.appendChild(bar);
      li.appendChild(el("div", "bal-sub", t("bal.paid", { a: money(r.paid) }) + " · " + t("bal.share", { a: money(r.share) })));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    box.appendChild(card);

    var sc = el("div", "card");
    sc.appendChild(el("h2", "", t("bal.settle")));
    var pays = settleUp(rows);
    if (!pays.length) sc.appendChild(el("p", "hint", t("bal.settled")));
    else {
      sc.appendChild(el("p", "hint", t("bal.hint")));
      var pl = el("ul", "settle");
      pays.forEach(function (p) {
        var li = el("li");
        var txt = el("span", "st-txt");
        txt.appendChild(el("span", "st-who", whoName(p.f) + " → " + whoName(p.to)));
        txt.appendChild(el("span", "st-amt", money(p.a)));
        li.appendChild(txt);
        var b = el("button", "mini ok");
        b.type = "button";
        b.innerHTML = UI.check;
        b.appendChild(el("span", "", t("bal.paidBtn")));
        b.setAttribute("aria-label", t("bal.paidAria", { f: whoName(p.f), a: money(p.a), t: whoName(p.to) }));
        b.addEventListener("click", function () { recordPayment(g.id, p.f, p.to, p.a); });
        li.appendChild(b);
        pl.appendChild(li);
      });
      sc.appendChild(pl);
    }
    var acts = el("div", "card-acts");
    var rb = el("button", "txt-btn", t("bal.record"));
    rb.type = "button";
    rb.addEventListener("click", function () { payDialog(null, null); });
    var sb = el("button", "txt-btn", t("bal.shareBtn"));
    sb.type = "button";
    sb.addEventListener("click", shareSummary);
    acts.appendChild(rb);
    acts.appendChild(sb);
    sc.appendChild(acts);
    box.appendChild(sc);
  }

  // ---------- 8. Dialogs ----------
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
  function amountInput(cents) {
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.value = cents ? centsToInput(cents, LANG) : "";
    amt.placeholder = LANG === "el" ? "0,00" : "0.00";
    return amt;
  }
  function errLine() { var p = el("p", "err"); p.setAttribute("role", "alert"); p.hidden = true; return p; }
  function showErr(p, msg, focusEl) { p.textContent = msg; p.hidden = false; if (focusEl) focusEl.focus(); }
  function personSelect(people, selected) {
    var sel = el("select");
    people.forEach(function (p) { var o = el("option", "", whoName(p.id)); o.value = p.id; sel.appendChild(o); });
    if (selected) sel.value = selected;
    return sel;
  }
  function sortedPeople(gid) {
    return peopleOf(data, gid).slice().sort(function (a, b) { return a.n.localeCompare(b.n) || cmpStr(a.id, b.id); });
  }
  function entriesCount(gid) { return expOf(data, gid).length + payOf(data, gid).length; }

  // New / edit expense. The split preview is the real sharesOf() of
  // what is on the form, so what you see is what is saved.
  function expDialog(id) {
    var g = curGroup();
    if (!g) return;
    var x = id ? findIn(data.exp, id) : null;
    if (id && !x) return;
    if (!x && entriesCount(g.id) >= MAX_EXP) { showToast(t("err.full", { n: MAX_EXP })); return; }
    var people = sortedPeople(g.id);
    // People named in the expense but removed on another device stay on the form.
    if (x) {
      Object.keys(x.by).concat(Object.keys(x.w)).forEach(function (k) {
        if (!findIn(people, k)) people.push({ id: k, n: t("unknown") });
      });
    }
    var me = meOf(data, g.id);
    var dlg = makeDialog("sp-exp", t(x ? "e.edit" : "e.new"));
    dlg.classList.add("wide");
    var form = el("form");
    var title = el("input");
    title.maxLength = TITLE_LEN;
    title.autocomplete = "off";
    title.placeholder = t("e.title.ph");
    title.value = x ? x.t : "";
    var amt = amountInput(x ? x.a : 0);
    amt.className = "amt-in";
    var date = el("input");
    date.type = "date";
    date.value = x ? x.d : today;
    var cat = el("select");
    CATS.forEach(function (c) { var o = el("option", "", catName(c.id)); o.value = c.id; cat.appendChild(o); });
    cat.value = x ? x.c : "food";

    // Paid by: one person, or several with their amounts.
    var payerIds = x ? Object.keys(x.by) : [];
    var by = el("select");
    people.forEach(function (p) { var o = el("option", "", whoName(p.id)); o.value = p.id; by.appendChild(o); });
    var om = el("option", "", t("e.byMany")); om.value = "*"; by.appendChild(om);
    by.value = payerIds.length > 1 ? "*" : (payerIds[0] || me || (people[0] && people[0].id) || "");
    var byBox = el("div", "rows");
    var byIn = {};
    people.forEach(function (p) {
      var row = el("div", "prow");
      row.appendChild(el("span", "p-name", whoName(p.id)));
      var inp = amountInput(x && payerIds.length > 1 && x.by[p.id] ? x.by[p.id] : 0);
      inp.className = "p-in";
      inp.setAttribute("aria-label", t("e.by") + ": " + whoName(p.id));
      inp.addEventListener("input", preview);
      byIn[p.id] = inp;
      row.appendChild(inp);
      byBox.appendChild(row);
    });
    var byLeft = el("p", "left");

    // Split mode + one row per person.
    var mode = x ? x.mode : "eq";
    var seg = el("div", "seg seg4");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("e.split"));
    var segB = {};
    ["eq", "ex", "sh", "pc"].forEach(function (m) {
      var b = el("button", "seg-btn", t("e.m." + m));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { setMode(m); });
      segB[m] = b;
      seg.appendChild(b);
    });
    var allBtn = el("button", "link-btn", t("e.all"));
    allBtn.type = "button";
    var rowsBox = el("div", "rows");
    var rowIn = {};
    people.forEach(function (p) {
      var row = el("label", "prow");
      var chk = el("input");
      chk.type = "checkbox";
      chk.className = "p-chk";
      chk.checked = x ? (p.id in x.w) : !!findIn(peopleOf(data, g.id), p.id);
      chk.addEventListener("change", preview);
      var nm = el("span", "p-name", whoName(p.id));
      var inp = el("input", "p-in");
      inp.autocomplete = "off";
      inp.setAttribute("aria-label", t("e.split") + ": " + whoName(p.id));
      inp.addEventListener("input", preview);
      var out = el("span", "p-out");
      row.appendChild(chk);
      row.appendChild(nm);
      row.appendChild(inp);
      row.appendChild(out);
      rowsBox.appendChild(row);
      rowIn[p.id] = { chk: chk, inp: inp, out: out, row: row };
    });
    // Starting values of the inputs per mode (an edit keeps its own).
    var valsFor = function (m) {
      people.forEach(function (p) {
        var r = rowIn[p.id], w = x && x.mode === m ? x.w[p.id] : undefined;
        if (m === "ex") r.inp.value = w ? centsToInput(w, LANG) : "";
        else if (m === "pc") r.inp.value = w ? pctText(w, LANG) : "";
        else if (m === "sh") r.inp.value = w ? String(w) : (r.chk.checked ? "1" : "");
        r.inp.inputMode = m === "sh" ? "numeric" : "decimal";
        r.inp.placeholder = m === "sh" ? "0" : (LANG === "el" ? "0,00" : "0.00");
      });
    };
    var left = el("p", "left");
    allBtn.addEventListener("click", function () {
      var all = people.every(function (p) { return rowIn[p.id].chk.checked; });
      people.forEach(function (p) { rowIn[p.id].chk.checked = !all; });
      preview();
    });

    var note = el("input");
    note.maxLength = NOTE_LEN;
    note.autocomplete = "off";
    note.placeholder = t("e.note.ph");
    note.value = x ? x.n : "";
    var err = errLine();

    form.appendChild(field(t("e.title"), title, "sp-title"));
    form.appendChild(field(t("e.amount") + " (" + g.cur + ")", amt, "sp-amt"));
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("e.date"), date, "sp-date"));
    r1.appendChild(field(t("e.cat"), cat, "sp-cat"));
    form.appendChild(r1);
    form.appendChild(field(t("e.by"), by, "sp-by"));
    form.appendChild(byBox);
    form.appendChild(byLeft);
    var sh = el("div", "split-head");
    sh.appendChild(el("span", "dlg-lbl", t("e.split")));
    sh.appendChild(allBtn);
    form.appendChild(sh);
    form.appendChild(seg);
    form.appendChild(rowsBox);
    form.appendChild(left);
    form.appendChild(field(t("e.note"), note, "sp-note"));
    form.appendChild(err);
    var bp = x ? budgetPayload(x, me, g.n, t("bud.note", { g: g.n, t: x.t || catName(x.c) })) : null;
    if (bp && budgetBridge()) {
      var bb = button(t("bud.btn", { a: money(bp.a) }), "wide-btn", function () {
        var ok = false;
        try { ok = budgetBridge()(bp) !== false; } catch (e2) {}
        if (ok) dlg.close(); else showToast(t("bud.fail"));
      });
      form.appendChild(bb);
    }
    var acts = el("div", "dlg-actions");
    if (x) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); deleteExp(x.id); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    function setMode(m) {
      mode = m;
      Object.keys(segB).forEach(function (k) { segB[k].setAttribute("aria-checked", k === m ? "true" : "false"); });
      rowsBox.className = "rows split-" + m;
      allBtn.hidden = m !== "eq";
      valsFor(m);
      preview();
    }
    // Reads the form → { a, by, w, wsum, err?, focus? }: every part it
    // can read, plus the first problem (the preview shows what it can).
    function readForm() {
      var r = { a: parseAmount(amt.value), by: {}, w: {}, wsum: 0, err: "", focus: null };
      var fail = function (msg, f) { if (!r.err) { r.err = msg; r.focus = f || null; } };
      if (r.a === null) { r.a = 0; fail(t("err.amount"), amt); }
      if (by.value === "*") {
        var sum = 0;
        people.forEach(function (p) {
          var v = parsePart(byIn[p.id].value);
          if (v === null) fail(t("err.value", { p: p.n }), byIn[p.id]);
          else if (v) { r.by[p.id] = v; sum += v; }
        });
        if (!sum) fail(t("err.payer"), people.length ? byIn[people[0].id] : by);
        else if (r.a && sum !== r.a) fail(t("err.payers"), null);
      } else if (by.value) {
        if (r.a) r.by[by.value] = r.a;
      } else fail(t("err.payer"), by);
      people.forEach(function (p) {
        var row = rowIn[p.id], val;
        if (mode === "eq") val = row.chk.checked ? 1 : 0;
        else if (mode === "sh") val = parseShares(row.inp.value);
        else val = parsePart(row.inp.value);
        if (val === null) fail(t("err.value", { p: p.n }), row.inp);
        else if (val) { r.w[p.id] = val; r.wsum += val; }
      });
      if (!r.wsum) fail(t("err.nobody"), null);
      else if (mode === "ex" && r.a && r.wsum !== r.a) fail(t("err.sum"), null);
      else if (mode === "pc" && r.wsum !== PCT_FULL) fail(t("err.pct"), null);
      return r;
    }
    // Live: payer remainder, split remainder and each person's share.
    function preview() {
      var f = readForm();
      byBox.hidden = by.value !== "*";
      byLeft.hidden = by.value !== "*" || !f.a;
      if (!byLeft.hidden) {
        var bs = 0;
        people.forEach(function (p) { bs += parsePart(byIn[p.id].value) || 0; });
        byLeft.textContent = bs === f.a ? t("e.ok") : bs < f.a ? t("e.byLeft", { a: money(f.a - bs) }) : t("e.byOver", { a: money(bs - f.a) });
        byLeft.className = "left " + (bs === f.a ? "good" : "bad");
      }
      var shares = null;
      if (f.a && f.w && f.wsum && !(mode === "ex" && f.wsum !== f.a) && !(mode === "pc" && f.wsum !== PCT_FULL)) {
        shares = sharesOf({ a: f.a, mode: mode, w: f.w });
      }
      people.forEach(function (p) {
        var r = rowIn[p.id];
        r.out.textContent = shares && shares[p.id] ? money(shares[p.id]) : "";
        r.row.classList.toggle("off", mode === "eq" ? !r.chk.checked : !(f.w && f.w[p.id]));
      });
      left.hidden = mode === "eq" || mode === "sh" || !f.a;
      if (!left.hidden) {
        var ws = 0;
        people.forEach(function (p) { ws += parsePart(rowIn[p.id].inp.value) || 0; });
        var full = mode === "pc" ? PCT_FULL : f.a;
        var fmt = mode === "pc" ? function (v) { return pctText(v, LANG); } : money;
        left.textContent = ws === full ? t("e.ok")
          : ws < full ? t(mode === "pc" ? "e.leftPct" : "e.left", { a: fmt(full - ws), p: fmt(full - ws) })
                      : t(mode === "pc" ? "e.overPct" : "e.over", { a: fmt(ws - full), p: fmt(ws - full) });
        left.className = "left " + (ws === full ? "good" : "bad");
      }
    }
    amt.addEventListener("input", preview);
    by.addEventListener("change", preview);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = readForm();
      if (f.err) { showErr(err, f.err, f.focus || null); return; }
      if (!parseYmd(date.value)) { showErr(err, t("err.date"), date); return; }
      var cur0 = x ? findIn(data.exp, x.id) : null;   // may have changed by a pull meanwhile
      var nid = x ? x.id : g.id + "." + newId();
      var next = normExp({ id: nid, m: 1, t: title.value, a: f.a, d: date.value, c: cat.value,
                           by: f.by, mode: mode, w: f.w, n: note.value });
      if (!next) { showErr(err, t("err.sum"), amt); return; }
      if (cur0) {
        var same = JSON.stringify(Object.assign({}, cur0, { m: 1 })) === JSON.stringify(next);
        if (!same) {
          next.m = stamp(cur0.m);
          data.exp = data.exp.filter(function (y) { return y.id !== nid; });
          data.exp.push(next);
          commit();
        }
      } else {
        if (x) untomb("exp", nid);
        next.m = stamp(x ? Math.max(x.m, data.tombs["exp:" + nid] || 0) : 0);
        data.exp.push(next);
        commit();
      }
      dlg.close();
      live(t("live.saved"));
      renderAll();
    });

    setMode(mode);
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!x) amt.focus();
  }

  // The shell's Budget bridge, when this orOS has it (older shell: null).
  function budgetBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenBudgetNew === "function" ? p.__orosOpenBudgetNew : null;
    } catch (e) { return null; }
  }

  function deleteExp(id) {
    var x = findIn(data.exp, id);
    if (!x) return;
    var copy = JSON.parse(JSON.stringify(x));
    data.exp = data.exp.filter(function (y) { return y.id !== id; });
    tombstone("exp", id);
    commit();
    renderAll();
    undoToast(t("toast.deleted"), function () {
      untomb("exp", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["exp:" + id] || 0));
      if (!findIn(data.exp, id)) data.exp.push(copy);
      commit();
      renderAll();
    });
  }

  // "Paid" on a suggested payment: recorded at once, with Undo.
  function recordPayment(gid, f, to, a) {
    if (entriesCount(gid) >= MAX_EXP) { showToast(t("err.full", { n: MAX_EXP })); return; }
    var id = gid + "." + newId();
    data.pay.push({ id: id, m: stamp(0), f: f, to: to, a: a, d: today });
    commit();
    renderAll();
    undoToast(t("toast.paid"), function () { removePay(id, false); });
  }
  function removePay(id, withUndo) {
    var p = findIn(data.pay, id);
    if (!p) return;
    var copy = JSON.parse(JSON.stringify(p));
    data.pay = data.pay.filter(function (y) { return y.id !== id; });
    tombstone("pay", id);
    commit();
    renderAll();
    if (!withUndo) return;
    undoToast(t("toast.payDel"), function () {
      untomb("pay", id);
      copy.m = stamp(Math.max(copy.m, data.tombs["pay:" + id] || 0));
      if (!findIn(data.pay, id)) data.pay.push(copy);
      commit();
      renderAll();
    });
  }

  // New / edit payment.
  function payDialog(id) {
    var g = curGroup();
    if (!g) return;
    var p = id ? findIn(data.pay, id) : null;
    if (id && !p) return;
    if (!p && entriesCount(g.id) >= MAX_EXP) { showToast(t("err.full", { n: MAX_EXP })); return; }
    var people = sortedPeople(g.id);
    if (p) [p.f, p.to].forEach(function (k) { if (!findIn(people, k)) people.push({ id: k, n: t("unknown") }); });
    if (people.length < 2) return;
    var me = meOf(data, g.id);
    var dlg = makeDialog("sp-pay", t("p.new"));
    var form = el("form");
    var from = personSelect(people, p ? p.f : (me || people[0].id));
    var to = personSelect(people, p ? p.to : (people[0].id === from.value ? people[1].id : people[0].id));
    var amt = amountInput(p ? p.a : 0);
    amt.className = "amt-in";
    var date = el("input");
    date.type = "date";
    date.value = p ? p.d : today;
    var err = errLine();
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("p.from"), from, "sp-pf"));
    r1.appendChild(field(t("p.to"), to, "sp-pt"));
    form.appendChild(r1);
    form.appendChild(field(t("e.amount") + " (" + g.cur + ")", amt, "sp-pa"));
    form.appendChild(field(t("e.date"), date, "sp-pd"));
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (p) acts.appendChild(button(t("dlg.delete"), "danger", function () { dlg.close(); removePay(p.id, true); }));
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (from.value === to.value) { showErr(err, t("p.same"), to); return; }
      var a = parseAmount(amt.value);
      if (a === null) { showErr(err, t("err.amount"), amt); return; }
      if (!parseYmd(date.value)) { showErr(err, t("err.date"), date); return; }
      var cur0 = p ? findIn(data.pay, p.id) : null;
      if (cur0) {
        if (cur0.f !== from.value || cur0.to !== to.value || cur0.a !== a || cur0.d !== date.value) {
          cur0.f = from.value; cur0.to = to.value; cur0.a = a; cur0.d = date.value;
          cur0.m = stamp(cur0.m);
          commit();
        }
      } else {
        var nid = p ? p.id : g.id + "." + newId();
        if (p) untomb("pay", nid);
        data.pay.push({ id: nid, m: stamp(p ? Math.max(p.m, data.tombs["pay:" + nid] || 0) : 0),
                        f: from.value, to: to.value, a: a, d: date.value });
        commit();
      }
      dlg.close();
      live(t("live.saved"));
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!p) amt.focus();
  }

  // New / edit group: name, currency, colour, people, who is me.
  // Works on a draft; Save writes only what changed (R27).
  function groupDialog(gid) {
    var g = gid ? groupById(data, gid) : null;
    if (gid && !g) return;
    if (!g && data.groups.length >= MAX_GROUPS) { showToast(t("err.groups", { n: MAX_GROUPS })); return; }
    var draft = {
      people: g ? sortedPeople(g.id).map(function (p) { return { id: p.id, key: p.id, n: p.n }; }) : [],
      me: g ? meOf(data, g.id) : "",
      col: g ? g.col : (data.groups.length % 8)
    };
    var dlg = makeDialog("sp-grp", t(g ? "gd.edit" : "gd.new"));
    dlg.classList.add("wide");
    var form = el("form");
    var name = el("input");
    name.maxLength = NAME_LEN;
    name.autocomplete = "off";
    name.placeholder = t("gd.name.ph");
    name.value = g ? g.n : "";
    var cur = el("select");
    CURRENCIES.forEach(function (c) {
      var label = c;
      try {
        new Intl.NumberFormat(LOCALE, { style: "currency", currency: c }).formatToParts(0).forEach(function (p) {
          if (p.type === "currency" && p.value !== c) label = c + " (" + p.value + ")";
        });
      } catch (e) {}
      var o = el("option", "", label); o.value = c; cur.appendChild(o);
    });
    cur.value = g ? g.cur : ((data.groups[data.groups.length - 1] || {}).cur || "EUR");
    var cols = el("div", "cols");
    cols.setAttribute("role", "radiogroup");
    cols.setAttribute("aria-label", t("gd.col"));
    var colB = [];
    for (var c = 0; c < 8; c++) {
      (function (c) {
        var b = el("button", "col-btn");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", t("gd.col.n", { n: c + 1 }));
        b.appendChild(swatch(c));
        b.addEventListener("click", function () { draft.col = c; markCol(); });
        colB.push(b);
        cols.appendChild(b);
      })(c);
    }
    function markCol() { colB.forEach(function (b, i) { b.setAttribute("aria-checked", i === draft.col ? "true" : "false"); }); }
    markCol();

    var ul = el("ul", "people");
    var addIn = el("input");
    addIn.maxLength = PERSON_LEN;
    addIn.autocomplete = "off";
    addIn.placeholder = t("gd.add.ph");
    addIn.setAttribute("aria-label", t("gd.add.ph"));
    var addB = el("button", "txt-btn", t("gd.add"));
    addB.type = "button";
    var err = errLine();
    var used = {};
    if (g) {
      expOf(data, g.id).forEach(function (x) { Object.keys(x.by).concat(Object.keys(x.w)).forEach(function (k) { used[k] = 1; }); });
      payOf(data, g.id).forEach(function (x) { used[x.f] = 1; used[x.to] = 1; });
    }
    function drawPeople() {
      ul.innerHTML = "";
      draft.people.forEach(function (p, i) {
        var li = el("li");
        var inp = el("input");
        inp.value = p.n;
        inp.maxLength = PERSON_LEN;
        inp.autocomplete = "off";
        inp.setAttribute("aria-label", t("gd.name") + " " + (i + 1));
        inp.addEventListener("input", function () { p.n = inp.value; });
        var meB = el("button", "me-btn", t("gd.meOn"));
        meB.type = "button";
        meB.setAttribute("aria-pressed", draft.me === p.key ? "true" : "false");
        meB.setAttribute("aria-label", t("gd.me") + ": " + (p.n || "…"));
        meB.addEventListener("click", function () {
          draft.me = draft.me === p.key ? "" : p.key;
          drawPeople();
          var again = ul.children[i] && ul.children[i].querySelector(".me-btn");
          if (again) again.focus();
        });
        var del = el("button", "icon-btn");
        del.type = "button";
        del.innerHTML = UI.trash;
        del.setAttribute("aria-label", t("gd.del", { p: p.n || "…" }));
        if (used[p.id]) {
          del.disabled = true;
          del.title = t("gd.used", { p: p.n });
        }
        del.addEventListener("click", function () {
          draft.people.splice(i, 1);
          if (draft.me === p.key) draft.me = "";
          drawPeople();
        });
        li.appendChild(inp);
        li.appendChild(meB);
        li.appendChild(del);
        ul.appendChild(li);
      });
    }
    function addPerson() {
      var n = normText(addIn.value, PERSON_LEN);
      if (!n) { addIn.focus(); return; }
      if (draft.people.length >= MAX_PEOPLE) { showErr(err, t("err.people", { n: MAX_PEOPLE }), addIn); return; }
      draft.people.push({ id: "", key: "new" + newId(), n: n });
      addIn.value = "";
      err.hidden = true;
      drawPeople();
      addIn.focus();
    }
    addB.addEventListener("click", addPerson);
    addIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addPerson(); }
    });
    drawPeople();

    form.appendChild(field(t("gd.name"), name, "sp-gname"));
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("gd.cur"), cur, "sp-gcur"));
    form.appendChild(r1);
    if (g && expOf(data, g.id).length) form.appendChild(el("p", "hint tight", t("gd.cur.hint")));
    form.appendChild(el("span", "dlg-lbl", t("gd.col")));
    form.appendChild(cols);
    form.appendChild(el("span", "dlg-lbl", t("gd.people")));
    form.appendChild(el("p", "hint tight", t("gd.hint")));
    form.appendChild(ul);
    var addRow = el("div", "add-row");
    addRow.appendChild(addIn);
    addRow.appendChild(addB);
    form.appendChild(addRow);
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (normText(addIn.value, PERSON_LEN)) addPerson();   // a typed name not yet added counts
      var n = normText(name.value, NAME_LEN);
      if (!n) { showErr(err, t("err.gname"), name); return; }
      var seen = {};
      for (var i = 0; i < draft.people.length; i++) {
        var pn = normText(draft.people[i].n, PERSON_LEN);
        if (!pn) { showErr(err, t("err.pname"), ul.children[i] && ul.children[i].querySelector("input")); return; }
        if (seen[pn.toLowerCase()]) { showErr(err, t("err.dup"), ul.children[i] && ul.children[i].querySelector("input")); return; }
        seen[pn.toLowerCase()] = 1;
        draft.people[i].n = pn;
      }
      if (draft.people.length < 2) { showErr(err, t("err.two"), addIn); return; }
      var gidN = g ? g.id : newId();
      var cur0 = groupById(data, gidN);
      if (cur0) {
        if (cur0.n !== n || cur0.cur !== cur.value || cur0.col !== draft.col) {
          cur0.n = n; cur0.cur = cur.value; cur0.col = draft.col;
          cur0.m = stamp(cur0.m);
        }
      } else {
        untomb("grp", gidN);
        data.groups.push({ id: gidN, m: stamp(0), n: n, col: draft.col, cur: cur.value, arch: 0 });
      }
      // People: rename, add, remove (never one with entries).
      var keep = {}, meId = "";
      draft.people.forEach(function (p) {
        var pid = p.id;
        if (pid) {
          var s = findIn(data.people, pid);
          if (s && s.n !== p.n) { s.n = p.n; s.m = stamp(s.m); }
          else if (!s) { untomb("per", pid); data.people.push({ id: pid, m: stamp(0), n: p.n }); }
        } else {
          pid = gidN + "." + newId();
          while (findIn(data.people, pid)) pid = gidN + "." + newId();
          data.people.push({ id: pid, m: stamp(0), n: p.n });
        }
        keep[pid] = 1;
        if (draft.me === p.key) meId = pid;
      });
      peopleOf(data, gidN).forEach(function (p) {
        if (keep[p.id] || used[p.id]) return;
        data.people = data.people.filter(function (y) { return y.id !== p.id; });
        tombstone("per", p.id);
      });
      var m0 = findIn(data.mine, gidN);
      if (!m0 || m0.v !== meId) {
        if (m0) { m0.v = meId; m0.m = stamp(m0.m); }
        else if (meId) data.mine.push({ id: gidN, m: stamp(0), v: meId });
      }
      commit();
      dlg.close();
      if (!g) { prefs.tab = "exp"; openGroup(gidN); }
      else renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!g) name.focus();
  }

  function toggleArchive() {
    var g = curGroup();
    if (!g) return;
    g.arch = g.arch ? 0 : 1;
    g.m = stamp(g.m);
    commit();
    showToast(t(g.arch ? "toast.arch" : "toast.unarch"));
    if (g.arch) goHome(); else renderAll();
  }

  function deleteGroup() {
    var g = curGroup();
    if (!g) return;
    var gid = g.id;
    var snap = {
      g: JSON.parse(JSON.stringify(g)),
      people: JSON.parse(JSON.stringify(peopleOf(data, gid))),
      exp: JSON.parse(JSON.stringify(expOf(data, gid))),
      pay: JSON.parse(JSON.stringify(payOf(data, gid))),
      mine: JSON.parse(JSON.stringify(data.mine.filter(function (x) { return x.id === gid; })))
    };
    data.groups = data.groups.filter(function (x) { return x.id !== gid; });
    tombstone("grp", gid);
    commit();   // the merge drops its children
    goHome();
    undoToast(t("toast.gdel"), function () {
      untomb("grp", gid);
      snap.g.m = stamp(Math.max(snap.g.m, data.tombs["grp:" + gid] || 0));
      if (!groupById(data, gid)) data.groups.push(snap.g);
      ["people", "exp", "pay", "mine"].forEach(function (k) {
        snap[k].forEach(function (x) { if (!findIn(data[k], x.id)) data[k].push(x); });
      });
      commit();
      openGroup(gid);
    });
  }

  // ---------- 9. Export, share, import, backup ----------
  function dialogHost() {
    try { return window.orosDialog || window.parent.orosDialog || null; } catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, filename, mime, desc, ext, doneMsg) {
    var done = function () { showToast(doneMsg || t("exp.done")); };
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
  function slug(s) {
    var x = String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return x || "group";
  }

  // Mobile → share sheet; desktop → clipboard (the Contacts rule).
  function shareOnMobile() {
    if (!navigator.share) return false;
    if (/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent)) return false;
    if (navigator.maxTouchPoints === 0 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
    return true;
  }
  function legacyCopy(txt) {
    var ta = document.createElement("textarea"), ok = false;
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(txt) {
    var done = function () { showToast(t("toast.copied")); };
    var fail = function () { showToast(t("toast.copyFail")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { if (legacyCopy(txt)) done(); else fail(); });
      return;
    }
    if (legacyCopy(txt)) done(); else fail();
  }
  // The summary: shown in a dialog (read it, copy it), and on a phone
  // straight to the share sheet.
  function shareSummary() {
    var g = curGroup();
    if (!g) return;
    var txt = summaryText(data, g.id, t, whoName, money);
    if (shareOnMobile()) {
      navigator.share({ title: g.n, text: txt }).catch(function () {});
      return;
    }
    var dlg = makeDialog("sp-sum", t("sh.title"));
    var ta = el("textarea", "sum-text");
    ta.readOnly = true;
    ta.value = txt;
    ta.rows = Math.min(16, txt.split("\n").length + 1);
    ta.setAttribute("aria-label", t("sh.title"));
    dlg.appendChild(ta);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("dlg.copy"), "primary", function () { copyText(txt); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // The group file: on a phone the share sheet (if it takes files),
  // otherwise a save dialog.
  function sendGroupFile() {
    var g = curGroup();
    if (!g) return;
    var payload = packGroup(data, g.id);
    payload.exported = new Date().toISOString();
    var text = JSON.stringify(payload);
    var name = "oros-split-" + slug(g.n) + ".json";
    var blob = new Blob([text], { type: "application/json" });
    if (shareOnMobile() && navigator.canShare && typeof File === "function") {
      try {
        var file = new File([text], name, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: g.n }).catch(function () {});
          return;
        }
      } catch (e) {}
    }
    saveBlob(blob, name, "application/json", "JSON", ".json", t("file.done"));
  }

  // Import: a group file joins that group (merge); a backup merges all.
  function importFile() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(".json,application/json") : localPick(".json,application/json");
    pick.then(function (file) {
      if (!file) return;
      if (file.size > MAX_FILE) { showToast(t("im.big")); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result)); } catch (e) {}
        if (obj && obj.app === BACKUP_APP && obj.data && Array.isArray(obj.data.groups)) { mergeBackup(obj.data); return; }
        var pk = unpackGroup(obj);
        if (!pk) { showToast(t("im.bad")); return; }
        joinGroup(pk);
      };
      fr.readAsText(file);
    });
  }
  function joinGroup(pk) {
    var gid = pk.gid, incoming = pk.data.groups[0];
    var before = mergeSplit(data, data);
    var isNew = !groupById(before, gid);
    if (isNew && before.groups.length >= MAX_GROUPS) { showToast(t("err.groups", { n: MAX_GROUPS })); return; }
    // You chose to import it: a group you deleted earlier comes back.
    if (("grp:" + gid) in before.tombs && !groupById(before, gid)) {
      incoming.m = stamp(Math.max(incoming.m, before.tombs["grp:" + gid]));
    }
    var merged = mergeSplit(before, pk.data);
    var n = changedCount(before, merged);
    var g = groupById(merged, gid);
    if (!n) { showToast(t("im.same", { g: g ? g.n : "" })); openGroup(gid); return; }
    data = merged;
    commit();
    showToast(t("im.group", { g: g.n, n: n }));
    openGroup(gid);
    if (!meOf(data, gid)) setTimeout(function () { groupDialog(gid); showToast(t("toast.whoami")); }, 60);
  }
  function mergeBackup(src) {
    var before = mergeSplit(data, data);
    var merged = mergeSplit(before, src);
    var n = changedCount(before, merged);
    if (!n) { showToast(t("im.bsame")); return; }
    data = merged;
    commit();
    renderAll();
    showToast(t("im.backup", { n: n }));
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
  function backup() {
    var payload = { app: BACKUP_APP, ver: DATA_VER, exported: new Date().toISOString(), data: mergeSplit(data, data) };
    saveBlob(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }),
             "oros-split-backup-" + today + ".json", "application/json", "JSON", ".json");
  }

  // Export: CSV of the group (one share column per person) or a PDF.
  function exportDialog() {
    var g = curGroup();
    if (!g) return;
    var dlg = makeDialog("sp-expo", t("exp.title"));
    var fmt = el("select");
    [["excel", t("exp.csv.excel")], ["std", t("exp.csv.std")]].forEach(function (f) {
      var o = el("option", "", f[1]); o.value = f[0]; fmt.appendChild(o);
    });
    fmt.value = prefs.csv;
    fmt.addEventListener("change", function () { prefs.csv = fmt.value; savePrefs(); });
    dlg.appendChild(field(t("exp.csvfmt"), fmt, "sp-exp-fmt"));
    var acts = el("div", "dlg-actions exp-acts");
    var go = function (kind) {
      return function () {
        if (!entriesCount(g.id)) { showToast(t("exp.empty")); return; }
        if (kind === "csv") exportCsv(g); else exportPdf(g);
        dlg.close();
      };
    };
    acts.appendChild(button(t("exp.csv"), "", go("csv")));
    acts.appendChild(button(t("exp.pdf"), "primary", go("pdf")));
    dlg.appendChild(acts);
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(close);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function exportCsv(g) {
    var people = sortedPeople(g.id);
    var head = [t("col.date"), t("col.type"), t("col.title"), t("col.cat"), t("col.amount"), t("col.cur"), t("col.by")]
      .concat(people.map(function (p) { return t("col.share", { p: p.n }); })).concat([t("col.note")]);
    var rows = entriesOf(g.id).reverse().map(function (en) {
      var x = en.x;
      if (en.kind === "p") {
        return [x.d, t("k.pay"), personName(x.f) + " → " + personName(x.to), "", x.a, g.cur, personName(x.f)]
          .concat(people.map(function () { return ""; })).concat([""]);
      }
      var sh = sharesOf(x);
      return [x.d, t("k.exp"), x.t, catName(x.c), x.a, g.cur,
              Object.keys(x.by).map(function (k) { return personName(k) + (Object.keys(x.by).length > 1 ? " " + centsToInput(x.by[k], LANG) : ""); }).join(", ")]
        .concat(people.map(function (p) { return sh[p.id] ? sh[p.id] : ""; })).concat([x.n]);
    });
    var text = buildCsv(head, rows, prefs.csv);
    saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), "oros-split-" + slug(g.n) + ".csv",
             "text/csv;charset=utf-8", "CSV", ".csv");
  }

  // Vendored libraries (never a CDN), loaded on first use.
  var libState = {};
  function loadLib(file, done) {
    if (window.jspdf && window.jspdf.jsPDF) { done(); return; }
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
      showToast(t("exp.lib", { f: file }));
    };
    document.head.appendChild(s);
  }
  function loadPdfFont(done) {
    if (window.__splitPdfFont) { done(); return; }
    fetch("../vendor/NotoSans-Regular.ttf" + (SCRIPT_V ? "?v=" + SCRIPT_V : ""))
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(String(fr.result).split(",")[1]); };
          fr.readAsDataURL(b);
        });
      })
      .then(function (b64) { window.__splitPdfFont = b64; done(); })
      .catch(function () { showToast(t("exp.font")); done(); });
  }
  function exportPdf(g) {
    loadLib("jspdf.umd.min.js", function () { loadPdfFont(function () { buildPdf(g); }); });
  }
  function buildPdf(g) {
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    var FONT = "helvetica";
    if (window.__splitPdfFont) {
      doc.addFileToVFS("NotoSans-Regular.ttf", window.__splitPdfFont);
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
    var head = function (s) {
      need(40);
      doc.setFontSize(12);
      txt(s, M, y); y += 8;
      doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 14;
    };
    doc.setFontSize(18);
    txt(g.n, M, y); y += 22;
    doc.setFontSize(11);
    txt(t("pdf.title") + " · " + t("sh.total", { a: money(groupTotal(data, g.id)) }), M, y); y += 14;
    doc.setFontSize(9);
    doc.setTextColor(110);
    txt(t("pdf.gen", { d: dateShort(today) }), M, y); y += 24;
    doc.setTextColor(0);
    var rows = balancesOf(data, g.id);
    head(t("bal.title"));
    doc.setFontSize(10);
    Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (a, b) { return b.bal - a.bal || personName(a.id).localeCompare(personName(b.id)); })
      .forEach(function (r) {
        need(16);
        txt(personName(r.id), M, y);
        txt(t("bal.paid", { a: money(r.paid) }), M + 170, y);
        txt(t("bal.share", { a: money(r.share) }), M + 300, y);
        txt((r.bal > 0 ? "+" : r.bal < 0 ? "−" : "") + money(Math.abs(r.bal)), W - M, y, { align: "right" });
        y += 15;
      });
    y += 10;
    head(t("bal.settle"));
    doc.setFontSize(10);
    var pays = settleUp(rows);
    if (!pays.length) { txt(t("sh.even"), M, y); y += 15; }
    pays.forEach(function (p) {
      need(16);
      txt(personName(p.f) + " → " + personName(p.to), M, y);
      txt(money(p.a), W - M, y, { align: "right" });
      y += 15;
    });
    y += 10;
    head(t("pdf.list"));
    doc.setFontSize(9);
    entriesOf(g.id).reverse().forEach(function (en) {
      var x = en.x;
      var what = en.kind === "p" ? personName(x.f) + " → " + personName(x.to) + " (" + t("k.pay") + ")"
                                 : (x.t || catName(x.c)) + " · " + t("row.paid", { p: Object.keys(x.by).map(personName).join(", ") });
      var lines = doc.splitTextToSize(what.normalize("NFC"), W - 2 * M - 150);
      var h = lines.length * 12 + 3;
      need(h);
      txt(dateShort(x.d), M, y);
      lines.forEach(function (ln, i) { txt(ln, M + 70, y + i * 12); });
      txt(money(x.a), W - M, y, { align: "right" });
      y += h;
    });
    foot();
    saveBlob(doc.output("blob"), "oros-split-" + slug(g.n) + ".pdf", "application/pdf", "PDF", ".pdf");
  }

  // ---------- 10. Toasts, menu, keyboard ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "split", title: String(text) })) return;
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

  // Menu: built for the screen it is on; per-instance listeners.
  function menuItems() {
    var g = curGroup();
    if (!g) return [["import", "menu.import", importFile], ["backup", "menu.backup", backup], ["restore", "menu.restore", importFile]];
    return [["edit", "menu.edit", function () { groupDialog(g.id); }],
            ["share", "menu.share", shareSummary],
            ["file", "menu.file", sendGroupFile],
            ["export", "menu.export", exportDialog],
            ["arch", g.arch ? "menu.unarch" : "menu.arch", toggleArchive],
            ["del", "menu.del", deleteGroup]];
  }
  function openMenu() {
    var menu = $("menu"), btn = $("menu-btn");
    if (!menu.hidden) { closeMenu(); return; }
    menu.innerHTML = "";
    menuItems().forEach(function (it) {
      var b = el("button", it[0] === "del" ? "danger" : "", t(it[1]));
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { closeMenu(); it[2](); });
      menu.appendChild(b);
    });
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
      var k = e.key;
      if (k === "n" || k === "N" || k === "ν" || k === "Ν") { e.preventDefault(); addClick(); }
      else if (curGroup() && (k === "b" || k === "B" || k === "β" || k === "Β")) { e.preventDefault(); setTab(prefs.tab === "bal" ? "exp" : "bal"); }
    });
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var next = prefs.tab === "exp" ? "bal" : "exp";
      e.preventDefault();
      e.stopPropagation();
      setTab(next);
      $("tab-" + next).focus();
    });
  }

  function addClick() {
    var g = curGroup();
    if (!g) { groupDialog(null); return; }
    if (peopleOf(data, g.id).length < 1) { groupDialog(g.id); return; }
    expDialog(null);
  }
  function openGroup(gid) {
    prefs.g = gid;
    savePrefs();
    query = "";
    filter = "all";
    $("q").value = "";
    renderAll();
    $("main").scrollTop = 0;
    var g = curGroup();
    if (g) live(t("live.group", { g: g.n }));
  }
  function goHome() {
    prefs.g = "";
    savePrefs();
    renderAll();
    $("main").scrollTop = 0;
    live(t("live.home"));
  }
  function setTab(tab) {
    prefs.tab = tab;
    savePrefs();
    renderAll();
  }

  // ---------- 11. Sync slice + palette ----------
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
    api.registerSlice("split", sliceGet, sliceSet, STORAGE_KEY, mergeSplit);
  }

  function sliceGet() { return mergeSplit(data, data); }   // canonical copy (R26)

  // A pull: adopt, persist without dirty (R6), redraw the page but
  // never an open dialog (what you are typing stays, SS-4 lesson).
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.groups)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;
    try {
      data = mergeSplit(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    renderAll();
  }

  // ---------- 12. Wiring & boot ----------
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
    ib("back-btn", UI.left, "btn.back");
    ib("menu-btn", UI.more, "btn.menu");
    $("q").placeholder = t("q.ph");
    $("q").setAttribute("aria-label", t("q.ph"));
    $("flt").setAttribute("aria-label", t("flt.all"));
  }

  function wire() {
    $("back-btn").addEventListener("click", goHome);
    $("add-btn").addEventListener("click", addClick);
    $("menu-btn").addEventListener("click", openMenu);
    $("t-who").addEventListener("click", function () { var g = curGroup(); if (g) { groupDialog(g.id); showToast(t("toast.whoami")); } });
    ["exp", "bal"].forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    var qt = null;
    $("q").addEventListener("input", function () {
      clearTimeout(qt);
      qt = setTimeout(function () { query = $("q").value.trim().toLowerCase(); var g = curGroup(); if (g) renderList(g); }, 150);
    });
    $("flt").addEventListener("change", function () { filter = $("flt").value; var g = curGroup(); if (g) renderList(g); });
    var tick = function () {
      var now = ymdLocal(new Date());
      if (now === today) return;
      today = now;
      renderAll();
    };
    setInterval(tick, 60000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") tick(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
  }

  boot();
})();
