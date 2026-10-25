// ============================================================
// orOS Publishing — the app inside the shell frame (wave P1)
// A desk for a small publisher: every title with its formats,
// ISBNs, prices, sizes and texts in one place, the house's ISBN
// blocks with the next free number, and book barcodes (EAN-13).
// Later waves send a title to the shop, Stock, Layout (cover),
// Newsletter and the Assistant from here.
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link.
// Data:
//   - synced slice "publish" (oros-publish-data), merge =
//     OrosPublishCore.merge (R5, R17, R26)
//   - device-local (R10): oros-publish-prefs { tab, sort, st }
//   - cover pictures: files on the orOS disk under
//     /internal/Publishing/Covers (re-drawn on a canvas: no EXIF)
// Sections:
//   1. Strings + helpers
//   2. Storage, prefs, sync slice
//   3. Shell services (dialogs, disk, clipboard)
//   4. Titles list
//   5. Title editor
//   6. Cover picture
//   7. Barcode dialog
//   8. ISBN register
//   9. Settings
//  10. Dialogs + toast
//  11. Keyboard (Contract Β) + deep link
//  12. Palette + boot
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("publish/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "publish";
  var STORAGE_KEY = "oros-publish-data";
  var PREFS_KEY = "oros-publish-prefs";
  var C = window.OrosPublishCore;
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "RON", "BGN", "HUF", "TRY"];

  // ---------- 1. Strings + helpers ----------
  var STR = {
    en: {
      "app.name": "Publishing",
      "tab.titles": "Titles", "tab.isbn": "ISBN",
      "btn.new": "New title", "btn.settings": "Settings", "btn.back": "Titles", "btn.close": "Close",
      "btn.cancel": "Cancel", "btn.save": "Save", "btn.add": "Add", "btn.del": "Delete", "btn.undo": "Undo",
      "btn.copy": "Copy", "btn.remove": "Remove",
      "q.ph": "Search titles, people, ISBN…", "q.label": "Search",
      "sort.rel": "Release date", "sort.t": "Title A–Z", "sort.m": "Last edited", "sort.label": "Sort",
      "f.all": "All",
      "st.idea": "Idea", "st.prod": "In production", "st.out": "Released", "st.oop": "Out of print",
      "empty.first": "Keep every book you publish in one place: its formats, ISBNs, prices, sizes, back-cover text and cover. Later you can send a title to your shop, to Stock, to Layout and to the Newsletter from here.",
      "empty.first.btn": "Add your first title",
      "empty.list": "No title matches.",
      "gaps": "Still missing: {list}", "gaps.none": "Everything for the release is filled in.",
      "gap.author": "author", "gap.fmt": "a format", "gap.isbn": "ISBN", "gap.price": "price", "gap.pages": "pages",
      "gap.blurb": "back-cover text", "gap.rel": "release date", "gap.cov": "cover",
      "gaps.n": "{n} missing",
      "new.title": "New title", "new.name": "Title", "new.author": "Author (optional)", "new.go": "Create", "new.plan": "Make the release plan from the release date",
      "sec.main": "The book", "sec.ppl": "People", "sec.fmts": "Formats", "sec.texts": "Texts", "sec.cover": "Cover",
      "f.t": "Title", "f.sub": "Subtitle", "f.ser": "Series", "f.sn": "No. in series", "f.st": "Status",
      "f.rel": "Release date", "f.lang": "Language",
      "f.blurb": "Back-cover text", "f.bio": "About the author", "f.kw": "Keywords (comma separated)", "f.notes": "Notes (only for you)",
      "role.a": "Author", "role.t": "Translator", "role.i": "Illustrator", "role.e": "Editor", "role.c": "Cover design",
      "role.n": "Narrator", "role.o": "Other",
      "ppl.add": "+ Person", "ppl.name": "Name", "ppl.role": "Role", "ppl.none": "No people yet.",
      "fmt.pb": "Paperback", "fmt.hb": "Hardback", "fmt.eb": "E-book", "fmt.ab": "Audiobook", "fmt.ot": "Other",
      "fmt.add": "+ Format", "fmt.none": "No formats yet. Add the paperback, the e-book and so on, each with its own ISBN.",
      "fmt.kind": "Format", "fmt.isbn": "ISBN", "fmt.price": "Price ({cur})", "fmt.pages": "Pages",
      "fmt.w": "Width (mm)", "fmt.h": "Height (mm)", "fmt.sp": "Spine (mm)", "fmt.wt": "Weight (g)",
      "fmt.bind": "Binding", "fmt.paper": "Paper", "fmt.dur": "Length (minutes)", "fmt.note": "Note",
      "fmt.next": "Next free", "fmt.barcode": "Barcode", "fmt.cover": "Cover in Layout", "cov.noLayout": "Layout could not be opened from here.", "fmt.del": "Remove format",
      "isbn.ok": "Valid ISBN · ISBN-10 {ten}", "isbn.ok13": "Valid ISBN (979, no ISBN-10)",
      "isbn.len": "An ISBN has 13 digits (or 10 for an old one).", "isbn.check": "The check digit does not match: a typo?",
      "isbn.prefix": "An ISBN-13 starts with 978 or 979.",
      "isbn.clash": "Also used by: {list}", "isbn.elsewhere": "marked as used elsewhere",
      "isbn.noBlock": "Add your ISBN block in the ISBN tab, then this button gives you the next free number.",
      "isbn.full": "Every number of your blocks is in use.",
      "isbn.pickBlock": "Which block?",
      "cov.add": "Add a cover picture", "cov.change": "Change", "cov.missing": "The picture is not on this device yet.",
      "cov.noDisk": "The orOS disk is not available here, so the cover cannot be kept.",
      "cov.bad": "This picture could not be read.", "cov.hint": "A JPEG or PNG of the front cover. orOS keeps a copy up to 1600 px for lists, the shop and the newsletter.",
      "del.title": "Delete “{t}”?", "del.body": "The title and its numbers leave the register. You can undo right after.",
      "del.done": "Deleted “{t}”",
      "bc.title": "Barcode · {fmt}", "bc.svg": "Download SVG", "bc.png": "Download PNG",
      "bc.hint": "EAN-13 for the back cover. The SVG prints at the standard size (about 37 × 29 mm); keep a white margin around it.",
      "isbn.blocks": "Your ISBN blocks", "isbn.addBlock": "Add a block",
      "isbn.blocksNone": "Your national ISBN agency gives a publisher a block of numbers, for example 978-618-5321 for 100 books. Add it here and orOS tells you the next free number and warns about numbers used twice.",
      "blk.prefix": "Prefix as the agency gave it", "blk.prefix.ph": "978-618-5321", "blk.note": "Note (optional)",
      "blk.bad": "Write the prefix with its hyphens, for example 978-618-5321 (9 to 11 digits, starting 978 or 979).",
      "blk.dup": "This block is already in the list.",
      "blk.used": "{used} of {size} in use · {free} free",
      "blk.next": "Next free:", "blk.full": "This block is full.",
      "blk.newWith": "New title with it",
      "blk.del": "Remove block", "blk.delAsk": "Remove the block {p}? The numbers on your titles stay as they are.",
      "blk.removed": "Block removed",
      "blk.show": "Numbers in use ({n})",
      "x.title": "Used outside this app", "x.hint": "A number given to a book before you used orOS, or spoiled: orOS will not offer it again.",
      "x.add": "Mark a number as used", "x.isbn": "ISBN", "x.note": "What it was used for",
      "x.none": "None.", "x.done": "Marked as used", "x.removed": "No longer marked",
      "clash.title": "Numbers used twice", "clash.one": "{isbn}: {list}",
      "chk.title": "Check an ISBN", "chk.ph": "Paste or type any ISBN",
      "chk.ok": "Valid. ISBN-13 {thirteen}{ten}", "chk.ten": " · ISBN-10 {ten}",
      "chk.uses": "In use: {list}", "chk.free": "Not used by any of your titles.",
      "plan.title": "Release plan", "plan.none": "Set the release date, then make the plan: orOS dates every step back from it (manuscript, editing, proofs, cover, ISBN, printer, presentation).",
      "plan.make": "Make the plan", "plan.redate": "Re-date from the release date", "plan.redateHint": "Open steps get new dates from the release date; done steps keep theirs.",
      "plan.add": "+ Step", "plan.addName": "Name of the step", "plan.todo": "Send to To-Do", "plan.del": "Remove step",
      "plan.late": "late", "plan.lateN": "{n} late", "plan.next": "Next: {s} · {d}", "plan.allDone": "All steps done.",
      "plan.noRel": "Set the release date first.", "plan.todoBy": "By {d} · {t}", "plan.todoNone": "No open steps to send.", "plan.date": "Date",
      "tab.roy": "Royalties",
      "sec.roy": "Royalties", "roy.none": "No royalty terms. Add who is paid for this book, how much and on what.",
      "roy.add": "+ Terms", "roy.who": "Paid to", "roy.pct": "Royalty (%)", "roy.base": "On", "roy.base.list": "List price", "roy.base.net": "What came in (net)",
      "roy.k": "Formats", "roy.k.all": "All formats", "roy.adv": "Advance ({cur})", "roy.del": "Remove these terms",
      "roy.hint": "Sales come from Stock: every sale recorded there (till, shop orders, invoices, consignment settlements) of a product whose SKU or barcode is the format's ISBN. Sales Stock never saw, such as e-books, are typed into the statement.",
      "roy.people": "Who is paid", "roy.peopleNone": "No royalty terms yet. Open a title and add them in its Royalties section.",
      "roy.titlesN": "{n} titles", "roy.newSt": "New statement…", "roy.stmts": "Statements", "roy.stmtsNone": "No statements yet.",
      "roy.period": "Period", "roy.p.half": "Last half-year", "roy.p.year": "Last year", "roy.p.quarter": "Last quarter", "roy.p.custom": "Other dates",
      "roy.from": "From", "roy.to": "To", "roy.units": "Units", "roy.unit": "Per unit ({cur})", "roy.earned": "Earned",
      "roy.advLeft": "Advance still to recoup: {a}", "roy.advRec": "Advance recouped this time: {a}",
      "roy.due": "Payable: {a}", "roy.issue": "Issue statement", "roy.issued": "Statement issued",
      "roy.warnClosed": "Stock closed its books inside this period: sales before that date are archived and not counted here. Type them in if needed.",
      "roy.warnMissing": "Not in Stock (no product with this ISBN): {list}. Type the units by hand.",
      "roy.empty": "Nothing to put on this statement: no title has terms for this person.",
      "roy.st": "Royalty statement", "roy.stFor": "{n} · {from} – {to}", "roy.paidOn": "Paid {d}", "roy.unpaid": "Not paid yet",
      "roy.void": "Voided", "roy.print": "Print or PDF", "roy.mail": "E-mail", "roy.budget": "Add to Budget",
      "roy.markPaid": "Mark paid", "roy.markUnpaid": "Mark not paid", "roy.voidIt": "Void", "roy.voidQ": "Void this statement? It stays in the list, crossed out, and no longer counts towards the advance.",
      "roy.mailSubj": "Royalty statement {from} – {to}", "roy.mailHi": "Hello {n},", "roy.mailBody": "Here is your royalty statement for {from} – {to}.",
      "roy.th.title": "Title", "roy.th.fmt": "Format", "roy.th.units": "Units", "roy.th.base": "Base", "roy.th.pct": "%", "roy.th.earned": "Earned",
      "roy.total": "Earned in the period", "roy.advance": "Advance",
      "send.title": "Send to other apps", "send.hint": "Nothing is saved in the other app until you save it there. Your shop gets a draft that you publish yourself.",
      "send.fmt": "Format", "send.noFmt": "Add a format first.", "send.shop": "Draft in my shop", "send.stock": "Item in Stock",
      "send.news": "Block in Newsletter", "send.pr": "Press release in Writer", "send.noApp": "That app could not be opened from here.",
      "send.linked": "In the shop: product #{id}", "send.open": "Open in the shop",
      "shop.title": "Draft in the shop · {fmt}", "shop.acct": "Shop",
      "shop.none": "Connect your WooCommerce shop first, in Settings › Connected services. Your keys stay on your devices.",
      "shop.connect": "Connected services",
      "shop.what": "orOS creates a draft product with the name, SKU (the ISBN), price, back-cover text, weight and size. Add pictures, categories and stock in the shop, then publish it there.",
      "shop.go": "Create draft", "shop.busy": "Talking to the shop…", "shop.done": "Draft created: product #{id}.",
      "shop.exists": "The shop already has a product with this ISBN ({name}, #{id}). orOS linked it to this format and created nothing.",
      "shop.cur": "The shop sells in {shop} and your prices are in {mine}, so the draft has no price.",
      "shop.dup": "The shop refused it: the ISBN is already used as a SKU (maybe by a product in the trash).",
      "shop.err.offline": "You're offline.", "shop.err.auth": "The shop did not accept the keys. Check them in Settings › Connected services.",
      "shop.err.notfound": "The shop's REST API was not found at that address.", "shop.err.network": "The shop did not answer.",
      "shop.err.relay": "The shop doesn't answer this browser, and the orOS relay could not reach it either.",
      "shop.err.server": "The shop answered with an error.", "shop.err.busy": "The shop asks you to wait a little.",
      "shop.err.keys": "This device doesn't have the shop's keys.", "shop.err.denied": "orOS doesn't allow this call.",
      "shop.err.gone": "This shop was disconnected.", "shop.err.bad": "Something went wrong.",
      "shop.err.unknown": "The shop did not confirm it. The draft may already be there: look in your shop before you try again.",
      "news.btn": "See the book",
      "pr.head": "PRESS RELEASE", "pr.lead": "«{t}» by {a} is out.", "pr.leadNoA": "«{t}» is out.",
      "pr.leadImp": "{imp} presents «{t}» by {a}.", "pr.leadImpNoA": "{imp} presents «{t}».", "pr.rel": "Release date: {d}.",
      "pr.about": "About the author", "pr.details": "Details", "pr.pages": "{n} pages", "pr.contact": "Contact", "pr.docTitle": "Press release: {t}",
      "set.title": "Settings", "set.cur": "Currency for prices", "set.imp": "Publisher name",
      "set.impHint": "Goes on covers and press texts.", "set.done": "Saved",
      "toast.copied": "Copied", "toast.saved": "Saved", "toast.exported": "Saved",
      "full": "This device is out of storage space. The change was not saved.",
      "untitled": "Untitled", "by": "by {list}"
    },
    el: {
      "app.name": "Εκδόσεις",
      "tab.titles": "Τίτλοι", "tab.isbn": "ISBN",
      "btn.new": "Νέος τίτλος", "btn.settings": "Ρυθμίσεις", "btn.back": "Τίτλοι", "btn.close": "Κλείσιμο",
      "btn.cancel": "Άκυρο", "btn.save": "Αποθήκευση", "btn.add": "Προσθήκη", "btn.del": "Διαγραφή", "btn.undo": "Αναίρεση",
      "btn.copy": "Αντιγραφή", "btn.remove": "Αφαίρεση",
      "q.ph": "Αναζήτηση τίτλων, προσώπων, ISBN…", "q.label": "Αναζήτηση",
      "sort.rel": "Ημερομηνία κυκλοφορίας", "sort.t": "Τίτλος Α–Ω", "sort.m": "Τελευταία αλλαγή", "sort.label": "Ταξινόμηση",
      "f.all": "Όλοι",
      "st.idea": "Ιδέα", "st.prod": "Σε παραγωγή", "st.out": "Κυκλοφορεί", "st.oop": "Εξαντλημένο",
      "empty.first": "Κράτα κάθε βιβλίο που εκδίδεις σε ένα σημείο: μορφές, ISBN, τιμές, διαστάσεις, κείμενο οπισθόφυλλου και εξώφυλλο. Αργότερα θα στέλνεις από εδώ έναν τίτλο στο κατάστημα, στο Απόθεμα, στη Σελιδοποίηση και στο Newsletter.",
      "empty.first.btn": "Πρόσθεσε τον πρώτο τίτλο",
      "empty.list": "Κανένας τίτλος δεν ταιριάζει.",
      "gaps": "Λείπουν ακόμα: {list}", "gaps.none": "Όλα για την κυκλοφορία είναι συμπληρωμένα.",
      "gap.author": "συγγραφέας", "gap.fmt": "μορφή", "gap.isbn": "ISBN", "gap.price": "τιμή", "gap.pages": "σελίδες",
      "gap.blurb": "κείμενο οπισθόφυλλου", "gap.rel": "ημερομηνία κυκλοφορίας", "gap.cov": "εξώφυλλο",
      "gaps.n": "λείπουν {n}",
      "new.title": "Νέος τίτλος", "new.name": "Τίτλος", "new.author": "Συγγραφέας (προαιρετικό)", "new.go": "Δημιουργία", "new.plan": "Φτιάξε την πορεία έκδοσης από την ημερομηνία κυκλοφορίας",
      "sec.main": "Το βιβλίο", "sec.ppl": "Πρόσωπα", "sec.fmts": "Μορφές", "sec.texts": "Κείμενα", "sec.cover": "Εξώφυλλο",
      "f.t": "Τίτλος", "f.sub": "Υπότιτλος", "f.ser": "Σειρά", "f.sn": "Αρ. στη σειρά", "f.st": "Κατάσταση",
      "f.rel": "Ημερομηνία κυκλοφορίας", "f.lang": "Γλώσσα",
      "f.blurb": "Κείμενο οπισθόφυλλου", "f.bio": "Για τον συγγραφέα", "f.kw": "Λέξεις-κλειδιά (με κόμμα)", "f.notes": "Σημειώσεις (μόνο για σένα)",
      "role.a": "Συγγραφέας", "role.t": "Μεταφραστής", "role.i": "Εικονογράφος", "role.e": "Επιμελητής", "role.c": "Σχεδιασμός εξωφύλλου",
      "role.n": "Αφηγητής", "role.o": "Άλλο",
      "ppl.add": "+ Πρόσωπο", "ppl.name": "Όνομα", "ppl.role": "Ρόλος", "ppl.none": "Κανένα πρόσωπο ακόμα.",
      "fmt.pb": "Χαρτόδετο", "fmt.hb": "Σκληρόδετο", "fmt.eb": "E-book", "fmt.ab": "Ηχητικό βιβλίο", "fmt.ot": "Άλλο",
      "fmt.add": "+ Μορφή", "fmt.none": "Καμία μορφή ακόμα. Πρόσθεσε το χαρτόδετο, το e-book κ.λπ., το καθένα με το δικό του ISBN.",
      "fmt.kind": "Μορφή", "fmt.isbn": "ISBN", "fmt.price": "Τιμή ({cur})", "fmt.pages": "Σελίδες",
      "fmt.w": "Πλάτος (mm)", "fmt.h": "Ύψος (mm)", "fmt.sp": "Ράχη (mm)", "fmt.wt": "Βάρος (g)",
      "fmt.bind": "Βιβλιοδεσία", "fmt.paper": "Χαρτί", "fmt.dur": "Διάρκεια (λεπτά)", "fmt.note": "Σημείωση",
      "fmt.next": "Επόμενο ελεύθερο", "fmt.barcode": "Barcode", "fmt.cover": "Εξώφυλλο στο Layout", "cov.noLayout": "Το Layout δεν άνοιξε από εδώ.", "fmt.del": "Αφαίρεση μορφής",
      "isbn.ok": "Σωστό ISBN · ISBN-10 {ten}", "isbn.ok13": "Σωστό ISBN (979, χωρίς ISBN-10)",
      "isbn.len": "Το ISBN έχει 13 ψηφία (ή 10 για παλιό).", "isbn.check": "Το ψηφίο ελέγχου δεν ταιριάζει: μήπως τυπογραφικό λάθος;",
      "isbn.prefix": "Το ISBN-13 αρχίζει από 978 ή 979.",
      "isbn.clash": "Το έχει και: {list}", "isbn.elsewhere": "σημειωμένο ως χρησιμοποιημένο αλλού",
      "isbn.noBlock": "Πρόσθεσε το μπλοκ ISBN σου στην καρτέλα ISBN και αυτό το κουμπί θα σου δίνει το επόμενο ελεύθερο.",
      "isbn.full": "Όλοι οι αριθμοί των μπλοκ σου χρησιμοποιούνται.",
      "isbn.pickBlock": "Από ποιο μπλοκ;",
      "cov.add": "Πρόσθεσε εικόνα εξωφύλλου", "cov.change": "Αλλαγή", "cov.missing": "Η εικόνα δεν έχει έρθει ακόμα σε αυτή τη συσκευή.",
      "cov.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ, οπότε το εξώφυλλο δεν μπορεί να κρατηθεί.",
      "cov.bad": "Αυτή η εικόνα δεν διαβάστηκε.", "cov.hint": "Ένα JPEG ή PNG του εμπρόσθιου εξωφύλλου. Το orOS κρατά αντίγραφο έως 1600 px για λίστες, κατάστημα και newsletter.",
      "del.title": "Διαγραφή του «{t}»;", "del.body": "Ο τίτλος και οι αριθμοί του φεύγουν από το μητρώο. Μπορείς να το αναιρέσεις αμέσως μετά.",
      "del.done": "Διαγράφηκε το «{t}»",
      "bc.title": "Barcode · {fmt}", "bc.svg": "Λήψη SVG", "bc.png": "Λήψη PNG",
      "bc.hint": "EAN-13 για το οπισθόφυλλο. Το SVG τυπώνεται στο κανονικό μέγεθος (περίπου 37 × 29 mm)· άφησε λευκό περιθώριο γύρω του.",
      "isbn.blocks": "Τα μπλοκ ISBN σου", "isbn.addBlock": "Προσθήκη μπλοκ",
      "isbn.blocksNone": "Ο εθνικός φορέας ISBN δίνει στον εκδότη ένα μπλοκ αριθμών, για παράδειγμα 978-618-5321 για 100 βιβλία. Πρόσθεσέ το εδώ και το orOS σού λέει το επόμενο ελεύθερο και σε προειδοποιεί για αριθμούς που μπήκαν δύο φορές.",
      "blk.prefix": "Πρόθεμα όπως το έδωσε ο φορέας", "blk.prefix.ph": "978-618-5321", "blk.note": "Σημείωση (προαιρετικό)",
      "blk.bad": "Γράψε το πρόθεμα με τις παύλες του, π.χ. 978-618-5321 (9 έως 11 ψηφία, αρχίζει από 978 ή 979).",
      "blk.dup": "Αυτό το μπλοκ υπάρχει ήδη στη λίστα.",
      "blk.used": "{used} από {size} σε χρήση · {free} ελεύθερα",
      "blk.next": "Επόμενο ελεύθερο:", "blk.full": "Το μπλοκ γέμισε.",
      "blk.newWith": "Νέος τίτλος με αυτό",
      "blk.del": "Αφαίρεση μπλοκ", "blk.delAsk": "Αφαίρεση του μπλοκ {p}; Οι αριθμοί στους τίτλους σου μένουν όπως είναι.",
      "blk.removed": "Το μπλοκ αφαιρέθηκε",
      "blk.show": "Αριθμοί σε χρήση ({n})",
      "x.title": "Χρησιμοποιημένα εκτός εφαρμογής", "x.hint": "Αριθμός που δόθηκε σε βιβλίο πριν από το orOS, ή χάλασε: το orOS δεν θα τον ξαναπροτείνει.",
      "x.add": "Σημείωσε αριθμό ως χρησιμοποιημένο", "x.isbn": "ISBN", "x.note": "Πού χρησιμοποιήθηκε",
      "x.none": "Κανένας.", "x.done": "Σημειώθηκε ως χρησιμοποιημένο", "x.removed": "Δεν είναι πια σημειωμένο",
      "clash.title": "Αριθμοί που μπήκαν δύο φορές", "clash.one": "{isbn}: {list}",
      "chk.title": "Έλεγχος ISBN", "chk.ph": "Επικόλλησε ή γράψε οποιοδήποτε ISBN",
      "chk.ok": "Σωστό. ISBN-13 {thirteen}{ten}", "chk.ten": " · ISBN-10 {ten}",
      "chk.uses": "Σε χρήση: {list}", "chk.free": "Δεν το έχει κανένας από τους τίτλους σου.",
      "plan.title": "Πορεία έκδοσης", "plan.none": "Βάλε ημερομηνία κυκλοφορίας και φτιάξε την πορεία: το orOS βάζει ημερομηνίες σε κάθε βήμα μετρώντας ανάποδα (χειρόγραφο, επιμέλεια, διορθώσεις, εξώφυλλο, ISBN, τυπογραφείο, παρουσίαση).",
      "plan.make": "Φτιάξε την πορεία", "plan.redate": "Νέες ημερομηνίες από την κυκλοφορία", "plan.redateHint": "Τα ανοιχτά βήματα παίρνουν νέες ημερομηνίες από την κυκλοφορία· όσα έγιναν κρατούν τις δικές τους.",
      "plan.add": "+ Βήμα", "plan.addName": "Όνομα βήματος", "plan.todo": "Στείλε στο To-Do", "plan.del": "Αφαίρεση βήματος",
      "plan.late": "καθυστερεί", "plan.lateN": "{n} καθυστερούν", "plan.next": "Επόμενο: {s} · {d}", "plan.allDone": "Έγιναν όλα τα βήματα.",
      "plan.noRel": "Βάλε πρώτα ημερομηνία κυκλοφορίας.", "plan.todoBy": "Έως {d} · {t}", "plan.todoNone": "Δεν υπάρχουν ανοιχτά βήματα.", "plan.date": "Ημερομηνία",
      "tab.roy": "Δικαιώματα",
      "sec.roy": "Δικαιώματα", "roy.none": "Δεν υπάρχουν όροι δικαιωμάτων. Πρόσθεσε ποιος πληρώνεται για αυτό το βιβλίο, πόσο και επί ποιου.",
      "roy.add": "+ Όροι", "roy.who": "Δικαιούχος", "roy.pct": "Ποσοστό (%)", "roy.base": "Επί", "roy.base.list": "Τιμής καταλόγου", "roy.base.net": "Εισπράξεων (καθαρά)",
      "roy.k": "Μορφές", "roy.k.all": "Όλες οι μορφές", "roy.adv": "Προκαταβολή ({cur})", "roy.del": "Αφαίρεση αυτών των όρων",
      "roy.hint": "Οι πωλήσεις έρχονται από το Απόθεμα: κάθε πώληση που καταγράφηκε εκεί (ταμείο, παραγγελίες καταστήματος, τιμολόγια, εκκαθαρίσεις παρακαταθηκών) προϊόντος που έχει ως κωδικό ή barcode το ISBN της μορφής. Πωλήσεις που δεν πέρασαν από το Απόθεμα, όπως τα e-book, τις γράφεις στην εκκαθάριση.",
      "roy.people": "Δικαιούχοι", "roy.peopleNone": "Δεν υπάρχουν ακόμα όροι δικαιωμάτων. Άνοιξε έναν τίτλο και πρόσθεσέ τους στην ενότητα Δικαιώματα.",
      "roy.titlesN": "{n} τίτλοι", "roy.newSt": "Νέα εκκαθάριση…", "roy.stmts": "Εκκαθαρίσεις", "roy.stmtsNone": "Καμία εκκαθάριση ακόμα.",
      "roy.period": "Περίοδος", "roy.p.half": "Τελευταίο εξάμηνο", "roy.p.year": "Πέρσι", "roy.p.quarter": "Τελευταίο τρίμηνο", "roy.p.custom": "Άλλες ημερομηνίες",
      "roy.from": "Από", "roy.to": "Έως", "roy.units": "Τεμάχια", "roy.unit": "Ανά τεμάχιο ({cur})", "roy.earned": "Δικαιώματα",
      "roy.advLeft": "Προκαταβολή που μένει να συμψηφιστεί: {a}", "roy.advRec": "Συμψηφίστηκε με την προκαταβολή: {a}",
      "roy.due": "Πληρωτέο: {a}", "roy.issue": "Έκδοση εκκαθάρισης", "roy.issued": "Η εκκαθάριση εκδόθηκε",
      "roy.warnClosed": "Το Απόθεμα έκλεισε βιβλία μέσα σε αυτή την περίοδο: οι πωλήσεις πριν από εκείνη την ημέρα έχουν αρχειοθετηθεί και δεν μετρούν εδώ. Γράψ' τες με το χέρι αν χρειάζεται.",
      "roy.warnMissing": "Δεν υπάρχουν στο Απόθεμα (κανένα προϊόν με αυτό το ISBN): {list}. Γράψε τα τεμάχια με το χέρι.",
      "roy.empty": "Δεν υπάρχει τίποτα για αυτή την εκκαθάριση: κανένας τίτλος δεν έχει όρους για αυτό το πρόσωπο.",
      "roy.st": "Εκκαθάριση δικαιωμάτων", "roy.stFor": "{n} · {from} – {to}", "roy.paidOn": "Πληρώθηκε {d}", "roy.unpaid": "Απλήρωτη",
      "roy.void": "Ακυρωμένη", "roy.print": "Εκτύπωση ή PDF", "roy.mail": "E-mail", "roy.budget": "Στον Προϋπολογισμό",
      "roy.markPaid": "Σήμανση ως πληρωμένη", "roy.markUnpaid": "Σήμανση ως απλήρωτη", "roy.voidIt": "Ακύρωση", "roy.voidQ": "Να ακυρωθεί αυτή η εκκαθάριση; Μένει στη λίστα διαγραμμένη και δεν μετρά πια στην προκαταβολή.",
      "roy.mailSubj": "Εκκαθάριση δικαιωμάτων {from} – {to}", "roy.mailHi": "Καλησπέρα {n},", "roy.mailBody": "Σου στέλνω την εκκαθάριση δικαιωμάτων για {from} – {to}.",
      "roy.th.title": "Τίτλος", "roy.th.fmt": "Μορφή", "roy.th.units": "Τεμάχια", "roy.th.base": "Βάση", "roy.th.pct": "%", "roy.th.earned": "Δικαιώματα",
      "roy.total": "Δικαιώματα περιόδου", "roy.advance": "Προκαταβολή",
      "send.title": "Στείλε σε άλλες εφαρμογές", "send.hint": "Τίποτα δεν αποθηκεύεται στην άλλη εφαρμογή πριν το αποθηκεύσεις εκεί. Το κατάστημά σου παίρνει πρόχειρο που το δημοσιεύεις εσύ.",
      "send.fmt": "Μορφή", "send.noFmt": "Πρόσθεσε πρώτα μια μορφή.", "send.shop": "Πρόχειρο στο κατάστημά μου", "send.stock": "Είδος στο Απόθεμα",
      "send.news": "Μπλοκ στο Newsletter", "send.pr": "Δελτίο τύπου στο Writer", "send.noApp": "Η εφαρμογή δεν άνοιξε από εδώ.",
      "send.linked": "Στο κατάστημα: προϊόν #{id}", "send.open": "Άνοιγμα στο κατάστημα",
      "shop.title": "Πρόχειρο στο κατάστημα · {fmt}", "shop.acct": "Κατάστημα",
      "shop.none": "Σύνδεσε πρώτα το κατάστημά σου WooCommerce, στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες. Τα κλειδιά σου μένουν στις συσκευές σου.",
      "shop.connect": "Συνδεδεμένες υπηρεσίες",
      "shop.what": "Το orOS φτιάχνει πρόχειρο προϊόν με όνομα, SKU (το ISBN), τιμή, κείμενο οπισθόφυλλου, βάρος και διαστάσεις. Εικόνες, κατηγορίες και απόθεμα τα βάζεις στο κατάστημα και το δημοσιεύεις από εκεί.",
      "shop.go": "Δημιουργία πρόχειρου", "shop.busy": "Μιλάω με το κατάστημα…", "shop.done": "Έγινε το πρόχειρο: προϊόν #{id}.",
      "shop.exists": "Το κατάστημα έχει ήδη προϊόν με αυτό το ISBN ({name}, #{id}). Το orOS το συνέδεσε με αυτή τη μορφή και δεν έφτιαξε τίποτα.",
      "shop.cur": "Το κατάστημα πουλά σε {shop} και οι τιμές σου είναι σε {mine}, οπότε το πρόχειρο μένει χωρίς τιμή.",
      "shop.dup": "Το κατάστημα το αρνήθηκε: το ISBN υπάρχει ήδη ως SKU (ίσως σε προϊόν στα διαγραμμένα).",
      "shop.err.offline": "Είσαι εκτός σύνδεσης.", "shop.err.auth": "Το κατάστημα δεν δέχτηκε τα κλειδιά. Έλεγξέ τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.err.notfound": "Δεν βρέθηκε το REST API του καταστήματος σε αυτή τη διεύθυνση.", "shop.err.network": "Το κατάστημα δεν απάντησε.",
      "shop.err.relay": "Το κατάστημα δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.",
      "shop.err.server": "Το κατάστημα απάντησε με σφάλμα.", "shop.err.busy": "Το κατάστημα ζητά λίγη αναμονή.",
      "shop.err.keys": "Αυτή η συσκευή δεν έχει τα κλειδιά του καταστήματος.", "shop.err.denied": "Το orOS δεν επιτρέπει αυτή την κλήση.",
      "shop.err.gone": "Αυτό το κατάστημα αποσυνδέθηκε.", "shop.err.bad": "Κάτι πήγε στραβά.",
      "shop.err.unknown": "Το κατάστημα δεν το επιβεβαίωσε. Το πρόχειρο ίσως υπάρχει ήδη: κοίτα στο κατάστημά σου πριν ξαναδοκιμάσεις.",
      "news.btn": "Δες το βιβλίο",
      "pr.head": "ΔΕΛΤΙΟ ΤΥΠΟΥ", "pr.lead": "Κυκλοφορεί το «{t}» του/της {a}.", "pr.leadNoA": "Κυκλοφορεί το «{t}».",
      "pr.leadImp": "Οι εκδόσεις {imp} παρουσιάζουν το «{t}» του/της {a}.", "pr.leadImpNoA": "Οι εκδόσεις {imp} παρουσιάζουν το «{t}».", "pr.rel": "Ημερομηνία κυκλοφορίας: {d}.",
      "pr.about": "Για τον συγγραφέα", "pr.details": "Στοιχεία", "pr.pages": "{n} σελίδες", "pr.contact": "Επικοινωνία", "pr.docTitle": "Δελτίο τύπου: {t}",
      "set.title": "Ρυθμίσεις", "set.cur": "Νόμισμα για τις τιμές", "set.imp": "Όνομα εκδότη",
      "set.impHint": "Μπαίνει σε εξώφυλλα και δελτία τύπου.", "set.done": "Αποθηκεύτηκε",
      "toast.copied": "Αντιγράφηκε", "toast.saved": "Αποθηκεύτηκε", "toast.exported": "Αποθηκεύτηκε",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "untitled": "Χωρίς τίτλο", "by": "του/της {list}"
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);
  var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  var TBL = STR[LANG] || STR.en;
  function t(k, vars) {
    var s = TBL[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function fmtDate(ymd) {
    if (!C.okYmd(ymd)) return "";
    var p = ymd.split("-");
    try {
      return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" })
        .format(new Date(+p[0], +p[1] - 1, +p[2], 12));
    } catch (e) { return ymd; }
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-label]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-label")));
      n.title = t(n.getAttribute("data-i18n-label"));
    });
    document.title = t("app.name") + " · orOS";
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls || "btn", label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function field(label, input, hint) {
    var w = el("label", "fld");
    w.appendChild(el("span", "", label));
    w.appendChild(input);
    if (hint) w.appendChild(hint);
    return w;
  }
  function input(type, value, attrs) {
    var i = el(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") i.type = type;
    i.value = value === undefined || value === null ? "" : String(value);
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function select(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function personList(tt) {
    var a = C.authors(tt);
    return a.length ? a.join(", ") : "";
  }

  // ---------- 2. Storage, prefs, sync slice ----------
  var data = C.empty();
  var prefs = { tab: "titles", sort: "rel", st: "" };
  var view = { name: "list", id: "" };    // list | title | isbn

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null") || {};
      if (p.tab === "isbn" || p.tab === "titles" || p.tab === "roy") prefs.tab = p.tab;
      if (["rel", "t", "m"].indexOf(p.sort) >= 0) prefs.sort = p.sort;
      if (C.STATUS.indexOf(p.st) >= 0) prefs.st = p.st;
    } catch (e) { /* defaults */ }
    view.name = prefs.tab === "isbn" || prefs.tab === "roy" ? prefs.tab : "list";
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* not important */ } }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  // Every edit by the user ends here: write, then tell sync.
  function commit(next, keepEditor) {
    data = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    if (keepEditor && view.name === "title") return;
    render();
  }
  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    var before = view.name === "title" ? JSON.stringify(C.find(data, "titles", view.id)) : "";
    data = merged;
    persist();
    if (view.name === "title") {
      var now = JSON.stringify(C.find(data, "titles", view.id));
      var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (now === before || typing) return;
    }
    render();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. Shell services ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
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
  function saveBlob(blob, filename, mime, ext) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      var types = [{ description: filename, accept: {} }];
      types[0].accept[mime] = [ext];
      return host.saveFile({ blob: blob, filename: filename, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) toast(t("toast.exported")); });
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    toast(t("toast.exported"));
    return Promise.resolve();
  }
  function copyText(s) {
    function fallback() {
      var ta = el("textarea");
      ta.value = s;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* nothing more to try */ }
      ta.remove();
      toast(t("toast.copied"));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { toast(t("toast.copied")); }, fallback);
    } else fallback();
  }
  function rnd6() {
    var a = new Uint8Array(6), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function safeName(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9Ͱ-Ͽ]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 60) || "book";
  }

  // ---------- 4. Titles list ----------
  var thumbUrls = [];
  function dropThumbs() { thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); }); thumbUrls = []; }
  function coverInto(box, tt) {
    box.textContent = "📖";
    var fs = fsApi(), path = C.coverPath(tt.cov);
    if (!fs || !path) return;
    Promise.resolve(fs.readBlob(path)).then(function (b) {
      if (!b) return;
      var u = URL.createObjectURL(b);
      thumbUrls.push(u);
      var im = el("img");
      im.alt = "";
      im.src = u;
      box.textContent = "";
      box.appendChild(im);
    }).catch(function () { /* not synced yet: keep the icon */ });
  }

  function renderList() {
    var sec = $("view-list");
    sec.textContent = "";
    if (!data.titles.length) {
      var em = el("div", "empty");
      em.appendChild(el("p", "", t("empty.first")));
      em.appendChild(button(t("empty.first.btn"), "btn pri", newTitleDialog));
      sec.appendChild(em);
      return;
    }
    var tools = el("div", "list-tools");
    var q = input("search", listQ, { "aria-label": t("q.label"), placeholder: t("q.ph"), id: "q", autocomplete: "off" });
    q.addEventListener("input", function () { listQ = q.value; renderRows(); });
    var so = select([["rel", t("sort.rel")], ["t", t("sort.t")], ["m", t("sort.m")]], prefs.sort);
    so.setAttribute("aria-label", t("sort.label"));
    so.addEventListener("change", function () { prefs.sort = so.value; savePrefs(); renderRows(); });
    tools.appendChild(q);
    tools.appendChild(so);
    sec.appendChild(tools);
    var chips = el("div", "chips");
    [""].concat(C.STATUS).forEach(function (st) {
      var n = st ? data.titles.filter(function (x) { return x.st === st; }).length : data.titles.length;
      if (st && !n) return;
      var c = button((st ? t("st." + st) : t("f.all")) + " · " + n, "chip", function () {
        prefs.st = st;
        savePrefs();
        renderList();
      });
      c.setAttribute("aria-pressed", prefs.st === st ? "true" : "false");
      chips.appendChild(c);
    });
    sec.appendChild(chips);
    var ul = el("ul", "rows");
    ul.id = "rows";
    sec.appendChild(ul);
    renderRows();
  }
  var listQ = "";
  function renderRows() {
    var ul = $("rows");
    if (!ul) return;
    dropThumbs();
    ul.textContent = "";
    var rows = C.list(data, { q: listQ, st: prefs.st }, prefs.sort, LOCALE);
    if (!rows.length) { ul.appendChild(el("li", "empty", t("empty.list"))); return; }
    rows.forEach(function (tt) {
      var li = el("li");
      var b = button("", "trow", function () { openTitle(tt.id); });
      b.dataset.id = tt.id;
      var th = el("span", "thumb");
      coverInto(th, tt);
      var main = el("span", "tmain");
      main.appendChild(el("span", "tname", tt.t));
      var bits = [];
      if (tt.sub) bits.push(tt.sub);
      var who = personList(tt);
      if (who) bits.push(who);
      if (bits.length) main.appendChild(el("span", "tsub", bits.join(" · ")));
      var isbns = tt.fmts.filter(function (f) { return f.isbn; }).map(function (f) { return t("fmt." + f.k) + " " + C.hyphen(f.isbn, data.blocks); });
      if (isbns.length) main.appendChild(el("span", "tsub isbn", isbns.join(" · ")));
      var side = el("span", "tside");
      side.appendChild(el("span", "badge st-" + tt.st, t("st." + tt.st)));
      if (tt.rel) side.appendChild(el("span", "muted", fmtDate(tt.rel)));
      var g = C.gaps(tt);
      if (g.length && tt.st !== "oop") side.appendChild(el("span", "badge gap", t("gaps.n", { n: g.length })));
      b.appendChild(th);
      b.appendChild(main);
      b.appendChild(side);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function newTitleDialog(prefill) {
    var pf = prefill && typeof prefill === "object" ? prefill : {};
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("new.title")));
    var name = input("text", pf.t || "", { maxlength: "200", required: "" });
    var au = input("text", pf.author || "", { maxlength: "120" });
    dlg.appendChild(field(t("new.name"), name));
    dlg.appendChild(field(t("new.author"), au));
    var rel = input("date", pf.rel || "");
    dlg.appendChild(field(t("f.rel"), rel));
    var pl = input("checkbox", "");
    pl.checked = pf.plan !== false;
    var pll = el("label", "check");
    pll.appendChild(pl);
    pll.appendChild(el("span", "", t("new.plan")));
    dlg.appendChild(pll);
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("new.go"), "btn pri", function () {
      var nm = name.value.trim();
      if (!nm) { name.focus(); return; }
      var id = C.uid(), now = Date.now();
      var row = { id: id, t: nm, st: "idea", ppl: au.value.trim() ? [{ r: "a", n: au.value.trim() }] : [], fmts: [] };
      if (pf.isbn) row.fmts = [{ id: C.uid(), k: "pb", isbn: pf.isbn }];
      if (C.okYmd(rel.value)) {
        row.rel = rel.value;
        if (pl.checked) row.plan = C.makePlan(rel.value, [], C.uid);
      }
      dlg.close();
      commit(C.put(data, "titles", row, now));
      openTitle(id);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); go.click(); } });
    showDialog(dlg);
    name.focus();
  }

  // ---------- 5. Title editor ----------
  // The form is built once per opening; every change writes the whole
  // title (LWW per title) without rebuilding, so the caret stays put.
  // Adding or removing a person or a format rebuilds the form.
  var edTimer = 0;
  function openTitle(id) {
    if (!C.find(data, "titles", id)) return;
    setView({ name: "title", id: id });
    render();
    $("main").scrollTop = 0;
  }
  function currentTitle() { return C.find(data, "titles", view.id); }
  function writeTitle(patch, rebuild) {
    var tt = currentTitle();
    if (!tt) return;
    var next = Object.assign({}, tt, patch);
    commit(C.put(data, "titles", next, Date.now()), !rebuild);
    if (rebuild) return;
    refreshGaps();
  }
  // One pending write at a time: typing in another field first writes
  // the pending one (so a quick move from field to field loses nothing);
  // leaving the editor or the page writes it at once.
  var edPending = null, edSrc = null;
  function later(fn, src) {
    if (edPending && edSrc !== src) flushEdits();
    clearTimeout(edTimer);
    edPending = fn; edSrc = src;
    edTimer = setTimeout(flushEdits, 350);
  }
  function flushEdits() {
    clearTimeout(edTimer);
    var fn = edPending;
    edPending = null; edSrc = null;
    if (fn) fn();
  }
  function setView(v) { flushEdits(); view = v; }
  window.addEventListener("pagehide", flushEdits);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushEdits(); });

  function renderEditor() {
    var sec = $("view-title");
    sec.textContent = "";
    dropThumbs();
    var tt = currentTitle();
    if (!tt) { view = { name: "list", id: "" }; render(); return; }
    var head = el("div", "ed-head");
    head.appendChild(button("← " + t("btn.back"), "btn", function () { setView({ name: "list", id: "" }); render(); }));
    var h = el("h2", "", tt.t);
    h.id = "ed-h";
    head.appendChild(h);
    head.appendChild(button(t("btn.del"), "btn danger", function () { deleteTitle(tt); }));
    sec.appendChild(head);
    var gp = el("p", "gaps");
    gp.id = "ed-gaps";
    sec.appendChild(gp);

    // The book
    var s1 = el("section", "sec");
    s1.appendChild(el("h3", "", t("sec.main")));
    var g1 = el("div", "grid");
    function textField(key, label, max, wide) {
      var i = input("text", tt[key], { maxlength: String(max) });
      i.addEventListener("input", function () {
        later(function () {
          var p = {};
          p[key] = i.value;
          if (key === "t" && !i.value.trim()) return;
          if (key === "t") $("ed-h").textContent = i.value;
          writeTitle(p);
        }, i);
      });
      var f = field(label, i);
      if (wide) f.classList.add("wide");
      g1.appendChild(f);
      return i;
    }
    textField("t", t("f.t"), 200, true);
    textField("sub", t("f.sub"), 200, true);
    textField("ser", t("f.ser"), 120);
    textField("sn", t("f.sn"), 12);
    var st = select(C.STATUS.map(function (s) { return [s, t("st." + s)]; }), tt.st);
    st.addEventListener("change", function () { writeTitle({ st: st.value }); });
    g1.appendChild(field(t("f.st"), st));
    var rel = input("date", tt.rel);
    rel.addEventListener("change", function () { if (!rel.value || C.okYmd(rel.value)) { writeTitle({ rel: rel.value }); renderPlan(); } });
    g1.appendChild(field(t("f.rel"), rel));
    textField("lang", t("f.lang"), 40);
    s1.appendChild(g1);
    sec.appendChild(s1);

    // Release plan (wave P4)
    var sp = el("section", "sec plan");
    sp.id = "ed-plan";
    sec.appendChild(sp);
    renderPlan();

    // Royalty terms (wave P6)
    var sr = el("section", "sec roy");
    sr.id = "ed-roy";
    sec.appendChild(sr);
    renderTerms();

    // People
    var s2 = el("section", "sec");
    var h2 = el("h3", "", t("sec.ppl"));
    s2.appendChild(h2);
    function pplFromDom() {
      return [].map.call(s2.querySelectorAll(".person"), function (row) {
        return { r: row.querySelector("select").value, n: row.querySelector("input").value, crm: row.dataset.crm || undefined };
      }).filter(function (p) { return p.n.trim(); });
    }
    if (!tt.ppl.length) s2.appendChild(el("p", "muted", t("ppl.none")));
    tt.ppl.forEach(function (p, i) {
      var row = el("div", "person");
      if (p.crm) row.dataset.crm = p.crm;
      var r = select(C.ROLES.map(function (x) { return [x, t("role." + x)]; }), p.r);
      r.setAttribute("aria-label", t("ppl.role"));
      var n = input("text", p.n, { maxlength: "120", "aria-label": t("ppl.name") });
      var del = button("✕", "icon-btn", function () {
        var list = tt.ppl.slice();
        list.splice(i, 1);
        writeTitle({ ppl: list }, true);
      });
      del.setAttribute("aria-label", t("btn.remove"));
      r.addEventListener("change", function () { writeTitle({ ppl: pplFromDom() }); });
      n.addEventListener("input", function () { later(function () { writeTitle({ ppl: pplFromDom() }); }, n); });
      row.appendChild(r);
      row.appendChild(n);
      row.appendChild(del);
      s2.appendChild(row);
    });
    if (tt.ppl.length < C.MAX_PPL) s2.appendChild(button(t("ppl.add"), "btn small", function () { addPersonDialog(); }));
    sec.appendChild(s2);

    // Formats
    var s3 = el("section", "sec");
    s3.appendChild(el("h3", "", t("sec.fmts")));
    if (!tt.fmts.length) s3.appendChild(el("p", "muted", t("fmt.none")));
    tt.fmts.forEach(function (f) { s3.appendChild(formatBox(tt, f)); });
    if (tt.fmts.length < C.MAX_FMTS) {
      s3.appendChild(button(t("fmt.add"), "btn small", function () {
        var kinds = tt.fmts.map(function (x) { return x.k; });
        var k = ["pb", "eb", "ab", "hb", "ot"].filter(function (x) { return kinds.indexOf(x) < 0; })[0] || "ot";
        writeTitle({ fmts: tt.fmts.concat([{ id: C.uid(), k: k }]) }, true);
      }));
    }
    sec.appendChild(s3);

    // Texts
    var s4 = el("section", "sec");
    s4.appendChild(el("h3", "", t("sec.texts")));
    [["blurb", 4000, "textarea"], ["bio", 3000, "textarea"], ["kw", 400, "text"], ["notes", 4000, "textarea"]].forEach(function (d) {
      var i = input(d[2], tt[d[0]], { maxlength: String(d[1]) });
      i.addEventListener("input", function () { later(function () { var p = {}; p[d[0]] = i.value; writeTitle(p); }, i); });
      s4.appendChild(field(t("f." + d[0]), i));
    });
    sec.appendChild(s4);

    // Cover
    var s5 = el("section", "sec");
    s5.appendChild(el("h3", "", t("sec.cover")));
    s5.appendChild(coverBox(tt));
    sec.appendChild(s5);

    // To other apps (wave P2)
    sec.appendChild(sendBox(tt));
    refreshGaps();
  }
  function refreshGaps() {
    var gp = $("ed-gaps"), tt = currentTitle();
    if (!gp || !tt) return;
    var g = C.gaps(tt);
    gp.className = "gaps" + (g.length ? "" : " none");
    gp.textContent = g.length ? t("gaps", { list: g.map(function (k) { return t("gap." + k); }).join(", ") }) : t("gaps.none");
  }
  function addPersonDialog() {
    var tt = currentTitle();
    if (!tt) return;
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("ppl.add").replace(/^\+\s*/, "")));
    var r = select(C.ROLES.map(function (x) { return [x, t("role." + x)]; }), tt.ppl.some(function (p) { return p.r === "a"; }) ? "t" : "a");
    var n = input("text", "", { maxlength: "120" });
    dlg.appendChild(field(t("ppl.role"), r));
    dlg.appendChild(field(t("ppl.name"), n));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("btn.add"), "btn pri", function () {
      if (!n.value.trim()) { n.focus(); return; }
      dlg.close();
      writeTitle({ ppl: tt.ppl.concat([{ r: r.value, n: n.value.trim() }]) }, true);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); go.click(); } });
    showDialog(dlg);
    n.focus();
  }

  function isbnHint(hint, raw, tt, f) {
    hint.className = "hint";
    hint.textContent = "";
    var v = raw.trim();
    if (!v) return;
    var p = C.parseIsbn(v);
    if (!p.ok) { hint.className = "hint bad"; hint.textContent = t("isbn." + p.why); return; }
    var uses = (C.used(data)[p.isbn] || []).filter(function (u) { return !(u.title === tt.id && u.fmt === f.id); });
    if (uses.length) {
      hint.className = "hint bad";
      hint.textContent = t("isbn.clash", { list: uses.map(useLabel).join(", ") });
      return;
    }
    var ten = C.isbn10(p.isbn);
    hint.className = "hint good";
    hint.textContent = ten ? t("isbn.ok", { ten: ten }) : t("isbn.ok13");
  }
  function useLabel(u) {
    if (u.x) return t("isbn.elsewhere");
    var tt = C.find(data, "titles", u.title);
    var f = tt && tt.fmts.filter(function (x) { return x.id === u.fmt; })[0];
    return (tt ? tt.t : "?") + (f ? " (" + t("fmt." + f.k) + ")" : "");
  }

  function formatBox(tt, f) {
    var box = el("div", "fmt");
    function fmtsWith(patch) {
      var cur = currentTitle();
      return cur.fmts.map(function (x) { return x.id === f.id ? Object.assign({}, x, patch) : x; });
    }
    var head = el("div", "fmt-head");
    var k = select(C.FMT_KINDS.map(function (x) { return [x, t("fmt." + x)]; }), f.k);
    k.setAttribute("aria-label", t("fmt.kind"));
    k.addEventListener("change", function () { writeTitle({ fmts: fmtsWith({ k: k.value }) }, true); });
    head.appendChild(k);
    var bc = button(t("fmt.barcode"), "btn small", function () { barcodeDialog(currentTitle(), f.id); });
    bc.disabled = !f.isbn;
    head.appendChild(bc);
    if (f.k === "pb" || f.k === "hb") head.appendChild(button(t("fmt.cover"), "btn small", function () { coverInLayout(currentTitle(), f.id); }));
    head.appendChild(button(t("fmt.del"), "btn small danger", function () {
      writeTitle({ fmts: currentTitle().fmts.filter(function (x) { return x.id !== f.id; }) }, true);
    }));
    box.appendChild(head);

    var grid = el("div", "grid");
    // ISBN with "next free"
    var isbnIn = input("text", f.isbn ? C.hyphen(f.isbn, data.blocks) : "", { inputmode: "numeric", maxlength: "20", autocomplete: "off", spellcheck: "false" });
    var hint = el("span", "hint");
    var row = el("span", "inrow");
    row.appendChild(isbnIn);
    var nx = button(t("fmt.next"), "btn small", function () {
      giveNextFree(function (isbn) {
        isbnIn.value = C.hyphen(isbn, data.blocks);
        isbnHint(hint, isbnIn.value, currentTitle(), f);
        writeTitle({ fmts: fmtsWith({ isbn: isbn }) });
        bc.disabled = false;
      });
    });
    row.appendChild(nx);
    function onIsbn() {
      isbnHint(hint, isbnIn.value, currentTitle(), f);
      var p = C.parseIsbn(isbnIn.value);
      var v = isbnIn.value.trim() ? (p.ok ? p.isbn : null) : "";
      bc.disabled = !v;
      if (v === null) return;      // keep the old number until the new one is valid
      writeTitle({ fmts: fmtsWith({ isbn: v }) });
    }
    isbnIn.addEventListener("input", function () { later(onIsbn, isbnIn); });
    isbnIn.addEventListener("blur", function () {
      var p = C.parseIsbn(isbnIn.value);
      if (p.ok) isbnIn.value = C.hyphen(p.isbn, data.blocks);
    });
    var fi = field(t("fmt.isbn"), row, hint);
    fi.classList.add("wide");
    grid.appendChild(fi);
    isbnHint(hint, isbnIn.value, tt, f);

    function numField(key, label, step, max) {
      var i = input("number", f[key] || "", { min: "0", max: String(max), step: step, inputmode: "decimal" });
      i.addEventListener("input", function () {
        later(function () { var p = {}; p[key] = i.value === "" ? 0 : C.num(i.value, 0, max, step === "0.01" ? 2 : step === "0.1" ? 1 : 0); writeTitle({ fmts: fmtsWith(p) }); }, i);
      });
      grid.appendChild(field(label, i));
    }
    function txtField(key, label, max) {
      var i = input("text", f[key], { maxlength: String(max) });
      i.addEventListener("input", function () { later(function () { var p = {}; p[key] = i.value; writeTitle({ fmts: fmtsWith(p) }); }, i); });
      grid.appendChild(field(label, i));
    }
    numField("price", t("fmt.price", { cur: data.set.cur }), "0.01", 1e6);
    if (f.k === "pb" || f.k === "hb" || f.k === "ot") {
      numField("pages", t("fmt.pages"), "1", 100000);
      numField("w", t("fmt.w"), "0.1", 2000);
      numField("h", t("fmt.h"), "0.1", 2000);
      numField("sp", t("fmt.sp"), "0.1", 500);
      numField("wt", t("fmt.wt"), "1", 100000);
      txtField("bind", t("fmt.bind"), 60);
      txtField("paper", t("fmt.paper"), 80);
    }
    if (f.k === "eb") numField("pages", t("fmt.pages"), "1", 100000);
    if (f.k === "ab") numField("dur", t("fmt.dur"), "1", 100000);
    txtField("note", t("fmt.note"), 200);
    box.appendChild(grid);
    return box;
  }

  // The next free number from the house's blocks (asks which block when
  // there are several with room).
  function giveNextFree(done) {
    var open = data.blocks.map(function (b) { return { b: b, n: C.nextFree(data, b.id) }; }).filter(function (x) { return x.n; });
    if (!data.blocks.length) { toast(t("isbn.noBlock")); return; }
    if (!open.length) { toast(t("isbn.full")); return; }
    if (open.length === 1) { done(open[0].n); return; }
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("isbn.pickBlock")));
    open.forEach(function (x) {
      var b = button(x.b.p + (x.b.note ? " · " + x.b.note : "") + " → " + C.hyphen(x.n, data.blocks), "btn", function () { dlg.close(); done(x.n); });
      b.style.display = "block";
      b.style.width = "100%";
      b.style.marginBottom = "6px";
      b.style.whiteSpace = "normal";
      dlg.appendChild(b);
    });
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function deleteTitle(tt) {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("del.title", { t: tt.t })));
    dlg.appendChild(el("p", "muted", t("del.body")));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    acts.appendChild(button(t("btn.del"), "btn pri", function () {
      dlg.close();
      var keep = JSON.parse(JSON.stringify(tt));
      setView({ name: "list", id: "" });
      commit(C.remove(data, "titles", tt.id, Date.now()));
      if (tt.cov) dropCoverLater(tt.cov);
      toast(t("del.done", { t: tt.t }), t("btn.undo"), function () {
        commit(C.put(data, "titles", keep, Date.now()));
        openTitle(keep.id);
      });
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 6. Cover picture ----------
  var COVER_MAX_IN = 60 * 1024 * 1024;
  function encodeCover(file) {
    return new Promise(function (resolve) {
      if (!file || file.size > COVER_MAX_IN || !/^image\//.test(file.type || "image/")) { resolve(null); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h || 1));
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? b : null); }, "image/jpeg", 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  // A file no live title points at leaves the disk after the Undo window.
  function dropCoverLater(name) {
    var fs = fsApi();
    if (!fs || !name) return;
    setTimeout(function () {
      if (C.coversInUse(data).indexOf(name) >= 0) return;
      var p = C.coverPath(name);
      if (p) Promise.resolve(fs.rm(p)).catch(function () { /* already gone */ });
    }, 15000);
  }
  function coverBox(tt) {
    var box = el("div", "cover-box"), fs = fsApi();
    var th = el("span", "thumb");
    coverInto(th, tt);
    box.appendChild(th);
    var acts = el("div", "cover-acts");
    if (!fs) acts.appendChild(el("p", "muted", t("cov.noDisk")));
    else {
      acts.appendChild(button(tt.cov ? t("cov.change") : "📷 " + t("cov.add"), "btn", function () {
        pickFile("image/*").then(function (file) {
          if (!file) return;
          return encodeCover(file).then(function (blob) {
            if (!blob) { toast(t("cov.bad")); return; }
            var cur = currentTitle();
            if (!cur) return;
            var nm = safeName(cur.id).toLowerCase() + "-" + rnd6() + ".jpg";
            return Promise.resolve(fs.writeBlob(C.COVER_DIR + "/" + nm, blob)).then(function () {
              var old = cur.cov;
              writeTitle({ cov: nm }, true);
              if (old) dropCoverLater(old);
            });
          });
        }).catch(function () { toast(t("cov.noDisk")); });
      }));
      if (tt.cov) acts.appendChild(button(t("btn.remove"), "btn danger", function () {
        var old = tt.cov;
        writeTitle({ cov: "" }, true);
        dropCoverLater(old);
      }));
      acts.appendChild(el("p", "muted", t("cov.hint")));
    }
    box.appendChild(acts);
    return box;
  }

  // The Book cover dialog of Layout, filled in from this title and
  // format (Layout's own deep link { cover }); nothing is made there
  // until Create.
  function coverInLayout(tt, fmtId) {
    flushEdits();
    tt = currentTitle() || tt;
    var f = tt && tt.fmts.filter(function (x) { return x.id === fmtId; })[0];
    if (!f) return;
    var price = "";
    if (f.price) {
      try { price = new Intl.NumberFormat(LOCALE, { style: "currency", currency: data.set.cur }).format(f.price); }
      catch (e) { price = f.price + " " + data.set.cur; }
    }
    var pre = {
      title: tt.t, sub: tt.sub, author: C.authors(tt).join(", "), blurb: tt.blurb, imprint: data.set.imp,
      isbn: f.isbn, isbnShown: f.isbn ? C.hyphen(f.isbn, data.blocks) : "", price: price,
      pages: f.pages || 0, w: f.w || 0, h: f.h || 0, spine: f.sp || 0
    };
    var p = tt.cov ? C.coverPath(tt.cov) : null;
    if (p) pre.img = p;
    try { window.parent.__orosOpenAt("layout", { cover: pre }); }
    catch (e) { toast(t("cov.noLayout")); }
  }

  // ---------- 6a. Release plan (wave P4) ----------
  var PF = window.OrosPublishFeed;
  function stageName(st) { return PF ? PF.stage(st.k, st.n, LANG) : (st.n || st.k); }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function writePlan(plan) {
    writeTitle({ plan: C.sortPlan(plan) });
    renderPlan();
  }
  function renderPlan() {
    var box = $("ed-plan"), tt = currentTitle();
    if (!box || !tt) return;
    box.textContent = "";
    box.appendChild(el("h3", "", t("plan.title")));
    var plan = tt.plan || [];
    if (!plan.length) {
      box.appendChild(el("p", "muted", t("plan.none")));
      var mk = button(t("plan.make"), "btn small pri", function () { writePlan(C.makePlan(currentTitle().rel, [], C.uid)); });
      mk.disabled = !tt.rel;
      box.appendChild(mk);
      if (!tt.rel) box.appendChild(el("p", "muted small", t("plan.noRel")));
      return;
    }
    var today = todayYmd(), ps = C.planState(tt, today);
    var sum = el("p", "plan-sum" + (ps.late.length ? " bad" : ""));
    var bits = [];
    if (ps.late.length) bits.push(t("plan.lateN", { n: ps.late.length }));
    if (ps.next) bits.push(t("plan.next", { s: stageName(ps.next), d: fmtDate(ps.next.d) }));
    if (!ps.late.length && !ps.next) bits.push(ps.done === ps.total ? t("plan.allDone") : "");
    sum.textContent = bits.filter(Boolean).join(" · ");
    box.appendChild(sum);
    var ul = el("ul", "plan-list");
    C.sortPlan(plan).forEach(function (st) {
      var li = el("li", "step" + (st.done ? " done" : "") + (!st.done && st.d && st.d < today ? " late" : ""));
      var cb = input("checkbox", "");
      cb.checked = !!st.done;
      cb.setAttribute("aria-label", stageName(st));
      cb.addEventListener("change", function () { patchStep(st.id, { done: cb.checked ? 1 : 0 }); });
      li.appendChild(cb);
      var nm = el("span", "step-name", stageName(st));
      li.appendChild(nm);
      if (!st.done && st.d && st.d < today) li.appendChild(el("span", "badge late", t("plan.late")));
      var d = input("date", st.d);
      d.setAttribute("aria-label", stageName(st));
      d.addEventListener("change", function () { if (!d.value || C.okYmd(d.value)) patchStep(st.id, { d: d.value }); });
      li.appendChild(d);
      var del = button("✕", "icon-btn", function () { writePlan(currentTitle().plan.filter(function (x) { return x.id !== st.id; })); });
      del.setAttribute("aria-label", t("plan.del"));
      del.title = t("plan.del");
      li.appendChild(del);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var acts = el("div", "send-row");
    var rd = button(t("plan.redate"), "btn small", function () { writePlan(C.makePlan(currentTitle().rel, currentTitle().plan, C.uid)); });
    rd.disabled = !tt.rel;
    rd.title = t("plan.redateHint");
    acts.appendChild(rd);
    acts.appendChild(button(t("plan.add"), "btn small", addStepDialog));
    acts.appendChild(button("✅ " + t("plan.todo"), "btn small", planToTodo));
    box.appendChild(acts);
  }
  function patchStep(id, patch) {
    var tt = currentTitle();
    if (!tt) return;
    writePlan((tt.plan || []).map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; }));
  }
  function addStepDialog() {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("plan.add").replace(/^\+\s*/, "")));
    var n = input("text", "", { maxlength: "80" });
    dlg.appendChild(field(t("plan.addName"), n));
    var d = input("date", "");
    dlg.appendChild(field(t("plan.date"), d));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("btn.add"), "btn pri", function () {
      var tt = currentTitle();
      if (!tt || !n.value.trim() || (tt.plan || []).length >= C.MAX_PLAN) return;
      dlg.close();
      writePlan((tt.plan || []).concat([{ id: C.uid(), k: "x", n: n.value.trim(), d: C.okYmd(d.value) ? d.value : "", done: 0 }]));
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); go.click(); } });
    showDialog(dlg);
    n.focus();
  }
  function planToTodo() {
    flushEdits();
    var tt = currentTitle();
    if (!tt) return;
    var open = C.sortPlan((tt.plan || []).filter(function (x) { return !x.done; }));
    if (!open.length) { toast(t("plan.todoNone")); return; }
    var items = open.map(function (x) {
      return { text: stageName(x) + " · " + tt.t, note: x.d ? t("plan.todoBy", { d: fmtDate(x.d), t: tt.t }) : tt.t };
    });
    openAt("todo", { addItems: { newList: tt.t.slice(0, 60), from: t("app.name"), items: items.slice(0, 50) } });
  }

  // ---------- 6b. To other apps (wave P2) ----------
  // The shop gets a draft through Connected services (the person's own
  // WooCommerce keys, kept by the shell); Stock, Newsletter and Writer
  // get prefills they show before anything is saved.
  var sendFmt = { title: "", fmt: "" };
  function links() {
    try { return window.parent && window.parent !== window && window.parent.orosLinks && typeof window.parent.orosLinks.list === "function" ? window.parent.orosLinks : null; }
    catch (e) { return null; }
  }
  function openAt(app, target) {
    try { window.parent.__orosOpenAt(app, target); return true; }
    catch (e) { toast(t("send.noApp")); return false; }
  }
  function fmtLabel(tt, f) { return tt.fmts.length > 1 ? t("fmt." + f.k) : ""; }
  function money(v) {
    try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: data.set.cur }).format(v); }
    catch (e) { return v + " " + data.set.cur; }
  }
  function shopAcct(f) {
    var Lk = links();
    var list = Lk ? Lk.list("woo") : [];
    return f.wp ? list.filter(function (a) { return a.id === f.wp.a; })[0] || null : null;
  }
  // https only: an address the person typed for their own shop
  function shopUrl(a, path) {
    var site = a && typeof a.site === "string" ? a.site.replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s\/?#@]+(\/[^\s?#]*)?$/i.test(site) ? site + path : "";
  }
  // a name from the shop as plain text: tags out, entities decoded (shown with textContent)
  function shopText(v) {
    var ent = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
    return String(v || "").replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, function (all, e) {
      var cp = e[0] !== "#" ? null : (e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      if (cp === null) return ent[e.toLowerCase()] || all;
      return cp > 31 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : all;
    }).replace(/\s+/g, " ").trim().slice(0, 120);
  }
  function sendBox(tt) {
    var box = el("section", "sec send");
    box.appendChild(el("h3", "", t("send.title")));
    box.appendChild(el("p", "muted small", t("send.hint")));
    if (sendFmt.title !== tt.id || !tt.fmts.some(function (f) { return f.id === sendFmt.fmt; })) {
      sendFmt = { title: tt.id, fmt: tt.fmts.length ? tt.fmts[0].id : "" };
    }
    function cur() {
      var x = currentTitle();
      return x && x.fmts.filter(function (f) { return f.id === sendFmt.fmt; })[0];
    }
    var row = el("div", "send-row");
    var link = el("p", "send-link");
    function showLink() {
      link.textContent = "";
      var f = cur(), a = f && shopAcct(f), u = a ? shopUrl(a, "/wp-admin/post.php?post=" + f.wp.id + "&action=edit") : "";
      if (!f || !f.wp) { link.hidden = true; return; }
      link.hidden = false;
      link.appendChild(el("span", "", t("send.linked", { id: f.wp.id }) + " "));
      if (u) {
        var an = el("a", "", t("send.open"));
        an.href = u;
        an.target = "_blank";
        an.rel = "noopener noreferrer";
        link.appendChild(an);
      }
    }
    if (tt.fmts.length > 1) {
      var fs = select(tt.fmts.map(function (f) { return [f.id, t("fmt." + f.k) + (f.isbn ? " · " + C.hyphen(f.isbn, data.blocks) : "")]; }), sendFmt.fmt);
      fs.addEventListener("change", function () { sendFmt.fmt = fs.value; showLink(); });
      box.appendChild(field(t("send.fmt"), fs));
    }
    var fmtBtns = [
      button("🛍️ " + t("send.shop"), "btn small", function () { var f = cur(); if (f) shopDialog(f.id); }),
      button("📦 " + t("send.stock"), "btn small", function () {
        flushEdits();
        var x = currentTitle(), f = cur();
        if (x && f) openAt("stock", { newItem: C.stockPrefill(x, f, fmtLabel(x, f)) });
      })
    ];
    fmtBtns.forEach(function (b) { b.disabled = !tt.fmts.length; row.appendChild(b); });
    row.appendChild(button("📰 " + t("send.news"), "btn small", function () {
      flushEdits();
      var x = currentTitle(), f = cur(), a = f && shopAcct(f);
      if (!x) return;
      var href = a ? shopUrl(a, "/?p=" + f.wp.id) : "";
      openAt("newsletter", { asAdd: { blocks: C.newsBlocks(x, { btn: t("news.btn"), href: href }), subj: x.t } });
    }));
    row.appendChild(button("📝 " + t("send.pr"), "btn small", function () {
      flushEdits();
      var x = currentTitle();
      if (!x) return;
      var S = {};
      ["head", "lead", "leadNoA", "leadImp", "leadImpNoA", "rel", "about", "details", "pages", "contact", "docTitle"].forEach(function (k) { S[k] = t("pr." + k); });
      var rows = x.fmts.map(function (f) {
        return { label: t("fmt." + f.k), isbn: f.isbn ? C.hyphen(f.isbn, data.blocks) : "", pages: f.pages || 0, price: f.price ? money(f.price) : "" };
      });
      openAt("writer", { newDoc: C.pressRelease(x, rows, S, { imp: data.set.imp, rel: fmtDate(x.rel) }) });
    }));
    box.appendChild(row);
    if (!tt.fmts.length) box.appendChild(el("p", "muted small", t("send.noFmt")));
    box.appendChild(link);
    showLink();
    return box;
  }

  function shopDialog(fmtId) {
    flushEdits();
    var tt = currentTitle();
    var f = tt && tt.fmts.filter(function (x) { return x.id === fmtId; })[0];
    if (!f) return;
    var Lk = links();
    var accts = Lk ? Lk.list("woo") : [];
    var dlg = el("dialog", "shop-dlg");
    dlg.appendChild(el("h3", "", t("shop.title", { fmt: t("fmt." + f.k) })));
    var acts = el("div", "acts");
    if (!accts.length) {
      dlg.appendChild(el("p", "", t("shop.none")));
      acts.appendChild(button(t("btn.close"), "btn", function () { dlg.close(); }));
      acts.appendChild(button(t("shop.connect"), "btn pri", function () { dlg.close(); openAt("settings", "services"); }));
      dlg.appendChild(acts);
      showDialog(dlg);
      return;
    }
    var pick = select(accts.map(function (a) { return [a.id, a.name || a.site || a.id]; }),
      f.wp && accts.some(function (a) { return a.id === f.wp.a; }) ? f.wp.a : accts[0].id);
    if (accts.length > 1) dlg.appendChild(field(t("shop.acct"), pick));
    dlg.appendChild(el("p", "muted", t("shop.what")));
    var msg = el("p", "shop-msg");
    msg.setAttribute("role", "status");
    dlg.appendChild(msg);
    var go = button(t("shop.go"), "btn pri", run);
    acts.appendChild(button(t("btn.close"), "btn", function () { dlg.close(); }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    showDialog(dlg);

    function say(text, bad) { msg.textContent = text; msg.className = "shop-msg" + (bad ? " bad" : ""); }
    function fail(e) {
      var code = (e && e.code) || (typeof e === "string" ? e : "bad");
      var k = "shop.err." + code;
      say(t(k) === k ? t("shop.err.bad") : t(k), true);
      go.disabled = false;
    }
    function ok(x) { return x && x.status >= 200 && x.status < 300; }
    // the link lives on the format; a format removed meanwhile keeps nothing
    function remember(acct, id) {
      var x = currentTitle();
      if (!x || x.id !== tt.id || !x.fmts.some(function (y) { return y.id === f.id; })) return;
      writeTitle({ fmts: x.fmts.map(function (y) { return y.id === f.id ? Object.assign({}, y, { wp: { a: acct, id: id } }) : y; }) }, true);
    }
    function run() {
      var acct = pick.value;
      go.disabled = true;
      say(t("shop.busy"));
      flushEdits();
      var x = currentTitle() || tt;
      var ff = x.fmts.filter(function (y) { return y.id === f.id; })[0] || f;
      var reqs = [
        { m: "GET", path: "/data/currencies/current" },
        { m: "GET", path: "/settings/products/woocommerce_weight_unit" },
        { m: "GET", path: "/settings/products/woocommerce_dimension_unit" }
      ];
      if (ff.isbn) reqs.push({ m: "GET", path: "/products?sku=" + ff.isbn });
      Lk.call(acct, reqs).then(function (res) {
        var code = Lk.statusCode(res[0]);
        if (code) throw { code: code };
        var shopCur = res[0].data && typeof res[0].data.code === "string" ? res[0].data.code : "";
        var wu = ok(res[1]) && res[1].data ? String(res[1].data.value || "") : "";
        var du = ok(res[2]) && res[2].data ? String(res[2].data.value || "") : "";
        var found = ff.isbn && ok(res[3]) && Array.isArray(res[3].data) ? res[3].data.filter(function (p) { return p && p.id > 0; })[0] : null;
        if (found) {
          remember(acct, found.id);
          say(t("shop.exists", { name: shopText(found.name), id: found.id }));
          return;
        }
        var samePrice = !shopCur || shopCur === data.set.cur;
        var body = C.shopDraft(x, ff, { label: fmtLabel(x, ff), about: t("f.bio"), wu: wu, du: du, price: samePrice });
        return Lk.call(acct, [{ m: "POST", path: "/products", body: body }]).then(function (r) {
          var y = r[0];
          if (ok(y) && y.data && y.data.id > 0) {
            remember(acct, y.data.id);
            say(t("shop.done", { id: y.data.id }) + (samePrice || !ff.price ? "" : " " + t("shop.cur", { shop: shopCur, mine: data.set.cur })));
            return;
          }
          if (y && y.status === 400 && y.data && /sku/.test(String(y.data.code || ""))) { say(t("shop.dup"), true); go.disabled = false; return; }
          throw { code: Lk.statusCode(y) || "bad" };
        });
      }).catch(fail);
    }
  }

  // ---------- 6c. Royalties (wave P6) ----------
  // Terms live on the title (section Royalties); the tab lists who is
  // paid and the statements issued. A statement is built from Stock's
  // sales (royalty.js), the units can be corrected or typed, and once
  // issued it is a record: printed, e-mailed, added to Budget, paid.
  var RY = window.OrosPublishRoyalty;
  var STOCK_KEY = "oros-stock-data";
  function stockData() {
    try { var d = JSON.parse(localStorage.getItem(STOCK_KEY) || "null"); return d && typeof d === "object" ? d : null; }
    catch (e) { return null; }
  }
  function cents(c) { return money((c || 0) / 100); }
  function writeTerms(roy) {
    writeTitle({ roy: roy });
    renderTerms();
  }
  function renderTerms() {
    var box = $("ed-roy"), tt = currentTitle();
    if (!box || !tt) return;
    box.textContent = "";
    box.appendChild(el("h3", "", t("sec.roy")));
    var roy = tt.roy || [];
    if (!roy.length) box.appendChild(el("p", "muted", t("roy.none")));
    var dl = el("datalist");
    dl.id = "roy-names";
    (tt.ppl || []).forEach(function (p) { var o = el("option"); o.value = p.n; dl.appendChild(o); });
    box.appendChild(dl);
    function patch(id, p) {
      var cur = currentTitle();
      if (!cur) return;
      writeTitle({ roy: (cur.roy || []).map(function (x) { return x.id === id ? Object.assign({}, x, p) : x; }) });
    }
    roy.forEach(function (r) {
      var row = el("div", "fmt roy-term");
      var g = el("div", "grid");
      var who = input("text", r.n, { maxlength: "120", list: "roy-names" });
      who.addEventListener("change", function () { if (who.value.trim()) patch(r.id, { n: who.value.trim() }); });
      g.appendChild(field(t("roy.who"), who));
      var pct = input("text", String(r.pct).replace(".", LANG === "en" ? "." : ","), { inputmode: "decimal", maxlength: "6" });
      pct.addEventListener("change", function () { var v = C.num(pct.value, 0, 100, 2); patch(r.id, { pct: v }); });
      g.appendChild(field(t("roy.pct"), pct));
      var base = select(C.ROY_BASES.map(function (b) { return [b, t("roy.base." + b)]; }), r.base);
      base.addEventListener("change", function () { patch(r.id, { base: base.value }); });
      g.appendChild(field(t("roy.base"), base));
      var k = select([["", t("roy.k.all")]].concat(C.FMT_KINDS.map(function (x) { return [x, t("fmt." + x)]; })), r.k);
      k.addEventListener("change", function () { patch(r.id, { k: k.value }); });
      g.appendChild(field(t("roy.k"), k));
      var adv = input("text", r.adv ? String(r.adv) : "", { inputmode: "decimal", maxlength: "10" });
      adv.addEventListener("change", function () { patch(r.id, { adv: C.num(adv.value, 0, 1e7, 2) }); });
      g.appendChild(field(t("roy.adv", { cur: data.set.cur }), adv));
      row.appendChild(g);
      var del = button("✕ " + t("roy.del"), "btn small", function () {
        writeTerms((currentTitle().roy || []).filter(function (x) { return x.id !== r.id; }));
      });
      row.appendChild(del);
      box.appendChild(row);
    });
    var acts = el("div", "send-row");
    var add = button(t("roy.add"), "btn small", function () {
      var cur = currentTitle();
      if (!cur || (cur.roy || []).length >= C.MAX_ROY) return;
      var a = C.authors(cur)[0] || ((cur.ppl || [])[0] || {}).n || "";
      writeTerms((cur.roy || []).concat([{ id: C.uid(), n: a || "?", pct: 10, base: "list", k: "", adv: 0 }]));
    });
    acts.appendChild(add);
    box.appendChild(acts);
  }

  function stmtLabel(st) { return t("roy.stFor", { n: st.n, from: fmtDate(st.from), to: fmtDate(st.to) }); }
  function renderRoy() {
    var sec = $("view-roy");
    sec.textContent = "";
    sec.appendChild(el("p", "muted", t("roy.hint")));
    var hd = el("div", "ed-head");
    hd.appendChild(el("h2", "", t("roy.people")));
    sec.appendChild(hd);
    var ps = RY ? RY.people(data) : [];
    if (!ps.length) sec.appendChild(el("p", "muted", t("roy.peopleNone")));
    ps.forEach(function (p) {
      var row = el("div", "trow roy-person");
      var body = el("div", "tmain");
      body.appendChild(el("div", "tname", p.n));
      body.appendChild(el("div", "tsub", t("roy.titlesN", { n: p.titles.length }) + " · " + p.titles.map(function (x) { return x.t; }).join(", ")));
      row.appendChild(body);
      row.appendChild(button(t("roy.newSt"), "btn small pri", function (e) { e.stopPropagation(); newStatement(p.n); }));
      sec.appendChild(row);
    });
    var h2 = el("div", "ed-head");
    h2.appendChild(el("h2", "", t("roy.stmts")));
    sec.appendChild(h2);
    var list = (data.stmts || []).slice().sort(function (a, b) { return a.to < b.to ? 1 : a.to > b.to ? -1 : (a.n < b.n ? -1 : 1); });
    if (!list.length) sec.appendChild(el("p", "muted", t("roy.stmtsNone")));
    list.forEach(function (st) {
      var row = button("", "trow roy-st" + (st.v === 1 ? " void" : ""), function () { viewStatement(st.id); });
      var body = el("div", "tmain");
      body.appendChild(el("div", "tname", stmtLabel(st)));
      body.appendChild(el("div", "tsub", st.v === 1 ? t("roy.void") : (st.paid ? t("roy.paidOn", { d: fmtDate(st.paid) }) : t("roy.unpaid"))));
      row.appendChild(body);
      row.appendChild(el("span", "roy-amt", cents(st.due)));
      sec.appendChild(row);
    });
  }

  function newStatement(name) {
    if (!RY) return;
    var dlg = el("dialog", "roy-dlg");
    dlg.appendChild(el("h3", "", t("roy.st") + " · " + name));
    var pers = RY.periods(todayYmd());
    var g = el("div", "grid");
    var per = select(pers.map(function (p) { return [p.id, t("roy.p." + p.id)]; }).concat([["custom", t("roy.p.custom")]]), "half");
    g.appendChild(field(t("roy.period"), per));
    var from = input("date", pers[0].from), to = input("date", pers[0].to);
    g.appendChild(field(t("roy.from"), from));
    g.appendChild(field(t("roy.to"), to));
    dlg.appendChild(g);
    per.addEventListener("change", function () {
      var p = pers.filter(function (x) { return x.id === per.value; })[0];
      if (p) { from.value = p.from; to.value = p.to; }
      build();
    });
    [from, to].forEach(function (i) { i.addEventListener("change", function () { per.value = "custom"; build(); }); });
    var body = el("div", "roy-body");
    dlg.appendChild(body);
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("roy.issue"), "btn pri", issue);
    acts.appendChild(go);
    dlg.appendChild(acts);
    var st = null;
    function build() {
      body.textContent = "";
      st = null;
      if (!C.okYmd(from.value) || !C.okYmd(to.value) || from.value > to.value) { go.disabled = true; return; }
      st = RY.build(data, stockData(), name, from.value, to.value, data.set.cur);
      if (!st.rows.length) { body.appendChild(el("p", "muted", t("roy.empty"))); go.disabled = true; return; }
      go.disabled = false;
      if (st.warn.closed) body.appendChild(el("p", "warnbox", t("roy.warnClosed")));
      if (st.warn.missing.length) body.appendChild(el("p", "warnbox", t("roy.warnMissing", { list: st.warn.missing.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(", ") })));
      var tb = el("div", "roy-rows");
      st.rows.forEach(function (r, i) {
        var line = el("div", "roy-row");
        var nm = el("div", "roy-name");
        nm.appendChild(el("div", "", r.t));
        nm.appendChild(el("div", "muted small", t("fmt." + r.k) + (r.isbn ? " · " + C.hyphen(r.isbn, data.blocks) : "") + " · " + r.pct + "% " + t("roy.base." + r.base).toLowerCase()));
        line.appendChild(nm);
        var q = input("text", String(r.q).replace(".", LANG === "en" ? "." : ","), { inputmode: "decimal", maxlength: "10", "aria-label": t("roy.units") + ": " + r.t });
        q.addEventListener("input", function () { setRow(i, "q", q); });
        line.appendChild(field(t("roy.units"), q));
        if (r.base === "net") {
          var u = input("text", String(r.u / 100).replace(".", LANG === "en" ? "." : ","), { inputmode: "decimal", maxlength: "10", "aria-label": t("roy.unit", { cur: data.set.cur }) + ": " + r.t });
          u.addEventListener("input", function () { setRow(i, "u", u); });
          line.appendChild(field(t("roy.unit", { cur: data.set.cur }), u));
        }
        var e = el("div", "roy-e");
        e.dataset.i = String(i);
        line.appendChild(e);
        tb.appendChild(line);
      });
      body.appendChild(tb);
      var sum = el("div", "roy-sum");
      sum.setAttribute("aria-live", "polite");
      body.appendChild(sum);
      paint();
    }
    function setRow(i, k, inp) {
      var raw = String(inp.value || "").trim().replace(",", ".");
      var v = raw === "" ? 0 : Number(raw);
      var bad = !isFinite(v) || (k === "u" && v < 0) || Math.abs(v) > 1e7;
      inp.classList.toggle("bad", bad);
      if (bad) { go.disabled = true; return; }
      go.disabled = false;
      st.rows[i][k] = k === "u" ? Math.round(v * 100) : Math.round(v * 1000) / 1000;
      paint();
    }
    function paint() {
      st = Object.assign(RY.recompute(st, data), { warn: st.warn });
      [].forEach.call(body.querySelectorAll(".roy-e"), function (n) {
        var r = st.rows[+n.dataset.i];
        n.textContent = t("roy.earned") + ": " + cents(r.e);
      });
      var sum = body.querySelector(".roy-sum");
      sum.textContent = "";
      var tot = st.rows.reduce(function (a, r) { return a + r.e; }, 0);
      sum.appendChild(el("div", "", t("roy.total") + ": " + cents(tot)));
      var left = 0, rec = 0;
      st.rec.forEach(function (x) { left += Math.max(0, x.left - x.e); rec += Math.min(x.left, x.e); });
      if (rec) sum.appendChild(el("div", "muted", t("roy.advRec", { a: cents(rec) })));
      if (left) sum.appendChild(el("div", "muted", t("roy.advLeft", { a: cents(left) })));
      sum.appendChild(el("strong", "", t("roy.due", { a: cents(st.due) })));
    }
    function issue() {
      if (!st || go.disabled) return;
      var row = Object.assign({}, st, { id: C.uid() });
      delete row.warn;
      dlg.close();
      commit(C.put(data, "stmts", row, Date.now()));
      toast(t("roy.issued"));
      viewStatement(row.id);
    }
    showDialog(dlg);
    build();
  }

  function stmtText(st) {
    var out = [t("roy.mailHi", { n: st.n }), "", t("roy.mailBody", { from: fmtDate(st.from), to: fmtDate(st.to) }), ""];
    st.rows.forEach(function (r) {
      out.push(r.t + " (" + t("fmt." + r.k) + "): " + r.q + " × " + cents(r.u) + " = " + cents(r.b) + " × " + r.pct + "% = " + cents(r.e));
    });
    out.push("");
    out.push(t("roy.total") + ": " + cents(st.rows.reduce(function (a, r) { return a + r.e; }, 0)));
    st.rec.forEach(function (x) {
      if (!x.adv) return;
      var tt = C.find(data, "titles", x.ti);
      out.push(t("roy.advance") + (tt ? " · " + tt.t : "") + ": " + t("roy.advRec", { a: cents(Math.min(x.left, x.e)) }) + " · " + t("roy.advLeft", { a: cents(Math.max(0, x.left - x.e)) }));
    });
    out.push(t("roy.due", { a: cents(st.due) }));
    if (data.set.imp) { out.push(""); out.push(data.set.imp); }
    return out.join("\n");
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }
  function stmtHtml(st) {
    var rows = st.rows.map(function (r) {
      return "<tr><td>" + esc(r.t) + "</td><td>" + esc(t("fmt." + r.k)) + (r.isbn ? "<br><small>" + esc(C.hyphen(r.isbn, data.blocks)) + "</small>" : "") +
        "</td><td class=n>" + esc(String(r.q)) + "</td><td class=n>" + esc(cents(r.b)) + "</td><td class=n>" + esc(String(r.pct)) +
        "</td><td class=n>" + esc(cents(r.e)) + "</td></tr>";
    }).join("");
    var adv = st.rec.filter(function (x) { return x.adv; }).map(function (x) {
      var tt = C.find(data, "titles", x.ti);
      return "<p>" + esc(t("roy.advance") + (tt ? " · " + tt.t : "") + ": " + cents(x.adv) + " · " + t("roy.advRec", { a: cents(Math.min(x.left, x.e)) }) + " · " + t("roy.advLeft", { a: cents(Math.max(0, x.left - x.e)) })) + "</p>";
    }).join("");
    var tot = st.rows.reduce(function (a, r) { return a + r.e; }, 0);
    return "<!doctype html><html lang=\"" + esc(LANG) + "\"><head><meta charset=\"utf-8\"><title>" + esc(t("roy.st")) + "</title><style>" +
      "body{font:12pt/1.4 system-ui,sans-serif;margin:18mm;color:#000}h1{font-size:18pt;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:14px 0}" +
      "th,td{border-bottom:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}small{color:#555}" +
      ".due{font-size:14pt;font-weight:700}</style></head><body>" +
      (data.set.imp ? "<p><strong>" + esc(data.set.imp) + "</strong></p>" : "") +
      "<h1>" + esc(t("roy.st")) + "</h1><p>" + esc(stmtLabel(st)) + (st.v === 1 ? " · " + esc(t("roy.void")) : "") + "</p>" +
      "<table><thead><tr><th>" + esc(t("roy.th.title")) + "</th><th>" + esc(t("roy.th.fmt")) + "</th><th class=n>" + esc(t("roy.th.units")) +
      "</th><th class=n>" + esc(t("roy.th.base")) + "</th><th class=n>" + esc(t("roy.th.pct")) + "</th><th class=n>" + esc(t("roy.th.earned")) +
      "</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      "<p>" + esc(t("roy.total") + ": " + cents(tot)) + "</p>" + adv +
      "<p class=due>" + esc(t("roy.due", { a: cents(st.due) })) + "</p>" +
      (st.paid ? "<p>" + esc(t("roy.paidOn", { d: fmtDate(st.paid) })) + "</p>" : "") + "</body></html>";
  }
  function printHtml(html) {
    var old = $("roy-print");
    if (old) old.remove();
    var fr = document.createElement("iframe");
    fr.id = "roy-print";
    fr.setAttribute("aria-hidden", "true");
    fr.tabIndex = -1;
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    fr.addEventListener("load", function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* the browser refused */ } }, { once: true });
    fr.srcdoc = html;
    document.body.appendChild(fr);
  }
  function viewStatement(id) {
    var st = C.find(data, "stmts", id);
    if (!st) return;
    var dlg = el("dialog", "roy-dlg");
    dlg.appendChild(el("h3", "", t("roy.st")));
    dlg.appendChild(el("p", "", stmtLabel(st) + (st.v === 1 ? " · " + t("roy.void") : "")));
    var pre = el("pre", "roy-text", stmtText(st));
    dlg.appendChild(pre);
    dlg.appendChild(el("p", "muted", st.v === 1 ? t("roy.void") : (st.paid ? t("roy.paidOn", { d: fmtDate(st.paid) }) : t("roy.unpaid"))));
    var acts = el("div", "send-row");
    acts.appendChild(button("🖨 " + t("roy.print"), "btn small", function () { printHtml(stmtHtml(st)); }));
    if (st.v !== 1) {
      acts.appendChild(button("✉ " + t("roy.mail"), "btn small", function () {
        dlg.close();
        openAt("mail", { compose: { to: "", subject: t("roy.mailSubj", { from: fmtDate(st.from), to: fmtDate(st.to) }).slice(0, 300), body: stmtText(st).slice(0, 20000) } });
      }));
      var P = null;
      try { P = window.parent && typeof window.parent.__orosOpenBudgetNew === "function" ? window.parent : null; } catch (e) { P = null; }
      if (P && st.due > 0) acts.appendChild(button(t("roy.budget"), "btn small", function () {
        var ok = P.__orosOpenBudgetNew({ k: "o", a: st.due, d: st.paid || todayYmd(), c: "o-other", src: "publish",
          n: (t("roy.st") + " · " + stmtLabel(st)).slice(0, 140) });
        if (ok === false) toast(t("send.noApp")); else dlg.close();
      }));
      acts.appendChild(button(st.paid ? t("roy.markUnpaid") : t("roy.markPaid"), "btn small", function () {
        dlg.close();
        commit(C.put(data, "stmts", Object.assign({}, st, { paid: st.paid ? "" : todayYmd() }), Date.now()));
      }));
      acts.appendChild(button(t("roy.voidIt"), "btn small danger", function () {
        dlg.close();
        var q = el("dialog");
        q.appendChild(el("h3", "", t("roy.voidIt") + " · " + stmtLabel(st)));
        q.appendChild(el("p", "muted", t("roy.voidQ")));
        var qa = el("div", "acts");
        qa.appendChild(button(t("btn.cancel"), "btn", function () { q.close(); }));
        qa.appendChild(button(t("roy.voidIt"), "btn pri", function () {
          q.close();
          commit(C.put(data, "stmts", Object.assign({}, st, { v: 1 }), Date.now()));
        }));
        q.appendChild(qa);
        showDialog(q);
      }));
    }
    dlg.appendChild(acts);
    var a2 = el("div", "acts");
    a2.appendChild(button(t("btn.close"), "btn pri", function () { dlg.close(); }));
    dlg.appendChild(a2);
    showDialog(dlg);
  }

  // ---------- 7. Barcode dialog ----------
  function barcodeDialog(tt, fmtId) {
    flushEdits();
    tt = currentTitle() || tt;
    var f = tt && tt.fmts.filter(function (x) { return x.id === fmtId; })[0];
    if (!f || !f.isbn) return;
    var svg = C.barcodeSvg(f.isbn, data.blocks);
    if (!svg) return;
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("bc.title", { fmt: t("fmt." + f.k) })));
    var prev = el("div", "bc-prev");
    var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    var im = el("img");
    im.alt = "ISBN " + C.hyphen(f.isbn, data.blocks);
    im.src = url;
    prev.appendChild(im);
    dlg.appendChild(prev);
    dlg.appendChild(el("p", "muted", t("bc.hint")));
    var base = "ISBN-" + f.isbn;
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.copy") + " ISBN", "btn", function () { copyText(C.hyphen(f.isbn, data.blocks)); }));
    acts.appendChild(button(t("bc.svg"), "btn", function () { saveBlob(new Blob([svg], { type: "image/svg+xml" }), base + ".svg", "image/svg+xml", ".svg"); }));
    acts.appendChild(button(t("bc.png"), "btn", function () {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = 1130;                         // ≈ 770 dpi at the standard 37 mm
        cv.height = Math.round(1130 * img.naturalHeight / (img.naturalWidth || 1));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { if (b) saveBlob(b, base + ".png", "image/png", ".png"); }, "image/png");
      };
      img.src = url;
    }));
    acts.appendChild(button(t("btn.close"), "btn pri", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { setTimeout(function () { URL.revokeObjectURL(url); }, 2000); });
    showDialog(dlg);
  }

  // ---------- 8. ISBN register ----------
  function renderIsbn() {
    var sec = $("view-isbn");
    sec.textContent = "";
    var cl = C.clashes(data);
    if (cl.length) {
      var wb = el("div", "warnbox");
      wb.appendChild(el("strong", "", t("clash.title")));
      var ul = el("ul");
      ul.style.margin = "6px 0 0 18px";
      cl.forEach(function (c) {
        ul.appendChild(el("li", "", t("clash.one", { isbn: C.hyphen(c.isbn, data.blocks), list: c.uses.map(useLabel).join(", ") })));
      });
      wb.appendChild(ul);
      sec.appendChild(wb);
    }

    var hd = el("div", "ed-head");
    hd.appendChild(el("h2", "", t("isbn.blocks")));
    hd.appendChild(button(t("isbn.addBlock"), "btn pri", addBlockDialog));
    sec.appendChild(hd);
    if (!data.blocks.length) sec.appendChild(el("p", "muted", t("isbn.blocksNone")));
    data.blocks.forEach(function (b) {
      var u = C.blockUsage(data, b.id);
      if (!u) return;
      var box = el("div", "block");
      var bh = el("div", "block-head");
      bh.appendChild(el("strong", "", b.p));
      if (b.note) bh.appendChild(el("span", "muted", b.note));
      bh.appendChild(el("span", "spacer"));
      bh.appendChild(button(t("blk.del"), "btn small danger", function () { removeBlock(b); }));
      box.appendChild(bh);
      box.appendChild(el("div", "muted", t("blk.used", { used: u.used, size: u.size, free: u.free })));
      var meter = el("div", "meter"), bar = el("i");
      bar.style.width = Math.min(100, Math.round(100 * u.used / u.size)) + "%";
      meter.appendChild(bar);
      box.appendChild(meter);
      var nx = C.nextFree(data, b.id), nl = el("div", "next");
      if (nx) {
        nl.appendChild(el("span", "", t("blk.next")));
        nl.appendChild(el("code", "isbn", C.hyphen(nx, data.blocks)));
        nl.appendChild(button(t("btn.copy"), "btn small", function () { copyText(C.hyphen(nx, data.blocks)); }));
        nl.appendChild(button(t("blk.newWith"), "btn small", function () { newTitleDialog({ isbn: nx }); }));
      } else nl.appendChild(el("span", "muted", t("blk.full")));
      box.appendChild(nl);
      if (u.rows.length) {
        var det = el("details");
        det.style.marginTop = "10px";
        det.appendChild(el("summary", "", t("blk.show", { n: u.rows.length })));
        var nums = el("ul", "nums");
        nums.style.marginTop = "6px";
        u.rows.forEach(function (r) {
          var li = el("li");
          li.appendChild(el("code", "isbn", C.hyphen(r.isbn, data.blocks)));
          r.uses.forEach(function (us) {
            if (us.x) { li.appendChild(el("span", "muted", t("isbn.elsewhere"))); return; }
            li.appendChild(button(useLabel(us), "linkish", function () { openTitle(us.title); }));
          });
          nums.appendChild(li);
        });
        det.appendChild(nums);
        box.appendChild(det);
      }
      sec.appendChild(box);
    });

    // Used outside the app
    var xs = el("section", "sec");
    xs.appendChild(el("h3", "", t("x.title")));
    xs.appendChild(el("p", "muted", t("x.hint")));
    var xl = el("ul", "nums");
    xl.style.margin = "8px 0";
    if (!data.isbnx.length) xl.appendChild(el("li", "muted", t("x.none")));
    data.isbnx.forEach(function (x) {
      var li = el("li");
      li.appendChild(el("code", "isbn", C.hyphen(x.id, data.blocks)));
      if (x.note) li.appendChild(el("span", "", x.note));
      li.appendChild(button(t("btn.remove"), "btn small", function () {
        var keep = JSON.parse(JSON.stringify(x));
        commit(C.remove(data, "isbnx", x.id, Date.now()));
        toast(t("x.removed"), t("btn.undo"), function () { commit(C.put(data, "isbnx", keep, Date.now())); });
      }));
      xl.appendChild(li);
    });
    xs.appendChild(xl);
    xs.appendChild(button(t("x.add"), "btn small", addXDialog));
    sec.appendChild(xs);

    // Checker
    var ck = el("section", "sec");
    ck.appendChild(el("h3", "", t("chk.title")));
    var ci = input("text", "", { placeholder: t("chk.ph"), "aria-label": t("chk.title"), autocomplete: "off", spellcheck: "false" });
    var out = el("p", "hint");
    out.style.marginTop = "6px";
    ci.addEventListener("input", function () {
      var v = ci.value.trim();
      out.className = "hint";
      out.textContent = "";
      if (!v) return;
      var p = C.parseIsbn(v);
      if (!p.ok) { out.className = "hint bad"; out.textContent = t("isbn." + p.why); return; }
      var ten = C.isbn10(p.isbn), uses = C.used(data)[p.isbn] || [];
      out.className = "hint good";
      out.textContent = t("chk.ok", { thirteen: C.hyphen(p.isbn, data.blocks), ten: ten ? t("chk.ten", { ten: ten }) : "" }) + " · " +
        (uses.length ? t("chk.uses", { list: uses.map(useLabel).join(", ") }) : t("chk.free"));
    });
    ck.appendChild(ci);
    ck.appendChild(out);
    sec.appendChild(ck);
  }
  function addBlockDialog() {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("isbn.addBlock")));
    var p = input("text", "", { placeholder: t("blk.prefix.ph"), maxlength: "20", inputmode: "numeric", autocomplete: "off" });
    var n = input("text", "", { maxlength: "200" });
    var hint = el("span", "hint");
    dlg.appendChild(field(t("blk.prefix"), p, hint));
    dlg.appendChild(field(t("blk.note"), n));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("btn.add"), "btn pri", function () {
      var pb = C.parseBlock(p.value);
      if (!pb) { hint.className = "hint bad"; hint.textContent = t("blk.bad"); p.focus(); return; }
      if (data.blocks.some(function (b) { var o = C.parseBlock(b.p); return o && o.d === pb.d; })) {
        hint.className = "hint bad"; hint.textContent = t("blk.dup"); return;
      }
      dlg.close();
      commit(C.put(data, "blocks", { id: C.uid(), p: pb.p, note: n.value }, Date.now()));
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); go.click(); } });
    showDialog(dlg);
    p.focus();
  }
  function removeBlock(b) {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("blk.del")));
    dlg.appendChild(el("p", "", t("blk.delAsk", { p: b.p })));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    acts.appendChild(button(t("btn.remove"), "btn pri", function () {
      dlg.close();
      var keep = JSON.parse(JSON.stringify(b));
      commit(C.remove(data, "blocks", b.id, Date.now()));
      toast(t("blk.removed"), t("btn.undo"), function () { commit(C.put(data, "blocks", keep, Date.now())); });
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function addXDialog() {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("x.add")));
    var i = input("text", "", { maxlength: "20", inputmode: "numeric", autocomplete: "off" });
    var hint = el("span", "hint");
    var n = input("text", "", { maxlength: "200" });
    dlg.appendChild(field(t("x.isbn"), i, hint));
    dlg.appendChild(field(t("x.note"), n));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("btn.add"), "btn pri", function () {
      var p = C.parseIsbn(i.value);
      if (!p.ok) { hint.className = "hint bad"; hint.textContent = t("isbn." + p.why); i.focus(); return; }
      dlg.close();
      commit(C.put(data, "isbnx", { id: p.isbn, note: n.value }, Date.now()));
      toast(t("x.done"));
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); go.click(); } });
    showDialog(dlg);
    i.focus();
  }

  // ---------- 9. Settings ----------
  function settingsDialog() {
    var dlg = el("dialog");
    dlg.appendChild(el("h3", "", t("set.title")));
    var list = CURRENCIES.indexOf(data.set.cur) >= 0 ? CURRENCIES : CURRENCIES.concat([data.set.cur]);
    var cur = select(list.map(function (c) { return [c, c]; }), data.set.cur);
    dlg.appendChild(field(t("set.cur"), cur));
    var imp = input("text", data.set.imp, { maxlength: "120", autocomplete: "organization" });
    dlg.appendChild(field(t("set.imp"), imp, el("span", "hint", t("set.impHint"))));
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    acts.appendChild(button(t("btn.save"), "btn pri", function () {
      dlg.close();
      var patch = {};
      if (cur.value !== data.set.cur) patch.cur = cur.value;
      if (imp.value.trim() !== data.set.imp) patch.imp = imp.value.trim();
      if (Object.keys(patch).length) { commit(C.setSet(data, patch, Date.now())); toast(t("set.done")); }
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 10. Dialogs + toast ----------
  function showDialog(dlg) {
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }
  var toastTimer = 0;
  function toast(msg, actLabel, act) {
    var box = $("toast");
    box.textContent = "";
    box.appendChild(el("span", "", msg));
    if (actLabel && act) {
      box.appendChild(button(actLabel, "", function () {
        box.classList.remove("show");
        act();
      }));
    }
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, act ? 8000 : 3200);
  }

  // ---------- render ----------
  function render() {
    var tab = view.name === "isbn" || view.name === "roy" ? view.name : "titles";
    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    $("view-list").hidden = view.name !== "list";
    $("view-title").hidden = view.name !== "title";
    $("view-isbn").hidden = view.name !== "isbn";
    $("view-roy").hidden = view.name !== "roy";
    if (view.name === "list") renderList();
    else if (view.name === "title") renderEditor();
    else if (view.name === "roy") renderRoy();
    else renderIsbn();
  }

  function wire() {
    $("new-btn").addEventListener("click", function () { newTitleDialog(); });
    $("settings-btn").addEventListener("click", settingsDialog);
    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () {
        prefs.tab = b.dataset.tab;
        savePrefs();
        setView({ name: b.dataset.tab === "isbn" || b.dataset.tab === "roy" ? b.dataset.tab : "list", id: "" });
        render();
      });
    });
  }

  // ---------- 11. Keyboard (Contract Β) + deep link ----------
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = null; try { p = window.parent; } catch (err) { return; }
    if (!(p && p !== window && p.orosShortcuts &&
          typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && view.name === "title" && !document.querySelector("dialog[open]")) {
      setView({ name: "list", id: "" });
      render();
    }
  });

  // target = { title: id } | { view: "isbn" | "roy" } | { isbn: "…" } (opens the
  // title that has it, else the register) | { new: { t|title, author?,
  // isbn?, rel?, plan? } } or { asNew: {…} } (the Assistant's card) asks
  // before creating; nothing is written on arrival.
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.title === "string" && C.find(data, "titles", target.title)) { openTitle(target.title); return; }
    if (target.view === "isbn" || target.view === "roy") { setView({ name: target.view, id: "" }); render(); return; }
    if (typeof target.isbn === "string") {
      var p = C.parseIsbn(target.isbn), uses = p.ok ? (C.used(data)[p.isbn] || []).filter(function (u) { return u.title; }) : [];
      if (uses.length) { openTitle(uses[0].title); return; }
      setView({ name: "isbn", id: "" });
      render();
      return;
    }
    // { asNew } is the Assistant's propose_entry "book" card (wave P4): the same dialog
    var n = target["new"] && typeof target["new"] === "object" ? target["new"] : target.asNew && typeof target.asNew === "object" ? target.asNew : null;
    if (n) {
      var pi = C.parseIsbn(typeof n.isbn === "string" ? n.isbn : "");
      setView({ name: "list", id: "" });
      render();
      newTitleDialog({ t: typeof (n.t || n.title) === "string" ? String(n.t || n.title).slice(0, 200) : "",
        author: typeof n.author === "string" ? n.author.slice(0, 120) : "", isbn: pi.ok ? pi.isbn : "",
        rel: C.okYmd(n.rel) ? n.rel : "", plan: n.plan === 1 });
    }
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 12. Palette + boot ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
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
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takePending();
  }
  boot();
})();
