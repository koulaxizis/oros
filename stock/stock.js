// ============================================================
// orOS Stock — App logic (v1.3.0)
// Business inventory (not the home Storage app):
//   - products with SKU, barcode, category, unit, minimum, reorder
//     quantity, supplier, purchase / sale price, VAT, location, photo
//   - a ledger of movements: receive, sell, customer return, return
//     to supplier, loss, stock count, correction; several lines per
//     movement, a reference (invoice / receipt no.), void instead of
//     delete
//   - the quantity on hand is the SUM of the movements (core.js),
//     never a stored number: two devices selling at once never lose
//     a sale through sync
//   - Reorder: items at or below their minimum, by supplier, with a
//     suggested quantity; purchase orders received in parts (1.1)
//   - Reports: value, period totals, best sellers, dead stock (1.1)
//   - counter (quick sale), barcode labels on A4 (1.2)
//   - suppliers (also from Contacts), categories, own units
//   - a USB / Bluetooth barcode scanner works as a keyboard in every
//     search and line field (code + Enter); the phone camera too
//     where the browser has BarcodeDetector (1.3)
//   - CSV import of products (own export, WooCommerce export, any
//     sheet with known column names), CSV export of products and
//     movements, JSON export / import (a merge)
//   - bridges (all prefills): To-Do, Mail, Budget, Quote, Spreadsheet,
//     Today (today.js); receiver BR-ST-OUT for Invoices (1.3)
//   - the shop (stock/shop.js): a WooCommerce shop connected in
//     Settings › Connected services: products in, quantities both
//     ways, orders to a sale / Invoices / CRM / Budget
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
//   6. Reorder view + purchase orders + bridges
//      6b. Reports  6c. Counter  6d. Labels  6e. Photos
//   7. Suppliers view
//   8. Editors: product, movement, supplier, categories, units
//   9. Settings, CSV / JSON
//      9b. Camera scanning
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
  // orosI18n (../i18n.js): the full language code, a pack language included.
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  // Decimal comma (Greek, German, …): core.parseNum reads "1.234,5" for
  // "el" and "1,234.5" for "en"; typed values are shown the same way.
  var COMMA = (function () {
    try { return (1.5).toLocaleString(LOCALE).indexOf(",") >= 0; } catch (e) { return LANG === "el"; }
  })();
  var NUM = COMMA ? "el" : "en";

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
      "t.loss": "Loss / damage", "t.count": "Stock count", "t.fix": "Correction", "t.xfer": "Transfer",
      "voided": "voided",
      "moves.none": "No movements in this period.",
      "r.30": "Last 30 days", "r.month": "This month", "r.year": "This year", "r.all": "All",
      "mf.all": "All", "mf.in": "Receipts", "mf.out": "Sales", "mf.ret": "Returns", "mf.loss": "Losses", "mf.count": "Counts", "mf.fix": "Corrections", "mf.xfer": "Transfers",
      "lines": "{n} products", "lines1": "1 product",
      "mv.ref": "Ref.", "mv.sup": "Supplier", "mv.note": "Note", "mv.total": "Total",
      "mv.void": "Void this movement", "mv.voidQ": "Void this movement? Its quantities stop counting. It stays in the list, crossed out.",
      "mv.voidYes": "Void", "mv.voided": "This movement was voided.",
      "mv.counted": "counted {n}",
      "order.none": "Nothing to reorder. Products show up here when they reach their minimum (set one in the product).",
      "order.noSup": "No supplier", "order.copy": "Copy list", "order.receive": "Receive this order",
      "order.have": "have {q} · min {m}", "order.copied": "List copied",
      "order.head": "Order from {s} · {d}",
      "sups.none": "No suppliers yet.", "sups.items": "{n} products", "sups.items1": "1 product",
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
      "set.osave": "orOS file (.orosstock)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "pkg.undone": "Taken back",
      "set.negHint": "Two devices can sell the last piece at the same time; with this off, a sale that would go below zero is refused on this device.",
      "imp.title": "Import products", "imp.stats": "{a} new · {u} updated · {s} unchanged · {k} skipped",
      "imp.setQty": "Set the quantities from the file (saved as a stock count)", "imp.qtyN": "{n} quantities change",
      "imp.go": "Import", "imp.bad": "No product columns found. The first row must name the columns (Name or SKU at least).",
      "imp.done": "Imported: {a} new, {u} updated",
      "set.impCsv2": "Import products (CSV, Shopify, Square)",
      "imp2.title": "Import from {s}", "imp2.found": "Products in the file: {n}",
      "imp2.new": "New products: {n}", "imp2.back": "Deleted here before, coming back: {n}",
      "imp2.same": "Already here, kept as they are: {n}", "imp2.skip": "Rows skipped (no name, or a repeat): {n}",
      "imp2.cats": "New categories: {n}", "imp2.sups": "New suppliers: {n}", "imp2.locs": "Quantities of {n} locations are added together.",
      "imp2.map.shopify": "Title and options → name (one product per variant) · Variant SKU, Barcode, Price, Cost per item · Type → category · Vendor → supplier · description (as plain text), tags and image link → note.",
      "imp2.map.square": "Item and variation name → name · SKU, GTIN → barcode · Price, Default Unit Cost · Category · Default Vendor Name → supplier · Stock Alert Count → minimum · Description → note.",
      "imp2.qty": "Set the quantities of the new products ({n}) with a stock count",
      "imp2.qtyHint": "If you undo after importing quantities, the products stay archived with their voided count.",
      "imp2.hint": "Importing only adds products. Products already here are not changed; the same file twice adds nothing.",
      "imp2.none": "Nothing new to import", "imp2.done": "Products imported: {n}", "imp2.undone": "Import undone",
      "imp2.lib": "The Excel reader is missing. Save the sheet as CSV and import that.",
      "imp2.tags": "Tags", "imp2.image": "Image",
      "toast.saved": "Saved", "toast.added": "Added", "toast.deleted": "Deleted", "toast.undo": "Undo",
      "toast.save": "Couldn't save: the browser storage is full.", "toast.exported": "Exported",
      "toast.badFile": "That file can't be read.", "toast.imported": "Backup merged: {n} products",
      "toast.voided": "Movement voided", "toast.archived": "Archived", "toast.unarchived": "Back in the list",
      "open.ref": "Opening stock", "csv.ref": "CSV",
      "tab.reports": "Reports",
      "po.section": "Purchase orders", "po.new": "New order", "po.edit": "Edit order", "po.none": "No open orders.",
      "po.showDone": "Show finished ({n})", "po.hideDone": "Hide finished",
      "po.no": "Order no.", "po.date": "Order date", "po.exp": "Expected", "po.sup": "Supplier", "po.note": "Note",
      "po.lines": "Products", "po.ordered": "ordered {q}", "po.got": "received {q}", "po.left": "{q} to come",
      "po.total": "Order total", "po.receipts": "Receipts",
      "st.draft": "Draft", "st.sent": "Sent", "st.partial": "Partly received", "st.received": "Received",
      "st.closed": "Closed", "st.cancel": "Cancelled",
      "po.saveDraft": "Save as draft", "po.saveSent": "Save, mark sent", "po.markSent": "Mark sent",
      "po.receive": "Receive", "po.close": "Close order", "po.reopen": "Reopen", "po.cancel": "Cancel order",
      "po.closeQ": "Close this order? What has not arrived stops counting as on order.",
      "po.cancelQ": "Cancel this order?", "po.delQ": "Delete this order?",
      "po.late": "late", "po.dueOn": "expected {d}",
      "po.create": "Create order", "po.onOrder": "on order {q}", "po.covered": "ordered",
      "po.noLines": "Add at least one product.",
      "po.mailSubject": "Order {no}", "po.mailHi": "Hello,", "po.mailAsk": "Please send us:", "po.mailBye": "Thank you.",
      "br.todo": "To-Do", "br.mail": "E-mail", "br.budget": "Add to Budget", "br.quote": "New quote",
      "br.sheet": "Open in Spreadsheet", "br.todoList": "Order · {s}",
      "br.quoteCur": "Quote works in EUR or USD; Stock is set to {c}.", "br.quoteTitle": "New quote from products",
      "br.quoteGo": "Create quote", "br.sent": "Sent to {a}",
      "rep.range": "Period", "rep.value": "Stock value", "rep.sales": "Sales", "rep.buys": "Purchases", "rep.losses": "Losses",
      "rep.byCat": "Value by category", "rep.top": "Most sold", "rep.dead": "Not sold for 90 days",
      "rep.sold": "sold {q}", "rep.lastSale": "last sale {d}", "rep.never": "never sold",
      "rep.none": "Nothing in this period.", "rep.noDead": "No product with stock has gone 90 days without a sale.",
      "rep.csv": "Report (CSV)", "rep.sheetName": "Stock report",
      "rep.h.name": "Product", "rep.h.sku": "SKU", "rep.h.qty": "On hand", "rep.h.avg": "Average cost", "rep.h.value": "Value",
      "rep.h.in": "Received", "rep.h.out": "Sold", "rep.h.loss": "Lost", "rep.h.sales": "Sales",
      "rep.cut": "Only the first {n} rows went to the sheet.",
      "add.po": "Purchase order", "add.quote": "Quote from products",
      "ctr.title": "Counter", "ctr.ph": "Scan or search a product", "ctr.empty": "Scan a product to start a sale.",
      "ctr.done": "Complete sale", "ctr.clear": "Clear", "ctr.clearQ": "Clear this sale?", "ctr.sold": "Sale saved: {t}",
      "ctr.unknown": "No product with the code “{c}”.", "ctr.less": "One less", "ctr.more": "One more", "ctr.noPrice": "no price",
      "ctr.ref": "Counter",
      "wh.main": "Main warehouse", "wh.title": "Warehouses", "wh.one": "Warehouse", "wh.from": "From", "wh.to": "To",
      "wh.all": "All warehouses", "wh.new": "New warehouse", "wh.name": "Warehouse name", "wh.rename": "Rename",
      "wh.arch": "Archive", "wh.unarch": "Bring back", "wh.archived": "archived", "wh.del": "Delete",
      "wh.hint": "With a second warehouse, every movement says where it happened and Transfer moves stock between them. Totals, value and reorder stay for the whole business.",
      "wh.byWh": "By warehouse", "wh.same": "Choose two different warehouses.", "wh.here": "here {q}",
      "wh.archQ": "Archive this warehouse? It still holds stock; move it first with a Transfer.",
      "wh.value": "Value per warehouse",
      "lot.lot": "Lot", "lot.exp": "Expires", "lot.ph": "e.g. L2410", "lot.auto": "First to expire",
      "lot.add": "Lot / expiry", "lot.title": "Lots", "lot.none": "Without a lot", "lot.expired": "expired",
      "f.exp": "Expiring", "lot.rep": "Expiring within 30 days", "lot.repNone": "Nothing expires in the next 30 days.",
      "lot.line": "Lot {l} · expires {d}",
      "t.open": "Opening balance",
      "cl.btn": "Close a period", "cl.title": "Close a period", "cl.through": "Close the books through",
      "cl.now": "Closed through {d}.", "cl.never": "No period closed yet.",
      "cl.info": "{n} movements up to that day go to a file in Files (Stock/Archive) and are replaced by an opening balance per product: quantities per warehouse, lots, average costs. Quantities, value and reorder stay the same; the Movements tab and Reports then start after that day.",
      "cl.info1": "1 movement up to that day goes to a file in Files (Stock/Archive) and is replaced by an opening balance per product: quantities per warehouse, lots, average costs. Quantities, value and reorder stay the same; the Movements tab and Reports then start after that day.",
      "cl.size": "Stock data on this device: {kb} KB.", "cl.go": "Archive and close", "cl.bad": "Choose a day before today and after the last close.",
      "cl.none": "Nothing to archive up to that day.", "cl.noFs": "Files isn't available, so nothing was archived or closed.",
      "cl.fail": "The archive file could not be written, so nothing was closed.", "cl.done": "Closed through {d}. The full history is in Files › Stock/Archive.",
      "cl.locked": "The books are closed through {d}: choose a later date.", "cl.reopen": "Reopen",
      "cl.reopenQ": "Reopen the period? The archived movements come back from the file and the opening balance goes.",
      "cl.noFile": "The archive file isn't on this device yet.", "cl.reopened": "Period reopened.",
      "out.from": "From {a}. Check the lines and press Save.", "out.invoices": "Invoices", "out.other": "another app", "out.woo": "your shop (WooCommerce)",
      "add.shop": "Shop (WooCommerce)",
      "out.used1": "This document was already taken out of stock once.",
      "out.used": "This document was already taken out of stock {n} times.",
      "out.miss": "Not found in Stock, left out ({n}):",
      "cam.scan": "Scan with the camera", "cam.title": "Point the camera at a barcode", "cam.close": "Done",
      "cam.wait": "Starting the camera…", "cam.denied": "The camera could not start. Check that orOS may use it.",
      "cam.found": "Added: {n}", "cam.unknown": "No product with code {c}",
      "lbl.title": "Barcode labels", "lbl.copies": "Copies", "lbl.price": "Price on the label", "lbl.print": "Print",
      "lbl.sheet": "A4 sheet, 3 × 8 labels (70 × 37 mm)", "lbl.skip": "No barcode or SKU: {n}",
      "lbl.withPrice": "Show the price", "lbl.max": "At most {n} labels at a time.", "lbl.none": "Nothing to print: add products with a barcode or SKU.",
      "lbl.hint": "Products with a 13-digit barcode get an EAN-13; the rest get a Code 128 of their barcode or SKU.",
      "ph.add": "Add photo", "ph.change": "Change photo", "ph.remove": "Remove photo", "ph.missing": "Photo not on this device yet",
      "ph.bad": "That picture can't be read.", "ph.noDisk": "The orOS disk isn't available here.",
      "ph.where": "Kept in Files, folder Stock/Photos.",
      "add.counter": "Counter (quick sale)", "add.labels": "Barcode labels", "add.pos": "Point of sale (till)",
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
      "t.loss": "Φθορά / απώλεια", "t.count": "Απογραφή", "t.fix": "Διόρθωση", "t.xfer": "Μεταφορά",
      "voided": "ακυρωμένη",
      "moves.none": "Καμία κίνηση σε αυτό το διάστημα.",
      "r.30": "Τελευταίες 30 μέρες", "r.month": "Αυτός ο μήνας", "r.year": "Φέτος", "r.all": "Όλες",
      "mf.all": "Όλες", "mf.in": "Παραλαβές", "mf.out": "Πωλήσεις", "mf.ret": "Επιστροφές", "mf.loss": "Φθορές", "mf.count": "Απογραφές", "mf.fix": "Διορθώσεις", "mf.xfer": "Μεταφορές",
      "lines": "{n} προϊόντα", "lines1": "1 προϊόν",
      "mv.ref": "Παραστατικό", "mv.sup": "Προμηθευτής", "mv.note": "Σημείωση", "mv.total": "Σύνολο",
      "mv.void": "Ακύρωση κίνησης", "mv.voidQ": "Να ακυρωθεί η κίνηση; Οι ποσότητές της δεν μετράνε πια. Μένει στη λίστα, διαγραμμένη.",
      "mv.voidYes": "Ακύρωση", "mv.voided": "Αυτή η κίνηση ακυρώθηκε.",
      "mv.counted": "μετρήθηκαν {n}",
      "order.none": "Δεν χρειάζεται παραγγελία. Τα προϊόντα εμφανίζονται εδώ όταν φτάσουν στο ελάχιστο (το ορίζεις στο προϊόν).",
      "order.noSup": "Χωρίς προμηθευτή", "order.copy": "Αντιγραφή λίστας", "order.receive": "Παραλαβή παραγγελίας",
      "order.have": "έχεις {q} · ελάχιστο {m}", "order.copied": "Η λίστα αντιγράφηκε",
      "order.head": "Παραγγελία προς {s} · {d}",
      "sups.none": "Κανένας προμηθευτής ακόμα.", "sups.items": "{n} προϊόντα", "sups.items1": "1 προϊόν",
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
      "set.osave": "Αρχείο orOS (.orosstock)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "pkg.undone": "Αναιρέθηκε",
      "set.negHint": "Δύο συσκευές μπορεί να πουλήσουν το τελευταίο κομμάτι ταυτόχρονα· αν το κλείσεις, μια πώληση που θα έριχνε το απόθεμα κάτω από το μηδέν απορρίπτεται σε αυτή τη συσκευή.",
      "imp.title": "Εισαγωγή προϊόντων", "imp.stats": "{a} νέα · {u} ενημερωμένα · {s} ίδια · {k} παραλείφθηκαν",
      "imp.setQty": "Ορισμός ποσοτήτων από το αρχείο (ως απογραφή)", "imp.qtyN": "Αλλάζουν {n} ποσότητες",
      "imp.go": "Εισαγωγή", "imp.bad": "Δεν βρέθηκαν στήλες προϊόντων. Η πρώτη γραμμή πρέπει να έχει τα ονόματα των στηλών (τουλάχιστον Όνομα ή SKU).",
      "imp.done": "Εισαγωγή: {a} νέα, {u} ενημερωμένα",
      "set.impCsv2": "Εισαγωγή προϊόντων (CSV, Shopify, Square)",
      "imp2.title": "Εισαγωγή από {s}", "imp2.found": "Προϊόντα στο αρχείο: {n}",
      "imp2.new": "Νέα προϊόντα: {n}", "imp2.back": "Είχαν διαγραφεί εδώ και επιστρέφουν: {n}",
      "imp2.same": "Υπάρχουν ήδη και μένουν όπως είναι: {n}", "imp2.skip": "Γραμμές που παραλείφθηκαν (χωρίς όνομα ή επανάληψη): {n}",
      "imp2.cats": "Νέες κατηγορίες: {n}", "imp2.sups": "Νέοι προμηθευτές: {n}", "imp2.locs": "Οι ποσότητες {n} καταστημάτων αθροίζονται.",
      "imp2.map.shopify": "Τίτλος και επιλογές → όνομα (ένα προϊόν ανά παραλλαγή) · Variant SKU, Barcode, τιμή, κόστος · Type → κατηγορία · Vendor → προμηθευτής · περιγραφή (ως απλό κείμενο), ετικέτες και σύνδεσμος εικόνας → σημείωση.",
      "imp2.map.square": "Όνομα είδους και παραλλαγής → όνομα · SKU, GTIN → barcode · τιμή, κόστος μονάδας · κατηγορία · προμηθευτής · Stock Alert Count → ελάχιστο · περιγραφή → σημείωση.",
      "imp2.qty": "Ορισμός ποσοτήτων για τα νέα προϊόντα ({n}) με απογραφή",
      "imp2.qtyHint": "Αν αναιρέσεις μια εισαγωγή με ποσότητες, τα προϊόντα μένουν στο αρχείο με την απογραφή τους ακυρωμένη.",
      "imp2.hint": "Η εισαγωγή μόνο προσθέτει προϊόντα. Όσα υπάρχουν ήδη δεν αλλάζουν· το ίδιο αρχείο δεύτερη φορά δεν προσθέτει τίποτα.",
      "imp2.none": "Δεν υπάρχει κάτι νέο για εισαγωγή", "imp2.done": "Προϊόντα που μπήκαν: {n}", "imp2.undone": "Η εισαγωγή αναιρέθηκε",
      "imp2.lib": "Λείπει το πρόγραμμα ανάγνωσης Excel. Αποθήκευσε το φύλλο ως CSV και κάνε εισαγωγή αυτό.",
      "imp2.tags": "Ετικέτες", "imp2.image": "Εικόνα",
      "toast.saved": "Αποθηκεύτηκε", "toast.added": "Προστέθηκε", "toast.deleted": "Διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του browser γέμισε.", "toast.exported": "Έγινε εξαγωγή",
      "toast.badFile": "Αυτό το αρχείο δεν διαβάζεται.", "toast.imported": "Το αντίγραφο ενώθηκε: {n} προϊόντα",
      "toast.voided": "Η κίνηση ακυρώθηκε", "toast.archived": "Αρχειοθετήθηκε", "toast.unarchived": "Ξανά στη λίστα",
      "open.ref": "Αρχικό απόθεμα", "csv.ref": "CSV",
      "tab.reports": "Αναφορές",
      "po.section": "Εντολές αγοράς", "po.new": "Νέα εντολή", "po.edit": "Επεξεργασία εντολής", "po.none": "Καμία ανοιχτή εντολή.",
      "po.showDone": "Δείξε τις ολοκληρωμένες ({n})", "po.hideDone": "Κρύψε τις ολοκληρωμένες",
      "po.no": "Αρ. εντολής", "po.date": "Ημερομηνία", "po.exp": "Αναμένεται", "po.sup": "Προμηθευτής", "po.note": "Σημείωση",
      "po.lines": "Προϊόντα", "po.ordered": "παραγγέλθηκαν {q}", "po.got": "ήρθαν {q}", "po.left": "έρχονται {q}",
      "po.total": "Σύνολο εντολής", "po.receipts": "Παραλαβές",
      "st.draft": "Πρόχειρη", "st.sent": "Στάλθηκε", "st.partial": "Ήρθε μέρος", "st.received": "Παραλήφθηκε",
      "st.closed": "Κλειστή", "st.cancel": "Ακυρωμένη",
      "po.saveDraft": "Αποθήκευση ως πρόχειρη", "po.saveSent": "Αποθήκευση, στάλθηκε", "po.markSent": "Σημείωσε ότι στάλθηκε",
      "po.receive": "Παραλαβή", "po.close": "Κλείσιμο εντολής", "po.reopen": "Άνοιγμα ξανά", "po.cancel": "Ακύρωση εντολής",
      "po.closeQ": "Να κλείσει η εντολή; Ό,τι δεν ήρθε σταματά να μετρά ως «σε παραγγελία».",
      "po.cancelQ": "Να ακυρωθεί η εντολή;", "po.delQ": "Να διαγραφεί η εντολή;",
      "po.late": "καθυστερεί", "po.dueOn": "αναμένεται {d}",
      "po.create": "Δημιουργία εντολής", "po.onOrder": "σε παραγγελία {q}", "po.covered": "παραγγέλθηκε",
      "po.noLines": "Πρόσθεσε τουλάχιστον ένα προϊόν.",
      "po.mailSubject": "Παραγγελία {no}", "po.mailHi": "Καλησπέρα σας,", "po.mailAsk": "Παρακαλούμε να μας στείλετε:", "po.mailBye": "Ευχαριστούμε.",
      "br.todo": "To-Do", "br.mail": "E-mail", "br.budget": "Στα Έσοδα & Έξοδα", "br.quote": "Νέα προσφορά",
      "br.sheet": "Άνοιγμα στο Υπολογιστικό φύλλο", "br.todoList": "Παραγγελία · {s}",
      "br.quoteCur": "Η Προσφορά δουλεύει σε EUR ή USD· το Απόθεμα είναι σε {c}.", "br.quoteTitle": "Νέα προσφορά από προϊόντα",
      "br.quoteGo": "Δημιουργία προσφοράς", "br.sent": "Στάλθηκε: {a}",
      "rep.range": "Διάστημα", "rep.value": "Αξία αποθήκης", "rep.sales": "Πωλήσεις", "rep.buys": "Αγορές", "rep.losses": "Φθορές",
      "rep.byCat": "Αξία ανά κατηγορία", "rep.top": "Πιο πολλές πωλήσεις", "rep.dead": "Χωρίς πώληση 90 μέρες",
      "rep.sold": "πουλήθηκαν {q}", "rep.lastSale": "τελευταία πώληση {d}", "rep.never": "δεν πουλήθηκε ποτέ",
      "rep.none": "Τίποτα σε αυτό το διάστημα.", "rep.noDead": "Κανένα προϊόν με απόθεμα δεν έμεινε 90 μέρες χωρίς πώληση.",
      "rep.csv": "Αναφορά (CSV)", "rep.sheetName": "Αναφορά αποθέματος",
      "rep.h.name": "Προϊόν", "rep.h.sku": "SKU", "rep.h.qty": "Διαθέσιμα", "rep.h.avg": "Μέσο κόστος", "rep.h.value": "Αξία",
      "rep.h.in": "Παραλήφθηκαν", "rep.h.out": "Πουλήθηκαν", "rep.h.loss": "Χάθηκαν", "rep.h.sales": "Πωλήσεις",
      "rep.cut": "Στο φύλλο πήγαν μόνο οι πρώτες {n} γραμμές.",
      "add.po": "Εντολή αγοράς", "add.quote": "Προσφορά από προϊόντα",
      "ctr.title": "Ταμείο", "ctr.ph": "Σάρωσε ή ψάξε προϊόν", "ctr.empty": "Σάρωσε ένα προϊόν για να ξεκινήσει η πώληση.",
      "ctr.done": "Ολοκλήρωση πώλησης", "ctr.clear": "Καθαρισμός", "ctr.clearQ": "Να καθαρίσει αυτή η πώληση;", "ctr.sold": "Η πώληση καταχωρήθηκε: {t}",
      "ctr.unknown": "Δεν υπάρχει προϊόν με κωδικό «{c}».", "ctr.less": "Ένα λιγότερο", "ctr.more": "Ένα ακόμα", "ctr.noPrice": "χωρίς τιμή",
      "ctr.ref": "Ταμείο",
      "wh.main": "Κεντρική αποθήκη", "wh.title": "Αποθήκες", "wh.one": "Αποθήκη", "wh.from": "Από", "wh.to": "Προς",
      "wh.all": "Όλες οι αποθήκες", "wh.new": "Νέα αποθήκη", "wh.name": "Όνομα αποθήκης", "wh.rename": "Μετονομασία",
      "wh.arch": "Αρχειοθέτηση", "wh.unarch": "Επαναφορά", "wh.archived": "αρχειοθετημένη", "wh.del": "Διαγραφή",
      "wh.hint": "Με δεύτερη αποθήκη, κάθε κίνηση λέει πού έγινε και η Μεταφορά μετακινεί απόθεμα ανάμεσά τους. Σύνολα, αξία και παραγγελίες μένουν για όλη την επιχείρηση.",
      "wh.byWh": "Ανά αποθήκη", "wh.same": "Διάλεξε δύο διαφορετικές αποθήκες.", "wh.here": "εδώ {q}",
      "wh.archQ": "Αρχειοθέτηση αυτής της αποθήκης; Έχει ακόμα απόθεμα· μετάφερέ το πρώτα με Μεταφορά.",
      "wh.value": "Αξία ανά αποθήκη",
      "lot.lot": "Παρτίδα", "lot.exp": "Λήγει", "lot.ph": "π.χ. L2410", "lot.auto": "Πρώτη που λήγει",
      "lot.add": "Παρτίδα / λήξη", "lot.title": "Παρτίδες", "lot.none": "Χωρίς παρτίδα", "lot.expired": "έληξε",
      "f.exp": "Λήγουν", "lot.rep": "Λήγουν μέσα σε 30 μέρες", "lot.repNone": "Τίποτα δεν λήγει τις επόμενες 30 μέρες.",
      "lot.line": "Παρτίδα {l} · λήγει {d}",
      "t.open": "Υπόλοιπο έναρξης",
      "cl.btn": "Κλείσιμο χρήσης", "cl.title": "Κλείσιμο χρήσης", "cl.through": "Κλείσιμο έως και",
      "cl.now": "Κλεισμένη έως {d}.", "cl.never": "Δεν έχει κλείσει ακόμη καμία περίοδος.",
      "cl.info": "{n} κινήσεις έως εκείνη τη μέρα πάνε σε αρχείο στα Αρχεία (Stock/Archive) και αντικαθίστανται από υπόλοιπο έναρξης ανά προϊόν: ποσότητες ανά αποθήκη, παρτίδες, μέσα κόστη. Ποσότητες, αξία και παραγγελία μένουν ίδιες· η καρτέλα Κινήσεις και οι Αναφορές ξεκινούν μετά από εκείνη τη μέρα.",
      "cl.info1": "1 κίνηση έως εκείνη τη μέρα πηγαίνει σε αρχείο στα Αρχεία (Stock/Archive) και αντικαθίσταται από υπόλοιπο έναρξης ανά προϊόν: ποσότητες ανά αποθήκη, παρτίδες, μέσα κόστη. Ποσότητες, αξία και παραγγελία μένουν ίδιες· η καρτέλα Κινήσεις και οι Αναφορές ξεκινούν μετά από εκείνη τη μέρα.",
      "cl.size": "Δεδομένα Αποθέματος σε αυτή τη συσκευή: {kb} KB.", "cl.go": "Αρχειοθέτηση και κλείσιμο", "cl.bad": "Διάλεξε μέρα πριν από σήμερα και μετά το τελευταίο κλείσιμο.",
      "cl.none": "Δεν υπάρχει τίποτα για αρχειοθέτηση έως εκείνη τη μέρα.", "cl.noFs": "Τα Αρχεία δεν είναι διαθέσιμα, οπότε δεν αρχειοθετήθηκε ούτε έκλεισε τίποτα.",
      "cl.fail": "Το αρχείο δεν γράφτηκε, οπότε δεν έκλεισε τίποτα.", "cl.done": "Κλεισμένη έως {d}. Όλο το ιστορικό είναι στα Αρχεία › Stock/Archive.",
      "cl.locked": "Η χρήση είναι κλεισμένη έως {d}: διάλεξε μεταγενέστερη ημερομηνία.", "cl.reopen": "Επανάνοιγμα",
      "cl.reopenQ": "Επανάνοιγμα της περιόδου; Οι αρχειοθετημένες κινήσεις επιστρέφουν από το αρχείο και το υπόλοιπο έναρξης φεύγει.",
      "cl.noFile": "Το αρχείο δεν έχει έρθει ακόμη σε αυτή τη συσκευή.", "cl.reopened": "Η περίοδος άνοιξε ξανά.",
      "out.from": "Ήρθε από: {a}. Έλεγξε τις γραμμές και πάτα Αποθήκευση.", "out.invoices": "Τιμολόγια", "out.other": "άλλη εφαρμογή", "out.woo": "το κατάστημά σου (WooCommerce)",
      "add.shop": "Κατάστημα (WooCommerce)",
      "out.used1": "Αυτό το παραστατικό έχει ήδη αφαιρεθεί από το απόθεμα μία φορά.",
      "out.used": "Αυτό το παραστατικό έχει ήδη αφαιρεθεί από το απόθεμα {n} φορές.",
      "out.miss": "Δεν βρέθηκαν στο Απόθεμα και παραλείφθηκαν ({n}):",
      "cam.scan": "Σάρωση με την κάμερα", "cam.title": "Στόχευσε ένα barcode με την κάμερα", "cam.close": "Τέλος",
      "cam.wait": "Ξεκινάει η κάμερα…", "cam.denied": "Η κάμερα δεν ξεκίνησε. Έλεγξε ότι το orOS έχει άδεια να τη χρησιμοποιεί.",
      "cam.found": "Προστέθηκε: {n}", "cam.unknown": "Κανένα προϊόν με κωδικό {c}",
      "lbl.title": "Ετικέτες barcode", "lbl.copies": "Αντίτυπα", "lbl.price": "Τιμή στην ετικέτα", "lbl.print": "Εκτύπωση",
      "lbl.sheet": "Σελίδα A4, 3 × 8 ετικέτες (70 × 37 mm)", "lbl.skip": "Χωρίς barcode ή SKU: {n}",
      "lbl.withPrice": "Να φαίνεται η τιμή", "lbl.max": "Το πολύ {n} ετικέτες κάθε φορά.", "lbl.none": "Δεν υπάρχει κάτι για εκτύπωση: πρόσθεσε προϊόντα με barcode ή SKU.",
      "lbl.hint": "Τα προϊόντα με barcode 13 ψηφίων παίρνουν EAN-13· τα υπόλοιπα Code 128 με το barcode ή το SKU τους.",
      "ph.add": "Προσθήκη φωτογραφίας", "ph.change": "Αλλαγή φωτογραφίας", "ph.remove": "Αφαίρεση φωτογραφίας", "ph.missing": "Η φωτογραφία δεν έχει έρθει ακόμα σε αυτή τη συσκευή",
      "ph.bad": "Αυτή η εικόνα δεν διαβάζεται.", "ph.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "ph.where": "Φυλάσσεται στα Αρχεία, φάκελος Stock/Photos.",
      "add.counter": "Ταμείο (γρήγορη πώληση)", "add.labels": "Ετικέτες barcode", "add.pos": "Σημείο πώλησης (POS)",
      "u.custom": "μονάδα"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "stock", LANG);

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
  var T_ICON = { "in": "📥", out: "📤", ret: "↩️", rts: "↪️", loss: "💔", count: "📋", fix: "✏️", xfer: "🔀", open: "📒" };

  // "{n} products" with a singular for 1 (key + "1")
  function tn(key, n) { return n === 1 ? t(key + "1") : t(key, { n: n }); }
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
    var v = C.parseNum(String(input.value || "").trim(), NUM);
    if (v === null) return null;
    if (v < 0 && !allowNeg) return null;
    var dec = decOf(item), q = Math.round(v * Math.pow(10, dec)) * Math.pow(10, 3 - dec);
    return Math.abs(q) > C.Q_MAX ? null : q;
  }
  function qtyStr(q, item) {
    if (q === null || q === undefined) return "";
    var dec = decOf(item), v = q / 1000;
    var s = dec ? String(Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)) : String(Math.round(v));
    return COMMA ? s.replace(".", ",") : s;
  }
  function readCents(input) {
    var s = String(input.value || "").trim();
    if (!s) return 0;
    var v = C.parseNum(s, NUM);
    if (v === null || v < 0) return null;
    var c = Math.round(v * 100);
    return c > C.C_MAX ? null : c;
  }
  function centsStr(c) {
    if (!c) return "";
    var s = (c / 100).toFixed(2);
    return COMMA ? s.replace(".", ",") : s;
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

  var TABS = ["items", "moves", "order", "sups", "reports"];
  var IFILTERS = ["all", "low", "out", "exp", "arch"];
  var MFILTERS = ["all", "in", "out", "ret", "loss", "count", "fix", "xfer"];
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
      range: RANGES.indexOf(p.range) >= 0 ? p.range : "30",
      rr: RANGES.indexOf(p.rr) >= 0 ? p.rr : "30",
      poAll: p.poAll === true,
      wh: typeof p.wh === "string" ? p.wh : "",        // this device's warehouse for new movements
      wf: typeof p.wf === "string" ? p.wf : "*",       // Products: "*" all, else one warehouse
      pos: readPos(p.pos)                              // the till on this device (1.7)
    };
  }
  // The point of sale's device-local settings: price list in use,
  // receipt header / footer, paper width, register code (receipt nos.).
  function readPos(x) {
    x = x && typeof x === "object" ? x : {};
    return {
      pl: typeof x.pl === "string" ? x.pl.slice(0, 64) : "",
      head: typeof x.head === "string" ? x.head.slice(0, 300) : "",
      foot: typeof x.foot === "string" ? x.foot.slice(0, 200) : "",
      paper: x.paper === 80 ? 80 : 58,
      dev: typeof x.dev === "string" && /^[A-Z2-9]{2}$/.test(x.dev) ? x.dev : ""
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
  // ----- warehouses (1.4) -----
  function mainWh() { return C.whName(data, "", t("wh.main")); }
  function whLabel(w) { return C.whName(data, w, t("wh.main")); }
  function extraWhs(withArch) {
    return byName(data.whs.filter(function (w) { return w.id !== C.WH_MAIN && (withArch || !w.arch); }));
  }
  // several warehouses in use: the extra UI shows
  function multiWh() { return extraWhs(false).length > 0; }
  function whOk(w) { return w === "" || extraWhs(false).some(function (x) { return x.id === w; }); }
  function defWh() { return whOk(prefs.wh) ? prefs.wh : ""; }
  function whAll() {
    var st = rows();
    if (!st.wh) st.wh = C.whQty(data);
    return st.wh;
  }
  // lots (1.5): cached like the rows; soon = expiring within 30 days
  var EXP_SOON = 30;
  function lotsAll() {
    var st = rows();
    if (!st.lots) st.lots = C.allLots(data);
    return st.lots;
  }
  function soonList() {
    var st = rows();
    if (!st.soon) st.soon = C.expiring(data, todayYmd(), EXP_SOON);
    return st.soon;
  }
  function soonIds() {
    var ids = Object.create(null);
    soonList().forEach(function (x) { ids[x.item.id] = true; });
    return ids;
  }
  function qtyAt(itemId, w) { var r = whAll()[itemId]; return (r && r[w || ""]) || 0; }
  function whSelect(value) {
    var opts = [["", mainWh()]].concat(extraWhs(false).map(function (w) { return [w.id, w.name]; }));
    var sel = selectInput(opts, whOk(value) ? value : "");
    return sel;
  }
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
    // a till sale's movement: its sale is voided with it (1.7)
    if (/^pos:/.test(cur.src || "")) {
      var s = byId("sales", cur.src.slice(4));
      if (s && s.v !== 1) { s.v = 1; stamp(s); }
    }
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
    // consignment shops (1.8): how many are due for a settlement
    if (window.OrosStockConsign && C.consList(data).length) {
      var due = C.consDue(data, todayYmd()).length, CT = window.OrosStockConsign.TEXT;
      var ct = CT[LANG] || CT.en;
      box.appendChild(tile(ct["cons.tile"] || CT.en["cons.tile"], due ? (ct["cons.dueN"] || CT.en["cons.dueN"]).split("{n}").join(String(due)) : String(C.consList(data).length),
        openConsign, due ? "warn" : ""));
    }
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
    var soon = soonIds(), anySoon = Object.keys(soon).length > 0;
    if (prefs.f === "exp" && !anySoon) prefs.f = "all";
    IFILTERS.forEach(function (f) {
      if (f === "exp" && !anySoon) return;
      var b = el("button", "chip" + (prefs.f === f ? " on" : "") + (f === "exp" ? " warn" : ""), t("f." + f));
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
    var ws = $("items-wh");
    ws.innerHTML = "";
    ws.hidden = !multiWh();
    if (!ws.hidden) {
      [["*", t("wh.all")], ["", mainWh()]].concat(extraWhs(false).map(function (w) { return [w.id, w.name]; })).forEach(function (o) {
        var op = el("option", "", o[1]);
        op.value = o[0];
        ws.appendChild(op);
      });
    }
    if (ws.hidden || (prefs.wf !== "*" && !whOk(prefs.wf))) prefs.wf = "*";
    ws.value = prefs.wf;
    // one warehouse chosen: its quantity is shown, "out of stock" and the
    // qty order use it; low stock stays the business-wide minimum
    var wf = prefs.wf;
    function qOf(r) { return wf === "*" ? r.q : qtyAt(r.item.id, wf); }
    var ss = $("items-sort");
    ss.innerHTML = "";
    SORTS.forEach(function (s) { var op = el("option", "", t("sort." + s)); op.value = s; ss.appendChild(op); });
    ss.value = prefs.sort;

    var words = C.fold($("items-q").value).split(" ").filter(Boolean);
    var list = rows().list.filter(function (r) {
      var it = r.item;
      if (prefs.f === "arch" ? !it.arch : it.arch) return false;
      if (prefs.f === "low" && !r.low) return false;
      if (prefs.f === "out" && qOf(r) > 0) return false;
      if (prefs.f === "exp" && !soon[it.id]) return false;
      if (prefs.cat === "-" && it.cat && byId("cats", it.cat)) return false;
      if (prefs.cat && prefs.cat !== "-" && it.cat !== prefs.cat) return false;
      return matchItem(it, words);
    });
    list.sort(function (a, b) {
      var x = a.item, y = b.item;
      if (prefs.sort === "sku") return (x.sku ? 0 : 1) - (y.sku ? 0 : 1) || x.sku.localeCompare(y.sku, LOCALE, { numeric: true }) || x.name.localeCompare(y.name, LOCALE);
      if (prefs.sort === "qty") return (qOf(a) - qOf(b)) || x.name.localeCompare(y.name, LOCALE);
      if (prefs.sort === "value") return (b.value - a.value) || x.name.localeCompare(y.name, LOCALE);
      return x.name.localeCompare(y.name, LOCALE) || cmpStr(x.id, y.id);
    });
    var ul = $("items-list");
    ul.innerHTML = "";
    if (!list.length) { ul.appendChild(el("li", "muted pad", t("items.none"))); return; }
    list.slice(0, MAX_SHOWN).forEach(function (r) { ul.appendChild(itemRow(r, qOf(r))); });
    if (list.length > MAX_SHOWN) ul.appendChild(el("li", "muted pad", t("items.more", { n: MAX_SHOWN, all: list.length })));
  }
  function itemRow(r, q) {
    var it = r.item, out = q <= 0;
    var li = el("li");
    var b = el("button", "row row-btn" + (out ? " lvl-out" : (r.low ? " lvl-low" : "")));
    b.type = "button";
    var body = el("span", "r-body");
    body.appendChild(el("span", "r-name", it.name));
    var sub = el("span", "r-sub");
    var cat = byId("cats", it.cat);
    [it.sku, cat ? cat.name : "", it.loc].forEach(function (s) { if (s) sub.appendChild(el("span", "", s)); });
    if (it.arch) sub.appendChild(el("span", "badge", t("badge.arch")));
    if (sub.childNodes.length) body.appendChild(sub);
    b.appendChild(body);
    var val = el("span", "r-val" + (out ? " bad" : (r.low ? " warn" : "")), fmtQ(q, it));
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
    var ph = photoBox(it, dlg);
    if (ph) dlg.appendChild(ph);
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
    if (multiWh() || Object.keys(whAll()[it.id] || {}).some(function (w) { return w && qtyAt(it.id, w); })) {
      dlg.appendChild(el("div", "dlg-lbl", t("wh.byWh")));
      var wb = el("div", "kvs");
      [""].concat(extraWhs(true).map(function (w) { return w.id; })).forEach(function (w) {
        var q = qtyAt(it.id, w), wh = byId("whs", w);
        if (w && wh && wh.arch && !q) return;
        kv(wb, whLabel(w), fmtQ(q, it), q < 0 ? "bad" : "");
      });
      dlg.appendChild(wb);
    }
    var lots = lotsAll()[it.id];
    if (lots && lots.lots.length) {
      dlg.appendChild(el("div", "dlg-lbl", t("lot.title")));
      var lb = el("div", "kvs"), today = todayYmd(), soonDay = C.addDays(today, EXP_SOON);
      lots.lots.forEach(function (x) {
        var tone = x.exp && x.exp < today ? "bad" : (x.exp && x.exp <= soonDay ? "warn" : "");
        var label = x.lot + (x.exp ? " · " + fmtDay(x.exp, true) + (x.exp < today ? " (" + t("lot.expired") + ")" : "") : "");
        kv(lb, label, fmtQ(x.q, it), tone);
      });
      if (lots.none) kv(lb, t("lot.none"), fmtQ(lots.none, it), lots.none < 0 ? "bad" : "");
      dlg.appendChild(lb);
    }
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
        if (whText(h.move)) s.appendChild(el("span", "", whText(h.move)));
        if (h.move.v === 1) s.appendChild(el("span", "badge", t("voided")));
        body.appendChild(s);
        b.appendChild(body);
        var v = el("span", "r-val", lineQty(h.move, h.line.q, it));
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
    foot.appendChild(button(t("add.po"), "", function () {
      dlg.close();
      poEditor(null, { sup: it.sup, lines: [{ i: it.id, q: C.suggestQty(r, decOf(it)), c: it.cost || undefined }] });
    }));
    if (quoteReady() && !it.arch) foot.appendChild(button(t("br.quote"), "", function () { dlg.close(); quoteDialog([{ i: it.id, q: Math.pow(10, 3 - decOf(it)) }]); }));
    if (C.barcodeFor(it)) foot.appendChild(button(t("add.labels"), "", function () { dlg.close(); labelsDialog([it.id]); }));
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
      foot.appendChild(button(t("sheet.delete"), "danger", function () {
        var pic = C.picOf(data, it.id);
        dlg.close();
        removeRow("items", it);
        if (pic) dropPicLater(pic);
      }));
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
    if (prefs.mf === "xfer" && !multiWh()) prefs.mf = "all";
    MFILTERS.forEach(function (f) {
      if (f === "xfer" && !multiWh()) return;
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
    var op = C.openMove(data);
    var list = (op ? [op] : []).concat(data.moves).filter(function (mv) { return (!from || mv.d >= from) && typeMatch(mv); })
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
  // where a movement happened: "" with one warehouse, "A → B" for a transfer
  function whText(mv) {
    if (mv.t === "open") return "";
    if (mv.t === "xfer") return whLabel(mv.w) + " → " + whLabel(mv.w2);
    return mv.w || multiWh() ? whLabel(mv.w) : "";
  }
  // a transfer's quantity has no sign: it changes no total
  function lineQty(mv, q, it) { return mv.t === "xfer" ? "⇄ " + fmtQ(q, it) : fmtSigned(q, it); }
  function moveTitle(mv) {
    var ids = [];
    mv.lines.forEach(function (l) { if (ids.indexOf(l.i) < 0) ids.push(l.i); });
    if (ids.length === 1) {
      var it = byId("items", ids[0]);
      return it ? it.name : "?";
    }
    return tn("lines", ids.length);
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
    if (whText(mv)) sub.appendChild(el("span", "", whText(mv)));
    if (mv.v === 1) sub.appendChild(el("span", "badge", t("voided")));
    body.appendChild(sub);
    b.appendChild(body);
    var val;
    if (mv.lines.length === 1) {
      val = el("span", "r-val", lineQty(mv, mv.lines[0].q, byId("items", mv.lines[0].i)));
    } else val = el("span", "r-val", "");
    var tot = moveTotal(mv);
    if (tot !== null) val.appendChild(el("small", "", money(tot)));
    b.appendChild(val);
    b.addEventListener("click", function () { moveSheet(mv.id); });
    li.appendChild(b);
    return li;
  }
  function moveSheet(id) {
    var mv = id === C.OPEN_ID ? C.openMove(data) : byId("moves", id);
    if (!mv) return;
    var dlg = makeDialog("st-move", true);
    dlg.appendChild(el("div", "dlg-title", T_ICON[mv.t] + " " + t("t." + mv.t)));
    if (mv.v === 1) dlg.appendChild(el("p", "hint warn", t("mv.voided")));
    var box = el("div", "kvs");
    kv(box, t("mv.date"), fmtDay(mv.d, true));
    kv(box, t("mv.ref"), mv.ref);
    var sup = byId("sups", mv.sup);
    if (sup) kv(box, t("mv.sup"), sup.name);
    if (mv.t === "xfer") { kv(box, t("wh.from"), whLabel(mv.w)); kv(box, t("wh.to"), whLabel(mv.w2)); }
    else if (whText(mv)) kv(box, t("wh.one"), whText(mv));
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
      if (mv.t === "open" && (l.w || multiWh())) s.appendChild(el("span", "", whLabel(l.w)));
      if (l.lot) s.appendChild(el("span", "", l.exp ? t("lot.line", { l: l.lot, d: fmtDay(l.exp, true) }) : t("lot.lot") + " " + l.lot));
      if (s.childNodes.length) body.appendChild(s);
      b.appendChild(body);
      b.appendChild(el("span", "r-val", lineQty(mv, l.q, it)));
      if (it) b.addEventListener("click", function () { dlg.close(); itemSheet(it.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    if (mv.note) dlg.appendChild(el("p", "notes", mv.note));
    var poId = mv.src && mv.src.indexOf("po:") === 0 ? mv.src.slice(3) : "";
    var acts = el("div", "dlg-actions wrap");
    if (poId && byId("pos", poId)) acts.appendChild(button("🧾 " + (byId("pos", poId).no || t("po.section")), "", function () { dlg.close(); poSheet(poId); }));
    if (mv.v !== 1 && (mv.t === "in" || mv.t === "out") && moveTotal(mv) && budgetReady()) {
      acts.appendChild(button(t("br.budget"), "", function () { dlg.close(); sendBudget(mv); }));
    }
    if (mv.v !== 1 && mv.t !== "open") acts.appendChild(button(t("mv.void"), "danger", function () {
      confirmDialog(t("mv.voidQ"), t("mv.voidYes"), true, function () { dlg.close(); voidMove(mv); });
    }));
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 6. Reorder view: purchase orders + low items ----------
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
  // What to order of one low row: the suggestion minus what is already
  // on order (open purchase orders).
  function needOf(r, oo) {
    return Math.max(0, C.suggestQty(r, decOf(r.item)) - (oo[r.item.id] || 0));
  }
  function renderOrder() {
    renderPos();
    var box = $("order-list");
    box.innerHTML = "";
    var groups = orderGroups(), oo = C.onOrder(data);
    if (!groups.length) { box.appendChild(el("p", "empty-line", t("order.none"))); return; }
    groups.forEach(function (g) {
      var sec = el("div", "sec");
      var h = el("div", "sec-head");
      h.appendChild(el("h2", "", g.sup ? g.sup.name : t("order.noSup")));
      sec.appendChild(h);
      if (g.sup && (g.sup.tel || g.sup.email)) sec.appendChild(el("p", "muted sec-sub", [g.sup.person, g.sup.tel, g.sup.email].filter(Boolean).join(" · ")));
      var ul = el("ul", "rows");
      g.rows.forEach(function (r) {
        var it = r.item, need = needOf(r, oo);
        var li = el("li");
        var b = el("button", "row row-btn " + (r.out ? "lvl-out" : "lvl-low"));
        b.type = "button";
        var body = el("span", "r-body");
        body.appendChild(el("span", "r-name", it.name));
        var s = el("span", "r-sub");
        if (it.sku) s.appendChild(el("span", "", it.sku));
        if (it.ssku) s.appendChild(el("span", "", it.ssku));
        s.appendChild(el("span", "", t("order.have", { q: fmtQ(r.q, it, true), m: fmtQ(it.min, it, true) })));
        if (oo[it.id]) s.appendChild(el("span", "", t("po.onOrder", { q: fmtQ(oo[it.id], it, true) })));
        body.appendChild(s);
        b.appendChild(body);
        b.appendChild(el("span", "r-val", need > 0 ? "+" + fmtQ(need, it) : "✓ " + t("po.covered")));
        b.addEventListener("click", function () { itemSheet(it.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      var want = g.rows.filter(function (r) { return needOf(r, oo) > 0; });
      var acts = el("div", "dlg-actions tight sec-acts");
      if (want.length) {
        acts.appendChild(button(t("po.create"), "primary", function () {
          poEditor(null, { sup: g.sup ? g.sup.id : "", lines: want.map(function (r) { return { i: r.item.id, q: needOf(r, oo), c: r.item.cost || undefined }; }) });
        }));
        acts.appendChild(button(t("order.copy"), "", function () { copyText(orderText(g.sup, want.map(function (r) { return { i: r.item.id, q: needOf(r, oo) }; }))); }));
        if (openAtFn()) acts.appendChild(button(t("br.todo"), "", function () {
          sendTodo(t("br.todoList", { s: g.sup ? g.sup.name : t("order.noSup") }), want.map(function (r) {
            return { text: lineText(r.item, needOf(r, oo)) };
          }));
        }));
        if (mailReady()) acts.appendChild(button(t("br.mail"), "", function () {
          var lines = want.map(function (r) { return { i: r.item.id, q: needOf(r, oo) }; });
          sendMail(g.sup ? g.sup.email : "", t("order.head", { s: g.sup ? g.sup.name : t("order.noSup"), d: fmtDay(todayYmd(), true) }), mailBody(lines));
        }));
      }
      acts.appendChild(button(t("order.receive"), "", function () {
        moveEditor("in", g.rows.map(function (r) { return { i: r.item.id, q: C.suggestQty(r, decOf(r.item)) }; }), { sup: g.sup ? g.sup.id : "" });
      }));
      sec.appendChild(acts);
      box.appendChild(sec);
    });
  }
  // "5 pcs × Blue mug (MUG-1)": the supplier's code when there is one
  function lineText(it, q) {
    var code = it.ssku || it.sku;
    return fmtQ(q, it) + " × " + it.name + (code ? " (" + code + ")" : "");
  }
  function orderText(sup, lines) {
    var out = [t("order.head", { s: sup ? sup.name : t("order.noSup"), d: fmtDay(todayYmd(), true) })];
    lines.forEach(function (l) { var it = byId("items", l.i); if (it) out.push("- " + lineText(it, l.q)); });
    return out.join("\n");
  }
  function mailBody(lines, no) {
    var out = [t("po.mailHi"), "", t("po.mailAsk")];
    lines.forEach(function (l) { var it = byId("items", l.i); if (it) out.push("- " + lineText(it, l.q)); });
    out.push("", t("po.mailBye"));
    if (no) out.push(no);
    return out.join("\n");
  }
  function copyText(text) {
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

  // ----- Purchase orders -----
  function poTotal(po) {
    var sum = 0, any = false;
    po.lines.forEach(function (l) { if (typeof l.c === "number") { any = true; sum += Math.round(l.q * l.c / 1000); } });
    return any ? sum : null;
  }
  function poName(po) {
    var sup = byId("sups", po.sup);
    return (po.no || t("po.section")) + (sup ? " · " + sup.name : "");
  }
  function isLate(v, today) { return v.open && v.po.exp && v.po.exp < today; }
  function renderPos() {
    var box = $("po-list");
    box.innerHTML = "";
    var views = C.poViews(data), today = todayYmd();
    if (!views.length) return;               // the section comes with the first order
    var active = views.filter(function (v) { return v.state === "draft" || v.open; });
    var done = views.filter(function (v) { return !(v.state === "draft" || v.open); });
    var sec = el("div", "sec");
    var h = el("div", "sec-head");
    h.appendChild(el("h2", "", t("po.section")));
    var nb = el("button", "txt-btn", "+ " + t("po.new"));
    nb.type = "button";
    nb.addEventListener("click", function () { poEditor(null, null); });
    h.appendChild(nb);
    sec.appendChild(h);
    var ul = el("ul", "rows");
    if (!active.length) ul.appendChild(el("li", "muted pad", t("po.none")));
    active.concat(prefs.poAll ? done : []).forEach(function (v) { ul.appendChild(poRow(v, today)); });
    sec.appendChild(ul);
    if (done.length) {
      var tg = el("button", "txt-btn", prefs.poAll ? t("po.hideDone") : t("po.showDone", { n: done.length }));
      tg.type = "button";
      tg.addEventListener("click", function () { prefs.poAll = !prefs.poAll; savePrefs(); renderPos(); });
      sec.appendChild(tg);
    }
    box.appendChild(sec);
  }
  function poRow(v, today) {
    var po = v.po, li = el("li");
    var b = el("button", "row row-btn po-" + v.state + (isLate(v, today) ? " lvl-low" : ""));
    b.type = "button";
    b.appendChild(el("span", "r-ico", "🧾"));
    var body = el("span", "r-body");
    body.appendChild(el("span", "r-name", poName(po)));
    var s = el("span", "r-sub");
    s.appendChild(el("span", "badge st-" + v.state, t("st." + v.state)));
    s.appendChild(el("span", "", fmtDay(po.d)));
    if (v.open && po.exp) s.appendChild(el("span", isLate(v, today) ? "warn-txt" : "", t("po.dueOn", { d: fmtDay(po.exp) }) + (isLate(v, today) ? " · " + t("po.late") : "")));
    s.appendChild(el("span", "", tn("lines", po.lines.length)));
    body.appendChild(s);
    b.appendChild(body);
    var tot = poTotal(po);
    b.appendChild(el("span", "r-val", tot === null ? "" : money(tot)));
    b.addEventListener("click", function () { poSheet(po.id); });
    li.appendChild(b);
    return li;
  }
  function setPoSt(id, st) {
    var cur = byId("pos", id);
    if (!cur || cur.st === st) return;
    cur.st = st;
    stamp(cur);
    save();
    render();
  }
  function poSheet(id) {
    var po = byId("pos", id);
    if (!po) return;
    var v = C.poView(data, po), sup = byId("sups", po.sup), today = todayYmd();
    var dlg = makeDialog("st-po-sheet", true);
    dlg.appendChild(el("div", "dlg-title", "🧾 " + (po.no || t("po.section"))));
    var st = el("p", "");
    st.appendChild(el("span", "badge st-" + v.state, t("st." + v.state)));
    if (isLate(v, today)) st.appendChild(el("span", "badge warn", t("po.late")));
    dlg.appendChild(st);
    var box = el("div", "kvs");
    if (sup) kv(box, t("po.sup"), sup.name);
    kv(box, t("po.date"), fmtDay(po.d, true));
    if (po.exp) kv(box, t("po.exp"), fmtDay(po.exp, true));
    var tot = poTotal(po);
    if (tot !== null) kv(box, t("po.total"), money(tot));
    dlg.appendChild(box);
    dlg.appendChild(el("div", "dlg-lbl", t("po.lines")));
    var ul = el("ul", "rows");
    v.lines.forEach(function (l) {
      var it = byId("items", l.i), li = el("li");
      var b = el("button", "row row-btn compact");
      b.type = "button";
      var body = el("span", "r-body");
      body.appendChild(el("span", "r-name", it ? it.name : "?"));
      var s = el("span", "r-sub");
      if (it && (it.ssku || it.sku)) s.appendChild(el("span", "", it.ssku || it.sku));
      s.appendChild(el("span", "", t("po.ordered", { q: fmtQ(l.q, it, true) })));
      if (l.got) s.appendChild(el("span", "", t("po.got", { q: fmtQ(l.got, it, true) })));
      if (typeof l.c === "number") s.appendChild(el("span", "", money(l.c) + " / " + unitLabel(it ? it.unit : "pcs")));
      body.appendChild(s);
      b.appendChild(body);
      b.appendChild(el("span", "r-val", l.left > 0 && v.state !== "closed" && v.state !== "cancel" ? t("po.left", { q: fmtQ(l.left, it) }) : (l.got >= l.q ? "✓" : "")));
      if (it) b.addEventListener("click", function () { dlg.close(); itemSheet(it.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var src = C.poSrc(po.id);
    var rec = data.moves.filter(function (m) { return m.src === src; })
      .sort(function (x, y) { return cmpStr(y.d, x.d) || cmpStr(y.id, x.id); });
    if (rec.length) {
      dlg.appendChild(el("div", "dlg-lbl", t("po.receipts")));
      var ru = el("ul", "rows");
      rec.forEach(function (m) {
        var li = el("li");
        var b = el("button", "row row-btn compact" + (m.v === 1 ? " voided" : ""));
        b.type = "button";
        b.appendChild(el("span", "r-ico", T_ICON[m.t]));
        var body = el("span", "r-body");
        body.appendChild(el("span", "r-name", fmtDay(m.d, true) + (m.ref ? " · " + m.ref : "")));
        var s = el("span", "r-sub");
        s.appendChild(el("span", "", tn("lines", m.lines.length)));
        if (m.v === 1) s.appendChild(el("span", "badge", t("voided")));
        body.appendChild(s);
        b.appendChild(body);
        b.addEventListener("click", function () { dlg.close(); moveSheet(m.id); });
        li.appendChild(b);
        ru.appendChild(li);
      });
      dlg.appendChild(ru);
    }
    if (po.note) dlg.appendChild(el("p", "notes", po.note));

    var left = v.lines.filter(function (l) { return l.left > 0; });
    var acts = el("div", "dlg-actions wrap");
    if (v.state !== "closed" && v.state !== "cancel" && left.length) {
      acts.appendChild(button(t("po.receive"), "primary", function () {
        dlg.close();
        moveEditor("in", left.map(function (l) { return { i: l.i, q: l.left, c: l.c }; }), {
          sup: po.sup, ref: po.no, src: src,
          onSaved: function () { var cur = byId("pos", po.id); if (cur && cur.st === "draft") { cur.st = "sent"; stamp(cur); save(); } }
        });
      }));
    }
    if (po.st === "draft") acts.appendChild(button(t("po.markSent"), "", function () { dlg.close(); setPoSt(po.id, "sent"); showToast(t("toast.saved")); }));
    var pending = (left.length ? left : v.lines).map(function (l) { return { i: l.i, q: l.left > 0 ? l.left : l.q }; });
    if (mailReady()) acts.appendChild(button(t("br.mail"), "", function () {
      dlg.close();
      sendMail(sup ? sup.email : "", t("po.mailSubject", { no: po.no || "" }).trim(), mailBody(pending, po.no));
    }));
    acts.appendChild(button(t("order.copy"), "", function () { copyText(orderText(sup, pending) + (po.no ? "\n" + po.no : "")); }));
    if (openAtFn()) acts.appendChild(button(t("br.todo"), "", function () {
      dlg.close();
      sendTodo(t("br.todoList", { s: sup ? sup.name : (po.no || t("order.noSup")) }), pending.map(function (l) {
        var it = byId("items", l.i);
        return it ? { text: lineText(it, l.q), note: po.no } : null;
      }).filter(Boolean));
    }));
    if (v.state !== "closed" && v.state !== "cancel" && v.state !== "received") {
      acts.appendChild(button(t("sheet.edit"), "", function () { dlg.close(); poEditor(po, null); }));
    }
    if (v.open) acts.appendChild(button(t("po.close"), "", function () {
      confirmDialog(t("po.closeQ"), t("po.close"), false, function () { dlg.close(); setPoSt(po.id, "closed"); });
    }));
    if (po.st === "closed" || (po.st === "cancel" && !v.got)) acts.appendChild(button(t("po.reopen"), "", function () { dlg.close(); setPoSt(po.id, "sent"); }));
    if (!v.got && (po.st === "draft" || po.st === "sent")) acts.appendChild(button(t("po.cancel"), "danger", function () {
      confirmDialog(t("po.cancelQ"), t("po.cancel"), true, function () { dlg.close(); setPoSt(po.id, "cancel"); });
    }));
    if (!rec.length && (po.st === "draft" || po.st === "cancel")) acts.appendChild(button(t("ed.delete"), "danger", function () {
      confirmDialog(t("po.delQ"), t("ed.delete"), true, function () { dlg.close(); removeRow("pos", po); });
    }));
    dlg.appendChild(acts);
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(close);
    showDialog(dlg);
  }

  // A product finder (search or scan) with a list of lines: quantity
  // plus one money field. Used by the purchase order and the quote.
  //   o: { priceLabel, priceOf(item) → cents | 0, idp (id prefix) }
  function linePicker(dlg, o) {
    var lines = [];                 // { i, it, qIn, cIn, li }
    dlg.appendChild(el("div", "dlg-lbl", t("mv.add")));
    var finder = el("input");
    finder.type = "search";
    finder.placeholder = t("mv.addPh");
    finder.autocomplete = "off";
    finder.spellcheck = false;
    finder.setAttribute("enterkeyhint", "done");
    finder.setAttribute("aria-label", t("mv.add"));
    dlg.appendChild(withCam(finder, true));
    var hits = el("div", "hits");
    dlg.appendChild(hits);
    var box = el("ul", "lines");
    dlg.appendChild(box);
    var totalP = el("p", "total");
    totalP.hidden = true;
    dlg.appendChild(totalP);

    function refresh() {
      var total = 0, any = false;
      lines.forEach(function (ln) {
        var q = readQty(ln.qIn, ln.it), c = readCents(ln.cIn);
        if (q && c) { total += Math.round(q * c / 1000); any = true; }
      });
      totalP.textContent = any ? t("mv.total") + ": " + money(total) : "";
      totalP.hidden = !any;
    }
    function add(itemId, q, c, focusQty) {
      var it = byId("items", itemId);
      if (!it) return;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].i === itemId) {
          var now = readQty(lines[i].qIn, it);
          lines[i].qIn.value = qtyStr((now === null ? 0 : now) + (q || (o.whole ? 1000 : Math.pow(10, 3 - decOf(it)))), it);
          refresh();
          live(t("mv.lineMore", { n: it.name, q: lines[i].qIn.value }));
          return;
        }
      }
      var ln = { i: itemId, it: it };
      var li = el("li", "line");
      var head = el("div", "line-head");
      var nm = el("div", "line-name");
      nm.appendChild(el("span", "r-name", it.name));
      var r = rowOf(it.id) || { q: 0 };
      nm.appendChild(el("span", "muted line-sub", [it.ssku || it.sku, t("mv.now", { q: fmtQ(r.q, it) })].filter(Boolean).join(" · ")));
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
      ln.qIn = numInput(q ? qtyStr(q, it) : "");
      var pc = typeof c === "number" ? c : o.priceOf(it);
      ln.cIn = numInput(pc ? centsStr(pc) : "");
      row.appendChild(field(o.qtyLabel || (t("mv.qty") + " (" + unitLabel(it.unit) + ")"), ln.qIn, o.idp + "-q-" + itemId));
      row.appendChild(field(o.priceLabel + " (" + curSym() + ")", ln.cIn, o.idp + "-c-" + itemId));
      li.appendChild(row);
      ln.li = li;
      ln.qIn.addEventListener("input", refresh);
      ln.cIn.addEventListener("input", refresh);
      [ln.qIn, ln.cIn].forEach(function (inp) {
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); finder.focus(); } });
      });
      lines.push(ln);
      box.appendChild(li);
      refresh();
      if (focusQty) ln.qIn.focus();
      live(t("mv.lineAdded", { n: it.name }));
    }
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
        b.addEventListener("click", function () { finder.value = ""; hits.innerHTML = ""; add(it.id, 0, undefined, true); });
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
      if (!it) { var list = findHits(q); if (list.length === 1) it = list[0]; }
      if (it) {
        finder.value = "";
        hits.innerHTML = "";
        add(it.id, o.whole ? 1000 : Math.pow(10, 3 - decOf(it)), undefined, false);   // a scan adds one unit
        finder.focus();
      } else showHits();
    });
    // → { lines: [{ i, q, c? }] } or { bad: message, at: input }
    function read() {
      if (!lines.length) return { bad: t("po.noLines"), at: finder };
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i], q = readQty(ln.qIn, ln.it);
        if (!q || q <= 0 || (o.whole && q % 1000)) return { bad: t("mv.badLine", { n: ln.it.name }), at: ln.qIn };
        var line = { i: ln.i, q: q };
        if (ln.cIn.value.trim()) {
          var c = readCents(ln.cIn);
          if (c === null) return { bad: t("ed.badNum"), at: ln.cIn };
          line.c = c;
        }
        out.push(line);
      }
      return { lines: out };
    }
    return { add: add, read: read, finder: finder, count: function () { return lines.length; } };
  }

  function poEditor(po, preset) {
    var pr = preset || {}, isNew = !po, today = todayYmd();
    var dlg = makeDialog("st-po", true);
    dlg.appendChild(el("div", "dlg-title", isNew ? t("po.new") : t("po.edit")));
    var r1 = el("div", "fld-row");
    var no = textInput(po ? po.no : C.poNext(data, today), C.REF_LEN, "");
    var supSel = listSelect("sups", po ? po.sup : (pr.sup || ""), t("ed.newSup"), newSupQuick);
    r1.appendChild(field(t("po.no"), no, "st-po-no"));
    r1.appendChild(field(t("po.sup"), supSel, "st-po-sup"));
    dlg.appendChild(r1);
    var r2 = el("div", "fld-row");
    var d = el("input");
    d.type = "date";
    d.value = po ? po.d : today;
    var exp = el("input");
    exp.type = "date";
    function leadExp() {
      var s = byId("sups", supSel.value);
      return s && s.lead && C.isYmd(d.value) ? C.addDays(d.value, s.lead) : "";
    }
    exp.value = po ? po.exp : leadExp();
    var expTouched = !!(po && po.exp);
    exp.addEventListener("input", function () { expTouched = true; });
    function autoExp() { if (!expTouched) exp.value = leadExp(); }
    supSel.addEventListener("change", autoExp);
    d.addEventListener("change", autoExp);
    r2.appendChild(field(t("po.date"), d, "st-po-d"));
    r2.appendChild(field(t("po.exp"), exp, "st-po-exp"));
    dlg.appendChild(r2);
    var lp = linePicker(dlg, { priceLabel: t("mv.cost"), priceOf: function (it) { return it.cost; }, idp: "st-po" });
    (po ? po.lines : (pr.lines || [])).forEach(function (l) { lp.add(l.i, l.q, l.c, false); });
    var note = textarea(po ? po.note : "", C.MNOTE_LEN);
    dlg.appendChild(field(t("po.note"), note, "st-po-note"));
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    if (isNew) {
      acts.appendChild(button(t("po.saveDraft"), "", function () { trySave("draft"); }));
      acts.appendChild(button(t("po.saveSent"), "primary", function () { trySave("sent"); }));
    } else acts.appendChild(button(t("ed.save"), "primary", function () { trySave(po.st); }));
    dlg.appendChild(acts);
    function trySave(st) {
      err.hidden = true;
      if (!C.isYmd(d.value) || (exp.value && !C.isYmd(exp.value))) { err.textContent = t("ed.badNum"); err.hidden = false; return; }
      var r = lp.read();
      if (r.bad) { err.textContent = r.bad; err.hidden = false; if (r.at) r.at.focus(); return; }
      var row = C.normPo({
        id: po ? po.id : newId(), m: po ? po.m : Date.now(), no: no.value, sup: supSel.value,
        d: d.value, exp: exp.value, st: st, note: note.value, lines: r.lines
      });
      if (!row) { err.textContent = t("ed.badNum"); err.hidden = false; return; }
      var res = upsert("pos", row);
      if (res) save();
      dlg.close();
      render();
      if (res) showToast(isNew ? t("toast.added") : t("toast.saved"));
      if (isNew) setTab("order");
    }
    showDialog(dlg);
    if (lp.count()) no.focus(); else lp.finder.focus();
  }

  // ----- Bridges to other apps. All of them are PREFILLS: nothing is
  // written in the other app until the user saves there. -----
  function shellWin() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function openAtFn() {
    var p = shellWin();
    try { return p && typeof p.__orosOpenAt === "function" ? p : null; } catch (e) { return null; }
  }
  // Mail compose only when Mail has an account on this device
  function mailReady() {
    if (!openAtFn()) return false;
    var d = readOther("oros-mail-data");
    return !!(d && Array.isArray(d.accounts) && d.accounts.length);
  }
  function sendTodo(newList, items) {
    var p = openAtFn();
    if (!p || !items.length) return;
    p.__orosOpenAt("todo", { addItems: { newList: newList.slice(0, 60), from: t("app"), items: items.slice(0, 200) } });
  }
  function sendMail(to, subject, body) {
    var p = openAtFn();
    if (!p) return;
    p.__orosOpenAt("mail", { compose: { to: to || "", subject: subject.slice(0, 300), body: body.slice(0, 20000) } });
  }
  function budgetReady() {
    var p = shellWin();
    try { return !!(p && typeof p.__orosOpenBudgetNew === "function"); } catch (e) { return false; }
  }
  // A receipt is an expense, a sale an income; amount = the movement total.
  function sendBudget(mv) {
    var p = shellWin(), tot = moveTotal(mv), sup = byId("sups", mv.sup);
    if (!budgetReady() || !tot) return;
    var n = [sup ? sup.name : "", mv.ref || t("t." + mv.t)].filter(Boolean).join(" · ");
    var ok = p.__orosOpenBudgetNew({
      k: mv.t === "in" ? "o" : "i", a: tot, d: mv.d, n: n,
      c: mv.t === "in" ? "o-other" : "i-other", src: "stock"
    });
    if (ok === false) showToast(t("ed.badNum"));
  }
  function quoteReady() {
    var p = shellWin();
    try { return !!(p && typeof p.__orosOpenQuoteNew === "function"); } catch (e) { return false; }
  }
  function quoteDialog(preset) {
    var cur = data.settings.cur;
    if (!/^[A-Z]{3}$/.test(String(cur || ""))) { showToast(t("br.quoteCur", { c: cur })); return; }
    var dlg = makeDialog("st-quote", true);
    dlg.appendChild(el("div", "dlg-title", t("br.quoteTitle")));
    var lp = linePicker(dlg, { priceLabel: t("mv.price"), priceOf: function (it) { return it.price; }, idp: "st-qt" });
    (preset || []).forEach(function (l) { lp.add(l.i, l.q, undefined, false); });
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("br.quoteGo"), "primary", function () {
      var r = lp.read();
      if (r.bad) { err.textContent = r.bad; err.hidden = false; if (r.at) r.at.focus(); return; }
      var items = r.lines.slice(0, 50).map(function (l) {
        var it = byId("items", l.i);
        return {
          d: (it.name + (it.sku ? " · " + it.sku : "")).slice(0, 200),
          q: Math.min(100000, Math.round(l.q / 10) / 100),
          p: Math.min(10000000, Math.round(l.c || 0) / 100)
        };
      }).filter(function (x) { return x.q > 0; });
      if (!items.length) { err.textContent = t("po.noLines"); err.hidden = false; return; }
      var p = shellWin(), ok = false;
      try { ok = p.__orosOpenQuoteNew({ items: items, cur: cur }); } catch (e) { ok = false; }
      if (ok === false) { err.textContent = t("ed.badNum"); err.hidden = false; return; }
      dlg.close();
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    if (!lp.count()) lp.finder.focus();
  }

  // ---------- 6b. Reports view ----------
  function repTable(R) {
    var ps = C.periodSummary(data, R.from, R.to), by = Object.create(null);
    ps.rows.forEach(function (r) { by[r.i] = r; });
    return rows().list.filter(function (r) { return !r.item.arch || by[r.item.id]; })
      .sort(function (a, b) { return a.item.name.localeCompare(b.item.name, LOCALE) || cmpStr(a.item.id, b.item.id); })
      .map(function (r) {
        var p = by[r.item.id] || { inQ: 0, outQ: 0, lossQ: 0, sales: 0 };
        return [r.item.name, r.item.sku, r.q / 1000, Math.round(r.avg) / 100, r.value / 100,
                p.inQ / 1000, p.outQ / 1000, p.lossQ / 1000, p.sales / 100];
      });
  }
  function repHead() {
    var cur = " (" + data.settings.cur + ")";
    return [t("rep.h.name"), t("rep.h.sku"), t("rep.h.qty"), t("rep.h.avg") + cur, t("rep.h.value") + cur,
            t("rep.h.in"), t("rep.h.out"), t("rep.h.loss"), t("rep.h.sales") + cur];
  }
  function renderReports() {
    var sel = $("rep-range");
    sel.innerHTML = "";
    RANGES.forEach(function (k) {
      var o = el("option", "", t("r." + k));
      o.value = k;
      sel.appendChild(o);
    });
    sel.value = prefs.rr;
    var today = todayYmd(), R = C.reportRange(prefs.rr, today);
    var vc = C.valueByCat(data), ps = C.periodSummary(data, R.from, R.to), dead = C.deadStock(data, today, 90);
    var tiles = $("rep-tiles");
    tiles.innerHTML = "";
    tiles.appendChild(tile(t("rep.value"), money(vc.total), null));
    tiles.appendChild(tile(t("rep.sales"), money(ps.sales), null));
    tiles.appendChild(tile(t("rep.buys"), money(ps.buys), null));
    tiles.appendChild(tile(t("rep.losses"), money(ps.lossValue), null, ps.lossValue ? "warn" : ""));
    var acts = $("rep-acts");
    acts.innerHTML = "";
    if (openAtFn()) acts.appendChild(button(t("br.sheet"), "", function () {
      var rowsT = repTable(R), max = 499;
      if (rowsT.length > max) showToast(t("rep.cut", { n: max }));
      openAtFn().__orosOpenAt("spreadsheet", { newSheet: { name: t("rep.sheetName") + " " + today, rows: [repHead()].concat(rowsT.slice(0, max)), sum: [4, 8] } });
    }));
    acts.appendChild(button(t("rep.csv"), "", function () {
      saveText(csvText(repHead(), repTable(R)), "orOS-stock-report-" + today + ".csv", "text/csv", "CSV", ".csv");
    }));

    var body = $("rep-body");
    body.innerHTML = "";
    // value by category
    var s1 = el("div", "sec");
    s1.appendChild(el("h2", "sec-title", t("rep.byCat")));
    var u1 = el("ul", "rows");
    if (!vc.rows.length) u1.appendChild(el("li", "muted pad", t("rep.none")));
    vc.rows.forEach(function (r) {
      var cat = byId("cats", r.cat), li = el("li");
      var row = el("div", "row compact");
      var b = el("span", "r-body");
      b.appendChild(el("span", "r-name", cat ? cat.name : t("f.noCat")));
      var sub = el("span", "r-sub");
      sub.appendChild(el("span", "", tn("sups.items", r.n)));
      if (vc.total) sub.appendChild(el("span", "", Math.round(r.value * 100 / vc.total) + "%"));
      b.appendChild(sub);
      row.appendChild(b);
      row.appendChild(el("span", "r-val", money(r.value)));
      li.appendChild(row);
      u1.appendChild(li);
    });
    s1.appendChild(u1);
    body.appendChild(s1);
    // value per warehouse (several warehouses): positive quantities at
    // the average cost, like the stock value
    if (multiWh()) {
      var sw = el("div", "sec");
      sw.appendChild(el("h2", "sec-title", t("wh.value")));
      var uw = el("ul", "rows"), all = whAll(), vals = Object.create(null);
      rows().list.forEach(function (r) {
        var per = all[r.item.id] || {};
        Object.keys(per).forEach(function (w) { if (per[w] > 0) vals[w] = (vals[w] || 0) + Math.round(per[w] * r.avg / 1000); });
      });
      [""].concat(extraWhs(true).map(function (w) { return w.id; })).forEach(function (w) {
        var wh = byId("whs", w);
        if (w && wh && wh.arch && !vals[w]) return;
        var li = el("li"), row = el("div", "row compact");
        row.appendChild(el("span", "r-body r-name", whLabel(w)));
        row.appendChild(el("span", "r-val", money(vals[w] || 0)));
        li.appendChild(row);
        uw.appendChild(li);
      });
      sw.appendChild(uw);
      body.appendChild(sw);
    }
    // lots that expire soon (or did, with stock left)
    if (Object.keys(lotsAll()).some(function (i) { return lotsAll()[i].lots.length; })) {
      var se = el("div", "sec");
      se.appendChild(el("h2", "sec-title", t("lot.rep")));
      var ue = el("ul", "rows"), tdy = todayYmd();
      if (!soonList().length) ue.appendChild(el("li", "muted pad", t("lot.repNone")));
      soonList().forEach(function (x) {
        var li = el("li"), b = el("button", "row row-btn compact" + (x.exp < tdy ? " lvl-out" : " lvl-low"));
        b.type = "button";
        var bd = el("span", "r-body");
        bd.appendChild(el("span", "r-name", x.item.name));
        var sb = el("span", "r-sub");
        sb.appendChild(el("span", "", t("lot.line", { l: x.lot, d: fmtDay(x.exp, true) })));
        if (x.exp < tdy) sb.appendChild(el("span", "badge", t("lot.expired")));
        bd.appendChild(sb);
        b.appendChild(bd);
        b.appendChild(el("span", "r-val" + (x.exp < tdy ? " bad" : " warn"), fmtQ(x.q, x.item)));
        b.addEventListener("click", function () { itemSheet(x.item.id); });
        li.appendChild(b);
        ue.appendChild(li);
      });
      se.appendChild(ue);
      body.appendChild(se);
    }
    // most sold in the period
    var s2 = el("div", "sec");
    s2.appendChild(el("h2", "sec-title", t("rep.top") + " · " + t("r." + prefs.rr)));
    var u2 = el("ul", "rows"), top = ps.rows.filter(function (r) { return r.outQ > 0 && byId("items", r.i); }).slice(0, 10);
    if (!top.length) u2.appendChild(el("li", "muted pad", t("rep.none")));
    top.forEach(function (r) {
      var it = byId("items", r.i);
      u2.appendChild(itemLine(it, [t("rep.sold", { q: fmtQ(r.outQ, it) })], r.sales ? money(r.sales) : ""));
    });
    s2.appendChild(u2);
    body.appendChild(s2);
    // dead stock
    var s3 = el("div", "sec");
    s3.appendChild(el("h2", "sec-title", t("rep.dead")));
    var u3 = el("ul", "rows");
    if (!dead.length) u3.appendChild(el("li", "muted pad", t("rep.noDead")));
    dead.slice(0, 20).forEach(function (x) {
      var it = x.row.item;
      u3.appendChild(itemLine(it, [fmtQ(x.row.q, it), x.last ? t("rep.lastSale", { d: fmtDay(x.last, true) }) : t("rep.never")], money(x.row.value)));
    });
    s3.appendChild(u3);
    body.appendChild(s3);
  }
  function itemLine(it, subs, val) {
    var li = el("li");
    var b = el("button", "row row-btn compact");
    b.type = "button";
    var body = el("span", "r-body");
    body.appendChild(el("span", "r-name", it.name));
    var s = el("span", "r-sub");
    if (it.sku) s.appendChild(el("span", "", it.sku));
    subs.forEach(function (x) { if (x) s.appendChild(el("span", "", x)); });
    body.appendChild(s);
    b.appendChild(body);
    b.appendChild(el("span", "r-val", val || ""));
    b.addEventListener("click", function () { itemSheet(it.id); });
    li.appendChild(b);
    return li;
  }

  // ---------- 6c. Counter (quick sale with a scanner) ----------
  // The open sale lives in this page only (closing the counter keeps
  // it until "Complete sale" or "Clear"); nothing is written before
  // Complete, which saves ONE sale movement at the products' prices.
  var cart = [];                       // [{ i, q }] thousandths
  function counter() {
    var dlg = makeDialog("st-counter", true);
    dlg.classList.add("counter-dlg");
    dlg.appendChild(el("div", "dlg-title", "🛒 " + t("ctr.title")));
    // several warehouses: the counter sells from this device's one
    var ctrWh = null;
    if (multiWh()) {
      ctrWh = whSelect(defWh());
      ctrWh.addEventListener("change", function () { prefs.wh = ctrWh.value; savePrefs(); paint(); });
      dlg.appendChild(field(t("wh.one"), ctrWh, "st-ctr-wh"));
    }
    function ctrQ(id) { return ctrWh ? qtyAt(id, ctrWh.value) : (rowOf(id) || { q: 0 }).q; }
    var scan = el("input");
    scan.type = "search";
    scan.id = "st-ctr-q";
    scan.className = "ctr-scan";
    scan.placeholder = t("ctr.ph");
    scan.autocomplete = "off";
    scan.spellcheck = false;
    scan.setAttribute("enterkeyhint", "done");
    scan.setAttribute("aria-label", t("ctr.ph"));
    dlg.appendChild(withCam(scan, true));
    var hits = el("div", "hits");
    dlg.appendChild(hits);
    var msg = el("p", "hint warn");
    msg.hidden = true;
    dlg.appendChild(msg);
    var ul = el("ul", "rows cart");
    dlg.appendChild(ul);
    var tot = el("p", "ctr-total");
    dlg.appendChild(tot);
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    var clearB = button(t("ctr.clear"), "", function () {
      if (!cart.length) return;
      confirmDialog(t("ctr.clearQ"), t("ctr.clear"), true, function () { cart = []; paint(); scan.focus(); });
    });
    var doneB = button(t("ctr.done"), "primary", function () { complete(false); });
    acts.appendChild(clearB);
    acts.appendChild(doneB);
    dlg.appendChild(acts);

    function step(it) { return Math.pow(10, 3 - decOf(it)); }
    function addItem(it, n) {
      msg.hidden = true;
      for (var i = 0; i < cart.length; i++) {
        if (cart[i].i === it.id) {
          cart[i].q += n;
          if (cart[i].q <= 0) cart.splice(i, 1);
          paint();
          live(it.name + ": " + (cart[i] ? fmtQ(cart[i].q, it) : "0"));
          return;
        }
      }
      if (n <= 0) return;
      cart.push({ i: it.id, q: n });
      paint();
      live(t("mv.lineAdded", { n: it.name }));
    }
    function total() {
      var sum = 0;
      cart.forEach(function (l) { var it = byId("items", l.i); if (it) sum += Math.round(l.q * it.price / 1000); });
      return sum;
    }
    function paint() {
      cart = cart.filter(function (l) { return byId("items", l.i); });
      ul.innerHTML = "";
      if (!cart.length) ul.appendChild(el("li", "muted pad", t("ctr.empty")));
      cart.forEach(function (l) {
        var it = byId("items", l.i), r = rowOf(it.id) || { q: 0 };
        var li = el("li", "row cart-line");
        var body = el("span", "r-body");
        body.appendChild(el("span", "r-name", it.name));
        var sub = el("span", "r-sub");
        if (it.sku) sub.appendChild(el("span", "", it.sku));
        sub.appendChild(el("span", "", it.price ? money(it.price) + " / " + unitLabel(it.unit) : t("ctr.noPrice")));
        sub.appendChild(el("span", "", ctrWh ? t("wh.here", { q: fmtQ(ctrQ(it.id), it) }) : t("mv.now", { q: fmtQ(r.q, it) })));
        body.appendChild(sub);
        li.appendChild(body);
        var qb = el("span", "ctr-q");
        var minus = el("button", "icon-btn ctr-btn", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", t("ctr.less") + ": " + it.name);
        minus.addEventListener("click", function () { addItem(it, -step(it)); });
        var plus = el("button", "icon-btn ctr-btn", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", t("ctr.more") + ": " + it.name);
        plus.addEventListener("click", function () { addItem(it, step(it)); });
        qb.appendChild(minus);
        qb.appendChild(el("span", "ctr-n", fmtQ(l.q, it, true)));
        qb.appendChild(plus);
        li.appendChild(qb);
        li.appendChild(el("span", "r-val", it.price ? money(Math.round(l.q * it.price / 1000)) : ""));
        ul.appendChild(li);
      });
      tot.textContent = t("mv.total") + ": " + money(total());
      doneB.disabled = !cart.length;
      clearB.disabled = !cart.length;
    }
    function findHits(q) {
      var words = C.fold(q).split(" ").filter(Boolean);
      if (!words.length) return [];
      return byName(data.items.filter(function (it) { return !it.arch && matchItem(it, words); })).slice(0, 6);
    }
    scan.addEventListener("input", function () {
      hits.innerHTML = "";
      var q = scan.value.trim();
      if (q.length < 2) return;
      findHits(q).forEach(function (it) {
        var b = el("button", "hit");
        b.type = "button";
        b.appendChild(el("span", "", it.name));
        if (it.sku) b.appendChild(el("span", "muted", it.sku));
        b.addEventListener("click", function () { scan.value = ""; hits.innerHTML = ""; addItem(it, step(it)); scan.focus(); });
        hits.appendChild(b);
      });
    });
    scan.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var q = scan.value.trim();
      if (!q) { if (cart.length && e.ctrlKey) complete(false); return; }
      var it = C.findByCode(data, q);
      if (!it) { var list = findHits(q); if (list.length === 1) it = list[0]; }
      scan.value = "";
      hits.innerHTML = "";
      if (it) addItem(it, step(it));
      else { msg.textContent = t("ctr.unknown", { c: q }); msg.hidden = false; }
    });
    function complete(force) {
      if (!cart.length) return;
      var lines = cart.map(function (l) {
        var it = byId("items", l.i), ln = { i: l.i, q: -l.q };
        if (it.price) ln.p = it.price;
        return ln;
      });
      if (!force) {
        var neg = lines.filter(function (l) { var q0 = ctrQ(l.i); return q0 + l.q < 0 && q0 + l.q < q0; })[0];
        if (neg) {
          var nit = byId("items", neg.i), after = ctrQ(neg.i) + neg.q;
          if (data.settings.neg === 0) { msg.textContent = t("mv.neg", { n: nit.name, q: fmtQ(after, nit) }) + " " + t("mv.negBlocked"); msg.hidden = false; return; }
          confirmDialog(t("mv.negQ", { n: nit.name, q: fmtQ(after, nit) }), t("mv.negSave"), false, function () { complete(true); });
          return;
        }
      }
      var sum = total();
      var mv = C.normMove({ id: newId(), m: Date.now(), d: todayYmd(), t: "out", ref: t("ctr.ref"), lines: lines, w: ctrWh ? ctrWh.value : undefined });
      if (!mv) return;
      addMove(mv);
      cart = [];
      render();
      paint();
      actionToast(t("ctr.sold", { t: money(sum) }), null, null, function () { voidMove(mv); });
      scan.focus();
    }
    showDialog(dlg);
    paint();
    scan.focus();
  }

  // ---------- 6d. Barcode labels (A4, printed from a hidden frame) ----------
  var LABELS_MAX = 240;              // ten sheets
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  // [{ it, n (copies), c (price cents or null) }] → { html, count, skipped }
  function labelsHtml(list, withPrice) {
    var cells = [], skipped = [];
    list.forEach(function (x) {
      var bc = C.barcodeFor(x.it);
      if (!bc) { skipped.push(x.it.name); return; }
      var cell = '<div class="l"><div class="n">' + esc(x.it.name) + '</div><div class="b">' + C.barSvg(bc.modules, 40) +
        '</div><div class="t"><span>' + esc(bc.text) + "</span>" +
        (withPrice && x.c ? '<b>' + esc(money(x.c)) + "</b>" : "") + "</div></div>";
      for (var k = 0; k < x.n && cells.length < LABELS_MAX; k++) cells.push(cell);
    });
    var pages = [];
    for (var i = 0; i < cells.length; i += 24) pages.push('<div class="sheet">' + cells.slice(i, i + 24).join("") + "</div>");
    var css = "@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff;color:#000}" +
      "body{font:9pt/1.2 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".sheet{width:210mm;height:296mm;padding:0 0 0 0;box-sizing:border-box;display:grid;grid-template-columns:repeat(3,70mm);grid-template-rows:repeat(8,37mm);page-break-after:always;break-after:page}" +
      ".sheet:last-child{page-break-after:auto;break-after:auto}" +
      ".l{box-sizing:border-box;padding:2.5mm 4mm;display:flex;flex-direction:column;overflow:hidden}" +
      ".n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".b{flex:1 1 auto;min-height:0;margin:1.5mm 0}.b svg{display:block;width:100%;height:100%}" +
      ".t{display:flex;justify-content:space-between;gap:2mm;font-family:'Courier New',monospace}.t b{font-family:Arial,sans-serif}";
    var html = '<!DOCTYPE html><html lang="' + LANG + '"><head><meta charset="utf-8"><title>' + esc(t("lbl.title")) +
      "</title><style>" + css + "</style></head><body>" + pages.join("") + "</body></html>";
    return { html: html, count: cells.length, skipped: skipped };
  }
  function printHtml(html) {
    var old = document.getElementById("st-print");
    if (old) old.remove();
    var fr = document.createElement("iframe");
    fr.id = "st-print";
    fr.setAttribute("aria-hidden", "true");
    fr.tabIndex = -1;
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    fr.addEventListener("load", function () {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { showToast(t("ed.badNum")); }
    }, { once: true });
    fr.srcdoc = html;
    document.body.appendChild(fr);
  }
  function labelsDialog(presetIds) {
    var dlg = makeDialog("st-labels", true);
    dlg.appendChild(el("div", "dlg-title", "🏷️ " + t("lbl.title")));
    dlg.appendChild(el("p", "hint", t("lbl.sheet") + ". " + t("lbl.hint")));
    var lp = linePicker(dlg, { priceLabel: t("lbl.price"), priceOf: function (it) { return it.price; }, idp: "st-lb", qtyLabel: t("lbl.copies"), whole: true });
    (presetIds || []).forEach(function (id) { lp.add(id, 1000, undefined, false); });
    var wp = checkRow(t("lbl.withPrice"), true);
    dlg.appendChild(wp);
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("lbl.print"), "primary", function () {
      err.hidden = true;
      var r = lp.read();
      if (r.bad) { err.textContent = r.bad; err.hidden = false; if (r.at) r.at.focus(); return; }
      var list = r.lines.map(function (l) {
        return { it: byId("items", l.i), n: Math.max(1, Math.round(l.q / 1000)), c: typeof l.c === "number" ? l.c : null };
      });
      var want = list.reduce(function (a, x) { return a + x.n; }, 0);
      var out = labelsHtml(list, wp.querySelector("input").checked);
      var notes = [];
      if (out.skipped.length) notes.push(t("lbl.skip", { n: out.skipped.join(", ") }));
      if (want > LABELS_MAX) notes.push(t("lbl.max", { n: LABELS_MAX }));
      if (!out.count) { err.textContent = notes.concat([t("lbl.none")]).join(" "); err.hidden = false; return; }
      if (notes.length) { err.textContent = notes.join(" "); err.hidden = false; }
      printHtml(out.html);
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    if (!lp.count()) lp.finder.focus();
  }

  // ---------- 6e. Product photos (files on the orOS disk) ----------
  // The slice keeps the file NAME only (list "pics", one row per item);
  // the JPEG lives in Files under Stock/Photos and travels with Vault
  // Drive. Re-drawn on a canvas (long side ≤ 1200 px, JPEG): no EXIF,
  // no location, no foreign bytes.
  var PIC_MAX_IN = 40 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function rnd6() {
    var a = new Uint8Array(6), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function encodePic(file) {
    return new Promise(function (resolve) {
      if (!file || file.size > PIC_MAX_IN) { resolve(null); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 1200 / Math.max(w, h || 1));
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? b : null); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function setPic(itemId, f) {
    var row = byId("pics", itemId), old = row ? row.f : "";
    if (old === f) return;
    if (!row) data.pics.push({ id: itemId, m: Date.now(), f: f });
    else { row.f = f; stamp(row); }
    save();
    if (old) dropPicLater(old);
  }
  // A file no live product points at leaves the disk after the Undo
  // window (a product deleted and brought back keeps its photo).
  function dropPicLater(name) {
    var fs = fsApi();
    if (!fs || !name) return;
    setTimeout(function () {
      if (C.picsInUse(data).indexOf(name) >= 0) return;
      Promise.resolve(fs.rm(C.picPath(name))).catch(function () {});
    }, 12000);
  }
  // The photo block of a product sheet (thumbnail + add / change / remove)
  function photoBox(it, dlg) {
    var fs = fsApi(), name = C.picOf(data, it.id);
    if (!fs && !name) return null;
    var box = el("div", "ph-box");
    var url = null;
    if (name) {
      var th = el("div", "ph-th");
      box.appendChild(th);
      if (fs) Promise.resolve(fs.readBlob(C.picPath(name))).then(function (b) {
        if (!b) throw new Error("ENOENT");
        url = URL.createObjectURL(b);
        var im = el("img");
        im.alt = it.name;
        im.src = url;
        th.appendChild(im);
      }).catch(function () { th.appendChild(el("span", "muted", t("ph.missing"))); });
      else th.appendChild(el("span", "muted", t("ph.missing")));
      dlg.addEventListener("close", function () { if (url) URL.revokeObjectURL(url); });
    }
    if (fs) {
      var acts = el("div", "ph-acts");
      acts.appendChild(button(name ? t("ph.change") : "📷 " + t("ph.add"), "", function () {
        pickFile("image/*").then(function (file) {
          if (!file) return;
          return encodePic(file).then(function (blob) {
            if (!blob) { showToast(t("ph.bad")); return; }
            var nm = C.picName(todayYmd(), it.id, rnd6());
            return Promise.resolve(fs.writeBlob(C.picPath(nm), blob)).then(function () {
              setPic(it.id, nm);
              dlg.close();
              itemSheet(it.id);
            });
          });
        }).catch(function () { showToast(t("ph.noDisk")); });
      }));
      if (name) acts.appendChild(button(t("ph.remove"), "danger", function () { setPic(it.id, ""); dlg.close(); itemSheet(it.id); }));
      box.appendChild(acts);
    }
    return box;
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
      b.appendChild(el("span", "r-val", tn("sups.items", count[s.id] || 0)));
      b.addEventListener("click", function () { supEditor(s); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var li2 = el("li");
    var add = el("button", "txt-btn", "+ " + t("sup.new"));
    add.type = "button";
    add.addEventListener("click", function () { supEditor(null); });
    li2.appendChild(add);
    if (window.OrosStockPriceList) {
      var plb = el("button", "txt-btn", "📄 " + plText("pl.sups"));
      plb.type = "button";
      plb.addEventListener("click", function () { openPriceList(""); });
      li2.appendChild(plb);
    }
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
  function askName(title, max, onOk, value) {
    var dlg = makeDialog("st-ask");
    dlg.appendChild(el("div", "dlg-title", title));
    var inp = textInput(value || "", max);
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
    var multi = multiWh() || type === "xfer";
    var tsel = selectInput(C.MOVE_TYPES.filter(function (k) { return k !== "xfer" || multi; })
      .map(function (k) { return [k, T_ICON[k] + " " + t("t." + k)]; }), type || "in");
    var date = el("input");
    date.type = "date";
    date.value = o.date && C.isYmd(o.date) ? o.date : todayYmd();
    date.max = C.addDays(todayYmd(), 1);
    if (data.close) {
      date.min = C.addDays(data.close.d, 1);
      if (date.value < date.min) date.value = todayYmd();
    }
    r1.appendChild(field(t("mv.type"), tsel, "st-mtype"));
    r1.appendChild(field(t("mv.date"), date, "st-mdate"));
    dlg.appendChild(r1);
    // where (several warehouses): this device's last one by default; a
    // transfer has From and To
    var wsel = null, w2sel = null, wFld = null, w2Fld = null;
    if (multi) {
      var rw = el("div", "fld-row");
      wsel = whSelect(o.w !== undefined ? o.w : defWh());
      w2sel = whSelect("");
      wFld = field(t("wh.one"), wsel, "st-mwh");
      w2Fld = field(t("wh.to"), w2sel, "st-mwh2");
      rw.appendChild(wFld);
      rw.appendChild(w2Fld);
      dlg.appendChild(rw);
      // a transfer's To starts at the first other warehouse
      var pickTo = function () {
        if (w2sel.value !== wsel.value) return;
        for (var oi = 0; oi < w2sel.options.length; oi++) {
          if (w2sel.options[oi].value !== wsel.value) { w2sel.value = w2sel.options[oi].value; return; }
        }
      };
      pickTo();
      wsel.addEventListener("change", function () { pickTo(); refresh(); });
      w2sel.addEventListener("change", refresh);
    }
    // the quantity that counts for this movement: the chosen warehouse's,
    // else the business total
    function baseQ(itemId) {
      if (wsel) return qtyAt(itemId, wsel.value);
      return (rowOf(itemId) || { q: 0 }).q;
    }
    var r2 = el("div", "fld-row");
    var ref = textInput(o.ref || "", C.REF_LEN, t("mv.refPh"));
    var supSel = listSelect("sups", o.sup || "", t("ed.newSup"), newSupQuick);
    var supFld = field(t("mv.sup"), supSel, "st-msup");
    r2.appendChild(field(t("mv.ref"), ref, "st-mref"));
    r2.appendChild(supFld);
    dlg.appendChild(r2);
    // asked for by another app (BR-ST-OUT): say where it came from, what
    // could not be matched, and whether it was already taken out once
    if (o.from) {
      var fromBox = el("div", "hint from-box");
      fromBox.appendChild(el("p", "", t("out.from", { a: o.from })));
      if (o.used) fromBox.appendChild(el("p", "warn", t(o.used === 1 ? "out.used1" : "out.used", { n: o.used })));
      if (o.miss && o.miss.length) {
        fromBox.appendChild(el("p", "warn", t("out.miss", { n: o.miss.length })));
        fromBox.appendChild(el("p", "muted miss-codes", o.miss.join(", ")));
      }
      dlg.appendChild(fromBox);
    }

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
      // lots (1.5): a receipt / customer return takes a lot and its
      // expiry (an expiry alone becomes the lot's name); a sale, a
      // return to supplier or a loss may name the lot that left (else
      // the first to expire goes)
      var names = C.lotNames(data, itemId);
      var lrow = el("div", "fld-row lot-row");
      var lotIn = textInput("", C.LOT_LEN, t("lot.ph"));
      if (names.length) {
        var dl = el("datalist");
        dl.id = "st-dl-" + itemId;
        names.slice(0, 30).forEach(function (n) { var op = el("option"); op.value = n; dl.appendChild(op); });
        lrow.appendChild(dl);
        lotIn.setAttribute("list", dl.id);
      }
      var expIn = el("input");
      expIn.type = "date";
      var left = C.lotsOf(data, itemId).lots;
      var lotSel = selectInput([["", t("lot.auto")]].concat(left.map(function (r) {
        return [r.lot, r.lot + (r.exp ? " · " + fmtDay(r.exp, true) : "") + " · " + fmtQ(r.q, it)];
      })), "");
      var lotF = field(t("lot.lot"), lotIn, "st-lot-" + itemId);
      var expF = field(t("lot.exp"), expIn, "st-exp-" + itemId);
      var lselF = field(t("lot.lot"), lotSel, "st-lsel-" + itemId);
      lrow.appendChild(lotF);
      lrow.appendChild(expF);
      lrow.appendChild(lselF);
      var lotLink = el("button", "link-btn lot-link", "+ " + t("lot.add"));
      lotLink.type = "button";
      lotLink.addEventListener("click", function () { ln.lotOpen = true; setLineMode(ln); lotIn.focus(); });
      li.appendChild(lotLink);
      li.appendChild(lrow);
      ln.lrow = lrow; ln.lotIn = lotIn; ln.expIn = expIn; ln.lotSel = lotSel;
      ln.lotF = lotF; ln.expF = expF; ln.lselF = lselF; ln.lotLink = lotLink;
      ln.hasLots = names.length > 0; ln.lotOpen = false; ln.hasLeft = left.length > 0;
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
      var inK = k === "in" || k === "ret", outK = k === "out" || k === "rts" || k === "loss";
      var showIn = inK && (ln.hasLots || ln.lotOpen);
      ln.lotF.hidden = !showIn;
      ln.expF.hidden = !showIn;
      ln.lselF.hidden = !(outK && ln.hasLeft);
      ln.lrow.hidden = ln.lotF.hidden && ln.lselF.hidden;
      ln.lotLink.hidden = !(inK && !showIn);
    }
    function refresh() {
      var k = cur(), total = 0, any = false;
      supFld.hidden = !(k === "in" || k === "rts");
      if (wFld) {
        wFld.querySelector("label").textContent = k === "xfer" ? t("wh.from") : t("wh.one");
        w2Fld.hidden = k !== "xfer";
      }
      lines.forEach(function (ln) {
        var it = ln.it, r = rowOf(it.id) || { q: 0 };
        var parts = [it.sku, t("mv.now", { q: fmtQ(r.q, it) })].filter(Boolean);
        if (wsel) parts.push(t("wh.here", { q: fmtQ(baseQ(it.id), it) }));
        if (k === "count") {
          var n = readQty(ln.qIn, it);
          if (n !== null && ln.qIn.value.trim()) parts.push(t("mv.diff", { d: fmtSigned(n - baseQ(it.id), it) }));
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

    (presetLines || []).forEach(function (p) {
      addLine(p.i, p.q || 0, false);
      var last = lines[lines.length - 1];
      if (last && last.i === p.i && typeof p.c === "number" && !last.cf.hidden) last.cIn.value = centsStr(p.c);
      if (last && last.i === p.i && typeof p.p === "number" && !last.cf.hidden) last.cIn.value = centsStr(p.p);
    });
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
      if (data.close && date.value <= data.close.d) { fail(t("cl.locked", { d: fmtDay(data.close.d, true) })); date.focus(); return; }
      if (!lines.length) { fail(t("mv.noLines")); finder.focus(); return; }
      if (k === "xfer" && (!w2sel || w2sel.value === wsel.value)) { fail(t("wh.same")); return; }
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i], it = ln.it;
        var v = readQty(ln.qIn, it, k === "fix");
        if (v === null || !ln.qIn.value.trim()) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
        var line = { i: it.id };
        if (k === "count") { line.q = v - baseQ(it.id); line.n = v; }
        else if (k === "fix") {
          if (v === 0) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
          line.q = v;
        } else {
          if (v === 0) { fail(t("mv.badLine", { n: it.name })); ln.qIn.focus(); return; }
          line.q = sign * Math.abs(v);
        }
        if (!ln.lotF.hidden) {
          var lv = C.cleanText(ln.lotIn.value, C.LOT_LEN, false), ev = C.isYmd(ln.expIn.value) ? ln.expIn.value : "";
          if (lv || ev) { line.lot = lv || ev; if (ev) line.exp = ev; }
        } else if (!ln.lselF.hidden && ln.lotSel.value) line.lot = ln.lotSel.value;
        if (k === "in" || k === "out") {
          var c = ln.cIn.value.trim() ? readCents(ln.cIn) : null;
          if (ln.cIn.value.trim() && c === null) { fail(t("ed.badNum")); ln.cIn.focus(); return; }
          if (c !== null) line[k === "in" ? "c" : "p"] = c;
        }
        out.push(line);
      }
      // below zero? (sums lines of one product too; with warehouses, in
      // the chosen one, the From one for a transfer)
      if (!forceNeg) {
        var after = Object.create(null);
        out.forEach(function (l) { after[l.i] = (after[l.i] === undefined ? baseQ(l.i) : after[l.i]) + (k === "xfer" ? -l.q : l.q); });
        var neg = Object.keys(after).filter(function (id) { return after[id] < 0 && after[id] < baseQ(id); })[0];
        if (neg) {
          var nit = byId("items", neg);
          if (data.settings.neg === 0) { fail(t("mv.neg", { n: nit.name, q: fmtQ(after[neg], nit) }) + " " + t("mv.negBlocked")); return; }
          confirmDialog(t("mv.negQ", { n: nit.name, q: fmtQ(after[neg], nit) }), t("mv.negSave"), false, function () { trySave(true); });
          return;
        }
      }
      var mv = C.normMove({
        id: newId(), m: Date.now(), d: date.value, t: k, ref: ref.value,
        sup: supSel.value, note: note.value, lines: out,
        // a receipt against a purchase order ("in"), or a sale / return
        // asked for by another app: kept only on the type it came with
        src: o.src && k === (o.srcT || "in") ? o.src : undefined,
        w: wsel ? wsel.value : undefined,
        w2: k === "xfer" && w2sel ? w2sel.value : undefined
      });
      if (!mv) { fail(t("ed.badNum")); return; }
      if (wsel && k !== "xfer" && prefs.wh !== wsel.value) { prefs.wh = wsel.value; savePrefs(); }
      addMove(mv);
      if (o.onSaved) o.onSaved(mv);
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
    if (!isNew && window.OrosStockPriceList) {
      var plw = el("div", "dlg-actions tight");
      plw.appendChild(button("📄 " + plText("pl.link"), "", function () { dlg.close(); openPriceList(x.id); }));
      dlg.insertBefore(plw, err);
    }
    if (!isNew) acts.appendChild(button(t("ed.delete"), "danger", function () {
      confirmDialog(t("sup.delQ"), t("ed.delete"), true, function () { dlg.close(); removeRow("sups", byId("sups", x.id) || x); });
    }));
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("ed.save"), "primary", function () {
      var ld = lead.value.trim() ? C.parseNum(lead.value.trim(), NUM) : 0;
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

  // ----- Closing a period -----
  // Archive first (the whole data as it is now, a JSON file in Files),
  // then replace the movements up to the day by the opening balance.
  // Nothing is closed when the file can't be written.
  function closeDialog() {
    var dlg = makeDialog("st-close");
    dlg.appendChild(el("div", "dlg-title", t("cl.title")));
    var cl = data.close, today = todayYmd();
    dlg.appendChild(el("p", "", cl ? t("cl.now", { d: fmtDay(cl.d, true) }) : t("cl.never")));
    var kb = 0;
    try { kb = Math.round((localStorage.getItem(STORAGE_KEY) || "").length / 1024); } catch (e) {}
    dlg.appendChild(el("p", "hint", t("cl.size", { kb: kb })));
    var d = el("input");
    d.type = "date";
    d.max = C.addDays(today, -1);
    if (cl) d.min = C.addDays(cl.d, 1);
    var lastDec = (Number(today.slice(0, 4)) - 1) + "-12-31";
    d.value = (!cl || lastDec > cl.d) ? lastDec : d.max;
    dlg.appendChild(field(t("cl.through"), d, "st-cl-d"));
    var info = el("p", "hint");
    dlg.appendChild(info);
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    var go = button(t("cl.go"), "danger-fill", function () { run(); });
    function upd() {
      var ci = C.closeInfo(data, d.value, today);
      info.textContent = ci.ok ? (ci.n ? tn("cl.info", ci.n) : t("cl.none")) : t("cl.bad");
      go.disabled = !ci.ok || !ci.n;
    }
    d.addEventListener("input", upd);
    d.addEventListener("change", upd);
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    if (cl && cl.f) acts.appendChild(button(t("cl.reopen"), "", function () {
      confirmDialog(t("cl.reopenQ"), t("cl.reopen"), true, function () { dlg.close(); reopenPeriod(); });
    }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    upd();
    function run() {
      var day = d.value, ci = C.closeInfo(data, day, todayYmd());
      if (!ci.ok || !ci.n) return;
      var fs = fsApi();
      if (!fs) { err.textContent = t("cl.noFs"); err.hidden = false; return; }
      confirmDialog(tn("cl.info", ci.n), t("cl.go"), true, function () {
        var name = "stock-until-" + day + "-" + rnd6() + ".json";
        var snap = canonical(data);
        var payload = { app: "oros-stock", ver: C.DATA_VER, exported: new Date().toISOString(), closedThrough: day, data: snap };
        var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        go.disabled = true;
        Promise.resolve(fs.writeBlob(C.archivePath(name), blob)).then(function () {
          var next = C.closePeriod(data, day, Date.now(), newId(), name);
          if (!next) throw new Error("close");
          data = next;
          save();
          render();
          dlg.close();
          showToast(t("cl.done", { d: fmtDay(day, true) }));
        }).catch(function () { err.textContent = t("cl.fail"); err.hidden = false; go.disabled = false; });
      });
    }
    showDialog(dlg);
  }
  // Reopen: tombstone the close, then merge the archived data back
  function reopenPeriod() {
    var cl = data.close, fs = fsApi();
    if (!cl || !cl.f || !fs) return;
    Promise.resolve(fs.readBlob(C.archivePath(cl.f))).then(function (b) {
      if (!b) throw new Error("missing");
      return b.text();
    }).then(function (text) {
      var p = JSON.parse(text);
      var arch = p && p.app === "oros-stock" && p.data && typeof p.data === "object" ? p.data : null;
      if (!arch) throw new Error("bad");
      var cur = data.close;
      if (!cur || cur.id !== cl.id) return;
      data.tombs[cl.id] = Math.max(Date.now(), cl.m);
      delete data.close;
      data = C.merge(canonical(data), arch);
      save();
      render();
      showToast(t("cl.reopened"));
    }).catch(function () { showToast(t("cl.noFile")); });
  }

  // ----- Warehouses -----
  // The main one can only be renamed (its row WH_MAIN holds the name).
  // Another one is archived, never deleted, once a movement used it.
  function whsDialog() {
    var dlg = makeDialog("st-whs");
    dlg.appendChild(el("div", "dlg-title", t("wh.title")));
    dlg.appendChild(el("p", "hint", t("wh.hint")));
    var ul = el("ul", "vlist");
    dlg.appendChild(ul);
    function setName(id, v) {
      var cur = byId("whs", id);
      if (cur) { if (cur.name !== v) { cur.name = v; stamp(cur); } }
      else data.whs.push({ id: id, m: Date.now(), name: v, arch: 0 });
      save(); render(); draw();
    }
    function used(id) { return data.moves.some(function (x) { return x.w === id || x.w2 === id; }); }
    function holds(id) { var a = whAll(); return Object.keys(a).some(function (i) { return a[i][id]; }); }
    function draw() {
      ul.innerHTML = "";
      [{ id: "", name: mainWh(), main: true }].concat(extraWhs(true)).forEach(function (w) {
        var li = el("li", "row");
        var nm = el("span", "r-body r-name", w.name);
        if (w.arch) nm.appendChild(el("span", "badge", t("wh.archived")));
        li.appendChild(nm);
        var ren = el("button", "link-btn", t("wh.rename"));
        ren.type = "button";
        ren.addEventListener("click", function () {
          askName(t("wh.name"), C.NAME_LEN, function (v) { setName(w.main ? C.WH_MAIN : w.id, v); }, w.name);
        });
        li.appendChild(ren);
        if (!w.main && !w.arch && window.OrosStockConsign) {
          var cn = el("button", "link-btn", C.consOf(data, w.id) ? consText("cons.title") : consText("cons.link"));
          cn.type = "button";
          cn.addEventListener("click", function () { window.OrosStockConsign.settings(consApi(draw), w.id); });
          li.appendChild(cn);
        }
        if (!w.main) {
          var useIt = used(w.id);
          var b2 = el("button", "link-btn" + (useIt && !w.arch ? "" : " danger"), w.arch ? t("wh.unarch") : (useIt ? t("wh.arch") : t("wh.del")));
          b2.type = "button";
          b2.addEventListener("click", function () {
            var cur = byId("whs", w.id);
            if (!cur) return;
            if (cur.arch) { cur.arch = 0; stamp(cur); save(); render(); draw(); return; }
            if (useIt) {
              var go = function () { cur.arch = 1; stamp(cur); if (prefs.wh === cur.id) prefs.wh = ""; save(); render(); draw(); };
              if (holds(w.id)) confirmDialog(t("wh.archQ"), t("wh.arch"), true, go); else go();
              return;
            }
            data.tombs[cur.id] = Math.max(Date.now(), cur.m);
            data.whs = data.whs.filter(function (x) { return x.id !== cur.id; });
            if (prefs.wh === cur.id) prefs.wh = "";
            save(); render(); draw();
          });
          li.appendChild(b2);
        }
        ul.appendChild(li);
      });
    }
    draw();
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("wh.new"), "", function () {
      if (data.whs.length >= 200) return;
      askName(t("wh.name"), C.NAME_LEN, function (v) { setName(newId(), v); });
    }));
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
     ["✏️", t("add.other"), function () { moveEditor("loss", []); }]].concat(multiWh() ? [["🔀", t("t.xfer"), function () { moveEditor("xfer", []); }]] : []).concat([
     ["🏪", t("add.pos"), openPos],
     ["🛒", t("add.counter"), counter],
     ["🧾", t("add.po"), function () { poEditor(null, null); }],
     ["🏷️", t("add.labels"), function () { labelsDialog(null); }],
     ["🏭", t("add.sup"), function () { supEditor(null); }]]).concat(shopReady() ? [["🛍️", t("add.shop"), openShop]] : []).concat(quoteReady() ? [["💬", t("add.quote"), function () { quoteDialog(null); }]] : []).forEach(function (a) {
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
    la.appendChild(button(t("wh.title"), "", function () { dlg.close(); whsDialog(); }));
    la.appendChild(button(t("cl.btn"), "", function () { dlg.close(); closeDialog(); }));
    dlg.appendChild(la);
    dlg.appendChild(el("div", "dlg-lbl", t("set.data")));
    var io = el("div", "dlg-actions tight wrap");
    if (shopReady()) io.appendChild(button("🛍️ " + t("add.shop"), "", function () { dlg.close(); openShop(); }));
    io.appendChild(button(window.OrosStockImport ? t("set.impCsv2") : t("set.impCsv"), "", function () { dlg.close(); importCsv(); }));
    io.appendChild(button(t("set.expCsv"), "", exportProducts));
    io.appendChild(button(t("set.expMoves"), "", exportMoves));
    io.appendChild(button(t("set.json"), "", exportData));
    io.appendChild(button(t("set.import"), "", importData));
    if (recFile) {
      [["st-osave", "set.osave", function () { recFile.save(); }],
       ["st-oopen", "set.oopen", function () { recFile.open(); }],
       ["st-ofolder", "set.ofolder", function () { recFile.openFolder(); }]].forEach(function (o) {
        var b = button(t(o[1]), "", function () { dlg.close(); o[2](); });
        b.id = o[0];
        io.appendChild(b);
      });
    }
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
    // English or Greek, like the headers: core.importPlan reads those words back
    C.UNIT_IDS.forEach(function (u) { n[u] = C.unitName(u, LANG === "el" ? "el" : "en"); });
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
    var wh = extraWhs(true).length > 0;
    if (wh) head = head.concat(LANG === "el" ? ["Αποθήκη", "Προς αποθήκη"] : ["Warehouse", "To warehouse"]);
    var withLots = data.moves.some(function (x) { return x.lines.some(function (l) { return l.lot; }); });
    if (withLots) head = head.concat(LANG === "el" ? ["Παρτίδα", "Λήξη"] : ["Lot", "Expiry"]);
    saveText(csvText(head, C.csvMoves(data, names, wh ? mainWh() : undefined, withLots)), "orOS-stock-movements-" + todayYmd() + ".csv", "text/csv", "CSV", ".csv");
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
  // .orosstock (OBF-4e): products, suppliers, orders, warehouses,
  // movements and the till's receipts as one orOS file
  // (../recordpkg.js + package.js), product photos in media/. Opening
  // ADDS what this device lacks, with its ids, through core.merge; a
  // row already here (or deleted here) is kept as it is unless "Update
  // with newer versions" is ticked. The result goes through save (so
  // sync carries it). Undo the app's way (package.js undo): movements
  // and receipts voided, a product with movements archived, the rest
  // tombstoned. Photos are read from Files › Stock/Photos only (never
  // the Archive folder) and, on open, re-drawn like an added photo.
  var RP = window.OrosRecordPkg || null, SPK = window.OrosStockPackage || null;
  var recFile = RP && SPK && window.OrosBundle ? RP.ui(SPK.DESC, {
    lang: function () { return LANG === "el" ? "el" : "en"; },
    get: function () { return canonical(data); },
    title: function () { return t("app"); },
    // the photos' bytes: media/<sha256>.jpg, each row told its key
    files: function (state) {
      var fs = fsApi(), B = window.OrosBundle, out = [], seen = {}, chain = Promise.resolve();
      (state.pics || []).forEach(function (p) {
        if (!p.f) return;
        chain = chain.then(function () {
          var path = C.picPath(p.f);
          if (!fs || !path) { p.drop = 1; return; }
          return Promise.resolve(fs.readBlob(path)).then(function (b) {
            if (!b || !b.size) throw new Error("ENOENT");
            return B.digest(b).then(function (x) {
              var k = x.sha + ".jpg";
              p.key = k;
              if (!seen[k]) { seen[k] = 1; out.push({ key: k, blob: b, type: "image/jpeg" }); }
            });
          }).catch(function () { p.drop = 1; });
        });
      });
      return chain.then(function () {
        state.pics = (state.pics || []).filter(function (p) { return !p.drop; });
        return out;
      });
    },
    // the photos of the rows this file adds (or updates) → Files, the
    // way an added photo is stored (re-drawn as a JPEG); a file already
    // there is not written again
    media: function (read, res) {
      var fs = fsApi(), inc = SPK.DESC.norm(read && read.content && read.content.data) || { pics: [] };
      var next = JSON.parse(JSON.stringify(res.next)), want = {}, media = (read && read.media) || {};
      res.addedIds.concat(res.updatedIds).forEach(function (id) { want[id] = 1; });
      var chain = Promise.resolve();
      inc.pics.forEach(function (fp) {
        var row = null;
        (next.pics || []).forEach(function (r) { if (r.id === fp.id) row = r; });
        if (!want[fp.id] || !row || !row.f || row.f !== fp.f) return;   // a row of this device stays
        chain = chain.then(function () {
          var key = (read.rekeyed && read.rekeyed[fp.key]) || fp.key, item = key ? media[key] : null;
          var name = fp.f.indexOf("-" + fp.id + "-") > 0 ? fp.f : C.picName(todayYmd(), fp.id, rnd6());
          var path = C.picPath(name);
          if (!fs || !path) { row.f = ""; return; }
          return Promise.resolve(typeof fs.stat === "function" ? fs.stat(path) : null).then(function (st) { return !!st; }, function () { return false; })
            .then(function (there) {
              if (there) { row.f = name; return; }
              if (!item || !item.bytes || !/^image\//.test(item.type || "")) { row.f = ""; return; }
              return encodePic(new Blob([item.bytes], { type: item.type })).then(function (blob) {
                if (!blob) { row.f = ""; return; }
                return Promise.resolve(fs.writeBlob(path, blob)).then(function () { row.f = name; });
              });
            }).catch(function () { row.f = ""; });
        });
      });
      return chain.then(function () { return next; });
    },
    set: function (next) {
      if (!next || typeof next !== "object" || !Array.isArray(next.items)) return;
      data = canonical(next);
      save();
      render();
    },
    deleteIds: function (ids) {
      var r = SPK.undo(data, ids, Date.now());
      data = r.data;
      save();
      render();
      r.files.forEach(dropPicLater);
      showToast(t("pkg.undone"));
    },
    toast: function (text, undo) {
      if (undo) undoToast(text, undo);
      else showToast(text);
    }
  }) : null;

  // One entry point for every product file: Shopify / Square exports
  // (stock/import.js, its own preview and Undo), anything else goes to
  // the CSV import below (own export, WooCommerce, any Name / SKU
  // sheet). An .xlsx is read with the vendored SheetJS, loaded only
  // when one is picked.
  function importCsv() {
    var I = window.OrosStockImport, K = window.OrosImportKit;
    if (!I || !K) {
      pickFile(".csv,.tsv,.txt,text/csv,text/plain").then(function (file) {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
        return file.text().then(function (txt) { importCsvDialog(txt); });
      }).catch(function () { showToast(t("toast.badFile")); });
      return;
    }
    pickFile(I.ACCEPT).then(function (file) {
      if (!file) return;
      return importFile(file);
    }).catch(function () { showToast(t("toast.badFile")); });
  }
  // Also the handle for tests / a file opened with orOS (Promise)
  function importFile(file) {
    var I = window.OrosStockImport, K = window.OrosImportKit;
    return K.readFile(file, I.MAX_FILE).then(function (f) {
      return I.readBytes(f.bytes, f.name, getXlsx);
    }).then(function (r) {
      if (r.error) { showToast(t(r.error === "lib" ? "imp2.lib" : "toast.badFile")); return false; }
      var res = I.parseRows(r.rows, { tags: t("imp2.tags"), image: t("imp2.image") });
      if (res) { importOtherDialog(res); return true; }
      importCsvDialog(typeof r.text === "string" ? r.text : I.toCsv(r.rows));
      return true;
    }, function () { showToast(t("toast.badFile")); return false; });
  }
  window.__orosStockImport = importFile;
  var XLSX_V = (/v=([\d.]+)/.exec((document.currentScript && document.currentScript.src) || "") || [])[1] || "";
  var xlsxWait = null;
  function getXlsx() {
    if (window.XLSX && window.XLSX.utils) return Promise.resolve(window.XLSX);
    if (xlsxWait) return xlsxWait;
    xlsxWait = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "../vendor/xlsx.full.min.js" + (XLSX_V ? "?v=" + XLSX_V : "");
      s.onload = function () { if (window.XLSX && window.XLSX.utils) res(window.XLSX); else rej(new Error("lib")); };
      s.onerror = function () { s.remove(); xlsxWait = null; rej(new Error("lib")); };
      document.head.appendChild(s);
    });
    return xlsxWait;
  }
  // Preview of a Shopify / Square file: counts, what maps where, the
  // quantities choice; Import = ONE write (save: one persist, one
  // dirty mark) and a toast with Undo. File text only via textContent.
  function importOtherDialog(res) {
    var I = window.OrosStockImport;
    var opts = { now: Date.now(), today: todayYmd(), setQty: true, ref: I.SRC_NAME[res.source] };
    var p = I.plan(data, res, opts);
    var dlg = makeDialog("st-imp2");
    dlg.appendChild(el("div", "dlg-title", t("imp2.title", { s: I.SRC_NAME[res.source] })));
    var ul = el("ul", "imp2-list");
    function li(text) { ul.appendChild(el("li", "", text)); }
    li(t("imp2.found", { n: res.items.length }));
    li(t("imp2.new", { n: p.stats.added + p.stats.back }));
    if (p.stats.back) li(t("imp2.back", { n: p.stats.back }));
    if (p.stats.same) li(t("imp2.same", { n: p.stats.same }));
    if (p.stats.skipped) li(t("imp2.skip", { n: p.stats.skipped }));
    if (p.cats.length) li(t("imp2.cats", { n: p.cats.length }));
    if (p.sups.length) li(t("imp2.sups", { n: p.sups.length }));
    dlg.appendChild(ul);
    dlg.appendChild(el("p", "hint", t("imp2.map." + res.source)));
    if (res.locs > 1) dlg.appendChild(el("p", "hint", t("imp2.locs", { n: res.locs })));
    var qrow = null;
    if (p.stats.withQty) {
      qrow = checkRow(t("imp2.qty", { n: p.stats.withQty }), true);
      dlg.appendChild(qrow);
      dlg.appendChild(el("p", "hint", t("imp2.qtyHint")));
    }
    dlg.appendChild(el("p", "hint", t("imp2.hint")));
    var fresh = p.items.length;
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var go = button(fresh ? t("imp.go") : t("imp2.none"), "primary", function () {
      // a fresh plan against the data as it is now (a pull may have landed)
      opts.now = Date.now();
      opts.setQty = !!(qrow && qrow.querySelector("input").checked);
      var fin = I.plan(data, res, opts);
      dlg.close();
      if (!fin.items.length) { showToast(t("imp2.none")); return; }
      data = I.apply(data, fin);
      save();
      render();
      var info = fin.undo, used = false;
      actionToast(t("imp2.done", { n: fin.items.length }), null, null, function () {
        if (used) return;
        used = true;
        data = I.undo(data, info, Date.now());
        save();
        render();
        showToast(t("imp2.undone"));
      });
    });
    go.disabled = !fresh;
    acts.appendChild(go);
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function importCsvDialog(text) {
    var opts = { lang: LANG === "el" ? "el" : "en", newId: newId, now: Date.now(), today: todayYmd(), setQty: false };
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

  // The shop (stock/shop.js, WooCommerce through the shell's orosLinks).
  // It reads this app's data and writes only through applyPlan and the
  // movement editor, like the CSV import and BR-ST-OUT.
  function shopReady() { return !!(window.OrosStockShop && window.OrosStockShop.available()); }
  function openShop() {
    if (!shopReady()) return;
    window.OrosStockShop.open({
      lang: LANG, core: C, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog,
      field: field, selectInput: selectInput, checkRow: checkRow, confirm: confirmDialog,
      toast: showToast, fmtQ: fmtQ, todayYmd: todayYmd, newId: newId,
      data: function () { return data; },
      byItem: function (id) { return byId("items", id); },
      srcUses: function (src) { return C.srcUses(data, src); },
      applyPlan: function (p) { applyPlan(p); render(); },
      openOut: openOut
    });
  }

  // ---------- 9a'. Consignment (1.8) ----------
  // The UI lives in consign.js; this hands it the app's helpers and
  // its two writes: the consignment settings of a warehouse and the
  // movements of a settlement (a sale, and maybe a transfer back).
  // pricelist.js texts (a pack language through orosI18n, like consText)
  function plText(k) {
    var S = window.OrosStockPriceList.STR;
    if (window.orosI18n && !S[LANG]) window.orosI18n.table(S, "stock", LANG);
    return (S[LANG] || S.en)[k] || S.en[k];
  }
  function consText(k) {
    var CT = window.OrosStockConsign.TEXT;
    if (window.orosI18n && !CT[LANG]) window.orosI18n.table(CT, "stock", LANG);
    return (CT[LANG] || CT.en)[k] || CT.en[k];
  }
  function consApi(after) {
    return {
      lang: LANG, locale: LOCALE, core: C, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog,
      field: field, checkRow: checkRow, toast: showToast, actionToast: actionToast,
      fmtQ: fmtQ, qtyStr: qtyStr, readQty: readQty, money: money, fmtDay: fmtDay,
      fmtNum: function (q) { return nf(3).format(q / 1000); },
      todayYmd: todayYmd, newId: newId, mainWh: mainWh, openAt: openAtFn,
      data: function () { return data; },
      byItem: function (id) { return byId("items", id); },
      after: after || null,
      putCons: function (row) {
        if (!Array.isArray(data.cons)) data.cons = [];
        var cur = byId("cons", row.id);
        if (cur) {
          var same = Object.keys(row).every(function (k) { return cur[k] === row[k]; });
          if (same) return;
          Object.keys(row).forEach(function (k) { cur[k] = row[k]; });
          stamp(cur);
        } else { row.m = Date.now(); data.cons.push(row); }
        save();
        render();
      },
      addMoves: function (list) {
        var now = Date.now();
        list.forEach(function (mv) { mv.m = now; data.moves.push(mv); });
        save();
        render();
      }
    };
  }
  function openConsign() { if (window.OrosStockConsign) window.OrosStockConsign.open(consApi()); }
  // a consignment shop by its name (case and accents ignored, or the one
  // whose name holds it); none or several: the shops list
  function settleByName(name) {
    function fold(x) { return String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
    var k = fold(name), rows = window.OrosStockConsign ? C.consList(data) : [];
    var hit = rows.filter(function (r) { return fold(r.wh.name) === k; });
    if (!hit.length && k) hit = rows.filter(function (r) { return fold(r.wh.name).indexOf(k) >= 0; });
    if (hit.length === 1) window.OrosStockConsign.settle(consApi(), hit[0].wh.id);
    else openConsign();
  }

  // ---------- 9. Supplier price lists (wave P10, pricelist.js) ----------
  // One write per Apply (setData: persist + render); the file is read
  // like the product import (CSV, or .xlsx through SheetJS).
  function openPriceList(supId) {
    var PL = window.OrosStockPriceList, I = window.OrosStockImport, K = window.OrosImportKit;
    if (!PL || !window.OrosStockPrices || !I || !K) return;
    PL.open({
      lang: LANG, locale: LOCALE, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog,
      field: field, selectInput: selectInput, checkRow: checkRow, toast: showToast, actionToast: actionToast,
      money: money, newId: newId,
      data: function () { return data; },
      setData: function (d) { data = d; save(); render(); },
      readRows: function () {
        return pickFile(I.ACCEPT).then(function (file) {
          if (!file) return null;
          return K.readFile(file, I.MAX_FILE).then(function (f) { return I.readBytes(f.bytes, f.name, getXlsx); });
        });
      }
    }, supId || "");
  }

  // ---------- 9a. Point of sale (1.7, wave 46) ----------
  // The till lives in pos.js; this hands it the app's helpers and the
  // only writes it may do: a sale (+ its "out" movement), a void, price
  // lists and a day's Z close. Device-local settings stay in prefs.pos.
  function posPrefs() {
    if (!prefs.pos.dev) { prefs.pos.dev = window.OrosStockPosCore.devCode(); savePrefs(); }
    return prefs.pos;
  }
  function openPos() {
    if (!window.OrosStockPos || !window.OrosStockPosCore) return;
    window.OrosStockPos.open({
      lang: LANG, core: C, el: el, button: button, makeDialog: makeDialog, showDialog: showDialog,
      field: field, selectInput: selectInput, confirm: confirmDialog, toast: showToast, actionToast: actionToast, live: live,
      data: function () { return data; },
      byItem: function (id) { return byId("items", id); },
      byName: byName, matchItem: matchItem, withCam: withCam,
      multiWh: multiWh, whSelect: whSelect, defWh: defWh, qtyAt: qtyAt,
      setWh: function (w) { if (prefs.wh !== w) { prefs.wh = w; savePrefs(); } },
      decOf: decOf, fmtQ: fmtQ, fmtDay: fmtDay, qtyStr: qtyStr, readQty: readQty, readCents: readCents, centsStr: centsStr,
      money: money, esc: esc, printHtml: printHtml, todayYmd: todayYmd, newId: newId,
      posPrefs: posPrefs,
      setPosPref: function (k, v) { posPrefs()[k] = v; prefs.pos = readPos(prefs.pos); savePrefs(); },
      addSale: posAddSale, voidSale: posVoidSale,
      putPl: function (row) {
        if (!Array.isArray(data.pls)) data.pls = [];
        if (upsert("pls", row)) { save(); render(); }
      },
      delPl: function (id) {
        var cur = byId("pls", id);
        if (!cur) return;
        data.tombs[id] = Math.max(Date.now(), cur.m);
        data.pls = data.pls.filter(function (x) { return x.id !== id; });
        if (prefs.pos.pl === id) { prefs.pos.pl = ""; savePrefs(); }
        save();
        render();
      },
      putZ: function (row) {
        if (!Array.isArray(data.zs)) data.zs = [];
        var cur = byId("zs", row.id);
        if (cur) { Object.keys(row).forEach(function (k) { if (k !== "m") cur[k] = row[k]; }); stamp(cur); }
        else { row.m = Date.now(); data.zs.push(row); }
        save();
        render();
      }
    });
  }
  // → the sale as stored (normalized), or null
  function posAddSale(sale, move) {
    if (data.close && sale.d <= data.close.d) { showToast(t("cl.locked", { d: fmtDay(data.close.d, true) })); return null; }
    var s = C.normSale(sale);
    if (!s) return null;
    if (!Array.isArray(data.sales)) data.sales = [];
    data.sales.push(s);
    data.moves.push(move);
    save();
    render();
    return byId("sales", s.id);
  }
  function posVoidSale(id) {
    var s = byId("sales", id);
    if (!s || s.v === 1) return;
    s.v = 1;
    stamp(s);
    var mv = s.mv ? byId("moves", s.mv) : null;
    if (mv && mv.v !== 1) { mv.v = 1; stamp(mv); }
    save();
    render();
  }

  // ---------- 9b. Camera scanning ----------
  // BarcodeDetector (Chrome on Android, no library). Where the browser
  // lacks it the button never shows and a scanner that types still works.
  // A read code goes into the field as if typed and Enter was pressed, so
  // every scan field keeps its own rules. multi: stay open for more codes;
  // the same code is read again only after it left the picture.
  var CAM_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];
  function camOk() {
    return typeof window.BarcodeDetector === "function" &&
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }
  function camButton(input, multi) {
    if (!camOk()) return null;
    var b = el("button", "icon-btn cam-btn", "📷");
    b.type = "button";
    b.title = t("cam.scan");
    b.setAttribute("aria-label", t("cam.scan"));
    b.addEventListener("click", function () {
      camScan(function (code) {
        input.value = code;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      }, multi);
    });
    return b;
  }
  // the field with its camera button beside it (or the field alone)
  function withCam(input, multi) {
    var b = camButton(input, multi);
    if (!b) return input;
    var w = el("div", "cam-wrap");
    w.appendChild(input);
    w.appendChild(b);
    return w;
  }
  function camScan(onCode, multi) {
    var dlg = makeDialog("st-cam");
    dlg.classList.add("cam-dlg");
    dlg.appendChild(el("div", "dlg-title", t("cam.title")));
    var v = el("video", "cam-video");
    v.muted = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    dlg.appendChild(v);
    var msg = el("p", "hint cam-msg", "");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cam.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var stream = null, timer = 0, done = false, last = "", seenAt = 0, det = null;
    function stop() {
      done = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      try { v.srcObject = null; } catch (e) {}
    }
    function failCam() { msg.textContent = t("cam.denied"); msg.classList.add("warn"); }
    dlg.addEventListener("close", stop);
    try { det = new window.BarcodeDetector({ formats: CAM_FORMATS }); }
    catch (e) { try { det = new window.BarcodeDetector(); } catch (e2) { det = null; } }
    function loop() {
      if (done) return;
      if (v.readyState < 2) { timer = setTimeout(loop, 200); return; }
      det.detect(v).then(function (list) {
        if (done) return;
        var raw = list && list[0] && typeof list[0].rawValue === "string" ? list[0].rawValue.trim() : "";
        var now = Date.now();
        if (!raw) { if (now - seenAt > 1200) last = ""; }
        else if (raw === last) seenAt = now;
        else {
          last = raw; seenAt = now;
          var code = raw.slice(0, 120);
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
          if (!multi) { dlg.close(); onCode(code); return; }
          onCode(code);
          var it = C.findByCode(data, code);
          msg.classList.toggle("warn", !it);
          msg.textContent = it ? t("cam.found", { n: it.name }) : t("cam.unknown", { c: code });
        }
        timer = setTimeout(loop, 150);
      }, function () { timer = setTimeout(loop, 400); });
    }
    showDialog(dlg);
    if (!det) { failCam(); return; }
    msg.textContent = t("cam.wait");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
      if (done) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      stream = st;
      v.srcObject = st;
      return v.play().then(function () { msg.textContent = ""; loop(); });
    }).catch(function () { if (!done) failCam(); });
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
      parkToast(dlg);
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
  // A closing dialog hands the toast on to the dialog still open under
  // it (a confirm over the counter), else back to the page.
  function parkToast(closing) {
    var box = $("toast");
    if (!box || (closing && box.parentNode !== closing)) return;
    var open = Array.prototype.filter.call(document.querySelectorAll("dialog[open]"), function (d) { return d !== closing; });
    var to = open.length ? open[open.length - 1] : document.body;
    if (box.parentNode !== to) to.appendChild(box);
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
  //   { view: "reports" } → the Reports tab
  //   { po: id }    → that purchase order (Today: expected deliveries)
  //   { out: req }  → a prefilled sale / return (BR-ST-OUT, core outRequest)
  //   { view: "shop" } → the shop (Settings › Connected services)
  //   { newItem: { name, sku?, bc?, price?, note? } } → a new product
  //                   prefilled (Publishing wave P2; price in cents),
  //                   saved only when the person saves it; a product
  //                   with the same SKU or barcode opens instead
  // Unknown targets are ignored; an open dialog (unsaved edits) wins.
  //   { openFile: { token } } → "Open with" an .orosstock file
  //                   (fileopen.js): the File is taken once with
  //                   window.parent.__orosTakeFile(token) (recordpkg.js)
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (target.openFile) { if (recFile) recFile.openTarget(target.openFile); return; }
    if (document.querySelector("dialog[open]")) return;
    if (target.out && typeof target.out === "object") { openOut(target.out); return; }
    if (target.newItem && typeof target.newItem === "object") { openNewItem(target.newItem); return; }
    if (target.view === "reorder") { setTab("order"); return; }
    if (target.view === "reports") { setTab("reports"); return; }
    if (target.view === "shop") { openShop(); return; }
    if (target.view === "cons") { openConsign(); return; }
    // the Assistant's "settlement" card (publisher wave P14): that shop's
    // settlement opens; nothing is saved before the person saves it
    if (target.asNew && typeof target.asNew === "object" && typeof target.asNew.settle === "string") { settleByName(target.asNew.settle); return; }
    if (typeof target.po === "string" && byId("pos", target.po)) {
      setTab("order");
      poSheet(target.po);
      return;
    }
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
  function openNewItem(src) {
    var pre = {};
    ["name", "sku", "bc", "note"].forEach(function (k) { if (typeof src[k] === "string") pre[k] = src[k]; });
    if (typeof src.price === "number") pre.price = src.price;
    var sku = C.fold(pre.sku || ""), bc = C.fold(pre.bc || "").replace(/\s+/g, "");
    var same = data.items.filter(function (o) { return (sku && C.fold(o.sku) === sku) || (bc && o.bc && C.fold(o.bc) === bc); })[0];
    if (same) {
      if (same.arch && prefs.f !== "arch") prefs.f = "arch";
      else if (!same.arch && prefs.f === "arch") prefs.f = "all";
      setTab("items");
      itemSheet(same.id);
      return;
    }
    setTab("items");
    itemEditor(null, pre);
  }
  function openOut(req) {
    var r = C.outRequest(data, req, todayYmd());
    if (!r) return;
    if (data.close && r.d <= data.close.d) r.d = todayYmd();
    var app = r.src ? r.src.split(":")[0] : "";
    var name = appName(app);
    setTab("moves");
    moveEditor(r.t, r.lines, {
      ref: r.ref, date: r.d, src: r.src || undefined, srcT: r.t,
      from: name, miss: r.miss, used: r.used
    });
  }
  // the asking app's name: Invoices is known, anything else is "another app"
  function appName(id) { return id === "invoices" ? t("out.invoices") : (id === "woo" ? t("out.woo") : t("out.other")); }
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
    else if (prefs.tab === "reports") renderReports();
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
    $("rep-range").setAttribute("aria-label", t("rep.range"));
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
    var qCam = camButton($("items-q"), false);
    if (qCam) { $("items-q").parentNode.appendChild(qCam); $("items-q").parentNode.classList.add("cam-wrap"); }
    $("items-wh").addEventListener("change", function () { prefs.wf = $("items-wh").value; savePrefs(); render(); });
    $("items-cat").addEventListener("change", function () { prefs.cat = $("items-cat").value; savePrefs(); render(); });
    $("items-sort").addEventListener("change", function () { prefs.sort = $("items-sort").value; savePrefs(); render(); });
    $("moves-range").addEventListener("change", function () { prefs.range = $("moves-range").value; savePrefs(); render(); });
    $("rep-range").addEventListener("change", function () { prefs.rr = $("rep-range").value; savePrefs(); render(); });
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
