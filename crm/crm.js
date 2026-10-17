// ============================================================
// orOS CRM — App logic (v1.4.0)
// A small customer book for a freelancer or a small business:
//   - customers (company or person) with ΑΦΜ / ΔΟΥ / profession,
//     status lead / active / past, tags, a star, notes
//   - people linked from Contacts (read-only, shown live) or kept
//     here by name; open in Contacts, add to Contacts (prefill)
//   - history of contact (call, email, meeting, message, note)
//   - follow-ups with an agenda (late / today / next 7 days),
//     reminders through the shell inbox (shell crmCheckTick, also
//     with the app closed), rows in Today and in the Calendar,
//     "Send to To-Do" (BR-TD-ADD)
//   - a pipeline of deals: value, stage, probability, won / lost;
//     own stages (rename, reorder, add, hide) in Settings
//   - a dashboard; CSV export, JSON backup / restore (merge)
//   - a contact form for the user's website (crm/webform.js): the
//     messages arrive through the orOS relay as leads
// Data:
//   - synced slice "crm" (oros-crm-data): every list LWW per id +
//     tombstones; merge = OrosCrmCore.merge (R5, R17, R26)
//   - device-local (R10): oros-crm-prefs (tab, open customer,
//     filters, sort, sub-tab, pipeline stage on phones); the shell
//     keeps oros-crm-notified (follow-ups already announced);
//     oros-crm-wf { dev, last } (crm/webform.js)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Mutations (Undo on every delete)
//   4. Other apps: Contacts, Mail, Maps, To-Do
//   5. Customers list
//   6. Customer page
//   7. Pipeline
//   8. Agenda
//   9. Dashboard
//  10. Editors: customer, person, deal, contact log, follow-up
//  11. Settings, tags, export / import
//  12. Dialogs + toasts
//  13. Keyboard (Contract Β) + deep link (+ Today's "Done")
//  14. Sync slice + palette
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosCrmCore;
  var STORAGE_KEY  = "oros-crm-data";
  var PREFS_KEY    = "oros-crm-prefs";
  var CONTACTS_KEY = "oros-contacts-data";
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var DAY_MS = 86400000;
  var LIST_CAP = 200;

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
      "app": "CRM",
      "tab.cust": "Customers", "tab.pipe": "Pipeline", "tab.agenda": "Agenda", "tab.dash": "Dashboard",
      "btn.add": "Add", "btn.settings": "Settings", "btn.back": "Customers",
      "add.cust": "New customer", "add.deal": "New deal", "add.fup": "New follow-up", "add.log": "Log a contact",
      "q.ph": "Search customers…",
      "sort.name": "Name", "sort.last": "Last contact", "sort.next": "Next follow-up", "sort.value": "Open value",
      "f.all": "All", "f.lead": "Leads", "f.active": "Active", "f.past": "Past", "f.star": "Starred", "f.forgot": "Not contacted",
      "st.lead": "Lead", "st.active": "Active", "st.past": "Past",
      "kind.co": "Company", "kind.person": "Person",
      "empty.first": "Keep your customers, what you said to them, what you promised and the deals you are working on, all in one place.",
      "empty.first.btn": "Add your first customer",
      "empty.list": "No customer matches.",
      "empty.pick": "Pick a customer from the list.",
      "more": "{n} more: refine the search to see them.",
      "last.never": "no contact yet", "last.today": "contacted today", "last.yday": "contacted yesterday",
      "last.days": "contacted {n} days ago", "last.date": "contacted {d}",
      "next": "next: {d}",
      "act.call": "Call", "act.mail": "Email", "act.map": "Map", "act.log": "Log contact", "act.fup": "Follow-up", "act.deal": "Deal",
      "k.call": "Call", "k.mail": "Email", "k.meet": "Meeting", "k.msg": "Message", "k.note": "Note",
      "sec.info": "Details", "sec.people": "People", "sec.notes": "Notes",
      "fact.afm": "VAT ID", "fact.doy": "Tax office", "fact.job": "Profession", "fact.addr": "Address", "fact.country": "Country",
      "fact.phone": "Phone", "fact.email": "Email", "fact.web": "Website", "fact.src": "Source", "fact.tags": "Tags", "fact.since": "Customer since",
      "afm.ok": "valid", "afm.bad": "check digit does not match",
      "people.add": "+ Person", "people.none": "No people yet. Link someone from Contacts or add a name.",
      "people.open": "Open in Contacts", "people.gone": "removed from Contacts",
      "sub.hist": "History", "sub.deals": "Deals", "sub.fups": "Follow-ups", "sub.docs": "Documents",
      "act.inv": "Invoice", "act.quote": "Quote",
      "docs.inv": "Invoices", "docs.quote": "Quotes", "docs.allInv": "All in Invoices",
      "docs.invNone": "No invoices yet. Invoices you issue with the Invoice button show up here.",
      "docs.quoteNone": "No quotes yet. Quotes for a client with this name or VAT ID show up here.",
      "docs.tot": "Invoiced {i} · paid {p}", "docs.open": "unpaid {v}", "docs.overdue": "overdue {v}",
      "ik.inv": "Invoice", "ik.rcpt": "Receipt", "ik.pro": "Proforma", "ik.cred": "Credit note", "ik.ext": "Recorded invoice",
      "is.void": "Cancelled", "is.pro": "Proforma", "is.credit": "Credit note", "is.paid": "Paid",
      "is.partial": "Partly paid", "is.overdue": "Overdue", "is.unpaid": "Unpaid",
      "qs.draft": "Draft", "qs.sent": "Sent", "qs.accepted": "Accepted", "qs.rejected": "Rejected", "qs.expired": "Expired",
      "deal.inv": "Invoice this deal", "deal.quote": "Quote for this deal",
      "toast.noInv": "The Invoices app is not available.", "toast.noQuote": "The Quote app is not available.",
      "toast.quoteCur": "Quote works in EUR or USD. Change the currency in CRM settings, or create the quote in Quote.",
      "set.import": "Import customers (CSV)",
      "en.all": "Update customers from online sources", "en.one": "Update online",
      "en.empty": "No customer has an e-mail address, phone or website to look up.",
      "en.done": "{n} customer(s) updated", "en.link": "Link",
      "imp.title": "Import customers", "imp.new": "New customers: {n}", "imp.dup": "Already in CRM (skipped): {n}",
      "imp.noName": "Rows without a name (skipped): {n}", "imp.over": "Over the limit of {max} customers (skipped): {n}",
      "imp.tags": "New tags: {n}", "imp.more": "and {n} more", "imp.go": "Import {n}", "imp.none": "There is nothing new to import.",
      "imp.bad": "No name column found. The first row must hold column names such as Name, Company or First name.",
      "imp.done": "Imported {n} customers",
      "mail.subj": "Subject: {s}", "mail.noCust": "No customer has {email}. Add one, then log the email.",
      "hist.none": "Nothing logged yet.", "deals.none": "No deals yet.", "fups.none": "No follow-ups.",
      "fups.done": "Done", "hist.add": "+ Log", "deals.add": "+ Deal", "fups.add": "+ Follow-up",
      "stage.new": "New", "stage.contact": "Contacted", "stage.proposal": "Proposal", "stage.nego": "Negotiation",
      "stage.won": "Won", "stage.lost": "Lost",
      "pipe.open": "Open deals: {n}", "pipe.val": "Value {v}", "pipe.w": "Weighted {v}", "pipe.wonM": "Won this month {v}",
      "pipe.empty": "No deals yet. A deal is something you hope to sell: a project, an order, a contract.",
      "pipe.move": "Move to stage", "pipe.older": "{n} older",
      "pipe.prob": "{p}% chance",
      "ag.late": "Late", "ag.today": "Today", "ag.soon": "Next 7 days",
      "ag.empty": "Nothing to follow up. Add a follow-up from a customer's page, or with Add.",
      "ag.done": "Mark done", "ag.snooze1": "Tomorrow", "ag.snooze7": "In a week", "ag.edit": "Edit", "ag.todo": "Send to To-Do",
      "ag.delete": "Delete",
      "due.today": "today", "due.tomorrow": "tomorrow", "due.yday": "yesterday", "due.in": "in {n} days", "due.late": "{n} days late",
      "d.open": "Open pipeline", "d.openSub": "Deals: {n} · weighted {w}", "d.wonM": "Won this month", "d.wonY": "Won this year",
      "d.rate": "Win rate", "d.rateSub": "this year", "d.rateNone": "–", "d.late": "Late follow-ups", "d.today": "Due today",
      "d.forgot": "Not contacted", "d.forgotSub": "{n}+ days", "d.leads": "New leads", "d.leadsSub": "this month",
      "d.byStage": "Open deals by stage", "d.byStatus": "Customers", "d.forgotList": "Time to get in touch",
      "d.none": "Add customers and deals to see numbers here.",
      "d.unpaid": "Unpaid invoices", "d.unpaidSub": "overdue {v}", "d.unpaidNone": "nothing overdue",
      "ed.save": "Save", "ed.cancel": "Cancel", "ed.delete": "Delete", "ed.close": "Close",
      "ed.custNew": "New customer", "ed.custEdit": "Edit customer", "ed.kind": "Type", "ed.name": "Name",
      "ed.namePh.co": "Company name", "ed.namePh.person": "Full name", "ed.alias": "Trade name", "ed.status": "Status",
      "ed.star": "Starred", "ed.tags": "Tags", "ed.tagsManage": "Manage tags", "ed.afm": "VAT ID (ΑΦΜ)", "ed.doy": "Tax office (ΔΟΥ)",
      "ed.job": "Profession", "ed.addr": "Address", "ed.country": "Country", "ed.phone": "Phone", "ed.email": "Email",
      "ed.web": "Website", "ed.src": "Source", "ed.srcPh": "Referral, website, fair…", "ed.notes": "Notes",
      "ed.billing": "Billing details", "ed.contact": "Contact details",
      "ed.dupAfm": "Another customer has this VAT ID: {name}.", "ed.dupName": "Another customer has this name.",
      "ed.nameReq": "Give a name first.", "ed.asNewWho": "Contact person: {name}",
      "ed.personNew": "Add a person", "ed.personEdit": "Person", "ed.fromContacts": "From Contacts", "ed.byName": "Or by name",
      "ed.role": "Role", "ed.rolePh": "Accounts, decides, …", "ed.toContacts": "Add to Contacts",
      "ed.toContactsHint": "Opens Contacts with this person filled in; it is saved there only when you press Save.",
      "ed.pickContact": "Pick a contact", "ed.searchContacts": "Search contacts…", "ed.noContacts": "No contacts found.",
      "ed.linked": "Linked to Contacts: {name}", "ed.unlink": "Unlink",
      "ed.dealNew": "New deal", "ed.dealEdit": "Deal", "ed.cust": "Customer", "ed.title": "Title", "ed.titlePh": "Website redesign, 50 chairs…",
      "ed.value": "Value ({c})", "ed.stage": "Stage", "ed.prob": "Chance (%)", "ed.probPh": "{p} (stage default)",
      "ed.closeDay": "Expected close", "ed.why": "Why it was lost", "ed.titleReq": "Give the deal a title.",
      "ed.valBad": "That amount is not a number.",
      "ed.logNew": "Log a contact", "ed.logEdit": "Contact", "ed.when": "When", "ed.date": "Date", "ed.time": "Time",
      "ed.who": "With", "ed.whoNone": "—", "ed.deal": "Deal", "ed.dealNone": "No deal", "ed.text": "What was said",
      "ed.next": "Next follow-up", "ed.nextNone": "None", "ed.next3": "In 3 days", "ed.next7": "In a week", "ed.next14": "In 2 weeks",
      "ed.nextText": "Follow up",
      "ed.fupNew": "New follow-up", "ed.fupEdit": "Follow-up", "ed.fupText": "What to do", "ed.fupPh": "Call back about the offer…",
      "ed.fupDone": "Done", "ed.textReq": "Write what to do.", "ed.timeOpt": "Time (optional)",
      "ed.needCust": "Add a customer first.",
      "set.title": "Settings", "set.cur": "Currency", "set.forget": "\"Not contacted\" after", "set.days": "{n} days",
      "set.stages": "Pipeline stages",
      "stg.title": "Pipeline stages", "stg.hint": "Rename, reorder, add your own or hide the ones you do not use. The number is the default chance. Won and Lost stay as they are.",
      "stg.name": "Stage name", "stg.prob": "Default chance (%)", "stg.up": "Move up", "stg.down": "Move down",
      "stg.hide": "Hide", "stg.del": "Delete", "stg.show": "Show {name}", "stg.hiddenHead": "Hidden",
      "stg.newPh": "New stage", "stg.add": "Add", "stg.max": "Up to {n} open stages.",
      "stg.notEmpty": "{name} still has deals ({n}). Move them to another stage first.", "stg.last": "One open stage is needed.",
      "stg.hidden": "{name} hidden", "stg.deleted": "{name} deleted",
      "set.tags": "Tags", "set.export": "Export customers (CSV)", "set.sheet": "Open in Spreadsheet",
      "set.sheetCap": "Only the first {n} customers fit in one sheet", "set.backup": "Backup (JSON)", "set.restore": "Restore a backup",
      "set.osave": "orOS file (.oroscrm)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "set.restoreHint": "A backup is merged into what you have: nothing here is deleted or overwritten by older copies.",
      "set.usage": "This app uses {kb} KB of the browser storage that all orOS apps share.",
      "tags.title": "Tags", "tags.new": "New tag", "tags.none": "No tags yet.", "tags.namePh": "Tag name",
      "tags.add": "Add", "tags.del": "Delete tag \"{name}\"? It is removed from every customer.",
      "toast.saved": "Saved", "toast.deleted": "Deleted", "toast.custDel": "{name} deleted", "toast.undo": "Undo",
      "toast.done": "Done: {text}", "toast.logIt": "Log it", "toast.moved": "Moved to {stage}",
      "toast.snoozed": "Moved to {d}", "toast.logged": "Logged", "toast.full": "The browser storage is full: this change was NOT saved.",
      "toast.restored": "Backup merged", "toast.badFile": "This is not a CRM backup.", "toast.exported": "Saved {name}",
      "toast.todo": "Sent to To-Do", "toast.gone": "This was deleted.",
      "confirm.cust": "Delete {name}? Its deals, history and follow-ups go with it.",
      "aria.star": "Star", "aria.edit": "Edit", "aria.more": "More", "aria.remove": "Remove",
      "unknown": "Unknown customer",
      "toast.already": "This follow-up is already done."
    },
    el: {
      "app": "Πελάτες",
      "tab.cust": "Πελάτες", "tab.pipe": "Pipeline", "tab.agenda": "Ατζέντα", "tab.dash": "Πίνακας",
      "btn.add": "Νέο", "btn.settings": "Ρυθμίσεις", "btn.back": "Πελάτες",
      "add.cust": "Νέος πελάτης", "add.deal": "Νέα ευκαιρία", "add.fup": "Νέο follow-up", "add.log": "Καταγραφή επικοινωνίας",
      "q.ph": "Αναζήτηση πελατών…",
      "sort.name": "Όνομα", "sort.last": "Τελευταία επαφή", "sort.next": "Επόμενο follow-up", "sort.value": "Ανοιχτή αξία",
      "f.all": "Όλοι", "f.lead": "Υποψήφιοι", "f.active": "Ενεργοί", "f.past": "Παλιοί", "f.star": "Με αστέρι", "f.forgot": "Χωρίς επαφή",
      "st.lead": "Υποψήφιος", "st.active": "Ενεργός", "st.past": "Παλιός",
      "kind.co": "Εταιρεία", "kind.person": "Ιδιώτης",
      "empty.first": "Οι πελάτες σου, τι τους είπες, τι τους υποσχέθηκες και οι δουλειές που κυνηγάς, όλα σε ένα μέρος.",
      "empty.first.btn": "Πρόσθεσε τον πρώτο πελάτη",
      "empty.list": "Κανένας πελάτης δεν ταιριάζει.",
      "empty.pick": "Διάλεξε έναν πελάτη από τη λίστα.",
      "more": "Άλλοι {n}: γράψε κάτι πιο συγκεκριμένο για να τους δεις.",
      "last.never": "καμία επαφή ακόμη", "last.today": "επαφή σήμερα", "last.yday": "επαφή χθες",
      "last.days": "επαφή πριν από {n} μέρες", "last.date": "επαφή {d}",
      "next": "επόμενο: {d}",
      "act.call": "Κλήση", "act.mail": "Email", "act.map": "Χάρτης", "act.log": "Καταγραφή", "act.fup": "Follow-up", "act.deal": "Ευκαιρία",
      "k.call": "Κλήση", "k.mail": "Email", "k.meet": "Συνάντηση", "k.msg": "Μήνυμα", "k.note": "Σημείωση",
      "sec.info": "Στοιχεία", "sec.people": "Άνθρωποι", "sec.notes": "Σημειώσεις",
      "fact.afm": "ΑΦΜ", "fact.doy": "ΔΟΥ", "fact.job": "Επάγγελμα", "fact.addr": "Διεύθυνση", "fact.country": "Χώρα",
      "fact.phone": "Τηλέφωνο", "fact.email": "Email", "fact.web": "Ιστότοπος", "fact.src": "Πηγή", "fact.tags": "Ετικέτες", "fact.since": "Πελάτης από",
      "afm.ok": "έγκυρο", "afm.bad": "το ψηφίο ελέγχου δεν ταιριάζει",
      "people.add": "+ Άνθρωπος", "people.none": "Κανένας ακόμη. Σύνδεσε κάποιον από τις Επαφές ή γράψε ένα όνομα.",
      "people.open": "Άνοιγμα στις Επαφές", "people.gone": "δεν υπάρχει πια στις Επαφές",
      "sub.hist": "Ιστορικό", "sub.deals": "Ευκαιρίες", "sub.fups": "Follow-ups", "sub.docs": "Έγγραφα",
      "act.inv": "Τιμολόγιο", "act.quote": "Προσφορά",
      "docs.inv": "Τιμολόγια", "docs.quote": "Προσφορές", "docs.allInv": "Όλα στα Τιμολόγια",
      "docs.invNone": "Δεν υπάρχουν τιμολόγια ακόμη. Όσα εκδίδεις με το κουμπί Τιμολόγιο εμφανίζονται εδώ.",
      "docs.quoteNone": "Δεν υπάρχουν προσφορές ακόμη. Εδώ εμφανίζονται οι προσφορές σε πελάτη με αυτό το όνομα ή ΑΦΜ.",
      "docs.tot": "Τιμολογήθηκαν {i} · εισπράχθηκαν {p}", "docs.open": "ανεξόφλητα {v}", "docs.overdue": "ληξιπρόθεσμα {v}",
      "ik.inv": "Τιμολόγιο", "ik.rcpt": "Απόδειξη", "ik.pro": "Προτιμολόγιο", "ik.cred": "Πιστωτικό", "ik.ext": "Καταχωρισμένο τιμολόγιο",
      "is.void": "Ακυρωμένο", "is.pro": "Προτιμολόγιο", "is.credit": "Πιστωτικό", "is.paid": "Εξοφλημένο",
      "is.partial": "Μερικώς εξοφλημένο", "is.overdue": "Ληξιπρόθεσμο", "is.unpaid": "Ανεξόφλητο",
      "qs.draft": "Πρόχειρη", "qs.sent": "Απεστάλη", "qs.accepted": "Αποδεκτή", "qs.rejected": "Απορρίφθηκε", "qs.expired": "Έληξε",
      "deal.inv": "Τιμολόγηση της ευκαιρίας", "deal.quote": "Προσφορά για την ευκαιρία",
      "toast.noInv": "Η εφαρμογή Τιμολόγια δεν είναι διαθέσιμη.", "toast.noQuote": "Η εφαρμογή Προσφορές δεν είναι διαθέσιμη.",
      "toast.quoteCur": "Οι Προσφορές δουλεύουν σε EUR ή USD. Άλλαξε το νόμισμα στις ρυθμίσεις του CRM ή φτιάξε την προσφορά στις Προσφορές.",
      "set.import": "Εισαγωγή πελατών (CSV)",
      "en.all": "Ενημέρωση πελατών από online πηγές", "en.one": "Ενημέρωση online",
      "en.empty": "Κανένας πελάτης δεν έχει email, τηλέφωνο ή ιστοσελίδα για αναζήτηση.",
      "en.done": "Ενημερώθηκαν {n} πελάτες", "en.link": "Σύνδεσμος",
      "imp.title": "Εισαγωγή πελατών", "imp.new": "Νέοι πελάτες: {n}", "imp.dup": "Υπάρχουν ήδη (παραλείπονται): {n}",
      "imp.noName": "Γραμμές χωρίς όνομα (παραλείπονται): {n}", "imp.over": "Πάνω από το όριο των {max} πελατών (παραλείπονται): {n}",
      "imp.tags": "Νέες ετικέτες: {n}", "imp.more": "και άλλοι {n}", "imp.go": "Εισαγωγή {n}", "imp.none": "Δεν υπάρχει κάτι νέο για εισαγωγή.",
      "imp.bad": "Δεν βρέθηκε στήλη ονόματος. Η πρώτη γραμμή πρέπει να έχει ονόματα στηλών, όπως Επωνυμία, Όνομα ή Name.",
      "imp.done": "Εισήχθησαν {n} πελάτες",
      "mail.subj": "Θέμα: {s}", "mail.noCust": "Κανένας πελάτης δεν έχει το {email}. Πρόσθεσέ τον και μετά κατέγραψε το email.",
      "hist.none": "Τίποτα καταγεγραμμένο ακόμη.", "deals.none": "Καμία ευκαιρία ακόμη.", "fups.none": "Κανένα follow-up.",
      "fups.done": "Ολοκληρωμένα", "hist.add": "+ Καταγραφή", "deals.add": "+ Ευκαιρία", "fups.add": "+ Follow-up",
      "stage.new": "Νέα", "stage.contact": "Επικοινωνία", "stage.proposal": "Πρόταση", "stage.nego": "Διαπραγμάτευση",
      "stage.won": "Κερδήθηκε", "stage.lost": "Χάθηκε",
      "pipe.open": "Ανοιχτές ευκαιρίες: {n}", "pipe.val": "Αξία {v}", "pipe.w": "Σταθμισμένη {v}", "pipe.wonM": "Κερδισμένα του μήνα {v}",
      "pipe.empty": "Καμία ευκαιρία ακόμη. Ευκαιρία είναι κάτι που ελπίζεις να πουλήσεις: ένα έργο, μια παραγγελία, ένα συμβόλαιο.",
      "pipe.move": "Μετακίνηση σε στάδιο", "pipe.older": "{n} παλαιότερες",
      "pipe.prob": "πιθανότητα {p}%",
      "ag.late": "Καθυστερούν", "ag.today": "Σήμερα", "ag.soon": "Επόμενες 7 μέρες",
      "ag.empty": "Τίποτα για follow-up. Πρόσθεσε ένα από τη σελίδα ενός πελάτη ή με το Νέο.",
      "ag.done": "Έγινε", "ag.snooze1": "Αύριο", "ag.snooze7": "Σε μία εβδομάδα", "ag.edit": "Επεξεργασία", "ag.todo": "Στείλε στο To-Do",
      "ag.delete": "Διαγραφή",
      "due.today": "σήμερα", "due.tomorrow": "αύριο", "due.yday": "χθες", "due.in": "σε {n} μέρες", "due.late": "καθυστερεί {n} μέρες",
      "d.open": "Ανοιχτό pipeline", "d.openSub": "Ευκαιρίες: {n} · σταθμισμένη {w}", "d.wonM": "Κερδισμένα του μήνα", "d.wonY": "Κερδισμένα του έτους",
      "d.rate": "Ποσοστό επιτυχίας", "d.rateSub": "φέτος", "d.rateNone": "–", "d.late": "Follow-ups σε καθυστέρηση", "d.today": "Για σήμερα",
      "d.forgot": "Χωρίς επαφή", "d.forgotSub": "{n}+ μέρες", "d.leads": "Νέοι υποψήφιοι", "d.leadsSub": "αυτόν τον μήνα",
      "d.byStage": "Ανοιχτές ευκαιρίες ανά στάδιο", "d.byStatus": "Πελάτες", "d.forgotList": "Ώρα να τους μιλήσεις",
      "d.none": "Πρόσθεσε πελάτες και ευκαιρίες για να δεις αριθμούς εδώ.",
      "d.unpaid": "Ανεξόφλητα τιμολόγια", "d.unpaidSub": "ληξιπρόθεσμα {v}", "d.unpaidNone": "τίποτα ληξιπρόθεσμο",
      "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο", "ed.delete": "Διαγραφή", "ed.close": "Κλείσιμο",
      "ed.custNew": "Νέος πελάτης", "ed.custEdit": "Επεξεργασία πελάτη", "ed.kind": "Είδος", "ed.name": "Επωνυμία",
      "ed.namePh.co": "Επωνυμία εταιρείας", "ed.namePh.person": "Ονοματεπώνυμο", "ed.alias": "Διακριτικός τίτλος", "ed.status": "Κατάσταση",
      "ed.star": "Με αστέρι", "ed.tags": "Ετικέτες", "ed.tagsManage": "Διαχείριση ετικετών", "ed.afm": "ΑΦΜ", "ed.doy": "ΔΟΥ",
      "ed.job": "Επάγγελμα", "ed.addr": "Διεύθυνση", "ed.country": "Χώρα", "ed.phone": "Τηλέφωνο", "ed.email": "Email",
      "ed.web": "Ιστότοπος", "ed.src": "Πηγή", "ed.srcPh": "Σύσταση, site, έκθεση…", "ed.notes": "Σημειώσεις",
      "ed.billing": "Στοιχεία τιμολόγησης", "ed.contact": "Στοιχεία επικοινωνίας",
      "ed.dupAfm": "Υπάρχει ήδη πελάτης με αυτό το ΑΦΜ: {name}.", "ed.dupName": "Υπάρχει ήδη πελάτης με αυτό το όνομα.",
      "ed.nameReq": "Γράψε πρώτα ένα όνομα.", "ed.asNewWho": "Υπεύθυνος επικοινωνίας: {name}",
      "ed.personNew": "Προσθήκη ανθρώπου", "ed.personEdit": "Άνθρωπος", "ed.fromContacts": "Από τις Επαφές", "ed.byName": "Ή με όνομα",
      "ed.role": "Ρόλος", "ed.rolePh": "Λογιστήριο, αποφασίζει, …", "ed.toContacts": "Προσθήκη στις Επαφές",
      "ed.toContactsHint": "Ανοίγει τις Επαφές με τα στοιχεία συμπληρωμένα· αποθηκεύεται εκεί μόνο όταν πατήσεις Αποθήκευση.",
      "ed.pickContact": "Διάλεξε επαφή", "ed.searchContacts": "Αναζήτηση επαφών…", "ed.noContacts": "Δεν βρέθηκαν επαφές.",
      "ed.linked": "Συνδεδεμένος με τις Επαφές: {name}", "ed.unlink": "Αποσύνδεση",
      "ed.dealNew": "Νέα ευκαιρία", "ed.dealEdit": "Ευκαιρία", "ed.cust": "Πελάτης", "ed.title": "Τίτλος", "ed.titlePh": "Νέο site, 50 καρέκλες…",
      "ed.value": "Αξία ({c})", "ed.stage": "Στάδιο", "ed.prob": "Πιθανότητα (%)", "ed.probPh": "{p} (του σταδίου)",
      "ed.closeDay": "Αναμενόμενο κλείσιμο", "ed.why": "Γιατί χάθηκε", "ed.titleReq": "Δώσε έναν τίτλο στην ευκαιρία.",
      "ed.valBad": "Αυτό το ποσό δεν είναι αριθμός.",
      "ed.logNew": "Καταγραφή επικοινωνίας", "ed.logEdit": "Επικοινωνία", "ed.when": "Πότε", "ed.date": "Ημερομηνία", "ed.time": "Ώρα",
      "ed.who": "Με", "ed.whoNone": "—", "ed.deal": "Ευκαιρία", "ed.dealNone": "Καμία ευκαιρία", "ed.text": "Τι ειπώθηκε",
      "ed.next": "Επόμενο follow-up", "ed.nextNone": "Κανένα", "ed.next3": "Σε 3 μέρες", "ed.next7": "Σε μία εβδομάδα", "ed.next14": "Σε 2 εβδομάδες",
      "ed.nextText": "Follow-up",
      "ed.fupNew": "Νέο follow-up", "ed.fupEdit": "Follow-up", "ed.fupText": "Τι να κάνεις", "ed.fupPh": "Τηλεφώνησε για την προσφορά…",
      "ed.fupDone": "Έγινε", "ed.textReq": "Γράψε τι να κάνεις.", "ed.timeOpt": "Ώρα (προαιρετικά)",
      "ed.needCust": "Πρόσθεσε πρώτα έναν πελάτη.",
      "set.title": "Ρυθμίσεις", "set.cur": "Νόμισμα", "set.forget": "«Χωρίς επαφή» μετά από", "set.days": "{n} μέρες",
      "set.stages": "Στάδια pipeline",
      "stg.title": "Στάδια pipeline", "stg.hint": "Μετονόμασε, άλλαξε σειρά, πρόσθεσε δικά σου ή κρύψε όσα δεν χρησιμοποιείς. Ο αριθμός είναι η προεπιλεγμένη πιθανότητα. Τα Κερδήθηκε και Χάθηκε μένουν ως έχουν.",
      "stg.name": "Όνομα σταδίου", "stg.prob": "Προεπιλεγμένη πιθανότητα (%)", "stg.up": "Πάνω", "stg.down": "Κάτω",
      "stg.hide": "Απόκρυψη", "stg.del": "Διαγραφή", "stg.show": "Εμφάνιση: {name}", "stg.hiddenHead": "Κρυμμένα",
      "stg.newPh": "Νέο στάδιο", "stg.add": "Προσθήκη", "stg.max": "Έως {n} ανοιχτά στάδια.",
      "stg.notEmpty": "Το {name} έχει ακόμα ευκαιρίες ({n}). Μετακίνησέ τες πρώτα σε άλλο στάδιο.", "stg.last": "Χρειάζεται ένα ανοιχτό στάδιο.",
      "stg.hidden": "Κρύφτηκε: {name}", "stg.deleted": "Διαγράφηκε: {name}",
      "set.tags": "Ετικέτες", "set.export": "Εξαγωγή πελατών (CSV)", "set.sheet": "Άνοιγμα στο Υπολογιστικό φύλλο",
      "set.sheetCap": "Χωρούν μόνο οι πρώτοι {n} πελάτες σε ένα φύλλο", "set.backup": "Αντίγραφο (JSON)", "set.restore": "Επαναφορά αντιγράφου",
      "set.osave": "Αρχείο orOS (.oroscrm)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "set.restoreHint": "Το αντίγραφο συγχωνεύεται με ό,τι έχεις: τίποτα δεν σβήνεται και κανένα παλιότερο αντίγραφο δεν γράφει πάνω σε νεότερο.",
      "set.usage": "Η εφαρμογή χρησιμοποιεί {kb} KB από τον χώρο του browser που μοιράζονται όλες οι εφαρμογές του orOS.",
      "tags.title": "Ετικέτες", "tags.new": "Νέα ετικέτα", "tags.none": "Καμία ετικέτα ακόμη.", "tags.namePh": "Όνομα ετικέτας",
      "tags.add": "Προσθήκη", "tags.del": "Διαγραφή της ετικέτας «{name}»; Θα φύγει από όλους τους πελάτες.",
      "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Διαγράφηκε", "toast.custDel": "Διαγράφηκε: {name}", "toast.undo": "Αναίρεση",
      "toast.done": "Έγινε: {text}", "toast.logIt": "Καταγραφή", "toast.moved": "Στο στάδιο {stage}",
      "toast.snoozed": "Μετακινήθηκε: {d}", "toast.logged": "Καταγράφηκε", "toast.full": "Ο χώρος του browser γέμισε: αυτή η αλλαγή ΔΕΝ αποθηκεύτηκε.",
      "toast.restored": "Το αντίγραφο συγχωνεύτηκε", "toast.badFile": "Αυτό δεν είναι αντίγραφο του CRM.", "toast.exported": "Αποθηκεύτηκε: {name}",
      "toast.todo": "Στάλθηκε στο To-Do", "toast.gone": "Αυτό έχει διαγραφεί.",
      "confirm.cust": "Διαγραφή του πελάτη {name}; Φεύγουν μαζί οι ευκαιρίες, το ιστορικό και τα follow-ups του.",
      "aria.star": "Αστέρι", "aria.edit": "Επεξεργασία", "aria.more": "Περισσότερα", "aria.remove": "Αφαίρεση",
      "unknown": "Άγνωστος πελάτης",
      "toast.already": "Αυτό το follow-up έχει ήδη γίνει."
    }
  };

  function t(key, vars) {
    var s = STRINGS[LANG][key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  var UI = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
    meet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M3 4h18M3 9h18M3 14h9"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    deal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    pipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="7" rx="1"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 15l2 2 4-4"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/></svg>',
    todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  var KIND_ICON = { call: "call", mail: "mail", meet: "meet", msg: "msg", note: "note" };
  var TAB_ICON = { cust: "users", pipe: "pipe", agenda: "agenda", dash: "dash" };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function iconBtn(name, label, fn, cls) {
    var b = el("button", "icon-btn " + (cls || ""));
    b.type = "button";
    b.innerHTML = UI[name];          // constant SVG
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function txtBtn(name, label, fn, cls) {
    var b = el("button", "txt-btn " + (cls || ""));
    b.type = "button";
    if (name) b.innerHTML = UI[name];   // constant SVG
    b.appendChild(el("span", "", label));
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayYmd() { return C.ymdOf(Date.now()); }
  function ymdDate(ymd) { var p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function fmtDate(ymd) {
    var d = ymdDate(ymd), sameYear = ymd.slice(0, 4) === todayYmd().slice(0, 4);
    return d.toLocaleDateString(LOCALE, sameYear ? { day: "numeric", month: "short", weekday: "short" }
                                                  : { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtMs(ms) {
    var d = new Date(ms), ymd = C.ymdOf(ms);
    return fmtDate(ymd) + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function relDay(ymd) {
    var n = C.dayDiff(todayYmd(), ymd);
    if (n === 0) return t("due.today");
    if (n === 1) return t("due.tomorrow");
    if (n === -1) return t("due.yday");
    if (n > 1 && n <= 7) return t("due.in", { n: n });
    if (n < -1) return t("due.late", { n: -n });
    return fmtDate(ymd);
  }
  function lastLine(ms) {
    if (!ms) return t("last.never");
    var n = C.dayDiff(C.ymdOf(ms), todayYmd());
    if (n <= 0) return t("last.today");
    if (n === 1) return t("last.yday");
    if (n < 60) return t("last.days", { n: n });
    return t("last.date", { d: fmtDate(C.ymdOf(ms)) });
  }
  function money(cents) { return C.moneyStr(cents, data.prefs.cur, LANG); }
  function initials(name) {
    var w = String(name || "").trim().split(/\s+/).filter(Boolean);
    var s = (w[0] ? w[0].charAt(0) : "") + (w.length > 1 ? w[w.length - 1].charAt(0) : "");
    return (s || "?").toUpperCase();
  }
  function tagOf(id) { return C.byId(data.tags, id); }
  function custColor(c) {
    var tg = c && c.tags && c.tags.length ? tagOf(c.tags[0]) : null;
    return tg ? COLORS[tg.col] : "";
  }
  // A stage's label: the user's name, else the built-in one. An id
  // that is gone (deleted on another device) reads as the stage the
  // deal now shows in (C.stageOf).
  function stageObj(id) { return C.stageOf(data, { stage: id }); }
  function stageName(id) {
    var s = stageObj(id);
    return s.name || t("stage." + s.id);
  }
  function safeUrl(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    return /^https?:\/\//i.test(s) ? s : "";
  }
  function telHref(p) { return "tel:" + String(p || "").replace(/[^\d+*#]/g, ""); }

  // ---------- 2. Storage + prefs ----------
  var data = C.empty();
  var prefs = { tab: "cust", sel: "", filter: "all", tag: "", sort: "name", sub: "hist", stage: "new" };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!raw) { data = C.empty(); return; }
    try { data = C.norm(JSON.parse(raw)); }
    catch (e) {
      // keep the unreadable copy, start clean (never silently overwrite)
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) {}
      data = C.empty();
    }
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (["cust", "pipe", "agenda", "dash"].indexOf(p.tab) >= 0) prefs.tab = p.tab;
        if (typeof p.sel === "string") prefs.sel = p.sel;
        if (["all", "lead", "active", "past", "star", "forgot"].indexOf(p.filter) >= 0) prefs.filter = p.filter;
        if (typeof p.tag === "string") prefs.tag = p.tag;
        if (["name", "last", "next", "value"].indexOf(p.sort) >= 0) prefs.sort = p.sort;
        if (["hist", "deals", "fups", "docs"].indexOf(p.sub) >= 0) prefs.sub = p.sub;
        if (typeof p.stage === "string") prefs.stage = p.stage;
      }
    } catch (e) {}
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // Every write goes through here: canonical form (R26), quota
  // failures are surfaced (R30), the slice is marked dirty.
  function commit() {
    var next = C.norm(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      load();                     // back to what is really stored
      showToast(t("toast.full"));
      render();
      return false;
    }
    data = next;
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    render();
    return true;
  }

  // R27: m moves only at a real change, strictly after the previous one.
  var lastStamp = 0;
  function stamp(prev) {
    var n = Date.now();
    if (n <= lastStamp) n = lastStamp + 1;
    if (prev && prev.m >= n) n = prev.m + 1;
    lastStamp = n;
    return n;
  }

  // ---------- 3. Mutations ----------
  function upsert(key, row) {
    var list = data[key], prev = C.byId(list, row.id);
    var next = Object.assign({}, row);
    next.m = stamp(prev);
    if (data.tombs[next.id] && data.tombs[next.id] >= next.m) next.m = data.tombs[next.id] + 1;
    if (prev) list[list.indexOf(prev)] = next; else list.push(next);
    return commit() ? next : null;
  }
  function tomb(id) {
    var n = stamp(null);
    data.tombs[id] = n;
    return n;
  }
  // Delete with Undo: Undo writes the rows back with fresh stamps
  // (a newer edit resurrects, R17).
  function removeRow(key, id, label) {
    var row = C.byId(data[key], id);
    if (!row) return;
    tomb(id);
    if (!commit()) return;
    undoToast(label || t("toast.deleted"), function () {
      delete data.tombs[id];
      upsert(key, row);
    });
  }
  function removeCustomer(c) {
    var kids = {
      deals: data.deals.filter(function (d) { return d.cust === c.id; }),
      acts: data.acts.filter(function (a) { return a.cust === c.id; }),
      fups: data.fups.filter(function (f) { return f.cust === c.id; })
    };
    tomb(c.id);
    if (prefs.sel === c.id) { prefs.sel = ""; savePrefs(); }
    if (!commit()) return;
    undoToast(t("toast.custDel", { name: c.name }), function () {
      delete data.tombs[c.id];
      var back = Object.assign({}, c, { m: stamp(c) });
      data.cust.push(back);
      ["deals", "acts", "fups"].forEach(function (k) {
        kids[k].forEach(function (r) {
          if (!C.byId(data[k], r.id)) data[k].push(Object.assign({}, r, { m: stamp(r) }));
        });
      });
      prefs.sel = c.id;
      commit();
    });
  }
  function setStage(d, stage) {
    if (!d || d.stage === stage) return;
    var prev = d;
    var next = Object.assign({}, d, { stage: stage });
    if (stage === "won" || stage === "lost") next.cd = todayYmd(); else delete next.cd;
    if (stage !== "lost") delete next.why;
    if (upsert("deals", next)) {
      undoToast(t("toast.moved", { stage: stageName(stage) }), function () {
        var cur = C.byId(data.deals, prev.id);
        if (cur) upsert("deals", Object.assign({}, prev));
      });
    }
  }
  function doneFup(f) {
    var cur = C.byId(data.fups, f.id);
    if (!cur || cur.done) return;
    upsert("fups", Object.assign({}, cur, { done: todayYmd() }));
    actionToast(t("toast.done", { text: cur.text }), t("toast.logIt"), function () {
      logEditor(null, cur.cust, { text: cur.text, deal: cur.deal || "" });
    }, function () {
      var now = C.byId(data.fups, cur.id);
      if (now) { var r = Object.assign({}, now); delete r.done; upsert("fups", r); }
    });
  }
  function snooze(f, days) {
    var cur = C.byId(data.fups, f.id);
    if (!cur) return;
    var base = cur.d < todayYmd() ? todayYmd() : cur.d;
    var d = C.addDays(base, days);
    var prev = Object.assign({}, cur);
    if (upsert("fups", Object.assign({}, cur, { d: d }))) {
      undoToast(t("toast.snoozed", { d: fmtDate(d) }), function () { upsert("fups", prev); });
    }
  }

  // ---------- 4. Other apps (read-only, prefill bridges) ----------
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  var contactsCache = { raw: null, list: [], map: {} };
  function contacts() {
    var raw = null;
    try { raw = localStorage.getItem(CONTACTS_KEY); } catch (e) {}
    if (raw === contactsCache.raw) return contactsCache;
    contactsCache = { raw: raw, list: [], map: {} };
    try {
      var d = JSON.parse(raw || "null");
      var dead = {};
      if (d && Array.isArray(d.deleted)) d.deleted.forEach(function (x) { if (x && typeof x.id === "string") dead[x.id] = 1; });
      if (d && Array.isArray(d.contacts)) d.contacts.forEach(function (c) {
        if (!c || typeof c.id !== "string" || dead[c.id] || c.del) return;
        var row = {
          id: c.id,
          name: contactName(c),
          org: typeof c.org === "string" ? c.org : "",
          phone: firstVal(c.phones),
          email: firstVal(c.emails)
        };
        contactsCache.list.push(row);
        contactsCache.map[c.id] = row;
      });
    } catch (e) {}
    contactsCache.list.sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); });
    return contactsCache;
  }
  function firstVal(arr) {
    if (!Array.isArray(arr)) return "";
    for (var i = 0; i < arr.length; i++) if (arr[i] && typeof arr[i].v === "string" && arr[i].v.trim()) return arr[i].v.trim();
    return "";
  }
  function contactName(c) {
    var parts = [c.given, c.middle, c.family].filter(function (x) { return typeof x === "string" && x.trim(); });
    if (parts.length) return parts.join(" ").trim();
    if (typeof c.nickname === "string" && c.nickname.trim()) return c.nickname.trim();
    if (typeof c.org === "string" && c.org.trim()) return c.org.trim();
    return "?";
  }
  // A person as shown: live from Contacts when linked and still there.
  function personView(p) {
    var ct = p.c ? contacts().map[p.c] : null;
    return {
      name: ct ? ct.name : p.n,
      phone: ct ? ct.phone : (p.phone || ""),
      email: ct ? ct.email : (p.email || ""),
      linked: !!ct,
      gone: !!p.c && !ct
    };
  }
  function openContact(id) {
    var s = shell();
    if (s && typeof s.__orosOpenContact === "function") s.__orosOpenContact(id);
  }
  function canAddContact() { var s = shell(); return !!(s && typeof s.__orosOpenAt === "function"); }
  function addToContacts(name, email) {
    var s = shell();
    if (s && typeof s.__orosOpenAt === "function") s.__orosOpenAt("contacts", { add: { email: email, name: name } });
  }
  function mailShell() {
    var s = shell();
    if (!s || typeof s.__orosOpenAt !== "function") return null;
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return d && Array.isArray(d.accounts) && d.accounts.length ? s : null;
    } catch (e) { return null; }
  }
  function writeEmail(to, name) {
    var s = mailShell();
    if (s) {
      var addr = name ? "\"" + name.replace(/[\\"]/g, "\\$&") + "\" <" + to + ">" : to;
      s.__orosOpenAt("mail", { compose: { to: addr } });
      return;
    }
    window.open("mailto:" + encodeURIComponent(to), "_blank", "noopener,noreferrer");
  }
  function openMap(addr, label) {
    var s = shell();
    try {
      if (s && typeof s.__orosOpenMapsQuery === "function") { s.__orosOpenMapsQuery(addr, label || ""); return; }
    } catch (e) {}
    window.open("/maps/?q=" + encodeURIComponent(addr), "_blank", "noopener,noreferrer");
  }
  function canTodo() { var s = shell(); return !!(s && typeof s.__orosOpenAt === "function"); }
  function sendToTodo(f) {
    var s = shell(), c = C.byId(data.cust, f.cust);
    if (!s || typeof s.__orosOpenAt !== "function") return;
    var note = [c ? c.name : "", relDay(f.d) + (f.t ? " " + f.t : "")].filter(Boolean).join(" · ");
    s.__orosOpenAt("todo", { addItems: { from: t("app"), items: [{ text: C.cleanText(f.text, 300), note: note.slice(0, 1000) }] } });
  }

  // ---------- 5. Customers list ----------
  function filtered() {
    var q = C.fold($("cust-q").value.trim());
    var words = q ? q.split(/\s+/) : [];
    var last = C.lastContactMap(data);
    var forgot = {};
    if (prefs.filter === "forgot") C.forgotten(data, Date.now()).forEach(function (c) { forgot[c.id] = 1; });
    var tagNames = {};
    data.tags.forEach(function (tg) { tagNames[tg.id] = tg.name; });
    var list = data.cust.filter(function (c) {
      if (prefs.filter === "lead" || prefs.filter === "active" || prefs.filter === "past") { if (c.st !== prefs.filter) return false; }
      else if (prefs.filter === "star") { if (!c.star) return false; }
      else if (prefs.filter === "forgot") { if (!forgot[c.id]) return false; }
      if (prefs.tag && (!c.tags || c.tags.indexOf(prefs.tag) < 0)) return false;
      if (!words.length) return true;
      var hay = C.fold([c.name, c.alias, c.afm, c.phone, c.email, c.job, c.addr, c.src, c.note,
        (c.people || []).map(function (p) { return personView(p).name + " " + (p.role || ""); }).join(" "),
        (c.tags || []).map(function (id) { return tagNames[id] || ""; }).join(" ")].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    var nextFup = {}, openVal = {};
    data.fups.forEach(function (f) { if (!f.done && (!nextFup[f.cust] || f.d < nextFup[f.cust])) nextFup[f.cust] = f.d; });
    data.deals.forEach(function (d) { if (C.isOpen(d)) openVal[d.cust] = (openVal[d.cust] || 0) + d.val; });
    var byName = function (a, b) { return a.name.localeCompare(b.name, LOCALE) || (a.id < b.id ? -1 : 1); };
    list.sort(function (a, b) {
      if (prefs.sort === "last") return (last[b.id] || 0) - (last[a.id] || 0) || byName(a, b);
      if (prefs.sort === "next") {
        var x = nextFup[a.id] || "9999", y = nextFup[b.id] || "9999";
        return x < y ? -1 : (x > y ? 1 : byName(a, b));
      }
      if (prefs.sort === "value") return (openVal[b.id] || 0) - (openVal[a.id] || 0) || byName(a, b);
      return byName(a, b);
    });
    return { list: list, last: last, next: nextFup, val: openVal };
  }

  function renderFilters() {
    var box = $("cust-filter");
    box.innerHTML = "";
    ["all", "lead", "active", "past", "star", "forgot"].forEach(function (f) {
      var b = el("button", "chip" + (prefs.filter === f ? " on" : ""), t("f." + f));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.filter === f ? "true" : "false");
      b.addEventListener("click", function () { prefs.filter = f; savePrefs(); renderCustomers(); });
      box.appendChild(b);
    });
    if (prefs.tag && !tagOf(prefs.tag)) prefs.tag = "";
    data.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); }).forEach(function (tg) {
      var b = el("button", "chip" + (prefs.tag === tg.id ? " on" : ""));
      b.type = "button";
      var dot = el("span", "dot"); dot.style.background = COLORS[tg.col];
      b.appendChild(dot);
      b.appendChild(el("span", "", tg.name));
      b.setAttribute("aria-pressed", prefs.tag === tg.id ? "true" : "false");
      b.addEventListener("click", function () { prefs.tag = prefs.tag === tg.id ? "" : tg.id; savePrefs(); renderCustomers(); });
      box.appendChild(b);
    });
  }

  function renderCustomers() {
    var view = $("view-cust");
    if (prefs.sel && !C.byId(data.cust, prefs.sel)) prefs.sel = "";
    view.classList.toggle("has-sel", !!prefs.sel);
    var box = $("cust-list");
    box.innerHTML = "";
    if (!data.cust.length) {
      $("cust-list-pane").querySelector(".list-tools").hidden = true;
      $("cust-filter").hidden = true;
      var e = el("div", "empty");
      e.appendChild(el("p", "", t("empty.first")));
      e.appendChild(txtBtn("plus", t("empty.first.btn"), function () { custEditor(null); }, "primary"));
      box.appendChild(e);
      renderDetail();
      return;
    }
    $("cust-list-pane").querySelector(".list-tools").hidden = false;
    $("cust-filter").hidden = false;
    renderFilters();
    var r = filtered();
    if (!r.list.length) box.appendChild(el("div", "empty", t("empty.list")));
    r.list.slice(0, LIST_CAP).forEach(function (c) {
      var b = el("button", "row" + (c.id === prefs.sel ? " sel" : ""));
      b.type = "button";
      var av = el("span", "avatar", initials(c.name));
      var col = custColor(c);
      if (col) { av.style.background = col; av.style.color = "#14120d"; }
      b.appendChild(av);
      var main = el("span", "row-main");
      var title = el("span", "row-title");
      if (c.star) title.appendChild(el("span", "star", "★ "));
      title.appendChild(document.createTextNode(c.name));
      main.appendChild(title);
      var sub = el("span", "row-sub");
      sub.appendChild(el("span", "st-" + c.st, t("st." + c.st)));
      sub.appendChild(document.createTextNode(" · " + lastLine(r.last[c.id])));
      if (r.next[c.id]) {
        var late = r.next[c.id] < todayYmd(), today = r.next[c.id] === todayYmd();
        sub.appendChild(document.createTextNode(" · "));
        sub.appendChild(el("span", late ? "late" : (today ? "due-today" : ""), t("next", { d: relDay(r.next[c.id]) })));
      }
      main.appendChild(sub);
      b.appendChild(main);
      if (r.val[c.id]) {
        var side = el("span", "row-side");
        side.appendChild(el("b", "", money(r.val[c.id])));
        b.appendChild(side);
      }
      b.addEventListener("click", function () { selectCust(c.id); });
      box.appendChild(b);
    });
    if (r.list.length > LIST_CAP) box.appendChild(el("div", "more-n", t("more", { n: r.list.length - LIST_CAP })));
    renderDetail();
  }

  function selectCust(id) {
    prefs.sel = id;
    savePrefs();
    if (prefs.tab !== "cust") { setTab("cust"); return; }
    renderCustomers();
    var d = $("cust-detail");
    if (d) d.scrollTop = 0;
  }

  // ---------- 6. Customer page ----------
  function renderDetail() {
    var box = $("cust-detail");
    box.innerHTML = "";
    var c = prefs.sel ? C.byId(data.cust, prefs.sel) : null;
    if (!c) {
      if (data.cust.length) box.appendChild(el("div", "empty", t("empty.pick")));
      return;
    }
    var back = txtBtn("back", t("btn.back"), function () { prefs.sel = ""; savePrefs(); renderCustomers(); }, "back-btn");
    box.appendChild(back);

    // head
    var head = el("div", "c-head");
    var av = el("span", "avatar", initials(c.name));
    var col = custColor(c);
    if (col) { av.style.background = col; av.style.color = "#14120d"; }
    head.appendChild(av);
    var hm = el("div", "row-main");
    hm.appendChild(el("h2", "c-name", c.name));
    var sub = el("div", "c-sub");
    sub.appendChild(el("span", "st-badge st-" + c.st, t("st." + c.st)));
    sub.appendChild(document.createTextNode(" " + [t("kind." + c.kind), c.alias || ""].filter(Boolean).join(" · ")));
    hm.appendChild(sub);
    head.appendChild(hm);
    var starB = iconBtn(c.star ? "starOn" : "star", t("aria.star"), function () {
      var r = Object.assign({}, c);
      if (r.star) delete r.star; else r.star = 1;
      upsert("cust", r);
    }, "mini" + (c.star ? " on star" : ""));
    starB.setAttribute("aria-pressed", c.star ? "true" : "false");
    head.appendChild(starB);
    head.appendChild(iconBtn("edit", t("aria.edit"), function () { custEditor(c); }, "mini"));
    box.appendChild(head);

    // quick actions
    var acts = el("div", "c-actions");
    if (c.phone) {
      var call = el("a", "txt-btn");
      call.href = telHref(c.phone);
      call.innerHTML = UI.call;
      call.appendChild(el("span", "", t("act.call")));
      acts.appendChild(call);
    }
    if (c.email) acts.appendChild(txtBtn("mail", t("act.mail"), function () { writeEmail(c.email, c.name); }));
    if (c.addr) acts.appendChild(txtBtn("map", t("act.map"), function () { openMap([c.addr, c.country].filter(Boolean).join(", "), c.name); }));
    acts.appendChild(txtBtn("log", t("act.log"), function () { logEditor(null, c.id); }, "primary"));
    acts.appendChild(txtBtn("clock", t("act.fup"), function () { fupEditor(null, c.id); }));
    acts.appendChild(txtBtn("deal", t("act.deal"), function () { dealEditor(null, c.id); }));
    if (canInvoice()) acts.appendChild(txtBtn("doc", t("act.inv"), function () { newInvoice(c, null); }));
    if (canQuote()) acts.appendChild(txtBtn("doc", t("act.quote"), function () { newQuote(c, null); }));
    if (c.email || c.phone || c.web) acts.appendChild(txtBtn("", t("en.one"), function () { enrichOpen([c]); }));
    box.appendChild(acts);

    // details
    var facts = el("dl", "facts");
    function fact(label, node) {
      facts.appendChild(el("dt", "", label));
      var dd = el("dd");
      if (typeof node === "string") dd.textContent = node; else dd.appendChild(node);
      facts.appendChild(dd);
    }
    if (c.afm) {
      var af = el("span", "", c.afm + " ");
      var isGr = !c.country || /^(gr|greece|ελλάδα|ελλαδα|hellas)$/i.test(c.country.trim());
      if (isGr) {
        var ok = C.validAfm(c.afm);
        af.appendChild(el("span", ok ? "hint ok" : "hint warn", "(" + t(ok ? "afm.ok" : "afm.bad") + ")"));
      }
      fact(t("fact.afm"), af);
    }
    if (c.doy) fact(t("fact.doy"), c.doy);
    if (c.job) fact(t("fact.job"), c.job);
    if (c.addr) fact(t("fact.addr"), c.addr);
    if (c.country) fact(t("fact.country"), c.country);
    if (c.phone) { var pa = el("a", "", c.phone); pa.href = telHref(c.phone); fact(t("fact.phone"), pa); }
    if (c.email) {
      var ea = el("a", "", c.email);
      ea.href = "mailto:" + c.email;
      ea.addEventListener("click", function (e) { e.preventDefault(); writeEmail(c.email, c.name); });
      fact(t("fact.email"), ea);
    }
    var web = safeUrl(c.web);
    if (web) {
      var wa = el("a", "", c.web);
      wa.href = web; wa.target = "_blank"; wa.rel = "noopener noreferrer";
      fact(t("fact.web"), wa);
    }
    if (c.src) fact(t("fact.src"), c.src);
    if (c.tags && c.tags.length) {
      var tg = el("span", "chips");
      tg.style.margin = "0";
      c.tags.forEach(function (id) {
        var x = tagOf(id);
        if (!x) return;
        var ch = el("span", "chip tag");
        var dot = el("span", "dot"); dot.style.background = COLORS[x.col];
        ch.appendChild(dot); ch.appendChild(el("span", "", x.name));
        tg.appendChild(ch);
      });
      fact(t("fact.tags"), tg);
    }
    if (c.ct) fact(t("fact.since"), fmtDate(C.ymdOf(c.ct)));
    if (facts.childNodes.length) {
      var si = el("div", "sec");
      si.appendChild(secHead(t("sec.info")));
      si.appendChild(facts);
      box.appendChild(si);
    }
    if (c.note) {
      var sn = el("div", "sec");
      sn.appendChild(secHead(t("sec.notes")));
      sn.appendChild(el("p", "notes", c.note));
      box.appendChild(sn);
    }

    // people
    var sp = el("div", "sec");
    var ph = secHead(t("sec.people"));
    var addP = el("button", "link-btn", t("people.add"));
    addP.type = "button";
    addP.addEventListener("click", function () { personEditor(c, -1); });
    ph.appendChild(el("span", "spacer"));
    ph.appendChild(addP);
    sp.appendChild(ph);
    if (!c.people || !c.people.length) sp.appendChild(el("p", "hint", t("people.none")));
    (c.people || []).forEach(function (p, i) {
      var v = personView(p);
      var row = el("div", "person");
      var main = el("button", "row-main link-like");
      main.type = "button";
      main.style.cssText = "background:none;border:none;text-align:left;padding:0;";
      main.appendChild(el("div", "row-title", v.name + (p.role ? " · " + p.role : "")));
      var line = [v.phone, v.email].filter(Boolean).join(" · ");
      if (v.gone) line = t("people.gone");
      if (line) main.appendChild(el("div", "row-sub", line));
      main.addEventListener("click", function () { personEditor(c, i); });
      row.appendChild(main);
      if (v.phone) {
        var a = el("a", "icon-btn mini");
        a.href = telHref(v.phone);
        a.innerHTML = UI.call;
        a.setAttribute("aria-label", t("act.call") + " " + v.name);
        a.title = t("act.call");
        row.appendChild(a);
      }
      if (v.email) row.appendChild(iconBtn("mail", t("act.mail") + " " + v.name, function () { writeEmail(v.email, v.name); }, "mini"));
      if (v.linked) row.appendChild(iconBtn("contact", t("people.open"), function () { openContact(p.c); }, "mini"));
      sp.appendChild(row);
    });
    box.appendChild(sp);

    // sub-tabs
    var custActs = data.acts.filter(function (a) { return a.cust === c.id; })
      .sort(function (a, b) { return b.at - a.at || (a.id < b.id ? 1 : -1); });
    var custDeals = data.deals.filter(function (d) { return d.cust === c.id; });
    var custFups = data.fups.filter(function (f) { return f.cust === c.id; });
    var openF = custFups.filter(function (f) { return !f.done; });
    var subs = [["hist", t("sub.hist") + " (" + custActs.length + ")"],
                ["deals", t("sub.deals") + " (" + custDeals.length + ")"],
                ["fups", t("sub.fups") + " (" + openF.length + ")"]];
    var docs = docsFor(c);
    if (docs) subs.push(["docs", t("sub.docs") + " (" + (docs.inv.rows.length + docs.quotes.length) + ")"]);
    else if (prefs.sub === "docs") prefs.sub = "hist";
    var st = el("div", "subtabs");
    st.setAttribute("role", "tablist");
    subs.forEach(function (s) {
      var b = el("button", "subtab" + (prefs.sub === s[0] ? " on" : ""), s[1]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", prefs.sub === s[0] ? "true" : "false");
      b.addEventListener("click", function () { prefs.sub = s[0]; savePrefs(); renderDetail(); });
      st.appendChild(b);
    });
    box.appendChild(st);
    var pane = el("div", "");
    box.appendChild(pane);
    if (prefs.sub === "hist") renderHistory(pane, c, custActs);
    else if (prefs.sub === "deals") renderCustDeals(pane, c, custDeals);
    else if (prefs.sub === "docs") renderCustDocs(pane, c, docs);
    else renderCustFups(pane, c, custFups);
  }

  function secHead(label) {
    var h = el("div", "sec-head");
    h.appendChild(el("h3", "sec-title", label));
    return h;
  }
  function addLine(pane, label, fn) {
    var h = el("div", "sec-head");
    h.appendChild(el("span", "spacer"));
    var b = el("button", "link-btn", label);
    b.type = "button";
    b.addEventListener("click", fn);
    h.appendChild(b);
    pane.appendChild(h);
  }

  function renderHistory(pane, c, list) {
    addLine(pane, t("hist.add"), function () { logEditor(null, c.id); });
    if (!list.length) { pane.appendChild(el("p", "hint", t("hist.none"))); return; }
    var tl = el("div", "timeline");
    list.forEach(function (a) {
      var it = el("button", "tl-item");
      it.type = "button";
      it.style.textAlign = "left";
      var ico = el("span", "tl-ico");
      ico.innerHTML = UI[KIND_ICON[a.k]];
      it.appendChild(ico);
      var main = el("span", "row-main");
      var dealRow = a.deal ? C.byId(data.deals, a.deal) : null;
      var meta = [t("k." + a.k), fmtMs(a.at), a.who || "", dealRow ? dealRow.title : ""].filter(Boolean).join(" · ");
      main.appendChild(el("span", "tl-when", meta));
      if (a.text) main.appendChild(el("span", "tl-text", a.text));
      it.appendChild(main);
      it.addEventListener("click", function () { logEditor(a, c.id); });
      tl.appendChild(it);
    });
    pane.appendChild(tl);
  }

  function dealRowEl(d, showCust) {
    var b = el("button", "deal");
    b.type = "button";
    b.appendChild(el("div", "deal-title", d.title));
    var c = C.byId(data.cust, d.cust);
    var bits = [];
    if (showCust) bits.push(c ? c.name : t("unknown"));
    if (!showCust || !C.isOpen(d)) bits.push(stageName(d.stage));
    if (C.isOpen(d)) bits.push(t("pipe.prob", { p: C.dealProb(d, data) }));
    if (d.close && C.isOpen(d)) bits.push(relDay(d.close));
    if (d.cd && !C.isOpen(d)) bits.push(fmtDate(d.cd));
    b.appendChild(el("div", "deal-sub", bits.join(" · ")));
    b.appendChild(el("div", "deal-val", money(d.val)));
    b.addEventListener("click", function () { dealEditor(d, d.cust); });
    return b;
  }
  function renderCustDeals(pane, c, list) {
    addLine(pane, t("deals.add"), function () { dealEditor(null, c.id); });
    if (!list.length) { pane.appendChild(el("p", "hint", t("deals.none"))); return; }
    var box = el("div", "rows");
    var order = C.stages(data).map(function (x) { return x.id; });
    var rank = function (d) { return order.indexOf(C.stageOf(data, d).id); };
    list.slice().sort(function (a, b) {
      var oa = C.isOpen(a) ? 0 : 1, ob = C.isOpen(b) ? 0 : 1;
      return oa - ob || rank(b) - rank(a) || b.m - a.m;
    }).forEach(function (d) { box.appendChild(dealRowEl(d, false)); });
    pane.appendChild(box);
  }

  // ----- Invoices and Quote (phase 3, BR-CRM-INV and BR-Q1) -----
  // Read-only: oros-invoices-data only through OrosInvoicesCore,
  // oros-quote-data only through OrosQuoteCore. Both are parsed once
  // per stored string.
  var INV_KEY = "oros-invoices-data", QUOTE_KEY = "oros-quote-data";
  var invCache = { raw: undefined, data: null }, quoteCache = { raw: undefined, data: null };
  function invData() {
    var I = window.OrosInvoicesCore;
    if (!I) return null;
    var raw = null;
    try { raw = localStorage.getItem(INV_KEY); } catch (e) {}
    if (raw !== invCache.raw) {
      invCache.raw = raw;
      try { invCache.data = raw ? I.parse(raw) : null; } catch (e) { invCache.data = null; }
    }
    return invCache.data;
  }
  function quoteData() {
    if (!window.OrosQuoteCore) return null;
    var raw = null;
    try { raw = localStorage.getItem(QUOTE_KEY); } catch (e) {}
    if (raw !== quoteCache.raw) {
      quoteCache.raw = raw;
      try { quoteCache.data = raw ? JSON.parse(raw) : null; } catch (e) { quoteCache.data = null; }
    }
    return quoteCache.data;
  }
  // null when neither app can be reached (the tab stays hidden)
  function docsFor(c) {
    if (!canInvoice() && !canQuote()) return null;
    var di = invData(), dq = quoteData();
    return {
      inv: di ? window.OrosInvoicesCore.byCrm(di, c.id, todayYmd()) : { rows: [], totals: {} },
      quotes: dq ? window.OrosQuoteCore.forClient(dq, { name: c.name, afm: c.afm }) : []
    };
  }
  function canInvoice() {
    var s = shell();
    return !!(s && typeof s.__orosOpenAt === "function" && window.OrosInvoicesCore);
  }
  function canQuote() {
    var s = shell();
    return !!(s && typeof s.__orosOpenQuoteNew === "function" && typeof s.__orosOpenQuote === "function");
  }
  function openInvoices(target) {
    var s = shell();
    if (s && typeof s.__orosOpenAt === "function") s.__orosOpenAt("invoices", target);
    else showToast(t("toast.noInv"));
  }
  // BR-CRM-INV 1: a prefilled draft in Invoices, saved only there.
  // From a won deal: one line (title, 1, value) and ref crm/deal id.
  // Payloads: C.invoicePrefill / C.quotePrefill.
  function newInvoice(c, d) { openInvoices({ "new": C.invoicePrefill(c, d, data.prefs.cur) }); }
  // BR-Q1: a new unsaved draft in Quote. Quote needs at least one
  // line (any ISO currency since Quote wave 46).
  function newQuote(c, d) {
    var s = shell();
    if (!s || typeof s.__orosOpenQuoteNew !== "function") { showToast(t("toast.noQuote")); return; }
    var p = C.quotePrefill(c, d, data.prefs.cur);
    if (!p) { showToast(t("toast.quoteCur")); return; }
    if (!s.__orosOpenQuoteNew(p)) showToast(t("toast.noQuote"));
  }
  function curMoney(cents, cur) { return C.moneyStr(cents, cur, LANG); }
  function renderCustDocs(pane, c, docs) {
    var si = el("div", "sec");
    var hi = secHead(t("docs.inv"));
    if (canInvoice()) {
      hi.appendChild(el("span", "spacer"));
      if (docs.inv.rows.length) {
        var all = el("button", "link-btn", t("docs.allInv"));
        all.type = "button";
        all.addEventListener("click", function () { openInvoices({ client: { crm: c.id, afm: c.afm || "", name: c.name } }); });
        hi.appendChild(all);
      }
      var ni = el("button", "link-btn", "+ " + t("act.inv"));
      ni.type = "button";
      ni.addEventListener("click", function () { newInvoice(c, null); });
      hi.appendChild(ni);
    }
    si.appendChild(hi);
    Object.keys(docs.inv.totals).sort().forEach(function (cur) {
      var x = docs.inv.totals[cur];
      var line = t("docs.tot", { i: curMoney(x.invoiced, cur), p: curMoney(x.paid, cur) });
      if (x.open > 0) line += " · " + t("docs.open", { v: curMoney(x.open, cur) });
      var p = el("p", "doc-tot", line);
      if (x.overdue > 0) {
        p.appendChild(document.createTextNode(" · "));
        p.appendChild(el("span", "late", t("docs.overdue", { v: curMoney(x.overdue, cur) })));
      }
      si.appendChild(p);
    });
    if (!docs.inv.rows.length) si.appendChild(el("p", "hint", t("docs.invNone")));
    else {
      var rows = el("div", "rows");
      docs.inv.rows.slice(0, 30).forEach(function (r) {
        rows.appendChild(docRow(r.no || t("ik." + r.kind), [t("ik." + r.kind), r.date ? fmtDate(r.date) : ""],
          curMoney(r.total, r.cur), "is." + r.status, r.status === "overdue",
          function () { openInvoices({ invoice: r.id }); }));
      });
      si.appendChild(rows);
    }
    pane.appendChild(si);

    var sq = el("div", "sec");
    var hq = secHead(t("docs.quote"));
    if (canQuote()) {
      hq.appendChild(el("span", "spacer"));
      var nq = el("button", "link-btn", "+ " + t("act.quote"));
      nq.type = "button";
      nq.addEventListener("click", function () { newQuote(c, null); });
      hq.appendChild(nq);
    }
    sq.appendChild(hq);
    if (!docs.quotes.length) sq.appendChild(el("p", "hint", t("docs.quoteNone")));
    else {
      var qr = el("div", "rows");
      docs.quotes.slice(0, 30).forEach(function (q) {
        qr.appendChild(docRow(q.num || t("act.quote"), [q.date ? fmtDate(q.date) : ""],
          curMoney(Math.round(q.total * 100), q.cur), "qs." + q.status, false,
          function () { var s = shell(); if (s && typeof s.__orosOpenQuote === "function") s.__orosOpenQuote(q.id); }));
      });
      sq.appendChild(qr);
    }
    pane.appendChild(sq);
  }
  function docRow(title, bits, amount, stKey, late, fn) {
    var b = el("button", "row doc-row");
    b.type = "button";
    var main = el("span", "row-main");
    main.appendChild(el("span", "row-title", title));
    var sub = el("span", "row-sub", bits.filter(Boolean).join(" · ") + " · ");
    sub.appendChild(el("span", late ? "late" : "", t(stKey)));
    main.appendChild(sub);
    b.appendChild(main);
    b.appendChild(el("span", "deal-val", amount));
    b.addEventListener("click", fn);
    return b;
  }
  // Dashboard: what CRM customers still owe, per currency (BR-CRM-INV 3).
  function unpaidTotals() {
    var di = invData();
    if (!di || !window.OrosInvoicesCore) return null;
    var out = {}, any = false, today = todayYmd();
    data.cust.forEach(function (c) {
      var tt = window.OrosInvoicesCore.byCrm(di, c.id, today).totals;
      Object.keys(tt).forEach(function (cur) {
        any = true;
        var o = out[cur] || (out[cur] = { open: 0, overdue: 0 });
        o.open += tt[cur].open; o.overdue += tt[cur].overdue;
      });
    });
    return any ? out : null;
  }

  function fupRowEl(f, showCust) {
    var wrap = el("div", "ag-row");
    var chk = el("button", "check");
    chk.type = "button";
    chk.setAttribute("aria-label", t("ag.done") + ": " + f.text);
    chk.title = t("ag.done");
    chk.addEventListener("click", function () { doneFup(f); });
    if (!f.done) wrap.appendChild(chk);
    var b = el("button", "row");
    b.type = "button";
    var main = el("span", "row-main");
    main.appendChild(el("span", "row-title", f.text));
    var c = C.byId(data.cust, f.cust);
    var sub = el("span", "row-sub");
    var when = relDay(f.d) + (f.t ? " " + f.t : "");
    if (f.done) sub.appendChild(document.createTextNode(t("fups.done") + " · " + fmtDate(f.done)));
    else sub.appendChild(el("span", f.d < todayYmd() ? "late" : (f.d === todayYmd() ? "due-today" : ""), when));
    var dealRow = f.deal ? C.byId(data.deals, f.deal) : null;
    var extra = [showCust && c ? c.name : "", dealRow ? dealRow.title : ""].filter(Boolean).join(" · ");
    if (extra) sub.appendChild(document.createTextNode(" · " + extra));
    main.appendChild(sub);
    b.appendChild(main);
    b.addEventListener("click", function () {
      if (showCust) fupMenu(f); else fupEditor(f, f.cust);
    });
    wrap.appendChild(b);
    if (!f.done && !showCust) wrap.appendChild(iconBtn("more", t("aria.more"), function () { fupMenu(f); }, "mini"));
    return wrap;
  }
  function renderCustFups(pane, c, list) {
    addLine(pane, t("fups.add"), function () { fupEditor(null, c.id); });
    var open = list.filter(function (f) { return !f.done; }).sort(function (a, b) {
      return a.d < b.d ? -1 : (a.d > b.d ? 1 : ((a.t || "") < (b.t || "") ? -1 : 1));
    });
    var done = list.filter(function (f) { return f.done; }).sort(function (a, b) { return a.done < b.done ? 1 : -1; });
    if (!open.length && !done.length) { pane.appendChild(el("p", "hint", t("fups.none"))); return; }
    var box = el("div", "rows");
    open.forEach(function (f) { box.appendChild(fupRowEl(f, false)); });
    pane.appendChild(box);
    if (done.length) {
      var det = el("details", "more");
      det.appendChild(el("summary", "", t("fups.done") + " (" + done.length + ")"));
      var db = el("div", "rows");
      done.slice(0, 50).forEach(function (f) { db.appendChild(fupRowEl(f, false)); });
      det.appendChild(db);
      pane.appendChild(det);
    }
  }

  // ---------- 7. Pipeline ----------
  var dragId = "";
  var stagePicked = false;   // phones: the user chose a stage this session
  function renderPipeline() {
    var box = $("view-pipe");
    box.innerHTML = "";
    if (!data.deals.length) {
      var e = el("div", "empty");
      e.appendChild(el("p", "", t("pipe.empty")));
      e.appendChild(txtBtn("plus", t("add.deal"), function () { dealEditor(null, ""); }, "primary"));
      box.appendChild(e);
      return;
    }
    var p = C.pipeline(data), s = C.dashboard(data, Date.now(), todayYmd());
    var st = C.stages(data), ids = st.map(function (x) { return x.id; });
    if (ids.indexOf(prefs.stage) < 0) prefs.stage = ids[0];
    // phones open on the first stage that has deals, until one is picked
    if (!stagePicked && !p[prefs.stage].n) {
      for (var si = 0; si < ids.length; si++) if (p[ids[si]].n) { prefs.stage = ids[si]; break; }
    }
    var isOpenStage = function (id) { return id !== "won" && id !== "lost"; };
    var sum = el("div", "pipe-sum");
    [t("pipe.open", { n: s.openN }), t("pipe.val", { v: money(s.openVal) }), t("pipe.w", { v: money(s.openW) }),
     t("pipe.wonM", { v: money(s.wonMonth) })].forEach(function (x, i) {
      var sp = el("span");
      sp.textContent = x;
      if (i === 0) sp.style.fontWeight = "800";
      sum.appendChild(sp);
    });
    box.appendChild(sum);

    var limit = C.addDays(todayYmd(), -90);
    function stageDeals(stage) {
      var list = data.deals.filter(function (d) { return C.stageOf(data, d, st).id === stage; });
      if (stage === "won" || stage === "lost") {
        list.sort(function (a, b) { return (a.cd || "") < (b.cd || "") ? 1 : -1; });
      } else {
        list.sort(function (a, b) { return b.val - a.val || (a.id < b.id ? -1 : 1); });
      }
      return list;
    }

    // wide: a board with drag and drop
    var board = el("div", "board");
    board.style.gridTemplateColumns = "repeat(" + ids.length + ", minmax(190px, 1fr))";
    ids.forEach(function (stage) {
      var col = el("div", "col");
      col.dataset.stage = stage;
      var head = el("div", "col-head");
      head.appendChild(el("div", "col-name", stageName(stage) + " · " + p[stage].n));
      head.appendChild(el("div", "col-sum", money(p[stage].val) +
        (isOpenStage(stage) ? " · " + t("pipe.w", { v: money(p[stage].wval) }) : "")));
      col.appendChild(head);
      var cards = el("div", "col-cards");
      var list = stageDeals(stage), older = 0;
      list.forEach(function (d) {
        if ((stage === "won" || stage === "lost") && d.cd && d.cd < limit) { older++; return; }
        var card = dealRowEl(d, true);
        card.draggable = true;
        card.addEventListener("dragstart", function (e) {
          dragId = d.id;
          try { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
        });
        card.addEventListener("dragend", function () { dragId = ""; });
        cards.appendChild(card);
      });
      if (older) cards.appendChild(el("div", "more-n", t("pipe.older", { n: older })));
      col.appendChild(cards);
      col.addEventListener("dragover", function (e) { if (dragId) { e.preventDefault(); col.classList.add("drop"); } });
      col.addEventListener("dragleave", function () { col.classList.remove("drop"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("drop");
        var d = C.byId(data.deals, dragId);
        dragId = "";
        if (d && C.stageOf(data, d, st).id !== stage) {
          if (stage === "lost") dealEditor(Object.assign({}, d, { stage: "lost" }), d.cust, true);
          else setStage(d, stage);
        }
      });
      board.appendChild(col);
    });
    box.appendChild(board);

    // narrow: stage chips + a list with "move to stage"
    var chips = el("div", "stage-chips");
    ids.forEach(function (stage) {
      var b = el("button", "chip" + (prefs.stage === stage ? " on" : ""), stageName(stage) + " " + p[stage].n);
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.stage === stage ? "true" : "false");
      b.addEventListener("click", function () { prefs.stage = stage; stagePicked = true; savePrefs(); renderPipeline(); });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    var mob = el("div", "rows mob-list");
    var cur = p[prefs.stage];
    mob.appendChild(el("div", "col-sum", money(cur.val) +
      (isOpenStage(prefs.stage) ? " · " + t("pipe.w", { v: money(cur.wval) }) : "")));
    var ml = stageDeals(prefs.stage);
    if (!ml.length) mob.appendChild(el("p", "hint", t("deals.none")));
    ml.slice(0, LIST_CAP).forEach(function (d) {
      var row = el("div", "deal-row");
      row.appendChild(dealRowEl(d, true));
      row.appendChild(iconBtn("more", t("pipe.move"), function () { stageMenu(d); }, "mini"));
      mob.appendChild(row);
    });
    box.appendChild(mob);
  }

  function stageMenu(d) {
    var dlg = makeDialog("crm-stage");
    dlg.appendChild(el("h2", "dlg-title", t("pipe.move")));
    var list = el("div", "sheet-list");
    var curId = C.stageOf(data, d).id;
    C.stages(data).forEach(function (sx) {
      var stage = sx.id;
      var b = button(stageName(stage), "sheet-btn" + (curId === stage ? " primary" : ""), function () {
        dlg.close();
        if (stage === curId) return;
        if (stage === "lost") dealEditor(Object.assign({}, d, { stage: "lost" }), d.cust, true);
        else setStage(d, stage);
      });
      list.appendChild(b);
    });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 8. Agenda ----------
  function renderAgenda() {
    var box = $("view-agenda");
    box.innerHTML = "";
    var ag = C.agenda(data, todayYmd(), 7);
    if (!ag.late.length && !ag.today.length && !ag.soon.length) {
      var e = el("div", "empty");
      e.appendChild(el("p", "", t("ag.empty")));
      if (data.cust.length) e.appendChild(txtBtn("plus", t("add.fup"), function () { fupEditor(null, ""); }, "primary"));
      box.appendChild(e);
      return;
    }
    [["late", ag.late], ["today", ag.today], ["soon", ag.soon]].forEach(function (g) {
      if (!g[1].length) return;
      var sec = el("section", "ag-sec");
      var h = secHead(t("ag." + g[0]) + " (" + g[1].length + ")");
      if (g[0] === "late") h.firstChild.classList.add("late");
      sec.appendChild(h);
      var rows = el("div", "rows");
      g[1].forEach(function (f) { rows.appendChild(fupRowEl(f, true)); });
      sec.appendChild(rows);
      box.appendChild(sec);
    });
  }

  function fupMenu(f) {
    var c = C.byId(data.cust, f.cust);
    var dlg = makeDialog("crm-fupmenu");
    dlg.appendChild(el("h2", "dlg-title", f.text));
    if (c) dlg.appendChild(el("p", "dlg-sub", c.name + " · " + relDay(f.d) + (f.t ? " " + f.t : "")));
    var list = el("div", "sheet-list");
    function item(icon, label, fn) {
      var b = button("", "sheet-btn", function () { dlg.close(); fn(); });
      b.innerHTML = UI[icon] || "";
      b.appendChild(el("span", "", label));
      list.appendChild(b);
    }
    item("todo", t("ag.done"), function () { doneFup(f); });
    item("clock", t("ag.snooze1"), function () { snooze(f, 1); });
    item("clock", t("ag.snooze7"), function () { snooze(f, 7); });
    item("edit", t("ag.edit"), function () { fupEditor(f, f.cust); });
    if (c) item("users", c.name, function () { selectCust(c.id); });
    if (canTodo()) item("todo", t("ag.todo"), function () { sendToTodo(f); });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 9. Dashboard ----------
  function tile(label, value, sub, fn) {
    var b = el(fn ? "button" : "div", "tile");
    if (fn) { b.type = "button"; b.addEventListener("click", fn); }
    b.appendChild(el("span", "", label));
    b.appendChild(el("span", "tile-val", value));
    if (sub) b.appendChild(el("span", "", sub));
    return b;
  }
  function renderDash() {
    var box = $("view-dash");
    box.innerHTML = "";
    if (!data.cust.length) { box.appendChild(el("div", "empty", t("d.none"))); return; }
    var now = Date.now(), today = todayYmd();
    var s = C.dashboard(data, now, today);
    var tiles = el("div", "tiles");
    tiles.appendChild(tile(t("d.open"), money(s.openVal), t("d.openSub", { n: s.openN, w: money(s.openW) }), function () { setTab("pipe"); }));
    tiles.appendChild(tile(t("d.wonM"), money(s.wonMonth), ""));
    tiles.appendChild(tile(t("d.wonY"), money(s.wonYear), ""));
    tiles.appendChild(tile(t("d.rate"), s.winRate === null ? t("d.rateNone") : s.winRate + "%", t("d.rateSub")));
    tiles.appendChild(tile(t("d.late"), String(s.late), "", function () { setTab("agenda"); }));
    tiles.appendChild(tile(t("d.today"), String(s.today), "", function () { setTab("agenda"); }));
    tiles.appendChild(tile(t("d.forgot"), String(s.forgotten), t("d.forgotSub", { n: data.prefs.forget }), function () {
      prefs.filter = "forgot"; prefs.tag = ""; $("cust-q").value = ""; prefs.sel = ""; setTab("cust");
    }));
    tiles.appendChild(tile(t("d.leads"), String(s.newLeads), t("d.leadsSub"), function () {
      prefs.filter = "lead"; prefs.tag = ""; $("cust-q").value = ""; setTab("cust");
    }));
    var up = unpaidTotals();
    if (up) {
      var curs = Object.keys(up).sort(function (a, b) { return (a === data.prefs.cur ? -1 : 0) - (b === data.prefs.cur ? -1 : 0) || (a < b ? -1 : 1); });
      var od = curs.filter(function (k) { return up[k].overdue > 0; });
      tiles.appendChild(tile(t("d.unpaid"), curs.map(function (k) { return curMoney(up[k].open, k); }).join(" · "),
        od.length ? t("d.unpaidSub", { v: od.map(function (k) { return curMoney(up[k].overdue, k); }).join(" · ") }) : t("d.unpaidNone"),
        function () { openInvoices({}); }));
    }
    box.appendChild(tiles);

    var p = C.pipeline(data), max = 0;
    var openIds = C.stages(data).filter(function (x) { return x.open; }).map(function (x) { return x.id; });
    openIds.forEach(function (st) { if (p[st].val > max) max = p[st].val; });
    var sec = el("section", "sec");
    sec.appendChild(secHead(t("d.byStage")));
    var bars = el("div", "bars");
    openIds.forEach(function (st) {
      var r = el("div", "bar-row");
      r.appendChild(el("span", "", stageName(st)));
      var tr = el("div", "bar-track");
      var fill = el("div", "bar-fill");
      fill.style.width = max ? Math.max(p[st].val ? 2 : 0, Math.round(p[st].val * 100 / max)) + "%" : "0";
      tr.appendChild(fill);
      r.appendChild(tr);
      r.appendChild(el("span", "bar-num", p[st].n + " · " + money(p[st].val)));
      bars.appendChild(r);
    });
    sec.appendChild(bars);
    box.appendChild(sec);

    var sec2 = el("section", "sec");
    sec2.appendChild(secHead(t("d.byStatus")));
    var chips = el("div", "chips");
    C.CUST_ST.forEach(function (st) {
      var b = el("button", "chip", t("st." + st) + " " + s.byStatus[st]);
      b.type = "button";
      b.addEventListener("click", function () { prefs.filter = st; prefs.tag = ""; $("cust-q").value = ""; setTab("cust"); });
      chips.appendChild(b);
    });
    sec2.appendChild(chips);
    box.appendChild(sec2);

    var fg = C.forgotten(data, now);
    if (fg.length) {
      var sec3 = el("section", "sec");
      sec3.appendChild(secHead(t("d.forgotList")));
      var rows = el("div", "rows");
      var last = C.lastContactMap(data);
      fg.slice(0, 5).forEach(function (c) {
        var wrap = el("div", "ag-row");
        var b = el("button", "row");
        b.type = "button";
        var main = el("span", "row-main");
        main.appendChild(el("span", "row-title", c.name));
        main.appendChild(el("span", "row-sub", lastLine(last[c.id])));
        b.appendChild(main);
        b.addEventListener("click", function () { selectCust(c.id); });
        wrap.appendChild(b);
        wrap.appendChild(iconBtn("log", t("act.log"), function () { logEditor(null, c.id); }, "mini"));
        rows.appendChild(wrap);
      });
      sec3.appendChild(rows);
      box.appendChild(sec3);
    }
  }

  // ---------- 10. Editors ----------
  // A label + its input (+ hint). Inside a two-column .fld-row each
  // field gets its own cell.
  function field(parent, label, input, hint) {
    var id = "f" + Math.random().toString(36).slice(2, 9);
    var box = parent;
    if (parent.classList && parent.classList.contains("fld-row")) { box = el("div"); parent.appendChild(box); }
    var lb = el("label", "dlg-lbl", label);
    lb.htmlFor = id;
    input.id = id;
    box.appendChild(lb);
    box.appendChild(input);
    if (hint) box.appendChild(hint);
    return input;
  }
  function inp(type, value, max, ph) {
    var i = el("input");
    i.type = type;
    if (value !== undefined && value !== null) i.value = value;
    if (max) i.maxLength = max;
    if (ph) i.placeholder = ph;
    return i;
  }
  function area(value, max, ph) {
    var a = el("textarea");
    a.value = value || "";
    if (max) a.maxLength = max;
    if (ph) a.placeholder = ph;
    return a;
  }
  function seg(options, value, onChange) {
    var box = el("div", "seg");
    box.setAttribute("role", "radiogroup");
    var cur = value;
    options.forEach(function (o) {
      var b = el("button", o[0] === cur ? "on" : "", o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", o[0] === cur ? "true" : "false");
      b.addEventListener("click", function () {
        cur = o[0];
        Array.prototype.forEach.call(box.children, function (x) { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-checked", "true");
        if (onChange) onChange(cur);
      });
      box.appendChild(b);
    });
    box.value = function () { return cur; };
    return box;
  }
  function selectEl(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function custOptions() {
    return data.cust.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); })
      .map(function (c) { return [c.id, c.name]; });
  }
  function needCustomer() {
    if (data.cust.length) return false;
    showToast(t("ed.needCust"));
    custEditor(null);
    return true;
  }
  function errorHint(dlg) {
    var h = el("p", "hint warn");
    h.hidden = true;
    h.setAttribute("role", "alert");
    return h;
  }
  function actions(dlg, onSave, onDelete) {
    var acts = el("div", "dlg-actions");
    if (onDelete) acts.appendChild(button(t("ed.delete"), "danger", onDelete));
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", onSave));
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(); }
    });
  }

  // ----- Customer -----
  function custEditor(c, pre) {
    var dlg = makeDialog("crm-cust", true);
    var x = c ? Object.assign({}, c) : Object.assign({ kind: "co", st: "lead" }, pre && pre.fill);
    dlg.appendChild(el("h2", "dlg-title", t(c ? "ed.custEdit" : "ed.custNew")));
    var name;
    var kind = seg([["co", t("kind.co")], ["person", t("kind.person")]], x.kind, function (v) {
      name.placeholder = t("ed.namePh." + v);
    });
    dlg.appendChild(el("span", "dlg-lbl", t("ed.kind")));
    dlg.appendChild(kind);
    name = field(dlg, t("ed.name"), inp("text", x.name, 120, t("ed.namePh." + x.kind)));
    var nameErr = errorHint(dlg);
    dlg.appendChild(nameErr);
    var alias = field(dlg, t("ed.alias"), inp("text", x.alias, 80));
    dlg.appendChild(el("span", "dlg-lbl", t("ed.status")));
    var st = seg(C.CUST_ST.map(function (s) { return [s, t("st." + s)]; }), x.st);
    dlg.appendChild(st);
    var starRow = el("label", "check-row");
    var star = el("input"); star.type = "checkbox"; star.checked = !!x.star;
    starRow.appendChild(star); starRow.appendChild(el("span", "", t("ed.star")));
    dlg.appendChild(starRow);

    // tags
    var chosen = (x.tags || []).slice();
    var tagBox = el("div", "checks");
    function drawTags() {
      tagBox.innerHTML = "";
      data.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); }).forEach(function (tg) {
        var on = chosen.indexOf(tg.id) >= 0;
        var b = el("button", "chip" + (on ? " on" : ""));
        b.type = "button";
        var dot = el("span", "dot"); dot.style.background = COLORS[tg.col];
        b.appendChild(dot); b.appendChild(el("span", "", tg.name));
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.addEventListener("click", function () {
          var i = chosen.indexOf(tg.id);
          if (i >= 0) chosen.splice(i, 1); else if (chosen.length < C.LIMITS.custTags) chosen.push(tg.id);
          drawTags();
        });
        tagBox.appendChild(b);
      });
      var mg = el("button", "link-btn", t("ed.tagsManage"));
      mg.type = "button";
      mg.addEventListener("click", function () { tagManager(drawTags); });
      tagBox.appendChild(mg);
    }
    drawTags();
    dlg.appendChild(el("span", "dlg-lbl", t("ed.tags")));
    dlg.appendChild(tagBox);

    var bill = el("details", "more");
    bill.open = !!(x.afm || x.doy || x.job || !c);
    bill.appendChild(el("summary", "", t("ed.billing")));
    dlg.appendChild(bill);
    var afmHint = el("p", "hint");
    var afm = field(bill, t("ed.afm"), inp("text", x.afm, 20), afmHint);
    afm.inputMode = "numeric";
    var doy = field(bill, t("ed.doy"), inp("text", x.doy, 60));
    var job = field(bill, t("ed.job"), inp("text", x.job, 80));
    var addr = field(bill, t("ed.addr"), inp("text", x.addr, 200));
    var country = field(bill, t("ed.country"), inp("text", x.country, 60));
    function checkAfm() {
      var v = afm.value.replace(/\s+/g, "");
      afmHint.textContent = "";
      afmHint.className = "hint";
      if (!v) return;
      var other = data.cust.filter(function (o) { return o.afm && o.afm === v && (!c || o.id !== c.id); })[0];
      var isGr = !country.value.trim() || /^(gr|greece|ελλάδα|ελλαδα|hellas)$/i.test(country.value.trim());
      var msgs = [];
      if (isGr && /^\d{9}$/.test(v.replace(/^(EL|GR)/i, ""))) {
        var ok = C.validAfm(v);
        msgs.push(t(ok ? "afm.ok" : "afm.bad"));
        afmHint.className = ok && !other ? "hint ok" : "hint warn";
      }
      if (other) { msgs.push(t("ed.dupAfm", { name: other.name })); afmHint.className = "hint warn"; }
      afmHint.textContent = msgs.join(" · ");
    }
    afm.addEventListener("input", checkAfm);
    country.addEventListener("input", checkAfm);
    checkAfm();

    var cd = el("details", "more");
    cd.open = !!(x.phone || x.email || x.web || !c);
    cd.appendChild(el("summary", "", t("ed.contact")));
    dlg.appendChild(cd);
    var phone = field(cd, t("ed.phone"), inp("tel", x.phone, 40));
    var email = field(cd, t("ed.email"), inp("email", x.email, 120));
    var web = field(cd, t("ed.web"), inp("url", x.web, 300));
    var srcList = el("datalist");
    srcList.id = "crm-src-list";
    var seen = {};
    data.cust.forEach(function (o) { if (o.src && !seen[o.src]) { seen[o.src] = 1; var op = el("option"); op.value = o.src; srcList.appendChild(op); } });
    var src = field(cd, t("ed.src"), inp("text", x.src, 60, t("ed.srcPh")));
    src.setAttribute("list", "crm-src-list");
    cd.appendChild(srcList);
    var note = field(dlg, t("ed.notes"), area(x.note, 2000));

    function save() {
      var nm = C.cleanText(name.value, 120);
      if (!nm) { nameErr.textContent = t("ed.nameReq"); nameErr.hidden = false; name.focus(); return; }
      var row = Object.assign({}, c || { id: C.newId(Date.now()), ct: Date.now() }, {
        name: nm, kind: kind.value(), st: st.value(), alias: alias.value, afm: afm.value, doy: doy.value, job: job.value,
        addr: addr.value, country: country.value, phone: phone.value, email: email.value, web: web.value, src: src.value,
        note: note.value, tags: chosen.filter(function (id) { return !!tagOf(id); })
      });
      if (star.checked) row.star = 1; else delete row.star;
      dlg.close();
      var saved = upsert("cust", row);
      if (saved && !c) { prefs.sel = saved.id; prefs.sub = "hist"; savePrefs(); if (prefs.tab !== "cust") setTab("cust"); else render(); }
      if (saved && !c && pre && pre.then) pre.then(saved);
    }
    actions(dlg, save, c ? function () {
      confirmDialog(t("confirm.cust", { name: c.name }), t("ed.delete"), true, function () { dlg.close(); removeCustomer(c); });
    } : null);
    name.addEventListener("input", function () {
      nameErr.hidden = true;
      var v = C.fold(name.value.trim());
      var dup = v && data.cust.some(function (o) { return C.fold(o.name) === v && (!c || o.id !== c.id); });
      if (dup) { nameErr.textContent = t("ed.dupName"); nameErr.hidden = false; }
    });
    showDialog(dlg);
    name.focus();
  }

  // ----- Person (index -1 = new) -----
  function personEditor(c, idx) {
    var p = idx >= 0 && c.people && c.people[idx] ? Object.assign({}, c.people[idx]) : { c: "", n: "" };
    var dlg = makeDialog("crm-person", true);
    dlg.appendChild(el("h2", "dlg-title", t(idx >= 0 ? "ed.personEdit" : "ed.personNew")));
    var linkLine = el("p", "dlg-sub");
    dlg.appendChild(linkLine);

    var pickWrap = el("div");
    dlg.appendChild(pickWrap);
    var name, phone, email;
    function drawLink() {
      linkLine.innerHTML = "";
      var ct = p.c ? contacts().map[p.c] : null;
      if (p.c) {
        linkLine.appendChild(document.createTextNode(ct ? t("ed.linked", { name: ct.name }) + " " : t("people.gone") + " "));
        var ul = el("button", "link-btn", t("ed.unlink"));
        ul.type = "button";
        ul.addEventListener("click", function () {
          if (ct) { name.value = ct.name; phone.value = ct.phone; email.value = ct.email; }
          p.c = "";
          drawLink();
        });
        linkLine.appendChild(ul);
        if (ct) {
          linkLine.appendChild(document.createTextNode(" · "));
          var op = el("button", "link-btn", t("people.open"));
          op.type = "button";
          op.addEventListener("click", function () { dlg.close(); openContact(p.c); });
          linkLine.appendChild(op);
        }
      }
      own.hidden = !!p.c;
      pickWrap.hidden = !!p.c;
    }

    // contact picker
    pickWrap.appendChild(el("span", "dlg-lbl", t("ed.fromContacts")));
    var q = inp("search", "", 60, t("ed.searchContacts"));
    q.setAttribute("aria-label", t("ed.searchContacts"));
    pickWrap.appendChild(q);
    var list = el("div", "pick-list");
    pickWrap.appendChild(list);
    function drawPick() {
      list.innerHTML = "";
      var f = C.fold(q.value.trim()), n = 0;
      var cs = contacts().list.filter(function (x) {
        return !f || C.fold(x.name + " " + x.org + " " + x.phone + " " + x.email).indexOf(f) >= 0;
      });
      cs.slice(0, 30).forEach(function (x) {
        var b = el("button", "row");
        b.type = "button";
        var main = el("span", "row-main");
        main.appendChild(el("span", "row-title", x.name));
        var sub = [x.org, x.phone, x.email].filter(Boolean).join(" · ");
        if (sub) main.appendChild(el("span", "row-sub", sub));
        b.appendChild(main);
        b.addEventListener("click", function () { p.c = x.id; p.n = x.name; drawLink(); });
        list.appendChild(b);
        n++;
      });
      if (!n) list.appendChild(el("p", "hint", t("ed.noContacts")));
    }
    q.addEventListener("input", drawPick);
    drawPick();

    var own = el("div");
    dlg.appendChild(own);
    own.appendChild(el("span", "dlg-lbl", t("ed.byName")));
    name = inp("text", p.c ? "" : p.n, 80);
    name.setAttribute("aria-label", t("ed.name"));
    own.appendChild(name);
    phone = field(own, t("ed.phone"), inp("tel", p.phone, 40));
    email = field(own, t("ed.email"), inp("email", p.email, 120));
    var role = field(dlg, t("ed.role"), inp("text", p.role, 60, t("ed.rolePh")));
    var err = errorHint(dlg);
    dlg.appendChild(err);
    drawLink();

    if (canAddContact()) {
      var addC = el("button", "link-btn", t("ed.toContacts"));
      addC.type = "button";
      var addHint = el("p", "hint", t("ed.toContactsHint"));
      function syncAdd() {
        var ok = !p.c && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) && !!name.value.trim();
        addC.hidden = !ok; addHint.hidden = !ok;
      }
      addC.addEventListener("click", function () { addToContacts(name.value.trim(), email.value.trim()); });
      email.addEventListener("input", syncAdd);
      name.addEventListener("input", syncAdd);
      own.appendChild(addC);
      own.appendChild(addHint);
      syncAdd();
    }

    function save() {
      var row = { c: p.c, n: p.c ? (contacts().map[p.c] ? contacts().map[p.c].name : p.n) : C.cleanText(name.value, 80), role: role.value };
      if (!row.c) { row.phone = phone.value; row.email = email.value; }
      if (!row.c && !row.n) { err.textContent = t("ed.nameReq"); err.hidden = false; return; }
      var cur = C.byId(data.cust, c.id);
      if (!cur) { dlg.close(); return; }
      var people = (cur.people || []).slice();
      if (idx >= 0 && idx < people.length) people[idx] = row; else people.push(row);
      dlg.close();
      upsert("cust", Object.assign({}, cur, { people: people }));
    }
    actions(dlg, save, idx >= 0 ? function () {
      var cur = C.byId(data.cust, c.id);
      if (!cur) { dlg.close(); return; }
      var people = (cur.people || []).slice();
      people.splice(idx, 1);
      dlg.close();
      var prev = Object.assign({}, cur);
      if (upsert("cust", Object.assign({}, cur, { people: people }))) {
        undoToast(t("toast.deleted"), function () {
          var now = C.byId(data.cust, c.id);
          if (now) upsert("cust", Object.assign({}, now, { people: prev.people }));
        });
      }
    } : null);
    showDialog(dlg);
    (p.c ? role : q).focus();
  }

  // ----- Deal (lostMode: opened by a move to "Lost", asks why) -----
  function dealEditor(d, custId, lostMode) {
    if (!d && needCustomer()) return;
    var dlg = makeDialog("crm-deal", true);
    var orig = d ? C.byId(data.deals, d.id) : null;
    var x = d ? Object.assign({}, d) : { cust: custId || prefs.sel || "", stage: C.stages(data)[0].id, val: 0 };
    x.stage = C.stageOf(data, x).id;
    dlg.appendChild(el("h2", "dlg-title", t(orig ? "ed.dealEdit" : "ed.dealNew")));
    var opts = custOptions();
    if (!C.byId(data.cust, x.cust)) x.cust = opts[0][0];
    var cust = field(dlg, t("ed.cust"), selectEl(opts, x.cust));
    var title = field(dlg, t("ed.title"), inp("text", x.title, 120, t("ed.titlePh")));
    var err = errorHint(dlg);
    dlg.appendChild(err);
    var row1 = el("div", "fld-row");
    dlg.appendChild(row1);
    var val = field(row1, t("ed.value", { c: data.prefs.cur }), inp("text", x.val ? (x.val / 100).toLocaleString(LOCALE) : "", 20));
    val.inputMode = "decimal";
    var stage = field(row1, t("ed.stage"), selectEl(C.stages(data).map(function (s) { return [s.id, stageName(s.id)]; }), x.stage));
    var row2 = el("div", "fld-row");
    dlg.appendChild(row2);
    var prob = field(row2, t("ed.prob"), inp("number", typeof x.prob === "number" ? x.prob : "", 3, ""));
    prob.min = 0; prob.max = 100; prob.step = 1;
    var close = field(row2, t("ed.closeDay"), inp("date", x.close || "", 10));
    var whyLbl = el("label", "dlg-lbl", t("ed.why"));
    var why = inp("text", x.why, 200);
    whyLbl.htmlFor = why.id = "crm-why";
    dlg.appendChild(whyLbl);
    dlg.appendChild(why);
    function syncStage() {
      prob.placeholder = t("ed.probPh", { p: stageObj(stage.value).prob });
      var lost = stage.value === "lost";
      whyLbl.hidden = !lost; why.hidden = !lost;
    }
    stage.addEventListener("change", syncStage);
    syncStage();
    var note = field(dlg, t("ed.notes"), area(x.note, 2000));
    // Saved deals: hand it to Invoices (won) or Quote (open or won)
    var oc = orig ? C.byId(data.cust, orig.cust) : null;
    if (oc && (canInvoice() || canQuote())) {
      var links = el("div", "c-actions deal-docs");
      if (canInvoice() && orig.stage === "won") links.appendChild(txtBtn("doc", t("deal.inv"), function () { dlg.close(); newInvoice(oc, orig); }));
      if (canQuote() && orig.stage !== "lost") links.appendChild(txtBtn("doc", t("deal.quote"), function () { dlg.close(); newQuote(oc, orig); }));
      if (links.childNodes.length) dlg.appendChild(links);
    }

    function save() {
      var tt = C.cleanText(title.value, 120);
      if (!tt) { err.textContent = t("ed.titleReq"); err.hidden = false; title.focus(); return; }
      var cents = val.value.trim() ? C.parseMoney(val.value) : 0;
      if (cents === null) { err.textContent = t("ed.valBad"); err.hidden = false; val.focus(); return; }
      var pv = prob.value.trim() === "" ? null : Math.round(Number(prob.value));
      var row = Object.assign({}, orig || { id: C.newId(Date.now()), ct: Date.now() }, {
        cust: cust.value, title: tt, val: cents, stage: stage.value, close: close.value || "",
        why: stage.value === "lost" ? why.value : "", note: note.value
      });
      if (pv === null || !(pv >= 0 && pv <= 100)) delete row.prob; else row.prob = pv;
      if (!row.close) delete row.close;
      var closed = row.stage === "won" || row.stage === "lost";
      if (closed && (!orig || orig.stage !== row.stage || !orig.cd)) row.cd = todayYmd();
      if (!closed) delete row.cd;
      dlg.close();
      upsert("deals", row);
    }
    actions(dlg, save, orig ? function () {
      dlg.close();
      removeRow("deals", orig.id);
    } : null);
    showDialog(dlg);
    if (lostMode) why.focus(); else if (orig) title.focus(); else title.focus();
  }

  // ----- Contact log -----
  function logEditor(a, custId, pre) {
    if (!a && !custId && needCustomer()) return;
    var dlg = makeDialog("crm-log", true);
    var x = a ? Object.assign({}, a) : { cust: custId || prefs.sel || "", k: (pre && pre.k) || "call", at: (pre && pre.at) || Date.now(),
                                         text: (pre && pre.text) || "", deal: (pre && pre.deal) || "", who: (pre && pre.who) || "" };
    dlg.appendChild(el("h2", "dlg-title", t(a ? "ed.logEdit" : "ed.logNew")));
    var opts = custOptions();
    if (!C.byId(data.cust, x.cust)) x.cust = opts[0][0];
    var cust = field(dlg, t("ed.cust"), selectEl(opts, x.cust));
    dlg.appendChild(el("span", "dlg-lbl", t("ed.kind")));
    var kind = seg(C.ACT_KINDS.map(function (k) { return [k, t("k." + k)]; }), x.k);
    dlg.appendChild(kind);
    var when = new Date(x.at);
    var row = el("div", "fld-row");
    dlg.appendChild(row);
    var date = field(row, t("ed.date"), inp("date", C.ymdOf(x.at), 10));
    var time = field(row, t("ed.time"), inp("time", pad(when.getHours()) + ":" + pad(when.getMinutes()), 5));
    var who = field(dlg, t("ed.who"), el("select"));
    var deal = field(dlg, t("ed.deal"), el("select"));
    function fillFor(cid) {
      var c = C.byId(data.cust, cid);
      who.innerHTML = "";
      var o0 = el("option", "", t("ed.whoNone")); o0.value = ""; who.appendChild(o0);
      var names = (c && c.people || []).map(function (p) { return personView(p).name; });
      if (x.who && names.indexOf(x.who) < 0) names.unshift(x.who);
      names.forEach(function (n) { var o = el("option", "", n); o.value = n; who.appendChild(o); });
      who.value = x.who || "";
      deal.innerHTML = "";
      var d0 = el("option", "", t("ed.dealNone")); d0.value = ""; deal.appendChild(d0);
      data.deals.filter(function (d) { return d.cust === cid && (C.isOpen(d) || d.id === x.deal); }).forEach(function (d) {
        var o = el("option", "", d.title); o.value = d.id; deal.appendChild(o);
      });
      deal.value = C.byId(data.deals, x.deal) && C.byId(data.deals, x.deal).cust === cid ? x.deal : "";
    }
    cust.addEventListener("change", function () { x.who = ""; x.deal = ""; fillFor(cust.value); });
    fillFor(x.cust);
    var text = field(dlg, t("ed.text"), area(x.text, 2000));
    var next = null, nextText = null;
    if (!a) {
      dlg.appendChild(el("span", "dlg-lbl", t("ed.next")));
      next = seg([["0", t("ed.nextNone")], ["3", t("ed.next3")], ["7", t("ed.next7")], ["14", t("ed.next14")]], "0", function (v) {
        nextText.hidden = v === "0";
      });
      dlg.appendChild(next);
      nextText = inp("text", "", 300, t("ed.fupPh"));
      nextText.setAttribute("aria-label", t("ed.fupText"));
      nextText.style.marginTop = "6px";
      nextText.hidden = true;
      dlg.appendChild(nextText);
    }

    function save() {
      var at = Date.now();
      if (C.isYmd(date.value)) {
        var p = date.value.split("-"), hm = C.HM_RE.test(time.value) ? time.value.split(":") : ["12", "00"];
        at = new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1]).getTime();
      }
      var r = Object.assign({}, a || { id: C.newId(Date.now()) }, {
        cust: cust.value, k: kind.value(), at: at, text: text.value, who: who.value, deal: deal.value
      });
      if (!r.deal) delete r.deal;
      if (!r.who) delete r.who;
      dlg.close();
      var saved = upsert("acts", r);
      if (saved && next && next.value() !== "0") {
        var nt = C.cleanText(nextText.value, 300) || t("ed.nextText");
        var f = { id: C.newId(Date.now()), cust: r.cust, d: C.addDays(todayYmd(), +next.value()), text: nt };
        if (r.deal) f.deal = r.deal;
        upsert("fups", f);
      }
      if (saved && !a) showToast(t("toast.logged"));
    }
    actions(dlg, save, a ? function () { dlg.close(); removeRow("acts", a.id); } : null);
    showDialog(dlg);
    text.focus();
  }

  // ----- Follow-up -----
  function fupEditor(f, custId) {
    if (!f && !custId && needCustomer()) return;
    var dlg = makeDialog("crm-fup", true);
    var x = f ? Object.assign({}, f) : { cust: custId || prefs.sel || "", d: C.addDays(todayYmd(), 1), text: "" };
    dlg.appendChild(el("h2", "dlg-title", t(f ? "ed.fupEdit" : "ed.fupNew")));
    var opts = custOptions();
    if (!C.byId(data.cust, x.cust)) x.cust = opts[0][0];
    var cust = field(dlg, t("ed.cust"), selectEl(opts, x.cust));
    var text = field(dlg, t("ed.fupText"), inp("text", x.text, 300, t("ed.fupPh")));
    var err = errorHint(dlg);
    dlg.appendChild(err);
    var row = el("div", "fld-row");
    dlg.appendChild(row);
    var date = field(row, t("ed.date"), inp("date", x.d, 10));
    var time = field(row, t("ed.timeOpt"), inp("time", x.t || "", 5));
    var deal = field(dlg, t("ed.deal"), el("select"));
    function fillDeals(cid) {
      deal.innerHTML = "";
      var d0 = el("option", "", t("ed.dealNone")); d0.value = ""; deal.appendChild(d0);
      data.deals.filter(function (d) { return d.cust === cid && (C.isOpen(d) || d.id === x.deal); }).forEach(function (d) {
        var o = el("option", "", d.title); o.value = d.id; deal.appendChild(o);
      });
      deal.value = x.deal && C.byId(data.deals, x.deal) && C.byId(data.deals, x.deal).cust === cid ? x.deal : "";
    }
    cust.addEventListener("change", function () { x.deal = ""; fillDeals(cust.value); });
    fillDeals(x.cust);
    var doneRow = null, done = null;
    if (f) {
      doneRow = el("label", "check-row");
      done = el("input"); done.type = "checkbox"; done.checked = !!f.done;
      doneRow.appendChild(done); doneRow.appendChild(el("span", "", t("ed.fupDone")));
      dlg.appendChild(doneRow);
    }
    if (f && canTodo()) {
      var td = el("button", "link-btn", t("ag.todo"));
      td.type = "button";
      td.style.marginTop = "8px";
      td.addEventListener("click", function () { sendToTodo(f); });
      dlg.appendChild(td);
    }

    function save() {
      var tx = C.cleanText(text.value, 300);
      if (!tx) { err.textContent = t("ed.textReq"); err.hidden = false; text.focus(); return; }
      var r = Object.assign({}, f || { id: C.newId(Date.now()) }, {
        cust: cust.value, text: tx, d: C.isYmd(date.value) ? date.value : todayYmd(),
        t: C.HM_RE.test(time.value) ? time.value : "", deal: deal.value
      });
      if (!r.t) delete r.t;
      if (!r.deal) delete r.deal;
      if (done) {
        if (done.checked && !r.done) r.done = todayYmd();
        if (!done.checked) delete r.done;
      }
      dlg.close();
      upsert("fups", r);
    }
    actions(dlg, save, f ? function () { dlg.close(); removeRow("fups", f.id); } : null);
    showDialog(dlg);
    text.focus();
  }

  // ---------- 11. Settings, tags, export / import ----------
  function settings() {
    var dlg = makeDialog("crm-settings", true);
    dlg.appendChild(el("h2", "dlg-title", t("set.title")));
    var cur = field(dlg, t("set.cur"), selectEl(C.CURRENCIES.map(function (c) { return [c, c]; }), data.prefs.cur));
    var forget = field(dlg, t("set.forget"), selectEl([14, 30, 60, 90, 180].map(function (n) {
      return [String(n), t("set.days", { n: n })];
    }), String(data.prefs.forget)));
    if (!forget.value) forget.value = "30";
    function savePrefsData() {
      var p = { pm: stamp({ m: data.prefs.pm }), cur: cur.value, forget: +forget.value };
      data.prefs = C.normPrefs(p);
      commit();
    }
    cur.addEventListener("change", savePrefsData);
    forget.addEventListener("change", savePrefsData);

    var list = el("div", "sheet-list");
    list.style.marginTop = "16px";
    list.appendChild(button(t("set.stages"), "sheet-btn", stagesEditor));
    list.appendChild(button(t("set.tags"), "sheet-btn", function () { tagManager(null); }));
    list.appendChild(button(t("set.import"), "sheet-btn", function () { dlg.close(); importCsv(); }));
    list.appendChild(button(t("en.all"), "sheet-btn", function () { dlg.close(); enrichOpen(data.cust); }));
    if (PL && PL.has()) list.appendChild(button(PL.label(), "sheet-btn", function () { dlg.close(); PL.open(); }));
    if (WF) list.appendChild(button(WF.label(), "sheet-btn", function () { dlg.close(); WF.open(); }));
    list.appendChild(button(t("set.export"), "sheet-btn", exportCsv));
    if (canSheet()) list.appendChild(button(t("set.sheet"), "sheet-btn", function () { dlg.close(); openInSheet(); }));
    list.appendChild(button(t("set.backup"), "sheet-btn", exportJson));
    list.appendChild(button(t("set.restore"), "sheet-btn", function () { dlg.close(); importJson(); }));
    // .oroscrm: Save keeps the dialog open (like Export CSV); Open and
    // the folder close it first, since they change the data
    if (recFile) {
      [["crm-osave", "set.osave", false, function () { recFile.save(); }],
       ["crm-oopen", "set.oopen", true, function () { recFile.open(); }],
       ["crm-ofolder", "set.ofolder", true, function () { recFile.openFolder(); }]].forEach(function (o) {
        var b = button(t(o[1]), "sheet-btn", function () { if (o[2]) dlg.close(); o[3](); });
        b.id = o[0];
        list.appendChild(b);
      });
    }
    dlg.appendChild(list);
    dlg.appendChild(el("p", "hint", t("set.restoreHint")));
    var raw = "";
    try { raw = localStorage.getItem(STORAGE_KEY) || ""; } catch (e) {}
    dlg.appendChild(el("p", "usage", t("set.usage", { kb: Math.max(1, Math.round(raw.length * 2 / 1024)) })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ----- Pipeline stages -----
  // The open stages in board order: rename, default probability, up /
  // down, hide (built-in) or delete (own), only when no deal is in it.
  // Won and Lost stay fixed. Every change is one "stg" record (LWW).
  function stagesEditor() {
    var dlg = makeDialog("crm-stages");
    dlg.appendChild(el("h2", "dlg-title", t("stg.title")));
    dlg.appendChild(el("p", "hint", t("stg.hint")));
    var box = el("div", "rows");
    dlg.appendChild(box);
    var hid = el("div", "stg-hidden");
    dlg.appendChild(hid);
    function write(id, patch) {
      var row = Object.assign({}, C.byId(data.stg, id) || { id: id }, patch);
      if (!row.off) delete row.off;
      return upsert("stg", row);
    }
    function inStage(id) {
      return data.deals.filter(function (d) { return C.stageOf(data, d).id === id; }).length;
    }
    function draw() {
      box.innerHTML = "";
      hid.innerHTML = "";
      var open = C.stages(data).filter(function (x) { return x.open; });
      function move(i, j) {
        var ids = open.map(function (x) { return x.id; });
        var a = ids[i]; ids[i] = ids[j]; ids[j] = a;
        ids.forEach(function (id, k) {
          var want = (k + 1) * 10, sx = open.filter(function (x) { return x.id === id; })[0];
          if (sx.pos !== want) write(id, { pos: want });
        });
        draw();
      }
      open.forEach(function (sx, i) {
        var label = sx.name || t("stage." + sx.id);
        var r = el("div", "stg-row");
        var nm = inp("text", sx.name, 30, sx.own ? "" : t("stage." + sx.id));
        nm.setAttribute("aria-label", t("stg.name"));
        nm.addEventListener("change", function () {
          var v = C.cleanText(nm.value, 30);
          if ((sx.own && !v) || v === sx.name) { draw(); return; }
          write(sx.id, { name: v });
          draw();
        });
        r.appendChild(nm);
        var pr = inp("number", String(sx.prob), 3, "");
        pr.min = 0; pr.max = 100; pr.step = 1;
        pr.classList.add("stg-prob");
        pr.setAttribute("aria-label", t("stg.prob"));
        pr.addEventListener("change", function () {
          var v = Math.round(Number(pr.value));
          if (pr.value.trim() !== "" && v >= 0 && v <= 100 && v !== sx.prob) write(sx.id, { prob: v });
          draw();
        });
        r.appendChild(pr);
        var up = iconBtn("up", t("stg.up"), function () { move(i, i - 1); }, "mini");
        up.disabled = i === 0;
        r.appendChild(up);
        var dn = iconBtn("down", t("stg.down"), function () { move(i, i + 1); }, "mini");
        dn.disabled = i === open.length - 1;
        r.appendChild(dn);
        r.appendChild(iconBtn("x", t(sx.own ? "stg.del" : "stg.hide") + ": " + label, function () {
          var n = inStage(sx.id);
          if (n) { showToast(t("stg.notEmpty", { name: label, n: n })); return; }
          if (open.length < 2) { showToast(t("stg.last")); return; }
          if (sx.own) removeRow("stg", sx.id, t("stg.deleted", { name: label }));
          else if (write(sx.id, { off: 1 })) undoToast(t("stg.hidden", { name: label }), function () { write(sx.id, { off: 0 }); });
          draw();
        }, "mini"));
        box.appendChild(r);
      });
      var hidden = C.OPEN_STAGES.filter(function (id) { var r = C.byId(data.stg, id); return r && r.off; });
      if (hidden.length) {
        hid.appendChild(el("div", "dlg-lbl", t("stg.hiddenHead")));
        hidden.forEach(function (id) {
          var r = C.byId(data.stg, id);
          hid.appendChild(button(t("stg.show", { name: r.name || t("stage." + id) }), "", function () {
            if (open.length >= C.LIMITS.openStages) { showToast(t("stg.max", { n: C.LIMITS.openStages })); return; }
            write(id, { off: 0 });
            draw();
          }));
        });
      }
      addRow.hidden = open.length >= C.LIMITS.openStages;
      maxNote.hidden = !addRow.hidden;
    }
    var addRow = el("div", "list-tools");
    addRow.style.marginTop = "12px";
    var nn = inp("text", "", 30, t("stg.newPh"));
    nn.setAttribute("aria-label", t("stg.newPh"));
    addRow.appendChild(nn);
    var ab = button(t("stg.add"), "primary", function () {
      var v = C.cleanText(nn.value, 30);
      if (!v) { nn.focus(); return; }
      var open = C.stages(data).filter(function (x) { return x.open; });
      if (open.length >= C.LIMITS.openStages) return;
      var pos = open.reduce(function (mx, x) { return Math.max(mx, x.pos); }, 0) + 10;
      upsert("stg", { id: C.newId(Date.now()), name: v, prob: 50, pos: pos });
      nn.value = "";
      draw();
      nn.focus();
    });
    ab.style.flex = "0 0 auto";
    addRow.appendChild(ab);
    nn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ab.click(); } });
    dlg.appendChild(addRow);
    var maxNote = el("p", "hint", t("stg.max", { n: C.LIMITS.openStages }));
    dlg.appendChild(maxNote);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    draw();
    showDialog(dlg);
  }

  function tagManager(onDone) {
    var dlg = makeDialog("crm-tags");
    dlg.appendChild(el("h2", "dlg-title", t("tags.title")));
    var box = el("div", "rows");
    dlg.appendChild(box);
    function draw() {
      box.innerHTML = "";
      if (!data.tags.length) box.appendChild(el("p", "hint", t("tags.none")));
      data.tags.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); }).forEach(function (tg) {
        var r = el("div", "ag-row");
        var dot = el("button", "col-btn");
        dot.type = "button";
        dot.style.background = COLORS[tg.col];
        dot.setAttribute("aria-label", tg.name);
        dot.addEventListener("click", function () {
          upsert("tags", Object.assign({}, tg, { col: (tg.col + 1) % COLORS.length }));
          draw();
        });
        r.appendChild(dot);
        var nm = inp("text", tg.name, 30);
        nm.setAttribute("aria-label", tg.name);
        nm.addEventListener("change", function () {
          var v = C.cleanText(nm.value, 30);
          if (v && v !== tg.name) upsert("tags", Object.assign({}, tg, { name: v }));
          draw();
        });
        r.appendChild(nm);
        r.appendChild(iconBtn("x", t("aria.remove"), function () {
          confirmDialog(t("tags.del", { name: tg.name }), t("ed.delete"), true, function () {
            data.cust.forEach(function (c, i) {
              if (c.tags && c.tags.indexOf(tg.id) >= 0) {
                var r2 = Object.assign({}, c, { tags: c.tags.filter(function (x) { return x !== tg.id; }) });
                r2.m = stamp(c);
                data.cust[i] = r2;
              }
            });
            tomb(tg.id);
            commit();
            draw();
          });
        }, "mini"));
        box.appendChild(r);
      });
    }
    draw();
    var add = el("div", "list-tools");
    add.style.marginTop = "12px";
    var nn = inp("text", "", 30, t("tags.namePh"));
    nn.setAttribute("aria-label", t("tags.new"));
    add.appendChild(nn);
    var ab = button(t("tags.add"), "primary", function () {
      var v = C.cleanText(nn.value, 30);
      if (!v) { nn.focus(); return; }
      if (data.tags.length >= C.LIMITS.tags) return;
      upsert("tags", { id: C.newId(Date.now()), name: v, col: data.tags.length % COLORS.length });
      nn.value = "";
      draw();
      nn.focus();
    });
    ab.style.flex = "0 0 auto";
    add.appendChild(ab);
    nn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ab.click(); } });
    dlg.appendChild(add);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { if (onDone) onDone(); });
    showDialog(dlg);
  }

  function dialogHost() {
    try { return (window.parent && window.parent.orosDialog) || window.orosDialog || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function stampName() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function saveBlob(blob, filename, mime, desc, ext) {
    var dlg = dialogHost();
    var acc = {}; acc[mime] = [ext];
    if (dlg && typeof dlg.saveFile === "function") {
      Promise.resolve(dlg.saveFile({ blob: blob, filename: filename, mime: mime, types: [{ description: desc, accept: acc }] }))
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported", { name: r.name || filename })); })
        .catch(function () {});
      return;
    }
    // standalone run (no shell): plain download
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportCsv() {
    var csv = "﻿" + C.csvRows(data, LANG).map(function (r) { return r.map(C.csvCell).join(";"); }).join("\r\n") + "\r\n";
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "crm-" + stampName() + ".csv", "text/csv", "CSV", ".csv");
  }
  // "Open in Spreadsheet" (Bible BR-S1): the customers CSV as a new
  // sheet in the orOS Spreadsheet, open deals and open value as
  // numbers with a SUM under them. Offered only inside orOS.
  var SHEET_ROWS = 498;   // + heading + SUM row = the Spreadsheet's 500
  function canSheet() { var s = shell(); return !!(s && typeof s.__orosOpenAt === "function"); }
  function openInSheet() {
    var s = shell();
    if (!s || typeof s.__orosOpenAt !== "function") return;
    var rows = C.csvRows(data, LANG), head = rows.shift();
    if (!rows.length) return;
    if (rows.length > SHEET_ROWS) { showToast(t("set.sheetCap", { n: SHEET_ROWS })); rows = rows.slice(0, SHEET_ROWS); }
    rows.forEach(function (r) { r[16] = Number(r[16]); });   // "12.50" → 12.5
    s.__orosOpenAt("spreadsheet", { newSheet: { name: t("app") + " " + stampName(), rows: [head].concat(rows), sum: [15, 16] } });
  }
  function exportJson() {
    var json = JSON.stringify(C.backup(data), null, 1);
    saveBlob(new Blob([json], { type: "application/json" }), "crm-backup-" + stampName() + ".json", "application/json", "JSON", ".json");
  }
  // Standalone fallback only (R33): the shell's orosDialog is used when present.
  function localPick(accept) {
    return new Promise(function (resolve) {
      var i = document.createElement("input");
      i.type = "file"; i.accept = accept;
      i.addEventListener("change", function () { resolve(i.files && i.files[0] ? i.files[0] : null); });
      i.click();
    });
  }
  function importJson() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(".json,application/json") : localPick(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return;                       // cancel = silent exit
      var fr = new FileReader();
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result)); } catch (e) { obj = null; }
        var merged = obj ? C.restore(data, obj) : null;
        if (!merged) { showToast(t("toast.badFile")); return; }
        data = merged;
        if (commit()) showToast(t("toast.restored"));
      };
      fr.readAsText(file);
    }).catch(function () {});
  }

  // .oroscrm (OBF-4e): every customer, deal, history entry,
  // follow-up, tag and own pipeline stage as one orOS file
  // (../recordpkg.js + package.js). Opening ADDS what this device
  // lacks, with its ids; a record already here (or deleted here) is
  // kept as it is unless "Update with newer versions" is ticked. The
  // file never holds the prefs or the web form (its keys); the merge
  // (core.js) keeps this device's own. The result goes through commit
  // (so sync carries it); Undo tombstones the added records the way
  // removeRow does (a customer's tomb also hides its deals etc.).
  var RP = window.OrosRecordPkg || null, CPK = window.OrosCrmPackage || null;
  var recFile = RP && CPK && window.OrosBundle ? RP.ui(CPK.DESC, {
    lang: function () { return LANG; },
    get: function () { return C.norm(data); },
    title: function () { return t("app"); },
    set: function (next) {
      var n = C.norm(next);
      if (!n || !Array.isArray(n.cust)) return;
      n.prefs = data.prefs;            // settings and the web form stay this device's
      if (data.wf) n.wf = data.wf; else delete n.wf;
      data = n;
      commit();
    },
    deleteIds: function (ids) {
      var any = false;
      ids.forEach(function (id) {
        var k = CPK.kindOf(id, data);
        if (!k || !C.ID_RE.test(id)) return;
        data.tombs[id] = stamp(C.byId(data[k], id));    // after its m, even a clamped future one
        any = true;
      });
      if (any) commit();
    },
    toast: function (text, undo) {
      if (undo) undoToast(text, undo);
      else showToast(text);
    }
  }) : null;

  // CSV of customers from another program: preview, then one write
  // (Undo removes them all again).
  function importCsv() {
    var dlg = dialogHost(), acc = ".csv,text/csv,.txt,text/plain";
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(acc) : localPick(acc);
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var r = C.csvImport(data, String(fr.result || ""), Date.now());
        if (!r) { showToast(t("imp.bad")); return; }
        importPreview(r);
      };
      fr.readAsText(file);
    }).catch(function () {});
  }
  function importPreview(r) {
    var dlg = makeDialog("crm-import", true);
    dlg.appendChild(el("h2", "dlg-title", t("imp.title")));
    var ul = el("ul", "imp-sum");
    var line = function (key, n) { if (n) ul.appendChild(el("li", "", t(key, { n: n, max: C.LIMITS.cust }))); };
    ul.appendChild(el("li", "", t("imp.new", { n: r.add.length })));
    line("imp.dup", r.dup); line("imp.noName", r.noName); line("imp.over", r.over); line("imp.tags", r.tags.length);
    dlg.appendChild(ul);
    if (r.add.length) {
      var names = r.add.slice(0, 8).map(function (c) { return c.name; }).join(", ");
      if (r.add.length > 8) names += " " + t("imp.more", { n: r.add.length - 8 });
      dlg.appendChild(el("p", "hint", names));
    } else dlg.appendChild(el("p", "hint", t("imp.none")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    if (r.add.length) acts.appendChild(button(t("imp.go", { n: r.add.length }), "primary", function () {
      dlg.close();
      var ids = [];
      r.tags.forEach(function (tg) { tg = Object.assign({}, tg, { m: stamp(null) }); data.tags.push(tg); ids.push(tg.id); });
      r.add.forEach(function (c) { c = Object.assign({}, c, { m: stamp(null) }); data.cust.push(c); ids.push(c.id); });
      if (!commit()) return;
      undoToast(t("imp.done", { n: r.add.length }), function () {
        ids.forEach(function (id) { tomb(id); });
        commit();
      });
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // Rows from a CRM platform (crm/platforms.js): one write. Undo
  // removes what was added and puts back what was changed.
  var PL = window.OrosCrmPlatforms || null;
  function applyRows(adds, upds, doneText) {
    var added = [], back = [];
    ["cust", "deals", "fups"].forEach(function (k) {
      (adds[k] || []).forEach(function (r) {
        if (C.byId(data[k], r.id)) return;
        var n = Object.assign({}, r, { m: stamp(null) });
        if (data.tombs[n.id]) { if (data.tombs[n.id] >= n.m) n.m = stamp({ m: data.tombs[n.id] }); delete data.tombs[n.id]; }
        data[k].push(n);
        added.push(n.id);
      });
    });
    upds.forEach(function (u) {
      var prev = C.byId(data[u.k], u.row.id);
      if (!prev) return;
      data[u.k][data[u.k].indexOf(prev)] = Object.assign({}, u.row, { m: stamp(prev) });
      back.push({ k: u.k, prev: prev });
    });
    if (!commit()) return false;
    undoToast(doneText, function () {
      added.forEach(function (id) { tomb(id); });
      back.forEach(function (b) {
        var cur = C.byId(data[b.k], b.prev.id);
        var row = Object.assign({}, b.prev, { m: stamp(cur || b.prev) });
        if (cur) data[b.k][data[b.k].indexOf(cur)] = row; else data[b.k].push(row);
      });
      commit();
    });
    return true;
  }
  // Update from online sources (../enrich.js + ../enrichui.js): the
  // customer's own e-mail, phone and website are the keys. A field
  // that is empty is filled; anything else found goes into the note
  // as "Label: value", so nothing the user typed is replaced.
  function enrichRec(c) {
    var names = [c.name, c.alias || ""];
    (c.people || []).forEach(function (p) { if (p.n) names.push(p.n); });
    var shared = {};
    if (c.email) {
      var mail = c.email.trim().toLowerCase();
      if (data.cust.filter(function (x) { return x.email && x.email.trim().toLowerCase() === mail; }).length > 1) shared[mail] = 1;
    }
    return { names: names.filter(Boolean), emails: c.email ? [c.email] : [], phones: c.phone ? [c.phone] : [],
             sites: c.web ? [c.web] : [], shared: shared, kind: c.kind === "person" ? "person" : "org",
             place: [c.addr, c.country].filter(Boolean).join(", "),
             has: { photo: true, birthday: true, job: c.kind !== "person" || !!c.job, org: true, address: !!c.addr, name: true } };
  }
  function enrichApply(picks) {
    var upds = [];
    picks.forEach(function (p) {
      var c = C.byId(data.cust, p.id);
      if (!c) return;
      var r = Object.assign({}, c), extra = [];
      p.list.forEach(function (s) {
        var v = String(s.v);
        if (s.k === "link") { if (!r.web) r.web = v; else if (r.web !== v) extra.push((s.label || t("en.link")) + ": " + v); }
        else if (s.k === "phone") { if (!r.phone) r.phone = v; else extra.push(t("fact.phone") + ": " + v); }
        else if (s.k === "email") { if (!r.email) r.email = v; else extra.push(t("fact.email") + ": " + v); }
        else if (s.k === "address" && !r.addr) r.addr = v;
        else if (s.k === "job" && !r.job) r.job = v;
      });
      extra = extra.filter(function (line) { return (r.note || "").indexOf(line) < 0; });
      if (extra.length) r.note = ((r.note ? r.note + "\n" : "") + extra.join("\n")).slice(0, 2000);
      if (JSON.stringify(r) !== JSON.stringify(c)) upds.push({ k: "cust", row: r });
    });
    if (!upds.length) return 0;
    return applyRows({}, upds, t("en.done", { n: upds.length })) ? upds.length : 0;
  }
  function enrichOpen(custs) {
    var items = custs.filter(function (c) { return c.email || c.phone || c.web; })
      .map(function (c) { return { id: c.id, name: c.name, rec: enrichRec(c) }; });
    if (!items.length) { showToast(t("en.empty")); return; }
    var go = function () {
      window.OrosEnrichUI.open({ lang: LANG, items: items, apply: enrichApply, kinds: ["link", "phone", "email", "address", "job"] });
    };
    if (window.OrosEnrichUI) { go(); return; }
    var s = document.createElement("script");
    s.src = "../enrichui.js";
    s.onload = go;
    s.onerror = function () { showToast(t("en.empty")); };
    document.head.appendChild(s);
  }
  // The web form (crm/webform.js): its dialog, checks and data.wf.
  var WF = window.OrosCrmWebForm || null;
  function initWebForm() {
    if (!WF || typeof WF.init !== "function") { WF = null; return; }
    WF.init({ lang: LANG, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog, field: field, inp: inp,
              seg: seg, confirmDialog: confirmDialog, showToast: showToast, fmtMs: fmtMs, stamp: stamp, commit: commit,
              data: function () { return data; }, emailOf: function (p) { return personView(p).email; } });
  }
  function initPlatforms() {
    if (!PL) return;
    PL.init({ lang: LANG, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog,
              field: field, selectEl: selectEl, data: function () { return data; }, apply: applyRows });
  }

  // BR-CRM-MAIL: an email from Mail becomes a prefilled "Email" log
  // entry of the customer with that address (or one of its people).
  // Unknown address: the New customer form, then the log entry.
  function mailToLog(raw) {
    var m = C.mailLog(raw);
    if (!m) return false;
    var text = [m.subject ? t("mail.subj", { s: m.subject }) : "", m.text].filter(Boolean).join("\n\n").slice(0, 2000);
    var c = C.custByEmail(data, m.email, function (p) { return personView(p).email; });
    var open = function (cust) {
      var who = "";
      (cust.people || []).forEach(function (p) {
        var v = personView(p);
        if (!who && String(v.email || "").toLowerCase() === m.email) who = v.name;
      });
      prefs.sel = cust.id; prefs.sub = "hist"; savePrefs();
      setTab("cust");
      logEditor(null, cust.id, { k: "mail", at: m.at || Date.now(), text: text, who: who });
    };
    if (c) { open(c); return true; }
    setTab("cust");
    showToast(t("mail.noCust", { email: m.email }));
    custEditor(null, { fill: { name: m.name, email: m.email }, then: open });
    return true;
  }

  // Assistant entry card (BR-W8-6): the New customer form prefilled
  // (C.asNewCust clamps it); nothing is saved before Save. An email a
  // customer already has → that customer instead.
  function asNewCust(raw) {
    var n = C.asNewCust(raw);
    if (!n) return false;
    var c = n.email ? C.custByEmail(data, n.email, function (p) { return personView(p).email; }) : null;
    if (c) {
      prefs.sel = c.id; prefs.sub = "hist"; savePrefs();
      setTab("cust");
      return true;
    }
    if (n.who) n.note = (t("ed.asNewWho", { name: n.who }) + (n.note ? "\n" + n.note : "")).slice(0, 2000);
    delete n.who;
    setTab("cust");
    custEditor(null, { fill: n });
    return true;
  }

  // ---------- 12. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, wide) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pc-dlg" + (wide ? " wide" : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function showDialog(dlg) {
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function confirmDialog(msg, yes, danger, onYes) {
    var dlg = makeDialog("crm-confirm");
    dlg.appendChild(el("p", "confirm-msg", msg));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(yes, danger ? "danger-fill" : "primary", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
    acts.lastChild.focus();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "crm", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo / action toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, [[t("toast.undo"), onUndo]]); }
  function actionToast(text, label, fn, onUndo) {
    var acts = [[label, fn]];
    if (onUndo) acts.push([t("toast.undo"), onUndo]);
    localToast(text, acts);
  }
  var toastTimer = null;
  function localToast(text, acts) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    (acts || []).forEach(function (a) {
      var b = el("button", "", a[0]);
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        a[1]();
      }, { once: true });
      box.appendChild(b);
    });
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); box.innerHTML = ""; }, acts && acts.length ? 8000 : 4000);
    live(text);
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

  // ---------- 13. Keyboard (Contract Β) + deep link ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // Deep link from the shell (window.__orosOpenAt("crm", target)):
  // { cust } opens the customer, { deal } its editor, { fup } the
  // follow-up's editor (inbox reminders, search), { act } the history
  // entry. A dialog open (maybe with unsaved edits) wins: no-op.
  function openTarget(x) {
    // "Open with" an .oroscrm file (fileopen.js): { openFile: { token } },
    // the File taken once with window.parent.__orosTakeFile(token)
    if (x && typeof x === "object" && x.openFile) { if (recFile) recFile.openTarget(x.openFile); return !!recFile; }
    if (!x || typeof x !== "object" || document.querySelector("dialog[open]")) return false;
    var id = function (v) { return typeof v === "string" && C.ID_RE.test(v) ? v : ""; };
    // Today's "Done" tick: the same code as the Agenda's tick (Undo,
    // "Log it"); a follow-up already done or gone only shows a note.
    if (x.done && typeof x.done === "object") {
      var df = id(x.done.fup) ? C.byId(data.fups, x.done.fup) : null;
      if (!df || df.done) { showToast(t(df ? "toast.already" : "toast.gone")); return false; }
      prefs.sel = df.cust; prefs.sub = "fups"; savePrefs();
      setTab("agenda");
      doneFup(df);
      return true;
    }
    if (x.log) return mailToLog(x.log);
    if (x.asNew) return asNewCust(x.asNew);
    // Single app icon shortcut: an empty New customer form.
    if (x.newCust) { setTab("cust"); custEditor(null, {}); return true; }
    var c = id(x.cust) ? C.byId(data.cust, x.cust) : null;
    var d = id(x.deal) ? C.byId(data.deals, x.deal) : null;
    var f = id(x.fup) ? C.byId(data.fups, x.fup) : null;
    var a = id(x.act) ? C.byId(data.acts, x.act) : null;
    if (!c && !d && !f && !a) {
      if (x.cust || x.deal || x.fup || x.act) showToast(t("toast.gone"));
      return false;
    }
    var cid = c ? c.id : (d ? d.cust : (f ? f.cust : a.cust));
    prefs.sel = cid;
    if (d) prefs.sub = "deals"; else if (f) prefs.sub = "fups"; else if (a) prefs.sub = "hist";
    savePrefs();
    setTab("cust");
    if (d) dealEditor(d, d.cust);
    else if (f) fupEditor(f, f.cust);
    else if (a) logEditor(a, a.cust);
    return true;
  }
  window.__orosOpenAt = openTarget;
  function takeTarget() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") openTarget(p.__orosTakeTarget("crm"));
    } catch (e) {}
  }

  // ---------- 14. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
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
  function mergeFn(a, b) { return C.merge(a, b); }
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
    api.registerSlice("crm", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }
  function sliceGet() { return C.norm(data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.cust)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.norm(incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (!document.querySelector("dialog[open]")) render();
    else renderBadge();
  }

  // ---------- 15. Wiring & boot ----------
  var TABS = ["cust", "pipe", "agenda", "dash"];
  function setTab(tab) {
    prefs.tab = TABS.indexOf(tab) >= 0 ? tab : "cust";
    savePrefs();
    render();
  }
  function renderBadge() {
    var ag = C.agenda(data, todayYmd(), 0);
    var n = ag.late.length + ag.today.length;
    var tb = $("tab-agenda");
    var b = tb.querySelector(".badge");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = el("span", "badge"); tb.appendChild(b); }
    b.textContent = n > 99 ? "99+" : String(n);
    b.setAttribute("aria-label", String(n));
  }
  var renderedDay = null;
  function render() {
    renderedDay = todayYmd();
    TABS.forEach(function (v) {
      var on = v === prefs.tab;
      $("view-" + v).hidden = !on;
      var b = $("tab-" + v);
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    renderBadge();
    if (prefs.tab === "cust") renderCustomers();
    else if (prefs.tab === "pipe") renderPipeline();
    else if (prefs.tab === "agenda") renderAgenda();
    else renderDash();
  }

  function addMenu() {
    if (prefs.tab === "pipe") { dealEditor(null, ""); return; }
    if (prefs.tab === "agenda") { fupEditor(null, ""); return; }
    if (prefs.tab === "cust" && !prefs.sel) { custEditor(null); return; }
    var dlg = makeDialog("crm-add");
    dlg.appendChild(el("h2", "dlg-title", t("btn.add")));
    var list = el("div", "sheet-list");
    function item(icon, label, fn) {
      var b = button("", "sheet-btn", function () { dlg.close(); fn(); });
      b.innerHTML = UI[icon];
      b.appendChild(el("span", "", label));
      list.appendChild(b);
    }
    var sel = prefs.tab === "cust" ? prefs.sel : "";
    item("users", t("add.cust"), function () { custEditor(null); });
    if (data.cust.length) {
      item("log", t("add.log"), function () { logEditor(null, sel); });
      item("clock", t("add.fup"), function () { fupEditor(null, sel); });
      item("deal", t("add.deal"), function () { dealEditor(null, sel); });
    }
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    $("app-title").textContent = t("app");
    TABS.forEach(function (v) {
      var b = $("tab-" + v);
      b.innerHTML = UI[TAB_ICON[v]];   // constant SVG
      b.appendChild(el("span", "lbl", t("tab." + v)));
    });
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    var ab = $("add-btn");
    ab.innerHTML = UI.plus + "<span></span>";
    ab.lastChild.textContent = t("btn.add");
    ab.setAttribute("aria-label", t("btn.add"));
    ab.title = t("btn.add");
    $("cust-q").placeholder = t("q.ph");
    $("cust-q").setAttribute("aria-label", t("q.ph"));
    var sort = $("cust-sort");
    sort.innerHTML = "";
    ["name", "last", "next", "value"].forEach(function (s) {
      var o = el("option", "", t("sort." + s)); o.value = s; sort.appendChild(o);
    });
    sort.value = prefs.sort;
    sort.setAttribute("aria-label", t("sort." + prefs.sort));
    document.title = t("app") + " · orOS";
  }

  function wire() {
    TABS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { setTab(v); }); });
    $("tabbar").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var i = TABS.indexOf(prefs.tab) + (e.key === "ArrowRight" ? 1 : -1);
      setTab(TABS[(i + TABS.length) % TABS.length]);
      $("tab-" + prefs.tab).focus();
    });
    $("add-btn").addEventListener("click", addMenu);
    $("settings-btn").addEventListener("click", settings);
    var qt = null;
    $("cust-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(renderCustomers, 120); });
    $("cust-sort").addEventListener("change", function () { prefs.sort = this.value; savePrefs(); renderCustomers(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
      else {
        if (renderedDay !== todayYmd() && !document.querySelector("dialog[open]")) render();
        if (WF) WF.auto();
      }
    });
    // Contacts edited in another frame/tab: people lines are live
    window.addEventListener("storage", function (e) {
      if (document.querySelector("dialog[open]")) return;
      if ((e.key === CONTACTS_KEY || e.key === INV_KEY || e.key === QUOTE_KEY) && prefs.tab === "cust") renderDetail();
      else if (e.key === INV_KEY && prefs.tab === "dash") renderDash();
    });
    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      if (renderedDay !== todayYmd() && !document.querySelector("dialog[open]")) render();
    }, 60000);
    window.addEventListener("pagehide", savePrefsNow);
    wireKeyboard();
  }

  function boot() {
    if (!C) { document.body.textContent = "CRM: core.js missing"; return; }
    load();
    loadPrefs();
    initPlatforms();
    initWebForm();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeTarget();
    if (WF) WF.auto();
    console.log("[orOS CRM] v1.4.0 boot OK");
  }

  boot();
})();
