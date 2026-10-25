// ============================================================
// orOS Invoices — App logic (v1.0.0)
// Invoices, receipts, proformas and credit notes made here (numbered,
// frozen when issued, PDF out), plus invoices issued elsewhere (for
// example in myDATA) recorded with their ΜΑΡΚ. Payments, statuses,
// a revenue dashboard, clients, recurring drafts.
// orOS never sends anything to ΑΑΔΕ / myDATA.
// The model (normalize, merge, numbering, totals, statuses,
// dashboard, CSV) lives in core.js.
// Data:
//   - synced slice "invoices" (oros-invoices-data), see core.js
//   - device-local (R10): oros-invoices-prefs { tab, f{}, dash{}, ser{} }
//     and oros-invoices-draft (the editor's unsaved work)
// Sections:
//   1. i18n + helpers
//   2. Storage + prefs
//   3. Edits
//   4. Render: documents
//   5. Render: clients
//   6. Render: dashboard
//   7. Editor (drafts, new documents, records)
//   8. Viewer (issued documents) + payments
//   9. Dialogs: client, payment, pickers, templates
//  10. Settings
//  11. PDF
//  12. Files: CSV, backup, restore, official PDF, email
//  13. Toasts
//  14. Keyboard (Contract Β)
//  15. Sync slice + palette
//  16. Wiring, boot, deep links (BR-INV-NEW)
// ============================================================
(function () {
  "use strict";

  var C = window.OrosInvoicesCore;
  var STORAGE_KEY = C.STORAGE_KEY;
  var PREFS_KEY = "oros-invoices-prefs";
  var DRAFT_KEY = "oros-invoices-draft";
  var SCRIPT_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "";
  })();

  // ---------- 1. i18n + helpers ----------
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
  function loc(l) {
    l = l || LANG;
    return window.orosI18n ? window.orosI18n.locale(l) : (l === "el" ? "el-GR" : "en-GB");
  }

  var STRINGS = {
    en: {
      "app": "Invoices", "settings": "Settings", "back": "Back", "new": "New",
      "tab.docs": "Invoices", "tab.clients": "Clients", "tab.dash": "Dashboard",
      "kind.inv": "Invoice", "kind.rcpt": "Receipt", "kind.pro": "Proforma", "kind.cred": "Credit note",
      "kind.ext": "Recorded invoice",
      "kinds.inv": "Invoices", "kinds.rcpt": "Receipts", "kinds.pro": "Proformas", "kinds.cred": "Credit notes",
      "kinds.ext": "Recorded",
      "st.draft": "Draft", "st.void": "Cancelled", "st.pro": "Proforma", "st.credit": "Credit note",
      "st.paid": "Paid", "st.partial": "Partly paid", "st.overdue": "Overdue", "st.unpaid": "Unpaid",
      "how.bank": "Bank transfer", "how.cash": "Cash", "how.card": "Card", "how.iris": "IRIS",
      "how.paypal": "PayPal", "how.other": "Other",
      "f.search": "Search number, client, items, ΜΑΡΚ…", "f.allStatus": "Every status", "f.allKind": "Every kind",
      "f.allYears": "Every year", "f.open": "Not paid yet", "f.client": "Showing the documents of {c}.",
      "f.clientClear": "Show all",
      "docs.empty": "No invoices yet.", "docs.emptyHint": "Create your first invoice with New, or record one you issued elsewhere.",
      "docs.none": "Nothing matches these filters.",
      "row.due": "due {d}", "row.late": "{n} days late", "row.late1": "1 day late", "row.left": "{a} left",
      "row.draftNo": "No number yet", "row.recDraft": "Recurring",
      "new.title": "New", "new.inv": "Invoice", "new.invHint": "Numbered, with VAT, as a PDF.",
      "new.rcpt": "Receipt", "new.rcptHint": "For a payment you received.",
      "new.pro": "Proforma", "new.proHint": "An offer to pay; it becomes an invoice later.",
      "new.cred": "Credit note", "new.credHint": "Corrects an invoice you issued.",
      "new.ext": "Record an invoice issued elsewhere", "new.extHint": "For example in myDATA or by your provider: track its payment here.",
      "new.tpl": "From a template", "new.tplHint": "{n} saved",
      "setup.text": "Add your business details: they go on every invoice.", "setup.go": "Add details",
      "clash.one": "Two documents have the same number {n} (issued on two devices before they synced).",
      "clash.fix": "Give {n} a new number", "clash.sentWarn": "{n} was already sent. A new number means the copy your client has no longer matches. Renumber anyway?",
      "clash.done": "{a} is now {b}",
      "cli.search": "Search clients…", "cli.new": "New client", "cli.empty": "No clients yet. Add one, or bring them in from Contacts or Quote.",
      "cli.fromContacts": "From Contacts", "cli.fromQuote": "From Quote", "cli.fromCrm": "From CRM",
      "pay.toBudget": "Add to Budget", "pay.inBudget": "In Budget", "pay.resend": "This payment was already sent to Budget. Send it again?",
      "pay.resendGo": "Send again", "toast.budgetSent": "Budget is open with the payment filled in: check and save",
      "toast.budgetNo": "Budget could not take this payment", "cli.open": "{a} open",
      "cli.docs": "{n} documents", "cli.docs1": "1 document", "cli.none": "No documents",
      "dash.range": "Period", "dash.from": "From", "dash.to": "To", "dash.cur": "Currency",
      "range.thisMonth": "This month", "range.lastMonth": "Last month", "range.thisQuarter": "This quarter",
      "range.thisYear": "This year", "range.lastYear": "Last year", "range.custom": "Custom",
      "dash.inv": "Invoiced", "dash.col": "Collected", "dash.out": "Outstanding", "dash.over": "Overdue",
      "dash.sub": "{n} documents · net {net} · VAT {vat} · withheld {wht}. Outstanding and overdue count every period.",
      "dash.months": "Per month", "dash.top": "Top clients", "dash.vat": "VAT per rate",
      "dash.vatHint": "For reference when you prepare your VAT return; your accountant has the final word.",
      "dash.rate": "Rate", "dash.base": "Net", "dash.vatAmt": "VAT", "dash.other": "Recorded",
      "dash.noTop": "No documents in this period.", "dash.csvDocs": "Export documents (CSV)", "dash.csvPays": "Export payments (CSV)",
      "dash.sheet": "Open in Spreadsheet", "dash.sheetCap": "Only the first {n} documents fit in one sheet",
      "ed.new": "New {k}", "ed.draft": "{k} · draft", "ed.record": "Record an invoice", "ed.editRecord": "Edit record",
      "ed.subNew": "Not saved yet", "ed.subDraft": "Saved as a draft", "ed.subNext": "Will be {n} when issued",
      "ed.subRecord": "Issued elsewhere: tracked here only",
      "ed.kind": "Kind", "ed.series": "Numbering", "ed.client": "Client", "ed.noClient": "No client (one-off)",
      "ed.newClient": "New client", "ed.editClient": "Edit client", "ed.date": "Date", "ed.due": "Due",
      "ed.dueNone": "No due date", "ed.dueNow": "On receipt", "ed.dueDays": "{n} days",
      "ed.cur": "Currency", "ed.lines": "Items", "ed.addLine": "Add item", "ed.code": "Code", "ed.desc": "Description",
      "ed.qty": "Qty", "ed.unit": "Unit", "ed.price": "Unit price", "ed.disc": "Disc. %", "ed.vat": "VAT %",
      "ed.amount": "Amount", "ed.removeLine": "Remove item", "ed.up": "Move up",
      "ed.gDisc": "Discount on the total (%)", "ed.wht": "Withholding tax (%)",
      "ed.whtHint": "For example 20 % on services by a freelancer. It is taken off the amount payable.",
      "ed.more": "Terms, notes and more", "ed.exempt": "VAT exemption reason",
      "ed.exemptHint": "Printed when VAT is 0 %, e.g. \"Article 39a\" or \"Reverse charge\".",
      "ed.terms": "Payment terms", "ed.termsHint": "Your bank account from Settings is printed under them.",
      "ed.notes": "Notes", "ed.plang": "PDF language", "ed.plangApp": "Like the app", "plang.el": "Ελληνικά", "plang.en": "English", "ed.ref": "Corrects",
      "ed.refNone": "Choose the invoice", "ed.paidNow": "Paid now (records a payment)",
      "ed.num": "Number", "ed.numHint": "As it is on the issued invoice.",
      "ed.net": "Net amount", "ed.vatAmt": "VAT amount", "ed.mark": "ΜΑΡΚ (myDATA)", "ed.markHint": "Optional: the mark of the invoice in myDATA.",
      "ed.file": "Official PDF", "ed.fileAdd": "Attach", "ed.fileOpen": "Open", "ed.fileNone": "None",
      "ed.saveDraft": "Save draft", "ed.issue": "Issue", "ed.saveRecord": "Save", "ed.preview": "Preview PDF",
      "ed.saveTpl": "Save as template", "ed.delete": "Delete draft", "ed.discard": "Discard changes",
      "tot.sub": "Subtotal", "tot.disc": "Discount", "tot.net": "Net", "tot.vat": "VAT {r} %", "tot.vatAll": "VAT",
      "tot.total": "Total", "tot.wht": "Withholding {r} %", "tot.pay": "Amount payable", "tot.paid": "Paid", "tot.bal": "Balance",
      "iss.title": "Issue {n}?", "iss.text": "After issuing, the items and the client can't change. Corrections are made with a credit note.",
      "iss.early": "The date is before {n} ({d}) of the same series.",
      "iss.go": "Issue",
      "vw.pdf": "PDF", "vw.share": "Share PDF", "vw.email": "Email", "vw.pay": "Add payment", "vw.paid": "Mark as paid",
      "vw.sent": "Mark as sent", "vw.unsent": "Not sent", "vw.dup": "Duplicate", "vw.credit": "Credit note",
      "ed.prof": "Business", "set.profs": "Business profiles", "set.addBiz": "Add a business profile", "set.newBiz": "New business",
      "set.profsHint": "Another business? Each profile has its own details, logo, bank lines, terms and footer; pick it on each document. Give it its own numbering series below (Profile) to keep separate numbers.",
      "set.delBiz": "Delete this profile", "set.main": "Main", "set.serProf": "Profile", "set.serAny": "Any", "set.editing": "Editing", "toast.bizDel": "Profile deleted",
      "set.qr": "Payment QR code on EUR PDFs (from the first IBAN)",
      "set.paylink": "Pay online link", "set.paylinkHint": "Your own Stripe Payment Link (https://buy.stripe.com/…) or another https payment page. It goes on the PDF as a link and a QR code. orOS never needs a payment key.",
      "set.paylinkBad": "The pay online link must be a full https:// address.",
      "rc.fits": "Business client in another EU country ({c}): reverse charge?", "rc.services": "Services, 0 % VAT", "rc.goods": "Goods, 0 % VAT",
      "toast.rcDone": "VAT set to 0 % with the reverse charge note",
      "c.statement": "Statement PDF", "toast.noOpen": "Nothing is owed by this client",
      "vw.remind": "Payment reminder", "rem.text": "Pick a tone. The message opens as a draft you can still edit.", "rem.soft": "Polite", "rem.firm": "Firm",
      "vw.convert": "Make invoice", "vw.stockOut": "Take out of stock", "vw.stockRet": "Back into stock", "vw.void": "Cancel", "vw.edit": "Edit", "vw.delete": "Delete",
      "vw.sentOn": "Sent {d}", "vw.converted": "Turned into {n}", "vw.from": "From", "vw.to": "Bill to",
      "vw.dates": "Date {d} · due {u}", "vw.date": "Date {d}", "vw.corrects": "Corrects {n}", "vw.credits": "Credit notes",
      "vw.pays": "Payments", "vw.noPays": "No payments yet.", "vw.mark": "ΜΑΡΚ", "vw.markEdit": "Edit ΜΑΡΚ",
      "vw.voidTitle": "Cancel {n}?", "vw.voidText": "The number stays used and the document counts as zero. You can undo it for a few seconds.",
      "vw.voidGo": "Cancel document", "vw.keep": "Keep",
      "vw.delTitle": "Delete this record?", "vw.delText": "Its payments are deleted too.",
      "pay.title": "Payment", "pay.date": "Date", "pay.amt": "Amount", "pay.how": "Method", "pay.note": "Note",
      "pay.del": "Delete payment",
      "c.title": "Client", "c.name": "Name or company", "c.job": "Profession / business", "c.afm": "Tax number (ΑΦΜ / VAT)",
      "c.doy": "Tax office (ΔΟΥ)", "c.addr": "Address", "c.country": "Country", "c.email": "Email", "c.phone": "Phone",
      "c.note": "Notes", "c.delete": "Delete", "c.newInv": "New invoice", "c.showDocs": "Show documents",
      "c.busy": "This client has {n} documents. They keep their copy of the details.",
      "pick.title": "Choose", "pick.search": "Search…", "pick.none": "Nothing to show.", "pick.add": "Add {n}",
      "pick.have": "already a client",
      "tpl.title": "Save as template", "tpl.name": "Name", "tpl.rep": "Repeat", "tpl.rep0": "Don't repeat",
      "tpl.repm": "Every month", "tpl.repq": "Every 3 months", "tpl.repy": "Every year", "tpl.start": "First draft on",
      "tpl.repHint": "On that day a draft is made for you to check and issue. Nothing is issued by itself.",
      "tpl.pick": "Templates", "tpl.next": "next {d}", "tpl.del": "Delete template",
      "set.title": "Settings", "set.biz": "Your business", "set.bizHint": "Printed on every invoice you issue from now on. Issued invoices keep the details they were issued with.",
      "set.name": "Name or company", "set.trade": "Trade name", "set.job": "Profession / business", "set.addr": "Address",
      "set.country": "Country", "set.afm": "Tax number (ΑΦΜ / VAT)", "set.doy": "Tax office (ΔΟΥ)", "set.phone": "Phone",
      "set.email": "Email", "set.web": "Website", "set.iban": "Bank accounts (IBAN)", "set.ibanHint": "One per line, e.g. \"Eurobank GR12 0260 …\".",
      "set.logo": "Logo", "set.logoAdd": "Choose image", "set.logoDel": "Remove", "set.logoHint": "PNG or JPG; it is made smaller to keep sync light.",
      "set.defs": "Defaults", "set.cur": "Currency", "set.vat": "VAT %", "set.days": "Payment due in (days)",
      "set.wht": "Withholding tax %", "set.plang": "PDF language", "set.terms": "Payment terms", "set.footer": "Footer on every PDF",
      "set.save": "Save", "set.saved": "Settings saved",
      "set.ser": "Numbering", "set.serHint": "Each kind has its series. Numbers go up by one per year (or for ever). On a second device you can add a series like \"B\" and pick it there, so two devices never give the same number.",
      "set.prefix": "Prefix", "set.year": "Year in the number", "set.digits": "Digits", "set.sample": "Next: {n}",
      "set.thisDevice": "Use on this device", "set.addSer": "Add series", "set.delSer": "Delete series",
      "set.serBusy": "This series has numbered documents and can't be deleted.",
      "set.tpls": "Templates", "set.noTpls": "No templates. Save one from an invoice you are writing.",
      "set.data": "Data", "set.backup": "Back up (JSON)", "set.restore": "Restore from backup",
      "set.osave": "orOS file (.orosinvoices)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "set.ofileHint": "An orOS file adds only what is missing here; documents already issued here never change.",
      "set.restoreHint": "Restoring merges with what you have: nothing is replaced or lost.",
      "set.about": "orOS Invoices does not send anything to ΑΑΔΕ / myDATA. For Greek business-to-business invoices that must be issued electronically, issue them in myDATA or with your provider and record them here with New › Record an invoice issued elsewhere.",
      "dlg.cancel": "Cancel", "dlg.save": "Save", "dlg.ok": "OK", "dlg.close": "Close", "dlg.discard": "Discard",
      "dlg.leaveTitle": "Leave without saving?", "dlg.leaveText": "Your changes to this draft will be lost.",
      "toast.save": "Saving failed: the storage is full", "toast.saved": "Saved", "toast.draftSaved": "Draft saved",
      "toast.issued": "{n} issued", "toast.recorded": "Invoice recorded", "toast.deleted": "Draft deleted",
      "toast.recDeleted": "Record deleted", "toast.voided": "{n} cancelled", "toast.undo": "Undo",
      "toast.payAdded": "Payment of {a} added", "toast.payDel": "Payment deleted", "toast.sent": "Marked as sent",
      "toast.needClient": "Choose a client for this {k}", "toast.needLine": "Add at least one item with a description",
      "toast.needRef": "Choose the invoice this credit note corrects", "toast.needNum": "Type the invoice number",
      "toast.needAmt": "Type the amounts of the invoice", "toast.badNum": "Couldn't read {f}", "toast.badDate": "Check the dates",
      "toast.needName": "Give a name", "toast.cliSaved": "Client saved", "toast.cliDel": "Client deleted",
      "toast.imported": "{n} clients added", "toast.imported1": "1 client added", "toast.importNone": "Nothing new to add",
      "toast.tplSaved": "Template saved", "toast.tplDel": "Template deleted", "toast.recurring": "{n} recurring drafts are ready",
      "toast.recurring1": "A recurring draft is ready", "toast.restored": "Restored: {n} new documents",
      "toast.restored1": "Restored: 1 new document", "toast.restoredNone": "Restored: nothing new", "toast.badFile": "This is not an Invoices backup",
      "toast.exported": "Exported", "toast.pdfFail": "The PDF couldn't be made (is the app fully loaded?)",
      "toast.noDisk": "The orOS disk is not available here", "toast.fileBig": "The file is larger than 10 MB",
      "toast.fileSaved": "Attached to the orOS disk", "toast.fileGone": "The file is no longer on the orOS disk",
      "toast.logoBad": "Couldn't read this image", "toast.prefilled": "Filled in from {a}: check and save",
      "toast.restoredDraft": "Your unsaved draft is back", "toast.gone": "This document was deleted",
      "toast.converted": "A new invoice draft was made from the proforma", "toast.markSaved": "ΜΑΡΚ saved",
      "toast.shareFail": "Sharing is not available here", "toast.emailHint": "Attach the PDF yourself: save it with the PDF button first.",
      "mail.subject": "{k} {n}", "mail.body": "Hello,\n\nPlease find {k} {n} of {d} for {a}, due {u}.\n\nThank you.",
      "mail.bodyNoDue": "Hello,\n\nPlease find {k} {n} of {d} for {a}.\n\nThank you.",
      "mail.softSubject": "Payment reminder: {k} {n}",
      "mail.soft": "Hello,\n\nThis is a friendly reminder that {k} {n} of {d}, for {a}, is due on {u}. If you have already paid it, please ignore this message.\n\nThank you.",
      "mail.softLate": "Hello,\n\nThis is a friendly reminder that {k} {n} of {d} was due on {u}, and {a} is still open. If you have already paid it, please ignore this message.\n\nThank you.",
      "mail.firmSubject": "Overdue: {k} {n}",
      "mail.firm": "Hello,\n\n{k} {n} of {d} is {l} days overdue: {a} was due on {u} and is still unpaid. Please arrange payment within 7 days, or let us know when to expect it.\n\nThank you.",
      "pdf.draft": "DRAFT", "live.saved": "Saved", "mail.payOnline": "Pay online"
    },
    el: {
      "app": "Τιμολόγια", "settings": "Ρυθμίσεις", "back": "Πίσω", "new": "Νέο",
      "tab.docs": "Παραστατικά", "tab.clients": "Πελάτες", "tab.dash": "Επισκόπηση",
      "kind.inv": "Τιμολόγιο", "kind.rcpt": "Απόδειξη", "kind.pro": "Προτιμολόγιο", "kind.cred": "Πιστωτικό",
      "kind.ext": "Καταχωρισμένο τιμολόγιο",
      "kinds.inv": "Τιμολόγια", "kinds.rcpt": "Αποδείξεις", "kinds.pro": "Προτιμολόγια", "kinds.cred": "Πιστωτικά",
      "kinds.ext": "Καταχωρισμένα",
      "st.draft": "Πρόχειρο", "st.void": "Ακυρωμένο", "st.pro": "Προτιμολόγιο", "st.credit": "Πιστωτικό",
      "st.paid": "Εξοφλημένο", "st.partial": "Μερικώς εξοφλημένο", "st.overdue": "Ληξιπρόθεσμο", "st.unpaid": "Ανεξόφλητο",
      "how.bank": "Τραπεζική μεταφορά", "how.cash": "Μετρητά", "how.card": "Κάρτα", "how.iris": "IRIS",
      "how.paypal": "PayPal", "how.other": "Άλλο",
      "f.search": "Αναζήτηση αριθμού, πελάτη, ειδών, ΜΑΡΚ…", "f.allStatus": "Όλες οι καταστάσεις", "f.allKind": "Όλα τα είδη",
      "f.allYears": "Όλα τα έτη", "f.open": "Δεν έχουν εξοφληθεί", "f.client": "Βλέπεις τα παραστατικά του πελάτη {c}.",
      "f.clientClear": "Όλα",
      "docs.empty": "Δεν υπάρχουν ακόμη τιμολόγια.", "docs.emptyHint": "Φτιάξε το πρώτο σου με το Νέο, ή κατέγραψε ένα που εξέδωσες αλλού.",
      "docs.none": "Τίποτα δεν ταιριάζει με αυτά τα φίλτρα.",
      "row.due": "λήγει {d}", "row.late": "καθυστέρηση {n} ημερών", "row.late1": "καθυστέρηση 1 ημέρας", "row.left": "απομένουν {a}",
      "row.draftNo": "Χωρίς αριθμό ακόμη", "row.recDraft": "Επαναλαμβανόμενο",
      "new.title": "Νέο", "new.inv": "Τιμολόγιο", "new.invHint": "Με αρίθμηση, ΦΠΑ και PDF.",
      "new.rcpt": "Απόδειξη", "new.rcptHint": "Για πληρωμή που εισέπραξες.",
      "new.pro": "Προτιμολόγιο", "new.proHint": "Πρόσκληση πληρωμής· αργότερα γίνεται τιμολόγιο.",
      "new.cred": "Πιστωτικό", "new.credHint": "Διορθώνει τιμολόγιο που εξέδωσες.",
      "new.ext": "Καταχώριση τιμολογίου που εκδόθηκε αλλού", "new.extHint": "Π.χ. στο myDATA ή από τον πάροχό σου: εδώ παρακολουθείς την πληρωμή του.",
      "new.tpl": "Από πρότυπο", "new.tplHint": "{n} αποθηκευμένα",
      "setup.text": "Συμπλήρωσε τα στοιχεία της επιχείρησής σου: μπαίνουν σε κάθε τιμολόγιο.", "setup.go": "Συμπλήρωση",
      "clash.one": "Δύο παραστατικά έχουν τον ίδιο αριθμό {n} (εκδόθηκαν σε δύο συσκευές πριν συγχρονιστούν).",
      "clash.fix": "Νέος αριθμός για το {n}", "clash.sentWarn": "Το {n} έχει ήδη σταλεί. Με νέο αριθμό, το αντίγραφο του πελάτη δεν θα ταιριάζει. Να αλλάξει παρ' όλα αυτά;",
      "clash.done": "Το {a} έγινε {b}",
      "cli.search": "Αναζήτηση πελατών…", "cli.new": "Νέος πελάτης", "cli.empty": "Δεν υπάρχουν πελάτες. Πρόσθεσε έναν ή φέρε τους από τις Επαφές ή την Προσφορά.",
      "cli.fromContacts": "Από τις Επαφές", "cli.fromQuote": "Από την Προσφορά", "cli.fromCrm": "Από το CRM",
      "pay.toBudget": "Στον Προϋπολογισμό", "pay.inBudget": "Στον Προϋπολογισμό", "pay.resend": "Αυτή η πληρωμή στάλθηκε ήδη στον Προϋπολογισμό. Να σταλεί ξανά;",
      "pay.resendGo": "Αποστολή ξανά", "toast.budgetSent": "Ο Προϋπολογισμός άνοιξε με την πληρωμή συμπληρωμένη: έλεγξε και αποθήκευσε",
      "toast.budgetNo": "Ο Προϋπολογισμός δεν δέχτηκε αυτή την πληρωμή", "cli.open": "οφείλει {a}",
      "cli.docs": "{n} παραστατικά", "cli.docs1": "1 παραστατικό", "cli.none": "Κανένα παραστατικό",
      "dash.range": "Περίοδος", "dash.from": "Από", "dash.to": "Έως", "dash.cur": "Νόμισμα",
      "range.thisMonth": "Αυτός ο μήνας", "range.lastMonth": "Προηγούμενος μήνας", "range.thisQuarter": "Αυτό το τρίμηνο",
      "range.thisYear": "Φέτος", "range.lastYear": "Πέρσι", "range.custom": "Άλλη περίοδος",
      "dash.inv": "Τιμολογήθηκαν", "dash.col": "Εισπράχθηκαν", "dash.out": "Ανεξόφλητα", "dash.over": "Ληξιπρόθεσμα",
      "dash.sub": "{n} παραστατικά · καθαρά {net} · ΦΠΑ {vat} · παρακράτηση {wht}. Τα ανεξόφλητα και τα ληξιπρόθεσμα μετρούν από όλες τις περιόδους.",
      "dash.months": "Ανά μήνα", "dash.top": "Κορυφαίοι πελάτες", "dash.vat": "ΦΠΑ ανά συντελεστή",
      "dash.vatHint": "Ενδεικτικά, για τη δήλωση ΦΠΑ· τον τελευταίο λόγο τον έχει ο λογιστής σου.",
      "dash.rate": "Συντελεστής", "dash.base": "Καθαρή αξία", "dash.vatAmt": "ΦΠΑ", "dash.other": "Καταχωρισμένα",
      "dash.noTop": "Κανένα παραστατικό σε αυτή την περίοδο.", "dash.csvDocs": "Εξαγωγή παραστατικών (CSV)", "dash.csvPays": "Εξαγωγή πληρωμών (CSV)",
      "dash.sheet": "Άνοιγμα στο Υπολογιστικό φύλλο", "dash.sheetCap": "Χωρούν μόνο τα πρώτα {n} παραστατικά σε ένα φύλλο",
      "ed.new": "Νέο: {k}", "ed.draft": "{k} · πρόχειρο", "ed.record": "Καταχώριση τιμολογίου", "ed.editRecord": "Επεξεργασία καταχώρισης",
      "ed.subNew": "Δεν έχει αποθηκευτεί", "ed.subDraft": "Αποθηκευμένο ως πρόχειρο", "ed.subNext": "Με την έκδοση θα πάρει τον αριθμό {n}",
      "ed.subRecord": "Εκδόθηκε αλλού· εδώ μόνο παρακολουθείται",
      "ed.kind": "Είδος", "ed.series": "Σειρά αρίθμησης", "ed.client": "Πελάτης", "ed.noClient": "Χωρίς πελάτη (λιανική)",
      "ed.newClient": "Νέος πελάτης", "ed.editClient": "Επεξεργασία πελάτη", "ed.date": "Ημερομηνία", "ed.due": "Λήξη",
      "ed.dueNone": "Χωρίς λήξη", "ed.dueNow": "Με την παραλαβή", "ed.dueDays": "{n} ημέρες",
      "ed.cur": "Νόμισμα", "ed.lines": "Είδη και υπηρεσίες", "ed.addLine": "Προσθήκη γραμμής", "ed.code": "Κωδικός", "ed.desc": "Περιγραφή",
      "ed.qty": "Ποσ.", "ed.unit": "Μον.", "ed.price": "Τιμή μονάδας", "ed.disc": "Έκπτ. %", "ed.vat": "ΦΠΑ %",
      "ed.amount": "Αξία", "ed.removeLine": "Αφαίρεση γραμμής", "ed.up": "Μετακίνηση πάνω",
      "ed.gDisc": "Έκπτωση στο σύνολο (%)", "ed.wht": "Παρακράτηση φόρου (%)",
      "ed.whtHint": "Π.χ. 20 % σε υπηρεσίες ελεύθερου επαγγελματία. Αφαιρείται από το πληρωτέο.",
      "ed.more": "Όροι, σημειώσεις και άλλα", "ed.exempt": "Αιτία απαλλαγής ΦΠΑ",
      "ed.exemptHint": "Τυπώνεται όταν ο ΦΠΑ είναι 0 %, π.χ. «Άρθρο 39α» ή «Αντίστροφη χρέωση».",
      "ed.terms": "Όροι πληρωμής", "ed.termsHint": "Από κάτω τυπώνεται ο λογαριασμός σου από τις Ρυθμίσεις.",
      "ed.notes": "Σημειώσεις", "ed.plang": "Γλώσσα PDF", "ed.plangApp": "Όπως η εφαρμογή", "plang.el": "Ελληνικά", "plang.en": "English", "ed.ref": "Διορθώνει",
      "ed.refNone": "Επίλεξε το τιμολόγιο", "ed.paidNow": "Πληρώθηκε τώρα (καταγράφει πληρωμή)",
      "ed.num": "Αριθμός", "ed.numHint": "Όπως είναι στο τιμολόγιο που εκδόθηκε.",
      "ed.net": "Καθαρή αξία", "ed.vatAmt": "Ποσό ΦΠΑ", "ed.mark": "ΜΑΡΚ (myDATA)", "ed.markHint": "Προαιρετικά: ο ΜΑΡΚ του τιμολογίου στο myDATA.",
      "ed.file": "Επίσημο PDF", "ed.fileAdd": "Επισύναψη", "ed.fileOpen": "Άνοιγμα", "ed.fileNone": "Κανένα",
      "ed.saveDraft": "Αποθήκευση πρόχειρου", "ed.issue": "Έκδοση", "ed.saveRecord": "Αποθήκευση", "ed.preview": "Προεπισκόπηση PDF",
      "ed.saveTpl": "Αποθήκευση ως πρότυπο", "ed.delete": "Διαγραφή πρόχειρου", "ed.discard": "Απόρριψη αλλαγών",
      "tot.sub": "Υποσύνολο", "tot.disc": "Έκπτωση", "tot.net": "Καθαρή αξία", "tot.vat": "ΦΠΑ {r} %", "tot.vatAll": "ΦΠΑ",
      "tot.total": "Σύνολο", "tot.wht": "Παρακράτηση {r} %", "tot.pay": "Πληρωτέο", "tot.paid": "Πληρώθηκαν", "tot.bal": "Υπόλοιπο",
      "iss.title": "Έκδοση του {n};", "iss.text": "Μετά την έκδοση, τα είδη και ο πελάτης δεν αλλάζουν. Οι διορθώσεις γίνονται με πιστωτικό.",
      "iss.early": "Η ημερομηνία είναι πριν από το {n} ({d}) της ίδιας σειράς.",
      "iss.go": "Έκδοση",
      "vw.pdf": "PDF", "vw.share": "Κοινοποίηση PDF", "vw.email": "Email", "vw.pay": "Νέα πληρωμή", "vw.paid": "Εξόφληση",
      "vw.sent": "Σημείωση ως σταλμένο", "vw.unsent": "Δεν στάλθηκε", "vw.dup": "Αντίγραφο", "vw.credit": "Πιστωτικό",
      "ed.prof": "Επιχείρηση", "set.profs": "Επιχειρηματικά προφίλ", "set.addBiz": "Προσθήκη προφίλ επιχείρησης", "set.newBiz": "Νέα επιχείρηση",
      "set.profsHint": "Κι άλλη επιχείρηση; Κάθε προφίλ έχει δικά του στοιχεία, λογότυπο, τράπεζες, όρους και υποσέλιδο· το διαλέγεις σε κάθε παραστατικό. Δώσε του δική του σειρά αρίθμησης πιο κάτω (Προφίλ) για χωριστή αρίθμηση.",
      "set.delBiz": "Διαγραφή προφίλ", "set.main": "Κύριο", "set.serProf": "Προφίλ", "set.serAny": "Όλα", "set.editing": "Επεξεργασία", "toast.bizDel": "Το προφίλ διαγράφηκε",
      "set.qr": "QR πληρωμής στα PDF σε ευρώ (από το πρώτο IBAN)",
      "set.paylink": "Σύνδεσμος online πληρωμής", "set.paylinkHint": "Το δικό σου Stripe Payment Link (https://buy.stripe.com/…) ή άλλη σελίδα πληρωμής https. Μπαίνει στο PDF ως σύνδεσμος και QR. Το orOS δεν χρειάζεται ποτέ κλειδί πληρωμών.",
      "set.paylinkBad": "Ο σύνδεσμος online πληρωμής πρέπει να είναι πλήρης διεύθυνση https://.",
      "rc.fits": "Επιχείρηση-πελάτης σε άλλη χώρα της ΕΕ ({c}): αντίστροφη επιβάρυνση;", "rc.services": "Υπηρεσίες, ΦΠΑ 0 %", "rc.goods": "Αγαθά, ΦΠΑ 0 %",
      "toast.rcDone": "ΦΠΑ 0 % με τη σημείωση αντίστροφης επιβάρυνσης",
      "c.statement": "Καρτέλα σε PDF", "toast.noOpen": "Ο πελάτης δεν οφείλει τίποτα",
      "vw.remind": "Υπενθύμιση πληρωμής", "rem.text": "Διάλεξε ύφος. Το μήνυμα ανοίγει ως πρόχειρο που μπορείς ακόμη να αλλάξεις.", "rem.soft": "Ευγενικό", "rem.firm": "Αυστηρό",
      "vw.convert": "Μετατροπή σε τιμολόγιο", "vw.stockOut": "Έξοδος από απόθεμα", "vw.stockRet": "Επιστροφή στο απόθεμα", "vw.void": "Ακύρωση", "vw.edit": "Επεξεργασία", "vw.delete": "Διαγραφή",
      "vw.sentOn": "Στάλθηκε {d}", "vw.converted": "Έγινε {n}", "vw.from": "Εκδότης", "vw.to": "Πελάτης",
      "vw.dates": "Ημερομηνία {d} · λήξη {u}", "vw.date": "Ημερομηνία {d}", "vw.corrects": "Διορθώνει το {n}", "vw.credits": "Πιστωτικά",
      "vw.pays": "Πληρωμές", "vw.noPays": "Καμία πληρωμή ακόμη.", "vw.mark": "ΜΑΡΚ", "vw.markEdit": "Αλλαγή ΜΑΡΚ",
      "vw.voidTitle": "Ακύρωση του {n};", "vw.voidText": "Ο αριθμός μένει δεσμευμένος και το παραστατικό μετρά μηδέν. Για λίγα δευτερόλεπτα μπορείς να το αναιρέσεις.",
      "vw.voidGo": "Ακύρωση παραστατικού", "vw.keep": "Όχι",
      "vw.delTitle": "Διαγραφή αυτής της καταχώρισης;", "vw.delText": "Διαγράφονται και οι πληρωμές της.",
      "pay.title": "Πληρωμή", "pay.date": "Ημερομηνία", "pay.amt": "Ποσό", "pay.how": "Τρόπος", "pay.note": "Σημείωση",
      "pay.del": "Διαγραφή πληρωμής",
      "c.title": "Πελάτης", "c.name": "Ονοματεπώνυμο ή επωνυμία", "c.job": "Επάγγελμα / δραστηριότητα", "c.afm": "ΑΦΜ",
      "c.doy": "ΔΟΥ", "c.addr": "Διεύθυνση", "c.country": "Χώρα", "c.email": "Email", "c.phone": "Τηλέφωνο",
      "c.note": "Σημειώσεις", "c.delete": "Διαγραφή", "c.newInv": "Νέο τιμολόγιο", "c.showDocs": "Τα παραστατικά του",
      "c.busy": "Ο πελάτης έχει {n} παραστατικά. Κρατούν το δικό τους αντίγραφο των στοιχείων.",
      "pick.title": "Επιλογή", "pick.search": "Αναζήτηση…", "pick.none": "Δεν υπάρχει κάτι.", "pick.add": "Προσθήκη {n}",
      "pick.have": "υπάρχει ήδη",
      "tpl.title": "Αποθήκευση ως πρότυπο", "tpl.name": "Όνομα", "tpl.rep": "Επανάληψη", "tpl.rep0": "Χωρίς επανάληψη",
      "tpl.repm": "Κάθε μήνα", "tpl.repq": "Κάθε τρίμηνο", "tpl.repy": "Κάθε χρόνο", "tpl.start": "Πρώτο πρόχειρο στις",
      "tpl.repHint": "Εκείνη τη μέρα φτιάχνεται ένα πρόχειρο για να το ελέγξεις και να το εκδώσεις. Τίποτα δεν εκδίδεται μόνο του.",
      "tpl.pick": "Πρότυπα", "tpl.next": "επόμενο {d}", "tpl.del": "Διαγραφή προτύπου",
      "set.title": "Ρυθμίσεις", "set.biz": "Η επιχείρησή σου", "set.bizHint": "Τυπώνονται σε κάθε τιμολόγιο που εκδίδεις από εδώ και πέρα. Όσα έχουν εκδοθεί κρατούν τα στοιχεία της έκδοσής τους.",
      "set.name": "Ονοματεπώνυμο ή επωνυμία", "set.trade": "Διακριτικός τίτλος", "set.job": "Επάγγελμα / δραστηριότητα", "set.addr": "Διεύθυνση",
      "set.country": "Χώρα", "set.afm": "ΑΦΜ", "set.doy": "ΔΟΥ", "set.phone": "Τηλέφωνο",
      "set.email": "Email", "set.web": "Ιστότοπος", "set.iban": "Τραπεζικοί λογαριασμοί (IBAN)", "set.ibanHint": "Ένας ανά γραμμή, π.χ. «Eurobank GR12 0260 …».",
      "set.logo": "Λογότυπο", "set.logoAdd": "Επιλογή εικόνας", "set.logoDel": "Αφαίρεση", "set.logoHint": "PNG ή JPG· μικραίνει για να μένει ελαφρύ το sync.",
      "set.defs": "Προεπιλογές", "set.cur": "Νόμισμα", "set.vat": "ΦΠΑ %", "set.days": "Πληρωμή σε (ημέρες)",
      "set.wht": "Παρακράτηση φόρου %", "set.plang": "Γλώσσα PDF", "set.terms": "Όροι πληρωμής", "set.footer": "Υποσέλιδο σε κάθε PDF",
      "set.save": "Αποθήκευση", "set.saved": "Οι ρυθμίσεις αποθηκεύτηκαν",
      "set.ser": "Αρίθμηση", "set.serHint": "Κάθε είδος έχει τη σειρά του. Η αρίθμηση ανεβαίνει κατά ένα ανά έτος (ή συνεχώς). Σε δεύτερη συσκευή μπορείς να προσθέσεις σειρά, π.χ. «Β», και να τη διαλέξεις εκεί, ώστε δύο συσκευές να μη δίνουν ποτέ τον ίδιο αριθμό.",
      "set.prefix": "Πρόθεμα", "set.year": "Έτος στον αριθμό", "set.digits": "Ψηφία", "set.sample": "Επόμενο: {n}",
      "set.thisDevice": "Σε αυτή τη συσκευή", "set.addSer": "Νέα σειρά", "set.delSer": "Διαγραφή σειράς",
      "set.serBusy": "Η σειρά έχει αριθμημένα παραστατικά και δεν διαγράφεται.",
      "set.tpls": "Πρότυπα", "set.noTpls": "Δεν υπάρχουν πρότυπα. Αποθήκευσε ένα από τιμολόγιο που γράφεις.",
      "set.data": "Δεδομένα", "set.backup": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο",
      "set.osave": "Αρχείο orOS (.orosinvoices)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "set.ofileHint": "Ένα αρχείο orOS προσθέτει μόνο όσα λείπουν εδώ· τα παραστατικά που έχουν ήδη εκδοθεί εδώ δεν αλλάζουν ποτέ.",
      "set.restoreHint": "Η επαναφορά ενώνεται με ό,τι υπάρχει: τίποτα δεν αντικαθίσταται ούτε χάνεται.",
      "set.about": "Τα Τιμολόγια του orOS δεν στέλνουν τίποτα στην ΑΑΔΕ / myDATA. Τα ελληνικά τιμολόγια προς επιχειρήσεις που πρέπει να εκδίδονται ηλεκτρονικά, έκδωσέ τα στο myDATA ή μέσω του παρόχου σου και κατέγραψέ τα εδώ με Νέο › Καταχώριση τιμολογίου που εκδόθηκε αλλού.",
      "dlg.cancel": "Άκυρο", "dlg.save": "Αποθήκευση", "dlg.ok": "OK", "dlg.close": "Κλείσιμο", "dlg.discard": "Απόρριψη",
      "dlg.leaveTitle": "Έξοδος χωρίς αποθήκευση;", "dlg.leaveText": "Οι αλλαγές σε αυτό το πρόχειρο θα χαθούν.",
      "toast.save": "Η αποθήκευση απέτυχε: ο χώρος γέμισε", "toast.saved": "Αποθηκεύτηκε", "toast.draftSaved": "Το πρόχειρο αποθηκεύτηκε",
      "toast.issued": "Εκδόθηκε το {n}", "toast.recorded": "Το τιμολόγιο καταχωρίστηκε", "toast.deleted": "Το πρόχειρο διαγράφηκε",
      "toast.recDeleted": "Η καταχώριση διαγράφηκε", "toast.voided": "Ακυρώθηκε το {n}", "toast.undo": "Αναίρεση",
      "toast.payAdded": "Προστέθηκε πληρωμή {a}", "toast.payDel": "Η πληρωμή διαγράφηκε", "toast.sent": "Σημειώθηκε ως σταλμένο",
      "toast.needClient": "Διάλεξε πελάτη για αυτό το παραστατικό ({k})", "toast.needLine": "Πρόσθεσε τουλάχιστον μία γραμμή με περιγραφή",
      "toast.needRef": "Διάλεξε το τιμολόγιο που διορθώνει το πιστωτικό", "toast.needNum": "Γράψε τον αριθμό του τιμολογίου",
      "toast.needAmt": "Γράψε τα ποσά του τιμολογίου", "toast.badNum": "Δεν κατάλαβα: {f}", "toast.badDate": "Έλεγξε τις ημερομηνίες",
      "toast.needName": "Δώσε ένα όνομα", "toast.cliSaved": "Ο πελάτης αποθηκεύτηκε", "toast.cliDel": "Ο πελάτης διαγράφηκε",
      "toast.imported": "Προστέθηκαν {n} πελάτες", "toast.imported1": "Προστέθηκε 1 πελάτης", "toast.importNone": "Δεν υπάρχει κάτι νέο",
      "toast.tplSaved": "Το πρότυπο αποθηκεύτηκε", "toast.tplDel": "Το πρότυπο διαγράφηκε", "toast.recurring": "Έτοιμα {n} επαναλαμβανόμενα πρόχειρα",
      "toast.recurring1": "Έτοιμο ένα επαναλαμβανόμενο πρόχειρο", "toast.restored": "Επαναφορά: {n} νέα παραστατικά",
      "toast.restored1": "Επαναφορά: 1 νέο παραστατικό", "toast.restoredNone": "Επαναφορά: τίποτα καινούριο", "toast.badFile": "Αυτό δεν είναι αντίγραφο των Τιμολογίων",
      "toast.exported": "Έγινε εξαγωγή", "toast.pdfFail": "Το PDF δεν έγινε (έχει φορτώσει πλήρως η εφαρμογή;)",
      "toast.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ", "toast.fileBig": "Το αρχείο είναι μεγαλύτερο από 10 MB",
      "toast.fileSaved": "Επισυνάφθηκε στον δίσκο του orOS", "toast.fileGone": "Το αρχείο δεν υπάρχει πια στον δίσκο του orOS",
      "toast.logoBad": "Δεν διαβάστηκε αυτή η εικόνα", "toast.prefilled": "Συμπληρώθηκε από: {a}. Έλεγξε και αποθήκευσε",
      "toast.restoredDraft": "Το πρόχειρο που δεν είχες αποθηκεύσει επανήλθε", "toast.gone": "Αυτό το παραστατικό διαγράφηκε",
      "toast.converted": "Από το προτιμολόγιο έγινε νέο πρόχειρο τιμολογίου", "toast.markSaved": "Ο ΜΑΡΚ αποθηκεύτηκε",
      "toast.shareFail": "Η κοινοποίηση δεν είναι διαθέσιμη εδώ", "toast.emailHint": "Επισύναψε μόνος σου το PDF: αποθήκευσέ το πρώτα με το κουμπί PDF.",
      "mail.subject": "{k} {n}", "mail.body": "Καλησπέρα σας,\n\nσας στέλνουμε το {k} {n} της {d}, ποσού {a}, με λήξη {u}.\n\nΕυχαριστούμε.",
      "mail.bodyNoDue": "Καλησπέρα σας,\n\nσας στέλνουμε το {k} {n} της {d}, ποσού {a}.\n\nΕυχαριστούμε.",
      "mail.softSubject": "Υπενθύμιση πληρωμής: {k} {n}",
      "mail.soft": "Καλησπέρα σας,\n\nμια φιλική υπενθύμιση ότι το {k} {n} της {d}, ποσού {a}, λήγει στις {u}. Αν το έχετε ήδη εξοφλήσει, αγνοήστε αυτό το μήνυμα.\n\nΕυχαριστούμε.",
      "mail.softLate": "Καλησπέρα σας,\n\nμια φιλική υπενθύμιση ότι το {k} {n} της {d} έληξε στις {u} και παραμένουν ανοιχτά {a}. Αν το έχετε ήδη εξοφλήσει, αγνοήστε αυτό το μήνυμα.\n\nΕυχαριστούμε.",
      "mail.firmSubject": "Ληξιπρόθεσμο: {k} {n}",
      "mail.firm": "Καλησπέρα σας,\n\nτο {k} {n} της {d} είναι ληξιπρόθεσμο εδώ και {l} ημέρες: τα {a} έληγαν στις {u} και παραμένουν απλήρωτα. Παρακαλούμε τακτοποιήστε την πληρωμή μέσα σε 7 ημέρες ή ενημερώστε μας πότε να την περιμένουμε.\n\nΕυχαριστούμε.",
      "pdf.draft": "ΠΡΟΧΕΙΡΟ", "live.saved": "Αποθηκεύτηκε", "mail.payOnline": "Πληρωμή online"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "invoices", LANG);

  // Labels printed on the PDF: in the document's language, which can
  // differ from the app's (an English invoice for a client abroad).
  var PDF_STRINGS = {
    en: {
      "t.inv": "INVOICE", "t.rcpt": "RECEIPT", "t.pro": "PROFORMA INVOICE", "t.cred": "CREDIT NOTE",
      "no": "No.", "date": "Date", "due": "Due date", "mark": "ΜΑΡΚ", "from": "From", "to": "Bill to",
      "afm": "VAT no.", "doy": "Tax office", "corrects": "Corrects invoice {n} of {d}",
      "code": "Code", "desc": "Description", "qty": "Qty", "price": "Unit price", "disc": "Disc.", "vat": "VAT", "amount": "Amount",
      "sub": "Subtotal", "gdisc": "Discount {r} %", "net": "Net amount", "vatR": "VAT {r} %", "total": "Total",
      "wht": "Withholding tax {r} %", "pay": "Amount payable", "exempt": "VAT exemption", "terms": "Payment terms",
      "bank": "Bank account", "notes": "Notes", "page": "Page {a} of {b}",
      "proNote": "This is a proforma invoice, not a tax document.", "draft": "DRAFT",
      "qr": "Scan with your banking app to pay", "qrAmt": "{a} to {n}",
      "payOnline": "Pay online", "payOnlineHint": "Scan the code or open the link to pay by card.",
      "t.stmt": "STATEMENT OF ACCOUNT", "asOf": "As of {d}", "doc": "Document", "paid": "Paid", "bal": "Balance",
      "open": "Open balance", "late": "{n} days late", "stmtFile": "Statement"
    },
    el: {
      "t.inv": "ΤΙΜΟΛΟΓΙΟ", "t.rcpt": "ΑΠΟΔΕΙΞΗ", "t.pro": "ΠΡΟΤΙΜΟΛΟΓΙΟ", "t.cred": "ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ",
      "no": "Αρ.", "date": "Ημερομηνία", "due": "Λήξη", "mark": "ΜΑΡΚ", "from": "Εκδότης", "to": "Πελάτης",
      "afm": "ΑΦΜ", "doy": "ΔΟΥ", "corrects": "Διορθώνει το τιμολόγιο {n} της {d}",
      "code": "Κωδ.", "desc": "Περιγραφή", "qty": "Ποσ.", "price": "Τιμή μον.", "disc": "Έκπτ.", "vat": "ΦΠΑ", "amount": "Αξία",
      "sub": "Υποσύνολο", "gdisc": "Έκπτωση {r} %", "net": "Καθαρή αξία", "vatR": "ΦΠΑ {r} %", "total": "Σύνολο",
      "wht": "Παρακράτηση φόρου {r} %", "pay": "Πληρωτέο", "exempt": "Απαλλαγή ΦΠΑ", "terms": "Όροι πληρωμής",
      "bank": "Τραπεζικός λογαριασμός", "notes": "Σημειώσεις", "page": "Σελίδα {a} από {b}",
      "proNote": "Προτιμολόγιο: δεν είναι φορολογικό στοιχείο.", "draft": "ΠΡΟΧΕΙΡΟ",
      "qr": "Σκανάρετε με την εφαρμογή της τράπεζάς σας για πληρωμή", "qrAmt": "{a} προς {n}",
      "payOnline": "Πληρωμή online", "payOnlineHint": "Σκανάρετε τον κωδικό ή ανοίξτε τον σύνδεσμο για πληρωμή με κάρτα.",
      "t.stmt": "ΚΑΤΑΣΤΑΣΗ ΛΟΓΑΡΙΑΣΜΟΥ", "asOf": "Στις {d}", "doc": "Παραστατικό", "paid": "Πληρωμένο", "bal": "Υπόλοιπο",
      "open": "Ανοιχτό υπόλοιπο", "late": "{n} ημέρες καθυστέρηση", "stmtFile": "Καρτέλα"
    }
  };

  if (window.orosI18n) window.orosI18n.table(PDF_STRINGS, "invoices", LANG);

  // EU reverse charge notes (wave 3), in the document's language.
  var RC_NOTES = {
    en: { services: "Reverse charge: VAT to be accounted for by the recipient (Article 196, Council Directive 2006/112/EC).",
          goods: "VAT-exempt intra-Community supply of goods (Article 138, Council Directive 2006/112/EC)." },
    el: { services: "Αντίστροφη επιβάρυνση: τον ΦΠΑ τον αποδίδει ο λήπτης (άρθρο 196 Οδηγίας 2006/112/ΕΚ).",
          goods: "Απαλλασσόμενη ενδοκοινοτική παράδοση αγαθών (άρθρο 138 Οδηγίας 2006/112/ΕΚ)." }
  };
  if (window.orosI18n) window.orosI18n.table(RC_NOTES, "invoices", LANG);

  function fill(s, params) {
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }
  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    return fill(s, params);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function money(c, cur) { return C.fmtMoney(c, cur || data.prof.cur, LANG); }
  function day(key) {
    if (!C.validDay(key)) return "";
    try {
      return C.keyDate(key).toLocaleDateString(loc(),
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return C.fmtDay(key); }
  }
  function todayKey() { return C.today(); }
  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }
  function kindName(k) { return t("kind." + k); }
  function statusName(s) { return t("st." + s); }
  function howName(h) { return t("how." + h); }
  function docLabel(d) { return d.num || (d.st === "draft" ? t("row.draftNo") : kindName(d.kind)); }

  var UI = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    doc:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>',
    pen:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>'
  };

  // BOOT MARKER
  (function () {
    document.documentElement.lang = LANG;
    console.log("invoices.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;
  var view = "docs";          // docs | clients | dash | edit | view | set
  var viewId = "";            // the document on the viewer
  var ed = null;              // the editor's working copy { doc, isNew, dirty }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    data = C.parse(raw);
    if (data) return;
    try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    try { console.error("[orOS] invoices: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    data = C.empty();
  }
  var saveFailShown = false;
  function saveNow() {
    data = C.normalize(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  var TABS = ["docs", "clients", "dash"];
  var RANGES = ["thisMonth", "lastMonth", "thisQuarter", "thisYear", "lastYear", "custom"];
  function loadPrefs() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    v = (v && typeof v === "object") ? v : {};
    var f = (v.f && typeof v.f === "object") ? v.f : {};
    var d = (v.dash && typeof v.dash === "object") ? v.dash : {};
    var s = (v.ser && typeof v.ser === "object") ? v.ser : {};
    var str = function (x) { return typeof x === "string" ? x.slice(0, 60) : ""; };
    prefs = {
      tab: TABS.indexOf(v.tab) >= 0 ? v.tab : "docs",
      f: { st: str(f.st), kind: str(f.kind), year: str(f.year) },
      dash: { range: RANGES.indexOf(d.range) >= 0 ? d.range : "thisYear",
              from: C.validDay(d.from) ? d.from : "", to: C.validDay(d.to) ? d.to : "", cur: str(d.cur) },
      ser: {},
      // the accountant's address for the month's pack (acctpack.js)
      acct: typeof v.acct === "string" && v.acct.length <= 200 ? v.acct : ""
    };
    ["inv", "rcpt", "pro", "cred"].forEach(function (k) { if (typeof s[k] === "string") prefs.ser[k] = s[k]; });
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // The series this device numbers a kind with (Settings › Numbering).
  function deviceSeries(kind) {
    var id = prefs.ser[kind];
    var s = id && C.series(data, id);
    return s && s.kind === kind ? s.id : C.defaultSeries(kind);
  }
  function findDoc(id) { return C.doc(data, id); }
  function liveList(name) { return C.live(data[name]); }
  function profList() { return data.profs || (data.profs = []); }   // left out of the data while empty
  function replaceIn(list, rec) {
    for (var i = 0; i < list.length; i++) if (list[i].id === rec.id) { list[i] = rec; return; }
    list.push(rec);
  }

  // ---------- 3. Edits ----------
  function putDoc(d) { d.m = stamp(d.m); replaceIn(data.docs, d); saveNow(); }
  function putClient(c) { c.m = stamp(c.m); replaceIn(data.clients, c); saveNow(); }
  function tombOf(rec) { return { id: rec.id, m: stamp(rec.m), del: 1 }; }
  function restore(listName, rec) {   // Undo of a deletion: a fresh stamp beats the tomb (R17)
    var copy = JSON.parse(JSON.stringify(rec));
    var cur = C.anyId(data[listName], rec.id);
    copy.m = stamp(cur ? cur.m : rec.m);
    replaceIn(data[listName], copy);
  }

  function addPayment(docId, amt, date, how, note) {
    var p = { id: C.newId(), doc: docId, date: date, amt: amt, how: how, note: note || "", m: stamp(0) };
    data.pays.push(p);
    saveNow();
    return p;
  }
  function deletePayment(p) {
    replaceIn(data.pays, tombOf(p));
    saveNow();
    renderAll();
    undoToast(t("toast.payDel"), function () { restore("pays", p); saveNow(); renderAll(); });
  }

  // Number a draft and freeze it: client + seller copied in.
  function issueDoc(d, paidNow) {
    var serId = d.ser && C.series(data, d.ser) ? d.ser : deviceSeries(d.kind);
    var s = C.series(data, serId);
    if (!d.date) d.date = todayKey();
    d.ser = serId;
    d.seq = C.nextSeq(data, serId, d.date);
    d.num = C.fmtNum(s, +d.date.slice(0, 4), d.seq);
    d.st = "issued";
    var cl = C.client(data, d.cli);
    if (cl) {
      d.c = C.partyOfClient(cl);
      if (cl.crm) d.crm = cl.crm;
    }
    d.s = C.normSeller(C.profileOf(data, d.pid));
    putDoc(d);
    if (paidNow && d.kind !== "pro" && d.kind !== "cred") {
      var bal = C.balance(data, findDoc(d.id));
      if (bal > 0) addPayment(d.id, bal, d.date, "cash", "");
    }
    return findDoc(d.id);
  }

  // Recurring templates: the drafts they owe are made once (the same
  // id on every device, so two devices catching up make one draft).
  function runRecurring() {
    var due = C.recurringDue(data, todayKey());
    if (!due.length) return;
    var made = 0, touched = {};
    due.forEach(function (x) {
      touched[x.tpl.id] = x.tpl;
      if (C.anyId(data.docs, x.id)) return;
      var dft = C.draftFrom(data, x.tpl, x.date, x.id, stamp(0));
      if (dft) { data.docs.push(dft); made++; }
    });
    Object.keys(touched).forEach(function (id) {
      var tp = C.byId(data.tpls, id);
      if (!tp) return;
      tp.next = C.nextRun(tp, todayKey());
      tp.m = stamp(tp.m);
    });
    saveNow();
    if (made) showToast(made === 1 ? t("toast.recurring1") : t("toast.recurring", { n: made }));
  }

  function renumber(d) {
    if (MD && MD.locked(d)) { showToast(MD.lockedText("num")); return; }
    var s = C.series(data, d.ser);
    if (!s) return;
    var old = d.num;
    var copy = JSON.parse(JSON.stringify(d));
    copy.seq = C.nextSeq(data, d.ser, d.date);
    copy.num = C.fmtNum(s, +d.date.slice(0, 4), copy.seq);
    putDoc(copy);
    showToast(t("clash.done", { a: old, b: copy.num }));
    renderAll();
  }

  // ---------- 4. Render: documents ----------
  var tab = "docs";
  var cliFilter = "";     // a client id from the Clients tab (session only)
  var setPid = "";        // Settings: the business profile being edited (wave 3)
  function setTab(k) {
    if (TABS.indexOf(k) < 0) k = "docs";
    tab = k;
    prefs.tab = k;
    savePrefs();
    showView(k);
  }
  function showView(v) {
    view = v;
    ["docs", "clients", "dash", "edit", "view", "set"].forEach(function (k) {
      $("v-" + k).hidden = k !== v;
    });
    TABS.forEach(function (k) {
      var b = $("tab-" + k), on = k === v || (k === "docs" && (v === "edit" || v === "view"));
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("main").scrollTop = 0;
    renderView();
  }
  function renderView() {
    if (view === "docs") renderDocs();
    else if (view === "clients") renderClients();
    else if (view === "dash") renderDash();
    else if (view === "view") renderViewer();
    else if (view === "set") renderSettings();
  }
  function renderAll() {
    if (view === "edit") { renderEdTotals(); return; }   // never rebuild a form being typed in
    if (view === "set" && document.activeElement && $("set-body").contains(document.activeElement)) return;
    renderView();
  }

  function fillSelect(sel, opts, value) {
    sel.textContent = "";
    opts.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      sel.appendChild(op);
    });
    sel.value = value;
    if (sel.value !== value && opts.length) sel.value = opts[0][0];
  }

  function docText(d) {
    var parts = [d.num, d.c.name, d.c.afm, d.notes, d.mark, kindName(d.kind)];
    var cl = C.client(data, d.cli);
    if (cl) parts.push(cl.name);
    d.lines.forEach(function (l) { parts.push(l.d, l.code); });
    return C.fold(parts.join(" "));
  }
  function renderFilters() {
    var years = {};
    liveList("docs").forEach(function (d) { if (d.date) years[d.date.slice(0, 4)] = true; });
    var yOpts = [["", t("f.allYears")]].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y]; }));
    fillSelect($("f-year"), yOpts, prefs.f.year);
    fillSelect($("f-status"), [["", t("f.allStatus")], ["open", t("f.open")]].concat(
      ["draft", "unpaid", "partial", "overdue", "paid", "pro", "credit", "void"].map(function (s) { return [s, statusName(s)]; })),
      prefs.f.st);
    fillSelect($("f-kind"), [["", t("f.allKind")]].concat(C.KINDS.map(function (k) { return [k, t("kinds." + k)]; })), prefs.f.kind);
  }
  function renderDocs() {
    renderFilters();
    renderClash();
    var setup = !data.prof.name && liveList("docs").some(function (d) { return d.kind !== "ext"; });
    $("setup").hidden = !!data.prof.name || (!setup && liveList("docs").length > 0 && false);
    if (!data.prof.name) $("setup").hidden = false;
    var q = C.fold($("q").value);
    var today = todayKey();
    var cf = cliFilter && C.client(data, cliFilter);
    $("f-client").hidden = !cf;
    if (cf) {
      $("f-client").textContent = "";
      $("f-client").appendChild(document.createTextNode(t("f.client", { c: cf.name }) + " "));
      var clr = el("button", "link-btn", t("f.clientClear"));
      clr.type = "button";
      clr.addEventListener("click", function () { cliFilter = ""; renderDocs(); });
      $("f-client").appendChild(clr);
    }
    var all = liveList("docs");
    var list = all.filter(function (d) {
      if (cf && d.cli !== cf.id) return false;
      if (prefs.f.kind && d.kind !== prefs.f.kind) return false;
      if (prefs.f.year && d.date.slice(0, 4) !== prefs.f.year) return false;
      var st = C.status(data, d, today);
      if (prefs.f.st === "open") { if (!(st === "unpaid" || st === "partial" || st === "overdue")) return false; }
      else if (prefs.f.st && st !== prefs.f.st) return false;
      if (q && docText(d).indexOf(q) < 0) return false;
      return true;
    });
    // Drafts first, then newest date, then number.
    list.sort(function (a, b) {
      var da = a.st === "draft" ? 0 : 1, db = b.st === "draft" ? 0 : 1;
      if (da !== db) return da - db;
      return (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || (b.seq - a.seq) || (b.m - a.m);
    });
    var ol = $("docs");
    ol.textContent = "";
    list.slice(0, 500).forEach(function (d) { ol.appendChild(docRow(d, today)); });
    $("docs-empty").hidden = all.length > 0;
    if (all.length && !list.length) {
      var li = el("li", "hint", t("docs.none"));
      ol.appendChild(li);
    }
  }
  function docRow(d, today) {
    var li = el("li");
    var b = el("button", "row");
    b.type = "button";
    var st = C.status(data, d, today);
    var tt = C.totals(d);
    var main = el("span", "row-txt");
    var top = el("span", "row-top");
    top.appendChild(el("span", "row-no", docLabel(d)));
    top.appendChild(el("span", "chip st-" + st, statusName(st)));
    main.appendChild(top);
    var sub = [kindName(d.kind), C.partyName(data, d)].filter(Boolean);
    if (d.date) sub.push(day(d.date));
    if (d.id.indexOf("rec-") === 0 && d.st === "draft") sub.push(t("row.recDraft"));
    main.appendChild(el("span", "row-sub", sub.join(" · ")));
    b.appendChild(main);
    var right = el("span", "row-amt");
    right.appendChild(el("span", "amt" + (d.kind === "cred" ? " neg" : ""), (d.kind === "cred" ? "−" : "") + money(tt.pay, d.cur)));
    var bal = C.balance(data, d);
    var note = "";
    if (st === "overdue") {
      var n = C.lateDays(d, today);
      note = n === 1 ? t("row.late1") : t("row.late", { n: n });
    } else if (st === "partial") note = t("row.left", { a: money(bal, d.cur) });
    else if ((st === "unpaid") && d.due) note = t("row.due", { d: day(d.due) });
    if (note) right.appendChild(el("span", "row-note" + (st === "overdue" ? " bad" : ""), note));
    b.appendChild(right);
    b.addEventListener("click", function () { openDoc(d.id); });
    li.appendChild(b);
    return li;
  }
  function renderClash() {
    var box = $("clash"), groups = C.clashes(data);
    box.textContent = "";
    box.hidden = !groups.length;
    groups.forEach(function (g) {
      // a document already in myDATA keeps its number
      var keep = g.filter(function (x) { return MD && MD.locked(x); })[0] || C.clashKeeper(g);
      var row = el("div", "clash-row");
      row.appendChild(el("span", "", t("clash.one", { n: keep.num })));
      g.forEach(function (d) {
        if (d.id === keep.id) return;
        var b = el("button", "mini-btn", t("clash.fix", { n: d.num + " · " + (C.partyName(data, d) || kindName(d.kind)) }));
        b.type = "button";
        b.addEventListener("click", function () {
          if (d.sent) {
            confirmDialog(t("clash.fix", { n: d.num }), t("clash.sentWarn", { n: d.num }), t("dlg.ok"), function () { renumber(d); });
          } else renumber(d);
        });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  // ---------- 5. Render: clients ----------
  function clientRow(c) {
    var li = el("li");
    var b = el("button", "row");
    b.type = "button";
    var main = el("span", "row-txt");
    main.appendChild(el("span", "row-no", c.name));
    var sub = [c.afm, c.job, (c.addr || "").split("\n")[0], c.email].filter(Boolean).join(" · ");
    main.appendChild(el("span", "row-sub", sub));
    b.appendChild(main);
    var right = el("span", "row-amt");
    var open = C.clientOpen(data, c.id);
    var ks = Object.keys(open);
    var n = liveList("docs").filter(function (d) { return d.cli === c.id && d.st !== "draft"; }).length;
    if (ks.length) ks.forEach(function (k) { right.appendChild(el("span", "row-note bad", t("cli.open", { a: money(open[k], k) }))); });
    right.appendChild(el("span", "row-note", n ? (n === 1 ? t("cli.docs1") : t("cli.docs", { n: n })) : t("cli.none")));
    b.appendChild(right);
    b.addEventListener("click", function () { clientDialog(c.id, null); });
    li.appendChild(b);
    return li;
  }
  function renderClients() {
    var q = C.fold($("cq").value);
    var list = liveList("clients").filter(function (c) {
      return !q || C.fold([c.name, c.afm, c.email, c.phone, c.job, c.addr].join(" ")).indexOf(q) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name, loc()); });
    var ol = $("clients");
    ol.textContent = "";
    list.forEach(function (c) { ol.appendChild(clientRow(c)); });
    $("clients-empty").hidden = liveList("clients").length > 0;
    $("imp-contacts").hidden = !readOther("oros-contacts-data", "contacts");
    $("imp-quote").hidden = !readOther("oros-quote-data", "clients");
    $("imp-crm").hidden = !readOther("oros-crm-data", "cust");
  }

  // ---------- 6. Render: dashboard ----------
  function rangeKeys(r) {
    var now = new Date(), y = now.getFullYear(), mo = now.getMonth();
    function key(yy, mm, dd) { return C.dayKey(new Date(yy, mm, dd)); }
    if (r === "thisMonth") return [key(y, mo, 1), key(y, mo + 1, 0)];
    if (r === "lastMonth") return [key(y, mo - 1, 1), key(y, mo, 0)];
    if (r === "thisQuarter") { var q0 = mo - mo % 3; return [key(y, q0, 1), key(y, q0 + 3, 0)]; }
    if (r === "lastYear") return [key(y - 1, 0, 1), key(y - 1, 11, 31)];
    if (r === "custom") {
      var f = prefs.dash.from || key(y, 0, 1), to = prefs.dash.to || todayKey();
      return f <= to ? [f, to] : [to, f];
    }
    return [key(y, 0, 1), key(y, 11, 31)];
  }
  function renderDash() {
    fillSelect($("d-range"), RANGES.map(function (r) { return [r, t("range." + r)]; }), prefs.dash.range);
    var curs = C.currencies(data);
    // No choice yet: the first currency that has issued documents.
    var used = curs.filter(function (c) { return liveList("docs").some(function (d) { return d.st !== "draft" && d.cur === c; }); });
    var cur = curs.indexOf(prefs.dash.cur) >= 0 ? prefs.dash.cur : (used[0] || curs[0]);
    fillSelect($("d-cur"), curs.map(function (c) { return [c, c]; }), cur);
    $("d-cur").hidden = curs.length < 2;
    var custom = prefs.dash.range === "custom";
    $("d-from").hidden = $("d-to").hidden = !custom;
    var k = rangeKeys(prefs.dash.range);
    if (custom) { $("d-from").value = k[0]; $("d-to").value = k[1]; }
    var s = C.dashboard(data, k[0], k[1], cur, todayKey());
    var tiles = $("tiles");
    tiles.textContent = "";
    [["inv", s.invoiced, ""], ["col", s.collected, "good"], ["out", s.outstanding, ""], ["over", s.overdue, s.overdue ? "bad" : ""]]
      .forEach(function (x) {
        var tl = el("div", "tile " + x[2]);
        tl.appendChild(el("span", "tile-l", t("dash." + x[0])));
        tl.appendChild(el("span", "tile-v", money(x[1], cur)));
        tiles.appendChild(tl);
      });
    $("d-sub").textContent = t("dash.sub", { n: s.count, net: money(s.net, cur), vat: money(s.vat, cur), wht: money(s.wht, cur) });
    // Bars: invoiced and collected per month, scaled to the largest.
    var bars = $("bars");
    bars.textContent = "";
    var max = 0;
    s.months.forEach(function (m) { max = Math.max(max, m.inv, m.col); });
    s.months.forEach(function (m) {
      var col = el("div", "bar-col");
      col.title = m.ym + " · " + t("dash.inv") + " " + money(m.inv, cur) + " · " + t("dash.col") + " " + money(m.col, cur);
      var pair = el("div", "bar-pair");
      var a = el("i", "bar inv"), b = el("i", "bar col");
      a.style.height = (max > 0 ? Math.max(0, m.inv) / max * 100 : 0) + "%";
      b.style.height = (max > 0 ? Math.max(0, m.col) / max * 100 : 0) + "%";
      pair.appendChild(a);
      pair.appendChild(b);
      col.appendChild(pair);
      var d = C.keyDate(m.ym + "-01");
      var lbl = "";
      try { lbl = d.toLocaleDateString(loc(), { month: "short" }); } catch (e) { lbl = m.ym.slice(5); }
      col.appendChild(el("span", "bar-l", lbl));
      bars.appendChild(col);
    });
    var top = $("top");
    top.textContent = "";
    if (!s.top.length) top.appendChild(el("li", "hint", t("dash.noTop")));
    s.top.forEach(function (x) {
      var li = el("li", "top-row");
      li.appendChild(el("span", "top-n", x.name));
      li.appendChild(el("span", "top-a", money(x.amt, cur)));
      top.appendChild(li);
    });
    var tb = $("vat-table");
    tb.textContent = "";
    var head = el("tr");
    [t("dash.rate"), t("dash.base"), t("dash.vatAmt")].forEach(function (h, i) { head.appendChild(el("th", i ? "num" : "", h)); });
    var thead = el("thead");
    thead.appendChild(head);
    tb.appendChild(thead);
    var tbody = el("tbody");
    s.rates.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", "", r.rate === null ? t("dash.other") : C.fmtNumber(r.rate, LANG, 2) + " %"));
      tr.appendChild(el("td", "num", money(r.base, cur)));
      tr.appendChild(el("td", "num", money(r.vat, cur)));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    $("csv-docs").textContent = t("dash.csvDocs");
    $("sheet-docs").textContent = t("dash.sheet");
    $("sheet-docs").hidden = !sheetShell();
    $("csv-pays").textContent = t("dash.csvPays");
    $("acct-pack").hidden = !window.OrosAcctPack || !window.OrosAcctPack.open;
    if (window.OrosAcctPack && window.OrosAcctPack.STR) $("acct-pack").textContent = "🧾 " + acctText("ap.btn");
  }

  // ---------- 7. Editor ----------
  // ed = { doc (working copy), isNew, dirty, from }
  function blankDoc(kind) {
    var p = data.prof, d0 = todayKey();
    return {
      id: C.newId(), kind: kind, st: kind === "ext" ? "issued" : "draft",
      ser: kind === "ext" ? "" : deviceSeries(kind), seq: 0, num: "", date: d0,
      due: p.days ? C.addDays(d0, p.days) : "", cur: p.cur, cli: "", c: C.normParty({}),
      lines: kind === "ext" ? [] : [{ code: "", d: "", q: 1, unit: "", p: 0, disc: 0, vat: p.vat }],
      gDisc: 0, wht: kind === "ext" ? 0 : p.wht, exempt: "", terms: kind === "ext" ? "" : p.terms, notes: "",
      ref: "", crm: "", mark: "", file: "", sent: "", plang: "", xnet: 0, xvat: 0, m: 0
    };
  }
  function shelter() {
    if (!ed) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} return; }
    if (!ed.dirty) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: ed.doc, isNew: ed.isNew })); } catch (e) {}
  }
  function takeShelter() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
    if (!v || !v.doc || typeof v.doc !== "object") return false;
    var d = C.normDoc(Object.assign({}, v.doc, { m: 1 }));
    if (!d || d.del) return false;
    var cur = C.anyId(data.docs, d.id);
    if (cur && (cur.del || cur.st !== "draft") && d.kind !== "ext") return false;   // issued or deleted meanwhile
    openEditor(d, !!v.isNew && !cur, true);
    showToast(t("toast.restoredDraft"));
    return true;
  }
  function newDoc(kind, preset) {
    var d = blankDoc(kind);
    if (preset) preset(d);
    openEditor(d, true, false);
  }
  function editDoc(id) {
    var d = findDoc(id);
    if (!d) { showToast(t("toast.gone")); return; }
    openEditor(JSON.parse(JSON.stringify(d)), false, false);
  }
  function openEditor(d, isNew, dirty) {
    ed = { doc: d, isNew: isNew, dirty: !!dirty };
    showView("edit");
    buildEditor();
    shelter();
  }
  function touch() {
    if (!ed) return;
    ed.dirty = true;
    shelterSoon();
    renderEdTotals();
  }
  var shelterTimer = null;
  function shelterSoon() {
    clearTimeout(shelterTimer);
    shelterTimer = setTimeout(shelter, 400);
  }
  function closeEditor(force) {
    if (!ed) return;
    if (ed.dirty && !force) {
      confirmDialog(t("dlg.leaveTitle"), t("dlg.leaveText"), t("dlg.discard"), function () { closeEditor(true); }, true);
      return;
    }
    var id = ed.doc.id, wasNew = ed.isNew;
    ed = null;
    shelter();
    var d = findDoc(id);
    if (d && d.st !== "draft" && !wasNew) openDoc(id);
    else showView(tab);
  }

  function field(labelText, input, note, cls) {
    var w = el("div", "fld" + (cls ? " " + cls : ""));
    var lab = el("label", "dlg-lbl", labelText);
    if (!input.id) input.id = "f-" + C.newId();
    lab.setAttribute("for", input.id);
    w.appendChild(lab);
    w.appendChild(input);
    if (note) w.appendChild(el("p", "hint", note));
    return w;
  }
  function input(type, value, max) {
    var i = el("input");
    i.type = type;
    i.value = value === null || value === undefined ? "" : String(value);
    if (max) i.maxLength = max;
    return i;
  }
  function area(value, rows, max) {
    var a = el("textarea");
    a.rows = rows || 3;
    a.value = value || "";
    if (max) a.maxLength = max;
    return a;
  }
  function select(opts, value) {
    var s = el("select");
    fillSelect(s, opts, value);
    return s;
  }
  function row() {
    var r = el("div", "fld-row");
    for (var i = 0; i < arguments.length; i++) r.appendChild(arguments[i]);
    return r;
  }
  function currencyOpts(cur) {
    var list = C.CURRENCIES.slice();
    if (cur && list.indexOf(cur) < 0) list.unshift(cur);
    return list.map(function (c) { return [c, c]; });
  }
  function clientOpts(kind) {
    var opts = [["", kind === "rcpt" ? t("ed.noClient") : "—"]];
    liveList("clients").slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (c) { opts.push([c.id, c.name + (c.afm ? " · " + c.afm : "")]); });
    return opts;
  }

  var edRefs = null;   // the editor's live inputs
  function buildEditor() {
    var d = ed.doc, isExt = d.kind === "ext";
    var form = $("ed-form");
    form.textContent = "";
    edRefs = {};
    $("ed-back").innerHTML = UI.left;
    $("ed-back").title = $("ed-back").ariaLabel = t("back");
    $("ed-title").textContent = isExt ? (ed.isNew ? t("ed.record") : t("ed.editRecord"))
      : (ed.isNew ? t("ed.new", { k: kindName(d.kind) }) : t("ed.draft", { k: kindName(d.kind) }));
    renderEdSub();

    var card = el("div", "card");
    // Business profile (wave 3): only when there is more than one
    var profs = C.profiles(data);
    if (!isExt && profs.length > 1) {
      var pSel = select(profs.map(function (pr) { return [pr.id, profName(pr)]; }), d.pid && C.byId(data.profs, d.pid) ? d.pid : "");
      pSel.addEventListener("change", function () {
        var was = C.profileOf(data, d.pid);
        if (pSel.value) d.pid = pSel.value; else delete d.pid;
        var now = C.profileOf(data, d.pid);
        if (d.kind !== "cred") {
          d.ser = C.seriesForProfile(data, d.kind, d.pid, deviceSeries(d.kind));
          rebuildSeries();
          if (!d.terms || d.terms === was.terms) {
            d.terms = now.terms;
            if (edRefs.terms) edRefs.terms.value = d.terms;
          }
        }
        renderEdSub();
        paintRc();
        touch();
      });
      card.appendChild(field(t("ed.prof"), pSel));
    }
    // Kind (drafts only switch between invoice, receipt and proforma)
    if (!isExt && d.kind !== "cred") {
      var kSel = select(["inv", "rcpt", "pro"].map(function (k) { return [k, kindName(k)]; }), d.kind);
      kSel.addEventListener("change", function () {
        d.kind = kSel.value;
        d.ser = C.seriesForProfile(data, d.kind, d.pid, deviceSeries(d.kind));
        rebuildSeries();
        renderEdSub();
        $("ed-title").textContent = ed.isNew ? t("ed.new", { k: kindName(d.kind) }) : t("ed.draft", { k: kindName(d.kind) });
        edRefs.paidRow.hidden = d.kind !== "rcpt";
        touch();
      });
      var serSel = el("select");
      edRefs.ser = serSel;
      serSel.addEventListener("change", function () { d.ser = serSel.value; renderEdSub(); touch(); });
      card.appendChild(row(field(t("ed.kind"), kSel), edRefs.serFld = field(t("ed.series"), serSel)));
      rebuildSeries();
    }
    // Client
    var cSel = select(clientOpts(d.kind), d.cli);
    edRefs.cli = cSel;
    var cw = el("div", "cli-pick");
    cw.appendChild(cSel);
    var cNew = el("button", "icon-btn", null);
    cNew.type = "button";
    cNew.innerHTML = UI.plus;
    cNew.title = t("ed.newClient");
    cNew.setAttribute("aria-label", t("ed.newClient"));
    cNew.addEventListener("click", function () {
      clientDialog(null, function (c) {
        d.cli = c.id;
        d.c = C.partyOfClient(c);
        fillSelect(cSel, clientOpts(d.kind), d.cli);
        cEdit.hidden = false;
        rebuildRefs();
        paintRc();
        touch();
      });
    });
    var cEdit = el("button", "icon-btn", null);
    cEdit.type = "button";
    cEdit.innerHTML = UI.pen;
    cEdit.title = t("ed.editClient");
    cEdit.setAttribute("aria-label", t("ed.editClient"));
    cEdit.hidden = !d.cli;
    cEdit.addEventListener("click", function () {
      if (!d.cli) return;
      clientDialog(d.cli, function (c) {
        d.c = C.partyOfClient(c);
        fillSelect(cSel, clientOpts(d.kind), d.cli);
        paintRc();
        touch();
      });
    });
    cw.appendChild(cEdit);
    cw.appendChild(cNew);
    cSel.addEventListener("change", function () {
      d.cli = cSel.value;
      var c = C.client(data, d.cli);
      d.c = c ? C.partyOfClient(c) : C.normParty({});
      d.crm = c && c.crm ? c.crm : d.crm;
      cEdit.hidden = !d.cli;
      if (d.kind === "cred") rebuildRefs();
      paintRc();
      touch();
    });
    var cliFld = el("div", "fld");
    var cl = el("label", "dlg-lbl", t("ed.client"));
    cl.setAttribute("for", cSel.id = "ed-cli");
    cliFld.appendChild(cl);
    cliFld.appendChild(cw);
    card.appendChild(cliFld);

    // Credit note: which invoice it corrects
    if (d.kind === "cred") {
      var rSel = el("select");
      edRefs.ref = rSel;
      rSel.addEventListener("change", function () { d.ref = rSel.value; touch(); });
      card.appendChild(field(t("ed.ref"), rSel));
      rebuildRefs();
    }
    // Record: its number
    if (isExt) {
      var nIn = input("text", d.num, C.LIM.num);
      nIn.addEventListener("input", function () { d.num = C.cleanText(nIn.value, C.LIM.num); touch(); });
      edRefs.num = nIn;
      card.appendChild(field(t("ed.num"), nIn, t("ed.numHint")));
    }
    // Dates + currency
    var dIn = input("date", d.date), uIn = input("date", d.due);
    dIn.addEventListener("change", function () {
      var old = d.date;
      d.date = C.validDay(dIn.value) ? dIn.value : "";
      if (d.date && old && d.due && C.validDay(old)) {   // keep the same payment period
        d.due = C.addDays(d.date, C.dayDiff(old, d.due));
        uIn.value = d.due;
      }
      renderEdSub();
      touch();
    });
    uIn.addEventListener("change", function () { d.due = C.validDay(uIn.value) ? uIn.value : ""; touch(); });
    var curSel = select(currencyOpts(d.cur), d.cur);
    curSel.addEventListener("change", function () { d.cur = curSel.value; touch(); });
    card.appendChild(row(field(t("ed.date"), dIn), field(t("ed.due"), uIn), field(t("ed.cur"), curSel, null, "narrow")));
    var chips = el("div", "chips");
    [[-1, t("ed.dueNone")], [0, t("ed.dueNow")], [15, t("ed.dueDays", { n: 15 })], [30, t("ed.dueDays", { n: 30 })],
     [60, t("ed.dueDays", { n: 60 })]].forEach(function (x) {
      var b = el("button", "chip-btn", x[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        d.due = x[0] < 0 ? "" : C.addDays(d.date || todayKey(), x[0]);
        uIn.value = d.due;
        touch();
      });
      chips.appendChild(b);
    });
    card.appendChild(chips);
    form.appendChild(card);

    if (isExt) {
      var amts = el("div", "card");
      var netIn = input("text", C.moneyInput(d.xnet, LANG)), vatIn = input("text", C.moneyInput(d.xvat, LANG));
      netIn.inputMode = vatIn.inputMode = "decimal";
      function readAmt(inp, key) {
        var v = C.parseMoney(inp.value);
        inp.classList.toggle("bad", isNaN(v));
        if (!isNaN(v)) d[key] = v;
        touch();
      }
      netIn.addEventListener("input", function () { readAmt(netIn, "xnet"); });
      vatIn.addEventListener("input", function () { readAmt(vatIn, "xvat"); });
      edRefs.xnet = netIn;
      edRefs.xvat = vatIn;
      amts.appendChild(row(field(t("ed.net"), netIn), field(t("ed.vatAmt"), vatIn)));
      var wIn = pctInput(d.wht, function (v) { d.wht = v; touch(); });
      amts.appendChild(field(t("ed.wht"), wIn, t("ed.whtHint")));
      var mIn = input("text", d.mark, C.LIM.mark);
      mIn.addEventListener("input", function () { d.mark = C.cleanText(mIn.value, C.LIM.mark); touch(); });
      amts.appendChild(field(t("ed.mark"), mIn, t("ed.markHint")));
      var nt = area(d.notes, 2, C.LIM.notes);
      nt.addEventListener("input", function () { d.notes = nt.value; touch(); });
      amts.appendChild(field(t("ed.notes"), nt));
      amts.appendChild(fileField(d));
      form.appendChild(amts);
    } else {
      // Items
      var lc = el("div", "card");
      lc.appendChild(el("h3", "sec-h", t("ed.lines")));
      var head = el("div", "ln-head");
      [t("ed.desc"), t("ed.qty"), t("ed.price"), t("ed.disc"), t("ed.vat"), t("ed.amount"), ""].forEach(function (h) {
        head.appendChild(el("span", "", h));
      });
      lc.appendChild(head);
      var box = el("div", "lines");
      edRefs.lines = box;
      lc.appendChild(box);
      var add = el("button", "wide-btn", null);
      add.type = "button";
      add.innerHTML = UI.plus + "<span></span>";
      add.lastChild.textContent = t("ed.addLine");
      add.addEventListener("click", function () {
        if (d.lines.length >= C.LIM.lines) return;
        d.lines.push({ code: "", d: "", q: 1, unit: "", p: 0, disc: 0, vat: data.prof.vat });
        renderLines();
        var last = box.lastChild && box.lastChild.querySelector("textarea");
        if (last) last.focus();
        touch();
      });
      lc.appendChild(add);
      var g = pctInput(d.gDisc, function (v) { d.gDisc = v; touch(); });
      var w = pctInput(d.wht, function (v) { d.wht = v; touch(); });
      lc.appendChild(row(field(t("ed.gDisc"), g), field(t("ed.wht"), w)));
      lc.appendChild(el("p", "hint", t("ed.whtHint")));
      // EU reverse charge helper (wave 3): offered, never applied alone
      var rc = el("div", "rc-box");
      rc.hidden = true;
      edRefs.rc = rc;
      lc.appendChild(rc);
      var tot = el("div", "totals");
      edRefs.totals = tot;
      lc.appendChild(tot);
      form.appendChild(lc);
      renderLines();

      // More: exemption, terms, notes, PDF language
      var more = el("details", "card more");
      more.appendChild(el("summary", "", t("ed.more")));
      var ex = area(d.exempt, 2, C.LIM.exempt);
      ex.addEventListener("input", function () { d.exempt = ex.value; paintRc(); touch(); });
      edRefs.exempt = ex;
      edRefs.more = more;
      more.appendChild(field(t("ed.exempt"), ex, t("ed.exemptHint")));
      var tm = area(d.terms, 3, C.LIM.terms);
      tm.addEventListener("input", function () { d.terms = tm.value; touch(); });
      edRefs.terms = tm;
      more.appendChild(field(t("ed.terms"), tm, t("ed.termsHint")));
      var no = area(d.notes, 3, C.LIM.notes);
      no.addEventListener("input", function () { d.notes = no.value; touch(); });
      more.appendChild(field(t("ed.notes"), no));
      var pl = select([["", t("ed.plangApp")], ["el", t("plang.el")], ["en", t("plang.en")]], d.plang);
      pl.addEventListener("change", function () { d.plang = pl.value; touch(); });
      more.appendChild(field(t("ed.plang"), pl));
      if (d.exempt || d.notes || (d.terms && d.terms !== data.prof.terms)) more.open = true;
      form.appendChild(more);
    }

    // Actions
    var bar = el("div", "ed-bar");
    var paid = el("label", "check");
    var pBox = el("input");
    pBox.type = "checkbox";
    pBox.checked = true;
    paid.appendChild(pBox);
    paid.appendChild(el("span", "", t("ed.paidNow")));
    paid.hidden = d.kind !== "rcpt";
    edRefs.paidRow = paid;
    edRefs.paidBox = pBox;
    bar.appendChild(paid);
    var acts = el("div", "ed-acts");
    if (isExt) {
      acts.appendChild(btn(t("ed.saveRecord"), "primary", saveRecord));
      if (!ed.isNew) acts.appendChild(btn(t("vw.delete"), "danger", function () { deleteRecord(d.id); }));
    } else {
      if (!ed.isNew) acts.appendChild(btn(t("ed.delete"), "danger", function () { deleteDraft(d.id); }));
      acts.appendChild(btn(t("ed.preview"), "", function () { if (validLines(true)) makePdf(previewDoc(), "save"); }));
      acts.appendChild(btn(t("ed.saveTpl"), "", function () { if (validLines(true)) templateDialog(d); }));
      acts.appendChild(el("span", "spacer"));
      acts.appendChild(btn(t("ed.saveDraft"), "", saveDraft));
      acts.appendChild(btn(t("ed.issue"), "primary", askIssue));
    }
    bar.appendChild(acts);
    form.appendChild(bar);
    renderEdTotals();
    paintRc();
  }
  function profName(pr) {
    var n = pr.trade || pr.name || "";
    return pr.id ? n || t("set.newBiz") : (n ? n + " (" + t("set.main") + ")" : t("set.main"));
  }
  // The reverse charge offer: a business client (VAT number) in another
  // EU country than the document's profile, and not applied yet.
  function rcLang(d) { return d.plang || data.prof.plang || LANG; }
  function paintRc() {
    if (!ed || !edRefs || !edRefs.rc) return;
    var d = ed.doc, box = edRefs.rc;
    var cl = C.client(data, d.cli);
    var fit = d.kind !== "ext" && d.kind !== "cred" && cl ? C.reverseCharge(C.profileOf(data, d.pid), cl) : null;
    var notes = [];
    Object.keys(RC_NOTES).forEach(function (l) { notes.push(RC_NOTES[l].services, RC_NOTES[l].goods); });
    var done = notes.indexOf((d.exempt || "").trim()) >= 0 && d.lines.every(function (l) { return !l.vat; });
    box.hidden = !fit || done;
    box.textContent = "";
    if (box.hidden) return;
    box.appendChild(el("p", "rc-txt", t("rc.fits", { c: fit.client })));
    var acts = el("div", "acts");
    ["services", "goods"].forEach(function (k) {
      acts.appendChild(btn(t("rc." + k), "", function () {
        d.lines.forEach(function (l) { l.vat = 0; });
        d.exempt = (RC_NOTES[rcLang(d)] || RC_NOTES.en)[k];
        if (edRefs.exempt) edRefs.exempt.value = d.exempt;
        if (edRefs.more) edRefs.more.open = true;
        renderLines();
        renderEdTotals();
        paintRc();
        touch();
        showToast(t("toast.rcDone"));
      }));
    });
    box.appendChild(acts);
  }
  function btn(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function pctInput(v, onChange) {
    var i = input("text", C.numInput(v, LANG));
    i.inputMode = "decimal";
    i.addEventListener("input", function () {
      var n = C.parseNum(i.value);
      var ok = !isNaN(n) && n >= 0 && n <= 100;
      i.classList.toggle("bad", !ok);
      if (ok) onChange(C.round(n, 2));
    });
    return i;
  }
  function rebuildSeries() {
    var d = ed.doc;
    if (!edRefs.ser) return;
    var list = C.seriesFor(data, d.kind);
    if (!d.ser || !C.series(data, d.ser) || C.series(data, d.ser).kind !== d.kind) d.ser = deviceSeries(d.kind);
    fillSelect(edRefs.ser, list.map(function (s) {
      return [s.id, C.fmtNum(s, +(d.date || todayKey()).slice(0, 4), C.nextSeq(data, s.id, d.date || todayKey()))];
    }), d.ser);
    edRefs.serFld.hidden = list.length < 2;
  }
  function rebuildRefs() {
    var d = ed.doc;
    if (!edRefs.ref) return;
    var opts = [["", t("ed.refNone")]];
    liveList("docs").filter(function (x) {
      return (x.kind === "inv" || x.kind === "rcpt" || x.kind === "ext") && x.st === "issued" && (!d.cli || x.cli === d.cli);
    }).sort(function (a, b) { return b.date < a.date ? -1 : 1; }).forEach(function (x) {
      opts.push([x.id, x.num + " · " + day(x.date) + " · " + money(C.totals(x).pay, x.cur)]);
    });
    fillSelect(edRefs.ref, opts, d.ref);
  }
  function renderEdSub() {
    if (!ed) return;
    var d = ed.doc, s;
    if (d.kind === "ext") s = t("ed.subRecord");
    else {
      var ser = C.series(data, d.ser || deviceSeries(d.kind));
      s = (ed.isNew ? t("ed.subNew") : t("ed.subDraft"));
      if (ser) s += " · " + t("ed.subNext", { n: C.fmtNum(ser, +(d.date || todayKey()).slice(0, 4), C.nextSeq(data, ser.id, d.date || todayKey())) });
    }
    $("ed-sub").textContent = s;
  }

  // Item rows: description, qty, price, disc, VAT, amount; a code and a
  // unit sit under the description (small, optional).
  function renderLines() {
    var d = ed.doc, box = edRefs.lines;
    box.textContent = "";
    d.lines.forEach(function (l, i) {
      var r = el("div", "ln");
      var dsc = area(l.d, 1, C.LIM.desc);
      dsc.className = "ln-d";
      dsc.placeholder = t("ed.desc");
      dsc.setAttribute("aria-label", t("ed.desc"));
      dsc.addEventListener("input", function () { l.d = dsc.value; autosize(dsc); touch(); });
      var meta = el("div", "ln-meta");
      var code = input("text", l.code, C.LIM.code);
      code.placeholder = t("ed.code");
      code.setAttribute("aria-label", t("ed.code"));
      code.addEventListener("input", function () { l.code = code.value; touch(); });
      var unit = input("text", l.unit, C.LIM.unit);
      unit.placeholder = t("ed.unit");
      unit.setAttribute("aria-label", t("ed.unit"));
      unit.addEventListener("input", function () { l.unit = unit.value; touch(); });
      meta.appendChild(code);
      meta.appendChild(unit);
      var dw = el("div", "ln-dw");
      dw.appendChild(dsc);
      dw.appendChild(meta);
      r.appendChild(dw);
      var q = numCell(C.numInput(l.q, LANG), t("ed.qty"), function (v) {
        var n = C.parseNum(v);
        if (isNaN(n) || Math.abs(n) > C.LIM.qty) return false;
        l.q = C.round(n, 3);
        return true;
      });
      var p = numCell(C.moneyInput(l.p, LANG), t("ed.price"), function (v) {
        var n = C.parseMoney(v);
        if (isNaN(n)) return false;
        l.p = n;
        return true;
      });
      var ds = numCell(l.disc ? C.numInput(l.disc, LANG) : "", t("ed.disc"), function (v) {
        var n = C.parseNum(v);
        if (isNaN(n) || n < 0 || n > 100) return false;
        l.disc = C.round(n, 2);
        return true;
      });
      var vt = numCell(C.numInput(l.vat, LANG), t("ed.vat"), function (v) {
        var n = C.parseNum(v);
        if (isNaN(n) || n < 0 || n > 100) return false;
        l.vat = C.round(n, 2);
        return true;
      });
      [q, p, ds, vt].forEach(function (c) { r.appendChild(c); });
      var amt = el("span", "ln-amt");
      amt.setAttribute("data-l", t("ed.amount"));
      r.appendChild(amt);
      var tools = el("div", "ln-tools");
      if (i > 0) {
        var up = el("button", "icon-btn sm", null);
        up.type = "button";
        up.innerHTML = UI.up;
        up.title = t("ed.up");
        up.setAttribute("aria-label", t("ed.up"));
        up.addEventListener("click", function () {
          d.lines.splice(i - 1, 0, d.lines.splice(i, 1)[0]);
          renderLines();
          touch();
        });
        tools.appendChild(up);
      }
      var rm = el("button", "icon-btn sm", null);
      rm.type = "button";
      rm.innerHTML = UI.x;
      rm.title = t("ed.removeLine");
      rm.setAttribute("aria-label", t("ed.removeLine"));
      rm.addEventListener("click", function () {
        d.lines.splice(i, 1);
        renderLines();
        touch();
      });
      tools.appendChild(rm);
      r.appendChild(tools);
      box.appendChild(r);
      setTimeout(function () { autosize(dsc); }, 0);
    });
    renderEdTotals();
  }
  function numCell(value, label, apply) {
    var w = el("label", "ln-n");
    w.appendChild(el("span", "ln-l", label));
    var i = input("text", value);
    i.inputMode = "decimal";
    i.addEventListener("input", function () {
      var ok = apply(i.value);
      i.classList.toggle("bad", !ok);
      if (ok) touch();
    });
    w.appendChild(i);
    return w;
  }
  function autosize(a) {
    a.style.height = "auto";
    a.style.height = Math.min(a.scrollHeight + 2, 160) + "px";
  }
  function renderEdTotals() {
    if (!ed || !edRefs) return;
    var d = ed.doc;
    if (d.kind === "ext" || !edRefs.totals) return;
    var nd = C.normDoc(Object.assign({}, d, { m: 1 }));
    var rows = edRefs.lines ? edRefs.lines.children : [];
    nd.lines.forEach(function (l, i) {
      var a = rows[i] && rows[i].querySelector(".ln-amt");
      if (a) a.textContent = money(C.lineNet(l), d.cur);
    });
    totalsBlock(edRefs.totals, nd, null);
  }
  // The totals table (editor, viewer): subtotal, discount, net, VAT per
  // rate, total, withholding, payable; plus paid/balance on the viewer.
  function totalsBlock(box, d, paidInfo) {
    var tt = C.totals(d);
    box.textContent = "";
    function line(label, val, cls) {
      var r = el("div", "tot-row" + (cls ? " " + cls : ""));
      r.appendChild(el("span", "", label));
      r.appendChild(el("span", "tot-v", val));
      box.appendChild(r);
    }
    if (d.kind !== "ext") {
      if (tt.disc) { line(t("tot.sub"), money(tt.sub, d.cur)); line(t("tot.disc"), "−" + money(tt.disc, d.cur)); }
      line(t("tot.net"), money(tt.net, d.cur));
      tt.rates.forEach(function (r) { line(t("tot.vat", { r: C.fmtNumber(r.rate, LANG, 2) }), money(r.vat, d.cur)); });
    } else {
      line(t("tot.net"), money(tt.net, d.cur));
      line(t("tot.vatAll"), money(tt.vat, d.cur));
    }
    line(t("tot.total"), money(tt.total, d.cur), tt.wht ? "" : "grand");
    if (tt.wht) {
      line(t("tot.wht", { r: C.fmtNumber(d.wht, LANG, 2) }), "−" + money(tt.wht, d.cur));
      line(t("tot.pay"), money(tt.pay, d.cur), "grand");
    }
    if (paidInfo) {
      line(t("tot.paid"), money(paidInfo.paid, d.cur));
      line(t("tot.bal"), money(paidInfo.bal, d.cur), paidInfo.bal > 0 ? "bal" : "");
    }
  }

  function validLines(quiet) {
    var d = ed.doc;
    var ok = d.lines.some(function (l) { return C.cleanBlock(l.d, 10); });
    if (!ok && quiet) showToast(t("toast.needLine"));
    if (edRefs.lines && edRefs.lines.querySelector("input.bad")) { showToast(t("toast.badNum", { f: t("ed.lines") })); return false; }
    return ok;
  }
  // The working copy, cleaned, with empty lines left out.
  function cleaned(d) {
    var copy = JSON.parse(JSON.stringify(d));
    copy.lines = (copy.lines || []).filter(function (l) { return C.cleanBlock(l.d, 10) || l.p; });
    var c = C.client(data, copy.cli);
    if (c) copy.c = C.partyOfClient(c);
    return copy;
  }
  function previewDoc() {
    var p = C.normDoc(Object.assign(cleaned(ed.doc), { m: 1 }));
    p.s = C.normSeller(C.profileOf(data, p.pid));
    return p;
  }
  function saveDraft() {
    if (!ed) return;
    if (edRefs.lines && edRefs.lines.querySelector("input.bad")) { showToast(t("toast.badNum", { f: t("ed.lines") })); return; }
    var d = cleaned(ed.doc);
    if (!d.date) { showToast(t("toast.badDate")); return; }
    var cur = C.anyId(data.docs, d.id);
    if (cur && !cur.del && cur.st !== "draft") { showToast(t("toast.gone")); return; }
    putDoc(d);
    ed.doc = JSON.parse(JSON.stringify(findDoc(d.id)));
    ed.isNew = false;
    ed.dirty = false;
    shelter();
    $("ed-title").textContent = t("ed.draft", { k: kindName(ed.doc.kind) });
    renderEdSub();
    showToast(t("toast.draftSaved"));
  }
  function askIssue() {
    if (!ed) return;
    var d = ed.doc;
    if (!validLines(true)) return;
    if ((d.kind === "inv" || d.kind === "cred") && !d.cli) { showToast(t("toast.needClient", { k: kindName(d.kind) })); return; }
    if (d.kind === "cred" && !d.ref) { showToast(t("toast.needRef")); return; }
    if (!C.validDay(d.date) || (d.due && d.due < d.date)) { showToast(t("toast.badDate")); return; }
    if (!data.prof.name) { setupFirst(true); return; }
    var serId = d.ser && C.series(data, d.ser) ? d.ser : deviceSeries(d.kind);
    var s = C.series(data, serId);
    var next = C.fmtNum(s, +d.date.slice(0, 4), C.nextSeq(data, serId, d.date));
    var text = t("iss.text");
    var later = C.numbered(data, serId, d.date).filter(function (x) { return x.date > d.date; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (later.length) text += "\n\n" + t("iss.early", { n: later[0].num, d: day(later[0].date) });
    confirmDialog(t("iss.title", { n: next }), text, t("iss.go"), function () {
      var paidNow = d.kind === "rcpt" && edRefs.paidBox && edRefs.paidBox.checked;
      var x = cleaned(d);
      x.ser = serId;
      var cur = C.anyId(data.docs, x.id);
      if (cur && !cur.del && cur.st !== "draft") { showToast(t("toast.gone")); return; }
      var done = issueDoc(x, paidNow);
      ed = null;
      shelter();
      showToast(t("toast.issued", { n: done.num }));
      openDoc(done.id);
    });
  }
  function saveRecord() {
    if (!ed) return;
    var d = cleaned(ed.doc);
    if (!d.num) { showToast(t("toast.needNum")); return; }
    if (!C.validDay(d.date) || (d.due && d.due < d.date)) { showToast(t("toast.badDate")); return; }
    if ((edRefs.xnet && edRefs.xnet.classList.contains("bad")) || (edRefs.xvat && edRefs.xvat.classList.contains("bad"))) {
      showToast(t("toast.badNum", { f: t("ed.net") }));
      return;
    }
    if (!d.xnet && !d.xvat) { showToast(t("toast.needAmt")); return; }
    d.st = "issued";
    putDoc(d);
    ed = null;
    shelter();
    showToast(t("toast.recorded"));
    openDoc(d.id);
  }
  function deleteDraft(id) {
    var d = findDoc(id);
    ed = null;
    shelter();
    if (d && d.st === "draft") {
      replaceIn(data.docs, tombOf(d));
      saveNow();
      undoToast(t("toast.deleted"), function () { restore("docs", d); saveNow(); renderAll(); });
    }
    showView(tab);
  }
  function deleteRecord(id) {
    var d = findDoc(id);
    if (!d || d.kind !== "ext") return;
    confirmDialog(t("vw.delTitle"), t("vw.delText"), t("vw.delete"), function () {
      var pays = C.paysOf(data, id);
      replaceIn(data.docs, tombOf(d));
      pays.forEach(function (p) { replaceIn(data.pays, tombOf(p)); });
      saveNow();
      ed = null;
      shelter();
      showView(tab);
      undoToast(t("toast.recDeleted"), function () {
        restore("docs", d);
        pays.forEach(function (p) { restore("pays", p); });
        saveNow();
        renderAll();
      });
    }, true);
  }

  // ---------- 8. Viewer ----------
  function openDoc(id) {
    var d = findDoc(id);
    if (!d) { showToast(t("toast.gone")); return; }
    if (d.st === "draft") { editDoc(id); return; }
    viewId = id;
    showView("view");
  }
  function renderViewer() {
    var d = findDoc(viewId);
    if (!d) { showView(tab); return; }
    var today = todayKey(), st = C.status(data, d, today);
    $("vw-back").innerHTML = UI.left;
    $("vw-back").title = t("back");
    $("vw-back").setAttribute("aria-label", t("back"));
    $("vw-title").textContent = kindName(d.kind) + " " + (d.num || "");
    var sub = [C.partyName(data, d)];
    if (d.sent) sub.push(t("vw.sentOn", { d: day(d.sent) }));
    $("vw-sub").textContent = sub.filter(Boolean).join(" · ");
    var chip = $("vw-chip");
    chip.className = "chip st-" + st;
    chip.textContent = statusName(st);

    var acts = $("vw-acts");
    acts.textContent = "";
    var bal = C.balance(data, d);
    if (d.kind !== "ext") acts.appendChild(btn(t("vw.pdf"), "primary", function () { makePdf(d, "save"); }));
    if (d.kind !== "ext" && canShareFiles()) acts.appendChild(btn(t("vw.share"), "", function () { makePdf(d, "share"); }));
    if (d.file) acts.appendChild(btn(t("ed.file") + ": " + t("ed.fileOpen"), d.kind === "ext" ? "primary" : "", function () { openFile(d); }));
    if (d.st === "issued" && C.owes(d) && bal > 0) {
      acts.appendChild(btn(t("vw.paid"), "", function () {
        var p = addPayment(d.id, bal, todayKey(), "bank", "");
        renderViewer();
        undoToast(t("toast.payAdded", { a: money(p.amt, d.cur) }), function () {
          replaceIn(data.pays, tombOf(p)); saveNow(); renderAll();
        });
      }));
      acts.appendChild(btn(t("vw.pay"), "", function () { paymentDialog(d, null); }));
    }
    var email = (d.c && d.c.email) || "";
    if (d.st === "issued") acts.appendChild(btn(t("vw.email"), "", function () { sendEmail(d); }));
    if (d.st === "issued" && C.owes(d) && bal > 0 && d.due && d.due <= C.addDays(todayKey(), 7)) {
      acts.appendChild(btn(t("vw.remind"), "", function () { reminderDialog(d); }));
    }
    if (d.st === "issued" && !d.sent) acts.appendChild(btn(t("vw.sent"), "", function () {
      var x = JSON.parse(JSON.stringify(d));
      x.sent = todayKey();
      putDoc(x);
      showToast(t("toast.sent"));
      renderViewer();
    }));
    if (d.kind === "ext") acts.appendChild(btn(t("vw.edit"), "", function () { editDoc(d.id); }));
    if (d.kind !== "ext") acts.appendChild(btn(t("vw.dup"), "", function () { duplicate(d); }));
    if (d.st === "issued" && (d.kind === "inv" || d.kind === "rcpt")) acts.appendChild(btn(t("vw.credit"), "", function () { creditFor(d); }));
    if (d.st === "issued" && d.kind === "pro") acts.appendChild(btn(t("vw.convert"), "", function () { convertPro(d); }));
    var stockReq = stockShell() ? C.stockOut(d) : null;
    if (stockReq) acts.appendChild(btn(t(stockReq.t === "ret" ? "vw.stockRet" : "vw.stockOut"), "", function () {
      var sh = stockShell();
      if (sh) sh.__orosOpenAt("stock", { out: stockReq });
    }));
    if (MD) MD.actions(d, acts);
    if (d.st === "issued" && d.kind !== "ext") acts.appendChild(btn(t("vw.void"), "danger", function () { voidDoc(d); }));
    if (d.kind === "ext") acts.appendChild(btn(t("vw.delete"), "danger", function () { deleteRecord(d.id); }));
    void email;

    var body = $("vw-body");
    body.textContent = "";
    body.appendChild(paperOf(d));
    // Payments
    if (C.owes(d) || C.paysOf(data, d.id).length) {
      var pc = el("div", "card");
      pc.appendChild(el("h3", "sec-h", t("vw.pays")));
      var pays = C.paysOf(data, d.id);
      if (!pays.length) pc.appendChild(el("p", "hint", t("vw.noPays")));
      var ul = el("ul", "pays");
      pays.forEach(function (p) {
        var li = el("li", "pay");
        var b = el("button", "pay-main");
        b.type = "button";
        b.appendChild(el("span", "pay-d", day(p.date)));
        b.appendChild(el("span", "pay-h", howName(p.how) + (p.note ? " · " + p.note : "")));
        b.appendChild(el("span", "pay-a", money(p.amt, d.cur)));
        b.addEventListener("click", function () { paymentDialog(d, p); });
        li.appendChild(b);
        if (p.amt > 0 && budgetFor(d.cur)) {
          var bb = el("button", "mini-btn bud" + (p.bud ? " on" : ""), p.bud ? "\u2713 " + t("pay.inBudget") : t("pay.toBudget"));
          bb.type = "button";
          bb.addEventListener("click", function () { sendToBudget(d, p); });
          li.appendChild(bb);
        }
        ul.appendChild(li);
      });
      pc.appendChild(ul);
      var credits = C.creditsOf(data, d.id);
      if (credits.length) {
        pc.appendChild(el("h3", "sec-h", t("vw.credits")));
        credits.forEach(function (c) {
          var lb = el("button", "link-btn", c.num + " · " + money(C.totals(c).pay, c.cur));
          lb.type = "button";
          lb.addEventListener("click", function () { openDoc(c.id); });
          pc.appendChild(lb);
        });
      }
      // Only what is owed: the full totals are on the paper above.
      var tb = el("div", "totals");
      [[t("tot.pay"), money(C.totals(d).pay, d.cur), ""], [t("tot.paid"), money(C.paidOf(data, d.id), d.cur), ""],
       [t("tot.bal"), money(Math.max(0, bal), d.cur), bal > 0 ? "grand bal" : "grand"]].forEach(function (x) {
        var r = el("div", "tot-row" + (x[2] ? " " + x[2] : ""));
        r.appendChild(el("span", "", x[0]));
        r.appendChild(el("span", "tot-v", x[1]));
        tb.appendChild(r);
      });
      pc.appendChild(tb);
      body.appendChild(pc);
    }
    // myDATA (sent through timologisi.online): ΜΑΡΚ, UID, code, official PDF
    var mdCard = MD ? MD.card(d) : null;
    if (mdCard) body.appendChild(mdCard);
    // ΜΑΡΚ + official PDF (records and issued documents)
    var mc = el("div", "card");
    if (MD && MD.locked(d)) {                      // the ΜΑΡΚ came from myDATA: not typed over
      if (d.kind !== "ext") mc.appendChild(fileField(d, true));
      body.appendChild(mc);
      return;
    }
    var mIn = input("text", d.mark, C.LIM.mark);
    var mSave = btn(t("dlg.save"), "", function () {
      var x = JSON.parse(JSON.stringify(findDoc(d.id)));
      x.mark = C.cleanText(mIn.value, C.LIM.mark);
      putDoc(x);
      showToast(t("toast.markSaved"));
      renderViewer();
    });
    var mw = el("div", "cli-pick");
    mw.appendChild(mIn);
    mw.appendChild(mSave);
    var mf = el("div", "fld");
    var ml = el("label", "dlg-lbl", t("ed.mark"));
    ml.setAttribute("for", mIn.id = "vw-mark");
    mf.appendChild(ml);
    mf.appendChild(mw);
    mc.appendChild(mf);
    if (d.kind !== "ext") mc.appendChild(fileField(d, true));
    body.appendChild(mc);
  }
  // The document as a sheet of paper (same content as the PDF).
  function paperOf(d) {
    var p = el("div", "paper");
    var s = C.sellerOf(data, d), c = d.c || {};
    var head = el("div", "pp-head");
    var from = el("div", "pp-party");
    if (d.kind !== "ext") {
      from.appendChild(el("div", "pp-lbl", t("vw.from")));
      partyLines(from, s);
    }
    var meta = el("div", "pp-meta");
    meta.appendChild(el("div", "pp-kind", kindName(d.kind)));
    meta.appendChild(el("div", "pp-no", d.num));
    meta.appendChild(el("div", "pp-dates", d.due ? t("vw.dates", { d: day(d.date), u: day(d.due) }) : t("vw.date", { d: day(d.date) })));
    if (d.mark) meta.appendChild(el("div", "pp-dates", t("vw.mark") + " " + d.mark));
    if (d.kind === "cred" && d.ref) {
      var r = C.anyId(data.docs, d.ref);
      if (r && !r.del) {
        var rb = el("button", "link-btn", t("vw.corrects", { n: r.num }));
        rb.type = "button";
        rb.addEventListener("click", function () { openDoc(r.id); });
        meta.appendChild(rb);
      }
    }
    var conv = liveList("docs").filter(function (x) { return x.ref === d.id && d.kind === "pro" && x.kind === "inv"; })[0];
    if (conv) {
      var cb = el("button", "link-btn", t("vw.converted", { n: docLabel(conv) }));
      cb.type = "button";
      cb.addEventListener("click", function () { openDoc(conv.id); });
      meta.appendChild(cb);
    }
    head.appendChild(from);
    head.appendChild(meta);
    p.appendChild(head);
    if (c.name) {
      var to = el("div", "pp-party pp-to");
      to.appendChild(el("div", "pp-lbl", t("vw.to")));
      partyLines(to, c);
      p.appendChild(to);
    }
    if (d.kind !== "ext" && d.lines.length) {
      var wrap = el("div", "grid-wrap");
      var tb = el("table", "tbl pp-lines");
      var hr = el("tr");
      [t("ed.desc"), t("ed.qty"), t("ed.price"), t("ed.vat"), t("ed.amount")].forEach(function (h, i) {
        hr.appendChild(el("th", i ? "num" : "", h));
      });
      var th = el("thead");
      th.appendChild(hr);
      tb.appendChild(th);
      var tbody = el("tbody");
      d.lines.forEach(function (l) {
        var tr = el("tr");
        var dc = el("td", "pp-d");
        dc.appendChild(el("div", "", l.d));
        var small = [l.code, l.disc ? t("ed.disc") + " " + C.fmtNumber(l.disc, LANG, 2) : ""].filter(Boolean).join(" · ");
        if (small) dc.appendChild(el("small", "", small));
        tr.appendChild(dc);
        tr.appendChild(el("td", "num", C.fmtNumber(l.q, LANG) + (l.unit ? " " + l.unit : "")));
        tr.appendChild(el("td", "num", money(l.p, d.cur)));
        tr.appendChild(el("td", "num", C.fmtNumber(l.vat, LANG, 2) + " %"));
        tr.appendChild(el("td", "num", money(C.lineNet(l), d.cur)));
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      wrap.appendChild(tb);
      p.appendChild(wrap);
    }
    var tot = el("div", "totals");
    totalsBlock(tot, d, null);
    p.appendChild(tot);
    [[t("ed.exempt"), d.exempt], [t("ed.terms"), d.terms], [t("ed.notes"), d.notes]].forEach(function (x) {
      if (!x[1]) return;
      var b = el("div", "pp-block");
      b.appendChild(el("div", "pp-lbl", x[0]));
      b.appendChild(el("div", "pp-text", x[1]));
      p.appendChild(b);
    });
    return p;
  }
  function partyLines(box, s) {
    box.appendChild(el("div", "pp-name", s.name || "—"));
    if (s.trade) box.appendChild(el("div", "", s.trade));
    if (s.job) box.appendChild(el("div", "", s.job));
    if (s.addr) box.appendChild(el("div", "pp-text", s.addr));
    if (s.country) box.appendChild(el("div", "", s.country));
    var tax = [s.afm ? t("c.afm") + ": " + s.afm : "", s.doy ? t("c.doy") + ": " + s.doy : ""].filter(Boolean).join(" · ");
    if (tax) box.appendChild(el("div", "", tax));
    var contact = [s.phone, s.email].filter(Boolean).join(" · ");
    if (contact) box.appendChild(el("div", "pp-dim", contact));
  }

  function duplicate(d) {
    newDoc(d.kind === "cred" ? "inv" : d.kind, function (x) {
      x.cli = C.client(data, d.cli) ? d.cli : "";
      var cl = C.client(data, x.cli);
      x.c = cl ? C.partyOfClient(cl) : C.normParty(d.c);
      x.cur = d.cur;
      x.lines = JSON.parse(JSON.stringify(d.lines));
      x.gDisc = d.gDisc; x.wht = d.wht; x.exempt = d.exempt; x.terms = d.terms; x.notes = d.notes; x.plang = d.plang;
      x.crm = d.crm;
      keepProfile(x, d);
    });
  }
  // A copy of a document stays with its business profile (wave 3).
  function keepProfile(x, d) {
    if (d.pid && C.byId(data.profs, d.pid)) {
      x.pid = d.pid;
      x.ser = C.seriesForProfile(data, x.kind, x.pid, x.ser);
    }
  }
  function creditFor(d) {
    newDoc("cred", function (x) {
      x.cli = d.cli;
      x.c = C.normParty(d.c);
      x.cur = d.cur;
      x.ref = d.id;
      x.crm = d.crm;
      x.lines = JSON.parse(JSON.stringify(d.lines));
      x.gDisc = d.gDisc; x.wht = d.wht; x.exempt = d.exempt; x.plang = d.plang;
      x.terms = "";
      x.due = "";
      keepProfile(x, d);
    });
  }
  function convertPro(d) {
    newDoc("inv", function (x) {
      x.cli = d.cli;
      x.c = C.normParty(d.c);
      x.cur = d.cur;
      x.ref = d.id;
      x.crm = d.crm;
      x.lines = JSON.parse(JSON.stringify(d.lines));
      x.gDisc = d.gDisc; x.wht = d.wht; x.exempt = d.exempt; x.terms = d.terms; x.notes = d.notes; x.plang = d.plang;
      keepProfile(x, d);
    });
    showToast(t("toast.converted"));
  }
  function voidDoc(d) {
    if (MD && MD.locked(d)) {                      // in myDATA: corrected by a credit note, never cancelled here
      if (d.kind === "inv" || d.kind === "rcpt") confirmDialog(t("vw.voidTitle", { n: d.num }), MD.lockedText("void"), t("vw.credit"), function () { creditFor(d); });
      else showToast(MD.lockedText("void"));
      return;
    }
    confirmDialog(t("vw.voidTitle", { n: d.num }), t("vw.voidText"), t("vw.voidGo"), function () {
      var before = JSON.parse(JSON.stringify(d));
      var x = JSON.parse(JSON.stringify(d));
      x.st = "void";
      putDoc(x);
      renderViewer();
      undoToast(t("toast.voided", { n: d.num }), function () {
        var back = before;
        back.m = findDoc(d.id) ? findDoc(d.id).m : back.m;
        putDoc(back);
        renderAll();
      });
    }, true);
  }

  // ---------- 9. Dialogs ----------
  function makeDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function actions(form, left, okLabel, danger) {
    var acts = el("div", "dlg-actions");
    (left || []).forEach(function (b) { acts.appendChild(b); });
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn(t("dlg.cancel"), "", function () { form.closest("dialog").close(); }));
    var ok = btn(okLabel || t("dlg.save"), danger ? "danger-fill" : "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
  }
  function openDialog(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) { focus.focus(); if (focus.select) try { focus.select(); } catch (e) {} }
  }
  function confirmDialog(title, text, okLabel, onOk, danger) {
    var dlg = makeDialog("inv-confirm", title);
    var form = el("form");
    form.method = "dialog";
    String(text || "").split("\n\n").forEach(function (para) { form.appendChild(el("p", "dlg-text", para)); });
    actions(form, [], okLabel, danger);
    form.addEventListener("submit", function (e) { e.preventDefault(); dlg.close(); onOk(); });
    dlg.appendChild(form);
    openDialog(dlg, form.querySelector("button[type=submit]"));
  }

  // A client: new (id null) or existing. done(client) after Save.
  function clientDialog(id, done, prefill) {
    var c = id ? C.client(data, id) : null;
    if (id && !c) return;
    var src = c || prefill || {};
    var dlg = makeDialog("inv-client", t("c.title"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var f = {};
    function txt(key, label, max, type) {
      f[key] = input(type || "text", src[key] || "", max);
      return field(label, f[key]);
    }
    form.appendChild(txt("name", t("c.name"), C.LIM.name));
    form.appendChild(row(txt("afm", t("c.afm"), 60), txt("doy", t("c.doy"), 60)));
    form.appendChild(txt("job", t("c.job"), C.LIM.name));
    f.addr = area(src.addr || "", 2, C.LIM.addr);
    form.appendChild(field(t("c.addr"), f.addr));
    form.appendChild(row(txt("country", t("c.country"), 60), txt("phone", t("c.phone"), 40, "tel")));
    form.appendChild(txt("email", t("c.email"), 120, "email"));
    f.note = area(src.note || "", 2, C.LIM.note);
    form.appendChild(field(t("c.note"), f.note));
    var left = [];
    if (c) {
      var n = liveList("docs").filter(function (d) { return d.cli === c.id; }).length;
      left.push(btn(t("c.delete"), "danger", function () {
        dlg.close();
        var del = function () {
          replaceIn(data.clients, tombOf(c));
          saveNow();
          renderAll();
          undoToast(t("toast.cliDel"), function () { restore("clients", c); saveNow(); renderAll(); });
        };
        if (n) confirmDialog(t("c.delete") + " · " + c.name, t("c.busy", { n: n }), t("c.delete"), del, true);
        else del();
      }));
      if (!done) {
        left.push(btn(t("c.newInv"), "", function () {
          dlg.close();
          newDoc("inv", function (x) { x.cli = c.id; x.c = C.partyOfClient(c); x.crm = c.crm || ""; });
        }));
        if (n) left.push(btn(t("c.showDocs"), "", function () { dlg.close(); cliFilter = c.id; setTab("docs"); }));
        if (C.statement(data, c.id).rows.length) left.push(btn(t("c.statement"), "", function () { makeStatement(c.id); }));
      }
    }
    actions(form, left, t("dlg.save"));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = C.cleanText(f.name.value, C.LIM.name);
      if (!name) { showToast(t("toast.needName")); f.name.focus(); return; }
      var rec = c ? JSON.parse(JSON.stringify(c)) : { id: C.newId(), m: 0 };
      rec.name = name;
      ["afm", "doy", "job", "country", "phone", "email"].forEach(function (k) { rec[k] = f[k].value; });
      rec.addr = f.addr.value;
      rec.note = f.note.value;
      if (!c && prefill && prefill.crm) rec.crm = prefill.crm;
      putClient(C.normClient(Object.assign(rec, { m: rec.m || 1 })) || rec);
      var saved = C.client(data, rec.id);
      dlg.close();
      showToast(t("toast.cliSaved"));
      if (done && saved) done(saved);
      else renderAll();
    });
    dlg.appendChild(form);
    openDialog(dlg, c ? null : f.name);
  }

  function paymentDialog(d, p) {
    var dlg = makeDialog("inv-pay", t("pay.title") + " · " + d.num);
    var form = el("form");
    form.method = "dialog";
    var bal = C.balance(data, d);
    var a = input("text", C.moneyInput(p ? p.amt : Math.max(0, bal), LANG));
    a.inputMode = "decimal";
    var dt = input("date", p ? p.date : todayKey());
    var how = select(C.HOWS.map(function (h) { return [h, howName(h)]; }), p ? p.how : "bank");
    var note = input("text", p ? p.note : "", 120);
    form.appendChild(row(field(t("pay.amt") + " (" + d.cur + ")", a), field(t("pay.date"), dt)));
    form.appendChild(field(t("pay.how"), how));
    form.appendChild(field(t("pay.note"), note));
    var left = [];
    if (p) left.push(btn(t("pay.del"), "danger", function () { dlg.close(); deletePayment(p); }));
    actions(form, left, t("dlg.save"));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var amt = C.parseMoney(a.value);
      if (isNaN(amt) || !amt) { showToast(t("toast.badNum", { f: t("pay.amt") })); a.focus(); return; }
      if (!C.validDay(dt.value)) { showToast(t("toast.badDate")); return; }
      if (p) {
        var x = JSON.parse(JSON.stringify(p));
        x.amt = amt; x.date = dt.value; x.how = how.value; x.note = C.cleanText(note.value, 120);
        x.m = stamp(x.m);
        replaceIn(data.pays, x);
        saveNow();
      } else addPayment(d.id, amt, dt.value, how.value, C.cleanText(note.value, 120));
      dlg.close();
      if (!p) showToast(t("toast.payAdded", { a: money(amt, d.cur) }));
      renderAll();
    });
    dlg.appendChild(form);
    openDialog(dlg, a);
  }

  // The "New" menu.
  function newMenu() {
    var dlg = makeDialog("inv-new", t("new.title"));
    var list = el("div", "menu-list");
    function item(kind, hint, fn) {
      var b = el("button", "menu-item");
      b.type = "button";
      b.appendChild(el("span", "mi-t", kind));
      b.appendChild(el("span", "mi-h", hint));
      b.addEventListener("click", function () { dlg.close(); fn(); });
      list.appendChild(b);
    }
    item(t("new.inv"), t("new.invHint"), function () { newDoc("inv"); });
    item(t("new.rcpt"), t("new.rcptHint"), function () { newDoc("rcpt"); });
    item(t("new.pro"), t("new.proHint"), function () { newDoc("pro"); });
    item(t("new.cred"), t("new.credHint"), function () { newDoc("cred"); });
    item(t("new.ext"), t("new.extHint"), function () { newDoc("ext"); });
    var tpls = liveList("tpls");
    if (tpls.length) item(t("new.tpl"), t("new.tplHint", { n: tpls.length }), templatePicker);
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    openDialog(dlg, list.firstChild);
  }

  // A searchable list to pick from. rows: [{ key, title, sub, have }]
  function pickDialog(title, rows, onPick, multi) {
    var dlg = makeDialog("inv-pick", title);
    dlg.classList.add("wide");
    var q = input("search", "");
    q.placeholder = t("pick.search");
    q.setAttribute("aria-label", t("pick.search"));
    dlg.appendChild(q);
    var list = el("div", "pick-list");
    dlg.appendChild(list);
    var chosen = {};
    var go = btn(t("pick.add", { n: 0 }), "primary", function () {
      var keys = Object.keys(chosen).filter(function (k) { return chosen[k]; });
      dlg.close();
      onPick(rows.filter(function (r) { return keys.indexOf(r.key) >= 0; }));
    });
    function paint() {
      var f = C.fold(q.value);
      list.textContent = "";
      var shown = rows.filter(function (r) { return !f || C.fold(r.title + " " + r.sub).indexOf(f) >= 0; }).slice(0, 300);
      if (!shown.length) list.appendChild(el("p", "hint", t("pick.none")));
      shown.forEach(function (r) {
        if (multi) {
          var lab = el("label", "pick-row check");
          var box = el("input");
          box.type = "checkbox";
          box.checked = !!chosen[r.key];
          box.disabled = !!r.have;
          box.addEventListener("change", function () {
            chosen[r.key] = box.checked;
            var n = Object.keys(chosen).filter(function (k) { return chosen[k]; }).length;
            go.textContent = t("pick.add", { n: n });
            go.disabled = !n;
          });
          lab.appendChild(box);
          var tx = el("span", "pick-t");
          tx.appendChild(el("span", "", r.title));
          tx.appendChild(el("small", "", [r.sub, r.have ? t("pick.have") : ""].filter(Boolean).join(" · ")));
          lab.appendChild(tx);
          list.appendChild(lab);
        } else {
          var b = el("button", "pick-row");
          b.type = "button";
          var tx2 = el("span", "pick-t");
          tx2.appendChild(el("span", "", r.title));
          if (r.sub) tx2.appendChild(el("small", "", r.sub));
          b.appendChild(tx2);
          b.addEventListener("click", function () { dlg.close(); onPick([r]); });
          list.appendChild(b);
        }
      });
    }
    q.addEventListener("input", paint);
    paint();
    var acts = el("div", "dlg-actions");
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn(t("dlg.cancel"), "", function () { dlg.close(); }));
    if (multi) { go.disabled = true; acts.appendChild(go); }
    dlg.appendChild(acts);
    openDialog(dlg, q);
  }

  // Read another app's slice (read-only); null when absent or not usable.
  // Budget bridge (BR-B1): Budget opens its New entry form PREFILLED
  // with the payment as Freelance income; nothing is written until the
  // user saves there. Offered when the shell has the bridge and the
  // payment's currency is Budget's (one currency there, no conversion).
  function budgetFor(cur) {
    var open = null;
    try {
      var par = window.parent;
      open = par && par !== window && typeof par.__orosOpenBudgetNew === "function" ? par.__orosOpenBudgetNew : null;
    } catch (e) { open = null; }
    if (!open) return null;
    var bcur = "EUR";
    try {
      var o = JSON.parse(localStorage.getItem("oros-budget-data") || "null");
      if (o && o.set && typeof o.set.cur === "string" && o.set.cur) bcur = o.set.cur;
    } catch (e) {}
    return bcur === cur ? open : null;
  }
  function sendToBudget(d, p) {
    var open = budgetFor(d.cur);
    if (!open) return;
    function go() {
      var who = C.partyName(data, d);
      var ok;
      try {
        ok = open({ k: "i", a: p.amt, d: p.date, c: "i-free", src: "invoices",
                    n: ((d.num || kindName(d.kind)) + (who ? " \u00b7 " + who : "")).slice(0, 140) });
      } catch (e) { ok = false; }
      if (ok === false) { showToast(t("toast.budgetNo")); return; }
      var cur = C.byId(data.pays, p.id);
      if (cur && !cur.bud) {
        var x = JSON.parse(JSON.stringify(cur));
        x.bud = 1;
        x.m = stamp(x.m);
        replaceIn(data.pays, C.normPay(x));
        saveNow();
      }
      showToast(t("toast.budgetSent"));
    }
    if (p.bud) confirmDialog(t("pay.toBudget"), t("pay.resend"), t("pay.resendGo"), go);
    else go();
  }

  // CRM Lite customers (BR-CRM-INV): crm/core.js customersForBilling
  // over CRM's own data, loaded on demand. Each client keeps its crm id.
  function loadCrmCore(done) {
    if (window.OrosCrmCore) { done(window.OrosCrmCore); return; }
    var sc = document.createElement("script");
    sc.src = "../crm/core.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    sc.onload = function () { done(window.OrosCrmCore || null); };
    sc.onerror = function () { done(null); };
    document.head.appendChild(sc);
  }
  function fromCrm() {
    var raw = readOther("oros-crm-data", "cust");
    if (!raw) return;
    loadCrmCore(function (K) {
      if (!K || typeof K.norm !== "function" || typeof K.customersForBilling !== "function") return;
      var rows = [];
      K.customersForBilling(K.norm(raw)).forEach(function (c) {
        if (!c || !c.name) return;
        var party = { name: c.name, afm: c.afm, doy: c.doy, job: c.job, addr: c.addr, country: c.country,
                      email: c.email, phone: c.phone, crm: c.id };
        rows.push({ key: c.id, title: c.name, sub: [c.afm, c.email].filter(Boolean).join(" \u00b7 "),
                    have: !!C.matchClient(data, { crm: c.id, afm: c.afm, name: c.name }), c: party });
      });
      pickDialog(t("cli.fromCrm"), rows, importClients, true);
    });
  }
  function readOther(key, listName) {
    try {
      var o = JSON.parse(localStorage.getItem(key) || "null");
      return o && typeof o === "object" && Array.isArray(o[listName]) && o[listName].length ? o : null;
    } catch (e) { return null; }
  }
  function haveClient(name, afm) {
    return !!C.matchClient(data, { name: name, afm: afm });
  }
  function importClients(rows) {
    var n = 0;
    rows.forEach(function (r) {
      if (r.c.crm ? C.matchClient(data, { crm: r.c.crm, afm: r.c.afm, name: r.c.name }) : haveClient(r.c.name, r.c.afm)) return;
      var rec = C.normClient(Object.assign({ id: C.newId(), m: 1 }, r.c));
      if (!rec) return;
      putClient(rec);
      n++;
    });
    renderAll();
    showToast(!n ? t("toast.importNone") : n === 1 ? t("toast.imported1") : t("toast.imported", { n: n }));
  }
  function fromContacts() {
    var o = readOther("oros-contacts-data", "contacts");
    if (!o) return;
    var gone = {};
    (Array.isArray(o.deleted) ? o.deleted : []).forEach(function (x) { if (x && x.id) gone[x.id] = true; });
    var rows = [];
    o.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || gone[c.id] || c.del) return;
      var person = [c.given, c.middle, c.family].filter(function (x) { return typeof x === "string" && x; }).join(" ");
      var name = person || (typeof c.org === "string" ? c.org : "") || (typeof c.nickname === "string" ? c.nickname : "");
      if (!name) return;
      var a = Array.isArray(c.addresses) && c.addresses[0] && typeof c.addresses[0] === "object" ? c.addresses[0] : null;
      var addr = a ? [a.street, [a.zip, a.city].filter(Boolean).join(" "), a.region].filter(function (x) { return typeof x === "string" && x; }).join("\n") : "";
      var email = Array.isArray(c.emails) && c.emails[0] && typeof c.emails[0].v === "string" ? c.emails[0].v : "";
      var phone = Array.isArray(c.phones) && c.phones[0] && typeof c.phones[0].v === "string" ? c.phones[0].v : "";
      var party = { name: name, job: typeof c.jobTitle === "string" ? c.jobTitle : "", addr: addr,
                    country: a && typeof a.country === "string" ? a.country : "", email: email, phone: phone };
      if (person && typeof c.org === "string" && c.org) party.job = [c.org, party.job].filter(Boolean).join(" · ");
      rows.push({ key: c.id, title: name, sub: [email, phone].filter(Boolean).join(" · "), have: haveClient(name, ""), c: party });
    });
    rows.sort(function (a, b) { return a.title.localeCompare(b.title); });
    pickDialog(t("cli.fromContacts"), rows, importClients, true);
  }
  function fromQuote() {
    var o = readOther("oros-quote-data", "clients");
    if (!o) return;
    var gone = o.deleted && typeof o.deleted === "object" ? o.deleted : {};
    var rows = [];
    o.clients.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || gone[c.id] || c.del) return;
      var name = typeof c.name === "string" ? c.name.trim() : "";
      if (!name) return;
      var party = { name: name, addr: typeof c.address === "string" ? c.address : "",
                    afm: typeof c.taxId === "string" ? c.taxId : "",
                    email: typeof c.email === "string" ? c.email : "", phone: typeof c.phone === "string" ? c.phone : "" };
      rows.push({ key: c.id, title: name, sub: [party.afm, party.email].filter(Boolean).join(" · "),
                  have: haveClient(name, party.afm), c: party });
    });
    rows.sort(function (a, b) { return a.title.localeCompare(b.title); });
    pickDialog(t("cli.fromQuote"), rows, importClients, true);
  }

  function templateDialog(d) {
    var dlg = makeDialog("inv-tpl", t("tpl.title"));
    var form = el("form");
    form.method = "dialog";
    var cl = C.client(data, d.cli);
    var name = input("text", (cl ? cl.name + " · " : "") + (d.lines[0] && d.lines[0].d ? d.lines[0].d.split("\n")[0] : kindName(d.kind)), 60);
    var rep = select([["", t("tpl.rep0")], ["m", t("tpl.repm")], ["q", t("tpl.repq")], ["y", t("tpl.repy")]], "");
    var start = input("date", C.addMonths(todayKey(), 1));
    var sf = field(t("tpl.start"), start, t("tpl.repHint"));
    sf.hidden = true;
    rep.addEventListener("change", function () { sf.hidden = !rep.value; });
    form.appendChild(field(t("tpl.name"), name));
    form.appendChild(field(t("tpl.rep"), rep));
    form.appendChild(sf);
    actions(form, [], t("dlg.save"));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = C.cleanText(name.value, 60);
      if (!n) { showToast(t("toast.needName")); return; }
      if (rep.value && !C.validDay(start.value)) { showToast(t("toast.badDate")); return; }
      var x = cleaned(d);
      var tp = C.normTpl({
        id: C.newId(), name: n, kind: x.kind === "cred" ? "inv" : x.kind, cli: x.cli, cur: x.cur, lines: x.lines,
        gDisc: x.gDisc, wht: x.wht, exempt: x.exempt, terms: x.terms, notes: x.notes,
        rep: rep.value, next: rep.value ? start.value : "", dom: rep.value ? +start.value.slice(8, 10) : 0, m: stamp(0),
        pid: x.pid && C.byId(data.profs, x.pid) ? x.pid : undefined
      });
      if (!tp) return;
      data.tpls.push(tp);
      saveNow();
      dlg.close();
      showToast(t("toast.tplSaved"));
      if (rep.value && start.value <= todayKey()) runRecurring();
    });
    dlg.appendChild(form);
    openDialog(dlg, name);
  }
  function templatePicker() {
    var rows = liveList("tpls").map(function (tp) {
      var cl = C.client(data, tp.cli);
      var sub = [kindName(tp.kind), cl ? cl.name : "", tp.rep ? t("tpl.rep" + tp.rep) + " · " + t("tpl.next", { d: day(tp.next) }) : ""];
      return { key: tp.id, title: tp.name, sub: sub.filter(Boolean).join(" · "), tp: tp };
    }).sort(function (a, b) { return a.title.localeCompare(b.title); });
    pickDialog(t("tpl.pick"), rows, function (sel) {
      var tp = sel[0] && sel[0].tp;
      if (!tp) return;
      var x = C.draftFrom(data, tp, todayKey(), C.newId(), 0);
      x.ser = deviceSeries(x.kind);
      openEditor(JSON.parse(JSON.stringify(x)), true, true);
    }, false);
  }

  // From the editor (Issue without business details) Settings returns
  // to the editor: its form stays in the page while Settings is shown.
  var setReturn = "";
  function setupFirst(fromEditor) {
    setReturn = fromEditor === true && ed ? "edit" : "";
    showView("set");
    setTimeout(function () { var n = $("set-name"); if (n) n.focus(); }, 50);
    if (setReturn) showToast(t("setup.text"));
  }
  function leaveSettings() {
    var back = setReturn === "edit" && ed ? "edit" : tab;
    setReturn = "";
    showView(back);
  }

  // ---------- 10. Settings ----------
  function renderSettings() {
    var body = $("set-body");
    body.textContent = "";
    $("set-back").innerHTML = UI.left;
    $("set-back").title = t("back");
    $("set-back").setAttribute("aria-label", t("back"));
    // Wave 3: the profile being edited ("" = the main one, with the defaults)
    var biz = setPid ? C.byId(data.profs, setPid) : null;
    if (!biz) setPid = "";
    var p = biz || data.prof;

    // Business profile + defaults: one form, one Save.
    var card = el("form", "card");
    card.noValidate = true;
    card.appendChild(el("h3", "sec-h", t("set.biz")));
    card.appendChild(el("p", "hint", t("set.bizHint")));
    var profs = C.profiles(data);
    if (profs.length > 1) {
      var ps = select(profs.map(function (pr) { return [pr.id, profName(pr)]; }), setPid);
      ps.id = "set-prof";
      ps.addEventListener("change", function () { setPid = ps.value; renderSettings(); });
      var pw = el("div", "cli-pick");
      pw.appendChild(ps);
      if (setPid) {
        var pd = el("button", "icon-btn", null);
        pd.type = "button";
        pd.innerHTML = UI.x;
        pd.title = t("set.delBiz");
        pd.setAttribute("aria-label", t("set.delBiz"));
        pd.addEventListener("click", function () {
          var gone = biz;
          replaceIn(profList(), tombOf(gone));
          saveNow();
          setPid = "";
          renderSettings();
          undoToast(t("toast.bizDel"), function () { restore("profs", gone); saveNow(); setPid = gone.id; renderSettings(); });
        });
        pw.appendChild(pd);
      }
      card.appendChild(field(t("set.editing"), pw));
    }
    var f = {};
    function txt(key, label, max, type, note) {
      f[key] = input(type || "text", p[key], max);
      if (key === "name") f[key].id = "set-name";
      return field(label, f[key], note);
    }
    card.appendChild(txt("name", t("set.name"), C.LIM.name));
    card.appendChild(row(txt("trade", t("set.trade"), C.LIM.name), txt("job", t("set.job"), C.LIM.name)));
    f.addr = area(p.addr, 2, C.LIM.addr);
    card.appendChild(field(t("set.addr"), f.addr));
    card.appendChild(row(txt("afm", t("set.afm"), 60), txt("doy", t("set.doy"), 60)));
    card.appendChild(row(txt("country", t("set.country"), 60), txt("phone", t("set.phone"), 40, "tel")));
    card.appendChild(row(txt("email", t("set.email"), 120, "email"), txt("web", t("set.web"), 120)));
    f.iban = area(p.iban, 2, C.LIM.iban);
    card.appendChild(field(t("set.iban"), f.iban, t("set.ibanHint")));
    // Wave 46: the user's own payment link (extra field, see core.payLinkOk)
    f.paylink = input("url", typeof p.paylink === "string" ? p.paylink : "", 500);
    f.paylink.placeholder = "https://buy.stripe.com/…";
    f.paylink.id = "set-paylink";
    card.appendChild(field(t("set.paylink"), f.paylink, t("set.paylinkHint")));
    // Logo
    var logo = p.logo;
    var lw = el("div", "logo-row");
    var img = el("img", "logo-prev");
    img.alt = "";
    var lAdd = btn(t("set.logoAdd"), "", function () { pickLogo(function (url) { logo = url; paintLogo(); }); });
    var lDel = btn(t("set.logoDel"), "danger", function () { logo = ""; paintLogo(); });
    function paintLogo() {
      img.hidden = !logo;
      if (logo) img.src = logo; else img.removeAttribute("src");
      lDel.hidden = !logo;
    }
    paintLogo();
    lw.appendChild(img);
    lw.appendChild(lAdd);
    lw.appendChild(lDel);
    var lf = el("div", "fld");
    lf.appendChild(el("span", "dlg-lbl", t("set.logo")));
    lf.appendChild(lw);
    lf.appendChild(el("p", "hint", t("set.logoHint")));
    card.appendChild(lf);

    var defs = el("div", "");
    defs.hidden = !!setPid;
    card.appendChild(defs);
    card = defs;   // the defaults belong to the main profile only
    card.appendChild(el("h3", "sec-h", t("set.defs")));
    f.cur = select(currencyOpts(p.cur), p.cur);
    f.vat = input("text", C.numInput(p.vat, LANG));
    f.vat.inputMode = "decimal";
    f.days = input("number", p.days);
    f.days.min = 0; f.days.max = 365;
    f.wht = input("text", C.numInput(p.wht, LANG));
    f.wht.inputMode = "decimal";
    f.plang = select([["", t("ed.plangApp")], ["el", t("plang.el")], ["en", t("plang.en")]], p.plang);
    card.appendChild(row(field(t("set.cur"), f.cur), field(t("set.vat"), f.vat)));
    card.appendChild(row(field(t("set.days"), f.days), field(t("set.wht"), f.wht)));
    card.appendChild(field(t("set.plang"), f.plang));
    var qrl = el("label", "check");
    f.qr = el("input");
    f.qr.type = "checkbox";
    f.qr.checked = data.prof.qr !== 0;
    qrl.appendChild(f.qr);
    qrl.appendChild(el("span", "", t("set.qr")));
    card.appendChild(qrl);
    card = defs.parentNode;
    f.terms = area(p.terms, 2, C.LIM.terms);
    card.appendChild(field(t("set.terms"), f.terms));
    f.footer = area(p.footer, 2, C.LIM.footer);
    card.appendChild(field(t("set.footer"), f.footer));
    var sv = btn(t("set.save"), "primary", null);
    sv.type = "submit";
    var sa = el("div", "dlg-actions");
    sa.appendChild(el("span", "spacer"));
    sa.appendChild(sv);
    card.appendChild(sa);
    card.addEventListener("submit", function (e) {
      e.preventDefault();
      var plRaw = f.paylink.value.trim(), pl = C.payLinkOk(plRaw);
      if (plRaw && !pl) { showToast(t("set.paylinkBad")); f.paylink.focus(); return; }
      if (biz) {
        var b = JSON.parse(JSON.stringify(biz));
        ["name", "trade", "job", "afm", "doy", "country", "phone", "email", "web"].forEach(function (k) { b[k] = f[k].value; });
        b.addr = f.addr.value; b.iban = f.iban.value; b.logo = logo;
        b.terms = f.terms.value; b.footer = f.footer.value;
        if (pl) b.paylink = pl; else delete b.paylink;
        if (!C.cleanText(b.name, C.LIM.name)) { showToast(t("toast.needName")); f.name.focus(); return; }
        b.m = stamp(b.m);
        var nb = C.normBiz(b);
        if (!nb) return;
        replaceIn(profList(), nb);
        saveNow();
        showToast(t("set.saved"));
        if (document.activeElement) document.activeElement.blur();
        renderSettings();
        return;
      }
      var vat = C.parseNum(f.vat.value), wht = C.parseNum(f.wht.value), days = parseInt(f.days.value || "0", 10);
      if (isNaN(vat) || vat < 0 || vat > 100) { showToast(t("toast.badNum", { f: t("set.vat") })); f.vat.focus(); return; }
      if (isNaN(wht) || wht < 0 || wht > 100) { showToast(t("toast.badNum", { f: t("set.wht") })); f.wht.focus(); return; }
      if (isNaN(days) || days < 0 || days > 365) { showToast(t("toast.badNum", { f: t("set.days") })); f.days.focus(); return; }
      var x = JSON.parse(JSON.stringify(data.prof));
      ["name", "trade", "job", "afm", "doy", "country", "phone", "email", "web"].forEach(function (k) { x[k] = f[k].value; });
      x.addr = f.addr.value; x.iban = f.iban.value; x.logo = logo; x.cur = f.cur.value;
      x.vat = C.round(vat, 2); x.wht = C.round(wht, 2); x.days = days; x.plang = f.plang.value;
      x.terms = f.terms.value; x.footer = f.footer.value;
      if (f.qr.checked) delete x.qr; else x.qr = 0;
      if (pl) x.paylink = pl; else delete x.paylink;
      x.m = stamp(x.m);
      data.prof = C.normProf(x);
      saveNow();
      showToast(t("set.saved"));
      if (document.activeElement) document.activeElement.blur();
      renderSettings();
    });
    body.appendChild(card);
    var addBiz = el("button", "link-btn", t("set.addBiz"));
    addBiz.type = "button";
    addBiz.addEventListener("click", function () {
      var nb = C.normBiz({ id: C.newId(), name: t("set.newBiz"), m: stamp(0) });
      replaceIn(profList(), nb);
      saveNow();
      setPid = nb.id;
      renderSettings();
      var n = $("set-name");
      if (n) { n.focus(); n.select(); }
    });
    var ph = el("div", "card");
    ph.appendChild(el("h3", "sec-h", t("set.profs")));
    ph.appendChild(el("p", "hint", t("set.profsHint")));
    ph.appendChild(addBiz);
    body.appendChild(ph);

    // Numbering
    var sc = el("div", "card");
    sc.appendChild(el("h3", "sec-h", t("set.ser")));
    sc.appendChild(el("p", "hint", t("set.serHint")));
    var y = new Date().getFullYear();
    ["inv", "rcpt", "pro", "cred"].forEach(function (kind) {
      var grp = el("div", "ser-grp");
      grp.appendChild(el("div", "ser-k", t("kinds." + kind)));
      C.seriesFor(data, kind).forEach(function (s) {
        var r = el("div", "ser-row");
        var pre = input("text", s.prefix, 12);
        pre.setAttribute("aria-label", t("set.prefix"));
        pre.className = "ser-pre";
        var yr = el("label", "check");
        var yb = el("input");
        yb.type = "checkbox";
        yb.checked = !!s.year;
        yr.appendChild(yb);
        yr.appendChild(el("span", "", t("set.year")));
        var dg = select([1, 2, 3, 4, 5, 6].map(function (n) { return [String(n), String(n)]; }), String(s.digits));
        dg.setAttribute("aria-label", t("set.digits"));
        dg.className = "ser-dg";
        var sample = el("span", "ser-sample", t("set.sample", { n: C.fmtNum(s, y, C.nextSeq(data, s.id, todayKey())) }));
        var use = el("label", "check");
        var ub = el("input");
        ub.type = "radio";
        ub.name = "use-" + kind;
        ub.checked = deviceSeries(kind) === s.id;
        use.appendChild(ub);
        use.appendChild(el("span", "", t("set.thisDevice")));
        ub.addEventListener("change", function () {
          if (s.id === C.defaultSeries(kind)) delete prefs.ser[kind]; else prefs.ser[kind] = s.id;
          savePrefs();
        });
        function saveSer() {
          var x = JSON.parse(JSON.stringify(s));
          x.prefix = pre.value;
          x.year = yb.checked ? 1 : 0;
          x.digits = +dg.value;
          if (sp) { if (sp.value) x.pid = sp.value; else delete x.pid; }
          x.m = stamp(x.m);
          var n = C.normSeries(x);
          if (!n) return;
          replaceIn(data.series, n);
          saveNow();
          s = n;
          sample.textContent = t("set.sample", { n: C.fmtNum(n, y, C.nextSeq(data, n.id, todayKey())) });
        }
        var sp = null;
        if (profs.length > 1) {
          sp = select([["", t("set.serAny")]].concat(profs.slice(1).map(function (pr) { return [pr.id, profName(pr)]; })),
                      s.pid && C.byId(data.profs, s.pid) ? s.pid : "");
          sp.className = "ser-prof";
          sp.title = t("set.serProf");
          sp.setAttribute("aria-label", t("set.serProf"));
          sp.addEventListener("change", saveSer);
        }
        pre.addEventListener("change", saveSer);
        yb.addEventListener("change", saveSer);
        dg.addEventListener("change", saveSer);
        r.appendChild(pre);
        r.appendChild(dg);
        if (sp) r.appendChild(sp);
        r.appendChild(yr);
        r.appendChild(use);
        r.appendChild(sample);
        if (s.id !== C.defaultSeries(kind)) {
          var del = el("button", "icon-btn sm", null);
          del.type = "button";
          del.innerHTML = UI.x;
          del.title = t("set.delSer");
          del.setAttribute("aria-label", t("set.delSer"));
          del.addEventListener("click", function () {
            var used = C.live(data.docs).some(function (d) { return d.ser === s.id && d.seq > 0; });
            if (used) { showToast(t("set.serBusy")); return; }
            replaceIn(data.series, tombOf(s));
            if (prefs.ser[kind] === s.id) { delete prefs.ser[kind]; savePrefs(); }
            saveNow();
            renderSettings();
          });
          r.appendChild(del);
        }
        grp.appendChild(r);
      });
      var add = el("button", "link-btn", t("set.addSer"));
      add.type = "button";
      add.addEventListener("click", function () {
        var base = C.series(data, C.defaultSeries(kind));
        var s = C.normSeries({ id: C.newId(), kind: kind, prefix: (base ? base.prefix : "") + "-B", year: 1, digits: 4, m: stamp(0) });
        data.series.push(s);
        saveNow();
        renderSettings();
      });
      grp.appendChild(add);
      sc.appendChild(grp);
    });
    body.appendChild(sc);

    // Templates
    var tc = el("div", "card");
    tc.appendChild(el("h3", "sec-h", t("set.tpls")));
    var tpls = liveList("tpls").sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!tpls.length) tc.appendChild(el("p", "hint", t("set.noTpls")));
    tpls.forEach(function (tp) {
      var r = el("div", "tpl-row");
      var tx = el("div", "row-txt");
      tx.appendChild(el("span", "row-no", tp.name));
      var cl = C.client(data, tp.cli);
      tx.appendChild(el("span", "row-sub", [kindName(tp.kind), cl ? cl.name : "",
        tp.rep ? t("tpl.rep" + tp.rep) + " · " + t("tpl.next", { d: day(tp.next) }) : ""].filter(Boolean).join(" · ")));
      r.appendChild(tx);
      var del = el("button", "icon-btn sm", null);
      del.type = "button";
      del.innerHTML = UI.x;
      del.title = t("tpl.del");
      del.setAttribute("aria-label", t("tpl.del"));
      del.addEventListener("click", function () {
        replaceIn(data.tpls, tombOf(tp));
        saveNow();
        renderSettings();
        undoToast(t("toast.tplDel"), function () { restore("tpls", tp); saveNow(); renderSettings(); });
      });
      r.appendChild(del);
      tc.appendChild(r);
    });
    body.appendChild(tc);

    // Data
    var dc = el("div", "card");
    dc.appendChild(el("h3", "sec-h", t("set.data")));
    var da = el("div", "acts");
    da.appendChild(btn(t("set.backup"), "", exportBackup));
    da.appendChild(btn(t("set.restore"), "", restoreBackup));
    dc.appendChild(da);
    dc.appendChild(el("p", "hint", t("set.restoreHint")));
    if (recFile) {
      // .orosinvoices (recordpkg.js + package.js)
      var oa = el("div", "acts");
      [["inv-osave", "set.osave", function () { recFile.save(); }],
       ["inv-oopen", "set.oopen", function () { recFile.open(); }],
       ["inv-ofolder", "set.ofolder", function () { recFile.openFolder(); }]].forEach(function (o) {
        var b = btn(t(o[1]), "", o[2]);
        b.id = o[0];
        oa.appendChild(b);
      });
      dc.appendChild(oa);
      dc.appendChild(el("p", "hint", t("set.ofileHint")));
    }
    body.appendChild(dc);
    body.appendChild(el("p", "hint about", t("set.about")));
  }

  // A logo: PNG/JPG, drawn on a canvas at most 600 × 300 and re-encoded
  // (never the original bytes: no SVG, no metadata), small enough to sync.
  function pickLogo(done) {
    var host = dialogHost(), acc = "image/png,image/jpeg";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 10 * 1024 * 1024) { showToast(t("toast.logoBad")); return; }
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var sc = Math.min(1, 600 / im.naturalWidth, 300 / im.naturalHeight);
        var w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var g = cv.getContext("2d");
        g.drawImage(im, 0, 0, w, h);
        var out = cv.toDataURL("image/png");
        if (out.length > C.LIM.logo) {
          g.globalCompositeOperation = "destination-over";
          g.fillStyle = "#fff";
          g.fillRect(0, 0, w, h);
          out = cv.toDataURL("image/jpeg", 0.85);
        }
        if (out.length > C.LIM.logo || !C.LOGO_RE.test(out)) { showToast(t("toast.logoBad")); return; }
        done(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); showToast(t("toast.logoBad")); };
      im.src = url;
    }).catch(function () { showToast(t("toast.logoBad")); });
  }

  // ---------- 11. PDF ----------
  var libState = { loading: false, q: [] };
  function loadJsPdf(done) {
    if (window.jspdf && window.jspdf.jsPDF) { done(true); return; }
    libState.q.push(done);
    if (libState.loading) return;
    libState.loading = true;
    var s = document.createElement("script");
    s.src = "../vendor/jspdf.umd.min.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    s.onload = function () { libState.loading = false; libState.q.splice(0).forEach(function (cb) { cb(true); }); };
    s.onerror = function () {
      libState.loading = false;
      s.remove();
      libState.q.splice(0).forEach(function (cb) { cb(false); });
    };
    document.head.appendChild(s);
  }
  var fonts = null;
  function loadFonts(done) {
    if (fonts) { done(fonts); return; }
    function get(path) {
      return fetch(path).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf), bin = "";
        for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return btoa(bin);
      });
    }
    Promise.all([get("../vendor/noto/NotoSans-Regular.ttf"), get("../vendor/noto/NotoSans-Bold.ttf")])
      .then(function (r) { fonts = { reg: r[0], bold: r[1] }; done(fonts); })
      .catch(function () { done(null); });
  }
  function canShareFiles() {
    try {
      return typeof navigator.share === "function" && typeof navigator.canShare === "function" &&
             navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] });
    } catch (e) { return false; }
  }
  function pdfName(d) {
    var who = (d.c && d.c.name ? " " + d.c.name : "").replace(/[\\\/:*?\x22<>|\u0000-\u001f]+/g, " ").trim();
    return ((d.num || kindName(d.kind)) + (who ? " " + who : "")).slice(0, 100).replace(/[.\s]+$/, "") + ".pdf";
  }
  // mode: "save" (file dialog) | "share" (the device's share sheet)
  // done(blob) once the PDF is built, done(null) if it couldn't be.
  function pdfBlob(d, done) { pdfWith(function (f) { return buildPdf(d, f); }, done); }
  function pdfWith(build, done) {
    loadJsPdf(function (ok) {
      if (!ok) { done(null); return; }
      loadFonts(function (f) {
        loadQr(function () {
          var blob = null;
          try { blob = build(f); } catch (e) { try { console.error(e); } catch (x) {} }
          done(blob);
        });
      });
    });
  }
  // The QR encoder of the QR Generator app (wave 3, payment QR). Best
  // effort: without it the PDF is made without the code.
  var qrState = { loading: false, q: [] };
  function loadQr(done) {
    if (window.orosQR && typeof window.orosQR.encode === "function") { done(true); return; }
    qrState.q.push(done);
    if (qrState.loading) return;
    qrState.loading = true;
    var s = document.createElement("script");
    s.src = "../qr/qr-encode.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    s.onload = function () { qrState.loading = false; qrState.q.splice(0).forEach(function (cb) { cb(true); }); };
    s.onerror = function () {
      qrState.loading = false;
      s.remove();
      qrState.q.splice(0).forEach(function (cb) { cb(false); });
    };
    document.head.appendChild(s);
  }
  // EPC payload for a document's PDF, "" when none fits: EUR, an
  // invoice or proforma, an IBAN in the seller's bank lines, something
  // to pay (what is still owed on an issued invoice).
  function payQrText(d, s, tt) {
    if (data.prof.qr === 0 || d.cur !== "EUR" || (d.kind !== "inv" && d.kind !== "pro")) return "";
    var amt = d.st === "issued" && C.owes(d) ? C.balance(data, d) : tt.pay;
    return amt > 0 ? C.epcPayload(s.name, s.iban, amt, d.num || "") : "";
  }
  // Wave 46: the profile's own pay-online link for a document that has
  // something to pay (an invoice or proforma; issued → while it owes).
  function payLinkText(d, tt) {
    if (d.kind !== "inv" && d.kind !== "pro") return "";
    if (d.st === "issued" ? !C.owes(d) : !(tt && tt.pay > 0)) return "";
    var prof = C.profileOf(data, d.pid) || {};
    return C.payLinkFor(prof.paylink || (data.prof && data.prof.paylink) || "", d);
  }
  function drawQr(doc, txt, x, y, size) {
    var q = window.orosQR.encode(txt, { ecl: "M" });
    var cell = size / (q.size + 2);
    doc.setFillColor(0, 0, 0);
    for (var r = 0; r < q.size; r++) {
      for (var c = 0; c < q.size; c++) {
        if (q.modules[r][c]) doc.rect(x + (c + 1) * cell, y + (r + 1) * cell, cell + 0.02, cell + 0.02, "F");
      }
    }
  }
  function makePdf(d, mode) {
    pdfBlob(d, function (blob) {
        if (!blob) { showToast(t("toast.pdfFail")); return; }
        var name = pdfName(d);
        if (mode === "share") {
          var file = new File([blob], name, { type: "application/pdf" });
          navigator.share({ files: [file], title: name }).catch(function () {});
          return;
        }
        saveBlob(blob, name, "application/pdf", ".pdf", "PDF");
    });
  }
  // Greek capitals carry no accents ("Πελάτης" → "ΠΕΛΑΤΗΣ").
  function upper(str) {
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  function buildPdf(d, f) {
    var lang = d.plang || data.prof.plang || LANG;
    var P = PDF_STRINGS[lang] || PDF_STRINGS.en;
    function pt(k, params) { return fill(P[k] || PDF_STRINGS.en[k] || k, params); }
    function pm(c) { return C.fmtMoney(c, d.cur, lang); }
    function pn(v, dec) { return C.fmtNumber(v, lang, dec); }
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var FONT = "helvetica";
    if (f) {
      doc.addFileToVFS("NotoSans-Regular.ttf", f.reg);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", f.bold);
      doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
      FONT = "NotoSans";
    }
    var W = 210, H = 297, M = 16, R = W - M, y = M;
    var s = C.sellerOf(data, d), c = d.c || {};
    var draft = d.st === "draft";
    function font(bold, size) { doc.setFont(FONT, bold ? "bold" : "normal"); doc.setFontSize(size); }
    function gray(v) { doc.setTextColor(v, v, v); }
    function text(str, x, yy, opts) { doc.text(String(str), x, yy, opts || {}); }
    function wrap(str, width) { return doc.splitTextToSize(String(str || ""), width); }
    function need(h) {
      if (y + h > H - 22) { doc.addPage(); y = M; return true; }
      return false;
    }

    // Header: logo + seller (left), title + number + dates (right)
    var topY = y;
    if (s.logo) {
      try {
        var props = doc.getImageProperties(s.logo);
        var lw = Math.min(50, props.width * 20 / props.height), lh = lw * props.height / props.width;
        if (lh > 20) { lh = 20; lw = lh * props.width / props.height; }
        doc.addImage(s.logo, s.logo.indexOf("image/png") > 0 ? "PNG" : "JPEG", M, y, lw, lh);
        y += lh + 4;
      } catch (e) {}
    }
    gray(0);
    font(true, 11);
    var leftW = 95;
    wrap(s.name || "", leftW).forEach(function (ln) { text(ln, M, y + 4); y += 5; });
    font(false, 8.5);
    gray(60);
    var sl = [];
    if (s.trade) sl.push(s.trade);
    if (s.job) sl.push(s.job);
    if (s.addr) s.addr.split("\n").forEach(function (a) { sl.push(a); });
    if (s.country) sl.push(s.country);
    var stax = [s.afm ? pt("afm") + ": " + s.afm : "", s.doy ? pt("doy") + ": " + s.doy : ""].filter(Boolean).join("   ");
    if (stax) sl.push(stax);
    var scon = [s.phone, s.email, s.web].filter(Boolean).join("   ");
    if (scon) sl.push(scon);
    sl.forEach(function (ln) { wrap(ln, leftW).forEach(function (w) { text(w, M, y + 3.5); y += 4; }); });
    var leftEnd = y;

    var ry = topY + 6;
    gray(0);
    font(true, 16);
    text(pt("t." + (d.kind === "ext" ? "inv" : d.kind)), R, ry, { align: "right" });
    ry += 7;
    font(true, 10.5);
    text(d.num ? pt("no") + " " + d.num : (draft ? pt("draft") : ""), R, ry, { align: "right" });
    ry += 5.5;
    font(false, 9);
    gray(60);
    if (d.date) { text(pt("date") + ": " + C.fmtDay(d.date), R, ry, { align: "right" }); ry += 4.5; }
    if (d.due) { text(pt("due") + ": " + C.fmtDay(d.due), R, ry, { align: "right" }); ry += 4.5; }
    if (d.mark) { text(pt("mark") + ": " + d.mark, R, ry, { align: "right" }); ry += 4.5; }
    y = Math.max(leftEnd, ry) + 6;

    // Client box
    if (c.name) {
      var cl = [];
      if (c.job) cl.push(c.job);
      if (c.addr) c.addr.split("\n").forEach(function (a) { cl.push(a); });
      if (c.country) cl.push(c.country);
      var ctax = [c.afm ? pt("afm") + ": " + c.afm : "", c.doy ? pt("doy") + ": " + c.doy : ""].filter(Boolean).join("   ");
      if (ctax) cl.push(ctax);
      var ccon = [c.phone, c.email].filter(Boolean).join("   ");
      if (ccon) cl.push(ccon);
      var lines = [];
      cl.forEach(function (ln) { wrap(ln, 100).forEach(function (w) { lines.push(w); }); });
      var nameLines = wrap(c.name, 100);
      var boxH = 9 + nameLines.length * 5 + lines.length * 4;
      doc.setDrawColor(200);
      doc.setFillColor(246, 246, 246);
      doc.roundedRect(M, y, 110, boxH, 1.5, 1.5, "FD");
      var by = y + 5;
      font(false, 7.5);
      gray(110);
      text(upper(pt("to")), M + 4, by);
      by += 5;
      gray(0);
      font(true, 10);
      nameLines.forEach(function (ln) { text(ln, M + 4, by); by += 5; });
      font(false, 8.5);
      gray(50);
      lines.forEach(function (ln) { text(ln, M + 4, by); by += 4; });
      y += boxH + 6;
    }
    if (d.kind === "cred" && d.ref) {
      var r = C.anyId(data.docs, d.ref);
      if (r && !r.del) {
        font(false, 9);
        gray(0);
        text(pt("corrects", { n: r.num, d: C.fmtDay(r.date) }), M, y);
        y += 7;
      }
    }

    // Items
    var X = { d: M, q: 128, p: 153, v: 167, a: R };
    var tt = C.totals(d);
    function lineHead() {
      doc.setFillColor(235, 235, 235);
      doc.rect(M, y - 4.5, R - M, 7, "F");
      font(true, 8);
      gray(40);
      text(pt("desc"), X.d + 2, y);
      text(pt("qty"), X.q, y, { align: "right" });
      text(pt("price"), X.p, y, { align: "right" });
      text(pt("vat"), X.v, y, { align: "right" });
      text(pt("amount"), X.a - 1, y, { align: "right" });
      y += 6;
    }
    if (d.kind !== "ext") {
      need(20);
      lineHead();
      d.lines.forEach(function (l, i) {
        var dl = wrap(l.d, X.q - X.d - 22);
        var extra = [l.code ? pt("code") + " " + l.code : "", l.disc ? pt("disc") + " " + pn(l.disc, 2) + " %" : ""].filter(Boolean).join("   ");
        var h = dl.length * 4.2 + (extra ? 3.8 : 0) + 2.5;
        if (need(h)) lineHead();
        font(false, 9);
        gray(0);
        dl.forEach(function (ln, k) { text(ln, X.d + 2, y + k * 4.2); });
        text(pn(l.q) + (l.unit ? " " + l.unit : ""), X.q, y, { align: "right" });
        text(pm(l.p), X.p, y, { align: "right" });
        text(pn(l.vat, 2) + "%", X.v, y, { align: "right" });
        text(pm(C.lineNet(l)), X.a - 1, y, { align: "right" });
        if (extra) {
          font(false, 7.5);
          gray(110);
          text(extra, X.d + 2, y + dl.length * 4.2);
        }
        y += h;
        doc.setDrawColor(225);
        if (i < d.lines.length - 1) doc.line(M, y - 2, R, y - 2);
      });
      doc.setDrawColor(160);
      doc.line(M, y - 1, R, y - 1);
      y += 4;
    }

    // Totals (right column)
    var rows = [];
    if (d.kind !== "ext") {
      if (tt.disc) { rows.push([pt("sub"), pm(tt.sub)]); rows.push([pt("gdisc", { r: pn(d.gDisc, 2) }), "−" + pm(tt.disc)]); }
      rows.push([pt("net"), pm(tt.net)]);
      tt.rates.forEach(function (rr) { rows.push([pt("vatR", { r: pn(rr.rate, 2) }), pm(rr.vat)]); });
    } else {
      rows.push([pt("net"), pm(tt.net)]);
      rows.push([pt("vat"), pm(tt.vat)]);
    }
    rows.push([pt("total"), pm(tt.total), !tt.wht]);
    if (tt.wht) {
      rows.push([pt("wht", { r: pn(d.wht, 2) }), "−" + pm(tt.wht)]);
      rows.push([pt("pay"), pm(tt.pay), true]);
    }
    need(rows.length * 5.5 + 6);
    rows.forEach(function (rw) {
      if (rw[2]) {
        doc.setFillColor(235, 235, 235);
        doc.rect(118, y - 4.3, R - 118, 7, "F");
        font(true, 10.5);
        gray(0);
      } else { font(false, 9); gray(40); }
      text(rw[0], 121, y);
      text(rw[1], R - 1, y, { align: "right" });
      y += rw[2] ? 8 : 5.2;
    });
    y += 4;

    // Blocks: exemption, terms + bank, notes, proforma note
    function block(title, body) {
      if (!body) return;
      var ls = wrap(body, R - M);
      need(8 + Math.min(ls.length, 6) * 4.2);
      font(true, 8.5);
      gray(0);
      text(title, M, y);
      y += 4.6;
      font(false, 8.5);
      gray(50);
      ls.forEach(function (ln) { need(4.2); text(ln, M, y); y += 4.2; });
      y += 3;
    }
    var hasZero = d.kind !== "ext" && tt.rates.some(function (rr) { return rr.rate === 0; });
    if (d.exempt && (hasZero || d.kind === "ext")) block(pt("exempt"), d.exempt);
    else if (d.exempt) block(pt("exempt"), d.exempt);
    block(pt("terms"), d.terms);
    if (s.iban && d.kind !== "cred") block(pt("bank"), s.iban);
    var qrTxt = window.orosQR ? payQrText(d, s, tt) : "";
    if (qrTxt) {
      try {
        var qs = 30;
        need(qs + 4);
        drawQr(doc, qrTxt, M - 1, y - 3, qs);
        var qa = d.st === "issued" && C.owes(d) ? C.balance(data, d) : tt.pay;
        font(true, 8.5);
        gray(0);
        text(pt("qr"), M + qs + 3, y + 9);
        font(false, 8.5);
        gray(50);
        wrap(pt("qrAmt", { a: pm(qa), n: s.name }), R - M - qs - 6).forEach(function (ln, k) { text(ln, M + qs + 3, y + 14 + k * 4.2); });
        text(C.ibanOf(s.iban).replace(/(.{4})/g, "$1 ").trim(), M + qs + 3, y + 23);
        y += qs + 2;
      } catch (e) {}
    }
    // Wave 46: "Pay online" with the user's own payment link (QR + link)
    var plUrl = payLinkText(d, tt);
    if (plUrl) {
      try {
        var ps = 26;
        need(ps + 4);
        if (window.orosQR) drawQr(doc, plUrl, M - 1, y - 3, ps);
        var px = window.orosQR ? M + ps + 3 : M;
        font(true, 8.5);
        gray(0);
        text(pt("payOnline"), px, y + 7);
        font(false, 8.5);
        gray(50);
        text(pt("payOnlineHint"), px, y + 12);
        doc.setTextColor(20, 70, 170);
        var plShown = wrap(plUrl, R - px).slice(0, 2);
        plShown.forEach(function (ln, k) {
          if (typeof doc.textWithLink === "function") doc.textWithLink(ln, px, y + 17 + k * 4.2, { url: plUrl });
          else text(ln, px, y + 17 + k * 4.2);
        });
        gray(50);
        y += (window.orosQR ? ps : 17 + plShown.length * 4.2) + 2;
      } catch (e) {}
    }
    block(pt("notes"), d.notes);
    if (d.kind === "pro") block("", pt("proNote"));

    // Footer + page numbers on every page; DRAFT stamp on drafts.
    var pages = doc.getNumberOfPages();
    var footer = C.profileOf(data, d.pid).footer;
    for (var pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      font(false, 7.5);
      gray(130);
      if (footer) wrap(footer, R - M - 30).slice(0, 2).forEach(function (ln, k) { text(ln, M, H - 12 + k * 3.6); });
      text(pt("page", { a: pg, b: pages }), R, H - 12, { align: "right" });
      if (draft) {
        font(true, 60);
        doc.setTextColor(225, 225, 225);
        text(pt("draft"), W / 2, H / 2, { align: "center", angle: 30 });
      }
    }
    return doc.output("blob");
  }

  // Wave 3 — a client's statement: every document still owed, with the
  // open balance per currency. Seller: the documents' common profile,
  // else the main one. The app's PDF language.
  function makeStatement(cliId) {
    var c = C.client(data, cliId);
    var st = C.statement(data, cliId, todayKey());
    if (!c || !st.rows.length) { showToast(t("toast.noOpen")); return; }
    pdfWith(function (f) { return buildStatement(c, st, f); }, function (blob) {
      if (!blob) { showToast(t("toast.pdfFail")); return; }
      var lang = data.prof.plang || LANG;
      var P = PDF_STRINGS[lang] || PDF_STRINGS.en;
      var name = ((P.stmtFile || PDF_STRINGS.en.stmtFile) + " " + c.name + " " + todayKey())
        .replace(/[\\\/:*?\x22<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) + ".pdf";
      saveBlob(blob, name, "application/pdf", ".pdf", "PDF");
    });
  }
  function buildStatement(c, st, f) {
    var lang = data.prof.plang || LANG;
    var P = PDF_STRINGS[lang] || PDF_STRINGS.en;
    function pt(k, params) { return fill(P[k] || PDF_STRINGS.en[k] || k, params); }
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var FONT = "helvetica";
    if (f) {
      doc.addFileToVFS("NotoSans-Regular.ttf", f.reg);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", f.bold);
      doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
      FONT = "NotoSans";
    }
    var W = 210, H = 297, M = 16, R = W - M, y = M;
    var pids = {};
    st.rows.forEach(function (r) { var dd = findDoc(r.id); pids[dd && dd.pid || ""] = 1; });
    var pidList = Object.keys(pids);
    var prof = C.profileOf(data, pidList.length === 1 ? pidList[0] : "");
    var s = C.normSeller(prof);
    function font(bold, size) { doc.setFont(FONT, bold ? "bold" : "normal"); doc.setFontSize(size); }
    function gray(v) { doc.setTextColor(v, v, v); }
    function text(str, x, yy, opts) { doc.text(String(str), x, yy, opts || {}); }
    function wrap(str, width) { return doc.splitTextToSize(String(str || ""), width); }
    function need(h) { if (y + h > H - 22) { doc.addPage(); y = M; return true; } return false; }

    var topY = y;
    if (s.logo) {
      try {
        var props = doc.getImageProperties(s.logo);
        var lw = Math.min(50, props.width * 20 / props.height), lh = lw * props.height / props.width;
        if (lh > 20) { lh = 20; lw = lh * props.width / props.height; }
        doc.addImage(s.logo, s.logo.indexOf("image/png") > 0 ? "PNG" : "JPEG", M, y, lw, lh);
        y += lh + 4;
      } catch (e) {}
    }
    gray(0);
    font(true, 11);
    wrap(s.name || "", 95).forEach(function (ln) { text(ln, M, y + 4); y += 5; });
    font(false, 8.5);
    gray(60);
    [s.trade, [(s.addr || "").split("\n").join(", "), s.country].filter(Boolean).join(", "),
     [s.afm ? pt("afm") + ": " + s.afm : "", s.doy ? pt("doy") + ": " + s.doy : ""].filter(Boolean).join("   "),
     [s.phone, s.email, s.web].filter(Boolean).join("   ")].filter(Boolean).forEach(function (ln) {
      wrap(ln, 95).forEach(function (w) { text(w, M, y + 3.5); y += 4; });
    });
    gray(0);
    font(true, 15);
    text(pt("t.stmt"), R, topY + 6, { align: "right" });
    font(false, 9);
    gray(60);
    text(pt("asOf", { d: C.fmtDay(todayKey()) }), R, topY + 12, { align: "right" });
    y = Math.max(y, topY + 16) + 6;

    // Client
    font(false, 7.5);
    gray(110);
    text(upper(pt("to")), M, y);
    y += 5;
    gray(0);
    font(true, 10.5);
    wrap(c.name, 120).forEach(function (ln) { text(ln, M, y); y += 5; });
    font(false, 8.5);
    gray(50);
    [c.afm ? pt("afm") + ": " + c.afm + (c.doy ? "   " + pt("doy") + ": " + c.doy : "") : "",
     (c.addr || "").split("\n").join(", "), c.email].filter(Boolean).forEach(function (ln) {
      wrap(ln, 120).forEach(function (w) { text(w, M, y); y += 4; });
    });
    y += 5;

    // Rows
    var X = { n: M + 2, d: 78, u: 100, t: 139, p: 164, b: R - 1 };
    var saved = LANG;
    LANG = lang;
    var kinds = { inv: kindName("inv"), rcpt: kindName("rcpt"), ext: kindName("inv"), cred: kindName("cred"), pro: kindName("pro") };
    LANG = saved;
    function head() {
      doc.setFillColor(235, 235, 235);
      doc.rect(M, y - 4.5, R - M, 7, "F");
      font(true, 8);
      gray(40);
      text(pt("doc"), X.n, y);
      text(pt("date"), X.d, y);
      text(pt("due"), X.u, y);
      text(pt("total"), X.t, y, { align: "right" });
      text(pt("paid"), X.p, y, { align: "right" });
      text(pt("bal"), X.b, y, { align: "right" });
      y += 6;
    }
    head();
    st.rows.forEach(function (r) {
      var h = r.late ? 8.4 : 5.4;
      if (need(h)) head();
      font(false, 8.5);
      gray(0);
      text(wrap((r.num || "") + "  " + (kinds[r.kind] || ""), X.d - X.n - 3)[0], X.n, y);
      text(r.date ? C.fmtDay(r.date) : "", X.d, y);
      text(r.due ? C.fmtDay(r.due) : "", X.u, y);
      text(C.fmtMoney(r.total, r.cur, lang), X.t, y, { align: "right" });
      text(C.fmtMoney(r.paid, r.cur, lang), X.p, y, { align: "right" });
      font(true, 8.5);
      text(C.fmtMoney(r.bal, r.cur, lang), X.b, y, { align: "right" });
      if (r.late) {
        font(false, 7.5);
        doc.setTextColor(180, 40, 40);
        text(pt("late", { n: r.late }), X.n, y + 3.6);
      }
      y += h;
      doc.setDrawColor(225);
      doc.line(M, y - 2.6, R, y - 2.6);
    });
    y += 3;
    Object.keys(st.totals).sort().forEach(function (cur) {
      need(9);
      doc.setFillColor(235, 235, 235);
      doc.rect(118, y - 4.3, R - 118, 7, "F");
      font(true, 10.5);
      gray(0);
      text(pt("open"), 121, y);
      text(C.fmtMoney(st.totals[cur], cur, lang), R - 1, y, { align: "right" });
      y += 9;
    });
    if (s.iban) {
      var ls = wrap(s.iban, R - M);
      need(8 + ls.length * 4.2);
      y += 2;
      font(true, 8.5);
      gray(0);
      text(pt("bank"), M, y);
      y += 4.6;
      font(false, 8.5);
      gray(50);
      ls.forEach(function (ln) { text(ln, M, y); y += 4.2; });
    }
    var pages = doc.getNumberOfPages();
    for (var pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      font(false, 7.5);
      gray(130);
      if (prof.footer) wrap(prof.footer, R - M - 30).slice(0, 2).forEach(function (ln, k) { text(ln, M, H - 12 + k * 3.6); });
      text(pt("page", { a: pg, b: pages }), R, H - 12, { align: "right" });
    }
    return doc.output("blob");
  }

  // ---------- 12. Files ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function saveBlob(blob, name, mime, ext, desc) {
    var host = dialogHost();
    var types = [{ description: desc }];
    types[0].accept = {};
    types[0].accept[mime] = [ext];
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ blob: blob, filename: name, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function saveText(text, name, mime, ext, desc) {
    saveBlob(new Blob([text], { type: mime }), name, mime, ext, desc);
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function exportCsv(which) {
    var k = rangeKeys(prefs.dash.range), today = todayKey();
    var name = "oros-invoices-" + (which === "pays" ? "payments-" : "") + k[0] + "_" + k[1] + ".csv";
    var text;
    if (which === "pays") {
      text = C.paysCsv(data, k[0], k[1], paysHead(), howName, LANG);
    } else {
      text = C.docsCsv(data, k[0], k[1], docsHead(), kindName, statusName, LANG, today);
    }
    saveText(text, name, "text/csv", ".csv", "CSV");
  }
  // ---------- The month for the accountant (acctpack.js, wave P11) ----------
  function acctText(k) {
    var S = window.OrosAcctPack.STR;
    if (window.orosI18n && !S[LANG]) window.orosI18n.table(S, "invoices", LANG);
    return (S[LANG] || S.en)[k] || S.en[k];
  }
  function openAcctPack() {
    if (!window.OrosAcctPack || !window.OrosAcctPack.open || !window.OrosBundle) return;
    window.OrosAcctPack.open({
      lang: LANG, core: C, el: el, btn: btn, field: field, toast: showToast,
      makeDialog: makeDialog, openDialog: openDialog, saveBlob: saveBlob, fs: orosFS,
      data: function () { return data; }, today: todayKey,
      prefs: function () { return prefs; }, setPref: function (k, v) { prefs[k] = v; savePrefs(); },
      monthName: function (mk) {
        try { return new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1).toLocaleDateString(loc(), { month: "long", year: "numeric" }); }
        catch (e) { return mk; }
      },
      fmtDay: function (k) { return C.fmtDay(k); },
      docsHead: docsHead, paysHead: paysHead, kindName: kindName, statusName: statusName, howName: howName,
      pdfBlob: pdfBlob, pdfName: pdfName
    });
  }
  function paysHead() { return [t("pay.date"), t("ed.num"), t("c.title"), t("pay.amt"), t("ed.cur"), t("pay.how"), t("pay.note")]; }
  function docsHead() {
    return [t("ed.num"), t("ed.kind"), t("dash.range"), t("ed.date"), t("ed.due"), t("c.title"), t("c.afm"), t("ed.cur"),
            t("tot.net"), t("tot.vatAll"), t("tot.total"), t("ed.wht"), t("tot.pay"), t("tot.paid"), t("tot.bal"), t("vw.mark")];
  }
  // "Open in Spreadsheet" (Bible BR-S1): the documents CSV of the
  // dashboard period as a new sheet in the orOS Spreadsheet, amounts as
  // numbers, dates YYYY-MM-DD. SUM rows under the amounts only when the
  // period has one currency (a total over EUR + USD means nothing).
  var SHEET_ROWS = 498;   // + heading + SUM row = the Spreadsheet's 500
  function sheetShell() {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) { return null; }
  }
  function openDocsInSheet() {
    var shell = sheetShell();
    if (!shell) return;
    var k = rangeKeys(prefs.dash.range);
    var rows = C.docsRows(data, k[0], k[1], kindName, statusName, todayKey());
    if (!rows.length) { showToast(t("dash.noTop")); return; }
    if (rows.length > SHEET_ROWS) { showToast(t("dash.sheetCap", { n: SHEET_ROWS })); rows = rows.slice(0, SHEET_ROWS); }
    var m0 = C.DOCS_MONEY[0], m1 = C.DOCS_MONEY[1], curs = {}, sum = [], i;
    rows = rows.map(function (r) {
      curs[r[7]] = 1;
      return r.map(function (v, j) { return j >= m0 && j <= m1 ? v / 100 : (v === undefined || v === null ? "" : v); });
    });
    if (Object.keys(curs).length === 1) for (i = m0; i <= m1; i++) sum.push(i);
    var slug = k[0].slice(0, 4) === k[1].slice(0, 4) ? k[0] + "–" + k[1].slice(5) : k[0].slice(2) + "–" + k[1].slice(2);
    shell.__orosOpenAt("spreadsheet", { newSheet: { name: t("app") + " " + slug, rows: [docsHead()].concat(rows), sum: sum } });
  }
  function exportBackup() {
    saveText(C.toBackup(data), "oros-invoices-backup-" + todayKey() + ".json", "application/json", ".json", "JSON");
  }
  function restoreBackup() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function"
      ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    pick.then(function (file) {
      if (!file) return;
      return file.text().then(function (text) {
        var incoming = C.fromBackup(text);
        if (!incoming) { showToast(t("toast.badFile")); return; }
        var before = {};
        data.docs.forEach(function (x) { if (!x.del) before[x.id] = true; });
        data = C.mergeInvoices(data, incoming);
        var added = 0;
        data.docs.forEach(function (x) { if (!x.del && !before[x.id]) added++; });
        saveNow();
        renderAll();
        showToast(added === 1 ? t("toast.restored1") : (added ? t("toast.restored", { n: added }) : t("toast.restoredNone")));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }

  // ----- .orosinvoices: every record as one orOS file -----
  // (../recordpkg.js + package.js). Opening ADDS what this device lacks,
  // with its ids; a record already here (or deleted here) is kept as it
  // is, and a document already issued here is never changed, not even
  // with "Update with newer versions" (package.js tombIds); a numbered
  // document whose number is taken here by another one stays out
  // (forLocal). Numbers are never changed. The result goes through
  // normalize + saveNow (so sync carries it); Undo deletes the added
  // records the app's own way (tombstones, so the deletion syncs).
  // media/<sha256>.<pdf|png|jpg> = the official PDFs (and scans) of
  // /internal/Invoices/; on open a file is written there only when it
  // is not there yet, after the same checks as Attach (10 MB, PDF / PNG
  // / JPEG by its bytes). Provider keys (myDATA, timologisi, Stripe)
  // live in the shell's Connected services, never in the slice.
  var RP = window.OrosRecordPkg || null, IPK = window.OrosInvoicesPackage || null;
  var FILE_MAX = 10 * 1024 * 1024;
  var recWrote = [];          // disk files the last open wrote (its Undo removes them)
  function diskType(blob) {   // → "pdf" | "png" | "jpg" | "" (from the bytes, as Attach allows)
    if (!blob || !blob.size || blob.size > FILE_MAX || !window.OrosBundle) return Promise.resolve("");
    return blob.slice(0, 16).arrayBuffer().then(function (ab) {
      var ty = window.OrosBundle.typeOf(new Uint8Array(ab));
      return ty === "application/pdf" ? "pdf" : ty === "image/png" ? "png" : ty === "image/jpeg" ? "jpg" : "";
    }, function () { return ""; });
  }
  var MEDIA_TYPE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };
  function recFiles(state) {
    var fs = orosFS(), out = [], keys = {}, chain = Promise.resolve();
    state.media = {};
    if (!fs || typeof fs.readBlob !== "function") return Promise.resolve(out);
    C.live(state.docs).forEach(function (d) {
      var p = d.file;
      if (!IPK.safePath(p)) return;
      chain = chain.then(function () {
        if (p in keys) { if (keys[p]) state.media[p] = keys[p]; return; }
        keys[p] = "";
        return Promise.resolve(fs.readBlob(p)).then(function (blob) {
          return diskType(blob).then(function (ext) {
            if (!ext) return;
            return window.OrosBundle.digest(blob).then(function (x) {
              var k = x.sha + "." + ext;
              keys[p] = state.media[p] = k;
              if (!out.some(function (f) { return f.key === k; })) out.push({ key: k, blob: blob, type: MEDIA_TYPE[ext] });
            });
          });
        }).then(null, function () {});
      });
    });
    return chain.then(function () { return out; });
  }
  // One file of the bundle → /internal/Invoices/: the path the document
  // names when it is free (or holds the same bytes), else the same name
  // with "-<8 hex>" added. → the path, or "" when the bytes fail a check.
  function storeMedia(fs, path, key, item) {
    var ext = key.split(".").pop(), sha = key.slice(0, 64);
    if (!item || !item.bytes || item.type !== MEDIA_TYPE[ext] || item.bytes.length > FILE_MAX) return Promise.resolve("");
    var B = window.OrosBundle, blob = new Blob([item.bytes], { type: item.type });
    var alt = path.replace(/(\.[A-Za-z]+)$/, "-" + sha.slice(0, 8) + "$1");
    function at(p) {
      return Promise.resolve(fs.readBlob(p)).then(function (have) {
        if (!have) return null;
        return B.digest(have).then(function (x) { return x.sha === sha ? p : ""; });
      }, function () { return null; }).then(function (r) {
        if (r !== null) return r;                       // there: the same bytes (p) or others ("")
        var write = typeof fs.writeBlob === "function" ? fs.writeBlob : fs.write;
        return Promise.resolve(write.call(fs, p, blob)).then(function () { recWrote.push(p); return p; });
      });
    }
    return at(path).then(function (p) { return p || (alt !== path ? at(alt) : ""); }).then(null, function () { return ""; });
  }
  function recMedia(read, res) {
    var next = JSON.parse(JSON.stringify(res.next)), fs = orosFS(), chain = Promise.resolve(), touched = {};
    var cd = read && read.content && read.content.data, media = (cd && cd.media) || {}, items = (read && read.media) || {};
    recWrote = [];
    res.addedIds.concat(res.updatedIds).forEach(function (id) { touched[id] = 1; });
    (next.docs || []).forEach(function (d) {
      if (d.del || !touched[d.id] || !d.file) return;
      var mine = C.doc(data, d.id), keep = mine && mine.file === d.file ? d.file : "";
      var key = IPK.safePath(d.file) && typeof media[d.file] === "string" && IPK.KEY_RE.test(media[d.file]) ? media[d.file] : "";
      if (!key || !items[key] || !fs) { d.file = keep; return; }
      chain = chain.then(function () { return storeMedia(fs, d.file, key, items[key]); })
        .then(function (p) { d.file = p || keep; }, function () { d.file = keep; });
    });
    return chain.then(function () { return next; });
  }
  var recFile = RP && IPK && window.OrosBundle ? RP.ui(IPK.forLocal(function () { return C.normalize(data); }), {
    lang: function () { return LANG; },
    get: function () { return C.normalize(data); },
    title: function () { return t("app"); },
    files: recFiles,
    media: recMedia,
    set: function (next) {
      var n = C.normalize(next);
      if (!n || !Array.isArray(n.docs)) return;
      data = n;
      saveNow();
      renderAll();
    },
    deleteIds: function (ids) {
      var lists = { doc: "docs", pay: "pays", client: "clients", series: "series", tpl: "tpls", prof: "profs" };
      ids.forEach(function (id) {
        var k = IPK.kindOf(id, data), name = lists[k];
        var rec = name ? C.byId(data[name], id) : null;
        if (rec) replaceIn(name === "profs" ? profList() : data[name], tombOf(rec));
      });
      saveNow();
      // the disk files that open wrote and nothing points at any more
      var fs = orosFS(), wrote = recWrote.slice();
      recWrote = [];
      if (fs && typeof fs.rm === "function") wrote.forEach(function (p) {
        if (!C.live(data.docs).some(function (d) { return d.file === p; })) Promise.resolve(fs.rm(p)).then(null, function () {});
      });
      renderAll();
    },
    toast: function (text, undo) { if (undo) undoToast(text, undo); else showToast(text); }
  }) : null;

  // The official PDF of a record (or of an issued document): copied to
  // the orOS disk under /internal/Invoices/, the document keeps the path.
  function orosFS() {
    try { return window.parent && window.parent !== window ? window.parent.orosFS || null : null; } catch (e) { return null; }
  }
  function fileField(d, live) {
    var w = el("div", "fld");
    w.appendChild(el("span", "dlg-lbl", t("ed.file")));
    var r = el("div", "file-row");
    var name = el("span", "file-name", d.file ? d.file.split("/").pop() : t("ed.fileNone"));
    r.appendChild(name);
    if (d.file) r.appendChild(btn(t("ed.fileOpen"), "", function () { openFile(d); }));
    r.appendChild(btn(t("ed.fileAdd"), "", function () {
      attachFile(d, function (path) {
        if (live) {
          var x = JSON.parse(JSON.stringify(findDoc(d.id)));
          x.file = path;
          putDoc(x);
          renderViewer();
        } else {
          d.file = path;
          name.textContent = path.split("/").pop();
          touch();
        }
      });
    }));
    w.appendChild(r);
    return w;
  }
  function attachFile(d, done) {
    var fs = orosFS();
    if (!fs) { showToast(t("toast.noDisk")); return; }
    var host = dialogHost(), acc = ".pdf,application/pdf,image/png,image/jpeg";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { showToast(t("toast.fileBig")); return; }
      var ext = (/\.(pdf|png|jpe?g)$/i.exec(file.name || "") || [".pdf"])[0].toLowerCase();
      var base = (d.num || d.id).replace(/[\\\/:*?\x22<>|\u0000-\u001f.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || d.id;
      var path = "/internal/Invoices/" + base + ext;
      return fs.write(path, file).then(function () { showToast(t("toast.fileSaved")); done(path); });
    }).catch(function () { showToast(t("toast.noDisk")); });
  }
  function openFile(d) {
    var fs = orosFS();
    if (!fs || !d.file) { showToast(t("toast.noDisk")); return; }
    fs.readBlob(d.file).then(function (blob) {
      var name = d.file.split("/").pop();
      var typed = blob.type ? blob : new Blob([blob], { type: /\.pdf$/i.test(name) ? "application/pdf" : "image/" + (/png$/i.test(name) ? "png" : "jpeg") });
      var url = URL.createObjectURL(typed);
      var w = null;
      try { w = window.open(url, "_blank", "noopener"); } catch (e) {}
      if (!w) saveBlob(typed, name, typed.type || "application/pdf", "." + name.split(".").pop(), "PDF");
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function () { showToast(t("toast.fileGone")); });
  }

  // Email: orOS Mail (an account on this device) or mailto:. With Mail
  // and the orOS disk, the PDF rides along: Mail's deep link is JSON, so
  // the file goes to /internal/Invoices/ first and Mail gets its path.
  // A record keeps its official file; a document gets a fresh PDF.
  function mailShell() {
    var shell = null;
    try { shell = window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) {}
    if (!shell) return null;
    try {
      var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return m && Array.isArray(m.accounts) && m.accounts.length ? shell : null;
    } catch (e) { return null; }
  }
  // done(path) with the file to attach, or done(null) to send without.
  function mailAttachment(d, done) {
    var fs = orosFS();
    if (!fs) { done(null); return; }
    if (d.file) { done(d.file); return; }
    if (d.kind === "ext") { done(null); return; }
    var write = typeof fs.writeBlob === "function" ? fs.writeBlob : fs.write;
    if (typeof write !== "function") { done(null); return; }
    pdfBlob(d, function (blob) {
      if (!blob) { done(null); return; }
      var path = "/internal/Invoices/" + pdfName(d);
      Promise.resolve(write.call(fs, path, blob)).then(function () { done(path); }, function () { done(null); });
    });
  }
  // Stock (BR-ST-OUT): offered only when Stock is in use on this device.
  function stockShell() {
    try {
      if (window.parent === window || typeof window.parent.__orosOpenAt !== "function") return null;
      return localStorage.getItem("oros-stock-data") ? window.parent : null;
    } catch (e) { return null; }
  }
  // Wave 3: a payment reminder, polite or (once overdue) firm.
  function reminderDialog(d) {
    var late = C.lateDays(d, todayKey());
    var dlg = makeDialog("inv-remind", t("vw.remind") + " · " + d.num);
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "dlg-text", t("rem.text")));
    var left = late ? [btn(t("rem.soft"), "", function () { dlg.close(); sendEmail(d, "soft"); })] : [];
    actions(form, left, late ? t("rem.firm") : t("rem.soft"));
    form.addEventListener("submit", function (e) { e.preventDefault(); dlg.close(); sendEmail(d, late ? "firm" : "soft"); });
    dlg.appendChild(form);
    openDialog(dlg, form.querySelector("button[type=submit]"));
  }
  // tone: undefined (the document itself) | "soft" | "firm" (reminders)
  function sendEmail(d, tone) {
    var lang = d.plang || data.prof.plang || LANG;
    var saved = LANG;
    LANG = lang;
    var k = kindName(d.kind === "ext" ? "inv" : d.kind);
    var tt = C.totals(d);
    var sel = C.sellerOf(data, d);
    var subj = t("mail.subject", { k: k, n: d.num });
    var body = d.due ? t("mail.body", { k: k, n: d.num, d: C.fmtDay(d.date), a: C.fmtMoney(tt.pay, d.cur, lang), u: C.fmtDay(d.due) })
                     : t("mail.bodyNoDue", { k: k, n: d.num, d: C.fmtDay(d.date), a: C.fmtMoney(tt.pay, d.cur, lang) });
    if (tone && d.due) {
      var late = C.lateDays(d, todayKey());
      var pr = { k: k, n: d.num, d: C.fmtDay(d.date), a: C.fmtMoney(C.balance(data, d), d.cur, lang), u: C.fmtDay(d.due), l: late };
      subj = t(tone === "firm" ? "mail.firmSubject" : "mail.softSubject", pr);
      body = t(tone === "firm" ? "mail.firm" : (late ? "mail.softLate" : "mail.soft"), pr);
    }
    if (sel.iban) body += "\n\n" + sel.iban;
    var plMail = payLinkText(d, tt);
    if (plMail) body += "\n\n" + t("mail.payOnline") + ": " + plMail;
    if (sel.name) body += "\n\n" + sel.name;
    LANG = saved;
    var to = (d.c && d.c.email) || "";
    var shell = mailShell();
    if (shell) {
      var compose = { to: to, subject: subj.slice(0, 300), body: body.slice(0, 20000) };
      var go = function (path) {
        if (path) compose.attach = [{ path: path, name: path.split("/").pop() }];
        shell.__orosOpenAt("mail", { compose: compose });
        if (!path && d.kind !== "ext") showToast(t("toast.emailHint"));
      };
      mailAttachment(d, go);
      return;
    } else {
      var href = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(body);
      var a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    if (d.kind !== "ext") showToast(t("toast.emailHint"));
  }

  // ---------- 13. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "invoices", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }
  var toastTimer = null, undoFn = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    undoFn = onUndo || null;
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", runUndo);
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); undoFn = null; }, onUndo ? 8000 : 4000);
  }
  function runUndo() {
    var fn = undoFn;
    undoFn = null;
    $("toast").classList.remove("show");
    clearTimeout(toastTimer);
    if (fn) fn();
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 14. Keyboard ----------
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
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (undoFn) { e.preventDefault(); runUndo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "Escape" && (view === "edit")) { e.preventDefault(); closeEditor(false); return; }
      if (e.key === "Escape" && view === "set") { e.preventDefault(); leaveSettings(); return; }
      if (e.key === "Escape" && view === "view") { e.preventDefault(); showView(tab); return; }
      if (view === "edit") return;
      if (e.code === "KeyN") { e.preventDefault(); newMenu(); }
      else if (e.key === "/" && view === "docs") { e.preventDefault(); $("q").focus(); }
    });
  }

  // ---------- 15. Sync slice + palette ----------
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
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("invoices", sliceGet, sliceSet, STORAGE_KEY, C.mergeInvoices);
  }
  function sliceGet() { return C.normalize(data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.docs)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeInvoices(data, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (document.querySelector("dialog[open]")) return;
    renderAll();
  }

  // ---------- 16. Wiring, boot, deep links ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    var icons = { docs: UI.doc, clients: UI.users, dash: UI.chart };
    TABS.forEach(function (k) {
      var b = $("tab-" + k);
      b.innerHTML = icons[k] + "<span></span>";
      b.lastChild.textContent = t("tab." + k);
      b.title = t("tab." + k);
    });
    $("set-btn").innerHTML = UI.gear;
    $("set-btn").title = t("settings");
    $("set-btn").setAttribute("aria-label", t("settings"));
    $("new-btn").innerHTML = UI.plus + "<span></span>";
    $("new-btn").lastChild.textContent = t("new");
    $("new-btn").title = t("new");
    $("q").placeholder = t("f.search");
    $("q").setAttribute("aria-label", t("f.search"));
    $("cq").placeholder = t("cli.search");
    $("cq").setAttribute("aria-label", t("cli.search"));
    $("add-client").innerHTML = UI.plus + "<span></span>";
    $("add-client").lastChild.textContent = t("cli.new");
    $("imp-contacts").textContent = t("cli.fromContacts");
    $("imp-quote").textContent = t("cli.fromQuote");
    $("imp-crm").textContent = t("cli.fromCrm");
    $("setup-text").textContent = t("setup.text");
    $("setup-go").textContent = t("setup.go");
    $("f-status").setAttribute("aria-label", t("f.allStatus"));
    $("f-kind").setAttribute("aria-label", t("f.allKind"));
    $("f-year").setAttribute("aria-label", t("f.allYears"));
    $("d-range").setAttribute("aria-label", t("dash.range"));
    $("d-from").setAttribute("aria-label", t("dash.from"));
    $("d-to").setAttribute("aria-label", t("dash.to"));
    $("d-cur").setAttribute("aria-label", t("dash.cur"));
  }

  function wire() {
    TABS.forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () {
        if (view === "edit" && ed && ed.dirty) { closeEditorThen(function () { setTab(k); }); return; }
        if (view === "edit") { ed = null; shelter(); }
        setTab(k);
      });
    });
    $("set-btn").addEventListener("click", function () {
      setReturn = "";
      if (view === "edit" && ed && ed.dirty) { closeEditorThen(function () { showView("set"); }); return; }
      if (view === "edit") { ed = null; shelter(); }
      showView("set");
    });
    $("new-btn").addEventListener("click", function () {
      if (view === "edit" && ed && ed.dirty) { closeEditorThen(newMenu); return; }
      newMenu();
    });
    $("ed-back").addEventListener("click", function () { closeEditor(false); });
    $("vw-back").addEventListener("click", function () { showView(tab); });
    $("set-back").addEventListener("click", leaveSettings);
    $("setup-go").addEventListener("click", setupFirst);
    $("q").addEventListener("input", renderDocs);
    $("cq").addEventListener("input", renderClients);
    [["f-status", "st"], ["f-kind", "kind"], ["f-year", "year"]].forEach(function (x) {
      $(x[0]).addEventListener("change", function () { prefs.f[x[1]] = $(x[0]).value; savePrefs(); renderDocs(); });
    });
    $("add-client").addEventListener("click", function () { clientDialog(null, null); });
    $("imp-contacts").addEventListener("click", fromContacts);
    $("imp-quote").addEventListener("click", fromQuote);
    $("imp-crm").addEventListener("click", fromCrm);
    $("d-range").addEventListener("change", function () { prefs.dash.range = $("d-range").value; savePrefs(); renderDash(); });
    $("d-cur").addEventListener("change", function () { prefs.dash.cur = $("d-cur").value; savePrefs(); renderDash(); });
    ["d-from", "d-to"].forEach(function (idn) {
      $(idn).addEventListener("change", function () {
        if (!C.validDay($(idn).value)) return;
        prefs.dash[idn === "d-from" ? "from" : "to"] = $(idn).value;
        savePrefs();
        renderDash();
      });
    });
    $("csv-docs").addEventListener("click", function () { exportCsv("docs"); });
    $("sheet-docs").addEventListener("click", openDocsInSheet);
    $("csv-pays").addEventListener("click", function () { exportCsv("pays"); });
    $("acct-pack").addEventListener("click", openAcctPack);
    $("ed-form").addEventListener("submit", function (e) { e.preventDefault(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { shelter(); return; }
      runRecurring();
      if (!document.querySelector("dialog[open]")) renderAll();
    });
    window.addEventListener("pagehide", shelter);
    // A new day while open: statuses (overdue) and recurring drafts.
    var lastDay = todayKey();
    setInterval(function () {
      if (document.hidden) return;
      var k = todayKey();
      if (k === lastDay) return;
      lastDay = k;
      runRecurring();
      if (!document.querySelector("dialog[open]")) renderAll();
    }, 60000);
    wireKeyboard();
  }
  function closeEditorThen(fn) {
    confirmDialog(t("dlg.leaveTitle"), t("dlg.leaveText"), t("dlg.discard"), function () {
      ed = null;
      shelter();
      fn();
    }, true);
  }

  // Connected services wave 2: myDATA through timologisi.online (mydata-ui.js)
  var MD = window.OrosInvoicesMyData || null;
  function initMyData() {
    if (!MD) return;
    MD.init({
      get lang() { return LANG; },
      core: C, el: el, btn: btn, field: field, input: input, select: select, fillSelect: fillSelect,
      makeDialog: makeDialog, actions: actions, openDialog: openDialog, toast: showToast,
      day: day, kindName: kindName, today: todayKey, findDoc: findDoc, putDoc: putDoc,
      data: function () { return data; }, renderViewer: function () { renderAll(); }
    });
  }

  function boot() {
    initMyData();
    load();
    loadPrefs();
    tab = prefs.tab;
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    runRecurring();
    showView(tab);
    takeShelter();
  }

  boot();

  // Deep links (shell __orosOpenAt / __orosTakeTarget):
  //   { newDoc: "inv"|"rcpt", notes? } a blank invoice / receipt (single app)
  //   { new: {...} }          BR-INV-NEW prefill (CRM Lite, Quote, Timesheet,
  //                           Assistant): a new invoice draft, saved only
  //                           when the user saves or issues it
  //   { invoice: id }         open that document (search, CRM Lite)
  //   { client: { id? | crm? | afm? | name? } }   that client's documents
  //   { openFile: { token } } "Open with" an .orosinvoices file
  //                           (fileopen.js): the File taken once with
  //                           window.parent.__orosTakeFile(token)
  function openTarget(tg) {
    if (tg && tg.openFile) { if (recFile) recFile.openTarget(tg.openFile); return; }
    if (!tg || typeof tg !== "object" || document.querySelector("dialog[open]")) return;
    if (tg["new"]) { prefillNew(tg["new"]); return; }
    // Single app: a blank invoice or receipt (icon shortcuts), or a
    // new invoice with shared text as its notes (unsaved until saved).
    if (tg.newDoc === "inv" || tg.newDoc === "rcpt") {
      if (view === "edit" && ed && ed.dirty) return;
      var notes = typeof tg.notes === "string" ? tg.notes.trim().slice(0, 500) : "";
      newDoc(tg.newDoc, notes ? function (x) { x.notes = notes; } : null);
      if (notes) { ed.dirty = true; shelter(); }
      return;
    }
    if (tg.recurring) {   // Today: "recurring invoice ready" → its draft in the list
      if (view === "edit" && ed && ed.dirty) return;
      runRecurring();
      setTab("docs");
      return;
    }
    if (typeof tg.invoice === "string") {
      if (view === "edit" && ed && ed.dirty) return;
      openDoc(tg.invoice);
      return;
    }
    if (tg.client && typeof tg.client === "object") {
      var c = typeof tg.client.id === "string" ? C.client(data, tg.client.id) : C.matchClient(data, tg.client);
      if (!c) return;
      if (view === "edit" && ed && ed.dirty) return;
      cliFilter = c.id;
      setTab("docs");
    }
  }
  function prefillNew(raw) {
    var p = C.normPrefill(raw);
    if (!p) return;
    var go = function () {
      var c = C.matchClient(data, { crm: p.crm, afm: p.client && p.client.afm, name: p.client && p.client.name });
      var fillDoc = function (cl) {
        newDoc("inv", function (x) {
          if (p.cur) x.cur = p.cur;
          if (cl) { x.cli = cl.id; x.c = C.partyOfClient(cl); x.crm = cl.crm || p.crm; }
          else if (p.client) { x.c = C.normParty(p.client); x.crm = p.crm; }
          if (p.items.length) {
            x.lines = p.items.map(function (it) {
              return { code: it.code || "", d: it.d, q: it.q, unit: it.unit || "", p: it.p, disc: it.disc || 0,
                       vat: it.vat !== undefined ? it.vat : data.prof.vat };
            });
          }
          if (p.notes) x.notes = p.notes;
          if (p.gDisc) x.gDisc = p.gDisc;
        });
        ed.dirty = true;
        shelter();
        if (p.ref) showToast(t("toast.prefilled", { a: appName(p.ref.app) }));
      };
      if (c || !p.client) { fillDoc(c); return; }
      // An unknown client: the New client dialog, filled in; the
      // client exists only if the user saves it.
      fillDoc(null);
      clientDialog(null, function (cl) {
        if (!ed) return;
        ed.doc.cli = cl.id;
        ed.doc.c = C.partyOfClient(cl);
        if (cl.crm) ed.doc.crm = cl.crm;
        buildEditor();
        touch();
      }, Object.assign({ crm: p.crm }, p.client));
    };
    if (view === "edit" && ed && ed.dirty) closeEditorThen(go);
    else go();
  }
  function appName(id) {
    try {
      var tr = window.parent && window.parent.OROS_TRANSLATIONS;
      var s = tr && tr[LANG] && tr[LANG]["app." + id];
      if (typeof s === "string" && s) return s;
    } catch (e) {}
    return id;
  }
  window.__orosOpenAt = openTarget;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("invoices");
      if (pendingTarget) openTarget(pendingTarget);
    }
  } catch (e) {}
})();
