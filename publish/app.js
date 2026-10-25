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
      "new.title": "New title", "new.name": "Title", "new.author": "Author (optional)", "new.go": "Create",
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
      "fmt.next": "Next free", "fmt.barcode": "Barcode", "fmt.del": "Remove format",
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
      "set.title": "Settings", "set.cur": "Currency for prices", "set.done": "Saved",
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
      "new.title": "Νέος τίτλος", "new.name": "Τίτλος", "new.author": "Συγγραφέας (προαιρετικό)", "new.go": "Δημιουργία",
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
      "fmt.next": "Επόμενο ελεύθερο", "fmt.barcode": "Barcode", "fmt.del": "Αφαίρεση μορφής",
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
      "set.title": "Ρυθμίσεις", "set.cur": "Νόμισμα για τις τιμές", "set.done": "Αποθηκεύτηκε",
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
      if (p.tab === "isbn" || p.tab === "titles") prefs.tab = p.tab;
      if (["rel", "t", "m"].indexOf(p.sort) >= 0) prefs.sort = p.sort;
      if (C.STATUS.indexOf(p.st) >= 0) prefs.st = p.st;
    } catch (e) { /* defaults */ }
    view.name = prefs.tab === "isbn" ? "isbn" : "list";
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
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    var go = button(t("new.go"), "btn pri", function () {
      var nm = name.value.trim();
      if (!nm) { name.focus(); return; }
      var id = C.uid(), now = Date.now();
      var row = { id: id, t: nm, st: "idea", ppl: au.value.trim() ? [{ r: "a", n: au.value.trim() }] : [], fmts: [] };
      if (pf.isbn) row.fmts = [{ id: C.uid(), k: "pb", isbn: pf.isbn }];
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
    view = { name: "title", id: id };
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
  function later(fn) { clearTimeout(edTimer); edTimer = setTimeout(fn, 350); }

  function renderEditor() {
    var sec = $("view-title");
    sec.textContent = "";
    dropThumbs();
    var tt = currentTitle();
    if (!tt) { view = { name: "list", id: "" }; render(); return; }
    var head = el("div", "ed-head");
    head.appendChild(button("← " + t("btn.back"), "btn", function () { view = { name: "list", id: "" }; render(); }));
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
        });
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
    rel.addEventListener("change", function () { if (!rel.value || C.okYmd(rel.value)) writeTitle({ rel: rel.value }); });
    g1.appendChild(field(t("f.rel"), rel));
    textField("lang", t("f.lang"), 40);
    s1.appendChild(g1);
    sec.appendChild(s1);

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
      n.addEventListener("input", function () { later(function () { writeTitle({ ppl: pplFromDom() }); }); });
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
      i.addEventListener("input", function () { later(function () { var p = {}; p[d[0]] = i.value; writeTitle(p); }); });
      s4.appendChild(field(t("f." + d[0]), i));
    });
    sec.appendChild(s4);

    // Cover
    var s5 = el("section", "sec");
    s5.appendChild(el("h3", "", t("sec.cover")));
    s5.appendChild(coverBox(tt));
    sec.appendChild(s5);
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
    isbnIn.addEventListener("input", function () { later(onIsbn); });
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
        later(function () { var p = {}; p[key] = i.value === "" ? 0 : C.num(i.value, 0, max, step === "0.01" ? 2 : step === "0.1" ? 1 : 0); writeTitle({ fmts: fmtsWith(p) }); });
      });
      grid.appendChild(field(label, i));
    }
    function txtField(key, label, max) {
      var i = input("text", f[key], { maxlength: String(max) });
      i.addEventListener("input", function () { later(function () { var p = {}; p[key] = i.value; writeTitle({ fmts: fmtsWith(p) }); }); });
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
      view = { name: "list", id: "" };
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

  // ---------- 7. Barcode dialog ----------
  function barcodeDialog(tt, fmtId) {
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
    var acts = el("div", "acts");
    acts.appendChild(button(t("btn.cancel"), "btn", function () { dlg.close(); }));
    acts.appendChild(button(t("btn.save"), "btn pri", function () {
      dlg.close();
      if (cur.value !== data.set.cur) { commit(C.setCur(data, cur.value, Date.now())); toast(t("set.done")); }
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
    var tab = view.name === "isbn" ? "isbn" : "titles";
    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    $("view-list").hidden = view.name !== "list";
    $("view-title").hidden = view.name !== "title";
    $("view-isbn").hidden = view.name !== "isbn";
    if (view.name === "list") renderList();
    else if (view.name === "title") renderEditor();
    else renderIsbn();
  }

  function wire() {
    $("new-btn").addEventListener("click", function () { newTitleDialog(); });
    $("settings-btn").addEventListener("click", settingsDialog);
    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () {
        prefs.tab = b.dataset.tab;
        savePrefs();
        view = { name: b.dataset.tab === "isbn" ? "isbn" : "list", id: "" };
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
      view = { name: "list", id: "" };
      render();
    }
  });

  // target = { title: id } | { view: "isbn" } | { isbn: "…" } (opens the
  // title that has it, else the register) | { new: { t|title, author?,
  // isbn?, … } } (asks before creating, nothing is written on arrival).
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.title === "string" && C.find(data, "titles", target.title)) { openTitle(target.title); return; }
    if (target.view === "isbn") { view = { name: "isbn", id: "" }; render(); return; }
    if (typeof target.isbn === "string") {
      var p = C.parseIsbn(target.isbn), uses = p.ok ? (C.used(data)[p.isbn] || []).filter(function (u) { return u.title; }) : [];
      if (uses.length) { openTitle(uses[0].title); return; }
      view = { name: "isbn", id: "" };
      render();
      return;
    }
    if (target["new"] && typeof target["new"] === "object") {
      var n = target["new"], pi = C.parseIsbn(typeof n.isbn === "string" ? n.isbn : "");
      view = { name: "list", id: "" };
      render();
      newTitleDialog({ t: typeof (n.t || n.title) === "string" ? String(n.t || n.title).slice(0, 200) : "",
        author: typeof n.author === "string" ? n.author.slice(0, 120) : "", isbn: pi.ok ? pi.isbn : "" });
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
