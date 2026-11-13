// ============================================================
// orOS Files — docs.js (the "Documents" place, wave W1)
// ------------------------------------------------------------
// A Paperless-like archive inside Files. Any file of the disk can be
// made a document (Files' menu › "Add to Documents", or Add here):
// a title, a type, tags, who it is from, the document date, an
// amount, an expiry date, a "keep until" date and a note. The files
// stay where they are; files added here go to Documents/<year>/.
// The details sync in the slice "files-docs" (docs-core.js, DOCS v1);
// the files sync through Vault Drive as always.
//
// Nothing is ever deleted by this view: "Remove from Documents"
// forgets the details and keeps the file; a document whose file is
// gone shows it and can be found again by its SHA-256.
//
// Files is the only caller: OrosFilesDocs.init(ctx) at boot,
// treeNode() from renderTree(), leave() from navigate(); files.js
// calls add(paths) from its menu and carry(from, to) after a move.
// Device-local: oros-files-docs-view { on } (the last place shown).
// ============================================================
(function () {
  "use strict";

  var CORE = window.OrosDocsCore;
  if (!CORE) return;
  var VIEW_LS = "oros-files-docs-view";

  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "doc.tree":        "Documents",
      "doc.search":      "Search documents",
      "doc.add":         "Add files",
      "doc.more":        "More",
      "doc.export":      "Export documents (.zip)",
      "doc.import":      "Import an archive (.zip)",
      "doc.manage":      "Types, tags and senders",
      "doc.find":        "Find moved files",
      "doc.all":         "All",
      "doc.soon":        "Expires soon",
      "doc.keep":        "Can be thrown away",
      "doc.untyped":     "No type",
      "doc.anyType":     "Any type",
      "doc.anyTag":      "Any tag",
      "doc.anyFrom":     "From anyone",
      "doc.anyYear":     "Any year",
      "doc.count":       "{n} documents",
      "doc.countOne":    "1 document",
      "doc.none":        "No documents match",
      "doc.intro.title": "Keep your papers in order",
      "doc.intro.body":  "Receipts, bills, contracts, warranties: give each file a type, tags and dates, and find it again in seconds. Choose files anywhere in Files and pick Add to Documents, or add new ones here. Files stay where they are.",
      "doc.noDate":      "No date",
      "doc.expiresIn":   "Expires in {n} days",
      "doc.expiresToday":"Expires today",
      "doc.expired":     "Expired {n} days ago",
      "doc.keepPassed":  "Kept long enough",
      "doc.missing":     "File not found",
      "doc.private":     "Private",
      "doc.dlgTitle":    "Document",
      "doc.f.title":     "Title",
      "doc.f.type":      "Type",
      "doc.f.noType":    "No type",
      "doc.f.tags":      "Tags",
      "doc.f.addTag":    "Add a tag",
      "doc.f.rmTag":     "Remove tag {name}",
      "doc.f.from":      "From",
      "doc.f.fromHint":  "Shop, company, office…",
      "doc.f.date":      "Document date",
      "doc.f.amount":    "Amount",
      "doc.f.currency":  "Currency",
      "doc.f.expires":   "Expires",
      "doc.f.keep":      "Keep until",
      "doc.f.forever":   "Keep for ever",
      "doc.f.suggested": "Suggested by the type. A suggestion, not legal advice: change it if you need to.",
      "doc.f.note":      "Note",
      "doc.f.file":      "File",
      "doc.open":        "Open",
      "doc.showFolder":  "Show in folder",
      "doc.save":        "Save",
      "doc.cancel":      "Cancel",
      "doc.close":       "Close",
      "doc.remove":      "Remove from Documents",
      "doc.removeMsg":   "Forget the details of “{name}”? The file stays where it is.",
      "doc.removed":     "Removed from Documents. The file stays.",
      "doc.undo":        "Undo",
      "doc.saved":       "Saved",
      "doc.added":       "{n} files added to Documents",
      "doc.addedOne":    "Added to Documents",
      "doc.already":     "Already in Documents",
      "doc.full":        "Documents is full ({n}). Remove some first.",
      "doc.nearFull":    "{n} documents: the archive holds up to {max}.",
      "doc.addFail":     "Could not add {name}",
      "doc.saveFail":    "Could not save the documents on this device",
      "doc.lostFile":    "The file is not on this disk any more. If it was moved, Find moved files looks for it.",
      "doc.found":       "{n} moved files found",
      "doc.foundNone":   "No moved files found",
      "doc.exporting":   "Packing {i} of {n}…",
      "doc.exported":    "Exported {n} documents",
      "doc.exportNone":  "No documents to export",
      "doc.exportFail":  "Could not export the documents",
      "doc.exportSkip":  "{n} files were not found and are left out",
      "doc.importing":   "Importing…",
      "doc.imported":    "{n} documents imported",
      "doc.importNone":  "Nothing new in this archive",
      "doc.importBad":   "This is not an orOS documents archive",
      "doc.m.types":     "Types",
      "doc.m.tags":      "Tags",
      "doc.m.corr":      "Senders",
      "doc.m.newType":   "New type",
      "doc.m.newTag":    "New tag",
      "doc.m.newCorr":   "New sender",
      "doc.m.name":      "Name",
      "doc.m.years":     "Keep (years, empty = no suggestion)",
      "doc.m.forever":   "For ever",
      "doc.m.untilEx":   "Until it expires",
      "doc.m.private":   "Private (never shown to the Assistant or Claude)",
      "doc.m.rename":    "Rename {name}",
      "doc.m.delete":    "Delete {name}",
      "doc.m.delMsg":    "Delete “{name}”? Documents that use it keep everything else.",
      "doc.m.delete2":   "Delete",
      "doc.m.used":      "{n} documents",
      "doc.m.keepY":     "keep {n} years",
      "doc.m.keepF":     "keep for ever",
      "doc.m.keepEx":    "keep until it expires",
      "doc.m.ok":        "OK",
      "doc.csv.title":   "Title",
      "doc.csv.type":    "Type",
      "doc.csv.tags":    "Tags",
      "doc.csv.from":    "From",
      "doc.csv.date":    "Date",
      "doc.csv.amount":  "Amount",
      "doc.csv.cur":     "Currency",
      "doc.csv.expires": "Expires",
      "doc.csv.keep":    "Keep until",
      "doc.csv.file":    "File",
      "doc.csv.note":    "Note",
      "doc.ty.ty-receipt":   "Receipt",
      "doc.ty.ty-invoice":   "Invoice",
      "doc.ty.ty-bill":      "Bill",
      "doc.ty.ty-contract":  "Contract",
      "doc.ty.ty-warranty":  "Warranty",
      "doc.ty.ty-insurance": "Insurance",
      "doc.ty.ty-tax":       "Tax",
      "doc.ty.ty-bank":      "Bank",
      "doc.ty.ty-medical":   "Medical",
      "doc.ty.ty-vehicle":   "Vehicle",
      "doc.ty.ty-id":        "ID or passport",
      "doc.ty.ty-cert":      "Certificate",
      "doc.ty.ty-other":     "Other",
      "doc.importDir":       "Imported",
      "doc.zipName":     "Documents"
    },
    el: {
      "doc.tree":        "Έγγραφα",
      "doc.search":      "Αναζήτηση εγγράφων",
      "doc.add":         "Προσθήκη αρχείων",
      "doc.more":        "Περισσότερα",
      "doc.export":      "Εξαγωγή εγγράφων (.zip)",
      "doc.import":      "Εισαγωγή αρχείου (.zip)",
      "doc.manage":      "Τύποι, ετικέτες και αποστολείς",
      "doc.find":        "Εύρεση αρχείων που μετακινήθηκαν",
      "doc.all":         "Όλα",
      "doc.soon":        "Λήγει σύντομα",
      "doc.keep":        "Μπορεί να πεταχτεί",
      "doc.untyped":     "Χωρίς τύπο",
      "doc.anyType":     "Κάθε τύπος",
      "doc.anyTag":      "Κάθε ετικέτα",
      "doc.anyFrom":     "Από οποιονδήποτε",
      "doc.anyYear":     "Κάθε έτος",
      "doc.count":       "{n} έγγραφα",
      "doc.countOne":    "1 έγγραφο",
      "doc.none":        "Κανένα έγγραφο δεν ταιριάζει",
      "doc.intro.title": "Τα χαρτιά σου σε τάξη",
      "doc.intro.body":  "Αποδείξεις, λογαριασμοί, συμβάσεις, εγγυήσεις: δώσε σε κάθε αρχείο τύπο, ετικέτες και ημερομηνίες και βρες το ξανά σε δευτερόλεπτα. Διάλεξε αρχεία οπουδήποτε στο Files και πάτησε «Προσθήκη στα Έγγραφα» ή πρόσθεσε νέα εδώ. Τα αρχεία μένουν εκεί που είναι.",
      "doc.noDate":      "Χωρίς ημερομηνία",
      "doc.expiresIn":   "Λήγει σε {n} ημέρες",
      "doc.expiresToday":"Λήγει σήμερα",
      "doc.expired":     "Έληξε πριν από {n} ημέρες",
      "doc.keepPassed":  "Φυλάχτηκε αρκετά",
      "doc.missing":     "Το αρχείο δεν βρέθηκε",
      "doc.private":     "Ιδιωτικό",
      "doc.dlgTitle":    "Έγγραφο",
      "doc.f.title":     "Τίτλος",
      "doc.f.type":      "Τύπος",
      "doc.f.noType":    "Χωρίς τύπο",
      "doc.f.tags":      "Ετικέτες",
      "doc.f.addTag":    "Νέα ετικέτα",
      "doc.f.rmTag":     "Αφαίρεση ετικέτας {name}",
      "doc.f.from":      "Από",
      "doc.f.fromHint":  "Κατάστημα, εταιρεία, υπηρεσία…",
      "doc.f.date":      "Ημερομηνία εγγράφου",
      "doc.f.amount":    "Ποσό",
      "doc.f.currency":  "Νόμισμα",
      "doc.f.expires":   "Λήγει",
      "doc.f.keep":      "Κράτα έως",
      "doc.f.forever":   "Κράτα για πάντα",
      "doc.f.suggested": "Πρόταση του τύπου. Είναι πρόταση και όχι νομική συμβουλή: άλλαξέ τη αν χρειάζεται.",
      "doc.f.note":      "Σημείωση",
      "doc.f.file":      "Αρχείο",
      "doc.open":        "Άνοιγμα",
      "doc.showFolder":  "Εμφάνιση στον φάκελο",
      "doc.save":        "Αποθήκευση",
      "doc.cancel":      "Άκυρο",
      "doc.close":       "Κλείσιμο",
      "doc.remove":      "Αφαίρεση από τα Έγγραφα",
      "doc.removeMsg":   "Να ξεχαστούν τα στοιχεία του «{name}»; Το αρχείο μένει εκεί που είναι.",
      "doc.removed":     "Αφαιρέθηκε από τα Έγγραφα. Το αρχείο μένει.",
      "doc.undo":        "Αναίρεση",
      "doc.saved":       "Αποθηκεύτηκε",
      "doc.added":       "{n} αρχεία προστέθηκαν στα Έγγραφα",
      "doc.addedOne":    "Προστέθηκε στα Έγγραφα",
      "doc.already":     "Είναι ήδη στα Έγγραφα",
      "doc.full":        "Τα Έγγραφα γέμισαν ({n}). Αφαίρεσε κάποια πρώτα.",
      "doc.nearFull":    "{n} έγγραφα: το αρχείο χωράει έως {max}.",
      "doc.addFail":     "Δεν ήταν δυνατή η προσθήκη του {name}",
      "doc.saveFail":    "Δεν ήταν δυνατή η αποθήκευση των εγγράφων σε αυτή τη συσκευή",
      "doc.lostFile":    "Το αρχείο δεν είναι πια στον δίσκο. Αν μετακινήθηκε, η «Εύρεση αρχείων που μετακινήθηκαν» το ψάχνει.",
      "doc.found":       "Βρέθηκαν {n} αρχεία που μετακινήθηκαν",
      "doc.foundNone":   "Δεν βρέθηκαν αρχεία που μετακινήθηκαν",
      "doc.exporting":   "Πακετάρισμα {i} από {n}…",
      "doc.exported":    "Εξάχθηκαν {n} έγγραφα",
      "doc.exportNone":  "Δεν υπάρχουν έγγραφα για εξαγωγή",
      "doc.exportFail":  "Δεν ήταν δυνατή η εξαγωγή των εγγράφων",
      "doc.exportSkip":  "{n} αρχεία δεν βρέθηκαν και έμειναν έξω",
      "doc.importing":   "Εισαγωγή…",
      "doc.imported":    "Εισήχθησαν {n} έγγραφα",
      "doc.importNone":  "Τίποτα καινούργιο σε αυτό το αρχείο",
      "doc.importBad":   "Αυτό δεν είναι αρχείο εγγράφων του orOS",
      "doc.m.types":     "Τύποι",
      "doc.m.tags":      "Ετικέτες",
      "doc.m.corr":      "Αποστολείς",
      "doc.m.newType":   "Νέος τύπος",
      "doc.m.newTag":    "Νέα ετικέτα",
      "doc.m.newCorr":   "Νέος αποστολέας",
      "doc.m.name":      "Όνομα",
      "doc.m.years":     "Διατήρηση (έτη, κενό = χωρίς πρόταση)",
      "doc.m.forever":   "Για πάντα",
      "doc.m.untilEx":   "Μέχρι να λήξει",
      "doc.m.private":   "Ιδιωτικό (δεν το βλέπουν ποτέ ο Assistant και ο Claude)",
      "doc.m.rename":    "Μετονομασία {name}",
      "doc.m.delete":    "Διαγραφή {name}",
      "doc.m.delMsg":    "Διαγραφή του «{name}»; Τα έγγραφα που το έχουν κρατούν όλα τα άλλα.",
      "doc.m.delete2":   "Διαγραφή",
      "doc.m.used":      "{n} έγγραφα",
      "doc.m.keepY":     "διατήρηση {n} έτη",
      "doc.m.keepF":     "διατήρηση για πάντα",
      "doc.m.keepEx":    "διατήρηση μέχρι τη λήξη",
      "doc.m.ok":        "OK",
      "doc.csv.title":   "Τίτλος",
      "doc.csv.type":    "Τύπος",
      "doc.csv.tags":    "Ετικέτες",
      "doc.csv.from":    "Από",
      "doc.csv.date":    "Ημερομηνία",
      "doc.csv.amount":  "Ποσό",
      "doc.csv.cur":     "Νόμισμα",
      "doc.csv.expires": "Λήξη",
      "doc.csv.keep":    "Κράτα έως",
      "doc.csv.file":    "Αρχείο",
      "doc.csv.note":    "Σημείωση",
      "doc.ty.ty-receipt":   "Απόδειξη",
      "doc.ty.ty-invoice":   "Τιμολόγιο",
      "doc.ty.ty-bill":      "Λογαριασμός",
      "doc.ty.ty-contract":  "Σύμβαση",
      "doc.ty.ty-warranty":  "Εγγύηση",
      "doc.ty.ty-insurance": "Ασφάλιση",
      "doc.ty.ty-tax":       "Φορολογικό",
      "doc.ty.ty-bank":      "Τράπεζα",
      "doc.ty.ty-medical":   "Ιατρικό",
      "doc.ty.ty-vehicle":   "Όχημα",
      "doc.ty.ty-id":        "Ταυτότητα ή διαβατήριο",
      "doc.ty.ty-cert":      "Πιστοποιητικό",
      "doc.ty.ty-other":     "Άλλο",
      "doc.importDir":       "Εισαγωγή",
      "doc.zipName":     "Έγγραφα"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);
  CORE.setNames(function (id) { var k = "doc.ty." + id, v = STRINGS[LANG] && STRINGS[LANG][k]; return v && v !== k ? v : ""; });

  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var ICON = {
    doc:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h5"/></svg>',
    box:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
    image:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    plus:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    warn:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    lock:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    x:      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    edit:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    trash:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
  };
  var IMG_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "tif", "tiff"];

  // ---------- state ----------
  var ctx = null;
  var active = false;
  var state = CORE.norm(null);
  var q = { text: "", ty: "", tg: "", co: "", year: "", flag: "" };   // memory only (R10)
  var missing = {};          // path → true: stat failed this session
  var renderToken = 0;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, title, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", fn);
    return b;
  }
  function textBtn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }
  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  function vault() {
    try { var v = ctx && ctx.vault ? ctx.vault() : null; return (v && typeof v.manifestEntry === "function") ? v : null; }
    catch (e) { return null; }
  }
  function syncApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  function today() { return CORE.isoDay(Date.now()); }
  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function parentOf(p) { var i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : p; }
  function extOf(n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; }
  function saveView() { try { localStorage.setItem(VIEW_LS, JSON.stringify({ on: active })); } catch (e) {} }
  function readView() { try { return JSON.parse(localStorage.getItem(VIEW_LS) || "null"); } catch (e) { return null; } }
  function fmtDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return "";
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(LOC, { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return s; }
  }
  function fmtAmount(d) {
    if (d.amt == null) return "";
    try {
      return d.cur ? new Intl.NumberFormat(LOC, { style: "currency", currency: d.cur }).format(d.amt)
                   : new Intl.NumberFormat(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.amt);
    } catch (e) { return String(d.amt) + (d.cur ? " " + d.cur : ""); }
  }

  // ---------- storage + sync (slice "files-docs") ----------
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(CORE.KEY)); } catch (e) { raw = null; }
    state = CORE.norm(raw);
  }
  // R27: only a real change stamps, stores and marks sync dirty;
  // R30: a failed write is said once, never swallowed.
  function commit(next) {
    if (next === state || JSON.stringify(next) === JSON.stringify(state)) return false;
    state = next;
    try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); }
    catch (e) { toast(t("doc.saveFail")); }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    if (active) paint();
    if (ctx && ctx.onChange) ctx.onChange();
    return true;
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice(CORE.SLICE, function () {
      return CORE.norm(state);
    }, function (incoming) {
      // R6: a pull never marks dirty.
      var next = CORE.norm(incoming);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); } catch (e) {}
      if (active && !document.querySelector("dialog.doc-dlg[open]")) paint();
      if (ctx && ctx.onChange) ctx.onChange();
    }, CORE.KEY, CORE.merge);
  }

  // ---------- adding ----------
  function hashOf(p) {
    var v = vault(), e = v ? v.manifestEntry(p) : null;
    if (e && typeof e.h === "string") return Promise.resolve(e.h);
    var fs = disk();
    if (!fs || !window.crypto || !crypto.subtle) return Promise.resolve("");
    return fs.stat(p).then(function (st) {
      if (!st || st.dir || (st.size || 0) > 64 * 1048576) return "";
      return fs.read(p).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
        return crypto.subtle.digest("SHA-256", buf);
      }).then(function (h) {
        var a = new Uint8Array(h), s = "";
        for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
        return s;
      });
    }).catch(function () { return ""; });
  }
  function add(paths, quiet) {
    var fs = disk();
    paths = (paths || []).filter(function (p) { return CORE.isDiskPath(p); });
    if (!fs || !paths.length) return Promise.resolve([]);
    var fresh = paths.filter(function (p) { return !CORE.docAt(state, p); });
    if (!fresh.length) {
      if (!quiet) toast(t("doc.already"));
      if (paths.length === 1) { var d0 = CORE.docAt(state, paths[0]); if (d0) openDoc(d0.id); }
      return Promise.resolve([]);
    }
    if (state.docs.length + fresh.length > CORE.MAX_DOCS) {
      toast(t("doc.full", { n: CORE.MAX_DOCS }));
      return Promise.resolve([]);
    }
    var files = [];
    var chain = Promise.resolve();
    fresh.forEach(function (p) {
      chain = chain.then(function () {
        return fs.stat(p).then(function (st) {
          if (!st || st.dir) return null;
          return hashOf(p).then(function (h) {
            files.push({ p: p, mtime: st.mtime || st.modified || Date.now(), h: h || undefined });
          });
        }, function () { toast(t("doc.addFail", { name: baseName(p) })); });
      });
    });
    return chain.then(function () {
      var r = CORE.addFiles(state, files, Date.now());
      commit(r.state);
      if (!quiet) {
        if (r.added.length === 1) toast(t("doc.addedOne"));
        else if (r.added.length) toast(t("doc.added", { n: r.added.length }));
        if (state.docs.length >= CORE.WARN_DOCS) toast(t("doc.nearFull", { n: state.docs.length, max: CORE.MAX_DOCS }));
      }
      if (r.added.length === 1 && !quiet) openDoc(r.added[0]);
      return r.added;
    });
  }
  // New files from the device go to Documents/<year>/ (R33: the
  // shell's own file dialog), then become documents.
  function pickAndAdd() {
    var host = ctx && ctx.dialogHost ? ctx.dialogHost() : null;
    var pick;
    if (host && typeof host.openFiles === "function") pick = host.openFiles("*/*");
    else if (host && typeof host.openFile === "function") pick = host.openFile("*/*").then(function (f) { return f ? [f] : null; });
    else pick = new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files.length ? Array.prototype.slice.call(inp.files) : null); });
      inp.click();
    });
    pick.then(function (list) {
      if (!list || !list.length) return;
      writeNew(list).then(function (paths) { if (paths.length) add(paths); });
    });
  }
  function ensureDir(fs, dir) {
    var parts = dir.slice(CORE.ROOT.length + 1).split("/"), p = CORE.ROOT, chain = Promise.resolve();
    parts.forEach(function (seg) {
      p += "/" + seg;
      var here = p;
      chain = chain.then(function () {
        return fs.stat(here).then(function (st) { if (!st || !st.dir) return fs.mkdir(here); }, function () { return fs.mkdir(here); });
      });
    });
    return chain;
  }
  function writeNew(files) {
    var fs = disk(), dir = CORE.addDir(Date.now()), out = [];
    if (!fs) return Promise.resolve(out);
    return ensureDir(fs, dir).then(function () {
      return fs.ls(dir).catch(function () { return []; });
    }).then(function (list) {
      var taken = (list || []).map(function (e) { return e.name; });
      var chain = Promise.resolve();
      Array.prototype.forEach.call(files, function (f) {
        chain = chain.then(function () {
          var name = String(f.name || "document").replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_");
          if (name === ".trash" || name === ".docs") name = "_" + name.slice(1);
          name = ctx.uniqueName(name, taken);
          taken.push(name);
          var p = dir + "/" + name;
          return fs.write(p, f).then(function () { out.push(p); }, function () { toast(t("doc.addFail", { name: name })); });
        });
      });
      return chain;
    }).then(function () {
      if (ctx && ctx.onDiskChanged) ctx.onDiskChanged();
      return out;
    }, function () { return out; });
  }

  // ---------- moves (called by files.js after its own move/rename) ----------
  function carry(from, to) { commit(CORE.carry(state, from, to, Date.now())); }
  function relocate(quiet) {
    var v = vault();
    if (!v || typeof v.localPaths !== "function") { if (!quiet) toast(t("doc.foundNone")); return Promise.resolve(0); }
    var entries = v.localPaths().map(function (p) { var e = v.manifestEntry(p); return { p: p, h: e && e.h }; });
    var r = CORE.relocate(state, entries, Date.now());
    if (r.moved) { missing = {}; commit(r.state); }
    if (!quiet) toast(r.moved ? t("doc.found", { n: r.moved }) : t("doc.foundNone"));
    return Promise.resolve(r.moved);
  }

  // ---------- panel ----------
  function ensurePanel() {
    if ($("doc-panel")) return;
    var bar = el("div", "dbx-bar doc-bar");
    bar.id = "doc-bar";
    var title = el("strong", "doc-title", t("doc.tree"));
    bar.appendChild(title);
    var sw = el("label", "doc-search");
    var inp = el("input");
    inp.type = "search";
    inp.id = "doc-q";
    inp.placeholder = t("doc.search");
    inp.setAttribute("aria-label", t("doc.search"));
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.addEventListener("input", function () { q.text = inp.value; paintList(); });
    sw.appendChild(inp);
    bar.appendChild(sw);
    bar.appendChild(iconBtn("tool", ICON.plus, t("doc.add"), pickAndAdd));
    var more = iconBtn("tool", ICON.more, t("doc.more"), function (e) { openMore(e.currentTarget); });
    more.id = "doc-more";
    more.setAttribute("aria-haspopup", "menu");
    bar.appendChild(more);
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel doc-panel");
    panel.id = "doc-panel";
    var chips = el("div", "doc-chips");
    chips.id = "doc-chips";
    chips.setAttribute("role", "toolbar");
    panel.appendChild(chips);
    var ul = el("ul", "dbx-list doc-list");
    ul.id = "doc-entries";
    panel.appendChild(ul);
    var msg = el("div", "dbx-msg");
    msg.id = "doc-msg";
    msg.hidden = true;
    panel.appendChild(msg);
    var st = el("div", "dbx-status");
    st.id = "doc-status";
    panel.appendChild(st);
    var split = $("split");
    if (split) split.appendChild(panel);
  }

  function select(id, label, options, value, onChange) {
    var s = el("select", "doc-sel");
    s.id = id;
    s.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    if (s.value !== value) s.value = "";
    s.classList.toggle("on", !!s.value);
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function chip(label, on, fn) {
    var b = textBtn("doc-chip" + (on ? " on" : ""), label, fn);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    return b;
  }

  function paintChips() {
    var host = $("doc-chips");
    host.innerHTML = "";
    var c = CORE.counts(state, today());
    host.appendChild(chip(t("doc.all") + " " + c.all, !q.flag, function () { q.flag = ""; paint(); }));
    if (c.soon || q.flag === "soon") host.appendChild(chip(t("doc.soon") + " " + c.soon, q.flag === "soon", function () { q.flag = q.flag === "soon" ? "" : "soon"; paint(); }));
    if (c.keep || q.flag === "keep") host.appendChild(chip(t("doc.keep") + " " + c.keep, q.flag === "keep", function () { q.flag = q.flag === "keep" ? "" : "keep"; paint(); }));
    if (c.untyped || q.flag === "untyped") host.appendChild(chip(t("doc.untyped") + " " + c.untyped, q.flag === "untyped", function () { q.flag = q.flag === "untyped" ? "" : "untyped"; paint(); }));
    var used = { ty: {}, tg: {}, co: {} };
    state.docs.forEach(function (d) {
      if (d.ty) used.ty[d.ty] = true;
      if (d.co) used.co[d.co] = true;
      d.tg.forEach(function (x) { used.tg[x] = true; });
    });
    var tys = CORE.types(state, LANG).filter(function (x) { return used.ty[x.id] || q.ty === x.id; });
    if (tys.length) host.appendChild(select("doc-f-ty", t("doc.f.type"), [["", t("doc.anyType")]].concat(tys.map(function (x) { return [x.id, x.name]; })), q.ty, function (v) { q.ty = v; paint(); }));
    var tgs = CORE.tagsSorted(state, LANG).filter(function (x) { return used.tg[x.id] || q.tg === x.id; });
    if (tgs.length) host.appendChild(select("doc-f-tg", t("doc.f.tags"), [["", t("doc.anyTag")]].concat(tgs.map(function (x) { return [x.id, x.n]; })), q.tg, function (v) { q.tg = v; paint(); }));
    var cos = CORE.corrSorted(state, LANG).filter(function (x) { return used.co[x.id] || q.co === x.id; });
    if (cos.length) host.appendChild(select("doc-f-co", t("doc.f.from"), [["", t("doc.anyFrom")]].concat(cos.map(function (x) { return [x.id, x.n]; })), q.co, function (v) { q.co = v; paint(); }));
    var ys = CORE.years(state);
    if (ys.length > 1 || q.year) host.appendChild(select("doc-f-y", t("doc.f.date"), [["", t("doc.anyYear")]].concat(ys.map(function (y) { return [y, y]; })), q.year, function (v) { q.year = v; paint(); }));
    host.hidden = !state.docs.length;
  }

  function badge(d) {
    var n = CORE.expiresIn(d, today());
    if (missing[d.p]) return { cls: "warn", text: t("doc.missing"), icon: ICON.warn };
    if (n !== null && n < 0) return { cls: "warn", text: t("doc.expired", { n: -n }), icon: ICON.warn };
    if (n === 0) return { cls: "warn", text: t("doc.expiresToday"), icon: ICON.warn };
    if (n !== null && n <= 30) return { cls: "soon", text: t("doc.expiresIn", { n: n }) };
    if (CORE.keepPassed(d, today())) return { cls: "keep", text: t("doc.keepPassed") };
    return null;
  }

  function paintList() {
    var ul = $("doc-entries"), msg = $("doc-msg"), st = $("doc-status");
    ul.innerHTML = "";
    if (!state.docs.length) {
      ul.hidden = true;
      msg.hidden = false;
      msg.innerHTML = "";
      var ic = el("span", "dbx-lock");
      ic.innerHTML = ICON.box;
      msg.appendChild(ic);
      msg.appendChild(el("strong", "", t("doc.intro.title")));
      msg.appendChild(el("p", "", t("doc.intro.body")));
      var a = textBtn("pv-btn primary", t("doc.add"), pickAndAdd);
      msg.appendChild(a);
      st.textContent = "";
      return;
    }
    msg.hidden = true;
    ul.hidden = false;
    var rows = CORE.filter(state, q, today(), LANG);
    if (!rows.length) {
      var li0 = el("li", "doc-none", t("doc.none"));
      ul.appendChild(li0);
    }
    rows.forEach(function (d) { ul.appendChild(row(d)); });
    st.textContent = rows.length === 1 ? t("doc.countOne") : t("doc.count", { n: rows.length });
  }

  function row(d) {
    var li = el("li", "entry doc-row");
    li.tabIndex = 0;
    li.dataset.id = d.id;
    var g = el("span", "glyph");
    g.innerHTML = IMG_EXT.indexOf(extOf(d.p)) !== -1 ? ICON.image : ICON.doc;
    li.appendChild(g);
    var main = el("span", "doc-main");
    main.appendChild(el("span", "ename", d.t || baseName(d.p)));
    var sub = el("span", "doc-sub");
    var ty = CORE.typeOf(state, d.ty, LANG);
    if (ty) sub.appendChild(el("span", "doc-type", ty.name));
    var co = null;
    state.corr.forEach(function (c) { if (c.id === d.co) co = c; });
    if (co) sub.appendChild(el("span", "doc-from", co.n));
    d.tg.forEach(function (id) {
      state.tags.forEach(function (tg) {
        if (tg.id !== id) return;
        var s = el("span", "doc-tag", tg.n);
        if (tg.c != null) s.dataset.c = String(tg.c);
        sub.appendChild(s);
      });
    });
    if (CORE.isPrivate(state, d)) {
      var pv = el("span", "doc-pv");
      pv.innerHTML = ICON.lock;
      pv.title = t("doc.private");
      pv.setAttribute("aria-label", t("doc.private"));
      sub.appendChild(pv);
    }
    var b = badge(d);
    if (b) {
      var bb = el("span", "doc-badge " + b.cls);
      if (b.icon) bb.innerHTML = b.icon;
      bb.appendChild(el("span", "", b.text));
      sub.appendChild(bb);
    }
    main.appendChild(sub);
    li.appendChild(main);
    var right = el("span", "doc-right");
    right.appendChild(el("span", "col-date", d.d ? fmtDay(d.d) : t("doc.noDate")));
    var amt = fmtAmount(d);
    if (amt) right.appendChild(el("span", "col-size", amt));
    li.appendChild(right);
    li.addEventListener("click", function () { openDoc(d.id); });
    li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDoc(d.id); } });
    return li;
  }

  // Which files are gone (stat fails); the list says so. A few at a
  // time, after the first paint.
  function checkMissing() {
    var fs = disk(), token = renderToken;
    if (!fs) return;
    var list = state.docs.slice(0, 600), i = 0;
    function next() {
      if (token !== renderToken || i >= list.length) return;
      var d = list[i++];
      fs.stat(d.p).then(function (st) { return !!st; }, function () { return false; }).then(function (ok) {
        if (token !== renderToken) return;
        if (!ok && !missing[d.p]) { missing[d.p] = true; schedulePaint(); }
        else if (ok && missing[d.p]) { delete missing[d.p]; schedulePaint(); }
        next();
      });
    }
    next(); next(); next();
  }
  var paintTimer = 0;
  function schedulePaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(function () { paintTimer = 0; if (active) paintList(); }, 120);
  }

  function paint() {
    if (!active) return;
    paintChips();
    paintList();
  }

  // ---------- the "More" menu ----------
  function openMore(anchor) {
    var old = $("doc-menu");
    if (old) { old.remove(); return; }
    var m = el("div", "doc-menu");
    m.id = "doc-menu";
    m.setAttribute("role", "menu");
    [["doc.export", exportDocs], ["doc.import", importArchive], ["doc.manage", openManage], ["doc.find", function () { relocate(false); }]].forEach(function (it) {
      var b = textBtn("", t(it[0]), function () { close(); it[1](); });
      b.setAttribute("role", "menuitem");
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 4) + "px";
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    var first = m.querySelector("button");
    if (first) first.focus();
    function close() {
      m.remove();
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", key, true);
    }
    function outside(e) { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); }
    function key(e) { if (e.key === "Escape") { e.preventDefault(); close(); anchor.focus(); } }
    setTimeout(function () {
      document.addEventListener("click", outside, true);
      document.addEventListener("keydown", key, true);
    }, 0);
  }

  // ---------- dialogs (centered, R32; no native dialogs, R14) ----------
  function modal(cls) {
    var d = el("dialog", "doc-dlg" + (cls ? " " + cls : ""));
    d.addEventListener("close", function () { d.remove(); });
    document.body.appendChild(d);
    return d;
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var d = modal("doc-confirm");
      d.appendChild(el("h3", "", title));
      d.appendChild(el("p", "", text));
      var row = el("menu", "dlg-row");
      row.appendChild(textBtn("", t("doc.cancel"), function () { d.close(); resolve(false); }));
      row.appendChild(textBtn("danger", okLabel, function () { d.close(); resolve(true); }));
      d.appendChild(row);
      d.addEventListener("cancel", function () { resolve(false); });
      d.showModal();
    });
  }
  function field(label, input, cls) {
    var w = el("label", "doc-field" + (cls ? " " + cls : ""));
    w.appendChild(el("span", "doc-lbl", label));
    w.appendChild(input);
    return w;
  }
  function input(type, value, attrs) {
    var i = el("input");
    i.type = type;
    if (value != null) i.value = value;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  // The document's details. Saved only with Save (one stamp, R27).
  function openDoc(id) {
    var d0 = CORE.getDoc(state, id);
    if (!d0) return;
    var d = JSON.parse(JSON.stringify(d0));
    var dlg = modal("doc-edit");
    var form = el("form");
    form.setAttribute("autocomplete", "off");
    form.appendChild(el("h3", "", t("doc.dlgTitle")));

    var fTitle = input("text", d.t, { maxlength: "200" });
    form.appendChild(field(t("doc.f.title"), fTitle, "wide"));

    var tys = CORE.types(state, LANG);
    var fType = el("select");
    [["", t("doc.f.noType")]].concat(tys.map(function (x) { return [x.id, x.name]; })).forEach(function (o) {
      var op = el("option", "", o[1]); op.value = o[0]; fType.appendChild(op);
    });
    fType.value = d.ty || "";
    form.appendChild(field(t("doc.f.type"), fType));

    var corrList = el("datalist");
    corrList.id = "doc-corr-list";
    CORE.corrSorted(state, LANG).forEach(function (c) { var o = el("option"); o.value = c.n; corrList.appendChild(o); });
    form.appendChild(corrList);
    var coName = "";
    state.corr.forEach(function (c) { if (c.id === d.co) coName = c.n; });
    var fFrom = input("text", coName, { maxlength: "120", list: "doc-corr-list", placeholder: t("doc.f.fromHint") });
    form.appendChild(field(t("doc.f.from"), fFrom));

    // Tags: chips + a field (Enter or comma adds).
    var tagNames = d.tg.map(function (x) { var n = ""; state.tags.forEach(function (tg) { if (tg.id === x) n = tg.n; }); return n; }).filter(Boolean);
    var tagWrap = el("div", "doc-tags");
    var tagList = el("datalist");
    tagList.id = "doc-tag-list";
    CORE.tagsSorted(state, LANG).forEach(function (tg) { var o = el("option"); o.value = tg.n; tagList.appendChild(o); });
    form.appendChild(tagList);
    var fTag = input("text", "", { maxlength: "60", list: "doc-tag-list", placeholder: t("doc.f.addTag"), "aria-label": t("doc.f.addTag") });
    function paintTags() {
      tagWrap.innerHTML = "";
      tagNames.forEach(function (n, i) {
        var c = el("span", "doc-tag");
        c.appendChild(el("span", "", n));
        var x = iconBtn("doc-tag-x", ICON.x, t("doc.f.rmTag", { name: n }), function () { tagNames.splice(i, 1); paintTags(); });
        c.appendChild(x);
        tagWrap.appendChild(c);
      });
      tagWrap.appendChild(fTag);
    }
    function takeTag() {
      var v = fTag.value.replace(/,/g, " ").trim();
      if (!v) return;
      var f = CORE.fold(v);
      if (!tagNames.some(function (n) { return CORE.fold(n) === f; }) && tagNames.length < 20) tagNames.push(v);
      fTag.value = "";
      paintTags();
      fTag.focus();
    }
    fTag.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); takeTag(); }
      else if (e.key === "Backspace" && !fTag.value && tagNames.length) { tagNames.pop(); paintTags(); fTag.focus(); }
    });
    fTag.addEventListener("change", takeTag);
    paintTags();
    // The whole box is the tap target (the field itself is short).
    tagWrap.addEventListener("click", function (e) { if (e.target === tagWrap) fTag.focus(); });
    var tagField = el("div", "doc-field wide");
    tagField.appendChild(el("span", "doc-lbl", t("doc.f.tags")));
    tagField.appendChild(tagWrap);
    form.appendChild(tagField);

    var fDate = input("date", d.d || "");
    form.appendChild(field(t("doc.f.date"), fDate));
    var amtRow = el("div", "doc-amt");
    var fAmt = input("number", d.amt == null ? "" : String(d.amt), { step: "0.01", inputmode: "decimal", "aria-label": t("doc.f.amount") });
    var fCur = input("text", d.cur || "", { maxlength: "3", "aria-label": t("doc.f.currency"), placeholder: "EUR", autocapitalize: "characters" });
    amtRow.appendChild(fAmt);
    amtRow.appendChild(fCur);
    var amtField = el("div", "doc-field");
    amtField.appendChild(el("span", "doc-lbl", t("doc.f.amount")));
    amtField.appendChild(amtRow);
    form.appendChild(amtField);
    var fEx = input("date", d.ex || "");
    form.appendChild(field(t("doc.f.expires"), fEx));

    var keepWrap = el("div", "doc-field");
    keepWrap.appendChild(el("span", "doc-lbl", t("doc.f.keep")));
    var fKeep = input("date", d.kp && d.kp !== CORE.FOREVER ? d.kp : "", { "aria-label": t("doc.f.keep") });
    var forever = el("label", "doc-check");
    var fForever = input("checkbox");
    fForever.checked = d.kp === CORE.FOREVER;
    forever.appendChild(fForever);
    forever.appendChild(el("span", "", t("doc.f.forever")));
    keepWrap.appendChild(fKeep);
    keepWrap.appendChild(forever);
    var keepHint = el("small", "doc-hint", t("doc.f.suggested"));
    keepHint.hidden = true;
    keepWrap.appendChild(keepHint);
    form.appendChild(keepWrap);
    function paintKeep() { fKeep.disabled = fForever.checked; }
    fForever.addEventListener("change", function () { keepHint.hidden = true; paintKeep(); });
    fKeep.addEventListener("input", function () { keepHint.hidden = true; });
    paintKeep();
    // Suggestion of the type (Chris 2026-11-13): only while "keep
    // until" is empty or still the last suggestion.
    var lastSuggest = "";
    function suggest() {
      var cur = fForever.checked ? CORE.FOREVER : fKeep.value;
      if (cur && cur !== lastSuggest) return;
      var s = CORE.suggestKeep(CORE.typeOf(state, fType.value, LANG), { d: fDate.value, ex: fEx.value }, today());
      lastSuggest = s;
      fForever.checked = s === CORE.FOREVER;
      fKeep.value = s && s !== CORE.FOREVER ? s : "";
      keepHint.hidden = !s;
      paintKeep();
    }
    fType.addEventListener("change", suggest);
    fDate.addEventListener("change", function () { if (lastSuggest) suggest(); });
    fEx.addEventListener("change", function () { if (lastSuggest) suggest(); });

    var fNote = el("textarea");
    fNote.rows = 3;
    fNote.maxLength = 2000;
    fNote.value = d.no || "";
    form.appendChild(field(t("doc.f.note"), fNote, "wide"));

    var fileRow = el("div", "doc-field wide doc-file");
    fileRow.appendChild(el("span", "doc-lbl", t("doc.f.file")));
    var pathLine = el("span", "doc-path", d.p.slice(CORE.ROOT.length + 1));
    fileRow.appendChild(pathLine);
    var lost = el("p", "doc-lost", t("doc.lostFile"));
    lost.hidden = !missing[d.p];
    fileRow.appendChild(lost);
    var fileBtns = el("div", "doc-file-btns");
    var bOpen = textBtn("", t("doc.open"), function () { dlg.close(); if (ctx && ctx.preview) ctx.preview(d.p); });
    var bShow = textBtn("", t("doc.showFolder"), function () { dlg.close(); if (ctx && ctx.openFile) ctx.openFile(d.p); });
    fileBtns.appendChild(bOpen);
    fileBtns.appendChild(bShow);
    fileRow.appendChild(fileBtns);
    form.appendChild(fileRow);
    var fs = disk();
    if (fs) fs.stat(d.p).then(function (st) { return !!st; }, function () { return false; }).then(function (ok) {
      lost.hidden = ok;
      bOpen.disabled = bShow.disabled = !ok;
      if (!ok && !missing[d.p]) { missing[d.p] = true; schedulePaint(); }
    });

    var row = el("menu", "dlg-row");
    row.appendChild(textBtn("danger doc-rm", t("doc.remove"), function () {
      confirmBox(t("doc.remove"), t("doc.removeMsg", { name: d.t || baseName(d.p) }), t("doc.remove")).then(function (yes) {
        if (!yes) return;
        dlg.close();
        removeDoc(id);
      });
    }));
    row.appendChild(el("span", "spacer"));
    row.appendChild(textBtn("", t("doc.cancel"), function () { dlg.close(); }));
    var save = el("button", "primary", t("doc.save"));
    save.type = "submit";
    row.appendChild(save);
    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      takeTag();
      var now = Date.now(), st = state;
      var cur = CORE.getDoc(st, id);
      if (!cur) { dlg.close(); return; }                 // removed meanwhile on another device
      var next = JSON.parse(JSON.stringify(cur));
      next.t = fTitle.value.trim();
      next.ty = fType.value || undefined;
      var r = CORE.ensureCorr(st, fFrom.value, now); st = r.state; next.co = r.id || undefined;
      next.tg = [];
      tagNames.forEach(function (n) { var x = CORE.ensureTag(st, n, now); st = x.state; if (x.id && next.tg.indexOf(x.id) === -1) next.tg.push(x.id); });
      next.d = fDate.value || undefined;
      next.amt = fAmt.value === "" ? undefined : Number(fAmt.value);
      next.cur = fCur.value.trim().toUpperCase() || undefined;
      next.ex = fEx.value || undefined;
      next.kp = fForever.checked ? CORE.FOREVER : (fKeep.value || undefined);
      next.no = fNote.value.trim() || undefined;
      st = CORE.putDoc(st, next, now);
      if (commit(st)) toast(t("doc.saved"));
      dlg.close();
    });
    dlg.appendChild(form);
    dlg.showModal();
    fTitle.focus();
  }

  function removeDoc(id) {
    var before = state, d = CORE.getDoc(state, id);
    if (!d) return;
    commit(CORE.dropDoc(state, id, Date.now()));
    if (ctx && ctx.undoToast) {
      ctx.undoToast(t("doc.removed"), function () {
        // A newer stamp than the tombstone brings it back (R17).
        commit(CORE.putDoc(state, d, Date.now()));
      });
    } else toast(t("doc.removed"));
    return before;
  }

  // ---------- types, tags and senders ----------
  function openManage() {
    var dlg = modal("doc-manage");
    var body = el("div");
    dlg.appendChild(el("h3", "", t("doc.manage")));
    dlg.appendChild(body);
    var row = el("menu", "dlg-row");
    row.appendChild(el("span", "spacer"));
    row.appendChild(textBtn("primary", t("doc.close"), function () { dlg.close(); }));
    dlg.appendChild(row);
    function uses(field, id) {
      return state.docs.filter(function (d) { return field === "tg" ? d.tg.indexOf(id) !== -1 : d[field] === id; }).length;
    }
    function section(title, items, addLabel, onAdd) {
      var sec = el("section", "doc-msec");
      var h = el("div", "doc-mhead");
      h.appendChild(el("h4", "", title));
      h.appendChild(textBtn("doc-madd", addLabel, onAdd));
      sec.appendChild(h);
      var ul = el("ul", "doc-mlist");
      items.forEach(function (it) {
        var li = el("li");
        var main = el("span", "doc-mname");
        main.appendChild(el("span", "", it.name));
        if (it.sub) main.appendChild(el("small", "", it.sub));
        li.appendChild(main);
        li.appendChild(iconBtn("tool", ICON.edit, t("doc.m.rename", { name: it.name }), it.edit));
        li.appendChild(iconBtn("tool", ICON.trash, t("doc.m.delete", { name: it.name }), function () {
          confirmBox(t("doc.m.delete2"), t("doc.m.delMsg", { name: it.name }), t("doc.m.delete2")).then(function (yes) { if (yes) { it.del(); paintBody(); } });
        }));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      return sec;
    }
    function keepText(x) {
      if (x.kY === -1) return t("doc.m.keepF");
      if (x.kx) return t("doc.m.keepEx");
      if (x.kY >= 1) return t("doc.m.keepY", { n: x.kY });
      return "";
    }
    function paintBody() {
      body.innerHTML = "";
      body.appendChild(section(t("doc.m.types"), CORE.types(state, LANG).map(function (x) {
        var n = uses("ty", x.id), bits = [keepText(x), n ? t("doc.m.used", { n: n }) : "", x.pv ? t("doc.private") : ""].filter(Boolean);
        return { name: x.name, sub: bits.join(" · "),
          edit: function () { typeDialog(x).then(paintBody); },
          del: function () { commit(CORE.dropType(state, x.id, Date.now())); } };
      }), t("doc.m.newType"), function () { typeDialog(null).then(paintBody); }));
      body.appendChild(section(t("doc.m.tags"), CORE.tagsSorted(state, LANG).map(function (x) {
        var n = uses("tg", x.id);
        return { name: x.n, sub: n ? t("doc.m.used", { n: n }) : "",
          edit: function () { nameDialog(t("doc.m.rename", { name: x.n }), x.n).then(function (v) { if (v) commit(CORE.putTag(state, { id: x.id, n: v, c: x.c }, Date.now())); paintBody(); }); },
          del: function () { commit(CORE.dropTag(state, x.id, Date.now())); } };
      }), t("doc.m.newTag"), function () {
        nameDialog(t("doc.m.newTag"), "").then(function (v) { if (v) commit(CORE.ensureTag(state, v, Date.now()).state); paintBody(); });
      }));
      body.appendChild(section(t("doc.m.corr"), CORE.corrSorted(state, LANG).map(function (x) {
        var n = uses("co", x.id);
        return { name: x.n, sub: n ? t("doc.m.used", { n: n }) : "",
          edit: function () { nameDialog(t("doc.m.rename", { name: x.n }), x.n).then(function (v) { if (v) commit(CORE.putCorr(state, { id: x.id, n: v }, Date.now())); paintBody(); }); },
          del: function () { commit(CORE.dropCorr(state, x.id, Date.now())); } };
      }), t("doc.m.newCorr"), function () {
        nameDialog(t("doc.m.newCorr"), "").then(function (v) { if (v) commit(CORE.ensureCorr(state, v, Date.now()).state); paintBody(); });
      }));
    }
    paintBody();
    dlg.showModal();
  }
  function nameDialog(title, value) {
    return new Promise(function (resolve) {
      var d = modal("doc-name");
      var f = el("form");
      f.appendChild(el("h3", "", title));
      var i = input("text", value || "", { maxlength: "80", "aria-label": t("doc.m.name") });
      f.appendChild(i);
      var row = el("menu", "dlg-row");
      row.appendChild(el("span", "spacer"));
      row.appendChild(textBtn("", t("doc.cancel"), function () { d.close(); resolve(null); }));
      var ok = el("button", "primary", t("doc.m.ok")); ok.type = "submit";
      row.appendChild(ok);
      f.appendChild(row);
      f.addEventListener("submit", function (e) { e.preventDefault(); var v = i.value.trim(); d.close(); resolve(v || null); });
      d.addEventListener("cancel", function () { resolve(null); });
      d.appendChild(f);
      d.showModal();
      i.focus();
      i.select();
    });
  }
  function typeDialog(x) {
    return new Promise(function (resolve) {
      var d = modal("doc-name");
      var f = el("form");
      f.appendChild(el("h3", "", x ? t("doc.m.rename", { name: x.name }) : t("doc.m.newType")));
      var name = input("text", x ? x.name : "", { maxlength: "80" });
      f.appendChild(field(t("doc.m.name"), name, "wide"));
      var mode = el("select");
      [["", "—"], ["y", t("doc.m.years")], ["f", t("doc.m.forever")], ["x", t("doc.m.untilEx")]].forEach(function (o) {
        var op = el("option", "", o[1]); op.value = o[0]; mode.appendChild(op);
      });
      mode.value = !x ? "" : x.kY === -1 ? "f" : x.kx ? "x" : x.kY >= 1 ? "y" : "";
      f.appendChild(field(t("doc.f.keep"), mode, "wide"));
      var yrs = input("number", x && x.kY >= 1 ? String(x.kY) : "", { min: "1", max: "100", step: "1", "aria-label": t("doc.m.years") });
      var yf = field(t("doc.m.years"), yrs, "wide");
      f.appendChild(yf);
      function paintMode() { yf.hidden = mode.value !== "y"; }
      mode.addEventListener("change", paintMode);
      paintMode();
      var pv = el("label", "doc-check");
      var pvi = input("checkbox");
      pvi.checked = !!(x && x.pv);
      pv.appendChild(pvi);
      pv.appendChild(el("span", "", t("doc.m.private")));
      f.appendChild(pv);
      var row = el("menu", "dlg-row");
      row.appendChild(el("span", "spacer"));
      row.appendChild(textBtn("", t("doc.cancel"), function () { d.close(); resolve(); }));
      var ok = el("button", "primary", t("doc.save")); ok.type = "submit";
      row.appendChild(ok);
      f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var n = name.value.trim();
        if (!n) { name.focus(); return; }
        var r = { id: x ? x.id : CORE.newId("ty", Date.now()), n: n };
        if (x && x.builtin && n === x.name) delete r.n;    // still translated
        if (mode.value === "f") r.kY = -1;
        else if (mode.value === "x") r.kx = true;
        else if (mode.value === "y" && Number(yrs.value) >= 1) r.kY = Math.min(100, Math.floor(Number(yrs.value)));
        if (pvi.checked) r.pv = true;
        commit(CORE.putType(state, r, Date.now()));
        d.close();
        resolve();
      });
      d.addEventListener("cancel", function () { resolve(); });
      d.appendChild(f);
      d.showModal();
      name.focus();
    });
  }

  // ---------- export / import (.zip with documents.json + CSV) ----------
  function exportDocs() {
    var fs = disk(), Z = ctx && ctx.zip;
    var docs = CORE.filter(state, q, today(), LANG);
    if (!docs.length) { toast(t("doc.exportNone")); return; }
    if (!fs || !Z || busy) return;
    busy = true;
    var entries = [], skipped = 0, kept = [], i = 0, enc = new TextEncoder();
    var chain = Promise.resolve();
    docs.forEach(function (d) {
      chain = chain.then(function () {
        i++;
        if (ctx.setJob) ctx.setJob(t("doc.exporting", { i: i, n: docs.length }));
        return fs.read(d.p).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
          var raw = new Uint8Array(buf);
          entries.push({ name: d.p.slice(CORE.ROOT.length + 1), size: raw.length, crc: Z.crc32(raw), data: raw, method: 0, date: Date.now() });
          kept.push(d);
        }, function () { skipped++; });
      });
    });
    chain.then(function () {
      var json = JSON.stringify(CORE.exportJson(state, kept, LANG, Date.now()), null, 1);
      var csv = CORE.exportCsv(state, kept, LANG, ["doc.csv.title", "doc.csv.type", "doc.csv.tags", "doc.csv.from", "doc.csv.date",
        "doc.csv.amount", "doc.csv.cur", "doc.csv.expires", "doc.csv.keep", "doc.csv.file", "doc.csv.note"].map(function (k) { return t(k); }));
      [["documents.json", json], ["documents.csv", csv]].forEach(function (p) {
        var b = enc.encode(p[1]);
        entries.push({ name: p[0], size: b.length, crc: Z.crc32(b), data: b, method: 0, date: Date.now() });
      });
      var blob = new Blob(Z.build(entries), { type: "application/zip" });
      var name = t("doc.zipName") + " " + today() + ".zip";
      var host = ctx.dialogHost ? ctx.dialogHost() : null;
      var save = host && typeof host.saveFile === "function"
        ? host.saveFile({ blob: blob, filename: name, types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }] })
        : Promise.resolve(fallbackDownload(blob, name));
      return save.then(function (ok) {
        if (ok === false || ok === null) return;
        toast(t("doc.exported", { n: kept.length }));
        if (skipped) toast(t("doc.exportSkip", { n: skipped }));
      });
    }).catch(function () { toast(t("doc.exportFail")); }).then(function () {
      busy = false;
      if (ctx.setJob) ctx.setJob("");
    });
  }
  function fallbackDownload(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  // The archive's files go under Documents/Imported <date>/ keeping
  // their folders; then the details join (docs-core importJson).
  function importArchive() {
    var host = ctx && ctx.dialogHost ? ctx.dialogHost() : null, fs = disk(), AZ = window.AtelierZip;
    if (!fs || !AZ || busy) return;
    var pick = host && typeof host.openFile === "function" ? host.openFile(".zip,application/zip")
      : new Promise(function (resolve) {
        var inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".zip,application/zip";
        inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
        inp.click();
      });
    pick.then(function (file) {
      if (!file) return null;
      if (file.size > 300 * 1048576) { toast(t("doc.importBad")); return null; }
      busy = true;
      if (ctx.setJob) ctx.setJob(t("doc.importing"));
      return file.arrayBuffer().then(function (buf) {
        var z;
        try { z = AZ.open(new Uint8Array(buf)); } catch (e) { throw new Error("bad"); }
        if (!z.has("documents.json")) throw new Error("bad");
        return z.text("documents.json").then(function (txt) {
          var json;
          try { json = JSON.parse(txt); } catch (e) { throw new Error("bad"); }
          if (!json || json.format !== "oros-documents" || !Array.isArray(json.docs)) throw new Error("bad");
          var base = CORE.DOCS_DIR + "/" + t("doc.importDir") + " " + today();
          var placed = {}, chain = ensureDir(fs, base);
          json.docs.forEach(function (o) {
            if (!o || typeof o.f !== "string" || !ctx.zipSafePath) return;
            var segs = ctx.zipSafePath(o.f);
            if (!segs || !z.has(o.f)) return;
            var rel = segs.map(function (x) { return x === ".trash" || x === ".docs" ? "_" + x.slice(1) : x; }).join("/");
            chain = chain.then(function () {
              return z.bytes(o.f).then(function (bytes) {
                var dst = base + "/" + rel;
                return ensureDir(fs, parentOf(dst)).then(function () {
                  return fs.write(dst, new Blob([bytes]));
                }).then(function () { placed[o.f] = dst; });
              }).catch(function () {});
            });
          });
          return chain.then(function () {
            var r = CORE.importJson(state, json, function (f) { return placed[f] || null; }, Date.now(), LANG);
            commit(r.state);
            if (ctx.onDiskChanged) ctx.onDiskChanged();
            toast(r.added ? t("doc.imported", { n: r.added }) : t("doc.importNone"));
          });
        });
      });
    }).catch(function () { toast(t("doc.importBad")); }).then(function () {
      busy = false;
      if (ctx && ctx.setJob) ctx.setJob("");
    });
  }

  // ---------- place in the tree ----------
  function setMode(on) {
    active = on;
    document.body.classList.toggle("doc-mode", on);
    saveView();
  }
  function treeNode() {
    var wrap = el("div", "dbx-tree doc-tree");
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.appendChild(el("span", "caret empty"));
    var g = el("span", "glyph");
    g.innerHTML = ICON.box;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("doc.tree")));
    if (state.docs.length) node.appendChild(el("span", "tcount", String(state.docs.length)));
    function open() {
      if (ctx && ctx.closeDrawer) ctx.closeDrawer();
      enter();
    }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }
  function enter() {
    if (ctx && ctx.onEnter) ctx.onEnter();
    setMode(true);
    ensurePanel();
    renderToken++;
    var qi = $("doc-q");
    if (qi) qi.value = q.text;
    paint();
    relocate(true).then(checkMissing);
    if (ctx && ctx.afterEnter) ctx.afterEnter();
  }
  function leave() {
    if (!active) return;
    renderToken++;
    var m = $("doc-menu");
    if (m) m.remove();
    setMode(false);
  }

  function init(c) {
    ctx = c || {};
    load();
    registerSync();
    var view = readView();
    if (view && view.on) enter();
  }

  window.OrosFilesDocs = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    isActive: function () { return active; },
    add: add,
    carry: carry,
    open: function (id) { if (!active) enter(); openDoc(id); },
    isDocument: function (p, h) { return CORE.isDocument(state, p, h); },
    t: t
  };
})();
