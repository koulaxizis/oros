// ============================================================
// orOS Stock — App logic (v1.0.0)
// Business inventory (not the home Storage app):
//   - products with SKU, barcode, category, unit, minimum, reorder
//     quantity, supplier, purchase / sale price, VAT, location
//   - a ledger of movements: receive, sell, customer return, return
//     to supplier, loss, stock count, correction; several lines per
//     movement, a reference (invoice / receipt no.), void instead of
//     delete
//   - the quantity on hand is the SUM of the movements (core.js),
//     never a stored number: two devices selling at once never lose
//     a sale through sync
//   - Reorder: items at or below their minimum, by supplier, with a
//     suggested quantity, "Copy list" and "Receive this order"
//   - suppliers (also from Contacts), categories, own units
//   - a USB / Bluetooth barcode scanner works as a keyboard in every
//     search and line field (code + Enter)
//   - CSV import of products (own export, WooCommerce export, any
//     sheet with known column names), CSV export of products and
//     movements, JSON export / import (a merge)
//   - the low-stock notice comes from the shell (stockCheckTick, which
//     uses core.js too)
// Data:
//   - synced slice "stock" (oros-stock-data): OrosStockCore.merge
//     (R5, R26)
//   - device-local (R10): oros-stock-prefs (notify, tab, filters)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Mutations
//   4. Products view + product sheet
//   5. Movements view + movement sheet
//   6. Reorder view
//   7. Suppliers view
//   8. Editors: product, movement, supplier, categories, units
//   9. Settings, CSV / JSON
//  10. Dialogs + toasts
//  11. Keyboard (Contract B) + deep link
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosStockCore;
  var STORAGE_KEY = "oros-stock-data";
  var PREFS_KEY   = "oros-stock-prefs";
  var CUR_SYM = { EUR: "€", USD: "$", GBP: "£", JPY: "¥" };
  var MAX_SHOWN = 300;

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
      "app": "Stock",
      "tab.items": "Products", "tab.moves": "Movements", "tab.order": "Reorder", "tab.sups": "Suppliers",
      "btn.add": "New", "btn.addAria": "New product, movement or supplier", "btn.settings": "Settings",
      "add.title": "New", "add.item": "Product", "add.in": "Receive stock", "add.out": "Sell / issue",
      "add.count": "Stock count", "add.other": "Other movement", "add.sup": "Supplier",
      "empty.title": "Your stock starts here",
      "empty.body": "Add your products, or import them from a CSV file (your shop's product export works too). The quantity of each product comes from its movements: receive, sell, count.",
      "empty.add": "Add a product", "empty.import": "Import a CSV",
      "tile.items": "Products", "tile.value": "Stock value", "tile.low": "To reorder", "tile.out": "Out of stock",
      "q.ph": "Search, or scan a SKU / barcode",
      "f.all": "All", "f.low": "Low", "f.out": "Out of stock", "f.arch": "Archived",
      "f.allCats": "All categories", "f.noCat": "No category",
      "sort.name": "By name", "sort.sku": "By SKU", "sort.qty": "By quantity", "sort.value": "By value",
      "items.none": "No product matches.", "items.more": "Showing {n} of {all}. Search to narrow the list.",
      "scan.none": "No product with the code “{c}”.", "scan.new": "New product",
      "badge.low": "low", "badge.out": "out", "badge.arch": "archived",
      "sheet.onHand": "On hand", "sheet.min": "Minimum", "sheet.avg": "Average cost", "sheet.value": "Value",
      "sheet.price": "Sale price", "sheet.vat": "VAT", "sheet.sup": "Supplier", "sheet.loc": "Location",
      "sheet.bc": "Barcode", "sheet.cat": "Category", "sheet.rq": "Reorder qty",
      "sheet.days": "About {n} days left at the last 30 days' pace",
      "sheet.history": "Movements", "sheet.noHistory": "No movements yet.",
      "sheet.more": "More", "sheet.edit": "Edit", "sheet.label": "Make a label",
      "sheet.archive": "Archive", "sheet.unarchive": "Unarchive", "sheet.delete": "Delete",
      "sheet.delHint": "A product with movements can't be deleted; archive it instead.",
      "act.in": "+ Receive", "act.out": "− Sell", "act.count": "Count",
      "t.in": "Receive", "t.out": "Sale", "t.ret": "Customer return", "t.rts": "Return to supplier",
      "t.loss": "Loss / damage", "t.count": "Stock count", "t.fix": "Correction",
      "voided": "voided",
      "moves.none": "No movements in this period.",
      "r.30": "Last 30 days", "r.month": "This month", "r.year": "This year", "r.all": "All",
      "mf.all": "All", "mf.in": "Receipts", "mf.out": "Sales", "mf.ret": "Returns", "mf.loss": "Losses", "mf.count": "Counts", "mf.fix": "Corrections",
      "lines": "{n} products",
      "mv.ref": "Ref.", "mv.sup": "Supplier", "mv.note": "Note", "mv.total": "Total",
      "mv.void": "Void this movement", "mv.voidQ": "Void this movement? Its quantities stop counting. It stays in the list, crossed out.",
      "mv.voidYes": "Void", "mv.voided": "This movement was voided.",
      "mv.counted": "counted {n}",
      "order.none": "Nothing to reorder. Products show up here when they reach their minimum (set one in the product).",
      "order.noSup": "No supplier", "order.copy": "Copy list", "order.receive": "Receive this order",
      "order.have": "have {q} · min {m}", "order.copied": "List copied",
      "order.head": "Order from {s} · {d}",
      "sups.none": "No suppliers yet.", "sups.items": "{n} products",
      "ed.newItem": "New product", "ed.editItem": "Edit product",
      "ed.name": "Name", "ed.sku": "SKU", "ed.bc": "Barcode", "ed.cat": "Category", "ed.unit": "Unit",
      "ed.min": "Minimum", "ed.rq": "Reorder qty", "ed.sup": "Supplier", "ed.ssku": "Supplier's code",
      "ed.cost": "Purchase price ({c})", "ed.price": "Sale price ({c})", "ed.vat": "VAT %", "ed.loc": "Location",
      "ed.note": "Note", "ed.open": "Opening quantity", "ed.openHint": "Saved as a stock count dated today.",
      "ed.none": "—", "ed.newCat": "New category…", "ed.newUnit": "New unit…", "ed.newSup": "New supplier…",
      "ed.minHint": "At or below this you get a notice and the product shows in Reorder. 0 = never.",
      "ed.dupSku": "Another product already has this SKU.", "ed.dupBc": "Another product already has this barcode.",
      "ed.save": "Save", "ed.cancel": "Cancel", "ed.delete": "Delete", "ed.needName": "Give it a name first.",
      "ed.badNum": "Check the numbers.",
      "ed.locPh": "e.g. Shelf B3",
      "mv.new": "New movement", "mv.type": "Type", "mv.date": "Date", "mv.refPh": "Invoice / receipt no.",
      "mv.add": "Add a product", "mv.addPh": "Search or scan…", "mv.qty": "Quantity", "mv.cost": "Unit cost",
      "mv.price": "Unit price", "mv.countN": "Counted", "mv.fixQ": "+ / − quantity",
      "mv.now": "now {q}", "mv.diff": "difference {d}", "mv.noLines": "Add at least one product.",
      "mv.badLine": "Check the quantity of “{n}”.", "mv.remove": "Remove",
      "mv.neg": "{n} would go below zero ({q}).", "mv.negQ": "{n} would go below zero ({q}). Save anyway?",
      "mv.negSave": "Save anyway", "mv.negBlocked": "Negative stock is switched off in Settings.",
      "mv.matches": "Matches", "mv.noMatch": "No product matches.",
      "mv.lineAdded": "{n} added", "mv.lineMore": "{n}: {q}",
      "sup.new": "New supplier", "sup.edit": "Edit supplier", "sup.name": "Name", "sup.person": "Contact person",
      "sup.tel": "Phone", "sup.email": "E-mail", "sup.vatno": "VAT no.", "sup.lead": "Delivery time (days)",
      "sup.note": "Note", "sup.contacts": "From Contacts", "sup.pick": "Pick a contact", "sup.noContacts": "No contacts found.",
      "sup.delQ": "Delete this supplier? Products and movements keep working, they just show no supplier.",
      "cat.title": "Categories", "cat.new": "New category", "cat.name": "Category name", "cat.delQ": "Delete the category “{n}”? Its products stay, without a category.",
      "unit.title": "Units", "unit.new": "New unit", "unit.name": "Unit name", "unit.dec": "Decimals",
      "unit.ready": "Ready units", "unit.own": "Your units", "unit.inUse": "In use by a product: change those products first.",
      "unit.none": "No units of your own yet.",
      "set.title": "Settings", "set.cur": "Currency", "set.vat": "Default VAT %", "set.neg": "Allow stock below zero (with a warning)",
      "set.notify": "Low-stock notice on this device", "set.lists": "Lists", "set.cats": "Categories", "set.units": "Units",
      "set.data": "Data", "set.impCsv": "Import products (CSV)", "set.expCsv": "Products (CSV)", "set.expMoves": "Movements (CSV)",
      "set.json": "Backup (JSON)", "set.import": "Restore backup", "set.close": "Close",
      "set.negHint": "Two devices can sell the last piece at the same time; with this off, a sale that would go below zero is refused on this device.",
      "imp.title": "Import products", "imp.stats": "{a} new · {u} updated · {s} unchanged · {k} skipped",
      "imp.setQty": "Set the quantities from the file (saved as a stock count)", "imp.qtyN": "{n} quantities change",
      "imp.go": "Import", "imp.bad": "No product columns found. The first row must name the columns (Name or SKU at least).",
      "imp.done": "Imported: {a} new, {u} updated",
      "toast.saved": "Saved", "toast.added": "Added", "toast.deleted": "Deleted", "toast.undo": "Undo",
      "toast.save": "Couldn't save: the browser storage is full.", "toast.exported": "Exported",
      "toast.badFile": "That file can't be read.", "toast.imported": "Backup merged: {n} products",
      "toast.voided": "Movement voided", "toast.archived": "Archived", "toast.unarchived": "Back in the list",
      "open.ref": "Opening stock", "csv.ref": "CSV",
      "u.custom": "unit"
    },
    el: {
      "app": "Απόθεμα",
      "tab.items": "Προϊόντα", "tab.moves": "Κινήσεις", "tab.order": "Παραγγελία", "tab.sups": "Προμηθευτές",
      "btn.add": "Νέο", "btn.addAria": "Νέο προϊόν, κίνηση ή προμηθευτής", "btn.settings": "Ρυθμίσεις",
      "add.title": "Νέο", "add.item": "Προϊόν", "add.in": "Παραλαβή", "add.out": "Πώληση / έξοδος",
      "add.count": "Απογραφή", "add.other": "Άλλη κίνηση", "add.sup": "Προμηθευτής",
      "empty.title": "Το απόθεμά σου ξεκινά εδώ",
      "empty.body": "Πρόσθεσε τα προϊόντα σου ή φέρε τα από αρχείο CSV (κάνει και η εξαγωγή προϊόντων του e-shop σου). Η ποσότητα κάθε προϊόντος βγαίνει από τις κινήσεις του: παραλαβή, πώληση, απογραφή.",
      "empty.add": "Πρόσθεσε προϊόν", "empty.import": "Εισαγωγή CSV",
      "tile.items": "Προϊόντα", "tile.value": "Αξία αποθήκης", "tile.low": "Για παραγγελία", "tile.out": "Εξαντλημένα",
      "q.ph": "Αναζήτηση ή σάρωση SKU / barcode",
      "f.all": "Όλα", "f.low": "Χαμηλά", "f.out": "Εξαντλημένα", "f.arch": "Αρχειοθετημένα",
      "f.allCats": "Όλες οι κατηγορίες", "f.noCat": "Χωρίς κατηγορία",
      "sort.name": "Κατά όνομα", "sort.sku": "Κατά SKU", "sort.qty": "Κατά ποσότητα", "sort.value": "Κατά αξία",
      "items.none": "Κανένα προϊόν δεν ταιριάζει.", "items.more": "Φαίνονται {n} από {all}. Ψάξε για να μικρύνει η λίστα.",
      "scan.none": "Δεν υπάρχει προϊόν με κωδικό «{c}».", "scan.new": "Νέο προϊόν",
      "badge.low": "χαμηλό", "badge.out": "τέλος", "badge.arch": "αρχείο",
      "sheet.onHand": "Διαθέσιμα", "sheet.min": "Ελάχιστο", "sheet.avg": "Μέσο κόστος", "sheet.value": "Αξία",
      "sheet.price": "Τιμή πώλησης", "sheet.vat": "ΦΠΑ", "sheet.sup": "Προμηθευτής", "sheet.loc": "Θέση",
      "sheet.bc": "Barcode", "sheet.cat": "Κατηγορία", "sheet.rq": "Ποσότητα παραγγελίας",
      "sheet.days": "Φτάνει για ~{n} μέρες με τον ρυθμό των τελευταίων 30 ημερών",
      "sheet.history": "Κινήσεις", "sheet.noHistory": "Καμία κίνηση ακόμα.",
      "sheet.more": "Περισσότερα", "sheet.edit": "Επεξεργασία", "sheet.label": "Φτιάξε ετικέτα",
      "sheet.archive": "Αρχειοθέτηση", "sheet.unarchive": "Επαναφορά από το αρχείο", "sheet.delete": "Διαγραφή",
      "sheet.delHint": "Προϊόν με κινήσεις δεν διαγράφεται· αρχειοθέτησέ το.",
      "act.in": "+ Παραλαβή", "act.out": "− Πώληση", "act.count": "Απογραφή",
      "t.in": "Παραλαβή", "t.out": "Πώληση", "t.ret": "Επιστροφή πελάτη", "t.rts": "Επιστροφή σε προμηθευτή",
      "t.loss": "Φθορά / απώλεια", "t.count": "Απογραφή", "t.fix": "Διόρθωση",
      "voided": "ακυρωμένη",
      "moves.none": "Καμία κίνηση σε αυτό το διάστημα.",
      "r.30": "Τελευταίες 30 μέρες", "r.month": "Αυτός ο μήνας", "r.year": "Φέτος", "r.all": "Όλες",
      "mf.all": "Όλες", "mf.in": "Παραλαβές", "mf.out": "Πωλήσεις", "mf.ret": "Επιστροφές", "mf.loss": "Φθορές", "mf.count": "Απογραφές", "mf.fix": "Διορθώσεις",
      "lines": "{n} προϊόντα",
      "mv.ref": "Παραστατικό", "mv.sup": "Προμηθευτής", "mv.note": "Σημείωση", "mv.total": "Σύνολο",
      "mv.void": "Ακύρωση κίνησης", "mv.voidQ": "Να ακυρωθεί η κίνηση; Οι ποσότητές της δεν μετράνε πια. Μένει στη λίστα, διαγραμμένη.",
      "mv.voidYes": "Ακύρωση", "mv.voided": "Αυτή η κίνηση ακυρώθηκε.",
      "mv.counted": "μετρήθηκαν {n}",
      "order.none": "Δεν χρειάζεται παραγγελία. Τα προϊόντα εμφανίζονται εδώ όταν φτάσουν στο ελάχιστο (το ορίζεις στο προϊόν).",
      "order.noSup": "Χωρίς προμηθευτή", "order.copy": "Αντιγραφή λίστας", "order.receive": "Παραλαβή παραγγελίας",
      "order.have": "έχεις {q} · ελάχιστο {m}", "order.copied": "Η λίστα αντιγράφηκε",
      "order.head": "Παραγγελία προς {s} · {d}",
      "sups.none": "Κανένας προμηθευτής ακόμα.", "sups.items": "{n} προϊόντα",
      "ed.newItem": "Νέο προϊόν", "ed.editItem": "Επεξεργασία προϊόντος",
      "ed.name": "Όνομα", "ed.sku": "SKU", "ed.bc": "Barcode", "ed.cat": "Κατηγορία", "ed.unit": "Μονάδα",
      "ed.min": "Ελάχιστο", "ed.rq": "Ποσότητα παραγγελίας", "ed.sup": "Προμηθευτής", "ed.ssku": "Κωδικός προμηθευτή",
      "ed.cost": "Τιμή αγοράς ({c})", "ed.price": "Τιμή πώλησης ({c})", "ed.vat": "ΦΠΑ %", "ed.loc": "Θέση",
      "ed.note": "Σημείωση", "ed.open": "Αρχική ποσότητα", "ed.openHint": "Καταχωρείται ως απογραφή με σημερινή ημερομηνία.",
      "ed.none": "—", "ed.newCat": "Νέα κατηγορία…", "ed.newUnit": "Νέα μονάδα…", "ed.newSup": "Νέος προμηθευτής…",
      "ed.minHint": "Όταν φτάσει εδώ ή πιο κάτω, παίρνεις ειδοποίηση και το προϊόν μπαίνει στην Παραγγελία. 0 = ποτέ.",
      "ed.dupSku": "Άλλο προϊόν έχει ήδη αυτό το SKU.", "ed.dupBc": "Άλλο προϊόν έχει ήδη αυτό το barcode.",
      "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο", "ed.delete": "Διαγραφή", "ed.needName": "Δώσε πρώτα ένα όνομα.",
      "ed.badNum": "Έλεγξε τους αριθμούς.",
      "ed.locPh": "π.χ. Ράφι Β3",
      "mv.new": "Νέα κίνηση", "mv.type": "Είδος", "mv.date": "Ημερομηνία", "mv.refPh": "Αρ. τιμολογίου / απόδειξης",
      "mv.add": "Πρόσθεσε προϊόν", "mv.addPh": "Αναζήτηση ή σάρωση…", "mv.qty": "Ποσότητα", "mv.cost": "Κόστος μονάδας",
      "mv.price": "Τιμή μονάδας", "mv.countN": "Μετρήθηκαν", "mv.fixQ": "+ / − ποσότητα",
      "mv.now": "τώρα {q}", "mv.diff": "διαφορά {d}", "mv.noLines": "Πρόσθεσε τουλάχιστον ένα προϊόν.",
      "mv.badLine": "Έλεγξε την ποσότητα του «{n}».", "mv.remove": "Αφαίρεση",
      "mv.neg": "Το «{n}» θα πέσει κάτω από το μηδέν ({q}).", "mv.negQ": "Το «{n}» θα πέσει κάτω από το μηδέν ({q}). Να αποθηκευτεί;",
      "mv.negSave": "Αποθήκευση", "mv.negBlocked": "Το αρνητικό απόθεμα είναι κλειστό στις Ρυθμίσεις.",
      "mv.matches": "Αποτελέσματα", "mv.noMatch": "Κανένα προϊόν δεν ταιριάζει.",
      "mv.lineAdded": "Προστέθηκε: {n}", "mv.lineMore": "{n}: {q}",
      "sup.new": "Νέος προμηθευτής", "sup.edit": "Επεξεργασία προμηθευτή", "sup.name": "Επωνυμία", "sup.person": "Υπεύθυνος επικοινωνίας",
      "sup.tel": "Τηλέφωνο", "sup.email": "E-mail", "sup.vatno": "ΑΦΜ", "sup.lead": "Χρόνος παράδοσης (μέρες)",
      "sup.note": "Σημείωση", "sup.contacts": "Από τις Επαφές", "sup.pick": "Διάλεξε επαφή", "sup.noContacts": "Δεν βρέθηκαν επαφές.",
      "sup.delQ": "Να διαγραφεί ο προμηθευτής; Προϊόντα και κινήσεις συνεχίζουν κανονικά, απλώς χωρίς προμηθευτή.",
      "cat.title": "Κατηγορίες", "cat.new": "Νέα κατηγορία", "cat.name": "Όνομα κατηγορίας", "cat.delQ": "Να διαγραφεί η κατηγορία «{n}»; Τα προϊόντα της μένουν, χωρίς κατηγορία.",
      "unit.title": "Μονάδες", "unit.new": "Νέα μονάδα", "unit.name": "Όνομα μονάδας", "unit.dec": "Δεκαδικά",
      "unit.ready": "Έτοιμες μονάδες", "unit.own": "Δικές σου μονάδες", "unit.inUse": "Τη χρησιμοποιεί προϊόν: άλλαξε πρώτα εκείνα τα προϊόντα.",
      "unit.none": "Καμία δική σου μονάδα ακόμα.",
      "set.title": "Ρυθμίσεις", "set.cur": "Νόμισμα", "set.vat": "Προεπιλεγμένο ΦΠΑ %", "set.neg": "Να επιτρέπεται απόθεμα κάτω από το μηδέν (με προειδοποίηση)",
      "set.notify": "Ειδοποίηση χαμηλού αποθέματος σε αυτή τη συσκευή", "set.lists": "Λίστες", "set.cats": "Κατηγορίες", "set.units": "Μονάδες",
      "set.data": "Δεδομένα", "set.impCsv": "Εισαγωγή προϊόντων (CSV)", "set.expCsv": "Προϊόντα (CSV)", "set.expMoves": "Κινήσεις (CSV)",
      "set.json": "Αντίγραφο (JSON)", "set.import": "Επαναφορά αντιγράφου", "set.close": "Κλείσιμο",
      "set.negHint": "Δύο συσκευές μπορεί να πουλήσουν το τελευταίο κομμάτι ταυτόχρονα· αν το κλείσεις, μια πώληση που θα έριχνε το απόθεμα κάτω από το μηδέν απορρίπτεται σε αυτή τη συσκευή.",
      "imp.title": "Εισαγωγή προϊόντων", "imp.stats": "{a} νέα · {u} ενημερωμένα · {s} ίδια · {k} παραλείφθηκαν",
      "imp.setQty": "Ορισμός ποσοτήτων από το αρχείο (ως απογραφή)", "imp.qtyN": "Αλλάζουν {n} ποσότητες",
      "imp.go": "Εισαγωγή", "imp.bad": "Δεν βρέθηκαν στήλες προϊόντων. Η πρώτη γραμμή πρέπει να έχει τα ονόματα των στηλών (τουλάχιστον Όνομα ή SKU).",
      "imp.done": "Εισαγωγή: {a} νέα, {u} ενημερωμένα",
      "toast.saved": "Αποθηκεύτηκε", "toast.added": "Προστέθηκε", "toast.deleted": "Διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του browser γέμισε.", "toast.exported": "Έγινε εξαγωγή",
      "toast.badFile": "Αυτό το αρχείο δεν διαβάζεται.", "toast.imported": "Το αντίγραφο ενώθηκε: {n} προϊόντα",
      "toast.voided": "Η κίνηση ακυρώθηκε", "toast.archived": "Αρχειοθετήθηκε", "toast.unarchived": "Ξανά στη λίστα",
      "open.ref": "Αρχικό απόθεμα", "csv.ref": "CSV",
      "u.custom": "μονάδα"
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

  var UI = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  var T_ICON = { "in": "📥", out: "📤", ret: "↩️", rts: "↪️", loss: "💔", count: "📋", fix: "✏️" };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function todayYmd() { return C.ymdOf(new Date()); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  var NF = {};
  function nf(dec) {
    var k = String(dec);
    if (!NF[k]) {
      try { NF[k] = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: dec }); }
      catch (e) { NF[k] = { format: function (n) { return String(Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec)); } }; }
    }
    return NF[k];
  }
  var MF = {};
  function money(cents) {
    var cur = (data && data.settings && data.settings.cur) || "EUR";
    if (!MF[cur]) {
      try { MF[cur] = new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur }); }
      catch (e) { MF[cur] = { format: function (n) { return n.toFixed(2) + " " + cur; } }; }
    }
    return MF[cur].format(cents / 100);
  }
  function curSym() {
    var cur = (data && data.settings && data.settings.cur) || "EUR";
    return CUR_SYM[cur] || cur;
  }
  function unitLabel(unitId) {
    var n = C.unitName(unitId, LANG);
    if (n) return n;
    var u = byId("units", unitId);
    return u ? u.name : t("u.custom");
  }
  function decOf(item) { return C.unitDec(data, item ? item.unit : "pcs"); }
  // thousandths → "12,5 kg"
  function fmtQ(q, item, noUnit) {
    var s = nf(decOf(item)).format(q / 1000);
    return noUnit ? s : s + " " + unitLabel(item ? item.unit : "pcs");
  }
  function fmtSigned(q, item) { return (q > 0 ? "+" : (q < 0 ? "−" : "±")) + fmtQ(Math.abs(q), item); }
  function fmtDay(ymd, withYear) {
    var d = new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    var o = { weekday: "short", day: "numeric", month: "short" };
    if (withYear || ymd.slice(0, 4) !== todayYmd().slice(0, 4)) o.year = "numeric";
    try { return d.toLocaleDateString(LOCALE, o); } catch (e) { return ymd; }
  }
  // what the user typed → thousandths, rounded to the unit's decimals; null = invalid
  function readQty(input, item, allowNeg) {
    var v = C.parseNum(String(input.value || "").trim(), LANG);
    if (v === null) return null;
    if (v < 0 && !allowNeg) return null;
    var dec = decOf(item), q = Math.round(v * Math.pow(10, dec)) * Math.pow(10, 3 - dec);
    return Math.abs(q) > C.Q_MAX ? null : q;
  }
  function qtyStr(q, item) {
    if (q === null || q === undefined) return "";
    var dec = decOf(item), v = q / 1000;
    var s = dec ? String(Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)) : String(Math.round(v));
    return LANG === "el" ? s.replace(".", ",") : s;
  }
  function readCents(input) {
    var s = String(input.value || "").trim();
    if (!s) return 0;
    var v = C.parseNum(s, LANG);
    if (v === null || v < 0) return null;
    var c = Math.round(v * 100);
    return c > C.C_MAX ? null : c;
  }
  function centsStr(c) {
    if (!c) return "";
    var s = (c / 100).toFixed(2);
    return LANG === "el" ? s.replace(".", ",") : s;
  }

  (function bootMarker() {
    var m = /v=([\d.]+)/.exec((document.currentScript && document.currentScript.src) || "");
    document.documentElement.lang = LANG;
    console.log("stock.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;

  function emptyData() { return C.merge(null, null); }
  function canonical(d) { return C.merge(d, d); }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          data = canonical(parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] stock: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  var stats = null;          // cached stockRows (cleared on every change)
  function save() {
    data = canonical(data);
    stats = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  var TABS = ["items", "moves", "order", "sups"];
  var IFILTERS = ["all", "low", "out", "arch"];
  var MFILTERS = ["all", "in", "out", "ret", "loss", "count", "fix"];
  var RANGES = ["30", "month", "year", "all"];
  var SORTS = ["name", "sku", "qty", "value"];
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    var b = C.readPrefs(p);
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      notify: b.notify,
      tab: TABS.indexOf(p.tab) >= 0 ? p.tab : "items",
      f: IFILTERS.indexOf(p.f) >= 0 ? p.f : "all",
      cat: typeof p.cat === "string" ? p.cat : "",
      sort: SORTS.indexOf(p.sort) >= 0 ? p.sort : "name",
      mf: MFILTERS.indexOf(p.mf) >= 0 ? p.mf : "all",
      range: RANGES.indexOf(p.range) >= 0 ? p.range : "30"
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function byId(list, id) {
    var arr = (data && data[list]) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function rows() {
    if (!stats) {
      stats = { list: C.stockRows(data), by: Object.create(null) };
      stats.list.forEach(function (r) { stats.by[r.item.id] = r; });
    }
    return stats;
  }
  function rowOf(id) { return rows().by[id] || null; }
  function byName(list) {
    return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE) || cmpStr(a.id, b.id); });
  }
  function stamp(x) { x.m = Math.max(Date.now(), x.m + 1); }

  // ---------- 3. Mutations ----------
  // Insert or update one row (items, cats, units, sups). An edit
  // stamps only on a real change (R27). Returns "added" | "saved" | null.
  function upsert(list, row) {
    var cur = byId(list, row.id);
    if (!cur) {
      row.m = Date.now();
      data[list].push(row);
      return "added";
    }
    var changed = Object.keys(row).some(function (k) {
      return k !== "m" && JSON.stringify(cur[k]) !== JSON.stringify(row[k]);
    });
    if (!changed) return null;
    Object.keys(row).forEach(function (k) { if (k !== "m") cur[k] = row[k]; });
    stamp(cur);
    return "saved";
  }
  function removeRow(list, row) {
    var snapshot = JSON.parse(JSON.stringify(row));
    data.tombs[row.id] = Math.max(Date.now(), row.m);
    data[list] = data[list].filter(function (x) { return x.id !== row.id; });
    save();
    render();
    undoToast(t("toast.deleted"), function () {
      // a newer edit resurrects (R17)
      snapshot.m = Math.max(Date.now(), (data.tombs[row.id] || 0) + 1, snapshot.m + 1);
      data[list] = data[list].filter(function (x) { return x.id !== row.id; });
      data[list].push(snapshot);
      save();
      render();
    });
  }
  function addMove(mv) {
    mv.m = Date.now();
    data.moves.push(mv);
    save();
  }
  function voidMove(mv) {
    var cur = byId("moves", mv.id);
    if (!cur || cur.v === 1) return;
    cur.v = 1;
    stamp(cur);
    save();
    render();
    showToast(t("toast.voided"));
  }

  // ---------- 4. Products view + product sheet ----------
  function renderTiles() {
    var box = $("items-tiles"), r = rows().list.filter(function (x) { return !x.item.arch; });
    var value = 0, low = 0, out = 0;
    r.forEach(function (x) { value += x.value; if (x.low) low++; if (x.out) out++; });
    box.innerHTML = "";
    box.appendChild(tile(t("tile.items"), String(r.length), null));
    box.appendChild(tile(t("tile.value"), money(value), null));
    box.appendChild(tile(t("tile.low"), String(low), low ? function () { setTab("order"); } : null, low ? "warn" : ""));
    box.appendChild(tile(t("tile.out"), String(out), out ? function () { prefs.f = "out"; savePrefs(); render(); } : null, out ? "bad" : ""));
  }
  function tile(label, value, onClick, tone) {
    var n = el(onClick ? "button" : "div", "tile" + (onClick ? " tile-btn" : "") + (tone ? " " + tone : ""));
    if (onClick) { n.type = "button"; n.addEventListener("click", onClick); }
    n.appendChild(el("div", "tile-lbl", label));
    n.appendChild(el("div", "tile-val", value));
    return n;
  }

  function matchItem(it, words) {
    if (!words.length) return true;
    var cat = byId("cats", it.cat), sup = byId("sups", it.sup);
    var hay = C.fold([it.name, it.sku, it.bc, it.loc, it.ssku, cat ? cat.name : "", sup ? sup.name : ""].join(" "));
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function renderItems() {
    renderTiles();
    var chips = $("items-chips");
    chips.innerHTML = "";
    IFILTERS.forEach(function (f) {
      var b = el("button", "chip" + (prefs.f === f ? " on" : ""), t("f." + f));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.f === f ? "true" : "false");
      b.addEventListener("click", function () { prefs.f = f; savePrefs(); render(); });
      chips.appendChild(b);
    });
    var cs = $("items-cat");
    cs.innerHTML = "";
    var cats = byName(data.cats);
    cs.hidden = !cats.length;
    [["", t("f.allCats")], ["-", t("f.noCat")]].concat(cats.map(function (c) { return [c.id, c.name]; })).forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      cs.appendChild(op);
    });
    if (prefs.cat && prefs.cat !== "-" && !byId("cats", prefs.cat)) prefs.cat = "";
    cs.value = prefs.cat;
    var ss = $("items-sort");
    ss.innerHTML = "";
    SORTS.forEach(function (s) { var op = el("option", "", t("sort." + s)); op.value = s; ss.appendChild(op); });
    ss.value = prefs.sort;

    var words = C.fold($("items-q").value).split(" ").filter(Boolean);
    var list = rows().list.filter(function (r) {
      var it = r.item;
      if (prefs.f === "arch" ? !it.arch : it.arch) return false;
      if (prefs.f === "low" && !r.low) return false;
      if (prefs.f === "out" && !r.out) return false;
      if (prefs.cat === "-" && it.cat && byId("cats", it.cat)) return false;
      if (prefs.cat && prefs.cat !== "-" && it.cat !== prefs.cat) return false;
      return matchItem(it, words);
    });
    list.sort(function (a, b) {
      var x = a.item, y = b.item;
      if (prefs.sort === "sku") return (x.sku ? 0 : 1) - (y.sku ? 0 : 1) || x.sku.localeCompare(y.sku, LOCALE, { numeric: true }) || x.name.localeCompare(y.name, LOCALE);
      if (prefs.sort === "qty") return (a.q - b.q) || x.name.localeCompare(y.name, LOCALE);
      if (prefs.sort === "value") return (b.value - a.value) || x.name.localeCompare(y.name, LOCALE);
      return x.name.localeCompare(y.name, LOCALE) || cmpStr(x.id, y.id);
    });
    var ul = $("items-list");
    ul.innerHTML = "";
    if (!list.length) { ul.appendChild(el("li", "muted pad", t("items.none"))); return; }
    list.slice(0, MAX_SHOWN).forEach(function (r) { ul.appendChild(itemRow(r)); });
    if (list.length > MAX_SHOWN) ul.appendChild(el("li", "muted pad", t("items.more", { n: MAX_SHOWN, all: list.length })));
  }
  function itemRow(r) {
    var it = r.item;
    var li = el("li");
    var b = el("button", "row row-btn" + (r.out ? " lvl-out" : (r.low ? " lvl-low" : "")));
    b.type = "button";
    var body = el("span", "r-body");
    body.appendChild(el("span", "r-name", it.name));
    var sub = el("span", "r-sub");
    var cat = byId("cats", it.cat);
    [it.sku, cat ? cat.name : "", it.loc].forEach(function (s) { if (s) sub.appendChild(el("span", "", s)); });
    if (it.arch) sub.appendChild(el("span", "badge", t("badge.arch")));
    if (sub.childNodes.length) body.appendChild(sub);
    b.appendChild(body);
    var val = el("span", "r-val" + (r.out ? " bad" : (r.low ? " warn" : "")), fmtQ(r.q, it));
    if (it.price) val.appendChild(el("small", "", money(it.price)));
    b.appendChild(val);
    b.addEventListener("click", function () { itemSheet(it.id); });
    li.appendChild(b);
    return li;
  }
  // Enter in the search box: an exact SKU / barcode opens the product
  // (scanner flow); a code that matches nothing offers a new product.
  function onSearchEnter() {
    var q = $("items-q").value.trim();
    if (!q) return;
    var it = C.findByCode(data, q);
    if (it) { $("items-q").value = ""; render(); itemSheet(it.id); return; }
    var words = C.fold(q).split(" ").filter(Boolean);
    var hits = data.items.filter(function (x) { return !x.arch && matchItem(x, words); });
    if (hits.length === 1) { itemSheet(hits[0].id); return; }
    if (!hits.length && !/\s/.test(q) && q.length <= C.SKU_LEN) {
      actionToast(t("scan.none", { c: q }), t("scan.new"), function () { itemEditor(null, { sku: q }); });
    }
  }

  function kv(box, label, value, cls) {
    if (value === "" || value === null || value === undefined) return;
    var r = el("div", "kv");
    r.appendChild(el("span", "kv-k", label));
    r.appendChild(el("span", "kv-v" + (cls ? " " + cls : ""), value));
    box.appendChild(r);
  }
  function itemSheet(id) {
    var it = byId("items", id);
    if (!it) return;
    var r = rowOf(id);
    var dlg = makeDialog("st-item", true);
    var head = el("div", "sheet-head");
    var hb = el("div", "sheet-hb");
    hb.appendChild(el("div", "sheet-name", it.name));
    var sub = [it.sku, unitLabel(it.unit)].filter(Boolean).join(" · ");
    hb.appendChild(el("div", "muted", sub));
    head.appendChild(hb);
    var big = el("div", "sheet-q" + (r.out ? " bad" : (r.low ? " warn" : "")));
    big.appendChild(el("div", "tile-lbl", t("sheet.onHand")));
    big.appendChild(el("div", "sheet-qv", fmtQ(r.q, it)));
    head.appendChild(big);
    dlg.appendChild(head);
    if (it.arch) dlg.appendChild(el("p", "hint warn", t("badge.arch")));

    var acts = el("div", "quick");
    [["in", t("act.in")], ["out", t("act.out")], ["count", t("act.count")]].forEach(function (a) {
      var b = el("button", "txt-btn", a[1]);
      b.type = "button";
      b.addEventListener("click", function () { dlg.close(); moveEditor(a[0], [{ i: it.id }]); });
      acts.appendChild(b);
    });
    dlg.appendChild(acts);

    var box = el("div", "kvs");
    if (it.min) kv(box, t("sheet.min"), fmtQ(it.min, it));
    if (it.rq) kv(box, t("sheet.rq"), fmtQ(it.rq, it));
    if (r.avg) kv(box, t("sheet.avg"), money(Math.round(r.avg)));
    if (r.value) kv(box, t("sheet.value"), money(r.value));
    if (it.price) kv(box, t("sheet.price"), money(it.price));
    kv(box, t("sheet.vat"), it.vat + "%");
    var sup = byId("sups", it.sup);
    if (sup) kv(box, t("sheet.sup"), sup.name + (it.ssku ? " · " + it.ssku : ""));
    var cat = byId("cats", it.cat);
    if (cat) kv(box, t("sheet.cat"), cat.name);
    kv(box, t("sheet.bc"), it.bc);
    kv(box, t("sheet.loc"), it.loc);
    dlg.appendChild(box);
    var rate = C.outRate(data, it.id, todayYmd(), 30);
    if (rate > 0 && r.q > 0) dlg.appendChild(el("p", "hint", t("sheet.days", { n: Math.max(1, Math.round(r.q / rate)) })));
    if (it.note) dlg.appendChild(el("p", "notes", it.note));

    dlg.appendChild(el("div", "dlg-lbl", t("sheet.history")));
    var hist = C.itemMoves(data, it.id);
    if (!hist.length) dlg.appendChild(el("p", "muted", t("sheet.noHistory")));
    else {
      var ul = el("ul", "rows");
      hist.slice(0, 60).forEach(function (h) {
        var li = el("li");
        var b = el("button", "row row-btn compact" + (h.move.v === 1 ? " voided" : ""));
        b.type = "button";
        b.appendChild(el("span", "r-ico", T_ICON[h.move.t]));
        var body = el("span", "r-body");
        body.appendChild(el("span", "r-name", t("t." + h.move.t) + (h.move.ref ? " · " + h.move.ref : "")));
        var s = el("span", "r-sub");
        s.appendChild(el("span", "", fmtDay(h.move.d)));
        if (h.move.t === "count") s.appendChild(el("span", "", t("mv.counted", { n: fmtQ(h.line.n, it) })));
        if (h.move.v === 1) s.appendChild(el("span", "badge", t("voided")));
        body.appendChild(s);
        b.appendChild(body);
        var v = el("span", "r-val", fmtSigned(h.line.q, it));
        if (h.after !== null) v.appendChild(el("small", "", "→ " + fmtQ(h.after, it, true)));
        b.appendChild(v);
        b.addEventListener("click", function () { dlg.close(); moveSheet(h.move.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }

    var foot = el("div", "dlg-actions wrap");
    foot.appendChild(button(t("sheet.edit"), "", function () { dlg.close(); itemEditor(it); }));
    foot.appendChild(button(t("add.other"), "", function () { dlg.close(); moveEditor("loss", [{ i: it.id }]); }));
    if (labelBridge()) foot.appendChild(button(t("sheet.label"), "", function () {
      labelBridge()("labels", { text: (it.name + (it.sku ? " · " + it.sku : "")).slice(0, 120) });
    }));
    foot.appendChild(button(it.arch ? t("sheet.unarchive") : t("sheet.archive"), "", function () {
      var cur = byId("items", it.id);
      if (!cur) return;
      cur.arch = cur.arch ? 0 : 1;
      stamp(cur);
      save();
      dlg.close();
      render();
      showToast(cur.arch ? t("toast.archived") : t("toast.unarchived"));
    }));
    if (!C.hasMoves(data, it.id)) {
      foot.appendChild(button(t("sheet.delete"), "danger", function () { dlg.close(); removeRow("items", it); }));
    }
    dlg.appendChild(foot);
    if (C.hasMoves(data, it.id)) dlg.appendChild(el("p", "hint", t("sheet.delHint")));
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(close);
    showDialog(dlg);
  }
  function labelBridge() {
    try {
      return window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function"
        ? function (a, b) { window.parent.__orosOpenAt(a, b); } : null;
    } catch (e) { return null; }
  }

  // ---------- 5. Movements view + movement sheet ----------
  function rangeFrom(today) {
    if (prefs.range === "30") return C.addDays(today, -29);
    if (prefs.range === "month") return today.slice(0, 8) + "01";
    if (prefs.range === "year") return today.slice(0, 5) + "01-01";
    return "";
  }
  function typeMatch(mv) {
    if (prefs.mf === "all") return true;
    if (prefs.mf === "ret") return mv.t === "ret" || mv.t === "rts";
    return mv.t === prefs.mf;
  }
  function renderMoves() {
    var chips = $("moves-chips");
    chips.innerHTML = "";
    MFILTERS.forEach(function (f) {
      var b = el("button", "chip" + (prefs.mf === f ? " on" : ""), t("mf." + f));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.mf === f ? "true" : "false");
      b.addEventListener("click", function () { prefs.mf = f; savePrefs(); render(); });
      chips.appendChild(b);
    });
    var rs = $("moves-range");
    rs.innerHTML = "";
    RANGES.forEach(function (r) { var op = el("option", "", t("r." + r)); op.value = r; rs.appendChild(op); });
    rs.value = prefs.range;
    var from = rangeFrom(todayYmd());
    var list = data.moves.filter(function (mv) { return (!from || mv.d >= from) && typeMatch(mv); })
      .sort(function (a, b) { return cmpStr(b.d, a.d) || cmpStr(b.id, a.id); });
    var box = $("moves-list");
    box.innerHTML = "";
    if (!list.length) { box.appendChild(el("p", "muted pad", t("moves.none"))); return; }
    var day = null, ul = null, shown = 0;
    list.forEach(function (mv) {
      if (shown >= MAX_SHOWN) return;
      shown++;
      if (mv.d !== day) {
        day = mv.d;
        var sec = el("div", "month");
        var h = el("div", "month-head");
        h.appendChild(el("h2", "", fmtDay(day)));
        sec.appendChild(h);
        ul = el("ul", "rows");
        sec.appendChild(ul);
        box.appendChild(sec);
      }
      ul.appendChild(moveRow(mv));
    });
    if (list.length > MAX_SHOWN) box.appendChild(el("p", "muted pad", t("items.more", { n: MAX_SHOWN, all: list.length })));
  }
  function moveTitle(mv) {
    if (mv.lines.length === 1) {
      var it = byId("items", mv.lines[0].i);
      return it ? it.name : "?";
    }
    return t("lines", { n: mv.lines.length });
  }
  function moveTotal(mv) {
    var sum = 0, any = false;
    mv.lines.forEach(function (l) {
      var c = mv.t === "in" ? l.c : (mv.t === "out" ? l.p : undefined);
      if (typeof c === "number") { any = true; sum += Math.round(Math.abs(l.q) * c / 1000); }
    });
    return any ? sum : null;
  }
  function moveRow(mv) {
    var li = el("li");
    var b = el("button", "row row-btn k-" + mv.t + (mv.v === 1 ? " voided" : ""));
    b.type = "button";
    b.appendChild(el("span", "r-ico", T_ICON[mv.t]));
    var body = el("span", "r-body");
    body.appendChild(el("span", "r-name", moveTitle(mv)));
    var sub = el("span", "r-sub");
    sub.appendChild(el("span", "", t("t." + mv.t)));
    if (mv.ref) sub.appendChild(el("span", "", mv.ref));
    var sup = byId("sups", mv.sup);
    if (sup) sub.appendChild(el("span", "", sup.name));
    if (mv.v === 1) sub.appendChild(el("span", "badge", t("voided")));
    body.appendChild(sub);
    b.appendChild(body);
    var val;
    if (mv.lines.length === 1) {
      val = el("span", "r-val", fmtSigned(mv.lines[0].q, byId("items", mv.lines[0].i)));
    } else val = el("span", "r-val", "");
    var tot = moveTotal(mv);
    if (tot !== null) val.appendChild(el("small", "", money(tot)));
    b.appendChild(val);
    b.addEventListener("click", function () { moveSheet(mv.id); });
    li.appendChild(b);
    return li;
  }
  function moveSheet(id) {
    var mv = byId("moves", id);
    if (!mv) return;
    var dlg = makeDialog("st-move", true);
    dlg.appendChild(el("div", "dlg-title", T_ICON[mv.t] + " " + t("t." + mv.t)));
    if (mv.v === 1) dlg.appendChild(el("p", "hint warn", t("mv.voided")));
    var box = el("div", "kvs");
    kv(box, t("mv.date"), fmtDay(mv.d, true));
    kv(box, t("mv.ref"), mv.ref);
    var sup = byId("sups", mv.sup);
    if (sup) kv(box, t("mv.sup"), sup.name);
    var tot = moveTotal(mv);
    if (tot !== null) kv(box, t("mv.total"), money(tot));
    dlg.appendChild(box);
    var ul = el("ul", "rows");
    mv.lines.forEach(function (l) {
      var it = byId("items", l.i);
      var li = el("li");
      var b = el("button", "row row-btn compact" + (mv.v === 1 ? " voided" : ""));
      b.type = "button";
      var body = el("span", "r-body");
      body.appendChild(el("span", "r-name", it ? it.name : "?"));
      var s = el("span", "r-sub");
      if (it && it.sku) s.appendChild(el("span", "", it.sku));
      if (mv.t === "count") s.appendChild(el("span", "", t("mv.counted", { n: fmtQ(l.n, it) })));
      if (typeof l.c === "number") s.appendChild(el("span", "", money(l.c) + " / " + unitLabel(it ? it.unit : "pcs")));
      if (typeof l.p === "number") s.appendChild(el("span", "", money(l.p) + " / " + unitLabel(it ? it.unit : "pcs")));
      if (s.childNodes.length) body.appendChild(s);
      b.appendChild(body);
      b.appendChild(el("span", "r-val", fmtSigned(l.q, it)));
      if (it) b.addEventListener("click", function () { dlg.close(); itemSheet(it.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    if (mv.note) dlg.appendChild(el("p", "notes", mv.note));
    var acts = el("div", "dlg-actions");
    if (mv.v !== 1) acts.appendChild(button(t("mv.void"), "danger", function () {
      confirmDialog(t("mv.voidQ"), t("mv.voidYes"), true, function () { dlg.close(); voidMove(mv); });
    }));
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 6. Reorder view ----------
  function orderGroups() {
    var groups = [], by = Object.create(null);
    C.lowList(data).forEach(function (r) {
      var sid = byId("sups", r.item.sup) ? r.item.sup : "";
      if (!by[sid]) { by[sid] = { sup: byId("sups", sid), rows: [] }; groups.push(by[sid]); }
      by[sid].rows.push(r);
    });
    groups.sort(function (a, b) {
      if (!a.sup) return 1;
      if (!b.sup) return -1;
      return a.sup.name.localeCompare(b.sup.name, LOCALE);
    });
    return groups;
  }
  function renderOrder() {
    var box = $("order-list");
    box.innerHTML = "";
    var groups = orderGroups();
    if (!groups.length) { box.appendChild(el("p", "empty-line", t("order.none"))); return; }
    groups.forEach(function (g) {
      var sec = el("div", "sec");
      var h = el("div", "sec-head");
      h.appendChild(el("h2", "", g.sup ? g.sup.name : t("order.noSup")));
      sec.appendChild(h);
      if (g.sup && (g.sup.tel || g.sup.email)) sec.appendChild(el("p", "muted sec-sub", [g.sup.person, g.sup.tel, g.sup.email].filter(Boolean).join(" · ")));
      var ul = el("ul", "rows");
      g.rows.forEach(function (r) {
        var it = r.item;
        var li = el("li");
        var b = el("button", "row row-btn " + (r.out ? "lvl-out" : "lvl-low"));
        b.type = "button";
        var body = el("span", "r-body");
        body.appendChild(el("span", "r-name", it.name));
        var s = el("span", "r-sub");
        if (it.sku) s.appendChild(el("span", "", it.sku));
        if (it.ssku) s.appendChild(el("span", "", it.ssku));
        s.appendChild(el("span", "", t("order.have", { q: fmtQ(r.q, it, true), m: fmtQ(it.min, it, true) })));
        body.appendChild(s);
        b.appendChild(body);
        b.appendChild(el("span", "r-val", "+" + fmtQ(C.suggestQty(r, decOf(it)), it)));
        b.addEventListener("click", function () { itemSheet(it.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      var acts = el("div", "dlg-actions tight sec-acts");
      acts.appendChild(button(t("order.copy"), "", function () { copyOrder(g); }));
      acts.appendChild(button(t("order.receive"), "", function () {
        moveEditor("in", g.rows.map(function (r) { return { i: r.item.id, q: C.suggestQty(r, decOf(r.item)) }; }), { sup: g.sup ? g.sup.id : "" });
      }));
      sec.appendChild(acts);
      box.appendChild(sec);
    });
  }
  function orderText(g) {
    var lines = [t("order.head", { s: g.sup ? g.sup.name : t("order.noSup"), d: fmtDay(todayYmd(), true) })];
    g.rows.forEach(function (r) {
      var it = r.item, code = it.ssku || it.sku;
      lines.push("- " + fmtQ(C.suggestQty(r, decOf(it)), it) + " × " + it.name + (code ? " (" + code + ")" : ""));
    });
    return lines.join("\n");
  }
  function copyOrder(g) {
    var text = orderText(g);
    var done = function () { showToast(t("order.copied")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        return;
      }
    } catch (e) {}
    fallbackCopy(text);
    done();
  }
  function fallbackCopy(text) {
    var ta = el("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  // ---------- 7. Suppliers view ----------
  function renderSups() {
    var ul = $("sups-list");
    ul.innerHTML = "";
    var count = Object.create(null);
    data.items.forEach(function (it) { if (!it.arch && it.sup) count[it.sup] = (count[it.sup] || 0) + 1; });
    var list = byName(data.sups);
    if (!list.length) {
      ul.appendChild(el("li", "muted pad", t("sups.none")));
    }
    list.forEach(function (s) {
      var li = el("li");
      var b = el("button", "row row-btn");
      b.type = "button";
      b.appendChild(el("span", "r-ico", "🏭"));
      var body = el("span", "r-body");
      body.appendChild(el("span", "r-name", s.name));
      var sub = el("span", "r-sub");
      [s.person, s.tel, s.email].forEach(function (x) { if (x) sub.appendChild(el("span", "", x)); });
      if (sub.childNodes.length) body.appendChild(sub);
      b.appendChild(body);
      b.appendChild(el("span", "r-val", t("sups.items", { n: count[s.id] || 0 })));
      b.addEventListener("click", function () { supEditor(s); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var li2 = el("li");
    var add = el("button", "txt-btn", "+ " + t("sup.new"));
    add.type = "button";
    add.addEventListener("click", function () { supEditor(null); });
    li2.appendChild(add);
    ul.appendChild(li2);
  }

  // ---------- 8. Editors ----------
  function field(label, input, id) {
    var w = el("div", "fld");
    var l = el("label", "dlg-lbl", label);
    input.id = id;
    l.htmlFor = id;
    w.appendChild(l);
    w.appendChild(input);
    return w;
  }
  function textInput(value, max, ph) {
    var i = el("input");
    i.type = "text";
    i.value = value || "";
    i.maxLength = max;
    if (ph) i.placeholder = ph;
    i.autocomplete = "off";
    return i;
  }
  function numInput(value) {
    var i = el("input");
    i.type = "text";
    i.inputMode = "decimal";
    i.value = value;
    i.autocomplete = "off";
    return i;
  }
  function selectInput(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function textarea(value, max) {
    var ta = el("textarea");
    ta.rows = 2;
    ta.maxLength = max;
    ta.value = value || "";
    return ta;
  }
  function checkRow(label, checked) {
    var l = el("label", "check-row");
    var c = el("input");
    c.type = "checkbox";
    c.checked = !!checked;
    l.appendChild(c);
    l.appendChild(el("span", "", label));
    return l;
  }
  // A <select> of a list with a "New …" choice at the end that asks for
  // a name, creates the row and selects it.
  function listSelect(list, value, newLabel, onNew) {
    var opts = [["", t("ed.none")]].concat(byName(data[list]).map(function (x) { return [x.id, x.name]; }));
    opts.push(["+new", newLabel]);
    var s = selectInput(opts, byId(list, value) ? value : "");
    var last = s.value;
    s.addEventListener("change", function () {
      if (s.value !== "+new") { last = s.value; return; }
      s.value = last;
      onNew(function (row) {
        var op = el("option", "", row.name);
        op.value = row.id;
        s.insertBefore(op, s.lastChild);
        s.value = row.id;
        last = row.id;
        s.dispatchEvent(new Event("change"));
      });
    });
    return s;
  }
  function askName(title, max, onOk) {
    var dlg = makeDialog("st-ask");
    dlg.appendChild(el("div", "dlg-title", title));
    var inp = textInput("", max);
    dlg.appendChild(inp);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", go);
    acts.appendChild(ok);
    dlg.appendChild(acts);
    function go() {
      var v = C.cleanText(inp.value, max, false);
      if (!v) { inp.focus(); return; }
      dlg.close();
      onOk(v);
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    showDialog(dlg);
    inp.focus();
  }
  function newCat(done) {
    askName(t("cat.new"), C.NAME_LEN, function (name) {
      var ex = data.cats.filter(function (c) { return C.fold(c.name) === C.fold(name); })[0];
      if (ex) { done(ex); return; }
      var row = { id: newId(), m: Date.now(), name: name };
      data.cats.push(row);
      save();
      done(row);
    });
  }
  function newSupQuick(done) {
    askName(t("sup.new"), C.NAME_LEN, function (name) {
      var row = C.normSup({ id: newId(), m: Date.now(), name: name });
      data.sups.push(row);
      save();
      done(row);
    });
  }

  // ----- Product -----
  function unitOptions() {
    var opts = C.UNIT_IDS.map(function (u) { return [u, C.unitName(u, LANG)]; });
    byName(data.units).forEach(function (u) { opts.push([u.id, u.name]); });
    opts.push(["+new", t("ed.newUnit")]);
    return opts;
  }
  function itemEditor(it, preset) {
    var isNew = !it;
    var x = it ? JSON.parse(JSON.stringify(it)) : C.normItem(Object.assign({ id: newId(), m: 0, name: "-", vat: data.settings.vat }, preset || {}));
    if (isNew) x.name = (preset && preset.name) || "";
    var dlg = makeDialog("st-ied", true);
    dlg.appendChild(el("div", "dlg-title", isNew ? t("ed.newItem") : t("ed.editItem")));
    var name = textInput(x.name, C.NAME_LEN);
    dlg.appendChild(field(t("ed.name"), name, "st-name"));
    var r1 = el("div", "fld-row");
    var sku = textInput(x.sku, C.SKU_LEN);
    var bc = textInput(x.bc, C.BC_LEN);
    bc.inputMode = "numeric";
    r1.appendChild(field(t("ed.sku"), sku, "st-sku"));
    r1.appendChild(field(t("ed.bc"), bc, "st-bc"));
    dlg.appendChild(r1);
    var dupHint = el("p", "hint warn");
    dupHint.hidden = true;
    dlg.appendChild(dupHint);
    function checkDup() {
      var s = C.fold(sku.value), b = C.fold(bc.value).replace(/\s+/g, "");
      var dS = s && data.items.some(function (o) { return o.id !== x.id && C.fold(o.sku) === s; });
      var dB = b && data.items.some(function (o) { return o.id !== x.id && o.bc && C.fold(o.bc) === b; });
      dupHint.textContent = [dS ? t("ed.dupSku") : "", dB ? t("ed.dupBc") : ""].filter(Boolean).join(" ");
      dupHint.hidden = !(dS || dB);
    }
    sku.addEventListener("input", checkDup);
    bc.addEventListener("input", checkDup);
    // a scanner ends with Enter: keep it from submitting anything
    [sku, bc].forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); }); });

    var r2 = el("div", "fld-row");
    var cat = listSelect("cats", x.cat, t("ed.newCat"), newCat);
    var unit = selectInput(unitOptions(), x.unit);
    if (unit.value !== x.unit) unit.value = "pcs";
    var lastUnit = unit.value;
    unit.addEventListener("change", function () {
      if (unit.value !== "+new") { lastUnit = unit.value; return; }
      unit.value = lastUnit;
      unitsDialog(function (u) {
        var op = el("option", "", u.name);
        op.value = u.id;
        unit.insertBefore(op, unit.lastChild);
        unit.value = u.id;
        lastUnit = u.id;
      });
    });
    r2.appendChild(field(t("ed.cat"), cat, "st-cat"));
    r2.appendChild(field(t("ed.unit"), unit, "st-unit"));
    dlg.appendChild(r2);

    var r3 = el("div", "fld-row");
    var min = numInput(x.min ? qtyStr(x.min, x) : "");
    var rq = numInput(x.rq ? qtyStr(x.rq, x) : "");
    r3.appendChild(field(t("ed.min"), min, "st-min"));
    r3.appendChild(field(t("ed.rq"), rq, "st-rq"));
    dlg.appendChild(r3);
    dlg.appendChild(el("p", "hint", t("ed.minHint")));

    var open = null;
    if (isNew) {
      open = numInput(preset && preset.open ? qtyStr(preset.open, x) : "");
      dlg.appendChild(field(t("ed.open"), open, "st-open"));
      dlg.appendChild(el("p", "hint", t("ed.openHint")));
    }

    var r4 = el("div", "fld-row three");
    var cost = numInput(centsStr(x.cost));
    var price = numInput(centsStr(x.price));
    var vatOpts = C.VAT_RATES.map(function (v) { return [String(v), v + "%"]; });
    if (C.VAT_RATES.indexOf(x.vat) < 0) vatOpts.push([String(x.vat), x.vat + "%"]);
    var vat = selectInput(vatOpts, String(x.vat));
    r4.appendChild(field(t("ed.cost", { c: curSym() }), cost, "st-cost"));
    r4.appendChild(field(t("ed.price", { c: curSym() }), price, "st-price"));
    r4.appendChild(field(t("ed.vat"), vat, "st-vat"));
    dlg.appendChild(r4);

    var r5 = el("div", "fld-row");
    var sup = listSelect("sups", x.sup, t("ed.newSup"), newSupQuick);
    var ssku = textInput(x.ssku, C.SKU_LEN);
    r5.appendChild(field(t("ed.sup"), sup, "st-sup"));
    r5.appendChild(field(t("ed.ssku"), ssku, "st-ssku"));
    dlg.appendChild(r5);
    var loc = textInput(x.loc, C.LOC_LEN, t("ed.locPh"));
    dlg.appendChild(field(t("ed.loc"), loc, "st-loc"));
    var note = textarea(x.note, C.NOTE_LEN);
    dlg.appendChild(field(t("ed.note"), note, "st-note"));
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", function () {
      var nm = C.cleanText(name.value, C.NAME_LEN, false);
      if (!nm) { err.textContent = t("ed.needName"); err.hidden = false; name.focus(); return; }
      var probe = { unit: unit.value };
      var vMin = min.value.trim() ? readQty(min, probe) : 0;
      var vRq = rq.value.trim() ? readQty(rq, probe) : 0;
      var vOpen = open && open.value.trim() ? readQty(open, probe) : 0;
      var vCost = readCents(cost), vPrice = readCents(price);
      if (vMin === null || vRq === null || vOpen === null || vCost === null || vPrice === null) {
        err.textContent = t("ed.badNum"); err.hidden = false; return;
      }
      var row = C.normItem({
        id: x.id, m: x.m || 0, name: nm, sku: sku.value, bc: bc.value, cat: cat.value, unit: unit.value,
        min: vMin, rq: vRq, sup: sup.value, ssku: ssku.value, cost: vCost, price: vPrice,
        vat: Number(vat.value), loc: loc.value, note: note.value, arch: x.arch
      });
      if (!row) { err.textContent = t("ed.badNum"); err.hidden = false; return; }
      var res = upsert("items", row);
      if (isNew && vOpen > 0) {
        addMove({ id: newId(), d: todayYmd(), t: "count", ref: "", sup: "", note: t("open.ref"), lines: [{ i: row.id, q: vOpen, n: vOpen }] });
      }
      if (res || (isNew && vOpen > 0)) save();
      dlg.close();
      render();
      if (res) showToast(res === "added" ? t("toast.added") : t("toast.saved"));
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    checkDup();
    if (isNew) name.focus();
  }

  // ----- Movement -----
  // type: one of C.MOVE_TYPES; preset lines: [{ i, q? }] ; opts: { sup }
  function moveEditor(type, presetLines, opts) {
    var o = opts || {};
    var dlg = makeDialog("st-med", true);
    dlg.classList.add("move-dlg");
    dlg.appendChild(el("div", "dlg-title", t("mv.new")));
    var r1 = el("div", "fld-row");
    var tsel = selectInput(C.MOVE_TYPES.map(function (k) { return [k, T_ICON[k] + " " + t("t." + k)]; }), type || "in");
    var date = el("input");
    date.type = "date";
    date.value = todayYmd();
    date.max = C.addDays(todayYmd(), 1);
    r1.appendChild(field(t("mv.type"), tsel, "st-mtype"));
    r1.appendChild(field(t("mv.date"), date, "st-mdate"));
    dlg.appendChild(r1);
    var r2 = el("div", "fld-row");
    var ref = textInput("", C.REF_LEN, t("mv.refPh"));
    var supSel = listSelect("sups", o.sup || "", t("ed.newSup"), newSupQuick);
    var supFld = field(t("mv.sup"), supSel, "st-msup");
    r2.appendChild(field(t("mv.ref"), ref, "st-mref"));
    r2.appendChild(supFld);
    dlg.appendChild(r2);

    // the lines
    var lines = [];          // { i, qIn, cIn, row }
    var lineBox = el("ul", "lines");
    dlg.appendChild(el("div", "dlg-lbl", t("mv.add")));
    var finder = el("input");
    finder.type = "search";
    finder.placeholder = t("mv.addPh");
    finder.autocomplete = "off";
    finder.spellcheck = false;
    finder.setAttribute("enterkeyhint", "done");
    finder.setAttribute("aria-label", t("mv.add"));
    dlg.appendChild(finder);
    var hits = el("div", "hits");
    dlg.appendChild(hits);
    dlg.appendChild(lineBox);
    var totalP = el("p", "total");
    dlg.appendChild(totalP);
    var note = textarea("", C.MNOTE_LEN);
    dlg.appendChild(field(t("mv.note"), note, "st-mnote"));
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);

    function cur() { return tsel.value; }
    function qLabel() {
      var k = cur();
      return k === "count" ? t("mv.countN") : (k === "fix" ? t("mv.fixQ") : t("mv.qty"));
    }
    function addLine(itemId, q, focusQty) {
      var it = byId("items", itemId);
      if (!it) return;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].i === itemId) {
          // a second scan of the same product adds one more
          var step = Math.pow(10, 3 - decOf(it));
          var now = readQty(lines[i].qIn, it, cur() === "fix");
          var next = (now === null ? 0 : now) + (q || step);
          lines[i].qIn.value = qtyStr(next, it);
          refresh();
          live(t("mv.lineMore", { n: it.name, q: lines[i].qIn.value }));
          return;
        }
      }
      var ln = { i: itemId };
      var li = el("li", "line");
      var head = el("div", "line-head");
      var nm = el("div", "line-name");
      nm.appendChild(el("span", "r-name", it.name));
      nm.appendChild(el("span", "muted line-sub"));
      head.appendChild(nm);
      var rm = el("button", "icon-btn mini");
      rm.type = "button";
      rm.innerHTML = UI.x;
      rm.setAttribute("aria-label", t("mv.remove"));
      rm.title = t("mv.remove");
      rm.addEventListener("click", function () {
        lines = lines.filter(function (l) { return l !== ln; });
        li.remove();
        refresh();
      });
      head.appendChild(rm);
      li.appendChild(head);
      var row = el("div", "fld-row");
      var qIn = numInput(q ? qtyStr(Math.abs(q), it) : "");
      var qf = field(qLabel(), qIn, "st-q-" + itemId);
      var cIn = numInput("");
      var cf = field(t("mv.cost"), cIn, "st-c-" + itemId);
      row.appendChild(qf);
      row.appendChild(cf);
      li.appendChild(row);
      ln.qIn = qIn; ln.cIn = cIn; ln.qf = qf; ln.cf = cf; ln.li = li; ln.it = it;
      ln.sub = nm.lastChild;
      qIn.addEventListener("input", refresh);
      cIn.addEventListener("input", refresh);
      qIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); finder.focus(); } });
      cIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); finder.focus(); } });
      lines.push(ln);
      lineBox.appendChild(li);
      setLineMode(ln);
      refresh();
      if (focusQty) qIn.focus();
      live(t("mv.lineAdded", { n: it.name }));
    }
    // what the price field means for this type, and its default
    function setLineMode(ln) {
      var k = cur(), it = ln.it, r = rowOf(it.id) || { avg: 0 };
      ln.qf.querySelector("label").textContent = qLabel();
      if (k === "in") {
        ln.cf.hidden = false;
        ln.cf.querySelector("label").textContent = t("mv.cost") + " (" + curSym() + ")";
        if (ln.cMode !== "in") ln.cIn.value = centsStr(it.cost || Math.round(r.avg));
      } else if (k === "out") {
        ln.cf.hidden = false;
        ln.cf.querySelector("label").textContent = t("mv.price") + " (" + curSym() + ")";
        if (ln.cMode !== "out") ln.cIn.value = centsStr(it.price);
      } else ln.cf.hidden = true;
      ln.cMode = k;
    }
    function refresh() {
      var k = cur(), total = 0, any = false;
      supFld.hidden = !(k === "in" || k === "rts");
      lines.forEach(function (ln) {
        var it = ln.it, r = rowOf(it.id) || { q: 0 };
        var parts = [it.sku, t("mv.now", { q: fmtQ(r.q, it) })].filter(Boolean);
        if (k === "count") {
          var n = readQty(ln.qIn, it);
          if (n !== null && ln.qIn.value.trim()) parts.push(t("mv.diff", { d: fmtSigned(n - r.q, it) }));
        }
        ln.sub.textContent = parts.join(" · ");
        if ((k === "in" || k === "out") && !ln.cf.hidden) {
          var q = readQty(ln.qIn, it), c = readCents(ln.cIn);
          if (q && c) { total += Math.round(q * c / 1000); any = true; }
        }
      });
      totalP.textContent = any ? t("mv.total") + ": " + money(total) : "";
      totalP.hidden = !any;
    }
    tsel.addEventListener("change", function () { lines.forEach(setLineMode); refresh(); });

    function findHits(q) {
      var words = C.fold(q).split(" ").filter(Boolean);
      if (!words.length) return [];
      return byName(data.items.filter(function (it) { return !it.arch && matchItem(it, words); })).slice(0, 8);
    }
    function showHits() {
      hits.innerHTML = "";
      var q = finder.value.trim();
      if (!q) return;
      var list = findHits(q);
      if (!list.length) { hits.appendChild(el("p", "muted", t("mv.noMatch"))); return; }
      list.forEach(function (it) {
        var b = el("button", "hit");
        b.type = "button";
        b.appendChild(el("span", "", it.name));
        if (it.sku) b.appendChild(el("span", "muted", it.sku));
        b.addEventListener("click", function () {
          finder.value = "";
          hits.innerHTML = "";
          addLine(it.id, 0, true);
        });
        hits.appendChild(b);
      });
    }
    finder.addEventListener("input", showHits);
    finder.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var q = finder.value.trim();
      if (!q) return;
      var it = C.findByCode(data, q);
      if (!it) {
        var list = findHits(q);
        if (list.length === 1) it = list[0];
      }
      if (it) {
        finder.value = "";
        hits.innerHTML = "";
        addLine(it.id, Math.pow(10, 3 - decOf(it)), false);   // scanner flow: one unit per scan, stay in the finder
        finder.focus();
      } else showHits();
    });

    (presetLines || []).forEach(function (p) { addLine(p.i, p.q || 0, false); });
    refresh();

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", function () { trySave(false); }));
    dlg.appendChild(acts);

    function fail(msg) { err.textContent = msg; err.hidden = false; }
    function trySave(forceNeg) {
      err.hidden = true;
      var k = cur(), sign = C.SIGN[k];
      if (!C.isYmd(date.value)) { fail(t("ed.badNum")); return; }
      if (!lines.length) { fail(t("mv.noLines")); finder.focus(); return; }
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i], it = ln.it, r = rowOf(it.id) || { q: 0 };
        var v = readQty(ln.qIn, it, k === "fix");
        if (v === null || !ln.qIn.value.trim()) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
        var line = { i: it.id };
        if (k === "count") { line.q = v - r.q; line.n = v; }
        else if (k === "fix") {
          if (v === 0) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
          line.q = v;
        } else {
          if (v === 0) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
          line.q = sign * Math.abs(v);
        }
        if (k === "in" || k === "out") {
          var c = ln.cIn.value.trim() ? readCents(ln.cIn) : null;
          if (ln.cIn.value.trim() && c === null) { fail(t("ed.badNum")); ln.cIn.focus(); return; }
          if (c !== null) line[k === "in" ? "c" : "p"] = c;
        }
        out.push(line);
      }
      // below zero? (sums lines of one product too)
      if (!forceNeg) {
        var after = Object.create(null);
        out.forEach(function (l) { after[l.i] = (after[l.i] === undefined ? (rowOf(l.i) || { q: 0 }).q : after[l.i]) + l.q; });
        var neg = Object.keys(after).filter(function (id) { return after[id] < 0 && after[id] < (rowOf(id) || { q: 0 }).q; })[0];
        if (neg) {
          var nit = byId("items", neg);
          if (data.settings.neg === 0) { fail(t("mv.neg", { n: nit.name, q: fmtQ(after[neg], nit) }) + " " + t("mv.negBlocked")); return; }
          confirmDialog(t("mv.negQ", { n: nit.name, q: fmtQ(after[neg], nit) }), t("mv.negSave"), false, function () { trySave(true); });
          return;
        }
      }
      var mv = C.normMove({
        id: newId(), m: Date.now(), d: date.value, t: k, ref: ref.value,
        sup: supSel.value, note: note.value, lines: out
      });
      if (!mv) { fail(t("ed.badNum")); return; }
      addMove(mv);
      dlg.close();
      render();
      actionToast(t("toast.saved"), null, null, function () { voidMove(mv); });
    }
    showDialog(dlg);
    if (!lines.length) finder.focus();
    else if (lines.length === 1 && !lines[0].qIn.value) lines[0].qIn.focus();
    else finder.focus();
  }

  // ----- Supplier -----
  function readOther(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  // Contacts (oros-contacts-data), read-only: live people with a name or
  // company. Only copied into the form; nothing is written back.
  function contactChoices() {
    var ct = readOther("oros-contacts-data");
    if (!ct || typeof ct !== "object" || !Array.isArray(ct.contacts)) return [];
    var gone = {};
    (Array.isArray(ct.deleted) ? ct.deleted : []).forEach(function (d) {
      if (d && typeof d.id === "string" && typeof d.mtime === "number") gone[d.id] = Math.max(gone[d.id] || 0, d.mtime);
    });
    function s(v) { return typeof v === "string" ? v : ""; }
    function first(list) {
      if (!Array.isArray(list)) return "";
      for (var i = 0; i < list.length; i++) {
        var v = list[i] && typeof list[i] === "object" ? s(list[i].v) : s(list[i]);
        if (v.trim()) return v;
      }
      return "";
    }
    var out = [];
    ct.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.del) return;
      if (c.id in gone && gone[c.id] >= (typeof c.mtime === "number" ? c.mtime : 0)) return;
      var person = C.cleanText([s(c.given), s(c.middle), s(c.family)].join(" "), C.PERSON_LEN, false) || C.cleanText(s(c.nickname), C.PERSON_LEN, false);
      var org = C.cleanText(s(c.org), C.NAME_LEN, false);
      if (!person && !org) return;
      out.push({ name: org || person, person: org ? person : "", tel: C.cleanText(first(c.phones), C.TEL_LEN, false), email: C.cleanText(first(c.emails), C.EMAIL_LEN, false) });
    });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE); }).slice(0, 3000);
  }
  function pickContact(onPick) {
    var list = contactChoices();
    var dlg = makeDialog("st-ct");
    dlg.appendChild(el("div", "dlg-title", t("sup.pick")));
    if (!list.length) dlg.appendChild(el("p", "muted", t("sup.noContacts")));
    else {
      var q = el("input");
      q.type = "search";
      q.setAttribute("aria-label", t("sup.pick"));
      dlg.appendChild(q);
      var box = el("div", "sheet-list pick-list");
      dlg.appendChild(box);
      var draw = function () {
        box.innerHTML = "";
        var w = C.fold(q.value).split(" ").filter(Boolean);
        list.filter(function (c) {
          var h = C.fold(c.name + " " + c.person);
          return w.every(function (x) { return h.indexOf(x) >= 0; });
        }).slice(0, 80).forEach(function (c) {
          var b = button(c.name + (c.person ? " · " + c.person : ""), "sheet-btn", function () { dlg.close(); onPick(c); });
          box.appendChild(b);
        });
      };
      q.addEventListener("input", draw);
      draw();
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function supEditor(s) {
    var isNew = !s;
    var x = s ? JSON.parse(JSON.stringify(s)) : { id: newId(), m: 0, name: "", person: "", tel: "", email: "", vatno: "", lead: 0, note: "" };
    var dlg = makeDialog("st-sed", true);
    dlg.appendChild(el("div", "dlg-title", isNew ? t("sup.new") : t("sup.edit")));
    var name = textInput(x.name, C.NAME_LEN);
    var person = textInput(x.person, C.PERSON_LEN);
    var tel = textInput(x.tel, C.TEL_LEN);
    tel.type = "tel";
    var email = textInput(x.email, C.EMAIL_LEN);
    email.type = "email";
    var vatno = textInput(x.vatno, C.VATNO_LEN);
    var lead = numInput(x.lead ? String(x.lead) : "");
    lead.inputMode = "numeric";
    var note = textarea(x.note, C.NOTE_LEN);
    if (isNew) {
      var ctb = button(t("sup.contacts"), "", function () {
        pickContact(function (c) {
          name.value = c.name;
          if (c.person) person.value = c.person;
          if (c.tel) tel.value = c.tel;
          if (c.email) email.value = c.email;
        });
      });
      var wrap = el("div", "dlg-actions tight");
      wrap.appendChild(ctb);
      dlg.appendChild(wrap);
    }
    dlg.appendChild(field(t("sup.name"), name, "st-sname"));
    dlg.appendChild(field(t("sup.person"), person, "st-sperson"));
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("sup.tel"), tel, "st-stel"));
    r1.appendChild(field(t("sup.email"), email, "st-semail"));
    dlg.appendChild(r1);
    var r2 = el("div", "fld-row");
    r2.appendChild(field(t("sup.vatno"), vatno, "st-svat"));
    r2.appendChild(field(t("sup.lead"), lead, "st-slead"));
    dlg.appendChild(r2);
    dlg.appendChild(field(t("sup.note"), note, "st-snote"));
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (!isNew) acts.appendChild(button(t("ed.delete"), "danger", function () {
      confirmDialog(t("sup.delQ"), t("ed.delete"), true, function () { dlg.close(); removeRow("sups", byId("sups", x.id) || x); });
    }));
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", function () {
      var ld = lead.value.trim() ? C.parseNum(lead.value.trim(), LANG) : 0;
      if (ld === null || ld < 0 || ld > 365) { err.textContent = t("ed.badNum"); err.hidden = false; return; }
      var row = C.normSup({ id: x.id, m: x.m || 0, name: name.value, person: person.value, tel: tel.value,
        email: email.value, vatno: vatno.value, lead: Math.round(ld), note: note.value });
      if (!row) { err.textContent = t("ed.needName"); err.hidden = false; name.focus(); return; }
      var res = upsert("sups", row);
      if (res) save();
      dlg.close();
      render();
      if (res) showToast(res === "added" ? t("toast.added") : t("toast.saved"));
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    if (isNew) name.focus();
  }

  // ----- Categories -----
  function catsDialog() {
    var dlg = makeDialog("st-cats");
    dlg.appendChild(el("div", "dlg-title", t("cat.title")));
    var ul = el("ul", "vlist");
    dlg.appendChild(ul);
    function draw() {
      ul.innerHTML = "";
      byName(data.cats).forEach(function (c) {
        var li = el("li", "row");
        li.appendChild(el("span", "r-body r-name", c.name));
        var ren = el("button", "link-btn", t("sheet.edit"));
        ren.type = "button";
        ren.addEventListener("click", function () {
          askName(t("cat.name"), C.NAME_LEN, function (v) {
            var cur = byId("cats", c.id);
            if (cur && cur.name !== v) { cur.name = v; stamp(cur); save(); render(); }
            draw();
          });
        });
        var del = el("button", "link-btn danger", t("ed.delete"));
        del.type = "button";
        del.addEventListener("click", function () {
          confirmDialog(t("cat.delQ", { n: c.name }), t("ed.delete"), true, function () {
            data.tombs[c.id] = Math.max(Date.now(), c.m);
            data.cats = data.cats.filter(function (x) { return x.id !== c.id; });
            save();
            render();
            draw();
          });
        });
        li.appendChild(ren);
        li.appendChild(del);
        ul.appendChild(li);
      });
    }
    draw();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cat.new"), "", function () { newCat(function () { render(); draw(); }); }));
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ----- Units -----
  function unitsDialog(onNew) {
    var dlg = makeDialog("st-units");
    dlg.appendChild(el("div", "dlg-title", t("unit.title")));
    if (!onNew) {
      dlg.appendChild(el("div", "dlg-lbl", t("unit.ready")));
      dlg.appendChild(el("p", "muted", C.UNIT_IDS.map(function (u) { return C.unitName(u, LANG); }).join(" · ")));
      dlg.appendChild(el("div", "dlg-lbl", t("unit.own")));
      var ul = el("ul", "vlist");
      dlg.appendChild(ul);
      var draw = function () {
        ul.innerHTML = "";
        var list = byName(data.units);
        if (!list.length) ul.appendChild(el("li", "muted", t("unit.none")));
        list.forEach(function (u) {
          var li = el("li", "row");
          li.appendChild(el("span", "r-body r-name", u.name + " (" + u.dec + ")"));
          var del = el("button", "link-btn danger", t("ed.delete"));
          del.type = "button";
          del.addEventListener("click", function () {
            if (data.items.some(function (it) { return it.unit === u.id; })) { showToast(t("unit.inUse")); return; }
            data.tombs[u.id] = Math.max(Date.now(), u.m);
            data.units = data.units.filter(function (x) { return x.id !== u.id; });
            save();
            draw();
          });
          li.appendChild(del);
          ul.appendChild(li);
        });
      };
      draw();
    }
    dlg.appendChild(el("div", "dlg-lbl", t("unit.new")));
    var r = el("div", "fld-row");
    var nm = textInput("", C.UNIT_LEN);
    var dec = selectInput([["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"]], "0");
    r.appendChild(field(t("unit.name"), nm, "st-uname"));
    r.appendChild(field(t("unit.dec"), dec, "st-udec"));
    dlg.appendChild(r);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", function () {
      var row = C.normUnit({ id: newId(), m: Date.now(), name: nm.value, dec: Number(dec.value) });
      if (!row) { nm.focus(); return; }
      data.units.push(row);
      save();
      dlg.close();
      if (onNew) onNew(row);
      else { render(); unitsDialog(null); }
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    nm.focus();
  }

  function addMenu() {
    var dlg = makeDialog("st-add");
    dlg.appendChild(el("div", "dlg-title", t("add.title")));
    var box = el("div", "sheet-list");
    [["📦", t("add.item"), function () { itemEditor(null); }],
     ["📥", t("add.in"), function () { moveEditor("in", []); }],
     ["📤", t("add.out"), function () { moveEditor("out", []); }],
     ["📋", t("add.count"), function () { moveEditor("count", []); }],
     ["✏️", t("add.other"), function () { moveEditor("loss", []); }],
     ["🏭", t("add.sup"), function () { supEditor(null); }]].forEach(function (a) {
      var b = button(a[0] + "  " + a[1], "sheet-btn", function () { dlg.close(); a[2](); });
      box.appendChild(b);
    });
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 9. Settings, CSV / JSON ----------
  function settings() {
    var dlg = makeDialog("st-set");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    var r1 = el("div", "fld-row");
    var cur = selectInput(C.CURRENCIES.map(function (c) { return [c, c]; }), data.settings.cur);
    var vat = selectInput(C.VAT_RATES.map(function (v) { return [String(v), v + "%"]; }), String(data.settings.vat));
    function setS(k, v) {
      if (data.settings[k] === v) return;
      var s = JSON.parse(JSON.stringify(data.settings));
      s[k] = v;
      s.m = Math.max(Date.now(), data.settings.m + 1);
      data.settings = s;
      save();
      render();
    }
    cur.addEventListener("change", function () { setS("cur", cur.value); });
    vat.addEventListener("change", function () { setS("vat", Number(vat.value)); });
    r1.appendChild(field(t("set.cur"), cur, "st-set-cur"));
    r1.appendChild(field(t("set.vat"), vat, "st-set-vat"));
    dlg.appendChild(r1);
    var neg = checkRow(t("set.neg"), data.settings.neg !== 0);
    neg.querySelector("input").addEventListener("change", function (e) { setS("neg", e.target.checked ? 1 : 0); });
    dlg.appendChild(neg);
    dlg.appendChild(el("p", "hint", t("set.negHint")));
    var nt = checkRow(t("set.notify"), prefs.notify);
    nt.querySelector("input").addEventListener("change", function (e) { prefs.notify = e.target.checked; savePrefsNow(); });
    dlg.appendChild(nt);
    dlg.appendChild(el("div", "dlg-lbl", t("set.lists")));
    var la = el("div", "dlg-actions tight");
    la.appendChild(button(t("set.cats"), "", function () { dlg.close(); catsDialog(); }));
    la.appendChild(button(t("set.units"), "", function () { dlg.close(); unitsDialog(null); }));
    dlg.appendChild(la);
    dlg.appendChild(el("div", "dlg-lbl", t("set.data")));
    var io = el("div", "dlg-actions tight wrap");
    io.appendChild(button(t("set.impCsv"), "", function () { dlg.close(); importCsv(); }));
    io.appendChild(button(t("set.expCsv"), "", exportProducts));
    io.appendChild(button(t("set.expMoves"), "", exportMoves));
    io.appendChild(button(t("set.json"), "", exportData));
    io.appendChild(button(t("set.import"), "", importData));
    dlg.appendChild(io);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
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
  function pickFile(accept) {
    var host = dialogHost();
    return Promise.resolve(host && typeof host.openFile === "function" ? host.openFile(accept) : localPickFile(accept));
  }
  function saveText(text, filename, mime, desc, ext) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      var types = [{ description: desc, accept: {} }];
      types[0].accept[mime] = [ext];
      host.saveFile({ text: text, filename: filename, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    showToast(t("toast.exported"));
  }
  function csvText(head, rows) {
    var sep = LANG === "el" ? ";" : ",";
    var lines = [head.map(C.csvCell).join(sep)];
    rows.forEach(function (r) {
      lines.push(r.map(function (v) {
        if (typeof v === "number" && LANG === "el") return String(v).replace(".", ",");
        return C.csvCell(v);
      }).join(sep));
    });
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  }
  function unitNames() {
    var n = {};
    C.UNIT_IDS.forEach(function (u) { n[u] = C.unitName(u, LANG); });
    return n;
  }
  function exportProducts() {
    var cur = data.settings.cur;
    var head = LANG === "el"
      ? ["SKU", "Όνομα", "Barcode", "Κατηγορία", "Μονάδα", "Ποσότητα", "Ελάχιστο", "Ποσότητα παραγγελίας", "Προμηθευτής", "Κωδικός προμηθευτή", "Κόστος (" + cur + ")", "Τιμή (" + cur + ")", "ΦΠΑ %", "Θέση", "Αξία (" + cur + ")", "Σημείωση"]
      : ["SKU", "Name", "Barcode", "Category", "Unit", "Quantity", "Min", "Reorder qty", "Supplier", "Supplier code", "Cost (" + cur + ")", "Price (" + cur + ")", "VAT %", "Location", "Value (" + cur + ")", "Note"];
    saveText(csvText(head, C.csvProducts(data, unitNames())), "orOS-stock-" + todayYmd() + ".csv", "text/csv", "CSV", ".csv");
  }
  function exportMoves() {
    var cur = data.settings.cur, names = { voided: t("voided") };
    C.MOVE_TYPES.forEach(function (k) { names[k] = t("t." + k); });
    var head = LANG === "el"
      ? ["Ημερομηνία", "Είδος", "Παραστατικό", "Προμηθευτής", "SKU", "Προϊόν", "Ποσότητα", "Τιμή μονάδας (" + cur + ")", "Σημείωση", "Ακυρωμένη"]
      : ["Date", "Type", "Ref", "Supplier", "SKU", "Product", "Quantity", "Unit price (" + cur + ")", "Note", "Voided"];
    saveText(csvText(head, C.csvMoves(data, names)), "orOS-stock-movements-" + todayYmd() + ".csv", "text/csv", "CSV", ".csv");
  }
  function exportData() {
    var payload = { app: "oros-stock", ver: C.DATA_VER, exported: new Date().toISOString(), data: canonical(data) };
    saveText(JSON.stringify(payload, null, 2), "orOS-stock-" + todayYmd() + ".json", "application/json", "JSON", ".json");
  }
  // A restore is a merge, never an overwrite (App-level import rule).
  function importData() {
    pickFile(".json,application/json").then(function (file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
      return file.text().then(function (txt) {
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) {}
        var incoming = parsed && parsed.app === "oros-stock" ? parsed.data : parsed;
        if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) { showToast(t("toast.badFile")); return; }
        var clean = C.merge(incoming, null);
        data = C.merge(data, clean);
        save();
        render();
        showToast(t("toast.imported", { n: clean.items.length }));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }
  function importCsv() {
    pickFile(".csv,.tsv,.txt,text/csv,text/plain").then(function (file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
      return file.text().then(function (txt) { importCsvDialog(txt); });
    }).catch(function () { showToast(t("toast.badFile")); });
  }
  function importCsvDialog(text) {
    var opts = { lang: LANG, newId: newId, now: Date.now(), today: todayYmd(), setQty: false };
    var plan = C.importPlan(data, text, opts);
    if (!plan.ok) { showToast(t("imp.bad")); return; }
    var probe = C.importPlan(data, text, Object.assign({}, opts, { setQty: true }));
    var dlg = makeDialog("st-imp");
    dlg.appendChild(el("div", "dlg-title", t("imp.title")));
    var st = el("p", "confirm-msg");
    dlg.appendChild(st);
    var qrow = null, qn = el("p", "hint");
    if (probe.stats.qty > 0) {
      qrow = checkRow(t("imp.setQty"), false);
      dlg.appendChild(qrow);
      qn.textContent = t("imp.qtyN", { n: probe.stats.qty });
      dlg.appendChild(qn);
    }
    function draw() {
      var s = plan.stats;
      st.textContent = t("imp.stats", { a: s.added, u: s.updated, s: s.same, k: s.skipped });
    }
    draw();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("imp.go"), "primary", function () {
      var use = qrow && qrow.querySelector("input").checked ? probe : plan;
      if (use.move) use.move.ref = t("csv.ref");
      applyPlan(use);
      dlg.close();
      render();
      showToast(t("imp.done", { a: use.stats.added, u: use.stats.updated }));
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function applyPlan(p) {
    var now = Date.now();
    ["cats", "sups", "units"].forEach(function (k) {
      p[k].forEach(function (row) { row.m = now; data[k].push(row); });
    });
    p.items.forEach(function (row) {
      var cur = byId("items", row.id);
      if (cur) { Object.keys(row).forEach(function (k) { cur[k] = row[k]; }); stamp(cur); }
      else { row.m = now; data.items.push(row); }
    });
    if (p.move) { p.move.m = now; data.moves.push(p.move); }
    save();
  }

  // ---------- 10. Dialogs + toasts ----------
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
    var dlg = makeDialog("st-confirm");
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
          n.transient({ ns: "stock", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo / action toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, [[t("toast.undo"), onUndo]]); }
  function actionToast(text, label, fn, onUndo) {
    var acts = [];
    if (label) acts.push([label, fn]);
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

  // ---------- 11. Keyboard (Contract B) + deep link ----------
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

  // Generic deep link (shell __orosOpenAt / __orosTakeTarget):
  //   { item: id }  → that product's sheet (universal search)
  //   { sup: id }   → that supplier (universal search)
  //   { view: "reorder" } → the Reorder tab (low-stock notice)
  // Unknown targets are ignored; an open dialog (unsaved edits) wins.
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (document.querySelector("dialog[open]")) return;
    if (target.view === "reorder") { setTab("order"); return; }
    if (typeof target.item === "string" && byId("items", target.item)) {
      var it = byId("items", target.item);
      if (it.arch && prefs.f !== "arch") prefs.f = "arch";
      else if (!it.arch && prefs.f === "arch") prefs.f = "all";
      setTab("items");
      itemSheet(target.item);
      return;
    }
    if (typeof target.sup === "string" && byId("sups", target.sup)) {
      setTab("sups");
      supEditor(byId("sups", target.sup));
    }
  }
  window.__orosOpenAt = openTarget;
  function takeStaged() {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var tg = window.parent.__orosTakeTarget("stock");
        if (tg) openTarget(tg);
      }
    } catch (e) {}
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
      new MutationObserver(function () { inheritPalette(); }).observe(
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
    api.registerSlice("stock", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }

  function sliceGet() { return canonical(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = canonical(incoming);
      stats = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    // an open editor keeps its own state; lists behind it redraw
    render();
  }

  // ---------- 13. Wiring & boot ----------
  function setTab(tab) {
    prefs.tab = TABS.indexOf(tab) >= 0 ? tab : "items";
    savePrefs();
    render();
  }

  var renderedDay = null;
  function renderEmpty() {
    var box = $("empty");
    box.innerHTML = "";
    box.appendChild(el("div", "empty-ico", "📦"));
    box.appendChild(el("h2", "empty-title", t("empty.title")));
    box.appendChild(el("p", "", t("empty.body")));
    var acts = el("div", "empty-acts");
    var a = el("button", "txt-btn primary", t("empty.add"));
    a.type = "button";
    a.addEventListener("click", function () { itemEditor(null); });
    var b = el("button", "txt-btn", t("empty.import"));
    b.type = "button";
    b.addEventListener("click", importCsv);
    acts.appendChild(a);
    acts.appendChild(b);
    box.appendChild(acts);
  }
  function render() {
    renderedDay = todayYmd();
    var has = data.items.length > 0 || data.sups.length > 0;
    var showEmpty = !has && prefs.tab === "items";
    $("empty").hidden = !showEmpty;
    TABS.forEach(function (v) {
      var on = !showEmpty && v === prefs.tab;
      $("view-" + v).hidden = !on;
      var b = $("tab-" + v);
      b.classList.toggle("on", v === prefs.tab);
      b.setAttribute("aria-selected", v === prefs.tab ? "true" : "false");
      b.tabIndex = v === prefs.tab ? 0 : -1;
    });
    var low = 0;
    rows().list.forEach(function (r) { if (!r.item.arch && r.low) low++; });
    var ob = $("tab-order");
    ob.textContent = t("tab.order") + (low ? " · " + low : "");
    if (showEmpty) { renderEmpty(); return; }
    if (prefs.tab === "items") renderItems();
    else if (prefs.tab === "moves") renderMoves();
    else if (prefs.tab === "order") renderOrder();
    else renderSups();
  }

  function applyI18n() {
    TABS.forEach(function (v) { $("tab-" + v).textContent = t("tab." + v); });
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    var ab = $("add-btn");
    ab.innerHTML = UI.plus + "<span></span>";
    ab.lastChild.textContent = t("btn.add");
    ab.setAttribute("aria-label", t("btn.addAria"));
    ab.title = t("btn.addAria");
    var q = $("items-q");
    q.placeholder = t("q.ph");
    q.setAttribute("aria-label", t("q.ph"));
    $("items-cat").setAttribute("aria-label", t("ed.cat"));
    $("items-sort").setAttribute("aria-label", t("sort.name"));
    $("moves-range").setAttribute("aria-label", t("r.all"));
    document.title = t("app") + " · orOS";
  }

  function wire() {
    TABS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { setTab(v); }); });
    $("toolbar").querySelector(".tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var i = TABS.indexOf(prefs.tab) + (e.key === "ArrowRight" ? 1 : -1);
      setTab(TABS[(i + TABS.length) % TABS.length]);
      $("tab-" + prefs.tab).focus();
    });
    $("add-btn").addEventListener("click", addMenu);
    $("settings-btn").addEventListener("click", settings);
    var qTimer = null;
    $("items-q").addEventListener("input", function () {
      clearTimeout(qTimer);
      qTimer = setTimeout(renderItems, 120);
    });
    $("items-q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(qTimer); renderItems(); onSearchEnter(); }
    });
    $("items-cat").addEventListener("change", function () { prefs.cat = $("items-cat").value; savePrefs(); render(); });
    $("items-sort").addEventListener("change", function () { prefs.sort = $("items-sort").value; savePrefs(); render(); });
    $("moves-range").addEventListener("change", function () { prefs.range = $("moves-range").value; savePrefs(); render(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
      else if (renderedDay !== todayYmd()) render();
    });
    window.addEventListener("pagehide", savePrefsNow);
    wireKeyboard();
  }

  function boot() {
    if (!C) { document.body.textContent = "Stock: core.js missing"; return; }
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeStaged();
  }

  boot();
})();
